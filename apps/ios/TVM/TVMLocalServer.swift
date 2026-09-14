import Foundation
import Network

final class TVMLocalServer: @unchecked Sendable {
    private let core: TVMLocalCore
    private var listener: NWListener?
    private(set) var port: UInt16 = 0
    private let queue = DispatchQueue(label: "tvm.standalone.server", qos: .userInitiated)

    init(core: TVMLocalCore) {
        self.core = core
    }

    var origin: URL { StandalonePolicy.localOrigin(port: port) }

    func start() throws {
        let parameters = NWParameters.tcp
        parameters.requiredInterfaceType = .loopback
        parameters.allowLocalEndpointReuse = true
        // Bind 127.0.0.1 only. The in-app browser loads this origin; the PC is not required.
        let preferred = NWEndpoint.Port(rawValue: 7345) ?? .any
        do {
            listener = try NWListener(using: parameters, on: preferred)
        } catch {
            listener = try NWListener(using: parameters, on: .any)
        }
        listener?.newConnectionHandler = { [weak self] connection in
            self?.serve(connection)
        }
        let ready = DispatchSemaphore(value: 0)
        var startError: Error?
        listener?.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                if let value = self?.listener?.port?.rawValue { self?.port = value }
                ready.signal()
            case .failed(let error):
                startError = error
                ready.signal()
            default:
                break
            }
        }
        listener?.start(queue: queue)
        _ = ready.wait(timeout: .now() + 3)
        if let startError { throw startError }
        if port == 0 { throw ClientError.message("The on-device TVM server did not bind a loopback port.") }
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    private func serve(_ connection: NWConnection) {
        connection.start(queue: queue)
        readRequest(connection, buffer: Data())
    }

    private func readRequest(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self else { return }
            if error != nil || (isComplete && data == nil) {
                connection.cancel()
                return
            }
            var next = buffer
            if let data { next.append(data) }
            if next.count > 2_000_000 {
                self.reply(connection, HTTPReply.json(413, ["error": "payload too large"]))
                return
            }
            guard let parsed = Self.parse(next) else {
                if isComplete {
                    self.reply(connection, HTTPReply.json(400, ["error": "bad request"]))
                } else {
                    self.readRequest(connection, buffer: next)
                }
                return
            }
            Task {
                let response = await self.dispatch(parsed)
                self.reply(connection, response)
            }
        }
    }

    private func dispatch(_ request: ParsedRequest) async -> HTTPReply {
        if request.path.hasPrefix("/api/") {
            return await core.handle(
                method: request.method,
                path: request.path,
                query: request.query,
                headers: request.headers,
                body: request.body
            )
        }
        return staticFile(path: request.path, method: request.method)
    }

    private func staticFile(path: String, method: String) -> HTTPReply {
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("BundledUI", isDirectory: true) else {
            return HTTPReply.json(500, ["error": "bundled UI missing"])
        }
        let relative = path == "/" ? "index.html" : String(path.dropFirst())
        let decoded = relative.removingPercentEncoding ?? relative
        if decoded.contains("..") { return HTTPReply.json(400, ["error": "bad path"]) }
        var file = root.appendingPathComponent(decoded).standardizedFileURL
        let rootPath = root.standardizedFileURL.path
        if !file.path.hasPrefix(rootPath) { return HTTPReply.json(400, ["error": "bad path"]) }
        if !FileManager.default.fileExists(atPath: file.path) {
            if decoded.hasPrefix("assets/") { return HTTPReply.empty(404) }
            file = root.appendingPathComponent("index.html")
        }
        guard let data = try? Data(contentsOf: file) else { return HTTPReply.empty(404) }
        if method == "HEAD" {
            return HTTPReply(status: 200, headers: ["Content-Type": mime(file.pathExtension)], body: Data())
        }
        return HTTPReply.bytes(200, type: mime(file.pathExtension), data: data)
    }

    private func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "webp": return "image/webp"
        case "woff": return "font/woff"
        case "woff2": return "font/woff2"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }

    private func reply(_ connection: NWConnection, _ response: HTTPReply) {
        let reason = HTTPURLResponse.localizedString(forStatusCode: response.status).capitalized
        var header = "HTTP/1.1 \(response.status) \(reason)\r\n"
        var headers = response.headers
        headers["Content-Length"] = String(response.body.count)
        headers["Connection"] = "close"
        headers["Cache-Control"] = response.headers["Content-Type"]?.contains("javascript") == true
            ? "no-cache"
            : (headers["Cache-Control"] ?? "no-store")
        for (key, value) in headers {
            header += "\(key): \(value)\r\n"
        }
        header += "\r\n"
        var payload = Data(header.utf8)
        payload.append(response.body)
        connection.send(content: payload, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }

    private struct ParsedRequest {
        var method: String
        var path: String
        var query: [String: String]
        var headers: [String: String]
        var body: Data?
    }

    private static func parse(_ data: Data) -> ParsedRequest? {
        guard let headerEnd = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
        let headerData = data.subdata(in: data.startIndex..<headerEnd.lowerBound)
        guard let headerText = String(data: headerData, encoding: .utf8) else { return nil }
        let lines = headerText.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
        guard let requestLine = lines.first else { return nil }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else { return nil }
        let method = String(parts[0]).uppercased()
        let target = String(parts[1])
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let sep = line.firstIndex(of: ":") else { continue }
            let key = line[..<sep].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: sep)...].trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }
        let length = Int(headers["content-length"] ?? "0") ?? 0
        let bodyStart = headerEnd.upperBound
        if data.count < bodyStart + length { return nil }
        let body = length > 0 ? data.subdata(in: bodyStart..<(bodyStart + length)) : nil
        let split = target.split(separator: "?", maxSplits: 1).map(String.init)
        let path = (split.first ?? "/").removingPercentEncoding ?? (split.first ?? "/")
        var query: [String: String] = [:]
        if split.count > 1 {
            for pair in split[1].split(separator: "&") {
                let pieces = pair.split(separator: "=", maxSplits: 1).map(String.init)
                let key = pieces[0].removingPercentEncoding ?? pieces[0]
                let value = pieces.count > 1 ? (pieces[1].removingPercentEncoding ?? pieces[1]) : ""
                query[key] = value
            }
        }
        return ParsedRequest(method: method, path: path, query: query, headers: headers, body: body)
    }
}
