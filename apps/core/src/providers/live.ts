import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { livePicksPath, livePlaylistPath, xtreamPath } from '../update/paths.ts';
import { deleteSecret } from './secrets.ts';
import {
  browserMediaType,
  hopMediaType,
  hopRecord,
  isHlsPlaylist,
  liveStreamPath,
  looksLikeHlsBody,
  looksLikeHlsBytes,
  looksLikeMpegTs,
  probeContentLength,
  rewriteHlsPlaylist,
  skipMediaSniff,
} from './hlsProxy.ts';
import { httpAssetUrl, isHttpUrl } from './title.ts';
import { readSealed, writeSealed } from './vault.ts';
import {
  fetchXtreamAccount,
  fetchXtreamLive,
  normalizeXtreamHost,
  xtreamStreamId,
  xtreamStreamUrl,
  type XtreamAccount,
} from './xtream.ts';
import type {
  LiveCatalogPage,
  LiveChannel,
  LiveChannelCard,
  LiveGroup,
  LiveStatus,
  PlaybackResolution,
} from './types.ts';

export interface LiveCatalogQuery {
  q?: string;
  group?: string;
  offset?: number;
  limit?: number;
}

export interface LiveProxyResult {
  kind: 'playlist' | 'media' | 'error';
  body?: string | ReadableStream<Uint8Array>;
  contentType?: string;
  status?: number;
  reason?: string;
  contentLength?: string | null;
  contentRange?: string | null;
  acceptRanges?: string | null;
}

export interface LiveService {
  status(): Promise<LiveStatus>;
  catalog(query: LiveCatalogQuery): Promise<LiveCatalogPage>;
  setPlaylist(url: string): Promise<LiveStatus>;
  setXtream(input: { host: string; username: string; password: string }): Promise<LiveStatus>;
  clearXtream(): Promise<LiveStatus>;
  setPicks(ids: string[]): Promise<LiveStatus>;
  togglePick(id: string, picked: boolean): Promise<LiveStatus>;
  setGroupPicks(group: string, picked: boolean): Promise<LiveStatus>;
  play(id: string): Promise<PlaybackResolution>;
  upstreamUrl(id: string): Promise<string | null>;
  proxyChannel(id: string, headers?: Record<string, string>, method?: string): Promise<LiveProxyResult>;
  proxyHop(token: string, headers?: Record<string, string>, method?: string): Promise<LiveProxyResult>;
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
  { id: 'live:mock:sky-sports', name: 'Sample sports 1', url: MUX, group: 'Sample' },
  { id: 'live:mock:tnt-sports', name: 'Sample sports 2', url: BIPBOP, group: 'Sample' },
  { id: 'live:mock:bein-sports', name: 'Sample sports 3', url: MUX, group: 'Sample' },
  { id: 'live:mock:usa-network', name: 'Sample entertainment', url: BIPBOP, group: 'Sample' },
];

export const MAX_PLAYLIST_BYTES = 8_000_000;
export const LIVE_PICK_LIMIT = 48;
export const LIVE_AUTO_SHOW_MAX = 48;
export const LIVE_CATALOG_PAGE = 24;
export const LIVE_GROUP_CHIP_MAX = 32;

export function liveChannelId(url: string): string {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `live:${(hash >>> 0).toString(16)}`;
}

export function channelGroup(channel: Pick<LiveChannel, 'group'>): string {
  const group = channel.group?.trim();
  return group !== undefined && group !== '' ? group : 'Live';
}

interface StoredPlaylist {
  url: string | null;
  text: string | null;
}

export function looksLikePlaylistText(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > MAX_PLAYLIST_BYTES) return false;
  if (/^#EXTM3U/i.test(trimmed) || /#EXTINF:/i.test(trimmed)) return true;
  return trimmed.includes('\n') && /https?:\/\//i.test(trimmed);
}

function readStored(dataDir: string): StoredPlaylist {
  try {
    const parsed = JSON.parse(readFileSync(livePlaylistPath(dataDir), 'utf8')) as { url?: unknown; text?: unknown };
    const url = typeof parsed.url === 'string' && isHttpUrl(parsed.url) ? parsed.url : null;
    const text = typeof parsed.text === 'string' && parsed.text.trim() !== '' ? parsed.text : null;
    return { url, text };
  } catch {
    return { url: null, text: null };
  }
}

function writeStored(dataDir: string, stored: StoredPlaylist): void {
  mkdirSync(dirname(livePlaylistPath(dataDir)), { recursive: true });
  writeFileSync(livePlaylistPath(dataDir), JSON.stringify(stored));
}

function readXtream(dataDir: string): XtreamAccount | null {
  const stored = readSealed<Partial<XtreamAccount>>(dataDir, xtreamPath(dataDir));
  if (stored === null) return null;
  const host = typeof stored.host === 'string' ? normalizeXtreamHost(stored.host) : null;
  const username = typeof stored.username === 'string' ? stored.username.trim() : '';
  const password = typeof stored.password === 'string' ? stored.password : '';
  if (host === null || username === '' || password === '') return null;
  return { host, username, password };
}

function writeXtream(dataDir: string, account: XtreamAccount): void {
  writeSealed(dataDir, xtreamPath(dataDir), account);
}

function readPickIds(dataDir: string): string[] {
  try {
    const parsed = JSON.parse(readFileSync(livePicksPath(dataDir), 'utf8')) as { ids?: unknown };
    if (!Array.isArray(parsed.ids)) return [];
    return parsed.ids.filter((id): id is string => typeof id === 'string' && id.startsWith('live:'));
  } catch {
    return [];
  }
}

function writePickIds(dataDir: string, ids: string[]): void {
  mkdirSync(dirname(livePicksPath(dataDir)), { recursive: true });
  writeFileSync(livePicksPath(dataDir), JSON.stringify({ ids }));
}

function attribute(line: string, name: string): string | undefined {
  const match = line.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match?.[1];
}

export function parseM3u(text: string): LiveChannel[] {
  const lines = text.split(/\r?\n/);
  const channels: LiveChannel[] = [];
  const used = new Set<string>();
  let pending: { name: string; group?: string; logo?: string } | null = null;
  let groupHint: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line === '#EXTM3U') continue;

    if (line.startsWith('#EXTGRP:')) {
      const group = line.slice('#EXTGRP:'.length).trim();
      groupHint = group === '' ? undefined : group;
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      const title = comma === -1 ? '' : line.slice(comma + 1).trim();
      const named = attribute(line, 'tvg-name');
      const group = attribute(line, 'group-title') ?? groupHint;
      const logoRaw = attribute(line, 'tvg-logo');
      const logo = logoRaw !== undefined ? httpAssetUrl(logoRaw) : undefined;
      pending = { name: (named !== undefined && named !== '' ? named : title) || 'Channel', group, logo };
      continue;
    }

    if (line.startsWith('#')) continue;
    if (!isHttpUrl(line)) {
      pending = null;
      continue;
    }

    let id = liveChannelId(line);
    if (used.has(id)) {
      let n = 2;
      while (used.has(`${id}-${n}`)) n += 1;
      id = `${id}-${n}`;
    }
    used.add(id);

    const channel: LiveChannel = {
      id,
      name: pending?.name ?? `Channel ${channels.length + 1}`,
      url: line,
    };
    if (pending?.group !== undefined && pending.group !== '') channel.group = pending.group;
    if (pending?.logo !== undefined) channel.logo = pending.logo;
    channels.push(channel);
    pending = null;
  }

  return channels;
}

function playbackFor(channel: LiveChannel, engine: 'html5' | 'native' = 'html5', proxied = true): PlaybackResolution {
  const source = proxied ? liveStreamPath(channel.id) : channel.url;
  const hls = isHlsPlaylist(channel.url, '');
  const ts = /\.ts(\?|$)/i.test(channel.url);
  const file = /\.(mp4|m4v|webm)(\?|$)/i.test(channel.url);
  const mimeType = hls
    ? 'application/vnd.apple.mpegurl'
    : ts
      ? 'video/mp2t'
      : file
        ? 'video/mp4'
        : proxied
          ? 'application/vnd.apple.mpegurl'
          : 'video/mp4';
  return {
    kind: 'stream',
    url: source,
    title: channel.name,
    filename: channel.name,
    mimeType,
    engine,
    transport: mimeType === 'video/mp2t' ? 'ts-live' : mimeType === 'video/mp4' ? 'file' : 'hls',
  };
}

function summarizeGroups(channels: LiveChannel[], picked: Set<string>): LiveGroup[] {
  const map = new Map<string, LiveGroup>();
  for (const channel of channels) {
    const name = channelGroup(channel);
    const current = map.get(name) ?? { name, count: 0, picked: 0 };
    current.count += 1;
    if (picked.has(channel.id)) current.picked += 1;
    map.set(name, current);
  }
  return [...map.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
}

function cardFor(channel: LiveChannel, picked: Set<string> | boolean): LiveChannelCard {
  const on = typeof picked === 'boolean' ? picked : picked.has(channel.id);
  const card: LiveChannelCard = { id: channel.id, name: channel.name, picked: on };
  if (channel.group !== undefined) card.group = channel.group;
  if (channel.logo !== undefined) card.logo = channel.logo;
  return card;
}

export function createLiveService(options: LiveServiceOptions): LiveService {
  const fetchImpl = options.fetch ?? fetch;
  const { dataDir } = options;
  let cache: { url: string; channels: LiveChannel[] } | null = null;

  const mockChannels = (): LiveChannel[] => (options.includeMock?.() === true ? [...MOCK_LIVE_CHANNELS] : []);

  const knownIds = (catalog: LiveChannel[]): Set<string> => {
    const ids = new Set(catalog.map((channel) => channel.id));
    for (const channel of MOCK_LIVE_CHANNELS) ids.add(channel.id);
    return ids;
  };

  const storedPicks = (catalog: LiveChannel[]): string[] => {
    const allowed = knownIds(catalog);
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const id of readPickIds(dataDir)) {
      if (!allowed.has(id) || seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
      if (unique.length >= LIVE_PICK_LIMIT) break;
    }
    return unique;
  };

  const savePicks = (catalog: LiveChannel[], ids: string[]): string[] => {
    const allowed = knownIds(catalog);
    const unique: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) continue;
      seen.add(id);
      unique.push(id);
      if (unique.length >= LIVE_PICK_LIMIT) break;
    }
    writePickIds(dataDir, unique);
    return unique;
  };

  const loadCatalog = async (): Promise<{
    playlistUrl: string | null;
    channels: LiveChannel[];
    error: string | null;
  }> => {
    const account = readXtream(dataDir);
    if (account !== null) {
      const cacheKey = `xtream:${account.host}:${account.username}`;
      if (cache !== null && cache.url === cacheKey) {
        return { playlistUrl: null, channels: cache.channels, error: null };
      }
      const loaded = await fetchXtreamLive(account, fetchImpl);
      if (loaded.error !== null) return { playlistUrl: null, channels: [], error: loaded.error };
      cache = { url: cacheKey, channels: loaded.channels };
      return { playlistUrl: null, channels: loaded.channels, error: null };
    }

    const stored = readStored(dataDir);
    if (stored.text !== null) {
      const cacheKey = `text:${stored.text.length}:${stored.text.slice(0, 48)}`;
      if (cache !== null && cache.url === cacheKey) return { playlistUrl: stored.url, channels: cache.channels, error: null };
      if (stored.text.length > MAX_PLAYLIST_BYTES) return { playlistUrl: stored.url, channels: [], error: 'invalid' };
      const channels = parseM3u(stored.text);
      if (channels.length === 0) return { playlistUrl: stored.url ?? 'local:playlist', channels: [], error: 'invalid' };
      cache = { url: cacheKey, channels };
      return { playlistUrl: stored.url ?? 'local:playlist', channels, error: null };
    }
    const url = stored.url;
    if (url === null) {
      cache = null;
      return { playlistUrl: null, channels: [], error: null };
    }
    if (cache !== null && cache.url === url) return { playlistUrl: url, channels: cache.channels, error: null };

    try {
      const response = await fetchImpl(url, { redirect: 'follow' });
      if (!response.ok) return { playlistUrl: url, channels: [], error: 'unreachable' };
      const text = await response.text();
      if (text.length > MAX_PLAYLIST_BYTES) return { playlistUrl: url, channels: [], error: 'invalid' };
      let channels = parseM3u(text);
      if (channels.length === 0 && /\.m3u8(\?|$)/i.test(url)) {
        channels = [{ id: liveChannelId(url), name: 'Live stream', url }];
      }
      if (channels.length === 0) return { playlistUrl: url, channels: [], error: 'invalid' };
      cache = { url, channels };
      return { playlistUrl: url, channels, error: null };
    } catch {
      return { playlistUrl: url, channels: [], error: 'unreachable' };
    }
  };

  const compose = async (): Promise<LiveStatus> => {
    const mock = mockChannels();
    const account = readXtream(dataDir);
    const playlist = readStored(dataDir);
    const configured = account !== null || playlist.url !== null || playlist.text !== null;
    const loaded = await loadCatalog();
    const host = account?.host ?? null;
    const username = account?.username ?? null;

    if (loaded.playlistUrl === null && account === null) {
      return {
        url: null,
        host,
        username,
        configured,
        channels: mock.map((channel) => cardFor(channel, false)),
        error: null,
        picked: 0,
        total: 0,
        groups: [],
        needsPicks: false,
        pickLimit: LIVE_PICK_LIMIT,
      };
    }

    const picks = storedPicks(loaded.channels);
    const pickedSet = new Set(picks);
    const byId = new Map(loaded.channels.map((channel) => [channel.id, channel]));
    const selected =
      picks.length > 0
        ? picks.map((id) => byId.get(id)).filter((channel): channel is LiveChannel => channel !== undefined)
        : loaded.channels.length <= LIVE_AUTO_SHOW_MAX
          ? loaded.channels
          : [];
    const needsPicks = loaded.error === null && loaded.channels.length > LIVE_AUTO_SHOW_MAX && picks.length === 0;
    const error = loaded.error !== null && mock.length === 0 && selected.length === 0 ? loaded.error : null;
    return {
      url: loaded.playlistUrl,
      host,
      username,
      configured,
      channels: [...mock, ...selected].map((channel) => cardFor(channel, pickedSet)),
      error,
      picked: picks.length,
      total: loaded.channels.length,
      groups: summarizeGroups(loaded.channels, pickedSet).slice(0, LIVE_GROUP_CHIP_MAX),
      needsPicks,
      pickLimit: LIVE_PICK_LIMIT,
    };
  };

  const findChannel = async (id: string): Promise<LiveChannel | undefined> => {
    const mock = MOCK_LIVE_CHANNELS.find((entry) => entry.id === id);
    if (mock !== undefined) return mock;
    const loaded = await loadCatalog();
    return loaded.channels.find((entry) => entry.id === id);
  };

  const resolveUpstream = async (id: string): Promise<string | null> => {
    const mock = MOCK_LIVE_CHANNELS.find((entry) => entry.id === id);
    if (mock !== undefined) {
      if (options.includeMock?.() !== true) return null;
      return mock.url;
    }
    const account = readXtream(dataDir);
    const streamId = xtreamStreamId(id);
    if (account !== null && streamId !== null) return xtreamStreamUrl(account, streamId);
    const channel = await findChannel(id);
    if (channel === undefined || channel.url === '') return null;
    return channel.url;
  };

  return {
    status: () => compose(),

    async catalog(query: LiveCatalogQuery): Promise<LiveCatalogPage> {
      const loaded = await loadCatalog();
      const picks = new Set(storedPicks(loaded.channels));
      const q = query.q?.trim().toLowerCase() ?? '';
      const group = query.group?.trim() || null;
      const offset = Number.isFinite(query.offset) ? Math.max(0, Math.floor(query.offset ?? 0)) : 0;
      const limitRaw = Number.isFinite(query.limit) ? Math.floor(query.limit ?? LIVE_CATALOG_PAGE) : LIVE_CATALOG_PAGE;
      const limit = Math.min(48, Math.max(1, limitRaw));
      const matched = loaded.channels.filter((channel) => {
        if (group !== null && channelGroup(channel) !== group) return false;
        if (q === '') return true;
        return channel.name.toLowerCase().includes(q) || channelGroup(channel).toLowerCase().includes(q);
      });
      return {
        items: matched.slice(offset, offset + limit).map((channel) => cardFor(channel, picks)),
        groups: summarizeGroups(loaded.channels, picks).slice(0, LIVE_GROUP_CHIP_MAX),
        total: loaded.channels.length,
        matched: matched.length,
        offset,
        limit,
        picked: picks.size,
        pickLimit: LIVE_PICK_LIMIT,
        query: query.q?.trim() ?? '',
        group,
      };
    },

    async setPlaylist(value: string): Promise<LiveStatus> {
      const trimmed = value.trim();
      cache = null;
      if (trimmed === '') {
        writeStored(dataDir, { url: null, text: null });
        return compose();
      }
      if (looksLikePlaylistText(trimmed)) {
        if (trimmed.length > MAX_PLAYLIST_BYTES) {
          const current = await compose();
          return { ...current, error: 'invalid' };
        }
        const channels = parseM3u(trimmed);
        if (channels.length === 0) {
          const current = await compose();
          return { ...current, error: 'invalid' };
        }
        writeStored(dataDir, { url: null, text: trimmed });
        return compose();
      }
      if (!isHttpUrl(trimmed)) {
        const current = await compose();
        return { ...current, error: 'invalid' };
      }
      writeStored(dataDir, { url: trimmed, text: null });
      return compose();
    },

    async setXtream(input: { host: string; username: string; password: string }): Promise<LiveStatus> {
      const host = normalizeXtreamHost(input.host);
      const username = input.username.trim();
      const password = input.password;
      cache = null;
      if (host === null || username === '' || password.trim() === '') {
        const current = await compose();
        return { ...current, error: 'invalid' };
      }
      const account = { host, username, password };
      const auth = await fetchXtreamAccount(account, fetchImpl);
      if (!auth.ok) {
        const current = await compose();
        return { ...current, error: auth.error };
      }
      writeXtream(dataDir, { host, username: auth.username ?? username, password });
      return compose();
    },

    async clearXtream(): Promise<LiveStatus> {
      cache = null;
      deleteSecret(xtreamPath(dataDir));
      return compose();
    },

    async setPicks(ids: string[]): Promise<LiveStatus> {
      const loaded = await loadCatalog();
      savePicks(loaded.channels, ids);
      return compose();
    },

    async togglePick(id: string, picked: boolean): Promise<LiveStatus> {
      const loaded = await loadCatalog();
      const current = storedPicks(loaded.channels);
      if (picked) {
        if (!current.includes(id)) savePicks(loaded.channels, [...current, id]);
      } else {
        savePicks(
          loaded.channels,
          current.filter((entry) => entry !== id),
        );
      }
      return compose();
    },

    async setGroupPicks(group: string, picked: boolean): Promise<LiveStatus> {
      const loaded = await loadCatalog();
      const inGroup = loaded.channels.filter((channel) => channelGroup(channel) === group).map((channel) => channel.id);
      const current = storedPicks(loaded.channels);
      if (picked) savePicks(loaded.channels, [...current, ...inGroup]);
      else {
        const drop = new Set(inGroup);
        savePicks(
          loaded.channels,
          current.filter((id) => !drop.has(id)),
        );
      }
      return compose();
    },

    async play(id: string): Promise<PlaybackResolution> {
      const mock = MOCK_LIVE_CHANNELS.find((entry) => entry.id === id);
      if (mock !== undefined) {
        if (options.includeMock?.() !== true) return { kind: 'unavailable', reason: 'region-blocked' };
        return playbackFor(mock, 'html5', false);
      }
      const channel = await findChannel(id);
      if (channel === undefined) return { kind: 'unavailable', reason: 'not-in-library' };
      return playbackFor(channel, 'html5', true);
    },

    async upstreamUrl(id: string): Promise<string | null> {
      return resolveUpstream(id);
    },

    async proxyChannel(id: string, headers?: Record<string, string>, method = 'GET'): Promise<LiveProxyResult> {
      const upstream = await resolveUpstream(id);
      if (upstream === null) return { kind: 'error', status: 404, reason: 'not-found' };
      return loadMedia(upstream, fetchImpl, { headers, playlist: isHlsPlaylist(upstream, ''), method });
    },

    async proxyHop(token: string, headers?: Record<string, string>, method = 'GET'): Promise<LiveProxyResult> {
      const hop = hopRecord(token);
      if (hop === null) return { kind: 'error', status: 404, reason: 'not-found' };
      return loadMedia(hop.url, fetchImpl, {
        headers,
        playlist: hop.playlist,
        method,
        hintType: hop.mimeType,
      });
    },
  };
}

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function upstreamHeaders(
  url: string,
  incoming?: Record<string, string>,
  playlist = false,
): Headers {
  const from = new Headers(incoming);
  const headers = new Headers();
  const range = from.get('range');
  if (!playlist && range !== null && range !== '') headers.set('Range', range);
  const accept = from.get('accept');
  headers.set('Accept', accept !== null && accept !== '' ? accept : '*/*');
  const ua = from.get('user-agent');
  headers.set('User-Agent', ua !== null && ua !== '' ? ua : BROWSER_UA);
  if (/real-debrid\.com|rdbx\.to|download\d*\.real-debrid/i.test(url)) {
    headers.set('Referer', 'https://real-debrid.com/');
  }
  return headers;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

async function readAllBytes(head: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const parts = [head];
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value !== undefined && next.value.byteLength > 0) parts.push(next.value);
  }
  return concatBytes(parts);
}

function restreamBytes(head: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  let sentHead = head.byteLength === 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!sentHead) {
          sentHead = true;
          if (head.byteLength > 0) {
            controller.enqueue(head);
            return;
          }
        }
        const next = await reader.read();
        if (next.done) {
          controller.close();
          try {
            reader.releaseLock();
          } catch {
            // Reader already released when the client aborts.
          }
          return;
        }
        if (next.value !== undefined && next.value.byteLength > 0) controller.enqueue(next.value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      void reader.cancel().catch(() => undefined);
    },
  });
}

function mediaResult(
  response: Response,
  body: ReadableStream<Uint8Array>,
  contentType: string,
): LiveProxyResult {
  return {
    kind: 'media',
    body,
    contentType: browserMediaType(contentType, false),
    status: response.status,
    contentLength: response.headers.get('content-length'),
    contentRange: response.headers.get('content-range'),
    acceptRanges: response.headers.get('accept-ranges'),
  };
}

function emptyMediaBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.close();
    },
  });
}

function sniffMediaType(head: Uint8Array, contentType: string, hint = ''): string {
  if (looksLikeHlsBytes(head)) return 'application/vnd.apple.mpegurl';
  if (looksLikeMpegTs(head)) return 'video/mp2t';
  if (head.byteLength === 0 && hint !== '') return browserMediaType(hint, isHlsPlaylist('', hint));
  return browserMediaType(contentType, false);
}

function resolveMediaType(upstream: string, contentType: string, hintType: string, head?: Uint8Array): string {
  if (head !== undefined && head.byteLength > 0) return sniffMediaType(head, contentType, hintType);
  if (hintType !== '') return browserMediaType(hintType, isHlsPlaylist(upstream, hintType));
  const fromUrl = hopMediaType(upstream, false);
  if (fromUrl !== '') return fromUrl;
  return browserMediaType(contentType, false);
}

/**
 * Real HTTP HEAD — never a Range GET that we later abort. cancel() on that GET
 * poisons keep-alive so the player's follow-up GET stalls and MSE underruns.
 */
async function probeMediaHead(
  upstream: string,
  fetchImpl: typeof fetch,
  incoming: Record<string, string> | undefined,
  hintType: string,
): Promise<LiveProxyResult> {
  const headers = upstreamHeaders(upstream, incoming, false);
  headers.delete('Range');
  const fallbackType = resolveMediaType(upstream, '', hintType);
  try {
    const response = await fetchImpl(upstream, { method: 'HEAD', redirect: 'follow', headers });
    if (response.ok || response.status === 206) {
      return {
        kind: 'media',
        body: emptyMediaBody(),
        contentType: resolveMediaType(upstream, response.headers.get('content-type') ?? '', hintType),
        status: 200,
        contentLength: probeContentLength(
          response.headers.get('content-length'),
          response.headers.get('content-range'),
        ),
        contentRange: null,
        acceptRanges: response.headers.get('accept-ranges'),
      };
    }
  } catch {
    // Some CDNs reject HEAD; unknown length is safer than a 512-byte slice.
  }
  return {
    kind: 'media',
    body: emptyMediaBody(),
    contentType: fallbackType !== '' ? fallbackType : 'video/mp4',
    status: 200,
    contentLength: null,
    contentRange: null,
    acceptRanges: null,
  };
}

/** Peek just enough to detect HLS. Stop on the first non-`#` chunk so TS/MP4 is not delayed. */
async function peekForSniff(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  while (concatBytes(parts).byteLength < 16) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value !== undefined && next.value.byteLength > 0) parts.push(next.value);
    const soFar = concatBytes(parts);
    if (soFar.byteLength > 0 && soFar[0] !== 0x23) break;
  }
  return concatBytes(parts);
}

async function loadMedia(
  upstream: string,
  fetchImpl: typeof fetch,
  options: { headers?: Record<string, string>; playlist?: boolean; method?: string; hintType?: string } = {},
): Promise<LiveProxyResult> {
  try {
    const hintedPlaylist = options.playlist === true || isHlsPlaylist(upstream, options.hintType ?? '');
    const method = options.method === 'HEAD' ? 'HEAD' : 'GET';
    const hintType = options.hintType ?? '';
    if (method === 'HEAD' && !hintedPlaylist) {
      return probeMediaHead(upstream, fetchImpl, options.headers, hintType);
    }
    const headers = upstreamHeaders(upstream, options.headers, hintedPlaylist);
    const response = await fetchImpl(upstream, {
      method: 'GET',
      redirect: 'follow',
      headers,
    });
    if (!response.ok && response.status !== 206) {
      return { kind: 'error', status: 502, reason: 'unreachable' };
    }
    const type = response.headers.get('content-type') ?? '';
    if (response.body === null) return { kind: 'error', status: 502, reason: 'unreachable' };
    if (!hintedPlaylist && skipMediaSniff(hintType, headers.has('Range'))) {
      return mediaResult(response, response.body, resolveMediaType(upstream, type, hintType));
    }
    const reader = response.body.getReader();
    const head = await peekForSniff(reader);
    if (head.byteLength === 0) return { kind: 'error', status: 502, reason: 'unreachable' };
    if (looksLikeHlsBytes(head)) {
      const bytes = await readAllBytes(head, reader);
      const text = new TextDecoder('utf-8').decode(bytes);
      if (looksLikeHlsBody(text)) {
        return {
          kind: 'playlist',
          body: rewriteHlsPlaylist(text, upstream),
          contentType: 'application/vnd.apple.mpegurl',
        };
      }
    }
    return mediaResult(response, restreamBytes(head, reader), sniffMediaType(head, type, hintType));
  } catch {
    return { kind: 'error', status: 502, reason: 'unreachable' };
  }
}
