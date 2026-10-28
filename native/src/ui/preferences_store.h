#pragma once

// Where the screens keep the choices a viewer makes: the motion and performance
// settings (UI preferences) and the language and automatic-update settings
// (core preferences). The screens see only this interface, so tests can use a
// memory store and never touch the real data folder.

#include "core/paths.h"
#include "core/prefs.h"
#include "motion/preferences.h"

namespace tvm::ui {

class PreferenceStore {
public:
    virtual ~PreferenceStore() = default;

    virtual motion::MotionSettings Motion() const = 0;
    virtual void SaveMotion(const motion::MotionSettings& settings) = 0;

    virtual prefs::CorePrefs CorePrefs() const = 0;
    virtual void SaveCorePrefs(const prefs::CorePrefsPatch& patch) = 0;
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

private:
    paths::fs::path dataDir_;
};

}  // namespace tvm::ui
