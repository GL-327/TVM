# TVM appliance image

This directory builds the bootable TVM operating system: a Debian image that
powers on straight into the TVM interface, with no desktop, no login prompt and
no visible operating system.

## Read this first: what "USB boot" actually means

Plugging a flash drive into the **USB port on a television** will not start TVM.
Those ports read photos and video files; they cannot boot an operating system.
No image in this directory changes that.

What works is the same thing a Fire Stick does, only honestly:

```
[ USB stick ]  ->  [ small x86 computer ]  --HDMI-->  [ television ]
   TVM image         boots TVM from USB              acts as a display
```

The USB stick is the **boot disk for a computer**. The television is a screen
and a pair of speakers. The target machine is a mini-PC with UEFI firmware,
which is also the machine already sitting behind the kitchen TV.

## What the image contains

| Piece | Role |
| --- | --- |
| Debian 13 (trixie) | Base system, kernel, drivers |
| systemd-boot | UEFI boot, and later A/B slots for updates |
| `tvm-core.service` | The local service on `127.0.0.1`, which also serves the interface |
| `tvm-session.service` | Owns tty1 and starts the kiosk |
| Cage + Chromium | One compositor, one fullscreen window, nothing else |
| `/var/lib/tvm` | Persistent settings, credentials, cache. Survives updates |

The user `tvm` owns everything. Nothing in the product runs as root.

The Electron shell and the mpv video plane replace Chromium in Phase 6. The
session contract does not change: systemd starts one script, and restarts it if
it ever exits.

## Building

mkosi needs Linux. On this Windows development machine that means **WSL2**.

```bash
# Once, inside WSL2 (Debian or Ubuntu):
sudo apt install mkosi systemd-ukify systemd-boot-efi ovmf qemu-system-x86 mtools

# Every build:
cd os
./scripts/stage-app.sh     # builds the workspace into os/staging/
mkosi --force              # produces output/tvm-appliance.raw
```

`stage-app.sh` compiles core and the UI and lays them out under
`staging/usr/lib/tvm/`, which mkosi copies into the image.

## Booting it in a VM

```bash
mkosi vm                          # quickest loop
./scripts/qemu-smoke.sh           # boots the exact artifact that gets flashed
```

Work through [BOOT_CHECKLIST.md](BOOT_CHECKLIST.md) rather than eyeballing it.

## Writing it to USB

The image is a raw disk image. Write it to the **whole device**, not to a
partition, and note that this erases the stick.

**Windows**

1. [Rufus](https://rufus.ie): select `tvm-appliance.raw`, choose DD Image mode
   when prompted, target the USB device, write.
2. Or [balenaEtcher](https://etcher.balena.io): Flash from file, select the
   device, Flash.

**Linux**

```bash
sudo dd if=output/tvm-appliance.raw of=/dev/sdX bs=4M status=progress conv=fsync
```

Check `lsblk` twice before running that. `/dev/sdX` is the stick, not a
partition such as `/dev/sdX1`, and picking the wrong device destroys a disk.

## Booting on real hardware

1. Plug the USB stick and an HDMI cable into the mini-PC, and a USB or
   Bluetooth remote receiver into a spare port.
2. Enter firmware setup, usually Del, F2, F10 or F12 at power-on.
3. **Disable Secure Boot.** The image is unsigned in v1; signed UKIs come later.
4. Set the USB device first in the boot order, or use the one-off boot menu.
5. Save and reboot. TVM should appear without a boot log, a cursor or a login
   prompt.

## Status

**Built and booted.** The image was built with mkosi 25.3 under WSL2 Debian 13
and booted in QEMU with OVMF and KVM. It reaches the TVM splash with no
desktop, no login prompt and no boot log, core reports healthy, and a keyboard
drives the interface: arrows move focus, OK opens the system panel, and Back
closes it and restores focus to where it was.

Not yet done: **real hardware**. Section D of
[BOOT_CHECKLIST.md](BOOT_CHECKLIST.md) needs a mini-PC, a television and a
remote, and nothing below substitutes for it.

Two things to know before the next build:

- **Boot to splash took roughly 150 seconds** in QEMU on a first boot. That is
  far too slow for an appliance. It has not been measured on a second boot or
  on real hardware, so measure before optimising. Boot time is a Phase 11 item.
- **A pointer cursor is visible under QEMU**, because QEMU attaches a mouse.
  This matches the intent, which is no cursor unless a pointer exists, but it
  means the cursor question can only really be settled on hardware.
