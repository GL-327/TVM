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
        await fulfillment(of: [received], timeout: 3)
    }
}
