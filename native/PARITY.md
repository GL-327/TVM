# TVM modern: animation and look parity with the current app

This file lists every animation of the default look (the `dark` theme, which the app
starts with) and says where this copy stands. The old app is `C:\Users\Gathe\Desktop\TVM`.
Each row names the file the values come from, so a difference can be checked against it.

Status meanings:

- **Matched**: the same values are used, and the build's tests check them.
- **Changed here**: the value was corrected in this copy to match the old app.
- **Partly**: the animation is there, but a value or a detail differs.
- **Not ported**: the animation is not in this copy. Its screen, or the layer it sits on,
  does not exist here yet.

## 1. Motion core

| Animation or rule | Old source | Values | Status |
| --- | --- | --- | --- |
| Motion tokens | `packages/design/src/tokens.css` | fast 140 ms, base 200 ms, slow 260 ms | Matched (`motion/preferences`) |
| Easing | `packages/design/src/tokens.css` | `cubic-bezier(0.22, 1, 0.36, 1)` | Matched (`motion/easing`) |
| Motion setting: auto, full, reduced | `apps/ui/src/theme/motion.ts` | reduced snaps every token to 1 ms | Matched (`motion/preferences`, Settings) |
| Performance mode | `apps/ui/src/theme/motion.ts`, `motion.css` | reduces motion, blur and shadows | Matched for motion; blur and shadows are not drawn here |
| Rail and page camera | `apps/ui/src/nav/scrollAnim.ts` | 0.24 per 16.7 ms frame, settles at 0.6 px, 90-step cap | Matched (`motion/camera`) |
| Frozen when hidden | `motion.css` | pauses the clock while the app is hidden | Matched (`motion/timeline`) |

## 2. Focus on posters (the cards of Home and the rails)

| Animation or rule | Old source | Values | Status |
| --- | --- | --- | --- |
| Poster scale on focus | `apps/ui/src/app.css` lines 3951-3956 (the last rule wins) | scale 1.015, from the bottom centre | Changed here (`ui/widget`, `kPosterFocusScale`) |
| Poster lift on focus | `app.css` lines 3952-3954 | translateY -0.12 rem | Changed here (`kPosterLiftRem`) |
| Poster scale timing | `app.css` lines 3939-3941 | 200 ms base token, ease | Changed here (`ui/scene`, base token) |
| Poster outline | `app.css` lines 1202-1204 | white, 0.16 rem wide, 0.18 rem from the edge; drawn at once, not eased | Changed here (`kPosterRing`, `Card::focused`) |
| Focus moves between cards | `app.css` (above) | the scale and the outline follow focus | Matched |
| Poster shadow on focus | `app.css` line 3955 | `0 .45rem 1rem #0005` | Not ported: shadows are not drawn |
| Poster label colour on focus | not checked in the old CSS | muted to full text | Partly: the native mix is an approximation |

## 3. Buttons

| Animation or rule | Old source | Values | Status |
| --- | --- | --- | --- |
| Button scale on focus | `apps/ui/src/components/FocusButton.css` lines 6-21 | scale 1.08 over the fast token, ease | Changed here (`ui/button_focus`, `DrawButton`) |
| Button fill on focus | `apps/ui/src/app.css` lines 1287-1290 | surface-hover at once (background does not transition) | Changed here |
| Button outline on focus | `app.css` lines 1280-1285 | 0.18 rem, 0.14 rem from the edge; drawn at once and scales with the button | Changed here |
| Button shape | `app.css` line 1250 | pill, radius 999 rem | Changed here (radius is half the height) |
| Primary button | `app.css` lines 1265-1269 | white fill, #111 text | Changed here (Play, Save, Paste and save) |
| Button focus shadow | `app.css` lines 1284, 1268 | `0 .7rem 1.8rem` navy glow; primary `0 .5rem 1.2rem` | Not ported: shadows are not drawn |
| Button size and padding | `app.css` lines 1247-1248 | min height 2.85 rem, padding 0.55 rem 1.2 rem | Partly: native buttons are 3.5 rem tall, with their own layout |
| Button label | `app.css` lines 1254-1255 | body size, weight 680 | Partly: bold, body size |

## 4. Colours of the default look

| Token | Old value (dark) | Status |
| --- | --- | --- |
| Background, surface, surface hover | `#071018`, `#102238`, `#163048` | Changed here (`ui/widget`, `tokens`) |
| Text, muted, faint | `#e8f0f8`, `#9bb0c8`, `#6a8298` | Changed here |
| Border soft | `rgba(140, 180, 220, 0.16)` | Changed here |
| Focus ring | `#9edcff` (buttons) | Changed here |
| Poster outline | `#ffffff` (fixed in `app.css`) | Changed here |

## 5. Animations the native app does not have yet

Each of these is in the default look, and each needs a layer or a screen this copy
does not have.

| Animation | Old source | What it is | Status |
| --- | --- | --- | --- |
| Hero stage on Home | `app.css` lines 146-268, `components/HeroArt.css` | A large hero picture at the top of Home. Its picture crossfades (`hero-art-dissolve` 480 ms), and its title dissolves (`hero-copy-in` 480 ms). See section 5a | Partly ported (section 5a) |
| Hero picture entering on the first load | `app.css` lines 186-187 (`art-in` 700 ms) | Not used on the hero: `HeroArt.css` turns off `art-in` for the stage pictures, so the first picture appears at once | Matched (the first picture is there at once) |
| Hero copy entering with the screen | `app.css` lines 232-237 (`copy-enter` 260 ms) | The copy rises 0.35 rem and fades in when Home opens | Not ported |
| Background scene | `App.tsx` lines 59 and 67 (`SceneField`), `theme/scene.css` | Sky and sea layers that drift (`tvm-scene-drift-a` 24 s, `-b` 31 s, `-c` 19 s, `breathe` 21 s, `spec` 34 s), behind every screen | Not ported |
| Launch intro | `brand/TvmIntro.tsx`, `brand/TvmIntro.css`, `nav/ViewStackProvider.tsx` line 137 | The TVM mark blooms, rings, flares and fades out in about two seconds. Plays once per session, on the first root screen | Ported, both forms (section 5c). The stream form plays when TVM Stream opens, not as the web's Library does |
| Screen enter | `app.css` lines 58-60 and 3938 | `view-enter`: fade in over 200 ms; `.screen-content` fades in over 260 ms | Not ported: screens appear at once |
| Modal scrim | `app.css` lines 62-64 | `scrim-in`: fade in over 200 ms | Not ported (no modal scrim here) |
| Loading shimmer | `app.css` lines 1596-1639 | `skeleton-shimmer` 1.35 s, linear, 6 times | Not ported: placeholders are static |
| Loading slide and pulse | `app.css` lines 1842-1860 | `tvm-loading-slide` 1.15 s, infinite; `tvm-loading-pulse` | Not ported |
| Search pill | `app.css` lines 1941, 2021-2025 | `search-pill-in` 200 ms | Not ported: search is not ported |
| Easter egg | `app.css` lines 1778-1801 | `tvm-egg-burst` 8 s | Not ported |
| Navigation bar (ribbon) | `theme/glass/ribbon.css`, `theme/mobile.css` | Its own motion | Not ported: the bar is not ported |
| Player | `player/features/*.css`, `player/cinema-controls.css` | Menu enter 180 ms, control fades 140 to 180 ms, skip recap 260 ms | Not ported: playback is not ported |
| Service hubs | `screens/service/skins/*.css` | Per-service rail and poster motion | Not ported: the screens are not ported |
| Rail loop | `nav/loopingRail.ts` | A three-copy conveyor | Not ported: rails clamp instead |

## 5a. The Home hero (ported in part)

The hero is the stage at the top of Home. It is drawn in the native Home scene, and the rails
start below it.

| Animation or rule | Old source | Values | Status |
| --- | --- | --- | --- |
| Stage height | `app.css` lines 486-489 (`.home--launcher .stage--home`) | 48% of the window height | Matched (`ui/scene`, `kHeroHeightFraction`) |
| Picture crossfade | `components/HeroArt.css` lines 20-27, `heroArtState.ts` | the new picture fades over the old one in 480 ms, `cubic-bezier(0.2, 0.65, 0.3, 1)`; the first picture is there at once | Matched (`ui/scene` `StartHeroArt`, tests) |
| Picture waits for its file | `HeroArt.tsx` | a picture is swapped in only once it has loaded | Matched (the app says when the file is there) |
| Picture focal point | `app.css` line 185 (`object-position: 70% 20%`) | cropped with its focal point at 70% across and 20% down | Matched (`ImageFaded`) |
| Title dissolve | `app.css` lines 266-277 (`hero-copy-in`) | the title fades from nothing to full in 480 ms, on the same curve | Matched (tests) |
| Turn every eight seconds | `screens/Home.tsx` lines 204-215 | moves to the next title, only while Home is on screen, the page is near the top, and motion is not reduced | Matched (`TurnHero`) |
| Titles the hero turns through | `screens/Home.tsx` lines 157-167 | the titles in progress, then the rail titles with a picture, each listed once, at most four | Partly: there is no `featured` title from the core, so it is not first |
| Picture fades as the page scrolls | `screens/heroFade.ts`, `Home.tsx` lines 217-237 | `1 - scroll / (0.92 x height)`, on the picture and the vignette only | Matched (tests) |
| Vignette | `app.css` lines 210-230 | a fade up from the bottom, then in from the left | Matched (gradients) |
| Fallback under the picture | `app.css` lines 199-203 | a gradient from the elevated background, with the title's hue | Matched (gradients) |
| Kicker, pill and source line | `app.css` lines 535-553 | HOME pill, then FEATURED ON TVM STREAM | Partly: widths are estimated, since the painter does not measure text |
| Title | `app.css` lines 248-257 | 4.4 rem, uppercase, bold | Partly: one line, cut with an ellipsis. The web title wraps to more lines |
| Watch button | `app.css` lines 340-369 | text only; a white glow on focus, no ring and no scale | Partly: the glow is approximated with faint copies of the text |
| Browse button | `app.css` lines 417-421 and `FocusButton.css` lines 24-26 | glass pill; a lighter fill on focus, no ring and no scale | Matched (fill, border, focus) |
| Dots | `app.css` lines 423-438 | one dot per title, the shown one white | Matched |
| Focus starts on Watch | `nav/registry.ts` line 48 (`home: defaultFocus: 'hero-play'`) | | Matched |
| Watch opens the title, Browse opens TVM Stream | `Home.tsx` lines 347-361 | | Matched: Browse opens a placeholder for TVM Stream, which is not ported |
| Brand lockup and the rule beside Watch | `components/BrandLockup.tsx`, `app.css` line 371 | the TVM mark and wordmark | Not ported |
| Clock in the top right | `app.css` lines 505-533 (`home__clock`) | the time and date | Not ported |
| Launcher destinations and the nav bar | `app.css` lines 491-503, `Ribbon` | the row of destination tiles between the hero and the shelves, and the nav bar | Not ported |
| Ember wordmark | `app.css` lines 279-286 | an orange glow on some titles | Not ported: the catalogue does not give it here |

## 5b. The background scene (ported, and hidden, as in the old app)

The old app draws an animated scene behind every screen (`SceneField` in `App.tsx`, and
`theme/scene.css`). In the light and dark themes it is hidden, and the cascade is the reason:
`dark.css` (lines 56-61) and `light.css` (lines 60-63) give `.home`, `.home__shelf`, `.page` and
`.stream-page` an opaque `var(--tvm-bg)`. That rule outranks the `transparent` that `scene.css`
gives the same elements, so every page covers the scene. In a browser, Home's background
computes to `rgb(7, 16, 24)`, and the scene is painted underneath it, unseen. The account gate
is opaque as well.

The native port follows the old values exactly, and keeps the scene hidden in the same way.

| Animation or rule | Old source | Values | Status |
| --- | --- | --- | --- |
| Six layers: sky, veil, two caustics, sun, spec | `scene.css` lines 118-194 | radial gradients in the dark colours; boxes inset 12% past the window | Ported (`ui/stage`, tested) |
| Drift keyframes | `scene.css` lines 287-334 | sky 24 s, veil 31 s, caustic 19 s, second caustic 27 s starting 9 s in, sun 21 s, spec 34 s; alternate, infinite, cubic-bezier(0.37, 0, 0.63, 1) | Ported (tested at 0 s, half a period, and the way back) |
| Sun and spec fade | `scene.css` lines 314-334 | opacity 0.26 to 0.56, and 0.1 to 0.4 | Ported |
| Container opacity | `scene.css` line 58, `dark.css` | 0.52 in the dark theme | Ported by scaling each colour's alpha, not as a group. A small difference where layers overlap |
| Reduced motion | `scene.css` lines 336-348 | the layers hold still; every layer at 0.7, and the sun and spec at 0.36 | Ported (tested) |
| Performance mode | `motion.css` line 22 | the scene is not shown at all | Ported (`Shown()`) |
| Ground under the scene | `app.css` `.app`, `dark.css` | black, `--tvm-bg-deep` | Ported (`Shell::Paint`) |
| Screen blend | `scene.css` line 135 (`screen` on the veil) | | Approximated by normal blending. At these alphas the two are almost the same |
| Caustic blend | `scene.css` line 147 (`soft-light`) | | Approximated at half strength. Normal blending is about twice as bright over the dark ground |
| Grain | `scene.css` lines 196-201 | an overlay of noise, at 0.06 in the dark theme | Not ported. An overlay on a near-black ground changes it by less than one level |
| Hidden on every screen | `dark.css`, `light.css` (above) | | Matched: `ScreenBase::ShowsStage()` is false on every screen, so the stage stays hidden |

Checked on a 1024 x 768 window with the animations at time zero: the native stage and the CSS
scene put the sun glow top right, the sky across the top, the veil in the middle, and the caustics
in the bottom corners. The tone is close, not pixel-exact.

## 5c. The intro (ported, both forms)

The sting from `brand/TvmIntro.tsx` and `TvmIntro.css` comes in two forms. Each plays once per run,
over the window:

- The 'tvm' form plays at launch, over Home. It holds on the mark while the catalogue loads.
- The 'stream' form plays the first time TVM Stream opens. That screen is still the placeholder, so
  for now the sting plays over the placeholder.

The timings are the old ones, from the start of the sting: the bloom at 0.08 s, the first ring at 0.12 s,
the second at 0.28 s, the flare at 1.05 s, the six motes from 0.22 s, the mark at once with its own
bloom, the four rays from 0.45 s, the letters at 0.85, 1.00 and 1.15 s, the tag at 1.35 s, the sheen
at 1.55 s, and the skip hint at 1.7 s. The sting leaves after 3.2 s, or when the catalogue has loaded,
whichever is later. While the catalogue is still loading, it holds on the mark for at most 2.8 s. The
fade out takes 420 ms. OK, Enter, Escape, Space, a click or a tap ends it at once.

With reduced motion, `motion.css` cuts the animations to their end frames, so the sting shows its
settled frame and leaves after 160 ms, or when the catalogue has loaded.

The stream form swaps the accent and the cool blue, as `.tvm-intro--stream` does. Its glows, its bloom,
its flare (which has its own bright centre, `#e8fbff`), its mid ring, its motes and its tag are all in
the blue. Its tag reads STREAM where the launch form reads WATCH. Its logo is the same mark picture, since
the sting has no other: the "tvm stream" lockup is on TVM Stream's own page (section 5d).

One difference from the web, on purpose. In the web app the stream sting does not play in the normal
flow. Library starts with its intro done whenever the launch sting has run, and the launch sting always
runs first. The native app plays the stream form the first time TVM Stream opens in a run, so that it
can be seen. Say if the web's behaviour is wanted instead.

Approximations, which show only up close:

- The text-shadow glow on the letters is drawn as a radial gradient that follows the blur's falloff
  (a Gaussian with sigma 0.6 rem, as `0 0 1.2rem` makes it). It is close to the web's shadow, but it is
  not the same blur, and it is clipped to the word's box as the web's box clips it.
- The 4.5% noise over the background (`--tvm-scene-noise`, an `feTurbulence` overlay) is not drawn. The
  web blends it with `overlay`, which the painter cannot do, and over the near-black wash it barely shows.
- The word is drawn at weight 800 and the tag at 750, as the web draws them. The advances are the web's,
  so the spacing matches.
- The mark's picture is drawn over a blue plate only once it is fully opaque. While it fades in, the
  plate is left out, which differs only where the picture is see-through.
- When a skip ends a hold, the bloom and the tag play their entrances again through the fade, and the
  mark's idle loop stops, as the web's stylesheet does when the hold's classes come off.
- The loading screen's intro is not ported. On the web it plays only when the launch sting has not, so
  it does not play in the normal flow either.

Frame time. The window thread used to decode each picture the first time it was drawn. When the catalogue
arrived during the sting, Home's first frame with its pictures took about two seconds, and the sting froze
for that time. Pictures are now read on the workers, and the window thread makes at most four bitmaps a
frame. Lookups for the artwork cache are remembered rather than checked on disk each time. While the sting
covers the window, the screen under it is not painted, since the sting's wash hides it.

The advances of the tag and of the skip hint were measured again for this port. The first measurement
was taken in a page without the app's font, so those two were a few pixels off. They now use the app's
font, and each letter is drawn where the web's letter is. The word's advances came from its own font and
did not change.

The stage, the mark, the word, the tag and the skip hint were measured against the web sting in a
browser at 1280 × 720, which is this window's client size. In the stream form the mark's top is at
240.1 px, the word's at 393.2 px, the tag's at 467.9 px with its letters from 607.4 px, and the skip hint
ends at 1265.1 px. The web is the same to within a pixel or two.

## 5c2. Home is TVM Stream

Home and the TVM Stream page are one page now, as asked: Home wears the stream chrome (the profile,
Search, Shows, Movies, the TVM lockup, Live TV, Downloads and Settings), its billboard turns through
its titles with WATCH NOW and the "tvm stream" lockup, and its rails follow the lane. Home keeps its
catalogue without Real-Debrid; playing then shows the Real-Debrid error card. Browse TVM Stream is gone.

Search (`SearchModal.tsx`) is the search field across the top, typed into from the keyboard (Ctrl+V
pastes), asked 180 ms after the last key, with the results as rows of eight posters and the count or
"Nothing matched that search." under the field. The title that is the query comes first. Not carried:
recent searches, the on-screen keyboard, apps among the results, and opening a pasted link.

Details (`Details.tsx`) has the backdrop and its vignette, the poster, the Series or Film kicker, the
title, the metadata, the buttons (Play for a film, My List, Back) and the synopsis. A series has its
seasons as tabs and the season's episodes as rows with their stills, numbers, names and synopses; OK on
an episode plays it. The page scrolls with the focus and the wheel. Not carried: Download, IMDb and
Series Graph, and Resume.

## 5d. TVM Stream (ported)

Browse TVM Stream opens the page from `screens/Library.tsx`, after its sting. It is a scene dressed in
the stream style:

- The chrome from `StreamChrome.tsx` runs across the top and stays put while the page scrolls: the
  profile's name, Search, Home, Shows, Movies, the TVM wordmark lockup, and Downloads. It has the
  veil at 82% of the background, the links at weight 560 in the player ink, and focus as a pill of
  the accent at 24%. Shows and Movies are lanes that toggle, and the lane that is on is drawn at
  full strength. Home goes back to Home. Search, Profiles and Downloads are still placeholders.
- With Real-Debrid connected, the billboard shows the title in progress, or else the newest film,
  with WATCH NOW, a faint rule and the "tvm stream" lockup, then Learn More. Both open the title.
  Under it are Continue Watching (left out on Movies), My List, and the catalogue rails, all filtered
  by the lane.
- Without Real-Debrid, the page asks for a token, with the web copy. Continue opens the Real-Debrid
  screen, and Back to Home goes home. On the web this is a plain section; here it sits in the hero's
  place, over the hero's fallback gradient.

Not carried yet: the profile orb (the name is drawn as text), the search icon, the plan rules
(Basic hides the billboard and keeps two rails), the lockup's seven-press egg, and the loading screen.

## 5e. The player (ported in part)

The player from `screens/Player.tsx` plays through mpv, as the old desktop app does when its shell
paints mpv behind the page (`apps/shell/src/nativePlayerHost.ts`). mpv is found where the old app
installs it (`%LOCALAPPDATA%\TVM\mpv`), then in the usual folders and on PATH, or at `TVM_MPV_PATH`.
It is started with the old app's arguments and driven through its JSON IPC pipe.

mpv draws into a child window that fills TVM's window. That window is disabled, so the mouse and the
keys still reach TVM. The chrome is drawn in a see-through popup over it, as the old app lays its
transparent page over mpv's window.

A catalogue title is found as the Node core finds it: Torrentio through the viewer's Real-Debrid
token, the streams ranked by quality with the cache breaking ties, at most five tried, each resolve
followed to its file, and Unrestrict where the link needs it. An owned file (`rd:`) plays from its
own link. A Live TV channel plays from its address, or from the panel's stream address for a login.

- While the stream is found, and until mpv draws its first frame, the queue card shows: the mark,
  TVM CINEMA, "Getting your stream ready" and its line.
- Over the picture, the chrome is `player/CinemaControls.tsx` with `cinema-controls.css`: the two
  scrims, "Back to browse" and the TVM CINEMA mark at the top, the thin timeline in #67baff, then play,
  back and forward ten seconds (not on a live channel) and the sound on the left, the title and episode
  in the middle, and full screen on the right. The glyphs are the web's own SVG paths. The chrome fades
  over 180 ms after 3 s without input, and stays while paused or waiting; the cursor hides with it. A
  move that Windows makes up when a window changes under a still cursor does not count as input.
- The sound runs to 400%, as mpv's `--volume-max` allows: the bar runs from 0 to 400% with a mark at
  100%, and the level shows beside it, in the fill colour past 100%. The web caps at 100%, as an HTML
  video does; the boost is on purpose. The level and mute are kept between runs.
- Keys: OK plays or pauses (and only brings the chrome back when it had faded), Left and Right seek
  ten seconds, Up and Down change the level by 10%, the wheel by 5% a notch, M mutes, F or F11 goes
  full screen, Back closes. A click on either bar sets it.
- mpv plays with its `high-quality` profile, which the old app did not ask for.
- A failed search or a failed stream is tried twice more before the error card shows. The card is
  `PlaybackError`'s: the "Playback" kicker, the title for the reason, the message from
  `playbackErrors.ts`, Retry and Back.
- Progress is saved every ten seconds, on pause, on leaving, and at the end, so Continue watching
  follows. A part-watched title starts where it was left. At the end of a title the player closes.

- The menus sit left of full screen, each opening a dark panel over its button: CC (Off and mpv's
  subtitle tracks), Audio (shown with two or more tracks, with codec and channels), Quality, and speed
  (0.5× to 2×, as `PlaybackSpeed.tsx` lists them, not on a live channel). Up and Down move along an open
  menu, OK picks, Back closes it; the chosen row has a tick. Quality is the one place the native app
  differs on purpose: mpv plays one file with no ladder, so the menu lists the title's best twelve
  Torrentio streams (4K, 1080p and so on, with the release name) and switching restarts at the same
  place. The button reads the picture's own height, from mpv's track list.
- The timeline drags: press on the bar, move, and let go to seek. The bar and its knob follow the drag,
  and a bubble over the bar names the time under the pointer while dragging or hovering.
- Next Up, from `NextUp.tsx`: over the last 45 seconds of an episode (a fifth of a short one) a card at
  the right shows "Up next · in Ns", the show, the next episode and its still, with a draining bar,
  Play next and Watch credits. It takes the focus when it appears. At the end the next episode plays,
  unless Watch credits was chosen. The next episode is the one after this in Cinemeta's order.

- Skip recap (`SkipRecap.tsx`): over the first 90 seconds of an episode after S1 E1, a light button at
  the right, over the timeline, which takes the focus; OK seeks to 1:30. The web reads the recap's end
  from chapter markers when a file has them and falls back to 90 seconds; the native app uses the
  fallback only.
- Skip credits (`CreditsAction.tsx`): over the last 6% of a title with no next episode (8 to 18
  seconds, at most a third of it), "Skip credits 0:12" and "Watch credits"; skipping goes to the end, so
  the title counts as watched. With a next episode, Next Up covers it, as on the web.
- Trickplay (`Trickplay.tsx`): while the timeline is hovered or dragged, or an arrow is held, a 16:9
  thumbnail and the time show over the bar. The web reads sprite sheets the server made; the native
  app has none, so a second mpv writes one frame per ten-second stretch (about two seconds each over
  the network, one at a time) and keeps them until TVM closes. Held arrows step 10, then 30 after
  700 ms, then 60 seconds after 1.5 s, every 400 ms.
- The title overlay (`TitleOverlay.tsx`): under Back, NOW PLAYING (or a pulsing LIVE pill), the title
  with its short accent rule, and the episode and "42:10 left", with the chrome.

- Go Live (`GoLive.tsx`, `liveEdge.ts`): on a channel that has fallen 12 seconds or more behind, "Back
  to live" with a pulsing red dot and "14s behind" (or "2 min behind", "1h 5m behind") at the top right,
  under the header, with the chrome. mpv gives no reliable live edge for a channel, so the native app
  counts how long the channel was paused, which is what puts a viewer behind; pressing it opens the
  channel again, which lands at its live edge.
- The remote hints (`RemoteHints.tsx`): the first time anything plays, ever, a pill over the dock reads
  `LEFT` `RIGHT` SKIP · `OK` PAUSE · `BACK` EXIT (no skip on a channel), its keys lighting in turn. It
  comes up 420 ms after the picture, stays 5.2 s, rises in and fades out over 280 ms, and leaves on any
  input after its first 750 ms or when the chrome hides. The flag is a file in the data folder.
- The header's actions (`CinemaControls` actions): Download, which opens Downloads over the player (still
  a placeholder screen; playback resumes from the saved place on Back), and My List, "Add" or "Remove"
  with the bookmark, saving the series for an episode. Not on a channel or a Real-Debrid file.
- The title overlay's title has the web's soft dark shadow, so it reads over a bright frame.

The ambient backdrop is not drawn, as on the web: `PlayerRoot` leaves it out for native playback, and
mpv is the native engine. Not carried yet: the plan's watch-hour count and its ad break. The waiting
ring is twelve dots.

On the rails, Ctrl with the wheel scrolls sideways, as Shift does.

## 5f. Watchlist, Profiles, Plans and Updates (ported)

- Watchlist (`Watchlist.tsx`), from My List in Home's chrome: "Saved for later", the heading, the filter
  buttons (All titles, Movies, Series, the chosen one primary), Sort by cycling Recently saved, Title A–Z,
  Newest release and Highest rated, the count, and the posters eight to a row. The empty and filtered-empty
  states use the web's copy.
- Profiles (`Profiles.tsx`): "Who's watching?", a tile per profile with its orb in the profile's hue and its
  initial (the active one ringed), Remove under each when there is more than one, and Add profile, whose name
  is typed from the keyboard. Choosing or making a profile switches to it and goes back; Home then follows that
  person's list and progress. The registry is written as `profiles.ts` writes it, sealed in the vault, so the
  two apps share it: the first run makes Profile 1 and moves the old root lists into it, new profiles take the
  next brand hue, and the last profile cannot be removed.
- Plans (`Plans.tsx`): "What TVM costs", the two kinds of access with the Node core's own copy, prices and
  Live TV terms (`accessTiers.ts`, `liveTv.ts`), how access is arranged, and Donate fenced off below. The
  "Your account" box is left out: the native app has no account sign-in yet.
- Updates (`Updates.tsx`): this build (v1.0.0, native), the last check, what GitHub has published, and "What's
  new" from GitHub's latest changes, with Check now and Automatic updates. Apply is shown disabled, on purpose:
  the web updater swaps the Electron interface, and the native app is replaced by installing a newer build. The
  private-fork token field is left out.

## 6. Screens that are not ported

Each of these shows the placeholder screen, so none of its own animations exist yet:
Downloads, Accounts, Legal, Donate, Changelog, Diagnostics, Setup, Recovery, Live check,
Mail settings and System info, and the service hubs. The Settings "Look" group (Light and Dark) is also not ported: its rows say so.

Some screens are ported without their own animations checked against the web yet: Details,
Settings, Real-Debrid, the Live TV login and playlist screens, and the Live TV channel rails (the
`live-tv` scene in `shell.cpp`). They are real screens, not placeholders, so their layouts and copy
follow the web, but this file does not measure their motion.

## 7. Known layout differences

These are not animations, but they change how the screens look, so an animation match
alone will not make the two apps look the same:

- Home has the hero (section 5a), but not the brand lockup, the clock, the nav bar or the
  destinations row. Those sit between the hero and the shelves in the web app, so the rails
  start higher here.
- Text is single line and cut with an ellipsis. The old app measures and wraps text in
  the browser.
- Shadows are not drawn anywhere.
- The old app's "retired" themes (cinematic, synthwave, glass, anime, and so on) are not
  here. They are not the default, and the app's own registry no longer offers them.

## How this was checked

- The motion, focus and button values above were read from the old CSS and TypeScript
  files named in each row. The native tests check the numbers: `button_focus_tests`,
  the scene's focus tests in `ui_tests` (200 ms, 1.015 scale), and `hero_tests` (11 cases:
  the stage's height, the focus walk, the title dissolve, the picture crossfade, the scroll
  fade, and the two buttons), and `intro_tests` (20 cases: the timeline, the catalogue hold and
  its 2.8 s limit, skip, reduced motion, the picture's fade, the letters' order, the skip hint, both
  forms' tags and colours, the font weights, and the restart after a skip during a hold).
- On screen, the sting plays from the window's first frame: the bloom and rings come up, the flare
  sweeps, the letters and tag arrive in order, and the sting fades out over Home after 3.2 s. Enter
  ends it at once, and the fade takes 420 ms before Home is clean.
- The stream form was run on screen by clicking "Browse TVM Stream". Its frames show the blue glow,
  the word, the STREAM tag and the skip hint. The tag's ink runs from 608 to 666 px. The web's tag box
  runs from 607.4 to 672.6 px, and its trailing letter-spacing is about 4.8 px. The skip hint's ink ends
  at 1263 px, where the web's box ends at 1265.1 px less its trailing spacing.
- A copy was run on screen with a scratch data folder. The home and playlist screens
  were captured, and their colours, rings and buttons were compared with the values above.
- The side-by-side comparison of the old app's motion frame by frame has not been done.
  The old app is a web app, and its Home needs the core running to show rails.
