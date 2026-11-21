# Builds the installer-only payload; native/package.ps1 and its release ZIP are unchanged.
# powershell -File native/installer/build-setup.ps1 [-BuildDir native/build/mingw] [-SkipPackage]
param(
    [string]$BuildDir = '',
    [switch]$SkipPackage
)
$ErrorActionPreference = 'Stop'
$native = Split-Path -Parent $PSScriptRoot
$repo = Split-Path -Parent $native
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) { throw 'The .NET Framework 4 C# compiler is missing from Windows.' }

if (-not $SkipPackage) {
    if (-not $BuildDir) {
        $BuildDir = @((Join-Path $native 'build\mingw'), (Join-Path $native 'build')) |
            Where-Object { (Test-Path (Join-Path $_ 'tvm.exe')) -or (Test-Path (Join-Path $_ 'Release\tvm.exe')) } |
            Select-Object -First 1
        if (-not $BuildDir) { throw 'No tvm.exe found. Build it first, or use -SkipPackage with an existing native/package.' }
    }
    if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
        $mingwBin = 'C:\msys64\ucrt64\bin'
        if (Test-Path -LiteralPath (Join-Path $mingwBin 'cmake.exe')) { $env:PATH = "$mingwBin;$env:PATH" }
    }
    & (Join-Path $native 'package.ps1') -BuildDir $BuildDir
    if (-not $?) { throw 'Packaging failed. To use the existing package, run with -SkipPackage.' }
}
$package = Join-Path $native 'package'
$stamp = Join-Path $package 'native-build.json'
if (-not (Test-Path -LiteralPath $stamp)) { throw "Missing $stamp. Run without -SkipPackage." }

# All intermediate output is gitignored, and only this exact staging directory is cleared.
$work = [IO.Path]::GetFullPath((Join-Path $repo 'build\installer'))
$stage = Join-Path $work 'payload'
if ([IO.Path]::GetFullPath($stage) -ine ([IO.Path]::GetFullPath($repo) + '\build\installer\payload')) { throw 'Unexpected staging path.' }
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$required = @('tvm.exe','assets','bin\node.exe','bin\update-native.ps1','core','ui','native-build.json','build-info.json','core\build-info.json')
foreach ($name in $required) {
    $inputPath = Join-Path $package $name
    if (-not (Test-Path -LiteralPath $inputPath)) { throw "Package is incomplete: $name is missing." }
}
$files = @(Get-ChildItem -LiteralPath $package -Recurse -File)
foreach ($file in $files) {
    $relative = $file.FullName.Substring($package.Length + 1)
    if ($relative -notmatch '^(tvm\.exe|native-build\.json|build-info\.json|bin\\(node\.exe|update-native\.ps1))$' -and
        $relative -notmatch '^(assets|core|ui)\\') { continue }
    if ($file.Extension -ieq '.map' -or $file.Name -ieq 'README.md' -or $file.Name -ieq 'TVM.cmd' -or $file.Name -ilike 'launch-tvm.*') { continue }
    $destination = Join-Path $stage $relative
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath $file.FullName -Destination $destination
}
# Preserve the PNG URLs: index.html and the app use tvm-icon.png, while the
# library catalogue uses apps/tvm.png. LZMS removes most duplicate byte cost.

$strip = 'C:\msys64\ucrt64\bin\strip.exe'
$objdump = 'C:\msys64\ucrt64\bin\objdump.exe'
$renderer = Join-Path $stage 'tvm.exe'
$rendererBefore = (Get-Item -LiteralPath $renderer).Length
$stripped = $false
if ((Test-Path -LiteralPath $strip) -and (Test-Path -LiteralPath $objdump)) {
    # Positive MinGW COFF-symbol identification; do not run GNU strip on MSVC builds.
    $symbols = (& $objdump -t $renderer 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the payload renderer.' }
    if ($symbols -match '\b__mingw_') {
        & $strip --strip-all $renderer
        if ($LASTEXITCODE -ne 0) { throw 'Stripping the payload renderer failed.' }
        $stripped = $true
        $snapshot = Join-Path $work 'stripped-1280x720.png'
        if (Test-Path -LiteralPath $snapshot) { Remove-Item -LiteralPath $snapshot }
        $snapshotInfo = New-Object Diagnostics.ProcessStartInfo
        $snapshotInfo.FileName = $renderer
        $snapshotInfo.Arguments = '--snapshot "' + $snapshot + '" --size 1280x720'
        $snapshotInfo.WorkingDirectory = $stage
        $snapshotInfo.UseShellExecute = $false
        $snapshotInfo.CreateNoWindow = $true
        $snapshotInfo.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $process = [Diagnostics.Process]::Start($snapshotInfo)
        if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Stripped renderer snapshot timed out.' }
        if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $snapshot)) { throw 'Stripped renderer snapshot failed.' }
        Add-Type -AssemblyName System.Drawing
        $picture = [Drawing.Image]::FromFile($snapshot)
        try { if ($picture.Width -ne 1280 -or $picture.Height -ne 720) { throw 'Stripped snapshot has the wrong dimensions.' } }
        finally { $picture.Dispose() }
        Write-Host "Verified stripped renderer snapshot: $snapshot"
    } else { Write-Host 'Renderer has no MinGW symbols; leaving it unchanged.' }
} else { Write-Host 'MSYS2 strip/objdump unavailable; leaving renderer unchanged.' }

# Keep Core's tsc output: a local rolldown trial could not establish HTTP
# parity because even unbundled Core failed Windows DPAPI under the test user.
# Do not ship an optional bundle without that proof (see README's measurements).

$packer = Join-Path $work 'PackPayload.exe'
& $csc /nologo /target:exe /platform:x64 /optimize+ "/out:$packer" `
    (Join-Path $PSScriptRoot 'Payload.cs') (Join-Path $PSScriptRoot 'PackPayload.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compiling the LZMS packer failed.' }
$payload = Join-Path $work 'payload.lzms'
& $packer $stage $payload
if ($LASTEXITCODE -ne 0) { throw 'Compressing the installer payload failed.' }

$ico = Join-Path $native 'assets\tvm.ico'
if (-not (Test-Path -LiteralPath $ico)) { & (Join-Path $PSScriptRoot 'make-icon.ps1') }
$dist = Join-Path $native 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$out = Join-Path $dist 'TVM.exe'
$beforeBytes = if (Test-Path -LiteralPath $out) { (Get-Item -LiteralPath $out).Length } else { $null }
& $csc /nologo /target:winexe /platform:x64 /optimize+ "/out:$out" "/win32icon:$ico" `
    "/win32manifest:$(Join-Path $PSScriptRoot 'TVMSetup.manifest')" `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    "/resource:$payload,payload.lzms" "/resource:$stamp,build.json" `
    (Join-Path $PSScriptRoot 'TVMSetup.cs') (Join-Path $PSScriptRoot 'Payload.cs')
if ($LASTEXITCODE -ne 0) { throw 'Compiling TVM.exe failed.' }
$installedFiles = @(Get-ChildItem -LiteralPath $stage -Recurse -File)
$installedFiles | ForEach-Object {
    [pscustomobject]@{ Path=$_.FullName.Substring($stage.Length+1); Bytes=$_.Length; SHA256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
} | Export-Csv -LiteralPath (Join-Path $work 'payload-manifest.csv') -NoTypeInformation
$item = Get-Item -LiteralPath $out
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $out).Hash.ToLowerInvariant()
[ordered]@{
    previousInstallerBytes=$beforeBytes; installerBytes=$item.Length; installerSHA256=$hash
    packageFiles=$files.Count; packageBytes=($files | Measure-Object Length -Sum).Sum
    payloadFiles=$installedFiles.Count; payloadBytes=($installedFiles | Measure-Object Length -Sum).Sum
    compressedBytes=(Get-Item -LiteralPath $payload).Length
    rendererBeforeBytes=$rendererBefore; rendererBytes=(Get-Item -LiteralPath $renderer).Length; stripped=$stripped
    packageRendererSHA256=(Get-FileHash -LiteralPath (Join-Path $package 'tvm.exe')).Hash
    releaseZipSHA256=$(if (Test-Path -LiteralPath (Join-Path $native 'TVM-native-windows.zip')) { (Get-FileHash -LiteralPath (Join-Path $native 'TVM-native-windows.zip')).Hash } else { $null })
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $work 'build-metrics.json') -Encoding UTF8
Write-Host ("Built {0} ({1:N2} MiB; {2} payload files)" -f $out, ($item.Length / 1MB), $installedFiles.Count)
Write-Host "SHA-256 $hash"
