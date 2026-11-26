
# UI3 · TVM 1.4.8

UI3 covers `apps/ui` for web, desktop, iPhone and Android web views. Scope was limited to UI source and its tests. The shared version and release notes are integration work.

## 1. Hub

- Hub opens after sign-in. It greets the active profile by name and local time, with a large image from Home's current catalogue. Home is one click away and the nav highlights the active tab, including on the phone.
- Continue watching uses the active profile's progress. A film or a known episode resumes directly. Older entries without a reliable episode identity open Details.
- Apps & services reuses the TVM app catalogue and adds services from the shared registry. Services with TVM browse screens open there. The registry-only services open their official app or site.
- Free live TV uses the existing channel catalogue and the normal Player with its channel queue. The six featured picks start with BBC One, BBC Two, BBC News, CBBC, DW English and WeatherNation. The strip applies the active profile's live-channel age rules and backfills from the permitted channel list. The configured URLs for those six picks returned valid HLS manifests on the test connection.
- Hub keeps the release-notes arrival and has quick links for Movies, Series, Live TV and Search.

## 2. Cinematic browsing

- Home, Movies and Series share the artwork-led Spotlight, with larger desktop artwork, quieter metadata, a landscape Featured shelf and portrait catalogue shelves. Movies and Series choose art from their own lane. The existing event Spotlight and story-order shelf still work on Home.
- Focus or sustained mouse hover fades the title's backdrop and colour in behind the rows. The viewport uses two reusable image layers and skips a requested image if focus moves before it decodes. The 1.3.2 glass implementation stays in `theme/glass.ts` and `theme/liquidGlass.css`.
- Portrait labels reserve two lines and truncate with an ellipsis. Long titles have an in-card focus caption and a native mouse tooltip. Shared rails show glass chevrons at the edges while hovered and only in scrollable directions.
- The Settings Back button expands beside the heading. CSS cursor hiding requires fullscreen, active playback, hidden controls and an idle mouse. Pointer activity, pausing, buffering or leaving fullscreen exposes it.

## 3. Extras

- Details honors the switches for trailers, trailer backdrops, collections, upcoming episodes, anime titles, ratings, quality badges and versions. A ready trailer clip works even when there is no trailer button. The empty-response handling lets a feature fetch again after the viewer enables it.
- Your stats is available through Settings and the profile menu when the endpoint responds. Home keeps the upcoming episodes shelf and Surprise me. Surprise me is also available from the Movies and Series browse hero.
- Playback uses Core segment metadata for Intro, Recap and Credits. Skip segments Off hides skip actions and their timeline marks. Chapter tracks expose markers and Previous/Next chapter actions. The audio compressor, sleep timer, Up next, subtitles, versions, shortcuts and franchise intros use the existing playback path. Up next steps aside while the settings menu is open, and the panel paints above the seek bar.
- Extras changes apply locally as soon as the switch is pressed. Partial writes reach Core in order. The online subtitles switch also removes attached online sidecar tracks while leaving in-band captions available.
- Read [Core's endpoint report](core3.md). It covers real upstream service results, including TheIntroDB v4, VTT, upcoming episodes, collections, clips and theme songs. UI verification uses deterministic endpoint responses and local MP4 and HLS media.

## 4. Performance

Production Chrome with rasterization and GPU compositing enabled on an RTX 5070. The setup had eight 30-title catalogue rows, including their looped copies, and 728 rendered cards altogether.

| Interaction | Average | p95 frame interval | Long tasks | React commits |
| --- | ---: | ---: | ---: | ---: |
| Warm horizontal hover sweep | 142.4 fps | 11.2 ms | 0 | 0 |
| Vertical wheel scroll | 94.1 fps | 22.2 ms | 2 | 1 |

Poster and channel hover stays in CSS. Row arrows update DOM attributes, and hover ambiences animate opacity on two viewport layers. Rail entrances and card growth use transform and opacity. The result measures this hardware and fixture, with some frames over budget during the scroll pass.

## 5. Verification

- UI `npx vitest run` passed **560 tests** in **96 files**. UI `corepack pnpm run typecheck` and the root `corepack pnpm run build` passed. The build used a Corepack `pnpm` shim in the scratch directory so the workspace script could find its nested command.
- `corepack pnpm exec playwright test navigation.spec.ts mobile.spec.ts responsive.spec.ts --reporter=line` passed **48 tests** in the verified run, including desktop and Android at **768×1024**. E2E artifacts were directed to scratch.
- Chrome screenshots were captured and reviewed at **1920×1080**, **1280×720** and **390×844**. Each set contains Hub, Home, a focused long title, Settings and Live TV, plus the Hub channel strip. [Desktop Hub](../shots/ui3/1920x1080-hub.png) · [Home at 720p](../shots/ui3/1280x720-home.png) · [Phone card focus](../shots/ui3/390x844-focused-card.png)
- `git diff --check -- apps/ui` passed. Edited files use LF.

### Test changes

- `navigation.spec.ts` updated the shared entry fixture and remote chrome list for Hub. Updated test cases were “something is always focused after every remote key”, “Back at the root does not blank the screen”, “Back from a depth of three returns Hub one step at a time”, “a modal traps focus and Back closes the modal”, “TVM Stream asks who is watching every time it opens”, “Hub and Home open without a Real-Debrid token”, “TVM Stream asks for a token and Enter on the field saves”, “Back leaves TVM Stream without a token and returns Hub”, “MAX shows the mock live pack in the programme guide”, “clicking a film opens the title instead of only jumping the row”, and “Live TV opens the guide with free channels and setup, and Back returns Hub”. The film test now opens Home before selecting the poster. The Real-Debrid test checks that Home is one click away and selected in the nav.
- `mobile.spec.ts` updated “horizontal rails yield vertical pans to the page”, the three “Premium opens a usable 16:9 layout” cases, “Search is tappable and opens the same title path as Home”, “a left-edge swipe leaves Settings and returns to Hub”, and the three “fits the full iOS viewport without sideways document scrolling” cases. These follow the new launch path, the Featured rail and the sixth tab.
- `responsive.spec.ts` expanded the same eight viewport cases to check Hub before Home and Settings. The existing overflow and tap assertions still run.
- `Home.test.ts` moved launcher expectations to Hub and verified Home keeps the catalogue route under Details. `extras.test.ts` updated the browser fallback fixture to the parallel shared client's TheIntroDB v4 IMDb URL. Segment assertions stayed the same.

## Integration

- Native Windows and Roku use separate clients. Match the Hub ordering, age-filtered free picks, selection and caption behavior when implementing the design there. The phone browser checks covered WebKit and Chromium. Native video surfaces and real signed-in service playback still need device or account testing.
- Suggested 1.4.8 notes for `web`, `desktop`, `ios` and `android`:
  - Hub opens with Continue watching, your streaming apps and free live channels.
  - Home, Movies and Series get a Featured row and backdrops that follow the selected title.
  - Long poster titles fit in two lines and show in full when selected.
  - The mouse pointer only hides while a fullscreen video plays and the mouse is idle.
  - Details and the player honor Extras switches for trailers, subtitles, chapters and more.
