import { describe, expect, it } from 'vitest';
import { isMobileClient, mobilePlanAllowed } from './mobileAccess';
describe('mobile plans', () => {
  it('requires Basic or above and at least Full HD, including DEV overrides', () => {
    expect(mobilePlanAllowed({ id: 'free', maxHeight: 720 })).toBe(false);
    expect(mobilePlanAllowed({ id: 'free', maxHeight: 2160 })).toBe(false);
    for (const id of ['basic', 'premium', 'ultra', 'max'] as const) {
      expect(mobilePlanAllowed({ id, maxHeight: 1080 })).toBe(true);
      expect(mobilePlanAllowed({ id, maxHeight: 720 })).toBe(false);
    }
  });
  it('detects native shells and phones without treating a narrow PC as mobile', () => {
    for (const ua of ['TVM-iOS', 'TVM-Android', 'Mozilla iPhone', 'Mozilla iPad', 'Android 15']) expect(isMobileClient(ua)).toBe(true);
    expect(isMobileClient('Mozilla Windows NT 10.0')).toBe(false);
  });
});
