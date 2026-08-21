import { httpAssetUrl } from './title.ts';
import type { LiveChannel } from './types.ts';

export const XTREAM_ID_PREFIX = 'live:xtream:';

export interface XtreamAccount {
  host: string;
  username: string;
  password: string;
}

export interface XtreamLoad {
  channels: LiveChannel[];
  error: string | null;
  username: string | null;
}

interface PlayerApiUser {
  username?: unknown;
  auth?: unknown;
  status?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

export function xtreamChannelId(streamId: string): string {
  return `${XTREAM_ID_PREFIX}${streamId}`;
}

export function xtreamStreamId(id: string): string | null {
  if (!id.startsWith(XTREAM_ID_PREFIX)) return null;
  const streamId = id.slice(XTREAM_ID_PREFIX.length).trim();
  return streamId === '' ? null : streamId;
}

/**
 * Accept a panel host, `http(s)://host:port`, or a pasted player_api.php URL.
 * Drops query strings and PHP entrypoints so credentials stay in Core.
 */
export function normalizeXtreamHost(raw: string): string | null {
  let value = raw.trim();
  if (value === '') return null;
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  parsed.pathname = parsed.pathname.replace(/\/(player_api|get|panel_api)\.php$/i, '');
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  const path = parsed.pathname === '/' ? '' : parsed.pathname;
  return `${parsed.origin}${path}`;
}

export function xtreamPlayerApiUrl(account: XtreamAccount, action?: string): string {
  const params = new URLSearchParams({
    username: account.username,
    password: account.password,
  });
  if (action !== undefined && action !== '') params.set('action', action);
  return `${account.host}/player_api.php?${params.toString()}`;
}

export function xtreamStreamUrl(account: XtreamAccount, streamId: string): string {
  return `${account.host}/live/${encodeURIComponent(account.username)}/${encodeURIComponent(account.password)}/${encodeURIComponent(streamId)}.m3u8`;
}

function authOk(user: PlayerApiUser | null): boolean {
  if (user === null) return false;
  if (user.auth === 1 || user.auth === '1' || user.auth === true) return true;
  if (typeof user.status === 'string' && user.status.toLowerCase() === 'active' && user.auth !== 0 && user.auth !== '0') {
    return true;
  }
  return false;
}

function categoryName(entry: unknown): { id: string; name: string } | null {
  const row = asRecord(entry);
  if (row === null) return null;
  const id = row['category_id'];
  const name = row['category_name'];
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  const label = typeof name === 'string' && name.trim() !== '' ? name.trim() : 'Live';
  return { id: String(id), name: label };
}

function streamRow(entry: unknown, groups: Map<string, string>): LiveChannel | null {
  const row = asRecord(entry);
  if (row === null) return null;
  const streamId = row['stream_id'];
  if (typeof streamId !== 'string' && typeof streamId !== 'number') return null;
  const id = String(streamId).trim();
  if (id === '') return null;
  const named = row['name'];
  const name = typeof named === 'string' && named.trim() !== '' ? named.trim() : `Channel ${id}`;
  const categoryId = row['category_id'];
  const groupKey = typeof categoryId === 'string' || typeof categoryId === 'number' ? String(categoryId) : '';
  const icon = row['stream_icon'];
  const channel: LiveChannel = {
    id: xtreamChannelId(id),
    name,
    url: '',
  };
  const group = groups.get(groupKey);
  if (group !== undefined) channel.group = group;
  if (typeof icon === 'string') {
    const logo = httpAssetUrl(icon);
    if (logo !== undefined) channel.logo = logo;
  }
  return channel;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export async function fetchXtreamAccount(
  account: XtreamAccount,
  fetchImpl: typeof fetch,
): Promise<{ ok: boolean; username: string | null; error: 'needs-auth' | 'unreachable' | null }> {
  try {
    const response = await fetchImpl(xtreamPlayerApiUrl(account), { redirect: 'follow' });
    if (!response.ok) return { ok: false, username: null, error: response.status === 401 ? 'needs-auth' : 'unreachable' };
    const body = asRecord(await readJson(response));
    const user = asRecord(body?.['user_info'] ?? null) as PlayerApiUser | null;
    if (!authOk(user)) return { ok: false, username: null, error: 'needs-auth' };
    const username = typeof user?.username === 'string' && user.username.trim() !== '' ? user.username.trim() : account.username;
    return { ok: true, username, error: null };
  } catch {
    return { ok: false, username: null, error: 'unreachable' };
  }
}

export async function fetchXtreamLive(account: XtreamAccount, fetchImpl: typeof fetch): Promise<XtreamLoad> {
  const auth = await fetchXtreamAccount(account, fetchImpl);
  if (!auth.ok) return { channels: [], error: auth.error, username: auth.username };

  const groups = new Map<string, string>();
  try {
    const categories = await fetchImpl(xtreamPlayerApiUrl(account, 'get_live_categories'), { redirect: 'follow' });
    if (categories.ok) {
      const body = await readJson(categories);
      if (Array.isArray(body)) {
        for (const entry of body) {
          const category = categoryName(entry);
          if (category !== null) groups.set(category.id, category.name);
        }
      }
    }
  } catch {
    // Groups are optional — streams still play without names.
  }

  try {
    const streams = await fetchImpl(xtreamPlayerApiUrl(account, 'get_live_streams'), { redirect: 'follow' });
    if (!streams.ok) return { channels: [], error: 'unreachable', username: auth.username };
    const body = await readJson(streams);
    if (!Array.isArray(body)) return { channels: [], error: 'unreachable', username: auth.username };
    const channels: LiveChannel[] = [];
    const used = new Set<string>();
    for (const entry of body) {
      const channel = streamRow(entry, groups);
      if (channel === null || used.has(channel.id)) continue;
      used.add(channel.id);
      channels.push(channel);
    }
    if (channels.length === 0) return { channels: [], error: 'unreachable', username: auth.username };
    return { channels, error: null, username: auth.username };
  } catch {
    return { channels: [], error: 'unreachable', username: auth.username };
  }
}
