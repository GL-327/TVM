TVM Device Variations
=====================
Sideload packages for every device, pulled from GitHub Releases:

  powershell -File ".\Device Variations\fetch-ipa.ps1"

That writes the current IPA, APK, Roku zip and desktop tarball into this
folder. Binaries are gitignored so git stays small. Do not treat a zip of
Swift source as an IPA.

GitHub: https://github.com/GL-327/TVM/releases/tag/devices

Files
-----
TVM.ipa / TVM-ios.ipa / TVM-unsigned.ipa
                     iPhone & iPad. Same bytes. Unsigned — re-sign first.
TVM.apk / TVM-android.apk
                     Android phone, tablet and TV. Debug-signed; install directly.
TVM-roku.zip         Roku developer sideload channel
TVM-desktop.tar.gz   Windows, macOS and Linux (also the versioned tarball)
fetch-ipa.ps1        Re-download every package from GitHub Releases

iOS — TVM.ipa  (standalone compiled app, not App Store signed)
--------------------------------------------------------------
Payload/TVM.app from the Mobile packages ios-ipa job. Embeds the production
UI and an on-device Core. No PC, host address, LAN token, or Core on your
computer. Ad-hoc / unsigned: it will NOT launch until you re-sign it with
YOUR Apple ID (Sideloadly, AltStore, or Xcode).

Sideloadly (Windows)
  1. Install https://sideloadly.io/
  2. Unlock the iPhone, USB, tap Trust.
  3. Drag TVM.ipa into Sideloadly, sign in with your Apple ID, install.
  4. Phone: Settings > General > VPN & Device Management > trust that Apple ID.
  5. Free Apple IDs expire in 7 days. Re-sign before then.

After a signed install, opening TVM checks GitHub and pulls a newer
interface when one is published. A new IPA is only needed when the native
half changes; the Updates screen says so.

Android
-------
Open TVM.apk. Allow installs from this source. Opening the app checks
GitHub the same way.

Roku
----
Sideload TVM-roku.zip from the Roku developer page on your network. Point
it at the desktop Core. The channel itself is the zip; Core updates from
GitHub when the desktop app opens.

Desktop
-------
Extract the tarball and run the launcher for your OS. Opening it checks
GitHub and applies Core + UI when a newer desktop.json is published.

What this IPA cannot do
-----------------------
Apple will not let an unsigned IPA install itself. Sideloadly/AltStore is
the native-app update. The interface inside the app does update itself
from GitHub on open.

Windows cannot run xcodebuild. The IPA is compiled on GitHub's macOS runner.
