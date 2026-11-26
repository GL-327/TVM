import { apiFetch, currentProfileId } from './media';
import { readToken } from './sessionToken';

export interface DownloadJob {
  id: string; title: string; state: 'queued' | 'resolving' | 'downloading' | 'complete' | 'failed' | 'cancelled';
  bytes: number; total: number; path?: string; error?: string;
}
export interface DownloadRequest {
  directory: string; items: Array<{ id: string; title: string }>;
  preferences: { language: string; maxHeight: number }; headers?: Record<string, string>;
}
export interface DownloadBridge {
  chooseFolder(): Promise<string | null>;
  /** The folder already chosen (kept across visits), when the bridge remembers one. */
  currentFolder?(): Promise<string | null>;
  list(): Promise<DownloadJob[]>;
  enqueue(input: DownloadRequest): Promise<DownloadJob[]>;
  cancel(id: string): Promise<void>;
  show(id: string): Promise<void>;
  onChanged(listener: () => void): () => void;
}

interface FolderHandle {
  name: string;
  getFileHandle(name: string, options?: { create: boolean }): Promise<{
    createWritable(): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void> }>;
  }>;
  removeEntry(name: string): Promise<void>;
}

const subscribers = new Set<() => void>();
const jobs: DownloadJob[] = [];
const aborts = new Map<string, AbortController>();
let folder: FolderHandle | null = null;
let queue = Promise.resolve();
const changed = (): void => { subscribers.forEach((listener) => listener()); };

async function browserDownload(job: DownloadJob, item: DownloadRequest['items'][number], preferences: DownloadRequest['preferences'], directory: FolderHandle, headers: Record<string, string>, abort: AbortController): Promise<void> {
  let writable: Awaited<ReturnType<Awaited<ReturnType<FolderHandle['getFileHandle']>>['createWritable']>> | undefined;
  let createdName: string | undefined;
  try {
    abort.signal.throwIfAborted();
    job.state = 'resolving'; changed();
    const resolution = await apiFetch('/api/downloads/resolve', {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ id: item.id, preferences }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(90_000)]),
    });
    const source = await resolution.json() as { browserUrl?: string; filename?: string; error?: string };
    if (!resolution.ok || !source.browserUrl?.startsWith('/api/stream/direct/')) throw new Error(source.error || 'No downloadable file was found.');
    const response = await apiFetch(source.browserUrl, { headers, signal: abort.signal });
    if (!response.ok || !response.body) throw new Error('The file could not be downloaded.');
    const ext = source.filename?.match(/\.(mp4|mkv|webm|m4v|mov|avi|ts|mpg|mpeg)$/i)?.[0] ?? '.mkv';
    const stem = item.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 140) || 'TVM video';
    let name = `${stem} [${preferences.language}]${ext}`;
    for (let index = 1; ; index += 1) {
      try { await directory.getFileHandle(name); }
      catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
        break;
      }
      name = `${stem} [${preferences.language}] (${index + 1})${ext}`;
    }
    const file = await directory.getFileHandle(name, { create: true });
    createdName = name;
    writable = await file.createWritable();
    job.state = 'downloading'; job.total = Number(response.headers.get('content-length')) || 0; changed();
    const reader = response.body.getReader();
    let lastUpdate = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      await writable.write(value);
      job.bytes += value.byteLength;
      if (Date.now() - lastUpdate > 250) { lastUpdate = Date.now(); changed(); }
    }
    abort.signal.throwIfAborted();
    if (job.bytes === 0 || (job.total > 0 && job.bytes !== job.total)) throw new Error('The file was incomplete. Retry this download.');
    await writable.close(); writable = undefined;
    job.path = `${directory.name}/${name}`; job.state = 'complete';
  } catch (error) {
    await writable?.abort().catch(() => undefined);
    if (createdName) await directory.removeEntry(createdName).catch(() => undefined);
    job.state = abort.signal.aborted ? 'cancelled' : 'failed';
    job.error = abort.signal.aborted ? undefined : error instanceof Error ? error.message : 'Download failed.';
  } finally { aborts.delete(job.id); changed(); }
}

/**
 * The Android app downloads natively: its own core picks the folder with the
 * system picker and writes the files (it has no showDirectoryPicker). The
 * Android shell sets this flag; nothing else does.
 */
function nativeDownloads(): boolean {
  return (window as Window & { tvmNativeDownloads?: boolean }).tvmNativeDownloads === true;
}

export function downloadsAvailable(): boolean {
  return nativeDownloads() || 'showDirectoryPicker' in window;
}

async function coreJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, { ...init, headers: { ...downloadHeaders(), 'content-type': 'application/json' } });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'Downloads are unavailable right now.');
  return body;
}

/** The Android app's own downloads: folder, queue and files are kept by its core. */
const coreBridge: DownloadBridge = {
  async chooseFolder() {
    const body = await coreJson<{ name?: string; cancelled?: boolean }>('/api/downloads/folder', { method: 'POST', signal: AbortSignal.timeout(10 * 60_000) });
    return body.cancelled ? null : body.name ?? null;
  },
  async currentFolder() {
    return (await coreJson<{ name?: string | null }>('/api/downloads/folder')).name ?? null;
  },
  async list() { return (await coreJson<{ jobs?: DownloadJob[] }>('/api/downloads')).jobs ?? []; },
  async enqueue(input) {
    return (await coreJson<{ jobs?: DownloadJob[] }>('/api/downloads', { method: 'POST', body: JSON.stringify({ items: input.items, preferences: input.preferences }) })).jobs ?? [];
  },
  async cancel(id) { await coreJson(`/api/downloads/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); coreChanged(); },
  async show() {},
  onChanged(listener) {
    // The core does the work; while anyone is watching, it is asked how it is going.
    coreSubscribers.add(listener);
    if (corePoll === null) corePoll = setInterval(coreChanged, 1000);
    return () => {
      coreSubscribers.delete(listener);
      if (coreSubscribers.size === 0 && corePoll !== null) { clearInterval(corePoll); corePoll = null; }
    };
  },
};
const coreSubscribers = new Set<() => void>();
let corePoll: ReturnType<typeof setInterval> | null = null;
const coreChanged = (): void => { coreSubscribers.forEach((listener) => listener()); };

const browserBridge: DownloadBridge = {
  async currentFolder() { return folder?.name ?? null; },
  async chooseFolder() {
    const picker = (window as unknown as { showDirectoryPicker?: (options: { mode: string; id: string }) => Promise<FolderHandle> }).showDirectoryPicker;
    if (!picker) throw new Error('Open TVM Desktop, Chrome or Edge to choose a download folder.');
    try { folder = await picker({ mode: 'readwrite', id: 'tvm-downloads' }); return folder.name; }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return null; throw error; }
  },
  list: async () => jobs.map((job) => ({ ...job })),
  async enqueue(input) {
    const directory = folder;
    if (!directory) throw new Error('Choose a download folder first.');
    if (aborts.size + input.items.length > 1000) throw new Error('The download queue is full.');
    const headers = downloadHeaders();
    for (const item of input.items) {
      const job: DownloadJob = { id: crypto.randomUUID(), title: item.title, state: 'queued', bytes: 0, total: 0 };
      const abort = new AbortController(); jobs.push(job); aborts.set(job.id, abort);
      queue = queue.then(() => browserDownload(job, item, input.preferences, directory, headers, abort));
    }
    changed(); return this.list();
  },
  async cancel(id) { aborts.get(id)?.abort(); const job = jobs.find((job) => job.id === id); if (job && aborts.has(id)) job.state = 'cancelled'; changed(); },
  async show() {},
  onChanged(listener) { subscribers.add(listener); return () => subscribers.delete(listener); },
};

export const downloadBridge = (): DownloadBridge => (nativeDownloads() ? coreBridge : browserBridge);
export function downloadHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'X-TVM-Profile': currentProfileId() };
  const token = readToken(); if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}
