# Native Settings 1.4.3 (Windows)

Build clean (MSYS2). `ctest` 100%: `tvm_tests.exe` runs 600 tests, 0 failed (was 579). Not run against a live Core:
the `/api/prefs` read/write, sleep-timer start and guide re-poll are covered by code and unit tests only.

## Done
1. **Settings rows** (`native/src/ui/settings_screen.{h,cpp}`). Categories follow the web order: Account, Profiles,
   Playback, Audio & subtitles, Appearance, Home screen, Extras, Live TV, Real-Debrid, Downloads, Updates, Your stats,
   About, Developer (admins).
   - Playback: Quality select (`quality`), Skip upscaled switch (`skipUpscaled`), Audio language select
     (`audioLanguage`), Autoplay next switch (`autoplayNext`), Skip intro & credits segmented (`skipSegments`
     off/button/auto), Sleep timer default select (this PC, ui-prefs.json; it now starts the player's timer).
   - Audio & subtitles: Subtitle mode segmented, preferred languages push row (shows the list), size/colour/background
     segmented (`subtitleStyle.*`) with a preview row, Night mode switch (`extras.nightMode`).
   - Home screen: Hero previews (`heroPreviews`), Spotlight events (this PC; off hides the event hero and its rail).
   - Extras: all 22 spec 7 switches with the web wording and platform notes, including `seekPreviews`.
   - Back from the content pane returns to the category list once the rows have been used, then leaves Settings.
   - Data flow: `App::LoadSettingsPrefs` reads `GET /api/prefs` when Settings opens and hands it over through
     `Shell::SetCoreSettings`; each change goes through a `PrefsSink` as a partial body and `App::SavePrefsPatch`
     PUTs it. Only the newest answer is applied, so quick toggles don't flick back.
2. **Search and icons**: "Search settings" at the top of the left pane (click, or Up from the first category) filters
   rows across categories, grouped by category, with a no-match message. Back clears, then leaves the field.
   Category icons are stroked vector paths.
3. **Guide refresh**: the guide asks again every 4 s while Core says `refreshing` (max 30), keeping the focused
   channel and time.
4. **Patch notes pop-up**: the body scrolls (wheel, Up/Down, PageUp/PageDown, Home/End) with edge fades and a slim
   scroll bar; changes are grouped by area with platform tag pills; known issues in amber.
5. **Profile editor**: avatar sets as a horizontal row of tiles (cover = the set's first character; the content has
   no separate cover art) with arrow buttons; characters as 96 px circles with names; chosen ones ringed in accent.

## Tests
New `native/tests/settings_143_tests.cpp` (21 tests): pref JSON shapes, every new row by arrow/click/select list,
search typing/erasing/Back levels, keyboard reachability per category, guide re-poll decision and kept focus,
patch-notes scroll clamping, profile editor sets row. `shell_tests.cpp` updated for the new rows and Back.

## Snapshots
`scratchpad/shots/native-settings-143/` (1080 and 720): settings playback, audio, extras, home, search, select,
no-match; profile editor; patch notes top/end. New snapshot screens in `main.cpp`: `settings-<category>`,
`settings-select`, `settings-search`, `settings-nomatch`; env switches `TVM_SNAPSHOT_PATCH_LONG`,
`TVM_SNAPSHOT_PATCH_SCROLL`.

## Not done
- Home row order list (`homeSections`): native Home has no stable row ids to reorder; the category has two switches.
- Webhook URL field, Volume boost max, Accent colour and Poster titles are not in Windows Settings.
- Phone-width Settings and profile editor not looked at.
- Patch-notes line counts are estimated from character counts.
