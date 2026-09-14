# iOS testing and sideloading

## Current status

`apps/ios/TVM.xcodeproj` is an iOS 16+ SwiftUI app: connection setup, Keychain credentials, WKWebView of the shared TVM interface, and authenticated playback against a running Core on the LAN. It is not a standalone or offline player.

**This Windows workspace cannot produce an IPA.** There is no Xcode, no Apple signing identity, and no attached iPhone here. `node apps/ios/check-project.mjs` is a packaging check. `export-ipa.ps1` / `export-ipa.cmd` always fail on purpose. GitHub Actions `mobile.yml` can emit an **unsigned** `TVM-unsigned.ipa` from a macOS runner; that file is not installable until it is re-signed (Sideloadly, AltStore, or Xcode on a Mac). Do not rename a zip to `.ipa`.

On Windows, after a successful `ios-ipa` Actions run: `apps\ios\request-ipa.ps1` downloads that artifact to `apps\ios\build\TVM-unsigned.ipa`.

**Outstanding release gates:** compile and run the XCTest suite in Xcode; sign for the owner's Apple account; install on the phone; verify LAN permission, portrait/landscape, HLS/direct playback, seeks, app switching and reconnection. Record the phone model, iOS version and Xcode version before calling it device-ready.

## Connect the host

Build the repository interface and Core. Run Core with `TVM_CORE_BIND=0.0.0.0` and a unique `TVM_LAN_TOKEN` of at least 32 characters. Use the host's private IPv4 address, for example `http://192.168.1.20:7345`, rather than `localhost` (which would mean the phone). Keep the phone and host on the same trusted Wi-Fi; allow the host service on Windows' private network only. Do not forward this port on your router.

Complete source-provider setup and any DEV/plan settings on the host before connecting; administration, billing, privacy deletion and other sensitive system routes remain restricted to the host.

In the iOS connection screen, paste the address and LAN token. HTTPS with a normally trusted certificate is preferred; the app does not bypass TLS certificate validation. The host currently serves HTTP itself. To use that private-network test path, explicitly enable “Allow private LAN HTTP”. This only permits RFC1918 IPv4 hosts; it does not encrypt traffic over Wi-Fi. The app will reject public HTTP addresses, URLs containing credentials, and cross-origin redirects.

Connecting exchanges the native bearer token for an HttpOnly cookie using `POST /api/lan/session`. The cookie authenticates interface assets, API calls, image loading and native HLS segment requests; it expires after 12 hours. The bearer is never inserted into web scripts or URLs. Token and host are saved together in Keychain with `WhenUnlockedThisDeviceOnly`. WebKit's data store is memory-only. “Disconnect” revokes this session and forgets credentials on the phone; it does not delete host/provider data. If the host is offline, disconnect still removes the local credentials and the server session expires naturally.

The shared UI is a 10-foot television layout on a TV. On a phone, `apps/ui/src/theme/mobile.css` (imported last from `apply.ts`) is a 100vw layout: safe-area insets, a labelled bottom tab bar (HDMI Inputs hidden), 44px targets, always-visible poster labels, a thumb-sized player, and no D-pad lesson. The native WebView adds `viewport-fit=cover`, never auto-insets its own scroll view, and publishes keyboard occlusion (`visualViewport` plus `keyboardWillChangeFrame`) so Search, Real-Debrid, checkout, Live TV login and the host URL scroll above the iOS keyboard. Tap-to-open does not require a prior D-pad hover-focus.

## Build and install using a Mac

1. Transfer this repository to a Mac with a current Xcode version supporting your phone's installed iOS. Open `apps/ios/TVM.xcodeproj`.
2. Select the TVM target, then Signing & Capabilities. Leave automatic signing enabled, select your Apple account's team, and change `com.tvm.privateclient` to your own unique bundle identifier if necessary. No signing secrets belong in source control.
3. Connect and trust your iPhone, enable Developer Mode when prompted, and select it as the run destination. Choose Product → Test first, then Product → Run. A personal Apple account can use Xcode's personal team for development; provisioning restrictions/expiry depend on that account.
4. For an installable IPA from the command line:

```sh
cd apps/ios
chmod +x export-ipa.sh
./export-ipa.sh development
# Product > Archive in Xcode is the same Release archive; distribute to
# registered devices using your team's provisioning.
```

Exact `xcodebuild` steps (also in `export-ipa.sh`):

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
```

Use `ExportOptions-adhoc.plist` / `./export-ipa.sh ad-hoc` when your paid team has the phone's UDID. A simulator build cannot be sideloaded.

### Sideloadly / AltStore (Windows, after a real compiled IPA)

A CI or Mac-built `TVM-unsigned.ipa` is a Payload zip of `TVM.app`. It still needs **your** Apple ID signature.

- **Sideloadly:** install from sideloadly.io, USB-connect the unlocked iPhone, drop the IPA, sign in with your Apple ID, start. Then **Settings → General → VPN & Device Management** and trust the developer. Free Apple IDs last 7 days.
- **AltStore:** install AltServer, install AltStore onto the phone, sideload the IPA, refresh before expiry.
- **Paid Apple Developer:** register the UDID and prefer `./export-ipa.sh ad-hoc` or Xcode’s registered-device export.

Third-party Windows installers cannot compile Swift. They only re-sign a binary that `xcodebuild` already produced.

Automated Mac checks from `apps/ios`:

```sh
xcodebuild -list -project TVM.xcodeproj
xcodebuild -project TVM.xcodeproj -scheme TVM \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
# Pick an installed simulator reported by: xcrun simctl list devices available
xcodebuild -project TVM.xcodeproj -scheme TVM \
  -destination 'platform=iOS Simulator,name=iPhone 16' CODE_SIGNING_ALLOWED=NO test
```

The example simulator name must match an installed device. Apple references: [run on a device](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices), [registered-device distribution](https://developer.apple.com/documentation/xcode/distributing-your-app-to-registered-devices), [local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy).

## Required physical-device acceptance checks

- First launch: missing token, wrong token, offline host and denied Local Network permission each show a recoverable connection error. Permit access in iOS Settings if previously denied. Relaunch uses Keychain credentials; Disconnect clears them.
- Browse, search, select episodes, open/back out of details and change profiles with touch. Confirm the bottom tab labels are visible without hovering, posters open on a single tap, and rails swipe. Focus Search, Real-Debrid, checkout card fields, Live TV login and the Core URL and confirm each field stays above the iOS keyboard. Check small portrait and landscape screens, safe areas and readable controls. Enable Reduce Motion in iOS and in TVM.
- Use an authorised H.264/AAC MP4 and an HLS source: start, pause, seek forwards/backwards, resume and finish; check audio. For MKV or incompatible codecs, host FFmpeg must be available to provide a compatible HLS stream. MPEG-TS-only browser sources and DRM services are not guaranteed to play on iOS.
- Switch apps, lock/unlock and return; confirm a paused/interrupted stream can recover. This shell does not declare background audio. Test AirPlay separately with your receiver; neither AirPlay nor Picture in Picture is a certification claim.
- Disable Wi-Fi, restore it and use Reload/Reconnect. Restart Core and reconnect. Change the host LAN token and verify the old token no longer connects. After session expiry, reconnect to renew it.
- Confirm provider/system administration remains restricted to the host, token does not appear in web storage or page source, and external links never receive the LAN credential.

Record the phone model, iOS version, Xcode version and actual results before declaring sideload/device readiness. Legal, App Store and commercial-service certification are separate from private device installation.
