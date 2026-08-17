#!/usr/bin/env bash
# Starts Core in development (LAN bind), the Vite UI, and a 1920x1080 TV frame
# of the desktop app. Rebuilds the sideload zip.
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

echo "TVM Roku helper"
echo ""
export TVM_ENV=development

if ! http_ok "$health_url"; then
  echo "Starting TVM core with TVM_ENV=development..."
  (cd "$repo/apps/core" && TVM_ENV=development node --watch src/index.ts >/dev/null 2>&1 &)
  if ! wait_http "$health_url" 40; then
    echo "TVM core did not start on http://127.0.0.1:7345" >&2
    exit 1
  fi
else
  echo "Core is already running on http://127.0.0.1:7345"
fi

if ! http_ok "$ui_url"; then
  echo "Starting TVM UI..."
  vite="$repo/apps/ui/node_modules/vite/bin/vite.js"
  (cd "$repo/apps/ui" && node "$vite" >/dev/null 2>&1 &)
  if ! wait_http "$ui_url" 40; then
    echo "TVM UI did not start on http://127.0.0.1:5173" >&2
    exit 1
  fi
else
  echo "UI is already running on http://127.0.0.1:5173"
fi

echo ""
echo "PC preview (same desktop UI, 1920x1080 TV frame):"
echo "  $preview_url"
echo "  Arrows move, Enter is OK, Esc or Backspace is Back."
echo ""

if [ "$no_package" -eq 0 ]; then
  echo "Packaging the sideload zip..."
  node "$repo/apps/roku/scripts/package.mjs"
  echo "Sideload zip: $repo/apps/roku/tvm-roku.zip"
fi

if [ "$no_browser" -eq 0 ]; then
  echo "Opening the desktop UI in a 1920x1080 TV frame..."
  if command -v xdg-open >/dev/null; then
    xdg-open "$preview_url" >/dev/null 2>&1 || true
  elif command -v open >/dev/null; then
    open "$preview_url" || true
  fi
fi
