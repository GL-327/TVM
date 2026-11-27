import SwiftUI
import WebKit

extension Notification.Name {
    static let tvmWillEnterForeground = Notification.Name("tvm.willEnterForeground")
}

/// Keyboard overlap published into the page. WKWebView often reports a late
/// or missing visualViewport resize; keyboard-frame notifications fill in.
enum TVMKeyboardLayout {
    static let openThreshold: CGFloat = 80

    /// CSS / JS inset. Always 0 when the keyboard is hidden so the page resets.
    static func cssInset(overlap: CGFloat, keyboardVisible: Bool) -> Int {
        guard keyboardVisible else { return 0 }
        return Int(max(0, overlap.rounded()))
    }

    static func overlapHeight(keyboardFrame: CGRect, viewBounds: CGRect) -> CGFloat {
        max(0, keyboardFrame.intersection(viewBounds).height)
    }

    /// UIKit must not inset or resize the web view for the keyboard.
    static let webViewContentInset = UIEdgeInsets.zero
}

/// Shared with `apps/ui/src/nav/phoneViewport.ts`.
private enum PhoneViewportScript {
    static let source = """
    (function () {
      function ensureViewport() {
        var meta = document.querySelector('meta[name="viewport"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'viewport');
          (document.head || document.documentElement).appendChild(meta);
        }
        meta.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
      }
      function occlusion() {
        var vv = window.visualViewport;
        if (!vv) return 0;
        return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      }
      function lift() {
        var el = document.activeElement;
        if (!el) return;
        var editable = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' || el.getAttribute('contenteditable') === 'true';
        if (!editable) return;
        var vv = window.visualViewport;
        var visibleBottom = vv ? (vv.offsetTop + vv.height) : window.innerHeight;
        var box = el.getBoundingClientRect();
        var extra = Math.max(0, box.bottom - visibleBottom + 20);
        if (extra === 0) {
          try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
          return;
        }
        var node = el.parentElement;
        while (node && node !== document.body && node !== document.documentElement) {
          var style = window.getComputedStyle(node);
          var oy = style.overflowY;
          if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && node.scrollHeight > node.clientHeight) {
            node.scrollTop += extra;
            return;
          }
          node = node.parentElement;
        }
        try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
      }
      function orient() {
        var portrait = window.innerHeight >= window.innerWidth;
        var root = document.documentElement;
        root.dataset.orientation = portrait ? 'portrait' : 'landscape';
        root.classList.toggle('tvm-portrait', portrait);
        root.classList.toggle('tvm-landscape', !portrait);
      }
      function apply(inset) {
        var root = document.documentElement;
        var value = typeof inset === 'number' ? inset : occlusion();
        if (value < 0) value = 0;
        root.style.setProperty('--tvm-keyboard', value + 'px');
        root.style.setProperty('--tvm-keyboard-inset', value + 'px');
        root.classList.add('phone-shell');
        root.classList.toggle('keyboard-open', value >= 80);
        orient();
        if (value >= 80) lift();
      }
      window.__tvmKeyboardInset = apply;
      ensureViewport();
      document.documentElement.classList.add('phone-shell');
      function start() {
        ensureViewport();
        apply();
        if (window.visualViewport) {
          window.visualViewport.addEventListener('resize', function () { apply(); });
          window.visualViewport.addEventListener('scroll', function () { apply(); });
        }
        window.addEventListener('orientationchange', function () { apply(); });
        window.addEventListener('resize', function () { apply(); });
        document.addEventListener('focusin', function (event) {
          var t = event.target;
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' ||
              t.getAttribute('contenteditable') === 'true')) {
            window.setTimeout(function () { apply(); }, 50);
          }
        });
        document.addEventListener('focusout', function () {
          window.setTimeout(function () {
            if (!document.activeElement ||
                (document.activeElement.tagName !== 'INPUT' &&
                 document.activeElement.tagName !== 'TEXTAREA' &&
                 document.activeElement.tagName !== 'SELECT')) {
              apply(0);
            }
          }, 80);
        });
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
    })();
    """
}

/// Hosts WKWebView edge-to-edge. Never pin to `keyboardLayoutGuide` — that
/// compresses the page into a strip above the keyboard.
final class TVMWebHostController: UIViewController {
    let webView: WKWebView
    /// The film's picture (TVMVideoEngine), under the transparent page while it plays.
    let videoContainer = UIView()
    /// Pass-through glass overlays (stats panel, tap target, sleep timer) above the video.
    let videoOverlayContainer = TVMPassThroughOverlayView()
    private var offsetWatch: NSKeyValueObservation?

    init(webView: WKWebView) {
        self.webView = webView
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        view.insetsLayoutMarginsFromSafeArea = false
        additionalSafeAreaInsets = TVMKeyboardLayout.webViewContentInset
        edgesForExtendedLayout = .all
        extendedLayoutIncludesOpaqueBars = true
        videoContainer.backgroundColor = .black
        videoContainer.isHidden = true
        videoContainer.isUserInteractionEnabled = false
        videoOverlayContainer.backgroundColor = .clear
        videoOverlayContainer.isHidden = true
        for child in [videoContainer, webView, videoOverlayContainer] {
            child.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child)
            NSLayoutConstraint.activate([
                child.topAnchor.constraint(equalTo: view.topAnchor),
                child.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                child.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                child.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            ])
        }
        // The document never scrolls: WebKit's reflex is to scroll it so a
        // focused field clears the keyboard, which moved whole pages and put
        // headers under the status bar. The page lifts a field itself when
        // the keyboard would cover it (tvm-android.js 6b).
        offsetWatch = webView.scrollView.observe(\.contentOffset, options: [.new]) { scroll, _ in
            if scroll.contentOffset != .zero { scroll.contentOffset = .zero }
        }
    }

    /// Shows the engine's picture under the page, and attaches its glass overlay over the video.
    func showVideo(_ engine: TVMVideoEngine) {
        videoContainer.subviews.forEach { $0.removeFromSuperview() }
        engine.view.frame = videoContainer.bounds
        engine.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        videoContainer.addSubview(engine.view)
        videoContainer.isHidden = false
        videoOverlayContainer.subviews.forEach { $0.removeFromSuperview() }
        engine.overlayView.translatesAutoresizingMaskIntoConstraints = false
        videoOverlayContainer.addSubview(engine.overlayView)
        NSLayoutConstraint.activate([
            engine.overlayView.topAnchor.constraint(equalTo: videoOverlayContainer.topAnchor),
            engine.overlayView.leadingAnchor.constraint(equalTo: videoOverlayContainer.leadingAnchor),
            engine.overlayView.trailingAnchor.constraint(equalTo: videoOverlayContainer.trailingAnchor),
            engine.overlayView.bottomAnchor.constraint(equalTo: videoOverlayContainer.bottomAnchor),
        ])
        videoOverlayContainer.isHidden = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
    }

    func hideVideo() {
        videoContainer.subviews.forEach { $0.removeFromSuperview() }
        videoContainer.isHidden = true
        videoOverlayContainer.subviews.forEach { $0.removeFromSuperview() }
        videoOverlayContainer.isHidden = true
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        TVMDeviceChrome.publish(to: webView, insets: webView.safeAreaInsets)
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        additionalSafeAreaInsets = .zero
        TVMDeviceChrome.publish(to: webView, insets: webView.safeAreaInsets)
    }
}

struct TVMWebView: UIViewControllerRepresentable {
    let session: BrowseSession
    @Binding var loading: Bool
    @Binding var error: String?
    var shell: TVMShellModel
    /// The shell's own actions (tvm-app: reload, a home Core).
    var onAppAction: (String) -> Void = { _ in }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIViewController(context: Context) -> TVMWebHostController {
        let configuration = WKWebViewConfiguration()
        configuration.applicationNameForUserAgent = "TVM-iOS"
        configuration.websiteDataStore = session.isStandalone ? .default() : .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let viewport = WKUserScript(
            source: PhoneViewportScript.source,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        let device = WKUserScript(
            source: TVMDeviceChrome.bootScript(),
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        let language = TVMPrefs.load(TVMStore()).language
        let lang = WKUserScript(
            source: "document.documentElement.lang='\(language)';document.documentElement.dataset.lang='\(language)';",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        configuration.ignoresViewportScaleLimits = false
        configuration.userContentController.addUserScript(viewport)
        configuration.userContentController.addUserScript(device)
        configuration.userContentController.addUserScript(lang)
        // The page keeps its sign-in in localStorage, which belongs to the
        // on-device server's address. If that address changes between launches
        // the page starts empty and looks signed out, so hand it the session
        // the Keychain still holds. Signing out clears both.
        if session.isStandalone, TVMShellScripts.tourToken == nil, let held = TVMKeychainSessionVault().read() {
            configuration.userContentController.addUserScript(WKUserScript(
                source: "try{if(!localStorage.getItem('tvm.account.token'))localStorage.setItem('tvm.account.token',\(TVMShellScripts.jsString(held)));}catch(e){}",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        if let token = TVMShellScripts.tourToken {
            configuration.userContentController.addUserScript(WKUserScript(
                source: "try{if(!localStorage.getItem('tvm.account.token'))localStorage.setItem('tvm.account.token',\(TVMShellScripts.jsString(token)));}catch(e){}",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        // The phone look shared with Android, with the iOS layer (TVMShell.swift).
        let overlay = TVMShellScripts.overlay(glassBar: true)
        if !overlay.isEmpty {
            configuration.userContentController.addUserScript(WKUserScript(source: overlay, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        configuration.userContentController.add(context.coordinator, name: "tvmPlayer")
        configuration.userContentController.addScriptMessageHandler(context.coordinator, contentWorld: .page, name: "tvmShell")
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.bouncesZoom = false
        webView.scrollView.isDirectionalLockEnabled = true
        webView.customUserAgent = nil
        // CSS owns safe-area and keyboard insets. Auto-insetting the WK
        // scroll view fights the inner .page / .home overflow cameras and
        // can squash the UI into a strip when the keyboard opens.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.bounces = false
        // The document does not scroll; .home / .page / rails do. Leaving the
        // WK scroll view enabled steals vertical pans from those cameras,
        // especially when a finger starts on a horizontal rail.
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.delaysContentTouches = false
        webView.scrollView.canCancelContentTouches = false
        webView.scrollView.contentInset = TVMKeyboardLayout.webViewContentInset
        webView.scrollView.scrollIndicatorInsets = .zero
        context.coordinator.attach(webView)
        shell.webView = webView
        // A title found to carry another title's artwork: pictures of it already
        // on screen are replaced by its own card (tvm-android.js 18f).
        TVMArtTrust.onDistrusted = { [weak webView] ids in
            guard let list = try? JSONSerialization.data(withJSONObject: Array(ids)), let text = String(data: list, encoding: .utf8) else { return }
            DispatchQueue.main.async { webView?.evaluateJavaScript("window.__tvmaDropArt&&window.__tvmaDropArt(\(text));") }
        }
        if let cookie = session.cookie {
            configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak webView] in
                webView?.load(URLRequest(url: session.origin))
            }
        } else {
            webView.load(URLRequest(url: session.origin))
        }
        return TVMWebHostController(webView: webView)
    }

    func updateUIViewController(_ controller: TVMWebHostController, context: Context) {
        let webView = controller.webView
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.contentInset = TVMKeyboardLayout.webViewContentInset
        webView.scrollView.scrollIndicatorInsets = .zero
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.bouncesZoom = false
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.delaysContentTouches = false
        webView.scrollView.canCancelContentTouches = false
        controller.additionalSafeAreaInsets = .zero
    }

    static func dismantleUIViewController(_ controller: TVMWebHostController, coordinator: Coordinator) {
        coordinator.teardown()
        controller.webView.stopLoading()
        controller.webView.navigationDelegate = nil
        controller.webView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, UIGestureRecognizerDelegate {
        var parent: TVMWebView
        private var keyboardObservers: [NSObjectProtocol] = []
        weak var webView: WKWebView?
        private var engine: TVMVideoEngine?
        private var backGesture: UIScreenEdgePanGestureRecognizer?
        /// "Who's watching?" opens when the app starts, and again after a long while away (as on Android).
        private var freshLaunch = true
        private var backgroundedAt: Date?
        static let newSessionAfter: TimeInterval = 30 * 60

        init(parent: TVMWebView) { self.parent = parent }

        func attach(_ webView: WKWebView) {
            self.webView = webView
            lockZoom(webView)
            let back = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(swipeBack(_:)))
            back.edges = .left
            back.delegate = self
            webView.addGestureRecognizer(back)
            backGesture = back
            preferBackGesture(webView)
            let names: [Notification.Name] = [
                UIResponder.keyboardWillChangeFrameNotification,
                UIResponder.keyboardWillHideNotification,
                UIResponder.keyboardDidHideNotification,
                UIResponder.keyboardDidShowNotification,
            ]
            for name in names {
                keyboardObservers.append(NotificationCenter.default.addObserver(
                    forName: name,
                    object: nil,
                    queue: .main
                ) { [weak self] notification in
                    self?.publishKeyboard(notification)
                })
            }
            keyboardObservers.append(NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
                self?.backgroundedAt = Date()
            })
            keyboardObservers.append(NotificationCenter.default.addObserver(forName: UIApplication.willEnterForegroundNotification, object: nil, queue: .main) { [weak self] _ in
                guard let self else { return }
                NotificationCenter.default.post(name: .tvmWillEnterForeground, object: nil)
                if self.parent.session.isStandalone {
                    self.webView?.evaluateJavaScript("window.dispatchEvent(new Event('tvm:account-changed'));")
                }
                guard let away = self.backgroundedAt else { return }
                self.backgroundedAt = nil
                if Date().timeIntervalSince(away) >= Self.newSessionAfter, self.engine == nil, !self.freshLaunch {
                    self.webView?.evaluateJavaScript("(function(){try{if(window.tvmaFreshLaunch)window.tvmaFreshLaunch('resume')}catch(e){}})()")
                }
            })
        }

        func teardown() {
            engine?.onFinish = nil
            engine?.shutdown()
            engine = nil
            webView?.configuration.userContentController.removeScriptMessageHandler(forName: "tvmPlayer")
            webView?.configuration.userContentController.removeScriptMessageHandler(forName: "tvmShell", contentWorld: .page)
            for observer in keyboardObservers {
                NotificationCenter.default.removeObserver(observer)
            }
            keyboardObservers = []
            webView = nil
        }

        @objc private func swipeBack(_ gesture: UIScreenEdgePanGestureRecognizer) {
            guard gesture.state == .ended,
                  gesture.translation(in: webView).x > 70 || gesture.velocity(in: webView).x > 650 else { return }
            // An open popup or sheet closes first, as Android's Back does.
            webView?.evaluateJavaScript("(function(){try{if(typeof window.tvmaBack==='function'&&window.tvmaBack())return;}catch(e){}window.dispatchEvent(new Event('tvm:navigate-back'));})()")
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "tvmPlayer", message.frameInfo.isMainFrame,
                  let origin = message.frameInfo.request.url, parent.session.isSameOrigin(origin),
                  let data = message.body as? [String: Any], let id = data["id"] as? String,
                  let command = data["command"] as? String else { return }
            if command == "open" {
                guard let raw = data["url"] as? String, let url = URL(string: raw),
                      ["http", "https", "file"].contains(url.scheme?.lowercased() ?? ""), url.scheme == "file" || url.host != nil,
                      let host = webView?.parentViewController as? TVMWebHostController else {
                    publishPlayer(["id": id, "command": "error", "message": "Could not open the player. Go back and try again."])
                    return
                }
                engine?.onFinish = nil
                engine?.shutdown()
                let start = data["startAt"] as? Double ?? 0
                let next = TVMVideoEngine(id: id, url: url, startAt: start.isFinite ? max(0, start) : 0, live: data["live"] as? Bool ?? false,
                                          initialVolume: data["initialVolume"] as? Double ?? 1,
                                          initialMuted: data["initialMuted"] as? Bool ?? false,
                                          audioLanguage: data["audioLanguage"] as? String ?? "eng")
                next.onEvent = { [weak self] in self?.publishPlayer($0) }
                next.onFinish = { [weak self, weak next] in
                    guard let self, let next, self.engine === next else { return }
                    self.endCinema()
                }
                engine = next
                host.showVideo(next)
                beginCinema()
                next.start()
            } else if engine?.sessionID == id {
                engine?.command(command, data: data)
            }
        }

        /// The film fills the screen sideways, as on Android (TvmCinemaMode).
        private func beginCinema() {
            parent.shell.playing = true
            webView?.evaluateJavaScript("document.documentElement.classList.add('tvm-cinema');")
            TVMOrientation.lock(.landscape)
        }

        private func endCinema() {
            engine = nil
            (webView?.parentViewController as? TVMWebHostController)?.hideVideo()
            parent.shell.playing = false
            webView?.evaluateJavaScript("document.documentElement.classList.remove('tvm-cinema');")
            TVMOrientation.unlock()
        }

        // MARK: The shell bridge (tvm-ios.js)

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                                   replyHandler: @escaping (Any?, String?) -> Void) {
            guard message.name == "tvmShell", message.frameInfo.isMainFrame,
                  let origin = message.frameInfo.request.url, parent.session.isSameOrigin(origin),
                  let data = message.body as? [String: Any], let command = data["command"] as? String else {
                replyHandler(nil, nil); return
            }
            Task { @MainActor in
                switch command {
                case "snapshot": parent.shell.snapshot()
                case "fade": parent.shell.fade(milliseconds: data["ms"] as? Double ?? 210)
                case "bar": if let state = data["state"] as? [String: Any] { parent.shell.update(bar: state) }
                case "app": if let name = data["name"] as? String { appAction(name) }
                default: break
                }
                replyHandler(true, nil)
            }
        }

        private func appAction(_ name: String) {
            switch name {
            case "reload": webView?.reload()
            default: parent.onAppAction(name)
            }
        }

        private func publishPlayer(_ data: [String: Any]) {
            guard let json = try? JSONSerialization.data(withJSONObject: data), let string = String(data: json, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('tvm:native-player', {detail: \(string)}));")
        }

        private func keepFullSize(_ webView: WKWebView) {
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            webView.scrollView.contentInset = TVMKeyboardLayout.webViewContentInset
            webView.scrollView.scrollIndicatorInsets = .zero
            webView.scrollView.verticalScrollIndicatorInsets = .zero
            webView.scrollView.horizontalScrollIndicatorInsets = .zero
            webView.scrollView.isScrollEnabled = false
            webView.scrollView.delaysContentTouches = false
            webView.scrollView.canCancelContentTouches = false
            lockZoom(webView)
            if let host = webView.parentViewController as? TVMWebHostController {
                host.additionalSafeAreaInsets = .zero
            }
        }

        private func lockZoom(_ webView: WKWebView) {
            webView.scrollView.minimumZoomScale = 1
            webView.scrollView.maximumZoomScale = 1
            webView.scrollView.bouncesZoom = false
            webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        }

        private func preferBackGesture(_ webView: WKWebView) {
            guard let back = backGesture else { return }
            // Only the document pan waits. Requiring every pan on the view —
            // including nested overflow cameras — to wait for the edge gesture
            // delayed taps and made vertical scrolling feel dead.
            webView.scrollView.panGestureRecognizer.require(toFail: back)
        }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldBeRequiredToFailBy other: UIGestureRecognizer) -> Bool {
            false
        }

        /// The keyboard slides over the page; the page is told its height once
        /// (TVMShellScripts.keyboard) and nothing is resized or scrolled for it.
        private func publishKeyboard(_ notification: Notification) {
            guard let webView else { return }
            keepFullSize(webView)
            let hiding = notification.name == UIResponder.keyboardWillHideNotification
                || notification.name == UIResponder.keyboardDidHideNotification
            let overlap: CGFloat
            if hiding {
                overlap = 0
            } else if let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect {
                let local = webView.convert(frame, from: nil)
                overlap = TVMKeyboardLayout.overlapHeight(keyboardFrame: local, viewBounds: webView.bounds)
            } else {
                overlap = 0
            }
            let inset = TVMKeyboardLayout.cssInset(overlap: overlap, keyboardVisible: !hiding && overlap > 0)
            webView.scrollView.contentOffset = .zero
            webView.evaluateJavaScript(TVMShellScripts.keyboard(height: inset))
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            // Settings → App & Updates (tvm-android.js 20), from the page itself.
            if url.scheme == "tvm-app" {
                if navigationAction.targetFrame?.isMainFrame ?? false, let name = url.host { appAction(name) }
                decisionHandler(.cancel)
                return
            }
            if parent.session.isSameOrigin(url) || url.absoluteString == "about:blank" {
                decisionHandler(.allow)
            } else {
                if navigationAction.navigationType == .linkActivated && url.scheme == "https" {
                    UIApplication.shared.open(url)
                }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url, parent.session.isSameOrigin(url) {
                webView.load(navigationAction.request)
            } else if let url = navigationAction.request.url,
                      navigationAction.navigationType == .linkActivated && url.scheme == "https" {
                UIApplication.shared.open(url)
            }
            return nil
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            if let response = navigationResponse.response as? HTTPURLResponse,
               response.statusCode == 401 || response.statusCode == 403 {
                parent.error = parent.session.isStandalone
                    ? "TVM could not load a page from the on-device core."
                    : "Your TVM session has expired or been rejected. Reconnect using the host LAN token."
                parent.loading = false
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            parent.loading = false
            lockZoom(webView)
            preferBackGesture(webView)
            TVMDeviceChrome.publish(to: webView, insets: webView.safeAreaInsets)
            if freshLaunch {
                freshLaunch = false
                webView.evaluateJavaScript("(function(){try{return window.tvmaFreshLaunch?String(window.tvmaFreshLaunch('start')):'none'}catch(e){return 'none'}})()")
                if ProcessInfo.processInfo.arguments.contains("-TVMSmokeTour") { smokeTour(webView) }
                // The logo stays until "Who's watching?" is up (three seconds at most), as on Android.
                announceReadyWhenChooserIsUp(webView, tries: 0)
            } else {
                NotificationCenter.default.post(name: .tvmPageReady, object: nil)
            }
        }

        private func announceReadyWhenChooserIsUp(_ webView: WKWebView, tries: Int) {
            webView.evaluateJavaScript("(function(){try{return window.tvmaFreshState?window.tvmaFreshState():'done'}catch(e){return 'done'}})()") { result, _ in
                if (result as? String) != "pending" || tries >= 20 {
                    NotificationCenter.default.post(name: .tvmPageReady, object: nil)
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self, weak webView] in
                        guard let self, let webView else { return }
                        self.announceReadyWhenChooserIsUp(webView, tries: tries + 1)
                    }
                }
            }
        }
        /// CI's screenshot tour (apps/ios/smoke/tour.sh): the main screens in turn,
        /// driven as a person would, while the simulator is photographed.
        private func smokeTour(_ webView: WKWebView) {
            // A tab, after stepping back to a screen that has the tab bar (a title page has none).
            func tab(_ id: String) -> String {
                "(function go(n){if(!document.querySelector('.app__screen:not([inert]) nav.ribbon--tabs')&&n<5){window.dispatchEvent(new Event('tvm:navigate-back'));setTimeout(function(){go(n+1)},600);}else{window.__tvmIosBarTap&&window.__tvmIosBarTap('\(id)');}})(0);"
            }
            let steps: [(Double, String)] = [
                (9, "var t=document.querySelector('.tvma-who__tile:not(.tvma-who__tile--add)'); if(t) t.click();"),
                (16, tab("search")),
                (21, "var f=document.querySelector('.search-pill input'); if(f){var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(f,'Dexter'); f.dispatchEvent(new Event('input',{bubbles:true}));}"),
                (30, "var p=document.querySelector('.search-pill__panel .poster, .search-pill__panel button.tvma-card'); if(p) p.click();"),
                (38, tab("live")),
                (46, tab("watchlist")),
                (52, tab("home-dock")),
                // Last: the You popup, left open so the remaining photos show it.
                (58, tab("more")),
            ]
            for (at, script) in steps {
                DispatchQueue.main.asyncAfter(deadline: .now() + at) { [weak webView] in
                    webView?.evaluateJavaScript("(function(){try{\(script)}catch(e){}})()")
                }
            }
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failed(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failed(error) }
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            parent.loading = false
            parent.error = "The TVM view stopped responding. Use Reload to restore it, or reconnect if your session expired."
        }
        private func failed(_ error: Error) {
            guard (error as NSError).code != NSURLErrorCancelled else { return }
            parent.loading = false
            parent.error = parent.session.isStandalone
                ? "TVM could not load the bundled interface. Use Reload."
                : "TVM could not load. Check your Wi-Fi and host, then use Reload or Reconnect."
        }
    }
}

private extension UIView {
    var parentViewController: UIViewController? {
        var responder: UIResponder? = self
        while let next = responder?.next {
            if let controller = next as? UIViewController { return controller }
            responder = next
        }
        return nil
    }
}
