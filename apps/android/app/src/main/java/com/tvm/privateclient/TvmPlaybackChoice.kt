package com.tvm.privateclient

import android.content.res.Resources
import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.util.Log

/**
 * Which copy of a title this device can actually play.
 *
 * A debrid search returns many copies of the same episode: 4K remuxes, HDR,
 * Dolby Vision, HEVC, H.264, with TrueHD, DTS or Dolby Digital sound. Picking
 * the "best" one by resolution alone chose 4K remuxes on phones, which either
 * failed in the decoder ("This phone can't play the video in this copy
 * (4K · H.264)") or never got a first frame over a phone connection: a black
 * screen with no sound. This decides from the phone's real decoders and its
 * screen instead, and remembers copies that failed so a retry moves on.
 */
data class DecoderCaps(
    val avc4k: Boolean,
    val hevc: Boolean,
    val hevc4k: Boolean,
    val hevc10: Boolean,
    val av1: Boolean,
    val dolbyVision: Boolean,
    val trueHd: Boolean,
    val dts: Boolean,
    val eac3: Boolean,
    val ac3: Boolean,
) {
    fun summary(): String = listOf(
        "avc4k" to avc4k, "hevc" to hevc, "hevc4k" to hevc4k, "hevc10" to hevc10, "av1" to av1,
        "dv" to dolbyVision, "truehd" to trueHd, "dts" to dts, "eac3" to eac3, "ac3" to ac3,
    ).joinToString(" ") { (name, ok) -> "$name=${if (ok) "yes" else "no"}" }

    companion object {
        /** Everything; for tests and for builds where the codec list cannot be read. */
        val ALL = DecoderCaps(true, true, true, true, true, true, true, true, true, true)
    }
}

/** What a copy's name says it needs. Unknown parts are assumed to be fine. */
data class SourceNeeds(
    val height: Int,
    val codec: String?,
    val tenBit: Boolean,
    val dolbyVisionOnly: Boolean,
    val audio: Set<String>,
    val remux: Boolean,
)

object TvmPlaybackChoice {
    private val HEVC = Regex("""\b(x\.?265|h\.?265|hevc)\b""", RegexOption.IGNORE_CASE)
    private val AVC = Regex("""\b(x\.?264|h\.?264|avc)\b""", RegexOption.IGNORE_CASE)
    private val AV1 = Regex("""\bav1\b""", RegexOption.IGNORE_CASE)
    private val DV = Regex("""\b(dv|dovi|dolby[ .]?vision)\b""", RegexOption.IGNORE_CASE)
    private val HDR = Regex("""\b(hdr|hdr10\+?|hdr10plus)\b""", RegexOption.IGNORE_CASE)
    private val TEN_BIT = Regex("""\b10[ .-]?bit\b""", RegexOption.IGNORE_CASE)
    private val TRUEHD = Regex("""\btrue[ .-]?hd\b""", RegexOption.IGNORE_CASE)
    private val DTS = Regex("""\bdts(-?hd|-?x|-?ma)?\b""", RegexOption.IGNORE_CASE)
    private val EAC3 = Regex("""\b(ddp|dd\+|e-?ac-?3|eac3)""", RegexOption.IGNORE_CASE)
    private val AC3 = Regex("""\b(ac-?3|dd[ .]?[25]\.[01]|dolby[ .]digital)\b""", RegexOption.IGNORE_CASE)
    private val AAC = Regex("""\b(aac|opus|mp3|flac)\b""", RegexOption.IGNORE_CASE)
    private val REMUX = Regex("""\bremux\b""", RegexOption.IGNORE_CASE)

    fun needs(label: String, height: Int): SourceNeeds {
        val codec = when {
            AV1.containsMatchIn(label) -> "av1"
            HEVC.containsMatchIn(label) -> "hevc"
            AVC.containsMatchIn(label) -> "avc"
            else -> null
        }
        val dv = DV.containsMatchIn(label)
        val hdr = HDR.containsMatchIn(label)
        val audio = buildSet {
            if (TRUEHD.containsMatchIn(label)) add("truehd")
            if (DTS.containsMatchIn(label)) add("dts")
            if (EAC3.containsMatchIn(label)) add("eac3")
            if (AC3.containsMatchIn(label)) add("ac3")
            if (AAC.containsMatchIn(label)) add("aac")
        }
        return SourceNeeds(
            height = height,
            codec = codec,
            // HDR and Dolby Vision video is 10-bit.
            tenBit = TEN_BIT.containsMatchIn(label) || hdr || dv,
            // Dolby Vision without an HDR10 base layer shows green and purple, or
            // nothing, on a phone without a Dolby Vision decoder.
            dolbyVisionOnly = dv && !hdr,
            audio = audio,
            remux = REMUX.containsMatchIn(label),
        )
    }

    /** False when this device's decoders cannot show the picture. */
    fun videoPlayable(needs: SourceNeeds, caps: DecoderCaps): Boolean {
        if (needs.dolbyVisionOnly && !caps.dolbyVision) return false
        val uhd = needs.height >= 2160
        return when (needs.codec) {
            "av1" -> caps.av1
            "hevc" -> caps.hevc && (!uhd || caps.hevc4k) && (!needs.tenBit || caps.hevc10)
            "avc" -> !uhd || caps.avc4k
            // Codec not named: 4K is almost always HEVC.
            else -> !uhd || caps.hevc4k
        }
    }

    /** False when every sound track the name mentions needs a decoder this device lacks. */
    fun audioPlayable(needs: SourceNeeds, caps: DecoderCaps): Boolean {
        if (needs.audio.isEmpty()) return true
        return needs.audio.any { kind ->
            when (kind) {
                "truehd" -> caps.trueHd
                "dts" -> caps.dts
                "eac3" -> caps.eac3
                "ac3" -> caps.ac3
                else -> true
            }
        }
    }

    /**
     * Copies in the order to try: ones this device can play fully first, then
     * ones whose sound may not play, and copies it cannot decode at all last
     * (only if nothing else exists). Within a group the given order (quality,
     * then cached) is kept, except that a remux, which is several times the
     * size for the same picture, goes after a regular copy.
     */
    fun <T> order(items: List<T>, label: (T) -> String, height: (T) -> Int, caps: DecoderCaps): List<T> {
        fun rank(item: T): Int {
            val needs = needs(label(item), height(item))
            if (!videoPlayable(needs, caps)) return 3
            if (!audioPlayable(needs, caps)) return 2
            return if (needs.remux) 1 else 0
        }
        return items.withIndex().sortedWith(compareBy({ rank(it.value) }, { it.index })).map { it.value }
    }
}

/** The device's own decoders and screen, read once. */
object TvmDeviceCodecs {
    private const val TAG = "TVMPlayer"

    val caps: DecoderCaps by lazy {
        runCatching { read() }.onFailure { Log.w(TAG, "codec list unavailable", it) }.getOrDefault(DecoderCaps.ALL)
            .also { Log.i(TAG, "decoders: ${it.summary()}") }
    }

    /**
     * The tallest picture worth fetching for this screen. A phone's screen is at
     * most about 1440 pixels across its short side, so a 1080p copy already
     * fills it; a 4K copy costs four times the data for nothing visible. A
     * tablet or television with a 4K-class panel and a 4K decoder gets 4K.
     */
    val screenHeight: Int by lazy {
        val metrics = Resources.getSystem().displayMetrics
        val short = minOf(metrics.widthPixels, metrics.heightPixels)
        if (short >= 2000 && (caps.hevc4k || caps.avc4k)) 2160 else 1080
    }

    private fun read(): DecoderCaps {
        val decoders = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { !it.isEncoder }
        fun of(mime: String) = decoders.filter { info -> info.supportedTypes.any { it.equals(mime, ignoreCase = true) } }
        fun video4k(mime: String) = of(mime).any { info ->
            runCatching { info.getCapabilitiesForType(mime).videoCapabilities?.isSizeSupported(3840, 2160) == true }.getOrDefault(false)
        }
        val hevc = of("video/hevc")
        val hevc10 = hevc.any { info ->
            runCatching {
                info.getCapabilitiesForType("video/hevc").profileLevels.any {
                    it.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10 ||
                        it.profile == MediaCodecInfo.CodecProfileLevel.HEVCProfileMain10HDR10
                }
            }.getOrDefault(false)
        }
        return DecoderCaps(
            avc4k = video4k("video/avc"),
            hevc = hevc.isNotEmpty(),
            hevc4k = video4k("video/hevc"),
            hevc10 = hevc10,
            av1 = of("video/av01").isNotEmpty(),
            dolbyVision = of("video/dolby-vision").isNotEmpty(),
            trueHd = of("audio/true-hd").isNotEmpty(),
            dts = of("audio/vnd.dts").isNotEmpty() || of("audio/vnd.dts.hd").isNotEmpty(),
            eac3 = of("audio/eac3").isNotEmpty() || of("audio/eac3-joc").isNotEmpty(),
            ac3 = of("audio/ac3").isNotEmpty(),
        )
    }
}

/**
 * Copies that failed on this device, so the next attempt at the same title
 * (the player's own automatic retry, or Retry) tries a different one instead
 * of reopening the copy that just failed. Kept in memory for six hours.
 */
object TvmPlaybackMemory {
    private const val KEEP_MS = 6 * 60 * 60 * 1000L
    private val lock = Any()
    /** Stream URL handed to the player → the copy it came from. */
    private val served = LinkedHashMap<String, String>()
    private val failed = HashMap<String, Long>()

    fun served(url: String, source: String) = synchronized(lock) {
        served[url] = source
        while (served.size > 64) served.remove(served.keys.first())
    }

    /** The copy behind [url] cannot be played here. */
    fun failed(url: String, why: String) = synchronized(lock) {
        val source = served[url] ?: url
        failed[source] = System.currentTimeMillis()
        Log.w("TVMPlayer", "source marked unplayable ($why): ${source.take(80)}")
    }

    fun hasFailed(source: String): Boolean = synchronized(lock) {
        val at = failed[source] ?: return false
        if (System.currentTimeMillis() - at > KEEP_MS) { failed.remove(source); return false }
        true
    }

    fun clear() = synchronized(lock) { served.clear(); failed.clear() }
}
