"""Export the Android launcher vector as desktop SVG, PNG and multi-size ICO.
Run with Python and Pillow from any directory; Android remains the source of truth.
"""
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
source = root / "app/src/main/res/drawable/ic_launcher.xml"
ns = "{http://schemas.android.com/apk/res/android}"
vector = ET.parse(source).getroot()
width = float(vector.get(ns + "viewportWidth"))
height = float(vector.get(ns + "viewportHeight"))
background, mark = list(vector)
fill = background.get(ns + "fillColor")
ink = mark.get(ns + "strokeColor")
stroke = float(mark.get(ns + "strokeWidth"))
path_data = mark.get(ns + "pathData")
assert not re.search(r"[^ML0-9.,\s-]", path_data), "Update exporter for new vector commands"
assets = root / "desktop/assets"
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:g} {height:g}"><path fill="{fill}" d="{background.get(ns + "pathData")}"/><path fill="none" stroke="{ink}" stroke-width="{stroke:g}" stroke-linecap="round" stroke-linejoin="round" d="{path_data}"/></svg>\n'
(assets / "icon.svg").write_text(svg, encoding="utf-8")
# Supersample the existing line geometry; this exports an asset, without redesigning it.
size = 2048
scale = size / width
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
background_path = background.get(ns + "pathData")
if "A" in background_path:
    corner = float(re.match(r"M([0-9.]+)", background_path).group(1))
    draw.rounded_rectangle((0, 0, size-1, size-1), radius=corner*scale, fill=fill)
else:
    draw.rectangle((0, 0, size, size), fill=fill)
radius = stroke * scale / 2
for segment in path_data.split("M"):
    if not segment.strip():
        continue
    coords = list(map(float, re.findall(r"-?\d+(?:\.\d+)?", segment)))
    points = [(coords[i] * scale, coords[i + 1] * scale) for i in range(0, len(coords), 2)]
    draw.line(points, fill=ink, width=round(stroke * scale), joint="curve")
    for x, y in points:
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), fill=ink)
image = image.resize((512, 512), Image.Resampling.LANCZOS)
image.save(assets / "icon.png")
image.save(assets / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
print("Exported desktop icon.svg, icon.png and icon.ico from Android ic_launcher.xml")
