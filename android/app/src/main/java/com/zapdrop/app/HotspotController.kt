package com.zapdrop.app

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.CancellationException
import java.util.concurrent.TimeoutException

/** Owns the app-scoped local-only hotspot used for direct offline transfers. */
object HotspotController {
    private val lock = Any()
    private val mainHandler = Handler(Looper.getMainLooper())
    private var reservation: WifiManager.LocalOnlyHotspotReservation? = null
    private var starting = false
    private var generation = 0L
    private var pendingCallbacks = mutableListOf<(Result<Pair<String, String>>) -> Unit>()
    private var startTimeout: Runnable? = null

    @Suppress("DEPRECATION")
    fun start(context: Context, callback: (Result<Pair<String, String>>) -> Unit) {
        var existing: WifiManager.LocalOnlyHotspotReservation? = null
        var requestGeneration = -1L
        var shouldStart = false
        synchronized(lock) {
            if (reservation != null) {
                existing = reservation
            } else {
                pendingCallbacks.add(callback)
                if (!starting) {
                    starting = true
                    generation += 1
                    requestGeneration = generation
                    shouldStart = true
                }
            }
        }

        existing?.let {
            try {
                callback(Result.success(readCredentials(it)))
            } catch (error: Exception) {
                callback(Result.failure(error))
            }
            return
        }
        if (!shouldStart) return

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            complete(requestGeneration, Result.failure(
                IllegalStateException("Android 8.0 or newer is required for an app-managed local hotspot. Open Wi-Fi settings or connect both devices to the same Wi-Fi network."),
            ))
            return
        }

        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        if (wifi == null) {
            complete(requestGeneration, Result.failure(
                IllegalStateException("This device does not provide Android Wi-Fi hotspot control."),
            ))
            return
        }

        val timeout = Runnable {
            complete(requestGeneration, Result.failure(
                TimeoutException("Android did not answer the hotspot request within 25 seconds. Check the Wi-Fi permission and try again."),
            ))
        }
        synchronized(lock) {
            if (generation == requestGeneration && starting) {
                startTimeout = timeout
                mainHandler.postDelayed(timeout, 25_000)
            }
        }

        try {
            wifi.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(value: WifiManager.LocalOnlyHotspotReservation) {
                    val isCurrentRequest = synchronized(lock) {
                        if (generation != requestGeneration) {
                            false
                        } else {
                            reservation = value
                            true
                        }
                    }
                    if (!isCurrentRequest) {
                        try { value.close() } catch (_: Exception) {}
                        return
                    }
                    try {
                        complete(requestGeneration, Result.success(readCredentials(value)))
                    } catch (error: Exception) {
                        synchronized(lock) {
                            if (reservation === value) reservation = null
                        }
                        try { value.close() } catch (_: Exception) {}
                        complete(requestGeneration, Result.failure(error))
                    }
                }

                override fun onStopped() {
                    synchronized(lock) { reservation = null }
                }

                override fun onFailed(reason: Int) {
                    complete(requestGeneration, Result.failure(
                        IllegalStateException("Android could not start a local hotspot (reason $reason). Try again or connect to Wi-Fi."),
                    ))
                }
            }, mainHandler)
        } catch (error: Exception) {
            complete(requestGeneration, Result.failure(error))
        }
    }

    private fun complete(
        requestGeneration: Long,
        result: Result<Pair<String, String>>,
    ) {
        val callbacks = synchronized(lock) {
            if (generation != requestGeneration) return
            startTimeout?.let(mainHandler::removeCallbacks)
            startTimeout = null
            starting = false
            pendingCallbacks.toList().also { pendingCallbacks.clear() }
        }
        callbacks.forEach { callback ->
            try {
                callback(result)
            } catch (_: Exception) {
                // A dismissed Capacitor call must not prevent other queued callers from completing.
            }
        }
    }

    @Suppress("DEPRECATION")
    private fun readCredentials(value: WifiManager.LocalOnlyHotspotReservation): Pair<String, String> {
        val ssid: String
        val passphrase: String
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val config = value.softApConfiguration
            ssid = config.ssid ?: "Zapdrop-Hotspot"
            passphrase = config.passphrase ?: ""
        } else {
            val config = value.wifiConfiguration
                ?: throw IllegalStateException("Android did not return the local hotspot configuration.")
            ssid = config.SSID?.trim('"') ?: "Zapdrop-Hotspot"
            passphrase = config.preSharedKey?.trim('"') ?: ""
        }
        if (passphrase.length < 8) {
            throw IllegalStateException("Android returned an unsupported hotspot password. Use the same Wi-Fi network on both devices instead.")
        }
        return ssid to passphrase
    }

    fun stop() {
        val (current, callbacks) = synchronized(lock) {
            generation += 1
            startTimeout?.let(mainHandler::removeCallbacks)
            startTimeout = null
            starting = false
            val pending = pendingCallbacks.toList()
            pendingCallbacks.clear()
            val active = reservation
            reservation = null
            active to pending
        }
        callbacks.forEach { callback ->
            try {
                callback(Result.failure(CancellationException("Hotspot startup was cancelled.")))
            } catch (_: Exception) {}
        }
        try {
            current?.close()
        } catch (_: Exception) {
        }
    }
}
