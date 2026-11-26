import Foundation
import CoreFoundation

struct PlaybackEventRecord {
    var event: String
    var id: String
    var title: String?
    var position: Double?
    var duration: Double?
}

private final class TVMWebhookNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

/// Sends playback lifecycle events to the user's webhook URL when enabled.
/// Mirrors apps/core/src/providers/playbackWebhook.ts.
final class TVMWebhook {
    private static let validEvents: Set<String> = ["play", "pause", "stop", "finish"]
    private static let forbiddenIds: Set<String> = ["constructor", "prototype", "__proto__"]
    private static let defaultSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 5
        config.timeoutIntervalForResource = 5
        config.httpShouldSetCookies = false
        return URLSession(configuration: config, delegate: TVMWebhookNoRedirect(), delegateQueue: nil)
    }()

    private let readPrefs: () -> TVMPrefs
    private let now: () -> Date
    private let sender: (URL, Data) async -> Void
    private let lock = NSLock()
    private var order: [String] = []
    private var recent: [String: Date] = [:]
    private var pending = 0

    init(
        readPrefs: @escaping () -> TVMPrefs,
        now: @escaping () -> Date = { Date() },
        sender: ((URL, Data) async -> Void)? = nil
    ) {
        self.readPrefs = readPrefs
        self.now = now
        self.sender = sender ?? { url, body in
            var req = URLRequest(url: url)
            req.httpMethod = "POST"
            req.timeoutInterval = 5
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
            _ = try? await TVMWebhook.defaultSession.data(for: req)
        }
    }

    static func isValidProgressId(_ raw: String?) -> Bool {
        guard let raw, raw.utf8.count <= 512, !forbiddenIds.contains(raw) else { return false }
        return raw.range(of: #"^[a-zA-Z0-9][a-zA-Z0-9:_.-]{0,511}$"#, options: .regularExpression) != nil
    }

    static func parseEvent(_ json: [String: Any]) -> PlaybackEventRecord? {
        guard let event = json["event"] as? String, validEvents.contains(event),
              let id = json["id"] as? String, isValidProgressId(id) else { return nil }
        let titleRaw = (json["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = titleRaw.flatMap { $0.isEmpty ? nil : String($0.prefix(300)) }
        func seconds(_ value: Any?) -> Double? {
            guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
            let seconds = number.doubleValue
            return seconds.isFinite && seconds >= 0 ? seconds : nil
        }
        let pos = seconds(json["position"])
        let dur = seconds(json["duration"])
        return PlaybackEventRecord(event: event, id: id, title: title, position: pos, duration: dur)
    }

    func send(scope: String, event: PlaybackEventRecord) {
        let prefs = readPrefs()
        guard prefs.extras["webhook"] == true,
              let rawUrl = prefs.webhookUrl,
              let url = URL(string: rawUrl),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty,
              url.user == nil, url.password == nil else { return }

        let key = "\(scope)\u{0}\(event.id)\u{0}\(event.event)"
        let ts = now()
        let cooldown: TimeInterval = event.event == "finish" ? 8 : 1
        lock.lock()
        if pending >= 8 { lock.unlock(); return }
        if let last = recent[key], ts.timeIntervalSince(last) < cooldown { lock.unlock(); return }
        while order.count >= 256 {
            let oldest = order.removeFirst()
            recent.removeValue(forKey: oldest)
        }
        if recent[key] == nil { order.append(key) }
        recent[key] = ts
        pending += 1
        lock.unlock()

        let path = url.path
        let isDiscord = host.range(of: #"^(?:(?:canary|ptb)\.)?discord(?:app)?\.com$"#, options: [.regularExpression, .caseInsensitive]) != nil &&
            path.range(of: #"^/api(?:/v\d+)?/webhooks/"#, options: .regularExpression) != nil
        var payload: [String: Any]
        if isDiscord {
            let verb: String
            switch event.event {
            case "play": verb = "Playing"
            case "pause": verb = "Paused"
            case "stop": verb = "Stopped"
            default: verb = "Finished"
            }
            payload = ["content": "\(verb) \(event.title ?? event.id)", "allowed_mentions": ["parse": []]]
        } else {
            payload = [
                "event": event.event,
                "id": event.id,
                "at": ISO8601DateFormatter().string(from: ts),
            ]
            if let title = event.title { payload["title"] = title }
            if let position = event.position { payload["position"] = position }
            if let duration = event.duration { payload["duration"] = duration }
        }
        let body = JSONValue.data(payload)
        // Hold the sender itself, not just a weak self: Swift may release the webhook right after this call,
        // and an event that was accepted must still go out.
        let sender = self.sender
        Task.detached(priority: .utility) { [weak self] in
            await sender(url, body)
            self?.finishOne()
        }
    }

    private func finishOne() {
        lock.lock()
        pending = max(0, pending - 1)
        lock.unlock()
    }
}
