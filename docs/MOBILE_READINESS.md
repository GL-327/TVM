# Mobile testing handoff — 14 September 2026

## Implemented

- Mobile viewing requires **Basic, Premium, Ultra or MAX**, with a plan cap of at least 1080p. Free is still available on television/desktop. Plan selection, setup, legal pages and DEV settings remain accessible on mobile. DEV can select a paid test plan; Free does not silently become a paid plan.
- The shared UI checks mobile entitlements before mounting viewing screens. Core rejects mobile playback/stream requests on Free; the standalone iOS Core independently rejects playback. Native shells identify themselves as TVM-iOS / TVM-Android. These are private testing controls, not a replacement for verified subscription receipts or device attestation.
- iPhone supports both landscape orientations. Its web app is centred inside a **16:9 rectangle that fits the available safe area**, with black borders on wider displays. The video uses `object-fit: contain`; cinema/4:3 sources retain their proportions. iPad can still rotate and gets the same fitted rectangle. 16:9 describes shape, not resolution; a paid plan does not upscale a low-resolution source.
- Actual WebKit screenshots exposed a mobile selector that hid the entire launcher label. It now hides only the subtitle, and landscape places Stream, Live TV, Watchlist and Apps in one readable row. Browser tests assert those labels stay visible.
- Safari/WKWebView prefers native HLS even when MSE is available. iOS 16 has cancellation API fallbacks. Desktop/Android retain the existing JavaScript player where native HLS is unavailable.
- iOS now opens HLS Live TV independently of Real-Debrid. Xtream setup actually retrieves a provider playlist, requests `output=m3u8`, checks HTTP success and requires channels before accepting the connection. Raw TS gets a specific recovery message.
- Mislabelled MKV/WebM/TS downloads no longer bypass the converter check. Real-Debrid conversion prefers its documented `apple` HLS and `liveMP4` groups, never WebM disguised as MP4, and chooses a known resolution within the plan cap. Owned RD downloads retain the conversion ID.
- Every current bundled fallback title now has an IMDb ID, including [10 Truths About Love](https://www.imdb.com/title/tt15483404/). Network access is still needed for actual streaming and fresh catalogue metadata.
- Continue Watching now stores enough title metadata (including slug→IMDb aliases) to rebuild the rail even when the title has left the current catalogue, and it appears after about **30 seconds** watched instead of 4% of runtime.
- Phone search uses the system keyboard (`visualViewport`), tappable results, and the same Home `launchTitle` path (details + Real-Debrid connect notice), not a TV-only hover rail.

## How to test

Open mobile Settings → DEV to select Basic or higher for testing, or use the existing sandbox plan flow. There is no live payment processor or verified paid subscription service. On Android/home-Core mode, select the test plan on the Windows host because billing/DEV administration stays host-only.

`pnpm -r run typecheck`, `pnpm -r run test`, `pnpm -r run build` cover this workspace. Browser coverage now includes WebKit at 568×320, 704×396 and 800×450: Free gating, touch access to Plans, paid Home, actual running background transforms, and rail scrolling. Screenshots are written to `cache/ios-webkit-*.png`; they use fixture catalogue entries. This is Windows WebKit testing, not an installed iPhone test.

`node apps/ios/bundle-ui.mjs --copy-only` copies the freshly built UI into the native app. `node apps/ios/check-project.mjs` validates package structure. `.github/workflows/mobile.yml` already builds/tests with Xcode on a macOS runner and produces an unsigned IPA. Run it on a commit containing these changes; an old downloaded IPA will not contain them.

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
