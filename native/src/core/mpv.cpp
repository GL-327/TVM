#include "core/mpv.h"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <iomanip>
#include <locale>
#include <set>
#include <sstream>

namespace tvm::mpv {

namespace {

std::filesystem::path EnvPath(const util::EnvLookup& env, const wchar_t* name) {
    const std::optional<std::wstring> value = env(name);
    return value.has_value() ? std::filesystem::path(*value) : std::filesystem::path();
}

}  // namespace

std::string BoostFilter(double gain) {
    std::ostringstream filter;
    filter.imbue(std::locale::classic());
    // The limit is -1 dBFS, and the release is slow enough that speech does not pump.
    filter << "@tvmboost:lavfi=[volume=volume=" << std::fixed << std::setprecision(2) << gain
           << ":precision=float,alimiter=limit=0.89:attack=5:release=80:level=disabled]";
    return filter.str();
}

double BoostGain(double volume) {
    return std::pow(std::clamp(volume, 1.0, 10.0), 1.6);
}

std::vector<std::string> BuildArgs(const LaunchOptions& options) {
    std::vector<std::string> args = {
        "--input-ipc-server=" + options.ipcPath,
        "--wid=" + options.windowId,
        "--no-terminal",
        "--really-quiet",
        "--no-config",
        options.ytdlpPath.empty() ? "--ytdl=no" : "--ytdl=yes",
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
        "--hls-bitrate=max",
        // mpv's volume stops at 100%. Louder than that is the boost filter's job.
        "--volume-max=100",
        "--af=" + BoostFilter(options.boost),
    };
    if (!options.ytdlpPath.empty()) {
        args.push_back("--script-opts-append=ytdl_hook-ytdl_path=" + options.ytdlpPath);
    }
    if (!options.audioLanguage.empty()) args.push_back("--alang=" + options.audioLanguage);
    if (options.startAt.has_value() && std::isfinite(*options.startAt) && *options.startAt > 0.0) {
        std::ostringstream start;
        start << "--start=" << *options.startAt;
        args.push_back(start.str());
    }
    args.push_back("--");
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

std::optional<std::filesystem::path> FindMpvExecutable(const util::EnvLookup& env) {
    for (const std::filesystem::path& path : CandidatePaths(env)) {
        std::error_code error;
        if (std::filesystem::is_regular_file(path, error)) return path;
    }
    return std::nullopt;
}

VideoClicks::Action VideoClicks::Click(double now, int x, int y, int toleranceX, int toleranceY) {
    if (deadline_ && now < *deadline_ && std::abs(x - x_) <= toleranceX && std::abs(y - y_) <= toleranceY) {
        Cancel();
        return Action::Fullscreen;
    }
    const bool previous = deadline_.has_value();
    x_ = x;
    y_ = y;
    deadline_ = now + delayMs_;
    return previous ? Action::Pause : Action::None;
}

VideoClicks::Action VideoClicks::Tick(double now) {
    if (!deadline_ || now < *deadline_) return Action::None;
    Cancel();
    return Action::Pause;
}

double VideoClicks::Wait(double now, double otherwise) const {
    return deadline_ ? std::min(otherwise, std::max(0.0, *deadline_ - now)) : otherwise;
}

std::optional<double> AdjacentChapter(const std::vector<Chapter>& chapters, double position, int direction) {
    if (direction > 0) {
        for (const auto& chapter : chapters) if (chapter.time > position + 0.25) return chapter.time;
    } else {
        for (auto chapter = chapters.rbegin(); chapter != chapters.rend(); ++chapter)
            if (chapter->time < position - 3.0) return chapter->time;
        if (!chapters.empty() && position > 0) return chapters.front().time;
    }
    return std::nullopt;
}

bool SameLanguage(const std::string& left, const std::string& right) {
    if (left.empty() || right.empty()) return false;
    const auto name = LanguageName(left);
    return left == right || (!name.empty() && name == LanguageName(right));
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
    } else if (name == "cache-speed" && data.is_number()) {
        state.cacheSpeed = std::max(0.0, data.get<double>());
    } else if (name == "demuxer-cache-duration" && data.is_number()) {
        state.cacheSeconds = std::max(0.0, data.get<double>());
    } else if (name == "cache-buffering-state" && data.is_number()) {
        state.bufferPercent = std::clamp(data.get<double>(), 0.0, 100.0);
    } else if (name == "chapter-list" && data.is_array()) {
        state.chapters.clear();
        for (const auto& row : data) {
            if (!row.is_object() || !row.contains("time") || !row["time"].is_number()) continue;
            const double time = row["time"].get<double>();
            if (!std::isfinite(time) || time < 0) continue;
            const auto title = row.find("title");
            state.chapters.push_back({time, title != row.end() && title->is_string() ? title->get<std::string>() : ""});
        }
        std::stable_sort(state.chapters.begin(), state.chapters.end(), [](const Chapter& a, const Chapter& b) { return a.time < b.time; });
    } else if (name == "video-params" && data.is_object()) {
        state.width = data.value("w", 0);
        state.height = data.value("h", 0);
        const auto gamma = data.value("gamma", std::string());
        state.hdr = gamma == "pq" ? "PQ (HDR)" : gamma == "hlg" ? "HLG" : "SDR";
    } else if (name == "video-format" && data.is_string()) {
        state.codec = data.get<std::string>();
    } else if (name == "file-format" && data.is_string()) {
        state.container = data.get<std::string>();
    } else if (name == "file-size" && data.is_number()) {
        state.fileBytes = data.get<double>();
    } else if (name == "video-bitrate" && data.is_number()) {
        state.bitrate = data.get<double>();
    } else if (name == "frame-drop-count" && data.is_number_integer()) {
        state.droppedFrames = data.get<int>();
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
            track.forced = raw.contains("forced") && raw["forced"].is_boolean() && raw["forced"].get<bool>();
            state.tracks.push_back(std::move(track));
        }
    }
    return state;
}

namespace {

std::string Lower(std::string text) {
    for (char& c : text) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return text;
}

std::string Trimmed(const std::string& text) {
    const std::size_t first = text.find_first_not_of(" \t-_.()[]");
    if (first == std::string::npos) return "";
    const std::size_t last = text.find_last_not_of(" \t-_.()[]");
    return text.substr(first, last - first + 1);
}

}  // namespace

std::string LanguageName(const std::string& code) {
    struct Language {
        const char* twoLetter;
        const char* threeLetter;
        const char* other;  // ISO 639-2/B where it differs from 639-2/T
        const char* name;
    };
    static constexpr Language kLanguages[] = {
        {"en", "eng", "", "English"},     {"es", "spa", "", "Spanish"},      {"fr", "fra", "fre", "French"},
        {"de", "deu", "ger", "German"},   {"it", "ita", "", "Italian"},      {"pt", "por", "", "Portuguese"},
        {"nl", "nld", "dut", "Dutch"},    {"sv", "swe", "", "Swedish"},      {"no", "nor", "nob", "Norwegian"},
        {"da", "dan", "", "Danish"},      {"fi", "fin", "", "Finnish"},      {"is", "isl", "ice", "Icelandic"},
        {"pl", "pol", "", "Polish"},      {"cs", "ces", "cze", "Czech"},     {"sk", "slk", "slo", "Slovak"},
        {"hu", "hun", "", "Hungarian"},   {"ro", "ron", "rum", "Romanian"},  {"bg", "bul", "", "Bulgarian"},
        {"el", "ell", "gre", "Greek"},    {"ru", "rus", "", "Russian"},      {"uk", "ukr", "", "Ukrainian"},
        {"tr", "tur", "", "Turkish"},     {"ar", "ara", "", "Arabic"},       {"he", "heb", "", "Hebrew"},
        {"fa", "fas", "per", "Persian"},  {"hi", "hin", "", "Hindi"},        {"bn", "ben", "", "Bengali"},
        {"ta", "tam", "", "Tamil"},       {"te", "tel", "", "Telugu"},       {"ur", "urd", "", "Urdu"},
        {"zh", "zho", "chi", "Chinese"},  {"ja", "jpn", "", "Japanese"},     {"ko", "kor", "", "Korean"},
        {"th", "tha", "", "Thai"},        {"vi", "vie", "", "Vietnamese"},   {"id", "ind", "", "Indonesian"},
        {"ms", "msa", "may", "Malay"},    {"tl", "tgl", "fil", "Filipino"},  {"hr", "hrv", "", "Croatian"},
        {"sr", "srp", "", "Serbian"},     {"sl", "slv", "", "Slovenian"},    {"et", "est", "", "Estonian"},
        {"lv", "lav", "", "Latvian"},     {"lt", "lit", "", "Lithuanian"},   {"ca", "cat", "", "Catalan"},
        {"eu", "eus", "baq", "Basque"},   {"gl", "glg", "", "Galician"},     {"ga", "gle", "", "Irish"},
        {"cy", "cym", "wel", "Welsh"},    {"sq", "sqi", "alb", "Albanian"},  {"mk", "mkd", "mac", "Macedonian"},
        {"bs", "bos", "", "Bosnian"},     {"af", "afr", "", "Afrikaans"},    {"sw", "swa", "", "Swahili"},
        {"la", "lat", "", "Latin"},
    };
    std::string key = Lower(Trimmed(code));
    // "pt-BR", "en_US": the region is left out.
    if (const std::size_t cut = key.find_first_of("-_"); cut != std::string::npos) key = key.substr(0, cut);
    if (key.empty()) return "";
    if (key == "und" || key == "unk" || key == "mul" || key == "zxx") return "";
    for (const Language& language : kLanguages) {
        if (key == language.twoLetter || key == language.threeLetter || key == language.other) return language.name;
    }
    return "";
}

std::string TrackLabel(const Track& track) {
    const std::string language = LanguageName(track.lang);
    std::string title = Trimmed(track.title);
    std::string label;
    if (!language.empty()) {
        label = language;
        // The title adds to the language only when it says something more, such as "SDH" or "Commentary".
        const std::string lowerTitle = Lower(title);
        const std::string lowerLanguage = Lower(language);
        if (!title.empty() && lowerTitle != lowerLanguage && lowerTitle != Lower(Trimmed(track.lang))) {
            std::string extra = title;
            if (lowerTitle.rfind(lowerLanguage, 0) == 0) extra = Trimmed(title.substr(language.size()));
            if (Lower(extra) == "forced" && track.forced) extra.clear();
            if (!extra.empty()) label += " \xC2\xB7 " + extra;
        }
    } else if (!title.empty()) {
        label = title;
    } else if (!Trimmed(track.lang).empty()) {
        label = Trimmed(track.lang);
        for (char& c : label) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    } else {
        label = "Track " + std::to_string(track.id);
    }
    // A long release title is cut, so the menu stays compact.
    constexpr std::size_t kLongest = 34;
    if (label.size() > kLongest) {
        std::size_t cut = kLongest;
        while (cut > 0 && (static_cast<unsigned char>(label[cut]) & 0xC0) == 0x80) --cut;
        label = label.substr(0, cut) + "\xE2\x80\xA6";
    }
    if (track.forced && Lower(label).find("forced") == std::string::npos) label += " (Forced)";
    return label;
}

std::string AudioDetail(const Track& track) {
    const std::string codec = Lower(track.codec);
    std::string format;
    if (codec == "eac3" || codec == "e-ac-3") format = "Dolby Digital+";
    else if (codec == "ac3" || codec == "ac-3") format = "Dolby Digital";
    else if (codec == "truehd" || codec == "mlp") format = "Dolby TrueHD";
    else if (codec.rfind("dts", 0) == 0 || codec == "dca") format = "DTS";
    else if (codec == "flac" || codec.rfind("pcm", 0) == 0) format = "Lossless";
    std::string layout;
    switch (track.channels) {
    case 1: layout = "Mono"; break;
    case 2: layout = "Stereo"; break;
    case 6: layout = "5.1"; break;
    case 8: layout = "7.1"; break;
    default:
        if (track.channels > 2) layout = std::to_string(track.channels) + " channels";
        break;
    }
    if (format.empty()) return layout;
    if (layout.empty()) return format;
    return format + " \xC2\xB7 " + layout;
}

std::string CommandLine(const nlohmann::json& command) {
    return nlohmann::json{{"command", command}}.dump() + "\n";
}

}  // namespace tvm::mpv
