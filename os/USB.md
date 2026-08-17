# Flash TVM to a USB stick

TVM is a bootable disk image for a **computer**, not a file you copy onto a
television USB port. The stick becomes the computer's boot disk. HDMI carries
the picture to the TV. Power on that computer and TVM opens fullscreen.

This machine's empty stick is typically **D:**.

## What "paste onto the USB" means

Copying the Git repository onto D: as folders does **not** make the stick
bootable. The bootable artifact is `os/output/tvm-appliance.raw`, written to
the whole USB disk with DD Image mode (Rufus) or `dd`.

`prepare-usb.ps1` copies this instruction kit onto D: so the stick always
carries the flash steps. After the image is built, `flash-usb.ps1` writes it.

## Custom instructions (GitHub Actions and agents)

Follow these in order. Do not skip the WSL build; mkosi will not run on
Windows natively.

1. **Confirm the stick.** In PowerShell: `Get-Volume D`. It must be the USB,
   not the Windows system disk. The kitchen stick is ~57 GB and shows as D:.
2. **Copy the kit (safe, does not wipe).** From the repo:
   `powershell -File os/scripts/prepare-usb.ps1`
   This writes `D:\TVM-USB\` with README, flash scripts, and checksums when
   present.
3. **Build the image in WSL2 Debian**, never on `/mnt/c`:
   ```bash
   git clone /mnt/c/Users/Gathe/Desktop/TVM ~/TVM
   cd ~/TVM
   git pull
   cd os
   ./scripts/stage-app.sh
   mkosi --force
   ```
   Result: `os/output/tvm-appliance.raw` (about 3 GB).
4. **Flash the whole device.** This **erases** the stick.
   - Windows: Rufus → select `tvm-appliance.raw` → DD Image mode → target the
     USB → Flash.
   - Or from an elevated PowerShell:
     `powershell -File os/scripts/flash-usb.ps1 -Drive D`
     which shells into WSL and runs `dd`.
   - Linux: `os/scripts/flash-usb.sh /dev/sdX` after checking `lsblk` twice.
5. **Boot.** Plug the stick into the mini-PC, disable Secure Boot, USB first
   in the firmware menu. TVM must open fullscreen with no login prompt.
6. **Linux desktop** is Settings → Linux desktop, not something that appears
   at boot. Return to TVM with the TVM button on that desktop.

GitHub: `.github/workflows/ci.yml` tests the app. `.github/workflows/appliance.yml`
is a manual workflow that stages the app tarball; the raw disk image is still
built with mkosi on a Linux/WSL machine because GitHub-hosted runners are not
a privileged mkosi environment.

## After flashing

Work through [BOOT_CHECKLIST.md](BOOT_CHECKLIST.md) on the mini-PC and TV.
