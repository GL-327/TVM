/**
 * Bundled shared content (`packages/content/*.json`) plus background remote refresh.
 *
 * Bundled JSON is imported at build time so startup never waits on the network.
 * Refreshable files check Core `/api/content/<name>` and fall back to GitHub raw
 * at most once every 6 hours, validating `schema === 1` and exact structure before
 * caching in localStorage.
 */

import rawAvatars from '../../../../packages/content/avatars.json';
import rawChangelog from '../../../../packages/content/changelog.json';
import rawEvents from '../../../../packages/content/events.json';
import rawFreeChannels from '../../../../packages/content/free-channels.json';
import rawParental from '../../../../packages/content/parental.json';
import rawServices from '../../../../packages/content/services.json';

export type RefreshableContentName = 'events' | 'free-channels' | 'services' | 'avatars';
export type ContentName = RefreshableContentName | 'changelog' | 'parental';

export type AgeLimitValue = 7 | 12 | 15 | 18;

export interface ChangelogChange {
  area: string;
  text: string;
  platforms?: string[];
}

export interface ChangelogRelease {
  version: string;
  date: string;
  title: string;
  highlights: string[];
  changes: ChangelogChange[];
  knownIssues?: string[];
}

export interface ChangelogContent {
  schema: 1;
  releases: ChangelogRelease[];
}

export interface ContentEventRail {
  id: string;
  title: string;
  items: string[];
}

export interface ContentEvent {
  id: string;
  title: string;
  imdbId: string;
  release: string;
  start: string;
  end: string;
  accent: string;
  glow: string;
  effect?: 'embers' | 'sparks' | 'snow' | 'dust' | 'stars' | 'none';
  line: string;
  rail: ContentEventRail;
  avatarSet: string;
}

export interface EventsContent {
  schema: 1;
  updated?: string;
  events: ContentEvent[];
}

export interface FreeChannel {
  id: string;
  name: string;
  group: string;
  country: string | null;
  logo: string | null;
  url: string;
  geo: string | null;
  website: string | null;
}

export interface FreeChannelsContent {
  schema: 1;
  updated?: string;
  channels: FreeChannel[];
}

export interface ServiceEntry {
  id: string;
  name: string;
  accent: string;
  signin: string;
  home: string;
  search: string | null;
  roku: string | null;
  android: string | null;
  ios: string | null;
  regions: string[] | null;
}

export interface ServicesContent {
  schema: 1;
  updated?: string;
  services: ServiceEntry[];
}

export interface AvatarItem {
  id: string;
  name: string;
  actor?: string;
  image: string;
}

export interface AvatarSet {
  id: string;
  title: string;
  kind: string;
  avatars: AvatarItem[];
}

export interface AvatarsContent {
  schema: 1;
  updated?: string;
  sets: AvatarSet[];
}

export interface ParentalLevel {
  maxAge: AgeLimitValue;
  label: string;
  allow: string[] | null;
  block: string[];
  liveGroups: string[] | null;
}

export interface ParentalPinPolicy {
  digits: number;
  kdf: string;
  iterations: number;
  saltBytes: number;
  keyBytes: number;
  maxTries: number;
  lockoutSeconds: number;
  testVector: {
    pin: string;
    saltHex: string;
    hashHex: string;
  };
}

export interface ParentalContent {
  schema: 1;
  levels: ParentalLevel[];
  kidsDefault: AgeLimitValue;
  pin: ParentalPinPolicy;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const CACHE_PREFIX = 'tvm.content.';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/GL-327/TVM/main/packages/content';

interface CachedEnvelope<T> {
  fetchedAt: number;
  data: T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

export function isValidEventsContent(value: unknown): value is EventsContent {
  if (!isObject(value) || value.schema !== 1 || !Array.isArray(value.events)) return false;
  return value.events.every((item) => {
    if (!isObject(item)) return false;
    if (
      typeof item.id !== 'string' ||
      typeof item.title !== 'string' ||
      typeof item.imdbId !== 'string' ||
      typeof item.release !== 'string' ||
      typeof item.start !== 'string' ||
      typeof item.end !== 'string' ||
      typeof item.accent !== 'string' ||
      typeof item.glow !== 'string' ||
      typeof item.line !== 'string' ||
      typeof item.avatarSet !== 'string'
    ) {
      return false;
    }
    return (
      isObject(item.rail) &&
      typeof item.rail.id === 'string' &&
      typeof item.rail.title === 'string' &&
      isStringArray(item.rail.items)
    );
  });
}

export function isValidFreeChannelsContent(value: unknown): value is FreeChannelsContent {
  if (!isObject(value) || value.schema !== 1 || !Array.isArray(value.channels)) return false;
  return value.channels.every(
    (ch) =>
      isObject(ch) &&
      typeof ch.id === 'string' &&
      typeof ch.name === 'string' &&
      typeof ch.group === 'string' &&
      typeof ch.url === 'string' &&
      isNullableString(ch.country ?? null) &&
      isNullableString(ch.logo ?? null) &&
      isNullableString(ch.geo ?? null) &&
      isNullableString(ch.website ?? null),
  );
}

export function isValidServicesContent(value: unknown): value is ServicesContent {
  if (!isObject(value) || value.schema !== 1 || !Array.isArray(value.services)) return false;
  return value.services.every(
    (svc) =>
      isObject(svc) &&
      typeof svc.id === 'string' &&
      typeof svc.name === 'string' &&
      typeof svc.accent === 'string' &&
      typeof svc.signin === 'string' &&
      typeof svc.home === 'string' &&
      isNullableString(svc.search ?? null) &&
      isNullableString(svc.roku ?? null) &&
      isNullableString(svc.android ?? null) &&
      isNullableString(svc.ios ?? null) &&
      (svc.regions === null || svc.regions === undefined || isStringArray(svc.regions)),
  );
}

export function isValidAvatarsContent(value: unknown): value is AvatarsContent {
  if (!isObject(value) || value.schema !== 1 || !Array.isArray(value.sets)) return false;
  return value.sets.every(
    (set) =>
      isObject(set) &&
      typeof set.id === 'string' &&
      typeof set.title === 'string' &&
      typeof set.kind === 'string' &&
      Array.isArray(set.avatars) &&
      set.avatars.every(
        (av) =>
          isObject(av) &&
          typeof av.id === 'string' &&
          typeof av.name === 'string' &&
          typeof av.image === 'string' &&
          (av.actor === undefined || typeof av.actor === 'string'),
      ),
  );
}

export function isValidChangelogContent(value: unknown): value is ChangelogContent {
  if (!isObject(value) || value.schema !== 1 || !Array.isArray(value.releases)) return false;
  return value.releases.every(
    (rel) =>
      isObject(rel) &&
      typeof rel.version === 'string' &&
      typeof rel.date === 'string' &&
      typeof rel.title === 'string' &&
      isStringArray(rel.highlights) &&
      Array.isArray(rel.changes) &&
      rel.changes.every(
        (ch) =>
          isObject(ch) &&
          typeof ch.area === 'string' &&
          typeof ch.text === 'string' &&
          (ch.platforms === undefined || isStringArray(ch.platforms)),
      ),
  );
}

export const BUNDLED_CHANGELOG: ChangelogContent = rawChangelog as unknown as ChangelogContent;
export const BUNDLED_EVENTS: EventsContent = rawEvents as unknown as EventsContent;
export const BUNDLED_FREE_CHANNELS: FreeChannelsContent = rawFreeChannels as unknown as FreeChannelsContent;
export const BUNDLED_SERVICES: ServicesContent = rawServices as unknown as ServicesContent;
export const BUNDLED_AVATARS: AvatarsContent = rawAvatars as unknown as AvatarsContent;
export const BUNDLED_PARENTAL: ParentalContent = rawParental as unknown as ParentalContent;

const VALIDATORS: {
  events: (v: unknown) => v is EventsContent;
  'free-channels': (v: unknown) => v is FreeChannelsContent;
  services: (v: unknown) => v is ServicesContent;
  avatars: (v: unknown) => v is AvatarsContent;
} = {
  events: isValidEventsContent,
  'free-channels': isValidFreeChannelsContent,
  services: isValidServicesContent,
  avatars: isValidAvatarsContent,
};

interface RefreshableMap {
  events: EventsContent;
  'free-channels': FreeChannelsContent;
  services: ServicesContent;
  avatars: AvatarsContent;
}

const BUNDLED_MAP: RefreshableMap = {
  events: BUNDLED_EVENTS,
  'free-channels': BUNDLED_FREE_CHANNELS,
  services: BUNDLED_SERVICES,
  avatars: BUNDLED_AVATARS,
};

const inFlight = new Map<RefreshableContentName, Promise<void>>();

function readCache<K extends RefreshableContentName>(name: K): CachedEnvelope<RefreshableMap[K]> | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${name}`);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || typeof parsed.fetchedAt !== 'number') return null;
    const validator = VALIDATORS[name];
    if (!validator(parsed.data)) return null;
    return { fetchedAt: parsed.fetchedAt, data: parsed.data as RefreshableMap[K] };
  } catch {
    return null;
  }
}

function writeCache<K extends RefreshableContentName>(name: K, data: RefreshableMap[K], now = Date.now()): void {
  try {
    const payload: CachedEnvelope<RefreshableMap[K]> = { fetchedAt: now, data };
    localStorage.setItem(`${CACHE_PREFIX}${name}`, JSON.stringify(payload));
  } catch {
    // Storage quota or private browsing mode: bundled copy stays intact.
  }
}

export function getEventsContent(): EventsContent {
  return readCache('events')?.data ?? BUNDLED_EVENTS;
}

export function getFreeChannelsContent(): FreeChannelsContent {
  return readCache('free-channels')?.data ?? BUNDLED_FREE_CHANNELS;
}

export function getServicesContent(): ServicesContent {
  return readCache('services')?.data ?? BUNDLED_SERVICES;
}

export function getAvatarsContent(): AvatarsContent {
  return readCache('avatars')?.data ?? BUNDLED_AVATARS;
}

export function getChangelogContent(): ChangelogContent {
  return BUNDLED_CHANGELOG;
}

export function getParentalContent(): ParentalContent {
  return BUNDLED_PARENTAL;
}

async function fetchAndValidate<K extends RefreshableContentName>(
  name: K,
  url: string,
  fetcher: typeof fetch,
): Promise<RefreshableMap[K] | null> {
  try {
    const res = await fetcher(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    const validator = VALIDATORS[name];
    if (!validator(json)) return null;
    return json as RefreshableMap[K];
  } catch {
    return null;
  }
}

export async function refreshContentInBackground<K extends RefreshableContentName>(
  name: K,
  options?: { force?: boolean; now?: number; fetcher?: typeof fetch },
): Promise<RefreshableMap[K]> {
  const now = options?.now ?? Date.now();
  const cached = readCache(name);
  if (!options?.force && cached !== null && now - cached.fetchedAt < SIX_HOURS_MS) {
    return cached.data;
  }

  const existing = inFlight.get(name);
  if (existing !== undefined) {
    await existing;
    return readCache(name)?.data ?? BUNDLED_MAP[name];
  }

  const fetcher = options?.fetcher ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (fetcher === null) return cached?.data ?? BUNDLED_MAP[name];

  const task = (async () => {
    const fromCore = await fetchAndValidate(name, `/api/content/${name}`, fetcher);
    if (fromCore !== null) {
      writeCache(name, fromCore, now);
      return;
    }
    const fromGitHub = await fetchAndValidate(name, `${GITHUB_RAW_BASE}/${name}.json`, fetcher);
    if (fromGitHub !== null) {
      writeCache(name, fromGitHub, now);
    }
  })().finally(() => {
    inFlight.delete(name);
  });

  inFlight.set(name, task);
  await task;
  return readCache(name)?.data ?? BUNDLED_MAP[name];
}

let backgroundRefreshStarted = false;

/** Kick off non-blocking refresh for refreshable content files once per session. */
export function startContentBackgroundRefresh(): void {
  if (backgroundRefreshStarted) return;
  if (typeof window === 'undefined' || import.meta.env.MODE === 'test') return;
  backgroundRefreshStarted = true;
  const targets: RefreshableContentName[] = ['events', 'free-channels', 'services', 'avatars'];
  for (const name of targets) {
    void refreshContentInBackground(name);
  }
}
