/**
 * Franchise intro matching and once-per-session bookkeeping. Pure logic, no
 * React: the Player asks `pickIntro` when playback starts and `markIntroPlayed`
 * when the intro ends or is skipped.
 */
import rawIntros from '../../../../packages/content/intros.json';

export type IntroStyle = 'mockingjay' | 'doom';

export interface IntroDef {
  id: string;
  event: string;
  style: IntroStyle;
  imdbIds: string[];
  titlePattern: string;
  accent: string;
  glow: string;
  durationMs: number;
  titles: Record<string, string>;
}

export interface IntroPick {
  intro: IntroDef;
  /** Base title id used for the once-per-session rule (a series is one title). */
  titleKey: string;
  /** Name drawn on the card. */
  title: string;
}

export const MIN_INTRO_MS = 2500;
export const MAX_INTRO_MS = 4000;

function isDef(value: unknown): value is IntroDef {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['id'] === 'string' && (v['style'] === 'mockingjay' || v['style'] === 'doom') &&
    Array.isArray(v['imdbIds']) && typeof v['titlePattern'] === 'string' && typeof v['accent'] === 'string' &&
    typeof v['glow'] === 'string' && typeof v['durationMs'] === 'number' && typeof v['titles'] === 'object';
}

export function clampDuration(ms: number): number {
  if (!Number.isFinite(ms)) return MAX_INTRO_MS;
  return Math.min(MAX_INTRO_MS, Math.max(MIN_INTRO_MS, Math.round(ms)));
}

export const INTROS: IntroDef[] = ((rawIntros as { intros?: unknown[] }).intros ?? []).filter(isDef);

/** `tt0371746:1:2`, `tt0371746` and `/tt0371746` all give `tt0371746`. */
export function baseImdb(id: string): string | null {
  const match = id.trim().match(/tt\d+/i);
  return match === null ? null : match[0].toLowerCase();
}

function regexFor(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return null;
  }
}

function cardTitle(def: IntroDef, imdb: string | null, played: string): string {
  const known = imdb !== null ? def.titles[imdb] : undefined;
  if (known !== undefined) return known;
  if (def.style === 'mockingjay') return played.replace(/^the hunger games:?\s*/i, '').trim();
  return played.trim();
}

export function matchIntro(id: string, title: string, defs: IntroDef[] = INTROS): IntroPick | null {
  const imdb = baseImdb(id);
  const name = title.trim();
  for (const def of defs) {
    const byId = imdb !== null && def.imdbIds.includes(imdb);
    const regex = byId || name === '' ? null : regexFor(def.titlePattern);
    const byTitle = regex !== null && regex.test(name);
    if (!byId && !byTitle) continue;
    return {
      intro: { ...def, durationMs: clampDuration(def.durationMs) },
      titleKey: imdb ?? `${def.id}:${name.toLowerCase()}`,
      title: cardTitle(def, imdb, name),
    };
  }
  return null;
}

const played = new Set<string>();

export function hasIntroPlayed(titleKey: string): boolean {
  return played.has(titleKey);
}

export function markIntroPlayed(titleKey: string): void {
  played.add(titleKey);
}

export function resetIntroSession(): void {
  played.clear();
}

/** Automated runs never get a full-screen overlay: it would cover the controls the tests use. */
export function introSkippedForAutomation(): boolean {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return true;
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('skipIntro') === '1' || params.get('e2e') === '1';
  } catch {
    return false;
  }
}

export interface IntroPlanInput {
  id: string;
  title: string;
  live: boolean;
  enabled: boolean;
  automation: boolean;
}

/** The intro to play now, or null: live, switched off, automated, unmatched or already seen. */
export function planIntro(input: IntroPlanInput, defs: IntroDef[] = INTROS): IntroPick | null {
  if (input.live || !input.enabled || input.automation) return null;
  const pick = matchIntro(input.id, input.title, defs);
  if (pick === null || hasIntroPlayed(pick.titleKey)) return null;
  return pick;
}
