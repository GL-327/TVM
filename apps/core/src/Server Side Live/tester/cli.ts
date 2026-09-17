/**
 * The IPTV tester, from a terminal.
 *
 *   node "apps/core/src/Server Side Live/tester/cli.ts"            run the pretend panel
 *   node "apps/core/src/Server Side Live/tester/cli.ts" --check    also prove both proxy paths
 *                                                                  against a running Core
 *
 * Options: --port 7390 (panel), --core http://127.0.0.1:7345 (for --check).
 *
 * The panel keeps running until Ctrl+C, so it can be typed into TVM as a real
 * provider: Settings → Live TV, either the playlist address or the Xtream
 * login it prints. Every request it receives is printed with the User-Agent
 * and Referer it arrived with, which is the quickest way to see what the proxy
 * actually sends.
 */
import { startTesterPanel, STRICT_USER_AGENT, TESTER_CHANNELS, type TesterPanel } from './panel.ts';

const args = process.argv.slice(2);
const option = (name: string, fallback: string): string => {
  const at = args.indexOf(`--${name}`);
  return at !== -1 && args[at + 1] !== undefined ? args[at + 1]! : fallback;
};
const port = Number(option('port', '7390'));
const coreOrigin = option('core', `http://127.0.0.1:${process.env['TVM_CORE_PORT'] ?? '7345'}`).replace(/\/+$/, '');
const quiet = args.includes('--quiet');

function row(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail !== '' ? ` — ${detail}` : ''}`);
}

function listed(playlist: string): string[] {
  return playlist
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => (line.startsWith('#') ? [...line.matchAll(/URI="([^"]+)"/g)].map((match) => match[1]!) : line === '' ? [] : [line]));
}

async function firstBytes(url: string, limit: number): Promise<{ status: number; bytes: Buffer }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok || response.body === null) return { status: response.status, bytes: Buffer.alloc(0) };
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value);
    size += next.value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return { status: response.status, bytes: Buffer.concat(parts) };
}

/** Follows one channel through Core: playlist → rendition → first segment. */
async function playThrough(url: string, panel: TesterPanel): Promise<string | null> {
  const master = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!master.ok) return `playlist answered ${master.status}`;
  const text = await master.text();
  if (text.includes(panel.origin)) return 'the playlist still names the panel';
  if (!text.startsWith('#EXTM3U')) return 'Core did not return a playlist';
  const variant = listed(text)[0];
  if (variant === undefined) return 'the playlist lists nothing';
  const media = await (await fetch(new URL(variant, coreOrigin), { signal: AbortSignal.timeout(15_000) })).text();
  if (media.includes(panel.origin)) return 'the rendition still names the panel';
  const segment = listed(media).find((uri) => !media.includes(`URI="${uri}"`));
  if (segment === undefined) return 'the rendition lists no segments';
  const { status, bytes } = await firstBytes(new URL(segment, coreOrigin).href, 4096);
  if (status !== 200) return `the first segment answered ${status}`;
  return bytes[0] === 0x47 ? null : 'the first segment is not MPEG-TS';
}

async function check(panel: TesterPanel): Promise<boolean> {
  console.log(`\nChecking ${coreOrigin} against the tester…`);
  let failures = 0;
  const fail = (label: string, detail: string): void => { failures += 1; row(false, label, detail); };

  const health = await fetch(`${coreOrigin}/api/health`).catch(() => null);
  if (health === null || !health.ok) {
    row(false, 'Core is running', `nothing answered at ${coreOrigin}`);
    return false;
  }
  row(true, 'Core is running');

  // Server Side Live. This replaces its channel list, which nothing else uses yet.
  const put = await fetch(`${coreOrigin}/api/live/sources`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: panel.playlistUrl() }),
  });
  if (!put.ok) {
    fail('Server Side Live loads the playlist', `answered ${put.status}`);
  } else {
    row(true, 'Server Side Live loads the playlist');
    const sources = (await (await fetch(`${coreOrigin}/api/live/sources`)).json()) as { channels: Array<{ name: string; play: string }> };
    for (const channel of TESTER_CHANNELS) {
      const entry = sources.channels.find((item) => item.name === channel.name);
      if (entry === undefined) { fail(`Server Side Live: ${channel.name}`, 'missing from the channel list'); continue; }
      if (channel.kind === 'ts') {
        const { status, bytes } = await firstBytes(entry.play, 8192);
        if (status === 200 && bytes[0] === 0x47) row(true, `Server Side Live: ${channel.name}`);
        else fail(`Server Side Live: ${channel.name}`, `answered ${status}`);
        continue;
      }
      const problem = await playThrough(entry.play, panel).catch((error: unknown) => String(error));
      if (problem === null) row(true, `Server Side Live: ${channel.name}`);
      else fail(`Server Side Live: ${channel.name}`, problem);
    }
  }

  const leaked = panel.requests.filter((entry) => entry.authorization);
  if (leaked.length > 0) fail('no client credential reaches the panel', `${leaked.length} requests carried Authorization`);
  else row(true, 'no client credential reaches the panel');
  const strict = panel.requests.filter((entry) => entry.path.includes('/103.') || entry.path.startsWith('/hls/103/'));
  const wrong = strict.filter((entry) => entry.userAgent !== STRICT_USER_AGENT || entry.referer !== panel.strictReferer);
  if (strict.length > 0 && wrong.length === 0) row(true, 'the strict channel got its own User-Agent and Referer every time');
  else fail('the strict channel got its own User-Agent and Referer every time', `${wrong.length} of ${strict.length} did not`);

  console.log('');
  console.log(failures === 0 ? 'Every check passed.' : `${failures} check${failures === 1 ? '' : 's'} failed.`);
  console.log('The Live TV screen path is exercised by the automated suite; to try it by hand, use the addresses above in Settings → Live TV.');
  return failures === 0;
}

const host = process.env['TVM_LIVE_TESTER_HOST'] === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';

const panel = await startTesterPanel({
  port,
  host,
  onRequest: quiet
    ? undefined
    : (entry) => {
        const who = entry.userAgent === '' ? '(no user-agent)' : entry.userAgent;
        const from = entry.referer === '' ? '' : `  referer=${entry.referer}`;
        console.log(`  ${entry.status} ${entry.method} ${entry.path}  ua=${who}${from}`);
      },
});

console.log('TVM IPTV tester is running.');
if (host === '127.0.0.1') {
  console.log('Listening on loopback only. Set TVM_LIVE_TESTER_HOST=0.0.0.0 if other devices should reach this panel.');
}
console.log('');
console.log(`  Playlist (M3U):   ${panel.playlistUrl()}`);
console.log(`  Xtream login:     server ${panel.xtream.host}   user ${panel.xtream.username}   password ${panel.xtream.password}`);
console.log('');
console.log('  Channels:');
for (const channel of TESTER_CHANNELS) console.log(`    ${channel.id}  ${channel.name}`);
console.log('');
console.log('  In TVM: Settings → Live TV, paste the playlist address, or use the Xtream login.');
console.log('  The picture is a synthetic test pattern with a tone. Press Ctrl+C to stop.');
console.log('');

if (args.includes('--check')) {
  const passed = await check(panel);
  if (!args.includes('--stay')) {
    await panel.close();
    process.exit(passed ? 0 : 1);
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void panel.close().finally(() => process.exit(0));
  });
}
