import Foundation

final class TVMLocalCore {
    let store: TVMStore
    let catalog: TVMCatalog
    let rd: TVMRealDebrid
    let plans: TVMPlans
    let media: TVMMedia
    private let startedAt = Date()
    private let session: URLSession
    private let lock = NSLock()
    private var liveURL: String?
    private var liveHost: String?
    private var liveUser: String?
    private var liveChannels: [[String: Any]] = []
    private var livePicks = Set<String>()

    init(session: URLSession? = nil) {
        store = TVMStore()
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 20
            configuration.httpShouldSetCookies = false
            self.session = URLSession(configuration: configuration)
        }
        catalog = TVMCatalog(store: store, session: self.session)
        rd = TVMRealDebrid(session: self.session)
        plans = TVMPlans(store: store)
        media = TVMMedia(store: store, catalog: catalog, rd: rd, plans: plans)
        if let saved = store.readJSON("live.json") as? [String: Any] {
            liveURL = saved["url"] as? String
            liveHost = saved["host"] as? String
            liveUser = saved["username"] as? String
            livePicks = Set(saved["picks"] as? [String] ?? [])
            liveChannels = saved["channels"] as? [[String: Any]] ?? []
        }
    }

    func handle(method: String, path: String, query: [String: String], headers: [String: String], body: Data?) async -> HTTPReply {
        media.applyProfileHeader(headers["x-tvm-profile"])
        let json = JSONValue.object(body)

        if path == "/api/health" && method == "GET" {
            return .json(200, [
                "status": "ok",
                "version": StandalonePolicy.version,
                "uptimeSeconds": Int(Date().timeIntervalSince(startedAt)),
                "mode": "standalone",
            ])
        }
        if path == "/api/update/status" && method == "GET" {
            return .json(200, updateStatus())
        }
        if path == "/api/update/check" && method == "POST" {
            return .json(200, updateStatus())
        }
        if path == "/api/update/apply" && method == "POST" {
            return .json(403, ["error": "apply_refused", "reason": "The iPhone app is updated from a new IPA, not from GitHub."])
        }
        if path == "/api/update/token" && method == "PUT" {
            return .json(200, ["configured": false])
        }
        if path == "/api/rd/status" && method == "GET" {
            return .json(200, (await media.status()).json())
        }
        if path == "/api/rd/configured" && method == "GET" {
            return .json(200, ["configured": rd.configured()])
        }
        if path == "/api/rd/token" && method == "PUT" {
            guard let token = json["token"] as? String else { return .json(400, ["error": "token must be a string"]) }
            do { return .json(200, (try await media.setToken(token)).json()) }
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
        if path == "/api/plan" && method == "GET" { return .json(200, plans.status()) }
        if path == "/api/plan" && method == "PUT" {
            guard plans.developer() else { return .json(403, ["error": "developer_required"]) }
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
            guard plans.developer() else { return .json(403, ["error": "developer_required"]) }
            return .json(200, plans.resetUsage())
        }
        if path == "/api/ads/preroll" && method == "GET" {
            return .json(200, ["skipped": true, "reason": "advertising_disabled_during_private_testing"])
        }
        if path == "/api/dev/status" && method == "GET" { return .json(200, ["unlocked": plans.developer()]) }
        if path == "/api/dev/unlock" && method == "POST" {
            return .json(403, ["unlocked": false, "error": "Developer unlock is available on the desktop Core, not on this phone app."])
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
        if path.hasPrefix("/api/") { return .json(404, ["error": "not_found"]) }
        return .json(404, ["error": "not_found"])
    }

    private func updateStatus() -> [String: Any] {
        [
            "current": StandalonePolicy.version,
            "channel": "ios-standalone",
            "lastCheck": NSNull(),
            "available": NSNull(),
            "configured": false,
            "applyAllowed": false,
            "applyReason": "Install a new IPA. This app does not pull GitHub releases.",
            "kind": "idle",
            "notice": "Phone updates are a new sideloaded IPA, not an in-app GitHub download.",
        ]
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

    private func liveStatus() -> [String: Any] {
        let groups = Dictionary(grouping: liveChannels) { ($0["group"] as? String) ?? "Other" }
            .map { ["name": $0.key, "count": $0.value.count, "picked": $0.value.filter { livePicks.contains($0["id"] as? String ?? "") }.count] }
        return [
            "url": JSONValue.orNull(liveURL),
            "host": JSONValue.orNull(liveHost),
            "username": JSONValue.orNull(liveUser),
            "configured": liveURL != nil || liveHost != nil,
            "channels": liveChannels.prefix(48).map { channel in
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
