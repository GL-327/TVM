import { vi } from 'vitest';
import { TERMS_VERSION } from './terms.ts';

/** In-memory stand-in for the documented private API. Never contacts the live service. */
export function mockAccountsApi() {
  const base = { id: 'acc_member', email: 'ada@example.com', displayName: 'Ada', role: 'member',
    status: 'waiting', tier: 'stream', liveTv: false, emailVerified: false, termsVersion: null as string | null,
    hasRdToken: false, createdAt: '2026-11-01T00:00:00Z', note: null as string | null, sessionCount: 1 };
  const member = { ...base };
  const owner = { ...base, id: 'acc_owner', email: 'owner@example.com', role: 'admin', status: 'active',
    tier: 'stream-live', liveTv: true, emailVerified: true, termsVersion: TERMS_VERSION };
  const sessions = new Map([['member-session', member], ['admin-session', owner]]);
  const rd = new Map<string, string>();
  const api = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const credential = (headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (path === '/v1/register') {
      if (body.inviteCode === 'BAD-CODE') return json({ error: 'invalid_invite' }, 400);
      return json({ account: member }, 201);
    }
    if (path === '/v1/signin') {
      if (body.password === 'wrong') return json({ error: 'invalid' }, 401);
      const account = body.email === owner.email ? owner : member;
      const session = account === owner ? 'admin-session' : 'member-session';
      sessions.set(session, account);
      return json({ session, account });
    }
    if (path.startsWith('/v1/admin/')) {
      if (credential !== 'fixture-admin-key') return json({ error: 'forbidden' }, 403);
      if (path === '/v1/admin/summary') return json({ total: 2, waiting: member.status === 'waiting' ? 1 : 0,
        active: member.status === 'active' ? 2 : 1, suspended: member.status === 'suspended' ? 1 : 0 });
      if (path === '/v1/admin/accounts') return json({ accounts: [member, owner], nextOffset: null });
      if (method === 'DELETE') { sessions.delete('member-session'); return new Response(null, { status: 204 }); }
      const action = path.split('/').at(-1);
      if (action === 'activate') { member.status = 'active'; member.tier = body.tier; member.liveTv = body.tier === 'stream-live'; }
      if (action === 'suspend') { member.status = body.suspended ? 'suspended' : 'active'; if (body.suspended) sessions.delete('member-session'); }
      if (action === 'note') member.note = body.note;
      if (action === 'live-tv') { member.liveTv = body.enabled; member.tier = body.enabled ? 'stream-live' : 'stream'; }
      if (action === 'email-verified') member.emailVerified = body.verified;
      if (action === 'rd-token') { member.hasRdToken = !!body.token; if (body.token) rd.set(member.id, body.token); else rd.delete(member.id); }
      return json({ account: member });
    }
    const account = sessions.get(credential);
    if (!account) return json({ error: 'invalid' }, 401);
    if (path === '/v1/signout') { sessions.delete(credential); return new Response(null, { status: 204 }); }
    if (path === '/v1/me') return json({ account });
    if (path === '/v1/me/terms') { account.termsVersion = body.version; return json({ account }); }
    if (path === '/v1/me/rd-token') {
      if (method === 'PUT') {
        account.hasRdToken = !!body.token;
        if (body.token) rd.set(account.id, body.token); else rd.delete(account.id);
        return json({ account });
      }
      if (account.status !== 'active') return json({ error: 'forbidden' }, 403);
      return json({ token: rd.get(account.id) ?? null });
    }
    return json({ error: 'not_found' }, 404);
  });
  return { api, member, owner, sessions, rd };
}
