# Starts the local TV preview. -Lan or -Sideload enables authenticated LAN testing.
param(
    [string]$RokuHost = $env:TVM_ROKU_HOST,
    [string]$RokuPassword = $env:TVM_ROKU_PASSWORD,
    [switch]$Sideload,
    [switch]$Lan,
    [string]$CoreAddress = $env:TVM_CORE_ADDRESS,
    [switch]$NoBrowser,
    [switch]$NoPackage
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$coreDir = Join-Path $repo "apps\core"
$previewUrl = "http://127.0.0.1:5173/?tv=1"
$healthUrl = "http://127.0.0.1:7345/api/health"
$uiUrl = "http://127.0.0.1:5173/"

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

function Find-RokuHost {
    param([string]$Hint)
    if ($Hint -ne '') { return $Hint }

    $udp = New-Object System.Net.Sockets.UdpClient
    try {
        $udp.Client.ReceiveTimeout = 2500
        $endpoint = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Parse('239.255.255.250'), 1900)
        $payload = [Text.Encoding]::ASCII.GetBytes("M-SEARCH * HTTP/1.1`r`nHOST: 239.255.255.250:1900`r`nMAN: `"ssdp:discover`"`r`nST: roku:ecp`r`nMX: 2`r`n`r`n")
        [void]$udp.Send($payload, $payload.Length, $endpoint)
        $from = New-Object System.Net.IPEndPoint ([System.Net.IPAddress]::Any, 0)
        $raw = $udp.Receive([ref]$from)
        $text = [Text.Encoding]::ASCII.GetString($raw)
        if ($text -match 'LOCATION:\s*http://([0-9.]+):') {
            return $Matches[1]
        }
        return $from.Address.ToString()
    } catch {
        return ''
    } finally {
        $udp.Dispose()
    }
}

Write-Host "TVM Roku helper"
Write-Host ""

$env:TVM_ENV = "development"
$env:TVM_CORE_BIND = "127.0.0.1"
$useLan = $Lan -or $Sideload
if ($useLan) {
    if ($env:TVM_LAN_TOKEN.Length -lt 32) { throw "Set TVM_LAN_TOKEN to a random value of at least 32 characters first. See apps/roku/README.md." }
    $coreIp = $null
    if (-not [System.Net.IPAddress]::TryParse($CoreAddress, [ref]$coreIp) -or $coreIp.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or [System.Net.IPAddress]::IsLoopback($coreIp) -or $CoreAddress -eq '0.0.0.0') {
        throw "Pass -CoreAddress with this computer's LAN IPv4 address (or set TVM_CORE_ADDRESS)."
    }
    $env:TVM_CORE_BIND = "0.0.0.0"
}

if (-not (Test-Http $healthUrl)) {
    Write-Host "Starting TVM Core on $($env:TVM_CORE_BIND)..."
    Start-Process -FilePath "node" -ArgumentList "--watch", "src/index.ts" -WorkingDirectory $coreDir -WindowStyle Hidden
    if (-not (Wait-Http $healthUrl 40)) {
        throw "TVM core did not start on http://127.0.0.1:7345"
    }
} else {
    Write-Host "Core is already running on http://127.0.0.1:7345"
}

if ($useLan) {
    try {
        Invoke-WebRequest -Uri "http://${CoreAddress}:7345/api/profiles" -Headers @{ Authorization = "Bearer $($env:TVM_LAN_TOKEN)" } -UseBasicParsing -TimeoutSec 5 | Out-Null
    } catch {
        throw "Core is not reachable with this LAN token. If desktop TVM started Core on loopback, close that Core process and rerun. Check the IP and private-network firewall rule."
    }
    Write-Host "Roku Core URL: http://${CoreAddress}:7345"
    Write-Host "Enter the same TVM_LAN_TOKEN in the Roku setup screen."
}

if (-not (Test-Http $uiUrl)) {
    Write-Host "Starting TVM UI..."
    $vite = Join-Path $repo "apps\ui\node_modules\vite\bin\vite.js"
    Start-Process -FilePath "node" -ArgumentList $vite -WorkingDirectory (Join-Path $repo "apps\ui") -WindowStyle Hidden
    if (-not (Wait-Http $uiUrl 40)) {
        throw "TVM UI did not start on http://127.0.0.1:5173"
    }
} else {
    Write-Host "UI is already running on http://127.0.0.1:5173"
}

Write-Host ""
Write-Host "PC preview (same desktop UI, 1920x1080 TV frame):"
Write-Host "  $previewUrl"
Write-Host "  Arrows move, Enter is OK, Esc or Backspace is Back."
Write-Host "  This runs on this computer. A Wi-Fi adapter is not required."
Write-Host ""

if (-not $NoBrowser) {
    Write-Host "Opening TVM..."
    Start-Process $previewUrl
}

if (-not $NoPackage) {
    try {
        Write-Host "Packaging the sideload zip..."
        & node (Join-Path $repo "apps\roku\scripts\package.mjs")
        if ($LASTEXITCODE -ne 0) { throw "Package creation failed" }
        & node (Join-Path $repo "apps\roku\scripts\check.mjs")
        if ($LASTEXITCODE -ne 0) { throw "Package validation failed" }
        Write-Host "Sideload zip: $(Join-Path $repo 'apps\roku\tvm-roku.zip')"
    } catch {
        if ($Sideload) { throw }
        Write-Host "Sideload zip skipped ($($_.Exception.Message)). TVM is still open."
    }
}

if (-not $Sideload) { return }

$resolvedHost = Find-RokuHost -Hint $RokuHost
if ($resolvedHost -eq '') { throw "Set TVM_ROKU_HOST or pass -RokuHost to sideload. Discovery is skipped unless you ask." }
if ($RokuPassword -eq '') { throw "Set TVM_ROKU_PASSWORD or pass -RokuPassword to sideload." }
$zip = Join-Path $repo "apps\roku\tvm-roku.zip"
if (-not (Test-Path $zip)) { throw "Missing $zip. Re-run without -NoPackage." }
Write-Host "Sideloading onto $resolvedHost ..."
$installOutput = & curl.exe -fsS --connect-timeout 5 --max-time 60 --digest -u "rokudev:$RokuPassword" -F "mysubmit=Install" -F "archive=@$zip" "http://$resolvedHost/plugin_install"
if ($LASTEXITCODE -ne 0) { throw "Roku installation request failed. Enable developer mode and check the Roku IP/password." }
if (($installOutput -join " ") -match '(?i)install failure|compilation failed|invalid package') { throw "Roku rejected the package. Open the Roku developer page for its compiler output." }
Start-Sleep -Seconds 2
try {
    Invoke-WebRequest -Uri "http://${resolvedHost}:8060/launch/dev" -Method POST -UseBasicParsing -TimeoutSec 5 | Out-Null
    Write-Host "Asked the Roku to launch the sideloaded channel (dev)."
} catch {
    Write-Host "Zip uploaded. Launch the dev channel from the Roku if it did not start."
}
