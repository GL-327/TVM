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
The ZIP contains the native renderer, artwork, shared Core, responsive UI and Node runtime. Extract the entire folder. Build the complete ZIP locally with `powershell -File native/package.ps1`.

## Available features

- Home and TVM Stream catalogue, rotating hero artwork, search, movie and
  series details, season and episode selection, service catalogue hubs.
- mpv playback with resume, subtitles and audio tracks, speed
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

Use docs/PLATFORMS.md for all supported clients and their build requirements.
