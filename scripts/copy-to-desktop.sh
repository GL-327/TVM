#!/usr/bin/env bash
# Copies the laptop desktop app and the Roku package onto this PC's Desktop.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

resolve_desktop() {
  if [ -n "${1:-}" ]; then
    mkdir -p "$1"
    cd "$1" && pwd
    return
  fi

  if [ "$(uname -s)" = Darwin ]; then
    desktop="$(osascript -e 'POSIX path of (path to desktop folder)' 2>/dev/null || true)"
    desktop="${desktop%/}"
    if [ -n "$desktop" ]; then
      mkdir -p "$desktop"
      cd "$desktop" && pwd
      return
    fi
  fi

  for path in "${HOME}/Desktop" "${HOME}/desktop" "${HOME}/OneDrive/Desktop"; do
    if [ -d "$path" ]; then
      cd "$path" && pwd
      return
    fi
  done

  mkdir -p "${HOME}/Desktop"
  cd "${HOME}/Desktop" && pwd
}

dest="$(resolve_desktop "${1:-}")"
launch="$(printf '%q' "$repo/scripts/launch-tvm.sh")"
roku="$(printf '%q' "$repo/scripts/roku-dev.sh")"

write_exec() {
  local path="$1"
  local body="$2"
  printf '%s\n' "$body" > "$path"
  chmod +x "$path"
}

write_exec "$dest/TVM.sh" "$(cat <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec $launch --windowed
EOF
)"

write_exec "$dest/TVM-roku.sh" "$(cat <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec $roku "\$@"
EOF
)"

if [ "$(uname -s)" = Darwin ]; then
  write_exec "$dest/TVM.command" "$(cat <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec $launch --windowed
EOF
)"
  write_exec "$dest/TVM Roku.command" "$(cat <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec $roku "\$@"
EOF
)"
fi

if [ "$(uname -s)" = Linux ]; then
  cat > "$dest/TVM.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=TVM
Comment=TVM laptop window
Exec=$repo/scripts/launch-tvm.sh --windowed
Terminal=true
Categories=AudioVideo;Video;
StartupNotify=true
EOF
  chmod +x "$dest/TVM.desktop"
fi

echo "Packaging the Roku sideload zip..."
node "$repo/apps/roku/scripts/package.mjs"
cp -f "$repo/apps/roku/tvm-roku.zip" "$dest/TVM-roku.zip"

echo "Copied laptop TVM and TVM Roku to $dest"
echo "  TVM.sh           windowed desktop app (fits a laptop screen)"
if [ "$(uname -s)" = Darwin ]; then
  echo "  TVM.command      same launcher, double-click in Finder"
fi
if [ "$(uname -s)" = Linux ]; then
  echo "  TVM.desktop      same launcher for the desktop environment"
fi
echo "  TVM-roku.sh      TV-frame preview + rebuilds the sideload zip"
echo "  TVM-roku.zip     sideload this onto a developer-mode Roku"
