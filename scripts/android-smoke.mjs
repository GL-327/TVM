// Installs the APK on a running emulator, opens it, and checks that it gets
// all the way to the sign-in screen with its own core answering.
//
//   node scripts/android-smoke.mjs <apk> [output dir]
//
// Used by .github/workflows/mobile.yml before the Android release is
// published, so a build that installs but will not start is never released.
// Each step it passes is reported as a notice, and a failure carries the
// relevant logcat lines, because job logs are not readable without admin.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
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

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** GitHub annotations are one line; %0A is how a message keeps its line breaks. */
const annotate = (level, text) => console.log(`::${level}::${text.replace(/%/g, '%25').replace(/\r?\n/g, '%0A')}`);

async function step(name, seconds, check) {
  const started = Date.now();
  const deadline = started + seconds * 1000;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) {
        annotate('notice', `${name} (${Math.round((Date.now() - started) / 1000)}s)`);
        return value;
      }
    } catch (error) {
      last = error;
    }
    await sleep(2000);
  }
  throw new Error(`${name}: not within ${seconds}s${last ? `. Last error: ${last.message}` : ''}`);
}

/**
 * One request on its own connection. The phone's server closes every
 * connection after answering, and a pooled keep-alive socket through an adb
 * forward can go dead without the client noticing, so nothing is reused.
 */
function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, agent: false, timeout: 30_000, headers: { 'content-type': 'application/json', ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { text += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(text) }); } catch { reject(new Error(`not JSON from ${path}: ${text.slice(0, 200)}`)); }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`${method} ${path} timed out`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const core = (path, init) => request(CORE_PORT, path, init);

let devtoolsSocket = null;

/** Evaluates an expression in the app's WebView through its DevTools socket. */
async function evaluate(expression) {
  const sockets = adb('shell', 'cat', '/proc/net/unix')
    .split('\n')
    .map((line) => /@(webview_devtools_remote_\d+)/.exec(line)?.[1])
    .filter(Boolean);
  if (sockets.length === 0) throw new Error('no WebView DevTools socket yet');
  if (devtoolsSocket !== sockets.at(-1)) {
    devtoolsSocket = sockets.at(-1);
    adb('forward', `tcp:${DEVTOOLS_PORT}`, `localabstract:${devtoolsSocket}`);
  }
  const pages = (await request(DEVTOOLS_PORT, '/json')).body;
  const page = pages.find((entry) => entry.type === 'page' && entry.url.startsWith('http://127.0.0.1:'));
  if (page === undefined) throw new Error(`TVM is not loaded in the WebView (pages: ${pages.map((entry) => entry.url).join(', ') || 'none'})`);
  // The answer is handed back once the socket has closed, so the next check
  // never overlaps this one.
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    let answer;
    let answered = false;
    const timer = setTimeout(() => { socket.close(); reject(new Error('DevTools did not answer')); }, 15_000);
    socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      answer = message.result?.result?.value;
      answered = true;
      socket.close();
    };
    socket.onclose = () => {
      clearTimeout(timer);
      if (answered) resolve(answer);
      else reject(new Error('DevTools closed without answering'));
    };
    socket.onerror = () => { clearTimeout(timer); reject(new Error('DevTools connection failed')); };
  });
}

function collect() {
  try { writeFileSync(join(out, 'screen.png'), execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024, timeout: 30_000 })); } catch { /* best effort */ }
  try {
    const log = adb('logcat', '-d');
    writeFileSync(join(out, 'logcat.txt'), log);
    return log;
  } catch {
    return '';
  }
}

try {
  await step('APK installed', 180, () => adb('install', '-r', '-t', apk).includes('Success'));

  adb('logcat', '-c');
  adb('shell', 'am', 'start', '-W', '-n', `${PACKAGE}/.MainActivity`);
  annotate('notice', 'TVM opened');

  adb('forward', `tcp:${CORE_PORT}`, 'tcp:7345');
  const health = await step('the phone core answers /api/health', 120, async () => {
    const reply = await core('/api/health');
    return reply.status === 200 && reply.body.status === 'ok' ? reply.body : null;
  });
  if (health.mode !== 'standalone') throw new Error(`expected the phone's own core, got mode ${health.mode}`);

  await step('the sign-in screen is showing', 180, async () =>
    (await evaluate("document.querySelector('.gate h1')?.textContent ?? ''")) === 'Sign in to TVM');
  await step('it has the "I\'m a dev" button', 30, async () =>
    (await evaluate("[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === \"I'm a dev\")")) === true);

  // One real round trip through the phone's account code.
  const signUp = { email: 'smoke@example.com', password: 'a good long password' };
  await step('an account can be created', 90, async () => {
    const reply = await core('/api/account/register', { method: 'POST', body: JSON.stringify(signUp) });
    // A retry after a slow first attempt finds the account already there.
    if (reply.status !== 200 && !String(reply.body.error).includes('could not be created')) throw new Error(JSON.stringify(reply.body));
    return true;
  });
  const token = await step('it can sign in', 90, async () => {
    const reply = await core('/api/account/signin', { method: 'POST', body: JSON.stringify(signUp) });
    if (reply.status !== 200) throw new Error(JSON.stringify(reply.body));
    return reply.body.token;
  });
  await step('the account waits to be switched on', 60, async () => {
    const me = await core('/api/account', { headers: { authorization: `Bearer ${token}` } });
    if (me.body.usable?.reason !== 'awaiting_activation' || me.body.account?.role !== 'member') {
      throw new Error(JSON.stringify(me.body));
    }
    return true;
  });

  const crashes = adb('logcat', '-d', '-b', 'crash');
  if (crashes.includes(PACKAGE)) throw new Error(`TVM crashed:\n${crashes.slice(-2000)}`);
  if (adb('shell', 'pidof', PACKAGE).trim() === '') throw new Error('TVM is no longer running');
  collect();
  console.log('TVM installs, opens and works on Android.');
} catch (error) {
  const log = collect();
  const relevant = log
    .split('\n')
    .filter((line) => /privateclient|AndroidRuntime|chromium|cr_|WebView|FATAL|TVM/i.test(line))
    .slice(-25)
    .join('\n');
  annotate('error', `${error instanceof Error ? error.message : String(error)}\n--- logcat ---\n${relevant}`);
  process.exit(1);
}
