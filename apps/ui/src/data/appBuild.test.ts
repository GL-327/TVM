import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchAppBuild } from './appBuild';

function phone(): void {
  vi.stubGlobal('navigator', { userAgent: 'TVM-Android/1.0' });
}

function core(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  }));
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the app under the interface', () => {
  it('shortens the commit a phone reports', async () => {
    phone();
    core({ appBuild: '089c7ccb3f0a5d2e1c9b7a640f3e2d1c0b9a8f7e' });
    expect(await fetchAppBuild()).toEqual({ kind: 'known', build: '089c7cc' });
  });

  // The app this is meant to catch is the one too old to answer, so silence
  // from a phone has to count as old rather than as nothing.
  it('treats a phone that cannot say as old', async () => {
    phone();
    core({ appBuild: 'unknown' });
    expect(await fetchAppBuild()).toEqual({ kind: 'old' });
    core({ current: '1.0.0' });
    expect(await fetchAppBuild()).toEqual({ kind: 'old' });
    core({ error: 'not_found' }, 404);
    expect(await fetchAppBuild()).toEqual({ kind: 'old' });
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    expect(await fetchAppBuild()).toEqual({ kind: 'old' });
  });

  it('says nothing on the desktop, where both halves come from one checkout', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    core({ appBuild: '089c7cc' });
    expect(await fetchAppBuild()).toEqual({ kind: 'desktop' });
  });
});
