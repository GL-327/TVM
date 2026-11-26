import Foundation
import Security

/// Where the private accounts service lives. The service holds accounts,
/// sign-ins and Real-Debrid keys; this public app holds none of them. Must match
/// ACCOUNTS_URL in apps/core/src/config.ts.
let tvmAccountsURL = "https://tvm-accounts.tvm-accounts.workers.dev"

/// One JSON request to the accounts service. A protocol so tests need no network.
protocol TVMAccountsTransport {
    /// Throws when the service cannot be reached at all.
    func send(method: String, url: URL, bearer: String?, body: Data?) async throws -> (status: Int, body: Data)
}

/// Never follow a redirect with a bearer token attached.
private final class TVMAccountsNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

struct TVMURLSessionTransport: TVMAccountsTransport {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: TVMAccountsNoRedirect(), delegateQueue: nil)
    }()

    func send(method: String, url: URL, bearer: String?, body: Data?) async throws -> (status: Int, body: Data) {
        guard url.scheme == "https" else { throw URLError(.appTransportSecurityRequiresSecureConnection) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("TVM/1.1 (iOS; +https://github.com/GL-327/TVM)", forHTTPHeaderField: "User-Agent")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await TVMURLSessionTransport.session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (http.statusCode, data)
    }
}

/// Where the one session token is kept: the Keychain on the phone, memory in tests.
protocol TVMSessionVault: AnyObject {
    func read() -> String?
    func write(_ token: String?)
}

final class TVMMemorySessionVault: TVMSessionVault {
    private let lock = NSLock()
    private var token: String?

    func read() -> String? {
        lock.lock()
        defer { lock.unlock() }
        return token
    }

    func write(_ token: String?) {
        lock.lock()
        defer { lock.unlock() }
        self.token = token
    }
}

/// The accounts session token, and nothing else about the account. Passwords
/// and Real-Debrid keys live in the accounts service. Reads and writes never
/// throw: a Keychain that is locked or unavailable just means signing in again.
final class TVMKeychainSessionVault: TVMSessionVault {
    private let account: String

    init(account: String = "session") {
        self.account = account
    }

    private var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "TVM.Standalone.AccountSession",
            kSecAttrAccount as String: account,
        ]
    }

    func read() -> String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8), !token.isEmpty else { return nil }
        return token
    }

    func write(_ token: String?) {
        guard let token, !token.isEmpty else {
            SecItemDelete(query as CFDictionary)
            return
        }
        let values: [String: Any] = [
            kSecValueData as String: Data(token.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil)
        }
    }
}

/// Swift's String is not an Error, so a failure needs a type of its own.
struct TVMAccountError: Error {
    let message: String
    /// The status the local route answers with when it is not the route's usual one (429, 503, 401); 0 otherwise.
    let status: Int
    init(_ message: String, status: Int = 0) {
        self.message = message
        self.status = status
    }
}

/// The answer to "who is this session": the account, signed out, or the service could not be asked.
enum TVMAccountLookup {
    case found(TVMAccount)
    case signedOut
    case unavailable
}

/// An account as the service describes it, in the shape the rest of the phone's core reads.
/// The service's role "admin" is "dev" here, as the interface already knows it.
struct TVMAccount {
    var id: String
    var email: String
    var displayName: String
    var role: String
    var activated: Bool
    var suspended: Bool
    var tier: String?
    var createdAt: String
    var termsVersion: String?
    var termsAcceptedAt: String?
    var emailVerified: Bool
    var hasRdToken: Bool

    var isDev: Bool { role == "dev" }

    /// Never includes a password or a Real-Debrid key.
    func publicJSON() -> [String: Any] {
        [
            "id": id, "email": email, "displayName": displayName,
            "role": isDev ? "dev" : "member",
            "activated": activated, "tier": JSONValue.orNull(tier), "suspended": suspended,
            "createdAt": createdAt,
            "termsVersion": JSONValue.orNull(termsVersion),
            "termsAcceptedAt": JSONValue.orNull(termsAcceptedAt),
            "emailVerified": emailVerified,
            // Phones never send a code.
            "emailCodeSent": false,
            "rdKey": hasRdToken,
        ]
    }

    static func from(service raw: Any?) -> TVMAccount? {
        guard let row = raw as? [String: Any],
              let id = row["id"] as? String,
              let email = row["email"] as? String else { return nil }
        let status = row["status"] as? String ?? "waiting"
        let version = (row["termsVersion"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let createdAt = row["createdAt"] as? String ?? ""
        let tier: String?
        if status == "waiting" {
            tier = nil
        } else {
            tier = (row["liveTv"] as? Bool ?? false) ? "stream-live" : "stream"
        }
        return TVMAccount(
            id: id, email: email,
            displayName: row["displayName"] as? String ?? email,
            role: (row["role"] as? String) == "admin" ? "dev" : "member",
            activated: status == "active",
            suspended: status == "suspended",
            tier: tier,
            createdAt: createdAt,
            termsVersion: version,
            termsAcceptedAt: version == nil ? nil : createdAt,
            emailVerified: row["emailVerified"] as? Bool ?? false,
            hasRdToken: row["hasRdToken"] as? Bool ?? false
        )
    }
}

/**
 Accounts on the phone. The accounts live in TVM's private service
 (tvmAccountsURL); this class only talks to it. The phone keeps the session
 token, in the Keychain, and nothing else: no password, no ledger, no
 Real-Debrid key on disk. A member's Real-Debrid key is fetched from the
 service when it is needed and held in memory for a few minutes.

 The local /api/account routes keep the shape the interface already uses, so
 the service's role "admin" is answered as the old "dev" role.

 Accounts that were stored on the phone could not be moved (their passwords
 were kept as digests the service cannot read), so people register again and the
 owner switches them on. Admin work happens on the web dashboard, not here.
 */
final class TVMAccounts {
    /// How long an answer about an account is trusted before the service is asked again.
    static let accountTTL: TimeInterval = 30
    /// How long a fetched Real-Debrid key stays in memory (bounded under 1 minute for rotations).
    static let rdTTL: TimeInterval = 45
    /// Empty or failed key fetches are retried promptly.
    private static let rdNullTTL: TimeInterval = 5
    private static let rdFailureTTL: TimeInterval = rdNullTTL
    /// Public config TTL (5 min on success, 15s on failure).
    static let configTTL: TimeInterval = 5 * 60
    private static let configErrorTTL: TimeInterval = 15

    private struct CachedAccount {
        let account: TVMAccount
        let at: Date
    }

    private struct CachedKey {
        let token: String?
        let expires: Date
    }

    private var transport: TVMAccountsTransport
    private var vault: TVMSessionVault
    private var adminVault: TVMSessionVault
    private let origin: String
    private let now: () -> Date
    private let lock = NSLock()
    private var accountCache: [String: CachedAccount] = [:]
    private var rdCache: [String: CachedKey] = [:]
    private var configCache: [String: Any] = TVMAccounts.defaultConfig()
    private var configExpires: Date = .distantPast

    init(
        transport: TVMAccountsTransport = TVMURLSessionTransport(),
        vault: TVMSessionVault = TVMKeychainSessionVault(),
        origin: String = tvmAccountsURL,
        now: @escaping () -> Date = { Date() },
        adminVault: TVMSessionVault = TVMMemorySessionVault()
    ) {
        self.transport = transport
        self.vault = vault
        self.adminVault = adminVault
        self.origin = origin
        self.now = now
    }

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

    // MARK: The service

    private static let unreachable = "TVM accounts cannot be reached. Check your connection and try again."
    private static let misunderstood = "TVM accounts sent an answer this app does not understand."

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    private func callRaw(_ method: String, _ path: String, bearer: String? = nil, body: [String: Any]? = nil) async throws -> (status: Int, body: Data) {
        guard let url = URL(string: origin + path) else { throw TVMAccountError(TVMAccounts.unreachable, status: 503) }
        do {
            return try await transport.send(method: method, url: url, bearer: bearer, body: body.map { JSONValue.data($0) })
        } catch {
            throw TVMAccountError(TVMAccounts.unreachable, status: 503)
        }
    }

    private func call(_ method: String, _ path: String, bearer: String? = nil, body: [String: Any]? = nil) async throws -> (status: Int, json: [String: Any]) {
        let reply = try await callRaw(method, path, bearer: bearer, body: body)
        return (reply.status, JSONValue.object(reply.body))
    }

    private static func defaultConfig() -> [String: Any] {
        [
            "announcement": NSNull(),
            "minVersion": NSNull(),
            "flags": [String: Bool](),
            "openSignups": false,
            "mail": false,
        ]
    }

    private static func safeHttpUrl(_ raw: Any?) -> String? {
        guard let text = JSONValue.string(raw), let url = URL(string: text),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              url.host != nil, url.user == nil, url.password == nil else { return nil }
        return url.absoluteString
    }

    private static func publicConfig(_ raw: [String: Any]) -> [String: Any] {
        var announcement: Any = NSNull()
        if let a = raw["announcement"] as? [String: Any],
           let id = JSONValue.string(a["id"]),
           let text = JSONValue.string(a["text"]),
           let level = JSONValue.string(a["level"]),
           ["info", "warning", "critical"].contains(level) {
            var item: [String: Any] = ["id": id, "text": text, "level": level]
            if let link = safeHttpUrl(a["link"]) { item["link"] = link }
            announcement = item
        }
        var flagsOut: [String: Bool] = [:]
        if let flags = raw["flags"] as? [String: Any] {
            for (k, v) in flags {
                if let boolVal = v as? Bool { flagsOut[k] = boolVal }
            }
        }
        let minVersion = JSONValue.string(raw["minVersion"])
        return [
            "announcement": announcement,
            "minVersion": JSONValue.orNull(minVersion),
            "flags": flagsOut,
            "openSignups": (raw["openSignups"] as? Bool) == true,
            "mail": (raw["mail"] as? Bool) == true,
        ]
    }

    func config(force: Bool = false) async -> [String: Any] {
        let current = now()
        if !force, let hit = locked({ current < configExpires ? configCache : nil }) {
            return hit
        }
        do {
            let reply = try await call("GET", "/v1/config")
            if (200...299).contains(reply.status) {
                let mapped = Self.publicConfig(reply.json)
                return locked { () -> [String: Any] in
                    configCache = mapped
                    configExpires = now().addingTimeInterval(Self.configTTL)
                    return mapped
                }
            }
        } catch {
            // Retain last-known config during transient failure.
        }
        return locked { () -> [String: Any] in
            configExpires = now().addingTimeInterval(Self.configErrorTTL)
            return configCache
        }
    }

    func announcement() async -> [String: Any] {
        let cfg = await config()
        return [
            "announcement": cfg["announcement"] ?? NSNull(),
            "minVersion": cfg["minVersion"] ?? NSNull(),
            "flags": cfg["flags"] ?? [String: Bool](),
        ]
    }

    private static func failure(_ status: Int, _ fallback: String) -> TVMAccountError {
        if status == 429 { return TVMAccountError("Too many tries. Wait a few minutes and try again.", status: 429) }
        if status >= 500 { return TVMAccountError("TVM accounts are not answering right now. Try again in a moment.", status: 503) }
        return TVMAccountError(fallback, status: status == 401 ? 401 : 0)
    }

    /// Text for a field the service takes: no control characters, trimmed, clipped.
    private static func cleaned(_ raw: String?, limit: Int) -> String? {
        guard let raw else { return nil }
        let kept = String(String.UnicodeScalarView(raw.unicodeScalars.filter { $0.value >= 32 && $0.value != 127 }))
        let text = String(kept.trimmingCharacters(in: .whitespacesAndNewlines).prefix(limit))
        return text.isEmpty ? nil : text
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

    // MARK: Rules

    /// Switched on, a tier, current terms, not suspended. An owner (admin) account always passes, like the desktop.
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

    func register(email rawEmail: String, password: String, displayName: String?, client: String?) async -> Result<[String: Any], TVMAccountError> {
        let email = TVMAccounts.normalize(rawEmail)
        guard TVMAccounts.emailLooksValid(email) else { return .failure(TVMAccountError("Enter a valid email address.")) }
        guard password.utf16.count >= 10 else { return .failure(TVMAccountError("Use at least 10 characters.")) }
        guard password.utf16.count <= 200 else { return .failure(TVMAccountError("That password is too long.")) }
        var body: [String: Any] = ["email": email, "password": password]
        if let name = TVMAccounts.cleaned(displayName, limit: 80) { body["displayName"] = name }
        if let agent = TVMAccounts.cleaned(client, limit: 200) { body["client"] = agent }
        do {
            let reply = try await call("POST", "/v1/register", body: body)
            guard reply.status == 201 || reply.status == 200 else {
                throw TVMAccounts.failure(reply.status, "That account could not be created. If it already exists, sign in instead.")
            }
            guard let account = TVMAccount.from(service: reply.json["account"]) else {
                throw TVMAccountError(TVMAccounts.misunderstood, status: 503)
            }
            return .success(account.publicJSON())
        } catch let error as TVMAccountError {
            return .failure(error)
        } catch {
            return .failure(TVMAccountError(TVMAccounts.unreachable, status: 503))
        }
    }

    func signIn(email rawEmail: String, password: String, client: String?) async -> Result<[String: Any], TVMAccountError> {
        let mismatch = "That email address and password do not match."
        let email = TVMAccounts.normalize(rawEmail)
        guard !email.isEmpty, !password.isEmpty, password.utf16.count <= 200 else {
            return .failure(TVMAccountError(mismatch, status: 401))
        }
        var body: [String: Any] = ["email": email, "password": password]
        if let agent = TVMAccounts.cleaned(client, limit: 200) { body["client"] = agent }
        do {
            let reply = try await call("POST", "/v1/signin", body: body)
            if reply.status == 401 || reply.status == 400 { throw TVMAccountError(mismatch, status: 401) }
            guard reply.status == 200 else { throw TVMAccounts.failure(reply.status, "Sign in failed.") }
            guard let session = reply.json["session"] as? String, !session.isEmpty,
                  let account = TVMAccount.from(service: reply.json["account"]) else {
                throw TVMAccountError(TVMAccounts.misunderstood, status: 503)
            }
            // The phone remembers the latest session; other sessions (a paired Roku, say) are left alone.
            vault.write(session)
            locked { accountCache[session] = CachedAccount(account: account, at: now()) }
            return .success([
                "token": session,
                "account": account.publicJSON(),
                "usable": TVMAccounts.usable(account, termsVersion: TVMAccounts.termsVersion()),
            ])
        } catch let error as TVMAccountError {
            return .failure(error)
        } catch {
            return .failure(TVMAccountError(TVMAccounts.unreachable, status: 503))
        }
    }

    /// Best effort: the service forgets the session, and so does this phone, whatever the service says.
    private func revoke(_ token: String) async {
        _ = try? await call("POST", "/v1/signout", bearer: token)
        forget(token)
    }

    func signOut(token: String) async {
        await revoke(token)
        if vault.read() == token { vault.write(nil) }
    }

    /// Factory reset: close the session the phone holds and drop everything in memory.
    func forgetEverything() async {
        if let held = vault.read() { await revoke(held) }
        vault.write(nil)
        adminVault.write(nil)
        locked {
            accountCache.removeAll()
            rdCache.removeAll()
            configCache = Self.defaultConfig()
            configExpires = .distantPast
        }
    }

    func invalidateCaches() {
        locked {
            accountCache.removeAll()
            rdCache.removeAll()
            configExpires = .distantPast
        }
    }

    func cachedRdTokenFor(token: String?) -> String? {
        guard let token, !token.isEmpty else { return nil }
        return locked { () -> String? in
            guard let cached = rdCache[token] else { return nil }
            if cached.expires <= now() {
                rdCache.removeValue(forKey: token)
                return nil
            }
            return cached.token
        }
    }

    func forgetRdToken(token: String?, rejected: String? = nil) {
        guard let token, !token.isEmpty else { return }
        locked {
            if let rejected {
                if rdCache[token]?.token == rejected { rdCache.removeValue(forKey: token) }
            } else {
                rdCache.removeValue(forKey: token)
            }
        }
    }

    private func forget(_ token: String) {
        locked {
            accountCache.removeValue(forKey: token)
            rdCache.removeValue(forKey: token)
        }
    }

    /// Who this session belongs to, asking the service at most every `accountTTL` seconds.
    func lookup(token: String?) async -> TVMAccountLookup {
        guard let token, !token.isEmpty else { return .signedOut }
        let cached = locked { accountCache[token] }
        if let cached, now().timeIntervalSince(cached.at) < TVMAccounts.accountTTL { return .found(cached.account) }
        let reply: (status: Int, json: [String: Any])
        do {
            reply = try await call("GET", "/v1/me", bearer: token)
        } catch {
            // The service cannot be reached: an account seen a moment ago stays signed in.
            if let cached { return .found(cached.account) }
            return .unavailable
        }
        if reply.status == 401 || reply.status == 403 {
            forget(token)
            if vault.read() == token { vault.write(nil) }
            return .signedOut
        }
        guard reply.status == 200, let account = TVMAccount.from(service: reply.json["account"]) else {
            if let cached { return .found(cached.account) }
            return .unavailable
        }
        if account.suspended {
            forget(token)
            return .signedOut
        }
        locked {
            accountCache[token] = CachedAccount(account: account, at: now())
            // A change on the service (switched off, key removed, or cached null) must not leave stale state.
            if !account.activated || !account.hasRdToken || rdCache[token]?.token == nil {
                rdCache.removeValue(forKey: token)
            }
        }
        return .found(account)
    }

    func resolve(token: String?) async -> TVMAccount? {
        if case .found(let account) = await lookup(token: token) { return account }
        return nil
    }

    /// The account's own Real-Debrid key for this session, if it has one. Fetched on demand, held in memory only.
    func rdTokenFor(token: String?, fresh: Bool = false) async -> String? {
        guard let token, !token.isEmpty,
              let account = await resolve(token: token),
              account.activated, account.hasRdToken else { return nil }
        if fresh { locked { _ = rdCache.removeValue(forKey: token) } }
        if let cached = locked({ rdCache[token] }), cached.expires > now() { return cached.token }
        do {
            let reply = try await call("GET", "/v1/me/rd-token", bearer: token)
            if reply.status == 200 {
                let key = (reply.json["token"] as? String).flatMap { $0.isEmpty ? nil : $0 }
                let ttl = key == nil ? TVMAccounts.rdNullTTL : TVMAccounts.rdTTL
                locked { rdCache[token] = CachedKey(token: key, expires: now().addingTimeInterval(ttl)) }
                return key
            }
            if reply.status == 401 || reply.status == 403 {
                locked { _ = rdCache.removeValue(forKey: token) }
                return nil
            }
        } catch {
            // Fall through to the short failure cache.
        }
        locked { rdCache[token] = CachedKey(token: nil, expires: now().addingTimeInterval(TVMAccounts.rdFailureTTL)) }
        return nil
    }

    func resendVerification(token: String?, rawEmail: String?) async -> (Int, [String: Any]) {
        do {
            if let token, !token.isEmpty {
                let reply = try await call("POST", "/v1/me/verify/resend", bearer: token)
                if (200...299).contains(reply.status) { return (202, ["ok": true]) }
                if reply.status == 401 {
                    forget(token)
                    return (401, ["error": "Sign in first."])
                }
                return (reply.status, ["error": (reply.json["error"] as? String) ?? "Could not send verification link."])
            } else {
                let email = Self.normalize(rawEmail ?? "")
                guard Self.emailLooksValid(email) else { return (400, ["error": "Enter a valid email address."]) }
                _ = try await call("POST", "/v1/verify/resend", body: ["email": email])
                return (202, ["ok": true])
            }
        } catch {
            return (503, ["error": TVMAccounts.unreachable])
        }
    }

    func forgotPassword(rawEmail: String?) async -> (Int, [String: Any]) {
        let email = Self.normalize(rawEmail ?? "")
        guard Self.emailLooksValid(email) else { return (400, ["error": "Enter a valid email address."]) }
        do {
            _ = try await call("POST", "/v1/password/forgot", body: ["email": email])
            return (202, ["ok": true])
        } catch {
            return (503, ["error": TVMAccounts.unreachable])
        }
    }

    func hasAdminKey() -> Bool {
        !(adminVault.read() ?? "").isEmpty
    }

    func installAdminKey(token: String?, rawKey: String) async -> (Int, [String: Any]) {
        guard let actor = await resolve(token: token) else { return (401, ["error": "Sign in first."]) }
        guard actor.isDev else { return (403, ["error": "developer_required"]) }
        guard rawKey.utf16.count <= 4096, rawKey.rangeOfCharacter(from: .newlines) == nil else {
            return (400, ["error": "invalid_key"])
        }
        let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if key.isEmpty {
            adminVault.write(nil)
            locked { configExpires = .distantPast }
            return (200, ["ok": true, "configured": false])
        }
        do {
            let reply = try await callRaw("GET", "/v1/admin/config", bearer: key)
            if (200...299).contains(reply.status) {
                adminVault.write(key)
                locked { configExpires = .distantPast }
                return (200, ["ok": true, "configured": true])
            }
            if reply.status == 401 || reply.status == 403 {
                return (403, ["error": "invalid_key"])
            }
            return (503, ["error": "TVM accounts cannot be reached."])
        } catch {
            return (503, ["error": "TVM accounts cannot be reached."])
        }
    }

    func mirrorAdmin(token: String?, v1Path: String, method: String, body: [String: Any]? = nil) async -> HTTPReply {
        guard let actor = await resolve(token: token) else { return .json(401, ["error": "Sign in first."]) }
        guard actor.isDev else { return .json(403, ["error": "developer_required"]) }
        guard let key = adminVault.read(), !key.isEmpty else { return .json(403, ["error": "admin_key_required"]) }
        do {
            let cleanPath = v1Path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            let reply = try await callRaw(method, "/v1/admin/\(cleanPath)", bearer: key, body: method == "GET" ? nil : body)
            if method != "GET" {
                locked {
                    rdCache.removeAll()
                    if cleanPath == "config" || cleanPath.hasPrefix("config?") { configExpires = .distantPast }
                }
            }
            if reply.status == 204 { return .empty(204) }
            let type = cleanPath.hasPrefix("accounts.csv") ? "text/csv; charset=utf-8" : "application/json; charset=utf-8"
            let data = reply.body.isEmpty ? Data("{}".utf8) : reply.body
            return .bytes(reply.status, type: type, data: data)
        } catch {
            return .json(503, ["error": "TVM accounts cannot be reached."])
        }
    }

    func acceptTerms(token: String) async -> Result<[String: Any], TVMAccountError> {
        do {
            let reply = try await call("POST", "/v1/me/terms", bearer: token, body: ["version": TVMAccounts.termsVersion()])
            if reply.status == 401 {
                forget(token)
                throw TVMAccountError("Sign in first.", status: 401)
            }
            guard reply.status == 200 else { throw TVMAccounts.failure(reply.status, "The terms could not be saved. Try again.") }
            guard let account = TVMAccount.from(service: reply.json["account"]) else {
                throw TVMAccountError(TVMAccounts.misunderstood, status: 503)
            }
            locked { accountCache[token] = CachedAccount(account: account, at: now()) }
            return .success(account.publicJSON())
        } catch let error as TVMAccountError {
            return .failure(error)
        } catch {
            return .failure(TVMAccountError(TVMAccounts.unreachable, status: 503))
        }
    }

    /// Saves or clears this account's own Real-Debrid key on the service.
    func setRdToken(token: String, key: String) async -> Result<[String: Any], TVMAccountError> {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.utf16.count <= 200, trimmed.rangeOfCharacter(from: .whitespacesAndNewlines) == nil else {
            return .failure(TVMAccountError("That does not look like a Real-Debrid key."))
        }
        locked { _ = rdCache.removeValue(forKey: token) }
        do {
            let reply = try await call("PUT", "/v1/me/rd-token", bearer: token, body: ["token": trimmed])
            if reply.status == 401 {
                forget(token)
                throw TVMAccountError("Sign in first.", status: 401)
            }
            guard reply.status == 200 else { throw TVMAccounts.failure(reply.status, "That key could not be saved.") }
            guard let account = TVMAccount.from(service: reply.json["account"]) else {
                throw TVMAccountError(TVMAccounts.misunderstood, status: 503)
            }
            locked { accountCache[token] = CachedAccount(account: account, at: now()) }
            return .success(account.publicJSON())
        } catch let error as TVMAccountError {
            return .failure(error)
        } catch {
            return .failure(TVMAccountError(TVMAccounts.unreachable, status: 503))
        }
    }

    #if DEBUG
    /// CI's simulator screenshot tour only (debug builds, -TVMSmokeTour): an
    /// offline stand-in for the service that answers as a switched-on test
    /// account, so the tour can reach Home. Not compiled into the app people
    /// install.
    func smokeTourToken() async -> String? {
        transport = TVMTourTransport()
        vault = TVMMemorySessionVault()
        guard case .success(let session) = await signIn(email: "tour@tvm.test", password: "simulator-tour-only", client: "ci-tour") else { return nil }
        return session["token"] as? String
    }
    #endif
}

#if DEBUG
/// The tour's offline service (see TVMAccounts.smokeTourToken).
struct TVMTourTransport: TVMAccountsTransport {
    func send(method: String, url: URL, bearer: String?, body: Data?) async throws -> (status: Int, body: Data) {
        let account: [String: Any] = [
            "id": "acc_tour", "email": "tour@tvm.test", "displayName": "Tour", "role": "member",
            "status": "active", "tier": "stream", "liveTv": false, "emailVerified": false,
            "termsVersion": TVMAccounts.termsVersion(), "hasRdToken": false,
            "createdAt": "2026-01-01T00:00:00.000Z",
        ]
        var answer: [String: Any] = ["account": account]
        if url.path == "/v1/signin" { answer["session"] = String(repeating: "t", count: 43) }
        return (200, JSONValue.data(answer))
    }
}
#endif
