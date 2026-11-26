import { apiFetch, type LiveChannel } from './media';

export interface Programme {
  start: string;
  end: string;
  title: string;
  subtitle?: string;
  description?: string;
  category?: string;
  image?: string;
  episode?: string;
}
export interface GuideChannel extends Omit<LiveChannel, 'url'> {
  number: number | string;
  source: 'free' | 'm3u' | 'xtream';
  programmes: Programme[];
}
export interface GuideData {
  now: string; start: string; end: string; groups: string[]; channels: GuideChannel[];
  /** Core is still downloading a feed this answer needed; a fuller answer follows. */
  refreshing?: boolean;
}
/** How often, and for how long, the guide asks again while Core reports `refreshing`. */
export const GUIDE_REFRESH_MS = 4_000;
export const GUIDE_REFRESH_LIMIT = 30;
export const MINUTE = 60_000;
export const HALF_HOUR = 30 * MINUTE;
export const GUIDE_HOURS = 8;

export function guideStart(now: number, day: number): number {
  if (day === 0) return Math.floor(now / HALF_HOUR) * HALF_HOUR;
  const date = new Date(now);
  date.setDate(date.getDate() + day);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function programmeAt(programmes: readonly Programme[], time: number): number {
  let nearest = 0;
  let distance = Infinity;
  for (const [index, programme] of programmes.entries()) {
    const start = +new Date(programme.start);
    const end = +new Date(programme.end);
    const gap = Math.max(start - time, time - end + 1, 0);
    if (gap < distance) { distance = gap; nearest = index; }
  }
  return nearest;
}

export async function fetchGuide(start: number, signal: AbortSignal): Promise<GuideData | null> {
  try {
    const params = new URLSearchParams({ start: new Date(start).toISOString(), hours: String(GUIDE_HOURS) });
    const response = await apiFetch('/api/live/guide?' + params, { signal });
    if (!response.ok) return null;
    const body = await response.json() as GuideData;
    return Array.isArray(body.channels) ? body : null;
  } catch {
    return null;
  }
}
