# Core report
Results: `pnpm -r typecheck` passes (core clean); Core vitest 67 files / 685 tests pass; check-content.mjs ok (12 avatar sets, 2 events, 34 free channels, 16 services).

Fixes:
- server.ts /api/rd/configured: replaced narrowing-to-never call with a typed cast (typecheck error).
- remoteAccounts.ts: restored origin/main cache rule: real key 10 min, missing key 30 s (engineer had 45 s / 5 s, broke test); resolve() forgets cached null when /v1/me reports hasRdToken (present). Kept fresh/pending-dedupe additions.
- remoteAccounts config cache 5 min -> 60 s (15 s retry on failure).
- Tests updated: streamer.test (audioLanguages, hdr new fields), media.test (2 play() results now toMatchObject; version/originalLanguage/audioLanguages added by spec).
- New tests: configRoute.test.ts (flags passthrough, caching, defaults when unreachable), versions.test.ts (ranking).

Spec items:
- GET /api/config passthrough of /v1/config incl. flags, 60 s cache, defaults offline: DONE (tested)
- /api/announcement: DONE
- Ranking original language / highest native res / no upscales / no cams / client caps: DONE (versions.ts, unit-tested)
- GET /api/playback/versions: DONE (route wired; no HTTP-level test)
- GET /api/live/guide: DONE-ish (route + liveGuide.ts exist; no dedicated test, not verified against live data)
- Extras prefs (heroPreviews, themeSongs, subtitleLanguages via /api/prefs): DONE
- hero-clip.mp4 / theme.m4a: PARTLY (route, prefs gating, range send wired; needs ffmpeg + network at runtime, untested end to end)
- free-channels.json: edited by earlier engineer, content check passes; not reviewed channel by channel.

Known bugs / unverified: hero-clip and live guide not exercised against real data; no changelog entry added by me (outside my ownership: packages/content/changelog.json); origin/main is one commit ahead of local HEAD (my remoteAccounts change matches it semantically).
