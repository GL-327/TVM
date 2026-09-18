# Mobile testing handoff — 18 September 2026

## Implemented

- Mobile viewing requires **Premium, Ultra or MAX**, with a plan cap of at least 1080p. Free and Basic are still available on television/desktop. Plan selection, setup, legal pages and DEV settings remain accessible on mobile. DEV can select a paid test plan; Free does not silently become a paid plan.
- The shared UI checks mobile entitlements before mounting viewing screens. Core rejects mobile playback/stream requests on Free; the standalone iOS Core independently rejects playback. Native shells identify themselves as TVM-iOS / TVM-Android. These are private testing controls, not a replacement for verified subscription receipts or device attestation.
- iPhone supports both landscape orientations. The app fills the screen; the **hero band** is the 16:9 rectangle, running the full width of the glass and up under the status bar and Dynamic Island the way a native app does, with a scrim so the system clock stays legible over bright artwork. The video uses `object-fit: contain`; cinema/4:3 sources retain their proportions. iPad can still rotate. 16:9 describes shape, not resolution; a paid plan does not upscale a low-resolution source.
- Actual WebKit screenshots exposed a mobile selector that hid the entire launcher label. It now hides only the subtitle, and landscape places Stream, Live TV, Watchlist and Apps in one readable row. Browser tests assert those labels stay visible.
- Safari/WKWebView prefers native HLS even when MSE is available. iOS 16 has cancellation API fallbacks. Desktop/Android retain the existing JavaScript player where native HLS is unavailable.
- iOS now opens HLS Live TV independently of Real-Debrid. Xtream setup actually retrieves a provider playlist, requests `output=m3u8`, checks HTTP success and requires channels before accepting the connection. Raw TS gets a specific recovery message.
- Mislabelled MKV/WebM/TS downloads no longer bypass the converter check. Real-Debrid conversion prefers its documented `apple` HLS and `liveMP4` groups, never WebM disguised as MP4, and chooses a known resolution within the plan cap. Owned RD downloads retain the conversion ID.
- Every current bundled fallback title now has an IMDb ID, including [10 Truths About Love](https://www.imdb.com/title/tt15483404/). Network access is still needed for actual streaming and fresh catalogue metadata.
- Continue Watching now stores enough title metadata (including slug→IMDb aliases) to rebuild the rail even when the title has left the current catalogue, and it appears after about **30 seconds** watched instead of 4% of runtime.
- Phone search uses the system keyboard (`visualViewport`), tappable results, and the same Home `launchTitle` path (details + Real-Debrid connect notice), not a TV-only hover rail.

## How to test

Open mobile Settings → DEV to select Premium or higher for testing, or use the existing sandbox plan flow. There is no live payment processor or verified paid subscription service. On Android/home-Core mode, select the test plan on the Windows host because billing/DEV administration stays host-only.

`pnpm -r run typecheck`, `pnpm -r run test`, `pnpm -r run build` cover this workspace. Browser coverage now includes WebKit at 568×320, 704×396 and 800×450: Free gating, touch access to Plans, paid Home, actual running background transforms, and rail scrolling. Screenshots are written to `cache/ios-webkit-*.png`; they use fixture catalogue entries. This is Windows WebKit testing, not an installed iPhone test.

`node apps/ios/bundle-ui.mjs --copy-only` copies the freshly built UI into the native app. `node apps/ios/check-project.mjs` validates package structure. `.github/workflows/mobile.yml` already builds/tests with Xcode on a macOS runner and produces an unsigned IPA. Run it on a commit containing these changes; an old downloaded IPA will not contain them.

### 18 September 2026 — phone shell and keyboards

Four things were missing or wrong. They are listed with how each was proven,
because two of them had been written down as done.

**The 16:9 fitted rectangle was never implemented.** `.app` was `width: 100%;
height: 100dvh`, and the browser test that asserted `.app` is 16:9 ran only at
568×320, 704×396 and 800×450 — viewports that are already 16:9, so it could
not fail. The hero is now a real 16:9 band (`min-height: calc(100vw * 9 / 16)`,
so a long title grows it rather than overflowing) that starts at y=0 and runs
under the island, with `--tvm-safe-y` holding the copy clear of it. Measured on
a 390×844 notch device: hero 219px at ratio 1.778, first content at y=68.

**The search sheet opened under the Dynamic Island.** `.search-pill` used
`env(safe-area-inset-top, var(--tvm-chrome-top))`. A CSS `env()` fallback is for
browsers that do not know the variable, not for one that resolves it to 0, so it
never fired and the field got about 10px of top inset. `max()` of the two is the
question that was meant to be asked. Measured: 47px of padding, field at y=57.

**The bottom bar was eight destinations on two rows**, about a sixth of the
screen. It is now one row of five — Home, Search, Live TV, Watchlist, More —
with Profile, TVM Library, Apps and Settings in a sheet behind More. The sheet
has its own opaque fill: the per-theme `.ribbon` fills are translucent by design
and the nav's background box only covers the tab strip, so an inherited fill let
poster art show through the rows. HDMI Inputs is dropped on a phone; it asks you
to change your television's input. Measured: bar 749–844, five equal columns,
every tab at least 44px tall.

**`mobilePlanAllowed` said `basic`** while `apps/core/src/mobileAccess.ts`, the
iOS plans and the Android plans all said `premium`. The interface let a Basic
account into the catalogue and open a title, and core then refused
`/api/playback`. The client copy exists only to prevent that, so a looser copy
is worse than none; it now matches core.

`FocusField` now derives `inputMode` and `enterKeyHint` from `type` when a screen
does not name them, accepts `email` and `tel`, and takes `autoCapitalize` — so a
server-URL field gets `/` and `.com` and a Go key, and a provider username is not
capitalised. The sign-in form already carried its own keyboard and autofill
attributes (`gateKeys.ts`, 17 September); this covers every other field.

Browser tests: the one-rail fixture Home in `e2e/mobile.spec.ts` fitted on one
390×844 screen once the bar became a single row, so "horizontal rails yield
vertical pans to the page" had nothing to pan and failed for a reason unrelated
to rails. The fixture now has four rails, as a real Home does, and the test
asserts the page overflows before it pans. The default-theme boot key moved to
`apps/ui/src/theme/bootKey.ts` so specs import it; it had been renamed three
times (isle, cinematic, orbit) and each rename silently reset the theme the
specs pinned. 12 of 12 mobile cases pass. Four cases in `navigation.spec.ts` and
`anime.spec.ts` fail identically on clean `main` and are not addressed here.

## Remaining gates — do not mark these complete without evidence

Windows verification completed: production build/type checking passed; 693 unit/API tests passed across the workspace run and the added HTTP-boundary test. All 24 browser cases passed across the main run and targeted reruns after correcting two outdated Settings-focus test assumptions. The final four WebKit cases also run with native `AbortSignal.any/timeout` removed to exercise iOS 16 compatibility. iOS package validation: 177 passed, no warnings/failures. Android structure validation: 88 passed, no warnings/failures. Final production UI was copied into `apps/ios/TVM/BundledUI`. These counts exclude XCTest, which requires Xcode.

### Re-verified 14 September 2026, after the background and tab-bar pass

The animated stage was still switched off for every theme except the paid Retro
pack: `SceneField` returned `null` and `.tvm-scene` was `display: none`, so
Default, Light, Dark, Happy, Sunset, Heather and Liquid Glass all painted a flat
colour. It is now mounted in `App.tsx` as six CSS gradient layers behind the
screen stack (`.tvm-scene` z-index 0, `.app__screen` z-index 1), animating
`transform`/`opacity` only, on 19–34s periods rather than the previous 41–97s —
which was motion slow enough to read as a still image. Confirmed running in a
real browser: six layers, six running animations, all six transforms advancing
over a 1.5s sample. Reduced Motion and Performance mode switch it off, the
player and Retro hide it, and `sceneEngine.test.ts` now fails if it is disabled,
slowed past 40s, or given a non-compositor property again.

The mobile bottom tab bar was translucent over scrolling content: the per-theme
`[data-theme='x'] .ribbon` rules outrank `.ribbon` in `mobile.css` on
specificity, so rail titles and poster art showed through the tab labels. Fixed
with matching-specificity selectors plus a backdrop blur.

Counts after this pass: 697 unit tests (core 242, ui 396, shell 23, nav 36), all
five workspace typechecks clean, production build clean, iOS package validation
179 passed, Android 89 passed, Roku static checks passed. The rebuilt production
UI was copied into `apps/ios/TVM/BundledUI`, so the iOS app ships these fixes —
a CI IPA built from a commit that predates them will not contain them.

1. **Xcode compilation/XCTest and physical iPhone acceptance remain required.** Windows cannot compile the Swift/iOS SDK project. The added Swift tests cover frame geometry, mobile plan access, HLS Live TV and compatible RD transcode selection; run them in the macOS workflow/Xcode.
2. **Signing is required.** A freshly compiled unsigned IPA still needs the owner's Apple signature through their chosen signing workflow. No signing identity or provisioned iPhone is available in this workspace. Follow [IOS_TESTING.md](IOS_TESTING.md).
3. **No on-device FFmpeg/remuxer is bundled.** If RD does not provide compatible HLS/MP4, standalone iOS cannot play an MKV/unsupported-codec source. Raw live MPEG-TS needs an HLS feed from the provider or the optional home Core with FFmpeg. Higher plans remove the Free tier restriction; they do not add codecs.
4. Test authorised real MP4/HLS streams, provider credentials, seeking, resume, audio, landscape safe areas, keyboard, lock/unlock, offline recovery and AirPlay on the actual iPhone. No provider credentials were used in these automated checks.
5. Native Android assembly/device testing is outside this iOS testing pass. Its project structure and shared entitlement policy are checked; no new tested APK is claimed.

Technical references: [Real-Debrid streaming formats](https://api.real-debrid.com/), [Apple supported orientations](https://developer.apple.com/documentation/bundleresources/information-property-list/uisupportedinterfaceorientations).
