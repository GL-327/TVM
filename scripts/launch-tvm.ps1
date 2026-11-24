# Windows uses the C++ desktop client. Core is started by tvm.exe.
param([switch]$Windowed)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (Test-Path (Join-Path $PSScriptRoot "tvm.exe")) { $repo = $PSScriptRoot }
$nativeExe = @(
    (Join-Path $repo "tvm.exe"),
    (Join-Path $repo "native\build\Release\tvm.exe"),
    (Join-Path $repo "native\build\tvm.exe")
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $nativeExe) {
    throw "Build the C++ desktop client with native\build.bat, or download TVM.exe from https://github.com/GL-327/TVM/releases/latest."
}
Start-Process -FilePath $nativeExe -WorkingDirectory $repo
