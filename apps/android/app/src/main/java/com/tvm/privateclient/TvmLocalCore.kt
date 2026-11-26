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
import kotlin.concurrent.thread

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
    app: TvmAppBundle = TvmAppBundle.None,
    private val bundledAccess: () -> String? = { null },
    http: TvmHttp = TvmHttp.Default,
    val content: TvmContent = TvmContent(store, http = http),
    val reviews: TvmReviews = TvmReviews(media::item),
    accountsHttp: TvmAccountsHttp = TvmAccountsHttp.Default,
    sessionVault: TvmSessionVault = MemorySessionVault(),
    adminVault: TvmSessionVault = MemorySessionVault(),
    guideCacheDir: File = store.file("cache/guide"),
) {
    private val accounts = TvmAccounts(bundledAccess, accountsHttp, sessionVault, adminVault = adminVault)

    /** The app came back to the foreground: forget cached account, key and config answers so changes show at once. */
    fun onForeground() {
        accounts.invalidateCaches()
    }

    /** The interface this app serves, and the updater that keeps it current. */
    val bundledUi = TvmBundledUi(store, app)
    val updater = TvmUpdater(store, bundledUi, http)

    /** Set by the Android shell: pictures kept on the phone (see TvmArtCache). */
    @Volatile
    var artCache: TvmArtCache? = null
    /** Downloads to a folder on the phone (TvmDownloads), set by MainActivity. */
    var downloads: TvmDownloads? = null

    /** Set by the Android shell: run its app-update check when the interface asks for a check. */
    @Volatile
    var onUpdateCheck: (() -> Unit)? = null

    /**
     * Dev mode belongs to an owner (admin) account, so dev-only routes check
     * who is asking. Any app on the phone can reach this server, not just TVM.
     */
    private fun devRequest(headers: Map<String, String>): Boolean {
        val account = accounts.resolve(bearerToken(headers)) ?: return false
        if (account.text("role") != "dev") return false
        if (!plans.developer()) plans.setDeveloper(true)
        return true
    }

    private fun bearerToken(headers: Map<String, String>): String? {
        val dedicated = headers["x-tvm-account"]?.trim().orEmpty()
        if (dedicated.isNotEmpty()) return dedicated
        val raw = headers["authorization"] ?: return null
        return if (raw.startsWith("Bearer ")) raw.removePrefix("Bearer ") else null
    }

    /** Keeps the plan engine agreeing with the account on every read. */
    private fun applyAccountTier(account: JSONObject) {
        val usable = accounts.usable(account)
        val tier = account.text("tier")
        if (usable.optBoolean("ok") && tier.isNotEmpty()) plans.grantTier(tier) else plans.revokeTier()
    }

    private val startedAt = System.currentTimeMillis()
    private val lock = Any()

    private var liveUrl: String? = null
    private var liveHost: String? = null
    private var liveUser: String? = null
    private var liveChannels: MutableList<JSONObject> = mutableListOf()
    private var livePicks: MutableSet<String> = mutableSetOf()
    private val liveReflector = TvmLiveReflector()
    private val liveGuide = TvmLiveGuide(guideCacheDir)
    private var liveGuideUrls: List<String> = emptyList()

    companion object {
        private val ADMIN_ACCOUNT_PATH = Regex("^/api/admin/accounts/[A-Za-z0-9_-]{1,128}/(?:sessions|profile|password|tier)$|^/api/admin/accounts/[A-Za-z0-9_-]{1,128}/sessions/[A-Za-z0-9_-]{1,128}$")
        private const val PICK_LIMIT = 48
        private const val MAX_CHANNELS = 2000

        /** DW News, straight from Deutsche Welle. Same test channel as apps/core/src/providers/live.ts. */
        const val TEST_CHANNEL_URL = "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8"

        /** Wires the whole stack against one data directory and the bundled catalogue. */
        fun create(
            root: File,
            bundledCatalog: () -> String?,
            app: TvmAppBundle = TvmAppBundle.None,
            bundledAccess: () -> String? = { null },
            bundledContent: (String) -> String? = { null },
            http: TvmHttp = TvmHttp.Default,
            accountsHttp: TvmAccountsHttp = TvmAccountsHttp.Default,
            sessionVault: TvmSessionVault = MemorySessionVault(),
            adminVault: TvmSessionVault = MemorySessionVault(),
            guideCacheDir: File = File(root, "cache/guide"),
        ): TvmLocalCore {
            val store = TvmStore(root)
            RdKeychain.attach(root)
            XtreamKeychain.attach(root)
            val content = TvmContent(store, bundledContent, http)
            val pinGuard = PinGuard()
            val catalog = TvmCatalog(store, bundledCatalog)
            val rd = TvmRealDebrid(RdKeychain)
            val plans = TvmPlans(root)
            val media = TvmMedia(store, catalog, rd, plans, content, pinGuard)
            val reviews = TvmReviews(media::item)
            return TvmLocalCore(store, catalog, rd, plans, media, app, bundledAccess, http, content, reviews, accountsHttp, sessionVault, adminVault, guideCacheDir)
        }
    }

    init {
        val saved = store.readJSON("live.json") as? JSONObject
        if (saved != null) {
            liveUrl = Json.string(saved.opt("url"))
            liveHost = Json.string(saved.opt("host"))
            liveUser = Json.string(saved.opt("username"))
            liveGuideUrls = Json.strings(saved.opt("guideUrls"))
            livePicks = Json.strings(saved.opt("picks")).toMutableSet()
            val channels = saved.optJSONArray("channels")
            if (channels != null) {
                for (i in 0 until channels.length()) {
                    channels.optJSONObject(i)?.let { liveChannels.add(it) }
                }
            }
        }
        // Older installs saved the channel rows without the playlist's EPG header.
        val previousUrl = liveUrl
        if (saved != null && !saved.has("guideUrls") && liveHost.isNullOrEmpty() && previousUrl?.startsWith("http") == true) {
            thread(name = "tvm-guide-playlist", isDaemon = true) {
                val text = fetchText(previousUrl, 20_000)
                if (text != null && text.contains("#EXTM3U")) synchronized(lock) {
                    if (liveUrl == previousUrl && liveHost.isNullOrEmpty()) {
                        val channels = parseM3u(text)
                        if (channels.isNotEmpty()) liveChannels = channels.toMutableList()
                        persistLive()
                    }
                }
            }
        }
    }

    fun handle(
        method: String,
        path: String,
        query: String,
        body: ByteArray,
        headers: Map<String, String> = emptyMap(),
    ): HttpReply = runBlocking {
        /*
         * A module that throws must still produce an answer. An uncaught
         * exception used to end the request with no response at all, which the
         * interface can only show as a network failure — a locked style or a
         * declined checkout looked like the app had lost its core. The Swift
         * core answers these with 400 and the reason, and so does this one.
         */
        try {
            route(method, path, parseQuery(query), Json.parseObject(body.toString(Charsets.UTF_8)), headers)
        } catch (pin: PinException) {
            HttpReply.json(pin.httpStatus, pin.json())
        } catch (problem: Exception) {
            HttpReply.json(400, Json.obj("error" to (problem.message ?: "request failed")))
        }
    }

    private suspend fun route(
        method: String,
        path: String,
        query: Map<String, String>,
        json: JSONObject,
        headers: Map<String, String> = emptyMap(),
    ): HttpReply {
        media.applyProfileHeader(headers["x-tvm-profile"])
        // An account's own Real-Debrid key wins over the one saved on the phone.
        // Skipped for stream segments and artwork, which never touch it.
        if (!path.startsWith("/api/live/proxy/") && path != "/api/art") {
            if (rd.useAccountToken(accounts.rdTokenFor(bearerToken(headers)))) media.forgetLibrary()
        }

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

        if (path == "/api/prefs" && method == "GET") return HttpReply.json(200, TvmPrefs.load(store).json())
        if (path == "/api/prefs" && method == "PUT") {
            val prefs = TvmPrefs.load(store).merge(json)
            prefs.save(store)
            return HttpReply.json(200, prefs.json())
        }
        if (path == "/api/config" && method == "GET") return HttpReply.json(200, accounts.config())
        if (path == "/api/announcement" && method == "GET") return HttpReply.json(200, accounts.announcement())
        // Hero clips, theme songs and yt-dlp need a desktop; phones say so and the interface hides the feature.
        if (path.startsWith("/api/extras/") && path != "/api/extras/surprise" && (method == "GET" || method == "HEAD")) {
            return HttpReply.json(404, Json.obj("status" to "unavailable", "error" to "unavailable"))
        }
        if (path == "/api/extras/surprise" && method == "GET") {
            val pool = media.watchlist()
            return HttpReply.json(200, Json.obj("item" to (if (pool.isEmpty()) null else pool.random().json())))
        }
        if (path == "/api/progress/remove" && method == "POST") {
            val id = Json.string(json.opt("id"))
            if (id == null || !TvmWebhook.isValidProgressId(id)) return HttpReply.json(400, Json.obj("error" to "invalid progress id"))
            store.removeContinueWatching(media.activeProfile(), id)
            return HttpReply.json(200, Json.obj("ok" to true))
        }
        if (path == "/api/progress/watched" && method == "POST") {
            val id = Json.string(json.opt("id"))
            val watched = json.opt("watched") as? Boolean
            if (id == null || watched == null || !TvmWebhook.isValidProgressId(id)) {
                return HttpReply.json(400, Json.obj("error" to "invalid progress"))
            }
            val season = Json.int(json.opt("season"))
            val episode = Json.int(json.opt("episode"))
            val target = if (season != null && season >= 0 && episode != null && episode >= 1 && !Regex(""":\d+:\d+$""").containsMatchIn(id)) {
                "$id:$season:$episode"
            } else id
            if (!TvmWebhook.isValidProgressId(target)) return HttpReply.json(400, Json.obj("error" to "invalid progress id"))
            store.setWatched(media.activeProfile(), target, watched)
            return HttpReply.json(200, Json.obj("ok" to true))
        }
        if (path == "/api/update/status" && method == "GET") return HttpReply.json(200, updater.snapshot())
        if (path == "/api/update/check" && method == "POST") {
            val result = updater.check()
            // Settings → Updates → Check now also asks whether a newer app (APK)
            // is out; the Android shell answers that with its own prompt.
            runCatching { onUpdateCheck?.invoke() }
            return HttpReply.json(200, result)
        }
        if (path == "/api/update/apply" && method == "POST") {
            return try {
                HttpReply.json(200, updater.apply())
            } catch (problem: Exception) {
                HttpReply.json(400, Json.obj("error" to "apply_refused", "reason" to (problem.message ?: "apply failed")))
            }
        }
        if (path == "/api/update/changelog" && method == "GET") {
            return HttpReply.json(200, TvmChangelog.record(store) ?: TvmChangelog.empty())
        }
        if (path == "/api/update/changelog/seen" && method == "POST") {
            return HttpReply.json(200, TvmChangelog.markSeen(store))
        }
        if (path == "/api/update/token" && method == "PUT") return HttpReply.json(200, Json.obj("configured" to false))

        if (path == "/api/rd/status" && method == "GET") return HttpReply.json(200, rdStatusJson(media.status()))
        if (path == "/api/rd/configured" && method == "GET") {
            return HttpReply.json(200, Json.obj("configured" to rd.configured()))
        }
        if (path == "/api/rd/token" && method == "PUT") {
            val token = json.opt("token") as? String
                ?: return HttpReply.json(400, Json.obj("error" to "token must be a string"))
            // A member's key goes on their account at the service. The owner's key is the phone's.
            val sessionToken = bearerToken(headers)
            val self = accounts.resolve(sessionToken)
            if (sessionToken != null && self != null && self.text("role") != "dev") {
                val saved = accounts.setRdToken(sessionToken, token)
                if (saved.isFailure) {
                    return HttpReply.json(400, Json.obj("error" to (saved.exceptionOrNull()?.message ?: "token rejected")))
                }
                if (rd.useAccountToken(accounts.rdTokenFor(bearerToken(headers)))) media.forgetLibrary()
                return HttpReply.json(200, rdStatusJson(media.status()))
            }
            return try {
                HttpReply.json(200, rdStatusJson(media.setToken(token)))
            } catch (problem: Exception) {
                HttpReply.json(400, Json.obj("error" to (problem.message ?: "token rejected")))
            }
        }

        if (path == "/api/changelog" && method == "GET") {
            return HttpReply.json(200, content.changelogPayload())
        }
        if (path.startsWith("/api/content/") && method == "GET") {
            val name = path.removePrefix("/api/content/").trim('/')
            if (name !in TvmContent.CONTENT_NAMES) {
                return HttpReply.json(404, Json.obj("error" to "not_found"))
            }
            val payload = if (name in TvmContent.REFRESHABLE) content.fresh(name) else content.load(name)
            return if (payload != null) {
                HttpReply.json(200, payload)
            } else {
                HttpReply.json(404, Json.obj("error" to "not_found"))
            }
        }

        if (path == "/api/profiles" && method == "GET") return HttpReply.json(200, media.profilesJson())
        if (path == "/api/profiles" && method == "POST") {
            return HttpReply.json(
                200,
                media.createProfile(
                    name = Json.string(json.opt("name")) ?: "",
                    hue = if (json.has("hue") && json.opt("hue") !== JSONObject.NULL) Json.int(json.opt("hue")) else null,
                    avatarRaw = if (json.has("avatar")) json.opt("avatar") else null,
                    kindRaw = json.opt("kind") as? String,
                    maxAgeRaw = if (json.has("maxAge")) json.opt("maxAge") else null,
                    pinRaw = if (json.has("pin")) json.opt("pin") else null,
                ),
            )
        }
        if (path == "/api/profiles" && method == "PUT") {
            return HttpReply.json(200, media.updateProfile(json))
        }
        if (path == "/api/profiles/active" && method == "POST") {
            val id = json.opt("id") as? String ?: return HttpReply.json(400, Json.obj("error" to "id must be a string"))
            return HttpReply.json(200, media.switchProfile(id, extractPin(json, "pin")))
        }
        if (path == "/api/profiles/verify-pin" && method == "POST") {
            val id = json.opt("id") as? String ?: return HttpReply.json(400, Json.obj("error" to "id must be a string"))
            return try {
                HttpReply.json(200, media.verifyProfilePin(id, extractPin(json, "pin")))
            } catch (pinError: PinException) {
                if (pinError.errorCode == "pin-wrong" || pinError.errorCode == "pin-required") {
                    HttpReply.json(200, Json.obj("ok" to false, "error" to pinError.errorCode))
                } else {
                    HttpReply.json(pinError.httpStatus, pinError.json())
                }
            }
        }
        if (path == "/api/profiles/remove" && method == "POST") {
            val id = json.opt("id") as? String ?: return HttpReply.json(400, Json.obj("error" to "id must be a string"))
            return HttpReply.json(200, media.removeProfile(id, extractPin(json, "pin")))
        }

        if (path == "/api/events/active" && method == "GET") {
            return HttpReply.json(200, media.activeEvents())
        }
        if (path == "/api/services" && method == "GET") {
            return HttpReply.json(200, media.servicesJson())
        }
        if (path == "/api/services/connected" && method == "POST") {
            val id = Json.string(json.opt("id"))
                ?: return HttpReply.json(400, Json.obj("error" to "id must be a string"))
            val connected = json.opt("connected") as? Boolean
                ?: return HttpReply.json(400, Json.obj("error" to "connected must be a boolean"))
            return HttpReply.json(200, media.setServiceConnected(id, connected))
        }
        if (path == "/api/rails/more" && method == "GET") {
            val railId = (query["id"] ?: "").trim()
            if (!TvmMedia.RAIL_ID_RE.matches(railId)) {
                return HttpReply.json(400, Json.obj("error" to "rail id is invalid"))
            }
            val skip = query["skip"]?.toIntOrNull() ?: 0
            val page = query["page"]?.toIntOrNull()
            return HttpReply.json(200, media.railMore(railId, skip, page))
        }
        if (path == "/api/reviews" && method == "GET") {
            val rawId = (query["id"] ?: "").trim()
            if (!TvmReviews.isValidImdbId(rawId)) {
                return HttpReply.json(400, Json.obj("error" to "id must be an IMDb id"))
            }
            val payload = reviews.get(rawId)
                ?: return HttpReply.json(400, Json.obj("error" to "id must be an IMDb id"))
            return HttpReply.json(200, payload.json())
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
            val id = query["id"] ?: ""
            val item = media.item(id) ?: return HttpReply.json(404, Json.obj("error" to "not_found"))
            return HttpReply.json(200, item.json())
        }
        if (path == "/api/media/children" && method == "GET") {
            val id = query["id"] ?: ""
            return HttpReply.json(200, Json.obj("items" to Json.array(media.children(id).map { it.json() })))
        }

        if (path == "/api/watchlist" && method == "GET") {
            return HttpReply.json(200, Json.obj("items" to Json.array(media.watchlist().map { it.json() })))
        }
        if (path == "/api/watchlist" && method == "PUT") {
            return HttpReply.json(200, Json.obj("items" to Json.array(media.addWatchlist(json.opt("item")).map { it.json() })))
        }
        if (path == "/api/watchlist/remove" && method == "POST") {
            val id = json.opt("id") as? String ?: return HttpReply.json(400, Json.obj("error" to "id must be a string"))
            return HttpReply.json(200, Json.obj("items" to Json.array(media.removeWatchlist(id).map { it.json() })))
        }

        if (path == "/api/search" && method == "GET") {
            val q = query["q"] ?: ""
            return HttpReply.json(200, Json.obj("items" to Json.array(media.search(q).map { it.json() })))
        }

        // ---- Downloads to the phone (TvmDownloads) ----
        val dl = downloads
        if (dl != null && path == "/api/downloads" && method == "GET") return HttpReply.json(200, dl.list())
        if (dl != null && path == "/api/downloads/folder" && method == "GET") {
            return HttpReply.json(200, Json.obj("name" to (dl.folderName() ?: JSONObject.NULL)))
        }
        if (dl != null && path == "/api/downloads/folder" && method == "POST") {
            // Waits while the person picks a folder in Android's picker.
            val name = dl.chooseFolder()
            return HttpReply.json(200, if (name == null) Json.obj("cancelled" to true) else Json.obj("name" to name))
        }
        if (dl != null && path == "/api/downloads" && method == "POST") {
            val prefs = json.optJSONObject("preferences") ?: JSONObject()
            val language = prefs.optString("language", "en")
            val maxHeight = prefs.optInt("maxHeight", 1080)
            val list = json.optJSONArray("items") ?: JSONArray()
            val items = (0 until list.length()).mapNotNull { i ->
                val o = list.optJSONObject(i) ?: return@mapNotNull null
                val itemId = o.optString("id")
                if (itemId.isEmpty() || itemId.length > 512 || itemId.startsWith("live:")) null else itemId to o.optString("title", "TVM video")
            }
            if (items.isEmpty() || language.length > 16 || maxHeight !in 240..4320) {
                return HttpReply.json(400, Json.obj("error" to "Choose a film or episode and valid download options."))
            }
            return HttpReply.json(200, dl.enqueue(items, language, maxHeight))
        }
        if (dl != null && path.startsWith("/api/downloads/") && path.endsWith("/cancel") && method == "POST") {
            dl.cancel(path.removePrefix("/api/downloads/").removeSuffix("/cancel"))
            return HttpReply.json(200, dl.list())
        }

        if (path == "/api/playback" && method == "POST") {
            if (!plans.mobileAllowed()) {
                return HttpReply.json(403, Json.obj("kind" to "unavailable", "reason" to "mobile-plan-required"))
            }
            val id = Json.string(json.opt("id"))
            // A title downloaded to this phone plays from the file, offline.
            val offline = if (id != null && !id.startsWith("live:") && Json.string(json.opt("versionId")) == null) dl?.offlineCopy(id) else null
            if (offline != null) {
                val reply = Json.obj(
                    "kind" to "stream", "url" to offline.first, "title" to (Json.string(json.opt("title")) ?: offline.second),
                    "filename" to offline.second, "mimeType" to "application/octet-stream", "engine" to "native", "transport" to "file",
                )
                media.resumePosition(id!!)?.let { reply.put("startAt", it) }
                media.withPlaybackDetails(reply)
                media.playbackStarted(id, reply)
                return HttpReply.json(200, reply)
            }
            if (id != null && id.startsWith("live:")) return playLive(id)
            val (status, payload) = media.play(
                id,
                Json.string(json.opt("link")),
                Json.string(json.opt("title")),
                Json.int(json.opt("season")),
                Json.int(json.opt("episode")),
                screenHeight = Json.int(json.opt("screenHeight")),
                maxHeight = Json.int(json.opt("maxHeight")),
                versionId = Json.string(json.opt("versionId")),
                client = PlaybackClient.parse(json.optJSONObject("client")),
            )
            if (status == 200) {
                media.withPlaybackDetails(payload)
                media.playbackStarted(id, payload)
            }
            return HttpReply.json(status, payload)
        }

        if (path == "/api/playback/event" && method == "POST") {
            val event = TvmWebhook.parseEvent(json) ?: return HttpReply.json(400, Json.obj("error" to "invalid playback event"))
            media.playbackEvent(event)
            return HttpReply.json(200, Json.obj("ok" to true))
        }

        if ((path == "/api/playback/versions" || path == "/api/versions") && method == "GET") {
            val id = query["id"]
            if (id.isNullOrEmpty()) return HttpReply.json(400, Json.obj("error" to "id required"))
            val (status, payload) = media.versions(id, query["season"]?.toIntOrNull(), query["episode"]?.toIntOrNull(), null)
            return HttpReply.json(status, payload)
        }

        if (path == "/api/progress" && method == "POST") {
            val id = json.opt("id") as? String
            val position = Json.double(json.opt("position"))
            val duration = Json.double(json.opt("duration"))
            if (id == null || position == null || duration == null) {
                return HttpReply.json(400, Json.obj("error" to "invalid progress"))
            }
            media.saveProgress(id, position, duration)
            return HttpReply.json(200, Json.obj("ok" to true))
        }

        if (path == "/api/art" && (method == "GET" || method == "HEAD")) {
            return art(query["src"] ?: "", method == "HEAD")
        }

        if (path == "/api/plan" && method == "GET") {
            // Only the dev is shown the Developer screen.
            val status = plans.status()
            if (status.optBoolean("developer") && !devRequest(headers)) status.put("developer", false)
            return HttpReply.json(200, status)
        }
        if (path == "/api/plan" && method == "PUT") {
            if (!devRequest(headers)) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            return try {
                HttpReply.json(200, plans.setPlan(json.opt("id") as? String ?: ""))
            } catch (problem: Exception) {
                HttpReply.json(400, Json.obj("error" to (problem.message ?: "unknown_plan")))
            }
        }
        if (path == "/api/plan/style" && method == "POST") {
            return try {
                HttpReply.json(200, plans.setStyle(json.opt("id") as? String ?: ""))
            } catch (problem: Exception) {
                HttpReply.json(403, Json.obj("error" to (problem.message ?: "style locked")))
            }
        }
        if (path == "/api/plan/live-tv" && method == "POST") {
            val enabled = json.opt("enabled") as? Boolean
                ?: return HttpReply.json(400, Json.obj("error" to "enabled must be a boolean"))
            return HttpReply.json(200, plans.setLiveTv(enabled))
        }
        if (path == "/api/plan/synthwave" && method == "POST") {
            val enabled = json.opt("enabled") as? Boolean
                ?: return HttpReply.json(400, Json.obj("error" to "enabled must be a boolean"))
            return HttpReply.json(200, plans.setSynthwave(enabled))
        }

        if (path == "/api/billing" && method == "GET") return HttpReply.json(200, plans.billing())
        if (path == "/api/billing/cancel" && method == "POST") return HttpReply.json(200, plans.cancel())
        if (path == "/api/billing/checkout" && method == "POST") return HttpReply.json(200, plans.checkout(json))
        if (path == "/api/billing/charge" && method == "POST") return HttpReply.json(200, plans.charge())

        if (path == "/api/usage/tick" && method == "POST") {
            return HttpReply.json(
                200,
                plans.tickUsage(Json.double(json.opt("seconds")) ?: 0.0, json.opt("billable") as? Boolean ?: true),
            )
        }
        if (path == "/api/usage/reset" && method == "POST") {
            if (!devRequest(headers)) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            return HttpReply.json(200, plans.resetUsage())
        }
        if (path == "/api/ads/preroll" && method == "GET") {
            return HttpReply.json(200, Json.obj("skipped" to true, "reason" to "advertising_disabled_during_private_testing"))
        }

        // ---- Accounts ------------------------------------------------
        //
        // The phone runs this core, so the gate the interface puts in front
        // of everything has to be answered here. Same rules as the desktop:
        // an account starts inert and only activation opens it.

        if (path == "/api/terms" && method == "GET") {
            return HttpReply.json(200, accounts.access().optJSONObject("terms") ?: JSONObject())
        }
        if (path == "/api/tiers" && method == "GET") {
            val access = accounts.access()
            return HttpReply.json(200, JSONObject().apply {
                put("tiers", access.optJSONArray("tiers") ?: JSONArray())
                put("route", access.optJSONObject("route") ?: JSONObject())
                put("streamMonthlyPence", access.optInt("streamMonthlyPence"))
            })
        }
        if (path == "/api/account/register" && method == "POST") {
            val result = accounts.register(
                Json.string(json.opt("email")) ?: "",
                Json.string(json.opt("password")) ?: "",
                Json.string(json.opt("displayName")),
                headers["user-agent"],
            )
            return result.fold(
                { HttpReply.json(200, it) },
                { HttpReply.json(accountStatus(it, 400), Json.obj("error" to (it.message ?: "That account could not be created."))) },
            )
        }
        if (path == "/api/account/signin" && method == "POST") {
            val result = accounts.signIn(
                Json.string(json.opt("email")) ?: "",
                Json.string(json.opt("password")) ?: "",
                headers["user-agent"],
            )
            return result.fold(
                { HttpReply.json(200, it) },
                { HttpReply.json(accountStatus(it, 401), Json.obj("error" to (it.message ?: "Sign in failed."))) },
            )
        }
        // Developer access moved to the owner's admin account; there is nothing to enter here.
        if (path == "/api/account/dev" && method == "POST") {
            return HttpReply.json(410, Json.obj("error" to "moved"))
        }
        if (path == "/api/account/signout" && method == "POST") {
            val token = bearerToken(headers)
            if (token != null) {
                val leaving = accounts.resolve(token)
                accounts.signOut(token)
                // Developer mode goes with the owner account.
                if (leaving?.text("role") == "dev") plans.setDeveloper(false)
            }
            return HttpReply.json(200, Json.obj("ok" to true))
        }
        if (path == "/api/account" && method == "GET") {
            val version = accounts.termsVersion()
            val account = when (val found = accounts.lookup(bearerToken(headers))) {
                is AccountLookup.Found -> found.account
                AccountLookup.Unavailable ->
                    return HttpReply.json(503, Json.obj("error" to "TVM accounts cannot be reached. Check your connection and try again."))
                AccountLookup.SignedOut -> return HttpReply.json(200, JSONObject().apply {
                    put("signedIn", false)
                    put("account", JSONObject.NULL)
                    put("usable", JSONObject().put("ok", false).put("reason", "no_account"))
                    put("termsVersion", version)
                    put("canSendEmail", false)
                })
            }
            if (account.text("role") == "dev" && !plans.developer()) plans.setDeveloper(true)
            applyAccountTier(account)
            return HttpReply.json(200, JSONObject().apply {
                put("signedIn", true)
                put("account", accounts.publicOf(account))
                put("usable", accounts.usable(account))
                put("termsVersion", version)
                put("canSendEmail", false)
            })
        }
        if (path == "/api/account/verify/resend" && method == "POST") {
            val (status, body) = accounts.resendVerification(bearerToken(headers), Json.string(json.opt("email")))
            return HttpReply.json(status, body)
        }
        if (path == "/api/account/password/forgot" && method == "POST") {
            val (status, body) = accounts.forgotPassword(Json.string(json.opt("email")))
            return HttpReply.json(status, body)
        }
        // Phones do not send email themselves; the accounts service does.
        if ((path == "/api/account/email/send" || path == "/api/account/email/verify") && method == "POST") {
            return HttpReply.json(
                503,
                Json.obj("error" to "This phone cannot send email. Ask the owner to switch your account on."),
            )
        }
        if (path == "/api/account/terms" && method == "POST") {
            val token = bearerToken(headers)
                ?: return HttpReply.json(401, Json.obj("error" to "Sign in first."))
            val saved = accounts.acceptTerms(token)
            val body = saved.getOrNull()
                ?: return HttpReply.json(
                    accountStatus(saved.exceptionOrNull(), 400),
                    Json.obj("error" to (saved.exceptionOrNull()?.message ?: "Sign in first.")),
                )
            accounts.resolve(token)?.let { applyAccountTier(it) }
            return HttpReply.json(200, body)
        }

        // The developer menu: install the admin key (kept in secure storage, never sent to the interface), then mirror the service admin API.
        if (path == "/api/admin/key") {
            if (method == "GET") {
                if (!devRequest(headers)) return HttpReply.json(403, Json.obj("error" to "developer_required"))
                return HttpReply.json(200, Json.obj("installed" to accounts.hasAdminKey()))
            }
            if (method == "POST") {
                val (status, body) = accounts.installAdminKey(bearerToken(headers), Json.string(json.opt("key")) ?: "")
                return HttpReply.json(status, body.apply { put("installed", accounts.hasAdminKey()) })
            }
        }
        if (path == "/api/admin/config" || path == "/api/admin/audit" || path == "/api/admin/accounts.csv" ||
            path == "/api/admin/rd/test" || path == "/api/admin/accounts" || path == "/api/admin/accounts/bulk" ||
            ADMIN_ACCOUNT_PATH.matches(path)
        ) {
            val allowed = when {
                path == "/api/admin/config" -> method == "GET" || method == "PUT"
                path == "/api/admin/rd/test" || path == "/api/admin/accounts/bulk" -> method == "POST"
                path.endsWith("/profile") || path.endsWith("/password") || path.endsWith("/tier") -> method == "POST"
                path.contains("/sessions/") -> method == "DELETE"
                else -> method == "GET"
            }
            if (!allowed) return HttpReply.json(405, Json.obj("error" to "method_not_allowed"))
            var v1 = path.removePrefix("/api/admin/")
            if (method == "GET" && query.isNotEmpty()) {
                val keep = listOf("offset", "type", "search", "state").filter { !query[it].isNullOrEmpty() }
                if (keep.isNotEmpty()) v1 += "?" + keep.joinToString("&") { "$it=" + java.net.URLEncoder.encode(query[it]!!, "UTF-8") }
            }
            return accounts.mirrorAdmin(bearerToken(headers), v1, method, if (method == "GET" || method == "DELETE") null else json)
        }
        if (path == "/api/admin/accounts" || path.startsWith("/api/admin/accounts/")) {
            return HttpReply.json(403, Json.obj("error" to "use_dashboard"))
        }
        if (path == "/api/admin/mail" || path == "/api/admin/mail/test") {
            if (!devRequest(headers)) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            if (method == "GET") {
                return HttpReply.json(
                    200,
                    Json.obj(
                        "configured" to false, "supported" to false, "host" to null, "port" to null,
                        "security" to null, "username" to null, "from" to null,
                    ),
                )
            }
            return HttpReply.json(501, Json.obj("error" to "Set email up on the desktop TVM. Phones do not send it."))
        }

        if (path == "/api/dev/status" && method == "GET") {
            return HttpReply.json(200, Json.obj("unlocked" to devRequest(headers)))
        }
        if (path == "/api/dev/unlock" && method == "POST") {
            return HttpReply.json(410, Json.obj("error" to "moved"))
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
            accounts.forgetEverything()
            store.factoryReset()
            bundledUi.invalidate()
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
        if (path == "/api/live/guide" && method == "GET") {
            val window = GuideWindow.parse(query["start"], query["hours"])
                ?: return HttpReply.json(400, Json.obj("error" to "invalid guide window"))
            val free = content.fresh("free-channels")?.let { JSONObject(it.toString()) } ?: JSONObject()
            val rows = free.optJSONArray("channels") ?: JSONArray()
            val allowed = (0 until rows.length()).mapNotNull { index -> rows.optJSONObject(index)?.apply { put("number", index + 1) } }
                .filter { TvmParental.liveGroupAllowed(it.text("group"), media.ageLevel(), media.parentalLevels()) }
            free.put("channels", Json.array(allowed))
            val provider = synchronized(lock) { if (plans.status().optBoolean("liveTv")) liveChannels.filter { TvmParental.liveGroupAllowed(it.text("group"), media.ageLevel(), media.parentalLevels()) } else emptyList() }
            return HttpReply.json(200, liveGuide.guide(window, query["group"]?.trim()?.ifEmpty { null }, free, provider, liveGuideUrls, liveHost, liveUser, XtreamKeychain.read()))
        }
        if (path == "/api/live/free" && method == "GET") return HttpReply.json(200, media.freeLiveJson())
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

        if (path.startsWith("/api/live/proxy/") && (method == "GET" || method == "HEAD")) {
            val token = path.removePrefix("/api/live/proxy/")
            return liveReflector.serve(token, method)
        }

        return HttpReply.json(404, Json.obj("error" to "not_found"))
    }

    /** Busy and unreachable keep their status; anything else the route would have used. */
    private fun accountStatus(problem: Throwable?, otherwise: Int): Int {
        val status = (problem as? AccountsException)?.status ?: return otherwise
        return if (status == 429 || status == 503 || status == 401) status else otherwise
    }

    /** Whose key this is: the account's own, or the one saved on the phone. */
    private fun rdStatusJson(status: RdStatus): JSONObject = status.json().apply {
        put("source", when {
            rd.hasAccountToken() -> "account"
            status.configured -> "device"
            else -> JSONObject.NULL
        })
    }

    /** A real live broadcast for checking the proxy with, listed while the dev account is signed in. */
    private fun testChannels(): List<JSONObject> =
        if (plans.developer()) {
            listOf(Json.obj("id" to "live:test:dw-news", "name" to "DW News", "url" to TEST_CHANNEL_URL, "group" to "Test"))
        } else {
            emptyList()
        }

    private fun extractPin(json: JSONObject, key: String): String? {
        if (!json.has(key)) return null
        val raw = json.opt(key)
        if (raw == null || raw === JSONObject.NULL) return null
        if (raw !is String) throw PinException(400, "pin-invalid")
        return raw
    }

    private suspend fun playLive(id: String): HttpReply {
        val channel = if (id.startsWith("live:free:")) {
            val targetId = id.removePrefix("live:free:")
            val doc = content.fresh("free-channels")
            val rawList = doc?.optJSONArray("channels")
            var matched: JSONObject? = null
            if (rawList != null) {
                for (i in 0 until rawList.length()) {
                    val row = rawList.optJSONObject(i) ?: continue
                    val rid = Json.string(row.opt("id")) ?: continue
                    if (rid == targetId || "live:free:$rid" == id) {
                        matched = row
                        break
                    }
                }
            }
            val freeChannel = matched
                ?: return HttpReply.json(409, Json.obj("kind" to "unavailable", "reason" to "not-in-library"))
            if (!TvmParental.liveGroupAllowed(Json.string(freeChannel.opt("group")), media.ageLevel(), media.parentalLevels())) {
                return HttpReply.json(403, Json.obj("kind" to "unavailable", "reason" to "parental-blocked"))
            }
            freeChannel
        } else {
            if (!Json.bool(plans.status().opt("liveTv"), false)) {
                return HttpReply.json(
                    409,
                    Json.obj("kind" to "unavailable", "reason" to "Live TV requires the Live TV add-on."),
                )
            }
            testChannels().firstOrNull { it.text("id") == id }
                ?: synchronized(lock) { liveChannels.firstOrNull { it.text("id") == id } }
                ?: return HttpReply.json(409, Json.obj("kind" to "unavailable", "reason" to "not-in-library"))
        }
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
        val reflected = liveReflector.publish(raw)
        val reply = Json.obj(
                "kind" to "stream", "url" to reflected, "title" to channel.text("name", "Live TV"),
                "filename" to path.substringAfterLast('/', ""),
                "mimeType" to if (hls) "application/vnd.apple.mpegurl" else "video/mp2t",
                "engine" to "html5", "transport" to if (hls) "hls" else "ts-live", "isLive" to true,
        )
        media.playbackStarted(id, reply)
        return HttpReply.json(200, reply)
    }

    private fun groupSummary(): JSONArray {
        val out = JSONArray()
        val grouped = synchronized(lock) { liveChannels.groupBy { it.text("group", "Other").ifEmpty { "Other" } } }
        for ((name, list) in grouped) {
            out.put(
                Json.obj(
                    "name" to name,
                    "count" to list.size,
                    "picked" to list.count { livePicks.contains(it.text("id")) },
                ),
            )
        }
        return out
    }

    private fun card(channel: JSONObject): JSONObject {
        val copy = JSONObject(channel.toString())
        copy.put("picked", livePicks.contains(channel.text("id")))
        copy.remove("url") // the URL carries the subscription credentials
        return copy
    }

    private fun liveStatus(): JSONObject {
        val age = media.ageLevel()
        val levels = media.parentalLevels()
        return synchronized(lock) {
            val allowedTests = testChannels().filter { TvmParental.liveGroupAllowed(it.text("group"), age, levels) }
            val allowedLive = liveChannels.filter { TvmParental.liveGroupAllowed(it.text("group"), age, levels) }
            Json.obj(
                "url" to liveUrl,
                "host" to liveHost,
                "username" to liveUser,
                "configured" to (liveUrl != null || liveHost != null),
                "channels" to Json.array(allowedTests.map { card(it) } + allowedLive.take(PICK_LIMIT).map { card(it) }),
                "error" to if (liveChannels.isEmpty() && liveUrl != null) {
                    "The playlist had no channels this phone can list."
                } else {
                    null
                },
                "picked" to livePicks.size,
                "total" to allowedLive.size,
                "groups" to groupSummary(),
                "needsPicks" to (livePicks.isEmpty() && allowedLive.size > PICK_LIMIT),
                "pickLimit" to PICK_LIMIT,
            )
        }
    }

    private fun liveCatalog(q: String, group: String, offset: Int): JSONObject {
        val age = media.ageLevel()
        val levels = media.parentalLevels()
        val matched = synchronized(lock) {
            var items: List<JSONObject> = liveChannels.filter {
                TvmParental.liveGroupAllowed(it.text("group"), age, levels)
            }
            if (q.isNotEmpty()) {
                items = items.filter { it.text("name", "").contains(q, ignoreCase = true) }
            }
            if (group.isNotEmpty()) {
                items = items.filter { it.text("group", "") == group }
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
        liveHost = null
        liveUser = null
        XtreamKeychain.clear()
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
        liveGuideUrls = Regex("""(?:url-tvg|x-tvg-url)\s*=\s*["']([^"']+)["']""", RegexOption.IGNORE_CASE)
            .findAll(text.lineSequence().firstOrNull { it.trim().startsWith("#EXTM3U") }.orEmpty())
            .flatMap { it.groupValues[1].split(',', ' ').asSequence() }.filter { TvmXmlTv.safeUrl(it) }.distinct().take(12).toList()
        val channels = mutableListOf<JSONObject>()
        var pendingName = "Channel"
        var pendingGroup = "Other"
        var pendingLogo = ""
        var pendingId = ""
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.startsWith("#EXTINF")) {
                pendingName = line.substringAfterLast(',', "").ifEmpty { "Channel" }
                pendingGroup = groupPattern.find(line)?.groupValues?.getOrNull(1)?.ifEmpty { "Other" } ?: "Other"
                pendingLogo = logoPattern.find(line)?.groupValues?.getOrNull(1) ?: ""
                pendingId = Regex("""tvg-id\s*=\s*["']([^"']*)["']""").find(line)?.groupValues?.getOrNull(1) ?: ""
            } else if (line.startsWith("http")) {
                channels.add(
                    Json.obj(
                        "id" to "live:${channels.size + 1}",
                        "name" to pendingName,
                        "url" to line,
                        "group" to pendingGroup,
                        "logo" to pendingLogo,
                        "epgId" to pendingId,
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
                    "guideUrls" to JSONArray(liveGuideUrls),
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
        if (!TvmArtTrust.trusted(decoded)) return HttpReply.json(404, Json.obj("error" to "not_found"))
        val cache = artCache
        if (!head) {
            cache?.get(decoded)?.let { (type, data) -> return cachedArt(type, data) }
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
                val data = connection.inputStream.use { it.readBytes() }
                if (cache != null && type.startsWith("image/")) {
                    cache.put(decoded, type, data)
                    return cachedArt(type, data)
                }
                HttpReply.bytes(200, type, data)
            } finally {
                connection.disconnect()
            }
        }.getOrElse { HttpReply.json(404, Json.obj("error" to "not_found")) }
    }

    private fun cachedArt(type: String, data: ByteArray): HttpReply =
        HttpReply(200, mapOf("Content-Type" to type, "Cache-Control" to TvmArtCache.CACHE_CONTROL), data)

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
