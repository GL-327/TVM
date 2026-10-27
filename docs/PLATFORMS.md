# Supported apps and updates

The supported products are desktop, web browser, iOS, Android and Roku.
The USB appliance release workflow has been retired. Its historical source
remains in `os/` for reference.

| App | Update behavior | Native package changes |
| --- | --- | --- |
| Desktop release | Checks GitHub on launch and uses the verified Core/UI feed. | The Windows ZIP includes Node 22; source checkouts update with Git. |
| Web browser | Loads the UI from its connected Core. Reload after Core updates. | Uses the desktop Core installation. |
| iOS | Checks the verified shared UI feed on launch, unless disabled in Settings. | Swift/VLC changes require a new signed IPA. This GitHub build is not an App Store release. |
| Android | Checks the verified shared UI feed on launch, unless disabled in Settings. | Kotlin/player changes require installation of the new APK. |
| Roku | Catalog and playback services come from the connected Core. | The developer-mode channel ZIP must be uploaded again when its BrightScript changes. Channel Store distribution is needed for Roku-managed channel updates. |

Automatic shared UI updates do not replace native executables. Full native
binary updates on every device require the appropriate signed distribution
channel; GitHub sideloads do not supply that service.

## Release verification

The October 2026 player update was checked with Core, UI and shell unit tests,
TypeScript checks, production builds, desktop Chromium and phone WebKit browser
tests, Android unit tests and APK compilation, iOS project/playback contract
checks, and Roku package checks. The extracted Windows Core/UI layout also
started with a fresh data directory and answered its health and UI routes.

The iOS build and simulator tests run on the macOS GitHub runner. Roku hardware
installation and playback must be checked on a physical device. Compilation
and browser emulation alone do not establish either hardware result.

For Windows, download **TVM-desktop.zip** from the Desktop release, extract the
whole folder, and open `TVM.cmd`. GitHub's **Source code (zip)** requires a
development setup and is not the packaged Windows app.
