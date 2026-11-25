import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compareVersions, createRokuUpdater, digestAuthorization, installOutcome, validRokuHost } from './rokuUpdater.ts';
import { screenCapFor } from './media.ts';

const md5 = (value: string): string => createHash('md5').update(value).digest('hex');

describe('Roku updates from this computer', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('only pairs with addresses on the local network', () => {
    expect(validRokuHost('192.168.1.50')).toBe(true);
    expect(validRokuHost('10.0.0.7:80')).toBe(true);
    expect(validRokuHost('172.20.1.2')).toBe(true);
    expect(validRokuHost('8.8.8.8')).toBe(false);
    expect(validRokuHost('192.168.1.300')).toBe(false);
    expect(validRokuHost('roku.example.com')).toBe(false);
  });

  it('answers the Roku digest challenge', () => {
    const challenge = 'Digest qop="auth", realm="rokudev", nonce="1764000000"';
    const header = digestAuthorization(challenge, 'POST', '/plugin_install', 'rokudev', 'secret', 'abc', '00000001');
    const ha1 = md5('rokudev:rokudev:secret');
    const ha2 = md5('POST:/plugin_install');
    expect(header).toContain(`response="${md5(`${ha1}:1764000000:00000001:abc:auth:${ha2}`)}"`);
    expect(header).toContain('qop=auth');
    expect(digestAuthorization('Basic realm="x"', 'POST', '/', 'u', 'p')).toBeNull();
  });

  it('reads what the installer page said', () => {
    expect(installOutcome(200, '<font color="red">Install Success.</font>').ok).toBe(true);
    expect(installOutcome(200, 'Identical to previous version -- not replacing.').ok).toBe(true);
    expect(installOutcome(401, '')).toEqual({ ok: false, message: 'The Roku turned down the developer password.' });
    expect(installOutcome(200, '<font color="red">Install Failure: Compilation Failed.</font>')).toEqual({
      ok: false,
      message: 'Install Failure: Compilation Failed.',
    });
  });

  it('orders versions', () => {
    expect(compareVersions('1.1.0', '1.0.9')).toBeGreaterThan(0);
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0);
  });

  it('downloads the new zip and uploads it with the password, once', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-roku-'));
    dirs.push(dir);
    const zip = new Uint8Array(4096);
    zip[0] = 0x50;
    zip[1] = 0x4b;
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}${(init?.headers as Record<string, string> | undefined)?.authorization ? ' +auth' : ''}`);
      if (url.endsWith('roku.json')) return Response.json({ version: '1.1.0', url: 'https://github.com/GL-327/TVM/releases/download/devices/TVM-roku.zip' });
      if (url.endsWith('TVM-roku.zip')) return new Response(zip);
      const authorized = (init?.headers as Record<string, string> | undefined)?.authorization !== undefined;
      return authorized
        ? new Response('<font color="red">Install Success.</font>')
        : new Response('', { status: 401, headers: { 'www-authenticate': 'Digest qop="auth", realm="rokudev", nonce="n1"' } });
    }) as typeof fetch;
    const roku = createRokuUpdater({ dataDir: dir, fetch: fetchImpl });
    expect(() => roku.pair('8.8.8.8', 'pw')).toThrow();
    roku.pair('192.168.1.50', 'pw');
    const first = await roku.install();
    expect(first.message).toBe('Installed on the Roku. (1.1.0)');
    expect(first.installedVersion).toBe('1.1.0');
    expect(calls.filter((call) => call.startsWith('POST'))).toEqual([
      'POST http://192.168.1.50/plugin_install',
      'POST http://192.168.1.50/plugin_install +auth',
    ]);
    const again = await roku.install();
    expect(again.message).toBe('The Roku already has 1.1.0.');
    expect(roku.forget().paired).toBe(false);
  });
});

describe('best quality for the screen', () => {
  it('rounds the screen up to a quality step', () => {
    expect(screenCapFor(1080)).toBe(1080);
    expect(screenCapFor(1600)).toBe(2160);
    expect(screenCapFor(1440)).toBe(1440);
    expect(screenCapFor(2160)).toBe(2160);
    expect(screenCapFor(undefined)).toBe(2160);
  });

  it('lets a quality the viewer picked win', () => {
    expect(screenCapFor(2160, 720)).toBe(720);
  });
});
