#include "catalog/artwork.h"

#include <algorithm>
#include <cctype>
#include <initializer_list>

namespace tvm::catalog {

namespace {

constexpr const char* kMetahub = "https://images.metahub.space";

std::string Lower(std::string text) {
    std::transform(text.begin(), text.end(), text.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return text;
}

bool StartsWithIgnoreCase(const std::string& text, const std::string& prefix) {
    return text.size() >= prefix.size() && Lower(text.substr(0, prefix.size())) == Lower(prefix);
}

// Replaces the first occurrence of `from` with `to`, as a regex without the g flag does.
std::string ReplaceFirst(const std::string& text, const std::string& from, const std::string& to) {
    const auto at = text.find(from);
    if (at == std::string::npos) return text;
    return text.substr(0, at) + to + text.substr(at + from.size());
}


// Replaces the first "/<width>x<height>bb" with "/2000x2000bb".
std::string ReplaceFirstThumbnailSize(const std::string& text) {
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] != '/') continue;
        std::size_t j = i + 1;
        const std::size_t firstDigits = j;
        while (j < text.size() && std::isdigit(static_cast<unsigned char>(text[j]))) ++j;
        if (j == firstDigits || j >= text.size() || text[j] != 'x') continue;
        ++j;
        const std::size_t secondDigits = j;
        while (j < text.size() && std::isdigit(static_cast<unsigned char>(text[j]))) ++j;
        if (j == secondDigits || text.compare(j, 2, "bb") != 0) continue;
        return text.substr(0, i) + "/2000x2000bb" + text.substr(j + 2);
    }
    return text;
}

// True when the host is, or is a subdomain of, one of the hosts served over https.
bool IsHttpsHost(const std::string& host) {
    static constexpr const char* kHosts[] = {"image.tmdb.org", "images.metahub.space", "live.metahub.space",
                                             "mzstatic.com", "tvmaze.com", "kitsu.io", "fanart.tv"};
    const std::string lower = Lower(host);
    for (const char* name : kHosts) {
        const std::string suffix = name;
        if (lower == suffix) return true;
        if (lower.size() > suffix.size() && lower.compare(lower.size() - suffix.size(), suffix.size(), suffix) == 0 &&
            lower[lower.size() - suffix.size() - 1] == '.') {
            return true;
        }
    }
    return false;
}

std::string PreferHttps(const std::string& url) {
    if (url.rfind("http://", 0) != 0) return url;
    // The host sits between the scheme and the next slash.
    const std::size_t hostStart = 7;
    const std::size_t hostEnd = std::min(url.find('/', hostStart), url.size());
    const std::string host = url.substr(hostStart, hostEnd - hostStart);
    if (!IsHttpsHost(host.substr(0, host.find(':')))) return url;
    return "https://" + url.substr(hostStart);
}

}  // namespace

std::string ImdbIdFrom(const std::string& value) {
    for (std::size_t i = 0; i + 2 < value.size(); ++i) {
        if (std::tolower(static_cast<unsigned char>(value[i])) != 't') continue;
        if (std::tolower(static_cast<unsigned char>(value[i + 1])) != 't') continue;
        std::size_t j = i + 2;
        while (j < value.size() && std::isdigit(static_cast<unsigned char>(value[j]))) ++j;
        if (j == i + 2) continue;
        return Lower(value.substr(i, j - i));
    }
    return "";
}

std::string MetahubPoster(const std::string& imdb) {
    return std::string(kMetahub) + "/poster/large/" + Lower(imdb) + "/img";
}

std::string MetahubBackdrop(const std::string& imdb) {
    return std::string(kMetahub) + "/background/large/" + Lower(imdb) + "/img";
}

std::string NormalizeArtUrl(const std::string& url) {
    const std::size_t begin = url.find_first_not_of(" \t\r\n");
    if (begin == std::string::npos) return "";
    const std::size_t end = url.find_last_not_of(" \t\r\n");
    const std::string raw = url.substr(begin, end - begin + 1);

    if (raw.rfind("//", 0) == 0) return PreferHttps("https:" + raw);
    if (StartsWithIgnoreCase(raw, "https://") || StartsWithIgnoreCase(raw, "http://")) return PreferHttps(raw);
    if (raw.rfind("/t/p/", 0) == 0) return "https://image.tmdb.org" + raw;

    std::string bare = raw;
    if (StartsWithIgnoreCase(bare, "www.image.tmdb.org/")) bare = bare.substr(4);
    if (StartsWithIgnoreCase(bare, "image.tmdb.org/")) return PreferHttps("https://" + bare);
    if (StartsWithIgnoreCase(bare, "images.metahub.space/") || StartsWithIgnoreCase(bare, "live.metahub.space/")) {
        return PreferHttps("https://" + bare);
    }

    // A bare TMDB file name such as /abc123.jpg.
    if (raw.size() > 1 && raw[0] == '/') {
        const std::size_t dot = raw.rfind('.');
        if (dot != std::string::npos && dot > 1) {
            const std::string extension = Lower(raw.substr(dot + 1));
            const bool knownExtension = extension == "jpg" || extension == "jpeg" || extension == "png" || extension == "webp";
            bool alphanumeric = true;
            for (std::size_t i = 1; i < dot; ++i) {
                if (!std::isalnum(static_cast<unsigned char>(raw[i]))) alphanumeric = false;
            }
            if (knownExtension && alphanumeric) return "https://image.tmdb.org/t/p/original" + raw;
        }
    }
    return raw;
}

std::string UpgradeImageUrl(const std::string& url, bool backdrop) {
    std::string next = NormalizeArtUrl(url);
    if (next.empty()) return next;

    next = ReplaceFirst(next, "/poster/small/", "/poster/large/");
    next = ReplaceFirst(next, "/poster/medium/", "/poster/large/");
    next = ReplaceFirst(next, "/background/small/", "/background/large/");
    next = ReplaceFirst(next, "/background/medium/", "/background/large/");

    if (backdrop) {
        for (const char* size : {"300", "500", "780", "1280"}) {
            const std::string from = std::string("/t/p/w") + size + "/";
            if (next.find(from) != std::string::npos) {
                next = ReplaceFirst(next, from, "/t/p/original/");
                break;
            }
        }
    } else {
        for (const char* size : {"154", "185", "342", "500"}) {
            const std::string from = std::string("/t/p/w") + size + "/";
            if (next.find(from) != std::string::npos) {
                next = ReplaceFirst(next, from, "/t/p/w780/");
                break;
            }
        }
    }
    return ReplaceFirstThumbnailSize(next);
}

std::string PreferBackdrop(const std::string& id, const std::string& backdrop, const std::string& poster) {
    const std::string wide = UpgradeImageUrl(backdrop, true);
    if (!wide.empty()) return wide;
    const std::string imdb = ImdbIdFrom(id);
    if (!imdb.empty()) return MetahubBackdrop(imdb);
    return UpgradeImageUrl(poster, true);
}

std::string PreferPoster(const std::string& id, const std::string& poster, const std::string& backdrop) {
    const std::string card = UpgradeImageUrl(poster, false);
    if (!card.empty()) return card;
    const std::string imdb = ImdbIdFrom(id);
    if (!imdb.empty()) return MetahubPoster(imdb);
    return UpgradeImageUrl(backdrop, false);
}

}  // namespace tvm::catalog
