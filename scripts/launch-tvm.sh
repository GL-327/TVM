#!/usr/bin/env bash
# Starts TVM on this PC: core + Vite if needed, then the Electron shell.
# Default is fullscreen kiosk. Pass --windowed for a laptop window.
set -euo pipefail

windowed=0
if [ "${1:-}" = "--windowed" ] || [ "${1:-}" = "-Windowed" ]; then
  windowed=1
fi

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
core_health="http://127.0.0.1:7345/api/health"
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

if ! http_ok "$core_health"; then
  echo "Starting TVM core..."
  if [ "$windowed" -eq 1 ]; then
    export TVM_ENV=development
  fi
  (cd "$repo/apps/core" && node --watch src/index.ts >/dev/null 2>&1 &)
  if ! wait_http "$core_health" 40; then
    echo "TVM core did not start on http://127.0.0.1:7345" >&2
    exit 1
  fi
fi

if ! http_ok "$ui_url"; then
  echo "Starting TVM UI..."
  vite="$repo/apps/ui/node_modules/vite/bin/vite.js"
  (cd "$repo/apps/ui" && node "$vite" >/dev/null 2>&1 &)
  if ! wait_http "$ui_url" 40; then
    echo "TVM UI did not start on http://127.0.0.1:5173" >&2
    exit 1
  fi
fi

shell_dir="$repo/apps/shell"
main_js="$shell_dir/dist/main.js"
if [ ! -f "$main_js" ]; then
  echo "Building TVM shell..."
  (cd "$shell_dir" && corepack pnpm run build)
fi

electron=""
for candidate in \
  "$shell_dir/node_modules/electron/dist/electron" \
  "$shell_dir/node_modules/electron/dist/electron.exe" \
  "$shell_dir/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
do
  if [ -x "$candidate" ] || [ -f "$candidate" ]; then
    electron="$candidate"
    break
  fi
done

if [ -z "$electron" ]; then
  echo "Electron is not installed. From the TVM folder run: corepack pnpm --filter @tvm/shell install" >&2
  exit 1
fi

user_data="${XDG_CONFIG_HOME:-$HOME/.config}/TVM/shell"
mkdir -p "$user_data"

export TVM_ENV=development
if [ "$windowed" -eq 1 ]; then
  export TVM_WINDOWED=1
  echo "Opening TVM (windowed)..."
else
  echo "Opening TVM fullscreen..."
fi

cd "$shell_dir"
exec "$electron" --user-data-dir="$user_data" dist/main.js
