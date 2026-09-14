# TVM

A remote-first television appliance. A small computer boots TVM from USB,
outputs HDMI to a television, and is driven entirely with a D-pad remote: your
own media, licensed sources you already pay for, and the streaming services you
already subscribe to, behind one home screen.

**Status: private initial testing build.** Read [the testing guide](docs/INITIAL_TESTING.md) for playback,
Retro, sandbox checkout, security changes and the remaining public-launch requirements. No real payments are enabled.
The
architecture is fixed in
[docs/TVM_IMPLEMENTATION_PLAN.md](docs/TVM_IMPLEMENTATION_PLAN.md); read it
before changing anything structural.

## Layout

| Path | What it is |
| --- | --- |
| `apps/ui` | React interface, built for a ten-foot viewing distance |
| `apps/core` | Local service on `127.0.0.1` by default. Owns all business logic, and serves the interface in production |
| `apps/shell` | Electron kiosk window for the Windows SKU |
| `apps/roku` | Roku SceneGraph source. Talks to Core over HTTP on the LAN with a bearer token. No physical Roku has been accepted; see [apps/roku/README.md](apps/roku/README.md) |
| `apps/ios` | Standalone iPhone app: bundled `apps/ui` + on-device Core. No PC or LAN token required. IPA is CI/Mac only and is not App Store signed. See [apps/ios/README.md](apps/ios/README.md) |
| `apps/android` | Kotlin WebView client source. Same LAN Bearer + `tvm_lan_session` contract as iOS. Debug APK is local/CI only (gitignored); not Play. See [apps/android/README.md](apps/android/README.md) |
| `packages/design` | Design tokens: colour, type scale, spacing, motion, focus |
| `packages/nav` | Remote input normalised into intents |
| `os/` | The Debian appliance image, USB flashing and the boot checklist |
| `docs/` | Architecture and implementation plan |

The interface never talks to a provider or holds a credential. It talks to core
over `/api`, and core talks to everything else.

## Prerequisites

- Node.js 22 or newer
- pnpm 11, via corepack: `corepack enable pnpm`

On Windows, `corepack enable` writes into `C:\Program Files\nodejs` and needs an
elevated terminal. Without it, prefix commands with `corepack`, as in
`corepack pnpm install`.

## Commands

```bash
pnpm install
pnpm dev          # core on 7345, interface on 5173, Electron kiosk
pnpm build
pnpm test
pnpm typecheck
```

In development the Vite server serves the interface and proxies `/api` to core.
In production core serves both, so the interface is always same-origin with its
API and there is no CORS layer to get wrong.

Useful environment variables:

| Variable | Effect |
| --- | --- |
| `TVM_CORE_PORT` | Core's port. Default 7345 |
| `TVM_CORE_BIND` | Core's listen address. Default `127.0.0.1`. LAN clients require bearer authentication; see the testing guide |
| `TVM_LAN_TOKEN` | At least 32 characters for authenticated LAN clients; never place it in the UI bundle. Admin, billing and privacy routes stay local |
| `TVM_UI_URL` | Origin the shell loads |
| `TVM_WINDOWED=1` | Run the shell in a window instead of fullscreen. `TVM-windowed.cmd`, `Desktop/TVM.cmd`, and the Desktop copies set this; `TVM.cmd` does not |
| `TVM_ENV=production` | Shell loads the interface from core. Apply for GitHub app updates is allowed; core hops to the applied bundle on restart |
| `TVM_GITHUB_TOKEN` | Optional private-fork only. The public `GL-327/TVM` feed needs no token and no GitHub login on any device |
| `TVM_UPDATE_REPO` | Optional. `owner/name` override for the app update channel. Default `GL-327/TVM` |
| `TVM_ALLOW_APPLY=1` | Allow Apply outside production. Do not set this on a source checkout you care about |
| `TVM_ROKU_HOST` / `TVM_ROKU_PASSWORD` | Optional. `TVM-roku.cmd` uses these to sideload `apps/roku/tvm-roku.zip` onto a developer-mode Roku |

On this PC, double-click `TVM-roku.cmd` to start Core and the UI, then open the **desktop interface** in a 1920×1080 TV frame at `http://127.0.0.1:5173/?tv=1`. That is the same React app as `TVM.cmd`, not a separate channel mock. A Roku cannot run that UI.

The Roku product for this version is the sideloaded `apps/roku/tvm-roku.zip` (not a Channel Store or HTTPS build). For a box on the LAN: set `TVM_CORE_BIND=0.0.0.0` and a random `TVM_LAN_TOKEN` of at least 32 characters; allow Core on the Windows private network; enter `http://<this-pc-lan-ip>:7345` and the same token on the Roku setup screen. The channel sends `Authorization: Bearer <token>` on Core API calls and Core-hosted streams. Loopback clients do not need a token. Admin, billing and privacy routes stay local. Never put the token in `config.json` or the zip. Details: [apps/roku/README.md](apps/roku/README.md).

The iPhone app is standalone and does not need this bind or token. Android (and optional iOS “home Core”) still exchange a bearer for an HttpOnly `tvm_lan_session` cookie (`POST /api/lan/session`). See [apps/ios/README.md](apps/ios/README.md) and [apps/android/README.md](apps/android/README.md).

## Android

`apps/android` is a Kotlin WebView client (`com.tvm.privateclient`, minSdk 26). It loads the shared `apps/ui` waiter from Core on a trusted LAN. It does not contain Core. The phone layout is `apps/ui/src/theme/mobile.css`.

Same contract as iOS: Core must listen with `TVM_CORE_BIND=0.0.0.0` and a unique `TVM_LAN_TOKEN` of at least 32 characters. The app sends `Authorization: Bearer <token>` to `POST /api/lan/session` and keeps the HttpOnly `tvm_lan_session` cookie. The bearer is never written into the WebView. Credentials use EncryptedSharedPreferences.

A debug APK can be built on this Windows workspace after JDK 17 or 21 and the Android SDK are installed (`gradlew.bat assembleDebug` from `apps/android`). That output is under `app/build/` and is gitignored — there is no committed APK. GitHub Actions `mobile.yml` can assemble the same debug APK on a runner. This is not a Play Store or signed release. Widevine L1 / Android TV certification is out of scope.

`node apps/android/check-project.mjs` validates the tree and the Core contract from Windows. It does not compile Kotlin or prove playback on a device.

```
apps/android/
  README.md
  check-project.mjs
  .gitignore
  settings.gradle.kts
  build.gradle.kts
  gradle.properties
  gradlew
  gradlew.bat
  gradle/wrapper/gradle-wrapper.properties
  gradle/wrapper/gradle-wrapper.jar
  app/build.gradle.kts
  app/proguard-rules.pro
  app/src/main/AndroidManifest.xml
  app/src/main/java/com/tvm/privateclient/Connection.kt
  app/src/main/java/com/tvm/privateclient/SessionClient.kt
  app/src/main/java/com/tvm/privateclient/CredentialStore.kt
  app/src/main/java/com/tvm/privateclient/MainActivity.kt
  app/src/main/java/com/tvm/privateclient/TVMWebViewClient.kt
  app/src/main/res/layout/activity_main.xml
  app/src/main/res/values/strings.xml
  app/src/main/res/values/themes.xml
  app/src/main/res/values/colors.xml
  app/src/main/res/xml/network_security_config.xml
  app/src/main/res/xml/backup_rules.xml
  app/src/main/res/xml/data_extraction_rules.xml
  app/src/main/res/drawable/ic_launcher.xml
  app/src/main/res/drawable/ic_launcher_foreground.xml
  app/src/main/res/drawable/field.xml
  app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
  app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml
  app/src/test/java/com/tvm/privateclient/ConnectionTest.kt
  app/src/test/java/com/tvm/privateclient/SessionClientTest.kt
```

`local.properties`, `.gradle/` and `app/build/` are local. Do not commit them.

## Laptop / Desktop copies

The living-room launcher (`TVM.cmd`) is a fullscreen kiosk. For a laptop, use the windowed copies:

| Copy | How to run |
| --- | --- |
| Desktop app (windowed) | `Desktop/TVM.cmd` (Windows) or `Desktop/TVM.sh` (Linux/macOS) |
| Roku preview + zip | `Desktop/TVM-roku.cmd` or `Desktop/TVM-roku.sh` |

Double-click `Install-to-Desktop.cmd` (or run `scripts/copy-to-desktop.sh`) to put **both** the windowed desktop app and the Roku sideload zip on your Desktop:

- `TVM.cmd` / `TVM.sh` — window sized to the laptop work area, mouse cursor visible
- `TVM Roku.cmd` / `TVM-roku.sh` — TV-frame preview of the same UI
- `TVM-roku.zip` — sideload onto a developer-mode Roku

## The appliance

See [os/README.md](os/README.md) and [os/USB.md](os/USB.md). In short: a flash
drive plugged into a television's USB port cannot boot an operating system.
TVM boots a small x86 computer from USB, and that computer drives the
television over HDMI. On this PC run `os/scripts/prepare-usb.ps1` to copy the
flash kit onto D:.

## Rules that are not negotiable

- **No secrets in the repository.** Not in source, not in committed env files,
  never in the interface bundle. Credentials belong in the operating system's
  credential store, reached only by core.
- **Core binds `127.0.0.1` by default.** It holds credentials, so the appliance
  and production Electron SKU never expose it. A Roku, iPhone or Android phone
  on the LAN needs `TVM_CORE_BIND=0.0.0.0` and `TVM_LAN_TOKEN`; laptop
  launchers do not, so Windows never asks to allow Node on Wi-Fi.
- **No torrent indexing, magnet search or scraping.** Real-Debrid is a client
  for files the user already owns and links the user supplies, not a search
  engine.
- **Everything works with arrows, OK and Back.** A control that needs a pointer
  is not finished.
