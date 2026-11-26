#include "platform/app.h"

#include <algorithm>
#include <set>
#include <atomic>
#include <shlwapi.h>
#include "catalog/cinemeta.h"
#include "core/profiles.h"
#include "core/config.h"
#include "core/util.h"

namespace tvm::platform {
void App::PrepareHls(playback::Resolution& resolution, int height) const {
    if (!resolution.ok() || resolution.url.substr(0, resolution.url.find('?')).find(".m3u8") == std::string::npos) return;
    try {
        if (resolution.bestHeight > 0) height = std::min(height, resolution.bestHeight);
        http::Options options; options.timeoutMs = 6000; options.maxBytes = 1024 * 1024;
        options.followRedirects = false;
        auto address = resolution.url;
        std::optional<http::Response> response;
        for (int hop = 0; hop < 5; ++hop) {
            response = http::Get(address, options);
            if (!response || response->status < 300 || response->status >= 400 || response->location.empty()) break;
            wchar_t combined[32768]{}; DWORD count = static_cast<DWORD>(std::size(combined));
            if (FAILED(UrlCombineW(util::ToWide(address).c_str(), util::ToWide(response->location).c_str(), combined, &count, 0))) return;
            address = util::ToUtf8(combined);
            if (!http::IsWebUrl(address)) return;
        }
        if (!response || !response->ok()) return;
        const auto selected = playback::SelectHls(response->body, address, height);
        if (!selected) return;
        static std::atomic<unsigned> sequence{0};
        const auto file = dataDir_ / "cache" / "hls" / (std::to_string(GetCurrentProcessId()) + "-" + std::to_string(++sequence) + ".m3u8");
        util::WriteFileAtomically(file, selected->master);
        resolution.hlsSource = resolution.url;
        resolution.hlsHeight = selected->height;
        resolution.hlsHeights = selected->heights;
        resolution.url = util::ToUtf8(file.wstring());
        resolution.choices.clear();
        for (int available : selected->heights) resolution.choices.push_back({std::to_string(available) + "p", "", "", available});
    } catch (...) { /* A missing or unreadable master still plays through mpv. */ }
}

void App::SwitchHls(int height) {
    if (playerHlsSource_.empty() || playerHlsSwitching_) return;
    playerHlsSwitching_ = true;
    const auto generation = ++playerGeneration_;
    const auto source = playerHlsSource_;
    playerRetryAt_ = playerLive_ ? std::nullopt : std::optional<double>(playerView_.position);
    background_->Run([this, generation, source, height, cap = playerPlanHeight_] {
        playback::Resolution resolution; resolution.url = source; resolution.bestHeight = cap;
        PrepareHls(resolution, height);
        background_->PostToUi([this, generation, resolution] {
            if (generation != playerGeneration_ || !playerOpen_) return;
            playerHlsSwitching_ = false;
            if (resolution.hlsHeight == 0) return;
            mpv_->Stop();
            FinishResolve(generation, resolution);
            playerStallSince_ = 0; playerHealthySince_ = 0;
        });
    });
}

void App::SyncReleaseNotice(double nowMs) {
    if (!releaseNotice_ || !releaseNotice_->Pending()) return;
    if (shell_->ActiveScreenName() != "home" || streamLane_ != "all" || intro_->Animating()) {
        shell_->SetReleaseCard(std::nullopt); return;
    }
    // Whether the notes come as a pop-up is the account service's call (flags.patchNotesPopup), asked once.
    if (patchPopupFlag_ < 0) {
        if (!patchPopupAsked_) {
            patchPopupAsked_ = true;
            background_->Run([this] {
                int flag = 0;
                try {
                    const auto config = core_->Call("/api/config");
                    if (config.contains("flags") && config["flags"].is_object()) flag = config["flags"].value("patchNotesPopup", false) ? 1 : 0;
                } catch (...) {}
                patchPopupFlag_ = flag;
            });
        }
        return;
    }
    releaseNotice_->Show(nowMs);
    const auto data = content_->Read("changelog");
    if (!data.contains("releases")) return;
    if (patchPopupFlag_ == 1 && !shell_->HasPatchNotes() && !data["releases"].empty()) {
        const auto& release = data["releases"][0];
        ui::Shell::PatchNotes notes;
        notes.version = release.value("version", "");
        notes.title = release.value("title", "");
        const auto strings = [](const nlohmann::json& list, std::vector<std::string>& out) {
            if (!list.is_array()) return;
            for (const auto& line : list) if (line.is_string()) out.push_back(line.get<std::string>());
        };
        strings(release.value("highlights", nlohmann::json::array()), notes.highlights);
        if (release.contains("changes") && release["changes"].is_array())
            for (const auto& change : release["changes"]) {
                ui::Shell::PatchChange entry;
                if (change.is_string()) {
                    entry.text = change.get<std::string>();
                } else if (change.is_object() && change.contains("text") && change["text"].is_string()) {
                    entry.text = change["text"].get<std::string>();
                    entry.area = change.value("area", "");
                    if (change.contains("platforms") && change["platforms"].is_array())
                        for (const auto& platform : change["platforms"]) if (platform.is_string()) entry.platforms.push_back(platform.get<std::string>());
                } else {
                    continue;
                }
                notes.changes.push_back(std::move(entry));
            }
        strings(release.value("knownIssues", nlohmann::json::array()), notes.knownIssues);
        shell_->SetReleaseCard(std::nullopt);
        shell_->SetPatchNotes(std::move(notes));
        dirty_ = true;
        return;
    }
    if (patchPopupFlag_ == 1) return;
    for (const auto& release : data["releases"]) if (release.value("version", "") == config::kCoreVersion) {
        ui::Shell::ReleaseCard card;
        card.version = config::kCoreVersion;
        if (card.version.ends_with(".0")) card.version.resize(card.version.size() - 2);
        card.title = release.value("title", "");
        for (const auto& highlight : release["highlights"]) if (highlight.is_string() && card.highlights.size() < 4) card.highlights.push_back(highlight.get<std::string>());
        shell_->SetReleaseCard(card); dirty_ = true; break;
    }
}
void App::DismissReleaseNotice(double nowMs) {
    if (!releaseNotice_ || !releaseNotice_->Input(nowMs)) return;
    try { util::WriteFileAtomically(dataDir_ / "last-seen-version", releaseNotice_->Seen()); } catch (...) {}
    shell_->SetReleaseCard(std::nullopt); shell_->SetPatchNotes(std::nullopt); dirty_ = true;
}
void App::AskProfilePin(const ui::Command& pending, const std::string& id) {
    pendingProfileAction_ = pending;
    ui::Command open; open.name = "pin-pad"; open.modal = true;
    shell_->Execute(open, NowMs());
    const auto registry = profiles::Load(dataDir_);
    for (const auto& profile : registry.profiles) if (profile.id == id) {
        if (auto* editor = dynamic_cast<ui::ProfileEditor*>(&shell_->ActiveScreen())) editor->Challenge(id, profile.name);
    }
    dirty_ = true;
}
void App::OpenProfileEditor(const std::string& id) {
    ui::ProfileEntry entry;
    const auto registry = profiles::Load(dataDir_);
    for (const auto& profile : registry.profiles) if (profile.id == id) {
        entry.id = profile.id; entry.name = profile.name; entry.hue = profile.hue;
        entry.avatar = profile.avatar; entry.kind = profile.kind; entry.maxAge = profile.maxAge; entry.locked = !profile.pin.is_null();
    }
    ui::Command open; open.name = "profile-editor";
    shell_->Execute(open, NowMs());
    std::string featured;
    const auto events = content_->Read("events");
    if (events.contains("events")) for (const auto& event : events["events"]) if (content::EventLive(event, content::LocalDate())) { featured = event.value("avatarSet", ""); break; }
    if (auto* editor = dynamic_cast<ui::ProfileEditor*>(&shell_->ActiveScreen())) editor->SetProfile(entry, content_->Read("avatars"), featured);
    dirty_ = true;
}
void App::RefreshProfilePolicy() {
    ++extrasEpoch_; upcomingRail_ = {}; extrasHomeBusy_ = false; extrasHomeCheckedMs_ = -600000;
    extrasPrefs_ = {}; extrasStats_ = nlohmann::json::object();
    const auto profile = profiles::Active(dataDir_);
    profileMaxAge_ = profile ? profile->maxAge : 18;
    kidsProfile_ = profile && profile->kind == "kids";
    titles_.clear(); titlesInFlight_.clear(); shownTitle_.reset(); hubs_.clear();
    ++searchGeneration_;
    std::erase_if(searchResults_, [this](const auto& item) { return !Allowed(item); });
}
bool App::Allowed(const catalog::MediaItem& item) const {
    return content::Allows(parental_, profileMaxAge_, item.genres);
}
void App::FilterView(ui::SceneView& view) const {
    for (auto& rail : view.rails) std::erase_if(rail.cards, [this](const auto& card) {
        for (const auto& item : bundle_.catalog) if (item.id == card.itemId) return !Allowed(item);
        for (const auto& shelf : shelves_) {
            for (const auto& item : shelf.movies) if (item.id == card.itemId) return !Allowed(item);
            for (const auto& item : shelf.shows) if (item.id == card.itemId) return !Allowed(item);
        }
        const auto title = titles_.find(card.itemId);
        return profileMaxAge_ < 18 && title != titles_.end() && !Allowed(title->second.media);
    });
    std::erase_if(view.rails, [](const auto& rail) { return rail.cards.empty(); });
}
void App::RefreshContent() {
    contentCheckedMs_ = NowMs();
    contentDate_ = content::LocalDate();
    background_->Run([this, date = contentDate_, age = profileMaxAge_] {
        content_->Refresh();
        std::vector<ui::HeroData> heroes;
        std::vector<ui::RailData> rails;
        const auto data = content_->Read("events");
        if (data.contains("events")) for (const auto& event : data["events"]) {
            if (!content::EventLive(event, date)) continue;
            const auto meta = catalog_->Meta(event.value("imdbId", ""));
            if (!meta || !content::Allows(parental_, age, meta->item.genres)) continue;
            ui::HeroData hero;
            hero.itemId = meta->item.id;
            hero.title = event.value("title", meta->item.title);
            hero.backdropUrl = meta->item.backdrop;
            hero.meta = content::EventKicker(event, date);
            hero.body = event.value("line", "");
            hero.playLabel = "Watch the saga";
            ui::Command saga;
            saga.name = "event-rail";
            saga.action = true;
            saga.params["id"] = event["rail"].value("id", "");
            hero.playCommand = saga;
            hero.infoLabel = "Details";
            const std::string accent = event.value("accent", "#2f6bff");
            try { hero.accent = ui::Rgb(static_cast<std::uint32_t>(std::stoul(accent.substr(1), nullptr, 16))); } catch (...) {}
            hero.rating = meta->item.rating;
            hero.logoUrl = meta->logo;
            heroes.push_back(hero);
            ui::RailData rail;
            rail.id = event["rail"].value("id", "");
            rail.title = event["rail"].value("title", "Catch up");
            rail.loop = true;
            std::set<std::string> ids;
            for (const auto& id : event["rail"]["items"]) {
                if (!id.is_string()) continue;
                const auto item = catalog_->Meta(id.get<std::string>());
                if (!item || !content::Allows(parental_, age, item->item.genres) || !ids.insert(item->item.id).second) continue;
                rail.cards.push_back(ui::CardData{item->item.id, item->item.title, item->item.poster, std::nullopt});
            }
            if (!rail.cards.empty()) rails.push_back(std::move(rail));
        }
        background_->PostToUi([this, age, heroes = std::move(heroes), rails = std::move(rails)] {
            if (age != profileMaxAge_) return;
            eventHeroes_ = heroes;
            eventRails_ = rails;
            RebuildHome();
            ApplyLiveTv();
            dirty_ = true;
        });
    });
}
void App::PageRails() {
    if (shell_->ActiveScreenName() != "home" || IsPageLane(streamLane_)) return;
    for (const auto& id : home_->RailsNearEnd()) {
        auto& page = railPages_[id];
        if (!page.more || page.busy) continue;
        page.busy = true;
        std::string genre;
        for (const auto& rail : catalog::GenreRails()) if (rail.id == id) genre = rail.genre;
        // Cinemeta's popular rails use the same paged top catalogue as genre rails.
        const std::string kind = id == "series" || id == "top-series" || id == "new-series" ? "series" : "movie";
        const auto skip = page.skip;
        const std::string catalogue = id == "top-films" || id == "top-series" ? "imdbRating" : id == "new-series" ? "last-videos" : "top";
        background_->Run([this, id, genre, kind, skip, catalogue] {
            auto items = catalog_->Genre(kind, genre, skip, catalogue);
            std::size_t next = items.size();
            if (!genre.empty()) {
                const auto shows = catalog_->Genre("series", genre, skip);
                next = std::max(next, shows.size());
                items.insert(items.end(), shows.begin(), shows.end());
            }
            background_->PostToUi([this, id, skip, next, items = std::move(items)] {
                auto& state = railPages_[id];
                state.busy = false;
                std::set<std::string> ids;
                for (const auto& old : state.items) ids.insert(old.id);
                std::size_t added = 0;
                for (const auto& item : items) if (ids.insert(item.id).second) { state.items.push_back(item); ++added; }
                state.more = next > 0 && added > 0;
                state.skip = skip + next;
                RebuildHome();
            });
        });
    }
}
}  // namespace tvm::platform
