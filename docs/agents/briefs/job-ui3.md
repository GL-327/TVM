Job: UI3, a welcoming streaming experience for TVM 1.4.8. Repo: C:\Users\Gathe\Desktop\TVM. You own ONLY apps/ui/**. The UI serves web, desktop and the phone web views. Another engineer is editing apps/core right now.

The owner tested 1.4.7 in Chrome and said: "it still doesn't look very good as a whole and looks like a shitty movie database". They want it "welcoming and cozy... professional and not bland". Fix it all, with high quality, as fast as you can.

1. A NEW Hub page before Home, acting as the app's front door:
   - a warm welcome ("Good evening, <name>")
   - Continue watching
   - tiles for the supported apps and streaming services (see packages/content/services.json and the existing Apps/Service screens)
   - a strip of a few popular free live TV channels that play with one click (packages/content/free-channels.json and the live endpoints)
   - quick links into Movies, Series, Live TV and Search
   It must look premium, with big imagery and soft depth. Home (Movies & Series) stays one click away, and the nav highlights where you are.
2. Make Home, Movies and Series feel cinematic and cozy, not like a database:
   - a big hero with backdrop art
   - artwork-led rows: a landscape "Featured" row using backdrops, and posters elsewhere
   - generous spacing and fewer labels, chips and borders
   - the page background warmly takes on the focused title's backdrop and colours, like Apple TV, crossfading
   - row entrance and focus animations using transform/opacity only
   Keep the 1.3.2 glass as it is now (apps/ui/src/theme/glass.ts and liquidGlass.css), but use it with restraint.
3. Bugs to fix:
   - Text is cut off: long poster titles such as "The Hunger Games: Sunrise on the Reaping" wrap to 3 lines and are hidden under the next row's header. Clamp to 2 lines with an ellipsis, reserve the height, and show the full title in the focused card's caption or a tooltip.
   - The Settings Back button covers the "Settings" title, and its label does not show on hover. Fix both: the button sits beside the title, and on hover or focus it expands to show "Back".
   - The rail arrow button (the round "<" over the first card) looks like a stray blob. Make the rail arrows clean glass chevrons at the row edges, visible on row hover only.
   - The mouse pointer sometimes disappears, especially on Live TV. Find the cursor-hiding code (it should only hide the cursor while a video plays fullscreen and the mouse is idle) and fix every place it leaks.
   - "All the cool features we added, like the Jellyfin plugins, are all gone or don't seem to work." Check that every extra is visible and works in the UI when its endpoint answers:
     - skip intro/recap/credits buttons, up next, the subtitles menu, the trailer button and backdrops, the collection row, coming up, Your stats, the anime title, ratings and quality badges, the version picker, surprise me, sleep timer, night mode, chapters, shortcuts and the franchise intros
     - the Settings > Extras switches must actually toggle them
     - Core's report at <scratch>/reports/core3.md, if it exists by then, lists what each endpoint returns
4. Performance must stay smooth (60 fps hover and scroll on a GPU). Read reports/hover-lag.md in the same folder:
   - no `:has()` hover rules
   - no React re-render of rows on hover
   - transform/opacity only
   - no layer per card
5. Verify:
   - `npx vitest run`, the apps/ui typecheck and `corepack pnpm run build`
   - `corepack pnpm exec playwright test navigation.spec.ts mobile.spec.ts responsive.spec.ts --reporter=line`: all must pass, including the 768x1024 tablet case. Update tests only for the intended new Hub flow, and list each one.
   - Screenshots at 1920x1080, 1280x720 and 390x844 of Hub, Home, a focused card, Settings and Live TV, under <scratch>/shots/ui3/. Look at them, and iterate until it looks like a premium streaming app.

Report to <scratch>/reports/ui3.md.
