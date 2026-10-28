#pragma once

// Artwork addresses. Ported from apps/core/src/providers/artwork.ts: catalogue
// images are normalised to https and upgraded to the largest size the CDN
// serves, and a missing poster falls back to the IMDb still for the title.

#include <string>

namespace tvm::catalog {

// The first "tt" followed by digits, lower-cased. Nothing when there is none.
std::string ImdbIdFrom(const std::string& value);

std::string MetahubPoster(const std::string& imdb);
std::string MetahubBackdrop(const std::string& imdb);

// Makes a catalogue or CDN address a real https image address.
std::string NormalizeArtUrl(const std::string& url);

// Normalises and upgrades an image address to the large size for its kind.
std::string UpgradeImageUrl(const std::string& url, bool backdrop);

std::string PreferBackdrop(const std::string& id, const std::string& backdrop, const std::string& poster);
std::string PreferPoster(const std::string& id, const std::string& poster, const std::string& backdrop);

}  // namespace tvm::catalog
