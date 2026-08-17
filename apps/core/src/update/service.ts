import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { CORE_VERSION } from '../config.ts';
import { isNewer } from './semver.ts';
import {
  UPDATE_REPO,
  appDir,
  applyPolicy,
  currentPointer,
  statusPath,
  tokenPath,
  secretsDir,
} from './paths.ts';
import { extractTarGz, parseSha256File } from './tar.ts';

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
}

interface CachedStatus {
  lastCheck: string | null;
  available: AvailableUpdate | null;
}

interface GithubRelease {
  tag_name?: string;
  body?: string;
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
    return { lastCheck: raw.lastCheck ?? null, available: raw.available ?? null };
  } catch {
    return { lastCheck: null, available: null };
  }
}

function writeCache(dataDir: string, cache: CachedStatus): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(statusPath(dataDir), JSON.stringify(cache));
}

function storedToken(dataDir: string): string | null {
  try {
    const value = readFileSync(tokenPath(dataDir), 'utf8').trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

function resolveToken(dataDir: string, env: NodeJS.ProcessEnv): string | null {
  return storedToken(dataDir) ?? (env['TVM_GITHUB_TOKEN']?.trim() || null);
}

function assetName(version: string, ext: 'tar.gz' | 'sha256'): string {
  return `tvm-app-${version}.${ext}`;
}

export function createUpdateService(options: UpdateServiceOptions): UpdateService {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetch ?? fetch;
  const currentVersion = options.currentVersion ?? CORE_VERSION;
  const now = options.now ?? (() => new Date());
  const { dataDir } = options;
  const channel = `github:${UPDATE_REPO}`;

  const snapshot = (): UpdateStatus => {
    const cache = readCache(dataDir);
    const policy = applyPolicy(env);
    return {
      current: currentVersion,
      channel,
      lastCheck: cache.lastCheck,
      available: cache.available,
      configured: resolveToken(dataDir, env) !== null,
      applyAllowed: policy.allowed,
      applyReason: policy.reason,
    };
  };

  const github = async (url: string, accept: string): Promise<Response> => {
    const token = resolveToken(dataDir, env);
    const headers: Record<string, string> = {
      Accept: accept,
      'User-Agent': 'tvm-core',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token !== null) headers.Authorization = `Bearer ${token}`;
    log('tvm-core: github', url);
    const response = await fetchImpl(url, { headers });
    if (!response.ok) {
      throw new Error(`GitHub replied ${response.status}`);
    }
    return response;
  };

  return {
    status: snapshot,

    async check(): Promise<UpdateStatus> {
      const response = await github(
        `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
        'application/vnd.github+json',
      );
      const release = (await response.json()) as GithubRelease;
      const version = (release.tag_name ?? '').replace(/^v/i, '');
      const available =
        version !== '' && isNewer(version, currentVersion)
          ? { version, notes: (release.body ?? '').slice(0, 400) }
          : null;

      writeCache(dataDir, { lastCheck: now().toISOString(), available });
      return snapshot();
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
        throw new Error('No newer app build is available.');
      }

      const releaseResponse = await github(
        `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
        'application/vnd.github+json',
      );
      const release = (await releaseResponse.json()) as GithubRelease;
      const assets = release.assets ?? [];
      const tarball = assets.find((asset) => asset.name === assetName(available.version, 'tar.gz'));
      const checksum = assets.find((asset) => asset.name === assetName(available.version, 'sha256'));
      if (tarball?.url === undefined || checksum?.url === undefined) {
        throw new Error(`Release is missing ${assetName(available.version, 'tar.gz')} or its .sha256`);
      }

      const checksumText = await (await github(checksum.url, 'application/octet-stream')).text();
      const expected = parseSha256File(checksumText);
      const archive = Buffer.from(await (await github(tarball.url, 'application/octet-stream')).arrayBuffer());
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
      writeFileSync(tokenPath(dataDir), trimmed, { encoding: 'utf8' });
      try {
        chmodSync(tokenPath(dataDir), 0o600);
      } catch {
        // Windows cannot honour 0600; the file still lives outside the repo.
      }
      return { configured: trimmed !== '' || env['TVM_GITHUB_TOKEN'] !== undefined };
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

export function tokenConfigured(dataDir: string): boolean {
  return existsSync(tokenPath(dataDir));
}
