# TVM native for Windows

TVM's C++20 desktop client uses Win32, Direct2D and mpv. The shared web,
iOS, Android and Roku clients remain separate supported products. Native
Windows does not replace the Core server used by browsers and Roku.

## Build and run

From the repository root:

```powershell
.\native\build.bat
.\TVM-native.cmd
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
Playback requires mpv.exe in a supported installation or on PATH. Configure
a Real-Debrid account or a Live TV source through Settings.

The Native Windows GitHub workflow builds and tests with MSVC, captures
screenshots at desktop and portrait sizes, and packages TVM-native-windows.zip.
The ZIP contains the native client and artwork; extract the entire folder.

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

## Compatibility limits

This is a migration, not a claim of full Electron parity. Keep apps/core,
apps/ui and apps/shell while the remaining features are implemented and
verified:

- Account-holder sign-up/sign-in, account activation/terms/email-verification
  flows and billing/donation checkout are not complete in the native UI.
  Developer administration is a separate feature and is already present.
- Native Updates checks GitHub; automatic native executable replacement is
  not implemented. The Core/UI update feed cannot update a C++ executable.
- The native renderer and storage backend currently target Windows. macOS
  and Linux retain the shared browser/Electron desktop path.
- Native rendering is not pixel-identical to every web service skin or
  animation. Device playback and accessibility still require hardware QA.

The iOS Swift/VLC and Android Kotlin/player shells bundle the responsive
shared UI. Roku uses its SceneGraph/BrightScript client and a connected Core.
Removing the shared app would remove supported products and the remaining
account workflows.

## Validation

Native unit tests use scratch data folders, fake provider transports and
recording painters. Snapshot mode also uses scratch data:

```powershell
native/build/tvm.exe --snapshot native/build/home.png --size 390x844
```

Use docs/PLATFORMS.md for all supported clients and their build requirements.
