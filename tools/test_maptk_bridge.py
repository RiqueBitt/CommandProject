"""
Teste de integração do maptk_bridge com um "jogo sintético".

Gera uma pasta gamedata falsa com um terreno 1024x1024 (heightfield + navmesh + minimapa)
e o save.lua de referência, depois roda os comandos do bridge como o launcher roda:
ping → catalog → preview → build (REMIX e PATCH). Não precisa do jogo instalado.

    python tools/test_maptk_bridge.py
"""

import json
import os
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRIDGE = os.path.join(ROOT, "resources", "maptk", "maptk_bridge.py")
TID = "SC2_MP_901"
GRID = 1024
HW = GRID + 1


def bdf(payload):
    comp = zlib.compress(payload, 6)
    head = bytearray(b"MFDB")
    head += struct.pack("<6I", 7, 2, 0, len(comp), len(payload), 0)
    out = head + comp
    while len(out) % 32:
        out += b"\x00"
    return bytes(out)


def heightfield():
    # planície em y=20 com uma colina no centro e um "rio" (vala) em x≈300
    H = bytearray()
    vals = []
    for z in range(HW):
        for x in range(HW):
            y = 20.0
            d = ((x - 700) ** 2 + (z - 512) ** 2) ** 0.5
            if d < 90:
                y += (90 - d) * 0.05
            vals.append(int(y * 128))
    H = struct.pack(f"<{HW*HW}H", *vals)
    payload = struct.pack("<5I", 2, HW, HW, HW * HW, 28) + b"\x00" * 8 + H
    return bdf(payload)


def costs(n_layers=3, cap=4):
    table = 12
    recs_end = table + 28 * n_layers
    off = recs_end
    layers = []
    blob = bytearray()
    for li in range(n_layers):
        offA = off + len(blob)
        grid = bytearray([1]) * (GRID * GRID)
        for z in range(GRID):  # bordas bloqueadas + uma parede em x=300 com passagem
            for x in (0, GRID - 1):
                grid[z * GRID + x] = 255
            if not (480 <= z <= 540):
                grid[z * GRID + 300] = 255
        blob += grid
        offB = off + len(blob)
        blob += bytes(GRID * GRID)
        offS = off + len(blob)
        blob += bytes(16 * cap)
        layers.append((li, GRID * GRID, offA, GRID * GRID, offB, 4 * cap, offS))
    payload = bytearray(struct.pack("<3I", 2, n_layers, table))
    for rec in layers:
        payload += struct.pack("<7I", *rec)
    payload += blob
    return bdf(bytes(payload))


def minimap():
    hdr = bytearray(128)
    hdr[0:4] = b"DDS "
    struct.pack_into("<I", hdr, 4, 124)
    struct.pack_into("<II", hdr, 12, 1024, 1024)
    struct.pack_into("<I", hdr, 80, 4)
    hdr[84:88] = b"DXT1"
    return bytes(hdr) + bytes(8 * 256 * 256)


def info():
    p = bytearray(256)
    struct.pack_into("<f", p, 216, 0.0)
    return bdf(bytes(p))


def save_lua():
    armies = "".join(f"        ['ARMY_{a}'] = {{ personality = '', plans = '', color = 0, faction = 0, }},\n" for a in [1, 2, 3, 4, "EXTRA"])
    return ("Scenario = {\n    Chains = {\n    },\n    Armies = {\n" + armies + "    },\n}\n").encode()


def make_game(root):
    gd = os.path.join(root, "gamedata")
    os.makedirs(gd)
    with zipfile.ZipFile(os.path.join(gd, "maps.scd"), "w") as z:
        base = f"maps/{TID}/{TID}"
        z.writestr(base + ".hfield.win.bdf", heightfield())
        z.writestr(base + ".costs.win.bdf", costs())
        z.writestr(base + ".minimap.win.dds", minimap())
        z.writestr(base + ".info.win.bdf", info())
        for k in ("collision2", "terrain", "mapobjs", "decals"):
            z.writestr(f"{base}.{k}.win.bdf", bdf(b"\x00" * 64))
    with zipfile.ZipFile(os.path.join(gd, "uncompiled_lua.scd"), "w") as z:
        z.writestr("uncompiled/maps/SC2_MP_204/SC2_MP_204_save.lua", save_lua())
    with zipfile.ZipFile(os.path.join(gd, "z_dlc1.scd"), "w") as z:
        z.writestr("readme.txt", "dlc")
    return gd


def run(cmd, inp, gd, out):
    env = dict(os.environ, SC2_GAMEDATA=gd, SC2_MAP_OUT=out, PYTHONIOENCODING="utf-8")
    p = subprocess.run([sys.executable, "-X", "utf8", BRIDGE, cmd], input=json.dumps(inp).encode(),
                       capture_output=True, env=env, cwd=os.path.dirname(BRIDGE), timeout=900)
    events = [json.loads(l[2:]) for l in p.stdout.decode().splitlines() if l.startswith("@@")]
    res = [e for e in events if e["type"] == "result"]
    errs = [e for e in events if e["type"] == "error"]
    if errs or p.returncode != 0 or not res:
        raise SystemExit(f"[{cmd}] falhou: {errs or p.stderr.decode()[-2000:]}")
    progress = [e["message"] for e in events if e["type"] == "progress"]
    return res[0]["data"], progress


def main():
    with tempfile.TemporaryDirectory() as tmp:
        gd = make_game(os.path.join(tmp, "Supreme Commander 2"))
        out = os.path.join(tmp, "out")
        ping, _ = run("ping", {}, gd, out)
        assert ping["gamedataOk"] and ping["mapsScd"], ping
        cat, _ = run("catalog", {}, gd, out)
        ids = [t["id"] for t in cat["terrains"]]
        assert ids == [TID], ids
        prev, _ = run("preview", {"terrain": TID, "size": 256}, gd, out)
        assert os.path.isfile(prev["path"]) and prev["size"] == 256, prev
        with open(prev["path"], "rb") as f:
            assert f.read(8) == b"\x89PNG\r\n\x1a\n"
        print(f"prévia ok: {prev['navigablePct']}% navegável")

        spec = dict(terrain=TID, scenario_id="SC2_CPTEST", name="[2] Teste CP", anchors={"1": [200, 512], "2": [820, 512]},
                    teams=[[1], [2]], economy=dict(base_mass=4, sites=2, per_site=2), norush=60, patch=None)
        res, log = run("build", {"spec": spec}, gd, out)
        assert os.path.isfile(res["scd"]), res
        with zipfile.ZipFile(res["scd"]) as z:
            names = z.namelist()
        assert "maps/SC2_CPTEST/SC2_CPTEST_scenario.lua" in names, names
        assert any("VERIFIED" in l for l in log), log
        print(f"REMIX ok: {res['mass']} pontos de massa, {len(names)} arquivos")

        # PATCH: o toolkit inunda o terreno e reconstrói a navmesh
        spec2 = dict(spec, scenario_id="SC2_CPPATCH", name="[2] Teste Patch", patch=dict(max_slope=6, water_margin=0, seed=[512, 512]))
        res2, log2 = run("build", {"spec": spec2}, gd, out)
        with zipfile.ZipFile(res2["scd"]) as z:
            names2 = z.namelist()
        assert "maps/SC2_CPPATCH/SC2_CPPATCH.costs.win.bdf" in names2, names2
        print(f"PATCH ok: {res2['navigable_pct']:.1f}% navegável")

        # id inválido é recusado com mensagem clara
        # relevo para o editor 3D: grade amostrada + minimapa (textura)
        import base64
        t3, _ = run("terrain3d", {"terrain": TID, "size": 128}, gd, out)
        hs = base64.b64decode(t3["heights"])
        assert t3["size"] == 128 and len(hs) == 129 * 129 * 2, (t3["size"], len(hs))
        assert abs(t3["yMin"] - 20.0) < 0.1 and t3["yMax"] > 24, t3
        assert t3["minimapDds"] and base64.b64decode(t3["minimapDds"])[:4] == b"DDS ", "minimapa"
        print("terrain3d ok:", t3["size"], "células, y", t3["yMin"], "→", round(t3["yMax"], 1))

        # escultura + massa manual: força PATCH (navegação refeita) e grava os marcadores extras
        spec3 = dict(spec, scenario_id="SC2_CPSCULPT", name="[2] Teste Relevo",
                     sculpt=[["cone", 512.4, 300, 60, 45.0, "raise"], ["disc", 512, 720, 40, 20.0, "set"],
                             ["cone", 700, 500, 50, 12.5, "lower"], ["disc", 300, 700, 30.6, 30, "raise"],
                             ["ramp", 520, 690, 600, 720, 20.0, 30.0, "set"]],
                     rugged_edges={},
                     extra_mass=[[400, 500], [300, 300]])
        res3, log3 = run("build", {"spec": spec3}, gd, out)
        with zipfile.ZipFile(res3["scd"]) as zf:
            names3 = zf.namelist()
            save = zf.read("maps/SC2_CPSCULPT/SC2_CPSCULPT_save.lua").decode("latin1")
        assert "maps/SC2_CPSCULPT/SC2_CPSCULPT.costs.win.bdf" in names3, "relevo exige navegação refeita"
        assert "maps/SC2_CPSCULPT/SC2_CPSCULPT.hfield.win.bdf" in names3, names3
        assert save.count("'Mass X") == 2, "massa manual nos marcadores"
        assert res3["extraMass"] == 2, res3
        assert any("sculpted heightfield: 5" in l for l in log3), log3
        assert any("ruggedized" in l for l in log3), log3
        print("escultura + massa manual ok:", res3["mass"], "massa automática +", res3["extraMass"], "manual")

        bad = dict(spec, scenario_id="meu mapa")
        env = dict(os.environ, SC2_GAMEDATA=gd, SC2_MAP_OUT=out)
        p = subprocess.run([sys.executable, BRIDGE, "build"], input=json.dumps({"spec": bad}).encode(), capture_output=True, env=env)
        assert p.returncode == 1 and b"SC2_MEUMAPA" in p.stdout, p.stdout
    print("maptk_bridge: todos os testes passaram")


if __name__ == "__main__":
    main()
