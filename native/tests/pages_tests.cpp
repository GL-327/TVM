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
    REQUIRE(painter.Has("Choose your plan"));
    REQUIRE(painter.Has("Stream"));
    REQUIRE(painter.Has("Stream + Live"));
    REQUIRE(painter.Has("\xC2\xA3" "10"));
    REQUIRE(painter.Has("\xC2\xA3" "17"));
    REQUIRE(painter.Has("/month"));
    REQUIRE(painter.Has("inc \xC2\xA3" "7 Live TV add-on"));
    REQUIRE(painter.Has("Most popular"));
    REQUIRE(painter.Has("Donate to the app owner"));

    // Equal button heights across plan CTAs and Donate.
    const auto streamBox = screen.BoxOf("plan:stream");
    const auto liveBox = screen.BoxOf("plan:stream-live");
    const auto donateBox = screen.BoxOf("donate");
    REQUIRE(streamBox.has_value());
    REQUIRE(liveBox.has_value());
    REQUIRE(donateBox.has_value());
    REQUIRE_EQ(streamBox->height, liveBox->height);
    REQUIRE_EQ(streamBox->height, donateBox->height);

    // Switching to Yearly updates prices and add-on breakdown.
    REQUIRE(!screen.ActivateItem("cadence:year", 0.0).has_value());
    TextPainter yearlyPainter;
    screen.Paint(yearlyPainter);
    REQUIRE(yearlyPainter.Has("\xC2\xA3" "90"));
    REQUIRE(yearlyPainter.Has("\xC2\xA3" "150"));
    REQUIRE(yearlyPainter.Has("/year"));
    REQUIRE(yearlyPainter.Has("inc \xC2\xA3" "60 Live TV add-on"));

    // Expanding Compare shows the feature table; activating a plan emits plans-choose.
    REQUIRE(!screen.ActivateItem("plans:compare", 0.0).has_value());
    TextPainter cmpPainter;
    screen.Paint(cmpPainter);
    REQUIRE(cmpPainter.Has("Offline downloads"));
    const std::optional<Command> chosen = screen.ActivateItem("plan:stream-live", 0.0);
    REQUIRE(chosen.has_value());
    REQUIRE_EQ(chosen->name, std::string("plans-choose"));
    REQUIRE_EQ(chosen->params.at("tier"), std::string("stream-live"));
    REQUIRE_EQ(chosen->params.at("cadence"), std::string("year"));

    // Signed-in users see "Your plan" badge and disabled "Current plan" button on their active tier.
    tvm::ui::PlansView signedView = screen.view();
    signedView.account.signedIn = true;
    signedView.account.tier = "stream";
    screen.SetView(signedView);
    TextPainter ownedPainter;
    screen.Paint(ownedPainter);
    REQUIRE(ownedPainter.Has("Your plan"));
    REQUIRE(!screen.ActivateItem("plan:stream", 0.0).has_value());
    const std::optional<Command> legal = screen.ActivateItem("plans-legal", 0.0);
    REQUIRE(legal.has_value());
    REQUIRE_EQ(legal->name, std::string("legal"));
}

TEST(updates_page_offers_the_native_download_instead_of_an_electron_update) {
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
    // Right from Check now reaches the native download, then automatic checks.
    REQUIRE(screen.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("download"));
    REQUIRE_EQ(screen.Select(0)->name, std::string("updates-download"));
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
    view.heading = "Sign in";
    view.field = true;
    view.fieldSecret = true;
    view.fieldPlaceholder = "Password, then press OK";
    view.actions = {{{"info:account-signin", "Sign In", true}}};
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

TEST(centered_liquid_glass_signin_card_draws_summaries_and_navigates_modes) {
    tvm::ui::InfoScreen screen;
    screen.Layout(1920.0, 1080.0);
    tvm::ui::InfoView view;
    view.centeredCard = true;
    view.backdropUrl = "asset:lighthouse.jpg";
    view.kicker = "TVM";
    view.heading = "Sign in to TVM";
    view.filters = {
        {{"info:account-mode-signin", "Sign In", true},
         {"info:account-mode-register", "Create Account"}},
        {{"info:field-email", "Email", true}, {"info:field-password", "Password"}},
    };
    view.field = true;
    view.fieldLabel = "Email";
    view.fieldPlaceholder = "you@example.com";
    view.fieldSummaries = {{"Email", "ada@tvm.test", false, true}, {"Password", "secret", true, false}};
    view.actions = {{{"info:account-signin", "Sign In", true}}};
    screen.SetView(view);

    REQUIRE(screen.ShowsStage());
    TextPainter painter;
    screen.Paint(painter);
    REQUIRE(painter.Has("Sign in to TVM"));
    REQUIRE(painter.Has("ada@tvm.test"));
    REQUIRE(!painter.Has("secret"));
    REQUIRE(painter.Has("\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2\xE2\x80\xA2"));

    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("info:account-mode-signin"));
    REQUIRE(screen.Navigate(Direction::Right, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("info:account-mode-register"));
    REQUIRE(screen.Navigate(Direction::Down, 0.0));
    REQUIRE(screen.FocusedKey().has_value());
    const std::optional<Command> cmd = screen.ActivateItem("info:account-signin", 0.0);
    REQUIRE(cmd.has_value());
    REQUIRE_EQ(cmd->name, std::string("info:account-signin"));
}

TEST(account_screen_flows_two_step_signin_create_waiting_paused_terms_and_signed_in) {
    tvm::ui::AccountScreen screen;
    screen.Layout(1920.0, 1080.0);

    // Step 1: Invalid email stays on Email and shows inline validation error without emitting a command.
    screen.Type("invalid-email");
    REQUIRE(!screen.ActivateItem("account:continue", 0.0).has_value());
    REQUIRE_EQ(screen.step(), tvm::ui::AccountStep::SignInEmail);
    TextPainter emailErrPainter;
    screen.Paint(emailErrPainter);
    REQUIRE(emailErrPainter.Has("Sign in to TVM"));
    REQUIRE(emailErrPainter.Has("Check the email address. It should look like name@example.com."));

    // Valid email transitions cleanly to Step 2 (Password).
    screen.SetFieldValue("email", "ada@tvm.test");
    REQUIRE(!screen.ActivateItem("account:continue", 0.0).has_value());
    REQUIRE_EQ(screen.step(), tvm::ui::AccountStep::SignInPassword);

    // Eye toggle reveals/hides password; Forgot password shows guidance.
    screen.Type("hunter2longpass");
    TextPainter maskedPainter;
    screen.Paint(maskedPainter);
    REQUIRE(maskedPainter.Has("Enter your password"));
    REQUIRE(maskedPainter.Has("ada@tvm.test"));
    REQUIRE(!maskedPainter.Has("hunter2longpass"));

    REQUIRE(!screen.ActivateItem("account:toggle-password", 0.0).has_value());
    REQUIRE(screen.passwordVisible());
    TextPainter unmaskedPainter;
    screen.Paint(unmaskedPainter);
    REQUIRE(unmaskedPainter.Has("hunter2longpass"));

    REQUIRE(!screen.ActivateItem("account:forgot", 0.0).has_value());
    TextPainter forgotPainter;
    screen.Paint(forgotPainter);
    REQUIRE(forgotPainter.Has("Ask the owner to reset it."));

    const std::optional<Command> signin = screen.ActivateItem("account:signin", 0.0);
    REQUIRE(signin.has_value());
    REQUIRE_EQ(signin->name, std::string("account-signin"));
    REQUIRE_EQ(signin->params.at("email"), std::string("ada@tvm.test"));
    REQUIRE_EQ(signin->params.at("password"), std::string("hunter2longpass"));

    // Privacy & terms sheet opens and closes via CloseOverlay.
    REQUIRE(!screen.ActivateItem("account:privacy", 0.0).has_value());
    REQUIRE(screen.privacyOpen());
    TextPainter privacyPainter;
    screen.Paint(privacyPainter);
    REQUIRE(privacyPainter.Has("Privacy & terms"));
    REQUIRE(screen.CloseOverlay(0.0));
    REQUIRE(!screen.privacyOpen());

    // Create account validates 10-char password & terms checkbox, then emits account-register.
    REQUIRE(!screen.ActivateItem("account:change-email", 0.0).has_value());
    REQUIRE(!screen.ActivateItem("account:to-register", 0.0).has_value());
    REQUIRE_EQ(screen.step(), tvm::ui::AccountStep::CreateAccount);
    screen.SetFieldValue("name", "Ada Lovelace");
    screen.SetFieldValue("email", "ada@tvm.test");
    screen.SetFieldValue("password", "short");
    REQUIRE(!screen.ActivateItem("account:register", 0.0).has_value());
    screen.SetFieldValue("password", "analytical10");
    REQUIRE(!screen.ActivateItem("account:register", 0.0).has_value());  // Terms not checked yet.
    REQUIRE(!screen.ActivateItem("account:toggle-terms", 0.0).has_value());
    const std::optional<Command> reg = screen.ActivateItem("account:register", 0.0);
    REQUIRE(reg.has_value());
    REQUIRE_EQ(reg->name, std::string("account-register"));
    REQUIRE_EQ(reg->params.at("name"), std::string("Ada Lovelace"));

    // Waiting for approval never shows raw "awaiting_activation".
    tvm::ui::AccountView waitView;
    waitView.account.signedIn = true;
    waitView.account.email = "ada@tvm.test";
    waitView.account.reason = "awaiting_activation";
    screen.SetView(waitView);
    REQUIRE_EQ(screen.step(), tvm::ui::AccountStep::WaitingApproval);
    TextPainter waitPainter;
    screen.Paint(waitPainter);
    REQUIRE(waitPainter.Has("You're on the list"));
    REQUIRE(!waitPainter.Has("awaiting_activation"));

    // Paused account never shows raw "suspended".
    tvm::ui::AccountView pausedView;
    pausedView.account.signedIn = true;
    pausedView.account.email = "ada@tvm.test";
    pausedView.account.suspended = true;
    pausedView.account.reason = "suspended";
    screen.SetView(pausedView);
    REQUIRE_EQ(screen.step(), tvm::ui::AccountStep::Suspended);
    TextPainter pausedPainter;
    screen.Paint(pausedPainter);
    REQUIRE(pausedPainter.Has("Your account is paused"));
    REQUIRE(!pausedPainter.Has("suspended"));

    // Signed-in overview lists Plan, Real-Debrid, Live TV, Status, Member since, Stream profiles, Sign out.
    tvm::ui::AccountView activeView;
    activeView.account.signedIn = true;
    activeView.account.usable = true;
    activeView.account.activated = true;
    activeView.account.liveTv = true;
    activeView.account.name = "Ada Lovelace";
    activeView.account.email = "ada@tvm.test";
    activeView.account.tier = "stream-live";
    activeView.account.createdAt = "2026-04-12T10:00:00Z";
    activeView.realDebrid.configured = true;
    activeView.realDebrid.username = "ada_rd";
    screen.SetView(activeView);
    REQUIRE_EQ(screen.step(), tvm::ui::AccountStep::SignedIn);
    TextPainter signedPainter;
    screen.Paint(signedPainter);
    REQUIRE(signedPainter.Has("Account"));
    REQUIRE(signedPainter.Has("Ada Lovelace"));
    REQUIRE(signedPainter.Has("Stream + Live \xC2\xB7 Change"));
    REQUIRE(signedPainter.Has("Connected \xC2\xB7 ada_rd"));
    REQUIRE(signedPainter.Has("Active"));
    REQUIRE(signedPainter.Has("12 Apr 2026"));
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
