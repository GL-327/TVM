import CoreFoundation
import CryptoKit
import Foundation

// MARK: - Transport

struct SyncHTTPReply {
    let status: Int
    let body: Data
    let etag: String?
    let retryAfter: String?
}

protocol TVMSyncTransport {
    func send(
        method: String,
        url: URL,
        bearer: String?,
        headers: [String: String],
        body: Data?
    ) async throws -> SyncHTTPReply
}

/// Never follow a redirect with a bearer token attached.
private final class TVMSyncNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

struct TVMURLSessionSyncTransport: TVMSyncTransport {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: TVMSyncNoRedirect(), delegateQueue: nil)
    }()

    func send(
        method: String,
        url: URL,
        bearer: String?,
        headers: [String: String],
        body: Data?
    ) async throws -> SyncHTTPReply {
        guard url.scheme == "https" else { throw URLError(.appTransportSecurityRequiresSecureConnection) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("TVM/1.1 (iOS; +https://github.com/GL-327/TVM)", forHTTPHeaderField: "User-Agent")
        if let bearer {
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await TVMURLSessionSyncTransport.session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return SyncHTTPReply(
            status: http.statusCode,
            body: data,
            etag: http.value(forHTTPHeaderField: "ETag"),
            retryAfter: http.value(forHTTPHeaderField: "Retry-After")
        )
    }
}

struct TVMAccountsSyncAdapter: TVMSyncTransport {
    let transport: TVMAccountsTransport

    func send(
        method: String,
        url: URL,
        bearer: String?,
        headers: [String: String],
        body: Data?
    ) async throws -> SyncHTTPReply {
        let reply = try await transport.send(method: method, url: url, bearer: bearer, body: body)
        return SyncHTTPReply(status: reply.status, body: reply.body, etag: nil, retryAfter: nil)
    }
}

// MARK: - Canonical JSON & Hashing

enum TVMSyncCanonical {
    /// Deterministic JSON serializer matching Core's sorted-key JSON.stringify output.
    static func json(_ value: Any?) -> String {
        guard let value, !(value is NSNull) else { return "null" }
        if let num = value as? NSNumber {
            if CFGetTypeID(num) == CFBooleanGetTypeID() {
                return num.boolValue ? "true" : "false"
            }
            return canonicalNumber(num.doubleValue)
        }
        if let boolVal = value as? Bool {
            return boolVal ? "true" : "false"
        }
        if let intVal = value as? Int {
            return String(intVal)
        }
        if let int64Val = value as? Int64 {
            return String(int64Val)
        }
        if let doubleVal = value as? Double {
            return canonicalNumber(doubleVal)
        }
        if let floatVal = value as? Float {
            return canonicalNumber(Double(floatVal))
        }
        if let str = value as? String {
            return canonicalString(str)
        }
        if let array = value as? [Any] {
            return "[" + array.map { json($0) }.joined(separator: ",") + "]"
        }
        if let dict = value as? [String: Any] {
            let sortedKeys = dict.keys.sorted { $0.utf16.lexicographicallyPrecedes($1.utf16) }
            let parts = sortedKeys.map { key in
                "\(canonicalString(key)):\(json(dict[key]))"
            }
            return "{\(parts.joined(separator: ","))}"
        }
        return "null"
    }

    private static func canonicalNumber(_ d: Double) -> String {
        guard d.isFinite else { return "null" }
        if d == 0 { return "0" }
        if d.rounded(.towardZero) == d && abs(d) <= 9_007_199_254_740_991 {
            return String(Int64(d))
        }
        return String(d)
    }

    private static func canonicalString(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar.value {
            case 0x22: out += "\\\""
            case 0x5C: out += "\\\\"
            case 0x08: out += "\\b"
            case 0x0C: out += "\\f"
            case 0x0A: out += "\\n"
            case 0x0D: out += "\\r"
            case 0x09: out += "\\t"
            case 0x00..<0x20:
                out += String(format: "\\u%04x", scalar.value)
            default:
                out.unicodeScalars.append(scalar)
            }
        }
        out += "\""
        return out
    }

    static func valueHash(_ value: Any?) -> String {
        let digest = SHA256.hash(data: Data(json(value).utf8))
        let base64 = Data(digest).base64EncodedString()
        return base64
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func sha256Hex(_ text: String) -> String {
        let digest = SHA256.hash(data: Data(text.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}

// MARK: - Wire Schema

struct TVMSyncItem {
    var kind: String
    var key: String
    var value: Any?
    var updatedAt: Int64
    var deleted: Bool

    var itemId: String { "\(kind):\(key)" }

    func json() -> [String: Any] {
        [
            "kind": kind,
            "key": key,
            "value": value ?? NSNull(),
            "updatedAt": updatedAt,
            "deleted": deleted,
        ]
    }
}

enum TVMSyncSchema {
    static let syncKinds = ["profile", "progress", "watchlist", "preference"]
    static let syncKindsSet = Set(syncKinds)

    static let syncExtras = [
        "onlineSubtitles", "trailers", "trailerBackdrops", "collections", "comingUp", "watchStats",
        "animeTitles", "ratings", "qualityBadges", "versionPicker", "chapters", "seekPreviews",
        "themeSongs", "spoilerBlur", "surpriseMe", "autoCollections", "sleepTimer", "nightMode",
        "pauseOnMinimize", "shortcutsOverlay", "webhook", "announcements", "franchiseIntros",
    ]

    static let syncPrefs: [String] = [
        "subtitleLanguages", "subtitleStyle", "audioLanguage", "skipSegments", "autoplayNext", "homeSections",
    ] + syncExtras.map { "extras.\($0)" }

    static let syncPrefsSet = Set(syncPrefs)
    static let maxValueBytes = 16 * 1024
    static let maxItems = 200
    static let futureMs: Int64 = 5 * 60 * 1000

    private static let forbiddenProfileRegex = try! NSRegularExpression(
        pattern: #"^(con|prn|aux|nul|com[0-9]|lpt[0-9])$"#,
        options: [.caseInsensitive]
    )
    private static let displayForbiddenRegex = try! NSRegularExpression(
        pattern: #"\b(?:bearer\s+|(?:password|api[_ -]?key|(?:rd|session)[_ -]?token)\s*[:=]|https?://)"#,
        options: [.caseInsensitive]
    )
    private static let strictIsoRegex = try! NSRegularExpression(
        pattern: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$"#
    )
    private static let profileIdRegex = try! NSRegularExpression(
        pattern: #"^[0-9a-zA-Z][0-9a-zA-Z_-]{0,79}$"#
    )
    private static let mediaIdRegex = try! NSRegularExpression(
        pattern: #"^[0-9a-zA-Z][0-9a-zA-Z._:-]{0,198}$"#
    )
    private static let artworkRegex = try! NSRegularExpression(
        pattern: #"^https://(?:images\.metahub\.space|live\.metahub\.space|image\.tmdb\.org|(?:[a-z0-9-]+\.)?mzstatic\.com|(?:[a-z0-9-]+\.)?tvmaze\.com|(?:[a-z0-9-]+\.)?kitsu\.io|(?:[a-z0-9-]+\.)?fanart\.tv|m\.media-amazon\.com|image\.tving\.com|artworks\.tvm\.gl)/[a-zA-Z0-9./_%~@-]+$"#
    )
    private static let subtitleLangRegex = try! NSRegularExpression(
        pattern: #"^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$"#
    )
    private static let audioLangRegex = try! NSRegularExpression(
        pattern: #"^(original|[a-z]{3})$"#
    )
    private static let homeSectionIdRegex = try! NSRegularExpression(
        pattern: #"^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$"#
    )
    private static let avatarRegex = try! NSRegularExpression(
        pattern: #"^[a-z0-9-]{1,40}/[a-z0-9-]{1,40}$"#
    )
    private static let pinHashRegex = try! NSRegularExpression(
        pattern: #"^[a-fA-F0-9]{64}$"#
    )
    private static let pinSaltRegex = try! NSRegularExpression(
        pattern: #"^[a-fA-F0-9]{32}$"#
    )

    static func strictBool(_ value: Any?) -> Bool? {
        if let num = value as? NSNumber {
            if CFGetTypeID(num) == CFBooleanGetTypeID() { return num.boolValue }
            return nil
        }
        return value as? Bool
    }

    static func strictNumber(_ value: Any?) -> Double? {
        if value == nil || value is NSNull { return nil }
        if let num = value as? NSNumber {
            if CFGetTypeID(num) == CFBooleanGetTypeID() { return nil }
            let d = num.doubleValue
            return d.isFinite ? d : nil
        }
        if let i = value as? Int { return Double(i) }
        if let i = value as? Int64 { return Double(i) }
        if let d = value as? Double { return d.isFinite ? d : nil }
        if let f = value as? Float {
            let d = Double(f)
            return d.isFinite ? d : nil
        }
        return nil
    }

    static func strictSafeInt(_ value: Any?) -> Int64? {
        guard let d = strictNumber(value),
              d.rounded(.towardZero) == d,
              abs(d) <= 9_007_199_254_740_991 else { return nil }
        return Int64(d)
    }

    private static func matches(_ value: Any?, _ regex: NSRegularExpression) -> String? {
        guard let s = value as? String else { return nil }
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        return regex.firstMatch(in: s, range: range) != nil ? s : nil
    }

    private static func object(_ value: Any?, allowed: Set<String>) -> [String: Any]? {
        guard let dict = value as? [String: Any],
              dict.keys.allSatisfy({ allowed.contains($0) }) else { return nil }
        return dict
    }

    static func displayText(_ value: Any?, required: Bool = false) -> String? {
        guard let s = value as? String else { return nil }
        if required && s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return nil }
        let range = NSRange(s.startIndex..<s.endIndex, in: s)
        if displayForbiddenRegex.firstMatch(in: s, range: range) != nil { return nil }
        return s
    }

    static func parseIsoMs(_ raw: String) -> Int64? {
        guard matches(raw, strictIsoRegex) != nil else { return nil }
        return parseIsoNormalized(raw)
    }

    static func parseIsoMsLenient(_ raw: String) -> Int64? {
        parseIsoNormalized(raw)
    }

    private static func parseIsoNormalized(_ raw: String) -> Int64? {
        if let dot = raw.firstIndex(of: ".") {
            let afterDot = raw.index(after: dot)
            var digitsEnd = afterDot
            while digitsEnd < raw.endIndex && raw[digitsEnd].isASCII && raw[digitsEnd].isNumber {
                digitsEnd = raw.index(after: digitsEnd)
            }
            let frac = raw[afterDot..<digitsEnd]
            let padded = String((frac + "000").prefix(3))
            let normalized = String(raw[..<dot]) + "." + padded + String(raw[digitsEnd...])
            let fmt = ISO8601DateFormatter()
            fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            guard let date = fmt.date(from: normalized) else { return nil }
            return Int64((date.timeIntervalSince1970 * 1000.0).rounded())
        } else {
            let fmt = ISO8601DateFormatter()
            fmt.formatOptions = [.withInternetDateTime]
            guard let date = fmt.date(from: raw) else { return nil }
            return Int64((date.timeIntervalSince1970 * 1000.0).rounded())
        }
    }

    static func formatIsoMs(_ ms: Int64) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.timeZone = TimeZone(secondsFromGMT: 0)
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fmt.string(from: Date(timeIntervalSince1970: Double(ms) / 1000.0))
    }

    static func isoTimestamp(_ raw: String?, fallbackMs: Int64) -> String {
        if let raw, parseIsoMs(raw) != nil { return raw }
        if let raw, let parsed = parseIsoMsLenient(raw) { return formatIsoMs(parsed) }
        return formatIsoMs(fallbackMs)
    }

    static func time(_ value: Any?) -> Bool {
        guard let s = value as? String else { return false }
        return parseIsoMs(s) != nil
    }

    static func profileId(_ value: Any?) -> Bool {
        guard let s = matches(value, profileIdRegex) else { return false }
        return matches(s, forbiddenProfileRegex) == nil
    }

    static func mediaId(_ value: Any?) -> Bool {
        matches(value, mediaIdRegex) != nil
    }

    static func safeArtwork(_ value: Any?) -> Bool {
        if let s = value as? String, s.isEmpty { return true }
        return matches(value, artworkRegex) != nil
    }

    static func publicSyncArtwork(_ value: String) -> String {
        safeArtwork(value) ? value : ""
    }

    static func preference(key: String, value: Any?) -> Bool {
        switch key {
        case "subtitleLanguages":
            guard let arr = value as? [Any], arr.count <= 20 else { return false }
            return arr.allSatisfy { matches($0, subtitleLangRegex) != nil }
        case "audioLanguage":
            return matches(value, audioLangRegex) != nil
        case "skipSegments":
            guard let s = value as? String else { return false }
            return s == "off" || s == "button" || s == "auto"
        case "autoplayNext":
            return strictBool(value) != nil
        case "subtitleStyle":
            guard let obj = object(value, allowed: ["size", "color", "background"]),
                  let size = obj["size"] as? String, ["s", "m", "l", "xl"].contains(size),
                  let color = obj["color"] as? String, ["white", "yellow", "cyan"].contains(color),
                  let bg = obj["background"] as? String, ["shadow", "box", "none"].contains(bg) else { return false }
            return true
        case "homeSections":
            guard let arr = value as? [Any], arr.count <= 100 else { return false }
            return arr.allSatisfy { row in
                guard let obj = object(row, allowed: ["id", "visible"]),
                      matches(obj["id"], homeSectionIdRegex) != nil,
                      strictBool(obj["visible"]) != nil else { return false }
                return true
            }
        default:
            return syncPrefsSet.contains(key) && strictBool(value) != nil
        }
    }

    static func validSyncKey(kind: String, key: Any?) -> String? {
        guard let k = key as? String, k.utf16.count >= 1, k.utf16.count <= 200 else { return nil }
        if kind == "profile" { return profileId(k) ? k : nil }
        if kind == "preference" { return syncPrefsSet.contains(k) ? k : nil }
        guard let slash = k.firstIndex(of: "/"), slash > k.startIndex else { return nil }
        let p = String(k[..<slash])
        let m = String(k[k.index(after: slash)...])
        return profileId(p) && mediaId(m) ? k : nil
    }

    static func validValue(kind: String, key: String, value: Any?) -> Bool {
        if kind == "preference" {
            return preference(key: key, value: value)
        }
        if kind == "profile" {
            guard let obj = object(value, allowed: ["id", "name", "hue", "created", "avatar", "kind", "maxAge", "pin"]),
                  (obj["id"] as? String) == key,
                  let name = displayText(obj["name"], required: true), name.utf16.count <= 40,
                  let hue = strictNumber(obj["hue"]), hue >= 0, hue < 360,
                  time(obj["created"]),
                  let pKind = obj["kind"] as? String, (pKind == "standard" || pKind == "kids"),
                  let maxAge = strictSafeInt(obj["maxAge"]), [7, 12, 15, 18].contains(maxAge) else { return false }
            if let avatar = obj["avatar"], !(avatar is NSNull) {
                guard matches(avatar, avatarRegex) != nil else { return false }
            }
            if let pin = obj["pin"], !(pin is NSNull) {
                guard let pinObj = object(pin, allowed: ["hash", "salt", "iter"]),
                      matches(pinObj["hash"], pinHashRegex) != nil,
                      matches(pinObj["salt"], pinSaltRegex) != nil,
                      strictSafeInt(pinObj["iter"]) == 20_000 else { return false }
            }
            return true
        }
        if kind == "progress" {
            guard let obj = object(value, allowed: [
                "position", "duration", "updated", "hiddenFromContinueWatching",
                "completedAt", "completions", "completedTitle", "completedYear",
            ]),
                let pos = strictNumber(obj["position"]), pos >= 0,
                let dur = strictNumber(obj["duration"]), dur >= 0,
                time(obj["updated"]) else { return false }
            if let hidden = obj["hiddenFromContinueWatching"], strictBool(hidden) == nil { return false }
            if let completedAt = obj["completedAt"], !time(completedAt) { return false }
            if let completions = obj["completions"] {
                guard let c = strictSafeInt(completions), c >= 0 else { return false }
            }
            if let title = obj["completedTitle"], displayText(title) == nil { return false }
            if let year = obj["completedYear"], !(year is NSNull), strictNumber(year) == nil { return false }
            return true
        }
        if kind == "watchlist" {
            guard let slash = key.firstIndex(of: "/"),
                  let obj = object(value, allowed: [
                      "id", "title", "year", "kind", "synopsis", "poster",
                      "backdrop", "genres", "rating", "playable", "hue", "added",
                  ]) else { return false }
            let expectedId = String(key[key.index(after: slash)...])
            guard (obj["id"] as? String) == expectedId,
                  displayText(obj["title"], required: true) != nil,
                  let yearVal = obj["year"], (yearVal is NSNull || strictNumber(yearVal) != nil),
                  let wKind = obj["kind"] as? String, ["movie", "series", "file"].contains(wKind),
                  displayText(obj["synopsis"]) != nil,
                  safeArtwork(obj["poster"]),
                  safeArtwork(obj["backdrop"]),
                  let genres = obj["genres"] as? [Any], genres.allSatisfy({ displayText($0) != nil }),
                  displayText(obj["rating"]) != nil,
                  strictBool(obj["playable"]) != nil,
                  strictNumber(obj["hue"]) != nil,
                  time(obj["added"]) else { return false }
            return true
        }
        return false
    }

    static func parseSyncItem(_ raw: [String: Any], nowMs: Int64) -> TVMSyncItem? {
        guard let obj = object(raw, allowed: ["kind", "key", "value", "updatedAt", "deleted"]),
              let kind = obj["kind"] as? String, syncKindsSet.contains(kind),
              let key = validSyncKey(kind: kind, key: obj["key"]),
              let updatedAt = strictSafeInt(obj["updatedAt"]),
              updatedAt >= 0, updatedAt <= nowMs + futureMs else { return nil }
        let deletedRaw = obj["deleted"]
        var deleted = false
        if let deletedRaw {
            guard let b = strictBool(deletedRaw) else { return nil }
            deleted = b
        }
        if deleted {
            let val = obj["value"]
            guard val == nil || val is NSNull else { return nil }
            return TVMSyncItem(kind: kind, key: key, value: nil, updatedAt: updatedAt, deleted: true)
        }
        guard let val = obj["value"], !(val is NSNull), validValue(kind: kind, key: key, value: val) else {
            return nil
        }
        return TVMSyncItem(kind: kind, key: key, value: val, updatedAt: updatedAt, deleted: false)
    }

    static func syncValueBytes(_ value: Any?) -> Int {
        Data(TVMSyncCanonical.json(value).utf8).count
    }
}

// MARK: - Merge & Ledger

struct TVMSyncVersion {
    var updatedAt: Int64
    var hash: String?
}

struct TVMSnapshotItem {
    let item: TVMSyncItem
    let hash: String
    let changedAt: Int64
}

struct TVMSyncLedger {
    var versions: [String: TVMSyncVersion] = [:]
    var pending: [String: TVMSyncItem] = [:]
}

enum TVMSyncMerge {
    /// A missing local row becomes a tombstone only once this device has actually seen it.
    @discardableResult
    static func observeLocal(
        _ ledger: inout TVMSyncLedger,
        local: [String: TVMSnapshotItem],
        nowMs: Int64
    ) -> Bool {
        var changed = false
        for (id, row) in local {
            let prior = ledger.versions[id]
            if prior?.hash == row.hash { continue }
            let updatedAt = prior != nil
                ? max(prior!.updatedAt + 1, min(row.changedAt, nowMs))
                : row.item.updatedAt
            ledger.versions[id] = TVMSyncVersion(updatedAt: updatedAt, hash: row.hash)
            var nextItem = row.item
            nextItem.updatedAt = updatedAt
            ledger.pending[id] = nextItem
            changed = true
        }
        for (id, version) in ledger.versions {
            if version.hash == nil || local[id] != nil { continue }
            guard let split = id.firstIndex(of: ":") else { continue }
            let kind = String(id[..<split])
            let key = String(id[id.index(after: split)...])
            let updatedAt = max(nowMs, version.updatedAt + 1)
            ledger.versions[id] = TVMSyncVersion(updatedAt: updatedAt, hash: nil)
            ledger.pending[id] = TVMSyncItem(kind: kind, key: key, value: nil, updatedAt: updatedAt, deleted: true)
            changed = true
        }
        return changed
    }

    static func mergeRemote(_ ledger: inout TVMSyncLedger, incoming: [TVMSyncItem]) -> [TVMSyncItem] {
        var changes: [TVMSyncItem] = []
        for item in incoming {
            let id = item.itemId
            let prior = ledger.versions[id]
            if let prior, prior.updatedAt > item.updatedAt { continue }
            let hash: String? = item.deleted ? nil : TVMSyncCanonical.valueHash(item.value)
            // On a tie the server's first accepted value is authoritative.
            ledger.pending.removeValue(forKey: id)
            ledger.versions[id] = TVMSyncVersion(updatedAt: item.updatedAt, hash: hash)
            if prior == nil || prior?.hash != hash {
                changes.append(item)
            }
        }
        return changes
    }
}

// MARK: - Store Snapshot & Application

enum TVMSyncStores {
    private static let fm = FileManager.default

    static func untouchedProfile(_ row: ProfileRecord) -> Bool {
        row.name == "Profile 1" && row.hue == 221 && row.avatar == nil && row.pin == nil
            && row.kind == "standard" && row.maxAge == 18
    }

    private static func modifiedMs(_ url: URL) -> Int64 {
        guard let attrs = try? fm.attributesOfItem(atPath: url.path),
              let date = attrs[.modificationDate] as? Date else { return 0 }
        return max(0, Int64(date.timeIntervalSince1970 * 1000.0))
    }

    static func initializeStores(directory: URL, store: TVMStore, legacy: URL?) {
        store.withStoreLock {
            guard let legacy else {
                _ = store.profiles(in: directory)
                return
            }
            let registry = store.profiles(in: legacy)
            store.writeProfiles(activeId: registry.activeId, profiles: registry.profiles, in: directory)
            for profile in registry.profiles where TVMSyncSchema.profileId(profile.id) {
                let from = store.profileDir(profile.id, in: legacy)
                let to = store.profileDir(profile.id, in: directory)
                let progress = store.progress(for: profile.id, in: legacy)
                if !progress.isEmpty {
                    store.writeProgressMap(progress, profileId: profile.id, in: directory)
                }
                let watchlist = store.watchlist(for: profile.id, in: legacy)
                if !watchlist.isEmpty {
                    store.writeWatchlistItems(watchlist, profileId: profile.id, in: directory)
                }
                for filename in ["services.json", "recent-media.json", "finished-notebook.json", "extras-history.json"] {
                    let src = from.appendingPathComponent(filename)
                    if fm.fileExists(atPath: src.path) {
                        try? fm.createDirectory(at: to, withIntermediateDirectories: true)
                        let dst = to.appendingPathComponent(filename)
                        try? fm.removeItem(at: dst)
                        try? fm.copyItem(at: src, to: dst)
                    }
                }
            }
            let device = TVMPrefs.loadDevice(store)
            let values = device.syncValues()
            let defaults = TVMPrefs().syncValues()
            var chosen: [String: Any] = [:]
            for (key, value) in values {
                if TVMSyncCanonical.json(value) != TVMSyncCanonical.json(defaults[key]) {
                    chosen[key] = value
                }
            }
            if !chosen.isEmpty {
                TVMPrefs.writeSyncPrefs(chosen, in: directory)
            }
        }
    }

    static func snapshot(
        directory: URL,
        store: TVMStore,
        nowMs: Int64,
        legacy: URL? = nil,
        knownProfiles: Set<String> = []
    ) -> [String: TVMSnapshotItem] {
        store.withStoreLock {
            var result: [String: TVMSnapshotItem] = [:]
            let registry = store.profiles(in: directory)
            var mediaProfiles = Set<String>()

            func add(kind: String, key: String, value: Any?, initial: Int64, changedAt: Int64) {
                let clamped = max(0, min(initial, nowMs))
                let raw: [String: Any] = [
                    "kind": kind,
                    "key": key,
                    "value": value ?? NSNull(),
                    "updatedAt": clamped,
                ]
                guard let item = TVMSyncSchema.parseSyncItem(raw, nowMs: nowMs),
                      TVMSyncSchema.syncValueBytes(value) <= TVMSyncSchema.maxValueBytes else { return }
                result[item.itemId] = TVMSnapshotItem(item: item, hash: TVMSyncCanonical.valueHash(value), changedAt: changedAt)
                if (kind == "progress" || kind == "watchlist"), let slash = key.firstIndex(of: "/") {
                    mediaProfiles.insert(String(key[..<slash]))
                }
            }

            let profilesRoot = directory.appendingPathComponent("profiles", isDirectory: true)
            if let children = try? fm.contentsOfDirectory(
                at: profilesRoot,
                includingPropertiesForKeys: [.isDirectoryKey],
                options: [.skipsHiddenFiles]
            ) {
                for child in children {
                    let isDir = (try? child.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
                    let dirName = child.lastPathComponent
                    guard isDir, TVMSyncSchema.profileId(dirName) else { continue }
                    let scope = store.profileDir(dirName, in: directory)

                    let progressTime = modifiedMs(scope.appendingPathComponent("progress.json"))
                    for (id, entry) in store.progress(for: dirName, in: directory) {
                        let updated = TVMSyncSchema.parseIsoMsLenient(entry.updated) ?? progressTime
                        var value: [String: Any] = [
                            "position": entry.position,
                            "duration": entry.duration,
                            "updated": TVMSyncSchema.isoTimestamp(entry.updated, fallbackMs: updated),
                        ]
                        if entry.syncPresentKeys.isEmpty {
                            value["completions"] = entry.completions
                            if entry.hiddenFromContinueWatching { value["hiddenFromContinueWatching"] = true }
                        } else {
                            if entry.syncPresentKeys.contains("hiddenFromContinueWatching") || entry.hiddenFromContinueWatching {
                                value["hiddenFromContinueWatching"] = entry.hiddenFromContinueWatching
                            }
                            if entry.syncPresentKeys.contains("completions") || entry.completions != 0 {
                                value["completions"] = entry.completions
                            }
                        }
                        if let completedAt = entry.completedAt {
                            value["completedAt"] = TVMSyncSchema.isoTimestamp(completedAt, fallbackMs: updated)
                        }
                        if let completedTitle = entry.completedTitle {
                            value["completedTitle"] = completedTitle
                        }
                        if let completedYear = entry.completedYear {
                            value["completedYear"] = completedYear
                        } else if entry.syncPresentKeys.contains("completedYear") {
                            value["completedYear"] = NSNull()
                        }
                        add(kind: "progress", key: "\(dirName)/\(id)", value: value, initial: updated, changedAt: updated)
                    }

                    let watchlistTime = modifiedMs(scope.appendingPathComponent("watchlist.json"))
                    for entry in store.watchlist(for: dirName, in: directory) {
                        let added = (entry.added.flatMap { TVMSyncSchema.parseIsoMsLenient($0) }) ?? watchlistTime
                        let value: [String: Any] = [
                            "id": entry.id,
                            "title": entry.title,
                            "year": JSONValue.orNull(entry.year),
                            "kind": entry.kind,
                            "synopsis": entry.synopsis,
                            "poster": TVMSyncSchema.publicSyncArtwork(entry.poster),
                            "backdrop": TVMSyncSchema.publicSyncArtwork(entry.backdrop),
                            "genres": entry.genres,
                            "rating": entry.rating,
                            "playable": entry.playable,
                            "hue": entry.hue,
                            "added": TVMSyncSchema.isoTimestamp(entry.added, fallbackMs: added),
                        ]
                        add(kind: "watchlist", key: "\(dirName)/\(entry.id)", value: value, initial: added, changedAt: added)
                    }
                }
            }

            let profileTime = modifiedMs(directory.appendingPathComponent("profiles.json"))
            let legacyProfileTime = legacy.map { modifiedMs($0.appendingPathComponent("profiles.json")) } ?? profileTime
            for row in registry.profiles {
                let untouched = untouchedProfile(row)
                if untouched && !mediaProfiles.contains(row.id) && !knownProfiles.contains(row.id) { continue }
                let pinValue: Any = row.pin.map { ["hash": $0.hash, "salt": $0.salt, "iter": $0.iter] as Any } ?? NSNull()
                let value: [String: Any] = [
                    "id": row.id,
                    "name": row.name,
                    "hue": row.hue,
                    "created": TVMSyncSchema.isoTimestamp(row.created, fallbackMs: profileTime),
                    "avatar": JSONValue.orNull(row.avatar),
                    "kind": row.kind,
                    "maxAge": row.maxAge,
                    "pin": pinValue,
                ]
                add(kind: "profile", key: row.id, value: value, initial: untouched ? 0 : legacyProfileTime, changedAt: profileTime)
            }

            let preferenceTime = modifiedMs(directory.appendingPathComponent("sync-prefs.json"))
            let legacyPreferenceTime = legacy.map { modifiedMs($0.appendingPathComponent("prefs.json")) } ?? preferenceTime
            for (key, value) in TVMPrefs.readSyncPrefs(in: directory) {
                add(kind: "preference", key: key, value: value, initial: legacyPreferenceTime, changedAt: preferenceTime)
            }
            return result
        }
    }

    static func applyItems(
        directory: URL,
        store: TVMStore,
        items: [TVMSyncItem],
        reloadProfiles: () -> Void
    ) {
        var groups: [String: [TVMSyncItem]] = [:]
        var groupOrder: [String] = []
        for item in items {
            let groupKey: String
            if (item.kind == "progress" || item.kind == "watchlist"), let slash = item.key.firstIndex(of: "/") {
                groupKey = "\(item.kind):\(item.key[..<slash])"
            } else {
                groupKey = item.kind
            }
            if groups[groupKey] == nil { groupOrder.append(groupKey) }
            groups[groupKey, default: []].append(item)
        }

        store.withSyncSuppressed {
            let shouldReload: Bool = store.withStoreLock {
                var didReloadProfiles = false
                for key in groupOrder {
                    guard let group = groups[key], let kind = group.first?.kind else { continue }
                    if kind == "profile" {
                        let registry = store.profiles(in: directory)
                        var rows: [String: ProfileRecord] = Dictionary(uniqueKeysWithValues: registry.profiles.map { ($0.id, $0) })
                        for item in group {
                            if item.deleted {
                                rows.removeValue(forKey: item.key)
                            } else if let obj = item.value as? [String: Any], let parsed = parseProfileRecord(obj) {
                                rows[item.key] = parsed
                            }
                        }
                        if rows.count > 1, registry.profiles.count == 1, let previous = registry.profiles.first,
                           untouchedProfile(previous),
                           !group.contains(where: { $0.key == previous.id }),
                           store.progress(for: previous.id, in: directory).isEmpty,
                           store.watchlist(for: previous.id, in: directory).isEmpty {
                            rows.removeValue(forKey: previous.id)
                        }
                        var profiles = rows.values.sorted {
                            if $0.created != $1.created { return $0.created < $1.created }
                            return $0.id < $1.id
                        }
                        if profiles.isEmpty {
                            profiles.append(ProfileRecord(
                                id: "profile-\(UUID().uuidString)",
                                name: "Profile 1",
                                hue: 221,
                                created: TVMSyncSchema.formatIsoMs(Int64(Date().timeIntervalSince1970 * 1000.0))
                            ))
                        }
                        let activeId = profiles.contains(where: { $0.id == registry.activeId })
                            ? registry.activeId
                            : (profiles.first(where: { $0.pin == nil }) ?? profiles[0]).id
                        store.writeProfiles(activeId: activeId, profiles: profiles, in: directory)
                        didReloadProfiles = true
                    } else if kind == "preference" {
                        var prefs = TVMPrefs.readSyncPrefs(in: directory)
                        for item in group {
                            if item.deleted {
                                prefs.removeValue(forKey: item.key)
                            } else if let val = item.value {
                                prefs[item.key] = val
                            }
                        }
                        TVMPrefs.writeSyncPrefs(prefs, in: directory)
                    } else {
                        guard let colon = key.firstIndex(of: ":") else { continue }
                        let profileId = String(key[key.index(after: colon)...])
                        if kind == "progress" {
                            var progress = store.progress(for: profileId, in: directory)
                            for item in group {
                                guard let slash = item.key.firstIndex(of: "/") else { continue }
                                let id = String(item.key[item.key.index(after: slash)...])
                                if item.deleted {
                                    progress.removeValue(forKey: id)
                                } else if let obj = item.value as? [String: Any], let entry = parseProgressEntry(obj) {
                                    progress[id] = entry
                                }
                            }
                            store.writeProgressMap(progress, profileId: profileId, in: directory)
                        } else {
                            var watchlist: [String: MediaItem] = Dictionary(
                                uniqueKeysWithValues: store.watchlist(for: profileId, in: directory).map { ($0.id, $0) }
                            )
                            for item in group {
                                guard let slash = item.key.firstIndex(of: "/") else { continue }
                                let id = String(item.key[item.key.index(after: slash)...])
                                if item.deleted {
                                    watchlist.removeValue(forKey: id)
                                } else if let media = MediaItem.parse(item.value) {
                                    watchlist[id] = media
                                }
                            }
                            let ordered = watchlist.values.sorted { a, b in
                                let da = a.added.flatMap { TVMSyncSchema.parseIsoMsLenient($0) } ?? 0
                                let db = b.added.flatMap { TVMSyncSchema.parseIsoMsLenient($0) } ?? 0
                                if da != db { return da > db }
                                return a.id < b.id
                            }
                            store.writeWatchlistItems(ordered, profileId: profileId, in: directory)
                        }
                    }
                }
                return didReloadProfiles
            }
            if shouldReload { reloadProfiles() }
        }
    }

    private static func parseProfileRecord(_ obj: [String: Any]) -> ProfileRecord? {
        guard let id = obj["id"] as? String,
              let name = obj["name"] as? String,
              let created = obj["created"] as? String,
              let hue = TVMSyncSchema.strictSafeInt(obj["hue"]) else { return nil }
        let kind = (obj["kind"] as? String) == "kids" ? "kids" : "standard"
        let maxAge = TVMParental.normalizeAge(obj["maxAge"], kind: kind) ?? TVMParental.defaultAge(kind: kind)
        let avatar = (obj["avatar"] as? String).flatMap { TVMPins.isValidAvatar($0) ? $0 : nil }
        var pin: ProfilePin?
        if let pinObj = obj["pin"] as? [String: Any],
           let hash = pinObj["hash"] as? String,
           let salt = pinObj["salt"] as? String,
           let iter = TVMSyncSchema.strictSafeInt(pinObj["iter"]) {
            pin = ProfilePin(hash: hash, salt: salt, iter: Int(iter))
        }
        return ProfileRecord(
            id: id,
            name: name,
            hue: Int(hue),
            created: created,
            avatar: avatar,
            kind: kind,
            maxAge: maxAge,
            pin: pin
        )
    }

    private static func parseProgressEntry(_ obj: [String: Any]) -> ProgressEntry? {
        guard let position = TVMSyncSchema.strictNumber(obj["position"]),
              let duration = TVMSyncSchema.strictNumber(obj["duration"]),
              let updated = obj["updated"] as? String else { return nil }
        return ProgressEntry(
            position: position,
            duration: duration,
            updated: updated,
            hiddenFromContinueWatching: TVMSyncSchema.strictBool(obj["hiddenFromContinueWatching"]) == true,
            completedAt: obj["completedAt"] as? String,
            completions: Int(TVMSyncSchema.strictSafeInt(obj["completions"]) ?? 0),
            completedTitle: obj["completedTitle"] as? String,
            completedYear: TVMSyncSchema.strictSafeInt(obj["completedYear"]).map { Int($0) },
            syncPresentKeys: Set(obj.keys)
        )
    }
}

// MARK: - Sync Engine

struct TVMSyncStatus: Equatable {
    let enabled: Bool
    let lastSyncAt: Int64?
    let pending: Int
    let error: String?

    static let disabled = TVMSyncStatus(enabled: false, lastSyncAt: nil, pending: 0, error: nil)

    func json() -> [String: Any] {
        [
            "enabled": enabled,
            "lastSyncAt": JSONValue.orNull(lastSyncAt),
            "pending": pending,
            "error": JSONValue.orNull(error),
        ]
    }
}

private struct SyncHTTPFailure: Error {
    let status: Int
    let retryAfter: String?
    init(status: Int, retryAfter: String? = nil) {
        self.status = status
        self.retryAfter = retryAfter
    }
}

final class TVMSyncEngine {
    static let pullMs: Int64 = 60_000
    static let debounceMs: Int64 = 3_000
    static let backoffMaxMs: Int64 = 5 * 60_000
    static let maxPages = 201

    private static let etagRegex = try! NSRegularExpression(pattern: #"^"[0-9]+"$"#)

    private struct Checkpoint {
        var versions: [String: TVMSyncVersion]
        var pending: [String: TVMSyncItem]
        var since: Int64
        var generation: String?
        var lastSyncAt: Int64?
    }

    private struct StagedApplication {
        var items: [TVMSyncItem]
        var checkpoint: Checkpoint
    }

    private struct State {
        var checkpoint: Checkpoint
        var applying: StagedApplication?
    }

    let directory: URL
    private let store: TVMStore
    private let origin: String
    private let transport: TVMSyncTransport
    private let reloadProfiles: () -> Void
    private let sessionRejected: (String) -> Void
    private let nowMs: () -> Int64
    private let debounceIntervalMs: Int64
    private let ledgerURL: URL

    private let lock = NSLock()
    private var state: State
    private var token: String?
    private var generation: UInt64 = 0
    private var activeJob: Task<Void, Never>?
    private var timerTask: Task<Void, Never>?
    private var disabled = false
    private var stopped = false
    private var dirty = true
    private var legacy: URL?
    private var changeDue: Int64?
    private var pullDue: Int64?
    private var retryAt: Int64 = 0
    private var failures = 0
    private var error: String?

    init(
        directory: URL,
        store: TVMStore,
        origin: String,
        legacy: URL? = nil,
        transport: TVMSyncTransport,
        reloadProfiles: @escaping () -> Void,
        sessionRejected: @escaping (String) -> Void,
        nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000.0) },
        debounceMs: Int64 = TVMSyncEngine.debounceMs
    ) {
        self.directory = directory
        self.store = store
        self.origin = origin
        self.transport = transport
        self.reloadProfiles = reloadProfiles
        self.sessionRejected = sessionRejected
        self.nowMs = nowMs
        self.debounceIntervalMs = debounceMs
        self.ledgerURL = directory.appendingPathComponent("ledger.json")
        let loaded = Self.readLedger(from: ledgerURL) ?? State(
            checkpoint: Checkpoint(versions: [:], pending: [:], since: 0, generation: nil, lastSyncAt: nil),
            applying: nil
        )
        self.state = loaded
        if loaded.checkpoint.generation == nil && loaded.checkpoint.versions.isEmpty {
            self.legacy = legacy
        }
    }

    func attach(_ session: String, signingIn: Bool = false) {
        lock.lock()
        if session == token && !signingIn {
            lock.unlock()
            return
        }
        token = session
        generation &+= 1
        captureLocked()
        if signingIn {
            disabled = false
            failures = 0
            retryAt = 0
            error = nil
        }
        pullDue = nowMs()
        scheduleLocked()
        lock.unlock()
    }

    func detach(_ session: String) {
        lock.lock()
        guard token == session else {
            lock.unlock()
            return
        }
        token = nil
        generation &+= 1
        timerTask?.cancel()
        timerTask = nil
        lock.unlock()
    }

    func notifyLocalChange() {
        lock.lock()
        guard !stopped, !disabled, token != nil else {
            lock.unlock()
            return
        }
        dirty = true
        changeDue = nowMs() + debounceIntervalMs
        scheduleLocked()
        lock.unlock()
    }

    func onForeground() {
        lock.lock()
        guard !stopped, !disabled, token != nil else {
            lock.unlock()
            return
        }
        pullDue = nowMs()
        scheduleLocked()
        lock.unlock()
    }

    func status() -> TVMSyncStatus {
        lock.lock()
        defer { lock.unlock() }
        guard token != nil, !disabled, !stopped else { return .disabled }
        captureLocked()
        return TVMSyncStatus(
            enabled: true,
            lastSyncAt: state.checkpoint.lastSyncAt,
            pending: state.checkpoint.pending.count,
            error: error
        )
    }

    func syncNow() async -> TVMSyncStatus {
        await run(force: true)
        return status()
    }

    func close() {
        lock.lock()
        stopped = true
        token = nil
        generation &+= 1
        timerTask?.cancel()
        timerTask = nil
        lock.unlock()
    }

    // MARK: - Locked Helpers

    private func saveLocked(_ next: State) {
        Self.writeLedger(next, to: ledgerURL)
        state = next
    }

    private func finishApplicationLocked() {
        guard let staged = state.applying else { return }
        TVMSyncStores.applyItems(
            directory: directory,
            store: store,
            items: staged.items,
            reloadProfiles: reloadProfiles
        )
        saveLocked(State(checkpoint: staged.checkpoint, applying: nil))
    }

    private func captureLocked() {
        finishApplicationLocked()
        guard dirty else { return }
        let current = nowMs()
        let known = Set(state.checkpoint.versions.compactMap { id, version -> String? in
            guard id.hasPrefix("profile:"), version.hash != nil else { return nil }
            return String(id.dropFirst("profile:".count))
        })
        let local = TVMSyncStores.snapshot(
            directory: directory,
            store: store,
            nowMs: current,
            legacy: legacy,
            knownProfiles: known
        )
        var ledger = TVMSyncLedger(versions: state.checkpoint.versions, pending: state.checkpoint.pending)
        if TVMSyncMerge.observeLocal(&ledger, local: local, nowMs: current) {
            var next = state
            next.checkpoint.versions = ledger.versions
            next.checkpoint.pending = ledger.pending
            saveLocked(next)
        }
        legacy = nil
        dirty = false
    }

    private func nextScheduleTimeLocked() -> Int64? {
        if stopped || disabled || token == nil || activeJob != nil { return nil }
        let earliest: Int64?
        switch (changeDue, pullDue) {
        case (let c?, let p?): earliest = min(c, p)
        case (let c?, nil): earliest = c
        case (nil, let p?): earliest = p
        case (nil, nil): earliest = nil
        }
        guard let earliest else { return nil }
        return max(retryAt, earliest)
    }

    private func scheduleLocked() {
        timerTask?.cancel()
        timerTask = nil
        guard let at = nextScheduleTimeLocked() else { return }
        let delayMs = max(0, at - nowMs())
        timerTask = Task { [weak self] in
            if delayMs > 0 {
                try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
            }
            guard !Task.isCancelled else { return }
            await self?.run(force: false)
        }
    }

    // MARK: - Sync Cycle

    private func run(force: Bool) async {
        lock.lock()
        guard let session = token, !disabled, !stopped else {
            lock.unlock()
            return
        }
        if let existing = activeJob {
            lock.unlock()
            await existing.value
            if force {
                lock.lock()
                let now = nowMs()
                let needsRetry = !stopped && !disabled && token != nil &&
                    ((pullDue != nil && pullDue! <= now) || dirty || !state.checkpoint.pending.isEmpty)
                lock.unlock()
                if needsRetry {
                    await run(force: true)
                }
            }
            return
        }
        if !force && nowMs() < retryAt {
            scheduleLocked()
            lock.unlock()
            return
        }
        if !force {
            let now = nowMs()
            let changeReady = changeDue.map { $0 <= now } ?? false
            let pullReady = pullDue.map { $0 <= now } ?? false
            if !changeReady && !pullReady {
                scheduleLocked()
                lock.unlock()
                return
            }
        }

        timerTask?.cancel()
        timerTask = nil
        let epoch = generation
        let task = Task<Void, Never> { [weak self] in
            guard let self else { return }
            await self.executeRun(session: session, epoch: epoch, force: force)
        }
        activeJob = task
        lock.unlock()
        await task.value
    }

    private func isCurrent(_ epoch: UInt64) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return !stopped && generation == epoch
    }

    private func executeRun(session: String, epoch: UInt64, force: Bool) async {
        var rejectedSession: String?
        do {
            lock.lock()
            guard !stopped, generation == epoch else {
                lock.unlock()
                finishJob(rejectedSession: nil)
                return
            }
            captureLocked()
            lock.unlock()

            try await pull(session: session, epoch: epoch)
            lock.lock()
            guard !stopped, generation == epoch else {
                lock.unlock()
                finishJob(rejectedSession: nil)
                return
            }
            captureLocked()
            if let due = changeDue, due <= nowMs() { changeDue = nil }
            let shouldPush = force || changeDue == nil
            let queue = shouldPush ? Array(state.checkpoint.pending.values) : []
            lock.unlock()

            if !queue.isEmpty {
                var offset = 0
                while offset < queue.count {
                    let end = min(queue.count, offset + TVMSyncSchema.maxItems)
                    let batch = Array(queue[offset..<end])
                    lock.lock()
                    guard !stopped, generation == epoch else {
                        lock.unlock()
                        finishJob(rejectedSession: nil)
                        return
                    }
                    let match = state.checkpoint.generation
                    lock.unlock()
                    guard let match else { throw SyncHTTPFailure(status: 503) }
                    try await putSyncItems(session: session, items: batch, generation: match)
                    lock.lock()
                    guard !stopped, generation == epoch else {
                        lock.unlock()
                        finishJob(rejectedSession: nil)
                        return
                    }
                    captureLocked()
                    var next = state
                    for item in batch {
                        let key = item.itemId
                        if next.checkpoint.pending[key]?.updatedAt == item.updatedAt {
                            next.checkpoint.pending.removeValue(forKey: key)
                        }
                    }
                    saveLocked(next)
                    lock.unlock()
                    offset = end
                }
                // Read back the authoritative winners, including another client racing with this upload.
                try await pull(session: session, epoch: epoch)
            }

            lock.lock()
            guard !stopped, generation == epoch else {
                lock.unlock()
                finishJob(rejectedSession: nil)
                return
            }
            let at = nowMs()
            if let due = changeDue, due <= at, !dirty, state.checkpoint.pending.isEmpty {
                changeDue = nil
            }
            var next = state
            next.checkpoint.lastSyncAt = at
            saveLocked(next)
            pullDue = at + Self.pullMs
            failures = 0
            retryAt = 0
            error = nil
            lock.unlock()
        } catch let failure as SyncHTTPFailure {
            lock.lock()
            if !stopped && generation == epoch {
                if failure.status == 404 {
                    disabled = true
                    error = nil
                } else if failure.status == 401 {
                    rejectedSession = session
                } else {
                    let seconds = failure.retryAfter.flatMap { Double($0.trimmingCharacters(in: .whitespaces)) } ?? 0
                    let shift = min(6, failures)
                    failures += 1
                    let delay = min(Self.backoffMaxMs, Int64(5_000) << shift)
                    let retryMs = (seconds.isFinite && seconds > 0) ? Int64(seconds * 1000.0) : 0
                    let now = nowMs()
                    retryAt = now + max(delay, retryMs)
                    pullDue = min(pullDue ?? now, now)
                    error = failure.status == 409 ? "Synced data is full." : "Account data could not sync."
                }
            }
            lock.unlock()
        } catch {
            lock.lock()
            if !stopped && generation == epoch {
                let shift = min(6, failures)
                failures += 1
                let delay = min(Self.backoffMaxMs, Int64(5_000) << shift)
                let now = nowMs()
                retryAt = now + delay
                pullDue = min(pullDue ?? now, now)
                self.error = "Account data could not sync."
            }
            lock.unlock()
        }

        finishJob(rejectedSession: rejectedSession)
    }

    private func finishJob(rejectedSession: String?) {
        lock.lock()
        activeJob = nil
        if rejectedSession == nil {
            scheduleLocked()
        }
        lock.unlock()
        if let rejectedSession {
            sessionRejected(rejectedSession)
        }
    }

    private func pull(session: String, epoch: UInt64) async throws {
        lock.lock()
        var match = state.checkpoint.generation
        var since = state.checkpoint.since
        lock.unlock()

        var reset = false
        var incoming: [String: TVMSyncItem] = [:]
        var cursor: String? = nil
        var watermark: Int64? = nil
        var more = true

        for _ in 0..<Self.maxPages where more {
            var components = URLComponents(string: origin + "/v1/me/data")
            var queryItems = [URLQueryItem(name: "since", value: String(since))]
            if let cursor {
                queryItems.append(URLQueryItem(name: "cursor", value: cursor))
            }
            components?.queryItems = queryItems
            guard let url = components?.url else { throw SyncHTTPFailure(status: 503) }
            let headers = match.map { ["If-Match": $0] } ?? [:]
            let reply: SyncHTTPReply
            do {
                reply = try await transport.send(method: "GET", url: url, bearer: session, headers: headers, body: nil)
            } catch {
                throw SyncHTTPFailure(status: 503)
            }
            guard isCurrent(epoch) else { return }

            if reply.status == 412 {
                if match == nil || reset { throw SyncHTTPFailure(status: 412, retryAfter: reply.retryAfter) }
                match = nil
                since = 0
                cursor = nil
                watermark = nil
                incoming.removeAll()
                reset = true
                continue
            }
            guard (200...299).contains(reply.status) else {
                throw SyncHTTPFailure(status: reply.status, retryAfter: reply.retryAfter)
            }

            let parsedObj: [String: Any]
            do {
                guard let obj = try JSONSerialization.jsonObject(with: reply.body) as? [String: Any] else {
                    throw SyncHTTPFailure(status: 503)
                }
                parsedObj = obj
            } catch {
                throw SyncHTTPFailure(status: 503)
            }

            guard let rawItems = parsedObj["items"] as? [Any],
                  rawItems.count <= 100,
                  let pageNow = TVMSyncSchema.strictSafeInt(parsedObj["now"]),
                  pageNow >= 0 else {
                throw SyncHTTPFailure(status: 503)
            }

            var nextCursor: String? = nil
            if let cursorRaw = parsedObj["nextCursor"], !(cursorRaw is NSNull) {
                guard let cursorStr = cursorRaw as? String,
                      !rawItems.isEmpty,
                      cursorStr.utf16.count <= 750 else {
                    throw SyncHTTPFailure(status: 503)
                }
                nextCursor = cursorStr
            }

            let etagRange = reply.etag.map { NSRange($0.startIndex..<$0.endIndex, in: $0) }
            guard let etag = reply.etag,
                  let etagRange,
                  Self.etagRegex.firstMatch(in: etag, range: etagRange) != nil,
                  (match == nil || etag == match),
                  (watermark == nil || pageNow == watermark),
                  pageNow >= since,
                  (cursor == nil || nextCursor != cursor) else {
                throw SyncHTTPFailure(status: 503)
            }

            let referenceNow = max(nowMs(), pageNow)
            for rawElement in rawItems {
                guard let rawDict = rawElement as? [String: Any],
                      let item = TVMSyncSchema.parseSyncItem(rawDict, nowMs: referenceNow),
                      TVMSyncSchema.syncValueBytes(item.value) <= TVMSyncSchema.maxValueBytes else {
                    throw SyncHTTPFailure(status: 503)
                }
                incoming[item.itemId] = item
            }

            match = etag
            watermark = pageNow
            cursor = nextCursor
            more = nextCursor != nil
        }

        guard !more, let finalWatermark = watermark else {
            throw SyncHTTPFailure(status: 503)
        }

        lock.lock()
        guard !stopped, generation == epoch else {
            lock.unlock()
            return
        }
        captureLocked()
        var next = Checkpoint(
            versions: state.checkpoint.versions,
            pending: reset ? [:] : state.checkpoint.pending,
            since: finalWatermark,
            generation: match,
            lastSyncAt: state.checkpoint.lastSyncAt
        )
        if reset {
            // Keep the device's current view and forget writes from the old generation so an offline queue cannot re-create erased data.
            for key in next.versions.keys {
                next.versions[key]?.updatedAt = -1
            }
        }
        var ledger = TVMSyncLedger(versions: next.versions, pending: next.pending)
        let changes = TVMSyncMerge.mergeRemote(&ledger, incoming: Array(incoming.values))
        next.versions = ledger.versions
        next.pending = ledger.pending

        if !changes.isEmpty {
            saveLocked(State(checkpoint: next, applying: StagedApplication(items: changes, checkpoint: next)))
            finishApplicationLocked()
        } else if !incoming.isEmpty || reset || state.checkpoint.since != next.since || state.checkpoint.generation != match {
            saveLocked(State(checkpoint: next, applying: nil))
        }
        lock.unlock()
    }

    private func putSyncItems(session: String, items: [TVMSyncItem], generation: String) async throws {
        guard let url = URL(string: origin + "/v1/me/data") else { throw SyncHTTPFailure(status: 503) }
        let bodyData = Data(TVMSyncCanonical.json(["items": items.map { $0.json() }]).utf8)
        let reply: SyncHTTPReply
        do {
            reply = try await transport.send(
                method: "PUT",
                url: url,
                bearer: session,
                headers: ["If-Match": generation],
                body: bodyData
            )
        } catch {
            throw SyncHTTPFailure(status: 503)
        }
        guard (200...299).contains(reply.status) else {
            throw SyncHTTPFailure(status: reply.status, retryAfter: reply.retryAfter)
        }
    }

    // MARK: - Ledger Persistence

    private static func readLedger(from url: URL) -> State? {
        guard let data = try? Data(contentsOf: url),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        guard let checkpoint = parseCheckpoint(raw) else { return nil }
        var applying: StagedApplication? = nil
        if let appObj = raw["applying"] as? [String: Any],
           let rawItems = appObj["items"] as? [[String: Any]],
           let cpObj = appObj["checkpoint"] as? [String: Any],
           let stagedCp = parseCheckpoint(cpObj) {
            let items = rawItems.compactMap(parseStoredItem)
            applying = StagedApplication(items: items, checkpoint: stagedCp)
        }
        return State(checkpoint: checkpoint, applying: applying)
    }

    private static func parseCheckpoint(_ raw: [String: Any]) -> Checkpoint? {
        let since = TVMSyncSchema.strictSafeInt(raw["since"]) ?? 0
        let generation = raw["generation"] as? String
        let lastSyncAt = TVMSyncSchema.strictSafeInt(raw["lastSyncAt"])
        var versions: [String: TVMSyncVersion] = [:]
        if let verObj = raw["versions"] as? [String: Any] {
            for (id, rawEntry) in verObj {
                guard let entry = rawEntry as? [String: Any],
                      let updatedAt = TVMSyncSchema.strictSafeInt(entry["updatedAt"]) else { continue }
                let hash = entry["hash"] as? String
                versions[id] = TVMSyncVersion(updatedAt: updatedAt, hash: hash)
            }
        }
        var pending: [String: TVMSyncItem] = [:]
        if let pendObj = raw["pending"] as? [String: Any] {
            for (id, rawEntry) in pendObj {
                if let entry = rawEntry as? [String: Any], let item = parseStoredItem(entry) {
                    pending[id] = item
                }
            }
        }
        return Checkpoint(versions: versions, pending: pending, since: since, generation: generation, lastSyncAt: lastSyncAt)
    }

    private static func parseStoredItem(_ raw: [String: Any]) -> TVMSyncItem? {
        guard let kind = raw["kind"] as? String,
              let key = raw["key"] as? String,
              let updatedAt = TVMSyncSchema.strictSafeInt(raw["updatedAt"]) else { return nil }
        let deleted = TVMSyncSchema.strictBool(raw["deleted"]) == true
        let val: Any? = (raw["value"] is NSNull) ? nil : raw["value"]
        return TVMSyncItem(kind: kind, key: key, value: val, updatedAt: updatedAt, deleted: deleted)
    }

    private static func serializeCheckpoint(_ cp: Checkpoint) -> [String: Any] {
        var versionsOut: [String: Any] = [:]
        for (id, v) in cp.versions {
            versionsOut[id] = ["updatedAt": v.updatedAt, "hash": JSONValue.orNull(v.hash)]
        }
        var pendingOut: [String: Any] = [:]
        for (id, item) in cp.pending {
            pendingOut[id] = item.json()
        }
        return [
            "since": cp.since,
            "generation": JSONValue.orNull(cp.generation),
            "lastSyncAt": JSONValue.orNull(cp.lastSyncAt),
            "versions": versionsOut,
            "pending": pendingOut,
        ]
    }

    private static func writeLedger(_ state: State, to url: URL) {
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var body = serializeCheckpoint(state.checkpoint)
        if let applying = state.applying {
            body["applying"] = [
                "items": applying.items.map { $0.json() },
                "checkpoint": serializeCheckpoint(applying.checkpoint),
            ]
        }
        try? Data(TVMSyncCanonical.json(body).utf8).write(to: url, options: .atomic)
    }
}

// MARK: - Account Isolation & Store Wiring

final class TVMAccountSync {
    private let store: TVMStore
    private let origin: String
    private let transport: TVMSyncTransport
    private let reloadProfiles: () -> Void
    private let nowMs: () -> Int64
    private let fm = FileManager.default
    private let lock = NSLock()

    private let syncRoot: URL
    private let legacyOwnerURL: URL
    private let sessionOwnerURL: URL

    private var sessions: [String: String] = [:]
    private var engines: [String: (directory: URL, engine: TVMSyncEngine)] = [:]

    init(
        store: TVMStore,
        origin: String,
        transport: TVMSyncTransport,
        reloadProfiles: @escaping () -> Void,
        nowMs: @escaping () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000.0) }
    ) {
        self.store = store
        self.origin = origin
        self.transport = transport
        self.reloadProfiles = reloadProfiles
        self.nowMs = nowMs
        self.syncRoot = store.root.appendingPathComponent("sync", isDirectory: true)
        self.legacyOwnerURL = syncRoot.appendingPathComponent("legacy-owner.json")
        self.sessionOwnerURL = syncRoot.appendingPathComponent("session-owner.json")
    }

    private func makeEngineLocked(accountHash: String, accountDir: URL, legacy: Bool) -> (directory: URL, engine: TVMSyncEngine) {
        let engine = TVMSyncEngine(
            directory: accountDir,
            store: store,
            origin: origin,
            legacy: legacy ? store.root : nil,
            transport: transport,
            reloadProfiles: reloadProfiles,
            sessionRejected: { [weak self] rejected in
                self?.detach(token: rejected)
            },
            nowMs: nowMs
        )
        let entry = (directory: accountDir, engine: engine)
        engines[accountHash] = entry
        return entry
    }

    @discardableResult
    func bind(token: String, accountId: String, signingIn: Bool = false) -> URL {
        guard !token.isEmpty, !accountId.isEmpty else { return store.root }
        let accountHash = TVMSyncCanonical.sha256Hex("\(origin)\u{0}\(accountId)")
        let accountDir = syncRoot.appendingPathComponent("accounts/\(accountHash)", isDirectory: true)

        lock.lock()
        var entry = engines[accountHash]
        if entry == nil {
            let markerURL = accountDir.appendingPathComponent("initialized.json")
            let existingMarker = readJSON(markerURL)
            let legacy: Bool
            if let existingMarker {
                legacy = TVMSyncSchema.strictBool(existingMarker["legacy"]) == true
            } else {
                let owner = readJSON(legacyOwnerURL)?["owner"] as? String
                legacy = owner == nil || owner == accountHash
                if owner == nil {
                    writeJSON(["owner": accountHash], to: legacyOwnerURL)
                }
                TVMSyncStores.initializeStores(
                    directory: accountDir,
                    store: store,
                    legacy: legacy ? store.root : nil
                )
                writeJSON(["legacy": legacy], to: markerURL)
            }
            entry = makeEngineLocked(accountHash: accountHash, accountDir: accountDir, legacy: legacy)
        }

        let alreadyBound = sessions[token] == accountHash
        sessions[token] = accountHash
        store.setActiveDirectory(accountDir)
        writeJSON(["tokenHash": TVMSyncCanonical.sha256Hex(token), "accountHash": accountHash], to: sessionOwnerURL)
        lock.unlock()

        if !alreadyBound || signingIn {
            entry?.engine.attach(token, signingIn: signingIn)
        }
        return accountDir
    }

    func restore(token: String) {
        guard !token.isEmpty else { return }
        let tokenHash = TVMSyncCanonical.sha256Hex(token)
        lock.lock()
        guard let sessionObj = readJSON(sessionOwnerURL),
              (sessionObj["tokenHash"] as? String) == tokenHash,
              let accountHash = sessionObj["accountHash"] as? String,
              !accountHash.isEmpty,
              accountHash.allSatisfy({ $0.isHexDigit }) else {
            lock.unlock()
            return
        }
        let accountDir = syncRoot.appendingPathComponent("accounts/\(accountHash)", isDirectory: true)
        guard fm.fileExists(atPath: accountDir.appendingPathComponent("initialized.json").path) else {
            lock.unlock()
            return
        }
        var entry = engines[accountHash]
        if entry == nil {
            let marker = readJSON(accountDir.appendingPathComponent("initialized.json"))
            let legacy = TVMSyncSchema.strictBool(marker?["legacy"]) == true
            entry = makeEngineLocked(accountHash: accountHash, accountDir: accountDir, legacy: legacy)
        }
        let alreadyBound = sessions[token] == accountHash
        sessions[token] = accountHash
        store.setActiveDirectory(accountDir)
        lock.unlock()

        if !alreadyBound {
            entry?.engine.attach(token, signingIn: false)
        }
    }

    func detach(token: String) {
        let tokenHash = TVMSyncCanonical.sha256Hex(token)
        lock.lock()
        let accountHash = sessions.removeValue(forKey: token)
        let entry = accountHash.flatMap { engines[$0] }
        let fallback = accountHash.flatMap { hash in sessions.first { $0.value == hash } }
        if (readJSON(sessionOwnerURL)?["tokenHash"] as? String) == tokenHash {
            try? fm.removeItem(at: sessionOwnerURL)
        }
        if sessions.isEmpty {
            store.setActiveDirectory(nil)
        }
        lock.unlock()

        entry?.engine.detach(token)
        if let fallback, let entry {
            entry.engine.attach(fallback.key, signingIn: false)
        }
    }

    func signOut(token: String) {
        let tokenHash = TVMSyncCanonical.sha256Hex(token)
        lock.lock()
        var accountHash = sessions.removeValue(forKey: token)
        if accountHash == nil,
           let saved = readJSON(sessionOwnerURL),
           (saved["tokenHash"] as? String) == tokenHash {
            accountHash = saved["accountHash"] as? String
        }
        let entry = accountHash.flatMap { engines.removeValue(forKey: $0) }
        if let accountHash {
            for (k, v) in sessions where v == accountHash {
                sessions.removeValue(forKey: k)
            }
        }
        try? fm.removeItem(at: sessionOwnerURL)
        store.setActiveDirectory(nil)
        lock.unlock()

        entry?.engine.close()

        let dir: URL? = entry?.directory ?? accountHash.map {
            syncRoot.appendingPathComponent("accounts/\($0)", isDirectory: true)
        }
        if let dir, fm.fileExists(atPath: dir.path) {
            try? fm.removeItem(at: dir.appendingPathComponent("ledger.json"))
            try? fm.removeItem(at: dir.appendingPathComponent("profiles.json"))
            try? fm.removeItem(at: dir.appendingPathComponent("profiles", isDirectory: true))
            try? fm.removeItem(at: dir.appendingPathComponent("sync-prefs.json"))
            writeJSON(["legacy": false], to: dir.appendingPathComponent("initialized.json"))
        }
    }

    func notifyLocalChange() {
        lock.lock()
        let activeDir = store.activeSyncDir()
        let activeEngine = engines.values.first { $0.directory == activeDir }?.engine
        lock.unlock()
        activeEngine?.notifyLocalChange()
    }

    func onForeground() {
        lock.lock()
        let list = engines.values.map(\.engine)
        lock.unlock()
        for engine in list {
            engine.onForeground()
        }
    }

    func status(token: String?) -> TVMSyncStatus {
        guard let token, !token.isEmpty else { return .disabled }
        lock.lock()
        let engine = sessions[token].flatMap { engines[$0]?.engine }
        lock.unlock()
        return engine?.status() ?? .disabled
    }

    func syncNow(token: String?) async -> TVMSyncStatus {
        guard let token, !token.isEmpty else { return .disabled }
        lock.lock()
        let engine = sessions[token].flatMap { engines[$0]?.engine }
        lock.unlock()
        return await engine?.syncNow() ?? .disabled
    }

    func clearAll() {
        lock.lock()
        let list = engines.values.map(\.engine)
        engines.removeAll()
        sessions.removeAll()
        store.setActiveDirectory(nil)
        lock.unlock()
        for engine in list {
            engine.close()
        }
    }

    private func readJSON(_ url: URL) -> [String: Any]? {
        guard let data = try? Data(contentsOf: url),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return obj
    }

    private func writeJSON(_ object: [String: Any], to url: URL) {
        try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? Data(TVMSyncCanonical.json(object).utf8).write(to: url, options: .atomic)
    }
}
