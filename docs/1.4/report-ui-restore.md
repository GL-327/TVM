# UI restore (apps/ui only)

## Method
Production build served by `vite preview`, headless Chromium (playwright), software raster, 1280x720, mocked `/api` (5 rails x 20 titles, continue row, a live Hunger Games event). rAF frame times plus PerformanceObserver long tasks.
Phases: idle Home (5 s), rail scroll (ArrowDown then ArrowRight held ~5 s), page scroll by mouse wheel (4 s).
Scripts: scratchpad/perf/{mocks,measure,trace,scan,shots}.mjs. 1.3.2 was built from `git archive 0fb780c` into scratchpad/old for a reference.

## Numbers (fps / p95 frame ms / long tasks)
| phase | 1.4.5 (before) | 1.3.2 reference | after |
|---|---|---|---|
| idle Home | 60.1 / 16.7 / 0 | 57.6 / 16.8 / 1 | 60.2 / 16.8 / 0 |
| rail scroll | 17.1 / 83.4 / 74 | 32.6 / 50.1 / 53 | 56.6 / 33.2 / 0 |
| wheel scroll | 32.5 / 66.7 / 44 | 58.3 / 16.8 / 2 | 60.0 / 16.7 / 0 |

Caveat: headless has no GPU, so backdrop-filter and SVG-lens cost are understated; idle was already 60 fps here. Idle Home has no per-frame long tasks before or after.

## What was costly
- Biggest: `.poster__art { transform: translateZ(0) scale(1) }` (app.css, also in 1.3.2). Every poster in every rail (about 280 on Home, loop copies included) got its own compositor layer, so each scroll frame spent ~3.4 s of 4 s in Layerize on the main thread. Ablating it alone took rail scroll from 15 to 56 fps. Fixed: base transform is `none`; the focused/hovered card is promoted by will-change.
- 1.4 hero (Spotlight): 48 animated ember elements, a `filter: blur(42px)` glow and logo sweep kept animating after the hero was scrolled away; the hero kept restyling on every scroll frame after it was fully off screen. Now paused/hidden when `data-active='false'`, blur removed, style writes stop once the hero is past.
- 1.4 glass: `liquidLens.ts` had grown to a 680-line runtime (global glass-surface sync, pointer bloom tracking, backdrop luminance sampling from art, MutationObservers) plus polish.css re-skinning every `.glass` to a flat 3 px blur. Not visible as a hot spot in headless but replaced wholesale with the 1.3.2 per-element lens (only the 'more' sheet and segmented controls, built only when open/allowed).
- Ablations that did NOT matter in headless: global backdrop-filter off, filters off, scene layers off.

## Restored (from 0fb780c)
theme/glass.ts (data-glass clear/default/tinted, applyStoredGlass), components/liquidLens.ts + test (added optional `active` option so Ribbon's closed sheet builds no lens), theme/liquidGlass.css (frosted blur 14/26 px, specular arcs, old surfaces), theme/scene.css + SceneField.tsx (animated six-layer backdrop + grain) + sceneEngine/apply tests, theme/dark.css ocean palette (kept the 1.4 details-vignette fix). Removed theme/glass.test.ts (tested the deleted adaptive-tint API). appearance.ts no longer calls the removed lens runtime; apply.ts calls applyStoredGlass again.
polish.css: stripped the material overrides (flat `.glass`, rim ::before, hover lift, glass-segment track, glass tokens). Geometry kept (12 px radii, 44 px targets), reduced-transparency now swaps the 1.3.2 tokens for solid surfaces.
Extra: 30% dark shade under the default glass wash so white labels stay readable over bright art.

## Home
- Event rail is now a normal Rail (header + row), no bordered card, no overline/subtitle. Finite (loop off), duplicates removed, numbered badges via CSS counters (`.rail--numbered`, app.css). Rail got an optional `className` prop.
- "In cinemas now" kicker: root cause on phones was the hero shrinking (flex-shrink in the fixed-height `.home` column) so the copy rose over the wordmark; fixed with `flex: 0 0 auto`, a taller phone hero and top padding. On desktop the copy now fades before it can cross the wordmark when scrolling, and the nav gets a soft top shade.
- Hero kept as logo, line, meta chips, buttons over the event art.

## Kept
Centred solid nav capsule with magnifier (phone: top-right search, 5 bottom tabs), single highlighted card (unclipped hover), rounded-rectangle buttons, Geist, Settings two-pane + switches, guide, patch notes popup, version picker, stats, sync status, prefetch, FPS switch, droplet/segmented controls with solid thumb.

## Tests
- vitest: 95 files / 548 tests pass.
- typecheck: clean. build: clean.
- Tests changed (asserted removed 1.4 styling): `screens/Home.test.ts` (story-card grid/kicker assertions replaced with `rail--numbered`; Rail JSX string match loosened for the new className prop); `theme/appearance.test.ts` (no longer asserts the glass key is removed); `theme/apply.test.ts` and `theme/sceneEngine.test.ts` and `components/liquidLens.test.ts` returned to the 1.3.2 versions; `theme/glass.test.ts` deleted.
- Playwright navigation/mobile/responsive: 48 passed (final run). An earlier run, with CSS edited under the dev server mid-run, had one flake (navigation.spec.ts:675 Retired themes); it passed on the clean rerun.

## Screenshots
scratchpad/shots/ui-restore/: after-home-1280.png, after-home-390.png, after-rail-hover.png, after-event-rail.png, after-settings.png, after-glass-bright.png (plus before-/old132-/v1..v3- for comparison).
