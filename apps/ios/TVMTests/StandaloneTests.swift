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

    func testOptionalLANStillValidatesWhenUsed() {
        let token = String(repeating: "a", count: 32)
        XCTAssertNoThrow(try Connection.validated(address: "http://192.168.1.2:7345", token: token, allowLocalHTTP: true))
        XCTAssertThrowsError(try Connection.validated(address: "http://192.168.1.2", token: token, allowLocalHTTP: false))
    }
}
