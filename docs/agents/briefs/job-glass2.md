Job: GLASS2, real iOS 26/27 Liquid Glass and a premium streaming look for TVM's React UI. Repo: C:\Users\Gathe\Desktop\TVM. You own ONLY apps/ui/**. This UI runs on web, desktop and the iPhone and Android web views.

The owner's words: "it still just doesn't look good. Research iOS 26-27 liquid glass and mimic it perfectly, but also achieve that nice streaming service look, and make it look less generic and sloppy." Earlier passes looked "AI generated". Your result must look hand-crafted, like Apple TV+ or the iOS 26 TV app, not a template.

1. Research first, with web search, and cite your sources in the report.
   - Apple's Liquid Glass (WWDC25 "Meet Liquid Glass" and "Get to know the new design system", the HIG Materials page, the iOS 26 and iOS 27 changes).
   - The best web reproductions:
     - the kube.io article on refraction with SVG feDisplacementMap from a convex squircle surface plus a specular rim
     - rdev/liquid-glass-react
     - other well-regarded CSS/SVG write-ups
   - The streaming apps' visual language: Apple TV app (tvOS/iOS 26), Netflix, Max, Disney+. Cover hero composition, title treatments, row headers, card sizes, spacing, typography and motion.
   - Also read <scratch>/research-liquid-glass.md (earlier notes) and docs/1.4/spec.md sections 3 and 4.
2. Liquid Glass. Rebuild apps/ui/src/theme/glass.ts, liquidLens.ts and liquidGlass.css (now the 1.3.2 version) to match iOS 26/27 closely:
   - a crisp, almost clear centre
   - real edge refraction: an SVG displacement map generated once per size from a squircle bezel, used as a backdrop filter where Chromium supports it
   - a bright specular rim lit from the top left with a weaker counter-highlight
   - the iOS 27 darker edge contour
   - a slight saturation lift
   - tint that adapts to the brightness behind it, so text stays legible
   - press and hover springs
   - a liquid "droplet" selection indicator that stretches between nav items
   - a high-quality fallback on WebKit/Safari, which has no SVG backdrop filters
   Apply real glass only to chrome: the nav capsule, the profile and search buttons, player controls, sheets and dialogs, and hero buttons. Never apply it to every card.
3. Streaming look.
   - Home hero: full-bleed art or the trailer clip, a strong title logo, one line of copy, a quiet meta line (no row of generic pills), and a primary button plus one secondary button. Surprise me moves elsewhere.
   - Proper gradients so the hero melts into the page.
   - Fix the bug where a light strip of the hero image shows below the hero.
   - Rows: clean headers, consistent card sizes and gaps, refined hover/focus (scale, shadow, ring), titles under posters handled tastefully.
   - Spacing, typography (Geist) and colour must be consistent everywhere.
   - Remove anything that looks generic or sloppy. Keep every feature working (Settings, guide, sync, patch notes, version picker, FPS switch).
4. Performance on real GPUs. The owner found it unusably laggy.
   - Use Chromium WITH GPU (headed, or headless with GPU flags; this PC has an RTX 5070) through playwright-core, against the production build (`corepack pnpm run build`, then `corepack pnpm exec vite preview --port 5180`).
   - Measure FPS while idle, while scrolling rails and while hovering cards, using the FPS overlay or rAF, plus long tasks.
   - Targets: 60 fps idle and while scrolling, with no long tasks during scroll.
   - Keep displacement maps cached, limit the number of live backdrop filters, pause off-screen animation, and avoid a layer per card.
5. Verify:
   - `npx vitest run`, typecheck (apps/ui) and build
   - `corepack pnpm exec playwright test navigation.spec.ts mobile.spec.ts responsive.spec.ts --reporter=line`: all 48 must pass; update a test only for intended visual changes, and list each one
6. Screenshots at 1920x1080, 1280x720 and 390x844 of:
   - Home
   - a hovered card
   - the nav with its droplet between two items
   - a glass button over bright art and over dark art
   - Settings
   - the player controls

   Save them under <scratch>/shots/glass2/. Compare them side by side with reference images of iOS 26 glass from your research, and iterate until they are genuinely close.

Report to <scratch>/reports/glass2.md:
- the research summary with links
- what you built
- the FPS numbers before and after
- the tests
- every file you changed

Owner's latest feedback, added at 19:45 UTC. It matters most:
- "It looks more like a database than a cool streaming service."
  - Fix the overall feel, not just the glass:
    - cinematic, full-bleed imagery
    - large artwork-led rows, with a landscape "featured" row and backdrop art on focus
    - a background that subtly takes on the focused title's backdrop and colours, as Apple TV does
    - fewer labels, chips and borders; more depth, light and motion
  - Use tasteful animations everywhere they help:
    - row entrance
    - focus and hover springs
    - hero crossfades between featured titles
    - page transitions
  - Every animation must run at 60 fps on a GPU.
- Lag: it was unusable when hovering or selecting cards in rows. A helper fixed that just before you start; read <scratch>/reports/hover-lag.md. Never regress it: hover and focus may only animate transform/opacity on the one card, with no React re-render of rails on hover, and the FPS during a card sweep must stay at 60.
- A helper added franchise intros (apps/ui/src/intros/**, packages/content/intros.json); keep them working, and keep their look consistent with yours.
