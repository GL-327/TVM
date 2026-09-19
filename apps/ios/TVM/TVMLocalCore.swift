import Foundation

final class TVMLocalCore {
    let store: TVMStore
    let catalog: TVMCatalog
    let rd: TVMRealDebrid
    let plans: TVMPlans
    let media: TVMMedia
    let accounts: TVMAccounts
    private let startedAt = Date()
    private let session: URLSession
    /// GitHub downloads get their own patient, cookie-free session.
    private let updateSession = TVMUpdater.downloadSession()
    private let lock = NSLock()
    private var liveURL: String?
    private var liveHost: String?
    private var liveUser: String?
    private var liveChannels: [[String: Any]] = []
    private var livePicks = Set<String>()
    private let liveReflector: TVMLiveReflector

    init(session: URLSession? = nil, store: TVMStore = TVMStore()) {
        self.store = store
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 20
            configuration.httpShouldSetCookies = false
            configuration.httpAdditionalHeaders = ["Accept-Language": TVMPrefs.acceptLanguage(TVMPrefs.load(store).language)]
            self.session = URLSession(configuration: configuration)
        }
        catalog = TVMCatalog(store: store, session: self.session)
        rd = TVMRealDebrid(session: self.session)
        plans = TVMPlans(store: store)
        media = TVMMedia(store: store, catalog: catalog, rd: rd, plans: plans)
        accounts = TVMAccounts(store: store)
        liveReflector = TVMLiveReflector(session: self.session)
        if let saved = store.readJSON("live.json") as? [String: Any] {
            liveURL = saved["url"] as? String
            liveHost = saved["host"] as? String
            liveUser = saved["username"] as? String
            livePicks = Set(saved["picks"] as? [String] ?? [])
            liveChannels = saved["channels"] as? [[String: Any]] ?? []
        }
    }

    /// Dev mode belongs to the dev account, so dev-only routes check who is
    /// asking. Any app on the phone can reach this server, not just TVM.
    private func devRequest(_ headers: [String: String]) -> Bool {
        guard let account = accounts.resolve(token: bearerToken(headers)), account.isDev else { return false }
        if !plans.developer() { plans.setDeveloper(true) }
        return true
    }

    private func bearerToken(_ headers: [String: String]) -> String? {
        let dedicated = headers["x-tvm-account"]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !dedicated.isEmpty { return dedicated }
        guard let raw = headers["authorization"], raw.hasPrefix("Bearer ") else { return nil }
        return String(raw.dropFirst(7))
    }

    /// Keeps the plan engine agreeing with the account on every read.
    private func applyAccountTier(_ account: TVMAccount) {
        let usable = TVMAccounts.usable(account, termsVersion: TVMAccounts.termsVersion())
        if (usable["ok"] as? Bool) == true, let tier = account.tier {
            plans.grantTier(tier)
        } else {
            plans.revokeTier()
        }
    }

    func handle(method: String, path: String, query: [String: String], headers: [String: String], body: Data?) async -> HTTPReply {
        media.applyProfileHeader(headers["x-tvm-profile"])
        let json = JSONValue.object(body)
        // An account's own Real-Debrid key wins over the one saved on the phone.
        // Skipped for stream segments and artwork, which never touch it.
        if !path.hasPrefix("/api/live/proxy/") && path != "/api/art" {
            if rd.useAccountToken(accounts.rdTokenFor(token: bearerToken(headers))) { media.forgetLibrary() }
        }

        if path == "/api/health" && method == "GET" {
            return .json(200, [
                "status": "ok",
                "version": StandalonePolicy.version,
                "uptimeSeconds": Int(Date().timeIntervalSince(startedAt)),
                "mode": "standalone",
            ])
        }
        if path == "/api/prefs" && method == "GET" {
            return .json(200, TVMPrefs.load(store).json())
        }
        if path == "/api/prefs" && method == "PUT" {
            var prefs = TVMPrefs.load(store)
            if let language = json["language"] as? String, TVMPrefs.languages.contains(language) {
                prefs.language = language
            }
            if let auto = json["autoUpdate"] as? Bool {
                prefs.autoUpdate = auto
            }
            prefs.save(store)
            return .json(200, prefs.json())
        }
        if path == "/api/update/status" && method == "GET" {
            return .json(200, TVMUpdater.snapshot(store: store).json())
        }
        if path == "/api/update/check" && method == "POST" {
            do { return .json(200, try await TVMUpdater.check(store: store, session: updateSession).json()) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "check failed"]) }
        }
        if path == "/api/update/apply" && method == "POST" {
            do { return .json(200, try await TVMUpdater.apply(store: store, session: updateSession)) }
            catch { return .json(400, ["error": "apply_refused", "reason": (error as? LocalizedError)?.errorDescription ?? "apply failed"]) }
        }
        if path == "/api/update/changelog" && method == "GET" {
            return .json(200, TVMChangelog.record(store: store) ?? ["pending": false, "version": "", "from": NSNull(), "to": NSNull(), "appliedAt": "", "entries": []])
        }
        if path == "/api/update/changelog/seen" && method == "POST" {
            return .json(200, TVMChangelog.markSeen(store: store))
        }
        if path == "/api/update/token" && method == "PUT" {
            return .json(200, ["configured": false])
        }
        if path == "/api/rd/status" && method == "GET" {
            return .json(200, rdStatusJSON(await media.status()))
        }
        if path == "/api/rd/configured" && method == "GET" {
            return .json(200, ["configured": rd.configured()])
        }
        if path == "/api/rd/token" && method == "PUT" {
            guard let token = json["token"] as? String else { return .json(400, ["error": "token must be a string"]) }
            // A member's key goes on their account. The dev's key is the phone's.
            if let me = accounts.resolve(token: bearerToken(headers)), !me.isDev {
                if case .failure(let error) = accounts.setRdToken(id: me.id, token: token) {
                    return .json(400, ["error": error.message])
                }
                if rd.useAccountToken(accounts.rdTokenFor(token: bearerToken(headers))) { media.forgetLibrary() }
                return .json(200, rdStatusJSON(await media.status()))
            }
            do { return .json(200, rdStatusJSON(try await media.setToken(token))) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "token rejected"]) }
        }
        if path == "/api/profiles" && method == "GET" { return .json(200, media.profilesJSON()) }
        if path == "/api/profiles" && method == "POST" {
            do { return .json(200, try media.createProfile(json["name"] as? String ?? "")) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "profile rejected"]) }
        }
        if path == "/api/profiles" && method == "PUT" {
            guard let id = json["id"] as? String, let name = json["name"] as? String else {
                return .json(400, ["error": "id and name are required"])
            }
            return .json(200, media.renameProfile(id: id, name: name))
        }
        if path == "/api/profiles/active" && method == "POST" {
            guard let id = json["id"] as? String else { return .json(400, ["error": "id must be a string"]) }
            do { return .json(200, try media.switchProfile(id)) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "profile rejected"]) }
        }
        if path == "/api/profiles/remove" && method == "POST" {
            guard let id = json["id"] as? String else { return .json(400, ["error": "id must be a string"]) }
            do { return .json(200, try media.removeProfile(id)) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "profile rejected"]) }
        }
        if path == "/api/apps" && method == "GET" { return .json(200, media.appsList()) }
        if path.hasPrefix("/api/apps/") && method == "GET" {
            let id = String(path.dropFirst("/api/apps/".count)).removingPercentEncoding ?? ""
            if let hub = await media.appHub(id) { return .json(200, hub) }
            return .json(404, ["error": "not_found"])
        }
        if path == "/api/home" && method == "GET" { return .json(200, await media.home()) }
        if path == "/api/library" && method == "GET" {
            return .json(200, ["items": (await media.library()).map { $0.json() }])
        }
        if path == "/api/media" && method == "GET" {
            let id = query["id"] ?? ""
            if let item = await media.item(id) { return .json(200, item.json()) }
            return .json(404, ["error": "not_found"])
        }
        if path == "/api/media/children" && method == "GET" {
            return .json(200, ["items": (await media.children(query["id"] ?? "")).map { $0.json() }])
        }
        if path == "/api/watchlist" && method == "GET" { return .json(200, ["items": media.watchlist().map { $0.json() }]) }
        if path == "/api/watchlist" && method == "PUT" { return .json(200, ["items": media.addWatchlist(json["item"]).map { $0.json() }]) }
        if path == "/api/watchlist/remove" && method == "POST" {
            guard let id = json["id"] as? String else { return .json(400, ["error": "id must be a string"]) }
            return .json(200, ["items": media.removeWatchlist(id).map { $0.json() }])
        }
        if path == "/api/search" && method == "GET" {
            return .json(200, ["items": (await media.search(query["q"] ?? "")).map { $0.json() }])
        }
        if path == "/api/playback" && method == "POST" {
            guard plans.mobileAllowed() else { return .json(403, ["kind": "unavailable", "reason": "mobile-plan-required"]) }
            if let id = json["id"] as? String, id.hasPrefix("live:") { return await playLive(id) }
            let result = await media.play(
                id: JSONValue.string(json["id"]),
                link: JSONValue.string(json["link"]),
                title: JSONValue.string(json["title"]),
                season: JSONValue.int(json["season"]),
                episode: JSONValue.int(json["episode"])
            )
            return .json(result.0, result.1)
        }
        if path == "/api/progress" && method == "POST" {
            guard let id = json["id"] as? String,
                  let position = json["position"] as? Double,
                  let duration = json["duration"] as? Double else {
                return .json(400, ["error": "invalid progress"])
            }
            media.saveProgress(id: id, position: position, duration: duration)
            return .json(200, ["ok": true])
        }
        if path == "/api/art" && (method == "GET" || method == "HEAD") {
            return await art(query["src"] ?? "", head: method == "HEAD")
        }
        if path == "/api/plan" && method == "GET" {
            // Only the dev is shown the Developer screen.
            var status = plans.status()
            if (status["developer"] as? Bool) == true && !devRequest(headers) { status["developer"] = false }
            return .json(200, status)
        }
        if path == "/api/plan" && method == "PUT" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            do { return .json(200, try plans.setPlan(json["id"] as? String ?? "")) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "unknown_plan"]) }
        }
        if path == "/api/plan/style" && method == "POST" {
            do { return .json(200, try plans.setStyle(json["id"] as? String ?? "")) }
            catch { return .json(403, ["error": (error as? LocalizedError)?.errorDescription ?? "style locked"]) }
        }
        if path == "/api/plan/live-tv" && method == "POST" {
            guard let enabled = json["enabled"] as? Bool else { return .json(400, ["error": "enabled must be a boolean"]) }
            do { return .json(200, try plans.setLiveTv(enabled)) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "live tv failed"]) }
        }
        if path == "/api/plan/synthwave" && method == "POST" {
            guard let enabled = json["enabled"] as? Bool else { return .json(400, ["error": "enabled must be a boolean"]) }
            do { return .json(200, try plans.setSynthwave(enabled)) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "synthwave failed"]) }
        }
        if path == "/api/billing" && method == "GET" { return .json(200, plans.billing()) }
        if path == "/api/billing/cancel" && method == "POST" { return .json(200, plans.cancel()) }
        if path == "/api/billing/checkout" && method == "POST" {
            do { return .json(200, try plans.checkout(json)) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "checkout failed"]) }
        }
        if path == "/api/billing/charge" && method == "POST" { return .json(200, plans.charge()) }
        if path == "/api/usage/tick" && method == "POST" {
            return .json(200, plans.tickUsage(json["seconds"] as? Double ?? 0, billable: json["billable"] as? Bool ?? true))
        }
        if path == "/api/usage/reset" && method == "POST" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            return .json(200, plans.resetUsage())
        }
        if path == "/api/ads/preroll" && method == "GET" {
            return .json(200, ["skipped": true, "reason": "advertising_disabled_during_private_testing"])
        }
        // ---- Accounts ------------------------------------------------
        //
        // The phone runs this core, so the gate the interface puts in front
        // of everything has to be answered here. Same rules as the desktop:
        // an account starts inert and only activation opens it.

        if path == "/api/terms" && method == "GET" {
            return .json(200, (TVMAccounts.access()["terms"] as? [String: Any]) ?? [:])
        }
        if path == "/api/tiers" && method == "GET" {
            let access = TVMAccounts.access()
            return .json(200, [
                "tiers": access["tiers"] ?? [],
                "route": access["route"] ?? [:],
                "streamMonthlyPence": access["streamMonthlyPence"] ?? 0,
            ])
        }
        if path == "/api/account/register" && method == "POST" {
            switch accounts.register(
                email: json["email"] as? String ?? "",
                password: json["password"] as? String ?? "",
                displayName: json["displayName"] as? String,
                client: headers["user-agent"]
            ) {
            case .success(let body): return .json(200, body)
            case .failure(let error): return .json(400, ["error": error.message])
            }
        }
        if path == "/api/account/signin" && method == "POST" {
            switch accounts.signIn(
                email: json["email"] as? String ?? "",
                password: json["password"] as? String ?? "",
                client: headers["user-agent"]
            ) {
            case .success(let body): return .json(200, body)
            case .failure(let error): return .json(401, ["error": error.message])
            }
        }
        // The dev account. The developer code is its password, and signing in
        // turns developer mode on.
        if path == "/api/account/dev" && method == "POST" {
            let code = ((json["code"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard TVMDevUnlock.verify(code) else { return .json(403, ["error": "That code is not valid."]) }
            plans.setDeveloper(true)
            return .json(200, accounts.signInDev(client: headers["user-agent"]))
        }
        if path == "/api/account/signout" && method == "POST" {
            if let token = bearerToken(headers) {
                let leaving = accounts.resolve(token: token)
                accounts.signOut(token: token)
                // Developer mode goes with the dev account's last session.
                if leaving?.isDev == true && !accounts.devSignedIn() { plans.setDeveloper(false) }
            }
            return .json(200, ["ok": true])
        }
        if path == "/api/account" && method == "GET" {
            let version = TVMAccounts.termsVersion()
            guard let account = accounts.resolve(token: bearerToken(headers)) else {
                return .json(200, [
                    "signedIn": false, "account": NSNull(),
                    "usable": ["ok": false, "reason": "no_account"],
                    "termsVersion": version,
                    "canSendEmail": false,
                ])
            }
            if account.isDev && !plans.developer() { plans.setDeveloper(true) }
            applyAccountTier(account)
            return .json(200, [
                "signedIn": true,
                "account": account.publicJSON(),
                "usable": TVMAccounts.usable(account, termsVersion: version),
                "termsVersion": version,
                "canSendEmail": false,
            ])
        }
        // Phones do not send email; the desktop TVM does.
        if (path == "/api/account/email/send" || path == "/api/account/email/verify") && method == "POST" {
            return .json(503, ["error": "This phone cannot send email. Ask the dev to switch your account on."])
        }
        if path == "/api/account/terms" && method == "POST" {
            guard let account = accounts.resolve(token: bearerToken(headers)),
                  let body = accounts.acceptTerms(id: account.id) else {
                return .json(401, ["error": "Sign in first."])
            }
            if let refreshed = accounts.resolve(token: bearerToken(headers)) { applyAccountTier(refreshed) }
            return .json(200, body)
        }

        // Dev mode only, checked here rather than by hiding the route.
        if path == "/api/admin/accounts" && method == "GET" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            return .json(200, accounts.list(search: query["search"], state: query["state"]))
        }
        if path == "/api/admin/accounts/activate" && method == "POST" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            guard let id = json["id"] as? String, let tier = json["tier"] as? String,
                  let body = accounts.activate(id: id, tier: tier, note: json["note"] as? String) else {
                return .json(400, ["error": "Choose an account and a tier."])
            }
            return .json(200, body)
        }
        if path == "/api/admin/accounts/suspend" && method == "POST" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            guard let id = json["id"] as? String,
                  let body = accounts.setSuspended(id: id, suspended: (json["suspended"] as? Bool) ?? true) else {
                return .json(400, ["error": "Choose an account."])
            }
            return .json(200, body)
        }
        if path == "/api/admin/accounts/note" && method == "POST" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            guard let id = json["id"] as? String,
                  let body = accounts.setNote(id: id, note: json["note"] as? String) else {
                return .json(400, ["error": "Choose an account."])
            }
            return .json(200, body)
        }
        if path == "/api/admin/accounts/erase" && method == "POST" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            guard let id = json["id"] as? String else { return .json(400, ["error": "Choose an account."]) }
            accounts.erase(id: id)
            return .json(200, ["ok": true])
        }
        if path == "/api/admin/accounts/live-tv" && method == "POST" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            guard let id = json["id"] as? String, let enabled = json["enabled"] as? Bool else {
                return .json(400, ["error": "Choose an account."])
            }
            return adminReply(accounts.setLiveTv(id: id, enabled: enabled))
        }
        if path == "/api/admin/accounts/rd" && method == "POST" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            guard let id = json["id"] as? String, let token = json["token"] as? String else {
                return .json(400, ["error": "Choose an account."])
            }
            return adminReply(accounts.setRdToken(id: id, token: token))
        }
        if path == "/api/admin/accounts/verify" && method == "POST" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            guard let id = json["id"] as? String else { return .json(400, ["error": "Choose an account."]) }
            return adminReply(accounts.setEmailVerified(id: id, verified: (json["verified"] as? Bool) ?? true))
        }
        if path == "/api/admin/mail" || path == "/api/admin/mail/test" {
            guard devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            if method == "GET" {
                return .json(200, [
                    "configured": false, "supported": false, "host": NSNull(), "port": NSNull(),
                    "security": NSNull(), "username": NSNull(), "from": NSNull(),
                ])
            }
            return .json(501, ["error": "Set email up on the desktop TVM. Phones do not send it."])
        }

        if path == "/api/dev/status" && method == "GET" { return .json(200, ["unlocked": devRequest(headers)]) }
        if path == "/api/dev/unlock" && method == "POST" {
            // The shared code is verified here rather than refused, so developer
            // mode behaves the same on a phone as on the desktop Core.
            let password = (json["password"] as? String) ?? ""
            guard TVMDevUnlock.verify(password) else {
                return .json(403, ["unlocked": false, "error": "That developer code was not recognised."])
            }
            plans.setDeveloper(true)
            return .json(200, ["unlocked": true])
        }
        if path == "/api/dev/lock" && method == "POST" {
            plans.setDeveloper(false)
            return .json(200, ["unlocked": false])
        }
        if path == "/api/dev/overrides" && method == "PUT" {
            return .json(403, ["error": "developer_required"])
        }
        if path == "/api/system/session" && method == "GET" {
            return .json(200, ["appliance": false, "mode": "unknown"])
        }
        if path == "/api/system/session" && method == "POST" {
            return .json(409, ["ok": false, "reason": "not_appliance"])
        }
        if path == "/api/maintenance/clear-cache" && method == "POST" {
            media.clearCache()
            return .json(200, ["ok": true])
        }
        if path == "/api/privacy/export" && method == "GET" {
            let registry = store.profiles()
            return .json(200, store.personalExport(activeId: registry.activeId, profiles: registry.profiles, billing: plans.billing()))
        }
        if (path == "/api/maintenance/factory-reset" || path == "/api/privacy/erase") && method == "POST" {
            if path == "/api/privacy/erase", json["confirmation"] as? String != "ERASE_LOCAL_DATA" {
                return .json(400, ["error": "confirmation_required"])
            }
            store.factoryReset()
            TVMBundledUI.invalidate()
            media.clearCache()
            liveURL = nil
            liveHost = nil
            liveUser = nil
            liveChannels = []
            livePicks = []
            return .json(200, ["ok": true])
        }
        if path == "/api/live" && method == "GET" { return .json(200, liveStatus()) }
        if path == "/api/live" && method == "PUT" {
            let text = (json["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let url = (json["url"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if text.isEmpty && url.isEmpty { return .json(400, ["error": "url or playlist text is required"]) }
            await setPlaylist(text.isEmpty ? url : text)
            return .json(200, liveStatus())
        }
        if path == "/api/live/xtream" && method == "PUT" {
            guard let host = json["host"] as? String, let username = json["username"] as? String,
                  let password = json["password"] as? String else {
                return .json(400, ["error": "host, username and password are required"])
            }
            guard var playlist = URLComponents(string: host),
                  ["http", "https"].contains(playlist.scheme?.lowercased() ?? ""), playlist.host != nil,
                  playlist.user == nil, playlist.password == nil else {
                return .json(400, ["error": "Enter a valid HTTP or HTTPS provider address."])
            }
            playlist.path = playlist.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")).isEmpty ? "/get.php" : playlist.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/get.php"
            if !playlist.path.hasPrefix("/") { playlist.path = "/" + playlist.path }
            // output=ts, not m3u8: many panels generate an HLS manifest whose segments
            // their CDN then refuses with 403, which reaches the viewer as a dead
            // stream. See xtreamStreamUrl in apps/core/src/providers/xtream.ts.
            playlist.queryItems = [URLQueryItem(name: "username", value: username), URLQueryItem(name: "password", value: password), URLQueryItem(name: "type", value: "m3u_plus"), URLQueryItem(name: "output", value: "ts")]
            guard let url = playlist.url else { return .json(400, ["error": "Invalid provider address."]) }
            var request = URLRequest(url: url); request.timeoutInterval = 15
            guard let (data, response) = try? await session.data(for: request),
                  let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let text = String(data: data, encoding: .utf8), text.contains("#EXTM3U") else {
                return .json(400, ["error": "The provider did not return an HLS playlist. Check your login and provider HLS support."])
            }
            let channels = parseM3U(text)
            guard !channels.isEmpty else { return .json(400, ["error": "The provider playlist contains no channels."]) }
            liveChannels = channels
            liveURL = "xtream"
            liveHost = host
            liveUser = username
            XtreamKeychain.save(password)
            persistLive()
            return .json(200, liveStatus())
        }
        if path == "/api/live/xtream" && method == "DELETE" {
            liveHost = nil
            liveUser = nil
            XtreamKeychain.clear()
            persistLive()
            return .json(200, liveStatus())
        }
        if path == "/api/live/catalog" && method == "GET" {
            return .json(200, liveCatalog(q: query["q"] ?? "", group: query["group"] ?? "", offset: Int(query["offset"] ?? "0") ?? 0))
        }
        if path == "/api/live/picks" && method == "PUT" {
            livePicks = Set(json["ids"] as? [String] ?? [])
            persistLive()
            return .json(200, liveStatus())
        }
        if path == "/api/live/picks" && method == "POST" {
            if let id = json["id"] as? String, let picked = json["picked"] as? Bool {
                if picked { livePicks.insert(id) } else { livePicks.remove(id) }
                persistLive()
            }
            return .json(200, liveStatus())
        }
        if path == "/api/live/picks/group" && method == "POST" {
            return .json(200, liveStatus())
        }
        if path == "/api/lan/session" {
            return .json(404, ["error": "standalone_mode", "reason": "This iPhone app runs its own core. A LAN token is not required."])
        }
        if path.hasPrefix("/api/live/proxy/") && (method == "GET" || method == "HEAD") {
            let token = String(path.dropFirst("/api/live/proxy/".count))
            return await liveReflector.serve(token, method: method)
        }
        if path.hasPrefix("/api/") { return .json(404, ["error": "not_found"]) }
        return .json(404, ["error": "not_found"])
    }

    private func art(_ src: String, head: Bool) async -> HTTPReply {
        guard let url = allowedArt(src) else { return .json(400, ["error": "art host not allowed"]) }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return .json(502, ["error": "art fetch failed"])
            }
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? "image/jpeg"
            if head { return HTTPReply(status: 200, headers: ["Content-Type": type], body: Data()) }
            return .bytes(200, type: type, data: data)
        } catch {
            return .json(502, ["error": "art fetch failed"])
        }
    }

    private func allowedArt(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.user == nil, url.password == nil,
              url.scheme == "https" || url.scheme == "http" else { return nil }
        let host = url.host?.lowercased() ?? ""
        let allowed = ["image.tmdb.org", "images.metahub.space", "live.metahub.space", "mzstatic.com", "tvmaze.com", "kitsu.io", "fanart.tv"]
        if allowed.contains(where: { host == $0 || host.hasSuffix(".\($0)") }) { return url }
        return nil
    }

    /// DW News, straight from Deutsche Welle. Same test channel as apps/core/src/providers/live.ts.
    static let testChannelURL = "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8"

    /// A real live broadcast for checking the proxy with. Dev account only.
    private func testChannels() -> [[String: Any]] {
        guard plans.developer() else { return [] }
        return [["id": "live:test:dw-news", "name": "DW News", "url": TVMLocalCore.testChannelURL, "group": "Test", "logo": ""]]
    }

    private func adminReply(_ result: Result<[String: Any], TVMAccountError>) -> HTTPReply {
        switch result {
        case .success(let body): return .json(200, body)
        case .failure(let error): return .json(400, ["error": error.message])
        }
    }

    /// Whose key this is: the account's own, or the one saved on the phone.
    private func rdStatusJSON(_ status: RdStatus) -> [String: Any] {
        var out = status.json()
        let source: Any
        if rd.hasAccountToken() {
            source = "account"
        } else if status.configured {
            source = "device"
        } else {
            source = NSNull()
        }
        out["source"] = source
        return out
    }

    // Native VLC handles HLS, raw MPEG-TS and extensionless provider streams.
    private func playLive(_ id: String) async -> HTTPReply {
        guard plans.status()["liveTv"] as? Bool == true else { return .json(409, ["kind": "unavailable", "reason": "Live TV requires the Live TV add-on."]) }
        guard let channel = (testChannels() + liveChannels).first(where: { $0["id"] as? String == id }),
              let raw = channel["url"] as? String, let url = URL(string: raw),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
            return .json(409, ["kind": "unavailable", "reason": "not-in-library"])
        }
        let hls = url.pathExtension.lowercased() == "m3u8"
        let reflected = liveReflector.publish(url)
        return .json(200, ["kind": "stream", "url": reflected, "title": channel["name"] as? String ?? "Live TV", "filename": url.lastPathComponent, "mimeType": hls ? "application/vnd.apple.mpegurl" : "video/mp2t", "engine": "html5", "transport": hls ? "hls" : "ts-live", "isLive": true])
    }

    private func liveStatus() -> [String: Any] {
        let groups = Dictionary(grouping: liveChannels) { ($0["group"] as? String) ?? "Other" }
            .map { ["name": $0.key, "count": $0.value.count, "picked": $0.value.filter { livePicks.contains($0["id"] as? String ?? "") }.count] }
        return [
            "url": JSONValue.orNull(liveURL),
            "host": JSONValue.orNull(liveHost),
            "username": JSONValue.orNull(liveUser),
            "configured": liveURL != nil || liveHost != nil,
            "channels": (testChannels() + Array(liveChannels.prefix(48))).map { channel in
                var card = channel
                card["picked"] = livePicks.contains(channel["id"] as? String ?? "")
                card.removeValue(forKey: "url")
                return card
            },
            "error": JSONValue.orNull(liveChannels.isEmpty && liveURL != nil ? "The playlist had no channels this phone can list." : nil),
            "picked": livePicks.count,
            "total": liveChannels.count,
            "groups": groups,
            "needsPicks": livePicks.isEmpty && liveChannels.count > 48,
            "pickLimit": 48,
        ]
    }

    private func liveCatalog(q: String, group: String, offset: Int) -> [String: Any] {
        var items = liveChannels
        if !q.isEmpty {
            items = items.filter { ($0["name"] as? String ?? "").localizedCaseInsensitiveContains(q) }
        }
        if !group.isEmpty {
            items = items.filter { ($0["group"] as? String ?? "") == group }
        }
        let page = Array(items.dropFirst(max(0, offset)).prefix(48))
        return [
            "items": page.map { channel -> [String: Any] in
                var card = channel
                card["picked"] = livePicks.contains(channel["id"] as? String ?? "")
                card.removeValue(forKey: "url")
                return card
            },
            "groups": (liveStatus()["groups"] as? [[String: Any]]) ?? [],
            "total": liveChannels.count,
            "matched": items.count,
            "offset": offset,
            "limit": 48,
            "picked": livePicks.count,
            "pickLimit": 48,
            "query": q,
            "group": JSONValue.orNull(group.isEmpty ? nil : group),
        ]
    }

    private func setPlaylist(_ value: String) async {
        if value.hasPrefix("http"), let url = URL(string: value) {
            liveURL = value
            if let (data, _) = try? await session.data(from: url), let text = String(data: data, encoding: .utf8) {
                liveChannels = parseM3U(text)
            } else {
                liveChannels = []
            }
        } else {
            liveURL = "local"
            liveChannels = parseM3U(value)
        }
        persistLive()
    }

    private func parseM3U(_ text: String) -> [[String: Any]] {
        var channels: [[String: Any]] = []
        var pendingName = "Channel"
        var pendingGroup = "Other"
        var pendingLogo = ""
        for line in text.split(whereSeparator: \.isNewline).map({ $0.trimmingCharacters(in: .whitespaces) }) {
            if line.hasPrefix("#EXTINF") {
                pendingName = line.split(separator: ",").last.map(String.init) ?? "Channel"
                if let group = line.range(of: #"group-title="([^"]+)""#, options: .regularExpression) {
                    pendingGroup = String(line[group]).replacingOccurrences(of: "group-title=", with: "").replacingOccurrences(of: "\"", with: "")
                }
                if let logo = line.range(of: #"tvg-logo="([^"]+)""#, options: .regularExpression) {
                    pendingLogo = String(line[logo]).replacingOccurrences(of: "tvg-logo=", with: "").replacingOccurrences(of: "\"", with: "")
                }
            } else if line.hasPrefix("http") {
                channels.append([
                    "id": "live:\(channels.count + 1)",
                    "name": pendingName,
                    "url": line,
                    "group": pendingGroup,
                    "logo": pendingLogo,
                ])
                if channels.count >= 2000 { break }
            }
        }
        return channels
    }

    private func persistLive() {
        store.writeJSON("live.json", [
            "url": liveURL ?? "",
            "host": liveHost ?? "",
            "username": liveUser ?? "",
            "picks": Array(livePicks),
            "channels": liveChannels,
        ])
    }
}
