import { apiFetch } from './media';

/**
 * The account the app is signed in as, if any.
 *
 * The token lives in localStorage rather than a cookie because the interface
 * is served from a local core and also loaded inside two native shells, where
 * cookie handling differs in ways that are not worth fighting. It is sent as a
 * bearer header, so nothing depends on the request's origin.
 */

const TOKEN_KEY = 'tvm.account.token';

export type AccountTier = 'stream' | 'stream-live';

export interface AccountView {
  id: string;
  email: string;
  displayName: string;
  activated: boolean;
  tier: AccountTier | null;
  suspended: boolean;
  createdAt: string;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
}

/** Why TVM is not usable, when it is not. */
export type AccountBlock = 'no_account' | 'suspended' | 'awaiting_activation' | 'terms_required';

export interface AccountState {
  signedIn: boolean;
  account: AccountView | null;
  usable: { ok: boolean; reason: AccountBlock | null };
  termsVersion: string;
}

export const SIGNED_OUT: AccountState = {
  signedIn: false,
  account: null,
  usable: { ok: false, reason: 'no_account' },
  termsVersion: '',
};

export function readToken(): string | null {
  try {
    const value = window.localStorage.getItem(TOKEN_KEY);
    return value !== null && value !== '' ? value : null;
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token === null) window.localStorage.removeItem(TOKEN_KEY);
    else window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode: the session still works for this run.
  }
}

function authed(init: RequestInit = {}): RequestInit {
  const token = readToken();
  const headers = new Headers(init.headers);
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  return { ...init, headers };
}

async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, authed(init));
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Something went wrong.');
  return body;
}

export async function fetchAccount(): Promise<AccountState> {
  try {
    return await json<AccountState>('/api/account');
  } catch {
    return SIGNED_OUT;
  }
}

export async function registerAccount(input: { email: string; password: string; displayName?: string }): Promise<AccountView> {
  return json<AccountView>('/api/account/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function signIn(input: { email: string; password: string }): Promise<AccountState> {
  const result = await json<{ token: string; account: AccountView; usable: AccountState['usable'] }>('/api/account/signin', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  writeToken(result.token);
  // Re-read rather than trusting the sign-in response: the server applies the
  // account's tier to the plan engine on this call, and the answer it gives
  // back is the one the rest of the app should agree with.
  return fetchAccount();
}

export async function signOut(): Promise<void> {
  try {
    await json('/api/account/signout', { method: 'POST' });
  } finally {
    writeToken(null);
  }
}

export async function acceptTerms(): Promise<AccountState> {
  await json('/api/account/terms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return fetchAccount();
}

// ---- Terms ---------------------------------------------------------------

export interface TermsSection { heading: string; body: string[] }
export interface TermsDocument {
  version: string;
  updated: string;
  summary: string;
  intro: string[];
  sections: TermsSection[];
}

export async function fetchTerms(): Promise<TermsDocument | null> {
  try {
    return await json<TermsDocument>('/api/terms');
  } catch {
    return null;
  }
}

// ---- What access costs ---------------------------------------------------

export interface LiveTvTermView {
  id: string;
  name: string;
  usdCents: number;
  amountPence: number;
  blurb: string;
}

export interface AccessTierView {
  id: AccountTier;
  name: string;
  summary: string;
  liveTv: boolean;
  monthlyPence: number | null;
  liveTvTerms: LiveTvTermView[];
  includes: string[];
}

export interface TiersResponse {
  tiers: AccessTierView[];
  route: { headline: string; detail: string; action: string };
  streamMonthlyPence: number;
}

export async function fetchTiers(): Promise<TiersResponse | null> {
  try {
    return await json<TiersResponse>('/api/tiers');
  } catch {
    return null;
  }
}

// ---- Owner's admin -------------------------------------------------------

export interface AdminAccountView extends AccountView {
  activatedAt: string | null;
  lastSeenAt: string | null;
  signIns: number;
  lastClient: string | null;
  note: string | null;
  activeSessions: number;
}

export interface AdminAccountsResponse {
  accounts: AdminAccountView[];
  summary: { total: number; waiting: number; active: number; suspended: number };
  tiers: Array<{ id: AccountTier; name: string }>;
}

export async function fetchAdminAccounts(query: { search?: string; state?: string } = {}): Promise<AdminAccountsResponse> {
  const params = new URLSearchParams();
  if (query.search !== undefined && query.search !== '') params.set('search', query.search);
  if (query.state !== undefined && query.state !== 'all') params.set('state', query.state);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return json<AdminAccountsResponse>(`/api/admin/accounts${suffix}`);
}

export async function activateAccount(input: { id: string; tier: AccountTier; note?: string }): Promise<AdminAccountView> {
  return json<AdminAccountView>('/api/admin/accounts/activate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function suspendAccount(id: string, suspended: boolean): Promise<AdminAccountView> {
  return json<AdminAccountView>('/api/admin/accounts/suspend', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, suspended }),
  });
}

export async function setAccountNote(id: string, note: string | null): Promise<AdminAccountView> {
  return json<AdminAccountView>('/api/admin/accounts/note', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, note }),
  });
}

export async function eraseAccount(id: string): Promise<void> {
  await json('/api/admin/accounts/erase', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  });
}

/** "12 Aug 2026" on a dense admin list beats a raw timestamp. */
export function shortDate(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
