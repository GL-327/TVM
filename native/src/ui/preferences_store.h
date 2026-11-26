#pragma once

// Where the screens keep the choices a viewer makes: the motion and performance
// settings (UI preferences) and the language and automatic-update settings
// (core preferences). The screens see only this interface, so tests can use a
// memory store and never touch the real data folder.

#include <chrono>
#include <optional>
#include <string>

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

    virtual UiFont Font() const { return UiFont::Geist; }
    virtual void SetFont(UiFont /*font*/) {}
    virtual bool ReduceTransparency() const { return false; }
    virtual void SetReduceTransparency(bool /*on*/) {}

    // Whether "Who's watching?" shows each time TVM opens. On unless the viewer turns it off.
    virtual bool ChooseProfileOnLaunch() const { return true; }
    virtual void SaveChooseProfileOnLaunch(bool /*on*/) {}

    // Choices Core does not keep: the player's starting sleep timer ("off", "15", "30", "45", "60" or "end"), and
    // whether Home features the big film and TV release events. They live in ui-prefs.json on this PC.
    virtual std::string SleepTimerDefault() const { return "off"; }
    virtual void SaveSleepTimerDefault(const std::string& /*value*/) {}
    virtual std::string Accent() const { return "default"; }
    virtual void SaveAccent(const std::string& /*value*/) {}
    virtual int VolumeBoostMax() const { return 200; }
    virtual void SaveVolumeBoostMax(int /*value*/) {}
    virtual bool PosterTitles() const { return true; }
    virtual void SavePosterTitles(bool /*on*/) {}
    virtual bool ShowFps() const { return false; }
    virtual void SaveShowFps(bool /*on*/) {}
    virtual bool SpotlightEvents() const { return true; }
    virtual void SaveSpotlightEvents(bool /*on*/) {}
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

    UiFont Font() const override;
    void SetFont(UiFont font) override;
    bool ReduceTransparency() const override;
    void SetReduceTransparency(bool on) override;

    // Legacy snapshot CLI. The fixture's tinted flag now exercises solid surfaces.
    void SaveGlass(GlassClarity fixture) { SetReduceTransparency(fixture == GlassClarity::Tinted); }

    bool ChooseProfileOnLaunch() const override;
    void SaveChooseProfileOnLaunch(bool on) override;

    std::string SleepTimerDefault() const override;
    void SaveSleepTimerDefault(const std::string& value) override;
    std::string Accent() const override;
    void SaveAccent(const std::string& value) override;
    int VolumeBoostMax() const override;
    void SaveVolumeBoostMax(int value) override;
    bool PosterTitles() const override;
    void SavePosterTitles(bool on) override;
    bool ShowFps() const override;
    void SaveShowFps(bool on) override;
    bool SpotlightEvents() const override;
    void SaveSpotlightEvents(bool on) override;

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
