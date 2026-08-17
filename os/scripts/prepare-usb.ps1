# Copies the TVM USB kit onto a Windows volume (default D:) without wiping it.
# This does not make the stick bootable. Flashing tvm-appliance.raw with Rufus
# or flash-usb.sh does that. See os/USB.md.
param(
    [string]$Drive = "D",
    [string]$Repo = ""
)

$ErrorActionPreference = "Stop"

if ($Repo -eq "") {
    $Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
}

$letter = $Drive.TrimEnd(":").ToUpperInvariant()
$root = "${letter}:\"
if (-not (Test-Path $root)) {
    throw "Drive ${letter}: is not present. Plug the USB in and check This PC."
}

$dest = Join-Path $root "TVM-USB"
New-Item -ItemType Directory -Force -Path $dest | Out-Null

Copy-Item -Force (Join-Path $Repo "os\USB.md") (Join-Path $dest "README.md")
Copy-Item -Force (Join-Path $Repo "os\scripts\flash-usb.ps1") $dest
Copy-Item -Force (Join-Path $Repo "os\scripts\flash-usb.sh") $dest
Copy-Item -Force (Join-Path $Repo "os\BOOT_CHECKLIST.md") $dest

$imageCandidates = @(
    (Join-Path $Repo "os\output\tvm-appliance.raw"),
    "$env:USERPROFILE\TVM\os\output\tvm-appliance.raw"
)
$copiedImage = $false
foreach ($image in $imageCandidates) {
    if (Test-Path $image) {
        Write-Host "Copying appliance image to $dest (this takes a few minutes)..."
        Copy-Item -Force $image (Join-Path $dest "tvm-appliance.raw")
        $copiedImage = $true
        break
    }
}

if (-not $copiedImage) {
    @(
        "The bootable image is not on this PC yet.",
        "In WSL2 Debian:",
        "  git clone /mnt/c/Users/Gathe/Desktop/TVM ~/TVM",
        "  cd ~/TVM/os && ./scripts/stage-app.sh && mkosi --force",
        "Then run this script again, or flash os/output/tvm-appliance.raw with Rufus in DD Image mode."
    ) | Set-Content -Encoding utf8 (Join-Path $dest "BUILD.txt")
}

Write-Host "USB kit written to $dest"
if ($copiedImage) {
    Write-Host "Bootable image is on the stick as TVM-USB\tvm-appliance.raw. Flash it with Rufus (DD Image) onto this same stick to boot."
} else {
    Write-Host "No .raw image found. BUILD.txt on the stick has the WSL commands."
}
