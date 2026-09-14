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
    const app = readFileSync(join(dir, '../App.tsx'), 'utf8');
    expect(existsSync(join(dir, 'SceneField.ts'))).toBe(false);
    // The stage belongs to the app shell, not to a screen: mounting it inside
    // the view stack would put it in a screen's stacking context and remount it
    // on every navigation.
    expect(stack).not.toContain("from '../theme/SceneField'");
    expect(stack).not.toContain('<SceneField');
    expect(app).toContain('<SceneField />');
    expect(host).toContain('className="tvm-scene"');
    // CSS layers, not the WebGL field: a fullscreen shader repainting every
    // frame is the wrong cost for a background on a phone.
    expect(host).not.toContain('attachSceneGpu');
    expect(host).not.toContain('<canvas');
    expect(css).toContain('.tvm-scene');
    expect(css).toContain('display: none');
    expect(css).not.toContain('z-index: -1');
    expect(css).toContain('pointer-events: none');
    expect(css).toContain('.app__screen');
    expect(css).not.toMatch(/data-engine='webgl'\)::before[\s\S]{0,80}visibility:\s*hidden/);
    expect(css).toContain(":root[data-motion='reduced']");
    expect(css).not.toContain('@media (prefers-reduced-motion');
    expect(readFileSync(join(dir, 'sceneEngine.ts'), 'utf8')).toContain('prefersReducedMotion()');
    expect(readFileSync(join(dir, 'sceneEngine.ts'), 'utf8')).not.toContain('prefers-reduced-motion');
    expect(css).toContain('tvm-scene-drift-a');
    expect(css).toContain('--tvm-scene-noise');
    expect(css).not.toContain('tvm-isle-drift');
    expect(css).not.toContain('tvm-isle-tide');
  });

  /*
   * This background has been shipped inert twice: once as `display: none`, and
   * once with 41-97s periods that are technically animation and visually a
   * still image. Both read to the viewer as "the background is not animated".
   */
  it('actually animates, visibly and on the compositor', () => {
    const css = readFileSync(join(dir, 'scene.css'), 'utf8');

    // The layer is live at rest. Only the player, Retro and the explicit
    // reduced-transparency/performance opt-outs may switch it off.
    const base = css.slice(css.indexOf('.tvm-scene {'), css.indexOf('}', css.indexOf('.tvm-scene {')));
    expect(base).not.toContain('display: none');
    expect(base).toContain('position: fixed');

    // Behind the chrome, never over it. `.app__screen` is z-index 1.
    expect(base).toContain('z-index: 0');
    expect(css).not.toContain('z-index: -1');

    // Size containment on a fixed inset:0 box collapses it and every child.
    expect(base).not.toMatch(/contain:[^;]*\b(strict|size)\b/);

    const periods = [...css.matchAll(/animation(?:-duration)?:[^;]*?(\d+(?:\.\d+)?)s/g)]
      .map((match) => Number(match[1]));
    expect(periods.length).toBeGreaterThanOrEqual(6);
    // A minute-long drift is indistinguishable from a static gradient.
    expect(Math.max(...periods)).toBeLessThanOrEqual(40);
    // And a background that hurries is a distraction behind a film.
    expect(Math.min(...periods)).toBeGreaterThanOrEqual(12);

    // Compositor-only: animating anything else repaints the full viewport every
    // frame, which is exactly the jank this stage must not introduce.
    const keyframes = [...css.matchAll(/@keyframes tvm-scene-[\w-]+\s*\{([\s\S]*?)\n\}/g)]
      .map((match) => match[1])
      .filter((frames): frames is string => Boolean(frames));
    expect(keyframes.length).toBeGreaterThanOrEqual(5);
    for (const frames of keyframes) {
      for (const [, property] of frames.matchAll(/^\s{4}([a-z-]+):/gm)) {
        expect(['transform', 'opacity']).toContain(property);
      }
    }

    // Travel has to be large enough to see over the period.
    const shifts = [...css.matchAll(/translate3d\(\s*(-?\d+(?:\.\d+)?)%/g)].map((m) => Number(m[1]));
    expect(Math.max(...shifts) - Math.min(...shifts)).toBeGreaterThanOrEqual(10);
  });

  it('lets the stage show through the full-bleed screens that would cover it', () => {
    const css = readFileSync(join(dir, 'scene.css'), 'utf8');
    const transparent = css.slice(css.indexOf('.home,'), css.indexOf('.tvm-scene__gpu'));
    for (const selector of ['.home', '.home__shelf', '.page', '.stream-page']) {
      expect(transparent).toContain(selector);
    }
    expect(transparent).toContain('background: transparent');
  });
});
