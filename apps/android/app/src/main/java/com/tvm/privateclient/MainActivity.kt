package com.tvm.privateclient

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.res.AssetManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.ImageButton
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import java.io.File
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread
import org.json.JSONObject

/**
 * The Android shell, built to behave as the iPhone app does (apps/ios/TVM/TVMApp.swift).
 *
 * The phone runs its own core and the interface fills the screen edge to edge.
 * A quiet menu top right reloads TVM or, optionally, connects to a home Core on
 * the Wi-Fi — exactly the two things the iOS menu offers. The interface
 * refreshes itself from GitHub: a newer bundle is put on disk as soon as it
 * verifies, and this activity reloads so the open session is not stuck on the
 * copy that shipped in the APK.
 */
class MainActivity : AppCompatActivity() {
    /**
     * A profile picture chosen in the interface (<input type="file">): the
     * system photo picker, which needs no storage permission and shows only
     * photos. The WebView reads the picked content:// picture itself.
     */
    private var pendingPicture: ValueCallback<Array<Uri>>? = null
    private val pickPicture = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        pendingPicture?.onReceiveValue(if (uri != null) arrayOf(uri) else null)
        pendingPicture = null
    }

    private lateinit var webView: WebView
    private lateinit var starting: ProgressBar
    private lateinit var errorPane: View
    private lateinit var errorTitle: TextView
    private lateinit var errorIcon: View
    private lateinit var errorText: TextView
    private lateinit var errorReload: Button
    private lateinit var chrome: View
    private lateinit var pageLoading: ProgressBar
    private lateinit var menuButton: ImageButton
    private lateinit var intro: TvmIntroView
    private lateinit var cinema: TvmCinemaMode

    /** The startup reveal leaves once it has finished AND the page is ready. */
    private var introRevealed = false
    private var pageReady = false
    /** A genuine start (not a recreation): the page opens on "Who's watching?". */
    private var freshLaunch = false
    /** The logo waits for the chooser to be up (openChooserThenReveal). */
    private var chooserHold = false
    private val main = Handler(Looper.getMainLooper())

    /** Android-only look (assets/android-shell), injected into every page on a phone. */
    private var overlayScript: String = ""

    /** Updates of the APK itself (TvmAppUpdate); the interface has its own updater. */
    private val appUpdate by lazy { TvmAppUpdate { ApkBundle(assets).appBuild() } }
    private var appUpdateBusy = false
    private var autoAppCheckDone = false
    /** A downloaded update waiting for "install unknown apps" to be allowed. */
    private var pendingInstall: File? = null

    private var core: TvmLocalCore? = null
    private var localServer: TvmLocalServer? = null
    private var nativePlayer: TvmNativePlayer? = null
    private var standaloneOrigin: String? = null

    /** The optional home Core, when one is in use instead of this phone's own. */
    private var active: Pair<Connection, SessionCookie>? = null
    private var bridgeAttached = false
    private var insets: WindowInsetsCompat? = null
    private var lastBack = 0L

    /** Read by the loopback server's worker threads when it serves index.html. */
    @Volatile
    private var bootScript: String = ""

    private val television: Boolean by lazy { TvmDeviceChrome.isTelevision(this) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // A genuine start, not Android recreating the screen: the page opens on
        // "Who's watching?" (tvm-android.js 17c).
        freshLaunch = savedInstanceState == null
        setContentView(R.layout.activity_main)
        webView = findViewById(R.id.webview)
        starting = findViewById(R.id.starting)
        errorPane = findViewById(R.id.error_pane)
        errorTitle = findViewById(R.id.error_title)
        errorIcon = findViewById(R.id.error_icon)
        errorText = findViewById(R.id.error_text)
        errorReload = findViewById(R.id.error_reload)
        chrome = findViewById(R.id.chrome)
        pageLoading = findViewById(R.id.page_loading)
        menuButton = findViewById(R.id.menu)
        intro = findViewById(R.id.intro)
        cinema = TvmCinemaMode(this, webView, listOf(chrome))
        intro.onRevealed = {
            introRevealed = true
            dismissIntroWhenReady()
            // Still starting well after the logo settled: show that work is going on.
            main.postDelayed({ if (intro.visibility == View.VISIBLE && !pageReady) starting.visibility = View.VISIBLE }, 4_000)
        }
        if (!television) {
            overlayScript = TvmShellScripts.androidOverlay(
                readAsset("android-shell/tvm-android.css").orEmpty(),
                readAsset("android-shell/tvm-android.js").orEmpty(),
            )
        }

        errorReload.setOnClickListener { reloadPage() }
        menuButton.setOnClickListener { showMenu(it) }
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() = goBack()
            },
        )
        configureWindow()
        configureWebView()
        refreshBootScript()
        startStandalone()
    }

    override fun onStart() {
        super.onStart()
        nativePlayer?.onHostStart()
    }

    override fun onStop() {
        nativePlayer?.onHostStop()
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        val apk = pendingInstall ?: return
        if (packageManager.canRequestPackageInstalls()) {
            pendingInstall = null
            installApk(apk)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        cinema.onWindowFocusChanged(hasFocus)
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        intro.stop()
        cinema.exit()
        nativePlayer?.release()
        nativePlayer = null
        localServer?.stop()
        localServer = null
        webView.stopLoading()
        webView.webViewClient = android.webkit.WebViewClient()
        (webView.parent as? ViewGroup)?.removeView(webView)
        webView.destroy()
        super.onDestroy()
    }

    // ---- Standalone: the phone is the core ------------------------------------

    /**
     * Starts the on-device core and its loopback server, then shows the
     * interface. GitHub is asked first, for up to 20 seconds, so this open is
     * not the copy that shipped in the APK. If the download is still going we
     * open anyway and reload when it lands.
     */
    private fun startStandalone() {
        showStarting()
        thread(name = "tvm-core-start") {
            try {
                val made = TvmLocalCore.create(
                    filesDir,
                    { readAsset("FallbackCatalog.json") },
                    ApkBundle(assets),
                    { readAsset("Access.json") },
                )
                // An interface staged on the last run goes live now; one left
                // over from a different app build is dropped.
                made.bundledUi.prepare()
                val swapped = AtomicBoolean(false)
                val apply = thread(name = "tvm-update-launch") {
                    swapped.set(runCatching { made.updater.applyIfNeeded() }.getOrDefault(false))
                }
                apply.join(20_000)
                val pending = apply.isAlive
                val server = TvmLocalServer(made, { path -> made.bundledUi.read(path) }) { bootScript }
                server.start()
                runOnUiThread {
                    core = made
                    made.artCache = TvmArtCache(java.io.File(cacheDir, "art"))
                    made.onUpdateCheck = { runOnUiThread { checkAppUpdate(manual = true) } }
                    localServer = server
                    standaloneOrigin = server.origin
                    refreshBootScript()
                    showStandalone()
                }
                if (pending) {
                    thread(name = "tvm-update-late") {
                        apply.join()
                        if (swapped.get()) {
                            runOnUiThread {
                                if (standaloneOrigin != null && !this.isFinishing) webView.reload()
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                runOnUiThread { showStartupError(getString(R.string.start_failed)) }
            }
        }
    }

    private fun showStandalone() {
        val origin = standaloneOrigin ?: return
        attachStandaloneBridge()
        webView.webViewClient = StandaloneWebViewClient(
            origin = origin,
            onLoading = { loading -> setLoading(loading) },
            onError = { message -> showPageError(message) },
            onAppAction = ::appAction,
        )
        clearError()
        setLoading(true)
        webView.loadUrl(origin)
    }

    /**
     * The native player bridge is attached ONLY while this phone's own
     * standalone loopback origin is loaded. A home Core on the network must
     * never be handed a native surface on this phone, so switching to one
     * removes the bridge first.
     */
    private fun attachStandaloneBridge() {
        if (bridgeAttached || standaloneOrigin == null) return
        val player = nativePlayer ?: TvmNativePlayer(this, webView) { playing ->
            if (playing) cinema.enter() else cinema.exit()
        }.also { nativePlayer = it }
        webView.addJavascriptInterface(player.bridge(), "tvmPlayer")
        bridgeAttached = true
    }

    private fun detachBridge() {
        if (!bridgeAttached) return
        nativePlayer?.release()
        nativePlayer = null
        webView.removeJavascriptInterface("tvmPlayer")
        bridgeAttached = false
    }

    private fun readAsset(name: String): String? = runCatching {
        assets.open(name).bufferedReader(Charsets.UTF_8).use { it.readText() }
    }.getOrNull()

    /** The interface and build stamp inside the APK. */
    private class ApkBundle(private val assets: AssetManager) : TvmAppBundle {
        private val build: String by lazy {
            val text = runCatching { assets.open("BuildInfo.json").bufferedReader(Charsets.UTF_8).use { it.readText() } }.getOrNull()
            Json.string(Json.parseObject(text).opt("commit"))?.lowercase(Locale.US) ?: "unknown"
        }

        override fun appBuild(): String = build

        override fun readBundled(path: String): ByteArray? =
            runCatching { assets.open("ui/$path").use { it.readBytes() } }.getOrNull()
    }

    // ---- Optional home Core ---------------------------------------------------

    /**
     * The ⋮ menu's actions, now rows in Settings → App & Updates. The menu
     * itself is shown only with the error screens, where Settings cannot be
     * reached.
     */
    private fun appAction(name: String) {
        when (name) {
            "reload" -> reloadPage()
            "update" -> checkAppUpdate(manual = true)
            "core" -> if (active == null) showHomeCoreSheet() else backToThisPhone()
        }
    }

    private fun showMenu(anchor: View) {
        val menu = PopupMenu(this, anchor)
        menu.menu.add(0, MENU_RELOAD, 0, getString(R.string.reload))
        menu.menu.add(0, MENU_APP_UPDATE, 2, getString(R.string.check_app_update))
        if (active == null) {
            menu.menu.add(0, MENU_HOME_CORE, 1, getString(R.string.use_home_core))
        } else {
            menu.menu.add(0, MENU_BACK_TO_PHONE, 1, getString(R.string.back_to_phone))
        }
        menu.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                MENU_RELOAD -> reloadPage()
                MENU_HOME_CORE -> showHomeCoreSheet()
                MENU_BACK_TO_PHONE -> backToThisPhone()
                MENU_APP_UPDATE -> checkAppUpdate(manual = true)
            }
            true
        }
        menu.show()
    }

    private fun showHomeCoreSheet() {
        val dialog = BottomSheetDialog(this)
        val sheet = layoutInflater.inflate(R.layout.sheet_home_core, null)
        val address = sheet.findViewById<EditText>(R.id.address)
        val token = sheet.findViewById<EditText>(R.id.token)
        val allowHttp = sheet.findViewById<CheckBox>(R.id.allow_http)
        val error = sheet.findViewById<TextView>(R.id.error)
        val connecting = sheet.findViewById<ProgressBar>(R.id.connecting)
        val connect = sheet.findViewById<Button>(R.id.connect)
        sheet.findViewById<View>(R.id.close).setOnClickListener { dialog.dismiss() }
        runCatching { CredentialStore.read(this) }.getOrNull()?.let { saved ->
            address.setText(saved.origin.toString())
            allowHttp.isChecked = saved.allowLocalHttp
        }

        fun failed(message: String) {
            connecting.visibility = View.GONE
            connect.isEnabled = true
            connect.text = getString(R.string.connect)
            error.text = message
            error.visibility = View.VISIBLE
        }

        connect.setOnClickListener {
            error.visibility = View.GONE
            connecting.visibility = View.VISIBLE
            connect.isEnabled = false
            connect.text = getString(R.string.connecting)
            val addressText = address.text.toString()
            val tokenText = token.text.toString()
            val http = allowHttp.isChecked
            thread(name = "tvm-home-core") {
                try {
                    val connection = Connection.validated(addressText, tokenText, http)
                    val cookie = SessionClient.connect(connection)
                    try {
                        CredentialStore.save(applicationContext, connection)
                    } catch (problem: ClientException) {
                        SessionClient.disconnect(connection, cookie)
                        throw problem
                    }
                    runOnUiThread {
                        dialog.dismiss()
                        useHomeCore(connection, cookie)
                    }
                } catch (problem: ClientException) {
                    runOnUiThread { failed(problem.message ?: getString(R.string.home_core_unreachable)) }
                } catch (_: Exception) {
                    runOnUiThread { failed(getString(R.string.home_core_unreachable)) }
                }
            }
        }
        dialog.setContentView(sheet)
        dialog.show()
    }

    private fun useHomeCore(connection: Connection, cookie: SessionCookie) {
        detachBridge()
        active = connection to cookie
        watchHomeCorePlayer()
        clearError()
        setLoading(true)
        val cookies = CookieManager.getInstance()
        cookies.setAcceptCookie(true)
        cookies.setAcceptThirdPartyCookies(webView, false)
        cookies.removeAllCookies {
            cookies.setCookie(
                connection.origin.toString(),
                cookie.webViewCookie(connection.origin.scheme.equals("https", ignoreCase = true)),
            ) {
                webView.webViewClient = TVMWebViewClient(
                    connection,
                    onLoading = { loading -> setLoading(loading) },
                    onError = { message -> showPageError(message) },
                    onAppAction = ::appAction,
                )
                webView.loadUrl(connection.origin.toString())
            }
        }
    }

    private fun backToThisPhone() {
        val previous = active ?: return
        active = null
        main.removeCallbacks(homeCorePlayerCheck)
        cinema.exit()
        runCatching { CredentialStore.clear(this) }
        CookieManager.getInstance().removeAllCookies(null)
        thread(name = "tvm-home-core-close") { runCatching { SessionClient.disconnect(previous.first, previous.second) } }
        showStandalone()
    }

    // ---- Page state -----------------------------------------------------------

    private fun reloadPage() {
        clearError()
        val current = active
        when {
            current != null -> useHomeCore(current.first, current.second)
            standaloneOrigin != null -> showStandalone()
            else -> startStandalone()
        }
    }

    private fun setLoading(loading: Boolean) {
        pageLoading.visibility = if (loading) View.VISIBLE else View.GONE
        if (!loading) {
            starting.visibility = View.GONE
            if (errorPane.visibility != View.VISIBLE) webView.visibility = View.VISIBLE
            // A home Core's page is not served by this phone, so it gets the
            // Android look here rather than in the boot script.
            if (active != null && overlayScript.isNotEmpty()) webView.evaluateJavascript(overlayScript, null)
            // As TVMWebView's didFinish: the page now has its real surroundings.
            publishChrome()
            cinema.republish()
            pageReady = true
            if (freshLaunch) {
                freshLaunch = false
                openChooserThenReveal()
            } else {
                dismissIntroWhenReady()
            }
        }
    }

    /**
     * On a genuine start, the page is asked to open "Who's watching?", and the
     * logo stays until it is up, so Home is never seen first. Three seconds at
     * most; a page without the Android overlay (a television) answers at once.
     */
    private fun openChooserThenReveal() {
        chooserHold = true
        val release = {
            if (chooserHold) {
                chooserHold = false
                dismissIntroWhenReady()
            }
        }
        webView.evaluateJavascript(FRESH_LAUNCH_SCRIPT) { result ->
            if (result?.trim('"') != "started") { release(); return@evaluateJavascript }
            val started = SystemClock.elapsedRealtime()
            val poll = object : Runnable {
                override fun run() {
                    if (!chooserHold || isDestroyed) return
                    if (SystemClock.elapsedRealtime() - started > 3_000) { release(); return }
                    webView.evaluateJavascript(FRESH_STATE_SCRIPT) { state ->
                        if (state?.trim('"') == "pending") webView.postDelayed(this, 80) else release()
                    }
                }
            }
            webView.postDelayed(poll, 80)
        }
    }

    // ---- Startup reveal -------------------------------------------------------

    private fun dismissIntroWhenReady() {
        if (chooserHold || !introRevealed || !pageReady || intro.visibility != View.VISIBLE) return
        starting.visibility = View.GONE
        intro.animate().alpha(0f).setDuration(350).withEndAction {
            hideIntro()
            autoCheckAppUpdate()
        }.start()
    }

    // ---- App (APK) updates ------------------------------------------------------

    /**
     * Once per launch, when automatic updates are on, at most every six hours,
     * and never again for a build the user already said "Later" to.
     */
    private fun autoCheckAppUpdate() {
        if (autoAppCheckDone) return
        autoAppCheckDone = true
        val store = core?.store ?: return
        if (!TvmPrefs.load(store).autoUpdate) return
        val prefs = getSharedPreferences(APP_UPDATE_PREFS, MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (now - prefs.getLong("lastAutoCheck", 0L) < 6 * 60 * 60 * 1000L) return
        prefs.edit().putLong("lastAutoCheck", now).apply()
        checkAppUpdate(manual = false)
    }

    private fun checkAppUpdate(manual: Boolean) {
        if (isFinishing) return
        if (appUpdateBusy) {
            if (manual) Toast.makeText(this, R.string.app_update_checking, Toast.LENGTH_SHORT).show()
            return
        }
        appUpdateBusy = true
        if (manual) {
            Toast.makeText(this, R.string.app_update_checking, Toast.LENGTH_SHORT).show()
            reportAppUpdate("checking")
        }
        thread(name = "tvm-app-update") {
            val result = appUpdate.check()
            runOnUiThread {
                appUpdateBusy = false
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (manual) {
                    when (result) {
                        is TvmAppUpdate.Check.Available -> reportAppUpdate("available", result.release.build)
                        is TvmAppUpdate.Check.Unknown -> reportAppUpdate("unknown", result.release.build)
                        is TvmAppUpdate.Check.Current -> reportAppUpdate("current", result.build)
                        is TvmAppUpdate.Check.Failed -> reportAppUpdate("failed", reason = result.reason)
                    }
                }
                val skipped = getSharedPreferences(APP_UPDATE_PREFS, MODE_PRIVATE).getString("later", null)
                when (result) {
                    is TvmAppUpdate.Check.Available ->
                        if (manual || skipped != result.release.build) offerAppUpdate(result.release, known = true)
                    is TvmAppUpdate.Check.Unknown -> if (manual) offerAppUpdate(result.release, known = false)
                    is TvmAppUpdate.Check.Current -> if (manual) {
                        Toast.makeText(this, getString(R.string.app_update_current, result.build.take(7)), Toast.LENGTH_SHORT).show()
                    }
                    is TvmAppUpdate.Check.Failed -> if (manual) Toast.makeText(this, result.reason, Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    /** Tells Settings → App & Updates how a check the user started is going. */
    private fun reportAppUpdate(state: String, build: String = "", reason: String = "") {
        if (!::webView.isInitialized) return
        val detail = JSONObject().put("state", state).put("build", build.take(7)).put("reason", reason)
        webView.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('tvm:app-update',{detail:$detail}));",
            null,
        )
    }

    private fun offerAppUpdate(release: TvmAppUpdate.Release, known: Boolean) {
        val mine = ApkBundle(assets).appBuild().take(7)
        val body = if (known) {
            getString(R.string.app_update_body, release.build.take(7), mine)
        } else {
            getString(R.string.app_update_body_unknown, release.build.take(7))
        }
        MaterialAlertDialogBuilder(this)
            .setTitle(R.string.app_update_title)
            .setMessage(body)
            .setPositiveButton(R.string.app_update_install) { _, _ -> downloadAppUpdate(release) }
            .setNegativeButton(R.string.app_update_later) { _, _ ->
                getSharedPreferences(APP_UPDATE_PREFS, MODE_PRIVATE).edit().putString("later", release.build).apply()
            }
            .show()
    }

    private fun downloadAppUpdate(release: TvmAppUpdate.Release) {
        if (appUpdateBusy) return
        appUpdateBusy = true
        val progress = MaterialAlertDialogBuilder(this)
            .setTitle(R.string.app_update_downloading)
            .setView(ProgressBar(this).apply { isIndeterminate = true; setPadding(0, 48, 0, 48) })
            .setCancelable(false)
            .show()
        thread(name = "tvm-app-download") {
            val outcome = runCatching { appUpdate.download(release, File(cacheDir, "updates")) }
            runOnUiThread {
                appUpdateBusy = false
                runCatching { progress.dismiss() }
                if (isFinishing || isDestroyed) return@runOnUiThread
                outcome.fold(
                    onSuccess = { installApk(it) },
                    onFailure = { problem ->
                        Toast.makeText(
                            this,
                            getString(R.string.app_update_failed, problem.message ?: "unknown error"),
                            Toast.LENGTH_LONG,
                        ).show()
                    },
                )
            }
        }
    }

    /** Hands the verified APK to Android's installer, which asks the user to confirm. */
    private fun installApk(apk: File) {
        if (!packageManager.canRequestPackageInstalls()) {
            pendingInstall = apk
            Toast.makeText(this, R.string.app_update_allow, Toast.LENGTH_LONG).show()
            runCatching {
                startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            }
            return
        }
        val uri = FileProvider.getUriForFile(this, "$packageName.updates", apk)
        val intent = Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { startActivity(intent) }.onFailure {
            Toast.makeText(this, getString(R.string.app_update_failed, it.message ?: "no installer"), Toast.LENGTH_LONG).show()
        }
    }

    private fun hideIntro() {
        intro.animate().cancel()
        intro.stop()
        intro.visibility = View.GONE
        starting.visibility = View.GONE
    }

    // ---- Full-screen playback for a home Core ----------------------------------

    /**
     * A home Core plays in the page's own <video> and has no native bridge (on
     * purpose: see attachStandaloneBridge), so the shell looks for the player
     * screen instead of being told about it.
     */
    private val homeCorePlayerCheck: Runnable = object : Runnable {
        override fun run() {
            if (active == null || isFinishing) return
            webView.evaluateJavascript(HOME_CORE_PLAYER_SCRIPT) { result ->
                if (active == null) return@evaluateJavascript
                if (result?.trim('"') == "true") cinema.enter() else cinema.exit()
            }
            main.postDelayed(this, 1_000)
        }
    }

    private fun watchHomeCorePlayer() {
        main.removeCallbacks(homeCorePlayerCheck)
        main.postDelayed(homeCorePlayerCheck, 1_000)
    }

    /** Insets, but only where the page actually draws under the bars. */
    private fun edgeInsets(): WindowInsetsCompat? =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) insets else null

    private fun publishChrome() {
        val current = edgeInsets()
        TvmDeviceChrome.publish(webView, TvmDeviceChrome.profile(this, current))
        webView.evaluateJavascript(
            "window.__tvmKeyboardInset && window.__tvmKeyboardInset(${TvmDeviceChrome.keyboardInset(this, current)});",
            null,
        )
        // The window already shrinks for the keyboard (the root is padded by it),
        // so the Android look tracks the keyboard with its own class instead of
        // adding the keyboard's height a second time.
        val imeOpen = insets?.isVisible(WindowInsetsCompat.Type.ime()) == true
        webView.evaluateJavascript("document.documentElement.classList.toggle('tvm-ime-open', $imeOpen);", null)
    }

    private fun showStarting() {
        starting.visibility = View.GONE
        pageReady = false
        if (intro.visibility != View.VISIBLE || !introRevealed) {
            intro.animate().cancel()
            intro.alpha = 1f
            intro.visibility = View.VISIBLE
            introRevealed = false
            intro.start()
        }
        chrome.visibility = View.GONE
        errorPane.visibility = View.GONE
        webView.visibility = View.INVISIBLE
    }

    private fun clearError() {
        errorPane.visibility = View.GONE
        // No floating ⋮ over the interface: its actions are in Settings.
        chrome.visibility = View.GONE
    }

    /** As PlayerShell's error: an icon, the reason, and Reload. */
    private fun showPageError(message: String) {
        hideIntro()
        starting.visibility = View.GONE
        pageLoading.visibility = View.GONE
        webView.visibility = View.INVISIBLE
        errorTitle.visibility = View.GONE
        errorIcon.visibility = View.VISIBLE
        errorReload.visibility = View.VISIBLE
        errorText.text = message
        errorPane.visibility = View.VISIBLE
        chrome.visibility = View.VISIBLE
        errorReload.requestFocus()
    }

    /** As StandaloneRoot's error: the name and the reason, nothing to press. */
    private fun showStartupError(message: String) {
        hideIntro()
        starting.visibility = View.GONE
        chrome.visibility = View.GONE
        webView.visibility = View.INVISIBLE
        errorTitle.visibility = View.VISIBLE
        errorIcon.visibility = View.GONE
        errorReload.visibility = View.GONE
        errorText.text = message
        errorPane.visibility = View.VISIBLE
    }

    /**
     * Back goes back inside TVM while there is somewhere to go, and leaves the
     * app from its first screen. The interface publishes which is which as
     * `data-can-go-back`; iOS gets the same effect from its edge swipe.
     */
    private fun goBack() {
        if (errorPane.visibility == View.VISIBLE || webView.visibility != View.VISIBLE) {
            leaveApp()
            return
        }
        webView.evaluateJavascript(BACK_SCRIPT) { result ->
            if (result?.trim('"') == "true") return@evaluateJavascript
            leaveApp()
        }
    }

    private fun leaveApp() {
        val now = SystemClock.elapsedRealtime()
        if (now - lastBack < 2_000) {
            lastBack = 0
            moveTaskToBack(true)
            return
        }
        lastBack = now
        Toast.makeText(this, R.string.back_again, Toast.LENGTH_SHORT).show()
    }

    // ---- Window and insets ----------------------------------------------------

    /**
     * Edge to edge, as the iOS web view is: the page draws under the bars and
     * lays itself out from the insets published to it. The keyboard is the one
     * thing the window still makes room for, so a focused field is never under it.
     */
    private fun configureWindow() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            enableEdgeToEdge(
                statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
                navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
            )
            window.attributes = window.attributes.apply {
                layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        val root = findViewById<View>(R.id.root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, latest ->
            insets = latest
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                val ime = latest.getInsets(WindowInsetsCompat.Type.ime())
                root.setPadding(0, 0, 0, ime.bottom)
            }
            val edge = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
            val bars = latest.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            (chrome.layoutParams as? ViewGroup.MarginLayoutParams)?.let { params ->
                val density = resources.displayMetrics.density
                params.topMargin = (if (edge) bars.top else 0) + (4 * density).toInt()
                params.marginEnd = (if (edge) bars.right else 0) + (8 * density).toInt()
                chrome.layoutParams = params
            }
            refreshBootScript()
            if (webView.visibility == View.VISIBLE) publishChrome()
            latest
        }
    }

    private fun refreshBootScript() {
        val language = core?.store?.let { TvmDeviceChrome.language(it) } ?: TvmPrefs.DEFAULT_LANGUAGE
        bootScript = TvmShellScripts.boot(!television, TvmDeviceChrome.profile(this, edgeInsets()), language, overlayScript)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        // Debug builds can be inspected over USB. CI's install test reads the
        // page this way to check the app reaches the sign-in screen.
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        webView.setBackgroundColor(Color.BLACK)
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.isClickable = true
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.isNestedScrollingEnabled = true
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
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
        // The loopback server marks the interface no-store, so an updated
        // interface is never served from cache; artwork is marked cacheable
        // (TvmArtCache). LOAD_NO_CACHE used to refetch every poster each time.
        webView.settings.cacheMode = WebSettings.LOAD_DEFAULT
        webView.settings.useWideViewPort = true
        webView.settings.loadWithOverviewMode = false
        webView.settings.setSupportZoom(false)
        webView.settings.builtInZoomControls = false
        webView.settings.displayZoomControls = false
        webView.webChromeClient = object : WebChromeClient() {
            // The player screen keeps a <video> element even while the native
            // player draws the film underneath it. With no poster of its own,
            // the WebView painted its built-in one there: a low-resolution
            // white card with a black play button that flashed on every open
            // and retry. A transparent poster leaves the picture (or the black
            // loading surface) visible instead.
            override fun getDefaultVideoPoster(): Bitmap =
                Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888).apply { eraseColor(android.graphics.Color.TRANSPARENT) }

            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?,
            ): Boolean {
                if (callback == null) return false
                // Only pictures are ever asked for (profile pictures).
                if (params?.acceptTypes?.any { it.startsWith("image/") } != true) return false
                pendingPicture?.onReceiveValue(null)
                pendingPicture = callback
                return try {
                    pickPicture.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    true
                } catch (error: Exception) {
                    pendingPicture = null
                    false
                }
            }
        }
    }

    private companion object {
        const val MENU_RELOAD = 1
        const val MENU_HOME_CORE = 2
        const val MENU_BACK_TO_PHONE = 3
        const val MENU_APP_UPDATE = 4
        const val APP_UPDATE_PREFS = "tvm-app-update"

        const val HOME_CORE_PLAYER_SCRIPT =
            "(function(){return !!document.querySelector('.modal-layer[data-screen=player]');})();"

        const val FRESH_LAUNCH_SCRIPT =
            "(function(){try{return window.tvmaFreshLaunch?String(window.tvmaFreshLaunch()):'none'}catch(e){return 'none'}})()"
        const val FRESH_STATE_SCRIPT =
            "(function(){try{return window.tvmaFreshState?window.tvmaFreshState():'done'}catch(e){return 'done'}})()"
        const val BACK_SCRIPT = """
            (function () {
              // An open sheet or popup (tvm-android.js) closes first.
              try { if (typeof window.tvmaBack === 'function' && window.tvmaBack()) return 'true'; } catch (e) {}
              var can = document.documentElement.dataset.canGoBack === 'true';
              if (can) window.dispatchEvent(new Event('tvm:navigate-back'));
              return can ? 'true' : 'false';
            })();
        """
    }
}
