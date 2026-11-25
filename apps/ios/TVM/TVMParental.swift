import CommonCrypto
import Foundation
import Security

struct AgeLevel {
    var id: String
    var maxAge: Int
    var label: String
    var summary: String
    var allowGenres: Set<String>?
    var blockGenres: Set<String>?
    var ratingMax: Set<String>?
    var liveGroups: Set<String>?
}

struct PinFailure: Error {
    let httpStatus: Int
    let errorCode: String
    let retryAfter: Int?

    init(_ httpStatus: Int, _ errorCode: String, retryAfter: Int? = nil) {
        self.httpStatus = httpStatus
        self.errorCode = errorCode
        self.retryAfter = retryAfter
    }

    func json() -> [String: Any] {
        var out: [String: Any] = ["error": errorCode]
        if let retryAfter { out["retryAfter"] = retryAfter }
        return out
    }
}

enum TVMParental {
    static let validAges: Set<Int> = [7, 12, 15, 18]

    static let fallbackLevels: [AgeLevel] = [
        AgeLevel(
            id: "kids-young",
            maxAge: 7,
            label: "Kids 7+",
            summary: "Animation, family and U/G titles only.",
            allowGenres: ["animation", "family", "comedy"],
            blockGenres: ["horror", "thriller", "crime", "war", "western", "mystery", "drama", "erotica"],
            ratingMax: ["G", "TV-Y", "TV-Y7", "TV-G", "U"],
            liveGroups: ["kids", "family", "cartoons", "documentary", "music"]
        ),
        AgeLevel(
            id: "kids-older",
            maxAge: 12,
            label: "Kids 12+",
            summary: "Family films and series up to PG / 12A.",
            allowGenres: nil,
            blockGenres: ["horror", "thriller", "crime", "erotica"],
            ratingMax: ["G", "PG", "TV-Y", "TV-Y7", "TV-G", "TV-PG", "U", "12", "12A", "PG-13", "TV-14"],
            liveGroups: ["kids", "family", "cartoons", "documentary", "education", "music", "sports"]
        ),
        AgeLevel(
            id: "teen",
            maxAge: 15,
            label: "Teen 15+",
            summary: "Most films and series up to 15; personal files stay visible.",
            allowGenres: nil,
            blockGenres: ["erotica"],
            ratingMax: nil,
            liveGroups: nil
        ),
        AgeLevel(
            id: "adult",
            maxAge: 18,
            label: "Adult 18+",
            summary: "Unrestricted access to all titles and live TV groups.",
            allowGenres: nil,
            blockGenres: nil,
            ratingMax: nil,
            liveGroups: nil
        ),
    ]

    private static let knownRatings: Set<String> = [
        "G", "PG", "PG-13", "R", "NC-17", "X", "U",
        "12", "12A", "13", "15", "16", "18",
        "TV-Y", "TV-Y7", "TV-Y7-FV", "TV-G", "TV-PG", "TV-14", "TV-MA",
    ]

    static func defaultAge(kind: String) -> Int {
        kind == "kids" ? 7 : 18
    }

    static func normalizeAge(_ raw: Any?, kind: String) -> Int? {
        if raw == nil || raw is NSNull { return defaultAge(kind: kind) }
        guard let age = JSONValue.int(raw), validAges.contains(age) else { return nil }
        return age
    }

    static func levels(content: TVMContent? = nil) -> [AgeLevel] {
        guard let rows = content?.load("parental")?["levels"] as? [[String: Any]] else {
            return fallbackLevels
        }
        var parsed: [AgeLevel] = []
        // packages/content/parental.json rows are { maxAge, label, allow, block, liveGroups }
        // (apps/core/src/providers/parental.ts); they carry no id.
        for row in rows {
            guard let maxAge = JSONValue.int(row["maxAge"]), validAges.contains(maxAge) else { continue }
            parsed.append(
                AgeLevel(
                    id: JSONValue.string(row["id"]) ?? "age-\(maxAge)",
                    maxAge: maxAge,
                    label: JSONValue.string(row["label"]) ?? "Up to \(maxAge)",
                    summary: JSONValue.string(row["summary"]) ?? "",
                    allowGenres: lowercaseSet(row.keys.contains("allowGenres") ? row["allowGenres"] : row["allow"]),
                    blockGenres: lowercaseSet(row.keys.contains("blockGenres") ? row["blockGenres"] : row["block"]),
                    ratingMax: uppercaseSet(row["ratingMax"]),
                    liveGroups: lowercaseSet(row["liveGroups"])
                )
            )
        }
        return parsed.isEmpty ? fallbackLevels : parsed.sorted { $0.maxAge < $1.maxAge }
    }

    static func levelForAge(_ maxAge: Int, levels: [AgeLevel] = TVMParental.fallbackLevels) -> AgeLevel {
        let list = levels.isEmpty ? fallbackLevels : levels
        return list.first { $0.maxAge >= maxAge } ?? list[list.count - 1]
    }

    static func allowedForLevel(_ item: MediaItem, _ maxAge: Int, levels: [AgeLevel] = TVMParental.fallbackLevels) -> Bool {
        if maxAge >= 18 { return true }
        let level = levelForAge(maxAge, levels: levels)
        let genres = item.genres
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }

        if item.kind == "file" && genres.isEmpty && level.maxAge < 15 { return false }

        if let blocked = level.blockGenres, genres.contains(where: { blocked.contains($0) }) {
            return false
        }
        if let allowed = level.allowGenres, (genres.isEmpty || !genres.contains(where: { allowed.contains($0) })) {
            return false
        }
        if let ratingMax = level.ratingMax {
            let raw = item.rating.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            if !raw.isEmpty && raw.range(of: #"^\d+\.\d+$"#, options: .regularExpression) == nil {
                let normalized = raw == "TV-Y7-FV" ? "TV-Y7" : raw
                if knownRatings.contains(normalized) && !ratingMax.contains(normalized) {
                    return false
                }
            }
        }
        return true
    }

    static func filterForLevel(_ items: [MediaItem], _ maxAge: Int, levels: [AgeLevel] = TVMParental.fallbackLevels) -> [MediaItem] {
        maxAge >= 18 ? items : items.filter { allowedForLevel($0, maxAge, levels: levels) }
    }

    static func liveGroupAllowed(_ group: String?, maxAge: Int, levels: [AgeLevel] = TVMParental.fallbackLevels) -> Bool {
        if maxAge >= 18 { return true }
        guard let allowed = levelForAge(maxAge, levels: levels).liveGroups else { return true }
        let normalized = (group ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return !normalized.isEmpty && allowed.contains(normalized)
    }

    private static func lowercaseSet(_ raw: Any?) -> Set<String>? {
        guard let arr = raw as? [Any] else { return nil }
        return Set(arr.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }.filter { !$0.isEmpty })
    }

    private static func uppercaseSet(_ raw: Any?) -> Set<String>? {
        guard let arr = raw as? [Any] else { return nil }
        return Set(arr.compactMap { ($0 as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased() }.filter { !$0.isEmpty })
    }
}

enum TVMPins {
    static let iterations = 20_000
    static let saltBytes = 16
    static let keyBytes = 32
    static let maxTries = 5
    static let lockoutInterval: TimeInterval = 60

    static func isValidPin(_ pin: String) -> Bool {
        pin.range(of: #"^\d{4}$"#, options: .regularExpression) != nil
    }

    static func isValidAvatar(_ avatar: String) -> Bool {
        avatar.range(of: #"^[a-z0-9-]{1,40}/[a-z0-9-]{1,40}$"#, options: .regularExpression) != nil
    }

    static func hashPin(pin: String, saltHex: String, iterations: Int = TVMPins.iterations) -> String? {
        guard let saltData = hexToData(saltHex), !saltData.isEmpty else { return nil }
        let passwordData = Array(pin.utf8)
        var derived = [UInt8](repeating: 0, count: keyBytes)
        let status: Int32 = passwordData.withUnsafeBytes { passRaw in
            saltData.withUnsafeBytes { saltRaw in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    passRaw.bindMemory(to: Int8.self).baseAddress,
                    passwordData.count,
                    saltRaw.bindMemory(to: UInt8.self).baseAddress,
                    saltData.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    UInt32(max(1, iterations)),
                    &derived,
                    keyBytes
                )
            }
        }
        guard status == kCCSuccess else { return nil }
        return bytesToHex(derived)
    }

    static func makePin(_ pin: String) throws -> ProfilePin {
        guard isValidPin(pin) else { throw PinFailure(400, "pin-invalid") }
        var salt = [UInt8](repeating: 0, count: saltBytes)
        if SecRandomCopyBytes(kSecRandomDefault, salt.count, &salt) != errSecSuccess {
            var gen = SystemRandomNumberGenerator()
            for i in salt.indices { salt[i] = UInt8.random(in: 0...255, using: &gen) }
        }
        let saltHex = bytesToHex(salt)
        guard let hash = hashPin(pin: pin, saltHex: saltHex, iterations: iterations) else {
            throw ClientError.message("Could not hash PIN.")
        }
        return ProfilePin(hash: hash, salt: saltHex, iter: iterations)
    }

    static func verifyHash(pin: String, stored: ProfilePin) -> Bool {
        guard isValidPin(pin),
              let expected = hexToData(stored.hash),
              let actualHex = hashPin(pin: pin, saltHex: stored.salt, iterations: max(1, stored.iter)),
              let actual = hexToData(actualHex),
              expected.count == actual.count else {
            return false
        }
        var diff: UInt8 = 0
        for i in 0..<expected.count { diff |= expected[i] ^ actual[i] }
        return diff == 0
    }

    private static func hexToData(_ hex: String) -> Data? {
        let clean = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty, clean.count % 2 == 0 else { return nil }
        var bytes: [UInt8] = []
        bytes.reserveCapacity(clean.count / 2)
        var idx = clean.startIndex
        while idx < clean.endIndex {
            let next = clean.index(idx, offsetBy: 2)
            guard let byte = UInt8(clean[idx..<next], radix: 16) else { return nil }
            bytes.append(byte)
            idx = next
        }
        return Data(bytes)
    }

    private static func bytesToHex(_ bytes: [UInt8]) -> String {
        let digits = Array("0123456789abcdef")
        var out = String()
        out.reserveCapacity(bytes.count * 2)
        for b in bytes {
            out.append(digits[Int(b >> 4)])
            out.append(digits[Int(b & 0x0f)])
        }
        return out
    }
}

final class TVMPinGuard {
    private struct AttemptState {
        var count: Int = 0
        var lockedUntil: Date?
    }

    private let clock: () -> Date
    private let lock = NSLock()
    private var attempts: [String: AttemptState] = [:]
    private var unlocked: Set<String> = []

    init(clock: @escaping () -> Date = Date.init) {
        self.clock = clock
    }

    func isUnlocked(_ profileId: String) -> Bool {
        lock.lock()
        let hit = unlocked.contains(profileId)
        lock.unlock()
        return hit
    }

    func markUnlocked(_ profileId: String) {
        lock.lock()
        attempts.removeValue(forKey: profileId)
        unlocked.insert(profileId)
        lock.unlock()
    }

    func clearSessionUnlocks() {
        lock.lock()
        unlocked.removeAll()
        lock.unlock()
    }

    func forget(_ profileId: String) {
        lock.lock()
        attempts.removeValue(forKey: profileId)
        unlocked.remove(profileId)
        lock.unlock()
    }

    func verify(profileId: String, stored: ProfilePin?, candidate: String?) throws {
        let now = clock()
        lock.lock()
        if let state = attempts[profileId], let until = state.lockedUntil {
            if until > now {
                let retryAfter = max(1, Int(ceil(until.timeIntervalSince(now))))
                lock.unlock()
                throw PinFailure(403, "pin-cooldown", retryAfter: retryAfter)
            }
            attempts.removeValue(forKey: profileId)
        }
        lock.unlock()

        let clean = candidate?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if clean.isEmpty { throw PinFailure(403, "pin-required") }
        guard TVMPins.isValidPin(clean) else { throw PinFailure(400, "pin-invalid") }
        guard let stored else {
            markUnlocked(profileId)
            return
        }
        if TVMPins.verifyHash(pin: clean, stored: stored) {
            markUnlocked(profileId)
            return
        }

        lock.lock()
        var state = attempts[profileId] ?? AttemptState()
        state.count += 1
        if state.count >= TVMPins.maxTries {
            state.lockedUntil = now.addingTimeInterval(TVMPins.lockoutInterval)
            state.count = 0
        }
        attempts[profileId] = state
        lock.unlock()
        throw PinFailure(403, "pin-wrong")
    }

    func verifyAny(guardians: [ProfileRecord], candidate: String?) throws {
        guard !guardians.isEmpty else { return }
        let now = clock()
        lock.lock()
        for guardian in guardians {
            if let until = attempts[guardian.id]?.lockedUntil, until > now {
                let retryAfter = max(1, Int(ceil(until.timeIntervalSince(now))))
                lock.unlock()
                throw PinFailure(403, "pin-cooldown", retryAfter: retryAfter)
            }
        }
        lock.unlock()

        let clean = candidate?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if clean.isEmpty { throw PinFailure(403, "pin-required") }
        guard TVMPins.isValidPin(clean) else { throw PinFailure(400, "pin-invalid") }

        for guardian in guardians {
            if let stored = guardian.pin, TVMPins.verifyHash(pin: clean, stored: stored) {
                markUnlocked(guardian.id)
                return
            }
        }

        let primary = guardians[0].id
        lock.lock()
        var state = attempts[primary] ?? AttemptState()
        state.count += 1
        if state.count >= TVMPins.maxTries {
            state.lockedUntil = now.addingTimeInterval(TVMPins.lockoutInterval)
            state.count = 0
        }
        attempts[primary] = state
        lock.unlock()
        throw PinFailure(403, "pin-wrong")
    }
}
