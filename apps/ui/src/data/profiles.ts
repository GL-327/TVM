import { apiFetch, invalidateHome, setActiveProfileId } from './media';
import type { Navigate } from '../nav/ViewStackContext';

export interface Profile {
  id: string;
  name: string;
  hue: number;
  created: string;
}

export interface ProfileRegistry {
  activeId: string;
  profiles: Profile[];
}

const EMPTY: ProfileRegistry = { activeId: '', profiles: [] };

export async function fetchProfiles(): Promise<ProfileRegistry> {
  try {
    const response = await apiFetch('/api/profiles');
    if (!response.ok) return EMPTY;
    const body = (await response.json()) as ProfileRegistry;
    if (body.activeId !== '') setActiveProfileId(body.activeId);
    return body;
  } catch {
    return EMPTY;
  }
}

export async function createProfile(name: string): Promise<ProfileRegistry> {
  const response = await apiFetch('/api/profiles', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = (await response.json()) as ProfileRegistry & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'The profile was not created.');
  setActiveProfileId(body.activeId);
  invalidateHome();
  return body;
}

export async function renameProfile(id: string, name: string): Promise<ProfileRegistry> {
  const response = await apiFetch('/api/profiles', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, name }),
  });
  return (await response.json()) as ProfileRegistry;
}

export async function switchProfile(id: string): Promise<ProfileRegistry> {
  const response = await apiFetch('/api/profiles/active', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const body = (await response.json()) as ProfileRegistry & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'The profile was not switched.');
  setActiveProfileId(body.activeId);
  invalidateHome();
  return body;
}

export async function removeProfile(id: string): Promise<ProfileRegistry> {
  const response = await apiFetch('/api/profiles/remove', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  const body = (await response.json()) as ProfileRegistry & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'The profile was not removed.');
  setActiveProfileId(body.activeId);
  invalidateHome();
  return body;
}

export async function enterTvmStream(navigate: Navigate): Promise<void> {
  await fetchProfiles();
  navigate.push('profiles', { params: { next: 'library' } });
}
