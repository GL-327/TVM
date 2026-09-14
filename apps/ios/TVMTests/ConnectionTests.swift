import XCTest
@testable import TVM

final class ConnectionTests: XCTestCase {
    private let token = String(repeating: "a", count: 32)

    func testAcceptsExplicitPrivateLANAndHTTPS() throws {
        for address in ["http://10.0.0.1:7345", "http://172.16.0.1", "http://172.31.255.254", "http://192.168.1.2/"] {
            XCTAssertNoThrow(try Connection.validated(address: address, token: token, allowLocalHTTP: true))
        }
        XCTAssertNoThrow(try Connection.validated(address: "https://tvm.example", token: token, allowLocalHTTP: false))
    }

    func testRejectsPublicOrAmbiguousHTTPAndCredentialURLs() {
        for address in ["http://8.8.8.8", "http://127.0.0.1", "http://172.15.0.1", "http://172.32.0.1",
                        "http://192.168.1.256", "http://192.168.01.1", "http://192.168.1.1.evil.example",
                        "http://localhost", "file:///tmp/index.html", "https://user:pass@tvm.example",
                        "http://192.168.1.2/?token=secret", "http://192.168.1.2/api", "http://192.168.1.2/#x"] {
            XCTAssertThrowsError(try Connection.validated(address: address, token: token, allowLocalHTTP: true), address)
        }
        XCTAssertThrowsError(try Connection.validated(address: "http://192.168.1.2", token: token, allowLocalHTTP: false))
    }

    func testRejectsInvalidToken() {
        for value in ["", "short", token + "\r\nX-Test: value", token + " space"] {
            XCTAssertThrowsError(try Connection.validated(address: "https://tvm.example", token: value, allowLocalHTTP: false))
        }
    }

    func testOriginScopingIncludesPortAndScheme() throws {
        let connection = try Connection.validated(address: "https://tvm.example", token: token, allowLocalHTTP: false)
        XCTAssertTrue(connection.isSameOrigin(URL(string: "https://tvm.example:443/api/home")!))
        XCTAssertFalse(connection.isSameOrigin(URL(string: "https://tvm.example:7345/")!))
        XCTAssertFalse(connection.isSameOrigin(URL(string: "http://tvm.example/")!))
        XCTAssertFalse(connection.isSameOrigin(URL(string: "https://tvm.example.evil.example/")!))
        XCTAssertFalse(connection.isSameOrigin(URL(string: "https://user@tvm.example/")!))
        XCTAssertEqual(connection.sessionURL.absoluteString, "https://tvm.example/api/lan/session")
    }
}
