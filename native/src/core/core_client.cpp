#include "core/core_client.h"

#include <set>
#include <stdexcept>

#include "core/secrets.h"
#include "core/profiles.h"

namespace tvm::coreapi {

namespace {
std::string Text(const nlohmann::json& body, const char* key) {
    const auto it = body.find(key);
    return it != body.end() && it->is_string() ? it->get<std::string>() : "";
}
bool Flag(const nlohmann::json& body, const char* key) {
    const auto it = body.find(key);
    return it != body.end() && it->is_boolean() && it->get<bool>();
}
void ProfileHeader(const paths::fs::path& dataDir, http::Options& options) {
    const auto folder = profiles::ActiveFolder(dataDir);
    if (folder && folder->parent_path() == dataDir / "profiles")
        options.headers.emplace_back("X-TVM-Profile", util::ToUtf8(folder->filename().wstring()));
}
}  // namespace

AccountState ParseAccount(const nlohmann::json& body) {
    AccountState state;
    if (!body.is_object()) return state;
    state.canSendEmail = Flag(body, "canSendEmail");
    state.termsVersion = Text(body, "termsVersion");
    const auto account = body.find("account");
    const auto usable = body.find("usable");
    if (!Flag(body, "signedIn") || account == body.end() || !account->is_object()) return state;
    state.signedIn = true;
    state.name = Text(*account, "displayName");
    state.email = Text(*account, "email");
    state.tier = Text(*account, "tier");
    // Core currently maps private-service admins to its historical role name.
    state.developer = Text(*account, "role") == "admin" || Text(*account, "role") == "dev";
    state.liveTv = Flag(*account, "liveTv") || state.tier == "stream-live";
    state.rdKey = (Flag(*account, "rdKey") || Flag(*account, "hasRdToken"));
    state.usable = usable != body.end() && usable->is_object() && Flag(*usable, "ok");
    state.reason = usable != body.end() && usable->is_object() ? Text(*usable, "reason") : "no_account";
    if (!state.usable && state.reason.empty()) state.reason = "no_account";
    return state;
}

RealDebridStatus ParseRealDebridStatus(const nlohmann::json& body) {
    RealDebridStatus status;
    if (!body.is_object()) return status;
    status.configured = Flag(body, "configured");
    const std::string username = Text(body, "username");
    if (!username.empty()) status.username = username;
    status.premium = Flag(body, "premium");
    status.error = Text(body, "error");
    status.source = Text(body, "source");
    return status;
}

bool ShouldPromptForRealDebrid(const AccountState& account, const RealDebridStatus& rdStatus, bool dismissed) {
    return account.usable && !account.rdKey && !rdStatus.configured && !dismissed;
}

bool AllowsRoute(const AccountState& state, const std::string& route) {
    static const std::set<std::string> publicPages = {
        "home", "account", "settings", "legal", "plans", "donate", "updates", "setup", "recovery", "system-info", "diagnostics", "changelog", "confirm"};
    static const std::set<std::string> adminPages = {"developer", "accounts", "mail-settings", "live-check"};
    if (adminPages.contains(route)) return state.usable && state.developer;
    if (!state.usable) return publicPages.contains(route);
    if (route == "live-tv" || route == "live-xtream" || route == "live-playlist") return state.liveTv;
    return true;
}

admin::Account ParseAdminAccount(const nlohmann::json& body) {
    admin::Account account;
    if (!body.is_object()) return account;
    account.id = Text(body, "id"); account.email = Text(body, "email"); account.displayName = Text(body, "displayName");
    account.createdAt = Text(body, "createdAt"); account.activatedAt = Text(body, "activatedAt");
    account.tier = Text(body, "tier"); account.note = Text(body, "note");
    account.termsVersion = Text(body, "termsVersion"); account.termsAcceptedAt = Text(body, "termsAcceptedAt");
    account.emailVerifiedAt = Text(body, "emailVerifiedAt"); account.lastSeenAt = Text(body, "lastSeenAt"); account.lastClient = Text(body, "lastClient");
    account.activated = Flag(body, "activated") || Text(body, "status") == "active"; account.suspended = Flag(body, "suspended") || Text(body, "status") == "suspended";
    account.hasRdKey = Flag(body, "rdKey") || Flag(body, "hasRdToken"); account.emailCodeSent = Flag(body, "emailCodeSent");
    if (body.contains("signIns") && body["signIns"].is_number_integer()) account.signIns = body["signIns"].get<int>();
    if (body.contains("activeSessions") && body["activeSessions"].is_number_integer()) account.sessions = body["activeSessions"].get<int>();
    if (Flag(body, "emailVerified") && account.emailVerifiedAt.empty()) account.emailVerifiedAt = "Verified";
    if (body.contains("sessionCount") && body["sessionCount"].is_number_integer()) account.sessions = body["sessionCount"].get<int>();
    return account;
}

std::optional<admin::MailSettings> ParseMailStatus(const nlohmann::json& body) {
    if (!body.is_object() || !Flag(body, "configured")) return std::nullopt;
    admin::MailSettings settings;
    settings.host = Text(body, "host"); settings.username = Text(body, "username"); settings.from = Text(body, "from");
    settings.security = Text(body, "security");
    if (settings.security.empty()) settings.security = "starttls";
    if (body.contains("port") && body["port"].is_number_integer()) settings.port = body["port"].get<int>();
    return settings;
}

Client::Client(paths::fs::path dataDir, unsigned port, http::Transport transport)
    : dataDir_(std::move(dataDir)), port_(port), transport_(std::move(transport)) {
    if (port == 0 || port > 65535) throw std::invalid_argument("Invalid Core port.");
    origin_ = "http://127.0.0.1:" + std::to_string(port);
    token_ = secrets::ReadSecret(dataDir_ / L"native-account-session").value_or("");
}

nlohmann::json Client::Call(const std::string& path, const std::string& method, const nlohmann::json& body) const {
    if (path.rfind("/api/", 0) != 0 || path.find_first_of("\r\n#") != std::string::npos)
        throw std::invalid_argument("Invalid Core request.");
    http::Options options;
    options.userAgent = "TVM-Native/1.0 Windows";
    options.accept = "application/json";
    options.maxBytes = 2 * 1024 * 1024;
    options.method = method;
    options.followRedirects = false;
    if (path.starts_with("/api/extras/")) options.timeoutMs = 6000;
    if (path == "/api/desktop/runtime") options.timeoutMs = 1000;
    if (path == "/api/playback" || path == "/api/downloads/resolve") options.timeoutMs = 90000;
    if (path == "/api/desktop/mpv") options.timeoutMs = 180000;
    {
        const std::lock_guard lock(mutex_);
        if (!token_.empty() && path != "/api/desktop/runtime") options.headers.emplace_back("Authorization", "Bearer " + token_);
    }
    if (path != "/api/desktop/runtime") ProfileHeader(dataDir_, options);
    if (!body.is_null()) {
        options.headers.emplace_back("Content-Type", "application/json");
        options.body = body.dump();
    }
    const auto response = transport_(origin_ + path, options);
    if (!response) throw std::runtime_error("TVM Core is unavailable. Choose Retry to start it again.");
    if (response->status == 204) return nlohmann::json::object();
    const auto json = nlohmann::json::parse(response->body, nullptr, false);
    if (!response->ok() || !json.is_object()) {
        const auto message = json.is_object() ? Text(json, "error") : std::string();
        throw RequestError(message.empty() ? "TVM Core could not complete that request." : message,
                           json.is_object() ? Text(json, "reason") : "");
    }
    return json;
}

std::string Client::Subtitle(const std::string& url) const {
    const std::string path = url.starts_with(origin_) ? url.substr(origin_.size()) : url;
    if (!path.starts_with("/api/extras/subtitle.vtt?u=") || path.find_first_of("\r\n#") != std::string::npos)
        throw std::invalid_argument("Invalid subtitle request.");
    http::Options options; options.timeoutMs = 6000; options.maxBytes = 4 * 1024 * 1024;
    options.accept = "text/vtt"; options.followRedirects = false;
    { const std::lock_guard lock(mutex_);
      if (!token_.empty()) options.headers.emplace_back("Authorization", "Bearer " + token_); }
    ProfileHeader(dataDir_, options);
    const auto response = transport_(origin_ + path, options);
    if (!response || !response->ok() || !response->body.starts_with("WEBVTT")) throw std::runtime_error("Subtitle unavailable.");
    return response->body;
}

void Client::SaveToken(const std::string& token) {
    const std::lock_guard lock(mutex_);
    if (token.empty()) secrets::DeleteSecret(dataDir_ / L"native-account-session");
    else secrets::WriteSecret(dataDir_ / L"native-account-session", token);
    token_ = token;
}

AccountState Client::Status() const { return ParseAccount(Call("/api/account")); }
AccountState Client::SignIn(const std::string& email, const std::string& password) {
    const auto body = Call("/api/account/signin", "POST", {{"email", email}, {"password", password}});
    const auto token = Text(body, "token");
    if (token.empty()) throw std::runtime_error("The Core did not return a session.");
    SaveToken(token);
    return Status();
}
void Client::Register(const std::string& email, const std::string& password, const std::string& name) {
    Call("/api/account/register", "POST", {{"email", email}, {"password", password}, {"displayName", name}});
}
void Client::SignOut() {
    try { Call("/api/account/signout", "POST"); }
    catch (...) { SaveToken(""); throw; }
    SaveToken("");
}

}  // namespace tvm::coreapi
