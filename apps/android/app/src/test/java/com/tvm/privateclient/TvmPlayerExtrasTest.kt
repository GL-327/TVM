package com.tvm.privateclient

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TvmPlayerExtrasTest {
    @Test
    fun markWatchedSetsEpisodeFlagMatchingCore() {
        val episodes = listOf(
            MediaItem(id = "tt1:1:1", title = "One"),
            MediaItem(id = "tt1:1:2", title = "Two"),
            MediaItem(id = "tt1:1:3", title = "Three"),
            MediaItem(id = "tt1:1:4", title = "Four"),
        )
        val progress = mapOf(
            "tt1:1:1" to ProgressEntry(position = 2920.0, duration = 3000.0, updated = "2026-11-01T00:00:00Z"),
            "tt1:1:2" to ProgressEntry(position = 600.0, duration = 3000.0, updated = "2026-11-01T00:00:00Z"),
            "tt1:1:3" to ProgressEntry(
                position = 0.0,
                duration = 3000.0,
                updated = "2026-11-01T00:00:00Z",
                completedAt = "2026-10-01T00:00:00Z",
            ),
        )
        val marked = TvmMedia.markWatched(episodes, progress)
        assertEquals(listOf(true, false, true, false), marked.map { it.watched })

        val roundTrip = MediaItem.parse(marked[0].json())
        assertEquals(true, roundTrip?.watched)
        assertEquals(false, MediaItem.parse(marked[1].json())?.watched)
        assertNull(MediaItem.parse(MediaItem(id = "tt9", title = "No Flag").json())?.watched)
    }

    @Test
    fun sleepTimerTracksDeadlinesFadeAndEndOfEpisode() {
        assertNull(TvmSleepLogic.deadlineMs("off", 10_000L))
        assertEquals(10_000L + 15 * 60_000L, TvmSleepLogic.deadlineMs("15", 10_000L))
        assertEquals(1.0f, TvmSleepLogic.fadeFactor(0L), 0.001f)
        assertEquals(0.5f, TvmSleepLogic.fadeFactor(2500L), 0.001f)
        assertEquals(0.0f, TvmSleepLogic.fadeFactor(5000L), 0.001f)
        assertEquals("0:05", TvmSleepLogic.formatRemaining(4200L))
        assertEquals("15:00", TvmSleepLogic.formatRemaining(900_000L))
        assertEquals("1:01:05", TvmSleepLogic.formatRemaining(3_665_000L))

        val tracker = TvmSleepTimerState()
        tracker.reset("15", 0L)
        val mid = tracker.step(nowMs = 60_000L, positionSec = 60.0, durationSec = 1800.0, paused = false)
        assertFalse(mid.snapshot.fading)
        assertFalse(mid.snapshot.expired)
        assertEquals(14 * 60_000L, mid.snapshot.remainingMs)

        val fadeStart = tracker.step(nowMs = 15 * 60_000L, positionSec = 900.0, durationSec = 1800.0, paused = false)
        assertTrue(fadeStart.snapshot.fading)

        val fading = tracker.step(nowMs = 15 * 60_000L + 2_500L, positionSec = 902.5, durationSec = 1800.0, paused = false)
        assertTrue(fading.volumeChanged)
        assertEquals(0.5f, tracker.fadeFactor, 0.02f)

        val expired = tracker.step(nowMs = 15 * 60_000L + 5_000L, positionSec = 905.0, durationSec = 1800.0, paused = false)
        assertTrue(expired.justExpired)
        assertTrue(expired.snapshot.expired)
        assertEquals(0f, tracker.fadeFactor, 0.001f)

        tracker.reset("end", 0L)
        assertFalse(TvmSleepLogic.shouldStart("end", null, 0L, positionSec = 1795.0, durationSec = 1800.0, paused = true))
        val endTrigger = tracker.step(nowMs = 1_000L, positionSec = 1796.0, durationSec = 1800.0, paused = false)
        assertTrue(endTrigger.snapshot.fading)
    }

    @Test
    fun nativeStatsBuildsAndFormatsAllTelemetryFields() {
        val videoFmt = Format.Builder()
            .setSampleMimeType(MimeTypes.VIDEO_H265)
            .setCodecs("hvc1.2.4.L153.B0")
            .setContainerMimeType("video/x-matroska")
            .setWidth(3840)
            .setHeight(2160)
            .setAverageBitrate(25_000_000)
            .build()
        val audioFmt = Format.Builder()
            .setSampleMimeType(MimeTypes.AUDIO_E_AC3)
            .setChannelCount(6)
            .setLanguage("jpn")
            .setAverageBitrate(640_000)
            .build()
        val meta = TvmPlaybackMeta(
            source = "WEB-DL",
            versionLabel = "4K WEB-DL",
            hdr = "hdr10",
        )
        val json = TvmNativeStats.buildJson(
            videoWidth = 3840,
            videoHeight = 2160,
            videoFormat = videoFmt,
            audioFormat = audioFmt,
            droppedFrames = 3,
            renderedFrames = 1497,
            bufferSeconds = 8.4,
            activeSubtitle = "English (ASS)",
            durationSeconds = 3600.0,
            live = false,
            meta = meta,
        )
        val rows = TvmNativeStats.rows(json).toMap()
        assertEquals("3840 × 2160", rows["Resolution"])
        assertEquals("video/x-matroska", rows["Container / MIME"])
        assertEquals("HEVC · EAC3", rows["Codecs"])
        assertEquals("HDR10", rows["HDR"])
        assertEquals("jpn · 5.1", rows["Audio"])
        assertEquals("English (ASS)", rows["Subtitles"])
        assertEquals("3 / 1500", rows["Frames dropped / total"])
        assertEquals("25.6 Mb/s", rows["Bitrate"])
        assertEquals("WEB-DL", rows["Source"])
        assertEquals("4K WEB-DL", rows["Version"])
        assertEquals("8.4 s", rows["Buffer ahead"])
        assertEquals("HDR10", TvmNativeStats.hdrLabel(MimeTypes.VIDEO_H265, null, C.COLOR_TRANSFER_ST2084, null))
        assertEquals("Dolby Vision", TvmNativeStats.hdrLabel(MimeTypes.VIDEO_DOLBY_VISION, null, null, null))
        assertEquals("Stereo", TvmNativeStats.formatChannels(2))
    }
}
