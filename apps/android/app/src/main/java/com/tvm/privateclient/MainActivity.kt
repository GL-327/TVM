package com.tvm.privateclient

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ProgressBar
import android.widget.TextView
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var connectionPane: View
    private lateinit var playerPane: View
    private lateinit var playerMessage: View
    private lateinit var address: EditText
    private lateinit var token: EditText
    private lateinit var allowHttp: CheckBox
    private lateinit var error: TextView
    private lateinit var connect: Button
    private lateinit var forget: Button
    private lateinit var connecting: ProgressBar
    private lateinit var webView: WebView
    private lateinit var playerLoading: ProgressBar
    private lateinit var playerError: TextView
    private lateinit var reconnect: Button

    private var active: Pair<Connection, SessionCookie>? = null
    private var busy = false
    private var restored = false
    private var localServer: TvmLocalServer? = null
    private var nativePlayer: TvmNativePlayer? = null
    private var standaloneOrigin: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        connectionPane = findViewById(R.id.connection_pane)
        playerPane = findViewById(R.id.player_pane)
        playerMessage = findViewById(R.id.player_message)
        address = findViewById(R.id.address)
        token = findViewById(R.id.token)
        allowHttp = findViewById(R.id.allow_http)
        error = findViewById(R.id.error)
        connect = findViewById(R.id.connect)
        forget = findViewById(R.id.forget)
        connecting = findViewById(R.id.connecting)
        webView = findViewById(R.id.webview)
        playerLoading = findViewById(R.id.player_loading)
        playerError = findViewById(R.id.player_error)
        reconnect = findViewById(R.id.reconnect)

        connect.setOnClickListener { connect() }
        forget.setOnClickListener { disconnect() }
        findViewById<View>(R.id.reload).setOnClickListener { reload() }
        findViewById<View>(R.id.settings).setOnClickListener { confirmDisconnect() }
        reconnect.setOnClickListener { disconnect() }
        token.addTextChangedListener(SimpleWatcher { forget.visibility = if (token.text.isNotEmpty()) View.VISIBLE else View.GONE })
        configureWindow()
        configureWebView()
        if (StandalonePolicy.DEFAULT_MODE == StandalonePolicy.Mode.ON_DEVICE) startStandalone() else restore()
    }

    /**
     * On-device mode: the app is the core.
     *
     * A loopback HTTP server serves the bundled `apps/ui` build and answers its
     * API, so the interface gets a real http:// origin — ES modules and
     * same-origin fetches both fail from file://. Nothing on the Wi-Fi network
     * can reach 127.0.0.1, which is why this needs no LAN token.
     *
     * The LAN client below is still here as the optional home-core path, the
     * same arrangement as iOS.
     */
    private fun startStandalone() {
        connectionPane.visibility = View.GONE
        playerPane.visibility = View.VISIBLE
        hidePlayerMessage()
        playerLoading.visibility = View.VISIBLE
        webView.visibility = View.VISIBLE
        thread {
            try {
                val core = TvmLocalCore.create(filesDir, { readBundledCatalog() }, { readBuildInfo() }, { readBundledAccess() })
                val server = TvmLocalServer(core) { path -> readUiAsset(path) }
                server.start()
                localServer = server
                runOnUiThread { attachStandalone(server) }
            } catch (problem: Exception) {
                runOnUiThread {
                    showPlayerMessage(
                        "TVM could not start its on-device core: " +
                            (problem.message ?: "unknown error") +
                            ". Reopen the app, and reinstall it if this keeps happening.",
                    )
                }
            }
        }
    }

    private fun attachStandalone(server: TvmLocalServer) {
        /*
         * The native player bridge is attached ONLY here, where the WebView is
         * about to load our own loopback origin. Attaching it on the LAN path
         * would hand a remote core a native surface on this phone.
         */
        val player = TvmNativePlayer(this, webView)
        nativePlayer = player
        webView.addJavascriptInterface(player.bridge(), "tvmPlayer")
        standaloneOrigin = server.origin
        webView.webViewClient = StandaloneWebViewClient(
            origin = server.origin,
            onLoading = { loading -> playerLoading.visibility = if (loading) View.VISIBLE else View.GONE },
            onError = { message -> showPlayerMessage(message) },
        )
        webView.loadUrl(server.origin)
    }

    private fun readUiAsset(path: String): ByteArray? = runCatching {
        assets.open("ui/$path").use { it.readBytes() }
    }.getOrNull()

    private fun readBundledCatalog(): String? = runCatching {
        assets.open("FallbackCatalog.json").use { it.readBytes().toString(Charsets.UTF_8) }
    }.getOrNull()

    private fun readBuildInfo(): String? = runCatching {
        assets.open("BuildInfo.json").use { it.readBytes().toString(Charsets.UTF_8) }
    }.getOrNull()

    override fun onDestroy() {
        nativePlayer?.release()
        nativePlayer = null
        localServer?.stop()
        localServer = null
        webView.stopLoading()
        webView.webViewClient = android.webkit.WebViewClient()
        webView.destroy()
        super.onDestroy()
    }

    /** Terms and tiers, generated from the core by scripts/export-access.mjs. */
    private fun readBundledAccess(): String? = runCatching {
        assets.open("Access.json").bufferedReader().use { it.readText() }
    }.getOrNull()

    private fun configureWindow() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
        )
        window.attributes = window.attributes.apply {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { _, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottom = maxOf(bars.bottom, ime.bottom)
            connectionPane.setPadding(bars.left, bars.top, bars.right, bottom)
            playerPane.setPadding(bars.left, bars.top, bars.right, bottom)
            insets
        }
    }

    private fun restore() {
        if (restored) return
        restored = true
        val saved = CredentialStore.read(this) ?: return
        address.setText(saved.origin.toString())
        token.setText(saved.token)
        allowHttp.isChecked = saved.allowLocalHttp
        connect()
    }

    private fun connect() {
        if (busy) return
        busy = true
        error.visibility = View.GONE
        connecting.visibility = View.VISIBLE
        connect.isEnabled = false
        val addressText = address.text.toString()
        val tokenText = token.text.toString()
        val http = allowHttp.isChecked
        thread {
            try {
                val connection = Connection.validated(addressText, tokenText, http)
                val cookie = SessionClient.connect(connection)
                try {
                    CredentialStore.save(applicationContext, connection)
                } catch (problem: ClientException) {
                    SessionClient.disconnect(connection, cookie)
                    throw problem
                }
                runOnUiThread { attached(connection, cookie) }
            } catch (problem: ClientException) {
                runOnUiThread { failed(problem.message) }
            } catch (_: Exception) {
                runOnUiThread {
                    failed("Could not reach TVM. Check that Core is running and both devices share Wi-Fi.")
                }
            }
        }
    }

    private fun attached(connection: Connection, cookie: SessionCookie) {
        busy = false
        connecting.visibility = View.GONE
        connect.isEnabled = true
        active = connection to cookie
        connectionPane.visibility = View.GONE
        playerPane.visibility = View.VISIBLE
        hidePlayerMessage()
        webView.visibility = View.VISIBLE
        load(connection, cookie)
    }

    private fun failed(message: String?) {
        busy = false
        connecting.visibility = View.GONE
        connect.isEnabled = true
        error.text = message ?: "Could not reach TVM."
        error.visibility = View.VISIBLE
    }

    private fun disconnect() {
        try {
            CredentialStore.clear(this)
        } catch (problem: ClientException) {
            error.text = problem.message
            error.visibility = View.VISIBLE
            return
        }
        val previous = active
        active = null
        token.setText("")
        error.visibility = View.GONE
        forget.visibility = View.GONE
        clearWebData()
        connectionPane.visibility = View.VISIBLE
        playerPane.visibility = View.GONE
        if (previous != null) {
            thread { SessionClient.disconnect(previous.first, previous.second) }
        }
    }

    private fun confirmDisconnect() {
        val host = active?.first?.origin?.toString() ?: return
        AlertDialog.Builder(this)
            .setTitle("TVM connection")
            .setMessage(host)
            .setPositiveButton("Disconnect and forget token") { _, _ -> disconnect() }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun reload() {
        val current = active ?: return
        hidePlayerMessage()
        webView.visibility = View.VISIBLE
        playerLoading.visibility = View.VISIBLE
        load(current.first, current.second)
    }

    private fun hidePlayerMessage() {
        playerMessage.visibility = View.GONE
        playerError.visibility = View.GONE
        reconnect.visibility = View.GONE
    }

    /** Standalone has nothing to reconnect to, so that button stays hidden. */
    private fun showPlayerMessage(message: String) {
        playerLoading.visibility = View.GONE
        webView.visibility = View.GONE
        playerError.text = message
        playerError.visibility = View.VISIBLE
        playerMessage.visibility = View.VISIBLE
        reconnect.visibility = if (standaloneOrigin == null) View.VISIBLE else View.GONE
    }

    private fun load(connection: Connection, cookie: SessionCookie) {
        playerLoading.visibility = View.VISIBLE
        val store = CookieManager.getInstance()
        store.setAcceptCookie(true)
        store.setAcceptThirdPartyCookies(webView, false)
        store.removeAllCookies {
            store.setCookie(
                connection.origin.toString(),
                cookie.webViewCookie(connection.origin.scheme.equals("https", ignoreCase = true)),
            ) {
                webView.webViewClient = TVMWebViewClient(
                    connection,
                    onLoading = { loading -> playerLoading.visibility = if (loading) View.VISIBLE else View.GONE },
                    onError = { message ->
                        playerError.text = message
                        playerError.visibility = View.VISIBLE
                        reconnect.visibility = View.VISIBLE
                        playerMessage.visibility = View.VISIBLE
                    },
                )
                webView.loadUrl(connection.origin.toString())
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        webView.setBackgroundColor(0xFF000000.toInt())
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.isClickable = true
        // Do not set OnTouchListener: that would swallow DOM click and overlay taps.
        webView.settings.javaScriptEnabled = true
        webView.settings.userAgentString = webView.settings.userAgentString + " TVM-Android"
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.settings.javaScriptCanOpenWindowsAutomatically = false
        webView.settings.setSupportMultipleWindows(false)
        webView.settings.cacheMode = WebSettings.LOAD_DEFAULT
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = false
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
        webView.webChromeClient = WebChromeClient()
    }

    private fun clearWebData() {
        webView.stopLoading()
        webView.loadUrl("about:blank")
        CookieManager.getInstance().removeAllCookies(null)
        WebStorage.getInstance().deleteAllData()
        webView.clearCache(true)
        webView.clearHistory()
    }

    private class SimpleWatcher(private val after: () -> Unit) : android.text.TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
        override fun afterTextChanged(s: android.text.Editable?) = after()
    }
}
