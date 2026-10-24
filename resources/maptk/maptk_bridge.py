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
    if not 1 <= len(spec["anchors"]) <= 8:
        raise ValueError("o mapa precisa de 1 a 8 posições iniciais")
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
    if spec.get("minimap") not in (None, "donor", "desert", "snow", "dark", "natural"):
        raise ValueError("minimapa inválido")
    return spec


def _hooks(sm, spec, state):
    """Extensões do CommandProject sobre o toolkit, sem alterar os arquivos dele:
    * malha visual acompanha o relevo esculpido (em mapas de campanha a superfície é uma malha pronta);
    * pontos de massa colocados à mão entram nos marcadores, no chão plano e seco mais próximo."""
    orig_init, orig_set, orig_save = sm.Terrain.__init__, sm.Terrain.set_hfield, sm.make_save

    def init(self, *a, **k):
        orig_init(self, *a, **k)
        state["t"] = self
        hd = spec.get("height_delta")
        if hd and self.id == spec["terrain"]:
            self.set_hfield(_apply_delta(sm, self.raw["hfield.win.bdf"], hd))
            emit("progress", message=f"relevo do gerador aplicado ({hd['size'] + 1}² amostras)")

    def set_hfield(self, new):
        old = self.raw["hfield.win.bdf"]
        try:
            H1, _ = sm.hfield_heights(new)
            tb, moved = sm.resample_mesh_heights(self.raw["terrain.win.bdf"], old, new,
                                                 bvh_min_y=min(H1) / 128.0 - 5, bvh_max_y=max(H1) / 128.0 + 5)
            self.raw["terrain.win.bdf"] = tb
            if moved:
                emit("progress", message=f"malha visual ajustada ao relevo novo ({moved} vértices)")
        except Exception as e:  # noqa: BLE001 — terrenos de escaramuça desenham direto do heightfield
            emit("progress", message=f"malha visual não ajustada ({e}); o relevo usa o heightfield")
        orig_set(self, new)
        if spec.get("water_rewrite") and self.raw.get("waterDepth.dds"):
            # a máscara de água acompanha o relevo novo (lagos e rios novos, terra nova)
            wd = sm.write_waterdepth_dds_mips(self, sm._water_level(self))
            self.raw["waterDepth.dds"] = wd
            self._wd = wd[128:]
            state["water_mask"] = True

    def make_save(blob, n_armies, area=(40, 40, 984, 984)):
        t = state.get("t")
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
        if (spec.get("props_add") or spec.get("props_remove")) and terrain.raw.get("mapobjs.win.bdf"):
            import cp_mapobjs
            grid = terrain.grid
            def height(x, z):
                return terrain.y(min(grid, max(0, x)), min(grid, max(0, z)))
            data, na, nr = cp_mapobjs.edit(terrain.raw["mapobjs.win.bdf"], spec.get("props_add") or [],
                                           spec.get("props_remove") or [], height)
            terrain.raw["mapobjs.win.bdf"] = data
            state["props"] = (na, nr)
            emit("progress", message=f"decorações: {na} novas, {nr} removidas")
            if k.get("strip_props") == "all":
                k["strip_props"] = "moving"  # "remover todos" apagaria as novas também
        water = False
        if state.get("water_mask") and terrain.raw.get("terrain.win.bdf"):
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
    # minimapa "natural" (cores do relevo com sombra): entra no lugar da paleta "dark" do toolkit
    orig_dark = getattr(sm, "dark_palette", None)
    if spec.get("minimap") == "natural":
        sm.dark_palette = _natural_palette
        spec["minimap"] = "dark"

    def restore():
        sm.Terrain.__init__, sm.Terrain.set_hfield, sm.make_save = orig_init, orig_set, orig_save
        sm.package_patched = orig_pack
        if orig_dark is not None:
            sm.dark_palette = orig_dark
    return restore


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
