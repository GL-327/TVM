#!/usr/bin/env bash
# Keeps the one public download page, the rolling `devices` release ("TVM Downloads"), current.
#
#   publish-device-package.sh FILE [FILE...]   upload these packages to it (each platform's build calls this)
#   publish-device-package.sh --sync           once every build has finished: republish it at the newest commit,
#                                              so it is dated today and stays at the top of the Releases page
#
# Installed apps update from separate pre-release channels (native-windows, android, *-ui). Those are not
# downloads and are never touched here.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 [--sync | file [file...]]" >&2
  exit 1
fi

FULL_SHA="${GITHUB_SHA:-$(git rev-parse HEAD)}"
SHA="${FULL_SHA:0:7}"
REPO="${GITHUB_REPOSITORY:-GL-327/TVM}"
BASE="https://github.com/$REPO/releases/download/devices"
ASSETS=(TVM.exe TVM.ipa TVM.apk TVM-desktop.zip TVM-web.zip TVM-roku.zip)

NOTES="$(mktemp)"
cat > "$NOTES" <<EOF
Latest build of \`main\` · \`$SHA\`

| Device | Download | How to install |
|---|---|---|
| **Windows** | [TVM.exe]($BASE/TVM.exe) | Run it. Installs to your user folder and opens TVM; no admin needed. |
| **iPhone & iPad** | [TVM.ipa]($BASE/TVM.ipa) | Unsigned. Sideload with Sideloadly, AltStore or SideStore. |
| **Android & Google TV** | [TVM.apk]($BASE/TVM.apk) | Open it on the device, or \`adb install TVM.apk\`. |
| **macOS & Linux** | [TVM-desktop.zip]($BASE/TVM-desktop.zip) | Needs Node.js 22+. Unzip, run \`TVM.command\` (macOS) or \`TVM.sh\` (Linux). |
| **Browser** | [TVM-web.zip]($BASE/TVM-web.zip) | Needs Node.js 22+. Unzip, run \`TVM-web.cmd\` or \`TVM-web.sh\`, open http://127.0.0.1:7345. |
| **Roku** | [TVM-roku.zip]($BASE/TVM-roku.zip) | Standalone channel. Enable developer mode, open the Roku's IP in a browser, upload the zip. |

Installed copies update themselves. The *Update channel* pre-releases below are what they read; they are not downloads.
EOF
trap 'rm -f "$NOTES"' EXIT

if [ "$1" = "--sync" ]; then
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE" "$NOTES"' EXIT

  # Everything currently on the page, so republishing never loses a package.
  gh release download devices --dir "$STAGE" --clobber 2>/dev/null || true
  uploads=()
  missing=()
  for name in "${ASSETS[@]}"; do
    if [ -s "$STAGE/$name" ]; then uploads+=("$STAGE/$name"); else missing+=("$name"); fi
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    # A package is missing (its build failed or has not published yet). Refresh the notes and the tag only:
    # deleting the release now would drop whatever is left.
    echo "Not republishing; missing: ${missing[*]}" >&2
    gh release edit devices --title "TVM Downloads" --notes-file "$NOTES" --latest
    gh api -X PATCH "repos/$REPO/git/refs/tags/devices" -f sha="$FULL_SHA" -F force=true >/dev/null 2>&1 || true
    exit 0
  fi

  gh release delete devices --yes --cleanup-tag 2>/dev/null || true
  gh api -X DELETE "repos/$REPO/git/refs/tags/devices" >/dev/null 2>&1 || true
  for attempt in 1 2 3 4; do
    if gh release create devices --title "TVM Downloads" --notes-file "$NOTES" --target "$FULL_SHA" --latest "${uploads[@]}"; then
      exit 0
    fi
    echo "Create attempt $attempt failed; retrying." >&2
    gh release delete devices --yes --cleanup-tag 2>/dev/null || true
    sleep $((attempt * 10))
  done
  exit 1
fi

gh release create devices --title "TVM Downloads" --notes-file "$NOTES" --target "$FULL_SHA" --latest 2>/dev/null \
  || gh release edit devices --title "TVM Downloads" --notes-file "$NOTES" --latest
gh api -X PATCH "repos/$REPO/git/refs/tags/devices" -f sha="$FULL_SHA" -F force=true >/dev/null 2>&1 || true

# Only the six packages belong on the page: anything else an older build left is removed.
for old in $(gh release view devices --json assets --jq '.assets[].name' 2>/dev/null || true); do
  keep=false
  for name in "${ASSETS[@]}"; do [ "$old" = "$name" ] && keep=true; done
  $keep || gh release delete-asset devices "$old" --yes || true
done

gh release upload devices "$@" --clobber
