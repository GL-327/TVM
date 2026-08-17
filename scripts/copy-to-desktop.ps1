# Copies the laptop desktop app and the Roku package onto this PC's Desktop.
param(
    [string]$Destination = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

function Resolve-DesktopFolder {
    param([string]$Hint)

    if ($Hint -ne "") {
        New-Item -ItemType Directory -Force -Path $Hint | Out-Null
        return (Resolve-Path $Hint).Path
    }

    $candidates = @(
        [Environment]::GetFolderPath("Desktop"),
        (Join-Path $env:USERPROFILE "Desktop"),
        (Join-Path $env:USERPROFILE "OneDrive\Desktop"),
        (Join-Path $env:USERPROFILE "OneDrive - Personal\Desktop")
    ) | Where-Object { $_ -and $_.Trim() -ne "" }

    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }

    $fallback = Join-Path $env:USERPROFILE "Desktop"
    New-Item -ItemType Directory -Force -Path $fallback | Out-Null
    return $fallback
}

$dest = Resolve-DesktopFolder -Hint $Destination
$repoEscaped = $repo.Replace('"', '""')

$desktopLauncher = @"
@echo off
title TVM
cd /d "$repoEscaped"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repoEscaped\scripts\launch-tvm.ps1" -Windowed
if errorlevel 1 (
  echo.
  echo TVM failed to start.
  pause
)
"@

$rokuLauncher = @"
@echo off
title TVM Roku
cd /d "$repoEscaped"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repoEscaped\scripts\roku-dev.ps1" %*
if errorlevel 1 (
  echo.
  echo TVM Roku helper failed.
  pause
)
"@

Set-Content -Path (Join-Path $dest "TVM.cmd") -Value $desktopLauncher.TrimStart() -Encoding ASCII
Set-Content -Path (Join-Path $dest "TVM Roku.cmd") -Value $rokuLauncher.TrimStart() -Encoding ASCII

Write-Host "Packaging the Roku sideload zip..."
& node (Join-Path $repo "apps\roku\scripts\package.mjs")
Copy-Item (Join-Path $repo "apps\roku\tvm-roku.zip") (Join-Path $dest "TVM-roku.zip") -Force

Write-Host "Copied laptop TVM and TVM Roku to $dest"
Write-Host "  TVM.cmd          windowed desktop app (fits a laptop screen)"
Write-Host "  TVM Roku.cmd     TV-frame preview + rebuilds the sideload zip"
Write-Host "  TVM-roku.zip     sideload this onto a developer-mode Roku"
