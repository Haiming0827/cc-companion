#!/usr/bin/env python3
"""Generate CC Companion app icon — bright version."""
from PIL import Image, ImageDraw, ImageFont
import math, os

SIZE = 1024
CENTER = SIZE // 2
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Rounded rectangle background - rich dark
radius = 220
bg_color = (24, 20, 18)
draw.rounded_rectangle([40, 40, SIZE - 40, SIZE - 40], radius=radius, fill=bg_color)

# Bright orange border glow
for i in range(5):
    offset = 44 + i * 2
    alpha = 80 - i * 15
    draw.rounded_rectangle(
        [offset, offset, SIZE - offset, SIZE - offset],
        radius=radius - 4,
        outline=(249, 115, 22, alpha),
        width=2
    )

accent = (249, 115, 22)       # bright orange
accent_hot = (255, 160, 60)   # even brighter
white = (255, 255, 255)

# Sword parameters — BIGGER
sword_len = 380
cx, cy = CENTER, CENTER - 30

def draw_sword(cx, cy, angle, draw):
    cos_a, sin_a = math.cos(angle), math.sin(angle)
    perp_cos, perp_sin = -sin_a, cos_a

    bx1 = cx - cos_a * sword_len
    by1 = cy - sin_a * sword_len
    bx2 = cx + cos_a * sword_len
    by2 = cy + sin_a * sword_len

    # Blade glow
    for w, c in [(22, (*accent, 50)), (14, (*accent_hot, 100)), (6, (255, 240, 220, 240)), (3, white)]:
        draw.line([(bx1, by1), (bx2, by2)], fill=c, width=w)

    # Guard
    guard_len = 100
    gx1 = cx - perp_cos * guard_len
    gy1 = cy - perp_sin * guard_len
    gx2 = cx + perp_cos * guard_len
    gy2 = cy + perp_sin * guard_len
    draw.line([(gx1, gy1), (gx2, gy2)], fill=accent, width=16)
    draw.line([(gx1, gy1), (gx2, gy2)], fill=accent_hot, width=10)
    # Guard end caps
    for gx, gy in [(gx1, gy1), (gx2, gy2)]:
        draw.ellipse([gx-10, gy-10, gx+10, gy+10], fill=accent_hot)

    # Pommel
    pommel_x = cx + cos_a * (sword_len - 10)
    pommel_y = cy + sin_a * (sword_len - 10)
    draw.ellipse([pommel_x-18, pommel_y-18, pommel_x+18, pommel_y+18], fill=accent)
    draw.ellipse([pommel_x-10, pommel_y-10, pommel_x+10, pommel_y+10], fill=accent_hot)

    # Blade tip
    tip_x = cx - cos_a * sword_len
    tip_y = cy - sin_a * sword_len
    tip_size = 14
    draw.polygon([
        (tip_x - cos_a * tip_size * 2.5, tip_y - sin_a * tip_size * 2.5),
        (tip_x - perp_cos * tip_size, tip_y - perp_sin * tip_size),
        (tip_x + cos_a * tip_size, tip_y + sin_a * tip_size),
        (tip_x + perp_cos * tip_size, tip_y + perp_sin * tip_size),
    ], fill=white)

angle1 = math.radians(35)
angle2 = math.radians(-35)
draw_sword(cx, cy, angle1, draw)
draw_sword(cx, cy, angle2, draw)

# Center piece — BIGGER, brighter
# Outer glow
for r in range(55, 40, -3):
    alpha = int(60 * (55 - r) / 15)
    draw.ellipse([cx-r, cy-r, cx+r, cy+r], fill=(*accent, alpha))
# Main circle
draw.ellipse([cx-42, cy-42, cx+42, cy+42], fill=accent_hot)
draw.ellipse([cx-30, cy-30, cx+30, cy+30], fill=bg_color)
draw.ellipse([cx-20, cy-20, cx+20, cy+20], fill=accent_hot)
draw.ellipse([cx-10, cy-10, cx+10, cy+10], fill=(255, 200, 100))

# "CC" text — bigger, brighter
try:
    font = ImageFont.truetype("/System/Library/Fonts/SFCompact-Bold.otf", 180)
except:
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 180)
    except:
        font = ImageFont.load_default()

text = "CC"
bbox = draw.textbbox((0, 0), text, font=font)
tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
tx = CENTER - tw // 2
ty = CENTER + 190
# Text glow
for dx, dy in [(-2,0),(2,0),(0,-2),(0,2)]:
    draw.text((tx+dx, ty+dy), text, fill=(*accent, 80), font=font)
draw.text((tx, ty), text, fill=(255, 255, 255, 230), font=font)

out_dir = os.path.dirname(os.path.abspath(__file__))
img.save(os.path.join(out_dir, 'icon_1024.png'), 'PNG')
print('Generated icon_1024.png')
