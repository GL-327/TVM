Audit of TVM @ 0b2e454, 17 Nov 2026. Compiled from read-only agent audits; line refs approximate.

## 1. Refs compared

| Ref | Commit | What it is | Verdict |
|---|---|---|---|
| GitHub main | 0b2e454 (includes PR #22 claude/zealous-rubin-gevest, dd1e8a0) | Current main. PR #22 (18 commits, 50 files, +4029/-698) adds the iOS Swift shell, glass tab bar, VLC video engine, iOS downloads and core parity, and Android subtitles and Up Next card. | Baseline. PR #22 is merged; nothing to do. |
| PR #1 | c68f386 (cursor/desktop-roku-laptop-copy-98cb) | Aug 2026 Cursor prototype (9 commits): Electron shell, Debian appliance, laptop launchers, loopback-first startup. | Close without merging. Everything not Electron or appliance is already in main or superseded. |
| PR #2 | e5b7eae | PR #1 plus 5 commits: five plans, mock checkout, encrypted entitlements, themes, looping rails, Settings category pages. | Close without merging. Plan engine is in main; mock checkout was deliberately removed. |
| PR #3 | 8d92dfa | 120 commits of main's own history under a rewritten root. Tip tree (5b8194c) is byte-identical to main commit b5cf9da. | Redundant. Close or delete. All 120 subjects are in main. |
| codex/native-parity-cleanup | 541aaed | "Document TVM and publish every supported platform from main" (7 files). | Already in main. Blob-identical to main 7530a7d. Redundant. |
| Old local checkout | 7530a7d | Old local checkout, was 64 commits behind and 0 ahead of main. Now fast-forwarded. 7530a7d is main's rebased copy of 541aaed. | Done. Matches main. No action. |

**Carry-over (optional only):** the extra accent colours from PR #2 are not needed for parity. These are eagles (mint on navy, `html[data-style='eagles']`, pr/2 `packages/design/src/tokens.css` ~line 275), ocean, ice, rose, violet, sand, copper, crimson, royal, sunset, neon and graphite. Main gates styles by plan, so any port needs a `minPlan` choice (`apps/core/src/providers/plans.ts`, `apps/ui/src/data/plan.ts`) and `tokens.css` blocks.

## 2. Behaviours to retain

- **Owner door (Roku):** 7 presses of Info open the owner door, then the "I'm a dev" code signs in and sets the account to `stream-live` (`apps/roku/components/TVMScene.brs` 1115-1196, 1169). `check.mjs` asserts the door.
- **Owner door (Core):** `POST /api/account/dev` (rate-limited) and `POST /api/dev/unlock` (5 attempts per 60 s, global) set role `dev`. Dev mode is machine-wide while a dev session is live.
- **LAN token gate:** non-loopback callers need `Authorization: Bearer <TVM_LAN_TOKEN>` or the `tvm_lan_session` cookie (12 h, in memory). Only `/api/health` is exempt (`security.ts` 30-68, `lanSessions.ts`). The Roku token lives in the device registry, never in `config.json` or the zip.
- **PlayerScreen overlay focus contract (Roku):** `Video` has `focusable=false`, the overlay keeps keys and `enableUI = false`. `check.mjs` asserts this. Back runs closePlayer, then pop, and Details regains focus.
- **Loopback Core:** Core binds 127.0.0.1 by default. Admin, billing, plan, update, maintenance and privacy routes are loopback-only (`security.ts` regex). Native refuses to talk to any other server that answers `/api/health` on its port (`core_host.cpp` 47-49). Core keeps running after the window closes (`core_host.cpp` 106-108).
- **Signed updates:** native `update-native.ps1` requires a 40-hex label and a sha256 digest, verifies the download, extracts only allowed paths, and applies with backup and rollback. Core `/api/update/*` is loopback-only. Packaged Core updates carry stamped `build-info.json` (`native/package.ps1`, `native/tools/core_check.cpp`).
- **Players:** Windows uses mpv (JSON IPC, layered overlay window). Android uses Media3/ExoPlayer 1.4.1 (`TvmNativePlayer.kt`). iOS uses MobileVLCKit (`TVMVideoEngine.swift`), which answers the page's `tvmPlayer` bridge (open, play, pause, seek, volume, mute, rate, goLive, stop). Roku uses the Video node.
- **Android subtitles:** `TvmSubtitles.kt` lists embedded tracks and `chooseSubtitle` applies one (test: `TvmSubtitlesTest.kt`).
- **Android Up Next card:** Disney+-style corner card in the Android overlay (`tvm-android.js` section 21b, `tickNextUp`; CSS section 39). The shared `NextUp.tsx` window is 30-60 s, preferred 45 s.
- **Android press-and-hold 2x:** held speed in `TvmNativePlayer.kt`, plus the top-pull scroll fix.
- **Android TV:** the overlay is off on television (`TvmShellScripts.boot(!television)`, `MainActivity.kt` 175-177, 873).
- **Android LAN pairing:** private IPv4 only, `POST /api/lan/session` with a bearer of 32+ chars (`Connection.kt`, `SessionClient.kt`). The native player bridge attaches only to the loopback origin (`MainActivity.kt` 320-331).
- **iOS glass bar:** `TVMGlassBar.swift` floating 5-tab bar and You popup. Liquid Glass on iOS 26 (`.glassEffect`, interactive), `.ultraThinMaterial` fallback. It presses the page's own buttons. Tab icons are generated from the Android CSS by `ios/generate-tab-icons.mjs`.
- **iOS video engine:** VLC runs under the page (`TVMVideoEngine.swift`) and replaces the deleted `TVMPlayerController.swift`.
- **Downloads:** Android uses an SAF folder, resumes after drops, and counts a file only when complete (queue cap 1000). iOS uses `TVMDownloads.swift` with language and max-height prefs ported from Android. Windows reserves names without overwrite (`SafeName`) and clears downloads on account change. Web uses the native bridge or File System Access API.
- **Legacy Live TV grants:** `grantLiveTv(true)` records lifetime. Quarter, year and lifetime terms with expiry are honoured by `liveTvIsActive`. New code treats these as `source: 'legacy'`.
- **Manual activation:** `POST /api/admin/accounts/activate` is the only grant path that is active today. `GET /api/account` then calls `syncEntitlement`, which sets plan `max`. The admin Live TV toggle flips `stream` and `stream-live`.
- **Account gate:** sign-in, register, email verify, terms acceptance. Sessions are 30-day fixed TTL, revoked on sign-out, suspend or erase. Web shows `AccountGate.tsx` when signed out. Windows and Roku mirror the same verbs.
- **Sealed storage:** AES-256-GCM sealed stores under `%LOCALAPPDATA%\TVM` (or `TVM_DATA_DIR`). Master key is DPAPI-wrapped on Windows. Writes go to tmp (wx, 0600) then rename.
- **Focus memory and Back:** each view entry keeps a `focusKey` and restores it on return (web `ViewStackProvider.tsx` 164-176 and 338-357, Windows `view_stack.cpp` 52-53 and 96-104, Roku `viewStack.brs`). Root is permanent. Home keeps root focus. Web edge swipe back works from a 28 px left edge.
- **Spatial navigation:** Norigin port on web (`focusEngine.ts`) and Windows (`focus_tree`, 4.1.0 centre-distance). Roku uses its own zone model (see section 5).
- **Reduce Motion:** the in-app setting is the only source on web, Windows and Android (Auto, Full, Reduced, plus Performance mode, which also strips `backdrop-filter`). iOS honours the OS flag natively.
- **Donate:** `/donate` mounts the stack at the donate screen (`main.tsx` 38). Presets 200/500/1000/2500 pence on Windows (`app_pages.cpp` 659).
- **Live TV picks and playlists:** picks capped at 48 (`live.h` 23, Roku `LivePicksScreen.brs` 56). M3U playlist limit 8 MB. Server Side Live rewrites HLS to `/api/live/proxy/<token>`.
- **Test pins:** Windows `nav-vectors.json` (generated from the web nav code) and about 492 ctest cases. Web Playwright `navigation.spec.ts` (28 tests: focus after every key, Back at root, focus restore). `mobile.spec.ts` and `responsive.spec.ts`. Roku `check.mjs` regex contracts.

## 3. Capability matrix

Copied from `clients.md` section 0.

Legend: ✅ present, ◐ partial, ❌ missing

| Feature | Roku | Web | Windows | Android TV | Android phone | iOS |
|---|---|---|---|---|---|---|
| Home browse | ✅ | ✅ | ✅ | ✅ (web UI) | ✅ | ✅ |
| Details | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Player | ✅ Video node | ✅ | ✅ mpv | ✅ Media3 | ✅ Media3 | ◐ MobileVLCKit; no subtitle command/track list in Swift |
| Up Next card | ❌ | ✅ NextUp.tsx | ◐ unverified | ✅ overlay | ✅ | ◐ shared web card only |
| Live TV guide (EPG grid) | ❌ M3U picker | ❌ no EPG | ❌ flat list | ❌ | ❌ | ❌ |
| Account/sign-in | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Plans/pricing | ❌ deferred to computer | ◐ stale 5-tier + hard-coded | ◐ hard-coded | ◐ hard-coded | ◐ hard-coded | ◐ hard-coded |
| Device pairing | ❌ not implemented | ❌ | ❌ | ❌ | ❌ | ❌ |
| Hub/devices (TVM Hub) | ❌ only ribbon hubs | ❌ (hub = service hub) | ❌ | ❌ | ❌ | ❌ |
| Remote control (receive) | ◐ D-pad/ECP only | ◐ key intents only | ◐ keys only | ◐ | ◐ | ◐ |
| Downloads | ❌ | ❌ | ❌ | ◐ TvmDownloads.kt, SAF (TV launcher unverified) | ✅ | ✅ TVMDownloads.swift |
| Reduce Motion | ❌ | ◐ in-app setting only; OS flag ignored | ◐ in-app only; OS ignored on purpose | ◐ in-app | ◐ in-app | ✅ OS honoured |
| Reduce Transparency | ❌ | ❌ blur not gated | ❌ (no real glass) | ❌ | ❌ | ❌ native |

Remote control row means "can be a controlled target"; no platform has cross-device command/handoff.

## 4. Core findings

Source: `core.md`, `apps/core` at main 0b2e454.

### 4.1 Headline findings

1. **No device model.** There is no device or installation model, presence, heartbeat or remote-control feature. `lastClient` (a UA string) is the only device-like datum.
2. **Accounts do not scope data.** Progress, watchlist and profiles live under `profiles/<profileId>/` with no account id in the path. The plan/entitlement record (`entitlement.enc`) is machine-wide and `syncEntitlement` overwrites it from whichever account last called `GET /api/account` (`server.ts` ~1312). The active profile is machine-wide too (`X-TVM-Profile` calls `media.switchProfile`, `server.ts` 491-498).
3. **Live TV grants are not enforced** on tune, proxy or segment (see 4.3).
4. **Persistence is whole-file sealed JSON** (AES-256-GCM, no AAD). No SQLite, transactions, fsync, lock or backups. An unreadable ledger silently falls back to empty and is overwritten on the next write (`accounts.ts` 298, `progress.ts` 17-37, `profiles.ts` 63-82, `watchlist.ts` 31-44).
5. **Billing conflict is real.** `accessTiers.ts` says GBP 9.99 (`STREAM_MONTHLY_PENCE = 999`), and both tiers map to plan `max`, whose `PLAN_CATALOG` price is GBP 15.99 (1599). Live TV terms in `liveTv.ts` are 39.99 / 89.99 / 599.00 in fields named as pence. None of these match the owner prices.
6. **Auth and LAN exposure gaps.** No sign-in throttle on `/api/account/signin`. The LAN "pairing code" is a static env token (`TVM_LAN_TOKEN`, 32+ chars, no TTL). `/api/account/dev` is not loopback-only. `/api/live` PUT, xtream and check, and `/api/usage/tick` are LAN-reachable, though the code comment says "host-only".

### 4.2 Billing: active vs legacy

| Piece | Status | Notes |
|---|---|---|
| Manual activation: `POST /api/admin/accounts/activate` sets `tier`; `GET /api/account` runs `syncEntitlement`, which calls `plans.set('max','checkout')`, `grantLiveTv(tier.liveTv)`, `grantCosmetics(true)` | **ACTIVE** (the real path) | The only path that grants today. `grantLiveTv(true)` records `liveTvTerm: 'lifetime'`, no expiry. `accounts.setLiveTv` flips `stream` and `stream-live`. |
| `accessTiers.ts`: 2 tiers, `STREAM_MONTHLY_PENCE = 999`, `planId: 'max'`, `ACCESS_ROUTE` ("arranged with the app owner"), `entitlementForTier()` | **ACTIVE** (display and mapping) | Served by `/api/tiers`. Indicative price only, "no checkout". Stream-live lists `LIVE_TV_CATALOG` as `liveTvTerms`, so stale offers still reach the UI. |
| `liveTv.ts`: `LIVE_TV_CATALOG` quarter 3999, year 8999, lifetime 59900; `liveTvServiceOnline` (env `TVM_LIVE_TV_ONLINE !== '0'`); `liveTvIsActive`; `liveTvExpiryIso` | **ACTIVE for evaluation, legacy for offers** | Feeds `compose()` into `PlanStatus.liveTv`. `serviceOnline=false` makes Live TV false for every entitled user, so an outage is entangled with the grant. |
| `plans.ts` (1201 lines): `PLAN_CATALOG` free/basic/premium/ultra/max (499 to 1599 pence), `priced()`, `grantMonthly`, `hoursBlocked`, `setLiveTv`, `compose` | **ACTIVE as an engine** (quality, `profilesMax`, styles, hours cap, mobile gate) | Checkout and pricing functions are **LEGACY**, loopback only. `PLAN_IDS` has five tiers. |
| `payments.ts`, `stripeClient.ts`, `stripeConfig.ts`, `billingProbe.ts`, `cardVault.ts`, `card.ts`, `charges.ts` | **LEGACY**, dormant unless Stripe keys are stored | `/api/billing/*` is loopback-only except the signature-verified webhook. UI still has callers (`apps/ui/src/data/plan.ts` 425-670). |
| `subscriptions.ts` (monthly plus a separate Live TV subscription, `invoice.paid` renewal, `armLiveTv`) | **LEGACY** | Keyed on quarter and year terms. Not the owner cadence model. |
| Dev overrides: `PUT /api/dev/overrides` to `plans.setOverrides`; `compose()` uses `over.liveTv` when `developer` | **ACTIVE, dev-only** | Dev flag is machine-wide. `over.liveTv` also overrides health. |
| Android and iOS local Cores (`TvmPlans`, `TVMPlans`) | **PARALLEL COPIES** | Re-implement `grantTier` and `mobileAllowed` natively. They need the same fix. |

### 4.3 Live TV gating gap

- `plans.status().liveTv` is consumed in one place only: `createLiveService({ includeMock })` (`server.ts` 1827). It gates only the **mock** channels.
- Real channels need only `accessError` to pass, plus `liveRelayRefused` (a "dev account signed in anywhere" flag) for non-loopback callers. There is no per-caller entitlement check.
- Not checked against `plans.status().liveTv`: `live.play(id)` (`live.ts` 1015-1036), `proxyChannel` (1218), `proxyHop` (1225), the SSL `/proxy/:token` handler, and `/api/live/catalog` (775). `/api/playback` with a `live:` id goes to `live.play` with no entitlement check.
- VOD is also open to remote callers: `accounts.usable()` is checked at `GET /api/account` and mpv install, but no media route requires a signed-in activated account. Remote access needs only the LAN token or session. This is the gap.
- Mobile gate (`mobilePlaybackBlocked`) sniffs the User-Agent and is spoofable (a desktop UA bypasses it).
- Live TV SSL tokens are HMAC-SHA256 of profileId and url, not expiring, not bound to account, channel or IP. The token is the bearer capability.

## 5. Roku findings

Source: `roku.md`. Paths under `apps/roku`. Line refs are approximate (working tree).

### 5.1 Structure

- Manifest: title TVM, v1.0.0, `ui_resolutions=hd,fhd`, `rsg_version=1.2`, `splash_color=#071033`. No min-firmware key. `check.mjs` requires hd and fhd.
- Plain BrightScript (no .bs). BrighterScript lint only (CI runs `brighterscript@0.73.5`, `release.yml` 177).
- `source/`: `main.brs`, `layout.brs` (scale = min(w/3840, h/2160), centred), `viewStack.brs` (pure stack), `intents.brs` (no "home" intent, so `intent = "home"` branches are dead), `config.brs` (registry section `tvm`; `coreOwnsUrl` stops token leakage), `api.brs` (one ApiTask per request), `media.brs` (home rails, `tvmRibbonSpec` with 17 entries), `tokens.brs`, `fonts.brs` (new Font node per call, no cache), `theme.brs` (light and dark only), `themeGlass.brs`.
- `ApiTask`: `json` is an assocarray field, so a top-level JSON array cannot be returned. Design new Hub payloads as objects.
- Components: `TVMScene` (71 KB brs: router, loads, keyboards, overlays), `HomeScreen`, `RibbonBar` (17 buttons), `PosterRail` (3 looping copies), `PosterCard` (275x412 portrait, 396x223 landscape), `DetailsPanel`, `PlayerScreen` (20 KB), `CatalogScreen`, `LibraryScreen`, `LiveScreen`, `LivePicksScreen`, `ChannelTile`, `SearchPanel`, `ProfilesScreen`, `ProfileScreen`, `ProfileOrb`, `AccountScreen`, `SetupScreen`, `SettingsScreen`, `AppsScreen`, `AppTile`, `ServiceScreen`, `RealDebridScreen`, `InfoScreen`, `FocusButton`, `GlassOverlay`.
- Canvas: `TVMScene.xml` authors a 3840x2160 `uiRoot`. `applyCanvasScale()` (TVMScene.brs ~102) gives s = 0.5 at FHD and 0.333 at HD.
- Type is far below target. Body is 34 and caption 26 canvas units, which is 17 and 13 device px at FHD. The brief wants 28-32 px primary and about 24 px secondary at 1080p (56-64 and 48 canvas units).

### 5.2 Focus and Back model

- Router: `navigate(kind,name,params)` (TVMScene.brs ~137) calls `rememberActiveFocus()` (only home, settings, setup and account store `focusKey`), mutates the stack, then `renderStack()` (~172). Screens are singletons, hidden and shown, never destroyed.
- Modals (notice, player, confirm, search) are built into `overlayHost` over a visible screen.
- Back: scene `onKeyEvent` (~1936) pops if `canGoBack`, else swallows it. Back on Home never exits. DetailsPanel intercepts Back only in the `episodes` zone.
- Focus is custom, not SceneGraph focus rings. Each screen keeps zone and column integers and paints children with `hasFocusStyle`. Home zones: `ribbon | hero (0 WatchNow, 1 LearnMore) | rails (row,col) | error`.
- Current flow: Home rail OK emits details. Details Play emits play, then `POST /api/playback`. `onPlayDone` pushes the player modal for kind `stream`. Back pops the player and Details regains focus. Back again pops to Home, which re-highlights the same tile.
- Hero Watch Now and Learn More both emit details. Home never emits play.

Restore weaknesses:
- The focus key is index-based (`rails:r:c`). `onHomePoll` (90 s) reloads `/api/home` and rebuilds every card. Continue Watching reorders after playback, so restore can land on a different title.
- `restoreKey` is a field with onChange. Setting the same string twice does not fire.
- DetailsPanel is a singleton. `onItem()` does not reset `zone`, `col`, `seasonCol`, `episodeCol` or `episodeRail`, so a stale zone can carry over to another title. Details and catalog focus is never stored.
- Rails wrap at both ends (left at col 0 jumps to the last card). The brief says wrap only where designed.
- RibbonBar's 17 entries include mock app hubs (Netflix, Prime) that are not in the new Home, Movies, Series, Live TV, Library, Search set.

### 5.3 Glass status

- Themes are light and dark only. Light mode is done by string-replacing Label and Rectangle colours across the tree (`repaintThemeNodes`). This is costly and fragile.
- `GlassOverlay.xml` is 9 stacked Rectangles plus a repeating 5.2 s sheen Animation. No screen references it. `applyGlassTheme` is gated on theme id `glass`, which `normalizeThemeId` can no longer return. **Glass is effectively dead code.**
- SceneGraph cannot blur or sample the framebuffer. Fills are flat colour with `cornerRadius` (37+ uses; firmware support is assumed, not gated).
- Assets: 13 PNG icons at 64 px. Poster masks, hero and details vignettes, lockup, and 20 app logos. **Zero 9-patch (`.9.png`) files.** No orb, ellipse, glass mask, specular or focus-ring asset exists.
- Fonts: Inter-Regular.otf and Inter-Bold.otf are present (259 KB and 271 KB). No Medium or SemiBold. `sync-assets.mjs` can fetch Inter (OFL).

### 5.4 Texture and node-count problems

- Node count: Home is about 8 rails x 16 cards x 3 copies x about 13 nodes (about 5k nodes), plus the 17-button ribbon, 4 repeating wash animations (`sceneWash`, 29-67 s), and every visited screen kept alive in `screenHost`. Budget target: under about 1500 live nodes.
- Hero Posters are 3840x1440 nodes with loadWidth/Height 1920x1080, two of them (A/B crossfade), about 8 MB decoded each.
- Details backdrop is 3840x2160 with no loadWidth/Height.
- PosterCard sets loadWidth/Height 780x1170 or 1280x720 while displaying at 275x412 or 396x223 canvas units (about 137x206 or 198x112 device px at FHD). That is about 3.5 MB decoded per card against about 0.1 MB needed. This is the biggest texture lever.
- `tvm-gem.png` and `tvm-stream.png` are identical 1024x1024 files (595 KB, about 4 MB decoded each).
- `tvmFont()` creates a new Font per call. Cache in globals.
- Verification: console `r2d2_bitmaps` on port 8085 and Roku memory docs. **No physical Roku has been tested** (`DEVICE_TESTING.md`), so all performance claims are unverified.

### 5.5 Core API usage (summary)

- Every request sends `Authorization: Bearer <coreToken>`, `X-TVM-Account` and `X-TVM-Profile`. Boot: no valid URL or token goes to SetupScreen (LAN token 32-512 chars). Otherwise `GET /api/account`; if `usable.ok`, enter Home, else AccountScreen.
- Endpoint groups: account, profiles, catalogue (`/api/home`, `/api/library`, `/api/media`, `/api/search`), watchlist, playback (`POST /api/playback` with 65 s timeout, `POST /api/progress`), live (`/api/live`, `/api/live/catalog?limit=8`, picks), apps, Real-Debrid, update status, maintenance.
- There is **no device registry, heartbeat, pairing-code flow or Hub** in `apps/roku`. Core has no hub or devices route. The Hub needs a new Core contract.

### 5.6 Tooling and check.mjs rules

- `node apps/roku/scripts/check.mjs` (no deps):
  - Hard-coded `requiredFiles` (about 80 paths, every component pair, `DEVICE_TESTING.md`, `preview/*`). Renamed or removed files fail.
  - Manifest keys, no BOM, hd and fhd present, `pkg:` refs resolve, PNG magic on a fixed list, Inter-Regular and Inter-Bold must exist, `config.example.json` credential-free.
  - XML sanity: every `<script uri>` resolves, TVMScene extends Scene, ApiTask extends Task and exposes `authToken` and `accountToken`.
  - Regex contract assertions on ApiTask, api, config, TVMScene, AccountScreen, HomeScreen, SettingsScreen and PlayerScreen (owner door, "I'm a dev", Skip Recap, overlay focus, `enableUI = false`, `m.video.focusable = false`). These break on rewrites unless the checker is updated.
  - Node whitelist `builtin`: Animation, Vector2DFieldInterpolator, FloatFieldInterpolator, MaskGroup, Timer, KeyboardDialog, StandardKeyboardDialog, Font, Poster, Rectangle, Label, Group, LayoutGroup, Task, Scene, Video, RowList, MarkupGrid, ContentNode. Any other standard node fails until added.
  - Bans JS `===` and `!==`, hard-coded IPv4, import and require. Checks sub and function end counts. Validates `tvm-roku.zip` if present.
- `scripts/package.mjs` builds `apps/roku/tvm-roku.zip` with its own zip writer (POSIX paths). `package.test.mjs` (node:test) is the only test. There are no BrightScript unit tests and no focus or layout fixtures.
- CI roku job: lint, reference checks, appends `tvm_commit` and `tvm_built_at` to the manifest, zips excluding `bsconfig.json` and `*.md`.
- `TVM-roku.cmd` runs `scripts/roku-dev.ps1`: Core, Vite for `apps/ui` on 5173, `?tv=1` (a React app letterboxed to 1920x1080, not the Roku runtime), packaging, optional sideload. No SceneGraph is exercised by preview.

## 6. Hard-coded prices to replace

Server truth (replaced by a server price book, `providers/priceBook.ts`, in the proposal):

| File:line | Literal | Note |
|---|---|---|
| apps/core/src/providers/accessTiers.ts:37 | `STREAM_MONTHLY_PENCE = 999` | GBP 9.99 per month |
| apps/core/src/providers/accessTiers.ts:39-71 (also :41-62 in web-part) | tiers `stream` and `stream-live`, both to plan `max` | Two-tier model |
| apps/core/src/providers/liveTv.ts:16-44 | quarter 3999, year 8999, lifetime 59900 | Stored as USD cents in fields named `amountPence` |
| apps/core/src/providers/liveTv.ts:46-47 | `LIVE_TV_ADDON_PENCE = 3999` | Add-on |
| apps/core/src/providers/plans.ts:52 | `PLAN_IDS` free, basic, premium, ultra, max | Legacy IDs |
| apps/core/src/providers/plans.ts:58-60 | Retro 499, Anime 499, theme bundle 999 | Add-ons |
| apps/core/src/providers/plans.ts:136-235 | free 0, basic 499, premium 899, ultra 1299, max 1599; profilesMax 1/2/4/6/10 | `PLAN_CATALOG` |
| apps/core/src/providers/payments.ts:45, 88-92 | currency `'GBP'` | Amounts come from `plans.quote` |

Web (`apps/ui`):

| File:line | Literal | Note |
|---|---|---|
| apps/ui/src/data/plan.ts:13 | `'quarter' \| 'year' \| 'lifetime'` | LiveTvTerm union |
| apps/ui/src/data/plan.ts:25-29 | 3999 / 8999 / 59900, "3-month", "1-year", "Lifetime", $39.99, $89.99, $599.00 | `LIVE_TV_TERMS` (duplicate of core) |
| apps/ui/src/data/plan.ts:127-132 | `FALLBACK_PLAN` id `free`, "TVM Free", liveTvTerms | Fallback |
| apps/ui/src/data/plan.ts:134-135 | animeAddonPence 499, themeBundlePence 999, synthwaveAddonPence 499 | Add-ons |
| apps/ui/src/data/plan.ts:36, 47 | `PlanId` free/basic/premium/ultra/max; `StreamTier` basic/premium/luxury | Legacy types |
| apps/ui/src/data/plan.ts:52-65 | `STYLE_CATALOG` minimum plans | Plan gating |
| apps/ui/src/data/plan.ts:142 | `stream: 'basic'` | Default plan |
| apps/ui/src/data/plan.ts:164-167, 418 | `'basic','premium','ultra','max'` allowlist | Validation |
| apps/ui/src/data/plan.ts:31-34 | `formatUsdCents` returns $ | Currency |
| apps/ui/src/data/plan.ts:323-324 | `formatBillingMoney` returns £ with `/100` | Currency |
| apps/ui/src/data/plan.ts:402, 405 | default term `'quarter'`; 3999 fallback | Checkout default |
| apps/ui/src/data/mobileAccess.ts:22 | `['premium','ultra','max']` | Phone gate |
| apps/ui/src/data/account.ts:6 | `'stream' \| 'stream-live'` | AccountTier |
| apps/ui/src/screens/Plans.tsx:13, 32 | comments "five tiers", "same 9.99" | Stale copy |
| apps/ui/src/screens/Plans.tsx:40-75 | cheapest term, "plus Live TV from", term list | Renders prices |
| apps/ui/src/screens/AccountGate.tsx:59-95 | signed-out price list | Renders prices |
| apps/ui/src/screens/LiveTV.tsx:230 | "3-month $39.99, 1-year $89.99, or lifetime $599" | USD copy; core is GBP |
| apps/ui/src/screens/LiveTV.tsx:231 | "Live TV is available on Basic and up" | Stale (now `stream-live` only) |
| apps/ui/src/screens/Donate.tsx:58, 91 | default 500 pence; posts `amountPence` | Donate |
| apps/ui/src/screens/Developer.tsx:18 | `ORDER` of five legacy plan IDs | Developer panel |
| apps/ui/src/screens/Library.tsx:189, 229 | `plan.stream !== 'basic'` | Rail gating |
| apps/ui/src/screens/service.css:384-406 | `data-plan='basic'`, `'max'` | Layout by plan |
| apps/ui/src/screens/Accounts.tsx:44, 193-211 | `'stream-live'`, `'stream'` | Admin tier switch |
| apps/ui/src/screens/Account.tsx:19-20 | tier strings | Label |
| apps/ui/src/screens/Settings.tsx:57 | `'stream-live'` | Label |
| apps/ui/src/screens/BillingSummary.tsx:53 | "3-month, 1-year or lifetime" | Copy (dead code) |
| apps/ui/src/components/StripeCardPanel.tsx:30 | loads js.stripe.com, "Pay £…" | Dead code |
| apps/ui/e2e/navigation.spec.ts:101-126, 691 | £7.99 to £18.99; liveTvAddonPence 300 | Stale test fixture |
| apps/ui/e2e/account.ts:11 | `tier: 'stream-live'` | Test fixture |

Android (`apps/android`, `.../TvmPlans.kt` is `android/app/src/main/java/com/tvm/privateclient/TvmPlans.kt`):

| File:line | Literal | Note |
|---|---|---|
| TvmPlans.kt:26-27 | `formatGbp` shows £ | Formatter |
| TvmPlans.kt:68, 128-190 (plans at 129, 141, 153, 167, 181) | free 0, basic 499, premium 899, ultra 1299, max 1599; liveTvAddonPence 3999 | Plan catalogue (duplicate of core) |
| TvmPlans.kt:113 | ranks `free, basic, premium, ultra, max` | Ranks |
| TvmPlans.kt:116-124 | style minimum plans | Gating |
| TvmPlans.kt:222 | checkout charges `plan.basePricePence` | Checkout |
| TvmPlans.kt:245-253 | packs 499, 499, 999 | Add-ons |
| TvmPlans.kt:260-262 | quarter 3999, year 8999, lifetime 59900, labelled `usdCents` | Live TV terms. Currency label error |
| TvmPlans.kt:320-324 | dev unlock to `max`; `stream-live` to lifetime | Tier mapping |
| TvmPlans.kt:353 | "3-month, 1-year, or lifetime" | Error copy |
| TvmPlans.kt:387-394 | term amounts; default `"quarter"` | Checkout |
| TvmPlans.kt:408-412, 434, 497-498 | 999, 499 | Pack and quote math |
| TvmPlans.kt:427-431 | full card `number` in body, last four kept | Must be removed |
| TvmPlans.kt:503, 525-532 | `"no_processor"` | No processor |
| TvmPlans.kt:650-651 | `MOBILE_PLANS`, `PACKS` | Gate |
| TvmAccounts.kt:318, 405, 447 | `"stream-live"`, `"stream"` | Tier strings |
| android/app/src/main/assets/Access.json:65, 113, 116, 118, 129, 132, 134, 137, 146, 155, 174 | tiers, `planId` max, terms, "The prices above are what access costs" | Bundled copy; tier objects carry no price field |

iOS (`apps/ios/TVM`):

| File:line | Literal | Note |
|---|---|---|
| TVMPlans.swift:38-39 | `formatGbp` shows £ | Formatter |
| TVMPlans.swift:70-74 | plan IDs; basePricePence 499, 899, 1299, 1599; liveTvAddonPence 3999 | Plan catalogue (duplicate of core) |
| TVMPlans.swift:80-86 | `mobileAllowed` (premium, ultra, max) | Gate |
| TVMPlans.swift:59-67 | style minimum plans | Gating |
| TVMPlans.swift:122, 127 | 499 (synthwave, anime), 999 (bundle) | Packs |
| TVMPlans.swift:133-135 | quarter 3999, year 8999, lifetime 59900 (`usdCents` label) | Live TV terms. Currency label error |
| TVMPlans.swift:184-193 | `tier == "stream-live"`, `liveTvTerm = "lifetime"` | Mapping |
| TVMPlans.swift:189-191 | dev unlock to `max` | Dev unlock |
| TVMPlans.swift:216 | "3-month, 1-year, or lifetime" | Error copy |
| TVMPlans.swift:254-261 | checkout term amounts; default `"quarter"` | Checkout |
| TVMPlans.swift:270-271, 289, 346 | 999, 499 | Quote math |
| TVMPlans.swift:283-287 | full card number, last four kept | Must be removed |
| TVMAccounts.swift:359, 368, 463, 482 | `"stream-live"`, `"stream"` | Tier strings |
| ios/TVM/Access.json:65 | "£100" | Liability copy |
| ios/TVM/Access.json:118, 134, 177 | monthlyPence 999; `"stream-live"` | Bundled copy |
| ios/TVM/Access.json:137-158 | quarter, year, lifetime with 3999, 8999, 59900 | Bundled Live TV terms |

Windows (`native`):

| File:line | Literal | Note |
|---|---|---|
| native/src/ui/pages.cpp:20, 47-48 | `kPound`; `Money()` (£) and comment "£9.99" | Formatter |
| native/src/platform/app_pages.cpp:66-68 | duplicate `Money()` | Duplicate |
| native/src/ui/pages.cpp:486-491 | `kLiveTerms`: 3-month 3999, 1-year 8999, Lifetime 59900 | Duplicate of core |
| native/src/ui/pages.cpp:495-508 | `Tiers()` copy; comment "both are 9.99 a month" | Tiers |
| native/src/ui/pages.cpp:500-501 | `kMonthlyPence = 999` | Software price |
| native/src/ui/pages.cpp:570, 587-611 | "plus Live TV from £39.99"; Live terms list | Copy |
| native/src/platform/app_pages.cpp:568-579, 573 | "3-month, 1-year and lifetime" | Legal copy |
| native/src/platform/app_pages.cpp:659 | donation presets 200, 500, 1000, 2500 pence | Donate |
| native/src/platform/app_pages.cpp:494-495 | `"stream-live"`, `"stream"` | Admin switch |
| native/src/platform/app_pages.cpp:1351, 1383 | "Movies, TV & Live", "Live TV: on/off" | Labels |
| native/src/core/admin.cpp:158, 172 | `"stream"`, `"stream-live"` | Tier validation |
| native/src/core/core_client.cpp:34 | `tier == "stream-live"` | Entitlement |
| native/src/platform/app.cpp:1680 | `profilesMax` default 10 | Limit |
| native/src/platform/app.cpp:1482 | Live TV button inserted unconditionally | Gating unverified |
| native/tests/pages_tests.cpp:124 | "£9.99/month" | Test assertion |

Docs and Roku:

| File:line | Literal | Note |
|---|---|---|
| docs/ACCESS.md:11-15 | £9.99/month; £39.99, £89.99, £599 | Matches core, but GBP |
| docs/PAYMENTS.md:238 | £12.99 | Refund example |
| apps/roku/components/TVMScene.brs:1169 | `body.tier = "stream-live"` | Owner code grants Live TV |
| apps/roku/components/TVMScene.brs:1609 | "Core allows up to five profiles" | Limit 5; core allows 10 |
| apps/roku/components/ProfilesScreen.xml:15 | "Add is limited to five" | Same limit |
| apps/roku/components/TVMScene.brs:1527 | "Live TV holds 48 channels" | Limit |
| apps/roku/components/LivePicksScreen.brs:56 | default `pickLimit` "48" | Limit |
| apps/roku/components/TVMScene.brs:1451 | `?limit=8` | Live rail size |
| apps/roku/components/TVMScene.brs:577, 1272; SettingsScreen.brs:73, 75 | "Manage on your computer", "Billing, updates and data controls" | Copy |
| apps/roku/source/media.brs:387-415 | hub labels, "TVM Stream", "Live TV" | Labels, not prices |

Note: no client copy contains 1000, 9000, 700, 6000, 1700 or 15000. The proposed price book v1 offers are `tvm.base.month` 1000, `tvm.base.year` 9000, `tvm.liveTv.month` 700 and `tvm.liveTv.year` 6000 (bundles 1700 and 15000). Scripts and packages hold no prices.

## 7. Risks

Merged and de-duplicated. Source report in brackets.

| # | Risk | Source |
|---|---|---|
| 1 | Billing conflict: stream tier GBP 9.99 maps to plan `max` (GBP 15.99). Live TV terms are labelled USD but charged as GBP. None match owner prices. | core 5; prices; clients E |
| 2 | Currency labels are wrong: `liveTv.ts` and the native and mobile `usdCents` fields hold pence or GBP values. UI shows $ while core is GBP. | prices; core 5 |
| 3 | Live TV entitlement is not enforced on tune, proxy, segment, catalog or `live.play`. Only mock channels are gated. | core 3, 4.3 |
| 4 | Remote callers reach VOD with only the LAN token or session. No route requires an activated account. | core 4.3 |
| 5 | Machine-wide entitlement, profile and dev state will conflict with multi-account behaviour. Progress, watchlist and profiles are not scoped to an account. | core 2 |
| 6 | Silent reset on unreadable ledger (`accounts.ts` 298, `progress.ts`, `profiles.ts`, `watchlist.ts`) can wipe grants. Must be fixed before billing or device data is added. | core 4, 271 |
| 7 | Deleting `secrets/master.key` silently regenerates it and resets all sealed stores. | core 46 |
| 8 | Writes are whole-file, with no fsync, lock, backups or migration framework. | core 4, 270 |
| 9 | No sign-in throttle on `/api/account/signin`. | core 6 |
| 10 | LAN pairing token is static (no TTL), and the limiter is global, not per IP. | core 2, 6 |
| 11 | `/api/account/dev` is not loopback-only. `/api/live` PUT, xtream and check, and `/api/usage/tick` are LAN-reachable. | core 6 |
| 12 | Mobile UA gate is spoofable. | core 142 |
| 13 | Dev unlock grants `max` and `stream-live` on Android, iOS and Roku, duplicated in client code. | clients 406; prices |
| 14 | Android and iOS checkout accept the full card number over loopback HTTP and keep the last four. This breaks "never capture raw cards" and must be removed. | clients E, mobile 8 |
| 15 | Android and iOS re-implement Core routes (`TvmLocalCore.kt`, `TVMLocalCore.swift`). Any contract change needs three implementations. Drift is guarded only by string checks. | clients 3; mobile 3 |
| 16 | Shared data is exported from core (`Access.json`), but the copies are bundled per platform and can drift. | mobile 3 |
| 17 | Live TV SSL tokens never expire, are not bound to account, channel or IP, and the resolve map is in memory only. Tokens die on restart and the map grows without bound. | core 4 |
| 18 | No SSRF filtering on upstream fetches (no private, loopback or link-local blocklist). | core 4 |
| 19 | No EPG on any platform. `tvg-id` is parsed and never read. | core 4; clients |
| 20 | No refresh scheduler for M3U catalogues, cached indefinitely. | core 4 |
| 21 | Windows M3U parsing ignores `#EXTVLCOPT` and `#EXTHTTP` headers, which Core reads. | clients B 8 |
| 22 | Name collision: `/api/apps` and `hubSeeds.ts` are studio catalogue hubs. The TVM Hub must not use them. | core 5 |
| 23 | No device model, presence, heartbeat or pairing anywhere. The Hub is greenfield in Core and all clients. | core 1, 7; clients; roku 5.5 |
| 24 | No kids, restricted or PIN profile fields. The brief's server-side guard needs a new field and enforcement point. | core 5 |
| 25 | Roku texture memory: hero A/B about 8 MB each, PosterCard about 3.5 MB decoded against about 0.1 MB needed, and 4 MB decoded for the gem and stream images. Low-end HD boxes will thrash. | roku 5.4, Risks 2 |
| 26 | Roku node count about 5k against a budget of about 1500. Four repeating wash animations and kept-alive screens add to it. | roku 5.4, Risks 1 |
| 27 | Roku glass ceiling: no blur or shaders. 9-patch and `cornerRadius` support on the oldest firmware is unverified, and the manifest has no minimum firmware. | roku 5.3, Risks 3 |
| 28 | Roku focus restore is index-based. The 90 s Home poll rebuilds rails and can jump focus. DetailsPanel keeps a stale zone. | roku 5.2, Risks 9 |
| 29 | Roku focus is hand-rolled per screen. The Hub needs a table-driven, unit-tested model, and timers can race `setFocus`. | roku Risks 5 |
| 30 | Roku `check.mjs` regex contracts and whitelist break on any rewrite. | roku 5.6, Risks 7 |
| 31 | Roku type is below target. At 720p, 56-unit labels render at about 19 px. | roku 5.1, Risks 6 |
| 32 | Roku profile limit is 5, against core's 10. | prices; roku |
| 33 | No physical Roku has been tested. Every performance claim is unverified. | roku 5.4, Risks 10 |
| 34 | Reduce Transparency is not handled anywhere. Web glass blur, Windows (no setting), Android and iOS all ignore it. | clients 10; windows 10 |
| 35 | Reduce Motion: web and Android ignore the OS flag, Windows ignores it on purpose, and Roku has no setting. Only iOS honours it. | clients 10; windows 10 |
| 36 | Windows `GlassSweepMs` is dead code. There are no pixel goldens, and snapshots use placeholder `DemoRails`. | windows 3, 14 |
| 37 | Hard-coded GitHub repo `GL-327/TVM` in `update-native.ps1` and `app.cpp` 1744-1746. | windows 13 |
| 38 | Android manifest has no `LEANBACK_LAUNCHER` filter and no leanback `uses-feature`, so the APK will not show in the TV launcher. Not verified on a device. | mobile 7 |
| 39 | iOS VLC engine has no subtitle command or track list. `ios/README.md:54` claims embedded subtitles. | mobile 4 |
| 40 | iOS has no Up Next card of its own. The shared web card is probably shown as-is (unverified). | mobile 4 |
| 41 | Windows Up Next is unverified. Live TV is a flat list with no guide. | clients 0 |
| 42 | Web unit tests miss `.tsx`: vitest includes `src/**/*.test.ts` only, with 0 `.test.tsx` files. | web 8, 5 |
| 43 | Dead code: `StripeCardPanel.tsx`, `BillingSummary.tsx`, Roku `GlassOverlay`, Roku "home" intent branches, native `GlassSweepMs`, duplicate `Money()`. | web, roku, windows |
| 44 | Stale docs: `android/STANDALONE_STATUS.md` says no Android unit tests exist (there are 13). `Plans.tsx` and `LiveTV.tsx` say "Basic and up". | mobile 3; prices |
| 45 | Live TV outage behaviour is entangled with the grant (`serviceOnline` in `liveTvIsActive`). | core 3 |
| 46 | Native "Live TV" button is inserted unconditionally (`app.cpp` 1482). Whether it is gated for non-Live accounts is not verified. | windows 6 |
| 47 | Android TV uses the same APK path as phone (`!television` overlay rule). Keep TV-specific behaviour out of phone assumptions. | mobile 7 |
| 48 | Native and web legal copy hard-codes the Live TV term names, so it drifts from the price book. | web 5, windows 6 |
