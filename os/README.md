# TVM appliance image

This directory builds the bootable TVM operating system: a Debian image that
powers on straight into the TVM interface, fullscreen, with no login prompt.
A Linux desktop exists behind the app and is opened from Settings; it is not
shown at boot.

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
| `tvm-session.service` | Owns tty1 and starts the fullscreen kiosk |
| Cage + Chromium | One compositor, one fullscreen window at boot |
| labwc desktop | Optional, opened from Settings → Linux desktop |
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

## How big a stick, and why

Measured on the first real build:

| Part | Size |
| --- | --- |
| Root filesystem, used | 1.6 GB |
| Chromium | 371 MB |
| Graphics libraries, mostly Mesa and Vulkan | 698 MB |
| Kernel modules | 119 MB |
| Locales, docs and manuals | 116 MB |
| Whole disk image | 2.7 GB |

**A 2 GB stick will not work, and is not worth making work.** Roughly 400 MB
could be cut by deleting locales, documentation and the Vulkan drivers, but
that still does not fit, and the obvious remaining saving is a trap: shrinking
the 125 MB initrd means building it for one machine's hardware with
`MODULES=dep`, which is precisely wrong for a stick whose purpose is to boot
on any machine. Keep the generic initrd.

The architecture also outgrows a small stick almost immediately. Phase 8 wants
A/B update slots, which means two root partitions plus a persistent data
partition, so the real floor is more like 8 GB.

**Buy a 32 GB USB 3.0 stick.** It costs a few pounds, and a USB 2.0 stick would
make the already-slow boot considerably worse, since everything above has to be
read before anything appears on the television.

Trimming the image is still worthwhile later, for faster writes and cheaper A/B
updates. That is Phase 10 work, and it should never be done by making the image
less portable.

## Writing it to USB

The image is a raw disk image. Write it to the **whole device**, not to a
partition, and note that this erases the stick.

On this development PC the stick is usually **D:**. Step-by-step flashing,
including a copy of the kit onto that drive, is in [USB.md](USB.md).

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

### Before you start

Have these to hand, because discovering one is missing mid-way wastes a reboot:

- A mini-PC with UEFI firmware, plugged into the television by HDMI
- A 32 GB USB 3.0 stick, written as above
- **A USB keyboard.** Not optional for the first boot. The remote is what is
  being tested, so it cannot also be the thing you rely on when the test fails
- The television's own remote, to select the right HDMI input

### What should happen, stage by stage

Knowing what each stage looks like is what makes a failure diagnosable, since
each one fails at a recognisable point.

| Stage | On screen | If it stalls here |
| --- | --- | --- |
| 1. Firmware | Manufacturer logo | The stick is not being booted from. Recheck boot order and Secure Boot |
| 2. systemd-boot | Brief menu, or straight past it | The stick was written to a partition rather than the whole device |
| 3. Kernel and initrd | Blank, or a cursor blink | Hardware the generic initrd cannot handle. Note the model |
| 4. systemd starts | Blank, deliberately | See "when it fails" below |
| 5. Kiosk | The TVM splash | Core never answered, or Cage could not open the display |

Under QEMU stage 5 arrived about 150 seconds after power-on. Real hardware with
a real disk should be faster, but **time it**, because that number is the
baseline for every future claim about boot speed.

### The steps

1. Plug in the USB stick, HDMI, the keyboard, and the remote's receiver.
2. Power on and enter firmware setup, usually Del, F2, F10 or F12.
3. **Disable Secure Boot.** The image is unsigned in v1; signed UKIs come later.
4. Set the USB device first in the boot order, or use the one-off boot menu.
5. Save and reboot, then work through [BOOT_CHECKLIST.md](BOOT_CHECKLIST.md)
   box by box rather than deciding it looks fine.

Expect the first attempt on any new machine to reveal something. That is the
point of doing it.

### When it fails: how to find out why

The appliance has no console by design, so there are two ways in. Neither
requires guessing.

**Read the journal from the stick afterwards.** The journal is configured to
persist, so power the machine off, put the stick in the development PC, and
read it from WSL2:

```powershell
wsl --mount \\.\PHYSICALDRIVE2 --partition 2   # confirm the number in Disk Management
```

```bash
sudo journalctl -D /mnt/wsl/PHYSICALDRIVE2p2/var/log/journal -b -1 -p warning
sudo journalctl -D /mnt/wsl/PHYSICALDRIVE2p2/var/log/journal -u tvm-core -u tvm-session
```

This answers most questions: whether core started, whether Cage found a
display, whether Chromium exited.

**Or build a debug image** when you need a live shell. Never flash one of these
for normal use:

```bash
mkosi --force --root-password=debug
```

Then at the systemd-boot menu press `e` and append `systemd.unit=rescue.target`
to get a root shell instead of the kiosk, and from there:

```bash
systemctl status tvm-core tvm-session
journalctl -b -u tvm-session
```

Whatever the fault turns out to be, fix it in the image configuration and
rebuild. Do not fix it by leaving a desktop, a login prompt or a shell behind
on the television.

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
