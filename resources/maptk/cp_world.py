"""Biomas do chão e paisagem em volta do mapa (CommandProject) — só biblioteca padrão.

As mesmas contas existem em TypeScript (src/pages/studio/biome.ts) para a prévia do editor mostrar
o chão como ele vai ficar no jogo; qualquer mudança aqui precisa ir para lá também.

* `zone_t`: posição de um ponto na cadeia de texturas do bioma (0 = praia, 1 = chão, 2 = terra,
  3 = rocha, 4 = topo). Praia junto da água, terra em manchas e em encostas leves, rocha nas
  encostas íngremes e neve (ou o "topo" do bioma) nos pontos mais altos.
* `blend_of`: quanto de cada camada do material da zona (onda triangular de t): na divisa entre
  duas zonas os dois materiais mostram a mesma textura, então não aparece emenda.
* `ring_height`: a paisagem fora do mapa continua o relevo da borda e sobe em montanhas."""
import math

MASK = 0xFFFFFFFF


def _hash(ix, iz, seed):
    h = (ix * 374761393 + iz * 668265263 + seed * 2246822519) & MASK
    h = ((h ^ (h >> 13)) * 1274126177) & MASK
    h ^= h >> 16
    return h / 4294967296.0


def _smooth(t):
    return t * t * (3 - 2 * t)


def value_noise(x, z, seed):
    """ruído suave em [0, 1)"""
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = _smooth(x - ix), _smooth(z - iz)
    a = _hash(ix, iz, seed)
    b = _hash(ix + 1, iz, seed)
    c = _hash(ix, iz + 1, seed)
    d = _hash(ix + 1, iz + 1, seed)
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz


def fbm(x, z, seed, octaves=3):
    """soma de oitavas, em [-1, 1]"""
    s, amp, tot = 0.0, 1.0, 0.0
    for o in range(octaves):
        s += (value_noise(x, z, seed + o * 31) * 2 - 1) * amp
        tot += amp
        x, z, amp = x * 2.03, z * 2.03, amp * 0.5
    return s / tot


def clamp01(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def zone_t(h, slope, rel, water, nz):
    """posição na cadeia (0..4): h altura, slope = |gradiente|, rel = altura relativa (0..1),
    water = nível da água (ou None), nz = ruído em [-1, 1]"""
    t = 1.0
    beach = False
    if water is not None:
        b = clamp01((h - (water + 0.6)) / 2.8)
        if b < 1:
            t, beach = b, True
    if not beach:
        dirt = max(0.0, nz * 1.25 - 0.3) + clamp01((slope - 0.30) / 0.30)
        t = max(t, 1.0 + min(1.0, dirt))
    rock = clamp01((slope - 0.55) / 0.30)
    if rock > 0:
        t = max(t, 2.0 + rock)
    snow = clamp01((rel - 0.74) / 0.14) * (1 - clamp01((slope - 1.1) / 0.6))
    if snow > 0:
        t = max(t, 3.0 + snow)
    return min(t, 3.999)


def blend_of(t):
    """mistura (0..1, 1 = segunda camada) do material da zona int(t): onda triangular"""
    k = int(t)
    f = t - k
    return f if k % 2 == 0 else 1.0 - f


def chain_zones(chain):
    """[{d, n, s}] da cadeia → zonas de material (pares vizinhos). A ordem das camadas alterna
    para a divisa entre duas zonas cair sempre no mesmo valor de mistura."""
    zones = []
    for k in range(len(chain) - 1):
        a, b = chain[k], chain[k + 1]
        if k % 2:
            a, b = b, a
        zones.append({"d": (a["d"], b["d"]), "n": (a.get("n"), b.get("n")), "s": (a.get("s"), b.get("s"))})
    return zones


class Biome:
    """t e mistura de cada ponto do mapa (e da paisagem em volta) a partir do heightfield."""

    def __init__(self, height, grid, water=None, seed=1337, paint=None, peaks=True):
        """paint = (n, papéis, força): camada do pincel em (n+1)² pontos sobre o mapa; papel 0..4
        (praia, chão, terra, rocha, topo) e força 0..255 (0 = automático)"""
        self.paint = paint
        self.peaks = peaks
        self.height = height
        self.grid = grid
        self.water = water
        self.seed = seed
        self.e = grid / 256.0
        lo, hi = 1e9, -1e9
        step = max(1, int(grid // 128))
        for z in range(0, int(grid) + 1, step):
            for x in range(0, int(grid) + 1, step):
                y = height(x, z)
                lo, hi = min(lo, y), max(hi, y)
        if water is not None:
            lo = max(lo, water)
        # o "alto" é relativo a pelo menos 120 de desnível (mapa quase plano não vira neve)
        self.lo, self.hi = lo, max(hi, lo + 120)

    def prepare(self, ext0, ext):
        """pré-calcula t numa grade (passo e) sobre a área [ext0, ext0+ext]: o resto vira consulta"""
        n = int(math.ceil(ext / self.e))
        self._g = None
        vals = [self._t(ext0 + i * self.e, ext0 + j * self.e) for j in range(n + 1) for i in range(n + 1)]
        self._g = (ext0, n, vals)
        return self

    def t(self, x, z):
        g = getattr(self, "_g", None)
        if g is None:
            return self._t(x, z)
        ext0, n, vals = g
        fx = min(n - 1e-6, max(0.0, (x - ext0) / self.e))
        fz = min(n - 1e-6, max(0.0, (z - ext0) / self.e))
        i, j = int(fx), int(fz)
        u, v = fx - i, fz - j
        w = n + 1
        a, b = vals[j * w + i], vals[j * w + i + 1]
        c, d = vals[(j + 1) * w + i], vals[(j + 1) * w + i + 1]
        return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v

    def _t(self, x, z):
        e = self.e
        h = self.height(x, z)
        dx = (self.height(x + e, z) - self.height(x - e, z)) / (2 * e)
        dz = (self.height(x, z + e) - self.height(x, z - e)) / (2 * e)
        rel = (h - self.lo) / (self.hi - self.lo) if self.peaks else 0.0
        nz = fbm(x / 90.0, z / 90.0, self.seed)
        t = zone_t(h, math.hypot(dx, dz), rel, self.water, nz)
        if self.paint and 0 <= x <= self.grid and 0 <= z <= self.grid:
            role, k = self._painted(x, z)
            if k > 0:
                t = min(3.999, t + (role - t) * k)
        return t

    def _painted(self, x, z):
        """papel pintado (média ponderada) e força (0..1) no ponto"""
        n, roles, power = self.paint
        w = n + 1
        fx, fz = x / self.grid * n, z / self.grid * n
        i0, j0 = min(n - 1, int(fx)), min(n - 1, int(fz))
        u, v = fx - i0, fz - j0
        acc = sw = sk = 0.0
        for dj, wz in ((0, 1 - v), (1, v)):
            for di, wx in ((0, 1 - u), (1, u)):
                k = (j0 + dj) * w + i0 + di
                p = power[k] / 255.0
                ww = wx * wz
                sk += p * ww
                if p > 0:
                    acc += roles[k] * p * ww
                    sw += p * ww
        return (acc / sw if sw else 0.0), sk

    def blend(self, x, z):
        return blend_of(self.t(x, z))


RING_LATTICE = 4.0


def ring_height(inner, grid, rise=95.0, seed=4242):
    """Altura em qualquer ponto: dentro do mapa, `inner`; fora, a altura da borda mais próxima
    subindo em montanhas (com picos e vales) conforme se afasta.

    O ruído das montanhas é lido de uma grade de pontos a cada RING_LATTICE unidades (calculados
    uma vez, quando pedidos) e interpolado: a malha da paisagem tem vértices a cada 16 ou 32
    unidades e a luz é amostrada a cada ~5, então o resultado é o mesmo à vista, e a luz dos mapas
    grandes (milhões de amostras) deixa de recalcular o ruído inteiro em cada uma."""
    lat = {}
    L = RING_LATTICE

    def noise(ix, iz):
        v = lat.get((ix, iz))
        if v is None:
            x, z = ix * L, iz * L
            v = (0.55 + 0.45 * fbm(x / 260.0, z / 260.0, seed), 1 - abs(fbm(x / 70.0, z / 70.0, seed + 7)))
            lat[(ix, iz)] = v
        return v

    def h(x, z):
        cx, cz = min(grid, max(0.0, x)), min(grid, max(0.0, z))
        base = inner(cx, cz)
        d = math.hypot(x - cx, z - cz)
        if d <= 0:
            return base
        k = _smooth(clamp01(d / 220.0))
        fx, fz = x / L, z / L
        ix, iz = math.floor(fx), math.floor(fz)
        u, v = fx - ix, fz - iz
        a, b, c, e = noise(ix, iz), noise(ix + 1, iz), noise(ix, iz + 1), noise(ix + 1, iz + 1)
        big = (a[0] + (b[0] - a[0]) * u) * (1 - v) + (c[0] + (e[0] - c[0]) * u) * v
        crag = (a[1] + (b[1] - a[1]) * u) * (1 - v) + (c[1] + (e[1] - c[1]) * u) * v
        return base + rise * k * big + 22.0 * k * crag * crag
    return h


def dds_header(w, h, mips):
    """cabeçalho DDS de uma textura DXT5 (com níveis de mip)"""
    import struct
    hd = bytearray(128)
    hd[0:4] = b"DDS "
    struct.pack_into("<7I", hd, 4, 124, 0x000A1007, h, w, max(1, w // 4) * max(1, h // 4) * 16, 0, mips)
    struct.pack_into("<2I", hd, 76, 32, 0x4)
    hd[84:88] = b"DXT5"
    struct.pack_into("<I", hd, 108, 0x401008)
    return bytes(hd)


def waterdepth_dds(height, water, ext, header, size=None):
    """Máscara de profundidade da água (DXT5, alfa = profundidade) texel a texel, com todos os
    níveis de mip. A versão do toolkit gravava um valor por bloco de 4×4 texels (8 unidades num
    mapa 1024), e a margem da água aparecia em degraus quadrados no jogo."""
    import struct

    def depth_alpha(y):
        if y >= water:
            return 0
        return max(33, min(255, int((water - y) * 40) + 80))

    hw = struct.unpack_from("<I", header, 16)[0] if len(header) >= 128 else 0
    if size is None:
        size = hw if hw in (64, 128, 256, 512, 1024, 2048) else 512
    header = bytearray(header[:128])
    struct.pack_into("<I", header, 12, size)
    struct.pack_into("<I", header, 16, size)
    struct.pack_into("<I", header, 28, size.bit_length())  # níveis de mip até 1×1
    # nível 0 (size²), amostrado no centro de cada texel
    A = [depth_alpha(height((i + 0.5) * ext / size, (j + 0.5) * ext / size)) for j in range(size) for i in range(size)]
    levels = [(size, A)]
    P = size
    while P > 1:
        Q = P // 2
        prev = levels[-1][1]
        levels.append((Q, [(prev[(2 * j) * P + 2 * i] + prev[(2 * j) * P + 2 * i + 1] + prev[(2 * j + 1) * P + 2 * i]
                            + prev[(2 * j + 1) * P + 2 * i + 1] + 2) // 4 for j in range(Q) for i in range(Q)]))
        P = Q
    out = bytearray(header[:128])
    color = struct.pack("<HHI", 0, 0, 0)
    for P, L in levels:
        B = max(1, P // 4)
        for by in range(B):
            for bx in range(B):
                vals = [L[min(P - 1, by * 4 + ty) * P + min(P - 1, bx * 4 + tx)] for ty in range(4) for tx in range(4)]
                a0, a1 = max(vals), min(vals)
                if a0 == a1:
                    out += bytes((a0, a1, 0, 0, 0, 0, 0, 0)) + color
                    continue
                bits, span = 0, a0 - a1
                for k, v in enumerate(vals):
                    q = int(round((a0 - v) * 7 / span))
                    bits |= (0 if q <= 0 else 1 if q >= 7 else q + 1) << (3 * k)
                out += bytes((a0, a1)) + bits.to_bytes(6, "little") + color
    return bytes(out)


SKY_FIELDS = ("env", "sky", "unused", "sight", "fog")


def set_info_sky(info_bytes, sky):
    """Troca o céu no info.win.bdf: os ponteiros nos bytes 240..260 do conteúdo apontam para os
    caminhos da caixa do céu (sky), do reflexo do ambiente (env) e da correção de cor (sight, fog).
    Os textos novos entram no fim do conteúdo; os ponteiros já são correções (fixups) do arquivo."""
    import struct
    import cp_regrid
    head, fix, sec, pl = cp_regrid.read_bdf(info_bytes)
    if len(pl) < 260 or not all(240 + 4 * k in fix for k in (0, 1, 3, 4)):
        raise ValueError("info.win.bdf em formato desconhecido")
    for k, name in enumerate(SKY_FIELDS):
        if name not in sky or name == "unused":
            continue
        while len(pl) % 4:
            pl += b"\x00"
        struct.pack_into("<I", pl, 240 + 4 * k, len(pl))
        pl += str(sky[name] or "").encode("ascii") + b"\x00"
    while len(pl) % 4:
        pl += b"\x00"
    return cp_regrid.write_bdf(head, fix, sec, pl)


def deck_tester(segs, grid_cell=32.0):
    """(x, z) → está no tabuleiro de alguma ponte? segs = [(x0, z0, x1, z1, meia_largura)].
    Índice por células para não testar todas as pontes em cada ponto."""
    cells = {}
    for sg in segs:
        x0, z0, x1, z1, r = sg
        for i in range(int(min(x0, x1) - r) // int(grid_cell) - 1, int(max(x0, x1) + r) // int(grid_cell) + 2):
            for j in range(int(min(z0, z1) - r) // int(grid_cell) - 1, int(max(z0, z1) + r) // int(grid_cell) + 2):
                cells.setdefault((i, j), []).append(sg)

    def on(x, z):
        for x0, z0, x1, z1, r in cells.get((int(x // grid_cell), int(z // grid_cell)), ()):
            dx, dz = x1 - x0, z1 - z0
            L2 = dx * dx + dz * dz or 1.0
            t = max(0.0, min(1.0, ((x - x0) * dx + (z - z0) * dz) / L2))
            if math.hypot(x - (x0 + dx * t), z - (z0 + dz * t)) <= r * 0.92:
                return True
        return False
    return on
