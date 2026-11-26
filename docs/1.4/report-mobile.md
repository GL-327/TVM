# mobile14: phone engines (Kotlin + Swift)

## Verified (Android, really run)
- JDK 21 + Android SDK 35 present. `gradlew --offline :app:compileDebugKotlin`, `:app:testDebugUnitTest` (all pass, incl. new TvmEngine14Test) and `assembleDebug` all succeed.
- `node apps/android/check-project.mjs`: 214 passed, 0 failed.
- Gemini's tree did NOT compile at first (MainActivity called missing core.onForeground() and an adminVault parameter). Fixed by wiring them in TvmLocalCore.

## Verified (iOS, static only)
- No Swift toolchain here. `node apps/ios/check-project.mjs`: 275 passed (was 1 failed: TVMVersions.swift and TVMWebhook.swift were not in project.pbxproj; added). standalone-playback.test.mjs passes.
- Read every changed Swift file by hand. Fixed likely compile errors: tuple label mismatch (status/data vs status/body) in TVMAccounts.callRaw; static defaults used unqualified in TVMPrefs property initialisers; optional-chain `.doubleValue.flatMap` in TVMWebhook; NSLock use inside an async Task; a convoluted closure in TVMCatalog.originalLanguageFor; Double.init map. NOT compiled, so treat as unverified.

## DONE (Kotlin; Swift mirrors except where noted)
- /api/config (service /v1/config, cached 5 min, safe defaults {announcement:null,minVersion:null,flags:{},openSignups:false,mail:false} when unreachable) and /api/announcement.
- RD key cache fix (45 s TTL, 5 s for empty/failed, refresh on 401/403, refetch after account change) plus refresh on foreground (Android onStart, iOS willEnterForeground -> core.onForeground()). RD keys stay in memory only (rdCache, rd.accountToken); nothing written to disk or sent to the UI.
- Prefs: all new prefs (extras map, webhookUrl, homeSections, quality, audioLanguage, skipUpscaled, subtitle*, skipSegments, ...) validated and merged on PUT /api/prefs.
- POST /api/account/verify/resend, POST /api/account/password/forgot.
- POST /api/progress/remove and /watched (hiddenFromContinueWatching; resume position still works for hidden items).
- /api/extras/hero-clip|theme|ytdlp -> 404 {status:'unavailable'}; /api/extras/surprise (random watchlist item).
- Admin: GET/POST /api/admin/key (admin key in Keystore / Keychain, never returned), and mirrors for /api/admin/config, audit, accounts (list), accounts.csv, rd/test, accounts/bulk, accounts/:id/{sessions,profile,password,tier}, sessions/:sid. Dev role + installed key required. Old dashboard-only 403 kept for the other /api/admin/accounts/* paths. Tests updated accordingly (Kotlin and Swift).
- Android only: GET /api/playback/versions (alias /api/versions) using TvmVersions ranking with this phone's decoders (hevc, hdr, mkv, screen height); playback accepts versionId; upscaled copies skipped when prefs.skipUpscaled and a genuine copy exists; original-language lookup (Cinemeta, TMDB fallback).

## PARTLY / NOT DONE
- iOS: /api/playback/versions returns an empty list (ranking code TVMVersions.swift exists and is in the project but is not wired to playback; versionId ignored). iOS playback path (AVPlayer/MKV handling) untouched.
- Android: default playback order still uses TvmPlaybackChoice (device-codec aware); original-language/native-resolution ranking is only in the versions list and versionId pick, not the default auto-pick. originalLanguage/audioLanguages not added to the /api/playback response. Client caps in the request body (`client`) not parsed.
- NOT DONE: GET /api/live/guide (XMLTV/Xtream) on both phones.
- Webhook: TvmWebhook/TVMWebhook classes exist but nothing calls send() yet (no event route).
- Reverted: nothing.

## Risks
- Swift changes are uncompiled; CI will be the first compile. Most likely trouble spots: TVMVersions.swift (large regex/Locale code), TVMLocalCore new routes, TVMWebhook.
- TvmPlaybackChoice screenHeight threshold changed 2000 -> 1440 by Gemini (4K on QHD phones); left as is.
- RdStream.details now includes the stream name; language checks on downloads see more text (tests pass).
