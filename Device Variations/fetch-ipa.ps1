#Requires -Version 5.1
<#
.SYNOPSIS
  Download a real macOS-compiled TVM IPA from GitHub Actions into this folder.

  Windows cannot run xcodebuild. This script does not invent an IPA and will
  not rename Swift source to .ipa. It copies artifact tvm-ios-unsigned-ipa
  from a Mobile packages run whose ios-ipa job uploaded that file.

  The file is a compiled Payload/TVM.app zip (ad-hoc / unsigned). It will not
  launch on an iPhone until you re-sign it (Sideloadly, AltStore, or Xcode).
#>
[CmdletBinding()]
param(
    [switch] $Trigger,
    [switch] $Watch,
    [string] $RunId
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here "..")
Set-Location $repo

function Fail([string] $Message) {
    Write-Host $Message -ForegroundColor Yellow
    Write-Host "Windows cannot run xcodebuild. On a Mac: cd apps/ios && ./export-ipa.sh development"
    exit 1
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Fail "gh is not on PATH. Install GitHub CLI and run: gh auth login"
}

$auth = gh auth status 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Fail "gh is not logged in. Run: gh auth login" }

if ($Trigger) {
    gh workflow run "Mobile packages" --ref (gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
    if ($LASTEXITCODE -ne 0) { Fail "Could not trigger Mobile packages." }
    $Watch = $true
    Start-Sleep -Seconds 4
}

if (-not $RunId) {
    $runsJson = gh run list --workflow "Mobile packages" --limit 15 --json databaseId,status,conclusion,headBranch,url
    if ($LASTEXITCODE -ne 0) { Fail "No Mobile packages runs visible." }
    $runs = $runsJson | ConvertFrom-Json
    $active = $runs | Where-Object { $_.status -ne "completed" } | Select-Object -First 1
    if ($Watch -and $active) {
        Write-Host "Watching run $($active.databaseId) - $($active.url)"
        gh run watch $active.databaseId --exit-status
        $RunId = [string]$active.databaseId
    } else {
        $RunId = [string]($runs | Select-Object -First 1).databaseId
    }
}

if (-not $RunId) { Fail "No Mobile packages run id to download from." }

$stage = Join-Path $here "gh-artifact"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Write-Host "Downloading tvm-ios-unsigned-ipa from run $RunId (ios-ipa may succeed even if android-apk failed)..."
gh run download $RunId --name tvm-ios-unsigned-ipa --dir $stage
if ($LASTEXITCODE -ne 0) {
    Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
    Fail "Artifact tvm-ios-unsigned-ipa was not on run $RunId."
}

$found = Get-ChildItem -Path $stage -Recurse -File -Filter *.ipa | Select-Object -First 1
if (-not $found) {
    Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
    Fail "Download finished but no .ipa was in the artifact."
}

Copy-Item -Force $found.FullName (Join-Path $here "TVM-unsigned.ipa")
Copy-Item -Force $found.FullName (Join-Path $here "TVM.ipa")
Remove-Item -Recurse -Force $stage
Write-Host "Wrote $(Join-Path $here 'TVM.ipa')"
Write-Host "This IPA is compiled on a GitHub macOS runner. Re-sign with Sideloadly, AltStore, or Xcode before it will launch."
