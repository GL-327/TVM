#!/usr/bin/env bash
# Builds the workspace and lays it out the way the image expects.
#
# Produces os/staging/, which mkosi.conf copies into the image as ExtraTrees.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
os_dir="$(dirname "$here")"
repo="$(dirname "$os_dir")"
staging="$os_dir/staging"

echo "==> Building workspace"
cd "$repo"
pnpm install --frozen-lockfile
pnpm --filter @tvm/core run build
pnpm --filter @tvm/ui run build

echo "==> Staging into $staging"
rm -rf "$staging"
mkdir -p "$staging/usr/lib/tvm/core" "$staging/usr/lib/tvm/ui"

cp -r "$repo/apps/core/dist/." "$staging/usr/lib/tvm/core/"
cp -r "$repo/apps/ui/dist/." "$staging/usr/lib/tvm/ui/"

echo "==> Staged:"
find "$staging" -maxdepth 4 -mindepth 3 -type d | sed 's|^|    |'
echo "Now run: cd $os_dir && mkosi --force"
