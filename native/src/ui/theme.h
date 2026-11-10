#pragma once

#include <string_view>

#include "ui/painter.h"

namespace tvm::ui {

enum class Theme { Dark, Light };

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
    Rgb(0xE8F0F8), Rgb(0x9BB0C8), Rgb(0x6A8298), Rgb(0x9EDCFF),
    Rgb(0x000000), Rgb(0x0C1A2C), Rgb(0x9EDCFF), Rgb(0x000000),
    Rgb(0x282828, 0.72), Rgb(0xFFFFFF, 0.16), Rgb(0xFFFFFF, 0.18),
    Rgb(0xFFFFFF), Rgb(0x111111)};
inline constexpr Palette kLightPalette{
    Rgb(0xF4F1E4), Rgb(0xFFFDF6), Rgb(0xE7FFF6), Rgb(0x124856, 0.16),
    Rgb(0x12324A), Rgb(0x2A5A68), Rgb(0x4A7A82), Rgb(0x0EA884),
    Rgb(0xEFE8D4), Rgb(0xFFFAF0), Rgb(0x0EA884), Rgb(0xF4F1E4),
    Rgb(0xFFFDF6, 0.86), Rgb(0x124856, 0.16), Rgb(0x1EC9A0, 0.22),
    Rgb(0xFFFFFF), Rgb(0x111111)};

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
}  // namespace tokens

class ThemeScope {
public:
    explicit ThemeScope(Theme theme) : previous_(tokens::palette) {
        tokens::palette = theme == Theme::Light ? kLightPalette : kDarkPalette;
    }
    ~ThemeScope() { tokens::palette = previous_; }
    ThemeScope(const ThemeScope&) = delete;
    ThemeScope& operator=(const ThemeScope&) = delete;
private:
    Palette previous_;
};

}  // namespace tvm::ui
