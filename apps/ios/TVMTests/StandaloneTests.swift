import XCTest
import UIKit
@testable import TVM

final class StandaloneTests: XCTestCase {
    func testAnimeAndBundleCheckoutJSONPersistsAcrossPlanChanges() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tvm-anime-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = TVMStore(root: root)
        let plans = TVMPlans(store: store)
        let anime = try plans.checkout(["planId": "free", "pack": "anime", "packOnly": true, "consent": true, "quotedOneTimePence": 499])
        XCTAssertEqual(anime["animeOwned"] as? Bool, true)
        XCTAssertEqual(anime["synthwaveOwned"] as? Bool, false)
        XCTAssertEqual(anime["animeAddonPence"] as? Int, 499)
        let bundle = try plans.checkout(["planId": "free", "pack": "theme-bundle", "packOnly": true, "consent": true, "quotedOneTimePence": 999])
        XCTAssertEqual(bundle["bundleOwned"] as? Bool, true)
        XCTAssertEqual(bundle["synthwaveOwned"] as? Bool, true)
        _ = plans.cancel()
        let restored = TVMPlans(store: store).status()
        XCTAssertEqual(restored["anime"] as? Bool, true)
        XCTAssertEqual(restored["bundle"] as? Bool, true)
        XCTAssertEqual(restored["themeBundlePence"] as? Int, 999)
    }
    func testCompletionKeepsNotebookAcrossRewatch() {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tvm-finish-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let store = TVMStore(root: root)
        store.writeProgress(profileId: "p", id: "film", position: 96, duration: 100)
        XCTAssertFalse(store.progress(for: "p")["film"]!.isFinished)
        store.writeProgress(profileId: "p", id: "film", position: 97, duration: 100)
        store.writeProgress(profileId: "p", id: "film", position: 99, duration: 100)
        XCTAssertEqual(store.progress(for: "p")["film"]?.completions, 1)
        store.writeProgress(profileId: "p", id: "film", position: 1, duration: 100)
        XCTAssertNotNil(store.progress(for: "p")["film"]?.completedAt)
    }

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

    private func assertSameFolder(_ left: URL, _ right: URL, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(
            URL(fileURLWithPath: left.path, isDirectory: true).standardizedFileURL,
            URL(fileURLWithPath: right.path, isDirectory: true).standardizedFileURL,
            file: file,
            line: line
        )
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

    @MainActor func testNativePlayerTapsPassThroughVLCAndEmptyChrome() {
        let controller = TVMPlayerController(id: "tap", url: URL(string: "https://cdn.example/movie.mkv")!, title: "Tap film", startAt: 0, live: false)
        controller.loadViewIfNeeded()
        controller.view.frame = CGRect(origin: .zero, size: CGSize(width: 390, height: 844))
        controller.view.layoutIfNeeded()
        XCTAssertFalse(controller.view.subviews[0].isUserInteractionEnabled)
        func all(_ view: UIView) -> [UIView] { [view] + view.subviews.flatMap { all($0) } }
        let taps = all(controller.view).flatMap { $0.gestureRecognizers ?? [] }.compactMap { $0 as? UITapGestureRecognizer }
        XCTAssertTrue(taps.contains { $0.numberOfTapsRequired == 1 })
        XCTAssertTrue(taps.contains { $0.numberOfTapsRequired == 2 })
        let empty = controller.view.hitTest(CGPoint(x: 24, y: 420), with: nil)
        XCTAssertNotNil(empty)
        XCTAssertEqual(empty?.accessibilityLabel, "Show or hide playback controls")
        XCTAssertFalse(empty is UIControl)
        let chrome = TVMChromeView()
        chrome.frame = CGRect(origin: .zero, size: CGSize(width: 200, height: 200))
        let stack = UIStackView(frame: chrome.bounds)
        chrome.addSubview(stack)
        XCTAssertNil(chrome.hitTest(CGPoint(x: 100, y: 100), with: nil))
        controller.shutdown()
    }

    func testNativePlayerIgnoresVLCBufferingFlickerAndTransientErrors() {
        let playing = TVMNativePulse(phase: .buffering, isPlaying: true, hasOutput: true, position: 12, duration: 100, sawPlayback: true, elapsed: 20, sinceProgress: 0.2, sinceError: 0)
        XCTAssertTrue(tvmNativeMarkPlayback(playing))
        XCTAssertFalse(tvmNativeBlockingLoad(playing))
        XCTAssertFalse(tvmNativeRebuffering(playing))
        XCTAssertFalse(tvmNativeShouldFail(playing))
        let blip = TVMNativePulse(phase: .error, isPlaying: false, hasOutput: true, position: 12, duration: 100, sawPlayback: true, elapsed: 20, sinceProgress: 0.4, sinceError: 1)
        XCTAssertFalse(tvmNativeShouldFail(blip))
        let opening = TVMNativePulse(phase: .buffering, isPlaying: false, hasOutput: false, position: 0, duration: 0, sawPlayback: false, elapsed: 2, sinceProgress: 2, sinceError: 0)
        XCTAssertTrue(tvmNativeBlockingLoad(opening))
        XCTAssertFalse(tvmNativeShouldFail(opening))
        let dead = TVMNativePulse(phase: .buffering, isPlaying: false, hasOutput: false, position: 0, duration: 0, sawPlayback: false, elapsed: 46, sinceProgress: 46, sinceError: 0)
        XCTAssertTrue(tvmNativeShouldFail(dead))
        let paused = TVMNativePulse(phase: .paused, isPlaying: false, hasOutput: true, position: 40, duration: 100, sawPlayback: true, elapsed: 90, sinceProgress: 50, sinceError: 0)
        XCTAssertFalse(tvmNativeShouldFail(paused))
        XCTAssertFalse(tvmNativeBlockingLoad(paused))
    }

    @MainActor func testNativeDecoderPlaysMP4MatroskaWebMAndTransportStream() throws {
        _ = Bundle(for: StandaloneTests.self).url(forResource: "sample", withExtension: "mp4", subdirectory: "PlaybackFixtures")
        throw XCTSkip("VLCKit decode is a device check; simulator playback deadlocks XCTest and blocks the IPA")
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
        // Basic is a television and desktop tier now; phones start at Premium.
        _ = try core.plans.setPlan("basic")
        XCTAssertFalse(core.plans.mobileAllowed())
        for id in ["premium", "ultra", "max"] {
            _ = try core.plans.setPlan(id)
            XCTAssertTrue(core.plans.mobileAllowed())
        }
        // Live TV arrives with a tier now. setLiveTv(true) deliberately refuses,
        // because a buyer used to pick a term at checkout and there is no
        // checkout any more.
        XCTAssertThrowsError(try core.plans.setLiveTv(true))
        core.plans.grantTier("stream-live")
        XCTAssertTrue(core.plans.mobileAllowed())
        let playlist = "#EXTM3U\n#EXTINF:-1,Test HLS\nhttps://cdn.example/live.m3u8\n#EXTINF:-1,Raw TS\nhttps://cdn.example/live.ts\n"
        _ = await core.handle(method: "PUT", path: "/api/live", query: [:], headers: [:], body: JSONValue.data(["text": playlist]))
        let hls = await core.handle(method: "POST", path: "/api/playback", query: [:], headers: [:], body: play)
        XCTAssertEqual(hls.status, 200)
        XCTAssertEqual(JSONValue.object(hls.body)["transport"] as? String, "hls")
        XCTAssertEqual(JSONValue.object(hls.body)["engine"] as? String, "html5")
        XCTAssertTrue((JSONValue.object(hls.body)["url"] as? String ?? "").contains("/api/live/proxy/"))
        XCTAssertFalse((JSONValue.object(hls.body)["url"] as? String ?? "").contains("cdn.example"))
        let ts = await core.handle(method: "POST", path: "/api/playback", query: [:], headers: [:], body: JSONValue.data(["id": "live:2"]))
        XCTAssertEqual(ts.status, 200)
        XCTAssertEqual(JSONValue.object(ts.body)["transport"] as? String, "ts-live")
        XCTAssertEqual(JSONValue.object(ts.body)["engine"] as? String, "html5")
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
        _ = try? core.plans.setPlan("premium")
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
        _ = try? core.plans.setPlan("premium")
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
        _ = try? core.plans.setPlan("premium")
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
        _ = try? core.plans.setPlan("premium")
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
        _ = try? core.plans.setPlan("premium")
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
        _ = try? core.plans.setPlan("premium")
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
        _ = try? core.plans.setPlan("premium")
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

    func testDeviceChromeMapsIslandNotchAndHomeButton() {
        let se = TVMDeviceChrome.profile(identifier: "iPhone14,6", idiom: .phone)
        XCTAssertEqual(se.family, .homeButton)
        XCTAssertEqual(se.maxHeight, 1080)
        XCTAssertGreaterThan(se.extraX, 0)
        let fourteen = TVMDeviceChrome.profile(identifier: "iPhone14,7", idiom: .phone)
        XCTAssertEqual(fourteen.family, .notch)
        XCTAssertEqual(fourteen.maxHeight, 1080)
        let pro = TVMDeviceChrome.profile(identifier: "iPhone17,1", idiom: .phone)
        XCTAssertEqual(pro.family, .island)
        XCTAssertEqual(pro.maxHeight, 2160)
        XCTAssertGreaterThan(pro.extraTop, fourteen.extraTop)
        XCTAssertEqual(TVMDeviceChrome.playbackHeight(planMax: 2160), min(2160, TVMDeviceChrome.current.maxHeight))
        let pad = TVMDeviceChrome.profile(identifier: "iPad14,1", idiom: .pad)
        XCTAssertEqual(pad.family, .ipad)
        XCTAssertEqual(pad.maxHeight, 2160)
        let seventeen = TVMDeviceChrome.profile(identifier: "iPhone18,1", idiom: .phone)
        XCTAssertEqual(seventeen.family, .island)
        XCTAssertGreaterThanOrEqual(seventeen.fallbackTop, 59)
        XCTAssertGreaterThan(seventeen.extraTop, fourteen.extraTop)
    }

    func testBootScriptPaintsIslandInsetsBeforeTheBundle() {
        let script = TVMDeviceChrome.bootScript()
        XCTAssertTrue(script.contains("--tvm-inset-top"))
        XCTAssertTrue(script.contains("dataset.deviceFamily"))
        XCTAssertTrue(script.contains("phone-shell"))
        XCTAssertTrue(script.contains("--tvm-chrome-extra-top"))
    }

    func testPrefsDefaultToEnglishAndAutoUpdate() {
        let store = TVMStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("tvm-prefs-\(UUID().uuidString)"))
        testFolders.append(store.root)
        let prefs = TVMPrefs.load(store)
        XCTAssertEqual(prefs.language, "en")
        XCTAssertTrue(prefs.autoUpdate)
        var next = prefs
        next.language = "fr"
        next.autoUpdate = false
        next.save(store)
        let loaded = TVMPrefs.load(store)
        XCTAssertEqual(loaded.language, "fr")
        XCTAssertFalse(loaded.autoUpdate)
        XCTAssertEqual(TVMPrefs.acceptLanguage("en"), "en,en-US;q=0.9")
    }

    func testUpdateSnapshotAllowsInAppApply() {
        let store = TVMStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("tvm-upd-\(UUID().uuidString)"))
        testFolders.append(store.root)
        let status = TVMUpdater.snapshot(store: store)
        XCTAssertTrue(status.applyAllowed)
        XCTAssertTrue(status.autoUpdate)
        XCTAssertTrue(status.channel.contains("GL-327/TVM"))
    }

    func testLaunchWaitSkipsGitHubWhenAutoUpdateIsOff() async {
        let store = TVMStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("tvm-wait-\(UUID().uuidString)"))
        testFolders.append(store.root)
        var prefs = TVMPrefs.load(store)
        prefs.autoUpdate = false
        prefs.save(store)
        let started = Date()
        await TVMUpdater.waitForLaunchApply(store: store, session: TVMUpdater.downloadSession(), seconds: 20)
        XCTAssertLessThan(Date().timeIntervalSince(started), 2)
    }

    func testChangelogKeepsCommitTitlesUntilCurrentSha() {
        let parsed = TVMChangelog.parseMessage("Fix player chrome\n\nSafe areas")
        XCTAssertEqual(parsed.title, "Fix player chrome")
        XCTAssertEqual(parsed.body, "Safe areas")
        XCTAssertTrue(TVMChangelog.skip("Merge pull request #12 from a/b"))
        XCTAssertTrue(TVMChangelog.sameCommit("abcdef123", "abcdef"))
        let entries = TVMChangelog.entries(from: [
            ["sha": "bbb222ccc", "commit": ["message": "Fix player chrome\n\nSafe areas", "committer": ["date": "2026-09-14T12:00:00Z"]]],
            ["sha": "ccc333ddd", "commit": ["message": "Merge pull request #1"]],
            ["sha": "aaa111000", "commit": ["message": "Old build"]],
        ], until: "aaa111")
        XCTAssertEqual(entries.compactMap { $0["title"] as? String }, ["Fix player chrome"])
        let store = TVMStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("tvm-cl-\(UUID().uuidString)"))
        testFolders.append(store.root)
        TVMChangelog.writePending(store: store, version: "bbb222c", from: "aaa111", to: "bbb222ccc", entries: entries)
        XCTAssertEqual(TVMChangelog.record(store: store)?["pending"] as? Bool, true)
        XCTAssertEqual(TVMChangelog.markSeen(store: store)["pending"] as? Bool, false)
    }

    // MARK: Update feed

    func testManifestParsingRefusesAnythingIncomplete() {
        let sha = String(repeating: "a", count: 64)
        let good = TVMUpdater.Manifest.parse([
            "commit": "ABCDEF1234567", "asset": "tvm-ios-ui.tar.gz", "sha256": sha, "nativeApi": 2,
            "contentHash": String(repeating: "B", count: 64),
            "entries": [["sha": "abcdef1", "title": "Newest"], ["sha": "", "title": ""]],
            "history": ["abcdef1", 7, "1234567"],
        ])
        XCTAssertEqual(good?.commit, "abcdef1234567")
        XCTAssertEqual(good?.nativeApi, 2)
        XCTAssertEqual(good?.entries.count, 1)
        XCTAssertEqual(good?.history, ["abcdef1", "1234567"])
        XCTAssertNil(TVMUpdater.Manifest.parse(["commit": "nothex!", "asset": "a.tar.gz", "sha256": sha]))
        XCTAssertNil(TVMUpdater.Manifest.parse(["commit": "abcdef1", "asset": "../evil", "sha256": sha]))
        XCTAssertNil(TVMUpdater.Manifest.parse(["commit": "abcdef1", "asset": "a.tar.gz", "sha256": "short"]))
        XCTAssertNil(TVMUpdater.Manifest.parse(nil))
    }

    /// The same vectors as changesSince in apps/core/src/update/update.test.ts.
    func testChangesUseTheHistoryToFindTheRunningBuild() {
        let entries: [[String: Any]] = [
            ["sha": "eee5555", "title": "Newest interface change"],
            ["sha": "ccc3333", "title": "Older interface change"],
        ]
        let history = ["eee5555", "ddd4444", "ccc3333", "bbb2222"]
        func titles(_ current: String?) -> [String] {
            TVMChangelog.changes(entries: entries, history: history, since: current).compactMap { $0["title"] as? String }
        }
        XCTAssertEqual(titles("ddd4444" + String(repeating: "0", count: 33)), ["Newest interface change"])
        XCTAssertEqual(titles("bbb2222"), ["Newest interface change", "Older interface change"])
        XCTAssertEqual(titles("eee5555"), [])
        XCTAssertEqual(titles(nil).count, 2)
        // Unknown to the history: fall back to walking the entries.
        XCTAssertEqual(TVMChangelog.changes(entries: entries, history: [], since: "ccc3333").compactMap { $0["title"] as? String }, ["Newest interface change"])
    }

    func testChecksumMatchesKnownVector() {
        XCTAssertEqual(TVMUpdater.sha256Hex(Data("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    }

    private func writeBundle(_ root: URL, commit: String, nativeApi: Int = StandalonePolicy.nativeAPI) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        try Data("<html>\(commit)</html>".utf8).write(to: root.appendingPathComponent("index.html"))
        try JSONValue.data(["commit": commit, "nativeApi": nativeApi]).write(to: root.appendingPathComponent("build-info.json"))
    }

    /*
     A downloaded interface is only used on the app build it was applied to.
     Before this, sideloading a new IPA kept serving whatever the old one had
     downloaded, which could be older than the new app, or newer than it.
     */
    func testDownloadedInterfaceIsOnlyUsedOnTheAppBuildItWasAppliedTo() throws {
        let store = TVMStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("tvm-overlay-\(UUID().uuidString)"))
        testFolders.append(store.root)
        let overlay = TVMBundledUI.overlayRoot(store: store)
        XCTAssertTrue(overlay.hasDirectoryPath)
        try writeBundle(overlay, commit: "1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")

        store.writeJSON(TVMBundledUI.markerName, ["appBuild": TVMBundledUI.appBuild()])
        TVMBundledUI.prepare(store: store)
        assertSameFolder(TVMBundledUI.root(store: store), overlay)

        store.writeJSON(TVMBundledUI.markerName, ["appBuild": "someotherbuild"])
        TVMBundledUI.prepare(store: store)
        assertSameFolder(TVMBundledUI.root(store: store), TVMBundledUI.bundledRoot())
        XCTAssertFalse(FileManager.default.fileExists(atPath: overlay.path), "a stale download is removed, not kept")
    }

    func testInterfaceNeedingNewerNativeCodeIsNeverUsed() throws {
        let store = TVMStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("tvm-native-\(UUID().uuidString)"))
        testFolders.append(store.root)
        try writeBundle(TVMBundledUI.overlayRoot(store: store), commit: "2222222", nativeApi: StandalonePolicy.nativeAPI + 1)
        store.writeJSON(TVMBundledUI.markerName, ["appBuild": TVMBundledUI.appBuild()])
        TVMBundledUI.prepare(store: store)
        assertSameFolder(TVMBundledUI.root(store: store), TVMBundledUI.bundledRoot())
    }

    func testStagedInterfaceGoesLiveOnTheNextLaunchWithItsChangelog() throws {
        let store = TVMStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("tvm-staged-\(UUID().uuidString)"))
        testFolders.append(store.root)
        let commit = "3333333ccccccccccccccccccccccccccccccccc"
        try writeBundle(TVMBundledUI.stagedRoot(store: store), commit: commit)
        store.writeJSON(TVMBundledUI.stagedMetaName, [
            "commit": commit,
            "appBuild": TVMBundledUI.appBuild(),
            "entries": [["sha": "3333333", "title": "Fix the sign-in form", "body": ""]],
        ])
        TVMBundledUI.prepare(store: store)
        assertSameFolder(TVMBundledUI.root(store: store), TVMBundledUI.overlayRoot(store: store))
        XCTAssertEqual(TVMBundledUI.commit(in: TVMBundledUI.root(store: store)), commit)
        XCTAssertFalse(FileManager.default.fileExists(atPath: TVMBundledUI.stagedRoot(store: store).path))
        let record = TVMChangelog.record(store: store)
        XCTAssertEqual(record?["pending"] as? Bool, true)
        XCTAssertEqual(record?["version"] as? String, "3333333")
        XCTAssertEqual((record?["entries"] as? [[String: Any]])?.first?["title"] as? String, "Fix the sign-in form")

        // A second launch with nothing staged changes nothing and announces nothing new.
        _ = TVMChangelog.markSeen(store: store)
        TVMBundledUI.prepare(store: store)
        XCTAssertEqual(TVMBundledUI.commit(in: TVMBundledUI.root(store: store)), commit)
        XCTAssertEqual(TVMChangelog.record(store: store)?["pending"] as? Bool, false)
    }

    func testStagedInterfaceForAnotherAppBuildIsDiscarded() throws {
        let store = TVMStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("tvm-staged-other-\(UUID().uuidString)"))
        testFolders.append(store.root)
        try writeBundle(TVMBundledUI.stagedRoot(store: store), commit: "4444444")
        store.writeJSON(TVMBundledUI.stagedMetaName, ["commit": "4444444", "appBuild": "someotherbuild"])
        TVMBundledUI.prepare(store: store)
        assertSameFolder(TVMBundledUI.root(store: store), TVMBundledUI.bundledRoot())
        XCTAssertFalse(FileManager.default.fileExists(atPath: TVMBundledUI.stagedRoot(store: store).path))
    }

    func testOverlayRootStaysADirectoryURLBeforeTheFolderExists() {
        let store = TVMStore(root: FileManager.default.temporaryDirectory.appendingPathComponent("tvm-dirurl-\(UUID().uuidString)"))
        testFolders.append(store.root)
        let before = TVMBundledUI.overlayRoot(store: store)
        XCTAssertTrue(before.hasDirectoryPath)
        XCTAssertFalse(FileManager.default.fileExists(atPath: before.path))
        try? FileManager.default.createDirectory(at: before, withIntermediateDirectories: true)
        XCTAssertEqual(before, TVMBundledUI.overlayRoot(store: store))
    }

    func testAccountSessionPrefersTheRokuHeader() async throws {
        let core = testCore()
        let registered = await core.handle(
            method: "POST", path: "/api/account/register", query: [:], headers: [:],
            body: JSONValue.data(["email": "someone@example.com", "password": "a good long password", "displayName": "Someone"])
        )
        XCTAssertEqual(registered.status, 200)
        let signed = await core.handle(
            method: "POST", path: "/api/account/signin", query: [:], headers: [:],
            body: JSONValue.data(["email": "someone@example.com", "password": "a good long password"])
        )
        XCTAssertEqual(signed.status, 200)
        let payload = try XCTUnwrap(try JSONSerialization.jsonObject(with: signed.body) as? [String: Any])
        let token = try XCTUnwrap(payload["token"] as? String)
        let viaHeader = await core.handle(
            method: "GET", path: "/api/account", query: [:],
            headers: ["x-tvm-account": token], body: nil
        )
        XCTAssertEqual(viaHeader.status, 200)
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: viaHeader.body) as? [String: Any])
        XCTAssertEqual(body["signedIn"] as? Bool, true)
    }

    func testAWrongDevCodeIsRefusedAndDevModeStaysOff() async throws {
        let core = testCore()
        let reply = await core.handle(
            method: "POST", path: "/api/account/dev", query: [:], headers: [:],
            body: JSONValue.data(["code": "not the code"])
        )
        XCTAssertEqual(reply.status, 403)
        XCTAssertFalse(core.plans.developer())
    }

    func testDevOnlyRoutesNeedDevModeAndPhonesSayTheyDoNotSendEmail() async throws {
        let core = testCore()
        for path in ["/api/admin/accounts/live-tv", "/api/admin/accounts/rd", "/api/admin/accounts/verify"] {
            let reply = await core.handle(method: "POST", path: path, query: [:], headers: [:], body: JSONValue.data(["id": "x"]))
            XCTAssertEqual(reply.status, 403, path)
        }
        let locked = await core.handle(method: "GET", path: "/api/admin/mail", query: [:], headers: [:], body: nil)
        XCTAssertEqual(locked.status, 403)

        core.plans.setDeveloper(true)
        let mail = await core.handle(method: "GET", path: "/api/admin/mail", query: [:], headers: [:], body: nil)
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: mail.body) as? [String: Any])
        XCTAssertEqual(body["supported"] as? Bool, false)
        let send = await core.handle(method: "POST", path: "/api/account/email/send", query: [:], headers: [:], body: nil)
        XCTAssertEqual(send.status, 503)
    }

    func testTheTestChannelIsOnlyThereInDevModeAndHidesItsAddress() async throws {
        let core = testCore()
        let before = await core.handle(method: "GET", path: "/api/live", query: [:], headers: [:], body: nil)
        let hidden = try XCTUnwrap(try JSONSerialization.jsonObject(with: before.body) as? [String: Any])
        XCTAssertEqual((hidden["channels"] as? [[String: Any]])?.count, 0)

        core.plans.setDeveloper(true)
        let after = await core.handle(method: "GET", path: "/api/live", query: [:], headers: [:], body: nil)
        let shown = try XCTUnwrap(try JSONSerialization.jsonObject(with: after.body) as? [String: Any])
        let first = try XCTUnwrap((shown["channels"] as? [[String: Any]])?.first)
        XCTAssertEqual(first["id"] as? String, "live:test:dw-news")
        XCTAssertNil(first["url"])
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

/**
 * The phone's account rules.
 *
 * The iPhone build runs its own embedded core, so the gate in front of
 * everything is answered here rather than by a desktop. The desktop equivalent
 * has had tests since it was written; this had none, which is the wrong way
 * round, because the rules that matter most are the ones about who gets in.
 *
 * Each test names the rule it protects rather than the method it calls: the
 * point is that this, the Kotlin port and the TypeScript core agree.
 */
final class TVMAccountsTests: XCTestCase {
    private var roots: [URL] = []
    private let password = "a good long password"

    override func tearDown() {
        for root in roots { try? FileManager.default.removeItem(at: root) }
        roots.removeAll()
        super.tearDown()
    }

    private func makeAccounts() -> (TVMAccounts, URL) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tvm-accounts-\(UUID().uuidString)")
        roots.append(root)
        return (TVMAccounts(store: TVMStore(root: root)), root)
    }

    @discardableResult
    private func register(_ accounts: TVMAccounts, email: String = "someone@example.com") throws -> String {
        let made = try accounts.register(email: email, password: password, displayName: "Someone", client: "test").get()
        return try XCTUnwrap(made["id"] as? String)
    }

    private func token(_ accounts: TVMAccounts, email: String = "someone@example.com") throws -> String {
        let signedIn = try accounts.signIn(email: email, password: password, client: "test").get()
        return try XCTUnwrap(signedIn["token"] as? String)
    }

    func testAccountStartsInertAndGrantsNothing() throws {
        let (accounts, _) = makeAccounts()
        let made = try accounts.register(email: "someone@example.com", password: password, displayName: "Someone", client: "test").get()
        XCTAssertEqual(made["activated"] as? Bool, false)
        XCTAssertNil(made["tier"] as? String)

        let signedIn = try accounts.signIn(email: "someone@example.com", password: password, client: "test").get()
        let usable = try XCTUnwrap(signedIn["usable"] as? [String: Any])
        XCTAssertEqual(usable["ok"] as? Bool, false)
        XCTAssertEqual(usable["reason"] as? String, "awaiting_activation")
    }

    func testActivationAloneIsNotEnoughTheTermsStillHaveToBeAgreed() throws {
        let (accounts, _) = makeAccounts()
        let id = try register(accounts)
        XCTAssertNotNil(accounts.activate(id: id, tier: "stream-live", note: nil))

        let version = TVMAccounts.termsVersion()
        let waiting = TVMAccounts.usable(accounts.resolve(token: try token(accounts)), termsVersion: version)
        XCTAssertEqual(waiting["reason"] as? String, "terms_required")

        _ = accounts.acceptTerms(id: id)
        let allowed = TVMAccounts.usable(accounts.resolve(token: try token(accounts)), termsVersion: version)
        XCTAssertEqual(allowed["ok"] as? Bool, true)
    }

    func testWrongPasswordAndMissingAccountAnswerIdentically() throws {
        let (accounts, _) = makeAccounts()
        try register(accounts)

        var wrongPassword: String?
        var noSuchAccount: String?
        if case .failure(let error) = accounts.signIn(email: "someone@example.com", password: "not the password", client: "test") {
            wrongPassword = error.message
        }
        if case .failure(let error) = accounts.signIn(email: "nobody@example.com", password: "not the password", client: "test") {
            noSuchAccount = error.message
        }
        XCTAssertNotNil(wrongPassword)
        XCTAssertEqual(wrongPassword, noSuchAccount)
    }

    func testSigningUpTwiceSaysNothingAboutWhetherTheAddressIsTaken() throws {
        let (accounts, _) = makeAccounts()
        try register(accounts)

        guard case .failure(let error) = accounts.register(email: "someone@example.com", password: "a different long password", displayName: nil, client: nil) else {
            return XCTFail("a duplicate address must not be accepted")
        }
        XCTAssertFalse(error.message.contains("already registered"))
        XCTAssertFalse(error.message.contains("taken"))
        XCTAssertTrue(error.message.contains("could not be created"))
    }

    func testNothingOnDiskCanProduceThePasswordAndSaltsAreNeverShared() throws {
        let (accounts, root) = makeAccounts()
        try register(accounts, email: "one@example.com")
        try register(accounts, email: "two@example.com")

        let ledger = try String(contentsOf: root.appendingPathComponent("accounts.json"), encoding: .utf8)
        XCTAssertFalse(ledger.contains(password))

        let parsed = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(ledger.utf8)) as? [String: Any])
        let rows = try XCTUnwrap(parsed["accounts"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 2)
        XCTAssertNotEqual(rows[0]["passwordSalt"] as? String, rows[1]["passwordSalt"] as? String)
        // Same password, different salt, so the digests have to differ too.
        XCTAssertNotEqual(rows[0]["passwordHash"] as? String, rows[1]["passwordHash"] as? String)
    }

    func testTheOwnerListingNeverCarriesTheDigestOrTheSalt() throws {
        let (accounts, _) = makeAccounts()
        let id = try register(accounts)
        _ = accounts.activate(id: id, tier: "stream", note: nil)

        let listed = try XCTUnwrap(accounts.list(search: nil, state: nil)["accounts"] as? [[String: Any]])
        let first = try XCTUnwrap(listed.first)
        XCTAssertNil(first["passwordHash"])
        XCTAssertNil(first["passwordSalt"])
    }

    func testATokenStopsWorkingTheMomentItIsSignedOut() throws {
        let (accounts, _) = makeAccounts()
        let id = try register(accounts)
        _ = accounts.activate(id: id, tier: "stream", note: nil)
        _ = accounts.acceptTerms(id: id)

        let live = try token(accounts)
        XCTAssertNotNil(accounts.resolve(token: live))
        accounts.signOut(token: live)
        XCTAssertNil(accounts.resolve(token: live))
    }

    func testSuspendingCutsLiveSessionsRatherThanWaitingForThemToLapse() throws {
        let (accounts, _) = makeAccounts()
        let id = try register(accounts)
        _ = accounts.activate(id: id, tier: "stream", note: nil)
        _ = accounts.acceptTerms(id: id)

        let live = try token(accounts)
        XCTAssertNotNil(accounts.resolve(token: live))
        _ = accounts.setSuspended(id: id, suspended: true)
        XCTAssertNil(accounts.resolve(token: live))
    }

    func testErasingTakesTheAccountAndItsSessionsTogether() throws {
        let (accounts, root) = makeAccounts()
        let id = try register(accounts)
        _ = accounts.activate(id: id, tier: "stream", note: nil)
        _ = accounts.acceptTerms(id: id)
        let live = try token(accounts)

        accounts.erase(id: id)
        XCTAssertNil(accounts.resolve(token: live))
        XCTAssertEqual((accounts.list(search: nil, state: nil)["accounts"] as? [[String: Any]])?.count, 0)
        let ledger = try String(contentsOf: root.appendingPathComponent("accounts.json"), encoding: .utf8)
        XCTAssertFalse(ledger.contains("someone@example.com"))
    }

    func testOnlyTheTwoRealTiersCanBeGranted() throws {
        let (accounts, _) = makeAccounts()
        let id = try register(accounts)
        XCTAssertNil(accounts.activate(id: id, tier: "free", note: nil))
        XCTAssertNil(accounts.activate(id: id, tier: "premium", note: nil))
        XCTAssertNotNil(accounts.activate(id: id, tier: "stream", note: nil))
        XCTAssertNotNil(accounts.activate(id: id, tier: "stream-live", note: nil))
    }

    func testTermsAgreedToAnOlderVersionDoNotCarryOver() throws {
        let (accounts, _) = makeAccounts()
        let id = try register(accounts)
        _ = accounts.activate(id: id, tier: "stream", note: nil)
        _ = accounts.acceptTerms(id: id)

        let account = accounts.resolve(token: try token(accounts))
        XCTAssertEqual(TVMAccounts.usable(account, termsVersion: TVMAccounts.termsVersion())["ok"] as? Bool, true)
        // The same account, judged by a build carrying newer terms.
        XCTAssertEqual(TVMAccounts.usable(account, termsVersion: "2099-01-01")["reason"] as? String, "terms_required")
    }

    func testAPasswordBelowTenCharactersIsRefused() throws {
        let (accounts, _) = makeAccounts()
        if case .success = accounts.register(email: "someone@example.com", password: "short", displayName: nil, client: nil) {
            XCTFail("a five character password must not be accepted")
        }
        if case .failure(let error) = accounts.register(email: "someone@example.com", password: "0123456789", displayName: nil, client: nil) {
            XCTFail("ten characters is the documented minimum: \(error.message)")
        }
    }

    // MARK: The dev account

    func testDevAccountIsBuiltInAlwaysUsableAndNotListed() throws {
        let (accounts, _) = makeAccounts()
        let first = accounts.signInDev(client: "test")
        let account = try XCTUnwrap(first["account"] as? [String: Any])
        XCTAssertEqual(account["role"] as? String, "dev")
        XCTAssertEqual((first["usable"] as? [String: Any])?["ok"] as? Bool, true)
        let second = accounts.signInDev(client: "test")
        XCTAssertEqual((second["account"] as? [String: Any])?["id"] as? String, TVMAccounts.devAccountID)
        XCTAssertEqual((accounts.list(search: nil, state: nil)["accounts"] as? [[String: Any]])?.count, 0)
        XCTAssertEqual((accounts.list(search: nil, state: nil)["summary"] as? [String: Any])?["total"] as? Int, 0)
    }

    func testDevAccountCannotBeReachedWithAPassword() {
        let (accounts, _) = makeAccounts()
        _ = accounts.signInDev(client: "test")
        if case .success = accounts.signIn(email: "dev", password: "", client: "test") {
            XCTFail("the dev account has no password")
        }
        if case .success = accounts.signIn(email: "dev", password: password, client: "test") {
            XCTFail("the dev account has no password")
        }
    }

    func testDevAccountCannotBeSwitchedOffOrErasedFromTheAccountsScreen() throws {
        let (accounts, _) = makeAccounts()
        let token = try XCTUnwrap(accounts.signInDev(client: "test")["token"] as? String)
        XCTAssertNil(accounts.setSuspended(id: TVMAccounts.devAccountID, suspended: true))
        XCTAssertNil(accounts.activate(id: TVMAccounts.devAccountID, tier: "stream", note: nil))
        if case .success = accounts.setRdToken(id: TVMAccounts.devAccountID, token: "abc") {
            XCTFail("the dev account is not edited from the Accounts screen")
        }
        accounts.erase(id: TVMAccounts.devAccountID)
        XCTAssertNotNil(accounts.resolve(token: token))
    }

    func testDevCountsAsSignedInUntilItsLastSessionEnds() throws {
        let (accounts, _) = makeAccounts()
        XCTAssertFalse(accounts.devSignedIn())
        let one = try XCTUnwrap(accounts.signInDev(client: "test")["token"] as? String)
        let two = try XCTUnwrap(accounts.signInDev(client: "test")["token"] as? String)
        accounts.signOut(token: one)
        XCTAssertTrue(accounts.devSignedIn())
        accounts.signOut(token: two)
        XCTAssertFalse(accounts.devSignedIn())
    }

    // MARK: What the dev sets per account

    func testAnAccountKeepsItsOwnRealDebridKeyAndOnlyShowsItsEnd() throws {
        let (accounts, _) = makeAccounts()
        let id = try register(accounts)
        let live = try token(accounts)
        XCTAssertNil(accounts.rdTokenFor(token: live))

        let saved = try accounts.setRdToken(id: id, token: "  ABCDEFGHIJKLMNOPQRSTUVWXYZ1234  ").get()
        XCTAssertEqual(saved["rdKey"] as? Bool, true)
        XCTAssertEqual(saved["rdKeyHint"] as? String, "••••1234")
        XCTAssertEqual(accounts.rdTokenFor(token: live), "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234")

        XCTAssertEqual(try accounts.setRdToken(id: id, token: "").get()["rdKey"] as? Bool, false)
        XCTAssertNil(accounts.rdTokenFor(token: live))
        if case .success = accounts.setRdToken(id: id, token: "has a space") {
            XCTFail("a Real-Debrid key has no spaces")
        }
    }

    func testLiveTvIsSwitchedOnlyForAnAccountThatIsOn() throws {
        let (accounts, _) = makeAccounts()
        let id = try register(accounts)
        if case .success = accounts.setLiveTv(id: id, enabled: true) {
            XCTFail("the account is not switched on yet")
        }
        _ = accounts.activate(id: id, tier: "stream", note: nil)
        XCTAssertEqual(try accounts.setLiveTv(id: id, enabled: true).get()["tier"] as? String, "stream-live")
        XCTAssertEqual(try accounts.setLiveTv(id: id, enabled: false).get()["tier"] as? String, "stream")
    }

    func testTheDevCanMarkAnAddressVerified() throws {
        let (accounts, _) = makeAccounts()
        let id = try register(accounts)
        XCTAssertEqual(try accounts.setEmailVerified(id: id, verified: true).get()["emailVerified"] as? Bool, true)
        XCTAssertEqual(try accounts.setEmailVerified(id: id, verified: false).get()["emailVerified"] as? Bool, false)
    }
}
