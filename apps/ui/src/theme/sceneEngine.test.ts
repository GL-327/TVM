import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCssRgb,
  SCENE_FRAG,
  SCENE_STILL_TIME,
  sceneBufferSize,
  sceneMoodId,
  sceneShouldRun,
} from './sceneEngine';

const dir = dirname(fileURLToPath(import.meta.url));

describe('scene field', () => {
  it('maps themes to authored moods and pauses on player, synthwave, or hidden', () => {
    expect(sceneMoodId('default')).toBe(0);
    expect(sceneMoodId('light')).toBe(1);
    expect(sceneMoodId('dark')).toBe(2);
    expect(sceneMoodId('happy')).toBe(3);
    expect(sceneMoodId('sunset')).toBe(4);
    expect(sceneMoodId('heather')).toBe(5);
    expect(sceneMoodId('glass')).toBe(6);
    expect(sceneShouldRun({ hidden: false, reducedMotion: false, player: false, synthwave: false })).toBe('live');
    expect(sceneShouldRun({ hidden: false, reducedMotion: true, player: false, synthwave: false })).toBe('still');
    expect(sceneShouldRun({ hidden: true, reducedMotion: false, player: false, synthwave: false })).toBe('off');
    expect(sceneShouldRun({ hidden: false, reducedMotion: false, player: true, synthwave: false })).toBe('off');
    expect(sceneShouldRun({ hidden: false, reducedMotion: false, player: false, synthwave: true })).toBe('off');
    expect(SCENE_STILL_TIME).toBeGreaterThan(8);
  });

  it('parses theme token colors and caps the GPU buffer for TV', () => {
    expect(parseCssRgb('#7ec8e8')[0]).toBeCloseTo(126 / 255);
    expect(parseCssRgb('#7ec8e8')[2]).toBeCloseTo(232 / 255);
    expect(parseCssRgb('#fff')).toEqual([1, 1, 1]);
    expect(parseCssRgb('rgb(18, 48, 86)')[0]).toBeCloseTo(18 / 255);
    expect(parseCssRgb('rgba(255 128 0 / 0.4)')[1]).toBeCloseTo(128 / 255);
    const hd = sceneBufferSize(1920, 1080, 1);
    expect(Math.max(hd.w, hd.h)).toBeLessThanOrEqual(1280);
    const uhd = sceneBufferSize(3840, 2160, 2);
    expect(Math.max(uhd.w, uhd.h)).toBeLessThanOrEqual(1280);
  });

  it('keeps an organic field shader with grain, warp, and a CSS fallback', () => {
    expect(SCENE_FRAG).toContain('fbm');
    expect(SCENE_FRAG).toContain('warp');
    expect(SCENE_FRAG).toContain('uGrain');
    expect(SCENE_FRAG).toContain('caustic');
    const host = readFileSync(join(dir, 'SceneField.tsx'), 'utf8');
    const css = readFileSync(join(dir, 'scene.css'), 'utf8');
    const stack = readFileSync(join(dir, '../nav/ViewStackProvider.tsx'), 'utf8');
    expect(existsSync(join(dir, 'SceneField.ts'))).toBe(false);
    expect(stack).not.toContain("from '../theme/SceneField'");
    expect(stack).not.toContain('<SceneField');
    expect(host).toContain('export function SceneField(): null');
    expect(host).not.toContain('attachSceneGpu');
    expect(css).toContain('.tvm-scene');
    expect(css).toContain('display: none');
    expect(css).not.toContain('z-index: -1');
    expect(css).toContain('pointer-events: none');
    expect(css).toContain('.app__screen');
    expect(css).not.toMatch(/data-engine='webgl'\)::before[\s\S]{0,80}visibility:\s*hidden/);
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('tvm-scene-drift-a');
    expect(css).toContain('--tvm-scene-noise');
    expect(css).not.toContain('tvm-isle-drift');
    expect(css).not.toContain('tvm-isle-tide');
  });
});
