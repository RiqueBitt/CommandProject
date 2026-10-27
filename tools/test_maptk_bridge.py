"""
Teste de integração do maptk_bridge com um "jogo sintético".

Gera uma pasta gamedata falsa com um terreno 1024x1024 (heightfield + navmesh + minimapa)
e o save.lua de referência, depois roda os comandos do bridge como o launcher roda:
ping → catalog → preview → build (REMIX e PATCH). Não precisa do jogo instalado.

    python tools/test_maptk_bridge.py
"""

import base64
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


def mapobjs():
    """1 árvore em (400, 400), no formato real (cabeçalho de 8 u32 + fixups)."""
    import math
    sys.path.insert(0, os.path.join(ROOT, "resources", "maptk"))
    import cp_mapobjs
    bp = b"/props/Trees/spruce01/spruce01_prop.bp\x00\x00"
    rec = struct.pack("<4f3ffIfI", math.cos(0.3), 0, math.sin(0.3), 0, 400.0, 20.0, 400.0, 1.0, 28 + 44, 1.0, 0)
    payload = struct.pack("<7I", 4, 1, 28, 0, 28 + 44 + len(bp), 0, 28 + 44 + len(bp)) + rec + bp
    return cp_mapobjs.write_mfdb([0x4244464D, 7, 2, 0, 0, 0, 0, 1], [8, 16, 24, 28 + 32], payload)


def minimap():
    hdr = bytearray(128)
    hdr[0:4] = b"DDS "
    struct.pack_into("<I", hdr, 4, 124)
    struct.pack_into("<II", hdr, 12, 1024, 1024)
    struct.pack_into("<I", hdr, 80, 4)
    hdr[84:88] = b"DXT1"
    return bytes(hdr) + bytes(8 * 256 * 256)


def waterdepth():
    hdr = bytearray(128)
    hdr[0:4] = b"DDS "
    struct.pack_into("<I", hdr, 4, 124)
    struct.pack_into("<II", hdr, 12, 512, 512)
    hdr[84:88] = b"DXT5"
    return bytes(hdr) + bytes(16 * 128 * 128)


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
        for k in ("collision2", "decals"):
            z.writestr(f"{base}.{k}.win.bdf", bdf(b"\x00" * 64))
        z.writestr(f"{base}.terrain.win.bdf", bdf(b"\x00" * 16 + b"/textures/Terrain/MP_901/sc2_mp_901_grass01_d.dds" + b"\x00" * 24
                                                  + f"/maps/{TID}/{TID}.waterDepth.dds".encode() + b"\x00" * 8))
        z.writestr(f"{base}.waterDepth.dds", waterdepth())
        z.writestr(f"{base}.mapobjs.win.bdf", mapobjs())
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

        # terreno 3D traz as decorações; decorações novas/removidas e textura trocada saem no .scd
        t3 = run("terrain3d", {"terrain": TID, "size": 64}, gd, out)[0]
        assert t3["propKinds"] == ["/props/Trees/spruce01/spruce01_prop.bp"] and len(t3["props"]) == 1, t3["props"]
        spec4 = dict(spec, scenario_id="SC2_CPDECOR", name="[2] Decor",
                     props_add=[["/props/Rocks/Rock02/Rock02_prop.bp", 500, 500, 30, 1.2], ["/props/Trees/oak01/oak01_prop.bp", 520, 510],
                                ["/props/Rocks/Rock02/Rock02_prop.bp", -50, 300]],  # fora do mapa sem paisagem: fica de fora
                     props_remove=[[400, 400, 5]],
                     reskin={"/textures/Terrain/MP_901/sc2_mp_901_grass01_d.dds": "/textures/Terrain/MP_002/sc2_mp_002_snow01_d.dds"})
        res4, log4 = run("build", {"spec": spec4}, gd, out)
        assert res4["propsAdded"] == 2 and res4["propsRemoved"] == 1 and res4["reskinned"] == 1, res4
        with zipfile.ZipFile(res4["scd"]) as zf:
            mo = zf.read("maps/SC2_CPDECOR/SC2_CPDECOR.mapobjs.win.bdf")
            tb = zf.read("maps/SC2_CPDECOR/SC2_CPDECOR.terrain.win.bdf")
        sys.path.insert(0, os.path.join(ROOT, "resources", "maptk"))
        import cp_mapobjs
        got = cp_mapobjs.props(mo)
        assert len(got) == 3 and got[0][1] == -100.0, got
        assert got[1][5] == "/props/Rocks/Rock02/Rock02_prop.bp" and abs(got[1][3] - 30) < 0.01 and abs(got[1][4] - 1.2) < 1e-5, got[1]
        assert abs(got[2][1] - 20.0) < 1.5, "decoração apoiada no chão"
        assert b"sc2_mp_002_snow01_d" in zlib.decompress(tb[tb.find(b"\x78\x9c"):]), "textura trocada"
        print("decorações + textura ok:", res4["propsAdded"], "novas,", res4["propsRemoved"], "removida, 1 textura")

        # camada de relevo do gerador (morro de +40 no centro) + máscara de água refeita
        import array
        n = 64
        d = array.array("h", [0] * ((n + 1) ** 2))
        for j in range(n + 1):
            for i in range(n + 1):
                r = ((i - 32) ** 2 + (j - 32) ** 2) ** 0.5
                if r < 8:
                    d[j * (n + 1) + i] = int(40 * 32 * (1 - r / 8))
        spec5 = dict(spec, scenario_id="SC2_CPGERA", name="[2] Gerado", minimap="natural", water_rewrite=True,
                     height_delta=dict(size=n, scale=1 / 32, data=base64.b64encode(d.tobytes()).decode()))
        res5, log5 = run("build", {"spec": spec5}, gd, out)
        assert any("relevo do gerador aplicado" in l for l in log5), log5
        with zipfile.ZipFile(res5["scd"]) as z:
            names5 = z.namelist()
            hf = z.read("maps/SC2_CPGERA/SC2_CPGERA.hfield.win.bdf")
            tb5 = z.read("maps/SC2_CPGERA/SC2_CPGERA.terrain.win.bdf")
        assert "maps/SC2_CPGERA/SC2_CPGERA.waterDepth.win.dds" in names5, names5
        assert "maps/SC2_CPGERA/SC2_CPGERA.costs.win.bdf" in names5, "relevo novo refaz a navegação"
        sys.path.insert(0, os.path.join(ROOT, "resources", "maptk"))
        import sc2maps
        H5, w5 = sc2maps.hfield_heights(hf)
        assert abs(H5[512 * w5 + 512] / 128 - 60.0) < 1.5, H5[512 * w5 + 512] / 128
        assert abs(H5[100 * w5 + 100] / 128 - 20.0) < 0.1
        assert b"/maps/SC2_CPGERA/SC2_CPGERA.waterDepth.dds" in sc2maps.read_bdf_payload(tb5), "máscara de água apontando para o mapa novo"
        print("gerador ok: relevo +40 no centro, máscara de água e minimapa natural")

        # base lisa + visual limpo: tudo plano na altura pedida, decorações originais fora
        spec6 = dict(spec, scenario_id="SC2_CPLISO", name="[2] Liso", flat_base=33,
                     clean=dict(ground=[dict(d="/textures/Terrain/MP_007/sc2_mp_007_grass01_d.dds")], relight=True, clear_props=True))
        res6, log6 = run("build", {"spec": spec6}, gd, out)
        assert any("base lisa" in l for l in log6), log6
        assert res6["propsRemoved"] == 1, res6
        with zipfile.ZipFile(res6["scd"]) as z:
            H6, w6 = sc2maps.hfield_heights(z.read("maps/SC2_CPLISO/SC2_CPLISO.hfield.win.bdf"))
        assert abs(H6[700 * w6 + 512] / 128 - 33) < 0.01 and abs(H6[3 * w6 + 3] / 128 - 33) < 0.01
        print("base lisa ok: heightfield plano e decorações originais retiradas")
        test_lighting()
        test_resize()
        test_rebuild()
        test_sky_and_water()
        test_atmosphere()
        test_ring_layer()

        bad = dict(spec, scenario_id="meu mapa")
        env = dict(os.environ, SC2_GAMEDATA=gd, SC2_MAP_OUT=out)
        p = subprocess.run([sys.executable, BRIDGE, "build"], input=json.dumps({"spec": bad}).encode(), capture_output=True, env=env)
        assert p.returncode == 1 and b"SC2_MEUMAPA" in p.stdout, p.stdout
    print("maptk_bridge: todos os testes passaram")


def test_resize():
    """Mapa gigante: o terreno base redimensionado para 2048 (heightfield, navegação e info)."""
    sys.path.insert(0, os.path.join(ROOT, "resources", "maptk"))
    import maptk_bridge as mb
    import sc2maps as sm

    class T:
        pass
    t = T()
    t.raw = {"hfield.win.bdf": heightfield(), "costs.win.bdf": costs()}
    ip = bytearray(256)
    struct.pack_into("<2f", ip, 204, 1024.0, 1024.0)
    t.raw["info.win.bdf"] = bdf(bytes(ip))
    t.grid, t.HW, t.HH = GRID, HW, HW
    t.costs_payload = bytearray(sm.read_bdf_payload(t.raw["costs.win.bdf"]))
    _, nl, toff = struct.unpack_from("<3I", t.costs_payload, 0)
    t.layers = [struct.unpack_from("<7I", t.costs_payload, toff + 28 * i) for i in range(nl)]
    old_events = mb.emit
    mb.emit = lambda *a, **k: None
    try:
        mb._resize_terrain(sm, t, 2048)
    finally:
        mb.emit = old_events
    hp = sm.read_bdf_payload(t.raw["hfield.win.bdf"])
    ver, w, h, n, off, cnt2, off2 = struct.unpack_from("<7I", hp, 0)
    assert (w, h, n, off) == (2049, 2049, 2049 * 2049, 28) and cnt2 == 2048 * 2048 and off2 % 4 == 0 and off2 + cnt2 == len(hp), (w, cnt2, off2, len(hp))
    assert t.grid == 2048 and sm.GRID == 2048 and t.HW == 2049
    # o morro do centro (700, 512) vai para (1400, 1024), na mesma altura; a planície continua em 20
    assert abs(t.H[1024 * 2049 + 1400] / 128 - (20 + 90 * 0.05)) < 0.1 and abs(t.H[100 * 2049 + 100] / 128 - 20) < 1e-3
    cp = t.costs_payload
    assert len(t.layers) == 3 and all(r[1] == 2048 * 2048 for r in t.layers)
    oA = t.layers[0][2]
    # a parede em x=300 vira x=600..601; a passagem (z 480..540) vira z 960..1081
    assert cp[oA + 200 * 2048 + 600] == 255 and cp[oA + 200 * 2048 + 601] == 255 and cp[oA + 200 * 2048 + 602] == 1
    assert cp[oA + 1000 * 2048 + 600] == 1
    assert t.layers[-1][6] + 4 * t.layers[-1][5] <= len(cp)
    assert struct.unpack_from("<2f", sm.read_bdf_payload(t.raw["info.win.bdf"]), 204) == (2048.0, 2048.0)
    # base lisa: sai plano direto, sem interpolar
    t2 = T()
    t2.__dict__.update({k: v for k, v in t.__dict__.items()})
    mb.emit = lambda *a, **k: None
    try:
        mb._resize_terrain(sm, t2, 4096, flat=60)
    finally:
        mb.emit = old_events
    assert t2.HW == 4097 and t2.H[0] == 60 * 128 and t2.H[4097 * 4097 - 1] == 60 * 128
    print("mapa gigante ok: heightfield 2049² e 4097², navegação e tamanho no info")


def test_lighting():
    """cp_lighting com uma malha mínima: 1 material (2 camadas + máscara de luz) e 2 triângulos."""
    sys.path.insert(0, os.path.join(ROOT, "resources", "maptk"))
    import cp_lighting as cl
    import sc2maps
    strs = [b"Ground01-Sand01", b"/textures/Terrain/MP_901/sc2_mp_901_ground01_d.dds", b"/textures/Terrain/MP_901/sc2_mp_901_sand01_d.dds",
            b"/textures/engine/black_d.dds", b"/maps/SC2_MP_901/lighting/mask02.dds"]
    strtab = 20 + 108
    sp = strtab + 84
    ptr = []
    blob_s = b""
    for t in strs:
        ptr.append(sp + len(blob_s))
        blob_s += t + b"\x00" * (4 - len(t) % 4 + 4)
    N = 0xFFFFFFFF
    mat = struct.pack("<21I", ptr[0], N, N, 0, N, N, 0, 0, ptr[1], ptr[2], N, N, N, N, ptr[3], N, N, N, ptr[4], N, N)
    head = struct.pack("<5I", 6, 1, 20, 1, strtab) + struct.pack("<27I", *([0] * 27))
    body = head + mat + blob_s
    fix = len(body)
    hill = lambda x, z: 20 + max(0.0, 60 - ((x - 512) ** 2 + (z - 512) ** 2) ** 0.5 * 0.3)
    n = 17  # malha 17×17 já com o relevo novo (como fica depois de resample_mesh_heights)
    verts = b""
    for j in range(n):
        for i in range(n):
            x, z = i * 1024 / (n - 1), j * 1024 / (n - 1)
            verts += struct.pack("<3f", x, hill(x, z), z) + struct.pack("<10H", 0, 0, round(i * 32767 / (n - 1)), round(j * 32767 / (n - 1)), 0, 0, 0, 0, 0, 0)
    tri = []
    for j in range(n - 1):
        for i in range(n - 1):
            a = j * n + i
            tri += [a, a + 1, a + n, a + 1, a + n + 1, a + n]
    idx = struct.pack(f"<{len(tri)}I", *tri)
    pl = body + struct.pack("<5I", 3, n * n, 20, len(tri), 20 + n * n * 32) + verts + idx + b"\x00" * 64
    comp = zlib.compress(pl, 6)
    data = b"MFDB" + struct.pack("<6I", 7, 2, 0, len(comp), len(pl), 1) + struct.pack("<I", fix) + comp
    # máscara DXT5 64×64 com 1 mip: alfa = 0x55 em todo bloco, cor qualquer
    w = 64
    dds = bytearray(128)
    dds[:4] = b"DDS "
    struct.pack_into("<2I", dds, 12, w, w)
    struct.pack_into("<I", dds, 28, 1)
    dds[84:88] = b"DXT5"
    blocks = (w // 4) ** 2
    dds += (b"\x55" * 8 + struct.pack("<2HI", 0xFFFF, 0x0000, 0)) * blocks
    lit = {f"mask02_{k}.win.dds": bytes(dds) for k in range(3)}
    p0 = sc2maps.read_bdf_payload(data)
    p1, n, sk = cl.reskin_all(p0, [dict(d="/textures/Terrain/MP_007/sc2_mp_007_grass01_d.dds"), dict(d="/textures/Terrain/CA_U06/U06_grass_d.dds")])
    assert n == 2 and sk == 0 and p1.count(b"/textures/Terrain/MP_007/sc2_mp_007_grass01_d.dds") == 2, (n, sk)
    assert b"/textures/engine/black_d.dds" in p1
    p2, out, k = cl.relight(data, p1, lit, hill, 1024, "/maps/SC2_MP_901/lighting/", "/maps/SC2_CPLUZ/lighting/")
    assert k == 1 and sorted(out) == sorted(lit), (k, list(out))
    assert b"/maps/SC2_CPLUZ/lighting/mask02.dds" in p2 and b"/maps/SC2_MP_901/lighting/" not in p2
    m0 = out["mask02_0.win.dds"]
    assert len(m0) == len(dds) and m0[:128] == bytes(dds[:128])
    assert all(m0[128 + i * 16:128 + i * 16 + 8] == b"\x55" * 8 for i in range(blocks)), "a mistura (alfa) não muda"
    cols = {struct.unpack_from("<H", m0, 128 + i * 16 + 8)[0] for i in range(blocks)}
    assert len(cols) > 3, "a luz nova acompanha o relevo"
    print(f"luz refeita ok: {len(cols)} tons, caminho da máscara apontando para o mapa novo")


def test_rebuild():
    """Malha nova completa (cp_regrid.rebuild_terrain) num terreno mínimo no formato do jogo:
    1 material de chão com mistura (BLENDING) + 1 de água; grade, anel em volta, biomas e água."""
    sys.path.insert(0, os.path.join(ROOT, "resources", "maptk"))
    import cp_regrid as rg
    import cp_world
    nrec = 2
    # textos: nomes, defines, texturas, máscara, água
    strs = {}
    tab = bytearray()
    base_st = 20 + nrec * 108
    def S(t):
        if t not in strs:
            while len(tab) % 4:
                tab.append(0)
            strs[t] = len(tab)
            tab.extend(t.encode() + b"\x00")
        return strs[t]
    for t in ("Ground", "Water", "BLENDING", "RNM_LIGHTING", "49", "/textures/Terrain/MP_901/a_d.dds", "/textures/Terrain/MP_901/b_d.dds",
              "/maps/SC2_MP_901/lighting/mask02.dds", "/textures/Terrain/Water/foam_001.dds", "/maps/SC2_MP_901/SC2_MP_901.waterDepth.dds"):
        S(t)
    # defines (2 pares nome/valor) logo depois dos materiais
    mats_len = nrec * 84
    defs_off = mats_len
    defs = bytearray()
    N = 0xFFFFFFFF
    mk_mats = lambda st: [
        [st + mats_len + 16 + strs["Ground"], N, N, 2, st + defs_off, N, 0, 0, st + mats_len + 16 + strs["/textures/Terrain/MP_901/a_d.dds"],
         st + mats_len + 16 + strs["/textures/Terrain/MP_901/b_d.dds"], N, N, N, N, N, N, N, N, st + mats_len + 16 + strs["/maps/SC2_MP_901/lighting/mask02.dds"], N, N],
        [st + mats_len + 16 + strs["Water"], N, N, 0, N, N, 0, 0, st + mats_len + 16 + strs["/textures/Terrain/Water/foam_001.dds"], N, N, N, N, N,
         st + mats_len + 16 + strs["/maps/SC2_MP_901/SC2_MP_901.waterDepth.dds"], N, N, N, N, N, N]]
    # malha: chão 3×3 vértices sobre o mapa (y = 20) e água 2 triângulos (y = -90)
    G = 512
    ground = [(x, 20.0, z) for z in (0, 256, 512) for x in (0, 256, 512)]
    gt = []
    for j in range(2):
        for i in range(2):
            a = j * 3 + i
            gt += [(a, a + 3, a + 1), (a + 1, a + 3, a + 4)]
    waterp = [(-1000.0, -90.0, -1000.0), (1500.0, -90.0, -1000.0), (-1000.0, -90.0, 1500.0), (1500.0, -90.0, 1500.0)]
    wt = [(0, 2, 1), (1, 2, 3)]
    def vtx(p):
        return struct.pack("<3f2e2H3I", *p, 0.0, 0.0, 0, 0, 0, 0, 0)
    recs = [(ground, gt), (waterp, wt)]
    # árvores
    blocks, fix = [], []
    bvh0 = 20 + nrec * 108
    vbuf, ibuf, vc, ic = b"", b"", [], []
    for P, T in recs:
        vorder, ntris, nodes = rg.build_bvh(P, T)
        base = bvh0 + sum(len(b) for b in blocks)
        nb, nf = rg._pack_nodes(nodes, base)
        blocks.append(nb); fix += nf
        vc.append(len(vbuf) // 32); ic.append(len(ibuf) // 4)
        vbuf += b"".join(vtx(P[k]) for k in vorder)
        ibuf += struct.pack(f"<{len(ntris) * 3}I", *[k for t in ntris for k in t])
    st = bvh0 + sum(len(b) for b in blocks)
    out = bytearray(struct.pack("<5I", 6, nrec, 20, nrec, st))
    fix += [8, 16]
    for r in range(nrec):
        d = bytearray(108)
        struct.pack_into("<3I", d, 0, 200, 30, 0x43480000)
        struct.pack_into("<2I", d, 12, vc[r], ic[r])
        struct.pack_into("<I", d, 32, bvh0 + sum(len(b) for b in blocks[:r]))
        fix.append(20 + r * 108 + 32)
        out += d
    for b in blocks:
        out += b
    assert len(out) == st
    for m in mk_mats(st):
        out += struct.pack("<21I", *m)
    for r in range(nrec):
        for f in (0, 4, 8, 9, 14, 18):
            fix.append(st + r * 84 + f * 4)
    defs += struct.pack("<4I", st + mats_len + 16 + strs["BLENDING"], st + mats_len + 16 + strs["49"],
                        st + mats_len + 16 + strs["RNM_LIGHTING"], st + mats_len + 16 + strs["49"])
    fix += [st + mats_len + k * 4 for k in range(4)]
    out += defs + tab
    while len(out) % 32:
        out.append(0)
    blob = len(out)
    nv, ni = len(vbuf) // 32, len(ibuf) // 4
    out += struct.pack("<5I", 3, nv, 20, ni, 20 + nv * 32) + vbuf + ibuf
    fix += [blob + 8, blob + 16]
    data = rg.write_bdf([0x4244464D, 7, 2, 0, 0, 0, 0, 0], sorted(fix), [0, blob], out)
    # a malha mínima lê de volta
    h, f2, sec, pl = rg.read_bdf(data)
    assert sec == [0, blob] and len(f2) == len(fix)
    height = cp_world.ring_height(lambda x, z: 20.0 + 30.0 * max(0.0, 1 - ((x - 256) ** 2 + (z - 256) ** 2) ** 0.5 / 120), G)
    biome = cp_world.Biome(height, G, water=10.0)
    zones = cp_world.chain_zones([{"d": f"/textures/Terrain/MP_007/t{k}_d.dds"} for k in range(5)])
    new, info = rg.rebuild_terrain(data, height, G, step=8.0, mask_path="/maps/SC2_CPGRID/lighting/cpgrid.dds", margin=128.0,
                                   ring_step=32.0, zones=zones, zone_t=biome.t, water_y=10.0,
                                   water_mask_path="/maps/SC2_CPGRID/SC2_CPGRID.waterDepth.dds")
    assert info["zones"] == 1 and info["water"], info  # só 1 material com mistura neste terreno
    h, f3, sec3, pl3 = rg.read_bdf(new)
    st3 = struct.unpack_from("<I", pl3, 16)[0]
    w0 = struct.unpack_from("<21I", pl3, st3)
    cs = lambda p: pl3[p:pl3.find(b"\x00", p)].decode()
    assert cs(w0[18]) == "/maps/SC2_CPGRID/lighting/cpgrid.dds" and cs(w0[8]).endswith("t0_d.dds") and cs(w0[9]).endswith("t1_d.dds")
    assert "BLENDING" in {cs(struct.unpack_from("<I", pl3, w0[4] + 8 * k)[0]) for k in range(2)}, "defines continuam apontando certo"
    w1 = struct.unpack_from("<21I", pl3, st3 + 84)
    assert cs(w1[14]) == "/maps/SC2_CPGRID/SC2_CPGRID.waterDepth.dds"
    a, nv3, _, ni3, _ = struct.unpack_from("<5I", pl3, sec3[1])
    ys = [struct.unpack_from("<f", pl3, sec3[1] + 20 + k * 32 + 4)[0] for k in range(nv3)]
    xs = [struct.unpack_from("<f", pl3, sec3[1] + 20 + k * 32)[0] for k in range(nv3)]
    assert min(xs) < -100 and max(xs) > G + 100, "anel em volta do mapa"
    assert any(abs(y - 10.0) < 1e-3 for y in ys), "lâmina d'água na altura nova"
    assert max(ys) > 60, "montanhas em volta"
    for p in f3:
        if p < sec3[1]:
            v = struct.unpack_from("<I", pl3, p)[0]
            assert v == 0xFFFFFFFF or v < sec3[1], f"ponteiro fora do lugar em {p}"
    print(f"malha nova ok: {ni3 // 3} triângulos, anel em volta, água e texturas por bioma")


def test_sky_and_water():
    """céu trocado no info.win.bdf e máscara de água texel a texel"""
    import cp_regrid
    import cp_world
    pl = bytearray(260)
    struct.pack_into("<f", pl, 216, 40.0)
    for k in range(5):
        struct.pack_into("<I", pl, 240 + 4 * k, 260)
    pl += b"/textures/environment/u01_env.dds\0/textures/environment/u01_sky.dds\0"
    struct.pack_into("<I", pl, 244, 260 + len("/textures/environment/u01_env.dds") + 1)
    info = cp_regrid.write_bdf([0x4244464D, 7, 2, 0, 0, 0, 5, 1], [240, 244, 248, 252, 256], [0], pl)
    new = cp_world.set_info_sky(info, {"env": "/textures/environment/u05_env.dds", "sky": "/textures/environment/u05_sky.dds",
                                       "sight": "/textures/ColorCorrection/a.ccc.dds", "fog": ""})
    _, fix, _, p2 = cp_regrid.read_bdf(new)
    assert fix == [240, 244, 248, 252, 256]
    txt = [bytes(p2[q:p2.index(b"\0", q)]).decode() for q in struct.unpack_from("<5I", p2, 240)]
    assert txt[1] == "/textures/environment/u05_sky.dds" and txt[3].endswith("a.ccc.dds") and txt[4] == "", txt
    assert abs(struct.unpack_from("<f", p2, 216)[0] - 40) < 1e-6
    # água: rampa de x = 0 (y 30) a x = 1024 (y 50) → margem em x = 512, sem degrau de bloco
    wd = cp_world.waterdepth_dds(lambda x, z: 30 + x / 1024 * 20, 40.0, 1024, cp_world.dds_header(512, 512, 10))
    assert len(wd) == 349680
    def alpha(i, j):
        o = 128 + ((j // 4) * 128 + i // 4) * 16
        a0, a1 = wd[o], wd[o + 1]
        code = (int.from_bytes(wd[o + 2:o + 8], "little") >> (3 * ((j % 4) * 4 + i % 4))) & 7
        pal = [a0, a1] + [((7 - n) * a0 + n * a1) // 7 for n in range(1, 7)]
        return pal[code]
    assert alpha(254, 7) > 0 and alpha(256, 7) == 0 and alpha(250, 7) > alpha(254, 7)
    print("céu e água ok: caminhos novos no info.win.bdf, margem da água texel a texel")


def test_atmosphere():
    """atmosfera: multiplicadores sobre as cores do mapa base, vento absoluto, textos intactos"""
    import cp_regrid
    import cp_world
    pl = bytearray(508)
    struct.pack_into("<3f", pl, 16, 1.0, 0.9, 0.8)       # cor do sol
    struct.pack_into("<f", pl, 28, 1.2)                  # força do sol
    struct.pack_into("<4f", pl, 100, 0.2, 0.4, 0.6, 1)   # cor da água
    struct.pack_into("<3f", pl, 292, 0.3, 0.5, 0.9)      # neblina
    struct.pack_into("<2f", pl, 316, 400, 1600)
    struct.pack_into("<f", pl, 216, 40.0)
    for k in range(5):
        struct.pack_into("<I", pl, 240 + 4 * k, 508)
    pl += b"/textures/environment/u01_sky.dds\0"
    info = cp_regrid.write_bdf([0x4244464D, 7, 2, 0, 0, 0, 5, 1], [240, 244, 248, 252, 256], [0], pl)
    new = cp_world.set_info_env(info, {"sun": [1.2, 1.0, 0.5], "sun_power": 2.0, "water": [1, 1, 0.5],
                                       "fog_amount": 2.0, "wind_dir": 90, "wind": 0.5})
    _, fix, _, p2 = cp_regrid.read_bdf(new)
    f = lambda o, n=1: struct.unpack_from(f"<{n}f", p2, o)
    assert [round(x, 3) for x in f(16, 3)] == [1.2, 0.9, 0.4]
    assert abs(f(28)[0] - 2.0) < 1e-6, "força do sol limitada a 2"
    assert [round(x, 3) for x in f(100, 4)] == [0.2, 0.4, 0.3, 1.0]
    assert [round(x, 3) for x in f(292, 3)] == [0.6, 1.0, 1.0], "neblina limitada a 1"
    assert [round(x) for x in f(316, 2)] == [200, 800], "neblina mais perto"
    assert abs(f(496, 3)[0]) < 1e-3 and abs(f(496, 3)[1] - 1) < 1e-3 and abs(f(496, 3)[2] - 0.5) < 1e-6
    assert abs(f(216)[0] - 40) < 1e-6 and fix == [240, 244, 248, 252, 256]
    assert bytes(p2[508:]).startswith(b"/textures/environment/u01_sky.dds")
    try:
        cp_world.set_info_env(info, {"sun": [1, "x", 1]})
        raise AssertionError("cor inválida aceita")
    except ValueError:
        pass
    print("atmosfera ok: cores multiplicadas, limites respeitados, vento e textos")


def test_ring_layer():
    """paisagem esculpida: camada só fora do mapa, zero na borda, malha da paisagem sem saltos"""
    import base64
    import cp_world
    import maptk_bridge as mb
    n, grid, margin = 16, 512, 256
    vals = [0] * ((n + 1) ** 2)
    for j in range(n + 1):
        for i in range(n + 1):
            vals[j * (n + 1) + i] = 100 * 32  # +100 em todo lugar
    data = struct.pack(f"<{len(vals)}h", *vals)
    d = cp_world.ring_layer(n, margin, grid, data)
    assert d(256, 256) == 0 and d(0, 300) == 0 and d(512, 512) == 0, "dentro do mapa e na borda não muda"
    assert abs(d(-100, 256) - 100) < 1e-6 and abs(d(700, -150) - 100) < 1e-6, "longe da borda entra inteira"
    assert 0 < d(-10, 256) < 100, "mistura perto da borda"
    flat = cp_world.ring_mesh_height(lambda x, z: 3 * x + 2 * z, 16.0)
    for x, z in ((-100.0, -37.5), (600.5, 13.0), (-3.0, 700.0)):
        assert abs(flat(x, z) - (3 * x + 2 * z)) < 1e-6, "plano reproduzido pela malha"
    ok = mb._ring_sculpt({"n": n, "margin": margin, "data": base64.b64encode(data).decode()})
    assert ok["n"] == n and ok["data"] == data
    for bad in ({"n": 4, "margin": 256, "data": ""}, {"n": n, "margin": 256, "data": base64.b64encode(data[:-2]).decode()}, {"margin": 1}):
        try:
            mb._ring_sculpt(bad)
            raise AssertionError(f"camada inválida aceita: {bad}")
        except ValueError:
            pass
    assert mb._ring_sculpt(None) is None
    print("paisagem ok: camada só fora do mapa, emenda sem degrau, validação")


if __name__ == "__main__":
    main()
