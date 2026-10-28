#pragma once

// Which channels actually play. Ported from apps/core/src/providers/liveCheck.ts: each channel is opened as
// the player would open it, and what came back is turned into a verdict a person can act on. The verdicts
// are kept apart from the fetching, so they are tested without the network.

#include <optional>
#include <string>
#include <vector>

#include "catalog/live_channel.h"

namespace tvm::livecheck {

// What a probe saw. No address is kept: a report must not carry a subscription.
struct Outcome {
    std::optional<unsigned> status;
    std::string networkError;
    bool timedOut = false;
    std::string head;
    // For HLS: the first segment's answer, its size, and whether the playlist named no segment at all.
    std::optional<unsigned> segmentStatus;
    bool segmentTried = false;
    std::size_t segmentBytes = 0;
    bool manifestEmpty = false;
};

struct Check {
    std::string id;
    std::string name;
    std::string group;
    // working, unauthorized, missing, offline, silent, empty, unplayable or unreachable.
    std::string verdict;
    bool ok = false;
    // "hls", "mpegts" or empty.
    std::string transport;
    std::string detail;
    long long ms = 0;
};

struct Report {
    std::size_t total = 0;
    std::size_t checked = 0;
    std::size_t working = 0;
    std::vector<Check> results;
};

bool LooksLikeTransportStream(const std::string& head);
bool LooksLikeManifest(const std::string& head);
// The verdict, the transport and the detail for one probe. The id, name, group and time are the caller's.
Check Classify(const Outcome& outcome);
// The one line that answers "is Live TV working?".
std::string VerdictLine(const Report& report);
// How a verdict reads in the list.
std::string VerdictLabel(const std::string& verdict);

// Opens one channel's stream and reads its first bytes, and for HLS its first segment. Blocks on the network.
Outcome Probe(const std::string& url);

}  // namespace tvm::livecheck
