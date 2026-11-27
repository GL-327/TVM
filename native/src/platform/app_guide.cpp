#include <cmath>
#include "platform/app.h"

#include <windowsx.h>
#include <algorithm>
#include <ctime>

#include "core/js.h"
#include "core/util.h"

namespace tvm::platform {

bool App::GuideActive() const {
    const auto screen = shell_->ActiveScreenName();
    return guideVisible_ && !liveChoosing_ && (screen == "live-tv" || (screen == "home" && streamLane_ == "live"));
}

void App::TickGuide(double now) {
    if (!GuideActive()) {
        // Closing the guide ends the waiting for a feed; the next visit starts counting again.
        guideRepoll_ = false;
        guideRepolls_ = 0;
        return;
    }
    const auto utc = static_cast<guide::Time>(std::time(nullptr));
    if (utc / 60 != guideClock_ / 60) dirty_ = true;
    guideClock_ = utc;
    if (!guideDigits_.empty() && now >= guideTuneAt_) {
        const auto id = guide_.Tune(std::exchange(guideDigits_, ""));
        if (!id.empty()) WatchGuideChannel(id);
    }
    const auto start = guide_.start();
    if (!guideFetching_ && now >= guideRetryAt_ &&
        (start == 0 || start < guideLoadedStart_ || guide_.end() > guideLoadedEnd_ || guideRepoll_)) RefreshGuide();
}

void App::RefreshGuide() {
    guideFetching_ = true;
    guideRepoll_ = false;
    const auto visible = guide_.start() == 0 ? guide::FloorHalfHour(guideClock_) : guide_.start();
    const auto start = visible - 2 * 3600;
    const auto end = start + 12 * 3600;
    const auto epoch = extrasEpoch_;
    std::vector<guide::Channel> fallback;
    int number = 0;
    for (const auto& channel : liveCatalog_.channels) {
        if (!content::AllowsLive(parental_, profileMaxAge_, live::GroupOf(channel))) continue;
        if (!account_.liveTv && !channel.id.starts_with("live:free:")) continue;
        fallback.push_back({channel.id, std::to_string(++number), channel.name, channel.logo.value_or(""), live::GroupOf(channel), channel.source, {}});
    }
    background_->Run([this, epoch, visible, start, end, fallback] {
        guide::Schedule data;
        bool received = false;
        try {
            data = guide::ParseSchedule(core_->Call("/api/live/guide?start=" + js::EncodeUriComponent(guide::IsoTime(start)) + "&hours=12"), start, end);
            received = true;
        } catch (...) {}
        background_->PostToUi([this, epoch, visible, start, end, received, data = std::move(data), fallback]() mutable {
            guideFetching_ = false;
            if (epoch != extrasEpoch_ || !GuideActive()) return;
            std::erase_if(data.channels, [this](const auto& row) {
                return !content::AllowsLive(parental_, profileMaxAge_, row.group) ||
                       (!account_.liveTv && row.source != "free" && !row.id.starts_with("live:free:"));
            });
            for (const auto& channel : fallback) {
                if (std::none_of(data.channels.begin(), data.channels.end(), [&](const auto& row) { return row.id == channel.id; }))
                    data.channels.push_back(channel);
            }
            for (const auto& row : data.channels) {
                QueueArtwork(row.logo);
                if (!row.group.empty() && std::find(data.groups.begin(), data.groups.end(), row.group) == data.groups.end())
                    data.groups.push_back(row.group);
            }
            guideLoadedStart_ = received ? data.start : start;
            guideLoadedEnd_ = received ? data.end : end;
            guideRetryAt_ = NowMs() + 1000;
            // Core answers while it is still downloading a feed, with channels but few programmes. Ask again in a
            // few seconds; SetSchedule keeps the focused channel and time, so the cell the viewer is on stays put.
            if (received && guide::ShouldRepoll(data.refreshing, guideRepolls_)) {
                ++guideRepolls_;
                guideRepoll_ = true;
                guideRetryAt_ = NowMs() + guide::kRepollMs;
            } else if (received && !data.refreshing) {
                guideRepolls_ = 0;
            }
            guide_.SetSchedule(std::move(data), visible);
            dirty_ = true;
        });
    });
}

void App::WatchGuideChannel(const std::string& id) {
    if (!id.empty()) {
        guideSearch_ = false;
        shell_->Execute(ui::Command{false, "player", {{"id", id}}, false}, NowMs());
        dirty_ = true;
    }
}

bool App::HandleGuideKey(WPARAM key) {
    using Move = guide::View::Move;
    if (guideSearch_) {
        if (key == VK_ESCAPE || key == VK_RETURN) guideSearch_ = false;
        else if (key == VK_BACK && !guide_.query().empty()) {
            auto query = util::ToWide(guide_.query());
            if (!query.empty()) query.pop_back();
            guide_.Search(util::ToUtf8(query));
        }
        dirty_ = true;
        if (key != VK_UP && key != VK_DOWN) return true;
        guideSearch_ = false;
    }
    switch (key) {
    case VK_LEFT: guide_.Navigate(Move::Left); break;
    case VK_RIGHT: guide_.Navigate(Move::Right); break;
    case VK_UP: guide_.Navigate(Move::Up); break;
    case VK_DOWN: guide_.Navigate(Move::Down); break;
    case VK_PRIOR: guide_.Navigate(Move::PageUp); break;
    case VK_NEXT: guide_.Navigate(Move::PageDown); break;
    case VK_RETURN: WatchGuideChannel(guide_.SelectedId()); break;
    case VK_ESCAPE: case VK_BROWSER_BACK: case VK_BACK:
        if (shell_->ActiveScreenName() == "live-tv") shell_->Back(NowMs());
        else OpenStreamTab("all");
        break;
    case VK_F3: case VK_OEM_2: guideSearch_ = true; guide_.Search(""); break;
    case 'C': guideVisible_ = false; break;
    case 'G': guide_.CycleGroup(); break;
    case VK_HOME: guide_.SelectDay(0, guideClock_); break;
    default:
        if (key >= VK_NUMPAD0 && key <= VK_NUMPAD9) key = key - VK_NUMPAD0 + '0';
        if (key >= '0' && key <= '9') {
            if (guideDigits_.size() == 6) guideDigits_.clear();
            guideDigits_ += static_cast<char>(key);
            guideTuneAt_ = NowMs() + 1500;
        }
        break;
    }
    dirty_ = true;
    return true;
}

double App::GuideInset() const {
    // On the Live TV lane of Home the navigation pill stays over the guide; the guide starts under it.
    if (home_ == nullptr || shell_->ActiveScreenName() != "home") return 0.0;
    return std::ceil(home_->NavChromeHeight());
}

void App::LayoutGuide() {
    RECT client{};
    GetClientRect(window_, &client);
    guideInset_ = GuideInset();
    guide_.Layout(static_cast<double>(client.right - client.left),
                  std::max(0.0, static_cast<double>(client.bottom - client.top) - guideInset_));
}

bool App::HandleGuideMouse(UINT message, WPARAM buttons, LPARAM point) {
    if (message == WM_MOUSEMOVE) {
        auto cursor = ClientPoint(point);
        // Keep the shell's pointer state in sync when moving between the guide and its navigation tabs.
        if (cursor.x != lastMouse_.x || cursor.y != lastMouse_.y) {
            lastMouse_ = cursor;
            shell_->ShowPointer();
        }
        dirty_ = guide_.Hover(cursor.x, cursor.y - static_cast<LONG>(guideInset_)) || dirty_;
    } else if (message == WM_MOUSELEAVE) {
        dirty_ = guide_.Hover(-1, -1) || dirty_;
    } else if (message == WM_LBUTTONUP) {
        const auto cursor = ClientPoint(point);
        const auto action = guide_.Click(cursor.x, cursor.y - static_cast<LONG>(guideInset_), guideClock_);
        if (action == "@search") { guideSearch_ = true; guide_.Search(""); }
        else if (action == "@channels") guideVisible_ = false;
        else if (action == "@back") HandleGuideKey(VK_ESCAPE);
        else if (!action.empty()) WatchGuideChannel(action);
        dirty_ = true;
    } else if (message == WM_MOUSEWHEEL || message == WM_MOUSEHWHEEL) {
        const int ticks = GET_WHEEL_DELTA_WPARAM(buttons) / WHEEL_DELTA;
        if (message == WM_MOUSEHWHEEL || (GET_KEYSTATE_WPARAM(buttons) & MK_SHIFT)) guide_.ScrollTime(-ticks);
        else guide_.ScrollRows(-ticks);
        dirty_ = true;
    }
    return true;
}

} // namespace tvm::platform
