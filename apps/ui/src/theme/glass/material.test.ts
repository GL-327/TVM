import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));
const ui = join(dir, '../..');

function read(...parts: string[]): string {
  return readFileSync(join(...parts), 'utf8');
}

describe('kit glass material', () => {
  it('restores mid-range frost and thin white fill', () => {
    const tokens = read(dir, 'tokens.css');
    expect(tokens).toContain('--tvm-glass-blur: 28px;');
    expect(tokens).toContain('--tvm-glass-blur-soft: 16px;');
    expect(tokens).toContain('--tvm-glass-saturate: 1.5;');
    expect(tokens).not.toContain('--tvm-glass-blur: 44px;');
    expect(tokens).not.toContain('--tvm-glass-blur-soft: 12px;');
    expect(tokens).toContain('--tvm-glass-fill: rgba(255, 255, 255, 0.1);');
    expect(tokens).toContain('--tvm-glass-fill-text: rgba(255, 255, 255, 0.14);');
    expect(tokens).toContain('--tvm-glass-fill-bright: rgba(255, 255, 255, 0.16);');
    expect(tokens).toContain('inset 0 1px 0 rgba(255, 255, 255, 0.82)');
  });

  it('paints poster frames without live frost', () => {
    const cards = read(dir, 'cards.css');
    const settings = read(dir, 'settings.css');
    expect(cards).toContain('.poster:not([data-loop-clone]) .poster__meta');
    expect(cards).toContain('.channel-card:not([data-loop-clone]) .channel-card__name');
    expect(cards).toContain("[data-focused='true'] .poster__meta");
    expect(cards).not.toContain('backdrop-filter: var(--tvm-glass-filter-soft)');
    expect(cards).toMatch(/\[data-theme='glass'\] \.poster,[\s\S]*backdrop-filter: none;/);
    expect(cards).toMatch(/\.poster\[data-loop-clone\] \.poster__meta[\s\S]*backdrop-filter: none;/);
    expect(cards).toMatch(/\.poster__art \{[\s\S]*backdrop-filter: none;/);
    expect(settings).toContain('.settings-row');
    expect(settings).toContain('backdrop-filter: var(--tvm-glass-filter-soft)');
    expect(settings).toContain('backdrop-filter: var(--tvm-glass-filter)');
    expect(cards).not.toContain('mix-blend-mode: screen');
    expect(settings).not.toContain('mix-blend-mode: screen');
    expect(cards).not.toContain('isolation: isolate');
    expect(settings).not.toContain('isolation: isolate');
  });

  it('uses a viewport-fixed home scene instead of sticky percent world', () => {
    const homeCss = read(dir, 'home.css');
    const homeTsx = read(ui, 'screens/Home.tsx');
    const scene = read(ui, 'components/PageScene.tsx');
    expect(homeTsx).toContain('PageScene');
    expect(scene).toContain('home__scene');
    expect(scene).toContain('home__scene--mesh');
    expect(homeTsx).not.toContain('home__world');
    expect(homeCss).toContain('position: fixed;');
    expect(homeCss).toContain('height: 100vh;');
    expect(homeCss).toContain('pointer-events: none;');
    expect(homeCss).not.toContain('.home__world');
    expect(homeCss).not.toContain('margin-bottom: -100%');
    expect(homeCss).toContain('inset: 0;');
  });
});

describe('glass nav lag fixes stay in place', () => {
  it('skips jumpAxis while wrapping and settles cancelScrollAnim', () => {
    const rail = read(ui, 'components/Rail.tsx');
    const reveal = read(ui, 'nav/revealFocused.ts');
    const looping = read(ui, 'nav/loopingRail.ts');
    const scroll = read(ui, 'nav/scrollAnim.ts');
    expect(rail).toContain("track.dataset.wrapping === 'true'");
    expect(rail).toContain('isScrollAnimating');
    expect(rail).toContain('jumpAxis');
    expect(rail).toContain('watchRailBitmaps');
    expect(rail).toContain('isLoopSeamJump');
    expect(rail).not.toContain('startTransition');
    expect(rail).not.toContain('paintClones');
    expect(scroll).toContain('done?.()');
    expect(scroll).toContain('export function isScrollAnimating');
    expect(reveal).toContain("row.dataset.wrapping === 'true'");
    expect(looping).toContain('cancelScrollAnim(track)');
    expect(looping).toContain("track.dataset.wrapping = 'true'");
    expect(looping).toContain('WRAP_UNLOCK_MS');
    expect(looping).toContain("from './scrollAnim'");
  });

  it('keeps throttle 0, isle default, and clones out of norigin', () => {
    const engine = read(ui, 'nav/focusEngine.ts');
    const registry = read(ui, 'theme/registry.ts');
    const poster = read(ui, 'components/PosterCard.tsx');
    const clone = read(ui, 'components/LoopClone.tsx');
    expect(engine).toContain('throttle: 0');
    expect(registry).toContain("export const DEFAULT_THEME: ThemeId = 'default'");
    expect(clone).toContain('data-loop-clone="true"');
    expect(poster).toContain('function PosterClone');
    const cloneBlock = poster.slice(poster.indexOf('function PosterClone'), poster.indexOf('const PosterFocusable'));
    expect(cloneBlock).not.toContain('useFocusable');
    expect(cloneBlock).toContain('LoopClone');
    expect(cloneBlock).toContain('<PosterFace title={title} layout={layout} decorative />');
  });

  it('keeps poster imgs and only eager-decodes cards near the camera', () => {
    const art = read(ui, 'components/Artwork.tsx');
    const channel = read(ui, 'components/ChannelCard.tsx');
    const bitmaps = read(ui, 'components/railBitmaps.ts');
    const homeCss = read(ui, 'app.css');
    expect(art).toContain('<img');
    expect(art).toContain('src={src}');
    expect(art).toContain("loading={eager ? 'eager' : 'lazy'}");
    expect(art).toContain('decoding="async"');
    expect(art).not.toContain('eager || !decorative');
    expect(channel).toContain('src={logo}');
    expect(channel).toContain('loading="lazy"');
    expect(bitmaps).toContain('cardInCamera');
    expect(bitmaps).toContain('bitmapOverscanX');
    expect(bitmaps).toContain('armBitmap');
    expect(homeCss).not.toMatch(/\.home \.poster[^{]*\{[^}]*content-visibility:\s*(auto|hidden)/);
    expect(homeCss).not.toMatch(/\.poster__art \{[\s\S]{0,280}transform:\s*scale\(1\)/);
  });
});
