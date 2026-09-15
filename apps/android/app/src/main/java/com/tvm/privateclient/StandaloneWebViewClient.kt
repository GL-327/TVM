package com.tvm.privateclient

import android.content.Intent
import android.net.Uri
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import java.net.URI

/**
 * WebView policy for on-device mode.
 *
 * The LAN client's TVMWebViewClient is scoped to a remote `Connection`; here the
 * only origin that may ever load in this WebView is the app's own loopback
 * server. That matters more than usual because this is the WebView carrying the
 * native player bridge — anything else loading here would get a native surface.
 *
 * External links still work, they just leave: an https link opens in the
 * browser instead of inside the shell.
 */
class StandaloneWebViewClient(
    private val origin: String,
    private val onLoading: (Boolean) -> Unit,
    private val onError: (String) -> Unit,
) : WebViewClient() {

    private val host: String = runCatching { URI(origin).host }.getOrNull() ?: "127.0.0.1"
    private val port: Int = runCatching { URI(origin).port }.getOrNull() ?: -1

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val uri = request.url ?: return true
        if (isLoopback(uri) || uri.toString() == "about:blank") return false
        if (request.isForMainFrame && uri.scheme == "https") {
            runCatching { view.context.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        }
        return true
    }

    override fun onPageFinished(view: WebView, url: String) = onLoading(false)

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        onLoading(false)
        onError("TVM could not open its own interface. Reopen the app, and reinstall it if this keeps happening.")
    }

    /** The loopback server is plain HTTP by design; a TLS error here is not ours to bypass. */
    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: android.net.http.SslError) {
        handler.cancel()
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail?): Boolean {
        onLoading(false)
        onError("The TVM view stopped responding. Reopen the app to restore it.")
        return true
    }

    private fun isLoopback(uri: Uri): Boolean {
        if (!uri.scheme.equals("http", ignoreCase = true)) return false
        if (!uri.host.equals(host, ignoreCase = true)) return false
        return port == -1 || uri.port == port
    }
}
