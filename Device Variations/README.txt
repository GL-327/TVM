TVM Device Variations
=====================
Sideload packages for every device, pulled from GitHub Releases:

  powershell -File ".\Device Variations\fetch-ipa.ps1"

That writes one file per platform into this folder and removes the older
names it used to keep. Binaries are gitignored so git stays small. Do not
treat a zip of Swift source as an IPA.

GitHub: https://github.com/GL-327/TVM/releases/tag/devices

Files
-----
TVM.exe              Windows desktop installer and launcher
TVM.ipa              iPhone and iPad (unsigned, re-sign with Sideloadly or AltStore)
TVM.apk              Android phone, tablet, and TV
TVM-roku.zip         Standalone Roku developer channel
TVM-desktop.zip      macOS and Linux browser desktop
fetch-ipa.ps1        Download the latest packages from GitHub Releases

iOS - TVM.ipa (unsigned standalone app)
---------------------------------------
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

Builds are signed with TVM's own key, so a newer APK installs over an older
one and keeps your sign-in. The first time you move from an older build
(made before 18 Sept 2026) Android may say "App not installed": uninstall
TVM once, then install this one.

Every APK is installed and opened on an Android emulator by CI before it is
released.

Roku
----
Sideload TVM-roku.zip from the Roku developer page on your network. It runs
standalone on the Roku (no PC server required); you can also point it at a
desktop Core in Settings if you want.

Desktop
-------
Windows: download and run TVM.exe (single-file installer & launcher; includes
Core, UI, and Node).
macOS & Linux: extract TVM-desktop.zip and run TVM.command on macOS or ./TVM.sh
on Linux (needs Node.js 22 or newer). From then on it updates itself: on opening
it checks GitHub, applies Core and the interface, and restarts into them.

What this IPA cannot do
-----------------------
Apple will not let an unsigned IPA install itself. Sideloadly/AltStore is
the native-app update. The interface inside the app does update itself
from GitHub on open.

Windows cannot run xcodebuild. The IPA is compiled on GitHub's macOS runner.
