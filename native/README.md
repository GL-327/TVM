# TVM native (C++, Windows)

## This copy: TVM modern

This folder is a copy of the native build, made outside the repository so it can be
used on its own. It differs from the `native/` folder in three ways:

- The colours and focus values are those of the default dark look of the current app
  (`apps/ui/src/theme/dark.css`), not the design package's root tokens.
- Posters, buttons and the focus fade follow the current app's CSS: the poster scale
  and outline, the button scale and pill shape, and the 200 ms and 140 ms motion tokens.
  The buttons ease in and out on focus.
- The version test reads the old repository's `package.json`. `build.bat` points it at
  `C:\Users\Gathe\Desktop\TVM`. Change `OLD_REPO` in `build.bat` if the old app moves.

To build and run:

- `build.bat` builds the app and runs the tests. It needs Visual Studio 2022 Build
  Tools with the C++ workload.
- The app is `build\tvm.exe`. `run.bat` starts it.

Home has the hero stage at the top, with its picture crossfade, its title dissolve, its
rotation and its fade with the page. The animated background scene is ported (`ui/stage`), but no
screen shows it, as the old app does not show it: its pages are opaque in the light and dark
themes (see `PARITY.md`, section 5b). The intro, the TVM sting with its rays, letters and tag, comes in
two forms, each playing once per run over the window (`ui/intro`, `PARITY.md` section 5c). The 'tvm'
form plays at launch. The 'stream' form plays when TVM Stream opens. Both read their mark from
`assets\tvm-icon.png` in this folder, a copy of the old app's `apps\ui\public\tvm-icon.png`, so keep
that folder beside `build\`. Pictures are read on the worker threads and made into bitmaps on the
window thread, a few each frame (`platform/image_cache`), so a large picture never stalls a frame. The brand lockup, the clock, the nav bar, the launcher
destinations row and most screens are not ported yet, so this copy is not yet identical to
the old app. `PARITY.md` lists every animation of the default look, with its source file and
its status here. Read it before relying on this copy.

## The native build

A standalone Windows EXE that replaces the Electron shell and the Node Core.
No Electron, no Node, no runtime installs: the goal is one `tvm.exe` that runs
from a folder. The existing `apps/` tree is untouched and stays the reference
for behaviour until parity is signed off.

## Status

| Phase | State |
| --- | --- |
| P0 Foundation: CMake project, Win32 window, MSVC build | **Done** |
| P1 Core runtime: config, prefs, DPAPI, AES-GCM vault, secrets, data layout | **Done and verified against the real data directory** |
| P2 Catalogue: Cinemeta titles, Home rails, details, artwork, HTTP | **Done and checked on screen** (see below) |
| P2 Library: watchlist, watch progress, profiles (read side), Continue watching, You might like, Because you watched | **Done and checked on screen** (see below) |
| P2 Real-Debrid: token, account, library lists, Settings screen | **Done and checked** (see below) |
| P2 Xtream: Live TV login, channel list | **Done and checked** (see below) |
| P2 Live TV channels: the channel screen, picks, saved playlist | **Done and checked** (see below) |
| P2 Live TV playlist: add or remove a playlist by address or text | **Done and checked** (see below) |
| P2 Providers: profile management, accounts, plans and billing, updates | Not started |
| P3 Playback | Not started. Decision needed (see below) |
| P4 UI: focus engine and animation system | **Logic done and verified** (see below) |
| P4 UI: widget tree, scene and Direct2D rendering (home screen) | **Done and checked on screen** (see below) |
| P4 UI: view stack, pointer input, Settings, Details, shell | **Done and checked** (see below) |
| P4 UI: every other screen, skins, theme packs, navigation bar | Not started |
| P5 Packaging and parity sign-off | Not started |

Android, iOS and Roku are separate tracks with their own folders. They are not
part of this directory.

## P1: what is in place

`src/core/` ports the storage and configuration layer of `apps/core`:

| Module | Ported from | Notes |
| --- | --- | --- |
| `util` | `secureFile.ts`, UTF-8 and base64 handling | Atomic replace via `MoveFileExW`. Base64 decoding matches Node's lenient rules |
| `crypto` | `providers/vault.ts` (AES), `secureFile.ts` (DPAPI) | BCrypt for AES-256-GCM, `CryptProtectData` for the master key. No PowerShell |
| `vault` | `providers/vault.ts` | Same on-disk format: `tvm-dpapi-v1:` master key, base64 `iv\|tag\|ciphertext` |
| `secrets` | `providers/secrets.ts`, `privateJson.ts` | `tvm-secret-v1:` values and migration of legacy plain files |
| `paths` | `update/paths.ts` | Same file names and locations under `%LOCALAPPDATA%\TVM` |
| `config` | `config.ts` | Port and bind rules, error messages kept |
| `prefs` | `prefs.ts` | Same `prefs.json` key order |

Deliberate changes from the Node core, each an improvement that loses no data:

- Reading sealed data never creates a master key. The Node core would create a
  new key and silently fail to open the old data.
- Preferences and secrets are written atomically with a temporary file and a
  move, so a power cut cannot leave a half-written file.
- The Windows DPAPI call is made directly, not through a PowerShell process.
- `TVM_CORE_PORT` accepts decimal digits only. The Node parser also accepted
  forms like `1e3` and `1.0`, which are almost certainly typos.

### Verification

Run from the build folder:

```bash
cmake -S native -B native/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build native/build
native/build/tvm_tests.exe
```

- `tvm_tests.exe` runs 168 tests across all modules, 32 of them for the core. They port the behaviour pinned by
  `config.test.ts` and `prefs.test.ts`, and check the AES-GCM output against
  the standard test vector. Two tests decrypt blobs produced by Node's own
  `crypto` module, so the C++ code is checked against the reference
  implementation, not against itself.
- `tvm_probe.exe [data-dir]` checks an existing installation without changing
  it. On this PC it opened the master key and every sealed record: entitlement,
  accounts, billing, usage, dev unlock, the Real-Debrid token and Xtream. A
  hash of the whole data folder was identical before and after the run.

The probe never prints values. It never creates, rewrites or migrates a file.

## Build

Requires Visual Studio 2022 Build Tools with the C++ workload (MSVC 14.44+,
Windows SDK 10.0.26100). CMake and Ninja ship with the same installer.

`third_party/nlohmann/json.hpp` is nlohmann/json 3.11.3 (MIT, see
`third_party/nlohmann/LICENSE.MIT`). It is vendored at a pinned version so the
build needs no network.

The `build/` folder is local output and should be ignored, not committed.

## Parity bar

"Perfect" means the same behaviour as the current app, with the known defects
in [docs/HANDOFF.md](../docs/HANDOFF.md) fixed. For each phase, the matching
tests under `apps/core/src`, `apps/shell/src` and `apps/ui/src` (plus the
Playwright specs in `apps/ui/e2e`) define what must still pass. Port each
behaviour, then port its test.

The rules in the root [README.md](../README.md) still apply, and they matter
most here:

- No secrets in the repository, a bundle, or a log. The Real-Debrid token lives
  in DPAPI-sealed storage under the user profile.
- Core binds `127.0.0.1` by default.
- No torrent indexing, magnet search, scraping or Torrentio.
- Everything works with arrows, OK and Back.

## P2: catalogue and artwork

The first part of P2 is the Cinemeta catalogue, which Home and Details need.
Requests, timeouts and cache lifetimes match the Node core.

| Module | Ported from | Notes |
| --- | --- | --- |
| `core/http` | The Node core's requests | WinHTTP GET over HTTPS. 12 s default timeout, 16 MB cap, compressed responses accepted |
| `core/js` | JavaScript runtime rules | `Number()`, `String(number)`, `encodeURIComponent`, trimming and the hue hash |
| `catalog/media_item` | The item shape in `providers/cinemeta.ts` | One movie or series, with the same JSON field names |
| `catalog/cinemeta` | `providers/cinemeta.ts` | Top, rated, recent and genre requests. Title details with episodes. Year and air-date rules. TVMaze episode ratings |
| `catalog/artwork` | `providers/artwork.ts` | Metahub poster and backdrop addresses, thumbnail sizing, HTTPS upgrade |
| `catalog/recommend` | `providers/media.ts` | Each title appears on one rail only. Genre rails interleave |
| `catalog/rails` | `providers/media.ts` `buildRails` | Home's rails in web order: popular films and series, new films and series, then the genre rails |
| `catalog/catalog_service` | `providers/cinemeta.ts` caching | Memory and disk caches. Writes `cache/catalog.json` in the Node format, so either core can show Home offline |
| `ui/catalog_view` | New | Turns catalogue values into what the screens show |
| `platform/artwork_store` | New | Downloads each picture once into `cache/artwork`, named by a hash of its address |
| `platform/image_cache` | New | Decodes cached pictures with WIC into Direct2D bitmaps. Cleared when the render target is rebuilt |
| `platform/background` | New | Worker threads. Results return to the window as posted messages, so screens change on one thread only |

Decisions made in this slice:

- Home is set once, when the whole catalogue is ready: the bundle and every
  genre shelf. `Scene::SetRails` returns focus to the first card, so a second
  set would move the viewer's focus. While it loads, the header says
  "Loading the catalogue...". Every request has the normal timeout, so a hung
  genre delays Home by at most that timeout.
- If the network and the disk cache both fail, the header says "The catalogue
  is unavailable. Check the connection."
- Only a real answer is kept in memory for a title. An unavailable one is asked
  for again the next time its details open.
- Posters download in the background, six at a time. A poster that fails is
  asked for again when a screen next needs it.
- Closing the window waits for a download already in flight. Queued downloads
  are dropped.
- `TVM_DATA_DIR` moves the catalogue and the artwork cache to another folder, so
  a test run can leave `%LOCALAPPDATA%\TVM` alone.

Verification:

- `tvm_tests.exe` runs 200 tests, all passing. The catalogue tests use a fake
  network, so they run offline. They cover the bundle and its dedupe, the disk
  cache format and its fallback, genre failures not being cached, series taking
  priority in meta, the search length rule, the order of Home's rails, and the
  JavaScript helpers.
- `tvm_catalog_check.exe` calls the live Cinemeta service. The run returned 49
  top movies, 50 top series, 49 rated movies, 50 rated series, 100 recent
  series, 52 new films, and 441 titles across 9 genre rails. The details of The
  Shawshank Redemption came back with its poster and backdrop addresses.
- `tvm.exe` was run with `TVM_DATA_DIR` pointing at a scratch folder, and its
  window was captured with `PrintWindow`. After 25 seconds Home showed posters
  on Popular films, Popular series and New films. Enter then opened the details
  of the first title, The Invite, with its poster, metadata line, synopsis and
  Play. The run downloaded 208 artwork files, all into the scratch folder.

Not verified:

- The Loading and Unavailable states of Details were not captured on screen.
  They are drawn by code only.
- Starting offline from the disk cache is covered by unit tests, not by a real
  network outage.

Still to do in P2:

- Live TV: the playlist entry screen, playback, the channel check and diagnosis,
  and search and paging on the choose-channels view.
- Accounts, plans and billing, mail, donations and updates.
- Search. The catalogue search is ported; the screen is not.
- Artwork fallbacks. The second artwork sources in `providers/artwork.ts` are
  not ported, so a title with no Metahub art shows a placeholder.
- Air dates. Only ISO dates are read.
- The catalogue service does not merge concurrent lookups for one title. The
  app does, for title details.

## P2: library (watchlist, progress and profiles)

The viewer's watchlist and watch progress, kept per profile, and the Home shelves
and Details button built from them. Ported from `providers/watchlist.ts`,
`providers/progress.ts`, `providers/recommend.ts`, and the read side of
`providers/profiles.ts`.

| Module | Ported from | Notes |
| --- | --- | --- |
| `core/profiles` | `providers/profiles.ts`, reading only | The active profile's folder. Without a registry, the data folder itself. An unreadable registry means nothing is shown or written |
| `core/paths` | `update/paths.ts` | `profiles\<id>` |
| `core/util` | `new Date().toISOString()` | `IsoTimestamp`, UTC with milliseconds |
| `catalog/watchlist` | `providers/watchlist.ts` | Same fields and rules. Newest first, at most 200. A file that cannot be read is never written over |
| `catalog/progress` | `providers/progress.ts` | Ratio rules, the 96% finish line, one completion counted per title, series take their furthest episode, one Continue watching card per show. Entries stay JSON, so fields this build does not know survive a save |
| `catalog/recommend` | `providers/recommend.ts` | Genre weights, scoring, You might like, Because you watched |
| `catalog/rails` | `providers/media.ts` `buildRails` | Home's catalogue rails in web order: You might like, popular and new shelves, Because you watched, then genres |
| `ui/catalog_view` | New | Continue watching and Watchlist shelves |
| `ui/details_screen` | New | The second button, with Left and Right to move between Play and it |
| `ui/shell` | New | Action commands go to the app, which saves the title. The stack does not change |
| `ui/widget` | New | A progress bar along the foot of a card, as the web card draws it |
| `platform/app` | New | Home is rebuilt when the details are left after a change, and focus returns to the same title |

Decisions:

- **Profiles and keys.** Each profile folder has its own master key
  (`profiles\<id>\secrets\master.key`), as in the Node core, and the native app
  opens each file with the key in its folder. The app reads `profiles.json` and
  never creates or migrates it, so the Node core still does the first-run setup.
  Without a registry, the root folder is used, where the files lived before
  profiles existed.
- **Nothing is written over a file that cannot be read.** The Node core replaces
  such a file with an empty one. The native app leaves it alone and refuses the
  change, so the Details button keeps the state it showed.
- **Watchlist count.** The Node core returns 201 titles on the 201st save until
  the next read. The native app returns the 200 it stores.
- **Continue watching order.** Progress is stored per episode, so a show's own
  card has no timestamp and sorts after the films, as it does in the Node core.
  The native app keeps that behaviour. A better order would be a change to the
  Node core first.
- **Not ported: the Adapted for you rail.** The web Home only shows it on the
  anime theme, and this build has no themes yet.

Verification:

- `tvm_tests.exe` runs 233 tests, all passing. The progress tests are the three
  cases in `progress.test.ts`. Others cover profiles, the watchlist's 200 cap and
  its migration of a plain file, the 96% finish line, completions counted once,
  unknown progress fields kept, the 16-card limit, the recommendation scores, the
  order of Home's shelves, the Details button, and that an unreadable file is not
  overwritten.
- `tvm_probe.exe` on the real data folder: the viewer's profile folder opens
  with its own key, and its progress file reads with 8 entries. No watchlist has
  been saved there yet. The probe prints counts, never titles. Its output was
  checked against a list of the folder's 3,835 files (names, sizes and times),
  which was identical before and after the run.
- The window was run with `TVM_DATA_DIR` set to a scratch folder, with progress
  seeded by `tvm_seed_progress.exe`, which refuses the viewer's own folder. The
  Continue watching shelf showed a film at about 19% and a show at about 55%,
  each with its progress bar. Enter opened Details, Right and Enter saved the
  title, and the button then read "Remove from My List". After Back, a Watchlist
  shelf appeared under Continue watching, and focus stayed on the same title.
  Removing the title took the shelf away, and the probe counted 0 saved titles.
  The final binary was run through the same add and remove sequence.

Not verified or not ported:

- Playback is not ported, so the app never writes progress itself. The progress
  writer is covered by tests and by `tvm_seed_progress.exe`. Resume points are
  read but nothing uses them yet.
- The Watchlist and Library screens (sorting, filters) are not ported.
- Completed titles (`finishedTitles`), which no screen uses yet, are not ported.
- Real-Debrid history is not in the recommendations, because the Real-Debrid
  library is not on Home yet (see P2: Real-Debrid).
- Profile management (create, rename, switch, remove) is not ported.
- Genre matching is ASCII lower case. Cinemeta's genre names are ASCII, so this
  matches JavaScript for them.

## P2: Real-Debrid

The Real-Debrid account on this machine: the saved token, the account's status
and the library lists. Ported from `providers/realdebrid.ts`, the library
helpers in `providers/media.ts` and the file-name rules in `providers/title.ts`.

| Module | Ported from | Notes |
| --- | --- | --- |
| `core/http` | The Node core's requests | Now sends POST bodies and extra headers, such as the Bearer token. A header value with a line break is refused |
| `catalog/title` | `providers/title.ts` | Show name, year, season, episode, chapter name and pack detection from a file name. The same patterns, run as ECMAScript regular expressions |
| `catalog/realdebrid` | `providers/realdebrid.ts` | Token store, status, paged downloads and torrents, torrent files, unrestrict and the HTML5 stream picker |
| `catalog/library` | `itemFromName`, `fromDownload`, `fromTorrent` in `providers/media.ts` | Each playable file becomes a catalogue item, with the Node ids (`rd:d:` and `rd:t:`) and the same order |
| `ui/realdebrid_screen` | `apps/ui/src/screens/RealDebrid.tsx` | Settings > Real-Debrid: account, token, premium and status rows, and the Paste and save, Disconnect and Privacy & terms buttons |

Decisions made in this slice:

- The token is entered with Paste and save, which reads the clipboard. The
  native UI has no text field yet, so the token never shows on screen.
- The token is sealed the way the Node core seals it. A token saved by either
  app works in the other.
- A saved token that is empty means the viewer cleared it, so `TVM_RD_TOKEN`
  is not used then. As in the Node core.
- Two small differences from the Node core. An empty `TVM_RD_TOKEN` counts as
  not set, where the Node core would send an empty token. A viewer with no
  token sees "Not connected", where the Node core says "Ready".
- A token with a line break in it is refused before anything is saved. The Node
  core would send it.
- A library file with no name is left out. The Node core would list it with a
  blank title.
- The library is read but not shown on Home. A library card opens Details, which
  only knows catalogue titles, so the library waits for playback and the Library
  screen.
- Unrestrict and the stream picker are ported with the client. Nothing calls
  them until playback is ported.

Verification:

- `tvm_tests.exe` runs 275 tests, all passing. The filename cases are the ones
  in `media.test.ts`. The client runs against a fake network that records each
  request, so the tests cover the token order, where paging stops, the refused
  and unreachable states, and the form encoding of unrestrict. The screen is
  tested through the shell.
- `tvm_probe.exe --online` read the token the Node core saved on this PC. The
  account answered, and the library was read. The probe prints counts only.
- The library mapping was compared with the Node core's logic on the library of
  the account used for the probe, and on 77 synthetic names (release tags,
  brackets, website names, en dashes, non-ASCII letters and each episode form).
  Every item matched in every field. That comparison ran outside the repository.
- Settings > Real-Debrid was rendered from a scratch data folder. A live run of
  the same screen then showed Paste and save with a made-up token giving "Real-
  Debrid rejected that token.", and Disconnect giving "Token cleared".

Not verified or not ported:

- Playback. Unrestrict and the stream picker have no caller until P3.
- Library artwork. The Node core adds posters to library items (`libraryArtwork.ts`).
  Library items have none yet.
- Accounts. The per-account token (`accountToken`) is not ported, because this
  build has no accounts.
- Caching. The Node core keeps the status for 20 seconds and the library for 45.
  The native app reads the status each time the screen opens, and reads the
  library only once the Library screen needs it.
- Search over the library (`item`, `search`) is not ported.

## P2: Live TV login (Xtream)

The Xtream panel login for Live TV: the server, username and password kept sealed on
this machine, the check that the panel accepts them, and the channels it serves.
Ported from `providers/xtream.ts` and the login part of `providers/live.ts`.

| Module | Ported from | Notes |
| --- | --- | --- |
| `catalog/xtream` | `providers/xtream.ts`, `setXtream`, `readXtream`, `writeXtream` | Server rules, the player_api address, the login check, the channel list and the sealed store. The stream address follows the MPEG-TS rule, with `TVM_XTREAM_HLS=1` for HLS |
| `catalog/live_channel` | `LiveChannel` in `types.ts` | The channel shape the Live TV screen will use |
| `catalog/title` | `isHttpUrl`, `httpAssetUrl` in `title.ts` | Logo addresses: protocol-relative gets https, anything else that is not web is dropped |
| `core/util` | `URLSearchParams` | `FormEncode`, shared with the Real-Debrid unrestrict call |
| `ui/xtream_screen` | `apps/ui/src/screens/LiveXtream.tsx` | Settings > Live TV login: the account, channel count, and rows for the server, username and password, with Save login and Disconnect |

Decisions made in this slice:

- The native UI has no text field yet, so each of the three values is filled
  from the clipboard by its own row. The password is never shown: the row reads
  "Pasted" or "Not pasted".
- As the Node screen does, the password is cleared once the panel has answered,
  whatever the answer. A refused login leaves the server and username in place.
- The saved login is read on each visit to the screen, and that reads the
  channel list from the panel. The Node core keeps the list in memory until the
  login changes. The native app does not cache it yet.
- A channel list can run to megabytes, so the list request allows 64 MB where the
  other requests allow 16 MB.
- Each Xtream channel carries no stream address. Playback will open it by id, as
  the Node core does.
- A saved login that is still plain JSON is sealed when it is first read, as the
  other private JSON files are. The Node core reads sealed logins only.
- Pasted values lose their surrounding white space. The Node core keeps the
  password exactly as typed.

Verification:

- `tvm_tests.exe` runs 304 tests, all passing. The server rules, the address
  builders, the login check, the channel list, the sealed store and the screen
  are covered, with the cases from `xtream.test.ts` and the Xtream cases in
  `live.test.ts`. The panel is a fake that answers from a route.
- The Node core's own `fetchXtreamLive` and the native client read the same
  panel, which was run on this PC. It answered twelve different ways: a good
  login, a refused one, an inactive account, a missing `user_info`, a 401, a
  server error, an empty list, a list that is not a list, a categories failure
  and odd rows (numeric and spaced ids, a null category, duplicates, logos in
  several forms). Each answer came out the same in every field.
- The same 29 addresses were normalised by both. 27 came out the same. Two
  differ on purpose: an `ftp://` address is refused (the Node core turns it into
  a broken `http://` address), and an internationalised host name is refused
  (the Node core converts it to punycode).
- The live app was run with a fake panel on 127.0.0.1 and a scratch data folder.
  A refused password showed "That login was rejected", and a correct one showed
  "9 channels ready." After a restart the saved login came back with its channel
  count. The saved file held neither the password nor the account name.
- `tvm_probe.exe` read the login the Node core saved on this PC. The probe prints
  only whether it reads. It makes no request to the panel.

Not verified or not ported:

- Disconnect was not pressed on screen. The window lost keyboard focus in the
  scripted run. The store is covered by a test, and the Real-Debrid disconnect
  follows the same path.
- The Live TV channel screen, the channel picks, the M3U playlist login, the
  channel check and diagnosis, and the stream proxy (`providers/live.ts`).
- Playback. The stream address is built, but nothing calls it until P3.
- A URL that is not a web address is judged by a simpler rule than the browser's
  URL parser. Addresses with unusual characters may be treated differently.
- Accounts. The per-account login used by the hosted app is not ported.

## P2: Live TV channels

The channels Live TV can show, from the saved Xtream login or the saved playlist,
and the picks that choose which of them the screen lists. Ported from the
catalogue, picks and status parts of `providers/live.ts`, the M3U reader in the
same file, and `apps/ui/src/screens/LiveTV.tsx` and `LivePicks.tsx`.

| Module | Ported from | Notes |
| --- | --- | --- |
| `catalog/live` | `live.ts`: `parseM3u`, `liveChannelId`, `loadCatalog`, `storedPicks`, `savePicks`, `togglePick`, `compose` | The M3U reader, the channel id hash, the sources in Node's order (login, saved text, saved address), the picks file, and the rules that decide what is listed |
| `ui/live_tv_view` | `LiveTV.tsx`, `LivePicks.tsx` | What the screen shows for a catalogue and its picks: the status line, the rails, the top buttons, and what OK does |
| `ui/scene` | `LiveTV.tsx` | Scenes take several top buttons, a card action (details, play, or toggle a pick), and a view update that keeps the viewer's place. Home has Settings and Live TV at the top |
| `core/paths` | `update/paths.ts` | `live-playlist.json` (sealed) and `live-picks.json` (plain), in the data folder itself, as Node keeps them |

Decisions made in this slice:

- Choose channels is a mode of the Live TV screen. Node opens it as a page of its
  own. In the native app every channel is in a rail, grouped as on the watch
  view, and OK picks or unpicks a channel. Picked channels show a check mark.
  Done returns to watching.
- A pick is refused at 48 with the Node message. Picks are saved at once, in
  the Node format, `{"ids":[...]}`, so either app reads the other's picks.
- The screen's buttons are Choose channels and Login. An unreachable source
  adds Retry. Done replaces Choose channels while choosing.
- The status line is a band across the top of the screen. The page scrolls
  beneath it, so the line never sits on a title.
- The source is read on each visit, and a login saved in between shows. The Node
  core keeps the catalogue in memory until its sources change.
- Playlist header lines (`#EXTVLCOPT`, `#EXTHTTP`) are not read yet. They only
  matter for playback.
- Sizes: a playlist over 8 MB is refused, as in Node. The native app counts bytes,
  where the Node core counts characters.

Verification:

- `tvm_tests.exe` runs 363 tests, all passing. The catalogue cases cover the
  channel id, the M3U rules (names, groups, logos, duplicate addresses, lines
  that are not addresses, header lines), the saved playlist, the sources and
  their order, the size limit, the picks, and the status rules. The screen
  cases cover each state of the screen, the top buttons, the card actions, the
  focus across an update, the band over the page, and the shell route.
- `livecheck` compared Node's own `live.ts` with the native module on the same
  files. The M3U reader gave identical channels for a 34-line file with the
  awkward cases, and the Live TV status gave identical results in all eleven
  scenarios: saved text, a 60-channel list with and without picks, unknown and
  repeated picks, invalid text, a list with no channels, the saved address served
  locally (good, bad, 404, bare HLS), an unreachable address, and nothing saved.
  Node read the playlists that the native code sealed.
- The live app was run with a scratch data folder holding a six-channel playlist.
  Home's Live TV button opened the screen with three rails, one per group, and
  the Login and Choose channels buttons. Choose channels then Enter on a channel
  put a check mark on it, and the picks file was written in the Node format.
- `tvm_probe.exe` reads the saved playlist and the picks on this PC and prints only
  the kind of playlist and the number of picks. Nothing is fetched.

Not verified or not ported:

- On screen: Done back to the watch view with picks, the refusal at the limit,
  Retry, the unreachable state, and the band over scrolled content. These are
  covered by the unit tests. Keyboard focus was unreliable in the scripted runs,
  and the Home rails reorder between launches.
- The dev sample channels and the paid-plan gate. Without a plan, Node shows the
  add-on screen when there is no source; here the empty state says no source is
  connected.
- Playback, the channel check and diagnosis, the stream proxy, and search and
  paging on the choose view.

## P2: Live TV playlist

The playlist entry screen: paste an M3U or M3U8 address, or the playlist text,
save it, or remove the saved playlist. Ported from `apps/ui/src/screens/LivePlaylist.tsx`
and `setPlaylist` and `looksLikePlaylistText` in `providers/live.ts`.

| Module | Ported from | Notes |
| --- | --- | --- |
| `catalog/live` | `live.ts`: `setPlaylist`, `looksLikePlaylistText` | Saving follows Node: an empty value removes the playlist, playlist text is kept only when it has channels, an address is kept without being fetched, and anything else is refused with nothing changed |
| `ui/live_playlist_screen` | `LivePlaylist.tsx` | The playlist, channel count, address and text rows, with Save playlist, Remove and Open Live TV. The text is never shown, only its size |
| `ui/live_tv_view` | `LiveTV.tsx` | A Playlist top button on every state of the Live TV screen, where Node has its Add a playlist and Playlist buttons |
| `ui/shell`, `platform/app` | | The `live-playlist` route. Each visit reads the saved playlist. Paste, save and remove run on workers, as the channels do |

Decisions made in this slice:

- Save stores the pasted text when it reads as a playlist, and the address
  otherwise, as the Node screen does.
- Save with both fields empty removes the saved playlist, as the Node screen does.
  The screen says "Playlist removed." in that case.
- After a save the screen stays where it is, with a message such as "2 channels
  ready. Choose the ones you watch." Node goes on to its picks page. Here the Live
  TV screen has Choose channels, and Open Live TV on this screen goes there.
- Open Live TV replaces the Choose channels and Back buttons of the Node screen.
  Back is the remote's Back button, as on every screen.
- Sizes are counted in bytes, and the text row shows "Pasted, N bytes".
- The Settings row for the playlist already opened this screen. It now has work to do.

Verification:

- `tvm_tests.exe` runs 363 tests, all passing. The new cases cover the save rules
  (playlist text with channels, invalid text, empty, an address, a value that is
  not web, and the size limit), the playlist label, the screen's rows and focus,
  the action commands, the busy state, the click targets, the Live TV buttons in
  every state, and the shell route.
- `livecheck` ran 15 save sequences against Node's `setPlaylist`, one folder per
  sequence, each step checked: stored, invalid, cleared, bad content at an
  address, 404, a refused connection, a bare HLS address, 60 channels needing
  picks, text and address replacing each other, and a value over the size limit.
  Every step left the same URL, error, channel count and shown channels as Node.
  The status comparison of the channel slice was run again after the change, and
  its eleven scenarios are still identical.
- The live app was run from a scratch data folder. Live TV showed the Playlist and
  Login buttons. The playlist screen showed its rows and focus. Enter on the Text
  row pasted the test playlist ("Pasted, 156 bytes"), and Save playlist showed
  "Pasted on this machine", 2 channels and "2 channels ready. Choose the ones you watch."

Not verified on screen:

- Open Live TV after the save, Remove, pasting an address, and the Retry and
  unreachable messages. The unit tests and the save comparison cover their rules,
  but the scripted run lost keyboard focus before those steps.

## P4: the UI and its animations

### Done: focus engine and animation system (logic only)

These modules are pure C++ with no Win32 calls, so they are tested directly.

| Module | Ported from | What it does |
| --- | --- | --- |
| `nav/intents` | `packages/nav/src/intents.ts` | Remote keys to intents. Win32 virtual-key codes. Ctrl, Alt and Win combinations ignored |
| `nav/hop_queue` | `apps/ui/src/nav/hopQueue.ts` | One D-pad hop per frame, held-key pacing at 105 ms, direction change drops queued hops |
| `nav/focus_tree` | `@noriginmedia/norigin-spatial-navigation-core` 4.1.0 | Spatial focus over a tree of leaves and containers. Same cutoff filter, 20% adjacent-slice test, 5x and 1x weights, centre distance, and recursion to the parent's siblings. Containers remember their last focused child. Boundaries |
| `nav/wrap` | `railNav.ts`, `wrapFocus.ts`, `loopingRail.ts`, `revealFocused.ts` | Row, column and grid wrap rules. Three-copy loop geometry and seam parking. Camera targets for the page pan |
| `motion/easing` | CSS `cubic-bezier` and `@keyframes` | Browser-style solve (Newton, then bisection). Keyframes eased per segment, as CSS does |
| `motion/camera` | `apps/ui/src/nav/scrollAnim.ts` | Frame-rate-independent ease (0.24 per 16.7 ms), settle at 0.6 px, 90-step cap, retargeting, reduced motion snaps |
| `motion/timeline` | CSS animation clock | Runs every animation once a frame. Pausing holds the clock, so resume does not jump (matches the hidden-tab behaviour) |
| `motion/preferences` | `apps/ui/src/theme/motion.ts`, `motion.css` | Auto, full and reduced. Performance mode reduces motion. Token durations 140, 200 and 260 ms, and 1 ms when reduced. Glass sweep 520 ms, or 0 when reduced |

Verification: `tvm_tests.exe` runs 168 tests, all passing. Three of them compare
against the web UI itself:

- **Focus engine.** `tests/fixtures/generate-nav-vectors.cjs` runs the real
  Norigin 4.1.0 library on 240 seeded random layouts and records the candidate
  it picks. The C++ engine must choose the same one. 174 of the layouts have a
  valid target and are all checked.
- **Camera.** The same script replays `scrollAnim.ts` on five timed cases. The
  C++ tween must match every frame, including the settle frame and the 90-step
  cap.
- **Easing.** Curve values are checked against an exact solve.

To check that the focus comparison has teeth, the main-axis weight was changed
from 5 to 1 for one run. The focus test failed on that run, and the original
value was restored and rebuilt.

### Done: widget tree, scene and Direct2D rendering

The screen is built as a widget tree (`src/ui`) and drawn through an interface
(`ui::Painter`). The tree and its logic have no Win32 calls. Direct2D and
DirectWrite live in `src/platform`.

| Module | What it does |
| --- | --- |
| `ui/painter` | The drawing interface, plus the colour helpers. The widgets draw only through it |
| `ui/widget` | `Stack` (vertical), `Rail` (horizontal, scrolls inside a clipped viewport), `Heading`, `Card` (poster, label, focus scale and ring). Design-token sizes and colours |
| `ui/scene` | The home screen. It owns the tree, binds it to the focus engine, runs the focus fades and the rail and page cameras on the timeline, and handles navigation |
| `platform/graphics` | Direct2D, DirectWrite and WIC factories. Text formats cached. Segoe UI Variable Display, falling back to Segoe UI |
| `platform/d2d_painter` | `ui::Painter` on any Direct2D render target |
| `platform/app` | The window, the frame loop and key input. Keys go through `IntentFromKey` and `AxisHopQueue`. The loop sleeps when nothing is moving |
| `platform/snapshot` | Renders a scene to a PNG through a WIC bitmap, for visual checks |
| `main.cpp` | `tvm.exe` runs the app. `tvm.exe --snapshot out.png --size 1920x1080 --keys Right,Down` renders a settled frame and exits |

Navigation follows `railNav.ts`. Left and right wrap along a rail. Up and down
move to the card in the neighbouring rail whose centre is closest. A rail
centres the focused card, and the page brings the focused row under the chrome.
Both cameras use the camera tween from the motion layer, so they ease the same
way the web UI does. Reduced motion and Performance mode land at once.

The rail scroll is clamped to the content. It does not loop the way the web
conveyor does (see below).

Verification:

- `tvm_tests.exe` runs 85 tests at the time, all passing. The 14 new UI tests check the
  layout against the design tokens at 1080p, wrapping, vertical moves, focus
  fades on the timeline, both cameras including the clamp at the end of the page,
  reduced motion, the focus ring, and the 1.08x poster scale.
- Snapshots were rendered and inspected. The resting frame shows the focus
  ring clear of the heading. A moved-focus frame shows the lower rail and the
  page scrolled to its limit.
- The real window was run. Remote key presses were posted to it, and the
  window was captured with `PrintWindow`. Focus and scroll matched the
  snapshot.

### Done: view stack, pointer input and the first screens

| Module | What it does |
| --- | --- |
| `nav/view_stack` | `packages/nav/src/viewStack.ts`, ported rule for rule. The root is permanent, modals close before the page under them, transient entries are dropped with the entry above them, and focus is remembered per entry. The reducer is pure. 25 tests follow the web tests one for one |
| `nav/pointer` | `apps/ui/src/nav/pointerInput.ts`: the cursor is hidden until the mouse moves and hidden again by any remote press. Hover focuses an item only for a real move (2px jitter ignored, never while a button is held). A click focuses and activates on release, and a drag beyond 8px is not a click. The wheel pans the rail under the pointer when the wheel is sideways or Shift is held, and the page otherwise. Touch pans a rail or the page once an axis locks, and a fast release coasts. 26 tests |
| `ui/screen` | The screen interface. Home, Details, Settings and the placeholders implement it, so the shell routes input without knowing which screen is on top |
| `ui/shell` | Owns the view stack and one screen per entry. Routes remote, mouse, wheel and touch input to the top screen, opens the screen a command names, and keeps focus when a screen is left and returns. Back at the root returns false, so the app decides |
| `ui/settings_screen` | Settings, rows and copy from `Settings.tsx`. Motion, performance mode, the app language and automatic updates are real and saved through the store. The other rows open the screens they name. The Look group and the Linux desktop row are not included (see below) |
| `ui/details_screen` | The poster, year, rating, runtime, genres, episode count and synopsis from the catalogue, with loading and unavailable states. Play opens the player. Add to My List or Remove from My List, once the title has loaded |
| `ui/pending_screen` | The placeholder for every screen not ported yet. It says so on screen, and Back returns from it |
| `ui/preferences_store` | Motion and performance go in `ui-prefs.json`. The language and automatic-update settings go in `prefs.json`, the file the Node core reads, so the two apps agree. Both are written atomically. The screens see only the interface, so tests use a memory store |

Two things were added so the new screens can be reached:

- A **Settings** button sits at the top right of Home. Up from the top rail
  reaches it, and Down returns. It is a stopgap until the web's navigation bar
  is ported.
- The motion change made in Settings is applied to every screen at once,
  through `SetMotion`.

Verification:

- `tvm_tests.exe` runs 168 tests, all passing. The shell and screen tests run
  the real home scene, Settings and Details through the shell, with a memory
  store, so no test touches the real data folder. Preference-store tests check
  the exact JSON the Node core reads.
- Snapshots were rendered through the shell: Settings after Up and OK, and
  Details after Right, Down and OK. Both were checked on screen. The Settings
  title's descenders were clipped in the first render and were fixed.
- The real window was run with mouse messages, wheel messages and remote keys.
  Hovering a card focused it without moving the camera. A wheel over the header
  scrolled the page. A Shift-wheel over a rail moved that rail by exactly 100px.
  Up, OK, Down, Down and Back took Settings open and closed, with focus skipping
  the Look group. Settings rows that save were not pressed, so the real
  preferences folder was not changed.

Not verified: touch on a real touch screen. The touch handling is covered by
unit tests and by the message route, but no touch screen was used. Mouse
messages were posted by the test script rather than moved by a real mouse.

### Still to do for P4

- The remaining screens: Library, Watchlist, Search, Downloads, Live TV and its
  playlist, Accounts, Profiles, Plans, Legal, Donate,
  Changelog, Updates, Diagnostics, Setup, Recovery, the player, and the rest.
  Each one shows the placeholder until it is ported.
- Data. Home, Details and the Continue watching and Watchlist shelves use the
  catalogue and the viewer's data now. The Library and Watchlist screens still
  show placeholders. Settings rows that need the core say "Needs the core (phase 2)".
- The Look group (light and dark themes). It needs the palette port, because
  the widget colours are constants today. Until then it reads as an information
  row, not a choice.
- The web's navigation bar (Home, Live, Library, Search, Settings) and its
  Ribbon. The Settings button is the only navigation control for now.
- Rail loops. The web UI's three-copy conveyor (`loopingRail.ts`) is ported as
  geometry in the engine, but the scene does not use it yet. Rails clamp.
- Shadows. The card and focus shadow tokens are not drawn.
- Text is single-line and ellipsised. The web UI measures and wraps text in the
  browser, so titles and headings need a measuring pass before the layouts match.
- The phone viewport and device chrome rules, which do not apply to a Windows
  window. The keyboard-field handling of `pointerInput.ts` is not ported for the
  same reason.
- The window is only checked at 1280x720 and 1920x1080. Other DPI scales and
  multiple monitors need their own check.
- Touch on a real touch screen has not been used.

### The UI inventory

The React UI is large, so the native port is planned from its real inventory:

- About 76 source files contain animation or transition code. There are 60
  `@keyframes` sets and 161 `transition` or `animation` declarations.
- `apps/ui/src/theme/motion.ts` has three motion preferences (`auto`, `full`,
  `reduced`) and a separate performance mode that switches off decorative
  motion, blur and shadows. Both must carry over.
- Focus and scroll motion lives in `nav/focusEngine.ts`, `nav/scrollAnim.ts`,
  `nav/hopQueue.ts` and `nav/loopingRail.ts`.
- Visual tokens are in `packages/design`.
- The Direct2D design: a retained widget tree, one animation clock that all
  tweens share, and a focus engine that receives the same arrow, OK and Back
  intents as the web version.

Animations are part of the port, not a later addition. Each one is listed,
matched to its CSS or React source, and checked on screen, with reduced-motion
and performance mode behaving as they do now.

## Open decisions

1. **Playback.** The current app uses mpv through `apps/shell/src/mpv.ts`.
   Options are bundling `libmpv` as a DLL in the folder (no install, same
   codec coverage) or Media Foundation (no DLL, but codec gaps to close). A
   bundled `libmpv` is the lower-risk choice.
2. **UI toolkit.** Direct2D with DirectWrite is the choice for the rendering
   layer. The focus engine and animation logic above does not depend on it, so
   it stays in place whichever renderer is used.
