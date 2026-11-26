# Native Settings redesign

Build: native/build.ps1 succeeded, ctest 100% (579 tests, 0 failed).

## Done
- Two-pane Settings: left category list (Account, Profiles, Playback, Audio & subtitles, Appearance, Live TV, Real-Debrid, Downloads, Updates, About, Developer for admins). Right: h1, one-line description, grouped cards (surface, radius 16, hairline dividers), label + caption left, control right.
- All existing rows mapped to categories; no new backends. Two new Push rows reuse existing screens: "Audio and subtitle languages" (opens extras-settings) and "Downloads" (opens downloads).
- native/src/ui/controls.cpp/.h: iOS-style switch, segmented control (2-5), value-with-chevron. Switches: performance, reduce transparency, reduce motion, auto-update, choose profile. Segmented: Theme (Dark/Light), Font (Geist/Inter/System). Chevron: App language (opens existing dropdown), push rows.
- Input: Up/Down in category list switches category; Right/OK enters the content; Left returns to the list (or steps a segmented control first). Click a category, a segment, a switch row. FocusItem on a row in another category switches to it. Scroll only in the right pane.
- Profile editor: Kids profile is a switch row; age limit is a segmented control (same keys, so activation unchanged).
- Tests updated for the new row order and added two-pane and segmented/switch tests.

## Left
- Home screen category has no existing rows, so it is omitted (Extras and Your stats pages kept as pushes).
- Settings search field, category icons, knob/indicator animation (state jumps, no spring).
- Back from content goes straight out of Settings (does not first return to the category list).
- Phone-width layout is a narrow category strip beside the content, not the push-in iOS pattern; long labels truncate.
- Profile editor not rendered (no snapshot path for it); only checked by compile and tests.
- Language dropdown still shows 8 of 9 entries until scrolled (existing behaviour).

## Files
native/src/ui/controls.cpp, native/src/ui/controls.h (new); native/CMakeLists.txt; native/src/ui/settings_screen.cpp, settings_screen.h; native/src/ui/profile_editor.cpp; native/tests/shell_tests.cpp.
Snapshots: scratchpad/shots/native-settings/ (settings.png, settings-language.png, settings-light-phone.png).
Changelog not touched (lead's call).
