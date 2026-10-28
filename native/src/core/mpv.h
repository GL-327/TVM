#pragma once

// mpv, the player the desktop app plays through. Where it is found, how it is started, and the
// bookkeeping of the properties it reports. Ported from apps/shell/src/mpv.ts and
// apps/shell/src/nativePlayerState.ts. The window and the pipe are in platform/mpv_player.

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "core/util.h"

namespace tvm::mpv {

struct LaunchOptions {
    std::string url;
    // The window mpv draws into, as a decimal number.
    std::string windowId;
    std::string ipcPath;
    std::optional<double> startAt;
};

// mpv draws into TVM's own child window, with its controls, its on-screen text and its own key
// bindings turned off, so TVM's chrome is the only one. auto-copy is the decode path that paints
// into a foreign window.
std::vector<std::string> BuildArgs(const LaunchOptions& options);

// A second mpv that writes the frame at `seconds` of `url` as a 480 pixel wide JPEG in `folder`, for the
// trickplay preview. It seeks to the nearest keyframe, which is fast, and has no window and no sound.
std::vector<std::string> BuildThumbnailArgs(const std::string& url, double seconds, const std::string& folder);

// The places TVM looks for mpv.exe, in order: TVM_MPV_PATH, the folder the old app installs it
// into, the usual install folders, then PATH.
std::vector<std::filesystem::path> CandidatePaths(const util::EnvLookup& env);
// The first candidate that exists.
std::optional<std::filesystem::path> FindExecutable(const util::EnvLookup& env);

// The properties TVM watches. `cache-buffering-state` is a percentage, so `paused-for-cache` is the
// one that means "stalled".
inline constexpr const char* kObservedProperties[] = {"time-pos", "duration", "pause", "paused-for-cache",
                                                      "eof-reached", "track-list", "speed"};

// One of the file's tracks, as mpv's track-list reports it.
struct Track {
    int id = 0;
    std::string type;  // "video", "audio" or "sub"
    std::string title;
    std::string lang;
    std::string codec;
    bool selected = false;
    // The picture's height for a video track, and the channel count for an audio track. Zero when unknown.
    int height = 0;
    int channels = 0;

    bool operator==(const Track&) const = default;
};

// A track's name for a menu: its title, else its language, else "Track N", as the web pickers name them.
std::string TrackLabel(const Track& track);

struct State {
    double position = 0.0;
    double duration = 0.0;
    bool paused = false;
    // mpv has decoded a first frame, so there is a picture on screen.
    bool started = false;
    bool pausedForCache = false;
    bool ended = false;
    std::vector<Track> tracks;
    double speed = 1.0;

    bool operator==(const State&) const = default;
};

State InitialState(std::optional<double> startAt);
State ApplyProperty(State state, const std::string& name, const nlohmann::json& data);
// A stream is not ready until mpv decodes a frame, and it stalls whenever its cache runs dry.
inline bool Buffering(const State& state) {
    return !state.started || state.pausedForCache;
}

// One JSON IPC command line, newline included.
std::string CommandLine(const nlohmann::json& command);

}  // namespace tvm::mpv
