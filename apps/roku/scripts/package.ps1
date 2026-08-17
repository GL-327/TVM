$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$rokuRoot = Split-Path -Parent $PSScriptRoot
$stage = Join-Path ([System.IO.Path]::GetTempPath()) "tvm-roku-package"
$out = Join-Path $rokuRoot "tvm-roku.zip"

if (Test-Path $stage) {
  Remove-Item $stage -Recurse -Force
}
New-Item -ItemType Directory -Path $stage | Out-Null

Copy-Item (Join-Path $rokuRoot "manifest") (Join-Path $stage "manifest")
Copy-Item (Join-Path $rokuRoot "source") (Join-Path $stage "source") -Recurse
Copy-Item (Join-Path $rokuRoot "components") (Join-Path $stage "components") -Recurse
Copy-Item (Join-Path $rokuRoot "images") (Join-Path $stage "images") -Recurse

$fonts = Join-Path $rokuRoot "fonts"
if (Test-Path $fonts) {
  Copy-Item $fonts (Join-Path $stage "fonts") -Recurse
}

$config = Join-Path $rokuRoot "config.json"
if (Test-Path $config) {
  Copy-Item $config (Join-Path $stage "config.json")
}

if (Test-Path $out) {
  Remove-Item $out -Force
}

# Roku reads zip entry names as POSIX paths. Compress-Archive writes backslashes
# on Windows, and the channel then fails to find source/main.brs.
$zip = [System.IO.Compression.ZipFile]::Open($out, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem $stage -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($stage.Length).TrimStart("\", "/")
    $entryName = $relative.Replace("\", "/")
    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    $source = [System.IO.File]::OpenRead($_.FullName)
    $dest = $entry.Open()
    try {
      $source.CopyTo($dest)
    } finally {
      $dest.Dispose()
      $source.Dispose()
    }
  }
} finally {
  $zip.Dispose()
}

Write-Host "Wrote $out"
