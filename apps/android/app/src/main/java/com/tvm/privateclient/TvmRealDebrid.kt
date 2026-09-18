package com.tvm.privateclient

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.util.Locale

/**
 * Real-Debrid client.
 *
 * Direct port of apps/ios/TVM/TVMRealDebrid.swift. Endpoints, form bodies,
 * timeouts, retry counts and error strings must stay identical: the same
 * `apps/ui` interface reads the replies built on top of this on both clients.
 *
 * The token never reaches a log, a message or a URL query — only the
 * Authorization header and the torrentio path segment the Swift also builds.
 */

data class RdDownload(
    val id: String,
    val filename: String,
    val mimeType: String?,
    val link: String,
)

data class RdTorrent(
    val id: String,
    val filename: String,
    val status: String,
    val progress: Double,
    val links: List<String>,
)

data class RdTorrentFile(
    val id: Int,
    val path: String,
    val selected: Int,
)

data class RdTorrentInfo(
    val id: String,
    val filename: String,
    val status: String,
    val progress: Double,
    val links: List<String>,
    val files: List<RdTorrentFile>,
)

data class RdUnrestrict(
    val id: String,
    val filename: String,
    val mimeType: String?,
    val download: String,
)

data class RdStream(
    val url: String,
    val title: String,
    val name: String,
    val infoHash: String?,
    val fileIdx: Int?,
    val quality: Int,
    val cached: Boolean,
    val phoneHint: Boolean,
)

/** Mirrors RdClientError; callers distinguish the first two from everything else. */
sealed class RdClientException(message: String) : Exception(message) {
    object NotConfigured : RdClientException("not configured")
    object NeedsAuth : RdClientException("needs auth")
    data class Failed(val reason: String) : RdClientException(reason)
}

/**
 * Where the token lives. iOS reads the Keychain directly from the client; the
 * Android equivalent (EncryptedSharedPreferences) needs a Context, so the store
 * is handed in instead of reached for.
 */
interface RdTokenStore {
    /** Null when unset or empty, matching RdKeychain.read(). */
    fun read(): String?

    /** An empty or whitespace-only token clears the store. Throws when it cannot be written. */
    fun save(token: String)
}

class TvmRealDebrid(private val tokens: RdTokenStore) {

    /** Tests inject a token so they do not have to write the device store. */
    var testToken: String? = null
    var ignoreKeychain: Boolean = false

    /** The signed-in account's own key. It wins over the one saved on the phone. */
    @Volatile
    private var accountToken: String? = null

    /** Returns true when the key in use changed, so cached library data is stale. */
    fun useAccountToken(token: String?): Boolean {
        val next = token?.trim()?.ifEmpty { null }
        if (next == accountToken) return false
        accountToken = next
        return true
    }

    fun hasAccountToken(): Boolean = accountToken != null

    fun configured(): Boolean = tokenValue() != null

    fun tokenValue(): String? {
        accountToken?.let { return it }
        if (ignoreKeychain) return testToken
        val injected = testToken
        if (injected != null && injected.isNotEmpty()) return injected
        return tokens.read()
    }

    suspend fun setToken(token: String): RdStatus {
        tokens.save(token)
        if (token.trim().isEmpty()) {
            return RdStatus(configured = false, username = null, premium = false, error = null)
        }
        return status()
    }

    suspend fun status(): RdStatus {
        if (!configured()) {
            return RdStatus(configured = false, username = null, premium = false, error = null)
        }
        return try {
            val user = requestJson("/user") as? JSONObject
            RdStatus(
                configured = true,
                username = Json.string(user?.opt("username")),
                premium = (Json.int(user?.opt("premium")) ?: 0) > 0,
                error = null,
            )
        } catch (_: RdClientException.NeedsAuth) {
            RdStatus(configured = true, username = null, premium = false, error = "needs-auth")
        } catch (_: Exception) {
            RdStatus(configured = true, username = null, premium = false, error = "unreachable")
        }
    }

    suspend fun downloads(): List<RdDownload> {
        val collected = ArrayList<RdDownload>()
        var offset = 0
        while (offset < 500) {
            val page = requestList("/downloads?limit=100&offset=$offset")
            if (page.isEmpty()) break
            for (raw in page) {
                val id = raw.opt("id") as? String ?: continue
                val filename = raw.opt("filename") as? String ?: continue
                val link = raw.opt("link") as? String ?: continue
                collected.add(
                    RdDownload(
                        id = id,
                        filename = filename,
                        mimeType = raw.opt("mimeType") as? String,
                        link = link,
                    )
                )
            }
            if (page.size < 100) break
            offset += 100
        }
        return collected
    }

    suspend fun torrents(): List<RdTorrent> {
        val collected = ArrayList<RdTorrent>()
        for (page in 1..10) {
            val batch = requestList("/torrents?limit=100&page=$page")
            if (batch.isEmpty()) break
            for (raw in batch) {
                val id = raw.opt("id") as? String ?: continue
                val filename = raw.opt("filename") as? String ?: continue
                collected.add(
                    RdTorrent(
                        id = id,
                        filename = filename,
                        status = raw.opt("status") as? String ?: "",
                        progress = (raw.opt("progress") as? Number)?.toDouble() ?: 0.0,
                        links = stringList(raw.opt("links")),
                    )
                )
            }
            if (batch.size < 100) break
        }
        return collected
    }

    suspend fun torrentInfo(id: String): RdTorrentInfo {
        val raw = requestJson("/torrents/info/$id") as? JSONObject
            ?: throw RdClientException.Failed("torrent info")
        val files = ArrayList<RdTorrentFile>()
        for (file in objectList(raw.opt("files"))) {
            val fileId = Json.int(file.opt("id")) ?: continue
            val path = file.opt("path") as? String ?: continue
            files.add(RdTorrentFile(id = fileId, path = path, selected = Json.int(file.opt("selected")) ?: 0))
        }
        val progress = (raw.opt("progress") as? Number)?.toDouble()
            ?: (Json.int(raw.opt("progress")) ?: 0).toDouble()
        return RdTorrentInfo(
            id = Json.string(raw.opt("id")) ?: id,
            filename = Json.string(raw.opt("filename")) ?: "",
            status = Json.string(raw.opt("status")) ?: "",
            progress = progress,
            links = stringList(raw.opt("links")),
            files = files,
        )
    }

    suspend fun addMagnet(hashOrMagnet: String): String {
        val magnet = if (hashOrMagnet.lowercase(Locale.US).startsWith("magnet:")) {
            hashOrMagnet
        } else {
            "magnet:?xt=urn:btih:$hashOrMagnet"
        }
        val body = "magnet=" + Json.formEncode(magnet)
        val raw = requestJson("/torrents/addMagnet", method = "POST", form = body) as? JSONObject
            ?: throw RdClientException.Failed("add magnet")
        return Json.string(raw.opt("id")) ?: throw RdClientException.Failed("add magnet")
    }

    suspend fun selectTorrentFiles(id: String, files: String = "all") {
        requestJson("/torrents/selectFiles/$id", method = "POST", form = "files=" + Json.formEncode(files))
    }

    suspend fun waitForTorrentLinks(id: String, attempts: Int = 10): List<String> {
        for (step in 0 until attempts) {
            val info = torrentInfo(id)
            if (info.status == "waiting_files_selection" || (info.links.isEmpty() && info.status == "downloaded")) {
                try {
                    selectTorrentFiles(id)
                } catch (_: Exception) {
                }
            }
            if (info.links.isNotEmpty() && (info.status == "downloaded" || info.progress >= 99)) {
                return info.links.filter { it.isNotEmpty() }
            }
            if (info.status == "error" || info.status == "virus" || info.status == "dead") {
                throw RdClientException.Failed("torrent ${info.status}")
            }
            if (step + 1 < attempts) {
                // Blocking, like every request here: the whole client is blocking
                // I/O inside suspend functions and the caller picks the thread.
                Thread.sleep(500)
            }
        }
        val last = torrentInfo(id)
        if (last.links.isNotEmpty()) return last.links.filter { it.isNotEmpty() }
        throw RdClientException.Failed("torrent not ready")
    }

    suspend fun unrestrict(link: String): RdUnrestrict {
        val body = "link=" + Json.formEncode(link)
        val raw = requestJson("/unrestrict/link", method = "POST", form = body) as? JSONObject
            ?: throw RdClientException.Failed("unrestrict")
        val download = raw.opt("download") as? String
        if (download == null || download.isEmpty()) throw RdClientException.Failed("unrestrict")
        return RdUnrestrict(
            id = raw.opt("id") as? String ?: "",
            filename = raw.opt("filename") as? String ?: "stream",
            mimeType = raw.opt("mimeType") as? String,
            download = download,
        )
    }

    /** Returns url to mime, or null when Real-Debrid offers nothing this device opens. */
    suspend fun appleTranscode(id: String, maxHeight: Int): Pair<String, String>? {
        return try {
            val raw = requestJson("/streaming/transcode/$id")
            val obj = raw as? JSONObject ?: return null
            TvmPlayback.appleTranscode(obj, maxHeight)
        } catch (_: Exception) {
            null
        }
    }

    suspend fun resolveRedirect(url: String): String? {
        // URI parses the same shapes Foundation's URL(string:) accepts; java.net.URL
        // is stricter, so only the hosts we actually fetch go through it.
        if (runCatching { URI(url) }.getOrNull() == null) return null
        if (!isTorrentioHost(url)) return url
        var current: URL = runCatching { URL(url) }.getOrNull() ?: return null
        for (hop in 0 until 3) {
            val conn = runCatching { openConnection(current, "GET", follow = false) }.getOrNull() ?: return null
            try {
                conn.setRequestProperty("User-Agent", "tvm-core")
                conn.setRequestProperty("Accept", "*/*")
                val code = conn.responseCode
                if (code < 0) return null
                val data = readBody(conn, code)
                val location = conn.getHeaderField("Location")
                if (location != null) {
                    val next = runCatching { URL(current, location) }.getOrNull()
                    if (next != null) {
                        if (isTorrentioHost(next.toString())) {
                            current = next
                            continue
                        }
                        return next.toString()
                    }
                }
                val type = conn.getHeaderField("Content-Type")
                if (type != null && type.lowercase(Locale.US).contains("json")) {
                    val body = runCatching { JSONTokener(String(data, Charsets.UTF_8)).nextValue() }
                        .getOrNull() as? JSONObject
                    val next = body?.opt("url") as? String
                    if (next != null && next.startsWith("http")) {
                        if (isTorrentioHost(next)) {
                            current = runCatching { URL(next) }.getOrNull() ?: current
                            continue
                        }
                        return next
                    }
                }
                // Redirects are suppressed, so the response URL is the request URL;
                // kept for parity with the Swift, which reads it the same way.
                if (!isTorrentioHost(current.toString())) return current.toString()
                return null
            } catch (_: Exception) {
                return null
            } finally {
                conn.disconnect()
            }
        }
        return null
    }

    suspend fun torrentioStreams(token: String, imdb: String, season: Int?, episode: Int?): List<RdStream> {
        val encoded = Json.formEncode(token)
        val id = TvmTitle.extractImdb(imdb) ?: return emptyList()
        val paths: List<String> = if (season != null && episode != null) {
            listOf(
                "stream/series/$id:$season:$episode.json",
                "stream/series/$id:$season:${String.format(Locale.US, "%02d", episode)}.json",
            )
        } else {
            listOf("stream/movie/$id.json", "stream/series/$id.json")
        }
        val streams = ArrayList<RdStream>()
        val seen = HashSet<String>()
        for (host in TORRENTIO_HOSTS) {
            for (path in paths) {
                val url = runCatching { URL("$host/realdebrid=$encoded/$path") }.getOrNull() ?: continue
                val list = fetchTorrentioStreams(url) ?: continue
                for (raw in list) {
                    val stream = parseDebridStream(raw) ?: continue
                    val key = if (stream.url.isEmpty()) (stream.infoHash ?: "") else stream.url
                    if (key.isEmpty() || !seen.add(key)) continue
                    streams.add(stream)
                }
                if (streams.isNotEmpty()) break
            }
            if (streams.isNotEmpty()) break
        }
        return streams.sortedWith(Comparator<RdStream> { left, right ->
            if (left.cached != right.cached) return@Comparator if (left.cached) -1 else 1
            if (left.phoneHint != right.phoneHint) return@Comparator if (left.phoneHint) -1 else 1
            right.quality.compareTo(left.quality)
        })
    }

    fun parseDebridStream(raw: JSONObject): RdStream? {
        val url = Json.string(raw.opt("url")) ?: ""
        val infoHash = Json.string(raw.opt("infoHash")) ?: Json.string(raw.opt("info_hash"))
        if (url.isEmpty() && (infoHash == null || infoHash.isEmpty())) return null
        if (BLOCKED_URL.containsMatchIn(url)) return null
        val name = Json.string(raw.opt("name")) ?: ""
        val titleSource = Json.string(raw.opt("title")) ?: name
        // Swift's split drops empty lines, so a leading newline is not a blank title.
        val title = titleSource.split("\n").firstOrNull { it.isNotEmpty() } ?: "Stream"
        val label = "$name $title"
        if (CAM_LABEL.containsMatchIn(label)) return null
        val phoneHint = PHONE_LABEL.containsMatchIn(label)
        val cached = CACHED_LABEL.containsMatchIn(label)
        return RdStream(
            url = url,
            title = title,
            name = name,
            infoHash = infoHash,
            fileIdx = Json.int(raw.opt("fileIdx")) ?: Json.int(raw.opt("fileidx")),
            quality = qualityScore(label),
            cached = cached,
            phoneHint = phoneHint,
        )
    }

    fun needsUnrestrict(url: String): Boolean {
        if (url.contains("download.real-debrid.com", ignoreCase = true)) return false
        if (url.contains("real-debrid.com/d/", ignoreCase = true)) return true
        return !PLAYABLE_EXTENSION.containsMatchIn(url)
    }

    fun isTorrentioHost(url: String): Boolean {
        val host = (runCatching { URI(url).host }.getOrNull() ?: "").lowercase(Locale.US)
        return host == "torrentio.strem.fun" || host.endsWith(".strem.fun") || host.contains("torrentio")
    }

    private fun qualityScore(label: String): Int {
        if (UHD.containsMatchIn(label)) return 40
        if (HD1080.containsMatchIn(label)) return 30
        if (HD720.containsMatchIn(label)) return 15
        if (SD480.containsMatchIn(label)) return 5
        return 10
    }

    fun streamHeight(label: String): Int {
        if (UHD.containsMatchIn(label)) return 2160
        if (HD1080.containsMatchIn(label)) return 1080
        if (HD720.containsMatchIn(label)) return 720
        if (SD480.containsMatchIn(label)) return 480
        return 1080
    }

    private fun fetchTorrentioStreams(url: URL): List<JSONObject>? {
        val conn = runCatching { openConnection(url, "GET", follow = true) }.getOrNull() ?: return null
        try {
            conn.setRequestProperty("User-Agent", "tvm-core")
            conn.setRequestProperty("Accept", "application/json")
            val code = conn.responseCode
            if (code !in 200..299) return null
            val data = readBody(conn, code)
            val body = runCatching { JSONTokener(String(data, Charsets.UTF_8)).nextValue() }
                .getOrNull() as? JSONObject ?: return null
            val raw = body.opt("streams")
            if (raw !is JSONArray) return null
            return objectList(raw)
        } catch (_: Exception) {
            return null
        } finally {
            conn.disconnect()
        }
    }

    private suspend fun requestList(path: String): List<JSONObject> {
        val raw = requestJson(path)
        if (raw === JSONObject.NULL) return emptyList()
        return objectList(raw)
    }

    private suspend fun requestJson(path: String, method: String = "GET", form: String? = null): Any {
        val token = tokenValue() ?: throw RdClientException.NotConfigured
        val url = runCatching { URL(API_BASE + path) }.getOrNull()
            ?: throw RdClientException.Failed("bad url")
        val conn = openConnection(url, method, follow = true)
        try {
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("User-Agent", "tvm-core")
            if (form != null) {
                conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
                conn.doOutput = true
                conn.outputStream.use { it.write(form.toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            if (code < 0) throw RdClientException.Failed("no response")
            val data = readBody(conn, code)
            if (code == 401 || code == 403) throw RdClientException.NeedsAuth
            if (code !in 200..299) throw RdClientException.Failed("Real-Debrid replied $code")
            if (data.isEmpty()) return JSONObject.NULL
            val parsed = runCatching { JSONTokener(String(data, Charsets.UTF_8)).nextValue() }.getOrNull()
            if (parsed !is JSONObject && parsed !is JSONArray) throw RdClientException.Failed("bad json")
            return parsed
        } finally {
            conn.disconnect()
        }
    }

    private fun openConnection(url: URL, method: String, follow: Boolean): HttpURLConnection {
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.instanceFollowRedirects = follow
        // The Swift sessions are ephemeral with a 20s request timeout and no cookie jar.
        conn.connectTimeout = TIMEOUT_MS
        conn.readTimeout = TIMEOUT_MS
        conn.useCaches = false
        return conn
    }

    private fun readBody(conn: HttpURLConnection, code: Int): ByteArray {
        val stream = if (code in 200..399) {
            runCatching { conn.inputStream }.getOrNull() ?: conn.errorStream
        } else {
            conn.errorStream
        }
        return stream?.use { runCatching { it.readBytes() }.getOrDefault(ByteArray(0)) } ?: ByteArray(0)
    }

    /** Matches `as? [[String: Any]]`: one non-object element fails the whole cast. */
    private fun objectList(value: Any?): List<JSONObject> {
        val array = value as? JSONArray ?: return emptyList()
        val out = ArrayList<JSONObject>(array.length())
        for (index in 0 until array.length()) {
            val entry = array.opt(index) as? JSONObject ?: return emptyList()
            out.add(entry)
        }
        return out
    }

    /** Matches `as? [String]`: all-or-nothing, and empty strings are kept. */
    private fun stringList(value: Any?): List<String> {
        val array = value as? JSONArray ?: return emptyList()
        val out = ArrayList<String>(array.length())
        for (index in 0 until array.length()) {
            val entry = array.opt(index) as? String ?: return emptyList()
            out.add(entry)
        }
        return out
    }

    private companion object {
        const val API_BASE = "https://api.real-debrid.com/rest/1.0"
        const val TIMEOUT_MS = 20_000

        val TORRENTIO_HOSTS = listOf(
            "https://torrentio.strem.fun",
            "https://torrentio.elfhosted.com",
        )

        val BLOCKED_URL = Regex("failed_access|videos/failed|copyright|infringement", RegexOption.IGNORE_CASE)
        val CAM_LABEL = Regex("""\b(cam|camrip|telesync|tsrip|hdcam|hdts)\b""", RegexOption.IGNORE_CASE)
        val PHONE_LABEL = Regex("""\b(mp4|m4v|mov|h264|x264|avc|aac|hls|m3u8)\b""", RegexOption.IGNORE_CASE)
        val CACHED_LABEL = Regex("""⚡|\bcached\b|\brd\+|\bdownloaded\b""", RegexOption.IGNORE_CASE)
        val PLAYABLE_EXTENSION = Regex(
            """\.(m3u8|mp4|m4v|mkv|webm|mov|avi|ts|m2ts|mpg|mpeg|wmv|mp3|m4a|aac|flac|ogg|wav)(\?|$)""",
            RegexOption.IGNORE_CASE,
        )

        // Quality matching is deliberately case-sensitive, as in the Swift: "4K" scores
        // as the 10-point default, not as UHD.
        val UHD = Regex("""\b2160p|4k|uhd\b""")
        val HD1080 = Regex("""\b1080p\b""")
        val HD720 = Regex("""\b720p\b""")
        val SD480 = Regex("""\b480p\b""")
    }
}
