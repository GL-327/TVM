import { getKidsDefaultAge, type AgeLimitValue } from './parental';
import { createPinRecord, verifyPinRecord, type PinRecord } from './pin';
import { apiFetch, invalidateHome, setActiveProfileId } from './media';
import type { Navigate } from '../nav/ViewStackContext';

export type ProfileKind = 'standard' | 'kids';

export interface Profile {
  id: string;
  name: string;
  hue: number;
  created: string;
  avatar?: string | null;
  kind?: ProfileKind;
  maxAge?: AgeLimitValue;
  locked?: boolean;
}

export interface ProfileRegistry {
  activeId: string;
  profiles: Profile[];
}

export class PinChallengeError extends Error {
  code: 'pin-required' | 'pin-wrong' | 'pin-cooldown';
  retryAfter?: number;

  constructor(code: 'pin-required' | 'pin-wrong' | 'pin-cooldown', retryAfter?: number, message?: string) {
    super(
      message ??
        (code === 'pin-cooldown'
          ? `Too many wrong PIN attempts. Try again in ${retryAfter ?? 60} seconds.`
          : code === 'pin-wrong'
            ? 'Wrong PIN.'
            : 'Enter the 4-digit PIN.'),
    );
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

interface LocalProfileMeta {
  avatar?: string | null;
  kind?: ProfileKind;
  maxAge?: AgeLimitValue;
  pin?: PinRecord | null;
}

const META_STORAGE_KEY = 'tvm.profiles.meta';
const EMPTY: ProfileRegistry = { activeId: '', profiles: [] };
let lastRegistry: ProfileRegistry = EMPTY;
const subscribers = new Set<(registry: ProfileRegistry) => void>();

function readLocalMeta(): Record<string, LocalProfileMeta> {
  try {
    const raw = window.localStorage.getItem(META_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, LocalProfileMeta>) : {};
  } catch {
    return {};
  }
}

function writeLocalMeta(map: Record<string, LocalProfileMeta>): void {
  try {
    window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Private browsing mode fallback
  }
}

function patchLocalMeta(id: string, patch: Partial<LocalProfileMeta>): void {
  const all = readLocalMeta();
  const prev = all[id] ?? {};
  all[id] = { ...prev, ...patch };
  writeLocalMeta(all);
}

export function normalizeProfile(raw: Profile): Profile {
  const meta = readLocalMeta()[raw.id];
  const kind: ProfileKind =
    raw.kind === 'kids' || (raw.kind === undefined && meta?.kind === 'kids') ? 'kids' : 'standard';
  const defaultAge: AgeLimitValue = kind === 'kids' ? getKidsDefaultAge() : 18;
  const maxAge = raw.maxAge ?? meta?.maxAge ?? defaultAge;
  const avatar = raw.avatar !== undefined ? raw.avatar : (meta?.avatar ?? null);
  const locked = raw.locked === true || (raw.locked === undefined && meta?.pin != null);
  return {
    ...raw,
    kind,
    maxAge,
    avatar,
    locked,
  };
}

function normalizeRegistry(body: ProfileRegistry): ProfileRegistry {
  const normalized: ProfileRegistry = {
    activeId: body.activeId,
    profiles: (body.profiles ?? []).map(normalizeProfile),
  };
  lastRegistry = normalized;
  if (normalized.activeId !== '') setActiveProfileId(normalized.activeId);
  for (const listener of subscribers) {
    try {
      listener(normalized);
    } catch {
      // One subscriber error should not abort others.
    }
  }
  return normalized;
}

export function subscribeProfiles(listener: (registry: ProfileRegistry) => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function peekProfileRegistry(): ProfileRegistry {
  return lastRegistry;
}

export function peekActiveProfile(): Profile | null {
  return (
    lastRegistry.profiles.find((p) => p.id === lastRegistry.activeId) ??
    lastRegistry.profiles[0] ??
    null
  );
}

export function isKidsProfile(profile: Profile | null | undefined): boolean {
  return profile?.kind === 'kids';
}

export function effectiveProfileMaxAge(profile: Profile | null | undefined): AgeLimitValue {
  if (profile == null) return 18;
  if (profile.maxAge !== undefined) return profile.maxAge;
  return profile.kind === 'kids' ? getKidsDefaultAge() : 18;
}

function parsePinError(status: number, body: { error?: string; retryAfter?: number }, fallbackMsg: string): Error {
  if (
    status === 403 &&
    (body.error === 'pin-required' || body.error === 'pin-wrong' || body.error === 'pin-cooldown')
  ) {
    return new PinChallengeError(body.error, body.retryAfter);
  }
  return new Error(body.error ?? fallbackMsg);
}

export async function fetchProfiles(): Promise<ProfileRegistry> {
  try {
    const response = await apiFetch('/api/profiles');
    if (!response.ok) return EMPTY;
    const body = (await response.json()) as ProfileRegistry;
    return normalizeRegistry(body);
  } catch {
    return lastRegistry.profiles.length > 0 ? lastRegistry : EMPTY;
  }
}

export type CreateProfileInput =
  | string
  | {
      name: string;
      avatar?: string | null;
      kind?: ProfileKind;
      maxAge?: AgeLimitValue;
      pin?: string | null;
    };

export async function createProfile(input: CreateProfileInput): Promise<ProfileRegistry> {
  const payload = typeof input === 'string' ? { name: input } : input;
  const response = await apiFetch('/api/profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as ProfileRegistry & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'The profile was not created.');
  const created = body.profiles?.[body.profiles.length - 1];
  if (created !== undefined) {
    const pinRecord = typeof payload.pin === 'string' && payload.pin !== '' ? await createPinRecord(payload.pin) : null;
    patchLocalMeta(created.id, {
      avatar: payload.avatar ?? null,
      kind: payload.kind ?? 'standard',
      maxAge: payload.maxAge ?? (payload.kind === 'kids' ? getKidsDefaultAge() : 18),
      pin: pinRecord,
    });
  }
  invalidateHome();
  return normalizeRegistry(body);
}

export async function updateProfile(input: {
  id: string;
  name?: string;
  avatar?: string | null;
  kind?: ProfileKind;
  maxAge?: AgeLimitValue;
  pin?: string | null;
  currentPin?: string;
}): Promise<ProfileRegistry> {
  const response = await apiFetch('/api/profiles', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as ProfileRegistry & { error?: string; retryAfter?: number };
  if (!response.ok) {
    throw parsePinError(response.status, body, 'The profile could not be updated.');
  }
  const metaPatch: Partial<LocalProfileMeta> = {};
  if (input.avatar !== undefined) metaPatch.avatar = input.avatar;
  if (input.kind !== undefined) metaPatch.kind = input.kind;
  if (input.maxAge !== undefined) metaPatch.maxAge = input.maxAge;
  if (input.pin === null) metaPatch.pin = null;
  else if (typeof input.pin === 'string' && input.pin !== '') metaPatch.pin = await createPinRecord(input.pin);
  patchLocalMeta(input.id, metaPatch);
  invalidateHome();
  return normalizeRegistry(body);
}

export async function renameProfile(id: string, name: string): Promise<ProfileRegistry> {
  return updateProfile({ id, name });
}

export async function switchProfile(id: string, pin?: string): Promise<ProfileRegistry> {
  const response = await apiFetch('/api/profiles/active', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pin !== undefined ? { id, pin } : { id }),
  });
  const body = (await response.json()) as ProfileRegistry & { error?: string; retryAfter?: number };
  if (!response.ok) {
    throw parsePinError(response.status, body, 'The profile was not switched.');
  }
  invalidateHome();
  return normalizeRegistry(body);
}

export async function removeProfile(id: string, pin?: string): Promise<ProfileRegistry> {
  const response = await apiFetch('/api/profiles/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(pin !== undefined ? { id, pin } : { id }),
  });
  const body = (await response.json()) as ProfileRegistry & { error?: string; retryAfter?: number };
  if (!response.ok) {
    throw parsePinError(response.status, body, 'The profile was not removed.');
  }
  const allMeta = readLocalMeta();
  delete allMeta[id];
  writeLocalMeta(allMeta);
  invalidateHome();
  return normalizeRegistry(body);
}

export async function verifyProfilePin(
  id: string,
  pin: string,
): Promise<{ ok: boolean; error?: 'pin-wrong' | 'pin-cooldown'; retryAfter?: number }> {
  try {
    const response = await apiFetch('/api/profiles/verify-pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, pin }),
    });
    if (response.status !== 404) {
      const body = (await response.json()) as {
        ok?: boolean;
        error?: 'pin-wrong' | 'pin-cooldown';
        retryAfter?: number;
      };
      if (response.status === 403) {
        return {
          ok: false,
          error: body.error ?? 'pin-wrong',
          retryAfter: body.retryAfter,
        };
      }
      return {
        ok: body.ok === true,
        error: body.ok === true ? undefined : (body.error ?? 'pin-wrong'),
        retryAfter: body.retryAfter,
      };
    }
  } catch {
    // Older/on-device Core fallback below
  }
  const local = readLocalMeta()[id]?.pin;
  if (local != null) {
    const ok = await verifyPinRecord(pin, local);
    return ok ? { ok: true } : { ok: false, error: 'pin-wrong' };
  }
  return { ok: false, error: 'pin-wrong' };
}

export async function enterTvmStream(navigate: Navigate): Promise<void> {
  await fetchProfiles();
  navigate.push('profiles', { params: { next: 'library' } });
}
