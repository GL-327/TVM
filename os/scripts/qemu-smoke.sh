#!/usr/bin/env bash
# Boots the built image the way real UEFI firmware would.
#
# `mkosi vm` is the quicker loop. This script exists because it boots the exact
# artifact that gets flashed to USB, through OVMF, with nothing mkosi injects.
set -euo pipefail

image="${1:-output/tvm-appliance.raw}"

if [[ ! -f "$image" ]]; then
    echo "Image not found: $image" >&2
    echo "Run scripts/stage-app.sh then mkosi --force" >&2
    exit 1
fi

firmware=""
for candidate in \
    /usr/share/OVMF/OVMF_CODE_4M.fd \
    /usr/share/OVMF/OVMF_CODE.fd \
    /usr/share/ovmf/OVMF.fd \
    /usr/share/edk2/x64/OVMF_CODE.4m.fd
do
    if [[ -f "$candidate" ]]; then
        firmware="$candidate"
        break
    fi
done

if [[ -z "$firmware" ]]; then
    echo "No OVMF firmware found. Install the ovmf package." >&2
    exit 1
fi

accel="tcg"
[[ -w /dev/kvm ]] && accel="kvm"
echo "==> Booting $image with $firmware (accel=$accel)"

exec qemu-system-x86_64 \
    -machine q35,accel="$accel" \
    -m 4096 \
    -smp 4 \
    -drive "if=pflash,format=raw,readonly=on,file=$firmware" \
    -drive "file=$image,format=raw,if=virtio" \
    -device virtio-vga-gl \
    -display gtk,gl=on \
    -device virtio-net-pci,netdev=net0 \
    -netdev user,id=net0 \
    -device qemu-xhci \
    -device usb-kbd
