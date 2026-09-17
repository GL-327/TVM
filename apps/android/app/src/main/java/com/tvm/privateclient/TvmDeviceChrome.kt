package com.tvm.privateclient

import android.app.Activity
import android.app.UiModeManager
import android.content.Context
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.os.Build
import android.webkit.WebView
import androidx.core.view.WindowInsetsCompat
import org.json.JSONObject
import java.util.Locale
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The phone chrome the interface lays out around, as TVMDeviceChrome does on
 * iOS: safe-area insets, a device family and the tallest picture the screen
 * can show, published to the page as `window.__tvmDevice`.
 *
 * The interface's families are named after iPhones. On Android a tablet reads
 * as "ipad", a screen with a cutout as "notch", and everything else, including
 * a television, as "unknown", which adds no extra padding of its own.
 */
object TvmDeviceChrome {
    /** Last published screen cap. 2160 until the shell has measured the device. */
    @Volatile
    private var screenMaxHeight = 2160

    fun isTelevision(context: Context): Boolean {
        val modes = context.getSystemService(Context.UI_MODE_SERVICE) as? UiModeManager
        if (modes?.currentModeType == Configuration.UI_MODE_TYPE_TELEVISION) return true
        return context.packageManager.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
    }

    /** Everything is in CSS pixels: device pixels divided by the density. */
    fun profile(activity: Activity, insets: WindowInsetsCompat?): JSONObject {
        val metrics = activity.resources.displayMetrics
        val density = if (metrics.density > 0f) metrics.density else 1f
        val configuration = activity.resources.configuration
        val television = isTelevision(activity)
        val tablet = !television && configuration.smallestScreenWidthDp >= 600

        val bars = insets?.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val cutout = insets?.displayCutout
        val imeOpen = insets?.isVisible(WindowInsetsCompat.Type.ime()) == true
        val family = when {
            television -> "unknown"
            tablet -> "ipad"
            cutout != null && cutout.safeInsetTop > 0 -> "notch"
            else -> "unknown"
        }

        val shortSide = min(metrics.widthPixels, metrics.heightPixels)
        val maxHeight = when {
            shortSide >= 1440 -> 2160
            shortSide >= 1080 -> 1080
            television -> 1080
            else -> 720
        }
        screenMaxHeight = maxHeight
        val (extraTop, extraBottom, extraX) = when (family) {
            "ipad" -> Triple(4, 0, 0)
            "notch" -> Triple(6, 0, 0)
            else -> Triple(0, 0, 0)
        }
        fun css(px: Int?): Double = if (px == null) 0.0 else (px / density).toDouble()

        return Json.obj(
            "identifier" to "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
            "model" to Build.MODEL.orEmpty().ifEmpty { "Android" },
            "family" to family,
            "maxHeight" to maxHeight,
            "insetTop" to css(bars?.top),
            "insetRight" to css(bars?.right),
            // With the keyboard up the navigation bar is behind it; the keyboard
            // inset already accounts for that space.
            "insetBottom" to if (imeOpen) 0.0 else css(bars?.bottom),
            "insetLeft" to css(bars?.left),
            "extraTop" to extraTop,
            "extraBottom" to extraBottom,
            "extraX" to extraX,
        )
    }

    fun publish(webView: WebView, profile: JSONObject) {
        webView.evaluateJavascript(
            "window.__tvmDevice=$profile;window.__tvmApplyDevice&&window.__tvmApplyDevice();",
            null,
        )
    }

    /** The on-screen keyboard's height over the page, in CSS pixels. */
    fun keyboardInset(activity: Activity, insets: WindowInsetsCompat?): Int {
        if (insets == null || !insets.isVisible(WindowInsetsCompat.Type.ime())) return 0
        val density = activity.resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
        return (max(0, ime - nav) / density).roundToInt()
    }

    fun language(store: TvmStore): String = TvmPrefs.load(store).language.lowercase(Locale.US)

    /** Same cap as TVMDeviceChrome.playbackHeight: plan limit, then the screen. */
    fun playbackHeight(planMax: Int): Int = min(planMax, screenMaxHeight)
}

/**
 * The scripts the page needs before it starts, as the WKUserScripts in
 * TVMWebView.swift: the viewport, the keyboard inset, orientation classes,
 * the device chrome and the language.
 */
object TvmShellScripts {
    /**
     * The iOS PhoneViewportScript, with one difference: iOS always marks the
     * page as a phone, and this only does when it is not a television — the
     * same APK runs on Android TV, which wants the ten-foot layout.
     */
    fun phoneViewport(phone: Boolean): String = """
        (function () {
          var PHONE = ${if (phone) "true" else "false"};
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
          var nativeInset = 0;
          function lift() {
            var el = document.activeElement;
            if (!el) return;
            var editable = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
              el.tagName === 'SELECT' || el.getAttribute('contenteditable') === 'true';
            if (!editable) return;
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
            if (typeof inset === 'number') nativeInset = inset;
            var value = Math.max(nativeInset, occlusion());
            if (value < 0) value = 0;
            root.style.setProperty('--tvm-keyboard', value + 'px');
            root.style.setProperty('--tvm-keyboard-inset', value + 'px');
            if (PHONE) root.classList.add('phone-shell');
            root.classList.toggle('keyboard-open', value >= 80);
            orient();
            if (value >= 80) lift();
          }
          window.__tvmKeyboardInset = apply;
          ensureViewport();
          if (PHONE) document.documentElement.classList.add('phone-shell');
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
          }
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
          else start();
        })();
    """.trimIndent()

    fun device(profile: JSONObject): String = """
        window.__tvmDevice=$profile;
        (function(){
          var d=window.__tvmDevice||{};
          var r=document.documentElement;
          function px(n){n=Number(n);return ((isFinite(n)&&n>=0)?Math.round(n):0)+'px';}
          if(d.family){
            r.dataset.deviceFamily=d.family;
            r.classList.toggle('tvm-island', d.family==='island');
            r.classList.toggle('tvm-notch', d.family==='notch');
            r.classList.toggle('tvm-home-button', d.family==='home-button');
            r.classList.toggle('tvm-ipad', d.family==='ipad');
          }
          r.style.setProperty('--tvm-inset-top', px(d.insetTop));
          r.style.setProperty('--tvm-inset-right', px(d.insetRight));
          r.style.setProperty('--tvm-inset-bottom', px(d.insetBottom));
          r.style.setProperty('--tvm-inset-left', px(d.insetLeft));
          r.style.setProperty('--tvm-chrome-extra-top', px(d.extraTop));
          r.style.setProperty('--tvm-chrome-extra-bottom', px(d.extraBottom));
          r.style.setProperty('--tvm-chrome-extra-x', px(d.extraX));
        })();
    """.trimIndent()

    fun language(code: String): String {
        val safe = code.filter { it.isLetter() }.take(8).ifEmpty { "en" }
        return "document.documentElement.lang='$safe';document.documentElement.dataset.lang='$safe';"
    }

    fun boot(phone: Boolean, profile: JSONObject, language: String): String =
        phoneViewport(phone) + "\n" + device(profile) + "\n" + language(language)
}
