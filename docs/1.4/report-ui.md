# UI report (apps/ui)

## Results
- vitest: 518/518 pass (7 stale tests updated; 2 new patch-notes tests).
- `pnpm --filter ./apps/ui run typecheck`: pass. `run build`: pass (only the usual chunk-size warnings).

## Test changes (design intended by spec, code was fine)
- chrome.test: Ribbon label now the ['more-profile','Account','profile'] menu entry.
- Home.test: hero-play lives in Spotlight.tsx; HomeClock/shelfTitle/openDetails assertions dropped; rail props updated.
- Settings.test: rows are now data-driven in the two-pane layout (Motion/Performance inside Appearance; Developer gated by `admin`).

## Patch notes pop-up (spec 14): DONE
- New components/PatchNotesPopup.tsx used by Home instead of ChangelogCornerCard. Flag `flags.patchNotesPopup` from /api/config (404/failure = false, corner card kept).
- Modal: version chip, h1 title, bold highlights, changes by area with platform tags, "Known issues" warning block (new optional `knownIssues` on ChangelogRelease), single "Got it" button focused on open, Esc/Backspace/Back close, seen version remembered. CSS in theme/liquidGlass.css.
- Tests: components/PatchNotesPopup.test.ts. Not verified visually.

## Owner items
- Centred solid nav capsule + magnifier search icon: DONE (polish.css, Ribbon.tsx; solid 94% surface, 100% with Reduce transparency).
- No double selection in looping rails: DONE in CSS (hover suppresses focused-card styling; polish.css). Not seen live.
- Hovered cards not clipped: DONE in CSS (rail overflow visible, track padding/negative margins). Not seen live.
- Geist font: DONE (woff2 + OFL in public/fonts, @font-face, default family, Settings font select). Seen rendering on the sign-in screenshot.
- Click on video to pause: DONE already (MouseLayer click toggles on desktop; coarse pointers toggle chrome).
- Double-click for fullscreen: DONE (added dblclick handler in MouseLayer).
- Player controls visible in fullscreen: PARTLY. Fullscreen targets the player host element (which contains the chrome), so controls should stay; not verified in a browser.
- Larger items (guide, stats overlay etc.) exist in uncommitted files from earlier engineers; I did not audit them beyond tests/build.

## Known bugs / not done
- No screenshots of Home/Settings/Guide/player/profile editor: Microsoft Edge is not installed on this machine (used Chrome via playwright-core in scratchpad/work/ui). My mocked /api/account still landed on the sign-in gate (only that screen seen); did not dig further.
- Nothing committed; no git state changed.
