#pragma once

// Where the screens keep the choices a viewer makes: the motion and performance
// settings (UI preferences) and the language and automatic-update settings
// (core preferences). The screens see only this interface, so tests can use a
// memory store and never touch the real data folder.

#include <chrono>
#include <optional>

#include <nlohmann/json.hpp>

#include "core/paths.h"
#include "core/prefs.h"
#include "motion/preferences.h"
#include "ui/theme.h"

namespace tvm::ui {

class PreferenceStore {
public:
    virtual ~PreferenceStore() = default;

    virtual motion::MotionSettings Motion() const = 0;
    virtual void SaveMotion(const motion::MotionSettings& settings) = 0;

    virtual prefs::CorePrefs CorePrefs() const = 0;
    virtual void SaveCorePrefs(const prefs::CorePrefsPatch& patch) = 0;

    virtual Theme Look() const { return Theme::Dark; }
    virtual void SaveLook(Theme /*theme*/) {}

    virtual GlassClarity Glass() const { return GlassClarity::Default; }
    virtual void SaveGlass(GlassClarity /*clarity*/) {}

    // Whether "Who's watching?" shows each time TVM opens. On unless the viewer turns it off.
    virtual bool ChooseProfileOnLaunch() const { return true; }
    virtual void SaveChooseProfileOnLaunch(bool /*on*/) {}
};

// The real store. UI preferences live in ui-prefs.json. Core preferences use
// the same prefs.json the Node core reads, so both apps agree.
class FilePreferenceStore final : public PreferenceStore {
public:
    explicit FilePreferenceStore(paths::fs::path dataDir);

    motion::MotionSettings Motion() const override;
    void SaveMotion(const motion::MotionSettings& settings) override;

    prefs::CorePrefs CorePrefs() const override;
    void SaveCorePrefs(const prefs::CorePrefsPatch& patch) override;

    Theme Look() const override;
    void SaveLook(Theme theme) override;

    GlassClarity Glass() const override;
    void SaveGlass(GlassClarity clarity) override;

    bool ChooseProfileOnLaunch() const override;
    void SaveChooseProfileOnLaunch(bool on) override;

private:
    // ui-prefs.json, read once and kept in memory. The shell asks for the look and the motion every frame, so the
    // file is checked for an outside change at most once a second rather than read and parsed each time.
    const nlohmann::ordered_json& UiJson() const;
    void SaveUiJson(nlohmann::ordered_json json);

    paths::fs::path dataDir_;
    mutable std::optional<nlohmann::ordered_json> cached_;
    mutable std::optional<paths::fs::file_time_type> cachedStamp_;
    mutable std::chrono::steady_clock::time_point checkedAt_{};
};

}  // namespace tvm::ui
