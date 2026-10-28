#pragma once

// The Live TV channel screen's contents for a catalogue and its picks: the status line, the
// rails of channels, the top buttons, and what OK does on a channel. The app keeps the
// catalogue, the picks and the mode, and passes them here. Ported from apps/ui/src/screens/LiveTV.tsx
// and LivePicks.tsx, with the choose-channels page shown as a mode of the same screen.

#include <string>
#include <vector>

#include "catalog/live.h"
#include "ui/scene.h"

namespace tvm::ui {

struct LiveTvState {
    // The catalogue has been read. Until then the screen says it is loading.
    bool loaded = false;
    // The channels are being chosen, rather than watched.
    bool choosing = false;
    live::Catalog catalog;
    // The picks, already limited to the catalogue and to live::kPickLimit.
    std::vector<std::string> picks;
    // The last refusal, such as the limit on picks. Empty when there is none.
    std::string message;
};

SceneView LiveTvView(const LiveTvState& state);

}  // namespace tvm::ui
