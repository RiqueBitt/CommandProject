#!/usr/bin/env python3
"""Gera uma cena de teste no estilo RTS (não é imagem do jogo) para testar os shaders.

Tem o que importa para avaliar pós-processamento: terreno com relevo e névoa (imagem
"lavada"), rio, unidades e prédios desenhados sem anti-serrilhado, tiros e explosões
claros (bloom) e uma HUD com texto pequeno (para ver se continua legível).

Uso: python tools/make_test_scene.py saida.png [largura altura]
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = (int(sys.argv[2]), int(sys.argv[3])) if len(sys.argv) > 3 else (1280, 720)
rng = np.random.default_rng(7)


def fbm(w, h, octaves=6):
    out = np.zeros((h, w))
    amp, total = 1.0, 0.0
    for o in range(octaves):
        n = 2 ** (o + 2)
        grid = rng.random((n + 1, n + 1))
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += np.asarray(img, dtype=float) / 255 * amp
        total += amp
        amp *= 0.5
    return out / total


height = fbm(W, H)
yy, xx = np.mgrid[0:H, 0:W]
river_x = W * 0.58 + np.sin(yy / H * 6.0) * W * 0.06
river = np.clip(1 - np.abs(xx - river_x) / (W * 0.035), 0, 1)
height = height - river * 0.35

gy, gx = np.gradient(height * 60)
light = np.clip(0.55 + (-gx * 0.6 - gy * 0.8) * 0.9, 0.15, 1.25)

grass = np.array([0.33, 0.45, 0.22])
dirt = np.array([0.52, 0.45, 0.33])
rock = np.array([0.55, 0.55, 0.52])
t = height[..., None]
col = np.where(t < 0.45, grass, np.where(t < 0.62, grass * (0.62 - t) / 0.17 + dirt * (t - 0.45) / 0.17, dirt * 0.5 + rock * 0.5))
col = col * light[..., None]
detail = fbm(W, H, 3)[..., None]
col *= 0.85 + detail * 0.3
water = np.array([0.16, 0.30, 0.42]) * (0.8 + 0.4 * light[..., None])
col = col * (1 - river[..., None] ** 0.5) + water * river[..., None] ** 0.5
# "lavado": névoa azulada e pouco contraste, como muitos jogos de 2010
col = col * 0.78 + np.array([0.55, 0.60, 0.66]) * 0.22
img = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8))
img = img.resize((W // 2, H // 2), Image.BILINEAR).resize((W, H), Image.BILINEAR)  # renderização macia

d = ImageDraw.Draw(img)  # sem anti-serrilhado de propósito


def unit(cx, cy, ang, team, size=11):
    c = (60, 110, 200) if team == 0 else (200, 60, 50)
    pts = []
    for dx, dy in [(-1, -0.6), (1, -0.6), (1.2, 0), (1, 0.6), (-1, 0.6)]:
        x = dx * size
        y = dy * size
        pts.append((cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang)))
    d.polygon([(x + 2, y + 3) for x, y in pts], fill=(30, 34, 28))
    d.polygon(pts, fill=c, outline=(20, 22, 26))
    ex, ey = cx + math.cos(ang) * size * 1.9, cy + math.sin(ang) * size * 1.9
    d.line([(cx, cy), (ex, ey)], fill=(40, 42, 48), width=3)


def building(x, y, s, team):
    c = (70, 100, 160) if team == 0 else (160, 70, 60)
    d.rectangle([x + 4, y + 6, x + s + 4, y + s + 6], fill=(28, 30, 26))
    d.rectangle([x, y, x + s, y + s], fill=(120, 124, 130), outline=(30, 32, 36))
    d.rectangle([x + s * 0.2, y + s * 0.2, x + s * 0.8, y + s * 0.8], fill=c)
    d.ellipse([x + s * 0.38, y + s * 0.38, x + s * 0.62, y + s * 0.62], fill=(210, 220, 230))


for i in range(5):
    building(90 + i * 70, 120 + (i % 2) * 70, 48, 0)
for i in range(4):
    building(W - 380 + i * 75, H - 360 + (i % 2) * 60, 52, 1)
for i in range(22):
    unit(rng.uniform(250, W * 0.5), rng.uniform(220, H - 240), rng.uniform(-0.4, 0.6), 0)
for i in range(18):
    unit(rng.uniform(W * 0.62, W - 200), rng.uniform(150, H - 260), rng.uniform(2.6, 3.6), 1)

glow = Image.new("RGB", (W, H))
g = ImageDraw.Draw(glow)
for i in range(9):
    x0, y0 = rng.uniform(350, W * 0.5), rng.uniform(220, H - 260)
    x1, y1 = rng.uniform(W * 0.62, W - 220), rng.uniform(160, H - 270)
    g.line([(x0, y0), (x1, y1)], fill=(255, 210, 120), width=2)
for cx, cy, r in [(W * 0.6, H * 0.42, 34), (W * 0.66, H * 0.3, 24), (W * 0.52, H * 0.55, 20)]:
    g.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 170, 70))
    g.ellipse([cx - r * 0.5, cy - r * 0.5, cx + r * 0.5, cy + r * 0.5], fill=(255, 245, 210))
img = Image.fromarray(np.maximum(np.asarray(img), np.asarray(glow)))

d = ImageDraw.Draw(img)
d.rectangle([0, 0, W, 30], fill=(22, 26, 32))
d.text((14, 9), "MASSA 1240 (+38)    ENERGIA 5600 (+120)    UNIDADES 46/500", fill=(220, 226, 232))
d.rectangle([0, H - 150, W, H], fill=(20, 24, 30))
d.rectangle([0, H - 150, W, H - 147], fill=(70, 120, 180))
d.rectangle([16, H - 136, 236, H - 14], fill=(36, 44, 40), outline=(90, 100, 110))
for i in range(12):
    x = 270 + (i % 6) * 64
    y = H - 132 + (i // 6) * 62
    d.rectangle([x, y, x + 54, y + 54], fill=(44, 52, 64), outline=(110, 130, 150))
    d.text((x + 6, y + 38), f"T{i + 1}", fill=(230, 230, 230))
for j, line in enumerate(["Tanque Rockhead", "Vida 1800/1800", "Alcance 34  Dano 120/s", "Ordem: patrulhar"]):
    d.text((W - 330, H - 128 + j * 22), line, fill=(214, 220, 226))
img.save(sys.argv[1])
