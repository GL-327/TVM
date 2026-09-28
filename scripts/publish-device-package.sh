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
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat > "$NOTES" <<EOF
**Every installable, same commit \`$SHA\`.**

This is Device Variations on GitHub. One file per device:

| File | Device | Setting it up |
| --- | --- | --- |
| \`TVM.ipa\` | iPhone & iPad | Unsigned. Re-sign with [Sideloadly](https://sideloadly.io) or AltStore, then trust the certificate in **Settings → General → VPN & Device Management**. [Full steps](https://github.com/GL-327/TVM/releases/tag/ios) |
| \`TVM.apk\` | Android phone, tablet & TV | Open it on the phone and allow installs from that source. On a TV: \`adb install TVM.apk\`. [Full steps](https://github.com/GL-327/TVM/releases/tag/android) |
| \`TVM-roku.zip\` | Roku players & Roku TV | Enable developer mode on the Roku, then upload the zip at \`http://<roku-ip>\` and press Install. [Full steps](https://github.com/GL-327/TVM/releases/tag/roku) |
| \`TVM-desktop.zip\` | Windows, macOS & Linux | Needs [Node.js 22+](https://nodejs.org). Extract, then run \`TVM.cmd\`, \`TVM.command\` or \`./TVM.sh\`. [Full steps](https://github.com/GL-327/TVM/releases/tag/desktop) |

The desktop updates itself completely. Phones and the desktop both refresh
their interface from GitHub when they open; the app around it changes only
when you install the file again, and **Account → Updates** says when that is
needed and which build you are on. A Roku is sideloaded, so it is always
installed by hand.
EOF
gh release create devices --title "Device Variations — every platform" --notes-file "$NOTES" 2>/dev/null \
  || gh release edit devices --title "Device Variations — every platform" --notes-file "$NOTES"
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
gh release upload devices "$@" --clobber
