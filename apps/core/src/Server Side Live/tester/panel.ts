import { createCipheriv, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shiftTimestamps, type ContinuityState } from './tsclock.ts';

/**
 * A pretend IPTV panel, for testing the proxy without a subscription.
 *
 * It behaves the way real panels do, including the ways they are awkward:
 *
 *   - an Xtream Codes API (player_api.php, get.php) with a login
 *   - live HLS with a sliding window, a master playlist, two renditions and
 *     relative segment paths
 *   - an AES-128 encrypted channel whose key sits on the panel
 *   - a channel that answers 403 unless the request carries the User-Agent
 *     and Referer the panel expects, declared in the playlist with the
 *     #EXTVLCOPT lines real providers use
 *   - a raw, never-ending MPEG-TS channel, which is what Xtream serves by default
 *
 * The picture is a synthetic test pattern made with FFmpeg (see
 * fixtures/README.md); nothing here is anyone's programme. Every request is
 * logged with the headers that matter, so a test can prove not only that a
 * stream played but that it went through Core with the right headers.
 */

export const TESTER_USERNAME = 'tvm';
export const TESTER_PASSWORD = 'tester';
/** What the strict channel insists on, as a real panel would. */
export const STRICT_USER_AGENT = 'TVM-Tester-Player/1.0';
export const SEGMENT_SECONDS = 2;
const LOOP_SECONDS = 6;
const WINDOW = 5;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export interface TesterChannel {
  id: number;
  name: string;
  kind: 'hls' | 'encrypted' | 'strict' | 'ts';
  group: string;
}

export const TESTER_CHANNELS: readonly TesterChannel[] = [
  { id: 101, name: 'Tester One — live HLS', kind: 'hls', group: 'TVM Tester' },
  { id: 102, name: 'Tester Two — encrypted HLS', kind: 'encrypted', group: 'TVM Tester' },
  { id: 103, name: 'Tester Three — needs panel headers', kind: 'strict', group: 'TVM Tester' },
  { id: 104, name: 'Tester Four — raw MPEG-TS', kind: 'ts', group: 'TVM Tester' },
];

export interface PanelRequest {
  at: number;
  method: string;
  path: string;
  status: number;
  userAgent: string;
  referer: string;
  /** Authorization reached the panel. It never should: Core's LAN token is Core's. */
  authorization: boolean;
}

export interface TesterPanelOptions {
  host?: string;
  port?: number;
  /** Seconds a raw TS request streams before ending. */
  tsSeconds?: number;
  /** Clock, for tests. */
  now?: () => number;
  /** Called for each request, after it is answered. */
  onRequest?: (entry: PanelRequest) => void;
}

export interface TesterPanel {
  origin: string;
  playlistUrl: (output?: 'm3u8' | 'ts') => string;
  xtream: { host: string; username: string; password: string };
  strictReferer: string;
  requests: PanelRequest[];
  /** The exact bytes of segment `sequence` of a channel, as the panel serves them. */
  segmentBytes: (channel: TesterChannel, sequence: number) => Buffer;
  key: Buffer;
  close: () => Promise<void>;
}

function loadFixtures(): Buffer[] {
  return [0, 1, 2].map((index) => readFileSync(join(FIXTURES, `seg${index}.mpegts`)));
}

function channelFor(id: string | number): TesterChannel | undefined {
  return TESTER_CHANNELS.find((channel) => String(channel.id) === String(id));
}

export async function startTesterPanel(options: TesterPanelOptions = {}): Promise<TesterPanel> {
  const fixtures = loadFixtures();
  const now = options.now ?? (() => Date.now());
  const started = now();
  const key = randomBytes(16);
  const requests: PanelRequest[] = [];
  const tsSeconds = options.tsSeconds ?? 3600;
  let origin = '';

  const liveSequence = (): number => Math.floor((now() - started) / 1000 / SEGMENT_SECONDS) + WINDOW;

  /** Segment n is fixture n mod 3, moved on by as many whole loops as have passed. */
  const clip = (sequence: number, continuity?: ContinuityState): Buffer => {
    const loops = Math.floor(sequence / fixtures.length);
    return Buffer.from(shiftTimestamps(fixtures[sequence % fixtures.length]!, loops * LOOP_SECONDS, continuity));
  };

  const segmentBytes = (channel: TesterChannel, sequence: number): Buffer => {
    const plain = clip(sequence);
    if (channel.kind !== 'encrypted') return plain;
    // AES-128 with no IV attribute: the IV is the media sequence number.
    const iv = Buffer.alloc(16);
    iv.writeBigUInt64BE(BigInt(sequence), 8);
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    return Buffer.concat([cipher.update(plain), cipher.final()]);
  };

  const strictReferer = (): string => `${origin}/portal/`;

  const loggedIn = (username: string | null | undefined, password: string | null | undefined): boolean =>
    username === TESTER_USERNAME && password === TESTER_PASSWORD;

  const m3u = (output: 'm3u8' | 'ts'): string => {
    const lines = ['#EXTM3U'];
    for (const channel of TESTER_CHANNELS) {
      lines.push(`#EXTINF:-1 tvg-id="tester-${channel.id}" tvg-name="${channel.name}" group-title="${channel.group}",${channel.name}`);
      if (channel.kind === 'strict') {
        // How real playlists tell a player what the panel will accept.
        lines.push(`#EXTVLCOPT:http-user-agent=${STRICT_USER_AGENT}`);
        lines.push(`#EXTVLCOPT:http-referrer=${strictReferer()}`);
      }
      const extension = channel.kind === 'ts' ? 'ts' : output === 'ts' && channel.kind === 'hls' ? 'ts' : 'm3u8';
      lines.push(`${origin}/live/${TESTER_USERNAME}/${TESTER_PASSWORD}/${channel.id}.${extension}`);
    }
    return `${lines.join('\n')}\n`;
  };

  const master = (channel: TesterChannel): string => [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-STREAM-INF:BANDWIDTH=320000,AVERAGE-BANDWIDTH=300000,RESOLUTION=480x270,CODECS="avc1.4d401e,mp4a.40.2",FRAME-RATE=25',
    // Root-relative here and absolute below: the rewrite has to handle every form.
    `/hls/${channel.id}/high.m3u8`,
    '#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=480x270,CODECS="avc1.4d401e,mp4a.40.2",FRAME-RATE=25',
    `${origin}/hls/${channel.id}/low.m3u8`,
    '',
  ].join('\n');

  const media = (channel: TesterChannel, rendition: string): string => {
    const last = liveSequence();
    const first = Math.max(0, last - WINDOW + 1);
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,
      `#EXT-X-MEDIA-SEQUENCE:${first}`,
    ];
    if (channel.kind === 'encrypted') {
      lines.push(`#EXT-X-KEY:METHOD=AES-128,URI="${origin}/keys/${channel.id}.key"`);
    }
    for (let sequence = first; sequence <= last; sequence += 1) {
      lines.push(`#EXTINF:${SEGMENT_SECONDS.toFixed(3)},`);
      lines.push(`${rendition}/${sequence}.ts`);
    }
    return `${lines.join('\n')}\n`;
  };

  const send = (response: ServerResponse, status: number, type: string, body: string | Buffer): void => {
    response.writeHead(status, {
      'content-type': type,
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    });
    response.end(body);
  };

  const streamTs = (request: IncomingMessage, response: ServerResponse): void => {
    response.writeHead(200, { 'content-type': 'video/mp2t', 'cache-control': 'no-store' });
    const continuity: ContinuityState = new Map();
    const deadline = now() + tsSeconds * 1000;
    // Start a few seconds "behind live" so a player has something to buffer at once.
    let sequence = liveSequence() - 2;
    let stopped = false;
    const stop = (): void => { stopped = true; };
    request.on('close', stop);
    response.on('close', stop);
    const pump = (): void => {
      if (stopped) return;
      if (now() >= deadline) {
        response.end();
        return;
      }
      const chunk = clip(sequence, continuity);
      sequence += 1;
      // Segment s goes live (s - WINDOW) segments after the panel started.
      const wait = Math.max(0, started + (sequence - WINDOW) * SEGMENT_SECONDS * 1000 - now());
      if (response.write(chunk)) setTimeout(pump, wait);
      else response.once('drain', () => setTimeout(pump, wait));
    };
    pump();
  };

  const handle = (request: IncomingMessage, response: ServerResponse): void => {
    const url = new URL(request.url ?? '/', 'http://panel.invalid');
    const path = url.pathname;
    const params = url.searchParams;
    const userAgent = request.headers['user-agent'] ?? '';
    const referer = request.headers['referer'] ?? '';

    if (path === '/' || path === '/index.html') {
      send(response, 200, 'text/plain; charset=utf-8', `TVM IPTV tester\n\nPlaylist: ${origin}/get.php?username=${TESTER_USERNAME}&password=${TESTER_PASSWORD}&type=m3u_plus&output=m3u8\n`);
      return;
    }

    if (path === '/player_api.php') {
      if (!loggedIn(params.get('username'), params.get('password'))) {
        send(response, 200, 'application/json', JSON.stringify({ user_info: { auth: 0 } }));
        return;
      }
      const action = params.get('action') ?? '';
      if (action === 'get_live_categories') {
        send(response, 200, 'application/json', JSON.stringify([{ category_id: '9', category_name: 'TVM Tester', parent_id: 0 }]));
        return;
      }
      if (action === 'get_live_streams') {
        send(response, 200, 'application/json', JSON.stringify(TESTER_CHANNELS.map((channel, index) => ({
          num: index + 1,
          name: channel.name,
          stream_type: 'live',
          stream_id: channel.id,
          stream_icon: '',
          category_id: '9',
        }))));
        return;
      }
      send(response, 200, 'application/json', JSON.stringify({
        user_info: { username: TESTER_USERNAME, auth: 1, status: 'Active', max_connections: '4', active_cons: '0' },
        server_info: { url: new URL(origin).hostname, port: new URL(origin).port, server_protocol: 'http' },
      }));
      return;
    }

    if (path === '/get.php') {
      if (!loggedIn(params.get('username'), params.get('password'))) {
        send(response, 401, 'text/plain', 'Unauthorized');
        return;
      }
      send(response, 200, 'audio/x-mpegurl', m3u(params.get('output') === 'ts' ? 'ts' : 'm3u8'));
      return;
    }

    if (path === '/tester.m3u') {
      send(response, 200, 'audio/x-mpegurl', m3u('m3u8'));
      return;
    }

    const live = /^\/live\/([^/]+)\/([^/]+)\/(\d+)\.(m3u8|ts)$/.exec(path);
    if (live !== null) {
      const channel = channelFor(live[3]!);
      if (!loggedIn(decodeURIComponent(live[1]!), decodeURIComponent(live[2]!)) || channel === undefined) {
        send(response, 404, 'text/plain', 'Not Found');
        return;
      }
      if (channel.kind === 'strict' && (userAgent !== STRICT_USER_AGENT || referer !== strictReferer())) {
        send(response, 403, 'text/plain', 'Forbidden: this panel only serves its own player');
        return;
      }
      if (live[4] === 'ts') {
        // Xtream serves every channel as raw TS, whatever else it offers.
        streamTs(request, response);
        return;
      }
      if (channel.kind === 'ts') {
        send(response, 404, 'text/plain', 'Not Found');
        return;
      }
      send(response, 200, 'application/vnd.apple.mpegurl', master(channel));
      return;
    }

    const playlist = /^\/hls\/(\d+)\/(high|low)\.m3u8$/.exec(path);
    if (playlist !== null) {
      const channel = channelFor(playlist[1]!);
      if (channel === undefined || channel.kind === 'ts') {
        send(response, 404, 'text/plain', 'Not Found');
        return;
      }
      if (channel.kind === 'strict' && (userAgent !== STRICT_USER_AGENT || referer !== strictReferer())) {
        send(response, 403, 'text/plain', 'Forbidden');
        return;
      }
      send(response, 200, 'application/vnd.apple.mpegurl', media(channel, playlist[2]!));
      return;
    }

    const segment = /^\/hls\/(\d+)\/(high|low)\/(\d+)\.ts$/.exec(path);
    if (segment !== null) {
      const channel = channelFor(segment[1]!);
      const sequence = Number(segment[3]);
      // A segment that has not happened yet, or fell out of the window long ago.
      if (channel === undefined || channel.kind === 'ts' || sequence > liveSequence() || sequence < liveSequence() - 60) {
        send(response, 404, 'text/plain', 'Not Found');
        return;
      }
      if (channel.kind === 'strict' && (userAgent !== STRICT_USER_AGENT || referer !== strictReferer())) {
        send(response, 403, 'text/plain', 'Forbidden');
        return;
      }
      send(response, 200, 'video/mp2t', segmentBytes(channel, sequence));
      return;
    }

    const keyFile = /^\/keys\/(\d+)\.key$/.exec(path);
    if (keyFile !== null && channelFor(keyFile[1]!)?.kind === 'encrypted') {
      send(response, 200, 'application/octet-stream', key);
      return;
    }

    send(response, 404, 'text/plain', 'Not Found');
  };

  const server: Server = createServer((request, response) => {
    response.on('close', () => {
      const url = new URL(request.url ?? '/', 'http://panel.invalid');
      const entry: PanelRequest = {
        at: now(),
        method: request.method ?? 'GET',
        // Credentials in the path are the panel's own; keep them out of logs anyway.
        path: url.pathname.replace(`/${TESTER_USERNAME}/${TESTER_PASSWORD}/`, '/<user>/<pass>/'),
        status: response.statusCode,
        userAgent: request.headers['user-agent'] ?? '',
        referer: request.headers['referer'] ?? '',
        authorization: request.headers['authorization'] !== undefined,
      };
      requests.push(entry);
      if (requests.length > 5000) requests.splice(0, requests.length - 5000);
      options.onRequest?.(entry);
    });
    try {
      handle(request, response);
    } catch {
      if (!response.headersSent) send(response, 500, 'text/plain', 'Internal Server Error');
      else response.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  origin = `http://${host}:${address.port}`;

  return {
    origin,
    playlistUrl: (output = 'm3u8') =>
      `${origin}/get.php?username=${TESTER_USERNAME}&password=${TESTER_PASSWORD}&type=m3u_plus&output=${output}`,
    xtream: { host: origin, username: TESTER_USERNAME, password: TESTER_PASSWORD },
    strictReferer: strictReferer(),
    requests,
    segmentBytes,
    key,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
