# Builds UI + core, packs tvm-app-<version>.tar.gz, and publishes a GitHub Release.
# Usage: pwsh scripts/publish-app.ps1
# Optional: pwsh scripts/publish-app.ps1 -Version 0.2.0
param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$pkg = Get-Content -Raw (Join-Path $repo "package.json") | ConvertFrom-Json
if ($Version -eq "") { $Version = $pkg.version }
if ($Version -notmatch '^\d+\.\d+\.\d+') { throw "Version must look like 1.2.3, got $Version" }

Write-Host "==> Building @tvm/core and @tvm/ui ($Version)"
corepack pnpm --filter @tvm/core run build
corepack pnpm --filter @tvm/ui run build

$stage = Join-Path $repo "dist-release\app"
$outDir = Join-Path $repo "dist-release"
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $stage "core") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stage "ui") | Out-Null
Copy-Item -Recurse (Join-Path $repo "apps\core\dist\*") (Join-Path $stage "core")
Copy-Item -Recurse (Join-Path $repo "apps\ui\dist\*") (Join-Path $stage "ui")

$tarName = "tvm-app-$Version.tar.gz"
$tarPath = Join-Path $outDir $tarName
$shaPath = Join-Path $outDir "tvm-app-$Version.sha256"

if (Test-Path $tarPath) { Remove-Item $tarPath }
tar -czf $tarPath -C $stage core ui
if ($LASTEXITCODE -ne 0) { throw "tar failed" }

$hash = (Get-FileHash -Algorithm SHA256 $tarPath).Hash.ToLower()
Set-Content -NoNewline -Path $shaPath -Value "$hash  $tarName`n"
Write-Host "==> $tarName  $hash"

$tag = "v$Version"
$notes = "App update $Version (UI + core). Does not replace the OS image."
gh release create $tag $tarPath $shaPath --title $tag --notes $notes
Write-Host "==> Published $tag"
