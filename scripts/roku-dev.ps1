# Starts Core in development (LAN bind), the Vite UI, and a 1920x1080 TV frame
# of the desktop app. Optional: rebuild the sideload zip / push onto a TV.
param(
    [string]$RokuHost = $env:TVM_ROKU_HOST,
    [string]$RokuPassword = $env:TVM_ROKU_PASSWORD,
    [switch]$Sideload,
    [switch]$NoBrowser,
    [switch]$NoPackage
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$coreDir = Join-Path $repo "apps\core"
$previewUrl = "http://127.0.0.1:5173/?tv=1"
$loaderUrl = "http://127.0.0.1:7345/roku-preview/"
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

function Get-TvmLanIps {
    $ips = @()
    try {
        $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and
                $_.PrefixOrigin -ne 'WellKnown'
            } |
            Sort-Object {
                if ($_.IPAddress.StartsWith('192.168.')) { 0 }
                elseif ($_.IPAddress.StartsWith('10.')) { 1 }
                else { 2 }
            },
            { if ($_.InterfaceAlias -match 'Wi-Fi|WiFi|Ethernet') { 0 } else { 1 } } |
            Select-Object -ExpandProperty IPAddress -Unique)
    } catch {
        $ips = @()
    }
    return $ips
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

if (-not (Test-Http $healthUrl)) {
    Write-Host "Starting TVM core with TVM_ENV=development..."
    Start-Process -FilePath "node" -ArgumentList "--watch", "src/index.ts" -WorkingDirectory $coreDir
    if (-not (Wait-Http $healthUrl 40)) {
        throw "TVM core did not start on http://127.0.0.1:7345"
    }
} else {
    Write-Host "Core is already running on http://127.0.0.1:7345"
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

$lanIps = Get-TvmLanIps
$preferred = if ($lanIps.Count -gt 0) { $lanIps[0] } else { '' }
$lanReachable = $false
if ($preferred -ne '') {
    $lanReachable = Test-Http "http://${preferred}:7345/api/health"
}

Write-Host ""
Write-Host "PC preview (same desktop UI, 1920x1080 TV frame):"
Write-Host "  $previewUrl"
Write-Host "  Arrows move, Enter is OK, Esc or Backspace is Back."
if (Test-Http $loaderUrl) {
    Write-Host "  Loader: $loaderUrl"
} else {
    Write-Host "  Core loader is off. Start Core with TVM_ENV=development if a Roku needs LAN access."
}
Write-Host ""

if ($preferred -eq '') {
    Write-Host "Could not find a LAN IPv4 address for this PC."
} else {
    Write-Host "On a Roku, set Core API URL to:"
    Write-Host "  http://${preferred}:7345"
    if ($lanIps.Count -gt 1) {
        Write-Host "Other addresses on this PC: $($lanIps -join ', ')"
        Write-Host "Prefer Wi-Fi/Ethernet. Skip VPN, WSL, and VirtualBox adapters if Home cannot load."
    }
    if ($lanReachable) {
        Write-Host "LAN health check succeeded. The TV should be able to reach Core if it is on the same Wi-Fi."
    } else {
        Write-Host "LAN health check failed. Core may be bound to loopback, or a firewall/VPN is in the way."
        Write-Host "Close other TVM windows and run this helper so Core starts with TVM_ENV=development."
    }
}

if (-not $NoPackage) {
    Write-Host ""
    Write-Host "Packaging the sideload zip..."
    & (Join-Path $repo "apps\roku\scripts\package.ps1")
    $zip = Join-Path $repo "apps\roku\tvm-roku.zip"
    Write-Host "Sideload zip: $zip"
    Write-Host "On the Roku: Home x3, Up x2, Right, Left, Right, Left, Right. Then open http://<roku-ip> as rokudev."
}

$resolvedHost = Find-RokuHost -Hint $RokuHost
if ($resolvedHost -ne '') {
    Write-Host ""
    Write-Host "Found a Roku at $resolvedHost"
}

$shouldSideload = $Sideload -or ($resolvedHost -ne '' -and $RokuPassword -ne '')
if ($shouldSideload) {
    if ($resolvedHost -eq '') { throw "Set TVM_ROKU_HOST or pass -RokuHost to sideload." }
    if ($RokuPassword -eq '') { throw "Set TVM_ROKU_PASSWORD or pass -RokuPassword to sideload." }
    $zip = Join-Path $repo "apps\roku\tvm-roku.zip"
    if (-not (Test-Path $zip)) { throw "Missing $zip. Re-run without -NoPackage." }
    Write-Host "Sideloading onto $resolvedHost ..."
    & curl.exe -sS --digest -u "rokudev:$RokuPassword" -F "mysubmit=Install" -F "archive=@$zip" "http://$resolvedHost/plugin_install" | Out-Null
    Start-Sleep -Seconds 2
    try {
        Invoke-WebRequest -Uri "http://${resolvedHost}:8060/launch/dev" -Method POST -UseBasicParsing -TimeoutSec 5 | Out-Null
        Write-Host "Asked the Roku to launch the sideloaded channel (dev)."
    } catch {
        Write-Host "Zip uploaded. Launch the dev channel from the Roku if it did not start."
    }
} elseif ($resolvedHost -ne '') {
    Write-Host "To sideload automatically next time, set TVM_ROKU_PASSWORD and re-run, or:"
    Write-Host "  .\TVM-roku.cmd -Sideload -RokuHost $resolvedHost -RokuPassword <rokudev password>"
}

if (-not $NoBrowser) {
    Write-Host ""
    Write-Host "Opening the desktop UI in a 1920x1080 TV frame..."
    Start-Process $previewUrl
}
