#pragma once

// Details for one title, from apps/ui/src/screens/Details.tsx and details.css: the backdrop with its
// vignette, the poster, the Series or Film kicker, the title, the metadata line, the buttons and the
// synopsis. A film has Play; a series has its seasons as tabs, and the season's episodes as rows with
// their stills, and OK on an episode plays it. The page scrolls with the focus and with the wheel.
// Until the catalogue answers the screen says it is loading, and when it cannot answer it says so.

#include <optional>
#include <string>
#include <vector>

#include "motion/tween.h"
#include "ui/button_focus.h"
#include "ui/catalog_view.h"
#include "ui/screen_base.h"

namespace tvm::ui {

class DetailsScreen final : public ScreenBase {
public:
    // `title` is what the opened card showed, used until the catalogue answers.
    DetailsScreen(std::string id, std::string title);

    void Layout(double width, double height) override;
    void Paint(Painter& painter) const override;
    bool Tick(double nowMs) override;
    bool Animating() const override;

    // The catalogue's answer for this title.
    void SetInfo(TitleInfo info);

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override;
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;
    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;
    std::optional<ScrollSurface> SurfaceAt(double x, double y, nav::Axis axis) const override;
    void SetScroll(const ScrollSurface& surface, double value, double nowMs) override;
    void AnimateScroll(const ScrollSurface& surface, double target, double nowMs) override;

    const std::string& id() const { return id_; }
    const TitleInfo& info() const { return info_; }
    bool IsSeries() const;
    // The seasons, in order, and the season whose episodes show.
    std::vector<int> Seasons() const;
    int Season() const { return season_; }
    // The episodes of the season that shows.
    std::vector<const catalog::MediaItem*> Episodes() const;
    // Every focusable item's box, at the current scroll.
    std::optional<Box> BoxOf(const std::string& key) const;
    double Scroll() const { return scroll_; }

private:
    bool HasListButton() const;
    std::vector<std::string> ActionKeys() const;
    std::vector<std::string> SeasonKeys() const;
    std::string MetaLine() const;
    std::optional<Command> Activate(const std::string& key);
    double Rem(double rems) const { return rems * height_ / 67.5; }
    double HeroHeight() const { return height_ * 0.62; }
    double ContentHeight() const;
    double MaxScroll() const;
    // Moves the page so the focused item is in view.
    void FollowFocus(double nowMs);
    void ScrollTo(double target, double nowMs);

    std::string id_;
    std::string title_;
    TitleInfo info_;
    std::string focused_ = "play";
    int season_ = 0;
    ButtonFocusSet buttonFocus_;
    double clockMs_ = 0.0;
    double width_ = 0.0;
    double height_ = 0.0;
    double scroll_ = 0.0;
    std::optional<motion::Tween> scrollTween_;
};

}  // namespace tvm::ui
