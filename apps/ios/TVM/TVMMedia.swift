import Foundation

final class TVMMedia {
    private let store: TVMStore
    private let catalog: TVMCatalog
    private let rd: TVMRealDebrid
    private let plans: TVMPlans
    private var libraryCache: (at: Date, torrents: [RdTorrent], downloads: [RdDownload], items: [MediaItem])?
    private let lock = NSLock()

    init(store: TVMStore, catalog: TVMCatalog, rd: TVMRealDebrid, plans: TVMPlans) {
        self.store = store
        self.catalog = catalog
        self.rd = rd
        self.plans = plans
    }

    func activeProfile() -> String { store.profiles().activeId }

    func applyProfileHeader(_ value: String?) {
        guard let value, !value.isEmpty else { return }
        let registry = store.profiles()
        if registry.profiles.contains(where: { $0.id == value }) {
            store.saveProfiles(activeId: value, profiles: registry.profiles)
        }
    }

    func profilesJSON() -> [String: Any] {
        let registry = store.profiles()
        return ["activeId": registry.activeId, "profiles": registry.profiles.map { $0.json() }]
    }

    func createProfile(_ name: String) throws -> [String: Any] {
        var registry = store.profiles()
        if registry.profiles.count >= plans.profilesMax() {
            throw ClientError.message("TVM holds \(plans.profilesMax()) profiles.")
        }
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let profile = ProfileRecord(
            id: "profile-\(UUID().uuidString)",
            name: trimmed.isEmpty ? "Profile \(registry.profiles.count + 1)" : trimmed,
            hue: [350, 220, 140, 32, 280][registry.profiles.count % 5],
            created: ISO8601DateFormatter().string(from: Date())
        )
        registry.profiles.append(profile)
        store.saveProfiles(activeId: profile.id, profiles: registry.profiles)
        return profilesJSON()
    }

    func renameProfile(id: String, name: String) -> [String: Any] {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return profilesJSON() }
        var registry = store.profiles()
        registry.profiles = registry.profiles.map { $0.id == id ? ProfileRecord(id: $0.id, name: trimmed, hue: $0.hue, created: $0.created) : $0 }
        store.saveProfiles(activeId: registry.activeId, profiles: registry.profiles)
        return profilesJSON()
    }

    func removeProfile(_ id: String) throws -> [String: Any] {
        var registry = store.profiles()
        if registry.profiles.count <= 1 { throw ClientError.message("TVM needs at least one profile.") }
        registry.profiles.removeAll { $0.id == id }
        let active = registry.activeId == id ? (registry.profiles.first?.id ?? id) : registry.activeId
        store.saveProfiles(activeId: active, profiles: registry.profiles)
        return profilesJSON()
    }

    func switchProfile(_ id: String) throws -> [String: Any] {
        let registry = store.profiles()
        guard registry.profiles.contains(where: { $0.id == id }) else { throw ClientError.message("Unknown profile.") }
        store.saveProfiles(activeId: id, profiles: registry.profiles)
        return profilesJSON()
    }

    func watchlist() -> [MediaItem] { store.watchlist(for: activeProfile()) }

    func addWatchlist(_ raw: Any?) -> [MediaItem] {
        guard var item = MediaItem.parse(raw) else { return watchlist() }
        item.added = ISO8601DateFormatter().string(from: Date())
        var items = watchlist().filter { $0.id != item.id }
        items.insert(item, at: 0)
        store.writeWatchlist(profileId: activeProfile(), items: items)
        return items
    }

    func removeWatchlist(_ id: String) -> [MediaItem] {
        let items = watchlist().filter { $0.id != id }
        store.writeWatchlist(profileId: activeProfile(), items: items)
        return items
    }

    func saveProgress(id: String, position: Double, duration: Double) {
        let profile = activeProfile()
        store.writeProgress(profileId: profile, id: id, position: position, duration: duration)
        let saved = store.recentMedia(for: profile)
        if saved.contains(where: { $0.id == id }) { return }
        let imdb = TVMTitle.catalogImdb(id)
        guard let cousin = saved.first(where: {
            $0.id == imdb || TVMTitle.catalogImdb($0.id) == id || (imdb != nil && TVMTitle.catalogImdb($0.id) == imdb)
        }) else { return }
        var copy = cousin
        copy.id = id
        store.rememberMedia([copy], profileId: profile)
    }

    func status() async -> RdStatus { await rd.status() }

    func setToken(_ token: String) async throws -> RdStatus {
        lock.lock()
        libraryCache = nil
        lock.unlock()
        return try await rd.setToken(token)
    }

    func home() async -> [String: Any] {
        var status = await rd.status()
        var library: [MediaItem] = []
        do { library = try await loadLibrary() }
        catch {
            status.error = (error as? RdClientError) == .needsAuth ? "needs-auth" : "unreachable"
            lock.lock()
            library = libraryCache?.items ?? []
            lock.unlock()
        }
        let progress = store.progress(for: activeProfile())
        library = applyProgress(library, progress)
        let bundle = await catalog.bundle()
        let catalogItems = applyProgress(bundle.catalog, progress)
        let continueWatching = self.continueWatching(catalogItems + library)
        let watchlist = self.watchlist()
        var rails = await buildRails(bundle: bundle, watching: continueWatching, watchlist: watchlist)
        /*
         * Split deliberately, with explicit types at each step. As one chained
         * expression — four arrays concatenated, then filtered, then sorted by
         * a comparator full of optional chaining and `??` — this exceeded the
         * Swift type checker's budget and failed the build outright with
         * "unable to type-check this expression in reasonable time", which then
         * cascaded into key-path inference errors wherever `finished` was used.
         */
        var seenFinished = Set<String>()
        var finishedPool: [MediaItem] = catalogItems
        finishedPool += library
        finishedPool += watchlist
        finishedPool += store.recentMedia(for: activeProfile())

        let finishedUnsorted: [MediaItem] = finishedPool.filter { (item: MediaItem) -> Bool in
            guard let entry = progress[item.id], entry.isFinished || entry.completedAt != nil else { return false }
            return seenFinished.insert(item.id).inserted
        }

        // `updated` is non-optional on ProgressEntry; only a missing entry is "".
        func finishedStamp(_ item: MediaItem) -> String {
            guard let entry = progress[item.id] else { return "" }
            return entry.completedAt ?? entry.updated
        }

        let finished: [MediaItem] = finishedUnsorted.sorted { (left: MediaItem, right: MediaItem) -> Bool in
            finishedStamp(left) > finishedStamp(right)
        }
        let notebook = store.finishedNotebook(profileId: activeProfile(), items: finished)
        let adaptationGeneration = progress.values.reduce(0) { $0 + max($1.completions, $1.isFinished ? 1 : 0) }
        if adaptationGeneration > 0 {
            let watchedIds: Set<String> = Set(finished.map { (item: MediaItem) -> String in item.id })
            let genres: [String] = finished.flatMap { (item: MediaItem) -> [String] in item.genres }
            // Score once per item rather than re-filtering `genres` inside the
            // comparator: same ordering, but O(n log n) comparisons instead of
            // O(n log n × |genres|), and a far smaller job for the type checker.
            var affinity: [String: Int] = [:]
            for item in bundle.catalog where !watchedIds.contains(item.id) {
                let itemGenres = Set(item.genres)
                affinity[item.id] = genres.reduce(into: 0) { total, genre in
                    if itemGenres.contains(genre) { total += 1 }
                }
            }
            let unwatched: [MediaItem] = bundle.catalog.filter { (item: MediaItem) -> Bool in
                !watchedIds.contains(item.id)
            }
            let candidates: [MediaItem] = unwatched.sorted { (left: MediaItem, right: MediaItem) -> Bool in
                (affinity[left.id] ?? 0) > (affinity[right.id] ?? 0)
            }
            if !candidates.isEmpty {
                let offset = adaptationGeneration % candidates.count
                let adapted = Array((Array(candidates.dropFirst(offset)) + Array(candidates.prefix(offset))).prefix(16))
                rails.insert(CatalogRail(id: "anime-adapted", title: "Adapted for you", items: adapted), at: 0)
            }
        }
        let featured = continueWatching.first
            ?? rails.first { $0.id == "new-films" }?.items.first
            ?? rails.first { $0.id == "films" }?.items.first
            ?? catalogItems.first
            ?? library.first { TVMTitle.isDisplayTitle($0.title) }
            ?? library.first
        return [
            "rd": status.json(),
            "featured": JSONValue.orNull(featured?.json()),
            "library": library.prefix(400).map { $0.json() },
            "continueWatching": continueWatching.map { $0.json() },
            "watchlist": watchlist.map { $0.json() },
            "finished": notebook,
            "adaptationGeneration": adaptationGeneration,
            "fileCount": library.count,
            "rails": rails.map { $0.json() },
        ]
    }

    func library() async -> [MediaItem] {
        applyProgress((try? await loadLibrary()) ?? [], store.progress(for: activeProfile()))
    }

    func item(_ id: String) async -> MediaItem? {
        if let parsed = TVMTitle.parsePlayId(id), let meta = await catalog.meta(parsed.imdb) {
            if let season = parsed.season, let episode = parsed.episode {
                guard let episodeItem = meta.children.first(where: { $0.season == season && $0.episode == episode }) else { return nil }
                return remember(episodeItem)
            }
            return remember(meta.item)
        }
        let library = await self.library()
        if let found = library.first(where: { $0.id == id }) { return remember(found) }
        if let child = (try? await loadChildren(id))?.first(where: { $0.id == id }) { return remember(child) }
        if let cached = store.recentMedia(for: activeProfile()).first(where: { $0.id == id }) { return cached }
        if let fallback = catalog.fallbackItems().first(where: { $0.id == id }) { return remember(fallback) }
        return nil
    }

    func children(_ id: String) async -> [MediaItem] {
        if let parsed = TVMTitle.parsePlayId(id), let meta = await catalog.meta(parsed.imdb) {
            store.rememberMedia(meta.children, profileId: activeProfile())
            return meta.children
        }
        let items = (try? await loadChildren(id)) ?? []
        store.rememberMedia(items, profileId: activeProfile())
        return items
    }

    func search(_ query: String) async -> [MediaItem] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard needle.count >= 2 else { return [] }
        async let remote = catalog.search(needle)
        let local = ((try? await loadLibrary()) ?? []) + store.recentMedia(for: activeProfile())
        let localHits = local.filter {
            $0.title.localizedCaseInsensitiveContains(needle) || ($0.showTitle ?? "").localizedCaseInsensitiveContains(needle)
        }
        var seen = Set<String>()
        // Cinemeta already ranked the remote hits; do not drop aliases like "lotr".
        return (localHits + (await remote)).filter { seen.insert($0.id).inserted }
    }

    private func remember(_ item: MediaItem) -> MediaItem {
        var batch = [item]
        if let imdb = TVMTitle.catalogImdb(item.id), imdb != item.id {
            var aliased = item
            aliased.id = imdb
            batch.append(aliased)
        }
        store.rememberMedia(batch, profileId: activeProfile())
        return item
    }

    private func rememberPlayback(id: String?, title: String?, season: Int?, episode: Int?) {
        guard let id, !id.isEmpty else { return }
        let profile = activeProfile()
        if store.recentMedia(for: profile).contains(where: { $0.id == id }) { return }
        let name = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !name.isEmpty else { return }
        _ = remember(MediaItem(
            id: id,
            title: name,
            year: nil,
            kind: season != nil || episode != nil ? "series" : "movie",
            synopsis: "",
            poster: "",
            backdrop: "",
            genres: [],
            rating: "",
            runtime: nil,
            playable: true,
            progress: nil,
            filename: nil,
            hue: TVMTitle.hue(for: name),
            mimeType: nil,
            season: season,
            episode: episode,
            episodeName: nil,
            showTitle: season != nil ? name : nil,
            aired: nil,
            added: nil
        ))
    }

    func continueWatching(_ items: [MediaItem] = []) -> [MediaItem] {
        let progress = store.progress(for: activeProfile())
        return pickContinue(applyProgress(store.recentMedia(for: activeProfile()) + items, progress), progress)
    }

    func play(id: String?, link: String?, title: String?, season: Int?, episode: Int?) async -> (Int, [String: Any]) {
        guard plans.mobileAllowed() else { return (403, ["kind": "unavailable", "reason": "mobile-plan-required"]) }
        if plans.hoursBlocked(), let id, !id.hasPrefix("live:") {
            return (409, ["kind": "unavailable", "reason": "hours-cap"])
        }
        if let id, id.hasPrefix("live:") {
            return (409, ["kind": "unavailable", "reason": "unsupported"])
        }
        rememberPlayback(id: id, title: title, season: season, episode: episode)
        if let blocked = await probeAuth() { return (409, blocked) }
        if let link, !link.trimmingCharacters(in: .whitespaces).isEmpty {
            return await playFromLink(link, mediaId: id)
        }
        if let id, id.hasPrefix("rd:") {
            if let owned = await resolveOwnedLink(id) { return await playFromLink(owned, mediaId: id) }
            return (409, ["kind": "unavailable", "reason": "not-in-library"])
        }
        let wanted = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !wanted.isEmpty,
           let matched = await findLibraryPlayback(wanted, season: season, episode: episode),
           let owned = await resolveOwnedLink(matched) {
            return await playFromLink(owned, mediaId: id ?? matched)
        }
        if let imdb = await resolveImdb(id: id, title: title) {
            let parsed = id.flatMap { TVMTitle.parsePlayId($0) }
            let extra = id.flatMap { TVMTitle.seasonEpisode(from: $0) }
            return await playFromTorrentio(
                imdb,
                season: season ?? parsed?.season ?? extra?.season,
                episode: episode ?? parsed?.episode ?? extra?.episode,
                mediaId: id ?? imdb
            )
        }
        return (409, ["kind": "unavailable", "reason": "not-in-library"])
    }

    func appsList() -> [String: Any] {
        let tiles: [[String: Any]] = [
            ["id": "tvm-stream", "name": "TVM Stream", "accent": "#2f6bff", "wordmark": "TVM", "icon": "/apps/tvm.png", "url": "internal:library", "layout": "hub", "mock": false, "ribbon": true],
            ["id": "netflix", "name": "Netflix", "accent": "#e50914", "wordmark": "NETFLIX", "icon": "/apps/netflix.svg", "url": "https://www.netflix.com/", "layout": "netflix", "mock": true, "ribbon": true],
            ["id": "prime", "name": "Prime Video", "accent": "#00a8e1", "wordmark": "prime video", "icon": "/apps/marks/prime.svg", "url": "https://www.primevideo.com/", "layout": "prime", "mock": true, "ribbon": true],
            ["id": "max", "name": "HBO Max", "accent": "#002be7", "wordmark": "max", "icon": "/apps/marks/max.svg", "url": "https://www.max.com/", "layout": "max", "mock": true, "ribbon": true],
            ["id": "appletv", "name": "Apple TV", "accent": "#141414", "wordmark": "tv+", "icon": "/apps/marks/appletv.svg", "url": "https://tv.apple.com/", "layout": "appletv", "mock": true, "ribbon": true],
            ["id": "disney", "name": "Disney+", "accent": "#113c8c", "wordmark": "disney+", "icon": "/apps/marks/disney.svg", "url": "https://www.disneyplus.com/", "layout": "disney", "mock": true, "ribbon": true],
            ["id": "hulu", "name": "Hulu", "accent": "#1ce783", "wordmark": "hulu", "icon": "/apps/marks/hulu.svg", "url": "https://www.hulu.com/", "layout": "hulu", "mock": true, "ribbon": true],
            ["id": "peacock", "name": "Peacock", "accent": "#000000", "wordmark": "peacock", "icon": "/apps/marks/peacock.svg", "url": "https://www.peacocktv.com/", "layout": "peacock", "mock": true, "ribbon": true],
            ["id": "youtube", "name": "YouTube", "accent": "#ffffff", "wordmark": "YouTube", "icon": "/apps/youtube.svg", "url": "https://www.youtube.com/tv", "layout": "hub", "mock": false, "ribbon": false],
            ["id": "freevee", "name": "Freevee", "accent": "#111111", "wordmark": "freevee", "icon": "/apps/marks/freevee.svg", "url": "https://www.amazon.com/gp/video/storefront/freevee", "layout": "hub", "mock": false, "ribbon": false],
            ["id": "iplayer", "name": "BBC iPlayer", "accent": "#ff4d24", "wordmark": "iPlayer", "icon": "/apps/marks/iplayer.svg", "url": "https://www.bbc.co.uk/iplayer", "layout": "hub", "mock": false, "ribbon": false],
            ["id": "paramount", "name": "Paramount+", "accent": "#0062b4", "wordmark": "paramount+", "icon": "/apps/marks/paramount.svg", "url": "https://www.paramountplus.com/", "layout": "hub", "mock": false, "ribbon": false],
            ["id": "tubi", "name": "Tubi", "accent": "#fa382f", "wordmark": "tubi", "icon": "/apps/marks/tubi.svg", "url": "https://tubitv.com/", "layout": "hub", "mock": false, "ribbon": false],
            ["id": "pluto", "name": "Pluto TV", "accent": "#000000", "wordmark": "Pluto TV", "icon": "/apps/marks/pluto.svg", "url": "https://pluto.tv/", "layout": "hub", "mock": false, "ribbon": false],
            ["id": "starz", "name": "Starz", "accent": "#121212", "wordmark": "STARZ", "icon": "/apps/marks/starz.svg", "url": "https://www.starz.com/", "layout": "hub", "mock": false, "ribbon": false],
            ["id": "fox", "name": "Fox", "accent": "#000000", "wordmark": "FOX", "icon": "/apps/marks/fox.svg", "url": "https://www.fox.com/", "layout": "hub", "mock": false, "ribbon": false],
        ]
        return [
            "ribbon": tiles.filter { ($0["ribbon"] as? Bool) == true },
            "grid": tiles,
        ]
    }

    func appHub(_ id: String) async -> [String: Any]? {
        let list = (appsList()["grid"] as? [[String: Any]] ?? [])
        guard let spec = list.first(where: { $0["id"] as? String == id }), id != "tvm-stream" else { return nil }
        let bundle = await catalog.bundle()
        let movies = Array(bundle.moviesTop.prefix(16))
        let shows = Array(bundle.seriesTop.prefix(16))
        let seeds = hubSeeds[id] ?? []
        var seeded: [MediaItem] = []
        for seed in seeds.prefix(8) {
            if let meta = await catalog.meta(seed) { seeded.append(meta.item) }
        }
        let pool = seeded.isEmpty ? (movies + shows) : seeded + movies
        let hero = pool.first { !$0.backdrop.isEmpty } ?? pool.first
        return [
            "id": spec["id"] ?? id,
            "name": spec["name"] ?? id,
            "accent": spec["accent"] ?? "#2f6bff",
            "layout": spec["layout"] ?? "hub",
            "wordmark": spec["wordmark"] ?? spec["name"] ?? id,
            "logo": spec["icon"] ?? "",
            "disclaimer": "Not the licensed \(spec["name"] ?? id) app. Playback uses TVM Stream / Real-Debrid.",
            "hero": JSONValue.orNull(hero?.json()),
            "continueWatching": [],
            "rails": [
                CatalogRail(id: "\(id)-films", title: "Popular films", items: movies).json(),
                CatalogRail(id: "\(id)-shows", title: "Popular series", items: shows).json(),
                CatalogRail(id: "\(id)-trending", title: "Trending now", items: Array(pool.prefix(16))).json(),
            ],
        ]
    }

    func clearCache() {
        lock.lock()
        libraryCache = nil
        lock.unlock()
        catalog.clear()
        store.clearCacheFiles()
    }

    private let hubSeeds: [String: [String]] = [
        "netflix": ["tt4574334", "tt0903747", "tt1375666"],
        "prime": ["tt8111088", "tt1160419", "tt10872600"],
        "max": ["tt0944947", "tt0903747", "tt0468569"],
        "appletv": ["tt9737326", "tt10986410"],
        "disney": ["tt2527338", "tt1825683"],
        "hulu": ["tt4574334"],
        "peacock": ["tt8111088"],
    ]

    private func probeAuth() async -> [String: Any]? {
        if !rd.configured() { return ["kind": "unavailable", "reason": "not-configured"] }
        let status = await rd.status()
        if status.error == "needs-auth" { return ["kind": "unavailable", "reason": "needs-auth"] }
        if status.error == nil && !status.premium {
            return ["kind": "unavailable", "reason": "needs-auth"]
        }
        return nil
    }

    private func playFromLink(_ link: String, mediaId: String?) async -> (Int, [String: Any]) {
        do {
            let progress = mediaId.flatMap { store.progress(for: activeProfile())[$0] }
            let startAt = TVMTitle.progressRatio(progress).flatMap { _ in progress?.position }
            var playURL = link
            var filename = URL(string: link)?.lastPathComponent ?? "stream"
            var mime = "application/octet-stream"
            if rd.needsUnrestrict(link) {
                let unrestricted = try await rd.unrestrict(link: link)
                playURL = unrestricted.download
                filename = unrestricted.filename
                mime = unrestricted.mimeType ?? mime
            }
            if playURL.range(of: #"\.m3u8(\?|$)"#, options: .regularExpression) != nil {
                return streamReply(url: playURL, title: TVMTitle.parseFilename(filename).title, filename: filename, mime: "application/vnd.apple.mpegurl", transport: "hls", startAt: startAt)
            }
            if TVMPlayback.nativeCanOpen(playURL) {
                return streamReply(url: playURL, title: TVMTitle.parseFilename(filename).title, filename: filename, mime: mime, transport: "file", startAt: startAt)
            }
            return (409, ["kind": "unavailable", "reason": "unsupported"])
        } catch let error as RdClientError where error == .needsAuth || error == .notConfigured {
            return (409, ["kind": "unavailable", "reason": "needs-auth"])
        } catch {
            return (409, ["kind": "unavailable", "reason": "unsupported"])
        }
    }

    private func resolveImdb(id: String?, title: String?) async -> String? {
        if let id, let mapped = TVMTitle.catalogImdb(id) { return mapped }
        var queries: [String] = []
        if let title {
            let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.count >= 2 { queries.append(trimmed) }
        }
        if let id {
            let slug = id.split(separator: ":").first.map(String.init) ?? id
            if let found = await item(slug) { queries.append(found.title) }
        }
        var seen = Set<String>()
        for query in queries where seen.insert(query.lowercased()).inserted {
            let hits = await catalog.search(query)
            if let imdb = hits.compactMap({ TVMTitle.extractImdb($0.id) }).first {
                return imdb
            }
        }
        return nil
    }

    private func playFromTorrentio(_ imdb: String, season: Int?, episode: Int?, mediaId: String?) async -> (Int, [String: Any]) {
        guard let token = rd.tokenValue() else {
            return (409, ["kind": "unavailable", "reason": "not-configured"])
        }
        guard TVMTitle.extractImdb(imdb) != nil else {
            return (409, ["kind": "unavailable", "reason": "empty"])
        }
        var seasonNo = season
        var episodeNo = episode
        var catalogTitle: String?
        if seasonNo == nil || episodeNo == nil, let meta = await catalog.meta(imdb) {
            catalogTitle = meta.item.title
            if meta.item.kind == "series" {
                seasonNo = seasonNo ?? meta.children.first?.season
                episodeNo = episodeNo ?? meta.children.first?.episode
            }
        }
        let streams = await rd.torrentioStreams(token: token, imdb: imdb, season: seasonNo, episode: episodeNo)
        if streams.isEmpty {
            if let catalogTitle,
               let matched = await findLibraryPlayback(catalogTitle, season: seasonNo, episode: episodeNo),
               let owned = await resolveOwnedLink(matched) {
                return await playFromLink(owned, mediaId: matched)
            }
            return (409, ["kind": "unavailable", "reason": "empty"])
        }
        let height = TVMDeviceChrome.playbackHeight(planMax: plans.maxHeight())
        let capped = streams.filter { rd.streamHeight("\($0.name) \($0.title)") <= height }
        let ranked = Array((capped.isEmpty ? streams : capped).prefix(8))
        var last = ["kind": "unavailable", "reason": "empty"] as [String: Any]
        for stream in ranked {
            if !stream.url.isEmpty {
                let resolved = await rd.resolveRedirect(stream.url)
                if let resolved, !rd.isTorrentioHost(resolved) {
                    let result = await playFromLink(resolved, mediaId: mediaId ?? imdb)
                    if result.0 == 200 { return result }
                    last = result.1
                    if last["reason"] as? String == "needs-auth" { return result }
                }
            }
            if let hash = stream.infoHash, !hash.isEmpty {
                let magnet = await playFromMagnet(hash, mediaId: mediaId ?? imdb)
                if magnet.0 == 200 { return magnet }
                last = magnet.1
                if last["reason"] as? String == "needs-auth" { return magnet }
            }
        }
        if last["reason"] as? String == "empty",
           let catalogTitle,
           let matched = await findLibraryPlayback(catalogTitle, season: seasonNo, episode: episodeNo),
           let owned = await resolveOwnedLink(matched) {
            return await playFromLink(owned, mediaId: matched)
        }
        return (409, last)
    }

    private func playFromMagnet(_ hash: String, mediaId: String?) async -> (Int, [String: Any]) {
        do {
            let torrentId = try await rd.addMagnet(hash)
            try? await rd.selectTorrentFiles(torrentId)
            let links = try await rd.waitForTorrentLinks(torrentId)
            var last = ["kind": "unavailable", "reason": "empty"] as [String: Any]
            for link in links.prefix(6) {
                let result = await playFromLink(link, mediaId: mediaId)
                if result.0 == 200 { return result }
                last = result.1
                if last["reason"] as? String == "needs-auth" { return result }
            }
            return (409, last)
        } catch let error as RdClientError where error == .needsAuth || error == .notConfigured {
            return (409, ["kind": "unavailable", "reason": "needs-auth"])
        } catch {
            return (409, ["kind": "unavailable", "reason": "empty"])
        }
    }

    private func streamReply(url: String, title: String, filename: String, mime: String, transport: String, startAt: Double?) -> (Int, [String: Any]) {
        var body: [String: Any] = [
            "kind": "stream",
            "url": url,
            "title": title,
            "filename": filename,
            "mimeType": mime,
            "engine": "native",
            "transport": transport,
        ]
        if let startAt { body["startAt"] = startAt }
        return (200, body)
    }

    private func loadLibrary() async throws -> [MediaItem] {
        if !rd.configured() { return [] }
        lock.lock()
        if let libraryCache, Date().timeIntervalSince(libraryCache.at) < 45 {
            let items = libraryCache.items
            lock.unlock()
            return items
        }
        lock.unlock()
        let downloads: [RdDownload]
        let torrents: [RdTorrent]
        do {
            async let downloadTask = rd.downloads()
            async let torrentTask = rd.torrents()
            downloads = try await downloadTask
            torrents = try await torrentTask
        } catch {
            lock.lock()
            if let libraryCache {
                let items = libraryCache.items
                lock.unlock()
                return items
            }
            lock.unlock()
            throw error
        }
        var items: [MediaItem] = []
        for torrent in torrents {
            let ready = torrent.status == "downloaded" || torrent.progress == 100
            guard ready, !torrent.links.isEmpty,
                  var item = TVMTitle.itemFromName(id: "rd:t:\(torrent.id):0", filename: torrent.filename) else { continue }
            if TVMTitle.looksLikePack(title: item.title, filename: torrent.filename) || torrent.links.count > 1 {
                item.kind = "series"
                item.season = nil
                item.episode = nil
            }
            items.append(item)
        }
        for download in downloads {
            if let item = TVMTitle.itemFromName(id: "rd:d:\(download.id)", filename: download.filename, mimeType: download.mimeType) {
                items.append(item)
            }
        }
        lock.lock()
        libraryCache = (Date(), torrents, downloads, items)
        lock.unlock()
        return items
    }

    private func loadChildren(_ id: String) async throws -> [MediaItem] {
        guard id.hasPrefix("rd:t:") else { return [] }
        let torrentId = torrentIdFrom(id)
        let info = try await rd.torrentInfo(torrentId)
        let selected = info.files.filter { $0.selected == 1 }
        let progress = store.progress(for: activeProfile())
        return selected.enumerated().compactMap { index, file -> MediaItem? in
            let name = TVMTitle.fileName(from: file.path)
            guard var item = TVMTitle.itemFromName(
                id: "rd:t:\(torrentId):\(index)",
                filename: name,
                progress: TVMTitle.progressRatio(progress["rd:t:\(torrentId):\(index)"])
            ) else { return nil }
            if item.season == nil {
                let season = TVMTitle.parseSeason(name) ?? TVMTitle.parseSeason(info.filename)
                if season != nil || selected.count >= 2 {
                    let episode = item.episode ?? index + 1
                    item.kind = "series"
                    item.season = season ?? 1
                    item.episode = episode
                }
            }
            return item
        }
    }

    private func resolveOwnedLink(_ id: String) async -> String? {
        _ = try? await loadLibrary()
        lock.lock()
        let torrents = libraryCache?.torrents ?? []
        let downloads = libraryCache?.downloads ?? []
        lock.unlock()
        if id.hasPrefix("rd:t:") {
            let torrentId = torrentIdFrom(id)
            let index = torrentIndexFrom(id)
            if let info = try? await rd.torrentInfo(torrentId), index < info.links.count, !info.links[index].isEmpty {
                return info.links[index]
            }
            if let torrent = torrents.first(where: { $0.id == torrentId }), index < torrent.links.count {
                return torrent.links[index]
            }
            return nil
        }
        let downloadId = id.hasPrefix("rd:d:") ? String(id.dropFirst(5)) : String(id.dropFirst(3))
        return downloads.first { $0.id == downloadId }?.link
    }

    private func torrentIdFrom(_ id: String) -> String {
        let rest = String(id.dropFirst(5))
        if let cut = rest.lastIndex(of: ":"), rest[rest.index(after: cut)...].allSatisfy(\.isNumber) {
            return String(rest[..<cut])
        }
        return rest
    }

    private func torrentIndexFrom(_ id: String) -> Int {
        let rest = String(id.dropFirst(5))
        if let cut = rest.lastIndex(of: ":"), let value = Int(rest[rest.index(after: cut)...]) { return value }
        return 0
    }

    private func findLibraryPlayback(_ title: String, season: Int?, episode: Int?) async -> String? {
        let library = (try? await loadLibrary()) ?? []
        let matches = library.filter {
            TVMTitle.titlesMatch($0.title, title) || TVMTitle.titlesMatch($0.showTitle ?? "", title) || TVMTitle.titlesMatch($0.filename ?? "", title)
        }
        if let direct = matches.first(where: { !TVMTitle.looksLikePack(title: $0.title, filename: $0.filename ?? "") }) {
            return direct.id
        }
        for pack in matches.filter({ $0.id.hasPrefix("rd:t:") }).prefix(8) {
            if let kids = try? await loadChildren(pack.id),
               let picked = kids.first(where: { $0.season == season && $0.episode == episode }) ?? kids.first {
                return picked.id
            }
        }
        return matches.first?.id
    }

    private func applyProgress(_ items: [MediaItem], _ progress: [String: ProgressEntry]) -> [MediaItem] {
        items.map { item in
            var next = item
            next.progress = TVMTitle.progressRatio(progress[item.id])
            return next
        }
    }

    private func pickContinue(_ items: [MediaItem], _ progress: [String: ProgressEntry]) -> [MediaItem] {
        var seen = Set<String>()
        return items.filter { $0.progress != nil }
            .sorted { (progress[$0.id]?.updated ?? "") > (progress[$1.id]?.updated ?? "") }
            .filter { item in
                let key = TVMTitle.normalize(item.showTitle ?? item.title)
                return !key.isEmpty && seen.insert(key).inserted
            }
            .prefix(16)
            .map { $0 }
    }

    private func buildRails(bundle: CatalogBundle, watching: [MediaItem], watchlist: [MediaItem]) async -> [CatalogRail] {
        var used = Set(watching.map(\.id) + watching.map(\.title) + watchlist.map(\.id) + watchlist.map(\.title))
        var rails: [CatalogRail] = []
        func take(_ source: [MediaItem], id: String, title: String) {
            let items = source.filter { !used.contains($0.id) && !used.contains($0.title) }.prefix(16).map { $0 }
            items.forEach { used.insert($0.id); used.insert($0.title) }
            if !items.isEmpty { rails.append(CatalogRail(id: id, title: title, items: items)) }
        }
        take(bundle.catalog, id: "for-you", title: "You might like")
        take(bundle.moviesTop, id: "films", title: "Popular films")
        take(bundle.seriesTop, id: "series", title: "Popular series")
        take(bundle.newFilms, id: "new-films", title: "New films")
        take(bundle.recentTv, id: "new-series", title: "Recently updated")
        if let first = watching.first {
            let because = bundle.catalog.filter { item in
                !used.contains(item.id) && item.genres.contains(where: { first.genres.contains($0) })
            }.prefix(12).map { $0 }
            if !because.isEmpty {
                rails.append(CatalogRail(id: "because", title: "Because you watched \(first.title)", items: because))
            }
        }
        let genres: [(String, String)] = [
            ("horror", "Horror"), ("action", "Action"), ("comedy", "Comedy"),
            ("thriller", "Thriller"), ("scifi", "Sci-Fi"), ("romance", "Romance"),
        ]
        for (id, name) in genres {
            let movies = await catalog.genre(kind: "movie", name: name)
            let shows = await catalog.genre(kind: "series", name: name)
            var mixed: [MediaItem] = []
            var i = 0
            while mixed.count < 16, i < max(movies.count, shows.count) {
                if i < movies.count, !used.contains(movies[i].id) { mixed.append(movies[i]); used.insert(movies[i].id) }
                if mixed.count >= 16 { break }
                if i < shows.count, !used.contains(shows[i].id) { mixed.append(shows[i]); used.insert(shows[i].id) }
                i += 1
            }
            if !mixed.isEmpty { rails.append(CatalogRail(id: id, title: name, items: mixed)) }
        }
        if rails.isEmpty {
            take(catalog.fallbackItems(), id: "films", title: "Popular films")
        }
        return rails
    }
}
