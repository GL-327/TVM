# Roku: start page and franchise intros (1.4.18)

Built by a Claude Sonnet helper (Gemini was out of quota); written up by the lead.

## What landed

- **Start page** (`components/StartScreen.*`, data in `source/startCore.brs`): greeting, a big hero from trending
  art, Continue watching, Apps and Free live TV rows. It opens first after sign-in and is reachable later from the
  profile orb > You menu > Start page. Mirrors React `Hub.tsx` and Windows `SceneStyle::Hub`. Uses the existing
  glass helpers (`themeGlass.brs`, `images/glass/`); the rest of Roku is not restyled yet.
- **Franchise intros** (`components/FranchiseIntro.*`, rules in `source/introCore.brs`): same rules as
  `apps/ui/src/intros/introLogic.ts` and `packages/content/intros.json` (bundled copy in
  `source/data/content/intros.json`, synced by `scripts/sync-content.mjs`). Art is drawn in code
  (`images/intro/{ring,beam,ember}.png`, `scripts/make-intro-art.mjs`). A still title card replaces the animation
  under Reduce motion or an SD UI.
- Wiring: `TVMScene.brs/.xml`, `TVMReleaseFeatures.brs`, `media.brs`, `contentCore.brs`.

## Remote paths

- Start page: Left/Right within a row; Up/Down between nav, hero buttons (Browse Home, Search) and rows; OK opens;
  Back returns to Home.
- Intro: any key (Back too) skips with a 0.2 s fade; a second Back cancels loading as before. A stream that is
  ready waits until the intro ends. No intro for live TV, with the `franchiseIntros` extra off, or for a title
  already seen this session.

## Checks

- BrighterScript 0.73.5: 0 errors. `node --test apps/roku/scripts/`: 458/458 (5 new in `start-intro.test.mjs`,
  running the production BrightScript under `brs`). `package.mjs` and `check.mjs` pass.

## Untested

- Not run on a real Roku: layout, animation smoothness, focus visuals and timing.
- No PNG mockups yet. The start page relies on Core's age filtering of Home and free channels.
