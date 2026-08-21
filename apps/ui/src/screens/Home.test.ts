import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = dirname(fileURLToPath(import.meta.url));

describe('Home as TVM Stream showcase', () => {
  it('opens TVM Stream from the hero and posters instead of playing on Home', () => {
    const src = readFileSync(join(dir, 'Home.tsx'), 'utf8');
    expect(src).toContain('enterTvmStream');
    expect(src).toContain('TVM Stream');
    expect(src).toContain('id="hero-play"');
    expect(src).not.toContain('WATCH NOW');
    expect(src).not.toContain('openDetails');
    expect(src).not.toContain('HOME_ROW_ONE_IDS');
    expect(src).not.toContain('HERO_SLIDE_IDS');
  });
});

describe('Home search', () => {
  it('searches apps only when opened from Home', () => {
    const src = readFileSync(join(dir, 'SearchModal.tsx'), 'utf8');
    const ribbon = readFileSync(join(dir, '../components/Ribbon.tsx'), 'utf8');
    const registry = readFileSync(join(dir, '../nav/registry.ts'), 'utf8');
    expect(ribbon).toContain("from: 'home'");
    expect(src).toContain("params['from'] === 'home'");
    expect(src).toContain('searchApps');
    expect(src).toContain('openDetails');
    expect(src).toContain("push('service'");
    expect(src).toContain('dismissScrim');
    expect(registry).toContain("search: { component: SearchModal, defaultFocus: 'query' }");
  });

  it('opens search above the ribbon instead of sliding in from off-screen', () => {
    const css = readFileSync(join(dir, '../app.css'), 'utf8');
    const scene = readFileSync(join(dir, '../theme/scene.css'), 'utf8');
    expect(css).toContain('.app > .modal-layer');
    expect(css).toMatch(/\.app > \.modal-layer \{[\s\S]*position: fixed/);
    expect(css).toContain('z-index: 40');
    expect(css).toContain('.app__screen[inert] .ribbon');
    expect(css).not.toContain('translateY(calc(-100% - 1.2rem))');
    expect(css).toContain('translateY(-0.85rem)');
    expect(scene).toContain('.tvm-scene {\n  display: none;');
    expect(scene).not.toContain('z-index: -1');
    expect(scene).not.toContain('.app > * {');
  });

  it('does not leave a transform on the screen layer after enter', () => {
    const css = readFileSync(join(dir, '../app.css'), 'utf8');
    const enter = css.slice(css.indexOf('@keyframes view-enter'), css.indexOf('@keyframes copy-enter'));
    expect(enter).not.toContain('transform');
    expect(css).toContain('animation: view-enter var(--tvm-motion-base) var(--tvm-motion-ease) backwards');
    expect(css).toContain('animation: search-pill-in var(--tvm-motion-base) var(--tvm-motion-ease) backwards');
    expect(css).not.toContain('animation: view-enter var(--tvm-motion-base) var(--tvm-motion-ease) both');
  });
});

describe('Home rails keep pictures', () => {
  it('maps PosterCards with Artwork imgs onto every catalog rail', () => {
    const home = readFileSync(join(dir, 'Home.tsx'), 'utf8');
    const library = readFileSync(join(dir, 'Library.tsx'), 'utf8');
    const watchlist = readFileSync(join(dir, 'Watchlist.tsx'), 'utf8');
    const poster = readFileSync(join(dir, '../components/PosterCard.tsx'), 'utf8');
    const art = readFileSync(join(dir, '../components/Artwork.tsx'), 'utf8');
    expect(home).toContain('mapRailPosters(watching');
    expect(home).toContain('mapRailPosters(watchlist');
    expect(home).toContain('mapRailPosters(rail.titles');
    expect(library).toContain('mapRailPosters');
    expect(watchlist).toContain('<PosterCard');
    expect(poster).toContain('<Artwork');
    expect(poster).toContain('className="poster__art"');
    expect(art).toContain('<img');
    expect(art).toContain('src={src}');
    expect(home).toContain('memo(function HomeShelves');
    expect(home).toContain('requestAnimationFrame(apply)');
  });

  it('keeps channel logos and app tile icon imgs', () => {
    const live = readFileSync(join(dir, 'LiveTV.tsx'), 'utf8');
    const picks = readFileSync(join(dir, 'LivePicks.tsx'), 'utf8');
    const apps = readFileSync(join(dir, 'Apps.tsx'), 'utf8');
    const channel = readFileSync(join(dir, '../components/ChannelCard.tsx'), 'utf8');
    const card = readFileSync(join(dir, '../components/AppCard.tsx'), 'utf8');
    expect(live).toContain('<ChannelCard');
    expect(picks).toContain('<ChannelCard');
    expect(apps).toContain('<AppCard');
    expect(channel).toContain('channel-card__logo');
    expect(channel).toContain('src={logo}');
    expect(card).toContain('app-card__icon');
    expect(card).toContain('src={app.icon}');
  });

  it('does not hide decoded posters behind shimmer or opacity 0', () => {
    const css = readFileSync(join(dir, '../app.css'), 'utf8');
    const details = readFileSync(join(dir, 'details.css'), 'utf8');
    const marker = '.poster__art img {\n  position: absolute';
    const start = css.indexOf(marker);
    const block = css.slice(start, css.indexOf('}', start) + 1);
    expect(start).toBeGreaterThan(-1);
    expect(css).toMatch(/\.art--ready\s*>\s*\.skeleton--art[\s\S]{0,80}display:\s*none/);
    expect(block).toContain('z-index: 1');
    expect(block).toContain('opacity: 1');
    expect(block).not.toContain('opacity: 0');
    expect(details).toMatch(/\.details__poster img \{[\s\S]{0,160}opacity:\s*1/);
  });
});

describe('Home hero fade', () => {
  it('fades the top picture into the page background', () => {
    const css = readFileSync(join(dir, '../app.css'), 'utf8');
    const home = readFileSync(join(dir, 'Home.tsx'), 'utf8');
    const hero = readFileSync(join(dir, '../components/HeroArt.tsx'), 'utf8');
    const glass = readFileSync(join(dir, '../theme/glass/home.css'), 'utf8');
    const details = readFileSync(join(dir, 'details.css'), 'utf8');
    expect(css).toContain('.stage__pictures');
    expect(css).toContain('.stage__vignette');
    expect(css).toContain('var(--tvm-bg) 92%');
    expect(css).not.toContain('mask-image:');
    expect(glass).toContain('var(--tvm-bg) 100%');
    expect(glass).toContain('mask-image: none');
    expect(details).toContain('.details__backdrop');
    expect(details).toContain('var(--tvm-bg) 96%');
    expect(details).not.toContain('mask-image:');
    expect(css).toContain('@keyframes art-out');
    expect(css).toContain('--hero-fade');
    expect(home).toContain('heroScrollFade');
    expect(hero).toContain('stage__art--out');
    expect(hero).toContain("outgoing === ''");
  });
});

describe('Home category rails do not skip titles', () => {
  it('keeps looping, labeled headers, and sequential D-pad hops', () => {
    const home = readFileSync(join(dir, 'Home.tsx'), 'utf8');
    const rail = readFileSync(join(dir, '../components/Rail.tsx'), 'utf8');
    const wrap = readFileSync(join(dir, '../nav/wrapFocus.ts'), 'utf8');
    const poster = readFileSync(join(dir, '../components/PosterCard.tsx'), 'utf8');
    const hop = readFileSync(join(dir, '../nav/hopQueue.ts'), 'utf8');
    const css = readFileSync(join(dir, '../app.css'), 'utf8');
    expect(home).toContain('<Rail key={rail.id} title={rail.title}>');
    expect(home).toContain('mapRailPosters(rail.titles');
    expect(rail).toContain('shouldLoopRail');
    expect(rail).toContain('className="rail__title"');
    expect(rail).toContain('trackHasFocus');
    expect(wrap).toContain('wrapIndex(index, direction, record.items.length)');
    expect(poster).toContain('onArrowPress: () => false');
    expect(hop).toContain('AXIS_HOP_MAX_PENDING = 1');
    expect(css).toContain('scroll-snap-type: none');
    expect(css).not.toContain('scroll-snap-align');
  });
});
