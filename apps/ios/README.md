# TVM for iPhone and iPad

Native SwiftUI / WKWebView client for TVM Core. Open `TVM.xcodeproj` in Xcode on a Mac. No package manager or third-party iOS SDK is required.

The app connects to your running TVM computer on the same trusted network. It does not contain Core, download providers to your phone, or play protected commercial streaming services through Electron. Credentials are stored in the device Keychain; the web interface receives an expiring HttpOnly session cookie, never the LAN bearer token.

`POST /api/lan/session` with `Authorization: Bearer <TVM_LAN_TOKEN>` mints the `tvm_lan_session` cookie. `DELETE` revokes it. That is the same contract as the Android client and `apps/core/src/lanSessions.ts`.

## What works on this Windows workspace

| Step | Status here |
| --- | --- |
| Source project (`TVM.xcodeproj`, Swift, plists, shared scheme) | Present |
| `node apps/ios/check-project.mjs` | Packaging check only (no Swift compile) |
| `export-ipa.cmd` / `export-ipa.ps1` | **Always fails.** `xcodebuild` does not run on Windows. |
| `request-ipa.ps1` | Downloads a **real** unsigned CI IPA *if* GitHub Actions `mobile.yml` has already compiled one on a macOS runner |
| Phone layout (`apps/ui/src/theme/mobile.css`) | In the shared UI bundle |
| Signed or unsigned `.ipa` file in this tree | **Not produced on this PC.** Windows cannot run `xcodebuild`. |
| App Store / TestFlight upload | Not possible from this PC |

This is **not** a signed or device-verified IPA. Do not describe the project as ready for distribution until a Mac has archived it and [the iOS testing guide](../../docs/IOS_TESTING.md) has been walked on a phone. Never rename a zip to `.ipa` and expect it to install.

## Sideload on an iPhone (after you have a real IPA)

You need a binary that Xcode (or the `mobile.yml` macos job) actually compiled. Then **re-sign** it with *your* Apple ID.

### Sideloadly (Windows)

1. Install [Sideloadly](https://sideloadly.io/) on this PC.
2. Unlock the iPhone, connect USB, tap Trust.
3. Open Sideloadly. Drag `TVM.ipa` or `TVM-unsigned.ipa`.
4. Sign in with your Apple ID. Start the install.
5. On the phone: **Settings → General → VPN & Device Management** → trust that Apple ID.
6. Free Apple IDs expire in **7 days**. Re-sign before then. A paid Apple Developer membership lasts a year.

Sideloadly replaces the ad-hoc/unsigned signature. An unsigned CI zip will not launch until this step succeeds.

### AltStore

1. Install [AltServer](https://altstore.io/) on Windows or a Mac on the same Wi-Fi.
2. Plug in the iPhone and install AltStore onto it from AltServer.
3. In AltStore on the phone, sideload the IPA (or use AltServer’s “Sideload .ipa…”).
4. Trust the developer cert as above. Refresh the app from AltStore before the 7-day free-ID expiry.

### Xcode on a Mac (most reliable)

Open `TVM.xcodeproj`, set your team under Signing & Capabilities, plug in the phone (Developer Mode on), **Product → Run**. Or:

```sh
cd apps/ios
chmod +x export-ipa.sh
./export-ipa.sh development
# IPA: apps/ios/build/ipa/TVM.ipa
```

Install that IPA with Xcode **Window → Devices and Simulators** or Apple Configurator.

### Paid Apple Developer (Ad Hoc)

Register the phone’s UDID on the team, then `./export-ipa.sh ad-hoc`. Use `ExportOptions-adhoc.plist`.

## What requires a Mac

1. Compile, test, and archive with Xcode.
2. Sign with your Apple ID / team (nothing in this repo is a signing identity).
3. Install on a registered iPhone and work through `docs/IOS_TESTING.md`.

### Simulator compile (no signing)

```sh
cd apps/ios
xcodebuild -list -project TVM.xcodeproj
xcodebuild -project TVM.xcodeproj -scheme TVM \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
# Pick a name from: xcrun simctl list devices available
xcodebuild -project TVM.xcodeproj -scheme TVM \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  CODE_SIGNING_ALLOWED=NO test
```

### Signed IPA (installable on a registered device)

Open the project once, set your team under Signing & Capabilities, then:

```sh
cd apps/ios
chmod +x export-ipa.sh
./export-ipa.sh development   # personal Apple ID, registered phone
# or
./export-ipa.sh ad-hoc        # paid team + device UDID on the profile
# optional: DEVELOPMENT_TEAM=XXXXXXXXXX ./export-ipa.sh development
```

Those scripts run:

```sh
xcodebuild -project TVM.xcodeproj -scheme TVM \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath build/TVM.xcarchive \
  archive

xcodebuild -exportArchive \
  -archivePath build/TVM.xcarchive \
  -exportPath build/ipa \
  -exportOptionsPlist ExportOptions-development.plist
  # or ExportOptions-adhoc.plist
```

The IPA lands at `apps/ios/build/ipa/TVM.ipa`. A simulator `.app` cannot be sideloaded.

### Unsigned / ad-hoc CI zip

GitHub Actions `mobile.yml` (macos runner) can compile for `iphoneos` with ad-hoc identity `-` and zip `TVM-unsigned.ipa`. That artifact **will not install** until you re-sign it (Sideloadly / AltStore / Xcode). `package-unsigned-ipa.sh` is that zip step.

On Windows, after Actions has a successful `ios-ipa` run:

```powershell
cd apps\ios
.\request-ipa.ps1
# writes apps\ios\build\TVM-unsigned.ipa when the artifact exists
```

`node apps/ios/check-project.mjs` validates project references, XML and the Core session contract from Windows. It is **not** an iOS compilation or device test.
