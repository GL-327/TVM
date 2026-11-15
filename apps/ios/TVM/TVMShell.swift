import SwiftUI
import WebKit

/// The phone look, shared with Android.
///
/// Android's modern design (the screens, the floating tab pill, the You
/// popup, "Who's watching?", Search, Details, the season menus, the keyboard
/// handling and the page crossfade) is one overlay over the shared interface:
/// `apps/android/app/src/main/assets/android-shell/tvm-android.{js,css}`.
/// iOS runs the very same files (copied into the app by bundle-ui.mjs), plus
/// a small iOS layer (`apps/ios/shell/tvm-ios.{js,css}`). They ship inside
/// the app, not in the interface feed, so a newer interface keeps them.
enum TVMShellScripts {
    /// CI's simulator tour signs in with a test account (debug builds only).
    static var tourToken: String?

    static func file(_ name: String, _ ext: String) -> String {
        guard let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "BundledUI/shell"),
              let text = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return text
    }

    /// The boot script: the overlay's styles after the interface's own, then
    /// its script, then the iOS layer. Same order as Android's boot script.
    static func overlay(glassBar: Bool) -> String {
        let css = file("tvm-android", "css") + "\n" + file("tvm-ios", "css")
        let js = file("tvm-android", "js")
        let ios = file("tvm-ios", "js")
        guard !js.isEmpty else { return "" }
        return compose(css: css, overlay: js, ios: ios, glassBar: glassBar)
    }

    static func compose(css: String, overlay: String, ios: String, glassBar: Bool) -> String {
        let style = jsString(css)
        return """
        (function () {
          var root = document.documentElement;
          root.classList.add('tvm-android');
          root.classList.add('tvm-ios');
          // The app's own constructed-logo reveal (TVMIntro) replaces the web intro, as on Android.
          try {
            sessionStorage.setItem('tvm.intro.session', '1');
            sessionStorage.setItem('tvm.intro.at', String(Date.now()));
          } catch (e) {}
          if (window.__tvmAndroidShell) return;
          window.__tvmAndroidShell = true;
          window.__tvmIosGlassBar = \(glassBar ? "true" : "false");
          var css = \(style);
          function place() {
            var el = document.getElementById('tvm-android-shell');
            if (!el) {
              el = document.createElement('style');
              el.id = 'tvm-android-shell';
              el.textContent = css;
            }
            var head = document.head || root;
            if (head.lastElementChild !== el) head.appendChild(el);
          }
          place();
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', place);
          window.addEventListener('load', place);
          try {
        \(overlay.replacingOccurrences(of: "</script", with: "<\\/script"))
          } catch (e) { if (window.console) console.warn('tvm-android', e); }
          try {
        \(ios.replacingOccurrences(of: "</script", with: "<\\/script"))
          } catch (e) { if (window.console) console.warn('tvm-ios', e); }
        })();
        """
    }

    /// A JavaScript string literal that cannot end the surrounding script.
    static func jsString(_ text: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [text]),
              var json = String(data: data, encoding: .utf8) else { return "\"\"" }
        json.removeFirst(); json.removeLast()
        return json.replacingOccurrences(of: "</", with: "<\\/")
    }

    /// The keyboard has one owner: the page is not resized or scrolled for it
    /// (it slides over the page). The page is told its height once, in one
    /// script, so nothing reacts to it in separate frames (tvm-android.js 6b).
    static func keyboard(height: Int) -> String {
        let open = height > 0
        return "(function(){var r=document.documentElement;r.classList.toggle('tvm-ime-open',\(open));" +
            "window.__tvmKeyboardInset&&window.__tvmKeyboardInset(0);" +
            "window.__tvmaKeyboard&&window.__tvmaKeyboard(\(open ? height : 0));})();"
    }
}

/// What the app's own tab bar shows, as the page reports it (tvm-ios.js 4).
struct TVMBarState: Equatable {
    struct Row: Equatable, Identifiable { let id: String; let title: String; let detail: String; let on: Bool }
    var visible = false
    var active = ""
    var youName = ""
    var youHue: Double = 215
    var youPicture: UIImage?
    var youPictureKey = ""
    var popup: [Row] = []
    var entrance = false

    static func == (a: TVMBarState, b: TVMBarState) -> Bool {
        a.visible == b.visible && a.active == b.active && a.youName == b.youName && a.youHue == b.youHue &&
            a.youPictureKey == b.youPictureKey && a.popup == b.popup && a.entrance == b.entrance
    }

    mutating func read(_ raw: [String: Any]) {
        visible = raw["visible"] as? Bool ?? false
        active = raw["active"] as? String ?? ""
        entrance = raw["entrance"] as? Bool ?? false
        if let you = raw["you"] as? [String: Any] {
            youName = you["name"] as? String ?? ""
            youHue = (you["hue"] as? Double) ?? Double(you["hue"] as? Int ?? 215)
            let picture = you["picture"] as? String ?? ""
            let key = "\(picture.count):\(picture.suffix(32))"
            if key != youPictureKey {
                youPictureKey = key
                youPicture = TVMBarState.image(fromDataURL: picture)
            }
        }
        popup = (raw["popup"] as? [[String: Any]] ?? []).compactMap { row in
            guard let id = row["id"] as? String else { return nil }
            return Row(id: id, title: row["title"] as? String ?? "", detail: row["detail"] as? String ?? "", on: row["on"] as? Bool ?? false)
        }
    }

    static func image(fromDataURL text: String) -> UIImage? {
        guard text.hasPrefix("data:"), let comma = text.firstIndex(of: ",") else { return nil }
        let meta = text[..<comma]
        let body = String(text[text.index(after: comma)...])
        guard meta.contains(";base64"), let data = Data(base64Encoded: body) else { return nil }
        return UIImage(data: data)
    }
}

/// The bridge between the page and the app's bar, popup and crossfade.
/// Used on the main thread only (WebKit's callbacks and SwiftUI).
final class TVMShellModel: ObservableObject {
    @Published var bar = TVMBarState()
    @Published var playing = false
    /// Played once per session start, as on Android (tvm-android.js 17d).
    @Published var entranceToken = 0
    weak var webView: WKWebView?
    private var cover: UIView?

    func update(bar raw: [String: Any]) {
        var next = bar
        next.read(raw)
        if next.entrance && !bar.entrance { entranceToken += 1 }
        if next != bar { bar = next }
    }

    func tap(_ id: String) {
        webView?.evaluateJavaScript("window.__tvmIosBarTap && window.__tvmIosBarTap(\(TVMShellScripts.jsString(id)));")
    }

    func choose(row id: String) {
        webView?.evaluateJavaScript("window.__tvmIosPopupRow && window.__tvmIosPopupRow(\(TVMShellScripts.jsString(id)));")
    }

    func dismissPopup() {
        webView?.evaluateJavaScript("window.__tvmIosPopupDismiss && window.__tvmIosPopupDismiss();")
    }

    /// iOS 16 and 17 have no view transitions: a still picture of the page is
    /// laid over it while it changes underneath (tvm-ios.js 1).
    func snapshot() {
        guard let webView, let host = webView.superview else { return }
        cover?.removeFromSuperview()
        guard let picture = webView.snapshotView(afterScreenUpdates: false) else { return }
        picture.frame = webView.frame
        picture.isUserInteractionEnabled = false
        host.insertSubview(picture, aboveSubview: webView)
        cover = picture
    }

    /// The same fade as the page crossfade: 210 ms, CSS `ease`.
    func fade(milliseconds: Double) {
        guard let picture = cover else { return }
        cover = nil
        guard milliseconds > 0, !UIAccessibility.isReduceMotionEnabled else { picture.removeFromSuperview(); return }
        let fade = UIViewPropertyAnimator(duration: milliseconds / 1000, controlPoint1: CGPoint(x: 0.25, y: 0.1), controlPoint2: CGPoint(x: 0.25, y: 1)) {
            picture.alpha = 0
        }
        fade.addCompletion { _ in picture.removeFromSuperview() }
        fade.startAnimation()
    }
}

/// Which way the screen may turn. The film plays sideways (as on Android,
/// TvmCinemaMode); everything else turns freely.
enum TVMOrientation {
    static var mask: UIInterfaceOrientationMask = .allButUpsideDown

    static func lock(_ orientations: UIInterfaceOrientationMask) {
        mask = orientations
        apply(orientations)
    }

    /// Back to turning freely; a phone returns upright from the film.
    static func unlock() {
        let pad = UIDevice.current.userInterfaceIdiom == .pad
        mask = pad ? .all : .allButUpsideDown
        apply(pad ? .all : .portrait)
    }

    private static func apply(_ orientations: UIInterfaceOrientationMask) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        scene.windows.first?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: orientations)) { _ in }
    }
}

final class TVMAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        TVMOrientation.mask
    }
}
