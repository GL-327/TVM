import { describe, expect, it } from 'vitest';
import { formatDiagnostics, isCacheKey } from './devTools';

describe('developer tools', () => {
  it('formats the diagnostics block', () => {
    const text = formatDiagnostics({ version: '1.4.8', commit: 'abc1234', userAgent: 'UA', viewport: '1280 x 720 @1x', fps: 60 });
    expect(text.split('\n')).toEqual(['TVM 1.4.8', 'Commit: abc1234', 'User agent: UA', 'Viewport: 1280 x 720 @1x', 'FPS: 60']);
  });

  it('says so when FPS was not measured', () => {
    expect(formatDiagnostics({ version: '1', commit: 'x', userAgent: 'u', viewport: 'v', fps: null })).toContain('FPS: not measured');
  });

  it('only treats cached copies as caches', () => {
    expect(isCacheKey('tvm.content.events')).toBe(true);
    expect(isCacheKey('tvm.cache.home')).toBe(true);
    expect(isCacheKey('tvm.profiles')).toBe(false);
    expect(isCacheKey('tvm.changelog.seen')).toBe(false);
  });
});
