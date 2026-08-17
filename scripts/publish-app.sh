#!/usr/bin/env bash
# Builds UI + core, packs tvm-app-<version>.tar.gz, and publishes a GitHub Release.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo"

version="${1:-}"
if [ -z "$version" ]; then
  version="$(node -p "require('./package.json').version")"
fi

echo "==> Building @tvm/core and @tvm/ui ($version)"
pnpm --filter @tvm/core run build
pnpm --filter @tvm/ui run build

stage="$repo/dist-release/app"
out="$repo/dist-release"
rm -rf "$stage"
mkdir -p "$stage/core" "$stage/ui"
cp -r "$repo/apps/core/dist/." "$stage/core/"
cp -r "$repo/apps/ui/dist/." "$stage/ui/"

tar_name="tvm-app-${version}.tar.gz"
tar_path="$out/$tar_name"
sha_path="$out/tvm-app-${version}.sha256"
tar -czf "$tar_path" -C "$stage" core ui

if command -v sha256sum >/dev/null; then
  (cd "$out" && sha256sum "$tar_name" > "$sha_path")
else
  shasum -a 256 "$tar_path" | awk '{print $1"  '"$tar_name"'"}' > "$sha_path"
fi

echo "==> $tar_name"
tag="v${version}"
gh release create "$tag" "$tar_path" "$sha_path" --title "$tag" --notes "App update ${version} (UI + core). Does not replace the OS image."
echo "==> Published $tag"
