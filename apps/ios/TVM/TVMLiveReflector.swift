import Foundation

/**
 Live TV on the phone goes through the same kind of proxy as desktop Core:
 the player is handed `/api/live/proxy/<token>`, never the provider address.
 */
final class TVMLiveReflector: @unchecked Sendable {
    private var targets: [String: URL] = [:]
    private let lock = NSLock()
    private let session: URLSession

    init(session: URLSession) {
        self.session = session
    }

    func publish(_ url: URL) -> String {
        let token = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        lock.lock()
        targets[token] = url
        lock.unlock()
        return "/api/live/proxy/\(token)"
    }

    func serve(_ token: String, method: String) async -> HTTPReply {
        lock.lock()
        let upstream = targets[token]
        lock.unlock()
        guard let upstream else { return .json(404, ["error": "not_found"]) }
        var request = URLRequest(url: upstream)
        request.httpMethod = method == "HEAD" ? "HEAD" : "GET"
        request.timeoutInterval = 20
        request.setValue("VLC/3.0.21 LibVLC/3.0.21", forHTTPHeaderField: "User-Agent")
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                return .json(502, ["error": "upstream-empty"])
            }
            if !(200..<300).contains(http.statusCode) && http.statusCode != 206 {
                return .json(502, ["error": "upstream-\(http.statusCode)"])
            }
            let type = http.value(forHTTPHeaderField: "Content-Type") ?? ""
            if looksLikePlaylist(upstream, type: type, body: data) {
                let text = String(data: data, encoding: .utf8) ?? ""
                let rewritten = rewrite(text, base: upstream)
                return .bytes(200, type: "application/vnd.apple.mpegurl", data: Data(rewritten.utf8))
            }
            let mediaType = mediaType(upstream, declared: type)
            if method == "HEAD" {
                return HTTPReply(status: 200, headers: ["Content-Type": mediaType], body: Data())
            }
            return .bytes(200, type: mediaType, data: data)
        } catch {
            return .json(502, ["error": "unreachable"])
        }
    }

    private func looksLikePlaylist(_ url: URL, type: String, body: Data) -> Bool {
        if type.lowercased().contains("mpegurl") { return true }
        if url.pathExtension.lowercased() == "m3u8" { return true }
        guard let first = body.first else { return false }
        return first == 0x23 // '#'
    }

    private func mediaType(_ url: URL, declared: String) -> String {
        let mime = declared.split(separator: ";").first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        if mime.lowercased().contains("mp2t") { return "video/mp2t" }
        if !mime.isEmpty && !mime.lowercased().contains("octet-stream") { return mime }
        let ext = url.pathExtension.lowercased()
        if ext == "ts" || ext == "m2ts" { return "video/mp2t" }
        if ext == "m3u8" { return "application/vnd.apple.mpegurl" }
        if ext == "mp4" || ext == "m4s" { return "video/mp4" }
        return "video/mp4"
    }

    private func rewrite(_ text: String, base: URL) -> String {
        var lines: [String] = []
        for raw in text.split(separator: "\n", omittingEmptySubsequences: false) {
            var line = String(raw)
            if line.hasPrefix("#") {
                lines.append(rewriteAttributes(line, base: base))
                continue
            }
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty {
                lines.append(line)
                continue
            }
            if let target = URL(string: trimmed, relativeTo: base)?.absoluteURL {
                line = publish(target)
            }
            lines.append(line)
        }
        return lines.joined(separator: "\n")
    }

    private func rewriteAttributes(_ line: String, base: URL) -> String {
        guard let regex = try? NSRegularExpression(pattern: "URI=\"([^\"]*)\"") else { return line }
        let ns = line as NSString
        var out = line
        let matches = regex.matches(in: line, range: NSRange(location: 0, length: ns.length)).reversed()
        for match in matches {
            guard match.numberOfRanges >= 2 else { continue }
            let uri = ns.substring(with: match.range(at: 1))
            guard let target = URL(string: uri, relativeTo: base)?.absoluteURL else { continue }
            let replacement = "URI=\"\(publish(target))\""
            out = (out as NSString).replacingCharacters(in: match.range, with: replacement)
        }
        return out
    }
}
