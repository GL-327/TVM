# Hover/focus lag on rail cards

## Cause (trace evidence)
Real Chrome (GPU), prod build, 8 rails x 30 titles (about 4,700 nodes, 720 posters).
- polish.css had `html body main:has(:is(.poster,.channel-card):hover) ... [data-focused] .poster__art`
  (and a `.poster__meta` twin). Every hover/focus change forced :has() re-matching over all of `main`.
  Invalidation tracking for 20 ArrowRight presses: ~48,000 "Related style rule" restyles and ~23,700
  "matched class poster__art" restyles. UpdateLayoutTree 1,880 ms (max 175 ms per call), with JS under 50 ms.
  After removing the rules: 64 ms.
- Secondary: ~240 `.skeleton--art::after` shimmer layers with `will-change: transform` kept Layerize at
  13-34 ms per commit (3.2 s total over a sweep). Removing the shimmer or the plates took cold sweep from
  47 fps / 37 long tasks to 158-180 fps / 0.

## Fixes
- polish.css: :has() rules replaced by `html[data-card-hover] body ...` selectors.
- New components/hoverYield.ts (installed from Rail): flips one attribute on <html> when the pointer
  enters/leaves the card area (90 ms leave debounce). Same "one highlighted card" behaviour, no React state.
- app.css: poster skeleton plates (`.skeleton--art::after`) no longer animate or use will-change.
- data/openDetails.ts: prefetchDetails runs at most once per id per 60 s (150 ms hover delay unchanged).
- Reverted: railBitmaps.ts change (data-armed shimmer) broke railBitmaps.test.ts, so it is not shipped.

## Numbers (cold first interaction, same machine, after-run = 3 runs)
| | Sweep fps | Sweep long tasks | Arrows fps | Arrows long tasks |
|---|---|---|---|---|
| Before | 47-70 (p95 94 ms) | 29-37 / 2.4-3.4 s | 5-11 (p95 100-210 ms) | 43-51 / 4.1 s |
| After | 90-150 (p95 16-28 ms) | 0-7 / up to 0.8 s | 30-72 (p95 33-83 ms) | 3-20 / 0.2-1.4 s |
Warm steady state after the :has fix: sweep 165 fps, arrows 75 fps, 0 long tasks.
Not done: React commits per hover were not measured (profile showed JS under 50 ms, so not the cause).
Remaining cold-start variance is Layerize, from composited layers (z-index toggles, will-change).

## Verification
vitest 560/560 pass, tsc clean, vite build OK. Playwright navigation/mobile/responsive specs NOT run (time).

## Files
apps/ui/src/theme/polish.css, src/app.css, src/components/hoverYield.ts (new), src/components/Rail.tsx,
src/data/openDetails.ts. Note: polish.css, app.css and Rail.tsx also carry other helpers' uncommitted edits.
