package com.tvm.privateclient

import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.LoadControl

/**
 * How far ahead the phone downloads a film or episode.
 *
 * Media3's default keeps at most 50 s in hand, so a short dip in the Wi-Fi or
 * in Real-Debrid's speed emptied it and playback stalled. A 1080p copy (the
 * most a phone is given, TvmPlaybackChoice) at 8-20 Mbit/s now has 1.5 to 3
 * minutes in hand, capped by size so a large copy cannot exhaust memory
 * (the app asks for the large heap in the manifest). After a stall it starts
 * again with 3 s in hand rather than 5 s.
 *
 * Live channels keep Media3's own values: they cannot run ahead of the
 * broadcast.
 */
object TvmPlaybackBuffer {
    const val MIN_BUFFER_MS = 60_000
    const val MAX_BUFFER_MS = 180_000
    const val START_MS = 2_500
    const val RESTART_MS = 3_000
    const val TARGET_BYTES = 200 * 1024 * 1024

    fun forFilm(): LoadControl = DefaultLoadControl.Builder()
        .setBufferDurationsMs(MIN_BUFFER_MS, MAX_BUFFER_MS, START_MS, RESTART_MS)
        .setTargetBufferBytes(TARGET_BYTES)
        .setPrioritizeTimeOverSizeThresholds(false)
        .build()
}
