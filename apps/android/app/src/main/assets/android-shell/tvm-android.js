/*
 * TVM on Android phones only: behaviour for tvm-android.css.
 *
 * Runs inside the Android shell's boot script (TvmShellScripts.androidOverlay),
 * after html.tvm-android has been set. It never moves, adds or removes the
 * interface's own elements and never stops its events: it only reads them and
 * sets attributes and CSS variables the stylesheet uses.
 *
 *   1. Rubber-band overscroll on vertical scrollers, iOS style.
 *   2. Switch state for settings rows that are on/off.
 *   3. Keeps html.tvm-android in place if the interface rewrites <html> classes.
 */
(function () {
  var root = document.documentElement;

  // ---- 1. Rubber-band overscroll ---------------------------------------------

  var SCROLLERS = '.page, .home, .details, .search-pill__panel';
  var SKIP = '.player, [data-player], input, textarea, select, [role="slider"], .tvm-progress, .ribbon, .ribbon-sheet';
  var SLOP = 8;
  /* iOS's constant: how quickly the pull stiffens. */
  var RESIST = 0.55;
  /* Spring back: critically damped, settles in a little under half a second. */
  var OMEGA = 15;
  var springs = typeof WeakMap === 'function' ? new WeakMap() : null;
  var gesture = null;

  function off() {
    var d = root.dataset;
    return d.motion === 'reduced' || d.perf === 'on' ||
      root.classList.contains('tvm-cinema') || root.classList.contains('tvm-ime-open') ||
      root.classList.contains('keyboard-open');
  }

  function maxScroll(el) {
    return Math.max(0, el.scrollHeight - el.clientHeight);
  }

  /* Distance pulled past the edge -> distance shown, stiffening as it grows. */
  function rubber(distance, size) {
    var sign = distance < 0 ? -1 : 1;
    var d = Math.abs(distance);
    return sign * (1 - 1 / ((d * RESIST) / size + 1)) * size;
  }

  function setOffset(el, px) {
    if (Math.abs(px) < 0.25) {
      el.style.removeProperty('--tvm-rubber');
      el.removeAttribute('data-tvm-rubber');
      return;
    }
    el.setAttribute('data-tvm-rubber', '');
    el.style.setProperty('--tvm-rubber', px.toFixed(2) + 'px');
  }

  function currentOffset(el) {
    var v = parseFloat(el.style.getPropertyValue('--tvm-rubber'));
    return isFinite(v) ? v : 0;
  }

  function stopSpring(el) {
    if (!springs) return;
    var s = springs.get(el);
    if (s) {
      s.stopped = true;
      springs.delete(el);
    }
  }

  /* x(t) = (x0 + (v0 + w x0) t) e^(-w t): no oscillation, no overshoot past rest. */
  function spring(el, x0, v0) {
    stopSpring(el);
    var state = { stopped: false };
    if (springs) springs.set(el, state);
    var start = performance.now();
    function frame(now) {
      if (state.stopped) return;
      var t = (now - start) / 1000;
      var x = (x0 + (v0 + OMEGA * x0) * t) * Math.exp(-OMEGA * t);
      if (t > 0.08 && Math.abs(x) < 0.3) {
        setOffset(el, 0);
        if (springs) springs.delete(el);
        return;
      }
      setOffset(el, x);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  window.addEventListener('pointerdown', function (event) {
    gesture = null;
    if (event.pointerType === 'mouse' || off()) return;
    var target = event.target;
    if (!target || !target.closest || target.closest(SKIP)) return;
    var el = target.closest(SCROLLERS);
    if (!el) return;
    gesture = {
      id: event.pointerId,
      el: el,
      x: event.clientX,
      y: event.clientY,
      top: el.scrollTop,
      axis: null,
      lastY: event.clientY,
      lastT: event.timeStamp,
      v: 0,
    };
  }, true);

  window.addEventListener('pointermove', function (event) {
    var g = gesture;
    if (!g || event.pointerId !== g.id) return;
    var dx = event.clientX - g.x;
    var dy = event.clientY - g.y;
    if (g.axis === null) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      g.axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
      if (g.axis !== 'y') {
        gesture = null;
        return;
      }
      // A new drag takes over from a bounce still settling.
      stopSpring(g.el);
    }
    var dt = event.timeStamp - g.lastT;
    if (dt > 0) g.v = (event.clientY - g.lastY) / dt;
    g.lastY = event.clientY;
    g.lastT = event.timeStamp;

    // Where the interface's own drag wants the page (it clamps at the edges).
    var desired = g.top - dy;
    var max = maxScroll(g.el);
    var over = 0;
    if (desired < 0) over = -desired;
    else if (desired > max) over = max - desired;
    // Measured against a capped height so a tall screen does not stretch further.
    var size = Math.max(160, Math.min(g.el.clientHeight, 600) * 0.6);
    setOffset(g.el, rubber(over, size));
  }, { passive: true, capture: true });

  function release(event) {
    var g = gesture;
    if (!g || event.pointerId !== g.id) return;
    gesture = null;
    var el = g.el;
    var offset = currentOffset(el);
    if (offset !== 0) {
      spring(el, offset, 0);
      return;
    }
    // A fling that will run into an edge: bounce when it gets there.
    if (g.axis !== 'y' || event.timeStamp - g.lastT > 80) return;
    var v = Math.max(-2, Math.min(2, g.v)); // px/ms, as the interface clamps it
    var predicted = el.scrollTop - v * 180;
    var max = maxScroll(el);
    var past = predicted < 0 ? -predicted : predicted > max ? max - predicted : 0;
    if (Math.abs(past) < 12) return;
    watchForEdge(el, past);
  }

  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', function (event) {
    var g = gesture;
    if (!g || event.pointerId !== g.id) return;
    gesture = null;
    if (currentOffset(g.el) !== 0) spring(g.el, currentOffset(g.el), 0);
  }, true);

  function watchForEdge(el, past) {
    var until = performance.now() + 900;
    var atTop = past > 0;
    function check() {
      if (gesture && gesture.el === el) return;
      var top = el.scrollTop;
      var hit = atTop ? top <= 0.5 : top >= maxScroll(el) - 0.5;
      if (hit) {
        // A small kick past the edge, scaled to how hard it was flung.
        var kick = Math.max(-900, Math.min(900, past * 7));
        spring(el, 0, kick);
        return;
      }
      if (performance.now() < until) requestAnimationFrame(check);
    }
    requestAnimationFrame(check);
  }

  // ---- 2. Settings switches ------------------------------------------------------

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
        // Only when the row says On or Off; otherwise it stays a plain row.
        var state = /^On\b/.test(text) ? 'on' : /^Off\b/.test(text) ? 'off' : null;
        mark(row, 'data-tvm-switch', state);
      }
      if (id.indexOf('theme-') === 0) mark(row, 'data-tvm-check', text === 'On' ? 'on' : null);
    }
  }

  // ---- 3. Watch the page ------------------------------------------------------------

  var queued = false;
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () {
      queued = false;
      if (!root.classList.contains('tvm-android')) root.classList.add('tvm-android');
      syncSettings();
    });
  }

  function watch() {
    if (typeof MutationObserver !== 'function') return;
    var observer = new MutationObserver(queue);
    observer.observe(document.body || root, { subtree: true, childList: true, characterData: true });
    new MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ['class'] });
    queue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
