# Native Windows Packaged Assets

## Lighthouse background (`lighthouse.jpg`)

`lighthouse.jpg` is a real photograph of Point Arena Lighthouse by Matt McIntosh / NOAA, photographed on 22 June 2016. It is a U.S. federal government work, marked public domain under `PD-US-NOAA` on Wikimedia Commons. The Flickr Public Domain Mark was independently reviewed by Commons on 22 November 2020.

The packaged JPEG is a centred 16:9 crop, resized to `1280 × 720` and encoded at quality 83 (copied from `apps/roku/images/lighthouse.jpg`). It is used as the permanent missing-art fallback for Home hero artwork and for snapshot verification fixtures.

- [Commons source and public-domain declaration](https://commons.wikimedia.org/wiki/File:GFNMS_-_Visitors_at_Point_Arena_Lighthouse_(28250724586).jpg)
- [Original NOAA National Marine Sanctuaries photograph](https://www.flickr.com/photos/onms/28250724586)
- [Public Domain Mark 1.0](https://creativecommons.org/publicdomain/mark/1.0/)

## Inter typeface (`fonts/Inter-Regular.otf`, `fonts/Inter-SemiBold.otf`, `fonts/Inter-Bold.otf`)

Inter Regular, SemiBold and Bold (release v3.19 by Rasmus Andersson / The Inter Project Authors) are distributed under the SIL Open Font License 1.1 (`fonts/OFL.txt`). They are loaded privately by the DirectWrite backend (`IDWriteFactory3` / `IDWriteFontSetBuilder` or `AddFontResourceExW(..., FR_PRIVATE, ...)`) so TVM renders the 10-foot type ramp (`72 / 48 / 30 / 24 / 22`) in Inter without modifying system fonts, falling back to `Segoe UI Variable Display` / `Segoe UI` if unavailable.

## Application icon (`tvm.ico`, `tvm-icon.png`)

The existing TVM application mark rasters used for the Win32 window class icon and brand sting.
