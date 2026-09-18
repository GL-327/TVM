#Requires -Version 5.1
<#
.SYNOPSIS
  Pull every TVM device package into this folder from GitHub Releases.

  Windows cannot run xcodebuild. This does not invent an IPA. It copies the
  files CI publishes onto the `devices` release (and the per-platform tags
  if that one is incomplete): IPA, APK, Roku zip, desktop tarball.

  The IPA is unsigned. Re-sign it with Sideloadly, AltStore, or Xcode.
#>
[CmdletBinding()]
param(
    [switch] $FromActions,
    [switch] $Trigger,
    [switch] $Watch,
    [string] $RunId
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $here "..")
$githubRepo = "GL-327/TVM"
$userAgent = "TVM-fetch"

function Fail([string] $Message) {
    Write-Host $Message -ForegroundColor Yellow
    exit 1
}

function Download-Url([string] $Url, [string] $Dest) {
    Write-Host "  $Url"
    $tmp = "$Dest.partial"
    if (Test-Path $tmp) { Remove-Item -Force $tmp }
    & curl.exe -L --fail --retry 3 --retry-delay 2 -A $userAgent -o $tmp $Url
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmp) -or (Get-Item $tmp).Length -lt 64) {
        Remove-Item -Force $tmp -ErrorAction SilentlyContinue
        throw "download failed: $Url"
    }
    Move-Item -Force $tmp $Dest
    Write-Host ("    {0:N1} MB -> {1}" -f ((Get-Item $Dest).Length / 1MB), (Split-Path -Leaf $Dest))
}

function Release-Assets([string] $Tag) {
    $headers = @{ "User-Agent" = $userAgent; "Accept" = "application/vnd.github+json" }
    try {
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$githubRepo/releases/tags/$Tag" -Headers $headers
        return @($release.assets)
    } catch {
        return @()
    }
}

function Save-Asset($asset, [string] $Dest) {
    if (-not $asset) { return $false }
    Download-Url $asset.browser_download_url $Dest
    return $true
}

function Find-Asset($assets, [string[]] $Names) {
    foreach ($name in $Names) {
        $hit = $assets | Where-Object { $_.name -eq $name } | Select-Object -First 1
        if ($hit) { return $hit }
    }
    return $null
}

Set-Location $repoRoot

$devices = @(Release-Assets "devices")
$ios = @(Release-Assets "ios")
$android = @(Release-Assets "android")
$roku = @(Release-Assets "roku")
$desktop = @(Release-Assets "desktop")

Write-Host "Downloading device packages into $here"

$ipa = Find-Asset $devices @("TVM.ipa", "TVM-ios.ipa", "TVM-unsigned.ipa")
if (-not $ipa) { $ipa = Find-Asset $ios @("TVM-ios.ipa", "TVM.ipa", "TVM-unsigned.ipa") }
if (-not $ipa) { Fail "No IPA on the devices or ios GitHub release." }
Save-Asset $ipa (Join-Path $here "TVM.ipa") | Out-Null
Copy-Item -Force (Join-Path $here "TVM.ipa") (Join-Path $here "TVM-unsigned.ipa")
Copy-Item -Force (Join-Path $here "TVM.ipa") (Join-Path $here "TVM-ios.ipa")

$apk = Find-Asset $devices @("TVM.apk", "TVM-android.apk")
if (-not $apk) { $apk = Find-Asset $android @("TVM-android.apk", "TVM.apk") }
if (-not $apk) { Fail "No APK on the devices or android GitHub release." }
Save-Asset $apk (Join-Path $here "TVM.apk") | Out-Null
Copy-Item -Force (Join-Path $here "TVM.apk") (Join-Path $here "TVM-android.apk")

$rokuZip = Find-Asset $devices @("TVM-roku.zip")
if (-not $rokuZip) { $rokuZip = Find-Asset $roku @("TVM-roku.zip") }
if (-not $rokuZip) { Fail "No TVM-roku.zip on the devices or roku GitHub release." }
Save-Asset $rokuZip (Join-Path $here "TVM-roku.zip") | Out-Null

$tarball = $devices | Where-Object { $_.name -like "TVM-desktop-*.tar.gz" } | Select-Object -First 1
if (-not $tarball) { $tarball = $desktop | Where-Object { $_.name -like "TVM-desktop-*.tar.gz" } | Select-Object -First 1 }
if (-not $tarball) { Fail "No desktop tarball on the devices or desktop GitHub release." }
$tarName = $tarball.name
Save-Asset $tarball (Join-Path $here $tarName) | Out-Null
Copy-Item -Force (Join-Path $here $tarName) (Join-Path $here "TVM-desktop.tar.gz")

$sha = $desktop | Where-Object { $_.name -like "TVM-desktop-*.sha256" } | Select-Object -First 1
if ($sha) { Save-Asset $sha (Join-Path $here $sha.name) | Out-Null }

$stamp = @"
TVM Device Variations
Fetched: $(Get-Date -Format o)
IPA:    $((Get-Item (Join-Path $here 'TVM.ipa')).Length) bytes
APK:    $((Get-Item (Join-Path $here 'TVM.apk')).Length) bytes
Roku:   $((Get-Item (Join-Path $here 'TVM-roku.zip')).Length) bytes
Desktop:$((Get-Item (Join-Path $here $tarName)).Length) bytes ($tarName)
Source: https://github.com/$githubRepo/releases/tag/devices
"@
Set-Content -Path (Join-Path $here "BUILD.txt") -Value $stamp -Encoding UTF8
Write-Host ""
Write-Host $stamp
Write-Host "The IPA is unsigned. Re-sign TVM.ipa with Sideloadly or AltStore before it will launch."

if ($FromActions -or $Trigger -or $Watch -or $RunId) {
    Write-Host ""
    Write-Host "Also pulling the IPA from Actions (optional fallback)..."
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Host "gh is not on PATH; skipping Actions fallback."
        exit 0
    }
    Set-Location $repoRoot
    if ($Trigger) {
        gh workflow run "Mobile packages" --ref (gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
        $Watch = $true
        Start-Sleep -Seconds 4
    }
    if (-not $RunId) {
        $runsJson = gh run list --workflow "Mobile packages" --limit 15 --json databaseId,status,conclusion,headBranch,url
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
    $stage = Join-Path $here "gh-artifact"
    if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    gh run download $RunId --name tvm-ios-unsigned-ipa --dir $stage
    $found = Get-ChildItem -Path $stage -Recurse -File -Filter *.ipa | Select-Object -First 1
    if ($found) {
        Copy-Item -Force $found.FullName (Join-Path $here "TVM-unsigned.ipa")
        Copy-Item -Force $found.FullName (Join-Path $here "TVM.ipa")
        Copy-Item -Force $found.FullName (Join-Path $here "TVM-ios.ipa")
        Write-Host "Replaced IPA from Actions run $RunId"
    }
    Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
}
