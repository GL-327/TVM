package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.util.Locale

/**
 * Shared vocabulary for the standalone Android client.
 *
 * This is a direct port of apps/ios/TVM/TVMModels.swift and must stay
 * behaviour-identical to it: both clients are served the same `apps/ui`
 * interface and must answer its API the same way. Where the Swift uses
 * `[String: Any]` + JSONSerialization, this uses org.json, which ships with
 * Android and needs no dependency.
 */

object StandalonePolicy {
    const val REQUIRES_LAN_TOKEN = false
    val BUNDLED_LAN_TOKEN: String? = null
    const val VERSION = "1.0.0"

    /**
     * What this build's native code provides to the interface. Bump it, and
     * scripts/native-api.json, when the interface starts relying on a new
     * native route; an interface that needs more is never applied here.
     * Same value as StandalonePolicy.nativeAPI in the iOS app.
     */
    const val NATIVE_API = 2

    enum class Mode { ON_DEVICE, OPTIONAL_HOME_CORE }

    val DEFAULT_MODE = Mode.ON_DEVICE

    fun localOrigin(port: Int): String = "http://127.0.0.1:$port/"
}

/**
 * `optString` without Android's trap.
 *
 * On a device, `JSONObject.optString` turns a JSON null into the four letters
 * "null" — the JVM's org.json, which the unit tests run against, returns the
 * fallback instead, so the difference never showed up in a test. On a phone it
 * made a null tier read as present and a null synopsis print as "null". Every
 * string read in this app goes through these two instead.
 */
fun JSONObject.text(name: String, fallback: String = ""): String = when (val value = opt(name)) {
    null, JSONObject.NULL -> fallback
    is String -> value
    else -> value.toString()
}

fun JSONArray.text(index: Int, fallback: String = ""): String = when (val value = opt(index)) {
    null, JSONObject.NULL -> fallback
    is String -> value
    else -> value.toString()
}

/** JSON coercion helpers. org.json hands back boxed numbers and JSONObject.NULL. */
object Json {
    fun obj(vararg pairs: Pair<String, Any?>): JSONObject {
        val out = JSONObject()
        for ((key, value) in pairs) out.put(key, value ?: JSONObject.NULL)
        return out
    }

    fun parseObject(text: String?): JSONObject {
        if (text.isNullOrBlank()) return JSONObject()
        return runCatching { JSONObject(text) }.getOrElse { JSONObject() }
    }

    fun array(values: List<JSONObject>): JSONArray {
        val out = JSONArray()
        for (value in values) out.put(value)
        return out
    }

    fun strings(value: Any?): List<String> {
        val array = value as? JSONArray ?: return emptyList()
        return (0 until array.length()).mapNotNull { array.text(it, "").ifBlank { null } }
    }

    /** Mirrors JSONValue.int: accepts numbers and numeric strings, rejects NULL. */
    fun int(value: Any?): Int? = when (value) {
        null, JSONObject.NULL -> null
        is Int -> value
        is Long -> value.toInt()
        is Double -> value.toInt()
        is Float -> value.toInt()
        is Number -> value.toInt()
        is String -> value.trim().toIntOrNull()
        else -> null
    }

    fun double(value: Any?): Double? = when (value) {
        null, JSONObject.NULL -> null
        is Number -> value.toDouble()
        is String -> value.trim().toDoubleOrNull()
        else -> null
    }

    fun string(value: Any?): String? {
        val text = value as? String ?: return null
        val trimmed = text.trim()
        return trimmed.ifEmpty { null }
    }

    fun bool(value: Any?, fallback: Boolean): Boolean = when (value) {
        is Boolean -> value
        is Number -> value.toInt() != 0
        is String -> value.equals("true", ignoreCase = true) || value == "1"
        else -> fallback
    }

    /** Percent-encoding matching JSONValue.formEncode: unreserved characters only. */
    fun formEncode(value: String): String {
        val allowed = "-._~"
        val out = StringBuilder()
        for (byte in value.toByteArray(Charsets.UTF_8)) {
            val ch = byte.toInt().toChar()
            if (ch.isLetterOrDigit() && ch.code < 128 || allowed.indexOf(ch) >= 0) {
                out.append(ch)
            } else {
                out.append('%').append(String.format(Locale.US, "%02X", byte.toInt() and 0xFF))
            }
        }
        return out.toString()
    }
}

data class MediaItem(
    val id: String,
    val title: String,
    val year: Int? = null,
    val kind: String = "movie",
    val synopsis: String = "",
    val poster: String = "",
    val backdrop: String = "",
    val genres: List<String> = emptyList(),
    val rating: String = "",
    val runtime: String? = null,
    val playable: Boolean = true,
    val progress: Double? = null,
    val filename: String? = null,
    val hue: Int = 0,
    val mimeType: String? = null,
    val season: Int? = null,
    val episode: Int? = null,
    val episodeName: String? = null,
    val showTitle: String? = null,
    val aired: String? = null,
    val added: String? = null,
) {
    fun json(): JSONObject {
        val body = Json.obj(
            "id" to id,
            "title" to title,
            "year" to year,
            "kind" to kind,
            "synopsis" to synopsis,
            "poster" to poster,
            "backdrop" to backdrop,
            "genres" to JSONArray(genres),
            "rating" to rating,
            "playable" to playable,
            "hue" to hue,
        )
        // Optional keys are omitted entirely rather than sent as null, exactly
        // as the Swift does; the interface distinguishes absent from null.
        runtime?.let { body.put("runtime", it) }
        progress?.let { body.put("progress", it) }
        filename?.let { body.put("filename", it) }
        mimeType?.let { body.put("mimeType", it) }
        season?.let { body.put("season", it) }
        episode?.let { body.put("episode", it) }
        episodeName?.let { body.put("episodeName", it) }
        showTitle?.let { body.put("showTitle", it) }
        aired?.let { body.put("aired", it) }
        added?.let { body.put("added", it) }
        return body
    }

    companion object {
        fun parse(raw: Any?): MediaItem? {
            val o = raw as? JSONObject ?: return null
            val id = Json.string(o.opt("id")) ?: return null
            val title = Json.string(o.opt("title")) ?: return null
            return MediaItem(
                id = id,
                title = title,
                year = Json.int(o.opt("year")),
                kind = Json.string(o.opt("kind")) ?: "movie",
                synopsis = o.text("synopsis", ""),
                poster = o.text("poster", ""),
                backdrop = o.text("backdrop", ""),
                genres = Json.strings(o.opt("genres")),
                rating = o.text("rating", ""),
                runtime = Json.string(o.opt("runtime")),
                playable = Json.bool(o.opt("playable"), true),
                progress = Json.double(o.opt("progress")),
                filename = Json.string(o.opt("filename")),
                hue = Json.int(o.opt("hue")) ?: TvmTitle.hue(title),
                mimeType = Json.string(o.opt("mimeType")),
                season = Json.int(o.opt("season")),
                episode = Json.int(o.opt("episode")),
                episodeName = Json.string(o.opt("episodeName")),
                showTitle = Json.string(o.opt("showTitle")),
                aired = Json.string(o.opt("aired")),
                added = Json.string(o.opt("added")),
            )
        }
    }
}

data class CatalogRail(val id: String, val title: String, val items: List<MediaItem>) {
    fun json(): JSONObject = Json.obj(
        "id" to id,
        "title" to title,
        "items" to Json.array(items.map { it.json() }),
    )
}

data class RdStatus(
    val configured: Boolean,
    val username: String? = null,
    val premium: Boolean = false,
    val error: String? = null,
) {
    fun json(): JSONObject = Json.obj(
        "configured" to configured,
        "username" to username,
        "premium" to premium,
        "error" to error,
    )
}

data class ProfileRecord(val id: String, val name: String, val hue: Int, val created: String) {
    fun json(): JSONObject = Json.obj("id" to id, "name" to name, "hue" to hue, "created" to created)
}

data class ProgressEntry(
    val position: Double,
    val duration: Double,
    val updated: String,
    val completedAt: String? = null,
    val completions: Int = 0,
) {
    val isFinished: Boolean
        get() = position.isFinite() && duration.isFinite() && duration > 0 && position / duration > 0.96
}

/**
 * Format decisions.
 *
 * The iOS client asks libVLC; Android asks Media3/ExoPlayer, which decodes
 * Matroska, WebM and MPEG-TS natively. The rules below stay identical to the
 * Swift so that both clients agree on what needs a server-side converter.
 */
object TvmPlayback {
    private val MATROSKA = Regex("""\.(mkv|webm|avi|ts|m2ts)($|\?)""", RegexOption.IGNORE_CASE)
    private val MATROSKA_NAME = Regex("""\.(mkv|webm|avi|ts|m2ts)$""", RegexOption.IGNORE_CASE)
    private val MP4_URL = Regex("""\.(mp4|m4v|mov)($|\?)""", RegexOption.IGNORE_CASE)
    private val MP4_NAME = Regex("""\.(mp4|m4v|mov|m3u8)$""", RegexOption.IGNORE_CASE)
    private val HLS_URL = Regex("""\.m3u8($|\?)""", RegexOption.IGNORE_CASE)

    fun nativeCanOpen(raw: String): Boolean {
        val uri = runCatching { URI(raw) }.getOrNull() ?: return false
        val host = uri.host
        if (host.isNullOrEmpty()) return false
        return uri.scheme?.lowercase(Locale.US) in setOf("http", "https")
    }

    fun phoneCanPlay(filename: String, mimeType: String?, url: String): Boolean {
        val mime = mimeType?.lowercase(Locale.US) ?: ""
        if (mime.contains("mpegurl") || mime.contains("x-mpegurl")) return true
        if (HLS_URL.containsMatchIn(url)) return true
        // Some providers label every download video/mp4, including Matroska.
        if (MATROSKA_NAME.containsMatchIn(filename) || MATROSKA.containsMatchIn(url)) return false
        if (mime.startsWith("video/mp4") || mime == "video/x-m4v" || mime.startsWith("video/quicktime")) return true
        if (MP4_URL.containsMatchIn(url)) return true
        if (MP4_NAME.containsMatchIn(filename)) return true
        return false
    }

    fun needsConverter(filename: String, mimeType: String?, url: String): Boolean =
        !phoneCanPlay(filename, mimeType, url)

    /** Real-Debrid transcode buckets. WebM is a separate format and never MP4. */
    fun appleTranscode(root: JSONObject, maxHeight: Int): Pair<String, String>? {
        for (group in listOf("apple", "liveMP4")) {
            val bucket = root.optJSONObject(group) ?: continue
            val qualities = bucket.keys().asSequence()
                .mapNotNull { key ->
                    val height = key.replace("p", "").toIntOrNull()
                    if (height == null || height <= 0 || height > maxHeight) null else key to height
                }
                .sortedByDescending { it.second }
                .toList()
            for ((key, _) in qualities) {
                val value = Json.string(bucket.opt(key)) ?: continue
                if (!nativeCanOpen(value)) continue
                return value to if (group == "apple") "application/vnd.apple.mpegurl" else "video/mp4"
            }
        }
        return null
    }
}

/** One HTTP response from the on-device server. */
data class HttpReply(
    val status: Int,
    val headers: Map<String, String> = emptyMap(),
    val body: ByteArray = ByteArray(0),
) {
    companion object {
        fun json(status: Int, value: Any): HttpReply = HttpReply(
            status = status,
            headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
            body = value.toString().toByteArray(Charsets.UTF_8),
        )

        fun bytes(status: Int, type: String, data: ByteArray): HttpReply =
            HttpReply(status, mapOf("Content-Type" to type), data)

        fun empty(status: Int): HttpReply = HttpReply(status)
    }

    // ByteArray in a data class needs these; the generated ones compare identity.
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is HttpReply) return false
        return status == other.status && headers == other.headers && body.contentEquals(other.body)
    }

    override fun hashCode(): Int = (status * 31 + headers.hashCode()) * 31 + body.contentHashCode()
}
