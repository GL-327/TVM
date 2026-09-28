# Starts TVM on this PC: core + Vite if needed, then the Electron shell.
# Default is fullscreen kiosk (the living-room start). Pass -Windowed for Cursor.
#
# Works from a git checkout (apps\core\src) and from the GitHub desktop
# package (core\index.js + ui\ next to this script), the same two modes as
# launch-tvm.sh.
param(
    [switch]$Windowed
)

$ErrorActionPreference = "Stop"

$here = $PSScriptRoot
if (Test-Path (Join-Path $here "apps\core")) {
    $repo = $here
} elseif (Test-Path (Join-Path (Split-Path -Parent $here) "apps\core")) {
    $repo = Split-Path -Parent $here
} elseif (Test-Path (Join-Path $here "core\index.js")) {
    $repo = $here
} elseif (Test-Path (Join-Path (Split-Path -Parent $here) "core\index.js")) {
    $repo = Split-Path -Parent $here
} else {
    throw "Cannot find TVM. Run this from a git checkout or an extracted desktop package."
}

if (Test-Path (Join-Path $repo "apps\core\src\index.ts")) {
    $mode = "source"
} elseif (Test-Path (Join-Path $repo "core\index.js")) {
    $mode = "package"
} else {
    throw "TVM core is missing from $repo"
}

$port = if ($env:TVM_CORE_PORT) { $env:TVM_CORE_PORT } else { "7345" }
$coreHealth = "http://127.0.0.1:$port/api/health"
$packageUi = "http://127.0.0.1:$port/"

function Test-Http([string]$Url) {
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Wait-Http([string]$Url, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Http $Url) { return $true }
        Start-Sleep -Milliseconds 250
    }
    return $false
}

$env:TVM_CORE_BIND = "127.0.0.1"
if ($mode -eq "source") {
    # A checkout is source: it updates by pulling, not by downloading a build.
    if (-not $env:TVM_ENV) { $env:TVM_ENV = "development" }
} else {
    if (-not $env:TVM_ENV) { $env:TVM_ENV = "production" }
    if (-not $env:TVM_UI_DIST) { $env:TVM_UI_DIST = Join-Path $repo "ui" }
}

if (-not (Test-Http $coreHealth)) {
    Write-Host "Starting TVM core..."
    $logDir = Join-Path $(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }) "TVM\logs"
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $coreOut = Join-Path $logDir "core.out.log"
    $coreErr = Join-Path $logDir "core.err.log"
    if ($mode -eq "source") {
        Start-Process -FilePath "node" -ArgumentList "--watch", "src/index.ts" -WorkingDirectory (Join-Path $repo "apps\core") -WindowStyle Hidden -RedirectStandardOutput $coreOut -RedirectStandardError $coreErr
    } else {
        Start-Process -FilePath "node" -ArgumentList (Join-Path $repo "core\index.js") -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput $coreOut -RedirectStandardError $coreErr
    }
    if (-not (Wait-Http $coreHealth 40)) {
        $tail = @()
        if (Test-Path $coreErr) { $tail += Get-Content $coreErr -Tail 20 -ErrorAction SilentlyContinue }
        if (Test-Path $coreOut) { $tail += Get-Content $coreOut -Tail 20 -ErrorAction SilentlyContinue }
        $detail = if ($tail.Count -gt 0) { "`n" + ($tail -join "`n") } else { "" }
        throw "TVM core did not start on $coreHealth$detail"
    }
}

# The package carries a built interface, which core serves itself. Only a
# checkout needs Vite and the Electron shell built from source.
if ($mode -eq "package") {
    $open = if ($Windowed) { "$packageUi`?desktop=1" } else { $packageUi }
    Write-Host "Opening TVM..."
    Start-Process $open
    return
}

if (-not (Test-Http "http://127.0.0.1:5173/")) {
    Write-Host "Starting TVM UI..."
    $vite = Join-Path $repo "apps\ui\node_modules\vite\bin\vite.js"
    Start-Process -FilePath "node" -ArgumentList $vite -WorkingDirectory (Join-Path $repo "apps\ui") -WindowStyle Hidden
    if (-not (Wait-Http "http://127.0.0.1:5173/" 40)) {
        throw "TVM UI did not start on http://127.0.0.1:5173"
    }
}

$shellDir = Join-Path $repo "apps\shell"
$mainJs = Join-Path $shellDir "dist\main.js"
$shellSrc = Join-Path $shellDir "src"
$needsShellBuild = -not (Test-Path $mainJs)
if (-not $needsShellBuild) {
    $distTime = (Get-Item $mainJs).LastWriteTime
    $newestSrc = Get-ChildItem -Path $shellSrc -Recurse -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($null -ne $newestSrc -and $newestSrc.LastWriteTime -gt $distTime) {
        $needsShellBuild = $true
    }
}
if ($needsShellBuild) {
    Write-Host "Building TVM shell..."
    Push-Location $shellDir
    try {
        & corepack pnpm run build
        if ($LASTEXITCODE -ne 0) { throw "shell build failed" }
    } finally {
        Pop-Location
    }
}

$electron = @(
    (Join-Path $shellDir "node_modules\electron\dist\electron.exe"),
    (Join-Path $shellDir "node_modules\electron\dist\electron"),
    (Join-Path $shellDir "node_modules\electron\dist\Electron.app\Contents\MacOS\Electron")
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$uiOpen = if ($Windowed) { "http://127.0.0.1:5173/?desktop=1" } else { "http://127.0.0.1:5173/" }
if (-not $electron) {
    $installJs = Join-Path $shellDir "node_modules\electron\install.js"
    if (Test-Path $installJs) {
        Write-Host "Downloading Electron..."
        Push-Location (Join-Path $shellDir "node_modules\electron")
        try {
            & node install.js
        } finally {
            Pop-Location
        }
        $electron = @(
            (Join-Path $shellDir "node_modules\electron\dist\electron.exe"),
            (Join-Path $shellDir "node_modules\electron\dist\electron"),
            (Join-Path $shellDir "node_modules\electron\dist\Electron.app\Contents\MacOS\Electron")
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    }
}
if (-not $electron) {
    Write-Host "Electron is not installed on this device. Opening TVM in the browser..."
    Start-Process $uiOpen
    return
}

$localApp = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE "AppData\Local" }
$userData = Join-Path $localApp "TVM\shell"
New-Item -ItemType Directory -Force -Path $userData | Out-Null

$envPrefix = if ($Windowed) {
    "set TVM_WINDOWED=1&& set TVM_CORE_BIND=127.0.0.1&& set TVM_ENV=$($env:TVM_ENV)&& "
} else {
    "set TVM_CORE_BIND=127.0.0.1&& set TVM_ENV=$($env:TVM_ENV)&& "
}

Write-Host $(if ($Windowed) { "Opening TVM (windowed)..." } else { "Opening TVM fullscreen..." })
Start-Process -FilePath "cmd.exe" -ArgumentList @(
    "/c",
    "$envPrefix`"$electron`" --user-data-dir=`"$userData`" dist/main.js"
) -WorkingDirectory $shellDir -WindowStyle Hidden
