# Phone & Roku Account Sync Report

Implementation of TVM account sync across Android (`apps/android/`), iOS (`apps/ios/`), and Roku (`apps/roku/`) matching Core's sync protocol, wire format, schema validation, canonical hashing, merge semantics, and lifecycle isolation (`apps/core/src/sync/`).

Scope obeyed: changes are limited to `apps/android/`, `apps/ios/`, `apps/roku/`, their `sync-fixture.json` test fixtures, and this report (`docs/1.4/report-phone-sync.md`). No commits, stashes, resets, branch switches, version bumps, or shared `changelog.json` edits were made; pre-existing uncommitted changes outside scope (`apps/ui/`, `native/`) were left untouched. All created and modified files use LF (`\n`) with no UTF-8 BOM.

---

## 1. What Landed per Platform

### Shared Core Test Fixture
Generated directly from `apps/core/src/sync/` (`C:/Users/Arthur/TVM-work/sync/generate-fixture.ts` and validated against `parseSyncItem` for all 8 valid items and 7 invalid cases):
- `apps/android/app/src/test/resources/sync-fixture.json`
- `apps/ios/TVMTests/SyncFixtures/sync-fixture.json`
- `apps/roku/scripts/fixtures/sync-fixture.json`

### Android (`apps/android/`)
- **Created:**
  - `apps/android/app/src/main/java/com/tvm/privateclient/TvmSync.kt` (`TvmSyncHttp`, `HttpSyncTransport`, `SyncSchema`, `SyncStores`, `SyncMerge`, `TvmSyncScheduler`, `SyncEngine`, `TvmAccountSync`)
  - `apps/android/app/src/test/java/com/tvm/privateclient/TvmSyncTest.kt` (fixture hash/pull/invalid-case parity, LWW/tie/tombstones, first-sync HTTP merge + device-pref isolation, 60 s pull / 3 s debounce / exponential backoff + `Retry-After`, `412`/`409`/`404`/`401`, offline `restoreSyncFromVault()`, sign-out ledger deletion, cross-account isolation, zero secrets on disk)
  - `apps/android/app/src/test/resources/sync-fixture.json`
- **Modified:**
  - `apps/android/app/src/main/java/com/tvm/privateclient/TvmModels.kt` (added sync metadata fields and `syncPresentKeys` on `ProgressEntry`; preserved unknown fields in `ProfileRecord.storageJson()`)
  - `apps/android/app/src/main/java/com/tvm/privateclient/TvmStore.kt` (added `setActiveDirectory`, `activeSyncDir`, `withSyncSuppressed`, `onSyncStoreChanged`; routed active profile/progress/watchlist/services storage through `dataRoot()`; preserved `syncPresentKeys`)
  - `apps/android/app/src/main/java/com/tvm/privateclient/TvmUpdater.kt` (updated `TvmPrefs` so syncable keys read/write `sync-prefs.json` in `activeSyncDir()` while device-only prefs remain in `prefs.json`)
  - `apps/android/app/src/main/java/com/tvm/privateclient/TvmLocalCore.kt` (wired `TvmAccountSync`, added `GET /api/sync/status` and `POST /api/sync/now`, bound/detached/signed out sync across `/api/account*`, added offline `restoreSyncFromVault()`, `onForeground()`, `close()`, and factory-reset/erase cleanup)
  - `apps/android/app/src/main/java/com/tvm/privateclient/MainActivity.kt` (invokes `made.restoreSyncFromVault()` synchronously before `server.start()`, `core?.onForeground()` in `onStart()`, and `core?.close()` in `onDestroy()`)

### iOS (`apps/ios/`)
- **Created:**
  - `apps/ios/TVM/TVMSync.swift` (`SyncHTTPReply`, `TVMSyncTransport`, `TVMURLSessionSyncTransport`, `TVMAccountsSyncAdapter`, `TVMSyncCanonical`, `TVMSyncSchema`, `TVMSyncMerge`, `TVMSyncStores`, `TVMSyncStatus`, `TVMSyncEngine`, `TVMAccountSync`)
  - `apps/ios/TVMTests/TVMSyncTests.swift` (`CFBoolean`/number/slash canonicalization, Core fixture hashes + pull + invalid-case rejection, LWW/tie/tombstones, first-sync HTTP merge + device-pref isolation, offline restore, sign-out ledger deletion, cross-account isolation, `429`/`409`/`412`/`404`/`401` handling)
  - `apps/ios/TVMTests/SyncFixtures/sync-fixture.json`
- **Modified:**
  - `apps/ios/TVM/TVMModels.swift` (added sync metadata fields and `syncPresentKeys` on `ProgressEntry`; `ProfileRecord.storageJSON()`)
  - `apps/ios/TVM/TVMStore.swift` (added `setActiveDirectory`, `activeSyncDir`, `withSyncSuppressed`, `notifySyncChanged`; routed per-account storage through `dataRoot()`; preserved `syncPresentKeys`)
  - `apps/ios/TVM/TVMUpdater.swift` (updated `TVMPrefs` to split `sync-prefs.json` from device `prefs.json` and notify sync only when syncable keys change)
  - `apps/ios/TVM/TVMAccounts.swift` (exposed `syncOrigin` and `currentSessionToken` while keeping sessions in Keychain)
  - `apps/ios/TVM/TVMLocalCore.swift` (wired `TVMAccountSync`, added `GET /api/sync/status` and `POST /api/sync/now`, bound/detached/signed out sync across `/api/account*`, added `restoreSyncFromVault()`, `onForeground()`, `deinit` cleanup, and factory-reset/erase cleanup)
  - `apps/ios/TVM/TVMApp.swift` (calls `core.restoreSyncFromVault()` synchronously during startup and `runtime.core.onForeground()` on `.tvmWillEnterForeground`)
  - `apps/ios/TVM.xcodeproj/project.pbxproj` (added file references, build files, group memberships, and Sources/Resources build phases for `TVMSync.swift`, `TVMSyncTests.swift`, and `SyncFixtures`)

### Roku (`apps/roku/`)
- **Created:**
  - `apps/roku/source/syncCore.brs` (wire schema validation, pure BrightScript SHA-256 fallback + `roEVPDigest` hardware path, byte-level Base64URL, canonical JSON, registry/cachefs ledger storage, local snapshot including `localFinished`, remote item application, LWW merge, `GET`/`PUT /v1/me/data`, backoff/`Retry-After`, `syncHandleStatus`, `syncHandleNow`)
  - `apps/roku/scripts/sync.test.mjs` (`node:test` contract checks + `brs@0.45.0` runtime suite against `sync-fixture.json`)
  - `apps/roku/scripts/fixtures/sync-fixture.json`
- **Modified:**
  - `apps/roku/source/localCore.brs` (extended `lcHttp` to capture lowercase `etag` and `retry-after` response headers, exposed `GET /api/sync/status` and `POST /api/sync/now`, preserved finished & hidden progress entries, replaced `m` local variable shadowing in `lcProgressMap`/`lcFinishedMap`, preserved camelCase keys in `lcSaveProgress`, cleared sync state on factory reset/erase)
  - `apps/roku/source/contentCore.brs` (quoted `"maxAge"` key in `lcProfilesStore`)
  - `apps/roku/source/accountsCore.brs` (bound/reset/cleared sync on `/api/account`, signin, terms acceptance, device poll, and signout while reusing existing `accountToken` and never logging tokens)
  - `apps/roku/source/extrasCore.brs` (added `franchiseIntros` extra default; overlaid `syncReadPrefs`/`syncWritePrefs` onto `lcExtrasPrefs`/`lcSaveExtrasPrefs` while keeping Roku device-only prefs local)
  - `apps/roku/source/api.brs` (routed `/api/sync/` to `local:`)
  - `apps/roku/source/media.brs` (included `genres` in normalized watchlist body)
  - `apps/roku/components/ApiTask.xml` (loaded `pkg:/source/syncCore.brs`)
  - `apps/roku/components/TVMScene.brs` (added 60 s `syncPoll` timer, 3 s `syncPush` debounce timer, `triggerSyncNow`, `scheduleSyncPush`, `stopSyncTimers`, `onSyncDone`, foreground/home catch-up pull, `401` sign-out handling, and timer stop on sign-out/revocation/Core switch/reset)
  - `apps/roku/components/PlayerExtras.brs`, `apps/roku/components/TVMExtras.brs`, `apps/roku/components/TVMFeatures.brs` (triggered `scheduleSyncPush()` on subtitle/preference/profile saves)
  - `apps/roku/scripts/fixtures/extras-runtime.brs` (added no-op `syncBindAccount`, `syncResetBackoff`, `syncClearOnSignOut` stubs for `extras.test.mjs`)

---

## 2. How Each Matches Core

- **IDs & Syncable Scope:** All three clients use Core's exact item ID format `kind:key`: `profile:<profileId>`, `progress:<profileId>/<mediaId>`, `watchlist:<profileId>/<mediaId>`, and `preference:<key>` across the 4 kinds (`profile`, `progress`, `watchlist`, `preference`) and all 29 `SYNC_PREFS` keys (`subtitleLanguages`, `subtitleStyle`, `audioLanguage`, `skipSegments`, `autoplayNext`, `homeSections`, plus `extras.<id>` for all 23 `SYNC_EXTRAS`). Device-only settings (`language`, `quality`, `autoUpdate`, `heroPreviews`, `skipUpscaled`, `subtitleMode`, `webhookUrl`, Roku `sleepDefault`/`spotlightEvents`) stay local and are never uploaded or overwritten by sync.
- **Canonical JSON & Hashes:** Object keys are sorted lexicographically; integer-valued floats format without `.0` (`-0.0` normalizes to `0`); `/` is unescaped; hashes are unpadded `base64url(sha256(utf8(canonicalJson(value))))`. On iOS, `CFBooleanGetTypeID()` distinguishes bridged `Bool` from `NSNumber` numeric values. On Roku, `roEVPDigest` runs on device hardware with a 16-bit-split `syncSha256Pure` fallback and byte-level Base64URL encoding, with explicit camelCase key quoting so `maxAge`/`updatedAt`/pref keys never lowercase or drift. All three platforms match Core's 8 fixture hashes byte-for-byte.
- **Schema & Protocol Guards:** All three enforce Core's `MAX_VALUE_BYTES = 16384`, `MAX_ITEMS = 200` per PUT batch, `MAX_PAGES = 201`, `FUTURE_MS = 300000` (5 min), safe integer bounds, allowed keys per kind, `publicSyncArtwork` host whitelist, credential/URL rejection in `displayText`, and strict `"<gen>"` `ETag` + monotonic `now` watermark validation. Roku uses `LongInteger` (`&`) for epoch-ms arithmetic and explicit loops instead of `IndexOf` everywhere.
- **LWW & Server-Wins-Tie Merge:** Local snapshot observations bump `updatedAt` monotonically (`max(prior.updatedAt + 1, min(changedAt, now))`) whenever an item's canonical hash changes, and convert previously seen missing items into `deleted: true` tombstones. Remote items overwrite local and clear pending entries whenever `prior == null || prior.updatedAt <= item.updatedAt`, making the server authoritative on equal-timestamp ties. Local profile-switch requests (`activeId` only) do not bump sync state.
- **First-Sync Merge & Legacy Ownership:** Pre-existing local profiles (dropping untouched default placeholder profiles when incoming profiles arrive unless they hold local media), progress (including finished items on Roku's `localFinished`), watchlist items, and non-default syncable preferences are preserved and uploaded on first sign-in for the device's first owner (`legacy-owner.json` on phones, `syncOwner` + `syncImportLegacyPrefs` on Roku), while untouched remote-only fixture pulls converge to 0 pending PUTs.
- **Sign-Out Clears Ledger & Account Isolation:** Sign-out clears the local sync ledger (`ledger.json` on phones, `syncLedger` / `cachefs:/tvm_sync_ledger.json` on Roku), deletes the account's synced stores (`profiles.json`, `profiles/`, `sync-prefs.json`, or Roku's synced registry keys), resets `initialized.json` (`{"legacy": false}` on phones), preserves device-only settings, and stops sync timers/schedulers. Different accounts use separate `sha256(origin + "\0" + accountId)` directories on phones (`syncOwner` hash comparison on Roku) and never inherit legacy device data or a prior user's data. Phones persist `session-owner.json` (token digest + account hash, never raw tokens) so `restoreSyncFromVault()` restores the account directory immediately offline.
- **Scheduling, Backoff & Status API:** All three run `60 s` pull intervals, `3 s` local-change debounce, foreground / home-entry pulls, exponential backoff (`5 s * 2^min(6, failures)` capped at `300 s`, honoring `Retry-After`), `412` generation reset preserving local state, `409` `"Synced data is full."`, `404` silent disable, `401` session rejection, and local `GET /api/sync/status` + `POST /api/sync/now` answering `{ enabled, lastSyncAt, pending, error }`.

---

## 3. Verification Results (Run After Final Edit)

- **Line endings & UTF-8 BOM check (`git status --short` over all modified/new repo files):**
  - `BOM_COUNT=0 []`, `CRLF_COUNT=0 []`
- **BrighterScript (`npx --yes brighterscript@0.73.5 --project C:/Users/Arthur/Desktop/TVM/apps/roku/bsconfig.json`):**
  - Exited `0`: `Parsing files finished. (1s66.153ms)` / `Validating project finished. (569.459ms)`, `EXIT_1=0`.
- **Roku unit & `brs` runtime tests (`node --test C:/Users/Arthur/Desktop/TVM/apps/roku/scripts/`):**
  - Exited `0`: `tests 453`, `pass 453`, `fail 0`, `cancelled 0`, `skipped 0`, `todo 0`, `duration_ms 54229.9384` (including `Roku syncCore contracts: no IndexOf, ApiTask loads syncCore, TVMScene hooks sync lifecycle` in `1.8797ms` and `Roku syncCore.brs matches Core fixture hashes, schema, merge, first-sync, error handling, and account isolation in brs` in `20231.8049ms`), `EXIT_2=0`.
- **Roku static/package check (`node C:/Users/Arthur/Desktop/TVM/apps/roku/scripts/check.mjs`):**
  - Exited `0`: `Roku static/package checks passed. Hardware installation and playback are still required.`, `EXIT_3=0`.
- **iOS project & structural checks (`node C:/Users/Arthur/Desktop/TVM/apps/ios/check-project.mjs`):**
  - Exited `0`: `287 passed, 0 warnings, 0 failed`, `iOS project structure, plists, standalone core and optional LAN contract look consistent.`, `EXIT_4=0`.
- **Core Vitest suite (`Set-Location C:/Users/Arthur/Desktop/TVM/apps/core; npx vitest run`):**
  - Exited `0`: `Test Files  71 passed (71)`, `Tests  716 passed (716)` (including `src/sync/sync.test.ts (12 tests)` in `3271ms`), `EXIT_5=0`.
- **Shared content check (`node C:/Users/Arthur/Desktop/TVM/scripts/check-content.mjs`):**
  - Exited `0`: `Content ok: 12 avatar sets, 2 events, 34 free channels, 16 services.`, `EXIT_6=0`.

---

## 4. What Is Untested

- **Android compilation & unit tests (`CI` required):** This Windows host has no Android SDK or Kotlin compiler installed, so Gradle build/compilation of `TvmSync.kt`, `TvmModels.kt`, `TvmStore.kt`, `TvmUpdater.kt`, `TvmLocalCore.kt`, `MainActivity.kt`, and JVM execution of `TvmSyncTest.kt` could not run locally. All edited/created Kotlin files were re-read after the final edit for imports, types, constructors, and nullability; CI must compile Android and run `./gradlew test`.
- **iOS compilation & XCTest (`CI` / macOS required):** This Windows host has no macOS or Xcode toolchain installed, so `xcodebuild build` / `xcodebuild test` for `TVMSync.swift`, `TVMSyncTests.swift`, and modified Swift files could not run locally. `check-project.mjs` verified Xcode project registration and static contracts (`287 passed`), and all edited/created Swift files were re-read after the final edit for types, concurrency/locking, and `CFBoolean` bridging; CI on macOS must compile and execute `TVMSyncTests`.
- **Real devices & live `tvm-accounts` sync server:** Live sign-in / `/v1/me/data` round-trips against `tvm-accounts` and real Android, iPhone, and Roku OS hardware (`roEVPDigest`, `roRegistrySection` persistence under size pressure, SceneGraph timer cadence, background/foreground wakeups, and multi-device end-to-end sync) were not exercised here; verification used Core's generated `sync-fixture.json`, in-memory mock transports, and the `brs@0.45.0` interpreter.
