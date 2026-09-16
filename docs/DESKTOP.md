# TVM on Linux and macOS

TVM’s desktop shell is the same Electron app on Windows, Linux and macOS. Core
still binds `127.0.0.1` by default. A Roku or phone on the LAN is the only
reason to change that.

## 1. Install

You need **Node.js 22 or newer** ([nodejs.org](https://nodejs.org)). pnpm 11
comes with it via corepack.

```bash
git clone https://github.com/GL-327/TVM.git
cd TVM
chmod +x TVM.sh TVM-windowed.sh TVM.command TVM-windowed.command scripts/*.sh
./scripts/setup-desktop.sh --with-media
```

`--with-media` installs **ffmpeg** and **mpv** when Homebrew (macOS), apt,
dnf or pacman is available. Without them, MP4/WebM still play; HEVC and most
MKV files need ffmpeg, and the native player needs mpv.

### macOS

```bash
# Node from https://nodejs.org (LTS 22+), then:
brew install ffmpeg mpv          # if you skipped --with-media
./scripts/setup-desktop.sh
open TVM-windowed.command        # or: ./TVM-windowed.sh
```

Finder: double-click **TVM-windowed.command**. The first run may ask to allow
Terminal. If macOS says the app is damaged, the launcher already clears the
quarantine flag on Electron; run `xattr -dr com.apple.quarantine TVM-windowed.command`
on the shortcut if Finder still blocks it.

Apple Silicon and Intel both work. ffmpeg uses VideoToolbox when the build
includes `h264_videotoolbox`.

### Linux (Debian / Ubuntu)

```bash
sudo apt-get update
sudo apt-get install -y curl ffmpeg mpv \
  libgtk-3-0 libnss3 libgbm1 libxss1 libxtst6 xdg-utils
# Ubuntu 24.04+ may want libasound2t64 instead of libasound2:
sudo apt-get install -y libasound2t64 || sudo apt-get install -y libasound2
./scripts/setup-desktop.sh
./TVM-windowed.sh
```

Fedora: `sudo dnf install ffmpeg mpv gtk3 nss mesa-libgbm alsa-lib`.
Arch: `sudo pacman -S ffmpeg mpv gtk3 nss`.

The launcher passes `--no-sandbox` only when Electron’s `chrome-sandbox` helper
is not setuid, which is normal for an npm install. To use the Chromium sandbox
instead: `sudo chmod 4755 apps/shell/node_modules/electron/dist/chrome-sandbox`.

Wayland is fine for the UI. Native mpv embedding (`--wid`) expects an X11
window id; on a pure Wayland session TVM still plays through the HTML player
and ffmpeg. Use an X11 or XWayland session if you need mpv painted into the
TVM window.

## 2. Start

| What | Command |
| --- | --- |
| Laptop window | `./TVM-windowed.sh` |
| Fullscreen kiosk | `./TVM.sh` |
| macOS Finder, windowed | double-click `TVM-windowed.command` |
| macOS Finder, fullscreen | double-click `TVM.command` |
| Put shortcuts on the Desktop | `./Install-to-Desktop.sh` |
| Roku preview + zip | `./TVM-roku.sh` |

Core listens on `http://127.0.0.1:7345`. In a git checkout the Vite UI is on
`http://127.0.0.1:5173` and Electron loads that. Logs:

- macOS: `~/Library/Logs/TVM/`
- Linux: `~/.local/state/tvm/`

If a start fails, the launcher prints the last lines of those logs.

## 3. GitHub desktop package

Releases also publish `TVM-desktop-<version>.tar.gz` (built core + UI, no
Electron binary). Extract it and run:

```bash
tar -tzf TVM-desktop-*.tar.gz | head
tar -xzf TVM-desktop-*.tar.gz
chmod +x launch-tvm.sh TVM.sh TVM-windowed.sh TVM.command TVM-windowed.command
./TVM-windowed.sh
```

That start is **production**: Core serves the UI on port 7345 and the script
opens Electron if this machine already has a TVM git checkout’s Electron, or
the browser if not. For the full kiosk window, clone the repo (section 1).

Verify the checksum:

```bash
sha256sum -c TVM-desktop-*.sha256    # Linux
shasum -a 256 -c TVM-desktop-*.sha256  # macOS
```

## 4. Environment

Same variables as Windows. Useful on a laptop:

| Variable | Effect |
| --- | --- |
| `TVM_WINDOWED=1` | Window instead of fullscreen (the windowed scripts set this) |
| `TVM_CORE_BIND` | Default `127.0.0.1`. LAN clients need `0.0.0.0` plus `TVM_LAN_TOKEN` |
| `TVM_MPV_PATH` | Absolute path to `mpv` if it is not on PATH |
| `TVM_FFMPEG` / `TVM_FFPROBE` | Absolute paths if the binaries are not on PATH |
| `TVM_DATA_DIR` | Override the data directory |

Data directory:

- macOS: `~/Library/Application Support/TVM`
- Linux: `~/.local/share/tvm` (or `$XDG_DATA_HOME/tvm`)

Credentials use AES-256-GCM with a master key file mode `0600`. That is not
an OS keychain. Use disk encryption.

## 5. Not this SKU

- The **USB appliance** image in `os/` is a Debian kiosk for a mini-PC, not a
  Linux desktop install. See [os/README.md](../os/README.md).
- **iPhone** builds only on a Mac with Xcode. See [apps/ios/README.md](../apps/ios/README.md).
