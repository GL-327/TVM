#include "platform/app.h"
#include <algorithm>
#include "platform/core_host.h"

namespace tvm::platform {
namespace {
ui::InfoAction Action(const char* key, const char* label, bool primary = false, bool disabled = false) {
    ui::InfoAction a; a.key = key; a.label = label; a.primary = primary; a.disabled = disabled; return a;
}
}

void App::RefreshAccount() {
    if (accountBusy_) return;
    accountBusy_ = true;
    background_->Run([this] {
        coreapi::AccountState next;
        std::string error;
        try { EnsureCore(*core_); next = core_->Status(); }
        catch (const std::exception& e) { error = e.what(); }
        background_->PostToUi([this, next, error] { FinishAccount(next, error); });
    });
}

void App::FinishAccount(const coreapi::AccountState& state, const std::string& message) {
    const bool changed = account_.email != state.email || account_.developer != state.developer || account_.usable != state.usable || account_.liveTv != state.liveTv || account_.tier != state.tier;
    account_ = state;
    accountBusy_ = false;
    accountCheckedMs_ = NowMs();
    accountMessage_ = message;
    if (changed) {
        StopPlayback();
        for (auto& job : downloads_) { job.cancel->store(true); if (job.state == "queued") job.state = "cancelled"; }
        shell_->PopToRoot(NowMs());
        streamStatusLoaded_ = false;
        realDebridOpened_ = false;
        titles_.clear();
        fieldValues_.clear();
    }
    RebuildHome();
    if (pageName_ == "account") ShowInfoPage();
    dirty_ = true;
}

ui::InfoView App::AccountView() const {
    ui::InfoView view;
    view.kicker = "Your TVM account";
    view.heading = account_.signedIn ? (account_.name.empty() ? account_.email : account_.name) : "Sign in to TVM";
    view.lede = account_.signedIn ? account_.email + "  /  " + account_.tier : "Use the same account as web, mobile and Roku. New accounts need activation by the operator.";
    view.message = accountBusy_ ? "Contacting TVM Core..." : accountMessage_;
    view.topActions = {Action("back", "Back"), Action("info:account-refresh", "Retry / refresh", false, accountBusy_), Action("open:legal", "Privacy & terms")};
    if (!account_.signedIn) {
        view.field = true;
        view.fieldLabel = fieldMode_.empty() ? "email" : fieldMode_;
        view.fieldPlaceholder = "Type here, then choose an action";
        view.fieldSecret = fieldMode_ == "password" || fieldMode_ == "devcode";
        view.actions = {
            {Action("info:field-email", "Email"), Action("info:field-password", "Password"), Action("info:field-name", "Display name")},
            {Action("info:account-signin", "Sign in", true, accountBusy_), Action("info:account-register", "Create account", false, accountBusy_)},
            {Action("info:field-devcode", "Developer code"), Action("info:account-dev", "Switch to developer account", false, accountBusy_)}
        };
    } else {
        if (!account_.usable) view.lede += "\nAccess: " + account_.reason;
        view.actions = {{Action("info:account-signout", "Sign out", false, accountBusy_), Action("open:plans", "Access & pricing")}};
        if (account_.reason == "terms_required") view.actions.push_back({Action("open:legal", "Read terms"), Action("info:account-terms", "Accept current terms", true, accountBusy_)});
        if (account_.reason == "email_unverified") {
            view.field = true; view.fieldLabel = "Email verification code"; view.fieldPlaceholder = "Code from your email";
            view.actions.push_back({Action("info:account-verify", "Verify email", true, accountBusy_), Action("info:account-send", "Send a new code", false, accountBusy_ || !account_.canSendEmail)});
        }
        if (account_.usable) view.actions.push_back({Action("open:realdebrid", "Media account"), Action("open:profiles", "Profiles")});
        if (account_.developer) view.actions.push_back({Action("open:developer", "Developer tools")});
    }
    return view;
}

void App::AccountAction(const std::string& verb) {
    if (verb == "refresh") { RefreshAccount(); ShowInfoPage(); return; }
    if (accountBusy_) return;
    const auto email = fieldValues_["account.email"];
    const auto password = fieldValues_["account.password"];
    const auto name = fieldValues_["account.name"];
    const auto code = fieldValues_["account." + fieldMode_];
    fieldValues_.erase("account.password"); fieldValues_.erase("account.devcode");
    if (auto* screen = TypingPage()) screen->ClearField();
    accountBusy_ = true;
    ShowInfoPage();
    background_->Run([this, verb, email, password, name, code] {
        coreapi::AccountState next;
        std::string message;
        try {
            EnsureCore(*core_);
            if (verb == "signin") next = core_->SignIn(email, password);
            else if (verb == "dev") next = core_->SignInDev(code);
            else {
                if (verb == "register") { core_->Register(email, password, name); message = "Account created. Sign in to continue."; }
                else if (verb == "signout") core_->SignOut();
                else if (verb == "terms") core_->Call("/api/account/terms", "POST", nlohmann::json::object());
                else if (verb == "send") { core_->Call("/api/account/email/send", "POST", nlohmann::json::object()); message = "A new code has been sent."; }
                else if (verb == "verify") core_->Call("/api/account/email/verify", "POST", {{"code", code}});
                next = core_->Status();
            }
        } catch (const std::exception& e) {
            message = e.what();
            try { next = core_->Status(); } catch (...) {}
        }
        background_->PostToUi([this, next, message] { FinishAccount(next, message); });
    });
}

std::optional<admin::MailSettings> App::CoreMail() const {
    return coreapi::ParseMailStatus(core_->Call("/api/admin/mail"));
}

realdebrid::Status App::CoreRealDebrid() const {
    realdebrid::Status status;
    try {
        const auto body = core_->Call("/api/rd/status");
        status.configured = body.value("configured", false);
        if (body.contains("username") && body["username"].is_string()) status.username = body["username"].get<std::string>();
        status.premium = body.value("premium", false);
        if (body.contains("error") && body["error"].is_string()) status.error = body["error"].get<std::string>();
    } catch (...) { status.error = "needs-auth"; }
    return status;
}

playback::Resolution App::CorePlayback(const std::string& id, const std::string& title, int maxHeight) const {
    playback::Resolution result;
    try {
        if (!core_->Status().usable) throw std::runtime_error("Sign in with an active account.");
        const auto plan = core_->Call("/api/plan");
        const int cap = plan.value("maxHeight", 1080);
        const auto body = maxHeight > 0
            ? core_->Call("/api/downloads/resolve", "POST", {{"id", id}, {"preferences", {{"language", "original"}, {"maxHeight", std::min(cap, maxHeight)}}}})
            : core_->Call("/api/playback", "POST", {{"id", id}, {"title", title}, {"native", true}});
        result.url = body.value("url", std::string());
        result.title = body.value("filename", title);
        if (result.url.empty()) result.reason = "unsupported";
        else {
            for (int height : {480, 720, 1080, 2160}) {
                if (height > cap) continue;
                playback::StreamChoice choice;
                choice.height = height; choice.label = "Up to " + std::to_string(height) + "p";
                choice.detail = "Find a matching source";
                if (maxHeight == height || (maxHeight == 0 && height <= cap)) result.chosen = result.choices.size();
                result.choices.push_back(std::move(choice));
            }
        }
    } catch (const coreapi::RequestError& e) { result.reason = e.reason.empty() ? "unsupported" : e.reason; }
    catch (...) { result.reason = "unsupported"; }
    return result;
}
}  // namespace tvm::platform
