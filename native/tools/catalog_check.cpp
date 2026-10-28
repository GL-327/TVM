// tvm-catalog-check: fetches the real Cinemeta catalogue and one title, and
// prints what the native mapping made of them. It needs the internet. It writes
// only to a temporary folder, so it never touches the viewer's data.
//
// Usage: tvm-catalog-check [imdb-id]    (default tt0111161)

#include <windows.h>

#include <cstdio>
#include <filesystem>
#include <string>

#include "catalog/catalog_service.h"
#include "catalog/cinemeta.h"
#include "core/util.h"

int main(int argc, char** argv) {
    namespace fs = std::filesystem;
    const std::string id = argc > 1 ? argv[1] : "tt0111161";

    const fs::path folder = fs::temp_directory_path() / (L"tvm-catalog-check-" + std::to_wstring(GetCurrentProcessId()));
    fs::create_directories(folder);
    try {
        tvm::catalog::CatalogService service(folder);

        const tvm::catalog::CatalogBundle bundle = service.Bundle();
        auto show = [](const char* name, const std::vector<tvm::catalog::MediaItem>& items) {
            std::printf("%-14s %3zu", name, items.size());
            if (!items.empty()) std::printf("  first: %s", items.front().title.c_str());
            std::printf("\n");
        };
        show("moviesTop", bundle.moviesTop);
        show("seriesTop", bundle.seriesTop);
        show("moviesRated", bundle.moviesRated);
        show("seriesRated", bundle.seriesRated);
        show("recentTv", bundle.recentTv);
        show("newFilms", bundle.newFilms);
        show("catalog", bundle.catalog);

        std::size_t genreItems = 0;
        for (const auto& rail : tvm::catalog::GenreRails()) {
            genreItems += service.Genre("movie", rail.genre).size();
        }
        std::printf("%-14s %3zu across %zu genre rails\n", "genres(movie)", genreItems, tvm::catalog::GenreRails().size());

        const auto meta = service.Meta(id);
        if (!meta.has_value()) {
            std::printf("meta %s: not found\n", id.c_str());
        } else {
            const auto& item = meta->item;
            std::printf("meta %s: %s (%s) kind=%s rating=%s genres=%zu episodes=%zu\n", id.c_str(), item.title.c_str(),
                        item.year.has_value() ? std::to_string(*item.year).c_str() : "no year", item.kind.c_str(),
                        item.rating.c_str(), item.genres.size(), meta->children.size());
            std::printf("  poster:   %s\n", item.poster.c_str());
            std::printf("  backdrop: %s\n", item.backdrop.c_str());
            std::printf("  synopsis: %zu characters\n", item.synopsis.size());
        }
    } catch (const std::exception& error) {
        std::printf("failed: %s\n", error.what());
        std::error_code ignored;
        fs::remove_all(folder, ignored);
        return 1;
    }
    std::error_code ignored;
    fs::remove_all(folder, ignored);
    return 0;
}
