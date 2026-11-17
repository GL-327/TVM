package com.tvm.privateclient

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.Tracks
import java.util.Locale

/**
 * The subtitle tracks inside the file being played (an MKV usually carries
 * several), for the player's CC menu (tvm-android.js, section 21). Only what
 * the copy itself contains is listed: nothing is fetched or invented.
 */
object TvmSubtitles {
    data class Row(
        /** "group:track" in Media3's current track list. */
        val id: String,
        val label: String,
        val language: String,
        val selected: Boolean,
        val forced: Boolean,
    )

    /** Text tracks this phone can show, in the file's order. */
    fun rows(tracks: Tracks): List<Row> {
        val out = mutableListOf<Row>()
        tracks.groups.forEachIndexed { g, group ->
            if (group.type != C.TRACK_TYPE_TEXT) return@forEachIndexed
            for (i in 0 until group.length) {
                if (!group.isTrackSupported(i)) continue
                val f = group.getTrackFormat(i)
                out += Row(
                    id = "$g:$i",
                    label = label(f, out.size),
                    language = (f.language ?: "").takeUnless { it == C.LANGUAGE_UNDETERMINED } ?: "",
                    selected = group.isTrackSelected(i),
                    forced = (f.selectionFlags and C.SELECTION_FLAG_FORCED) != 0,
                )
            }
        }
        return out
    }

    /** The file's own name for a track, else its language, else a number. */
    fun label(f: Format, index: Int): String {
        val language = (f.language ?: "").takeUnless { it.isBlank() || it == C.LANGUAGE_UNDETERMINED }
        val named = language?.let { Locale.forLanguageTag(it).getDisplayLanguage(Locale.ENGLISH).takeIf { n -> n.isNotBlank() && n != it } ?: it }
        val own = f.label?.trim().orEmpty()
        val base = when {
            own.isNotEmpty() && named != null && !own.contains(named, ignoreCase = true) -> "$named · $own"
            own.isNotEmpty() -> own
            named != null -> named
            else -> "Subtitles ${index + 1}"
        }
        val forced = (f.selectionFlags and C.SELECTION_FLAG_FORCED) != 0
        return if (forced && !base.contains("forced", ignoreCase = true)) "$base (forced)" else base
    }

    /** "group:track" back to its numbers, or null for anything else. */
    fun parse(id: String): Pair<Int, Int>? {
        val parts = id.split(':')
        if (parts.size != 2) return null
        val g = parts[0].toIntOrNull() ?: return null
        val i = parts[1].toIntOrNull() ?: return null
        return if (g >= 0 && i >= 0) g to i else null
    }
}
