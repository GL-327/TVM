#include "ui/preferences_store.h"

#include <nlohmann/json.hpp>

#include "core/util.h"

namespace tvm::ui {

namespace {

nlohmann::ordered_json ReadUiJson(const paths::fs::path& path) {
    const auto text = util::ReadTextFile(path);
    if (!text) return nlohmann::ordered_json::object();
    auto json = nlohmann::ordered_json::parse(util::StripBom(*text), nullptr, false);
    return json.is_object() ? json : nlohmann::ordered_json::object();
}


}  // namespace

FilePreferenceStore::FilePreferenceStore(paths::fs::path dataDir) : dataDir_(std::move(dataDir)) {
    auto json = UiJson();
    if (json.erase("glass") != 0) SaveUiJson(std::move(json));
}

const nlohmann::ordered_json& FilePreferenceStore::UiJson() const {
    const auto now = std::chrono::steady_clock::now();
    if (cached_.has_value() && now - checkedAt_ < std::chrono::seconds(1)) return *cached_;
    checkedAt_ = now;
    const paths::fs::path path = paths::UiPrefsPath(dataDir_);
    std::error_code error;
    const auto stamp = paths::fs::last_write_time(path, error);
    const std::optional<paths::fs::file_time_type> current =
        error ? std::nullopt : std::optional<paths::fs::file_time_type>(stamp);
    if (!cached_.has_value() || current != cachedStamp_) {
        cached_ = ReadUiJson(path);
        cachedStamp_ = current;
    }
    return *cached_;
}

void FilePreferenceStore::SaveUiJson(nlohmann::ordered_json json) {
    const paths::fs::path path = paths::UiPrefsPath(dataDir_);
    util::WriteFileAtomically(path, json.dump());
    std::error_code error;
    const auto stamp = paths::fs::last_write_time(path, error);
    cachedStamp_ = error ? std::nullopt : std::optional<paths::fs::file_time_type>(stamp);
    cached_ = std::move(json);
    checkedAt_ = std::chrono::steady_clock::now();
}

motion::MotionSettings FilePreferenceStore::Motion() const {
    motion::MotionSettings settings;
    const nlohmann::ordered_json& raw = UiJson();
    if (const auto motion = raw.find("motion"); motion != raw.end() && motion->is_string()) {
        settings.preference = motion::ParseMotionPreference(motion->get<std::string>());
    }
    if (const auto performance = raw.find("performance"); performance != raw.end() && performance->is_boolean()) {
        settings.performanceMode = performance->get<bool>();
    }
    return settings;
}

void FilePreferenceStore::SaveMotion(const motion::MotionSettings& settings) {
    auto json = UiJson();
    json["motion"] = std::string(motion::ToString(settings.preference));
    json["performance"] = settings.performanceMode;
    SaveUiJson(std::move(json));
}

prefs::CorePrefs FilePreferenceStore::CorePrefs() const {
    return prefs::ReadPrefs(dataDir_);
}

void FilePreferenceStore::SaveCorePrefs(const prefs::CorePrefsPatch& patch) {
    prefs::WritePrefs(dataDir_, patch);
}

Theme FilePreferenceStore::Look() const {
    const nlohmann::ordered_json& json = UiJson();
    const auto value = json.find("theme");
    return value != json.end() && value->is_string() ? ParseTheme(value->get<std::string>()) : Theme::Dark;
}

void FilePreferenceStore::SaveLook(Theme theme) {
    auto json = UiJson();
    json["theme"] = ThemeId(theme);
    SaveUiJson(std::move(json));
}

UiFont FilePreferenceStore::Font() const {
    const auto& json = UiJson();
    const auto value = json.find("font");
    return value != json.end() && value->is_string() ? ParseUiFont(value->get<std::string>()) : UiFont::Geist;
}

void FilePreferenceStore::SetFont(UiFont font) {
    auto json = UiJson();
    json["font"] = UiFontId(font);
    SaveUiJson(std::move(json));
}

bool FilePreferenceStore::ReduceTransparency() const {
    const auto& json = UiJson();
    const auto value = json.find("reduceTransparency");
    return value != json.end() && value->is_boolean() && value->get<bool>();
}

void FilePreferenceStore::SetReduceTransparency(bool on) {
    auto json = UiJson();
    json["reduceTransparency"] = on;
    SaveUiJson(std::move(json));
}

bool FilePreferenceStore::ChooseProfileOnLaunch() const {
    const nlohmann::ordered_json& json = UiJson();
    const auto value = json.find("chooseProfileOnLaunch");
    return value == json.end() || !value->is_boolean() || value->get<bool>();
}

void FilePreferenceStore::SaveChooseProfileOnLaunch(bool on) {
    auto json = UiJson();
    json["chooseProfileOnLaunch"] = on;
    SaveUiJson(std::move(json));
}

std::string FilePreferenceStore::SleepTimerDefault() const {
    const nlohmann::ordered_json& json = UiJson();
    const auto value = json.find("sleepTimerDefault");
    if (value == json.end() || !value->is_string()) return "off";
    const std::string text = value->get<std::string>();
    return text == "15" || text == "30" || text == "45" || text == "60" || text == "end" ? text : "off";
}

void FilePreferenceStore::SaveSleepTimerDefault(const std::string& value) {
    auto json = UiJson();
    json["sleepTimerDefault"] = value;
    SaveUiJson(std::move(json));
}

std::string FilePreferenceStore::Accent() const {
    const auto& json = UiJson();
    const auto value = json.find("accent");
    if (value == json.end() || !value->is_string()) return "default";
    const std::string accent = value->get<std::string>();
    return AccentColour(accent) == AccentColour("default") ? "default" : accent;
}

void FilePreferenceStore::SaveAccent(const std::string& value) {
    auto json = UiJson();
    json["accent"] = value;
    SaveUiJson(std::move(json));
}

int FilePreferenceStore::VolumeBoostMax() const {
    const auto& json = UiJson();
    const auto value = json.find("volumeBoostMax");
    if (value == json.end() || !value->is_number()) return 200;
    return static_cast<int>(std::clamp(value->get<double>(), 100.0, 300.0));
}

void FilePreferenceStore::SaveVolumeBoostMax(int value) {
    auto json = UiJson();
    json["volumeBoostMax"] = value;
    SaveUiJson(std::move(json));
}

bool FilePreferenceStore::PosterTitles() const {
    const auto& json = UiJson();
    const auto value = json.find("posterTitles");
    return value == json.end() || !value->is_boolean() || value->get<bool>();
}

void FilePreferenceStore::SavePosterTitles(bool on) {
    auto json = UiJson();
    json["posterTitles"] = on;
    SaveUiJson(std::move(json));
}

bool FilePreferenceStore::ShowFps() const {
    const auto& json = UiJson();
    const auto value = json.find("showFps");
    return value != json.end() && value->is_boolean() && value->get<bool>();
}

void FilePreferenceStore::SaveShowFps(bool on) {
    auto json = UiJson();
    json["showFps"] = on;
    SaveUiJson(std::move(json));
}

bool FilePreferenceStore::SpotlightEvents() const {
    const nlohmann::ordered_json& json = UiJson();
    const auto value = json.find("spotlightEvents");
    return value == json.end() || !value->is_boolean() || value->get<bool>();
}

void FilePreferenceStore::SaveSpotlightEvents(bool on) {
    auto json = UiJson();
    json["spotlightEvents"] = on;
    SaveUiJson(std::move(json));
}

}  // namespace tvm::ui
