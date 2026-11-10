# Desktop setup

Electron has been retired. Windows uses the C++20 desktop client; macOS and Linux use the responsive browser client. All share the Node Core for accounts, catalogue services and web/Roku access.

## Windows download

Download **TVM-native-windows.zip** from the [Native Windows release](https://github.com/GL-327/TVM/releases/tag/native-windows), extract the whole folder, and run `TVM.cmd` or `tvm.exe`. It includes Node, Core, the web UI and artwork. Install mpv or set `TVM_MPV_PATH` for playback. The browser UI is available at `http://127.0.0.1:7345/` while Core runs.

Sign in through **Account**. New accounts need the operator to activate them. The account screen supports registration, email codes, accepting terms and developer sign-in. Donations open the shared payment screen in your browser; card details remain in Stripe's fields.

Updates checks the native Windows feed. Installed packages verify GitHub's SHA-256 and build identity before replacing the renderer and restarting; a backup is retained in the temporary update directory. Core/UI use the existing verified update feed. Source checkouts update with Git and rebuild.

## Windows source checkout

Install Node.js 22+, pnpm 11, and either Visual Studio C++ Build Tools with CMake or MSYS2 UCRT64 GCC/CMake/Ninja.

```powershell
pnpm install
pnpm build
native\build.bat
.\TVM.cmd
```

Create the complete Windows ZIP with `powershell -File native/package.ps1` after the native build. The executable starts Core hidden and reuses only a matching data directory. If an older Core already occupies the port, close that Core and choose Retry. Core stays running when the desktop window closes so connected browser/Roku clients remain available.

## macOS and Linux

Install Node.js 22+, curl, and ffmpeg for browser transcodes. From a checkout:

```bash
./scripts/setup-desktop.sh --with-media
./TVM-windowed.sh
```

The launcher starts Core and Vite and opens your browser. From the [Desktop browser release](https://github.com/GL-327/TVM/releases/tag/desktop), extract `TVM-desktop.zip` and run `TVM.command` on macOS or `TVM.sh` on Linux. The package serves its built UI directly from Core. The browser client supports phone, tablet and desktop sizes, keyboard/remote navigation, touch and rotation. Browser downloads use a browser with the directory-picker API; Windows native downloads work independently of that API.

## Other clients

Keep `apps/core` and `apps/ui`: the browser, iOS and Android clients require them. Roku has its own SceneGraph/BrightScript UI. For LAN access use the authenticated configuration in [INITIAL_TESTING.md](INITIAL_TESTING.md). Credentials and billing controls stay local by default.

The iOS IPA needs Apple signing for installation. Android and iOS native changes require a new package; Roku BrightScript changes require channel installation. Physical playback and accessibility QA remain device checks.
