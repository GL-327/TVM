# Phone Overlays, Night Mode, Sleep Timer & Watched Episodes Report

## Summary
Delivered native over-video playback stats, native sleep timer ownership with 5 s volume fade and countdown display, real native audio dynamic-range compression for night mode, and episode `watched` flagging (`markWatched`) for `spoilerBlur` across both iPhone (`apps/ios/**`) and Android (`apps/android/**`), driven from the existing React playback controls over the native bridge (`apps/ui/src/player/**`).

Preserved commit `9f18451` (`1.4.15`): `open` bridge messages continue to forward `audioLanguage`, and both `TVMVideoEngine` and `TvmNativePlayer` keep selecting the requested main audio language track.

---

## Landed Changes by Platform

### 1. Shared React Bridge & Controls (`apps/ui/src/player/**`)
- `apps/ui/src/player/iosEngine.ts`
  - Added typed `NativeStatsSnapshot` and `NativeSleepSnapshot` contracts plus `NATIVE_STATS_EVENT`, `NATIVE_SLEEP_EVENT`, and `NATIVE_PLAYER_COMMAND_EVENT` (`sendNativePlayerCommand`).
  - Kept the `open` message payload (including `audioLanguage`) unchanged and added a command queue so extra commands sent immediately before `attach()` (`nightMode`, `sleepTimer`, `playbackInfo`, `stats`) flush right after `open`.
  - Forwarded incoming `stats`, `sleep`, and telemetry attached to `state` events (`id`-scoped) to React listeners.
- `apps/ui/src/player/extrasLogic.ts`
  - Extended `formatStats(video, info, duration, nativeStats?)` while preserving the existing 8-row HTML5 output when `nativeStats` is omitted.
  - Added full native telemetry formatting (`Resolution`, `Container / MIME`, `Codecs`, `HDR`, `Audio` language + channels, `Subtitles`, `Frames dropped / total`, `Bitrate`, `Source`, `Version`, `Buffer ahead`) and `formatRemainingSleep(ms)`.
- `apps/ui/src/player/PlaybackExtras.tsx`
  - Forwarded `nightMode`, `sleepTimer`, `sleepResume`, `stats`, `playbackInfo`, and `extrasUi` (`sheetOpen`) over the native bridge when `session.engine === 'native'`.
  - Delegated native sleep timer countdown, 5 s fade, and expiry pause to the native player engine so timing survives even when the React layer is hidden/throttled behind the native surface, while syncing remaining time into the `"Sleep timer"` tool button and sheet.
  - Suppressed duplicate HTML `.playback-stats` rendering when a real `nativePlaybackBridge()` owns the native over-video glass overlay.
- `apps/ui/src/player/phoneOverlays.test.ts` *(new)*
  - Unit tests covering `audioLanguage` preservation on `open`, pre-attach command buffering/flushing, session-scoped native `stats`/`sleep` event forwarding, `formatStats` HTML5 compatibility + full 11-row native formatting, and `formatRemainingSleep` / `sleepFadeFactor` / `sleepShouldStart`.

### 2. iPhone (`apps/ios/**`)
- `apps/ios/TVM/TVMVideoEngine.swift`
  - **Stats & glass overlay:** Read live telemetry from `MobileVLCKit` (`VLCMediaPlayer.videoSize`, `media.tracksInformation` FourCC video/audio codecs, language, channels, `player.currentVideoSubTitleIndex` / `videoSubTitlesNames`, `media.stats` lost/displayed/decoded frames, `demuxBitrate`/`inputBitrate` scaled `* 8.0` to Mb/s, unread input buffer estimate, plus `playbackInfo` metadata for `HDR`/`Source`/`Version`/`Container`).
  - Added `TVMPassThroughOverlayView` and `TVMNativeVideoOverlayView` matching `.playback-stats` dark frosted glass styling (`UIVisualEffectView`, `#FFFFFF30` hairline border, tabular digits), including a compact upper-left `"Stats"` tap target pill, expandable/closable stats panel (`×`), live `"Sleep"` countdown pill, and centered `"Sleep timer ended"` `Resume`/`Close` fallback card when React is not showing a sheet.
  - **Sleep timer:** Implemented `TVMSleepTimerState` on the 250 ms timer supporting `off`, `15`, `30`, `45`, `60`, and `end`, 5 s volume attenuation (`baseVolume * tvmSleepFadeFactor`), pause at expiry, hold against premature `shutdown()` after `.ended` expiry until `Resume` or `Close`, and state sync back to React.
  - **Night mode:** Added VLC `compressor` audio filter options (`"audio-filter": "compressor"` via `media.addOptions`) matching React dynamics (`threshold -26 dB`, `ratio 8:1`, `knee 6 dB`, `attack 5 ms`, `release 250 ms`, makeup gain `+8 dB`), re-opening playback at the current position and play/pause state if toggled mid-stream.
- `apps/ios/TVM/TVMWebView.swift`
  - Added `videoOverlayContainer` (`TVMPassThroughOverlayView`) above `webView` in `TVMWebHostController`, attaching/clearing `engine.overlayView` in `showVideo` / `hideVideo` while passing empty-area touches through to `webView`.
- `apps/ios/TVM/TVMModels.swift` & `apps/ios/TVM/TVMMedia.swift`
  - Added optional `watched: Bool? = nil` on `MediaItem` (omitted when `nil` in JSON, preserved in `parse` and `json`).
  - Added `TVMMedia.markWatched(_:progress:)` matching Core (`entry.isFinished || entry.completedAt != nil`) and applied `applyProgress` + `markWatched` inside `TVMMedia.children(_:)`.
- `apps/ios/TVMTests/Phone143Tests.swift`
  - Added XCTest cases for `TVMMedia.markWatched`, `MediaItem` `watched` JSON round-trip, `TVMVideoEngine.compressorOptions`, `TVMSleepTimerState`, FourCC decoding, and `TVMNativeStatsBuilder` 11-row formatting.

### 3. Android (`apps/android/**`)
- `apps/android/app/src/main/java/com/tvm/privateclient/TvmPlayerExtras.kt` *(new)*
  - **Stats & glass overlay:** Implemented `TvmNativeStats` (`Resolution`, `Container / MIME`, `Codecs`, `HDR` including `Dolby Vision` / `HDR10+` / `HDR10` / `HLG` / `SDR` via `ColorInfo`, `Audio` language/channels, `Subtitles`, `Frames dropped / total`, `Bitrate`, `Source`, `Version`, `Buffer ahead`) and `TvmNativeVideoOverlayView` (insets-aware upper-left `"Stats"` tap target pill, countdown `"Sleep"` pill, frosted dark glass stats panel matching `.playback-stats`, `"×"` close button, and centered `"Sleep timer ended"` `Resume`/`Close` fallback card).
  - **Sleep timer:** Implemented `TvmSleepLogic` and `TvmSleepTimerState` (`off`, `15`, `30`, `45`, `60`, `end`, 5 s fade via `fadeFactor`, expiry pause).
  - **Night mode:** Implemented `TvmNightAudioController` bound to `ExoPlayer.audioSessionId` (tracking `onAudioSessionIdChanged`): uses `DynamicsProcessing` multiband compressor + limiter on API 28+ (`Build.VERSION_CODES.P`, using `AudioEffect` base handle to avoid `NewApi` lint issues) with automatic `LoudnessEnhancer` fallback for API 26–27 (`minSdk = 26`) or HAL failure.
- `apps/android/app/src/main/java/com/tvm/privateclient/TvmNativePlayer.kt`
  - Wired bridge commands (`nightMode`, `sleepTimer`, `sleepResume`, `stats`, `playbackInfo`, `extrasUi`), `onAudioSessionIdChanged`, Media3 stats collection (`exo.videoSize`, `videoFormat`, `audioFormat`, `videoDecoderCounters`, `totalBufferedDuration`, `TvmSubtitles`), 250 ms sleep tick & `STATE_ENDED` handling for `"end"`, and overlay attach/cleanup above `webView`.
- `apps/android/app/src/main/java/com/tvm/privateclient/TvmModels.kt` & `apps/android/app/src/main/java/com/tvm/privateclient/TvmMedia.kt`
  - Added `val watched: Boolean? = null` to `MediaItem` (`json()` / `parse()`), `TvmMedia.markWatched(items, progress)`, and `markWatched` (+ `applyProgress` on catalog meta episodes) in `TvmMedia.children(id)`.
- `apps/android/app/src/test/java/com/tvm/privateclient/TvmPlayerExtrasTest.kt` *(new)*
  - JUnit4 unit tests covering `TvmMedia.markWatched`, `MediaItem` `watched` JSON round-trip, `TvmSleepLogic` / `TvmSleepTimerState`, and `TvmNativeStats` formatting.

---

## Verification & Test Results

1. **iOS structural & contract check** *(run after final Swift edit)*:
   - Command: `node C:/Users/Arthur/Desktop/TVM/apps/ios/check-project.mjs`
   - Result: **287 passed, 0 warnings, 0 failed**.
2. **Shared UI unit tests** *(run after final edit to `apps/ui/src/player/**`)*:
   - Command: `npx vitest run` (in `C:/Users/Arthur/Desktop/TVM/apps/ui`)
   - Result: **100 test files passed (100), 577 tests passed (577)** — includes `src/player/phoneOverlays.test.ts` (4 tests), `src/player/iosEngine.test.ts` (3 tests), `src/player/extrasLogic.test.ts` (6 tests), `src/player/audioGain.test.ts` (2 tests), `src/player/features/extrasPlayer.test.ts` (5 tests).
3. **Shared UI TypeScript check & production build** *(run after final edit to `apps/ui/src/player/**`)*:
   - Command: `corepack pnpm run build` (`tsc -p tsconfig.json --noEmit && vite build` in `C:/Users/Arthur/Desktop/TVM/apps/ui`)
   - Result: **Exited 0**, built cleanly in 6.88 s.
4. **Line endings & path scope**:
   - Converted all 14 touched files (and this report) to UTF-8 LF (`\n`).
   - Verified `git status --short` shows changes from this task only in `apps/ios/**`, `apps/android/**`, `apps/ui/src/player/**`, and `docs/1.4/report-phone-overlays.md` (`TvmAccounts.kt`, `TVMAccounts.swift`, version numbers, and `changelog.json` were not modified).

---

## Untested (Requires CI / Real Devices)
- **iOS Swift compilation & XCTest (`xcodebuild`)**: macOS/Xcode is not present in this Windows environment; `apps/ios/TVM/*.swift` and `TVMTests/Phone143Tests.swift` have not been compiled or executed via `xcodebuild` yet (CI / Mac required).
- **Android Kotlin/Gradle compilation, Lint & JUnit (`./gradlew test`)**: JDK / Android SDK is not installed locally; `apps/android/**` Kotlin files and `TvmPlayerExtrasTest.kt` have not been compiled with Gradle yet (CI / Android Studio required).
- **Real-device & emulator behavior**:
  - `MobileVLCKit 3.6.0` runtime compressor (`audio-filter=compressor`) audible DRC & mid-playback reopen smoothing, VLC `tracksInformation` / `stats` metrics across live & VOD containers, safe-area positioning, and touch pass-through on physical iPhone hardware.
  - Android `DynamicsProcessing` (API 28+) / `LoudnessEnhancer` (API 26–27) HAL behavior, Media3 `DecoderCounters` / `ColorInfo` values, window-inset spacing over `SurfaceView`, and sleep timer progression while WebView/chrome is hidden on physical Android hardware.
