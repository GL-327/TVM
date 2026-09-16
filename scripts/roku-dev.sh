#!/usr/bin/env bash
# Starts Core on loopback, the Vite UI, and a 1920x1080 TV frame
# of the desktop app. Rebuilds the sideload zip. Does not probe Wi-Fi.
set -euo pipefail

no_browser=0
no_package=0
for arg in "$@"; do
  case "$arg" in
    --no-browser|-NoBrowser) no_browser=1 ;;
    --no-package|-NoPackage) no_package=1 ;;
  esac
done

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
preview_url="http://127.0.0.1:5173/?tv=1"
health_url="http://127.0.0.1:7345/api/health"
ui_url="http://127.0.0.1:5173/"

http_ok() {
  curl -fsS --max-time 2 -o /dev/null "$1" 2>/dev/null
}

wait_http() {
  local url="$1"
  local seconds="$2"
  local i=0
  while [ "$i" -lt $((seconds * 4)) ]; do
    if http_ok "$url"; then return 0; fi
    sleep 0.25
    i=$((i + 1))
  done
  return 1
}

log_dir() {
  case "$(uname -s)" in
    Darwin)
      mkdir -p "$HOME/Library/Logs/TVM"
      echo "$HOME/Library/Logs/TVM"
      ;;
    *)
      local dir="${XDG_STATE_HOME:-$HOME/.local/state}/tvm"
      mkdir -p "$dir"
      echo "$dir"
      ;;
  esac
}

print_log_tail() {
  local file="$1"
  if [ -f "$file" ]; then
    echo "Last log lines ($file):" >&2
    tail -n 20 "$file" >&2 || true
  fi
}

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required. https://nodejs.org" >&2
  exit 1
fi

echo "TVM Roku helper"
echo ""
export TVM_ENV=development
export TVM_CORE_BIND=127.0.0.1
logs="$(log_dir)"
core_log="$logs/core.log"
ui_log="$logs/ui.log"

if ! http_ok "$health_url"; then
  echo "Starting TVM core on loopback (no Wi-Fi required)..."
  if [ ! -f "$repo/apps/core/src/index.ts" ]; then
    echo "Core sources are missing. From a git checkout run: ./scripts/setup-desktop.sh" >&2
    exit 1
  fi
  (
    cd "$repo/apps/core"
    nohup node --watch src/index.ts >>"$core_log" 2>&1 &
  )
  if ! wait_http "$health_url" 60; then
    echo "TVM core did not start on http://127.0.0.1:7345" >&2
    print_log_tail "$core_log"
    exit 1
  fi
else
  echo "Core is already running on http://127.0.0.1:7345"
fi

if ! http_ok "$ui_url"; then
  echo "Starting TVM UI..."
  vite="$repo/apps/ui/node_modules/vite/bin/vite.js"
  if [ ! -f "$vite" ]; then
    echo "UI dependencies are missing. From a git checkout run: ./scripts/setup-desktop.sh" >&2
    exit 1
  fi
  (
    cd "$repo/apps/ui"
    nohup node "$vite" >>"$ui_log" 2>&1 &
  )
  if ! wait_http "$ui_url" 40; then
    echo "TVM UI did not start on http://127.0.0.1:5173" >&2
    print_log_tail "$ui_log"
    exit 1
  fi
else
  echo "UI is already running on http://127.0.0.1:5173"
fi

echo ""
echo "PC preview (same desktop UI, 1920x1080 TV frame):"
echo "  $preview_url"
echo "  Arrows move, Enter is OK, Esc or Backspace is Back."
echo "  This runs on this computer. A Wi-Fi adapter is not required."
echo ""

if [ "$no_browser" -eq 0 ]; then
  echo "Opening TVM..."
  if command -v xdg-open >/dev/null; then
    xdg-open "$preview_url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null; then
    open "$preview_url" || true
  else
    echo "Open this address in a browser: $preview_url"
  fi
fi

if [ "$no_package" -eq 0 ]; then
  echo "Packaging the sideload zip..."
  if ! node "$repo/apps/roku/scripts/package.mjs"; then
    echo "Sideload zip skipped. TVM is still open."
  else
    echo "Sideload zip: $repo/apps/roku/tvm-roku.zip"
  fi
fi
