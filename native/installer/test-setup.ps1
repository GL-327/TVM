# Never performs a real install or touches any pre-existing TVM/node process.
# Build first: powershell -File native/installer/build-setup.ps1 -SkipPackage
# Test:        powershell -File native/installer/test-setup.ps1
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$work = [IO.Path]::GetFullPath((Join-Path $repo 'build\installer'))
$root = [IO.Path]::GetFullPath((Join-Path $repo 'build\installer-test'))
if ($root -ine ([IO.Path]::GetFullPath($repo) + '\build\installer-test')) { throw 'Unexpected test install path.' }
foreach ($target in @($root, ($root + '.new'), ($root + '.old'))) {
    $resolved = [IO.Path]::GetFullPath($target)
    if ($resolved -notin @($root, ($root + '.new'), ($root + '.old'))) { throw 'Unsafe test cleanup path.' }
    if (Test-Path -LiteralPath $resolved) { Remove-Item -LiteralPath $resolved -Recurse -Force }
}
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$formatWork = Join-Path $work ('format-tests-' + [Guid]::NewGuid().ToString('N'))
$formatTests = Join-Path $work 'PayloadTests.exe'
& $csc /nologo /target:exe /platform:x64 /optimize+ "/out:$formatTests" (Join-Path $PSScriptRoot 'Payload.cs') (Join-Path $PSScriptRoot 'PayloadTests.cs')
if ($LASTEXITCODE -ne 0) { throw 'Payload tests did not compile.' }
& $formatTests $formatWork
if ($LASTEXITCODE -ne 0) { throw 'Payload format tests failed.' }

$installer = Join-Path $repo 'native\dist\TVM.exe'
$manifest = @(Import-Csv -LiteralPath (Join-Path $work 'payload-manifest.csv'))
function Run-Setup([string]$Executable, [string]$Extra = '', [int]$ExpectedExit = 0) {
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $Executable
    $info.Arguments = '--root "' + $root + '" ' + $Extra
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $process = [Diagnostics.Process]::Start($info)
    if (-not $process.WaitForExit(60000)) { $process.Kill(); throw 'Test installer timed out.' }
    $timer.Stop()
    if ($process.ExitCode -ne $ExpectedExit) { throw ('Unexpected installer exit: ' + $process.ExitCode + '; ' + (Get-Content -LiteralPath ($root + '.setup.log') -Raw)) }
    return [Math]::Round($timer.Elapsed.TotalSeconds, 3)
}
function Check-Files {
    $actual = @(Get-ChildItem -LiteralPath $root -Recurse -File)
    if ($actual.Count -ne $manifest.Count) { throw 'Installed file count differs from payload manifest.' }
    foreach ($entry in $manifest) {
        $file = Join-Path $root $entry.Path
        if (-not (Test-Path -LiteralPath $file) -or (Get-Item -LiteralPath $file).Length -ne [long]$entry.Bytes -or
            (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $entry.SHA256) { throw "Installed file differs: $($entry.Path)" }
    }
    if ((Test-Path -LiteralPath ($root + '.new')) -or (Test-Path -LiteralPath ($root + '.old'))) { throw 'Swap left a staging/backup directory.' }
}
$installSeconds = Run-Setup $installer
Check-Files

# Equal/newer stamps skip installation; --reinstall still forces replacement.
$marker = Join-Path $root 'test-marker'
Set-Content -LiteralPath $marker -Value 'retained only when install is skipped'
$sameSeconds = Run-Setup $installer '--install-only'
if (-not (Test-Path -LiteralPath $marker)) { throw 'Equal build unexpectedly reinstalled.' }
$stampPath = Join-Path $root 'native-build.json'
$stamp = Get-Content -LiteralPath $stampPath -Raw | ConvertFrom-Json
$stamp.builtAt = '2099-01-01T00:00:00.0000000Z'
$stamp | ConvertTo-Json | Set-Content -LiteralPath $stampPath -Encoding UTF8
$newerSeconds = Run-Setup $installer
if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $stampPath -Raw | ConvertFrom-Json).builtAt -ne $stamp.builtAt) { throw 'Newer installed build was rolled back.' }
$reinstallSeconds = Run-Setup $installer '--reinstall'
Check-Files

# Make the installed stamp older to exercise the ordinary update path.
$stamp.builtAt = '2000-01-01T00:00:00.0000000Z'
$stamp | ConvertTo-Json | Set-Content -LiteralPath $stampPath -Encoding UTF8
Set-Content -LiteralPath $marker -Value 'must disappear during folder swap'
$updateSeconds = Run-Setup $installer
Check-Files

# A malformed embedded payload must fail before replacing the existing install.
# This also exercises the non-modal error log available only with --root.
$badInstaller = Join-Path $work 'TVM-invalid-payload.exe'
& $csc /nologo /target:winexe /platform:x64 /optimize+ "/out:$badInstaller" `
    /reference:System.Windows.Forms.dll /reference:System.Drawing.dll `
    "/resource:$(Join-Path $formatWork 'unsafe.lzms'),payload.lzms" "/resource:$stampPath,build.json" `
    (Join-Path $PSScriptRoot 'TVMSetup.cs') (Join-Path $PSScriptRoot 'Payload.cs')
if ($LASTEXITCODE -ne 0) { throw 'Invalid-payload test installer did not compile.' }
$failureSeconds = Run-Setup $badInstaller '--reinstall' 1
Check-Files

$baseline = Get-Content -LiteralPath (Join-Path $work 'build-metrics.json') -Raw | ConvertFrom-Json
if ($baseline.releaseZipSHA256 -and (Get-FileHash -LiteralPath (Join-Path $repo 'native\TVM-native-windows.zip')).Hash -ne $baseline.releaseZipSHA256) { throw 'The release ZIP changed.' }
if ((Get-FileHash -LiteralPath (Join-Path $repo 'native\package\tvm.exe')).Hash -ne $baseline.packageRendererSHA256) { throw 'The packaged renderer changed.' }
$actual = @(Get-ChildItem -LiteralPath $root -Recurse -File)
[ordered]@{
    installRoot=$root; installedFiles=$actual.Count; installedBytes=($actual | Measure-Object Length -Sum).Sum
    installSeconds=$installSeconds; updateSeconds=$updateSeconds; reinstallSeconds=$reinstallSeconds
    sameBuildSeconds=$sameSeconds; newerBuildSeconds=$newerSeconds; rejectedPayloadSeconds=$failureSeconds
    releaseZipUnchanged=$true; packageRendererUnchanged=$true; manifestSHA256Verified=$true
    formatTestDirectory=$formatWork
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $work 'test-metrics.json') -Encoding UTF8
Get-Content -LiteralPath (Join-Path $work 'test-metrics.json') -Raw
