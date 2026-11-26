package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Locale
import kotlin.math.pow
import kotlin.math.roundToLong

data class PlaybackClient(
    val player: String,
    val maxHeight: Int? = null,
    val hevc: Boolean? = null,
    val hdr: Boolean? = null,
    val mkv: Boolean? = null,
) {
    companion object {
        private val VALID_PLAYERS = setOf("mpv", "html5", "exoplayer", "avplayer", "roku")

        fun parse(raw: JSONObject?): PlaybackClient? {
            if (raw == null) return null
            val player = raw.opt("player") as? String ?: return null
            if (player !in VALID_PLAYERS) return null
            val mh = Json.double(raw.opt("maxHeight"))?.takeIf { it.isFinite() && it > 0 }?.toInt()
            val hevc = raw.opt("hevc") as? Boolean
            val hdr = raw.opt("hdr") as? Boolean
            val mkv = raw.opt("mkv") as? Boolean
            return PlaybackClient(player = player, maxHeight = mh, hevc = hevc, hdr = hdr, mkv = mkv)
        }
    }
}

data class VersionAudio(
    val codec: String?,
    val channels: String?,
    val atmos: Boolean,
) {
    fun json(): JSONObject = Json.obj(
        "codec" to codec,
        "channels" to channels,
        "atmos" to atmos,
    )
}

data class VersionInfo(
    val id: String,
    val label: String,
    val height: Int?,
    val hdr: String?,
    val source: String,
    val codec: String?,
    val sizeBytes: Long?,
    val bitrateMbps: Double?,
    val audio: VersionAudio,
    val languages: List<String>,
    val upscaled: Boolean,
    val cached: Boolean,
    var recommended: Boolean = false,
) {
    fun json(): JSONObject = Json.obj(
        "id" to id,
        "label" to label,
        "height" to height,
        "hdr" to hdr,
        "source" to source,
        "codec" to codec,
        "sizeBytes" to sizeBytes,
        "bitrateMbps" to bitrateMbps,
        "audio" to audio.json(),
        "languages" to JSONArray(languages),
        "upscaled" to upscaled,
        "cached" to cached,
        "recommended" to recommended,
    )
}

data class RankedVersion(
    val stream: RdStream,
    val version: VersionInfo,
)

/**
 * Source inspection, capability matching, and version ranking.
 * Direct port of apps/core/src/providers/versions.ts and TVMVersions.swift.
 */
object TvmVersions {
    val POOR_RELEASE = Regex(
        """\b(?:cam|hdcam|camrip|telesync|telecine|hdts|hdtc|tsrip|ts|tc|screener|dvdscr|dvdscreener|scr|workprint)\b""",
        RegexOption.IGNORE_CASE,
    )
    private val UPSCALED = Regex(
        """\b(?:up[ ._-]?scal(?:e[ds]?|ing)|aius|ups|re[ ._-]?grad(?:e[ds]?|ing))\b""",
        RegexOption.IGNORE_CASE,
    )
    private val ISO: Map<String, String> = mapOf(
        "ar" to "ara", "be" to "bel", "bg" to "bul", "bn" to "ben", "ca" to "cat", "cs" to "ces", "cy" to "cym",
        "da" to "dan", "de" to "deu", "el" to "ell", "en" to "eng", "es" to "spa", "et" to "est", "eu" to "eus",
        "fa" to "fas", "fi" to "fin", "fr" to "fra", "ga" to "gle", "gl" to "glg", "gu" to "guj", "he" to "heb",
        "hi" to "hin", "hr" to "hrv", "hu" to "hun", "id" to "ind", "is" to "isl", "it" to "ita", "ja" to "jpn",
        "ka" to "kat", "kk" to "kaz", "km" to "khm", "kn" to "kan", "ko" to "kor", "lt" to "lit", "lv" to "lav",
        "mk" to "mkd", "ml" to "mal", "mr" to "mar", "ms" to "msa", "my" to "mya", "ne" to "nep", "nl" to "nld",
        "nb" to "nor", "no" to "nor", "pa" to "pan", "pl" to "pol", "pt" to "por", "ro" to "ron", "ru" to "rus",
        "sk" to "slk", "sl" to "slv", "sq" to "sqi", "sr" to "srp", "sv" to "swe", "sw" to "swa", "ta" to "tam",
        "te" to "tel", "th" to "tha", "tl" to "tgl", "tr" to "tur", "uk" to "ukr", "ur" to "urd", "vi" to "vie",
        "zh" to "zho", "zu" to "zul",
    )
    private val LEGACY: Map<String, String> = mapOf(
        "chi" to "zho", "cze" to "ces", "dut" to "nld", "fre" to "fra", "ger" to "deu", "gre" to "ell",
        "per" to "fas", "rum" to "ron", "slo" to "slk", "alb" to "sqi", "baq" to "eus", "bur" to "mya",
        "geo" to "kat", "ice" to "isl", "mac" to "mkd", "may" to "msa", "wel" to "cym",
        "mandarin" to "zho", "cantonese" to "yue",
    )
    private val NAMES: Map<String, String> = buildMap {
        val extras = mapOf(
            "arabic" to "ara", "belarusian" to "bel", "bulgarian" to "bul", "bengali" to "ben", "bangla" to "ben",
            "catalan" to "cat", "czech" to "ces", "welsh" to "cym", "danish" to "dan", "german" to "deu",
            "greek" to "ell", "english" to "eng", "spanish" to "spa", "estonian" to "est", "basque" to "eus",
            "persian" to "fas", "finnish" to "fin", "french" to "fra", "irish" to "gle", "galician" to "glg",
            "gujarati" to "guj", "hebrew" to "heb", "hindi" to "hin", "croatian" to "hrv", "hungarian" to "hun",
            "indonesian" to "ind", "icelandic" to "isl", "italian" to "ita", "japanese" to "jpn",
            "georgian" to "kat", "kazakh" to "kaz", "khmer" to "khm", "kannada" to "kan", "korean" to "kor",
            "lithuanian" to "lit", "latvian" to "lav", "macedonian" to "mkd", "malayalam" to "mal",
            "marathi" to "mar", "malay" to "msa", "burmese" to "mya", "nepali" to "nep", "dutch" to "nld",
            "norwegian" to "nor", "punjabi" to "pan", "polish" to "pol", "portuguese" to "por",
            "romanian" to "ron", "russian" to "rus", "slovak" to "slk", "slovenian" to "slv",
            "albanian" to "sqi", "serbian" to "srp", "swedish" to "swe", "swahili" to "swa", "tamil" to "tam",
            "telugu" to "tel", "thai" to "tha", "tagalog" to "tgl", "turkish" to "tur", "ukrainian" to "ukr",
            "urdu" to "urd", "vietnamese" to "vie", "chinese" to "zho", "zulu" to "zul",
        )
        putAll(extras)
        for ((two, three) in ISO) {
            val disp = Locale.forLanguageTag(two).getDisplayLanguage(Locale.ENGLISH).lowercase(Locale.US)
            if (disp.isNotEmpty() && disp != two) putIfAbsent(disp, three)
        }
    }
    private val ISO_VALUES = ISO.values.toSet()
    private val FLAGS: Map<String, String> = mapOf(
        "US" to "eng", "GB" to "eng", "FR" to "fra", "DE" to "deu", "ES" to "spa", "MX" to "spa",
        "IT" to "ita", "BR" to "por", "PT" to "por", "JP" to "jpn", "KR" to "kor", "CN" to "zho",
        "TW" to "zho", "HK" to "yue", "RU" to "rus", "UA" to "ukr", "PL" to "pol", "TR" to "tur",
        "NL" to "nld", "SE" to "swe", "DK" to "dan", "FI" to "fin", "NO" to "nor", "CZ" to "ces",
        "HU" to "hun", "RO" to "ron", "GR" to "ell", "IL" to "heb", "IR" to "fas", "SA" to "ara",
        "TH" to "tha", "VN" to "vie", "ID" to "ind",
    )
    private val SOURCE_RANK: Map<String, Int> = mapOf(
        "remux" to 5, "bluray" to 4, "web-dl" to 3, "webrip" to 2, "hdtv" to 1, "other" to 0,
    )
    private val SOURCE_LABEL: Map<String, String> = mapOf(
        "remux" to "REMUX", "bluray" to "BluRay", "web-dl" to "WEB-DL", "webrip" to "WEBRip", "hdtv" to "HDTV", "other" to "",
    )
    private val NON_ALPHA = Regex("[^A-Za-z]+")
    private val RES_SPLIT = Regex("(?:2160p|1080p|720p|480p|\\b4k\\b)", RegexOption.IGNORE_CASE)
    private val HOURS_RE = Regex("(\\d+(?:\\.\\d+)?)\\s*h", RegexOption.IGNORE_CASE)
    private val MINS_RE = Regex("(\\d+(?:\\.\\d+)?)\\s*m", RegexOption.IGNORE_CASE)
    private val DIGITS_RE = Regex("^\\d+$")
    private val FOUR_K_RE = Regex("\\b(?:4k|uhd|2160p)\\b", RegexOption.IGNORE_CASE)
    private val HEIGHT_RE = Regex("\\b(1440|1080|720|576|480|360)[pi]\\b", RegexOption.IGNORE_CASE)
    private val DV_RE = Regex("\\b(?:dv|dovi|dolby[ ._-]?vision)\\b", RegexOption.IGNORE_CASE)
    private val HDR10PLUS_RE = Regex("\\bhdr10(?:\\+|plus)", RegexOption.IGNORE_CASE)
    private val HLG_RE = Regex("\\bhlg\\b", RegexOption.IGNORE_CASE)
    private val HDR_RE = Regex("\\bhdr(?:10)?\\b", RegexOption.IGNORE_CASE)
    private val REMUX_RE = Regex("\\bremux\\b", RegexOption.IGNORE_CASE)
    private val BLURAY_RE = Regex("\\b(?:blu[ ._-]?ray|bdrip|brrip)\\b", RegexOption.IGNORE_CASE)
    private val WEBDL_RE = Regex("\\bweb[ ._-]?dl\\b", RegexOption.IGNORE_CASE)
    private val WEBRIP_RE = Regex("\\bweb[ ._-]?rip\\b", RegexOption.IGNORE_CASE)
    private val HDTV_RE = Regex("\\bhdtv\\b", RegexOption.IGNORE_CASE)
    private val HEVC_RE = Regex("\\b(?:hevc|[xh][ ._-]?265)\\b", RegexOption.IGNORE_CASE)
    private val AVC_RE = Regex("\\b(?:avc|[xh][ ._-]?264)\\b", RegexOption.IGNORE_CASE)
    private val AV1_RE = Regex("\\bav1\\b", RegexOption.IGNORE_CASE)
    private val VP9_RE = Regex("\\bvp9\\b", RegexOption.IGNORE_CASE)
    private val VP8_RE = Regex("\\bvp8\\b", RegexOption.IGNORE_CASE)
    private val AUDIO_CODEC_RE = Regex(
        "\\b(true[ ._-]?hd|dts[ ._-]?hd(?:[ ._-]?ma)?|dts[ ._-]?x|dts|ddp|eac3|dd\\+|aac|ac3|flac|opus)(?=\\b|\\d)",
        RegexOption.IGNORE_CASE,
    )
    private val CHANNELS_RE = Regex("\\b([257]\\.1|2\\.0|1\\.0)\\b")
    private val ATMOS_RE = Regex("\\batmos\\b", RegexOption.IGNORE_CASE)
    private val SIZE_RE = Regex("\\b(\\d+(?:[.,]\\d+)?)\\s*([kmgt])(?:i)?b\\b", RegexOption.IGNORE_CASE)
    private val MKV_RE = Regex("\\.mkv\\b", RegexOption.IGNORE_CASE)
    private val WEBM_AVI_RE = Regex("\\.(?:webm|avi)\\b", RegexOption.IGNORE_CASE)
    private val WEBM_AVI_MOV_RE = Regex("\\.(?:webm|avi|mov)\\b", RegexOption.IGNORE_CASE)
    private val DUB_RE = Regex("\\b(?:dub(?:bed)?|fandub)\\b", RegexOption.IGNORE_CASE)
    private val DUAL_MULTI_RE = Regex("\\b(?:dual|multi)\\b", RegexOption.IGNORE_CASE)
    private val HLS_URL_RE = Regex("\\.m3u8(?:\\?|$)", RegexOption.IGNORE_CASE)
    private val THREE_LETTER = Regex("^[a-z]{3}$")

    /** A release that says it is an upscale or re-grade of a smaller source. */
    fun isUpscaled(stream: RdStream): Boolean =
        UPSCALED.containsMatchIn(stream.details.ifEmpty { "${stream.name} ${stream.title}" })

    fun languageCode(value: String?): String? {
        if (value == null) return null
        val code = value.trim().lowercase(Locale.US)
        if (code.isEmpty()) return null
        return LEGACY[code] ?: ISO[code] ?: NAMES[code] ?: if (THREE_LETTER.matches(code)) code else null
    }

    fun releaseLanguages(release: String, title: String): List<String> {
        val languages = LinkedHashSet<String>()
        var idx = 0
        while (idx < release.length) {
            val cp1 = release.codePointAt(idx)
            val c1 = Character.charCount(cp1)
            if (cp1 in 0x1f1e6..0x1f1ff && idx + c1 < release.length) {
                val cp2 = release.codePointAt(idx + c1)
                if (cp2 in 0x1f1e6..0x1f1ff) {
                    val country = "${(cp1 - 0x1f1e6 + 65).toChar()}${(cp2 - 0x1f1e6 + 65).toChar()}"
                    FLAGS[country]?.let { languages.add(it) }
                    idx += c1 + Character.charCount(cp2)
                    continue
                }
            }
            idx += c1
        }
        val tags = release.replace(title, "").split(NON_ALPHA)
        val parts = RES_SPLIT.split(title)
        val fileTags = if (parts.size > 1) parts.drop(1).joinToString(" ").split(NON_ALPHA) else emptyList()
        for (tag in tags + fileTags) {
            val code = tag.lowercase(Locale.US)
            if (code.isEmpty()) continue
            val language = NAMES[code] ?: LEGACY[code] ?: if (code in ISO_VALUES) code else null
            if (language != null) languages.add(language)
        }
        return languages.toList()
    }

    fun runtimeSeconds(value: String?): Double? {
        if (value.isNullOrBlank()) return null
        val hours = HOURS_RE.find(value)?.groupValues?.get(1)?.toDoubleOrNull() ?: 0.0
        val minutes = MINS_RE.find(value)?.groupValues?.get(1)?.toDoubleOrNull()
            ?: if (DIGITS_RE.matches(value.trim())) value.trim().toDoubleOrNull() ?: 0.0 else 0.0
        val total = hours * 60.0 + minutes
        return if (total > 0.0) total * 60.0 else null
    }

    fun qualityCap(quality: String): Int = when (quality) {
        "original" -> Int.MAX_VALUE
        "saver" -> 720
        else -> quality.toIntOrNull() ?: Int.MAX_VALUE
    }

    fun supportsVersion(version: VersionInfo, filename: String, client: PlaybackClient?): Boolean {
        if (client == null) return true
        val maxH = client.maxHeight ?: Int.MAX_VALUE
        if (version.height != null && version.height > maxH) return false
        val mpv = client.player == "mpv"
        val avplayer = client.player == "avplayer"
        val exoplayer = client.player == "exoplayer"
        if (version.codec == "hevc" && !(client.hevc ?: (mpv || avplayer))) return false
        if (version.hdr != null && !(client.hdr ?: mpv)) return false
        if (MKV_RE.containsMatchIn(filename) && !(client.mkv ?: (mpv || exoplayer))) return false
        if (avplayer && (version.codec in setOf("av1", "vp9", "vp8") || WEBM_AVI_RE.containsMatchIn(filename))) return false
        if (client.player == "roku" && (version.codec in setOf("av1", "vp9", "vp8") || WEBM_AVI_MOV_RE.containsMatchIn(filename))) return false
        return true
    }

    fun describeVersion(stream: RdStream, seconds: Double?): VersionInfo {
        val release = stream.details.ifEmpty { "${stream.name} ${stream.title}".trim() }
        val height: Int? = if (FOUR_K_RE.containsMatchIn(release)) {
            2160
        } else {
            HEIGHT_RE.find(release)?.groupValues?.get(1)?.toIntOrNull()
        }
        val hdr: String? = when {
            DV_RE.containsMatchIn(release) -> "dv"
            HDR10PLUS_RE.containsMatchIn(release) -> "hdr10+"
            HLG_RE.containsMatchIn(release) -> "hlg"
            HDR_RE.containsMatchIn(release) -> "hdr10"
            else -> null
        }
        val source: String = when {
            REMUX_RE.containsMatchIn(release) -> "remux"
            BLURAY_RE.containsMatchIn(release) -> "bluray"
            WEBDL_RE.containsMatchIn(release) -> "web-dl"
            WEBRIP_RE.containsMatchIn(release) -> "webrip"
            HDTV_RE.containsMatchIn(release) -> "hdtv"
            else -> "other"
        }
        val codec: String? = when {
            HEVC_RE.containsMatchIn(release) -> "hevc"
            AVC_RE.containsMatchIn(release) -> "h264"
            AV1_RE.containsMatchIn(release) -> "av1"
            VP9_RE.containsMatchIn(release) -> "vp9"
            VP8_RE.containsMatchIn(release) -> "vp8"
            else -> null
        }
        val audioMatch = AUDIO_CODEC_RE.find(release)?.groupValues?.get(1)
        val audio = VersionAudio(
            codec = audioMatch?.lowercase(Locale.US)?.replace(Regex("[ ._]"), "-"),
            channels = CHANNELS_RE.find(release)?.groupValues?.get(1),
            atmos = ATMOS_RE.containsMatchIn(release),
        )
        val sizeMatch = SIZE_RE.find(release)
        val sizeBytes: Long? = if (sizeMatch != null) {
            val raw = sizeMatch.groupValues[1].replace(',', '.').toDoubleOrNull()
            val exp = "kmgt".indexOf(sizeMatch.groupValues[2].lowercase(Locale.US)) + 1
            if (raw != null && exp > 0) (raw * 1024.0.pow(exp)).roundToLong() else null
        } else {
            null
        }
        val bitrateMbps: Double? = if (sizeBytes != null && seconds != null && seconds > 0.0) {
            (sizeBytes.toDouble() * 80.0 / seconds / 1_000_000.0).roundToLong() / 10.0
        } else {
            null
        }
        val hdrLabel = if (hdr == "dv") "Dolby Vision" else hdr?.uppercase(Locale.US)
        val parts = listOfNotNull(
            when (height) {
                2160 -> "4K"
                null -> null
                else -> "${height}p"
            },
            hdrLabel,
            SOURCE_LABEL[source]?.ifEmpty { null },
            bitrateMbps?.let { "$it Mb/s" },
        )
        val label = if (parts.isNotEmpty()) parts.joinToString(" \u00b7 ") else stream.title
        val keyTail = stream.releaseId
            ?: stream.url.substringBefore("?").replace(Regex("realdebrid=[^/]+", RegexOption.IGNORE_CASE), "realdebrid")
        val id = hashId(stream.title, release, keyTail)
        return VersionInfo(
            id = id,
            label = label,
            height = height,
            hdr = hdr,
            source = source,
            codec = codec,
            sizeBytes = sizeBytes,
            bitrateMbps = bitrateMbps,
            audio = audio,
            languages = releaseLanguages(release, stream.title),
            upscaled = UPSCALED.containsMatchIn(release),
            cached = stream.cached,
            recommended = false,
        )
    }

    private fun hashId(title: String, release: String, keyTail: String): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(title.toByteArray(Charsets.UTF_8))
        digest.update(byteArrayOf(0))
        digest.update(release.toByteArray(Charsets.UTF_8))
        digest.update(byteArrayOf(0))
        digest.update(keyTail.toByteArray(Charsets.UTF_8))
        val hex = StringBuilder(24)
        for (b in digest.digest().take(12)) {
            val v = b.toInt() and 0xff
            hex.append("0123456789abcdef"[v ushr 4])
            hex.append("0123456789abcdef"[v and 0x0f])
        }
        return hex.toString()
    }

    /** Capabilities supplied by the page can narrow the phone's decoders, never widen them. */
    fun rankForPhone(streams: List<RdStream>, prefs: TvmPrefs, originalLanguage: String?, runtime: Double?, maxHeight: Int, client: PlaybackClient?, caps: DecoderCaps): List<RankedVersion> {
        val phone = PlaybackClient("exoplayer", maxHeight, caps.hevc, caps.hevc10 || caps.dolbyVision, true)
        val safe = streams.filter { stream ->
            val version = describeVersion(stream, runtime)
            val label = "${stream.name} ${stream.title} ${stream.details}"
            val needs = TvmPlaybackChoice.needs(label, version.height ?: 1080)
            TvmPlaybackChoice.videoPlayable(needs, caps) && TvmPlaybackChoice.audioPlayable(needs, caps) &&
                supportsVersion(version, label + " " + stream.url, client)
        }
        return rankVersions(safe, prefs, originalLanguage, runtime, maxHeight, phone)
    }

    fun rankVersions(
        streams: List<RdStream>,
        prefs: TvmPrefs,
        originalLanguage: String?,
        runtime: Double?,
        maxHeight: Int,
        client: PlaybackClient? = null,
    ): List<RankedVersion> {
        val cap = minOf(maxHeight, client?.maxHeight ?: Int.MAX_VALUE, qualityCap(prefs.quality))
        val preferred = if (prefs.audioLanguage == "original") originalLanguage else languageCode(prefs.audioLanguage)
        fun match(v: VersionInfo): Int = if (preferred != null && preferred in v.languages) 1 else 0
        val seen = HashSet<String>()
        val eligible = ArrayList<RankedVersion>()
        for (stream in streams) {
            val combinedTitle = "${stream.name} ${stream.title}"
            if (POOR_RELEASE.containsMatchIn(stream.title) || POOR_RELEASE.containsMatchIn(combinedTitle) ||
                HLS_URL_RE.containsMatchIn(stream.url)
            ) {
                continue
            }
            val v = describeVersion(stream, runtime)
            if ((v.height ?: 1080) > cap || (v.upscaled && (prefs.skipUpscaled || prefs.quality == "original"))) continue
            if (!supportsVersion(v, "${stream.title} ${stream.url}", client)) continue
            if (originalLanguage != null && prefs.audioLanguage == "original" && (
                    (v.languages.isNotEmpty() && originalLanguage !in v.languages) ||
                        (v.languages.isEmpty() && DUB_RE.containsMatchIn(combinedTitle) && !DUAL_MULTI_RE.containsMatchIn(combinedTitle))
                    )
            ) {
                continue
            }
            if (!seen.add(v.id)) continue
            eligible.add(RankedVersion(stream, v))
        }
        eligible.sortWith { aRow, bRow ->
            val a = aRow.version
            val b = bRow.version
            val m = match(b) - match(a)
            if (m != 0) return@sortWith m
            if (prefs.quality == "saver") {
                val sa = a.sizeBytes ?: Long.MAX_VALUE
                val sb = b.sizeBytes ?: Long.MAX_VALUE
                if (sa != sb) return@sortWith sa.compareTo(sb)
                val ha = a.height ?: 1080
                val hb = b.height ?: 1080
                if (ha != hb) return@sortWith ha.compareTo(hb)
            } else {
                val hb = b.height ?: 1080
                val ha = a.height ?: 1080
                if (hb != ha) return@sortWith hb.compareTo(ha)
                val sb = SOURCE_RANK[b.source] ?: 0
                val sa = SOURCE_RANK[a.source] ?: 0
                if (sb != sa) return@sortWith sb.compareTo(sa)
                val bb = b.bitrateMbps ?: b.sizeBytes?.toDouble() ?: 0.0
                val ba = a.bitrateMbps ?: a.sizeBytes?.toDouble() ?: 0.0
                if (bb != ba) return@sortWith bb.compareTo(ba)
            }
            if (b.cached != a.cached) (if (b.cached) -1 else 1) else 0
        }
        if (eligible.isNotEmpty()) eligible[0].version.recommended = true
        return eligible
    }
}
