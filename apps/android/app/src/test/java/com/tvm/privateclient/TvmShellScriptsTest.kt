package com.tvm.privateclient

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The Android look is injected through the boot script. These check it reaches
 * phones only, cannot break out of its <script>, and replaces the web intro.
 * The exact payload is also written to build/android-shell-boot.js so the
 * overlay can be exercised against the interface in a desktop browser.
 */
class TvmShellScriptsTest {
    private val assets = File("src/main/assets/android-shell")
    private val css = File(assets, "tvm-android.css").readText()
    private val js = File(assets, "tvm-android.js").readText()
    private val overlay = TvmShellScripts.androidOverlay(css, js)

    private fun profile() = JSONObject()
        .put("identifier", "Google Pixel 8").put("model", "Pixel 8").put("family", "notch").put("maxHeight", 1080)
        .put("insetTop", 32.0).put("insetRight", 0.0).put("insetBottom", 24.0).put("insetLeft", 0.0)
        .put("extraTop", 6).put("extraBottom", 0).put("extraX", 0)

    @Test
    fun phonesGetTheAndroidLook() {
        val boot = TvmShellScripts.boot(true, profile(), "en", overlay)
        assertTrue(boot.contains("classList.add('tvm-android')"))
        assertTrue(boot.contains("tvm-android-shell"))
        assertTrue(boot.contains("--tvm-rubber"))
        File("build").mkdirs()
        File("build/android-shell-boot.js").writeText(boot)
    }

    @Test
    fun televisionsDoNot() {
        val boot = TvmShellScripts.boot(false, profile(), "en", overlay)
        assertFalse(boot.contains("tvm-android"))
    }

    @Test
    fun theWebIntroIsMarkedPlayed() {
        assertTrue(overlay.contains("sessionStorage.setItem('tvm.intro.session', '1')"))
    }

    @Test
    fun theStylesheetCannotCloseTheScript() {
        val hostile = TvmShellScripts.androidOverlay("a{}</style></script><script>alert(1)</script>", "var x = '</script>';")
        assertFalse(hostile.lowercase().contains("</script"))
    }

    @Test
    fun nothingToInjectWithoutAssets() {
        assertEquals("", TvmShellScripts.androidOverlay("", ""))
        assertEquals(TvmShellScripts.boot(true, profile(), "en"), TvmShellScripts.boot(true, profile(), "en", ""))
    }
}
