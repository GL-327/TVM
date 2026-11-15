/*
 * The iPhone's additions to the shared phone look (apps/android/.../android-shell/
 * tvm-android.js, which runs first on iOS as well, under html.tvm-android and
 * html.tvm-ios). Only what differs on iOS lives here; the screens, the pill,
 * Search, Details and the page crossfade are the same code as on Android.
 */
(function () {
  var root = document.documentElement;
  if (window.__tvmIosShell) return;
  window.__tvmIosShell = true;
  root.classList.add('tvm-ios');
  var shell = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.tvmShell;

  // ---- 1. The page crossfade on iOS 16 and 17 ---------------------------------------
  //
  // On iOS 18 and later WebKit has view transitions, so the shared crossfade
  // (tvm-android.js section 17) runs exactly as on Android. Earlier iOS
  // versions get the same fade from the app itself: it lays a still picture
  // of the screen over the page, the page changes underneath, and the picture
  // fades out over the same 210 ms with the same curve. A real picture, not a
  // copy of the page, so nothing on it reloads or restarts.
  if (typeof document.startViewTransition !== 'function' && shell && typeof shell.postMessage === 'function') {
    var running = null;
    document.startViewTransition = function (update) {
      var resolveFinished;
      var finished = new Promise(function (resolve) { resolveFinished = resolve; });
      var t = {
        finished: finished,
        ready: Promise.resolve(),
        updateCallbackDone: null,
        skipTransition: function () {
          if (t.done) return;
          t.done = true;
          try { shell.postMessage({ command: 'fade', ms: 0 }); } catch (e) { /* the picture is gone */ }
          resolveFinished();
        },
        done: false,
      };
      if (running) running.skipTransition();
      running = t;
      var cover;
      try { cover = shell.postMessage({ command: 'snapshot' }); } catch (e) { cover = null; }
      t.updateCallbackDone = Promise.resolve(cover).catch(function () {}).then(function () {
        return typeof update === 'function' ? update() : undefined;
      });
      t.updateCallbackDone.then(function () {
        if (t.done) return;
        // The new screen paints under the picture first, then the picture goes.
        requestAnimationFrame(function () {
          if (t.done) return;
          try { shell.postMessage({ command: 'fade', ms: 210 }); } catch (e) { /* no picture to fade */ }
          setTimeout(function () { if (!t.done) { t.done = true; resolveFinished(); } if (running === t) running = null; }, 220);
        });
      }, function () { t.skipTransition(); });
      return t;
    };
    window.__tvmIosFadeFallback = true;
  }

  // ---- 2. Pictures through the app ------------------------------------------------------
  //
  // On Android the app fetches every poster itself (retries after a refusal
  // or a dropped connection, keeps them on the phone, and refuses artwork
  // filed under the wrong title). WKWebView gives an app no such hook, so on
  // iOS the same pictures are asked of the app's own server, which does the
  // same work (TVMImages): /api/art?src=<the picture's address>.
  var ART_HOSTS = /^https?:\/\/([a-z0-9-]+\.)*(metahub\.space|image\.tmdb\.org|media-amazon\.com|mzstatic\.com|tvmaze\.com|fanart\.tv|kitsu\.io)\//i;
  function viaApp(url) {
    if (typeof url !== 'string' || !ART_HOSTS.test(url)) return url;
    return '/api/art?src=' + encodeURIComponent(url);
  }
  window.__tvmIosArt = viaApp;
  try {
    var srcProp = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (srcProp && srcProp.set) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: srcProp.enumerable,
        get: srcProp.get,
        set: function (value) { srcProp.set.call(this, viaApp(value)); },
      });
    }
    var setAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (this instanceof HTMLImageElement && String(name).toLowerCase() === 'src') value = viaApp(String(value));
      return setAttr.call(this, name, value);
    };
    // CSS background pictures set from script (the profile chooser's faces
    // are data: URLs and pass through untouched).
    var styleSet = CSSStyleDeclaration.prototype.setProperty;
    CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
      if (typeof value === 'string' && value.indexOf('url(') >= 0) {
        value = value.replace(/url\((['"]?)(https?:[^'")]+)\1\)/g, function (m, q, u) { return 'url(' + q + viaApp(u) + q + ')'; });
      }
      return styleSet.call(this, name, value, priority);
    };
  } catch (e) { /* pictures load directly, as before */ }

  // ---- 3. The keyboard never moves the page ---------------------------------------------
  //
  // The app reports the keyboard once (tvm-android.js 6b makes room and lifts
  // a field only if the keyboard would cover it). WebKit's own reflex, and the
  // shared phone helper's, is to scroll the focused field to the middle of the
  // screen, which moved whole pages and pushed headers under the status bar.
  var nativeIntoView = Element.prototype.scrollIntoView;
  var FIELD = 'input, textarea, select, [contenteditable="true"]';
  Element.prototype.scrollIntoView = function () {
    if (root.classList.contains('tvm-ios') && this.matches && this.matches(FIELD) && !root.classList.contains('tvma-keys')) return;
    return nativeIntoView.apply(this, arguments);
  };
  window.addEventListener('scroll', function () {
    if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
  }, { passive: true });

  // ---- 3b. Settings → App & Updates ---------------------------------------------------------
  //
  // The rows the shared look adds to Settings (tvm-android.js 20). Reload and
  // a home Core are the app's; on iOS a newer version of the app is found on
  // the Updates page, which checks the interface feed and reports when a
  // newer app is needed.
  window.tvmaAppAction = function (name) {
    if (name === 'update') {
      var updates = document.querySelector('.app__screen:not([inert]) [data-focus-id="updates"]');
      if (updates) { updates.click(); return; }
    }
    if (shell) { try { shell.postMessage({ command: 'app', name: name }); } catch (e) { /* not reachable */ } }
  };

  // ---- 4. The bar and the You popup are the app's (Liquid Glass) ---------------------------
  //
  // When the app draws the tab bar itself (TVMGlassBar), the page's own bar is
  // hidden and the app is told what the bar should show: whether it is up,
  // which tab is lit, and the profile's picture. A tap on the app's bar
  // presses the page's own button, so every destination stays the interface's.
  var glass = !!(shell && window.__tvmIosGlassBar);
  if (glass) root.classList.add('tvm-ios-glass');
  var lastBar = '';
  function liveBar() {
    var pill = document.querySelector('nav.tvma-pill.tvma-pill--on');
    if (pill) return pill;
    return document.querySelector('.app__screen:not([inert]) nav.ribbon--tabs');
  }
  function barState() {
    var bar = liveBar();
    var hidden = !bar || root.classList.contains('tvm-cinema') || root.classList.contains('tvm-native-playback') ||
      root.classList.contains('tvm-ime-open') || root.classList.contains('keyboard-open') ||
      !!document.querySelector('.tvma-who, .tvma-sheet, .modal-layer[data-screen="player"]') ||
      root.classList.contains('tvma-routing');
    var active = '';
    var you = { name: '', hue: 215, picture: '' };
    if (bar) {
      var lit = bar.querySelector('.ribbon__icon--on[data-focus-id], .ribbon__icon--on[data-tvma-tab]');
      if (lit) active = lit.getAttribute('data-focus-id') || lit.getAttribute('data-tvma-tab') || '';
      if (bar.classList.contains('ribbon--more')) active = 'more';
      var av = bar.querySelector('.tvma-av');
      if (av) {
        you.name = (av.textContent || '').trim();
        var hue = parseFloat(getComputedStyle(av).getPropertyValue('--tvma-av-hue'));
        if (isFinite(hue)) you.hue = hue;
        var bg = av.style.backgroundImage || '';
        var m = /url\(["']?(data:[^"')]+)["']?\)/.exec(bg);
        if (m) you.picture = m[1];
      }
    }
    var sheet = document.querySelector('.app__screen:not([inert]) .ribbon-sheet');
    var rows = [];
    if (sheet) {
      var items = sheet.querySelectorAll('.ribbon-sheet__row[data-focus-id]');
      for (var i = 0; i < items.length; i++) {
        var row = items[i];
        if (row.style.display === 'none' || getComputedStyle(row).display === 'none') continue;
        var strong = row.querySelector('strong');
        var sub = row.querySelector('.ribbon-sheet__text > span');
        rows.push({ id: row.getAttribute('data-focus-id'), title: strong ? strong.textContent : row.textContent, detail: sub ? sub.textContent : '', on: row.classList.contains('ribbon-sheet__row--on') });
      }
    }
    return { visible: !hidden, active: active, you: you, popup: rows, entrance: root.classList.contains('tvma-pill-enter') };
  }
  function syncBar() {
    if (!glass) return;
    var state = barState();
    var key = JSON.stringify(state);
    if (key === lastBar) return;
    lastBar = key;
    try { shell.postMessage({ command: 'bar', state: state }); } catch (e) { /* the app's bar keeps its last state */ }
  }
  if (glass) {
    var queued = false;
    var queue = function () {
      if (queued) return;
      queued = true;
      setTimeout(function () { queued = false; syncBar(); }, 16);
    };
    new MutationObserver(queue).observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'data-tvma-you'] });
    // The app's bar was tapped: press the page's own button.
    window.__tvmIosBarTap = function (id) {
      var real = document.querySelector('.app__screen:not([inert]) nav.ribbon--tabs [data-focus-id="' + id + '"]') ||
        document.querySelector('nav.tvma-pill.tvma-pill--on [data-tvma-tab="' + id + '"]');
      if (real) real.click();
      queue();
      return !!real;
    };
    // A row of the app's You popup: the page's own row.
    window.__tvmIosPopupRow = function (id) {
      var row = document.querySelector('.app__screen:not([inert]) .ribbon-sheet [data-focus-id="' + id + '"]');
      if (row) row.click();
      queue();
      return !!row;
    };
    // The app's popup was dismissed (a tap outside it): the page's popup closes too.
    window.__tvmIosPopupDismiss = function () {
      var scrim = document.querySelector('.app__screen:not([inert]) .ribbon-sheet__scrim');
      if (scrim) scrim.click();
      queue();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', syncBar);
    else syncBar();
  }
})();
