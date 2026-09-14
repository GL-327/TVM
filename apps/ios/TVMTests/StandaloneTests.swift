import XCTest
@testable import TVM

final class StandaloneTests: XCTestCase {
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
        let core = TVMLocalCore(session: session)
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
        XCTAssertEqual(payload["engine"] as? String, "html5")
        XCTAssertTrue(TVMPlayback.phoneCanPlay(
            filename: payload["filename"] as? String ?? "",
            mimeType: payload["mimeType"] as? String,
            url: payload["url"] as? String ?? ""
        ))
    }

    func testCatalogSlugMapsToImdb() {
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
        let core = TVMLocalCore(session: session)
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
        let core = TVMLocalCore(session: session)
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
