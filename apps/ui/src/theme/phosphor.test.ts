import { describe, expect, it } from 'vitest';
import {
  AMBER,
  RED,
  VOID,
  averageBright,
  luma,
  mostCommonPhosphor,
  nearestPhosphor,
  paletteFromImage,
  posterSize,
  stylizePixels,
} from './phosphor';

function fill(width: number, height: number, colour: readonly [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = colour[0];
    data[i + 1] = colour[1];
    data[i + 2] = colour[2];
    data[i + 3] = 255;
  }
  return data;
}

describe('synthwave phosphor posterize', () => {
  it('treats dark pixels as the void and snaps brights onto a wide CRT palette', () => {
    expect(luma(0, 0, 0)).toBe(0);
    expect(nearestPhosphor(255, 200, 20)[0]).toBeGreaterThan(200);
    const dark = fill(4, 4, [4, 4, 4]);
    expect(averageBright(dark)).toBeNull();
    const red = fill(4, 4, [220, 20, 20]);
    expect(mostCommonPhosphor(red)).toEqual(RED);
    const pal = paletteFromImage(red);
    expect(pal[0]).toEqual(VOID);
    expect(pal.some((c) => c[0] > 180 && c[1] < 80)).toBe(true);
  });

  it('keeps more than one accent when the picture has several colours', () => {
    const data = fill(8, 8, [220, 20, 20]);
    for (let y = 0; y < 8; y += 1) {
      for (let x = 4; x < 8; x += 1) {
        const i = (y * 8 + x) * 4;
        data[i] = 18;
        data[i + 1] = 247;
        data[i + 2] = 255;
      }
    }
    const pal = paletteFromImage(data);
    expect(pal.some((c) => c[0] > 180 && c[1] < 80)).toBe(true);
    expect(pal.some((c) => c[2] > 180 && c[1] > 150)).toBe(true);
    expect(pal.length).toBeGreaterThan(2);
  });

  it('snaps each pixel onto the picture palette and darkens scan rows', () => {
    const width = 8;
    const height = 8;
    const data = fill(width, height, [220, 20, 20]);
    data[0] = 20;
    data[1] = 180;
    data[2] = 220;
    const out = stylizePixels(data, width, height);
    expect([out[4], out[5], out[6]]).toEqual([...RED]);
    expect(out[2] ?? 0).toBeGreaterThan(150);
    const scan = (5 * width + 0) * 4;
    expect(out[scan] ?? 0).toBeLessThan(RED[0]);
    expect(out[scan] ?? 0).toBeGreaterThan(140);
  });

  it('uses the average of bright pixels when snapping the accent', () => {
    const data = fill(2, 2, [255, 140, 20]);
    expect(averageBright(data)).toEqual([255, 140, 20]);
    expect(mostCommonPhosphor(data)).toEqual(AMBER);
  });

  it('fills a mostly-dark cell with the void', () => {
    const data = fill(2, 2, [4, 4, 4]);
    const out = stylizePixels(data, 2, 2);
    expect([out[0], out[1], out[2]]).toEqual([...VOID]);
  });

  it('keeps tape art slightly chunky', () => {
    expect(posterSize('poster')).toEqual({ width: 96, height: 144 });
    expect(posterSize('backdrop')).toEqual({ width: 128, height: 72 });
    expect(posterSize('logo')).toEqual({ width: 64, height: 64 });
  });
});
