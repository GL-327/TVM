#include "platform/d2d_painter.h"

#include <d2d1effects.h>

#include "platform/video_texture.h"

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
    target_->SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
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
    using ui::Color;
    using ui::GradientStop;
    using ui::Rgb;
    namespace tokens = ui::tokens;

    glassInk_.reset();
    const double alpha = std::clamp(style.opacity * (style.disabled ? 0.40 : 1.0), 0.0, 1.0);
    if (alpha <= 0.0 || box.width <= 0.0 || box.height <= 0.0) return;
    radius = std::clamp(radius, 0.0, std::min(box.width, box.height) / 2.0);
    const bool light = tokens::kBackground.r > 0.5;
    const bool solid = style.solid || style.reduceTransparency || tokens::reduceTransparency;
    const bool card = style.kind == ui::GlassKind::Card;
    const bool sheet = style.kind == ui::GlassKind::Panel || style.frosted;
    const bool hoverPlate = style.focusPlate && style.kind == ui::GlassKind::Tab;
    const bool clearPill = !solid && style.kind == ui::GlassKind::Pill && style.adaptiveInk;
    const double focus = std::clamp(style.focusAmount > 0.0 ? style.focusAmount : (style.focused ? 1.0 : 0.0), 0.0, 1.0);
    const double press = std::clamp(style.pressAmount > 0.0 ? style.pressAmount : (style.pressed ? 1.0 : 0.0), 0.0, 1.0);
    const auto white = [alpha](double a) { return Rgb(0xFFFFFF, a * alpha); };
    const auto black = [alpha](double a) { return Rgb(0x000000, a * alpha); };

    if (card && style.rimOnly && !style.focused) {
        Color border = style.border.value_or(tokens::kBorderSoft);
        border.a *= alpha;
        StrokeRoundRect(box, radius, 1.0, border);
        return;
    }

    if (!hoverPlate && !style.activeTab) {
        const double depth = (0.30 + 0.19 * focus) * (1.0 - 0.35 * press);
        // Card shadows are clipped by their rail viewport. Keep those in the padded rail rather than
        // allocating a displacement map as each poster grows.
        if (card || !lens_ || !lens_->DrawShadow(box, radius, depth * alpha, 2.0 * focus)) {
            for (const double spread : {9.0, 5.0, 2.0}) {
                const ui::Box shadow{box.x - spread, box.y - spread + 4.0, box.width + 2.0 * spread,
                                     box.height + 2.0 * spread};
                if (style.rimOnly) StrokeRoundRect(shadow, radius + spread, 2.0 * spread / 3.0, black(depth * 0.20));
                else FillRoundRect(shadow, radius + spread, black(depth * 0.20));
            }
        }
    }

    if (!style.rimOnly) {
        if (style.activeTab || (style.selected && !style.solid)) {
            Color fill = style.activeTab ? Rgb(0xF5F7FA, 0.94) : style.tint.value_or(tokens::kPrimary);
            fill.a *= alpha;
            FillRoundRect(box, radius, fill);
            if (style.activeTab) glassInk_ = Rgb(0x111318);
        } else if (hoverPlate) {
            FillRoundRect(box, radius, light ? black(0.10) : white(0.11));
        } else if (card) {
            const double h = static_cast<double>(std::max(0, style.hue));
            FillRoundRectLinear(box, radius, box.Right(), box.y, box.x, box.Bottom(),
                                {{0.0, solid || light ? tokens::kSurfaceHover : CinemaHsl(h, 0.44, 0.18, alpha)},
                                 {1.0, solid || light ? tokens::kSurface : CinemaHsl(h + 12.0, 0.48, 0.055, alpha)}});
        } else if (solid) {
            Color fill = style.tint.value_or(tokens::kSurface);
            fill.a = style.solid ? fill.a * alpha : alpha;
            FillRoundRect(box, radius, fill);
        } else {
            double behind = -1.0;
            const bool captured = lens_ && clipDepth_ == 0 && opacityLayers_.empty() &&
                                  lens_->DrawRefraction(box, radius, alpha, sheet, &behind);
            if (!captured) {
                // The artwork source supplies the optical fallback for bitmap targets and the video overlay.
                if (backdropBrush_) {
                    const auto base = D2D1::Matrix3x2F::Scale(static_cast<float>(backdropScale_), static_cast<float>(backdropScale_)) *
                                      D2D1::Matrix3x2F::Translation(static_cast<float>(backdropOffsetX_), static_cast<float>(backdropOffsetY_));
                    const auto centre = D2D1::Point2F(static_cast<float>(box.CenterX()), static_cast<float>(box.CenterY()));
                    backdropBrush_->SetOpacity(static_cast<float>(0.55 * alpha));
                    backdropBrush_->SetTransform(base * D2D1::Matrix3x2F::Scale(1.07f, 1.12f, centre));
                    target_->FillRoundedRectangle(ToRounded(box, radius), backdropBrush_.Get());
                    const double bezel = std::min(14.0, 0.22 * std::min(box.width, box.height));
                    const ui::Box core{box.x + bezel, box.y + bezel, box.width - 2.0 * bezel, box.height - 2.0 * bezel};
                    backdropBrush_->SetTransform(base);
                    target_->FillRoundedRectangle(ToRounded(core, std::max(0.0, radius - bezel)), backdropBrush_.Get());
                }
                // Video in mpv's separate window can't be sampled. Give its controls a clear wash.
                Color fallback = style.tint.value_or(tokens::kSurface);
                fallback.a = alpha * (backdropBrush_ ? (sheet ? 0.52 : clearPill ? 0.25 : 0.40) : (sheet ? 0.78 : 0.62));
                FillRoundRect(box, radius, fallback);
            } else if (behind >= 0.0) {
                const double bright = std::clamp((behind - 0.26) / 0.42, 0.0, 1.0);
                const double dim = 0.13 * bright;
                const double lift = 0.07 * (1.0 - bright);
                FillRoundRect(box, radius, black(dim));
                FillRoundRect(box, radius, white(lift));
                if (style.adaptiveInk) {
                    const double shown = std::min(1.0, behind * 1.05) * (1.0 - dim) * (1.0 - lift) + lift;
                    glassInk_ = shown >= 0.46 ? Rgb(0x000000) : Rgb(0xFFFFFF);
                } else if (sheet) {
                    // Light translucent wash keeps bloom waves visible through PyGlass sheets.
                    Color tint = tokens::kSurface;
                    tint.a = alpha * (light ? 0.34 : 0.18 * bright);
                    FillRoundRect(box, radius, tint);
                }
            }
        }
    }

    if (!card && !hoverPlate && !style.activeTab) {
        FillRoundRectLinear(box, radius, box.x, box.y, box.x, box.Bottom(),
                            {{0.0, white(0.11)}, {0.34, white(0.025)}, {1.0, white(0.0)}});
        if (tokens::pointer && !tokens::reduceMotion && !solid && focus > 0.001) {
            const auto point = *tokens::pointer;
            const auto stops = Stops({{0.0, white(0.10 * focus)}, {1.0, white(0.0)}});
            const auto props = D2D1::RadialGradientBrushProperties(
                D2D1::Point2F(static_cast<float>(point.x), static_cast<float>(point.y)), D2D1::Point2F(), 120.0f, 120.0f);
            ComPtr<ID2D1RadialGradientBrush> bloom;
            if (SUCCEEDED(target_->CreateRadialGradientBrush(props, stops.Get(), &bloom)))
                target_->FillRoundedRectangle(ToRounded(box, radius), bloom.Get());
        }
    }
    if (!hoverPlate && !card && !style.activeTab) {
        const double rim = alpha * (0.88 + 0.12 * focus) * (1.0 - 0.15 * press);
        const ui::Box contour{box.x - 0.5, box.y - 0.5, box.width + 1.0, box.height + 1.0};
        StrokeRoundRect(contour, radius + 0.5, 1.0, black(0.18));
        if (lens_ && clipDepth_ == 0) {
            lens_->DrawRim(box, radius, rim, (clearPill ? 0.32 : 0.18) * alpha);
        } else {
            const auto stops = Stops({{0.0, white(0.75 * rim)}, {0.46, white(0.15 * rim)},
                                      {0.62, white(0.15 * rim)}, {1.0, white(0.35 * rim)}});
            const auto props = D2D1::LinearGradientBrushProperties(
                D2D1::Point2F(static_cast<float>(box.x), static_cast<float>(box.y)),
                D2D1::Point2F(static_cast<float>(box.Right()), static_cast<float>(box.Bottom())));
            ComPtr<ID2D1LinearGradientBrush> edge;
            if (SUCCEEDED(target_->CreateLinearGradientBrush(props, stops.Get(), &edge)))
                target_->DrawRoundedRectangle(ToRounded(box, radius), edge.Get(), 1.0f);
        }
    }
    if (style.focused && style.ringColor) {
        const double width = style.ringWidth > 0.0 ? style.ringWidth : 2.0;
        const double outset = style.ringOutset;
        const ui::Box ring{box.x - outset, box.y - outset, box.width + 2.0 * outset, box.height + 2.0 * outset};
        Color ink = *style.ringColor;
        ink.a *= alpha * (card ? 1.0 : 0.72);
        StrokeRoundRect(ring, radius + outset, width, ink);
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

bool D2dPainter::HeroVideo(const ui::Box& box, double opacity, double focusX, double focusY) {
    if (auto* preview = VideoTexture::Current()) return preview->Draw(target_, box, opacity, focusX, focusY);
    return false;
}

void D2dPainter::BeginLightParticles() {
    if (FAILED(target_->QueryInterface(IID_PPV_ARGS(&particleContext_)))) return;
    previousParticleBlend_ = particleContext_->GetPrimitiveBlend();
    particleContext_->SetPrimitiveBlend(D2D1_PRIMITIVE_BLEND_ADD);
}

void D2dPainter::EndLightParticles() {
    if (particleContext_) particleContext_->SetPrimitiveBlend(previousParticleBlend_);
    particleContext_.Reset();
}

bool D2dPainter::SpotlightLogo(const ui::Box& box, const std::string& url, double opacity, double blur, double sweep) {
    if (!images_) return false;
    const auto file = ResolveFile(url);
    ID2D1Bitmap* bitmap = file ? images_->Get(target_, file->wstring()) : nullptr;
    if (!bitmap) return false;
    if (opacity <= 0.0) return true;
    const auto size = bitmap->GetSize();
    if (size.width <= 0.0f || size.height <= 0.0f) return false;
    const double scale = std::min(box.width / size.width, box.height / size.height);
    const double width = size.width * scale;
    const double height = size.height * scale;
    const ui::Box image{box.x, box.CenterY() - height / 2.0, width, height};
    bool blurred = false;
    if (blur > 0.15) {
        ComPtr<ID2D1DeviceContext> dc;
        ComPtr<ID2D1Effect> diffusion;
        if (SUCCEEDED(target_->QueryInterface(IID_PPV_ARGS(&dc))) &&
            SUCCEEDED(dc->CreateEffect(CLSID_D2D1GaussianBlur, &diffusion))) {
            diffusion->SetInput(0, bitmap);
            diffusion->SetValue(D2D1_GAUSSIANBLUR_PROP_STANDARD_DEVIATION, static_cast<float>(blur / scale));
            D2D1_MATRIX_3X2_F old;
            dc->GetTransform(&old);
            PushOpacity(opacity);
            const auto transform = D2D1::Matrix3x2F::Scale(static_cast<float>(scale), static_cast<float>(scale)) *
                                   D2D1::Matrix3x2F::Translation(static_cast<float>(image.x), static_cast<float>(image.y));
            dc->SetTransform(transform);
            dc->DrawImage(diffusion.Get(), D2D1::Point2F(0.0f, 0.0f));
            dc->SetTransform(old);
            PopOpacity();
            blurred = true;
        }
    }
    if (!blurred) target_->DrawBitmap(bitmap, ToRect(image), static_cast<float>(opacity), D2D1_BITMAP_INTERPOLATION_MODE_LINEAR);
    if (sweep > 0.0 && sweep < 1.0) {
        const double x = image.x + image.width * (1.5 * sweep - 0.24);
        const float band = static_cast<float>(std::max(28.0, image.width * 0.18));
        const auto from = D2D1::Point2F(static_cast<float>(x) - band, static_cast<float>(image.y));
        const auto to = D2D1::Point2F(static_cast<float>(x) + band, static_cast<float>(image.y + image.height * 0.32));
        const auto stops = Stops({{0.0, ui::Rgb(0xFFFFFF, 0.0)}, {0.52, ui::Rgb(0xFFFFFF, 0.51 * opacity)},
                                  {1.0, ui::Rgb(0xFFFFFF, 0.0)}});
        ComPtr<ID2D1LinearGradientBrush> light;
        if (SUCCEEDED(target_->CreateLinearGradientBrush(D2D1::LinearGradientBrushProperties(from, to), stops.Get(), &light))) {
            const auto prior = target_->GetAntialiasMode();
            target_->SetAntialiasMode(D2D1_ANTIALIAS_MODE_ALIASED);
            const D2D1_RECT_F dest = ToRect(image);
            target_->FillOpacityMask(bitmap, light.Get(), D2D1_OPACITY_MASK_CONTENT_GRAPHICS, &dest);
            target_->SetAntialiasMode(prior);
        }
    }
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

void D2dPainter::DrawLabel(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color,
                            bool wrap) {
    if (text.empty() || color.a <= 0.0 || box.width <= 0.0 || box.height <= 0.0) return;
    const std::wstring wide = util::ToWide(std::string(text));
    const int weight = WeightOf(style);
    const ui::Box snapped{std::round(box.x), std::round(box.y), box.width, box.height};
    if (style.trackingEm != 0.0 || style.tabular) {
        const auto layout = graphics_.TextLayout(wide, style, weight, static_cast<float>(box.width),
                                                  static_cast<float>(box.height), wrap);
        if (layout) target_->DrawTextLayout(D2D1::Point2F(static_cast<float>(snapped.x), static_cast<float>(snapped.y)),
                                            layout.Get(), Brush(color), D2D1_DRAW_TEXT_OPTIONS_CLIP);
        return;
    }
    IDWriteTextFormat* format = wrap ? graphics_.ParagraphFormat(style.sizePx, weight)
                                    : graphics_.TextFormat(style.sizePx, weight);
    target_->DrawTextW(wide.c_str(), static_cast<UINT32>(wide.size()), format, ToRect(snapped), Brush(color),
                       D2D1_DRAW_TEXT_OPTIONS_CLIP, DWRITE_MEASURING_MODE_NATURAL);
}

void D2dPainter::Paragraph(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) {
    DrawLabel(box, text, style, color, true);
}

void D2dPainter::Text(const ui::Box& box, std::string_view text, const ui::TextStyle& style, ui::Color color) {
    DrawLabel(box, text, style, color, false);
}

double D2dPainter::MeasureText(std::string_view text, const ui::TextStyle& style) {
    return graphics_.MeasureText(text, style, WeightOf(style));
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

void D2dPainter::PushLinearOpacity(double y0, double y1, double topAlpha, double bottomAlpha) {
    ComPtr<ID2D1Layer> layer;
    const ComPtr<ID2D1GradientStopCollection> stops =
        Stops({ui::GradientStop{0.0, ui::Rgb(0xFFFFFF, std::clamp(topAlpha, 0.0, 1.0))},
               ui::GradientStop{1.0, ui::Rgb(0xFFFFFF, std::clamp(bottomAlpha, 0.0, 1.0))}});
    ComPtr<ID2D1LinearGradientBrush> mask;
    if (FAILED(target_->CreateLayer(nullptr, &layer)) || !stops ||
        FAILED(target_->CreateLinearGradientBrush(
            D2D1::LinearGradientBrushProperties(D2D1::Point2F(0.0f, static_cast<FLOAT>(y0)),
                                                D2D1::Point2F(0.0f, static_cast<FLOAT>(std::max(y1, y0 + 1.0)))),
            stops.Get(), &mask))) {
        opacityLayers_.push_back(false);
        return;
    }
    target_->PushLayer(D2D1::LayerParameters(D2D1::InfiniteRect(), nullptr, D2D1_ANTIALIAS_MODE_PER_PRIMITIVE,
                                             D2D1::IdentityMatrix(), 1.0f, mask.Get()),
                       layer.Get());
    opacityLayers_.push_back(true);
}

void D2dPainter::PushTranslate(double dx, double dy) {
    D2D1_MATRIX_3X2_F current{};
    target_->GetTransform(&current);
    transforms_.push_back(current);
    target_->SetTransform(current * D2D1::Matrix3x2F::Translation(static_cast<FLOAT>(dx), static_cast<FLOAT>(dy)));
}

void D2dPainter::PopTranslate() {
    if (transforms_.empty()) return;
    target_->SetTransform(transforms_.back());
    transforms_.pop_back();
}

void D2dPainter::PopOpacity() {
    if (opacityLayers_.empty()) return;
    if (opacityLayers_.back()) target_->PopLayer();
    opacityLayers_.pop_back();
}

}  // namespace tvm::platform
