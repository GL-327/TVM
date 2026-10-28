#pragma once

// The Xtream panel login for Live TV: the server, username and password kept sealed on
// this machine, the check that the panel accepts them, and the channels it serves.
// Ported from apps/core/src/providers/xtream.ts and the login part of live.ts.
//
// The password goes to the panel and nowhere else. It is never put in a channel, a
// status or a log. The network is reached through an http::Transport, so tests replay
// canned answers.

#include <optional>
#include <string>
#include <vector>

#include "catalog/live_channel.h"
#include "core/http.h"
#include "core/paths.h"
#include "core/util.h"

namespace tvm::xtream {

// The prefix every Xtream channel id carries, as the Node core writes it.
inline constexpr char kChannelPrefix[] = "live:xtream:";

struct Account {
    // The server as http(s)://host[:port][/path], as NormalizeHost returns it.
    std::string host;
    std::string username;
    std::string password;

    bool operator==(const Account&) const = default;
};

// Accepts a server such as panel.example:8080, http(s)://host:port, or a pasted
// player_api.php address. Query strings and fragments are dropped, and so are the PHP
// entry points. Nothing for an address that is not an http or https server.
std::optional<std::string> NormalizeHost(const std::string& raw);

// The player_api.php address for an account, with the action when one is given.
std::string PlayerApiUrl(const Account& account, const std::string& action = "");

// The result of asking the panel whether it accepts a login. `error` is "" when the
// panel accepted it, else "needs-auth" or "unreachable".
struct Authentication {
    bool ok = false;
    std::optional<std::string> username;
    std::string error;

    bool operator==(const Authentication&) const = default;
};

// The channels of a login. `error` is "" when there are channels, else the reason. A
// panel with no channels counts as unreachable, as the Node core counts it.
struct Load {
    std::vector<catalog::LiveChannel> channels;
    std::string error;
    std::optional<std::string> username;

    bool operator==(const Load&) const = default;
};

struct ClientOptions {
    paths::fs::path dataDir;
    util::EnvLookup env = util::ProcessEnvironment();
    http::Transport transport = http::Send;
};

class Client {
public:
    explicit Client(ClientOptions options);

    // The saved login. Nothing when none is saved, or when the saved one is missing a part.
    std::optional<Account> Saved() const;

    // Stores the login sealed on this machine. The caller checks the login first.
    void Save(const Account& account);

    // Removes the saved login.
    void Forget();

    // Asks the panel whether it accepts the login. Makes one request.
    Authentication Authenticate(const Account& account) const;

    // The channels of a login: the login check, then the categories and the streams.
    Load LoadChannels(const Account& account) const;

    // The address one channel streams from. The Node core's rule: MPEG-TS (.ts) unless
    // TVM_XTREAM_HLS is 1, because many panels serve HLS whose segments their CDN refuses.
    std::string StreamUrl(const Account& account, const std::string& streamId) const;

private:
    // A GET through the transport. Nothing when no answer came back.
    std::optional<http::Response> Fetch(const std::string& url, std::size_t maxBytes) const;

    paths::fs::path dataDir_;
    util::EnvLookup env_;
    http::Transport transport_;
};

}  // namespace tvm::xtream
