import { getFreeChannelsContent, getParentalContent, type AgeLimitValue, type FreeChannel } from './content';
import { apiFetch, type LiveChannel } from './media';

export type LiveChannelWithMeta = LiveChannel & {
  geo?: string | null;
  country?: string | null;
  website?: string | null;
  free?: boolean;
};

export function allowedLiveGroupsForAge(maxAge: AgeLimitValue | number | undefined): Set<string> | null {
  if (maxAge === undefined || maxAge >= 18) return null;
  const levels = getParentalContent().levels;
  const match = levels.find((level) => level.maxAge >= maxAge) ?? levels[levels.length - 1];
  if (match === undefined || match.liveGroups === null) return null;
  return new Set(match.liveGroups.map((g) => g.toLowerCase()));
}

export function filterChannelsByAge<T extends { group?: string }>(
  channels: readonly T[],
  maxAge: AgeLimitValue | number | undefined,
): T[] {
  const allowed = allowedLiveGroupsForAge(maxAge);
  if (allowed === null) return [...channels];
  return channels.filter((channel) => {
    const group = (channel.group ?? '').trim().toLowerCase();
    return group !== '' && allowed.has(group);
  });
}

export function toFreeLiveChannel(ch: FreeChannel): LiveChannelWithMeta {
  return {
    id: ch.id.startsWith('live:') ? ch.id : `live:free:${ch.id}`,
    name: ch.name,
    url: ch.url,
    group: ch.group,
    logo: ch.logo ?? undefined,
    geo: ch.geo,
    country: ch.country,
    website: ch.website,
    free: true,
    picked: true,
  };
}

export function bundledFreeChannels(maxAge?: AgeLimitValue | number): LiveChannelWithMeta[] {
  const mapped = getFreeChannelsContent().channels.map(toFreeLiveChannel);
  return filterChannelsByAge(mapped, maxAge);
}

export async function fetchFreeChannels(maxAge?: AgeLimitValue | number): Promise<LiveChannelWithMeta[]> {
  try {
    const res = await apiFetch('/api/live/free', { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const body = (await res.json()) as { channels?: FreeChannel[] };
      if (Array.isArray(body.channels) && body.channels.length > 0) {
        return filterChannelsByAge(body.channels.map(toFreeLiveChannel), maxAge);
      }
    }
  } catch {
    // Fall back gracefully to bundled free-channels.json.
  }
  return bundledFreeChannels(maxAge);
}

export function freeChannelErrorCopy(channelName: string, geo?: string | null): string {
  if (geo === 'GB' || /\bbbc\b/i.test(channelName)) {
    return 'BBC channels play in the UK only';
  }
  return "This channel isn't available right now";
}
