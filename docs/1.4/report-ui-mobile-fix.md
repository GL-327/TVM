# ui-mobile-fix

Causes and fixes (all in apps/ui):
1. Search and Settings taps timed out: the 1.4 patch-notes modal (.panel-scrim, aria-modal) opened on first launch in every automated run (remote flag true) and covered the whole UI. Fix: PatchNotesPopup.tsx uses the corner card (non-blocking) when shouldSkipIntro() is true (?e2e=1 or WebDriver), same rule as the intro. Real users still get the modal once.
2. 5-tab bar had 6 buttons: the spyglass sat inside .ribbon__list. Fix: Ribbon.tsx (usePhoneShell) moves Search to the top-right icon group on phones; desktop keeps it in the capsule (spec 3.3). polish.css: phone tabs and icon buttons are 44 px (were 36/40), also under html.phone-shell at wide widths.
3. Vertical pan on rails dead: new `.rail` (overflow visible, padding + negative margins) has scrollHeight > clientHeight, so nearestScrollable() chose .rail as the page and scrolled it instead of .home. Fix: pointerInput.ts nearestScrollable skips overflow: visible boxes.
4. responsive.spec (desktop and Android) failed: Settings was redesigned into categories and Theme was a <select> with no theme-light id. Fix: Theme is now a segmented control (spec 3.4, 2 options) keeping ids theme-light/theme-dark; responsive.spec.ts now opens the Appearance category first (spec section 8 intends categories). e2e/navigation.spec.ts also expects theme ids on the Settings landing page and was not touched or run.

Results: playwright mobile.spec.ts + responsive.spec.ts 21/21 pass; vitest 518/518; build succeeds.
