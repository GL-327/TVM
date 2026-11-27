import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatEngineLabel, runManualCoreUpdate } from './manualUpdate';

describe('manualUpdate', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('formats the engine label with version and short commit', () => {
    expect(formatEngineLabel({ current: '1.4.11', currentCommit: '2af8d1a9999999' }))
      .toBe('Engine v1.4.11 · build 2af8d1a');
    expect(formatEngineLabel({ current: '1.4.11', currentCommit: null })).toBe('Engine v1.4.11');
  });

  it('runs check, apply, and waits for restart when Core restarts itself', async () => {
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
          currentCommit: statusCalls === 1 ? '1111111' : '2222222',
        }), { status: 200 });
      }
      if (url === '/api/update/check') {
        return new Response(JSON.stringify({
          current: '1.4.10',
          currentCommit: '1111111',
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

    const result = await runManualCoreUpdate((msg) => progress.push(msg));
    expect(result.changed).toBe(true);
    expect(result.restarted).toBe(true);
    expect(calls[0]).toBe('GET /api/update/status');
    expect(calls[1]).toBe('POST /api/update/check');
    expect(calls[2]).toBe('POST /api/update/apply');
    expect(calls[3]).toBe('GET /api/update/status');
    expect(progress.length).toBeGreaterThanOrEqual(2);
  });
});
