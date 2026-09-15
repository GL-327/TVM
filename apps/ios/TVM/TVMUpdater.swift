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

enum TVMBundledUI {
    static func overlayRoot(store: TVMStore) -> URL {
        store.url("BundledUI")
    }

    static func root(store: TVMStore, bundle: Bundle = .main) -> URL {
        let overlay = overlayRoot(store: store).appendingPathComponent("index.html")
        if FileManager.default.fileExists(atPath: overlay.path) {
            return overlayRoot(store: store)
        }
        return bundle.resourceURL?.appendingPathComponent("BundledUI", isDirectory: true)
            ?? URL(fileURLWithPath: "BundledUI")
    }

    static func commit(in root: URL) -> String? {
        let url = root.appendingPathComponent("build-info.json")
        guard let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let commit = object["commit"] as? String, !commit.isEmpty else { return nil }
        return commit
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

    static func notes(_ entries: [[String: Any]]) -> String {
        let titles = entries.compactMap { $0["title"] as? String }.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if titles.isEmpty { return "Latest GitHub main" }
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

enum TVMUpdater {
    static let repo = "GL-327/TVM"
    static let releaseTag = "ios-ui"
    static let assetName = "tvm-ios-ui.tar.gz"

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

    /// Cold start: pull the latest bundled UI from GitHub unless the user turned automatic updates off.
    static func applyIfNeeded(store: TVMStore, session: URLSession, bundle: Bundle = .main) async {
        let prefs = TVMPrefs.load(store)
        guard prefs.autoUpdate else { return }
        do {
            let status = try await check(store: store, session: session, bundle: bundle)
            guard status.available != nil else { return }
            _ = try await apply(store: store, session: session, bundle: bundle)
        } catch {
            // Stay on the IPA copy. The Updates screen can retry.
        }
    }

    static func check(store: TVMStore, session: URLSession, bundle: Bundle = .main) async throws -> Status {
        let current = TVMBundledUI.commit(in: TVMBundledUI.root(store: store, bundle: bundle))
        let url = URL(string: "https://api.github.com/repos/\(repo)/commits?sha=main&per_page=20")!
        var request = URLRequest(url: url)
        request.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        request.setValue("tvm-ios", forHTTPHeaderField: "User-Agent")
        request.setValue("2022-11-28", forHTTPHeaderField: "X-GitHub-Api-Version")
        let (data, response) = try await session.data(for: request)
        let http = response as? HTTPURLResponse
        let now = ISO8601DateFormatter().string(from: Date())
        if http?.statusCode == 429 {
            return remember(store: store, kind: "rate_limited", available: nil, notice: "GitHub rate-limited this check. Try again in a minute.", lastCheck: now, bundle: bundle)
        }
        if http?.statusCode == 401 || http?.statusCode == 403 {
            return remember(store: store, kind: "auth_required", available: nil, notice: "GitHub rejected this check.", lastCheck: now, bundle: bundle)
        }
        guard let http, (200...299).contains(http.statusCode),
              let payload = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
              let head = payload.first,
              let sha = head["sha"] as? String, sha.count >= 7 else {
            return remember(store: store, kind: "no_release", available: nil, notice: "Could not read GitHub main.", lastCheck: now, bundle: bundle)
        }
        if let current, TVMChangelog.sameCommit(current, sha) {
            return remember(store: store, kind: "up_to_date", available: nil, notice: "You are on the latest GitHub build.", lastCheck: now, bundle: bundle)
        }
        let changelog = TVMChangelog.entries(from: payload, until: current)
        let notes = TVMChangelog.notes(changelog)
        return remember(
            store: store,
            kind: "available",
            available: [
                "version": String(sha.prefix(7)),
                "commit": sha,
                "notes": notes,
                "changelog": changelog,
            ] as [String: Any],
            notice: "GitHub main moved. This iPhone will apply the new interface.",
            lastCheck: now,
            bundle: bundle
        )
    }

    static func apply(store: TVMStore, session: URLSession, bundle: Bundle = .main) async throws -> [String: Any] {
        let dest = TVMBundledUI.overlayRoot(store: store)
        let from = TVMBundledUI.commit(in: TVMBundledUI.root(store: store, bundle: bundle))
        let cached = store.readJSON("update-status.json") as? [String: Any]
        let cachedAvailable = cached?["available"] as? [String: Any]
        let urls = [
            URL(string: "https://github.com/\(repo)/releases/download/\(releaseTag)/\(assetName)")!,
            URL(string: "https://github.com/\(repo)/releases/latest/download/\(assetName)")!,
        ]
        var lastError: Error = ClientError.message("The iPhone UI bundle was missing on GitHub.")
        for url in urls {
            do {
                var request = URLRequest(url: url)
                request.setValue("tvm-ios", forHTTPHeaderField: "User-Agent")
                request.timeoutInterval = 90
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode), data.count > 64 else {
                    lastError = ClientError.message("GitHub did not return an iPhone UI bundle.")
                    continue
                }
                let staging = dest.deletingLastPathComponent().appendingPathComponent("BundledUI.next")
                try? FileManager.default.removeItem(at: staging)
                try extractTarGz(data, to: staging)
                guard FileManager.default.fileExists(atPath: staging.appendingPathComponent("index.html").path) else {
                    throw ClientError.message("The update archive did not contain index.html.")
                }
                try? FileManager.default.removeItem(at: dest)
                try FileManager.default.moveItem(at: staging, to: dest)
                let commit = TVMBundledUI.commit(in: dest)
                let version = commit.map { String($0.prefix(7)) } ?? StandalonePolicy.version
                var entries = cachedAvailable?["changelog"] as? [[String: Any]] ?? []
                if entries.isEmpty { entries = TVMChangelog.bundled(in: dest) }
                if entries.isEmpty, let notes = cachedAvailable?["notes"] as? String, !notes.isEmpty {
                    entries = [["sha": version, "title": notes, "body": ""]]
                }
                TVMChangelog.writePending(store: store, version: version, from: from, to: commit, entries: entries)
                _ = remember(
                    store: store,
                    kind: "up_to_date",
                    available: nil,
                    notice: "Applied GitHub build \(version).",
                    lastCheck: ISO8601DateFormatter().string(from: Date()),
                    bundle: bundle
                )
                var result: [String: Any] = ["version": version]
                if let commit { result["commit"] = commit }
                result["changelog"] = TVMChangelog.record(store: store) ?? NSNull()
                return result
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    private static func remember(store: TVMStore, kind: String, available: [String: Any]?, notice: String?, lastCheck: String, bundle: Bundle) -> Status {
        var payload: [String: Any] = ["kind": kind, "lastCheck": lastCheck, "notice": notice as Any]
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
        return try incoming.withUnsafeMutableBytes { src -> Data in
            guard let base = src.bindMemory(to: UInt8.self).baseAddress else { throw ClientError.message("gzip empty") }
            stream.next_in = base
            stream.avail_in = uInt(incoming.count)
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
