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
    var links: [String]
    var files: [RdTorrentFile]
}

struct RdUnrestrict {
    var id: String
    var filename: String
    var mimeType: String?
    var download: String
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

    init(session: URLSession) {
        self.session = session
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 14
        redirectSession = URLSession(configuration: configuration, delegate: NoFollowRedirects(), delegateQueue: nil)
    }

    func configured() -> Bool { RdKeychain.read() != nil }
    func tokenValue() -> String? { RdKeychain.read() }

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
                username: user?["username"] as? String,
                premium: ((user?["premium"] as? Int) ?? 0) > 0,
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
            guard let fileId = file["id"] as? Int, let path = file["path"] as? String else { return nil }
            return RdTorrentFile(id: fileId, path: path, selected: file["selected"] as? Int ?? 0)
        }
        return RdTorrentInfo(
            id: raw["id"] as? String ?? id,
            filename: raw["filename"] as? String ?? "",
            links: raw["links"] as? [String] ?? [],
            files: files
        )
    }

    func unrestrict(link: String) async throws -> RdUnrestrict {
        let body = "link=\(link.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? link)"
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

    func appleTranscode(id: String) async -> (url: String, mime: String)? {
        do {
            let raw = try await requestJSON("/streaming/transcode/\(id)")
            guard let object = raw as? [String: Any] else { return nil }
            for group in ["apple", "h264WebM", "liveMP4"] {
                guard let bucket = object[group] as? [String: Any] else { continue }
                for quality in ["1080", "1080p", "720", "720p", "full", "auto", "480"] {
                    if let url = bucket[quality] as? String, url.hasPrefix("http") {
                        let mime = group == "apple" || url.contains(".m3u8")
                            ? "application/vnd.apple.mpegurl"
                            : "video/mp4"
                        if group == "apple" || TVMPlayback.phoneCanPlay(filename: url, mimeType: mime, url: url) {
                            return (url, mime)
                        }
                    }
                }
            }
        } catch {
            return nil
        }
        return nil
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
                if let type = http.value(forHTTPHeaderField: "Content-Type"), type.contains("json"),
                   let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let next = body["url"] as? String, next.hasPrefix("http") {
                    if isTorrentioHost(next) {
                        current = URL(string: next) ?? current
                        continue
                    }
                    return next
                }
                return nil
            } catch {
                return nil
            }
        }
        return nil
    }

    func torrentioStreams(token: String, imdb: String, season: Int?, episode: Int?) async -> [[String: Any]] {
        let base = "https://torrentio.strem.fun/realdebrid=\(token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? token)"
        var paths: [String] = []
        if let season, let episode {
            paths = [
                "stream/series/\(imdb):\(season):\(episode).json",
                "stream/series/\(imdb):\(season):\(String(format: "%02d", episode)).json",
            ]
        } else {
            paths = ["stream/movie/\(imdb).json", "stream/series/\(imdb).json"]
        }
        var streams: [[String: Any]] = []
        var seen = Set<String>()
        for path in paths {
            guard let url = URL(string: "\(base)/\(path)") else { continue }
            var request = URLRequest(url: url)
            request.setValue("tvm-core", forHTTPHeaderField: "User-Agent")
            request.timeoutInterval = 14
            guard let (data, response) = try? await session.data(for: request),
                  let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                  let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let list = body["streams"] as? [[String: Any]] else { continue }
            for stream in list {
                guard let streamURL = stream["url"] as? String, streamURL.hasPrefix("http"),
                      seen.insert(streamURL).inserted else { continue }
                let title = String(describing: stream["title"] ?? stream["name"] ?? "Stream")
                if title.range(of: #"\b(cam|camrip|telesync|hdcam)\b"#, options: [.regularExpression, .caseInsensitive]) != nil {
                    continue
                }
                streams.append(stream)
            }
            if !streams.isEmpty { break }
        }
        return streams.sorted { left, right in
            let leftTitle = String(describing: left["title"] ?? "")
            let rightTitle = String(describing: right["title"] ?? "")
            let leftCached = leftTitle.localizedCaseInsensitiveContains("cached") || leftTitle.contains("⚡")
            let rightCached = rightTitle.localizedCaseInsensitiveContains("cached") || rightTitle.contains("⚡")
            if leftCached != rightCached { return leftCached && !rightCached }
            return qualityScore(leftTitle) > qualityScore(rightTitle)
        }
    }

    func needsUnrestrict(_ url: String) -> Bool {
        if url.range(of: "download.real-debrid.com", options: .caseInsensitive) != nil { return false }
        if url.range(of: "real-debrid.com/d/", options: .caseInsensitive) != nil { return true }
        return url.range(of: #"\.(m3u8|mp4|m4v|mkv|webm|mov)(\?|$)"#, options: .regularExpression) == nil
    }

    func isTorrentioHost(_ url: String) -> Bool {
        (URL(string: url)?.host ?? "").lowercased() == "torrentio.strem.fun"
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
