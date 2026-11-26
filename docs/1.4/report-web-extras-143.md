# Web and phone UI Extras, 1.4.3

Implemented React UI paths for the ten items in `codex-web-extras.md`.
Typecheck, the full Vitest suite and the production build pass. The Core watched-state
contract and native phone player controls still need the integration work described below;
screenshots and real-media playback were not verified.

## Spec 5: playback information and versions

- Stats is always available through **I** and **Playback settings > Stats**. It updates once
  per second while open, showing video dimensions, MIME/container, known codec/HDR,
  dropped/total browser frames, estimated bitrate, the returned version label and buffer ahead.
  Bitrate uses `version.bitrateMbps`, otherwise full-file `sizeBytes / duration`; unsupported
  values say **Unknown**. It does not present a network speed or an HLS fragment size as file bitrate.
- Details fetches `/api/playback/versions` when version picking or quality badges are enabled.
  Recommended versions appear first, preserving Core ordering within each group. Film and
  episode identities are shared with playback. Series Details has an episode select alongside
  the version select. Choices are memory-only and `requestPlayback` adds the selected
  `versionId` to the existing POST. Existing request/response behaviour is otherwise retained.
- **Playback settings > Version** opens the same native select. Choosing a source calls the
  existing Retry action, which already saves the current position in `retryAt` and sends it as
  `startAt` on the new request. A disabled preference or remote flag omits `versionId`.
- Details quality badges come from the first recommended version. Poster cards use only
  already-present `height`, `hdr` and `audio.atmos` data; no poster initiates a quality request.
  Optional quality metadata survives `MediaItem`/`Title` conversion.

## Spec 7: Extras behaviour

- **Sleep timer:** Off, 15/30/45/60 minutes and End of episode; seeded from
  `sleepTimerDefault`. Minute choices use a wall-clock deadline. Expiry fades volume for five
  seconds, pauses and displays **Sleep timer ended** with **Resume**. End of episode starts
  fading in the final five seconds and suppresses Next Up so autoplay cannot beat the timer.
  Volume is restored on cancellation, Resume or leaving. Native fades use the existing
  bridge volume command without changing the stored room volume or unmuting the viewer;
  native volume is restored after pausing so its own Play control can resume audibly.
- **Night mode:** a `DynamicsCompressorNode` is inserted after the existing boost gain and
  bypassed when switched off. The source/gain graph is reused, so a video never gets a second
  `MediaElementAudioSourceNode`. Non-CORS media keeps normal playback without compression.
- **Pause when hidden:** pauses on `document.visibilityState === 'hidden'`, with no automatic
  resume. Excluded for `TVM-iOS` and `TVM-Android` user agents.
- **Keyboard shortcuts:** `?` opens/closes a sheet, Escape closes it, and the rows are derived
  from the actual `PLAYER_KEY_MAP` in `KeyboardMap.ts`. Desktop/web only. Select fields retain
  their browser keyboard behaviour. Sheets trap Tab and make the underlying chrome inert.
- **Spoiler blur:** episode stills blur and synopsis text is omitted until **Show summary**.
  Explicitly watched episodes, or episodes carrying progress above Core's 96% finish threshold,
  stay normal. Explicit `watched: false` takes precedence over progress.
- **Trailer backdrops:** after three seconds on active Details, the known Trailer source
  becomes a muted looping `youtube-nocookie` embed beneath the vignette. It has no controls,
  pointer interaction or tab stop, covers the stage and fades in after loading. Hidden Details,
  playback, opening the full trailer, reduced motion or disabling the feature removes the
  iframe and stops it. Desktop/web only.
- **Theme songs:** default remains off. Active Details fetches `/api/extras/theme?id=`, plays
  the returned audio at 25% with a two-second fade in, and fades out/disposes it on leave,
  hiding or playback. Missing endpoints, failed requests and autoplay rejection stay silent.
  Desktop/web only.
- Every switch-backed feature uses `extraEnabled(id, prefs)` and `isExtraAllowed(id)` through
  the shared UI gating helper. Preference changes, storage changes and `applyRemoteFlags`
  notifications update mounted features. Version/theme 404s quietly hide/skip the feature.
- Player tools now open in a scrollable Playback settings menu at every width, keeping the
  additional controls out of the transport row. The menu yields Escape to an open Extras sheet.

## Verification

Commands run from `apps/ui`:

- `node ../../node_modules/typescript/bin/tsc -p tsconfig.json --noEmit`: **passed**.
  TypeScript is installed at the workspace root rather than in this package's node_modules.
- `node node_modules/vitest/vitest.mjs run`: **95 files, 546 tests passed** in the final run
  after all code changes (10:47:58 local start, 41.29 seconds).
- Final focused run after the native restoration change: **4 files, 21 tests passed**
  (`iosEngine`, `audioGain`, `extrasLogic`, `playbackVersions`), plus typecheck passed again.
- `node node_modules/vite/bin/vite.js build`: **passed**, 917 modules. Existing warnings remain
  about the statically/dynamically imported playbackErrors module and the HLS chunk size.
- `git -c safe.directory=C:/Users/Arthur/Desktop/TVM diff --check -- <owned edited paths>`:
  **passed**. Edited source files were normalised to LF.
- Added pure-logic tests for all sleep deadlines/fade bounds, end-of-episode conditions,
  bitrate/stat formatting and buffer gaps, stable recommended ordering, episode identities,
  version request payloads/remote gating, missing endpoints, phone exclusions, quality
  metadata conversion and watched-state interpretation. Web Audio tests verify graph reuse,
  compressor bypass and the CORS fallback. The existing native engine test now verifies that
  a temporary fade sends volume without a mute command and is detached on destruction.

The first full run caught two issues in this work (undefined `recommended` values and the
repository's ban on CSS reduced-motion media queries); both were fixed. A simultaneous
Liquid Glass test failure in another builder's files was resolved before the passing full
runs. A later adaptive-ink assertion also changed during an in-flight run; its focused
rerun and the final full suite passed. No files belonging to that work were edited here.

## Integration work and unverified behaviour

1. **Core must expose episode watched status.** `apps/core/src/providers/media.ts` currently
   returns `meta.children` directly from `children()`. Its `applyProgress()`/`ratio()` path also
   intentionally omits finished progress. Consequently this UI cannot identify previously
   completed episodes from today's response. Add an optional `watched` field to Core's
   `MediaItem` and populate every episode from the active profile's completion state
   (`isFinished`/`completedAt`), retaining normal resume progress separately. Phone Core
   implementations must return equivalent metadata. Until then, an episode with unknown
   completion state remains blurred when Spoiler blur is on.
2. **Native phone player controls need matching UI/DSP.** This implementation owns React
   chrome and its HTML5 Web Audio graph. The iOS/Android full-screen native playback surfaces
   cover the WebView: React sheets/stats/Resume cannot appear above them, and their decoded
   audio cannot pass through Web Audio. Details version choice/badges/blur are wired, and the
   mounted React timer can send native volume/pause commands. Native player owners must mirror
   the in-player version/stats/timer UI and implement native night compression. No claim is
   made that these native controls are completed by this React-only change.
3. **No screenshots were captured.** Browser discovery returned
   `The browser access host is unavailable`. Automatic approval review then rejected access
   to the available Opera GX window with `Computer Use was not approved to use Opera GX
   Browser`, with no further reason. No security setting was changed or alternate browser
   automation attempted. The temporary local preview files and Vite server were removed/stopped.
   Desktop 1920x1080, 1280x720, phone portrait/landscape and fullscreen visual checks remain due.
4. Real source switching, five-second audible fades, compressor sound, YouTube autoplay and
   live theme extraction were not tried with a real account/media source or physical phone.
   Browser autoplay restrictions can prevent theme audio, in which case it remains silent.
   A minute timer currently belongs to a player instance; opening the next player starts its
   configured default timer rather than carrying the previous instance's deadline.

## Lead integration and changelog

No commits, pushes, branches, stashes, resets or checkouts were made. No version files,
shared content/changelog, HANDOFF or CLAUDE files were edited; the brief reserves those for
the lead. Include appropriate notes in the same integration commit, then run the content and
changelog checks. Suggested short lines (platforms `web`, `desktop`, `ios`, `android` as
applicable; native-player limitations above still apply):

- Choose a playback version on Details and see known 4K, HDR and Atmos badges.
- Web and desktop players show playback stats, version choices and a sleep timer.
- Web and desktop can soften loud audio, pause when hidden and show keyboard shortcuts.
- Hide unwatched episode stills and summaries with Spoiler blur.
- Details can play muted trailer backdrops and optional quiet theme music on web and desktop.

Other platforms should match Core version labels/order, the 96% completion boundary, remote
feature flags and sleep-timer defaults. Desktop-only exclusions are intentional.
