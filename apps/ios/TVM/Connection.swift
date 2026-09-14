import Foundation
import Security

/// Optional home-Core pairing. Standalone mode does not use this.
struct Connection: Codable, Equatable {
    let origin: URL
    let token: String
    let allowLocalHTTP: Bool

    static func validated(address: String, token: String, allowLocalHTTP: Bool) throws -> Connection {
        let address = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard var parts = URLComponents(string: address),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.port == nil || (1...65535).contains(parts.port!) else {
            throw ClientError.message("Enter only your TVM host address and port, with no path, password or query.")
        }
        let scheme = parts.scheme?.lowercased()
        guard scheme == "https" || (scheme == "http" && allowLocalHTTP && isPrivateIPv4(host)) else {
            throw ClientError.message("Use HTTPS, or enable private LAN HTTP and enter a private IPv4 address such as http://192.168.1.20:7345.")
        }
        let cleanToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleanToken.count >= 32, cleanToken.count <= 4096,
              cleanToken.unicodeScalars.allSatisfy({ $0.value >= 33 && $0.value <= 126 }) else {
            throw ClientError.message("Paste a LAN token with at least 32 printable characters and no spaces.")
        }
        parts.scheme = scheme
        parts.path = "/"
        guard let origin = parts.url else { throw ClientError.message("This host address is not valid.") }
        return Connection(origin: origin, token: cleanToken, allowLocalHTTP: allowLocalHTTP)
    }

    static func isPrivateIPv4(_ host: String) -> Bool {
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let octets = parts.compactMap { part -> Int? in
            guard let value = Int(part), (0...255).contains(value), String(value) == part else { return nil }
            return value
        }
        guard octets.count == 4 else { return false }
        return octets[0] == 10 || (octets[0] == 172 && (16...31).contains(octets[1])) ||
            (octets[0] == 192 && octets[1] == 168)
    }

    func isSameOrigin(_ url: URL) -> Bool {
        guard let a = URLComponents(url: origin, resolvingAgainstBaseURL: false),
              let b = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return false }
        func port(_ value: URLComponents) -> Int { value.port ?? (value.scheme?.lowercased() == "https" ? 443 : 80) }
        return a.scheme?.lowercased() == b.scheme?.lowercased() &&
            a.host?.lowercased() == b.host?.lowercased() && port(a) == port(b) &&
            b.user == nil && b.password == nil
    }

    var sessionURL: URL { origin.appendingPathComponent("api/lan/session") }
}

enum ClientError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let text): return text }
    }
}

/// No token or host is stored in UserDefaults, web storage, injected scripts or logs.
enum CredentialStore {
    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "TVM.PrivateClient.Connection",
         kSecAttrAccount as String: "active"]
    }

    static func read() -> Connection? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let saved = try? JSONDecoder().decode(Connection.self, from: data) else { return nil }
        // Revalidate persisted data when the app's connection policy changes.
        return try? Connection.validated(address: saved.origin.absoluteString, token: saved.token,
                                         allowLocalHTTP: saved.allowLocalHTTP)
    }

    static func save(_ connection: Connection) throws {
        let data = try JSONEncoder().encode(connection)
        let values: [String: Any] = [kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
        var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw ClientError.message("Unable to save this connection securely. Unlock your device and retry.") }
    }

    static func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw ClientError.message("Unable to remove the saved connection. Unlock your device and retry.")
        }
    }
}
