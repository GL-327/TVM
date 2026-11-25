import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { readSealed, writeSealed } from './vault.ts';

/*
 * Keeps a sideloaded Roku up to date from this computer.
 *
 * A developer-mode channel cannot update itself, but the Roku's developer
 * page (http://<roku>/plugin_install, user "rokudev", HTTP digest auth) takes
 * a new zip. With the Roku's address and developer password saved here, Core
 * checks TVM Downloads every six hours and, when roku.json names a newer
 * version than the one it last installed, uploads TVM-roku.zip to the Roku.
 * Only addresses on the local network are accepted.
 */

export const ROKU_MANIFEST_URL = 'https://github.com/GL-327/TVM/releases/download/devices/roku.json';
export const ROKU_CHECK_MS = 6 * 60 * 60 * 1000;
const FETCH_MS = 20_000;
const UPLOAD_MS = 120_000;
const MAX_ZIP_BYTES = 64 * 1024 * 1024;

export interface RokuPairing {
  host: string;
  password: string;
  autoUpdate: boolean;
  installedVersion: string | null;
  lastCheck: string | null;
  lastResult: string | null;
}

export interface RokuStatus {
  paired: boolean;
  host: string | null;
  autoUpdate: boolean;
  installedVersion: string | null;
  latestVersion: string | null;
  lastCheck: string | null;
  lastResult: string | null;
  busy: boolean;
}

/** A private IPv4 address, optionally with a port: the Roku must be on this network. */
export function validRokuHost(value: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{1,5}))?$/.exec(value.trim());
  if (match === null) return false;
  const [a, b, c, d] = match.slice(1, 5).map(Number) as [number, number, number, number];
  if ([a, b, c, d].some((part) => part > 255)) return false;
  if (match[5] !== undefined && (Number(match[5]) < 1 || Number(match[5]) > 65535)) return false;
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): number[] => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const md5 = (value: string): string => createHash('md5').update(value).digest('hex');

/** The Authorization header answering a Digest challenge (RFC 2617, qop=auth, MD5). */
export function digestAuthorization(
  challenge: string,
  method: string,
  uri: string,
  user: string,
  password: string,
  cnonce = randomBytes(8).toString('hex'),
  nc = '00000001',
): string | null {
  if (!/^\s*Digest\s/i.test(challenge)) return null;
  const field = (name: string): string | undefined =>
    new RegExp(`${name}="?([^",]+)"?`, 'i').exec(challenge)?.[1];
  const realm = field('realm');
  const nonce = field('nonce');
  if (realm === undefined || nonce === undefined) return null;
  const qop = field('qop')?.split(/\s*,\s*/).includes('auth') ? 'auth' : undefined;
  const opaque = field('opaque');
  const ha1 = md5(`${user}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop === undefined ? md5(`${ha1}:${nonce}:${ha2}`) : md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  const parts = [
    `username="${user}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    'algorithm=MD5',
    ...(qop === undefined ? [] : [`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`]),
    ...(opaque === undefined ? [] : [`opaque="${opaque}"`]),
  ];
  return `Digest ${parts.join(', ')}`;
}

/** What the Roku's installer page said, in a sentence. */
export function installOutcome(status: number, html: string): { ok: boolean; message: string } {
  if (status === 401) return { ok: false, message: 'The Roku turned down the developer password.' };
  if (/Identical to previous version/i.test(html)) return { ok: true, message: 'This version was already on the Roku.' };
  if (/Install Success|Application Received/i.test(html)) return { ok: true, message: 'Installed on the Roku.' };
  if (status >= 400) return { ok: false, message: `The Roku answered ${status}.` };
  const reason = /<font color="red">([^<]{1,160})</i.exec(html)?.[1]?.trim();
  return { ok: false, message: reason ?? 'The Roku did not confirm the install.' };
}

export function createRokuUpdater(options: { dataDir: string; fetch?: typeof fetch; now?: () => Date }) {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const path = join(options.dataDir, 'roku-pairing.json');
  let busy = false;
  let latest: string | null = null;
  let timer: NodeJS.Timeout | null = null;

  const read = (): RokuPairing | null => {
    const value = readSealed<RokuPairing>(options.dataDir, path);
    return value !== null && typeof value.host === 'string' && value.host !== '' && typeof value.password === 'string' ? value : null;
  };
  const write = (value: RokuPairing): void => writeSealed(options.dataDir, path, value);

  const status = (): RokuStatus => {
    const pairing = read();
    return {
      paired: pairing !== null,
      host: pairing?.host ?? null,
      autoUpdate: pairing?.autoUpdate ?? false,
      installedVersion: pairing?.installedVersion ?? null,
      latestVersion: latest,
      lastCheck: pairing?.lastCheck ?? null,
      lastResult: pairing?.lastResult ?? null,
      busy,
    };
  };

  const manifest = async (): Promise<{ version: string; url: string } | null> => {
    const response = await fetchImpl(ROKU_MANIFEST_URL, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_MS) });
    if (!response.ok) return null;
    const value = (await response.json()) as { version?: unknown; url?: unknown };
    if (typeof value.version !== 'string' || typeof value.url !== 'string' || !value.url.startsWith('https://github.com/')) return null;
    latest = value.version;
    return { version: value.version, url: value.url };
  };

  const upload = async (host: string, password: string, zip: Uint8Array<ArrayBuffer>): Promise<{ ok: boolean; message: string }> => {
    const url = `http://${host}/plugin_install`;
    const body = (): FormData => {
      const form = new FormData();
      form.set('mysubmit', 'Replace');
      form.set('archive', new Blob([zip], { type: 'application/zip' }), 'TVM-roku.zip');
      return form;
    };
    const first = await fetchImpl(url, { method: 'POST', body: body(), signal: AbortSignal.timeout(UPLOAD_MS) });
    if (first.status !== 401) return installOutcome(first.status, await first.text());
    const header = digestAuthorization(first.headers.get('www-authenticate') ?? '', 'POST', '/plugin_install', 'rokudev', password);
    if (header === null) return { ok: false, message: 'The Roku asked for a login TVM does not understand.' };
    const second = await fetchImpl(url, { method: 'POST', body: body(), headers: { authorization: header }, signal: AbortSignal.timeout(UPLOAD_MS) });
    return installOutcome(second.status, await second.text());
  };

  const install = async (force = false): Promise<RokuStatus & { message: string }> => {
    const pairing = read();
    if (pairing === null) return { ...status(), message: 'Pair a Roku first.' };
    if (busy) return { ...status(), message: 'Already installing.' };
    busy = true;
    let message = '';
    try {
      const feed = await manifest();
      if (feed === null) {
        message = 'Could not reach TVM Downloads.';
      } else if (!force && pairing.installedVersion !== null && compareVersions(feed.version, pairing.installedVersion) <= 0) {
        message = `The Roku already has ${pairing.installedVersion}.`;
      } else {
        const zip = await fetchImpl(feed.url, { redirect: 'follow', signal: AbortSignal.timeout(UPLOAD_MS) });
        const bytes = zip.ok ? new Uint8Array(await zip.arrayBuffer()) : null;
        if (bytes === null || bytes.byteLength < 1024 || bytes.byteLength > MAX_ZIP_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
          message = 'The Roku package did not download properly.';
        } else {
          const outcome = await upload(pairing.host, pairing.password, bytes);
          message = outcome.ok ? `${outcome.message} (${feed.version})` : outcome.message;
          if (outcome.ok) pairing.installedVersion = feed.version;
        }
      }
    } catch (error) {
      message = error instanceof Error && error.name === 'TimeoutError' ? 'The Roku did not answer in time.' : 'The Roku could not be reached.';
    } finally {
      busy = false;
    }
    write({ ...pairing, lastCheck: now().toISOString(), lastResult: message });
    return { ...status(), message };
  };

  return {
    status,
    pair(host: string, password: string, autoUpdate = true): RokuStatus {
      const trimmed = host.trim();
      if (!validRokuHost(trimmed)) throw new Error('Enter the Roku\'s address on your network, like 192.168.1.50.');
      if (password.trim() === '' || password.length > 64) throw new Error('Enter the developer password you set on the Roku.');
      const previous = read();
      write({
        host: trimmed,
        password,
        autoUpdate,
        installedVersion: previous?.host === trimmed ? previous.installedVersion : null,
        lastCheck: null,
        lastResult: null,
      });
      return status();
    },
    setAutoUpdate(enabled: boolean): RokuStatus {
      const pairing = read();
      if (pairing !== null) write({ ...pairing, autoUpdate: enabled });
      return status();
    },
    forget(): RokuStatus {
      write({ host: '', password: '', autoUpdate: false, installedVersion: null, lastCheck: null, lastResult: null });
      return { ...status(), paired: false, host: null };
    },
    install,
    /** Checks now and then every six hours while auto-update is on. */
    start(): void {
      if (timer !== null) return;
      const tick = (): void => {
        const pairing = read();
        if (pairing !== null && pairing.host !== '' && pairing.autoUpdate) void install(false);
      };
      timer = setInterval(tick, ROKU_CHECK_MS);
      timer.unref();
      setTimeout(tick, 90_000).unref();
    },
    stop(): void {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}

export type RokuUpdater = ReturnType<typeof createRokuUpdater>;
