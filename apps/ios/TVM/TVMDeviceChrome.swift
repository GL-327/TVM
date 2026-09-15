import Darwin
import UIKit
import WebKit

enum TVMDeviceFamily: String {
    case homeButton = "home-button"
    case notch = "notch"
    case island = "island"
    case ipad = "ipad"
    case unknown = "unknown"
}

struct TVMDeviceProfile: Equatable {
    var identifier: String
    var marketingName: String
    var family: TVMDeviceFamily
    var maxHeight: Int
    var fallbackTop: CGFloat
    var fallbackBottom: CGFloat
    var extraTop: CGFloat
    var extraBottom: CGFloat
    var extraX: CGFloat
}

/// Maps utsname machine ids to chrome + a quality cap. Newer island/Pro
/// phones may fetch 4K; home-button bezels stay at 1080/720.
enum TVMDeviceChrome {
    static var current: TVMDeviceProfile { profile(identifier: machineIdentifier(), idiom: UIDevice.current.userInterfaceIdiom) }

    static func machineIdentifier() -> String {
        if let sim = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"], !sim.isEmpty {
            return sim
        }
        var info = utsname()
        uname(&info)
        return withUnsafeBytes(of: info.machine) { raw in
            let bytes = raw.bindMemory(to: CChar.self)
            return String(cString: bytes.baseAddress!)
        }
    }

    static func profile(identifier: String, idiom: UIUserInterfaceIdiom) -> TVMDeviceProfile {
        if idiom == .pad || identifier.hasPrefix("iPad") {
            return TVMDeviceProfile(identifier: identifier, marketingName: "iPad", family: .ipad, maxHeight: 2160, fallbackTop: 24, fallbackBottom: 20, extraTop: 4, extraBottom: 0, extraX: 0)
        }
        if let known = knownPhones[identifier] { return withIdentifier(known, identifier) }
        return heuristic(identifier)
    }

    static func playbackHeight(planMax: Int) -> Int {
        min(planMax, current.maxHeight)
    }

    static func publish(to webView: WKWebView, insets: UIEdgeInsets) {
        let profile = current
        let top = insets.top > 0.5 ? insets.top : profile.fallbackTop
        let bottom = insets.bottom > 0.5 ? insets.bottom : profile.fallbackBottom
        let payload: [String: Any] = [
            "identifier": profile.identifier,
            "model": profile.marketingName,
            "family": profile.family.rawValue,
            "maxHeight": profile.maxHeight,
            "insetTop": Double(top),
            "insetRight": Double(insets.right),
            "insetBottom": Double(bottom),
            "insetLeft": Double(insets.left),
            "extraTop": Double(profile.extraTop),
            "extraBottom": Double(profile.extraBottom),
            "extraX": Double(profile.extraX),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__tvmDevice=\(json);window.__tvmApplyDevice&&window.__tvmApplyDevice();")
    }

    static func bootScript() -> String {
        let profile = current
        let payload: [String: Any] = [
            "identifier": profile.identifier,
            "model": profile.marketingName,
            "family": profile.family.rawValue,
            "maxHeight": profile.maxHeight,
            "insetTop": Double(profile.fallbackTop),
            "insetRight": 0,
            "insetBottom": Double(profile.fallbackBottom),
            "insetLeft": 0,
            "extraTop": Double(profile.extraTop),
            "extraBottom": Double(profile.extraBottom),
            "extraX": Double(profile.extraX),
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return "" }
        return "window.__tvmDevice=\(json);"
    }

    private static func withIdentifier(_ profile: TVMDeviceProfile, _ identifier: String) -> TVMDeviceProfile {
        var next = profile
        next.identifier = identifier
        return next
    }

    private static func heuristic(_ identifier: String) -> TVMDeviceProfile {
        let major = phoneMajor(identifier)
        if homeButtonIds.contains(identifier) || (major > 0 && major < 10) {
            return phone(identifier, "iPhone", .homeButton, 1080, 20, 0, 0, 6, 8)
        }
        if major >= 15 || identifier.hasPrefix("iPhone15,") || identifier.hasPrefix("iPhone16,") || identifier.hasPrefix("iPhone17,") || identifier.hasPrefix("iPhone18,") {
            return phone(identifier, "iPhone", .island, 2160, 59, 34, 10, 0, 0)
        }
        if major >= 10 {
            return phone(identifier, "iPhone", .notch, 1080, 47, 34, 6, 0, 0)
        }
        return phone(identifier, "iPhone", .unknown, 1080, 20, 0, 0, 0, 0)
    }

    private static func phone(_ id: String, _ name: String, _ family: TVMDeviceFamily, _ height: Int, _ top: CGFloat, _ bottom: CGFloat, _ extraTop: CGFloat, _ extraBottom: CGFloat, _ extraX: CGFloat) -> TVMDeviceProfile {
        TVMDeviceProfile(identifier: id, marketingName: name, family: family, maxHeight: height, fallbackTop: top, fallbackBottom: bottom, extraTop: extraTop, extraBottom: extraBottom, extraX: extraX)
    }

    private static func phoneMajor(_ identifier: String) -> Int {
        guard identifier.hasPrefix("iPhone") else { return 0 }
        let rest = identifier.dropFirst("iPhone".count)
        let major = rest.split(separator: ",").first.flatMap { Int($0) } ?? 0
        return major
    }

    private static let homeButtonIds: Set<String> = [
        "iPhone8,1", "iPhone8,2", "iPhone8,4",
        "iPhone9,1", "iPhone9,2", "iPhone9,3", "iPhone9,4",
        "iPhone10,1", "iPhone10,2", "iPhone10,4", "iPhone10,5",
        "iPhone12,8", "iPhone14,6",
    ]

    /// Explicit map so 13 Pro vs SE 3 (both iPhone14,*) and 14 vs 14 Pro (iPhone14 vs 15) stay correct.
    private static let knownPhones: [String: TVMDeviceProfile] = {
        var map: [String: TVMDeviceProfile] = [:]
        func put(_ ids: [String], _ name: String, _ family: TVMDeviceFamily, _ height: Int, _ top: CGFloat, _ bottom: CGFloat, _ extraTop: CGFloat, _ extraBottom: CGFloat, _ extraX: CGFloat) {
            for id in ids {
                map[id] = TVMDeviceProfile(identifier: id, marketingName: name, family: family, maxHeight: height, fallbackTop: top, fallbackBottom: bottom, extraTop: extraTop, extraBottom: extraBottom, extraX: extraX)
            }
        }
        put(["iPhone10,1", "iPhone10,4"], "iPhone 8", .homeButton, 1080, 20, 0, 0, 6, 8)
        put(["iPhone10,2", "iPhone10,5"], "iPhone 8 Plus", .homeButton, 1080, 20, 0, 0, 6, 8)
        put(["iPhone12,8"], "iPhone SE (2nd generation)", .homeButton, 1080, 20, 0, 0, 6, 8)
        put(["iPhone14,6"], "iPhone SE (3rd generation)", .homeButton, 1080, 20, 0, 0, 6, 8)
        put(["iPhone10,3", "iPhone10,6"], "iPhone X", .notch, 1080, 44, 34, 6, 0, 0)
        put(["iPhone11,8"], "iPhone XR", .notch, 1080, 48, 34, 6, 0, 0)
        put(["iPhone11,2"], "iPhone XS", .notch, 1080, 44, 34, 6, 0, 0)
        put(["iPhone11,4", "iPhone11,6"], "iPhone XS Max", .notch, 1080, 44, 34, 6, 0, 0)
        put(["iPhone12,1"], "iPhone 11", .notch, 1080, 48, 34, 6, 0, 0)
        put(["iPhone12,3"], "iPhone 11 Pro", .notch, 2160, 44, 34, 6, 0, 0)
        put(["iPhone12,5"], "iPhone 11 Pro Max", .notch, 2160, 44, 34, 6, 0, 0)
        put(["iPhone13,1"], "iPhone 12 mini", .notch, 1080, 50, 34, 6, 0, 0)
        put(["iPhone13,2"], "iPhone 12", .notch, 1080, 47, 34, 6, 0, 0)
        put(["iPhone13,3"], "iPhone 12 Pro", .notch, 2160, 47, 34, 6, 0, 0)
        put(["iPhone13,4"], "iPhone 12 Pro Max", .notch, 2160, 47, 34, 6, 0, 0)
        put(["iPhone14,4"], "iPhone 13 mini", .notch, 1080, 50, 34, 6, 0, 0)
        put(["iPhone14,5"], "iPhone 13", .notch, 1080, 47, 34, 6, 0, 0)
        put(["iPhone14,2"], "iPhone 13 Pro", .notch, 2160, 47, 34, 6, 0, 0)
        put(["iPhone14,3"], "iPhone 13 Pro Max", .notch, 2160, 47, 34, 6, 0, 0)
        put(["iPhone14,7"], "iPhone 14", .notch, 1080, 47, 34, 6, 0, 0)
        put(["iPhone14,8"], "iPhone 14 Plus", .notch, 1080, 47, 34, 6, 0, 0)
        put(["iPhone15,2"], "iPhone 14 Pro", .island, 2160, 59, 34, 10, 0, 0)
        put(["iPhone15,3"], "iPhone 14 Pro Max", .island, 2160, 59, 34, 10, 0, 0)
        put(["iPhone15,4"], "iPhone 15", .island, 2160, 59, 34, 10, 0, 0)
        put(["iPhone15,5"], "iPhone 15 Plus", .island, 2160, 59, 34, 10, 0, 0)
        put(["iPhone16,1"], "iPhone 15 Pro", .island, 2160, 59, 34, 10, 0, 0)
        put(["iPhone16,2"], "iPhone 15 Pro Max", .island, 2160, 59, 34, 10, 0, 0)
        put(["iPhone17,3"], "iPhone 16", .island, 2160, 59, 34, 10, 0, 0)
        put(["iPhone17,4"], "iPhone 16 Plus", .island, 2160, 59, 34, 10, 0, 0)
        put(["iPhone17,1"], "iPhone 16 Pro", .island, 2160, 62, 34, 10, 0, 0)
        put(["iPhone17,2"], "iPhone 16 Pro Max", .island, 2160, 62, 34, 10, 0, 0)
        put(["iPhone17,5"], "iPhone 16e", .notch, 1080, 47, 34, 6, 0, 0)
        return map
    }()
}
