#include "catalog/realdebrid.h"

#include <array>
#include <regex>

#include "core/js.h"
#include "core/secrets.h"

namespace tvm::realdebrid {

namespace {

constexpr char kApi[] = "https://api.real-debrid.com/rest/1.0";
// The library lists are read a page at a time, as the Node core reads them.
constexpr int kPageSize = 100;
constexpr int kMaxDownloadOffset = 500;
constexpr int kMaxTorrentPages = 10;

// The answer as JSON. Text that is not JSON is a failed request, not an empty list.
nlohmann::json ParseAnswer(const std::string& text) {
    nlohmann::json value = nlohmann::json::parse(text, nullptr, false);
    if (value.is_discarded()) throw RequestError(Failure::Failed, "Real-Debrid sent an unreadable answer");
    return value;
}

std::string StringOf(const nlohmann::json& object, const char* key) {
    const auto found = object.find(key);
    return found != object.end() && found->is_string() ? found->get<std::string>() : "";
}

// Real-Debrid sends identifiers as strings or as numbers.
std::string IdOf(const nlohmann::json& object, const char* key) {
    const auto found = object.find(key);
    if (found == object.end()) return "";
    if (found->is_string()) return found->get<std::string>();
    if (found->is_number_integer()) return std::to_string(found->get<long long>());
    return "";
}

double NumberOf(const nlohmann::json& object, const char* key) {
    const auto found = object.find(key);
    return found != object.end() && found->is_number() ? found->get<double>() : 0.0;
}

std::vector<std::string> StringsOf(const nlohmann::json& object, const char* key) {
    std::vector<std::string> strings;
    const auto found = object.find(key);
    if (found == object.end() || !found->is_array()) return strings;
    for (const nlohmann::json& value : *found) {
        if (value.is_string()) strings.push_back(value.get<std::string>());
    }
    return strings;
}

Download DownloadFrom(const nlohmann::json& entry) {
    Download download;
    download.id = IdOf(entry, "id");
    download.filename = StringOf(entry, "filename");
    download.mimeType = StringOf(entry, "mimeType");
    download.link = StringOf(entry, "link");
    return download;
}

Torrent TorrentFrom(const nlohmann::json& entry) {
    Torrent torrent;
    torrent.id = IdOf(entry, "id");
    torrent.filename = StringOf(entry, "filename");
    torrent.status = StringOf(entry, "status");
    torrent.progress = NumberOf(entry, "progress");
    torrent.links = StringsOf(entry, "links");
    return torrent;
}

// The transcode groups, in the order the HTML5 picker tries them, and the qualities
// it prefers inside each group.
constexpr std::array<const char*, 3> kHtml5Groups = {"apple", "h264WebM", "liveMP4"};
constexpr std::array<const char*, 8> kQualities = {"1080", "1080p", "720", "720p", "full", "auto", "480", "360"};

const std::regex kM3u8(R"(\.m3u8(\?|$))", std::regex::icase);
const std::regex kMp4(R"(\.mp4(\?|$))", std::regex::icase);

bool IsHttpAddress(const std::string& value) {
    const auto lower = [](std::string text) {
        for (char& c : text) {
            if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
        }
        return text;
    };
    const std::string head = lower(value.substr(0, 8));
    return head.rfind("http://", 0) == 0 || head.rfind("https://", 0) == 0;
}

std::optional<std::string> HttpUrl(const nlohmann::ordered_json& value) {
    if (!value.is_string()) return std::nullopt;
    const std::string url = value.get<std::string>();
    if (!IsHttpAddress(url)) return std::nullopt;
    return url;
}

std::string MimeFor(const std::string& group, const std::string& url) {
    if (group == "apple" || std::regex_search(url, kM3u8)) return "application/vnd.apple.mpegurl";
    if (group == "h264WebM") return "video/webm";
    if (group == "liveMP4" && !std::regex_search(url, kMp4)) return "video/mp2t";
    return "video/mp4";
}

}  // namespace

std::optional<Transcode> PickHtml5Transcode(const nlohmann::ordered_json& body) {
    if (!body.is_object()) return std::nullopt;
    for (const char* group : kHtml5Groups) {
        const auto bucket = body.find(std::string(group));
        if (bucket == body.end() || !bucket->is_object()) continue;
        const nlohmann::ordered_json& map = *bucket;

        for (const char* quality : kQualities) {
            const auto found = map.find(std::string(quality));
            if (found == map.end()) continue;
            if (const std::optional<std::string> url = HttpUrl(*found)) return Transcode{*url, MimeFor(group, *url)};
        }
        // Any other stream in the group, in the order the server sent them.
        for (const auto& item : map.items()) {
            if (const std::optional<std::string> url = HttpUrl(item.value())) return Transcode{*url, MimeFor(group, *url)};
        }
    }
    return std::nullopt;
}

Client::Client(ClientOptions options)
    : dataDir_(std::move(options.dataDir)), env_(std::move(options.env)), transport_(std::move(options.transport)) {}

std::optional<std::string> Client::Token() const {
    const paths::fs::path path = paths::RdTokenPath(dataDir_);
    if (std::optional<std::string> stored = secrets::ReadSecret(path)) return stored;
    // An empty file is a token the viewer cleared, so the environment variable is not used.
    if (secrets::HasSecretFile(path)) return std::nullopt;

    const std::optional<std::wstring> value = env_(L"TVM_RD_TOKEN");
    if (!value) return std::nullopt;
    const std::string token = util::Trim(util::ToUtf8(*value));
    if (token.empty()) return std::nullopt;
    return token;
}

void Client::SetToken(const std::string& token) {
    const std::string value = util::Trim(token);
    if (value.find_first_of("\r\n") != std::string::npos) {
        throw std::invalid_argument("A token cannot contain line breaks.");
    }
    secrets::WriteSecret(paths::RdTokenPath(dataDir_), value);
}

Status Client::GetStatus() const {
    Status status;
    status.configured = Token().has_value();
    if (!status.configured) return status;

    try {
        const nlohmann::json user = ParseAnswer(Send("/user").body);
        const auto name = user.find("username");
        if (name != user.end() && name->is_string()) status.username = name->get<std::string>();
        status.premium = NumberOf(user, "premium") > 0;
    } catch (const RequestError& error) {
        status.error = error.failure() == Failure::NeedsAuth ? "needs-auth" : "unreachable";
    }
    return status;
}

std::vector<Download> Client::Downloads() const {
    std::vector<Download> collected;
    for (int offset = 0; offset < kMaxDownloadOffset; offset += kPageSize) {
        const nlohmann::json page = ReadList("/downloads?limit=100&offset=" + std::to_string(offset));
        if (page.empty()) break;
        for (const nlohmann::json& entry : page) collected.push_back(DownloadFrom(entry));
        if (page.size() < static_cast<std::size_t>(kPageSize)) break;
    }
    return collected;
}

std::vector<Torrent> Client::Torrents() const {
    std::vector<Torrent> collected;
    for (int page = 1; page <= kMaxTorrentPages; ++page) {
        const nlohmann::json batch = ReadList("/torrents?limit=100&page=" + std::to_string(page));
        if (batch.empty()) break;
        for (const nlohmann::json& entry : batch) collected.push_back(TorrentFrom(entry));
        if (batch.size() < static_cast<std::size_t>(kPageSize)) break;
    }
    return collected;
}

TorrentInfo Client::GetTorrentInfo(const std::string& id) const {
    const nlohmann::json body = ParseAnswer(Send("/torrents/info/" + js::EncodeUriComponent(id)).body);

    TorrentInfo info;
    static_cast<Torrent&>(info) = TorrentFrom(body);
    const auto files = body.find("files");
    if (files != body.end() && files->is_array()) {
        for (const nlohmann::json& entry : *files) {
            TorrentFile file;
            file.id = static_cast<int>(NumberOf(entry, "id"));
            file.path = StringOf(entry, "path");
            file.bytes = NumberOf(entry, "bytes");
            file.selected = static_cast<int>(NumberOf(entry, "selected"));
            info.files.push_back(file);
        }
    }
    return info;
}

Unrestricted Client::Unrestrict(const std::string& link) const {
    http::Options options;
    options.method = "POST";
    options.headers.emplace_back("Content-Type", "application/x-www-form-urlencoded");
    options.body = "link=" + util::FormEncode(link);
    const nlohmann::json body = ParseAnswer(Send("/unrestrict/link", options).body);

    Unrestricted unrestricted;
    unrestricted.id = IdOf(body, "id");
    unrestricted.filename = StringOf(body, "filename");
    unrestricted.mimeType = StringOf(body, "mimeType");
    unrestricted.download = StringOf(body, "download");
    return unrestricted;
}

std::optional<Transcode> Client::GetTranscode(const std::string& id) const {
    try {
        const http::Response response = Send("/streaming/transcode/" + js::EncodeUriComponent(id));
        return PickHtml5Transcode(nlohmann::ordered_json::parse(response.body));
    } catch (const std::exception&) {
        return std::nullopt;
    }
}

http::Response Client::Send(const std::string& path, const http::Options& options) const {
    const std::optional<std::string> token = Token();
    if (!token) throw RequestError(Failure::NotConfigured, "not-configured");

    http::Options request = options;
    request.headers.emplace_back("Authorization", "Bearer " + *token);
    const std::optional<http::Response> response = transport_(std::string(kApi) + path, request);
    if (!response) throw RequestError(Failure::Failed, "Real-Debrid could not be reached");
    if (response->status == 401 || response->status == 403) {
        throw RequestError(Failure::NeedsAuth, "needs-auth");
    }
    if (!response->ok()) {
        throw RequestError(Failure::Failed, "Real-Debrid replied " + std::to_string(response->status));
    }
    return *response;
}

nlohmann::json Client::ReadList(const std::string& path) const {
    const http::Response response = Send(path);
    if (response.status == 204 || util::Trim(response.body).empty()) return nlohmann::json::array();
    const nlohmann::json parsed = ParseAnswer(response.body);
    return parsed.is_array() ? parsed : nlohmann::json::array();
}

}  // namespace tvm::realdebrid
