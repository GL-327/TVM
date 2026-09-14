#Requires -Version 5.1
<#
.SYNOPSIS
  Download a REAL unsigned TVM IPA from GitHub Actions (macos-14 xcodebuild).
  Does not compile iOS on Windows and will not invent a fake IPA.

.DESCRIPTION
  Workflow: "Mobile packages" (.github/workflows/mobile.yml), artifact
  tvm-ios-unsigned-ipa. That zip is ad-hoc/unsigned and will not install
  until Sideloadly, AltStore, or Xcode re-signs it with an Apple ID.
#>
[CmdletBinding()]
param(
    [switch] $Trigger,
    [switch] $Watch,
    [string] $OutDir
)

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Resolve-Path (Join-Path $here "..\..")
if (-not $OutDir) { $OutDir = Join-Path $here "build" }

function Fail([string] $Message) {
    Write-Host $Message -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Windows cannot run xcodebuild. Real options:"
    Write-Host "  - Mac: cd apps/ios && ./export-ipa.sh development"
    Write-Host "  - Push apps/ios and .github/workflows/mobile.yml, then re-run this script"
    Write-Host "  - Sideload a Mac-signed or CI-unsigned+re-signed IPA with Sideloadly / AltStore"
    exit 1
}

Set-Location $repo

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Fail "gh is not on PATH. Install GitHub CLI if you want the CI artifact."
}

$auth = gh auth status 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
    Fail "gh is not logged in. Run: gh auth login"
}

$workflowOnDefault = $false
$workflows = gh workflow list 2>&1 | Out-String
if ($workflows -match "Mobile packages") { $workflowOnDefault = $true }

if ($Trigger) {
    if (-not $workflowOnDefault) {
        Fail "Workflow 'Mobile packages' is not on the default branch yet, so workflow_dispatch cannot run. Push mobile.yml to main, or push a branch that contains it (push already starts the ios-ipa job)."
    }
    gh workflow run "Mobile packages" --ref (gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
    if ($LASTEXITCODE -ne 0) { Fail "Could not trigger Mobile packages." }
    $Watch = $true
    Start-Sleep -Seconds 3
}

$runsJson = gh run list --workflow "Mobile packages" --limit 10 --json databaseId,status,conclusion,headBranch,displayTitle,url 2>&1
if ($LASTEXITCODE -ne 0) {
    Fail "No 'Mobile packages' runs visible. The workflow is not on the remote yet (local file: .github/workflows/mobile.yml)."
}

$runs = $runsJson | ConvertFrom-Json
if (-not $runs -or $runs.Count -eq 0) {
    Fail "No Mobile packages runs yet. Push apps/ios and mobile.yml (the macos job compiles the unsigned IPA)."
}

$active = $runs | Where-Object { $_.status -ne "completed" } | Select-Object -First 1
$success = $runs | Where-Object { $_.conclusion -eq "success" } | Select-Object -First 1

if ($Watch -and $active) {
    Write-Host "Watching run $($active.databaseId) on $($active.headBranch) — $($active.url)"
    gh run watch $active.databaseId --exit-status
    if ($LASTEXITCODE -ne 0) { Fail "Run $($active.databaseId) did not succeed. Open $($active.url)" }
    $success = gh run view $active.databaseId --json databaseId,conclusion,url | ConvertFrom-Json
    if ($success.conclusion -ne "success") { Fail "Run $($active.databaseId) conclusion=$($success.conclusion)" }
}

if (-not $success) {
    if ($active) {
        Write-Host "A run is still $($active.status): $($active.url)"
        Write-Host "Re-run: .\request-ipa.ps1 -Watch"
        exit 2
    }
    Fail "Latest Mobile packages runs did not succeed. Open the Actions tab and inspect the macos ios-ipa job."
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stage = Join-Path $OutDir "gh-artifact"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage | Out-Null

Write-Host "Downloading tvm-ios-unsigned-ipa from run $($success.databaseId)..."
gh run download $success.databaseId --name tvm-ios-unsigned-ipa --dir $stage
if ($LASTEXITCODE -ne 0) { Fail "Artifact tvm-ios-unsigned-ipa was not on run $($success.databaseId). The ios-ipa job may have failed." }

$found = Get-ChildItem -Path $stage -Recurse -File -Filter *.ipa | Select-Object -First 1
if (-not $found) { Fail "Download finished but no .ipa was in the artifact." }

$dest = Join-Path $OutDir "TVM-unsigned.ipa"
Copy-Item -Force $found.FullName $dest
Write-Host ""
Write-Host "Unsigned IPA (compiled on GitHub's macOS runner, not signed for your phone):"
Write-Host "  $dest"
Write-Host ""
Write-Host "This file will NOT install until you re-sign it:"
Write-Host "  Sideloadly (Windows): open the IPA, sign in with your Apple ID, install to a USB-connected iPhone"
Write-Host "  AltStore / AltServer: install AltStore on the phone, then sideload this IPA"
Write-Host "  Mac + Xcode: ./export-ipa.sh development after setting your team, or Product > Run on the device"
Write-Host "  Paid Apple Developer: register the UDID and use ./export-ipa.sh ad-hoc"
Write-Host ""
Write-Host "Free Apple IDs expire in 7 days and must be refreshed. Trust the developer cert on the phone:"
Write-Host "  Settings > General > VPN & Device Management"
Write-Host ""
