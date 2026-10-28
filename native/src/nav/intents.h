#pragma once

// Remote input normalised into intents. Screens never read raw keys: a TV
// remote, a keyboard and a CEC bridge all send different codes for the same
// button, and only this file knows what a code means. Ported from
// packages/nav/src/intents.ts. Keys are Win32 virtual-key codes.

#include <optional>

namespace tvm::nav {

enum class Intent {
    Up,
    Down,
    Left,
    Right,
    Select,
    Back,
    Home,
    PlayPause,
    Play,
    Pause,
    Stop,
    Rewind,
    FastForward,
    Next,
    Previous,
    VolumeUp,
    VolumeDown,
    Mute,
    Info,
};

bool IsDirectional(Intent intent);

struct KeyInput {
    unsigned virtualKey;
    bool ctrl = false;
    bool alt = false;
    bool meta = false;
};

// Null for keys outside the remote's vocabulary. Ctrl, Alt and Win combinations
// are ignored so shell shortcuts keep working during development.
std::optional<Intent> IntentFromKey(const KeyInput& key);

}  // namespace tvm::nav
