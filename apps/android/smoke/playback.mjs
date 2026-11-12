// Real playback on a real Android system, for the CI emulator run.
//
// Called by scripts/android-smoke.mjs once TVM is open. It drives the app's
// native player through the same bridge the interface uses (window.tvmPlayer,
// see apps/ui/src/player/iosEngine.ts) and checks what is actually on the
// screen, not what the player says about itself:
//
//   - the page is laid out as it is during playback (the player screen, the
//     native-playback classes and the Android overlay stylesheet), so anything
//     the interface paints over the picture shows up as a black screen here;
//   - frames must be non-black and must change while playing, and stop
//     changing while paused;
//   - seeking forwards and backwards must land where asked;
//   - the phone must turn to landscape while playing and back afterwards;
//   - leaving the app and coming back must pause and then carry on;
//   - MP4, Matroska and MPEG-TS must each render.
//
// The clips (apps/android/smoke/media) are 24 s of test pattern with a large
// white block sweeping across it and a tone, served to the emulator from this
// machine through `adb reverse`.
import { execFileSync } from 'node:child_process';
import { createReadStream, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MEDIA = join(dirname(fileURLToPath(import.meta.url)), 'media');
const PORT = 18080;
const TYPES = { mp4: 'video/mp4', mkv: 'video/x-matroska', ts: 'video/mp2t' };

function serveMedia() {
  const server = http.createServer((req, res) => {
    const name = (req.url ?? '/').split('?')[0].replace(/^\/+/, '');
    if (!/^clip\.(mp4|mkv|ts)$/.test(name)) { res.writeHead(404).end(); return; }
    const file = join(MEDIA, name);
    const size = statSync(file).size;
    const type = TYPES[name.split('.').pop()];
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}` });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
      createReadStream(file).pipe(res);
    }
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

/** The screen as raw RGBA, straight from SurfaceFlinger: what a person would see. */
function capture() {
  const raw = execFileSync('adb', ['exec-out', 'screencap'], { maxBuffer: 128 * 1024 * 1024, timeout: 30_000 });
  const width = raw.readUInt32LE(0);
  const height = raw.readUInt32LE(4);
  const header = raw.length - width * height * 4;
  return { width, height, pixels: raw.subarray(header) };
}

/** Mean brightness and spread over the middle of the screen, sampled on a grid. */
function measure(frame) {
  const { width, height, pixels } = frame;
  const values = [];
  for (let y = Math.floor(height * 0.25); y < height * 0.75; y += 6) {
    for (let x = Math.floor(width * 0.25); x < width * 0.75; x += 6) {
      const i = (y * width + x) * 4;
      values.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const spread = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, spread, values };
}

/**
 * How much of the picture changed: the share of samples whose brightness moved
 * by more than a clear step. (An average over the frame hides a moving object
 * on a mostly still picture; the clip's white block covers about a tenth of it.)
 */
function difference(a, b) {
  const n = Math.min(a.values.length, b.values.length);
  let changed = 0;
  for (let i = 0; i < n; i++) if (Math.abs(a.values[i] - b.values[i]) > 24) changed++;
  return (changed / n) * 100;
}

export async function playbackSmoke({ adb, evaluate, step, annotate, sleep, out, packageName }) {
  const server = await serveMedia();
  adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
  const save = (name) => {
    try { writeFileSync(join(out, name), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 })); } catch { /* best effort */ }
  };

  // The page as it is while a film plays: the player screen above the app,
  // the native-playback classes, and whatever the Android overlay does to them.
  const ready = await evaluate(`(() => {
    if (typeof window.tvmPlayer !== 'object') return 'no native bridge';
    const root = document.documentElement;
    root.classList.add('tvm-native-playback');
    window.__smoke = [];
    window.addEventListener('tvm:native-player', (e) => { window.__smoke.push(e.detail); });
    // The screen underneath is hidden during playback (app.css hides the inert screen).
    for (const el of document.querySelectorAll('#root > *, .app > *')) el.style.visibility = 'hidden';
    const layer = document.createElement('div');
    layer.className = 'modal-layer';
    layer.dataset.screen = 'player';
    layer.style.visibility = 'visible';
    layer.innerHTML = '<div class="player player--native player--mobile player--landscape" data-player="" data-engine="native">' +
      '<div class="player__stage" data-player-stage=""><video class="player__video" data-player-video="" playsinline></video></div></div>';
    (document.querySelector('.app') || document.body).appendChild(layer);
    const bg = getComputedStyle(layer.querySelector('.player')).backgroundColor;
    return 'ok ' + bg;
  })()`);
  if (!String(ready).startsWith('ok')) throw new Error(`player page not ready: ${ready}`);
  const playerBg = String(ready).slice(3);
  if (!/rgba\(0, 0, 0, 0\)|transparent/.test(playerBg)) {
    throw new Error(`the player screen paints ${playerBg} over the native picture (it must be transparent)`);
  }
  annotate('notice', 'the player screen is transparent over the native picture');

  const send = (message) => evaluate(`window.tvmPlayer.send(${JSON.stringify(JSON.stringify(message))}), 'sent'`);
  const latest = (id) => evaluate(`JSON.stringify((window.__smoke || []).filter((d) => d.id === ${JSON.stringify(id)}).slice(-1)[0] || null)`)
    .then((text) => JSON.parse(text ?? 'null'));
  const errors = (id) => evaluate(`JSON.stringify((window.__smoke || []).filter((d) => d.id === ${JSON.stringify(id)} && d.command === 'error'))`)
    .then((text) => JSON.parse(text ?? '[]'));

  async function playing(id, label) {
    await step(`${label}: frames reach the screen`, 60, async () => {
      const failed = await errors(id);
      if (failed.length > 0) throw new Error(`player error: ${failed[0].message}`);
      const state = await latest(id);
      return state !== null && state.hasFrame === true && state.paused === false && state.position > 1.5;
    });
    // Several captures over about three seconds: the emulator's software
    // decoder updates the picture slowly, so one pair of captures can land
    // between two of its frames. Playing measured 0.4-1.2% here; paused 0%.
    const a = measure(capture());
    if (a.mean < 20 || a.spread < 12) throw new Error(`${label}: the picture is black or blank (brightness ${a.mean.toFixed(1)}, spread ${a.spread.toFixed(1)})`);
    let moved = 0;
    let frame = null;
    for (let i = 0; i < 4; i++) {
      await sleep(750);
      frame = capture();
      moved = Math.max(moved, difference(a, measure(frame)));
    }
    if (moved < 0.25) throw new Error(`${label}: the picture is not moving (at most ${moved.toFixed(2)}% of it changed in 3 s)`);
    annotate('notice', `${label}: video renders (brightness ${a.mean.toFixed(0)}, spread ${a.spread.toFixed(0)}, up to ${moved.toFixed(1)}% changed in 3 s) at ${frame.width}x${frame.height}`);
    return frame;
  }

  try {
    adb('shell', 'dumpsys', 'gfxinfo', packageName, 'reset');
    await send({ id: 'smoke-1', command: 'open', url: `http://127.0.0.1:${PORT}/clip.mp4`, title: 'Smoke MP4', startAt: 0, live: false, initialVolume: 1, initialMuted: false });
    const first = await playing('smoke-1', 'MP4 (H.264/AAC)');
    save('playback-mp4.png');
    if (first.width <= first.height) throw new Error(`playback did not turn the screen to landscape (${first.width}x${first.height})`);
    annotate('notice', 'playback turned the screen to landscape');

    // Pause: the picture holds still and the clock stops.
    await send({ id: 'smoke-1', command: 'pause' });
    await step('pause stops playback', 15, async () => (await latest('smoke-1'))?.paused === true);
    await sleep(600);
    const p1 = measure(capture());
    const t1 = (await latest('smoke-1')).position;
    await sleep(1500);
    const p2 = measure(capture());
    const t2 = (await latest('smoke-1')).position;
    if (difference(p1, p2) > 0.1 || Math.abs(t2 - t1) > 0.3) throw new Error(`still moving while paused (${difference(p1, p2).toFixed(2)}% changed, clock ${t1}→${t2})`);
    if (p2.mean < 20) throw new Error('the paused picture is black');
    annotate('notice', 'pause holds the picture');

    await send({ id: 'smoke-1', command: 'play' });
    await step('play resumes', 15, async () => (await latest('smoke-1'))?.paused === false);

    // Seeking both ways lands where asked.
    await send({ id: 'smoke-1', command: 'seek', seconds: 14 });
    await step('seek forward to 14 s', 20, async () => { const s = await latest('smoke-1'); return s !== null && s.position >= 13.5 && s.position <= 16.5; });
    await send({ id: 'smoke-1', command: 'seek', seconds: 4 });
    await step('seek back to 4 s', 20, async () => { const s = await latest('smoke-1'); return s !== null && s.position >= 3.5 && s.position <= 6.5; });
    await playing('smoke-1', 'after seeking');

    // Leave the app and come back.
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
    await step('leaving the app pauses playback', 20, async () => (await latest('smoke-1'))?.paused === true);
    await sleep(1500);
    adb('shell', 'monkey', '-p', packageName, '-c', 'android.intent.category.LAUNCHER', '1');
    await step('coming back carries on', 30, async () => {
      const s = await latest('smoke-1');
      return s !== null && s.paused === false;
    });
    await playing('smoke-1', 'after returning to the app');
    save('playback-resumed.png');

    // Another film, then another format.
    await send({ id: 'smoke-2', command: 'open', url: `http://127.0.0.1:${PORT}/clip.mkv`, title: 'Smoke MKV', startAt: 0, live: false, initialVolume: 1, initialMuted: false });
    await playing('smoke-2', 'Matroska (switching titles)');
    await send({ id: 'smoke-3', command: 'open', url: `http://127.0.0.1:${PORT}/clip.ts`, title: 'Smoke TS', startAt: 0, live: false, initialVolume: 1, initialMuted: false });
    await playing('smoke-3', 'MPEG-TS');
    save('playback-ts.png');

    try {
      const stats = adb('shell', 'dumpsys', 'gfxinfo', packageName);
      const pick = (label) => (new RegExp(`${label}: ([^\\n]+)`).exec(stats)?.[1] ?? '?').trim();
      annotate('notice', `UI frames during playback: total ${pick('Total frames rendered')}, janky ${pick('Janky frames')}, 50th ${pick('50th percentile')}, 90th ${pick('90th percentile')}`);
    } catch { /* informational */ }

    // Closing the player hands the screen back: the interface removes the
    // player screen (which releases the landscape it holds while open) and
    // stops the stream.
    await evaluate(`document.querySelector('.modal-layer[data-screen="player"]')?.remove(), 'removed'`);
    await send({ id: 'smoke-3', command: 'stop' });
    await step('closing the player restores portrait', 20, async () => {
      const frame = capture();
      return frame.height > frame.width;
    });
    annotate('notice', 'closing the player restored the screen');
  } finally {
    try { adb('reverse', '--remove', `tcp:${PORT}`); } catch { /* best effort */ }
    server.close();
  }
}
