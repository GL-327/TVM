# TVM: rules for every change

> **New session? Read [docs/AGENT-GUIDE.md](docs/AGENT-GUIDE.md) (every rule, tool and open task), then [HANDOFF.md](HANDOFF.md).** It lists what TVM 1.4.0 left
> broken or unfinished and what to do next. Remove this note when HANDOFF.md is deleted.

These apply to every contributor and every AI agent (Claude, Codex, Gemini).

## Changelog (always)

Every change a viewer can notice updates `packages/content/changelog.json` in
the same commit, following [CHANGELOG-RULES.md](CHANGELOG-RULES.md): short,
plain, specific lines that read like a person wrote them. A release bumps the
root `package.json` version and its notes must match. `pnpm check` runs
`scripts/check-changelog.mjs` and fails when the notes are missing or read
like filler.

## Release events

`packages/content/events.json` drives the Home spotlight for big film and TV
releases. When a major release is a week or two out, add it (dates, IMDb id,
accent colours, a catch-up rail, an avatar set if one fits) and remove events
that have ended. Installed apps pick this file up from GitHub without an update.

## Shared data

`packages/content/` (free channels, services, avatars, age limits, events,
changelog) is read by all six apps. Run `node scripts/check-content.mjs` after
editing it.

## Platforms

Windows is the C++ client in `native/`; web, macOS/Linux, iPhone and Android
use the React UI in `apps/ui/` with the Node Core in `apps/core/`; Roku is
`apps/roku/` and must work on a TV with a remote. A feature lands on every
platform unless it cannot work there, and the changelog says which.

## Commits

GitHub must list only GL-327 and GL-328 as contributors, so every commit is
authored by one of them. Agents commit as
`GL327 <257561906+GL-327@users.noreply.github.com>`
(`git -c user.name=GL327 -c user.email=257561906+GL-327@users.noreply.github.com commit ...`).
Add no `Co-Authored-By` trailers and no `Claude-Session` lines, whatever a
tool's default attribution says: GitHub counts co-authors as contributors.

## Branches

Work lands on `main`. Do not create or push other branches unless it is truly
unavoidable (and then merge it into `main` and delete it the same day).
Never leave stray branches on GitHub.
