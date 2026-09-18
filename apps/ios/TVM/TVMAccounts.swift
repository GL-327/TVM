import Foundation
import CommonCrypto

/**
 Accounts on the phone. The iPhone app runs its own core, so the sign-in
 screen is answered here, with the same rules as apps/core/src/providers/
 accounts.ts: a new account can do nothing until the dev switches it on, a
 wrong password and a missing account get the same answer, and passwords are
 only ever stored as salted digests (PBKDF2, because scrypt is in neither
 CryptoKit nor CommonCrypto).

 The dev account is built in. Its password is the developer code.

 Phones do not send email, so nobody here is asked for a code; the dev can
 mark an address verified by hand instead.
 */

enum TVMPassword {
    static let iterations: UInt32 = 210_000

    static func hash(_ password: String, salt: String) -> String? {
        guard let passwordData = password.data(using: .utf8),
              let saltData = Data(hexString: salt) else { return nil }
        var derived = [UInt8](repeating: 0, count: 32)
        let status = passwordData.withUnsafeBytes { passwordBytes -> Int32 in
            guard let base = passwordBytes.bindMemory(to: Int8.self).baseAddress else { return Int32(kCCParamError) }
            return saltData.withUnsafeBytes { saltBytes -> Int32 in
                guard let saltBase = saltBytes.bindMemory(to: UInt8.self).baseAddress else { return Int32(kCCParamError) }
                return CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2), base, passwordData.count,
                    saltBase, saltData.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), iterations,
                    &derived, derived.count
                )
            }
        }
        guard status == Int32(kCCSuccess) else { return nil }
        return derived.map { String(format: "%02x", $0) }.joined()
    }

    static func newSalt() -> String {
        var bytes = [UInt8](repeating: 0, count: 16)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// No early exit: how long a check takes must not say how much was right.
    static func matches(_ password: String, hash expected: String, salt: String) -> Bool {
        guard let actual = hash(password, salt: salt), actual.count == expected.count else { return false }
        var difference: UInt8 = 0
        for (left, right) in zip(actual.utf8, expected.utf8) { difference |= left ^ right }
        return difference == 0
    }
}

extension Data {
    init?(hexString: String) {
        guard hexString.count % 2 == 0 else { return nil }
        var bytes = [UInt8]()
        bytes.reserveCapacity(hexString.count / 2)
        var index = hexString.startIndex
        while index < hexString.endIndex {
            let next = hexString.index(index, offsetBy: 2)
            guard let byte = UInt8(hexString[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}

/// Swift's String is not an Error, so a failure needs a type of its own.
struct TVMAccountError: Error {
    let message: String
    init(_ message: String) { self.message = message }
}

struct TVMAccount {
    var id: String
    var email: String
    var displayName: String
    var passwordHash: String
    var passwordSalt: String
    var createdAt: String
    var role: String
    var activated: Bool
    var activatedAt: String?
    var tier: String?
    var note: String?
    var suspended: Bool
    var termsVersion: String?
    var termsAcceptedAt: String?
    var emailVerifiedAt: String?
    /// This account's own Real-Debrid key. It wins over the one saved on the phone.
    var rdToken: String?
    var lastSeenAt: String?
    var signIns: Int
    var lastClient: String?

    var isDev: Bool { role == "dev" }

    func json() -> [String: Any] {
        [
            "id": id, "email": email, "displayName": displayName,
            "passwordHash": passwordHash, "passwordSalt": passwordSalt,
            "createdAt": createdAt, "role": role, "activated": activated,
            "activatedAt": JSONValue.orNull(activatedAt), "tier": JSONValue.orNull(tier),
            "note": JSONValue.orNull(note), "suspended": suspended,
            "termsVersion": JSONValue.orNull(termsVersion), "termsAcceptedAt": JSONValue.orNull(termsAcceptedAt),
            "emailVerifiedAt": JSONValue.orNull(emailVerifiedAt), "rdToken": JSONValue.orNull(rdToken),
            "lastSeenAt": JSONValue.orNull(lastSeenAt), "signIns": signIns,
            "lastClient": JSONValue.orNull(lastClient),
        ]
    }

    /// Never includes the digest, the salt or a Real-Debrid key.
    func publicJSON() -> [String: Any] {
        [
            "id": id, "email": email, "displayName": displayName,
            "role": isDev ? "dev" : "member",
            "activated": activated, "tier": JSONValue.orNull(tier), "suspended": suspended,
            "createdAt": createdAt,
            "termsVersion": JSONValue.orNull(termsVersion),
            "termsAcceptedAt": JSONValue.orNull(termsAcceptedAt),
            "emailVerified": emailVerifiedAt != nil,
            // Phones never send a code.
            "emailCodeSent": false,
            "rdKey": rdToken != nil,
        ]
    }

    func adminJSON(activeSessions: Int) -> [String: Any] {
        var out = publicJSON()
        out["activatedAt"] = JSONValue.orNull(activatedAt)
        out["lastSeenAt"] = JSONValue.orNull(lastSeenAt)
        out["signIns"] = signIns
        out["lastClient"] = JSONValue.orNull(lastClient)
        out["note"] = JSONValue.orNull(note)
        out["activeSessions"] = activeSessions
        out["emailVerifiedAt"] = JSONValue.orNull(emailVerifiedAt)
        if let key = rdToken {
            out["rdKeyHint"] = key.count <= 4 ? "••••" : "••••" + String(key.suffix(4))
        } else {
            out["rdKeyHint"] = NSNull()
        }
        return out
    }

    static func from(_ raw: Any?) -> TVMAccount? {
        guard let row = raw as? [String: Any],
              let id = row["id"] as? String,
              let email = row["email"] as? String,
              let hash = row["passwordHash"] as? String,
              let salt = row["passwordSalt"] as? String else { return nil }
        return TVMAccount(
            id: id, email: email,
            displayName: row["displayName"] as? String ?? email,
            passwordHash: hash, passwordSalt: salt,
            createdAt: row["createdAt"] as? String ?? "",
            role: (row["role"] as? String) == "dev" ? "dev" : "member",
            activated: row["activated"] as? Bool ?? false,
            activatedAt: row["activatedAt"] as? String,
            tier: row["tier"] as? String,
            note: row["note"] as? String,
            suspended: row["suspended"] as? Bool ?? false,
            termsVersion: row["termsVersion"] as? String,
            termsAcceptedAt: row["termsAcceptedAt"] as? String,
            emailVerifiedAt: (row["emailVerifiedAt"] as? String).flatMap { $0.isEmpty ? nil : $0 },
            rdToken: (row["rdToken"] as? String).flatMap { $0.isEmpty ? nil : $0 },
            lastSeenAt: row["lastSeenAt"] as? String,
            signIns: row["signIns"] as? Int ?? 0,
            lastClient: row["lastClient"] as? String
        )
    }
}

final class TVMAccounts {
    static let devAccountID = "acc_dev"
    /// Not an address, so nobody can register it or sign in to it with a password.
    private static let devEmail = "dev"

    private let store: TVMStore
    private let file = "accounts.json"
    private let sessionDays: TimeInterval = 30 * 86_400

    init(store: TVMStore) { self.store = store }

    // MARK: Access resource

    /// Terms and tiers, generated from the one TypeScript source by scripts/export-access.mjs.
    static func access() -> [String: Any] {
        guard let url = Bundle.main.url(forResource: "Access", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    static func termsVersion() -> String {
        access()["termsVersion"] as? String ?? ""
    }

    // MARK: Storage

    private func load() -> (accounts: [TVMAccount], sessions: [String: [String: Any]]) {
        let root = store.readJSON(file) as? [String: Any] ?? [:]
        let rows = (root["accounts"] as? [Any] ?? []).compactMap(TVMAccount.from)
        var sessions = root["sessions"] as? [String: [String: Any]] ?? [:]
        let now = Date()
        for (key, session) in sessions {
            let expires = (session["expiresAt"] as? String).flatMap(TVMAccounts.date) ?? Date.distantPast
            if expires <= now { sessions.removeValue(forKey: key) }
        }
        return (rows, sessions)
    }

    private func save(_ accounts: [TVMAccount], _ sessions: [String: [String: Any]]) {
        store.writeJSON(file, ["version": 1, "accounts": accounts.map { $0.json() }, "sessions": sessions])
    }

    private static func date(_ iso: String) -> Date? {
        ISO8601DateFormatter().date(from: iso)
    }

    private static func iso(_ date: Date = Date()) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private static func digest(_ token: String) -> String {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        let data = Data(token.utf8)
        data.withUnsafeBytes { _ = CC_SHA256($0.baseAddress, CC_LONG(data.count), &hash) }
        return hash.map { String(format: "%02x", $0) }.joined()
    }

    private static func newToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func normalize(_ email: String) -> String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    static func emailLooksValid(_ email: String) -> Bool {
        guard email.count <= 254 else { return false }
        let parts = email.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty else { return false }
        let host = parts[1]
        guard let dot = host.lastIndex(of: "."), host.distance(from: dot, to: host.endIndex) > 2 else { return false }
        return !host.hasPrefix(".") && !email.contains(" ")
    }

    private static func sessionCount(_ sessions: [String: [String: Any]], id: String) -> Int {
        sessions.values.filter { ($0["accountId"] as? String) == id }.count
    }

    /// Opens a session for the account at `index` and returns its token.
    private static func openSession(_ accounts: inout [TVMAccount], _ index: Int, _ sessions: inout [String: [String: Any]], client: String?, days: TimeInterval) -> String {
        let token = newToken()
        let now = Date()
        accounts[index].lastSeenAt = iso(now)
        accounts[index].signIns += 1
        if let client { accounts[index].lastClient = String(client.prefix(200)) }
        sessions[digest(token)] = [
            "accountId": accounts[index].id,
            "issuedAt": iso(now),
            "expiresAt": iso(now.addingTimeInterval(days)),
            "client": JSONValue.orNull(client),
        ]
        return token
    }

    /// Members only: the dev account is not managed from the Accounts screen.
    private func memberIndex(_ accounts: [TVMAccount], _ id: String) -> Int? {
        accounts.firstIndex { $0.id == id && !$0.isDev }
    }

    // MARK: Rules

    /// Same as the desktop core: switched on, a tier, current terms, not suspended. The dev account always passes.
    static func usable(_ account: TVMAccount?, termsVersion: String) -> [String: Any] {
        guard let account else { return ["ok": false, "reason": "no_account"] }
        if account.isDev { return ["ok": true, "reason": NSNull()] }
        if account.suspended { return ["ok": false, "reason": "suspended"] }
        if !account.activated || account.tier == nil { return ["ok": false, "reason": "awaiting_activation"] }
        if account.termsVersion != termsVersion || account.termsAcceptedAt == nil {
            return ["ok": false, "reason": "terms_required"]
        }
        return ["ok": true, "reason": NSNull()]
    }

    // MARK: Actions

    func register(email rawEmail: String, password: String, displayName: String?, client: String?) -> Result<[String: Any], TVMAccountError> {
        let email = TVMAccounts.normalize(rawEmail)
        guard TVMAccounts.emailLooksValid(email) else { return .failure(TVMAccountError("Enter a valid email address.")) }
        guard password.count >= 10 else { return .failure(TVMAccountError("Use at least 10 characters.")) }
        guard password.count <= 200 else { return .failure(TVMAccountError("That password is too long.")) }

        var (accounts, sessions) = load()
        // Same answer whether or not the address exists, so signup cannot be
        // used to find out who has an account.
        guard !accounts.contains(where: { $0.email == email && !$0.isDev }) else {
            return .failure(TVMAccountError("That account could not be created. If it already exists, sign in instead."))
        }

        let salt = TVMPassword.newSalt()
        guard let hash = TVMPassword.hash(password, salt: salt) else { return .failure(TVMAccountError("That account could not be created.")) }
        let name = (displayName?.trimmingCharacters(in: .whitespacesAndNewlines)).flatMap { $0.isEmpty ? nil : $0 }
            ?? String(email.split(separator: "@").first ?? "")
        let account = TVMAccount(
            id: "acc_\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))",
            email: email, displayName: String(name.prefix(80)),
            passwordHash: hash, passwordSalt: salt,
            createdAt: TVMAccounts.iso(), role: "member", activated: false, activatedAt: nil, tier: nil,
            note: nil, suspended: false, termsVersion: nil, termsAcceptedAt: nil,
            emailVerifiedAt: nil, rdToken: nil,
            lastSeenAt: nil, signIns: 0, lastClient: client.map { String($0.prefix(200)) }
        )
        accounts.append(account)
        save(accounts, sessions)
        return .success(account.publicJSON())
    }

    func signIn(email rawEmail: String, password: String, client: String?) -> Result<[String: Any], TVMAccountError> {
        let email = TVMAccounts.normalize(rawEmail)
        var (accounts, sessions) = load()
        guard let index = accounts.firstIndex(where: { $0.email == email && !$0.isDev }) else {
            // Hash anyway, so a missing account and a wrong password take the
            // same time.
            _ = TVMPassword.hash(password, salt: TVMPassword.newSalt())
            return .failure(TVMAccountError("That email address and password do not match."))
        }
        guard TVMPassword.matches(password, hash: accounts[index].passwordHash, salt: accounts[index].passwordSalt) else {
            return .failure(TVMAccountError("That email address and password do not match."))
        }

        let token = TVMAccounts.openSession(&accounts, index, &sessions, client: client, days: sessionDays)
        save(accounts, sessions)
        return .success([
            "token": token,
            "account": accounts[index].publicJSON(),
            "usable": TVMAccounts.usable(accounts[index], termsVersion: TVMAccounts.termsVersion()),
        ])
    }

    /// Signs in to the dev account, creating it the first time. The caller checks the developer code first.
    func signInDev(client: String?) -> [String: Any] {
        var (accounts, sessions) = load()
        let index: Int
        if let existing = accounts.firstIndex(where: { $0.id == TVMAccounts.devAccountID }) {
            index = existing
        } else {
            let now = TVMAccounts.iso()
            accounts.append(TVMAccount(
                id: TVMAccounts.devAccountID, email: TVMAccounts.devEmail, displayName: "Dev",
                passwordHash: "", passwordSalt: "",
                createdAt: now, role: "dev", activated: true, activatedAt: now, tier: "stream-live",
                note: nil, suspended: false, termsVersion: nil, termsAcceptedAt: nil,
                emailVerifiedAt: nil, rdToken: nil,
                lastSeenAt: nil, signIns: 0, lastClient: nil
            ))
            index = accounts.count - 1
        }
        accounts[index].role = "dev"
        accounts[index].activated = true
        accounts[index].tier = "stream-live"
        accounts[index].suspended = false
        let token = TVMAccounts.openSession(&accounts, index, &sessions, client: client, days: sessionDays)
        save(accounts, sessions)
        return [
            "token": token,
            "account": accounts[index].publicJSON(),
            "usable": TVMAccounts.usable(accounts[index], termsVersion: TVMAccounts.termsVersion()),
        ]
    }

    /// Whether the dev account has a session open on this phone.
    func devSignedIn() -> Bool {
        TVMAccounts.sessionCount(load().sessions, id: TVMAccounts.devAccountID) > 0
    }

    func signOut(token: String) {
        var (accounts, sessions) = load()
        sessions.removeValue(forKey: TVMAccounts.digest(token))
        save(accounts, sessions)
    }

    func resolve(token: String?) -> TVMAccount? {
        guard let token, !token.isEmpty else { return nil }
        let (accounts, sessions) = load()
        guard let session = sessions[TVMAccounts.digest(token)],
              let id = session["accountId"] as? String else { return nil }
        return accounts.first { $0.id == id }
    }

    /// The account's own Real-Debrid key for this session, if it has one.
    func rdTokenFor(token: String?) -> String? {
        resolve(token: token)?.rdToken
    }

    func acceptTerms(id: String) -> [String: Any]? {
        var (accounts, sessions) = load()
        guard let index = accounts.firstIndex(where: { $0.id == id }) else { return nil }
        accounts[index].termsVersion = TVMAccounts.termsVersion()
        accounts[index].termsAcceptedAt = TVMAccounts.iso()
        save(accounts, sessions)
        return accounts[index].publicJSON()
    }

    // MARK: Dev only

    func list(search: String?, state: String?) -> [String: Any] {
        let (all, sessions) = load()
        let accounts = all.filter { !$0.isDev }
        var counts: [String: Int] = [:]
        for session in sessions.values {
            if let id = session["accountId"] as? String { counts[id, default: 0] += 1 }
        }
        let needle = (search ?? "").trimmingCharacters(in: .whitespaces).lowercased()
        let filtered = accounts.filter { account in
            if !needle.isEmpty && !account.email.contains(needle) && !account.displayName.lowercased().contains(needle) { return false }
            switch state {
            case "waiting": return !account.activated && !account.suspended
            case "active": return account.activated && !account.suspended
            case "suspended": return account.suspended
            default: return true
            }
        }.sorted { $0.createdAt > $1.createdAt }

        return [
            "accounts": filtered.map { $0.adminJSON(activeSessions: counts[$0.id] ?? 0) },
            "summary": [
                "total": accounts.count,
                "waiting": accounts.filter { !$0.activated && !$0.suspended }.count,
                "active": accounts.filter { $0.activated && !$0.suspended }.count,
                "suspended": accounts.filter { $0.suspended }.count,
            ],
            "tiers": (TVMAccounts.access()["tiers"] as? [[String: Any]] ?? []).map {
                ["id": $0["id"] ?? "", "name": $0["name"] ?? ""]
            },
        ]
    }

    func activate(id: String, tier: String, note: String?) -> [String: Any]? {
        guard tier == "stream" || tier == "stream-live" else { return nil }
        var (accounts, sessions) = load()
        guard let index = memberIndex(accounts, id) else { return nil }
        accounts[index].activated = true
        accounts[index].activatedAt = accounts[index].activatedAt ?? TVMAccounts.iso()
        accounts[index].tier = tier
        accounts[index].suspended = false
        if let note { accounts[index].note = String(note.prefix(500)) }
        save(accounts, sessions)
        return accounts[index].adminJSON(activeSessions: TVMAccounts.sessionCount(sessions, id: id))
    }

    /// Turns Live TV on or off for an account that is already switched on.
    func setLiveTv(id: String, enabled: Bool) -> Result<[String: Any], TVMAccountError> {
        var (accounts, sessions) = load()
        guard let index = memberIndex(accounts, id) else { return .failure(TVMAccountError("No such account.")) }
        guard accounts[index].activated, accounts[index].tier != nil else {
            return .failure(TVMAccountError("Switch the account on first."))
        }
        accounts[index].tier = enabled ? "stream-live" : "stream"
        save(accounts, sessions)
        return .success(accounts[index].adminJSON(activeSessions: TVMAccounts.sessionCount(sessions, id: id)))
    }

    /// Saves or clears this account's own Real-Debrid key.
    func setRdToken(id: String, token: String) -> Result<[String: Any], TVMAccountError> {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count <= 200, trimmed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
            return .failure(TVMAccountError("That does not look like a Real-Debrid key."))
        }
        var (accounts, sessions) = load()
        guard let index = memberIndex(accounts, id) else { return .failure(TVMAccountError("No such account.")) }
        accounts[index].rdToken = trimmed.isEmpty ? nil : trimmed
        save(accounts, sessions)
        return .success(accounts[index].adminJSON(activeSessions: TVMAccounts.sessionCount(sessions, id: id)))
    }

    func setEmailVerified(id: String, verified: Bool) -> Result<[String: Any], TVMAccountError> {
        var (accounts, sessions) = load()
        guard let index = memberIndex(accounts, id) else { return .failure(TVMAccountError("No such account.")) }
        accounts[index].emailVerifiedAt = verified ? (accounts[index].emailVerifiedAt ?? TVMAccounts.iso()) : nil
        save(accounts, sessions)
        return .success(accounts[index].adminJSON(activeSessions: TVMAccounts.sessionCount(sessions, id: id)))
    }

    func setSuspended(id: String, suspended: Bool) -> [String: Any]? {
        var (accounts, sessions) = load()
        guard let index = memberIndex(accounts, id) else { return nil }
        accounts[index].suspended = suspended
        if suspended {
            accounts[index].activated = false
            // Revoking must not wait for a token to lapse.
            for (key, session) in sessions where (session["accountId"] as? String) == id {
                sessions.removeValue(forKey: key)
            }
        }
        save(accounts, sessions)
        return accounts[index].adminJSON(activeSessions: TVMAccounts.sessionCount(sessions, id: id))
    }

    func setNote(id: String, note: String?) -> [String: Any]? {
        var (accounts, sessions) = load()
        guard let index = memberIndex(accounts, id) else { return nil }
        accounts[index].note = note.map { String($0.prefix(500)) }
        save(accounts, sessions)
        return accounts[index].adminJSON(activeSessions: TVMAccounts.sessionCount(sessions, id: id))
    }

    func erase(id: String) {
        guard id != TVMAccounts.devAccountID else { return }
        var (accounts, sessions) = load()
        accounts.removeAll { $0.id == id }
        for (key, session) in sessions where (session["accountId"] as? String) == id {
            sessions.removeValue(forKey: key)
        }
        save(accounts, sessions)
    }
}
