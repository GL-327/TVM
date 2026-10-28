#pragma once

// A live TV channel, as a provider describes it. The fields match LiveChannel in
// apps/core/src/providers/types.ts. The stream address stays out of anything the
// screens see: a channel from an Xtream panel has none, and its stream is opened by id.

#include <optional>
#include <string>

namespace tvm::catalog {

struct LiveChannel {
    std::string id;
    std::string name;
    std::string url;
    std::optional<std::string> group;
    std::optional<std::string> logo;

    bool operator==(const LiveChannel&) const = default;
};

}  // namespace tvm::catalog
