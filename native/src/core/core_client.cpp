#include "core/core_client.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <cstdlib>
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
int IntField(const nlohmann::json& body, const char* key, int fallback = 0) {
    const auto it = body.find(key);
    if (it == body.end() || !it->is_number()) return fallback;
    return it->get<int>();
}
std::string Lower(std::string value) {
    for (char& ch : value) ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    return value;
}
std::string Trim(std::string value) {
    auto isSpace = [](unsigned char ch) { return std::isspace(ch) != 0; };
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.front()))) value.erase(value.begin());
    while (!value.empty() && isSpace(static_cast<unsigned char>(value.back()))) value.pop_back();
    return value;
}
bool ContainsAny(const std::string& haystack, std::initializer_list<const char*> needles) {
    for (const char* needle : needles) {
        if (haystack.find(needle) != std::string::npos) return true;
    }
    return false;
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
    state.createdAt = Text(*account, "createdAt");
    // Core currently maps private-service admins to its historical role name.
    state.developer = Text(*account, "role") == "admin" || Text(*account, "role") == "dev";
    state.liveTv = Flag(*account, "liveTv") || state.tier == "stream-live";
    state.rdKey = (Flag(*account, "rdKey") || Flag(*account, "hasRdToken"));
    state.usable = usable != body.end() && usable->is_object() && Flag(*usable, "ok");
    state.activated = account->contains("activated") ? Flag(*account, "activated") : state.usable;
    state.suspended = Flag(*account, "suspended");
    state.emailCodeSent = Flag(*account, "emailCodeSent");
    state.reason = usable != body.end() && usable->is_object() ? Text(*usable, "reason") : "no_account";
    if (!state.usable && state.reason.empty()) state.reason = "no_account";
    return state;
}

TermsDocument DefaultTermsDocument() {
    TermsDocument doc;
    doc.version = "1.0";
    doc.updated = "2026-04-01";
    doc.intro = "TVM is a personal media client. By creating or using an account, you agree to the terms below.";
    doc.sections = {
        {"What TVM stores", "TVM keeps your account email, chosen display name, active plan, and whether your account has been approved. Playback settings, watch progress, and watchlist items stay on this device."},
        {"Your account and approval", "New accounts wait for the app owner to approve them before playback opens. The owner may also pause an account or update which plan it includes."},
        {"Who can use the service", "Accounts are personal to you and your household profiles. Do not share your sign-in details or use TVM to host or redistribute content."},
        {"Privacy and third-party services", "If you connect Real-Debrid or add a Live TV playlist, those requests go straight to the providers you configure using your own credentials."},
        {"Stopping use or removal", "You can sign out at any time from your account page. Ask the app owner if you want your account removed."},
    };
    return doc;
}

TermsDocument ParseTermsDocument(const nlohmann::json& body) {
    TermsDocument doc = DefaultTermsDocument();
    if (!body.is_object()) return doc;
    if (const auto version = Text(body, "version"); !version.empty()) doc.version = version;
    if (const auto updated = Text(body, "updated"); !updated.empty()) doc.updated = updated;
    if (const auto intro = Text(body, "intro"); !intro.empty()) doc.intro = intro;
    if (const auto sections = body.find("sections"); sections != body.end() && sections->is_array() && !sections->empty()) {
        doc.sections.clear();
        for (const auto& entry : *sections) {
            if (!entry.is_object()) continue;
            TermsSection sec;
            sec.title = Text(entry, "title");
            sec.body = Text(entry, "body");
            if (!sec.title.empty() || !sec.body.empty()) doc.sections.push_back(std::move(sec));
        }
        if (doc.sections.empty()) doc.sections = DefaultTermsDocument().sections;
    }
    return doc;
}

TiersDocument DefaultTiersDocument() {
    TiersDocument doc;
    doc.route = "/pricing";
    doc.streamMonthlyPence = 1000;
    AccessTier stream;
    stream.id = "stream";
    stream.name = "Stream";
    stream.tag = "Movies & TV";
    stream.monthlyPence = 1000;
    stream.yearlyPence = 9000;
    stream.orderable = true;
    stream.liveIncluded = false;
    stream.bullets = {
        "Movies, TV series and personalised rails",
        "Up to 10 household profiles",
        "Real-Debrid playback & offline downloads",
    };
    stream.finePrint = "Arrange access with the app owner. No card is taken here.";

    AccessTier streamLive;
    streamLive.id = "stream-live";
    streamLive.name = "Stream + Live";
    streamLive.tag = "Everything + Live TV";
    streamLive.monthlyPence = 1700;
    streamLive.yearlyPence = 15000;
    streamLive.liveAddOnMonthlyPence = 700;
    streamLive.liveAddOnYearlyPence = 6000;
    streamLive.orderable = true;
    streamLive.liveIncluded = true;
    streamLive.bullets = {
        "Everything in Stream",
        "Live UK channels & TV guide",
        "Catch-up where available",
    };
    streamLive.finePrint = "Includes Live TV add-on. Arrange access with the app owner.";

    doc.tiers = {std::move(stream), std::move(streamLive)};
    return doc;
}

TiersDocument ParseTiersDocument(const nlohmann::json& body) {
    TiersDocument doc = DefaultTiersDocument();
    if (!body.is_object()) return doc;
    if (const auto route = Text(body, "route"); !route.empty()) doc.route = route;
    if (const int base = IntField(body, "streamMonthlyPence", 0); base > 0) doc.streamMonthlyPence = base;
    const auto tiers = body.find("tiers");
    if (tiers == body.end() || !tiers->is_array() || tiers->empty()) return doc;
    std::vector<AccessTier> parsed;
    for (const auto& entry : *tiers) {
        if (!entry.is_object()) continue;
        AccessTier tier;
        tier.id = Text(entry, "id");
        tier.name = Text(entry, "name");
        tier.tag = Text(entry, "tag");
        tier.monthlyPence = IntField(entry, "monthlyPence");
        tier.yearlyPence = IntField(entry, "yearlyPence");
        tier.liveAddOnMonthlyPence = IntField(entry, "liveAddOnMonthlyPence");
        tier.liveAddOnYearlyPence = IntField(entry, "liveAddOnYearlyPence");
        tier.orderable = entry.contains("orderable") ? Flag(entry, "orderable") : true;
        tier.liveIncluded = Flag(entry, "liveIncluded") || tier.id == "stream-live";
        tier.finePrint = Text(entry, "finePrint");
        if (const auto bullets = entry.find("bullets"); bullets != entry.end() && bullets->is_array()) {
            for (const auto& bullet : *bullets) {
                if (bullet.is_string() && !bullet.get<std::string>().empty()) {
                    tier.bullets.push_back(bullet.get<std::string>());
                }
            }
        }
        if (!tier.id.empty() && !tier.name.empty()) parsed.push_back(std::move(tier));
    }
    if (!parsed.empty()) doc.tiers = std::move(parsed);
    return doc;
}

std::optional<std::string> ValidateEmailInput(const std::string& raw) {
    const std::string trimmed = Trim(raw);
    if (trimmed.empty()) return std::string("Enter your email address.");
    if (trimmed.find_first_of(" \t\r\n") != std::string::npos) return std::string("Remove spaces from the email address.");
    const std::size_t at = trimmed.find('@');
    if (at == std::string::npos || at == 0 || trimmed.find('@', at + 1) != std::string::npos) {
        return std::string("Check the email address. It should look like name@example.com.");
    }
    const std::string domain = trimmed.substr(at + 1);
    const std::size_t dot = domain.find('.');
    if (domain.empty() || dot == std::string::npos || dot == 0 || dot + 1 >= domain.size()) {
        return std::string("Check the email address. It should look like name@example.com.");
    }
    return std::nullopt;
}

std::optional<std::string> ValidatePasswordInput(const std::string& password, bool forSignup) {
    if (password.empty()) {
        return forSignup ? std::string("Create a password to continue.") : std::string("Enter your password.");
    }
    if (forSignup && password.size() < kMinPasswordLength) {
        return std::string("Use at least 10 characters.");
    }
    if (password.size() > kMaxPasswordLength) {
        return std::string("That password is too long.");
    }
    return std::nullopt;
}

std::string AccountStatusLabel(const AccountState& account) {
    if (!account.signedIn) return "Signed out";
    if (account.reason == "suspended" || account.suspended) return "Paused by the owner";
    if (account.reason == "terms_required") return "Accept the terms to continue";
    if (account.reason == "email_unverified") return "Confirm your email to continue";
    if (account.reason == "awaiting_activation" || !account.activated) return "Waiting for approval";
    if (!account.usable && account.reason != "no_account" && !account.reason.empty()) return "Pending review";
    return "Active";
}

std::string FriendlyPlanName(const std::string& tier) {
    if (tier == "stream") return "Stream";
    if (tier == "stream-live") return "Stream + Live";
    return "No active plan";
}

std::string FriendlyAccountError(const std::string& raw) {
    const std::string trimmed = Trim(raw);
    if (trimmed.empty()) return "Something went wrong. Try again.";
    const std::string lower = Lower(trimmed);
    if (ContainsAny(lower, {"rate_limited", "rate limit", "too many", "slow_down", "429"})) {
        return "Too many tries. Wait a minute and try again.";
    }
    if (ContainsAny(lower, {"invalid_credentials", "wrong password", "incorrect password", "invalid email or password", "401"})) {
        return "That password doesn't match this email. Try again or ask the owner to reset it.";
    }
    if (ContainsAny(lower, {"email_taken", "already exists", "already registered", "409"})) {
        return "An account with this email already exists. Try signing in instead.";
    }
    if (ContainsAny(lower, {"awaiting_activation"})) {
        return "Your account is waiting for the owner to approve it.";
    }
    if (ContainsAny(lower, {"suspended"})) {
        return "Your account is paused. Ask the owner to restore it.";
    }
    if (ContainsAny(lower, {"terms_required"})) {
        return "Accept the terms to continue.";
    }
    if (ContainsAny(lower, {"email_unverified"})) {
        return "Confirm your email to continue.";
    }
    if (ContainsAny(lower, {"invalid_invite"})) {
        return "That invite code is invalid or has already been used.";
    }
    if (ContainsAny(lower, {"authorization_pending", "428"})) {
        return "Finish signing in on your phone or browser.";
    }
    if (ContainsAny(lower, {"expired_token", "expired", "410"})) {
        return "That sign-in code has expired. Start a new one.";
    }
    if (ContainsAny(lower, {"password_too_short", "at least 10"})) {
        return "Use at least 10 characters.";
    }
    if (ContainsAny(lower, {"password_too_long", "200 characters"})) {
        return "That password is too long.";
    }
    if (ContainsAny(lower, {"password_too_common"})) {
        return "Choose a less common password.";
    }
    if (ContainsAny(lower, {"invalid_email"})) {
        return "Check the email address. It should look like name@example.com.";
    }
    if (ContainsAny(lower, {"unreachable", "timeout", "timed out", "connection", "could not reach", "couldn't reach", "failed to connect", "core is not running"})) {
        return "We couldn't reach TVM right now. Check your connection and try again.";
    }
    if (ContainsAny(lower, {"http 5", "internal server", "502", "503", "504", "500"})) {
        return "Something went wrong on our side. Try again in a moment.";
    }
    if (ContainsAny(lower, {"http ", "status ", "sqlite", "exception", "{", "<html"}) || lower.find('_') != std::string::npos) {
        return "Something went wrong. Try again.";
    }
    return trimmed;
}

std::string ShortDateLabel(const std::string& iso) {
    const std::string trimmed = Trim(iso);
    if (trimmed.size() < 10 || trimmed[4] != '-' || trimmed[7] != '-') return trimmed;
    const int year = std::atoi(trimmed.substr(0, 4).c_str());
    const int month = std::atoi(trimmed.substr(5, 2).c_str());
    const int day = std::atoi(trimmed.substr(8, 2).c_str());
    static constexpr std::array<const char*, 12> kMonths = {
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"};
    if (year <= 0 || month < 1 || month > 12 || day < 1 || day > 31) return trimmed;
    return std::to_string(day) + " " + kMonths[static_cast<std::size_t>(month - 1)] + " " + std::to_string(year);
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
    // A Core update downloads and unpacks the new bundle before it answers.
    if (path == "/api/update/check") options.timeoutMs = 30000;
    if (path == "/api/update/apply") options.timeoutMs = 180000;
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
void Client::Register(const std::string& email, const std::string& password, const std::string& name,
                      const std::string& inviteCode) {
    nlohmann::json body = {{"email", email}, {"password", password}, {"displayName", name}};
    if (!inviteCode.empty()) body["inviteCode"] = inviteCode;
    Call("/api/account/register", "POST", body);
}
void Client::SignOut() {
    try { Call("/api/account/signout", "POST"); }
    catch (...) { SaveToken(""); throw; }
    SaveToken("");
}
TermsDocument Client::Terms() const { return ParseTermsDocument(Call("/api/terms")); }
TiersDocument Client::Tiers() const { return ParseTiersDocument(Call("/api/tiers")); }
AccountState Client::AcceptTerms() {
    Call("/api/account/terms", "POST", nlohmann::json::object());
    return Status();
}
void Client::SendVerificationEmail() {
    Call("/api/account/email/send", "POST", nlohmann::json::object());
}
AccountState Client::VerifyEmailCode(const std::string& code) {
    Call("/api/account/email/verify", "POST", {{"code", code}});
    return Status();
}
std::string Client::RecordPlanChoice(const std::string& tierId, const std::string& cadence) const {
    const std::string normalizedCadence = cadence == "year" ? "year" : "month";
    const bool liveTv = tierId == "stream-live";
    const auto quote = Call("/api/pricing/quote", "POST", {{"cadence", normalizedCadence}, {"liveTv", liveTv}});
    const auto accepted = Call("/api/pricing/accept", "POST", {{"quote", quote}});
    if (const auto message = Text(accepted, "message"); !message.empty()) return message;
    return "Choice recorded for " + FriendlyPlanName(tierId) + ". Ask the app owner to finish setting it up.";
}

}  // namespace tvm::coreapi
