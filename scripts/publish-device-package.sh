#!/usr/bin/env bash
# Copy installables onto the rolling `devices` GitHub release — the same
# set of files Device Variations/fetch-ipa.ps1 pulls onto disk. One file per
# platform, so nobody has to guess which of three IPAs is theirs.
set -euo pipefail
if [ "$#" -lt 1 ]; then
  echo "usage: $0 file [file...]" >&2
  exit 1
fi
NOTES="$(mktemp)"
FULL_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
SHA="${FULL_SHA:0:7}"
cat > "$NOTES" <<EOF
# TVM downloads

Current installers for Windows, macOS/Linux, iOS, Android, Roku, and mobile/desktop web browsers (build \`$SHA\`).

| Platform | Download | How to install |
|---|---|---|
| **Windows** | [**TVM.exe**](https://github.com/GL-327/TVM/releases/download/devices/TVM.exe) | Single compiled EXE — download and double-click to install and open TVM (includes Core, UI, and Node). |
| **iPhone & iPad** | [**TVM.ipa**](https://github.com/GL-327/TVM/releases/download/devices/TVM.ipa) | Sideloadable app (not on the App Store). Sign and install with Sideloadly, AltStore, or SideStore using your Apple ID. |
| **Android & Google TV** | [**TVM.apk**](https://github.com/GL-327/TVM/releases/download/devices/TVM.apk) | Standalone Android APK — open on phone/tablet or sideload with \`adb install TVM.apk\`. |
| **macOS & Linux** | [**TVM-desktop.zip**](https://github.com/GL-327/TVM/releases/download/devices/TVM-desktop.zip) | Requires Node.js 22+; extract and run \`TVM.command\` (macOS) or \`TVM.sh\` (Linux). |
| **Web host** | [**TVM-web.zip**](https://github.com/GL-327/TVM/releases/download/devices/TVM-web.zip) | Requires Node.js 22+; run \`TVM-web.cmd\` or \`TVM-web.sh\`, then open \`http://127.0.0.1:7345/\`. |
| **Roku** | [**TVM-roku.zip**](https://github.com/GL-327/TVM/releases/download/devices/TVM-roku.zip) | Developer-mode Roku channel; connects to a TVM Core running on your computer. |

Read the [README and installation guide](https://github.com/GL-327/TVM#readme) for what TVM does, accounts, media connections, LAN setup, and updates.
EOF
gh release create devices --title "TVM downloads — every platform" --notes-file "$NOTES" --latest 2>/dev/null \
  || gh release edit devices --title "TVM downloads — every platform" --notes-file "$NOTES" --latest
rm -f "$NOTES"

if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/git/refs/tags/devices" -f sha="$FULL_SHA" -F force=true >/dev/null 2>&1 || true
fi

# Each platform's job calls this with its own file, so only replace what it
# brought, and clear the older names that file supersedes.
for file in "$@"; do
  name="$(basename "$file")"
  case "$name" in
    TVM.exe) stale="TVM-native-windows.zip" ;;
    TVM.ipa) stale="TVM-ios.ipa TVM-unsigned.ipa" ;;
    TVM.apk) stale="TVM-android.apk" ;;
    TVM-desktop.zip) stale="$(gh release view devices --json assets --jq '.assets[].name | select(startswith("TVM-desktop-"))' 2>/dev/null || true)" ;;
    *) stale="" ;;
  esac
  for old in $stale; do
    gh release delete-asset devices "$old" --yes || true
  done
done
uploads=()
for file in "$@"; do uploads+=("$file"); done
gh release upload devices "${uploads[@]}" --clobber
