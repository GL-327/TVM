import { describe, expect, it } from 'vitest';
import { fallbackApps, isMockApp } from './apps';

describe('mock apps', () => {
  it('treats the seven streamers as in-app mocks', () => {
    expect(isMockApp('netflix')).toBe(true);
    expect(isMockApp('prime')).toBe(true);
    expect(isMockApp('max')).toBe(true);
    expect(isMockApp('appletv')).toBe(true);
    expect(isMockApp('disney')).toBe(true);
    expect(isMockApp('hulu')).toBe(true);
    expect(isMockApp('peacock')).toBe(true);
    expect(isMockApp('youtube')).toBe(false);
    expect(isMockApp('freevee')).toBe(false);
  });

  it('puts Peacock at the end of the ribbon after HBO Max and Apple TV', () => {
    const ids = fallbackApps().ribbon.map((app) => app.id);
    expect(ids).toEqual(['tvm-stream', 'netflix', 'prime', 'max', 'appletv', 'disney', 'hulu', 'peacock']);
  });
});
