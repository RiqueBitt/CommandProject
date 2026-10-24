"""
cp_mapobjs — decorações (props) do mapa: ler, adicionar e remover em `<ID>.mapobjs.win.bdf`.

Parte do CommandProject (MIT). Complementa o SC2 Map Toolkit (que só edita props no lugar).

Formato do payload (versão 4), verificado nos mapas do jogo:
  u32 versão, u32 nProps, u32 ptrProps, u32 nMarcadores, u32 ptrMarcadores, u32 ?, u32 ptrGrafo …
  props: registros de 44 bytes
    quat (w, x, y, z) f32 ×4 | posição (x, y, z) f32 ×3 | escala f32 | ptr do blueprint u32 | f32 1.0 | u32 0
  depois: tabela de strings (caminhos /props/…_prop.bp), marcadores, grafo de navegação.

O container MFDB guarda a lista de "fixups" (posições do payload que contêm ponteiros). Para
inserir bytes no meio, todo ponteiro que aponta para depois do ponto de inserção é deslocado e
toda posição de fixup depois dele também — o mesmo que o jogo faria ao montar o arquivo.
"""

import math
import struct
import zlib

REC = 44


def read_mfdb(data):
    """(cabeçalho de 8 u32, lista de fixups, payload)"""
    head = list(struct.unpack_from("<8I", data, 0))
    if data[:4] != b"MFDB":
        raise ValueError("não é um arquivo MFDB")
    nfix = head[6]
    fixups = list(struct.unpack_from(f"<{nfix}I", data, 32))
    off = (32 + 4 * nfix + 31) // 32 * 32
    try:
        payload = zlib.decompress(data[off:off + head[4]])
    except zlib.error:
        # arquivos montados por outras ferramentas: procura o fluxo zlib como o toolkit faz
        o = data.find(b"\x78\x9c", 28)
        payload = zlib.decompress(data[o:])
    return head, fixups, bytearray(payload)


def write_mfdb(head, fixups, payload):
    comp = zlib.compress(bytes(payload), 6)
    h = list(head)
    h[4], h[5], h[6] = len(comp), len(payload), len(fixups)
    out = bytearray(struct.pack("<8I", *h))
    out += struct.pack(f"<{len(fixups)}I", *fixups)
    while len(out) % 32:
        out += b"\x00"
    out += comp
    while len(out) % 32:
        out += b"\x00"
    return bytes(out)


def insert_bytes(payload, fixups, at, blob):
    """Insere `blob` em `at`, corrigindo ponteiros e fixups. Devolve (payload, fixups)."""
    n = len(blob)
    # ponteiros: valor >= at anda n bytes (lidos ANTES de mexer nas posições)
    for f in fixups:
        v = struct.unpack_from("<I", payload, f)[0]
        if v >= at:
            struct.pack_into("<I", payload, f, v + n)
    new = bytearray(payload[:at]) + bytearray(blob) + bytearray(payload[at:])
    fx = [f + n if f >= at else f for f in fixups]
    return new, fx


def props(data):
    """[(x, y, z, yaw_graus, escala, blueprint)] das decorações do mapa."""
    _, _, pl = read_mfdb(data)
    _ver, count, off = struct.unpack_from("<3I", pl, 0)
    out = []
    for k in range(count):
        o = off + k * REC
        w, qx, qy, qz = struct.unpack_from("<4f", pl, o)
        x, y, z = struct.unpack_from("<3f", pl, o + 16)
        scale = struct.unpack_from("<f", pl, o + 28)[0]
        bp = struct.unpack_from("<I", pl, o + 32)[0]
        end = pl.find(b"\x00", bp)
        yaw = math.degrees(2 * math.atan2(qy, w)) if (w or qy) else 0.0
        out.append((x, y, z, yaw, scale, bytes(pl[bp:end]).decode("latin1")))
    return out


def edit(data, add=(), remove=(), height=None, clear=False):
    """Adiciona e remove decorações.

    add    = [(blueprint, x, z, yaw_graus, escala)] — y vem de `height(x, z)`
    remove = [(x, z, raio)] — props dentro do círculo são afundados (y = -100, como o toolkit
             faz: o jogo não os mostra e nada mais no arquivo muda de lugar)
    clear  = True afunda TODAS as decorações originais (as novas entram depois)
    Devolve (bytes novos, n_adicionados, n_removidos)."""
    head, fixups, pl = read_mfdb(data)
    ver, count, off = struct.unpack_from("<3I", pl, 0)
    removed = 0
    for k in range(count):
        o = off + k * REC
        x, y, z = struct.unpack_from("<3f", pl, o + 16)
        if y > -50 and (clear or any((x - cx) ** 2 + (z - cz) ** 2 <= r * r for cx, cz, r in remove)):
            struct.pack_into("<f", pl, o + 20, -100.0)
            removed += 1
    add = list(add)
    if not add:
        return write_mfdb(head, fixups, pl), 0, removed

    # 1) registros novos logo depois dos atuais (ponteiros de blueprint preenchidos no fim)
    end = off + count * REC
    blob = bytearray(REC * len(add))
    pl, fixups = insert_bytes(pl, fixups, end, blob)
    # 2) strings dos blueprints: reaproveita as que o arquivo já tem, o resto vai para o fim
    known = {}
    for k in range(count):
        p = struct.unpack_from("<I", pl, off + k * REC + 32)[0]
        e = pl.find(b"\x00", p)
        known.setdefault(bytes(pl[p:e]), p)
    for i, (bp, x, z, yaw, scale) in enumerate(add):
        key = bp.encode("latin1")
        if key not in known:
            while len(pl) % 4:
                pl.append(0)
            known[key] = len(pl)
            pl += key + b"\x00"
        o = end + i * REC
        half = math.radians(yaw) / 2
        y = height(x, z) if height else 0.0
        struct.pack_into("<4f", pl, o, math.cos(half), 0.0, math.sin(half), 0.0)
        struct.pack_into("<3f", pl, o + 16, x, y, z)
        struct.pack_into("<fIfI", pl, o + 28, scale, known[key], 1.0, 0)
        fixups.append(o + 32)
    while len(pl) % 4:
        pl.append(0)
    struct.pack_into("<I", pl, 4, count + len(add))
    return write_mfdb(head, fixups, pl), len(add), removed
