// Port of apps/roku/source/spatial.brs (pure TVM Hub star geometry).
// Runs the shared fixture scripts/fixtures/spatial-cases.json against the JS port.
// Run: node --test apps/roku/scripts/spatial.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/spatial-cases.json', import.meta.url), 'utf8'),
);

// ---- Ports of spatial.brs ----

export function spatialGeometry() {
  return { cx: 1340, cy: 1260, rx: 980, ratio: 0.58, depthMin: 0.84, depthMax: 1.0, maxSpokes: 6, orbR: 210, nodeR: 196 };
}

export function spatialAnchors() {
  return [220, 320, 140, 40, 270, 180];
}

export function spatialVisibleSpokes(count) {
  if (count > 6) return 6;
  if (count < 0) return 0;
  return count;
}

export function spatialState(count) {
  if (count <= 0) return 'zero';
  if (count === 1) return 'one';
  return 'many';
}

export function spatialAtan2(y, x) {
  const pi = 3.14159265;
  if (x > 0) return Math.atan(y / x);
  if (x < 0 && y >= 0) return Math.atan(y / x) + pi;
  if (x < 0 && y < 0) return Math.atan(y / x) - pi;
  if (y > 0) return pi / 2;
  if (y < 0) return 0 - pi / 2;
  return 0;
}

const round = (v) => Math.floor(v + 0.5);

export function spatialProject(angle, geo, flat) {
  const rad = (angle * 3.14159265) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const ry = geo.rx * geo.ratio;
  let scale = geo.depthMin + ((geo.depthMax - geo.depthMin) * (s + 1)) / 2;
  if (flat) scale = 1.0;
  return { x: round(geo.cx + geo.rx * c), y: round(geo.cy + ry * s), scaleCenti: round(scale * 100) };
}

export function spatialSorted(devices) {
  const out = devices.map((d) => {
    let slot = d.slot;
    if (!Number.isInteger(slot) || slot < 0) slot = 9999;
    return { id: String(d.id ?? ''), slot };
  });
  out.sort((a, b) => (a.slot !== b.slot ? a.slot - b.slot : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

export function spatialAssign(devices) {
  const sorted = spatialSorted(devices);
  const maxN = 6;
  const anchors = Array(maxN).fill('');
  const placed = new Set();
  for (const item of sorted) {
    if (item.slot < maxN && anchors[item.slot] === '') {
      anchors[item.slot] = item.id;
      placed.add(item.id);
    }
  }
  const overflow = [];
  for (const item of sorted) {
    if (!placed.has(item.id)) {
      const free = anchors.indexOf('');
      if (free >= 0) anchors[free] = item.id;
      else overflow.push(item.id);
    }
  }
  return { anchors, overflow };
}

function spatialSlotOf(devices, id) {
  for (const d of devices) {
    if (String(d.id ?? '') === id) return Number.isInteger(d.slot) ? d.slot : 9999;
  }
  return 9999;
}

function orderByY(ids, nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return [...ids].sort((a, b) => {
    const na = byId.get(a);
    const nb = byId.get(b);
    return na.y !== nb.y ? na.y - nb.y : na.anchor - nb.anchor;
  });
}

export function spatialLayout(devices, geo, flat) {
  const assign = spatialAssign(devices);
  const angles = spatialAnchors();
  const nodes = [];
  assign.anchors.forEach((id, i) => {
    if (id !== '') {
      const p = spatialProject(angles[i], geo, flat);
      nodes.push({ id, slot: spatialSlotOf(devices, id), anchor: i, x: p.x, y: p.y, scaleCenti: p.scaleCenti });
    }
  });
  let more = null;
  if (assign.overflow.length > 0) {
    const mp = spatialProject(0, geo, flat);
    more = { id: 'more', count: assign.overflow.length, x: mp.x, y: mp.y, scaleCenti: mp.scaleCenti, ids: assign.overflow };
  }
  const behind = nodes.filter((n) => n.y < geo.cy).map((n) => n.id);
  const front = nodes.filter((n) => n.y >= geo.cy).map((n) => n.id);
  return {
    state: spatialState(devices.length),
    orb: { id: 'account', x: geo.cx, y: geo.cy },
    nodes,
    more,
    overflow: assign.overflow,
    behind: orderByY(behind, nodes),
    front: orderByY(front, nodes),
    flat,
  };
}

export function spatialNodeById(layout, id) {
  if (id === 'account') return { id: 'account', slot: -1, x: layout.orb.x, y: layout.orb.y };
  for (const n of layout.nodes) if (n.id === id) return n;
  if (layout.more && id === 'more') return { id: 'more', slot: 1000, x: layout.more.x, y: layout.more.y };
  return null;
}

export function spatialPoints(layout) {
  const pts = [{ id: 'account', slot: -1, x: layout.orb.x, y: layout.orb.y }];
  for (const n of layout.nodes) pts.push({ id: n.id, slot: n.slot, x: n.x, y: n.y });
  if (layout.more) pts.push({ id: 'more', slot: 1000, x: layout.more.x, y: layout.more.y });
  return pts;
}

export function spatialNeighbour(points, fromId, dir) {
  const from = points.find((p) => p.id === fromId);
  if (!from) return '';
  let best = '';
  let bestScore = 0;
  let bestSlot = 0;
  for (const p of points) {
    if (p.id === fromId) continue;
    const dx = p.x - from.x;
    const dy = p.y - from.y;
    let along = 0;
    let lateral = 0;
    if (dir === 'right') {
      along = dx;
      lateral = Math.abs(dy);
    } else if (dir === 'left') {
      along = 0 - dx;
      lateral = Math.abs(dy);
    } else if (dir === 'down') {
      along = dy;
      lateral = Math.abs(dx);
    } else if (dir === 'up') {
      along = 0 - dy;
      lateral = Math.abs(dx);
    }
    if (along > 0 && lateral <= along) {
      const score = Math.sqrt(dx * dx + dy * dy) + 0.5 * lateral;
      let take = false;
      if (best === '') take = true;
      else if (score < bestScore - 0.01) take = true;
      else if (Math.abs(score - bestScore) <= 0.01 && p.slot < bestSlot) take = true;
      if (take) {
        best = p.id;
        bestScore = score;
        bestSlot = p.slot;
      }
    }
  }
  return best;
}

export function spatialMove(layout, fromId, dir) {
  const target = spatialNeighbour(spatialPoints(layout), fromId, dir);
  if (target !== '') return { kind: 'focus', id: target, edge: '' };
  if (dir === 'up') return { kind: 'edge', id: '', edge: 'tabs' };
  if (dir === 'right') return { kind: 'edge', id: '', edge: 'inspector' };
  if (dir === 'down') return { kind: 'edge', id: '', edge: 'add' };
  return { kind: 'none', id: '', edge: '' };
}

export function spatialReconcileFocus(oldLayout, newLayout, focusId) {
  if (focusId === 'account') return 'account';
  if (spatialNodeById(newLayout, focusId)) return focusId;
  const gone = spatialNodeById(oldLayout, focusId);
  if (!gone) return 'account';
  let best = 'account';
  let bestDist = -1;
  let bestSlot = 0;
  for (const p of spatialPoints(newLayout)) {
    if (p.id === 'account') continue;
    let px = p.x;
    let py = p.y;
    const old = spatialNodeById(oldLayout, p.id);
    if (old) {
      px = old.x;
      py = old.y;
    }
    const dx = px - gone.x;
    const dy = py - gone.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let take = false;
    if (bestDist < 0) take = true;
    else if (dist < bestDist - 0.01) take = true;
    else if (Math.abs(dist - bestDist) <= 0.01 && p.slot < bestSlot) take = true;
    if (take) {
      best = p.id;
      bestDist = dist;
      bestSlot = p.slot;
    }
  }
  return best;
}

export function spatialSpoke(node, geo) {
  const dx = node.x - geo.cx;
  const dy = node.y - geo.cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = spatialAtan2(dy, dx);
  let ux = 0;
  let uy = 0;
  if (dist > 0) {
    ux = dx / dist;
    uy = dy / dist;
  }
  let length = dist - geo.orbR - (geo.nodeR * node.scaleCenti) / 100;
  if (length < 0) length = 0;
  return {
    x: round(geo.cx + ux * geo.orbR),
    y: round(geo.cy + uy * geo.orbR),
    length: round(length),
    milliRad: round(angle * 1000),
  };
}

export function spatialLabel(name, perLine) {
  const text = name.trim();
  if (text.length <= perLine) return { l1: text, l2: '', cut: false };
  let breakAt = 0;
  for (let p = perLine + 1; p >= 2; p -= 1) {
    if (text.charAt(p - 1) === ' ') {
      breakAt = p;
      break;
    }
  }
  let l1;
  let rest;
  if (breakAt > 0) {
    l1 = text.slice(0, breakAt - 1);
    rest = text.slice(breakAt);
  } else {
    l1 = text.slice(0, perLine);
    rest = text.slice(perLine);
  }
  l1 = l1.trim();
  rest = rest.trim();
  if (rest.length <= perLine) return { l1, l2: rest, cut: false };
  return { l1, l2: rest.slice(0, perLine - 3) + '...', cut: true };
}

export function spatialNodeEstimate(deviceCount) {
  const visible = spatialVisibleSpokes(deviceCount);
  let nodes = 6 + visible * 14;
  if (deviceCount > 6) nodes += 14;
  return 120 + nodes;
}

// ---- Helpers ----

const geo = spatialGeometry();
const devs = (slots) => slots.map((slot, i) => ({ id: `d${i}`, slot }));
const compactNode = (n) => ({ id: n.id, anchor: n.anchor, x: n.x, y: n.y, scaleCenti: n.scaleCenti });

// ---- Fixture-driven tests ----

for (const c of fixture.layout) {
  test(`layout: ${c.name}`, () => {
    const layout = spatialLayout(c.devices, geo, c.flat === true);
    assert.equal(layout.state, c.expected.state);
    assert.deepEqual(layout.nodes.map(compactNode), c.expected.nodes);
    assert.deepEqual(layout.more ? { count: layout.more.count, x: layout.more.x, y: layout.more.y } : null, c.expected.more);
    assert.deepEqual(layout.overflow, c.expected.overflow);
    assert.deepEqual(layout.behind, c.expected.behind);
    assert.deepEqual(layout.front, c.expected.front);
  });
}

for (const c of fixture.move) {
  test(`move: ${c.name}`, () => {
    const layout = spatialLayout(c.devices, geo, false);
    assert.deepEqual(spatialMove(layout, c.from, c.dir), c.expected);
  });
}

for (const c of fixture.reconcile) {
  test(`reconcile: ${c.name}`, () => {
    const before = spatialLayout(c.before, geo, false);
    const after = spatialLayout(c.after, geo, false);
    assert.equal(spatialReconcileFocus(before, after, c.focus), c.expected);
  });
}

for (const c of fixture.spoke) {
  test(`spoke: ${c.name}`, () => {
    const layout = spatialLayout(c.devices, geo, false);
    const node = layout.nodes.find((n) => n.id === c.id);
    assert.deepEqual(spatialSpoke(node, geo), c.expected);
  });
}

for (const c of fixture.label) {
  test(`label: ${c.name}`, () => {
    assert.deepEqual(spatialLabel(c.text, c.perLine), c.expected);
  });
}

for (const c of fixture.atan2) {
  test(`atan2: ${c.name}`, () => {
    assert.equal(round(spatialAtan2(c.y, c.x) * 1000), c.expectedMilli);
  });
}

// ---- Structural properties (same on device) ----

test('heartbeat never re-slots: layout depends only on ids and slots', () => {
  const a = devs([0, 1, 2]);
  const b = a.map((d) => ({ ...d, state: 'playing', lastSeenAt: 'x' }));
  assert.deepEqual(spatialLayout(a, geo, false), spatialLayout(b, geo, false));
  const reversed = [...a].reverse();
  assert.deepEqual(spatialLayout(reversed, geo, false).nodes, spatialLayout(a, geo, false).nodes);
});

test('Reduce Motion keeps positions and drawing order, only drops depth scale', () => {
  for (const n of [0, 1, 3, 6, 9]) {
    const d = devs([...Array(n).keys()]);
    const deep = spatialLayout(d, geo, false);
    const flat = spatialLayout(d, geo, true);
    assert.deepEqual(flat.nodes.map((x) => [x.id, x.x, x.y]), deep.nodes.map((x) => [x.id, x.x, x.y]));
    assert.deepEqual(flat.behind, deep.behind);
    assert.deepEqual(flat.front, deep.front);
    assert.ok(flat.nodes.every((x) => x.scaleCenti === 100));
    assert.ok(deep.nodes.every((x) => x.scaleCenti >= 84 && x.scaleCenti <= 100));
  }
});

test('at most six spokes plus a More node that counts the rest', () => {
  for (const [n, spokes, more] of [[0, 0, 0], [1, 1, 0], [3, 3, 0], [6, 6, 0], [9, 6, 3], [20, 6, 14]]) {
    const layout = spatialLayout(devs([...Array(n).keys()]), geo, false);
    assert.equal(layout.nodes.length, spokes);
    assert.equal(layout.more ? layout.more.count : 0, more);
    assert.equal(spatialVisibleSpokes(n), spokes);
  }
});

test('ellipse tilt ratio and depth range', () => {
  assert.equal(geo.ratio, 0.58);
  assert.equal(geo.depthMin, 0.84);
  assert.equal(geo.depthMax, 1.0);
});

test('anchored nodes never overlap one another or the orb', () => {
  const layout = spatialLayout(devs([0, 1, 2, 3, 4, 5, 6]), geo, false);
  const pts = [...layout.nodes, layout.more, { x: layout.orb.x, y: layout.orb.y, scaleCenti: 100 }];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      assert.ok(d > geo.nodeR * 2, `points ${i} and ${j} are ${d} apart`);
    }
  }
});

test('graph stays inside the safe area', () => {
  const layout = spatialLayout(devs([0, 1, 2, 3, 4, 5, 6]), geo, false);
  for (const n of [...layout.nodes, layout.more]) {
    assert.ok(n.x - geo.nodeR >= 160 && n.x + geo.nodeR <= 2560, `x ${n.x}`);
    assert.ok(n.y - geo.nodeR >= 480 && n.y + geo.nodeR <= 1960, `y ${n.y}`);
  }
});

test('live node estimate for HubScreen stays well under the budget', () => {
  assert.ok(spatialNodeEstimate(0) < 400);
  assert.ok(spatialNodeEstimate(6) < 400);
  assert.ok(spatialNodeEstimate(60) < 400);
});
