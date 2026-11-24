# Builds native/assets/tvm.ico from native/assets/tvm-icon.png.
# Each size is a rounded square (transparent corners), stored as a PNG entry, which Windows Vista and later read.
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
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        # A rounded square like Windows 11 app icons: corners about 22% of the side, a small clear margin at
        # 48px and up so it sits like other taskbar icons, and almost none at 16-32px so the lettering stays legible.
        $margin = if ($size -le 24) { 0 } elseif ($size -le 32) { 1 } else { [Math]::Round($size * 0.04) }
        $inner = $size - 2 * $margin
        $r = $inner * 0.22
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc($margin, $margin, 2 * $r, 2 * $r, 180, 90)
        $path.AddArc($margin + $inner - 2 * $r, $margin, 2 * $r, 2 * $r, 270, 90)
        $path.AddArc($margin + $inner - 2 * $r, $margin + $inner - 2 * $r, 2 * $r, 2 * $r, 0, 90)
        $path.AddArc($margin, $margin + $inner - 2 * $r, 2 * $r, 2 * $r, 90, 90)
        $path.CloseFigure()
        $brush = New-Object System.Drawing.TextureBrush $source
        $brush.ScaleTransform($inner / $source.Width, $inner / $source.Height)
        $brush.TranslateTransform($margin, $margin, [System.Drawing.Drawing2D.MatrixOrder]::Append)
        $g.FillPath($brush, $path)
        $brush.Dispose(); $path.Dispose()
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
