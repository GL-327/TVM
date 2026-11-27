#!/usr/bin/env bash
# The Android app is restored to how it was on 18 November 2026 (commit in UI_PIN). Its interface is the shared
# React UI as it was at that commit, not today's apps/ui (which web, iPhone and desktop keep using). This builds that
# interface in a worktree of the pinned commit with that commit's own scripts and lockfile, and copies the result
# into this checkout's Android assets. Android's own edits to that interface live in apps/android/ui-patches.
#
#   bash apps/android/build-pinned-ui.sh                 the APK's bundled assets (mobile.yml)
#   bash apps/android/build-pinned-ui.sh --feed <dir>    also the android-ui feed bundle and manifest (ui-feed.yml)
#
# Needs the full history (actions/checkout with fetch-depth: 0). To move Android forward, change UI_PIN on purpose.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
PIN="$(tr -d '[:space:]' < "$ROOT/apps/android/UI_PIN")"
WORK="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tvm-android-pin"
FEED=""
if [ "${1:-}" = "--feed" ]; then FEED="$(mkdir -p "$2" && cd "$2" && pwd)"; fi

git -C "$ROOT" worktree remove --force "$WORK" 2>/dev/null || rm -rf "$WORK"
git -C "$ROOT" worktree add --detach "$WORK" "$PIN"

cd "$WORK"
# Android's own changes on top of that interface (sign-in clean-up and invite code, Sleep timer and Stats pickers),
# kept as patches so the 18 November look stays exactly as it was.
for patch in "$ROOT"/apps/android/ui-patches/*.patch; do
  [ -e "$patch" ] && git apply --whitespace=nowarn "$patch"
done
corepack pnpm install --frozen-lockfile
node apps/android/bundle-ui.mjs
node scripts/export-access.mjs
node apps/android/export-fallback-catalog.mjs
node scripts/write-build-info.mjs android
node scripts/stamp-ui-bundle.mjs apps/android/app/src/main/assets/ui android

ASSETS="apps/android/app/src/main/assets"
mkdir -p "$ROOT/$ASSETS"
cp -a "$WORK/$ASSETS/." "$ROOT/$ASSETS/"

if [ -n "$FEED" ]; then
  # ustar keeps every entry a plain header the phone's extractor reads.
  tar --format=ustar -czf "$FEED/tvm-android-ui.tar.gz" -C "$WORK/$ASSETS/ui" .
  node scripts/write-update-feed.mjs --channel android-ui --asset "$FEED/tvm-android-ui.tar.gz" \
    --out "$FEED/tvm-android-ui.json" --bundle "$WORK/$ASSETS/ui"
fi

test -f "$ROOT/$ASSETS/ui/index.html"
test -f "$ROOT/$ASSETS/ui/build-info.json"
test -f "$ROOT/$ASSETS/BuildInfo.json"
test -f "$ROOT/$ASSETS/Access.json"
echo "Android interface built from $PIN"
