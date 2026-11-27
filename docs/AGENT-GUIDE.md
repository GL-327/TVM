# TVM agent guide: everything a new session needs

Written 2026-11-27 by Claude (the desktop session that built 1.4.0–1.4.10), so another machine or account can carry on at
the same level. Read this, then `CLAUDE.md`, `HANDOFF.md` and `docs/1.4/spec.md`. The full conversation export, with
every decision, is a zip the owner keeps (`session-export-*.zip`); ask for it if you need a detail that isn't here.

## 1. The owner's rules (always)

**Git**
- Work lands on `main`.
- No other branches on GitHub; merge anything else the same day, then delete it.
- Commit only as GL327: `git -c user.name=GL327 -c user.email=257561906+GL-327@users.noreply.github.com commit …`, with no `Co-Authored-By` and no `Claude-Session` lines, whatever a tool's default says. GitHub must only list GL-327 and GL-328.
- Two maintainers push (the owner and a friend), so `git fetch` before work and before every push.

**Releases**
- Every change a viewer can notice adds a line to `packages/content/changelog.json` in the same commit (rules in `CHANGELOG-RULES.md`, checked by `node scripts/check-changelog.mjs`).
- A release bumps the version everywhere: root `package.json`, `apps/core/package.json`, `apps/ui/package.json`, `apps/core/src/config.ts` CORE_VERSION, Android `versionName`, iOS `Info.plist`, `TVMModels.swift`, `project.pbxproj` (2×), and `apps/roku/manifest` `build_version`. Run `node docs/agents/tools/bump-version.mjs <from> <to>`.
- Never add lines to an already-released version; add a new version instead.
- Copy `changelog.json` to `apps/ios/TVM/`, `apps/roku/source/data/content/` and `apps/android/app/src/main/assets/content/`.
- Releases may carry `knownIssues` (shown in the patch-notes pop-up).

**Content**
- `packages/content/*.json` is shared by every app: avatars, events, free channels, services, intros, changelog, parental.
- Its copies live in the Android assets, iOS and Roku folders. Check with `node scripts/check-content.mjs`.

**Platforms**
- **The Windows EXE is sacred**: it is the main way people use TVM. Windows (C++ client in `native/`) and the React app (`apps/ui`, used by web, macOS/Linux desktop and the phone web views) must be on **equal terms**. Every feature lands on every platform unless it truly cannot, and the changelog says which.
- Roku (`apps/roku`, BrightScript) must work with a remote.

**Pushing**
- The owner prefers it pushed even if unfinished, so they can test on real devices, as long as tests pass. Write what is unfinished in `HANDOFF.md` and the release `knownIssues`.

**Usage and secrets**
- Never go over 90% of any AI plan's usage (Claude, Codex, Gemini). Check before big jobs.
- Never put secrets, admin keys, developer-code digests or the owner's email in this public repo.
- Accounts, logins and Real-Debrid tokens live only in the private service (section 4).
- Never put the user's email in URLs.

**Style**
- Copy, notes and UI text are short, plain and specific (see CHANGELOG-RULES).
- Look at your work (screenshots), not only tests.

## 2. What TVM is (architecture in one screen)

- **Core** (`apps/core`, Node/TypeScript, port 7345):
  - catalog (Cinemeta), streams (Torrentio + Real-Debrid), ranking and versions
  - live TV and guide (XMLTV/Xtream), extras (Jellyfin-style features), profiles, progress
  - account sync, an update feed client, and proxies to the accounts service
  - Tests: `cd apps/core && npx vitest run`
- **UI** (`apps/ui`, React + Vite): web, desktop, iPhone and Android web views.
  - Tests: `npx vitest run`, `corepack pnpm run build`, `corepack pnpm exec playwright test navigation.spec.ts mobile.spec.ts responsive.spec.ts` (48 tests).
- **Windows** (`native/`, C++20, Win32, Direct2D, mpv):
  - Build and test: `powershell -NoProfile -ExecutionPolicy Bypass -File native/build.ps1`
  - The window updates itself from the `native-windows` GitHub release (`native/update-native.ps1`).
  - The Core it starts updates from the `desktop-ui` release. The Core outlives the window; `CatchUpCore` in `native/src/platform/core_host.cpp` updates a stale one.
  - 1.4.10 made failed or held-back checks retry after 10 min.
- **Phones**: on-device engines in Kotlin (`apps/android/.../privateclient/`) and Swift (`apps/ios/TVM/`), mirroring Core's API. They show the React UI.
  - Android tests locally: `JAVA_HOME="C:/Program Files/Java/jdk-21.0.11"`, `ANDROID_HOME=%LOCALAPPDATA%/Android/Sdk`, `apps/android/gradlew testDebugUnitTest` (the default Java 27 breaks Gradle).
  - iOS only compiles in CI.
- **Roku**: `apps/roku`.
  - Checks: `npx --yes brighterscript@0.73.5 --project apps/roku/bsconfig.json`, `node --test apps/roku/scripts/`, `node apps/roku/scripts/package.mjs`, `node apps/roku/scripts/check.mjs`.
- **CI** (GitHub Actions): workflows CI, Native Windows, Mobile packages, Desktop & Roku packages, Interface update feed, Sync TVM Downloads, publishing to the releases `native-windows`, `desktop-ui`, `ios-ui`/`android-ui` and `devices` (the downloads page).
  - Watch a push with `docs/agents/tools/watch-ci.ps1 -Sha <sha>`.
  - A Robolectric "MavenArtifactFetcher" failure on Android is a download flake; re-run with `gh run rerun <id> --failed`.

## 3. Release history (1.4.x, all test builds)

| Version | What |
|---|---|
| 1.4.0 | First 1.4 redesign push (Geist font, centred nav and magnifier, rails fixes, original-language/4K ranking, TV guide on Windows, patch-notes pop-up) |
| 1.4.1 | Windows two-pane Settings |
| 1.4.2 | Phone layout fixes |
| 1.4.3 | (Laptop) Settings, guide and extras everywhere |
| 1.4.4 | Merged a Copilot cloud-agent branch; Android guide parser and iPhone MKV fixes |
| 1.4.5 | **Account sync** (service + Core), web E2E fixes, Details prefetch, FPS switch |
| 1.4.6 | Web restored to the 1.3.2 glass, hover-lag fix, **franchise intros** (Hunger Games / Doomsday) |
| 1.4.7 | Tablet top-bar taps, iPhone webhook test |
| 1.4.8 | **Hub page**, artwork-led Movies/Series, English/quality fixes, cinema-recording fallback |
| 1.4.9 | TVM trailer v1 + developer tools (web) |
| 1.4.10 | Shooting star back on launch, update-check retry |
| 1.4.11 | Windows parity: Hub page, widescreen Movies/Series, Direct2D franchise intros, PyGlass refraction, dev tools |
| 1.4.12 | Clear glass navigation, more reliable Windows updates |
| 1.4.13 | iPhone finds MKV streams again and stays signed in after closing |
| 1.4.14 | **Account sync on iPhone, Android and Roku**; the trailer streams from the `media` release instead of being bundled |

Reports from each builder are in `docs/1.4/report-*.md`, and briefs in `docs/agents/briefs/`.

## 4. Private accounts service (separate private repo: GL-327/TVM-accounts)

- **Hosting:** a Cloudflare Worker + D1 at `https://tvm-accounts.tvm-accounts.workers.dev`, with the owner-only dashboard at `/admin` (it needs the admin key).
- **The admin key** is kept only in the private repo's `.dev.vars.secret` on the owner's desktop. Never copy it anywhere.
- **Deploy:** from that repo, `npx wrangler d1 migrations apply tvm-accounts --remote` then `npx wrangler deploy`. Run `npx tsc --noEmit` and `npm test` first.
- **Migrations applied:** 0001–0005.
  - 0003: dashboard features, email links, config.
  - 0004: the universal Real-Debrid key.
  - 0005: account sync.
- **Features:**
  - the dashboard (Accounts/Activity/Announcements/Settings)
  - Real-Debrid key save (Real-Debrid refuses requests from Cloudflare, so the check is best-effort)
  - the **universal Real-Debrid key**: hand-approved accounts without their own key use it; open sign-ups never get it
  - open sign-ups (off) and the minimum version
  - flags (`patchNotesPopup` is on)
  - email verification and reset links through Brevo; the `MAIL_*` Worker secrets are set and mail is enabled
  - `/v1/me/data` sync
- **Declined, and why:** handing the owner's Real-Debrid key to every open sign-up behind an ad-gated free quota. It risks the owner's RD account and is legally risky.

## 5. Tools, plugins and helpers available on the owner's desktop

**Claude Code skills (in `~/.claude/skills`)**, installed 2026-11-27 from GitHub (reviewed, no risky scripts):
- `animate` (cth9191/animate): procedural canvas animation to MP4, styles, beat-mapped audio, 9:16.
- `gsap-*` (greensock/gsap-skills): core, timeline, performance, plugins, react, scrolltrigger, utils, frameworks.
- `motion-design` (LottieFiles/motion-design-skill).
- `remotion-*` (remotion-dev/skills): best-practices, captions, create, render, multimedia, studio and others.

The original clones are in `~/.claude/skill-sources/`. To set them up on another machine, `git clone` the same repos and copy each folder that contains a `SKILL.md` into `~/.claude/skills/`.

**Other AIs (use them to save Claude usage; check their limits)**

*Codex CLI* (`codex exec`)
- Usage is in `~/.codex/sessions/**.jsonl` (`rate_limits`). Read it with `docs/agents/tools/codex-usage.sh`, which ignores expired windows.
- Launch builders with `docs/agents/tools/launch15.sh "job:dir"`. It concatenates `common.md` + `job-<name>.md`, runs `codex exec --json -c model_reasoning_effort=high --sandbox danger-full-access`, and stops everything at LIMIT% of the 5-hour window.
- **Never run more than 2–3 heavy builders at once**: six together burned a whole 5-hour window in about 15 minutes.

*Gemini via Antigravity*
- Headless agents: `language_server.exe agentapi new-conversation --model=pro "<prompt>"`, with `ANTIGRAVITY_LS_ADDRESS=127.0.0.1:<httpPort>` and `ANTIGRAVITY_CSRF_TOKEN` taken from the newest `~/.gemini/antigravity/daemon/hub_*.json`.
- Transcripts: `~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl`.
- Needs "Always allow"/Turbo set, and an app restart after updates, or the agent errors out.
- Asking for a Claude model there still runs Gemini.

*Claude Sonnet subagents* (Agent tool, `model: sonnet`) were the most reliable builders; they cost Claude usage.

*GitHub Copilot*: only the editor version is installed. A CLI is needed to drive it headless.

*Ideas not set up yet*: OmniRoute (diegosouzapw/OmniRoute) or FreeLLMAPI (tashfeenahmed/freellmapi) as free-tier LLM gateways. Both need the owner's own provider keys; one account per provider only.

**Local tools**
- ffmpeg/ffprobe (on PATH), Node, Python (`%LOCALAPPDATA%/Python/bin`), Chrome (playwright-core `channel: 'chrome'`)
- Microsoft Edge TTS (edge-tts), Kokoro TTS (`kokoro-onnx`; a venv exists in the old scratch folder)
- Ollama and LM Studio (installed, unused)

**Preview**: `.claude/launch.json` "tvm-preview" ran the repo Core on port 7346 (separate data dir) and a Vite production build on 5173. It is not committed; recreate it if needed. The Claude browser pane renders at about 1 fps while hidden, so measure FPS in real Chrome.

## 6. Everything still to do (in priority order)

1. **Windows catch-up** landed in 1.4.11 and 1.4.12; keep improving the Windows look first (see `HANDOFF.md`). Brief: `docs/agents/briefs/job-native4.md`.
   - If it didn't finish, check `git status` and the native build, then finish it.
   - Version number shown at the top of Settings, and an **"Update now"** emergency button (window + Core), on Windows and React.
   - Hub page, cozy artwork-led Movies/Series, franchise intros, trailer and dev tools on **Windows**: parity with React.
   - **PyGlass-style Liquid Glass** (reference: github.com/neomosh8/pyglass and the owner's screenshot: a bevelled rim that refracts and disperses, clear middle, bright rim) over a rich flowing-ribbon backdrop (Windows 11 bloom style, TVM blues/violets) so the glass has something to refract. Do it on Windows and React.
2. **Trailer v3.** Brief: `docs/agents/briefs/job-trailer3.md`. Codex was scheduled for 02:45 UTC 2026-11-27 to make a **preview only** (4 model stills, a turntable, voice tests incl. whisper) and stop for the owner's approval.
   - The owner wants: a **real rigged anime model (VRM)**, the same type as the TikTok creator @kingpinrin's narrator but with its own look (dark bob, teal/purple tips, cropped bomber, high-waist jeans, curvy stylised figure, tasteful); **fast TikTok voice timing** (170–190 wpm, tiny gaps, short beat before punchlines); opener "Lights off, newbie." (never "Hey rookie", that's the other creator's); 30 s; sells TVM.
   - Kokoro `af_heart` was used in v2. v2 is in `apps/ui/public/media/tvm-trailer.mp4` (not yet committed at handover).
3. **The streaming look** (owner: "looks like a database"). The web got the Hub and artwork-led rows in 1.4.8, but the owner still wants it warmer and more premium. Brief: `docs/agents/briefs/job-glass2.md`.
4. **Phones and Roku**: join account sync (Core sync module in `apps/core/src/sync/`; API in the accounts README). Bring the intros, Hub and new look to Roku.
5. Test on real devices: Windows, iPhone, Android, Roku. Check that quality is 4K/English via the Stats overlay (I).
6. Done in 1.4.14: the trailer streams from the `media` release (`releases/download/media/tvm-trailer.mp4`); replace that asset to update it.
7. When all of `HANDOFF.md` is done: delete HANDOFF.md and the pointer at the top of CLAUDE.md.

## 7. Lessons learned

- React changes do NOT reach the Windows app; port them to `native/` or the owner sees "no changes".
- Verify CI after every push; fix and push again. Phone builds catch things local tests don't.
- Copy builder reports into `docs/1.4/` and strip scratch paths before committing.
- Ask the owner before big creative work, and show previews (model, voice) before rendering.
