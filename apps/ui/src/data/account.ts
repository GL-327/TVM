import { apiFetch, invalidateHome } from './media';
import { readToken, writeToken } from './sessionToken';

export { readToken, writeToken };

export type AccountTier = 'stream' | 'stream-live';

export interface AccountView {
  id: string;
  email: string;
  displayName: string;
  role: 'member' | 'dev';
  activated: boolean;
  tier: AccountTier | null;
  suspended: boolean;
  createdAt: string;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  emailVerified: boolean;
  emailCodeSent: boolean;
  /** The account has its own Real-Debrid key. */
  rdKey: boolean;
}

/** Why TVM is not usable, when it is not. */
export type AccountBlock = 'no_account' | 'suspended' | 'email_unverified' | 'awaiting_activation' | 'terms_required';

export interface AccountState {
  signedIn: boolean;
  account: AccountView | null;
  usable: { ok: boolean; reason: AccountBlock | null };
  termsVersion: string;
  /** This TVM can email sign-up codes. Missing on older cores. */
  canSendEmail?: boolean;
}

export const SIGNED_OUT: AccountState = {
  signedIn: false,
  account: null,
  usable: { ok: false, reason: 'no_account' },
  termsVersion: '',
};

/** Tells the app shell to ask who is signed in again, after a sign-out or an account switch. */
export const ACCOUNT_CHANGED = 'tvm:account-changed';

export function announceAccountChange(): void {
  window.dispatchEvent(new Event(ACCOUNT_CHANGED));
}

export function isDevAccount(state: AccountState | null | undefined): boolean {
  return state?.account?.role === 'dev';
}

/** A new session: the last account's home screen must not be shown to this one. */
function startSession(token: string | null): void {
  writeToken(token);
  invalidateHome();
}

/** apiFetch sends the session token, so every call here is made as the signed-in account. */
async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  const body = (await response.json()) as T & { error?: string };
  // The phone apps refresh this interface from GitHub on their own, so a new
  // screen can reach an older app that does not have the route behind it yet.
  if (response.status === 404 && body.error === 'not_found') {
    throw new Error('This copy of TVM is too old for that. Install the latest version from GitHub, then try again.');
  }
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
  startSession(result.token);
  // Re-read rather than trusting the sign-in response: the server applies the
  // account's tier to the plan engine on this call, and the answer it gives
  // back is the one the rest of the app should agree with.
  return fetchAccount();
}

/**
 * The dev account. The developer code is its password. Whoever was signed in
 * before is signed out, but only once the code has been accepted.
 */
export async function signInDev(code: string): Promise<AccountState> {
  const previous = readToken();
  const result = await json<{ token: string }>('/api/account/dev', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  startSession(result.token);
  if (previous !== null && previous !== result.token) {
    await apiFetch('/api/account/signout', { method: 'POST', headers: { Authorization: `Bearer ${previous}` } }).catch(() => undefined);
  }
  return fetchAccount();
}

export async function signOut(): Promise<void> {
  try {
    await json('/api/account/signout', { method: 'POST' });
  } finally {
    startSession(null);
  }
}

export async function acceptTerms(): Promise<AccountState> {
  await json('/api/account/terms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  return fetchAccount();
}

export async function sendEmailCode(): Promise<void> {
  await json('/api/account/email/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
}

export async function verifyEmailCode(code: string): Promise<AccountState> {
  await json('/api/account/email/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
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

// ---- Accounts screen (dev mode) -------------------------------------------

export interface AdminAccountView extends AccountView {
  activatedAt: string | null;
  lastSeenAt: string | null;
  signIns: number;
  lastClient: string | null;
  note: string | null;
  activeSessions: number;
  emailVerifiedAt: string | null;
  /** The last four characters of the account's Real-Debrid key, never the key. */
  rdKeyHint: string | null;
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

async function postAdmin(path: string, body: Record<string, unknown>): Promise<AdminAccountView> {
  return json<AdminAccountView>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function setAccountLiveTv(id: string, enabled: boolean): Promise<AdminAccountView> {
  return postAdmin('/api/admin/accounts/live-tv', { id, enabled });
}

/** An empty key removes it, and the account goes back to the machine's key. */
export function setAccountRdKey(id: string, token: string): Promise<AdminAccountView> {
  return postAdmin('/api/admin/accounts/rd', { id, token });
}

export function setAccountVerified(id: string, verified: boolean): Promise<AdminAccountView> {
  return postAdmin('/api/admin/accounts/verify', { id, verified });
}

// ---- Mail settings, for the sign-up codes --------------------------------

export type MailSecurity = 'tls' | 'starttls' | 'none';

export interface MailStatus {
  configured: boolean;
  host: string | null;
  port: number | null;
  security: MailSecurity | null;
  username: string | null;
  from: string | null;
  /** False on the phones, which do not send email. */
  supported: boolean;
}

export interface MailInput {
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  /** Empty keeps the saved password. */
  password: string;
  from: string;
}

export function fetchMail(): Promise<MailStatus> {
  return json<MailStatus>('/api/admin/mail');
}

export function saveMail(input: MailInput): Promise<MailStatus> {
  return json<MailStatus>('/api/admin/mail', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function clearMail(): Promise<MailStatus> {
  return json<MailStatus>('/api/admin/mail', { method: 'DELETE' });
}

export async function sendTestMail(to: string): Promise<void> {
  await json('/api/admin/mail/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ to }),
  });
}

/** "12 Aug 2026" on a dense admin list beats a raw timestamp. */
export function shortDate(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
