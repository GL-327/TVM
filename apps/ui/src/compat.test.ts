import { expect, it, vi } from 'vitest';
import { combinedSignal } from './compat';
it('propagates cancellation once and removes listeners from other requests', () => {
  const first = new AbortController(); const second = new AbortController();
  const remove = vi.spyOn(second.signal, 'removeEventListener');
  const signal = combinedSignal([first.signal, second.signal]);
  first.abort('closed player');
  expect(signal.aborted).toBe(true);
  expect(signal.reason).toBe('closed player');
  expect(remove).toHaveBeenCalledOnce();
  expect(combinedSignal([first.signal]).aborted).toBe(true);
});
