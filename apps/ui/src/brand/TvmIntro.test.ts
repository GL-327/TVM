import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

describe('TVM brand mark', () => {
  it('draws a custom screen-and-play mark, not a licensed logo', () => {
    const src = readFileSync(join(dir, 'TvmMark.tsx'), 'utf8');
    expect(src).toContain('tvm-mark__bezel');
    expect(src).toContain('tvm-mark__play');
    expect(src).toContain('viewBox="0 0 80 80"');
    expect(src.toLowerCase()).not.toContain('apple');
    expect(src.toLowerCase()).not.toContain('sf pro');
  });
});

describe('TVM open sting', () => {
  it('plays a skippable sting for TVM and TVM Stream', () => {
    const src = readFileSync(join(dir, 'TvmIntro.tsx'), 'utf8');
    const css = readFileSync(join(dir, 'TvmIntro.css'), 'utf8');
    expect(src).toContain("variant === 'stream'");
    expect(src).toContain('Press OK to skip');
    expect(src).toContain('Enter');
    expect(src).toContain('shouldSkipIntro');
    expect(css).toContain('@keyframes tvm-intro-letter');
    expect(css).toContain('@keyframes tvm-intro-flare');
    expect(css).toContain('@keyframes tvm-intro-sheen');
    expect(css).toContain('@keyframes tvm-intro-mote');
    expect(css).toContain('tvm-intro--out');
    expect(css).toContain('tvm-intro__bloom');
    expect(src).toContain('const ANIM_MS = 3200');
    expect(src).toContain('const HOLD_MAX_MS = 2800');
    expect(src).toContain('holdIfRecent');
    expect(src).toContain('tvm.intro.session');
    expect(src).toContain('tvm.intro.stream');
    expect(src).toContain('streamIntroPlayedThisSession');
    expect(src).toContain('introPlayedMem');
    expect(src).toContain('alreadyPlayed');
    expect(src).not.toContain('if (pendingRef.current)');
    const stack = readFileSync(join(dir, '../nav/ViewStackProvider.tsx'), 'utf8');
    expect(stack).toContain('AbortSignal.timeout(2500)');
    expect(css).toContain('--intro-accent');
    expect(css).toContain('var(--tvm-accent');
  });

  it('fills the viewport, stays centered, and avoids GPU-heavy layers', () => {
    const src = readFileSync(join(dir, 'TvmIntro.tsx'), 'utf8');
    const css = readFileSync(join(dir, 'TvmIntro.css'), 'utf8');
    const scene = readFileSync(join(dir, '../theme/scene.css'), 'utf8');
    expect(css).toContain('.app > .tvm-intro');
    expect(css).toContain('position: fixed');
    expect(css).toContain('place-items: center');
    expect(css).toContain('inset: 0');
    expect(css).toContain('left: 50%');
    expect(css).toContain('top: 50%');
    expect(css).not.toContain('top: 44%');
    expect(css).not.toContain('142vmax');
    expect(css).not.toContain('filter: blur');
    expect(css).not.toContain('tvm-intro-spin');
    expect(css).not.toContain('tvm-intro__aurora');
    expect(css).not.toContain('tvm-intro__orbit');
    expect(src).toContain('const MOTES = [0, 1, 2, 3, 4, 5]');
    expect(src).toContain('const RAYS = [0, 1, 2, 3]');
    expect(src).not.toContain('SPARKS');
    expect(scene).not.toContain('z-index: -1');
    expect(scene).toContain('.tvm-scene {\n  display: none;');
    expect(scene).toContain(".app[data-screen='boot']::before");
  });
});

describe('loading plate', () => {
  it('fills the landscape screen instead of a tall card', () => {
    const css = readFileSync(join(dir, '../app.css'), 'utf8');
    const loader = readFileSync(join(dir, '../components/LoadingScreen.tsx'), 'utf8');
    expect(loader).toContain('TvmIntro');
    expect(loader).toContain('loading-state--plate');
    expect(css).toContain('.loading-state--plate');
    expect(css).toContain('inset: 0');
  });
});
