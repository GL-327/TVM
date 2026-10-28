#include "catalog/xtream.h"

#include <map>
#include <regex>
#include <set>
#include <utility>

#include "catalog/title.h"
#include "core/js.h"
#include "core/secrets.h"
#include "core/vault.h"

namespace tvm::xtream {

namespace {

// A channel list runs to megabytes on a big panel. The default cap would refuse it.
constexpr std::size_t kListBytes = 64 * 1024 * 1024;
const std::size_t kDefaultBytes = http::Options{}.maxBytes;

std::string Lower(std::string text) {
    for (char& c : text) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c - 'A' + 'a');
    }
    return text;
}

bool HasWebScheme(const std::string& value) {
    const std::string head = Lower(value.substr(0, 8));
    return head.rfind("http://", 0) == 0 || head.rfind("https://", 0) == 0;
}

// The parts of a web address that a server needs.
struct WebAddress {
    std::string scheme;
    std::string host;
    // Empty for the scheme's default port, which URL() also leaves out of the origin.
    std::string port;
    std::string path;
};

// The address parts as URL() reads them. Nothing for an address that URL() would refuse.
std::optional<WebAddress> ParseWebAddress(const std::string& value) {
    const std::size_t schemeEnd = value.find("://");
    if (schemeEnd == std::string::npos) return std::nullopt;

    WebAddress address;
    address.scheme = Lower(value.substr(0, schemeEnd));
    if (address.scheme != "http" && address.scheme != "https") return std::nullopt;

    const std::size_t authorityStart = schemeEnd + 3;
    const std::size_t authorityEnd = value.find_first_of("/?#", authorityStart);
    std::string authority =
        value.substr(authorityStart, authorityEnd == std::string::npos ? std::string::npos : authorityEnd - authorityStart);
    // A user name before an '@' is not part of the host.
    if (const std::size_t at = authority.rfind('@'); at != std::string::npos) authority = authority.substr(at + 1);

    std::string host;
    std::string port;
    if (!authority.empty() && authority.front() == '[') {
        // An IPv6 literal keeps its colons inside the brackets.
        const std::size_t close = authority.find(']');
        if (close == std::string::npos) return std::nullopt;
        host = authority.substr(0, close + 1);
        const std::string rest = authority.substr(close + 1);
        if (!rest.empty()) {
            if (rest.front() != ':') return std::nullopt;
            port = rest.substr(1);
        }
    } else {
        const std::size_t colon = authority.find(':');
        host = authority.substr(0, colon);
        if (colon != std::string::npos) port = authority.substr(colon + 1);
    }
    if (host.empty() || host.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._[]:") != std::string::npos) {
        return std::nullopt;
    }
    address.host = Lower(host);

    if (!port.empty()) {
        if (port.size() > 5 || port.find_first_not_of("0123456789") != std::string::npos) return std::nullopt;
        const unsigned long number = std::stoul(port);
        if (number > 65535) return std::nullopt;
        const bool isDefault = (address.scheme == "http" && number == 80) || (address.scheme == "https" && number == 443);
        if (!isDefault) address.port = std::to_string(number);
    }

    // With no path, or a query or fragment straight after the host, the path is "/".
    if (authorityEnd == std::string::npos || value[authorityEnd] == '?' || value[authorityEnd] == '#') {
        address.path = "/";
    } else {
        const std::size_t pathEnd = value.find_first_of("?#", authorityEnd);
        address.path = value.substr(authorityEnd, pathEnd == std::string::npos ? std::string::npos : pathEnd - authorityEnd);
    }
    return address;
}

// The panel's address for a stream: the Node core's shape, with the credentials escaped as encodeURIComponent escapes them.
std::string StreamAddress(const Account& account, const std::string& streamId, bool hls) {
    const std::string base = account.host + "/live/" + js::EncodeUriComponent(account.username) + "/" +
                             js::EncodeUriComponent(account.password) + "/" + js::EncodeUriComponent(streamId);
    return base + (hls ? ".m3u8" : ".ts");
}

// JSON from a panel's answer. Text that is not JSON gives null, as the Node core's reader does.
nlohmann::json ParseOrNull(const std::string& text) {
    nlohmann::json value = nlohmann::json::parse(text, nullptr, false);
    return value.is_discarded() ? nlohmann::json() : value;
}

// A string field, or nothing when the field is missing or not a string.
std::string StringOf(const nlohmann::json& object, const char* key) {
    if (!object.is_object()) return "";
    const auto found = object.find(key);
    return found != object.end() && found->is_string() ? found->get<std::string>() : "";
}

// An identifier the panel sends as a string or a number, read the way String() reads it.
std::optional<std::string> IdentifierOf(const nlohmann::json& object, const char* key) {
    if (!object.is_object()) return std::nullopt;
    const auto found = object.find(key);
    if (found == object.end()) return std::nullopt;
    if (found->is_string()) return found->get<std::string>();
    if (found->is_number()) return js::NumberToString(found->get<double>());
    return std::nullopt;
}

// The user_info part of the login answer, or null when it is missing.
nlohmann::json UserInfoOf(const nlohmann::json& body) {
    if (!body.is_object()) return nlohmann::json();
    const auto user = body.find("user_info");
    return user != body.end() && user->is_object() ? *user : nlohmann::json();
}

// The panel accepts the login when auth is 1, "1" or true, or when the account is active and not turned off.
bool AuthOk(const nlohmann::json& user) {
    if (!user.is_object()) return false;
    const auto auth = user.find("auth");
    const bool hasAuth = auth != user.end();
    const bool authOn = hasAuth && ((auth->is_number() && auth->get<double>() == 1.0) ||
                                    (auth->is_string() && auth->get<std::string>() == "1") ||
                                    (auth->is_boolean() && auth->get<bool>()));
    if (authOn) return true;

    const std::string status = Lower(StringOf(user, "status"));
    if (status != "active") return false;
    const bool authOff = hasAuth && ((auth->is_number() && auth->get<double>() == 0.0) ||
                                     (auth->is_string() && auth->get<std::string>() == "0"));
    return !authOff;
}

// A category: its id and its name. Nothing for a row without an id.
std::optional<std::pair<std::string, std::string>> CategoryOf(const nlohmann::json& entry) {
    const std::optional<std::string> id = IdentifierOf(entry, "category_id");
    if (!id.has_value()) return std::nullopt;
    const std::string label = util::Trim(StringOf(entry, "category_name"));
    return std::make_pair(*id, label.empty() ? std::string("Live") : label);
}

// One stream row as a channel. Nothing for a row with no stream id.
std::optional<catalog::LiveChannel> ChannelOf(const nlohmann::json& entry, const std::map<std::string, std::string>& groups) {
    const std::optional<std::string> streamId = IdentifierOf(entry, "stream_id");
    if (!streamId.has_value()) return std::nullopt;
    const std::string id = util::Trim(*streamId);
    if (id.empty()) return std::nullopt;

    const std::string named = util::Trim(StringOf(entry, "name"));
    catalog::LiveChannel channel;
    channel.id = std::string(kChannelPrefix) + id;
    channel.name = named.empty() ? "Channel " + id : named;

    const auto group = groups.find(IdentifierOf(entry, "category_id").value_or(""));
    if (group != groups.end()) channel.group = group->second;
    if (const std::optional<std::string> logo = catalog::title::HttpAssetUrl(StringOf(entry, "stream_icon"))) {
        channel.logo = *logo;
    }
    return channel;
}

}  // namespace

std::optional<std::string> NormalizeHost(const std::string& raw) {
    std::string value = util::Trim(raw);
    if (value.empty()) return std::nullopt;
    // Another scheme is refused. Read as a host with an http:// prefix, it would give a broken address.
    if (!HasWebScheme(value) && value.find("://") != std::string::npos) return std::nullopt;
    if (!HasWebScheme(value)) value = "http://" + value;

    const std::optional<WebAddress> address = ParseWebAddress(value);
    if (!address.has_value()) return std::nullopt;

    // The PHP entry point is dropped, then any trailing slashes.
    static const std::regex kEntryPoint(R"(/(player_api|get|panel_api)\.php$)", std::regex::icase);
    std::string path = std::regex_replace(address->path, kEntryPoint, "", std::regex_constants::format_first_only);
    while (!path.empty() && path.back() == '/') path.pop_back();

    std::string origin = address->scheme + "://" + address->host;
    if (!address->port.empty()) origin += ":" + address->port;
    return origin + path;
}

std::string PlayerApiUrl(const Account& account, const std::string& action) {
    std::string url = account.host + "/player_api.php?username=" + util::FormEncode(account.username) +
                      "&password=" + util::FormEncode(account.password);
    if (!action.empty()) url += "&action=" + util::FormEncode(action);
    return url;
}

Client::Client(ClientOptions options)
    : dataDir_(std::move(options.dataDir)), env_(std::move(options.env)), transport_(std::move(options.transport)) {}

std::optional<Account> Client::Saved() const {
    const std::optional<nlohmann::json> stored = secrets::ReadPrivateJson(dataDir_, paths::XtreamPath(dataDir_));
    if (!stored.has_value() || !stored->is_object()) return std::nullopt;

    const std::optional<std::string> host = NormalizeHost(StringOf(*stored, "host"));
    const std::string username = util::Trim(StringOf(*stored, "username"));
    const std::string password = StringOf(*stored, "password");
    if (!host.has_value() || username.empty() || password.empty()) return std::nullopt;
    return Account{*host, username, password};
}

void Client::Save(const Account& account) {
    const nlohmann::json stored{{"host", account.host}, {"username", account.username}, {"password", account.password}};
    vault::WriteSealed(dataDir_, paths::XtreamPath(dataDir_), stored);
}

void Client::Forget() {
    secrets::DeleteSecret(paths::XtreamPath(dataDir_));
}

std::optional<http::Response> Client::Fetch(const std::string& url, std::size_t maxBytes) const {
    http::Options options;
    options.maxBytes = maxBytes;
    return transport_(url, options);
}

Authentication Client::Authenticate(const Account& account) const {
    Authentication result;
    const std::optional<http::Response> response = Fetch(PlayerApiUrl(account), kDefaultBytes);
    if (!response.has_value()) {
        result.error = "unreachable";
        return result;
    }
    if (!response->ok()) {
        result.error = response->status == 401 ? "needs-auth" : "unreachable";
        return result;
    }

    const nlohmann::json user = UserInfoOf(ParseOrNull(response->body));
    if (!AuthOk(user)) {
        result.error = "needs-auth";
        return result;
    }
    const std::string name = util::Trim(StringOf(user, "username"));
    result.username = name.empty() ? account.username : name;
    result.ok = true;
    return result;
}

Load Client::LoadChannels(const Account& account) const {
    Load load;
    const Authentication auth = Authenticate(account);
    load.username = auth.username;
    if (!auth.ok) {
        load.error = auth.error;
        return load;
    }

    // The category names are optional: the streams play without them.
    std::map<std::string, std::string> groups;
    const std::optional<http::Response> categories = Fetch(PlayerApiUrl(account, "get_live_categories"), kDefaultBytes);
    if (categories.has_value() && categories->ok()) {
        const nlohmann::json body = ParseOrNull(categories->body);
        if (body.is_array()) {
            for (const nlohmann::json& entry : body) {
                if (const auto category = CategoryOf(entry)) groups[category->first] = category->second;
            }
        }
    }

    const std::optional<http::Response> streams = Fetch(PlayerApiUrl(account, "get_live_streams"), kListBytes);
    if (!streams.has_value() || !streams->ok()) {
        load.error = "unreachable";
        return load;
    }
    const nlohmann::json body = ParseOrNull(streams->body);
    if (!body.is_array()) {
        load.error = "unreachable";
        return load;
    }

    std::set<std::string> used;
    for (const nlohmann::json& entry : body) {
        const std::optional<catalog::LiveChannel> channel = ChannelOf(entry, groups);
        if (!channel.has_value() || !used.insert(channel->id).second) continue;
        load.channels.push_back(*channel);
    }
    if (load.channels.empty()) load.error = "unreachable";
    return load;
}

std::string Client::StreamUrl(const Account& account, const std::string& streamId) const {
    // Only the exact value 1 selects HLS, as the Node core reads it.
    const std::optional<std::wstring> hls = env_(L"TVM_XTREAM_HLS");
    return StreamAddress(account, streamId, hls.has_value() && util::ToUtf8(*hls) == "1");
}

}  // namespace tvm::xtream
