import { describe, expect, it } from 'vitest';
import { createDevUnlockService } from './devUnlock.ts';
describe('retired developer unlock', () => {
  it('cannot unlock with a code and has no persistent authority', () => {
    const service = createDevUnlockService({ dataDir: 'unused' });
    expect(service.unlock('any code')).toBe(false);
    expect(service.unlocked()).toBe(false);
    service.grant();
    expect(createDevUnlockService({ dataDir: 'unused' }).unlocked()).toBe(false);
    service.lock();
    expect(service.unlocked()).toBe(false);
  });
});
