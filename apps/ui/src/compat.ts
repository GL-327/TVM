/** iOS 16 predates AbortSignal.any/timeout; keep request cancellation bounded there. */
export function combinedSignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const abort = (event: Event): void => {
    controller.abort((event.target as AbortSignal).reason);
    for (const signal of signals) signal.removeEventListener('abort', abort);
  };
  const aborted = signals.find((signal) => signal.aborted);
  if (aborted) controller.abort(aborted.reason);
  else for (const signal of signals) signal.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

if (typeof AbortSignal.any !== 'function') Object.defineProperty(AbortSignal, 'any', { configurable: true, value: combinedSignal });
if (typeof AbortSignal.timeout !== 'function') Object.defineProperty(AbortSignal, 'timeout', {
  configurable: true,
  value: (milliseconds: number): AbortSignal => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('The request timed out.', 'TimeoutError')), milliseconds);
    return controller.signal;
  },
});
