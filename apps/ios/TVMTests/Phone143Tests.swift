import XCTest
@testable import TVM

final class Phone143Tests: XCTestCase {
    private let xml = """
    <tv><channel id="bbc"><display-name>BBC One HD</display-name></channel>
    <programme channel="bbc" start="20261126123000 +0100" stop="20261126133000 +0100"><title>News &amp; Weather</title><sub-title><![CDATA[Midday <live>]]></sub-title><desc>Bulletin</desc><category>News</category><episode-num>1.2.</episode-num></programme>
    <programme channel="bbc" start="20261126123000 +0100" stop="20261126133000 +0100"><title>Duplicate</title></programme>
    <programme channel="bbc" start="20261126110000 Z" stop="20261126120000 Z"><title>Ends at start</title></programme>
    <programme channel="bbc" start="20261126150000 UTC" stop="20261126160000 UTC"><title>Starts at end</title></programme>
    <programme channel="bbc" start="202611261400" stop="202611261600"><title>Afternoon</title><icon src="file:///private"/></programme>
    <programme channel="other" start="20261126130000 Z" stop="20261126140000 Z"><title>Unwanted</title></programme>
    </tv>
    """

    func testXMLTVMatchingWindowAndEntities() throws {
        let window = try XCTUnwrap(GuideWindow.parse(start: "2026-11-26T12:00:00Z", hours: "3"))
        let schedule = try TVMXmlTv.parse(InputStream(data: Data(xml.utf8)), wants: [("BBC", "BBC One HD")], window: window)
        XCTAssertNil(schedule["id:other"])
        let rows = TVMXmlTv.programmeWindow(TVMXmlTv.match(schedule, id: "bBc", name: ""), window)
        XCTAssertEqual(rows.map { $0.title }, ["News & Weather", "Afternoon"])
        XCTAssertEqual(rows[0].start, "2026-11-26T11:30:00.000Z")
        XCTAssertEqual(rows[0].subtitle, "Midday <live>")
        XCTAssertEqual(rows[0].episode, "1.2.")
        XCTAssertNil(rows[1].image)
        let byName = try TVMXmlTv.parse(InputStream(data: Data(xml.utf8)), wants: [("wrong-id", "BBC One HD")], window: window)
        XCTAssertEqual(TVMXmlTv.programmeWindow(TVMXmlTv.match(byName, id: "wrong-id", name: "bbc one hd"), window), rows)
    }

    func testGuideWindowValidationAndMissingData() throws {
        for hours in ["0", "25", "1.5", "NaN", "bad", ""] { XCTAssertNil(GuideWindow.parse(start: nil, hours: hours)) }
        XCTAssertNil(GuideWindow.parse(start: "bad", hours: "3"))
        XCTAssertNil(TVMXmlTv.xmlDate("20260230120000 +0000"))
        let now = try XCTUnwrap(GuideWindow.date("2026-11-26T12:47:00Z"))
        let window = try XCTUnwrap(GuideWindow.parse(start: nil, hours: nil, now: now))
        XCTAssertEqual(GuideWindow.iso(window.start), "2026-11-26T12:30:00.000Z")
        XCTAssertEqual(GuideWindow.iso(window.end), "2026-11-26T15:30:00.000Z")
        let rows = TVMXmlTv.programmeWindow([], window)
        XCTAssertEqual(rows, [GuideProgramme(start: GuideWindow.iso(window.start), end: GuideWindow.iso(window.end), title: "No guide information")])
        XCTAssertThrowsError(try TVMXmlTv.parse(InputStream(data: Data("<tv><programme>".utf8)), wants: [], window: window))
    }

    func testXtreamFallbackDecodesAndFiltersWindow() throws {
        let window = try XCTUnwrap(GuideWindow.parse(start: "2026-11-26T12:00:00Z", hours: "3"))
        let rows = TVMXmlTv.xtream(["epg_listings": [
            ["start": "2026-11-26 11:30:00", "end": "2026-11-26 12:30:00", "title": "TmV3cw==", "description": "QnVsbGV0aW4="],
            ["start": "2026-11-26 15:00:00", "end": "2026-11-26 16:00:00", "title": "Outside"]
        ]], window: window)
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.title, "News")
        XCTAssertEqual(rows.first?.description, "Bulletin")
    }

    func testGzipInflationAndTruncatedInput() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let source = root.appendingPathComponent("guide.gz"), target = root.appendingPathComponent("guide.xml")
        let compressed = try XCTUnwrap(Data(base64Encoded: "H4sIAAAAAAAAClWNzQqDMBCEXyXkWkp+Cp7WPdh732HVpQ0kMSSLpW9fRCn2MgzzMTMgK8L0opw5qjD3ehwnjTCHViJ9rpkS4zDcwfwlYI4KQqnLs1JKrI5on1BNqEqvvfWdc75z3lpr1WXTDS7lxG4nhiBBIuOD3w3M7sH8XhCMrPgFD3WapbYAAAA="))
        try compressed.write(to: source)
        try TVMXmlTv.gunzip(source, to: target)
        let window = try XCTUnwrap(GuideWindow.parse(start: "2026-11-26T12:00:00Z", hours: "3"))
        let input = try XCTUnwrap(InputStream(url: target))
        let rows = try TVMXmlTv.parse(input, wants: [("bbc", "BBC")], window: window)
        XCTAssertEqual(TVMXmlTv.match(rows, id: "bbc", name: "").first?.title, "News")
        try Data(compressed.prefix(20)).write(to: source)
        XCTAssertThrowsError(try TVMXmlTv.gunzip(source, to: target))
    }

    private func stream(_ title: String, _ key: String, cached: Bool = true) -> RdStream {
        RdStream(url: "https://example.test/\(key)", title: title, name: "Torrentio", infoHash: nil, fileIdx: nil,
                 quality: 30, cached: cached, phoneHint: false, details: title, releaseId: key)
    }

    func testNativeRankingAndCapabilityRestrictions() {
        let entries = [stream("Film 1080p WEB-DL x264 English 2 GB.mp4", "a"),
                       stream("Film 2160p REMUX HEVC English 50 GB.mp4", "b"),
                       stream("Film 2160p REMUX HEVC French 60 GB.mp4", "c"),
                       stream("Film 2160p REMUX HEVC English AIUS 80 GB.mp4", "d"),
                       stream("Film 2160p REMUX HEVC English 90 GB.mkv", "e"),
                       stream("Film 2160p REMUX AV1 English 100 GB.mp4", "f"),
                       stream("Film 2160p REMUX HEVC TrueHD English 100 GB.mp4", "g")]
        let rows = TVMVersions.rankForPhone(entries, prefs: TVMPrefs(), originalLanguage: "eng", runtime: 7200, maxHeight: 2160)
        // libVLC plays Matroska and TrueHD, so the bigger native 4K copies win; French (not original), the AI
        // upscale and AV1 (software decode) stay out.
        XCTAssertEqual(rows.map { $0.stream.releaseId }, ["g", "e", "b", "a"])
        XCTAssertEqual(rows.first?.version.languages, ["eng"])
        XCTAssertEqual(rows.first?.version.recommended, true)
        let narrowed = TVMVersions.rankForPhone(entries, prefs: TVMPrefs(), originalLanguage: "eng", runtime: nil, maxHeight: 2160, client: PlaybackClient(player: "mpv", maxHeight: 1080, hevc: true, hdr: true, mkv: true))
        XCTAssertEqual(narrowed.map { $0.stream.releaseId }, ["a"])
        let cached = TVMVersions.rankForPhone([stream("Film 1080p AVC English.mp4", "u", cached: false), stream("Film 1080p AVC English.mp4", "c")], prefs: TVMPrefs(), originalLanguage: "eng", runtime: nil, maxHeight: 1080)
        XCTAssertEqual(cached.first?.stream.releaseId, "c")
    }

    func testWebhookValidation() {
        XCTAssertNil(TVMWebhook.parseEvent(["event": "invalid", "id": "tt123"]))
        XCTAssertNil(TVMWebhook.parseEvent(["event": "play", "id": "../private"]))
        let event = TVMWebhook.parseEvent(["event": "pause", "id": "tt123", "title": " Film ", "position": 12.5, "duration": -1])
        XCTAssertEqual(event?.title, "Film")
        XCTAssertEqual(event?.position, 12.5)
        XCTAssertNil(event?.duration)
        XCTAssertNil(TVMWebhook.parseEvent(["event": "play", "id": "tt123", "position": true])?.position)
        XCTAssertNil(TVMWebhook.parseEvent(["event": "play", "id": "tt123", "position": "12"])?.position)
    }

    func testWebhookGatingDeduplicationAndPayloads() async {
        var prefs = TVMPrefs()
        prefs.webhookUrl = "https://example.test/hook"
        let received = expectation(description: "play and pause")
        received.expectedFulfillmentCount = 2
        let webhook = TVMWebhook(readPrefs: { prefs }, now: { Date(timeIntervalSince1970: 1_800_000_000) }, sender: { url, body in
            let json = JSONValue.object(body)
            XCTAssertEqual(url.host, "example.test")
            XCTAssertEqual(json["id"] as? String, "tt123")
            XCTAssertNotNil(json["at"])
            received.fulfill()
        })
        let event = PlaybackEventRecord(event: "play", id: "tt123", title: "Film", position: nil, duration: nil)
        webhook.send(scope: "profile", event: event)
        prefs.extras["webhook"] = true
        webhook.send(scope: "profile", event: event)
        webhook.send(scope: "profile", event: event)
        webhook.send(scope: "profile", event: PlaybackEventRecord(event: "pause", id: "tt123", title: nil, position: 12, duration: 100))
        // Sends run on detached utility tasks; a busy CI simulator can take several seconds to schedule them.
        await fulfillment(of: [received], timeout: 15)
    }

    func testMarkWatchedSetsEpisodeFlagAndRoundTripsJSON() {
        func ep(_ id: String) -> MediaItem {
            MediaItem(
                id: id, title: id, year: 2026, kind: "series", synopsis: "",
                poster: "", backdrop: "", genres: [], rating: "", runtime: nil,
                playable: true, progress: nil, filename: nil, hue: 0, mimeType: nil,
                season: 1, episode: 1, episodeName: nil, showTitle: nil, aired: nil, added: nil
            )
        }
        let progress: [String: ProgressEntry] = [
            "tt1:1:1": ProgressEntry(position: 2920, duration: 3000, updated: "2026-11-01T00:00:00Z"),
            "tt1:1:2": ProgressEntry(position: 600, duration: 3000, updated: "2026-11-01T00:00:00Z"),
            "tt1:1:3": ProgressEntry(position: 0, duration: 3000, updated: "2026-11-01T00:00:00Z", completedAt: "2026-10-01T00:00:00Z"),
        ]
        let items = TVMMedia.markWatched([ep("tt1:1:1"), ep("tt1:1:2"), ep("tt1:1:3"), ep("tt1:1:4")], progress: progress)
        XCTAssertEqual(items.map { $0.watched }, [true, false, true, false])
        XCTAssertEqual(MediaItem.parse(items[0].json())?.watched, true)
        XCTAssertEqual(MediaItem.parse(items[1].json())?.watched, false)
        XCTAssertNil(MediaItem.parse(ep("tt9").json())?.watched)
    }

    func testNativeCompressorOptionsAndSleepTimerState() {
        XCTAssertTrue(TVMVideoEngine.compressorOptions(enabled: false).isEmpty)
        let onOpts = TVMVideoEngine.compressorOptions(enabled: true)
        XCTAssertEqual(onOpts["audio-filter"] as? String, "compressor")

        XCTAssertNil(tvmSleepDeadlineMs("off", nowMs: 1_000))
        XCTAssertEqual(tvmSleepDeadlineMs("30", nowMs: 1_000), 1_000 + 30 * 60_000)
        XCTAssertEqual(tvmSleepFadeFactor(elapsedMs: 2_500), 0.5, accuracy: 0.001)
        XCTAssertEqual(tvmFormatRemainingSleep(4_200), "0:05")
        XCTAssertEqual(tvmFormatRemainingSleep(900_000), "15:00")
        XCTAssertEqual(tvmFormatRemainingSleep(3_665_000), "1:01:05")

        var tracker = TVMSleepTimerState()
        tracker.reset(choice: "15", nowMs: 0)
        let mid = tracker.step(nowMs: 60_000, position: 60, duration: 1_800, paused: false)
        XCTAssertFalse(mid.snapshot.fading)
        XCTAssertEqual(mid.snapshot.remainingMs, 14 * 60_000)

        let fading = tracker.step(nowMs: 15 * 60_000 + 2_500, position: 902.5, duration: 1_800, paused: false)
        XCTAssertTrue(fading.snapshot.fading)
        XCTAssertEqual(tracker.fadeFactor, 0.5, accuracy: 0.02)

        let expired = tracker.step(nowMs: 15 * 60_000 + 5_000, position: 905, duration: 1_800, paused: false)
        XCTAssertTrue(expired.justExpired)
        XCTAssertTrue(expired.snapshot.expired)
        XCTAssertEqual(tracker.fadeFactor, 0, accuracy: 0.001)

        tracker.reset(choice: "end", nowMs: 0)
        XCTAssertFalse(tvmSleepShouldStart(choice: "end", deadlineMs: nil, nowMs: 0, position: 1_796, duration: 1_800, paused: true))
        let endTrigger = tracker.step(nowMs: 1_000, position: 1_796, duration: 1_800, paused: false)
        XCTAssertTrue(endTrigger.snapshot.fading)
    }

    func testNativeStatsBuilderFormatsVLCTelemetry() {
        // Little-endian FourCC 'h','v','c','1' and 'e','a','c','3'
        let hevcFourCC: UInt32 = 0x31637668
        let eac3FourCC: UInt32 = 0x33636165
        XCTAssertEqual(TVMNativeStatsBuilder.decodeFourCC(hevcFourCC), "HEVC")
        XCTAssertEqual(TVMNativeStatsBuilder.decodeFourCC(eac3FourCC), "EAC3")
        XCTAssertEqual(TVMNativeStatsBuilder.formatChannels(6), "5.1")

        let meta = TVMNativePlaybackMeta(
            source: "REMUX",
            versionLabel: "2160p REMUX",
            codec: nil,
            hdr: "dv",
            mimeType: "video/x-matroska"
        )
        let payload = TVMNativeStatsBuilder.build(
            videoWidth: 3840,
            videoHeight: 2160,
            tracks: [
                ["type": "video", "codec": NSNumber(value: hevcFourCC), "width": 3840, "height": 2160],
                ["type": "audio", "id": 1, "codec": NSNumber(value: eac3FourCC), "language": "eng", "channelsNumber": 6],
            ],
            currentAudioId: 1,
            activeAudioName: "English",
            activeSubtitleName: "English",
            lostPictures: 2,
            displayedPictures: 4198,
            decodedVideo: 4200,
            demuxBitrateMBs: 3.0, // 3.0 * 8.0 = 24.0 Mb/s
            inputBitrateMBs: 3.0,
            readBytes: 30_000_000,
            demuxReadBytes: 6_000_000, // 24 MB unread @ 3 MB/s = 8.0 s
            durationSeconds: 3600,
            live: false,
            meta: meta
        )
        let rows = Dictionary(uniqueKeysWithValues: TVMNativeStatsBuilder.rows(from: payload))
        XCTAssertEqual(rows["Resolution"], "3840 × 2160")
        XCTAssertEqual(rows["Container / MIME"], "video/x-matroska")
        XCTAssertEqual(rows["Codecs"], "HEVC · EAC3")
        XCTAssertEqual(rows["HDR"], "Dolby Vision")
        XCTAssertEqual(rows["Audio"], "eng · 5.1")
        XCTAssertEqual(rows["Subtitles"], "English")
        XCTAssertEqual(rows["Frames dropped / total"], "2 / 4200")
        XCTAssertEqual(rows["Bitrate"], "24.0 Mb/s")
        XCTAssertEqual(rows["Source"], "REMUX")
        XCTAssertEqual(rows["Version"], "2160p REMUX")
        XCTAssertEqual(rows["Buffer ahead"], "8.0 s")
    }
}
