"""Malha nova do chão (CommandProject) — só biblioteca padrão.

A malha que o jogo desenha (`terrain.win.bdf`) e a de colisão (`collision2.win.bdf`) são feitas
para o relevo ORIGINAL do mapa: triângulos grandes onde o chão era plano, pequenos só onde havia
morros. Mover os vértices (o que o toolkit faz) não cria detalhe onde não havia, então montanhas
novas sumiam no jogo, e a colisão velha ficava abaixo do chão novo (a câmera e os tiros passavam
por baixo do mapa). Aqui as duas são refeitas como uma grade regular que segue o heightfield novo.

Formato (verificado em MP_007/MP_203, ver também FORMATS.md):
* contêiner MFDB: 8 u32 [MFDB, 7, 2, 0, comp, tamanho, n_fixups, n_seções], depois n_fixups
  posições de ponteiros, depois n_seções inícios de seção; o fluxo zlib alinhado a 32. Ponteiros
  valem a partir do início da seção onde estão (a seção 1 do terreno é o bloco da malha).
* terreno: cabeçalho 5 u32 [6, n_reg, 20, n_reg, tabela_de_textos]; um registro de 108 B por
  material (+12 vértices acumulados, +16 índices acumulados, +32 ponteiro da árvore, +96 centro);
  árvores (BVH) de nós de 56 B: caixa float6 (min xyz, max xyz) + [folha, folha, vmin, vmax,
  primeiro índice, n_triângulos, esquerda, direita] (esquerda vem logo depois, em pré-ordem);
  textos e materiais (84 B por registro) e, na seção 1, [3, NV, 20, NI, 20+NV*32] + vértices de
  32 B + índices u32 relativos ao registro.
* vértice: float3 posição; half2 UV da textura; u16x2 UV da máscara de luz (0..32767 = 0..1);
  3 × u32 com xyz de 10 bits com sinal (×51): normal, tangente (dP/du) e −bitangente (dP/dv).
* colisão: [1, NV, 24, NI, ofs_índices, ofs_árvore] + float3 + u32 + um registro de 108 B e a
  árvore no mesmo formato."""
import math
import struct
import zlib

NONE = 0xFFFFFFFF


# ------------------------------------------------------------------ contêiner

def _zlib_at(data, start):
    o = data.find(b"\x78\x9c", start)
    while o != -1:
        try:
            zlib.decompress(data[o:])
            return o
        except zlib.error:
            o = data.find(b"\x78\x9c", o + 1)
    raise ValueError("fluxo zlib não encontrado")


def read_bdf(data):
    """(cabeçalho 8 u32, fixups, seções, payload)"""
    if data[:4] != b"MFDB":
        raise ValueError("não é um arquivo MFDB")
    head = list(struct.unpack_from("<8I", data, 0))
    nfix, nsec = head[6], head[7]
    fix = list(struct.unpack_from(f"<{nfix}I", data, 32))
    sec = list(struct.unpack_from(f"<{nsec}I", data, 32 + 4 * nfix))
    s = _zlib_at(data, 32 + 4 * (nfix + nsec))
    return head, fix, sec, bytearray(zlib.decompress(data[s:]))


def write_bdf(head, fix, sec, payload):
    comp = zlib.compress(bytes(payload), 6)
    h = list(head)
    h[4], h[5], h[6], h[7] = len(comp), len(payload), len(fix), len(sec)
    out = bytearray(struct.pack("<8I", *h))
    out += struct.pack(f"<{len(fix)}I", *fix)
    out += struct.pack(f"<{len(sec)}I", *sec)
    while len(out) % 32:
        out += b"\x00"
    out += comp
    while len(out) % 32:
        out += b"\x00"
    return bytes(out)


# ------------------------------------------------------------------ árvore (BVH)

def build_bvh(pos, tris, leaf=6):
    """Árvore no formato do jogo. pos = [(x, y, z)], tris = [(a, b, c)].
    Devolve (ordem dos vértices [índice antigo], triângulos com índices novos, nós) onde cada nó é
    (caixa6, é_folha, vmin, vmax, primeiro_índice, n_tri, esquerda, direita) com filhos por índice."""
    n = len(tris)
    cen = [((pos[a][0] + pos[b][0] + pos[c][0]) / 3, (pos[a][1] + pos[b][1] + pos[c][1]) / 3,
            (pos[a][2] + pos[b][2] + pos[c][2]) / 3) for a, b, c in tris]
    order = []
    raw = []  # (é_folha, início_tri, n_tri, esquerda, direita)

    def rec(ids):
        k = len(raw)
        raw.append(None)
        start = len(order)
        if len(ids) <= leaf:
            order.extend(ids)
            raw[k] = (True, start, len(ids), -1, -1)
            return k
        mn = [min(cen[i][d] for i in ids) for d in range(3)]
        mx = [max(cen[i][d] for i in ids) for d in range(3)]
        ax = max(range(3), key=lambda d: mx[d] - mn[d])
        ids = sorted(ids, key=lambda i: cen[i][ax])
        h = len(ids) // 2
        left = rec(ids[:h])
        right = rec(ids[h:])
        raw[k] = (False, start, len(ids), left, right)
        return k

    import sys
    old = sys.getrecursionlimit()
    sys.setrecursionlimit(max(old, 10000))
    try:
        if n:
            rec(list(range(n)))
    finally:
        sys.setrecursionlimit(old)
    # vértices na ordem de primeiro uso
    vmap, vorder = {}, []
    new_tris = []
    for t in order:
        tri = []
        for v in tris[t]:
            if v not in vmap:
                vmap[v] = len(vorder)
                vorder.append(v)
            tri.append(vmap[v])
        new_tris.append(tuple(tri))
    nodes = []
    for is_leaf, start, cnt, left, right in raw:
        vs = [v for t in new_tris[start:start + cnt] for v in t]
        ps = [pos[vorder[v]] for v in vs]
        box = (min(p[0] for p in ps), min(p[1] for p in ps), min(p[2] for p in ps),
               max(p[0] for p in ps), max(p[1] for p in ps), max(p[2] for p in ps))
        nodes.append((box, is_leaf, min(vs), max(vs), start * 3, cnt, left, right))
    return vorder, new_tris, nodes


def _pack_nodes(nodes, base):
    """bytes da árvore começando em `base` + posições dos ponteiros (fixups)"""
    out = bytearray()
    fix = []
    for box, is_leaf, vmin, vmax, first, cnt, left, right in nodes:
        p = base + len(out)
        lp = NONE if left < 0 else base + left * 56
        rp = NONE if right < 0 else base + right * 56
        out += struct.pack("<6f8I", *box, int(is_leaf), int(is_leaf), vmin, vmax, first, cnt, lp, rp)
        fix += [p + 48, p + 52]
    return bytes(out), fix


# ------------------------------------------------------------------ vértices

def _pack10(v):
    c = [max(-511, min(511, int(round(x * 51)))) & 1023 for x in v]
    return c[0] | (c[1] << 10) | (c[2] << 20)


def _norm(v):
    l = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) or 1.0
    return (v[0] / l, v[1] / l, v[2] / l)


def _vertex(height, x, z, e, uv_scale, ext0, ext):
    """vértice de 32 B na posição (x, z): normal/tangente pelo relevo, UV da máscara na área toda"""
    y = height(x, z)
    dx = (height(x + e, z) - height(x - e, z)) / (2 * e)
    dz = (height(x, z + e) - height(x, z - e)) / (2 * e)
    nrm = _norm((-dx, 1.0, -dz))
    tan = _norm((1.0, dx, 0.0))
    bit = _norm((0.0, dz, 1.0))
    lu = max(0, min(32767, int(round((x - ext0) / ext * 32767))))
    lv = max(0, min(32767, int(round((z - ext0) / ext * 32767))))
    return (x, y, z), struct.pack("<3f2e2H3I", x, y, z, x * uv_scale, z * uv_scale, lu, lv,
                                  _pack10(nrm), _pack10(tan), _pack10((-bit[0], -bit[1], -bit[2])))


def world_mesh(height, grid, step, uv_scale, margin=0.0, ring_step=16.0):
    """Grade fina no mapa ([0, grid], passo `step`) e, em volta, um anel mais grosso até `margin`
    (passo `ring_step`) costurado na borda sem frestas. A UV da máscara cobre a área toda
    ([-margin, grid + margin]). Devolve (posições, vértices de 32 B, triângulos)."""
    ext0, ext = -margin, grid + 2 * margin
    idx = {}
    pos, verts, tris = [], [], []

    def v(x, z):
        k = (round(x * 4), round(z * 4))
        if k not in idx:
            p, b = _vertex(height, x, z, step, uv_scale, ext0, ext)
            idx[k] = len(pos)
            pos.append(p)
            verts.append(b)
        return idx[k]

    def tri(a, b, c):
        pa, pb, pc = pos[a], pos[b], pos[c]
        e1 = (pb[0] - pa[0], pb[2] - pa[2])
        e2 = (pc[0] - pa[0], pc[2] - pa[2])
        cy = e1[1] * e2[0] - e1[0] * e2[1]  # componente y de (b-a)×(c-a)
        if abs(cy) < 1e-9:
            return
        tris.append((a, b, c) if cy > 0 else (a, c, b))

    n = int(round(grid / step))
    for j in range(n):
        for i in range(n):
            x0, z0, x1, z1 = i * step, j * step, (i + 1) * step, (j + 1) * step
            a, b, c, d = v(x0, z0), v(x1, z0), v(x0, z1), v(x1, z1)
            if (i + j) % 2:
                tri(a, c, b); tri(b, c, d)
            else:
                tri(a, c, d); tri(a, d, b)
    if margin > 0:
        R = ring_step
        m = int(math.ceil(margin / R))
        cells = int(round(grid / R))
        for J in range(-m, cells + m):
            for I in range(-m, cells + m):
                if 0 <= I < cells and 0 <= J < cells:
                    continue  # dentro do mapa: grade fina
                x0, z0, x1, z1 = I * R, J * R, (I + 1) * R, (J + 1) * R
                # lado encostado no mapa: os vértices finos dessa borda entram no polígono
                ring = [(x0, z0)]
                edge = None
                if J == -1 and 0 <= I < cells:
                    edge = "top"      # borda z1 = 0
                elif J == cells and 0 <= I < cells:
                    edge = "bottom"   # borda z0 = grid
                elif I == -1 and 0 <= J < cells:
                    edge = "right"    # borda x1 = 0
                elif I == cells and 0 <= J < cells:
                    edge = "left"     # borda x0 = grid
                k = int(round(R / step))
                if edge is None:
                    a, b, c, d = v(x0, z0), v(x1, z0), v(x0, z1), v(x1, z1)
                    tri(a, c, d); tri(a, d, b)
                    continue
                if edge == "top":
                    fine = [v(x0 + t * step, z1) for t in range(k + 1)]
                    apex = v((x0 + x1) / 2, z0) if False else None
                    a, b = v(x0, z0), v(x1, z0)
                    # leque a partir dos dois cantos de fora
                    for t in range(k):
                        tri(a if t < k / 2 else b, fine[t], fine[t + 1])
                    tri(a, b, fine[k // 2])
                elif edge == "bottom":
                    fine = [v(x0 + t * step, z0) for t in range(k + 1)]
                    a, b = v(x0, z1), v(x1, z1)
                    for t in range(k):
                        tri(a if t < k / 2 else b, fine[t], fine[t + 1])
                    tri(a, b, fine[k // 2])
                elif edge == "right":
                    fine = [v(x1, z0 + t * step) for t in range(k + 1)]
                    a, b = v(x0, z0), v(x0, z1)
                    for t in range(k):
                        tri(a if t < k / 2 else b, fine[t], fine[t + 1])
                    tri(a, b, fine[k // 2])
                else:
                    fine = [v(x0, z0 + t * step) for t in range(k + 1)]
                    a, b = v(x1, z0), v(x1, z1)
                    for t in range(k):
                        tri(a if t < k / 2 else b, fine[t], fine[t + 1])
                    tri(a, b, fine[k // 2])
    return pos, verts, tris


def grid_mesh(height, grid, step, uv_scale):
    """Grade regular só sobre o mapa (compatibilidade)."""
    return world_mesh(height, grid, step, uv_scale, 0.0)


# ------------------------------------------------------------------ terreno

def _cstr(pl, p):
    if p == NONE or p >= len(pl):
        return ""
    e = pl.find(b"\x00", p)
    return pl[p:e].decode("latin1")


def _is_ground_mat(pl, st, r):
    w = struct.unpack_from("<21I", pl, st + r * 84)
    name = _cstr(pl, w[0]).lower()
    d0 = _cstr(pl, w[8]).lower()
    if not d0.startswith("/textures/terrain/") or "/water/" in d0:
        return False
    return not any(k in name + d0 for k in ("cloud", "water", "foam", "wave"))


def _defines(pl, st, r):
    """nomes dos #defines do material (ex.: BLENDING, RNM_LIGHTING)"""
    w = struct.unpack_from("<21I", pl, st + r * 84)
    n, p = w[3], w[4]
    out = set()
    if p == NONE or not 0 < n < 64 or p + 8 * n > len(pl):
        return out
    for k in range(n):
        out.add(_cstr(pl, struct.unpack_from("<I", pl, p + 8 * k)[0]).upper())
    return out


def regrid_terrain(data, height, grid, new_mask_path, step=4.0, log=None):
    """Compatibilidade: grade no mapa com o material de chão original (sem anel nem biomas)."""
    return rebuild_terrain(data, height, grid, step=step, mask_path=new_mask_path, log=log)


def rebuild_terrain(data, height, grid, *, step=4.0, mask_path, margin=0.0, ring_step=16.0,
                    zones=None, zone_t=None, water_y=None, water_mask_path=None, log=None, uv_scale=None):
    """Troca a malha do chão por uma grade regular que segue `height` (com um anel de paisagem em
    volta quando `margin` > 0) e devolve (bytes novos, info).

    zones   = conjuntos de textura em cadeia, um por material: [{"d": (a, b), "n": (a, b), "s": (a, b)}]
              — a camada b de uma zona é a camada a da seguinte (areia→grama, grama→terra, …);
    zone_t  = função (x, z) → posição na cadeia (0..len(zones)): a zona de cada triângulo é int(t);
    water_y = altura nova da lâmina d'água do terreno (e `water_mask_path`, a máscara de água nova).
    Todos os materiais usam a máscara `mask_path` (luz e mistura das camadas)."""
    head, fix, sec, pl = read_bdf(data)
    if len(sec) != 2:
        raise ValueError("terreno sem a seção da malha")
    ver, nrec, d20, nrec2, st = struct.unpack_from("<5I", pl, 0)
    blob = sec[1]
    if d20 != 20 or nrec != nrec2 or not 20 + nrec * 108 <= st < blob:
        raise ValueError("cabeçalho do terreno inesperado")
    a, nv, c20, ni, vofs = struct.unpack_from("<5I", pl, blob)
    if a != 3 or c20 != 20 or vofs != 20 + nv * 32:
        raise ValueError("bloco da malha inesperado")
    vb, ib = blob + 20, blob + 20 + nv * 32
    tail = bytes(pl[ib + ni * 4:])
    vc = [struct.unpack_from("<I", pl, 20 + r * 108 + 12)[0] for r in range(nrec)] + [nv]
    ic = [struct.unpack_from("<I", pl, 20 + r * 108 + 16)[0] for r in range(nrec)] + [ni]
    bvh0 = 20 + nrec * 108
    if min(struct.unpack_from("<I", pl, 20 + r * 108 + 32)[0] for r in range(nrec)) != bvh0:
        raise ValueError("árvores do terreno fora do lugar esperado")

    inside = lambda x, z: 0 <= x <= grid and 0 <= z <= grid
    recs = []
    removed = 0
    for r in range(nrec):
        v0, v1 = vc[r], vc[r + 1]
        P = [struct.unpack_from("<3f", pl, vb + k * 32) for k in range(v0, v1)]
        V = [bytes(pl[vb + k * 32:vb + k * 32 + 32]) for k in range(v0, v1)]
        I = struct.unpack_from(f"<{ic[r + 1] - ic[r]}I", pl, ib + ic[r] * 4)
        T = []
        ground = _is_ground_mat(pl, st, r)
        for t in range(0, len(I) - 2, 3):
            tri = (I[t], I[t + 1], I[t + 2])
            if ground and all(k < len(P) for k in tri):
                cx = sum(P[k][0] for k in tri) / 3
                cz = sum(P[k][2] for k in tri) / 3
                # dentro do mapa sempre sai; fora, sai quando a paisagem em volta é refeita
                if inside(cx, cz) or margin > 0:
                    removed += 1
                    continue
            T.append(tri)
        recs.append([P, V, T, ground, len(I) // 3])
    ground = [r for r in range(nrec) if recs[r][3]]
    if not ground:
        raise ValueError("terreno sem material de chão")
    blend = [r for r in ground if "BLENDING" in _defines(pl, st, r)]
    zones = list(zones or [])
    # materiais que recebem a grade: com mistura de duas camadas quando há zonas
    pool = sorted(blend if zones and blend else ground, key=lambda r: -recs[r][4])
    if zones:
        zones = zones[:len(pool)]
    nz = max(1, len(zones))
    hosts = pool[:nz]
    old_mask = _cstr(pl, struct.unpack_from("<I", pl, st + hosts[0] * 84 + 18 * 4)[0])
    # repetição das texturas: a escolhida pelo editor (pelo tamanho com que cada textura foi feita)
    # ou a do material original
    uv_scale = uv_scale if uv_scale and 0.002 < uv_scale < 0.2 else (_uv_scale(pl, vb, vc[hosts[0]], vc[hosts[0] + 1]) or 0.01)
    gp, gv, gt = world_mesh(height, grid, step, uv_scale, margin, ring_step)
    # triângulos por zona
    parts = [[] for _ in range(nz)]
    for t in gt:
        if nz == 1 or zone_t is None:
            parts[0].append(t)
            continue
        cx = (gp[t[0]][0] + gp[t[1]][0] + gp[t[2]][0]) / 3
        cz = (gp[t[0]][2] + gp[t[1]][2] + gp[t[2]][2]) / 3
        parts[max(0, min(nz - 1, int(zone_t(cx, cz))))].append(t)
    for k, r in enumerate(hosts):
        recs[r] = [gp, gv, parts[k], True, len(parts[k])]
    # lâmina d'água na altura nova
    water_rec = water_ptr_field = None
    for r in range(nrec):
        w = struct.unpack_from("<21I", pl, st + r * 84)
        for f in range(21):
            if "waterdepth" in _cstr(pl, w[f]).lower():
                water_rec, water_ptr_field = r, f
                break
        if water_rec is not None:
            break
    if water_y is not None and water_rec is not None:
        P, V = recs[water_rec][0], recs[water_rec][1]
        recs[water_rec][0] = [(p[0], float(water_y), p[2]) for p in P]
        recs[water_rec][1] = [struct.pack("<3f", b and struct.unpack_from("<f", b, 0)[0], float(water_y),
                                          struct.unpack_from("<f", b, 8)[0]) + b[12:] for b in V]
    # registros vazios: um triângulo degenerado bem abaixo do mapa (o jogo espera algo em cada um)
    for r in range(nrec):
        P, V, T = recs[r][0], recs[r][1], recs[r][2]
        if not T:
            src = V[0] if V else gv[0]
            p = (-64.0, -1000.0, -64.0)
            rec_v = struct.pack("<3f", *p) + src[12:32]
            recs[r][0], recs[r][1], recs[r][2] = [p, p, p], [rec_v] * 3, [(0, 1, 2)]

    # ---- monta o payload novo
    out = bytearray(pl[:bvh0])
    new_fix = []
    vcum = icum = 0
    blocks = []
    max_rec = 0
    for r in range(nrec):
        P, V, T = recs[r][0], recs[r][1], recs[r][2]
        vorder, ntris, nodes = build_bvh(P, T)
        max_rec = max(max_rec, len(vorder))
        base = bvh0 + sum(len(b) for b in blocks)
        nb, nf = _pack_nodes(nodes, base)
        blocks.append(nb)
        new_fix += nf
        d = 20 + r * 108
        struct.pack_into("<2I", out, d + 12, vcum, icum)
        struct.pack_into("<I", out, d + 32, base)
        xs = [P[k][0] for k in vorder]
        ys = [P[k][1] for k in vorder]
        zs = [P[k][2] for k in vorder]
        struct.pack_into("<3f", out, d + 96, (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
        recs[r] = (vorder, ntris, V)
        vcum += len(vorder)
        icum += len(ntris) * 3
    for b in blocks:
        out += b
    while len(out) % 4:
        out += b"\x00"
    new_st = len(out)
    delta = new_st - st
    out += pl[st:blob]
    # textos novos (caminhos): máscara de luz, máscara de água e texturas das zonas
    strings = {}

    def add_str(t):
        if t not in strings:
            while len(out) % 4:
                out.append(0)
            strings[t] = len(out)
            out.extend(t.encode("latin1") + b"\x00")
        return strings[t]
    mask_ptr = add_str(mask_path)
    water_ptr = add_str(water_mask_path) if water_mask_path and water_rec is not None else None
    zone_ptrs = []
    for z in zones:
        zp = {}
        for key, fields in (("d", (8, 9)), ("n", (10, 11)), ("s", (14, 15))):
            pair = z.get(key) or (None, None)
            for f, t in zip(fields, pair):
                if t:
                    zp[f] = add_str(t)
        zone_ptrs.append(zp)
    while len(out) % 32:
        out.append(0)
    new_blob = len(out)
    # ponteiros antigos (cabeçalho, registros, textos e materiais): os que apontam para os textos andam
    for p in fix:
        if p >= blob:
            continue  # os do bloco da malha são refeitos abaixo
        if bvh0 <= p < st:
            continue  # árvores antigas: refeitas
        np_ = p + delta if p >= st else p
        v = struct.unpack_from("<I", pl, p)[0]
        if v != NONE and st <= v < blob:
            struct.pack_into("<I", out, np_, v + delta)
        new_fix.append(np_)
    fixset = set(new_fix)

    def set_ptr(r, field, ptr):
        pos_ = new_st + r * 84 + field * 4
        struct.pack_into("<I", out, pos_, ptr)
        if pos_ not in fixset:
            new_fix.append(pos_)
            fixset.add(pos_)
    for k, r in enumerate(hosts):
        set_ptr(r, 18, mask_ptr)
        if k < len(zone_ptrs):
            for f, ptr in zone_ptrs[k].items():
                set_ptr(r, f, ptr)
    if water_ptr is not None:
        set_ptr(water_rec, water_ptr_field, water_ptr)
    # bloco da malha (seção 1: ponteiros relativos ao início dela)
    NV, NI = vcum, icum
    out += struct.pack("<5I", 3, NV, 20, NI, 20 + NV * 32)
    for vorder, _t, V in recs:
        out += b"".join(V[k] for k in vorder)
    for vorder, ntris, _V in recs:
        out += struct.pack(f"<{len(ntris) * 3}I", *[k for t in ntris for k in t])
    out += tail
    new_fix += [new_blob + 8, new_blob + 16]
    info = dict(hosts=hosts, host=hosts[0], zones=len(zones), old_mask=old_mask, removed=removed, grid_tris=len(gt),
                verts=NV, tris=NI // 3, max_rec=max_rec, uv_scale=uv_scale, water=water_rec is not None and water_y is not None,
                ext0=-margin, ext=grid + 2 * margin)
    if log:
        log(f"malha do chão refeita: {len(gt)} triângulos, {max(1, len(zones))} material(is) de chão"
            f"{' e paisagem em volta' if margin else ''} ({removed} triângulos do mapa original saíram)")
    return write_bdf(head, sorted(new_fix), [0, new_blob], out), info


def _uv_scale(pl, vb, v0, v1):
    """Quantas repetições da textura por unidade no material original (|gradiente| de u)."""
    import random
    ks = list(range(v0, v1))
    if len(ks) < 8:
        return None
    random.seed(1)
    pts = [struct.unpack_from("<3f2e", pl, vb + k * 32) for k in random.sample(ks, min(400, len(ks)))]
    # mínimos quadrados de u = a*x + b*z + c
    sxx = sxz = szz = sx = sz = n = sxu = szu = su = 0.0
    for x, _y, z, u, _v in pts:
        if not (math.isfinite(u) and abs(x) < 1e5 and abs(z) < 1e5):
            continue
        n += 1; sx += x; sz += z; sxx += x * x; szz += z * z; sxz += x * z; sxu += x * u; szu += z * u; su += u
    if n < 8:
        return None
    # resolve o sistema 3×3
    m = [[sxx, sxz, sx], [sxz, szz, sz], [sx, sz, n]]
    rhs = [sxu, szu, su]
    try:
        a, b, _c = _solve3(m, rhs)
    except ZeroDivisionError:
        return None
    g = math.hypot(a, b)
    return g if 0.001 < g < 0.2 else None


def _solve3(m, r):
    def det(a):
        return (a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
                + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]))
    d = det(m)
    if abs(d) < 1e-12:
        raise ZeroDivisionError
    out = []
    for c in range(3):
        mm = [row[:] for row in m]
        for i in range(3):
            mm[i][c] = r[i]
        out.append(det(mm) / d)
    return out


# ------------------------------------------------------------------ colisão

def regrid_collision(data, height, grid, step=8.0):
    """Colisão nova: grade sobre o mapa, um pouco ABAIXO do chão (o menor valor em volta de cada
    ponto — nunca vira parede invisível); fora do mapa, a original."""
    head, fix, sec, pl = read_bdf(data)
    ver, nv, vo, ni, io_, eo = struct.unpack_from("<6I", pl, 0)
    if vo != 24 or io_ != vo + nv * 12 or eo != io_ + ni * 4:
        raise ValueError("colisão com formato inesperado")
    P = [struct.unpack_from("<3f", pl, vo + k * 12) for k in range(nv)]
    I = struct.unpack_from(f"<{ni}I", pl, io_)
    keep = []
    for t in range(0, ni - 2, 3):
        a, b, c = I[t], I[t + 1], I[t + 2]
        cx, cz = (P[a][0] + P[b][0] + P[c][0]) / 3, (P[a][2] + P[b][2] + P[c][2]) / 3
        if not (0 <= cx <= grid and 0 <= cz <= grid):
            keep.append((a, b, c))
    pos = list(P)
    n = int(grid // step)
    base = len(pos)
    half = step / 2
    for j in range(n + 1):
        for i in range(n + 1):
            x, z = i * step, j * step
            lo = min(height(min(grid, max(0, x + dx)), min(grid, max(0, z + dz)))
                     for dx in (-half, 0, half) for dz in (-half, 0, half))
            pos.append((x, lo - 0.3, z))
    w = n + 1
    for j in range(n):
        for i in range(n):
            a, b, c, d = base + j * w + i, base + j * w + i + 1, base + (j + 1) * w + i, base + (j + 1) * w + i + 1
            keep += [(a, c, d), (a, d, b)]
    vorder, tris, nodes = build_bvh(pos, keep)
    NV, NI = len(vorder), len(tris) * 3
    out = bytearray(struct.pack("<6I", ver, NV, 24, NI, 24 + NV * 12, 24 + NV * 12 + NI * 4))
    out += b"".join(struct.pack("<3f", *pos[k]) for k in vorder)
    out += struct.pack(f"<{NI}I", *[k for t in tris for k in t])
    d = len(out)
    rec = bytearray(pl[eo:eo + 108])
    out += rec
    nb, nf = _pack_nodes(nodes, d + 108)
    out += nb
    struct.pack_into("<2I", out, d + 12, 0, 0)
    struct.pack_into("<I", out, d + 32, d + 108)
    xs = [pos[k][0] for k in vorder]; ys = [pos[k][1] for k in vorder]; zs = [pos[k][2] for k in vorder]
    struct.pack_into("<3f", out, d + 96, (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
    # ponteiros: cabeçalho e os do registro (mesmas posições relativas), mais os da árvore nova
    new_fix = []
    for p in fix:
        if p < 24:
            new_fix.append(p)
        elif eo <= p < eo + 108:
            q = d + (p - eo)
            v = struct.unpack_from("<I", pl, p)[0]
            if p - eo != 32 and v != NONE:
                raise ValueError("colisão com ponteiro desconhecido no registro")
            new_fix.append(q)
    new_fix += nf
    return write_bdf(head, sorted(new_fix), [0] * len(sec), out)


def mesh_height(height, step):
    """Altura na superfície da malha nova (a mesma triangulação de `world_mesh`): decorações
    assentam exatamente no chão que aparece, mesmo onde a malha é mais grossa que o relevo."""
    def h(x, z):
        i, j = int(x // step), int(z // step)
        x0, z0 = i * step, j * step
        u, w = (x - x0) / step, (z - z0) / step
        ya, yb = height(x0, z0), height(x0 + step, z0)
        yc, yd = height(x0, z0 + step), height(x0 + step, z0 + step)
        if (i + j) % 2:
            # diagonal b–c
            if u + w < 1:
                return ya + (yb - ya) * u + (yc - ya) * w
            return yd + (yc - yd) * (1 - u) + (yb - yd) * (1 - w)
        # diagonal a–d
        if w > u:
            return ya + (yd - yc) * u + (yc - ya) * w
        return ya + (yb - ya) * u + (yd - yb) * w
    return h
