import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CORE_HOST } from '../config.ts';
import { startCoreServer, type RunningCore } from '../server.ts';
import { applyPolicy, resolveAppliedApp, resolveDataDir, resolveUpdateRepo } from './paths.ts';
import { appliedLaunch } from './launch.ts';
import { isNewer, parseSemver } from './semver.ts';
import { changesSince, entriesSince, parseFeedManifest } from './feed.ts';
import { detectInstall, runningUnderWatch } from './install.ts';
import { createUpdateService, parseGitLog } from './service.ts';
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
    expect(applyPolicy({ TVM_ALLOW_APPLY: '1' }).allowed).toBe(true);
  });
});

describe('update channel', () => {
  it('defaults to GL-327/TVM and accepts a legal override', () => {
    expect(resolveUpdateRepo({})).toBe('GL-327/TVM');
    expect(resolveUpdateRepo({ TVM_UPDATE_REPO: 'acme/tv-box' })).toBe('acme/tv-box');
    expect(resolveUpdateRepo({ TVM_UPDATE_REPO: '../evil' })).toBe('GL-327/TVM');
  });
});

describe('data directory', () => {
  it('uses a user-writable folder on every desktop OS', () => {
    expect(resolveDataDir({ TVM_DATA_DIR: '/var/lib/tvm' }, 'linux')).toBe('/var/lib/tvm');
    expect(resolveDataDir({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'win32')).toMatch(/TVM$/);
    expect(resolveDataDir({ HOME: '/Users/me' }, 'darwin')).toBe('/Users/me/Library/Application Support/TVM');
    expect(resolveDataDir({ HOME: '/home/me' }, 'linux')).toBe('/home/me/.local/share/tvm');
    expect(resolveDataDir({ XDG_DATA_HOME: '/tmp/xdg', HOME: '/home/me' }, 'linux')).toBe('/tmp/xdg/tvm');
  });
});

describe('update feed manifest', () => {
  const sha = 'a'.repeat(64);

  it('accepts a complete manifest and rejects an incomplete one', () => {
    const manifest = parseFeedManifest({
      schema: 1, channel: 'desktop', commit: 'ABCDEF1234567', version: '1.0.0', builtAt: '2026-09-17T00:00:00Z',
      asset: 'tvm-app.tar.gz', sha256: sha, size: 10, nativeApi: 0,
      entries: [{ sha: 'abcdef1', title: 'Newest', body: '', date: null }, { sha: '', title: '' }],
    });
    expect(manifest?.commit).toBe('abcdef1234567');
    expect(manifest?.entries.map((entry) => entry.title)).toEqual(['Newest']);
    expect(parseFeedManifest({ commit: 'nothex', asset: 'a.tar.gz', sha256: sha })).toBeNull();
    expect(parseFeedManifest({ commit: 'abcdef1', asset: '../evil', sha256: sha })).toBeNull();
    expect(parseFeedManifest({ commit: 'abcdef1', asset: 'a.tar.gz', sha256: 'short' })).toBeNull();
    expect(parseFeedManifest([])).toBeNull();
  });

  it('lists only what is newer than the running build', () => {
    const entries = [
      { sha: 'ccc3333', title: 'Third', body: '', date: null },
      { sha: 'bbb2222', title: 'Second', body: '', date: null },
      { sha: 'aaa1111', title: 'First', body: '', date: null },
    ];
    expect(entriesSince(entries, 'bbb2222ffffffffffffffffffffffffffffffff').map((entry) => entry.title)).toEqual(['Third']);
    expect(entriesSince(entries, 'ccc3333').map((entry) => entry.title)).toEqual([]);
    // Unknown to the feed: show everything rather than claim nothing changed.
    expect(entriesSince(entries, 'fff9999').map((entry) => entry.title)).toEqual(['Third', 'Second', 'First']);
    expect(entriesSince(entries, null)).toHaveLength(3);
  });

  it('uses the full history to find a build that changed nothing on this channel', () => {
    const manifest = parseFeedManifest({
      commit: 'e'.repeat(40), asset: 'tvm-ios-ui.tar.gz', sha256: 'a'.repeat(64),
      entries: [
        { sha: 'eee5555', title: 'Newest interface change' },
        { sha: 'ccc3333', title: 'Older interface change' },
      ],
      // ddd4444 touched only docs, so it is in the history but not the entries.
      history: ['eee5555', 'ddd4444', 'ccc3333', 'bbb2222'],
    });
    expect(manifest).not.toBeNull();
    expect(changesSince(manifest!, 'ddd4444' + '0'.repeat(33)).map((entry) => entry.title)).toEqual(['Newest interface change']);
    expect(changesSince(manifest!, 'bbb2222').map((entry) => entry.title)).toEqual(['Newest interface change', 'Older interface change']);
    expect(changesSince(manifest!, 'eee5555')).toEqual([]);
    expect(changesSince(manifest!, null)).toHaveLength(2);
    // Garbage in the history is dropped rather than trusted.
    expect(parseFeedManifest({ commit: 'abcdef1', asset: 'a.tar.gz', sha256: 'a'.repeat(64), history: ['zzz', 7, 'abc1234'] })?.history).toEqual(['abc1234']);
  });

  it('reads git log output whatever the commit messages contain', () => {
    const output = [
      `${'1'.repeat(40)}\u001f2026-09-17T01:00:00+01:00\u001fFix the gate\n\nBody with\ttabs and "quotes"\n\u001e`,
      `\n${'2'.repeat(40)}\u001f2026-09-16T01:00:00+01:00\u001fMerge branch 'x'\n\u001e`,
      `\n${'3'.repeat(40)}\u001f2026-09-15T01:00:00+01:00\u001fAdd the tester\n\u001e`,
    ].join('');
    expect(parseGitLog(output)).toEqual([
      { sha: '1111111', title: 'Fix the gate', body: 'Body with\ttabs and "quotes"', date: '2026-09-17T01:00:00+01:00' },
      { sha: '3333333', title: 'Add the tester', body: '', date: '2026-09-15T01:00:00+01:00' },
    ]);
  });
});

describe('update service: packaged install', () => {
  const dirs: string[] = [];
  const PACKAGE = { kind: 'package', root: null, build: null } as const;
  const OLD = '1111111aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const NEW = '3333333ccccccccccccccccccccccccccccccccc';

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-data-'));
    dirs.push(dir);
    return dir;
  }

  function manifestFor(archive: Buffer, commit = NEW, digest?: string): Record<string, unknown> {
    return {
      schema: 1,
      channel: 'desktop',
      commit,
      version: '1.0.0',
      builtAt: '2026-09-17T00:00:00Z',
      asset: 'tvm-app.tar.gz',
      sha256: digest ?? createHash('sha256').update(archive).digest('hex'),
      size: archive.length,
      nativeApi: 0,
      entries: [
        { sha: '3333333', title: 'Third change', body: '', date: null },
        { sha: '2222222', title: 'Second change', body: '', date: null },
        { sha: '1111111', title: 'First change', body: '', date: null },
      ],
    };
  }

  function feed(files: Record<string, Response | (() => Response)>, seen: string[] = []): typeof fetch {
    return async (input, init) => {
      const url = String(input);
      seen.push(`${new Headers(init?.headers).has('Authorization') ? 'auth ' : ''}${url}`);
      for (const [suffix, answer] of Object.entries(files)) {
        if (url.endsWith(suffix)) return typeof answer === 'function' ? answer() : answer.clone();
      }
      return new Response('{"message":"Not Found"}', { status: 404 });
    };
  }

  it('reads the desktop manifest from the download host, without a token', async () => {
    const archive = packTarGz([{ name: 'core/index.js', data: Buffer.from('ok') }]);
    const seen: string[] = [];
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'production', TVM_GITHUB_TOKEN: 'leftover-expired' },
      install: PACKAGE,
      currentCommit: OLD,
      fetch: feed({ '/releases/download/desktop/desktop.json': Response.json(manifestFor(archive)) }, seen),
    });
    const status = await service.check();
    expect(seen).toEqual(['https://github.com/GL-327/TVM/releases/download/desktop/desktop.json']);
    expect(status.kind).toBe('available');
    expect(status.available?.version).toBe('3333333');
    expect(status.available?.changelog?.map((entry) => entry.title)).toEqual(['Third change', 'Second change']);
    expect(status.currentCommit).toBe(OLD);
    expect(status.install).toBe('package');
  });

  it('is up to date when the published commit is the running one', async () => {
    const archive = packTarGz([{ name: 'core/index.js', data: Buffer.from('ok') }]);
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'production' },
      install: PACKAGE,
      currentCommit: NEW.slice(0, 7),
      fetch: feed({ 'desktop.json': Response.json(manifestFor(archive)) }),
    });
    const status = await service.check();
    expect(status.kind).toBe('up_to_date');
    expect(status.available).toBeNull();
  });

  /*
   * The bug this replaced: GitHub resolves releases/latest to whichever
   * platform release was created last, which is the iOS one, so the desktop
   * compared itself with "ios" and was always "up to date".
   */
  it('never asks for releases/latest', async () => {
    const seen: string[] = [];
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'production' },
      install: PACKAGE,
      currentCommit: OLD,
      fetch: feed({}, seen),
    });
    await service.check();
    expect(seen.some((url) => url.includes('/releases/latest'))).toBe(false);
  });

  it('asks GitHub for raw bytes so a tar.gz checksum still matches', async () => {
    const encodings: string[] = [];
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'production' },
      install: PACKAGE,
      currentCommit: OLD,
      fetch: async (_input, init) => {
        encodings.push(new Headers(init?.headers).get('Accept-Encoding') ?? '');
        return new Response('no', { status: 404 });
      },
    });
    await service.check();
    expect(encodings[0]).toBe('identity');
  });

  it('reports a missing feed, a rate limit and a refusal without throwing', async () => {
    const missing = createUpdateService({ dataDir: await dataDir(), env: {}, install: PACKAGE, fetch: feed({}) });
    await expect(missing.check()).resolves.toMatchObject({ kind: 'no_release', available: null });
    expect(missing.status().notice).toMatch(/No desktop build/);

    const limited = createUpdateService({
      dataDir: await dataDir(), env: {}, install: PACKAGE,
      fetch: async () => new Response('slow down', { status: 429 }),
    });
    await expect(limited.check()).resolves.toMatchObject({ kind: 'rate_limited', available: null });

    const refused = createUpdateService({
      dataDir: await dataDir(), env: {}, install: PACKAGE,
      fetch: async () => new Response('no', { status: 403 }),
    });
    await expect(refused.check()).resolves.toMatchObject({ kind: 'auth_required', available: null });

    const offline = createUpdateService({
      dataDir: await dataDir(), env: {}, install: PACKAGE,
      fetch: async () => { throw new TypeError('fetch failed'); },
    });
    await expect(offline.check()).resolves.toMatchObject({ kind: 'failed', available: null });
  });

  it('refuses apply outside production before touching the network', async () => {
    let touched = false;
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'development' },
      install: PACKAGE,
      fetch: async () => { touched = true; return new Response('no', { status: 500 }); },
    });
    await expect(service.apply()).rejects.toMatchObject({ name: 'ApplyRefused' });
    expect(touched).toBe(false);
  });

  it('refuses a bundle whose checksum does not match', async () => {
    const archive = packTarGz([{ name: 'core/index.js', data: Buffer.from('ok') }]);
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'production' },
      install: PACKAGE,
      currentCommit: OLD,
      fetch: feed({
        'desktop.json': Response.json(manifestFor(archive, NEW, 'b'.repeat(64))),
        'tvm-app.tar.gz': () => new Response(archive),
      }),
    });
    await expect(service.apply()).rejects.toThrow(/SHA-256/);
  });

  it('applies a verified bundle, points at it, and queues the changelog', async () => {
    const archive = packTarGz([
      { name: 'core/index.js', data: Buffer.from('ok') },
      { name: 'ui/index.html', data: Buffer.from('<html></html>') },
    ]);
    const dir = await dataDir();
    const service = createUpdateService({
      dataDir: dir,
      env: { TVM_ENV: 'production' },
      install: PACKAGE,
      currentCommit: OLD,
      fetch: feed({
        'desktop.json': Response.json(manifestFor(archive)),
        'tvm-app.tar.gz': () => new Response(archive),
      }),
    });
    await expect(service.apply()).resolves.toEqual({ version: '3333333', commit: NEW, changed: true, restart: 'self' });
    expect(await readFile(join(dir, 'app', 'current'), 'utf8')).toBe('3333333\n');
    expect(await readFile(join(dir, 'app', '3333333', 'core', 'index.js'), 'utf8')).toBe('ok');
    expect(resolveAppliedApp(dir)?.version).toBe('3333333');
    const changelog = service.changelog();
    expect(changelog?.pending).toBe(true);
    expect(changelog?.entries.map((entry) => entry.title)).toEqual(['Third change', 'Second change']);
    expect(service.markChangelogSeen()?.pending).toBe(false);
    expect(service.status().kind).toBe('up_to_date');
  });

  it('does nothing when the published bundle is already running', async () => {
    const archive = packTarGz([{ name: 'core/index.js', data: Buffer.from('ok') }]);
    const seen: string[] = [];
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'production' },
      install: PACKAGE,
      currentCommit: NEW,
      fetch: feed({ 'desktop.json': Response.json(manifestFor(archive)) }, seen),
    });
    await expect(service.apply()).resolves.toMatchObject({ changed: false });
    expect(seen.some((url) => url.endsWith('tvm-app.tar.gz'))).toBe(false);
  });

  it('uses a private-fork token through the API and drops it at the storage redirect', async () => {
    const archive = packTarGz([{ name: 'core/index.js', data: Buffer.from('ok') }]);
    const seen: string[] = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      const authorized = new Headers(init?.headers).has('Authorization');
      seen.push(`${authorized ? 'auth ' : ''}${url}`);
      if (url.startsWith('https://github.com/')) return new Response('Not Found', { status: 404 });
      if (url.endsWith('/releases/tags/desktop') && authorized) {
        return Response.json({ assets: [
          { name: 'desktop.json', url: 'https://api.github.com/assets/1' },
          { name: 'tvm-app.tar.gz', url: 'https://api.github.com/assets/2' },
        ] });
      }
      if (url.startsWith('https://api.github.com/assets/') && authorized) {
        return new Response(null, { status: 302, headers: { location: `https://objects.example/${url.slice(-1)}` } });
      }
      if (url === 'https://objects.example/1' && !authorized) return Response.json(manifestFor(archive));
      if (url === 'https://objects.example/2' && !authorized) return new Response(archive);
      return new Response('no', { status: 404 });
    };
    const service = createUpdateService({
      dataDir: await dataDir(),
      env: { TVM_ENV: 'production', TVM_GITHUB_TOKEN: 'private-token', TVM_UPDATE_REPO: 'acme/private-tv' },
      install: PACKAGE,
      currentCommit: OLD,
      fetch: fetchMock,
    });
    await expect(service.apply()).resolves.toMatchObject({ changed: true });
    expect(seen.some((line) => line.startsWith('auth https://objects.example/'))).toBe(false);
    expect(seen).toContain('auth https://api.github.com/repos/acme/private-tv/releases/tags/desktop');
  });

  it('clears a stored token so TVM_GITHUB_TOKEN can be used', async () => {
    const env: NodeJS.ProcessEnv = { TVM_ENV: 'development', TVM_GITHUB_TOKEN: 'from-env' };
    const service = createUpdateService({ dataDir: await dataDir(), env, install: PACKAGE });
    expect(service.setToken('stored').configured).toBe(true);
    expect(service.setToken('').configured).toBe(true);
    expect(service.status().configured).toBe(true);
  });
});

describe('update service: git checkout', () => {
  const dirs: string[] = [];
  const HEAD = '1'.repeat(40);
  const REMOTE = '2'.repeat(40);
  const CHECKOUT = { kind: 'checkout', root: '/repo', build: null } as const;

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-data-'));
    dirs.push(dir);
    return dir;
  }

  function fakeGit(state: { behind: number; ahead?: number; dirty?: string; deps?: string; branch?: string }, calls: string[][] = []) {
    return async (args: readonly string[]): Promise<string> => {
      calls.push([...args]);
      const [command] = args;
      if (command === 'fetch') return '';
      if (command === 'rev-parse' && args[1] === 'HEAD') return HEAD;
      if (command === 'rev-parse' && args[1] === 'FETCH_HEAD') return REMOTE;
      if (command === 'rev-parse' && args[1] === '--abbrev-ref') return state.branch ?? 'main';
      if (command === 'rev-list') return `${state.ahead ?? 0}\t${state.behind}`;
      if (command === 'log') return `${REMOTE}\u001f2026-09-17T00:00:00Z\u001fNewer on GitHub\n\u001e`;
      if (command === 'status') return state.dirty ?? '';
      if (command === 'diff') return state.deps ?? '';
      if (command === 'merge') return '';
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
  }

  it('is up to date when GitHub main has nothing new', async () => {
    const service = createUpdateService({ dataDir: await dataDir(), env: { TVM_ENV: 'development' }, install: CHECKOUT, git: fakeGit({ behind: 0 }) });
    const status = await service.check();
    expect(status.kind).toBe('up_to_date');
    expect(status.install).toBe('checkout');
    expect(status.currentCommit).toBe(HEAD);
    expect(status.applyAllowed).toBe(false);
  });

  it('offers a fast-forward when the checkout is clean and behind', async () => {
    const service = createUpdateService({ dataDir: await dataDir(), env: { TVM_ENV: 'development' }, install: CHECKOUT, git: fakeGit({ behind: 3 }) });
    const status = await service.check();
    expect(status.kind).toBe('available');
    expect(status.available?.version).toBe('2222222');
    expect(status.available?.changelog?.map((entry) => entry.title)).toEqual(['Newer on GitHub']);
    expect(status.applyAllowed).toBe(true);
    expect(status.applyReason).toBeNull();
    // The cached answer survives a status read, which is what the Updates screen shows.
    expect(service.status().applyAllowed).toBe(true);
  });

  it('never updates over uncommitted work, local commits, another branch or new dependencies', async () => {
    const cases = [
      [{ behind: 1, dirty: ' M apps/ui/src/App.tsx' }, /uncommitted/],
      [{ behind: 1, ahead: 2 }, /not on GitHub/],
      [{ behind: 1, branch: 'feature' }, /not main/],
      [{ behind: 1, deps: 'pnpm-lock.yaml' }, /dependencies/],
    ] as const;
    for (const [state, reason] of cases) {
      const calls: string[][] = [];
      const service = createUpdateService({ dataDir: await dataDir(), env: {}, install: CHECKOUT, git: fakeGit(state, calls) });
      const status = await service.check();
      expect(status.kind).toBe('available');
      expect(status.applyAllowed).toBe(false);
      expect(status.applyReason).toMatch(reason);
      await expect(service.apply()).rejects.toMatchObject({ name: 'ApplyRefused' });
      expect(calls.some((args) => args[0] === 'merge')).toBe(false);
    }
  });

  it('fast-forwards, queues the changelog and lets node --watch restart Core', async () => {
    const calls: string[][] = [];
    const service = createUpdateService({
      dataDir: await dataDir(), env: {}, install: CHECKOUT, git: fakeGit({ behind: 1 }, calls), watching: true,
    });
    await expect(service.apply()).resolves.toEqual({ version: '2222222', commit: REMOTE, changed: true, restart: 'automatic' });
    expect(calls).toContainEqual(['merge', '--ff-only', '--quiet', REMOTE]);
    expect(service.changelog()).toMatchObject({ pending: true, version: '2222222', from: '1111111' });
    expect(service.changelog()?.entries[0]?.title).toBe('Newer on GitHub');
  });

  it('asks for a restart when nothing will restart Core', async () => {
    const service = createUpdateService({
      dataDir: await dataDir(), env: {}, install: CHECKOUT, git: fakeGit({ behind: 1 }), watching: false,
    });
    await expect(service.apply()).resolves.toMatchObject({ changed: true, restart: 'manual' });
    expect(service.status().notice).toMatch(/Restart TVM/);
  });

  it('reports a failed fetch instead of throwing', async () => {
    const service = createUpdateService({
      dataDir: await dataDir(), env: {}, install: CHECKOUT,
      git: async () => { throw new Error('Could not resolve host: github.com'); },
    });
    const status = await service.check();
    expect(status.kind).toBe('failed');
    expect(status.notice).toMatch(/Could not resolve host/);
    expect(status.applyAllowed).toBe(false);
  });

  /*
   * The same flow against real repositories: a bare "GitHub", a clone that
   * pushes a new commit, and the checkout TVM runs from. Proves the git
   * commands themselves, not only the decisions around them.
   */
  it('updates a real clone by fast-forward', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tvm-git-'));
    dirs.push(root);
    const run = (cwd: string, ...args: string[]): string =>
      execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const identity = ['-c', 'user.name=TVM Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false'];
    const origin = join(root, 'origin.git');
    const author = join(root, 'author');
    const box = join(root, 'box');
    run(root, 'init', '--bare', '-b', 'main', origin);
    run(root, 'clone', '-q', '-c', 'core.autocrlf=false', origin, author);
    await writeFile(join(author, 'README.md'), 'one\n');
    run(author, 'add', '.');
    run(author, ...identity, 'commit', '-q', '-m', 'First');
    run(author, 'push', '-q', 'origin', 'HEAD:main');
    run(root, 'clone', '-q', '-c', 'core.autocrlf=false', '-b', 'main', origin, box);
    await writeFile(join(author, 'README.md'), 'two\n');
    run(author, ...identity, 'commit', '-q', '-am', 'Second, from GitHub');
    run(author, 'push', '-q', 'origin', 'HEAD:main');

    const service = createUpdateService({
      dataDir: await dataDir(),
      env: {},
      install: { kind: 'checkout', root: box, build: null },
      watching: true,
    });
    const status = await service.check();
    expect(status.kind).toBe('available');
    expect(status.applyAllowed).toBe(true);
    expect(status.available?.changelog?.map((entry) => entry.title)).toEqual(['Second, from GitHub']);

    await expect(service.apply()).resolves.toMatchObject({ changed: true, restart: 'automatic' });
    expect(await readFile(join(box, 'README.md'), 'utf8')).toBe('two\n');
    expect(run(box, 'rev-parse', 'HEAD')).toBe(run(author, 'rev-parse', 'HEAD'));
    await expect(service.check()).resolves.toMatchObject({ kind: 'up_to_date' });

    // Uncommitted work blocks the next update, and is left exactly as it was.
    await writeFile(join(author, 'README.md'), 'three\n');
    run(author, ...identity, 'commit', '-q', '-am', 'Third');
    run(author, 'push', '-q', 'origin', 'HEAD:main');
    await writeFile(join(box, 'README.md'), 'my own edit\n');
    await expect(service.check()).resolves.toMatchObject({ kind: 'available', applyAllowed: false });
    await expect(service.apply()).rejects.toMatchObject({ name: 'ApplyRefused' });
    expect(await readFile(join(box, 'README.md'), 'utf8')).toBe('my own edit\n');
  }, 60_000);
});

describe('install detection', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('knows this source tree is a git checkout', () => {
    const found = detectInstall(pathToFileURL(join(process.cwd(), 'src', 'update', 'install.ts')).href);
    expect(found.kind).toBe('checkout');
    expect(found.root).not.toBeNull();
  });

  it('knows a stamped bundle is a package, and reads its commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tvm-pkg-'));
    dirs.push(root);
    await mkdir(join(root, 'core', 'update'), { recursive: true });
    await writeFile(join(root, 'core', 'build-info.json'), JSON.stringify({ commit: 'ABCDEF1234567890', builtAt: '2026-09-17T00:00:00Z' }));
    const found = detectInstall(pathToFileURL(join(root, 'core', 'update', 'install.js')).href);
    expect(found).toEqual({ kind: 'package', root: null, build: { commit: 'abcdef1234567890', builtAt: '2026-09-17T00:00:00Z', version: null } });
  });

  it('knows whether node --watch will restart Core', () => {
    expect(runningUnderWatch(['--watch'])).toBe(true);
    expect(runningUnderWatch(['--watch-path=src'])).toBe(true);
    expect(runningUnderWatch([])).toBe(false);
  });
});

describe('applied launch', () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('reads a valid current pointer and refuses a hop in development', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tvm-applied-'));
    dirs.push(dir);
    const coreEntry = join(dir, 'app', '0.2.0', 'core', 'index.js');
    await mkdir(join(dir, 'app', '0.2.0', 'core'), { recursive: true });
    await writeFile(coreEntry, 'export {}\n');
    await mkdir(join(dir, 'app'), { recursive: true });
    await writeFile(join(dir, 'app', 'current'), '0.2.0\n');

    const currentUrl = pathToFileURL(coreEntry).href;
    const imageUrl = pathToFileURL(join(dir, 'image', 'core', 'index.js')).href;
    expect(resolveAppliedApp(dir)).toMatchObject({ version: '0.2.0', coreEntry });
    expect(appliedLaunch(dir, currentUrl, { TVM_ENV: 'development' })).toBeNull();
    expect(appliedLaunch(dir, imageUrl, { TVM_ENV: 'production' })?.coreEntry).toBe(coreEntry);
    expect(appliedLaunch(dir, currentUrl, { TVM_ENV: 'production' })).toBeNull();
  });
});

describe('update HTTP', () => {
  let core: RunningCore | undefined;
  let dir: string | undefined;

  afterEach(async () => {
    if (core !== undefined) await core.close();
    core = undefined;
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reports status, and refuses a checkout apply that would touch local work', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tvm-http-'));
    const update = createUpdateService({
      dataDir: dir,
      env: { TVM_ENV: 'development' },
      currentVersion: '0.1.0',
      install: { kind: 'checkout', root: '/repo', build: null },
      git: async (args) => {
        if (args[0] === 'rev-parse' && args[1] === 'HEAD') return '1'.repeat(40);
        if (args[0] === 'rev-parse' && args[1] === 'FETCH_HEAD') return '2'.repeat(40);
        if (args[0] === 'rev-parse') return 'main';
        if (args[0] === 'rev-list') return '0\t1';
        if (args[0] === 'status') return ' M apps/ui/src/App.tsx';
        return '';
      },
    });
    core = await startCoreServer(0, { update, dataDir: dir, env: { TVM_ENV: 'development' } });
    const baseUrl = `http://${CORE_HOST}:${core.port}`;

    const status = await fetch(`${baseUrl}/api/update/status`);
    expect(status.status).toBe(200);
    const body = (await status.json()) as { applyAllowed: boolean; current: string; install: string };
    expect(body.applyAllowed).toBe(false);
    expect(body.current).toBe('0.1.0');
    expect(body.install).toBe('checkout');

    const apply = await fetch(`${baseUrl}/api/update/apply`, { method: 'POST' });
    expect(apply.status).toBe(403);
    const refused = (await apply.json()) as { reason: string };
    expect(refused.reason).toMatch(/uncommitted/);
  });

  it('returns 200 when no desktop build is published', async () => {
    dir = await mkdtemp(join(tmpdir(), 'tvm-http-'));
    const update = createUpdateService({
      dataDir: dir,
      env: { TVM_ENV: 'development' },
      currentVersion: '0.1.0',
      install: { kind: 'package', root: null, build: null },
      fetch: async () => new Response('{"message":"Not Found"}', { status: 404 }),
    });
    core = await startCoreServer(0, { update, dataDir: dir, env: { TVM_ENV: 'development' } });
    const response = await fetch(`http://${CORE_HOST}:${core.port}/api/update/check`, { method: 'POST' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { kind: string; available: unknown; notice: string };
    expect(body.kind).toBe('no_release');
    expect(body.available).toBeNull();
    expect(body.notice).toMatch(/No desktop build/);
  });
});
