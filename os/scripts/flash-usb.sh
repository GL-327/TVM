#!/usr/bin/env bash
# Writes tvm-appliance.raw to a whole-disk device. This erases the target.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
os_dir="$(dirname "$here")"
image="${2:-$os_dir/output/tvm-appliance.raw}"
device="${1:-}"

if [[ -z "$device" ]]; then
    echo "Usage: $0 /dev/sdX [path/to/tvm-appliance.raw]" >&2
    echo "Check lsblk twice. Pass the disk, not a partition such as /dev/sdX1." >&2
    exit 1
fi

if [[ ! -f "$image" ]]; then
    echo "Image not found: $image" >&2
    echo "Run: ./scripts/stage-app.sh && mkosi --force" >&2
    exit 1
fi

if [[ ! -b "$device" ]]; then
    echo "Not a block device: $device" >&2
    exit 1
fi

if [[ "$device" =~ [0-9]$ ]]; then
    echo "Pass the disk, not a partition: $device looks like a partition." >&2
    exit 1
fi

echo "Image:  $image"
echo "Target: $device"
lsblk "$device"
echo "This erases $device. Waiting 5 seconds. Ctrl+C to abort."
sleep 5
sudo dd if="$image" of="$device" bs=4M status=progress conv=fsync
echo "Done. Plug the stick into the mini-PC and boot USB first, Secure Boot off."
