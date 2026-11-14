# TVM Android icon assets

Made from the original artwork, `native/assets/tvm-icon.png`, by `build-icons.py`.

The white logo is separated from its gradient by linear unmixing, so the lettering, trail and star keep their own edges; nothing is redrawn or distorted. Each version is then centred with even spacing on a square canvas with sharp corners.

| File | What it is |
| --- | --- |
| `TVM_Icon_1024.png`, `TVM_Icon_512.png` | The normal icon: the original gradient, with the logo centred and inset (no rounded corners baked in). |
| `TVM_Glass_1024.png`, `TVM_Glass_512.png` | Transparent icon for Samsung Good Lock and glass themes. It is only the logo, filled with the TVM violet→blue→cyan gradient, on a fully transparent canvas. It is not used as the launcher icon. |

## Launcher (`app/src/main/res`)

- `drawable/ic_launcher_background.png`: the full-bleed gradient layer.
- `drawable/ic_launcher_foreground.png`: the transparent logo layer, kept inside the adaptive-icon safe circle (66 of 108 dp), so circle, squircle and One UI masks never crop it.
- `drawable/ic_launcher_monochrome.png`: the same logo, for Android 13+ themed icons.
- `mipmap-anydpi-v26/ic_tvm_launcher.xml` (and `_round`): the adaptive icon the manifest uses.
- `mipmap-*/ic_tvm_launcher.png`: legacy sizes taken from the 1024 master.

CI builds get a rising `versionCode` (4 + the workflow run number), so an installed update is a new version to Android and its launcher refreshes the cached icon.
