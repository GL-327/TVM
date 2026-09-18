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
    app: TvmAppBundle = TvmAppBundle.None,
    private val bundledAccess: () -> String? = { null },
    http: TvmHttp = TvmHttp.Default,
) {
    private val accounts = TvmAccounts(store, bundledAccess)

    /** The interface this app serves, and the updater that keeps it current. */
    val bundledUi = TvmBundledUi(store, app)
    val updater = TvmUpdater(store, bundledUi, http)

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

    companion object {
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
        ): TvmLocalCore {
            val store = TvmStore(root)
            RdKeychain.attach(root)
            XtreamKeychain.attach(root)
            val catalog = TvmCatalog(store, bundledCatalog)
            val rd = TvmRealDebrid(RdKeychain)
            val plans = TvmPlans(root)
            val media = TvmMedia(store, catalog, rd, plans)
            return TvmLocalCore(store, catalog, rd, plans, media, app, bundledAccess)
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
            val prefs = TvmPrefs.load(store)
            val language = json.opt("language") as? String
            if (language != null && language in TvmPrefs.LANGUAGES) prefs.language = language
            val auto = json.opt("autoUpdate") as? Boolean
            if (auto != null) prefs.autoUpdate = auto
            prefs.save(store)
            return HttpReply.json(200, prefs.json())
        }
        if (path == "/api/update/status" && method == "GET") return HttpReply.json(200, updater.snapshot())
        if (path == "/api/update/check" && method == "POST") return HttpReply.json(200, updater.check())
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
            // A member's key goes on their account. The dev's key is the phone's.
            val self = accounts.resolve(bearerToken(headers))
            if (self != null && self.text("role") != "dev") {
                val saved = accounts.setRdToken(self.text("id"), token)
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

        if (path == "/api/profiles" && method == "GET") return HttpReply.json(200, media.profilesJson())
        if (path == "/api/profiles" && method == "POST") {
            return HttpReply.json(200, media.createProfile(Json.string(json.opt("name")) ?: ""))
        }
        if (path == "/api/profiles" && method == "PUT") {
            val id = json.opt("id") as? String
            val name = json.opt("name") as? String
            if (id == null || name == null) return HttpReply.json(400, Json.obj("error" to "id and name are required"))
            return HttpReply.json(200, media.renameProfile(id, name))
        }
        if (path == "/api/profiles/active" && method == "POST") {
            val id = json.opt("id") as? String ?: return HttpReply.json(400, Json.obj("error" to "id must be a string"))
            return HttpReply.json(200, media.switchProfile(id))
        }
        if (path == "/api/profiles/remove" && method == "POST") {
            val id = json.opt("id") as? String ?: return HttpReply.json(400, Json.obj("error" to "id must be a string"))
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

        if (path == "/api/playback" && method == "POST") {
            if (!plans.mobileAllowed()) {
                return HttpReply.json(403, Json.obj("kind" to "unavailable", "reason" to "mobile-plan-required"))
            }
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

        if (path == "/api/plan" && method == "GET") return HttpReply.json(200, plans.status())
        if (path == "/api/plan" && method == "PUT") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
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
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
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
                { HttpReply.json(400, Json.obj("error" to (it.message ?: "That account could not be created."))) },
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
                { HttpReply.json(401, Json.obj("error" to (it.message ?: "Sign in failed."))) },
            )
        }
        // The dev account. The developer code is its password, and signing in
        // turns developer mode on.
        if (path == "/api/account/dev" && method == "POST") {
            val code = Json.string(json.opt("code")) ?: ""
            if (!TvmDevUnlock.verify(code)) return HttpReply.json(403, Json.obj("error" to "That code is not valid."))
            plans.setDeveloper(true)
            return HttpReply.json(200, accounts.signInDev(headers["user-agent"]))
        }
        if (path == "/api/account/signout" && method == "POST") {
            val token = bearerToken(headers)
            if (token != null) {
                val leaving = accounts.resolve(token)
                accounts.signOut(token)
                // Developer mode goes with the dev account's last session.
                if (leaving?.text("role") == "dev" && !accounts.devSignedIn()) plans.setDeveloper(false)
            }
            return HttpReply.json(200, Json.obj("ok" to true))
        }
        if (path == "/api/account" && method == "GET") {
            val version = accounts.termsVersion()
            val account = accounts.resolve(bearerToken(headers))
                ?: return HttpReply.json(200, JSONObject().apply {
                    put("signedIn", false)
                    put("account", JSONObject.NULL)
                    put("usable", JSONObject().put("ok", false).put("reason", "no_account"))
                    put("termsVersion", version)
                    put("canSendEmail", false)
                })
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
        // Phones do not send email; the desktop TVM does.
        if ((path == "/api/account/email/send" || path == "/api/account/email/verify") && method == "POST") {
            return HttpReply.json(
                503,
                Json.obj("error" to "This phone cannot send email. Ask the dev to switch your account on."),
            )
        }
        if (path == "/api/account/terms" && method == "POST") {
            val account = accounts.resolve(bearerToken(headers))
                ?: return HttpReply.json(401, Json.obj("error" to "Sign in first."))
            val body = accounts.acceptTerms(account.text("id"))
                ?: return HttpReply.json(401, Json.obj("error" to "Sign in first."))
            accounts.resolve(bearerToken(headers))?.let { applyAccountTier(it) }
            return HttpReply.json(200, body)
        }

        // Dev mode only, checked here rather than by hiding the route.
        if (path == "/api/admin/accounts" && method == "GET") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            return HttpReply.json(200, accounts.list(query["search"], query["state"]))
        }
        if (path == "/api/admin/accounts/activate" && method == "POST") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            val id = Json.string(json.opt("id"))
            val tier = Json.string(json.opt("tier"))
            val body = if (id != null && tier != null) accounts.activate(id, tier, Json.string(json.opt("note"))) else null
            return body?.let { HttpReply.json(200, it) }
                ?: HttpReply.json(400, Json.obj("error" to "Choose an account and a tier."))
        }
        if (path == "/api/admin/accounts/suspend" && method == "POST") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            val id = Json.string(json.opt("id"))
            val body = id?.let { accounts.setSuspended(it, json.optBoolean("suspended", true)) }
            return body?.let { HttpReply.json(200, it) }
                ?: HttpReply.json(400, Json.obj("error" to "Choose an account."))
        }
        if (path == "/api/admin/accounts/note" && method == "POST") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            val id = Json.string(json.opt("id"))
            val body = id?.let { accounts.setNote(it, Json.string(json.opt("note"))) }
            return body?.let { HttpReply.json(200, it) }
                ?: HttpReply.json(400, Json.obj("error" to "Choose an account."))
        }
        if (path == "/api/admin/accounts/erase" && method == "POST") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            val id = Json.string(json.opt("id"))
                ?: return HttpReply.json(400, Json.obj("error" to "Choose an account."))
            accounts.erase(id)
            return HttpReply.json(200, Json.obj("ok" to true))
        }
        if (path == "/api/admin/accounts/live-tv" && method == "POST") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            val id = Json.string(json.opt("id"))
            val enabled = json.opt("enabled") as? Boolean
            if (id == null || enabled == null) return HttpReply.json(400, Json.obj("error" to "Choose an account."))
            return adminReply(accounts.setLiveTv(id, enabled))
        }
        if (path == "/api/admin/accounts/rd" && method == "POST") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            val id = Json.string(json.opt("id"))
            val token = json.opt("token") as? String
            if (id == null || token == null) return HttpReply.json(400, Json.obj("error" to "Choose an account."))
            return adminReply(accounts.setRdToken(id, token))
        }
        if (path == "/api/admin/accounts/verify" && method == "POST") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
            val id = Json.string(json.opt("id"))
                ?: return HttpReply.json(400, Json.obj("error" to "Choose an account."))
            return adminReply(accounts.setEmailVerified(id, json.optBoolean("verified", true)))
        }
        if (path == "/api/admin/mail" || path == "/api/admin/mail/test") {
            if (!plans.developer()) return HttpReply.json(403, Json.obj("error" to "developer_required"))
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
            return HttpReply.json(200, Json.obj("unlocked" to plans.developer()))
        }
        if (path == "/api/dev/unlock" && method == "POST") {
            // Verified here rather than refused, so developer mode behaves the
            // same on a phone as on the desktop Core.
            val password = Json.string(json.opt("password")) ?: ""
            if (!TvmDevUnlock.verify(password)) {
                return HttpReply.json(
                    403,
                    Json.obj("unlocked" to false, "error" to "That developer code was not recognised."),
                )
            }
            plans.setDeveloper(true)
            return HttpReply.json(200, Json.obj("unlocked" to true))
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

    private fun adminReply(result: Result<JSONObject>): HttpReply =
        result.fold(
            { HttpReply.json(200, it) },
            { HttpReply.json(400, Json.obj("error" to (it.message ?: "That account could not be changed."))) },
        )

    /** Whose key this is: the account's own, or the one saved on the phone. */
    private fun rdStatusJson(status: RdStatus): JSONObject = status.json().apply {
        put("source", when {
            rd.hasAccountToken() -> "account"
            status.configured -> "device"
            else -> JSONObject.NULL
        })
    }

    /** A real live broadcast for checking the proxy with. Dev account only. */
    private fun testChannels(): List<JSONObject> =
        if (plans.developer()) {
            listOf(Json.obj("id" to "live:test:dw-news", "name" to "DW News", "url" to TEST_CHANNEL_URL, "group" to "Test"))
        } else {
            emptyList()
        }

    private fun playLive(id: String): HttpReply {
        if (!Json.bool(plans.status().opt("liveTv"), false)) {
            return HttpReply.json(
                409,
                Json.obj("kind" to "unavailable", "reason" to "Live TV requires the Live TV add-on."),
            )
        }
        val channel = testChannels().firstOrNull { it.text("id") == id }
            ?: synchronized(lock) { liveChannels.firstOrNull { it.text("id") == id } }
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
        val reflected = liveReflector.publish(raw)
        return HttpReply.json(
            200,
            Json.obj(
                "kind" to "stream",
                "url" to reflected,
                "title" to (Json.string(channel.opt("name")) ?: "Live TV"),
                "filename" to path.substringAfterLast('/', ""),
                "mimeType" to if (hls) "application/vnd.apple.mpegurl" else "video/mp2t",
                "engine" to "html5",
                "transport" to if (hls) "hls" else "ts-live",
                "isLive" to true,
            ),
        )
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

    private fun liveStatus(): JSONObject = synchronized(lock) {
        Json.obj(
            "url" to liveUrl,
            "host" to liveHost,
            "username" to liveUser,
            "configured" to (liveUrl != null || liveHost != null),
            "channels" to Json.array(testChannels().map { card(it) } + liveChannels.take(PICK_LIMIT).map { card(it) }),
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
