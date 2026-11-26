# Handoff: TVM 1.4.0 (test build)

Written 2026-11-26 around 05:00 UK by Claude on the owner's desktop, for whoever picks this up next (the
owner's laptop session). **Read this before changing anything.** Delete this file once everything below is
done, and remove the pointer to it at the top of `CLAUDE.md`.

## What happened

The owner asked for a big polish pass. The full list and the design are in `docs/1.4/spec.md`, which is
the contract every builder worked from. Codex and Gemini each ran out of usage within about 15 minutes of
starting six parallel builders. Claude Sonnet helpers then made every area build and pass its tests.
The owner asked for a push before morning **even if unfinished**, so 1.4.0 went out as a test build. Its
patch notes (a pop-up this time) list the known issues, and so does the section below.

Each area's own report, from the builder that last touched it, is in `docs/1.4/report-*.md`.

## State when pushed

Every check passed locally before the push:
- typecheck
- Core tests (688)
- UI tests (518) and build
- Roku: BrighterScript, tests (446), package, check
- Android and iOS project checks
- Android unit tests and assembleDebug
- content and changelog
- the Windows build with ctest

Nothing was tried on a real device.

| Area | Done | Not done / unverified |
|---|---|---|
| Windows (`native/`) | Geist font. Centred solid nav with a magnifier search button. Hero without the glass box. One lit card in looping rails, no hover clipping. Rounded-rectangle buttons. Click to pause, double-click for fullscreen. Controls on mouse move in fullscreen. Client caps and original-language audio. RD status refresh. TV guide (Guide button on Live TV). Patch-notes pop-up. | Settings redesign (spec section 8) and its controls. Profile editor controls. The full Liquid Glass rework (section 3.1; only partly done). Hero particles/glow not confirmed on screen. Trailer clip via Media Foundation unverified. Guide not tried with real IPTV. The pop-up body clips instead of scrolling. |
| Core (`apps/core`) | RD key cache fix. `/api/config` with flags. `/api/announcement`. Ranking (original language, highest native resolution, no upscales or cams). `/api/playback/versions`. Extras prefs. | `/api/live/guide` has no dedicated test. Hero clip and theme songs need real yt-dlp/ffmpeg runs. Free-channel EPG ids not reviewed one by one. The bitrate cause: check `docs/1.4/report-core.md`. |
| Web/phone UI (`apps/ui`) | Nav with magnifier, no double selection, no hover clipping, Geist, click to pause, double-click fullscreen, patch-notes pop-up. | Only the sign-in screen was seen in a browser. Guide, Settings redesign, Stats overlay, version picker and extras switches not audited or not done. Controls in fullscreen not verified. |
| Roku (`apps/roku`) | Fixed all BrighterScript errors. Patch-notes dialog. | Not run on a TV. The redesign items in `docs/1.4/report-roku.md` need a remote-navigation pass. |
| Android | Builds and passes tests. `/api/config`, announcement, RD fix, prefs, verify/forgot, versions. | `/api/live/guide`. The webhook is not called. Default version auto-pick still uses the old ordering. |
| iPhone | Project check passes; a static review fixed likely compile errors. | **Never compiled**; CI is the first real build. Versions not wired to playback. No guide endpoint. |

## Accounts service (private repo GL-327/TVM-accounts, already deployed)

- **Dashboard:** `/admin` has the TVM look, with Accounts, Activity, Announcements and Settings.
- **Real-Debrid keys:** keys can be tested and saved. Real-Debrid refuses requests from Cloudflare, so a save still works when the check can't reach it.
- **Universal Real-Debrid key:** Settings → Real-Debrid. Hand-approved accounts without their own key use it. Open sign-ups never get it.
- **Email:** verification and password-reset links are live (Brevo), sent from the TVM Gmail address.
- **Settings:** patch-notes pop-up switch (on), open sign-ups (off), minimum version, flags.
- **Declined by Claude:** giving the owner's Real-Debrid key to every open sign-up with an ad-gated daily quota. It risks the owner's Real-Debrid account and is legally risky. Open sign-ups means bring your own key.

## Next, in order

1. Test 1.4.0 on Windows, a phone and Roku. Fix anything that blocks watching first.
2. Settings redesign everywhere (spec section 8), with a switch for every extra (section 7), and the profile editor controls (section 3.4).
3. Live TV guide on web/phones (UI), phone engines and Roku (section 6).
4. The Liquid Glass rework to the iOS 27 standard (section 3.1) on Windows and web.
5. Hero trailer clip and theme songs end to end (section 4 and section 7).
6. iPhone: fix whatever the first CI compile reports, then wire versions and original language.
7. When this is done: update the 1.4.x notes, delete this file and the CLAUDE.md pointer.

## Lessons for whoever runs builders

Six heavy parallel agents burn a 5-hour allowance in about 15 minutes on these plans (Codex and Gemini
both did). Run two or three at a time, and check usage often.
