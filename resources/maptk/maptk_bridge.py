"""
maptk_bridge — ponte entre o CommandProject e o SC2 Map Toolkit.

Uso:  python maptk_bridge.py <comando>   (entrada JSON pelo stdin)

Cada evento sai no stdout como uma linha `@@{json}`:
  {"type": "progress", "message": "..."}
  {"type": "result", "data": {...}}
  {"type": "error", "message": "...", "detail": "traceback"}

Variáveis de ambiente (definidas pelo launcher):
  SC2_GAMEDATA  pasta gamedata do jogo
  SC2_MAP_OUT   pasta onde os .scd e prévias são gravados

O toolkit (sc2maps.py / make_map.py) é de plutonics72, licença MIT — veja LICENSE.
Este arquivo é do CommandProject (MIT).
"""

import io
import json
import math
import os
import re
import sys
import traceback
import zipfile

REAL_STDOUT = sys.__stdout__

# O Python embutido do Windows (com arquivo ._pth) não põe a pasta do script no sys.path.
HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def emit(kind, **payload):
    payload["type"] = kind
    REAL_STDOUT.write("@@" + json.dumps(payload, ensure_ascii=False) + "\n")
    REAL_STDOUT.flush()


class LineCapture(io.TextIOBase):
    """Transforma os print() do toolkit em eventos de progresso."""

    def __init__(self):
        self._buf = ""

    def write(self, s):
        self._buf += s
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            if line.strip():
                emit("progress", message=line.strip())
        return len(s)

    def flush(self):
        if self._buf.strip():
            emit("progress", message=self._buf.strip())
        self._buf = ""


OUT = os.environ.get("SC2_MAP_OUT") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "_out")
os.makedirs(OUT, exist_ok=True)

ID_RE = re.compile(r"^SC2_[A-Z0-9_]{2,24}$")


def _toolkit():
    import sc2maps as sm  # noqa: WPS433 — import tardio: depende de SC2_GAMEDATA
    return sm


def _jsonable(v):
    if isinstance(v, dict):
        return {str(k): _jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_jsonable(x) for x in v]
    return v


# ---------------------------------------------------------------------------
# comandos
# ---------------------------------------------------------------------------

def cmd_ping(_inp):
    sm = _toolkit()
    return dict(
        python=sys.version.split()[0],
        gamedata=sm.GAMEDATA,
        gamedataOk=os.path.isdir(sm.GAMEDATA),
        mapsScd=os.path.isfile(sm.MAPS_SCD),
        dlcScd=os.path.isfile(sm.DLC_SCD),
        uncompiledScd=os.path.isfile(sm.UNCOMPILED_SCD),
    )


def cmd_catalog(_inp):
    sm = _toolkit()
    found = {}
    for scd in (sm.MAPS_SCD, sm.DLC_SCD):
        if not os.path.isfile(scd):
            continue
        with zipfile.ZipFile(scd) as zf:
            for n in zf.namelist():
                m = re.search(r"([A-Za-z0-9_]+)\.hfield\.win\.bdf$", n.replace("\\", "/"))
                if m:
                    found.setdefault(m.group(1), os.path.basename(scd))
    terrains = []
    for tid in sorted(found):
        meta = dict(sm.TERRAINS.get(tid, {}))
        kind = ("skirmish" if "_MP_" in tid else "campaign" if "_CA_" in tid else "other")
        terrains.append(dict(
            id=tid,
            archive=found[tid],
            kind=kind,
            name=meta.get("name"),
            biome=meta.get("biome"),
            waterY=meta.get("water_y"),
            openness=meta.get("openness"),
            navmesh=meta.get("navmesh") or ("full" if kind == "skirmish" else None),
            players=meta.get("players"),
            notes=meta.get("notes"),
        ))
    return dict(terrains=terrains)


def cmd_preview(inp):
    """Renderiza o terreno: relevo sombreado + água + áreas onde unidades terrestres NÃO andam."""
    sm = _toolkit()
    tid = inp["terrain"]
    size = int(inp.get("size", 512))
    emit("progress", message=f"Carregando {tid}…")
    t = sm.Terrain(tid)
    landL = t.land_layer()
    oA = t.layers[landL][2]
    grid = t.grid
    step = max(1, grid // size)
    W = grid // step
    hw = t.HW
    H = t.H
    lo, hi = min(H), max(H)
    span = max(1, hi - lo)
    wl = sm._water_level(t)
    emit("progress", message="Renderizando prévia…")
    rows = []
    nav = 0
    total = 0
    for pz in range(W):
        z = pz * step
        row = bytearray()
        for px in range(W):
            x = px * step
            i = z * hw + x
            h = H[i]
            # sombreamento simples (luz vindo do noroeste)
            hx = H[i + 1] if x + 1 < hw else h
            hz = H[i + hw] if z + 1 < hw else h
            shade = max(-1.0, min(1.0, ((h - hx) + (h - hz)) / 256.0))
            base = (h - lo) / span
            v = 70 + base * 140 + shade * 45
            r = g = b = v
            dry = t.dry(x, z)
            blocked = t.costs_payload[oA + z * grid + x] == 255
            total += 1
            if not dry:
                r, g, b = 40 + v * 0.15, 90 + v * 0.25, 150 + v * 0.35
            elif blocked:
                r, g, b = v * 0.75 + 55, v * 0.45, v * 0.45
            else:
                nav += 1
                r, g, b = v * 0.85, v * 0.95 + 8, v * 0.8
            row += bytes((max(0, min(255, int(r))), max(0, min(255, int(g))), max(0, min(255, int(b)))))
        rows.append(bytes(row))
    pdir = os.path.join(OUT, "previews")
    os.makedirs(pdir, exist_ok=True)
    path = os.path.join(pdir, f"{tid}_{W}.png")
    sm.write_png(path, W, W, rows)
    return dict(
        path=path,
        terrain=tid,
        grid=grid,
        size=W,
        nLayers=t.n_layers,
        landLayer=landL,
        waterLevel=wl,
        navigablePct=round(100.0 * nav / max(1, total), 1),
        meta=_jsonable(sm.TERRAINS.get(tid, {})),
    )


def cmd_terrain3d(inp):
    """Relevo amostrado (para o editor 3D) + nível da água + minimapa original do terreno (textura)."""
    import array
    import base64
    sm = _toolkit()
    tid = inp["terrain"]
    size = max(32, min(512, int(inp.get("size", 256))))
    emit("progress", message=f"Carregando relevo de {tid}…")
    t = sm.Terrain(tid)
    hw = t.HW
    step = (hw - 1) / size
    out = array.array("H")
    for j in range(size + 1):
        z = min(hw - 1, round(j * step))
        row = z * hw
        for i in range(size + 1):
            out.append(t.H[row + min(hw - 1, round(i * step))])
    if sys.byteorder != "little":
        out.byteswap()
    mm = t.raw.get("minimap.win.dds")
    # decorações que o terreno já tem (para aparecerem no editor 3D)
    props, kinds = [], []
    if t.raw.get("mapobjs.win.bdf"):
        try:
            import cp_mapobjs
            index = {}
            for x, y, z, yaw, scale, bp in cp_mapobjs.props(t.raw["mapobjs.win.bdf"]):
                if y < -50 or not bp:
                    continue
                if bp not in index:
                    index[bp] = len(kinds)
                    kinds.append(bp)
                props.append([round(x, 1), round(z, 1), round(y, 1), round(yaw), round(scale, 2), index[bp]])
        except Exception as e:  # noqa: BLE001 — sem decorações no editor não impede o resto
            emit("progress", message=f"decorações não lidas: {e}")
    return dict(
        props=props[:20000],
        propKinds=kinds,
        terrain=tid,
        grid=t.grid,
        size=size,
        heights=base64.b64encode(out.tobytes()).decode("ascii"),
        heightScale=1 / 128.0,
        yMin=min(t.H) / 128.0,
        yMax=max(t.H) / 128.0,
        waterLevel=sm._water_level(t),
        minimapDds=base64.b64encode(mm).decode("ascii") if mm else None,
    )


def cmd_examples(_inp):
    import make_map
    out = []
    for key, spec in make_map.SPECS.items():
        s = _jsonable(spec)
        out.append(dict(key=key, spec=s))
    return dict(examples=out)


# maior lado de mapa aceito (81 km no jogo; o Supreme Commander 2 original vai até 2048)
MAX_GRID = 4096


def _resize_terrain(sm, t, n, flat=None):
    """Redimensiona o terreno base para n×n: heightfield (n+1)², navegação n² por camada (vizinho
    mais próximo; o modo PATCH refaz a navegação depois) e o tamanho no info.win.bdf. Com `flat`, o
    heightfield novo já sai liso nessa altura (o mapa em branco), sem interpolar o antigo."""
    import array
    import struct
    g = t.grid
    if n == g:
        return
    w = n + 1
    hb = t.raw["hfield.win.bdf"]
    hp = sm.read_bdf_payload(hb)
    ver, hw, hh, _, off = struct.unpack_from("<5I", hp, 0)
    if flat is not None:
        v = max(0, min(65535, int(round(flat * 128))))
        data = struct.pack("<H", v) * (w * w)
    else:
        src = sm.u16_array(hp, off, hw * hh)
        k = (hw - 1) / n
        cols = []
        for x in range(w):
            fx = x * k
            i = min(hw - 2, int(fx))
            cols.append((i, fx - i))
        out = array.array("H", bytes(2 * w * w))
        for z in range(w):
            fz = z * k
            j = min(hh - 2, int(fz))
            v = fz - j
            r0, r1, base = j * hw, (j + 1) * hw, z * w
            for x, (i, u) in enumerate(cols):
                a0 = src[r0 + i] + (src[r0 + i + 1] - src[r0 + i]) * u
                a1 = src[r1 + i] + (src[r1 + i + 1] - src[r1 + i]) * u
                out[base + x] = int(a0 + (a1 - a0) * v + 0.5)
        if sys.byteorder != "little":
            out.byteswap()
        data = out.tobytes()
    # depois das alturas vem uma grade de 1 byte por célula ((w-1)², alinhada a 4; zerada em todos
    # os mapas do jogo): conta e posição dela ficam no cabeçalho (bytes 20 e 24, com fixup)
    cnt2, off2 = struct.unpack_from("<2I", hp, 20)
    old2 = bytes(hp[off2:off2 + cnt2]) if off2 and cnt2 == (hw - 1) * (hh - 1) else b""
    noff2 = (off + 2 * w * w + 3) // 4 * 4
    grid2 = b"\0" * (n * n) if not old2 or not any(old2) else bytes(
        old2[min(g - 1, z * g // n) * g + min(g - 1, x * g // n)] for z in range(n) for x in range(n))
    head = struct.pack("<7I", ver, w, w, w * w, off, n * n, noff2) + bytes(hp[28:off])
    new_hp = head + data + b"\0" * (noff2 - off - 2 * w * w) + grid2
    t.raw["hfield.win.bdf"] = sm.rebuild_bdf(hb, new_hp)
    t.HW = t.HH = w
    t.H = sm.u16_array(new_hp, off, w * w)
    # navegação: mesmas camadas, grades no tamanho novo (o espaço das caixas das ilhas fica igual)
    cp = t.costs_payload
    _, nl, toff = struct.unpack_from("<3I", cp, 0)
    xs = [min(g - 1, x * g // n) for x in range(n)]
    pos = toff + 28 * nl
    recs, chunks = [], []
    for (lid, _ca, oa, _cb, ob, cs, os_) in t.layers:
        grids = []
        for src_off in (oa, ob):
            rows = []
            last_z, last_row = -1, b""
            for z in range(n):
                sz = min(g - 1, z * g // n)
                if sz != last_z:
                    srow = cp[src_off + sz * g: src_off + (sz + 1) * g]
                    last_row = bytes(map(srow.__getitem__, xs))
                    last_z = sz
                rows.append(last_row)
            grids.append(b"".join(rows))
        boxes = bytearray(cp[os_: os_ + 4 * cs]) if os_ != 0xFFFFFFFF else bytearray()
        for b in range(0, len(boxes) - 15, 16):
            vals = struct.unpack_from("<4I", boxes, b)
            struct.pack_into("<4I", boxes, b, *(min(n - 1, v * n // g) for v in vals))
        na, nb = pos, pos + n * n
        ns = nb + n * n if boxes else 0xFFFFFFFF
        recs.append((lid, n * n, na, n * n, nb, cs, ns))
        chunks += [grids[0], grids[1], bytes(boxes)]
        pos = nb + n * n + len(boxes)
    last = max(r[6] + 4 * r[5] if r[6] != 0xFFFFFFFF else r[4] + r[3] for r in t.layers)
    head = bytearray(cp[:toff])
    table = b"".join(struct.pack("<7I", *r) for r in recs)
    new_cp = bytes(head) + table + bytes(cp[toff + 28 * nl: t.layers[0][2]]) + b"".join(chunks) + bytes(cp[last:])
    t.raw["costs.win.bdf"] = sm.rebuild_bdf(t.raw["costs.win.bdf"], new_cp)
    t.costs_payload = bytearray(new_cp)
    t.layers = recs
    t.grid = n
    sm.GRID = n
    # o info.win.bdf guarda o tamanho do mapa (2048 nos mapas de 40 km do jogo)
    if t.raw.get("info.win.bdf"):
        ipl = bytearray(sm.read_bdf_payload(t.raw["info.win.bdf"]))
        if len(ipl) >= 212 and struct.unpack_from("<2f", ipl, 204) == (float(max(g, 1024)), float(max(g, 1024))):
            struct.pack_into("<2f", ipl, 204, float(max(n, 1024)), float(max(n, 1024)))
            t.raw["info.win.bdf"] = sm.rebuild_bdf(t.raw["info.win.bdf"], bytes(ipl))
    # nada do terreno antigo fica: decorações e decalques estavam nas posições do tamanho antigo
    t._wd = None
    emit("progress", message=f"terreno base redimensionado: {g} → {n} ({n * n // 1_000_000 or round(n * n / 1e6, 1)} milhões de células)")


def _clean_spec(spec):
    spec = dict(spec)
    for k in ("terrain", "scenario_id", "name", "anchors"):
        if k not in spec:
            raise ValueError(f"campo obrigatório ausente: {k}")
    sid = str(spec["scenario_id"]).upper()
    if not ID_RE.match(sid):
        raise ValueError("o id do mapa deve ser como SC2_MEUMAPA (letras maiúsculas, números e _)")
    spec["scenario_id"] = sid
    name = str(spec["name"]).replace("'", "").replace("\\", "").strip()
    if not name:
        raise ValueError("dê um nome ao mapa")
    spec["name"] = name[:60]
    spec["anchors"] = {int(k): (float(v[0]), float(v[1])) for k, v in spec["anchors"].items()}
    # o lobby do jogo mostra até 8; com mais, o mapa joga pela Partida grande do launcher
    if not 1 <= len(spec["anchors"]) <= 64:
        raise ValueError("o mapa precisa de 1 a 64 posições iniciais")
    slug = re.sub(r"[^a-z0-9]+", "_", sid.lower().replace("sc2_", "")).strip("_") or "mapa"
    spec["out"] = f"_cp_{slug}.scd"
    if spec.get("teams"):
        spec["teams"] = [[int(a) for a in team] for team in spec["teams"]]
    patch = spec.get("patch")
    if patch:
        patch = dict(patch)
        if "seed" in patch:
            patch["seed"] = tuple(patch["seed"])
        patch["causeways"] = [tuple(int(v) for v in c) for c in patch.get("causeways", [])]
        spec["patch"] = patch
    for key in ("sculpt", "flatten"):
        if spec.get(key):
            spec[key] = [tuple(op) for op in spec[key]]
    # coordenadas e raios são células inteiras do heightfield; alturas podem ser fracionárias
    n_int = dict(disc=3, cone=3, rect=4, ramp=4)
    clean = []
    for op in spec.get("sculpt") or []:
        if op[0] not in n_int or op[-1] not in ("set", "raise", "lower"):
            raise ValueError(f"operação de relevo inválida: {op}")
        k = n_int[op[0]]
        clean.append((op[0], *(int(round(float(v))) for v in op[1:1 + k]),
                      *(float(v) for v in op[1 + k:-1]), op[-1]))
    if clean:
        spec["sculpt"] = clean
    flat = []
    for op in spec.get("flatten") or []:
        if op[0] not in ("disc", "rect"):
            raise ValueError(f"região de aplainar inválida: {op}")
        flat.append((op[0], *(int(round(float(v))) for v in op[1:])))
    if flat:
        spec["flatten"] = flat
    if len(clean) + len(flat) > 400:
        raise ValueError("no máximo 400 edições de relevo")
    # borda rochosa: true/{} do launcher viram os parâmetros padrão (dict vazio seria "desligado" no make_map)
    rugged = spec.get("rugged_edges")
    if rugged is True or isinstance(rugged, dict):
        spec["rugged_edges"] = dict(dict(margin=40), **(rugged if isinstance(rugged, dict) else {}))
    else:
        spec.pop("rugged_edges", None)
    spec["extra_mass"] = [(float(p[0]), float(p[1])) for p in spec.get("extra_mass") or []]
    if len(spec["extra_mass"]) > 200:
        raise ValueError("no máximo 200 pontos de massa manuais")
    # relevo esculpido muda onde as unidades andam: a navegação precisa ser refeita (modo PATCH)
    edits_terrain = bool(spec.get("sculpt") or spec.get("flatten") or spec.get("rugged_edges") or spec.get("height_delta"))
    if edits_terrain and not spec.get("patch"):
        first = next(iter(spec["anchors"].values()))
        spec["patch"] = dict(max_slope=6.0, water_margin=4.0, seed=first, causeways=[])
    # decorações e texturas: precisam enviar os arquivos do terreno junto (sem refazer a navegação)
    adds = []
    for p in spec.get("props_add") or []:
        bp = str(p[0])
        if not re.match(r"^/props/[\w/.-]+_prop\.bp$", bp, re.I):
            raise ValueError(f"decoração inválida: {bp}")
        x, z = float(p[1]), float(p[2])
        yaw = float(p[3]) if len(p) > 3 else 0.0
        sc = max(0.2, min(5.0, float(p[4]) if len(p) > 4 else 1.0))
        adds.append((bp, x, z, yaw, sc))
    if len(adds) > 5000:
        raise ValueError("no máximo 5000 decorações novas")
    spec["props_add"] = adds
    spec["props_remove"] = [(float(a), float(b), max(1.0, min(300.0, float(r)))) for a, b, r in spec.get("props_remove") or []]
    reskin = {}
    for old_p, new_p in (spec.get("reskin") or {}).items():
        for v in (old_p, new_p):
            if not re.match(r"^/textures/terrain/[\w/.-]+\.dds$", v, re.I):
                raise ValueError(f"textura inválida: {v}")
        reskin[old_p] = new_p
    spec["reskin"] = reskin
    if (adds or spec["props_remove"] or reskin) and not spec.get("patch"):
        spec["ship_terrain"] = True
    if spec.get("playable_area"):
        spec["playable_area"] = tuple(int(v) for v in spec["playable_area"])
    # camada de relevo do gerador/pincel: grade (size+1)² de deltas int16 (× scale = unidades do mundo)
    hd = spec.get("height_delta")
    if hd:
        import base64
        size = int(hd["size"])
        scale = float(hd.get("scale", 1 / 32))
        data = base64.b64decode(hd["data"])
        if not 16 <= size <= 1024 or len(data) != (size + 1) ** 2 * 2 or not 0 < scale <= 1:
            raise ValueError("camada de relevo inválida")
        spec["height_delta"] = dict(size=size, scale=scale, data=data)
        if not spec.get("patch"):
            first = next(iter(spec["anchors"].values()))
            spec["patch"] = dict(max_slope=6.0, water_margin=4.0, seed=first, causeways=[])
    else:
        spec.pop("height_delta", None)
    # água nova (lagos/rios): reescreve a máscara de água; o caminho dela dentro do terreno só
    # pode ser trocado por um id do MESMO tamanho do terreno base
    if spec.get("water_rewrite"):
        if len(spec["scenario_id"]) != len(str(spec["terrain"])):
            spec["water_rewrite"] = False
            spec.setdefault("_notes", []).append("o id do mapa precisa ter o mesmo tamanho do id do terreno para a água nova aparecer")
    # base lisa (mapa em branco): o heightfield inteiro vira um plano nessa altura antes das camadas
    if spec.get("flat_base") is not None:
        fb = float(spec["flat_base"])
        if not 0 <= fb <= 500:
            raise ValueError("altura da base lisa inválida")
        spec["flat_base"] = fb
    else:
        spec.pop("flat_base", None)
    # visual limpo: chão inteiro com o mesmo conjunto de texturas, luz refeita para o relevo novo e
    # nenhuma decoração do terreno original (nada do mapa base aparece por cima do mapa novo)
    clean = spec.get("clean")
    if clean:
        grounds = clean.get("ground") or []
        if isinstance(grounds, dict):
            grounds = [grounds]
        ok = []
        for g in grounds[:12]:
            for k in ("d", "n", "s"):
                v = g.get(k)
                if v and not re.match(r"^/textures/terrain/[\w/.-]+\.dds$", v, re.I):
                    raise ValueError(f"textura inválida: {v}")
            if g.get("d"):
                ok.append({k: g.get(k) for k in ("d", "n", "s") if g.get(k)})
        ground = ok or None
        chain = []
        for g in (clean.get("chain") or [])[:5]:
            for k in ("d", "n", "s"):
                v = g.get(k)
                if v and not re.match(r"^/textures/terrain/[\w/.-]+\.dds$", v, re.I):
                    raise ValueError(f"textura inválida: {v}")
            if g.get("d"):
                chain.append({k: g.get(k) for k in ("d", "n", "s") if g.get(k)})
        paint = None
        pt = clean.get("paint")
        if pt:
            import base64
            n = int(pt["size"])
            raw = base64.b64decode(pt["data"])
            if not 16 <= n <= 1024 or len(raw) != (n + 1) ** 2 * 2:
                raise ValueError("camada do pincel de textura inválida")
            m = (n + 1) ** 2
            paint = (n, raw[:m], raw[m:])
        # tabuleiro das pontes: textura própria (metal, piso) nos segmentos das pontes
        deck = None
        dk = clean.get("deck")
        if dk and dk.get("d"):
            for k in ("d", "n", "s"):
                v = dk.get(k)
                if v and not re.match(r"^/textures/terrain/[\w/.-]+\.dds$", v, re.I):
                    raise ValueError(f"textura inválida: {v}")
            segs = [tuple(float(v) for v in sg[:5]) for sg in (dk.get("segs") or [])[:400] if len(sg) >= 5]
            if segs:
                deck = dict(tex={k: dk.get(k) for k in ("d", "n", "s") if dk.get(k)}, segs=segs)
        spec["clean"] = dict(paint=paint, deck=deck, ground=ground, chain=chain if len(chain) >= 2 else None, relight=bool(clean.get("relight", True)),
                             clear_props=bool(clean.get("clear_props", True)), ring=bool(clean.get("ring", True)), peaks=bool(clean.get("peaks", True)),
                             uv_tile=max(0.003, min(0.15, float(clean["uv_tile"]))) if clean.get("uv_tile") else None,
                             ring_rise=max(0.0, min(250.0, float(clean.get("ring_rise", 95)))))
    else:
        spec.pop("clean", None)
    # água do mapa em branco: nível novo (a lâmina d'água do terreno base sobe até ele)
    if spec.get("water_level") is not None:
        wl = float(spec["water_level"])
        if not 1 <= wl <= 400:
            raise ValueError("nível da água inválido")
        spec["water_level"] = wl
    else:
        spec.pop("water_level", None)
    # visual limpo: a malha nova aponta para a máscara de água do mapa novo (qualquer tamanho de id)
    if spec.get("clean") and spec["clean"]["relight"]:
        spec["water_rewrite"] = True
        spec["_notes"] = [n for n in spec.get("_notes", []) if "tamanho do id" not in n]
    if (spec.get("clean") or spec.get("flat_base") is not None) and not spec.get("patch"):
        first = next(iter(spec["anchors"].values()))
        spec["patch"] = dict(max_slope=6.0, water_margin=4.0, seed=first, causeways=[])
    # passagem das tropas pintada no editor (papel 1 = bloqueado, 2 = liberado)
    nv = spec.get("nav")
    if nv:
        import base64
        n = int(nv["size"])
        raw = base64.b64decode(nv["data"])
        if not 16 <= n <= 1024 or len(raw) != (n + 1) ** 2 * 2:
            raise ValueError("mapa de passagem inválido")
        m = (n + 1) ** 2
        spec["nav"] = (n, raw[:m], raw[m:])
        if not spec.get("patch"):
            first = next(iter(spec["anchors"].values()))
            spec["patch"] = dict(max_slope=6.0, water_margin=4.0, seed=first, causeways=[])
    else:
        spec.pop("nav", None)
    # céu de outro mapa do jogo (caixa do céu, reflexo e correção de cor)
    sky = spec.get("sky")
    if sky:
        clean_sky = {}
        for k in ("env", "sky", "sight", "fog"):
            v = str(sky.get(k) or "")
            if v and not re.match(r"^/textures/[\w/.-]+\.dds$", v, re.I):
                raise ValueError(f"céu inválido: {v}")
            clean_sky[k] = v
        if not clean_sky["sky"]:
            raise ValueError("céu sem textura")
        spec["sky"] = clean_sky
    else:
        spec.pop("sky", None)
    if spec.get("minimap") not in (None, "donor", "desert", "snow", "dark", "natural"):
        raise ValueError("minimapa inválido")
    # mapa gigante: o terreno base é redimensionado para este tamanho (lado em unidades do mundo).
    # Só com base lisa e visual limpo: a malha, a luz, a colisão e a água são todas refeitas e as
    # decorações do terreno base saem (estavam no tamanho antigo).
    if spec.get("grid"):
        g = int(spec["grid"])
        if not 512 <= g <= MAX_GRID or g % 512:
            raise ValueError(f"tamanho de mapa inválido: {g} (de 512 a {MAX_GRID}, de 512 em 512)")
        if spec.get("flat_base") is None or not spec.get("clean") or not spec["clean"]["relight"]:
            raise ValueError("mapas de tamanho personalizado precisam de base em branco e visual limpo")
        spec["clean"]["clear_props"] = True
        spec["grid"] = g
    else:
        spec.pop("grid", None)
    return spec


def _hooks(sm, spec, state):
    """Extensões do CommandProject sobre o toolkit, sem alterar os arquivos dele:
    * malha visual acompanha o relevo esculpido (em mapas de campanha a superfície é uma malha pronta);
    * pontos de massa colocados à mão entram nos marcadores, no chão plano e seco mais próximo."""
    orig_init, orig_set, orig_save = sm.Terrain.__init__, sm.Terrain.set_hfield, sm.make_save
    orig_mask = sm.dry_gentle_mask

    def dry_gentle_mask(terrain, *a, **k):
        """navegação: a regra do toolkit (seco e não íngreme) com o que foi pintado por cima"""
        m = orig_mask(terrain, *a, **k)
        nav = spec.get("nav")
        if not nav:
            return m
        n, roles, power = nav
        G = sm.GRID
        scale = terrain.grid / G
        wl = spec.get("water_level")
        wl = wl if wl is not None else sm._water_level(terrain)
        dry_raw = int((wl + 0.5) * 128)
        blocked = allowed = 0
        # célula da pintura de cada linha/coluna (mesma conta de antes) e, por coluna da pintura, o
        # trecho de colunas do mapa que ela cobre: só as partes pintadas são percorridas
        idx = [min(n, round(v * scale / terrain.grid * n)) for v in range(G)]
        spans = {}
        for x in range(1, G - 1):
            a, b = spans.get(idx[x], (x, x))
            spans[idx[x]] = (min(a, x), max(b, x + 1))
        cols = sorted(spans.items())
        H, HW = terrain.H, terrain.HW
        for z in range(1, G - 1):
            pj = idx[z] * (n + 1)
            for k, (xa, xb) in cols:
                k2 = pj + k
                if power[k2] < 128:
                    continue
                i0 = z * G
                if roles[k2] == 1:
                    blocked += sum(m[i0 + xa:i0 + xb])
                    m[i0 + xa:i0 + xb] = bytes(xb - xa)
                elif roles[k2] == 2:
                    for x in range(xa, xb):
                        if not m[i0 + x] and H[z * HW + x] > dry_raw:
                            m[i0 + x] = 1
                            allowed += 1
        emit("progress", message=f"passagem pintada: {blocked} células bloqueadas, {allowed} liberadas")
        return m

    def init(self, *a, **k):
        orig_init(self, *a, **k)
        state["t"] = self
        if self.id != spec["terrain"]:
            return
        clean = spec.get("clean")
        if clean and clean["relight"]:
            # direção do sol que explica a luz original: a luz nova combina com o céu do mapa
            try:
                import cp_lighting
                tb = self.raw["terrain.win.bdf"]
                lit = {n.replace("\\", "/").split("/")[-1]: b for n, b in self.lighting.items()}
                state["sun"] = cp_lighting.fit_sun(tb, sm.read_bdf_payload(tb), lit, self.y, self.grid)
            except Exception as e:  # noqa: BLE001 — sem o ajuste, usa a direção padrão
                emit("progress", message=f"luz: direção do sol padrão ({e})")
        if spec.get("grid") and spec["grid"] != self.grid:
            _resize_terrain(sm, self, spec["grid"], flat=spec.get("flat_base"))
            state["resized"] = True
        hf = self.raw["hfield.win.bdf"]
        fb, hd = spec.get("flat_base"), spec.get("height_delta")
        if fb is not None:
            hf = _flat(sm, hf, fb)
        if hd:
            hf = _apply_delta(sm, hf, hd)
        if spec.get("water_level") is not None and self.raw.get("info.win.bdf"):
            # o jogo lê o nível da água no info.win.bdf (offset 216)
            import struct as _st
            ipl = bytearray(sm.read_bdf_payload(self.raw["info.win.bdf"]))
            if len(ipl) >= 220:
                _st.pack_into("<f", ipl, 216, spec["water_level"])
                self.raw["info.win.bdf"] = sm.rebuild_bdf(self.raw["info.win.bdf"], bytes(ipl))
        if spec.get("sky") and self.raw.get("info.win.bdf"):
            try:
                import cp_world
                self.raw["info.win.bdf"] = cp_world.set_info_sky(self.raw["info.win.bdf"], spec["sky"])
                emit("progress", message=f"céu trocado: {spec['sky']['sky']}")
            except Exception as e:  # noqa: BLE001 — sem a troca, fica o céu do terreno base
                state["warnings"].append(f"o céu não foi trocado ({e})")
        if fb is not None or hd:
            self.set_hfield(hf)
            if fb is not None:
                emit("progress", message=f"base lisa na altura {fb:g}")
            if hd:
                emit("progress", message=f"relevo do gerador aplicado ({hd['size'] + 1}² amostras)")

    def set_hfield(self, new):
        old = self.raw["hfield.win.bdf"]
        try:
            if state.get("resized"):
                # terreno redimensionado: a malha original é do tamanho antigo e não acompanha o
                # relevo (a conferência recusaria depois de percorrer milhões de pontos)
                raise ValueError("terreno redimensionado")
            H1, _ = sm.hfield_heights(new)
            tb, moved = sm.resample_mesh_heights(self.raw["terrain.win.bdf"], old, new,
                                                 bvh_min_y=min(H1) / 128.0 - 5, bvh_max_y=max(H1) / 128.0 + 5)
            self.raw["terrain.win.bdf"] = tb
            if moved:
                emit("progress", message=f"malha visual ajustada ao relevo novo ({moved} vértices)")
        except Exception as e:  # noqa: BLE001 — terrenos de escaramuça desenham direto do heightfield
            emit("progress", message=f"malha visual não ajustada ({e}); o relevo usa o heightfield")
        orig_set(self, new)
        state["hf_changed"] = True
        if spec.get("water_level") is not None:
            # máscara de água do zero (o terreno base pode não ter): define onde é água para o jogo
            import cp_world
            wd = cp_world.waterdepth_dds(self.y, spec["water_level"], self.HW - 1, cp_world.dds_header(512, 512, 10))
            self.raw["waterDepth.dds"] = wd
            self._wd = wd[128:]
            state["water_mask"] = True
        elif spec.get("water_rewrite") and self.raw.get("waterDepth.dds"):
            # a máscara de água acompanha o relevo novo (lagos e rios novos, terra nova)
            import cp_world
            hd = self.raw["waterDepth.dds"][:128]
            wd = cp_world.waterdepth_dds(self.y, sm._water_level(self), self.HW - 1, hd)
            self.raw["waterDepth.dds"] = wd
            self._wd = wd[128:]
            state["water_mask"] = True

    def make_save(blob, n_armies, area=None):
        t = state.get("t")
        if area is None:
            g = t.grid if t is not None else 1024
            area = (40, 40, g - 40, g - 40)
        extra = ""
        if t is not None:
            for i, (x, z) in enumerate(spec.get("extra_mass") or [], 1):
                px, pz = _buildable_near(t, x, z)
                if (px, pz) != (round(x), round(z)):
                    state["warnings"].append(f"massa {i} movida para ({px}, {pz}): o ponto escolhido não era plano/seco")
                extra += sm.mass_marker(f"Mass X{i:02d}", px, pz, t.y(px, pz))
            if spec.get("extra_mass"):
                emit("progress", message=f"pontos de massa manuais: {len(spec['extra_mass'])}")
        return orig_save(blob + extra, n_armies, area)

    orig_pack = sm.package_patched

    def package_patched(out, terrain, *a, **k):
        # (a troca de texturas do chão, spec["reskin"], o próprio make_map já aplica antes)
        # decorações novas/removidas: entram antes do strip_props do toolkit
        clean = spec.get("clean") or {}
        clear = clean.get("clear_props", False)
        # a malha nova primeiro: o passo dela (que pode ficar mais grosso para caber no jogo) é o que
        # as decorações usam para assentar no chão que aparece
        if clean and terrain.raw.get("terrain.win.bdf"):
            _clean_visual(sm, spec, state, terrain, a[0])
        if (spec.get("props_add") or spec.get("props_remove") or clear) and terrain.raw.get("mapobjs.win.bdf"):
            import cp_mapobjs
            grid = terrain.grid
            def ground(x, z):
                return terrain.y(min(grid, max(0, x)), min(grid, max(0, z)))
            # com a malha nova, a altura é a da superfície que aparece (malha mais grossa que o relevo):
            # nada flutua nem afunda em encostas e bordas
            height = ground
            if state.get("mesh_step"):  # malha nova feita logo acima (sem ela, o chão é o relevo)
                import cp_regrid
                height = cp_regrid.mesh_height(ground, state["mesh_step"])
            data, na, nr = cp_mapobjs.edit(terrain.raw["mapobjs.win.bdf"], spec.get("props_add") or [],
                                           spec.get("props_remove") or [], height, clear=clear)
            terrain.raw["mapobjs.win.bdf"] = data
            state["props"] = (na, nr)
            emit("progress", message=f"decorações: {na} novas, {nr} removidas")
            if k.get("strip_props") == "all":
                k["strip_props"] = "moving"  # "remover todos" apagaria as novas também
        if state.get("hf_changed"):
            _regrid_collision(sm, state, terrain)
        water = False
        if state.get("water_repointed"):
            water = True  # a malha nova já aponta para a máscara de água do mapa novo
        elif state.get("water_mask") and terrain.raw.get("terrain.win.bdf"):
            try:
                terrain.raw["terrain.win.bdf"] = sm.retarget_waterdepth_path(terrain.raw["terrain.win.bdf"], terrain.id, a[0])
                water = True
                emit("progress", message="máscara de água refeita para os lagos e rios novos")
            except Exception as e:  # noqa: BLE001 — sem a troca, a água segue a do terreno base
                state["warnings"].append(f"a água nova pode não aparecer no jogo ({e})")
        res = orig_pack(out, terrain, *a, **k)
        if water:
            # o jogo procura a máscara com e sem ".win"
            with zipfile.ZipFile(out, "a", zipfile.ZIP_DEFLATED) as zf:
                zf.writestr(f"maps/{a[0]}/{a[0]}.waterDepth.win.dds", terrain.raw["waterDepth.dds"])
        return res

    sm.Terrain.__init__, sm.Terrain.set_hfield, sm.make_save = init, set_hfield, make_save
    sm.package_patched = package_patched
    sm.dry_gentle_mask = dry_gentle_mask
    # minimapa "natural" (cores do relevo com sombra): entra no lugar da paleta "dark" do toolkit
    orig_dark = getattr(sm, "dark_palette", None)
    if spec.get("minimap") == "natural":
        sm.dark_palette = _natural_palette
        spec["minimap"] = "dark"

    def restore():
        sm.Terrain.__init__, sm.Terrain.set_hfield, sm.make_save = orig_init, orig_set, orig_save
        sm.package_patched = orig_pack
        sm.dry_gentle_mask = orig_mask
        if orig_dark is not None:
            sm.dark_palette = orig_dark
    return restore


def _flat(sm, hfield_bytes, y):
    """heightfield inteiro numa altura só (base lisa)"""
    import struct
    pl = bytearray(sm.read_bdf_payload(hfield_bytes))
    _, w, h, _, off = struct.unpack_from("<5I", pl, 0)
    v = max(0, min(65535, int(round(y * 128))))
    pl[off:off + w * h * 2] = struct.pack("<H", v) * (w * h)
    return sm.rebuild_bdf(hfield_bytes, bytes(pl))


def _existing_textures(sm, grounds):
    """Só conjuntos cuja difusa existe no jogo (normal/especular ausentes ficam de fora): um
    caminho que o jogo não acha viraria chão sem textura."""
    names = set()
    for scd in ("textures.scd", "z_dlc1.scd"):
        path = os.path.join(sm.GAMEDATA, scd)
        if os.path.isfile(path):
            try:
                with zipfile.ZipFile(path) as zf:
                    names.update(n.replace("\\", "/").lower() for n in zf.namelist())
            except (OSError, zipfile.BadZipFile):
                pass
    if not names:
        return grounds  # sem como conferir (pasta do jogo diferente): segue como veio

    def has(p):
        k = p.lstrip("/").lower()
        # texturas importadas pelo usuário: o launcher põe os arquivos no pacote do mapa depois
        if k.startswith("textures/terrain/cp/"):
            return True
        return k.replace(".dds", ".win.dds") in names or k in names
    out = []
    for g in grounds:
        if g.get("d") and has(g["d"]):
            out.append({k: v for k, v in g.items() if v and has(v)})
    return out


def _mesh_step(grid):
    """passo da malha nova do chão: 1 vértice a cada 2 unidades até mapas 1024 (o mesmo detalhe do
    relevo do editor), 4 nos de 2048"""
    import os as _os
    v = _os.environ.get("CP_MESH_STEP")
    if v:
        return float(v)
    if grid <= 2048:
        return 2.0 if grid <= 512 else 4.0 if grid <= 1024 else 8.0
    # mapas gigantes: até ~230 vértices por lado (o jogo não aceita mais de ~65 mil num material)
    return float(math.ceil(grid / 230 / 4) * 4)


def _clean_visual(sm, spec, state, terrain, new_id):
    """Chão com um conjunto só de texturas e luz refeita para o relevo novo (cp_lighting)."""
    import cp_lighting
    clean = spec["clean"]
    tb = terrain.raw["terrain.win.bdf"]
    pl = sm.read_bdf_payload(tb)
    grounds = _existing_textures(sm, clean.get("ground") or [])
    if clean.get("ground") and not grounds:
        state["warnings"].append("as texturas de chão escolhidas não foram achadas no jogo: o chão ficou como era")
    if grounds:
        pl, n, skipped = cp_lighting.reskin_all(pl, grounds)
        emit("progress", message=f"chão: {n} texturas trocadas pelo conjunto escolhido")
        if skipped:
            state["warnings"].append(f"{skipped} textura(s) do chão não couberam no espaço do terreno base e ficaram como eram")
    tb = sm.rebuild_bdf(tb, pl)
    # malha nova: grade regular que segue o relevo novo, com luz própria (nada do mapa original dentro
    # do mapa). Se o terreno tiver um formato inesperado, cai na luz refeita sobre a malha original.
    if clean.get("relight"):
        try:
            import cp_regrid
            import cp_world
            g = terrain.grid
            step = _mesh_step(g)
            margin = (256.0 if g <= 1024 else 384.0) if clean.get("ring") else 0.0
            inner = lambda x, z: terrain.y(min(g, max(0, x)), min(g, max(0, z)))  # noqa: E731
            height = cp_world.ring_height(inner, g, rise=clean.get("ring_rise", 95.0)) if margin else inner
            wl = spec.get("water_level")
            water = wl if wl is not None else (sm._water_level(terrain) or None)
            chain = _existing_textures(sm, clean.get("chain") or []) if clean.get("chain") else []
            zones = cp_world.chain_zones(chain) if len(chain) >= 2 else None
            biome = cp_world.Biome(height, g, water, paint=clean.get("paint"), peaks=clean.get("peaks", True)).prepare(-margin, g + 2 * margin) if zones else None
            zone_t = biome.t if biome else None
            blend = biome.blend if biome else None
            deck = clean.get("deck")
            if zones and deck:
                dtex = _existing_textures(sm, [deck["tex"]])
                if dtex:
                    on_deck = cp_world.deck_tester(deck["segs"])
                    t = dtex[0]
                    zones = zones + [{"d": (t["d"], t["d"]), "n": (t.get("n"), t.get("n")), "s": (t.get("s"), t.get("s"))}]
                    di = len(zones) - 1
                    zone_t = lambda x, z, _t=biome.t: di if on_deck(x, z) else _t(x, z)  # noqa: E731
                    blend = lambda x, z, _b=biome.blend: 0.0 if on_deck(x, z) else _b(x, z)  # noqa: E731
                    emit("progress", message=f"pontes: {len(deck['segs'])} trecho(s) com textura própria")
                else:
                    state["warnings"].append("a textura das pontes não foi achada no jogo: as pontes usam o chão do bioma")
            path = f"/maps/{new_id}/lighting/cpgrid.dds"
            wpath = f"/maps/{new_id}/{new_id}.waterDepth.dds" if water and terrain.raw.get("waterDepth.dds") else None
            ring_step = 16.0
            for _try in range(6):
                # os mapas do jogo nunca passam de ~61 mil vértices num material: fica abaixo de 65 mil.
                # A conferência vem antes das árvores e do pacote: uma tentativa grande demais custa pouco
                tb2, info = cp_regrid.rebuild_terrain(tb, height, g, step=step, mask_path=path, margin=margin, ring_step=ring_step,
                                                      zones=zones, zone_t=zone_t, uv_scale=clean.get("uv_tile"),
                                                      water_y=wl, water_mask_path=wpath, log=lambda m: emit("progress", message=m),
                                                      max_verts=65000)
                if tb2 is not None:
                    break
                if ring_step < 32:
                    ring_step = 32.0
                else:
                    step *= 2
                emit("progress", message=f"malha grande demais num material ({info['max_rec']} vértices): montando mais leve")
            if tb2 is None:
                raise ValueError("malha do chão grande demais mesmo na versão mais leve")
            state["mesh_step"] = step
            if zones and info["zones"] < len(zones):
                state["warnings"].append(f"o terreno base só tem {info['zones']} material(is) de mistura: o chão usa {info['zones'] + 1} texturas")
            stem = info["old_mask"].replace("\\", "/").rsplit("/", 1)[-1][:-4] if info["old_mask"] else ""
            lit = {n.replace("\\", "/").split("/")[-1].lower(): b for n, b in terrain.lighting.items()}
            donor = [lit.get(f"{stem}_{k}.win.dds".lower()) for k in range(3)]
            if not all(donor):
                donor = [lit.get(f"mask01_{k}.win.dds") for k in range(3)]
            if not all(donor):
                raise ValueError("máscaras de luz do terreno base não encontradas")
            masks = cp_lighting.grid_masks(donor, height, g, sun=state.get("sun") or cp_lighting.SUN,
                                           ext0=info["ext0"], ext=info["ext"], blend=blend)
            if len(masks) != 3:
                raise ValueError("máscaras de luz novas incompletas")
            for f, b in masks.items():
                terrain.lighting[f"maps/{terrain.id}/lighting/{f}"] = b
            terrain.raw["terrain.win.bdf"] = tb2
            state["regrid"] = info
            if wpath:
                state["water_repointed"] = True
            emit("progress", message="luz do chão refeita para o relevo novo"
                 + (f"; {len(chain)} texturas por bioma" if zones else "") + ("; paisagem em volta do mapa" if margin else ""))
            return
        except Exception as e:  # noqa: BLE001 — segue com a malha original
            emit("progress", message=f"malha do chão não refeita ({e}); refazendo só a luz")
        pl = sm.read_bdf_payload(tb)
        old_dir = cp_lighting.mask_dir(pl, terrain.id)
        new_dir = f"/maps/{new_id}/lighting/"
        lit = {n.replace("\\", "/").split("/")[-1]: (n, b) for n, b in terrain.lighting.items()}
        if old_dir:
            try:
                pl, out, n = cp_lighting.relight(tb, pl, {k: v[1] for k, v in lit.items()}, terrain.y, terrain.grid,
                                                 old_dir, new_dir, sun=state.get("sun") or cp_lighting.SUN,
                                                 log=lambda m: emit("progress", message=m))
                for f, b in out.items():
                    terrain.lighting[lit[f][0]] = b
                if n:
                    emit("progress", message=f"luz do chão refeita para o relevo novo ({n} máscara(s))")
                else:
                    state["warnings"].append("a luz do chão não pôde ser refeita (sombras do terreno base podem aparecer)")
            except Exception as e:  # noqa: BLE001 — sem a luz nova, o mapa continua válido
                state["warnings"].append(f"a luz do chão não pôde ser refeita ({e})")
        else:
            state["warnings"].append("terreno sem máscaras de luz conhecidas: a luz original foi mantida")
        tb = sm.rebuild_bdf(tb, pl)
    terrain.raw["terrain.win.bdf"] = tb


def _regrid_collision(sm, state, terrain):
    """Colisão nova para o relevo novo (sem ela, a câmera, os tiros e o cursor batem no chão antigo)."""
    if not terrain.raw.get("collision2.win.bdf"):
        return
    try:
        import cp_regrid
        g = terrain.grid
        terrain.raw["collision2.win.bdf"] = cp_regrid.regrid_collision(terrain.raw["collision2.win.bdf"], terrain.y, g, step=max(4.0, g / 128))
        emit("progress", message="colisão do chão refeita para o relevo novo")
    except Exception as e:  # noqa: BLE001
        state["warnings"].append(f"a colisão do chão não pôde ser refeita ({e}); a câmera pode atravessar morros novos")


def _apply_delta(sm, hfield_bytes, hd):
    """Soma a camada de relevo (grade menor, interpolada) ao heightfield inteiro."""
    import array
    import struct
    pl = bytearray(sm.read_bdf_payload(hfield_bytes))
    _, w, h, _, off = struct.unpack_from("<5I", pl, 0)
    n, sc = hd["size"], hd["scale"] * 128.0
    D = array.array("h")
    D.frombytes(hd["data"])
    H = array.array("H")
    H.frombytes(bytes(pl[off:off + w * h * 2]))
    if sys.byteorder != "little":
        D.byteswap()
        H.byteswap()
    k = n / max(1, w - 1)
    np = sm._numpy() if hasattr(sm, "_numpy") else None
    if np is not None:
        # mesma conta (float64, arredondamento par como o round do Python), sem laço em Python
        Dm = np.frombuffer(D.tobytes(), dtype=np.int16).astype(np.float64).reshape(n + 1, n + 1)
        Hm = np.frombuffer(H.tobytes(), dtype=np.uint16).astype(np.int64).reshape(h, w)
        fx = np.arange(w, dtype=np.float64) * k
        ii = np.minimum(n - 1, fx.astype(np.int64))
        uu = fx - ii
        fz = np.arange(h, dtype=np.float64) * k
        jj = np.minimum(n - 1, fz.astype(np.int64))
        vv = (fz - jj)[:, None]
        r0, r1 = Dm[jj], Dm[jj + 1]
        a0 = r0[:, ii] + (r0[:, ii + 1] - r0[:, ii]) * uu
        a1 = r1[:, ii] + (r1[:, ii + 1] - r1[:, ii]) * uu
        d = a0 + (a1 - a0) * vv
        Hm = np.clip(Hm + np.rint(d * sc).astype(np.int64), 0, 65535).astype("<u2")
        pl[off:off + w * h * 2] = Hm.tobytes()
        return sm.rebuild_bdf(hfield_bytes, bytes(pl))
    cols = []
    for x in range(w):
        fx = x * k
        i = min(n - 1, int(fx))
        cols.append((i, fx - i))
    n1 = n + 1
    for z in range(h):
        fz = z * k
        j = min(n - 1, int(fz))
        v = fz - j
        r0, r1 = j * n1, (j + 1) * n1
        base = z * w
        for x, (i, u) in enumerate(cols):
            a0 = D[r0 + i] + (D[r0 + i + 1] - D[r0 + i]) * u
            a1 = D[r1 + i] + (D[r1 + i + 1] - D[r1 + i]) * u
            d = a0 + (a1 - a0) * v
            if d:
                y = H[base + x] + int(round(d * sc))
                H[base + x] = 0 if y < 0 else 65535 if y > 65535 else y
    if sys.byteorder != "little":
        H.byteswap()
    pl[off:off + w * h * 2] = H.tobytes()
    return sm.rebuild_bdf(hfield_bytes, bytes(pl))


def _natural_palette(terrain):
    """Minimapa com as cores do relevo (água, areia, grama, terra, rocha e neve) e sombra."""
    wl = 0.0
    try:
        import sc2maps
        wl = sc2maps._water_level(terrain)
    except Exception:  # noqa: BLE001
        pass
    ys = terrain.H
    lo, hi = min(ys) / 128.0, max(ys) / 128.0
    span = max(1.0, hi - max(lo, wl))
    g = terrain.grid

    def pal(x, z):
        y = terrain.y(x, z)
        if wl > 0 and y < wl:
            d = min(1.0, (wl - y) / 20.0)
            return (int(70 - 40 * d), int(120 - 50 * d), int(160 - 30 * d))
        x1, z1 = min(g, x + 3), min(g, z + 3)
        sl = (terrain.y(x1, z) - y) * 0.8 + (terrain.y(x, z1) - y) * 0.6
        t = (y - max(lo, wl)) / span
        if wl > 0 and y < wl + 2.5:
            c = (196, 182, 130)
        elif t > 0.82:
            c = (226, 230, 234)
        elif t > 0.6:
            c = (124, 116, 104)
        elif t > 0.35:
            c = (112, 128, 74)
        else:
            c = (88, 132, 64)
        steep = abs(sl) > 6
        if steep:
            c = (118, 110, 100)
        k = max(0.55, min(1.35, 1.0 - sl * 0.05))
        return tuple(max(0, min(255, int(v * k))) for v in c)
    return pal


def _buildable_near(t, x, z, r=10):
    """Célula seca e quase plana mais próxima (o extrator de massa precisa de chão plano)."""
    def ok(cx, cz):
        return 2 <= cx < t.grid - 2 and 2 <= cz < t.grid - 2 and t.dry(cx, cz) and t.slope_raw(cx, cz) <= 32
    x, z = round(x), round(z)
    if ok(x, z):
        return x, z
    cand = [(cx, cz) for cx in range(x - r, x + r + 1) for cz in range(z - r, z + r + 1) if ok(cx, cz)]
    return min(cand, key=lambda p: (p[0] - x) ** 2 + (p[1] - z) ** 2) if cand else (x, z)


def cmd_build(inp):
    spec = _clean_spec(inp["spec"])
    import make_map
    make_map.WS = OUT
    sm = _toolkit()
    state = {"warnings": list(spec.pop("_notes", []))}
    restore = _hooks(sm, spec, state)
    old = sys.stdout
    sys.stdout = LineCapture()
    try:
        res = make_map.build_map(spec, verbose=True, install=False)
    finally:
        sys.stdout.flush()
        sys.stdout = old
        restore()
    res = _jsonable(res)
    res["spawns"] = {str(k): list(v) for k, v in (res.get("spawns") or {}).items()}
    res["warnings"] = state["warnings"]
    res["extraMass"] = len(spec.get("extra_mass") or [])
    res["propsAdded"], res["propsRemoved"] = state.get("props", (0, 0))
    res["reskinned"] = len(spec.get("reskin") or {})
    res["scenarioId"] = spec["scenario_id"]
    res["name"] = spec["name"]
    return res


COMMANDS = dict(ping=cmd_ping, catalog=cmd_catalog, preview=cmd_preview, terrain3d=cmd_terrain3d,
                examples=cmd_examples, build=cmd_build)


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        emit("error", message=f"comando desconhecido; use um de: {', '.join(COMMANDS)}")
        return 2
    raw = sys.stdin.read()
    try:
        inp = json.loads(raw) if raw.strip() else {}
        data = COMMANDS[sys.argv[1]](inp)
        emit("result", data=data)
        return 0
    except AssertionError as e:  # verificações do make_map ("VERIFY FAILED …")
        emit("error", message=f"A verificação do mapa falhou: {e}", detail="")
        return 1
    except FileNotFoundError as e:
        emit("error", message=f"Arquivo do jogo não encontrado: {e}", detail="")
        return 1
    except Exception as e:  # noqa: BLE001
        emit("error", message=str(e) or e.__class__.__name__, detail=traceback.format_exc())
        return 1


if __name__ == "__main__":
    sys.exit(main())
