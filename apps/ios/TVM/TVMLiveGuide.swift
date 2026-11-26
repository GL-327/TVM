import CommonCrypto
import Foundation
import zlib

struct GuideWindow {
    let now: Date
    let start: Date
    let end: Date

    static func iso(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    static func parse(start: String?, hours: String?, now: Date = Date()) -> GuideWindow? {
        let span = hours.flatMap(Double.init) ?? (hours == nil ? 3 : .nan)
        guard span.isFinite, span.rounded() == span, span >= 1, span <= 24 else { return nil }
        let begin: Date
        if let start {
            guard start.range(of: #"^\d{4}-\d\d-\d\dT"#, options: [.regularExpression, .caseInsensitive]) != nil,
                  let parsed = date(start) else { return nil }
            begin = parsed
        } else {
            begin = Date(timeIntervalSince1970: floor(now.timeIntervalSince1970 / 1800) * 1800)
        }
        return GuideWindow(now: now, start: begin, end: begin.addingTimeInterval(span * 3600))
    }
}

struct GuideProgramme: Codable, Equatable {
    var start: String
    var end: String
    var title: String
    var subtitle: String? = nil
    var description: String? = nil
    var category: String? = nil
    var image: String? = nil
    var episode: String? = nil

    func json() -> [String: Any] {
        var out: [String: Any] = ["start": start, "end": end, "title": title]
        if let subtitle { out["subtitle"] = subtitle }
        if let description { out["description"] = description }
        if let category { out["category"] = category }
        if let image { out["image"] = image }
        if let episode { out["episode"] = episode }
        return out
    }
}

/// XMLParser retains one programme at a time, and only schedules inside the requested window.
final class TVMXmlTv: NSObject, XMLParserDelegate {
    typealias Schedule = [String: [GuideProgramme]]
    private let window: GuideWindow
    private let ids: Set<String>
    private let names: Set<String>
    private var aliases: [String: String] = [:]
    private var rows: Schedule = [:]
    private var channel = ""
    private var record = ""
    private var field = ""
    private var text = ""
    private var programme: GuideProgramme?
    private var valid = false
    private var count = 0

    init(wants: [(String, String)], window: GuideWindow) {
        self.window = window
        ids = Set(wants.map { $0.0.lowercased() }.filter { !$0.isEmpty })
        names = Set(wants.map { Self.nameKey($0.1) }.filter { !$0.isEmpty })
    }

    static func nameKey(_ value: String) -> String {
        value.decomposedStringWithCompatibilityMapping.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).joined()
    }

    static func xmlDate(_ value: String?) -> Date? {
        guard let value, let regex = try? NSRegularExpression(pattern: #"^(\d{12})(\d{2})?(?:\s*(Z|UTC|[+-]\d{4}))?$"#, options: .caseInsensitive),
              let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) else { return nil }
        func part(_ i: Int) -> String { Range(match.range(at: i), in: value).map { String(value[$0]) } ?? "" }
        let zone = part(3).uppercased()
        let stamp = part(1) + (part(2).isEmpty ? "00" : part(2)) + (zone.isEmpty || zone == "Z" || zone == "UTC" ? "+0000" : zone)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.isLenient = false
        formatter.dateFormat = "yyyyMMddHHmmssZ"
        return formatter.date(from: stamp)
    }

    static func safeURL(_ raw: String) -> URL? {
        guard let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url
    }

    static func programmeWindow(_ rows: [GuideProgramme], _ window: GuideWindow) -> [GuideProgramme] {
        var seen = Set<Date>()
        let matching = rows.filter {
            guard let start = GuideWindow.date($0.start), let end = GuideWindow.date($0.end) else { return false }
            return end > window.start && start < window.end && seen.insert(start).inserted
        }.sorted { $0.start < $1.start }
        return matching.isEmpty ? [GuideProgramme(start: GuideWindow.iso(window.start), end: GuideWindow.iso(window.end), title: "No guide information")] : matching
    }

    static func match(_ rows: Schedule, id: String, name: String) -> [GuideProgramme] {
        rows["id:" + id.lowercased()] ?? rows["name:" + nameKey(name)] ?? []
    }

    static func parse(_ stream: InputStream, wants: [(String, String)], window: GuideWindow) throws -> Schedule {
        let delegate = TVMXmlTv(wants: wants, window: window)
        let parser = XMLParser(stream: stream)
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        guard parser.parse(), delegate.valid else { throw ClientError.message("Invalid XMLTV document") }
        for (name, id) in delegate.aliases { if let rows = delegate.rows["id:" + id] { delegate.rows["name:" + name] = rows } }
        return delegate.rows
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes: [String: String]) {
        switch elementName {
        case "tv": valid = true
        case "channel": record = "channel"; channel = (attributes["id"] ?? "").lowercased()
        case "programme":
            record = "programme"; channel = (attributes["channel"] ?? "").lowercased()
            programme = nil
            if (ids.contains(channel) || aliases.values.contains(channel)),
               let start = Self.xmlDate(attributes["start"]), let end = Self.xmlDate(attributes["stop"]),
               start < end, end > window.start, start < window.end {
                programme = GuideProgramme(start: GuideWindow.iso(start), end: GuideWindow.iso(end), title: "")
            }
        case "display-name", "title", "sub-title", "desc", "category", "episode-num": field = elementName; text = ""
        case "icon": if let raw = attributes["src"], Self.safeURL(raw) != nil { programme?.image = raw }
        default: break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if !field.isEmpty && text.count < 6000 { text += String(string.prefix(6000 - text.count)) }
    }

    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) {
        if let string = String(data: CDATABlock, encoding: .utf8) { self.parser(parser, foundCharacters: string) }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        if elementName == field {
            let value = text.components(separatedBy: .whitespacesAndNewlines).filter { !$0.isEmpty }.joined(separator: " ")
            if record == "channel", field == "display-name", names.contains(Self.nameKey(value)), aliases[Self.nameKey(value)] == nil { aliases[Self.nameKey(value)] = channel }
            if record == "programme", !value.isEmpty {
                switch field {
                case "title": if programme?.title.isEmpty == true { programme?.title = value }
                case "sub-title": if programme?.subtitle == nil { programme?.subtitle = value }
                case "desc": if programme?.description == nil { programme?.description = value }
                case "category": if programme?.category == nil { programme?.category = value }
                case "episode-num": if programme?.episode == nil { programme?.episode = value }
                default: break
                }
            }
            field = ""
        }
        if elementName == "programme" {
            if let programme, !programme.title.isEmpty {
                count += 1
                if count > 150_000 { parser.abortParsing(); return }
                rows["id:" + channel, default: []].append(programme)
            }
            programme = nil; record = ""
        }
        if elementName == "channel" { record = "" }
    }

    static func xtream(_ payload: [String: Any], window: GuideWindow) -> [GuideProgramme] {
        func text(_ raw: Any?) -> String {
            let value = (raw as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if let data = Data(base64Encoded: value), let decoded = String(data: data, encoding: .utf8),
               !decoded.isEmpty, decoded.rangeOfCharacter(from: .controlCharacters) == nil { return String(decoded.prefix(6000)) }
            return String(value.prefix(6000))
        }
        func time(_ unix: Any?, _ stamp: Any?) -> Date? {
            let number = (unix as? NSNumber)?.doubleValue ?? (unix as? String).flatMap(Double.init)
            if let number, number.isFinite, number > 0, number < 1e12 { return Date(timeIntervalSince1970: number) }
            guard let raw = stamp as? String else { return nil }
            let value = raw.replacingOccurrences(of: " ", with: "T")
            return GuideWindow.date(value.range(of: #"Z|[+-]\d{2}:?\d{2}$"#, options: .regularExpression) != nil ? value : value + "Z")
        }
        return (payload["epg_listings"] as? [[String: Any]] ?? []).prefix(100).compactMap { row in
            guard let start = time(row["start_timestamp"], row["start"]),
                  let end = time(row["stop_timestamp"] ?? row["end_timestamp"], row["end"] ?? row["stop"]),
                  start < end, end > window.start, start < window.end else { return nil }
            let title = text(row["title"]), description = text(row["description"])
            guard !title.isEmpty else { return nil }
            return GuideProgramme(start: GuideWindow.iso(start), end: GuideWindow.iso(end), title: title, description: description.isEmpty ? nil : description)
        }
    }

    /// Inflate to a temporary file in chunks, so even a large .xml.gz never becomes a Data blob.
    static func gunzip(_ source: URL, to target: URL) throws {
        guard let input = InputStream(url: source), let output = OutputStream(url: target, append: false) else { throw ClientError.message("Guide unavailable") }
        input.open(); output.open()
        defer { input.close(); output.close() }
        var stream = z_stream()
        guard inflateInit2_(&stream, 16 + MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else { throw ClientError.message("gzip init failed") }
        defer { inflateEnd(&stream) }
        let chunkSize = 32768
        var incoming = [UInt8](repeating: 0, count: chunkSize)
        var outgoing = [UInt8](repeating: 0, count: 32768)
        var total = 0
        var status = Z_OK
        while status != Z_STREAM_END {
            let count = input.read(&incoming, maxLength: chunkSize)
            guard count > 0 else { throw ClientError.message("Truncated guide") }
            try incoming.withUnsafeMutableBytes { raw in
                stream.next_in = raw.bindMemory(to: Bytef.self).baseAddress
                stream.avail_in = uInt(count)
                repeat {
                    let written = outgoing.withUnsafeMutableBytes { buffer -> Int in
                        stream.next_out = buffer.bindMemory(to: Bytef.self).baseAddress
                        stream.avail_out = uInt(buffer.count)
                        status = inflate(&stream, Z_NO_FLUSH)
                        return buffer.count - Int(stream.avail_out)
                    }
                    guard status == Z_OK || status == Z_STREAM_END else { throw ClientError.message("Invalid gzip guide") }
                    total += written
                    guard total <= 256 * 1024 * 1024 else { throw ClientError.message("Guide too large") }
                    try outgoing.withUnsafeBytes { buffer in
                        guard let base = buffer.bindMemory(to: UInt8.self).baseAddress else { return }
                        var offset = 0
                        while offset < written {
                            let n = output.write(base.advanced(by: offset), maxLength: written - offset)
                            guard n > 0 else { throw ClientError.message("Guide cache unavailable") }
                            offset += n
                        }
                    }
                } while status == Z_OK && (stream.avail_in > 0 || stream.avail_out == 0)
            }
        }
    }
}

actor TVMLiveGuide {
    typealias Schedule = TVMXmlTv.Schedule
    private struct Snapshot: Codable { let at: Date; let matches: Schedule }
    private let directory: URL
    private let session: URLSession
    private var refreshing = Set<String>()
    private var retry: [String: Date] = [:]

    init(session: URLSession) {
        self.session = session
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? URL(fileURLWithPath: NSTemporaryDirectory())
        directory = cache.appendingPathComponent("TVM/guide", isDirectory: true)
    }

    private func snapshot(_ key: String, download: @escaping () async throws -> Schedule) -> Schedule {
        let bytes = Data(key.utf8)
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        bytes.withUnsafeBytes { _ = CC_SHA256($0.baseAddress, CC_LONG(bytes.count), &digest) }
        let id = digest.map { String(format: "%02x", $0) }.joined()
        let file = directory.appendingPathComponent(id + ".json")
        let value = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) }
        if (value == nil || Date().timeIntervalSince(value!.at) >= 6 * 3600), refreshing.count < 64,
           !refreshing.contains(id), Date() >= (retry[id] ?? .distantPast) {
            refreshing.insert(id)
            Task.detached {
                do { let rows = try await download(); await self.finish(id, file: file, rows: rows) }
                catch { await self.finish(id, file: file, rows: nil) }
            }
        }
        return value?.matches ?? [:]
    }

    private func finish(_ id: String, file: URL, rows: Schedule?) {
        defer { refreshing.remove(id) }
        guard let rows else {
            if retry.count >= 256 { retry.removeAll() }
            retry[id] = Date().addingTimeInterval(60); return
        }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(Snapshot(at: Date(), matches: rows)) { try? data.write(to: file, options: .atomic) }
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        let sorted = files.filter { $0.pathExtension == "json" }.sorted {
            ((try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast) >
            ((try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast)
        }
        for old in sorted.dropFirst(128) { try? FileManager.default.removeItem(at: old) }
    }

    private func xml(_ raw: String, wants: [(String, String)], window: GuideWindow) -> Schedule {
        let session = self.session
        return snapshot("xml-v1|\(raw)|\(GuideWindow.iso(window.start))|\(GuideWindow.iso(window.end))|\(wants)") {
            guard let url = TVMXmlTv.safeURL(raw) else { throw ClientError.message("Guide unavailable") }
            var request = URLRequest(url: url); request.timeoutInterval = 30
            let (file, response) = try await session.download(for: request)
            defer { try? FileManager.default.removeItem(at: file) }
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size <= 256 * 1024 * 1024,
                  let head = InputStream(url: file) else { throw ClientError.message("Guide unavailable") }
            head.open(); var magic = [UInt8](repeating: 0, count: 2)
            let n = head.read(&magic, maxLength: 2); head.close()
            let unpacked = file.appendingPathExtension("xml")
            defer { try? FileManager.default.removeItem(at: unpacked) }
            if n == 2 && magic == [0x1f, 0x8b] { try TVMXmlTv.gunzip(file, to: unpacked) }
            guard let input = InputStream(url: n == 2 && magic == [0x1f, 0x8b] ? unpacked : file) else { throw ClientError.message("Guide unavailable") }
            return try TVMXmlTv.parse(input, wants: wants, window: window)
        }
    }

    func guide(window: GuideWindow, group: String?, free: [String: Any], iptv: [[String: Any]], urls: [String], host: String?, user: String?, password: String?) -> [String: Any] {
        let freeRows = free["channels"] as? [[String: Any]] ?? []
        let feeds = free["epgFeeds"] as? [[String: Any]] ?? []
        var schedules: [String: Schedule] = [:]
        func text(_ row: [String: Any], _ key: String) -> String { row[key] as? String ?? "" }
        for feed in feeds.prefix(12) {
            let wants = freeRows.filter { text($0, "epgFeed") == text(feed, "id") }.map { (text($0, "epgId"), text($0, "name")) }
            if !wants.isEmpty { schedules[text(feed, "id")] = xml(text(feed, "url"), wants: wants, window: window) }
        }
        var channels: [[String: Any]] = []
        func add(_ row: [String: Any], id: String, number: Int, source: String, programmes: [GuideProgramme]) {
            channels.append(["id": id, "number": row["number"] as? Int ?? number, "name": text(row, "name"),
                             "logo": JSONValue.orNull(TVMXmlTv.safeURL(text(row, "logo"))?.absoluteString),
                             "group": text(row, "group").isEmpty ? "Other" : text(row, "group"), "source": source,
                             "programmes": TVMXmlTv.programmeWindow(programmes, window).map { $0.json() }])
        }
        for (i, row) in freeRows.enumerated() {
            add(row, id: "live:free:" + text(row, "id"), number: i + 1, source: "free", programmes: TVMXmlTv.match(schedules[text(row, "epgFeed")] ?? [:], id: text(row, "epgId"), name: text(row, "name")))
        }
        let xtream = !(host ?? "").isEmpty && !(user ?? "").isEmpty && password != nil
        func endpoint(_ file: String) -> String {
            var parts = URLComponents(string: (host ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/" + file)
            parts?.queryItems = [URLQueryItem(name: "username", value: user), URLQueryItem(name: "password", value: password)]
            return parts?.url?.absoluteString ?? ""
        }
        let wants = iptv.map { (text($0, "epgId"), text($0, "name")) }
        let provider = (xtream ? [endpoint("xmltv.php")] : urls).prefix(12).map { xml($0, wants: wants, window: window) }
        var fallbackCount = 0
        for row in iptv {
            var programmes = provider.map { TVMXmlTv.match($0, id: text(row, "epgId"), name: text(row, "name")) }.first { !$0.isEmpty } ?? []
            if programmes.isEmpty, xtream, group == nil || text(row, "group") == group, fallbackCount < 48 {
                fallbackCount += 1
                let streamId = URL(string: text(row, "url"))?.deletingPathExtension().lastPathComponent ?? ""
                if !streamId.isEmpty, streamId.allSatisfy({ $0.isNumber }) {
                    let raw = endpoint("player_api.php") + "&action=get_short_epg&stream_id=\(streamId)&limit=24"
                    let session = self.session
                    programmes = snapshot("short|\(raw)|\(GuideWindow.iso(window.start))|\(GuideWindow.iso(window.end))") {
                        guard let url = TVMXmlTv.safeURL(raw) else { throw ClientError.message("Guide unavailable") }
                        var request = URLRequest(url: url); request.timeoutInterval = 4
                        let (data, response) = try await session.data(for: request)
                        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                              let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw ClientError.message("Guide unavailable") }
                        return ["rows": TVMXmlTv.xtream(payload, window: window)]
                    }["rows"] ?? []
                }
            }
            add(row, id: text(row, "id"), number: channels.count + 1, source: xtream ? "xtream" : "m3u", programmes: programmes)
        }
        var groups: [String] = []
        for channel in channels { if let name = channel["group"] as? String, !groups.contains(name) { groups.append(name) } }
        return ["now": GuideWindow.iso(window.now), "start": GuideWindow.iso(window.start), "end": GuideWindow.iso(window.end), "groups": groups,
                "channels": channels.filter { group == nil || $0["group"] as? String == group }, "refreshing": !refreshing.isEmpty]
    }
}
