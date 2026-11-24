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

constexpr double kSweepPi = 3.14159265358979323846;

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

D2dPainter::D2dPainter(ID2D1RenderTarget* target, Graphics& graphics, ArtworkStore* artwork, ImageCache* images,
                       GlassLens* lens)
    : target_(target), graphics_(graphics), artwork_(artwork), images_(images),
      lens_(lens != nullptr && lens->ok() ? lens : nullptr) {
    if (lens_ != nullptr) lens_->BeginFrame();
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
        std::optional<paths::fs::path> file = artwork_->Lookup(url);
        // A picture on screen with no file yet is asked for, so it is fetched first, and fetched again after a
        // failure, rather than staying blank until its page happens to be rebuilt.
        if (!file.has_value()) artwork_->Want(url);
        return file;
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
    const auto white = [alpha](double a) { return ui::Rgb(0xFFFFFF, std::clamp(a, 0.0, 1.0) * alpha); };
    const auto black = [alpha](double a) { return ui::Rgb(0x000000, std::clamp(a, 0.0, 1.0) * alpha); };

    // 1. Reduce Transparency: an opaque ink fill and a contrast-safe rim, with no backdrop at all.
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

    // How much the surface is lit by hover or focus, and how far it is held down, both from 0 to 1. Callers that
    // animate pass the eased amounts; a plain `focused` or `pressed` counts as fully on.
    const double emphasis =
        std::clamp(style.focusAmount > 0.0 ? style.focusAmount : (style.focused ? 1.0 : 0.0), 0.0, 1.0);
    const double press = std::clamp(style.pressAmount > 0.0 ? style.pressAmount : (style.pressed ? 1.0 : 0.0), 0.0, 1.0);
    const bool cardOrPanel = style.kind == ui::GlassKind::Card || style.kind == ui::GlassKind::Panel;

    // A vertical gradient filling the rounded shape.
    const auto fillVertical = [&](const ui::Box& area, double r, std::vector<ui::GradientStop> stops) {
        const ComPtr<ID2D1GradientStopCollection> collection = Stops(stops);
        const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
            D2D1::Point2F(static_cast<FLOAT>(area.x), static_cast<FLOAT>(area.y)),
            D2D1::Point2F(static_cast<FLOAT>(area.x), static_cast<FLOAT>(area.Bottom())));
        ComPtr<ID2D1LinearGradientBrush> brush;
        if (SUCCEEDED(target_->CreateLinearGradientBrush(props, collection.Get(), &brush))) {
            target_->FillRoundedRectangle(ToRounded(area, r), brush.Get());
        }
    };
    // A ring of `width` pixels drawn wholly outside the shape, `gap` pixels out, shaded top to bottom.
    const auto outerRing = [&](double gap, double width, ui::Color top, ui::Color bottom) {
        const double outset = gap + width / 2.0;
        const ui::Box ring{box.x - outset, box.y - outset, box.width + 2.0 * outset, box.height + 2.0 * outset};
        const ComPtr<ID2D1GradientStopCollection> collection =
            Stops({ui::GradientStop{0.0, top}, ui::GradientStop{1.0, bottom}});
        const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
            D2D1::Point2F(static_cast<FLOAT>(ring.x), static_cast<FLOAT>(ring.y)),
            D2D1::Point2F(static_cast<FLOAT>(ring.x), static_cast<FLOAT>(ring.Bottom())));
        ComPtr<ID2D1LinearGradientBrush> brush;
        if (SUCCEEDED(target_->CreateLinearGradientBrush(props, collection.Get(), &brush))) {
            target_->DrawRoundedRectangle(ToRounded(ring, clampedRadius + outset), brush.Get(),
                                          static_cast<FLOAT>(width));
        }
    };
    // The thin luminous edge: brightest where the overhead light catches the top-left curve, faint along the
    // sides, and a softer bounce along the bottom-right.
    const auto edge = [&](double strength) {
        const double lit = strength * (1.0 - 0.25 * press);
        const ComPtr<ID2D1GradientStopCollection> collection = Stops({
            ui::GradientStop{0.00, white((0.50 + 0.30 * emphasis) * lit)},
            ui::GradientStop{0.30, white((0.16 + 0.10 * emphasis) * lit)},
            ui::GradientStop{0.62, white((0.07 + 0.06 * emphasis) * lit)},
            ui::GradientStop{1.00, white((0.24 + 0.18 * emphasis) * lit)},
        });
        const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
            D2D1::Point2F(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.y)),
            D2D1::Point2F(static_cast<FLOAT>(box.Right()), static_cast<FLOAT>(box.Bottom())));
        ComPtr<ID2D1LinearGradientBrush> brush;
        if (SUCCEEDED(target_->CreateLinearGradientBrush(props, collection.Get(), &brush)) && box.width > 2.0 &&
            box.height > 2.0) {
            const ui::Box rim{box.x + 0.5, box.y + 0.5, box.width - 1.0, box.height - 1.0};
            target_->DrawRoundedRectangle(ToRounded(rim, std::max(0.0, clampedRadius - 0.5)), brush.Get(), 1.0f);
        }
    };

    // 2. Poster cards whose artwork already fills the shape: only a faint sheen and the edge.
    if (style.rimOnly && !style.focused) {
        fillVertical(box, clampedRadius,
                     {ui::GradientStop{0.0, white(0.08)}, ui::GradientStop{0.45, white(0.0)},
                      ui::GradientStop{1.0, white(0.0)}});
        edge(0.85);
        return;
    }

    // 3. A soft contact shadow, drawn only outside the shape so it never shows through the glass: almost nothing
    // above, a little more below, as a surface floating just off the picture.
    const double shadowScale = (isLight ? 0.55 : 1.0) * alpha * (1.0 - 0.35 * press);
    // A raised (focused) surface casts a little more shadow, as it lifts toward the viewer.
    outerRing(0.0, 2.0, black(0.02 * shadowScale), black((0.16 + 0.10 * emphasis) * shadowScale));
    outerRing(2.0, 5.0, black(0.0), black((0.07 + 0.08 * emphasis) * shadowScale));

    // 4. Hover and focus light the surface from within and add a restrained outer glow, not a thick ring.
    if (emphasis > 0.0) {
        const ui::Color glow = isLight ? ui::tokens::kFocusRing : ui::Rgb(0xFFFFFF);
        outerRing(1.0, 2.0, ui::Color{glow.r, glow.g, glow.b, 0.20 * emphasis * alpha},
                  ui::Color{glow.r, glow.g, glow.b, 0.14 * emphasis * alpha});
        outerRing(3.0, 4.0, ui::Color{glow.r, glow.g, glow.b, 0.06 * emphasis * alpha},
                  ui::Color{glow.r, glow.g, glow.b, 0.04 * emphasis * alpha});
    }

    // 5. Clear glass: the pixels already drawn beneath are seen 1:1 through the flat interior and bent at the rim.
    // The veil adapts to what is behind: almost nothing over a dark picture, more over a bright one, so labels stay
    // legible without the glass going grey. Frosted glass (Settings > Look) scatters the picture first.
    const bool lensKind = style.kind != ui::GlassKind::Card;
    const bool frosted = ui::tokens::frostedGlass;
    double behind = -1.0;
    if (!style.rimOnly && lensKind && lens_ != nullptr &&
        lens_->DrawRefraction(box, clampedRadius, alpha, frosted, &behind)) {
        // 0 over a dark picture, 1 over a bright one.
        const double bright = behind < 0.0 ? 0.5 : std::clamp((behind - 0.30) / 0.45, 0.0, 1.0);
        const double plate = style.focusPlate ? emphasis : 0.0;
        if (style.activeTab) {
            FillRoundRect(box, clampedRadius, white((isLight ? 0.86 : 0.74) - 0.05 * press));
        } else if (isLight) {
            // Light glass lifts toward white over dark pictures so dark labels keep their contrast.
            const double lift = cardOrPanel ? 0.55 : 0.12 + 0.26 * (1.0 - bright);
            FillRoundRect(box, clampedRadius, white(lift + (frosted ? 0.30 : 0.0) + 0.08 * emphasis - 0.05 * press));
        } else {
            const double shade = cardOrPanel ? 0.40 : 0.06 + 0.30 * bright;
            FillRoundRect(box, clampedRadius,
                          ui::Rgb(0x05070B, std::clamp(shade + (frosted ? 0.10 : 0.0) + 0.06 * press, 0.0, 1.0) * alpha));
            // Frosted glass carries a milky veil from light scattered inside it.
            FillRoundRect(box, clampedRadius, white((frosted ? 0.15 : 0.02) + 0.06 * emphasis - 0.02 * press));
        }
        if (style.tint.has_value() && !style.activeTab) {
            ui::Color tint = *style.tint;
            tint.a = std::min(0.04, tint.a) * alpha;
            FillRoundRect(box, clampedRadius, tint);
        }
        lens_->DrawRim(box, clampedRadius,
                       alpha * (1.0 + 0.3 * emphasis) * (1.0 - 0.3 * press) * (style.activeTab ? 0.6 : 1.0) *
                           (1.0 - 0.7 * plate));
        // Focus as on Apple TV: the glass fills with a bright plate, a touch brighter at the top.
        if (plate > 0.0) {
            const double top = (isLight ? 0.97 : 0.94) - 0.08 * press;
            fillVertical(box, clampedRadius,
                         {ui::GradientStop{0.0, white(top * plate)}, ui::GradientStop{1.0, white((top - 0.12) * plate)}});
        }
        // A soft sheen over the upper half, as PyGlass's GlassStyle draws it.
        const double sheen = ((style.activeTab ? 0.10 : 0.06) + 0.05 * emphasis - 0.03 * press) * (1.0 - plate);
        if (sheen > 0.0) {
            fillVertical(box, clampedRadius,
                         {ui::GradientStop{0.0, white(sheen)}, ui::GradientStop{0.55, white(0.0)},
                          ui::GradientStop{1.0, white(0.0)}});
        }
        // The focus highlight sweeps across once, a slanted band of light.
        if (style.sweep >= 0.0 && style.sweep <= 1.0 && !ui::tokens::reduceMotion) {
            const double band = std::max(box.height * 1.2, box.width * 0.35);
            const double centre = box.x - band + (box.width + 2.0 * band) * style.sweep;
            const double strength = 0.55 * std::sin(kSweepPi * style.sweep) * (plate > 0.0 ? 1.0 : 0.45);
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.0, white(0.0)},
                ui::GradientStop{0.5, isLight || plate > 0.0 ? ui::Rgb(0xFFFFFF, strength * alpha) : white(strength * 0.6)},
                ui::GradientStop{1.0, white(0.0)},
            });
            const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(centre - band / 2.0), static_cast<FLOAT>(box.y)),
                D2D1::Point2F(static_cast<FLOAT>(centre + band / 2.0), static_cast<FLOAT>(box.y + box.height * 0.35)));
            ComPtr<ID2D1LinearGradientBrush> brush;
            if (SUCCEEDED(target_->CreateLinearGradientBrush(props, stops.Get(), &brush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), brush.Get());
            }
        }
        if (style.kind == ui::GlassKind::Orb || style.activeTab) {
            const ui::Box inner{box.x + 1.5, box.y + 1.5, box.width - 3.0, box.height - 3.0};
            StrokeRoundRect(inner, std::max(0.0, clampedRadius - 1.5), 1.0,
                            white(style.activeTab || plate > 0.5 ? 0.30 : 0.05));
        }
        if (isLight && !style.activeTab) {
            const ui::Box rimBox{box.x - 0.5, box.y - 0.5, box.width + 1.0, box.height + 1.0};
            StrokeRoundRect(rimBox, clampedRadius + 0.5, 1.0, black(0.08));
        }
        edge(style.activeTab ? 1.0 : 0.9);
        return;
    }

    if (!style.rimOnly) {
        // 5. The picture behind, blurred, seen through the glass. A slightly magnified pass under the outer bevel
        // and an unmagnified core inside it read as the edge of a lens bending the light.
        const bool sampled = backdropBrush_ != nullptr && !style.activeTab;
        if (sampled) {
            const D2D1::Matrix3x2F base =
                D2D1::Matrix3x2F::Scale(static_cast<FLOAT>(backdropScale_), static_cast<FLOAT>(backdropScale_)) *
                D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(backdropOffsetX_), static_cast<FLOAT>(backdropOffsetY_));
            const D2D1_POINT_2F centre =
                D2D1::Point2F(static_cast<FLOAT>(box.CenterX()), static_cast<FLOAT>(box.CenterY()));
            const FLOAT lens = cardOrPanel ? 1.015f : 1.03f;
            backdropBrush_->SetTransform(base * D2D1::Matrix3x2F::Scale(lens, lens, centre));
            backdropBrush_->SetOpacity(static_cast<FLOAT>(alpha));
            target_->FillRoundedRectangle(ToRounded(box, clampedRadius), backdropBrush_.Get());
            const double bevel = std::min({2.5, box.width * 0.10, box.height * 0.10});
            if (bevel >= 1.0) {
                const ui::Box core{box.x + bevel, box.y + bevel, box.width - 2.0 * bevel, box.height - 2.0 * bevel};
                backdropBrush_->SetTransform(base);
                target_->FillRoundedRectangle(ToRounded(core, std::max(0.0, clampedRadius - bevel)),
                                              backdropBrush_.Get());
            }
            backdropBrush_->SetOpacity(1.0f);
        }

        // Cards with no picture yet keep their generated cinema canvas.
        if (style.kind == ui::GlassKind::Card && style.hue >= 0 && !isLight) {
            const double h = static_cast<double>(style.hue);
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.0, CinemaHsl(h + 18.0, 0.64, 0.19, 0.72 * alpha)},
                ui::GradientStop{0.55, CinemaHsl(h, 0.58, 0.11, 0.82 * alpha)},
                ui::GradientStop{1.0, ui::Rgb(0x060B14, 0.88 * alpha)},
            });
            const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES props = D2D1::LinearGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x), static_cast<FLOAT>(box.y)),
                D2D1::Point2F(static_cast<FLOAT>(box.Right()), static_cast<FLOAT>(box.Bottom())));
            ComPtr<ID2D1LinearGradientBrush> brush;
            if (SUCCEEDED(target_->CreateLinearGradientBrush(props, stops.Get(), &brush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), brush.Get());
            }
            const ComPtr<ID2D1GradientStopCollection> radStops = Stops({
                ui::GradientStop{0.0, CinemaHsl(h - 14.0, 0.78, 0.42, (0.24 + 0.10 * emphasis) * alpha)},
                ui::GradientStop{0.65, CinemaHsl(h, 0.65, 0.24, 0.10 * alpha)},
                ui::GradientStop{1.0, ui::Rgb(0x000000, 0.0)},
            });
            const D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES radProps = D2D1::RadialGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x + 0.72 * box.width),
                              static_cast<FLOAT>(box.y + 0.26 * box.height)),
                D2D1::Point2F(0.0f, 0.0f), static_cast<FLOAT>(box.width * 0.78), static_cast<FLOAT>(box.height * 0.68));
            ComPtr<ID2D1RadialGradientBrush> radBrush;
            if (SUCCEEDED(target_->CreateRadialGradientBrush(radProps, radStops.Get(), &radBrush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), radBrush.Get());
            }
        }

        // 6. A neutral veil keeps text legible over bright and dark pictures alike without tinting the glass.
        // The selected tab is its own lighter piece of glass, so dark text reads on it.
        if (style.activeTab) {
            if (backdropBrush_) {
                backdropBrush_->SetTransform(
                    D2D1::Matrix3x2F::Scale(static_cast<FLOAT>(backdropScale_), static_cast<FLOAT>(backdropScale_)) *
                    D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(backdropOffsetX_),
                                                  static_cast<FLOAT>(backdropOffsetY_)));
                backdropBrush_->SetOpacity(static_cast<FLOAT>(alpha));
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), backdropBrush_.Get());
                backdropBrush_->SetOpacity(1.0f);
            }
            FillRoundRect(box, clampedRadius, white((isLight ? 0.94 : 0.84) - 0.05 * press));
        } else if (isLight) {
            const double base = sampled ? (cardOrPanel ? 0.62 : 0.34) : (cardOrPanel ? 0.86 : 0.70);
            FillRoundRect(box, clampedRadius, white(base + 0.10 * emphasis - 0.06 * press));
        } else {
            const double dim = sampled ? (cardOrPanel ? 0.42 : 0.14) : (cardOrPanel ? 0.72 : 0.50);
            FillRoundRect(box, clampedRadius, ui::Rgb(0x0B0D12, std::clamp(dim + 0.08 * press, 0.0, 1.0) * alpha));
            FillRoundRect(box, clampedRadius, white(0.07 + 0.06 * emphasis - 0.03 * press));
        }
        // A caller's tint only colours the glass faintly, so it can echo the brand but never muddy the material.
        if (style.tint.has_value() && !style.activeTab) {
            ui::Color tint = *style.tint;
            tint.a = std::min(0.06, tint.a) * alpha;
            FillRoundRect(box, clampedRadius, tint);
        }

        // Apple TV focus on the frosted path too, so a darkened label always sits on a bright plate.
        if (style.focusPlate && emphasis > 0.0 && !style.activeTab) {
            const double top = (isLight ? 0.97 : 0.94) - 0.08 * press;
            fillVertical(box, clampedRadius,
                         {ui::GradientStop{0.0, white(top * emphasis)},
                          ui::GradientStop{1.0, white((top - 0.12) * emphasis)}});
        }

        // 7. A soft sheen across the upper half, where light enters the curved top of the glass.
        const double sheen = (style.activeTab ? 0.18 : (cardOrPanel ? 0.06 : 0.12)) + 0.06 * emphasis - 0.04 * press;
        fillVertical(box, clampedRadius,
                     {ui::GradientStop{0.0, white(sheen)}, ui::GradientStop{0.48, white(sheen * 0.15)},
                      ui::GradientStop{1.0, white(0.0)}});

        // The orb's small internal reflection, up and to the left.
        if (style.kind == ui::GlassKind::Orb) {
            const ComPtr<ID2D1GradientStopCollection> stops = Stops({
                ui::GradientStop{0.0, white(0.16 + 0.06 * emphasis)},
                ui::GradientStop{1.0, white(0.0)},
            });
            const D2D1_RADIAL_GRADIENT_BRUSH_PROPERTIES props = D2D1::RadialGradientBrushProperties(
                D2D1::Point2F(static_cast<FLOAT>(box.x + 0.34 * box.width),
                              static_cast<FLOAT>(box.y + 0.26 * box.height)),
                D2D1::Point2F(0.0f, 0.0f), static_cast<FLOAT>(box.width * 0.36),
                static_cast<FLOAT>(box.height * 0.26));
            ComPtr<ID2D1RadialGradientBrush> brush;
            if (SUCCEEDED(target_->CreateRadialGradientBrush(props, stops.Get(), &brush))) {
                target_->FillRoundedRectangle(ToRounded(box, clampedRadius), brush.Get());
            }
        }
    }

    // 8. The edge, with a faint inner glow just inside it so the surface reads as thick glass, not a flat outline.
    if (box.width > 6.0 && box.height > 6.0 && !style.rimOnly) {
        const ui::Box inner{box.x + 1.5, box.y + 1.5, box.width - 3.0, box.height - 3.0};
        StrokeRoundRect(inner, std::max(0.0, clampedRadius - 1.5), 1.0,
                        style.activeTab ? white(0.30) : white(0.035 + 0.03 * emphasis));
    }
    if (isLight && !style.activeTab) {
        // On a pale page a white edge alone vanishes, so a hairline of shade defines the shape.
        const ui::Box rim{box.x - 0.5, box.y - 0.5, box.width + 1.0, box.height + 1.0};
        StrokeRoundRect(rim, clampedRadius + 0.5, 1.0, black(0.08));
    }
    edge(style.activeTab ? 1.1 : 1.0);
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

bool D2dPainter::ImageContain(const ui::Box& box, const std::string& url) {
    if (images_ == nullptr) return false;
    const std::optional<paths::fs::path> file = ResolveFile(url);
    if (!file.has_value()) return false;
    ID2D1Bitmap* bitmap = images_->Get(target_, file->wstring());
    if (bitmap == nullptr) return false;
    const D2D1_SIZE_F size = bitmap->GetSize();
    if (size.width <= 0.0f || size.height <= 0.0f || box.width <= 0.0 || box.height <= 0.0) return false;
    // Contain-fit: the whole picture, as large as fits, centred; nothing of a logo is cropped.
    const double scale = std::min(box.width / size.width, box.height / size.height);
    const double width = size.width * scale;
    const double height = size.height * scale;
    const D2D1_RECT_F destination = D2D1::RectF(
        static_cast<FLOAT>(box.CenterX() - width / 2.0), static_cast<FLOAT>(box.CenterY() - height / 2.0),
        static_cast<FLOAT>(box.CenterX() + width / 2.0), static_cast<FLOAT>(box.CenterY() + height / 2.0));
    target_->DrawBitmap(bitmap, destination, 1.0f, D2D1_BITMAP_INTERPOLATION_MODE_LINEAR);
    return true;
}

ComPtr<ID2D1GradientStopCollection> D2dPainter::Stops(const std::vector<ui::GradientStop>& stops) {
    std::vector<D2D1_GRADIENT_STOP> raw;
    raw.reserve(stops.size());
    std::vector<float> key;
    key.reserve(stops.size() * 5);
    for (const ui::GradientStop& stop : stops) {
        raw.push_back(D2D1_GRADIENT_STOP{static_cast<FLOAT>(stop.position), ToColor(stop.color)});
        const D2D1_GRADIENT_STOP& added = raw.back();
        key.insert(key.end(), {added.position, added.color.r, added.color.g, added.color.b, added.color.a});
    }
    if (const auto cached = stopCache_.find(key); cached != stopCache_.end()) return cached->second;
    ComPtr<ID2D1GradientStopCollection> collection;
    if (raw.empty() ||
        FAILED(target_->CreateGradientStopCollection(raw.data(), static_cast<UINT32>(raw.size()), D2D1_GAMMA_1_0,
                                                     D2D1_EXTEND_MODE_CLAMP, &collection))) {
        throw std::runtime_error("could not create a gradient");
    }
    // Animated gradients make new stops every frame, so the cache is bounded.
    if (stopCache_.size() < 256) stopCache_.emplace(std::move(key), collection);
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

void D2dPainter::FillRoundRectLinear(const ui::Box& box, double radius, double x0, double y0, double x1, double y1,
                                     const std::vector<ui::GradientStop>& stops) {
    const ComPtr<ID2D1GradientStopCollection> collection = Stops(stops);
    const D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES properties = D2D1::LinearGradientBrushProperties(
        D2D1::Point2F(static_cast<FLOAT>(x0), static_cast<FLOAT>(y0)),
        D2D1::Point2F(static_cast<FLOAT>(x1), static_cast<FLOAT>(y1)));
    ComPtr<ID2D1LinearGradientBrush> brush;
    if (FAILED(target_->CreateLinearGradientBrush(properties, collection.Get(), &brush))) {
        throw std::runtime_error("could not create a gradient brush");
    }
    target_->FillRoundedRectangle(ToRounded(box, radius), brush.Get());
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
    if (viewBox <= 0.0) return;
    // A glyph is parsed once and its geometry reused on every later frame.
    const std::string cacheKey = std::string(data) + (style.fill.a > 0.0 ? "#filled" : "#hollow");
    ComPtr<ID2D1PathGeometry> geometry = graphics_.CachedPath(cacheKey);
    if (!geometry && !BuildPath(data, style.fill.a > 0.0, geometry)) return;
    if (graphics_.CachedPath(cacheKey) == nullptr) graphics_.CachePath(cacheKey, geometry);
    DrawPath(box, viewBox, geometry.Get(), style);
}

bool D2dPainter::BuildPath(std::string_view data, bool filled, ComPtr<ID2D1PathGeometry>& geometry) {
    if (FAILED(graphics_.d2d()->CreatePathGeometry(&geometry))) return false;
    ComPtr<ID2D1GeometrySink> sink;
    if (FAILED(geometry->Open(&sink))) return false;

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

    const D2D1_FIGURE_BEGIN fill = filled ? D2D1_FIGURE_BEGIN_FILLED : D2D1_FIGURE_BEGIN_HOLLOW;
    D2D1_POINT_2F current{0.0f, 0.0f};
    D2D1_POINT_2F start{0.0f, 0.0f};
    bool open = false;
    char command = 'M';
    // The last curve's second control point, so S and T can mirror it.
    D2D1_POINT_2F lastControl{0.0f, 0.0f};
    char lastCurve = 0;
    while (true) {
        skip();
        if (at >= data.size()) break;
        if (std::isalpha(static_cast<unsigned char>(data[at]))) command = data[at++];
        const bool relative = std::islower(static_cast<unsigned char>(command)) != 0;
        const FLOAT ox = relative ? current.x : 0.0f;
        const FLOAT oy = relative ? current.y : 0.0f;
        const int kind = std::toupper(static_cast<unsigned char>(command));
        if (kind != 'C' && kind != 'S') lastCurve = 0;
        switch (kind) {
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
        case 'C':
        case 'S': {
            // Cubic curves; S takes its first control point mirrored from the last curve's.
            const char upper = static_cast<char>(std::toupper(static_cast<unsigned char>(command)));
            D2D1_POINT_2F first = current;
            if (upper == 'C') {
                const FLOAT x1 = number();
                const FLOAT y1 = number();
                first = D2D1::Point2F(ox + x1, oy + y1);
            } else if (lastCurve == 'C') {
                first = D2D1::Point2F(2.0f * current.x - lastControl.x, 2.0f * current.y - lastControl.y);
            }
            const FLOAT x2 = number();
            const FLOAT y2 = number();
            const FLOAT x = number();
            const FLOAT y = number();
            const D2D1_POINT_2F second = D2D1::Point2F(ox + x2, oy + y2);
            current = D2D1::Point2F(ox + x, oy + y);
            sink->AddBezier(D2D1::BezierSegment(first, second, current));
            lastControl = second;
            lastCurve = 'C';
            continue;
        }
        case 'Q': {
            const FLOAT x1 = number();
            const FLOAT y1 = number();
            const FLOAT x = number();
            const FLOAT y = number();
            const D2D1_POINT_2F control = D2D1::Point2F(ox + x1, oy + y1);
            current = D2D1::Point2F(ox + x, oy + y);
            sink->AddQuadraticBezier(D2D1::QuadraticBezierSegment(control, current));
            lastCurve = 0;
            continue;
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
    return SUCCEEDED(sink->Close());
}

void D2dPainter::DrawPath(const ui::Box& box, double viewBox, ID2D1PathGeometry* geometry, const ui::PathStyle& style) {
    const auto scale = static_cast<FLOAT>(std::min(box.width, box.height) / viewBox);
    const D2D1_MATRIX_3X2_F fit =
        D2D1::Matrix3x2F::Scale(style.mirror ? -scale : scale, scale) *
        D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(style.mirror ? box.x + viewBox * scale : box.x),
                                      static_cast<FLOAT>(box.y));
    D2D1_MATRIX_3X2_F previous{};
    target_->GetTransform(&previous);
    target_->SetTransform(fit * previous);
    if (style.fill.a > 0.0) target_->FillGeometry(geometry, Brush(style.fill));
    if (style.stroke.a > 0.0 && style.strokeWidth > 0.0) {
        target_->DrawGeometry(geometry, Brush(style.stroke), static_cast<FLOAT>(style.strokeWidth),
                              graphics_.RoundStroke());
    }
    target_->SetTransform(previous);
}

void D2dPainter::PushClip(const ui::Box& box) {
    target_->PushAxisAlignedClip(ToRect(box), D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
    ++clipDepth_;
    clipLayers_.push_back(false);
}

void D2dPainter::PopClip() {
    if (clipDepth_ <= 0) return;
    const bool layer = !clipLayers_.empty() && clipLayers_.back();
    if (!clipLayers_.empty()) clipLayers_.pop_back();
    if (layer) {
        target_->PopLayer();
    } else {
        target_->PopAxisAlignedClip();
    }
    --clipDepth_;
}

ComPtr<ID2D1PathGeometry> D2dPainter::Polyline(const std::vector<ui::Point>& points, bool closed) {
    ComPtr<ID2D1PathGeometry> geometry;
    if (points.size() < 2 || FAILED(graphics_.d2d()->CreatePathGeometry(&geometry))) return nullptr;
    ComPtr<ID2D1GeometrySink> sink;
    if (FAILED(geometry->Open(&sink))) return nullptr;
    sink->BeginFigure(D2D1::Point2F(static_cast<FLOAT>(points[0].x), static_cast<FLOAT>(points[0].y)),
                      closed ? D2D1_FIGURE_BEGIN_FILLED : D2D1_FIGURE_BEGIN_HOLLOW);
    for (std::size_t i = 1; i < points.size(); ++i) {
        sink->AddLine(D2D1::Point2F(static_cast<FLOAT>(points[i].x), static_cast<FLOAT>(points[i].y)));
    }
    sink->EndFigure(closed ? D2D1_FIGURE_END_CLOSED : D2D1_FIGURE_END_OPEN);
    if (FAILED(sink->Close())) return nullptr;
    return geometry;
}

void D2dPainter::PushGeometryLayer(ID2D1Geometry* mask, double opacity) {
    ComPtr<ID2D1Layer> layer;
    if (FAILED(target_->CreateLayer(nullptr, &layer))) {
        // Without a layer nothing is clipped; the pop still pairs, as an empty axis-aligned clip would not.
        target_->PushAxisAlignedClip(D2D1::RectF(-1e6f, -1e6f, 1e6f, 1e6f), D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
        ++clipDepth_;
        clipLayers_.push_back(false);
        return;
    }
    target_->PushLayer(D2D1::LayerParameters(D2D1::InfiniteRect(), mask, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE,
                                             D2D1::IdentityMatrix(), static_cast<FLOAT>(opacity)),
                       layer.Get());
    ++clipDepth_;
    clipLayers_.push_back(true);
}

void D2dPainter::PushClipStroke(const std::vector<ui::Point>& points, double width) {
    // The band is the line widened by the stroke: a geometry of its own, used as the layer's mask.
    const ComPtr<ID2D1PathGeometry> line = Polyline(points, false);
    ComPtr<ID2D1PathGeometry> band;
    ComPtr<ID2D1GeometrySink> sink;
    if (!line || FAILED(graphics_.d2d()->CreatePathGeometry(&band)) || FAILED(band->Open(&sink)) ||
        FAILED(line->Widen(static_cast<FLOAT>(width), graphics_.RoundStroke(), nullptr,
                           D2D1_DEFAULT_FLATTENING_TOLERANCE, sink.Get())) ||
        FAILED(sink->Close())) {
        // Nothing to show through: an empty clip.
        target_->PushAxisAlignedClip(D2D1::RectF(0.0f, 0.0f, 0.0f, 0.0f), D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
        ++clipDepth_;
        clipLayers_.push_back(false);
        return;
    }
    PushGeometryLayer(band.Get(), 1.0);
}

void D2dPainter::PushClipPolygons(const std::vector<std::vector<ui::Point>>& polygons) {
    ComPtr<ID2D1PathGeometry> geometry;
    ComPtr<ID2D1GeometrySink> sink;
    bool ok = SUCCEEDED(graphics_.d2d()->CreatePathGeometry(&geometry)) && SUCCEEDED(geometry->Open(&sink));
    if (ok) {
        sink->SetFillMode(D2D1_FILL_MODE_WINDING);
        for (const std::vector<ui::Point>& polygon : polygons) {
            if (polygon.size() < 3) continue;
            sink->BeginFigure(D2D1::Point2F(static_cast<FLOAT>(polygon[0].x), static_cast<FLOAT>(polygon[0].y)),
                              D2D1_FIGURE_BEGIN_FILLED);
            for (std::size_t i = 1; i < polygon.size(); ++i) {
                sink->AddLine(D2D1::Point2F(static_cast<FLOAT>(polygon[i].x), static_cast<FLOAT>(polygon[i].y)));
            }
            sink->EndFigure(D2D1_FIGURE_END_CLOSED);
        }
        ok = SUCCEEDED(sink->Close());
    }
    if (!ok) {
        target_->PushAxisAlignedClip(D2D1::RectF(0.0f, 0.0f, 0.0f, 0.0f), D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
        ++clipDepth_;
        clipLayers_.push_back(false);
        return;
    }
    PushGeometryLayer(geometry.Get(), 1.0);
}

void D2dPainter::StrokePolyline(const std::vector<ui::Point>& points, double width, ui::Color color, bool closed) {
    const ComPtr<ID2D1PathGeometry> line = Polyline(points, closed);
    if (!line) return;
    target_->DrawGeometry(line.Get(), Brush(color), static_cast<FLOAT>(width), graphics_.RoundStroke());
}

void D2dPainter::PushOpacity(double opacity) {
    ComPtr<ID2D1Layer> layer;
    if (FAILED(target_->CreateLayer(nullptr, &layer))) {
        opacityLayers_.push_back(false);
        return;
    }
    target_->PushLayer(D2D1::LayerParameters(D2D1::InfiniteRect(), nullptr, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE,
                                             D2D1::IdentityMatrix(), static_cast<FLOAT>(std::clamp(opacity, 0.0, 1.0))),
                       layer.Get());
    opacityLayers_.push_back(true);
}

void D2dPainter::PopOpacity() {
    if (opacityLayers_.empty()) return;
    if (opacityLayers_.back()) target_->PopLayer();
    opacityLayers_.pop_back();
}

}  // namespace tvm::platform
