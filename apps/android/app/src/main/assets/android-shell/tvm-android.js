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

  /* At most about 26px however far the finger goes, and stiff from the start. */
  var LIMIT = 26;
  function rubber(distance) {
    return LIMIT * (1 - 1 / (distance / 170 + 1));
  }

  function setOffset(el, px) {
    // Home's hero stretches into a pull from the top rather than sliding
    // down and leaving a gap above it.
    var stage = px > 0 && el.classList.contains('home') ? el.querySelector('.stage--home') : null;
    if (Math.abs(px) < 0.25) {
      if (el.hasAttribute('data-tvm-rubber')) {
        el.removeAttribute('data-tvm-rubber');
        el.style.removeProperty('--tvm-rubber');
        var s = el.querySelector('.stage--home');
        if (s) s.style.removeProperty('--tvma-pull-scale');
      }
      return;
    }
    if (!el.hasAttribute('data-tvm-rubber')) el.setAttribute('data-tvm-rubber', '');
    el.style.setProperty('--tvm-rubber', px.toFixed(1) + 'px');
    if (stage) stage.style.setProperty('--tvma-pull-scale', (1 + px / Math.max(200, stage.offsetHeight)).toFixed(4));
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

  var EXPLORE = [
    { label: 'TVM Stream', sub: 'Films and series', tone: 'stream', go: function () { closeSearchThen('more', 'more-library'); } },
    { label: 'Live TV', sub: 'Channels and guide', tone: 'live', go: function () { closeSearchThen('live'); } },
    { label: 'Watchlist', sub: 'Saved for later', tone: 'list', go: function () { closeSearchThen('watchlist'); } },
    { label: 'Apps', sub: 'Studios and services', tone: 'apps', go: function () { closeSearchThen('more', 'more-apps'); } },
  ];

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
    var ex = document.createElement('div');
    ex.className = 'tvma-discover__section';
    ex.innerHTML = '<h2 class="tvma-discover__title">Explore</h2><div class="tvma-explore"></div>';
    EXPLORE.forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'tvma-explore__tile tvma-explore__tile--' + e.tone;
      b.innerHTML = '<strong></strong><span></span>';
      b.querySelector('strong').textContent = e.label;
      b.querySelector('span').textContent = e.sub;
      b.addEventListener('click', e.go);
      ex.querySelector('.tvma-explore').appendChild(b);
    });
    wrap.appendChild(ex);
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
      if (document.querySelector('.settings-row')) syncSettings();
      if (document.querySelector('.details')) syncDetails();
    });
  }

  function watch() {
    if (typeof MutationObserver !== 'function') return;
    // Placeholders and the bar are settled in the observer itself (before the
    // frame is painted), so a placeholder is never drawn for even one frame.
    new MutationObserver(function () { markPlaceholders(); syncPill(); queue(); }).observe(document.body || root, { subtree: true, childList: true, characterData: false });
    new MutationObserver(queue).observe(root, { attributes: true, attributeFilter: ['class'] });
    // Rows and headings change their text in place when tapped or loaded.
    document.addEventListener('click', function () { setTimeout(queue, 0); }, true);
    // A reload (an interface update) while the player was open must not leave
    // the phone in landscape.
    shell('shell-leave');
    queue();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
  else watch();
})();
