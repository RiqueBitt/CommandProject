"""
Texturas da tela inicial "Comandante" (estilo vermelho e preto): botões com borda neon e ponta em
seta, ícones, sombra lateral, rodapé, painel de notícias e caixa do jogador. Tudo desenhado aqui
(formas simples, sem arte de terceiros). Grava PNGs em crates/cp-core/src/menu_style/; o launcher
converte para DDS quando monta a tela.

    python tools/make_menu_style.py
"""

import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "crates", "cp-core", "src", "menu_style")
SS = 4  # supersampling

RED = (226, 30, 36)
RED_HI = (255, 70, 70)
DARK = (12, 14, 19)


def canvas(w, h):
    return Image.new("RGBA", (w * SS, h * SS), (0, 0, 0, 0))


def done(img, w, h, name):
    img = img.resize((w, h), Image.LANCZOS)
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, name + ".png"), optimize=True)
    return img


def glow(img, radius, strength=1.0):
    """brilho em volta do que já está desenhado (neon)"""
    blur = img.filter(ImageFilter.GaussianBlur(radius * SS))
    if strength != 1.0:
        a = blur.getchannel("A").point(lambda v: min(255, int(v * strength)))
        blur.putalpha(a)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(blur)
    out.alpha_composite(img)
    return out


def button_shape(w, h, tip):
    """contorno do botão: canto de cima à esquerda cortado e ponta em seta à direita"""
    c = 4 * SS
    return [(c, 0), (w - tip, 0), (w - 1, h // 2), (w - tip, h - 1), (0, h - 1), (0, c)]


def button(name, w, h, state):
    W, H = w * SS, h * SS
    tip = int(h * 0.55 * SS)
    pad = 6 * SS  # espaço para o brilho
    img = Image.new("RGBA", (W + 2 * pad, H + 2 * pad), (0, 0, 0, 0))
    shape = [(x + pad, y + pad) for x, y in button_shape(W, H, tip)]
    # fundo
    fill = Image.new("RGBA", img.size, (0, 0, 0, 0))
    fd = ImageDraw.Draw(fill)
    if state == "u":
        top, bottom, alpha = (34, 37, 44), (10, 11, 15), 215
    elif state == "o":
        top, bottom, alpha = (150, 22, 24), (52, 8, 10), 235
    elif state == "at":
        top, bottom, alpha = (196, 28, 30), (70, 8, 10), 240
    else:  # w: apertado
        top, bottom, alpha = (110, 14, 16), (30, 5, 6), 240
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon(shape, fill=255)
    grad = Image.new("RGBA", img.size)
    gd = ImageDraw.Draw(grad)
    for y in range(img.size[1]):
        t = min(1, max(0, (y - pad) / H))
        col = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        gd.line([(0, y), (img.size[0], y)], fill=col + (alpha,))
    # o vermelho dos estados ativos some para a direita (como na arte)
    if state in ("o", "at", "w"):
        fade = Image.new("L", img.size, 0)
        fdd = ImageDraw.Draw(fade)
        for x in range(img.size[0]):
            t = x / img.size[0]
            fdd.line([(x, 0), (x, img.size[1])], fill=int(255 * (1 - 0.55 * t)))
        dark = Image.new("RGBA", img.size, (14, 15, 20, alpha))
        grad = Image.composite(grad, dark, fade)
    fill.paste(grad, (0, 0), mask)
    # brilho de cima
    hl = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(hl).line([shape[0], shape[1]], fill=(255, 255, 255, 40), width=2 * SS)
    fill.alpha_composite(hl)
    img.alpha_composite(fill)
    # borda neon
    line = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(line)
    border = RED_HI if state in ("o", "at") else RED
    width = (3 if state in ("o", "at") else 2) * SS
    ld.line(shape + [shape[0]], fill=border + (255,), width=width, joint="curve")
    # filete de luz à esquerda
    ld.line([(pad + 2 * SS, pad + 8 * SS), (pad + 2 * SS, pad + H - 8 * SS)], fill=border + (255,), width=3 * SS)
    # setas » na ponta
    n = 3 if state in ("o", "at") else 2
    for i in range(n):
        x0 = pad + W - tip - (18 + 13 * i) * SS
        alpha = 255 if state in ("o", "at") else 150
        ld.line([(x0, pad + int(H * 0.28)), (x0 + 9 * SS, pad + H // 2), (x0, pad + int(H * 0.72))],
                fill=border + (alpha - 40 * i,), width=3 * SS, joint="curve")
    line = glow(line, 3.5 if state in ("o", "at") else 2, 1.6 if state in ("o", "at") else 1.0)
    img.alpha_composite(line)
    img = img.crop((pad, pad, pad + W, pad + H))
    return done(img, w * 2, h * 2, name)


def icon(name, draw_fn, size=48):
    img = canvas(size, size)
    d = ImageDraw.Draw(img)
    draw_fn(d, size * SS)
    shadow = img.filter(ImageFilter.GaussianBlur(2 * SS))
    a = shadow.getchannel("A").point(lambda v: int(v * 0.8))
    black = Image.new("RGBA", img.size, (0, 0, 0, 0))
    black.putalpha(a)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.alpha_composite(black, (SS, SS))
    out.alpha_composite(img)
    return done(out, size * 2, size * 2, name)


ICON = (226, 229, 234, 255)
ICON_D = (150, 155, 165, 255)


def star(d, s):
    cx = cy = s / 2
    pts = []
    for i in range(8):
        r = s * (0.46 if i % 2 == 0 else 0.15)
        a = -math.pi / 2 + i * math.pi / 4
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, fill=ICON)
    d.polygon([pts[0], (cx, cy), pts[2], pts[1]], fill=ICON_D)
    d.polygon([pts[4], (cx, cy), pts[6], pts[5]], fill=ICON_D)
    d.ellipse([cx - s * 0.07, cy - s * 0.07, cx + s * 0.07, cy + s * 0.07], fill=(255, 255, 255, 255))


def swords(d, s):
    w = s * 0.075
    for flip in (1, -1):
        x0, y0 = (s * 0.14, s * 0.14) if flip == 1 else (s * 0.86, s * 0.14)
        x1, y1 = (s * 0.74, s * 0.74) if flip == 1 else (s * 0.26, s * 0.74)
        d.line([(x0, y0), (x1, y1)], fill=ICON, width=int(w))
        # guarda
        gx, gy = x1, y1
        d.line([(gx - s * 0.12 * flip, gy + s * 0.12), (gx + s * 0.12 * flip, gy - s * 0.12)], fill=ICON_D, width=int(w))
        # cabo
        d.line([(gx, gy), (gx + s * 0.12 * flip, gy + s * 0.12)], fill=ICON_D, width=int(w * 1.2))
        d.polygon([(x0 - w * flip * 0.2, y0 - w * 0.2), (x0 + w * 1.6 * flip, y0), (x0, y0 + w * 1.6)], fill=ICON)


def globe(d, s):
    w = int(s * 0.06)
    m = s * 0.08
    d.ellipse([m, m, s - m, s - m], outline=ICON, width=w)
    d.ellipse([s * 0.3, m, s * 0.7, s - m], outline=ICON, width=w)
    d.line([(s / 2, m), (s / 2, s - m)], fill=ICON, width=w)
    d.line([(m, s / 2), (s - m, s / 2)], fill=ICON, width=w)
    for y in (0.29, 0.71):
        half = math.sqrt(max(0, 0.42 ** 2 - (y - 0.5) ** 2)) * s
        d.line([(s / 2 - half, y * s), (s / 2 + half, y * s)], fill=ICON, width=w)


def gear(d, s):
    cx = cy = s / 2
    teeth = 8
    pts = []
    for i in range(teeth * 4):
        a = i * 2 * math.pi / (teeth * 4)
        r = s * (0.46 if (i % 4) in (1, 2) else 0.36)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    d.polygon(pts, fill=ICON)
    d.ellipse([cx - s * 0.15, cy - s * 0.15, cx + s * 0.15, cy + s * 0.15], fill=(0, 0, 0, 0))


def folder(d, s):
    d.polygon([(s * 0.08, s * 0.22), (s * 0.38, s * 0.22), (s * 0.46, s * 0.3), (s * 0.92, s * 0.3), (s * 0.92, s * 0.8), (s * 0.08, s * 0.8)], fill=ICON_D)
    d.polygon([(s * 0.08, s * 0.4), (s * 0.92, s * 0.4), (s * 0.92, s * 0.8), (s * 0.08, s * 0.8)], fill=ICON)


def power(d, s):
    w = int(s * 0.085)
    m = s * 0.14
    d.arc([m, m, s - m, s - m], start=-60, end=240, fill=ICON, width=w)
    d.line([(s / 2, s * 0.08), (s / 2, s * 0.5)], fill=ICON, width=w)


def puzzle(d, s):
    """botões de mods da Forja"""
    m = s * 0.16
    d.rectangle([m, m * 1.4, s - m, s - m], fill=ICON)
    d.ellipse([s * 0.4, m * 0.5, s * 0.6, m * 0.5 + s * 0.2], fill=ICON)
    d.ellipse([s - m - s * 0.1, s * 0.45, s - m + s * 0.1, s * 0.65], fill=ICON)
    d.rectangle([m, m * 1.4, s - m, m * 1.4 + s * 0.06], fill=ICON_D)


def font(size):
    for f in ("DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def spaced(d, xy, text, f, fill, spacing):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + spacing


def shade():
    """escurece a esquerda (atrás dos botões) e a parte de baixo, com um toque de vermelho"""
    w, h = 512, 256
    img = Image.new("RGBA", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            t = x / (w - 1)
            a = 0.92 * (1 - t) ** 1.3
            b = max(0, (y / h - 0.55) / 0.45) ** 2 * 0.55
            alpha = min(1, a + b * (1 - a))
            px[x, y] = (8, 4, 6, int(alpha * 255))
    img.save(os.path.join(OUT, "shade.png"), optimize=True)


def tint():
    """tom vermelho e vinheta por cima do vídeo"""
    w, h = 256, 144
    img = Image.new("RGBA", (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            dx, dy = (x / w - 0.5) * 1.4, (y / h - 0.45) * 1.8
            v = min(1, (dx * dx + dy * dy) ** 1.2)
            alpha = 0.30 + 0.55 * v
            r = int(70 * (1 - v) + 6 * v)
            px[x, y] = (r, 3, 6, int(alpha * 255))
    img.save(os.path.join(OUT, "tint.png"), optimize=True)


def footer():
    w, h = 64, 48
    img = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=(6, 6, 9, int(150 + 90 * y / h)))
    d.line([(0, 0), (w, 0)], fill=RED + (200,), width=1)
    img.save(os.path.join(OUT, "footer.png"), optimize=True)


def slogan(words, name):
    w, h = 400, 32
    img = canvas(w, h)
    d = ImageDraw.Draw(img)
    # emblema: triângulo com estrela
    s = h * SS
    d.polygon([(s * 0.5, s * 0.08), (s * 0.95, s * 0.92), (s * 0.05, s * 0.92)], fill=RED + (255,))
    d.polygon([(s * 0.5, s * 0.36), (s * 0.7, s * 0.8), (s * 0.3, s * 0.8)], fill=(14, 4, 6, 255))
    f = font(int(14 * SS))
    x = s * 1.35
    for i, word in enumerate(words):
        spaced(d, (x, s * 0.24), word, f, (235, 238, 242, 255), 3 * SS)
        x += sum(d.textlength(c, font=f) + 3 * SS for c in word) + 12 * SS
        if i < len(words) - 1:
            d.line([(x, s * 0.55), (x + 10 * SS, s * 0.55)], fill=RED + (255,), width=2 * SS)
            x += 24 * SS
    done(img, w * 2, h * 2, name)


def panel():
    """painel de notícias: fundo escuro, borda vermelha, faixa do título"""
    w, h = 270, 175
    img = canvas(w, h)
    d = ImageDraw.Draw(img)
    W, H = w * SS, h * SS
    c = 8 * SS
    shape = [(c, 0), (W - 1, 0), (W - 1, H - c), (W - c, H - 1), (0, H - 1), (0, c)]
    d.polygon(shape, fill=(10, 11, 15, 225))
    line = canvas(w, h)
    ImageDraw.Draw(line).line(shape + [shape[0]], fill=(150, 26, 30, 255), width=2 * SS)
    img.alpha_composite(glow(line, 1.5))
    d = ImageDraw.Draw(img)
    d.rectangle([2 * SS, 2 * SS, W - 2 * SS, 26 * SS], fill=(22, 8, 10, 235))
    d.line([(2 * SS, 26 * SS), (W - 2 * SS, 26 * SS)], fill=(120, 20, 24, 255), width=SS)
    spaced(d, (12 * SS, 7 * SS), "NOTÍCIAS", font(int(12 * SS)), RED + (255,), 1 * SS)
    done(img, w * 2, h * 2, "panel")


def gamertag():
    """caixa do jogador: espaço para a foto à esquerda e o nome à direita"""
    w, h = 270, 54
    img = canvas(w, h)
    W, H = w * SS, h * SS
    d = ImageDraw.Draw(img)
    c = 10 * SS
    shape = [(c, 0), (W - 1, 0), (W - 1, H - c), (W - c, H - 1), (0, H - 1), (0, c)]
    d.polygon(shape, fill=(10, 11, 15, 225))
    line = canvas(w, h)
    ImageDraw.Draw(line).line(shape + [shape[0]], fill=RED + (255,), width=2 * SS)
    img.alpha_composite(glow(line, 2))
    done(img, w * 2, h * 2, "gamertag")


def topbar():
    """faixa de cima dos outros menus: escura, some para baixo, com um filete de destaque"""
    w, h = 64, 128
    img = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / (h - 1)
        d.line([(0, y), (w, y)], fill=(6, 7, 10, int(235 * (1 - t) ** 0.8)))
    img.save(os.path.join(OUT, "topbar.png"), optimize=True)


def avatar_frame():
    """moldura reta da foto (a do jogo é inclinada e fica torta na caixa nova)"""
    w = h = 48
    img = canvas(w, h)
    W = w * SS
    line = canvas(w, h)
    ld = ImageDraw.Draw(line)
    ld.rectangle([SS, SS, W - 2 * SS, W - 2 * SS], outline=RED + (255,), width=2 * SS)
    for x, y, dx, dy in [(0, 0, 1, 1), (W - 1, 0, -1, 1), (0, W - 1, 1, -1), (W - 1, W - 1, -1, -1)]:
        ld.line([(x, y + dy * 10 * SS), (x, y), (x + dx * 10 * SS, y)], fill=RED_HI + (255,), width=3 * SS)
    img.alpha_composite(glow(line, 1.5))
    done(img, w * 2, h * 2, "avatar_frame")


def sub_button(name, w, h, state):
    """botões dos submenus: mais finos, barra de destaque à esquerda e uma seta só"""
    W, H = w * SS, h * SS
    pad = 5 * SS
    img = Image.new("RGBA", (W + 2 * pad, H + 2 * pad), (0, 0, 0, 0))
    tip = int(h * 0.42 * SS)
    shape = [(x + pad, y + pad) for x, y in [(0, 0), (W - tip, 0), (W - 1, H // 2), (W - tip, H - 1), (0, H - 1)]]
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).polygon(shape, fill=255)
    hot = state in ("o", "at")
    grad = Image.new("RGBA", img.size)
    gd = ImageDraw.Draw(grad)
    for x in range(img.size[0]):
        t = x / img.size[0]
        if hot:
            col = (int(130 - 95 * t), int(18 + 4 * t), int(22 + 4 * t), 230)
        elif state == "w":
            col = (90, 12, 14, 235)
        else:
            col = (int(22 - 8 * t), int(24 - 8 * t), int(30 - 9 * t), int(205 - 50 * t))
        gd.line([(x, 0), (x, img.size[1])], fill=col)
    fill = Image.new("RGBA", img.size, (0, 0, 0, 0))
    fill.paste(grad, (0, 0), mask)
    img.alpha_composite(fill)
    line = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ld = ImageDraw.Draw(line)
    border = RED_HI if hot else (150, 26, 30)
    ld.line(shape + [shape[0]], fill=border + (255 if hot else 200,), width=(2 if hot else 1) * SS + SS // 2, joint="curve")
    ld.rectangle([pad, pad + 4 * SS, pad + 4 * SS, pad + H - 4 * SS], fill=(RED_HI if hot else RED) + (255,))
    x0 = pad + W - tip - 16 * SS
    ld.line([(x0, pad + int(H * 0.32)), (x0 + 7 * SS, pad + H // 2), (x0, pad + int(H * 0.68))], fill=border + (255 if hot else 150,), width=3 * SS, joint="curve")
    img.alpha_composite(glow(line, 2.5 if hot else 1.2, 1.4 if hot else 0.8))
    img = img.crop((pad, pad, pad + W, pad + H))
    return done(img, w * 2, h * 2, name)


if __name__ == "__main__":
    for st in ("u", "o", "at", "w"):
        button(f"btn_{st}", 377, 52, st)
    for n, fn in [("icon_campaign", star), ("icon_skirmish", swords), ("icon_multiplayer", globe), ("icon_options", gear),
                  ("icon_extras", folder), ("icon_quit", power), ("icon_mod", puzzle)]:
        icon(n, fn)
    os.makedirs(OUT, exist_ok=True)
    shade()
    tint()
    for st in ("u", "o", "at", "w"):
        sub_button(f"sub_{st}", 420, 58, st)
    panel()
    gamertag()
    avatar_frame()
    topbar()
    print("ok:", sorted(os.listdir(OUT)))
