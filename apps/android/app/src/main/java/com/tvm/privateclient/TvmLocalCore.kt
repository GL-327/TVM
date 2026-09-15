package com.tvm.privateclient

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.util.Locale

/**
 * The on-device API, port of apps/ios/TVM/TVMLocalCore.swift.
 *
 * Every route here answers the same shape the desktop core answers, because the
 * same `apps/ui` bundle is talking to it. When changing a response, change the
 * Swift too or the two phones drift apart.
 *
 * `handle` is deliberately blocking: TvmLocalServer calls it from a worker
 * thread, one request per thread, so bridging into the suspending modules with
 * runBlocking costs nothing and keeps the server free of coroutine plumbing.
 */
class TvmLocalCore(
    val store: TvmStore,
    val catalog: TvmCatalog,
    val rd: TvmRealDebrid,
    val plans: TvmPlans,
    val media: TvmMedia,
) {
    private val startedAt = System.currentTimeMillis()
    private val lock = Any()

    private var liveUrl: String? = null
    private var liveHost: String? = null
    private var liveUser: String? = null
    private var liveChannels: MutableList<JSONObject> = mutableListOf()
    private var livePicks: MutableSet<String> = mutableSetOf()

    companion object {
        private const val PICK_LIMIT = 48
        private const val MAX_CHANNELS = 2000

        /** Wires the whole stack against one data directory and the bundled catalogue. */
        fun create(root: File, bundledCatalog: () -> String?): TvmLocalCore {
            val store = TvmStore(root)
            RdKeychain.attach(root)
            XtreamKeychain.attach(root)
            val catalog = TvmCatalog(store, bundledCatalog)
            val rd = TvmRealDebrid(RdKeychain)
            val plans = TvmPlans(root)
            val media = TvmMedia(store, catalog, rd, plans)
            return TvmLocalCore(store, catalog, rd, plans, media)
        }
    }

    init {
        val saved = store.readJSON("live.json") as? JSONObject
        if (saved != null) {
            liveUrl = Json.string(saved.opt("url"))
            liveHost = Json.string(saved.opt("host"))
            liveUser = Json.string(saved.opt("username"))
            livePicks = Json.strings(saved.opt("picks")).toMutableSet()
            val channels = saved.optJSONArray("channels")
            if (channels != null) {
                for (i in 0 until channels.length()) {
                    channels.optJSONObject(i)?.let { liveChannels.add(it) }
                }
            }
        }
    }

    fun handle(method: String, path: String, query: String, body: ByteArray): HttpReply = runBlocking {
        route(method, path, parseQuery(query), Json.parseObject(body.toString(Charsets.UTF_8)))
    }

    private suspend fun route(
        method: String,
        path: String,
        query: Map<String, String>,
        json: JSONObject,
    ): HttpReply {
        media.applyProfileHeader(null)

        if (path == "/api/health" && method == "GET") {
            return HttpReply.json(
                200,
                Json.obj(
                    "status" to "ok",
                    "version" to StandalonePolicy.VERSION,
                    "uptimeSeconds" to ((System.currentTimeMillis() - startedAt) / 1000).toInt(),
                    "mode" to "standalone",
                ),
            )
        }

        if (path == "/api/update/status" && method == "GET") return HttpReply.json(200, updateStatus())
        if (path == "/api/update/check" && method == "POST") return HttpReply.json(200, updateStatus())
        if (path == "/api/update/apply" && method == "POST") {
            return HttpReply.json(
                409,
                Json.obj("ok" to false, "error" to "This phone app updates through your app installer, not from inside TVM."),
            )
        }
        if (path == "/api/update/token" && method == "PUT") return HttpReply.json(200, Json.obj("ok" to true))

        if (path == "/api/rd/status" && method == "GET") return HttpReply.json(200, media.status().json())
        if (path == "/api/rd/configured" && method == "GET") {
            return HttpReply.json(200, Json.obj("configured" to rd.configured()))
        }
        if (path == "/api/rd/token" && method == "PUT") {
            val token = Json.string(json.opt("token")) ?: ""
            return HttpReply.json(200, media.setToken(token).json())
        }

        if (path == "/api/profiles" && method == "GET") return HttpReply.json(200, media.profilesJson())
        if (path == "/api/profiles" && method == "POST") {
            return HttpReply.json(200, media.createProfile(Json.string(json.opt("name")) ?: ""))
        }
        if (path == "/api/profiles" && method == "PUT") {
            val id = Json.string(json.opt("id")) ?: return HttpReply.json(400, Json.obj("error" to "id is required"))
            return HttpReply.json(200, media.renameProfile(id, Json.string(json.opt("name")) ?: ""))
        }
        if (path == "/api/profiles/active" && method == "POST") {
            val id = Json.string(json.opt("id")) ?: return HttpReply.json(400, Json.obj("error" to "id is required"))
            return HttpReply.json(200, media.switchProfile(id))
        }
        if (path == "/api/profiles/remove" && method == "POST") {
            val id = Json.string(json.opt("id")) ?: return HttpReply.json(400, Json.obj("error" to "id is required"))
            return HttpReply.json(200, media.removeProfile(id))
        }

        if (path == "/api/apps" && method == "GET") return HttpReply.json(200, media.appsList())
        if (path.startsWith("/api/apps/") && method == "GET") {
            val id = path.removePrefix("/api/apps/")
            val hub = media.appHub(id) ?: return HttpReply.json(404, Json.obj("error" to "not_found"))
            return HttpReply.json(200, hub)
        }

        if (path == "/api/home" && method == "GET") return HttpReply.json(200, media.home())
        if (path == "/api/library" && method == "GET") {
            return HttpReply.json(200, Json.obj("items" to Json.array(media.library().map { it.json() })))
        }
        if (path == "/api/media" && method == "GET") {
            val id = query["id"] ?: return HttpReply.json(400, Json.obj("error" to "id is required"))
            val item = media.item(id) ?: return HttpReply.json(404, Json.obj("error" to "not_found"))
            return HttpReply.json(200, item.json())
        }
        if (path == "/api/media/children" && method == "GET") {
            val id = query["id"] ?: return HttpReply.json(400, Json.obj("error" to "id is required"))
            return HttpReply.json(200, Json.obj("items" to Json.array(media.children(id).map { it.json() })))
        }

        if (path == "/api/watchlist" && method == "GET") {
            return HttpReply.json(200, Json.obj("items" to Json.array(media.watchlist().map { it.json() })))
        }
        if (path == "/api/watchlist" && method == "PUT") {
            return HttpReply.json(200, Json.obj("items" to Json.array(media.addWatchlist(json.opt("item")).map { it.json() })))
        }
        if (path == "/api/watchlist/remove" && method == "POST") {
            val id = Json.string(json.opt("id")) ?: ""
            return HttpReply.json(200, Json.obj("items" to Json.array(media.removeWatchlist(id).map { it.json() })))
        }

        if (path == "/api/search" && method == "GET") {
            val q = query["q"] ?: ""
            return HttpReply.json(200, Json.obj("items" to Json.array(media.search(q).map { it.json() })))
        }

        if (path == "/api/playback" && method == "POST") {
            val id = Json.string(json.opt("id"))
            if (id != null && id.startsWith("live:")) return playLive(id)
            val (status, payload) = media.play(
                id,
                Json.string(json.opt("link")),
                Json.string(json.opt("title")),
                Json.int(json.opt("season")),
                Json.int(json.opt("episode")),
            )
            return HttpReply.json(status, payload)
        }

        if (path == "/api/progress" && method == "POST") {
            val id = Json.string(json.opt("id")) ?: return HttpReply.json(400, Json.obj("error" to "id is required"))
            media.saveProgress(
                id,
                Json.double(json.opt("position")) ?: 0.0,
                Json.double(json.opt("duration")) ?: 0.0,
            )
            return HttpReply.json(200, Json.obj("ok" to true))
        }

        if (path == "/api/art" && (method == "GET" || method == "HEAD")) {
            return art(query["src"] ?: "", method == "HEAD")
        }

        if (path == "/api/plan" && method == "GET") return HttpReply.json(200, plans.status())
        if (path == "/api/plan" && method == "PUT") {
            val id = Json.string(json.opt("id")) ?: return HttpReply.json(400, Json.obj("error" to "id is required"))
            return HttpReply.json(200, plans.setPlan(id))
        }
        if (path == "/api/plan/style" && method == "POST") {
            return HttpReply.json(200, plans.setStyle(Json.string(json.opt("id")) ?: ""))
        }
        if (path == "/api/plan/live-tv" && method == "POST") {
            return HttpReply.json(200, plans.setLiveTv(json.optBoolean("enabled", false)))
        }
        if (path == "/api/plan/synthwave" && method == "POST") {
            return HttpReply.json(200, plans.setSynthwave(json.optBoolean("enabled", false)))
        }

        if (path == "/api/billing" && method == "GET") return HttpReply.json(200, plans.billing())
        if (path == "/api/billing/cancel" && method == "POST") return HttpReply.json(200, plans.cancel())
        if (path == "/api/billing/checkout" && method == "POST") return HttpReply.json(200, plans.checkout(json))
        if (path == "/api/billing/charge" && method == "POST") return HttpReply.json(200, plans.charge())

        if (path == "/api/usage/tick" && method == "POST") return HttpReply.json(200, plans.status())
        if (path == "/api/usage/reset" && method == "POST") return HttpReply.json(200, plans.status())
        if (path == "/api/ads/preroll" && method == "GET") return HttpReply.json(200, Json.obj("ads" to JSONArray()))

        if (path == "/api/dev/status" && method == "GET") {
            return HttpReply.json(200, Json.obj("unlocked" to plans.developer()))
        }
        if (path == "/api/dev/unlock" && method == "POST") {
            return HttpReply.json(
                403,
                Json.obj(
                    "unlocked" to false,
                    "error" to "Developer unlock is available on the desktop Core, not on this phone app.",
                ),
            )
        }
        if (path == "/api/dev/lock" && method == "POST") {
            plans.setDeveloper(false)
            return HttpReply.json(200, Json.obj("unlocked" to false))
        }
        if (path == "/api/dev/overrides" && method == "PUT") {
            return HttpReply.json(403, Json.obj("error" to "developer_required"))
        }

        if (path == "/api/system/session" && method == "GET") {
            return HttpReply.json(200, Json.obj("appliance" to false, "mode" to "unknown"))
        }
        if (path == "/api/system/session" && method == "POST") {
            return HttpReply.json(409, Json.obj("ok" to false, "reason" to "not_appliance"))
        }

        if (path == "/api/maintenance/clear-cache" && method == "POST") {
            media.clearCache()
            return HttpReply.json(200, Json.obj("ok" to true))
        }
        if (path == "/api/privacy/export" && method == "GET") {
            val registry = store.profiles()
            return HttpReply.json(200, store.personalExport(registry.activeId, registry.profiles, plans.billing()))
        }
        if ((path == "/api/maintenance/factory-reset" || path == "/api/privacy/erase") && method == "POST") {
            if (path == "/api/privacy/erase" && Json.string(json.opt("confirmation")) != "ERASE_LOCAL_DATA") {
                return HttpReply.json(400, Json.obj("error" to "confirmation_required"))
            }
            store.factoryReset()
            media.clearCache()
            synchronized(lock) {
                liveUrl = null
                liveHost = null
                liveUser = null
                liveChannels = mutableListOf()
                livePicks = mutableSetOf()
            }
            return HttpReply.json(200, Json.obj("ok" to true))
        }

        if (path == "/api/live" && method == "GET") return HttpReply.json(200, liveStatus())
        if (path == "/api/live" && method == "PUT") {
            val text = Json.string(json.opt("text")) ?: ""
            val url = Json.string(json.opt("url")) ?: ""
            if (text.isEmpty() && url.isEmpty()) {
                return HttpReply.json(400, Json.obj("error" to "url or playlist text is required"))
            }
            setPlaylist(text.ifEmpty { url })
            return HttpReply.json(200, liveStatus())
        }
        if (path == "/api/live/xtream" && method == "PUT") return setXtream(json)
        if (path == "/api/live/xtream" && method == "DELETE") {
            synchronized(lock) {
                liveHost = null
                liveUser = null
            }
            XtreamKeychain.clear()
            persistLive()
            return HttpReply.json(200, liveStatus())
        }
        if (path == "/api/live/catalog" && method == "GET") {
            return HttpReply.json(
                200,
                liveCatalog(query["q"] ?: "", query["group"] ?: "", query["offset"]?.toIntOrNull() ?: 0),
            )
        }
        if (path == "/api/live/picks" && method == "PUT") {
            synchronized(lock) { livePicks = Json.strings(json.opt("ids")).toMutableSet() }
            persistLive()
            return HttpReply.json(200, liveStatus())
        }
        if (path == "/api/live/picks" && method == "POST") {
            val id = Json.string(json.opt("id"))
            if (id != null && json.has("picked")) {
                synchronized(lock) {
                    if (json.optBoolean("picked", false)) livePicks.add(id) else livePicks.remove(id)
                }
                persistLive()
            }
            return HttpReply.json(200, liveStatus())
        }
        if (path == "/api/live/picks/group" && method == "POST") return HttpReply.json(200, liveStatus())

        if (path == "/api/lan/session") {
            return HttpReply.json(
                404,
                Json.obj(
                    "error" to "standalone_mode",
                    "reason" to "This Android app runs its own core. A LAN token is not required.",
                ),
            )
        }

        return HttpReply.json(404, Json.obj("error" to "not_found"))
    }

    private fun updateStatus(): JSONObject = Json.obj(
        "current" to StandalonePolicy.VERSION,
        "latest" to StandalonePolicy.VERSION,
        "updateAvailable" to false,
        "channel" to "standalone",
        "checkedAt" to JSONObject.NULL,
        "notes" to "This phone app updates through your app installer.",
    )

    private fun playLive(id: String): HttpReply {
        if (!Json.bool(plans.status().opt("liveTv"), false)) {
            return HttpReply.json(
                409,
                Json.obj("kind" to "unavailable", "reason" to "Live TV requires the Live TV add-on."),
            )
        }
        val channel = synchronized(lock) { liveChannels.firstOrNull { it.optString("id") == id } }
            ?: return HttpReply.json(409, Json.obj("kind" to "unavailable", "reason" to "not-in-library"))
        val raw = Json.string(channel.opt("url"))
            ?: return HttpReply.json(409, Json.obj("kind" to "unavailable", "reason" to "not-in-library"))
        if (!TvmPlayback.nativeCanOpen(raw)) {
            return HttpReply.json(409, Json.obj("kind" to "unavailable", "reason" to "not-in-library"))
        }
        /*
         * The native decoder opens the provider directly, so it sniffs the real
         * container itself. The extension is only a hint for which reader to
         * prefer; an extensionless Xtream URL serving MPEG-TS still plays.
         */
        val path = runCatching { URI(raw).path ?: "" }.getOrDefault("")
        val hls = path.substringAfterLast('.', "").lowercase(Locale.US) == "m3u8"
        return HttpReply.json(
            200,
            Json.obj(
                "kind" to "stream",
                "url" to raw,
                "title" to (Json.string(channel.opt("name")) ?: "Live TV"),
                "filename" to path.substringAfterLast('/', ""),
                "mimeType" to if (hls) "application/vnd.apple.mpegurl" else "video/mp2t",
                "engine" to "native",
                "transport" to if (hls) "hls" else "ts-live",
                "isLive" to true,
            ),
        )
    }

    private fun groupSummary(): JSONArray {
        val out = JSONArray()
        val grouped = synchronized(lock) { liveChannels.groupBy { it.optString("group", "Other").ifEmpty { "Other" } } }
        for ((name, list) in grouped) {
            out.put(
                Json.obj(
                    "name" to name,
                    "count" to list.size,
                    "picked" to list.count { livePicks.contains(it.optString("id")) },
                ),
            )
        }
        return out
    }

    private fun card(channel: JSONObject): JSONObject {
        val copy = JSONObject(channel.toString())
        copy.put("picked", livePicks.contains(channel.optString("id")))
        copy.remove("url") // the URL carries the subscription credentials
        return copy
    }

    private fun liveStatus(): JSONObject = synchronized(lock) {
        Json.obj(
            "url" to liveUrl,
            "host" to liveHost,
            "username" to liveUser,
            "configured" to (liveUrl != null || liveHost != null),
            "channels" to Json.array(liveChannels.take(PICK_LIMIT).map { card(it) }),
            "error" to if (liveChannels.isEmpty() && liveUrl != null) {
                "The playlist had no channels this phone can list."
            } else {
                null
            },
            "picked" to livePicks.size,
            "total" to liveChannels.size,
            "groups" to groupSummary(),
            "needsPicks" to (livePicks.isEmpty() && liveChannels.size > PICK_LIMIT),
            "pickLimit" to PICK_LIMIT,
        )
    }

    private fun liveCatalog(q: String, group: String, offset: Int): JSONObject {
        val matched = synchronized(lock) {
            var items: List<JSONObject> = liveChannels
            if (q.isNotEmpty()) {
                items = items.filter { it.optString("name", "").contains(q, ignoreCase = true) }
            }
            if (group.isNotEmpty()) {
                items = items.filter { it.optString("group", "") == group }
            }
            items
        }
        val page = matched.drop(maxOf(0, offset)).take(PICK_LIMIT)
        return Json.obj(
            "items" to Json.array(page.map { card(it) }),
            "groups" to groupSummary(),
            "total" to synchronized(lock) { liveChannels.size },
            "matched" to matched.size,
            "offset" to offset,
            "limit" to PICK_LIMIT,
            "picked" to livePicks.size,
            "pickLimit" to PICK_LIMIT,
            "query" to q,
            "group" to group.ifEmpty { null },
        )
    }

    private fun setXtream(json: JSONObject): HttpReply {
        val host = Json.string(json.opt("host"))
        val username = Json.string(json.opt("username"))
        val password = Json.string(json.opt("password"))
        if (host == null || username == null || password == null) {
            return HttpReply.json(400, Json.obj("error" to "host, username and password are required"))
        }
        val base = runCatching { URI(host) }.getOrNull()
        val scheme = base?.scheme?.lowercase(Locale.US)
        if (base == null || (scheme != "http" && scheme != "https") || base.host.isNullOrEmpty() || base.userInfo != null) {
            return HttpReply.json(400, Json.obj("error" to "Enter a valid HTTP or HTTPS provider address."))
        }
        val trimmed = base.path.orEmpty().trim('/')
        val path = if (trimmed.isEmpty()) "/get.php" else "/$trimmed/get.php"
        val port = if (base.port > 0) ":${base.port}" else ""
        // output=ts, not m3u8: many panels generate an HLS manifest whose
        // segments their CDN then refuses with 403. See xtreamStreamUrl in
        // apps/core/src/providers/xtream.ts.
        val target = "$scheme://${base.host}$port$path" +
            "?username=${Json.formEncode(username)}&password=${Json.formEncode(password)}" +
            "&type=m3u_plus&output=ts"

        val text = fetchText(target, 15_000)
        if (text == null || !text.contains("#EXTM3U")) {
            return HttpReply.json(
                400,
                Json.obj("error" to "The provider did not return an HLS playlist. Check your login and provider HLS support."),
            )
        }
        val channels = parseM3u(text)
        if (channels.isEmpty()) {
            return HttpReply.json(400, Json.obj("error" to "The provider playlist contains no channels."))
        }
        synchronized(lock) {
            liveChannels = channels.toMutableList()
            liveUrl = "xtream"
            liveHost = host
            liveUser = username
        }
        XtreamKeychain.save(password)
        persistLive()
        return HttpReply.json(200, liveStatus())
    }

    private fun setPlaylist(value: String) {
        if (value.startsWith("http")) {
            val text = fetchText(value, 20_000)
            synchronized(lock) {
                liveUrl = value
                liveChannels = (if (text == null) emptyList() else parseM3u(text)).toMutableList()
            }
        } else {
            synchronized(lock) {
                liveUrl = "local"
                liveChannels = parseM3u(value).toMutableList()
            }
        }
        persistLive()
    }

    /** IPTV panels answer players, not browsers — see LIVE_UA in apps/core. */
    private fun fetchText(target: String, timeoutMs: Int): String? = runCatching {
        val connection = URL(target).openConnection() as HttpURLConnection
        connection.requestMethod = "GET"
        connection.connectTimeout = timeoutMs
        connection.readTimeout = timeoutMs
        connection.instanceFollowRedirects = true
        connection.setRequestProperty("User-Agent", "VLC/3.0.20 LibVLC/3.0.20")
        connection.setRequestProperty("Accept", "*/*")
        try {
            if (connection.responseCode !in 200..299) return null
            connection.inputStream.bufferedReader(Charsets.UTF_8).use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }.getOrNull()

    private val groupPattern = Regex("""group-title="([^"]*)"""")
    private val logoPattern = Regex("""tvg-logo="([^"]*)"""")

    private fun parseM3u(text: String): List<JSONObject> {
        val channels = mutableListOf<JSONObject>()
        var pendingName = "Channel"
        var pendingGroup = "Other"
        var pendingLogo = ""
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.startsWith("#EXTINF")) {
                pendingName = line.substringAfterLast(',', "").ifEmpty { "Channel" }
                pendingGroup = groupPattern.find(line)?.groupValues?.getOrNull(1)?.ifEmpty { "Other" } ?: "Other"
                pendingLogo = logoPattern.find(line)?.groupValues?.getOrNull(1) ?: ""
            } else if (line.startsWith("http")) {
                channels.add(
                    Json.obj(
                        "id" to "live:${channels.size + 1}",
                        "name" to pendingName,
                        "url" to line,
                        "group" to pendingGroup,
                        "logo" to pendingLogo,
                    ),
                )
                if (channels.size >= MAX_CHANNELS) break
            }
        }
        return channels
    }

    private fun persistLive() {
        synchronized(lock) {
            store.writeJSON(
                "live.json",
                Json.obj(
                    "url" to (liveUrl ?: ""),
                    "host" to (liveHost ?: ""),
                    "username" to (liveUser ?: ""),
                    "picks" to JSONArray(livePicks.toList()),
                    "channels" to Json.array(liveChannels),
                ),
            )
        }
    }

    /**
     * Artwork proxy. Only absolute http(s) images are fetched, so a crafted
     * `src` cannot reach a file:// path or this app's own loopback API.
     */
    private fun art(src: String, head: Boolean): HttpReply {
        val decoded = runCatching { URLDecoder.decode(src, "UTF-8") }.getOrDefault(src)
        if (!TvmPlayback.nativeCanOpen(decoded)) return HttpReply.json(400, Json.obj("error" to "bad_src"))
        val host = runCatching { URI(decoded).host }.getOrNull().orEmpty()
        if (host.equals("127.0.0.1", true) || host.equals("localhost", true)) {
            return HttpReply.json(400, Json.obj("error" to "bad_src"))
        }
        return runCatching {
            val connection = URL(decoded).openConnection() as HttpURLConnection
            connection.requestMethod = if (head) "HEAD" else "GET"
            connection.connectTimeout = 10_000
            connection.readTimeout = 15_000
            connection.instanceFollowRedirects = true
            try {
                if (connection.responseCode !in 200..299) return HttpReply.json(404, Json.obj("error" to "not_found"))
                val type = connection.contentType ?: "image/jpeg"
                if (head) return HttpReply.bytes(200, type, ByteArray(0))
                HttpReply.bytes(200, type, connection.inputStream.use { it.readBytes() })
            } finally {
                connection.disconnect()
            }
        }.getOrElse { HttpReply.json(404, Json.obj("error" to "not_found")) }
    }

    private fun parseQuery(query: String): Map<String, String> {
        if (query.isEmpty()) return emptyMap()
        val out = mutableMapOf<String, String>()
        for (pair in query.split('&')) {
            if (pair.isEmpty()) continue
            val eq = pair.indexOf('=')
            val key = if (eq >= 0) pair.substring(0, eq) else pair
            val value = if (eq >= 0) pair.substring(eq + 1) else ""
            val decodedKey = runCatching { URLDecoder.decode(key, "UTF-8") }.getOrDefault(key)
            val decodedValue = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
            out[decodedKey] = decodedValue
        }
        return out
    }
}
