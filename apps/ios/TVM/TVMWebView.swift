import SwiftUI
import WebKit

/// Shared with `apps/ui/src/nav/phoneViewport.ts`. WKWebView often reports a
/// late or missing visualViewport resize; keyboard-frame notifications fill in.
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
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT')) return;
        try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
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
          if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
            window.setTimeout(function () { apply(); }, 50);
          }
        });
      }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
      else start();
    })();
    """
}

struct TVMWebView: UIViewRepresentable {
    let session: BrowseSession
    @Binding var loading: Bool
    @Binding var error: String?

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> WKWebView {
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
        // scroll view fights the inner .page / .home overflow cameras.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.keyboardDismissMode = .interactive
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInset = .zero
        webView.scrollView.scrollIndicatorInsets = .zero
        context.coordinator.attach(webView)
        if let cookie = session.cookie {
            configuration.websiteDataStore.httpCookieStore.setCookie(cookie) { [weak webView] in
                webView?.load(URLRequest(url: session.origin))
            }
        } else {
            webView.load(URLRequest(url: session.origin))
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) { }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        coordinator.teardown()
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        var parent: TVMWebView
        private var keyboardObserver: NSObjectProtocol?
        weak var webView: WKWebView?

        init(parent: TVMWebView) { self.parent = parent }

        func attach(_ webView: WKWebView) {
            self.webView = webView
            keyboardObserver = NotificationCenter.default.addObserver(
                forName: UIResponder.keyboardWillChangeFrameNotification,
                object: nil,
                queue: .main
            ) { [weak self] notification in
                self?.publishKeyboard(notification)
            }
        }

        func teardown() {
            if let keyboardObserver {
                NotificationCenter.default.removeObserver(keyboardObserver)
            }
            keyboardObserver = nil
            webView = nil
        }

        private func publishKeyboard(_ notification: Notification) {
            guard let webView,
                  let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
            else { return }
            let overlap = webView.convert(frame, from: nil).intersection(webView.bounds).height
            let inset = max(0, overlap.rounded())
            webView.evaluateJavaScript("window.__tvmKeyboardInset && window.__tvmKeyboardInset(\(Int(inset)));")
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
