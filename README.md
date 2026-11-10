# TVM

TVM is a media app for Windows, iPhone/iPad, Android, Roku, and web browsers on phones, tablets and computers. It brings your authorised media sources, films, series and Live TV connections into one interface.

**Project owner and maintainer: [Arthur Foxall (@GL-327)](https://github.com/GL-327).** The current source lives on `main`. Electron has been retired.

## Download the current version

Get the installers from **[TVM downloads — every platform](https://github.com/GL-327/TVM/releases/tag/devices)**. GitHub's automatic “Source code” archives are for development; use the named download for your device.

- **Windows C++ desktop:** `TVM-native-windows.zip`. Extract the whole folder and run `TVM.cmd` or `tvm.exe`. Node, Core, the browser UI and artwork are included. TVM finds an existing mpv player or installs a portable Windows build after checking its published checksum.
- **macOS/Linux desktop:** `TVM-desktop.zip`. Install Node.js 22+, extract it, then open `TVM.command` on macOS or run `chmod +x TVM.sh && ./TVM.sh` on Linux. TVM opens in your browser. Install ffmpeg for media that needs browser conversion.
- **Web browser, mobile or desktop:** `TVM-web.zip`. Install Node.js 22+ on the computer hosting TVM. Extract it and run `TVM-web.cmd` on Windows or `chmod +x TVM-web.sh && ./TVM-web.sh` on macOS/Linux. Open `http://127.0.0.1:7345/` on that computer. The layout adapts to screen size, touch and rotation. Phones connecting to that computer need the authenticated LAN setup below.
- **Android:** `TVM.apk`. Install it on your phone/tablet or sideload it onto Android TV. It contains its own Core and browser UI. Android may ask you to allow installation from the source you used.
- **iPhone/iPad:** `TVM.ipa`. This GitHub IPA needs signing with your Apple account/team through a suitable sideloading tool before installation. It is not an App Store release. See [iOS installation](apps/ios/README.md).
- **Roku:** `TVM-roku.zip`. Enable Roku developer mode and upload this ZIP through the Roku's developer web page. Roku uses a TVM Core running on your computer. See [Roku setup](apps/roku/README.md).

Windows also serves the browser interface while its Core is running, so Windows desktop users can open the same local web address without a second download.

## How TVM works

1. **The interface** shows the catalogue, search, details, saved lists, profiles, settings and playback controls. Windows has a C++20/Win32/Direct2D interface. The browser uses React; iOS and Android bundle that responsive interface with native playback. Roku has its own SceneGraph interface.
2. **Core** handles accounts, access tiers, provider connections and media resolution. The Windows and browser packages run the shared Node Core in the background. iOS and Android include on-device Core implementations and can run without a PC. Roku connects to the computer's Core.
3. **Playback** uses mpv on Windows, native playback on the phone apps, Roku's player on Roku, or browser playback with Core conversion when necessary. TVM does not include media subscriptions or supply rights to third-party content; connect sources you are authorised to use.

Credentials and viewing data belong in TVM's local data folder and encrypted storage, not in this repository. Closing the browser or Windows interface leaves the shared Core available to other connected clients.

## Accounts and access

Open **Account** to create an account or sign in. A new account stays inactive until the operator activates it. Complete email verification when requested and accept the current terms. Developer tools require a developer account. Live TV requires the appropriate access tier and a source/subscription you supply.

Donations are optional gifts and do not activate or upgrade an account. The Windows client opens the existing donation screen in your browser; payment fields are supplied by Stripe.

## Using a phone browser or Roku on your network

Local desktop/browser use binds Core to `127.0.0.1` by default. For another device on your trusted LAN, configure the host with:

```text
TVM_CORE_BIND=0.0.0.0
TVM_LAN_TOKEN=<your own random token of at least 32 characters>
```

Allow the host on your private network and use `http://<host-lan-ip>:7345/` on the other device. Complete the connection/pairing screen with the token. Roku has its own connection settings. Admin, billing and privacy controls remain local. Never commit a real token or put it in a public UI bundle. See [connection and testing instructions](docs/INITIAL_TESTING.md).

The standalone iOS and Android apps do not require a home computer for their normal on-device mode.

## Updates

- Installed Windows packages can verify and install renderer updates, then restart. Shared Core and browser UI have their own verified update feed.
- iOS and Android can update their shared interface. Native player/Core changes require a new IPA/APK installation.
- Roku channel changes require installing the current channel ZIP again.
- A source checkout updates from Git and needs rebuilding. Checkouts created before the contributor-history cleanup should be cloned afresh; save any local work first.

The `desktop-ui`, `ios-ui` and `android-ui` prereleases are required automatic-update feeds. The main **TVM downloads** release contains the files people install.

## Build from source

Install Node.js 22+ and pnpm 11. From this repository:

```bash
pnpm install
pnpm build
pnpm typecheck
```

For the browser interface, run `TVM-web.cmd` on Windows or `./TVM-web.sh` on macOS/Linux. During development, `pnpm dev` runs Core on port 7345 and Vite on port 5173.

For the Windows C++ interface, install Visual Studio C++ Build Tools with CMake, or MSYS2 UCRT64 GCC/CMake/Ninja, then run:

```powershell
native/build.bat
./TVM.cmd
```

Create a complete Windows package with `powershell -File native/package.ps1`. Native details are in [native/README.md](native/README.md). Phone and Roku build instructions are in their app directories.

## Repository layout

- `native/` — Windows C++ interface, playback integration, tests and packaging.
- `apps/core/` — shared account, catalogue, provider and update services.
- `apps/ui/` — responsive browser interface, also bundled in the phone apps.
- `apps/ios/` — Swift iOS host, on-device Core and native playback.
- `apps/android/` — Kotlin Android host, on-device Core and native playback.
- `apps/roku/` — Roku channel and package checks.
- `packages/` — shared design tokens and navigation.
- `scripts/` and `.github/workflows/` — launchers, validation, packaging and releases.
- `docs/` — detailed setup, platform and testing information.

Automated checks cover Core/UI/navigation tests, the Windows native build and tests, responsive Chromium/WebKit layouts, Android packaging/emulator checks, iOS packaging/simulator tests and Roku source/package checks. Device signing, store distribution and physical-device playback/accessibility QA are separate platform tasks.

Third-party playback engines and libraries retain their licence notices and upstream attribution. See the bundled licence files, `apps/ui/public/licenses`, and `native/third_party`.
