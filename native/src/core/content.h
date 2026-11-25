#pragma once

#include <filesystem>
#include <mutex>
#include <string>
#include <nlohmann/json.hpp>
#include "core/http.h"

namespace tvm::content {

// Read on the UI thread; refresh only on a worker. A rejected download never replaces a good copy.
class Store {
public:
    explicit Store(std::filesystem::path dataDir, std::filesystem::path bundled = {});
    nlohmann::json Read(const std::string& name) const;
    void Refresh(const http::Transport& transport = http::Send);
    static bool Valid(const std::string& name, const nlohmann::json& data);
private:
    std::filesystem::path dataDir_, bundled_;
    mutable std::mutex mutex_;
};

bool Allows(const nlohmann::json& parental, int maxAge, const std::vector<std::string>& genres);
bool AllowsLive(const nlohmann::json& parental, int maxAge, const std::string& group);
std::string LocalDate();
bool EventLive(const nlohmann::json& event, const std::string& date);
std::string EventKicker(const nlohmann::json& event, const std::string& date);

// The notice remains pending until it was actually shown on Home and dismissed by input.
class ReleaseNotice {
public:
    ReleaseNotice(std::string installed, std::string seen) : installed_(std::move(installed)), seen_(std::move(seen)) {}
    bool Pending() const { return installed_ != seen_; }
    void Show(double now) { if (Pending() && !shown_) { shown_ = true; shownAt_ = now; } }
    bool Input(double now) { if (!shown_ || !Pending() || now - shownAt_ < 1200) return false; seen_ = installed_; return true; }
    bool Visible() const { return shown_ && Pending(); }
    const std::string& Seen() const { return seen_; }
private:
    std::string installed_, seen_;
    bool shown_ = false;
    double shownAt_ = 0;
};
}  // namespace tvm::content
