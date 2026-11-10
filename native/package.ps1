param([string]$BuildDir = (Join-Path $PSScriptRoot 'build'), [string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
    pnpm --filter @tvm/core run build
    if ($LASTEXITCODE -ne 0) { throw 'Core build failed' }
    pnpm --filter @tvm/ui run build
    if ($LASTEXITCODE -ne 0) { throw 'UI build failed' }
    $stage = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'package'))
    if ($stage -ine ([IO.Path]::GetFullPath($PSScriptRoot) + '\package')) { throw 'Unexpected package directory' }
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
    cmake --install $BuildDir --config $Configuration --prefix $stage
    if ($LASTEXITCODE -ne 0) { throw 'Native install failed' }
    New-Item -ItemType Directory -Force -Path (Join-Path $stage 'core'),(Join-Path $stage 'ui'),(Join-Path $stage 'bin') | Out-Null
    Copy-Item -Path (Join-Path $repo 'apps/core/dist/*') -Destination (Join-Path $stage 'core') -Recurse
    Copy-Item -LiteralPath (Join-Path $repo 'apps/core/package.json') -Destination (Join-Path $stage 'core/package.json')
    Copy-Item -Path (Join-Path $repo 'apps/ui/dist/*') -Destination (Join-Path $stage 'ui') -Recurse
    Copy-Item -LiteralPath (Get-Command node).Source -Destination (Join-Path $stage 'bin/node.exe')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $stage 'README.md')
    Copy-Item -LiteralPath (Join-Path $repo 'TVM.cmd') -Destination $stage
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/launch-tvm.cmd'),(Join-Path $repo 'scripts/launch-tvm.ps1') -Destination $stage
    $commit = (git rev-parse HEAD).Trim()
    @{commit=$commit; builtAt=[DateTime]::UtcNow.ToString('o'); version=(Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version} | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $stage 'native-build.json')
    $zip = Join-Path $PSScriptRoot 'TVM-native-windows.zip'
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -Force
    Write-Host "Packaged $zip"
} finally { Pop-Location }
