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
    // The boost filter's starting gain, from BoostGain.
    double boost = 1.0;
};

// The audio filter that makes the sound louder than the file's own level: a gain, then a limiter that
// holds the peaks just under full scale. mpv's own volume is cubic past 100% and clips the sound into
// noise long before it gets much louder, so it is kept at 100% and the boost happens here instead.
std::string BoostFilter(double gain);
// The boost filter's gain for a volume from 0 to 10. Nothing up to 1, then steeper than the slider, so
// 200% is 3x, 400% is 9x and 1000% is 40x (+32 dB): as loud as a browser volume booster, without its clipping.
double BoostGain(double volume);

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
std::optional<std::filesystem::path> FindMpvExecutable(const util::EnvLookup& env);

// The properties TVM watches. `cache-buffering-state` is a percentage, so `paused-for-cache` is the
// one that means "stalled".
inline constexpr const char* kObservedProperties[] = {"time-pos", "duration", "pause", "paused-for-cache",
                                                      "eof-reached", "track-list", "speed", "cache-speed", "demuxer-cache-duration", "cache-buffering-state"};

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
    // A subtitle shown only for foreign speech.
    bool forced = false;


    bool operator==(const Track&) const = default;
};

// A track's name for a menu: its language in words ("English", not "eng"), then what its title adds, such as
// "English Â· SDH" or "English (Forced)". With no language, its title, else "Track N".
std::string TrackLabel(const Track& track);
// An ISO 639-1 or 639-2 code in words: "en" and "eng" are "English". Empty when the code is not known.
std::string LanguageName(const std::string& code);
// An audio track's format in words for the menu: "Dolby Digital+ Â· 5.1", "Stereo". Raw codec names that mean
// nothing to a viewer (aac, opus) are left out.
std::string AudioDetail(const Track& track);

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
    double cacheSpeed = 0;
    double cacheSeconds = 0;
    double bufferPercent = 0;

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
