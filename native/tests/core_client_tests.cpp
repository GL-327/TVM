#include <chrono>
#include <algorithm>
#include "core/core_client.h"
#include "core/secrets.h"
#include "core/util.h"
#include "harness.h"

namespace {
using namespace tvm;
struct Folder {
    std::filesystem::path path = std::filesystem::temp_directory_path() / ("tvm-account-test-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
    ~Folder() { std::error_code e; std::filesystem::remove_all(path, e); }
};
nlohmann::json SignedIn() {
    return {{"signedIn", true}, {"account", {{"role", "member"}, {"email", "viewer@example.test"}, {"tier", "stream"}}}, {"usable", {{"ok", true}}}};
}
}

TEST(native_account_gates_fail_closed_and_distinguish_roles_and_live_tiers) {
    auto state = coreapi::ParseAccount(nlohmann::json::object());
    REQUIRE(!coreapi::AllowsRoute(state, "player"));
    REQUIRE(coreapi::AllowsRoute(state, "account"));
    REQUIRE(coreapi::AllowsRoute(state, "updates"));
    state = coreapi::ParseAccount(SignedIn());
    REQUIRE(coreapi::AllowsRoute(state, "player"));
    REQUIRE(!coreapi::AllowsRoute(state, "accounts"));
    REQUIRE(!coreapi::AllowsRoute(state, "live-tv"));
    REQUIRE(!coreapi::AllowsRoute(state, "live-xtream"));
    state.liveTv = true;
    REQUIRE(coreapi::AllowsRoute(state, "live-tv"));
    state.developer = true;
    REQUIRE(coreapi::AllowsRoute(state, "accounts"));
    state.usable = false;
    REQUIRE(!coreapi::AllowsRoute(state, "accounts"));
    REQUIRE(!coreapi::AllowsRoute(state, "downloads"));
}

TEST(native_account_session_is_encrypted_persistent_and_never_sent_to_runtime_probe) {
    Folder folder;
    secrets::WriteSecret(folder.path / L"native-account-session", "fixture-session");
    int requests = 0;
    coreapi::Client client(folder.path, 17345, [&](const std::string& url, const http::Options& options) -> std::optional<http::Response> {
        REQUIRE(url.starts_with("http://127.0.0.1:17345/api/"));
        REQUIRE(!options.followRedirects);
        const bool runtime = url.ends_with("/runtime");
        bool bearer = false;
        for (const auto& [name, value] : options.headers) if (name == "Authorization") { bearer = true; REQUIRE_EQ(value, "Bearer fixture-session"); }
        REQUIRE_EQ(bearer, !runtime);
        ++requests;
        return http::Response{200, runtime ? "{\"protocol\":1}" : SignedIn().dump()};
    });
    REQUIRE(client.Status().usable);
    client.Call("/api/desktop/runtime");
    REQUIRE_EQ(requests, 2);
    REQUIRE_THROWS_CONTAINING(client.Call("https://example.test/api/account"), "Invalid Core request");
    REQUIRE_THROWS_CONTAINING(client.Call("/api/account\r\nX: bad"), "Invalid Core request");
    REQUIRE_EQ(requests, 2);
}

TEST(native_account_signout_clears_local_session_even_when_core_is_down) {
    Folder folder;
    secrets::WriteSecret(folder.path / L"native-account-session", "fixture-session");
    coreapi::Client client(folder.path, 7345, [](const auto&, const auto&) -> std::optional<http::Response> { return std::nullopt; });
    REQUIRE_THROWS_CONTAINING(client.SignOut(), "unavailable");
    REQUIRE(!secrets::ReadSecret(folder.path / L"native-account-session").has_value());
}

TEST(native_core_preserves_playback_failure_reason_without_following_redirects) {
    Folder folder;
    coreapi::Client client(folder.path, 7345, [](const auto&, const http::Options& options) -> std::optional<http::Response> {
        REQUIRE(!options.followRedirects);
        return http::Response{409, "{\"kind\":\"unavailable\",\"reason\":\"needs-auth\"}"};
    });
    try { client.Call("/api/playback", "POST", {{"id", "fixture"}}); REQUIRE(false); }
    catch (const coreapi::RequestError& error) { REQUIRE_EQ(error.reason, "needs-auth"); }
}

TEST(native_signin_saves_a_session_then_refreshes_account_entitlements) {
    Folder folder;
    int calls = 0;
    coreapi::Client client(folder.path, 7345, [&](const std::string& url, const http::Options& options) -> std::optional<http::Response> {
        ++calls;
        if (url.ends_with("/signin")) {
            REQUIRE_EQ(options.method, "POST");
            const auto body = nlohmann::json::parse(options.body);
            REQUIRE_EQ(body.at("email"), "viewer@example.test");
            REQUIRE_EQ(body.at("password"), "fixture password");
            return http::Response{200, "{\"token\":\"new-session\"}"};
        }
        REQUIRE(url.ends_with("/account"));
        REQUIRE(std::find(options.headers.begin(), options.headers.end(), std::pair<std::string, std::string>{"Authorization", "Bearer new-session"}) != options.headers.end());
        return http::Response{200, SignedIn().dump()};
    });
    const auto account = client.SignIn("viewer@example.test", "fixture password");
    REQUIRE(account.usable);
    REQUIRE_EQ(account.tier, "stream");
    REQUIRE_EQ(calls, 2);
    REQUIRE_EQ(secrets::ReadSecret(folder.path / L"native-account-session").value_or(""), "new-session");
}

TEST(native_admin_status_uses_public_core_fields_and_accepts_nullable_mail_username) {
    const auto account = coreapi::ParseAdminAccount({{"id", "fixture"}, {"rdKey", true}, {"activeSessions", 3}, {"signIns", 7}, {"note", nullptr}, {"emailVerifiedAt", nullptr}});
    REQUIRE(account.hasRdKey);
    REQUIRE_EQ(account.sessions, 3);
    REQUIRE_EQ(account.signIns, 7);
    REQUIRE(account.note.empty());
    REQUIRE(account.emailVerifiedAt.empty());
    const auto mail = coreapi::ParseMailStatus({{"configured", true}, {"host", "smtp.example.test"}, {"port", 587}, {"security", "starttls"}, {"username", nullptr}, {"from", "owner@example.test"}});
    REQUIRE(mail.has_value());
    REQUIRE(mail->username.empty());
    REQUIRE(mail->password.empty());
    REQUIRE_EQ(mail->host, "smtp.example.test");
}
