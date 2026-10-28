// The info pages and the service hubs. Each page's copy is taken from its screen in apps/ui/src/screens so
// the wording matches the web app; where this build cannot do what the web page does, the page says so.

#include "platform/app.h"

#include <shlobj.h>
#include <shobjidl.h>
#include <shellapi.h>
#include <netlistmgr.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <fstream>
#include <mutex>
#include <string_view>

#include "catalog/artwork.h"
#include "catalog/progress.h"
#include "catalog/watchlist.h"
#include "core/config.h"
#include "core/profiles.h"
#include "core/util.h"

namespace tvm::platform {

namespace {

ui::InfoAction Button(std::string key, std::string label, bool primary = false, bool disabled = false) {
    ui::InfoAction action;
    action.key = std::move(key);
    action.label = std::move(label);
    action.primary = primary;
    action.disabled = disabled;
    return action;
}

ui::InfoBlock Block(ui::InfoBlock::Kind kind, std::string text, std::string value = "", bool good = false, bool bad = false) {
    ui::InfoBlock block;
    block.kind = kind;
    block.text = std::move(text);
    block.value = std::move(value);
    block.good = good;
    block.bad = bad;
    return block;
}

ui::InfoBlock Heading(std::string text) { return Block(ui::InfoBlock::Kind::Heading, std::move(text)); }
ui::InfoBlock Paragraph(std::string text) { return Block(ui::InfoBlock::Kind::Paragraph, std::move(text)); }
ui::InfoBlock Note(std::string text) { return Block(ui::InfoBlock::Kind::Note, std::move(text)); }
ui::InfoBlock Row(std::string label, std::string value, bool good = false, bool bad = false) {
    return Block(ui::InfoBlock::Kind::Row, std::move(label), std::move(value), good, bad);
}
ui::InfoBlock Bullet(std::string text, std::string value, bool good = false, bool bad = false) {
    return Block(ui::InfoBlock::Kind::Bullet, std::move(text), std::move(value), good, bad);
}

std::string Param(const std::map<std::string, std::string>& params, const char* key) {
    const auto found = params.find(key);
    return found == params.end() ? std::string() : found->second;
}

// formatBillingMoney: pounds, always with pence.
std::string Money(int pence) {
    char text[32];
    std::snprintf(text, sizeof(text), "\xC2\xA3%d.%02d", pence / 100, pence % 100);
    return text;
}

std::string Size(unsigned long long bytes) {
    char text[32];
    if (bytes >= (1ULL << 30)) std::snprintf(text, sizeof(text), "%.1f GB", static_cast<double>(bytes) / (1ULL << 30));
    else std::snprintf(text, sizeof(text), "%.1f MB", static_cast<double>(bytes) / (1ULL << 20));
    return text;
}

std::string TwoDigits(int value) {
    char text[8];
    std::snprintf(text, sizeof(text), "%02d", value);
    return text;
}

// shortDate: the day an ISO time falls on, or a dash.
std::string ShortDate(const std::string& iso) { return iso.size() >= 10 ? iso.substr(0, 10) : "\xE2\x80\x94"; }

std::filesystem::path KnownFolder(const KNOWNFOLDERID& id) {
    PWSTR path = nullptr;
    std::filesystem::path out;
    if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &path))) out = path;
    CoTaskMemFree(path);
    return out;
}

// A file name Windows accepts: no reserved characters, and not too long.
std::wstring SafeName(const std::string& title) {
    std::wstring name = util::ToWide(title);
    for (wchar_t& c : name) {
        if (c < 0x20 || std::wstring_view(L"<>:\"/\\|?*").find(c) != std::wstring_view::npos) c = L' ';
    }
    while (!name.empty() && (name.back() == L' ' || name.back() == L'.')) name.pop_back();
    if (name.size() > 150) name.resize(150);
    return name.empty() ? L"TVM download" : name;
}

// The file's own extension from its address or name, when it is a video one.
std::wstring VideoExtension(const std::string& url, const std::string& name) {
    for (const std::string& source : {name, url.substr(0, url.find('?'))}) {
        const std::size_t dot = source.rfind('.');
        if (dot == std::string::npos) continue;
        std::string ext = source.substr(dot + 1);
        for (char& c : ext) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        for (const char* known : {"mkv", "mp4", "m4v", "avi", "webm", "ts", "mov"}) {
            if (ext == known) return L"." + util::ToWide(ext);
        }
    }
    return L".mkv";
}

struct Language {
    const char* id;
    const char* label;
};

// The audio languages Downloads offers. The resolver reads each stream's language marks (playback::LanguageFit).
const std::vector<Language>& Languages() {
    static const std::vector<Language> languages = {
        {"en", "English"}, {"original", "Original / any language"}, {"ja", "Japanese"}, {"fr", "French"}, {"de", "German"},
        {"es", "Spanish"}, {"it", "Italian"}, {"pt", "Portuguese"}, {"ko", "Korean"}, {"hi", "Hindi"},
    };
    return languages;
}

const Language& LanguageOf(const std::string& id) {
    for (const Language& language : Languages()) {
        if (language.id == id) return language;
    }
    return Languages().front();
}

std::string QualityLabel(int height) { return height == 2160 ? "4K \xC2\xB7 2160p" : std::to_string(height) + "p"; }

// Whether the internet is reachable, as the operating system judges it.
bool Online() {
    INetworkListManager* manager = nullptr;
    if (FAILED(CoCreateInstance(__uuidof(NetworkListManager), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&manager)))) return true;
    NLM_CONNECTIVITY connectivity = NLM_CONNECTIVITY_DISCONNECTED;
    const bool asked = SUCCEEDED(manager->GetConnectivity(&connectivity));
    manager->Release();
    return !asked || (connectivity & (NLM_CONNECTIVITY_IPV4_INTERNET | NLM_CONNECTIVITY_IPV6_INTERNET)) != 0;
}

std::string Pixels(long width, long height) { return std::to_string(width) + " \xC3\x97 " + std::to_string(height); }

// A hub's chrome: back out, search, the other apps, and the TVM mark, which goes Home.
std::vector<ui::TopButton> HubChrome() {
    const auto act = [](const std::string& name) {
        ui::Command command;
        command.name = name;
        command.action = true;
        return command;
    };
    ui::Command search;
    search.name = "search";
    search.modal = true;
    ui::Command apps;
    apps.name = "apps";
    return {ui::TopButton{"Back", act("back")}, ui::TopButton{"Search", search}, ui::TopButton{"Apps", apps},
            ui::TopButton{"TVM", act("stream-home"), false, true}};
}

constexpr char kLaunchesFile[] = "launches";
constexpr long long kCrashWindowSeconds = 60;

long long NowSeconds() {
    return std::chrono::duration_cast<std::chrono::seconds>(std::chrono::system_clock::now().time_since_epoch()).count();
}

}  // namespace

// ------------------------------------------------------------------ the page on top

void App::OpenInfoPage(const nav::ViewEntry& entry) {
    pageName_ = entry.name;
    pageParams_ = entry.params;
    pageMessage_.clear();
    pageMessageBad_ = false;
    pageBusy_ = false;
    pageConfirm_ = false;
    fieldMode_.clear();
    // A page's typed text starts empty each visit, so a secret never outlives its page.
    std::erase_if(fieldValues_, [&](const auto& pair) { return pair.first.rfind(pageName_ + ".", 0) == 0; });

    if (pageName_ == "downloads") {
        // Downloads over the player is for what is playing.
        if (Param(pageParams_, "id").empty() && playerOpen_ && !playerLive_) pageParams_["id"] = playerId_;
        downloadEpisodes_.clear();
        // An episode opens on that episode; a series from its details page opens on the whole series, as the web does.
        const std::optional<playback::PlayId> play = playback::ParsePlayId(Param(pageParams_, "id"));
        if (play && (play->season || Param(pageParams_, "series") == "1")) {
            downloadScope_ = play->season ? "episode" : "series";
            downloadSeason_ = play->season.value_or(0);
            downloadEpisode_ = play->season ? Param(pageParams_, "id") : "";
            LoadDownloadEpisodes(play->imdb);
        }
        LoadDownloadPrefs();
    }
    if (pageName_ == "changelog" && updatesView_.changes.empty() && !updatesView_.busy) {
        updatesView_.version = config::kCoreVersion;
        CheckForUpdates();
    }
    if (pageName_ == "accounts") {
        fieldMode_ = "search";
        accountOpen_.clear();
        LoadAccounts();
    }
    if (pageName_ == "mail-settings") {
        fieldMode_ = "host";
        mailSaved_.reset();
        try {
            mailSaved_ = admin::ReadMail(dataDir_);
        } catch (const std::exception&) {
            pageMessage_ = "Email settings could not be read on this device.";
        }
        mailDraft_ = mailSaved_.value_or(admin::MailSettings{});
        fieldValues_["mail-settings.host"] = mailDraft_.host;
        fieldValues_["mail-settings.port"] = std::to_string(mailDraft_.port);
        fieldValues_["mail-settings.username"] = mailDraft_.username;
        fieldValues_["mail-settings.from"] = mailDraft_.from;
    }
    if (pageName_ == "developer" || pageName_ == "setup") fieldMode_ = "code";
    // The check opens the channels Live TV lists, so they are read when Live TV has not read them yet.
    if (pageName_ == "live-check" && !liveLoaded_) RefreshLiveTv();
    ShowInfoPage();
    if (ui::InfoScreen* screen = TypingPage()) screen->SetFieldText(fieldValues_[pageName_ + "." + fieldMode_]);
}

ui::InfoScreen* App::TypingPage() {
    auto* screen = dynamic_cast<ui::InfoScreen*>(&shell_->ActiveScreen());
    return screen != nullptr && screen->HasField() ? screen : nullptr;
}

void App::ShowInfoPage() {
    auto* screen = dynamic_cast<ui::InfoScreen*>(shell_->ScreenNamed(pageName_));
    if (screen == nullptr) return;
    ui::InfoView view;
    if (pageName_ == "legal") view = LegalView();
    else if (pageName_ == "donate") view = DonateView();
    else if (pageName_ == "downloads") view = DownloadsView();
    else if (pageName_ == "changelog") view = ChangelogView();
    else if (pageName_ == "diagnostics") view = DiagnosticsView();
    else if (pageName_ == "system-info") view = SystemInfoView();
    else if (pageName_ == "setup") view = SetupView();
    else if (pageName_ == "recovery") view = RecoveryView();
    else if (pageName_ == "live-check") view = LiveCheckView();
    else if (pageName_ == "mail-settings") view = MailView();
    else if (pageName_ == "accounts") view = AccountsView();
    else if (pageName_ == "developer") view = DeveloperView();
    else if (pageName_ == "apps") view = AppsView();
    else if (pageName_ == "confirm") view = ConfirmView();
    screen->SetView(std::move(view));
    dirty_ = true;
}

void App::ApplyInfoAction(const ui::Command& command) {
    const std::string verb = command.name.substr(5);
    // Every press carries the field's text, so a page with several fields keeps what was typed in each.
    if (const auto field = command.params.find("field"); field != command.params.end() && !fieldMode_.empty()) {
        fieldValues_[pageName_ + "." + fieldMode_] = field->second;
    }
    const auto value = [&](const std::string& name) { return fieldValues_[pageName_ + "." + name]; };
    const auto say = [&](std::string message, bool bad = false) {
        pageMessage_ = std::move(message);
        pageMessageBad_ = bad;
    };

    if (verb.rfind("field-", 0) == 0) {
        // Moves the field to another of the page's inputs, with that input's text.
        fieldMode_ = verb.substr(6);
        ShowInfoPage();
        if (ui::InfoScreen* screen = TypingPage()) screen->SetFieldText(value(fieldMode_));
        return;
    }

    // ---- Legal
    if (verb == "legal-export") {
        ExportPersonalData();
    } else if (verb == "legal-erase") {
        if (pageConfirm_) {
            EraseLocalData();
            return;
        }
        pageConfirm_ = true;
    } else if (verb == "legal-keep" || verb == "recovery-keep") {
        pageConfirm_ = false;
    }
    // ---- Donate
    else if (verb.rfind("donate-", 0) == 0) {
        try {
            donateAmount_ = std::stoi(verb.substr(7));
        } catch (const std::exception&) {
        }
    }
    // ---- Downloads
    else if (verb.rfind("dl-scope-", 0) == 0) {
        downloadScope_ = verb.substr(9);
    } else if (verb == "dl-season") {
        std::vector<int> seasons;
        for (const catalog::MediaItem& item : downloadEpisodes_) {
            if (item.season && std::find(seasons.begin(), seasons.end(), *item.season) == seasons.end()) seasons.push_back(*item.season);
        }
        std::sort(seasons.begin(), seasons.end());
        if (!seasons.empty()) {
            const auto at = std::find(seasons.begin(), seasons.end(), downloadSeason_);
            downloadSeason_ = at == seasons.end() || at + 1 == seasons.end() ? seasons.front() : *(at + 1);
            const auto first = std::find_if(downloadEpisodes_.begin(), downloadEpisodes_.end(),
                                            [&](const catalog::MediaItem& item) { return item.season == downloadSeason_; });
            if (first != downloadEpisodes_.end()) downloadEpisode_ = first->id;
        }
    } else if (verb == "dl-episode") {
        std::vector<std::string> ids;
        for (const catalog::MediaItem& item : downloadEpisodes_) {
            if (item.season == downloadSeason_) ids.push_back(item.id);
        }
        if (!ids.empty()) {
            const auto at = std::find(ids.begin(), ids.end(), downloadEpisode_);
            downloadEpisode_ = at == ids.end() || at + 1 == ids.end() ? ids.front() : *(at + 1);
        }
    } else if (verb == "dl-language") {
        const auto& all = Languages();
        const auto at = std::find_if(all.begin(), all.end(), [&](const Language& l) { return l.id == downloadLanguage_; });
        downloadLanguage_ = at == all.end() || at + 1 == all.end() ? all.front().id : (at + 1)->id;
        SaveDownloadPrefs();
    } else if (verb == "dl-quality") {
        static const std::vector<int> kHeights = {480, 720, 1080, 2160};
        const auto at = std::find(kHeights.begin(), kHeights.end(), downloadQuality_);
        downloadQuality_ = at == kHeights.end() || at + 1 == kHeights.end() ? kHeights.front() : *(at + 1);
        SaveDownloadPrefs();
    } else if (verb == "dl-folder") {
        ChooseDownloadFolder();
        SaveDownloadPrefs();
    } else if (verb == "dl-start") {
        QueueDownloads();
    } else if (verb.rfind("dl-cancel-", 0) == 0 || verb.rfind("dl-show-", 0) == 0) {
        const bool cancel = verb.rfind("dl-cancel-", 0) == 0;
        const int id = std::atoi(verb.substr(cancel ? 10 : 8).c_str());
        for (DownloadJob& job : downloads_) {
            if (job.id != id) continue;
            if (cancel) {
                job.cancel->store(true);
                if (job.state == "queued") job.state = "cancelled";
            } else if (!job.path.empty()) {
                const std::wstring args = L"/select,\"" + job.path.wstring() + L"\"";
                ShellExecuteW(window_, L"open", L"explorer.exe", args.c_str(), nullptr, SW_SHOWNORMAL);
            }
        }
    }
    // ---- Setup
    else if (verb == "setup-save") {
        const std::string token = util::Trim(value("code"));
        if (token.empty() || token.find_first_of("\r\n") != std::string::npos) {
            say("Paste a token, then press OK.");
        } else if (!pageBusy_) {
            pageBusy_ = true;
            pageMessage_.clear();
            background_->Run([this, token] {
                bool stored = true;
                try {
                    realDebrid_->SetToken(token);
                } catch (const std::exception&) {
                    stored = false;
                }
                const realdebrid::Status status = realDebrid_->GetStatus();
                background_->PostToUi([this, status, stored] {
                    pageBusy_ = false;
                    fieldValues_.erase("setup.code");
                    pageMessageBad_ = true;
                    if (!stored || !status.configured) {
                        pageMessage_ = "The token was not stored.";
                    } else if (status.error == "needs-auth") {
                        pageMessage_ = "Real-Debrid rejected that token.";
                    } else {
                        // Setup hands over to TVM Stream, as navigate.reset('library') does.
                        FinishRealDebrid(status, "Token saved on this machine.");
                        shell_->PopToRoot(NowMs());
                        RebuildStream();
                        return;
                    }
                    if (pageName_ == "setup") ShowInfoPage();
                });
            });
        }
    }
    // ---- Recovery
    else if (verb == "recovery-shutdown") {
        if (pageConfirm_) {
            PostMessageW(window_, WM_CLOSE, 0, 0);
            return;
        }
        pageConfirm_ = true;
    }
    // ---- Channel check
    else if (verb == "check-run") {
        RunLiveCheck();
    } else if (verb == "check-limit") {
        liveCheckLimit_ = liveCheckLimit_ == 10 ? 25 : liveCheckLimit_ == 25 ? 50 : 10;
    } else if (verb == "check-group") {
        std::vector<std::string> groups;
        for (const catalog::LiveChannel& channel : liveCatalog_.channels) {
            const std::string group = live::GroupOf(channel);
            if (std::find(groups.begin(), groups.end(), group) == groups.end()) groups.push_back(group);
        }
        liveCheckGroup_ = liveCheckGroup_ + 2 > static_cast<int>(groups.size()) ? -1 : liveCheckGroup_ + 1;
    }
    // ---- Email
    else if (verb.rfind("mail-preset-", 0) == 0) {
        const bool gmail = verb == "mail-preset-gmail";
        fieldValues_["mail-settings.host"] = gmail ? "smtp.gmail.com" : "smtp.mail.me.com";
        fieldValues_["mail-settings.port"] = gmail ? "465" : "587";
        mailDraft_.security = gmail ? "tls" : "starttls";
        if (fieldMode_ == "host" || fieldMode_ == "port") {
            if (ui::InfoScreen* screen = TypingPage()) screen->SetFieldText(value(fieldMode_));
        }
    } else if (verb.rfind("mail-security-", 0) == 0) {
        mailDraft_.security = verb.substr(14);
    } else if (verb == "mail-save") {
        try {
            admin::MailSettings settings;
            settings.host = util::Trim(value("host"));
            settings.port = std::atoi(value("port").c_str());
            settings.security = mailDraft_.security;
            settings.username = util::Trim(value("username"));
            settings.password = value("password");
            settings.from = util::Trim(value("from"));
            admin::SaveMail(dataDir_, settings);
            mailSaved_ = admin::ReadMail(dataDir_);
            fieldValues_.erase("mail-settings.password");
            if (fieldMode_ == "password") {
                if (ui::InfoScreen* screen = TypingPage()) screen->ClearField();
            }
            say("Saved. New accounts are emailed a code from now on.");
        } catch (const std::exception& error) {
            say(error.what(), true);
        }
    } else if (verb == "mail-remove") {
        admin::ClearMail(dataDir_);
        mailSaved_.reset();
        for (const char* key : {"host", "username", "password", "from"}) fieldValues_.erase(std::string("mail-settings.") + key);
        if (ui::InfoScreen* screen = TypingPage()) screen->ClearField();
        say("Removed. New accounts will not be asked for a code.");
    }
    // ---- Accounts
    else if (verb == "acct-refresh") {
        LoadAccounts();
    } else if (verb.rfind("acct-state-", 0) == 0) {
        accountsState_ = verb.substr(11);
        LoadAccounts();
    } else if (verb.rfind("acct-open-", 0) == 0) {
        accountOpen_ = verb.substr(10);
        pageConfirm_ = false;
        fieldMode_ = "note";
        const auto open = std::find_if(accounts_.begin(), accounts_.end(), [&](const admin::Account& a) { return a.id == accountOpen_; });
        fieldValues_["accounts.note"] = open == accounts_.end() ? "" : open->note;
        fieldValues_.erase("accounts.rd");
        ShowInfoPage();
        if (ui::InfoScreen* screen = TypingPage()) screen->SetFieldText(value("note"));
        return;
    } else if (verb == "acct-close") {
        accountOpen_.clear();
        pageConfirm_ = false;
        fieldMode_ = "search";
        ShowInfoPage();
        if (ui::InfoScreen* screen = TypingPage()) screen->SetFieldText(value("search"));
        return;
    } else if (verb.rfind("acct-", 0) == 0) {
        // The dev's changes to the open account, each written at once, as act() runs them.
        const std::string id = accountOpen_;
        const auto open = std::find_if(accounts_.begin(), accounts_.end(), [&](const admin::Account& a) { return a.id == id; });
        if (open == accounts_.end()) return;
        try {
            if (verb == "acct-grant-stream") admin::Activate(dataDir_, id, "stream");
            if (verb == "acct-grant-live") admin::Activate(dataDir_, id, "stream-live");
            if (verb == "acct-live") admin::SetLiveTv(dataDir_, id, open->tier != "stream-live");
            if (verb == "acct-verify") admin::SetEmailVerified(dataDir_, id, open->emailVerifiedAt.empty());
            if (verb == "acct-suspend") admin::SetSuspended(dataDir_, id, !open->suspended);
            if (verb == "acct-note") admin::SetNote(dataDir_, id, util::Trim(value("note")));
            if (verb == "acct-rd-save" || verb == "acct-rd-remove") {
                admin::SetRdToken(dataDir_, id, verb == "acct-rd-save" ? util::Trim(value("rd")) : "");
                fieldValues_.erase("accounts.rd");
                if (fieldMode_ == "rd") {
                    if (ui::InfoScreen* screen = TypingPage()) screen->ClearField();
                }
            }
            if (verb == "acct-erase") {
                if (!pageConfirm_) {
                    pageConfirm_ = true;
                    ShowInfoPage();
                    return;
                }
                admin::Erase(dataDir_, id);
                accountOpen_.clear();
                fieldMode_ = "search";
            }
            pageConfirm_ = false;
            pageMessage_.clear();
        } catch (const std::exception& error) {
            say(error.what(), true);
        }
        LoadAccounts();
        if (accountOpen_.empty()) {
            if (ui::InfoScreen* screen = TypingPage()) screen->SetFieldText(value("search"));
        }
    }
    // ---- Developer
    else if (verb == "dev-unlock") {
        const std::string code = value("code");
        if (!pageBusy_) {
            pageBusy_ = true;
            pageMessage_.clear();
            // The check is slow on purpose, so it runs on a worker. The code itself is never kept.
            background_->Run([this, code] {
                const bool unlocked = admin::UnlockDev(dataDir_, code);
                background_->PostToUi([this, unlocked] {
                    pageBusy_ = false;
                    fieldValues_.erase("developer.code");
                    if (ui::InfoScreen* screen = TypingPage()) screen->ClearField();
                    if (!unlocked) {
                        pageMessage_ = "That code is not valid.";
                        pageMessageBad_ = true;
                    }
                    if (pageName_ == "developer") ShowInfoPage();
                });
            });
        }
    } else if (verb == "dev-lock") {
        admin::LockDev(dataDir_);
        say("Dev mode is off on this machine.");
    }
    // ---- Confirm
    else if (verb == "confirm-yes") {
        const std::string action = Param(pageParams_, "action");
        shell_->Back(NowMs());
        if (action == "factory-reset") {
            EraseLocalData();
        } else if (action == "clear-cache") {
            std::error_code ignored;
            std::filesystem::remove(paths::CatalogCachePath(dataDir_), ignored);
            std::filesystem::remove_all(paths::ArtworkCacheDir(dataDir_), ignored);
        } else if (action == "shutdown") {
            PostMessageW(window_, WM_CLOSE, 0, 0);
        }
        return;
    }
    ShowInfoPage();
}

// ------------------------------------------------------------------ Legal

ui::InfoView App::LegalView() const {
    ui::InfoView view;
    view.kicker = "Privacy & terms";
    view.heading = "Your data. Your sources.";
    view.lede = "Notice version 15 September 2026";
    view.topActions = {Button("back", "Back"), Button("info:legal-export", "Export my data", false, pageBusy_),
                       Button("info:legal-erase", pageConfirm_ ? "Confirm \xE2\x80\x94 delete all TVM data" : "Delete local TVM data",
                              false, pageBusy_)};
    if (pageConfirm_) view.topActions.push_back(Button("info:legal-keep", "Keep my data"));
    if (pageConfirm_) {
        view.message = "This removes all TVM profiles, viewing history, lists, provider credentials, plans and receipts on this device, "
                       "and locks DEV mode. Other providers\xE2\x80\x99 accounts and browser sessions are separate. This cannot be undone.";
        view.messageBad = true;
    } else {
        view.message = pageMessage_;
        view.messageBad = pageMessageBad_;
    }
    view.blocks = {
        Heading("Terms of use"),
        Paragraph("TVM is a media interface for your own files and sources you are authorised to use. A TVM plan does not supply rights to "
                  "films, channels or third-party services. Do not use it to infringe copyright, share provider credentials contrary to their "
                  "terms, or bypass access restrictions. Availability and supported formats depend on your provider, connection and device. "
                  "Service names identify independent providers; they do not imply endorsement or partnership."),
        Paragraph("Nothing is sold inside the app. Access is arranged directly with the app owner, who switches an account on; the prices "
                  "shown are what access costs. Live TV is a separate product with 3-month, 1-year and lifetime terms, and lifetime access "
                  "lasts only while the Live TV service stays online. The donate button is a gift to the app owner: it buys nothing, "
                  "activates nothing and is not refundable, because nothing was sold. Where a card is used, the number is sent to Stripe and "
                  "is never stored by TVM. Nothing in these terms excludes statutory rights."),
        Heading("What is stored and why"),
        Paragraph("TVM stores profile names, watch progress, watchlists and preferences to provide personal playback and recommendations. "
                  "Receipts record plan choices, amounts charged, consent version and time. Provider credentials are stored to connect the "
                  "services you choose. Credentials, profiles, viewing history, playlists and billing records are encrypted on disk. On "
                  "Windows, the encryption key is protected by your Windows account. Running software under that account can still access data."),
        Paragraph("Data stays until you remove it or reset TVM; the billing history keeps the latest 100 events. Artwork and catalogue "
                  "caches can be cleared in Settings. Theme, motion and search history are local preferences; search history is not "
                  "encrypted. Use device encryption and a private account on shared machines. TVM does not run an analytics tracker in this build."),
        Heading("Connections to other services"),
        Paragraph("Metadata and images are requested from catalogue and artwork services, including Cinemeta and configured TMDB services. "
                  "They and media hosts receive network information such as your IP address. Real-Debrid receives your token and requested "
                  "links. The existing Torrentio resolver also receives the Real-Debrid token in its request URL when resolving catalogue "
                  "playback. Connect only if you accept those providers\xE2\x80\x99 terms and credential handling. IPTV servers receive your "
                  "provider login or playlist URL. HTTP-only sources are not encrypted in transit; use HTTPS where your provider supports it."),
        Paragraph("Third-party websites use their own accounts, cookies, privacy policies and retention rules. Removing TVM data does not "
                  "delete data held by those services. Disconnect or revoke tokens with the provider as needed. This build does not request "
                  "advertising-network prerolls."),
        Heading("Open-source playback"),
        Paragraph("On Windows, TVM plays video with mpv by its contributors, which is free software under the GPL or the LGPL depending on "
                  "how it was built. Its source code is at github.com/mpv-player/mpv. The iOS player includes MobileVLCKit 3.6.0 by "
                  "VideoLAN and its contributors, licensed under LGPL 2.1 or later."),
        Heading("Your choices and contact"),
        Paragraph("You can rename profiles, remove saved titles, disconnect services, export your TVM data, or erase it using the controls "
                  "above. Exports exclude credentials. Contact the person who supplied this build for access, correction, objections, "
                  "restrictions or complaints about stored data. UK users can also complain to the Information Commissioner\xE2\x80\x99s "
                  "Office at ico.org.uk."),
        Note("The business operator\xE2\x80\x99s legal name, postal address, support/privacy contact, lawful bases, applicable territories "
             "and any transfer safeguards are still awaiting owner confirmation."),
    };
    return view;
}

void App::ExportPersonalData() {
    // What /api/privacy/export gathers: the profiles and what each has watched and saved. Credentials stay out.
    nlohmann::json profilesOut = nlohmann::json::array();
    try {
        const profiles::Registry registry = profiles::Load(dataDir_);
        for (const profiles::Profile& profile : registry.profiles) {
            const paths::fs::path folder = paths::ProfileDir(dataDir_, profile.id);
            nlohmann::json saved = nlohmann::json::array();
            for (const catalog::WatchlistEntry& entry : catalog::ReadWatchlist(folder)) {
                saved.push_back({{"id", entry.item.id}, {"title", entry.item.title}});
            }
            profilesOut.push_back({{"id", profile.id},
                                   {"name", profile.name},
                                   {"active", profile.id == registry.activeId},
                                   {"progress", catalog::ReadProgress(folder)},
                                   {"watchlist", saved}});
        }
    } catch (const std::exception&) {
        pageMessage_ = "Export could not be created. Try again.";
        pageMessageBad_ = true;
        return;
    }
    const prefs::CorePrefs core = store_->CorePrefs();
    const nlohmann::json device = {{"app", "TVM native"},
                                   {"version", config::kCoreVersion},
                                   {"profiles", profilesOut},
                                   {"preferences", {{"autoUpdate", core.autoUpdate}}}};
    const std::filesystem::path file = KnownFolder(FOLDERID_Downloads) / L"tvm-personal-data.json";
    std::ofstream out(file, std::ios::binary | std::ios::trunc);
    out << nlohmann::json({{"device", device}}).dump(2);
    pageMessageBad_ = !out.good();
    pageMessage_ = out.good() ? "Your data export is ready in Downloads. It contains personal viewing history; keep it private."
                              : "Export could not be created. Try again.";
}

void App::EraseLocalData() {
    if (mpv_) mpv_->Stop();
    std::error_code ignored;
    for (const auto& item : std::filesystem::directory_iterator(dataDir_, ignored)) std::filesystem::remove_all(item.path(), ignored);
    MarkCleanExit();
    // A fresh copy starts from nothing, as window.location.reload() does after the erase.
    wchar_t exe[MAX_PATH]{};
    GetModuleFileNameW(nullptr, exe, MAX_PATH);
    std::wstring commandLine = GetCommandLineW();
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process{};
    if (CreateProcessW(exe, commandLine.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &startup, &process)) {
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }
    PostMessageW(window_, WM_CLOSE, 0, 0);
}

// ------------------------------------------------------------------ Donate

ui::InfoView App::DonateView() const {
    // The copy is DONATION_COPY, kept word for word so it cannot soften into implying a benefit.
    ui::InfoView view;
    view.kicker = "Optional";
    view.heading = "Donate to the app owner";
    view.lede = "Entirely optional, and it gives you nothing.";
    std::vector<ui::InfoAction> amounts;
    for (const int pence : {200, 500, 1000, 2500}) {
        amounts.push_back(Button("info:donate-" + std::to_string(pence), Money(pence), pence == donateAmount_));
    }
    view.filters = {amounts};
    view.blocks = {
        Paragraph("This is a gift to the person who runs TVM. It does not create an account, activate one, upgrade one, extend one, or "
                  "change anything in the app. If you want access, contact the owner instead \xE2\x80\x94 do not donate and expect it."),
        Note("Donations are not refundable, because nothing was sold."),
        // The card fields are Stripe's own page, which needs a browser. This window never takes a card number.
        Note("Card payments use Stripe's own card fields, which open in the TVM web app or TVM Desktop. This window never takes a card number."),
    };
    view.actions = {{Button("info:donate-go", "Donate " + Money(donateAmount_), true, true), Button("back", "Cancel")}};
    return view;
}

// ------------------------------------------------------------------ Downloads

ui::InfoView App::DownloadsView() const {
    ui::InfoView view;
    const std::string id = Param(pageParams_, "id");
    const std::string title = Param(pageParams_, "title");
    const bool series = !downloadEpisodes_.empty() || downloadEpisodesLoading_;
    view.kicker = "YOUR OFFLINE LIBRARY";
    view.heading = id.empty() ? "Downloads" : "Take it with you.";
    view.lede = id.empty() ? "Your downloads keep going while you browse." : (title.empty() ? "This title" : title);
    view.topActions = {Button("back", "Close")};

    std::size_t count = 1;
    if (!id.empty()) {
        if (series) {
            count = 0;
            for (const catalog::MediaItem& item : downloadEpisodes_) {
                if (downloadScope_ == "series" || (downloadScope_ == "season" ? item.season == downloadSeason_ : item.id == downloadEpisode_)) ++count;
            }
            view.filters.push_back({Button("info:dl-scope-series", "Full series \xC2\xB7 " + std::to_string(downloadEpisodes_.size()) + " episodes",
                                           downloadScope_ == "series"),
                                    Button("info:dl-scope-season", "One season", downloadScope_ == "season"),
                                    Button("info:dl-scope-episode", "One episode", downloadScope_ == "episode")});
            std::vector<ui::InfoAction> which;
            if (downloadScope_ != "series") which.push_back(Button("info:dl-season", "Season " + std::to_string(downloadSeason_) + " \xC2\xB7 change"));
            if (downloadScope_ == "episode") {
                const auto episode = std::find_if(downloadEpisodes_.begin(), downloadEpisodes_.end(),
                                                  [&](const catalog::MediaItem& item) { return item.id == downloadEpisode_; });
                const std::string label = episode == downloadEpisodes_.end()
                                              ? "Episode \xC2\xB7 change"
                                              : "Episode " + std::to_string(episode->episode.value_or(0)) + " \xC2\xB7 " +
                                                    episode->episodeName.value_or(episode->title) + " \xC2\xB7 change";
                which.push_back(Button("info:dl-episode", label));
            }
            if (!which.empty()) view.filters.push_back(which);
        }
        view.filters.push_back({Button("info:dl-language", std::string("Audio: ") + LanguageOf(downloadLanguage_).label + " \xC2\xB7 change"),
                                Button("info:dl-quality", "Maximum quality: " + QualityLabel(downloadQuality_) + " \xC2\xB7 change")});
        // The button says what it will fetch, so the language and quality are confirmed before anything starts.
        const std::string what = count > 1 ? "Download " + std::to_string(count) + " episodes" : std::string("Download");
        const std::string startLabel = pageBusy_ ? std::string("Adding\xE2\x80\xA6")
                                                 : what + " \xC2\xB7 " + LanguageOf(downloadLanguage_).label + " \xC2\xB7 " +
                                                       (downloadQuality_ == 2160 ? std::string("4K") : std::to_string(downloadQuality_) + "p");
        view.filters.push_back({Button("info:dl-folder", "Choose folder"),
                                Button("info:dl-start", startLabel, true,
                                       pageBusy_ || downloadFolder_.empty() || count == 0 || downloadEpisodesLoading_)});
        view.blocks.push_back(Note("The audio language is a must: a source marked as another language, or as MULTi, is never downloaded "
                                   "instead, and the download stops if none is found. Original files keep all included audio and subtitle "
                                   "tracks. Availability can vary by episode."));
        view.blocks.push_back(Row("Save to", downloadFolder_.empty() ? "Choose a folder on this device" : util::ToUtf8(downloadFolder_.wstring())));
        if (downloadEpisodesLoading_) view.blocks.push_back(Paragraph("Loading episodes\xE2\x80\xA6"));
        else if (series && downloadEpisodes_.empty()) view.blocks.push_back(Paragraph("No episodes are available to download yet."));
    }
    view.message = pageMessage_;
    view.messageBad = pageMessageBad_;

    std::size_t active = 0;
    for (const DownloadJob& job : downloads_) {
        if (job.state == "queued" || job.state == "resolving" || job.state == "downloading") ++active;
    }
    view.blocks.push_back(Heading("Your downloads \xC2\xB7 " + std::to_string(active) + " active"));
    if (downloads_.empty()) {
        view.blocks.push_back(Paragraph(id.empty() ? "Open a film or series and choose Download to get started." : "Your downloads will appear here."));
    }
    for (auto job = downloads_.rbegin(); job != downloads_.rend(); ++job) {
        std::string status;
        if (job->state == "downloading") status = Size(job->bytes) + (job->total > 0 ? " of " + Size(job->total) : "");
        else if (job->state == "resolving") status = "Finding your file\xE2\x80\xA6";
        else status = std::string(1, static_cast<char>(std::toupper(static_cast<unsigned char>(job->state[0])))) + job->state.substr(1);
        if (!job->error.empty()) status += " \xC2\xB7 " + job->error;
        view.blocks.push_back(Bullet(job->title, status, job->state == "complete", job->state == "failed"));
        if (!job->path.empty() && job->state == "complete") view.blocks.push_back(Note(util::ToUtf8(job->path.wstring())));
        const bool running = job->state == "queued" || job->state == "resolving" || job->state == "downloading";
        if (running) view.actions.push_back({Button("info:dl-cancel-" + std::to_string(job->id), "Cancel \xC2\xB7 " + job->title)});
        if (job->state == "complete") view.actions.push_back({Button("info:dl-show-" + std::to_string(job->id), "Show file \xC2\xB7 " + job->title)});
    }
    view.blocks.push_back(Note("Keep TVM open until downloads finish."));
    return view;
}

void App::LoadDownloadEpisodes(const std::string& seriesId) {
    downloadEpisodesLoading_ = true;
    background_->Run([this, seriesId] {
        std::optional<catalog::TitleMeta> meta;
        try {
            meta = catalog_->Meta(seriesId);
        } catch (const std::exception&) {
        }
        background_->PostToUi([this, meta] {
            downloadEpisodesLoading_ = false;
            downloadEpisodes_.clear();
            if (meta.has_value()) {
                for (const catalog::MediaItem& child : meta->children) {
                    if (child.season && child.episode && *child.season > 0) downloadEpisodes_.push_back(child);
                }
                pageParams_["show"] = meta->item.title;
                if (downloadSeason_ == 0 && !downloadEpisodes_.empty()) {
                    downloadSeason_ = downloadEpisodes_.front().season.value_or(1);
                    downloadEpisode_ = downloadEpisodes_.front().id;
                }
                if (Param(pageParams_, "title").empty()) pageParams_["title"] = meta->item.title;
            }
            if (pageName_ == "downloads") ShowInfoPage();
        });
    });
}

void App::LoadDownloadPrefs() {
    if (downloadPrefsLoaded_) return;
    downloadPrefsLoaded_ = true;
    downloadFolder_ = KnownFolder(FOLDERID_Downloads) / L"TVM";
    std::ifstream in(dataDir_ / "downloads.json", std::ios::binary);
    const nlohmann::json saved = nlohmann::json::parse(in, nullptr, false);
    if (!saved.is_object()) return;
    const std::string language = saved.value("language", std::string());
    if (std::any_of(Languages().begin(), Languages().end(), [&](const Language& l) { return l.id == language; })) downloadLanguage_ = language;
    const int quality = saved.value("maxHeight", 0);
    if (quality == 480 || quality == 720 || quality == 1080 || quality == 2160) downloadQuality_ = quality;
    const std::string folder = saved.value("folder", std::string());
    if (!folder.empty()) downloadFolder_ = util::ToWide(folder);
}

void App::SaveDownloadPrefs() const {
    const nlohmann::json saved = {{"language", downloadLanguage_},
                                  {"maxHeight", downloadQuality_},
                                  {"folder", util::ToUtf8(downloadFolder_.wstring())}};
    std::ofstream out(dataDir_ / "downloads.json", std::ios::binary | std::ios::trunc);
    out << saved.dump(2);
}

void App::ChooseDownloadFolder() {
    IFileOpenDialog* dialog = nullptr;
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog)))) {
        pageMessage_ = "The folder could not be opened.";
        return;
    }
    FILEOPENDIALOGOPTIONS options = 0;
    dialog->GetOptions(&options);
    dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    dialog->SetTitle(L"Save downloads to");
    if (SUCCEEDED(dialog->Show(window_))) {
        IShellItem* item = nullptr;
        if (SUCCEEDED(dialog->GetResult(&item))) {
            PWSTR path = nullptr;
            if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
                downloadFolder_ = path;
                pageMessage_.clear();
            }
            CoTaskMemFree(path);
            item->Release();
        }
    }
    dialog->Release();
}

void App::QueueDownloads() {
    const std::string id = Param(pageParams_, "id");
    if (pageBusy_ || downloadFolder_.empty() || id.empty()) return;
    std::vector<std::pair<std::string, std::string>> items;
    if (!downloadEpisodes_.empty()) {
        const std::string show = Param(pageParams_, "show").empty() ? Param(pageParams_, "title") : Param(pageParams_, "show");
        for (const catalog::MediaItem& file : downloadEpisodes_) {
            const bool chosen = downloadScope_ == "series" ||
                                (downloadScope_ == "season" ? file.season == downloadSeason_ : file.id == downloadEpisode_);
            if (!chosen) continue;
            std::string title = show + " \xE2\x80\x94 S" + TwoDigits(file.season.value_or(0)) + "E" + TwoDigits(file.episode.value_or(0));
            if (file.episodeName) title += " \xE2\x80\x94 " + *file.episodeName;
            const std::string playId = file.id.find(':') != std::string::npos
                                           ? file.id
                                           : id.substr(0, id.find(':')) + ":" + std::to_string(file.season.value_or(0)) + ":" +
                                                 std::to_string(file.episode.value_or(0));
            items.emplace_back(playId, title);
        }
    } else {
        items.emplace_back(id, Param(pageParams_, "title").empty() ? "TVM download" : Param(pageParams_, "title"));
    }
    if (items.empty()) return;
    for (auto& [playId, title] : items) {
        DownloadJob job;
        job.id = ++downloadSerial_;
        job.playId = playId;
        job.title = title;
        downloads_.push_back(std::move(job));
    }
    pageMessage_ = (items.size() == 1 ? std::string("Download") : std::to_string(items.size()) + " episodes") +
                   " added to the queue. You can keep browsing.";
    pageMessageBad_ = false;
    PumpDownloads();
}

void App::PumpDownloads() {
    if (downloadRunning_) return;
    const auto next = std::find_if(downloads_.begin(), downloads_.end(), [](const DownloadJob& job) { return job.state == "queued"; });
    if (next == downloads_.end()) return;
    downloadRunning_ = true;
    next->state = "resolving";
    const int jobId = next->id;
    const std::string playId = next->playId;
    const std::string title = next->title;
    const std::shared_ptr<std::atomic<bool>> cancel = next->cancel;
    const int height = downloadQuality_;
    const Language language = LanguageOf(downloadLanguage_);
    const std::filesystem::path folder = downloadFolder_;

    const auto update = [this](int id, std::function<void(DownloadJob&)> change) {
        for (DownloadJob& job : downloads_) {
            if (job.id == id) change(job);
        }
        // Progress is shown at most a few times a second, so a fast download does not flood the window.
        const double now = NowMs();
        if (pageName_ == "downloads" && now - downloadShownMs_ > 250.0) {
            downloadShownMs_ = now;
            ShowInfoPage();
        }
    };

    background_->Run([this, jobId, playId, title, cancel, height, language, folder, update] {
        // The language is a must, not a preference: the resolver drops every stream marked as another language
        // before it picks, so an English download never falls back to a French file.
        playback::ResolveInput input{playId, title, height};
        input.language = language.id == std::string("original") ? "" : language.id;
        const playback::Resolution found = resolver_->Resolve(input);
        if (cancel->load()) {
            background_->PostToUi([this, jobId, update] {
                update(jobId, [](DownloadJob& job) { job.state = "cancelled"; });
                downloadRunning_ = false;
                PumpDownloads();
            });
            return;
        }
        if (!found.ok()) {
            const std::string error = playback::ErrorMessage(found.reason);
            background_->PostToUi([this, jobId, error, update] {
                update(jobId, [&](DownloadJob& job) {
                    job.state = "failed";
                    job.error = error;
                });
                downloadRunning_ = false;
                PumpDownloads();
                if (pageName_ == "downloads") ShowInfoPage();
            });
            return;
        }
        const std::filesystem::path file = folder / (SafeName(title) + VideoExtension(found.url, found.title));
        background_->PostToUi([jobId, file, update] {
            update(jobId, [&](DownloadJob& job) {
                job.state = "downloading";
                job.path = file;
            });
        });
        auto lastPost = std::make_shared<ULONGLONG>(0);
        const http::DownloadResult result = http::Download(
            found.url, file,
            [this, jobId, cancel, lastPost, update](unsigned long long done, unsigned long long total) {
                const ULONGLONG now = GetTickCount64();
                if (now - *lastPost >= 250) {
                    *lastPost = now;
                    background_->PostToUi([jobId, done, total, update] {
                        update(jobId, [&](DownloadJob& job) {
                            job.bytes = done;
                            job.total = total;
                        });
                    });
                }
                return !cancel->load();
            },
            60000);
        background_->PostToUi([this, jobId, result, update] {
            update(jobId, [&](DownloadJob& job) {
                job.bytes = result.bytes;
                if (result.cancelled) {
                    job.state = "cancelled";
                    job.path.clear();
                } else if (result.status >= 200 && result.status < 300 && (job.total == 0 || result.bytes >= job.total)) {
                    job.state = "complete";
                } else {
                    job.state = "failed";
                    job.path.clear();
                    job.error = result.status == 0 ? "The file could not be saved or the connection dropped."
                                                   : "The host answered " + std::to_string(result.status) + ".";
                }
            });
            downloadRunning_ = false;
            if (pageName_ == "downloads") ShowInfoPage();
            PumpDownloads();
        });
    });
    if (pageName_ == "downloads") ShowInfoPage();
}

// ------------------------------------------------------------------ What's new, Diagnostics, System info

ui::InfoView App::ChangelogView() const {
    ui::InfoView view;
    view.heading = "What's new";
    view.lede = std::string("Build ") + config::kCoreVersion + " is on this device.";
    if (updatesView_.busy && updatesView_.changes.empty()) view.blocks.push_back(Paragraph("Asking GitHub for the latest changes\xE2\x80\xA6"));
    else if (updatesView_.changes.empty()) view.blocks.push_back(Paragraph("The latest GitHub changes are now in this interface."));
    for (const std::string& change : updatesView_.changes) view.blocks.push_back(Bullet(change, ""));
    view.actions = {{Button("back", "Close", true)}};
    return view;
}

ui::InfoView App::DiagnosticsView() const {
    RECT client{};
    GetClientRect(window_, &client);
    const UINT dpi = GetDpiForWindow(window_);
    char ratio[16];
    std::snprintf(ratio, sizeof(ratio), "%g", static_cast<double>(dpi) / 96.0);
    ui::InfoView view;
    view.heading = "System information";
    view.blocks = {
        Row("Interface", std::string("v") + config::kCoreVersion),
        Row("Core", std::string("v") + config::kCoreVersion + " \xC2\xB7 built in"),
        Row("Display", Pixels(GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN))),
        Row("Viewport", Pixels(client.right - client.left, client.bottom - client.top)),
        Row("Pixel ratio", ratio),
    };
    view.actions = {{Button("back", "Close", true)}};
    return view;
}

ui::InfoView App::SystemInfoView() const {
    const bool network = Param(pageParams_, "section") == "network";
    ui::InfoView view;
    view.kicker = "Device status";
    view.heading = network ? "Network" : "Display";
    if (network) {
        view.lede = "TVM reports the active connection. Wi-Fi selection is handled by the appliance setup layer, not a fake web control.";
        view.blocks = {Row("Status", Online() ? "Connected" : "Offline"), Row("Connection", "Managed by the operating system"),
                       Row("Estimated speed", "Unavailable"), Row("Estimated latency", "Unavailable")};
    } else {
        view.lede = "This build can stream up to 4K (2160p). The numbers below are the current window and panel, which can be 1080p "
                    "while the stream itself is 4K.";
        MONITORINFO monitor{};
        monitor.cbSize = sizeof(monitor);
        GetMonitorInfoW(MonitorFromWindow(window_, MONITOR_DEFAULTTONEAREST), &monitor);
        RECT client{};
        GetClientRect(window_, &client);
        HDC screen = GetDC(nullptr);
        const int depth = GetDeviceCaps(screen, BITSPIXEL);
        ReleaseDC(nullptr, screen);
        char ratio[16];
        std::snprintf(ratio, sizeof(ratio), "%g", static_cast<double>(GetDpiForWindow(window_)) / 96.0);
        const bool fullscreen = (GetWindowLongPtrW(window_, GWL_STYLE) & WS_OVERLAPPEDWINDOW) == 0;
        view.blocks = {Row("Max stream", "4K \xC2\xB7 2160p"),
                       Row("Panel", Pixels(monitor.rcMonitor.right - monitor.rcMonitor.left, monitor.rcMonitor.bottom - monitor.rcMonitor.top)),
                       Row("TVM viewport", Pixels(client.right - client.left, client.bottom - client.top)),
                       Row("Pixel ratio", ratio),
                       Row("Colour depth", std::to_string(depth) + "-bit"),
                       Row("Mode", fullscreen ? "Fullscreen" : "Window / shell controlled")};
    }
    view.actions = {{Button("back", "Back", true)}};
    return view;
}

// ------------------------------------------------------------------ Setup and Recovery

ui::InfoView App::SetupView() const {
    ui::InfoView view;
    view.kicker = "TVM";
    view.heading = "Enter your Real-Debrid token";
    view.lede = "Paste the API token from real-debrid.com/apitoken, then press OK. This unlocks TVM Stream only. Home and the other apps "
                "stay available. The token is encrypted on this machine and sent to Real-Debrid and the Torrentio resolver when you "
                "request catalogue playback. Only connect sources you are authorised to use.";
    view.message = pageMessage_;
    view.messageBad = pageMessageBad_;
    view.field = true;
    view.fieldLabel = "Real-Debrid API token";
    view.fieldPlaceholder = "Paste token, then press OK";
    view.fieldSecret = true;
    view.actions = {{Button("info:setup-save", pageBusy_ ? "Connecting\xE2\x80\xA6" : "Continue", true),
                     Button("open:legal", "Privacy & terms"), Button("stream-home", "Set up later")}};
    return view;
}

ui::InfoView App::RecoveryView() const {
    ui::InfoView view;
    view.kicker = "Recovery";
    view.heading = "TVM restarted in safe mode";
    view.lede = "The interface stopped three times in one minute. Review settings or return to Home. Network providers will only be "
                "contacted when a screen requests them.";
    if (pageConfirm_) {
        view.message = "Close TVM? On this PC the window closes. On an appliance this will become a real shutdown.";
        view.actions = {{Button("info:recovery-shutdown", "Close", true), Button("info:recovery-keep", "Cancel")}};
    } else {
        view.actions = {{Button("open:settings", "Settings", true), Button("stream-home", "Return to Home"),
                         Button("info:recovery-shutdown", "Shutdown")}};
    }
    return view;
}

bool App::CrashLooping() {
    const std::filesystem::path file = dataDir_ / kLaunchesFile;
    std::vector<long long> starts;
    {
        std::ifstream in(file);
        long long at = 0;
        while (in >> at) {
            if (NowSeconds() - at <= kCrashWindowSeconds) starts.push_back(at);
        }
    }
    // Each start is written down, and a clean exit removes the list, so what is left are starts that crashed.
    const bool looping = starts.size() >= 3;
    starts.push_back(NowSeconds());
    std::error_code ignored;
    std::filesystem::create_directories(dataDir_, ignored);
    std::ofstream out(file, std::ios::trunc);
    for (const long long at : starts) out << at << "\n";
    return looping;
}

void App::MarkCleanExit() {
    std::error_code ignored;
    std::filesystem::remove(dataDir_ / kLaunchesFile, ignored);
}

// ------------------------------------------------------------------ Channel check

ui::InfoView App::LiveCheckView() const {
    std::vector<std::string> groups;
    for (const catalog::LiveChannel& channel : liveCatalog_.channels) {
        const std::string group = live::GroupOf(channel);
        if (std::find(groups.begin(), groups.end(), group) == groups.end()) groups.push_back(group);
    }
    const std::string requested = Param(pageParams_, "group");
    const std::string group = !requested.empty() ? requested
                              : liveCheckGroup_ >= 0 && liveCheckGroup_ < static_cast<int>(groups.size()) ? groups[liveCheckGroup_]
                                                                                                          : "";
    ui::InfoView view;
    view.kicker = "Live TV";
    view.heading = "Channel check";
    view.lede = "This opens each channel exactly as the player would and reports what came back, so a channel that is simply off air is "
                "never confused with a setup that is broken.";
    view.topActions = {Button("info:check-run", liveChecking_ ? "Checking\xE2\x80\xA6" : "Check channels now", true),
                       Button("back", "Back", false, liveChecking_)};
    std::vector<ui::InfoAction> controls = {
        Button("info:check-limit", "How many: " + std::to_string(liveCheckLimit_) + " channels \xC2\xB7 about " +
                                       std::to_string((liveCheckLimit_ * 5 + 119) / 120) + " min \xC2\xB7 change",
               false, liveChecking_)};
    if (requested.empty() && !groups.empty()) {
        controls.push_back(Button("info:check-group", "Which: " + (group.empty() ? std::string("your chosen channels, or the whole list") : group) +
                                                          " \xC2\xB7 change",
                                  false, liveChecking_));
    }
    view.filters = {controls};
    if (liveChecking_) {
        view.message = "Opening " + std::to_string(liveCheckLimit_) + " channels" + (group.empty() ? "" : " from " + group) +
                       ". This fetches real video, so it is not instant.";
    } else if (liveReportReady_) {
        view.message = livecheck::VerdictLine(liveReport_);
        view.messageBad = liveReport_.working == 0;
    } else {
        view.message = pageMessage_;
        view.messageBad = pageMessageBad_;
    }
    if (liveReportReady_ && !liveChecking_) {
        view.blocks.push_back(Row("Streaming", std::to_string(liveReport_.working), liveReport_.working > 0, liveReport_.working == 0));
        view.blocks.push_back(Row("Checked", std::to_string(liveReport_.checked)));
        view.blocks.push_back(Row("In the list", std::to_string(liveReport_.total)));
        std::vector<ui::InfoBlock> working;
        std::vector<ui::InfoBlock> failing;
        for (const livecheck::Check& check : liveReport_.results) {
            const std::string transport = check.transport == "mpegts" ? "MPEG-TS" : check.transport == "hls" ? "HLS" : "\xE2\x80\x94";
            if (check.ok) working.push_back(Bullet(check.name, transport + " \xC2\xB7 " + std::to_string(check.ms) + " ms", true));
            else failing.push_back(Bullet(check.name, livecheck::VerdictLabel(check.verdict) + " \xC2\xB7 " + check.detail, false, true));
        }
        if (!working.empty()) {
            view.blocks.push_back(Heading("Channels you can watch right now (" + std::to_string(working.size()) + ")"));
            view.blocks.insert(view.blocks.end(), working.begin(), working.end());
        }
        if (!failing.empty()) {
            view.blocks.push_back(Heading("Not available (" + std::to_string(failing.size()) + ")"));
            view.blocks.insert(view.blocks.end(), failing.begin(), failing.end());
        }
    } else if (!liveChecking_) {
        view.blocks = {Heading("No channels checked yet"), Paragraph("Run a check to see which of your channels actually stream.")};
    }
    return view;
}

void App::RunLiveCheck() {
    if (liveChecking_) return;
    // The channels as the Live TV screen read them. Without them there is nothing to open.
    if (liveCatalog_.channels.empty()) {
        pageMessage_ = liveLoaded_ ? "No channels to check. Add a Live TV login or playlist first." : "Open Live TV once so its channels are read, then run the check.";
        pageMessageBad_ = true;
        return;
    }
    std::vector<std::string> groups;
    for (const catalog::LiveChannel& channel : liveCatalog_.channels) {
        const std::string group = live::GroupOf(channel);
        if (std::find(groups.begin(), groups.end(), group) == groups.end()) groups.push_back(group);
    }
    const std::string requested = Param(pageParams_, "group");
    const std::string group = !requested.empty() ? requested
                              : liveCheckGroup_ >= 0 && liveCheckGroup_ < static_cast<int>(groups.size()) ? groups[liveCheckGroup_]
                                                                                                          : "";
    // A group checks that group; otherwise the picks, else the whole list, as checkLiveChannels chooses.
    std::vector<catalog::LiveChannel> pool;
    if (!group.empty()) {
        for (const catalog::LiveChannel& channel : liveCatalog_.channels) {
            if (live::GroupOf(channel) == group) pool.push_back(channel);
        }
    } else {
        const std::vector<std::string> picks = live::AllowedPicks(liveCatalog_.channels, livePicks_);
        for (const std::string& id : picks) {
            const auto found = std::find_if(liveCatalog_.channels.begin(), liveCatalog_.channels.end(),
                                            [&](const catalog::LiveChannel& c) { return c.id == id; });
            if (found != liveCatalog_.channels.end()) pool.push_back(*found);
        }
        if (pool.empty()) pool = liveCatalog_.channels;
    }
    if (pool.size() > liveCheckLimit_) pool.resize(liveCheckLimit_);
    // The addresses are made here, on the window thread, and never reach the report.
    const std::optional<xtream::Account> account = xtream_->Saved();
    std::vector<std::pair<catalog::LiveChannel, std::string>> targets;
    for (const catalog::LiveChannel& channel : pool) {
        std::string url = channel.url;
        if (url.empty() && account.has_value()) url = xtream_->StreamUrl(*account, channel.id);
        targets.emplace_back(channel, url);
    }
    liveChecking_ = true;
    pageMessage_.clear();
    const std::size_t total = liveCatalog_.channels.size();

    struct Sweep {
        std::mutex lock;
        std::vector<std::pair<catalog::LiveChannel, std::string>> targets;
        std::vector<livecheck::Check> results;
        std::size_t next = 0;
        std::size_t done = 0;
    };
    auto sweep = std::make_shared<Sweep>();
    sweep->targets = std::move(targets);
    sweep->results.resize(sweep->targets.size());
    // A few at a time: panels count simultaneous streams against the device limit, so a wide sweep would make
    // working channels report as refused.
    const std::size_t workers = std::min<std::size_t>(3, std::max<std::size_t>(1, sweep->targets.size()));
    if (sweep->targets.empty()) {
        liveChecking_ = false;
        return;
    }
    for (std::size_t w = 0; w < workers; ++w) {
        background_->Run([this, sweep, total] {
            for (;;) {
                std::size_t index = 0;
                {
                    std::lock_guard guard(sweep->lock);
                    if (sweep->next >= sweep->targets.size()) return;
                    index = sweep->next++;
                }
                const auto& [channel, url] = sweep->targets[index];
                const ULONGLONG started = GetTickCount64();
                livecheck::Check check = livecheck::Classify(livecheck::Probe(url));
                check.id = channel.id;
                check.name = channel.name;
                check.group = live::GroupOf(channel);
                check.ms = static_cast<long long>(GetTickCount64() - started);
                bool last = false;
                {
                    std::lock_guard guard(sweep->lock);
                    sweep->results[index] = std::move(check);
                    last = ++sweep->done == sweep->targets.size();
                }
                if (last) {
                    background_->PostToUi([this, sweep, total] {
                        livecheck::Report report;
                        report.total = total;
                        report.results = sweep->results;
                        report.checked = report.results.size();
                        report.working = static_cast<std::size_t>(
                            std::count_if(report.results.begin(), report.results.end(), [](const livecheck::Check& c) { return c.ok; }));
                        liveReport_ = std::move(report);
                        liveReportReady_ = true;
                        liveChecking_ = false;
                        if (pageName_ == "live-check") ShowInfoPage();
                    });
                }
            }
        });
    }
}

// ------------------------------------------------------------------ Email

ui::InfoView App::MailView() const {
    ui::InfoView view;
    view.kicker = "Sign-up codes";
    view.heading = "Email";
    if (!admin::DevUnlocked(dataDir_)) {
        view.lede = "Sign in to the dev account to change this.";
        view.actions = {{Button("open:developer", "Developer", true), Button("back", "Back")}};
        return view;
    }
    view.lede = "When this is set up, everyone who signs up is emailed a six-digit code and cannot use TVM until they type it in. Use an "
                "app password, not your normal one. It stays on this machine.";
    view.message = pageMessage_;
    view.messageBad = pageMessageBad_;
    view.filters = {
        {Button("info:mail-preset-icloud", "iCloud Mail"), Button("info:mail-preset-gmail", "Gmail")},
        {Button("info:mail-security-starttls", "STARTTLS", mailDraft_.security == "starttls"),
         Button("info:mail-security-tls", "TLS", mailDraft_.security == "tls")},
        {Button("info:field-host", "Mail server", fieldMode_ == "host"), Button("info:field-port", "Port", fieldMode_ == "port"),
         Button("info:field-username", "Username", fieldMode_ == "username"),
         Button("info:field-password", "App password", fieldMode_ == "password"),
         Button("info:field-from", "Send codes from", fieldMode_ == "from")},
    };
    view.field = true;
    view.fieldSecret = fieldMode_ == "password";
    if (fieldMode_ == "host") {
        view.fieldLabel = "Mail server";
        view.fieldPlaceholder = "smtp.mail.me.com";
    } else if (fieldMode_ == "port") {
        view.fieldLabel = "Port";
        view.fieldPlaceholder = "587";
    } else if (fieldMode_ == "username") {
        view.fieldLabel = "Username";
        view.fieldPlaceholder = "you@icloud.com";
    } else if (fieldMode_ == "password") {
        view.fieldLabel = "App password";
        view.fieldPlaceholder = mailSaved_.has_value() ? "Saved. Leave empty to keep it" : "App password";
    } else {
        view.fieldLabel = "Send codes from";
        view.fieldPlaceholder = "you@icloud.com";
    }
    view.blocks = {Row("Status", mailSaved_.has_value() ? "On \xC2\xB7 from " + mailSaved_->from : "Off", mailSaved_.has_value())};
    if (mailSaved_.has_value()) {
        view.blocks.push_back(Note("A test email is sent from TVM Desktop, whose core has the mail sender. Saved settings are shared with it."));
    }
    std::vector<ui::InfoAction> buttons = {Button("info:mail-save", "Save", true)};
    if (mailSaved_.has_value()) buttons.push_back(Button("info:mail-remove", "Turn off"));
    buttons.push_back(Button("back", "Back"));
    view.actions = {buttons};
    return view;
}

// ------------------------------------------------------------------ Accounts

void App::LoadAccounts() {
    if (!admin::DevUnlocked(dataDir_)) {
        accounts_.clear();
        return;
    }
    try {
        accounts_ = admin::ListAccounts(dataDir_, util::Trim(fieldValues_["accounts.search"]), accountsState_);
        accountsSummary_ = admin::Summarise(dataDir_);
    } catch (const std::exception& error) {
        pageMessage_ = error.what();
        pageMessageBad_ = true;
    }
}

ui::InfoView App::AccountsView() const {
    ui::InfoView view;
    view.kicker = "Developer";
    view.heading = "Accounts";
    if (!admin::DevUnlocked(dataDir_)) {
        view.lede = "Sign in to the dev account to see who has signed up.";
        view.actions = {{Button("open:developer", "Developer", true), Button("back", "Back")}};
        return view;
    }
    view.message = pageMessage_;
    view.messageBad = pageMessageBad_;
    const auto open = std::find_if(accounts_.begin(), accounts_.end(), [&](const admin::Account& a) { return a.id == accountOpen_; });
    const auto badge = [](const admin::Account& account) {
        if (account.suspended) return std::string("Suspended");
        if (!account.activated) return std::string("Waiting");
        return std::string(account.tier == "stream-live" ? "Movies, TV & Live" : "Movies & TV");
    };

    if (open == accounts_.end()) {
        view.topActions = {Button("info:acct-refresh", "Refresh", true), Button("back", "Back")};
        view.filters = {{Button("info:acct-state-all", "Everyone", accountsState_ == "all"),
                         Button("info:acct-state-waiting", "Waiting", accountsState_ == "waiting"),
                         Button("info:acct-state-active", "Active", accountsState_ == "active"),
                         Button("info:acct-state-suspended", "Suspended", accountsState_ == "suspended")}};
        view.field = true;
        view.fieldLabel = "Search";
        view.fieldPlaceholder = "Email or name";
        view.blocks = {Row("Everyone", std::to_string(accountsSummary_.total)), Row("Waiting", std::to_string(accountsSummary_.waiting)),
                       Row("Active", std::to_string(accountsSummary_.active), accountsSummary_.active > 0),
                       Row("Suspended", std::to_string(accountsSummary_.suspended))};
        if (accounts_.empty()) {
            view.blocks.push_back(Heading("No accounts here"));
            view.blocks.push_back(Paragraph("Nobody matches that filter yet."));
        } else {
            view.blocks.push_back(Note("Select someone to see their details and switch them on."));
        }
        for (const admin::Account& account : accounts_) {
            view.actions.push_back({Button("info:acct-open-" + account.id, account.displayName + " \xC2\xB7 " + account.email + " \xC2\xB7 " + badge(account))});
        }
        return view;
    }

    const admin::Account& account = *open;
    view.lede = account.displayName + " \xC2\xB7 " + account.email + " \xC2\xB7 " + badge(account);
    view.topActions = {Button("info:acct-close", "All accounts"), Button("back", "Back")};
    std::vector<ui::InfoAction> switches;
    if (account.activated) {
        switches.push_back(Button("info:acct-live", account.tier == "stream-live" ? "Live TV: on" : "Live TV: off"));
    } else {
        switches.push_back(Button("info:acct-grant-stream", "Switch on \xC2\xB7 Movies & TV", true));
        switches.push_back(Button("info:acct-grant-live", "Switch on \xC2\xB7 with Live TV", true));
    }
    switches.push_back(Button("info:acct-verify", account.emailVerifiedAt.empty() ? "Mark email verified" : "Mark email unverified"));
    switches.push_back(Button("info:acct-suspend", account.suspended ? "Restore" : "Suspend"));
    view.filters = {switches, {Button("info:field-note", "Your note", fieldMode_ == "note"),
                               Button("info:field-rd", "Real-Debrid key", fieldMode_ == "rd")}};
    view.field = true;
    if (fieldMode_ == "rd") {
        view.fieldLabel = "Real-Debrid key for this account";
        view.fieldPlaceholder = account.hasRdKey ? "Paste a new key to replace it" : "Empty uses this machine's key";
        view.fieldSecret = true;
        std::vector<ui::InfoAction> keys = {Button("info:acct-rd-save", "Save key", true)};
        if (account.hasRdKey) keys.push_back(Button("info:acct-rd-remove", "Remove key"));
        view.filters.push_back(keys);
    } else {
        view.fieldLabel = "Your note (private)";
        view.fieldPlaceholder = "How you know them, what they paid";
        view.filters.push_back({Button("info:acct-note", "Save note", true)});
    }
    const std::string email = !account.emailVerifiedAt.empty() ? "Verified " + ShortDate(account.emailVerifiedAt)
                              : account.emailCodeSent         ? "Code sent"
                                                              : "Not verified";
    view.blocks = {Row("Signed up", ShortDate(account.createdAt)),
                   Row("Activated", ShortDate(account.activatedAt)),
                   Row("Last seen", ShortDate(account.lastSeenAt)),
                   Row("Sign-ins", std::to_string(account.signIns)),
                   Row("Open sessions", std::to_string(account.sessions)),
                   Row("Terms", account.termsAcceptedAt.empty() ? "Not agreed" : "v" + (account.termsVersion.empty() ? "?" : account.termsVersion)),
                   Row("Email", email, !account.emailVerifiedAt.empty()),
                   Row("Real-Debrid", account.hasRdKey ? "Its own key" : "This machine's key"),
                   Row("Last device", account.lastClient.empty() ? "\xE2\x80\x94" : account.lastClient)};
    // Erasure cannot be undone, so it asks once rather than sitting one stray press away from a real person's data.
    if (pageConfirm_) {
        view.message = "Erase " + account.email + " and everything held about them?";
        view.messageBad = true;
        view.actions = {{Button("info:acct-erase", "Yes, erase permanently"), Button("info:acct-keep", "Keep")}};
    } else {
        view.actions = {{Button("info:acct-erase", "Erase account (GDPR)")}};
    }
    return view;
}

// ------------------------------------------------------------------ Developer and Apps

ui::InfoView App::DeveloperView() const {
    ui::InfoView view;
    view.message = pageMessage_;
    view.messageBad = pageMessageBad_;
    if (!admin::DevUnlocked(dataDir_)) {
        // DeveloperUnlock.tsx: dev mode comes with the dev account.
        view.kicker = "GLogic Studios";
        view.heading = "Dev account";
        view.lede = "Enter the dev code to switch to the dev account. Dev mode stays on until you sign out of it. The code is checked "
                    "on this machine and never stored here.";
        view.field = true;
        view.fieldLabel = "Dev code";
        view.fieldPlaceholder = "Code, then press OK";
        view.fieldSecret = true;
        // Not disabled while checking, so the focus stays on it; a press meanwhile is ignored.
        view.actions = {{Button("info:dev-unlock", pageBusy_ ? "Checking\xE2\x80\xA6" : "Switch to dev account", true),
                         Button("back", "Back")}};
        return view;
    }
    view.kicker = "Studio panel";
    view.heading = "Developer";
    view.lede = "Dev mode is on for this machine. Plan switches arrive with the plan port; the tools below work now.";
    view.actions = {
        {Button("open:accounts", "Accounts", true), Button("open:mail-settings", "Email"), Button("open:live-check", "Channel check")},
        {Button("stream-home", "Jump Home"), Button("open:live-tv", "Jump Live TV"), Button("open:apps", "Jump Apps")},
        {Button("info:dev-lock", "Sign out of the dev account")},
    };
    return view;
}

ui::InfoView App::AppsView() const {
    ui::InfoView view;
    view.kicker = "Your apps";
    view.heading = "Apps";
    view.lede = "Open a service hub or TVM Stream. Playback still uses this machine.";
    ui::InfoAction stream = Button("stream-home", "TVM");
    stream.tile = ui::Rgb(0x2F6BFF);
    stream.detail = "TVM Stream";
    view.tiles.push_back(stream);
    for (const hubs::Spec& spec : hubs::Specs()) {
        ui::InfoAction tile = Button("open:service?id=" + spec.id, spec.wordmark);
        tile.tile = ui::Rgb(spec.accent);
        tile.detail = spec.name;
        view.tiles.push_back(tile);
    }
    view.blocks = {Note("Service names identify independent providers. These hubs are TVM catalogues, not the licensed apps.")};
    return view;
}

ui::InfoView App::ConfirmView() const {
    // ConfirmModal: a question, what it does, and the two answers.
    ui::InfoView view;
    view.heading = Param(pageParams_, "title");
    view.lede = Param(pageParams_, "body");
    const std::string label = Param(pageParams_, "confirmLabel");
    view.actions = {{Button("info:confirm-yes", label.empty() ? "Confirm" : label, true), Button("back", "Cancel")}};
    return view;
}

// ------------------------------------------------------------------ service hubs

void App::OpenServiceHub(const std::string& id) {
    const hubs::Spec* spec = hubs::Find(id.empty() ? "netflix" : id);
    ui::Scene* scene = shell_->SceneNamed("service");
    if (spec == nullptr || scene == nullptr) return;
    if (const auto cached = hubs_.find(spec->id); cached != hubs_.end()) {
        ShowServiceHub(cached->second);
        return;
    }
    ui::SceneView loading;
    loading.style = ui::SceneStyle::Stream;
    loading.status = "Opening " + spec->name + "\xE2\x80\xA6";
    loading.brandWord = spec->wordmark;
    loading.brandColor = ui::Rgb(spec->accent);
    loading.topButtons = HubChrome();
    scene->SetView(loading, NowMs());
    dirty_ = true;
    if (!hubsInFlight_.insert(spec->id).second) return;

    // Continue watching, as Home reads it, so the hub can keep the titles that belong to it.
    std::vector<catalog::MediaItem> watching;
    if (const std::optional<paths::fs::path> folder = profiles::ActiveFolder(dataDir_)) {
        const catalog::ProgressMap progress = catalog::ReadProgress(*folder);
        for (const catalog::ProgressItem& entry : catalog::PickContinueWatching(catalog::ApplyProgress(bundle_.catalog, progress), progress)) {
            watching.push_back(entry.item);
        }
    }
    const hubs::Spec copy = *spec;
    background_->Run([this, copy, watching] {
        // The seed lists first, which come in seconds, then again with the originals TVMaze matches by network,
        // which takes longer. The seeds are cached by then, so the second build only waits on TVMaze.
        for (const bool matchNetworks : {false, true}) {
            hubs::Hub hub = hubs::Build(copy, *catalog_, http::Send, watching, matchNetworks);
            background_->PostToUi([this, matchNetworks, hub = std::move(hub)] {
                if (matchNetworks) hubsInFlight_.erase(hub.id);
                // A hub with nothing in it is not kept, so the next visit asks again.
                if (matchNetworks && !hub.rails.empty()) hubs_[hub.id] = hub;
                const nav::ViewEntry& top = nav::ActiveEntry(shell_->stack());
                if (top.name == "service" && Param(top.params, "id") == hub.id && (matchNetworks || !hub.rails.empty())) ShowServiceHub(hub);
            });
        }
    });
}

void App::ShowServiceHub(const hubs::Hub& hub) {
    ui::Scene* scene = shell_->SceneNamed("service");
    if (scene == nullptr) return;
    ui::SceneView view;
    view.style = ui::SceneStyle::Stream;
    view.brandWord = hub.wordmark;
    view.brandColor = ui::Rgb(hub.accent);
    view.kicker = hub.disclaimer;
    view.topButtons = HubChrome();
    for (const hubs::Rail& rail : hub.rails) {
        ui::RailData data;
        data.id = rail.id;
        data.title = rail.title;
        for (const catalog::MediaItem& item : rail.items) data.cards.push_back(ui::CardData{item.id, item.title, item.poster, std::nullopt});
        view.rails.push_back(std::move(data));
    }
    if (view.rails.empty()) view.status = "Nothing in " + hub.name + " yet. Check this PC is online, then open it again.";

    std::vector<ui::HeroData> heroes;
    if (hub.hero.has_value()) {
        ui::HeroData hero;
        hero.itemId = hub.hero->id;
        hero.title = hub.hero->title;
        hero.backdropUrl = catalog::PreferBackdrop(hub.hero->id, hub.hero->backdrop, hub.hero->poster);
        hero.hue = hub.hero->hue;
        heroes.push_back(hero);
    }
    const double now = NowMs();
    const bool first = scene->HeroCount() == 0;
    scene->SetHeroes(heroes, now);
    scene->SetView(view, now);
    if (first && !heroes.empty()) scene->FocusItem("hero-play", now, true);
    scene->SetImageReady([this](const std::string& url) { return artwork_->Lookup(url).has_value(); });
    for (const ui::HeroData& hero : heroes) QueueArtwork(hero.backdropUrl);
    QueueRailArtwork(view.rails);
    dirty_ = true;
}

}  // namespace tvm::platform
