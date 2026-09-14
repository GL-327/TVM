import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deleteSecret, readSecret, writeSecret } from '../providers/secrets.ts';
import { CORE_VERSION } from '../config.ts';
import { compareSemver, isNewer } from './semver.ts';
import {
  applyPolicy,
  appDir,
  currentPointer,
  resolveUpdateRepo,
  secretsDir,
  statusPath,
  tokenPath,
} from './paths.ts';
import { extractTarGz, parseSha256File } from './tar.ts';

export type UpdateCheckKind = 'idle' | 'no_release' | 'up_to_date' | 'available' | 'auth_required' | 'rate_limited';

export interface AvailableUpdate {
  version: string;
  notes: string;
}

export interface UpdateStatus {
  current: string;
  channel: string;
  lastCheck: string | null;
  available: AvailableUpdate | null;
  configured: boolean;
  applyAllowed: boolean;
  applyReason: string | null;
  kind: UpdateCheckKind;
  notice: string | null;
}

interface CachedStatus {
  lastCheck: string | null;
  available: AvailableUpdate | null;
  kind?: UpdateCheckKind;
  notice?: string | null;
}

interface GithubRelease {
  tag_name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{
    name?: string;
    id?: number;
    url?: string;
    browser_download_url?: string;
  }>;
}

export interface UpdateService {
  status(): UpdateStatus;
  check(): Promise<UpdateStatus>;
  apply(): Promise<{ version: string }>;
  setToken(token: string): { configured: boolean };
}

export interface UpdateServiceOptions {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  currentVersion?: string;
  now?: () => Date;
}

function redact(value: string): string {
  return value.replace(/(Bearer\s+)(\S+)/gi, '$1[redacted]').replace(/ghp_[A-Za-z0-9]+/g, 'ghp_[redacted]');
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
    };
  } catch {
    return { lastCheck: null, available: null };
  }
}

function writeCache(dataDir: string, cache: CachedStatus): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statusPath(dataDir), JSON.stringify(cache));
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

function assetName(version: string, ext: 'tar.gz' | 'sha256'): string {
  return `tvm-app-${version}.${ext}`;
}

function stripTag(tag: string): string {
  return tag.replace(/^v/i, '');
}

function pickNewestRelease(releases: readonly GithubRelease[]): GithubRelease | null {
  const usable = releases.filter((release) => release.draft !== true && (release.tag_name ?? '').trim() !== '');
  if (usable.length === 0) return null;
  const sorted = [...usable].sort((left, right) => compareSemver(stripTag(right.tag_name ?? ''), stripTag(left.tag_name ?? '')));
  return sorted[0] ?? null;
}

function noticeFor(kind: UpdateCheckKind, repo: string, available: AvailableUpdate | null): string | null {
  if (kind === 'no_release') {
    return `No GitHub Release is published on ${repo} yet.`;
  }
  if (kind === 'up_to_date') return 'You are on the latest published app build.';
  if (kind === 'available' && available !== null) return `Version ${available.version} is available.`;
  if (kind === 'auth_required') {
    return 'This update channel looks private. The public GL-327/TVM feed needs no GitHub login — set TVM_GITHUB_TOKEN only for a private fork.';
  }
  if (kind === 'rate_limited') {
    return 'GitHub rate-limited this check. Wait, or set TVM_GITHUB_TOKEN for a higher quota on a private channel.';
  }
  return null;
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const currentVersion = options.currentVersion ?? CORE_VERSION;
  const now = options.now ?? (() => new Date());
  const { dataDir } = options;
  const repo = resolveUpdateRepo(env);
  const channel = `github:${repo}`;

  const snapshot = (): UpdateStatus => {
    const cache = readCache(dataDir);
    const policy = applyPolicy(env);
    const kind = cache.lastCheck === null ? 'idle' : (cache.kind ?? (cache.available === null ? 'up_to_date' : 'available'));
    return {
      current: currentVersion,
      channel,
      lastCheck: cache.lastCheck,
      available: cache.available,
      configured: resolveToken(dataDir, env) !== null,
      applyAllowed: policy.allowed,
      applyReason: policy.reason,
      kind,
      notice: cache.notice ?? null,
    };
  };

  const remember = (kind: UpdateCheckKind, available: AvailableUpdate | null): UpdateStatus => {
    const notice = noticeFor(kind, repo, available);
    writeCache(dataDir, { lastCheck: now().toISOString(), available, kind, notice });
    return snapshot();
  };

  const headersFor = (accept: string, authorize: boolean): Record<string, string> => {
    const headers: Record<string, string> = {
      Accept: accept,
      'User-Agent': 'tvm-core',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const token = authorize ? resolveToken(dataDir, env) : null;
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const github = async (
    url: string,
    accept: string,
    mode: 'follow' | 'manual' | 'error' = 'follow',
  ): Promise<Response> => {
    log('tvm-core: github', url);
    // Public repos (GL-327/TVM) must work with no token. A leftover or expired
    // token 401s even on public releases, so always try anonymous first.
    const anonymous = await fetchImpl(url, { headers: headersFor(accept, false), redirect: mode });
    if (anonymous.ok || anonymous.status === 429) return anonymous;
    const token = resolveToken(dataDir, env);
    const maybePrivate = anonymous.status === 401 || anonymous.status === 403 || anonymous.status === 404;
    if (token === null || !maybePrivate) return anonymous;
    const authorized = await fetchImpl(url, { headers: headersFor(accept, true), redirect: mode });
    if (authorized.ok || authorized.status === 429) return authorized;
    return anonymous;
  };

  const requireOk = async (url: string, accept: string): Promise<Response> => {
    const response = await github(url, accept);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('GitHub rejected the credentials. The public feed needs no token; set TVM_GITHUB_TOKEN only for a private fork.');
      }
      if (response.status === 429) {
        throw new Error('GitHub rate-limited this download. Wait, or set TVM_GITHUB_TOKEN for a higher quota.');
      }
      if (response.status === 404) {
        throw new Error(`Release is missing on ${repo}.`);
      }
      throw new Error(`GitHub replied ${response.status}`);
    }
    return response;
  };

  /**
   * Private assets need the API URL + token. Follow the signed redirect without
   * forwarding Authorization — S3 rejects a GitHub bearer.
   */
  const downloadAsset = async (asset: { url?: string; browser_download_url?: string }): Promise<Buffer> => {
    if (asset.url !== undefined && asset.url !== '') {
      const first = await github(asset.url, 'application/octet-stream', 'manual');
      if (first.status >= 300 && first.status < 400) {
        const location = first.headers.get('location');
        if (location === null || location === '') {
          throw new Error('GitHub asset redirect was missing a Location header');
        }
        const second = await fetchImpl(location, { headers: headersFor('application/octet-stream', false) });
        if (!second.ok) throw new Error(`GitHub asset download failed (${second.status})`);
        return Buffer.from(await second.arrayBuffer());
      }
      if (!first.ok) throw new Error(`GitHub asset download failed (${first.status})`);
      return Buffer.from(await first.arrayBuffer());
    }
    if (asset.browser_download_url !== undefined && asset.browser_download_url !== '') {
      const response = await fetchImpl(asset.browser_download_url, {
        headers: headersFor('application/octet-stream', false),
      });
      if (!response.ok) throw new Error(`GitHub asset download failed (${response.status})`);
      return Buffer.from(await response.arrayBuffer());
    }
    throw new Error('Release asset has no URL');
  };

  const readLatestRelease = async (): Promise<{ kind: UpdateCheckKind; release: GithubRelease | null }> => {
    const latest = await github(`https://api.github.com/repos/${repo}/releases/latest`, 'application/vnd.github+json');
    if (latest.status === 429) return { kind: 'rate_limited', release: null };
    if (latest.status === 401 || latest.status === 403) return { kind: 'auth_required', release: null };
    if (latest.ok) {
      return { kind: 'up_to_date', release: (await latest.json()) as GithubRelease };
    }
    if (latest.status !== 404) {
      throw new Error(`GitHub replied ${latest.status}`);
    }

    const listed = await github(
      `https://api.github.com/repos/${repo}/releases?per_page=10`,
      'application/vnd.github+json',
    );
    if (listed.status === 429) return { kind: 'rate_limited', release: null };
    if (listed.status === 401 || listed.status === 403) return { kind: 'auth_required', release: null };
    if (!listed.ok) {
      if (listed.status === 404) {
        return { kind: resolveToken(dataDir, env) === null ? 'auth_required' : 'no_release', release: null };
      }
      throw new Error(`GitHub replied ${listed.status}`);
    }
    const payload = (await listed.json()) as unknown;
    const releases = Array.isArray(payload) ? (payload as GithubRelease[]) : [];
    return { kind: 'no_release', release: pickNewestRelease(releases) };
  };

  return {
    status: snapshot,

    async check(): Promise<UpdateStatus> {
      const found = await readLatestRelease();
      if (found.kind === 'rate_limited' || found.kind === 'auth_required') {
        return remember(found.kind, null);
      }
      const release = found.release;
      const version = stripTag((release?.tag_name ?? '').trim());
      if (release === null || version === '') {
        return remember('no_release', null);
      }
      const available =
        isNewer(version, currentVersion) ? { version, notes: (release.body ?? '').slice(0, 400) } : null;
      return remember(available === null ? 'up_to_date' : 'available', available);
    },

    async apply(): Promise<{ version: string }> {
      const policy = applyPolicy(env);
      if (!policy.allowed) {
        const error = new Error(policy.reason ?? 'apply refused');
        error.name = 'ApplyRefused';
        throw error;
      }

      const latest = await this.check();
      const available = latest.available;
      if (available === null) {
        throw new Error(latest.notice ?? 'No newer app build is available.');
      }

      const found = await readLatestRelease();
      if (found.kind === 'auth_required' || found.kind === 'rate_limited') {
        throw new Error(noticeFor(found.kind, repo, null) ?? found.kind);
      }
      let release = found.release;
      if (release === null || stripTag((release.tag_name ?? '').trim()) !== available.version) {
        const listed = await requireOk(
          `https://api.github.com/repos/${repo}/releases?per_page=20`,
          'application/vnd.github+json',
        );
        const payload = (await listed.json()) as unknown;
        const match = (Array.isArray(payload) ? (payload as GithubRelease[]) : []).find(
          (item) => stripTag((item.tag_name ?? '').trim()) === available.version,
        );
        if (match === undefined) {
          throw new Error(`Release is missing ${assetName(available.version, 'tar.gz')} or its .sha256`);
        }
        release = match;
      }
      const assets = release.assets ?? [];
      const tarball = assets.find((asset) => asset.name === assetName(available.version, 'tar.gz'));
      const checksum = assets.find((asset) => asset.name === assetName(available.version, 'sha256'));
      if (tarball === undefined || checksum === undefined) {
        throw new Error(`Release is missing ${assetName(available.version, 'tar.gz')} or its .sha256`);
      }

      const checksumText = (await downloadAsset(checksum)).toString('utf8');
      const expected = parseSha256File(checksumText);
      const archive = await downloadAsset(tarball);
      const actual = createHash('sha256').update(archive).digest('hex');
      if (actual !== expected) {
        throw new Error('SHA-256 did not match the release checksum');
      }

      const dest = appDir(dataDir, available.version);
      mkdirSync(dest, { recursive: true });
      extractTarGz(archive, dest);
      writeFileSync(currentPointer(dataDir), `${available.version}\n`, { encoding: 'utf8' });
      log(`tvm-core: applied app ${available.version}`);
      return { version: available.version };
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

export function startUpdatePolling(service: UpdateService, intervalMs: number): () => void {
  const tick = (): void => {
    void service.check().catch((error: unknown) => {
      log('tvm-core: update check failed', error instanceof Error ? error.message : error);
    });
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  return () => clearInterval(timer);
}

export function restartAfterApply(): void {
  setTimeout(() => {
    process.exit(0);
  }, 250);
}

export function tokenConfigured(dataDir: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveToken(dataDir, env) !== null;
}
