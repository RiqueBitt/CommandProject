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
    if spec.get("playable_area"):
        spec["playable_area"] = tuple(int(v) for v in spec["playable_area"])
    return spec


def cmd_build(inp):
    spec = _clean_spec(inp["spec"])
    import make_map
    make_map.WS = OUT
    old = sys.stdout
    sys.stdout = LineCapture()
    try:
        res = make_map.build_map(spec, verbose=True, install=False)
    finally:
        sys.stdout.flush()
        sys.stdout = old
    res = _jsonable(res)
    res["spawns"] = {str(k): list(v) for k, v in (res.get("spawns") or {}).items()}
    res["scenarioId"] = spec["scenario_id"]
    res["name"] = spec["name"]
    return res


COMMANDS = dict(ping=cmd_ping, catalog=cmd_catalog, preview=cmd_preview, examples=cmd_examples, build=cmd_build)


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
