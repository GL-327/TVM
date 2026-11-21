# Redesign status — 18 Nov 2026

The redesign through the Roku slice is on GitHub `main` (`5a52b4a`, merged as `c9715b9`). Rows marked *(local)* are newer work on local `main` and are not committed yet.

## Delivered
| Area | What | Evidence |
|---|---|---|
| Audit | `AUDIT.md`, `DECISIONS.md` and `HUB-V1-CONTRACT.md`. Old PRs #1, #2 and #3 and `codex/native-parity-cleanup` have nothing left to carry over. | — |
| Core: Hub v1 | `apps/core/src/hub/*`: registry, delta presence, commands (idempotency, expiry, acks), RFC 8628 pairing, activity, a fail-closed sealed store | Core suite 61 files, **641/641**. HTTP smoke **19/19** against a Core started with plain `node` |
| Core: pricing | `priceBook.ts` (1000/9000 + 700/6000 pence), signed quotes, flags (`liveTv.orderable` and `selfServeBilling` off), Live TV entitlement gate kept separate from health, sign-in throttle, migration dry-run CLI | `apps/core/PRICING.md`, tests in the suite above |
| Core: fixes | `erasableSyntaxOnly` added: Core runs under Node type stripping and broke on a parameter property. `/api/home` gained `trending`. | typecheck clean |
| Roku | NavStrip + You menu. Home hero rotates trending art. Details with id-based focus restore. TVM Hub Network/Devices/Activity, inspector, remote, pairing, sign-in with a code. Roku acts as a command target. Glass material system (`scripts/make-glass.mjs`). Ambient blurred backdrops. Settings → Background: Trending or Lighthouse (public-domain NOAA photo, see `images/ASSETS.md`). Reduce Motion and Reduce Transparency. | `check.mjs` passes, **338/338** node tests, brighterscript 0.73.5 reports 0 errors, zip 3.95 MB of the 4 MB budget |
| Windows installer *(local)* | `native/installer/`: `build-setup.ps1` builds `native/dist/TVM.exe` (26.8 MB; was 40.4 MB before Codex added LZMS compression, stripping and pruning, so the install folder is 252 files with no maps or launcher scripts), a per-user installer and launcher with no administrator prompt. First run installs to `%LOCALAPPDATA%\Programs\TVM` and adds Start menu and Desktop shortcuts and an Apps & features entry, then opens TVM. Later runs open TVM, or update it when the file carries a newer build. `tvm.exe` now has the TVM icon. | Tested on this PC: install in 3 s (332 files), a repeat run opens TVM without reinstalling, reinstall stops Core and swaps folders cleanly, uninstall keeps `%LOCALAPPDATA%\TVM`. Native ctest passes (MinGW). |
| Windows glass redesign *(local)* | Done by Gemini 4 Argon: a Direct2D glass material (cached Gaussian-blurred backdrop, gloss, directional rim, shadow, focus glow), and Home to study 03 (hero, nav capsule, profile orb, glass pills, landscape Continue Watching, hard-stop rails). The material also covers Settings, Details and player chrome. Inter is bundled under the OFL. Spec in `WINDOWS-VISUAL-SPEC.md`, report in `gemini/windows-visual-report.md`. | 493/493 native tests (re-run by the architect). Captures are in `build/native-shots/`. Installed on this PC and confirmed with a snapshot. |
| Roku Control Centre *(local)* | Player Control Centre (study 02) with Playback, Audio & Subtitles and Devices tabs, "Continue on" handoff via `play.title`, demo mode, Back and 10 s auto-close, and the player chrome moved to glass | 430/430 Roku tests, lint clean, zip 3.96 MB. The `cc-*.png` captures exist. Real Video tracks and real-Core handoff need a device. |
| Runtime preview | `build/brs-preview/` (gitignored): brs-engine 2.7.0 runs the real channel. `tour.mjs` scripts the remote and saves captures to `screenshots/`. | `tour-*.png`, `final-home-hero.png` |

## Run the preview
1. Start a throwaway Core on :7359 with `TVM_DATA_DIR=build/brs-preview/data`. See `build/brs-preview/README.md`. Seed a session into `registry.json`.
2. `node build/brs-preview/serve.mjs`, then open http://127.0.0.1:8099/
3. `node build/brs-preview/tour.mjs` for scripted captures.

## Next, in order
1. **Windows: the remaining studies.** The Hub network and devices (01 and 04) need a C++ Hub client; also the Control Centre (02) and the Live TV guide (05). On Roku, give "Start over" a restart glyph instead of a chevron.
2. **Live TV guide:** a time-scaled EPG grid with a fixed channel column and preview. It needs a bounded XMLTV ingest in Core; without EPG it shows "No schedule available" (mockup 05).
3. Clients adopt the price book and quotes: `apps/ui`, `native`, Android, iOS and Roku still hard-code the old prices (see `AUDIT.md` §6).
4. Account-scoped entitlement. Today plan and profile state is machine-wide, and Hub control needs it scoped per account.
5. Port the material and the Hub to web, Windows (C++) and mobile.
6. **Physical Roku verification:** no device has been tested yet. Confirm 9-patch rendering, texture memory (`r2d2_bitmaps`) and focus latency on a low-end and a modern model.

## Known gaps
- The emulator ignores `cornerRadius` and Video. Shapes now use 9-patch PNGs, so both the emulator and old firmware stay rounded.
- Roku has no real blur or refraction, only pre-rendered layers. The ambient blur is a 96×54 decode stretched to full screen.
- For up to 10 minutes after approval, an approved pairing keeps the TV's new sign-in token inside the encrypted Hub store.
