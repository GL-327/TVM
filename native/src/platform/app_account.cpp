#include "platform/app.h"
#include <algorithm>
#include "platform/core_host.h"

namespace tvm::platform {
namespace {
std::string Param(const ui::Command& command, const char* key) {
    const auto it = command.params.find(key);
    return it == command.params.end() ? std::string() : it->second;
}

std::string InferAccountErrorField(const std::string& reason, const std::string& message) {
    const std::string friendly = coreapi::FriendlyAccountError(message);
    if (reason == "invalid_credentials" || reason == "password_too_short" || reason == "password_too_long" ||
        reason == "password_too_common" || friendly.find("password") != std::string::npos ||
        friendly.find("10 characters") != std::string::npos) {
        return "password";
    }
    if (reason == "email_taken" || reason == "invalid_email" || friendly.find("email") != std::string::npos) {
        return "email";
    }
    return {};
}
}  // namespace

ui::AccountScreen* App::ActiveAccountScreen() {
    return dynamic_cast<ui::AccountScreen*>(&shell_->ActiveScreen());
}

void App::SyncAccountScreen() {
    if (auto* screen = dynamic_cast<ui::AccountScreen*>(shell_->ScreenNamed("account"))) {
        ui::AccountView view;
        view.account = account_;
        view.realDebrid = rdStatus_;
        view.terms = termsDoc_;
        view.busy = accountBusy_;
        if (accountMessageError_) {
            view.error = accountMessage_;
            view.errorField = accountErrorField_;
        } else {
            view.statusNote = accountMessage_;
        }
        view.openPrivacy = screen->privacyOpen();
        screen->SetView(std::move(view));
        dirty_ = true;
    }
}

void App::SyncPlansScreen() {
    if (auto* screen = dynamic_cast<ui::PlansScreen*>(shell_->ScreenNamed("plans"))) {
        plansView_.account = account_;
        if (!screen->view().cadence.empty()) plansView_.cadence = screen->view().cadence;
        plansView_.compareOpen = screen->view().compareOpen;
        screen->SetView(plansView_);
        dirty_ = true;
    }
}

void App::RefreshTerms() {
    if (termsBusy_) return;
    termsBusy_ = true;
    background_->Run([this] {
        coreapi::TermsDocument doc = coreapi::DefaultTermsDocument();
        bool loaded = false;
        try {
            EnsureCore(*core_);
            doc = core_->Terms();
            loaded = true;
        } catch (...) {}
        background_->PostToUi([this, doc, loaded] {
            termsBusy_ = false;
            if (loaded) {
                termsDoc_ = doc;
                termsLoaded_ = true;
                SyncAccountScreen();
            }
        });
    });
}

void App::RefreshTiers() {
    if (tiersBusy_) return;
    tiersBusy_ = true;
    background_->Run([this] {
        coreapi::TiersDocument doc = coreapi::DefaultTiersDocument();
        bool loaded = false;
        try {
            EnsureCore(*core_);
            doc = core_->Tiers();
            loaded = true;
        } catch (...) {}
        background_->PostToUi([this, doc, loaded] {
            tiersBusy_ = false;
            if (loaded) {
                plansView_.tiers = doc;
                tiersLoaded_ = true;
                SyncPlansScreen();
            }
        });
    });
}

void App::RefreshAccount() {
    if (accountBusy_) return;
    accountBusy_ = true;
    background_->Run([this] {
        coreapi::AccountState next;
        std::string error;
        try { EnsureCore(*core_); next = core_->Status(); }
        catch (const std::exception& e) { error = e.what(); }
        background_->PostToUi([this, next, error] { FinishAccount(next, error, !error.empty()); });
    });
}

void App::FinishAccount(const coreapi::AccountState& state, const std::string& message,
                        bool isError, std::string errorField) {
    const bool wasUsable = account_.usable;
    const bool changed = account_.email != state.email || account_.developer != state.developer ||
                         account_.usable != state.usable || account_.liveTv != state.liveTv ||
                         account_.tier != state.tier || account_.rdKey != state.rdKey ||
                         account_.signedIn != state.signedIn || account_.reason != state.reason;
    const bool first = !accountSettled_;
    const bool onAccount = shell_->ActiveScreenName() == "account";
    account_ = state;
    accountBusy_ = false;
    accountSettled_ = true;
    intro_->SetPending(!catalogSettled_);
    accountCheckedMs_ = NowMs();
    accountMessageError_ = isError && !message.empty();
    accountMessage_ = message.empty() ? std::string() : (isError ? coreapi::FriendlyAccountError(message) : message);
    accountErrorField_ = accountMessageError_ ? std::move(errorField) : std::string();

    if (changed) {
        ++extrasEpoch_; upcomingRail_ = {}; extrasHomeBusy_ = false; extrasHomeCheckedMs_ = -600000;
        extrasStats_ = nlohmann::json::object(); extrasPrefs_ = {};
        StopPlayback();
        for (auto& job : downloads_) { job.cancel->store(true); if (job.state == "queued") job.state = "cancelled"; }
        if (!onAccount || (!wasUsable && state.usable)) {
            shell_->PopToRoot(NowMs());
        }
        streamStatusLoaded_ = false;
        realDebridOpened_ = false;
        rdStatus_ = {};
        rdStatusLoaded_ = false;
        rdStatusChecking_ = false;
        rdOnboardingDismissed_ = false;
        rdOnboardingPrompted_ = false;
        titles_.clear(); titlesInFlight_.clear(); shownTitle_.reset();
        fieldValues_.clear();
        plansView_.choiceNote.clear();
        plansView_.choiceError.clear();
    }
    if (first || changed) RebuildHome();
    SyncAccountScreen();
    SyncPlansScreen();
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

void App::HandleAccountCommand(const ui::Command& command) {
    if (accountBusy_) return;
    const std::string& action = command.name;
    if (action == "account-check-again") {
        accountBusy_ = true;
        accountMessage_.clear();
        accountMessageError_ = false;
        accountErrorField_.clear();
        SyncAccountScreen();
        background_->Run([this] {
            coreapi::AccountState next = account_;
            std::string message;
            bool isError = false;
            try {
                EnsureCore(*core_);
                next = core_->Status();
                if (!next.usable && next.reason == "awaiting_activation") {
                    message = "Still waiting for approval.";
                }
            } catch (const std::exception& e) {
                message = e.what();
                isError = true;
            }
            background_->PostToUi([this, next, message, isError] { FinishAccount(next, message, isError); });
        });
        return;
    }

    const std::string email = Param(command, "email");
    const std::string password = Param(command, "password");
    const std::string name = Param(command, "name");
    const std::string code = Param(command, "code");

    accountBusy_ = true;
    accountMessage_.clear();
    accountMessageError_ = false;
    accountErrorField_.clear();
    SyncAccountScreen();

    background_->Run([this, action, email, password, name, code] {
        coreapi::AccountState next = account_;
        std::string message;
        std::string errorField;
        bool isError = false;
        try {
            EnsureCore(*core_);
            if (action == "account-signin") {
                next = core_->SignIn(email, password);
            } else if (action == "account-register") {
                core_->Register(email, password, name);
                next = core_->SignIn(email, password);
            } else if (action == "account-signout") {
                core_->SignOut();
                next = core_->Status();
            } else if (action == "account-accept-terms") {
                next = core_->AcceptTerms();
            } else if (action == "account-send-code") {
                core_->SendVerificationEmail();
                next = core_->Status();
                message = "A new code has been sent.";
            } else if (action == "account-verify-email") {
                next = core_->VerifyEmailCode(code);
            }
        } catch (const coreapi::RequestError& e) {
            isError = true;
            message = e.what();
            errorField = InferAccountErrorField(e.reason, e.what());
            try { next = core_->Status(); } catch (...) {}
        } catch (const std::exception& e) {
            isError = true;
            message = e.what();
            errorField = InferAccountErrorField("", e.what());
            try { next = core_->Status(); } catch (...) {}
        }
        background_->PostToUi([this, next, message, isError, errorField] {
            FinishAccount(next, message, isError, errorField);
        });
    });
}

void App::ChoosePlan(const ui::Command& command) {
    if (plansView_.busy) return;
    const std::string tier = Param(command, "tier");
    const std::string cadence = Param(command, "cadence") == "year" ? "year" : "month";
    plansView_.busy = true;
    plansView_.cadence = cadence;
    plansView_.choiceNote.clear();
    plansView_.choiceError.clear();
    SyncPlansScreen();

    background_->Run([this, tier, cadence] {
        std::string note;
        std::string error;
        try {
            EnsureCore(*core_);
            note = core_->RecordPlanChoice(tier, cadence);
        } catch (const std::exception& e) {
            error = coreapi::FriendlyAccountError(e.what());
        }
        background_->PostToUi([this, note, error] {
            plansView_.busy = false;
            plansView_.choiceNote = note;
            plansView_.choiceError = error;
            SyncPlansScreen();
        });
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
        result.bestHeight = cap;
        const auto body = core_->Call("/api/playback", "POST", {{"id", id}, {"title", title}, {"native", true},
            {"screenHeight", maxHeight > 0 ? maxHeight : 1080}, {"maxHeight", std::min(cap, maxHeight > 0 ? maxHeight : 1080)}});
        result.url = body.value("url", std::string());
        if (body.contains("subtitles") && body["subtitles"].is_array()) result.subtitles = body["subtitles"];
        if (body.contains("segments") && body["segments"].is_object()) result.segments = body["segments"];
        // The core sends a clean "title" beside the raw, URL-encoded "filename"; a file name is only a last resort,
        // made readable first.
        const std::string clean = util::Trim(body.value("title", std::string()));
        result.title = !clean.empty() ? clean
                                      : playback::TitleFromFilename(body.value("filename", std::string()), title);
        if (result.url.empty()) result.reason = "unsupported";
        else {
            for (int height : {480, 720, 1080, 1440, 2160}) {
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
