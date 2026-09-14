import Foundation

struct CatalogBundle {
    var moviesTop: [MediaItem]
    var seriesTop: [MediaItem]
    var moviesRated: [MediaItem]
    var seriesRated: [MediaItem]
    var recentTv: [MediaItem]
    var newFilms: [MediaItem]
    var catalog: [MediaItem]
}

struct TitleMeta {
    var item: MediaItem
    var children: [MediaItem]
}

final class TVMCatalog {
    private let store: TVMStore
    private let session: URLSession
    private var memory: (at: Date, data: CatalogBundle)?
    private var genreMem: [String: (at: Date, items: [MediaItem])] = [:]
    private var metaMem: [String: (at: Date, data: TitleMeta)] = [:]
    private let fallback: [MediaItem]
    private let lock = NSLock()

    init(store: TVMStore, session: URLSession) {
        self.store = store
        self.session = session
        if let url = Bundle.main.url(forResource: "FallbackCatalog", withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let items = object["items"] as? [Any] {
            fallback = items.compactMap(MediaItem.parse)
        } else {
            fallback = []
        }
    }

    func fallbackItems() -> [MediaItem] { fallback }

    func clear() {
        lock.lock()
        memory = nil
        genreMem.removeAll()
        metaMem.removeAll()
        lock.unlock()
        store.clearCacheFiles()
    }

    func bundle() async -> CatalogBundle {
        lock.lock()
        if let memory, Date().timeIntervalSince(memory.at) < 12 * 60 {
            let data = memory.data
            lock.unlock()
            return data
        }
        lock.unlock()
        do {
            async let moviesTopTask = fetchCatalog("/catalog/movie/top.json", kind: "movie")
            async let seriesTopTask = fetchCatalog("/catalog/series/top.json", kind: "series")
            async let moviesRatedTask = fetchCatalog("/catalog/movie/imdbRating.json", kind: "movie")
            async let seriesRatedTask = fetchCatalog("/catalog/series/imdbRating.json", kind: "series")
            async let recentTvTask = fetchCatalog("/catalog/series/last-videos.json", kind: "series")
            async let moviesSkipTask = fetchCatalog("/catalog/movie/top/skip=100.json", kind: "movie")
            let moviesTop = await moviesTopTask
            let seriesTop = await seriesTopTask
            let moviesRated = await moviesRatedTask
            let seriesRated = await seriesRatedTask
            let recentTv = await recentTvTask
            let moviesSkip = await moviesSkipTask
            let movies = dedupe(moviesTop + moviesSkip)
            let data = CatalogBundle(
                moviesTop: moviesTop,
                seriesTop: seriesTop,
                moviesRated: moviesRated,
                seriesRated: seriesRated,
                recentTv: recentTv,
                newFilms: movies.filter { $0.kind == "movie" && ($0.year ?? 0) >= Calendar.current.component(.year, from: Date()) - 1 },
                catalog: dedupe(movies + seriesTop + moviesRated + seriesRated + recentTv)
            )
            if !data.catalog.isEmpty {
                lock.lock()
                memory = (Date(), data)
                lock.unlock()
                store.writeJSON("catalog-cache.json", encode(data))
                return data
            }
        } catch {
            // Use disk or bundled titles so Home still renders.
        }
        if let disk = readDisk() { return disk }
        return fallbackBundle()
    }

    func search(_ query: String) async -> [MediaItem] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if needle.count < 2 { return [] }
        let encoded = needle.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? needle
        async let movies = fetchCatalog("/catalog/movie/top/search=\(encoded).json", kind: "movie")
        async let series = fetchCatalog("/catalog/series/top/search=\(encoded).json", kind: "series")
        let live = dedupe(await movies + series)
        if !live.isEmpty { return live }
        let lower = needle.lowercased()
        return fallback.filter {
            $0.title.lowercased().contains(lower) || ($0.showTitle ?? "").lowercased().contains(lower)
        }
    }

    func genre(kind: String, name: String) async -> [MediaItem] {
        let key = "\(kind):\(name)"
        lock.lock()
        if let hit = genreMem[key], Date().timeIntervalSince(hit.at) < 20 * 60 {
            let items = hit.items
            lock.unlock()
            return items
        }
        lock.unlock()
        let encoded = name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name
        let items = await fetchCatalog("/catalog/\(kind)/top/genre=\(encoded).json", kind: kind)
        lock.lock()
        genreMem[key] = (Date(), items)
        lock.unlock()
        return items
    }

    func meta(_ id: String) async -> TitleMeta? {
        guard let imdb = TVMTitle.extractImdb(id) else {
            return fallback.first { $0.id == id }.map { TitleMeta(item: $0, children: []) }
        }
        lock.lock()
        if let hit = metaMem[imdb], Date().timeIntervalSince(hit.at) < 30 * 60 {
            let data = hit.data
            lock.unlock()
            return data
        }
        lock.unlock()
        async let movie = readKind("movie", imdb: imdb)
        async let series = readKind("series", imdb: imdb)
        let picked = (await series) ?? (await movie)
        if let picked {
            lock.lock()
            metaMem[imdb] = (Date(), picked)
            lock.unlock()
        }
        return picked
    }

    private func readKind(_ kind: String, imdb: String) async -> TitleMeta? {
        guard let url = URL(string: "https://v3-cinemeta.strem.io/meta/\(kind)/\(imdb).json") else { return nil }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let raw = body["meta"] as? [String: Any],
                  let item = mapMeta(raw, kind: kind) else { return nil }
            let children = kind == "series" ? mapVideos(show: item, videos: raw["videos"]) : []
            return TitleMeta(item: item, children: children)
        } catch {
            return nil
        }
    }

    private func fetchCatalog(_ path: String, kind: String) async -> [MediaItem] {
        guard let url = URL(string: "https://v3-cinemeta.strem.io\(path)") else { return [] }
        var request = URLRequest(url: url)
        request.timeoutInterval = 12
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let body = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let metas = body["metas"] as? [[String: Any]] else { return [] }
            return metas.compactMap { mapMeta($0, kind: kind) }
        } catch {
            return []
        }
    }

    private func mapMeta(_ raw: [String: Any], kind: String) -> MediaItem? {
        let id = String(describing: raw["id"] ?? raw["imdb_id"] ?? "")
        guard id.range(of: #"^tt\d+$"#, options: .regularExpression) != nil else { return nil }
        let title = ((raw["name"] as? String) ?? (raw["title"] as? String) ?? "").trimmingCharacters(in: .whitespaces)
        if title.isEmpty { return nil }
        let genres = (raw["genre"] as? [String]) ?? []
        let poster = (raw["poster"] as? String) ?? ""
        let backdrop = (raw["background"] as? String) ?? (raw["backdrop"] as? String) ?? poster
        let runtime: String?
        if let text = raw["runtime"] as? String { runtime = text }
        else if let number = raw["runtime"] as? Int { runtime = "\(number) min" }
        else { runtime = nil }
        return MediaItem(
            id: id.lowercased(),
            title: title,
            year: parseYear(raw["year"]) ?? parseYear(raw["releaseInfo"]),
            kind: kind,
            synopsis: raw["description"] as? String ?? "",
            poster: poster,
            backdrop: backdrop,
            genres: genres,
            rating: raw["imdbRating"] == nil ? "" : String(describing: raw["imdbRating"]!),
            runtime: runtime,
            playable: true,
            progress: nil,
            filename: nil,
            hue: TVMTitle.hue(for: title),
            mimeType: nil,
            season: nil,
            episode: nil,
            episodeName: nil,
            showTitle: title,
            aired: nil,
            added: nil
        )
    }

    private func mapVideos(show: MediaItem, videos: Any?) -> [MediaItem] {
        guard let list = videos as? [[String: Any]] else { return [] }
        return list.compactMap { video -> MediaItem? in
            let fromId = String(describing: video["id"] ?? "")
            let idParts = fromId.split(separator: ":")
            let season = intValue(video["season"] ?? video["seasonNumber"]) ?? (idParts.count >= 3 ? Int(idParts[idParts.count - 2]) : nil)
            let episode = intValue(video["episode"] ?? video["number"] ?? video["episodeNumber"]) ?? (idParts.last.flatMap { Int($0) })
            guard let season, let episode, season >= 1, episode >= 1 else { return nil }
            let name = (video["title"] as? String) ?? (video["name"] as? String) ?? "Episode \(episode)"
            let thumbnail = (video["thumbnail"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? show.poster
            return MediaItem(
                id: "\(show.id):\(season):\(episode)",
                title: show.title,
                year: show.year,
                kind: "series",
                synopsis: (video["overview"] as? String) ?? (video["description"] as? String) ?? "",
                poster: thumbnail,
                backdrop: show.backdrop,
                genres: show.genres,
                rating: "",
                runtime: nil,
                playable: true,
                progress: nil,
                filename: nil,
                hue: show.hue,
                mimeType: nil,
                season: season,
                episode: episode,
                episodeName: name,
                showTitle: show.title,
                aired: nil,
                added: nil
            )
        }.sorted {
            ($0.season ?? 0, $0.episode ?? 0) < ($1.season ?? 0, $1.episode ?? 0)
        }
    }

    private func parseYear(_ value: Any?) -> Int? {
        if let number = value as? Int, number > 1800 { return number }
        if let text = value as? String, let match = text.range(of: #"\b(19|20)\d{2}\b"#, options: .regularExpression) {
            return Int(text[match])
        }
        return nil
    }

    private func intValue(_ value: Any?) -> Int? {
        if let number = value as? Int { return number }
        if let number = value as? Double { return Int(number) }
        if let text = value as? String { return Int(text) }
        return nil
    }

    private func dedupe(_ items: [MediaItem]) -> [MediaItem] {
        var seen = Set<String>()
        return items.filter { seen.insert($0.id).inserted }
    }

    private func fallbackBundle() -> CatalogBundle {
        let movies = fallback.filter { $0.kind == "movie" }
        let series = fallback.filter { $0.kind == "series" }
        return CatalogBundle(
            moviesTop: Array(movies.prefix(16)),
            seriesTop: Array(series.prefix(16)),
            moviesRated: Array(movies.prefix(16)),
            seriesRated: Array(series.prefix(16)),
            recentTv: Array(series.prefix(16)),
            newFilms: Array(movies.filter { ($0.year ?? 0) >= 2023 }.prefix(16)),
            catalog: fallback
        )
    }

    private func readDisk() -> CatalogBundle? {
        guard let object = store.readJSON("catalog-cache.json") as? [String: Any],
              let movies = object["moviesTop"] as? [Any] else { return nil }
        return CatalogBundle(
            moviesTop: movies.compactMap(MediaItem.parse),
            seriesTop: (object["seriesTop"] as? [Any] ?? []).compactMap(MediaItem.parse),
            moviesRated: (object["moviesRated"] as? [Any] ?? []).compactMap(MediaItem.parse),
            seriesRated: (object["seriesRated"] as? [Any] ?? []).compactMap(MediaItem.parse),
            recentTv: (object["recentTv"] as? [Any] ?? []).compactMap(MediaItem.parse),
            newFilms: (object["newFilms"] as? [Any] ?? []).compactMap(MediaItem.parse),
            catalog: (object["catalog"] as? [Any] ?? []).compactMap(MediaItem.parse)
        )
    }

    private func encode(_ data: CatalogBundle) -> [String: Any] {
        [
            "moviesTop": data.moviesTop.map { $0.json() },
            "seriesTop": data.seriesTop.map { $0.json() },
            "moviesRated": data.moviesRated.map { $0.json() },
            "seriesRated": data.seriesRated.map { $0.json() },
            "recentTv": data.recentTv.map { $0.json() },
            "newFilms": data.newFilms.map { $0.json() },
            "catalog": data.catalog.map { $0.json() },
        ]
    }
}
