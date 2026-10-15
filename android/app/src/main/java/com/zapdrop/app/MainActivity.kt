package com.zapdrop.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ZapdropNativePlugin::class.java)
        registerPlugin(ZapdropWifiPlugin::class.java)
        registerPlugin(ZapdropUpdaterPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
