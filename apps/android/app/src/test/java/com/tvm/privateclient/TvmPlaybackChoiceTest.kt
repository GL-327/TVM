package com.tvm.privateclient

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TvmPlaybackChoiceTest {
    // A typical phone: HEVC to 4K (10-bit), no 4K H.264, no Dolby Vision, AV1,
    // Dolby Digital (Plus) but no TrueHD or DTS.
    private val phone = DecoderCaps(
        avc4k = false, hevc = true, hevc4k = true, hevc10 = true, av1 = true,
        dolbyVision = false, trueHd = false, dts = false, eac3 = true, ac3 = true,
    )

    @Test
    fun fourKH264IsOnlyPlayableWithA4kAvcDecoder() {
        val needs = TvmPlaybackChoice.needs("Severance.S01E01.2160p.WEB-DL.DDP5.1.H.264", 2160)
        assertEquals("avc", needs.codec)
        assertFalse(TvmPlaybackChoice.videoPlayable(needs, phone))
        assertTrue(TvmPlaybackChoice.videoPlayable(needs, phone.copy(avc4k = true)))
        // The same codec at 1080p is fine.
        assertTrue(TvmPlaybackChoice.videoPlayable(TvmPlaybackChoice.needs("Severance.S01E01.1080p.x264", 1080), phone))
    }

    @Test
    fun dolbyVisionWithoutHdrNeedsADolbyVisionDecoder() {
        val dvOnly = TvmPlaybackChoice.needs("Show.2160p.DV.HEVC", 2160)
        assertFalse(TvmPlaybackChoice.videoPlayable(dvOnly, phone))
        val hybrid = TvmPlaybackChoice.needs("Show.2160p.DV.HDR.HEVC", 2160)
        assertTrue(TvmPlaybackChoice.videoPlayable(hybrid, phone))
    }

    @Test
    fun soundOnlyInTrueHdOrDtsIsFlagged() {
        assertFalse(TvmPlaybackChoice.audioPlayable(TvmPlaybackChoice.needs("Film.1080p.REMUX.TrueHD.7.1.Atmos", 1080), phone))
        assertFalse(TvmPlaybackChoice.audioPlayable(TvmPlaybackChoice.needs("Film.1080p.BluRay.DTS-HD.MA", 1080), phone))
        assertTrue(TvmPlaybackChoice.audioPlayable(TvmPlaybackChoice.needs("Film.1080p.WEB.DDP5.1", 1080), phone))
        // A name that says nothing about sound is not held against the copy.
        assertTrue(TvmPlaybackChoice.audioPlayable(TvmPlaybackChoice.needs("Film.1080p.WEB", 1080), phone))
    }

    @Test
    fun orderPutsFullyPlayableCopiesFirstAndKeepsQualityOrderWithin() {
        val copies = listOf(
            "Show.2160p.WEB.H.264.DDP5.1" to 2160, // no 4K AVC decoder
            "Show.1080p.BluRay.REMUX.TrueHD" to 1080, // no TrueHD decoder, and a remux
            "Show.1080p.BluRay.REMUX.DDP5.1" to 1080, // remux
            "Show.1080p.WEB.x265.DDP5.1" to 1080,
            "Show.720p.WEB.x264.AAC" to 720,
        )
        val ordered = TvmPlaybackChoice.order(copies, { it.first }, { it.second }, phone).map { it.first }
        assertEquals(
            listOf(
                "Show.1080p.WEB.x265.DDP5.1",
                "Show.720p.WEB.x264.AAC",
                "Show.1080p.BluRay.REMUX.DDP5.1",
                "Show.1080p.BluRay.REMUX.TrueHD",
                "Show.2160p.WEB.H.264.DDP5.1",
            ),
            ordered,
        )
    }

    @Test
    fun everythingIsPlayableWithFullCaps() {
        val needs = TvmPlaybackChoice.needs("Film.2160p.DV.HEVC.TrueHD", 2160)
        assertTrue(TvmPlaybackChoice.videoPlayable(needs, DecoderCaps.ALL))
        assertTrue(TvmPlaybackChoice.audioPlayable(needs, DecoderCaps.ALL))
    }
}
