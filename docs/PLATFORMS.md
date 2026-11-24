# Supported apps and updates

The supported products are desktop, web browser, iOS, Android and Roku.
The USB appliance has been retired. Its historical source remains in Git history.

Windows desktop runs the C++20 client under `native/`, packaged with the shared Core/UI and Node. Build with `native/build.bat` and start `TVM.cmd`, or download and run **TVM.exe** from GitHub Releases. Electron has been retired. macOS/Linux desktop use the responsive browser UI. See [desktop setup](DESKTOP.md).

| App | Update behavior | Native package changes |
| --- | --- | --- |
| Desktop | Windows verifies and installs native renderer updates; all desktops use the verified Core/UI feed. | Windows native ZIP includes Node; macOS/Linux browser package requires Node 22+. Source checkouts update with Git and rebuild. |
| Web browser | Loads the UI from its connected Core. Reload after Core updates. | Uses the desktop Core installation. |
| iOS | Checks the verified shared UI feed on launch, unless disabled in Settings. | Swift/VLC changes require a new signed IPA. This GitHub build is not an App Store release. |
| Android | Checks the verified shared UI feed on launch, unless disabled in Settings. | Kotlin/player changes require installation of the new APK. |
| Roku | Runs standalone on the Roku device (or connects to a PC Core if configured in Settings). | Upload the new `TVM-roku.zip` in developer mode when channel code changes. |

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

For Windows, download **TVM.exe** from [GitHub Releases](https://github.com/GL-327/TVM/releases/latest) and run it directly. GitHub's **Source code (zip)** requires a
development setup and is not the packaged Windows app.
