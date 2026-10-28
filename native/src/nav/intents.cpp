#include "nav/intents.h"

namespace tvm::nav {

namespace {

// Win32 virtual-key codes (winuser.h).
constexpr unsigned kBack = 0x08;
constexpr unsigned kReturn = 0x0D;
constexpr unsigned kPause = 0x13;
constexpr unsigned kEscape = 0x1B;
constexpr unsigned kSpace = 0x20;
constexpr unsigned kHome = 0x24;
constexpr unsigned kLeft = 0x25;
constexpr unsigned kUp = 0x26;
constexpr unsigned kRight = 0x27;
constexpr unsigned kDown = 0x28;
constexpr unsigned kApps = 0x5D;
constexpr unsigned kVolumeMute = 0xAD;
constexpr unsigned kVolumeDown = 0xAE;
constexpr unsigned kVolumeUp = 0xAF;
constexpr unsigned kMediaNextTrack = 0xB0;
constexpr unsigned kMediaPrevTrack = 0xB1;
constexpr unsigned kMediaStop = 0xB2;
constexpr unsigned kMediaPlayPause = 0xB3;
constexpr unsigned kBrowserBack = 0xA6;
constexpr unsigned kBrowserHome = 0xAC;
constexpr unsigned kPlay = 0xFA;

}  // namespace

bool IsDirectional(Intent intent) {
    return intent == Intent::Up || intent == Intent::Down || intent == Intent::Left || intent == Intent::Right;
}

std::optional<Intent> IntentFromKey(const KeyInput& key) {
    if (key.ctrl || key.alt || key.meta) return std::nullopt;

    switch (key.virtualKey) {
    case kUp:
        return Intent::Up;
    case kDown:
        return Intent::Down;
    case kLeft:
        return Intent::Left;
    case kRight:
        return Intent::Right;
    case kReturn:
    case kSpace:
        return Intent::Select;
    case kEscape:
    case kBack:
    case kBrowserBack:
        return Intent::Back;
    case kHome:
    case kBrowserHome:
        return Intent::Home;
    case kMediaPlayPause:
        return Intent::PlayPause;
    case kPlay:
        return Intent::Play;
    case kPause:
        return Intent::Pause;
    case kMediaStop:
        return Intent::Stop;
    case kMediaNextTrack:
        return Intent::Next;
    case kMediaPrevTrack:
        return Intent::Previous;
    case kVolumeUp:
        return Intent::VolumeUp;
    case kVolumeDown:
        return Intent::VolumeDown;
    case kVolumeMute:
        return Intent::Mute;
    case kApps:
        return Intent::Info;
    default:
        return std::nullopt;
    }
}

}  // namespace tvm::nav
