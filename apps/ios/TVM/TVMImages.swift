import CryptoKit
import Foundation

/// Posters, backdrops and episode stills for the page, fetched by the app.
///
/// Ported from Android (TvmImages + TvmArtCache). The page asks the app's own
/// server for every picture (/api/art?src=…, tvm-ios.js 2), because a Search
/// page asks for about forty at once and a host refusing a burst (429), a slow
/// answer or a dropped connection used to leave a broken picture for good.
/// Here a refused or failed request is tried again after a short wait,
/// pictures are kept on the phone (keyed by their full address, so two titles
/// can never share one), a failure is never kept, metahub's smaller sizes are
/// tried when a large one is missing, and artwork filed under the wrong title
/// is refused (TVMArtTrust) before the cache is even looked at.
final class TVMImages {
    struct Picture { let status: Int; let type: String; let data: Data }

    static let shared = TVMImages()
    static let cacheControl = "public, max-age=604800, immutable"
    private static let maxBytes: Int64 = 160 * 1024 * 1024
    private let session: URLSession
    private let directory: URL
    private let lock = NSLock()
    private let sleep: (UInt64) async -> Void
    private let fetchOverride: ((URL) async -> (Int, String?, Data?))?

    init(session: URLSession? = nil, directory: URL? = nil,
         fetch: ((URL) async -> (Int, String?, Data?))? = nil,
         sleep: @escaping (UInt64) async -> Void = { try? await Task.sleep(nanoseconds: $0) }) {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 12
        config.httpMaximumConnectionsPerHost = 4
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = session ?? URLSession(configuration: config)
        self.directory = directory ?? FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("art", isDirectory: true)
        self.fetchOverride = fetch
        self.sleep = sleep
        try? FileManager.default.createDirectory(at: self.directory, withIntermediateDirectories: true)
    }

    func load(_ url: URL) async -> Picture {
        let address = url.absoluteString
        if !TVMArtTrust.trusted(address) { return Picture(status: 404, type: "text/plain", data: Data()) }
        if let kept = cached(address) { return kept }
        var last = (status: 404, type: String?.none, data: Data?.none)
        for candidate in Self.variants(address) {
            guard let next = URL(string: candidate) else { continue }
            let got = await fetchWithRetry(next)
            if got.0 == 200, let data = got.2, !data.isEmpty {
                let type = (got.1?.hasPrefix("image/") == true ? got.1 : nil) ?? "image/jpeg"
                keep(address, type: type, data: data)
                return Picture(status: 200, type: type, data: data)
            }
            last = (got.0, got.1, got.2)
            // Only "not found" is worth another size; anything else is final.
            if got.0 != 404 && got.0 != 410 { break }
        }
        return Picture(status: (400...599).contains(last.status) ? last.status : 502, type: "text/plain", data: Data())
    }

    /// Rate limits, server trouble and failed connections are worth another try.
    static func retryable(_ status: Int) -> Bool { status == -1 || status == 408 || status == 429 || (500...599).contains(status) }

    /// The picture asked for, then metahub's smaller sizes of the same picture.
    static func variants(_ url: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"^(https?://(?:images|live)\.metahub\.space/(?:poster|background|logo)/)(large|medium|small)(/.*)$"#),
              let match = regex.firstMatch(in: url, range: NSRange(url.startIndex..., in: url)),
              let prefix = Range(match.range(at: 1), in: url), let size = Range(match.range(at: 2), in: url),
              let rest = Range(match.range(at: 3), in: url) else { return [url] }
        var seen = Set<String>()
        return [String(url[size]), "medium", "small"].filter { seen.insert($0).inserted }.map { "\(url[prefix])\($0)\(url[rest])" }
    }

    private func fetchWithRetry(_ url: URL) async -> (Int, String?, Data?) {
        let backoff: [UInt64] = [600_000_000, 1_800_000_000]
        var last: (Int, String?, Data?) = (-1, nil, nil)
        for attempt in 0..<3 {
            last = await fetch(url)
            if last.0 == 200 || !Self.retryable(last.0) { return last }
            if attempt < 2 { await sleep(backoff[attempt]) }
        }
        return last
    }

    private func fetch(_ url: URL) async -> (Int, String?, Data?) {
        if let fetchOverride { return await fetchOverride(url) }
        var request = URLRequest(url: url)
        request.setValue("image/avif,image/webp,image/*,*/*;q=0.8", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await session.data(for: request), let http = response as? HTTPURLResponse else { return (-1, nil, nil) }
        guard (200...299).contains(http.statusCode) else { return (http.statusCode, nil, nil) }
        return (200, http.value(forHTTPHeaderField: "Content-Type"), data)
    }

    // MARK: The phone's copy, keyed by the full address.

    static func key(_ address: String) -> String {
        SHA256.hash(data: Data(address.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func cached(_ address: String) -> Picture? {
        let key = Self.key(address)
        lock.lock(); defer { lock.unlock() }
        let file = directory.appendingPathComponent(key + ".img")
        guard let data = try? Data(contentsOf: file), !data.isEmpty,
              let type = try? String(contentsOf: directory.appendingPathComponent(key + ".type"), encoding: .utf8) else { return nil }
        try? FileManager.default.setAttributes([.modificationDate: Date()], ofItemAtPath: file.path)
        return Picture(status: 200, type: type, data: data)
    }

    private func keep(_ address: String, type: String, data: Data) {
        guard data.count <= 8 * 1024 * 1024 else { return }
        let key = Self.key(address)
        lock.lock(); defer { lock.unlock() }
        try? type.write(to: directory.appendingPathComponent(key + ".type"), atomically: true, encoding: .utf8)
        try? data.write(to: directory.appendingPathComponent(key + ".img"), options: .atomic)
        prune()
    }

    /// Oldest first until the folder is back under its limit.
    private func prune() {
        let keys: [URLResourceKey] = [.fileSizeKey, .contentModificationDateKey]
        guard let files = try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: keys)
            .filter({ $0.pathExtension == "img" }) else { return }
        let sized = files.map { file -> (URL, Int64, Date) in
            let values = try? file.resourceValues(forKeys: Set(keys))
            return (file, Int64(values?.fileSize ?? 0), values?.contentModificationDate ?? .distantPast)
        }
        var total = sized.reduce(0) { $0 + $1.1 }
        guard total > Self.maxBytes else { return }
        for (file, size, _) in sized.sorted(by: { $0.2 < $1.2 }) {
            if total <= Self.maxBytes * 8 / 10 { break }
            try? FileManager.default.removeItem(at: file)
            try? FileManager.default.removeItem(at: file.deletingPathExtension().appendingPathExtension("type"))
            total -= size
        }
    }
}
