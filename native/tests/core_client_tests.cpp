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

TEST(native_realdebrid_prompt_gating_respects_account_key_configured_and_dismissed) {
    const auto withRdKey = coreapi::ParseAccount({
        {"signedIn", true},
        {"account", {{"role", "member"}, {"email", "viewer@example.test"}, {"tier", "stream"}, {"rdKey", true}}},
        {"usable", {{"ok", true}}},
    });
    REQUIRE(withRdKey.rdKey);

    const auto withoutRdKey = coreapi::ParseAccount({
        {"signedIn", true},
        {"account", {{"role", "member"}, {"email", "viewer@example.test"}, {"tier", "stream"}, {"rdKey", false}}},
        {"usable", {{"ok", true}}},
    });
    REQUIRE(!withoutRdKey.rdKey);

    const auto notConfigured = coreapi::ParseRealDebridStatus({{"configured", false}, {"source", nullptr}});
    REQUIRE(!notConfigured.configured);
    REQUIRE(notConfigured.source.empty());

    const auto deviceConfigured = coreapi::ParseRealDebridStatus({{"configured", true}, {"username", "ada"}, {"premium", true}, {"source", "device"}});
    REQUIRE(deviceConfigured.configured);
    REQUIRE_EQ(deviceConfigured.username, std::optional<std::string>("ada"));
    REQUIRE(deviceConfigured.premium);
    REQUIRE_EQ(deviceConfigured.source, std::string("device"));

    const auto accountConfigured = coreapi::ParseRealDebridStatus({{"configured", true}, {"source", "account"}});
    REQUIRE_EQ(accountConfigured.source, std::string("account"));

    // Never prompt when unusable, when account already has a remote rdKey, when configured, or when dismissed.
    coreapi::AccountState unusable = withoutRdKey;
    unusable.usable = false;
    REQUIRE(!coreapi::ShouldPromptForRealDebrid(unusable, notConfigured, false));
    REQUIRE(!coreapi::ShouldPromptForRealDebrid(withRdKey, notConfigured, false));
    REQUIRE(!coreapi::ShouldPromptForRealDebrid(withoutRdKey, deviceConfigured, false));
    REQUIRE(!coreapi::ShouldPromptForRealDebrid(withoutRdKey, notConfigured, true));

    // Prompt only when usable, no remote rdKey, not configured locally, and not dismissed.
    REQUIRE(coreapi::ShouldPromptForRealDebrid(withoutRdKey, notConfigured, false));
}

TEST(account_copy_helpers_translate_statuses_validate_inputs_and_hide_raw_errors) {
    coreapi::AccountState awaiting = coreapi::ParseAccount({
        {"signedIn", true},
        {"account", {{"role", "member"}, {"email", "wait@tvm.test"}, {"activated", false}, {"suspended", false}, {"createdAt", "2026-04-12T10:00:00Z"}}},
        {"usable", {{"ok", false}, {"reason", "awaiting_activation"}}},
    });
    REQUIRE_EQ(coreapi::AccountStatusLabel(awaiting), std::string("Waiting for approval"));
    REQUIRE_EQ(coreapi::ShortDateLabel(awaiting.createdAt), std::string("12 Apr 2026"));

    coreapi::AccountState paused = coreapi::ParseAccount({
        {"signedIn", true},
        {"account", {{"role", "member"}, {"email", "paused@tvm.test"}, {"activated", true}, {"suspended", true}}},
        {"usable", {{"ok", false}, {"reason", "suspended"}}},
    });
    REQUIRE_EQ(coreapi::AccountStatusLabel(paused), std::string("Paused by the owner"));

    REQUIRE_EQ(coreapi::FriendlyPlanName("stream"), std::string("Stream"));
    REQUIRE_EQ(coreapi::FriendlyPlanName("stream-live"), std::string("Stream + Live"));
    REQUIRE_EQ(coreapi::FriendlyPlanName(""), std::string("No active plan"));

    REQUIRE(coreapi::ValidateEmailInput("").has_value());
    REQUIRE(coreapi::ValidateEmailInput("not-an-email").has_value());
    REQUIRE(!coreapi::ValidateEmailInput("ada@tvm.test").has_value());
    REQUIRE(coreapi::ValidatePasswordInput("short", true).has_value());
    REQUIRE(!coreapi::ValidatePasswordInput("tencharpass", true).has_value());
    REQUIRE(!coreapi::ValidatePasswordInput("short", false).has_value());

    REQUIRE_EQ(coreapi::FriendlyAccountError("HTTP 429 rate_limited"), std::string("Too many tries. Wait a minute and try again."));
    REQUIRE_EQ(coreapi::FriendlyAccountError("HTTP 401 invalid_credentials"),
               std::string("That password doesn't match this email. Try again or ask the owner to reset it."));
    REQUIRE(coreapi::FriendlyAccountError("HTTP 502 bad gateway").find("502") == std::string::npos);
    REQUIRE(coreapi::FriendlyAccountError("awaiting_activation").find('_') == std::string::npos);

    const auto tiers = coreapi::ParseTiersDocument({
        {"route", "/pricing"},
        {"streamMonthlyPence", 1000},
        {"tiers", {
            {{"id", "stream"}, {"name", "Stream"}, {"tag", "Movies & TV"}, {"monthlyPence", 1000}, {"yearlyPence", 9000}},
            {{"id", "stream-live"}, {"name", "Stream + Live"}, {"tag", "Everything + Live TV"}, {"monthlyPence", 1700}, {"yearlyPence", 15000}, {"liveIncluded", true}},
        }},
    });
    REQUIRE_EQ(tiers.tiers.size(), std::size_t{2});
    REQUIRE_EQ(tiers.tiers[1].yearlyPence, 15000);
}
