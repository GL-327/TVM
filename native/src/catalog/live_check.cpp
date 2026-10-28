#include "catalog/live_check.h"

#include <algorithm>
#include <cctype>
#include <regex>
#include <sstream>

#include "core/http.h"

namespace tvm::livecheck {

namespace {

constexpr std::size_t kPacket = 188;
constexpr unsigned char kSync = 0x47;
// Enough for a dozen transport packets, or a manifest's first lines.
constexpr std::size_t kHeadBytes = 188 * 12;
constexpr unsigned kTimeoutMs = 8000;

unsigned char At(const std::string& head, std::size_t offset) {
    return offset < head.size() ? static_cast<unsigned char>(head[offset]) : 0;
}

bool PacketAt(const std::string& head, std::size_t offset) {
    if (offset + 3 >= head.size() || At(head, offset) != kSync) return false;
    // The adaptation field control is never 00 in a real packet, and 0x47 there decodes to 00, which rules out
    // a body of repeated "G".
    if (((At(head, offset + 3) >> 4) & 0x3) == 0) return false;
    // The transport error indicator set means corrupt, not playing.
    return (At(head, offset + 1) & 0x80) == 0;
}

std::string Resolve(const std::string& base, const std::string& ref) {
    if (http::IsWebUrl(ref)) return ref;
    const std::size_t scheme = base.find("://");
    if (!ref.empty() && ref.front() == '/') {
        const std::size_t root = base.find('/', scheme == std::string::npos ? 0 : scheme + 3);
        return (root == std::string::npos ? base : base.substr(0, root)) + ref;
    }
    const std::size_t query = base.find('?');
    const std::string path = base.substr(0, query);
    return path.substr(0, path.rfind('/') + 1) + ref;
}

// The first address a playlist names, or nothing.
std::optional<std::string> FirstUri(const std::string& text) {
    std::istringstream lines(text);
    std::string line;
    while (std::getline(lines, line)) {
        while (!line.empty() && std::isspace(static_cast<unsigned char>(line.back()))) line.pop_back();
        std::size_t start = 0;
        while (start < line.size() && std::isspace(static_cast<unsigned char>(line[start]))) ++start;
        if (start < line.size() && line[start] != '#') return line.substr(start);
    }
    return std::nullopt;
}

}  // namespace

bool LooksLikeTransportStream(const std::string& head) {
    if (head.size() < kPacket * 2) return false;
    std::optional<std::size_t> start;
    for (std::size_t i = 0; i + kPacket + 3 < head.size() && i < kPacket; ++i) {
        if (PacketAt(head, i) && PacketAt(head, i + kPacket)) {
            start = i;
            break;
        }
    }
    if (!start) return false;
    int seen = 0;
    for (std::size_t i = *start; i + 3 < head.size(); i += kPacket) {
        if (!PacketAt(head, i)) return false;
        ++seen;
    }
    return seen >= 2;
}

bool LooksLikeManifest(const std::string& head) {
    static const std::regex kStart(R"(^\s*#EXTM3U)", std::regex::icase);
    static const std::regex kTags(R"(#EXT-X-|#EXTINF:)", std::regex::icase);
    const std::string text = head.substr(0, 512);
    return std::regex_search(text, kStart) || std::regex_search(text, kTags);
}

Check Classify(const Outcome& outcome) {
    Check check;
    const auto verdict = [&](const char* name, std::string detail, const char* transport = "") {
        check.verdict = name;
        check.ok = check.verdict == "working";
        check.transport = transport;
        check.detail = std::move(detail);
        return check;
    };
    if (outcome.timedOut) {
        // Apart from "unreachable" on purpose: a dead slot opens the socket and never sends video, and telling
        // someone their connection is broken while other channels play sends them after the wrong fault.
        return verdict("silent", "The provider accepted the connection but sent no video. This channel is listed but is not broadcasting.");
    }
    if (!outcome.networkError.empty()) {
        return verdict("unreachable", "Could not reach the provider (" + outcome.networkError + ").");
    }
    const unsigned status = outcome.status.value_or(0);
    const std::string code = std::to_string(status);
    if (status == 401 || status == 403) {
        return verdict("unauthorized", "The provider refused this channel (" + code +
                                           "). Usually the subscription does not include it, or too many devices are streaming at once.");
    }
    if (status == 404 || status == 410) return verdict("missing", "This channel is gone from the provider (" + code + ").");
    if (outcome.status && (status < 200 || status >= 300) && status != 206) {
        return verdict("unreachable", "The provider answered " + code + ".");
    }
    if (outcome.head.empty()) return verdict("empty", "The provider accepted the request but sent no data.");
    if (LooksLikeTransportStream(outcome.head)) {
        // These are the video bytes. Nothing further needs to succeed.
        return verdict("working", "Playing \xE2\x80\x94 MPEG-TS video is streaming.", "mpegts");
    }
    if (LooksLikeManifest(outcome.head)) {
        if (outcome.manifestEmpty) {
            return verdict("offline", "The channel exists but is not broadcasting right now (its playlist is empty).", "hls");
        }
        if (!outcome.segmentTried || !outcome.segmentStatus) {
            return verdict("offline", "The channel listing loaded, but its video could not be fetched.", "hls");
        }
        const unsigned segment = *outcome.segmentStatus;
        if (segment == 401 || segment == 403) {
            return verdict("unauthorized", "The listing loaded but the video was refused (" + std::to_string(segment) +
                                               "). The subscription probably does not cover this channel.", "hls");
        }
        if (segment < 200 || segment >= 300) {
            return verdict("offline", "The channel is listed but its video answered " + std::to_string(segment) + ".", "hls");
        }
        if (outcome.segmentBytes == 0) return verdict("offline", "The channel is listed but sent no video.", "hls");
        return verdict("working", "Playing \xE2\x80\x94 HLS video is streaming.", "hls");
    }
    // A 200 that is neither is almost always a page saying the account is over its limit.
    static const std::regex kHtml(R"(^\s*(<!doctype html|<html))", std::regex::icase);
    const bool html = std::regex_search(outcome.head.substr(0, 200), kHtml);
    return verdict("unplayable", html ? "The provider returned a web page instead of video, which usually means the account is blocked or over its device limit."
                                      : "The provider returned data that is not video.");
}

std::string VerdictLine(const Report& report) {
    if (report.checked == 0) return "No channels were checked.";
    std::size_t silent = 0;
    std::size_t unauthorized = 0;
    std::size_t unreachable = 0;
    for (const Check& check : report.results) {
        if (check.verdict == "silent" || check.verdict == "offline") ++silent;
        if (check.verdict == "unauthorized") ++unauthorized;
        if (check.verdict == "unreachable") ++unreachable;
    }
    const std::string checked = std::to_string(report.checked);
    if (report.working == report.checked) return "Live TV is working. All " + checked + " channels checked are streaming.";
    if (report.working > 0) {
        const std::size_t dead = report.checked - report.working;
        const std::string because = silent == dead ? "the other " + std::to_string(dead) + " are listed but not broadcasting"
                                                   : "the other " + std::to_string(dead) + " are dead entries on the provider's side";
        return "Live TV is working. " + std::to_string(report.working) + " of " + checked + " channels checked are streaming; " +
               because + ", which is normal for a list this size.";
    }
    if (unauthorized > 0) {
        return "Live TV is not working: the provider refused every channel checked. The subscription, username or password is "
               "being rejected, or too many devices are already streaming.";
    }
    if (unreachable == report.checked) {
        return "Live TV is not working: the provider could not be reached at all. Check the connection and the panel address.";
    }
    if (silent == report.checked) {
        return "None of the " + checked + " channels checked are broadcasting right now. The provider answered, so the connection "
               "and subscription are fine \xE2\x80\x94 try a different group.";
    }
    return "Live TV is not working: none of the " + checked + " channels checked returned video.";
}

std::string VerdictLabel(const std::string& verdict) {
    if (verdict == "working") return "Streaming";
    if (verdict == "unauthorized") return "Refused";
    if (verdict == "missing") return "Gone";
    if (verdict == "offline" || verdict == "silent") return "Not on air";
    if (verdict == "empty") return "No data";
    if (verdict == "unplayable") return "Not video";
    return "Unreachable";
}

Outcome Probe(const std::string& url) {
    Outcome outcome;
    const http::PeekResult first = http::Peek(url, kHeadBytes, kTimeoutMs);
    outcome.status = first.status;
    outcome.networkError = first.networkError;
    outcome.timedOut = first.timedOut;
    outcome.head = first.head;
    if (!first.status || !LooksLikeManifest(first.head)) return outcome;

    // HLS: the manifest proves nothing, so its first segment is fetched. A master playlist names a variant
    // playlist first, which is followed once.
    std::string base = url;
    std::string manifest = first.head;
    for (int hop = 0; hop < 2; ++hop) {
        const std::optional<std::string> uri = FirstUri(manifest);
        if (!uri) {
            outcome.manifestEmpty = true;
            return outcome;
        }
        const std::string next = Resolve(base, *uri);
        const http::PeekResult segment = http::Peek(next, 64 * 1024, kTimeoutMs);
        if (hop == 0 && segment.status && LooksLikeManifest(segment.head)) {
            base = next;
            manifest = segment.head;
            continue;
        }
        outcome.segmentTried = true;
        outcome.segmentStatus = segment.status;
        outcome.segmentBytes = segment.head.size();
        return outcome;
    }
    return outcome;
}

}  // namespace tvm::livecheck
