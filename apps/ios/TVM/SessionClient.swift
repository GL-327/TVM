import Foundation

/// Sessions are ephemeral. Never follow a redirect with the bearer or session cookie.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum SessionClient {
    static let cookieName = "tvm_lan_session"

    private static func client() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 20
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }

    static func connect(_ connection: Connection) async throws -> HTTPCookie {
        var request = URLRequest(url: connection.sessionURL)
        request.httpMethod = "POST"
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data("{}".utf8)
        let session = client()
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw ClientError.message("The host did not return a valid response.")
        }
        if response.statusCode == 401 || response.statusCode == 403 {
            throw ClientError.message("The host rejected this token or address. Check the host LAN settings.")
        }
        guard (200...299).contains(response.statusCode),
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              body["ok"] as? Bool == true else {
            throw ClientError.message("This host does not support TVM mobile sessions. Update and restart Core, then retry.")
        }
        var headers: [String: String] = [:]
        for (key, value) in response.allHeaderFields {
            if let key = key as? String { headers[key] = String(describing: value) }
        }
        guard let cookie = HTTPCookie.cookies(withResponseHeaderFields: headers, for: connection.sessionURL)
            .first(where: { $0.name == cookieName && $0.isHTTPOnly && $0.path == "/" }),
              cookie.domain == connection.origin.host,
              connection.origin.scheme != "https" || cookie.isSecure else {
            throw ClientError.message("The host did not issue a valid secure session. Check the Core version and HTTPS configuration.")
        }
        return cookie
    }

    static func disconnect(_ connection: Connection, cookie: HTTPCookie) async {
        var request = URLRequest(url: connection.sessionURL)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("\(cookie.name)=\(cookie.value)", forHTTPHeaderField: "Cookie")
        let session = client()
        defer { session.finishTasksAndInvalidate() }
        _ = try? await session.data(for: request)
    }
}
