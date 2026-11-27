Job: CORE3, playback quality, language, availability and extras for TVM 1.4.8. Repo: C:\Users\Gathe\Desktop\TVM. You own ONLY apps/core/** and packages/extras/**. Another engineer is editing apps/ui right now.

The owner just tested 1.4.7 in Chrome (the web player is HTML5) and reports:
1. "The video quality has once again dropped to looking poor, and it isn't always max quality + English (weirdly, rarely English)."
   - Trace the ranking end to end for the html5 client and for mpv: apps/core/src/providers (versions.ts, media.ts, torrentio.ts, the ranking code), the client caps, and the originalLanguage detection.
   - Test with real titles through Torrentio with no Real-Debrid key: GET https://torrentio.strem.fun/stream/movie/<tt>.json lists the release names.
     - Interstellar tt0816692
     - The Hunger Games tt1392170
     - Dune: Part Two tt15239678
     - Breaking Bad S01E01 tt0903747:1:1
   - Find out why non-English and low-quality releases win. Likely causes:
     - the original language is unknown, so dubs are not penalised
     - "MULTI"/language-flag parsing
     - html5 caps dropping every MKV/HEVC/4K release
     - the ffmpeg transcode path lowering the quality
   - Fix it:
     - English or original-language audio first; dub-only releases (iTA, FRENCH, LATINO, Hindi, RUS, flags without 🇬🇧/🇺🇸) only as a last resort
     - the highest real resolution the client can play
     - if a browser cannot play the original file, the transcode must keep the source resolution with a high quality setting, not drop it
   - Add tests with those real release names.
2. "Some movies don't show that you can watch them, like the new Hunger Games movie (tt32558705), even though it's 100% released."
   - Find why it is shown as unavailable: release-date gating, or the "no cams" rule leaving zero versions.
   - Rule:
     - If only cinema recordings (CAM/TS/TC/HDCAM) exist, still offer them as a last-resort version labelled "Cinema recording, low quality".
     - Never pick a cam when any real release exists.
     - Titles past their release date must never show as unavailable just because of metadata.
3. "All the cool features we added, like the Jellyfin plugins, are all gone or at least don't seem to work."
   - Verify every /api/extras/* endpoint and the extras prefs against real titles, and fix each broken one:
     - skip segments (TheIntroDB/AniSkip)
     - OpenSubtitles subtitles in playback results
     - trailers
     - collections
     - coming up
     - stats
     - anime titles
     - ratings
     - quality badges
     - versions
     - surprise
     - hero clip
     - theme songs
   - Run the repo's Core with a temp TVM_DATA_DIR and TVM_CORE_PORT=7347.
   - Write a table to the report: each feature, its endpoint, the real result, and any fix. The UI engineer relies on it.

Verify:
- `corepack pnpm -r run typecheck`
- `npx vitest run` in apps/core

Report to <scratch>/reports/core3.md.
