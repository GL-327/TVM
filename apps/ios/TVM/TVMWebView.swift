import SwiftUI
import WebKit

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
        var content = meta.getAttribute('content') || 'width=device-width, initial-scale=1';
        if (content.indexOf('viewport-fit') === -1) {
          meta.setAttribute('content', content + ', viewport-fit=cover');
        }
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
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
    }

    override func viewSafeAreaInsetsDidChange() {
        super.viewSafeAreaInsetsDidChange()
        additionalSafeAreaInsets = .zero
    }
}

struct TVMWebView: UIViewControllerRepresentable {
    let session: BrowseSession
    @Binding var loading: Bool
    @Binding var error: String?

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
        configuration.userContentController.addUserScript(viewport)
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.allowsBackForwardNavigationGestures = true
        webView.customUserAgent = nil
        // CSS owns safe-area and keyboard insets. Auto-insetting the WK
        // scroll view fights the inner .page / .home overflow cameras and
        // can squash the UI into a strip when the keyboard opens.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInset = TVMKeyboardLayout.webViewContentInset
        webView.scrollView.scrollIndicatorInsets = .zero
        context.coordinator.attach(webView)
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
        controller.additionalSafeAreaInsets = .zero
    }

    static func dismantleUIViewController(_ controller: TVMWebHostController, coordinator: Coordinator) {
        coordinator.teardown()
        controller.webView.stopLoading()
        controller.webView.navigationDelegate = nil
        controller.webView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: TVMWebView
        private var keyboardObservers: [NSObjectProtocol] = []
        weak var webView: WKWebView?

        init(parent: TVMWebView) { self.parent = parent }

        func attach(_ webView: WKWebView) {
            self.webView = webView
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
        }

        func teardown() {
            for observer in keyboardObservers {
                NotificationCenter.default.removeObserver(observer)
            }
            keyboardObservers = []
            webView = nil
        }

        private func keepFullSize(_ webView: WKWebView) {
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            webView.scrollView.contentInset = TVMKeyboardLayout.webViewContentInset
            webView.scrollView.scrollIndicatorInsets = .zero
            webView.scrollView.verticalScrollIndicatorInsets = .zero
            webView.scrollView.horizontalScrollIndicatorInsets = .zero
            if let host = webView.parentViewController as? TVMWebHostController {
                host.additionalSafeAreaInsets = .zero
            }
        }

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
            webView.evaluateJavaScript("window.__tvmKeyboardInset && window.__tvmKeyboardInset(\(inset));")
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
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

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { parent.loading = false }
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
