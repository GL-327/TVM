import XCTest
import UIKit
@testable import TVM

final class StandaloneTests: XCTestCase {
    private var testFolders: [URL] = []
    private func testCore(session: URLSession? = nil) -> TVMLocalCore {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tvm-test-\(UUID().uuidString)")
        testFolders.append(root)
        return TVMLocalCore(session: session, store: TVMStore(root: root))
    }
    override func tearDown() {
        for root in testFolders { try? FileManager.default.removeItem(at: root) }
        testFolders.removeAll()
        super.tearDown()
    }
    func testSixteenNineFrameFitsWithoutCropping() {
        for available in [CGSize(width: 844, height: 390), CGSize(width: 568, height: 320), CGSize(width: 390, height: 844), CGSize(width: 1024, height: 768)] {
            let size = TVMViewport.fittedSize(in: available)
            XCTAssertEqual(size.width / size.height, 16.0 / 9.0, accuracy: 0.001)
            XCTAssertLessThanOrEqual(size.width, available.width)
            XCTAssertLessThanOrEqual(size.height, available.height)
        }
    }

    @MainActor func testNativePlayerCentersControlsInBothOrientations() {
        let controller = TVMPlayerController(id: "test", url: URL(string: "https://cdn.example/movie.mkv")!, title: "Test film", startAt: 0, live: false)
        controller.loadViewIfNeeded()
        func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
        for size in [CGSize(width: 375, height: 667), CGSize(width: 844, height: 390), CGSize(width: 1024, height: 768)] {
            controller.view.frame = CGRect(origin: .zero, size: size)
            controller.view.setNeedsLayout()
            controller.view.layoutIfNeeded()
            let controls = descendants(controller.view).compactMap { $0 as? UIButton }
            guard let play = controls.first(where: { $0.accessibilityLabel == "Pause" }) else { return XCTFail("Play control missing") }
            let frame = play.convert(play.bounds, to: controller.view)
            XCTAssertEqual(frame.midX, size.width / 2, accuracy: 1)
            XCTAssertEqual(frame.midY, size.height / 2, accuracy: 1)
            for button in controls {
                XCTAssertGreaterThanOrEqual(button.bounds.height, 44)
                XCTAssertGreaterThanOrEqual(button.bounds.width, 44)
            }
        }
        controller.shutdown()
    }

    func testTranscodePrefersCompatibleHLSWithinPlanCap() {
        let choices: [String: Any] = ["apple": ["2160": "https://cdn.example/4k.m3u8", "1080p": "https://cdn.example/hd.m3u8", "720": "https://cdn.example/low.m3u8"], "h264WebM": ["1080": "https://cdn.example/file.webm"]]
        XCTAssertEqual(TVMPlayback.appleTranscode(choices, maxHeight: 1080)?.url, "https://cdn.example/hd.m3u8")
        XCTAssertEqual(TVMPlayback.appleTranscode(choices, maxHeight: 2160)?.url, "https://cdn.example/4k.m3u8")
        XCTAssertNil(TVMPlayback.appleTranscode(["h264WebM": ["1080": "https://cdn.example/file.webm"]], maxHeight: 1080))
        XCTAssertFalse(TVMPlayback.phoneCanPlay(filename: "wrong.mkv", mimeType: "video/mp4", url: "https://cdn.example/wrong.mkv"))
    }

    func testMobilePlanAndLiveHLSWithoutDebrid() async throws {
        let core = testCore()
        _ = core.plans.cancel()
        defer { _ = core.plans.cancel() }
        core.rd.ignoreKeychain = true
        let play = JSONValue.data(["id": "live:1"])
        let blocked = await core.handle(method: "POST", path: "/api/playback", query: [:], headers: [:], body: play)
        XCTAssertEqual(blocked.status, 403)
        for id in ["basic", "premium", "ultra", "max"] {
            _ = try core.plans.setPlan(id)
            XCTAssertTrue(core.plans.mobileAllowed())
        }
        _ = try core.plans.setPlan("basic")
        _ = try core.plans.setLiveTv(true)
        let playlist = "#EXTM3U\n#EXTINF:-1,Test HLS\nhttps://cdn.example/live.m3u8\n#EXTINF:-1,Raw TS\nhttps://cdn.example/live.ts\n"
        _ = await core.handle(method: "PUT", path: "/api/live", query: [:], headers: [:], body: JSONValue.data(["text": playlist]))
        let hls = await core.handle(method: "POST", path: "/api/playback", query: [:], headers: [:], body: play)
        XCTAssertEqual(hls.status, 200)
        XCTAssertEqual(JSONValue.object(hls.body)["transport"] as? String, "hls")
        let ts = await core.handle(method: "POST", path: "/api/playback", query: [:], headers: [:], body: JSONValue.data(["id": "live:2"]))
        XCTAssertEqual(ts.status, 200)
        XCTAssertEqual(JSONValue.object(ts.body)["transport"] as? String, "ts-live")
        XCTAssertEqual(JSONValue.object(ts.body)["engine"] as? String, "native")
    }

    func testProgressAppearsAfterThirtySecondsNotFourPercent() {
        XCTAssertNil(TVMTitle.progressRatio(ProgressEntry(position: 10, duration: 7200, updated: "2026-01-01")))
        XCTAssertNotNil(TVMTitle.progressRatio(ProgressEntry(position: 30, duration: 7200, updated: "2026-01-01")))
        XCTAssertEqual(TVMTitle.progressRatio(ProgressEntry(position: 30, duration: 7200, updated: "2026-01-01"))!, 30.0 / 7200.0, accuracy: 0.0001)
        XCTAssertNil(TVMTitle.progressRatio(ProgressEntry(position: 7000, duration: 7200, updated: "2026-01-01")))
    }

    func testContinueWatchingPersistsSavedTitleAfterThirtySeconds() {
        let core = testCore()
        let profile = core.media.activeProfile()
        let parsed = MediaItem.parse([
            "id": "fight-club",
            "title": "Fight Club",
            "kind": "movie",
            "synopsis": "",
            "poster": "https://example.com/fight.jpg",
            "backdrop": "",
            "genres": ["Drama"],
            "rating": "8.8",
            "playable": true,
            "hue": 32,
        ] as [String: Any])
        XCTAssertNotNil(parsed)
        core.store.rememberMedia([parsed!], profileId: profile)

        core.media.saveProgress(id: "fight-club", position: 10, duration: 7200)
        XCTAssertTrue(core.media.continueWatching().isEmpty)

        core.media.saveProgress(id: "tt0137523", position: 30, duration: 7200)
        let watching = core.media.continueWatching()
        XCTAssertEqual(watching.first?.id, "tt0137523")
        XCTAssertEqual(watching.first?.title, "Fight Club")
        XCTAssertEqual(watching.first?.poster, "https://example.com/fight.jpg")
    }

    func testStandaloneDoesNotRequireLANToken() {
        XCTAssertFalse(StandalonePolicy.requiresLANToken)
        XCTAssertNil(StandalonePolicy.bundledLANToken)
        XCTAssertEqual(StandalonePolicy.defaultMode, StandalonePolicy.Mode.onDevice)
    }

    func testLocalOriginIsLoopbackHTTP() {
        let origin = StandalonePolicy.localOrigin(port: 7345)
        XCTAssertEqual(origin.scheme, "http")
        XCTAssertEqual(origin.host, "127.0.0.1")
        XCTAssertEqual(origin.port, 7345)
        XCTAssertNotEqual(origin.path, "/api/lan/session")
    }

    func testPhonePlaybackAcceptsMp4AndHlsOnly() {
        XCTAssertTrue(TVMPlayback.phoneCanPlay(filename: "film.mp4", mimeType: "video/mp4", url: "https://cdn.example/film.mp4"))
        XCTAssertTrue(TVMPlayback.phoneCanPlay(filename: "a.m3u8", mimeType: "application/vnd.apple.mpegurl", url: "https://cdn.example/a.m3u8"))
        XCTAssertFalse(TVMPlayback.phoneCanPlay(filename: "film.mkv", mimeType: "video/x-matroska", url: "https://cdn.example/film.mkv"))
        XCTAssertTrue(TVMPlayback.needsConverter(filename: "film.mkv", mimeType: "video/x-matroska", url: "https://cdn.example/film.mkv"))
    }

    func testNativePlaybackAcceptsNetworkContainersAndRejectsLocalSchemes() {
        for file in ["film.mkv", "film.webm", "film.avi", "film.mp4", "channel.ts", "channel.m3u8", "opaque-id"] {
            XCTAssertTrue(TVMPlayback.nativeCanOpen("https://cdn.example/\(file)"))
        }
        for url in ["file:///etc/passwd", "javascript:alert(1)", "data:video/mp4,test", "/relative", "https://"] {
            XCTAssertFalse(TVMPlayback.nativeCanOpen(url))
        }
    }

    func testNativePlaybackReturnsRawMKVWithoutAConverter() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockPlaybackProtocol.self]
        let core = testCore(session: URLSession(configuration: configuration))
        _ = try? core.plans.setPlan("basic")
        defer { _ = core.plans.cancel() }
        core.rd.ignoreKeychain = true
        core.rd.testToken = "fixture-token"
        let reply = await core.handle(method: "POST", path: "/api/playback", query: [:], headers: [:],
                                      body: JSONValue.data(["link": "https://cdn.example/movie.mkv", "title": "Movie"]))
        XCTAssertEqual(reply.status, 200)
        XCTAssertEqual(JSONValue.object(reply.body)["url"] as? String, "https://cdn.example/movie.mkv")
        XCTAssertEqual(JSONValue.object(reply.body)["engine"] as? String, "native")
    }

    func testPhonePlaybackAcceptsM4vMovAndAppleHls() {
        XCTAssertTrue(TVMPlayback.phoneCanPlay(filename: "clip.m4v", mimeType: "video/x-m4v", url: "https://cdn.example/id"))
        XCTAssertTrue(TVMPlayback.phoneCanPlay(filename: "clip.mov", mimeType: "video/quicktime", url: "https://cdn.example/id"))
        XCTAssertTrue(TVMPlayback.phoneCanPlay(filename: "stream", mimeType: "video/mp4; codecs=avc1.640028", url: "https://cdn.example/id"))
        XCTAssertTrue(TVMPlayback.phoneCanPlay(filename: "stream", mimeType: "application/vnd.apple.mpegurl", url: "https://cdn.example/master.M3U8"))
        XCTAssertFalse(TVMPlayback.phoneCanPlay(filename: "wrong.mkv", mimeType: "video/x-m4v", url: "https://cdn.example/wrong.mkv"))
    }

    func testJSONValueIntReadsSerializedNumbers() {
        let json = JSONValue.object(Data(#"{"season":1,"episode":2,"premium":86400,"id":"tt0137523"}"#.utf8))
        XCTAssertEqual(JSONValue.int(json["season"]), 1)
        XCTAssertEqual(JSONValue.int(json["episode"]), 2)
        XCTAssertEqual(JSONValue.int(json["premium"]), 86400)
        XCTAssertEqual(JSONValue.string(json["id"]), "tt0137523")
        XCTAssertGreaterThan(JSONValue.int(json["premium"]) ?? 0, 0)
    }

    func testPlaybackReturnsStreamURLForMockedTorrentioHit() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockPlaybackProtocol.self]
        configuration.timeoutIntervalForRequest = 4
        let session = URLSession(configuration: configuration)
        let core = testCore(session: session)
        _ = try? core.plans.setPlan("basic")
        defer { _ = core.plans.cancel() }
        core.rd.ignoreKeychain = true
        core.rd.testToken = "fixture-token"
        MockPlaybackProtocol.reset()
        let body = JSONValue.data(["id": "tt0137523", "title": "Fight Club"])
        let reply = await core.handle(
            method: "POST",
            path: "/api/playback",
            query: [:],
            headers: [:],
            body: body
        )
        XCTAssertEqual(reply.status, 200)
        let payload = JSONValue.object(reply.body)
        XCTAssertEqual(payload["kind"] as? String, "stream")
        XCTAssertEqual(payload["url"] as? String, "https://cdn.example/fight-club.mp4")
        XCTAssertEqual(payload["engine"] as? String, "native")
        XCTAssertTrue(TVMPlayback.phoneCanPlay(
            filename: payload["filename"] as? String ?? "",
            mimeType: payload["mimeType"] as? String,
            url: payload["url"] as? String ?? ""
        ))
    }

    func testCatalogSlugMapsToImdb() {
        XCTAssertEqual(TVMTitle.catalogImdb("ten-truths-about-love"), "tt15483404")
        XCTAssertEqual(TVMTitle.catalogImdb("fight-club"), "tt0137523")
        XCTAssertEqual(TVMTitle.catalogImdb("the-last-of-us:1:1"), "tt3581920")
        XCTAssertEqual(TVMTitle.seasonEpisode(from: "the-last-of-us:1:1")?.season, 1)
        XCTAssertEqual(TVMTitle.seasonEpisode(from: "the-last-of-us:1:1")?.episode, 1)
        XCTAssertNil(TVMTitle.extractImdb("fight-club"))
    }

    func testPlaybackReturnsStreamURLForCatalogSlug() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockPlaybackProtocol.self]
        configuration.timeoutIntervalForRequest = 4
        let session = URLSession(configuration: configuration)
        let core = testCore(session: session)
        _ = try? core.plans.setPlan("basic")
        defer { _ = core.plans.cancel() }
        core.rd.ignoreKeychain = true
        core.rd.testToken = "fixture-token"
        MockPlaybackProtocol.reset()
        let reply = await core.handle(
            method: "POST",
            path: "/api/playback",
            query: [:],
            headers: [:],
            body: JSONValue.data(["id": "fight-club", "title": "Fight Club"])
        )
        XCTAssertEqual(reply.status, 200)
        let payload = JSONValue.object(reply.body)
        XCTAssertEqual(payload["kind"] as? String, "stream")
        XCTAssertEqual(payload["url"] as? String, "https://cdn.example/fight-club.mp4")
    }

    func testPlaybackAsksForRealDebridWhenNoToken() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockPlaybackProtocol.self]
        let session = URLSession(configuration: configuration)
        let core = testCore(session: session)
        _ = try? core.plans.setPlan("basic")
        defer { _ = core.plans.cancel() }
        core.rd.ignoreKeychain = true
        core.rd.testToken = nil
        let reply = await core.handle(
            method: "POST",
            path: "/api/playback",
            query: [:],
            headers: [:],
            body: JSONValue.data(["id": "tt0137523"])
        )
        XCTAssertEqual(reply.status, 409)
        let payload = JSONValue.object(reply.body)
        XCTAssertEqual(payload["reason"] as? String, "not-configured")
        XCTAssertNotEqual(payload["reason"] as? String, "empty")
    }

    func testCatalogSlugAsksForRealDebridWhenNoToken() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockPlaybackProtocol.self]
        let session = URLSession(configuration: configuration)
        let core = testCore(session: session)
        _ = try? core.plans.setPlan("basic")
        defer { _ = core.plans.cancel() }
        core.rd.ignoreKeychain = true
        core.rd.testToken = nil
        let reply = await core.handle(
            method: "POST",
            path: "/api/playback",
            query: [:],
            headers: [:],
            body: JSONValue.data(["id": "fight-club", "title": "Fight Club"])
        )
        XCTAssertEqual(reply.status, 409)
        let payload = JSONValue.object(reply.body)
        XCTAssertEqual(payload["reason"] as? String, "not-configured")
        XCTAssertNotEqual(payload["reason"] as? String, "empty")
    }

    func testPlaybackReturnsStreamURLForSearchTitle() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockPlaybackProtocol.self]
        configuration.timeoutIntervalForRequest = 4
        let session = URLSession(configuration: configuration)
        let core = testCore(session: session)
        _ = try? core.plans.setPlan("basic")
        defer { _ = core.plans.cancel() }
        core.rd.ignoreKeychain = true
        core.rd.testToken = "fixture-token"
        MockPlaybackProtocol.reset()
        let hits = await core.media.search("Fight Club")
        XCTAssertEqual(hits.first?.id, "tt0137523")
        let reply = await core.handle(
            method: "POST",
            path: "/api/playback",
            query: [:],
            headers: [:],
            body: JSONValue.data(["id": hits.first?.id ?? "", "title": hits.first?.title ?? "Fight Club"])
        )
        XCTAssertEqual(reply.status, 200)
        let payload = JSONValue.object(reply.body)
        XCTAssertEqual(payload["kind"] as? String, "stream")
        XCTAssertEqual(payload["url"] as? String, "https://cdn.example/fight-club.mp4")
        XCTAssertTrue((payload["url"] as? String ?? "").hasPrefix("https://"))
    }

    func testPlaybackReturnsStreamURLForContinueWatchingId() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MockPlaybackProtocol.self]
        configuration.timeoutIntervalForRequest = 4
        let session = URLSession(configuration: configuration)
        let core = testCore(session: session)
        _ = try? core.plans.setPlan("basic")
        defer { _ = core.plans.cancel() }
        core.rd.ignoreKeychain = true
        core.rd.testToken = "fixture-token"
        MockPlaybackProtocol.reset()
        let parsed = MediaItem.parse([
            "id": "fight-club",
            "title": "Fight Club",
            "kind": "movie",
            "synopsis": "",
            "poster": "https://example.com/fight.jpg",
            "backdrop": "",
            "genres": ["Drama"],
            "rating": "8.8",
            "playable": true,
            "hue": 32,
        ] as [String: Any])
        XCTAssertNotNil(parsed)
        core.store.rememberMedia([parsed!], profileId: core.media.activeProfile())
        core.media.saveProgress(id: "tt0137523", position: 30, duration: 7200)
        let watching = core.media.continueWatching()
        XCTAssertEqual(watching.first?.id, "tt0137523")
        let reply = await core.handle(
            method: "POST",
            path: "/api/playback",
            query: [:],
            headers: [:],
            body: JSONValue.data(["id": watching.first?.id ?? "", "title": watching.first?.title ?? ""])
        )
        XCTAssertEqual(reply.status, 200)
        let payload = JSONValue.object(reply.body)
        XCTAssertEqual(payload["kind"] as? String, "stream")
        XCTAssertEqual(payload["url"] as? String, "https://cdn.example/fight-club.mp4")
    }

    func testOptionalLANStillValidatesWhenUsed() {
        let token = String(repeating: "a", count: 32)
        XCTAssertNoThrow(try Connection.validated(address: "http://192.168.1.2:7345", token: token, allowLocalHTTP: true))
        XCTAssertThrowsError(try Connection.validated(address: "http://192.168.1.2", token: token, allowLocalHTTP: false))
    }
}

final class MockPlaybackProtocol: URLProtocol {
    static func reset() {}

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let url = request.url?.absoluteString ?? ""
        var status = 200
        var payload: Data = Data("{}".utf8)
        var type = "application/json"
        if url.contains("/user") {
            payload = Data(#"{"username":"fixture","premium":1}"#.utf8)
        } else if url.contains("torrentio") && url.contains("tt0137523") {
            payload = Data(#"{"streams":[{"name":"Torrentio\n720p ⚡","title":"Fight Club 720p mp4","url":"https://real-debrid.com/d/FIGHT"}]}"#.utf8)
        } else if url.contains("/unrestrict/link") {
            payload = Data(#"{"id":"u1","filename":"Fight.Club.1999.720p.mp4","mimeType":"video/mp4","download":"https://cdn.example/fight-club.mp4"}"#.utf8)
        } else if url.contains("/meta/movie/") {
            payload = Data(#"{"meta":{"id":"tt0137523","name":"Fight Club","type":"movie"}}"#.utf8)
        } else if url.contains("cinemeta") && url.contains("/catalog/") {
            payload = Data(#"{"metas":[{"id":"tt0137523","name":"Fight Club","type":"movie"}]}"#.utf8)
        } else if url.contains("/downloads") || url.contains("/torrents") {
            payload = Data("[]".utf8)
        } else {
            status = 404
            payload = Data(#"{"error":"no"}"#.utf8)
        }
        let response = HTTPURLResponse(
            url: request.url ?? URL(string: "https://example.invalid")!,
            statusCode: status,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": type]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: payload)
        client?.urlProtocolDidFinishLoading(self)
    }
}
