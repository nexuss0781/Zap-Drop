package com.zapdrop.app

import android.content.Intent
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.Executors

@CapacitorPlugin(name = "ZapdropUpdater")
class ZapdropUpdaterPlugin : Plugin() {
    private val worker = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private data class ReleaseAsset(
        val version: String,
        val tag: String,
        val apkUrl: String,
        val checksumUrl: String,
        val apkName: String,
        val size: Long,
        val notes: String,
    )

    @PluginMethod
    fun checkForUpdate(call: PluginCall) {
        worker.execute {
            try {
                val release = fetchLatestRelease()
                val current = installedVersionName()
                val available = release != null && compareVersions(release.version, current) > 0
                val result = JSObject()
                    .put("currentVersion", current)
                    .put("latestVersion", release?.version ?: "")
                    .put("updateAvailable", available)
                    .put("releaseNotes", release?.notes ?: "")
                    .put("downloadSize", release?.size ?: 0L)
                mainHandler.post { call.resolve(result) }
            } catch (error: Exception) {
                mainHandler.post {
                    call.reject(error.message ?: "Could not check for Zapdrop updates.")
                }
            }
        }
    }

    @PluginMethod
    fun downloadAndInstall(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !context.packageManager.canRequestPackageInstalls()) {
            mainHandler.post {
                try {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:${context.packageName}"),
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    activity.startActivity(intent)
                    call.resolve(JSObject()
                        .put("permissionRequired", true)
                        .put("message", "Allow installs from Zapdrop in Android settings, return here, then tap Install update again."))
                } catch (error: Exception) {
                    call.reject("Android could not open the app-install permission screen: ${error.message}")
                }
            }
            return
        }

        worker.execute {
            try {
                val release = fetchLatestRelease()
                    ?: throw IllegalStateException("There is no published Zapdrop release to install yet.")
                val currentInfo = installedPackageInfo()
                val currentVersion = currentInfo.versionName ?: "0.0.0"
                if (compareVersions(release.version, currentVersion) <= 0) {
                    throw IllegalStateException("Zapdrop is already up to date.")
                }

                val apk = downloadAndVerify(release)
                val archiveInfo = context.packageManager.getPackageArchiveInfo(apk.absolutePath, 0)
                    ?: throw IllegalStateException("Android could not read the downloaded APK.")
                if (archiveInfo.packageName != context.packageName) {
                    throw IllegalStateException("The downloaded APK is not the Zapdrop Android app.")
                }
                if (versionCode(archiveInfo) <= versionCode(currentInfo)) {
                    throw IllegalStateException("This release has no higher Android version code. Publish it with the versioned Android release workflow, then try again.")
                }

                mainHandler.post {
                    try {
                        val contentUri = FileProvider.getUriForFile(
                            context,
                            "${context.packageName}.fileprovider",
                            apk,
                        )
                        val installIntent = Intent(Intent.ACTION_VIEW).apply {
                            setDataAndType(contentUri, "application/vnd.android.package-archive")
                            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                        }
                        activity.startActivity(installIntent)
                        call.resolve(JSObject()
                            .put("permissionRequired", false)
                            .put("installerLaunched", true)
                            .put("version", release.version)
                            .put("message", "Android's installer is open. Confirm the update there, then choose Open when installation finishes."))
                    } catch (error: Exception) {
                        call.reject("The APK is ready, but Android could not open its installer: ${error.message}")
                    }
                }
            } catch (error: Exception) {
                mainHandler.post {
                    call.reject(error.message ?: "Could not download the Zapdrop update.")
                }
            }
        }
    }

    private fun fetchLatestRelease(): ReleaseAsset? {
        val connection = openConnection(
            "https://api.github.com/repos/nexuss0781/Zap-Drop/releases/latest",
            "application/vnd.github+json",
        )
        try {
            if (connection.responseCode == HttpURLConnection.HTTP_NOT_FOUND) return null
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("GitHub returned HTTP ${connection.responseCode} while checking for updates.")
            }
            val release = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
            val tag = release.optString("tag_name").trim()
            val version = normalizeVersion(tag)
                ?: throw IllegalStateException("The latest GitHub release tag '$tag' is not a semantic version.")
            val assets = release.optJSONArray("assets")
                ?: throw IllegalStateException("The latest GitHub release does not contain downloadable assets.")
            var apkName = ""
            var apkUrl = ""
            var checksumUrl = ""
            var size = 0L
            for (index in 0 until assets.length()) {
                val asset = assets.optJSONObject(index) ?: continue
                val name = asset.optString("name")
                val lowerName = name.lowercase(Locale.ROOT)
                val browserUrl = asset.optString("browser_download_url")
                if (lowerName.startsWith("zapdrop-") && lowerName.endsWith(".apk")) {
                    apkName = name
                    apkUrl = browserUrl
                    size = asset.optLong("size", 0L)
                }
            }
            if (apkName.isBlank() || !apkUrl.startsWith("https://github.com/")) {
                throw IllegalStateException("The latest GitHub release is missing a Zapdrop APK asset.")
            }
            val checksumName = "$apkName.sha256"
            for (index in 0 until assets.length()) {
                val asset = assets.optJSONObject(index) ?: continue
                if (asset.optString("name").equals(checksumName, ignoreCase = true)) {
                    checksumUrl = asset.optString("browser_download_url")
                }
            }
            if (checksumUrl.isBlank() || !checksumUrl.startsWith("https://github.com/")) {
                throw IllegalStateException("The latest release is missing the APK SHA-256 checksum asset.")
            }
            return ReleaseAsset(
                version = version,
                tag = tag,
                apkUrl = apkUrl,
                checksumUrl = checksumUrl,
                apkName = apkName,
                size = size,
                notes = release.optString("body", "").take(8_000),
            )
        } finally {
            connection.disconnect()
        }
    }

    private fun downloadAndVerify(release: ReleaseAsset): File {
        val checksumConnection = openConnection(release.checksumUrl, "text/plain")
        val checksumText = try {
            if (checksumConnection.responseCode !in 200..299) {
                throw IllegalStateException("Could not download the APK checksum (HTTP ${checksumConnection.responseCode}).")
            }
            checksumConnection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            checksumConnection.disconnect()
        }
        val expectedHash = Regex("(?i)\\b[0-9a-f]{64}\\b").find(checksumText)?.value?.lowercase(Locale.ROOT)
            ?: throw IllegalStateException("The release checksum file is not a valid SHA-256 hash.")

        val folder = File(context.cacheDir, "updates").apply { mkdirs() }
        val destination = File(folder, release.apkName)
        val partial = File(folder, "${release.apkName}.part")
        val digest = MessageDigest.getInstance("SHA-256")
        val connection = openConnection(release.apkUrl, "application/vnd.android.package-archive")
        try {
            if (connection.responseCode !in 200..299) {
                throw IllegalStateException("Could not download the update APK (HTTP ${connection.responseCode}).")
            }
            val total = connection.contentLength.toLong().takeIf { it > 0L } ?: release.size
            var downloaded = 0L
            var lastUpdate = 0L
            connection.inputStream.use { input ->
                FileOutputStream(partial).use { output ->
                    val buffer = ByteArray(DEFAULT_BUFFER_SIZE * 8)
                    while (true) {
                        val count = input.read(buffer)
                        if (count < 0) break
                        downloaded += count
                        if (downloaded > 600L * 1024L * 1024L) {
                            throw IllegalStateException("The APK is unexpectedly large; download cancelled.")
                        }
                        digest.update(buffer, 0, count)
                        output.write(buffer, 0, count)
                        val now = System.currentTimeMillis()
                        if (now - lastUpdate >= 150L || (total > 0 && downloaded >= total)) {
                            lastUpdate = now
                            publishProgress(downloaded, total)
                        }
                    }
                    output.fd.sync()
                }
            }
            val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
            if (actualHash != expectedHash) {
                throw IllegalStateException("The downloaded APK failed its SHA-256 integrity check. No installation was started.")
            }
            if (!partial.renameTo(destination)) {
                partial.copyTo(destination, overwrite = true)
                partial.delete()
            }
            return destination
        } catch (error: Exception) {
            partial.delete()
            throw error
        } finally {
            connection.disconnect()
        }
    }

    private fun publishProgress(downloaded: Long, total: Long) {
        val percent = if (total > 0) ((downloaded * 100L) / total).toInt().coerceIn(0, 100) else -1
        mainHandler.post {
            notifyListeners("downloadProgress", JSObject()
                .put("downloadedBytes", downloaded)
                .put("totalBytes", total)
                .put("percent", percent))
        }
    }

    private fun openConnection(url: String, accept: String): HttpURLConnection {
        if (!url.startsWith("https://")) throw IllegalStateException("Updates must be downloaded over HTTPS.")
        return (URL(url).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            requestMethod = "GET"
            setRequestProperty("User-Agent", "Zapdrop-Android-Updater")
            setRequestProperty("Accept", accept)
        }
    }

    private fun installedPackageInfo(): PackageInfo = context.packageManager.getPackageInfo(context.packageName, 0)

    private fun installedVersionName(): String = installedPackageInfo().versionName ?: "0.0.0"

    @Suppress("DEPRECATION")
    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    private fun normalizeVersion(input: String): String? {
        val match = Regex("^[vV]?(\\d+)(?:\\.(\\d+))?(?:\\.(\\d+))?(?:[-+][0-9A-Za-z.-]+)?$").matchEntire(input)
            ?: return null
        return "${match.groupValues[1]}.${match.groupValues[2].ifBlank { "0" }}.${match.groupValues[3].ifBlank { "0" }}"
    }

    private fun compareVersions(left: String, right: String): Int {
        val a = normalizeVersion(left) ?: return 0
        val b = normalizeVersion(right) ?: return 0
        val av = a.split('.').map { it.toLongOrNull() ?: 0L }
        val bv = b.split('.').map { it.toLongOrNull() ?: 0L }
        for (index in 0..2) {
            val comparison = av[index].compareTo(bv[index])
            if (comparison != 0) return comparison
        }
        return 0
    }
}
