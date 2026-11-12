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
    // At an edge a pull may follow: give the page's sections their own layers
    // now, while nothing moves, rather than on the pull's first frame (which
    // drew them blank for a frame: the flicker under the hero).
    if (!off() && (el.scrollTop <= 0.5 || el.scrollTop >= touch.max - 0.5)) el.setAttribute('data-tvma-prime', '');
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
    // An ordinary scroll away from the edge: the prepared layers are not needed.
    if (touch.edgeY === null && !atTop && !atBottom && el.hasAttribute('data-tvma-prime') && !el.hasAttribute('data-tvm-rubber')) el.removeAttribute('data-tvma-prime');
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
    else el.removeAttribute('data-tvma-prime');
  }
  window.addEventListener('touchend', release, true);
  window.addEventListener('touchcancel', release, true);

  /* At most about 26px however far the finger goes, and stiff from the start. */
  var LIMIT = 26;
  function rubber(distance) {
    return LIMIT * (1 - 1 / (distance / 170 + 1));
  }

  function setOffset(el, px) {
    if (Math.abs(px) < 0.25) {
      if (el.hasAttribute('data-tvm-rubber')) {
        el.removeAttribute('data-tvm-rubber');
        el.removeAttribute('data-tvma-pull');
        el.style.removeProperty('--tvm-rubber');
      }
      if (!touch || touch.el !== el) el.removeAttribute('data-tvma-prime');
      return;
    }
    // Whole device pixels: the page's sections move as one, with no hairline
    // seams between them on fractional offsets.
    var dpr = window.devicePixelRatio || 1;
    px = Math.round(px * dpr) / dpr;
    if (!el.hasAttribute('data-tvm-rubber')) el.setAttribute('data-tvm-rubber', '');
    // Pulled down from the top: the hero picture holds still at the top of the
    // screen (no gap above it, nothing stretched) while the page moves.
    if (px > 0) { if (!el.hasAttribute('data-tvma-pull')) el.setAttribute('data-tvma-pull', ''); }
    else if (el.hasAttribute('data-tvma-pull')) el.removeAttribute('data-tvma-pull');
    el.style.setProperty('--tvm-rubber', px + 'px');
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

  // ---- 5. One steady tab pill -----------------------------------------------------------

  // Each screen draws its own tab bar, and three things left the bar missing
  // or wrong: Search (a layer over the screen, which goes inert), and the
  // moment a tab is swapped in, while the interface checks the plan or loads
  // the screen's code (it showed "Checking your plan…" / "Opening…" full
  // screen, with no bar). A copy of the bar is shown at those moments, made
  // from the real one; over Search its buttons close Search and press the real
  // tab, so every destination is still the interface's own.
  var TABS = ['home-dock', 'search', 'live', 'watchlist', 'more'];
  var lastTab = 'home-dock';
  var pill = null;
  var pillSource = '';
  var pillMode = '';

  document.addEventListener('click', function (event) {
    var b = event.target && event.target.closest && event.target.closest('nav.ribbon--tabs [data-focus-id], nav.tvma-pill [data-tvma-tab]');
    if (!b) return;
    var id = b.getAttribute('data-focus-id') || b.getAttribute('data-tvma-tab');
    if (TABS.indexOf(id) >= 0 && id !== 'more') lastTab = id;
  }, true);

  function realTab(id) {
    return document.querySelector('.app__screen:not([inert]) nav.ribbon--tabs [data-focus-id="' + id + '"]');
  }

  function whenGone(selector, then) {
    var tries = 0;
    (function wait() {
      if (document.querySelector(selector) && tries++ < 60) { requestAnimationFrame(wait); return; }
      then();
    })();
  }

  function whenThere(selector, then) {
    var tries = 0;
    (function wait() {
      var el = document.querySelector(selector);
      if (!el && tries++ < 90) { requestAnimationFrame(wait); return; }
      if (el) then(el);
    })();
  }

  /** Leave Search, then press a real tab (and, for More's entries, the entry). */
  function closeSearchThen(id, moreEntry) {
    var close = document.querySelector('.search-pill [data-focus-id="close"]');
    if (close) close.click();
    whenGone('.modal-layer[data-screen="search"]', function () {
      var button = realTab(id);
      if (button) button.click();
      if (moreEntry) whenThere('[data-focus-id="' + moreEntry + '"]', function (row) { row.click(); });
    });
  }

  /** The screen on top is a placeholder (plan check or code loading), not a page. */
  function markPlaceholders() {
    var gates = document.querySelectorAll('.mobile-plan-gate');
    for (var i = 0; i < gates.length; i++) {
      var h = gates[i].querySelector('.page__heading');
      mark(gates[i], 'data-tvma-placeholder', h && /^Checking your plan/.test(h.textContent || '') ? '' : null);
    }
    var plates = document.querySelectorAll('.loading-state--plate');
    for (var j = 0; j < plates.length; j++) {
      mark(plates[j], 'data-tvma-placeholder', /Getting your screen ready/.test(plates[j].textContent || '') ? '' : null);
    }
  }

  function syncPill() {
    var source = document.querySelector('.app__screen nav.ribbon--tabs .ribbon__list--tabs');
    if (source) pillSource = source.outerHTML;
    var search = document.querySelector('.modal-layer[data-screen="search"]');
    var top = document.querySelector('.app__screen:not([inert])');
    var waiting = !!(top && !top.querySelector('nav.ribbon--tabs') && top.querySelector('[data-tvma-placeholder]'));
    var mode = search ? 'search' : waiting ? 'waiting' : '';
    var open = mode === 'search';
    if (root.classList.contains('tvma-search-open') !== open) root.classList.toggle('tvma-search-open', open);
    if (!pillSource) return;
    if (!pill) {
      pill = document.createElement('nav');
      pill.className = 'ribbon ribbon--tabs tvma-pill';
      pill.setAttribute('aria-label', 'TVM');
      var frost = document.createElement('div');
      frost.className = 'ribbon__frost';
      frost.innerHTML = pillSource;
      pill.appendChild(frost);
      var buttons = pill.querySelectorAll('[data-focus-id]');
      for (var i = 0; i < buttons.length; i++) {
        var b = buttons[i];
        var id = b.getAttribute('data-focus-id');
        b.removeAttribute('data-focused');
        b.classList.remove('tvm-button--focused');
        b.setAttribute('data-tvma-tab', id);
        b.removeAttribute('data-focus-id');
        b.addEventListener('click', (function (tab) {
          return function (event) {
            event.preventDefault();
            if (pillMode !== 'search') return;
            if (tab === 'search') {
              var field = document.querySelector('.search-pill input');
              if (field) { fieldTapped = performance.now(); field.focus(); }
              return;
            }
            closeSearchThen(tab);
          };
        })(id));
      }
      document.body.appendChild(pill);
    }
    if (mode === pillMode) return;
    pillMode = mode;
    pill.classList.toggle('tvma-pill--on', mode !== '');
    var active = mode === 'search' ? 'search' : lastTab;
    var tabs = pill.querySelectorAll('[data-tvma-tab]');
    for (var k = 0; k < tabs.length; k++) tabs[k].classList.toggle('ribbon__icon--on', tabs[k].getAttribute('data-tvma-tab') === active);
  }

  // ---- 6. Search: opens without the keyboard, with things to discover --------------------

  // The interface focuses the field when Search opens and again after a
  // recent search is chosen, which pops the keyboard up unasked. The keyboard
  // now appears only when the field itself is tapped.
  var fieldTapped = 0;
  document.addEventListener('pointerdown', function (event) {
    var t = event.target;
    if (t && t.closest && t.closest('.search-pill__field')) fieldTapped = performance.now();
  }, true);
  document.addEventListener('focusin', function (event) {
    var t = event.target;
    if (!t || !t.matches || !t.matches('.search-pill input')) return;
    if (root.classList.contains('tvma-keys') || performance.now() - fieldTapped < 1500) return;
    t.blur();
  }, true);
  document.addEventListener('input', function (event) {
    var t = event.target;
    if (!t || !t.matches || !t.matches('.search-pill input')) return;
    var typing = (t.value || '').trim() !== '';
    if (root.classList.contains('tvma-searching') !== typing) root.classList.toggle('tvma-searching', typing);
  }, true);

  // Discovery: rows from the same catalogue Home shows (its own titles for
  // them, nothing invented), and shortcuts to the app's own destinations.
  var discover = null;
  var homeRails = null;
  var homeAsked = false;

  function token() {
    try { return localStorage.getItem('tvm.account.token'); } catch (e) { return null; }
  }

  function loadRails() {
    if (homeAsked) return;
    homeAsked = true;
    var headers = {};
    var t = token();
    if (t) headers.Authorization = 'Bearer ' + t;
    fetch('/api/home', { headers: headers }).then(function (r) { return r.ok ? r.json() : null; }).then(function (body) {
      var rails = body && Array.isArray(body.rails) ? body.rails.filter(function (r) { return r && Array.isArray(r.items) && r.items.length > 0; }) : [];
      var pick = function (re) { for (var i = 0; i < rails.length; i++) if (re.test(rails[i].title)) return rails.splice(i, 1)[0]; return rails.shift(); };
      homeRails = [pick(/popular/i), pick(/trend/i)].filter(Boolean);
      if (discover && discover.parentNode) discover.parentNode.removeChild(discover);
      discover = null;
      queue();
    }).catch(function () { homeAsked = false; });
  }

  function openTitle(item) {
    var field = document.querySelector('.search-pill input');
    if (!field) return;
    // Exactly what typing the title does, then the matching result is opened.
    var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(field, item.title);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    var tries = 0;
    (function find() {
      var posters = document.querySelectorAll('.search-results .poster');
      for (var i = 0; i < posters.length; i++) {
        var t = posters[i].querySelector('.poster__title');
        if (t && t.textContent.trim().toLowerCase() === item.title.trim().toLowerCase()) { posters[i].click(); return; }
      }
      if (tries++ < 120) requestAnimationFrame(find);
    })();
  }



  function buildDiscover() {
    var wrap = document.createElement('section');
    wrap.className = 'tvma-discover';
    wrap.setAttribute('aria-label', 'Discover');
    (homeRails || []).forEach(function (rail) {
      var sec = document.createElement('div');
      sec.className = 'tvma-discover__section';
      var h = document.createElement('h2');
      h.className = 'tvma-discover__title';
      h.textContent = rail.title;
      var row = document.createElement('div');
      row.className = 'tvma-discover__row';
      rail.items.slice(0, 14).forEach(function (item) {
        if (!item || !item.title) return;
        var card = document.createElement('button');
        card.type = 'button';
        card.className = 'tvma-card';
        card.style.setProperty('--tvma-hue', String(item.hue || 220));
        if (item.poster) {
          var img = document.createElement('img');
          img.loading = 'lazy';
          img.decoding = 'async';
          img.referrerPolicy = 'no-referrer';
          img.alt = '';
          img.src = item.poster;
          img.onerror = function () { img.remove(); };
          card.appendChild(img);
        }
        var name = document.createElement('span');
        name.className = 'tvma-card__title';
        name.textContent = item.title;
        card.appendChild(name);
        card.addEventListener('click', function () { openTitle(item); });
        row.appendChild(card);
      });
      sec.appendChild(h);
      sec.appendChild(row);
      wrap.appendChild(sec);
    });
    return wrap;
  }

  function syncSearch() {
    var panel = document.querySelector('.search-pill__panel');
    if (!panel) {
      if (root.classList.contains('tvma-searching')) root.classList.remove('tvma-searching');
      return;
    }
    loadRails();
    if (!discover) discover = buildDiscover();
    if (discover.parentNode !== panel) panel.appendChild(discover);
  }

  // ---- 7. Settings switches, Details, the player's turn to landscape ---------------------

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

  function syncDetails() {
    var list = document.querySelectorAll('.details [data-focus-id="watchlist"]');
    for (var i = 0; i < list.length; i++) mark(list[i], 'data-tvma-saved', /^Remove/.test((list[i].textContent || '').trim()) ? '' : null);
    // A series has no Play of its own: this one opens the first episode the
    // same way a person would (the first season, then its first episode).
    var series = document.querySelectorAll('.details--series .details__actions');
    for (var k = 0; k < series.length; k++) {
      if (series[k].querySelector('.tvma-play')) continue;
      var play = document.createElement('button');
      play.type = 'button';
      play.className = 'tvm-button tvm-button--primary tvma-play';
      play.innerHTML = '<span class="tvm-button__label">Play</span>';
      play.addEventListener('click', function () {
        var ep = document.querySelector('.details .episode-item');
        if (ep) { ep.click(); return; }
        var first = document.querySelector('.details .season-row-btn');
        if (first) { first.click(); whenThere('.details .episode-item', function (e) { e.click(); }); }
      });
      series[k].insertBefore(play, series[k].firstChild);
    }
    // Details opens at the top, picture and all. (The interface scrolls the
    // button it focuses into view, which suits a remote, not a finger.)
    var pages = document.querySelectorAll('.details');
    for (var m = 0; m < pages.length; m++) {
      if (pages[m].hasAttribute('data-tvma-top')) continue;
      pages[m].setAttribute('data-tvma-top', '');
      (function (d) {
        var touched = false;
        d.addEventListener('pointerdown', function () { touched = true; }, { once: true });
        [0, 60, 200, 450].forEach(function (ms) {
          setTimeout(function () { if (!touched && !root.classList.contains('tvma-keys') && d.scrollTop > 0) d.scrollTop = 0; }, ms);
        });
      })(pages[m]);
    }
    var syn = document.querySelectorAll('.details .stage__synopsis');
    for (var j = 0; j < syn.length; j++) {
      if (!syn[j].hasAttribute('data-tvma-clamp')) {
        syn[j].setAttribute('data-tvma-clamp', '');
        syn[j].addEventListener('click', function () { this.classList.toggle('tvma-open'); });
      }
    }
  }

  // The phone turns to landscape as soon as the player screen opens, not when
  // the stream is ready, so a film never starts in a portrait loading screen.
  var shellIn = false;
  function shell(command) {
    try {
      if (window.tvmPlayer && typeof window.tvmPlayer.send === 'function') {
        window.tvmPlayer.send(JSON.stringify({ id: 'shell', command: command }));
      }
    } catch (e) { /* the home-Core path has no bridge */ }
  }
  function syncPlayer() {
    var open = !!document.querySelector('.modal-layer[data-screen="player"]');
    if (open !== shellIn) { shellIn = open; shell(open ? 'shell-enter' : 'shell-leave'); }
  }

  // ---- 8. Keyboard focus only for keyboards ----------------------------------------------

  // The interface draws a focus ring (and a slight zoom) on whatever was last
  // pressed, for television remotes. With a finger that ring flashed onto
  // every tap and stuck to the last-pressed control. It is shown only after a
  // key is used for navigation.
  document.addEventListener('keydown', function (event) {
    if (/^(Arrow|Tab$|PageUp|PageDown)/.test(event.key) && !root.classList.contains('tvma-keys')) root.classList.add('tvma-keys');
  }, true);
  document.addEventListener('pointerdown', function () {
    if (root.classList.contains('tvma-keys')) root.classList.remove('tvma-keys');
  }, true);

  // ---- 9. Screens open without a loading flash -------------------------------------------

  // Each screen's code is fetched the first time it opens, which showed a
  // full-screen "Opening…" page. The main screens' code is fetched once the
  // app is idle after starting.
  var KEEP = /^(Details|LiveTV|Watchlist|SearchModal|Settings|Account|Apps|Library|Player|Profiles|Live)/;
  function preload() {
    var main = document.querySelector('script[type="module"][src]');
    if (!main || !window.fetch) return;
    var base = main.src;
    fetch(base).then(function (r) { return r.text(); }).then(function (text) {
      var seen = {};
      text.replace(/"\.\/([A-Za-z0-9_.-]+\.js)"/g, function (_, file) {
        if (seen[file] || !KEEP.test(file)) return '';
        seen[file] = true;
        var link = document.createElement('link');
        link.rel = 'modulepreload';
        link.href = new URL('./' + file, base).href;
        document.head.appendChild(link);
        return '';
      });
    }).catch(function () {});
  }
  window.addEventListener('load', function () { setTimeout(preload, 2500); });

  // ---- 10. Placeholders that look alive, cheaply --------------------------------------

  // Only the placeholders actually on screen pulse (a handful, opacity only);
  // the dozens below the fold stay still, so waiting costs nothing.
  var skSeen = typeof IntersectionObserver === 'function' ? new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) entries[i].target.classList.toggle('tvma-sk-on', entries[i].isIntersecting);
  }) : null;
  function syncSkeletons() {
    if (!skSeen) return;
    var fresh = document.querySelectorAll('.skeleton:not([data-tvma-sk])');
    for (var i = 0; i < fresh.length; i++) { fresh[i].setAttribute('data-tvma-sk', ''); skSeen.observe(fresh[i]); }
  }

  // ---- 11. Shared helpers for the sections below -------------------------------------

  /** Press one of the interface's own buttons, without the overlay's interceptions. */
  var bypass = false;
  function press(el) {
    bypass = true;
    try { el.click(); } finally { bypass = false; }
  }
  function pressWhenThere(selector, then) {
    whenThere(selector, function (el) { press(el); if (then) then(el); });
  }
  function authHeaders(json) {
    var h = {};
    var t = token();
    if (t) h.Authorization = 'Bearer ' + t;
    if (json) h['content-type'] = 'application/json';
    return h;
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  /** Keep a scroller at one position while the interface settles (focus reveals, re-renders). */
  function pin(scroller, value, ms) {
    if (!scroller) return;
    var until = performance.now() + ms;
    var touched = false;
    var hold = function () {
      if (touched || performance.now() > until) { scroller.removeEventListener('scroll', hold); return; }
      if (Math.abs(scroller.scrollTop - value) > 1) scroller.scrollTop = value;
    };
    scroller.addEventListener('pointerdown', function () { touched = true; }, { once: true });
    scroller.addEventListener('scroll', hold);
    hold();
    requestAnimationFrame(hold);
    [60, 160, 320].forEach(function (ms2) { setTimeout(hold, ms2); });
  }

  /** Android Back (MainActivity) asks here first: an open sheet or popup closes. */
  var backHandlers = [];
  window.tvmaBack = function () {
    for (var i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return true;
    var scrim = document.querySelector('.app__screen:not([inert]) .ribbon-sheet__scrim');
    if (scrim) { press(scrim); return true; }
    return false;
  };

  // Programmatic hops through the interface's own routes (Settings → Profiles,
  // More → Apps) happen under a veil so the screens in between are not seen.
  function veil(on) {
    root.classList.toggle('tvma-routing', on);
    if (on) setTimeout(function () { root.classList.remove('tvma-routing'); }, 2500);
  }

  // ---- 12. You: the active profile in the bar -------------------------------------------

  var registry = null;
  var me = null;
  var meAsked = 0;
  function avatarOf(id) {
    try { return localStorage.getItem('tvma.avatar.' + id); } catch (e) { return null; }
  }
  function setAvatar(id, data) {
    try {
      if (data) localStorage.setItem('tvma.avatar.' + id, data);
      else localStorage.removeItem('tvma.avatar.' + id);
    } catch (e) { /* storage full or blocked: the coloured initial stays */ }
  }
  function loadProfiles(force, then) {
    var now = Date.now();
    if (!force && now - meAsked < 20000) { if (then) then(registry); return; }
    meAsked = now;
    fetch('/api/profiles', { headers: authHeaders() }).then(function (r) { return r.ok ? r.json() : null; }).then(function (reg) {
      if (reg && Array.isArray(reg.profiles)) {
        registry = reg;
        me = reg.profiles.filter(function (p) { return p.id === reg.activeId; })[0] || reg.profiles[0] || null;
        youKey = '';
        queue();
      }
      if (then) then(registry);
    }).catch(function () { if (then) then(registry); });
  }
  /** A profile's picture, or its initial on its own colour. */
  function paintAvatar(node, profile) {
    var pic = profile ? avatarOf(profile.id) : null;
    node.classList.add('tvma-av');
    node.style.setProperty('--tvma-av-hue', String(profile ? profile.hue : 215));
    if (pic) {
      node.style.backgroundImage = 'url("' + pic + '")';
      node.textContent = '';
      node.classList.add('tvma-av--pic');
    } else {
      node.style.backgroundImage = '';
      node.classList.remove('tvma-av--pic');
      node.textContent = profile && profile.name ? profile.name.trim().charAt(0).toUpperCase() : '';
    }
  }
  var youKey = '';
  function syncYou() {
    var key = me ? me.id + ':' + me.name + ':' + (avatarOf(me.id) || '').length : '';
    var buttons = document.querySelectorAll('nav.ribbon--tabs [data-focus-id="more"], nav.tvma-pill [data-tvma-tab="more"]');
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i];
      if (b.getAttribute('data-tvma-you') === key) continue;
      b.setAttribute('data-tvma-you', key);
      b.setAttribute('aria-label', 'You');
      var label = b.querySelector('.ribbon__label');
      if (label && label.textContent !== 'You') label.textContent = 'You';
      var holder = b.querySelector('.ribbon__avatar');
      if (!holder) continue;
      var face = holder.querySelector('.tvma-av');
      if (!face) { face = el('span'); holder.appendChild(face); }
      paintAvatar(face, me);
    }
    youKey = key;
    // The popup: Profile and Settings only.
    var row = document.querySelector('.ribbon-sheet [data-focus-id="more-profile"]');
    if (row && !row.hasAttribute('data-tvma-row')) {
      row.setAttribute('data-tvma-row', 'profile');
      var strong = row.querySelector('strong');
      var sub = row.querySelector('.ribbon-sheet__text > span');
      if (strong) strong.textContent = 'Profile';
      if (sub) sub.textContent = 'Switch, add and edit profiles';
      var glyph = row.querySelector('.ribbon-sheet__glyph');
      if (glyph && me) { glyph.innerHTML = ''; var f = el('span'); glyph.appendChild(f); paintAvatar(f, me); }
    }
    var set = document.querySelector('.ribbon-sheet [data-focus-id="more-settings"]');
    if (set && !set.hasAttribute('data-tvma-row')) {
      set.setAttribute('data-tvma-row', 'settings');
      var s2 = set.querySelector('.ribbon-sheet__text > span');
      if (s2) s2.textContent = 'Display, language, account and updates';
    }
  }

  /** Profile in the popup: the profile chooser, reached the way Settings reaches it. */
  var profilesViaPopup = false;
  function openProfiles() {
    profilesViaPopup = !mainSettings();
    veil(true);
    settingsFresh = true;
    var sheetSettings = document.querySelector('.ribbon-sheet [data-focus-id="more-settings"]');
    var go = function () {
      pressWhenThere('.app__screen:not([inert]) .page--settings [data-focus-id="profiles"]', function () {
        whenThere('.app__screen:not([inert]) .page--profiles', function () { veil(false); });
      });
    };
    if (sheetSettings) { press(sheetSettings); go(); return; }
    var settingsRow = document.querySelector('.app__screen:not([inert]) .page--settings [data-focus-id="profiles"]');
    if (settingsRow) { press(settingsRow); whenThere('.app__screen:not([inert]) .page--profiles', function () { veil(false); }); return; }
    veil(false);
  }

  /** Account and Apps live in Settings now; they open through the old More entries. */
  function openViaMore(entry) {
    var tab = realTab('more');
    if (!tab) return;
    veil(true);
    press(tab);
    pressWhenThere('.ribbon-sheet [data-focus-id="' + entry + '"]', function () {
      whenGone('.ribbon-sheet', function () { requestAnimationFrame(function () { veil(false); }); });
    });
  }

  // ---- 13. Settings: language, Account and Apps rows, where the page opens ----------------

  var LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'], ['ja', '日本語'], ['ko', '한국어'], ['zh', '中文']];

  function sheet(title, build) {
    var wrap = el('div', 'tvma-sheet');
    var scrim = el('button', 'tvma-sheet__scrim');
    scrim.type = 'button';
    scrim.setAttribute('aria-label', 'Close');
    var panel = el('div', 'tvma-sheet__panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', title);
    panel.appendChild(el('span', 'tvma-sheet__grip'));
    if (title) panel.appendChild(el('h2', 'tvma-sheet__title', title));
    var close = function () {
      if (!wrap.parentNode) return false;
      wrap.classList.add('tvma-sheet--out');
      backHandlers = backHandlers.filter(function (h) { return h !== close; });
      setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 200);
      return true;
    };
    scrim.addEventListener('click', close);
    build(panel, close);
    wrap.appendChild(scrim);
    wrap.appendChild(panel);
    document.body.appendChild(wrap);
    backHandlers.push(close);
    return close;
  }

  function openLanguages(row) {
    var detail = row.querySelector('.tvm-button__detail');
    var currentName = detail ? detail.textContent.trim() : 'English';
    var current = 0;
    LANGS.forEach(function (l, i) { if (l[1] === currentName) current = i; });
    sheet('App language', function (panel, close) {
      var list = el('div', 'tvma-sheet__list');
      LANGS.forEach(function (l, i) {
        var b = el('button', 'tvma-choice' + (i === current ? ' tvma-choice--on' : ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', i === current ? 'true' : 'false');
        b.appendChild(el('span', 'tvma-choice__name', l[1]));
        b.addEventListener('click', function () {
          close();
          // The interface changes language one step at a time; the steps run
          // behind the closing sheet, with the page held where it is.
          var steps = (i - current + LANGS.length) % LANGS.length;
          var page = row.closest('.page--settings');
          var top = page ? page.scrollTop : 0;
          (function step(n) {
            if (n <= 0) { pin(page, top, 500); return; }
            var live = document.querySelector('.app__screen:not([inert]) .page--settings [data-focus-id="language"]');
            if (!live) return;
            press(live);
            if (page) page.scrollTop = top;
            requestAnimationFrame(function () { requestAnimationFrame(function () { if (page) page.scrollTop = top; step(n - 1); }); });
          })(steps);
        });
        list.appendChild(b);
      });
      panel.appendChild(list);
    });
  }

  var settingsFresh = false;
  var settingsMain = null;
  var settingsMainTop = false;
  var settingsSaved = 0;

  function mainSettings() {
    var lang = document.querySelector('.page--settings [data-focus-id="language"]');
    return lang ? lang.closest('.page--settings') : null;
  }

  /** Runs before paint (from the observer): the page never shows at the wrong place. */
  function syncSettingsScroll() {
    var page = mainSettings();
    if (!page) { settingsMain = null; settingsMainTop = false; return; }
    var top = !!page.closest('.app__screen:not([inert])');
    if (page !== settingsMain) {
      // The interface builds Settings afresh each time it is shown: from the
      // You popup it starts at the top; back from one of its pages, where it was.
      settingsMain = page;
      settingsMainTop = top;
      if (top) {
        var at = settingsFresh ? 0 : settingsSaved;
        if (settingsFresh) settingsSaved = 0;
        pin(page, at, 700);
        settingsFresh = false;
      }
      return;
    }
    if (top && !settingsMainTop) pin(page, settingsFresh ? 0 : settingsSaved, 600);
    if (top) settingsFresh = false;
    settingsMainTop = top;
  }

  function settingsRow(cls, title, detail, onTap) {
    var b = el('button', cls);
    b.type = 'button';
    var label = el('span', 'tvm-button__label', title);
    b.appendChild(label);
    b.appendChild(el('span', 'tvm-button__detail', detail));
    b.addEventListener('click', onTap);
    return b;
  }

  function syncSettingsExtras() {
    var page = mainSettings();
    if (!page) return;
    var anchor = page.querySelector('[data-focus-id="profiles"]');
    if (anchor && !page.querySelector('[data-tvma-row="account"]')) {
      var cls = anchor.className.replace(/\s*tvm-button--focused/g, '');
      var acc = settingsRow(cls, 'Account', 'Sign-in, access and signing out', function () { settingsSaved = page.scrollTop; openViaMore('more-profile'); });
      acc.setAttribute('data-tvma-row', 'account');
      anchor.parentNode.insertBefore(acc, anchor.nextSibling);
      var apps = settingsRow(cls, 'Apps', 'Studios and services', function () { settingsSaved = page.scrollTop; openViaMore('more-apps'); });
      apps.setAttribute('data-tvma-row', 'apps');
      acc.parentNode.insertBefore(apps, acc.nextSibling);
    }
    if (!page.querySelector('.tvma-about') && coreLine) {
      var about = el('p', 'tvma-about', coreLine);
      page.appendChild(about);
    }
  }

  // The core's version moves from every sub-page header to the foot of Settings.
  var coreLine = '';
  fetch('/api/health').then(function (r) { return r.ok ? r.json() : null; }).then(function (h) {
    if (h && h.version) { coreLine = 'TVM Core ' + h.version; queue(); }
  }).catch(function () {});

  function syncTopbars() {
    var backs = document.querySelectorAll('.topbar [data-focus-id="top-back"]:not([aria-label])');
    for (var i = 0; i < backs.length; i++) backs[i].setAttribute('aria-label', 'Back');
  }

  document.addEventListener('click', function (event) {
    if (bypass) return;
    var t = event.target && event.target.closest && event.target.closest('[data-focus-id]');
    if (!t) return;
    var id = t.getAttribute('data-focus-id');
    if (id === 'more-profile' && t.closest('.ribbon-sheet')) {
      event.preventDefault(); event.stopImmediatePropagation();
      openProfiles();
    } else if (id === 'language' && t.closest('.page--settings')) {
      event.preventDefault(); event.stopImmediatePropagation();
      openLanguages(t);
    } else if (id === 'more-settings') {
      settingsFresh = true;
      settingsSaved = 0;
      var already = mainSettings();
      if (already && already.closest('.app__screen:not([inert])')) {
        settingsFresh = false;
        already.scrollTo({ top: 0, behavior: off() ? 'auto' : 'smooth' });
      }
    } else if (t.classList.contains('settings-row') && t.closest('.page--settings') === mainSettings()) {
      settingsSaved = mainSettings().scrollTop;
    }
  }, true);

  // ---- 14. Profiles: choose, add and edit, with pictures ---------------------------------

  var who = null;
  var whoEditing = false;

  function reactTile(id) {
    if (!registry) return null;
    var idx = -1;
    registry.profiles.forEach(function (p, i) { if (p.id === id) idx = i; });
    if (idx < 0) return null;
    return document.querySelector('.page--profiles [data-focus-id="' + (idx === 0 ? 'profile-pick' : 'profile-' + id) + '"]');
  }

  function renderWho() {
    if (!who) return;
    var page = who.parentNode;
    var canBack = !!page.querySelector('[data-focus-id="profiles-back"]');
    var canAdd = !!page.querySelector('[data-focus-id="profile-add"]');
    var profiles = registry ? registry.profiles : [];
    who.innerHTML = '';
    var bar = el('div', 'tvma-who__bar');
    var back = el('button', 'tvma-icon-btn tvma-icon-btn--back');
    back.type = 'button';
    back.setAttribute('aria-label', 'Back');
    back.style.visibility = canBack ? '' : 'hidden';
    back.addEventListener('click', function () {
      var b = page.querySelector('[data-focus-id="profiles-back"]');
      if (b) press(b);
    });
    var edit = el('button', 'tvma-text-btn', whoEditing ? 'Done' : 'Edit Profiles');
    edit.type = 'button';
    edit.addEventListener('click', function () { whoEditing = !whoEditing; renderWho(); });
    bar.appendChild(back);
    bar.appendChild(edit);
    who.appendChild(bar);
    who.appendChild(el('h1', 'tvma-who__title', "Who's watching?"));
    var grid = el('div', 'tvma-who__grid' + (whoEditing ? ' tvma-who__grid--edit' : ''));
    profiles.forEach(function (p) {
      var tile = el('button', 'tvma-who__tile' + (registry && p.id === registry.activeId ? ' tvma-who__tile--on' : ''));
      tile.type = 'button';
      var face = el('span', 'tvma-who__face');
      paintAvatar(face, p);
      if (whoEditing) face.appendChild(el('span', 'tvma-who__pencil'));
      tile.appendChild(face);
      tile.appendChild(el('span', 'tvma-who__name', p.name));
      tile.addEventListener('click', function () {
        if (whoEditing) { editProfile(p); return; }
        var btn = reactTile(p.id);
        if (btn) { press(btn); setTimeout(function () { loadProfiles(true); }, 400); }
      });
      grid.appendChild(tile);
    });
    if (canAdd && !whoEditing) {
      var add = el('button', 'tvma-who__tile tvma-who__tile--add');
      add.type = 'button';
      add.appendChild(el('span', 'tvma-who__face tvma-who__face--add'));
      add.appendChild(el('span', 'tvma-who__name', 'Add Profile'));
      add.addEventListener('click', function () { editProfile(null); });
      grid.appendChild(add);
    }
    who.appendChild(grid);
  }

  function syncWho() {
    var page = document.querySelector('.app__screen:not([inert]) .page--profiles');
    if (!page) {
      if (who) {
        who = null;
        whoEditing = false;
        loadProfiles(true);
        // Reached through Settings on the way: step back past it too.
        if (profilesViaPopup) {
          profilesViaPopup = false;
          var settings = mainSettings();
          if (settings && settings.closest('.app__screen:not([inert])')) {
            veil(true);
            window.dispatchEvent(new Event('tvm:navigate-back'));
            whenGone('.app__screen:not([inert]) .page--settings [data-focus-id="language"]', function () { requestAnimationFrame(function () { veil(false); }); });
          }
        }
      }
      return;
    }
    if (who && who.parentNode === page) return;
    who = el('section', 'tvma-who');
    page.appendChild(who);
    page.classList.add('tvma-who-page');
    loadProfiles(true, function () { renderWho(); });
    renderWho();
  }

  /** Read a chosen picture small (memory), then let the person frame it. */
  function choosePicture(done) {
    var input = el('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      var opts = { resizeWidth: 1200, resizeQuality: 'medium' };
      createImageBitmap(file).then(function (probe) {
        // Scale on decode so a 50-megapixel photo never sits in memory full size.
        var long = Math.max(probe.width, probe.height);
        var portrait = probe.height > probe.width;
        probe.close();
        if (long <= 1200) return createImageBitmap(file);
        return createImageBitmap(file, portrait ? { resizeHeight: 1200, resizeQuality: 'medium' } : opts);
      }).then(function (bitmap) { cropPicture(bitmap, done); })
        .catch(function () { toast('That picture could not be opened. Try another one.'); });
    });
    document.body.appendChild(input);
    input.click();
  }

  function cropPicture(bitmap, done) {
    var size = 280;
    var scaleMin = size / Math.min(bitmap.width, bitmap.height);
    var zoom = 1;
    var x = 0;
    var y = 0;
    sheet('Move and scale', function (panel, close) {
      var frame = el('div', 'tvma-crop');
      var canvas = el('canvas', 'tvma-crop__canvas');
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      var ctx = canvas.getContext('2d');
      var clamp = function () {
        var s = scaleMin * zoom;
        var maxX = Math.max(0, (bitmap.width * s - size) / 2);
        var maxY = Math.max(0, (bitmap.height * s - size) / 2);
        x = Math.max(-maxX, Math.min(maxX, x));
        y = Math.max(-maxY, Math.min(maxY, y));
      };
      var draw = function () {
        clamp();
        var s = scaleMin * zoom;
        var w = bitmap.width * s;
        var h = bitmap.height * s;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(bitmap, (size - w) / 2 + x, (size - h) / 2 + y, w, h);
      };
      var last = null;
      canvas.addEventListener('pointerdown', function (e) { last = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
      canvas.addEventListener('pointermove', function (e) {
        if (!last) return;
        x += e.clientX - last[0];
        y += e.clientY - last[1];
        last = [e.clientX, e.clientY];
        draw();
      });
      canvas.addEventListener('pointerup', function () { last = null; });
      canvas.addEventListener('pointercancel', function () { last = null; });
      frame.appendChild(canvas);
      panel.appendChild(frame);
      var slider = el('input', 'tvma-crop__zoom');
      slider.type = 'range';
      slider.min = '1';
      slider.max = '4';
      slider.step = '0.01';
      slider.value = '1';
      slider.setAttribute('aria-label', 'Zoom');
      slider.addEventListener('input', function () { zoom = parseFloat(slider.value) || 1; draw(); });
      panel.appendChild(slider);
      var actions = el('div', 'tvma-actions');
      var cancel = el('button', 'tvma-btn', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { bitmap.close(); close(); });
      var use = el('button', 'tvma-btn tvma-btn--primary', 'Use Picture');
      use.type = 'button';
      use.addEventListener('click', function () {
        // A 320-pixel square JPEG: sharp in every place it is shown, about 30 KB.
        var out = document.createElement('canvas');
        out.width = 320;
        out.height = 320;
        var o = out.getContext('2d');
        var s = scaleMin * zoom * (320 / size);
        var w = bitmap.width * s;
        var h = bitmap.height * s;
        o.drawImage(bitmap, (320 - w) / 2 + x * (320 / size), (320 - h) / 2 + y * (320 / size), w, h);
        bitmap.close();
        close();
        done(out.toDataURL('image/jpeg', 0.86));
      });
      actions.appendChild(cancel);
      actions.appendChild(use);
      panel.appendChild(actions);
      draw();
    });
  }

  function toast(text) {
    var t = el('div', 'tvma-toast', text);
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('tvma-toast--out'); }, 2600);
    setTimeout(function () { t.remove(); }, 3000);
  }

  /** Edit a profile (or, with null, create one): name and picture, Save or Cancel. */
  function editProfile(profile) {
    var creating = profile === null;
    var picture = creating ? null : avatarOf(profile.id);
    var pictureChanged = false;
    var hue = creating ? 215 : profile.hue;
    sheet(creating ? 'New Profile' : 'Edit Profile', function (panel, close) {
      var head = el('div', 'tvma-edit__head');
      var face = el('button', 'tvma-edit__face');
      face.type = 'button';
      face.setAttribute('aria-label', 'Change picture');
      var paint = function () { paintAvatar(face, { id: '__preview', hue: hue, name: field.value || (profile ? profile.name : '') }); if (picture) { face.style.backgroundImage = 'url("' + picture + '")'; face.textContent = ''; face.classList.add('tvma-av--pic'); } };
      var pick = el('button', 'tvma-text-btn', 'Choose Picture');
      pick.type = 'button';
      var onPick = function () { choosePicture(function (data) { picture = data; pictureChanged = true; paint(); syncRemove(); }); };
      face.addEventListener('click', onPick);
      pick.addEventListener('click', onPick);
      var remove = el('button', 'tvma-text-btn tvma-text-btn--quiet', 'Remove Picture');
      remove.type = 'button';
      var syncRemove = function () { remove.style.display = picture ? '' : 'none'; };
      remove.addEventListener('click', function () { picture = null; pictureChanged = true; paint(); syncRemove(); });
      var links = el('div', 'tvma-edit__links');
      links.appendChild(pick);
      links.appendChild(remove);
      head.appendChild(face);
      head.appendChild(links);
      panel.appendChild(head);
      var label = el('label', 'tvma-field');
      label.appendChild(el('span', 'tvma-field__label', 'Name'));
      var field = el('input', 'tvma-field__input');
      field.type = 'text';
      field.maxLength = 24;
      field.autocomplete = 'off';
      field.value = creating ? '' : profile.name;
      field.placeholder = 'Profile name';
      field.addEventListener('input', paint);
      label.appendChild(field);
      panel.appendChild(label);
      var error = el('p', 'tvma-edit__error');
      panel.appendChild(error);
      var actions = el('div', 'tvma-actions');
      var cancel = el('button', 'tvma-btn', 'Cancel');
      cancel.type = 'button';
      cancel.addEventListener('click', close);
      var save = el('button', 'tvma-btn tvma-btn--primary', 'Save');
      save.type = 'button';
      save.addEventListener('click', function () {
        var name = field.value.trim();
        if (name === '') { error.textContent = 'Give the profile a name.'; field.focus(); return; }
        save.disabled = true;
        if (creating) { close(); createProfile(name, picture); return; }
        var work = name !== profile.name
          ? fetch('/api/profiles', { method: 'PUT', headers: authHeaders(true), body: JSON.stringify({ id: profile.id, name: name }) }).then(function (r) { if (!r.ok) throw new Error(); })
          : Promise.resolve();
        work.then(function () {
          if (pictureChanged) setAvatar(profile.id, picture);
          close();
          loadProfiles(true, function () { renderWho(); });
        }).catch(function () { save.disabled = false; error.textContent = 'The profile could not be saved. Try again.'; });
      });
      actions.appendChild(cancel);
      actions.appendChild(save);
      panel.appendChild(actions);
      var removeBtn = !creating && document.querySelector('.page--profiles [data-focus-id="remove-' + profile.id + '"]');
      if (removeBtn) {
        var del = el('button', 'tvma-text-btn tvma-text-btn--danger', 'Delete Profile');
        del.type = 'button';
        del.addEventListener('click', function () {
          if (del.getAttribute('data-confirm') !== 'yes') {
            del.setAttribute('data-confirm', 'yes');
            del.textContent = 'Delete ' + profile.name + ' and its watch history?';
            return;
          }
          close();
          press(removeBtn);
          setAvatar(profile.id, null);
          setTimeout(function () { loadProfiles(true, function () { renderWho(); }); }, 300);
        });
        panel.appendChild(del);
      }
      paint();
      syncRemove();
    });
  }

  /** New profiles go through the interface's own form, so its limits and switching apply. */
  function createProfile(name, picture) {
    var before = registry ? registry.profiles.map(function (p) { return p.id; }) : [];
    pressWhenThere('.page--profiles [data-focus-id="profile-add"]', function () {
      whenThere('.page--profiles input[data-focus-id="profile-name"]', function (input) {
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, name);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        pressWhenThere('.page--profiles [data-focus-id="profile-save"]', function () {
          setTimeout(function () {
            loadProfiles(true, function (reg) {
              if (!reg) return;
              var made = reg.profiles.filter(function (p) { return before.indexOf(p.id) < 0; })[0];
              if (made && picture) { setAvatar(made.id, picture); youKey = ''; queue(); }
              if (!made) {
                var msg = document.querySelector('.page--profiles .page__message');
                if (msg) toast(msg.textContent);
              }
              renderWho();
            });
          }, 350);
        });
      });
    });
  }

  // ---- 15. Search: titles only, one each -----------------------------------------------

  // The catalogue search can return single episodes (files in the person's
  // library). Search shows films and whole series, once each; a series opens
  // its page, where every season and episode is.
  if (window.fetch && !window.fetch.tvma) {
    var baseFetch = window.fetch.bind(window);
    var tidy = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url;
      var p = baseFetch(input, init);
      if (!url || url.indexOf('/api/search?') < 0) return p;
      return p.then(function (res) {
        if (!res.ok) return res;
        return res.clone().json().then(function (body) {
          if (!body || !Array.isArray(body.items)) return res;
          var seen = {};
          var items = body.items.filter(function (it) {
            if (!it) return false;
            var episode = it.episode !== undefined && it.episode !== null || it.episodeName || /\bS\d{1,2}E\d{1,3}\b/i.test(it.title || '');
            if (episode) return false;
            var key = it.id || ((it.title || '').toLowerCase() + '|' + (it.year || ''));
            var key2 = (it.title || '').toLowerCase().trim() + '|' + (it.year || '') + '|' + (it.kind === 'series' ? 's' : 'm');
            if (seen[key] || seen[key2]) return false;
            seen[key] = seen[key2] = true;
            return true;
          });
          return new Response(JSON.stringify(Object.assign({}, body, { items: items })), { status: res.status, statusText: res.statusText, headers: res.headers });
        }).catch(function () { return res; });
      });
    };
    tidy.tvma = true;
    window.fetch = tidy;
  }

  function syncSearchChrome() {
    var status = document.querySelector('.search-pill__status');
    if (status) mark(status, 'data-tvma-hint', /paste a hoster link|search films, series/i.test(status.textContent || '') ? '' : null);
  }

  // ---- 16. Home: plain section names --------------------------------------------------

  function syncHomeTitles() {
    var titles = document.querySelectorAll('.home .rail__title, .home .shelf__title');
    for (var i = 0; i < titles.length; i++) {
      var t = titles[i];
      if (t.hasAttribute('data-tvma-title')) continue;
      t.setAttribute('data-tvma-title', '');
      // "TVM Stream · Continue watching" → "Continue Watching"
      var walker = document.createTreeWalker(t, NodeFilter.SHOW_TEXT);
      var node;
      while ((node = walker.nextNode())) {
        var text = node.nodeValue;
        var cleaned = text.replace(/^\s*TVM(?:\s+Stream)?\s*[·•|:-]\s*/i, '').replace(/^Continue watching$/i, 'Continue Watching');
        if (cleaned !== text) node.nodeValue = cleaned;
      }
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
      markPlaceholders();
      syncPill();
      syncSearch();
      syncPlayer();
      syncSkeletons();
      syncYou();
      syncWho();
      syncSettingsExtras();
      syncTopbars();
      syncSearchChrome();
      if (document.querySelector('.home')) syncHomeTitles();
      if (document.querySelector('.settings-row')) syncSettings();
      if (document.querySelector('.details')) syncDetails();
    });
  }

  function watch() {
    if (typeof MutationObserver !== 'function') return;
    // Placeholders and the bar are settled in the observer itself (before the
    // frame is painted), so a placeholder is never drawn for even one frame.
    new MutationObserver(function () { markPlaceholders(); syncPill(); syncSettingsScroll(); queue(); }).observe(document.body || root, { subtree: true, childList: true, characterData: false });
    new MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ['class'] });
    // Rows and headings change their text in place when tapped or loaded.
    document.addEventListener('click', function () { setTimeout(queue, 0); }, true);
    // A reload (an interface update) while the player was open must not leave
    // the phone in landscape.
    shell('shell-leave');
    loadProfiles(true);
    queue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
