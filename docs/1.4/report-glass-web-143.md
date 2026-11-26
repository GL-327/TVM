# Web Liquid Glass Rework (Spec Section 3.1) — TVM 1.4.3

## Summary of Changes by Brief / Spec Item

### 0. Lead Bug Note — `SelectionDroplet.tsx` initial mount & font-load measurement
- **Root cause:** `SelectionDroplet` is rendered as a child of the `<div ref={track}>` element in `Ribbon.tsx` and `GlassSegmented.tsx`. Because React commits child `useLayoutEffect` hooks before attaching parent fiber refs (`commitAttachRef`), `track.current` was `null` on initial mount and the effect exited early without measuring, leaving the active nav tab and segmented thumb at `opacity: 0` with dark active text over a dark track.
- **Fix (`apps/ui/src/components/SelectionDroplet.tsx`):**
  - Falls back to `thumb.current?.parentElement` whenever `track.current` is `null`.
  - Falls back to `[aria-pressed="true"], [aria-checked="true"], .glass-segment__option--active` and `getBoundingClientRect()` if `offsetWidth` is not yet populated, scheduling a `requestAnimationFrame` retry if initial layout width is 0.
  - Observes both `host` and all `[data-focus-id]` children via `ResizeObserver` plus a `MutationObserver` on `host`.
  - Hooks `document.fonts.ready` and the `loadingdone` event so tab/segment widths re-measure automatically once Geist webfonts finish loading.

### 1. Clarity (`polish.css`, `liquidGlass.css`, `liquidLens.ts`, `glass.ts`)
- **Chrome / controls / pills** (`.glass`, `.glass--chrome`, `.tvm-button--glass`, `.glass-segment`, `.player-frost`): `3 px` Gaussian diffusion (`blur(3px) saturate(165%) brightness(1.05)`).
- **Large sheets / cards / modals / menus** (`.glass--sheet`, `.glass--card`, `.search-pill__panel`, `.patch-notes__sheet`, `.trailer-sheet`, `.pin-sheet`, `.changelog-card`, `.polish-nav__menu`): `7 px` Gaussian diffusion (`blur(7px) saturate(165%) brightness(1.05)`), with a translucent middle wash (`rgba(12, 14, 20, 0.30)` over dark content, ramping to `0.44` over bright content) so refracted artwork remains clearly visible through the centre of sheets.

### 2. Edge Lensing on Every Glass Element (`liquidLens.ts`, `liquidLens.test.ts`)
- **Geometry (`lensGeometry`):** Convex rounded-rectangle bezel width `bevel = clamp(0.22 * min(w, h), min(5, half), min(18, half))` (~12–18 px on standard bars/panels, never exceeding 22% of the short side). Rim inward sample shift `amount = min(1.95 * bevel, 0.9 * half)`.
- **Refraction profile (`buildLensMap`):** Quarter-circle convex bezel slope `shift = amount * (1 - sqrt(1 - rimward^2))` with corner normal radius inflation (`1.25x`, after Kyant0's fit) so rounded corners bend smoothly without a 45° diagonal crease while the centre stays 1:1 flat (`shift = 0`).
- **Chromatic dispersion:** Sub-pixel 3-channel RGB `<feDisplacementMap>` dispersion (`±0.65 px`, capped at `min(0.65, 0.014 * scale)`, strictly `< 1 px`) recombined with `<feBlend mode="screen">`, followed by `<feColorMatrix type="saturate" values="1.65">` and `<feComponentTransfer>` (`slope="1.05"`).
- **Document-wide auto-lensing & batching (`ensureLiquidGlassRuntime`):**
  - Started automatically on startup via `applyTransparency()` in `appearance.ts` and `useLiquidLens()`.
  - Uses a `MutationObserver` + single shared `ResizeObserver` to attach SVG `backdrop-filter: url(#tvm-lens-N)` lenses to every `.glass`, `.tvm-button--glass`, `.glass-segment`, `.player-frost`, and `[data-glass-lens]` element in the DOM while excluding solid surfaces (`.polish-nav__capsule`, `.stats-card`, `.whats-new-release`, `.rd-card`, `.setup-card`, `.profile-editor`).
  - Displacement PNG data URLs are cached in an LRU map (`MAX_CACHE_ENTRIES = 64`) keyed by `${width}x${height}r${radius}` and never regenerated per frame.
  - All layout reads (`offsetWidth`, `offsetHeight`, `getComputedStyle(el).borderTopLeftRadius`) are batched into Phase 1 of a single `requestAnimationFrame` flush before Phase 2 writes SVG filter attributes, preventing layout thrash.
  - Safari / WKWebView / iOS / Firefox cleanly fall back (`lensSupported() === false`) to CSS `backdrop-filter: blur(...) saturate(165%) brightness(1.05)` + the specular rim.

### 3. Specular Rim (`polish.css`, `liquidGlass.css`)
- **Crisp 1 px directional highlight:** Rendered via a `::before` `1px` `mask-composite: exclude` rounded border with a `135deg` linear gradient:
  - Upper-left light-facing edge: `rgba(255, 255, 255, 0.75)` (`75%` white)
  - Perimeter mid-stops (`38%–64%`): `rgba(255, 255, 255, 0.15)` (`15%` white)
  - Lower-right counter-highlight (`100%`): `rgba(255, 255, 255, 0.35)` (`35%` white)
  - Reinforced by directional inset `box-shadow` stops in `--tvm-material-rim`.
- **Soft top inner glow:** `linear-gradient(180deg, rgba(255, 255, 255, 0.065) 0%, rgba(255, 255, 255, 0.015) 18%, transparent 30%)` (`6.5%` white over the top `30%`).
- **iOS 27 1 px dark outer contour:** `0 0 0 1px rgba(0, 0, 0, 0.23)` (`23%` black).

### 4. Adaptive Tint & Legibility (`glass.ts`, `glass.test.ts`, `liquidLens.ts`)
- **Backdrop sampling:** `liquidLens.ts` watches active hero/stage/details artwork (`img.stage__art`, `.spotlight__media img`, `.details__stage img`, `.details__backdrop img`, `.ambient-backdrop img`, or `[data-backdrop-luma]`) once per artwork change, downscales onto a `16x16` offscreen `<canvas>`, and measures interior perceptual luminance via `sampleRgbaLuminance()` (matching `GlassLens::Measure` in `native/src/platform/glass_lens.cpp`).
- **Adaptive tint solver (`computeAdaptiveGlassTint`):**
  - Brightness ramp: `bright = clamp((luminance - 0.26) / 0.42, 0, 1)`.
  - Over dark content (`luminance <= 0.26`, `bright = 0`): `5%` white tint (`rgba(255, 255, 255, 0.05)`), text `#F5F7FA`.
  - Over bright content (`luminance >= 0.68`, `bright = 1`): `20%` black tint (`rgba(0, 0, 0, 0.20)`), crisp white text `#FFFFFF`, maintaining WCAG 2.1 contrast `>= 4.5:1` across the entire `[0, 1]` luminance range.

### 5. Soft Shadow (`polish.css`, `liquidGlass.css`)
- Standard glass panels, bars, and nav capsule: `--tvm-material-shadow: 0 10px 30px rgba(0, 0, 0, 0.30)`.
- Smaller controls (`.tvm-button--sm`, `.tvm-button--quiet`, `.back-btn`, `.glass-segment`): `--tvm-material-shadow-sm: 0 4px 14px rgba(0, 0, 0, 0.24)`.
- Hovered / focused lift shadow: `--tvm-material-shadow-lift: 0 14px 34px rgba(0, 0, 0, 0.38)`.

### 6. Reactions, Nav Capsule, Reduce Transparency, & Light Theme (`polish.css`, `FocusButton.css`, `SelectionDroplet.tsx`, `appearance.ts`)
- **Hover / focus:** Lifts `2 px` (`transform: translateY(-2px)`) and brightens the specular rim by `~20%` (`--tvm-rim-ul: rgba(255, 255, 255, 0.90)`, `--tvm-rim-mid: rgba(255, 255, 255, 0.22)`, `--tvm-rim-lr: rgba(255, 255, 255, 0.44)`).
- **Desktop pointer-following specular bloom:** Delegated passive `pointermove` listener updates `--glass-x` and `--glass-y` in `requestAnimationFrame` for a `120 px` radial `10%` white bloom (`radial-gradient(120px circle at var(--glass-x, 16%) var(--glass-y, 0%), rgba(255, 255, 255, 0.10), transparent 100%)`).
- **Press & spring back:** `:active` scales to `0.97` and springs back with `--tvm-spring-snappy: cubic-bezier(0.22, 1.24, 0.36, 1)` (`240 ms`, matching stiffness `420`, damping `32`).
- **Liquid droplet selection indicators (`SelectionDroplet.tsx`):** Springs to the newly selected tab/segment over `380 ms`, stretching up to `1.25x` (`scaleX(1.15..1.25) scaleY(0.93)` at offset `0.40`), settling with slight spring overshoot (`scaleX(0.985) scaleY(1.01)` at offset `0.78`), or cross-fading (`150 ms`) when reduced motion is active.
- **Solid navigation capsule (spec 3.3):** `.polish-nav__capsule` stays opaque `#12141A` at `94%` (`backdrop-filter: none`, excluded from SVG lensing) with the full 3.1 specular rim (`::before` + `1 px` outer dark contour) and `0 10px 30px rgba(0,0,0,0.30)` shadow; selected tab droplet is solid light `rgba(245, 247, 250, 0.92)` with near-black text `#0E1015`.
- **Reduce transparency (`html[data-transparency="reduced"]`):** Swaps every glass surface for solid `--tvm-surface` / `--tvm-surface-2` while preserving the specular rim and drop shadow, and detaches all SVG `backdrop-filter` lenses. Legacy `tvm.glass` storage keys are silently migrated and removed.
- **Light theme (`html[data-theme="light"]`):** Tuned light-mode glass tokens, white segmented/nav droplets with `#12324A` ink, and high-contrast slate tracks (`rgba(18, 50, 74, 0.20)`) for unchecked switches.

---

## Exact Recipe (Numbers for Windows / Cross-Platform Parity)

| Parameter | Token / Constant | Exact Value |
|---|---|---|
| Chrome / control blur | `GLASS_RECIPE.chromeBlurPx` | `3 px` (`stdDeviation="3"`) |
| Sheet / panel blur | `GLASS_RECIPE.sheetBlurPx` | `7 px` (`stdDeviation="7"`) |
| Vibrancy saturation | `GLASS_RECIPE.saturate` | `1.65` (`165%`) |
| Luminance lift | `GLASS_RECIPE.brightnessLift` | `1.05` |
| Convex bezel width | `bevel` | `clamp(0.22 * min(w, h), 5 px, 18 px)` (`0.44 * half`, max `22%` of short side) |
| Rim inward shift | `amount` | `min(1.95 * bevel, 0.90 * half)` (`scale = 2 * amount`) |
| Bezel slope profile | `shift(depth)` | `amount * (1 - sqrt(1 - (1 - depth / bevel)^2))` |
| Corner normal radius | `nr` | `min(half, max(1.25 * r, r + 2))` |
| Chromatic dispersion | `dispersion` | `min(0.65 px, max(0.25 px, 0.014 * scale))` (`R: +disp`, `G: 0`, `B: -disp`) |
| Rim highlight (upper-left) | `--tvm-rim-ul` | `rgba(255, 255, 255, 0.75)` (`0.90` on hover/focus, `+20%`) |
| Rim highlight (perimeter) | `--tvm-rim-mid` | `rgba(255, 255, 255, 0.15)` (`0.22` on hover/focus) |
| Rim counter-highlight (lower-right) | `--tvm-rim-lr` | `rgba(255, 255, 255, 0.35)` (`0.44` on hover/focus) |
| Top inner glow | `--tvm-top-glow` | `rgba(255, 255, 255, 0.065)` from `0%` to `30%` height |
| Outer dark contour | `--tvm-contour-outer` | `1 px` `rgba(0, 0, 0, 0.23)` |
| Adaptive brightness ramp | `bright` | `clamp((luma - 0.26) / 0.42, 0, 1)` |
| Dark-backdrop white tint | `lightTintAlpha` | `0.05 * (1 - bright)` (max `5%` white) |
| Bright-backdrop black tint | `darkTintAlpha` | `0.20 * bright` (max `20%` black) |
| Standard soft shadow | `--tvm-material-shadow` | `0 10px 30px rgba(0, 0, 0, 0.30)` |
| Small control shadow | `--tvm-material-shadow-sm` | `0 4px 14px rgba(0, 0, 0, 0.24)` |
| Hover / focus lift | `hoverLiftPx` | `translateY(-2px)` |
| Desktop pointer bloom | `bloomRadiusPx` / `bloomWhiteAlpha` | `120 px` radial `rgba(255, 255, 255, 0.10)` |
| Press scale & spring | `pressScale` / `420/32` | `scale(0.97)`, `240 ms cubic-bezier(0.22, 1.24, 0.36, 1)` |
| Droplet stretch & duration | `dropletMaxStretch` | `scaleX(1.15..1.25) scaleY(0.93)` at `40%`, `380 ms cubic-bezier(0.22, 0.8, 0.23, 1)` |
| Nav capsule fill | `navCapsuleSurfaceAlpha` | `#12141A` at `94%` (`100%` in Reduce Transparency), solid (`backdrop-filter: none`) |
| Nav selected droplet | `navSelectedWhiteAlpha` | `rgba(245, 247, 250, 0.92)`, ink `#0E1015` |

---

## Screenshots Taken

Playwright script: `C:\Users\Arthur\AppData\Local\Temp\claude\2302de94b50b8355\205cf4a8-a79c-4642-9221-581a32ff3a89\scratchpad\gemini\capture-glass.mjs`
Output directory: `C:\Users\Arthur\AppData\Local\Temp\claude\2302de94b50b8355\205cf4a8-a79c-4642-9221-581a32ff3a89\scratchpad\shots\glass\`

- **Home (dark & bright artwork; 1920×1080, 1280×720, 390×844):**
  - `home-dark-art-1920x1080.png`, `home-dark-art-1280x720.png`, `home-dark-art-390x844.png`
  - `home-bright-art-1920x1080.png`, `home-bright-art-1280x720.png`, `home-bright-art-390x844.png`
- **Search modal glass sheet (dark & bright artwork; 1920×1080, 1280×720, 390×844):**
  - `search-modal-dark-art-1920x1080.png`, `search-modal-dark-art-1280x720.png`, `search-modal-dark-art-390x844.png`
  - `search-modal-bright-art-1920x1080.png`, `search-modal-bright-art-1280x720.png`, `search-modal-bright-art-390x844.png`
- **Details screen (dark & bright artwork; 1920×1080, 1280×720, 390×844):**
  - `details-dark-art-1920x1080.png`, `details-dark-art-1280x720.png`, `details-dark-art-390x844.png`
  - `details-bright-art-1920x1080.png`, `details-bright-art-1280x720.png`, `details-bright-art-390x844.png`
- **Player chrome overlay (1920×1080, 1280×720, 390×844):**
  - `player-chrome-1920x1080.png`, `player-chrome-1280x720.png`, `player-chrome-390x844.png`
- **Settings Appearance category (Dark, Light, and Reduce Transparency; 1920×1080, 1280×720, 390×844):**
  - `settings-appearance-1920x1080.png`, `settings-appearance-1280x720.png`, `settings-appearance-390x844.png`
  - `settings-light-1920x1080.png`
  - `settings-reduced-transparency-1920x1080.png`

---

## Checks Run and Results

All run from `C:\Users\Arthur\Desktop\TVM\apps\ui`:
1. `corepack pnpm run typecheck` (`tsc -p tsconfig.json --noEmit`): **PASS** (0 errors).
2. `corepack pnpm exec vitest run`: **PASS** (92 test files passed, including new `src/theme/glass.test.ts`, `src/theme/appearance.test.ts`, and expanded `src/components/liquidLens.test.ts`).
3. `corepack pnpm run build`: **PASS** (`built in 3.43s`).

---

## Files Touched / Created

- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\components\SelectionDroplet.tsx`
- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\components\liquidLens.ts`
- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\components\liquidLens.test.ts`
- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\components\FocusButton.css`
- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\theme\glass.ts`
- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\theme\glass.test.ts` (new)
- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\theme\appearance.ts`
- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\theme\appearance.test.ts` (new)
- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\theme\liquidGlass.css`
- `C:\Users\Arthur\Desktop\TVM\apps\ui\src\theme\polish.css`
- `C:\Users\Arthur\Desktop\TVM\docs\1.4\report-glass-web-143.md` (new)

---

## What Is Not Done / Notes for Lead Integration

- No files under `apps/ui/src/screens/*` were touched (per brief ownership rules).
- Because `ensureLiquidGlassRuntime()` auto-discovers `.glass`, `.tvm-button--glass`, `.glass-segment`, `.player-frost`, and `[data-glass-lens]` via a document-level `MutationObserver`, existing and newly added screen components automatically receive SVG edge-lensing, desktop pointer specular bloom, and adaptive backdrop tinting without requiring manual `useLiquidLens()` hooks in screen files.
- If any new custom screen control does not carry `.glass` or `.tvm-button--glass` and wants SVG edge refraction, adding `data-glass-lens` (or `className="glass"`) will opt it in automatically; adding `data-glass-solid="true"` opts a `.glass` element out of lensing.
