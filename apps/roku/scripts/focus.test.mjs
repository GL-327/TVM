// Port of apps/roku/source/focus.brs (pure focus-key and rail-window maths).
// Runs the shared fixture scripts/fixtures/focus-cases.json against the JS port.
// Run: node --test apps/roku/scripts/focus.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/focus-cases.json', import.meta.url), 'utf8'),
);

// ---- Ports of focus.brs ----

export function tvmSafeLeft() {
  return 160;
}

export function tvmSafeRight() {
  return 3680;
}

// asText: '' for null/undefined, String(x) otherwise.
export function asText(x) {
  if (x === null || x === undefined) return '';
  return String(x);
}

// aaGet(item, key, invalid): the value, or undefined when missing.
export function aaGet(item, key) {
  if (item === null || item === undefined) return undefined;
  return item[key];
}

export function sanitizeRailId(railId) {
  return asText(railId).replace(/:/g, '_');
}

export function railFocusKey(railId, itemId) {
  return 'rails:' + sanitizeRailId(railId) + ':' + asText(itemId);
}

// Splits at the first two colons only, so item ids like "live:abc" stay whole.
export function parseFocusKey(key) {
  const out = { zone: '', a: '', b: '' };
  if (key === '') return out;
  const first = key.indexOf(':');
  if (first === -1) {
    out.zone = key;
    return out;
  }
  out.zone = key.slice(0, first);
  const rest = key.slice(first + 1);
  if (out.zone === 'rails') {
    const second = rest.indexOf(':');
    if (second === -1) {
      out.a = rest;
    } else {
      out.a = rest.slice(0, second);
      out.b = rest.slice(second + 1);
    }
  } else {
    out.a = rest;
  }
  return out;
}

export function resolveRailFocus(rails, railId, itemId, fallbackRow, fallbackCol) {
  const count = rails.length;
  if (count === 0) return { row: 0, col: 0, found: false };
  const wanted = sanitizeRailId(railId);
  let row = -1;
  for (let i = 0; i < count; i++) {
    if (sanitizeRailId(asText(rails[i].id)) === wanted) {
      row = i;
      break;
    }
  }
  if (row >= 0 && itemId !== '') {
    const items = rails[row].items;
    for (let j = 0; j < items.length; j++) {
      if (asText(items[j].id) === itemId) return { row, col: j, found: true };
    }
  }
  if (row < 0) {
    row = fallbackRow;
    if (row > count - 1) row = count - 1;
    if (row < 0) row = 0;
  }
  const size = rails[row].items.length;
  let col = fallbackCol;
  if (col > size - 1) col = size - 1;
  if (col < 0) col = 0;
  return { row, col, found: false };
}

export function railWrapIndex(index, count) {
  if (count <= 0) return 0;
  let wrapped = index % count;
  if (wrapped < 0) wrapped += count;
  return wrapped;
}

export function railLoopSlot(col, prevCol, prevSlot, prevFirst, count, visible, wasFocused) {
  if (count <= 0) return 0;
  if (count <= visible) return col;
  if (wasFocused && prevCol >= 0) {
    let delta = col - prevCol;
    const half = Math.trunc(count / 2);
    if (delta > half) delta -= count;
    if (delta < -half) delta += count;
    return prevSlot + delta;
  }
  for (let s = prevFirst; s < prevFirst + visible; s++) {
    if (railWrapIndex(s, count) === col) return s;
  }
  return col;
}

export function railViewFirst(count, focus, prevFirst, visible) {
  if (count <= visible) return 0;
  let first = prevFirst;
  if (focus >= 0) {
    if (focus < first) first = focus;
    if (focus > first + visible - 1) first = focus - visible + 1;
    return first;
  }
  let maxFirst = count - visible;
  if (maxFirst < 0) maxFirst = 0;
  if (first > maxFirst) first = maxFirst;
  if (first < 0) first = 0;
  return first;
}

export function railLoopViewFirst(count, slot, prevFirst, visible) {
  if (count <= visible) return 0;
  let first = prevFirst;
  if (slot < first) first = slot;
  if (slot > first + visible - 1) first = slot - visible + 1;
  return first;
}

export function railWindow(count, viewFirst, visible, buffer) {
  if (count <= 0) return { first: 0, last: -1 };
  if (count <= visible) return { first: 0, last: count - 1 };
  return { first: viewFirst - buffer, last: viewFirst + visible - 1 + buffer };
}

export function railRowLive(row, focusRow) {
  let anchor = focusRow;
  if (anchor < 0) anchor = 0;
  return row >= anchor - 1 && row <= anchor + 2;
}

export function railVisibleCount(pitch, cardWidth) {
  const usable = tvmSafeRight() - tvmSafeLeft();
  // BrightScript Int() truncates toward zero, so Math.trunc (not floor).
  let n = Math.trunc((usable + (pitch - cardWidth)) / pitch);
  if (n < 1) n = 1;
  return n;
}

export function railsSignature(rails) {
  let sig = '';
  for (const rail of rails) {
    sig = sig + '|' + asText(rail.id) + '#';
    for (const item of rail.items) {
      sig = sig + asText(item.id);
      const progress = aaGet(item, 'progress');
      if (progress !== undefined && progress !== null) {
        sig = sig + '@' + String(Math.trunc(progress * 100));
      }
      sig = sig + ',';
    }
  }
  return sig;
}

export function railRowHeight(layout) {
  if (layout === 'landscape') return 640;
  return 1040;
}

export function railLiveNodeEstimate(count, visible, buffer, live) {
  const base = 5;
  if (!live) return base;
  let cards = visible + buffer * 2;
  if (cards > count) cards = count;
  return base + cards * 16;
}

export function navStep(col, intent, count) {
  let result = col;
  if (intent === 'left' && result > 0) result = result - 1;
  if (intent === 'right' && result < count - 1) result = result + 1;
  return result;
}

export function heroStep(col, intent) {
  let result = col;
  if (intent === 'left' && result > 0) result = result - 1;
  if (intent === 'right' && result < 1) result = result + 1;
  return result;
}

// ---- Fixture-driven cases ----

for (const c of fixture.parseFocusKey) {
  test(`parseFocusKey: ${c.name}`, () => {
    assert.deepEqual(parseFocusKey(c.key), c.expected);
  });
}

for (const c of fixture.sanitizeRailId) {
  test(`sanitizeRailId: ${c.name}`, () => {
    assert.equal(sanitizeRailId(c.railId), c.expected);
  });
}

for (const c of fixture.railFocusKey) {
  test(`railFocusKey: ${c.name}`, () => {
    assert.equal(railFocusKey(c.railId, c.itemId), c.expected);
  });
}

for (const c of fixture.resolveRailFocus) {
  test(`resolveRailFocus: ${c.name}`, () => {
    const got = resolveRailFocus(c.rails, c.railId, c.itemId, c.fallbackRow, c.fallbackCol);
    assert.deepEqual(got, c.expected);
  });
}

for (const c of fixture.railViewFirst) {
  test(`railViewFirst: ${c.name}`, () => {
    assert.equal(railViewFirst(c.count, c.focus, c.prevFirst, c.visible), c.expected);
  });
}

for (const c of fixture.railWindow) {
  test(`railWindow: ${c.name}`, () => {
    assert.deepEqual(railWindow(c.count, c.viewFirst, c.visible, c.buffer), c.expected);
  });
}

for (const c of fixture.railRowLive) {
  test(`railRowLive: ${c.name}`, () => {
    assert.equal(railRowLive(c.row, c.focusRow), c.expected);
  });
}

for (const c of fixture.railVisibleCount) {
  test(`railVisibleCount: ${c.name}`, () => {
    assert.equal(railVisibleCount(c.pitch, c.cardWidth), c.expected);
  });
}

for (const c of fixture.railLiveNodeEstimate) {
  test(`railLiveNodeEstimate: ${c.name}`, () => {
    assert.equal(railLiveNodeEstimate(c.count, c.visible, c.buffer, c.live), c.expected);
  });
}

for (const c of fixture.railRowHeight) {
  test(`railRowHeight: ${c.name}`, () => {
    assert.equal(railRowHeight(c.layout), c.expected);
  });
}

for (const c of fixture.navStep) {
  test(`navStep: ${c.name}`, () => {
    assert.equal(navStep(c.col, c.intent, c.count), c.expected);
  });
}

for (const c of fixture.heroStep) {
  test(`heroStep: ${c.name}`, () => {
    assert.equal(heroStep(c.col, c.intent), c.expected);
  });
}

for (const c of fixture.railsSignature.cases) {
  test(`railsSignature: ${c.name}`, () => {
    assert.equal(railsSignature(c.rails), c.expectedSignature);
  });
}

for (const c of fixture.railsSignature.pairs) {
  test(`railsSignature pair: ${c.name}`, () => {
    const same = railsSignature(c.a) === railsSignature(c.b);
    assert.equal(same, c.same);
  });
}

// ---- Extra behaviour tests ----

test('railFocusKey round-trips through parseFocusKey (rail id sanitised)', () => {
  const parsed = parseFocusKey(railFocusKey('live:tv', 'live:abc:1'));
  assert.deepEqual(parsed, { zone: 'rails', a: 'live_tv', b: 'live:abc:1' });
});

test('poll re-apply: focus follows itemB after continue list reorders', () => {
  const { a: railId, b: itemId } = parseFocusKey(railFocusKey('continue', 'itemB'));
  const reordered = [
    { id: 'continue', items: [{ id: 'itemB' }, { id: 'itemA' }, { id: 'itemC' }] },
  ];
  // fallbackCol 1 would land on itemA, so col 0 proves the id was followed.
  const focus = resolveRailFocus(reordered, railId, itemId, 0, 1);
  assert.equal(focus.col, 0);
  assert.equal(focus.found, true);
});

const PORTRAIT = { pitch: 600, width: 560 };
const LANDSCAPE = { pitch: 840, width: 800 };
const FIXED_OVERHEAD = 400;

test('node budget: max live nodes over focus rows 0..7 stays under 1500', () => {
  // Home model: first rail landscape, the other seven portrait, 16 items each.
  const rails = Array.from({ length: 8 }, (_, i) => ({
    layout: i === 0 ? 'landscape' : 'portrait',
    count: 16,
  }));
  const visibleFor = (layout) =>
    layout === 'landscape'
      ? railVisibleCount(LANDSCAPE.pitch, LANDSCAPE.width)
      : railVisibleCount(PORTRAIT.pitch, PORTRAIT.width);

  let max = 0;
  for (let focusRow = 0; focusRow <= 7; focusRow++) {
    let nodes = FIXED_OVERHEAD;
    rails.forEach((rail, row) => {
      nodes += railLiveNodeEstimate(
        rail.count,
        visibleFor(rail.layout),
        2,
        railRowLive(row, focusRow),
      );
    });
    max = Math.max(max, nodes);
  }

  const legacy = 8 * 16 * 3 * 13 + 17 * 4 + 100;
  console.log(`node budget: max live nodes = ${max}`);
  console.log(`node budget: legacy estimate = ${legacy}`);
  assert.ok(max < 1500, `max live nodes ${max} is not under 1500`);
});

test('looping rail wraps forward past last item and backward past zero', () => {
  const count = 16;
  const visible = 11;
  // Step right from index 15 (slot 15, viewFirst 5) to index 0 -> slot 16, viewFirst 6.
  const nextSlot = railLoopSlot(0, 15, 15, 5, count, visible, true);
  assert.equal(nextSlot, 16);
  assert.equal(railLoopViewFirst(count, nextSlot, 5, visible), 6);
  assert.equal(railWrapIndex(nextSlot, count), 0);

  // Step left from index 0 (slot 0, viewFirst 0) to index 15 -> slot -1, viewFirst -1.
  const prevSlot = railLoopSlot(15, 0, 0, 0, count, visible, true);
  assert.equal(prevSlot, -1);
  assert.equal(railLoopViewFirst(count, prevSlot, 0, visible), -1);
  assert.equal(railWrapIndex(prevSlot, count), 15);
  assert.deepEqual(railWindow(count, -1, visible, 2), { first: -3, last: 11 });
});
