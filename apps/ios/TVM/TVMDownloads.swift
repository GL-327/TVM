import Foundation
import UIKit

/// What a download asks for: the audio language (a must) and the tallest picture.
struct TVMDownloadPrefs: Equatable {
    let language: String
    let maxHeight: Int
}

/// The audio language a copy's name declares (ported from Android, TvmPlaybackChoice.languageOk).
enum TVMLanguage {
    private static let languages: [String: String] = [
        "en": #"\b(eng|english)\b|🇬🇧|🇺🇸"#,
        "ja": #"\b(jpn|jap|japanese)\b|🇯🇵"#,
        "fr": #"\b(fre|fra|french|vff|vfq|truefrench)\b|🇫🇷"#,
        "de": #"\b(ger|deu|german)\b|🇩🇪"#,
        "es": #"\b(spa|esp|spanish|castellano|latino)\b|🇪🇸|🇲🇽"#,
        "it": #"\b(ita|italian)\b|🇮🇹"#,
        "pt": #"\b(por|portuguese|dublado)\b|🇵🇹|🇧🇷"#,
        "ko": #"\b(kor|korean)\b|🇰🇷"#,
        "hi": #"\b(hin|hindi)\b|🇮🇳"#,
    ]
    private static let multi = #"\b(multi|dual[ .-]?audio)\b"#

    /// "original" takes any copy. Any other language takes a copy marked as
    /// that language, and refuses one marked as another language or as MULTi;
    /// an unmarked copy counts as English, as release names leave English unsaid.
    static func ok(_ label: String, language: String) -> Bool {
        if language == "original" { return true }
        if label.range(of: multi, options: [.regularExpression, .caseInsensitive]) != nil { return false }
        let marked = Set(languages.filter { label.range(of: $0.value, options: [.regularExpression, .caseInsensitive]) != nil }.keys)
        if marked.isEmpty { return language == "en" }
        return marked == [language]
    }
}

/// Films and episodes saved on the iPhone, to watch without a connection.
///
/// The iOS counterpart of Android's TvmDownloads. iOS has no folder picker for
/// this: files go to the app's own Downloads folder, which the Files app
/// shows under On My iPhone › TVM (UIFileSharingEnabled). One file at a time,
/// streamed to disk as it arrives, resuming after a dropped connection with a
/// Range request; a file is listed as complete only once every byte is there,
/// and anything less is removed. A completed download is remembered by the
/// title or episode it belongs to, and playing that title plays the file on
/// the phone (TVMLocalCore /api/playback), offline.
final class TVMDownloads: NSObject, URLSessionDataDelegate {
    final class Job {
        let id: String
        let mediaId: String
        let title: String
        let language: String
        let maxHeight: Int
        var state = "queued"
        var bytes: Int64 = 0
        var total: Int64 = 0
        var name: String?
        var error: String?

        init(id: String, mediaId: String, title: String, language: String, maxHeight: Int) {
            self.id = id; self.mediaId = mediaId; self.title = title; self.language = language; self.maxHeight = maxHeight
        }

        func json(folder: String?) -> [String: Any] {
            var out: [String: Any] = ["id": id, "title": title, "state": state, "bytes": bytes, "total": total]
            if state == "complete", let name { out["path"] = [folder, name].compactMap { $0 }.joined(separator: "/") }
            if let error { out["error"] = error }
            return out
        }

        func saved() -> [String: Any] {
            var out = json(folder: nil)
            out["mediaId"] = mediaId; out["language"] = language; out["maxHeight"] = maxHeight
            if let name { out["name"] = name }
            return out
        }
    }

    static let folderName = "On this iPhone › TVM"
    static let active: Set<String> = ["queued", "resolving", "downloading"]
    private static let retries = 6
    private let store: TVMStore
    let folder: URL
    private let resolve: (String, String, Int) async -> Result<(url: String, filename: String), Error>
    private let lock = NSLock()
    private var jobs: [Job] = []
    private var cancelled: Set<String> = []
    private var running = false
    private var transfer: Transfer?
    private let configuration: URLSessionConfiguration
    /// Seconds to wait before retry n (n starts at 1). Tests shorten it.
    var retryDelay: (Int) -> UInt64 = { UInt64(2_000_000_000 * $0) }

    init(store: TVMStore, folder: URL? = nil, configuration: URLSessionConfiguration = .default, resolve: @escaping (String, String, Int) async -> Result<(url: String, filename: String), Error>) {
        self.store = store
        self.folder = folder ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Downloads", isDirectory: true)
        self.resolve = resolve
        self.configuration = configuration
        super.init()
        try? FileManager.default.createDirectory(at: self.folder, withIntermediateDirectories: true)
        // Jobs that were running when the app last closed did not finish.
        for raw in store.readJSON("downloads.json") as? [[String: Any]] ?? [] {
            guard let id = raw["id"] as? String, let mediaId = raw["mediaId"] as? String else { continue }
            let job = Job(id: id, mediaId: mediaId, title: raw["title"] as? String ?? "TVM video",
                          language: raw["language"] as? String ?? "en", maxHeight: raw["maxHeight"] as? Int ?? 1080)
            job.state = raw["state"] as? String ?? "failed"
            job.bytes = (raw["bytes"] as? NSNumber)?.int64Value ?? 0
            job.total = (raw["total"] as? NSNumber)?.int64Value ?? 0
            job.name = raw["name"] as? String
            job.error = raw["error"] as? String
            if Self.active.contains(job.state) {
                if let name = job.name { try? FileManager.default.removeItem(at: self.folder.appendingPathComponent(name)) }
                job.state = "failed"; job.bytes = 0; job.name = nil
                job.error = "Stopped when TVM closed. Start it again."
            }
            jobs.append(job)
        }
    }

    // MARK: The folder

    func folderDisplayName() -> String { Self.folderName }

    // MARK: The queue

    func list() -> [String: Any] {
        lock.lock(); defer { lock.unlock() }
        return ["jobs": jobs.map { $0.json(folder: Self.folderName) }, "folder": Self.folderName]
    }

    func enqueue(_ items: [(id: String, title: String)], language: String, maxHeight: Int) throws -> [String: Any] {
        lock.lock()
        if jobs.filter({ Self.active.contains($0.state) }).count + items.count > 1000 {
            lock.unlock()
            throw NSError(domain: "TVMDownloads", code: 1, userInfo: [NSLocalizedDescriptionKey: "The download queue is full."])
        }
        for item in items {
            jobs.append(Job(id: UUID().uuidString, mediaId: item.id, title: item.title, language: language, maxHeight: maxHeight))
        }
        persistLocked()
        lock.unlock()
        startIfIdle()
        return list()
    }

    func cancel(_ id: String) {
        lock.lock()
        if let job = jobs.first(where: { $0.id == id }), Self.active.contains(job.state) {
            cancelled.insert(id)
            if job.state == "queued" { job.state = "cancelled"; cancelled.remove(id) }
            persistLocked()
        }
        let current = transfer
        lock.unlock()
        if current?.jobID == id { current?.task.cancel() }
    }

    /// A completed download of `mediaId` that is still on the phone.
    func offlineCopy(_ mediaId: String) -> (url: URL, name: String)? {
        lock.lock()
        let job = jobs.last { $0.mediaId == mediaId && $0.state == "complete" && $0.name != nil }
        lock.unlock()
        guard let job, let name = job.name else { return nil }
        let file = folder.appendingPathComponent(name)
        return FileManager.default.fileExists(atPath: file.path) ? (file, name) : nil
    }

    private func persistLocked() {
        store.writeJSON("downloads.json", jobs.map { $0.saved() })
    }

    private func startIfIdle() {
        lock.lock()
        guard !running else { lock.unlock(); return }
        running = true
        lock.unlock()
        Task.detached { [weak self] in await self?.work() }
    }

    private func work() async {
        // A little more time when the app goes to the background mid-file.
        let background = await MainActor.run { UIApplication.shared.beginBackgroundTask(withName: "tvm-downloads", expirationHandler: nil) }
        defer { Task { @MainActor in UIApplication.shared.endBackgroundTask(background) } }
        while true {
            lock.lock()
            guard let job = jobs.first(where: { $0.state == "queued" }) else { running = false; lock.unlock(); return }
            job.state = "resolving"
            persistLocked()
            lock.unlock()
            await download(job)
        }
    }

    private func stopped(_ job: Job) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return cancelled.contains(job.id)
    }

    private func finish(_ job: Job, _ state: String, _ error: String? = nil) {
        lock.lock(); defer { lock.unlock() }
        if state != "complete", let name = job.name {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(name))
            job.name = nil
        }
        job.state = cancelled.contains(job.id) ? "cancelled" : state
        job.error = job.state == "failed" ? error : nil
        cancelled.remove(job.id)
        persistLocked()
    }

    private func download(_ job: Job) async {
        let found = await resolve(job.mediaId, job.language, job.maxHeight)
        if stopped(job) { return finish(job, "cancelled") }
        let source: (url: String, filename: String)
        switch found {
        case .success(let value): source = value
        case .failure(let error): return finish(job, "failed", (error as NSError).localizedDescription)
        }
        guard let url = URL(string: source.url) else { return finish(job, "failed", "No downloadable file was found.") }
        let ext = source.filename.range(of: #"\.(mp4|mkv|webm|m4v|mov|avi|ts|mpg|mpeg)$"#, options: [.regularExpression, .caseInsensitive])
            .map { String(source.filename[$0]).lowercased() } ?? ".mkv"
        let stem = String(job.title.replacingOccurrences(of: #"[<>:"/\\|?*\x00-\x1f]"#, with: "_", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces).prefix(140))
        var name = "\(stem.isEmpty ? "TVM video" : stem) [\(job.language)]\(ext)"
        var n = 2
        while FileManager.default.fileExists(atPath: folder.appendingPathComponent(name).path) {
            name = "\(stem.isEmpty ? "TVM video" : stem) [\(job.language)] (\(n))\(ext)"; n += 1
        }
        let file = folder.appendingPathComponent(name)
        FileManager.default.createFile(atPath: file.path, contents: nil)
        lock.lock(); job.name = name; job.state = "downloading"; job.bytes = 0; job.total = 0; persistLocked(); lock.unlock()

        var attempt = 0
        while true {
            if stopped(job) { return finish(job, "cancelled") }
            let outcome = await run(job, url: url, file: file)
            if outcome == .done { break }
            if outcome == .stopped { return finish(job, "cancelled") }
            // A dropped connection: carry on from the last byte written.
            attempt += 1
            if attempt >= Self.retries { return finish(job, "failed", "The connection kept dropping. Retry this download.") }
            try? await Task.sleep(nanoseconds: retryDelay(attempt))
        }
        if stopped(job) { return finish(job, "cancelled") }
        if job.bytes == 0 || (job.total > 0 && job.bytes != job.total) { return finish(job, "failed", "The file was incomplete. Retry this download.") }
        finish(job, "complete")
    }

    // MARK: One HTTP transfer, chunk by chunk.

    private enum Outcome { case done, dropped, stopped }

    private final class Transfer {
        let jobID: String
        let task: URLSessionDataTask
        let job: Job
        let handle: FileHandle
        var resumed = false
        var failure: Error?
        var lastSave = Date()
        let finished: (Outcome) -> Void
        init(job: Job, task: URLSessionDataTask, handle: FileHandle, finished: @escaping (Outcome) -> Void) {
            self.jobID = job.id; self.job = job; self.task = task; self.handle = handle; self.finished = finished
        }
    }

    private lazy var session: URLSession = {
        let config = configuration
        config.timeoutIntervalForRequest = 30
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    private func run(_ job: Job, url: URL, file: URL) async -> Outcome {
        guard let handle = try? FileHandle(forWritingTo: file) else { return .dropped }
        var request = URLRequest(url: url)
        if job.bytes > 0 { request.setValue("bytes=\(job.bytes)-", forHTTPHeaderField: "Range") }
        return await withCheckedContinuation { continuation in
            let task = session.dataTask(with: request)
            let current = Transfer(job: job, task: task, handle: handle) { continuation.resume(returning: $0) }
            lock.lock(); transfer = current; lock.unlock()
            task.resume()
        }
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let current = currentTransfer(dataTask), let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode) else { return completionHandler(.cancel) }
        let job = current.job
        current.resumed = http.statusCode == 206 && job.bytes > 0
        lock.lock()
        if !current.resumed {
            // The server sent the whole file again (or this is the first try).
            job.bytes = 0
            job.total = max(0, http.expectedContentLength)
            try? current.handle.truncate(atOffset: 0)
        } else {
            try? current.handle.seekToEnd()
        }
        lock.unlock()
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let current = currentTransfer(dataTask) else { return }
        if stopped(current.job) { dataTask.cancel(); return }
        do { try current.handle.write(contentsOf: data) } catch { current.failure = error; dataTask.cancel(); return }
        lock.lock()
        current.job.bytes += Int64(data.count)
        if Date().timeIntervalSince(current.lastSave) > 5 { current.lastSave = Date(); persistLocked() }
        lock.unlock()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let dataTask = task as? URLSessionDataTask, let current = currentTransfer(dataTask) else { return }
        try? current.handle.close()
        lock.lock(); transfer = nil; lock.unlock()
        if stopped(current.job) { return current.finished(.stopped) }
        let job = current.job
        if error != nil || current.failure != nil || (job.total > 0 && job.bytes < job.total) { return current.finished(.dropped) }
        current.finished(.done)
    }

    private func currentTransfer(_ task: URLSessionDataTask) -> Transfer? {
        lock.lock(); defer { lock.unlock() }
        return transfer?.task === task ? transfer : nil
    }
}
