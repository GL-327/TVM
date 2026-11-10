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

Current installers for Windows, macOS/Linux, iOS, Android, Roku and mobile/desktop web browsers. Release target: \`$SHA\`.

- **TVM-native-windows.zip** — Windows C++ desktop, with Core/UI and Node included. Extract everything and run TVM.cmd.
- **TVM-desktop.zip** — macOS/Linux browser desktop. Requires Node.js 22+; run TVM.command or TVM.sh.
- **TVM-web.zip** — responsive web client with its Core host. Requires Node.js 22+; run TVM-web.cmd or TVM-web.sh. Works in mobile and desktop browsers.
- **TVM.apk** — Android phone/tablet/TV package.
- **TVM.ipa** — iPhone/iPad package. Requires signing with your Apple account/team before sideloading.
- **TVM-roku.zip** — developer-mode Roku channel; connects to a TVM Core on your computer.

Read the [README and installation guide](https://github.com/GL-327/TVM#readme) for what TVM does, accounts, media connections, LAN setup and updates.

Each workflow updates its own file. The asset label records its source commit. Automatic-update component feeds remain separate from these installer downloads.
EOF
gh release create devices --title "TVM downloads — every platform" --notes-file "$NOTES" --latest 2>/dev/null \
  || gh release edit devices --title "TVM downloads — every platform" --notes-file "$NOTES" --latest
rm -f "$NOTES"

# Each platform's job calls this with its own file, so only replace what it
# brought, and clear the older names that file supersedes.
for file in "$@"; do
  name="$(basename "$file")"
  case "$name" in
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
for file in "$@"; do uploads+=("$file#$FULL_SHA"); done
gh release upload devices "${uploads[@]}" --clobber
