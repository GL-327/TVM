import Foundation

/// Artwork that does not belong to the title it is filed under.
///
/// Ported from Android (TvmCatalogQuality.kt). Cinemeta sometimes links two
/// IMDb titles to one underlying record: "David" (1997, tt0118933) carries
/// Law & Order: SVU's TMDB record, so metahub serves SVU's poster, background
/// and episode stills under David's id, and both appear in "Recently updated"
/// with the same artwork. Such a pair shows up as two titles with the exact
/// same Stremio popularity, computed from the shared record. The better
/// established one (more Trakt watchers, then more ranking sources) keeps the
/// artwork; the other's metahub pictures are refused (TVMLocalCore /api/art),
/// so its own title card shows instead of somebody else's poster. The list
/// is kept on the phone, so the next launch knows before its first picture.
enum TVMArtTrust {
    private static let lock = NSLock()
    private static var distrusted: Set<String> = []
    private static var file: URL?
    /// Told when titles are newly found, so pictures already shown are replaced.
    static var onDistrusted: ((Set<String>) -> Void)?

    static func attach(_ url: URL) {
        lock.lock(); defer { lock.unlock() }
        file = url
        if let data = try? Data(contentsOf: url), let ids = try? JSONSerialization.jsonObject(with: data) as? [String] {
            distrusted.formUnion(ids.map { $0.lowercased() })
        }
    }

    static func distrust(_ ids: Set<String>) {
        lock.lock()
        let added = Set(ids.map { $0.lowercased() }).subtracting(distrusted)
        if added.isEmpty { lock.unlock(); return }
        distrusted.formUnion(added)
        let snapshot = distrusted.sorted()
        let target = file
        lock.unlock()
        if let target, let data = try? JSONSerialization.data(withJSONObject: snapshot) { try? data.write(to: target, options: .atomic) }
        onDistrusted?(added)
    }

    static func isDistrusted(_ id: String) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return distrusted.contains(id.lowercased())
    }

    static func clear() { lock.lock(); distrusted = []; lock.unlock() }

    /// False for a metahub picture filed under a title whose artwork is someone else's.
    static func trusted(_ url: String) -> Bool {
        guard let regex = try? NSRegularExpression(pattern: #"^https?://(?:images|episodes|live)\.metahub\.space/.*?\b(tt\d+)\b"#, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)),
              let range = Range(match.range(at: 1), in: url) else { return true }
        return !isDistrusted(String(url[range]))
    }

    /// Upstream's own marker for a record it knows is a duplicate.
    static func markedDuplicate(_ name: String) -> Bool {
        name.trimmingCharacters(in: .whitespaces).uppercased().hasPrefix("#DUPE")
    }

    /// Ids in one catalog answer whose artwork belongs to another title in it.
    /// A pair with nothing to tell them apart is left alone.
    static func crossLinked(_ metas: [[String: Any]]) -> Set<String> {
        var groups: [Double: [[String: Any]]] = [:]
        for meta in metas {
            guard let popularity = (meta["popularity"] as? NSNumber)?.doubleValue, popularity > 0, popularity.isFinite else { continue }
            if markedDuplicate(meta["name"] as? String ?? "") { continue }
            groups[popularity, default: []].append(meta)
        }
        var out = Set<String>()
        for group in groups.values {
            let ids = Set(group.map { String(describing: $0["id"] ?? "").lowercased() })
            guard ids.count >= 2 else { continue }
            let ranked = group.sorted { standing($0) > standing($1) }
            if ranked.count > 1 && standing(ranked[0]) == standing(ranked[1]) { continue }
            out.formUnion(ids.subtracting([String(describing: ranked[0]["id"] ?? "").lowercased()]))
        }
        return out
    }

    private static func standing(_ meta: [String: Any]) -> Standing {
        let sources = meta["popularities"] as? [String: Any]
        return Standing(trakt: (sources?["trakt"] as? NSNumber)?.doubleValue ?? 0, sources: sources?.count ?? 0)
    }

    private struct Standing: Comparable {
        let trakt: Double
        let sources: Int
        static func < (a: Standing, b: Standing) -> Bool { a.trakt != b.trakt ? a.trakt < b.trakt : a.sources < b.sources }
    }
}

/// Search order (ported from Android's TvmSearchRank). Cinemeta answers films
/// and series separately and they used to be joined films first: "Dexter"
/// put an obscure 2025 film and every spin-off ahead of the 2006 series.
/// Results are ranked by how well the title matches what was typed (exact,
/// then the title starting with it, then a whole word, then anywhere); among
/// the best matches by the popularity on each title's own record (search
/// answers leave it out); then by how many results are follow-ons of the
/// same title; and finally by Cinemeta's own order.
enum TVMSearchRank {
    struct Hit {
        let item: MediaItem
        let index: Int
    }

    static func key(_ value: String) -> String {
        let plain = value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US"))
            .replacingOccurrences(of: "&", with: " and ")
        return plain.lowercased()
            .replacingOccurrences(of: #"[^\p{L}\p{N}]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    private static func withoutArticle(_ value: String) -> String {
        for article in ["the ", "a ", "an "] where value.hasPrefix(article) { return String(value.dropFirst(article.count)) }
        return value
    }

    static func tier(_ query: String, _ title: String) -> Int {
        let q = key(query), t = key(title)
        if q.isEmpty || t.isEmpty { return 5 }
        if t == q { return 0 }
        if withoutArticle(t) == withoutArticle(q) { return 1 }
        if t.hasPrefix(q + " ") || withoutArticle(t).hasPrefix(withoutArticle(q) + " ") { return 2 }
        if (" " + t + " ").contains(" " + q + " ") { return 3 }
        if t.contains(q) { return 4 }
        return 5
    }

    /// The best-matching hits, whose records are worth asking for their popularity.
    static func contenders(_ query: String, movies: [Hit], series: [Hit], limit: Int = 6) -> [Hit] {
        let all = movies + series
        guard let best = all.map({ tier(query, $0.item.title) }).min(), best <= 1 else { return [] }
        let top = all.filter { tier(query, $0.item.title) == best }
        guard top.count >= 2 else { return [] }
        return Array(top.sorted { $0.index < $1.index }.prefix(limit))
    }

    static func rank(_ query: String, movies: [Hit], series: [Hit], standing: [String: Double] = [:]) -> [MediaItem] {
        let all = movies + series
        let keys = all.map { key($0.item.title) }
        func followOns(_ at: Int) -> Int {
            let root = keys[at]
            if root.isEmpty { return 0 }
            return all.indices.filter { $0 != at && all[$0].item.kind == all[at].item.kind && keys[$0].hasPrefix(root + " ") }.count
        }
        let order = all.indices.sorted { a, b in
            let ta = tier(query, all[a].item.title), tb = tier(query, all[b].item.title)
            if ta != tb { return ta < tb }
            let sa = standing[all[a].item.id] ?? -1, sb = standing[all[b].item.id] ?? -1
            if sa != sb { return sa > sb }
            let fa = followOns(a), fb = followOns(b)
            if fa != fb { return fa > fb }
            if all[a].index != all[b].index { return all[a].index < all[b].index }
            return all[a].item.kind == "series" && all[b].item.kind != "series"
        }
        var seen = Set<String>()
        return order.map { all[$0].item }.filter { seen.insert($0.id).inserted }
    }
}
