import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYBACK_RESOLVE_TIMEOUT_MS, requestPlayback } from './media';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('playback resolution', () => {
  it('aborts pending work when the player closes', async () => {
    const cancel = new AbortController();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = requestPlayback({ id: 'tt123' }, cancel.signal);
    cancel.abort();
    await expect(pending).resolves.toEqual({ kind: 'unavailable', reason: 'network' });
    expect(fetchMock.mock.calls[0]![1].signal!.aborted).toBe(true);
  });

  it('returns an actionable timeout when resolution never finishes', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
    })));
    const pending = requestPlayback({ id: 'tt123' });
    deadline.abort(new DOMException('Timed out', 'TimeoutError'));
    await expect(pending).resolves.toEqual({ kind: 'unavailable', reason: 'timeout' });
    expect(timeout).toHaveBeenCalledWith(PLAYBACK_RESOLVE_TIMEOUT_MS);
  });

  it('rejects malformed streams and preserves provider authentication errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('{"kind":"stream"}'))
      .mockResolvedValueOnce(new Response('{"kind":"unavailable","reason":"needs-auth"}', { status: 409 })));
    await expect(requestPlayback({ id: 'tt123' })).resolves.toEqual({ kind: 'unavailable', reason: 'internal' });
    await expect(requestPlayback({ id: 'tt123' })).resolves.toEqual({ kind: 'unavailable', reason: 'needs-auth' });
  });
});
