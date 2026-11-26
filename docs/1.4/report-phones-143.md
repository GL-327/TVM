# Phone engines: TVM 1.4.3

Changes are limited to `apps/android/`, `apps/ios/` and this requested report. No commits, branches, version bumps or shared changelog edits were made. Other builders' changes were left alone.

## Section 6: Live TV guide

- Both engines implement `GET /api/live/guide`, including the default half-hour-aligned three-hour window, 1–24 hour validation, group filtering, group lists, channel numbers, source labels and programme fields.
- Free-channel EPG ids and feed lists come from each phone's existing refreshed `free-channels` content loader. Parental group restrictions apply before feeds and channels are selected. IPTV channels require the Live TV capability.
- M3U imports retain `url-tvg` / `x-tvg-url` feed URLs and per-channel `tvg-id`. Matching prefers ids, case-insensitively, then normalized display names. Saved remote playlists from older installs recover their missing headers in the background.
- Xtream uses `xmltv.php`, with `get_short_epg` for the first 48 relevant missing channels, including base64 text and Unix/provider timestamps.
- Android uses XmlPullParser over plain/gzip input; iPhone downloads to a temporary file, inflates gzip in chunks to another temporary file, then uses XMLParser with an InputStream. Neither loads the XML document into a string. Only requested channels and programmes overlapping the requested window are retained.
- Parsed schedules are cached for six hours in Android's actual `cacheDir/guide` and iPhone's Caches/TVM/guide. Cache keys include the feed, channel matches and requested window. Disk snapshots are bounded to 128 files. Failed refreshes retain existing schedules and back off for one minute.
- Feed downloads run in the background. Cold/failed feeds yield one “No guide information” block per channel. Responses include the new Core/UI `refreshing` hint so the interface can poll while a fuller answer is coming. Channel catalog routes never wait for guide feeds.
- Added Kotlin XMLTV/time-window tests and equivalent tests in the existing Swift XCTest target: id/name matching, entities/CDATA, time zones, boundary overlap, duplicates, missing data, invalid XML/dates, gzip and Xtream text/window handling.

## Section 7: Webhook

- Successful playback requests, including live/offline playback, send `play`. `POST /api/playback/event` validates and forwards `play`, `pause`, `stop` and `finish`. Saving progress sends `finish` only when it first crosses the same >96% threshold as Core.
- Delivery uses the existing helpers: extras.webhook plus a configured URL are required; generic JSON and Discord payloads match Core; profile-scoped deduplication, pending limits, timeout and redirect refusal remain intact. Network work runs in a daemon thread / detached task and never waits for playback.
- Event seconds now reject strings and booleans consistently with Core. Added real helper tests for validation, gating, deduplication, background delivery and payloads; Swift also tests validation/gating/deduplication.

## Section 5: Playback

- Android's picker and default auto-pick now use TvmVersions ranking, with TvmPlaybackChoice's video/audio decoder checks as eligibility filters. The older “regular encode before REMUX” ordering is confined to downloads. Page-supplied client capabilities can narrow device support, never enable missing decoders.
- iPhone now implements the versions route (plus the existing Android `/api/versions` alias), accepts versionId and client capabilities, and uses TVMVersions for default/explicit selection. Candidates are restricted to AVPlayer-compatible containers/codecs as requested. Fixed the Swift cached/uncached tie-breaker, which was reversed.
- Original-language, native-resolution, source and bitrate ordering now apply before automatic title playback; the old early library shortcut no longer bypasses ranking. Downloads retain their separate language/size selection rules.
- A requested version is matched exactly. Missing or unsupported picks do not silently select another release or use an offline copy. Resolved filenames are checked again against capability/height limits before returning a stream.
- Successful on-demand responses include `version`, `originalLanguage` and `audioLanguages`. Ranked releases include catalog original language/runtime and release languages. Explicit links/offline files have filename-derived version/language information and a null originalLanguage when catalog metadata is unavailable.
- The original Real-Debrid `unrestrict.download` file path remains the playback source; this work adds no transcoding path. Android's existing failed-source memory and episode checks are retained.
- Added Kotlin ranking tests for language/resolution/source/size, cams/upscales, client caps and hardware restrictions. Swift tests cover native format restrictions, ranking and cached preference. New Swift sources have file/build references, groups and sources-phase entries in project.pbxproj.

## Verification

- `node apps/android/check-project.mjs`: 220 passed, 0 warnings, 0 failed.
- `node apps/ios/check-project.mjs`: 281 passed, 0 warnings, 0 failed.
- `node apps/ios/standalone-playback.test.mjs`: 17 passed, 0 failed.
- `git diff --check -- apps/android apps/ios`: passed.
- Changed code was reread for signatures, optional/null handling, imports and Xcode membership. Edited files use LF.

## Not verified and integration notes

- This machine has no Android SDK/Kotlin compiler or Swift/iOS toolchain. Kotlin compilation, JVM/Robolectric tests, XCTest and native builds were not run. CI must compile both apps and run their native tests; project checks and the Node contract test do not establish native compilation or runtime correctness.
- No phone/emulator, actual playback, live broadcaster feed, IPTV account or real webhook endpoint was exercised. On-device guide loading, audio selection and bitrate still need device validation.
- The current iPhone video shell uses VLC. This brief explicitly asks for AVPlayer-compatible ranked candidates, so normal ranked playback excludes MKV, AV1/VP8/VP9 and known unsupported audio. The engine itself and the separate download selection path were not replaced.
- Older pasted M3U playlists did not retain their source text or EPG header, so their feed URLs cannot be recovered. Reimport those playlists once to save the guide header. Remote playlists migrate automatically; Xtream credentials already supply the XMLTV endpoint.
- The lead owns shared release notes/versioning. Suggested changelog lines, each with `platforms: ["android", "ios"]`: “Live TV now has programme listings for free channels and IPTV.” / “Playback picks the best native copy in the title's original language.” / “Playback webhooks now send play, pause, stop and finish events.” An iPhone-only line can mention the working version picker.
