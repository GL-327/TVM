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
}

const MAX_PLAYLIST_BYTES = 1_500_000;

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

function attribute(line: string, name: string): string | undefined {
  const match = line.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return match?.[1];
}

export function parseM3u(text: string): LiveChannel[] {
  const lines = text.split(/\r?\n/);
  const channels: LiveChannel[] = [];
  let pending: { name: string; group?: string } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '' || line === '#EXTM3U') continue;

    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(',');
      const title = comma === -1 ? '' : line.slice(comma + 1).trim();
      const named = attribute(line, 'tvg-name');
      const group = attribute(line, 'group-title');
      pending = { name: (named !== undefined && named !== '' ? named : title) || 'Channel', group };
      continue;
    }

    if (line.startsWith('#')) continue;
    if (!isHttpUrl(line)) {
      pending = null;
      continue;
    }

    const name = pending?.name ?? `Channel ${channels.length + 1}`;
    channels.push({
      id: `live:${channels.length}`,
      name,
      url: line,
      group: pending?.group,
    });
    pending = null;
  }

  return channels;
}

function playbackFor(channel: LiveChannel): PlaybackResolution {
  const hls = /\.m3u8(\?|$)/i.test(channel.url);
  return {
    kind: 'stream',
    url: channel.url,
    title: channel.name,
    filename: channel.name,
    mimeType: hls ? 'application/vnd.apple.mpegurl' : 'video/mp4',
    engine: hls ? 'native' : 'html5',
  };
}

export function createLiveService(options: LiveServiceOptions): LiveService {
  const fetchImpl = options.fetch ?? fetch;
  const { dataDir } = options;

  const load = async (): Promise<LiveStatus> => {
    const url = readStoredUrl(dataDir);
    if (url === null) return { url: null, channels: [], error: null };

    try {
      const response = await fetchImpl(url, { redirect: 'follow' });
      if (!response.ok) return { url, channels: [], error: 'unreachable' };
      const text = await response.text();
      if (text.length > MAX_PLAYLIST_BYTES) return { url, channels: [], error: 'invalid' };
      const channels = parseM3u(text);
      if (channels.length === 0 && /\.m3u8(\?|$)/i.test(url)) {
        return {
          url,
          channels: [{ id: 'live:0', name: 'Live playlist', url }],
          error: null,
        };
      }
      if (channels.length === 0) return { url, channels: [], error: 'invalid' };
      return { url, channels, error: null };
    } catch {
      return { url, channels: [], error: 'unreachable' };
    }
  };

  return {
    status: () => load(),

    async setPlaylist(value: string): Promise<LiveStatus> {
      const trimmed = value.trim();
      if (trimmed === '') {
        writeStoredUrl(dataDir, '');
        return { url: null, channels: [], error: null };
      }
      if (!isHttpUrl(trimmed)) return { url: readStoredUrl(dataDir), channels: [], error: 'invalid' };
      writeStoredUrl(dataDir, trimmed);
      return load();
    },

    async play(id: string): Promise<PlaybackResolution> {
      const status = await load();
      const channel = status.channels.find((entry) => entry.id === id);
      if (channel === undefined) return { kind: 'unavailable', reason: 'not-in-library' };
      return playbackFor(channel);
    },
  };
}
