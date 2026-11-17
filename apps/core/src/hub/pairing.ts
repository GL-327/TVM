import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { hashToken, type AccountsService } from '../providers/accounts.ts';
import { recordActivity } from './activity.ts';
import { actor, deviceParty, findDevice, install, publicDevice, rotateSecret, type Viewer } from './devices.ts';
import { bad, HubError, notFound } from './errors.ts';
import { bucket, opaqueId, transactHub, type HubDocument, type HubStore, type Pair } from './store.ts';
import { identifier, registration } from './validation.ts';
import { HEARTBEAT_SEC } from './vocab.ts';

export const USER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function normalizeUserCode(value: unknown): string {
  return typeof value === 'string' ? value.toUpperCase().replace(/^([A-Z2-9]{4})-([A-Z2-9]{4})$/, '$1$2') : '';
}
const userHash = (code: string, salt: string): string => hashToken(`${salt}:${code}`);
function allPairs(document: HubDocument): Array<{ pair: Pair; accountId: string | null }> {
  return [
    ...Object.values(document.unassignedPairs).map(pair => ({ pair, accountId: null })),
    ...Object.entries(document.accounts).flatMap(([accountId, b]) => Object.values(b.pairs).map(pair => ({ pair, accountId }))),
  ];
}
function codeMatches(pair: Pair, code: string): boolean {
  const expected = Buffer.from(pair.userHash, 'hex');
  const supplied = Buffer.from(userHash(code, pair.salt), 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
/** Sliding windows, keyed separately; never trust forwarding headers for IP identity. */
export function createPairLimiter(now: () => number = Date.now) {
  const sessions = new Map<string, number[]>();
  const ips = new Map<string, number[]>();
  const trim = (map: Map<string, number[]>, at: number): void => {
    for (const [key, entries] of map) {
      const live = entries.filter(t => at - t < 900_000);
      if (live.length === 0) map.delete(key); else map.set(key, live);
    }
  };
  return {
    check(session: string, ip: string): void {
      const at = now(); trim(sessions, at); trim(ips, at);
      if ((sessions.get(session)?.length ?? 0) >= 5 || (ips.get(ip)?.length ?? 0) >= 10) throw new HubError(429, 'rate_limited');
    },
    wrong(session: string, ip: string): void {
      const at = now();
      sessions.set(session, [...(sessions.get(session) ?? []), at]);
      ips.set(ip, [...(ips.get(ip) ?? []), at]);
    },
  };
}
export function createPairing(store: HubStore, accounts: AccountsService, now: () => number = Date.now) {
  const limiter = createPairLimiter(now);
  function byUserCode(document: HubDocument, value: unknown, viewer: Viewer, session: string, ip: string): Pair {
    const key = hashToken(session);
    limiter.check(key, ip);
    const code = normalizeUserCode(value);
    const found = allPairs(document).find(({ pair, accountId }) =>
      (accountId === null || accountId === viewer.accountId) && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code)
      && codeMatches(pair, code) && Date.parse(pair.expiresAt) > now() && (pair.status === 'pending' || pair.status === 'approved'));
    if (found === undefined) { limiter.wrong(key, ip); notFound(); }
    return found.pair;
  }
  return {
    start(value: unknown, origin: string) {
      const { clientId, ...input } = registration(value, true);
      return transactHub(store, document => {
        let code: string;
        do {
          code = Array.from({ length: 8 }, () => USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]!).join('');
        } while (allPairs(document).some(({ pair }) => codeMatches(pair, code)));
        const deviceCode = randomBytes(32).toString('base64url');
        const salt = randomBytes(16).toString('base64url');
        const at = now();
        const pair: Pair = {
          id: opaqueId('pair'), deviceHash: hashToken(deviceCode), userHash: userHash(code, salt), salt,
          input: { ...input, clientHash: hashToken(clientId) }, requestedAt: new Date(at).toISOString(),
          expiresAt: new Date(at + 600_000).toISOString(), interval: 5, lastPollAt: null, status: 'pending',
          finishedAt: null, installationId: null, accountToken: null,
        };
        document.unassignedPairs[pair.id] = pair;
        const userCode = `${code.slice(0, 4)}-${code.slice(4)}`;
        const verificationUri = `${origin}/hub/pair`;
        return { deviceCode, userCode, verificationUri, verificationUriComplete: `${verificationUri}?userCode=${userCode}`, expiresIn: 600, interval: 5 };
      });
    },
    lookup(code: unknown, viewer: Viewer, session: string, ip: string) {
      return transactHub(store, document => {
        const pair = byUserCode(document, code, viewer, session, ip);
        return { request: { platform: pair.input.platform, name: pair.input.name, model: pair.input.model,
          requestedAt: pair.requestedAt, expiresAt: pair.expiresAt } };
      });
    },
    decide(code: unknown, approve: boolean, viewer: Viewer, session: string, ip: string) {
      let minted: string | undefined;
      try {
        return transactHub(store, document => {
          const pair = byUserCode(document, code, viewer, session, ip);
          if (pair.status !== 'pending') notFound();
          const b = bucket(document, viewer.accountId);
          const at = now();
          if (approve) {
            minted = accounts.openPairedSession(session, pair.input.name);
            const device = install(b, pair.input, viewer, at);
            pair.installationId = device.id; pair.accountToken = minted; pair.status = 'approved';
            recordActivity(b, at, 'pair.approved', actor(viewer), deviceParty(device));
          } else {
            pair.status = 'denied'; pair.finishedAt = new Date(at).toISOString();
            recordActivity(b, at, 'pair.denied', actor(viewer), { installationId: null, name: pair.input.name });
          }
          delete document.unassignedPairs[pair.id]; b.pairs[pair.id] = pair;
          return { ok: true as const };
        });
      } catch (error) {
        // Compensate if the Hub write failed after the ordinary session was minted.
        if (minted !== undefined) accounts.signOut(minted);
        throw error;
      }
    },
    token(value: unknown) {
      const code = identifier(value, 100);
      return transactHub(store, document => {
        const found = allPairs(document).find(({ pair }) => pair.deviceHash === hashToken(code));
        if (found === undefined || found.pair.status === 'consumed' || found.pair.status === 'expired') bad('expired_token');
        const { pair, accountId } = found;
        if (pair.status === 'denied') bad('access_denied');
        const at = now();
        if (pair.lastPollAt !== null && at - Date.parse(pair.lastPollAt) < pair.interval * 1000) {
          pair.interval += 5; pair.lastPollAt = new Date(at).toISOString(); bad('slow_down');
        }
        pair.lastPollAt = new Date(at).toISOString();
        if (pair.status === 'pending') bad('authorization_pending');
        if (accountId === null || pair.installationId === null || pair.accountToken === null) bad('expired_token');
        const accountToken = pair.accountToken;
        const account = accounts.resolve(accountToken);
        const b = bucket(document, accountId);
        const device = b.installations[pair.installationId];
        if (account === null || account.suspended || device === undefined || device.revokedAt !== null) {
          accounts.signOut(accountToken); pair.accountToken = null; pair.status = 'denied';
          pair.finishedAt = new Date(at).toISOString(); bad('access_denied');
        }
        // Approval creates the installation and account session. Generate its delivery
        // secret only here, so even an approved, unredeemed pair stores no raw secret.
        const deviceSecret = rotateSecret(b, device.id, at);
        pair.accountToken = null; pair.status = 'consumed'; pair.finishedAt = new Date(at).toISOString();
        return { installation: publicDevice(findDevice(b, device.id), { accountId, role: account.role, name: account.displayName }, at),
          deviceSecret, accountToken, heartbeatSec: HEARTBEAT_SEC };
      });
    },
  };
}
