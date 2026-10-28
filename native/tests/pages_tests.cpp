// Page tests: the profile registry's writing side (profiles.ts), and the Profiles, Plans and Updates pages
// (Profiles.tsx, Plans.tsx, Updates.tsx). Profiles are written to a temporary folder, never the viewer's.

#include <string>
#include <string_view>
#include <vector>

#include "catalog/hubs.h"
#include "catalog/live_check.h"
#include "core/admin.h"
#include "core/crypto.h"
#include "core/profiles.h"
#include "fake_network.h"
#include "harness.h"
#include "ui/pages.h"

namespace {

using tvm::nav::Direction;
using tvm::testing::TempFolder;
using tvm::ui::Box;
using tvm::ui::Color;
using tvm::ui::Command;

class TextPainter final : public tvm::ui::Painter {
public:
    void Clear(Color /*color*/) override {}
    void FillRoundRect(const Box& /*box*/, double /*radius*/, Color /*color*/) override {}
    void StrokeRoundRect(const Box& /*box*/, double /*radius*/, double /*width*/, Color /*color*/) override {}
    bool Image(const Box& /*box*/, const std::string& /*url*/, double /*radius*/) override { return false; }
    void Paragraph(const Box& /*box*/, std::string_view text, const tvm::ui::TextStyle& /*style*/, Color /*c*/) override {
        texts.emplace_back(text);
    }
    void Text(const Box& /*box*/, std::string_view text, const tvm::ui::TextStyle& /*style*/, Color /*c*/) override {
        texts.emplace_back(text);
    }
    void PushClip(const Box& /*box*/) override {}
    void PopClip() override {}
    bool Has(const std::string& text) const {
        for (const std::string& drawn : texts) {
            if (drawn == text) return true;
        }
        return false;
    }
    std::vector<std::string> texts;
};

// ------------------------------------------------------------------ the registry

TEST(the_first_run_makes_profile_1_and_moves_the_old_lists_into_it) {
    TempFolder folder;
    tvm::util::WriteFileAtomically(tvm::paths::WatchlistPath(folder.path()), "[]");
    const tvm::profiles::Registry registry = tvm::profiles::Load(folder.path());
    REQUIRE_EQ(registry.profiles.size(), std::size_t{1});
    REQUIRE_EQ(registry.profiles[0].name, std::string("Profile 1"));
    REQUIRE_EQ(registry.profiles[0].hue, 221);
    REQUIRE(std::filesystem::exists(tvm::paths::WatchlistPath(tvm::paths::ProfileDir(folder.path(), "profile-1"))));
    // The reading side sees the same active folder.
    REQUIRE_EQ(tvm::profiles::ActiveFolder(folder.path()),
               std::optional<std::filesystem::path>(tvm::paths::ProfileDir(folder.path(), "profile-1")));
    REQUIRE_EQ(tvm::profiles::ActiveName(folder.path()), std::optional<std::string>("Profile 1"));
}

TEST(a_new_profile_becomes_active_and_the_last_cannot_go) {
    TempFolder folder;
    tvm::profiles::Registry registry = tvm::profiles::Create(folder.path(), "  Sam  ");
    REQUIRE_EQ(registry.profiles.size(), std::size_t{2});
    REQUIRE_EQ(registry.profiles[1].name, std::string("Sam"));
    REQUIRE_EQ(registry.profiles[1].hue, 190);
    REQUIRE_EQ(registry.activeId, registry.profiles[1].id);
    REQUIRE(registry.profiles[1].id.rfind("profile-", 0) == 0);

    registry = tvm::profiles::SwitchTo(folder.path(), "profile-1");
    REQUIRE_EQ(registry.activeId, std::string("profile-1"));
    registry = tvm::profiles::Remove(folder.path(), "profile-1");
    REQUIRE_EQ(registry.profiles.size(), std::size_t{1});
    REQUIRE_EQ(registry.activeId, registry.profiles[0].id);
    REQUIRE_THROWS_CONTAINING(tvm::profiles::Remove(folder.path(), registry.activeId), "at least one profile");
    REQUIRE_THROWS_CONTAINING(tvm::profiles::SwitchTo(folder.path(), "nobody"), "Unknown profile");
}

TEST(profiles_stop_at_the_cap) {
    TempFolder folder;
    tvm::profiles::Load(folder.path());
    REQUIRE_THROWS_CONTAINING(tvm::profiles::Create(folder.path(), "Two", 1), "TVM holds 1 profiles.");
}

// ------------------------------------------------------------------ the pages

TEST(profiles_page_asks_whos_watching_and_adds_a_typed_name) {
    tvm::ui::ProfilesScreen screen;
    screen.Layout(1920.0, 1080.0);
    tvm::ui::ProfilesView view;
    view.profiles = {{"profile-1", "Gathe", 221}, {"profile-2", "Sam", 190}};
    view.activeId = "profile-1";
    screen.SetView(view);
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("pick:profile-1"));
    TextPainter painter;
    screen.Paint(painter);
    REQUIRE(painter.Has("Who's watching?"));
    REQUIRE(painter.Has("Gathe"));
    REQUIRE(painter.Has("Remove"));

    REQUIRE_EQ(screen.ActivateItem("pick:profile-2", 0.0)->name, std::string("profile-open"));
    REQUIRE(!screen.ActivateItem("profile-add", 0.0).has_value());
    REQUIRE(screen.Creating());
    screen.Type("Ana");
    screen.Erase();
    screen.Type("n");
    const std::optional<Command> save = screen.ActivateItem("profile-save", 0.0);
    REQUIRE_EQ(save->name, std::string("profile-create"));
    REQUIRE_EQ(save->params.at("name"), std::string("Ann"));
    REQUIRE(!screen.Creating());
}

TEST(plans_page_lists_both_kinds_of_access_and_fences_off_donate) {
    tvm::ui::PlansScreen screen;
    screen.Layout(1920.0, 1080.0);
    TextPainter painter;
    screen.Paint(painter);
    REQUIRE(painter.Has("What TVM costs"));
    REQUIRE(painter.Has("Movies and TV shows"));
    REQUIRE(painter.Has("Movies and TV shows + Live TV"));
    REQUIRE(painter.Has("\xC2\xA3" "9.99/month"));
    REQUIRE(painter.Has("\xC2\xA3" "599.00"));
    REQUIRE(painter.Has("Donate to the app owner"));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("donate"));
    REQUIRE(screen.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(screen.Select(0.0)->name, std::string("legal"));
}

TEST(updates_page_shows_the_build_and_never_offers_to_apply) {
    tvm::ui::UpdatesScreen screen;
    screen.Layout(1920.0, 1080.0);
    tvm::ui::UpdatesView view;
    view.version = "1.0.0";
    view.changes = {"Fix playback startup"};
    screen.SetView(view);
    TextPainter painter;
    screen.Paint(painter);
    REQUIRE(painter.Has("v1.0.0 \xC2\xB7 native"));
    REQUIRE(painter.Has("Never"));
    REQUIRE(painter.Has("Fix playback startup"));
    REQUIRE_EQ(screen.Select(0.0)->name, std::string("updates-check"));
    // Right from Check now passes the disabled Apply and reaches automatic updates.
    REQUIRE(screen.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("auto-update"));
    REQUIRE(!screen.ActivateItem("apply", 0.0).has_value());
}

// ------------------------------------------------------------------ info pages

TEST(an_info_page_draws_its_copy_and_sends_its_buttons) {
    tvm::ui::InfoScreen screen;
    screen.Layout(1920.0, 1080.0);
    tvm::ui::InfoView view;
    view.kicker = "Privacy & terms";
    view.heading = "Your data. Your sources.";
    view.topActions = {{"back", "Back"}, {"info:legal-export", "Export my data"}};
    view.blocks = {{tvm::ui::InfoBlock::Kind::Heading, "Terms of use"}, {tvm::ui::InfoBlock::Kind::Row, "Status", "Connected"}};
    view.actions = {{{"open:service?id=netflix", "Netflix"}}};
    screen.SetView(view);
    TextPainter painter;
    screen.Paint(painter);
    REQUIRE(painter.Has("Your data. Your sources."));
    REQUIRE(painter.Has("Terms of use"));
    REQUIRE(painter.Has("Connected"));
    // The first row of buttons has the focus, and Right moves along it.
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("back"));
    REQUIRE(screen.Navigate(Direction::Right, 0.0));
    const std::optional<Command> exported = screen.Select(0.0);
    REQUIRE_EQ(exported->name, std::string("info:legal-export"));
    REQUIRE(exported->action);
    // "open:" opens a screen, with its one parameter.
    const std::optional<Command> hub = screen.ActivateItem("open:service?id=netflix", 0.0);
    REQUIRE_EQ(hub->name, std::string("service"));
    REQUIRE(!hub->action);
    REQUIRE_EQ(hub->params.at("id"), std::string("netflix"));
}

TEST(an_info_page_field_hides_a_secret_and_goes_with_each_press) {
    tvm::ui::InfoScreen screen;
    screen.Layout(1920.0, 1080.0);
    tvm::ui::InfoView view;
    view.heading = "Dev account";
    view.field = true;
    view.fieldSecret = true;
    view.fieldPlaceholder = "Code, then press OK";
    view.actions = {{{"info:dev-unlock", "Switch to dev account", true}}};
    screen.SetView(view);
    screen.Type("ab");
    screen.Erase();
    screen.Type("cd");
    REQUIRE_EQ(screen.FieldText(), std::string("acd"));
    TextPainter painter;
    screen.Paint(painter);
    REQUIRE(!painter.Has("acd"));
    REQUIRE(painter.Has("\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2"));
    REQUIRE_EQ(screen.Select(0.0)->params.at("field"), std::string("acd"));
    // The field goes when the page no longer has one, and its text with it.
    screen.SetView(tvm::ui::InfoView{});
    REQUIRE(screen.FieldText().empty());
}

TEST(pbkdf2_sha256_matches_the_published_vector) {
    const tvm::util::Bytes salt = {'s', 'a', 'l', 't'};
    const tvm::util::Bytes key = tvm::crypto::Pbkdf2Sha256("password", salt, 1, 32);
    std::string hex;
    for (const auto byte : key) {
        static constexpr char kDigits[] = "0123456789abcdef";
        hex += kDigits[static_cast<unsigned char>(byte) >> 4];
        hex += kDigits[static_cast<unsigned char>(byte) & 0xF];
    }
    REQUIRE_EQ(hex, std::string("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b"));
    REQUIRE(tvm::crypto::ConstantTimeEqual(key, key));
    REQUIRE(!tvm::crypto::ConstantTimeEqual(key, salt));
}

TEST(a_wrong_dev_code_leaves_dev_mode_off) {
    TempFolder folder;
    REQUIRE(!tvm::admin::UnlockDev(folder.path(), "not the code"));
    REQUIRE(!tvm::admin::DevUnlocked(folder.path()));
    REQUIRE(tvm::admin::ListAccounts(folder.path()).empty());
}

TEST(mail_settings_are_checked_and_keep_the_saved_password) {
    TempFolder folder;
    tvm::admin::MailSettings settings;
    settings.host = "not a host";
    settings.from = "codes@example.com";
    REQUIRE_THROWS_CONTAINING(tvm::admin::SaveMail(folder.path(), settings), "Enter the mail server");
    settings.host = "smtp.mail.me.com";
    settings.username = "codes@example.com";
    settings.password = "app-password";
    tvm::admin::SaveMail(folder.path(), settings);
    // A blank password for the same server and username keeps the one saved.
    settings.password.clear();
    tvm::admin::SaveMail(folder.path(), settings);
    const std::optional<tvm::admin::MailSettings> saved = tvm::admin::ReadMail(folder.path());
    REQUIRE(saved.has_value());
    REQUIRE_EQ(saved->password, std::string("app-password"));
    tvm::admin::ClearMail(folder.path());
    REQUIRE(!tvm::admin::ReadMail(folder.path()).has_value());
}

TEST(the_channel_check_tells_a_dead_channel_from_a_refused_one) {
    using tvm::livecheck::Outcome;
    Outcome refused;
    refused.status = 403u;
    REQUIRE_EQ(tvm::livecheck::Classify(refused).verdict, std::string("unauthorized"));
    Outcome silent;
    silent.timedOut = true;
    REQUIRE_EQ(tvm::livecheck::Classify(silent).verdict, std::string("silent"));
    // Two transport packets in a row are video.
    std::string packets(188 * 3, '\0');
    for (std::size_t i = 0; i < packets.size(); i += 188) {
        packets[i] = 0x47;
        packets[i + 3] = 0x10;
    }
    Outcome playing;
    playing.status = 200u;
    playing.head = packets;
    const tvm::livecheck::Check works = tvm::livecheck::Classify(playing);
    REQUIRE(works.ok);
    REQUIRE_EQ(works.transport, std::string("mpegts"));
    // A run of "G" is not.
    Outcome letters;
    letters.status = 200u;
    letters.head = std::string(188 * 3, 'G');
    REQUIRE_EQ(tvm::livecheck::Classify(letters).verdict, std::string("unplayable"));
    Outcome empty;
    empty.status = 200u;
    empty.head = "#EXTM3U\n#EXT-X-VERSION:3\n";
    empty.manifestEmpty = true;
    REQUIRE_EQ(tvm::livecheck::Classify(empty).verdict, std::string("offline"));

    tvm::livecheck::Report report;
    report.checked = 2;
    report.working = 1;
    report.results = {works, tvm::livecheck::Classify(silent)};
    REQUIRE_EQ(tvm::livecheck::VerdictLine(report),
               std::string("Live TV is working. 1 of 2 channels checked are streaming; the other 1 are listed but not broadcasting, "
                           "which is normal for a list this size."));
}

TEST(the_service_hubs_are_the_seven_from_apps_ts) {
    const auto& specs = tvm::hubs::Specs();
    REQUIRE_EQ(specs.size(), std::size_t{7});
    REQUIRE_EQ(specs.front().id, std::string("netflix"));
    REQUIRE(tvm::hubs::Find("peacock") != nullptr);
    REQUIRE(tvm::hubs::Find("nope") == nullptr);
    const nlohmann::json show = {{"webChannel", {{"name", "Netflix"}}}};
    REQUIRE(tvm::hubs::MatchStudio(show, {"netflix"}));
    REQUIRE(!tvm::hubs::MatchStudio(show, {"hulu"}));
}

}  // namespace
