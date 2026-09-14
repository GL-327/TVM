import Foundation

enum TVMTitle {
    static func hue(for text: String) -> Int {
        var hash: UInt32 = 0
        for scalar in text.unicodeScalars {
            hash = hash &* 31 &+ scalar.value
        }
        return Int(hash % 360)
    }

    static func looksLikePack(title: String, filename: String = "") -> Bool {
        let name = "\(title) \(filename)"
        if name.range(of: #"\bS\d{1,2}[\s._-]*E\d{1,2}\s*[-–]\s*E?\d{1,2}\b"#, options: .regularExpression) != nil {
            return true
        }
        if name.range(of: #"\bS\d{1,2}\s*[-–]\s*S?\d{1,2}\b"#, options: .regularExpression) != nil { return true }
        if name.range(of: #"\bS\d{1,2}[\s._-]*E\d{1,2}\b"#, options: .regularExpression) != nil { return false }
        return name.range(
            of: #"\b(S\d{1,2}|season|seasons|complete|collection|box\s*set|temporada)\b"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    static func parseEpisode(_ filename: String) -> (season: Int, episode: Int)? {
        if looksLikePack(title: filename) { return nil }
        let patterns = [
            #"\bS(\d{1,2})[\s._-]*E(\d{1,2})\b"#,
            #"\b(\d{1,2})x(\d{1,2})\b"#,
        ]
        for pattern in patterns {
            if let match = filename.range(of: pattern, options: [.regularExpression, .caseInsensitive]) {
                let text = String(filename[match])
                let parts = text.split { !$0.isNumber }.compactMap { Int($0) }
                if parts.count >= 2, parts[0] > 0, parts[1] > 0 { return (parts[0], parts[1]) }
            }
        }
        return nil
    }

    static func parseSeason(_ filename: String) -> Int? {
        guard let match = filename.range(
            of: #"\bS(?:eason)?[\s._-]*(\d{1,2})\b"#,
            options: [.regularExpression, .caseInsensitive]
        ) else { return nil }
        let digits = String(filename[match]).filter(\.isNumber)
        guard let value = Int(digits), value > 0 else { return nil }
        return value
    }

    static func parseFilename(_ filename: String) -> (title: String, year: Int?) {
        var base = filename.replacingOccurrences(of: #"\.[a-z0-9]{2,4}$"#, with: "", options: .regularExpression)
        base = base.replacingOccurrences(of: #"\[[^\]]*]"#, with: " ", options: .regularExpression)
        base = base.replacingOccurrences(of: #"[._]+"#, with: " ", options: .regularExpression)
        let yearMatch = base.range(of: #"\b(19|20)\d{2}\b"#, options: .regularExpression)
        let year = yearMatch.flatMap { Int(base[$0]) }
        var head = base
        if let cut = base.range(
            of: #"\b(?:S(?:eason)?[\s._-]*\d{1,2}|\d{1,2}x\d{1,2}|(?:19|20)\d{2}|\d{3,4}p)\b"#,
            options: [.regularExpression, .caseInsensitive]
        ), cut.lowerBound > base.startIndex {
            head = String(base[base.startIndex..<cut.lowerBound])
        }
        let junk = #"\b(1080p|720p|2160p|480p|4k|uhd|webrip|web-?dl|bluray|x264|x265|h264|h265|hevc|aac|hdr|remux)\b"#
        let title = head.replacingOccurrences(of: junk, with: " ", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (title.isEmpty ? base : title, year)
    }

    static func isPlayableFile(_ filename: String, mimeType: String?) -> Bool {
        if mimeType?.hasPrefix("audio/") == true { return false }
        return filename.range(
            of: #"\.(srt|idx|sub|nfo|txt|jpg|jpeg|png|gif|bmp|exe|zip|rar|7z|iso)$"#,
            options: [.regularExpression, .caseInsensitive]
        ) == nil
    }

    static func isDisplayTitle(_ title: String) -> Bool {
        if title.count < 2 || title.count > 46 { return false }
        if title.contains(where: { "[]{}".contains($0) }) { return false }
        return title.range(of: #"\b(s\d|e\d|1080|2160|webrip)\b"#, options: [.regularExpression, .caseInsensitive]) == nil
    }

    static func normalize(_ value: String) -> String {
        value.lowercased().filter { $0.isLetter || $0.isNumber }
    }

    static func titlesMatch(_ left: String, _ right: String) -> Bool {
        let a = normalize(left)
        let b = normalize(right)
        if a.isEmpty || b.isEmpty { return false }
        return a == b || a.contains(b) || b.contains(a)
    }

    static func parsePlayId(_ id: String) -> (imdb: String, season: Int?, episode: Int?)? {
        guard let match = id.range(of: #"^(tt\d+)(?::(\d+):(\d+))?$"#, options: [.regularExpression, .caseInsensitive]) else {
            return nil
        }
        let text = String(id[match])
        let parts = text.split(separator: ":")
        guard let first = parts.first else { return nil }
        let season = parts.count >= 3 ? Int(parts[1]) : nil
        let episode = parts.count >= 3 ? Int(parts[2]) : nil
        return (String(first).lowercased(), season, episode)
    }

    static func extractImdb(_ id: String) -> String? {
        guard let match = id.range(of: #"tt\d+"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
        return String(id[match]).lowercased()
    }

    /// Fallback browse cards used to be slugs (`fight-club`). Torrentio needs IMDb.
    static func catalogImdb(_ id: String) -> String? {
        if let imdb = extractImdb(id) { return imdb }
        let slug = id.split(separator: ":").first.map { String($0).lowercased() } ?? id.lowercased()
        return catalogImdbMap[slug]
    }

    static func seasonEpisode(from id: String) -> (season: Int, episode: Int)? {
        let parts = id.split(separator: ":")
        guard parts.count >= 3,
              let season = Int(parts[parts.count - 2]),
              let episode = Int(parts[parts.count - 1]),
              season > 0, episode > 0 else { return nil }
        return (season, episode)
    }

    private static let catalogImdbMap: [String: String] = [
        "ten-truths-about-love": "tt15483404",
        "dune-part-two": "tt15239678",
        "the-last-of-us": "tt3581920",
        "oppenheimer": "tt15398776",
        "the-batman": "tt1877830",
        "stranger-things": "tt4574334",
        "the-boys": "tt1190634",
        "spider-verse": "tt9362722",
        "interstellar": "tt0816692",
        "the-dark-knight": "tt0468569",
        "inception": "tt1375666",
        "no-way-home": "tt10872600",
        "infinity-war": "tt4154756",
        "endgame": "tt4154796",
        "john-wick-4": "tt10366206",
        "star-wars": "tt0076759",
        "the-godfather": "tt0068646",
        "shawshank": "tt0111161",
        "pulp-fiction": "tt0110912",
        "fight-club": "tt0137523",
        "titanic": "tt0120338",
        "game-of-thrones": "tt0944947",
        "breaking-bad": "tt0903747",
        "wednesday": "tt13443470",
        "house-of-the-dragon": "tt11198330",
        "severance": "tt11280740",
        "silo": "tt14688458",
        "the-bear": "tt14452776",
        "squid-game": "tt10919420",
        "the-mandalorian": "tt8111088",
        "the-witcher": "tt5180504",
        "the-devil-wears-prada": "tt0458352",
        "invincible": "tt6741278",
        "avatar": "tt0499549",
        "dexter": "tt0773262",
        "supernatural": "tt0460681",
        "outer-range": "tt9051676",
        "the-wilds": "tt10671440",
        "outlander": "tt3006802",
        "yellowjackets": "tt11041332",
        "baywatch": "tt1467386",
        "reacher": "tt9288030",
        "bel-air": "tt13652442",
        "smackdown": "tt0227972",
        "girls5eva": "tt11761214",
        "star-trek-discovery": "tt5171438",
    ]

    static func fileName(from path: String) -> String {
        path.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? path
    }

    static func itemFromName(id: String, filename: String, mimeType: String? = nil, progress: Double? = nil) -> MediaItem? {
        guard isPlayableFile(filename, mimeType: mimeType) else { return nil }
        let parsed = parseFilename(filename)
        let episode = parseEpisode(filename)
        return MediaItem(
            id: id,
            title: parsed.title,
            year: parsed.year,
            kind: episode == nil ? "file" : "series",
            synopsis: filename,
            poster: "",
            backdrop: "",
            genres: ["Your files"],
            rating: "",
            runtime: nil,
            playable: true,
            progress: progress,
            filename: filename,
            hue: hue(for: parsed.title),
            mimeType: mimeType,
            season: episode?.season,
            episode: episode?.episode,
            episodeName: nil,
            showTitle: parsed.title,
            aired: nil,
            added: nil
        )
    }

    static func progressRatio(_ entry: ProgressEntry?) -> Double? {
        guard let entry, entry.duration >= 60, entry.position >= 30 else { return nil }
        let value = entry.position / entry.duration
        if value >= 0.96 { return nil }
        return min(1, max(0, value))
    }
}
