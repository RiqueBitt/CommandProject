"""
Contas rápidas do toolkit de mapas (sc2maps) contra a versão simples, célula a célula, que elas
substituíram: mesmas regiões, mesmas ilhas (ordem e caixas), mesmos alcances e a mesma máscara de
chão seco e plano (com e sem numpy). Grades aleatórias, sem precisar do jogo.

    python tools/test_maptk_fast.py
"""

import os
import random
import struct
import sys
from collections import deque

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "resources", "maptk"))
os.environ.setdefault("SC2_GAMEDATA", ROOT)  # o módulo só precisa de uma pasta para começar
import sc2maps as sm  # noqa: E402

fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def flood_islands(payload, layers, G):
    """_recompute_islands como era: uma busca em largura por região, célula a célula"""
    for (_lid, _cA, oA, _cB, oB, cS, oS) in layers:
        cap = cS // 4
        if cap < 1:
            continue
        lbl = [0] * (G * G)
        comps = []
        cid = 0
        for s in range(G * G):
            if payload[oA + s] != 255 and lbl[s] == 0:
                cid += 1
                q = deque([s])
                lbl[s] = cid
                size = 0
                x0 = x1 = s % G
                z0 = z1 = s // G
                while q:
                    i = q.popleft()
                    size += 1
                    x, z = i % G, i // G
                    x0, x1, z0, z1 = min(x0, x), max(x1, x), min(z0, z), max(z1, z)
                    for j, ok in ((i - 1, x > 0), (i + 1, x < G - 1), (i - G, z > 0), (i + G, z < G - 1)):
                        if ok and payload[oA + j] != 255 and lbl[j] == 0:
                            lbl[j] = cid
                            q.append(j)
                comps.append([size, x0, z0, x1, z1, cid])
        comps.sort(key=lambda c: -c[0])
        keep = {c[5]: r for r, c in enumerate(comps[:cap])}
        for i in range(G * G):
            if payload[oA + i] == 255:
                payload[oB + i] = 255
            else:
                r = keep.get(lbl[i])
                if r is None:
                    payload[oA + i] = 255
                    payload[oB + i] = 255
                else:
                    payload[oB + i] = r
        for r in range(cap):
            box = comps[r][1:5] if r < len(comps) else (0, 0, 0, 0)
            struct.pack_into("<4I", payload, oS + 16 * r, *box)


def grid_payload(G, dens, caps):
    nl, toff = len(caps), 12
    blob = bytearray(toff + 28 * nl)
    recs = []
    for li, cap in enumerate(caps):
        oA = len(blob)
        blob += bytes(1 if random.random() < dens else 255 for _ in range(G * G))
        oB = len(blob)
        blob += bytes(G * G)
        oS = len(blob)
        blob += bytes(4 * cap)
        recs.append((li, G * G, oA, G * G, oB, cap, oS))
    struct.pack_into("<3I", blob, 0, 0, nl, toff)
    for i, r in enumerate(recs):
        struct.pack_into("<7I", blob, toff + 28 * i, *r)
    return blob, recs


def main():
    random.seed(11)
    for G, dens in ((48, 0.5), (64, 0.58), (64, 0.8), (91, 0.62)):
        sm.GRID = G
        blob, recs = grid_payload(G, dens, [4, 64, 1000])
        a, b = bytearray(blob), bytearray(blob)
        flood_islands(a, recs, G)
        sm._recompute_islands(b, recs)
        check(a == b, f"ilhas iguais às da busca célula a célula ({G}×{G}, {dens:.0%} livre)")
        # alcance: mesma resposta da busca por pares
        for _ in range(25):
            p = (random.randrange(G), random.randrange(G))
            qs = [(random.randrange(G), random.randrange(G)) for _ in range(6)]
            far = sm.reachable_from(blob, recs, p, qs, 0)
            lab = {}
            oA = recs[0][2]
            s = p[1] * G + p[0]
            if blob[oA + s] != 255:
                q = deque([s])
                lab[s] = 1
                while q:
                    i = q.popleft()
                    x, z = i % G, i // G
                    for j, ok in ((i - 1, x > 0), (i + 1, x < G - 1), (i - G, z > 0), (i + G, z < G - 1)):
                        if ok and j not in lab and blob[oA + j] != 255:
                            lab[j] = 1
                            q.append(j)
            want = [t for t in qs if t[1] * G + t[0] not in lab]
            if far != want:
                check(False, f"alcance de {p}: {far} != {want}")
                break
        else:
            check(True, f"alcances iguais ({G}×{G})")
        # região de uma máscara a partir de um ponto
        mask = bytearray(1 if random.random() < dens else 0 for _ in range(G * G))
        comp, n = sm.component_of(mask, G // 2, G // 2)
        check(n == sum(comp) and all(mask[i] for i in range(G * G) if comp[i]), f"região da máscara consistente ({n} células)")

    # chão seco e plano: com e sem numpy, igual à conta célula a célula
    class T:
        pass
    G = 96
    sm.GRID = G
    t = T()
    t.HW = G + 1
    import array
    t.H = array.array("H", [random.randint(7000, 7700) if random.random() < 0.9 else random.randint(0, 9000) for _ in range(t.HW * t.HW)])
    t._wd = None
    old_level = sm._water_level
    sm._water_level = lambda _t: 50.0
    try:
        want = bytearray(G * G)
        for z in range(1, G - 1):
            for x in range(1, G - 1):
                c = t.H[z * t.HW + x]
                sl = max(abs(t.H[z * t.HW + x + 1] - c), abs(t.H[z * t.HW + x - 1] - c),
                         abs(t.H[(z + 1) * t.HW + x] - c), abs(t.H[(z - 1) * t.HW + x] - c))
                if c > int((50 + 4) * 128) and sl < int(6 * 128):
                    want[z * G + x] = 1
        os.environ["CP_NO_NUMPY"] = "1"
        got_py = sm.dry_gentle_mask(t, 6.0, 4.0)
        del os.environ["CP_NO_NUMPY"]
        got = sm.dry_gentle_mask(t, 6.0, 4.0)
        check(got_py == want and got == want, f"chão seco e plano igual ({'com' if sm._numpy() else 'sem'} numpy instalado)")
    finally:
        sm._water_level = old_level
    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
