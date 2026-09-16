/**
 * Which address the world sees when Core fetches a provider.
 *
 * The whole point of putting a VPN in front of this is that the friend's ISP
 * sees encrypted traffic to one endpoint instead of a list of IPTV hosts. That
 * is a claim about the network, and claims about the network are exactly the
 * kind that quietly stop being true — a tunnel drops, a rule is reordered, a
 * container restarts on the default bridge, and everything keeps working while
 * the privacy is gone. Nothing in the app would notice, because a leak looks
 * identical to success.
 *
 * So the check is a route rather than a runbook step. Ask Core where its own
 * egress comes out, and compare it with the address the box has without a
 * tunnel. It is deliberately loopback-only: it reveals an IP address, which is
 * a fact about the operator's network and not something a LAN client needs.
 *
 * It is also how the kill-switch test is written. With the tunnel up it
 * answers a VPN address; with the tunnel down it must fail rather than answer
 * the friend's real one. A configuration that returns an ISP address here is
 * broken no matter what the VPN client's own status page says.
 */

export interface EgressReport {
  ok: boolean;
  /** The address seen by the echo service, or null when the check failed. */
  ip: string | null;
  /** How long the check took, for spotting a tunnel that is up but crawling. */
  ms: number;
  /** Fixed reason codes; never a URL and never a header value. */
  reason?: string;
  /** True when Core was told an egress proxy should be in use. */
  expectsProxy: boolean;
}

/**
 * Echo services, tried in order.
 *
 * Plain-text bodies with no JSON to parse and no account to hold, so a failure
 * here means the network failed rather than a provider changed a schema. More
 * than one because a single hard-coded host is a single point of false alarm.
 */
const ECHOES = ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://icanhazip.com'];

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})$/;

/**
 * Whether the operator has declared that egress should be tunnelled.
 *
 * Declaring it does not make it so — that is what the check is for — but it
 * lets the report say "this was supposed to be proxied" rather than leaving
 * the reader to guess what the intended configuration was.
 */
export function expectsEgressProxy(env: NodeJS.ProcessEnv = process.env): boolean {
  for (const name of ['TVM_LIVE_EGRESS_PROXY', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    const value = env[name];
    if (value !== undefined && value.trim() !== '') return true;
  }
  return false;
}

export interface EgressOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  echoes?: readonly string[];
}

export async function checkEgress(options: EgressOptions = {}): Promise<EgressReport> {
  const env = options.env ?? process.env;
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const expectsProxy = expectsEgressProxy(env);
  const started = Date.now();

  for (const echo of options.echoes ?? ECHOES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(echo, { signal: controller.signal, redirect: 'follow' });
      clearTimeout(timer);
      if (!response.ok) continue;
      const text = (await response.text()).trim();
      if (!IPV4.test(text)) continue;
      return { ok: true, ip: text, ms: Date.now() - started, expectsProxy };
    } catch {
      clearTimeout(timer);
    }
  }

  /*
   * Failing is the correct answer when the tunnel is down.
   *
   * If this ever starts succeeding with the friend's own address while the
   * tunnel is down, the kill switch is not working and the setup is leaking.
   */
  return { ok: false, ip: null, ms: Date.now() - started, reason: 'egress_unreachable', expectsProxy };
}
