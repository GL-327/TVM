# Handoff: TVM 1.4.18

Rewritten 2026-11-27 by the lead session (Claude, owner's PC). Delete this file, and the pointer at the top of
`CLAUDE.md`, when everything below is done. Older detail lives in git history and `docs/1.4/report-*.md`.

## State

- **1.4.13** (iPhone MKV streams, iPhone stays signed in) passed every CI workflow. The installed Windows app
  updated itself from 1.4.12 to 1.4.13 about two minutes after launch, and Core reported 1.4.13.
- **1.4.14** adds account sync to iPhone, Android and Roku (Gemini; report `docs/1.4/report-phone-sync.md`). The
  engines match Core's ids, hashes, last-writer-wins, first-sync merge and sign-out rules, checked against a fixture
  generated from Core's own code. Android and iOS compile for the first time in CI.
- The TVM trailer is no longer bundled. It streams from the `media` GitHub pre-release
  (`releases/download/media/tvm-trailer.mp4`) on React and Windows. GitHub serves it as `application/octet-stream`;
  Chromium plays it (checked), iPhone is untested. To change the trailer, replace that asset: no app release needed.

## Since 1.4.14 (same day)

- **1.4.15** original-language audio track (English when unknown) on Windows, phones and Roku; dubs only when
  chosen in Settings. **1.4.16** invite code on sign-up + maintenance banner everywhere (pairs with the dev panel,
  accounts repo `8f40bf6`, migration 0006, **not deployed yet**). **1.4.17** Stats / sleep timer / night mode over
  the native video on phones, watched episodes on phones. **1.4.18** Roku start page + franchise intros
  (`docs/1.4/report-roku-hub.md`).
- Phone sync is green in CI (iOS and Android tests). The Android job caches Gradle and Robolectric jars.

## Open, in order

1. **Real-device tests (owner):** iPhone streams, staying signed in, sync between a phone, Roku and the PC, the
   streamed trailer on iPhone (if it fails: proxy it through the iOS engine with `video/mp4` and Range), phone
   Stats / sleep / night mode, the Roku start page and intros.
2. **Update now** on Windows: the owner presses it on the installed 1.4.13 (auto-update itself works).
3. **Deploy the accounts service** after the owner runs `npx wrangler login` in `Desktop\TVM-accounts`:
   `npx wrangler d1 migrations apply tvm-accounts --remote`, `npx wrangler deploy`, then check `/admin`,
   `/v1/config` and an existing member sign-in.
4. **Trailer v3:** preview sent to the owner (VRoid sample model, af_heart / af_bella). Full trailer only after a
   yes; fix the flat crown block and the light temple edge; then upload to the `media` release. Work dir:
   `C:\Users\Arthur\TVM-work\trailer3\`.
5. **Windows look:** keep improving it first (clear Liquid Glass only, `docs/LIQUID_GLASS.md`); show the owner a
   preview before big changes, then port to React. Roku's remaining screens get the new look after that.

## Owner decisions pending

- 12 commits on main (52563c6..759ee35) are authored by "Claude" with co-author lines. Fixing them needs a history
  rewrite and force-push, coordinated with GL-328. Do nothing until the owner says so.

## Lessons for whoever runs builders

- Give each builder its own folders, and no two builders on the same platform files at once.
- Builders don't commit, bump versions or write the changelog: the lead does the release.
- Antigravity needs "Always allow" (or Turbo). If the network drops, its agents stop: `agentapi send-message <id>`
  "continue" resumes them.
- Android and iOS do not compile on the owner's PC (no JDK 21 / Android SDK, no Swift): CI is the first compile.
