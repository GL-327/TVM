package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.io.IOException
import java.math.BigDecimal
import java.math.BigInteger
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.time.Instant
import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import java.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit

data class SyncHttpReply(
    val status: Int,
    val body: String,
    val etag: String? = null,
    val retryAfter: String? = null,
)

fun interface TvmSyncHttp {
    fun send(
        method: String,
        url: String,
        bearer: String?,
        headers: Map<String, String>,
        body: String?,
        timeoutMs: Int,
    ): SyncHttpReply

    companion object {
        private const val MAX_BODY = 4 * 1024 * 1024

        val Default = TvmSyncHttp { method, url, bearer, headers, body, timeoutMs ->
            val target = URL(url)
            if (target.protocol != "https") throw IOException("sync needs https")
            val connection = target.openConnection() as HttpURLConnection
            try {
                connection.requestMethod = method
                connection.instanceFollowRedirects = false
                connection.connectTimeout = timeoutMs
                connection.readTimeout = timeoutMs
                connection.useCaches = false
                connection.setRequestProperty("Accept", "application/json")
                connection.setRequestProperty("Accept-Encoding", "identity")
                connection.setRequestProperty("User-Agent", "TVM/1.1 (Android; +https://github.com/GL-327/TVM)")
                if (bearer != null) connection.setRequestProperty("Authorization", "Bearer $bearer")
                for ((key, value) in headers) connection.setRequestProperty(key, value)
                if (body != null) {
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val text = stream?.use { String(TvmHttp.readLimited(it, MAX_BODY), Charsets.UTF_8) } ?: ""
                SyncHttpReply(
                    status = status,
                    body = text,
                    etag = headerIgnoreCase(connection, "ETag"),
                    retryAfter = headerIgnoreCase(connection, "Retry-After"),
                )
            } finally {
                connection.disconnect()
            }
        }

        private fun headerIgnoreCase(connection: HttpURLConnection, name: String): String? {
            for ((key, values) in connection.headerFields) {
                if (key != null && key.equals(name, ignoreCase = true) && !values.isNullOrEmpty()) {
                    val found = values.firstOrNull { !it.isNullOrEmpty() }
                    if (found != null) return found
                }
            }
            return connection.getHeaderField(name)?.takeIf { it.isNotEmpty() }
        }
    }
}

class SyncHttpException(val status: Int, val retryAfter: String? = null) : RuntimeException("sync http $status")

data class SyncItem(
    val kind: String,
    val key: String,
    val value: Any?,
    val updatedAt: Long,
    val deleted: Boolean,
) {
    val itemId: String get() = "$kind:$key"

    fun json(): JSONObject = JSONObject().apply {
        put("kind", kind)
        put("key", key)
        put("value", value ?: JSONObject.NULL)
        put("updatedAt", updatedAt)
        put("deleted", deleted)
    }
}

data class SyncPage(
    val body: JSONObject,
    val generation: String?,
)

interface SyncTransport {
    fun getSyncPage(token: String, since: Long, cursor: String?, generation: String?): SyncPage
    fun putSyncItems(token: String, items: List<SyncItem>, generation: String)
}

class HttpSyncTransport(
    private val origin: String,
    private val http: TvmSyncHttp,
    private val timeoutMs: Int = 15_000,
) : SyncTransport {
    override fun getSyncPage(token: String, since: Long, cursor: String?, generation: String?): SyncPage {
        val sb = StringBuilder(origin).append("/v1/me/data?since=").append(since)
        if (cursor != null) {
            sb.append("&cursor=").append(URLEncoder.encode(cursor, "UTF-8"))
        }
        val headers = if (generation != null) mapOf("If-Match" to generation) else emptyMap()
        val reply = http.send("GET", sb.toString(), token, headers, null, timeoutMs)
        if (reply.status !in 200..299) throw SyncHttpException(reply.status, reply.retryAfter)
        val parsed = runCatching { JSONTokener(reply.body).nextValue() as? JSONObject }.getOrNull()
            ?: throw SyncHttpException(503)
        return SyncPage(parsed, reply.etag)
    }

    override fun putSyncItems(token: String, items: List<SyncItem>, generation: String) {
        val array = JSONArray()
        for (item in items) array.put(item.json())
        val payload = SyncSchema.canonicalJson(JSONObject().put("items", array))
        val reply = http.send(
            "PUT",
            "$origin/v1/me/data",
            token,
            mapOf("If-Match" to generation),
            payload,
            timeoutMs,
        )
        if (reply.status !in 200..299) throw SyncHttpException(reply.status, reply.retryAfter)
    }
}

object SyncSchema {
    val SYNC_KINDS: Set<String> = setOf("profile", "progress", "watchlist", "preference")

    val SYNC_EXTRAS: List<String> = listOf(
        "onlineSubtitles", "trailers", "trailerBackdrops", "collections", "comingUp", "watchStats",
        "animeTitles", "ratings", "qualityBadges", "versionPicker", "chapters", "seekPreviews",
        "themeSongs", "spoilerBlur", "surpriseMe", "autoCollections", "sleepTimer", "nightMode",
        "pauseOnMinimize", "shortcutsOverlay", "webhook", "announcements", "franchiseIntros",
    )

    val SYNC_PREFS: List<String> = listOf(
        "subtitleLanguages", "subtitleStyle", "audioLanguage", "skipSegments", "autoplayNext", "homeSections",
    ) + SYNC_EXTRAS.map { "extras.$it" }

    private val extraKeys: Set<String> = SYNC_PREFS.toSet()

    const val MAX_VALUE_BYTES: Int = 16 * 1024
    const val MAX_ITEMS: Int = 200
    const val FUTURE_MS: Long = 5 * 60 * 1000L

    private const val MAX_SAFE_INT: Long = 9_007_199_254_740_991L

    private val CREDENTIAL_SNIPPET_RE = Regex(
        """\b(?:bearer\s+|(?:password|api[_ -]?key|(?:rd|session)[_ -]?token)\s*[:=]|https?://)""",
        RegexOption.IGNORE_CASE,
    )
    private val TIME_RE = Regex("""^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$""")
    private val PROFILE_ID_RE = Regex("""^[\da-zA-Z][\da-zA-Z_-]{0,79}$""")
    private val RESERVED_PROFILE_RE = Regex("""^(con|prn|aux|nul|com\d|lpt\d)$""", RegexOption.IGNORE_CASE)
    private val MEDIA_ID_RE = Regex("""^[\da-zA-Z][\da-zA-Z._:-]{0,198}$""")
    private val ARTWORK_RE = Regex(
        """^https://(?:images\.metahub\.space|live\.metahub\.space|image\.tmdb\.org|(?:[a-z0-9-]+\.)?mzstatic\.com|(?:[a-z0-9-]+\.)?tvmaze\.com|(?:[a-z0-9-]+\.)?kitsu\.io|(?:[a-z0-9-]+\.)?fanart\.tv|m\.media-amazon\.com|image\.tving\.com|artworks\.tvm\.gl)/[a-zA-Z0-9./_%~@-]+$""",
    )
    private val SUBTITLE_LANG_RE = Regex("""^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$""")
    private val AUDIO_LANG_RE = Regex("""^(?:original|[a-z]{3})$""")
    private val SUBTITLE_SIZE_RE = Regex("""^(?:s|m|l|xl)$""")
    private val SUBTITLE_COLOR_RE = Regex("""^(?:white|yellow|cyan)$""")
    private val SUBTITLE_BG_RE = Regex("""^(?:shadow|box|none)$""")
    private val SECTION_ID_RE = Regex("""^[a-z\d][a-z\d-]{0,63}$""", RegexOption.IGNORE_CASE)
    private val AVATAR_RE = Regex("""^[a-z0-9-]{1,40}/[a-z0-9-]{1,40}$""")
    private val WATCHLIST_KIND_RE = Regex("""^(?:movie|series|file)$""")
    private val PIN_HASH_RE = Regex("""^[a-f0-9]{64}$""", RegexOption.IGNORE_CASE)
    private val PIN_SALT_RE = Regex("""^[a-f0-9]{32}$""", RegexOption.IGNORE_CASE)

    private val ITEM_KEYS = setOf("kind", "key", "value", "updatedAt", "deleted")
    private val SUBTITLE_STYLE_KEYS = setOf("size", "color", "background")
    private val HOME_SECTION_KEYS = setOf("id", "visible")
    private val PROFILE_KEYS = setOf("id", "name", "hue", "created", "avatar", "kind", "maxAge", "pin")
    private val PIN_KEYS = setOf("hash", "salt", "iter")
    private val PROGRESS_KEYS = setOf(
        "position", "duration", "updated", "hiddenFromContinueWatching",
        "completedAt", "completions", "completedTitle", "completedYear",
    )
    private val WATCHLIST_KEYS = setOf(
        "id", "title", "year", "kind", "synopsis", "poster", "backdrop",
        "genres", "rating", "playable", "hue", "added",
    )

    fun canonicalJson(value: Any?): String {
        val sb = StringBuilder()
        appendCanonical(sb, value)
        return sb.toString()
    }

    private fun appendCanonical(sb: StringBuilder, value: Any?) {
        when (value) {
            null, JSONObject.NULL -> sb.append("null")
            is Boolean -> sb.append(if (value) "true" else "false")
            is Int, is Long, is Short, is Byte, is BigInteger -> sb.append(value.toString())
            is Double, is Float, is BigDecimal -> {
                val d = (value as Number).toDouble()
                when {
                    !d.isFinite() -> sb.append("null")
                    d == 0.0 -> sb.append("0")
                    d % 1.0 == 0.0 && d >= -9e15 && d <= 9e15 -> sb.append(d.toLong().toString())
                    else -> sb.append(d.toString())
                }
            }
            is Number -> sb.append(value.toString())
            is String -> appendJsonString(sb, value)
            is JSONArray -> {
                sb.append('[')
                for (i in 0 until value.length()) {
                    if (i > 0) sb.append(',')
                    appendCanonical(sb, value.opt(i))
                }
                sb.append(']')
            }
            is JSONObject -> {
                val keys = ArrayList<String>()
                val iter = value.keys()
                while (iter.hasNext()) keys.add(iter.next())
                keys.sort()
                sb.append('{')
                for (i in keys.indices) {
                    if (i > 0) sb.append(',')
                    val k = keys[i]
                    appendJsonString(sb, k)
                    sb.append(':')
                    appendCanonical(sb, value.opt(k))
                }
                sb.append('}')
            }
            is Collection<*> -> {
                sb.append('[')
                var first = true
                for (item in value) {
                    if (!first) sb.append(',')
                    first = false
                    appendCanonical(sb, item)
                }
                sb.append(']')
            }
            is Map<*, *> -> {
                val keys = value.keys.mapNotNull { it as? String }.sorted()
                sb.append('{')
                for (i in keys.indices) {
                    if (i > 0) sb.append(',')
                    val k = keys[i]
                    appendJsonString(sb, k)
                    sb.append(':')
                    appendCanonical(sb, value[k])
                }
                sb.append('}')
            }
            else -> appendJsonString(sb, value.toString())
        }
    }

    private fun appendJsonString(sb: StringBuilder, text: String) {
        sb.append('"')
        for (i in 0 until text.length) {
            when (val ch = text[i]) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\b' -> sb.append("\\b")
                '\u000C' -> sb.append("\\f")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> {
                    if (ch.code < 0x20) {
                        sb.append("\\u")
                        val hex = ch.code.toString(16)
                        for (p in hex.length until 4) sb.append('0')
                        sb.append(hex)
                    } else {
                        sb.append(ch)
                    }
                }
            }
        }
        sb.append('"')
    }

    fun sha256Hex(text: String): String =
        MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    fun valueHash(value: Any?): String {
        val digest = MessageDigest.getInstance("SHA-256")
            .digest(canonicalJson(value).toByteArray(Charsets.UTF_8))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
    }

    fun syncValueBytes(value: Any?): Int = canonicalJson(value).toByteArray(Charsets.UTF_8).size

    private fun objectWithAllowedKeys(value: Any?, allowed: Set<String>): JSONObject? {
        val obj = value as? JSONObject ?: return null
        val keys = obj.keys()
        while (keys.hasNext()) {
            if (keys.next() !in allowed) return null
        }
        return obj
    }

    private fun matches(value: Any?, pattern: Regex): String? {
        val s = value as? String ?: return null
        return if (pattern.matches(s)) s else null
    }

    private fun displayText(value: Any?, required: Boolean = false): String? {
        val s = value as? String ?: return null
        if (required && s.trim().isEmpty()) return null
        if (CREDENTIAL_SNIPPET_RE.containsMatchIn(s)) return null
        return s
    }

    fun parseIsoTimeMs(value: Any?): Long? {
        val s = matches(value, TIME_RE) ?: return null
        return runCatching { OffsetDateTime.parse(s).toInstant().toEpochMilli() }.getOrNull()
    }

    fun isProfileId(value: Any?): Boolean {
        val s = matches(value, PROFILE_ID_RE) ?: return false
        return !RESERVED_PROFILE_RE.matches(s)
    }

    private fun isMediaId(value: Any?): Boolean = matches(value, MEDIA_ID_RE) != null

    private fun safeArtwork(value: Any?): Boolean =
        value == "" || matches(value, ARTWORK_RE) != null

    fun publicSyncArtwork(value: String): String = if (safeArtwork(value)) value else ""

    private fun finiteNumber(value: Any?): Double? {
        if (value !is Number) return null
        val d = value.toDouble()
        return if (d.isFinite()) d else null
    }

    private fun safeInteger(value: Any?): Long? {
        if (value !is Number) return null
        return when (value) {
            is Int -> value.toLong()
            is Long -> if (value in -MAX_SAFE_INT..MAX_SAFE_INT) value else null
            is Short, is Byte -> value.toLong()
            is BigInteger -> {
                if (value >= BigInteger.valueOf(-MAX_SAFE_INT) && value <= BigInteger.valueOf(MAX_SAFE_INT)) {
                    value.toLong()
                } else null
            }
            else -> {
                val d = value.toDouble()
                if (d.isFinite() && d % 1.0 == 0.0 && d >= -MAX_SAFE_INT.toDouble() && d <= MAX_SAFE_INT.toDouble()) {
                    d.toLong()
                } else null
            }
        }
    }

    private fun validPreference(key: String, value: Any?): Boolean { return when (key) {
        "subtitleLanguages" -> {
            val arr = value as? JSONArray ?: return false
            if (arr.length() > 20) return false
            (0 until arr.length()).all { matches(arr.opt(it), SUBTITLE_LANG_RE) != null }
        }
        "audioLanguage" -> matches(value, AUDIO_LANG_RE) != null
        "skipSegments" -> value == "off" || value == "button" || value == "auto"
        "autoplayNext" -> value is Boolean
        "subtitleStyle" -> {
            val obj = objectWithAllowedKeys(value, SUBTITLE_STYLE_KEYS) ?: return false
            matches(obj.opt("size"), SUBTITLE_SIZE_RE) != null &&
                matches(obj.opt("color"), SUBTITLE_COLOR_RE) != null &&
                matches(obj.opt("background"), SUBTITLE_BG_RE) != null
        }
        "homeSections" -> {
            val arr = value as? JSONArray ?: return false
            if (arr.length() > 100) return false
            (0 until arr.length()).all { idx ->
                val row = objectWithAllowedKeys(arr.opt(idx), HOME_SECTION_KEYS) ?: return@all false
                matches(row.opt("id"), SECTION_ID_RE) != null && row.opt("visible") is Boolean
            }
        }
        else -> key in extraKeys && value is Boolean
    } }

    fun validSyncKey(kind: String, key: Any?): Boolean {
        if (key !is String || key.isEmpty() || key.length > 200) return false
        if (kind == "profile") return isProfileId(key)
        if (kind == "preference") return key in extraKeys
        val slash = key.indexOf('/')
        return slash > 0 && isProfileId(key.substring(0, slash)) && isMediaId(key.substring(slash + 1))
    }

    private fun validValue(kind: String, key: String, value: Any?): Boolean {
        if (kind == "preference") return validPreference(key, value)
        if (kind == "profile") {
            val obj = objectWithAllowedKeys(value, PROFILE_KEYS) ?: return false
            if (obj.opt("id") != key) return false
            val name = displayText(obj.opt("name"), required = true) ?: return false
            if (name.length > 40) return false
            val hue = finiteNumber(obj.opt("hue")) ?: return false
            if (hue < 0.0 || hue >= 360.0) return false
            if (parseIsoTimeMs(obj.opt("created")) == null) return false
            val avatar = obj.opt("avatar")
            if (avatar != null && avatar !== JSONObject.NULL && matches(avatar, AVATAR_RE) == null) return false
            val profileKind = obj.opt("kind")
            if (profileKind != "standard" && profileKind != "kids") return false
            val maxAge = safeInteger(obj.opt("maxAge")) ?: return false
            if (maxAge != 7L && maxAge != 12L && maxAge != 15L && maxAge != 18L) return false
            val pinRaw = obj.opt("pin")
            if (pinRaw != null && pinRaw !== JSONObject.NULL) {
                val pin = objectWithAllowedKeys(pinRaw, PIN_KEYS) ?: return false
                if (matches(pin.opt("hash"), PIN_HASH_RE) == null) return false
                if (matches(pin.opt("salt"), PIN_SALT_RE) == null) return false
                if (safeInteger(pin.opt("iter")) != 20_000L) return false
            }
            return true
        }
        if (kind == "progress") {
            val obj = objectWithAllowedKeys(value, PROGRESS_KEYS) ?: return false
            val pos = finiteNumber(obj.opt("position")) ?: return false
            val dur = finiteNumber(obj.opt("duration")) ?: return false
            if (pos < 0.0 || dur < 0.0) return false
            if (parseIsoTimeMs(obj.opt("updated")) == null) return false
            if (obj.has("hiddenFromContinueWatching") && obj.opt("hiddenFromContinueWatching") !is Boolean) return false
            if (obj.has("completedAt") && parseIsoTimeMs(obj.opt("completedAt")) == null) return false
            if (obj.has("completions")) {
                val comp = safeInteger(obj.opt("completions")) ?: return false
                if (comp < 0L) return false
            }
            if (obj.has("completedTitle") && displayText(obj.opt("completedTitle")) == null) return false
            if (obj.has("completedYear")) {
                val year = obj.opt("completedYear")
                if (year !== JSONObject.NULL && finiteNumber(year) == null) return false
            }
            return true
        }
        val obj = objectWithAllowedKeys(value, WATCHLIST_KEYS) ?: return false
        val expectedId = key.substring(key.indexOf('/') + 1)
        if (obj.opt("id") != expectedId) return false
        if (displayText(obj.opt("title"), required = true) == null) return false
        val year = obj.opt("year")
        if (year !== JSONObject.NULL && finiteNumber(year) == null) return false
        if (matches(obj.opt("kind"), WATCHLIST_KIND_RE) == null) return false
        if (displayText(obj.opt("synopsis")) == null) return false
        if (!safeArtwork(obj.opt("poster")) || !safeArtwork(obj.opt("backdrop"))) return false
        val genres = obj.opt("genres") as? JSONArray ?: return false
        for (i in 0 until genres.length()) {
            if (displayText(genres.opt(i)) == null) return false
        }
        if (displayText(obj.opt("rating")) == null) return false
        if (obj.opt("playable") !is Boolean) return false
        if (finiteNumber(obj.opt("hue")) == null) return false
        if (parseIsoTimeMs(obj.opt("added")) == null) return false
        return true
    }

    fun parseSyncItem(raw: JSONObject, now: Long): SyncItem? = parseSyncItemAny(raw, now)

    fun parseSyncItemAny(raw: Any?, now: Long): SyncItem? {
        val obj = objectWithAllowedKeys(raw, ITEM_KEYS) ?: return null
        val kind = obj.opt("kind") as? String ?: return null
        if (kind !in SYNC_KINDS) return null
        val key = obj.opt("key") as? String ?: return null
        if (!validSyncKey(kind, key)) return null
        val updatedAt = safeInteger(obj.opt("updatedAt")) ?: return null
        if (updatedAt < 0L || updatedAt > now + FUTURE_MS) return null
        if (obj.has("deleted") && obj.opt("deleted") !is Boolean) return null
        val deleted = obj.opt("deleted") == true
        val rawValue = obj.opt("value")
        if (deleted) {
            if (rawValue != null && rawValue !== JSONObject.NULL) return null
            return SyncItem(kind, key, null, updatedAt, true)
        }
        if (!validValue(kind, key, rawValue)) return null
        return SyncItem(kind, key, if (rawValue === JSONObject.NULL) null else rawValue, updatedAt, false)
    }
}

data class SnapshotItem(
    val item: SyncItem,
    val hash: String,
    val changedAt: Long,
)

object SyncStores {
    private val HUES = listOf(221, 190, 145, 38, 315)
    private val SUBTITLE_LANG_RE = Regex("^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$")

    internal fun readJsonFile(target: File): Any? {
        val text = try {
            if (!target.isFile) return null
            target.readText(Charsets.UTF_8)
        } catch (_: Exception) {
            return null
        }
        val value = try {
            JSONTokener(text).nextValue()
        } catch (_: Exception) {
            return null
        }
        return if (value is JSONObject || value is JSONArray) value else null
    }

    internal fun writeAtomic(target: File, text: String) {
        try {
            target.parentFile?.mkdirs()
            val bytes = text.toByteArray(Charsets.UTF_8)
            val temp = File(target.parentFile, "${target.name}.${Thread.currentThread().id}.tmp")
            try {
                temp.writeBytes(bytes)
                try {
                    Files.move(
                        temp.toPath(),
                        target.toPath(),
                        StandardCopyOption.REPLACE_EXISTING,
                        StandardCopyOption.ATOMIC_MOVE,
                    )
                } catch (_: Exception) {
                    if (!temp.renameTo(target)) {
                        target.writeBytes(bytes)
                        temp.delete()
                    }
                }
            } catch (_: Exception) {
                temp.delete()
            }
        } catch (_: Exception) {
            // Best-effort atomic persistence matching TvmStore.
        }
    }

    private fun modifiedMs(target: File): Long = if (target.exists()) target.lastModified() else 0L

    private fun isoNow(): String = Instant.now().truncatedTo(ChronoUnit.SECONDS).toString()

    private fun isoTimestamp(raw: String?, fallbackMs: Long): String {
        if (raw != null && SyncSchema.parseIsoTimeMs(raw) != null) return raw
        val parsed = raw?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        return Instant.ofEpochMilli(parsed ?: fallbackMs).toString()
    }

    private fun untouchedProfile(row: ProfileRecord): Boolean =
        row.name == "Profile 1" && row.hue == 221 && row.avatar == null && row.pin == null &&
            row.kind == "standard" && row.maxAge == 18

    private fun parseProfileRecord(item: JSONObject, index: Int): ProfileRecord? {
        val id = item.opt("id") as? String ?: return null
        val name = item.opt("name") as? String ?: return null
        val kind = if (item.opt("kind") as? String == "kids") "kids" else "standard"
        val maxAge = TvmParental.normalizeAge(item.opt("maxAge"), kind) ?: TvmParental.defaultAge(kind)
        val avatarRaw = (item.opt("avatar") as? String)?.trim()
        val avatar = if (avatarRaw != null && TvmPins.AVATAR_RE.matches(avatarRaw)) avatarRaw else null
        val pinObj = item.opt("pin") as? JSONObject
        val pin = if (pinObj != null) {
            val hash = pinObj.opt("hash") as? String
            val salt = pinObj.opt("salt") as? String
            val iter = (pinObj.opt("iter") as? Number)?.toInt() ?: TvmPins.PIN_ITERATIONS
            if (!hash.isNullOrBlank() && !salt.isNullOrBlank() && iter > 0) {
                ProfilePin(hash = hash, salt = salt, iter = iter)
            } else null
        } else null
        val knownKeys = setOf("id", "name", "hue", "created", "avatar", "kind", "maxAge", "pin", "locked")
        val extra = LinkedHashMap<String, Any?>()
        val keys = item.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (k !in knownKeys) extra[k] = item.opt(k)
        }
        return ProfileRecord(
            id = id,
            name = name,
            hue = (item.opt("hue") as? Number)?.toInt() ?: HUES[index % HUES.size],
            created = item.opt("created") as? String ?: isoNow(),
            avatar = avatar,
            kind = kind,
            maxAge = maxAge,
            pin = pin,
            extra = extra,
        )
    }

    fun loadProfiles(directory: File): ProfileRegistry {
        val doc = readJsonFile(File(directory, "profiles.json")) as? JSONObject
        val list = doc?.opt("profiles") as? JSONArray
        if (doc != null && list != null) {
            val profiles = ArrayList<ProfileRecord>()
            for (i in 0 until list.length()) {
                val item = list.opt(i) as? JSONObject ?: continue
                parseProfileRecord(item, i)?.let { profiles.add(it) }
            }
            val first = profiles.firstOrNull()
            if (first != null) {
                val active = doc.opt("activeId") as? String
                val activeId = if (profiles.any { it.id == active }) (active ?: first.id) else first.id
                File(directory, "profiles/$activeId").mkdirs()
                return ProfileRegistry(activeId, profiles)
            }
        }
        val first = ProfileRecord(
            id = "profile-1",
            name = "Profile 1",
            hue = HUES[0],
            created = isoNow(),
        )
        val registry = ProfileRegistry(first.id, arrayListOf(first))
        writeProfileRegistry(directory, registry)
        return registry
    }

    fun writeProfileRegistry(directory: File, registry: ProfileRegistry) {
        val body = Json.obj(
            "activeId" to registry.activeId,
            "profiles" to Json.array(registry.profiles.map { it.storageJson() }),
        )
        writeAtomic(File(directory, "profiles.json"), body.toString())
        File(directory, "profiles/${registry.activeId}").mkdirs()
    }

    fun parseProgressObject(parsed: JSONObject): Map<String, ProgressEntry> {
        val out = LinkedHashMap<String, ProgressEntry>()
        val keys = parsed.keys()
        while (keys.hasNext()) {
            val id = keys.next()
            val entry = parsed.opt(id) as? JSONObject ?: return emptyMap()
            val position = (entry.opt("position") as? Number)?.toDouble() ?: continue
            val duration = (entry.opt("duration") as? Number)?.toDouble() ?: continue
            val present = LinkedHashSet<String>()
            if (entry.has("hiddenFromContinueWatching") && entry.opt("hiddenFromContinueWatching") is Boolean) {
                present.add("hiddenFromContinueWatching")
            }
            val completedAt = entry.opt("completedAt") as? String
            if (completedAt != null) present.add("completedAt")
            if (entry.has("completions") && entry.opt("completions") is Number) {
                present.add("completions")
            }
            val completedTitle = entry.opt("completedTitle") as? String
            if (completedTitle != null) present.add("completedTitle")
            val completedYearRaw = entry.opt("completedYear")
            val completedYear = if (entry.has("completedYear") &&
                (completedYearRaw === JSONObject.NULL || completedYearRaw is Number)
            ) {
                present.add("completedYear")
                Json.int(completedYearRaw)
            } else null
            out[id] = ProgressEntry(
                position = position,
                duration = duration,
                updated = entry.opt("updated") as? String ?: "",
                hiddenFromContinueWatching = entry.optBoolean("hiddenFromContinueWatching", false),
                completedAt = completedAt,
                completions = (entry.opt("completions") as? Number)?.toInt() ?: 0,
                completedTitle = completedTitle,
                completedYear = completedYear,
                syncPresentKeys = present,
            )
        }
        return out
    }

    private fun readProgress(scope: File): Map<String, ProgressEntry> {
        val parsed = readJsonFile(File(scope, "progress.json")) as? JSONObject ?: return emptyMap()
        return parseProgressObject(parsed)
    }

    private fun writeProgress(scope: File, progress: Map<String, ProgressEntry>) {
        val body = JSONObject()
        for ((key, entry) in progress) {
            val value = Json.obj(
                "position" to entry.position,
                "duration" to entry.duration,
                "updated" to entry.updated,
            )
            if (entry.hiddenFromContinueWatching || "hiddenFromContinueWatching" in entry.syncPresentKeys) {
                value.put("hiddenFromContinueWatching", entry.hiddenFromContinueWatching)
            }
            entry.completedAt?.let { value.put("completedAt", it) }
            if (entry.completions != 0 || "completions" in entry.syncPresentKeys) {
                value.put("completions", entry.completions)
            }
            entry.completedTitle?.let { value.put("completedTitle", it) }
            if (entry.completedYear != null || "completedYear" in entry.syncPresentKeys) {
                value.put("completedYear", entry.completedYear ?: JSONObject.NULL)
            }
            body.put(key, value)
        }
        scope.mkdirs()
        writeAtomic(File(scope, "progress.json"), body.toString())
    }

    private fun readWatchlist(scope: File): List<MediaItem> {
        val parsed = readJsonFile(File(scope, "watchlist.json")) as? JSONArray ?: return emptyList()
        val out = ArrayList<MediaItem>()
        for (i in 0 until parsed.length()) {
            MediaItem.parse(parsed.opt(i))?.let { out.add(it) }
        }
        return out
    }

    private fun writeWatchlist(scope: File, items: List<MediaItem>) {
        scope.mkdirs()
        writeAtomic(File(scope, "watchlist.json"), Json.array(items.map { it.json() }).toString())
    }

    fun readSyncPrefs(directory: File): JSONObject =
        readJsonFile(File(directory, "sync-prefs.json")) as? JSONObject ?: JSONObject()

    fun saveSyncPrefs(directory: File, values: JSONObject) {
        directory.mkdirs()
        writeAtomic(File(directory, "sync-prefs.json"), values.toString())
    }

    fun initializeStores(directory: File, legacy: File?) {
        directory.mkdirs()
        if (legacy == null) {
            loadProfiles(directory)
            return
        }
        val registry = loadProfiles(legacy)
        writeProfileRegistry(directory, registry)
        for (profile in registry.profiles) {
            if (!SyncSchema.isProfileId(profile.id)) continue
            val from = File(legacy, "profiles/${profile.id}")
            val to = File(directory, "profiles/${profile.id}")
            val progress = readProgress(from)
            if (progress.isNotEmpty()) writeProgress(to, progress)
            val watchlist = readWatchlist(from)
            if (watchlist.isNotEmpty()) writeWatchlist(to, watchlist)
            val historyFile = File(from, "extras-history.json")
            if (historyFile.isFile) {
                to.mkdirs()
                runCatching { historyFile.copyTo(File(to, "extras-history.json"), overwrite = true) }
            }
            val servicesFile = File(from, "services.json")
            if (servicesFile.isFile) {
                to.mkdirs()
                runCatching { servicesFile.copyTo(File(to, "services.json"), overwrite = true) }
            }
        }
        val legacyRaw = readJsonFile(File(legacy, "prefs.json")) as? JSONObject ?: JSONObject()
        val legacyPrefs = TvmPrefs().merge(legacyRaw)
        val values = LinkedHashMap(TvmPrefs.syncPrefValues(legacyPrefs))
        val defaults = TvmPrefs.syncPrefValues(TvmPrefs())
        val lastSubObj = readJsonFile(File(legacy, "profiles/${registry.activeId}/extras-subtitle.json")) as? JSONObject
        val lastSub = lastSubObj?.opt("language") as? String
        if (lastSub != null && SUBTITLE_LANG_RE.matches(lastSub)) {
            val existing = Json.strings(values["subtitleLanguages"])
            val combined = LinkedHashSet<String>()
            combined.add(lastSub)
            for (lang in existing) {
                combined.add(lang)
                if (combined.size >= 20) break
            }
            values["subtitleLanguages"] = JSONArray(combined.take(20))
        }
        val chosen = JSONObject()
        for ((key, value) in values) {
            if (SyncSchema.canonicalJson(value) != SyncSchema.canonicalJson(defaults[key])) {
                chosen.put(key, value ?: JSONObject.NULL)
            }
        }
        if (chosen.length() > 0) saveSyncPrefs(directory, chosen)
    }

    fun snapshot(
        directory: File,
        now: Long,
        legacy: File? = null,
        knownProfiles: Set<String> = emptySet(),
    ): Map<String, SnapshotItem> {
        val result = LinkedHashMap<String, SnapshotItem>()
        val registry = loadProfiles(directory)
        val mediaProfiles = HashSet<String>()

        fun add(kind: String, key: String, value: Any?, initial: Long, changedAt: Long) {
            val stamp = maxOf(0L, minOf(initial, now))
            val raw = JSONObject().apply {
                put("kind", kind)
                put("key", key)
                put("value", value ?: JSONObject.NULL)
                put("updatedAt", stamp)
            }
            val item = SyncSchema.parseSyncItem(raw, now)
            if (item != null && SyncSchema.syncValueBytes(value) <= SyncSchema.MAX_VALUE_BYTES) {
                result[item.itemId] = SnapshotItem(item, SyncSchema.valueHash(value), changedAt)
                if (kind == "progress" || kind == "watchlist") {
                    mediaProfiles.add(key.substringBefore('/'))
                }
            }
        }

        val profilesDir = File(directory, "profiles")
        val subdirs = profilesDir.listFiles() ?: emptyArray()
        for (dir in subdirs) {
            if (!dir.isDirectory || !SyncSchema.isProfileId(dir.name)) continue
            val progressTime = modifiedMs(File(dir, "progress.json"))
            for ((id, entry) in readProgress(dir)) {
                val parsed = SyncSchema.parseIsoTimeMs(entry.updated)
                val updated = if (parsed != null && parsed != 0L) parsed else progressTime
                val value = JSONObject().apply {
                    put("position", entry.position)
                    put("duration", entry.duration)
                    put("updated", isoTimestamp(entry.updated, updated))
                    if (entry.hiddenFromContinueWatching || "hiddenFromContinueWatching" in entry.syncPresentKeys) {
                        put("hiddenFromContinueWatching", entry.hiddenFromContinueWatching)
                    }
                    if (entry.completedAt != null) {
                        put("completedAt", isoTimestamp(entry.completedAt, updated))
                    }
                    if (entry.completions != 0 || "completions" in entry.syncPresentKeys) {
                        put("completions", entry.completions)
                    }
                    if (entry.completedTitle != null) {
                        put("completedTitle", entry.completedTitle)
                    }
                    if (entry.completedYear != null || "completedYear" in entry.syncPresentKeys) {
                        put("completedYear", entry.completedYear ?: JSONObject.NULL)
                    }
                }
                add("progress", "${dir.name}/$id", value, updated, updated)
            }
            val watchlistTime = modifiedMs(File(dir, "watchlist.json"))
            for (entry in readWatchlist(dir)) {
                val parsed = SyncSchema.parseIsoTimeMs(entry.added)
                val added = if (parsed != null && parsed != 0L) parsed else watchlistTime
                val kind = if (entry.kind == "series" || entry.kind == "file") entry.kind else "movie"
                val value = JSONObject().apply {
                    put("id", entry.id)
                    put("title", entry.title)
                    put("year", entry.year ?: JSONObject.NULL)
                    put("kind", kind)
                    put("synopsis", entry.synopsis)
                    put("poster", SyncSchema.publicSyncArtwork(entry.poster))
                    put("backdrop", SyncSchema.publicSyncArtwork(entry.backdrop))
                    put("genres", JSONArray(entry.genres))
                    put("rating", entry.rating)
                    put("playable", entry.playable)
                    put("hue", entry.hue)
                    put("added", isoTimestamp(entry.added, added))
                }
                add("watchlist", "${dir.name}/${entry.id}", value, added, added)
            }
        }

        val profileTime = modifiedMs(File(directory, "profiles.json"))
        val legacyProfileTime = if (legacy != null) modifiedMs(File(legacy, "profiles.json")) else profileTime
        for (row in registry.profiles) {
            val untouched = untouchedProfile(row)
            if (untouched && row.id !in mediaProfiles && row.id !in knownProfiles) continue
            val value = JSONObject().apply {
                put("id", row.id)
                put("name", row.name)
                put("hue", row.hue)
                put("created", isoTimestamp(row.created, profileTime))
                put("avatar", row.avatar ?: JSONObject.NULL)
                put("kind", if (row.kind == "kids") "kids" else "standard")
                put("maxAge", row.maxAge)
                put("pin", row.pin?.json() ?: JSONObject.NULL)
            }
            add("profile", row.id, value, if (untouched) 0L else legacyProfileTime, profileTime)
        }

        val preferenceTime = modifiedMs(File(directory, "sync-prefs.json"))
        val legacyPreferenceTime = if (legacy != null) modifiedMs(File(legacy, "prefs.json")) else preferenceTime
        val syncPrefs = readSyncPrefs(directory)
        val prefKeys = syncPrefs.keys()
        while (prefKeys.hasNext()) {
            val key = prefKeys.next()
            add("preference", key, syncPrefs.opt(key), legacyPreferenceTime, preferenceTime)
        }
        return result
    }

    fun applyItems(directory: File, items: List<SyncItem>, reloadProfiles: () -> Unit) {
        val groups = LinkedHashMap<String, MutableList<SyncItem>>()
        for (item in items) {
            val groupKey = if (item.kind == "progress" || item.kind == "watchlist") {
                "${item.kind}:${item.key.substringBefore('/')}"
            } else {
                item.kind
            }
            groups.getOrPut(groupKey) { ArrayList() }.add(item)
        }
        for ((key, group) in groups) {
            val kind = group.first().kind
            if (kind == "profile") {
                val registry = loadProfiles(directory)
                val rows = LinkedHashMap<String, ProfileRecord>()
                for (row in registry.profiles) rows[row.id] = row
                for (item in group) {
                    if (item.deleted) {
                        rows.remove(item.key)
                    } else {
                        val obj = item.value as? JSONObject ?: continue
                        parseProfileRecord(obj, rows.size)?.let { rows[item.key] = it }
                    }
                }
                val previous = registry.profiles.firstOrNull()
                if (rows.size > 1 && registry.profiles.size == 1 && previous != null && untouchedProfile(previous) &&
                    group.none { it.key == previous.id } &&
                    readProgress(File(directory, "profiles/${previous.id}")).isEmpty() &&
                    readWatchlist(File(directory, "profiles/${previous.id}")).isEmpty()
                ) {
                    rows.remove(previous.id)
                }
                val profiles = rows.values.sortedWith(compareBy<ProfileRecord>({ it.created }, { it.id })).toMutableList()
                if (profiles.isEmpty()) {
                    profiles.add(
                        ProfileRecord(
                            id = "profile-${java.util.UUID.randomUUID()}",
                            name = "Profile 1",
                            hue = HUES[0],
                            created = isoNow(),
                        ),
                    )
                }
                val activeId = if (profiles.any { it.id == registry.activeId }) {
                    registry.activeId
                } else {
                    (profiles.firstOrNull { it.pin == null } ?: profiles.first()).id
                }
                writeProfileRegistry(directory, ProfileRegistry(activeId, profiles))
                reloadProfiles()
            } else if (kind == "preference") {
                val prefs = readSyncPrefs(directory)
                for (item in group) {
                    if (item.deleted) {
                        prefs.remove(item.key)
                    } else {
                        prefs.put(item.key, item.value ?: JSONObject.NULL)
                    }
                }
                saveSyncPrefs(directory, prefs)
            } else {
                val scope = File(directory, "profiles/${key.substringAfter(':')}")
                scope.mkdirs()
                if (kind == "progress") {
                    val progress = LinkedHashMap(readProgress(scope))
                    for (item in group) {
                        val id = item.key.substringAfter('/')
                        if (item.deleted) {
                            progress.remove(id)
                        } else {
                            val obj = item.value as? JSONObject ?: continue
                            val parsed = parseProgressObject(JSONObject().put(id, obj))[id] ?: continue
                            progress[id] = parsed
                        }
                    }
                    writeProgress(scope, progress)
                } else {
                    val watchlist = LinkedHashMap<String, MediaItem>()
                    for (entry in readWatchlist(scope)) watchlist[entry.id] = entry
                    for (item in group) {
                        val id = item.key.substringAfter('/')
                        if (item.deleted) {
                            watchlist.remove(id)
                        } else {
                            MediaItem.parse(item.value)?.let { watchlist[id] = it }
                        }
                    }
                    val ordered = watchlist.values.sortedWith(
                        compareByDescending<MediaItem> { SyncSchema.parseIsoTimeMs(it.added) ?: 0L }
                            .thenBy { it.id },
                    )
                    writeWatchlist(scope, ordered)
                }
            }
        }
    }
}

data class ItemVersion(
    val updatedAt: Long,
    val hash: String?,
)

class SyncLedger(
    val versions: MutableMap<String, ItemVersion> = LinkedHashMap(),
    val pending: MutableMap<String, SyncItem> = LinkedHashMap(),
)

object SyncMerge {
    fun observeLocal(ledger: SyncLedger, local: Map<String, SnapshotItem>, now: Long): Boolean {
        var changed = false
        for ((id, row) in local) {
            val prior = ledger.versions[id]
            if (prior != null && prior.hash == row.hash) continue
            val updatedAt = if (prior != null) {
                maxOf(prior.updatedAt + 1L, minOf(row.changedAt, now))
            } else {
                row.item.updatedAt
            }
            ledger.versions[id] = ItemVersion(updatedAt, row.hash)
            ledger.pending[id] = row.item.copy(updatedAt = updatedAt)
            changed = true
        }
        for ((id, version) in ledger.versions.entries.toList()) {
            if (version.hash == null || local.containsKey(id)) continue
            val split = id.indexOf(':')
            val updatedAt = maxOf(now, version.updatedAt + 1L)
            ledger.versions[id] = ItemVersion(updatedAt, null)
            ledger.pending[id] = SyncItem(
                kind = id.substring(0, split),
                key = id.substring(split + 1),
                value = null,
                updatedAt = updatedAt,
                deleted = true,
            )
            changed = true
        }
        return changed
    }

    fun mergeRemote(ledger: SyncLedger, incoming: List<SyncItem>): List<SyncItem> {
        val changes = ArrayList<SyncItem>()
        for (item in incoming) {
            val id = item.itemId
            val prior = ledger.versions[id]
            if (prior != null && prior.updatedAt > item.updatedAt) continue
            val hash = if (item.deleted) null else SyncSchema.valueHash(item.value)
            // On a tie the server's first accepted value is authoritative.
            ledger.pending.remove(id)
            ledger.versions[id] = ItemVersion(item.updatedAt, hash)
            if (prior == null || prior.hash != hash) changes.add(item)
        }
        return changes
    }
}

data class SyncStatus(
    val enabled: Boolean,
    val lastSyncAt: Long?,
    val pending: Int,
    val error: String?,
) {
    fun json(): JSONObject = JSONObject().apply {
        put("enabled", enabled)
        put("lastSyncAt", lastSyncAt ?: JSONObject.NULL)
        put("pending", pending)
        put("error", error ?: JSONObject.NULL)
    }

    companion object {
        val DISABLED = SyncStatus(enabled = false, lastSyncAt = null, pending = 0, error = null)
    }
}

interface TvmSyncScheduler {
    fun schedule(delayMs: Long, task: Runnable): Cancellable
    fun shutdown() {}

    fun interface Cancellable {
        fun cancel()
    }

    class Executor : TvmSyncScheduler {
        private val executor: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "tvm-sync").apply { isDaemon = true }
        }

        override fun schedule(delayMs: Long, task: Runnable): Cancellable {
            val future = executor.schedule(task, maxOf(0L, delayMs), TimeUnit.MILLISECONDS)
            return Cancellable { future.cancel(false) }
        }

        override fun shutdown() {
            executor.shutdownNow()
        }
    }
}

class SyncEngine(
    private val directory: File,
    legacy: File? = null,
    private val reloadProfiles: () -> Unit,
    private val transport: SyncTransport,
    private val sessionRejected: (String) -> Unit,
    private val now: () -> Long = System::currentTimeMillis,
    private val scheduler: TvmSyncScheduler = TvmSyncScheduler.Executor(),
    private val storeMonitor: Any? = null,
) {
    companion object {
        const val PULL_MS: Long = 60_000L
        const val DEBOUNCE_MS: Long = 3_000L
        const val BACKOFF_MAX_MS: Long = 5 * 60_000L
        const val MAX_PAGES: Int = 201
        private val ETAG_RE = Regex("""^"\d+"$""")
    }

    private data class Checkpoint(
        val versions: MutableMap<String, ItemVersion>,
        val pending: MutableMap<String, SyncItem>,
        val since: Long,
        val generation: String?,
        val lastSyncAt: Long?,
    )

    private data class StagedApplication(
        val items: List<SyncItem>,
        val checkpoint: Checkpoint,
    )

    private data class State(
        val versions: MutableMap<String, ItemVersion>,
        val pending: MutableMap<String, SyncItem>,
        val since: Long,
        val generation: String?,
        val lastSyncAt: Long?,
        val applying: StagedApplication? = null,
    ) {
        fun toCheckpoint(): Checkpoint = Checkpoint(
            versions = LinkedHashMap(versions),
            pending = LinkedHashMap(pending),
            since = since,
            generation = generation,
            lastSyncAt = lastSyncAt,
        )

        companion object {
            fun fromCheckpoint(cp: Checkpoint): State = State(
                versions = LinkedHashMap(cp.versions),
                pending = LinkedHashMap(cp.pending),
                since = cp.since,
                generation = cp.generation,
                lastSyncAt = cp.lastSyncAt,
                applying = null,
            )
        }
    }

    private val lock = Any()
    private val ledgerFile = File(directory, "ledger.json")
    private var state: State = readLedger()
    private var token: String? = null
    private var generation: Long = 0L
    private var activeJob: CompletableFuture<Unit>? = null
    private var scheduledTask: TvmSyncScheduler.Cancellable? = null
    private var disabled: Boolean = false
    private var stopped: Boolean = false
    private var dirty: Boolean = true
    private var legacyDir: File? = if (state.generation == null && state.versions.isEmpty()) legacy else null
    private var changeDue: Long = Long.MAX_VALUE
    private var pullDue: Long = Long.MAX_VALUE
    private var retryAt: Long = 0L
    private var failures: Int = 0
    private var error: String? = null

    private fun readLedger(): State {
        val obj = SyncStores.readJsonFile(ledgerFile) as? JSONObject ?: return State(
            versions = LinkedHashMap(),
            pending = LinkedHashMap(),
            since = 0L,
            generation = null,
            lastSyncAt = null,
        )
        return parseState(obj) ?: State(
            versions = LinkedHashMap(),
            pending = LinkedHashMap(),
            since = 0L,
            generation = null,
            lastSyncAt = null,
        )
    }

    private fun parseCheckpoint(obj: JSONObject): Checkpoint? {
        val versions = LinkedHashMap<String, ItemVersion>()
        val versionsObj = obj.optJSONObject("versions") ?: JSONObject()
        val vKeys = versionsObj.keys()
        while (vKeys.hasNext()) {
            val id = vKeys.next()
            val row = versionsObj.optJSONObject(id) ?: continue
            val updatedAt = (row.opt("updatedAt") as? Number)?.toLong() ?: continue
            val hash = row.opt("hash") as? String
            versions[id] = ItemVersion(updatedAt, hash)
        }
        val pending = LinkedHashMap<String, SyncItem>()
        val pendingObj = obj.optJSONObject("pending") ?: JSONObject()
        val pKeys = pendingObj.keys()
        while (pKeys.hasNext()) {
            val id = pKeys.next()
            val rawItem = pendingObj.optJSONObject(id) ?: continue
            val kind = rawItem.opt("kind") as? String ?: continue
            val key = rawItem.opt("key") as? String ?: continue
            val updatedAt = (rawItem.opt("updatedAt") as? Number)?.toLong() ?: continue
            val deleted = rawItem.opt("deleted") == true
            val rawValue = rawItem.opt("value")
            pending[id] = SyncItem(
                kind = kind,
                key = key,
                value = if (rawValue === JSONObject.NULL) null else rawValue,
                updatedAt = updatedAt,
                deleted = deleted,
            )
        }
        val since = (obj.opt("since") as? Number)?.toLong() ?: 0L
        val gen = obj.opt("generation") as? String
        val lastSyncAt = (obj.opt("lastSyncAt") as? Number)?.toLong()
        return Checkpoint(versions, pending, since, gen, lastSyncAt)
    }

    private fun parseState(obj: JSONObject): State? {
        val cp = parseCheckpoint(obj) ?: return null
        val applyingObj = obj.optJSONObject("applying")
        val staged = if (applyingObj != null) {
            val itemsArr = applyingObj.optJSONArray("items") ?: JSONArray()
            val items = ArrayList<SyncItem>()
            for (i in 0 until itemsArr.length()) {
                val raw = itemsArr.optJSONObject(i) ?: continue
                val kind = raw.opt("kind") as? String ?: continue
                val key = raw.opt("key") as? String ?: continue
                val updatedAt = (raw.opt("updatedAt") as? Number)?.toLong() ?: continue
                val deleted = raw.opt("deleted") == true
                val rawValue = raw.opt("value")
                items.add(
                    SyncItem(
                        kind = kind,
                        key = key,
                        value = if (rawValue === JSONObject.NULL) null else rawValue,
                        updatedAt = updatedAt,
                        deleted = deleted,
                    ),
                )
            }
            val nextCp = applyingObj.optJSONObject("checkpoint")?.let { parseCheckpoint(it) }
            if (nextCp != null) StagedApplication(items, nextCp) else null
        } else null
        return State(cp.versions, cp.pending, cp.since, cp.generation, cp.lastSyncAt, staged)
    }

    private fun checkpointJson(cp: Checkpoint): JSONObject {
        val versionsObj = JSONObject()
        for ((id, v) in cp.versions) {
            versionsObj.put(
                id,
                JSONObject().put("updatedAt", v.updatedAt).put("hash", v.hash ?: JSONObject.NULL),
            )
        }
        val pendingObj = JSONObject()
        for ((id, item) in cp.pending) {
            pendingObj.put(id, item.json())
        }
        return JSONObject().apply {
            put("versions", versionsObj)
            put("pending", pendingObj)
            put("since", cp.since)
            put("generation", cp.generation ?: JSONObject.NULL)
            put("lastSyncAt", cp.lastSyncAt ?: JSONObject.NULL)
        }
    }

    private fun saveLocked(next: State) {
        val json = checkpointJson(next.toCheckpoint())
        if (next.applying != null) {
            val itemsArr = JSONArray()
            for (item in next.applying.items) itemsArr.put(item.json())
            json.put(
                "applying",
                JSONObject()
                    .put("items", itemsArr)
                    .put("checkpoint", checkpointJson(next.applying.checkpoint)),
            )
        }
        SyncStores.writeAtomic(ledgerFile, SyncSchema.canonicalJson(json))
        state = next
    }

    private fun <T> withStoreMonitor(block: () -> T): T =
        if (storeMonitor != null) synchronized(storeMonitor) { block() } else block()

    private fun finishApplicationLocked() {
        val staged = state.applying ?: return
        var profilesChanged = false
        withStoreMonitor {
            SyncStores.applyItems(directory, staged.items) { profilesChanged = true }
        }
        saveLocked(State.fromCheckpoint(staged.checkpoint))
        if (profilesChanged) reloadProfiles()
    }

    private fun captureLocked() {
        finishApplicationLocked()
        if (!dirty) return
        val current = now()
        val known = LinkedHashSet<String>()
        for ((id, version) in state.versions) {
            if (id.startsWith("profile:") && version.hash != null) {
                known.add(id.substring(8))
            }
        }
        val local = withStoreMonitor { SyncStores.snapshot(directory, current, legacyDir, known) }
        val ledger = SyncLedger(LinkedHashMap(state.versions), LinkedHashMap(state.pending))
        if (SyncMerge.observeLocal(ledger, local, current)) {
            saveLocked(state.copy(versions = ledger.versions, pending = ledger.pending))
        }
        legacyDir = null
        dirty = false
    }

    private fun scheduleLocked() {
        scheduledTask?.cancel()
        scheduledTask = null
        if (stopped || disabled || token == null || activeJob != null) return
        val earliest = minOf(changeDue, pullDue)
        val at = maxOf(retryAt, earliest)
        if (at == Long.MAX_VALUE) return
        val delay = maxOf(0L, at - now())
        scheduledTask = scheduler.schedule(delay, Runnable { runSync(force = false) })
    }

    private fun isCurrent(epoch: Long): Boolean = synchronized(lock) { !stopped && generation == epoch }

    private fun pullPage(body: JSONObject, currentNow: Long): Triple<List<SyncItem>, Long, String?> {
        val itemsArr = body.opt("items") as? JSONArray ?: throw SyncHttpException(503)
        if (itemsArr.length() > 100) throw SyncHttpException(503)
        val pageNowNum = body.opt("now") as? Number ?: throw SyncHttpException(503)
        val pageNow = when (pageNowNum) {
            is Int -> pageNowNum.toLong()
            is Long -> pageNowNum
            else -> {
                val d = pageNowNum.toDouble()
                if (!d.isFinite() || d % 1.0 != 0.0 || d < 0.0 || d > 9_007_199_254_740_991.0) throw SyncHttpException(503)
                d.toLong()
            }
        }
        if (pageNow < 0L) throw SyncHttpException(503)
        val nextCursor = if (body.has("nextCursor")) {
            val rawCursor = body.opt("nextCursor") as? String ?: throw SyncHttpException(503)
            if (itemsArr.length() == 0 || rawCursor.length > 750) throw SyncHttpException(503)
            rawCursor
        } else null
        val itemNow = maxOf(currentNow, pageNow)
        val items = ArrayList<SyncItem>(itemsArr.length())
        for (i in 0 until itemsArr.length()) {
            val rawItem = itemsArr.opt(i)
            val parsed = SyncSchema.parseSyncItemAny(rawItem, itemNow) ?: throw SyncHttpException(503)
            if (SyncSchema.syncValueBytes(parsed.value) > SyncSchema.MAX_VALUE_BYTES) throw SyncHttpException(503)
            items.add(parsed)
        }
        return Triple(items, pageNow, nextCursor)
    }

    private fun pull(session: String, epoch: Long) {
        var match = synchronized(lock) { state.generation }
        var since = synchronized(lock) { state.since }
        var reset = false
        val incoming = LinkedHashMap<String, SyncItem>()
        var cursor: String? = null
        var watermark: Long? = null
        var more = true
        var count = 0
        while (count < MAX_PAGES && more) {
            count++
            val raw = try {
                transport.getSyncPage(session, since, cursor, match)
            } catch (failure: SyncHttpException) {
                if (!isCurrent(epoch)) return
                if (failure.status != 412 || match == null || reset) throw failure
                match = null
                since = 0L
                cursor = null
                watermark = null
                incoming.clear()
                reset = true
                continue
            }
            if (!isCurrent(epoch)) return
            val (pageItems, pageNow, nextCursor) = pullPage(raw.body, now())
            val etag = raw.generation
            if (etag == null || !ETAG_RE.matches(etag) ||
                (match != null && etag != match) ||
                (watermark != null && pageNow != watermark) ||
                pageNow < since ||
                (cursor != null && nextCursor == cursor)
            ) {
                throw SyncHttpException(503)
            }
            match = etag
            watermark = pageNow
            cursor = nextCursor
            more = cursor != null
            for (item in pageItems) incoming[item.itemId] = item
        }
        if (more || watermark == null) throw SyncHttpException(503)

        synchronized(lock) {
            if (!isCurrent(epoch)) return
            captureLocked()
            val nextVersions = LinkedHashMap(state.versions)
            val nextPending = if (reset) LinkedHashMap() else LinkedHashMap(state.pending)
            if (reset) {
                // Cloud data was cleared; keep device copies and drop stale generation stamps.
                for ((id, version) in nextVersions.entries.toList()) {
                    nextVersions[id] = version.copy(updatedAt = -1L)
                }
            }
            val nextLedger = SyncLedger(nextVersions, nextPending)
            val changes = SyncMerge.mergeRemote(nextLedger, incoming.values.toList())
            val checkpoint = Checkpoint(
                versions = nextLedger.versions,
                pending = nextLedger.pending,
                since = watermark,
                generation = match,
                lastSyncAt = state.lastSyncAt,
            )
            if (changes.isNotEmpty()) {
                saveLocked(state.copy(applying = StagedApplication(changes, checkpoint)))
                finishApplicationLocked()
            } else if (incoming.isNotEmpty() || reset || state.since != checkpoint.since || state.generation != match) {
                saveLocked(State.fromCheckpoint(checkpoint))
            }
        }
    }

    private fun runSync(force: Boolean) {
        while (true) {
            val session: String
            val epoch: Long
            val task: CompletableFuture<Unit>
            val inFlight: CompletableFuture<Unit>?
            synchronized(lock) {
                if (token == null || disabled || stopped) return
                val existing = activeJob
                if (existing != null) {
                    if (!force) return
                    inFlight = existing
                    session = ""
                    epoch = 0L
                    task = existing
                } else {
                    if (!force && now() < retryAt) {
                        scheduleLocked()
                        return
                    }
                    inFlight = null
                    session = token!!
                    epoch = generation
                    task = CompletableFuture()
                    activeJob = task
                }
            }
            if (inFlight != null) {
                runCatching { inFlight.get() }
                val shouldRetry = synchronized(lock) {
                    !stopped && !disabled && token != null &&
                        (pullDue <= now() || dirty || state.pending.isNotEmpty())
                }
                if (!shouldRetry) return
                continue
            }
            executeSync(force, session, epoch, task)
            return
        }
    }

    private fun executeSync(force: Boolean, session: String, epoch: Long, task: CompletableFuture<Unit>) {
        try {
            synchronized(lock) {
                if (!isCurrent(epoch)) return
                captureLocked()
            }
            pull(session, epoch)
            val queue = synchronized(lock) {
                if (!isCurrent(epoch)) return
                captureLocked()
                if (changeDue <= now()) changeDue = Long.MAX_VALUE
                if (force || changeDue == Long.MAX_VALUE) state.pending.values.toList() else emptyList()
            }
            if (queue.isNotEmpty()) {
                var offset = 0
                while (offset < queue.size) {
                    val end = minOf(offset + SyncSchema.MAX_ITEMS, queue.size)
                    val batch = queue.subList(offset, end)
                    val gen = synchronized(lock) {
                        if (!isCurrent(epoch)) return
                        state.generation
                    } ?: throw SyncHttpException(503)
                    transport.putSyncItems(session, batch, gen)
                    synchronized(lock) {
                        if (!isCurrent(epoch)) return
                        captureLocked()
                        val nextPending = LinkedHashMap(state.pending)
                        for (item in batch) {
                            val id = item.itemId
                            if (nextPending[id]?.updatedAt == item.updatedAt) {
                                nextPending.remove(id)
                            }
                        }
                        saveLocked(state.copy(pending = nextPending))
                    }
                    offset = end
                }
                pull(session, epoch)
            }
            synchronized(lock) {
                if (!isCurrent(epoch)) return
                val at = now()
                if (changeDue <= at && !dirty && state.pending.isEmpty()) changeDue = Long.MAX_VALUE
                saveLocked(state.copy(lastSyncAt = at))
                pullDue = at + PULL_MS
                failures = 0
                retryAt = 0L
                error = null
            }
        } catch (failure: Throwable) {
            if (!isCurrent(epoch)) return
            if (failure is SyncHttpException && failure.status == 404) {
                synchronized(lock) {
                    disabled = true
                    error = null
                }
                return
            }
            if (failure is SyncHttpException && failure.status == 401) {
                sessionRejected(session)
                return
            }
            val seconds = (failure as? SyncHttpException)?.retryAfter?.trim()?.toDoubleOrNull() ?: 0.0
            synchronized(lock) {
                val shift = minOf(6, failures)
                failures++
                val delay = minOf(BACKOFF_MAX_MS, 5_000L * (1L shl shift))
                val retryAfterMs = if (seconds.isFinite() && seconds > 0.0) (seconds * 1000.0).toLong() else 0L
                val at = now()
                retryAt = at + maxOf(delay, retryAfterMs)
                pullDue = minOf(pullDue, at)
                error = if (failure is SyncHttpException && failure.status == 409) {
                    "Synced data is full."
                } else {
                    "Account data could not sync."
                }
            }
        } finally {
            synchronized(lock) {
                if (activeJob === task) activeJob = null
                scheduleLocked()
            }
            task.complete(Unit)
        }
    }

    fun attach(session: String, signingIn: Boolean = false) {
        synchronized(lock) {
            if (session == token && !signingIn) return
            token = session
            generation++
            try {
                captureLocked()
            } catch (_: Exception) {
                error = "Account data could not sync."
            }
            if (signingIn) {
                disabled = false
                failures = 0
                retryAt = 0L
                error = null
            }
            pullDue = now()
            scheduleLocked()
        }
    }

    fun detach(session: String) {
        synchronized(lock) {
            if (token != session) return
            token = null
            generation++
            scheduledTask?.cancel()
            scheduledTask = null
        }
    }

    fun notifyStoreChanged() {
        synchronized(lock) {
            dirty = true
            changeDue = now() + DEBOUNCE_MS
            scheduleLocked()
        }
    }

    fun onForeground() {
        synchronized(lock) {
            if (stopped || disabled || token == null) return
            pullDue = minOf(pullDue, now())
            scheduleLocked()
        }
    }

    fun status(): SyncStatus {
        synchronized(lock) {
            if (token == null || disabled || stopped) return SyncStatus.DISABLED
            try {
                captureLocked()
            } catch (_: Exception) {
                error = "Account data could not sync."
            }
            return SyncStatus(
                enabled = true,
                lastSyncAt = state.lastSyncAt,
                pending = state.pending.size,
                error = error,
            )
        }
    }

    fun syncNow(): SyncStatus {
        runSync(force = true)
        return status()
    }

    fun close() {
        synchronized(lock) {
            stopped = true
            token = null
            generation++
            scheduledTask?.cancel()
            scheduledTask = null
        }
        scheduler.shutdown()
    }
}

class TvmAccountSync(
    private val store: TvmStore,
    private val origin: String = TVM_ACCOUNTS_URL,
    http: TvmSyncHttp = TvmSyncHttp.Default,
    private val reloadProfiles: () -> Unit = { store.profiles() },
    private val now: () -> Long = System::currentTimeMillis,
    private val schedulerFactory: () -> TvmSyncScheduler = { TvmSyncScheduler.Executor() },
    private val onSessionRejected: ((String) -> Unit)? = null,
) {
    private data class AccountEntry(
        val directory: File,
        val engine: SyncEngine,
    )

    private val lock = Any()
    private val root: File = store.rootDir()
    private val syncRoot: File = File(root, "sync")
    private val legacyOwnerFile: File = File(syncRoot, "legacy-owner.json")
    private val sessionOwnerFile: File = File(syncRoot, "session-owner.json")
    private val transport: SyncTransport = HttpSyncTransport(origin, http)
    private val sessions = LinkedHashMap<String, String>()
    private val accounts = LinkedHashMap<String, AccountEntry>()

    private fun accountHash(accountId: String): String =
        SyncSchema.sha256Hex("$origin\u0000$accountId")

    private fun isHexString(value: String): Boolean =
        value.isNotEmpty() && value.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }

    private fun makeEngineLocked(accountHash: String, accountDir: File, legacy: Boolean): AccountEntry {
        val engine = SyncEngine(
            directory = accountDir,
            legacy = if (legacy) root else null,
            reloadProfiles = reloadProfiles,
            transport = transport,
            sessionRejected = { rejectedToken ->
                signOut(rejectedToken)
                onSessionRejected?.invoke(rejectedToken)
            },
            now = now,
            scheduler = schedulerFactory(),
            storeMonitor = store.storeMonitor(),
        )
        return AccountEntry(accountDir, engine).also { accounts[accountHash] = it }
    }

    private fun writeSessionOwner(token: String, accountHash: String) {
        syncRoot.mkdirs()
        val payload = JSONObject()
            .put("tokenHash", SyncSchema.sha256Hex(token))
            .put("accountHash", accountHash)
        SyncStores.writeAtomic(sessionOwnerFile, SyncSchema.canonicalJson(payload))
    }

    fun bind(token: String, accountId: String, signingIn: Boolean = false): File {
        if (token.isEmpty() || accountId.isEmpty()) return root
        val hash = accountHash(accountId)
        val entry: AccountEntry
        val shouldAttach: Boolean
        synchronized(lock) {
            var current = accounts[hash]
            if (current == null) {
                val accountDir = File(syncRoot, "accounts/$hash")
                val markerFile = File(accountDir, "initialized.json")
                val marker = SyncStores.readJsonFile(markerFile) as? JSONObject
                val legacy: Boolean
                if (marker == null) {
                    val owner = (SyncStores.readJsonFile(legacyOwnerFile) as? JSONObject)?.opt("owner") as? String
                    legacy = owner == null || owner == hash
                    if (owner == null) {
                        syncRoot.mkdirs()
                        SyncStores.writeAtomic(
                            legacyOwnerFile,
                            SyncSchema.canonicalJson(JSONObject().put("owner", hash)),
                        )
                    }
                    store.withStoreLock {
                        SyncStores.initializeStores(accountDir, if (legacy) root else null)
                    }
                    SyncStores.writeAtomic(
                        markerFile,
                        SyncSchema.canonicalJson(JSONObject().put("legacy", legacy)),
                    )
                } else {
                    legacy = marker.opt("legacy") == true
                    store.withStoreLock {
                        SyncStores.loadProfiles(accountDir)
                    }
                }
                current = makeEngineLocked(hash, accountDir, legacy)
            }
            writeSessionOwner(token, hash)
            store.setActiveDirectory(current.directory)
            val alreadyBound = sessions[token] == hash
            sessions[token] = hash
            entry = current
            shouldAttach = !alreadyBound || signingIn
        }
        if (shouldAttach) {
            entry.engine.attach(token, signingIn)
        }
        return entry.directory
    }

    fun restore(token: String) {
        if (token.isEmpty()) return
        val tokenHash = SyncSchema.sha256Hex(token)
        val entry: AccountEntry
        val shouldAttach: Boolean
        synchronized(lock) {
            val ownerDoc = SyncStores.readJsonFile(sessionOwnerFile) as? JSONObject ?: return
            if (ownerDoc.opt("tokenHash") != tokenHash) return
            val hash = ownerDoc.opt("accountHash") as? String ?: return
            if (!isHexString(hash)) return
            val accountDir = File(syncRoot, "accounts/$hash")
            val markerFile = File(accountDir, "initialized.json")
            if (!markerFile.isFile) return
            var current = accounts[hash]
            if (current == null) {
                val marker = SyncStores.readJsonFile(markerFile) as? JSONObject
                val legacy = marker?.opt("legacy") == true
                SyncStores.loadProfiles(accountDir)
                current = makeEngineLocked(hash, accountDir, legacy)
            }
            val alreadyBound = sessions[token] == hash
            sessions[token] = hash
            store.setActiveDirectory(current.directory)
            entry = current
            shouldAttach = !alreadyBound
        }
        if (shouldAttach) {
            entry.engine.attach(token, false)
        }
    }

    fun signOut(token: String?) {
        if (token.isNullOrEmpty()) return
        val tokenHash = SyncSchema.sha256Hex(token)
        var engineToClose: SyncEngine? = null
        var fallback: Pair<SyncEngine, String>? = null
        var dirToClean: File? = null
        synchronized(lock) {
            var hash = sessions.remove(token)
            val ownerDoc = SyncStores.readJsonFile(sessionOwnerFile) as? JSONObject
            val ownerMatches = ownerDoc?.opt("tokenHash") == tokenHash
            if (hash == null && ownerMatches) {
                val savedHash = ownerDoc?.opt("accountHash") as? String
                if (!savedHash.isNullOrEmpty() && isHexString(savedHash)) {
                    hash = savedHash
                }
            }
            val resolvedHash = hash ?: run {
                if (ownerMatches) {
                    sessionOwnerFile.delete()
                    if (sessions.isEmpty()) store.setActiveDirectory(null)
                }
                return
            }
            val current = accounts[resolvedHash]
            current?.engine?.detach(token)
            val remaining = if (current != null) sessions.entries.firstOrNull { it.value == resolvedHash } else null
            if (remaining != null && current != null) {
                fallback = current.engine to remaining.key
                writeSessionOwner(remaining.key, resolvedHash)
            } else {
                accounts.remove(resolvedHash)
                engineToClose = current?.engine
                val dir = current?.directory ?: File(syncRoot, "accounts/$resolvedHash")
                if (dir.isDirectory) {
                    dirToClean = dir
                }
                if (ownerMatches || ownerDoc?.opt("accountHash") == resolvedHash || sessions.isEmpty()) {
                    sessionOwnerFile.delete()
                }
                if (store.activeSyncDir() == dir || sessions.isEmpty()) {
                    store.setActiveDirectory(null)
                }
            }
        }
        engineToClose?.close()
        dirToClean?.let { dir ->
            File(dir, "ledger.json").delete()
            File(dir, "profiles.json").delete()
            File(dir, "profiles").deleteRecursively()
            File(dir, "sync-prefs.json").delete()
            SyncStores.writeAtomic(
                File(dir, "initialized.json"),
                SyncSchema.canonicalJson(JSONObject().put("legacy", false)),
            )
        }
        fallback?.let { (engine, nextToken) -> engine.attach(nextToken, false) }
    }

    fun hasSession(token: String?): Boolean {
        if (token.isNullOrEmpty()) return false
        return synchronized(lock) { sessions.containsKey(token) }
    }

    fun notifyStoreChanged() {
        val activeDir = store.activeSyncDir() ?: return
        val engine = synchronized(lock) {
            accounts.values.firstOrNull { it.directory == activeDir }?.engine
        } ?: return
        engine.notifyStoreChanged()
    }

    fun onForeground() {
        val activeDir = store.activeSyncDir() ?: return
        val engine = synchronized(lock) {
            accounts.values.firstOrNull { it.directory == activeDir }?.engine
        } ?: return
        engine.onForeground()
    }

    fun status(token: String?): SyncStatus {
        val engine = synchronized(lock) {
            val accountHash = if (token.isNullOrEmpty()) null else sessions[token]
            accountHash?.let { accounts[it]?.engine }
        } ?: return SyncStatus.DISABLED
        return engine.status()
    }

    fun syncNow(token: String?): SyncStatus {
        val engine = synchronized(lock) {
            val accountHash = if (token.isNullOrEmpty()) null else sessions[token]
            accountHash?.let { accounts[it]?.engine }
        } ?: return SyncStatus.DISABLED
        return engine.syncNow()
    }

    fun clearAll() {
        val toClose: List<SyncEngine>
        synchronized(lock) {
            toClose = accounts.values.map { it.engine }
            sessions.clear()
            accounts.clear()
            store.setActiveDirectory(null)
            syncRoot.deleteRecursively()
        }
        for (engine in toClose) engine.close()
    }

    fun close() {
        val toClose: List<SyncEngine>
        synchronized(lock) {
            toClose = accounts.values.map { it.engine }
            sessions.clear()
            accounts.clear()
        }
        for (engine in toClose) engine.close()
    }
}
