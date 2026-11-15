import XCTest
@testable import TVM

/// The fixes ported from Android (the same cases as its JVM tests).
final class PortTests: XCTestCase {
    // MARK: Wrong episodes (South Park)

    // The real layout of a South Park "Seasons 1 to 25 … Movie and Extras" pack.
    private let pack = [
        TVMEpisodeMatch.File(id: 1, path: "/Extras/Commentaries/South Park - S01E01 - Cartman Gets an Anal Probe (Commentary).mp4", bytes: 300),
        TVMEpisodeMatch.File(id: 2, path: "/Season 01/South Park - S01E01 - Cartman Gets an Anal Probe.mp4", bytes: 243),
        TVMEpisodeMatch.File(id: 3, path: "/Season 01/South Park - S01E02 - Weight Gain 4000.mp4", bytes: 240),
        TVMEpisodeMatch.File(id: 4, path: "/Season 01/South Park - S01E05 - An Elephant Makes Love to a Pig.mp4", bytes: 268),
        TVMEpisodeMatch.File(id: 5, path: "/Season 04/South Park - S04E10 - Probably (2).mp4", bytes: 346),
        TVMEpisodeMatch.File(id: 6, path: "/South Park - Bigger Longer & Uncut.mkv", bytes: 2000),
        TVMEpisodeMatch.File(id: 7, path: "/Season 01/info.nfo", bytes: 1),
    ]

    func testEachEpisodeGetsItsOwnFileNeverTheFirstOrTheCommentary() {
        XCTAssertEqual(TVMEpisodeMatch.pickFile(pack, season: 1, episode: 1, fileIdx: nil)?.id, 2)
        XCTAssertEqual(TVMEpisodeMatch.pickFile(pack, season: 1, episode: 2, fileIdx: nil)?.id, 3)
        XCTAssertEqual(TVMEpisodeMatch.pickFile(pack, season: 1, episode: 5, fileIdx: 3)?.id, 4)
        XCTAssertEqual(TVMEpisodeMatch.pickFile(pack, season: 4, episode: 10, fileIdx: nil)?.id, 5)
        XCTAssertNil(TVMEpisodeMatch.pickFile(pack, season: 9, episode: 9, fileIdx: nil), "a missing episode is not replaced by another")
        XCTAssertEqual(TVMEpisodeMatch.pickFile(pack, season: 1, episode: 1, fileIdx: 0)?.id, 2, "Torrentio pointing at the commentary is not followed")
        XCTAssertEqual(TVMEpisodeMatch.pickFile(pack, season: nil, episode: nil, fileIdx: nil)?.id, 6)
    }

    func testNamesFitTheRequest() {
        XCTAssertEqual(TVMEpisodeMatch.fit("South Park - S01E05 - An Elephant Makes Love to a Pig.mp4", season: 1, episode: 5), .match)
        XCTAssertEqual(TVMEpisodeMatch.fit("South Park - S01E01 - Cartman Gets an Anal Probe.mp4", season: 1, episode: 5), .wrong)
        XCTAssertEqual(TVMEpisodeMatch.fit("South Park - S01E05 (Creator Commentary).mkv", season: 1, episode: 5), .wrong)
        XCTAssertEqual(TVMEpisodeMatch.fit("South.Park.1x05.mkv", season: 1, episode: 5), .match)
        XCTAssertEqual(TVMEpisodeMatch.fit("05 - An Elephant Makes Love to a Pig.mkv", season: 1, episode: 5), .unknown)
        XCTAssertEqual(TVMEpisodeMatch.fit("Trailer.Park.Boys.S02E03.mkv", season: 2, episode: 3), .match)
        XCTAssertEqual(TVMEpisodeMatch.fit("The.Interview.2014.1080p.mkv", season: nil, episode: nil), .unknown)
        let torrentio = "South Park Seasons 1 to 24 (UNCENSORED) Including the Movie and Extras [NVEnc H265]\nSouth Park - Season 1 - UNCENSORED/South Park - S01E05 - An Elephant Makes Love to a Pig.mp4\n👤 41 💾 101.5 MB ⚙️ 1337x"
        XCTAssertEqual(TVMEpisodeMatch.fit(TVMEpisodeMatch.sourceFile(torrentio), season: 1, episode: 5), .match)
        XCTAssertEqual(TVMEpisodeMatch.fit(TVMEpisodeMatch.sourceFile(torrentio), season: 1, episode: 1), .wrong)
    }

    // MARK: Search ranking

    private func hits(_ kind: String, _ titles: [String]) -> [TVMSearchRank.Hit] {
        titles.enumerated().map { index, title in
            TVMSearchRank.Hit(item: MediaItem(id: "tt\(kind)\(index)", title: title, year: nil, kind: kind, synopsis: "", poster: "", backdrop: "",
                                              genres: [], rating: "", runtime: nil, playable: true, progress: nil, filename: nil,
                                              hue: 0, mimeType: nil, season: nil, episode: nil, episodeName: nil, showTitle: title,
                                              aired: nil, added: nil),
                              index: index)
        }
    }

    func testExactSeriesWithSpinOffsLeadsOverSameNamedFilm() {
        let movies = hits("movie", ["Dexter", "Als je begrijpt wat ik bedoel", "Dexter Prep"])
        let series = hits("series", ["Dexter: Resurrection", "Dexter", "Dexter: New Blood", "Dexter: Original Sin"])
        let ranked = TVMSearchRank.rank("Dexter", movies: movies, series: series)
        XCTAssertEqual(ranked.first?.title, "Dexter")
        XCTAssertEqual(ranked.first?.kind, "series")
        XCTAssertEqual(ranked.last?.title, "Als je begrijpt wat ik bedoel")
        // With each record's popularity, the established title still leads.
        let withStanding = TVMSearchRank.rank("Severance", movies: hits("movie", ["Severance"]), series: hits("series", ["Severance"]),
                                              standing: ["ttmovie0": 0.05, "ttseries0": 1.3])
        XCTAssertEqual(withStanding.first?.kind, "series")
        XCTAssertEqual(TVMSearchRank.tier("law & order", "Law and Order"), 0)
        XCTAssertEqual(TVMSearchRank.tier("lord of the rings", "The Lord of the Rings: The Two Towers"), 2)
    }

    // MARK: Artwork

    override func tearDown() { TVMArtTrust.clear(); TVMArtTrust.onDistrusted = nil }

    func testCrossLinkedRecordKeepsArtworkOnlyOnTheEstablishedTitle() throws {
        let metas: [[String: Any]] = [
            ["id": "tt0118933", "name": "David", "popularity": 59.0498, "popularities": ["moviedb": 2272.4, "trakt": 1, "stremio": 59.0498, "stremio_lib": 0]],
            ["id": "tt0203259", "name": "Law & Order: Special Victims Unit", "popularity": 59.0498,
             "popularities": ["a": 0, "b": 0, "c": 0, "d": 0, "moviedb": 1771.5, "trakt": 2178, "stremio": 59.0498, "stremio_lib": 0]],
            ["id": "tt0168366", "name": "Pokémon", "popularity": 6.45, "popularities": ["trakt": 5]],
            ["id": "tt0176385", "name": "#DUPE#", "popularity": 6.45, "popularities": ["trakt": 50]],
        ]
        XCTAssertEqual(TVMArtTrust.crossLinked(metas), ["tt0118933"])
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".json")
        TVMArtTrust.attach(file)
        var told: [Set<String>] = []
        TVMArtTrust.onDistrusted = { told.append($0) }
        TVMArtTrust.distrust(["tt0118933"])
        TVMArtTrust.distrust(["tt0118933"])
        XCTAssertEqual(told, [["tt0118933"]])
        XCTAssertFalse(TVMArtTrust.trusted("https://images.metahub.space/poster/large/tt0118933/img"))
        XCTAssertFalse(TVMArtTrust.trusted("https://episodes.metahub.space/tt0118933/28/6/w780.jpg"))
        XCTAssertTrue(TVMArtTrust.trusted("https://images.metahub.space/poster/large/tt0203259/img"))
        // A new launch reads it back before any picture is asked for.
        TVMArtTrust.clear()
        TVMArtTrust.attach(file)
        XCTAssertTrue(TVMArtTrust.isDistrusted("tt0118933"))
    }

    func testPicturesAreRetriedKeptAndRefusedWhenNotTheirs() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        var asked: [String] = []
        let images = TVMImages(directory: dir, fetch: { url in
            asked.append(url.absoluteString)
            if url.absoluteString.contains("busy") { return asked.filter { $0.contains("busy") }.count < 3 ? (429, nil, nil) : (200, "image/jpeg", Data([1, 2])) }
            if url.absoluteString.contains("/large/") { return (404, nil, nil) }
            return (200, "image/jpeg", Data([9]))
        }, sleep: { _ in })
        // A refused burst is tried again.
        let busy = await images.load(URL(string: "https://image.tmdb.org/t/p/w342/busy.jpg")!)
        XCTAssertEqual(busy.status, 200)
        // A missing large poster falls back to metahub's medium size, and is kept.
        let poster = await images.load(URL(string: "https://images.metahub.space/poster/large/tt0108778/img")!)
        XCTAssertEqual(poster.status, 200)
        XCTAssertTrue(asked.contains("https://images.metahub.space/poster/medium/tt0108778/img"))
        let before = asked.count
        _ = await images.load(URL(string: "https://images.metahub.space/poster/large/tt0108778/img")!)
        XCTAssertEqual(asked.count, before, "kept on the phone")
        // Another title's artwork is refused, even from the phone's copy.
        TVMArtTrust.distrust(["tt0108778"])
        let refused = await images.load(URL(string: "https://images.metahub.space/poster/large/tt0108778/img")!)
        XCTAssertEqual(refused.status, 404)
    }

    // MARK: Downloads

    func testDownloadLanguageIsAMust() {
        XCTAssertTrue(TVMLanguage.ok("Show.S01E01.1080p.WEB.x264", language: "en"))
        XCTAssertFalse(TVMLanguage.ok("Show.S01E01.1080p.WEB.x264", language: "fr"))
        XCTAssertTrue(TVMLanguage.ok("Show.S01E01.FRENCH.1080p 🇫🇷", language: "fr"))
        XCTAssertFalse(TVMLanguage.ok("Show.S01E01.MULTi.1080p", language: "en"))
        XCTAssertTrue(TVMLanguage.ok("Show ITA ENG 1080p", language: "original"))
    }

    func testADroppedDownloadResumesAndLandsWholeOnThePhone() async throws {
        DroppingServer.reset()
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DroppingServer.self]
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let store = TVMStore(root: root.appendingPathComponent("store", isDirectory: true))
        let folder = root.appendingPathComponent("Downloads", isDirectory: true)
        let downloads = TVMDownloads(store: store, folder: folder, configuration: config) { _, _, _ in
            .success(("https://files.example/episode.mkv", "South.Park.S01E05.1080p.mkv"))
        }
        downloads.retryDelay = { _ in 10_000_000 }
        _ = try downloads.enqueue([("tt0121955:1:5", "South Park - S01E05")], language: "en", maxHeight: 1080)
        var state = ""
        for _ in 0..<300 {
            let job = (downloads.list()["jobs"] as? [[String: Any]])?.first
            state = job?["state"] as? String ?? ""
            if state == "complete" || state == "failed" { break }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
        XCTAssertEqual(state, "complete")
        XCTAssertEqual(DroppingServer.ranges, [nil, "bytes=\(DroppingServer.cut)-"], "one drop, one resume from where it stopped")
        let saved = try Data(contentsOf: folder.appendingPathComponent("South Park - S01E05 [en].mkv"))
        XCTAssertEqual(saved, DroppingServer.body)
        XCTAssertNotNil(downloads.offlineCopy("tt0121955:1:5"))
    }
}

/// Serves a file over a stub network: the first answer stops after part of it, a Range request gets the rest.
final class DroppingServer: URLProtocol {
    static let body = Data((0..<300_000).map { UInt8($0 % 251) })
    static let cut = 100_000
    static var ranges: [String?] = []
    static func reset() { ranges = [] }

    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "files.example" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let range = request.value(forHTTPHeaderField: "Range")
        Self.ranges.append(range)
        let from = range.flatMap { Int($0.dropFirst("bytes=".count).split(separator: "-").first ?? "") } ?? 0
        let rest = Self.body.count - from
        var headers = ["Content-Length": String(rest), "Content-Type": "video/x-matroska"]
        if from > 0 { headers["Content-Range"] = "bytes \(from)-\(Self.body.count - 1)/\(Self.body.count)" }
        let response = HTTPURLResponse(url: request.url!, statusCode: from > 0 ? 206 : 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if from == 0 {
            client?.urlProtocol(self, didLoad: Self.body.prefix(Self.cut))
            // The connection drops after part of the file has arrived.
            DispatchQueue.global().asyncAfter(deadline: .now() + 0.2) { [self] in
                client?.urlProtocol(self, didFailWithError: URLError(.networkConnectionLost))
            }
        } else {
            client?.urlProtocol(self, didLoad: Self.body.suffix(from: from))
            client?.urlProtocolDidFinishLoading(self)
        }
    }
    override func stopLoading() {}
}
