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

FilePreferenceStore::FilePreferenceStore(paths::fs::path dataDir) : dataDir_(std::move(dataDir)) {}

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

GlassClarity FilePreferenceStore::Glass() const {
    const nlohmann::ordered_json& json = UiJson();
    const auto value = json.find("glass");
    return value != json.end() && value->is_string() ? ParseGlassClarity(value->get<std::string>())
                                                     : GlassClarity::Clear;
}

void FilePreferenceStore::SaveGlass(GlassClarity clarity) {
    auto json = UiJson();
    json["glass"] = GlassClarityId(clarity);
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

}  // namespace tvm::ui
