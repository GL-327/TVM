$ErrorActionPreference = "Stop"
$rokuRoot = Split-Path -Parent $PSScriptRoot
$package = Join-Path $PSScriptRoot "package.mjs"
& node $package
if ($LASTEXITCODE -ne 0) { throw "Roku package failed" }
$out = Join-Path $rokuRoot "tvm-roku.zip"
if (-not (Test-Path $out)) { throw "Missing $out" }
