import { describe, expect, it } from 'vitest';
import { buildLensMap, lensGeometry, lensSupported } from './liquidLens';

function shiftAt(map: ReturnType<typeof buildLensMap>, x: number, y: number): [number, number] {
  const i = (y * map.width + x) * 4;
  return [((map.data[i] ?? 128) / 255 - 0.5) * map.scale, ((map.data[i + 1] ?? 128) / 255 - 0.5) * map.scale];
}

describe('Liquid Glass lens', () => {
  it('sizes the bezel and rim shift like the native capsule', () => {
    // The 64px navigation capsule: a 16px bezel and a 28px rim shift.
    expect(lensGeometry(760, 64)).toEqual({ bevel: 16, amount: 28 });
    // Sheets cap the bezel at 24px.
    expect(lensGeometry(400, 300).bevel).toBe(24);
    // Never past the middle.
    expect(lensGeometry(20, 20).amount).toBeLessThanOrEqual(9);
  });

  it('leaves the middle undistorted and pulls the rim inward', () => {
    const map = buildLensMap(200, 64, 32);
    const [mx, my] = shiftAt(map, 100, 32);
    expect(Math.abs(mx)).toBeLessThan(0.5);
    expect(Math.abs(my)).toBeLessThan(0.5);
    // The top rim samples downward (inward), strongly.
    const [, topY] = shiftAt(map, 100, 0);
    expect(topY).toBeGreaterThan(10);
    // The bottom rim samples upward.
    const [, bottomY] = shiftAt(map, 100, 63);
    expect(bottomY).toBeLessThan(-10);
    // The left cap samples rightward.
    const [leftX] = shiftAt(map, 1, 32);
    expect(leftX).toBeGreaterThan(10);
  });

  it('refracts only where backdrop SVG filters work', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const webView = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36';
    const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';
    const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
    expect(lensSupported(chrome)).toBe(true);
    expect(lensSupported(webView)).toBe(true);
    expect(lensSupported(safari)).toBe(false);
    expect(lensSupported(iosChrome)).toBe(false);
    expect(lensSupported(firefox)).toBe(false);
  });
});
