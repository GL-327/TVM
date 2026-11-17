# Packaged photography

## Lighthouse background

`lighthouse.jpg` is a real photograph of Point Arena Lighthouse by Matt McIntosh / NOAA, photographed on 22 June 2016. It is a U.S. federal government work, marked public domain under PD-US-NOAA on Wikimedia Commons. The Flickr Public Domain Mark was independently reviewed by Commons on 22 November 2020.

The packaged JPEG is a centred 16∶9 crop, resized to 1280 × 720 and encoded at quality 83. It is used as the permanent fallback for missing Home artwork and for the Lighthouse ambient background preference.

- [Commons source and public-domain declaration](https://commons.wikimedia.org/wiki/File:GFNMS_-_Visitors_at_Point_Arena_Lighthouse_(28250724586).jpg)
- [Original NOAA National Marine Sanctuaries photograph](https://www.flickr.com/photos/onms/28250724586)
- [Public Domain Mark](https://creativecommons.org/publicdomain/mark/1.0/)

Home hero and media-card images are loaded from the live catalogue. Ambient backgrounds reuse the current hero with a 96 × 54 decode. The supplied design mockups are visual references.

## Material textures

The antialiased glass, masks and glyphs are deterministic UI primitives produced by the checked-in scripts. They contain no photographic content. Glass uses `make-glass.mjs`, a 4 × 4 supersampled signed-distance renderer with one top-left light source and Roku 9-patch guides.

## Inter

Inter Regular, SemiBold and Bold are distributed under the SIL Open Font License 1.1. `fonts/OFL.txt` contains the licence. SemiBold comes from the official rsms/inter 3.19 release tag. `scripts/sync-assets.mjs` pins its source and SHA-256 `8c1990b6012254ea2b487161697d107357dd0ee55811cfd91c8c11227bbef457`.

The existing TVM app-logo rasters are resized to 512 ? 512 and 128 ? 128 to fit their actual display roles and keep the package budget.
