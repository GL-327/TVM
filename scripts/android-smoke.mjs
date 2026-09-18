// Installs the APK on a running emulator, opens it, and checks that it gets
// all the way to the sign-in screen with its own core answering.
//
//   node scripts/android-smoke.mjs <apk> [output dir]
//
// Used by .github/workflows/mobile.yml before the Android release is
// published, so a build that installs but will not start is never released.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [apk, out = 'android-smoke'] = process.argv.slice(2);
if (apk === undefined) {
  console.error('usage: node scripts/android-smoke.mjs <apk> [output dir]');
  process.exit(2);
}
const PACKAGE = 'com.tvm.privateclient';
const CORE_PORT = 17345;
const DEVTOOLS_PORT = 19222;
mkdirSync(out, { recursive: true });

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what, seconds, check) {
  const deadline = Date.now() + seconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(2000);
  }
  throw new Error(`${what} did not happen within ${seconds}s${last ? ` (${last.message})` : ''}`);
}

async function core(path, init) {
  const response = await fetch(`http://127.0.0.1:${CORE_PORT}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(10_000),
  });
  return { status: response.status, body: await response.json() };
}

/** Evaluates an expression in the app's WebView through its DevTools socket. */
async function evaluate(expression) {
  const sockets = adb('shell', 'cat', '/proc/net/unix')
    .split('\n')
    .map((line) => /@(webview_devtools_remote_\d+)/.exec(line)?.[1])
    .filter(Boolean);
  if (sockets.length === 0) throw new Error('no WebView DevTools socket yet');
  adb('forward', `tcp:${DEVTOOLS_PORT}`, `localabstract:${sockets.at(-1)}`);
  const pages = await (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}/json`, { signal: AbortSignal.timeout(5000) })).json();
  const page = pages.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:'));
  if (page === undefined) throw new Error(`the WebView has not loaded TVM (pages: ${pages.map((entry) => entry.url).join(', ')})`);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools did not answer')); }, 10_000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(message.result?.result?.value);
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('DevTools connection failed')); };
  });
}

function collect() {
  try { writeFileSync(join(out, 'screen.png'), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 })); } catch { /* best effort */ }
  try { writeFileSync(join(out, 'logcat.txt'), adb('logcat', '-d')); } catch { /* best effort */ }
}

function crashed() {
  const log = adb('logcat', '-d', '-b', 'crash');
  return log.includes(PACKAGE) ? log : null;
}

try {
  await until('installing the APK', 120, () => {
    const result = adb('install', '-r', '-t', apk);
    return result.includes('Success');
  });
  console.log(`installed ${apk}`);

  adb('logcat', '-c');
  adb('shell', 'am', 'start', '-W', '-n', `${PACKAGE}/.MainActivity`);
  console.log('opened TVM');

  adb('forward', `tcp:${CORE_PORT}`, 'tcp:7345');
  const health = await until('the on-device core answering', 90, async () => {
    const reply = await core('/api/health');
    return reply.status === 200 && reply.body.status === 'ok' ? reply.body : null;
  });
  console.log(`core: ${JSON.stringify(health)}`);
  if (health.mode !== 'standalone') throw new Error(`expected the phone's own core, got mode ${health.mode}`);

  const heading = await until('the sign-in screen', 120, async () => {
    const text = await evaluate("document.querySelector('.gate h1')?.textContent ?? ''");
    return text === 'Sign in to TVM' ? text : null;
  });
  const devButton = await evaluate("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === \"I'm a dev\")");
  if (devButton !== true) throw new Error('the sign-in screen has no "I\'m a dev" button');
  console.log(`screen: "${heading}" with "I'm a dev"`);

  // One real round trip through the phone's account code.
  const signUp = { email: 'smoke@example.com', password: 'a good long password' };
  const registered = await core('/api/account/register', { method: 'POST', body: JSON.stringify(signUp) });
  if (registered.status !== 200) throw new Error(`sign-up failed: ${JSON.stringify(registered.body)}`);
  const signedIn = await core('/api/account/signin', { method: 'POST', body: JSON.stringify(signUp) });
  const me = await core('/api/account', { headers: { authorization: `Bearer ${signedIn.body.token}` } });
  if (me.body.usable?.reason !== 'awaiting_activation' || me.body.account?.role !== 'member') {
    throw new Error(`unexpected account state: ${JSON.stringify(me.body)}`);
  }
  console.log('accounts: sign-up and sign-in work on the phone');

  const crash = crashed();
  if (crash !== null) throw new Error(`TVM crashed:\n${crash}`);
  if (adb('shell', 'pidof', PACKAGE).trim() === '') throw new Error('TVM is no longer running');
  collect();
  console.log('TVM installs, opens and works on Android.');
} catch (error) {
  collect();
  console.log(`::error::${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  console.error(error);
  process.exit(1);
}
