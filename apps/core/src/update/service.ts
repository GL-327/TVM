import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { deleteSecret, readSecret, writeSecret } from '../providers/secrets.ts';
import { CORE_VERSION } from '../config.ts';
import {
  applyPolicy,
  appDir,
  changelogPath,
  currentPointer,
  resolveUpdateRepo,
  secretsDir,
  statusPath,
  tokenPath,
} from './paths.ts';
import { requestRestart } from './restart.ts';
import { extractTarGz } from './tar.ts';
import {
  changesSince,
  feedIncludes,
  FEED_TAGS,
  DESKTOP_MANIFEST,
  parseFeedManifest,
  releaseDownloadUrl,
  shortCommit,
  type FeedManifest,
} from './feed.ts';
import {
  notesFromEntries,
  parseChangelogRecord,
  parseCommitMessage,
  sameCommit,
  shouldSkipCommitTitle,
  type ChangelogEntry,
  type ChangelogRecord,
} from './changelog.ts';
import {
  DEPENDENCY_FILES,
  detectInstall,
  gitRunner,
  runningUnderWatch,
  type GitRunner,
  type InstallInfo,
  type InstallKind,
} from './install.ts';

export type UpdateCheckKind =
  | 'idle'
  | 'no_release'
  | 'up_to_date'
  | 'available'
  | 'auth_required'
  | 'rate_limited'
  | 'app_update_required'
  | 'failed';

export interface AvailableUpdate {
  /** Short commit, which is what a person reads. */
  version: string;
  commit?: string;
  notes: string;
  changelog?: ChangelogEntry[];
}

export interface UpdateStatus {
  current: string;
  currentCommit: string | null;
  install: InstallKind;
  channel: string;
  lastCheck: string | null;
  available: AvailableUpdate | null;
  configured: boolean;
  applyAllowed: boolean;
  applyReason: string | null;
  kind: UpdateCheckKind;
  notice: string | null;
  changelog: ChangelogRecord | null;
}

/** What apply did, and what has to happen for it to take effect. */
export interface ApplyResult {
  version: string;
  commit: string | null;
  changed: boolean;
  /**
   * automatic  the files changed under a `node --watch` Core, which restarts itself
   * self       the caller must exit so the launcher starts the new bundle
   * manual     the person has to restart TVM
   * reload     (phones) only the page needs reloading; never sent by this Core
   */
  restart: 'automatic' | 'self' | 'manual' | 'reload';
}

interface CachedStatus {
  lastCheck: string | null;
  available: AvailableUpdate | null;
  kind?: UpdateCheckKind;
  notice?: string | null;
  applyAllowed?: boolean;
  applyReason?: string | null;
}

interface GithubRelease {
  assets?: Array<{ name?: string; url?: string; browser_download_url?: string }>;
}

export interface UpdateService {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  apply(): Promise<ApplyResult>;
  changelog(): ChangelogRecord | null;
  markChangelogSeen(): ChangelogRecord | null;
  setToken(token: string): { configured: boolean };
}

export interface UpdateServiceOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  currentVersion?: string;
  /** Overrides the detected commit (tests, or TVM_GIT_SHA). */
  currentCommit?: string;
  /** Overrides install detection. */
  install?: InstallInfo;
  /** Overrides git for a checkout (tests). */
  git?: GitRunner;
  /** Whether Core restarts itself on file changes. Defaults to `node --watch` detection. */
  watching?: boolean;
  now?: () => Date;
}

function redact(value: string): string {
  return value.replace(/(Bearer\s+)(\S+)/gi, '$1[redacted]').replace(/gh[pousr]_[A-Za-z0-9]+/g, 'gh_[redacted]');
}

function log(...parts: unknown[]): void {
  const line = parts.map((part) => (typeof part === 'string' ? redact(part) : part)).join(' ');
  console.log(line);
}

function readCache(dataDir: string): CachedStatus {
  try {
    const raw = JSON.parse(readFileSync(statusPath(dataDir), 'utf8')) as CachedStatus;
    return {
      lastCheck: raw.lastCheck ?? null,
      available: raw.available ?? null,
      kind: raw.kind,
      notice: raw.notice ?? null,
      applyAllowed: raw.applyAllowed,
      applyReason: raw.applyReason ?? null,
    };
  } catch {
    return { lastCheck: null, available: null };
  }
}

function writeCache(dataDir: string, cache: CachedStatus): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statusPath(dataDir), JSON.stringify(cache));
}

function readChangelogFile(dataDir: string): ChangelogRecord | null {
  try {
    return parseChangelogRecord(JSON.parse(readFileSync(changelogPath(dataDir), 'utf8')) as unknown);
  } catch {
    return null;
  }
}

function writeChangelogFile(dataDir: string, record: ChangelogRecord): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(changelogPath(dataDir), JSON.stringify(record));
}

function storedToken(dataDir: string): string | null {
  return readSecret(tokenPath(dataDir));
}

function resolveToken(dataDir: string, env: NodeJS.ProcessEnv): string | null {
  const stored = storedToken(dataDir);
  if (stored !== null && stored !== '') return stored;
  const fromEnv = env['TVM_GITHUB_TOKEN']?.trim();
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : null;
}

const FIELD = '\u001f';
const RECORD = '\u001e';

/** `git log` in a shape that survives any commit message. */
export function parseGitLog(output: string, limit = 12): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  for (const record of output.split(RECORD)) {
    const trimmed = record.replace(/^\s+/, '');
    if (trimmed === '') continue;
    const [sha = '', date = '', ...message] = trimmed.split(FIELD);
    const { title, body } = parseCommitMessage(message.join(FIELD));
    if (shouldSkipCommitTitle(title)) continue;
    entries.push({ sha: sha.trim().slice(0, 7), title, body, date: date.trim() === '' ? null : date.trim() });
    if (entries.length >= limit) break;
  }
  return entries;
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const currentVersion = options.currentVersion ?? CORE_VERSION;
  const now = options.now ?? (() => new Date());
  const { dataDir } = options;
  const repo = resolveUpdateRepo(env);
  const install = options.install ?? detectInstall();
  const kind: InstallKind = install.kind;
  const git = options.git ?? (install.root !== null ? gitRunner(install.root) : null);
  const watching = options.watching ?? runningUnderWatch();
  const channel = kind === 'checkout' ? `git:${repo}#main` : `github:${repo}#${FEED_TAGS.desktop}`;
  const envCommit = env['TVM_GIT_SHA']?.trim() ?? '';

  let commitCache: string | null | undefined =
    options.currentCommit !== undefined && options.currentCommit !== ''
      ? options.currentCommit
      : envCommit !== ''
        ? envCommit
        : install.build?.commit;

  const readHead = async (): Promise<string | null> => {
    if (git === null) return null;
    try {
      const head = await git(['rev-parse', 'HEAD']);
      return /^[0-9a-f]{40}$/i.test(head) ? head.toLowerCase() : null;
    } catch {
      return null;
    }
  };

  const currentCommit = async (): Promise<string | null> => {
    // A checkout moves under us (a pull, a commit), so it is read each time.
    if (kind === 'checkout' && options.currentCommit === undefined && envCommit === '') {
      commitCache = await readHead();
      return commitCache;
    }
    return commitCache ?? null;
  };

  const snapshot = (): UpdateStatus => {
    const cache = readCache(dataDir);
    const policy = kind === 'package' ? applyPolicy(env, kind) : { allowed: false, reason: null };
    const checked = cache.lastCheck !== null;
    return {
      current: currentVersion,
      currentCommit: commitCache ?? null,
      install: kind,
      channel,
      lastCheck: cache.lastCheck,
      available: cache.available,
      configured: resolveToken(dataDir, env) !== null,
      // A package's permission is policy; a checkout's depends on its state,
      // which only a check can see.
      applyAllowed: kind === 'package' ? policy.allowed : checked && cache.applyAllowed === true,
      applyReason:
        kind === 'package'
          ? policy.reason
          : checked
            ? (cache.applyReason ?? null)
            : 'Check for updates first.',
      kind: checked ? (cache.kind ?? (cache.available === null ? 'up_to_date' : 'available')) : 'idle',
      notice: cache.notice ?? null,
      changelog: readChangelogFile(dataDir),
    };
  };

  const remember = (entry: Omit<CachedStatus, 'lastCheck'>): UpdateStatus => {
    writeCache(dataDir, { ...entry, lastCheck: now().toISOString() });
    return snapshot();
  };

  const headers = (accept: string, authorize: boolean): Record<string, string> => {
    const out: Record<string, string> = {
      Accept: accept,
      'User-Agent': 'tvm-core',
      // Raw bytes so a tar.gz checksum still matches after GitHub's 302.
      'Accept-Encoding': 'identity',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = authorize ? resolveToken(dataDir, env) : null;
    if (token !== null) out.Authorization = `Bearer ${token}`;
    return out;
  };

  /**
   * Downloads one file from a release.
   *
   * The public download host first, with no token: it has no API quota, and a
   * leftover expired token must never break a public feed. A private fork
   * falls back to the API asset URL with the token, and the signed redirect
   * that follows is fetched without it — the storage host rejects a GitHub
   * bearer.
   */
  const releaseFile = async (tag: string, file: string): Promise<Response> => {
    const direct = releaseDownloadUrl(repo, tag, file);
    log('tvm-core: update feed', direct);
    const anonymous = await fetchImpl(direct, { headers: headers('application/octet-stream', false), redirect: 'follow' });
    if (anonymous.ok || anonymous.status === 429) return anonymous;
    const token = resolveToken(dataDir, env);
    if (token === null || ![401, 403, 404].includes(anonymous.status)) return anonymous;
    const listed = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: headers('application/vnd.github+json', true),
    });
    if (!listed.ok) return anonymous;
    const release = (await listed.json()) as GithubRelease;
    const asset = (release.assets ?? []).find((item) => item.name === file);
    if (asset?.url === undefined || asset.url === '') return anonymous;
    const first = await fetchImpl(asset.url, { headers: headers('application/octet-stream', true), redirect: 'manual' });
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get('location');
      if (location === null || location === '') return anonymous;
      return fetchImpl(location, { headers: headers('application/octet-stream', false) });
    }
    return first;
  };

  const readManifest = async (): Promise<{ kind: UpdateCheckKind; manifest: FeedManifest | null; detail?: string }> => {
    let response: Response;
    try {
      response = await releaseFile(FEED_TAGS.desktop, DESKTOP_MANIFEST);
    } catch (error) {
      return { kind: 'failed', manifest: null, detail: error instanceof Error ? error.message : String(error) };
    }
    if (response.status === 429) return { kind: 'rate_limited', manifest: null };
    if (response.status === 401 || response.status === 403) return { kind: 'auth_required', manifest: null };
    if (response.status === 404) {
      return { kind: resolveToken(dataDir, env) === null && repo !== 'GL-327/TVM' ? 'auth_required' : 'no_release', manifest: null };
    }
    if (!response.ok) return { kind: 'failed', manifest: null, detail: `GitHub replied ${response.status}` };
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: 'failed', manifest: null, detail: 'The update manifest was not valid JSON.' };
    }
    const manifest = parseFeedManifest(body);
    return manifest === null
      ? { kind: 'failed', manifest: null, detail: 'The update manifest was incomplete.' }
      : { kind: 'available', manifest };
  };

  const noticeFor = (outcome: UpdateCheckKind, detail?: string): string => {
    switch (outcome) {
      case 'no_release':
        return `No desktop build is published on ${repo} yet.`;
      case 'auth_required':
        return 'This update channel looks private. The public GL-327/TVM feed needs no GitHub login — set TVM_GITHUB_TOKEN only for a private fork.';
      case 'rate_limited':
        return 'GitHub rate-limited this check. Try again in a few minutes.';
      case 'failed':
        return `The update check did not finish${detail !== undefined && detail !== '' ? `: ${detail}` : '.'}`;
      case 'up_to_date':
        return 'You are on the latest published build.';
      default:
        return '';
    }
  };

  // ---- package -------------------------------------------------------------

  const checkPackage = async (): Promise<UpdateStatus> => {
    const found = await readManifest();
    if (found.manifest === null) {
      return remember({ available: null, kind: found.kind, notice: noticeFor(found.kind, found.detail) });
    }
    const manifest = found.manifest;
    const current = await currentCommit();
    if (current !== null && sameCommit(manifest.commit, current)) {
      return remember({ available: null, kind: 'up_to_date', notice: noticeFor('up_to_date') });
    }
    if (current !== null && !feedIncludes(manifest, current) && manifest.builtAt !== '' && install.build?.builtAt != null
      && install.build.builtAt > manifest.builtAt) {
      // Built after the published bundle, so there is nothing newer to fetch.
      return remember({ available: null, kind: 'up_to_date', notice: 'This build is newer than the published one.' });
    }
    const changelog = changesSince(manifest, current);
    const available: AvailableUpdate = {
      version: shortCommit(manifest.commit),
      commit: manifest.commit,
      notes: notesFromEntries(changelog, `Build ${shortCommit(manifest.commit)}`),
      changelog,
    };
    return remember({ available, kind: 'available', notice: `Build ${available.version} is available.` });
  };

  const applyPackage = async (): Promise<ApplyResult> => {
    const policy = applyPolicy(env, 'package');
    if (!policy.allowed) {
      const error = new Error(policy.reason ?? 'apply refused');
      error.name = 'ApplyRefused';
      throw error;
    }
    const found = await readManifest();
    if (found.manifest === null) throw new Error(noticeFor(found.kind, found.detail));
    const manifest = found.manifest;
    const from = await currentCommit();
    if (from !== null && sameCommit(from, manifest.commit)) {
      return { version: shortCommit(manifest.commit), commit: manifest.commit, changed: false, restart: 'manual' };
    }
    const response = await releaseFile(FEED_TAGS.desktop, manifest.asset);
    if (!response.ok) throw new Error(`The desktop bundle could not be downloaded (${response.status}).`);
    const archive = Buffer.from(await response.arrayBuffer());
    const actual = createHash('sha256').update(archive).digest('hex');
    if (actual !== manifest.sha256) throw new Error('SHA-256 did not match the published checksum.');

    const id = shortCommit(manifest.commit);
    const dest = appDir(dataDir, id);
    rmSync(dest, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    extractTarGz(archive, dest);
    writeFileSync(currentPointer(dataDir), `${id}\n`, { encoding: 'utf8' });

    const entries = changesSince(manifest, from);
    writeChangelogFile(dataDir, {
      pending: true,
      version: id,
      from: from === null ? null : shortCommit(from),
      to: id,
      appliedAt: now().toISOString(),
      entries: entries.length > 0 ? entries : [{ sha: id, title: `Build ${id}`, body: '', date: null }],
    });
    remember({ available: null, kind: 'up_to_date', notice: `Applied build ${id}. TVM is restarting.` });
    log(`tvm-core: applied desktop build ${id}`);
    return { version: id, commit: manifest.commit, changed: true, restart: 'self' };
  };

  // ---- checkout ------------------------------------------------------------

  interface CheckoutState {
    head: string;
    remote: string;
    behind: number;
    ahead: number;
    allowed: boolean;
    reason: string | null;
    entries: ChangelogEntry[];
  }

  const inspectCheckout = async (runner: GitRunner): Promise<CheckoutState> => {
    await runner(['fetch', '--quiet', '--no-tags', 'origin', 'main']);
    const head = (await runner(['rev-parse', 'HEAD'])).toLowerCase();
    const remote = (await runner(['rev-parse', 'FETCH_HEAD'])).toLowerCase();
    const counts = (await runner(['rev-list', '--left-right', '--count', `${head}...${remote}`])).split(/\s+/);
    const ahead = Number(counts[0] ?? 0) || 0;
    const behind = Number(counts[1] ?? 0) || 0;
    let entries: ChangelogEntry[] = [];
    let allowed = true;
    let reason: string | null = null;
    if (behind > 0) {
      const history = await runner(['log', '-n', '20', `--format=%H${FIELD}%cI${FIELD}%B${RECORD}`, `${head}..${remote}`]);
      entries = parseGitLog(history);
      const branch = await runner(['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '');
      const dirty = await runner(['status', '--porcelain', '--untracked-files=no']);
      const deps = await runner(['diff', '--name-only', head, remote, '--', ...DEPENDENCY_FILES]);
      if (branch !== 'main') {
        allowed = false;
        reason = `This checkout is on "${branch || 'a detached commit'}", not main. Switch to main to update.`;
      } else if (ahead > 0) {
        allowed = false;
        reason = `This checkout has ${ahead} commit${ahead === 1 ? '' : 's'} that are not on GitHub. Push or rebase them first.`;
      } else if (dirty !== '') {
        allowed = false;
        reason = 'This checkout has uncommitted changes. Commit or stash them, and TVM will update.';
      } else if (deps !== '') {
        allowed = false;
        reason = 'This update changes dependencies. Run "git pull" and then "corepack pnpm install" to take it.';
      }
    }
    return { head, remote, behind, ahead, allowed, reason, entries };
  };

  const checkCheckout = async (): Promise<UpdateStatus> => {
    if (git === null) return remember({ available: null, kind: 'failed', notice: noticeFor('failed', 'git is not available') });
    let state: CheckoutState;
    try {
      state = await inspectCheckout(git);
    } catch (error) {
      return remember({ available: null, kind: 'failed', notice: noticeFor('failed', error instanceof Error ? error.message : String(error)), applyAllowed: false });
    }
    commitCache = state.head;
    if (state.behind === 0) {
      return remember({
        available: null,
        kind: 'up_to_date',
        notice: state.ahead > 0
          ? `This checkout is ${state.ahead} commit${state.ahead === 1 ? '' : 's'} ahead of GitHub.`
          : 'This checkout matches GitHub main.',
        applyAllowed: false,
        applyReason: null,
      });
    }
    const available: AvailableUpdate = {
      version: shortCommit(state.remote),
      commit: state.remote,
      notes: notesFromEntries(state.entries, `Build ${shortCommit(state.remote)}`),
      changelog: state.entries,
    };
    return remember({
      available,
      kind: 'available',
      notice: `GitHub main is ${state.behind} commit${state.behind === 1 ? '' : 's'} ahead of this checkout.`,
      applyAllowed: state.allowed,
      applyReason: state.reason,
    });
  };

  const applyCheckout = async (): Promise<ApplyResult> => {
    if (git === null) throw new Error('git is not available, so this checkout cannot update itself.');
    const state = await inspectCheckout(git);
    if (state.behind === 0) {
      remember({ available: null, kind: 'up_to_date', notice: 'This checkout matches GitHub main.', applyAllowed: false, applyReason: null });
      return { version: shortCommit(state.head), commit: state.head, changed: false, restart: 'manual' };
    }
    if (!state.allowed) {
      const error = new Error(state.reason ?? 'apply refused');
      error.name = 'ApplyRefused';
      throw error;
    }
    // Fast-forward only: it cannot rewrite history or touch uncommitted work,
    // and it refuses outright rather than merging if anything has diverged.
    await git(['merge', '--ff-only', '--quiet', state.remote]);
    const id = shortCommit(state.remote);
    commitCache = state.remote;
    writeChangelogFile(dataDir, {
      pending: true,
      version: id,
      from: shortCommit(state.head),
      to: id,
      appliedAt: now().toISOString(),
      entries: state.entries.length > 0 ? state.entries : [{ sha: id, title: `Build ${id}`, body: '', date: null }],
    });
    remember({
      available: null,
      kind: 'up_to_date',
      notice: watching ? `Updated to ${id}. TVM is restarting.` : `Updated to ${id}. Restart TVM to finish.`,
      applyAllowed: false,
      applyReason: null,
    });
    log(`tvm-core: fast-forwarded checkout to ${id}`);
    return { version: id, commit: state.remote, changed: true, restart: watching ? 'automatic' : 'manual' };
  };

  return {
    status: snapshot,

    async check(): Promise<UpdateStatus> {
      return kind === 'checkout' ? checkCheckout() : checkPackage();
    },

    async apply(): Promise<ApplyResult> {
      return kind === 'checkout' ? applyCheckout() : applyPackage();
    },

    changelog(): ChangelogRecord | null {
      return readChangelogFile(dataDir);
    },

    markChangelogSeen(): ChangelogRecord | null {
      const current = readChangelogFile(dataDir);
      if (current === null) return null;
      const next = { ...current, pending: false };
      writeChangelogFile(dataDir, next);
      return next;
    },

    setToken(token: string): { configured: boolean } {
      mkdirSync(secretsDir(dataDir), { recursive: true });
      const trimmed = token.trim();
      if (trimmed === '') deleteSecret(tokenPath(dataDir));
      else writeSecret(tokenPath(dataDir), trimmed);
      return { configured: resolveToken(dataDir, env) !== null };
    },
  };
}

export function startUpdatePolling(
  service: UpdateService,
  intervalMs: number,
  options: { autoApply?: () => boolean } = {},
): () => void {
  let running = false;
  const tick = (): void => {
    if (running) return;
    running = true;
    void service
      .check()
      .then(async (status) => {
        if (options.autoApply?.() !== true || !status.applyAllowed || status.available === null) return;
        const result = await service.apply();
        if (result.changed && result.restart === 'self') restartAfterApply();
      })
      .catch((error: unknown) => {
        log('tvm-core: update check failed', error instanceof Error ? error.message : error);
      })
      .finally(() => {
        running = false;
      });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function restartAfterApply(): void {
  requestRestart();
}

export function tokenConfigured(dataDir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveToken(dataDir, env) !== null;
}
