# Roku 1.4.3 builder report

Implementation is complete for the Roku pass below. BrighterScript and package
checks pass. The full test command is **not green in this sandbox**: 447 pass,
4 fail because the BrightScript interpreter cannot be fetched/run here; the
last run also hit a temporary-directory cleanup permission error. No hardware
acceptance is claimed. The lead must rerun those four tests before release.

Only `apps/roku/**` and this explicitly requested report were edited. No commit,
branch, stash, reset, checkout or push was performed. Shared notes, root version
and other builders' files remain the lead's integration work.

## Settings and profile controls — sections 3.4, 7 and 8

- Settings categories are windowed to twelve visible entries, so About and
  Developer no longer draw below the TV canvas. Category navigation clears an
  old search; the search row remains reachable with Up and opens the Roku
  keyboard. Results can be entered with Right/OK, including returning to Search
  to clear a query with no matches.
- Back from the panel returns to categories; a second Back bubbles to the scene
  stack. Switches use OK, segmented controls use Left/Right or OK, and value
  rows open a list with OK. Left/Right no longer silently changes select rows.
- Home rows retain focus by section ID after moving. Settings refreshes its row
  order after saving; visible Up/Down hints describe Left/Right reordering and
  OK still operates the visibility switch. Descriptions allow two lines.
- All requested Roku categories exist. Extras has descriptions and switches for
  online subtitles, collections, coming up, watch stats, anime titles, ratings,
  quality badges, version picker, spoiler hiding, surprise me, automatic
  collections, sleep timer and announcements.
- Unsupported controls remain omitted: downloads, app volume boost, trailer
  playback/hero previews, desktop/web extras, night mode, and chapters (there is
  no chapter model exposed by this player). Webhooks belong to the paired Core.
  Roku system settings still control the actual caption appearance; TVM offers
  the saved caption-style preview and describes that limitation.
- Profile editor now renders Kids as a switch and age as four segments. Existing
  adult-PIN checks and server-side validation are preserved. Left/Right changes
  age in either direction. Options no longer accidentally activates edit rows.
- New `AvatarPicker` provides windowed horizontal set tiles and circular 192-unit
  characters (96 px at 1080p), names, focus and selected rings. It restores the
  saved character and supports returning from characters to sets with Up/Back.
  Set tiles prefer supplied `cover`/`image`, falling back to the first character.
  Current shared sets have no separate cover field; adding film/show covers to
  shared content is a lead/content-builder follow-up if required.
- PIN keypad now shows four separate masked boxes. Digits, Delete, Done,
  cooldown and Back retain the existing remote path. Injected remote intents
  now cover PIN entry and the transport/Options keys as well.

## Guide — section 6

- Preserved cell-to-cell arrows, time anchor on Up/Down, OK/Play tuning,
  Rewind/FastForward eight-channel jumps, red now line, white focused cell with
  dark text, programme details and the Channels toggle.
- Empty grids return focus to tools without producing row -1. The initial
  fetch includes three hours before now. Left at the first visible cell moves
  back thirty minutes and fetches an earlier window at the loaded boundary;
  the corresponding forward boundary also requests more data.
- The bottom Watch button is operable: Options, or Down past the last channel,
  focuses it; OK watches and Up returns to the grid. Its panel shares the glass
  material and uses programme art when supplied.
- Hiding Live TV now hides its GuideGrid, stopping the clock and pending numeric
  tune timer. A number entered before leaving cannot tune later from another
  screen. The old channel list still returns to Guide with Back.

## Release notes and player menus — section 14

- Config flags are retained when they arrive away from Home. Navigation/Home
  loading retries the pending pop-up once Home is ready or empty and has no
  other modal. The old small card cannot mark the release seen before config
  arrives, or consume a release queued for the pop-up.
- Notes are selected by installed version and filtered for Roku applicability.
  Every change is retained; the former eight-change cutoff is gone. The Roku
  manifest was still 1.3.0 and is now **1.4.3** so its installed version can match
  the lead's 1.4.3 shared notes. The lead must add those notes/root version before
  publishing; this builder did not edit them.
- NoticePanel pages with Up/Down, displays page count, and closes with OK or
  Back from any page. Explicit line limits also split long unbroken URLs/words.
  The shared text-page helper is used by What's new and the other long pages.
- Version selection now stays in a child panel over the existing video. Back
  returns to Control Centre without stopping playback. Selecting a version asks
  the scene to resolve it at the current position. Injected directions/OK reach
  that child panel. Options on a list no longer selects a release accidentally.
- Play/Pause is handled before the Control Centre focus zone, and bubbles from
  the child lists to the player, so it works while menus are open. Existing
  Sleep timer submenu Back, audio/subtitle choices and original-track selection
  were traced through ControlCentre and PlayerScreen.

## Glass — section 3.1

- Rebuilt generated rims with a brighter upper-left highlight, weaker
  lower-right reflection and a 20% brighter focus stroke. Twelve PNGs changed;
  all were generated by the committed `scripts/make-glass.mjs`, with no new
  downloaded images.
- `GlassPanel` can decode the existing backdrop at 96 x 54, stretch it behind an
  inset mask/tint and retain the rim/shadow. Used on Settings cards, notices,
  Guide info when art exists, and Control Centre. This is softened art, not
  framebuffer sampling or a real-time blur.
- `GlassOverlay` delegates to the same material instead of rectangular edge
  strips. Settings' small plates also use the generated rim. Nav remains solid;
  buttons already share GlassPanel. Reduce transparency hides art and forces
  fills opaque, including fills that specify their own alpha.

## Playback and account key — sections 1 and 5

- Traced `localCore.lcPlaybackSelection` through `lcRankVersions`, native height
  and codec/HDR checks, original-language selection and RD's original
  `unrestrict/link.download` URL. No RD transcoded stream URL is selected.
- Fixed dub detection to read the release description as well as title. A
  MULTI label no longer overrides an explicitly non-original-only language list.
- Added unsupported legacy codec/AVI/WMV detection, recognised supported
  MP4/M4V/MOV filenames instead of assuming all BluRay sources are MKV, and
  added audio compatibility checks. TrueHD-only sources are rejected; known
  AAC/AC3/EAC3/DTS uses the current device/HDMI audio capability query.
- Existing language-first, native-resolution, source-grade, bitrate and cache
  ordering remains. Original always excludes upscales, cams/TS/TC/screeners.
- RD already had the correct no-cache design: `lcRdTokenInfo` reads the service
  key every request and `lcResolveAccount` reads `/v1/me` live. No key-cache
  rewrite was needed. Added a fixture for no key, assignment reported by
  `/v1/me`, then immediate key retrieval without a restart.
- Capability APIs were checked against Roku's [device interface reference](https://developer.roku.com/dev/docs/ifdeviceinfo)
  and [streaming specifications](https://developer.roku.com/dev/docs/media).
  Manifest version behaviour follows [ifAppInfo](https://developer.roku.com/dev/docs/ifappinfo).

## Per-screen static key trace

These are source traces, not on-device results. Roku Home always exits the
channel and cannot be intercepted.

| Screen / panel | Entry and arrows | OK / other keys | Back path |
|---|---|---|---|
| Home / NavStrip | Hero → Up to nav; Down to rails; bounded nav, one rail slot focused | OK activates; Options opens release history while the card shortcut is active | Scene stack; Home itself stays open |
| Settings categories / search | Up reaches search; Up/Down scroll categories; Right enters results/panel | OK on search opens StandardKeyboardDialog; Cancel restores screen focus | Leaves Settings from the left list |
| Settings panel | Up/Down rows; Left/Right segments or Home row order | OK switch / select sheet / action | Returns to categories, then leaves |
| Setting options | Windowed Up/Down list; selection returns to retained Settings state | OK saves the chosen value | Returns without choosing |
| GuideGrid tools / grid / info | Up: grid → tools → nav; Down reverses; time anchor retained between channels | OK/Play watches; Rewind/FF ±8 channels; Left scrolls earlier; Options focuses Watch; Replay returns to now | Scene closes Guide |
| Channels list | Group rows and channel tiles; Up reaches nav; footer controls reachable | OK plays, opens playlist/picks, or switches to Guide | Returns to Guide |
| Profile chooser | Left/Right across profiles and Add | OK switches/adds; Options edits | Scene returns to previous screen |
| Profile editor | Up/Down windowed rows; Left/Right age segments | OK Kids switch, name keyboard, avatar, PIN, save/delete actions | Returns without saving draft edits |
| AvatarPicker | Left/Right set tiles; Down/OK to characters; Left/Right character windows | OK saves a character or colour/initial | Characters → sets → editor |
| PinPanel | 3-column keypad with bounded arrows | OK digit/Delete/Done; four masked boxes; cooldown retained | Cancels modal and returns to editor/chooser |
| Patch notes / notices | Up/Down bounded pages, button stays visibly focused | OK closes any page | Closes modal and restores underlying focus |
| What's new / stats | Up/Down release/history rows; Left/Right body pages | OK clear-history asks for confirmation | Returns to Settings |
| Player / quality list | Video → progress → transport/Control Centre; child list owns directions | OK controls; Play/Pause works in menus; Rewind/FF seek; Options opens playback options | Child list → player; player → originating screen |
| Control Centre / sleep | Tabs Left/Right, OK/Down activates; Up from first row reaches tabs | OK audio/subtitle choice or timer; submenu has all timer choices and a return row | Sleep → Playback; then closes Centre |
| Player versions | Up/Down release list over retained video; injected keys forwarded | OK resolves selected version at saved position | Returns to Centre while video continues |
| Details / episodes / collections | Actions Left/Right; Down seasons/collection; episodes Left/Right | OK play/save/version/reviews; collection OK opens title | Episodes → seasons → originating screen |

## Verification

- `node ../../.pnpm-store/npm-cache/_npx/cd70eacc7d3d4d3f/node_modules/brighterscript/dist/cli.js --project bsconfig.json`
  from `apps/roku`: **0 errors**, pinned compiler **0.73.5** from the existing
  workspace cache. Direct `npx --yes brighterscript@0.73.5 --project bsconfig.json`
  was attempted first but npm network access was denied.
- `node --test apps/roku/scripts/`: **451 total, 447 pass, 4 fail, 0 skipped**.
  The four affected tests are account-copy runtime, Extras runtime, QR runtime
  and the new 1.4.3 runtime fixture. Normal npm returned `EACCES` fetching
  `brs@0.45.0`. Repeating with a writable task-local cache and offline mode
  returned `ENOTCACHED`; the final QR cleanup also returned `EPERM` for its temp
  directory. This is not a passing runtime run. No assertions were weakened or
  tests skipped to mask it.
- The four new static tests passed. The new fixture extracts production key
  handlers, page splitting, release queue, RD functions and ranking; only
  SceneGraph/device/registry/HTTP edges are stubbed. Its assembled BrightScript
  was parsed with the cached compiler: **0 syntax diagnostics**. Its behaviour
  remains unexecuted until the interpreter dependency is available.
- `node apps/roku/scripts/make-glass.mjs`: rebuilt deterministic assets. Existing
  material tests (including all 9-patch guides and highlight direction) passed.
- `node apps/roku/scripts/package.mjs`: wrote `apps/roku/tvm-roku.zip`, **270 files**.
- `node apps/roku/scripts/check.mjs`: **passed**.
- `git diff --check -- apps/roku`: **passed**. Edited text uses LF.
- Added remote instructions to Roku README and the unverified 1.4.3 device
  acceptance script to DEVICE_TESTING.md. No Roku, HDMI receiver, real RD stream,
  IPTV feed, live screenshot or measured playback bitrate was available.

## Lead integration

Rerun all tests with `brs@0.45.0` cached/available, add matching 1.4.3 shared notes
and root version, repackage, then run the device acceptance script. The current
zip is a local build output, not a published release. Suggested Roku-only notes:

- Roku Settings keeps every category and Home row control within reach of the remote.
- Roku profiles now use Kids switches, age segments, character tiles and four PIN boxes.
- Roku release notes wait for Home and let you page through every change.
- Roku's guide handles empty lists, earlier programmes and a selectable Watch button.
- Roku's version picker keeps video playing; unsupported audio and release formats are skipped.
- Roku panels share brighter rims and softened backdrop art where available.

Other clients should match the deferred release-note behaviour and bounded text
pages. Shared avatar content can optionally supply separate set covers; no
shared schema/data edit was made by this builder.

Automatic approval review rejected cleanup of the temporary Roku test/cache
folders with "blocked by policy". `.npm-cache/`, `.qr-test-ZRB8lc/` and
`.roku143-tests.log` may remain under `apps/roku/scripts/`; exclude these
temporary outputs when staging. They are not included in the channel zip.
