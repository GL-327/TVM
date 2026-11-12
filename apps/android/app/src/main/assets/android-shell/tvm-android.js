/*
 * TVM on Android phones only: behaviour for tvm-android.css.
 *
 * Runs inside the Android shell's boot script (TvmShellScripts.androidOverlay),
 * after html.tvm-android has been set. It never moves, adds to or removes the
 * interface's own elements. It reads them, sets attributes and CSS variables,
 * and (for vertical page scrolling only) lets the browser do the scrolling.
 *
 *   1. Native vertical scrolling. The shared interface scrolls pages from
 *      JavaScript, writing scrollTop on every finger move with a short capped
 *      coast. On a phone that costs a style and layout pass per move. Here the
 *      browser scrolls instead, on the compositor, at the screen's own rate.
 *      Horizontal rails keep the interface's own handling.
 *   2. A small edge bounce, measured from touch events.
 *   3. Home hero parallax, from the page's scroll position.
 *   4. The timeline's time bubble kept on screen while dragging.
 *   5. The tab pill kept over Search, driving the real tabs.
 *   6. Switch state for settings rows that are on or off.
 */
(function () {
  var root = document.documentElement;
  var SCROLLERS = '.page, .home, .details, .search-pill__panel, .gate, .gate-terms, .billing-page';
  var OWNED = '.player, [data-player], input, textarea, select, [role="slider"], .tvm-progress, .ribbon, .ribbon-sheet, .tvma-pill';
  var SLOP = 8;

  function off() {
    var d = root.dataset;
    return d.motion === 'reduced' || d.perf === 'on';
  }

  function maxScroll(el) {
    return Math.max(0, el.scrollHeight - el.clientHeight);
  }

  // ---- 1 + 2. Native scrolling and the edge bounce ------------------------------

  var touch = null;

  window.addEventListener('touchstart', function (event) {
    touch = null;
    if (event.touches.length !== 1) return;
    var target = event.target;
    if (!target || !target.closest || target.closest(OWNED)) return;
    var el = target.closest(SCROLLERS);
    if (!el) return;
    var t = event.touches[0];
    stopSpring(el);
    touch = { el: el, x: t.clientX, y: t.clientY, axis: null, edgeY: null, edge: 0, max: maxScroll(el) };
  }, { capture: true, passive: true });

  function claim(event, x, y) {
    if (!touch) return false;
    if (touch.axis === null) {
      var dx = x - touch.x;
      var dy = y - touch.y;
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return false;
      touch.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
    }
    return touch.axis === 'y';
  }

  // The interface's pointer handler would write scrollTop for this move; for a
  // vertical page pan the browser does it instead.
  window.addEventListener('pointermove', function (event) {
    if (event.pointerType !== 'touch' || !touch) return;
    if (claim(event, event.clientX, event.clientY)) event.stopImmediatePropagation();
  }, true);

  // The interface cancels touchmove once it claims a pan, which is what stops
  // the browser scrolling. Not for a vertical page pan.
  window.addEventListener('touchmove', function (event) {
    if (!touch || event.touches.length !== 1) return;
    var t = event.touches[0];
    if (!claim(event, t.clientX, t.clientY)) return;
    event.stopImmediatePropagation();
    if (off()) return;
    // Edge bounce: once the page is at its top or bottom, further pull shows
    // as a small, stiff offset (a third of the iOS stretch).
    var el = touch.el;
    var top = el.scrollTop;
    var atTop = top <= 0.5;
    var atBottom = top >= touch.max - 0.5;
    if (touch.edgeY === null) {
      if (atTop && t.clientY > touch.y) { touch.edgeY = t.clientY; touch.edge = 1; }
      else if (atBottom && t.clientY < touch.y) { touch.edgeY = t.clientY; touch.edge = -1; }
      return;
    }
    var pull = (t.clientY - touch.edgeY) * touch.edge;
    if (pull <= 0) { touch.edgeY = null; setOffset(el, 0); return; }
    setOffset(el, touch.edge * rubber(pull));
  }, { capture: true, passive: true });

  function release() {
    if (!touch) return;
    var el = touch.el;
    touch = null;
    var offset = currentOffset(el);
    if (offset !== 0) spring(el, offset, 0);
  }
  window.addEventListener('touchend', release, true);
  window.addEventListener('touchcancel', release, true);

  /* At most about 36px however far the finger goes. */
  var LIMIT = 36;
  function rubber(distance) {
    return LIMIT * (1 - 1 / (distance / 140 + 1));
  }

  function setOffset(el, px) {
    if (Math.abs(px) < 0.25) {
      if (el.hasAttribute('data-tvm-rubber')) {
        el.removeAttribute('data-tvm-rubber');
        el.style.removeProperty('--tvm-rubber');
      }
      return;
    }
    if (!el.hasAttribute('data-tvm-rubber')) el.setAttribute('data-tvm-rubber', '');
    el.style.setProperty('--tvm-rubber', px.toFixed(1) + 'px');
  }

  function currentOffset(el) {
    var v = parseFloat(el.style.getPropertyValue('--tvm-rubber'));
    return isFinite(v) ? v : 0;
  }

  var springs = typeof WeakMap === 'function' ? new WeakMap() : null;
  function stopSpring(el) {
    if (!springs) return;
    var s = springs.get(el);
    if (s) { s.stopped = true; springs.delete(el); }
  }

  /* Critically damped: settles in about 300 ms, never wobbles. */
  var OMEGA = 20;
  function spring(el, x0, v0) {
    stopSpring(el);
    var state = { stopped: false };
    if (springs) springs.set(el, state);
    var start = performance.now();
    function frame(now) {
      if (state.stopped) return;
      var t = (now - start) / 1000;
      var x = (x0 + (v0 + OMEGA * x0) * t) * Math.exp(-OMEGA * t);
      if (t > 0.05 && Math.abs(x) < 0.3) { setOffset(el, 0); if (springs) springs.delete(el); return; }
      setOffset(el, x);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // A fling that reaches an edge gets a small kick, scaled to its speed.
  var flings = typeof WeakMap === 'function' ? new WeakMap() : null;
  document.addEventListener('scroll', function (event) {
    var el = event.target;
    if (!flings || !el || el.nodeType !== 1 || touch || off()) return;
    if (!el.matches || !el.matches(SCROLLERS)) return;
    var now = performance.now();
    var top = el.scrollTop;
    var last = flings.get(el);
    flings.set(el, { top: top, at: now });
    if (!last || now - last.at > 60) return;
    var v = (top - last.top) / (now - last.at); // px per ms
    if (Math.abs(v) < 1.2) return;
    // Height is only read for a fast fling going down, never per scroll event.
    if ((v < 0 && top <= 0.5) || (v > 0 && top >= maxScroll(el) - 0.5)) {
      spring(el, 0, Math.max(-420, Math.min(420, -v * 160)));
    }
  }, { capture: true, passive: true });

  // ---- 3. Home hero ------------------------------------------------------------------

  // The picture drifts up at half the page's speed and fades as it goes, so it
  // leaves the screen gradually instead of being cut by the screen edge.
  var heroQueued = false;
  var heroHeight = new WeakMap();
  var heroLast = new WeakMap();
  window.addEventListener('resize', function () { heroHeight = new WeakMap(); }, { passive: true });
  document.addEventListener('scroll', function (event) {
    var el = event.target;
    if (!el || el.nodeType !== 1 || !el.classList || !el.classList.contains('home')) return;
    if (heroQueued) return;
    heroQueued = true;
    requestAnimationFrame(function () {
      heroQueued = false;
      var stage = el.querySelector('.stage--home');
      if (!stage) return;
      // The stage's height only changes with the layout; read it once per size.
      var h = heroHeight.get(stage);
      if (!h) { h = stage.offsetHeight || 1; heroHeight.set(stage, h); }
      var y = Math.max(0, Math.min(el.scrollTop, h));
      // Once the hero is gone, further scrolling changes nothing here.
      if (y === heroLast.get(stage)) return;
      heroLast.set(stage, y);
      stage.style.setProperty('--tvma-hero-y', y.toFixed(1) + 'px');
      stage.style.setProperty('--tvma-hero-p', (y / h).toFixed(3));
    });
  }, { capture: true, passive: true });

  // ---- 4. Timeline time bubble --------------------------------------------------------

  var bubbleQueued = false;
  function placeBubble() {
    bubbleQueued = false;
    var bubble = document.querySelector('.player .tvm-progress__bubble');
    if (!bubble) return;
    var track = bubble.parentElement;
    if (!track) return;
    var r = track.getBoundingClientRect();
    var pct = parseFloat(bubble.style.left) / 100;
    if (!isFinite(pct)) return;
    var centre = r.left + r.width * pct;
    var half = bubble.offsetWidth / 2;
    var margin = 12;
    var lo = margin + half;
    var hi = window.innerWidth - margin - half;
    var shift = Math.min(Math.max(centre, lo), hi) - centre;
    bubble.style.setProperty('--tvma-bubble-shift', shift.toFixed(1) + 'px');
  }
  function queueBubble() {
    if (bubbleQueued) return;
    bubbleQueued = true;
    requestAnimationFrame(placeBubble);
  }
  ['pointerdown', 'pointermove', 'pointerup', 'keydown'].forEach(function (type) {
    window.addEventListener(type, function (event) {
      var t = event.target;
      if (t && t.closest && t.closest('.player .tvm-progress')) queueBubble();
    }, { capture: true, passive: true });
  });

  // ---- 5. The tab pill over Search -----------------------------------------------------

  // Search opens as a layer over the current screen, which made that screen
  // (and its tab bar) inert. A copy of the bar is shown over Search; its
  // buttons close Search and then press the real tab, so every destination is
  // the interface's own.
  var pill = null;

  function realTab(id) {
    return document.querySelector('.app__screen:not([inert]) nav.ribbon--tabs [data-focus-id="' + id + '"]');
  }

  function closeSearchThen(id) {
    var close = document.querySelector('.search-pill [data-focus-id="close"]');
    if (close) close.click();
    var tries = 0;
    (function wait() {
      if (document.querySelector('.modal-layer[data-screen="search"]') && tries++ < 40) {
        requestAnimationFrame(wait);
        return;
      }
      var button = realTab(id);
      if (button) button.click();
    })();
  }

  function syncPill() {
    var search = document.querySelector('.modal-layer[data-screen="search"]');
    var source = document.querySelector('.app__screen nav.ribbon--tabs .ribbon__list--tabs');
    // Only touch the class when it changes: setting it at all is a mutation,
    // which would wake this observer again every frame.
    var open = !!(search && source);
    if (root.classList.contains('tvma-search-open') !== open) root.classList.toggle('tvma-search-open', open);
    if (!open) {
      if (pill) { pill.remove(); pill = null; }
      return;
    }
    if (pill) return;
    pill = document.createElement('nav');
    pill.className = 'ribbon ribbon--tabs tvma-pill';
    pill.setAttribute('aria-label', 'TVM');
    var frost = document.createElement('div');
    frost.className = 'ribbon__frost';
    frost.innerHTML = source.outerHTML;
    pill.appendChild(frost);
    var buttons = pill.querySelectorAll('[data-focus-id]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      var id = b.getAttribute('data-focus-id');
      b.classList.toggle('ribbon__icon--on', id === 'search');
      b.removeAttribute('data-focused');
      b.classList.remove('tvm-button--focused');
      b.setAttribute('data-tvma-tab', id);
      b.removeAttribute('data-focus-id');
      b.addEventListener('click', (function (tab) {
        return function (event) {
          event.preventDefault();
          if (tab === 'search') {
            var field = document.querySelector('.search-pill input');
            if (field) field.focus();
            return;
          }
          closeSearchThen(tab);
        };
      })(id));
    }
    document.body.appendChild(pill);
  }

  // ---- 6. Settings switches ----------------------------------------------------------

  var SWITCH_ROWS = { performance: true, 'auto-update': true };

  function mark(el, name, value) {
    if (value === null) {
      if (el.hasAttribute(name)) el.removeAttribute(name);
    } else if (el.getAttribute(name) !== value) {
      el.setAttribute(name, value);
    }
  }

  function syncSettings() {
    var rows = document.querySelectorAll('.settings-row[data-focus-id]');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var id = row.getAttribute('data-focus-id') || '';
      var detail = row.querySelector('.tvm-button__detail');
      var text = detail ? (detail.textContent || '').trim() : '';
      if (SWITCH_ROWS[id]) {
        var state = /^On\b/.test(text) ? 'on' : /^Off\b/.test(text) ? 'off' : null;
        mark(row, 'data-tvm-switch', state);
      }
      if (id.indexOf('theme-') === 0) mark(row, 'data-tvm-check', text === 'On' ? 'on' : null);
    }
  }

  // ---- Watching the page -------------------------------------------------------------

  // Only screen changes matter here, so only child lists are watched, and the
  // work is batched to one pass per frame. (Player time updates change text
  // every quarter second; they are not watched.)
  var queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      if (!root.classList.contains('tvm-android')) root.classList.add('tvm-android');
      syncPill();
      if (document.querySelector('.settings-row')) syncSettings();
    });
  }

  function watch() {
    if (typeof MutationObserver !== 'function') return;
    new MutationObserver(queue).observe(document.body || root, { subtree: true, childList: true });
    new MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ['class'] });
    // A settings row changes its text in place when tapped.
    document.addEventListener('click', function (event) {
      var t = event.target;
      if (t && t.closest && t.closest('.settings-row')) setTimeout(queue, 0);
    }, true);
    queue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
