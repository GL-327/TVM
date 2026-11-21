# Builds native/assets/tvm.ico from native/assets/tvm-icon.png.
# Each size is stored as a PNG entry, which Windows Vista and later read.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$assets = Join-Path (Split-Path -Parent $PSScriptRoot) 'assets'
$source = [System.Drawing.Image]::FromFile((Join-Path $assets 'tvm-icon.png'))
$sizes = 16, 24, 32, 48, 64, 128, 256
$images = @()
try {
    foreach ($size in $sizes) {
        $bitmap = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $g = [System.Drawing.Graphics]::FromImage($bitmap)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.DrawImage($source, 0, 0, $size, $size)
        $g.Dispose()
        $png = New-Object System.IO.MemoryStream
        $bitmap.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
        $images += , $png.ToArray()
    }
} finally { $source.Dispose() }

$out = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $out
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $dim = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]$images[$i].Length); $w.Write([UInt32]$offset)
    $offset += $images[$i].Length
}
foreach ($bytes in $images) { $w.Write($bytes) }
$w.Flush()
[IO.File]::WriteAllBytes((Join-Path $assets 'tvm.ico'), $out.ToArray())
Write-Host "Wrote $(Join-Path $assets 'tvm.ico')"
