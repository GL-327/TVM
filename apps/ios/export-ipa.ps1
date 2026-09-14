#Requires -Version 5.1
<#
.SYNOPSIS
  Windows stub. xcodebuild does not run on Windows; this script always exits 1.

.DESCRIPTION
  The real exporter is export-ipa.sh on a Mac. On this PC use request-ipa.ps1
  to pull an unsigned CI zip (if GitHub Actions produced one), then re-sign
  with Sideloadly, AltStore, or Xcode. Do not rename a zip to .ipa.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string] $Method = "development"
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "TVM IPA: xcodebuild does not run on Windows." -ForegroundColor Yellow
Write-Host "No IPA was produced. A renamed zip is not an installable iPhone app."
Write-Host ""
Write-Host "On a Mac (one command, after you set your team in Xcode):"
Write-Host "  cd apps/ios"
Write-Host "  ./export-ipa.sh $Method"
Write-Host "  # IPA: apps/ios/build/ipa/TVM.ipa"
Write-Host ""
Write-Host "On this Windows PC:"
Write-Host "  1. .\request-ipa.ps1     # download unsigned CI artifact if Actions built it"
Write-Host "  2. Re-sign that TVM-unsigned.ipa with Sideloadly or AltStore and your Apple ID"
Write-Host "  3. Or copy this repo to a Mac / use Xcode > Run on a registered iPhone"
Write-Host ""
Write-Host "Sideload steps: $here\README.md and docs\IOS_TESTING.md"
Write-Host ""
exit 1
