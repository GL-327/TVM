# Runs the real prepare script against local fixtures; no network or app restart.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path ([IO.Path]::GetTempPath()) ('tvm-update-test-' + [guid]::NewGuid().ToString('N'))
$stages = @()
New-Item -ItemType Directory -Path $root | Out-Null
$updater = Join-Path (Split-Path -Parent $PSScriptRoot) 'update-native.ps1'
$installed = Join-Path $root 'installed'
$payload = Join-Path $root 'payload'
$zipPath = Join-Path $root 'fixture.zip'
New-Item -ItemType Directory -Path $installed,$payload,(Join-Path $payload 'core') | Out-Null
'{"commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' | Set-Content (Join-Path $installed 'native-build.json')
'old executable' | Set-Content (Join-Path $installed 'tvm.exe')
'{"commit":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}' | Set-Content (Join-Path $payload 'native-build.json')
'new executable' | Set-Content (Join-Path $payload 'tvm.exe')
'Core is updated separately' | Set-Content (Join-Path $payload 'core/index.js')
[IO.Compression.ZipFile]::CreateFromDirectory($payload, $zipPath)
$global:TvmUpdaterFixtureZip = $zipPath
$global:TvmUpdaterFixtureAsset = [pscustomobject]@{
    name='TVM-native-windows.zip'; label=('b' * 40)
    digest=('sha256:' + (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant())
    size=(Get-Item $zipPath).Length
    browser_download_url='https://github.com/GL-327/TVM/releases/download/native-windows/TVM-native-windows.zip'
}
function Invoke-RestMethod { param($Uri,$Headers) return @{ assets=@($global:TvmUpdaterFixtureAsset) } }
function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing) Copy-Item -LiteralPath $global:TvmUpdaterFixtureZip -Destination $OutFile }
function Start-Process { param($FilePath,$ArgumentList,$WindowStyle) $global:TvmUpdaterHelperArgs = $ArgumentList }
function Require($Condition, $Message) { if (-not $Condition) { throw $Message } }
function Expect-Rejection($Text) {
    $rejected = $false
    try { & $updater -InstallRoot $installed -ParentId $PID } catch { $rejected = $_.Exception.Message.Contains($Text) }
    Require $rejected "Expected rejection: $Text"
}
try {
    & $updater -InstallRoot $installed -ParentId $PID
    Require ($LASTEXITCODE -eq 0) 'Valid update did not stage'
    $at = [Array]::IndexOf($global:TvmUpdaterHelperArgs, '-Stage')
    $stage = $global:TvmUpdaterHelperArgs[$at + 1].Trim('"')
    $stages += $stage
    Require (Test-Path -LiteralPath (Join-Path $stage 'verified/tvm.exe')) 'Missing staged renderer'
    Require (-not (Test-Path -LiteralPath (Join-Path $stage 'verified/core'))) 'Renderer updater must leave Core to its own updater'
    Require ((Get-Content (Join-Path $installed 'tvm.exe') -Raw).Trim() -eq 'old executable') 'Prepare changed the running installation'
    $digest = $global:TvmUpdaterFixtureAsset.digest
    $global:TvmUpdaterFixtureAsset.digest = 'sha256:' + ('0' * 64)
    Expect-Rejection 'checksum failed'
    $global:TvmUpdaterFixtureAsset.digest = $digest
    $global:TvmUpdaterFixtureAsset.browser_download_url = 'https://example.test/package.zip'
    Expect-Rejection 'Unexpected native update asset'
    $global:TvmUpdaterFixtureAsset.browser_download_url = 'https://github.com/GL-327/TVM/releases/download/native-windows/TVM-native-windows.zip'
    $archive = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Update)
    try { [void]$archive.CreateEntry('../escape.txt') } finally { $archive.Dispose() }
    $global:TvmUpdaterFixtureAsset.size = (Get-Item $zipPath).Length
    $global:TvmUpdaterFixtureAsset.digest = 'sha256:' + (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Expect-Rejection 'Unsafe native update entry'
    Require (-not (Test-Path -LiteralPath (Join-Path $root 'escape.txt'))) 'Archive escaped its stage'
    Write-Host 'Native updater staging, checksum, URL and traversal checks passed.'
} finally {
    # All targets are freshly created test directories beneath the temp root.
    $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    foreach ($target in @($root) + $stages) {
        $absolute = [IO.Path]::GetFullPath($target)
        if (-not $absolute.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unexpected test cleanup path' }
        Remove-Item -LiteralPath $absolute -Recurse -Force -ErrorAction SilentlyContinue
    }
    Remove-Variable TvmUpdaterFixtureZip,TvmUpdaterFixtureAsset,TvmUpdaterHelperArgs -Scope Global -ErrorAction SilentlyContinue
}
