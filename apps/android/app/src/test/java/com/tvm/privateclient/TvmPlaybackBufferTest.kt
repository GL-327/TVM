package com.tvm.privateclient

import org.junit.Assert.assertTrue
import org.junit.Test

class TvmPlaybackBufferTest {
    @Test
    fun keepsMinutesInHandForA1080pCopy() {
        // Media3's default was 50 s; a dip in the Wi-Fi emptied it.
        assertTrue(TvmPlaybackBuffer.MAX_BUFFER_MS >= 120_000)
        assertTrue(TvmPlaybackBuffer.MIN_BUFFER_MS >= 50_000)
        // 1080p at 20 Mbit/s for 60 s fits under the size cap.
        assertTrue(TvmPlaybackBuffer.TARGET_BYTES >= 20_000_000 / 8 * 60)
        // Restarts sooner after a stall than Media3's 5 s, but not instantly.
        assertTrue(TvmPlaybackBuffer.RESTART_MS in 2_000 until 5_000)
    }

    @Test
    fun buildsALoadControl() {
        TvmPlaybackBuffer.forFilm()
    }
}
