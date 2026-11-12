package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class TvmAppUpdateTest {
    private val apk = ByteArray(4096) { (it % 251).toByte() }

    private fun release(build: String = "7530a7d", digest: String? = "sha256:" + TvmUpdater.sha256Hex(apk), url: String? = null): String =
        JSONObject()
            .put("tag_name", "android")
            .put("body", "**Android**\n\n| | |\n|---|---|\n| Download | `TVM.apk` |\n| Build | `$build` |\n")
            .put(
                "assets",
                JSONArray().put(
                    JSONObject()
                        .put("name", "TVM.apk")
                        .put("size", apk.size)
                        .put("browser_download_url", url ?: "https://github.com/GL-327/TVM/releases/download/android/TVM.apk")
                        .apply { if (digest != null) put("digest", digest) },
                ),
            ).toString()

    private fun github(body: String, status: Int = 200) = TvmHttp { url, _ ->
        if (url == TvmAppUpdate.API_URL) status to body.toByteArray() else 200 to apk
    }

    @Test
    fun readsTheBuildAndTheApkFromTheRelease() {
        val r = TvmAppUpdate.parseRelease(release())!!
        assertEquals("7530a7d", r.build)
        assertEquals(TvmUpdater.sha256Hex(apk), r.sha256)
        assertEquals(apk.size.toLong(), r.size)
    }

    @Test
    fun refusesAnApkFromAnywhereElse() {
        assertNull(TvmAppUpdate.parseRelease(release(url = "https://evil.example/TVM.apk")))
    }

    @Test
    fun sameCommitIsCurrentNewerIsAvailable() {
        assertTrue(TvmAppUpdate(github(release())) { "7530a7d" }.check() is TvmAppUpdate.Check.Current)
        assertTrue(TvmAppUpdate(github(release())) { "7530A7D9999" }.check() is TvmAppUpdate.Check.Current)
        assertTrue(TvmAppUpdate(github(release())) { "1234567" }.check() is TvmAppUpdate.Check.Available)
        assertTrue(TvmAppUpdate(github(release())) { "unknown" }.check() is TvmAppUpdate.Check.Unknown)
        assertTrue(TvmAppUpdate(github("", 404)) { "1234567" }.check() is TvmAppUpdate.Check.Failed)
    }

    @Test
    fun downloadIsCheckedAgainstTheDigest() {
        val dir: File = Files.createTempDirectory("tvm-update").toFile()
        val good = TvmAppUpdate.parseRelease(release())!!
        val file = TvmAppUpdate(github(release())) { "1234567" }.download(good, dir)
        assertTrue(file.readBytes().contentEquals(apk))
        val bad = TvmAppUpdate.parseRelease(release(digest = "sha256:" + "0".repeat(64)))!!
        val failed = runCatching { TvmAppUpdate(github(release())) { "1234567" }.download(bad, dir) }
        assertTrue(failed.isFailure)
        dir.deleteRecursively()
    }
}
