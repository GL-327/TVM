#include "ui/preferences_store.h"

#include <nlohmann/json.hpp>

#include "core/util.h"

namespace tvm::ui {

namespace {

motion::MotionSettings ReadUiPrefs(const paths::fs::path& path) {
    motion::MotionSettings settings;
    const std::optional<std::string> text = util::ReadTextFile(path);
    if (!text) return settings;

    const nlohmann::json raw = nlohmann::json::parse(util::StripBom(*text), nullptr, false);
    if (!raw.is_object()) return settings;

    if (const auto motion = raw.find("motion"); motion != raw.end() && motion->is_string()) {
        settings.preference = motion::ParseMotionPreference(motion->get<std::string>());
    }
    if (const auto performance = raw.find("performance"); performance != raw.end() && performance->is_boolean()) {
        settings.performanceMode = performance->get<bool>();
    }
    return settings;
}

}  // namespace

FilePreferenceStore::FilePreferenceStore(paths::fs::path dataDir) : dataDir_(std::move(dataDir)) {}

motion::MotionSettings FilePreferenceStore::Motion() const {
    return ReadUiPrefs(paths::UiPrefsPath(dataDir_));
}

void FilePreferenceStore::SaveMotion(const motion::MotionSettings& settings) {
    nlohmann::ordered_json json;
    json["motion"] = std::string(motion::ToString(settings.preference));
    json["performance"] = settings.performanceMode;
    util::WriteFileAtomically(paths::UiPrefsPath(dataDir_), json.dump());
}

prefs::CorePrefs FilePreferenceStore::CorePrefs() const {
    return prefs::ReadPrefs(dataDir_);
}

void FilePreferenceStore::SaveCorePrefs(const prefs::CorePrefsPatch& patch) {
    prefs::WritePrefs(dataDir_, patch);
}

}  // namespace tvm::ui
