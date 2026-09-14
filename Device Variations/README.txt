TVM Device Variations
=====================
Sideload packages only. This folder is on disk at:

  C:\Users\Gathe\Desktop\TVM\Device Variations

APK / IPA / zip binaries are gitignored so git stays small. They live here so
you can find them. Do not treat a zip of Swift source as an IPA.

Files
-----
TVM.apk              Android debug APK (LAN WebView client unless rebuilt later)
TVM-roku.zip         Roku developer sideload channel
TVM.ipa              Real iOS IPA from GitHub Actions macos-14 xcodebuild
TVM-unsigned.ipa     Same bytes as TVM.ipa (official CI artifact name)
fetch-ipa.ps1        Re-download the IPA from Actions if this copy is missing

iOS — TVM.ipa  (STANDALONE compiled app, NOT App Store signed)
--------------------------------------------------------------
This file is a Payload/TVM.app zip produced by the Mobile packages ios-ipa job
on GitHub. The executable is a Mach-O binary that embeds the production UI and
an on-device Core. It does not need a PC, host address, LAN token, or Core on
your computer. It is ad-hoc / unsigned. It will NOT launch on an iPhone until
you re-sign it with YOUR Apple ID (Sideloadly, AltStore, or Xcode).

After a signed install the TVM icon appears on the Home Screen like a normal app.

Sideloadly (Windows)
  1. Install https://sideloadly.io/
  2. Unlock the iPhone, USB, tap Trust.
  3. Drag TVM.ipa into Sideloadly, sign in with your Apple ID, install.
  4. Phone: Settings > General > VPN & Device Management > trust that Apple ID.
  5. Free Apple IDs expire in 7 days. Re-sign before then.

AltStore
  1. Install AltServer (https://altstore.io/) on this PC or a Mac on the same Wi-Fi.
  2. Install AltStore onto the iPhone, then sideload TVM.ipa.
  3. Trust the cert as above. Refresh in AltStore before the 7-day expiry.

Xcode on a Mac (most reliable)
  Run: node apps/ios/bundle-ui.mjs
  Open apps/ios/TVM.xcodeproj, set your team under Signing & Capabilities,
  plug in the phone (Developer Mode on), Product > Run.
  Or: cd apps/ios && ./export-ipa.sh development

To fetch a newer CI IPA later (does not invent a file if Actions has none):

  powershell -File "C:\Users\Gathe\Desktop\TVM\Device Variations\fetch-ipa.ps1"

What this IPA cannot do
-----------------------
No ffmpeg on iOS: if Real-Debrid cannot offer MP4/M4V/MOV or an HLS `apple`
ladder, TVM says the format is not playable here — it does not pretend there
are "no streams". Connect Real-Debrid in the app (Profile) if the phone has
no token yet. Re-sign every new IPA (Sideloadly/AltStore).
Live TV MPEG-TS hops are not remuxed on the phone.
No GitHub login and no in-app update apply — install a new IPA.
Not App Store signed.

Android / Roku
--------------
The Android APK in this folder may still be the older LAN-client until that
project is rewritten. Roku still talks to a LAN Core. The iOS IPA is standalone.

What failed / what this is not
------------------------------
Windows cannot run xcodebuild. The IPA is compiled on GitHub's macOS runner.
There is no App Store IPA, Play AAB, or Roku Channel Store package in this repo.
