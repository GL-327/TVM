#include "core/mpv.h"

#include <cmath>
#include <set>
#include <sstream>

namespace tvm::mpv {

namespace {

std::filesystem::path EnvPath(const util::EnvLookup& env, const wchar_t* name) {
    const std::optional<std::wstring> value = env(name);
    return value.has_value() ? std::filesystem::path(*value) : std::filesystem::path();
}

}  // namespace

std::vector<std::string> BuildArgs(const LaunchOptions& options) {
    std::vector<std::string> args = {
        "--input-ipc-server=" + options.ipcPath,
        "--wid=" + options.windowId,
        "--no-terminal",
        "--really-quiet",
        "--no-config",
        "--ytdl=no",
        "--force-window=yes",
        "--keep-open=no",
        "--hwdec=auto-copy",
        "--vo=gpu",
        "--cache=yes",
        "--cache-secs=60",
        "--cache-pause-initial=yes",
        "--cache-pause-wait=2",
        "--demuxer-max-bytes=256MiB",
        "--demuxer-max-back-bytes=64MiB",
        "--demuxer-readahead-secs=20",
        "--osc=no",
        "--osd-level=0",
        "--no-border",
        "--ontop=no",
        "--fullscreen=no",
        "--input-default-bindings=no",
        // mpv's window sits inside TVM's, so it must not take the keyboard from it.
        "--input-vo-keyboard=no",
        "--cursor-autohide=always",
        "--gpu-context=d3d11",
        // mpv's own high-quality scaling, debanding and tone mapping, so a 4K or HDR file looks as it should.
        "--profile=high-quality",
        // The sound goes to 1000%, the most mpv allows, for very quiet releases.
        "--volume-max=1000",
    };
    if (options.startAt.has_value() && std::isfinite(*options.startAt) && *options.startAt > 0.0) {
        std::ostringstream start;
        start << "--start=" << *options.startAt;
        args.push_back(start.str());
    }
    args.push_back(options.url);
    return args;
}

std::vector<std::string> BuildThumbnailArgs(const std::string& url, double seconds, const std::string& folder) {
    std::ostringstream start;
    start << "--start=" << (seconds > 0.0 ? seconds : 0.0);
    return {
        "--no-config",     "--no-terminal",          "--really-quiet",       "--ytdl=no",
        "--no-audio",      "--no-sub",               "--hr-seek=no",         start.str(),
        "--frames=1",      "--vo=image",             "--vo-image-format=jpg", "--vo-image-jpeg-quality=82",
        "--vf=scale=480:-2", "--vo-image-outdir=" + folder, url,
    };
}

std::vector<std::filesystem::path> CandidatePaths(const util::EnvLookup& env) {
    std::vector<std::filesystem::path> paths;
    const std::filesystem::path configured = EnvPath(env, L"TVM_MPV_PATH");
    if (!configured.empty()) paths.push_back(configured);

    const std::filesystem::path local = EnvPath(env, L"LOCALAPPDATA");
    const std::filesystem::path home = EnvPath(env, L"USERPROFILE");
    const std::filesystem::path programData = EnvPath(env, L"ProgramData");
    if (!local.empty()) paths.push_back(local / "TVM" / "mpv" / "mpv.exe");
    paths.push_back("C:\\Program Files\\mpv\\mpv.exe");
    paths.push_back("C:\\Program Files\\mpv.net\\mpv.exe");
    paths.push_back("C:\\mpv\\mpv.exe");
    if (!home.empty()) {
        paths.push_back(home / "scoop" / "apps" / "mpv" / "current" / "mpv.exe");
        paths.push_back(home / "scoop" / "shims" / "mpv.exe");
    }
    if (!local.empty()) {
        paths.push_back(local / "Programs" / "mpv" / "mpv.exe");
        paths.push_back(local / "Programs" / "mpv.net" / "mpv.exe");
    }
    if (!programData.empty()) paths.push_back(programData / "chocolatey" / "bin" / "mpv.exe");

    if (const std::optional<std::wstring> path = env(L"PATH")) {
        std::wstringstream dirs(*path);
        std::wstring dir;
        while (std::getline(dirs, dir, L';')) {
            if (dir.size() >= 2 && dir.front() == L'"' && dir.back() == L'"') dir = dir.substr(1, dir.size() - 2);
            if (!dir.empty()) paths.push_back(std::filesystem::path(dir) / "mpv.exe");
        }
    }

    std::vector<std::filesystem::path> unique;
    std::set<std::filesystem::path> seen;
    for (const std::filesystem::path& path : paths) {
        if (seen.insert(path).second) unique.push_back(path);
    }
    return unique;
}

std::optional<std::filesystem::path> FindExecutable(const util::EnvLookup& env) {
    for (const std::filesystem::path& path : CandidatePaths(env)) {
        std::error_code error;
        if (std::filesystem::is_regular_file(path, error)) return path;
    }
    return std::nullopt;
}

State InitialState(std::optional<double> startAt) {
    State state;
    if (startAt.has_value() && std::isfinite(*startAt) && *startAt > 0.0) state.position = *startAt;
    return state;
}

State ApplyProperty(State state, const std::string& name, const nlohmann::json& data) {
    if (name == "time-pos" && data.is_number() && std::isfinite(data.get<double>())) {
        state.position = data.get<double>();
        state.started = true;
    } else if (name == "duration" && data.is_number() && std::isfinite(data.get<double>())) {
        state.duration = data.get<double>();
    } else if (name == "pause" && data.is_boolean()) {
        state.paused = data.get<bool>();
    } else if (name == "paused-for-cache" && data.is_boolean()) {
        state.pausedForCache = data.get<bool>();
    } else if (name == "eof-reached" && data.is_boolean() && data.get<bool>()) {
        state.ended = true;
    } else if (name == "speed" && data.is_number()) {
        state.speed = data.get<double>();
    } else if (name == "track-list" && data.is_array()) {
        state.tracks.clear();
        for (const nlohmann::json& raw : data) {
            if (!raw.is_object() || !raw.contains("id") || !raw["id"].is_number_integer()) continue;
            Track track;
            track.id = raw["id"].get<int>();
            track.type = raw.value("type", "");
            track.title = raw.value("title", "");
            track.lang = raw.value("lang", "");
            track.codec = raw.value("codec", "");
            track.selected = raw.value("selected", false);
            track.height = raw.value("demux-h", 0);
            track.channels = raw.value("demux-channel-count", 0);
            state.tracks.push_back(std::move(track));
        }
    }
    return state;
}

std::string TrackLabel(const Track& track) {
    std::string label = track.title;
    if (label.empty()) label = track.lang.empty() ? "Track " + std::to_string(track.id) : track.lang;
    else if (!track.lang.empty() && label.find(track.lang) == std::string::npos) label += " (" + track.lang + ")";
    return label;
}

std::string CommandLine(const nlohmann::json& command) {
    return nlohmann::json{{"command", command}}.dump() + "\n";
}

}  // namespace tvm::mpv
