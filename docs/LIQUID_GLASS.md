# Liquid Glass rules (Windows C++ app)

These are the owner's standing rules for TVM's Liquid Glass in the native Windows app (`native/`). A themes update
must keep every one of them. If a rule has to change, the owner decides, not the person doing the theme.

## 1. The glass itself is not edited

- **Leave the renderer alone.** Do not edit the renderer while restyling: `D2dPainter::Glass`, its `Stops`/gradient cache (`native/src/platform/d2d_painter.cpp`) and the lens (`native/src/platform/glass_lens.*`: refraction, rim, dispersion, contour).
- **Change looks through styles.** A control's look changes only through the `GlassStyle` its caller passes (`native/src/ui/painter.h`).
- **Use the presets.** All presets live in one file, `native/src/ui/glass_styles.h`. Use them instead of building a `GlassStyle` by hand, so a theme changes them in one place:

| Preset | What it is | Used by |
| --- | --- | --- |
| `NavCapsule()` | The nav pill's resting capsule: clear glass, unfocused | Dropdown anchors, the season menu, rail arrows |
| `NavSelected()` | The selected tab's light plate (dark label) | Selected rows and tabs |
| `NavHover(amount)` | A plate fading in by `amount` | Settings rows and dropdown rows |
| `NavTabHover(...)` / `NavTabSelected(...)` | The nav pill's own hover and selected tab, field for field | Nav-style tabs |
| `ButtonGlass(focus, focused, press, opacity, ring…)` | The Details buttons' glass ("Add to My List", "Trailer"): clear refracting glass, rim, focus ring, adaptive ink | `DrawButton`, and the player's controls on hover |
| `SheetPanel()` / `MenuPanel()` | Frosted sheets and menus | Sheets, dialogs, popovers |

## 2. Real glass, never a flat fill

- **The nav pill.** The navigation capsule (Hub · Home · Movies · Series · Live TV · Library · search) is real, refracting glass: `GlassKind::Pill` with no `solid` and no tint. It is opaque only when Reduce Transparency is on. (1.4.0 made it a 97% solid fill by mistake; that was undone.)
- **When `solid` is allowed.** Only for primary buttons that are meant to be filled (Play / "Watch the saga" in the accent colour), and for Reduce Transparency.
- **No metallic look.** Never pass `focused = true` with a full `focusAmount` and no plate on a small control; it draws the strong silver rim. Use `NavHover`, `NavTabHover` or `ButtonGlass`.
- **No hand-drawn imitations.** Glass is never faked with a dark rectangle and an outline. If a control "looks like a box with an outline", it is on the wrong preset.

## 3. Where glass appears

- **Navigation bar.**
  - The capsule is always shown, on every lane, including Live TV: the guide sits under it.
  - The selected tab gets the light plate with a dark label.
  - A hovered tab gets the hover plate, a slight grow (×1.04), one light sweep across it (90 ms delay, 850 ms) and a press squeeze (70 ms in, 240 ms out).
  - Labels off the plate carry a soft two-layer shadow so they read over bright skies.
- **Player controls** (mute, CC, Audio, Quality, Speed, full screen).
  - At rest there is no glass, only icons and labels over the bottom scrim.
  - On hover or focus they show `ButtonGlass` (the Details buttons' glass): a small lift, a 3% press squeeze, the focus ring, and ink that adapts to what shows through.
  - A tool whose menu is open stays lit.
  - Shapes are rounded squares: mute and full screen use 2.5rem squares with a 0.6rem radius; tools use a 0.55rem radius.
- **Details page.**
  - Buttons use `DrawButton` (`ButtonGlass`).
  - The back arrow is just a thick arrow with a soft shadow. There is no circle, pill or glass behind it.
- **Posters and cards.**
  - They use `GlassKind::Card` with `rimOnly` when they have artwork, so the picture shows through.
  - **The poster hover animation is fixed:** ×1.04 from the foot, a 0.375rem lift and the ring. Do not change its scale, lift or timing.
  - Rows leave room above themselves for that rise, so a hovered card never covers its heading or gets its top cut off.
- **Never put glass on every card.** Glass is for chrome: the nav, profile and search buttons, player controls, sheets, dialogs and hero buttons.

## 4. Backgrounds behind the glass

- **The Bloom ribbon stage.** It shows only on the Hub and on the full profile chooser. It does not show behind the profile-icon dropdown, Settings, Downloads or info pages.
- **Ribbons run off-screen.** They are traced past the window edges, so they never end in a cut edge.
- **The hero crossfades into the page** (`Painter::PushLinearOpacity`). It never ends on a solid band or a hard horizontal line.
- **Glows are soft.** A radial glow (such as the one under the hero Play button) is filled over its whole oval, so it never shows a square cut.
- **What glass can't see through.** Glass refracts what was drawn under it. It can't see video in mpv's separate window, and it doesn't capture inside clips or opacity layers, where it falls back to a wash. So don't put glass inside `PushOpacity`/`PushLinearOpacity`/`PushClip` unless that fallback is intended.

## 5. Modes

- **Clear (default).** Refracting glass with a rim, a specular glint, and a brightness-adaptive veil.
- **Frosted** (Settings > Look). The same glass, with the picture scattered first.
- **Reduce Transparency.** Opaque fills and a contrast-safe rim. No refraction anywhere.
- **Reduce Motion.** No sweep, no grow, no lift, and no drift in the hero or ribbons.

## 6. Before changing anything glass-related

1. Use or extend a preset in `glass_styles.h`; don't hand-build a style in a screen.
2. Keep the `D2dPainter::Glass`, `Stops` and `glass_lens.*` diff at zero.
3. Run the Windows CI (`.github/workflows/native.yml`). Look at the glass snapshots and frames, especially `page-player*`, `frames-card-hover`, the nav bar over bright art, and the hero foot.
4. Check Clear, Frosted and Reduce Transparency.
