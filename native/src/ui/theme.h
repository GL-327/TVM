#pragma once

#include <string_view>

#include "ui/painter.h"

namespace tvm::ui {

enum class Theme { Dark, Light };

// How see-through the Liquid Glass is: clear shows the picture behind 1:1, frosted scatters it into a soft blur.
enum class GlassClarity { Clear, Default, Tinted, Frosted = Tinted };

constexpr GlassClarity ParseGlassClarity(std::string_view id) {
    return id == "clear" ? GlassClarity::Clear : id == "tinted" || id == "frosted" ? GlassClarity::Tinted : GlassClarity::Default;
}
constexpr std::string_view GlassClarityId(GlassClarity clarity) {
    return clarity == GlassClarity::Clear ? "clear" : clarity == GlassClarity::Tinted ? "tinted" : "default";
}

constexpr Theme ParseTheme(std::string_view id) { return id == "light" ? Theme::Light : Theme::Dark; }
constexpr std::string_view ThemeId(Theme theme) { return theme == Theme::Light ? "light" : "dark"; }

// The same two supported palettes as apps/ui/src/theme/{dark,light}.css.
struct Palette {
    Color background, surface, surfaceHover, borderSoft, text, textMuted, textFaint, focusRing;
    Color backgroundDeep, backgroundElevated, accentStrong, accentInk, glassFill, glassBorder, glassFocus;
    Color primary, onPrimary;
};

inline constexpr Palette kDarkPalette{
    Rgb(0x071018), Rgb(0x102238), Rgb(0x163048), Rgb(0x8CB4DC, 0.16),
    Rgb(0xFFFFFF, 0.95), Rgb(0xFFFFFF, 0.66), Rgb(0xFFFFFF, 0.44), Rgb(0x9EDCFF),
    Rgb(0x000000), Rgb(0x0C1A2C), Rgb(0x9EDCFF), Rgb(0x000000),
    Rgb(0xFFFFFF, 0.06), Rgb(0xFFFFFF, 0.22), Rgb(0xFFFFFF, 0.10),
    Rgb(0x2F6BFF, 0.55), Rgb(0xFFFFFF)};
inline constexpr Palette kLightPalette{
    Rgb(0xF4F1E4), Rgb(0xFFFDF6), Rgb(0xE7FFF6), Rgb(0x124856, 0.16),
    Rgb(0x12324A), Rgb(0x2A5A68), Rgb(0x4A7A82), Rgb(0x0EA884),
    Rgb(0xEFE8D4), Rgb(0xFFFAF0), Rgb(0x0EA884), Rgb(0xF4F1E4),
    Rgb(0xFFFFFF, 0.50), Rgb(0x124856, 0.16), Rgb(0xFFFFFF, 0.62),
    Rgb(0x2F6BFF, 0.55), Rgb(0xFFFFFF)};

namespace tokens {
// Painting is immediate and confined to the window thread. A scoped palette lets
// every widget and its gradients use the selected look without retaining global
// app preferences or changing the player/intro's cinema palette.
inline Palette palette = kDarkPalette;
inline const Color& kBackground = palette.background;
inline const Color& kSurface = palette.surface;
inline const Color& kSurfaceHover = palette.surfaceHover;
inline const Color& kBorderSoft = palette.borderSoft;
inline const Color& kText = palette.text;
inline const Color& kTextMuted = palette.textMuted;
inline const Color& kTextFaint = palette.textFaint;
inline const Color& kFocusRing = palette.focusRing;
inline const Color& kBackgroundDeep = palette.backgroundDeep;
inline const Color& kBackgroundElevated = palette.backgroundElevated;
inline const Color& kAccentStrong = palette.accentStrong;
inline const Color& kAccentInk = palette.accentInk;
inline const Color& kGlassFill = palette.glassFill;
inline const Color& kGlassBorder = palette.glassBorder;
inline const Color& kGlassFocus = palette.glassFocus;
inline const Color& kPrimary = palette.primary;
inline const Color& kOnPrimary = palette.onPrimary;
inline bool reduceTransparency = false;
inline bool reduceMotion = false;
// Settings > Look > Liquid Glass.
inline bool frostedGlass = false;
inline bool clearGlass = false;
}  // namespace tokens

// Applies the viewer's glass clarity while a frame is painted.
class GlassScope {
public:
    explicit GlassScope(GlassClarity clarity) : previous_(tokens::frostedGlass), previousClear_(tokens::clearGlass) {
        tokens::frostedGlass = clarity == GlassClarity::Tinted;
        tokens::clearGlass = clarity == GlassClarity::Clear;
    }
    ~GlassScope() { tokens::frostedGlass = previous_; tokens::clearGlass = previousClear_; }
    GlassScope(const GlassScope&) = delete;
    GlassScope& operator=(const GlassScope&) = delete;
private:
    bool previous_;
    bool previousClear_;
};

class ThemeScope {
public:
    explicit ThemeScope(Theme theme, bool reducedTransparency = tokens::reduceTransparency,
                        bool reducedMotion = tokens::reduceMotion)
        : previous_(tokens::palette),
          prevReduceTransparency_(tokens::reduceTransparency),
          prevReduceMotion_(tokens::reduceMotion) {
        tokens::palette = theme == Theme::Light ? kLightPalette : kDarkPalette;
        tokens::reduceTransparency = reducedTransparency;
        tokens::reduceMotion = reducedMotion;
    }
    ~ThemeScope() {
        tokens::palette = previous_;
        tokens::reduceTransparency = prevReduceTransparency_;
        tokens::reduceMotion = prevReduceMotion_;
    }
    ThemeScope(const ThemeScope&) = delete;
    ThemeScope& operator=(const ThemeScope&) = delete;
private:
    Palette previous_;
    bool prevReduceTransparency_ = false;
    bool prevReduceMotion_ = false;
};

}  // namespace tvm::ui
