import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { livePlaylistPath } from '../update/paths.ts';
import { isHttpUrl } from './title.ts';
import type { LiveChannel, LiveStatus, PlaybackResolution } from './types.ts';

export interface LiveService {
  status(): Promise<LiveStatus>;
  setPlaylist(url: string): Promise<LiveStatus>;
  play(id: string): Promise<PlaybackResolution>;
}

export interface LiveServiceOptions {
  dataDir: string;
  fetch?: typeof fetch;
  includeMock?: () => boolean;
}

const MUX = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const BIPBOP =
  'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8';

export const MOCK_LIVE_CHANNELS: readonly LiveChannel[] = [
  { id: 'live:mock:sky-sports', name: 'Sky Sports', url: MUX, group: 'Sports' },
  { id: 'live:mock:tnt-sports', name: 'TNT Sports', url: BIPBOP, group: 'Sports' },
  { id: 'live:mock:bein-sports', name: 'beIN Sports', url: MUX, group: 'Sports' },
  { id: 'live:mock:usa-network', name: 'USA Network', url: BIPBOP, group: 'Entertainment' },
];

const MAX_PLAYLIST_BYTES = 8_000_000;
const MAX_CHANNELS = 4_000;
const PLAYLIST_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function readStoredUrl(dataDir: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(livePlaylistPath(dataDir), 'utf8')) as { url?: unknown };
    return typeof parsed.url === 'string' && isHttpUrl(parsed.url) ? parsed.url : null;
  } catch {
    return null;
  }
}

function writeStoredUrl(dataDir: string, url: string): void {
  mkdirSync(dirname(livePlaylistPath(dataDir)), { recursive: true });
  writeFileSync(livePlaylistPath(dataDir), JSON.stringify({ url }));
}

function quotedAttribute(line: string, name: string): string | undefined {
  const double = line.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  if (double?.[1] !== undefined) return double[1];
  const single = line.match(new RegExp(`${name}='([^']*)'`, 'i'));
  if (single?.[1] !== undefined) return single[1];
  const bare = line.match(new RegExp(`${name}=([^,\\s]+)`, 'i'));
  return bare?.[1];
}

function isStreamUrl(value: string): boolean {
  return /^(https?|rtmp|rtsp|udp|rtp):\/\//i.test(value.trim());
}

function resolveUrl(raw: string, baseUrl: string | undefined): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (isStreamUrl(trimmed)) return trimmed;
  if (baseUrl === undefined) return null;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

function splitVlcUrl(line: string): { url: string; headers: Record<string, string> } {
  const pipe = line.indexOf('|');
  if (pipe === -1) return { url: line, headers: {} };
  const url = line.slice(0, pipe).trim();
  const headers: Record<string, string> = {};
  for (const part of line.slice(pipe + 1).split(/[&,]/)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = decodeURIComponent(part.slice(0, eq).trim());
    const value = decodeURIComponent(part.slice(eq + 1).trim());
    if (key === '') continue;
    if (/user-agent/i.test(key)) headers['User-Agent'] = value;
    else if (/referer/i.test(key)) headers['Referer'] = value;
    else headers[key] = value;
  }
  return { url, headers };
}

function applyHeader(target: Record<string, string>, line: string): void {
  const match = line.match(/^#EXTVLCOPT:(.+)$/i);
  if (match?.[1] === undefined) return;
  const spec = match[1];
  const eq = spec.indexOf('=');
  if (eq === -1) return;
  const key = spec.slice(0, eq).trim();
  const value = spec.slice(eq + 1).trim();
  if (/user-agent/i.test(key)) target['User-Agent'] = value;
  else if (/referer/i.test(key)) target['Referer'] = value;
}

export function parseM3u(text: string, baseUrl?: string): LiveChannel[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const channels: LiveChannel[] = [];
  let pending: { name: string; group?: string; logo?: string } | null = null;
  let groupHint: string | undefined;
  const headers: Record<string, string> = {};

  for (const raw of lines) {
    if (channels.length >= MAX_CHANNELS) break;
    const line = raw.trim();
    if (line === '' || line === '#EXTM3U' || /^#EXTM3U\s/i.test(line)) continue;

    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      const title = comma === -1 ? '' : line.slice(comma + 1).trim();
      const named = quotedAttribute(line, 'tvg-name');
      const group = quotedAttribute(line, 'group-title') ?? groupHint;
      const logo = quotedAttribute(line, 'tvg-logo');
      pending = {
        name: (named !== undefined && named !== '' ? named : title) || 'Channel',
        ...(group !== undefined && group !== '' ? { group } : {}),
        ...(logo !== undefined && logo !== '' ? { logo } : {}),
      };
      continue;
    }

    if (/^#EXTGRP:/i.test(line)) {
      const group = line.slice(line.indexOf(':') + 1).trim();
      groupHint = group === '' ? undefined : group;
      if (pending !== null && group !== '') pending.group = group;
      continue;
    }

    if (/^#EXTVLCOPT:/i.test(line)) {
      applyHeader(headers, line);
      continue;
    }

    if (line.startsWith('#')) continue;

    const split = splitVlcUrl(line);
    const url = resolveUrl(split.url, baseUrl);
    if (url === null) {
      pending = null;
      Object.keys(headers).forEach((key) => {
        delete headers[key];
      });
      continue;
    }

    const merged = { ...headers, ...split.headers };
    const name = pending?.name ?? `Channel ${channels.length + 1}`;
    const channel: LiveChannel = {
      id: `live:${channels.length}`,
      name,
      url,
      ...(pending?.group !== undefined ? { group: pending.group } : {}),
      ...(pending?.logo !== undefined ? { logo: pending.logo } : {}),
      ...(Object.keys(merged).length > 0 ? { headers: { ...merged } } : {}),
    };
    channels.push(channel);
    pending = null;
    Object.keys(headers).forEach((key) => {
      delete headers[key];
    });
  }

  return channels;
}

export function liveGroups(channels: readonly LiveChannel[]): string[] {
  const seen = new Set<string>();
  for (const channel of channels) {
    const group = (channel.group ?? '').trim();
    if (group !== '') seen.add(group);
  }
  if (seen.size === 0) return ['All'];
  return ['All', ...seen];
}

function isHls(url: string): boolean {
  return /\.m3u8(\?|$)/i.test(url) || /application\/vnd\.apple\.mpegurl/i.test(url);
}

function playbackFor(channel: LiveChannel): PlaybackResolution {
  const remote = /^https?:\/\//i.test(channel.url);
  const hls = isHls(channel.url);
  return {
    kind: 'stream',
    url: channel.url,
    title: channel.name,
    filename: channel.name,
    mimeType: hls ? 'application/vnd.apple.mpegurl' : remote ? 'video/mp4' : 'application/octet-stream',
    engine: remote ? 'html5' : 'native',
    ...(channel.headers !== undefined ? { headers: channel.headers } : {}),
  };
}

function looksLikeMediaPlaylist(text: string): boolean {
  return /^#EXTM3U/i.test(text.trim()) && /#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE)/i.test(text);
}

export function createLiveService(options: LiveServiceOptions): LiveService {
  const fetchImpl = options.fetch ?? fetch;
  const { dataDir } = options;

  const mockChannels = (): LiveChannel[] => (options.includeMock?.() === true ? [...MOCK_LIVE_CHANNELS] : []);

  const fetchPlaylist = async (url: string): Promise<Response> =>
    fetchImpl(url, {
      redirect: 'follow',
      headers: {
        'user-agent': PLAYLIST_UA,
        accept: 'application/vnd.apple.mpegurl, application/x-mpegurl, audio/mpegurl, text/plain, */*',
      },
    });

  const load = async (): Promise<LiveStatus> => {
    const mock = mockChannels();
    const url = readStoredUrl(dataDir);
    if (url === null) return { url: null, channels: mock, error: null };

    try {
      const response = await fetchPlaylist(url);
      if (!response.ok) return { url, channels: mock, error: mock.length > 0 ? null : 'unreachable' };
      const text = await response.text();
      if (text.length > MAX_PLAYLIST_BYTES) return { url, channels: mock, error: 'invalid' };
      if (looksLikeMediaPlaylist(text) || (parseM3u(text, url).length === 0 && /\.m3u8(\?|$)/i.test(url))) {
        return {
          url,
          channels: [...mock, { id: 'live:direct', name: 'Live playlist', url }],
          error: null,
        };
      }
      const channels = parseM3u(text, url);
      if (channels.length === 0 && mock.length === 0) return { url, channels: [], error: 'invalid' };
      return { url, channels: [...mock, ...channels], error: null };
    } catch {
      return { url, channels: mock, error: mock.length > 0 ? null : 'unreachable' };
    }
  };

  return {
    status: () => load(),

    async setPlaylist(value: string): Promise<LiveStatus> {
      const trimmed = value.trim();
      if (trimmed === '') {
        writeStoredUrl(dataDir, '');
        return { url: null, channels: mockChannels(), error: null };
      }
      if (!isHttpUrl(trimmed)) return { url: readStoredUrl(dataDir), channels: mockChannels(), error: 'invalid' };
      writeStoredUrl(dataDir, trimmed);
      return load();
    },

    async play(id: string): Promise<PlaybackResolution> {
      const mock = MOCK_LIVE_CHANNELS.find((entry) => entry.id === id);
      if (mock !== undefined) {
        if (options.includeMock?.() !== true) return { kind: 'unavailable', reason: 'region-blocked' };
        return playbackFor(mock);
      }
      const status = await load();
      const channel = status.channels.find((entry) => entry.id === id);
      if (channel === undefined) return { kind: 'unavailable', reason: 'not-in-library' };
      return playbackFor(channel);
    },
  };
}
