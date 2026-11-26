# Roku report (finished 04:38 UTC)

## Checks (all pass)
- brighterscript 0.73.5: 0 errors (was 11)
- node --test apps/roku/scripts/: 446 pass, 0 fail
- package.mjs: wrote tvm-roku.zip (267 files)
- check.mjs: passed (hardware install/playback still untested)

## Fixes
- Renamed reserved `pos` to `position` (PosterCard.brs, TVMScene.brs, localCore.brs).
- Added `tvmTypeMeta()` (42) in source/tokens.brs; used by PlayerExtras.brs.
- ApiTask.xml now includes source/media.brs (asText for playbackCore.brs).
- playbackCore.brs: split `: if` lines (BS1054).
- extras.test.mjs: stale assertion updated (subtitleTrack is set in PlayerScreen applySubtitle).

## Patch notes pop-up (spec 14)
- TVMReleaseFeatures.brs: maybeShowPatchNotes(flags), called from onRokuPublicConfigDone in TVMScene.brs.
- When flags.patchNotesPopup === true, on first launch of a newer version (releasePending), the newest release shows as a tall NoticePanel modal: title, highlights, changes (max 8), optional knownIssues, "Got it" button (focused). OK closes; Back pops the modal.
- Marks lastSeenVersion, so it shows once, and hides the small release card. Flag false or missing: old card behaviour.
- NoticePanel gained fields buttonLabel and tall.

## DONE / PARTLY / NOT DONE
- DONE: priority 1, priority 2.
- NOT DONE: priority 3 (remote-navigation review of earlier-changed screens, remaining brief items such as TimeGrid guide, Geist fonts, ranking port, were not re-audited; only static checks cover them).

## Known bugs / caveats
- Patch notes pop-up is untested on a device; very long changes lists may overflow (16 lines cap, 8 changes).
- Pop-up only appears if config arrives while Home is visible; if the user is elsewhere at that moment, the small card shows instead.
- Fetching /api/config relies on existing config flow (engine, then local fallback); the workers.dev config URL was not touched.
