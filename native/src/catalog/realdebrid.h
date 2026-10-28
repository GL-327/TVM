#pragma once

// The Real-Debrid account: the API token kept on this machine, the account's status,
// and the lists and links that the library and playback read. Ported from
// apps/core/src/providers/realdebrid.ts.
//
// The token is sealed in the data folder, as the Node core seals it. It is sent to
// Real-Debrid and to nothing else, and no call returns it. The network is reached
// through a Transport, so tests replay canned answers.

#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/http.h"
#include "core/paths.h"
#include "core/util.h"

namespace tvm::realdebrid {

using Transport = http::Transport;

// Why a request to Real-Debrid did not give an answer.
enum class Failure {
    NotConfigured,
    NeedsAuth,
    Failed,
};

class RequestError : public std::runtime_error {
public:
    RequestError(Failure failure, const std::string& what) : std::runtime_error(what), failure_(failure) {}
    Failure failure() const { return failure_; }

private:
    Failure failure_;
};

// The account, as the app shows it. `error` is "" when the account answered,
// "needs-auth" when Real-Debrid refused the token, and "unreachable" otherwise.
struct Status {
    bool configured = false;
    std::optional<std::string> username;
    bool premium = false;
    std::string error;

    bool operator==(const Status&) const = default;
};

struct Download {
    std::string id;
    std::string filename;
    std::string mimeType;
    std::string link;

    bool operator==(const Download&) const = default;
};

struct Torrent {
    std::string id;
    std::string filename;
    std::string status;
    double progress = 0.0;
    std::vector<std::string> links;

    bool operator==(const Torrent&) const = default;
};

struct TorrentFile {
    int id = 0;
    std::string path;
    double bytes = 0.0;
    int selected = 0;

    bool operator==(const TorrentFile&) const = default;
};

struct TorrentInfo : Torrent {
    std::vector<TorrentFile> files;

    bool operator==(const TorrentInfo&) const = default;
};

struct Unrestricted {
    std::string id;
    std::string filename;
    std::string mimeType;
    // The direct address the file streams from.
    std::string download;

    bool operator==(const Unrestricted&) const = default;
};

// A stream an HTML5 player can open, with its MIME type.
struct Transcode {
    std::string url;
    std::string mimeType;

    bool operator==(const Transcode&) const = default;
};

// The first stream an HTML5 player can open, HLS first. Real-Debrid's live MP4 can be
// MPEG-TS under an .mp4 name, so it is the last choice.
std::optional<Transcode> PickHtml5Transcode(const nlohmann::ordered_json& body);

struct ClientOptions {
    paths::fs::path dataDir;
    util::EnvLookup env = util::ProcessEnvironment();
    Transport transport = http::Send;
};

class Client {
public:
    explicit Client(ClientOptions options);

    // The token in use: the one saved on this machine, else TVM_RD_TOKEN. A saved
    // token that is empty means the viewer cleared it, so the variable is not used.
    std::optional<std::string> Token() const;

    // Saves the token without its surrounding white space. An empty token clears it.
    // Throws std::invalid_argument when the token has a line break in it.
    void SetToken(const std::string& token);

    // The account's status. Makes one request, and never throws.
    Status GetStatus() const;

    // Every download and every torrent on the account, one page at a time, as the Node core reads them.
    std::vector<Download> Downloads() const;
    std::vector<Torrent> Torrents() const;

    // Throws RequestError when Real-Debrid does not answer.
    TorrentInfo GetTorrentInfo(const std::string& id) const;
    Unrestricted Unrestrict(const std::string& link) const;

    // The stream for a download or torrent. Nothing when Real-Debrid has none, or cannot answer.
    std::optional<Transcode> GetTranscode(const std::string& id) const;

private:
    // One request with the token. Throws RequestError.
    http::Response Send(const std::string& path, const http::Options& options = {}) const;
    // A list answer. Throws RequestError, and an empty list for an answer that is not a list.
    nlohmann::json ReadList(const std::string& path) const;

    paths::fs::path dataDir_;
    util::EnvLookup env_;
    Transport transport_;
};

}  // namespace tvm::realdebrid
