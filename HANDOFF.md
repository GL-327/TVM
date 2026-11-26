# Handoff: TVM 1.4.3 (test build)

Written 2026-11-26 by Claude on the owner's laptop, continuing the 1.4 polish that the desktop session could not
finish. **Read this before changing anything.** Delete this file once everything below is done, and remove the
pointer to it at the top of `CLAUDE.md`.

The contract is still `docs/1.4/spec.md`. Each builder's report is in `docs/1.4/report-*.md`; the 1.4.3 ones end
in `-143.md`. 1.4.3 was built by Claude (lead, web audit, Core, integration), OpenAI Codex (phone engines, Roku,
web extras), Gemini in Antigravity (Liquid Glass) and a Claude Sonnet helper (Windows Settings).

## State

Checks run locally before committing:
- Core typecheck and tests (695+)
- web UI typecheck, tests (546+) and build
- Playwright `mobile.spec.ts` and `responsive.spec.ts`
- Roku BrighterScript (0 errors), tests (451, including a BrightScript runtime test), package and check
- Android and iOS project checks
- content and changelog checks
- Windows build and `tvm_tests.exe` (600)

Android/Kotlin and iOS/Swift cannot be compiled on the laptop (no Android SDK, no Swift); **CI is their first
compile**. Nothing was tried on a real phone, Roku or TV.

| Area | Done in 1.4.3 | Still open |
|---|---|---|
| Windows | Settings: Playback, Audio & subtitles, Home screen, Extras (22 switches), search, icons, Back to list. Guide re-polls while Core says `refreshing`. Patch-notes pop-up scrolls with platform tags. Profile editor avatar-set tiles. | Liquid Glass rework to the web recipe (Gemini job `report-glass-native-143.md`; check whether it landed). Home row order. Webhook URL, volume boost, accent and poster titles rows. |
| Web / desktop / phone UI | Audited in a browser. Fixed hero overlapping the nav at 720p, Settings search icon / scroll / top fade, guide auto-refresh and logo fallback, Details legibility, duplicate commit-list modal. Codex: Stats (I), version picker, quality badges, sleep timer, night mode, pause when hidden, shortcuts (?), spoiler blur, trailer backdrops (now Core's clean clip first, YouTube fallback cropped), theme songs. Gemini: Liquid Glass per spec 3.1 (lens, rim, adaptive tint, droplet; nav highlight bug fixed). | Phones: Stats / sleep timer / night mode do not draw over the native video surfaces. Spoiler blur on phones needs `watched` on episodes from the phone engines. |
| Core | Guide `refreshing` flag + first guide tests. Episodes carry `watched`. Hero clip verified end to end (H.264 1080p, ~38 s, muted, Range). | Theme songs: lookup works, YouTube refused the audio download during testing. |
| Roku | Settings/guide/profile/patch-notes remote paths, AvatarPicker, 4-box PIN, glass rims + soft art behind panels, ranking fixes, guide re-poll, manifest 1.4.3. `IndexOf` calls replaced (not on every Roku OS). | Not run on a TV. |
| Android | Live guide (XmlPullParser), webhook events, default auto-pick uses the 1.4 ranking, client caps, version/originalLanguage in responses. | Compile in CI. Device test. |
| iPhone | Live guide (XMLParser), versions wired, webhook. Lead fix: ranking keeps MKV/TrueHD/DTS because the iPhone plays through VLC. | Compile in CI. Device test. |

## Owner item 6 (bitrate)

Windows (mpv), Android and Roku play Real-Debrid's original `unrestrict` download link; the web path only
transcodes when the browser cannot decode the codec, at quality-based CRF 20. The low bitrate came from the old
ranking letting small encodes win. The 1.4 ranking (original language, highest native resolution, REMUX > BluRay >
WEB-DL, higher bitrate, no upscales/cams) fixes it on every platform. Verify with Stats (I) on a real title.

## Next, in order

1. Watch CI for the Android and iPhone compile; fix what it reports.
2. Test 1.4.3 on Windows, a phone and Roku; fix anything that blocks watching first.
3. Windows Liquid Glass: integrate or finish Gemini's native job.
4. Phones: draw Stats / sleep timer / night mode in the native players; send `watched` on episodes.
5. When done: update the notes, delete this file and the CLAUDE.md pointer.

## Lessons for whoever runs builders

- Give each builder its own folders; five ran at once without conflicts this way.
- Antigravity needs "Always allow" (or turbo) before a headless Gemini run, or it waits forever on the first read.
- Codex's sandbox cannot fetch npm packages or delete temp folders; rerun its network-dependent tests yourself.
