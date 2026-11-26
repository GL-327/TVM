import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SelectionDroplet } from './SelectionDroplet';
import {
  buildLensMap,
  getLensCacheSize,
  lensGeometry,
  lensSupported,
} from './liquidLens';

function shiftAt(map: ReturnType<typeof buildLensMap>, x: number, y: number): [number, number] {
  const i = (y * map.width + x) * 4;
  return [((map.data[i] ?? 128) / 255 - 0.5) * map.scale, ((map.data[i + 1] ?? 128) / 255 - 0.5) * map.scale];
}

describe('Liquid Glass lens (spec 3.1)', () => {
  it('sizes the convex bezel to ~12-18px, max 22% of the short side, like the native renderer', () => {
    // 64px height bar: 22% of 64px = 14.08px bezel (~12-18px range), 27.456px inward rim shift.
    const bar = lensGeometry(760, 64);
    expect(bar.bevel).toBeCloseTo(14.08, 2);
    expect(bar.bevel).toBeGreaterThanOrEqual(12);
    expect(bar.bevel).toBeLessThanOrEqual(18);
    expect(bar.amount).toBeCloseTo(14.08 * 1.95, 2);

    // Large sheets cap the bezel at 18px (never more than 22% of the short side).
    expect(lensGeometry(400, 300).bevel).toBe(18);
    expect(lensGeometry(120, 60).bevel).toBeCloseTo(13.2, 2);

    // Compact controls never exceed 22% of their short side or sample past the middle.
    const small = lensGeometry(20, 20);
    expect(small.bevel).toBeLessThanOrEqual(10);
    expect(small.amount).toBeLessThanOrEqual(9);
  });

  it('leaves the middle undistorted and pulls the rim strongly inward with smooth corner normals', () => {
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
    // Scale is 2 * amount.
    expect(map.scale).toBeCloseTo(2 * lensGeometry(200, 64).amount, 2);
    expect(getLensCacheSize()).toBeGreaterThanOrEqual(0);
  });

  it('refracts only where backdrop SVG filters work', () => {
    const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
    const webView = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0 Mobile Safari/537.36';
    const safari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    const iosChrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0 Mobile/15E148 Safari/604.1';
    const ipadSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
    const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
    expect(lensSupported(chrome)).toBe(true);
    expect(lensSupported(webView)).toBe(true);
    expect(lensSupported(safari)).toBe(false);
    expect(lensSupported(iosChrome)).toBe(false);
    expect(lensSupported(ipadSafari, 5)).toBe(false);
    expect(lensSupported(firefox)).toBe(false);
  });

  it('renders SelectionDroplet thumb markup cleanly even when parent track ref starts null', () => {
    const track = createRef<HTMLElement>();
    const html = renderToStaticMarkup(
      createElement(SelectionDroplet, {
        track,
        selected: 'home-dock',
        className: 'polish-nav__droplet',
      }),
    );
    expect(html).toContain('class="polish-nav__droplet"');
    expect(html).toContain('aria-hidden="true"');
  });
});
