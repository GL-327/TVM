param([switch]$SkipTests)

$ErrorActionPreference = 'Stop'
$sourceDir = $PSScriptRoot
$buildDir = Join-Path $sourceDir 'build'
$cmake = Get-Command cmake -ErrorAction SilentlyContinue
$configure = @('-S', $sourceDir, '-B', $buildDir)

if (-not $cmake) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path -LiteralPath $vswhere) {
        $vsInstall = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($vsInstall) {
            $bundledCmake = Join-Path $vsInstall 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
            if (Test-Path -LiteralPath $bundledCmake) { $cmake = Get-Item -LiteralPath $bundledCmake }
        }
    }
}
if (-not $cmake) {
    $mingwBin = 'C:\msys64\ucrt64\bin'
    if (Test-Path -LiteralPath (Join-Path $mingwBin 'cmake.exe')) {
        $env:PATH = "$mingwBin;$env:PATH"
        $cmake = Get-Item -LiteralPath (Join-Path $mingwBin 'cmake.exe')
        $configure += @('-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release')
    }
}
if (-not $cmake) {
    throw 'Install Visual Studio Build Tools with the Desktop development with C++ workload and CMake, or MSYS2 UCRT64 GCC, CMake and Ninja.'
}
$cmakeExe = if ($cmake -is [System.Management.Automation.CommandInfo]) { $cmake.Source } else { $cmake.FullName }
& $cmakeExe @configure
if ($LASTEXITCODE -ne 0) { throw 'Native configuration failed.' }
& $cmakeExe --build $buildDir --config Release --parallel 2
if ($LASTEXITCODE -ne 0) { throw 'Native build failed.' }
if (-not $SkipTests) {
    $ctestExe = Join-Path (Split-Path -Parent $cmakeExe) 'ctest.exe'
    & $ctestExe --test-dir $buildDir -C Release --output-on-failure
    if ($LASTEXITCODE -ne 0) { throw 'Native tests failed.' }
}
Write-Host 'Built TVM native. Start it with native\run.bat or TVM-native.cmd.'
