import { getEventsContent, type ContentEvent } from './content';
import { apiFetch, fetchMedia, type MediaItem } from './media';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface ActiveEvent extends ContentEvent {
  live: true;
  released: boolean;
  kicker: string;
  spotlight?: MediaItem | null;
  items: MediaItem[];
}

export function localIsoDate(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isEventLive(event: Pick<ContentEvent, 'start' | 'end'>, today = localIsoDate()): boolean {
  return event.start <= today && today <= event.end;
}

export function isEventReleased(event: Pick<ContentEvent, 'release'>, today = localIsoDate()): boolean {
  return today >= event.release;
}

export function formatReleaseDayMonth(isoDate: string): string {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match === null) return isoDate;
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const monthName = MONTHS[monthIndex];
  if (monthName === undefined || !Number.isFinite(day)) return isoDate;
  return `${day} ${monthName}`;
}

export function eventKicker(event: Pick<ContentEvent, 'release'>, today = localIsoDate()): string {
  if (isEventReleased(event, today)) return 'In cinemas now';
  return `In cinemas ${formatReleaseDayMonth(event.release)}`;
}

export function activeEventsLocal(now = new Date()): ActiveEvent[] {
  const today = localIsoDate(now);
  return getEventsContent()
    .events.filter((event) => isEventLive(event, today))
    .map((event) => ({
      ...event,
      live: true,
      released: isEventReleased(event, today),
      kicker: eventKicker(event, today),
      spotlight: null,
      items: [],
    }));
}

export function primaryActiveEvent(now = new Date()): ContentEvent | null {
  const today = localIsoDate(now);
  return getEventsContent().events.find((event) => isEventLive(event, today)) ?? null;
}

function stubEventItem(id: string, title = id): MediaItem {
  return {
    id,
    title,
    year: null,
    kind: 'movie',
    synopsis: '',
    poster: '',
    backdrop: '',
    genres: [],
    rating: '',
    playable: false,
    hue: 210,
  };
}

export async function fetchActiveEvents(now = new Date()): Promise<ActiveEvent[]> {
  try {
    const res = await apiFetch('/api/events/active', { signal: AbortSignal.timeout(10_000) });
    if (res.ok) {
      const body = (await res.json()) as { events?: ActiveEvent[] };
      if (Array.isArray(body.events)) {
        const today = localIsoDate(now);
        return body.events.map((event) => ({
          ...event,
          live: true,
          released: typeof event.released === 'boolean' ? event.released : isEventReleased(event, today),
          kicker: typeof event.kicker === 'string' && event.kicker !== '' ? event.kicker : eventKicker(event, today),
          spotlight: event.spotlight ?? event.items?.find((item) => item.id === event.imdbId) ?? null,
          items: Array.isArray(event.items) ? event.items : [],
        }));
      }
    }
  } catch {
    // Fall back gracefully to bundled events + Cinemeta metadata lookup.
  }

  const local = activeEventsLocal(now);
  if (local.length === 0) return [];

  return Promise.all(
    local.map(async (event) => {
      const uniqueIds = Array.from(new Set([event.imdbId, ...event.rail.items]));
      const resolvedMap = new Map<string, MediaItem>();
      await Promise.all(
        uniqueIds.map(async (id) => {
          const item = await fetchMedia(id);
          if (item !== null) resolvedMap.set(id, item);
        }),
      );
      const spotlight = resolvedMap.get(event.imdbId) ?? stubEventItem(event.imdbId, event.title);
      const items = event.rail.items.map((id) => resolvedMap.get(id) ?? stubEventItem(id, event.title));
      return {
        ...event,
        spotlight,
        items,
      };
    }),
  );
}
