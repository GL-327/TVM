import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { pbkdf2Sync, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { profileDir, profilesPath, progressPath, watchlistPath } from '../update/paths.ts';
import { readPrivateJson } from './privateJson.ts';
import { writeSealed } from './vault.ts';
import { isAgeLimit, type AgeLimit } from './parental.ts';

export const MAX_PROFILES = 10;

export type ProfileKind = 'standard' | 'kids';

export interface ProfilePin {
  salt: string;
  hash: string;
  iter: number;
}

export interface Profile {
  id: string;
  name: string;
  hue: number;
  created: string;
  /** "<setId>/<avatarId>" from packages/content/avatars.json, or null for colour + initial. */
  avatar?: string | null;
  kind?: ProfileKind;
  /** 7, 12, 15 or 18 (no limit). */
  maxAge?: number;
  pin?: ProfilePin | null;
}

/** What the apps see: never the PIN hash. */
export interface PublicProfile {
  id: string;
  name: string;
  hue: number;
  created: string;
  avatar: string | null;
  kind: ProfileKind;
  maxAge: AgeLimit;
  locked: boolean;
}

export const PIN_ITERATIONS = 20_000;
export const PIN_MAX_TRIES = 5;
export const PIN_LOCKOUT_MS = 60_000;
const PIN_PATTERN = /^\d{4}$/;
const AVATAR_PATTERN = /^[a-z0-9-]{1,40}\/[a-z0-9-]{1,40}$/;

export type PinErrorCode = 'pin-required' | 'pin-wrong' | 'pin-cooldown' | 'pin-invalid';

export class PinError extends Error {
  readonly code: PinErrorCode;
  readonly retryAfter: number | undefined;

  constructor(code: PinErrorCode, retryAfter?: number) {
    super(code);
    this.name = 'PinError';
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** PBKDF2-HMAC-SHA256 over the 4 digits, as Windows (BCrypt) does; see parental.json's test vector. */
export function hashPin(pin: string, saltHex: string, iterations = PIN_ITERATIONS): string {
  return pbkdf2Sync(pin, Buffer.from(saltHex, 'hex'), iterations, 32, 'sha256').toString('hex');
}

export function makePin(pin: string): ProfilePin {
  if (!PIN_PATTERN.test(pin)) throw new PinError('pin-invalid');
  const salt = randomBytes(16).toString('hex');
  return { salt, hash: hashPin(pin, salt), iter: PIN_ITERATIONS };
}

export function pinMatches(stored: ProfilePin, pin: string): boolean {
  if (!PIN_PATTERN.test(pin) || typeof stored.hash !== 'string' || !/^[0-9a-f]{64}$/i.test(stored.hash)) return false;
  const iterations = Number.isInteger(stored.iter) && stored.iter > 0 ? stored.iter : PIN_ITERATIONS;
  const actual = Buffer.from(hashPin(pin, stored.salt, iterations), 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function profileKind(profile: Profile): ProfileKind {
  return profile.kind === 'kids' ? 'kids' : 'standard';
}

export function profileMaxAge(profile: Profile): AgeLimit {
  if (isAgeLimit(profile.maxAge)) return profile.maxAge;
  return profileKind(profile) === 'kids' ? 7 : 18;
}

function isLocked(profile: Profile): boolean {
  return profile.pin !== null && profile.pin !== undefined && typeof profile.pin.hash === 'string';
}

export function publicProfile(profile: Profile): PublicProfile {
  return {
    id: profile.id,
    name: profile.name,
    hue: profile.hue,
    created: profile.created,
    avatar: typeof profile.avatar === 'string' && AVATAR_PATTERN.test(profile.avatar) ? profile.avatar : null,
    kind: profileKind(profile),
    maxAge: profileMaxAge(profile),
    locked: isLocked(profile),
  };
}

export function publicRegistry(registry: ProfileRegistry): { activeId: string; profiles: PublicProfile[] } {
  return { activeId: registry.activeId, profiles: registry.profiles.map(publicProfile) };
}

export interface ProfileChanges {
  name?: string;
  hue?: number;
  avatar?: string | null;
  kind?: ProfileKind;
  maxAge?: number;
  /** A new 4-digit PIN, or null to remove the lock. */
  pin?: string | null;
}

function cleanAvatar(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' && AVATAR_PATTERN.test(value) ? value : undefined;
}

export interface ProfileRegistry {
  activeId: string;
  profiles: Profile[];
}

/*
 * Profile colours, starting on the brand.
 *
 * The first hue was 350 — crimson — so the one profile a fresh install
 * creates was red: the single colour the palette reserves for failure, on the
 * screen that greets a new viewer, in an app whose signature is the orbital
 * blue. The list now opens on that signature (#2f6bff is hue 221) and the rest are
 * spaced far enough apart to tell people apart at a glance, with red left out
 * so a profile never reads as an error.
 *
 * Existing profiles keep the hue they were stored with; this only decides what
 * a new one gets.
 */
const HUES = [221, 190, 145, 38, 315];

function defaultProfile(index = 0): Profile {
  return {
    id: `profile-${index + 1}`,
    name: `Profile ${index + 1}`,
    hue: HUES[index % HUES.length] ?? 220,
    created: new Date().toISOString(),
  };
}

function persist(dataDir: string, registry: ProfileRegistry): ProfileRegistry {
  mkdirSync(dataDir, { recursive: true });
  writeSealed(dataDir, profilesPath(dataDir), registry);
  mkdirSync(profileDir(dataDir, registry.activeId), { recursive: true });
  return registry;
}

function migrateLegacy(dataDir: string, profileId: string): void {
  const dest = profileDir(dataDir, profileId);
  mkdirSync(dest, { recursive: true });
  const oldProgress = progressPath(dataDir);
  const nextProgress = progressPath(dest);
  if (existsSync(oldProgress) && !existsSync(nextProgress)) renameSync(oldProgress, nextProgress);
  const oldWatchlist = watchlistPath(dataDir);
  const nextWatchlist = watchlistPath(dest);
  if (existsSync(oldWatchlist) && !existsSync(nextWatchlist)) renameSync(oldWatchlist, nextWatchlist);
}

export function loadProfiles(dataDir: string): ProfileRegistry {
  try {
    const parsed = readPrivateJson<ProfileRegistry>(dataDir, profilesPath(dataDir));
    if (parsed === null) throw new Error('profiles missing');
    if (Array.isArray(parsed.profiles) && parsed.profiles.length > 0) {
      const active = parsed.profiles.some((profile) => profile.id === parsed.activeId)
        ? parsed.activeId
        : parsed.profiles[0]?.id;
      if (active !== undefined) {
        mkdirSync(profileDir(dataDir, active), { recursive: true });
        return { activeId: active, profiles: parsed.profiles.slice(0, MAX_PROFILES) };
      }
    }
  } catch {
    // First run.
  }
  const first = defaultProfile(0);
  migrateLegacy(dataDir, first.id);
  return persist(dataDir, { activeId: first.id, profiles: [first] });
}

export function createProfileService(dataDir: string, now: () => number = Date.now) {
  let registry = loadProfiles(dataDir);
  // Wrong PINs per profile, kept in memory: a restart forgives, a running Core does not.
  const tries = new Map<string, { count: number; until: number }>();

  const unlock = (id: string, pin: unknown): void => {
    const profile = registry.profiles.find((entry) => entry.id === id);
    if (profile === undefined) throw new Error('Unknown profile.');
    if (!isLocked(profile)) return;
    const state = tries.get(id);
    if (state !== undefined && state.until > now()) {
      throw new PinError('pin-cooldown', Math.ceil((state.until - now()) / 1000));
    }
    if (typeof pin !== 'string' || pin === '') throw new PinError('pin-required');
    if (pinMatches(profile.pin as ProfilePin, pin)) {
      tries.delete(id);
      return;
    }
    const count = (state?.count ?? 0) + 1;
    if (count >= PIN_MAX_TRIES) {
      tries.set(id, { count: 0, until: now() + PIN_LOCKOUT_MS });
      throw new PinError('pin-cooldown', Math.ceil(PIN_LOCKOUT_MS / 1000));
    }
    tries.set(id, { count, until: 0 });
    throw new PinError('pin-wrong');
  };

  const save = (next: ProfileRegistry): ProfileRegistry => {
    registry = persist(dataDir, next);
    return registry;
  };

  return {
    list(): ProfileRegistry {
      return registry;
    },
    activeId(): string {
      return registry.activeId;
    },
    scope(): string {
      return profileDir(dataDir, registry.activeId);
    },
    find(id: string): Profile | undefined {
      return registry.profiles.find((profile) => profile.id === id);
    },
    active(): Profile | undefined {
      return registry.profiles.find((profile) => profile.id === registry.activeId);
    },
    /** Passes for an unlocked profile or the right PIN; otherwise throws PinError. */
    unlock,
    create(name: string, max = MAX_PROFILES, extra: Omit<ProfileChanges, 'name'> = {}): ProfileRegistry {
      const cap = Math.max(1, Math.min(MAX_PROFILES, max));
      if (registry.profiles.length >= cap) {
        throw new Error(`TVM holds ${cap} profiles.`);
      }
      const trimmed = name.trim() === '' ? `Profile ${registry.profiles.length + 1}` : name.trim();
      const index = registry.profiles.length;
      const kind: ProfileKind = extra.kind === 'kids' ? 'kids' : 'standard';
      if (extra.maxAge !== undefined && !isAgeLimit(extra.maxAge)) throw new Error('Age limit must be 7, 12, 15 or 18.');
      const profile: Profile = {
        ...defaultProfile(index),
        name: trimmed.slice(0, 40),
        id: `profile-${randomUUID()}`,
        ...(typeof extra.hue === 'number' && Number.isFinite(extra.hue) ? { hue: Math.abs(Math.round(extra.hue)) % 360 } : {}),
        avatar: cleanAvatar(extra.avatar) ?? null,
        kind,
        maxAge: isAgeLimit(extra.maxAge) ? extra.maxAge : kind === 'kids' ? 7 : 18,
        pin: typeof extra.pin === 'string' ? makePin(extra.pin) : null,
      };
      mkdirSync(profileDir(dataDir, profile.id), { recursive: true });
      return save({ activeId: profile.id, profiles: [...registry.profiles, profile] });
    },
    rename(id: string, name: string): ProfileRegistry {
      const trimmed = name.trim();
      if (trimmed === '') return registry;
      return save({
        ...registry,
        profiles: registry.profiles.map((profile) => (profile.id === id ? { ...profile, name: trimmed } : profile)),
      });
    },
    /**
     * Edits a profile. A locked profile needs its PIN for any edit. Making a
     * kids profile a standard one (or raising its limit) also needs the PIN of
     * a locked standard profile when one exists, so a child cannot lift it.
     */
    update(id: string, changes: ProfileChanges, currentPin?: unknown): ProfileRegistry {
      const profile = registry.profiles.find((entry) => entry.id === id);
      if (profile === undefined) throw new Error('Unknown profile.');
      unlock(id, currentPin);
      const loosening =
        profileKind(profile) === 'kids' &&
        (changes.kind === 'standard' || (changes.maxAge !== undefined && changes.maxAge > profileMaxAge(profile)));
      if (loosening) {
        const guard = registry.profiles.find((entry) => entry.id !== id && profileKind(entry) === 'standard' && isLocked(entry));
        if (guard !== undefined) unlock(guard.id, currentPin);
      }
      const next: Profile = { ...profile };
      if (typeof changes.name === 'string' && changes.name.trim() !== '') next.name = changes.name.trim().slice(0, 40);
      if (typeof changes.hue === 'number' && Number.isFinite(changes.hue)) next.hue = Math.abs(Math.round(changes.hue)) % 360;
      const avatar = cleanAvatar(changes.avatar);
      if (avatar !== undefined) next.avatar = avatar;
      if (changes.kind === 'kids' || changes.kind === 'standard') {
        if (changes.kind === 'kids' && changes.maxAge === undefined && profileKind(profile) !== 'kids') next.maxAge = 7;
        if (changes.kind === 'standard' && changes.maxAge === undefined && profileKind(profile) === 'kids') next.maxAge = 18;
        next.kind = changes.kind;
      }
      if (changes.maxAge !== undefined) {
        if (!isAgeLimit(changes.maxAge)) throw new Error('Age limit must be 7, 12, 15 or 18.');
        next.maxAge = changes.maxAge;
      }
      if (changes.pin === null) next.pin = null;
      else if (typeof changes.pin === 'string') next.pin = makePin(changes.pin);
      return save({ ...registry, profiles: registry.profiles.map((entry) => (entry.id === id ? next : entry)) });
    },
    remove(id: string): ProfileRegistry {
      if (registry.profiles.length <= 1) throw new Error('TVM needs at least one profile.');
      const profiles = registry.profiles.filter((profile) => profile.id !== id);
      const activeId = registry.activeId === id ? (profiles[0]?.id ?? registry.activeId) : registry.activeId;
      return save({ activeId, profiles });
    },
    switchTo(id: string): ProfileRegistry {
      if (registry.activeId === id) return registry;
      if (!registry.profiles.some((profile) => profile.id === id)) throw new Error('Unknown profile.');
      mkdirSync(profileDir(dataDir, id), { recursive: true });
      return save({ ...registry, activeId: id });
    },
    reload(): ProfileRegistry {
      registry = loadProfiles(dataDir);
      return registry;
    },
  };
}

export type ProfileService = ReturnType<typeof createProfileService>;
