import CommonCrypto
import Foundation
import zlib

struct TVMPrefs {
    static let defaultLanguage = "en"
    static let languages: Set<String> = ["en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh"]

    var language: String
    var autoUpdate: Bool

    static func load(_ store: TVMStore) -> TVMPrefs {
        let object = store.readJSON("prefs.json") as? [String: Any] ?? [:]
        let language = object["language"] as? String
        let allowed = language.flatMap { languages.contains($0) ? $0 : nil } ?? defaultLanguage
        let auto: Bool
        if let flag = object["autoUpdate"] as? Bool {
            auto = flag
        } else {
            auto = true
        }
        return TVMPrefs(language: allowed, autoUpdate: auto)
    }

    func save(_ store: TVMStore) {
        store.writeJSON("prefs.json", ["language": language, "autoUpdate": autoUpdate])
    }

    func json() -> [String: Any] { ["language": language, "autoUpdate": autoUpdate] }

    static func acceptLanguage(_ code: String) -> String {
        let language = languages.contains(code) ? code : defaultLanguage
        return language == "en" ? "en,en-US;q=0.9" : "\(language),en;q=0.8"
    }
}

/// What an interface bundle says about itself, from the build-info.json that
/// scripts/stamp-ui-bundle.mjs writes into it.
struct TVMBundleInfo {
    var commit: String?
    var contentHash: String?
    var nativeApi: Int

    static func read(_ root: URL) -> TVMBundleInfo {
        let url = root.appendingPathComponent("build-info.json")
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return TVMBundleInfo(commit: nil, contentHash: nil, nativeApi: 0)
        }
        let commit = (object["commit"] as? String).flatMap { $0.isEmpty ? nil : $0.lowercased() }
        let hash = (object["contentHash"] as? String).flatMap { $0.isEmpty ? nil : $0.lowercased() }
        return TVMBundleInfo(commit: commit, contentHash: hash, nativeApi: JSONValue.int(object["nativeApi"]) ?? 0)
    }
}

/**
 The interface this app serves: the copy inside the app, or a newer one
 downloaded from GitHub.

 A downloaded copy is only used on top of the exact app build it was applied
 to. It used to be used whatever app was installed, so sideloading a new IPA
 kept serving the interface downloaded by the old one — and an interface
 newer than its native half calls routes the native half does not have.
 */
enum TVMBundledUI {
    static let overlayName = "BundledUI"
    static let stagedName = "BundledUI.staged"
    static let markerName = "BundledUI.native.json"
    static let stagedMetaName = "BundledUI.staged.json"
    private static let lock = NSLock()
    /// The resolved root per store, so serving a file does not re-read two JSON files. Guarded by `lock`.
    private static var resolved: [String: URL] = [:]

    /// Every move of the bundle folders goes through here; the launch and the Updates screen can both reach them.
    static func withLock<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    static func overlayRoot(store: TVMStore) -> URL { directoryURL(store.url(overlayName)) }
    static func stagedRoot(store: TVMStore) -> URL { directoryURL(store.url(stagedName)) }

    static func bundledRoot(bundle: Bundle = .main) -> URL {
        bundle.resourceURL?.appendingPathComponent("BundledUI", isDirectory: true)
            ?? URL(fileURLWithPath: "BundledUI", isDirectory: true)
    }

    /// Always a directory URL. Recent Foundation otherwise adds a trailing
    /// slash only after the folder exists, so a URL taken before createDirectory
    /// and one taken after compared unequal and failed the simulator tests.
    private static func directoryURL(_ url: URL) -> URL {
        URL(fileURLWithPath: url.path, isDirectory: true)
    }

    /// The commit this installed app was built from (BuildInfo.json).
    static func appBuild(bundle: Bundle = .main) -> String {
        guard let url = bundle.url(forResource: "BuildInfo", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let commit = object["commit"] as? String, !commit.isEmpty else { return "unknown" }
        return commit.lowercased()
    }

    static func overlayUsable(store: TVMStore, bundle: Bundle = .main) -> Bool {
        let overlay = overlayRoot(store: store)
        guard FileManager.default.fileExists(atPath: overlay.appendingPathComponent("index.html").path),
              let marker = store.readJSON(markerName) as? [String: Any],
              let applied = marker["appBuild"] as? String,
              applied == appBuild(bundle: bundle) else { return false }
        return TVMBundleInfo.read(overlay).nativeApi <= StandalonePolicy.nativeAPI
    }

    static func root(store: TVMStore, bundle: Bundle = .main) -> URL {
        withLock { resolveLocked(store: store, bundle: bundle) }
    }

    /// For code already inside `withLock`; NSLock is not reentrant.
    private static func resolveLocked(store: TVMStore, bundle: Bundle) -> URL {
        let key = "\(store.root.path)|\(bundle.bundlePath)"
        if let hit = resolved[key] { return hit }
        let url = overlayUsable(store: store, bundle: bundle) ? overlayRoot(store: store) : bundledRoot(bundle: bundle)
        resolved[key] = url
        return url
    }

    /// After anything outside this file deletes the bundle folders (a factory reset).
    static func invalidate() {
        withLock { resolved.removeAll() }
    }

    static func commit(in root: URL) -> String? {
        TVMBundleInfo.read(root).commit
    }

    /**
     Launch housekeeping, before anything is on screen. No network.

     Drops a downloaded interface that belongs to a different app build, and
     puts a bundle staged by the previous run in place.
     */
    static func prepare(store: TVMStore, bundle: Bundle = .main) {
        withLock { () -> Void in
            resolved.removeAll()
            if !overlayUsable(store: store, bundle: bundle) {
                try? FileManager.default.removeItem(at: overlayRoot(store: store))
                store.remove(markerName)
            }
            _ = promoteLocked(store: store, bundle: bundle, onlyCommit: nil)
        }
    }

    /// Moves a verified staged bundle into place. Call inside `withLock`.
    static func promoteLocked(store: TVMStore, bundle: Bundle, onlyCommit: String?) -> [String: Any]? {
        let fm = FileManager.default
        let staged = stagedRoot(store: store)
        let stagedInfo = TVMBundleInfo.read(staged)
        guard fm.fileExists(atPath: staged.appendingPathComponent("index.html").path),
              let meta = store.readJSON(stagedMetaName) as? [String: Any],
              let stagedCommit = meta["commit"] as? String,
              let bundleCommit = stagedInfo.commit,
              TVMChangelog.sameCommit(stagedCommit, bundleCommit),
              (meta["appBuild"] as? String) == appBuild(bundle: bundle),
              stagedInfo.nativeApi <= StandalonePolicy.nativeAPI else {
            try? fm.removeItem(at: staged)
            store.remove(stagedMetaName)
            return nil
        }
        if let onlyCommit, !TVMChangelog.sameCommit(onlyCommit, stagedCommit) { return nil }
        let version = String(stagedCommit.prefix(7))
        let live = resolveLocked(store: store, bundle: bundle)
        let previous = commit(in: live)
        if let previous, TVMChangelog.sameCommit(previous, stagedCommit) {
            // Already the interface on screen; nothing to announce twice.
            try? fm.removeItem(at: staged)
            store.remove(stagedMetaName)
            return ["version": version, "commit": stagedCommit, "changed": false]
        }
        let dest = overlayRoot(store: store)
        resolved.removeAll()
        try? fm.removeItem(at: dest)
        do {
            try fm.moveItem(at: staged, to: dest)
        } catch {
            return nil
        }
        store.writeJSON(markerName, [
            "appBuild": appBuild(bundle: bundle),
            "commit": stagedCommit,
            "appliedAt": ISO8601DateFormatter().string(from: Date()),
        ])
        store.remove(stagedMetaName)
        var entries = meta["entries"] as? [[String: Any]] ?? []
        if entries.isEmpty {
            entries = [["sha": version, "title": "Interface \(version)", "body": ""]]
        }
        TVMChangelog.writePending(
            store: store,
            version: version,
            from: previous.map { String($0.prefix(7)) },
            to: stagedCommit,
            entries: entries
        )
        return ["version": version, "commit": stagedCommit, "changed": true]
    }
}

enum TVMChangelog {
    static let file = "changelog.json"
    static let limit = 12

    static func sameCommit(_ left: String, _ right: String) -> Bool {
        let a = left.lowercased()
        let b = right.lowercased()
        if a.isEmpty || b.isEmpty { return false }
        return a == b || a.hasPrefix(b) || b.hasPrefix(a)
    }

    static func skip(_ title: String) -> Bool {
        let value = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return true }
        let lower = value.lowercased()
        return lower.hasPrefix("merge pull request") || lower.hasPrefix("merge branch")
    }

    static func parseMessage(_ raw: String) -> (title: String, body: String) {
        let text = raw.replacingOccurrences(of: "\r\n", with: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let newline = text.firstIndex(of: "\n") else {
            return (String(text.prefix(160)), "")
        }
        let title = String(text[..<newline].trimmingCharacters(in: .whitespacesAndNewlines).prefix(160))
        let body = String(text[text.index(after: newline)...].trimmingCharacters(in: .whitespacesAndNewlines).prefix(600))
        return (title, body)
    }

    /// Entries from a GitHub commits listing, newest first, stopping at `current`.
    static func entries(from commits: [[String: Any]], until current: String?) -> [[String: Any]] {
        var out: [[String: Any]] = []
        for item in commits {
            let sha = item["sha"] as? String ?? ""
            if let current, sameCommit(sha, current) { break }
            let message = ((item["commit"] as? [String: Any])?["message"] as? String) ?? ""
            let parsed = parseMessage(message)
            if skip(parsed.title) { continue }
            let date = ((item["commit"] as? [String: Any])?["committer"] as? [String: Any])?["date"] as? String
                ?? ((item["commit"] as? [String: Any])?["author"] as? [String: Any])?["date"] as? String
            var row: [String: Any] = ["sha": String(sha.prefix(7)), "title": parsed.title, "body": parsed.body]
            if let date { row["date"] = date }
            out.append(row)
            if out.count >= limit { break }
        }
        return out
    }

    /**
     What changed between the running interface and a published one.

     The feed's history lists every commit, so the running build is found even
     when it changed nothing worth listing; only entries above it are new.
     Mirrors changesSince in apps/core/src/update/feed.ts.
     */
    static func changes(entries: [[String: Any]], history: [String], since current: String?) -> [[String: Any]] {
        let valid = entries.filter { ($0["title"] as? String)?.isEmpty == false }
        guard let current, !current.isEmpty else { return Array(valid.prefix(limit)) }
        if let at = history.firstIndex(where: { sameCommit($0, current) }) {
            let newer = Array(history[..<at])
            let picked = valid.filter { entry in
                let sha = entry["sha"] as? String ?? ""
                return newer.contains { sameCommit($0, sha) }
            }
            return Array(picked.prefix(limit))
        }
        var out: [[String: Any]] = []
        for entry in valid {
            if let sha = entry["sha"] as? String, sameCommit(sha, current) { break }
            out.append(entry)
            if out.count >= limit { break }
        }
        return out
    }

    static func notes(_ entries: [[String: Any]]) -> String {
        let titles = entries.compactMap { $0["title"] as? String }.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if titles.isEmpty { return "The latest TVM interface" }
        return String(titles.joined(separator: " · ").prefix(400))
    }

    static func bundled(in root: URL) -> [[String: Any]] {
        let url = root.appendingPathComponent("changelog.json")
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let entries = object["entries"] as? [[String: Any]] else { return [] }
        return entries.filter { ($0["title"] as? String)?.isEmpty == false }
    }

    static func record(store: TVMStore) -> [String: Any]? {
        store.readJSON(file) as? [String: Any]
    }

    static func writePending(store: TVMStore, version: String, from: String?, to: String?, entries: [[String: Any]]) {
        guard !entries.isEmpty else { return }
        var payload: [String: Any] = [
            "pending": true,
            "version": version,
            "appliedAt": ISO8601DateFormatter().string(from: Date()),
            "entries": entries,
        ]
        payload["from"] = from.map { $0 as Any } ?? NSNull()
        payload["to"] = to.map { $0 as Any } ?? NSNull()
        store.writeJSON(file, payload)
    }

    static func markSeen(store: TVMStore) -> [String: Any] {
        var payload = record(store: store) ?? ["pending": false, "version": "", "from": NSNull(), "to": NSNull(), "appliedAt": "", "entries": []]
        payload["pending"] = false
        store.writeJSON(file, payload)
        return payload
    }
}

/**
 Keeps the bundled interface current from GitHub.

 Reads the small manifest published next to the bundle on the `ios-ui`
 release and compares it with the interface this app is running. The check
 used to compare against the tip of GitHub main instead, which is often a
 commit that produced no new bundle: every check said "update available",
 every apply fetched the same bundle, and the page reloaded forever.

 Nothing here blocks the launch. A newer bundle is put in place as soon as
 it verifies, and the shell reloads the page so the old interface is not
 left on screen until the next open.
 */
extension Notification.Name {
    /// The on-device core put a new interface on disk. The web view should reload.
    static let tvmInterfaceDidApply = Notification.Name("tvm.interface.didApply")
}

enum TVMUpdater {
    static let repo = "GL-327/TVM"
    static let releaseTag = "ios-ui"
    static let assetName = "tvm-ios-ui.tar.gz"
    static let manifestName = "tvm-ios-ui.json"

    struct Manifest {
        var commit: String
        var asset: String
        var sha256: String
        var nativeApi: Int
        var contentHash: String
        var entries: [[String: Any]]
        var history: [String]

        static func parse(_ raw: Any?) -> Manifest? {
            guard let object = raw as? [String: Any],
                  let commit = (object["commit"] as? String)?.lowercased(),
                  commit.count >= 7, commit.allSatisfy({ $0.isHexDigit }),
                  let asset = object["asset"] as? String,
                  !asset.isEmpty, !asset.contains("/"), !asset.contains(".."),
                  let sha = (object["sha256"] as? String)?.lowercased(),
                  sha.count == 64, sha.allSatisfy({ $0.isHexDigit }) else { return nil }
            let entries = (object["entries"] as? [[String: Any]] ?? []).filter { ($0["title"] as? String)?.isEmpty == false }
            let history = (object["history"] as? [Any] ?? []).compactMap { $0 as? String }.map { $0.lowercased() }
            return Manifest(
                commit: commit,
                asset: asset,
                sha256: sha,
                nativeApi: JSONValue.int(object["nativeApi"]) ?? 0,
                contentHash: ((object["contentHash"] as? String) ?? "").lowercased(),
                entries: entries,
                history: history
            )
        }
    }

    struct Status {
        var current: String
        var currentCommit: String?
        var channel: String
        var lastCheck: String?
        var available: [String: Any]?
        var configured: Bool
        var applyAllowed: Bool
        var applyReason: String?
        var kind: String
        var notice: String?
        var autoUpdate: Bool
        var changelog: [String: Any]?

        func json() -> [String: Any] {
            [
                "current": current,
                "currentCommit": JSONValue.orNull(currentCommit),
                "channel": channel,
                "lastCheck": JSONValue.orNull(lastCheck),
                "available": available.map { $0 as Any } ?? NSNull(),
                "configured": configured,
                "applyAllowed": applyAllowed,
                "applyReason": JSONValue.orNull(applyReason),
                "kind": kind,
                "notice": JSONValue.orNull(notice),
                "autoUpdate": autoUpdate,
                "changelog": changelog.map { $0 as Any } ?? NSNull(),
            ]
        }
    }

    /// A session for GitHub downloads: no cookies, no cache, patient enough for a bundle.
    static func downloadSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 180
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpAdditionalHeaders = [
            "User-Agent": "tvm-ios",
            "Accept-Encoding": "identity",
        ]
        return URLSession(configuration: configuration)
    }

    static func downloadURL(_ file: String) -> URL {
        URL(string: "https://github.com/\(repo)/releases/download/\(releaseTag)/\(file)")!
    }

    static func sha256Hex(_ data: Data) -> String {
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { buffer in
            _ = CC_SHA256(buffer.baseAddress, CC_LONG(buffer.count), &digest)
        }
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    static func snapshot(store: TVMStore, bundle: Bundle = .main) -> Status {
        let prefs = TVMPrefs.load(store)
        let commit = TVMBundledUI.commit(in: TVMBundledUI.root(store: store, bundle: bundle))
        let cache = store.readJSON("update-status.json") as? [String: Any]
        return Status(
            current: StandalonePolicy.version,
            currentCommit: commit,
            channel: "github:\(repo)#\(releaseTag)",
            lastCheck: cache?["lastCheck"] as? String,
            available: cache?["available"] as? [String: Any],
            configured: false,
            applyAllowed: true,
            applyReason: nil,
            kind: (cache?["kind"] as? String) ?? "idle",
            notice: cache?["notice"] as? String,
            autoUpdate: prefs.autoUpdate,
            changelog: TVMChangelog.record(store: store)
        )
    }

    private enum Fetched {
        case manifest(Manifest)
        case problem(kind: String, notice: String)
    }

    private static func fetchManifest(session: URLSession) async -> Fetched {
        var request = URLRequest(url: downloadURL(manifestName))
        request.setValue("tvm-ios", forHTTPHeaderField: "User-Agent")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, response) = try await session.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 404 { return .problem(kind: "no_release", notice: "No iPhone interface is published on GitHub yet.") }
            if status == 429 { return .problem(kind: "rate_limited", notice: "GitHub rate-limited this check. Try again in a few minutes.") }
            if status == 401 || status == 403 { return .problem(kind: "auth_required", notice: "GitHub refused this check.") }
            guard (200...299).contains(status) else {
                return .problem(kind: "failed", notice: "GitHub answered \(status). Try again later.")
            }
            guard let manifest = Manifest.parse(try? JSONSerialization.jsonObject(with: data)) else {
                return .problem(kind: "failed", notice: "The update information on GitHub was incomplete.")
            }
            return .manifest(manifest)
        } catch {
            return .problem(kind: "failed", notice: "Could not reach GitHub. Check the connection and try again.")
        }
    }

    /// Checks GitHub and records the answer. Returns the manifest only when it is worth applying.
    private static func evaluate(store: TVMStore, session: URLSession, bundle: Bundle) async -> (Status, Manifest?) {
        let now = ISO8601DateFormatter().string(from: Date())
        switch await fetchManifest(session: session) {
        case .problem(let kind, let notice):
            return (remember(store: store, kind: kind, available: nil, notice: notice, lastCheck: now, bundle: bundle), nil)
        case .manifest(let manifest):
            let current = TVMBundleInfo.read(TVMBundledUI.root(store: store, bundle: bundle))
            if let commit = current.commit, TVMChangelog.sameCommit(commit, manifest.commit) {
                return (remember(store: store, kind: "up_to_date", available: nil, notice: "You have the latest interface.", lastCheck: now, bundle: bundle), nil)
            }
            // Rebuilt for a commit that changed nothing here: same files, nothing to fetch.
            if !manifest.contentHash.isEmpty, manifest.contentHash == current.contentHash {
                return (remember(store: store, kind: "up_to_date", available: nil, notice: "You have the latest interface.", lastCheck: now, bundle: bundle), nil)
            }
            if manifest.nativeApi > StandalonePolicy.nativeAPI {
                return (remember(
                    store: store,
                    kind: "app_update_required",
                    available: nil,
                    notice: "A newer TVM app is on GitHub Releases. Install it to get the latest interface.",
                    lastCheck: now,
                    bundle: bundle
                ), nil)
            }
            let changelog = TVMChangelog.changes(entries: manifest.entries, history: manifest.history, since: current.commit)
            let version = String(manifest.commit.prefix(7))
            let status = remember(
                store: store,
                kind: "available",
                available: [
                    "version": version,
                    "commit": manifest.commit,
                    "notes": TVMChangelog.notes(changelog),
                    "changelog": changelog,
                ],
                notice: "Interface \(version) is ready to apply.",
                lastCheck: now,
                bundle: bundle
            )
            return (status, manifest)
        }
    }

    static func check(store: TVMStore, session: URLSession, bundle: Bundle = .main) async throws -> Status {
        await evaluate(store: store, session: session, bundle: bundle).0
    }

    /// Downloads and verifies a bundle into the staging folder. Nothing on screen changes until it is promoted.
    static func stage(_ manifest: Manifest, store: TVMStore, session: URLSession, bundle: Bundle = .main) async throws {
        let fm = FileManager.default
        let alreadyStaged = TVMBundledUI.withLock { () -> Bool in
            guard let meta = store.readJSON(TVMBundledUI.stagedMetaName) as? [String: Any],
                  let commit = meta["commit"] as? String else { return false }
            return TVMChangelog.sameCommit(commit, manifest.commit)
                && fm.fileExists(atPath: TVMBundledUI.stagedRoot(store: store).appendingPathComponent("index.html").path)
        }
        if alreadyStaged { return }

        var request = URLRequest(url: downloadURL(manifest.asset))
        request.setValue("tvm-ios", forHTTPHeaderField: "User-Agent")
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.timeoutInterval = 120
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode), data.count > 64 else {
            throw ClientError.message("GitHub did not return the iPhone interface bundle.")
        }
        guard sha256Hex(data) == manifest.sha256 else {
            throw ClientError.message("The downloaded interface did not match its published checksum.")
        }
        let work = store.url("BundledUI.download-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: work) }
        try TVMArchive.extractTarGz(data, to: work)
        let info = TVMBundleInfo.read(work)
        guard fm.fileExists(atPath: work.appendingPathComponent("index.html").path),
              let commit = info.commit, TVMChangelog.sameCommit(commit, manifest.commit) else {
            throw ClientError.message("The downloaded interface was incomplete.")
        }
        guard info.nativeApi <= StandalonePolicy.nativeAPI else {
            throw ClientError.message("This interface needs a newer TVM app.")
        }
        let current = TVMBundledUI.commit(in: TVMBundledUI.root(store: store, bundle: bundle))
        let entries = TVMChangelog.changes(entries: manifest.entries, history: manifest.history, since: current)
        let appBuild = TVMBundledUI.appBuild(bundle: bundle)
        try TVMBundledUI.withLock { () throws -> Void in
            let staged = TVMBundledUI.stagedRoot(store: store)
            try? fm.removeItem(at: staged)
            try fm.moveItem(at: work, to: staged)
            store.writeJSON(TVMBundledUI.stagedMetaName, [
                "commit": manifest.commit,
                "appBuild": appBuild,
                "entries": entries,
                "stagedAt": ISO8601DateFormatter().string(from: Date()),
            ])
        }
    }

    /// Applies the published interface now, from the staging folder when it is already there.
    static func apply(store: TVMStore, session: URLSession, bundle: Bundle = .main) async throws -> [String: Any] {
        let (status, found) = await evaluate(store: store, session: session, bundle: bundle)
        guard let manifest = found else {
            if status.kind == "up_to_date" {
                let version = status.currentCommit.map { String($0.prefix(7)) } ?? StandalonePolicy.version
                return ["version": version, "changed": false, "restart": "reload"]
            }
            throw ClientError.message(status.notice ?? "No interface update is available.")
        }
        try await stage(manifest, store: store, session: session, bundle: bundle)
        let promoted = TVMBundledUI.withLock {
            TVMBundledUI.promoteLocked(store: store, bundle: bundle, onlyCommit: manifest.commit)
        }
        guard var result = promoted else {
            throw ClientError.message("The new interface could not be put in place. Try again.")
        }
        let version = result["version"] as? String ?? String(manifest.commit.prefix(7))
        _ = remember(
            store: store,
            kind: "up_to_date",
            available: nil,
            notice: "Applied interface \(version).",
            lastCheck: ISO8601DateFormatter().string(from: Date()),
            bundle: bundle
        )
        result["restart"] = "reload"
        result["changelog"] = TVMChangelog.record(store: store) ?? NSNull()
        return result
    }

    /// Launch, in the background: download a newer interface and put it on screen.
    /// Returns true when the files on disk changed, so the shell can reload.
    @discardableResult
    static func applyIfNeeded(store: TVMStore, session: URLSession, bundle: Bundle = .main) async -> Bool {
        guard TVMPrefs.load(store).autoUpdate else { return false }
        let (status, found) = await evaluate(store: store, session: session, bundle: bundle)
        guard status.available != nil, let manifest = found else { return false }
        do {
            try await stage(manifest, store: store, session: session, bundle: bundle)
            let promoted = TVMBundledUI.withLock {
                TVMBundledUI.promoteLocked(store: store, bundle: bundle, onlyCommit: manifest.commit)
            }
            guard let result = promoted else { return false }
            let changed = (result["changed"] as? Bool) ?? true
            if changed {
                let version = result["version"] as? String ?? String(manifest.commit.prefix(7))
                _ = remember(
                    store: store,
                    kind: "up_to_date",
                    available: nil,
                    notice: "Applied interface \(version).",
                    lastCheck: ISO8601DateFormatter().string(from: Date()),
                    bundle: bundle
                )
                await MainActor.run {
                    NotificationCenter.default.post(name: .tvmInterfaceDidApply, object: nil)
                }
            }
            return changed
        } catch {
            return false
        }
    }

    private static func remember(store: TVMStore, kind: String, available: [String: Any]?, notice: String?, lastCheck: String, bundle: Bundle) -> Status {
        var payload: [String: Any] = ["kind": kind, "lastCheck": lastCheck, "notice": JSONValue.orNull(notice)]
        if let available { payload["available"] = available }
        store.writeJSON("update-status.json", payload)
        return snapshot(store: store, bundle: bundle)
    }
}

enum TVMArchive {
    static func extractTarGz(_ archive: Data, to dest: URL) throws {
        let tar = try gunzip(archive)
        let fm = FileManager.default
        try fm.createDirectory(at: dest, withIntermediateDirectories: true)
        var offset = 0
        let block = 512
        while offset + block <= tar.count {
            let header = tar.subdata(in: offset..<(offset + block))
            if header.allSatisfy({ $0 == 0 }) { break }
            let name = tarCString(header, start: 0, length: 100)
            let prefix = tarCString(header, start: 345, length: 155)
            var full = prefix.isEmpty ? name : "\(prefix)/\(name)"
            if full.hasPrefix("./") { full.removeFirst(2) }
            let size = tarOctal(header, start: 124, length: 12)
            let type = header[156]
            offset += block
            let end = min(tar.count, offset + size)
            let payload = tar.subdata(in: offset..<end)
            offset += Int(ceil(Double(size) / Double(block))) * block
            if full.isEmpty || full.contains("..") || full.hasPrefix("/") { throw ClientError.message("refusing archive path: \(full)") }
            if full.hasPrefix("._") || full.contains("/._") || (full as NSString).lastPathComponent == ".DS_Store" { continue }
            if type == 53 || full.hasSuffix("/") {
                try fm.createDirectory(at: dest.appendingPathComponent(full), withIntermediateDirectories: true)
                continue
            }
            if type == 120 || type == 103 { continue }
            let file = dest.appendingPathComponent(full)
            try fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            try payload.write(to: file, options: .atomic)
        }
    }

    private static func tarCString(_ data: Data, start: Int, length: Int) -> String {
        let slice = data.subdata(in: start..<(start + length))
        let end = slice.firstIndex(of: 0) ?? slice.endIndex
        return String(data: slice.subdata(in: slice.startIndex..<end), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private static func tarOctal(_ data: Data, start: Int, length: Int) -> Int {
        let raw = tarCString(data, start: start, length: length).replacingOccurrences(of: " ", with: "")
        return Int(raw, radix: 8) ?? 0
    }

    private static func gunzip(_ data: Data) throws -> Data {
        var incoming = data
        var stream = z_stream()
        var status = inflateInit2_(&stream, 16 + MAX_WBITS, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size))
        guard status == Z_OK else { throw ClientError.message("gzip init failed") }
        defer { inflateEnd(&stream) }
        // Read the length before taking the mutable access: touching
        // incoming.count inside withUnsafeMutableBytes is an overlapping access
        // to the same variable, which Swift refuses.
        let incomingCount = incoming.count
        return try incoming.withUnsafeMutableBytes { src -> Data in
            guard let base = src.bindMemory(to: UInt8.self).baseAddress else { throw ClientError.message("gzip empty") }
            stream.next_in = base
            stream.avail_in = uInt(incomingCount)
            var out = Data()
            var buffer = [UInt8](repeating: 0, count: 64 * 1024)
            repeat {
                let written = buffer.withUnsafeMutableBytes { dst -> Int in
                    stream.next_out = dst.bindMemory(to: UInt8.self).baseAddress
                    stream.avail_out = uInt(dst.count)
                    status = inflate(&stream, Z_NO_FLUSH)
                    return dst.count - Int(stream.avail_out)
                }
                if written > 0 { out.append(contentsOf: buffer.prefix(written)) }
            } while status == Z_OK
            guard status == Z_STREAM_END else { throw ClientError.message("gzip corrupt") }
            return out
        }
    }
}

func extractTarGz(_ archive: Data, to dest: URL) throws {
    try TVMArchive.extractTarGz(archive, to: dest)
}
