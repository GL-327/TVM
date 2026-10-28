#include "catalog/media_item.h"

namespace tvm::catalog {


nlohmann::json ToJson(const MediaItem& item) {
    nlohmann::json json;
    json["id"] = item.id;
    json["title"] = item.title;
    json["year"] = item.year.has_value() ? nlohmann::json(*item.year) : nlohmann::json(nullptr);
    json["kind"] = item.kind;
    json["synopsis"] = item.synopsis;
    json["poster"] = item.poster;
    json["backdrop"] = item.backdrop;
    json["genres"] = item.genres;
    json["rating"] = item.rating;
    if (item.runtime.has_value()) json["runtime"] = *item.runtime;
    json["playable"] = item.playable;
    json["hue"] = item.hue;
    if (item.season.has_value()) json["season"] = *item.season;
    if (item.episode.has_value()) json["episode"] = *item.episode;
    if (item.episodeName.has_value()) json["episodeName"] = *item.episodeName;
    if (item.showTitle.has_value()) json["showTitle"] = *item.showTitle;
    if (item.aired.has_value()) json["aired"] = *item.aired;
    if (item.filename.has_value()) json["filename"] = *item.filename;
    if (item.mimeType.has_value()) json["mimeType"] = *item.mimeType;
    return json;
}

std::optional<MediaItem> FromJson(const nlohmann::json& value) {
    if (!value.is_object()) return std::nullopt;
    const auto id = value.find("id");
    const auto title = value.find("title");
    if (id == value.end() || !id->is_string() || title == value.end() || !title->is_string()) return std::nullopt;

    MediaItem item;
    item.id = id->get<std::string>();
    item.title = title->get<std::string>();
    if (const auto year = value.find("year"); year != value.end() && year->is_number_integer()) {
        item.year = year->get<int>();
    }
    if (const auto kind = value.find("kind"); kind != value.end() && kind->is_string()) {
        item.kind = kind->get<std::string>();
    }
    if (const auto synopsis = value.find("synopsis"); synopsis != value.end() && synopsis->is_string()) {
        item.synopsis = synopsis->get<std::string>();
    }
    if (const auto poster = value.find("poster"); poster != value.end() && poster->is_string()) {
        item.poster = poster->get<std::string>();
    }
    if (const auto backdrop = value.find("backdrop"); backdrop != value.end() && backdrop->is_string()) {
        item.backdrop = backdrop->get<std::string>();
    }
    if (const auto genres = value.find("genres"); genres != value.end() && genres->is_array()) {
        for (const auto& genre : *genres) {
            if (genre.is_string()) item.genres.push_back(genre.get<std::string>());
        }
    }
    if (const auto rating = value.find("rating"); rating != value.end() && rating->is_string()) {
        item.rating = rating->get<std::string>();
    }
    if (const auto runtime = value.find("runtime"); runtime != value.end() && runtime->is_string()) {
        item.runtime = runtime->get<std::string>();
    }
    if (const auto playable = value.find("playable"); playable != value.end() && playable->is_boolean()) {
        item.playable = playable->get<bool>();
    }
    if (const auto hue = value.find("hue"); hue != value.end() && hue->is_number_integer()) {
        item.hue = hue->get<int>();
    }
    if (const auto season = value.find("season"); season != value.end() && season->is_number_integer()) {
        item.season = season->get<int>();
    }
    if (const auto episode = value.find("episode"); episode != value.end() && episode->is_number_integer()) {
        item.episode = episode->get<int>();
    }
    if (const auto name = value.find("episodeName"); name != value.end() && name->is_string()) {
        item.episodeName = name->get<std::string>();
    }
    if (const auto show = value.find("showTitle"); show != value.end() && show->is_string()) {
        item.showTitle = show->get<std::string>();
    }
    if (const auto aired = value.find("aired"); aired != value.end() && aired->is_string()) {
        item.aired = aired->get<std::string>();
    }
    if (const auto filename = value.find("filename"); filename != value.end() && filename->is_string()) {
        item.filename = filename->get<std::string>();
    }
    if (const auto mimeType = value.find("mimeType"); mimeType != value.end() && mimeType->is_string()) {
        item.mimeType = mimeType->get<std::string>();
    }
    return item;
}

}  // namespace tvm::catalog
