// Wire validation. Keep in step with TVM-accounts' src/sync-schema.ts.
export const SYNC_KINDS = ['profile', 'progress', 'watchlist', 'preference'] as const;
export type SyncKind = typeof SYNC_KINDS[number];

export interface SyncItem {
  kind: SyncKind;
  key: string;
  value: unknown;
  updatedAt: number;
  deleted: boolean;
}

export const SYNC_EXTRAS = [
  'onlineSubtitles', 'trailers', 'trailerBackdrops', 'collections', 'comingUp', 'watchStats',
  'animeTitles', 'ratings', 'qualityBadges', 'versionPicker', 'chapters', 'seekPreviews',
  'themeSongs', 'spoilerBlur', 'surpriseMe', 'autoCollections', 'sleepTimer', 'nightMode',
  'pauseOnMinimize', 'shortcutsOverlay', 'webhook', 'announcements',
] as const;

export const SYNC_PREFS = [
  'subtitleLanguages', 'subtitleStyle', 'audioLanguage', 'skipSegments', 'autoplayNext', 'homeSections',
  ...SYNC_EXTRAS.map(id => 'extras.' + id),
];

const extraKeys = new Set(SYNC_PREFS);
const encoder = new TextEncoder();
export const MAX_VALUE_BYTES = 16 * 1024;
export const MAX_ITEMS = 200;
export const FUTURE_MS = 5 * 60 * 1000;

function object(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => allowed.includes(key));
}

function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}

function displayText(value: unknown, required = false): value is string {
  // The allowed text is for names and catalog metadata. Reject credential/URL snippets as well as
  // unexpected object fields. Arbitrary text intentionally disguised as a title is indistinguishable.
  return typeof value === 'string' && (!required || value.trim().length > 0)
    && !/\b(?:bearer\s+|(?:password|api[_ -]?key|(?:rd|session)[_ -]?token)\s*[:=]|https?:\/\/)/i.test(value);
}

function time(value: unknown): value is string {
  return matches(value, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?(?:Z|[+-]\d\d:\d\d)$/)
    && Number.isFinite(Date.parse(value));
}

export function profileId(value: unknown): value is string {
  return matches(value, /^[\da-zA-Z][\da-zA-Z_-]{0,79}$/) && !/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(value);
}

function mediaId(value: unknown): value is string {
  return matches(value, /^[\da-zA-Z][\da-zA-Z._:-]{0,198}$/);
}

function safeArtwork(value: unknown): boolean {
  return value === '' || matches(value,
    /^https:\/\/(?:images\.metahub\.space|live\.metahub\.space|image\.tmdb\.org|(?:[a-z0-9-]+\.)?mzstatic\.com|(?:[a-z0-9-]+\.)?tvmaze\.com|(?:[a-z0-9-]+\.)?kitsu\.io|(?:[a-z0-9-]+\.)?fanart\.tv|m\.media-amazon\.com|image\.tving\.com|artworks\.tvm\.gl)\/[a-zA-Z0-9./_%~@-]+$/);
}

function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function preference(key: string, value: unknown): boolean {
  switch (key) {
    case 'subtitleLanguages': return Array.isArray(value) && value.length <= 20
      && value.every(language => matches(language, /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/));
    case 'audioLanguage': return matches(value, /^(original|[a-z]{3})$/);
    case 'skipSegments': return value === 'off' || value === 'button' || value === 'auto';
    case 'autoplayNext': return typeof value === 'boolean';
    case 'subtitleStyle': return object(value, ['size', 'color', 'background'])
      && matches(value.size, /^(s|m|l|xl)$/) && matches(value.color, /^(white|yellow|cyan)$/)
      && matches(value.background, /^(shadow|box|none)$/);
    case 'homeSections': return Array.isArray(value) && value.length <= 100
      && value.every(row => object(row, ['id', 'visible']) && matches(row.id, /^[a-z\d][a-z\d-]{0,63}$/i)
        && typeof row.visible === 'boolean');
    default: return extraKeys.has(key) && typeof value === 'boolean';
  }
}

export function validSyncKey(kind: SyncKind, key: unknown): key is string {
  if (typeof key !== 'string' || key.length < 1 || key.length > 200) return false;
  if (kind === 'profile') return profileId(key);
  if (kind === 'preference') return extraKeys.has(key);
  const slash = key.indexOf('/');
  return slash > 0 && profileId(key.slice(0, slash)) && mediaId(key.slice(slash + 1));
}

function validValue(kind: SyncKind, key: string, value: unknown): boolean {
  if (kind === 'preference') return preference(key, value);
  if (kind === 'profile') {
    return object(value, ['id', 'name', 'hue', 'created', 'avatar', 'kind', 'maxAge', 'pin'])
      && value.id === key && displayText(value.name, true) && value.name.length <= 40
      && number(value.hue) && value.hue >= 0 && value.hue < 360 && time(value.created)
      && (value.avatar == null || matches(value.avatar, /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/))
      && (value.kind === 'standard' || value.kind === 'kids')
      && (value.maxAge === 7 || value.maxAge === 12 || value.maxAge === 15 || value.maxAge === 18)
      && (value.pin == null || (object(value.pin, ['hash', 'salt', 'iter'])
        && matches(value.pin.hash, /^[a-f0-9]{64}$/i) && matches(value.pin.salt, /^[a-f0-9]{32}$/i)
        && value.pin.iter === 20_000));
  }
  if (kind === 'progress') {
    return object(value, ['position', 'duration', 'updated', 'hiddenFromContinueWatching', 'completedAt',
      'completions', 'completedTitle', 'completedYear'])
      && number(value.position) && value.position >= 0 && number(value.duration) && value.duration >= 0
      && time(value.updated)
      && (value.hiddenFromContinueWatching === undefined || typeof value.hiddenFromContinueWatching === 'boolean')
      && (value.completedAt === undefined || time(value.completedAt))
      && (value.completions === undefined || (Number.isSafeInteger(value.completions) && (value.completions as number) >= 0))
      && (value.completedTitle === undefined || displayText(value.completedTitle))
      && (value.completedYear == null || number(value.completedYear));
  }
  return object(value, ['id', 'title', 'year', 'kind', 'synopsis', 'poster', 'backdrop', 'genres', 'rating', 'playable', 'hue', 'added'])
    && value.id === key.slice(key.indexOf('/') + 1) && displayText(value.title, true)
    && (value.year === null || number(value.year)) && matches(value.kind, /^(movie|series|file)$/)
    && displayText(value.synopsis) && safeArtwork(value.poster) && safeArtwork(value.backdrop)
    && Array.isArray(value.genres) && value.genres.every(genre => displayText(genre))
    && displayText(value.rating) && typeof value.playable === 'boolean' && number(value.hue)
    && time(value.added);
}

export function parseSyncItem(input: unknown, now: number): SyncItem | null {
  if (!object(input, ['kind', 'key', 'value', 'updatedAt', 'deleted'])) return null;
  const kind = input.kind as SyncKind;
  if (!SYNC_KINDS.includes(kind) || !validSyncKey(kind, input.key)) return null;
  if (!number(input.updatedAt) || !Number.isSafeInteger(input.updatedAt) || input.updatedAt < 0
    || input.updatedAt > now + FUTURE_MS) return null;
  if (input.deleted !== undefined && typeof input.deleted !== 'boolean') return null;
  const deleted = input.deleted === true;
  if (deleted) {
    if (input.value !== null && input.value !== undefined) return null;
    return { kind, key: input.key, value: null, updatedAt: input.updatedAt, deleted: true };
  }
  if (!validValue(kind, input.key, input.value)) return null;
  return { kind, key: input.key, value: input.value, updatedAt: input.updatedAt, deleted: false };
}

export function syncValueBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

export function publicSyncArtwork(value: string): string {
  return safeArtwork(value) ? value : '';
}
