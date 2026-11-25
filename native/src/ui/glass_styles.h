#pragma once

// The Home navigation pill's Liquid Glass, as style presets, so every other control asks the glass for exactly what
// the pill asks for. PaintStreamChrome (scene.cpp) is the reference:
//   - the resting capsule is a Pill with no focus;
//   - the selected tab is a Tab with activeTab, its light plate;
//   - a hovered tab is a Tab with focusPlate, which brings the plate in by the hover amount and calms the rim.
// None of these sets `focused` with a full focus amount and no plate, the combination that draws the glow rings and the
// strong silver rim, which reads as metal on small controls. The glass itself (D2dPainter::Glass) is not changed.

#include "ui/painter.h"
#include "ui/theme.h"

namespace tvm::ui::glass {

// The resting capsule: clear glass with its soft rim.
inline GlassStyle NavCapsule(double opacity = 1.0) {
    GlassStyle style;
    style.kind = GlassKind::Pill;
    style.opacity = opacity;
    style.reduceTransparency = tokens::reduceTransparency;
    return style;
}

// A selected tab: the light plate the pill puts under the chosen tab.
inline GlassStyle NavSelected(double opacity = 1.0) {
    GlassStyle style;
    style.kind = GlassKind::Tab;
    style.activeTab = true;
    style.opacity = opacity;
    style.reduceTransparency = tokens::reduceTransparency;
    return style;
}

// A hovered or focused control: the pill's hover plate, coming in by `amount` (0 to 1).
inline GlassStyle NavHover(double amount, double opacity = 1.0, double sweep = -1.0) {
    GlassStyle style;
    style.kind = GlassKind::Tab;
    style.focused = amount > 0.0;
    style.focusAmount = amount;
    style.focusPlate = true;
    style.sweep = sweep;
    style.opacity = amount * opacity;
    style.reduceTransparency = tokens::reduceTransparency;
    return style;
}

// A floating Liquid Glass sheet/modal/dropdown panel with subtle surface tint and crisp rim.
inline GlassStyle SheetPanel(double opacity = 1.0, bool focused = false) {
    GlassStyle style;
    style.kind = GlassKind::Panel;
    style.focused = focused;
    style.focusAmount = focused ? 1.0 : 0.0;
    style.opacity = opacity;
    style.tint = tokens::kSurface;
    style.reduceTransparency = tokens::reduceTransparency;
    return style;
}

// A menu or popover: frosted Liquid Glass, so rows of text stay legible over any artwork while its colour still
// shows through.
inline GlassStyle MenuPanel(double opacity = 1.0) {
    GlassStyle style = SheetPanel(opacity);
    style.frosted = true;
    return style;
}

// The nav pill's hover glass for one control, field for field as PaintStreamChrome builds it for a hovered tab: the
// plate comes in by `emphasis`, a press squeezes it, and `sweep` (0 to 1, or -1) runs the light across it once.
inline GlassStyle NavTabHover(double emphasis, double press, double sweep, double opacity) {
    GlassStyle style;
    style.kind = GlassKind::Tab;
    style.focused = emphasis > 0.0;
    style.focusAmount = emphasis > 0.0 ? (emphasis > 1e-3 ? emphasis : 1e-3) : 0.0;
    style.pressAmount = press;
    style.focusPlate = true;
    style.sweep = sweep;
    style.opacity = opacity;
    style.reduceTransparency = tokens::reduceTransparency;
    style.ringColor = tokens::kFocusRing;
    return style;
}

// The nav pill's selected tab: its light plate, lit further by hover and squeezed by a press.
inline GlassStyle NavTabSelected(double emphasis, double press, double opacity) {
    GlassStyle style;
    style.kind = GlassKind::Tab;
    style.activeTab = true;
    style.focused = emphasis > 0.0;
    style.focusAmount = emphasis;
    style.pressAmount = press;
    style.opacity = opacity;
    style.reduceTransparency = tokens::reduceTransparency;
    style.ringColor = tokens::kFocusRing;
    return style;
}

// A nav tab label's colour: near-white at rest (brighter with hover), dark on the plate by `plated`.
inline Color NavLabel(double emphasis, double plated, double opacity = 1.0) {
    const double p = tokens::reduceTransparency ? 0.0 : (plated < 0.0 ? 0.0 : (plated > 1.0 ? 1.0 : plated));
    const Color resting = Mix(Mix(tokens::kTextMuted, tokens::kText, 0.55), tokens::kText, emphasis);
    Color ink = Mix(resting, tokens::kOnPrimary, p);
    ink.a *= opacity;
    return ink;
}

// The ink for a label on glass that may carry the light plate: white on clear glass, dark on the plate, eased by
// `plate` from 0 to 1, as the pill's tab labels turn dark when selected or hovered.
inline Color InkOnPlate(double plate, double opacity = 1.0) {
    (void)plate;
    Color ink = Rgb(0xFFFFFF, 0.95);
    ink.a *= opacity;
    return ink;
}

}  // namespace tvm::ui::glass
