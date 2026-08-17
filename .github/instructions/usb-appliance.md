# USB appliance — custom instructions for agents and GitHub Actions

When the user wants TVM on a USB stick, follow [os/USB.md](../../os/USB.md).

Do not copy the Git repo onto a television USB port and expect it to boot.

Required sequence:

1. Identify the stick (on the development PC it is usually `D:`).
2. Run `os/scripts/prepare-usb.ps1` to paste the instruction kit onto the stick.
3. Build `os/output/tvm-appliance.raw` with mkosi **inside WSL2 Debian**, not on `/mnt/c`.
4. Flash the **whole disk** with Rufus (DD Image) or `os/scripts/flash-usb.sh`.
5. Boot a mini-PC from USB, Secure Boot off. TVM must open fullscreen.
6. Linux desktop is Settings → Linux desktop, never the boot target.

The workflow `.github/workflows/appliance.yml` uploads the staged app and
flash scripts. It does not produce a bootable `.raw`; that still needs mkosi.
