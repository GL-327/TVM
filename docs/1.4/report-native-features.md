# native-features report (worktree C:/Users/Gathe/Desktop/TVM-wt/native-features)

## Build / test
`native/build.ps1`: build succeeds, ctest 100% (1/1). Fixes: local `WithAlpha` helper in live_playlist_screen.cpp and
xtream_screen.cpp; duplicate `case WM_MOVE` in app.cpp merged (was C2196).

## Owner items (checked in code; no interactive run of mpv playback)
- Single click toggles pause, double click toggles fullscreen: DONE (VideoClicks + VideoClickAction, app_extras.cpp / app.cpp WM_LBUTTONUP).
- Overlay controls show in fullscreen on mouse move: DONE in code (WM_MOUSEMOVE calls ShowChrome; overlay window resets z-order). Not tested live.
- Playback request sends client caps; audio prefers original language: DONE (app_account.cpp sends client {player,maxHeight,hevc,hdr,mkv}; audioLanguage "original" resolves to Core's originalLanguage).
- Real-Debrid status/account refresh on focus, on Home, every 60 s while not connected: DONE (WM_ACTIVATE, home-shown edge, extras::RdRefreshDue).
- TV-style Live TV guide: DONE in code (guide_view.cpp, app_guide.cpp, "Guide" top button, auto-opens on Live TV lane). No guide snapshot taken.
- Patch notes pop-up (spec 14): DONE. Shell::SetPatchNotes modal (dimmed backdrop, "TVM x.y.z" chip, title, highlights, changes, amber "Known issues" from optional knownIssues, "Got it"). App asks Core /api/config once for flags.patchNotesPopup; true shows the modal (first time a newer version opens, remembered via last-seen-version), false/missing/error keeps the corner card. Enter/Space/Esc/Back/Got it close; all other input is swallowed while open.

## Known bugs / gaps
- Modal body is clipped, not scrollable (long notes cut off). Text button label centring is approximate.
- If Core is unreachable at start, the flag defaults to off (corner card).
- Bullet "- " used for changes; no platform tags shown in the modal.
- Snapshot: `TVM_SNAPSHOT_PATCH_POPUP=1 tvm.exe --snapshot x.png --screen home-1.1` shows the modal (shots/native-features/patch-popup.png, looked fine).
- Did not add changelog.json lines (outside native/ scope).

## Files changed by me
native/src/ui/live_playlist_screen.cpp, native/src/ui/xtream_screen.cpp, native/src/platform/app.cpp, native/src/platform/app.h,
native/src/platform/app_content.cpp, native/src/ui/shell.h, native/src/ui/shell.cpp, native/src/main.cpp
(the rest of the diff is Codex/Gemini work)
