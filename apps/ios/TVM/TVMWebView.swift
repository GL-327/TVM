import SwiftUI
import WebKit

struct TVMWebView: UIViewRepresentable {
    let active: ActiveConnection
    @Binding var loading: Bool
    @Binding var error: String?

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.allowsBackForwardNavigationGestures = true
        // Phone/browser capabilities are detected by the shared UI; no Electron bridge.
        webView.customUserAgent = nil
        let viewport = WKUserScript(
            source: """
            (function () {
              var meta = document.querySelector('meta[name="viewport"]');
              if (!meta) {
                meta = document.createElement('meta');
                meta.setAttribute('name', 'viewport');
                document.head.appendChild(meta);
              }
              var content = meta.getAttribute('content') || 'width=device-width, initial-scale=1';
              if (content.indexOf('viewport-fit') === -1) {
                meta.setAttribute('content', content + ', viewport-fit=cover');
              }
            })();
            """,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        configuration.userContentController.addUserScript(viewport)
        configuration.websiteDataStore.httpCookieStore.setCookie(active.cookie) { [weak webView] in
            webView?.load(URLRequest(url: active.connection.origin))
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) { }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.stopLoading()
        uiView.navigationDelegate = nil
        uiView.uiDelegate = nil
        // A new ephemeral store is constructed on reload/disconnect.
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let parent: TVMWebView
        init(parent: TVMWebView) { self.parent = parent }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
            if parent.active.connection.isSameOrigin(url) || url.absoluteString == "about:blank" {
                decisionHandler(.allow)
            } else {
                // Never load a third-party page into the session-bearing webview.
                if navigationAction.navigationType == .linkActivated && url.scheme == "https" {
                    UIApplication.shared.open(url)
                }
                decisionHandler(.cancel)
            }
        }

        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = navigationAction.request.url, parent.active.connection.isSameOrigin(url) {
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
                parent.error = "Your TVM session has expired or been rejected. Reconnect using the host LAN token."
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
            parent.error = "TVM could not load. Check your Wi-Fi and host, then use Reload or Reconnect."
        }
    }
}
