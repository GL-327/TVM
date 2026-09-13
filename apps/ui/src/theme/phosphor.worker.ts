import { stylizePixels } from './phosphor';

/** Keep palette matching and per-pixel work away from remote input and animation. */
self.addEventListener('message', (event: MessageEvent<{
  id: number;
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}>) => {
  const { id, pixels, width, height } = event.data;
  try {
    const result = stylizePixels(pixels, width, height);
    self.postMessage({ id, pixels: result }, { transfer: [result.buffer] });
  } catch {
    self.postMessage({ id, pixels: null });
  }
});
