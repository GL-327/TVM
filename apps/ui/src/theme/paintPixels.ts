import { stylizePixels } from './phosphor';

let worker: Worker | undefined;
let unavailable = false;
let sequence = 0;
const pending = new Map<number, (pixels: Uint8ClampedArray | null) => void>();

function stopWorker(): void {
  unavailable = true;
  worker?.terminate();
  worker = undefined;
  for (const finish of [...pending.values()]) finish(null);
}

function getWorker(): Worker | undefined {
  if (unavailable || typeof Worker === 'undefined') return undefined;
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./phosphor.worker.ts', import.meta.url), { type: 'module', name: 'tvm-artwork' });
    worker.onmessage = (event: MessageEvent<{ id: number; pixels: Uint8ClampedArray | null }>) => {
      pending.get(event.data.id)?.(event.data.pixels);
    };
    worker.onerror = (event) => { event.preventDefault(); stopWorker(); };
    worker.onmessageerror = stopWorker;
    return worker;
  } catch {
    stopWorker();
    return undefined;
  }
}

/** At most two calls reach here, bounded by stylizeArt's decode slots. */
export async function paintPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  signal: AbortSignal,
): Promise<Uint8ClampedArray> {
  signal.throwIfAborted();
  const painter = getWorker();
  if (painter !== undefined) {
    const result = await new Promise<Uint8ClampedArray | null>((resolve) => {
      const id = ++sequence;
      const finish = (value: Uint8ClampedArray | null): void => {
        pending.delete(id);
        clearTimeout(watchdog);
        signal.removeEventListener('abort', abort);
        resolve(value);
      };
      const abort = (): void => finish(null);
      const watchdog = setTimeout(stopWorker, 4000);
      pending.set(id, finish);
      signal.addEventListener('abort', abort, { once: true });
      // Preserve the source for the fallback if this device blocks workers.
      const transfer = new Uint8ClampedArray(pixels);
      try {
        painter.postMessage({ id, pixels: transfer, width, height }, [transfer.buffer]);
      } catch {
        stopWorker();
      }
    });
    signal.throwIfAborted();
    if (result !== null) return result;
  }
  // Give navigation a task boundary even on older WebViews without workers.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal.throwIfAborted();
  return stylizePixels(pixels, width, height);
}
