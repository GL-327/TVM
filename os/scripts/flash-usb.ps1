# Writes tvm-appliance.raw to a USB disk. This erases the target.
# Prefer Rufus in DD Image mode unless you passed -Write and have WSL.
param(
    [string]$Drive = "D",
    [string]$Image = "",
    [switch]$Write
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

if ($Image -eq "") {
    $Image = Join-Path $repo "os\output\tvm-appliance.raw"
}

$letter = $Drive.TrimEnd(":").ToUpperInvariant()

if (-not (Test-Path $Image)) {
    Write-Host "Image not found: $Image"
    Write-Host "Build it in WSL: cd ~/TVM/os && ./scripts/stage-app.sh && mkosi --force"
    Write-Host "Then flash with Rufus, DD Image mode, target ${letter}:"
    exit 1
}

$partition = Get-Partition -DriveLetter $letter -ErrorAction Stop
$disk = $partition | Get-Disk
$system = Get-Disk | Where-Object { $_.IsBoot -or $_.IsSystem }

Write-Host "Image:  $Image"
Write-Host "Target: Disk $($disk.Number) ($($disk.FriendlyName), $([math]::Round($disk.Size/1GB, 1)) GB) letter ${letter}:"

if ($system -and $disk.Number -eq $system.Number) {
    throw "Refusing to flash the Windows boot disk."
}

if ($disk.Size -lt 8GB) {
    throw "Stick is too small. TVM needs about 8 GB; 32 GB USB 3.0 is the intended size."
}

if (-not $Write) {
    Write-Host ""
    Write-Host "Dry run. Flash with Rufus: select the .raw, DD Image mode, target this USB."
    Write-Host "Or re-run with -Write to dd from WSL (erases ${letter}:)."
    exit 0
}

$wslImage = "/mnt/" + $letter.ToLowerInvariant() + "/TVM-USB/tvm-appliance.raw"
# WSL cannot dd a Windows volume letter as a block device. Copy the image
# next to these instructions and use Rufus, or run flash-usb.sh from Linux
# against /dev/sdX after `lsblk`.
Write-Host "Windows cannot raw-write a GPT image without Rufus/Etcher."
Write-Host "Copied path for Rufus: $Image"
Write-Host "If you already ran prepare-usb.ps1, Rufus can also use ${letter}:\TVM-USB\tvm-appliance.raw"
exit 0
