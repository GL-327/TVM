import Foundation
import Security

final class TVMStore {
    let root: URL
    private let fileManager = FileManager.default
    /*
     * Profile colours, starting on the brand, matching apps/core/src/providers/profiles.ts.
     * The first hue was 350 — crimson — so the one profile a fresh install creates was
     * red: the colour the palette reserves for failure, on the screen that greets a new
     * viewer, in an app whose signature is violet (#7c4dff, hue 256). Red is left out.
     */
    private let hues = [256, 190, 145, 38, 315]

    init(root testRoot: URL? = nil) {
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        root = testRoot ?? base.appendingPathComponent("TVM", isDirectory: true)
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
                updated: entry["updated"] as? String ?? "",
                completedAt: entry["completedAt"] as? String,
                completions: entry["completions"] as? Int ?? 0
            )
        }
        return out
    }

    func writeProgress(profileId: String, id: String, position: Double, duration: Double) {
        guard !id.isEmpty, position.isFinite, duration.isFinite, position >= 0, duration > 0 else { return }
        var all = progress(for: profileId)
        let previous = all[id]
        let now = ISO8601DateFormatter().string(from: Date())
        let finished = position / duration > 0.96
        all[id] = ProgressEntry(position: position, duration: duration, updated: now,
            completedAt: finished && previous?.isFinished != true ? now : previous?.completedAt ?? (finished ? now : nil),
            completions: max(previous?.completions ?? 0, previous?.isFinished == true ? 1 : 0) + (finished && previous?.isFinished != true ? 1 : 0))
        let body = all.mapValues { entry -> [String: Any] in
            var value: [String: Any] = ["position": entry.position, "duration": entry.duration, "updated": entry.updated, "completions": entry.completions]
            if let completedAt = entry.completedAt { value["completedAt"] = completedAt }
            return value
        }
        try? fileManager.createDirectory(at: profileDir(profileId), withIntermediateDirectories: true)
        try? JSONValue.data(body).write(to: profileDir(profileId).appendingPathComponent("progress.json"), options: .atomic)
    }

    // Only the caller's confirmed completed media enter this profile's notebook.
    func finishedNotebook(profileId: String, items: [MediaItem]) -> [[String: Any]] {
        let path = profileDir(profileId).appendingPathComponent("finished-notebook.json")
        var saved: [[String: Any]] = []
        if let data = try? Data(contentsOf: path), let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] { saved = rows }
        let progress = self.progress(for: profileId)
        let completed = items.filter { progress[$0.id]?.isFinished == true || progress[$0.id]?.completedAt != nil }
        let ids = Set(completed.map(\.id))
        let rows: [[String: Any]] = completed.map { ["id": $0.id, "title": $0.title, "year": JSONValue.orNull($0.year)] } + saved.filter { !ids.contains($0["id"] as? String ?? "") }
        if !completed.isEmpty { try? JSONValue.data(rows).write(to: path, options: .atomic) }
        return rows
    }

    func recentMedia(for profileId: String) -> [MediaItem] {
        guard let data = try? Data(contentsOf: profileDir(profileId).appendingPathComponent("recent-media.json")),
              let raw = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
        return raw.compactMap(MediaItem.parse)
    }

    func rememberMedia(_ items: [MediaItem], profileId: String) {
        let ids = Set(items.map(\.id))
        let saved = Array((items + recentMedia(for: profileId).filter { !ids.contains($0.id) }).prefix(300))
        try? fileManager.createDirectory(at: profileDir(profileId), withIntermediateDirectories: true)
        try? JSONValue.data(saved.map { $0.json() }).write(to: profileDir(profileId).appendingPathComponent("recent-media.json"), options: .atomic)
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
