import { apiFetch } from './media';

export interface QualityInfo {
  height?: number | null;
  hdr?: 'dv' | 'hdr10+' | 'hdr10' | 'hlg' | null;
  audio?: { codec?: string | null; channels?: string | number | null; atmos?: boolean };
}

export interface Version extends QualityInfo {
  id: string;
  label: string;
  source: 'remux' | 'bluray' | 'web-dl' | 'webrip' | 'hdtv' | 'other';
  codec: string | null;
  sizeBytes: number | null;
  bitrateMbps: number | null;
  languages: string[];
  upscaled: boolean;
  cached: boolean;
  recommended: boolean;
}

export interface PlaybackIdentity { id?: string; season?: number; episode?: number }
export interface PlaybackInfo { version?: Version; mimeType: string; filename?: string; sizeBytes?: number; durationSeconds?: number }
export const PLAYBACK_INFO_EVENT = 'tvm:playback-info';
const choices = new Map<string, string>();
const playbackInfo = new Map<string, PlaybackInfo>();

export function playbackKey(identity: PlaybackIdentity): string {
  const match = identity.id?.match(/^([^:]+):(\d+):(\d+)$/);
  return `${match?.[1] ?? identity.id ?? ''}|${identity.season ?? match?.[2] ?? ''}|${identity.episode ?? match?.[3] ?? ''}`;
}

export function orderVersions(versions: readonly Version[]): Version[] {
  return [...versions].sort((a, b) => Number(Boolean(b.recommended)) - Number(Boolean(a.recommended)));
}

export async function fetchPlaybackVersions(identity: PlaybackIdentity, signal?: AbortSignal): Promise<Version[]> {
  const [id, season, episode] = playbackKey(identity).split('|');
  if (!id) return [];
  const query = new URLSearchParams({ id });
  if (season) query.set('season', season);
  if (episode) query.set('episode', episode);
  try {
    const timeout = AbortSignal.timeout(10_000);
    const response = await apiFetch(`/api/playback/versions?${query}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) return [];
    const body = await response.json() as { versions?: Version[] };
    return orderVersions((body.versions ?? []).filter((v) => typeof v.id === 'string' && typeof v.label === 'string'));
  } catch { return []; }
}

export function chooseVersion(identity: PlaybackIdentity, id: string | undefined): void {
  if (id) choices.set(playbackKey(identity), id);
  else choices.delete(playbackKey(identity));
}

export function chosenVersion(identity: PlaybackIdentity): string | undefined {
  return choices.get(playbackKey(identity));
}

export function rememberPlaybackInfo(identity: PlaybackIdentity, info: PlaybackInfo): void {
  // A small, memory-only cache lets player features read metadata without owning the screen's stream lifecycle.
  if (playbackInfo.size > 20) playbackInfo.clear();
  playbackInfo.set(playbackKey(identity), info);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PLAYBACK_INFO_EVENT));
}

export function readPlaybackInfo(identity: PlaybackIdentity): PlaybackInfo | undefined {
  return playbackInfo.get(playbackKey(identity));
}

export function qualityBadges(info?: QualityInfo | null): string[] {
  if (!info) return [];
  return [info.height != null && info.height >= 2160 ? '4K' : '', info.hdr === 'dv' ? 'DV' : info.hdr ? 'HDR' : '',
    info.audio?.atmos ? 'Atmos' : ''].filter(Boolean);
}
