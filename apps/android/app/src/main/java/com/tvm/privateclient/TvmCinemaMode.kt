package com.tvm.privateclient

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.View
import android.view.WindowManager
import android.webkit.WebView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/**
 * Full-screen playback on Android: landscape, no system bars, screen kept on.
 *
 * Entered when a film or episode starts and left when the player closes, so the
 * rest of the app keeps the orientation and bars it had before. The page is
 * told through `html.tvm-cinema`, which the Android overlay uses to hide the
 * tab bar and lay the controls out for a landscape screen.
 *
 * Every call is idempotent; the activity calls [exit] from onDestroy as well.
 */
class TvmCinemaMode(
    private val activity: Activity,
    private val webView: WebView,
    /** Native chrome (the ⋮ menu) that must not float over the picture. */
    private val overlays: List<View>,
) {
    var active = false
        private set
    private var savedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    private val savedVisibility = IntArray(overlays.size)

    fun enter() {
        if (active) return
        active = true
        savedOrientation = activity.requestedOrientation
        // Sensor landscape: turns the phone sideways whatever it was doing, and
        // still lets the user flip it over to the other landscape.
        activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        overlays.forEachIndexed { i, view ->
            savedVisibility[i] = view.visibility
            view.visibility = View.GONE
        }
        hideBars()
        webView.evaluateJavascript("document.documentElement.classList.add('tvm-cinema');", null)
    }

    fun exit() {
        if (!active) return
        active = false
        activity.requestedOrientation = savedOrientation
        activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        overlays.forEachIndexed { i, view -> view.visibility = savedVisibility[i] }
        WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            .show(WindowInsetsCompat.Type.systemBars())
        webView.evaluateJavascript("document.documentElement.classList.remove('tvm-cinema');", null)
    }

    /** Bars come back on a swipe; this puts them away again once focus returns. */
    fun onWindowFocusChanged(hasFocus: Boolean) {
        if (active && hasFocus) hideBars()
    }

    /** A page reload (an interface update) loses the class; put it back. */
    fun republish() {
        if (active) webView.evaluateJavascript("document.documentElement.classList.add('tvm-cinema');", null)
    }

    private fun hideBars() {
        val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }
}
