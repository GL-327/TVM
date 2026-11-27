import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatEngineLabel, runManualCoreUpdate } from './manualUpdate';

describe('manualUpdate', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('formats the engine label with version and short commit', () => {
    expect(formatEngineLabel({ current: '1.4.11', currentCommit: '2af8d1a9999999' }))
      .toBe('Engine v1.4.11 · build 2af8d1a');
    expect(formatEngineLabel({ current: '1.4.11', currentCommit: null })).toBe('Engine v1.4.11');
  });

  it('waits for a new Core even if the old process reports the target commit', async () => {
    vi.useFakeTimers();
    const progress: string[] = [];
    const calls: string[] = [];
    let statusCalls = 0;

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url === '/api/update/status') {
        statusCalls += 1;
        return new Response(JSON.stringify({
          current: '1.4.11',
          currentCommit: statusCalls === 2 ? '1111111' : '2222222',
          bootId: statusCalls <= 1 ? 'old-boot' : 'new-boot',
        }), { status: 200 });
      }
      if (url === '/api/update/check') {
        return new Response(JSON.stringify({
          current: '1.4.10',
          currentCommit: '1111111',
          bootId: 'old-boot',
          kind: 'available',
          available: { version: '1.4.11', commit: '2222222', notes: 'Fix' },
        }), { status: 200 });
      }
      if (url === '/api/update/apply') {
        return new Response(JSON.stringify({
          changed: true,
          version: '1.4.11',
          commit: '2222222',
          restart: 'self',
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const outcome = runManualCoreUpdate((msg) => progress.push(msg));
    await vi.runAllTimersAsync();
    const result = await outcome;
    expect(result.changed).toBe(true);
    expect(result.restarted).toBe(true);
    expect(result.status?.bootId).toBe('new-boot');
    expect(calls).toEqual(['POST /api/update/check', 'POST /api/update/apply', ...Array(3).fill('GET /api/update/status')]);
    expect(progress.length).toBeGreaterThanOrEqual(2);
  });

  it('shows a failed update lookup without trying to apply', async () => {
    const fetchMock = vi.fn(async () => Response.json({
      current: '1.4.11', available: null, kind: 'rate_limited', notice: 'Try again in a few minutes.',
    }));
    globalThis.fetch = fetchMock;
    await expect(runManualCoreUpdate()).resolves.toMatchObject({
      changed: false, reload: false, message: 'Try again in a few minutes.',
    });
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/update/check', { method: 'POST' });
  });

  it('leaves the page open while a Core restart is still pending', async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(async (url) => {
      const oldCore = { current: '1.4.11', currentCommit: '1111111', bootId: 'old-boot' };
      if (url === '/api/update/check') {
        return Response.json({ ...oldCore, available: { version: '2222222', commit: '2222222', notes: '' } });
      }
      if (url === '/api/update/apply') {
        return Response.json({ changed: true, commit: '2222222', restart: 'self' });
      }
      return Response.json(oldCore);
    });
    const outcome = runManualCoreUpdate();
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toMatchObject({ changed: true, restarted: false, reload: false });
  });

  it('does not treat a temporary outage and a staged legacy commit as a restart', async () => {
    vi.useFakeTimers();
    let checks = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (url === '/api/update/check') {
        return Response.json({ current: '1.4.11', available: { version: '2222222', commit: '2222222', notes: '' } });
      }
      if (url === '/api/update/apply') {
        return Response.json({ changed: true, commit: '2222222', restart: 'self' });
      }
      checks += 1;
      if (checks === 1) throw new TypeError('Connection dropped');
      return Response.json({ current: '1.4.11', currentCommit: '2222222' });
    });
    const outcome = runManualCoreUpdate();
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toMatchObject({ changed: true, restarted: false, reload: false });
  });
});
