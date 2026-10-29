"""CommandProject: marcadores da IA para os mapas montados pelo Estúdio.

Os mapas competitivos feitos à mão trazem dezenas de marcadores que a IA do jogo lê para andar e
decidir (caminhos por terra e pelo ar, áreas de expansão, pontos de defesa e de encontro, zonas de
combate, alvos de ataque e lugares protegidos para experimentais). Este módulo gera esses
marcadores a partir das bases, dos pontos de massa e do relevo, sem depender da malha de navegação
(que pode ser refeita depois).
"""
import math
import re

_POS = re.compile(r"\['type'\] = STRING\( '([^']+)' \).*?\['position'\] = VECTOR3\( ([-\d.]+), ([-\d.]+), ([-\d.]+) \)", re.S)


def positions(blob, kind):
    """(x, z) de cada marcador do tipo `kind` no texto dos marcadores."""
    out = []
    # um bloco por marcador: as linhas com 16 espaços abrem um (as de dentro têm 20)
    for block in re.split(r"\n {16}\['", "\n" + blob)[1:]:
        m = _POS.search(block)
        if m and m.group(1) == kind:
            out.append((float(m.group(2)), float(m.group(4))))
    return out


def _marker(name, kind, x, z, y, color, prop, graph=None):
    extra = "                    ['hint'] = BOOLEAN( true ),\n"
    if graph:
        extra += f"                    ['graph'] = STRING( '{graph}' ),\n"
    yy = f"{y:.3f}".rstrip("0").rstrip(".")
    return (f"                ['{name}'] = {{\n{extra}"
            f"                    ['color'] = STRING( '{color}' ),\n"
            f"                    ['type'] = STRING( '{kind}' ),\n"
            f"                    ['prop'] = STRING( '{prop}' ),\n"
            f"                    ['orientation'] = QUATERNION( 0, 0, 0, 1 ),\n"
            f"                    ['position'] = VECTOR3( {x}, {yy}, {z} ),\n"
            f"                }},\n")


def markers(height, dry, grid, spawns, mass):
    """Texto dos marcadores. `height(x, z)` e `dry(x, z)` leem o terreno; `spawns` e `mass` são
    listas de (x, z). Devolve (texto, contagem por tipo)."""
    G = grid
    k = G / 1024.0
    cx = cz = G / 2.0

    def inside(x, z, m=24):
        return m <= x <= G - m and m <= z <= G - m

    def walkable(x, z, r=4):
        if not inside(x, z) or not dry(x, z):
            return False
        y = height(x, z)
        return all(abs(height(x + dx, z + dz) - y) < r * 0.9 for dx, dz in ((r, 0), (-r, 0), (0, r), (0, -r)))

    def snap(x, z, reach=24):
        x, z = round(x), round(z)
        if walkable(x, z):
            return (x, z)
        for rad in range(4, reach + 1, 4):
            for a in range(0, 360, 30):
                px, pz = round(x + math.cos(math.radians(a)) * rad), round(z + math.sin(math.radians(a)) * rad)
                if walkable(px, pz):
                    return (px, pz)
        return None

    out, count, used = [], {}, []

    def add(kind, x, z, color, prop, graph=None, gap=0.0):
        if gap and any(u[0] == kind and math.hypot(u[1] - x, u[2] - z) < gap for u in used):
            return
        used.append((kind, x, z))
        count[kind] = count.get(kind, 0) + 1
        out.append(_marker(f"CP {kind} {count[kind]:03d}", kind, x, z, height(x, z), color, prop, graph))

    # caminhos por terra (grade nos pontos caminháveis) e pelo ar (grade mais larga)
    step = max(48, round(80 * k))
    for z in range(step // 2, G, step):
        for x in range(step // 2, G, step):
            p = snap(x, z, step // 3)
            if p:
                add("Land Path Node", p[0], p[1], "ff00ff00", "/props/markers/M_Path_prop.bp", "DefaultLand")
    air = max(80, round(128 * k))
    for z in range(air // 2, G, air):
        for x in range(air // 2, G, air):
            add("Air Path Node", x, z, "ffffffff", "/props/markers/M_Path_prop.bp", "DefaultAir")

    # expansões: os pontos de massa fora das bases, agrupados (perto = mesma expansão)
    far = [m for m in mass if all(math.hypot(m[0] - s[0], m[1] - s[1]) > 40 * k for s in spawns)]
    groups = []
    for m in far:
        for g in groups:
            if any(math.hypot(m[0] - q[0], m[1] - q[1]) < 45 * k for q in g):
                g.append(m)
                break
        else:
            groups.append([m])
    exp = []
    for g in groups:
        gx, gz = sum(p[0] for p in g) / len(g), sum(p[1] for p in g) / len(g)
        p = snap(gx, gz) or (round(g[0][0]), round(g[0][1]))
        exp.append(p)
        add("Expansion Area", p[0], p[1], "ff008080", "/props/markers/M_Expansion_prop.bp")
        if len(g) >= 3:
            add("Large Expansion Area", p[0], p[1], "ffff0080", "/props/markers/M_Expansion_prop.bp")
        add("Attack Marker", p[0], p[1], "ff800080", "/props/markers/M_Blank_prop.bp")
        q = snap(gx + 14 * k, gz + 14 * k)
        if q:
            add("Defensive Point", q[0], q[1], "ff008000", "/props/markers/M_Defensive_prop.bp")

    # cada base: encontro e defesa na frente (para o centro), experimentais protegidos atrás
    for sx, sz in spawns:
        a = math.atan2(cz - sz, cx - sx)
        for d, kind, color, prop in ((30, "Rally Point", "FF808000", "/props/markers/M_Defensive_prop.bp"),
                                     (-34, "Protected Experimental Construction", "ff0000AA", "/props/markers/M_Expansion_prop.bp")):
            p = snap(sx + math.cos(a) * d * k, sz + math.sin(a) * d * k)
            if p:
                add(kind, p[0], p[1], color, prop)
        for da in (-0.6, 0.6):
            p = snap(sx + math.cos(a + da) * 48 * k, sz + math.sin(a + da) * 48 * k)
            if p:
                add("Defensive Point", p[0], p[1], "ff008000", "/props/markers/M_Defensive_prop.bp")
        add("Attack Marker", round(sx), round(sz), "ff800080", "/props/markers/M_Blank_prop.bp")

    # zonas de combate: o centro e o meio do caminho entre cada base e a vizinha mais perto
    p = snap(cx, cz, 60)
    if p:
        add("Combat Zone", p[0], p[1], "ff800000", "/props/markers/M_CombatZone_prop.bp")
    for i, s in enumerate(spawns):
        others = [t for j, t in enumerate(spawns) if j != i]
        if not others:
            continue
        t = min(others, key=lambda q: math.hypot(q[0] - s[0], q[1] - s[1]))
        p = snap((s[0] + t[0]) / 2, (s[1] + t[1]) / 2, 40)
        if p:
            add("Combat Zone", p[0], p[1], "ff800000", "/props/markers/M_CombatZone_prop.bp", gap=50 * k)
    return "".join(out), count
