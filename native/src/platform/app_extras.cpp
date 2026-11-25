#include "platform/app.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <sstream>
#include "core/js.h"
#include "core/profiles.h"
#include "core/util.h"

namespace tvm::platform {
namespace {
ui::InfoAction Button(std::string key, std::string label, bool selected = false, bool disabled = false) {
    ui::InfoAction action; action.key = std::move(key); action.label = std::move(label);
    action.primary = selected; action.disabled = disabled; return action;
}
std::string Query(const std::string& id, const std::string& title) {
    const auto play = playback::ParsePlayId(id);
    if (!play) return "";
    auto query = "?id=" + js::EncodeUriComponent(play->imdb) + "&title=" + js::EncodeUriComponent(title);
    if (play->season) query += "&season=" + std::to_string(*play->season);
    if (play->episode) query += "&episode=" + std::to_string(*play->episode);
    return query;
}
std::string Languages(const extras::Preferences& prefs, bool names = true) {
    std::string text;
    for (const auto& language : prefs.languages) { if (!text.empty()) text += ", "; const auto name = mpv::LanguageName(language); text += names && !name.empty() ? name : language; }
    return text;
}
ui::InfoBlock Row(std::string label, std::string value) {
    return {ui::InfoBlock::Kind::Row, std::move(label), std::move(value), false, false};
}
std::string Hours(double seconds) {
    char value[48]{}; std::snprintf(value, sizeof(value), "%.1f hours", std::max(0.0, seconds) / 3600.0); return value;
}
}

void App::RefreshExtrasHome() {
    if (!account_.usable || extrasHomeBusy_ || NowMs() - extrasHomeCheckedMs_ < 300000) return;
    extrasHomeBusy_ = true; extrasHomeCheckedMs_ = NowMs();
    const auto epoch = extrasEpoch_;
    background_->Run([this, epoch, prefs = extrasPrefs_]() mutable {
        ui::RailData rail; rail.id = "extras-upcoming"; rail.title = "New episodes this week";
        try { prefs = extras::ParsePreferences(core_->Call("/api/prefs")); } catch (...) {}
        try {
            const auto body = core_->Call("/api/extras/upcoming/home");
            if (body.contains("items") && body["items"].is_array()) for (const auto& entry : body["items"]) {
                if (!entry.is_object() || !entry.contains("item")) continue;
                const auto item = catalog::FromJson(entry["item"]);
                if (!item) continue;
                ui::CardData card{item->id, item->title, item->poster, std::nullopt};
                card.subtitle = extras::UpcomingLabel(entry.value("next", nlohmann::json()));
                rail.cards.push_back(std::move(card));
            }
        } catch (...) {}
        background_->PostToUi([this, epoch, rail, prefs] {
            if (epoch != extrasEpoch_) return;
            extrasHomeBusy_ = false; upcomingRail_ = rail; extrasPrefs_ = prefs;
            QueueRailArtwork({rail}); RebuildHome(); dirty_ = true;
        });
    });
}

void App::LoadPlayerExtras(int generation, const playback::Resolution& resolution) {
    if (playerLive_) return;
    const auto query = Query(playerId_, playerView_.title);
    if (query.empty()) return;
    playerSegments_ = extras::ParseSegments(resolution.segments);
    const auto known = titles_.find(SaveId());
    bool anime = false;
    if (known != titles_.end()) for (const auto& genre : known->second.genres) if (genre == "Anime" || genre == "anime" || genre == "Animation" || genre == "animation") anime = true;
    background_->Run([this, generation, query, anime, prefs = extrasPrefs_]() mutable {
        try { prefs = extras::ParsePreferences(core_->Call("/api/prefs")); } catch (...) {}
        extras::Segments segments{};
        try { segments = extras::ParseSegments(core_->Call("/api/extras/segments" + query + (anime ? "&anime=1" : "&anime=0"))); } catch (...) {}
        background_->PostToUi([this, generation, segments, prefs] {
            if (generation != playerGeneration_ || !playerOpen_) return;
            extrasPrefs_ = prefs;
            LoadPreferredSubtitle();
            for (std::size_t i = 0; i < segments.size(); ++i) if (segments[i]) playerSegments_[i] = segments[i];
        });
    });
    background_->Run([this, generation, query, subtitles = resolution.subtitles] () mutable {
        // A timed-out playback enrichment is retried without holding up the picture.
        if (subtitles.empty()) try { subtitles = core_->Call("/api/extras/subtitles" + query).value("subtitles", nlohmann::json::array()); } catch (...) {}
        if (!subtitles.is_array()) return;
        std::set<std::string> urls;
        std::vector<ExternalSubtitle> tracks;
        for (const auto& track : subtitles) {
            try {
                if (!track.is_object()) continue;
                const auto url = track.value("url", std::string());
                if (url.empty() || !urls.insert(url).second) continue;
                const auto language = track.value("language", track.value("lang", std::string()));
                const auto label = track.value("label", language.empty() ? "Subtitles" : language);
                tracks.push_back({"", label, language, url});
            } catch (...) {}
        }
        background_->PostToUi([this, generation, tracks] {
            if (generation != playerGeneration_ || !playerOpen_) return;
            externalSubtitles_ = tracks;
            LoadPreferredSubtitle();
        });
    });
}

void App::LoadPreferredSubtitle() {
    const auto preferred = subtitleChoice_.empty() ? extrasPrefs_.languages : std::vector<std::string>{subtitleChoice_};
    for (const auto& language : preferred) for (std::size_t i = 0; i < externalSubtitles_.size(); ++i) {
        const auto& track = externalSubtitles_[i];
        if (track.language == language || (!mpv::LanguageName(language).empty() && mpv::LanguageName(track.language) == mpv::LanguageName(language))) {
            RequestSubtitle(i); return;
        }
    }
}

void App::RequestSubtitle(std::size_t index) {
    if (index >= externalSubtitles_.size() || externalSubtitles_[index].loading || externalSubtitles_[index].loaded) return;
    externalSubtitles_[index].loading = true;
    auto subtitle = externalSubtitles_[index]; const auto generation = playerGeneration_;
    background_->Run([this, generation, index, subtitle] () mutable {
        try {
            const auto file = dataDir_ / "cache" / "native-subtitles" /
                (std::to_string(GetCurrentProcessId()) + "-" + std::to_string(generation) + "-" + std::to_string(index) + ".vtt");
            util::WriteFileAtomically(file, core_->Subtitle(subtitle.url));
            subtitle.file = util::ToUtf8(file.wstring());
        } catch (...) {}
        background_->PostToUi([this, generation, index, subtitle] {
            if (generation != playerGeneration_ || !playerOpen_ || index >= externalSubtitles_.size()) return;
            externalSubtitles_[index].loading = false;
            if (!subtitle.file.empty()) { externalSubtitles_[index].loaded = true; pendingSubtitles_.push_back(subtitle); }
        });
    });
}

void App::ApplyExtrasState(const mpv::State& state) {
    if (playerLive_ || !state.started) return;
    if (!pendingSubtitles_.empty()) {
        for (const auto& subtitle : pendingSubtitles_) {
            const auto preferred = subtitleChoice_.empty() ? extrasPrefs_.languages.front() : subtitleChoice_;
            const bool select = subtitle.language == preferred || (!mpv::LanguageName(preferred).empty() && mpv::LanguageName(subtitle.language) == mpv::LanguageName(preferred));
            mpv_->AddSubtitle(subtitle.file, subtitle.label, subtitle.language, select);
            if (select) subtitlePreferenceApplied_ = true;
        }
        pendingSubtitles_.clear();
    }
    if (!subtitlePreferenceApplied_) {
        const auto preferred = subtitleChoice_.empty() ? extrasPrefs_.languages.front() : subtitleChoice_;
        if (preferred == "off") { mpv_->SetProperty("sid", "no"); subtitlePreferenceApplied_ = true; }
        else for (const auto& track : state.tracks) if (track.type == "sub" && (track.lang == preferred || (!mpv::LanguageName(track.lang).empty() && mpv::LanguageName(track.lang) == mpv::LanguageName(preferred)))) {
            mpv_->SetProperty("sid", track.id); subtitlePreferenceApplied_ = true; break;
        }
    }
    const auto skip = segmentSession_.Update(playerSegments_, state.position, playerView_.duration, NowMs(), state.paused || mpv::Buffering(state) ? "off" : extrasPrefs_.skip);
    playerView_.recap = skip.visible;
    playerView_.skipLabel = skip.label;
    playerView_.recapEnd = skip.target;
    playerView_.credits = false;
    if (skip.automatic && !state.paused && !mpv::Buffering(state)) mpv_->SeekTo(skip.target);

    const double duration = playerView_.duration;
    const double trigger = playerSegments_[2] ? playerSegments_[2]->start : std::max(0.0, duration - 30.0);
    const bool ready = nextEpisode_.has_value() && !nextDismissed_ && duration > 0 && state.position >= trigger;
    playerView_.nextUp = ready;
    playerView_.nextWindow = 10;
    playerView_.nextRemaining = nextCountdown_.Update(ready, !state.paused && !mpv::Buffering(state), NowMs());
    playerView_.nextAutoplay = extrasPrefs_.autoplay;
}

void App::LoadExtrasPage() {
    const auto epoch = extrasEpoch_; const auto page = pageName_;
    pageBusy_ = true;
    background_->Run([this, epoch, page] {
        nlohmann::json data;
        try { data = core_->Call(page == "stats" ? "/api/extras/stats" : "/api/prefs"); } catch (...) {}
        background_->PostToUi([this, epoch, page, data] {
            if (epoch != extrasEpoch_ || pageName_ != page) return;
            pageBusy_ = false;
            if (page == "stats") extrasStats_ = data;
            else if (data.is_object()) extrasPrefs_ = extras::ParsePreferences(data);
            if (page == "extras-settings") {
                fieldValues_[page + ".languages"] = Languages(extrasPrefs_, false);
            }
            ShowInfoPage();
            if (auto* screen = TypingPage()) screen->SetFieldText(fieldValues_[page + ".languages"]);
        });
    });
}

ui::InfoView App::ExtrasView() const {
    ui::InfoView view; view.kicker = "Playback"; view.heading = "TVM Extras";
    view.lede = "Skip segments, choose subtitles and keep watching.";
    view.message = pageMessage_; view.messageBad = pageMessageBad_;
    view.blocks = {Row("Skip intro, recap and credits", extrasPrefs_.skip == "off" ? "Off" : extrasPrefs_.skip == "auto" ? "Auto" : "Button"),
        Row("Autoplay next episode", extrasPrefs_.autoplay ? "On" : "Off"), Row("Preferred subtitle languages", Languages(extrasPrefs_))};
    view.filters = {{Button("info:extras-skip-off", "Off", extrasPrefs_.skip == "off", pageBusy_),
        Button("info:extras-skip-button", "Button", extrasPrefs_.skip == "button", pageBusy_),
        Button("info:extras-skip-auto", "Auto", extrasPrefs_.skip == "auto", pageBusy_)}};
    view.field = true; view.fieldLabel = "Custom subtitle language list (optional)";
    view.fieldPlaceholder = "eng, fra, spa (English, French, Spanish)";
    view.blocks.push_back({ui::InfoBlock::Kind::Paragraph, "Choose preferred languages below, or enter a custom list. Languages are tried in the order you add them. The subtitle menu in the player remembers your chosen language for this profile.", "", false, false});
    view.actions = {{Button("info:extras-autoplay", extrasPrefs_.autoplay ? "Turn autoplay off" : "Turn autoplay on", false, pageBusy_),
        Button("info:extras-languages", "Save languages", true, pageBusy_)}};
    const char* languages[] = {"eng", "fra", "spa", "deu", "ita", "por", "jpn", "kor", "zho", "ara", "hin", "nld", "pol", "ron", "rus", "swe", "tur", "ukr", "vie"};
    std::vector<ui::InfoAction> row;
    for (const auto* language : languages) {
        const bool selected = std::find(extrasPrefs_.languages.begin(), extrasPrefs_.languages.end(), language) != extrasPrefs_.languages.end();
        auto name = mpv::LanguageName(language); if (name.empty()) name = language;
        row.push_back(Button("info:extras-language-" + std::string(language), name, selected, pageBusy_));
        if (row.size() == 4) { view.actions.push_back(row); row.clear(); }
    }
    if (!row.empty()) view.actions.push_back(row);
    view.topActions = {Button("back", "Back")}; return view;
}

ui::InfoView App::StatsView() const {
    ui::InfoView view; view.kicker = "This profile"; view.heading = "Your stats";
    view.lede = "Watch history stays on this device.";
    view.topActions = {Button("back", "Back")};
    if (!extrasStats_.is_object()) return view;
    view.blocks = {Row("This week", Hours(extrasStats_.value("week", 0.0))), Row("This month", Hours(extrasStats_.value("month", 0.0))),
        Row("All time", Hours(extrasStats_.value("all", 0.0))), Row("Titles finished", std::to_string(extrasStats_.value("finished", 0))),
        Row("Current streak", std::to_string(extrasStats_.value("streakDays", 0)) + " days")};
    if (extrasStats_.contains("topGenres") && extrasStats_["topGenres"].is_array()) for (const auto& genre : extrasStats_["topGenres"])
        if (genre.is_object()) view.blocks.push_back(Row(genre.value("genre", ""), Hours(genre.value("seconds", 0.0))));
    view.blocks.push_back({ui::InfoBlock::Kind::Heading, "Watch history", "", false, false});
    if (extrasStats_.contains("history") && extrasStats_["history"].is_array()) for (const auto& entry : extrasStats_["history"]) {
        if (!entry.is_object() || !entry.contains("item")) continue;
        const auto item = catalog::FromJson(entry["item"]);
        if (!item) continue;
        view.blocks.push_back(Row(item->title, entry.value("at", "").substr(0, 10) + " - " + Hours(entry.value("seconds", 0.0))));
    }
    view.actions = {{Button("info:extras-clear", pageConfirm_ ? "Confirm clear history" : "Clear history", false, pageBusy_)}};
    view.message = pageConfirm_ ? "Clear this profile's viewing statistics and watch history?" : pageMessage_;
    return view;
}

void App::ExtrasAction(const std::string& verb) {
    if (pageBusy_) return;
    const bool clear = verb == "clear";
    if (clear && !pageConfirm_) { pageConfirm_ = true; ShowInfoPage(); return; }
    nlohmann::json patch = nlohmann::json::object();
    if (verb.starts_with("skip-")) patch["skipSegments"] = verb.substr(5);
    else if (verb == "autoplay") patch["autoplayNext"] = !extrasPrefs_.autoplay;
    else if (verb.starts_with("language-")) {
        auto languages = extrasPrefs_.languages; const auto language = verb.substr(9);
        const auto found = std::find(languages.begin(), languages.end(), language);
        if (found == languages.end()) languages.push_back(language); else if (languages.size() > 1) languages.erase(found);
        patch["subtitleLanguages"] = languages;
    }
    else if (verb == "languages") {
        std::vector<std::string> languages;
        std::istringstream input(fieldValues_["extras-settings.languages"]); std::string language;
        while (std::getline(input, language, ',')) {
            language = util::Trim(language);
            std::transform(language.begin(), language.end(), language.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
            if (language.size() < 2 || language.size() > 3 || language.find_first_not_of("abcdefghijklmnopqrstuvwxyz") != std::string::npos) {
                pageMessage_ = "Enter language codes separated by commas, for example eng, fra."; pageMessageBad_ = true; ShowInfoPage(); return;
            }
            languages.push_back(language);
        }
        if (languages.empty()) languages.push_back("eng");
        patch["subtitleLanguages"] = languages;
    } else if (!clear) return;
    pageBusy_ = true; ShowInfoPage(); const auto epoch = extrasEpoch_; const auto page = pageName_;
    background_->Run([this, clear, patch, epoch, page] {
        nlohmann::json data; std::string error;
        try {
            if (clear) { core_->Call("/api/extras/stats/clear", "POST"); data = core_->Call("/api/extras/stats"); }
            else { core_->Call("/api/prefs", "PUT", patch); data = core_->Call("/api/prefs"); }
        } catch (const std::exception& e) { error = e.what(); }
        background_->PostToUi([this, clear, data, error, epoch, page] {
            if (epoch != extrasEpoch_ || pageName_ != page) return;
            pageBusy_ = false; pageConfirm_ = false; pageMessage_ = error; pageMessageBad_ = !error.empty();
            if (error.empty()) {
                if (clear) extrasStats_ = data;
                else {
                    const auto next = extras::ParsePreferences(data);
                    const bool languagesChanged = next.languages != extrasPrefs_.languages;
                    extrasPrefs_ = next;
                    fieldValues_["extras-settings.languages"] = Languages(extrasPrefs_, false);
                    if (languagesChanged) if (const auto folder = profiles::ActiveFolder(dataDir_)) try { util::WriteFileAtomically(*folder / "native-subtitle-language", extrasPrefs_.languages.front()); } catch (...) {}
                }
            }
            ShowInfoPage();
            if (auto* screen = TypingPage()) screen->SetFieldText(fieldValues_["extras-settings.languages"]);
        });
    });
}
} // namespace tvm::platform
