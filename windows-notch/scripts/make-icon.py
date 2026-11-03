"""Gera assets/icon.png e assets/icon.ico (notch com dois anéis). Uso: python3 scripts/make-icon.py"""
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024
out = Path(__file__).resolve().parent.parent / 'assets'
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((32, 32, S - 32, S - 32), radius=230, fill=255)
body = Image.new('RGBA', (S, S), (24, 24, 27, 255))
# notch pendurado no topo
ImageDraw.Draw(body).rounded_rectangle((170, -200, S - 170, 520), radius=170, fill=(0, 0, 0, 255))
img.paste(body, (0, 0), mask)
d = ImageDraw.Draw(img)
def ring(cx, cy, r, w, pct, color):
    box = (cx - r, cy - r, cx + r, cy + r)
    d.arc(box, 0, 360, fill=(70, 70, 76, 255), width=w)
    d.arc(box, -90, -90 + 360 * pct, fill=color, width=w)
ring(370, 290, 105, 38, .62, (48, 209, 88, 255))
ring(654, 290, 105, 38, .30, (255, 179, 64, 255))
img = img.resize((256, 256), Image.LANCZOS)
img.save(out / 'icon.png')
img.save(out / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

# Bandeja do Linux: anéis sobre fundo transparente, legíveis na barra escura do GNOME.
tray = Image.new('RGBA', (S, S), (0, 0, 0, 0))
d = ImageDraw.Draw(tray)
def tray_ring(cx, cy, r, w, pct, color):
    box = (cx - r, cy - r, cx + r, cy + r)
    d.arc(box, 0, 360, fill=(235, 235, 240, 110), width=w)
    d.arc(box, -90, -90 + 360 * pct, fill=color, width=w)
tray_ring(290, 512, 215, 110, .62, (48, 209, 88, 255))
tray_ring(734, 512, 215, 110, .30, (255, 179, 64, 255))
tray.resize((64, 64), Image.LANCZOS).save(out / 'tray-linux.png')
