import Foundation

struct RdDownload {
    var id: String
    var filename: String
    var mimeType: String?
    var link: String
}

struct RdTorrent {
    var id: String
    var filename: String
    var status: String
    var progress: Double
    var links: [String]
}

struct RdTorrentFile {
    var id: Int
    var path: String
    var selected: Int
}

struct RdTorrentInfo {
    var id: String
    var filename: String
    var status: String
    var progress: Double
    var links: [String]
    var files: [RdTorrentFile]
}

struct RdUnrestrict {
    var id: String
    var filename: String
    var mimeType: String?
    var download: String
}

struct RdStream {
    var url: String
    var title: String
    var name: String
    var infoHash: String?
    var fileIdx: Int?
    var quality: Int
    var cached: Bool
    var phoneHint: Bool
}

final class NoFollowRedirects: NSObject, URLSessionTaskDelegate {
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

enum RdClientError: Error, Equatable {
    case notConfigured
    case needsAuth
    case failed(String)
}

final class TVMRealDebrid {
    private let session: URLSession
    private let redirectSession: URLSession
    /// Tests inject a token so XCTest does not have to write the device Keychain.
    var testToken: String?
    var ignoreKeychain = false

    private static let torrentioHosts = [
        "https://torrentio.strem.fun",
        "https://torrentio.elfhosted.com",
    ]

    init(session: URLSession, redirectSession: URLSession? = nil) {
        self.session = session
        if let redirectSession {
            self.redirectSession = redirectSession
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.timeoutIntervalForRequest = 20
            self.redirectSession = URLSession(configuration: configuration, delegate: NoFollowRedirects(), delegateQueue: nil)
        }
    }

    func configured() -> Bool { tokenValue() != nil }
    func tokenValue() -> String? {
        if ignoreKeychain { return testToken }
        if let testToken, !testToken.isEmpty { return testToken }
        return RdKeychain.read()
    }

    func setToken(_ token: String) async throws -> RdStatus {
        try RdKeychain.save(token)
        if token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return RdStatus(configured: false, username: nil, premium: false, error: nil)
        }
        return await status()
    }

    func status() async -> RdStatus {
        guard configured() else {
            return RdStatus(configured: false, username: nil, premium: false, error: nil)
        }
        do {
            let user = try await requestJSON("/user") as? [String: Any]
            return RdStatus(
                configured: true,
                username: JSONValue.string(user?["username"]),
                premium: (JSONValue.int(user?["premium"]) ?? 0) > 0,
                error: nil
            )
        } catch RdClientError.needsAuth {
            return RdStatus(configured: true, username: nil, premium: false, error: "needs-auth")
        } catch {
            return RdStatus(configured: true, username: nil, premium: false, error: "unreachable")
        }
    }

    func downloads() async throws -> [RdDownload] {
        var collected: [RdDownload] = []
        for offset in stride(from: 0, to: 500, by: 100) {
            let page = try await requestList("/downloads?limit=100&offset=\(offset)")
            if page.isEmpty { break }
            collected.append(contentsOf: page.compactMap { raw in
                guard let id = raw["id"] as? String, let filename = raw["filename"] as? String,
                      let link = raw["link"] as? String else { return nil }
                return RdDownload(id: id, filename: filename, mimeType: raw["mimeType"] as? String, link: link)
            })
            if page.count < 100 { break }
        }
        return collected
    }

    func torrents() async throws -> [RdTorrent] {
        var collected: [RdTorrent] = []
        for page in 1...10 {
            let batch = try await requestList("/torrents?limit=100&page=\(page)")
            if batch.isEmpty { break }
            collected.append(contentsOf: batch.compactMap { raw in
                guard let id = raw["id"] as? String, let filename = raw["filename"] as? String else { return nil }
                return RdTorrent(
                    id: id,
                    filename: filename,
                    status: raw["status"] as? String ?? "",
                    progress: (raw["progress"] as? Double) ?? (raw["progress"] as? Int).map(Double.init) ?? 0,
                    links: raw["links"] as? [String] ?? []
                )
            })
            if batch.count < 100 { break }
        }
        return collected
    }

    func torrentInfo(_ id: String) async throws -> RdTorrentInfo {
        guard let raw = try await requestJSON("/torrents/info/\(id)") as? [String: Any] else {
            throw RdClientError.failed("torrent info")
        }
        let files = (raw["files"] as? [[String: Any]] ?? []).compactMap { file -> RdTorrentFile? in
            guard let fileId = JSONValue.int(file["id"]), let path = file["path"] as? String else { return nil }
            return RdTorrentFile(id: fileId, path: path, selected: JSONValue.int(file["selected"]) ?? 0)
        }
        let progress = (raw["progress"] as? Double)
            ?? (raw["progress"] as? NSNumber)?.doubleValue
            ?? Double(JSONValue.int(raw["progress"]) ?? 0)
        return RdTorrentInfo(
            id: JSONValue.string(raw["id"]) ?? id,
            filename: JSONValue.string(raw["filename"]) ?? "",
            status: JSONValue.string(raw["status"]) ?? "",
            progress: progress,
            links: raw["links"] as? [String] ?? [],
            files: files
        )
    }

    func addMagnet(_ hashOrMagnet: String) async throws -> String {
        let magnet = hashOrMagnet.lowercased().hasPrefix("magnet:")
            ? hashOrMagnet
            : "magnet:?xt=urn:btih:\(hashOrMagnet)"
        let body = "magnet=\(JSONValue.formEncode(magnet))"
        guard let raw = try await requestJSON("/torrents/addMagnet", method: "POST", form: body) as? [String: Any],
              let id = JSONValue.string(raw["id"]) else {
            throw RdClientError.failed("add magnet")
        }
        return id
    }

    func selectTorrentFiles(_ id: String, files: String = "all") async throws {
        _ = try await requestJSON("/torrents/selectFiles/\(id)", method: "POST", form: "files=\(JSONValue.formEncode(files))")
    }

    func waitForTorrentLinks(_ id: String, attempts: Int = 10) async throws -> [String] {
        for step in 0..<attempts {
            let info = try await torrentInfo(id)
            if info.status == "waiting_files_selection" || (info.links.isEmpty && info.status == "downloaded") {
                try? await selectTorrentFiles(id)
            }
            if !info.links.isEmpty, info.status == "downloaded" || info.progress >= 99 {
                return info.links.filter { !$0.isEmpty }
            }
            if info.status == "error" || info.status == "virus" || info.status == "dead" {
                throw RdClientError.failed("torrent \(info.status)")
            }
            if step + 1 < attempts {
                try await Task.sleep(nanoseconds: 500_000_000)
            }
        }
        let last = try await torrentInfo(id)
        if !last.links.isEmpty { return last.links.filter { !$0.isEmpty } }
        throw RdClientError.failed("torrent not ready")
    }

    func unrestrict(link: String) async throws -> RdUnrestrict {
        let body = "link=\(JSONValue.formEncode(link))"
        guard let raw = try await requestJSON("/unrestrict/link", method: "POST", form: body) as? [String: Any],
              let download = raw["download"] as? String, !download.isEmpty else {
            throw RdClientError.failed("unrestrict")
        }
        return RdUnrestrict(
            id: raw["id"] as? String ?? "",
            filename: raw["filename"] as? String ?? "stream",
            mimeType: raw["mimeType"] as? String,
            download: download
        )
    }

    func appleTranscode(id: String, maxHeight: Int) async -> (url: String, mime: String)? {
        do {
            let raw = try await requestJSON("/streaming/transcode/\(id)")
            guard let object = raw as? [String: Any] else { return nil }
            return TVMPlayback.appleTranscode(object, maxHeight: maxHeight)
        } catch {
            return nil
        }
    }

    func resolveRedirect(_ url: String) async -> String? {
        guard let target = URL(string: url) else { return nil }
        if !isTorrentioHost(url) { return url }
        var current = target
        for _ in 0..<3 {
            var request = URLRequest(url: current)
            request.setValue("tvm-core", forHTTPHeaderField: "User-Agent")
            request.setValue("*/*", forHTTPHeaderField: "Accept")
            do {
                let (data, response) = try await redirectSession.data(for: request)
                guard let http = response as? HTTPURLResponse else { return nil }
                if let location = http.value(forHTTPHeaderField: "Location"), let next = URL(string: location, relativeTo: current) {
                    if isTorrentioHost(next.absoluteString) {
                        current = next.absoluteURL
                        continue
                    }
                    return next.absoluteURL.absoluteString
                }
                if let type = http.value(forHTTPHeaderField: "Content-Type"), type.lowercased().contains("json"),
                   let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let next = body["url"] as? String, next.hasPrefix("http") {
                    if isTorrentioHost(next) {
                        current = URL(string: next) ?? current
                        continue
                    }
                    return next
                }
                if let final = http.url, !isTorrentioHost(final.absoluteString) {
                    return final.absoluteString
                }
                return nil
            } catch {
                return nil
            }
        }
        return nil
    }

    func torrentioStreams(token: String, imdb: String, season: Int?, episode: Int?) async -> [RdStream] {
        let encoded = JSONValue.formEncode(token)
        var paths: [String] = []
        guard let id = TVMTitle.extractImdb(imdb) else { return [] }
        if let season, let episode {
            paths = [
                "stream/series/\(id):\(season):\(episode).json",
                "stream/series/\(id):\(season):\(String(format: "%02d", episode)).json",
            ]
        } else {
            paths = ["stream/movie/\(id).json", "stream/series/\(id).json"]
        }
        var streams: [RdStream] = []
        var seen = Set<String>()
        for host in Self.torrentioHosts {
            for path in paths {
                guard let url = URL(string: "\(host)/realdebrid=\(encoded)/\(path)") else { continue }
                var request = URLRequest(url: url)
                request.setValue("tvm-core", forHTTPHeaderField: "User-Agent")
                request.setValue("application/json", forHTTPHeaderField: "Accept")
                request.timeoutInterval = 20
                guard let (data, response) = try? await session.data(for: request),
                      let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                      let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let list = body["streams"] as? [[String: Any]] else { continue }
                for raw in list {
                    guard let stream = parseDebridStream(raw) else { continue }
                    let key = stream.url.isEmpty ? (stream.infoHash ?? "") : stream.url
                    guard !key.isEmpty, seen.insert(key).inserted else { continue }
                    streams.append(stream)
                }
                if !streams.isEmpty { break }
            }
            if !streams.isEmpty { break }
        }
        return streams.sorted { left, right in
            if left.cached != right.cached { return left.cached && !right.cached }
            if left.phoneHint != right.phoneHint { return left.phoneHint && !right.phoneHint }
            return left.quality > right.quality
        }
    }

    func parseDebridStream(_ raw: [String: Any]) -> RdStream? {
        let url = JSONValue.string(raw["url"]) ?? ""
        let infoHash = JSONValue.string(raw["infoHash"]) ?? JSONValue.string(raw["info_hash"])
        if url.isEmpty && (infoHash == nil || infoHash?.isEmpty == true) { return nil }
        if url.range(of: #"failed_access|videos/failed|copyright|infringement"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return nil
        }
        let name = JSONValue.string(raw["name"]) ?? ""
        let title = (JSONValue.string(raw["title"]) ?? name).split(separator: "\n").first.map(String.init) ?? "Stream"
        let label = "\(name) \(title)"
        if label.range(of: #"\b(cam|camrip|telesync|tsrip|hdcam|hdts)\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
            return nil
        }
        let phoneHint = label.range(
            of: #"\b(mp4|m4v|mov|h264|x264|avc|aac|hls|m3u8)\b"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
        let cached = label.range(of: #"⚡|\bcached\b|\brd\+|\bdownloaded\b"#, options: [.regularExpression, .caseInsensitive]) != nil
        return RdStream(
            url: url,
            title: title,
            name: name,
            infoHash: infoHash,
            fileIdx: JSONValue.int(raw["fileIdx"]) ?? JSONValue.int(raw["fileidx"]),
            quality: qualityScore(label),
            cached: cached,
            phoneHint: phoneHint
        )
    }

    func needsUnrestrict(_ url: String) -> Bool {
        if url.range(of: "download.real-debrid.com", options: .caseInsensitive) != nil { return false }
        if url.range(of: "real-debrid.com/d/", options: .caseInsensitive) != nil { return true }
        return url.range(of: #"\.(m3u8|mp4|m4v|mkv|webm|mov|avi|ts|m2ts|mpg|mpeg|wmv|mp3|m4a|aac|flac|ogg|wav)(\?|$)"#, options: [.regularExpression, .caseInsensitive]) == nil
    }

    func isTorrentioHost(_ url: String) -> Bool {
        let host = (URL(string: url)?.host ?? "").lowercased()
        return host == "torrentio.strem.fun" || host.hasSuffix(".strem.fun") || host.contains("torrentio")
    }

    private func qualityScore(_ label: String) -> Int {
        if label.range(of: #"\b2160p|4k|uhd\b"#, options: .regularExpression) != nil { return 40 }
        if label.range(of: #"\b1080p\b"#, options: .regularExpression) != nil { return 30 }
        if label.range(of: #"\b720p\b"#, options: .regularExpression) != nil { return 15 }
        if label.range(of: #"\b480p\b"#, options: .regularExpression) != nil { return 5 }
        return 10
    }

    func streamHeight(_ label: String) -> Int {
        if label.range(of: #"\b2160p|4k|uhd\b"#, options: .regularExpression) != nil { return 2160 }
        if label.range(of: #"\b1080p\b"#, options: .regularExpression) != nil { return 1080 }
        if label.range(of: #"\b720p\b"#, options: .regularExpression) != nil { return 720 }
        if label.range(of: #"\b480p\b"#, options: .regularExpression) != nil { return 480 }
        return 1080
    }

    private func requestList(_ path: String) async throws -> [[String: Any]] {
        let raw = try await requestJSON(path)
        if raw is NSNull { return [] }
        return raw as? [[String: Any]] ?? []
    }

    private func requestJSON(_ path: String, method: String = "GET", form: String? = nil) async throws -> Any {
        guard let token = tokenValue() else { throw RdClientError.notConfigured }
        guard let url = URL(string: "https://api.real-debrid.com/rest/1.0\(path)") else {
            throw RdClientError.failed("bad url")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("tvm-core", forHTTPHeaderField: "User-Agent")
        if let form {
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(form.utf8)
        }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw RdClientError.failed("no response") }
        if http.statusCode == 401 || http.statusCode == 403 { throw RdClientError.needsAuth }
        if !(200...299).contains(http.statusCode) { throw RdClientError.failed("Real-Debrid replied \(http.statusCode)") }
        if data.isEmpty { return NSNull() }
        return try JSONSerialization.jsonObject(with: data)
    }
}
