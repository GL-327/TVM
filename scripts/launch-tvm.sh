#!/usr/bin/env bash
# Starts TVM on this PC: core + UI if needed, then the Electron shell.
# Default is fullscreen kiosk. Pass --windowed for a laptop window.
#
# Works from a git checkout (apps/core/src) and from the GitHub desktop
# tarball (core/index.js + ui/ next to this script).
set -euo pipefail

windowed=0
if [ "${1:-}" = "--windowed" ] || [ "${1:-}" = "-Windowed" ]; then
  windowed=1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -d "$here/apps/core" ]; then
  repo="$here"
elif [ -d "$here/../apps/core" ]; then
  repo="$(cd "$here/.." && pwd)"
elif [ -f "$here/core/index.js" ]; then
  repo="$here"
elif [ -f "$here/../core/index.js" ]; then
  repo="$(cd "$here/.." && pwd)"
else
  echo "Cannot find TVM. Run this from a git checkout or an extracted desktop package." >&2
  exit 1
fi

if [ -f "$repo/apps/core/src/index.ts" ]; then
  mode=source
elif [ -f "$repo/core/index.js" ]; then
  mode=package
else
  echo "TVM core is missing from $repo" >&2
  exit 1
fi

core_health="http://127.0.0.1:${TVM_CORE_PORT:-7345}/api/health"
ui_url="http://127.0.0.1:5173/"
package_ui="http://127.0.0.1:${TVM_CORE_PORT:-7345}/"

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

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 22 or newer is required. Install it from https://nodejs.org then run this again." >&2
    exit 1
  fi
  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  if [ "$major" -lt 22 ]; then
    echo "Node.js 22 or newer is required (found $(node -v))." >&2
    exit 1
  fi
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

open_url() {
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1 || true
  elif command -v open >/dev/null 2>&1; then
    open "$1" || true
  else
    echo "Open this address in a browser: $1"
  fi
}

print_log_tail() {
  local file="$1"
  if [ -f "$file" ]; then
    echo "Last log lines ($file):" >&2
    tail -n 20 "$file" >&2 || true
  fi
}

need_node
logs="$(log_dir)"
core_log="$logs/core.log"
ui_log="$logs/ui.log"

export TVM_CORE_BIND="${TVM_CORE_BIND:-127.0.0.1}"

if [ "$mode" = source ]; then
  export TVM_ENV="${TVM_ENV:-development}"
else
  export TVM_ENV="${TVM_ENV:-production}"
  export TVM_UI_DIST="${TVM_UI_DIST:-$repo/ui}"
fi

if ! http_ok "$core_health"; then
  echo "Starting TVM core..."
  if [ "$mode" = source ]; then
    if [ ! -f "$repo/apps/core/src/index.ts" ]; then
      echo "Core sources are missing. From a git checkout run: ./scripts/setup-desktop.sh" >&2
      exit 1
    fi
    (
      cd "$repo/apps/core"
      nohup node --watch src/index.ts >>"$core_log" 2>&1 &
    )
  else
    (
      cd "$repo"
      nohup node "$repo/core/index.js" >>"$core_log" 2>&1 &
    )
  fi
  if ! wait_http "$core_health" 60; then
    echo "TVM core did not start on $core_health" >&2
    print_log_tail "$core_log"
    exit 1
  fi
fi

if [ "$mode" = source ]; then
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
      echo "TVM UI did not start on $ui_url" >&2
      print_log_tail "$ui_log"
      exit 1
    fi
  fi
fi

shell_dir="$repo/apps/shell"
main_js="$shell_dir/dist/main.js"
shell_src="$shell_dir/src"

if [ "$mode" = source ] && [ -d "$shell_dir" ]; then
  needs_build=0
  if [ ! -f "$main_js" ]; then
    needs_build=1
  elif [ -d "$shell_src" ]; then
    set +e
    newer="$(find "$shell_src" -type f -newer "$main_js" 2>/dev/null | head -n 1)"
    set -e
    if [ -n "$newer" ]; then
      needs_build=1
    fi
  fi
  if [ "$needs_build" -eq 1 ]; then
    echo "Building TVM shell..."
    if command -v corepack >/dev/null 2>&1; then
      (cd "$shell_dir" && corepack pnpm run build)
    else
      (cd "$shell_dir" && pnpm run build)
    fi
  fi
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

if [ -z "$electron" ] && [ -f "$shell_dir/node_modules/electron/install.js" ]; then
  echo "Downloading Electron..."
  (cd "$shell_dir/node_modules/electron" && node install.js)
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
fi

if [ "$windowed" -eq 1 ]; then
  browser_url="${package_ui}?desktop=1"
  [ "$mode" = source ] && browser_url="http://127.0.0.1:5173/?desktop=1"
else
  browser_url="$package_ui"
  [ "$mode" = source ] && browser_url="http://127.0.0.1:5173/"
fi

if [ -z "$electron" ] || [ ! -f "$main_js" ]; then
  echo "Electron is not installed on this device. Opening TVM in the browser..."
  open_url "$browser_url"
  exit 0
fi

chmod +x "$electron" 2>/dev/null || true

case "$(uname -s)" in
  Darwin)
    user_data="$HOME/Library/Application Support/TVM/shell"
    xattr -dr com.apple.quarantine "$electron" 2>/dev/null || true
    ;;
  *)
    user_data="${XDG_CONFIG_HOME:-$HOME/.config}/TVM/shell"
    ;;
esac
mkdir -p "$user_data"

electron_args=(--user-data-dir="$user_data" dist/main.js)
case "$(uname -s)" in
  Linux)
    electron_args=(--ozone-platform-hint=auto "${electron_args[@]}")
    sandbox="$shell_dir/node_modules/electron/dist/chrome-sandbox"
    if [ -e "$sandbox" ]; then
      mode_bits="$(stat -c '%a' "$sandbox" 2>/dev/null || echo "")"
      if [ "$mode_bits" != "4755" ]; then
        electron_args=(--no-sandbox "${electron_args[@]}")
      fi
    fi
    ;;
esac

if [ "$windowed" -eq 1 ]; then
  export TVM_WINDOWED=1
  echo "Opening TVM (windowed)..."
else
  unset TVM_WINDOWED || true
  echo "Opening TVM fullscreen..."
fi

cd "$shell_dir"
exec "$electron" "${electron_args[@]}"
