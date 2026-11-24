#!/usr/bin/env bash
# Updates the rolling `devices` release with the latest platform packages.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 [--sync | file [file...]]" >&2
  exit 1
fi

FULL_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
SHA="${FULL_SHA:0:7}"
NOTES="$(mktemp)"
cat > "$NOTES" <<EOF
Latest builds from \`main\` (\`$SHA\`).

| Platform | File | Notes |
|---|---|---|
| Windows | [TVM.exe](https://github.com/GL-327/TVM/releases/download/devices/TVM.exe) | Run to install and launch TVM. |
| iPhone & iPad | [TVM.ipa](https://github.com/GL-327/TVM/releases/download/devices/TVM.ipa) | Unsigned IPA; sideload with Sideloadly, AltStore, or SideStore. |
| Android & Google TV | [TVM.apk](https://github.com/GL-327/TVM/releases/download/devices/TVM.apk) | Install directly or with \`adb install TVM.apk\`. |
| macOS & Linux | [TVM-desktop.zip](https://github.com/GL-327/TVM/releases/download/devices/TVM-desktop.zip) | Requires Node.js 22+; run \`TVM.command\` (macOS) or \`TVM.sh\` (Linux). |
| Web | [TVM-web.zip](https://github.com/GL-327/TVM/releases/download/devices/TVM-web.zip) | Requires Node.js 22+; run \`TVM-web.cmd\` or \`TVM-web.sh\`. |
| Roku | [TVM-roku.zip](https://github.com/GL-327/TVM/releases/download/devices/TVM-roku.zip) | Standalone Roku channel (no PC server needed); upload in developer mode. |

See the [README](https://github.com/GL-327/TVM#readme) for setup details.
EOF

if [ "${1:-}" = "--sync" ]; then
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE" "$NOTES"' EXIT

  fetch_from_tag() {
    local tag="$1" asset="$2"
    gh release download "$tag" --pattern "$asset" --dir "$STAGE" 2>/dev/null || true
  }

  fetch_from_tag native-windows TVM.exe
  fetch_from_tag ios TVM.ipa
  fetch_from_tag android TVM.apk
  fetch_from_tag desktop TVM-desktop.zip
  fetch_from_tag web TVM-web.zip
  fetch_from_tag roku TVM-roku.zip

  uploads=()
  for name in TVM.exe TVM.ipa TVM.apk TVM-desktop.zip TVM-web.zip TVM-roku.zip; do
    if [ -f "$STAGE/$name" ]; then
      uploads+=("$STAGE/$name")
    fi
  done

  if [ "${#uploads[@]}" -eq 0 ]; then
    echo "No release assets found to publish." >&2
    exit 1
  fi

  gh release delete devices --yes --cleanup-tag 2>/dev/null || true
  if [ -n "${GITHUB_REPOSITORY:-}" ]; then
    gh api -X DELETE "repos/$GITHUB_REPOSITORY/git/refs/tags/devices" >/dev/null 2>&1 || true
  fi
  gh release create devices --title "TVM Downloads" --notes-file "$NOTES" --target "$FULL_SHA" --latest "${uploads[@]}"
  exit 0
fi

trap 'rm -f "$NOTES"' EXIT

gh release create devices --title "TVM Downloads" --notes-file "$NOTES" --latest 2>/dev/null \
  || gh release edit devices --title "TVM Downloads" --notes-file "$NOTES" --latest

if [ -n "${GITHUB_REPOSITORY:-}" ]; then
  gh api -X PATCH "repos/$GITHUB_REPOSITORY/git/refs/tags/devices" -f sha="$FULL_SHA" -F force=true >/dev/null 2>&1 || true
fi

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
