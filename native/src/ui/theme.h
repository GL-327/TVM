#pragma once

#include <string_view>

#include "ui/painter.h"

namespace tvm::ui {

enum class Theme { Dark, Light };

namespace type {
inline constexpr TextStyle Display(double rem) { return {3.25 * rem, true, 700, -0.025}; }
inline constexpr TextStyle H1(double rem) { return {2.25 * rem, true, 700, -0.02}; }
inline constexpr TextStyle H2(double rem) { return {1.5 * rem, true, 650, -0.015}; }
inline constexpr TextStyle Title(double rem) { return {1.125 * rem, true, 600, -0.01}; }
inline constexpr TextStyle Body(double rem) { return {0.9375 * rem, false, 450}; }
inline constexpr TextStyle Label(double rem) { return {0.875 * rem, false, 550}; }
inline constexpr TextStyle Caption(double rem) { return {0.8125 * rem, false, 450, 0.005}; }
inline constexpr TextStyle Overline(double rem) { return {0.6875 * rem, true, 600, 0.08}; }
}  // namespace type

enum class UiFont { Geist, Inter, System };

constexpr std::uint32_t AccentColour(std::string_view accent) {
    if (accent == "indigo") return 0xB6C2FF;
    if (accent == "coral") return 0xFFB0A6;
    if (accent == "amber") return 0xFFD07A;
    if (accent == "emerald") return 0x7BE8B3;
    return 0x9EDCFF;
}

constexpr UiFont ParseUiFont(std::string_view id) {
    return id == "inter" ? UiFont::Inter : id == "system" ? UiFont::System : UiFont::Geist;
}
constexpr std::string_view UiFontId(UiFont font) {
    return font == UiFont::Inter ? "inter" : font == UiFont::System ? "system" : "geist";
}
constexpr std::string_view UiFontName(UiFont font) {
    return font == UiFont::Inter ? "Inter" : font == UiFont::System ? "System" : "Geist";
}

// Kept for the existing snapshot command-line fixtures.
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
    Rgb(0x07080B), Rgb(0x12141A), Rgb(0x1A1D25), Rgb(0xFFFFFF, 0.08),
    Rgb(0xF5F7FA), Rgb(0xA9B0BC), Rgb(0x6E7684), Rgb(0x9EDCFF),
    Rgb(0x000000), Rgb(0x232733), Rgb(0x9EDCFF), Rgb(0x000000),
    Rgb(0xFFFFFF, 0.06), Rgb(0xFFFFFF, 0.22), Rgb(0xFFFFFF, 0.10),
    Rgb(0x2F6BFF), Rgb(0xFFFFFF)};
inline constexpr Palette kLightPalette{
    Rgb(0xF4F1E4), Rgb(0xFFFDF6), Rgb(0xE7FFF6), Rgb(0x124856, 0.16),
    Rgb(0x12324A), Rgb(0x2A5A68), Rgb(0x4A7A82), Rgb(0x0EA884),
    Rgb(0xEFE8D4), Rgb(0xFFFAF0), Rgb(0x0EA884), Rgb(0xF4F1E4),
    Rgb(0xFFFFFF, 0.50), Rgb(0x124856, 0.16), Rgb(0xFFFFFF, 0.62),
    Rgb(0x2F6BFF), Rgb(0xFFFFFF)};

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
inline bool posterTitles = true;
inline UiFont font = UiFont::Geist;
inline std::optional<Point> pointer;
}  // namespace tokens

class FontScope {
public:
    explicit FontScope(UiFont font) : previous_(tokens::font) { tokens::font = font; }
    ~FontScope() { tokens::font = previous_; }
    FontScope(const FontScope&) = delete;
    FontScope& operator=(const FontScope&) = delete;
private:
    UiFont previous_;
};

class ThemeScope {
public:
    explicit ThemeScope(Theme theme, bool reducedTransparency = tokens::reduceTransparency,
                        bool reducedMotion = tokens::reduceMotion,
                        std::string_view accent = "default", bool posterTitles = tokens::posterTitles)
        : previous_(tokens::palette),
          prevReduceTransparency_(tokens::reduceTransparency),
          prevReduceMotion_(tokens::reduceMotion),
          prevPosterTitles_(tokens::posterTitles) {
        tokens::palette = theme == Theme::Light ? kLightPalette : kDarkPalette;
        if (theme == Theme::Dark) {
            tokens::palette.accentStrong = Rgb(AccentColour(accent));
            tokens::palette.focusRing = tokens::palette.accentStrong;
        }
        tokens::posterTitles = posterTitles;
        tokens::reduceTransparency = reducedTransparency;
        tokens::reduceMotion = reducedMotion;
    }
    ~ThemeScope() {
        tokens::palette = previous_;
        tokens::reduceTransparency = prevReduceTransparency_;
        tokens::reduceMotion = prevReduceMotion_;
        tokens::posterTitles = prevPosterTitles_;
    }
    ThemeScope(const ThemeScope&) = delete;
    ThemeScope& operator=(const ThemeScope&) = delete;
private:
    Palette previous_;
    bool prevReduceTransparency_ = false;
    bool prevReduceMotion_ = false;
    bool prevPosterTitles_ = true;
};

}  // namespace tvm::ui
