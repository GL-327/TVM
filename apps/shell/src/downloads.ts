import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface DownloadItem { id: string; title: string }
export interface DownloadRequest {
  directory: string;
  items: DownloadItem[];
  preferences: { language: string; maxHeight: number };
  headers?: Record<string, string>;
}
export interface DownloadJob {
  id: string; title: string; state: 'queued' | 'resolving' | 'downloading' | 'complete' | 'failed' | 'cancelled';
  bytes: number; total: number; path?: string; error?: string;
}

export function safeDownloadName(name: string): string {
  const safe = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 150);
  return safe === '' || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe) ? `TVM-${safe || 'video'}` : safe;
}

/** Exclusive reservation means even matching episode names never replace user files. */
export async function reserveDownloadPath(directory: string, filename: string): Promise<string> {
  await mkdir(directory, { recursive: true });
  const extension = extname(filename);
  const stem = basename(filename, extension);
  for (let index = 0; index < 10_000; index += 1) {
    const target = join(directory, `${stem}${index === 0 ? '' : ` (${index + 1})`}${extension}`);
    try {
      const handle = await open(target, 'wx');
      await handle.close();
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Too many files with the same name in this folder.');
}

export function createDownloadQueue(apiOrigin: string, fetchApi: typeof fetch, changed: () => void) {
  const jobs: DownloadJob[] = [];
  const pending: Array<{ job: DownloadJob; request: DownloadRequest; item: DownloadItem; abort: AbortController }> = [];
  const controllers = new Map<string, AbortController>();
  let running = false;

  const processQueue = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      while (pending.length > 0) {
        const entry = pending.shift()!;
        const { job, request, item, abort } = entry;
        if (abort.signal.aborted) { controllers.delete(job.id); continue; }
        let target: string | undefined;
        let partial: string | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          job.state = 'resolving'; changed();
          const resolution = await fetchApi(new URL('/api/downloads/resolve', apiOrigin).href, {
            method: 'POST', headers: { ...request.headers, 'content-type': 'application/json' },
            body: JSON.stringify({ id: item.id, preferences: request.preferences }),
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)]),
          });
          const source = await resolution.json() as { url?: string; filename?: string; error?: string };
          if (!resolution.ok || !source.url) throw new Error(source.error || 'This file could not be prepared.');
          const url = new URL(source.url);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid download source.');
          const touch = (): void => {
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => abort.abort(new Error('The source stopped sending data. Retry this download.')), 60_000);
          };
          touch();
          // Account headers belong only to Core, never to the media host.
          const response = await fetchApi(url.href, { signal: abort.signal });
          if (!response.ok || !response.body) throw new Error(`The source could not be downloaded (${response.status}).`);
          if (/text\/html|json|mpegurl/i.test(response.headers.get('content-type') ?? '')) throw new Error('The source returned a page instead of a video file.');
          const extension = extname((source.filename ?? '').split('?')[0]!).toLowerCase();
          const ext = /^\.(mp4|mkv|webm|m4v|mov|avi|ts|mpg|mpeg)$/i.test(extension) ? extension : '.mkv';
          const filename = `${safeDownloadName(item.title)} [${request.preferences.language}]${ext}`;
          target = await reserveDownloadPath(request.directory, filename);
          partial = `${target}.${job.id}.part`;
          job.path = target;
          job.state = 'downloading';
          job.total = Number(response.headers.get('content-length')) || 0;
          changed();
          let lastUpdate = 0;
          const progress = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            touch();
            job.bytes += chunk.length;
            if (Date.now() - lastUpdate > 250) { lastUpdate = Date.now(); changed(); }
            callback(null, chunk);
          } });
          await pipeline(Readable.fromWeb(response.body as never), progress, createWriteStream(partial, { flags: 'wx' }), { signal: abort.signal });
          if (job.bytes === 0 || (job.total > 0 && job.bytes !== job.total)) throw new Error('The file was incomplete. Retry this download.');
          await rename(partial, target);
          job.state = 'complete';
        } catch (error) {
          const cancelled = abort.signal.aborted && !(abort.signal.reason instanceof Error && abort.signal.reason.message.includes('stopped sending'));
          job.state = cancelled ? 'cancelled' : 'failed';
          job.error = cancelled ? undefined : error instanceof Error ? error.message : 'Download failed.';
          if (partial) await unlink(partial).catch(() => undefined);
          if (target) await unlink(target).catch(() => undefined);
          delete job.path;
        } finally {
          if (idleTimer) clearTimeout(idleTimer);
          controllers.delete(job.id);
          changed();
        }
      }
    } finally { running = false; }
  };

  return {
    list: (): DownloadJob[] => jobs.map((job) => ({ ...job })),
    enqueue(request: DownloadRequest): DownloadJob[] {
      if (jobs.filter((job) => controllers.has(job.id)).length + request.items.length > 1000) throw new Error('The download queue is full.');
      for (const item of request.items) {
        const job: DownloadJob = { id: randomUUID(), title: item.title, state: 'queued', bytes: 0, total: 0 };
        const abort = new AbortController();
        jobs.push(job); controllers.set(job.id, abort);
        pending.push({ job, request, item, abort });
      }
      changed(); void processQueue();
      return this.list();
    },
    cancel(id: string): void {
      const job = jobs.find((entry) => entry.id === id);
      if (!job || !controllers.has(id)) return;
      job.state = 'cancelled'; controllers.get(id)?.abort(); changed();
    },
    stop(): void { for (const controller of controllers.values()) controller.abort(); },
  };
}
