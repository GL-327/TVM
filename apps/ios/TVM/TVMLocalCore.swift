import Foundation

final class TVMLocalCore {
    let store: TVMStore
    let catalog: TVMCatalog
    let rd: TVMRealDebrid
    let plans: TVMPlans
    let content: TVMContent
    let media: TVMMedia
    let reviews: TVMReviews
    let accounts: TVMAccounts
    let accountSync: TVMAccountSync
    /// Films and episodes saved on the iPhone (TVMDownloads).
    let downloads: TVMDownloads
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
    private let liveGuide: TVMLiveGuide
    private var liveGuideURLs: [String] = []

    init(
        session: URLSession? = nil,
        store: TVMStore = TVMStore(),
        accountsTransport: TVMAccountsTransport? = nil,
        sessionVault: TVMSessionVault? = nil,
        adminVault: TVMSessionVault? = nil,
        syncTransport: TVMSyncTransport? = nil
    ) {
        self.store = store
        // Titles known to carry another title's artwork, before any picture is asked for.
        TVMArtTrust.attach(store.url("art-distrust.json"))
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 20
            configuration.httpShouldSetCookies = false
            configuration.httpAdditionalHeaders = ["Accept-Language": TVMPrefs.acceptLanguage(TVMPrefs.load(store).language)]
            self.session = URLSession(configuration: configuration)
        }
        content = TVMContent(store: store, session: self.session)
        catalog = TVMCatalog(store: store, session: self.session)
        rd = TVMRealDebrid(session: self.session)
        plans = TVMPlans(store: store)
        let pinGuard = TVMPinGuard()
        let mediaInstance = TVMMedia(store: store, catalog: catalog, rd: rd, plans: plans, content: content, pinGuard: pinGuard)
        media = mediaInstance
        reviews = TVMReviews(itemLookup: { id in await mediaInstance.item(id) }, session: self.session)
        accounts = TVMAccounts(
            transport: accountsTransport ?? TVMURLSessionTransport(),
            vault: sessionVault ?? TVMKeychainSessionVault(),
            adminVault: adminVault ?? (sessionVault == nil ? TVMKeychainSessionVault(account: "admin_key") : TVMMemorySessionVault())
        )
        let resolvedSyncTransport: TVMSyncTransport = syncTransport
            ?? accountsTransport.map { TVMAccountsSyncAdapter(transport: $0) }
            ?? TVMURLSessionSyncTransport()
        let syncInstance = TVMAccountSync(
            store: store,
            origin: accounts.syncOrigin,
            transport: resolvedSyncTransport,
            reloadProfiles: { [weak mediaInstance] in
                mediaInstance?.pinGuard.clearSessionUnlocks()
            }
        )
        accountSync = syncInstance
        store.onSyncStoreChanged = { [weak syncInstance] in
            syncInstance?.notifyLocalChange()
        }
        downloads = TVMDownloads(store: store) { id, language, height in
            await mediaInstance.download(id: id, language: language, maxHeight: height)
        }
        liveReflector = TVMLiveReflector(session: self.session)
        liveGuide = TVMLiveGuide(session: self.session)
        if let saved = store.readJSON("live.json") as? [String: Any] {
            liveURL = saved["url"] as? String
            liveHost = saved["host"] as? String
            liveUser = saved["username"] as? String
            liveGuideURLs = saved["guideUrls"] as? [String] ?? []
            livePicks = Set(saved["picks"] as? [String] ?? [])
            liveChannels = saved["channels"] as? [[String: Any]] ?? []
            if saved["guideUrls"] == nil, (liveHost ?? "").isEmpty, let previousURL = liveURL, previousURL.hasPrefix("http") {
                Task.detached { [weak self] in await self?.restorePlaylistGuide(previousURL) }
            }
        }
    }

    deinit {
        accountSync.clearAll()
    }

    func restoreSyncFromVault() {
        if let token = accounts.currentSessionToken {
            accountSync.restore(token: token)
        }
    }

    /// The app came back to the foreground: forget cached account, key and config answers so changes show at once.
    func onForeground() {
        accounts.invalidateCaches()
        accountSync.onForeground()
    }

    /// Dev mode belongs to an owner (admin) account, so dev-only routes check
    /// who is asking. Any app on the phone can reach this server, not just TVM.
    private func devRequest(_ headers: [String: String]) async -> Bool {
        guard let account = await accounts.resolve(token: bearerToken(headers)), account.isDev else { return false }
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
            if rd.useAccountToken(await accounts.rdTokenFor(token: bearerToken(headers))) { media.forgetLibrary() }
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
            prefs.merge(json)
            prefs.save(store)
            return .json(200, prefs.json())
        }
        if (path == "/api/playback/versions" || path == "/api/versions") && method == "GET" {
            guard let id = query["id"], !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .json(400, ["error": "id is required"]) }
            return .json(200, await media.versions(id: id, season: query["season"].flatMap(Int.init), episode: query["episode"].flatMap(Int.init)))
        }
        if path == "/api/config" && method == "GET" {
            return .json(200, await accounts.config())
        }
        if path == "/api/announcement" && method == "GET" {
            return .json(200, await accounts.announcement())
        }
        // Hero clips, theme songs and yt-dlp need a desktop; phones say so and the interface hides the feature.
        if path.hasPrefix("/api/extras/") && path != "/api/extras/surprise" && (method == "GET" || method == "HEAD") {
            return .json(404, ["status": "unavailable", "error": "unavailable"])
        }
        if path == "/api/extras/surprise" && method == "GET" {
            if let item = media.watchlist().randomElement() { return .json(200, ["item": item.json()]) }
            return .json(200, ["item": NSNull()])
        }
        if path == "/api/progress/remove" && method == "POST" {
            guard let id = JSONValue.string(json["id"]), TVMWebhook.isValidProgressId(id) else {
                return .json(400, ["error": "invalid progress id"])
            }
            store.removeContinueWatching(profileId: media.activeProfile(), id: id)
            return .json(200, ["ok": true])
        }
        if path == "/api/progress/watched" && method == "POST" {
            guard let id = JSONValue.string(json["id"]), let watched = json["watched"] as? Bool,
                  TVMWebhook.isValidProgressId(id) else {
                return .json(400, ["error": "invalid progress"])
            }
            var target = id
            if let season = JSONValue.int(json["season"]), season >= 0,
               let episode = JSONValue.int(json["episode"]), episode >= 1,
               id.range(of: #":\d+:\d+$"#, options: .regularExpression) == nil {
                target = "\(id):\(season):\(episode)"
            }
            guard TVMWebhook.isValidProgressId(target) else { return .json(400, ["error": "invalid progress id"]) }
            store.setWatched(profileId: media.activeProfile(), id: target, watched: watched)
            return .json(200, ["ok": true])
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
            // A member's key goes on their account at the service. The owner's key is the phone's.
            if let sessionToken = bearerToken(headers), let me = await accounts.resolve(token: sessionToken), !me.isDev {
                if case .failure(let error) = await accounts.setRdToken(token: sessionToken, key: token) {
                    return .json(error.status == 429 || error.status == 503 ? error.status : 400, ["error": error.message])
                }
                if rd.useAccountToken(await accounts.rdTokenFor(token: sessionToken)) { media.forgetLibrary() }
                return .json(200, rdStatusJSON(await media.status()))
            }
            do { return .json(200, rdStatusJSON(try await media.setToken(token))) }
            catch { return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "token rejected"]) }
        }
        if path == "/api/changelog" && method == "GET" {
            return .json(200, content.changelogPayload())
        }
        if path.hasPrefix("/api/content/") && method == "GET" {
            let name = String(path.dropFirst("/api/content/".count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            guard TVMContent.contentNames.contains(name) else {
                return .json(404, ["error": "not_found"])
            }
            let payload: [String: Any]? = TVMContent.refreshable[name] != nil ? await content.fresh(name) : content.load(name)
            if let payload { return .json(200, payload) }
            return .json(404, ["error": "not_found"])
        }
        if path == "/api/profiles" && method == "GET" { return .json(200, media.profilesJSON()) }
        if path == "/api/profiles" && method == "POST" {
            do {
                return .json(200, try media.createProfile(
                    json["name"] as? String ?? "",
                    hue: json["hue"] is NSNull ? nil : JSONValue.int(json["hue"]),
                    avatarRaw: json.keys.contains("avatar") ? json["avatar"] : nil,
                    kindRaw: json["kind"] as? String,
                    maxAgeRaw: json["maxAge"],
                    pinRaw: json["pin"]
                ))
            } catch {
                return profileErrorReply(error)
            }
        }
        if path == "/api/profiles" && method == "PUT" {
            do {
                return .json(200, try media.updateProfile(json))
            } catch {
                return profileErrorReply(error)
            }
        }
        if path == "/api/profiles/active" && method == "POST" {
            guard let id = json["id"] as? String else { return .json(400, ["error": "id must be a string"]) }
            do {
                let pin = try extractPin(json, key: "pin")
                return .json(200, try media.switchProfile(id, pin: pin))
            } catch {
                return profileErrorReply(error)
            }
        }
        if path == "/api/profiles/verify-pin" && method == "POST" {
            guard let id = json["id"] as? String else { return .json(400, ["error": "id must be a string"]) }
            do {
                let pin = try extractPin(json, key: "pin")
                return .json(200, try media.verifyProfilePIN(id: id, pin: pin))
            } catch let pinError as PinFailure {
                if pinError.errorCode == "pin-wrong" || pinError.errorCode == "pin-required" {
                    return .json(200, ["ok": false, "error": pinError.errorCode])
                }
                return .json(pinError.httpStatus, pinError.json())
            } catch {
                return profileErrorReply(error)
            }
        }
        if path == "/api/profiles/remove" && method == "POST" {
            guard let id = json["id"] as? String else { return .json(400, ["error": "id must be a string"]) }
            do {
                let pin = try extractPin(json, key: "pin")
                return .json(200, try media.removeProfile(id, pin: pin))
            } catch {
                return profileErrorReply(error)
            }
        }
        if path == "/api/events/active" && method == "GET" {
            return .json(200, await media.activeEvents())
        }
        if path == "/api/services" && method == "GET" {
            return .json(200, await media.servicesJSON())
        }
        if path == "/api/services/connected" && method == "POST" {
            guard let id = JSONValue.string(json["id"]) else {
                return .json(400, ["error": "id must be a string"])
            }
            guard let connected = json["connected"] as? Bool else {
                return .json(400, ["error": "connected must be a boolean"])
            }
            do {
                return .json(200, try await media.setServiceConnected(id: id, connected: connected))
            } catch {
                return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "service rejected"])
            }
        }
        if path == "/api/rails/more" && method == "GET" {
            let railId = (query["id"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard TVMMedia.isValidRailId(railId) else {
                return .json(400, ["error": "rail id is invalid"])
            }
            let skip = Int(query["skip"] ?? "") ?? 0
            let page = query["page"].flatMap(Int.init)
            do {
                return .json(200, try await media.railMore(id: railId, skipParam: skip, pageParam: page))
            } catch {
                return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "rail rejected"])
            }
        }
        if path == "/api/reviews" && method == "GET" {
            let rawId = (query["id"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard TVMReviews.isValidImdbId(rawId), let payload = await reviews.get(rawId) else {
                return .json(400, ["error": "id must be an IMDb id"])
            }
            return .json(200, payload.json())
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
        // Downloads, for the shared Downloads screen (as Android's core answers it).
        if path == "/api/downloads" && method == "GET" { return .json(200, downloads.list()) }
        if path == "/api/downloads/folder" && (method == "GET" || method == "POST") {
            // iOS keeps downloads in the app's own folder (shown in Files); there is nothing to pick.
            return .json(200, ["name": downloads.folderDisplayName()])
        }
        if path == "/api/downloads" && method == "POST" {
            let prefs = json["preferences"] as? [String: Any] ?? [:]
            let language = prefs["language"] as? String ?? "en"
            let maxHeight = JSONValue.int(prefs["maxHeight"]) ?? 1080
            let items: [(id: String, title: String)] = (json["items"] as? [[String: Any]] ?? []).compactMap { raw in
                guard let id = raw["id"] as? String, !id.isEmpty, id.count <= 512, !id.hasPrefix("live:") else { return nil }
                return (id, raw["title"] as? String ?? "TVM video")
            }
            guard !items.isEmpty, language.count <= 16, (240...4320).contains(maxHeight) else {
                return .json(400, ["error": "Choose a film or episode and valid download options."])
            }
            do { return .json(200, try downloads.enqueue(items, language: language, maxHeight: maxHeight)) }
            catch { return .json(400, ["error": error.localizedDescription]) }
        }
        if path.hasPrefix("/api/downloads/") && path.hasSuffix("/cancel") && method == "POST" {
            downloads.cancel(String(path.dropFirst("/api/downloads/".count).dropLast("/cancel".count)))
            return .json(200, downloads.list())
        }

        if path == "/api/playback" && method == "POST" {
            guard plans.mobileAllowed() else { return .json(403, ["kind": "unavailable", "reason": "mobile-plan-required"]) }
            if let id = json["id"] as? String, id.hasPrefix("live:") { return await playLive(id) }
            // A title downloaded to this phone plays from the file, offline.
            if JSONValue.string(json["versionId"]) == nil, let id = JSONValue.string(json["id"]), let copy = downloads.offlineCopy(id) {
                var reply: [String: Any] = ["kind": "stream", "url": copy.url.absoluteString,
                                            "title": JSONValue.string(json["title"]) ?? copy.name, "filename": copy.name,
                                            "mimeType": "application/octet-stream", "engine": "native", "transport": "file"]
                if let startAt = media.resumePosition(id) { reply["startAt"] = startAt }
                reply = media.withPlaybackDetails(reply)
                media.playbackStarted(id: id, payload: reply)
                return .json(200, reply)
            }
            let result = await media.play(
                id: JSONValue.string(json["id"]),
                link: JSONValue.string(json["link"]),
                title: JSONValue.string(json["title"]),
                season: JSONValue.int(json["season"]),
                episode: JSONValue.int(json["episode"]),
                screenHeight: JSONValue.int(json["screenHeight"]),
                maxHeight: JSONValue.int(json["maxHeight"]),
                versionId: JSONValue.string(json["versionId"]),
                client: PlaybackClient.parse(json["client"])
            )
            let payload = result.0 == 200 ? media.withPlaybackDetails(result.1) : result.1
            if result.0 == 200 { media.playbackStarted(id: JSONValue.string(json["id"]), payload: payload) }
            return .json(result.0, payload)
        }
        if path == "/api/playback/event" && method == "POST" {
            guard let event = TVMWebhook.parseEvent(json) else { return .json(400, ["error": "invalid playback event"]) }
            media.playbackEvent(event)
            return .json(200, ["ok": true])
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
            if (status["developer"] as? Bool) == true {
                let asking = await devRequest(headers)
                if !asking { status["developer"] = false }
            }
            return .json(200, status)
        }
        if path == "/api/plan" && method == "PUT" {
            guard await devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
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
            guard await devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
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
            switch await accounts.register(
                email: json["email"] as? String ?? "",
                password: json["password"] as? String ?? "",
                displayName: json["displayName"] as? String,
                client: headers["user-agent"]
            ) {
            case .success(let body): return .json(200, body)
            case .failure(let error): return .json(accountStatus(error, otherwise: 400), ["error": error.message])
            }
        }
        if path == "/api/sync/status" && method == "GET" {
            return .json(200, accountSync.status(token: bearerToken(headers)).json())
        }
        if path == "/api/sync/now" && method == "POST" {
            return .json(200, await accountSync.syncNow(token: bearerToken(headers)).json())
        }
        if path == "/api/account/signin" && method == "POST" {
            switch await accounts.signIn(
                email: json["email"] as? String ?? "",
                password: json["password"] as? String ?? "",
                client: headers["user-agent"]
            ) {
            case .success(let body):
                if let token = body["token"] as? String,
                   let accountObj = body["account"] as? [String: Any],
                   let accountId = accountObj["id"] as? String {
                    accountSync.bind(token: token, accountId: accountId, signingIn: true)
                }
                return .json(200, body)
            case .failure(let error): return .json(accountStatus(error, otherwise: 401), ["error": error.message])
            }
        }
        // Developer access moved to the owner's admin account; there is nothing to enter here.
        if path == "/api/account/dev" && method == "POST" {
            return .json(410, ["error": "moved"])
        }
        if path == "/api/account/signout" && method == "POST" {
            if let token = bearerToken(headers) {
                let leaving = await accounts.resolve(token: token)
                accountSync.signOut(token: token)
                await accounts.signOut(token: token)
                // Developer mode goes with the owner account.
                if leaving?.isDev == true { plans.setDeveloper(false) }
            }
            return .json(200, ["ok": true])
        }
        if path == "/api/account" && method == "GET" {
            let version = TVMAccounts.termsVersion()
            let token = bearerToken(headers)
            let account: TVMAccount
            switch await accounts.lookup(token: token) {
            case .found(let found):
                if let token { accountSync.bind(token: token, accountId: found.id, signingIn: false) }
                account = found
            case .unavailable:
                return .json(503, ["error": "TVM accounts cannot be reached. Check your connection and try again."])
            case .signedOut:
                if let token { accountSync.detach(token: token) }
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
        if path == "/api/account/verify/resend" && method == "POST" {
            let reply = await accounts.resendVerification(token: bearerToken(headers), rawEmail: JSONValue.string(json["email"]))
            return .json(reply.0, reply.1)
        }
        if path == "/api/account/password/forgot" && method == "POST" {
            let reply = await accounts.forgotPassword(rawEmail: JSONValue.string(json["email"]))
            return .json(reply.0, reply.1)
        }
        // Phones do not send email themselves; the accounts service does.
        if (path == "/api/account/email/send" || path == "/api/account/email/verify") && method == "POST" {
            return .json(503, ["error": "This phone cannot send email. Ask the owner to switch your account on."])
        }
        if path == "/api/account/terms" && method == "POST" {
            guard let token = bearerToken(headers) else { return .json(401, ["error": "Sign in first."]) }
            switch await accounts.acceptTerms(token: token) {
            case .success(let body):
                if let refreshed = await accounts.resolve(token: token) { applyAccountTier(refreshed) }
                return .json(200, body)
            case .failure(let error):
                return .json(accountStatus(error, otherwise: 400), ["error": error.message])
            }
        }

        // The developer menu: install the admin key (kept in the Keychain, never sent to the interface), then mirror the service admin API.
        if path == "/api/admin/key" && method == "GET" {
            guard await devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            return .json(200, ["installed": accounts.hasAdminKey()])
        }
        if path == "/api/admin/key" && method == "POST" {
            let reply = await accounts.installAdminKey(token: bearerToken(headers), rawKey: JSONValue.string(json["key"]) ?? "")
            var body = reply.1
            body["installed"] = accounts.hasAdminKey()
            return .json(reply.0, body)
        }
        let adminAccountPath = #"^/api/admin/accounts/[A-Za-z0-9_-]{1,128}/(?:sessions|profile|password|tier)$|^/api/admin/accounts/[A-Za-z0-9_-]{1,128}/sessions/[A-Za-z0-9_-]{1,128}$"#
        if path == "/api/admin/config" || path == "/api/admin/audit" || path == "/api/admin/accounts.csv" ||
            path == "/api/admin/rd/test" || path == "/api/admin/accounts" || path == "/api/admin/accounts/bulk" ||
            path.range(of: adminAccountPath, options: .regularExpression) != nil {
            let allowed: Bool
            if path == "/api/admin/config" { allowed = method == "GET" || method == "PUT" }
            else if path == "/api/admin/rd/test" || path == "/api/admin/accounts/bulk" { allowed = method == "POST" }
            else if path.hasSuffix("/profile") || path.hasSuffix("/password") || path.hasSuffix("/tier") { allowed = method == "POST" }
            else if path.contains("/sessions/") { allowed = method == "DELETE" }
            else { allowed = method == "GET" }
            if !allowed { return .json(405, ["error": "method_not_allowed"]) }
            var v1 = String(path.dropFirst("/api/admin/".count))
            if method == "GET" {
                let pairs = ["offset", "type", "search", "state"].compactMap { key -> String? in
                    guard let value = query[key], !value.isEmpty,
                          let encoded = value.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { return nil }
                    return "\(key)=\(encoded)"
                }
                if !pairs.isEmpty { v1 += "?" + pairs.joined(separator: "&") }
            }
            let sendBody: [String: Any]? = (method == "GET" || method == "DELETE") ? nil : json
            return await accounts.mirrorAdmin(token: bearerToken(headers), v1Path: v1, method: method, body: sendBody)
        }
        if path == "/api/admin/accounts" || path.hasPrefix("/api/admin/accounts/") {
            return .json(403, ["error": "use_dashboard"])
        }
        if path == "/api/admin/mail" || path == "/api/admin/mail/test" {
            guard await devRequest(headers) else { return .json(403, ["error": "developer_required"]) }
            if method == "GET" {
                return .json(200, [
                    "configured": false, "supported": false, "host": NSNull(), "port": NSNull(),
                    "security": NSNull(), "username": NSNull(), "from": NSNull(),
                ])
            }
            return .json(501, ["error": "Set email up on the desktop TVM. Phones do not send it."])
        }

        if path == "/api/dev/status" && method == "GET" {
            let unlocked = await devRequest(headers)
            return .json(200, ["unlocked": unlocked])
        }
        if path == "/api/dev/unlock" && method == "POST" {
            return .json(410, ["error": "moved"])
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
            accountSync.clearAll()
            await accounts.forgetEverything()
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
        if path == "/api/live/guide" && method == "GET" {
            guard let window = GuideWindow.parse(start: query["start"], hours: query["hours"]) else { return .json(400, ["error": "invalid guide window"]) }
            var free = await content.fresh("free-channels") ?? [:]
            let age = media.ageLevel(), levels = media.parentalLevels()
            free["channels"] = (free["channels"] as? [[String: Any]] ?? []).enumerated().compactMap { i, channel -> [String: Any]? in
                guard TVMParental.liveGroupAllowed(channel["group"] as? String, maxAge: age, levels: levels) else { return nil }
                var row = channel; row["number"] = i + 1; return row
            }
            let provider = plans.status()["liveTv"] as? Bool == true ? liveChannels.filter { TVMParental.liveGroupAllowed($0["group"] as? String, maxAge: age, levels: levels) } : []
            let group = query["group"]?.trimmingCharacters(in: .whitespacesAndNewlines)
            return .json(200, await liveGuide.guide(window: window, group: group?.isEmpty == true ? nil : group, free: free, iptv: provider, urls: liveGuideURLs, host: liveHost, user: liveUser, password: XtreamKeychain.read()))
        }
        if path == "/api/live/free" && method == "GET" { return .json(200, await media.freeLiveJSON()) }
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

    /// Pictures for the page, through TVMImages: retried, kept on the phone,
    /// and refused when they belong to another title (TVMArtTrust).
    private func art(_ src: String, head: Bool) async -> HTTPReply {
        guard let url = allowedArt(src) else { return .json(400, ["error": "art host not allowed"]) }
        let picture = await TVMImages.shared.load(url)
        guard picture.status == 200 else { return HTTPReply(status: picture.status, headers: ["Content-Type": "text/plain", "Cache-Control": "no-store"], body: Data()) }
        let headers = ["Content-Type": picture.type, "Cache-Control": TVMImages.cacheControl]
        return HTTPReply(status: 200, headers: headers, body: head ? Data() : picture.data)
    }

    private func allowedArt(_ raw: String) -> URL? {
        guard let url = URL(string: raw), url.user == nil, url.password == nil,
              url.scheme == "https" || url.scheme == "http" else { return nil }
        let host = url.host?.lowercased() ?? ""
        let allowed = ["image.tmdb.org", "metahub.space", "mzstatic.com", "tvmaze.com", "kitsu.io", "fanart.tv", "media-amazon.com"]
        if allowed.contains(where: { host == $0 || host.hasSuffix(".\($0)") }) { return url }
        return nil
    }

    /// DW News, straight from Deutsche Welle. Same test channel as apps/core/src/providers/live.ts.
    static let testChannelURL = "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8"

    /// A real live broadcast for checking the proxy with, listed while the dev account is signed in.
    private func testChannels() -> [[String: Any]] {
        guard plans.developer() else { return [] }
        return [["id": "live:test:dw-news", "name": "DW News", "url": TVMLocalCore.testChannelURL, "group": "Test", "logo": ""]]
    }

    /// Busy and unreachable keep their status; anything else gets the one the route would have used.
    private func accountStatus(_ error: TVMAccountError, otherwise: Int) -> Int {
        error.status == 429 || error.status == 503 || error.status == 401 ? error.status : otherwise
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

    private func extractPin(_ json: [String: Any], key: String) throws -> String? {
        guard json.keys.contains(key) else { return nil }
        guard let raw = json[key], !(raw is NSNull) else { return nil }
        guard let str = raw as? String else { throw PinFailure(400, "pin-invalid") }
        return str
    }

    private func profileErrorReply(_ error: Error) -> HTTPReply {
        if let pin = error as? PinFailure {
            return .json(pin.httpStatus, pin.json())
        }
        return .json(400, ["error": (error as? LocalizedError)?.errorDescription ?? "profile rejected"])
    }

    // Native VLC handles HLS, raw MPEG-TS and extensionless provider streams.
    private func playLive(_ id: String) async -> HTTPReply {
        let channel: [String: Any]?
        if id.hasPrefix("live:free:") {
            let targetId = String(id.dropFirst("live:free:".count))
            let doc = await content.fresh("free-channels")
            let rawList = doc?["channels"] as? [[String: Any]] ?? []
            guard let freeChannel = rawList.first(where: {
                let rid = $0["id"] as? String ?? ""
                return rid == targetId || "live:free:\(rid)" == id
            }) else {
                return .json(409, ["kind": "unavailable", "reason": "not-in-library"])
            }
            guard TVMParental.liveGroupAllowed(freeChannel["group"] as? String, maxAge: media.ageLevel(), levels: media.parentalLevels()) else {
                return .json(403, ["kind": "unavailable", "reason": "parental-blocked"])
            }
            channel = freeChannel
        } else {
            guard plans.status()["liveTv"] as? Bool == true else { return .json(409, ["kind": "unavailable", "reason": "Live TV requires the Live TV add-on."]) }
            channel = (testChannels() + liveChannels).first(where: { $0["id"] as? String == id })
        }
        guard let channel,
              let raw = channel["url"] as? String, let url = URL(string: raw),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else {
            return .json(409, ["kind": "unavailable", "reason": "not-in-library"])
        }
        let hls = url.pathExtension.lowercased() == "m3u8"
        let reflected = liveReflector.publish(url)
        let reply: [String: Any] = ["kind": "stream", "url": reflected, "title": channel["name"] as? String ?? "Live TV", "filename": url.lastPathComponent, "mimeType": hls ? "application/vnd.apple.mpegurl" : "video/mp2t", "engine": "html5", "transport": hls ? "hls" : "ts-live", "isLive": true]
        media.playbackStarted(id: id, payload: reply)
        return .json(200, reply)
    }

    private func liveStatus() -> [String: Any] {
        let age = media.ageLevel()
        let levels = media.parentalLevels()
        let allowedTests = testChannels().filter {
            TVMParental.liveGroupAllowed($0["group"] as? String, maxAge: age, levels: levels)
        }
        let allowedLive = liveChannels.filter {
            TVMParental.liveGroupAllowed($0["group"] as? String, maxAge: age, levels: levels)
        }
        let groups = Dictionary(grouping: liveChannels) { ($0["group"] as? String) ?? "Other" }
            .map { ["name": $0.key, "count": $0.value.count, "picked": $0.value.filter { livePicks.contains($0["id"] as? String ?? "") }.count] }
        return [
            "url": JSONValue.orNull(liveURL),
            "host": JSONValue.orNull(liveHost),
            "username": JSONValue.orNull(liveUser),
            "configured": liveURL != nil || liveHost != nil,
            "channels": (allowedTests + Array(allowedLive.prefix(48))).map { channel in
                var card = channel
                card["picked"] = livePicks.contains(channel["id"] as? String ?? "")
                card.removeValue(forKey: "url")
                return card
            },
            "error": JSONValue.orNull(liveChannels.isEmpty && liveURL != nil ? "The playlist had no channels this phone can list." : nil),
            "picked": livePicks.count,
            "total": allowedLive.count,
            "groups": groups,
            "needsPicks": livePicks.isEmpty && allowedLive.count > 48,
            "pickLimit": 48,
        ]
    }

    private func liveCatalog(q: String, group: String, offset: Int) -> [String: Any] {
        let age = media.ageLevel()
        let levels = media.parentalLevels()
        var items = liveChannels.filter {
            TVMParental.liveGroupAllowed($0["group"] as? String, maxAge: age, levels: levels)
        }
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
        liveHost = nil; liveUser = nil; XtreamKeychain.clear()
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

    private func restorePlaylistGuide(_ expectedURL: String) async {
        guard let url = URL(string: expectedURL), let (data, response) = try? await session.data(from: url),
              let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let text = String(data: data, encoding: .utf8), text.contains("#EXTM3U") else { return }
        applyPlaylistGuide(text, expectedURL: expectedURL)
    }

    private func applyPlaylistGuide(_ text: String, expectedURL: String) {
        lock.lock(); defer { lock.unlock() }
        guard liveURL == expectedURL, (liveHost ?? "").isEmpty else { return }
        let channels = parseM3U(text)
        if !channels.isEmpty { liveChannels = channels }
        persistLive()
    }

    private func parseM3U(_ text: String) -> [[String: Any]] {
        let header = text.components(separatedBy: .newlines).first { $0.hasPrefix("#EXTM3U") } ?? ""
        let regex = try? NSRegularExpression(pattern: #"(?:url-tvg|x-tvg-url)\s*=\s*["']([^"']+)["']"#, options: .caseInsensitive)
        liveGuideURLs = Array((regex?.matches(in: header, range: NSRange(header.startIndex..., in: header)) ?? []).flatMap { match -> [String] in
            guard let range = Range(match.range(at: 1), in: header) else { return [] }
            return header[range].split { $0 == "," || $0.isWhitespace }.map(String.init).filter { TVMXmlTv.safeURL($0) != nil }
        }.prefix(12))
        var channels: [[String: Any]] = []
        var pendingName = "Channel"
        var pendingGroup = "Other"
        var pendingLogo = ""
        var pendingId = ""
        for line in text.split(whereSeparator: \.isNewline).map({ $0.trimmingCharacters(in: .whitespaces) }) {
            if line.hasPrefix("#EXTINF") {
                pendingGroup = "Other"; pendingLogo = ""; pendingId = ""
                if let regex = try? NSRegularExpression(pattern: #"tvg-id\s*=\s*["']([^"']*)["']"#),
                   let match = regex.firstMatch(in: line, range: NSRange(line.startIndex..., in: line)),
                   let range = Range(match.range(at: 1), in: line) { pendingId = String(line[range]) }
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
                    "epgId": pendingId,
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
            "guideUrls": liveGuideURLs,
            "picks": Array(livePicks),
            "channels": liveChannels,
        ])
    }
}
