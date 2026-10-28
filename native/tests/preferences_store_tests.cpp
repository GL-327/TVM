// The file-backed preference store, tested against a temporary folder. The
// core prefs file must stay in the exact format the Node core reads.

#include <windows.h>

#include <filesystem>
#include <optional>
#include <string>

#include "core/util.h"
#include "harness.h"
#include "ui/preferences_store.h"

namespace {

namespace fs = std::filesystem;
using tvm::motion::MotionPreference;
using tvm::motion::MotionSettings;

class TempFolder {
public:
    TempFolder() {
        static unsigned counter = 0;
        path_ = fs::temp_directory_path() /
                (L"tvm-prefs-test-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(++counter));
        fs::create_directories(path_);
    }
    ~TempFolder() {
        std::error_code ignored;
        fs::remove_all(path_, ignored);
    }
    const fs::path& path() const { return path_; }

private:
    fs::path path_;
};

TEST(store_defaults_when_nothing_is_saved) {
    TempFolder folder;
    tvm::ui::FilePreferenceStore store(folder.path());
    REQUIRE(store.Motion() == MotionSettings{});
    REQUIRE(store.CorePrefs() == tvm::prefs::CorePrefs{});
}

TEST(store_motion_round_trips_in_the_ui_prefs_file) {
    TempFolder folder;
    tvm::ui::FilePreferenceStore store(folder.path());
    store.SaveMotion(MotionSettings{MotionPreference::Reduced, true});

    REQUIRE(store.Motion() == (MotionSettings{MotionPreference::Reduced, true}));
    const std::string onDisk = tvm::util::ReadTextFile(folder.path() / L"ui-prefs.json").value_or("");
    REQUIRE(onDisk == std::string(R"({"motion":"reduced","performance":true})"));
}

TEST(store_core_prefs_match_the_node_format) {
    TempFolder folder;
    tvm::ui::FilePreferenceStore store(folder.path());
    store.SaveCorePrefs(tvm::prefs::CorePrefsPatch{std::string("fr"), false});

    const tvm::prefs::CorePrefs prefs = store.CorePrefs();
    REQUIRE(prefs.language == "fr");
    REQUIRE(!prefs.autoUpdate);
    const std::string onDisk = tvm::util::ReadTextFile(folder.path() / L"prefs.json").value_or("");
    REQUIRE(onDisk == std::string(R"({"language":"fr","autoUpdate":false})"));
}

TEST(store_keeps_ui_and_core_prefs_apart) {
    TempFolder folder;
    tvm::ui::FilePreferenceStore store(folder.path());
    store.SaveMotion(MotionSettings{MotionPreference::Reduced, false});
    store.SaveCorePrefs(tvm::prefs::CorePrefsPatch{std::string("de"), std::nullopt});

    // Saving one file must not disturb the other.
    REQUIRE(store.Motion().preference == MotionPreference::Reduced);
    REQUIRE(store.CorePrefs().language == "de");
    REQUIRE(store.CorePrefs().autoUpdate);
}

}  // namespace
