"""Gera assets/icon.png, assets/icon.ico e assets/tray-linux.png (dois anéis de uso).
Uso: uv run --with pillow scripts/make-icon.py"""
from pathlib import Path
from PIL import Image, ImageDraw

S = 1024
out = Path(__file__).resolve().parent.parent / 'assets'

def rings(track):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for cx, pct, color in ((290, .62, (48, 209, 88, 255)), (734, .30, (255, 179, 64, 255))):
        box = (cx - 215, 512 - 215, cx + 215, 512 + 215)
        d.arc(box, 0, 360, fill=track, width=110)
        d.arc(box, -90, -90 + 360 * pct, fill=color, width=110)
    return img

# App (menu Iniciar, barra de tarefas, menu do GNOME): trilha cinza, visível em fundo claro e escuro.
app = rings((128, 128, 138, 200))
app.resize((256, 256), Image.LANCZOS).save(out / 'icon.png')
app.save(out / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
# Bandeja do Linux: trilha clara, legível na barra escura do GNOME.
rings((235, 235, 240, 110)).resize((64, 64), Image.LANCZOS).save(out / 'tray-linux.png')
