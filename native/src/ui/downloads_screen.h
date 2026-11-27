#pragma once

// Downloads: a compact sheet over the page it was opened from.
//   - A header with the title's backdrop, poster, name and what it is.
//   - The choices as compact dropdowns: what to download (series only), season and episode, audio language, and the
//     highest quality.
//   - The folder, with a readable path and Change.
//   - A prominent Download button that says what it will fetch.
//   - The downloads as cards with a status, a progress bar, and Cancel or Show file.
//   - An empty state when there are none.
//
// It only shows what the app gives it (DownloadsView) and asks the app to act with the same "info:dl-*" commands the
// old page used, so the download engine, its queue, the folder picker and the saved choices are unchanged. Choices
// picked from a list send "info:dl-set-<field>" with the row's index.

#include <cstddef>
#include <optional>
#include <string>
#include <vector>

#include "motion/tween.h"
#include "ui/button_focus.h"
#include "ui/dropdown.h"
#include "ui/screen_base.h"

namespace tvm::ui {

struct DownloadJobView {
    int id = 0;
    std::string title;
    // queued, resolving, downloading, complete, failed or cancelled.
    std::string state;
    // From 0 to 1 while the size is known, else negative.
    double progress = -1.0;
    // "1.2 GB of 4.0 GB", "Finding your file…", "No English source", the file's folder…
    std::string status;
    bool canCancel = false;
    bool canShow = false;

    bool operator==(const DownloadJobView&) const = default;
};

// One of the choices: its heading, its rows, and which row is chosen.
struct DownloadChoice {
    std::string field;  // scope, season, episode, language or quality
    std::string heading;
    std::vector<std::string> options;
    std::size_t chosen = 0;

    bool operator==(const DownloadChoice&) const = default;
};

struct DownloadsView {
    // Empty when the page was opened without a title (just the list of downloads).
    std::string title;
    std::string subtitle;
    std::string posterUrl;
    std::string backdropUrl;
    std::vector<DownloadChoice> choices;
    std::string folder;
    std::string startLabel;
    bool startEnabled = false;
    // "Loading episodes…", "No episodes are available to download yet."
    std::string status;
    std::string message;
    bool messageBad = false;
    // The strict audio rule, said plainly under the button.
    std::string note;
    std::vector<DownloadJobView> jobs;

    bool operator==(const DownloadsView&) const = default;
};

class DownloadsScreen final : public ScreenBase {
public:
    void SetView(DownloadsView view);
    const DownloadsView& view() const { return view_; }

    void Layout(double width, double height) override;
    bool Tick(double nowMs) override;
    bool Animating() const override;
    // The ribbon stage is only for the Hub and the profile chooser.
    bool ShowsStage() const override { return false; }
    void Paint(Painter& painter) const override;

    bool Navigate(nav::Direction direction, double nowMs) override;
    std::optional<Command> Select(double nowMs) override;
    std::optional<std::string> FocusedKey() const override { return focused_; }
    bool FocusItem(const std::string& key, double nowMs, bool withCamera) override;
    std::optional<std::string> ItemAt(double x, double y) const override;
    std::optional<Command> ActivateItem(const std::string& key, double nowMs) override;
    std::optional<ScrollSurface> SurfaceAt(double x, double y, nav::Axis axis) const override;
    void SetScroll(const ScrollSurface& surface, double value, double nowMs) override;
    void AnimateScroll(const ScrollSurface& surface, double target, double nowMs) override;
    bool CloseOverlay(double nowMs) override;

    // Exposed for tests: every key in focus order, each one's box, and the open list.
    std::vector<std::string> Keys() const;
    std::optional<Box> BoxOf(const std::string& key) const;
    const Dropdown& List() const { return list_; }
    Box SheetBox() const;

private:
    struct Layout_ {
        Box sheet;
        Box header;
        std::vector<std::pair<std::string, Box>> items;
        double contentHeight = 0.0;
        double choicesTop = 0.0;
        double jobsTop = 0.0;
        double noteTop = 0.0;
        double messageTop = 0.0;
        double statusTop = 0.0;
    };
    Layout_ Arrange() const;
    double Rem(double rems) const;
    double MaxScroll() const;
    std::optional<Command> Activate(const std::string& key, double nowMs);
    void FollowFocus();
    void PaintHeader(Painter& painter, const Layout_& layout) const;
    void PaintChoice(Painter& painter, const DownloadChoice& choice, const Box& box) const;
    void PaintJob(Painter& painter, const DownloadJobView& job, const Box& box) const;

    DownloadsView view_;
    double width_ = 0.0;
    double height_ = 0.0;
    double clockMs_ = 0.0;
    double scroll_ = 0.0;
    std::string focused_;
    ButtonFocusSet focus_;
    Dropdown list_;
    // The field whose list is open.
    std::string listField_;
};

}  // namespace tvm::ui
