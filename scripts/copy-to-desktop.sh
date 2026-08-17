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

cat > "$dest/TVM.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec $(printf '%q' "$repo/scripts/launch-tvm.sh") --windowed
EOF
chmod +x "$dest/TVM.sh"

cat > "$dest/TVM-roku.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
exec $(printf '%q' "$repo/scripts/roku-dev.sh") "\$@"
EOF
chmod +x "$dest/TVM-roku.sh"

echo "Packaging the Roku sideload zip..."
node "$repo/apps/roku/scripts/package.mjs"
cp -f "$repo/apps/roku/tvm-roku.zip" "$dest/TVM-roku.zip"

echo "Copied laptop TVM and TVM Roku to $dest"
echo "  TVM.sh           windowed desktop app (fits a laptop screen)"
echo "  TVM-roku.sh      TV-frame preview + rebuilds the sideload zip"
echo "  TVM-roku.zip     sideload this onto a developer-mode Roku"
