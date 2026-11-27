Job: PHONE + ROKU SYNC (TVM 1.4.14). Repo: the TVM checkout, branch main. First run `git pull`. Read CLAUDE.md, docs/AGENT-GUIDE.md and docs/LIQUID_GLASS.md.

## Problem
Owner: "account profiles and watch history and settings, just all of it, doesn't carry across devices with accounts." Sync exists only in the desktop/web Core (`apps/core/src/sync/`, shipped in 1.4.5). The phone engines (Android Kotlin `apps/android/app/src/main/java/com/tvm/privateclient/`, iOS Swift `apps/ios/TVM/`) and Roku (`apps/roku/source/`) never sync, so a profile, Continue Watching, watched state, watchlist or preference made on one device never reaches the others.

## Deliver
Port the Core sync client to both phone engines and to Roku, with the same behaviour and wire format.

1. **The reference.** `apps/core/src/sync/` is the reference: `schema.ts` (kinds `profile`, `progress`, `watchlist`, `preference`; SYNC_PREFS, SYNC_EXTRAS; limits MAX_VALUE_BYTES 16 KB, MAX_ITEMS 200 per push, FUTURE_MS), `merge.ts` (ledger, last writer wins on `updatedAt`, server wins ties, first-sync merge), `engine.ts` (timers, backoff, status), `accounts.ts` (transport: `GET/PUT /v1/me/data` on the accounts service with the session bearer), `stores.ts` (how each kind maps to local files). Item ids are `kind + ':' + key`; value hashes are SHA-256 base64url of canonical JSON. Match them exactly so a phone and a PC agree on the same item.
2. **Behaviour on each engine:**
   - Pull on sign-in, on app start/foreground, and every 60 s while open. Push 3 s after a local change.
   - Back off when offline.
   - Expose `/api/sync/status` and `/api/sync/now` on the phone engines, with the same shapes as Core, so the React Settings > Account sync row works unchanged.
   - Sign-out stops sync and clears the ledger. Signing into a different account never merges the previous account's data into it.
3. **Never sync** Real-Debrid keys, passwords, session tokens, PINs in clear text, or anything not allowed by `schema.ts`. Reuse the same validation; reject what Core rejects.
4. **Android:** a `TvmSync.kt` (or equivalent) wired into `TvmLocalCore.kt`'s profile, progress, watchlist and prefs stores. Add unit tests mirroring `apps/core/src/sync/sync.test.ts`: merge, tie, first sync, invalid item rejected, sign-out clears.
5. **iOS:** a `TVMSync.swift` wired into `TVMLocalCore.swift` and the same stores. Add it to `project.pbxproj`, with XCTest cases mirroring the Android ones. iOS only compiles in CI, so keep the Swift conservative and run `node apps/ios/check-project.mjs`.
6. **Roku:** Roku has no on-device Core like the phones. Find where Roku keeps profiles, progress, watchlist and prefs (`localCore.brs`, `accountsCore.brs`, `playbackCore.brs`) and sync the same four kinds directly with `/v1/me/data`, using its session token. Pull at launch and every 60 s on Home; push after changes. The BrightScript must avoid `IndexOf`, which isn't on every Roku OS.
7. **Check against the PC:** on the web (`apps/ui` with the repo Core), make a profile and watch 30 s of something. Confirm the phone engine's unit tests can pull that exact JSON shape: record a real `/v1/me/data` response as a fixture.

## Verify (all must pass)
- **Android:** `apps/android/gradlew testDebugUnitTest assembleDebug`, with `JAVA_HOME=C:/Program Files/Java/jdk-21.0.11` (the default Java 27 breaks Gradle) and `ANDROID_HOME=%LOCALAPPDATA%/Android/Sdk`.
- **iOS:** `node apps/ios/check-project.mjs`.
- **Roku:** `npx --yes brighterscript@0.73.5 --project apps/roku/bsconfig.json`, `node --test apps/roku/scripts/`, `node apps/roku/scripts/check.mjs`.
- **Core:** `cd apps/core && npx vitest run`, which must stay green.

## Release
- Bump to the next version: root `package.json`, `apps/core/package.json`, `apps/ui/package.json`, `CORE_VERSION`, Android `versionName`, iOS `Info.plist`, `TVMModels.swift`, `project.pbxproj` ×2, and Roku `build_version`.
- Add a changelog release per CHANGELOG-RULES.md, platforms `ios`, `android`, `roku`, and copy it to the three app copies. Remove the "phones and Roku do not sync yet" known issue.
- Commit as `git -c user.name=GL327 -c user.email=257561906+GL-327@users.noreply.github.com commit`, with no Co-Authored-By lines.
- Push to main only if the owner has said so in this chat; otherwise stop with the commit ready.
- Write a short report at `docs/1.4/report-phone-sync.md`: what landed, what's untested.
