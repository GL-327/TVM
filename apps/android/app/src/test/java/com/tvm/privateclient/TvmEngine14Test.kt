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

    @Test fun phoneRankingUsesOriginalLanguageThenNativeResolutionSourceAndSize() {
        val entries = listOf(
            stream("Film 1080p WEB-DL x264 English 2 GB", "a".repeat(40)),
            stream("Film 2160p WEB-DL x265 English 12 GB", "b".repeat(40)),
            stream("Film 2160p REMUX x265 English 40 GB", "c".repeat(40)),
            stream("Film 2160p REMUX x265 English 50 GB", "d".repeat(40)),
            stream("Film 2160p REMUX x265 French 60 GB", "e".repeat(40)),
            stream("Film 2160p REMUX x265 English AIUS 80 GB", "f".repeat(40)),
            stream("Film 2160p HDCAM x265 English 90 GB", "1".repeat(40)),
        )
        val rows = TvmVersions.rankForPhone(entries, TvmPrefs(), "eng", 7200.0, 2160, null, DecoderCaps.ALL)
        assertEquals(listOf(entries[3], entries[2], entries[1], entries[0]), rows.map { it.stream })
        assertEquals(rows[0].version.languages, listOf("eng"))
        assertTrue(rows[0].version.recommended)
        assertTrue(rows[0].version.bitrateMbps!! > 50)
        val capped = TvmVersions.rankForPhone(entries, TvmPrefs(), "eng", null, 2160, PlaybackClient("exoplayer", 1080), DecoderCaps.ALL)
        assertEquals(listOf(entries[0]), capped.map { it.stream })
    }

    @Test fun declaredClientCapsCannotEnableMissingHardwareDecoders() {
        val caps = DecoderCaps.ALL.copy(hevc = false, avc4k = false, dolbyVision = false, trueHd = false, dts = false)
        val entries = listOf(stream("Film 2160p HEVC English", "a".repeat(40)), stream("Film 1080p AVC TrueHD English", "b".repeat(40)), stream("Film 1080p AVC AAC English", "c".repeat(40)))
        val rows = TvmVersions.rankForPhone(entries, TvmPrefs(), "eng", null, 2160, PlaybackClient("mpv", 2160, true, true, true), caps)
        assertEquals(listOf(entries[2]), rows.map { it.stream })
        assertEquals("exoplayer", PlaybackClient.parse(JSONObject("""{"player":"exoplayer","hevc":false,"maxHeight":720,"mkv":false}"""))!!.player)
        assertNull(PlaybackClient.parse(JSONObject("""{"player":"invalid"}""")))
    }
}
