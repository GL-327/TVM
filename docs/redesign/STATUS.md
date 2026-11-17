# Redesign status — 17 Nov 2026

Everything below sits uncommitted on local `main`, on top of `0b2e454`.

## Delivered
| Area | What | Evidence |
|---|---|---|
| Audit | `AUDIT.md`, `DECISIONS.md` and `HUB-V1-CONTRACT.md`. Old PRs #1, #2 and #3 and `codex/native-parity-cleanup` have nothing left to carry over. | — |
| Core: Hub v1 | `apps/core/src/hub/*`: registry, delta presence, commands (idempotency, expiry, acks), RFC 8628 pairing, activity, a fail-closed sealed store | Core suite 61 files, **641/641**. HTTP smoke **19/19** against a Core started with plain `node` |
| Core: pricing | `priceBook.ts` (1000/9000 + 700/6000 pence), signed quotes, flags (`liveTv.orderable` and `selfServeBilling` off), Live TV entitlement gate kept separate from health, sign-in throttle, migration dry-run CLI | `apps/core/PRICING.md`, tests in the suite above |
| Core: fixes | `erasableSyntaxOnly` added: Core runs under Node type stripping and broke on a parameter property. `/api/home` gained `trending`. | typecheck clean |
| Roku | NavStrip + You menu. Home hero rotates trending art. Details with id-based focus restore. TVM Hub Network/Devices/Activity, inspector, remote, pairing, sign-in with a code. Roku acts as a command target. Glass material system (`scripts/make-glass.mjs`). Ambient blurred backdrops. Settings → Background: Trending or Lighthouse (public-domain NOAA photo, see `images/ASSETS.md`). Reduce Motion and Reduce Transparency. | `check.mjs` passes, **338/338** node tests, brighterscript 0.73.5 reports 0 errors, zip 3.95 MB of the 4 MB budget |
| Runtime preview | `build/brs-preview/` (gitignored): brs-engine 2.7.0 runs the real channel. `tour.mjs` scripts the remote and saves captures to `screenshots/`. | `tour-*.png`, `final-home-hero.png` |

## Run the preview
1. Start a throwaway Core on :7359 with `TVM_DATA_DIR=build/brs-preview/data`. See `build/brs-preview/README.md`. Seed a session into `registry.json`.
2. `node build/brs-preview/serve.mjs`, then open http://127.0.0.1:8099/
3. `node build/brs-preview/tour.mjs` for scripted captures.

## Next, in order
1. **Player Control Centre:** spatial tabs Playback · Audio & Subtitles · Devices over the video, with handoff (mockup 02).
2. **Live TV guide:** a time-scaled EPG grid with a fixed channel column and preview. It needs a bounded XMLTV ingest in Core; without EPG it shows "No schedule available" (mockup 05).
3. Clients adopt the price book and quotes: `apps/ui`, `native`, Android, iOS and Roku still hard-code the old prices (see `AUDIT.md` §6).
4. Account-scoped entitlement. Today plan and profile state is machine-wide, and Hub control needs it scoped per account.
5. Port the material and the Hub to web, Windows (C++) and mobile.
6. **Physical Roku verification:** no device has been tested yet. Confirm 9-patch rendering, texture memory (`r2d2_bitmaps`) and focus latency on a low-end and a modern model.

## Known gaps
- The emulator ignores `cornerRadius` and Video. Shapes now use 9-patch PNGs, so both the emulator and old firmware stay rounded.
- Roku has no real blur or refraction, only pre-rendered layers. The ambient blur is a 96×54 decode stretched to full screen.
- For up to 10 minutes after approval, an approved pairing keeps the TV's new sign-in token inside the encrypted Hub store.
