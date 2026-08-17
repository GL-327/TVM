# Starts TVM on this PC: core + Vite if needed, then the Electron shell.
# Default is fullscreen kiosk (the living-room start). Pass -Windowed for Cursor.
param(
    [switch]$Windowed
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

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

if (-not (Test-Http "http://127.0.0.1:7345/api/health")) {
    Write-Host "Starting TVM core..."
    if ($Windowed) {
        $env:TVM_ENV = "development"
    }
    Start-Process -FilePath "node" -ArgumentList "--watch", "src/index.ts" -WorkingDirectory (Join-Path $repo "apps\core") -WindowStyle Hidden
    if (-not (Wait-Http "http://127.0.0.1:7345/api/health" 40)) {
        throw "TVM core did not start on http://127.0.0.1:7345"
    }
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
if (-not (Test-Path $mainJs)) {
    Write-Host "Building TVM shell..."
    Push-Location $shellDir
    try {
        & corepack pnpm run build
        if ($LASTEXITCODE -ne 0) { throw "shell build failed" }
    } finally {
        Pop-Location
    }
}

$electron = Join-Path $shellDir "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electron)) {
    throw "Electron is not installed. From the TVM folder run: corepack pnpm --filter @tvm/shell install"
}

$userData = Join-Path $env:LOCALAPPDATA "TVM\shell"
New-Item -ItemType Directory -Force -Path $userData | Out-Null

$envPrefix = if ($Windowed) {
    "set TVM_WINDOWED=1&& set TVM_ENV=development&& "
} else {
    "set TVM_ENV=development&& "
}

Write-Host $(if ($Windowed) { "Opening TVM (windowed)..." } else { "Opening TVM fullscreen..." })
Start-Process -FilePath "cmd.exe" -ArgumentList @(
    "/c",
    "$envPrefix`"$electron`" --user-data-dir=`"$userData`" dist/main.js"
) -WorkingDirectory $shellDir -WindowStyle Hidden
