package com.zapdrop.app

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.MacAddress
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.util.Patterns
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@CapacitorPlugin(
    name = "ZapdropWifi",
    permissions = [
        Permission(strings = [Manifest.permission.NEARBY_WIFI_DEVICES], alias = "nearbyWifi"),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "wifiScanLocation")
    ]
)
class ZapdropWifiPlugin : Plugin() {
    private val io = Executors.newCachedThreadPool()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val seenPeers = ConcurrentHashMap<String, Long>()
    private val discoveryRunning = AtomicBoolean(false)
    private val advertisingRunning = AtomicBoolean(false)
    private var listenerSocket: DatagramSocket? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var connectedNetwork: Network? = null
    private var wifiCallback: ConnectivityManager.NetworkCallback? = null
    private var connectivity: ConnectivityManager? = null

    @PluginMethod
    fun startHotspot(call: PluginCall) {
        ensureHotspotPermission(call)
    }

    private fun ensureHotspotPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("nearbyWifi") != PermissionState.GRANTED) {
            requestPermissionForAlias("nearbyWifi", call, "hotspotNearbyPermissionCallback")
            return
        }
        if (Build.VERSION.SDK_INT < 33 && Build.VERSION.SDK_INT >= 23 && getPermissionState("wifiScanLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("wifiScanLocation", call, "hotspotLocationPermissionCallback")
            return
        }
        beginHotspot(call)
    }

    @PermissionCallback
    private fun hotspotNearbyPermissionCallback(call: PluginCall) {
        if (getPermissionState("nearbyWifi") == PermissionState.GRANTED) beginHotspot(call)
        else call.reject("Nearby Wi-Fi permission is needed to create a local transfer hotspot.")
    }

    @PermissionCallback
    private fun hotspotLocationPermissionCallback(call: PluginCall) {
        if (getPermissionState("wifiScanLocation") == PermissionState.GRANTED) beginHotspot(call)
        else call.reject("Location permission is required by Android for local hotspot access on this version.")
    }

    private fun beginHotspot(call: PluginCall) {
        HotspotController.start(context) { result ->
            result.fold(
                onSuccess = { (ssid, password) ->
                    call.resolve(JSObject().put("ssid", ssid).put("password", password))
                },
                onFailure = { call.reject(it.message ?: "Could not start the local hotspot.") }
            )
        }
    }

    @PluginMethod
    fun stopHotspot(call: PluginCall) {
        HotspotController.stop()
        call.resolve()
    }

    @PluginMethod
    fun openHotspotSettings(call: PluginCall) {
        val actions = listOf(
            "android.settings.TETHER_SETTINGS",
            "android.settings.WIRELESS_SETTINGS",
            Settings.ACTION_SETTINGS,
        )
        for (action in actions) {
            try {
                activity.startActivity(Intent(action))
                call.resolve()
                return
            } catch (_: Exception) {
                // Try the next system settings screen supported by this device.
            }
        }
        call.reject("Android could not open Wi-Fi or hotspot settings.")
    }

    @PluginMethod
    fun connectToWifi(call: PluginCall) {
        val ssid = call.getString("ssid")?.trim().orEmpty()
        val password = call.getString("password")?.trim().orEmpty()
        if (ssid.isBlank()) {
            call.reject("A Wi-Fi network name is required.")
            return
        }
        ensureWifiConnectPermission(call, ssid, password)
    }

    private fun ensureWifiConnectPermission(call: PluginCall, ssid: String, password: String) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("nearbyWifi") != PermissionState.GRANTED) {
            requestPermissionForAlias("nearbyWifi", call, "connectNearbyPermissionCallback")
            pendingSsid = ssid
            pendingPassword = password
            return
        }
        if (Build.VERSION.SDK_INT < 33 && Build.VERSION.SDK_INT >= 23 && getPermissionState("wifiScanLocation") != PermissionState.GRANTED) {
            pendingSsid = ssid
            pendingPassword = password
            requestPermissionForAlias("wifiScanLocation", call, "connectLocationPermissionCallback")
            return
        }
        requestWifiNetwork(call, ssid, password)
    }

    private var pendingSsid = ""
    private var pendingPassword = ""

    @PermissionCallback
    private fun connectNearbyPermissionCallback(call: PluginCall) {
        if (getPermissionState("nearbyWifi") == PermissionState.GRANTED) {
            if (Build.VERSION.SDK_INT < 33 && getPermissionState("wifiScanLocation") != PermissionState.GRANTED) {
                requestPermissionForAlias("wifiScanLocation", call, "connectLocationPermissionCallback")
            } else requestWifiNetwork(call, pendingSsid, pendingPassword)
        } else call.reject("Nearby Wi-Fi permission is needed to connect to the selected hotspot.")
    }

    @PermissionCallback
    private fun connectLocationPermissionCallback(call: PluginCall) {
        if (getPermissionState("wifiScanLocation") == PermissionState.GRANTED) requestWifiNetwork(call, pendingSsid, pendingPassword)
        else call.reject("Location permission is required by Android to connect to Wi-Fi on this version.")
    }

    private fun requestWifiNetwork(call: PluginCall, ssid: String, password: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Automatic local network joining needs Android 10 or newer. Use the QR code with your phone’s Wi-Fi settings instead.")
            return
        }
        releaseWifiConnection()
        try {
            val specifierBuilder = WifiNetworkSpecifier.Builder().setSsid(ssid)
            if (password.isNotBlank()) specifierBuilder.setWpa2Passphrase(password)
            val request = NetworkRequest.Builder()
                .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .setNetworkSpecifier(specifierBuilder.build())
                .build()
            val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
            connectivity = manager
            val callback = object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    connectedNetwork = network
                    try {
                        manager.bindProcessToNetwork(network)
                    } catch (_: Exception) {
                    }
                    mainHandler.post { call.resolve(JSObject().put("connected", true).put("ssid", ssid)) }
                }

                override fun onUnavailable() {
                    mainHandler.post { call.reject("Android could not connect to $ssid. For a protected Zapdrop hotspot, scan the QR code shown on the other device.") }
                    releaseWifiConnection()
                }
            }
            wifiCallback = callback
            manager.requestNetwork(request, callback, 60_000)
        } catch (error: Exception) {
            call.reject("Could not request the Wi-Fi connection: ${error.message}")
        }
    }

    @PluginMethod
    fun disconnectFromWifi(call: PluginCall) {
        releaseWifiConnection()
        call.resolve()
    }

    private fun releaseWifiConnection() {
        val manager = connectivity
        val callback = wifiCallback
        wifiCallback = null
        connectedNetwork = null
        try {
            manager?.bindProcessToNetwork(null)
        } catch (_: Exception) {
        }
        try {
            if (manager != null && callback != null) manager.unregisterNetworkCallback(callback)
        } catch (_: Exception) {
        }
    }

    @PluginMethod
    fun scanHotspots(call: PluginCall) {
        ensureScanPermissions(call)
    }

    private fun ensureScanPermissions(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("nearbyWifi") != PermissionState.GRANTED) {
            requestPermissionForAlias("nearbyWifi", call, "scanNearbyPermissionCallback")
            return
        }
        if (Build.VERSION.SDK_INT >= 23 && getPermissionState("wifiScanLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("wifiScanLocation", call, "scanLocationPermissionCallback")
            return
        }
        performHotspotScan(call)
    }

    @PermissionCallback
    private fun scanNearbyPermissionCallback(call: PluginCall) {
        if (getPermissionState("nearbyWifi") == PermissionState.GRANTED) {
            if (getPermissionState("wifiScanLocation") != PermissionState.GRANTED) requestPermissionForAlias("wifiScanLocation", call, "scanLocationPermissionCallback")
            else performHotspotScan(call)
        } else call.reject("Nearby Wi-Fi permission is needed to scan local hotspots.")
    }

    @PermissionCallback
    private fun scanLocationPermissionCallback(call: PluginCall) {
        if (getPermissionState("wifiScanLocation") == PermissionState.GRANTED) performHotspotScan(call)
        else call.reject("Android requires location permission to list nearby Wi-Fi access points.")
    }

    private fun performHotspotScan(call: PluginCall) {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        if (wifi == null || !wifi.isWifiEnabled) {
            call.reject("Turn on Wi-Fi to scan for nearby hotspots.")
            return
        }
        try {
            wifi.startScan()
        } catch (_: Exception) {
        }
        mainHandler.postDelayed({
            try {
                val list = JSArray()
                val unique = HashSet<String>()
                for (result in wifi.scanResults) {
                    val ssid = result.SSID?.trim().orEmpty()
                    if (ssid.isBlank() || !unique.add(ssid)) continue
                    list.put(JSObject()
                        .put("ssid", ssid)
                        .put("bssid", result.BSSID ?: "")
                        .put("level", result.level)
                        .put("capabilities", result.capabilities ?: ""))
                }
                call.resolve(JSObject().put("accessPoints", list))
            } catch (error: Exception) {
                call.reject("Unable to read Wi-Fi scan results: ${error.message}")
            }
        }, 1_200)
    }

    @PluginMethod
    fun startDiscovery(call: PluginCall) {
        try {
            stopDiscoveryInternal()
            val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            if (wifi != null) {
                multicastLock = wifi.createMulticastLock("zapdrop_radar").apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
            val socket = DatagramSocket(null).apply {
                reuseAddress = true
                broadcast = true
                bind(InetSocketAddress(48555))
            }
            listenerSocket = socket
            discoveryRunning.set(true)
            Thread({
                val buffer = ByteArray(2048)
                while (discoveryRunning.get()) {
                    try {
                        val packet = DatagramPacket(buffer, buffer.size)
                        socket.receive(packet)
                        val message = String(packet.data, 0, packet.length)
                        val data = JSONObject(message)
                        if (data.optString("type") != "zapdrop") continue
                        val id = data.optString("id")
                        if (id.isBlank()) continue
                        val last = System.currentTimeMillis()
                        seenPeers[id] = last
                        val peer = JSObject()
                            .put("id", id)
                            .put("name", data.optString("name", "Zapdrop Device"))
                            .put("ip", packet.address.hostAddress ?: "")
                            .put("port", data.optInt("port", 0))
                            .put("token", data.optString("token", ""))
                            .put("ssid", data.optString("ssid", ""))
                            .put("active", data.optBoolean("active", false))
                        notifyListeners("deviceFound", peer)
                    } catch (_: Exception) {
                    }
                }
            }, "zapdrop-discovery").apply { isDaemon = true }.start()
            call.resolve()
        } catch (error: Exception) {
            stopDiscoveryInternal()
            call.reject("Failed to scan for nearby Zapdrop devices: ${error.message}")
        }
    }

    @PluginMethod
    fun stopDiscovery(call: PluginCall) {
        stopDiscoveryInternal()
        call.resolve()
    }

    private fun stopDiscoveryInternal() {
        discoveryRunning.set(false)
        try { listenerSocket?.close() } catch (_: Exception) { }
        listenerSocket = null
        try { if (multicastLock?.isHeld == true) multicastLock?.release() } catch (_: Exception) { }
        multicastLock = null
        seenPeers.clear()
    }

    @PluginMethod
    fun startSessionBroadcast(call: PluginCall) {
        stopSessionBroadcastInternal()
        val id = call.getString("deviceId") ?: "device-${System.currentTimeMillis()}"
        val name = call.getString("name") ?: "Zapdrop Device"
        val token = call.getString("token") ?: ""
        val port = call.getInt("port") ?: 0
        val ssid = call.getString("ssid") ?: ""
        if (token.isBlank() || port <= 0) {
            call.reject("The active transfer server is missing its connection details.")
            return
        }
        advertisingRunning.set(true)
        Thread({
            val socket = DatagramSocket().apply { broadcast = true }
            try {
                while (advertisingRunning.get()) {
                    try {
                        val message = JSONObject()
                            .put("type", "zapdrop")
                            .put("id", id)
                            .put("name", name)
                            .put("port", port)
                            .put("token", token)
                            .put("ssid", ssid)
                            .put("active", true)
                            .toString()
                            .toByteArray(Charsets.UTF_8)
                        val packet = DatagramPacket(message, message.size, InetAddress.getByName("255.255.255.255"), 48555)
                        socket.send(packet)
                    } catch (_: Exception) {
                    }
                    Thread.sleep(1_500)
                }
            } finally {
                socket.close()
            }
        }, "zapdrop-session-advertiser").apply { isDaemon = true }.start()
        call.resolve()
    }

    @PluginMethod
    fun stopSessionBroadcast(call: PluginCall) {
        stopSessionBroadcastInternal()
        call.resolve()
    }

    private fun stopSessionBroadcastInternal() {
        advertisingRunning.set(false)
    }

    @PluginMethod
    fun downloadPeer(call: PluginCall) {
        val ip = call.getString("ip") ?: ""
        val port = call.getInt("port") ?: 0
        val token = call.getString("token") ?: ""
        if (!Patterns.IP_ADDRESS.matcher(ip).matches() || port !in 1..65535 || token.isBlank()) {
            call.reject("This Zapdrop device did not provide valid transfer details.")
            return
        }
        io.execute {
            try {
                val manifestUrl = URL("http://$ip:$port/manifest?t=${encode(token)}")
                val manifestConnection = openConnection(manifestUrl)
                val manifestJson = manifestConnection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
                manifestConnection.disconnect()
                val manifest = JSONObject(manifestJson).optJSONArray("files")
                    ?: throw IllegalStateException("The device returned an invalid file list.")
                if (manifest.length() == 0) throw IllegalStateException("There are no files available from this device.")
                val received = JSArray()
                val count = manifest.length()
                for (index in 0 until count) {
                    val file = manifest.getJSONObject(index)
                    val id = file.getString("id")
                    val name = safeFileName(file.optString("name", "zapdrop-file"))
                    val mime = file.optString("mime", "application/octet-stream")
                    val expectedSize = file.optLong("size", 0L)
                    val fileUrl = URL("http://$ip:$port/file/${encode(id)}?t=${encode(token)}")
                    val connection = openConnection(fileUrl)
                    if (connection.responseCode !in 200..299) {
                        throw IllegalStateException("Could not download $name (HTTP ${connection.responseCode}).")
                    }
                    val destination = createDestination(name, mime)
                    val startTime = System.nanoTime()
                    var lastReport = startTime
                    var loaded = 0L
                    try {
                        val input = BufferedInputStream(connection.inputStream, 256 * 1024)
                        val output = BufferedOutputStream(destination.output, 256 * 1024)
                        input.use { source -> output.use { sink ->
                            val buffer = ByteArray(256 * 1024)
                            while (true) {
                                val bytes = source.read(buffer)
                                if (bytes < 0) break
                                sink.write(buffer, 0, bytes)
                                loaded += bytes
                                val now = System.nanoTime()
                                if (now - lastReport >= 250_000_000L || (expectedSize > 0 && loaded >= expectedSize)) {
                                    val elapsed = ((now - lastReport) / 1_000_000_000.0).coerceAtLeast(0.001)
                                    val speed = ((bytes * 1.0) / elapsed / (1024.0 * 1024.0)).coerceAtLeast(0.0)
                                    notifyListeners("receiveProgress", JSObject()
                                        .put("fileName", name)
                                        .put("loaded", loaded)
                                        .put("total", if (expectedSize > 0) expectedSize else connection.contentLengthLong)
                                        .put("fileIndex", index + 1)
                                        .put("fileCount", count)
                                        .put("speedMbps", speed))
                                    lastReport = now
                                }
                            }
                            sink.flush()
                        } }
                        destination.finish()
                    } catch (error: Exception) {
                        destination.abort()
                        throw error
                    } finally {
                        connection.disconnect()
                    }
                    received.put(JSObject()
                        .put("name", name)
                        .put("size", loaded)
                        .put("mime", mime)
                        .put("uri", destination.uri.toString()))
                }
                try {
                    val doneConnection = openConnection(URL("http://$ip:$port/done?t=${encode(token)}"))
                    doneConnection.inputStream.close()
                    doneConnection.disconnect()
                } catch (_: Exception) {
                }
                call.resolve(JSObject().put("files", received))
            } catch (error: Exception) {
                call.reject(error.message ?: "The file transfer failed.")
            } finally {
                releaseWifiConnection()
            }
        }
    }

    private fun openConnection(url: URL): java.net.HttpURLConnection {
        val connection = (connectedNetwork?.openConnection(url) ?: url.openConnection()) as java.net.HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 60_000
        connection.setRequestProperty("Connection", "keep-alive")
        connection.setRequestProperty("Accept-Encoding", "identity")
        connection.useCaches = false
        connection.connect()
        return connection
    }

    private fun encode(value: String): String = URLEncoder.encode(value, "UTF-8").replace("+", "%20")

    private fun safeFileName(name: String): String {
        val clean = File(name).name.replace(Regex("[\\u0000-\\u001F\\\\/:*?\"<>|]"), "_").trim()
        return clean.ifBlank { "zapdrop-file" }
    }

    private data class Destination(val uri: android.net.Uri, val output: java.io.OutputStream, val finish: () -> Unit, val abort: () -> Unit)

    private fun createDestination(name: String, mime: String): Destination {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                put(MediaStore.MediaColumns.MIME_TYPE, mime)
                put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Zapdrop")
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
            val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                ?: throw IllegalStateException("Android could not create the received file.")
            val output = context.contentResolver.openOutputStream(uri, "w")
                ?: throw IllegalStateException("Android could not open the received file for writing.")
            return Destination(uri, output,
                finish = { context.contentResolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null) },
                abort = { context.contentResolver.delete(uri, null, null) })
        }
        val directory = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Zapdrop")
        if (!directory.exists() && !directory.mkdirs()) throw IllegalStateException("Could not create the app’s Downloads/Zapdrop folder.")
        val file = File(directory, name)
        val uri = android.net.Uri.fromFile(file)
        return Destination(uri, FileOutputStream(file), finish = {}, abort = { file.delete() })
    }

    override fun handleOnDestroy() {
        stopDiscoveryInternal()
        stopSessionBroadcastInternal()
        releaseWifiConnection()
        HotspotController.stop()
        io.shutdownNow()
    }
}
