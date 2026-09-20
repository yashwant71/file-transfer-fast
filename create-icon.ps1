Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 64, 64
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

# Draw blue circle background with glow
$brushBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 37, 99, 235))
$g.FillEllipse($brushBg, 3, 3, 58, 58)

# Draw yellow lightning bolt polygon
$p1 = New-Object System.Drawing.PointF(35.0, 10.0)
$p2 = New-Object System.Drawing.PointF(20.0, 34.0)
$p3 = New-Object System.Drawing.PointF(32.0, 34.0)
$p4 = New-Object System.Drawing.PointF(27.0, 54.0)
$p5 = New-Object System.Drawing.PointF(44.0, 28.0)
$p6 = New-Object System.Drawing.PointF(33.0, 28.0)
[System.Drawing.PointF[]]$points = @($p1, $p2, $p3, $p4, $p5, $p6)
$brushBolt = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 250, 204, 21))
$g.FillPolygon($brushBolt, $points)

$penBorder = New-Object System.Drawing.Pen([System.Drawing.Color]::White, 1.5)
$g.DrawPolygon($penBorder, $points)

$g.Dispose()

# Save icon
$hIcon = $bmp.GetHicon()
$icon = [System.Drawing.Icon]::FromHandle($hIcon)
$fs = New-Object System.IO.FileStream((Join-Path $PSScriptRoot 'app.ico'), [System.IO.FileMode]::Create)
$icon.Save($fs)
$fs.Close()
$icon.Dispose()
$bmp.Dispose()
Write-Host "ICON_SUCCESS"
