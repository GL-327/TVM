package com.tvm.privateclient

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.TrackGroup
import androidx.media3.common.Tracks
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TvmSubtitlesTest {
    private fun text(language: String?, label: String? = null, forced: Boolean = false): Format =
        Format.Builder()
            .setSampleMimeType(MimeTypes.APPLICATION_SUBRIP)
            .setLanguage(language)
            .setLabel(label)
            .setSelectionFlags(if (forced) C.SELECTION_FLAG_FORCED else 0)
            .build()

    private fun group(format: Format, supported: Boolean = true, selected: Boolean = false) =
        Tracks.Group(
            TrackGroup(format),
            false,
            intArrayOf(if (supported) C.FORMAT_HANDLED else C.FORMAT_UNSUPPORTED_SUBTYPE),
            booleanArrayOf(selected),
        )

    @Test
    fun listsTheFilesOwnTextTracksOnly() {
        val video = Tracks.Group(TrackGroup(Format.Builder().setSampleMimeType(MimeTypes.VIDEO_H264).build()), false, intArrayOf(C.FORMAT_HANDLED), booleanArrayOf(true))
        val tracks = Tracks(listOf(
            video,
            group(text("en"), selected = true),
            group(text("es", "Latino")),
            group(text("fr"), supported = false),
            group(text("en", "English Forced", forced = true)),
            group(text(null)),
        ))
        val rows = TvmSubtitles.rows(tracks)
        assertEquals(listOf("1:0", "2:0", "4:0", "5:0"), rows.map { it.id })
        assertEquals(listOf("English", "Spanish · Latino", "English Forced", "Subtitles 4"), rows.map { it.label })
        assertEquals(listOf(true, false, false, false), rows.map { it.selected })
        assertEquals(listOf(false, false, true, false), rows.map { it.forced })
        assertEquals("", rows[3].language)
    }

    @Test
    fun forcedTracksSaySo() {
        assertEquals("English (forced)", TvmSubtitles.label(text("en", forced = true), 0))
    }

    @Test
    fun parsesOnlyItsOwnIds() {
        assertEquals(2 to 1, TvmSubtitles.parse("2:1"))
        assertNull(TvmSubtitles.parse(""))
        assertNull(TvmSubtitles.parse("a:b"))
        assertNull(TvmSubtitles.parse("1:-1"))
        assertNull(TvmSubtitles.parse("1:2:3"))
    }
}
