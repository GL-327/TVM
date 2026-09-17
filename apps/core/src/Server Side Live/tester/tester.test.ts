import { createDecipheriv } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_HOST } from '../../config.ts';
import { startCoreServer, type RunningCore } from '../../server.ts';
import { resetServerSideLive } from '../routes.ts';
import {
  startTesterPanel,
  STRICT_USER_AGENT,
  TESTER_CHANNELS,
  type TesterChannel,
  type TesterPanel,
} from './panel.ts';
import { presentationTimes, shiftTimestamps } from './tsclock.ts';

const channel = (id: number): TesterChannel => TESTER_CHANNELS.find((entry) => entry.id === id)!;

/** Every URI a playlist points at: plain lines and URI="..." attributes. */
function uris(playlist: string): string[] {
  const out: string[] = [];
  for (const line of playlist.split('\n').map((entry) => entry.trim())) {
    if (line === '') continue;
    if (line.startsWith('#')) {
      for (const match of line.matchAll(/URI="([^"]+)"/g)) out.push(match[1]!);
      continue;
    }
    out.push(line);
  }
  return out;
}

function mediaSequence(playlist: string): number {
  return Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(playlist)?.[1] ?? NaN);
}

/** Reads the first `limit` bytes of a never-ending response, then lets go. */
async function head(response: Response, limit: number): Promise<Buffer> {
  const reader = response.body!.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (size < limit) {
    const next = await reader.read();
    if (next.done) break;
    parts.push(next.value);
    size += next.value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(parts);
}

describe('the IPTV tester panel', () => {
  let panel: TesterPanel;

  beforeAll(async () => {
    panel = await startTesterPanel({ tsSeconds: 20 });
  });

  afterAll(async () => {
    await panel.close();
  });

  it('answers an Xtream login, and refuses a wrong one', async () => {
    const ok = (await (await fetch(`${panel.origin}/player_api.php?username=tvm&password=tester`)).json()) as { user_info: { auth: number } };
    expect(ok.user_info.auth).toBe(1);
    const wrong = (await (await fetch(`${panel.origin}/player_api.php?username=tvm&password=nope`)).json()) as { user_info: { auth: number } };
    expect(wrong.user_info.auth).toBe(0);
    const streams = (await (await fetch(`${panel.origin}/player_api.php?username=tvm&password=tester&action=get_live_streams`)).json()) as unknown[];
    expect(streams).toHaveLength(TESTER_CHANNELS.length);
    expect((await fetch(`${panel.origin}/get.php?username=tvm&password=nope`)).status).toBe(401);
  });

  it('declares the strict channel\'s headers in its playlist, the way real providers do', async () => {
    const text = await (await fetch(panel.playlistUrl())).text();
    expect(text).toContain(`#EXTVLCOPT:http-user-agent=${STRICT_USER_AGENT}`);
    expect(text).toContain(`#EXTVLCOPT:http-referrer=${panel.strictReferer}`);
    expect((await fetch(`${panel.origin}/live/tvm/tester/103.m3u8`)).status).toBe(403);
    const allowed = await fetch(`${panel.origin}/live/tvm/tester/103.m3u8`, {
      headers: { 'user-agent': STRICT_USER_AGENT, referer: panel.strictReferer },
    });
    expect(allowed.status).toBe(200);
  });

  /*
   * The loop must look live. Three segments replayed as they are would send
   * the clock back six seconds every loop, and a player drops the stream.
   */
  it('moves its loop along the timeline so the clock never runs backwards', () => {
    const times = [0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap((sequence) => presentationTimes(panel.segmentBytes(channel(101), sequence)));
    expect(times.length).toBeGreaterThan(100);
    const first = Math.min(...times);
    const last = Math.max(...times);
    // Nine two-second segments span eighteen seconds of timeline.
    expect(last - first).toBeGreaterThan(16);
    expect(last - first).toBeLessThan(19);
    // The same fixture, two loops apart, is exactly twelve seconds later.
    const early = presentationTimes(panel.segmentBytes(channel(101), 1));
    const late = presentationTimes(panel.segmentBytes(channel(101), 7));
    expect(late[0]! - early[0]!).toBeCloseTo(12, 5);
  });

  it('re-times a clip without disturbing anything else in it', () => {
    const clip = panel.segmentBytes(channel(101), 0);
    const moved = shiftTimestamps(clip, 100);
    expect(moved.length).toBe(clip.length);
    const before = presentationTimes(clip);
    const after = presentationTimes(moved);
    expect(after.map((time, index) => time - before[index]!)).toEqual(before.map(() => expect.closeTo(100, 5)));
    let differing = 0;
    for (let index = 0; index < clip.length; index += 1) if (clip[index] !== moved[index]) differing += 1;
    // Only timestamp bytes change: a few per PES header and PCR.
    expect(differing).toBeLessThan(before.length * 12 + 400);
  });

  it('streams raw MPEG-TS continuously', async () => {
    const response = await fetch(`${panel.origin}/live/tvm/tester/104.ts`);
    expect(response.headers.get('content-type')).toBe('video/mp2t');
    const bytes = await head(response, 300_000);
    expect(bytes[0]).toBe(0x47);
    expect(bytes[188]).toBe(0x47);
    const times = presentationTimes(bytes);
    // Several fixtures in a row, and still moving forward across each join.
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(6);
  });
});

describe('Server Side Live against the tester', () => {
  let panel: TesterPanel;
  let core: RunningCore;
  let dataDir: string;
  let base: string;
  let plays: Map<number, string>;

  beforeAll(async () => {
    resetServerSideLive();
    panel = await startTesterPanel({ tsSeconds: 20 });
    dataDir = await mkdtemp(join(tmpdir(), 'tvm-tester-ssl-'));
    core = await startCoreServer(0, { dataDir, env: {} });
    base = `http://${CORE_HOST}:${core.port}`;
    const loaded = await fetch(`${base}/api/live/sources`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: panel.playlistUrl() }),
    });
    expect(loaded.status).toBe(200);
    const listed = (await (await fetch(`${base}/api/live/sources`)).json()) as { channels: Array<{ name: string; play: string }> };
    plays = new Map(
      listed.channels.map((entry) => [TESTER_CHANNELS.find((item) => item.name === entry.name)!.id, entry.play]),
    );
  });

  afterAll(async () => {
    await core.close();
    await panel.close();
    await rm(dataDir, { recursive: true, force: true });
    resetServerSideLive();
  });

  it('hands out Core addresses only', () => {
    expect(plays.size).toBe(TESTER_CHANNELS.length);
    for (const play of plays.values()) {
      expect(play.startsWith(`${base}/api/live/proxy/`)).toBe(true);
      expect(play).not.toContain(panel.origin);
      expect(play).not.toContain('tester');
    }
  });

  it('reflects live HLS completely: master, both renditions and every segment', async () => {
    const master = await (await fetch(plays.get(101)!)).text();
    expect(master).toContain('#EXT-X-STREAM-INF');
    expect(master).not.toContain(panel.origin);
    const variants = uris(master);
    expect(variants).toHaveLength(2);
    for (const variant of variants) {
      expect(variant).toMatch(/^(\/api\/live\/proxy\/|http:\/\/127\.0\.0\.1:\d+\/api\/live\/proxy\/)/);
      const media = await (await fetch(new URL(variant, base))).text();
      expect(media).not.toContain(panel.origin);
      const segments = uris(media);
      expect(segments.length).toBeGreaterThan(0);
      const sequence = mediaSequence(media);
      const first = await fetch(new URL(segments[0]!, base));
      expect(first.status).toBe(200);
      // Byte for byte what the panel serves: the reflect changes addresses, never video.
      expect(Buffer.from(await first.arrayBuffer()).equals(panel.segmentBytes(channel(101), sequence))).toBe(true);
    }
  });

  it('reflects the AES-128 key, and the segment decrypts to the picture', async () => {
    const master = await (await fetch(plays.get(102)!)).text();
    const media = await (await fetch(new URL(uris(master)[0]!, base))).text();
    const key = /#EXT-X-KEY:METHOD=AES-128,URI="([^"]+)"/.exec(media)?.[1];
    expect(key).toBeDefined();
    expect(key).toContain('/api/live/proxy/');
    const keyBytes = Buffer.from(await (await fetch(new URL(key!, base))).arrayBuffer());
    expect(keyBytes.equals(panel.key)).toBe(true);

    const sequence = mediaSequence(media);
    const segment = Buffer.from(await (await fetch(new URL(uris(media).find((uri) => !uri.includes(key!)) ?? '', base))).arrayBuffer());
    const iv = Buffer.alloc(16);
    iv.writeBigUInt64BE(BigInt(sequence), 8);
    const decipher = createDecipheriv('aes-128-cbc', keyBytes, iv);
    const plain = Buffer.concat([decipher.update(segment), decipher.final()]);
    expect(plain.equals(panel.segmentBytes(channel(101), sequence))).toBe(true);
    expect(plain[0]).toBe(0x47);
  });

  it('sends a strict panel the headers its playlist asked for, on every request', async () => {
    const before = panel.requests.length;
    const master = await fetch(plays.get(103)!);
    expect(master.status).toBe(200);
    const media = await (await fetch(new URL(uris(await master.text())[0]!, base))).text();
    const segment = await fetch(new URL(uris(media)[0]!, base));
    expect(segment.status).toBe(200);
    // The whole body, not just the status: a cached segment once hung here.
    const bytes = Buffer.from(await segment.arrayBuffer());
    expect(bytes.equals(panel.segmentBytes(channel(103), mediaSequence(media)))).toBe(true);
    const seen = panel.requests.slice(before);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const entry of seen) {
      expect(entry.status).toBe(200);
      expect(entry.userAgent).toBe(STRICT_USER_AGENT);
      expect(entry.referer).toBe(panel.strictReferer);
    }
  });

  it('carries a raw MPEG-TS channel', async () => {
    const response = await fetch(plays.get(104)!);
    expect(response.status).toBe(200);
    const bytes = await head(response, 60_000);
    expect(bytes[0]).toBe(0x47);
  });

  it('never lets a client, or its credentials, reach the panel', () => {
    expect(panel.requests.length).toBeGreaterThan(0);
    for (const entry of panel.requests) {
      expect(entry.authorization).toBe(false);
      // Core speaks as a player; a browser or Node default here would mean a leak.
      expect(entry.userAgent === STRICT_USER_AGENT || entry.userAgent.startsWith('VLC/')).toBe(true);
    }
  });
});

describe('the Live TV screen path against the tester', () => {
  let panel: TesterPanel;
  let core: RunningCore;
  let dataDir: string;
  let base: string;

  beforeAll(async () => {
    resetServerSideLive();
    panel = await startTesterPanel({ tsSeconds: 20 });
    dataDir = await mkdtemp(join(tmpdir(), 'tvm-tester-live-'));
    core = await startCoreServer(0, { dataDir, env: {} });
    base = `http://${CORE_HOST}:${core.port}`;
  });

  afterAll(async () => {
    await core.close();
    await panel.close();
    await rm(dataDir, { recursive: true, force: true });
    resetServerSideLive();
  });

  async function catalog(): Promise<Array<{ id: string; name: string }>> {
    const body = (await (await fetch(`${base}/api/live/catalog?limit=24`)).json()) as { items: Array<{ id: string; name: string }> };
    return body.items;
  }

  it('plays a pasted playlist through the hop, headers and all', async () => {
    const saved = await fetch(`${base}/api/live`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: panel.playlistUrl() }),
    });
    expect(saved.status).toBe(200);
    const items = await catalog();
    expect(items.map((item) => item.name)).toEqual(TESTER_CHANNELS.map((item) => item.name));
    // Nothing about the panel is in what the interface is given.
    expect(JSON.stringify(items)).not.toContain(panel.origin);

    for (const id of [101, 102, 103]) {
      const item = items.find((entry) => entry.name === channel(id).name)!;
      const playRes = await fetch(`${base}/api/playback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      });
      expect(playRes.status, channel(id).name).toBe(200);
      const play = (await playRes.json()) as { url?: string };
      expect(play.url, channel(id).name).toMatch(/\/api\/live\/proxy\//);
      const master = await fetch(play.url!);
      expect(master.status, channel(id).name).toBe(200);
      const text = await master.text();
      expect(text).not.toContain(panel.origin);
      const media = await (await fetch(new URL(uris(text)[0]!, base))).text();
      expect(media).not.toContain(panel.origin);
      const sequence = mediaSequence(media);
      const segments = uris(media).filter((uri) => !media.includes(`URI="${uri}"`));
      const segment = await fetch(new URL(segments[0]!, base));
      expect(segment.status, channel(id).name).toBe(200);
      const bytes = Buffer.from(await segment.arrayBuffer());
      expect(bytes.equals(panel.segmentBytes(channel(id), sequence)), channel(id).name).toBe(true);
    }

    // The strict channel only works because the playlist's #EXTVLCOPT lines
    // now travel with the channel and every hop minted from it.
    const strict = panel.requests.filter((entry) => entry.path.includes('/103.') || entry.path.startsWith('/hls/103/'));
    expect(strict.length).toBeGreaterThanOrEqual(3);
    for (const entry of strict) {
      expect(entry.status).toBe(200);
      expect(entry.userAgent).toBe(STRICT_USER_AGENT);
      expect(entry.referer).toBe(panel.strictReferer);
    }
  });

  it('plays an Xtream login as raw MPEG-TS', async () => {
    const saved = await fetch(`${base}/api/live/xtream`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(panel.xtream),
    });
    expect(saved.status).toBe(200);
    const items = await catalog();
    expect(items.map((item) => item.id)).toEqual(TESTER_CHANNELS.map((item) => `live:xtream:${item.id}`));
    const playRes = await fetch(`${base}/api/playback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'live:xtream:104' }),
    });
    expect(playRes.status).toBe(200);
    const play = (await playRes.json()) as { url?: string; mimeType?: string };
    expect(play.url).toMatch(/\/api\/live\/proxy\//);
    const response = await fetch(play.url!);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp2t');
    const bytes = await head(response, 60_000);
    expect(bytes[0]).toBe(0x47);
    expect(presentationTimes(bytes).length).toBeGreaterThan(0);
  });

  it('never forwards a client credential to the panel', () => {
    for (const entry of panel.requests) expect(entry.authorization).toBe(false);
  });
});
