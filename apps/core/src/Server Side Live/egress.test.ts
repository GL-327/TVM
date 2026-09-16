import { describe, expect, it } from 'vitest';
import { checkEgress, expectsEgressProxy } from './egress.ts';

const echoes = ['https://echo.one', 'https://echo.two'];

function replying(map: Record<string, { body: string; status?: number } | 'throw'>): typeof fetch {
  return (async (input: unknown) => {
    const route = map[String(input)];
    if (route === undefined || route === 'throw') throw new Error('network');
    return new Response(route.body, { status: route.status ?? 200 });
  }) as unknown as typeof fetch;
}

describe('proving where Core comes out', () => {
  it('reports the address the world sees', async () => {
    const report = await checkEgress({
      env: {},
      echoes,
      fetchImpl: replying({ 'https://echo.one': { body: '203.0.113.7\n' } }),
    });
    expect(report.ok).toBe(true);
    expect(report.ip).toBe('203.0.113.7');
    expect(report.expectsProxy).toBe(false);
  });

  it('moves on when an echo service is down rather than reporting a false leak', async () => {
    const report = await checkEgress({
      env: {},
      echoes,
      fetchImpl: replying({ 'https://echo.one': 'throw', 'https://echo.two': { body: '198.51.100.9' } }),
    });
    expect(report.ok).toBe(true);
    expect(report.ip).toBe('198.51.100.9');
  });

  /*
   * The single most important behaviour here.
   *
   * With the tunnel down the check must fail. If it ever answered with the
   * friend's own address instead, the kill switch would not be working and
   * every provider request would be going out in the clear — while the app
   * carried on looking perfectly healthy.
   */
  it('fails when nothing can get out, rather than falling back', async () => {
    const report = await checkEgress({
      env: { TVM_LIVE_EGRESS_PROXY: 'http://127.0.0.1:8888' },
      echoes,
      fetchImpl: replying({ 'https://echo.one': 'throw', 'https://echo.two': 'throw' }),
    });
    expect(report.ok).toBe(false);
    expect(report.ip).toBeNull();
    expect(report.reason).toBe('egress_unreachable');
    // And it says the configuration intended a tunnel, so a reader can tell
    // a broken tunnel from a box that never had one.
    expect(report.expectsProxy).toBe(true);
  });

  it('ignores a body that is not an address, so a captive portal is not mistaken for egress', async () => {
    const report = await checkEgress({
      env: {},
      echoes,
      fetchImpl: replying({
        'https://echo.one': { body: '<html>Sign in to continue</html>' },
        'https://echo.two': { body: '203.0.113.7' },
      }),
    });
    expect(report.ip).toBe('203.0.113.7');
  });

  it('knows when a tunnel was supposed to be in use', () => {
    expect(expectsEgressProxy({})).toBe(false);
    expect(expectsEgressProxy({ HTTPS_PROXY: 'http://127.0.0.1:8888' })).toBe(true);
    expect(expectsEgressProxy({ TVM_LIVE_EGRESS_PROXY: 'http://127.0.0.1:8888' })).toBe(true);
    expect(expectsEgressProxy({ HTTPS_PROXY: '   ' })).toBe(false);
  });
});
