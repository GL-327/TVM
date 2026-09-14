import Foundation
import Security

final class TVMStore {
    let root: URL
    private let fileManager = FileManager.default
    private let hues = [350, 220, 140, 32, 280]

    init() {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        root = base.appendingPathComponent("TVM", isDirectory: true)
        try? fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    }

    func url(_ name: String) -> URL { root.appendingPathComponent(name) }

    func readJSON(_ name: String) -> Any? {
        guard let data = try? Data(contentsOf: url(name)) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    func writeJSON(_ name: String, _ value: Any) {
        try? fileManager.createDirectory(at: url(name).deletingLastPathComponent(), withIntermediateDirectories: true)
        try? JSONValue.data(value).write(to: url(name), options: .atomic)
    }

    func remove(_ name: String) {
        try? fileManager.removeItem(at: url(name))
    }

    func clearCacheFiles() {
        remove("catalog-cache.json")
    }

    func factoryReset() {
        if let children = try? fileManager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
            for child in children { try? fileManager.removeItem(at: child) }
        }
        RdKeychain.clear()
        XtreamKeychain.clear()
        try? fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    }

    func profiles() -> (activeId: String, profiles: [ProfileRecord]) {
        if let object = readJSON("profiles.json") as? [String: Any],
           let list = object["profiles"] as? [[String: Any]] {
            let profiles = list.compactMap { item -> ProfileRecord? in
                guard let id = item["id"] as? String, let name = item["name"] as? String else { return nil }
                return ProfileRecord(
                    id: id,
                    name: name,
                    hue: item["hue"] as? Int ?? 220,
                    created: item["created"] as? String ?? ISO8601DateFormatter().string(from: Date())
                )
            }
            if let first = profiles.first {
                let active = object["activeId"] as? String
                let activeId = profiles.contains(where: { $0.id == active }) ? (active ?? first.id) : first.id
                return (activeId, profiles)
            }
        }
        let first = ProfileRecord(
            id: "profile-1",
            name: "Profile 1",
            hue: hues[0],
            created: ISO8601DateFormatter().string(from: Date())
        )
        saveProfiles(activeId: first.id, profiles: [first])
        return (first.id, [first])
    }

    func saveProfiles(activeId: String, profiles: [ProfileRecord]) {
        writeJSON("profiles.json", [
            "activeId": activeId,
            "profiles": profiles.map { $0.json() },
        ])
        try? fileManager.createDirectory(at: profileDir(activeId), withIntermediateDirectories: true)
    }

    func profileDir(_ id: String) -> URL {
        root.appendingPathComponent("profiles/\(id)", isDirectory: true)
    }

    func progress(for profileId: String) -> [String: ProgressEntry] {
        guard let object = try? Data(contentsOf: profileDir(profileId).appendingPathComponent("progress.json")),
              let parsed = try? JSONSerialization.jsonObject(with: object) as? [String: [String: Any]] else { return [:] }
        var out: [String: ProgressEntry] = [:]
        for (id, entry) in parsed {
            guard let position = entry["position"] as? Double, let duration = entry["duration"] as? Double else { continue }
            out[id] = ProgressEntry(
                position: position,
                duration: duration,
                updated: entry["updated"] as? String ?? ""
            )
        }
        return out
    }

    func writeProgress(profileId: String, id: String, position: Double, duration: Double) {
        var all = progress(for: profileId)
        all[id] = ProgressEntry(position: position, duration: duration, updated: ISO8601DateFormatter().string(from: Date()))
        let body = all.mapValues { ["position": $0.position, "duration": $0.duration, "updated": $0.updated] }
        try? fileManager.createDirectory(at: profileDir(profileId), withIntermediateDirectories: true)
        try? JSONValue.data(body).write(to: profileDir(profileId).appendingPathComponent("progress.json"), options: .atomic)
    }

    func watchlist(for profileId: String) -> [MediaItem] {
        guard let data = try? Data(contentsOf: profileDir(profileId).appendingPathComponent("watchlist.json")),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
        return parsed.compactMap(MediaItem.parse)
    }

    func writeWatchlist(profileId: String, items: [MediaItem]) {
        try? fileManager.createDirectory(at: profileDir(profileId), withIntermediateDirectories: true)
        try? JSONValue.data(items.prefix(200).map { $0.json() })
            .write(to: profileDir(profileId).appendingPathComponent("watchlist.json"), options: .atomic)
    }

    func personalExport(activeId: String, profiles: [ProfileRecord], billing: [String: Any]) -> [String: Any] {
        [
            "format": "tvm-personal-data-v1",
            "exportedAt": ISO8601DateFormatter().string(from: Date()),
            "policyVersion": "2026-09-12",
            "activeProfileId": activeId,
            "profiles": profiles.map { profile in
                [
                    "id": profile.id,
                    "name": profile.name,
                    "created": profile.created,
                    "progress": progress(for: profile.id).mapValues {
                        ["position": $0.position, "duration": $0.duration, "updated": $0.updated]
                    },
                    "watchlist": watchlist(for: profile.id).map { item -> [String: Any] in
                        ["id": item.id, "title": item.title, "year": JSONValue.orNull(item.year), "added": item.added ?? ""]
                    },
                ]
            },
            "billing": billing,
            "exclusions": [
                "Provider passwords and tokens",
                "Playlist URLs and contents",
                "Encryption keys",
                "Other services’ account data",
            ],
        ]
    }
}

enum RdKeychain {
    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "TVM.Standalone.RealDebrid",
            kSecAttrAccount as String: "token",
        ]
    }

    static func read() -> String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let token = String(data: data, encoding: .utf8), !token.isEmpty else { return nil }
        return token
    }

    static func save(_ token: String) throws {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            clear()
            return
        }
        let values: [String: Any] = [
            kSecValueData as String: Data(trimmed.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        var status = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil)
        }
        guard status == errSecSuccess else {
            throw ClientError.message("Unable to save the Real-Debrid token. Unlock your device and retry.")
        }
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

enum XtreamKeychain {
    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "TVM.Standalone.Xtream",
            kSecAttrAccount as String: "password",
        ]
    }

    static func read() -> String? {
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ password: String) {
        let values: [String: Any] = [
            kSecValueData as String: Data(password.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        if SecItemUpdate(query as CFDictionary, values as CFDictionary) == errSecItemNotFound {
            SecItemAdd(query.merging(values) { _, new in new } as CFDictionary, nil)
        }
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }
}
