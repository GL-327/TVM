#include "ui/live_tv_view.h"

#include <algorithm>
#include <map>
#include <optional>
#include <set>
#include <utility>

namespace tvm::ui {

namespace {

// The copy follows the Node screens.
constexpr char kLoading[] = "Loading Live TV...";
constexpr char kNotConfigured[] = "Add a Live TV login, or a playlist you are allowed to use.";
constexpr char kUnreachable[] = "The channels could not be loaded. Check the connection, then choose Retry.";
constexpr char kInvalid[] = "No live source connected. The playlist could not be read.";
constexpr char kEmpty[] = "No live source connected. Choose Login to add a live TV login, or a playlist.";
constexpr char kNothingToChoose[] = "Add a live TV login or a playlist first, then choose the channels you watch.";
// The check mark in front of a channel that is picked, in UTF-8.
constexpr char kPickedMark[] = "\xE2\x9C\x93 ";

TopButton LoginButton() {
    Command command;
    command.name = "live-xtream";
    return TopButton{"Login", command};
}

TopButton PlaylistButton() {
    Command command;
    command.name = "live-playlist";
    return TopButton{"Playlist", command};
}

TopButton ActionButton(const std::string& label, const std::string& action) {
    Command command;
    command.name = action;
    command.action = true;
    return TopButton{label, command};
}

// The channels in rails, one rail per group, in the order the groups first appear.
std::vector<RailData> GroupedRails(const std::vector<catalog::LiveChannel>& channels, const std::set<std::string>& picked,
                                   bool marks) {
    std::vector<std::string> order;
    std::map<std::string, RailData> rails;
    for (const catalog::LiveChannel& channel : channels) {
        const std::string group = live::GroupOf(channel);
        if (!rails.contains(group)) {
            order.push_back(group);
            RailData rail;
            rail.id = "live-" + group;
            rail.title = group;
            rails[group] = rail;
        }
        CardData card;
        card.itemId = channel.id;
        card.title = marks && picked.contains(channel.id) ? kPickedMark + channel.name : channel.name;
        card.posterUrl = channel.logo.value_or("");
        rails[group].cards.push_back(card);
    }

    std::vector<RailData> out;
    for (const std::string& group : order) out.push_back(std::move(rails[group]));
    return out;
}

std::string WithMessage(std::string text, const std::string& message) {
    if (message.empty()) return text;
    return text.empty() ? message : text + " " + message;
}

}  // namespace

SceneView LiveTvView(const LiveTvState& state) {
    SceneView view;
    view.cardAction = CardAction::Play;

    if (!state.loaded) {
        view.status = kLoading;
        view.topButtons = {LoginButton(), PlaylistButton()};
        return view;
    }

    const live::Status status = live::Compose(state.catalog, state.picks);
    const std::set<std::string> picked(state.picks.begin(), state.picks.end());

    if (state.choosing) {
        view.cardAction = CardAction::TogglePick;
        view.topButtons = {ActionButton("Done", "live-watch"), LoginButton(), PlaylistButton()};
        std::string lede = status.total == 0
                               ? std::string(kNothingToChoose)
                               : std::to_string(status.picked) + " of " + std::to_string(live::kPickLimit) +
                                     " on Live TV · " + std::to_string(status.total) +
                                     " in the playlist. Same lineup on this computer and Roku.";
        view.status = WithMessage(lede, state.message);
        view.rails = GroupedRails(state.catalog.channels, picked, true);
        return view;
    }

    // Watching. A source that cannot be read is said so, with a way to try again.
    if (!status.configured) {
        view.status = kNotConfigured;
        view.topButtons = {LoginButton(), PlaylistButton()};
        return view;
    }
    if (status.error == "unreachable") {
        view.status = kUnreachable;
        view.topButtons = {ActionButton("Retry", "live-reload"), LoginButton(), PlaylistButton()};
        return view;
    }
    if (status.needsPicks) {
        view.status = WithMessage("", std::to_string(status.total) + " channels in the playlist. Choose up to " +
                                          std::to_string(live::kPickLimit) + " to show here.");
        view.topButtons = {ActionButton("Choose channels", "live-choose"), LoginButton(), PlaylistButton()};
        return view;
    }
    if (status.shown.empty()) {
        view.status = status.error == "invalid" ? std::string(kInvalid) : std::string(kEmpty);
        view.topButtons = {LoginButton(), PlaylistButton()};
        return view;
    }

    std::string lede = status.total > 0 ? std::to_string(status.shown.size()) + " of " + std::to_string(status.total) +
                                              " channels on Live TV."
                                        : std::to_string(status.shown.size()) + " channels.";
    view.status = WithMessage(lede, state.message);
    // LiveTV.tsx offers the channel check beside the channels, once there are some to check.
    Command check;
    check.name = "live-check";
    view.topButtons = {ActionButton("Choose channels", "live-choose"), LoginButton(), PlaylistButton(),
                       TopButton{"Check channels", check}};
    view.rails = GroupedRails(status.shown, picked, false);
    return view;
}

}  // namespace tvm::ui
