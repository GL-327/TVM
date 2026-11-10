# Supported apps and updates

The supported products are desktop, web browser, iOS, Android and Roku.
The USB appliance has been retired. Its historical source remains in Git history.

Windows desktop runs the C++20 client under `native/`, packaged with the shared Core/UI and Node. Build with `native/build.bat` and start `TVM.cmd`, or extract the Native Windows release ZIP. Electron has been retired. macOS/Linux desktop use the responsive browser UI. See [desktop setup](DESKTOP.md).

| App | Update behavior | Native package changes |
| --- | --- | --- |
| Desktop | Windows verifies and installs native renderer updates; all desktops use the verified Core/UI feed. | Windows native ZIP includes Node; macOS/Linux browser package requires Node 22+. Source checkouts update with Git and rebuild. |
| Web browser | Loads the UI from its connected Core. Reload after Core updates. | Uses the desktop Core installation. |
| iOS | Checks the verified shared UI feed on launch, unless disabled in Settings. | Swift/VLC changes require a new signed IPA. This GitHub build is not an App Store release. |
| Android | Checks the verified shared UI feed on launch, unless disabled in Settings. | Kotlin/player changes require installation of the new APK. |
| Roku | Catalog and playback services come from the connected Core. | The developer-mode channel ZIP must be uploaded again when its BrightScript changes. Channel Store distribution is needed for Roku-managed channel updates. |

Shared UI updates do not replace phone or Roku native executables. Native changes on those devices require installation through their platform distribution channel.

## Release verification

The October 2026 player update was checked with Core and UI unit tests,
TypeScript checks, production builds, desktop Chromium and phone WebKit browser
tests, Android unit tests and APK compilation, iOS project/playback contract
checks, and Roku package checks. The extracted Windows Core/UI layout also
started with a fresh data directory and answered its health and UI routes.

The iOS build and simulator tests run on the macOS GitHub runner. Roku hardware
installation and playback must be checked on a physical device. Compilation
and browser emulation alone do not establish either hardware result.

For Windows, download **TVM-native-windows.zip** from the Native Windows release, extract the
whole folder, and open `TVM.cmd`. GitHub's **Source code (zip)** requires a
development setup and is not the packaged Windows app.
