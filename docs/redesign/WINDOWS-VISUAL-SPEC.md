# TVM for Windows — Apple TV Glass Visual Specification

This specification binds the five tvOS 26 / Frutiger optical-glass studies (`01-hub-star-network.png` through `05-live-tv-guide.png`) and the architect decisions (`docs/redesign/DECISIONS.md`, `apps/roku/scripts/make-glass.mjs`) to the Windows native Win32 + Direct2D + DirectWrite renderer (`native/`).

---

## 1. Canvas, Scaling & Responsive Reflow

- **Reference Canvas:** `1920 × 1080` (`1rem = 16px`, `height / 67.5`).
- **Dynamic Scaling:** All tokens scale proportionally with `ViewportRem(width, height)` (`std::clamp(height / 67.5, floor, 32.0)`), maintaining legible ten-foot proportions at `1920×1080` and `1280×720` (where every font size remains `≥ 18px`) while reflowing cleanly into compact/portrait windows (`CompactViewport(width, height)` when `width < 64rem`).
- **Safe Insets:**
  - Ten-foot reference (`1920×1080`): `80px` (`5.0rem`) left/right, `60px` (`3.75rem`) top/bottom.
  - Compact viewport (`< 64rem` width): `40px` (`2.5rem`) left/right, `24px` (`1.5rem`) top/bottom so narrow desktop and portrait windows retain full horizontal room.
  - Full-bleed hero and backdrop artwork extends to the window edges (`0, 0, width, heroHeight`) behind the safe area.

---

## 2. Colour, Alpha & Optical Glass Tokens

One upper-left light source (`light = clamp(1 - (u * 0.42 + v * 0.58))`) drives every glass surface.

### Palette Tokens (Dark & Light)

| Token | Dark Theme (`Theme::Dark`) | Light Theme (`Theme::Light`) | Purpose |
|---|---|---|---|
| `background` | `#071018` (100%) | `#F4F1E4` (100%) | Scene ink ground |
| `backgroundDeep` | `#04080E` (100%) | `#EFE8D4` (100%) | Deep cinema / letterbox ground |
| `backgroundElevated` | `#0C1A2C` (100%) | `#FFFAF0` (100%) | Elevated fallback stage |
| `surface` | `#102238` (100%) | `#FFFDF6` (100%) | Opaque fallback / Reduced Transparency fill |
| `surfaceHover` | `#163048` (100%) | `#E7FFF6` (100%) | Opaque focused surface fill |
| `text` | `#F5F7FA` (100%) | `#12324A` (100%) | Primary warm-white / deep-slate ink |
| `textMuted` | `#B0C2D6` (82%) | `#2A5A68` (100%) | Secondary metadata & inactive nav labels |
| `textFaint` | `#748CA4` (68%) | `#4A7A82` (100%) | Captions, hints, subdued labels |
| `focusRing` | `#F5F8FC` (95%) | `#0EA884` (95%) | Specular focus rim highlight |
| `primary` | `#F5F7FA` (88%) | `#12324A` (92%) | Active tab / primary frosted pill fill |
| `onPrimary` | `#0B1118` (100%) | `#FFFDF6` (100%) | Dark ink on active tab / primary pill |

### Direct2D Glass Layer Stack (`Painter::Glass`)

From back to front, each `Glass(box, radius, GlassStyle)` call composites:

1. **Soft Drop Shadow:**
   - Offset: `+6px` (`0.375rem`) downward at 1080p (`12` Roku 3840-canvas units).
   - Footprint: `18px` (`1.125rem`) Gaussian spread (`36` canvas units), peak alpha `33%` black (`42%` when focused), rendered as concentric soft-feathered rounded silhouettes outside the panel.
2. **Outer Focus Halo (when `focused == true`):**
   - Footprint: `12px` (`0.75rem`) soft outer glow (`24` canvas units), peak alpha `30%` cool silver-white (`#E8F4FF` on dark, `#0EA884` on light).
3. **Sampled & Gaussian-Blurred Scene Backdrop:**
   - When transparency is enabled (`!reduceTransparency`) and a scene backdrop/hero bitmap is active, the region under `box` is sampled from a **cached Gaussian-blurred bitmap** (`CLSID_D2D1GaussianBlur` via `ID2D1DeviceContext`, `standardDeviation = 24.0f` at 1080p, `D2D1_GAUSSIANBLUR_OPTIMIZATION_SPEED`, border mode `D2D1_BORDER_MODE_HARD`), clipped to the rounded rectangle `(box, radius)`.
   - The blurred bitmap is keyed by `(backdropFile, target)` and computed **once per backdrop load**, never re-blurred per frame.
4. **Translucent Base Tint:**
   - Dark theme: `#142234` at `32%` alpha (resting pill/panel), `#1A2C42` at `44%` (focused), or `#F5F7FA` at `85%` frosted white when `activeTab == true`.
   - Light theme: `#FFFDF8` at `72%` alpha (resting), `#FFFFFF` at `86%` (focused).
   - **Reduce Transparency (`Performance mode`):** Uses an opaque ink fill (`tokens::kSurface` at rest, `tokens::kSurfaceHover` on focus, `tokens::kPrimary` on active tab) with contrast-safe rims and no backdrop blur sampling.
5. **Vertical Body Gradient:**
   - Top-to-bottom linear gradient inside `box`: `rgba(255, 255, 255, 0.16)` at `y = 0%` to `rgba(255, 255, 255, 0.03)` at `y = 100%`.
6. **Curved Specular Gloss (Upper 45%):**
   - Covers the upper `45%` of `box`, clipped to the rounded silhouette and a gently curved elliptical lower chord (`cx = box.x + 0.43 * box.width`, `ry = 0.45 * box.height`), fading vertically from `rgba(255, 255, 255, 0.26)` at the top edge to `rgba(255, 255, 255, 0.02)` at the 45% horizon.
7. **Bottom Inner Reflection:**
   - Subtle upward inner refraction along the lower `35%` of `box`: `rgba(255, 255, 255, 0.00)` at `65%` height to `rgba(255, 255, 255, 0.08)` at `100%` height.
8. **Thin Inner Dark Line:**
   - Inset by `1.5px` (`3` Roku canvas units), `1.0px` stroke width, `rgba(0, 0, 0, 0.18)`.
9. **Directional Specular Rim:**
   - `1.5px` stroke width (`2.0px` when focused) along a diagonal linear gradient from top-left `(box.x, box.y)` to bottom-right `(box.Right(), box.Bottom())`:
     - Resting: `rgba(255, 255, 255, 0.75)` top-left → `rgba(255, 255, 255, 0.15)` bottom-right.
     - Focused: `rgba(255, 255, 255, 0.95)` top-left → `rgba(255, 255, 255, 0.55)` bottom-right.

### Corner Radii (1080p Reference)

| Kind | 1080p Radius | Roku 3840 Units | Usage |
|---|---|---|---|
| Panel (`GlassKind::Panel`) | `28px` (`1.75rem`) | `56–80` | Inspector cards, Control Centre menus, modal surfaces |
| Pill (`GlassKind::Pill`) | `height / 2` (`26–36px`) | `72` | Hero Play/Details buttons, top nav capsule, action pills |
| Tab (`GlassKind::Tab`) | `height / 2` (`22–28px`) | `56` | Inner active/focused tab pills inside a capsule |
| Card (`GlassKind::Card`) | `18px` (`1.125rem`) | `36` | Poster cards, landscape Continue Watching cards, Settings rows |
| Orb (`GlassKind::Orb`) | `height / 2` (`26px`) | `52` | Top-right profile orb, circular icon controls |

---

## 3. Typography & Type Ramp

- **Font Family:** **Inter** (`Inter-Regular.otf`, `Inter-SemiBold.otf`, `Inter-Bold.otf`, SIL Open Font License 1.1) loaded privately from `native/assets/fonts/` via DirectWrite custom font collection when present, falling back to **Segoe UI Variable Display** and **Segoe UI**.
- **1080p Reference Ramp (1rem = 16px):**

| Role | 1080p Size | Rem Multiple | Weight | Minimum at 720p | Usage |
|---|---|---|---|---|---|
| **Hero Title** | `72px` | `4.50rem` | Bold (`700`) | `48px` | Home hero title (`The Last Light`), Details title |
| **Screen Title** | `48px` | `3.00rem` | Bold (`700`) | `32px` | Screen headers (`Settings`, `Watchlist`, `Live TV`) |
| **Primary Label** | `30px` | `1.875rem` | SemiBold (`600`) | `20px` | Rail headings (`Continue Watching`), section titles |
| **Secondary** | `24px` | `1.50rem` | Regular (`400`) / SemiBold (`600`) | `18px` | Nav strip items, pill button labels, Settings row titles |
| **Caption / Meta** | `22px` | `1.375rem` | Regular (`400`) | `18px` | Hero metadata line (`Movie · Drama · 2h 6m · 4K`), card captions |

---

## 4. States & Focus Treatment

There is **at most one focused element at a time** across the entire active screen. States are visually unmistakable:

1. **Focused:**
   - **Pills & Nav items:** scale `1.06`, lift `-6px` (`-0.375rem`), directional rim raised to `95% → 55%` white, outer focus glow (`30%`), strengthened drop shadow (`42%`).
   - **Poster & Landscape Cards:** scale `1.04`, lift `-6px` (`-0.375rem`), crisp glass rim (`95% → 55%` white) around the artwork silhouette plus outer focus glow (`22–30%`).
2. **Active Tab (unfocused):**
   - Filled frosted pill (`85%` warm white `#F5F7FA` with dark ink `#0B1118`), no outer glow or focus scale.
   - When an active tab is *also* focused, it retains its frosted white fill and gains the `1.06` focus scale, `-6px` lift, and outer glow.
3. **Selected Item (focus moved to inspector/secondary pane):**
   - Soft translucent fill (`18%` white) + quiet blue-white rim (`45%` top-left → `15%` bottom-right), no scale or outer glow.
4. **Pressed:**
   - Scale `0.98` for `80ms` on activation.
5. **Disabled:**
   - `40%` opacity, skipped by directional focus traversal.

### Navigation & Hard Stops
- **No Wrapping:** Rails, lists, and top navigation capsules do **not** wrap around at their left or right edges. Pressing Left at index `0` or Right at index `count - 1` is a hard stop.
- **Input Parity:** Keyboard arrows, D-pad, mouse hover/click, mouse wheel (vertical page pan, Shift/Ctrl/horizontal wheel rail pan), and touch pan/tap all operate on the same hit boxes.

---

## 5. Motion & Accessibility

- **Focus Transition:** `150ms` ease-out (`cubic-bezier(0.2, 0.8, 0.2, 1)`). Logical focus updates immediately before the animation begins; mid-flight transitions are interruptible and retarget from the current interpolated value.
- **Panel & Camera Moves:** `220ms` (`180ms` for tab highlight slides).
- **Hero Crossfade:** `480ms` ease-out dissolve when cycling trending hero artwork every `8000ms`.
- **No Recurring Decorative Loops:** Glass materials are purely optical and stationary; they never pulse or shimmer on an idle loop.
- **Reduce Motion (`MotionPreference::Reduced` or `performanceMode`):**
  - Removes focus scale (`scale = 1.0`), vertical lift (`lift = 0px`), and camera/panel slide duration (`1ms` instant land) while preserving the high-contrast focus rim, outer glow, and focus order.
- **Reduce Transparency (`performanceMode`):**
  - Replaces translucent glass fills and blurred backdrop sampling with opaque surface ink (`tokens::kSurface` / `tokens::kSurfaceHover`) and contrast-safe rims.

---

## 6. Mapping the Visual Studies to Windows Screens

### Study 03 — Home (`native/src/ui/scene.*`, `native/src/platform/app.cpp`)
- **Top Chrome Bar:**
  - **Left:** Clean `TVM` wordmark at `(safeX, safeY)` in bold white type (`30px`, letter-spaced), no coloured square icon plate on Home.
  - **Centre:** Translucent glass navigation capsule (`GlassKind::Pill`, height `56px` at 1080p) containing six tabs: **Home · Movies · Series · Live TV · Library · Search**. The active tab (`Home`, `Movies`, or `Series`) wears the frosted white active-tab pill (`85%` white, dark ink); focused tabs wear the `1.06` glass focus treatment.
  - **Right:** Circular glass profile orb (`52×52px` at 1080p) at `(width - safeX - 52, safeY + 2)` displaying the active profile initial (or avatar), opening Profiles / Account.
- **Hero Stage (Upper ~58% of 1080p viewport):**
  - Full-bleed trending catalogue backdrop (or `asset:lighthouse.jpg` public-domain NOAA photograph when catalogue artwork is absent or loading), cover-fitted with focal point `(0.70, 0.20)`.
  - Predictable left and bottom dark ink scrims (`#071018` fading from `88%` on the left behind copy, and `100%` up from the bottom rail horizon).
  - **Headline:** `72px` Bold mixed-case title (`The Last Light`, never forced all-caps) in warm white (`#F5F7FA`), positioned in the left safe zone.
  - **Metadata Line:** `22px` Regular muted silver (`Movie · Drama · 2h 6m · 4K` or catalogue kind/year/genre/rating), `12px` below the title.
  - **Action Pills:** Side-by-side optical glass pills `20px` below the metadata line:
    - **Play** (`hero-play`, `184×56px` at 1080p): play triangle glyph + `Play` (`24px` SemiBold), prominent glass pill with luminous rim and `1.06` scale on focus.
    - **Details** (`hero-info`, `156×56px` at 1080p): `Details` (`24px` SemiBold), secondary glass pill to the right of Play (`16px` gap).
  - **Carousel Dots:** Subtle `6px` indicator dots below the action pills when multiple hero titles rotate.
- **Rails (Lower ~42% of 1080p viewport):**
  - **Continue Watching:** Horizontal rail of `16:9` landscape cards (`384×216px` at 1080p, `24px` gap, `18px` radius) with an inset bottom glass progress track (`4px` height, `16px` horizontal inset, `12px` above bottom edge) and clean artwork.
  - **Catalogue Poster Rails:** Portrait poster rails (`220×330px` at 1080p, `24px` gap, `18px` radius) with `1.04` focus scale, `-6px` lift, directional glass rim and outer glow.

### Study 02 — Player Overlay Chrome & Control Centre Menus (`native/src/ui/player_screen.*`)
- Top and bottom scrims frame the video without obscuring the centre.
- Transport controls (`Play/Pause`, `-10s`, `+10s`, `Mute`), header pills (`Back to browse`, `Download`, `Add/Remove`), `Back to live`, `Skip recap`, `Skip credits`, `Next Up` card, and pop-up track/quality/speed menus use `Painter::Glass` panels and pills with directional rims and curved upper-45% specular gloss.

### Study 04 & Details / Settings (`native/src/ui/details_screen.*`, `native/src/ui/settings_screen.*`)
- **Details Screen:** Full-bleed backdrop with left/bottom scrims, poster card with glass rim, `72px` title, metadata row, side-by-side glass action pills (`Play`, `Add to My List`, `Download`, `Back`), frosted active season tab pills, and glass episode rows.
- **Settings Screen:** Glass row surfaces (`GlassKind::Card`, `18px` radius) with directional rims, subtle body sheen, and crisp focus elevation (`focused` glass rim + outer glow) across dark and light themes.
