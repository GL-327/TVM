# Handoff: TVM 1.4.14

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

## Open, in order

1. **Real-device tests (owner):** iPhone streams play and it stays signed in after closing; sync on a phone and
   Roku against the PC; the streamed trailer on iPhone (if it fails: proxy it through the iOS engine's local server
   with `video/mp4` and Range).
2. **Update now** on Windows: test it on a build that has a pending update (auto-update itself works).
3. **Dev panel** (Gemini next): `docs/agents/briefs/job-devpanel.md`. Accounts service changes are tested locally,
   then deployed by the lead after `npx wrangler login` on this PC. App side: invite code field + maintenance banner.
4. **Phone player overlays:** Stats, sleep timer and night mode over the native video, and `watched` on episodes.
5. **Roku:** Hub page, franchise intros and the new look (after sync and the dev panel, which also touch Roku).
6. **Trailer v3:** the preview (model stills, turntable, voice tests) goes to the owner first. Full trailer only
   after a yes; then upload it to the `media` release.
7. **Windows look:** keep improving it first (clear Liquid Glass only, see `docs/LIQUID_GLASS.md`), then port to React.

## Owner decisions pending

- 12 commits on main (52563c6..759ee35) are authored by "Claude" with co-author lines. Fixing them needs a history
  rewrite and force-push, coordinated with GL-328. Do nothing until the owner says so.

## Lessons for whoever runs builders

- Give each builder its own folders, and no two builders on the same platform files at once.
- Builders don't commit, bump versions or write the changelog: the lead does the release.
- Antigravity needs "Always allow" (or Turbo). If the network drops, its agents stop: `agentapi send-message <id>`
  "continue" resumes them.
- Android and iOS do not compile on the owner's PC (no JDK 21 / Android SDK, no Swift): CI is the first compile.
