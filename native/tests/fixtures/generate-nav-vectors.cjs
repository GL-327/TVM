// Generates reference vectors for the native focus engine and camera tween
// from the code the web UI actually runs:
//   - @noriginmedia/norigin-spatial-navigation-core 4.1.0 (the focus engine), and
//   - apps/ui/src/nav/scrollAnim.ts (the camera tween), ported line for line.
//
// Run from the repository root:  node native/tests/fixtures/generate-nav-vectors.cjs
// Output: native/tests/fixtures/nav-vectors.json, read by nav_tests.cpp.

const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..', '..', '..');
const pnpm = path.join(repo, 'node_modules', '.pnpm');
const coreDir = fs
  .readdirSync(pnpm)
  .find((name) => name.startsWith('@noriginmedia+norigin-spatial-navigation-core@4.1.0'));
if (coreDir === undefined) throw new Error('norigin-spatial-navigation-core 4.1.0 is not installed');
const core = require(path.join(pnpm, coreDir, 'node_modules', '@noriginmedia', 'norigin-spatial-navigation-core', 'dist', 'index.cjs'));
const { SpatialNavigationService } = core;

// Deterministic PRNG so the vectors are the same on every run.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(20261027);
const round = (value) => Math.round(value * 100) / 100;
const DIRECTIONS = ['up', 'down', 'left', 'right'];

function randomRect() {
  const left = random() * 1800;
  const top = random() * 1000;
  const width = 40 + random() * 300;
  const height = 40 + random() * 240;
  return { left: round(left), top: round(top), right: round(left + width), bottom: round(top + height) };
}

// Mirrors the candidate filter in smartNavigate for one level of siblings.
function cutoffFilter(direction, current, candidates) {
  const vertical = direction === 'up' || direction === 'down';
  const incremental = direction === 'down' || direction === 'right';
  const LTR = 0;
  const currentCutoff = SpatialNavigationService.getCutoffCoordinate(vertical, incremental, false, current, LTR);
  return candidates.filter((candidate) => {
    const candidateCutoff = SpatialNavigationService.getCutoffCoordinate(vertical, incremental, true, candidate.layout, LTR);
    return incremental ? candidateCutoff >= currentCutoff : candidateCutoff <= currentCutoff;
  });
}

const scenarios = [];
for (let n = 0; n < 240; n += 1) {
  const count = 2 + Math.floor(random() * 10);
  const current = randomRect();
  const direction = DIRECTIONS[Math.floor(random() * 4)];
  const siblings = Array.from({ length: count }, (_, index) => ({ focusKey: `s${index}`, layout: randomRect() }));

  const candidates = cutoffFilter(direction, current, siblings);
  let expected = -1;
  if (candidates.length > 0) {
    const service = new SpatialNavigationService();
    service.distanceCalculationMethod = 'center';
    service.visualDebugger = null;
    service.log = () => {};
    const sorted = service.sortSiblingsByPriority(candidates, current, direction, 'current');
    expected = siblings.indexOf(sorted[0]);
  }
  scenarios.push({ current, direction, siblings: siblings.map((s) => s.layout), expected });
}

// Camera tween, ported from scrollAnim.ts.
const EASE = 0.24;
const SETTLE = 0.6;
const MAX_STEPS = 90;
const FRAME_MS = 1000 / 60;
function scrollEase(elapsedMs) {
  const elapsed = Number.isFinite(elapsedMs) && elapsedMs > 0 ? elapsedMs : FRAME_MS;
  return 1 - Math.pow(1 - EASE, Math.min(elapsed, 64) / FRAME_MS);
}

function simulateCamera({ current, target, max, frames }) {
  const next = Math.min(max, Math.max(0, target));
  if (!Number.isFinite(target)) return { landed: false, positions: [], settled: false };
  if (Math.abs(next - current) < SETTLE) return { landed: true, positions: [next], settled: true };

  let position = current;
  let steps = 0;
  let lastTime;
  const positions = [];
  for (const time of frames) {
    const diff = next - position;
    if (Math.abs(diff) < SETTLE) {
      position = next;
      positions.push(position);
      return { landed: false, positions, settled: true };
    }
    const elapsed = lastTime === undefined ? FRAME_MS : time - lastTime;
    lastTime = time;
    position += diff * scrollEase(elapsed);
    steps += 1;
    if (steps >= MAX_STEPS) {
      position = next;
      positions.push(position);
      return { landed: false, positions, settled: true };
    }
    positions.push(position);
  }
  return { landed: false, positions, settled: false };
}

const cameraCases = [
  { current: 0, target: 1000, max: 4000, frames: [0, 17, 33, 50, 67, 83, 100, 117, 133, 150, 167, 183] },
  { current: 900, target: 200, max: 4000, frames: [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96] },
  { current: 0, target: 10, max: 4000, frames: [0, 17] },
  { current: 0, target: 50000, max: 4000, frames: [0, 17, 34, 51, 68, 85] },
  { current: 100, target: 400, max: 400, frames: [0, 16, 33, 49, 66, 83, 99, 116, 132, 149, 166, 182, 199, 216, 232, 249, 266, 282, 299, 316, 332, 349, 366, 382, 399, 416, 432] },
];
const camera = cameraCases.map((c) => ({ ...c, expected: simulateCamera(c) }));

const out = { scenarios, camera };
const target = path.join(__dirname, 'nav-vectors.json');
fs.writeFileSync(target, JSON.stringify(out, null, 1) + '\n');
console.log(`wrote ${scenarios.length} focus scenarios and ${camera.length} camera cases to ${target}`);
