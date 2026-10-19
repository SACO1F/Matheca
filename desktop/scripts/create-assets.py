from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parents[1]
assets = root / 'assets'
assets.mkdir(exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 180)
image = Image.new('RGB', (280, 180), 'white')
draw = ImageDraw.Draw(image)
draw.text((95, -8), '7', fill='black', font=font)
image.save(assets / 'vision-test.png')
icon = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(icon)
draw.rounded_rectangle((0, 0, 255, 255), radius=52, fill='#3269E8')
for points in [[(22,60),(35,74),(49,32),(85,32)],[(57,51),(75,73)],[(75,51),(57,73)]]:
    scaled=[(round(x*256/108),round(y*256/108)) for x,y in points]
    draw.line(scaled,fill='white',width=17,joint='curve')
    for x,y in scaled:draw.ellipse((x-8,y-8,x+8,y+8),fill='white')
icon.save(assets / 'icon.png')
icon.save(assets / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
