import CoreFoundation
import Foundation
import Security

final class TVMStore {
    let root: URL
    private let fileManager = FileManager.default
    private let syncLock = NSLock()
    private var _activeDirectory: URL?
    private var _syncSuppressionCount = 0
    private var _onSyncStoreChanged: (() -> Void)?

    var onSyncStoreChanged: (() -> Void)? {
        get {
            syncLock.lock()
            defer { syncLock.unlock() }
            return _onSyncStoreChanged
        }
        set {
            syncLock.lock()
            _onSyncStoreChanged = newValue
            syncLock.unlock()
        }
    }

    func setActiveDirectory(_ dir: URL?) {
        syncLock.lock()
        _activeDirectory = dir
        syncLock.unlock()
    }

    func activeSyncDir() -> URL? {
        syncLock.lock()
        defer { syncLock.unlock() }
        return _activeDirectory
    }

    func withSyncSuppressed(_ body: () -> Void) {
        syncLock.lock()
        _syncSuppressionCount += 1
        syncLock.unlock()
        defer {
            syncLock.lock()
            _syncSuppressionCount -= 1
            syncLock.unlock()
        }
        body()
    }

    func notifySyncChanged() {
        syncLock.lock()
        let suppressed = _syncSuppressionCount > 0
        let handler = _onSyncStoreChanged
        syncLock.unlock()
        if !suppressed {
            handler?()
        }
    }

    private func dataRoot() -> URL {
        activeSyncDir() ?? root
    }
    /*
     * Profile colours, starting on the brand, matching apps/core/src/providers/profiles.ts.
     * The first hue was 350 — crimson — so the one profile a fresh install creates was
     * red: the colour the palette reserves for failure, on the screen that greets a new
     * viewer, in an app whose signature is the orbital blue (#2f6bff, hue 221). Red is left out.
     */
    private let hues = [221, 190, 145, 38, 315]

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
        setActiveDirectory(nil)
        if let children = try? fileManager.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) {
            for child in children { try? fileManager.removeItem(at: child) }
        }
        RdKeychain.clear()
        XtreamKeychain.clear()
        try? fileManager.createDirectory(at: root, withIntermediateDirectories: true)
    }

    static func strictBool(_ raw: Any?) -> Bool? {
        if let num = raw as? NSNumber {
            if CFGetTypeID(num) == CFBooleanGetTypeID() { return num.boolValue }
            return nil
        }
        return raw as? Bool
    }

    static func finiteDouble(_ raw: Any?) -> Double? {
        if raw == nil || raw is NSNull { return nil }
        if let num = raw as? NSNumber {
            if CFGetTypeID(num) == CFBooleanGetTypeID() { return nil }
            let d = num.doubleValue
            return d.isFinite ? d : nil
        }
        if let d = raw as? Double { return d.isFinite ? d : nil }
        if let i = raw as? Int { return Double(i) }
        return nil
    }

    static func strictInt(_ raw: Any?) -> Int? {
        guard let d = finiteDouble(raw), d.rounded(.towardZero) == d,
              d >= Double(Int.min), d <= Double(Int.max) else { return nil }
        return Int(d)
    }

    private func readStoredProfiles(in directory: URL) -> (activeId: String, profiles: [ProfileRecord])? {
        let path = directory.appendingPathComponent("profiles.json")
        guard let data = try? Data(contentsOf: path),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = object["profiles"] as? [[String: Any]] else { return nil }
        let knownKeys: Set<String> = ["id", "name", "hue", "created", "avatar", "kind", "maxAge", "pin", "locked"]
        var profiles: [ProfileRecord] = []
        for (index, item) in list.enumerated() {
            guard let id = item["id"] as? String, let name = item["name"] as? String else { continue }
            let kind = (item["kind"] as? String) == "kids" ? "kids" : "standard"
            let maxAge = TVMParental.normalizeAge(item["maxAge"], kind: kind) ?? TVMParental.defaultAge(kind: kind)
            let rawAvatar = (item["avatar"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
            let avatar = (rawAvatar != nil && TVMPins.isValidAvatar(rawAvatar!)) ? rawAvatar : nil
            var parsedPin: ProfilePin? = nil
            if let pinObj = item["pin"] as? [String: Any],
               let hash = pinObj["hash"] as? String, !hash.isEmpty,
               let salt = pinObj["salt"] as? String, !salt.isEmpty {
                let iter = JSONValue.int(pinObj["iter"]) ?? TVMPins.iterations
                parsedPin = ProfilePin(hash: hash, salt: salt, iter: max(1, iter))
            }
            var extra: [String: Any] = [:]
            for (k, v) in item where !knownKeys.contains(k) {
                extra[k] = v
            }
            profiles.append(
                ProfileRecord(
                    id: id,
                    name: name,
                    hue: JSONValue.int(item["hue"]) ?? hues[index % hues.count],
                    created: item["created"] as? String ?? ISO8601DateFormatter().string(from: Date()),
                    avatar: avatar,
                    kind: kind,
                    maxAge: maxAge,
                    pin: parsedPin,
                    extra: extra
                )
            )
        }
        guard let first = profiles.first else { return nil }
        let active = object["activeId"] as? String
        let activeId = profiles.contains(where: { $0.id == active }) ? (active ?? first.id) : first.id
        return (activeId, profiles)
    }

    func profiles(in directory: URL) -> (activeId: String, profiles: [ProfileRecord]) {
        if let stored = readStoredProfiles(in: directory) {
            return stored
        }
        let first = ProfileRecord(
            id: "profile-1",
            name: "Profile 1",
            hue: hues[0],
            created: ISO8601DateFormatter().string(from: Date())
        )
        writeProfiles(activeId: first.id, profiles: [first], in: directory)
        return (first.id, [first])
    }

    func profiles() -> (activeId: String, profiles: [ProfileRecord]) {
        profiles(in: dataRoot())
    }

    func writeProfiles(activeId: String, profiles: [ProfileRecord], in directory: URL) {
        try? fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("profiles.json")
        try? JSONValue.data([
            "activeId": activeId,
            "profiles": profiles.map { $0.storageJSON() },
        ]).write(to: url, options: .atomic)
        try? fileManager.createDirectory(at: profileDir(activeId, in: directory), withIntermediateDirectories: true)
    }

    func saveProfiles(activeId: String, profiles: [ProfileRecord]) {
        let dir = dataRoot()
        let previous = readStoredProfiles(in: dir)?.profiles
        writeProfiles(activeId: activeId, profiles: profiles, in: dir)
        if let previous, previous != profiles {
            notifySyncChanged()
        }
    }

    func contentCacheURL(_ name: String) -> URL {
        root.appendingPathComponent("content-cache/\(name).json")
    }

    func connectedServices(for profileId: String, in directory: URL) -> [String] {
        let url = profileDir(profileId, in: directory).appendingPathComponent("services.json")
        guard let data = try? Data(contentsOf: url),
              let doc = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = doc["connected"] as? [Any] else { return [] }
        var out: [String] = []
        for raw in arr {
            if let id = JSONValue.string(raw), !out.contains(id) { out.append(id) }
        }
        return out
    }

    func connectedServices(for profileId: String) -> [String] {
        connectedServices(for: profileId, in: dataRoot())
    }

    func saveConnectedServices(_ connected: [String], profileId: String, in directory: URL) {
        let scope = profileDir(profileId, in: directory)
        try? fileManager.createDirectory(at: scope, withIntermediateDirectories: true)
        let url = scope.appendingPathComponent("services.json")
        try? JSONValue.data(["connected": connected]).write(to: url, options: .atomic)
    }

    func saveConnectedServices(_ connected: [String], profileId: String) {
        saveConnectedServices(connected, profileId: profileId, in: dataRoot())
    }

    func removeProfileData(_ profileId: String) {
        try? fileManager.removeItem(at: profileDir(profileId))
    }

    func profileDir(_ id: String, in directory: URL) -> URL {
        directory.appendingPathComponent("profiles/\(id)", isDirectory: true)
    }

    func profileDir(_ id: String) -> URL {
        profileDir(id, in: dataRoot())
    }

    func progress(for profileId: String, in directory: URL) -> [String: ProgressEntry] {
        guard let object = try? Data(contentsOf: profileDir(profileId, in: directory).appendingPathComponent("progress.json")),
              let parsed = try? JSONSerialization.jsonObject(with: object) as? [String: [String: Any]] else { return [:] }
        var out: [String: ProgressEntry] = [:]
        for (id, entry) in parsed {
            guard let position = Self.finiteDouble(entry["position"]),
                  let duration = Self.finiteDouble(entry["duration"]) else { continue }
            out[id] = ProgressEntry(
                position: position,
                duration: duration,
                updated: entry["updated"] as? String ?? "",
                hiddenFromContinueWatching: Self.strictBool(entry["hiddenFromContinueWatching"]) == true,
                completedAt: entry["completedAt"] as? String,
                completions: Self.strictInt(entry["completions"]) ?? 0,
                completedTitle: entry["completedTitle"] as? String,
                completedYear: Self.strictInt(entry["completedYear"]),
                syncPresentKeys: Set(entry.keys)
            )
        }
        return out
    }

    func progress(for profileId: String) -> [String: ProgressEntry] {
        progress(for: profileId, in: dataRoot())
    }

    func writeProgressMap(_ all: [String: ProgressEntry], profileId: String, in directory: URL) {
        let body = all.mapValues { entry -> [String: Any] in
            var value: [String: Any] = [
                "position": entry.position,
                "duration": entry.duration,
                "updated": entry.updated,
            ]
            if entry.syncPresentKeys.isEmpty {
                value["completions"] = entry.completions
                if entry.hiddenFromContinueWatching { value["hiddenFromContinueWatching"] = true }
            } else {
                if entry.syncPresentKeys.contains("completions") || entry.completions != 0 {
                    value["completions"] = entry.completions
                }
                if entry.syncPresentKeys.contains("hiddenFromContinueWatching") || entry.hiddenFromContinueWatching {
                    value["hiddenFromContinueWatching"] = entry.hiddenFromContinueWatching
                }
            }
            if let completedAt = entry.completedAt { value["completedAt"] = completedAt }
            if let completedTitle = entry.completedTitle { value["completedTitle"] = completedTitle }
            if let completedYear = entry.completedYear {
                value["completedYear"] = completedYear
            } else if entry.syncPresentKeys.contains("completedYear") {
                value["completedYear"] = NSNull()
            }
            return value
        }
        let scope = profileDir(profileId, in: directory)
        try? fileManager.createDirectory(at: scope, withIntermediateDirectories: true)
        try? JSONValue.data(body).write(to: scope.appendingPathComponent("progress.json"), options: .atomic)
    }

    private func saveProgressMap(_ all: [String: ProgressEntry], profileId: String) {
        writeProgressMap(all, profileId: profileId, in: dataRoot())
        notifySyncChanged()
    }

    func writeProgress(profileId: String, id: String, position: Double, duration: Double) {
        guard !id.isEmpty, position.isFinite, duration.isFinite, position >= 0, duration > 0 else { return }
        var all = progress(for: profileId)
        let previous = all[id]
        let now = ISO8601DateFormatter().string(from: Date())
        let finished = position / duration > 0.96
        all[id] = ProgressEntry(
            position: position,
            duration: duration,
            updated: now,
            hiddenFromContinueWatching: false,
            completedAt: finished && previous?.isFinished != true ? now : previous?.completedAt ?? (finished ? now : nil),
            completions: max(previous?.completions ?? 0, previous?.isFinished == true ? 1 : 0) + (finished && previous?.isFinished != true ? 1 : 0),
            completedTitle: previous?.completedTitle,
            completedYear: previous?.completedYear
        )
        saveProgressMap(all, profileId: profileId)
    }

    func removeContinueWatching(profileId: String, id: String) {
        guard !id.isEmpty else { return }
        var all = progress(for: profileId)
        var changed = false
        for (key, var entry) in all {
            if (key == id || key.hasPrefix(id + ":")) && !entry.hiddenFromContinueWatching && !entry.isFinished {
                entry.hiddenFromContinueWatching = true
                entry.syncPresentKeys.insert("hiddenFromContinueWatching")
                all[key] = entry
                changed = true
            }
        }
        if changed { saveProgressMap(all, profileId: profileId) }
    }

    func setWatched(profileId: String, id: String, watched: Bool) {
        guard !id.isEmpty else { return }
        var all = progress(for: profileId)
        let old = all[id]
        if watched {
            if old?.isFinished == true { return }
            let duration = (old?.duration ?? 0) > 0 ? old!.duration : 1
            writeProgress(profileId: profileId, id: id, position: duration, duration: duration)
        } else if let old {
            all[id] = ProgressEntry(
                position: 0,
                duration: old.duration,
                updated: ISO8601DateFormatter().string(from: Date()),
                hiddenFromContinueWatching: old.hiddenFromContinueWatching,
                completedAt: nil,
                completions: old.completions,
                completedTitle: old.completedTitle,
                completedYear: old.completedYear
            )
            saveProgressMap(all, profileId: profileId)
        }
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

    func watchlist(for profileId: String, in directory: URL) -> [MediaItem] {
        guard let data = try? Data(contentsOf: profileDir(profileId, in: directory).appendingPathComponent("watchlist.json")),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [Any] else { return [] }
        return parsed.compactMap(MediaItem.parse)
    }

    func watchlist(for profileId: String) -> [MediaItem] {
        watchlist(for: profileId, in: dataRoot())
    }

    func writeWatchlistItems(_ items: [MediaItem], profileId: String, in directory: URL) {
        let scope = profileDir(profileId, in: directory)
        try? fileManager.createDirectory(at: scope, withIntermediateDirectories: true)
        try? JSONValue.data(items.prefix(200).map { $0.json() })
            .write(to: scope.appendingPathComponent("watchlist.json"), options: .atomic)
    }

    func writeWatchlist(profileId: String, items: [MediaItem]) {
        writeWatchlistItems(items, profileId: profileId, in: dataRoot())
        notifySyncChanged()
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
