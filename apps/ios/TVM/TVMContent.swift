import Foundation

final class TVMContent {
    static let remoteBase = "https://raw.githubusercontent.com/GL-327/TVM/main/packages/content"
    static let ttl: TimeInterval = 6 * 60 * 60
    static let timeout: TimeInterval = 8

    static let contentNames: Set<String> = [
        "changelog",
        "events",
        "free-channels",
        "services",
        "avatars",
        "parental",
    ]

    static let refreshable: [String: String] = [
        "events": "events",
        "free-channels": "channels",
        "services": "services",
        "avatars": "sets",
    ]

    static func validContent(name: String, doc: [String: Any]) -> Bool {
        guard contentNames.contains(name) else { return false }
        if name == "changelog" {
            return doc["releases"] is [Any]
        }
        guard JSONValue.int(doc["schema"]) == 1 else { return false }
        guard let expectedKey = refreshable[name] else { return true }
        guard let items = doc[expectedKey] as? [Any] else { return false }
        return !items.isEmpty
    }

    private let store: TVMStore
    private let session: URLSession
    private let bundled: ((String) -> Data?)?
    private let clock: () -> Date
    private let enableRefresh: Bool
    private let lock = NSLock()
    private var memory: [String: [String: Any]] = [:]
    private var lastAttempt: [String: Date] = [:]

    init(
        store: TVMStore,
        session: URLSession = .shared,
        bundled: ((String) -> Data?)? = nil,
        clock: @escaping () -> Date = Date.init,
        enableRefresh: Bool = true
    ) {
        self.store = store
        self.session = session
        self.bundled = bundled
        self.clock = clock
        self.enableRefresh = enableRefresh
    }

    func load(_ name: String) -> [String: Any]? {
        guard Self.contentNames.contains(name) else { return nil }
        if Self.refreshable[name] != nil {
            lock.lock()
            let memHit = memory[name]
            lock.unlock()
            if let memHit { return memHit }
            if let cached = readCached(name) {
                lock.lock()
                memory[name] = cached
                lock.unlock()
                return cached
            }
        }
        return readBundled(name)
    }

    func fresh(_ name: String) async -> [String: Any]? {
        guard Self.contentNames.contains(name) else { return nil }
        guard Self.refreshable[name] != nil else { return readBundled(name) }
        if enableRefresh {
            await refreshIfDue(name)
        }
        return load(name)
    }

    func changelogPayload() -> [String: Any] {
        let doc = load("changelog")
        let releases = doc?["releases"] as? [Any] ?? []
        return [
            "current": StandalonePolicy.version,
            "releases": releases,
        ]
    }

    private func refreshIfDue(_ name: String) async {
        guard let expectedKey = Self.refreshable[name] else { return }
        let now = clock()
        lock.lock()
        let due: Bool
        if let last = lastAttempt[name], now.timeIntervalSince(last) < Self.ttl {
            due = false
        } else {
            lastAttempt[name] = now
            due = true
        }
        lock.unlock()
        guard due, let url = URL(string: "\(Self.remoteBase)/\(name).json") else { return }

        var request = URLRequest(url: url)
        request.timeoutInterval = Self.timeout
        guard let (data, response) = try? await session.data(for: request),
              let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = parsed[expectedKey] as? [Any],
              !arr.isEmpty,
              Self.validContent(name: name, doc: parsed) else {
            return
        }

        writeCached(name, data: data)
        lock.lock()
        memory[name] = parsed
        lock.unlock()
    }

    private func readBundled(_ name: String) -> [String: Any]? {
        let data: Data?
        if let bundled, let custom = bundled(name) {
            data = custom
        } else if let url = Bundle.main.url(forResource: name, withExtension: "json") {
            data = try? Data(contentsOf: url)
        } else {
            data = nil
        }
        guard let data,
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Self.validContent(name: name, doc: parsed) else {
            return nil
        }
        return parsed
    }

    private func readCached(_ name: String) -> [String: Any]? {
        let url = store.contentCacheURL(name)
        guard let data = try? Data(contentsOf: url),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              Self.validContent(name: name, doc: parsed) else {
            return nil
        }
        return parsed
    }

    private func writeCached(_ name: String, data: Data) {
        let target = store.contentCacheURL(name)
        let dir = target.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? data.write(to: target, options: .atomic)
    }
}
