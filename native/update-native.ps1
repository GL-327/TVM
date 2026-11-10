# Verified Windows renderer update. The shared Core/UI use their own updater.
param(
    [Parameter(Mandatory=$true)][string]$InstallRoot,
    [Parameter(Mandatory=$true)][int]$ParentId,
    [switch]$Apply,
    [string]$Stage
)
$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
$infoPath = Join-Path $InstallRoot 'native-build.json'
if (-not (Test-Path -LiteralPath $infoPath)) { throw 'Source checkouts update with git pull and a native rebuild.' }

if (-not $Apply) {
    $installed = Get-Content -LiteralPath $infoPath -Raw | ConvertFrom-Json
    $release = Invoke-RestMethod 'https://api.github.com/repos/GL-327/TVM/releases/tags/native-windows' -Headers @{Accept='application/vnd.github+json';'User-Agent'='TVM-Native'}
    $asset = $release.assets | Where-Object { $_.name -ceq 'TVM-native-windows.zip' } | Select-Object -First 1
    if (-not $asset -or $asset.label -notmatch '^[a-f0-9]{40}$' -or $asset.digest -notmatch '^sha256:[a-f0-9]{64}$') { throw 'No verifiable native update is published yet.' }
    if ($installed.commit -ceq $asset.label) { exit 10 }
    if ($asset.browser_download_url -cne 'https://github.com/GL-327/TVM/releases/download/native-windows/TVM-native-windows.zip' -or $asset.size -le 0 -or $asset.size -gt 209715200) { throw 'Unexpected native update asset.' }
    $Stage = Join-Path ([IO.Path]::GetTempPath()) ('tvm-native-update-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $Stage | Out-Null
    $zipPath = Join-Path $Stage 'package.zip'
    Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $zipPath
    if ((Get-Item -LiteralPath $zipPath).Length -ne $asset.size -or ('sha256:' + (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()) -cne $asset.digest) { throw 'Native update checksum failed.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $expanded = Join-Path $Stage 'verified'
        New-Item -ItemType Directory -Path $expanded | Out-Null
        [long]$total = 0
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName.Replace('\','/')
            if ($name.StartsWith('/') -or $name.Contains(':') -or ($name.Split('/') -contains '..')) { throw 'Unsafe native update entry.' }
            if ($name -cne 'tvm.exe' -and $name -cne 'native-build.json' -and $name -cne 'bin/update-native.ps1' -and -not $name.StartsWith('assets/')) { continue }
            $total += $entry.Length
            if ($total -gt 209715200) { throw 'Native update expands beyond its limit.' }
            $destination = [IO.Path]::GetFullPath((Join-Path $expanded $name))
            if (-not $destination.StartsWith($expanded + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe update destination.' }
            if ($name.EndsWith('/')) { continue }
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
        }
    } finally { $zip.Dispose() }
    $nextInfo = Get-Content -LiteralPath (Join-Path $expanded 'native-build.json') -Raw | ConvertFrom-Json
    if ($nextInfo.commit -cne $asset.label -or -not (Test-Path -LiteralPath (Join-Path $expanded 'tvm.exe'))) { throw 'Native update build identity failed.' }
    # Copy the helper outside the installation before replacing any files.
    $helper = Join-Path $Stage 'apply.ps1'
    Copy-Item -LiteralPath $PSCommandPath -Destination $helper
    $helperArgs = @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', ('"' + $helper + '"'), '-InstallRoot', ('"' + $InstallRoot + '"'), '-ParentId', $ParentId, '-Apply', '-Stage', ('"' + $Stage + '"'))
    Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $helperArgs -WindowStyle Hidden
    exit 0
}

# Only a freshly staged, verified sibling tree is accepted by the apply phase.
$Stage = [IO.Path]::GetFullPath($Stage)
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
if (-not $Stage.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $Stage) -notmatch '^tvm-native-update-[a-f0-9]{32}$') { throw 'Unexpected update stage.' }
$expanded = Join-Path $Stage 'verified'
$parent = Get-Process -Id $ParentId -ErrorAction SilentlyContinue
if ($parent -and $parent.Path -ine (Join-Path $InstallRoot 'tvm.exe')) { throw 'Unexpected desktop process.' }
if ($parent) { $parent.WaitForExit() }
$backup = Join-Path $Stage 'backup'
New-Item -ItemType Directory -Path $backup | Out-Null
$changed = @()
try {
    foreach ($file in Get-ChildItem -LiteralPath $expanded -Recurse -File) {
        $relative = $file.FullName.Substring($expanded.Length + 1)
        $destination = [IO.Path]::GetFullPath((Join-Path $InstallRoot $relative))
        if (-not $destination.StartsWith($InstallRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe installation destination.' }
        $old = Join-Path $backup $relative
        if (Test-Path -LiteralPath $destination) {
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $old) | Out-Null
            Copy-Item -LiteralPath $destination -Destination $old
        }
        $changed += $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
    }
    Start-Process -FilePath (Join-Path $InstallRoot 'tvm.exe') -WorkingDirectory $InstallRoot
} catch {
    foreach ($relative in $changed) {
        $old = Join-Path $backup $relative
        $destination = Join-Path $InstallRoot $relative
        if (Test-Path -LiteralPath $old) { Copy-Item -LiteralPath $old -Destination $destination -Force }
        elseif (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }
    }
    $_ | Out-String | Set-Content -LiteralPath (Join-Path $InstallRoot 'native-update-error.log')
    Start-Process -FilePath (Join-Path $InstallRoot 'tvm.exe') -WorkingDirectory $InstallRoot
    exit 1
}
# Retain the backup until the next release in case manual recovery is needed.
