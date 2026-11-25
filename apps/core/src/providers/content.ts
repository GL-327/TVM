import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The shared data every TVM app ships with (packages/content): changelog,
 * release events, free channels, services, avatars and age limits.
 *
 * Core reads the copy built beside it (dist/content) or, from a checkout, the
 * package itself. Events, channels, services and avatars also refresh from
 * GitHub every few hours, so a new release spotlight or a moved stream reaches
 * installed apps without an update. A refresh that fails or does not look like
 * the file it replaces is ignored: the last good copy stays.
 */

export const CONTENT_NAMES = ['changelog', 'events', 'free-channels', 'services', 'avatars', 'parental'] as const;
export type ContentName = (typeof CONTENT_NAMES)[number];

const REMOTE: ReadonlySet<ContentName> = new Set(['events', 'free-channels', 'services', 'avatars']);
const LIST_KEY: Record<ContentName, string> = {
  changelog: 'releases',
  events: 'events',
  'free-channels': 'channels',
  services: 'services',
  avatars: 'sets',
  parental: 'levels',
};
export const CONTENT_REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_MS = 8_000;

export function isContentName(value: string): value is ContentName {
  return (CONTENT_NAMES as readonly string[]).includes(value);
}

export function contentRemoteUrl(name: ContentName, repo = 'GL-327/TVM'): string {
  return `https://raw.githubusercontent.com/${repo}/main/packages/content/${name}.json`;
}

/** True when `value` has the shape every client expects of `name`. */
export function validContent(name: ContentName, value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record['schema'] !== 1) return false;
  const list = record[LIST_KEY[name]];
  return Array.isArray(list) && list.length > 0;
}

/** Where the bundled JSON lives: beside the compiled Core, or in the checkout. */
export function bundledContentDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const dirs: string[] = [];
  const override = env['TVM_CONTENT_DIR']?.trim();
  if (override !== undefined && override !== '') dirs.push(override);
  // dist/providers -> dist/content (packaged), src/providers -> packages/content (checkout).
  dirs.push(join(here, '..', 'content'), join(here, '..', '..', '..', '..', 'packages', 'content'));
  return dirs;
}

function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export interface ContentServiceOptions {
  dataDir: string;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  repo?: string;
  now?: () => number;
  /** Off in tests and when TVM_CONTENT_REMOTE=0. */
  remote?: boolean;
}

export function createContentService(options: ContentServiceOptions) {
  const fetchImpl = options.fetch ?? fetch;
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const remote = options.remote ?? env['TVM_CONTENT_REMOTE'] !== '0';
  const cacheDir = join(options.dataDir, 'content');
  const memory = new Map<ContentName, Record<string, unknown>>();
  const checkedAt = new Map<ContentName, number>();
  const inflight = new Map<ContentName, Promise<void>>();

  const bundled = (name: ContentName): Record<string, unknown> | null => {
    for (const dir of bundledContentDirs(env)) {
      const path = join(dir, `${name}.json`);
      if (!existsSync(path)) continue;
      const value = readJsonFile(path);
      if (validContent(name, value)) return value;
    }
    return null;
  };

  const cached = (name: ContentName): Record<string, unknown> | null => {
    const value = readJsonFile(join(cacheDir, `${name}.json`));
    return validContent(name, value) ? value : null;
  };

  const load = (name: ContentName): Record<string, unknown> => {
    const hit = memory.get(name);
    if (hit !== undefined) return hit;
    const value = (REMOTE.has(name) ? cached(name) : null) ?? bundled(name) ?? { schema: 1, [LIST_KEY[name]]: [] };
    memory.set(name, value);
    return value;
  };

  const refresh = (name: ContentName): Promise<void> => {
    const running = inflight.get(name);
    if (running !== undefined) return running;
    const task = (async () => {
      checkedAt.set(name, now());
      try {
        const response = await fetchImpl(contentRemoteUrl(name, options.repo), {
          signal: AbortSignal.timeout(FETCH_MS),
          headers: { accept: 'application/json' },
        });
        if (!response.ok) return;
        const value = (await response.json()) as unknown;
        if (!validContent(name, value)) return;
        memory.set(name, value);
        mkdirSync(cacheDir, { recursive: true });
        writeFileSync(join(cacheDir, `${name}.json`), JSON.stringify(value));
      } catch {
        // Offline or GitHub unreachable: keep what we have.
      } finally {
        inflight.delete(name);
      }
    })();
    inflight.set(name, task);
    return task;
  };

  return {
    /** The current copy. A stale remote file refreshes in the background. */
    get(name: ContentName): Record<string, unknown> {
      const value = load(name);
      if (remote && REMOTE.has(name) && now() - (checkedAt.get(name) ?? 0) >= CONTENT_REFRESH_MS) void refresh(name);
      return value;
    },
    /** Waits for a refresh (tests, and the first Live TV load). */
    async fresh(name: ContentName): Promise<Record<string, unknown>> {
      if (remote && REMOTE.has(name) && now() - (checkedAt.get(name) ?? 0) >= CONTENT_REFRESH_MS) await refresh(name);
      return load(name);
    },
    list<T>(name: ContentName): T[] {
      const value = this.get(name)[LIST_KEY[name]];
      return Array.isArray(value) ? (value as T[]) : [];
    },
  };
}

export type ContentService = ReturnType<typeof createContentService>;
