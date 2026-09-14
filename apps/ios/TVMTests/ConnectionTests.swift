import UIKit
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

    /// Device-idiom keys (`~ipad`) are stripped by `object(forInfoDictionaryKey:)`.
    /// Read the shipped plist so iPhone XCTest still sees the iPad array.
    private func bundledInfoPlist() throws -> [String: Any] {
        let url = Bundle(for: TVMLocalCore.self).bundleURL.appendingPathComponent("Info.plist")
        let data = try Data(contentsOf: url)
        let object = try PropertyListSerialization.propertyList(from: data, format: nil)
        return try XCTUnwrap(object as? [String: Any], "Info.plist did not deserialize as a dictionary")
    }

    func testIPhoneOrientationsIncludePortraitAndLandscape() throws {
        let orientations = try bundledInfoPlist()["UISupportedInterfaceOrientations"] as? [String] ?? []
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationPortrait"), "got \(orientations)")
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationLandscapeLeft"), "got \(orientations)")
        XCTAssertTrue(orientations.contains("UIInterfaceOrientationLandscapeRight"), "got \(orientations)")
        XCTAssertFalse(orientations.isEmpty)
    }

    func testIPadOrientationsIncludeAllFour() throws {
        let orientations = try bundledInfoPlist()["UISupportedInterfaceOrientations~ipad"] as? [String] ?? []
        for name in [
            "UIInterfaceOrientationPortrait",
            "UIInterfaceOrientationPortraitUpsideDown",
            "UIInterfaceOrientationLandscapeLeft",
            "UIInterfaceOrientationLandscapeRight",
        ] {
            XCTAssertTrue(orientations.contains(name), "iPad missing \(name) in \(orientations)")
        }
    }

    func testKeyboardInsetResetsWhenHiddenAndDoesNotShrinkTheChrome() {
        let window = CGSize(width: 390, height: 844)
        XCTAssertEqual(TVMViewport.webViewSize(in: window), window)
        let leftover = TVMViewport.fittedSize(in: CGSize(width: 390, height: 20))
        XCTAssertLessThan(leftover.height, 30, "16:9-fitting a keyboard leftover is the 20px-strip bug")
        XCTAssertGreaterThan(TVMViewport.webViewSize(in: window).height, leftover.height)

        let view = CGRect(x: 0, y: 0, width: 390, height: 844)
        let keyboard = CGRect(x: 0, y: 508, width: 390, height: 336)
        XCTAssertEqual(TVMKeyboardLayout.overlapHeight(keyboardFrame: keyboard, viewBounds: view), 336)
        XCTAssertEqual(TVMKeyboardLayout.cssInset(overlap: 336, keyboardVisible: true), 336)
        XCTAssertEqual(TVMKeyboardLayout.cssInset(overlap: 336, keyboardVisible: false), 0)
        XCTAssertEqual(TVMKeyboardLayout.cssInset(overlap: 0, keyboardVisible: true), 0)
        XCTAssertEqual(TVMKeyboardLayout.webViewContentInset, .zero)
    }
}
