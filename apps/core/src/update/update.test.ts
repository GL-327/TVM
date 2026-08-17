import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_HOST } from '../config.ts';
import { startCoreServer, type RunningCore } from '../server.ts';
import { applyPolicy } from './paths.ts';
import { isNewer, parseSemver } from './semver.ts';
import { createUpdateService } from './service.ts';
import { extractTarGz, isSafeTarName, packTarGz, parseSha256File } from './tar.ts';

describe('semver', () => {
  it('parses v-prefixed tags', () => {
    expect(parseSemver('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseSemver('1.2.3-beta')).toEqual([1, 2, 3]);
  });

  it('detects a newer build', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });
});

describe('tar safety', () => {
  it('allows only ui/ and core/ paths', () => {
    expect(isSafeTarName('ui/index.html')).toBe(true);
    expect(isSafeTarName('core/index.js')).toBe(true);
    expect(isSafeTarName('../etc/passwd')).toBe(false);
    expect(isSafeTarName('/etc/passwd')).toBe(false);
    expect(isSafeTarName('secrets/token')).toBe(false);
  });

  it('refuses traversal when extracting', () => {
    const archive = packTarGz([{ name: '../evil.js', data: Buffer.from('no') }]);
    expect(() => extractTarGz(archive, tmpdir())).toThrow(/refusing archive path/);
  });

  it('extracts a legal bundle', async () => {
    const dest = await mkdtemp(join(tmpdir(), 'tvm-tar-'));
    const archive = packTarGz([
      { name: 'ui/index.html', data: Buffer.from('<html>TVM</html>') },
      { name: 'core/index.js', data: Buffer.from('export {}') },
    ]);
    extractTarGz(archive, dest);
    expect(await readFile(join(dest, 'ui/index.html'), 'utf8')).toContain('TVM');
    await rm(dest, { recursive: true, force: true });
  });

  it('reads a sha256 file', () => {
    expect(parseSha256File('deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef  tvm-app-0.2.0.tar.gz')).toBe(
      'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    );
  });
});

describe('apply policy', () => {
  it('refuses a development checkout', () => {
    expect(applyPolicy({ TVM_ENV: 'development' }).allowed).toBe(false);
    expect(applyPolicy({}).allowed).toBe(false);
  });

  it('allows production', () => {
    expect(applyPolicy({ TVM_ENV: 'production' }).allowed).toBe(true);
  });
});

describe('update service', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-data-'));
    dirs.push(dir);
    return dir;
  }

  it('checks a public repo without a GitHub token', async () => {
    let authorized = false;
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'development' },
      currentVersion: '0.1.0',
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        authorized = headers.has('Authorization');
        expect(String(input)).toContain('/releases/latest');
        return new Response(JSON.stringify({ tag_name: 'v0.1.0', body: '', assets: [] }), { status: 200 });
      },
    });
    const status = await service.check();
    expect(authorized).toBe(false);
    expect(status.available).toBeNull();
    expect(status.lastCheck).not.toBeNull();
  });

  it('refuses apply in development before touching the network', async () => {
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'development', TVM_GITHUB_TOKEN: 'x' },
      currentVersion: '0.1.0',
    });
    await expect(service.apply()).rejects.toMatchObject({ name: 'ApplyRefused' });
  });

  it('refuses a checksum mismatch', async () => {
    const archive = packTarGz([{ name: 'core/index.js', data: Buffer.from('ok') }]);
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/releases/latest') && !url.includes('assets')) {
        return new Response(
          JSON.stringify({
            tag_name: 'v0.2.0',
            body: 'test',
            assets: [
              { name: 'tvm-app-0.2.0.tar.gz', url: 'https://api.github.com/assets/1' },
              { name: 'tvm-app-0.2.0.sha256', url: 'https://api.github.com/assets/2' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/assets/2')) {
        return new Response('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n', { status: 200 });
      }
      if (url.endsWith('/assets/1')) {
        return new Response(archive, { status: 200 });
      }
      return new Response('no', { status: 404 });
    };

    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'production', TVM_GITHUB_TOKEN: 'test-token' },
      currentVersion: '0.1.0',
      fetch: fetchMock,
    });

    await expect(service.apply()).rejects.toThrow(/SHA-256/);
  });

  it('applies a matching tarball and flips current', async () => {
    const archive = packTarGz([{ name: 'core/index.js', data: Buffer.from('ok') }]);
    const digest = createHash('sha256').update(archive).digest('hex');
    const fetchMock: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/releases/latest')) {
        return new Response(
          JSON.stringify({
            tag_name: 'v0.2.0',
            body: 'newer',
            assets: [
              { name: 'tvm-app-0.2.0.tar.gz', url: 'https://api.github.com/assets/1' },
              { name: 'tvm-app-0.2.0.sha256', url: 'https://api.github.com/assets/2' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/assets/2')) return new Response(`${digest}  tvm-app-0.2.0.tar.gz\n`, { status: 200 });
      if (url.endsWith('/assets/1')) return new Response(archive, { status: 200 });
      return new Response('no', { status: 404 });
    };

    const dir = await dataDir();
    const service = createUpdateService({
      dataDir: dir,
      env: { TVM_ENV: 'production', TVM_GITHUB_TOKEN: 'test-token' },
      currentVersion: '0.1.0',
      fetch: fetchMock,
    });

    await expect(service.apply()).resolves.toEqual({ version: '0.2.0' });
    expect(await readFile(join(dir, 'app', 'current'), 'utf8')).toContain('0.2.0');
    expect(await readFile(join(dir, 'app', '0.2.0', 'core', 'index.js'), 'utf8')).toBe('ok');
  });
});

describe('update HTTP', () => {
  let core: RunningCore;
  let baseUrl: string;
  let dir: string;

  afterEach(async () => {
    if (core !== undefined) await core.close();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  it('reports status and refuses apply in development', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tvm-http-'));
    const update = createUpdateService({
      dataDir: dir,
      env: { TVM_ENV: 'development' },
      currentVersion: '0.1.0',
    });
    core = await startCoreServer(0, { update, dataDir: dir, env: { TVM_ENV: 'development' } });
    baseUrl = `http://${CORE_HOST}:${core.port}`;

    const status = await fetch(`${baseUrl}/api/update/status`);
    expect(status.status).toBe(200);
    const body = (await status.json()) as { applyAllowed: boolean; current: string };
    expect(body.applyAllowed).toBe(false);
    expect(body.current).toBe('0.1.0');

    const apply = await fetch(`${baseUrl}/api/update/apply`, { method: 'POST' });
    expect(apply.status).toBe(403);
    const refused = (await apply.json()) as { reason: string };
    expect(refused.reason).toMatch(/disabled/);
  });
});
