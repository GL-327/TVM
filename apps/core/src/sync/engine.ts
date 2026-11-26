import { join } from 'node:path';
import { AccountsError } from '../providers/remoteAccounts.ts';
import { readSealed, writeSealed } from '../providers/vault.ts';
import { mergeRemote, observeLocal, type SyncLedger } from './merge.ts';
import { MAX_ITEMS, MAX_VALUE_BYTES, parseSyncItem, syncValueBytes, type SyncItem } from './schema.ts';
import { applyItems, itemId, snapshot } from './stores.ts';
import { watchSyncStores } from './storeEvents.ts';

export interface SyncTransport {
  getSyncPage(token: string, query: URLSearchParams, generation: string | null): Promise<{ body: unknown; generation: string | null }>;
  putSyncItems(token: string, items: SyncItem[], generation: string): Promise<void>;
}

export interface SyncStatus { enabled: boolean; lastSyncAt: number | null; pending: number; error: string | null }

export const SYNC_DISABLED: SyncStatus = { enabled: false, lastSyncAt: null, pending: 0, error: null };
const PULL_MS = 60_000;
const DEBOUNCE_MS = 3_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const MAX_PAGES = 201;

interface Checkpoint extends SyncLedger {
  since: number;
  generation: string | null;
  lastSyncAt: number | null;
}

interface State extends Checkpoint {
  applying?: { items: SyncItem[]; checkpoint: Checkpoint };
}

function pullPage(body: unknown, now: number) {
  const page = body as { items?: unknown[]; now?: number; nextCursor?: string } | null;
  if (!page || !Array.isArray(page.items) || page.items.length > 100
    || !Number.isSafeInteger(page.now) || page.now! < 0
    || (page.nextCursor !== undefined && (typeof page.nextCursor !== 'string' || !page.items.length || page.nextCursor.length > 750))) {
    throw new AccountsError(503);
  }
  const items = page.items.map(raw => {
    const item = parseSyncItem(raw, Math.max(now, page.now!));
    if (!item || syncValueBytes(item.value) > MAX_VALUE_BYTES) throw new AccountsError(503);
    return item;
  });
  return { items, now: page.now!, cursor: page.nextCursor };
}

export function createSyncEngine(options: {
  directory: string;
  legacy?: string;
  reloadProfiles: () => void;
  transport: SyncTransport;
  sessionRejected: (token: string) => void;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const { directory, transport } = options;
  const path = join(directory, 'ledger.enc');
  let state: State = readSealed<State>(directory, path) ?? {
    versions: {}, pending: {}, since: 0, generation: null, lastSyncAt: null,
  };
  let token: string | undefined;
  let generation = 0;
  let job: Promise<void> | undefined;
  let timer: NodeJS.Timeout | undefined;
  let disabled = false;
  let stopped = false;
  let dirty = true;
  let legacy = state.generation === null && !Object.keys(state.versions).length ? options.legacy : undefined;
  let changeDue = Infinity;
  let pullDue = Infinity;
  let retryAt = 0;
  let failures = 0;
  let error: string | null = null;

  const save = (next: State): void => {
    writeSealed(directory, path, next);
    state = next;
  };

  function finishApplication(): void {
    const staged = state.applying;
    if (!staged) return;
    applyItems(directory, staged.items, options.reloadProfiles);
    save(staged.checkpoint);
  }

  function capture(): void {
    finishApplication();
    if (!dirty) return;
    const current = now();
    const known = new Set(Object.entries(state.versions)
      .filter(([id, version]) => id.startsWith('profile:') && version.hash !== null).map(([id]) => id.slice(8)));
    const local = snapshot(directory, current, legacy, known);
    const observed = { ...state, versions: { ...state.versions }, pending: { ...state.pending } };
    if (observeLocal(observed, local, current)) save(observed);
    legacy = undefined;
    dirty = false;
  }

  function schedule(): void {
    clearTimeout(timer);
    if (stopped || disabled || !token || job) return;
    const at = Math.max(retryAt, Math.min(changeDue, pullDue));
    if (!Number.isFinite(at)) return;
    timer = setTimeout(() => { void run(); }, Math.max(0, at - now()));
    timer.unref();
  }

  const unwatch = watchSyncStores(directory, () => {
    dirty = true;
    changeDue = now() + DEBOUNCE_MS;
    schedule();
  });

  async function pull(session: string, current: () => boolean): Promise<void> {
    let match = state.generation;
    let since = state.since;
    let reset = false;
    const incoming = new Map<string, SyncItem>();
    let cursor: string | undefined;
    let watermark: number | undefined;
    let more = true;
    for (let count = 0; count < MAX_PAGES && more; count++) {
      const query = new URLSearchParams({ since: String(since) });
      if (cursor !== undefined) query.set('cursor', cursor);
      let raw: Awaited<ReturnType<SyncTransport['getSyncPage']>>;
      try {
        raw = await transport.getSyncPage(session, query, match);
      } catch (failure) {
        if (!current()) return;
        if (!(failure instanceof AccountsError) || failure.status !== 412 || !match || reset) throw failure;
        match = null;
        since = 0;
        cursor = undefined;
        watermark = undefined;
        incoming.clear();
        reset = true;
        continue;
      }
      if (!current()) return;
      const page = pullPage(raw.body, now());
      if (!raw.generation || !/^"\d+"$/.test(raw.generation) || (match !== null && raw.generation !== match)
        || (watermark !== undefined && page.now !== watermark) || page.now < since || (cursor && page.cursor === cursor)) {
        throw new AccountsError(503);
      }
      match = raw.generation;
      watermark = page.now;
      cursor = page.cursor;
      more = cursor !== undefined;
      for (const item of page.items) incoming.set(itemId(item), item);
    }
    if (more || watermark === undefined) throw new AccountsError(503);

    capture();
    const next: Checkpoint = {
      lastSyncAt: state.lastSyncAt, since: watermark, generation: match,
      versions: { ...state.versions }, pending: reset ? {} : { ...state.pending },
    };
    if (reset) {
      // The dashboard clears cloud data only. Keep the device's current view and forget
      // writes from the old generation so an offline queue cannot re-create erased data.
      for (const [id, version] of Object.entries(next.versions)) next.versions[id] = { ...version, updatedAt: -1 };
    }
    const changes = mergeRemote(next, [...incoming.values()]);
    if (changes.length) {
      save({ ...state, applying: { items: changes, checkpoint: next } });
      finishApplication();
    } else if (incoming.size || reset || state.since !== next.since || state.generation !== match) save(next);
  }

  function run(force = false): Promise<void> {
    if (!token || disabled || stopped) return Promise.resolve();
    // An explicit retry that arrives during another session's request waits for it to settle.
    if (job) return force ? job.then(() => (pullDue <= now() || dirty || Object.keys(state.pending).length > 0) ? run(true) : undefined) : job;
    if (!force && now() < retryAt) { schedule(); return Promise.resolve(); }
    const session = token;
    const epoch = generation;
    const current = () => !stopped && generation === epoch;
    const task = Promise.resolve().then(async () => {
      capture();
      await pull(session, current);
      if (!current()) return;
      if (changeDue <= now()) changeDue = Infinity;
      if (force || changeDue === Infinity) {
        const queue = Object.values(state.pending);
        for (let offset = 0; offset < queue.length; offset += MAX_ITEMS) {
          const batch = queue.slice(offset, offset + MAX_ITEMS);
          await transport.putSyncItems(session, batch, state.generation!);
          if (!current()) return;
          capture();
          const next = { ...state, pending: { ...state.pending } };
          for (const item of batch) {
            const key = itemId(item);
            if (next.pending[key]?.updatedAt === item.updatedAt) delete next.pending[key];
          }
          save(next);
        }
        // Read back the authoritative winners, including another client racing with this upload.
        if (queue.length) await pull(session, current);
      }
      if (!current()) return;
      if (changeDue <= now() && !Object.keys(state.pending).length) changeDue = Infinity;
      const at = now();
      save({ ...state, lastSyncAt: at });
      pullDue = at + PULL_MS;
      failures = 0;
      retryAt = 0;
      error = null;
    }).catch((failure: unknown) => {
      if (!current()) return;
      if (failure instanceof AccountsError && failure.status === 404) {
        disabled = true;
        error = null;
        return;
      }
      if (failure instanceof AccountsError && failure.status === 401) {
        options.sessionRejected(session);
        return;
      }
      const seconds = failure instanceof AccountsError ? Number(failure.retryAfter) : 0;
      const delay = Math.min(BACKOFF_MAX_MS, 5_000 * 2 ** Math.min(6, failures++));
      retryAt = now() + Math.max(delay, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0);
      pullDue = Math.min(pullDue, now());
      error = failure instanceof AccountsError && failure.status === 409
        ? 'Synced data is full.' : 'Account data could not sync.';
    }).finally(() => {
      if (job === task) job = undefined;
      schedule();
    });
    job = task;
    return task;
  }

  return {
    attach(session: string, signingIn = false): void {
      if (session === token && !signingIn) return;
      token = session;
      generation++;
      try { capture(); } catch { error = 'Account data could not sync.'; }
      if (signingIn) {
        disabled = false;
        failures = 0;
        retryAt = 0;
        error = null;
      }
      pullDue = now();
      schedule();
    },
    detach(session: string): void {
      if (token !== session) return;
      token = undefined;
      generation++;
      clearTimeout(timer);
    },
    status(): SyncStatus {
      if (!token || disabled || stopped) return SYNC_DISABLED;
      try { capture(); } catch { error = 'Account data could not sync.'; }
      return { enabled: true, pending: Object.keys(state.pending).length, lastSyncAt: state.lastSyncAt, error };
    },
    async syncNow(): Promise<SyncStatus> {
      await run(true);
      return this.status();
    },
    close(): void {
      stopped = true;
      token = undefined;
      clearTimeout(timer);
      unwatch();
    },
  };
}
