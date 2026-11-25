import Foundation

struct ReviewEntry: Equatable {
    var author: String
    var stars: Double?
    var text: String
    var likes: Int?
    var url: String?

    func json() -> [String: Any] {
        [
            "author": author,
            "stars": JSONValue.orNull(stars),
            "text": text,
            "likes": JSONValue.orNull(likes),
            "url": JSONValue.orNull(url),
        ]
    }
}

struct ReviewsPayload {
    var imdbId: String
    var imdbUrl: String
    var rating: Double?
    var source: String?
    var sourceUrl: String?
    var average: Double?
    var reviews: [ReviewEntry]

    func json() -> [String: Any] {
        [
            "imdbId": imdbId,
            "imdbUrl": imdbUrl,
            "rating": JSONValue.orNull(rating),
            "source": JSONValue.orNull(source),
            "sourceUrl": JSONValue.orNull(sourceUrl),
            "average": JSONValue.orNull(average),
            "reviews": reviews.map { $0.json() },
        ]
    }
}

final class TVMReviews {
    static let ttl: TimeInterval = 24 * 60 * 60
    static let maxCached = 300
    static let minReviewLength = 40
    static let maxReviewLength = 420
    static let maxReviews = 3

    private static let articleRegex = try! NSRegularExpression(
        pattern: #"<article\b[^>]*class=["'][^"']*\bproduction-viewing\b[^"']*["'][^>]*>([\s\S]*?)</article>"#,
        options: [.caseInsensitive]
    )
    private static let metaData2A = try! NSRegularExpression(
        pattern: #"<meta\b[^>]*\bname=["']twitter:data2["'][^>]*\bcontent=["']([^"']+)["'][^>]*>"#,
        options: [.caseInsensitive]
    )
    private static let metaData2B = try! NSRegularExpression(
        pattern: #"<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']twitter:data2["'][^>]*>"#,
        options: [.caseInsensitive]
    )
    private static let floatRegex = try! NSRegularExpression(pattern: #"(\d+(?:\.\d+)?)"#)
    private static let authorRegex = try! NSRegularExpression(
        pattern: #"<strong\b[^>]*\bclass=["'][^"']*\b(?:displayname|name)\b[^"']*["'][^>]*>([^<]+)<"#,
        options: [.caseInsensitive]
    )
    private static let contextLinkA = try! NSRegularExpression(
        pattern: #"<a\b[^>]*\bhref=["'](/[^"']+/film/[^"']+)["'][^>]*\bclass=["'][^"']*\bcontext\b[^"']*["'][^>]*>"#,
        options: [.caseInsensitive]
    )
    private static let contextLinkB = try! NSRegularExpression(
        pattern: #"<a\b[^>]*\bclass=["'][^"']*\bcontext\b[^"']*["'][^>]*\bhref=["'](/[^"']+/film/[^"']+)["'][^>]*>"#,
        options: [.caseInsensitive]
    )
    private static let ratingSpanRegex = try! NSRegularExpression(
        pattern: #"<span\b[^>]*\bclass=["']([^"']*\brating\b[^"']*)["'][^>]*>([\s\S]*?)</span>"#,
        options: [.caseInsensitive]
    )
    private static let ratedClassRegex = try! NSRegularExpression(pattern: #"\brated-(\d+)\b"#, options: [.caseInsensitive])
    private static let ariaLabelRegex = try! NSRegularExpression(pattern: #"\baria-label=["']([^"']+)["']"#, options: [.caseInsensitive])
    private static let dataCountRegex = try! NSRegularExpression(pattern: #"\bdata-count=["'](\d+)["']"#, options: [.caseInsensitive])
    private static let bodyTextRegex = try! NSRegularExpression(
        pattern: #"<div\b[^>]*\bclass=["'][^"']*\bbody-text\b[^"']*["'][^>]*>([\s\S]*?)</div>"#,
        options: [.caseInsensitive]
    )
    private static let blockBreakRegex = try! NSRegularExpression(pattern: #"</?(?:p|br)\b[^>]*>"#, options: [.caseInsensitive])
    private static let tagRegex = try! NSRegularExpression(pattern: #"<[^>]+>"#)
    private static let spaceRegex = try! NSRegularExpression(pattern: #"\s+"#)
    private static let numericEntityRegex = try! NSRegularExpression(pattern: #"&#(x?[0-9a-fA-F]+);"#)

    private struct Cached {
        var payload: ReviewsPayload
        var at: Date
    }

    private let itemLookup: (String) async -> MediaItem?
    private let pageFetcher: (String) async -> (String, String?)
    private let clock: () -> Date
    private let lock = NSLock()
    private var cache: [String: Cached] = [:]
    private var order: [String] = []

    init(
        itemLookup: @escaping (String) async -> MediaItem?,
        session: URLSession = .shared,
        pageFetcher: ((String) async -> (String, String?))? = nil,
        clock: @escaping () -> Date = Date.init
    ) {
        self.itemLookup = itemLookup
        self.pageFetcher = pageFetcher ?? { url in
            await TVMReviews.fetchHTML(session: session, startURL: url)
        }
        self.clock = clock
    }

    static func isValidImdbId(_ raw: String) -> Bool {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return trimmed.range(of: #"^tt\d{5,10}$"#, options: .regularExpression) != nil
    }

    func get(_ rawId: String) async -> ReviewsPayload? {
        let key = rawId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard Self.isValidImdbId(key) else { return nil }

        let now = clock()
        lock.lock()
        if let hit = cache[key], now.timeIntervalSince(hit.at) < Self.ttl {
            let payload = hit.payload
            lock.unlock()
            return payload
        }
        lock.unlock()

        async let itemTask = itemLookup(key)
        async let pageTask = pageFetcher("https://letterboxd.com/imdb/\(key)/")
        let (item, page) = await (itemTask, pageTask)

        let rating: Double?
        if let rawRating = item?.rating.trimmingCharacters(in: .whitespacesAndNewlines),
           let parsedRating = Double(rawRating), parsedRating > 0, parsedRating <= 10 {
            rating = parsedRating
        } else {
            rating = nil
        }

        let parsed = page.1.map { Self.parseLetterboxd(finalURL: page.0, html: $0) }
            ?? (sourceURL: nil, average: nil, reviews: [])
        let source = parsed.sourceURL != nil ? "letterboxd" : nil

        let payload = ReviewsPayload(
            imdbId: key,
            imdbUrl: "https://www.imdb.com/title/\(key)/",
            rating: rating,
            source: source,
            sourceUrl: parsed.sourceURL,
            average: parsed.average,
            reviews: parsed.reviews
        )

        if source != nil || rating != nil {
            lock.lock()
            if cache[key] == nil, order.count >= Self.maxCached, let oldest = order.first {
                order.removeFirst()
                cache.removeValue(forKey: oldest)
            }
            order.removeAll { $0 == key }
            order.append(key)
            cache[key] = Cached(payload: payload, at: now)
            lock.unlock()
        }
        return payload
    }

    static func parseLetterboxd(finalURL: String, html: String) -> (sourceURL: String?, average: Double?, reviews: [ReviewEntry]) {
        let cleanURL = finalURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleanURL.range(of: #"^https?://(?:www\.)?letterboxd\.com/film/[^/?#]+/?$"#, options: [.regularExpression, .caseInsensitive]) != nil else {
            return (nil, nil, [])
        }
        let canonical = cleanURL.hasSuffix("/") ? cleanURL : "\(cleanURL)/"

        var average: Double? = nil
        if let attr = firstGroup(metaData2A, in: html) ?? firstGroup(metaData2B, in: html),
           let numStr = firstGroup(floatRegex, in: attr),
           let value = Double(numStr), value > 0, value <= 5 {
            average = (value * 100.0).rounded() / 100.0
        }

        var entries: [ReviewEntry] = []
        let nsHTML = html as NSString
        for match in articleRegex.matches(in: html, range: NSRange(location: 0, length: nsHTML.length)) {
            let block = nsHTML.substring(with: match.range(at: 1))
            let lower = block.lowercased()
            if lower.contains("contains-spoilers") || lower.contains("has-spoilers") || lower.contains("this review may contain spoilers") {
                continue
            }
            guard let bodyHTML = firstGroup(bodyTextRegex, in: block) else { continue }
            let clean = stripAndDecode(bodyHTML)
            guard clean.count >= minReviewLength else { continue }
            let text = clampText(clean, maxLength: maxReviewLength)

            let author = firstGroup(authorRegex, in: block).map(decodeEntities)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let relPath = (firstGroup(contextLinkA, in: block) ?? firstGroup(contextLinkB, in: block))?.trimmingCharacters(in: .whitespacesAndNewlines)
            let reviewURL = (relPath != nil && !relPath!.isEmpty) ? "https://letterboxd.com\(relPath!)" : nil
            let stars = extractStars(in: block)
            let likes = firstGroup(dataCountRegex, in: block).flatMap(Int.init)
            entries.append(
                ReviewEntry(
                    author: (author != nil && !author!.isEmpty) ? author! : "Reviewer",
                    stars: stars,
                    text: text,
                    likes: likes,
                    url: reviewURL
                )
            )
        }

        let sorted = Array(entries.sorted { ($0.likes ?? 0) > ($1.likes ?? 0) }.prefix(maxReviews))
        return (canonical, average, sorted)
    }

    private static func extractStars(in block: String) -> Double? {
        let nsBlock = block as NSString
        for match in ratingSpanRegex.matches(in: block, range: NSRange(location: 0, length: nsBlock.length)) {
            let fullTag = nsBlock.substring(with: match.range)
            let cls = nsBlock.substring(with: match.range(at: 1))
            let inner = decodeEntities(nsBlock.substring(with: match.range(at: 2)))
            let aria = firstGroup(ariaLabelRegex, in: fullTag).map(decodeEntities) ?? ""
            let combined = "\(inner) \(aria)"
            let full = combined.filter { $0 == "★" }.count
            let half = combined.contains("½") ? 0.5 : 0.0
            if full > 0 || half > 0 { return min(5.0, max(0.5, Double(full) + half)) }
            if let ratedStr = firstGroup(ratedClassRegex, in: cls), let rated = Int(ratedStr), (1...10).contains(rated) {
                return Double(rated) / 2.0
            }
        }
        if let ratedStr = firstGroup(ratedClassRegex, in: block), let rated = Int(ratedStr), (1...10).contains(rated) {
            return Double(rated) / 2.0
        }
        return nil
    }

    static func clampText(_ text: String, maxLength: Int) -> String {
        guard text.count > maxLength else { return text }
        let slice = String(text.prefix(maxLength))
        if let idx = slice.lastIndex(of: " "), slice.distance(from: slice.startIndex, to: idx) >= (maxLength * 3) / 4 {
            return String(slice[..<idx]).trimmingCharacters(in: .whitespaces) + "…"
        }
        return slice.trimmingCharacters(in: .whitespaces) + "…"
    }

    static func decodeEntities(_ input: String) -> String {
        var s = input
            .replacingOccurrences(of: "&amp;", with: "&")
            .replacingOccurrences(of: "&lt;", with: "<")
            .replacingOccurrences(of: "&gt;", with: ">")
            .replacingOccurrences(of: "&quot;", with: "\"")
            .replacingOccurrences(of: "&apos;", with: "'")
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&nbsp;", with: " ")
            .replacingOccurrences(of: "&hellip;", with: "…")
            .replacingOccurrences(of: "&mdash;", with: "—")
            .replacingOccurrences(of: "&ndash;", with: "–")
            .replacingOccurrences(of: "&rsquo;", with: "’")
            .replacingOccurrences(of: "&lsquo;", with: "‘")
            .replacingOccurrences(of: "&ldquo;", with: "“")
            .replacingOccurrences(of: "&rdquo;", with: "”")

        let ns = s as NSString
        let matches = numericEntityRegex.matches(in: s, range: NSRange(location: 0, length: ns.length))
        for match in matches.reversed() {
            let token = ns.substring(with: match.range(at: 1))
            let code: UInt32? = token.lowercased().hasPrefix("x")
                ? UInt32(token.dropFirst(), radix: 16)
                : UInt32(token, radix: 10)
            if let code, let scalar = UnicodeScalar(code), let range = Range(match.range, in: s) {
                s.replaceSubrange(range, with: String(scalar))
            }
        }
        return s
    }

    private static func stripAndDecode(_ html: String) -> String {
        let range1 = NSRange(location: 0, length: (html as NSString).length)
        let spaced = blockBreakRegex.stringByReplacingMatches(in: html, range: range1, withTemplate: " ")
        let range2 = NSRange(location: 0, length: (spaced as NSString).length)
        let noTags = tagRegex.stringByReplacingMatches(in: spaced, range: range2, withTemplate: " ")
        let decoded = decodeEntities(noTags)
        let range3 = NSRange(location: 0, length: (decoded as NSString).length)
        return spaceRegex.stringByReplacingMatches(in: decoded, range: range3, withTemplate: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func firstGroup(_ regex: NSRegularExpression, in text: String, group: Int = 1) -> String? {
        let ns = text as NSString
        guard let match = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
              match.numberOfRanges > group,
              match.range(at: group).location != NSNotFound else {
            return nil
        }
        return ns.substring(with: match.range(at: group))
    }

    private static func fetchHTML(session: URLSession, startURL: String) async -> (String, String?) {
        guard let url = URL(string: startURL) else { return (startURL, nil) }
        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        req.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 TVM/1.1", forHTTPHeaderField: "User-Agent")
        req.setValue("text/html,application/xhtml+xml", forHTTPHeaderField: "Accept")
        req.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
        guard let (data, response) = try? await session.data(for: req),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              let html = String(data: data, encoding: .utf8) else {
            return (startURL, nil)
        }
        return (http.url?.absoluteString ?? startURL, html)
    }
}
