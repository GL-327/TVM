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
    /// Accounts are answered by an in-memory stand-in for the service, and the session token stays in memory,
    /// so no test reaches the network or the Keychain for them.
    private func testCore(session: URLSession? = nil, accounts: TVMAccountsTransport? = nil, vault: TVMSessionVault? = nil) -> TVMLocalCore {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("tvm-test-\(UUID().uuidString)")
        testFolders.append(root)
        return TVMLocalCore(
            session: session,
            store: TVMStore(root: root),
            accountsTransport: accounts ?? FakeAccountsService(),
            sessionVault: vault ?? TVMMemorySessionVault()
        )
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

    /// The page draws the player's controls (as on Android); the engine only draws the picture.
    @MainActor func testVideoEngineDrawsOnlyThePictureUnderThePage() {
        let engine = TVMVideoEngine(id: "test", url: URL(string: "https://cdn.example/movie.mkv")!, startAt: 0, live: false)
        engine.view.frame = CGRect(origin: .zero, size: CGSize(width: 844, height: 390))
        XCTAssertFalse(engine.view.isUserInteractionEnabled, "taps go to the page's controls above the picture")
        XCTAssertTrue(engine.view.subviews.isEmpty)
        XCTAssertTrue((engine.view.gestureRecognizers ?? []).isEmpty)
        var events: [[String: Any]] = []
        engine.onEvent = { events.append($0) }
        var finished = false
        engine.onFinish = { finished = true }
        engine.command("stop", data: [:])
        XCTAssertTrue(finished)
        XCTAssertTrue(events.isEmpty)
    }

    /// A commentary or description sound track is not the episode's own sound.
    func testCommentaryTracksAreNotTheMainSound() {
        XCTAssertTrue(tvmIsCommentaryTrack("Commentary with Trey Parker and Matt Stone - [English]"))
        XCTAssertTrue(tvmIsCommentaryTrack("Director's commentary"))
        XCTAssertTrue(tvmIsCommentaryTrack("Audio Description"))
        XCTAssertFalse(tvmIsCommentaryTrack("English 5.1 - [English]"))
        XCTAssertFalse(tvmIsCommentaryTrack("Track 1"))
    }

    /// The shared phone look runs on iOS exactly as on Android, with the iOS layer after it.
    func testShellBootRunsTheSharedOverlayThenTheIOSLayer() {
        let boot = TVMShellScripts.compose(css: "html.tvm-android .x{color:red}</style>", overlay: "window.__o=1;", ios: "window.__i=1;", glassBar: true)
        XCTAssertTrue(boot.contains("root.classList.add('tvm-android')"))
        XCTAssertTrue(boot.contains("root.classList.add('tvm-ios')"))
        XCTAssertTrue(boot.contains("window.__tvmIosGlassBar = true"))
        let overlay = boot.range(of: "window.__o=1;")!, ios = boot.range(of: "window.__i=1;")!
        XCTAssertLessThan(overlay.lowerBound, ios.lowerBound)
        XCTAssertFalse(boot.contains("</style>"), "the stylesheet cannot end the script")
    }

    /// The keyboard is reported once, and the page is never inset for it.
    func testKeyboardIsOneMessage() {
        let open = TVMShellScripts.keyboard(height: 336)
        XCTAssertTrue(open.contains("toggle('tvm-ime-open',true)"))
        XCTAssertTrue(open.contains("__tvmKeyboardInset(0)"))
        XCTAssertTrue(open.contains("__tvmaKeyboard(336)"))
        let closed = TVMShellScripts.keyboard(height: 0)
        XCTAssertTrue(closed.contains("toggle('tvm-ime-open',false)"))
        XCTAssertTrue(closed.contains("__tvmaKeyboard(0)"))
    }

    /// The app's tab bar shows what the page reports.
    func testGlassBarReadsThePagesState() {
        var bar = TVMBarState()
        bar.read(["visible": true, "active": "live", "entrance": true,
                  "you": ["name": "P", "hue": 215, "picture": ""],
                  "popup": [["id": "more-profile", "title": "Profile 1", "detail": "Switch profile", "on": false],
                            ["id": "more-settings", "title": "Settings", "detail": "", "on": true]]])
        XCTAssertTrue(bar.visible)
        XCTAssertEqual(bar.active, "live")
        XCTAssertEqual(bar.youName, "P")
        XCTAssertEqual(bar.popup.map(\.id), ["more-profile", "more-settings"])
        XCTAssertTrue(bar.popup[1].on)
        XCTAssertNil(bar.youPicture)
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
        XCTAssertEqual(TVMDeviceChrome.playbackHeight(planMax: 2160), 2160)
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

    private func send(
        _ core: TVMLocalCore, _ method: String, _ path: String,
        body: [String: Any]? = nil, token: String? = nil, headers extra: [String: String] = [:]
    ) async throws -> (status: Int, json: [String: Any]) {
        var headers = extra
        if let token { headers["authorization"] = "Bearer \(token)" }
        let reply = await core.handle(method: method, path: path, query: [:], headers: headers, body: body.map { JSONValue.data($0) })
        let object = try XCTUnwrap(try JSONSerialization.jsonObject(with: reply.body) as? [String: Any])
        return (reply.status, object)
    }

    private func signInThroughCore(_ core: TVMLocalCore, email: String = "someone@example.com") async throws -> String {
        let reply = try await send(core, "POST", "/api/account/signin", body: ["email": email, "password": "a good long password"])
        XCTAssertEqual(reply.status, 200)
        return try XCTUnwrap(reply.json["token"] as? String)
    }

    func testAccountSessionPrefersTheRokuHeader() async throws {
        let service = FakeAccountsService()
        service.join(status: "active")
        let core = testCore(accounts: service)
        let token = try await signInThroughCore(core)
        let viaHeader = try await send(core, "GET", "/api/account", headers: ["x-tvm-account": token])
        XCTAssertEqual(viaHeader.status, 200)
        XCTAssertEqual(viaHeader.json["signedIn"] as? Bool, true)
    }

    func testTheDeveloperCodeIsGoneAndBothRoutesAnswerMoved() async throws {
        let service = FakeAccountsService()
        let core = testCore(accounts: service)
        let code = try await send(core, "POST", "/api/account/dev", body: ["code": "anything"])
        XCTAssertEqual(code.status, 410)
        XCTAssertEqual(code.json["error"] as? String, "moved")
        XCTAssertEqual(code.json.count, 1)
        let unlock = try await send(core, "POST", "/api/dev/unlock", body: ["password": "anything"])
        XCTAssertEqual(unlock.status, 410)
        XCTAssertEqual(unlock.json["error"] as? String, "moved")
        XCTAssertFalse(core.plans.developer())
        XCTAssertTrue(service.log.isEmpty)
    }

    func testAccountAdminRoutesAreForTheDashboardNotThePhone() async throws {
        let service = FakeAccountsService()
        service.join(email: "owner@example.com", status: "active", role: "admin")
        let core = testCore(accounts: service)
        let owner = try await signInThroughCore(core, email: "owner@example.com")
        let routes: [(String, String)] = [
            ("GET", "/api/admin/accounts"),
            ("POST", "/api/admin/accounts/activate"),
            ("POST", "/api/admin/accounts/suspend"),
            ("POST", "/api/admin/accounts/note"),
            ("POST", "/api/admin/accounts/erase"),
            ("POST", "/api/admin/accounts/live-tv"),
            ("POST", "/api/admin/accounts/rd"),
            ("POST", "/api/admin/accounts/verify"),
        ]
        for (method, path) in routes {
            for who in [nil, owner] as [String?] {
                let reply = try await send(core, method, path, body: ["id": "x"], token: who)
                XCTAssertEqual(reply.status, 403, "\(method) \(path)")
                XCTAssertEqual(reply.json["error"] as? String, "use_dashboard", "\(method) \(path)")
            }
        }
    }

    func testAnAdminAccountTurnsOnDeveloperModeAndOnlyThatAccount() async throws {
        let service = FakeAccountsService()
        service.join(email: "owner@example.com", status: "active", role: "admin")
        service.join(status: "active")
        let core = testCore(accounts: service)
        let owner = try await signInThroughCore(core, email: "owner@example.com")
        let member = try await signInThroughCore(core)

        let ownerStatus = try await send(core, "GET", "/api/dev/status", token: owner)
        XCTAssertEqual(ownerStatus.json["unlocked"] as? Bool, true)
        let memberStatus = try await send(core, "GET", "/api/dev/status", token: member)
        XCTAssertEqual(memberStatus.json["unlocked"] as? Bool, false)
        let anonymous = try await send(core, "GET", "/api/dev/status")
        XCTAssertEqual(anonymous.json["unlocked"] as? Bool, false)

        let memberMail = try await send(core, "GET", "/api/admin/mail", token: member)
        XCTAssertEqual(memberMail.status, 403)
        let ownerMail = try await send(core, "GET", "/api/admin/mail", token: owner)
        XCTAssertEqual(ownerMail.status, 200)
        XCTAssertEqual(ownerMail.json["supported"] as? Bool, false)

        let me = try await send(core, "GET", "/api/account", token: owner)
        XCTAssertEqual((me.json["account"] as? [String: Any])?["role"] as? String, "dev")
        XCTAssertEqual((me.json["usable"] as? [String: Any])?["ok"] as? Bool, true)
    }

    func testPhonesSayTheyDoNotSendEmail() async throws {
        let core = testCore(accounts: FakeAccountsService())
        let email = try await send(core, "POST", "/api/account/email/send")
        XCTAssertEqual(email.status, 503)
        let me = try await send(core, "GET", "/api/account")
        XCTAssertEqual(me.json["signedIn"] as? Bool, false)
    }

    func testTheAccountScreenGetsTheSameShapeAsBefore() async throws {
        let service = FakeAccountsService()
        service.join(status: "active")
        let core = testCore(accounts: service)
        let token = try await signInThroughCore(core)
        let me = try await send(core, "GET", "/api/account", token: token)
        XCTAssertEqual(me.json["signedIn"] as? Bool, true)
        XCTAssertEqual(me.json["canSendEmail"] as? Bool, false)
        XCTAssertEqual(me.json["termsVersion"] as? String, TVMAccounts.termsVersion())
        let account = try XCTUnwrap(me.json["account"] as? [String: Any])
        for key in ["id", "email", "displayName", "role", "activated", "tier", "suspended", "createdAt",
                    "termsVersion", "termsAcceptedAt", "emailVerified", "emailCodeSent", "rdKey"] {
            XCTAssertNotNil(account[key], key)
        }
        XCTAssertEqual((me.json["usable"] as? [String: Any])?["reason"] as? String, "terms_required")

        let agreed = try await send(core, "POST", "/api/account/terms", token: token)
        XCTAssertEqual(agreed.status, 200)
        let after = try await send(core, "GET", "/api/account", token: token)
        XCTAssertEqual((after.json["usable"] as? [String: Any])?["ok"] as? Bool, true)
    }

    func testRegisterAndSignInErrorsKeepTheirStatuses() async throws {
        let service = FakeAccountsService()
        service.join()
        let core = testCore(accounts: service)
        let wrong = try await send(core, "POST", "/api/account/signin", body: ["email": "someone@example.com", "password": "nope nope nope"])
        XCTAssertEqual(wrong.status, 401)
        let bad = try await send(core, "POST", "/api/account/register", body: ["email": "x", "password": "a good long password"])
        XCTAssertEqual(bad.status, 400)
        service.down = true
        let offline = try await send(core, "POST", "/api/account/signin", body: ["email": "someone@example.com", "password": "a good long password"])
        XCTAssertEqual(offline.status, 503)
        let unknown = try await send(core, "GET", "/api/account", token: String(repeating: "t", count: 43))
        XCTAssertEqual(unknown.status, 503)
    }

    func testAMemberClearingTheirKeyGoesToTheServiceNotTheDevice() async throws {
        let service = FakeAccountsService()
        let member = service.join(status: "active")
        member.rdToken = "RDKEY0000WXYZ"
        let core = testCore(accounts: service)
        let token = try await signInThroughCore(core)
        let before = try await send(core, "GET", "/api/account", token: token)
        XCTAssertEqual((before.json["account"] as? [String: Any])?["rdKey"] as? Bool, true)

        // Clearing needs no call to Real-Debrid, so this stays off the network.
        let cleared = try await send(core, "PUT", "/api/rd/token", body: ["token": ""], token: token)
        XCTAssertEqual(cleared.status, 200)
        XCTAssertTrue(cleared.json["source"] is NSNull)
        XCTAssertNil(member.rdToken)
        XCTAssertEqual(service.count("PUT /v1/me/rd-token"), 1)
        let after = try await send(core, "GET", "/api/account", token: token)
        XCTAssertEqual((after.json["account"] as? [String: Any])?["rdKey"] as? Bool, false)
    }

    func testFactoryResetSignsThePhoneOutOfTheService() async throws {
        let service = FakeAccountsService()
        service.join(status: "active")
        let vault = TVMMemorySessionVault()
        let core = testCore(accounts: service, vault: vault)
        let token = try await signInThroughCore(core)
        XCTAssertEqual(vault.read(), token)
        let reset = try await send(core, "POST", "/api/maintenance/factory-reset")
        XCTAssertEqual(reset.status, 200)
        XCTAssertNil(vault.read())
        XCTAssertNil(service.sessions[token])
    }

    func testOnlyTheSessionTokenIsKeptNoLedgerAndNoPassword() async throws {
        let service = FakeAccountsService()
        service.join()
        let vault = TVMMemorySessionVault()
        let core = testCore(accounts: service, vault: vault)
        let token = try await signInThroughCore(core)
        XCTAssertEqual(vault.read(), token)
        XCTAssertFalse(FileManager.default.fileExists(atPath: core.store.root.appendingPathComponent("accounts.json").path))
        let files = FileManager.default.enumerator(at: core.store.root, includingPropertiesForKeys: nil)?.allObjects as? [URL] ?? []
        for file in files {
            guard let text = try? String(contentsOf: file, encoding: .utf8) else { continue }
            XCTAssertFalse(text.contains("a good long password"))
            XCTAssertFalse(text.contains(token))
        }
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

/// The accounts service, in memory. Same endpoints and answers as TVM-accounts' README.
final class FakeAccountsService: TVMAccountsTransport {
    final class Member {
        let id: String
        let email: String
        let password: String
        var status: String
        var role: String
        var liveTv = false
        var termsVersion: String?
        var rdToken: String?

        init(id: String, email: String, password: String, status: String = "waiting", role: String = "member") {
            self.id = id
            self.email = email
            self.password = password
            self.status = status
            self.role = role
        }
    }

    static let password = "a good long password"

    var members: [Member] = []
    var sessions: [String: Member] = [:]
    var log: [String] = []
    var bodies: [[String: Any]] = []
    var down = false
    private var counter = 0

    func count(_ prefix: String) -> Int { log.filter { $0.hasPrefix(prefix) }.count }

    @discardableResult
    func join(email: String = "someone@example.com", status: String = "waiting", role: String = "member") -> Member {
        let member = Member(id: "acc_seed_\(members.count)", email: email, password: FakeAccountsService.password, status: status, role: role)
        members.append(member)
        return member
    }

    private func account(_ member: Member) -> [String: Any] {
        [
            "id": member.id, "email": member.email,
            "displayName": String(member.email.split(separator: "@").first ?? ""),
            "role": member.role, "status": member.status, "tier": "stream", "liveTv": member.liveTv,
            "emailVerified": false,
            "termsVersion": JSONValue.orNull(member.termsVersion),
            "hasRdToken": member.rdToken != nil,
            "createdAt": "2026-11-01T10:00:00.000Z",
        ]
    }

    func send(method: String, url: URL, bearer: String?, body: Data?) async throws -> (status: Int, body: Data) {
        if down { throw URLError(.notConnectedToInternet) }
        let path = url.path
        log.append("\(method) \(path)")
        let json = JSONValue.object(body)
        if body != nil { bodies.append(json) }
        func reply(_ status: Int, _ value: [String: Any] = [:]) -> (status: Int, body: Data) {
            (status, status == 204 ? Data() : JSONValue.data(value))
        }
        var session: Member?
        if let bearer, let found = sessions[bearer], found.status != "suspended" { session = found }
        let unauthorized = reply(401, ["error": "unauthorized"])

        switch (method, path) {
        case ("POST", "/v1/register"):
            let email = json["email"] as? String ?? ""
            // A duplicate gets the same receipt, so the service never says who has an account.
            if members.contains(where: { $0.email == email }) {
                return reply(201, ["account": account(Member(id: "acc_new", email: email, password: ""))])
            }
            counter += 1
            let made = Member(id: "acc_\(counter)", email: email, password: json["password"] as? String ?? "")
            members.append(made)
            return reply(201, ["account": account(made)])
        case ("POST", "/v1/signin"):
            guard let member = members.first(where: { $0.email == (json["email"] as? String ?? "") }),
                  member.password == (json["password"] as? String ?? ""), member.status != "suspended" else {
                return reply(401, ["error": "invalid"])
            }
            counter += 1
            let token = String(repeating: "s", count: 10) + String(format: "%040d", counter)
            sessions[token] = member
            return reply(200, ["session": token, "account": account(member)])
        case ("POST", "/v1/signout"):
            guard let bearer, session != nil else { return unauthorized }
            sessions.removeValue(forKey: bearer)
            return reply(204)
        case ("GET", "/v1/me"):
            guard let member = session else { return unauthorized }
            return reply(200, ["account": account(member)])
        case ("POST", "/v1/me/terms"):
            guard let member = session else { return unauthorized }
            member.termsVersion = json["version"] as? String
            return reply(200, ["account": account(member)])
        case ("PUT", "/v1/me/rd-token"):
            guard let member = session else { return unauthorized }
            let token = json["token"] as? String ?? ""
            member.rdToken = token.isEmpty ? nil : token
            return reply(200, ["account": account(member)])
        case ("GET", "/v1/me/rd-token"):
            guard let member = session else { return unauthorized }
            guard member.status == "active" else { return reply(403, ["error": "forbidden"]) }
            return reply(200, ["token": JSONValue.orNull(member.rdToken)])
        default:
            return reply(404, ["error": "not_found"])
        }
    }
}

/**
 * The phone's account rules, against a mocked accounts service.
 *
 * The accounts live in TVM's private service; the phone only forwards to it and
 * keeps a session token. These tests stand in for the service (FakeAccountsService)
 * so they check what the phone sends, what it keeps, and how it answers the
 * interface, without a network.
 */
final class TVMAccountsTests: XCTestCase {
    private let password = FakeAccountsService.password
    private let origin = "https://accounts.test"
    private var service = FakeAccountsService()
    private var vault = TVMMemorySessionVault()
    private var clock = Date(timeIntervalSince1970: 1_000_000)

    override func setUp() {
        super.setUp()
        service = FakeAccountsService()
        vault = TVMMemorySessionVault()
        clock = Date(timeIntervalSince1970: 1_000_000)
    }

    private func makeAccounts() -> TVMAccounts {
        TVMAccounts(transport: service, vault: vault, origin: origin, now: { [unowned self] in self.clock })
    }

    private func token(_ accounts: TVMAccounts, email: String = "someone@example.com") async throws -> String {
        let signedIn = try await accounts.signIn(email: email, password: password, client: "test").get()
        return try XCTUnwrap(signedIn["token"] as? String)
    }

    // MARK: Registering and signing in

    func testRegisteringSendsOnlyWhatTheServiceTakesAndGrantsNothing() async throws {
        let accounts = makeAccounts()
        let made = try await accounts.register(email: "  Someone@Example.com ", password: password, displayName: "Someone", client: "test agent").get()
        XCTAssertEqual(made["activated"] as? Bool, false)
        XCTAssertTrue(made["tier"] is NSNull)
        XCTAssertEqual(made["role"] as? String, "member")
        XCTAssertEqual(service.log, ["POST /v1/register"])
        let sent = try XCTUnwrap(service.bodies.first)
        XCTAssertEqual(Set(sent.keys), ["email", "password", "displayName", "client"])
        XCTAssertEqual(sent["email"] as? String, "someone@example.com")
        XCTAssertTrue(service.sessions.isEmpty)
    }

    func testBadInputIsRefusedWithoutAskingTheService() async throws {
        let accounts = makeAccounts()
        if case .success = await accounts.register(email: "not an email", password: password, displayName: nil, client: nil) { XCTFail("not an address") }
        if case .success = await accounts.register(email: "someone@example.com", password: "short", displayName: nil, client: nil) { XCTFail("too short") }
        if case .success = await accounts.register(email: "someone@example.com", password: String(repeating: "x", count: 201), displayName: nil, client: nil) { XCTFail("too long") }
        XCTAssertTrue(service.log.isEmpty)
        if case .failure(let error) = await accounts.register(email: "someone@example.com", password: "0123456789", displayName: nil, client: nil) {
            XCTFail("ten characters is the documented minimum: \(error.message)")
        }
    }

    func testAWaitingAccountSignsInButCanDoNothing() async throws {
        service.join()
        let accounts = makeAccounts()
        let signedIn = try await accounts.signIn(email: "someone@example.com", password: password, client: "test").get()
        let usable = try XCTUnwrap(signedIn["usable"] as? [String: Any])
        XCTAssertEqual(usable["ok"] as? Bool, false)
        XCTAssertEqual(usable["reason"] as? String, "awaiting_activation")
        XCTAssertEqual((signedIn["account"] as? [String: Any])?["activated"] as? Bool, false)
    }

    func testWrongPasswordAndMissingAccountAnswerIdentically() async throws {
        service.join()
        let accounts = makeAccounts()
        var wrongPassword: String?
        var noSuchAccount: String?
        if case .failure(let error) = await accounts.signIn(email: "someone@example.com", password: "not the password", client: "test") {
            wrongPassword = error.message
        }
        if case .failure(let error) = await accounts.signIn(email: "nobody@example.com", password: password, client: "test") {
            noSuchAccount = error.message
        }
        XCTAssertNotNil(wrongPassword)
        XCTAssertEqual(wrongPassword, noSuchAccount)
        XCTAssertNil(vault.read())
    }

    func testActivationAloneIsNotEnoughTheTermsStillHaveToBeAgreed() async throws {
        let member = service.join(status: "active")
        let accounts = makeAccounts()
        let live = try await token(accounts)
        let version = TVMAccounts.termsVersion()
        let before = TVMAccounts.usable(await accounts.resolve(token: live), termsVersion: version)
        XCTAssertEqual(before["reason"] as? String, "terms_required")

        let accepted = try await accounts.acceptTerms(token: live).get()
        XCTAssertEqual(accepted["termsVersion"] as? String, version)
        XCTAssertEqual(member.termsVersion, version)
        let allowed = TVMAccounts.usable(await accounts.resolve(token: live), termsVersion: version)
        XCTAssertEqual(allowed["ok"] as? Bool, true)
    }

    func testTermsAgreedToAnOlderVersionDoNotCarryOver() async throws {
        service.join(status: "active").termsVersion = "2025-01-01"
        let accounts = makeAccounts()
        let account = await accounts.resolve(token: try await token(accounts))
        XCTAssertEqual(TVMAccounts.usable(account, termsVersion: TVMAccounts.termsVersion())["reason"] as? String, "terms_required")
        // The same account, judged by a build carrying newer terms.
        XCTAssertEqual(TVMAccounts.usable(account, termsVersion: "2025-01-01")["ok"] as? Bool, true)
    }

    func testAnAdminAccountIsAnsweredAsTheOldDevRoleAndAlwaysUsable() async throws {
        service.join(email: "owner@example.com", status: "active", role: "admin")
        let accounts = makeAccounts()
        let signedIn = try await accounts.signIn(email: "owner@example.com", password: password, client: "test").get()
        XCTAssertEqual((signedIn["account"] as? [String: Any])?["role"] as? String, "dev")
        XCTAssertEqual((signedIn["usable"] as? [String: Any])?["ok"] as? Bool, true)
    }

    func testASuspendedAccountIsSignedOut() async throws {
        let member = service.join(status: "active")
        let accounts = makeAccounts()
        let live = try await token(accounts)
        clock = clock.addingTimeInterval(TVMAccounts.accountTTL + 1)
        member.status = "suspended"
        let gone = await accounts.resolve(token: live)
        XCTAssertNil(gone)
        XCTAssertNil(vault.read())
        if case .success = await accounts.signIn(email: "someone@example.com", password: password, client: "test") {
            XCTFail("a suspended account cannot sign in")
        }
    }

    func testServiceTierFollowsLiveTv() async throws {
        let member = service.join(status: "active")
        member.liveTv = true
        let accounts = makeAccounts()
        let account = await accounts.resolve(token: try await token(accounts))
        XCTAssertEqual(account?.tier, "stream-live")
    }

    // MARK: What the phone keeps

    func testASecondSignInIsRememberedAndLeavesOtherSessionsAlone() async throws {
        service.join()
        let accounts = makeAccounts()
        let first = try await token(accounts)
        let second = try await token(accounts)
        XCTAssertEqual(vault.read(), second)
        XCTAssertNotNil(service.sessions[first])
        XCTAssertNotNil(service.sessions[second])
    }

    func testSigningOutClosesTheSessionAndForgetsIt() async throws {
        service.join(status: "active")
        let accounts = makeAccounts()
        let live = try await token(accounts)
        await accounts.signOut(token: live)
        XCTAssertTrue(service.sessions.isEmpty)
        XCTAssertNil(vault.read())
        let gone = await accounts.resolve(token: live)
        XCTAssertNil(gone)
    }

    func testSigningOutWorksEvenWhenTheServiceIsUnreachable() async throws {
        service.join()
        let accounts = makeAccounts()
        let live = try await token(accounts)
        service.down = true
        await accounts.signOut(token: live)
        XCTAssertNil(vault.read())
    }

    // MARK: The service cannot be reached

    func testAnUnreachableServiceSaysSoInsteadOfPretendingTheAccountIsMissing() async throws {
        service.join()
        service.down = true
        let accounts = makeAccounts()
        guard case .failure(let error) = await accounts.signIn(email: "someone@example.com", password: password, client: "test") else {
            return XCTFail("the service is down")
        }
        XCTAssertEqual(error.status, 503)
        if case .unavailable = await accounts.lookup(token: String(repeating: "x", count: 40)) {} else {
            XCTFail("no cached answer and no service")
        }
    }

    func testAnAccountSeenAMomentAgoStaysSignedInThroughAnOutage() async throws {
        service.join(status: "active")
        let accounts = makeAccounts()
        let live = try await token(accounts)
        clock = clock.addingTimeInterval(TVMAccounts.accountTTL + 1)
        service.down = true
        let kept = await accounts.resolve(token: live)
        XCTAssertNotNil(kept)
    }

    func testTheServiceIsNotAskedAboutTheSameSessionOnEveryRequest() async throws {
        service.join(status: "active")
        let accounts = makeAccounts()
        let live = try await token(accounts)
        for _ in 0..<5 { _ = await accounts.resolve(token: live) }
        XCTAssertEqual(service.count("GET /v1/me"), 0)
        clock = clock.addingTimeInterval(TVMAccounts.accountTTL + 1)
        _ = await accounts.resolve(token: live)
        _ = await accounts.resolve(token: live)
        XCTAssertEqual(service.count("GET /v1/me"), 1)
    }

    // MARK: The Real-Debrid key

    func testTheRealDebridKeyIsFetchedWhenNeededAndHeldInMemoryForAWhile() async throws {
        service.join(status: "active").rdToken = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234"
        let accounts = makeAccounts()
        let live = try await token(accounts)
        let first = await accounts.rdTokenFor(token: live)
        let second = await accounts.rdTokenFor(token: live)
        XCTAssertEqual(first, "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234")
        XCTAssertEqual(second, "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234")
        XCTAssertEqual(service.count("GET /v1/me/rd-token"), 1)

        clock = clock.addingTimeInterval(TVMAccounts.rdTTL + 1)
        let third = await accounts.rdTokenFor(token: live)
        XCTAssertEqual(third, "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234")
        XCTAssertEqual(service.count("GET /v1/me/rd-token"), 2)
    }

    func testNoKeyIsFetchedForAnAccountThatIsNotOnOrHasNone() async throws {
        service.join(email: "waiting@example.com").rdToken = "KEYKEYKEYKEY"
        service.join(email: "empty@example.com", status: "active")
        let accounts = makeAccounts()
        let waiting = await accounts.rdTokenFor(token: try await token(accounts, email: "waiting@example.com"))
        let empty = await accounts.rdTokenFor(token: try await token(accounts, email: "empty@example.com"))
        let none = await accounts.rdTokenFor(token: nil)
        XCTAssertNil(waiting)
        XCTAssertNil(empty)
        XCTAssertNil(none)
        XCTAssertEqual(service.count("GET /v1/me/rd-token"), 0)
    }

    func testSavingAndClearingAKeyGoesToTheServiceAndNeverOntoThePhone() async throws {
        let member = service.join(status: "active")
        let accounts = makeAccounts()
        let live = try await token(accounts)

        let saved = try await accounts.setRdToken(token: live, key: "  RDKEY0000WXYZ  ").get()
        XCTAssertEqual(saved["rdKey"] as? Bool, true)
        XCTAssertFalse("\(saved)".contains("RDKEY"))
        XCTAssertEqual(member.rdToken, "RDKEY0000WXYZ")
        let fetched = await accounts.rdTokenFor(token: live)
        XCTAssertEqual(fetched, "RDKEY0000WXYZ")

        let cleared = try await accounts.setRdToken(token: live, key: "").get()
        XCTAssertEqual(cleared["rdKey"] as? Bool, false)
        XCTAssertNil(member.rdToken)
        let gone = await accounts.rdTokenFor(token: live)
        XCTAssertNil(gone)
        if case .success = await accounts.setRdToken(token: live, key: "has a space") {
            XCTFail("a Real-Debrid key has no spaces")
        }
    }

    func testASwitchedOffAccountDropsItsKeyFromMemory() async throws {
        let member = service.join(status: "active")
        member.rdToken = "KEYKEYKEYKEY"
        let accounts = makeAccounts()
        let live = try await token(accounts)
        let held = await accounts.rdTokenFor(token: live)
        XCTAssertEqual(held, "KEYKEYKEYKEY")
        member.status = "waiting"
        clock = clock.addingTimeInterval(TVMAccounts.accountTTL + 1)
        let dropped = await accounts.rdTokenFor(token: live)
        XCTAssertNil(dropped)
    }
}
