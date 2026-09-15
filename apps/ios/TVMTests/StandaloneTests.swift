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
