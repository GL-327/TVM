#pragma once

// When a published native build may replace the installed one. A build is only ever replaced by a newer one: a
// copy built locally, or from a commit that is not published yet, must never be "updated" back to an older release.

#include <string>
#include <string_view>

namespace tvm::update {

// A legacy Core reports its compiled version but has no process identifier.
// Briefly losing the connection cannot prove it restarted.
inline bool IsNewCoreBoot(std::string_view previousBoot, std::string_view previousVersion,
                          std::string_view boot, std::string_view version) {
    if (!boot.empty()) return boot != previousBoot;
    return previousBoot.empty() && !previousVersion.empty() && !version.empty() && version != previousVersion;
}

// The first 19 characters of an ISO 8601 UTC time ("2026-11-22T14:42:19"), which order correctly as text.
inline std::string IsoSeconds(const std::string& iso) {
    return iso.size() >= 19 ? iso.substr(0, 19) : iso;
}

// True when the published build (uploaded at `publishedAt`, from commit `publishedCommit`) should replace the
// installed one (built at `installedBuiltAt` from `installedCommit`). Unknown times never trigger a replacement.
inline bool ShouldInstall(const std::string& installedCommit, const std::string& installedBuiltAt,
                          const std::string& publishedCommit, const std::string& publishedAt) {
    if (installedCommit.empty() || publishedCommit.size() != 40 || publishedCommit == installedCommit) return false;
    if (installedBuiltAt.size() < 19 || publishedAt.size() < 19) return false;
    return IsoSeconds(publishedAt) > IsoSeconds(installedBuiltAt);
}

// How long until the next check for a native update. A check that could not reach GitHub (the PC just woke or
// signed in before its network was up) or found an update it had to hold back (a film is playing) is retried
// in ten minutes; otherwise the routine check runs every six hours.
inline double NextCheckDelayMs(bool retrySoon) {
    return retrySoon ? 600000.0 : 21600000.0;
}

}  // namespace tvm::update
