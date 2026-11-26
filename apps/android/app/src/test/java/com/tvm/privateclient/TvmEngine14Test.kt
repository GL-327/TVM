package com.tvm.privateclient

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TvmEngine14Test {
    private fun stream(title: String, hash: String) = RdStream(
        url = "https://example.test/$hash",
        title = title,
        name = "Torrentio",
        infoHash = hash,
        fileIdx = 0,
        quality = 30,
        cached = true,
        phoneHint = false,
        details = title,
        releaseId = "$hash:0",
    )

    @Test
    fun prefsKeepDefaultsAndRejectBadValues() {
        val prefs = TvmPrefs().merge(
            JSONObject("""{"quality":"4k","skipSegments":"auto","webhookUrl":"ftp://x","extras":{"themeSongs":true,"nope":true}}"""),
        )
        assertEquals("original", prefs.quality)
        assertEquals("auto", prefs.skipSegments)
        assertNull(prefs.webhookUrl)
        assertEquals(true, prefs.extras["themeSongs"])
        assertFalse(prefs.extras.containsKey("nope"))
        assertEquals(true, prefs.json().getJSONObject("extras").getBoolean("trailers"))
    }

    @Test
    fun versionsSkipUpscalesAndDubsOfForeignFilms() {
        val streams = listOf(
            stream("Film 2160p WEB-DL x265 AIUS upscaled", "a".repeat(40)),
            stream("Film 1080p BluRay x264 Japanese", "b".repeat(40)),
            stream("Film 1080p BluRay x264 French", "c".repeat(40)),
        )
        val ranked = TvmVersions.rankVersions(streams, TvmPrefs(), "jpn", null, 2160, null)
        assertEquals(1, ranked.size)
        assertEquals(1080, ranked[0].version.height)
        assertTrue(ranked[0].version.recommended)
    }

    @Test
    fun deviceCapsDropWhatThePhoneCannotPlay() {
        val hevc = stream("Film 2160p HDR HEVC REMUX", "d".repeat(40))
        val client = PlaybackClient(player = "exoplayer", maxHeight = 1080, hevc = true, hdr = false, mkv = true)
        assertTrue(TvmVersions.rankVersions(listOf(hevc), TvmPrefs(), null, null, 2160, client).isEmpty())
    }
}
