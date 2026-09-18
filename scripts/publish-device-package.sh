#!/usr/bin/env bash
# Copy installables onto the rolling `devices` GitHub release — the same
# set of files Device Variations/fetch-ipa.ps1 pulls onto disk.
set -euo pipefail
if [ "$#" -lt 1 ]; then
  echo "usage: $0 file [file...]" >&2
  exit 1
fi
NOTES="$(mktemp)"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
cat > "$NOTES" <<EOF
**Every installable, same commit \`$SHA\`.**

This is Device Variations on GitHub. Grab the file for your device:

| File | Device |
| --- | --- |
| \`TVM.ipa\` / \`TVM-ios.ipa\` / \`TVM-unsigned.ipa\` | iPhone & iPad — re-sign with Sideloadly or AltStore |
| \`TVM.apk\` / \`TVM-android.apk\` | Android phone, tablet and TV |
| \`TVM-roku.zip\` | Roku players and Roku TV |
| \`TVM-desktop-*.tar.gz\` | Windows, macOS and Linux |

Installed copies check GitHub when opened and pull a newer interface if one is published. A new IPA/APK/zip is only needed when the native half changes; the Updates screen says so.
EOF
gh release create devices --title "Device Variations — every platform" --notes-file "$NOTES" 2>/dev/null \
  || gh release edit devices --title "Device Variations — every platform" --notes-file "$NOTES"
rm -f "$NOTES"
gh release upload devices "$@" --clobber
