package com.tvm.privateclient

import android.content.Intent
import android.net.Uri
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.net.URI

class TVMWebViewClient(
    private val connection: Connection,
    private val onLoading: (Boolean) -> Unit,
    private val onError: (String) -> Unit,
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url ?: return true
        if (sameOrigin(uri) || uri.toString() == "about:blank") return false
        if (request.isForMainFrame && uri.scheme == "https") {
            view.context.startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
        return true
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse,
    ) {
        if (request.isForMainFrame && (errorResponse.statusCode == 401 || errorResponse.statusCode == 403)) {
            onLoading(false)
            onError("Your TVM session has expired or been rejected. Reconnect using the host LAN token.")
        }
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        onLoading(false)
        onError("TVM could not load. Check your Wi-Fi and host, then use Reload or Reconnect.")
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
        handler.cancel()
        onLoading(false)
        onError("The host certificate was not trusted. Use a normally trusted HTTPS certificate.")
    }

    override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
        onLoading(true)
        view.evaluateJavascript(VIEWPORT_FIT, null)
    }

    override fun onPageFinished(view: WebView, url: String?) {
        view.evaluateJavascript(VIEWPORT_FIT, null)
        view.evaluateJavascript(KEYBOARD, null)
        onLoading(false)
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        onLoading(false)
        onError("The TVM view stopped responding. Use Reload to restore it, or reconnect if your session expired.")
        return true
    }

    private fun sameOrigin(uri: Uri): Boolean {
        return try {
            val parsed = URI(uri.scheme, uri.userInfo, uri.host, if (uri.port != -1) uri.port else -1, uri.path, null, null)
            connection.isSameOrigin(parsed)
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        const val VIEWPORT_FIT = """
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
        """

        /**
         * Shared UI inputs sit at the bottom of forms. Android WebView keeps the
         * layout viewport tall when the IME opens, so visualViewport is what
         * tells the page the keyboard height. Scroll the focused field into
         * view; do not install a JavascriptInterface.
         */
        const val KEYBOARD = """
            (function () {
              if (window.__tvmKeyboard) return;
              window.__tvmKeyboard = true;
              var root = document.documentElement;
              function keyboardPx() {
                var vv = window.visualViewport;
                if (!vv) return 0;
                return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
              }
              function reveal() {
                var kb = keyboardPx();
                root.style.setProperty('--tvm-keyboard', kb + 'px');
                var el = document.activeElement;
                if (!el) return;
                var tag = (el.tagName || '').toUpperCase();
                if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !el.isContentEditable) return;
                try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); }
                catch (e) { try { el.scrollIntoView(true); } catch (e2) {} }
              }
              if (window.visualViewport) {
                window.visualViewport.addEventListener('resize', reveal);
                window.visualViewport.addEventListener('scroll', reveal);
              }
              window.addEventListener('focusin', function () { setTimeout(reveal, 50); });
              window.addEventListener('resize', reveal);
              reveal();
            })();
        """
    }
}
