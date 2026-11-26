import Foundation

final class TVMMedia {
    private let store: TVMStore
    private let catalog: TVMCatalog
    private let rd: TVMRealDebrid
    private let plans: TVMPlans
    private let content: TVMContent
    let pinGuard: TVMPinGuard
    private var libraryCache: (at: Date, torrents: [RdTorrent], downloads: [RdDownload], items: [MediaItem])?
    private let lock = NSLock()
    private let webhook: TVMWebhook

    func playbackEvent(_ event: PlaybackEventRecord) { webhook.send(scope: activeProfile(), event: event) }

    func playbackStarted(id: String?, payload: [String: Any]) {
        guard let id, TVMWebhook.isValidProgressId(id), payload["kind"] as? String == "stream" else { return }
        playbackEvent(PlaybackEventRecord(event: "play", id: id, title: payload["title"] as? String, position: nil, duration: nil))
    }

    func withPlaybackDetails(_ payload: [String: Any]) -> [String: Any] {
        guard payload["kind"] as? String == "stream", payload["isLive"] as? Bool != true else { return payload }
        var reply = payload
        let filename = payload["filename"] as? String ?? ""
        let stream = RdStream(url: payload["url"] as? String ?? "", title: filename, name: "", infoHash: nil, fileIdx: nil, quality: 0, cached: true, phoneHint: false, details: filename)
        let version = TVMVersions.describeVersion(stream, seconds: nil)
        if reply["version"] == nil { reply["version"] = version.json() }
        if reply["originalLanguage"] == nil { reply["originalLanguage"] = NSNull() }
        if reply["audioLanguages"] == nil { reply["audioLanguages"] = version.languages }
        return reply
    }

    private func directPlayback(_ result: (Int, [String: Any]), download: TVMDownloadPrefs?, client: PlaybackClient?, screenHeight: Int?, maxHeight: Int?) -> (Int, [String: Any]) {
        guard result.0 == 200, download == nil else { return result }
        let filename = result.1["filename"] as? String ?? "", url = result.1["url"] as? String ?? ""
        let stream = RdStream(url: url, title: filename, name: "", infoHash: nil, fileIdx: nil, quality: 0, cached: true, phoneHint: false, details: filename)
        let version = TVMVersions.describeVersion(stream, seconds: nil)
        let height = min(capFor(download: nil, screenHeight: screenHeight, maxHeight: maxHeight), TVMVersions.qualityCap(TVMPrefs.load(store).quality))
        guard (version.height ?? 1080) <= height,
              TVMVersions.supportsVersion(version, filename: filename, client: TVMVersions.phoneClient(client, maxHeight: height)),
              // The iPhone plays through VLC, so Matroska and other network containers are fine; AVPlayer's
              // narrower phoneCanPlay check would wrongly refuse them.
              TVMPlayback.nativeCanOpen(url) else {
            return (409, ["kind": "unavailable", "reason": "unsupported"])
        }
        return (200, withPlaybackDetails(result.1))
    }

    init(
        store: TVMStore,
        catalog: TVMCatalog,
        rd: TVMRealDebrid,
        plans: TVMPlans,
        content: TVMContent? = nil,
        pinGuard: TVMPinGuard = TVMPinGuard(),
        webhook: TVMWebhook? = nil
    ) {
        self.store = store
        self.webhook = webhook ?? TVMWebhook(readPrefs: { TVMPrefs.load(store) })
        self.catalog = catalog
        self.rd = rd
        self.plans = plans
        self.content = content ?? TVMContent(store: store, enableRefresh: false)
        self.pinGuard = pinGuard
    }

    func parentalLevels() -> [AgeLevel] {
        TVMParental.levels(content: content)
    }

    func ageLevel() -> Int {
        let registry = store.profiles()
        return registry.profiles.first(where: { $0.id == registry.activeId })?.maxAge ?? 18
    }

    func activeProfile() -> String { store.profiles().activeId }

    func applyProfileHeader(_ value: String?) {
        guard let value, !value.isEmpty else { return }
        let registry = store.profiles()
        guard value != registry.activeId,
              let target = registry.profiles.first(where: { $0.id == value }) else { return }
        if target.locked && !pinGuard.isUnlocked(target.id) { return }
        store.saveProfiles(activeId: value, profiles: registry.profiles)
    }

    func profilesJSON() -> [String: Any] {
        let registry = store.profiles()
        return ["activeId": registry.activeId, "profiles": registry.profiles.map { $0.json() }]
    }

    func createProfile(
        _ name: String,
        hue: Int? = nil,
        avatarRaw: Any? = nil,
        kindRaw: String? = nil,
        maxAgeRaw: Any? = nil,
        pinRaw: Any? = nil
    ) throws -> [String: Any] {
        var registry = store.profiles()
        if registry.profiles.count >= plans.profilesMax() {
            throw ClientError.message("TVM holds \(plans.profilesMax()) profiles.")
        }
        let kind: String
        switch kindRaw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" {
        case "", "standard": kind = "standard"
        case "kids": kind = "kids"
        default: throw ClientError.message("kind must be standard or kids")
        }
        let maxAge: Int
        if maxAgeRaw == nil || maxAgeRaw is NSNull {
            maxAge = TVMParental.defaultAge(kind: kind)
        } else if let valid = TVMParental.normalizeAge(maxAgeRaw, kind: kind) {
            maxAge = valid
        } else {
            throw ClientError.message("maxAge must be 7, 12, 15, or 18")
        }
        let avatar = try parseAvatarInput(avatarRaw)
        let pin = try parseOptionalNewPin(pinRaw)
        let trimmed = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
        let palette = Self.profileHues
        let profile = ProfileRecord(
            id: "profile-\(UUID().uuidString)",
            name: trimmed.isEmpty ? "Profile \(registry.profiles.count + 1)" : trimmed,
            hue: hue ?? palette[registry.profiles.count % palette.count],
            created: ISO8601DateFormatter().string(from: Date()),
            avatar: avatar,
            kind: kind,
            maxAge: maxAge,
            pin: pin
        )
        registry.profiles.append(profile)
        store.saveProfiles(activeId: profile.id, profiles: registry.profiles)
        pinGuard.markUnlocked(profile.id)
        return profilesJSON()
    }

    func updateProfile(_ body: [String: Any]) throws -> [String: Any] {
        guard let id = JSONValue.string(body["id"]) else {
            throw ClientError.message("id is required")
        }
        var registry = store.profiles()
        guard let idx = registry.profiles.firstIndex(where: { $0.id == id }) else {
            throw PinFailure(404, "not_found")
        }
        let existing = registry.profiles[idx]

        let nextName: String
        if let rawName = body["name"] {
            guard !(rawName is NSNull), let str = rawName as? String else {
                throw ClientError.message("name must be a non-empty string")
            }
            let trimmed = String(str.trimmingCharacters(in: .whitespacesAndNewlines).prefix(40))
            guard !trimmed.isEmpty else { throw ClientError.message("name must be a non-empty string") }
            nextName = trimmed
        } else {
            nextName = existing.name
        }

        let nextHue: Int
        if let rawHue = body["hue"], !(rawHue is NSNull) {
            guard let parsedHue = JSONValue.int(rawHue) else {
                throw ClientError.message("hue must be an integer")
            }
            nextHue = parsedHue
        } else {
            nextHue = existing.hue
        }

        let nextAvatar: String? = body.keys.contains("avatar") ? try parseAvatarInput(body["avatar"]) : existing.avatar

        let nextKind: String
        if let rawKind = body["kind"], !(rawKind is NSNull) {
            let trimmed = (rawKind as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed == "standard" || trimmed == "kids" else {
                throw ClientError.message("kind must be standard or kids")
            }
            nextKind = trimmed!
        } else {
            nextKind = existing.kind
        }

        let nextMaxAge: Int
        if let rawAge = body["maxAge"], !(rawAge is NSNull) {
            guard let validAge = TVMParental.normalizeAge(rawAge, kind: nextKind) else {
                throw ClientError.message("maxAge must be 7, 12, 15, or 18")
            }
            nextMaxAge = validAge
        } else if body["kind"] != nil && nextKind != existing.kind {
            nextMaxAge = TVMParental.defaultAge(kind: nextKind)
        } else {
            nextMaxAge = existing.maxAge
        }

        let currentPin = try extractPinCandidate(body, key: "currentPin")
        let pinChangeRequested = body.keys.contains("pin")
        let looseningKids = existing.kind == "kids" && (nextKind != "kids" || nextMaxAge > existing.maxAge)

        if existing.pin != nil && (pinChangeRequested || looseningKids) {
            try pinGuard.verify(profileId: existing.id, stored: existing.pin, candidate: currentPin)
        } else if looseningKids {
            let guardians = registry.profiles.filter { $0.id != existing.id && $0.kind == "standard" && $0.pin != nil }
            if !guardians.isEmpty {
                try pinGuard.verifyAny(guardians: guardians, candidate: currentPin)
            }
        }

        let nextPin: ProfilePin? = pinChangeRequested ? try parseOptionalNewPin(body["pin"]) : existing.pin

        var updated = existing
        updated.name = nextName
        updated.hue = nextHue
        updated.avatar = nextAvatar
        updated.kind = nextKind
        updated.maxAge = nextMaxAge
        updated.pin = nextPin
        registry.profiles[idx] = updated
        store.saveProfiles(activeId: registry.activeId, profiles: registry.profiles)
        if nextPin == nil || pinChangeRequested {
            pinGuard.markUnlocked(id)
        }
        return profilesJSON()
    }

    func renameProfile(id: String, name: String) -> [String: Any] {
        (try? updateProfile(["id": id, "name": name])) ?? profilesJSON()
    }

    func removeProfile(_ id: String, pin: String? = nil) throws -> [String: Any] {
        var registry = store.profiles()
        if registry.profiles.count <= 1 { throw ClientError.message("TVM needs at least one profile.") }
        guard let target = registry.profiles.first(where: { $0.id == id }) else {
            throw PinFailure(404, "not_found")
        }
        if let stored = target.pin {
            try pinGuard.verify(profileId: target.id, stored: stored, candidate: pin)
        }
        registry.profiles.removeAll { $0.id == id }
        let active = registry.activeId == id ? (registry.profiles.first?.id ?? id) : registry.activeId
        pinGuard.forget(id)
        store.removeProfileData(id)
        store.saveProfiles(activeId: active, profiles: registry.profiles)
        return profilesJSON()
    }

    func switchProfile(_ id: String, pin: String? = nil) throws -> [String: Any] {
        let registry = store.profiles()
        guard let target = registry.profiles.first(where: { $0.id == id }) else {
            throw PinFailure(404, "not_found")
        }
        if let stored = target.pin {
            try pinGuard.verify(profileId: target.id, stored: stored, candidate: pin)
            pinGuard.clearSessionUnlocks()
            pinGuard.markUnlocked(target.id)
        } else {
            pinGuard.clearSessionUnlocks()
        }
        store.saveProfiles(activeId: id, profiles: registry.profiles)
        return profilesJSON()
    }

    func verifyProfilePIN(id: String, pin: String?) throws -> [String: Any] {
        let registry = store.profiles()
        guard let target = registry.profiles.first(where: { $0.id == id }) else {
            throw PinFailure(404, "not_found")
        }
        if target.pin == nil {
            pinGuard.markUnlocked(target.id)
            return ["ok": true]
        }
        try pinGuard.verify(profileId: target.id, stored: target.pin, candidate: pin)
        return ["ok": true]
    }

    private func parseAvatarInput(_ raw: Any?) throws -> String? {
        if raw == nil || raw is NSNull { return nil }
        guard let str = raw as? String else { throw ClientError.message("avatar is invalid") }
        let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if trimmed.isEmpty { return nil }
        guard TVMPins.isValidAvatar(trimmed) else { throw ClientError.message("avatar is invalid") }
        return trimmed
    }

    private func parseOptionalNewPin(_ raw: Any?) throws -> ProfilePin? {
        if raw == nil || raw is NSNull { return nil }
        guard let str = raw as? String else { throw PinFailure(400, "pin-invalid") }
        let trimmed = str.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        return try TVMPins.makePin(trimmed)
    }

    private func extractPinCandidate(_ body: [String: Any], key: String) throws -> String? {
        guard body.keys.contains(key) else { return nil }
        guard let raw = body[key], !(raw is NSNull) else { return nil }
        guard let str = raw as? String else { throw PinFailure(400, "pin-invalid") }
        return str
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
        let previous = store.progress(for: profile)[id]
        store.writeProgress(profileId: profile, id: id, position: position, duration: duration)
        if position.isFinite, duration.isFinite, duration > 0, position / duration > 0.96, previous?.isFinished != true, TVMWebhook.isValidProgressId(id) {
            webhook.send(scope: profile, event: PlaybackEventRecord(event: "finish", id: id, title: nil, position: position, duration: duration))
        }
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
        let age = ageLevel()
        let levels = parentalLevels()
        let progress = store.progress(for: activeProfile())
        library = TVMParental.filterForLevel(applyProgress(library, progress), age, levels: levels)
        let bundle = await catalog.bundle()
        let catalogItems = TVMParental.filterForLevel(applyProgress(bundle.catalog, progress), age, levels: levels)
        let continueWatching = self.continueWatching(catalogItems + library)
        let watchlist = TVMParental.filterForLevel(self.watchlist(), age, levels: levels)
        var rails = await buildRails(bundle: bundle, watching: continueWatching, watchlist: watchlist, age: age, levels: levels)
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
            for item in catalogItems where !watchedIds.contains(item.id) {
                let itemGenres = Set(item.genres)
                affinity[item.id] = genres.reduce(into: 0) { total, genre in
                    if itemGenres.contains(genre) { total += 1 }
                }
            }
            let unwatched: [MediaItem] = catalogItems.filter { (item: MediaItem) -> Bool in
                !watchedIds.contains(item.id)
            }
            let candidates: [MediaItem] = unwatched.sorted { (left: MediaItem, right: MediaItem) -> Bool in
                (affinity[left.id] ?? 0) > (affinity[right.id] ?? 0)
            }
            if !candidates.isEmpty {
                let offset = adaptationGeneration % candidates.count
                let adapted = Array((Array(candidates.dropFirst(offset)) + Array(candidates.prefix(offset))).prefix(Self.railLimit))
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
        let remote = await catalog.search(needle)
        let local = ((try? await loadLibrary()) ?? []) + store.recentMedia(for: activeProfile())
        let localHits = local.filter {
            $0.title.localizedCaseInsensitiveContains(needle) || ($0.showTitle ?? "").localizedCaseInsensitiveContains(needle)
        }
        var seen = Set<String>()
        // Cinemeta already ranked the remote hits; do not drop aliases like "lotr".
        let combined = (localHits + remote).filter { seen.insert($0.id).inserted }
        return TVMParental.filterForLevel(combined, ageLevel(), levels: parentalLevels())
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

    /// The copy to download for `id`: its address and file name. A download
    /// takes a whole file (never a stream), in the asked-for audio language
    /// and no taller than asked (within the plan).
    func download(id: String, language: String, maxHeight: Int) async -> Result<(url: String, filename: String), Error> {
        let parsed = TVMTitle.parsePlayId(id)
        let result = await play(id: id, link: nil, title: nil, season: parsed?.season, episode: parsed?.episode,
                                download: TVMDownloadPrefs(language: language, maxHeight: maxHeight))
        if result.0 == 200, let url = result.1["url"] as? String, result.1["transport"] as? String != "hls" {
            return .success((url, result.1["filename"] as? String ?? "TVM video.mkv"))
        }
        let reason = result.1["reason"] as? String ?? ""
        let message: String
        switch reason {
        case "not-configured", "needs-auth": message = "Connect Real-Debrid in Settings to download."
        case "mobile-plan-required": message = "Your plan does not include this phone."
        case "hours-cap": message = "This month's viewing hours are used up."
        default: message = language == "original" ? "No downloadable copy was found." : "No copy in that language was found."
        }
        return .failure(NSError(domain: "TVMDownloads", code: 2, userInfo: [NSLocalizedDescriptionKey: message]))
    }

    /// Where playback of `id` stopped, for an offline copy to carry on from.
    func resumePosition(_ id: String) -> Double? {
        let progress = store.progress(for: activeProfile())[id]
        return TVMTitle.resumePosition(progress)
    }

    func versions(id: String, season: Int?, episode: Int?) async -> [String: Any] {
        guard let token = rd.tokenValue(), let imdb = await resolveImdb(id: id, title: nil) else { return ["originalLanguage": NSNull(), "versions": [Any]()] }
        let parsed = TVMTitle.parsePlayId(id), extra = TVMTitle.seasonEpisode(from: id)
        let meta = await catalog.meta(imdb)
        let s = season ?? parsed?.season ?? extra?.season ?? (meta?.item.kind == "series" ? meta?.children.first?.season : nil)
        let e = episode ?? parsed?.episode ?? extra?.episode ?? (meta?.item.kind == "series" ? meta?.children.first?.episode : nil)
        let streams = await rd.torrentioStreams(token: token, imdb: imdb, season: s, episode: e)
        let original = await catalog.originalLanguageFor(meta)
        let ranked = TVMVersions.rankForPhone(playableSources(streams, season: s, episode: e), prefs: TVMPrefs.load(store), originalLanguage: original,
                                              runtime: TVMVersions.runtimeSeconds(meta?.item.runtime), maxHeight: capFor(download: nil, screenHeight: nil, maxHeight: nil))
        return ["originalLanguage": JSONValue.orNull(original), "versions": ranked.map { $0.version.json() }]
    }

    private func playableSources(_ streams: [RdStream], season: Int?, episode: Int?) -> [RdStream] {
        streams.filter { TVMEpisodeMatch.fit(TVMEpisodeMatch.sourceFile($0.details.isEmpty ? $0.title : $0.details), season: season, episode: episode) != .wrong }
    }

    func play(
        id: String?,
        link: String?,
        title: String?,
        season: Int?,
        episode: Int?,
        download: TVMDownloadPrefs? = nil,
        screenHeight: Int? = nil,
        maxHeight: Int? = nil,
        versionId: String? = nil,
        client: PlaybackClient? = nil
    ) async -> (Int, [String: Any]) {
        guard plans.mobileAllowed() else { return (403, ["kind": "unavailable", "reason": "mobile-plan-required"]) }
        if plans.hoursBlocked(), let id, !id.hasPrefix("live:") {
            return (409, ["kind": "unavailable", "reason": "hours-cap"])
        }
        if let id, id.hasPrefix("live:") {
            return (409, ["kind": "unavailable", "reason": "unsupported"])
        }
        rememberPlayback(id: id, title: title, season: season, episode: episode)
        if let blocked = await probeAuth() { return (409, blocked) }
        if versionId == nil, let link, !link.trimmingCharacters(in: .whitespaces).isEmpty {
            return directPlayback(await playFromLink(link, mediaId: id), download: download, client: client, screenHeight: screenHeight, maxHeight: maxHeight)
        }
        if versionId == nil, let id, id.hasPrefix("rd:") {
            if let owned = await resolveOwnedLink(id) { return directPlayback(await playFromLink(owned, mediaId: id), download: download, client: client, screenHeight: screenHeight, maxHeight: maxHeight) }
            return (409, ["kind": "unavailable", "reason": "not-in-library"])
        }
        let wanted = title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var libraryCopy: (Int, [String: Any])? = nil
        if download != nil, versionId == nil, !wanted.isEmpty,
           let matched = await findLibraryPlayback(wanted, season: season, episode: episode),
           let owned = await resolveOwnedLink(matched) {
            let result = await playFromLink(owned, mediaId: id ?? matched)
            if result.0 == 200 && (download == nil || downloadable(result, download!)) {
                let filename = result.1["filename"] as? String ?? ""
                let cap = capFor(download: download, screenHeight: screenHeight, maxHeight: maxHeight)
                if filename.isEmpty || rd.streamHeight(filename) <= cap {
                    return result
                }
                libraryCopy = result
            }
        }
        if let imdb = await resolveImdb(id: id, title: title) {
            let parsed = id.flatMap { TVMTitle.parsePlayId($0) }
            let extra = id.flatMap { TVMTitle.seasonEpisode(from: $0) }
            let found = await playFromTorrentio(
                imdb,
                season: season ?? parsed?.season ?? extra?.season,
                episode: episode ?? parsed?.episode ?? extra?.episode,
                mediaId: id ?? imdb,
                download: download,
                screenHeight: screenHeight,
                maxHeight: maxHeight,
                versionId: versionId,
                client: client
            )
            if found.0 == 200 || libraryCopy == nil { return found }
        }
        if let libraryCopy { return libraryCopy }
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
        let age = ageLevel()
        let levels = parentalLevels()
        let bundle = await catalog.bundle()
        let movies = Array(TVMParental.filterForLevel(bundle.moviesTop, age, levels: levels).prefix(Self.railLimit))
        let shows = Array(TVMParental.filterForLevel(bundle.seriesTop, age, levels: levels).prefix(Self.railLimit))
        let seeds = hubSeeds[id] ?? []
        var seeded: [MediaItem] = []
        for seed in seeds.prefix(8) {
            if let meta = await catalog.meta(seed), TVMParental.allowedForLevel(meta.item, age, levels: levels) {
                seeded.append(meta.item)
            }
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
                CatalogRail(id: "\(id)-trending", title: "Trending now", items: Array(pool.prefix(Self.railLimit))).json(),
            ],
        ]
    }

    func railMore(id: String, skipParam: Int = 0, pageParam: Int? = nil) async throws -> [String: Any] {
        guard Self.isValidRailId(id) else {
            throw ClientError.message("rail id is invalid")
        }
        let sources = Self.railSources(id)
        if sources.isEmpty {
            return ["items": [], "more": false]
        }
        let age = ageLevel()
        let levels = parentalLevels()
        var cursor = min(max(0, pageParam ?? skipParam), 5000)
        var sawRaw = false
        var collected: [MediaItem] = []

        for _ in 0..<Self.maxPageAttempts {
            let perSourceCursor = min(max(0, cursor / sources.count), 5000)
            let perSourceLimit = sources.count > 1 ? max(10, Self.pageSize / sources.count) : Self.pageSize
            var perSource: [[MediaItem]] = []
            for src in sources {
                let fetched = await catalog.page(kind: src.kind, list: src.list, genre: src.genre, skip: perSourceCursor)
                if !fetched.isEmpty { sawRaw = true }
                perSource.append(Array(fetched.prefix(perSourceLimit)))
            }
            var batch = Self.interleave(perSource)
            if id == "new-films" {
                batch = Self.filterNewFilms(batch)
            }
            collected = TVMParental.filterForLevel(batch, age, levels: levels)
            cursor += Self.pageSize
            if !collected.isEmpty || !sawRaw || cursor > 5000 { break }
        }

        let withProgress = applyProgress(collected, store.progress(for: activeProfile()))
        let hasMore = sawRaw && cursor <= 5000 && !withProgress.isEmpty
        return [
            "items": withProgress.map { $0.json() },
            "more": hasMore,
            "page": cursor,
        ]
    }

    func activeEvents(today: String = TVMMedia.localIsoDate()) async -> [String: Any] {
        let doc = await content.fresh("events")
        let rawEvents = doc?["events"] as? [[String: Any]] ?? []
        let age = ageLevel()
        let levels = parentalLevels()
        let progress = store.progress(for: activeProfile())
        var out: [[String: Any]] = []

        for event in rawEvents {
            guard let start = JSONValue.string(event["start"]),
                  let end = JSONValue.string(event["end"]),
                  today >= start, today <= end,
                  let imdbId = JSONValue.string(event["imdbId"]) else { continue }

            let release = JSONValue.string(event["release"]) ?? start
            var spotlightRaw = await item(imdbId)
            if spotlightRaw == nil {
                spotlightRaw = await catalog.meta(imdbId)?.item
            }
            if let s = spotlightRaw, !TVMParental.allowedForLevel(s, age, levels: levels) {
                continue
            }
            let spotlight = spotlightRaw.flatMap { applyProgress([$0], progress).first }

            let railObj = event["rail"] as? [String: Any]
            let railIds = (railObj?["items"] as? [Any] ?? []).compactMap { JSONValue.string($0) }.prefix(Self.railLimit)
            var resolvedItems: [MediaItem] = []
            for rid in railIds {
                var resolved = await item(rid)
                if resolved == nil {
                    resolved = await catalog.meta(rid)?.item
                }
                if let resolved, TVMParental.allowedForLevel(resolved, age, levels: levels) {
                    resolvedItems.append(resolved)
                }
            }
            let itemsWithProgress = applyProgress(resolvedItems, progress)

            var enriched = event
            enriched["live"] = true
            enriched["released"] = today >= release
            enriched["kicker"] = Self.eventKicker(release: release, today: today)
            enriched["spotlight"] = JSONValue.orNull(spotlight?.json())
            enriched["featured"] = JSONValue.orNull(spotlight?.json())
            enriched["items"] = itemsWithProgress.map { $0.json() }
            out.append(enriched)
        }
        return ["events": out]
    }

    func servicesJSON() async -> [String: Any] {
        let doc = await content.fresh("services")
        let raw = doc?["services"] as? [[String: Any]] ?? []
        let connected = Set(store.connectedServices(for: activeProfile()))
        var out: [[String: Any]] = []
        for row in raw {
            guard let id = JSONValue.string(row["id"]) else { continue }
            var copy = row
            copy["connected"] = connected.contains(id)
            out.append(copy)
        }
        return ["services": out]
    }

    func setServiceConnected(id: String, connected: Bool) async throws -> [String: Any] {
        let doc = await content.fresh("services")
        let raw = doc?["services"] as? [[String: Any]] ?? []
        let validIds = Set(raw.compactMap { JSONValue.string($0["id"]) })
        guard validIds.contains(id) else {
            throw ClientError.message("Unknown service.")
        }
        let profileId = activeProfile()
        var current = store.connectedServices(for: profileId)
        if connected {
            if !current.contains(id) { current.append(id) }
        } else {
            current.removeAll { $0 == id }
        }
        store.saveConnectedServices(current, profileId: profileId)
        return ["connected": current]
    }

    func freeLiveJSON() async -> [String: Any] {
        let doc = await content.fresh("free-channels")
        let raw = doc?["channels"] as? [[String: Any]] ?? []
        let age = ageLevel()
        let levels = parentalLevels()
        let filtered = raw.filter { row in
            TVMParental.liveGroupAllowed(JSONValue.string(row["group"]), maxAge: age, levels: levels)
        }
        return ["channels": filtered]
    }

    func clearCache() {
        lock.lock()
        libraryCache = nil
        lock.unlock()
        catalog.clear()
        store.clearCacheFiles()
    }

    /// A different Real-Debrid key is in use; its library is not this one.
    func forgetLibrary() {
        lock.lock()
        libraryCache = nil
        lock.unlock()
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
            let startAt = TVMTitle.resumePosition(progress)
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

    /// A library copy may be downloaded: its language and size fit what was asked.
    private func downloadable(_ result: (Int, [String: Any]), _ download: TVMDownloadPrefs) -> Bool {
        guard result.0 == 200, result.1["transport"] as? String != "hls" else { return false }
        let name = result.1["filename"] as? String ?? ""
        return TVMLanguage.ok(name, language: download.language) && rd.streamHeight(name) <= min(download.maxHeight, plans.maxHeight())
    }

    private func capFor(download: TVMDownloadPrefs?, screenHeight: Int?, maxHeight: Int?) -> Int {
        if let download {
            return min(download.maxHeight, plans.maxHeight())
        }
        return min(
            TVMDeviceChrome.playbackHeight(planMax: plans.maxHeight()),
            Self.screenCapFor(screenHeight: screenHeight, maxHeight: maxHeight)
        )
    }

    private func playFromTorrentio(
        _ imdb: String,
        season: Int?,
        episode: Int?,
        mediaId: String?,
        download: TVMDownloadPrefs? = nil,
        screenHeight: Int? = nil,
        maxHeight: Int? = nil,
        versionId: String? = nil,
        client: PlaybackClient? = nil
    ) async -> (Int, [String: Any]) {
        guard let token = rd.tokenValue() else {
            return (409, ["kind": "unavailable", "reason": "not-configured"])
        }
        guard TVMTitle.extractImdb(imdb) != nil else {
            return (409, ["kind": "unavailable", "reason": "empty"])
        }
        var seasonNo = season
        var episodeNo = episode
        let metadata = await catalog.meta(imdb)
        let catalogTitle = metadata?.item.title
        if seasonNo == nil || episodeNo == nil, let meta = metadata {
            if meta.item.kind == "series" {
                seasonNo = seasonNo ?? meta.children.first?.season
                episodeNo = episodeNo ?? meta.children.first?.episode
            }
        }
        let streams = await rd.torrentioStreams(token: token, imdb: imdb, season: seasonNo, episode: episodeNo)
        if streams.isEmpty {
            if download != nil, versionId == nil, let catalogTitle,
               let matched = await findLibraryPlayback(catalogTitle, season: seasonNo, episode: episodeNo),
               let owned = await resolveOwnedLink(matched) {
                return await playFromLink(owned, mediaId: matched)
            }
            return (409, ["kind": "unavailable", "reason": "empty"])
        }
        // A download takes the quality asked for (within the plan); playing takes this screen's.
        let height = capFor(download: download, screenHeight: screenHeight, maxHeight: maxHeight)
        // A source whose file is named as another episode, or as a commentary
        // edition or other extra, is not this episode (TVMEpisodeMatch). A
        // download's audio language is a must.
        let proper = playableSources(streams, season: seasonNo, episode: episodeNo).filter {
            download == nil || TVMLanguage.ok("\($0.name) \($0.title) \($0.details)", language: download!.language)
        }
        if proper.isEmpty { return (409, ["kind": "unavailable", "reason": "empty"]) }
        let prefs = TVMPrefs.load(store)
        let original = await catalog.originalLanguageFor(metadata)
        let runtime = TVMVersions.runtimeSeconds(metadata?.item.runtime)
        let ranked: [RankedVersion]
        if download == nil {
            ranked = Array(TVMVersions.rankForPhone(proper, prefs: prefs, originalLanguage: original, runtime: runtime, maxHeight: height, client: client)
                .filter { versionId == nil || $0.version.id == versionId }.prefix(8))
        } else {
            ranked = proper.filter { rd.streamHeight("\($0.name) \($0.title)") <= height }.prefix(8).map { RankedVersion(stream: $0, version: TVMVersions.describeVersion($0, seconds: runtime)) }
        }
        func selected(_ result: (Int, [String: Any]), _ row: RankedVersion) -> (Int, [String: Any]) {
            var payload = result.1
            payload["version"] = row.version.json()
            payload["originalLanguage"] = JSONValue.orNull(original)
            payload["audioLanguages"] = row.version.languages
            return (result.0, payload)
        }
        func safeFile(_ result: (Int, [String: Any])) -> Bool {
            let filename = result.1["filename"] as? String ?? ""
            let url = result.1["url"] as? String ?? ""
            let stream = RdStream(url: url, title: filename, name: "", infoHash: nil, fileIdx: nil, quality: 0, cached: true, phoneHint: false, details: filename)
            let version = TVMVersions.describeVersion(stream, seconds: runtime)
            return (version.height ?? 1080) <= min(height, client?.maxHeight ?? height, TVMVersions.qualityCap(prefs.quality)) &&
                TVMPlayback.phoneCanPlay(filename: filename, mimeType: result.1["mimeType"] as? String, url: url) &&
                TVMVersions.supportsVersion(version, filename: filename, client: TVMVersions.phoneClient(client, maxHeight: height))
        }
        var last = ["kind": "unavailable", "reason": "empty"] as [String: Any]
        for row in ranked {
            let stream = row.stream
            if !stream.url.isEmpty {
                let resolved = await rd.resolveRedirect(stream.url)
                if let resolved, !rd.isTorrentioHost(resolved) {
                    let result = await playFromLink(resolved, mediaId: mediaId ?? imdb)
                    if result.0 == 200 && !rightFile(result, season: seasonNo, episode: episodeNo) { continue }
                    if result.0 == 200, download != nil, result.1["transport"] as? String == "hls" { continue }
                    if result.0 == 200 && (download == nil ? !safeFile(result) : !downloadable(result, download!)) { continue }
                    if result.0 == 200 { return selected(result, row) }
                    last = result.1
                    if last["reason"] as? String == "needs-auth" { return result }
                }
            }
            if let hash = stream.infoHash, !hash.isEmpty {
                let magnet = await playFromMagnet(hash, mediaId: mediaId ?? imdb, season: seasonNo, episode: episodeNo, fileIdx: stream.fileIdx)
                if magnet.0 == 200 && (download == nil ? !safeFile(magnet) : !downloadable(magnet, download!)) { continue }
                if magnet.0 == 200 { return selected(magnet, row) }
                last = magnet.1
                if last["reason"] as? String == "needs-auth" { return magnet }
            }
        }
        if download != nil, versionId == nil, last["reason"] as? String == "empty",
           let catalogTitle,
           let matched = await findLibraryPlayback(catalogTitle, season: seasonNo, episode: episodeNo),
           let owned = await resolveOwnedLink(matched) {
            return await playFromLink(owned, mediaId: matched)
        }
        return (409, last)
    }

    /// One file of a torrent: the episode (or film) asked for, never the whole
    /// torrent and its first file (TVMEpisodeMatch). A torrent with no file
    /// that fits is removed again, so it does not linger in the library.
    private func playFromMagnet(_ hash: String, mediaId: String?, season: Int?, episode: Int?, fileIdx: Int?) async -> (Int, [String: Any]) {
        var added: String?
        do {
            let torrentId = try await rd.addMagnet(hash)
            added = torrentId
            var info = try await rd.torrentInfo(torrentId)
            // A new magnet lists its files once Real-Debrid has read it.
            for _ in 0..<6 where info.files.isEmpty {
                try await Task.sleep(nanoseconds: 500_000_000)
                info = try await rd.torrentInfo(torrentId)
            }
            guard let picked = TVMEpisodeMatch.pickFile(info.files.map { TVMEpisodeMatch.File(id: $0.id, path: $0.path, bytes: $0.bytes) },
                                                       season: season, episode: episode, fileIdx: fileIdx) else {
                try? await rd.deleteTorrent(torrentId)
                return (409, ["kind": "unavailable", "reason": "empty"])
            }
            try? await rd.selectTorrentFiles(torrentId, files: String(picked.id))
            let links = try await rd.waitForTorrentLinks(torrentId, files: String(picked.id))
            var last = ["kind": "unavailable", "reason": "empty"] as [String: Any]
            for link in links.prefix(6) {
                let result = await playFromLink(link, mediaId: mediaId)
                if result.0 == 200 && !rightFile(result, season: season, episode: episode) { continue }
                if result.0 == 200 { return result }
                last = result.1
                if last["reason"] as? String == "needs-auth" { return result }
            }
            return (409, last)
        } catch let error as RdClientError where error == .needsAuth || error == .notConfigured {
            return (409, ["kind": "unavailable", "reason": "needs-auth"])
        } catch {
            if let added { try? await rd.deleteTorrent(added) }
            return (409, ["kind": "unavailable", "reason": "empty"])
        }
    }

    /// The file found is not another episode or an extra (TVMEpisodeMatch).
    private func rightFile(_ result: (Int, [String: Any]), season: Int?, episode: Int?) -> Bool {
        let name = result.1["filename"] as? String ?? ""
        return TVMEpisodeMatch.fit(name, season: season, episode: episode) != .wrong
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
            // Avoid nested async-let stack teardown crashes on the Xcode 16
            // concurrency runtime. Each request still uses async URLSession.
            downloads = try await rd.downloads()
            torrents = try await rd.torrents()
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

    /// A copy of this title already in the person's library: for an episode,
    /// only a file numbered as that very episode; for a film, one that is not
    /// an episode or an extra. Any title match used to do, and a pack fell
    /// back to its first file, so every episode played S01E01 (TVMEpisodeMatch).
    private func findLibraryPlayback(_ title: String, season: Int?, episode: Int?) async -> String? {
        let library = (try? await loadLibrary()) ?? []
        let matches = library.filter {
            TVMTitle.titlesMatch($0.title, title) || TVMTitle.titlesMatch($0.showTitle ?? "", title) || TVMTitle.titlesMatch($0.filename ?? "", title)
        }
        func fits(_ item: MediaItem) -> Bool {
            let name = (item.filename?.isEmpty == false ? item.filename : nil) ?? item.title
            if let season, let episode, let s = item.season, let e = item.episode {
                return s == season && e == episode && !TVMEpisodeMatch.isExtra(name)
            }
            let fit = TVMEpisodeMatch.fit(name, season: season, episode: episode)
            return (season != nil && episode != nil) ? fit == .match : fit != .wrong
        }
        if let direct = matches.first(where: { !TVMTitle.looksLikePack(title: $0.title, filename: $0.filename ?? "") && fits($0) }) {
            return direct.id
        }
        guard season != nil, episode != nil else { return nil }
        for pack in matches.filter({ $0.id.hasPrefix("rd:t:") }).prefix(8) {
            if let kids = try? await loadChildren(pack.id), let picked = kids.first(where: fits) {
                return picked.id
            }
        }
        return nil
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

    private func buildRails(
        bundle: CatalogBundle,
        watching: [MediaItem],
        watchlist: [MediaItem],
        age: Int,
        levels: [AgeLevel]
    ) async -> [CatalogRail] {
        var used = Set(watching.map(\.id) + watching.map(\.title) + watchlist.map(\.id) + watchlist.map(\.title))
        var rails: [CatalogRail] = []
        func take(_ source: [MediaItem], id: String, title: String) {
            let items = source.filter {
                !used.contains($0.id) &&
                    !used.contains($0.title) &&
                    TVMParental.allowedForLevel($0, age, levels: levels)
            }.prefix(Self.railLimit).map { $0 }
            items.forEach { used.insert($0.id); used.insert($0.title) }
            if !items.isEmpty {
                let more: Bool? = Self.railSources(id).isEmpty ? nil : true
                rails.append(CatalogRail(id: id, title: title, items: items, more: more))
            }
        }
        take(bundle.catalog, id: "for-you", title: "You might like")
        take(bundle.moviesTop, id: "films", title: "Popular films")
        take(bundle.seriesTop, id: "series", title: "Popular series")
        take(bundle.moviesRated, id: "top-films", title: "Top rated films")
        take(bundle.seriesRated, id: "top-series", title: "Top rated series")
        take(bundle.newFilms, id: "new-films", title: "New films")
        take(bundle.recentTv, id: "new-series", title: "Recently updated")
        if let first = watching.first {
            let because = bundle.catalog.filter { item in
                !used.contains(item.id) &&
                    item.genres.contains(where: { first.genres.contains($0) }) &&
                    TVMParental.allowedForLevel(item, age, levels: levels)
            }.prefix(Self.railLimit).map { $0 }
            if !because.isEmpty {
                rails.append(CatalogRail(id: "because", title: "Because you watched \(first.title)", items: because))
            }
        }
        for entry in Self.genreRails {
            var seenMovies = Set<String>()
            var movies: [MediaItem] = []
            for g in entry.names {
                for item in await catalog.genre(kind: "movie", name: g)
                where TVMParental.allowedForLevel(item, age, levels: levels) && seenMovies.insert(item.id).inserted {
                    movies.append(item)
                }
            }
            let seriesNames = entry.id == "anime" ? ["Animation"] : entry.names
            var seenShows = Set<String>()
            var shows: [MediaItem] = []
            for g in seriesNames {
                for item in await catalog.genre(kind: "series", name: g)
                where TVMParental.allowedForLevel(item, age, levels: levels) && seenShows.insert(item.id).inserted {
                    shows.append(item)
                }
            }
            var mixed: [MediaItem] = []
            var i = 0
            while mixed.count < Self.railLimit, i < max(movies.count, shows.count) {
                if i < movies.count, !used.contains(movies[i].id) { mixed.append(movies[i]); used.insert(movies[i].id) }
                if mixed.count >= Self.railLimit { break }
                if i < shows.count, !used.contains(shows[i].id) { mixed.append(shows[i]); used.insert(shows[i].id) }
                i += 1
            }
            if !mixed.isEmpty { rails.append(CatalogRail(id: entry.id, title: entry.title, items: mixed, more: true)) }
        }
        if rails.isEmpty {
            take(catalog.fallbackItems(), id: "films", title: "Popular films")
        }
        return rails
    }

    struct RailSource: Equatable {
        let kind: String
        let list: String
        let genre: String?
        init(_ kind: String, _ list: String, _ genre: String? = nil) {
            self.kind = kind
            self.list = list
            self.genre = genre
        }
    }

    static let profileHues: [Int] = [221, 190, 145, 38, 315]
    static let railLimit = 40
    static let pageSize = 50
    static let maxPageAttempts = 3
    static let qualityLadder: [Int] = [480, 720, 1080, 1440, 2160]

    static let genreRails: [(id: String, title: String, names: [String])] = [
        ("action", "Action & Adventure", ["Action", "Adventure"]),
        ("scifi", "Sci-Fi & Fantasy", ["Sci-Fi", "Fantasy"]),
        ("comedy", "Comedy", ["Comedy"]),
        ("thriller", "Thrillers", ["Thriller"]),
        ("drama", "Critically Acclaimed Drama", ["Drama"]),
        ("crime", "Crime & Mystery", ["Crime", "Mystery"]),
        ("horror", "Horror", ["Horror"]),
        ("animation", "Animation & Family", ["Animation", "Family"]),
        ("romance", "Romance", ["Romance"]),
        ("documentary", "Documentaries", ["Documentary"]),
        ("anime", "Anime", ["Anime"]),
        ("history", "History & Biography", ["History", "Biography"]),
        ("mystery", "Mystery & Suspense", ["Mystery"]),
    ]

    private static let extraGenreAliases: [String: [String]] = [
        "sci-fi": ["Sci-Fi", "Fantasy"],
        "adventure": ["Adventure"],
        "fantasy": ["Fantasy"],
        "family": ["Family"],
    ]

    static func isValidRailId(_ id: String) -> Bool {
        id.range(of: #"^[a-z0-9-]{1,40}$"#, options: .regularExpression) != nil
    }

    static func railSources(_ id: String) -> [RailSource] {
        switch id {
        case "films": return [RailSource("movie", "top")]
        case "series": return [RailSource("series", "top")]
        case "top-films": return [RailSource("movie", "imdbRating")]
        case "top-series": return [RailSource("series", "imdbRating")]
        case "new-films": return [RailSource("movie", "year")]
        case "new-series": return [RailSource("series", "last-videos")]
        default:
            let names = genreRails.first(where: { $0.id == id })?.names ?? extraGenreAliases[id]
            guard let names else { return [] }
            let seriesNames = id == "anime" ? ["Animation"] : names
            return names.map { RailSource("movie", "top", $0) } +
                seriesNames.map { RailSource("series", "top", $0) }
        }
    }

    static func interleave(_ lists: [[MediaItem]]) -> [MediaItem] {
        var out: [MediaItem] = []
        var seen = Set<String>()
        let maxCount = lists.map(\.count).max() ?? 0
        for i in 0..<maxCount {
            for list in lists where i < list.count {
                let item = list[i]
                if seen.insert(item.id).inserted { out.append(item) }
            }
        }
        return out
    }

    static func filterNewFilms(_ items: [MediaItem], currentYear: Int = Calendar.current.component(.year, from: Date())) -> [MediaItem] {
        items.filter { $0.kind == "movie" && ($0.year ?? 0) >= currentYear - 1 }
    }

    static func screenCapFor(screenHeight: Int?, maxHeight: Int?) -> Int {
        if let maxHeight, maxHeight >= 240 { return min(2160, maxHeight) }
        if let screenHeight, screenHeight >= 240 {
            return qualityLadder.first(where: { $0 >= screenHeight - 8 }) ?? 2160
        }
        return 2160
    }

    static func localIsoDate(_ date: Date = Date()) -> String {
        let cal = Calendar(identifier: .gregorian)
        let comps = cal.dateComponents([.year, .month, .day], from: date)
        let y = comps.year ?? 1970
        let m = comps.month ?? 1
        let d = comps.day ?? 1
        return String(format: "%04d-%02d-%02d", y, m, d)
    }

    static func formatReleaseDayMonth(_ isoDate: String) -> String {
        let trimmed = isoDate.trimmingCharacters(in: .whitespacesAndNewlines)
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.dateFormat = "yyyy-MM-dd"
        guard let parsed = parser.date(from: trimmed) else { return isoDate }
        let monthFmt = DateFormatter()
        monthFmt.locale = Locale(identifier: "en_US")
        monthFmt.dateFormat = "d MMMM"
        return monthFmt.string(from: parsed)
    }

    static func eventKicker(release: String, today: String = TVMMedia.localIsoDate()) -> String {
        if today >= release { return "In cinemas now" }
        return "In cinemas \(formatReleaseDayMonth(release))"
    }
}
