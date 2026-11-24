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
    const bool changed = account_.email != state.email || account_.developer != state.developer ||
                         account_.usable != state.usable || account_.liveTv != state.liveTv ||
                         account_.tier != state.tier || account_.rdKey != state.rdKey;
    const bool first = !accountSettled_;
    account_ = state;
    accountBusy_ = false;
    accountSettled_ = true;
    intro_->SetPending(!catalogSettled_);
    accountCheckedMs_ = NowMs();
    accountMessage_ = message;
    if (changed) {
        StopPlayback();
        for (auto& job : downloads_) { job.cancel->store(true); if (job.state == "queued") job.state = "cancelled"; }
        shell_->PopToRoot(NowMs());
        streamStatusLoaded_ = false;
        realDebridOpened_ = false;
        rdStatus_ = {};
        rdStatusLoaded_ = false;
        rdStatusChecking_ = false;
        rdOnboardingDismissed_ = false;
        rdOnboardingPrompted_ = false;
        titles_.clear();
        fieldValues_.clear();
    }
    // Home is rebuilt only when the answer changed what it shows. The periodic check (every 30 s) used to rebuild it
    // every time, which put every rail back to its start and glided the page to the focused card.
    if (first || changed) RebuildHome();
    if (pageName_ == "account") ShowInfoPage();
    UpdateSettingsDiagnostics();
    // "Who's watching?" when TVM opens, once the account can use TVM Stream, unless Settings turned it off. It sits
    // under the launch reveal, which fades into it.
    if (!launchChooserDone_ && account_.usable) {
        launchChooserDone_ = true;
        if (store_->ChooseProfileOnLaunch() && shell_->ActiveScreenName() == "home") OpenChooser();
    }
    if (account_.usable && !rdStatusLoaded_ && !rdStatusChecking_) {
        RefreshRdStatus();
    } else {
        MaybePromptRealDebrid();
    }
    dirty_ = true;
}

ui::InfoView App::AccountView() const {
    const auto fieldVal = [this](const char* key) -> std::string {
        const auto found = fieldValues_.find(std::string("account.") + key);
        return found == fieldValues_.end() ? std::string() : found->second;
    };
    ui::InfoView view;
    view.centeredCard = true;
    view.backdropUrl = "asset:lighthouse.jpg";
    if (!account_.signedIn) {
        const std::string mode = accountAuthMode_.empty() ? "signin" : accountAuthMode_;
        const std::string activeField = fieldMode_.empty() ? (mode == "dev" ? "devcode" : "email") : fieldMode_;
        view.kicker = "TVM";
        view.filters.push_back({
            Action("info:account-mode-signin", "Sign In", mode == "signin", accountBusy_),
            Action("info:account-mode-register", "Create Account", mode == "register", accountBusy_),
            Action("info:account-mode-dev", "Developer Access", mode == "dev", accountBusy_),
        });
        view.message = accountBusy_ ? "Contacting TVM Core\xE2\x80\xA6" : accountMessage_;
        view.messageBad = !accountBusy_ && !accountMessage_.empty();
        view.field = true;
        if (mode == "register") {
            view.heading = "Create your account";
            view.lede = "Set up your TVM account to sync your library, profiles, and progress across devices.";
            view.filters.push_back({
                Action("info:field-name", "Display name", activeField == "name"),
                Action("info:field-email", "Email", activeField == "email"),
                Action("info:field-password", "Password", activeField == "password"),
            });
            view.fieldSummaries = {
                {"Display name", fieldVal("name"), false, activeField == "name"},
                {"Email", fieldVal("email"), false, activeField == "email"},
                {"Password", fieldVal("password"), true, activeField == "password"},
            };
            view.fieldLabel = activeField == "name" ? "Display name" : activeField == "password" ? "Password" : "Email";
            view.fieldPlaceholder = activeField == "name"       ? "Your name"
                                    : activeField == "password" ? "Create a password"
                                                                : "you@example.com";
            view.fieldSecret = activeField == "password";
            view.actions = {{Action("info:account-register", "Create Account", true, accountBusy_)}};
        } else if (mode == "dev") {
            view.heading = "Developer access";
            view.lede = "Enter your developer code to access diagnostics, mail settings, and account tools.";
            view.filters.push_back({Action("info:field-devcode", "Developer code", true)});
            view.fieldLabel = "Developer code";
            view.fieldPlaceholder = "Enter developer code";
            view.fieldSecret = true;
            view.actions = {{Action("info:account-dev", "Sign in as Developer", true, accountBusy_)}};
        } else {
            view.heading = "Sign in to TVM";
            view.lede = "Welcome back. Enter your email and password to pick up where you left off.";
            view.filters.push_back({
                Action("info:field-email", "Email", activeField == "email"),
                Action("info:field-password", "Password", activeField == "password"),
            });
            view.fieldSummaries = {
                {"Email", fieldVal("email"), false, activeField == "email"},
                {"Password", fieldVal("password"), true, activeField == "password"},
            };
            view.fieldLabel = activeField == "password" ? "Password" : "Email";
            view.fieldPlaceholder = activeField == "password" ? "Enter your password" : "you@example.com";
            view.fieldSecret = activeField == "password";
            view.actions = {{Action("info:account-signin", "Sign In", true, accountBusy_),
                             Action("info:account-refresh", "Refresh", false, accountBusy_)}};
        }
        view.topActions = {Action("open:legal", "Privacy & terms"), Action("back", "Back")};
        return view;
    }

    view.kicker = "Your TVM account";
    view.heading = account_.name.empty() ? account_.email : account_.name;
    view.lede = account_.email + (account_.tier.empty() ? "" : "  \xC2\xB7  " + account_.tier);
    view.message = accountBusy_ ? "Contacting TVM Core\xE2\x80\xA6" : accountMessage_;
    view.messageBad = !accountBusy_ && !accountMessage_.empty();
    const std::string rdLabel = account_.rdKey
                                    ? "Assigned to account"
                                    : (rdStatus_.configured ? "Connected on this device" : "Not connected");
    view.blocks = {
        {ui::InfoBlock::Kind::Row, "Status", account_.usable ? "Active" : account_.reason, account_.usable, !account_.usable},
        {ui::InfoBlock::Kind::Row, "Real-Debrid", rdLabel, account_.rdKey || rdStatus_.configured, false},
    };
    view.actions = {{Action("info:account-signout", "Sign out", false, accountBusy_), Action("open:plans", "Access & pricing")}};
    if (account_.reason == "terms_required") {
        view.actions.push_back({Action("open:legal", "Read terms"), Action("info:account-terms", "Accept current terms", true, accountBusy_)});
    }
    if (account_.reason == "email_unverified") {
        view.field = true;
        view.fieldLabel = "Email verification code";
        view.fieldPlaceholder = "Code from your email";
        view.actions.push_back({Action("info:account-verify", "Verify email", true, accountBusy_),
                                Action("info:account-send", "Send a new code", false, accountBusy_ || !account_.canSendEmail)});
    }
    if (account_.usable) view.actions.push_back({Action("open:realdebrid", "Media account"), Action("open:profiles", "Profiles")});
    if (account_.developer) view.actions.push_back({Action("open:developer", "Developer tools")});
    view.topActions = {Action("info:account-refresh", "Refresh", false, accountBusy_),
                       Action("open:legal", "Privacy & terms"), Action("back", "Back")};
    return view;
}

void App::AccountAction(const std::string& verb) {
    if (verb == "refresh") { RefreshAccount(); ShowInfoPage(); return; }
    if (verb == "mode-signin" || verb == "mode-register" || verb == "mode-dev") {
        accountAuthMode_ = verb.substr(5);
        if (accountAuthMode_ == "dev") {
            fieldMode_ = "devcode";
        } else if (accountAuthMode_ == "register") {
            if (fieldMode_ != "email" && fieldMode_ != "password") fieldMode_ = "name";
        } else {
            if (fieldMode_ != "password") fieldMode_ = "email";
        }
        ShowInfoPage();
        if (auto* screen = TypingPage()) screen->SetFieldText(fieldValues_["account." + fieldMode_]);
        return;
    }
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

coreapi::RealDebridStatus App::CoreRealDebrid() const {
    try {
        return coreapi::ParseRealDebridStatus(core_->Call("/api/rd/status"));
    } catch (...) {
        coreapi::RealDebridStatus status;
        status.error = "needs-auth";
        return status;
    }
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
        // The core sends a clean "title" beside the raw, URL-encoded "filename"; a file name is only a last resort,
        // made readable first.
        const std::string clean = util::Trim(body.value("title", std::string()));
        result.title = !clean.empty() ? clean
                                      : playback::TitleFromFilename(body.value("filename", std::string()), title);
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
