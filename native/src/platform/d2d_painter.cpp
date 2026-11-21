#include "platform/d2d_painter.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <stdexcept>

#include "core/util.h"
#include "platform/assets.h"
#include "ui/theme.h"

namespace tvm::platform {

namespace {

D2D1_RECT_F ToRect(const ui::Box& box) {
    return D2D1::RectF(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.y), static_cast<FLOAT>(box.Right()),
                       static_cast<FLOAT>(box.Bottom()));
}

D2D1_COLOR_F ToColor(const ui::Color& color) {
    return D2D1::ColorF(static_cast<FLOAT>(color.r), static_cast<FLOAT>(color.g), static_cast<FLOAT>(color.b),
                        static_cast<FLOAT>(color.a));
}

D2D1_ROUNDED_RECT ToRounded(const ui::Box& box, double radius) {
    return D2D1::RoundedRect(ToRect(box), static_cast<FLOAT>(radius), static_cast<FLOAT>(radius));
}

// The weight a style draws at: the one it names, else SemiBold for bold and Normal otherwise.
int WeightOf(const ui::TextStyle& style) {
    if (style.weight != 0) return style.weight;
    return style.bold ? DWRITE_FONT_WEIGHT_SEMI_BOLD : DWRITE_FONT_WEIGHT_NORMAL;
}

// Converts an HSL cinema tone (hue in [0, 360), s and l in [0, 1]) to an RGB Color.
ui::Color CinemaHsl(double hue, double s, double l, double a = 1.0) {
    const double h = std::fmod(std::fmod(hue, 360.0) + 360.0, 360.0) / 60.0;
    const double c = (1.0 - std::abs(2.0 * l - 1.0)) * s;
    const double x = c * (1.0 - std::abs(std::fmod(h, 2.0) - 1.0));
    double r = 0.0, g = 0.0, b = 0.0;
    if (h < 1.0) { r = c; g = x; }
    else if (h < 2.0) { r = x; g = c; }
    else if (h < 3.0) { g = c; b = x; }
    else if (h < 4.0) { g = x; b = c; }
    else if (h < 5.0) { r = x; b = c; }
    else { r = c; b = x; }
    const double m = l - c * 0.5;
    return ui::Color{r + m, g + m, b + m, a};
}

}  // namespace

D2dPainter::D2dPainter(ID2D1RenderTarget* target, Graphics& graphics, ArtworkStore* artwork, ImageCache* images)
    : target_(target), graphics_(graphics), artwork_(artwork), images_(images) {
    if (FAILED(target_->CreateSolidColorBrush(D2D1::ColorF(0, 1.0f), &solidBrush_))) {
        throw std::runtime_error("could not create a brush");
    }
}

ID2D1SolidColorBrush* D2dPainter::Brush(ui::Color color) {
    solidBrush_->SetColor(ToColor(color));
    return solidBrush_.Get();
}

void D2dPainter::Clear(ui::Color color) {
    target_->Clear(ToColor(color));
}

std::optional<paths::fs::path> D2dPainter::ResolveFile(const std::string& url) const {
    if (url.empty()) return std::nullopt;
    if (url.rfind(kAssetPrefix, 0) == 0) {
        return AssetFile(url.substr(sizeof(kAssetPrefix) - 1));
    }
    if (url.rfind("file:", 0) == 0) {
        return paths::fs::path(util::ToWide(url.substr(5)));
    }
    if (artwork_ != nullptr) {
        return artwork_->Lookup(url);
    }
    return std::nullopt;
}

void D2dPainter::SetBackdrop(const ui::Box& box, const std::string& url, double focusX, double focusY) {
    backdropBox_ = box;
    backdropUrl_ = url;
    backdropFocusX_ = focusX;
    backdropFocusY_ = focusY;
    backdropBitmap_ = nullptr;
    backdropBrush_.Reset();

    if (images_ == nullptr || backdropBox_.width <= 0.0 || backdropBox_.height <= 0.0) return;
    std::optional<paths::fs::path> file = ResolveFile(backdropUrl_);
    if (!file.has_value()) file = AssetFile("lighthouse.jpg");
    if (!file.has_value()) return;

    backdropBitmap_ = images_->GetBlurred(target_, file->wstring(), 24.0f);
    if (backdropBitmap_ == nullptr) return;

    const D2D1_SIZE_F size = backdropBitmap_->GetSize();
    if (size.width <= 0.0f || size.height <= 0.0f) {
        backdropBitmap_ = nullptr;
        return;
    }
    backdropScale_ = std::max(backdropBox_.width / size.width, backdropBox_.height / size.height);
    backdropOffsetX_ = backdropBox_.x + (backdropBox_.width - size.width * backdropScale_) * backdropFocusX_;
    backdropOffsetY_ = backdropBox_.y + (backdropBox_.height - size.height * backdropScale_) * backdropFocusY_;

    const D2D1_BITMAP_BRUSH_PROPERTIES props = D2D1::BitmapBrushProperties(
        D2D1_EXTEND_MODE_CLAMP, D2D1_EXTEND_MODE_CLAMP, D2D1_BITMAP_INTERPOLATION_MODE_LINEAR);
    target_->CreateBitmapBrush(backdropBitmap_, props, &backdropBrush_);
}

void D2dPainter::Glass(const ui::Box& box, double radius, const ui::GlassStyle& style) {
    if (box.width <= 0.0 || box.height <= 0.0) return;
    const double alpha = std::clamp(style.opacity * (style.disabled ? 0.40 : 1.0), 0.0, 1.0);
    if (alpha <= 0.0) return;
    const double clampedRadius = std::clamp(radius, 0.0, std::min(box.width, box.height) * 0.5);
    const bool isLight = (ui::tokens::kBackground.r + ui::tokens::kBackground.g + ui::tokens::kBackground.b) > 1.5;

    // 1. Reduce Transparency mode: opaque ink fill + contrast-safe rim (zero blur or refraction).
    if (style.reduceTransparency || ui::tokens::reduceTransparency) {
        if (!style.rimOnly) {
            ui::Color fill = style.activeTab ? ui::tokens::kPrimary
                             : style.focused ? ui::tokens::kSurfaceHover
                                             : style.tint.value_or(ui::tokens::kSurface);
            fill.a *= alpha;
            FillRoundRect(box, clampedRadius, fill);
        }
        ui::Color rim = style.focused ? ui::tokens::kFocusRing : ui::tokens::kBorderSoft;
        rim.a *= alpha;
        StrokeRoundRect(box, clampedRadius, style.focused ? 2.0 : 1.25, rim);
        return;
    }

    // 2. Fast GPU path for unfocused artwork-loaded poster cards (rimOnly && !focused):
    // Draws only the upper elliptical glass sheen, 1px inner depth line, and 4-stop Fresnel rim.
    if (style.rimOnly && !style.focused) {
        {
            const double rx = 1.28 * box.width;
            const double ry = std::min(0.55 * box.width, 0.75 * box.height);
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.0, ui::Rgb(0xFFFFFF, 0.11 * alpha)},
                ui::GradientStop{0.68, ui::Rgb(0xFFFFFF, 0.035 * alpha)},
                ui::GradientStop{1.0, ui::Rgb(0xFFFFFF, 0.0)},
            });
            const D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES props = D2D1::RadialGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x + 0.36 * box.width),
                              static_cast<FLOAT>(box.y - 0.12 * ry)),
                D2D1::Point2F(0.0f, 0.0f), static_cast<FLOAT>(rx), static_cast<FLOAT>(ry));
            ComPtr<ID2D1RadialGradientBrush> brush;
            if (SUCCEEDED(target_->CreateRadialGradientBrush(props, stops.Get(), &brush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), brush.Get());
            }
        }
        if (box.width > 6.0 && box.height > 6.0) {
            const ui::Box inner{box.x + 1.25, box.y + 1.25, box.width - 2.5, box.height - 2.5};
            StrokeRoundRect(inner, std::max(0.0, clampedRadius - 1.25), 1.0, ui::Rgb(0x000000, 0.18 * alpha));
        }
        {
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.00, ui::Rgb(0xFFFFFF, 0.72 * alpha)},
                ui::GradientStop{0.38, ui::Rgb(0xFFFFFF, 0.18 * alpha)},
                ui::GradientStop{0.68, ui::Rgb(0xFFFFFF, 0.10 * alpha)},
                ui::GradientStop{1.00, isLight ? ui::Rgb(0x14B890, 0.32 * alpha) : ui::Rgb(0xC8EAFF, 0.38 * alpha)},
            });
            const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.y)),
                D2D1::Point2F(static_cast<FLOAT>(box.Right()), static_cast<FLOAT>(box.Bottom())));
            ComPtr<ID2D1LinearGradientBrush> brush;
            if (SUCCEEDED(target_->CreateLinearGradientBrush(props, stops.Get(), &brush))) {
                const ui::Box rimBox{box.x + 0.65, box.y + 0.65, box.width - 1.3, box.height - 1.3};
                target_->DrawRoundedRectangle(ToRounded(rimBox, std::max(0.0, clampedRadius - 0.65)), brush.Get(),
                                              1.35f);
            }
        }
        return;
    }

    const bool cardOrPanel = style.kind == ui::GlassKind::Card || style.kind == ui::GlassKind::Panel;
    const bool floatingChrome = style.kind == ui::GlassKind::Pill || style.kind == ui::GlassKind::Tab ||
                                style.kind == ui::GlassKind::Orb;

    // 3. Ambient floating drop shadow (1 offset base + 2 perimeter feather strokes — zero excess overdraw).
    if (!style.rimOnly || style.focused) {
        const double dy = std::min(6.0, box.height * 0.14);
        const double shadowScale = (style.focused ? 1.25 : 1.0) * (isLight ? 0.55 : 1.0) * alpha;
        if (style.rimOnly) {
            // Artwork already covers the interior, so only stroke the outer shadow perimeter.
            StrokeRoundRect(ui::Box{box.x - 1.5, box.y + dy - 1.0, box.width + 3.0, box.height + 3.0},
                            clampedRadius + 1.5, 4.0, ui::Rgb(0x000000, 0.22 * shadowScale));
            StrokeRoundRect(ui::Box{box.x - 5.0, box.y + dy - 3.0, box.width + 10.0, box.height + 10.0},
                            clampedRadius + 5.0, 6.0, ui::Rgb(0x000000, 0.11 * shadowScale));
        } else {
            FillRoundRect(ui::Box{box.x - 1.0, box.y + dy, box.width + 2.0, box.height + 2.0}, clampedRadius + 1.0,
                          ui::Rgb(0x000000, 0.24 * shadowScale));
            StrokeRoundRect(ui::Box{box.x - 3.5, box.y + dy - 1.5, box.width + 7.0, box.height + 7.0},
                            clampedRadius + 3.5, 5.0, ui::Rgb(0x000000, 0.14 * shadowScale));
            StrokeRoundRect(ui::Box{box.x - 8.0, box.y + dy - 4.0, box.width + 16.0, box.height + 16.0},
                            clampedRadius + 8.0, 7.0, ui::Rgb(0x000000, 0.06 * shadowScale));
        }
    }

    // 4. Focused Apple Liquid Glass outer bloom halo (3 concentric perimeter strokes — fast GPU ring shaders).
    if (style.focused) {
        const ui::Color glowBase = style.warm ? ui::Rgb(0xFFE8C8)
                                   : isLight  ? ui::tokens::kFocusRing
                                              : ui::Rgb(0xBCE4FF);
        const double glowStrength = std::max(0.70, std::clamp(style.focusAmount, 0.0, 1.0)) * alpha;
        constexpr std::array<std::tuple<double, double, double>, 3> kHaloStrokes = {{
            {1.5, 3.0, 0.26},
            {4.5, 4.5, 0.14},
            {8.5, 6.0, 0.065},
        }};
        for (const auto& [outset, strokeW, weight] : kHaloStrokes) {
            const ui::Box gbox{box.x - outset, box.y - outset, box.width + 2.0 * outset, box.height + 2.0 * outset};
            ui::Color c = glowBase;
            c.a = weight * glowStrength;
            StrokeRoundRect(gbox, clampedRadius + outset, strokeW, c);
        }
    }

    // 5. Apple Liquid Glass body: Snell's Law Dual-Pass Edge Lens Refraction + Procedural Cinema Canvas + Sheen.
    if (!style.rimOnly) {
        if (backdropBrush_ && !style.activeTab) {
            // Pass A — Outer Refractive Lens Bevel (magnified 1.055x and shifted toward the overhead light vector,
            // bending background colours along the curved outer bevel of the glass).
            const double lensScale = backdropScale_ * (floatingChrome ? 1.06 : 1.04);
            const double lensShiftX = floatingChrome ? -4.0 : -2.5;
            const double lensShiftY = floatingChrome ? -3.5 : -2.0;
            backdropBrush_->SetTransform(
                D2D1::Matrix3x2F::Scale(static_cast<FLOAT>(lensScale), static_cast<FLOAT>(lensScale)) *
                D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(backdropOffsetX_ + lensShiftX),
                                              static_cast<FLOAT>(backdropOffsetY_ + lensShiftY)));
            backdropBrush_->SetOpacity(static_cast<FLOAT>(0.92 * alpha));
            target_->FillRoundedRectangle(ToRounded(box, clampedRadius), backdropBrush_.Get());

            // Pass B — Inner Optical Core (1.0x unwarped refraction core inset by the bevel thickness, creating a
            // visible 3.2px physical lens refraction ring around the perimeter of pills, capsules, orbs, and cards).
            const double bevel = std::min({3.4, box.width * 0.12, box.height * 0.12});
            if (bevel >= 1.5) {
                const ui::Box core{box.x + bevel, box.y + bevel, box.width - 2.0 * bevel, box.height - 2.0 * bevel};
                backdropBrush_->SetTransform(
                    D2D1::Matrix3x2F::Scale(static_cast<FLOAT>(backdropScale_), static_cast<FLOAT>(backdropScale_)) *
                    D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(backdropOffsetX_),
                                                  static_cast<FLOAT>(backdropOffsetY_)));
                backdropBrush_->SetOpacity(static_cast<FLOAT>(0.88 * alpha));
                target_->FillRoundedRectangle(ToRounded(core, std::max(0.0, clampedRadius - bevel)),
                                              backdropBrush_.Get());
            }
        }

        // Procedural Cinema Canvas for cards without an external poster bitmap (style.hue >= 0).
        if (style.kind == ui::GlassKind::Card && style.hue >= 0 && !isLight) {
            const double h = static_cast<double>(style.hue);
            const ui::Color deepBg = CinemaHsl(h, 0.58, 0.11, 0.82 * alpha);
            const ui::Color midBg = CinemaHsl(h + 18.0, 0.64, 0.19, 0.72 * alpha);
            const ui::Color glowBg = CinemaHsl(h - 14.0, 0.78, 0.42, (style.focused ? 0.34 : 0.24) * alpha);
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.0, midBg},
                ui::GradientStop{0.55, deepBg},
                ui::GradientStop{1.0, ui::Rgb(0x060B14, 0.88 * alpha)},
            });
            const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.y)),
                D2D1::Point2F(static_cast<FLOAT>(box.Right()), static_cast<FLOAT>(box.Bottom())));
            ComPtr<ID2D1LinearGradientBrush> brush;
            if (SUCCEEDED(target_->CreateLinearGradientBrush(props, stops.Get(), &brush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), brush.Get());
            }
            // Atmospheric horizon bloom inside the card.
            const ComPtr<ID2D1GradientStopCollection> radStops = Stops({
                ui::GradientStop{0.0, glowBg},
                ui::GradientStop{0.65, CinemaHsl(h, 0.65, 0.24, 0.10 * alpha)},
                ui::GradientStop{1.0, ui::Rgb(0x000000, 0.0)},
            });
            const D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES radProps = D2D1::RadialGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x + 0.72 * box.width),
                              static_cast<FLOAT>(box.y + 0.26 * box.height)),
                D2D1::Point2F(0.0f, 0.0f), static_cast<FLOAT>(box.width * 0.78),
                static_cast<FLOAT>(box.height * 0.68));
            ComPtr<ID2D1RadialGradientBrush> radBrush;
            if (SUCCEEDED(target_->CreateRadialGradientBrush(radProps, radStops.Get(), &radBrush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), radBrush.Get());
            }
        }

        // Translucent optical base tint.
        if (style.activeTab) {
            const ui::Color activeFill = isLight ? ui::Rgb(0xFFFFFF, 0.96 * alpha) : ui::Rgb(0xF4F8FF, 0.90 * alpha);
            FillRoundRect(box, clampedRadius, activeFill);
        } else if (isLight) {
            const double lightAlpha = cardOrPanel ? (style.focused ? 0.86 : 0.76) : (style.focused ? 0.84 : 0.68);
            FillRoundRect(box, clampedRadius, ui::Rgb(0xFFFDF9, lightAlpha * alpha));
        } else {
            const double darkBase = (style.kind == ui::GlassKind::Card && style.hue >= 0)
                                        ? (style.focused ? 0.22 : 0.28)
                                        : cardOrPanel ? (style.focused ? 0.68 : 0.62)
                                                      : (style.focused ? 0.36 : 0.28);
            FillRoundRect(box, clampedRadius, ui::Rgb(0x08111E, darkBase * alpha));
            if (style.tint.has_value() && !cardOrPanel) {
                ui::Color custom = *style.tint;
                custom.a = std::min(0.18, custom.a) * alpha;
                FillRoundRect(box, clampedRadius, custom);
            }
            const double frost = cardOrPanel ? (style.focused ? 0.08 : 0.04)
                                             : (style.focused ? 0.16 : (style.selected ? 0.13 : 0.10));
            const ui::Color frostTint = style.warm ? ui::Rgb(0xFFEAD2, frost * alpha) : ui::Rgb(0xE8F4FF, frost * alpha);
            FillRoundRect(box, clampedRadius, frostTint);
        }

        // Vertical Liquid Glass body transmission gradient (top highlight to deep base).
        {
            const double topBody = style.activeTab ? 0.26 : (cardOrPanel ? 0.12 : 0.20);
            const double botBody = style.activeTab ? 0.05 : (cardOrPanel ? 0.02 : 0.03);
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.0, ui::Rgb(0xFFFFFF, topBody * alpha)},
                ui::GradientStop{0.55, ui::Rgb(0xFFFFFF, topBody * 0.25 * alpha)},
                ui::GradientStop{1.0, ui::Rgb(0xFFFFFF, botBody * alpha)},
            });
            const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.y)),
                D2D1::Point2F(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.Bottom())));
            ComPtr<ID2D1LinearGradientBrush> brush;
            if (SUCCEEDED(target_->CreateLinearGradientBrush(props, stops.Get(), &brush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), brush.Get());
            }
        }

        // Lower Internal Liquid Caustic Swell (light pooling at the bottom curve of a liquid droplet).
        if (floatingChrome || style.focused) {
            const double causticPeak = (floatingChrome ? (style.focused ? 0.18 : 0.12) : 0.11) * alpha;
            const ui::Color causticColor = isLight ? ui::Rgb(0xFFFFFF, causticPeak) : ui::Rgb(0xD4EEFF, causticPeak);
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.0, causticColor},
                ui::GradientStop{0.65, ui::Color{causticColor.r, causticColor.g, causticColor.b, causticPeak * 0.35}},
                ui::GradientStop{1.0, ui::Rgb(0xFFFFFF, 0.0)},
            });
            const D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES props = D2D1::RadialGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x + 0.56 * box.width),
                              static_cast<FLOAT>(box.Bottom() + 0.06 * box.height)),
                D2D1::Point2F(0.0f, 0.0f), static_cast<FLOAT>(box.width * 0.72),
                static_cast<FLOAT>(box.height * 0.44));
            ComPtr<ID2D1RadialGradientBrush> brush;
            if (SUCCEEDED(target_->CreateRadialGradientBrush(props, stops.Get(), &brush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), brush.Get());
            }
        }

        // Orb upper-left radial specular hotspot.
        if (style.kind == ui::GlassKind::Orb) {
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.0, ui::Rgb(0xFFFFFF, 0.52 * alpha)},
                ui::GradientStop{0.50, ui::Rgb(0xFFFFFF, 0.16 * alpha)},
                ui::GradientStop{1.0, ui::Rgb(0xFFFFFF, 0.0)},
            });
            const D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES props = D2D1::RadialGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x + 0.30 * box.width),
                              static_cast<FLOAT>(box.y + 0.22 * box.height)),
                D2D1::Point2F(0.0f, 0.0f), static_cast<FLOAT>(box.width * 0.58),
                static_cast<FLOAT>(box.height * 0.50));
            ComPtr<ID2D1RadialGradientBrush> brush;
            if (SUCCEEDED(target_->CreateRadialGradientBrush(props, stops.Get(), &brush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), brush.Get());
            }
        }
    }

    // 6. Upper Curved Elliptical Specular Gloss (100% GPU Radial Gradient clipped to RoundedRect — zero CPU path tessellation).
    {
        const double rx = cardOrPanel ? 1.32 * box.width : 1.08 * box.width;
        const double ry = cardOrPanel ? std::min(0.56 * box.width, 0.78 * box.height) : 0.84 * box.height;
        const double basePeak = cardOrPanel ? (style.focused ? 0.16 : 0.10)
                                            : (style.focused ? 0.32 : 0.24);
        const double topPeak = (style.rimOnly ? 0.12 : basePeak) * alpha;
        const ComPtr<ID2D1GradientStopCollection> stops = Stops({
            ui::GradientStop{0.00, ui::Rgb(0xFFFFFF, topPeak)},
            ui::GradientStop{0.58, ui::Rgb(0xFFFFFF, topPeak * 0.48)},
            ui::GradientStop{0.92, ui::Rgb(0xFFFFFF, topPeak * 0.12)},
            ui::GradientStop{1.00, ui::Rgb(0xFFFFFF, 0.0)},
        });
        const D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES props = D2D1::RadialGradientBrushProperties(
            D2D1::Point2F(static_cast<FLOAT>(box.x + 0.38 * box.width),
                          static_cast<FLOAT>(box.y - 0.16 * ry)),
            D2D1::Point2F(0.0f, 0.0f), static_cast<FLOAT>(rx), static_cast<FLOAT>(ry));
        ComPtr<ID2D1RadialGradientBrush> brush;
        if (SUCCEEDED(target_->CreateRadialGradientBrush(props, stops.Get(), &brush))) {
            target_->FillRoundedRectangle(ToRounded(box, clampedRadius), brush.Get());
        }
    }

    // 7. Prismatic Chromatic Dispersion Inner Rim + Depth Hairline (inset 1.5px).
    if (box.width > 6.0 && box.height > 6.0) {
        const ui::Box inner{box.x + 1.5, box.y + 1.5, box.width - 3.0, box.height - 3.0};
        const double innerRad = std::max(0.0, clampedRadius - 1.5);
        if (floatingChrome || style.focused) {
            // Subtle spectral dispersion (cyan-ice top-left -> dark depth trough -> warm violet-amber bottom-right).
            const double dispAlpha = (style.focused ? 0.38 : 0.24) * alpha;
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.00, ui::Rgb(0x7EE0FF, dispAlpha)},
                ui::GradientStop{0.48, ui::Rgb(0x000000, 0.22 * alpha)},
                ui::GradientStop{1.00, ui::Rgb(0xFFC8EE, dispAlpha * 0.85)},
            });
            const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(inner.x), static_cast<FLOAT>(inner.y)),
                D2D1::Point2F(static_cast<FLOAT>(inner.Right()), static_cast<FLOAT>(inner.Bottom())));
            ComPtr<ID2D1LinearGradientBrush> brush;
            if (SUCCEEDED(target_->CreateLinearGradientBrush(props, stops.Get(), &brush))) {
                target_->DrawRoundedRectangle(ToRounded(inner, innerRad), brush.Get(), 1.0f);
            }
        } else {
            StrokeRoundRect(inner, innerRad, 1.0, ui::Rgb(0x000000, 0.20 * alpha));
        }
    }

    // 8. 4-Stop Fresnel Volume Rim: bright top-left overhead specular catch, mid-edge Fresnel trough,
    // and bottom-right internal bounce caustic.
    {
        const double rimTopLeft = style.focused ? 0.98 : (style.activeTab ? 0.92 : 0.80);
        const double rimUpperMid = style.focused ? 0.36 : 0.20;
        const double rimLowerMid = style.focused ? 0.22 : 0.11;
        const double rimBotRight = style.focused ? 0.72 : (style.activeTab ? 0.50 : 0.44);

        const ui::Color keyTint = (isLight && style.focused) ? ui::tokens::kFocusRing : ui::Rgb(0xFFFFFF);
        const ui::Color bounceTint = isLight ? (style.focused ? ui::tokens::kFocusRing : ui::Rgb(0x14B890))
                                             : (style.warm ? ui::Rgb(0xFFE6C8) : ui::Rgb(0xC8EAFF));
        const auto withA = [&](ui::Color base, double a) {
            base.a = a * alpha;
            return base;
        };
        const ComPtr<ID2D1GradientStopCollection> stops = Stops({
            ui::GradientStop{0.00, withA(keyTint, rimTopLeft)},
            ui::GradientStop{0.36, withA(keyTint, rimUpperMid)},
            ui::GradientStop{0.68, withA(keyTint, rimLowerMid)},
            ui::GradientStop{1.00, withA(bounceTint, rimBotRight)},
        });
        const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
            D2D1::Point2F(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.y)),
            D2D1::Point2F(static_cast<FLOAT>(box.Right()), static_cast<FLOAT>(box.Bottom())));
        ComPtr<ID2D1LinearGradientBrush> brush;
        if (SUCCEEDED(target_->CreateLinearGradientBrush(props, stops.Get(), &brush))) {
            const FLOAT strokeWidth = style.focused ? 2.1f : 1.5f;
            const double inset = strokeWidth * 0.5;
            if (box.width > 2.0 * inset && box.height > 2.0 * inset) {
                const ui::Box rimBox{box.x + inset, box.y + inset, box.width - 2.0 * inset, box.height - 2.0 * inset};
                target_->DrawRoundedRectangle(ToRounded(rimBox, std::max(0.0, clampedRadius - inset)), brush.Get(),
                                              strokeWidth);
            }
        }
    }
}

void D2dPainter::FillRoundRect(const ui::Box& box, double radius, ui::Color color) {
    target_->FillRoundedRectangle(ToRounded(box, radius), Brush(color));
}

void D2dPainter::StrokeRoundRect(const ui::Box& box, double radius, double width, ui::Color color) {
    target_->DrawRoundedRectangle(ToRounded(box, radius), Brush(color), static_cast<FLOAT>(width));
}

bool D2dPainter::Image(const ui::Box& box, const std::string& url, double radius) {
    return ImageFaded(box, url, radius, 1.0, 0.5, 0.5);
}

bool D2dPainter::ImageFaded(const ui::Box& box, const std::string& url, double radius, double opacity, double focusX,
                            double focusY) {
    if (images_ == nullptr) return false;
    const std::optional<paths::fs::path> file = ResolveFile(url);
    if (!file.has_value()) return false;
    ID2D1Bitmap* bitmap = images_->Get(target_, file->wstring());
    if (bitmap == nullptr) return false;

    // Cover-fit: scale the picture until it fills the box, and place the overflow by the focal point.
    const D2D1_SIZE_F size = bitmap->GetSize();
    if (size.width <= 0.0f || size.height <= 0.0f || box.width <= 0.0 || box.height <= 0.0) return false;
    const double scale = std::max(box.width / size.width, box.height / size.height);
    const double offsetX = box.x + (box.width - size.width * scale) * focusX;
    const double offsetY = box.y + (box.height - size.height * scale) * focusY;

    D2D1_BITMAP_BRUSH_PROPERTIES properties = D2D1::BitmapBrushProperties(
        D2D1_EXTEND_MODE_CLAMP, D2D1_EXTEND_MODE_CLAMP, D2D1_BITMAP_INTERPOLATION_MODE_LINEAR);
    ComPtr<ID2D1BitmapBrush> brush;
    if (FAILED(target_->CreateBitmapBrush(bitmap, properties, &brush))) return false;
    brush->SetTransform(D2D1::Matrix3x2F::Scale(static_cast<FLOAT>(scale), static_cast<FLOAT>(scale)) *
                        D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(offsetX), static_cast<FLOAT>(offsetY)));
    brush->SetOpacity(static_cast<FLOAT>(std::clamp(opacity, 0.0, 1.0)));
    target_->FillRoundedRectangle(ToRounded(box, radius), brush.Get());
    return true;
}

ComPtr<ID2D1GradientStopCollection> D2dPainter::Stops(const std::vector<ui::GradientStop>& stops) {
    std::vector<D2D1_GRADIENT_STOP> raw;
    raw.reserve(stops.size());
    for (const ui::GradientStop& stop : stops) {
        raw.push_back(D2D1_GRADIENT_STOP{static_cast<FLOAT>(stop.position), ToColor(stop.color)});
    }
    ComPtr<ID2D1GradientStopCollection> collection;
    if (raw.empty() ||
        FAILED(target_->CreateGradientStopCollection(raw.data(), static_cast<UINT32>(raw.size()), D2D1_GAMMA_1_0,
                                                     D2D1_EXTEND_MODE_CLAMP, &collection))) {
        throw std::runtime_error("could not create a gradient");
    }
    return collection;
}

ComPtr<ID2D1PathGeometry> D2dPainter::Polygon(const std::vector<ui::Point>& points) {
    ComPtr<ID2D1PathGeometry> geometry;
    if (points.size() < 3 || FAILED(graphics_.d2d()->CreatePathGeometry(&geometry))) return nullptr;
    ComPtr<ID2D1GeometrySink> sink;
    if (FAILED(geometry->Open(&sink))) return nullptr;
    sink->BeginFigure(D2D1::Point2F(static_cast<FLOAT>(points[0].x), static_cast<FLOAT>(points[0].y)),
                      D2D1_FIGURE_BEGIN_FILLED);
    for (std::size_t i = 1; i < points.size(); ++i) {
        sink->AddLine(D2D1::Point2F(static_cast<FLOAT>(points[i].x), static_cast<FLOAT>(points[i].y)));
    }
    sink->EndFigure(D2D1_FIGURE_END_CLOSED);
    if (FAILED(sink->Close())) return nullptr;
    return geometry;
}

void D2dPainter::FillPolygon(const std::vector<ui::Point>& points, ui::Color color) {
    const ComPtr<ID2D1PathGeometry> geometry = Polygon(points);
    if (!geometry) return;
    target_->FillGeometry(geometry.Get(), Brush(color));
}

void D2dPainter::FillPolygonLinear(const std::vector<ui::Point>& points, double x0, double y0, double x1, double y1,
                                   const std::vector<ui::GradientStop>& stops) {
    const ComPtr<ID2D1PathGeometry> geometry = Polygon(points);
    if (!geometry) return;
    const ComPtr<ID2D1GradientStopCollection> collection = Stops(stops);
    const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES properties = D2D1::LinearGradientBrushProperties(
        D2D1::Point2F(static_cast<FLOAT>(x0), static_cast<FLOAT>(y0)),
        D2D1::Point2F(static_cast<FLOAT>(x1), static_cast<FLOAT>(y1)));
    ComPtr<ID2D1LinearGradientBrush> brush;
    if (FAILED(target_->CreateLinearGradientBrush(properties, collection.Get(), &brush))) {
        throw std::runtime_error("could not create a gradient brush");
    }
    target_->FillGeometry(geometry.Get(), brush.Get());
}

void D2dPainter::FillLinearGradient(const ui::Box& box, double x0, double y0, double x1, double y1,
                                    const std::vector<ui::GradientStop>& stops) {
    const ComPtr<ID2D1GradientStopCollection> collection = Stops(stops);
    const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES properties = D2D1::LinearGradientBrushProperties(
        D2D1::Point2F(static_cast<FLOAT>(x0), static_cast<FLOAT>(y0)),
        D2D1::Point2F(static_cast<FLOAT>(x1), static_cast<FLOAT>(y1)));
    ComPtr<ID2D1LinearGradientBrush> brush;
    if (FAILED(target_->CreateLinearGradientBrush(properties, collection.Get(), &brush))) {
        throw std::runtime_error("could not create a gradient brush");
    }
    target_->FillRectangle(ToRect(box), brush.Get());
}

void D2dPainter::FillRadialGradient(const ui::Box& box, double cx, double cy, double rx, double ry,
                                    const std::vector<ui::GradientStop>& stops) {
    const ComPtr<ID2D1GradientStopCollection> collection = Stops(stops);
    const D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES properties = D2D1::RadialGradientBrushProperties(
        D2D1::Point2F(static_cast<FLOAT>(cx), static_cast<FLOAT>(cy)), D2D1::Point2F(0.0f, 0.0f),
        static_cast<FLOAT>(rx), static_cast<FLOAT>(ry));
    ComPtr<ID2D1RadialGradientBrush> brush;
    if (FAILED(target_->CreateRadialGradientBrush(properties, collection.Get(), &brush))) {
        throw std::runtime_error("could not create a gradient brush");
    }
    target_->FillRectangle(ToRect(box), brush.Get());
}

void D2dPainter::Paragraph(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) {
    const std::wstring wide = util::ToWide(std::string(text));
    IDWriteTextFormat* format = graphics_.ParagraphFormat(style.sizePx, WeightOf(style));
    target_->DrawTextW(wide.c_str(), static_cast<UINT32>(wide.size()), format, ToRect(box), Brush(color),
                       D2D1_DRAW_TEXT_OPTIONS_CLIP, DWRITE_MEASURING_MODE_NATURAL);
}

void D2dPainter::Text(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) {
    const std::wstring wide = util::ToWide(std::string(text));
    IDWriteTextFormat* format = graphics_.TextFormat(style.sizePx, WeightOf(style));
    target_->DrawTextW(wide.c_str(), static_cast<UINT32>(wide.size()), format, ToRect(box), Brush(color),
                       D2D1_DRAW_TEXT_OPTIONS_CLIP, DWRITE_MEASURING_MODE_NATURAL);
}

double D2dPainter::MeasureText(std::string_view text, const ui::TextStyle& style) {
    return graphics_.MeasureText(text, style.sizePx, WeightOf(style));
}

void D2dPainter::Path(const ui::Box& box, double viewBox, std::string_view data, const ui::PathStyle& style) {
    ComPtr<ID2D1PathGeometry> geometry;
    if (viewBox <= 0.0 || FAILED(graphics_.d2d()->CreatePathGeometry(&geometry))) return;
    ComPtr<ID2D1GeometrySink> sink;
    if (FAILED(geometry->Open(&sink))) return;

    std::size_t at = 0;
    const auto skip = [&] {
        while (at < data.size() && (data[at] == ' ' || data[at] == ',' || data[at] == '\n')) ++at;
    };
    const auto number = [&]() -> FLOAT {
        skip();
        const std::string rest(data.substr(at, 32));
        char* end = nullptr;
        const double value = std::strtod(rest.c_str(), &end);
        at += static_cast<std::size_t>(end - rest.c_str());
        return static_cast<FLOAT>(value);
    };
    const auto flag = [&] {
        skip();
        return at < data.size() && data[at++] == '1';
    };
    const auto numberNext = [&] {
        skip();
        return at < data.size() && !std::isalpha(static_cast<unsigned char>(data[at]));
    };

    const D2D1_FIGURE_BEGIN fill = style.fill.a > 0.0 ? D2D1_FIGURE_BEGIN_FILLED : D2D1_FIGURE_BEGIN_HOLLOW;
    D2D1_POINT_2F current{0.0f, 0.0f};
    D2D1_POINT_2F start{0.0f, 0.0f};
    bool open = false;
    char command = 'M';
    while (true) {
        skip();
        if (at >= data.size()) break;
        if (std::isalpha(static_cast<unsigned char>(data[at]))) command = data[at++];
        const bool relative = std::islower(static_cast<unsigned char>(command)) != 0;
        const FLOAT ox = relative ? current.x : 0.0f;
        const FLOAT oy = relative ? current.y : 0.0f;
        switch (std::toupper(static_cast<unsigned char>(command))) {
        case 'M': {
            const FLOAT x = number();
            const FLOAT y = number();
            if (open) sink->EndFigure(D2D1_FIGURE_END_OPEN);
            current = start = D2D1::Point2F(ox + x, oy + y);
            sink->BeginFigure(current, fill);
            open = true;
            command = relative ? 'l' : 'L';
            break;
        }
        case 'L': {
            const FLOAT x = number();
            const FLOAT y = number();
            current = D2D1::Point2F(ox + x, oy + y);
            sink->AddLine(current);
            break;
        }
        case 'H':
            current.x = ox + number();
            sink->AddLine(current);
            break;
        case 'V':
            current.y = oy + number();
            sink->AddLine(current);
            break;
        case 'A': {
            const FLOAT rx = number();
            const FLOAT ry = number();
            const FLOAT rotation = number();
            const bool large = flag();
            const bool sweep = flag();
            const FLOAT x = number();
            const FLOAT y = number();
            current = D2D1::Point2F(ox + x, oy + y);
            sink->AddArc(D2D1::ArcSegment(current, D2D1::SizeF(rx, ry), rotation,
                                          sweep ? D2D1_SWEEP_DIRECTION_CLOCKWISE : D2D1_SWEEP_DIRECTION_COUNTER_CLOCKWISE,
                                          large ? D2D1_ARC_SIZE_LARGE : D2D1_ARC_SIZE_SMALL));
            break;
        }
        case 'Z':
            if (open) sink->EndFigure(D2D1_FIGURE_END_CLOSED);
            open = false;
            current = start;
            if (numberNext()) command = relative ? 'm' : 'M';
            break;
        default:
            at = data.size();
            break;
        }
    }
    if (open) sink->EndFigure(D2D1_FIGURE_END_OPEN);
    if (FAILED(sink->Close())) return;

    const auto scale = static_cast<FLOAT>(std::min(box.width, box.height) / viewBox);
    const D2D1_MATRIX_3X2_F fit =
        D2D1::Matrix3x2F::Scale(style.mirror ? -scale : scale, scale) *
        D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(style.mirror ? box.x + viewBox * scale : box.x),
                                      static_cast<FLOAT>(box.y));
    D2D1_MATRIX_3X2_F previous{};
    target_->GetTransform(&previous);
    target_->SetTransform(fit * previous);
    if (style.fill.a > 0.0) target_->FillGeometry(geometry.Get(), Brush(style.fill));
    if (style.stroke.a > 0.0 && style.strokeWidth > 0.0) {
        ComPtr<ID2D1StrokeStyle> round;
        graphics_.d2d()->CreateStrokeStyle(D2D1::StrokeStyleProperties(D2D1_CAP_STYLE_ROUND, D2D1_CAP_STYLE_ROUND,
                                                                       D2D1_CAP_STYLE_ROUND, D2D1_LINE_JOIN_ROUND),
                                           nullptr, 0, &round);
        target_->DrawGeometry(geometry.Get(), Brush(style.stroke), static_cast<FLOAT>(style.strokeWidth),
                              round.Get());
    }
    target_->SetTransform(previous);
}

void D2dPainter::PushClip(const ui::Box& box) {
    target_->PushAxisAlignedClip(ToRect(box), D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
    ++clipDepth_;
}

void D2dPainter::PopClip() {
    if (clipDepth_ <= 0) return;
    target_->PopAxisAlignedClip();
    --clipDepth_;
}

}  // namespace tvm::platform
