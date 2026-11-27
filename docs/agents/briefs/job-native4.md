Job: NATIVE4, the TVM 1.4.11 Windows catch-up. Repo: C:\Users\Gathe\Desktop\TVM, branch main. Read CLAUDE.md, HANDOFF.md and docs/1.4/spec.md first.

Context:
- The owner uses the Windows app. It is the native C++ client in native/, not the React UI in apps/ui.
- Every 1.4.6-1.4.9 visual change was React-only: the Hub page, the artwork-led cozy Movies/Series, two-line titles, the Settings Back fix, the franchise intros, the trailer and the developer tools. So the owner saw "no changes at all" in the app, while its size doubled; the 15 MB trailer MP4 and the fonts are bundled in the UI payload.

Deliver on Windows native, in priority order. Keep the build green after each step: `powershell -NoProfile -ExecutionPolicy Bypass -File native/build.ps1` (all tests).
1. **Version number shown clearly** at the top of Settings, e.g. "TVM 1.4.11 · build <commit>", with the engine version under it. Do the same on React Settings > About in apps/ui.
2. **Emergency manual update button** in Settings, called "Update now". It forces the window update (native/update-native.ps1 path) and the Core update (POST /api/update/check, then /api/update/apply, then wait for the Core restart, as in CatchUpCore in native/src/platform/core_host.cpp), showing progress and the result. React gets an equivalent button that calls the Core update API.
3. **Hub page** on Windows, matching the React Hub (apps/ui/src/screens/Hub.tsx): a greeting, Continue Watching, apps and services, six free live channels, and quick links. It opens first after sign-in.
4. **Cozy, artwork-led Movies/Series** like the React version (apps/ui/src/theme/browse.css, components/BrowseAmbience.tsx): a Featured landscape shelf, the backdrop of the focused title fading in behind the rows, two-line titles with an ellipsis, and clean edge arrows.
5. **Franchise intros on Windows.** The content file is packages/content/intros.json and the React version is apps/ui/src/intros. Draw the Hunger Games ember and Mockingjay intro and the Doomsday green mask intro with Direct2D over the player's loading phase. They are skippable and have an Extras switch.
6. **PyGlass-style Liquid Glass and a complex background.**
   - The owner's reference is https://github.com/neomosh8/pyglass: a bevelled rim that strongly refracts and disperses (chromatic split) what is behind, a clear middle and a crisp specular rim.
   - native/src/platform/glass_lens.cpp already follows PyGlass. Tune it to match the reference screenshot: stronger bevel refraction, visible RGB dispersion at the rim, a brighter rim, and less tint.
   - Add a fitting, rich backdrop for glass to refract, so the glass reads: flowing layered 3D ribbons/waves in the style of the Windows 11 "bloom" wallpaper, in TVM's deep blues and violets. Show it slowly animated, or as a high-res precomputed image with a slow drift, behind Settings, the Hub and dialogs. Keep it at 60 fps.
   - Do the same for the React UI glass (apps/ui/src/theme/glass.ts, liquidGlass.css) with an equivalent CSS/canvas backdrop.

Before release:
- Make sure the React tests still pass: in apps/ui, `npx vitest run`, `corepack pnpm run build`, and `corepack pnpm exec playwright test navigation.spec.ts mobile.spec.ts responsive.spec.ts --reporter=line` (all 48). Also `cd apps/core && npx vitest run`.
- Take native snapshots of Settings (with the version and Update now), the Hub, Home and a glass dialog over the new backdrop, under <scratch>/shots/native4/. Look at them.

Release, only when everything above passes:
- Bump to 1.4.11. Use the version-bump pattern in <scratch>/bump-1.4.10.mjs, and also set build_version in apps/roku/manifest.
- Add a 1.4.11 entry to packages/content/changelog.json following CHANGELOG-RULES.md, copy it to the three app copies, and check with `node scripts/check-changelog.mjs`.
- Update HANDOFF.md.
- Commit as `git -c user.name=GL327 -c user.email=257561906+GL-327@users.noreply.github.com commit` with NO Co-Authored-By lines, then push to main.
- If a numbered item is unfinished when your usage runs low, ship the finished items (keep everything green), list the rest in HANDOFF.md, and push.

Report to <scratch>/reports/native4.md.

Owner's rule, added later, and the most important: the Windows EXE is the MAIN way people use TVM; treat it as sacred.
- Windows and the React desktop/web app must be on EQUAL terms: every feature and visual the React app has, Windows must have too, with the same quality.
- After items 1-6, audit apps/ui/src/screens and components against native/src/ui and add whatever Windows is still missing:
  - developer tools
  - the trailer in Settings > About (play it with the existing mpv player)
  - the stats overlay
  - the version picker
  - extras switches
  - the patch-notes pop-up
- Never break the EXE. Build and run the full native tests after every change, and leave it working if you run out of time.
