# WEB2 Report (`apps/ui/**`)

Continuation and completion of TVM 1.4.4 WEB2 follow-ups in `C:\Users\Gathe\Desktop\TVM\apps\ui` (building on and completing Codex's in-progress work). Only `apps/ui/**` was modified; repository git state was left clean (`git diff --check -- apps/ui` passed with LF line endings on all changed files).

---

## 1. Navigation Browser Tests (`navigation.spec.ts`) — Failure Decisions

Baseline command in `apps/ui`: `corepack pnpm exec playwright test navigation.spec.ts --reporter=line` failed 10 of 27 tests (`baseline-tests.log`). Decisions and reasons:

| Baseline test | Decision | Reason & resolution |
|---|---|---|
| `:540` `a film poster opens the title page with an IMDb score before Play` (`getByText('IMDb 8.4')` not found; `8.4`/`8.7` were swapped in brief) | **Stale test** | `ImdbBadge` splits `IMDb`, score, and `/10` across child elements and exposes `"IMDb 8.4 out of 10. Open IMDb or view reviews."` as the button's accessible name. Updated selector to `getByRole('button', { name: ... })` and added verification that Details renders title/poster/backdrop immediately before `/api/media` finishes while firing only one fetch on card focus prefetch. |
| `:575` `a series poster opens seasons, then an episode plays with tt:s:e` (`getByText('IMDb 8.7')` not found) | **Stale test** | Same `ImdbBadge` markup change; updated to query `getByRole('button', { name: 'IMDb 8.7 out of 10. Open IMDb or view reviews.' })`. |
| `:611` `Settings opens Plans` (`Could not reach focus id "settings"`) | **Product bug + stale test** | **Product bug:** `.polish-nav__items` and `.polish-nav__side` each had `data-wrap="row"` in `Ribbon.tsx`, trapping horizontal spatial navigation inside the capsule tabs so keyboard/remote could not reach `settings` or `more`. Fixed `Ribbon.tsx` + `wrapFocus.ts` (`data-wrap="row"` on `.polish-nav`, `data-wrap="none"` on desktop `.polish-nav__items`/`.polish-nav__side`, filtering direct nav items, plus `Settings.tsx` `navigatePanes` two-pane `ArrowRight`/`ArrowLeft` switching). Updated test to cross from `search` to `settings`, verify non-dev hides `Show FPS`, enter Account rows with `ArrowRight`, and open `plan`. |
| `:624` `Plans explains access without taking a card` (`Could not reach focus id "settings"`) | **Product bug + stale test** | Same Ribbon focus-trap bug and two-pane Settings entry (`enterAccountSettingsRows`) update. |
| `:639` `Retired themes fall back to Dark; privacy and motion are reachable` (`Could not reach focus id "settings"`) | **Product bug + stale test** | Same Ribbon focus-trap bug; in the two-pane Settings redesign (`docs/1.4/spec.md`), `theme` and `motion` live under `Appearance` and `privacy` lives under `Account`. Updated test to switch categories via `ArrowDown`/`ArrowRight`/`ArrowLeft`. |
| `:659` `MAX shows the mock live pack` (`getByRole('button', { name: /Sky Sports/ })` not found) | **Stale test + product accessibility fix** | Live TV now opens on `ProgrammeGuide` (`Guide` heading). Added `ariaLabel={`${channel.name}, ${programme.title}`}` to `.guide__cell` in `ProgrammeGuide.tsx` so guide programme buttons expose accessible names containing channel and show titles, and updated test to check `Guide` heading + mock guide payload (`api/live/guide`). |
| `:712` `volume slider sets a level and a speed pick does not scrub` (`[data-focus-id="player-speed"]` not visible) | **Stale test (+ byte-range mock fix)** | Per `playback-extras.css`, `PlaybackSpeed` is nested inside the `Playback settings` drawer across desktop and mobile viewports. Updated test to verify timeline markers/legend, test volume drag/click, open `Playback settings`, select `player-speed-2`, and updated the `**/e2e-sample.mp4` route mock to return `Accept-Ranges: bytes` / `206 Partial Content` so Chromium reports non-zero `seekable` range and seeks past `0` reliably before asserting no scrub occurs on speed change. |
| `:762` `Live TV shows Free channels first alongside inline login, and Back returns Home` (`Free channels` heading not found) | **Stale test** | Live TV now lands on the `Guide` screen first with `M3U playlist` / `Xtream login` in the guide footer and switches to `Free channels` via the `Channels` button. Updated test to assert both `Guide` and `Free channels` flows and return Home via `live-back`. |
| `:817` `downloads select a full series or one episode with language, quality and folder` (`'D:\\My movies'` not found) | **Stale test + small product bug** | **Stale test:** Browser downloads use `window.showDirectoryPicker` + `/api/downloads/resolve` rather than the removed `window.tvmDownloads` bridge. **Product bug:** Reopening Downloads from the episode row cleared the folder name; added `currentFolder()` on `browserBridge` in `data/downloads.ts` so the chosen directory stays selected for the session. |
| `:878` `desktop recovery preserves position, never labels an unknown film Live, and hides parked controls` (`expect(requests[0]?.native).toBe(true)`) | **Stale test** | Native playback bridge moved from `window.tvmDesktop` + `window.tvmNativePlayer` to `window.tvmPlayer` (`tvm:native-player` event), and `player-settings` holds `player-speed` at all widths. Updated test to mock `window.tvmPlayer` and verify recovery preserves `startAt: 73`. |

---

## 2. Live TV & Guide Back Button

- **Changes (`LiveTV.tsx`, `ProgrammeGuide.tsx`, `guide.css`):** Unified `<BackButton id="live-back" />` and heading inside `.page__toolbar-lead` with `.page .live-heading` and shared container padding (`90px var(--tvm-safe-x) 18px` desktop, `max(62px, calc(var(--tvm-safe-y) + 46px)) var(--tvm-safe-x) 84px` mobile).
- **Verified placement, size & glass styling:**
  - `1920x1080` and `1280x720`: both Guide (`guide-1920x1080.png`, `guide-1280x720.png`) and Live TV channels (`channels-1920x1080.png`, `channels-1280x720.png`) render `<BackButton>` at `x: 40, y: 90, 44x44, border-radius: 999px` with Liquid Glass `#tvm-lens-12` backdrop + layered inset rim/shadow, matching docked screens (`account-1280x720.png` `x: 40, y: 90`).
  - `390x844`: both Guide and Live TV (`guide-390x844.png`, `channels-390x844.png`) render `<BackButton>` at `x: 16, y: 99, 44x44, border-radius: 999px` with identical glass styling.

---

## 3. Playback Markers & Settings Description

- **Seek bar legend & hover/scrub tooltips (`ProgressBar.tsx`, `ProgressBar.test.ts`):**
  - Renders colour-coded segment markers on `.tvm-progress__track` (`intro` `#fdcb65`, `recap` `#c5a3ff`, `credits` `#71e1b2`, `chapter` `#fff`).
  - Displays an accessible `<ul className="tvm-progress__legend" aria-label="Timeline markers">` (linked via `aria-describedby` on the seek slider) showing only the marker types present on the loaded video.
  - Added `markerAtTime(...)` so hovering or scrubbing over a marker enriches `.tvm-progress__bubble` with the active marker name (e.g. `0:00 · Intro`), verified visually in `player-bubble-1280x720.png` and `player-markers-1920x1080.png` / `player-markers-390x844.png`.
- **Settings description (`settingsControls.tsx`):** Updated `skip-segments` row to `"Skip intros, recaps & credits"` with detail: `"Coloured bars mark intros, recaps and credits. White ticks mark chapter starts. Skip jumps to the end of a marked section. Choose Button to skip yourself or Automatic to skip for you."` Verified visually in `settings-playback-1280x720.png`.

---

## 4. Instant Details Prefetch & First-Paint Measurements

- **Changes:**
  - `PosterCard.tsx` + `LoopClone.tsx`: `useDetailsPrefetch` schedules `prefetchDetails(id, kind)` after 150 ms of non-touch pointer hover or spatial focus.
  - `openDetails.ts` + `media.ts`: `prefetchDetails` warms `detailsRequests` cache (`fetchMedia` and `fetchChildren` for series) without duplicating requests on open.
  - `launchTitle.ts` + `registry.ts`: static `Details` import (no Suspense stall) and synchronous navigation when `currentProfileId() !== '' && peekHome()?.rd.configured === true`.
  - `Details.tsx` + `details.css`: removed entrance animation (`details-enter`), pinned `.details__hero` to `align-items: flex-start`, reserved block height on `.stage__meta`, `.details__anime-subtitle`, `.stage__synopsis`, and placed Trailer/QualityBadges/versions/Coming up below the synopsis so delayed metadata fills in without layout jumps.
- **Playwright `performance.measure('details-nav-to-paint')` (`bench.cjs`, 7 runs per mode, Vite on `127.0.0.1:15174`, 320 ms `/api/media` mock latency):**
  - **Baseline cold (ms):** `[558.6, 425.4, 430.8, 435.2, 427.1, 459.1, 440.9]` — min `425.4`, **median `435.2`**, mean `453.9`, max `558.6`.
  - **Baseline 600 ms hover (ms):** `[479.7, 511.5, 396.5, 413.4, 396.9, 377.2, 413.6]` — min `377.2`, **median `413.4`**, mean `427.0`, max `511.5`.
  - **After cold (ms):** `[31.1, 29.1, 28.1, 30.5, 29.9, 28.3, 33.9]` — min `28.1`, **median `29.9`**, mean `30.1`, max `33.9` (~14.6x faster median first paint).
  - **After 600 ms hover prefetch (ms):** `[33.2, 32.5, 33.5, 33.9, 34.5, 32.9, 31.1]` — min `31.1`, **median `33.2`**, mean `33.1`, max `34.5` (~12.5x faster median first paint, verified 1 `/api/media` request across hover + navigation).

---

## 5. Developer "Show FPS" Switch & Home Measurements

- **Changes (`FpsOverlay.tsx`, `fps-overlay.css`, `FpsOverlay.test.ts`, `Settings.tsx`, `App.tsx`):**
  - Added `"Show FPS"` switch in Developer settings (`show-fps`, persisted in `sessionStorage` key `tvm.developer.show-fps`).
  - Mounted `<FpsOverlay />` in `App.tsx` only when `isDevAccount(account)` is true; uses `requestAnimationFrame` (`computeFps`, `formatFpsLabel`) and pauses counting when `document.hidden`.
- **Headless Chromium measurements (`visual.cjs fps`, `1280x720`, Chromium `151.0.7922.34`):**
  - **Home idle:** raw samples `[60, 60, 60, 60, 48, 58, 40, 60]` FPS — min `40`, **median `60`**, mean `55.8`, max `60` (overlay updates `[60, 48, 58, 40]`, displayed `40 FPS` at capture).
  - **Home rail scrolling (3 tracks, `9540 px` distance):** raw samples `[29.5, 28, 29.5, 29, 29, 29, 29.5, 29.5]` FPS — min `28`, **median `29.5`**, mean `29.1`, max `29.5` (overlay updates `[30, 28, 30, 29, 30]`, displayed `30 FPS`).
  - **Hardware caveat:** Chromium ran on software Vulkan (`Renderer: ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`). CPU rasterization/compositing caps continuous scrolling frame rate in SwiftShader; hardware GPU compositing will run much higher.

---

## 6. Streaming-Service Polish Fixes

- **Nav icon & search centering (`polish.css`):** Added `place-content: center` to `.polish-nav__tab` and `.polish-nav__icon` to override `.tvm-button`'s inherited `justify-content: space-between` (`search`, `settings`, `more` SVGs measured at `dx: 0, dy: 0` offset on both `1280x720` and `390x844`).
- **Settings panel scrim & keyboard return (`settings.css`, `Settings.tsx`):** Changed `.polish-settings::before` to `position: fixed; inset: 0 0 auto; z-index: 5; height: var(--tvm-settings-scrim)` so Blink sticky-box clamping no longer drew the dark gradient fade across `<h1>Playback</h1>` / `<h1>Developer</h1>`; added `data-scroll-nearest=""` on `.polish-settings` and added `select.polish-select` to `navigatePanes` so `ArrowLeft` from `<select>` controls returns focus to the active category in the sidebar.
- **Guide & Details small polish (`ProgrammeGuide.tsx`, `guide.css`, `Details.tsx`, `details.css`):** `GuideChannelLogo` falls back cleanly on broken logo URLs; `.guide__search` centers inside a 40x40 circle; `.details__copy` sets `min-width: 0` to prevent horizontal overflow; `Details.tsx` preserves user focus if delayed episode data finishes loading after navigation away from `back`.

---

## 7. Final Build & Test Verification

All checks below ran cleanly after the final edit from `apps/ui` (building Vite output to scratch `work/web2/dist` so repo `apps/ui/dist` remained untouched):

- `git -C C:\Users\Gathe\Desktop\TVM diff --check -- apps/ui` — passed (`exit 0`, LF endings)
- `corepack pnpm run typecheck` (`tsc -p tsconfig.json --noEmit`) — passed (`exit 0`)
- `node node_modules/vitest/vitest.mjs run` — **96 test files passed, 553 tests passed**
- `corepack pnpm run build -- --outDir ...\scratchpad\work\web2\dist` — passed (`✓ built in 618ms`)
- `corepack pnpm exec playwright test navigation.spec.ts mobile.spec.ts responsive.spec.ts --reporter=line` — **48 passed** (`0` failed, `0` skipped, `3.3m`)

---

## 8. Files Changed Under `apps/ui/**` (28 files)

Modified (25):
- `apps/ui/e2e/mobile.spec.ts`
- `apps/ui/e2e/navigation.spec.ts`
- `apps/ui/src/App.tsx`
- `apps/ui/src/components/LoopClone.tsx`
- `apps/ui/src/components/PosterCard.tsx`
- `apps/ui/src/components/Ribbon.tsx`
- `apps/ui/src/data/downloads.ts`
- `apps/ui/src/data/launchTitle.test.ts`
- `apps/ui/src/data/launchTitle.ts`
- `apps/ui/src/data/media.ts`
- `apps/ui/src/data/openDetails.ts`
- `apps/ui/src/nav/registry.ts`
- `apps/ui/src/nav/wrapFocus.ts`
- `apps/ui/src/player/features/ProgressBar.test.ts`
- `apps/ui/src/player/features/ProgressBar.tsx`
- `apps/ui/src/screens/Details.tsx`
- `apps/ui/src/screens/LiveTV.tsx`
- `apps/ui/src/screens/ProgrammeGuide.tsx`
- `apps/ui/src/screens/Settings.test.ts`
- `apps/ui/src/screens/Settings.tsx`
- `apps/ui/src/screens/details.css`
- `apps/ui/src/screens/guide.css`
- `apps/ui/src/screens/settings.css`
- `apps/ui/src/screens/settingsControls.tsx`
- `apps/ui/src/theme/polish.css`

Added (3):
- `apps/ui/src/components/FpsOverlay.tsx`
- `apps/ui/src/components/FpsOverlay.test.ts`
- `apps/ui/src/components/fps-overlay.css`
