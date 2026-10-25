"""Limpeza visual do terreno base (CommandProject) — só biblioteca padrão.

Um mapa gerado em cima de um terreno do jogo herdava o "desenho" do terreno original: as camadas
de chão (areia, rocha, cidade…) e a luz pré-calculada (sombras de morros e prédios que não existem
mais) continuam nos lugares de antes, por cima do relevo novo. Aqui:

* `materials(pl)`  — lê os materiais da malha (um por registro: nome, texturas, máscara de luz);
* `reskin_all(...)` — troca as texturas de TODAS as camadas de chão por um conjunto só (o bioma);
* `relight(...)`    — refaz as máscaras de luz (`lighting/maskNN_{0,1,2}.win.dds`): a cor média de
  cada uma, sombreada pelo relevo NOVO. A posição de cada ponto da máscara vem da própria malha
  (cada triângulo é desenhado no espaço UV da máscara), então funciona em qualquer terreno.

Formato (verificado em MP_002/004/005/007/203): logo no início da tabela de textos há um material
de 84 bytes por registro da malha — u32[0]=nome, [8,9]=difusas das duas camadas, [10,11]=normais,
[14,15]=especulares, [18]=máscara de luz (RNM: 3 imagens DXT5; RGB = luz por direção, A = mistura).
Na malha, cada vértice tem 32 B: posição float3 + atributos; os u16 [2] e [3] dos atributos são o
UV da máscara (0..32767 = 0..1)."""
import math
import re
import struct

NONE = 0xFFFFFFFF
MAT = 84


def _cstr(pl, p):
    if p == NONE or p >= len(pl):
        return None
    e = pl.find(b"\x00", p)
    return pl[p:e].decode("latin1") if e > p else None


def _slot(pl, p):
    """espaço do texto em p (texto + zeros depois dele)"""
    e = pl.find(b"\x00", p)
    k = e
    while k < len(pl) and pl[k] == 0:
        k += 1
    return k - p


def header(pl):
    _ver, nrec, _a, _b, strtab = struct.unpack_from("<5I", pl, 0)
    return nrec, strtab


def materials(pl):
    """[{rec, name, d:[p0,p1], n:[..], s:[..], mask: ptr}] na ordem dos registros da malha."""
    nrec, st = header(pl)
    out = []
    for r in range(nrec):
        o = st + r * MAT
        if o + MAT > len(pl):
            break
        w = struct.unpack_from("<21I", pl, o)
        out.append(dict(rec=r, off=o, name=_cstr(pl, w[0]) or "", d=[w[8], w[9]], n=[w[10], w[11]],
                        s=[w[14], w[15]], mask=w[18]))
    return out


def _is_ground(pl, m):
    d0 = _cstr(pl, m["d"][0]) or ""
    low = (m["name"] + " " + d0).lower()
    if not d0.lower().startswith("/textures/terrain/") or "/water/" in d0.lower():
        return False
    return not any(k in low for k in ("cloud", "water", "foam", "wave"))


def _targets(pl):
    """{"d"|"n"|"s": [(ptr, espaço)]} — os textos de textura de todas as camadas de chão"""
    out = {"d": [], "n": [], "s": []}
    seen = set()
    for m in materials(pl):
        if not _is_ground(pl, m):
            continue
        for key in ("d", "n", "s"):
            for p in m[key]:
                if p in seen or p == NONE or p >= len(pl):
                    continue
                old = _cstr(pl, p)
                if not old or not old.lower().startswith("/textures/terrain/"):
                    continue  # (ex.: /textures/engine/black_d.dds, usado como "sem especular")
                seen.add(p)
                out[key].append((p, _slot(pl, p)))
    return out


def reskin_all(pl, grounds):
    """Troca difusa/normal/especular de todas as camadas de chão por um conjunto só.
    `grounds` = conjuntos {d, n, s} em ordem de preferência. Fica o primeiro que cabe em TODOS
    os lugares (o texto novo precisa ser menor que o espaço do antigo: a edição é no lugar), para
    o chão inteiro ficar igual; se nenhum couber em tudo, cada lugar recebe o primeiro que couber.
    Devolve (payload, trocados, sem_espaço)."""
    if isinstance(grounds, dict):
        grounds = [grounds]
    grounds = [g for g in grounds if g.get("d")]
    pl = bytearray(pl)
    tg = _targets(pl)

    def fits_all(g):
        return all(not g.get(k) or all(len(g[k].encode("latin1")) < sl for _, sl in tg[k]) for k in ("d", "n", "s")) \
            and all(len(g["d"].encode("latin1")) < sl for _, sl in tg["d"])
    uniform = next((g for g in grounds if fits_all(g)), None)
    order = [uniform] if uniform else grounds
    done = skipped = 0
    for key in ("d", "n", "s"):
        for p, slot in tg[key]:
            news = [g[key].encode("latin1") for g in order if g.get(key)]
            if not news:
                continue
            b = next((x for x in news if len(x) < slot), None)
            if b is None:
                skipped += 1
                continue
            pl[p:p + slot] = b + b"\x00" * (slot - len(b))
            done += 1
    return bytes(pl), done, skipped


# ------------------------------------------------------------------ malha

def mesh(pl, data_fixups_max):
    """(offset do bloco da malha, nv, ni) — mesmo critério do toolkit (logo após a última correção)."""
    for off in range(max(0, data_fixups_max - 16) & ~3, min(len(pl) - 20, data_fixups_max + 8192), 4):
        a, b, c, d, e = struct.unpack_from("<5I", pl, off)
        if a == 3 and c == 20 and 0 < b < 5_000_000 and e == 20 + b * 32:
            return off, b, d
    raise ValueError("malha não encontrada")


def _records(pl, nv, ni):
    nrec, _ = header(pl)
    vc = [struct.unpack_from("<I", pl, 20 + r * 108 + 12)[0] for r in range(nrec)] + [nv]
    ic = [struct.unpack_from("<I", pl, 20 + r * 108 + 16)[0] for r in range(nrec)] + [ni]
    return [(vc[r], vc[r + 1], ic[r], ic[r + 1]) for r in range(nrec)]


def _raster(pl, blob, nv, rec, B, grid, cover):
    """Desenha os triângulos do registro no espaço UV da máscara (B×B blocos de 4×4 texels) e
    guarda, em cada bloco, a posição (x, z, y) do mundo que ele mostra."""
    v0, v1, i0, i1 = rec
    vb = blob + 20
    ib = vb + nv * 32
    n = v1 - v0
    if n <= 0 or i1 - i0 < 3:
        return 0
    P = []
    for k in range(v0, v1):
        o = vb + k * 32
        x, y, z = struct.unpack_from("<3f", pl, o)
        u, v = struct.unpack_from("<2H", pl, o + 12 + 4)
        P.append((x, z, u / 32767.0 * B, v / 32767.0 * B, y))
    idx = struct.unpack_from(f"<{i1 - i0}I", pl, ib + i0 * 4)
    hits = 0
    for t in range(0, len(idx) - 2, 3):
        a, b, c = idx[t], idx[t + 1], idx[t + 2]
        if a >= n or b >= n or c >= n:
            continue
        ax, az, au, av, ay = P[a]
        bx, bz, bu, bv, by = P[b]
        cx, cz, cu, cv, cy = P[c]
        if not (-8 <= ax <= grid + 8 or -8 <= bx <= grid + 8 or -8 <= cx <= grid + 8):
            continue
        u0, u1 = int(max(0, min(au, bu, cu))), int(min(B - 1, max(au, bu, cu)))
        w0, w1 = int(max(0, min(av, bv, cv))), int(min(B - 1, max(av, bv, cv)))
        den = (bv - cv) * (au - cu) + (cu - bu) * (av - cv)
        if u1 < u0 or w1 < w0:
            continue
        if abs(den) < 1e-9 or (u1 - u0 + 1) * (w1 - w0 + 1) <= 1:
            k = int(min(B - 1, max(0, (av + bv + cv) / 3))) * B + int(min(B - 1, max(0, (au + bu + cu) / 3)))
            cover[k] = ((ax + bx + cx) / 3, (az + bz + cz) / 3, (ay + by + cy) / 3)
            hits += 1
            continue
        for j in range(w0, w1 + 1):
            pv = j + 0.5
            for i in range(u0, u1 + 1):
                pu = i + 0.5
                l1 = ((bv - cv) * (pu - cu) + (cu - bu) * (pv - cv)) / den
                l2 = ((cv - av) * (pu - cu) + (au - cu) * (pv - cv)) / den
                l3 = 1 - l1 - l2
                if l1 < -0.02 or l2 < -0.02 or l3 < -0.02:
                    continue
                cover[j * B + i] = (l1 * ax + l2 * bx + l3 * cx, l1 * az + l2 * bz + l3 * cz, l1 * ay + l2 * by + l3 * cy)
                hits += 1
    return hits


# ------------------------------------------------------------------ DDS (DXT5)

def _dds(b):
    if b[:4] != b"DDS " or b[84:88] != b"DXT5":
        raise ValueError("máscara não é DXT5")
    h, w = struct.unpack_from("<2I", b, 12)
    mips = max(1, struct.unpack_from("<I", b, 28)[0])
    return w, h, mips


def _c565(r, g, b):
    return ((int(r) >> 3) << 11) | ((int(g) >> 2) << 5) | (int(b) >> 3)


def _rgb565(c):
    return ((c >> 11) & 31) * 255 / 31, ((c >> 5) & 63) * 255 / 63, (c & 31) * 255 / 31


def _avg_color(b, w, h, cover, B):
    """cor típica (mediana por canal) dos blocos cobertos pela malha no nível 0 — a cor do chão
    plano e iluminado; a média puxaria para o escuro das sombras antigas"""
    ch = ([], [], [])
    bw = max(1, w // 4)
    for k in cover:
        j, i = divmod(k, B)
        o = 128 + (j * bw + i) * 16 + 8
        c0, c1 = struct.unpack_from("<2H", b, o)
        a, c = _rgb565(c0), _rgb565(c1)
        for q in range(3):
            ch[q].append((a[q] + c[q]) / 2)
    if not ch[0]:
        return None
    med = []
    for q in range(3):
        v = sorted(ch[q])
        med.append(v[len(v) // 2])
    return tuple(med)


def _encode(b, w, h, mips, color, shade, B):
    """Mesma imagem (cabeçalho e mistura/alfa intactos) com a cor de cada bloco = cor × sombra.
    Blocos com sombra None (fora do mapa: a paisagem em volta não muda) ficam como eram."""
    out = bytearray(b)
    o = 128
    level = shade
    lb = B
    for m in range(mips):
        bw, bh = max(1, (w >> m) // 4), max(1, (h >> m) // 4)
        if m and lb > bw:
            # sombra do nível m: média 2×2 do nível anterior (só dos blocos refeitos)
            nl = [None] * (bw * bh)
            for j in range(bh):
                for i in range(bw):
                    vals = []
                    for dj in (0, 1):
                        for di in (0, 1):
                            jj, ii = min(lb - 1, j * 2 + dj), min(lb - 1, i * 2 + di)
                            v = level[jj * lb + ii]
                            if v is not None:
                                vals.append(v)
                    if vals:
                        nl[j * bw + i] = sum(vals) / len(vals)
            level, lb = nl, bw
        for j in range(bh):
            for i in range(bw):
                s = level[min(lb - 1, j) * lb + min(lb - 1, i)]
                if s is not None and o + 16 <= len(out):
                    c = _c565(min(255, color[0] * s), min(255, color[1] * s), min(255, color[2] * s))
                    struct.pack_into("<2HI", out, o + 8, c, c, 0)
                o += 16
        if o > len(out):
            break
    return bytes(out)


# ------------------------------------------------------------------ luz

SUN = (-0.45, 0.78, -0.43)  # direção da luz (x, y, z), normalizada abaixo; o ajuste fino vem do terreno


def _norm(v):
    l = math.sqrt(sum(c * c for c in v)) or 1.0
    return tuple(c / l for c in v)


def shade_fn(height, grid, sun=SUN, lo=0.0, hi=None):
    """luz de um ponto (1 = chão plano iluminado). lo/hi = limites da área (a paisagem em volta
    do mapa entra quando a área é maior que o mapa)"""
    L = _norm(sun)
    flat = L[1]
    hi = grid if hi is None else hi

    def f(x, z):
        x = min(hi - 3, max(lo + 2, x)); z = min(hi - 3, max(lo + 2, z))
        dx = (height(x + 2, z) - height(x - 2, z)) / 4
        dz = (height(x, z + 2) - height(x, z - 2)) / 4
        n = _norm((-dx, 1.0, -dz))
        d = max(0.0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2])
        # sombra projetada suave: quanto o terreno na direção do sol passa acima do raio de luz
        hx, hz = -L[0] / math.hypot(L[0], L[2]), -L[2] / math.hypot(L[0], L[2])
        rise = L[1] / math.hypot(L[0], L[2])
        y0 = height(x, z)
        occ = 0.0
        for step in (4, 8, 14, 22, 32, 46, 64, 90):
            px, pz = x - hx * step, z - hz * step
            if not (lo <= px <= hi and lo <= pz <= hi):
                break
            occ = max(occ, height(px, pz) - (y0 + step * rise))
        t = max(0.0, min(1.0, occ / 10.0))
        sh = 1.0 - 0.38 * t * t * (3 - 2 * t)
        return max(0.35, min(1.35, (0.4 + 0.6 * d / flat) * sh))
    return f


def relight(data, pl, lighting, height, grid, mask_dir_old, mask_dir_new, sun=SUN, log=None):
    """Refaz as máscaras de luz da malha com o relevo novo.
    data      = terrain.win.bdf original (para achar o bloco da malha)
    pl        = payload atual (já com relevo novo e texturas trocadas)
    lighting  = {nome_arquivo: bytes} das máscaras do terreno base (mask02_0.win.dds…)
    height    = função (x, z) -> altura do relevo NOVO
    mask_dir_* = pasta das máscaras no caminho (ex.: '/maps/SC2_MP_007/lighting/' -> '/maps/SC2_NOVO/lighting/')
    Devolve (payload novo, {nome: bytes novos}, n_máscaras)."""
    nfix = struct.unpack_from("<I", data, 0x18)[0]
    maxfix = max(struct.unpack_from(f"<{nfix}I", data, 0x1c))
    blob, nv, ni = mesh(pl, maxfix)
    recs = _records(pl, nv, ni)
    mats = materials(pl)
    by_mask = {}
    for m in mats:
        path = _cstr(pl, m["mask"])
        if path and m["rec"] < len(recs):
            by_mask.setdefault((m["mask"], path), []).append(recs[m["rec"]])
    pl = bytearray(pl)
    sf = shade_fn(height, grid, sun)
    out = {}
    done = 0
    for (ptr, path), rr in by_mask.items():
        stem = path.rsplit("/", 1)[-1][:-4]  # mask02
        files = [f"{stem}_{k}.win.dds" for k in range(3)]
        srcs = [lighting.get(f) for f in files]
        if not all(srcs) or not path.lower().startswith(mask_dir_old.lower()):
            continue
        new_path = mask_dir_new + path[len(mask_dir_old):]
        slot = _slot(pl, ptr)
        if len(new_path.encode("latin1")) >= slot:
            if log:
                log(f"luz: caminho novo não cabe ({new_path})")
            continue
        try:
            w, h, mips = _dds(srcs[0])
        except ValueError:
            continue
        B = max(1, w // 4)
        cover = {}
        for rec in rr:
            _raster(pl, blob, nv, rec, B, grid, cover)
        if not cover:
            continue
        # só o chão do mapa muda; a paisagem em volta (fora do heightfield) e as peças da malha que
        # não acompanham o chão (rochas, paredões) continuam com a luz original
        inside = {k: v for k, v in cover.items() if -2 <= v[0] <= grid + 2 and -2 <= v[1] <= grid + 2
                  and abs(v[2] - height(min(grid, max(0, v[0])), min(grid, max(0, v[1])))) < 4}
        if len(inside) < 16:
            continue
        shade = [None] * (B * B)
        for k, (x, z, _y) in inside.items():
            shade[k] = sf(x, z)
        cover = inside
        made = []
        for f, b in zip(files, srcs):
            try:
                w2, h2, m2 = _dds(b)
            except ValueError:
                made = []
                break
            col = _avg_color(b, w2, h2, cover, B) if (w2, h2) == (w, h) else None
            if col is None:
                made = []
                break
            made.append((f, _encode(b, w2, h2, m2, col, shade, B)))
        if not made:
            continue
        for f, b in made:
            out[f] = b
        nb = new_path.encode("latin1")
        pl[ptr:ptr + slot] = nb + b"\x00" * (slot - len(nb))
        done += 1
        if log:
            log(f"luz refeita: {stem} ({len(cover)} blocos)")
    return bytes(pl), out, done


def fit_sun(data, pl, lighting, height, grid):
    """Direção do sol que melhor explica a luz original do terreno (para a luz nova combinar
    com o céu do mapa). Testa algumas direções e fica com a de maior correlação."""
    nfix = struct.unpack_from("<I", data, 0x18)[0]
    maxfix = max(struct.unpack_from(f"<{nfix}I", data, 0x1c))
    blob, nv, ni = mesh(pl, maxfix)
    recs = _records(pl, nv, ni)
    best = (-2.0, SUN)
    samples = []
    for m in materials(pl):
        path = _cstr(pl, m["mask"])
        if not path or m["rec"] >= len(recs):
            continue
        b = lighting.get(path.rsplit("/", 1)[-1][:-4] + "_0.win.dds")
        if not b:
            continue
        w, _h, _ = _dds(b)
        B = w // 4
        cover = {}
        _raster(pl, blob, nv, recs[m["rec"]], B, grid, cover)
        for k, (x, z, _y) in list(cover.items())[::7]:
            j, i = divmod(k, B)
            c0, c1 = struct.unpack_from("<2H", b, 128 + (j * B + i) * 16 + 8)
            lum = sum(_rgb565(c0)) + sum(_rgb565(c1))
            samples.append((x, z, lum))
    if len(samples) < 50:
        return SUN
    samples = samples[:6000]
    for el in (35, 50, 65):
        for az in range(0, 360, 30):
            e, a = math.radians(el), math.radians(az)
            L = (math.cos(e) * math.cos(a), math.sin(e), math.cos(e) * math.sin(a))
            f = shade_fn(height, grid, L)
            xs = [f(x, z) for x, z, _ in samples]
            ys = [s for _, _, s in samples]
            n = len(xs)
            mx, my = sum(xs) / n, sum(ys) / n
            sxy = sum((p - mx) * (q - my) for p, q in zip(xs, ys))
            sxx = sum((p - mx) ** 2 for p in xs)
            syy = sum((q - my) ** 2 for q in ys)
            r = sxy / math.sqrt(sxx * syy) if sxx and syy else -1
            if r > best[0]:
                best = (r, L)
    return best[1]


def mask_dir(pl, map_id):
    """pasta das máscaras de luz usada nos caminhos do terreno (ex.: '/maps/SC2_MP_007/lighting/')"""
    m = re.search(rb"/maps/" + re.escape(map_id.encode()) + rb"/lighting/", pl, re.I)
    return m.group().decode("latin1") if m else None


def _shade_map(sf, grid, res, ext0=0.0, ext=None):
    """sombra em res×res pontos (centro de cada texel da área [ext0, ext0+ext]), suavizada 3×3"""
    ext = grid if ext is None else ext
    raw = [sf(ext0 + (i + 0.5) / res * ext, ext0 + (j + 0.5) / res * ext) for j in range(res) for i in range(res)]
    out = [0.0] * (res * res)
    for j in range(res):
        for i in range(res):
            acc = n = 0
            for dj in (-1, 0, 1):
                jj = j + dj
                if 0 <= jj < res:
                    for di in (-1, 0, 1):
                        ii = i + di
                        if 0 <= ii < res:
                            w = 2 if (di == 0 and dj == 0) else 1
                            acc += raw[jj * res + ii] * w
                            n += w
            out[j * res + i] = acc / n
    return out


def _sample(S, res, u, v):
    """bilinear em S (res×res) nas coordenadas 0..1"""
    x = min(res - 1.0, max(0.0, u * res - 0.5))
    y = min(res - 1.0, max(0.0, v * res - 0.5))
    x0, y0 = int(x), int(y)
    x1, y1 = min(res - 1, x0 + 1), min(res - 1, y0 + 1)
    fx, fy = x - x0, y - y0
    a = S[y0 * res + x0] * (1 - fx) + S[y0 * res + x1] * fx
    b = S[y1 * res + x0] * (1 - fx) + S[y1 * res + x1] * fx
    return a * (1 - fy) + b * fy


def _blocks(S, res, w, h, mips):
    """Por nível e bloco 4×4: (sombra máx, sombra mín, índices DXT de 32 bits)."""
    levels = []
    for m in range(mips):
        lw, lh = max(1, w >> m), max(1, h >> m)
        bw, bh = max(1, lw // 4), max(1, lh // 4)
        blk = []
        for by in range(bh):
            for bx in range(bw):
                vals = []
                for ty in range(4):
                    for tx in range(4):
                        vals.append(_sample(S, res, (bx * 4 + tx + 0.5) / lw, (by * 4 + ty + 0.5) / lh))
                hi, lo = max(vals), min(vals)
                idx = 0
                if hi - lo > 1e-4:
                    for k, v in enumerate(vals):
                        t = (v - lo) / (hi - lo)
                        code = 0 if t >= 5 / 6 else 2 if t >= 0.5 else 3 if t >= 1 / 6 else 1
                        idx |= code << (2 * k)
                blk.append((hi, lo, idx))
        levels.append(blk)
    return levels


def _alpha_blocks(A, res, w, h, mips):
    """Por nível e bloco 4×4: bytes do bloco de alfa DXT5 (8 valores interpolados)."""
    levels = []
    for m in range(mips):
        lw, lh = max(1, w >> m), max(1, h >> m)
        bw, bh = max(1, lw // 4), max(1, lh // 4)
        blk = []
        for by in range(bh):
            for bx in range(bw):
                vals = [max(0, min(255, int(round(_sample(A, res, (bx * 4 + tx + 0.5) / lw, (by * 4 + ty + 0.5) / lh) * 255))))
                        for ty in range(4) for tx in range(4)]
                a0, a1 = max(vals), min(vals)
                if a0 == a1:
                    blk.append(bytes((a0, a1, 0, 0, 0, 0, 0, 0)))
                    continue
                bits = 0
                span = a0 - a1
                for k, v in enumerate(vals):
                    q = int(round((a0 - v) * 7 / span))  # 0 = a0 … 7 = a1
                    code = 0 if q <= 0 else 1 if q >= 7 else q + 1
                    bits |= code << (3 * k)
                blk.append(bytes((a0, a1)) + bits.to_bytes(6, "little"))
        levels.append(blk)
    return levels


def grid_masks(donor, height, grid, sun=SUN, stem="cpgrid", res=512, ext0=0.0, ext=None, blend=None):
    """Máscaras de luz da malha nova (UV da máscara = posição na área [ext0, ext0+ext]): mesmo
    formato das do terreno original (`donor` = os 3 arquivos maskNN_{0,1,2}). A cor típica de cada
    uma é sombreada pelo relevo novo texel a texel (sombras suaves); o alfa do segundo arquivo é a
    mistura das duas camadas do material (`blend(x, z)` → 0..1, 1 = segunda camada); os outros
    alfas ficam no valor típico do terreno original. Devolve {nome: bytes}."""
    ext = grid if ext is None else ext
    sf = shade_fn(height, grid, sun, lo=ext0, hi=ext0 + ext)
    S = _shade_map(sf, grid, res, ext0, ext)
    A = None
    if blend is not None:
        A = [blend(ext0 + (i + 0.5) / res * ext, ext0 + (j + 0.5) / res * ext) for j in range(res) for i in range(res)]
    out = {}
    levels = None
    for k, b in enumerate(donor):
        w, h, mips = _dds(b)
        cols, alps = ([], [], []), []
        bw0 = max(1, w // 4)
        for i in range(0, bw0 * max(1, h // 4), 7):
            o = 128 + i * 16
            c0, c1 = struct.unpack_from("<2H", b, o + 8)
            a, c = _rgb565(c0), _rgb565(c1)
            if sum(a) + sum(c) < 30:
                continue
            for q in range(3):
                cols[q].append((a[q] + c[q]) / 2)
            alps.append((b[o] + b[o + 1]) // 2)
        if not alps:
            return {}
        color = tuple(sorted(v)[len(v) // 2] for v in cols)
        alpha = sorted(alps)[len(alps) // 2]
        if levels is None:
            levels = _blocks(S, res, w, h, mips)
        ablk = _alpha_blocks(A, res, w, h, mips) if (A is not None and k == 1) else None
        img = bytearray(b)
        o = 128
        for li, blk in enumerate(levels):
            for bi, (hi, lo, idx) in enumerate(blk):
                if o + 16 > len(img):
                    break
                c0 = _c565(*(min(255, color[q] * hi) for q in range(3)))
                c1 = _c565(*(min(255, color[q] * lo) for q in range(3)))
                if c0 < c1:
                    c0, c1 = c1, c0
                    idx = _swap_codes(idx)
                elif c0 == c1:
                    idx = 0
                img[o:o + 8] = ablk[li][bi] if ablk else bytes((alpha, alpha, 0, 0, 0, 0, 0, 0))
                struct.pack_into("<2HI", img, o + 8, c0, c1, idx)
                o += 16
        out[f"{stem}_{k}.win.dds"] = bytes(img)
    return out


def _swap_codes(idx):
    """troca c0↔c1 nos índices DXT (0↔1, 2↔3)"""
    out = 0
    for k in range(16):
        c = (idx >> (2 * k)) & 3
        out |= (c ^ 1) << (2 * k)
    return out
