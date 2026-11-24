# TVM

TVM is a remote-first media client for Windows, macOS, Linux, iPhone/iPad, Android, Roku, and web browsers. Maintained by [@GL-327](https://github.com/GL-327) on `main`.

## Overview

TVM pairs a shared local Core server (`apps/core`) with native and responsive browser clients across desktop, mobile, and TV.

- **Accounts and media**: Open **Account** to sign in, create an account, or enter a developer code. TVM does not include media subscriptions or host content; connect your own authorised sources (Real-Debrid or M3U Live TV).
- **Standalone devices**: Windows, iOS, Android, and Roku each bundle or run their own local Core. For browser or remote clients connecting to a PC Core over your LAN, set:
  ```text
  TVM_CORE_BIND=0.0.0.0
  TVM_LAN_TOKEN=<random token, at least 32 characters>
  ```
- **Updates**: Windows, desktop, iOS, and Android check their GitHub update feeds automatically. Roku updates require uploading the latest `TVM-roku.zip` in developer mode.

## Downloads

Get the latest builds from [TVM Downloads](https://github.com/GL-327/TVM/releases/tag/devices), or pull every release package into `dist/packages/` with `pnpm fetch:packages`.

| Platform | Package | Notes |
|---|---|---|
| Windows | `TVM.exe` | Installs into `%LOCALAPPDATA%\Programs\TVM` and launches TVM. Includes Core, UI, Node, artwork, and mpv support. |
| macOS & Linux | `TVM-desktop.zip` | Requires Node.js 22+. Extract and run `TVM.command` (macOS) or `TVM.sh` (Linux). Install `ffmpeg` for transcodes. |
| Web Host | `TVM-web.zip` | Requires Node.js 22+. Extract and run `TVM-web.cmd` or `TVM-web.sh`, then open `http://127.0.0.1:7345/`. |
| Android & Google TV | `TVM.apk` | Standalone APK with an on-device Core. Install directly or with `adb install TVM.apk`. |
| iPhone & iPad | `TVM.ipa` | Unsigned standalone IPA. Sideload with Sideloadly, AltStore, or SideStore using your Apple ID. See [apps/ios/README.md](apps/ios/README.md). |
| Roku | `TVM-roku.zip` | Standalone Roku channel (no PC server required). Upload in developer mode at `http://<roku-ip>`. See [apps/roku/README.md](apps/roku/README.md). |

## Quick Start & Developer Commands

Requires **Node.js 22+** and **pnpm 11** (`corepack enable`).

```bash
pnpm install
pnpm build
pnpm check
```

| Command | Description |
|---|---|
| `pnpm dev` | Start Core (`:7345`) and Vite UI (`:5173`) in parallel watch mode |
| `pnpm dev:web` | Start Core serving the built UI at `http://127.0.0.1:7345/` |
| `pnpm dev:native` | Launch the Windows C++ desktop client (`native/build/`) |
| `pnpm dev:roku` | Start the 1920x1080 TV preview and package the Roku channel |
| `pnpm build` | Build all workspace packages |
| `pnpm test` | Run workspace unit and API tests |
| `pnpm typecheck` | Run TypeScript typechecking across workspaces |
| `pnpm check` | Run `typecheck` plus iOS, Android, and Roku project checks |
| `pnpm roku:package` | Build `apps/roku/tvm-roku.zip` |
| `pnpm fetch:packages` | Download latest device packages from GitHub Releases into `dist/packages/` |

- **Windows C++ client**: Install Visual Studio Build Tools (C++ and CMake) or MSYS2 UCRT64, run `native/build.bat`, then launch with `pnpm dev:native` or `scripts\launchers\TVM.cmd`. Build the installer (`native/dist/TVM.exe`) with `powershell -File native/installer/build-setup.ps1`.
- **macOS & Linux setup**: Run `./scripts/setup-desktop.sh --with-media`, then `./scripts/launchers/TVM.sh` (or `scripts/launchers/TVM.command` on macOS).

## Monorepo Structure

- `apps/core/` - Shared Node Core server (accounts, catalogue, proxy, billing, Hub API)
- `apps/ui/` - React UI (used by web, desktop browser, iOS, and Android)
- `apps/ios/` - Swift iOS app and on-device Core ([README](apps/ios/README.md))
- `apps/android/` - Kotlin Android app and on-device Core ([README](apps/android/README.md))
- `apps/roku/` - BrightScript / SceneGraph Roku channel and on-device Core ([README](apps/roku/README.md))
- `native/` - Windows C++20 / Direct2D desktop client and installer ([README](native/README.md))
- `packages/` - Shared design tokens and navigation helpers
- `scripts/` - Launchers (`scripts/launchers/`), setup, packaging, and smoke helpers
- `docs/` - Architecture, setup, and testing documentation
- `.github/workflows/` - CI checks and platform release pipelines

## Documentation

- [Desktop Setup](docs/DESKTOP.md) - Windows native and macOS/Linux browser desktop instructions
- [Native Windows Client](native/README.md) - Building, packaging, and testing `TVM.exe`
- [iOS Testing & Sideloading](docs/IOS_TESTING.md) - Xcode builds, unsigned IPA re-signing, and device checks
- [Access, Accounts & Live TV](docs/ACCESS.md) - Tiers, developer unlock, email verification, and Live TV proxy rules
- [Payments](docs/PAYMENTS.md) - Stripe PaymentIntents, subscriptions, webhooks, and SAQ-A architecture
- [TVM Hub Contract v1](docs/HUB-V1-CONTRACT.md) - Device management, presence, commands, and pairing API spec
