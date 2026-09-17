import type { HeaderProfile } from './headers.ts';

/**
 * Reading an M3U, including the header hints providers bury in it.
 *
 * An IPTV playlist is not only a list of URLs. Panels that need a particular
 * Referer or User-Agent say so inside the file, using two conventions that
 * every player supports and most parsers ignore:
 *
 *   #EXTVLCOPT:http-user-agent=...     VLC's per-entry options
 *   #EXTHTTP:{"User-Agent":"..."}      a JSON blob of request headers
 *
 * Ignoring them is why a channel plays in VLC and 403s everywhere else. They
 * are parsed here into the same HeaderProfile the rest of the module uses, so
 * a provider's own instructions become the per-stream header set without
 * anyone having to transcribe them by hand.
 */

export interface PlaylistChannel {
  /** Opaque, stable, and the only identifier the UI is given. */
  id: string;
  name: string;
  group?: string;
  logo?: string;
  tvgId?: string;
  /** Upstream address. Never serialised to the UI. */
  url: string;
  /** Headers this entry asked for, if any. */
  profile?: HeaderProfile;
}

const EXTINF = /^#EXTINF:(-?\d+(?:\.\d+)?)(.*?),(.*)$/i;
const ATTRIBUTE = /([A-Za-z0-9_-]+)="([^"]*)"/g;
const VLC_OPT = /^#EXTVLCOPT:\s*([^=]+)=(.*)$/i;
const EXT_HTTP = /^#EXTHTTP:\s*(\{.*\})\s*$/i;

/** VLC's option names, mapped onto the header they actually set. */
const VLC_HEADER: Record<string, keyof HeaderProfile> = {
  'http-user-agent': 'userAgent',
  'http-referrer': 'referer',
  // Spelled both ways in the wild; the HTTP header itself is the misspelling.
  'http-referer': 'referer',
  'http-origin': 'origin',
  'http-cookie': 'cookie',
};

function stableId(url: string, name: string, index: number): string {
  // Deliberately not a hash of the URL alone: two entries can share a URL with
  // different headers, and they are different channels to a viewer.
  const seed = `${index}:${name}:${url}`;
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `ch_${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Folds one #EXTVLCOPT or #EXTHTTP line into a profile. Shared with Core's
 * Live TV playlist reader, so both paths obey the same instructions.
 */
export function applyHeaderLine(profile: HeaderProfile, line: string): void {
  const vlc = VLC_OPT.exec(line);
  if (vlc !== null) {
    const name = (vlc[1] ?? '').trim().toLowerCase();
    const value = (vlc[2] ?? '').trim();
    const field = VLC_HEADER[name];
    if (field !== undefined && value !== '' && field !== 'id' && field !== 'extra') {
      profile[field] = value;
    }
    return;
  }
  const http = EXT_HTTP.exec(line);
  if (http === null) return;
  try {
    const parsed = JSON.parse(http[1] ?? '{}') as Record<string, unknown>;
    for (const [name, value] of Object.entries(parsed)) {
      if (typeof value !== 'string' || value === '') continue;
      const key = name.trim().toLowerCase();
      if (key === 'user-agent') profile.userAgent = value;
      else if (key === 'referer' || key === 'referrer') profile.referer = value;
      else if (key === 'origin') profile.origin = value;
      else if (key === 'cookie') profile.cookie = value;
      else profile.extra = { ...(profile.extra ?? {}), [name.trim()]: value };
    }
  } catch {
    // A malformed EXTHTTP line is not worth failing a whole playlist over.
  }
}

export function hasAnyHeader(profile: HeaderProfile): boolean {
  return (
    profile.userAgent !== undefined ||
    profile.referer !== undefined ||
    profile.origin !== undefined ||
    profile.cookie !== undefined ||
    Object.keys(profile.extra ?? {}).length > 0
  );
}

export function parseM3u(text: string): PlaylistChannel[] {
  const channels: PlaylistChannel[] = [];
  let pending: { name: string; attrs: Record<string, string> } | null = null;
  let profile: HeaderProfile = { id: '' };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;

    if (line.startsWith('#')) {
      const info = EXTINF.exec(line);
      if (info !== null) {
        const attrs: Record<string, string> = {};
        for (const match of (info[2] ?? '').matchAll(ATTRIBUTE)) {
          attrs[(match[1] ?? '').toLowerCase()] = match[2] ?? '';
        }
        pending = { name: (info[3] ?? '').trim(), attrs };
        profile = { id: '' };
        continue;
      }
      if (pending !== null) applyHeaderLine(profile, line);
      continue;
    }

    if (pending === null) continue;
    const index = channels.length;
    const name = pending.name !== '' ? pending.name : (pending.attrs['tvg-name'] ?? `Channel ${index + 1}`);
    const id = stableId(line, name, index);
    const channel: PlaylistChannel = { id, name, url: line };
    const group = pending.attrs['group-title'];
    if (group !== undefined && group !== '') channel.group = group;
    const logo = pending.attrs['tvg-logo'];
    if (logo !== undefined && logo !== '') channel.logo = logo;
    const tvgId = pending.attrs['tvg-id'];
    if (tvgId !== undefined && tvgId !== '') channel.tvgId = tvgId;
    if (hasAnyHeader(profile)) channel.profile = { ...profile, id };
    channels.push(channel);
    pending = null;
    profile = { id: '' };
  }

  return channels;
}

/**
 * What the UI is allowed to see.
 *
 * The url and profile fields are dropped rather than blanked, so a future
 * change that forgets to redact cannot quietly start sending them: the shape
 * simply has nowhere to put one.
 */
export interface PublicChannel {
  id: string;
  name: string;
  group?: string;
  logo?: string;
  /** Core-local, opaque, and safe to hand to any player. */
  play: string;
}

export function publicView(channel: PlaylistChannel, play: string): PublicChannel {
  const view: PublicChannel = { id: channel.id, name: channel.name, play };
  if (channel.group !== undefined) view.group = channel.group;
  // Artwork goes through Core's existing art proxy, not the provider host.
  if (channel.logo !== undefined) view.logo = `/api/art?src=${encodeURIComponent(channel.logo)}`;
  return view;
}
