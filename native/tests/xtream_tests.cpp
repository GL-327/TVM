// Live TV login tests: the server rules, the panel addresses, the login check, the channel
// list, the sealed store, and the Live TV login screen through the shell. The panel is a
// fake that answers from a route, so no test reaches a real panel. Files go to a temporary
// folder, never to the viewer's data. The cases follow apps/core/src/providers/xtream.test.ts
// and the Xtream cases in live.test.ts.

#include <windows.h>

#include <fstream>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <utility>
#include <vector>

#include "catalog/live_channel.h"
#include "catalog/title.h"
#include "catalog/xtream.h"
#include "core/paths.h"
#include "core/prefs.h"
#include "core/util.h"
#include "fake_network.h"
#include "harness.h"
#include "motion/preferences.h"
#include "nav/focus_tree.h"
#include "ui/preferences_store.h"
#include "ui/screen_base.h"
#include "ui/shell.h"
#include "ui/xtream_screen.h"

namespace {

namespace fs = std::filesystem;
using tvm::catalog::LiveChannel;
using tvm::testing::Answer;
using tvm::testing::EnvWith;
using tvm::testing::FakeNetwork;
using tvm::testing::TempFolder;
using tvm::ui::Command;
using tvm::ui::XtreamScreen;
using tvm::ui::XtreamView;
using tvm::ui::Shell;
using tvm::xtream::Account;
using tvm::xtream::Authentication;
using tvm::xtream::Client;
using tvm::xtream::ClientOptions;
using tvm::xtream::Load;

Client MakeClient(const fs::path& dir, FakeNetwork& network, std::map<std::wstring, std::wstring> env = {}) {
    return Client(ClientOptions{dir, EnvWith(std::move(env)), network.Transport()});
}

// A panel that accepts alice and serves one category and one channel.
std::optional<tvm::http::Response> ServingPanel(const std::string& url) {
    if (url.find("get_live_categories") != std::string::npos) {
        return Answer(200, R"([{"category_id":"1","category_name":"Sports"}])");
    }
    if (url.find("get_live_streams") != std::string::npos) {
        return Answer(200, R"([{"stream_id":42,"name":"Match TV","category_id":"1","stream_icon":"https://logo.example/a.png"}])");
    }
    if (url.find("action=") == std::string::npos) {
        return Answer(200, R"({"user_info":{"username":"alice","auth":1,"status":"Active"}})");
    }
    return Answer(404);
}

// The panel the tests log in to.
Account Alice() {
    return Account{"http://panel.example", "alice", "secret"};
}

// ------------------------------------------------------------- server rules

TEST(xtream_normalizes_a_bare_server_and_a_pasted_address) {
    using tvm::xtream::NormalizeHost;
    REQUIRE_EQ(NormalizeHost("panel.example:8080/player_api.php"), std::optional<std::string>("http://panel.example:8080"));
    REQUIRE_EQ(NormalizeHost("https://tv.example.com/c/"), std::optional<std::string>("https://tv.example.com/c"));
    REQUIRE_EQ(NormalizeHost("http://panel.example/get.php?username=a&password=b#x"),
               std::optional<std::string>("http://panel.example"));
    REQUIRE_EQ(NormalizeHost("https://h.example:443/prefix/panel_api.php"), std::optional<std::string>("https://h.example/prefix"));
    REQUIRE(!NormalizeHost("").has_value());
    REQUIRE(!NormalizeHost("   ").has_value());
}

TEST(xtream_keeps_only_a_port_that_is_not_the_scheme_default) {
    using tvm::xtream::NormalizeHost;
    REQUIRE_EQ(NormalizeHost("http://a.example:80"), std::optional<std::string>("http://a.example"));
    REQUIRE_EQ(NormalizeHost("https://a.example:8443"), std::optional<std::string>("https://a.example:8443"));
    REQUIRE_EQ(NormalizeHost("HTTP://A.Example:8080"), std::optional<std::string>("http://a.example:8080"));
    REQUIRE_EQ(NormalizeHost("http://[::1]:8080"), std::optional<std::string>("http://[::1]:8080"));
}

TEST(xtream_refuses_addresses_that_are_not_web_servers) {
    using tvm::xtream::NormalizeHost;
    REQUIRE(!NormalizeHost("ftp://panel.example").has_value());
    REQUIRE(!NormalizeHost("javascript:alert(1)").has_value());
    REQUIRE(!NormalizeHost("http://panel.example:99999").has_value());
    REQUIRE(!NormalizeHost("http://:8080").has_value());
    REQUIRE(!NormalizeHost("http://[::1").has_value());
}

TEST(xtream_player_api_addresses_escape_the_login) {
    const Account account{"http://panel.example", "alice", "p@ss word"};
    REQUIRE_EQ(tvm::xtream::PlayerApiUrl(account),
               std::string("http://panel.example/player_api.php?username=alice&password=p%40ss+word"));
    REQUIRE_EQ(tvm::xtream::PlayerApiUrl(account, "get_live_streams"),
               std::string("http://panel.example/player_api.php?username=alice&password=p%40ss+word&action=get_live_streams"));
}

TEST(xtream_stream_addresses_are_mpeg_ts_unless_hls_is_asked_for) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) { return std::optional<tvm::http::Response>(Answer(500)); });
    const Account account{"http://panel.example", "alice", "secret"};

    REQUIRE_EQ(MakeClient(dir.path(), network).StreamUrl(account, "42"),
               std::string("http://panel.example/live/alice/secret/42.ts"));
    REQUIRE_EQ(MakeClient(dir.path(), network, {{L"TVM_XTREAM_HLS", L"1"}}).StreamUrl(account, "42"),
               std::string("http://panel.example/live/alice/secret/42.m3u8"));
    REQUIRE_EQ(MakeClient(dir.path(), network, {{L"TVM_XTREAM_HLS", L"true"}}).StreamUrl(account, "42"),
               std::string("http://panel.example/live/alice/secret/42.ts"));
}

TEST(xtream_logo_addresses_follow_the_node_rules) {
    using tvm::catalog::title::HttpAssetUrl;
    using tvm::catalog::title::IsHttpUrl;
    REQUIRE_EQ(HttpAssetUrl("//cdn.example/logo.png"), std::optional<std::string>("https://cdn.example/logo.png"));
    REQUIRE_EQ(HttpAssetUrl("https://cdn.example/logo.png"), std::optional<std::string>("https://cdn.example/logo.png"));
    REQUIRE(!HttpAssetUrl("javascript:alert(1)").has_value());
    REQUIRE(!HttpAssetUrl("file:///etc/passwd").has_value());
    REQUIRE(!HttpAssetUrl("   ").has_value());
    REQUIRE(IsHttpUrl("HTTP://a.example"));
    REQUIRE(IsHttpUrl("https://user:pw@host.example/x"));
    REQUIRE(!IsHttpUrl("https://"));
}

// ------------------------------------------------------------ login check

TEST(xtream_loads_channels_with_their_group_and_logo) {
    TempFolder dir;
    FakeNetwork network(ServingPanel);
    Client client = MakeClient(dir.path(), network);

    const Load load = client.LoadChannels(Alice());
    REQUIRE_EQ(load.error, std::string());
    REQUIRE_EQ(load.username, std::optional<std::string>("alice"));
    REQUIRE_EQ(load.channels,
               (std::vector<LiveChannel>{LiveChannel{"live:xtream:42", "Match TV", "", "Sports", "https://logo.example/a.png"}}));
    // The login is only ever sent to the panel's own address.
    for (const FakeNetwork::Request& request : network.requests) {
        REQUIRE(request.url.rfind("http://panel.example/player_api.php?", 0) == 0);
    }
}

TEST(xtream_refuses_a_password_the_panel_rejects) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) {
        return std::optional<tvm::http::Response>(Answer(200, R"({"user_info":{"auth":0}})"));
    });
    Client client = MakeClient(dir.path(), network);

    const Load load = client.LoadChannels(Account{"http://panel.example", "alice", "nope"});
    REQUIRE_EQ(load.error, std::string("needs-auth"));
    REQUIRE(load.channels.empty());
}

TEST(xtream_a_401_is_needs_auth_and_other_failures_are_unreachable) {
    TempFolder dir;
    FakeNetwork refused([](const std::string&) { return std::optional<tvm::http::Response>(Answer(401)); });
    REQUIRE_EQ(MakeClient(dir.path(), refused).Authenticate(Alice()).error, std::string("needs-auth"));

    FakeNetwork broken([](const std::string&) { return std::optional<tvm::http::Response>(Answer(500)); });
    REQUIRE_EQ(MakeClient(dir.path(), broken).Authenticate(Alice()).error, std::string("unreachable"));

    FakeNetwork silent([](const std::string&) { return std::optional<tvm::http::Response>(); });
    REQUIRE_EQ(MakeClient(dir.path(), silent).Authenticate(Alice()).error, std::string("unreachable"));
}

TEST(xtream_an_active_account_is_accepted_without_the_auth_flag) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) {
        return std::optional<tvm::http::Response>(Answer(200, R"({"user_info":{"username":"  ada ","status":"Active"}})"));
    });
    const Authentication auth = MakeClient(dir.path(), network).Authenticate(Alice());
    REQUIRE(auth.ok);
    REQUIRE_EQ(auth.username, std::optional<std::string>("ada"));
}

TEST(xtream_an_account_switched_off_is_refused_even_when_active) {
    TempFolder dir;
    FakeNetwork network([](const std::string&) {
        return std::optional<tvm::http::Response>(Answer(200, R"({"user_info":{"status":"Active","auth":"0"}})"));
    });
    REQUIRE_EQ(MakeClient(dir.path(), network).Authenticate(Alice()).error, std::string("needs-auth"));
}

TEST(xtream_a_panel_with_no_channels_counts_as_unreachable) {
    TempFolder dir;
    FakeNetwork network([](const std::string& url) -> std::optional<tvm::http::Response> {
        if (url.find("get_live_streams") != std::string::npos) return Answer(200, "[]");
        return ServingPanel(url);
    });
    const Load load = MakeClient(dir.path(), network).LoadChannels(Alice());
    REQUIRE_EQ(load.error, std::string("unreachable"));
    REQUIRE(load.channels.empty());
}

TEST(xtream_a_stream_list_that_is_not_a_list_is_unreachable) {
    TempFolder dir;
    FakeNetwork network([](const std::string& url) -> std::optional<tvm::http::Response> {
        if (url.find("get_live_streams") != std::string::npos) return Answer(200, R"({"error":"busy"})");
        return ServingPanel(url);
    });
    REQUIRE_EQ(MakeClient(dir.path(), network).LoadChannels(Alice()).error, std::string("unreachable"));
}

TEST(xtream_channels_still_load_when_the_categories_fail) {
    TempFolder dir;
    FakeNetwork network([](const std::string& url) -> std::optional<tvm::http::Response> {
        if (url.find("get_live_categories") != std::string::npos) return Answer(500);
        return ServingPanel(url);
    });
    const Load load = MakeClient(dir.path(), network).LoadChannels(Alice());
    REQUIRE_EQ(load.error, std::string());
    REQUIRE_EQ(load.channels.size(), std::size_t(1));
    REQUIRE(!load.channels[0].group.has_value());
}

TEST(xtream_channel_fields_follow_the_node_rules) {
    TempFolder dir;
    FakeNetwork network([](const std::string& url) -> std::optional<tvm::http::Response> {
        if (url.find("get_live_categories") != std::string::npos) {
            return Answer(200, R"([{"category_id":9,"category_name":"  "},{"category_id":"x"}])");
        }
        if (url.find("get_live_streams") != std::string::npos) {
            return Answer(200,
                          R"([{"stream_id":7,"category_id":9,"stream_icon":"//cdn.example/7.png"},)"
                          R"({"stream_id":"  8 ","name":"  Eight  ","stream_icon":"javascript:x"},)"
                          R"({"stream_id":7,"name":"Duplicate"},)"
                          R"({"name":"No id"},)"
                          R"({"stream_id":9,"name":"   "}])");
        }
        return ServingPanel(url);
    });
    const Load load = MakeClient(dir.path(), network).LoadChannels(Alice());
    REQUIRE_EQ(load.error, std::string());
    REQUIRE_EQ(load.channels.size(), std::size_t(3));

    REQUIRE_EQ(load.channels[0], (LiveChannel{"live:xtream:7", "Channel 7", "", "Live", "https://cdn.example/7.png"}));
    REQUIRE_EQ(load.channels[1], (LiveChannel{"live:xtream:8", "Eight", "", std::nullopt, std::nullopt}));
    REQUIRE_EQ(load.channels[2], (LiveChannel{"live:xtream:9", "Channel 9", "", std::nullopt, std::nullopt}));
}

// ------------------------------------------------------------------ store

TEST(xtream_saved_login_is_sealed_on_disk) {
    TempFolder dir;
    FakeNetwork network(ServingPanel);
    Client client = MakeClient(dir.path(), network);
    client.Save(Account{"http://panel.example", "alice", "pa55-secret"});

    const std::string onDisk = tvm::util::ReadTextFile(tvm::paths::XtreamPath(dir.path())).value_or("");
    REQUIRE(!onDisk.empty());
    REQUIRE(onDisk.find("pa55") == std::string::npos);
    REQUIRE(onDisk.find("alice") == std::string::npos);
    REQUIRE_EQ(client.Saved(), std::optional<Account>(Account{"http://panel.example", "alice", "pa55-secret"}));
    REQUIRE(network.requests.empty());
}

TEST(xtream_a_saved_login_missing_a_part_is_not_read) {
    TempFolder dir;
    FakeNetwork network(ServingPanel);
    Client client = MakeClient(dir.path(), network);
    client.Save(Account{"http://panel.example", "alice", ""});
    REQUIRE(!client.Saved().has_value());
}

TEST(xtream_forget_removes_the_saved_login) {
    TempFolder dir;
    FakeNetwork network(ServingPanel);
    Client client = MakeClient(dir.path(), network);
    client.Save(Alice());
    client.Forget();
    REQUIRE(!client.Saved().has_value());
    REQUIRE(!fs::exists(tvm::paths::XtreamPath(dir.path())));
}

TEST(xtream_a_plain_saved_login_is_read_and_sealed) {
    TempFolder dir;
    FakeNetwork network(ServingPanel);
    Client client = MakeClient(dir.path(), network);
    fs::create_directories(tvm::paths::SecretsDir(dir.path()));
    std::ofstream(tvm::paths::XtreamPath(dir.path()), std::ios::binary)
        << R"({"host":"panel.example:8080","username":" bob ","password":"pw"})";

    REQUIRE_EQ(client.Saved(), std::optional<Account>(Account{"http://panel.example:8080", "bob", "pw"}));
    const std::string after = tvm::util::ReadTextFile(tvm::paths::XtreamPath(dir.path())).value_or("");
    REQUIRE(after.find("panel.example") == std::string::npos);
}

// ----------------------------------------------------------------- screen

// A root screen whose OK opens the Live TV login, as Settings does.
class XtreamLauncher final : public tvm::ui::ScreenBase {
public:
    void Layout(double /*width*/, double /*height*/) override {}
    void Paint(tvm::ui::Painter& /*painter*/) const override {}
    std::optional<Command> Select(double /*nowMs*/) override {
        Command command;
        command.name = "live-xtream";
        return command;
    }
};

class MemoryStore final : public tvm::ui::PreferenceStore {
public:
    tvm::motion::MotionSettings Motion() const override { return motion_; }
    void SaveMotion(const tvm::motion::MotionSettings& settings) override { motion_ = settings; }
    tvm::prefs::CorePrefs CorePrefs() const override { return core_; }
    void SaveCorePrefs(const tvm::prefs::CorePrefsPatch& /*patch*/) override {}

    tvm::motion::MotionSettings motion_;
    tvm::prefs::CorePrefs core_;
};

XtreamView SavedLogin() {
    XtreamView view;
    view.loaded = true;
    view.configured = true;
    view.accountName = "alice";
    view.channels = 12;
    view.serverField = "http://panel.example";
    view.usernameField = "alice";
    return view;
}

XtreamScreen& XtreamOn(Shell& shell) {
    auto* screen = dynamic_cast<XtreamScreen*>(&shell.ActiveScreen());
    REQUIRE(screen != nullptr);
    return *screen;
}

std::pair<std::string, std::string> Row(const XtreamScreen& screen, const std::string& label) {
    for (const auto& [name, value] : screen.Facts()) {
        if (name == label) return {name, value};
    }
    return {label, "(missing)"};
}

TEST(xtream_screen_shows_placeholders_until_the_saved_login_is_read) {
    XtreamScreen screen;
    REQUIRE_EQ(Row(screen, "Account"), (std::pair<std::string, std::string>{"Account", "..."}));
    REQUIRE_EQ(Row(screen, "Channels"), (std::pair<std::string, std::string>{"Channels", "..."}));
    REQUIRE_EQ(Row(screen, "Server"), (std::pair<std::string, std::string>{"Server", "Not pasted"}));
    REQUIRE_EQ(Row(screen, "Password"), (std::pair<std::string, std::string>{"Password", "Not pasted"}));
}

TEST(xtream_screen_shows_the_saved_login_and_never_the_password) {
    XtreamScreen screen;
    XtreamView view = SavedLogin();
    view.passwordPasted = true;
    screen.SetView(view);
    REQUIRE_EQ(Row(screen, "Account"), (std::pair<std::string, std::string>{"Account", "alice"}));
    REQUIRE_EQ(Row(screen, "Channels"), (std::pair<std::string, std::string>{"Channels", "12"}));
    REQUIRE_EQ(Row(screen, "Server"), (std::pair<std::string, std::string>{"Server", "http://panel.example"}));
    REQUIRE_EQ(Row(screen, "Password"), (std::pair<std::string, std::string>{"Password", "Pasted"}));
}

TEST(xtream_screen_reports_channels_as_unavailable_when_the_login_fails) {
    XtreamScreen screen;
    XtreamView view = SavedLogin();
    view.error = "needs-auth";
    view.channels.reset();
    screen.SetView(view);
    REQUIRE_EQ(Row(screen, "Channels"), (std::pair<std::string, std::string>{"Channels", "Unavailable"}));
}

TEST(xtream_screen_moves_down_the_fields_and_across_the_buttons) {
    XtreamScreen screen;
    screen.SetView(SavedLogin());
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("server"));
    REQUIRE(screen.Navigate(tvm::nav::Direction::Down, 0.0));
    REQUIRE(screen.Navigate(tvm::nav::Direction::Down, 0.0));
    REQUIRE(screen.Navigate(tvm::nav::Direction::Down, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("save"));
    REQUIRE(!screen.Navigate(tvm::nav::Direction::Down, 0.0));
    REQUIRE(screen.Navigate(tvm::nav::Direction::Right, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("disconnect"));
    REQUIRE(screen.Navigate(tvm::nav::Direction::Up, 0.0));
    REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>("password"));
}

TEST(xtream_screen_has_no_disconnect_without_a_saved_login) {
    XtreamScreen screen;
    XtreamView view;
    view.loaded = true;
    screen.SetView(view);
    screen.FocusItem("save", 0.0, false);
    REQUIRE(!screen.Navigate(tvm::nav::Direction::Right, 0.0));
}

TEST(xtream_screen_rows_return_the_paste_actions) {
    XtreamScreen screen;
    const std::pair<std::string, std::string> expected[] = {
        {"server", "xtream-paste-server"},
        {"username", "xtream-paste-username"},
        {"password", "xtream-paste-password"},
    };
    for (const auto& [key, name] : expected) {
        screen.FocusItem(key, 0.0, false);
        REQUIRE_EQ(screen.FocusedKey(), std::optional<std::string>(key));
        const std::optional<Command> command = screen.Select(0.0);
        REQUIRE(command.has_value());
        REQUIRE_EQ(command->name, name);
        REQUIRE(command->action);
    }
}

TEST(xtream_screen_save_and_disconnect_return_the_actions) {
    XtreamScreen screen;
    screen.SetView(SavedLogin());
    REQUIRE(screen.FocusItem("save", 0.0, false));
    const std::optional<Command> save = screen.Select(0.0);
    REQUIRE(save.has_value());
    REQUIRE_EQ(save->name, std::string("xtream-save"));
    REQUIRE(save->action);

    REQUIRE(screen.FocusItem("disconnect", 0.0, false));
    const std::optional<Command> disconnect = screen.Select(0.0);
    REQUIRE(disconnect.has_value());
    REQUIRE_EQ(disconnect->name, std::string("xtream-disconnect"));
}

TEST(xtream_screen_controls_wait_while_a_request_is_in_flight) {
    XtreamScreen screen;
    XtreamView view = SavedLogin();
    view.busy = true;
    screen.SetView(view);
    REQUIRE(!screen.Select(0.0).has_value());
    REQUIRE(!screen.ActivateItem("save", 0.0).has_value());
}

TEST(xtream_screen_a_click_picks_the_server_row) {
    XtreamScreen screen;
    screen.SetView(SavedLogin());
    screen.Layout(1920.0, 1080.0);
    // At 1080p a rem is 16 px. The server row starts at 1.5 + 15 rem and is 2.5 rem tall.
    REQUIRE_EQ(screen.ItemAt(300.0, 16.5 * 16.0 + 20.0), std::optional<std::string>("server"));
    REQUIRE(!screen.ItemAt(4.0, 4.0).has_value());
}

TEST(xtream_screen_opens_from_settings_and_takes_the_answer) {
    MemoryStore store;
    Shell shell(std::make_unique<XtreamLauncher>(), store);
    shell.Layout(1920.0, 1080.0);

    shell.Select(0.0);
    REQUIRE_EQ(shell.ActiveScreenName(), std::string("live-xtream"));
    REQUIRE(!XtreamOn(shell).view().loaded);

    shell.SetXtreamView(SavedLogin());
    REQUIRE(XtreamOn(shell).view().loaded);
    REQUIRE_EQ(Row(XtreamOn(shell), "Account"), (std::pair<std::string, std::string>{"Account", "alice"}));
}

}  // namespace
