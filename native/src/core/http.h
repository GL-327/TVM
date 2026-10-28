#pragma once

// HTTPS requests through WinHTTP, which ships with Windows. Nothing is installed,
// and the operating system's certificate checks apply. Request headers and
// bodies are never logged, because some of them carry tokens.

#include <cstddef>
#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

namespace tvm::http {

struct Response {
    unsigned status = 0;
    std::string body;

    bool ok() const { return status >= 200 && status < 300; }
    // The Location header, when redirects are not followed. Empty otherwise.
    std::string location;
    std::string contentType;
};

struct Options {
    unsigned timeoutMs = 12000;
    std::string userAgent = "tvm-core";
    std::string accept = "*/*";
    // A response larger than this is refused, so a hostile server cannot fill memory.
    std::size_t maxBytes = 16 * 1024 * 1024;
    // GET or POST.
    std::string method = "GET";
    // Extra request headers as name and value pairs. Values can be secrets.
    std::vector<std::pair<std::string, std::string>> headers;
    // The request body, sent as it is. Empty for GET.
    std::string body;
    // False returns a redirect as it is, with its Location, and reads no body for it. The
    // Torrentio resolver answers with a redirect whose target has to be checked before use.
    bool followRedirects = true;
};

// Returns the response, whatever its status. Returns nothing when the request
// could not be made or finished: no network, a timeout, a bad certificate, a
// body over `maxBytes`, or a header with a line break in it.
std::optional<Response> Send(const std::string& url, const Options& options = {});

// Send with the GET method.
std::optional<Response> Get(const std::string& url, const Options& options = {});

// Sends one request and returns the answer, or nothing when no answer came back. The
// providers take their network through this, so tests can answer from a fake.
using Transport = std::function<std::optional<Response>(const std::string& url, const Options& options)>;

// Only https:// and http:// URLs are accepted.
bool IsWebUrl(const std::string& url);

// A file fetched to disk, for Downloads: the status, the bytes written, and whether it was stopped.
struct DownloadResult {
    unsigned status = 0;
    unsigned long long bytes = 0;
    bool cancelled = false;
    bool ok() const { return status >= 200 && status < 300 && !cancelled; }
};

// Streams a response body into `file`, following redirects, calling `progress` with the bytes so far and
// the length when the server gives one (else 0). Returning false from `progress` stops it. A download that
// does not finish leaves no file behind.
// The first bytes of an answer, for the channel check: a live stream never ends, so only its head is read.
struct PeekResult {
    // Nothing when no answer came at all.
    std::optional<unsigned> status;
    std::string contentType;
    std::string head;
    // The connection opened but no data came in time.
    bool timedOut = false;
    // Why the request failed before an answer, such as a refused connection.
    std::string networkError;
};

PeekResult Peek(const std::string& url, std::size_t maxBytes, unsigned timeoutMs);

DownloadResult Download(const std::string& url, const std::filesystem::path& file,
                        const std::function<bool(unsigned long long done, unsigned long long total)>& progress,
                        unsigned timeoutMs = 30000);

}  // namespace tvm::http
