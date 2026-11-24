# TVM native for Windows

TVM's C++20 desktop client uses Win32, Direct2D and mpv. The shared web,
iOS, Android and Roku clients remain separate supported products. Native
Windows does not replace the Core server used by browsers and Roku.

## Build and run

From the repository root:

```powershell
.\native\build.bat
.\scripts\launchers\TVM.cmd
```

The build uses this checkout's package.json and source files. Install either
Visual Studio Build Tools with Desktop development with C++ and CMake, or
MSYS2 UCRT64 with GCC, CMake and Ninja. The PowerShell script discovers the
installed tools; it has no developer-specific repository path.

With a CMake toolchain already on PATH:

```powershell
cmake -S native -B native/build
cmake --build native/build --config Release --parallel 2
ctest --test-dir native/build -C Release --output-on-failure
```

The executable is native/build/tvm.exe (Ninja) or
native/build/Release/tvm.exe (Visual Studio). Assets are copied beside it.
Playback uses mpv.exe from an existing installation or PATH. When missing, the native client asks Core to install a portable Windows build after verifying its published checksum. Set `TVM_SKIP_MPV_INSTALL=1` to keep setup manual. Configure
a Real-Debrid account or a Live TV source through Settings.

The Native Windows GitHub workflow builds and tests with MSVC, captures
screenshots at desktop and portrait sizes, and packages TVM-native-windows.zip.
The ZIP contains the native renderer, artwork, shared Core, responsive UI and Node runtime. Extract the entire folder. Build the complete ZIP locally with `powershell -File native/package.ps1`.

## Single-file installer (TVM.exe)

`powershell -File native/installer/build-setup.ps1` packages the build above
and compiles `native/dist/TVM.exe` (about 27 MiB) with the C# compiler that
ships with Windows. Double-clicking it the first time installs TVM for the
current user into `%LOCALAPPDATA%\Programs\TVM`, without administrator rights.
It also adds Start menu and Desktop shortcuts and an Apps & features entry,
then opens TVM. Later runs just open TVM, or update the installed copy when
the file carries a newer build. An update closes the TVM window (asking first)
and stops the installed Core. Uninstalling from Apps & features removes the
program but keeps account data and mpv in `%LOCALAPPDATA%\TVM`. Flags:
`--reinstall`, `--install-only`. The file is unsigned, so SmartScreen may ask
for confirmation on first run.

The installer builds its own pruned payload from `native/package/`; the
GitHub release ZIP and its layout are unchanged. It omits source maps and
manual-extraction launchers/readme, strips only a positively identified MinGW
renderer copy, and checks that copy with a 1280x720 snapshot. All three PNG
paths remain: the UI references `tvm-icon.png` and `apps/tvm.png`. The payload
uses Windows 8+ `cabinet.dll` LZMS in solid 32 MiB blocks, with bounded buffers,
block checksums, validated relative paths and extraction progress. Its file
container and framing are documented in `installer/Payload.cs`.

Measured on 2026-11-18 using the existing staged package (`-SkipPackage`):

- Installer: **42,314,240 to 28,038,656 bytes** (40.35 to 26.74 MiB; **33.7% smaller**).
- Staged/installed payload: **331 to 245 files**, **112,404,418 to 103,167,611 bytes**
  (107.20 to 98.39 MiB). Normal installation also generates `uninstall.ps1`.
- Payload renderer: **8,961,710 to 5,552,128 bytes**; source/package copies unchanged.
- Isolated fresh install: **4.59 seconds**; update over an older stamp: **4.19 seconds**.
  These are local test timings, excluding Windows shortcut/registry integration.
- Rolldown was already available, but Core bundling was skipped: the unbundled
  baseline failed Windows DPAPI protection in the sandbox user context
  (Windows reported a possibly unloaded profile), so health/pricing/Hub HTTP
  parity could not be established.
  Core remains the original multi-file ESM output; no packages were installed.

Rebuild only the installer payload with
`powershell -File native/installer/build-setup.ps1 -SkipPackage`. Run
`powershell -File native/installer/test-setup.ps1` for C# 5 format tests and
fresh install/update/reinstall/version/corruption checks, including SHA-256
verification of every installed file. Scratch manifests and metrics are in
`build/installer/`. Tests use the hidden, **test-only** `--root <absolute-dir>`
switch and install into `build/installer-test/`. This mode skips running-copy
handling and all Windows integration/launching, keeps the progress window,
and writes an adjacent `.setup.log`; it never operates on the real install.

## Available features

- Home and TVM Stream catalogue, rotating hero artwork, search, movie and
  series details, season and episode selection, service catalogue hubs.
- mpv playback with resume, subtitles and audio tracks, quality and speed
  selection, seeking and preview thumbnails, next episode, recap/credits
  controls, fullscreen, mute and volume boost.
- Real-Debrid token/account settings and Live TV login, playlists, channel
  selection and connection checks.
- Profiles, watchlist, Continue watching and recommendations, sharing the
  existing local data formats.
- Film and episode download queues with language, quality and folder choices,
  progress and cancellation. Repeated names reserve separate files; failed
  or cancelled transfers remove their own incomplete files.
- Light/Dark themes, motion and performance preferences, keyboard/D-pad,
  mouse, wheel and touch input. Navigation, profile grids, info-page actions,
  details and player controls reflow in narrow windows.
- Plans information, privacy/data export and reset, diagnostics, recovery,
  developer account administration and mail configuration.

## Accounts, updates and other platforms

Account registration, sign-in, developer sign-in, terms and email verification use the shared Core. Native sessions are encrypted with the existing Windows secret store. Account usability gates navigation; developer tools require a developer session, and Live TV requires the appropriate tier. Core resolves playback/downloads with the signed-in account's media key and plan limits. Operator account and mail changes use Core APIs.

Donations open `/donate` in your system browser, using the existing Stripe fields. That page cannot navigate around the account gate. Service websites also use the system browser and the viewer's own subscription.

Installed Windows packages check for native updates at launch when automatic updates are enabled. The updater verifies the release asset digest and build identity, stages the renderer/assets, waits for the desktop to exit, applies with rollback on failure, and restarts. Source checkouts require `git pull` and rebuilding. Core/UI retain their independent verified feed.

Electron and `apps/shell` have been removed. macOS/Linux desktop use the browser client. iOS Swift/VLC and Android Kotlin/player hosts bundle the responsive UI; Roku uses SceneGraph/BrightScript. The Windows renderer does not replace these products. Native rendering is not pixel-identical to every browser skin. Signed distribution and hardware playback/accessibility QA remain platform-specific.

## Validation

Native unit tests use scratch data folders, fake provider transports and
recording painters. Snapshot mode also uses scratch data:

```powershell
native/build/tvm.exe --snapshot native/build/home.png --size 390x844
```

See [README.md](../README.md) and [docs/DESKTOP.md](../docs/DESKTOP.md) for all supported clients and build requirements.
