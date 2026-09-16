/**
 * What TVM sends upstream, and what it refuses to pass on.
 *
 * IPTV providers reject requests for reasons that have nothing to do with the
 * subscription being valid: a missing Referer, an Origin they do not expect, a
 * User-Agent that is not the app they built the panel for, a session Cookie
 * from a portal login. Each provider wants something slightly different, so
 * the header set has to be per-stream rather than one global guess — the
 * single global User-Agent Core used before was exactly why some panels played
 * and others returned 403 with no explanation.
 *
 * Direction matters more than the list does. Headers flow *out* from a stored
 * profile; almost nothing flows *through* from the viewer. That is deliberate:
 * a LAN client sends `Authorization: Bearer <TVM_LAN_TOKEN>` on every proxy
 * request, and forwarding that to an IPTV provider would hand TVM's own LAN
 * credential to a third party. The forward list is therefore an allowlist of
 * two headers that affect nothing but byte selection.
 */

/** Headers a viewer's request may contribute. Everything else is dropped. */
const FORWARD_FROM_CLIENT = new Set(['range', 'accept']);

/**
 * Headers a profile may never set, because they describe this hop rather than
 * the request: letting a profile set Host or Content-Length produces a
 * malformed upstream request, and the connection headers are hop-by-hop by
 * definition.
 */
const NEVER_FROM_PROFILE = new Set([
  'host',
  'content-length',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
]);

/**
 * VLC, not a browser.
 *
 * Panels commonly allowlist player user agents and rate-limit or block ones
 * that look like a scraper. This is also why the viewer's own User-Agent is
 * never forwarded: a Roku identifying itself as a Roku to a panel expecting
 * VLC is a support ticket nobody can diagnose from the outside.
 */
export const DEFAULT_USER_AGENT = 'VLC/3.0.20 LibVLC/3.0.20';

export interface HeaderProfile {
  /** Stable id so a channel can point at a profile without copying it. */
  id: string;
  userAgent?: string;
  referer?: string;
  origin?: string;
  cookie?: string;
  /** Arbitrary extras, typically X-* headers a particular panel demands. */
  extra?: Record<string, string>;
}

export const GLOBAL_PROFILE_ID = 'global';

/**
 * The fallback profile, from the environment.
 *
 * Env rather than config.json because a Cookie or a signed Referer is a
 * credential, and the repo rule is that credentials never land in a file that
 * gets committed. TVM_LIVE_USER_AGENT is the name Core already used, kept so
 * existing installs do not change behaviour on upgrade.
 */
export function globalProfile(env: NodeJS.ProcessEnv = process.env): HeaderProfile {
  const pick = (name: string): string | undefined => {
    const raw = env[name];
    return raw !== undefined && raw.trim() !== '' ? raw.trim() : undefined;
  };
  const profile: HeaderProfile = {
    id: GLOBAL_PROFILE_ID,
    userAgent: pick('TVM_LIVE_USER_AGENT') ?? DEFAULT_USER_AGENT,
  };
  const referer = pick('TVM_LIVE_REFERER');
  if (referer !== undefined) profile.referer = referer;
  const origin = pick('TVM_LIVE_ORIGIN');
  if (origin !== undefined) profile.origin = origin;
  const cookie = pick('TVM_LIVE_COOKIE');
  if (cookie !== undefined) profile.cookie = cookie;
  return profile;
}

/** A channel's profile wins field by field; anything it omits falls back. */
export function mergeProfiles(base: HeaderProfile, over?: HeaderProfile | null): HeaderProfile {
  if (over === undefined || over === null) return base;
  return {
    id: over.id,
    userAgent: over.userAgent ?? base.userAgent,
    referer: over.referer ?? base.referer,
    origin: over.origin ?? base.origin,
    cookie: over.cookie ?? base.cookie,
    extra: { ...(base.extra ?? {}), ...(over.extra ?? {}) },
  };
}

export interface UpstreamHeaderInput {
  profile: HeaderProfile;
  /** The viewer's request headers. Only Range and Accept are read. */
  incoming?: Record<string, string> | undefined;
  /** Manifests are never ranged: a partial playlist is a broken playlist. */
  playlist?: boolean;
}

/**
 * Build the request TVM makes upstream.
 *
 * Range is forwarded for media because seeking and mpegts.js both depend on
 * it, and dropped for manifests because half a playlist is worse than none.
 */
export function buildUpstreamHeaders(input: UpstreamHeaderInput): Headers {
  const { profile, incoming, playlist = false } = input;
  const from = new Headers(incoming ?? {});
  const headers = new Headers();

  for (const name of FORWARD_FROM_CLIENT) {
    if (playlist && name === 'range') continue;
    const value = from.get(name);
    if (value !== null && value !== '') headers.set(name, value);
  }
  if (headers.get('accept') === null) headers.set('Accept', '*/*');

  if (profile.userAgent !== undefined && profile.userAgent !== '') {
    headers.set('User-Agent', profile.userAgent);
  }
  if (profile.referer !== undefined && profile.referer !== '') headers.set('Referer', profile.referer);
  if (profile.origin !== undefined && profile.origin !== '') headers.set('Origin', profile.origin);
  if (profile.cookie !== undefined && profile.cookie !== '') headers.set('Cookie', profile.cookie);

  for (const [name, value] of Object.entries(profile.extra ?? {})) {
    const key = name.trim().toLowerCase();
    if (key === '' || NEVER_FROM_PROFILE.has(key)) continue;
    if (value === '') continue;
    headers.set(name.trim(), value);
  }
  return headers;
}

/**
 * True when a header from the viewer would reach upstream. Exists so the test
 * that guards the LAN token can ask the question directly rather than
 * inferring it from a built Headers object.
 */
export function forwardsFromClient(name: string): boolean {
  return FORWARD_FROM_CLIENT.has(name.trim().toLowerCase());
}

/** Redacted view for logs and diagnostics: names only, never values. */
export function describeProfile(profile: HeaderProfile): string[] {
  const names: string[] = [];
  if (profile.userAgent !== undefined) names.push('User-Agent');
  if (profile.referer !== undefined) names.push('Referer');
  if (profile.origin !== undefined) names.push('Origin');
  if (profile.cookie !== undefined) names.push('Cookie');
  for (const name of Object.keys(profile.extra ?? {})) names.push(name);
  return names;
}
