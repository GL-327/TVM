#!/usr/bin/env bash
# Prepares a Linux or macOS machine to run TVM from this git checkout.
#
#   ./scripts/setup-desktop.sh              # Node deps only
#   ./scripts/setup-desktop.sh --with-media # also install ffmpeg + mpv when a
#                                           # known package manager is present
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

with_media=0
for arg in "$@"; do
  case "$arg" in
    --with-media|-with-media) with_media=1 ;;
    -h|--help)
      echo "Usage: ./scripts/setup-desktop.sh [--with-media]"
      echo "Install Node dependencies for TVM. --with-media also installs ffmpeg and mpv."
      exit 0
      ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required. https://nodejs.org" >&2
  exit 1
fi
major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
if [ "$major" -lt 22 ]; then
  echo "Node.js 22 or newer is required (found $(node -v))." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required so the launcher can wait for Core." >&2
  exit 1
fi

echo "==> Node $(node -v)"
if command -v corepack >/dev/null 2>&1; then
  echo "==> pnpm via corepack"
  corepack enable pnpm >/dev/null 2>&1 || true
  corepack pnpm install
else
  if ! command -v pnpm >/dev/null 2>&1; then
    echo "corepack is missing. Install Node 22+ from nodejs.org (it includes corepack), then run this again." >&2
    exit 1
  fi
  pnpm install
fi

install_media() {
  if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1 && command -v mpv >/dev/null 2>&1; then
    echo "==> ffmpeg and mpv already on PATH"
    return 0
  fi

  case "$(uname -s)" in
    Darwin)
      if ! command -v brew >/dev/null 2>&1; then
        echo "Homebrew is not installed. Install ffmpeg and mpv from https://brew.sh:" >&2
        echo "  brew install ffmpeg mpv" >&2
        return 1
      fi
      echo "==> brew install ffmpeg mpv"
      brew install ffmpeg mpv
      ;;
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        echo "==> apt-get install ffmpeg mpv"
        sudo apt-get update
        sudo apt-get install -y ffmpeg mpv
      elif command -v dnf >/dev/null 2>&1; then
        echo "==> dnf install ffmpeg mpv"
        sudo dnf install -y ffmpeg mpv
      elif command -v pacman >/dev/null 2>&1; then
        echo "==> pacman -S ffmpeg mpv"
        sudo pacman -S --needed --noconfirm ffmpeg mpv
      else
        echo "Install ffmpeg, ffprobe and mpv with your package manager, then start TVM again." >&2
        return 1
      fi
      ;;
    *)
      echo "Install ffmpeg, ffprobe and mpv for this OS, then start TVM again." >&2
      return 1
      ;;
  esac
}

if [ "$with_media" -eq 1 ]; then
  install_media
else
  if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
    echo "==> ffmpeg $(ffmpeg -version 2>/dev/null | head -n 1)"
  else
    echo "==> ffmpeg is not on PATH. Transcodes need it. Re-run with --with-media, or install ffmpeg yourself."
  fi
  if command -v mpv >/dev/null 2>&1; then
    echo "==> mpv $(mpv --version 2>/dev/null | head -n 1)"
  else
    echo "==> mpv is not on PATH. Native playback can use it. Re-run with --with-media, or install mpv yourself."
  fi
fi

echo ""
echo "TVM is ready."
echo "  Laptop window:     ./TVM-windowed.sh"
echo "  Fullscreen kiosk:  ./TVM.sh"
echo "  macOS Finder:      double-click TVM-windowed.command"
echo ""
echo "See docs/DESKTOP.md for Linux packages Electron may need (GTK, NSS, ALSA)."
