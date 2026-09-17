import { join } from 'node:path';
import { secretsDir } from '../update/paths.ts';
import { readSecret, writeSecret } from '../providers/secrets.ts';
import { readPrivateJson } from '../providers/privateJson.ts';
import { writeSealed } from '../providers/vault.ts';
import { LiveCache, cacheOptions } from './cache.ts';
import { GLOBAL_PROFILE_ID, globalProfile, type HeaderProfile } from './headers.ts';
import { isHlsPlaylistUrl } from './manifest.ts';
import { parseM3u, publicView, type PlaylistChannel, type PublicChannel } from './playlist.ts';
import { Reflector, type ReflectResult } from './reflect.ts';
import { TokenMinter, isTokenShaped, type TokenStore } from './tokens.ts';

/**
 * Server Side Live — the universal IPTV proxy, assembled.
 *
 * Core already reflected HLS for the desktop player, but with one global
 * User-Agent, tokens that lived in a Map and died with the process, and no
 * cache. This module is the general form: per-stream request headers, tokens
 * that survive a restart and can be rotated on demand, and a short cache in
 * front of a provider that would otherwise see four identical requests a
 * second from one household.
 *
 * Everything a client receives is a Core-local path. The UI is handed opaque
 * channel ids and `/api/live/proxy/<token>` URLs and never an upstream
 * address, which is why provider credentials cannot reach the browser bundle,
 * the Roku zip, or a crash report.
 *
 * Auth is inherited, not reinvented. These routes live under `/api/live`,
 * which Core's accessError() already treats as content: loopback needs no
 * token, anything else needs `Authorization: Bearer <TVM_LAN_TOKEN>` or an
 * authenticated session. Admin, billing and privacy stay loopback-only, and
 * nothing here changes that.
 */

const SECRET_FILE = 'live-proxy-key';
const SOURCES_FILE = 'live-sources.json';

interface StoredSources {
  version: 1;
  playlistUrl?: string;
  channels: PlaylistChannel[];
  profiles: Record<string, HeaderProfile>;
  updatedAt: string;
}

const EMPTY: StoredSources = { version: 1, channels: [], profiles: {}, updatedAt: '' };

function secretStore(dataDir: string): TokenStore {
  const path = join(secretsDir(dataDir), SECRET_FILE);
  return {
    read: () => readSecret(path),
    write: (secret) => writeSecret(path, secret),
  };
}

export interface ServerSideLiveOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export interface ServerSideLive {
  /** Opaque channels for the UI. Contains no upstream URL and no credential. */
  channels(): PublicChannel[];
  /** Core-local play URL for one channel, or null if it is not known. */
  playUrl(id: string): string | null;
  /** Load an M3U playlist through the proxy's own header rules and store it. */
  loadPlaylist(url: string, profile?: HeaderProfile): Promise<{ count: number }>;
  /** Publish a single arbitrary stream URL. Returns the Core-local path. */
  publish(url: string, profile?: HeaderProfile): string;
  /** Serve one proxy request. */
  serve(token: string, headers: Record<string, string> | undefined, method: string): Promise<ReflectResult>;
  /** Invalidate every minted URL at once. */
  rotate(): void;
  /** Counts only — never URLs, never header values. */
  stats(): { channels: number; tokens: number; cache: { entries: number; bytes: number } | null; headerProfiles: number };
  /** Forget every stored source and profile. Used by privacy erasure. */
  forget(): void;
}

export function createServerSideLive(options: ServerSideLiveOptions): ServerSideLive {
  const env = options.env ?? process.env;
  const sourcesPath = join(options.dataDir, SOURCES_FILE);
  let sources: StoredSources = readPrivateJson<StoredSources>(options.dataDir, sourcesPath) ?? { ...EMPTY };
  const minter = new TokenMinter(secretStore(options.dataDir));
  const options_ = cacheOptions(env);
  const cache = options_ === null ? null : new LiveCache(options_);
  const base = globalProfile(env);

  const save = (): void => {
    sources.updatedAt = new Date().toISOString();
    writeSealed(options.dataDir, sourcesPath, sources);
  };

  const reflector = new Reflector({
    minter,
    cache,
    globalProfile: base,
    profileFor: (id) => sources.profiles[id] ?? null,
    ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
  });

  const channelById = (id: string): PlaylistChannel | undefined =>
    sources.channels.find((channel) => channel.id === id);

  const pathFor = (channel: PlaylistChannel): string =>
    reflector.publish(channel.url, channel.profile?.id ?? GLOBAL_PROFILE_ID, isHlsPlaylistUrl(channel.url));

  return {
    channels() {
      return sources.channels.map((channel) => publicView(channel, pathFor(channel)));
    },

    playUrl(id) {
      const channel = channelById(id);
      return channel === undefined ? null : pathFor(channel);
    },

    async loadPlaylist(url, profile) {
      const profileId = profile?.id ?? GLOBAL_PROFILE_ID;
      if (profile !== undefined) sources.profiles[profileId] = { ...profile, id: profileId };
      // Fetched through the reflector so the playlist request itself carries
      // the provider's required headers — panels gate the M3U too, not only
      // the streams inside it.
      const result = await reflector.fetchTarget(
        { url, profileId, playlist: false },
        undefined,
        'GET',
        // A channel list, not a stream: read it as it is, never rewritten.
        { raw: true },
      );
      if (result.kind === 'error') {
        throw new Error(result.reason ?? 'playlist_unreachable');
      }
      const text =
        typeof result.body === 'string'
          ? result.body
          : result.body instanceof Uint8Array
            ? Buffer.from(result.body).toString('utf8')
            : '';
      if (text === '') throw new Error('playlist_empty');

      const channels = parseM3u(text);
      const profiles: Record<string, HeaderProfile> = profile !== undefined ? { [profileId]: { ...profile, id: profileId } } : {};
      for (const channel of channels) {
        if (channel.profile !== undefined) profiles[channel.profile.id] = channel.profile;
      }
      sources = { version: 1, playlistUrl: url, channels, profiles, updatedAt: '' };
      save();
      return { count: channels.length };
    },

    publish(url, profile) {
      const profileId = profile?.id ?? GLOBAL_PROFILE_ID;
      if (profile !== undefined) {
        sources.profiles[profileId] = { ...profile, id: profileId };
        save();
      }
      return reflector.publish(url, profileId, isHlsPlaylistUrl(url));
    },

    async serve(token, headers, method) {
      if (!isTokenShaped(token)) return { kind: 'error', status: 404, reason: 'unknown_stream' };
      return reflector.serve(token, headers, method);
    },

    rotate() {
      minter.rotate();
      cache?.clear();
    },

    stats() {
      return {
        channels: sources.channels.length,
        tokens: minter.size,
        cache: cache?.stats() ?? null,
        headerProfiles: Object.keys(sources.profiles).length,
      };
    },

    forget() {
      sources = { ...EMPTY, channels: [], profiles: {} };
      save();
      minter.rotate();
      cache?.clear();
    },
  };
}

export { GLOBAL_PROFILE_ID } from './headers.ts';
export type { HeaderProfile } from './headers.ts';
export type { PublicChannel } from './playlist.ts';
export type { ReflectResult } from './reflect.ts';
