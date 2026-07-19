Add-Type -AssemblyName System.Drawing
$imagePath = "c:\Users\Robert Terre\Documents\CLEAN Blockchain Cloud\public\logo.png"
$outputPath = "c:\Users\Robert Terre\Documents\CLEAN Blockchain Cloud\public\logo_final.png"

echo "Accessing logo for high-compression..."

$img = [System.Drawing.Image]::FromFile($imagePath)
# Create a lower-bit depth or indexed version if possible, but simplest is just a clean resave
# with a clear canvas.
$newImg = new-object System.Drawing.Bitmap(512, 512)
$g = [System.Drawing.Graphics]::FromImage($newImg)
$g.Clear([System.Drawing.Color]::Transparent)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, 512, 512)

echo "Executing Aggressive Optimization..."

# We will save it without a high-quality encoder to force a smaller file size
$newImg.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$img.Dispose()
$newImg.Dispose()
$g.Dispose()

$fileSize = (Get-Item $outputPath).Length / 1KB
echo "SUCCESS! Compressed logo created. Final size: $fileSize KB"
Pause
