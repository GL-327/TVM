# TVM

TVM is a media client for Windows, iPhone/iPad, Android, Roku, and web browsers.

Maintained by [Arthur Foxall (@GL-327)](https://github.com/GL-327). Active source is on `main`.

## Downloads

Get the latest builds from [TVM Downloads](https://github.com/GL-327/TVM/releases/tag/devices).

- **Windows (`TVM.exe`)**: Run to install into `%LOCALAPPDATA%\Programs\TVM` and launch TVM. Includes Core, UI, Node, and artwork. Uses mpv for playback.
- **macOS & Linux (`TVM-desktop.zip`)**: Requires Node.js 22+. Extract and run `TVM.command` (macOS) or `TVM.sh` (Linux). Install ffmpeg for transcodes.
- **Web (`TVM-web.zip`)**: Requires Node.js 22+. Extract and run `TVM-web.cmd` or `TVM-web.sh`, then open `http://127.0.0.1:7345/`.
- **Android & Google TV (`TVM.apk`)**: Standalone APK with its own on-device Core. Install directly or with `adb install TVM.apk`.
- **iPhone & iPad (`TVM.ipa`)**: Unsigned standalone IPA. Sideload with Sideloadly, AltStore, or SideStore using your Apple ID. See [apps/ios/README.md](apps/ios/README.md).
- **Roku (`TVM-roku.zip`)**: Standalone Roku channel (no PC server needed). Upload in developer mode at `http://<roku-ip>`. See [apps/roku/README.md](apps/roku/README.md).

## Accounts and media

Open **Account** to sign in, create an account, or use a developer code. TVM does not include media subscriptions or host content; connect your own authorised sources (Real-Debrid or M3U Live TV).

Standalone iOS, Android, and Roku builds run directly on the device. For browser clients connecting to a PC Core over your LAN, set:

```text
TVM_CORE_BIND=0.0.0.0
TVM_LAN_TOKEN=<random token, at least 32 characters>
```

## Updates

- Windows, desktop, iOS, and Android check their GitHub update feeds automatically.
- Roku updates require uploading the latest `TVM-roku.zip` in developer mode.

## Build from source

Requires Node.js 22+ and pnpm 11:

```bash
pnpm install
pnpm build
pnpm typecheck
```

- **Web / Core dev server**: `pnpm dev` (Core on `:7345`, Vite on `:5173`) or run `TVM-web.cmd` / `./TVM-web.sh`.
- **Windows C++ app**: install Visual Studio Build Tools (C++ & CMake) or MSYS2 UCRT64, then run `native/build.bat` and `TVM.cmd`. Package `native/dist/TVM.exe` with `powershell -File native/installer/build-setup.ps1`. See [native/README.md](native/README.md).

## Repo layout

- `native/` - Windows C++20/Direct2D client and installer
- `apps/core/` - shared Node Core server
- `apps/ui/` - React UI (used by web, iOS, and Android)
- `apps/ios/` - Swift iOS app and on-device Core
- `apps/android/` - Kotlin Android app and on-device Core
- `apps/roku/` - BrightScript Roku channel and on-device Core
- `packages/` - shared design tokens and navigation
- `scripts/` and `.github/workflows/` - launchers, packaging, and CI/releases
- `docs/` - setup, payments, and testing notes
