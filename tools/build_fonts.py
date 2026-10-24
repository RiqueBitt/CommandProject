"""Uso: python tools/build_fonts.py <Roboto estática.ttf> <saída.ttf>

Gera Roboto compatível com o carregador de fontes do SC2 (GDI): kern clássico, post 2,
cmap Mac + Windows, UPM 1000, sem tabelas OpenType de layout."""
import sys
from fontTools.ttLib import TTFont, newTable
from fontTools.ttLib.tables._k_e_r_n import KernTable_format_0
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable
from fontTools.ttLib.scaleUpem import scale_upem
from fontTools import subset

SRC = sys.argv[1]; OUT = sys.argv[2]
unicodes = list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + [0x2013, 0x2014, 0x2018, 0x2019, 0x201A, 0x201C, 0x201D, 0x201E, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203A, 0x20AC, 0x2122, 0x2212]

f = TTFont(SRC)
opts = subset.Options(); opts.layout_features = ["kern"]; opts.name_IDs = ["*"]; opts.notdef_outline = True; opts.glyph_names = True
opts.hinting = True; opts.recalc_bounds = True; opts.drop_tables += ["STAT", "DSIG"]
sub = subset.Subsetter(opts); sub.populate(unicodes=unicodes); sub.subset(f)

# pares de kerning do GPOS (PairPos formato 1 e 2) → kern formato 0
pairs = {}
cmap = f.getBestCmap(); glyphs = set(cmap.values())
gpos = f["GPOS"].table if "GPOS" in f else None
def val(v):
    return getattr(v, "XAdvance", 0) or 0 if v is not None else 0
if gpos:
    for li, lookup in enumerate(gpos.LookupList.Lookup):
        for st in lookup.SubTable:
            st = getattr(st, "ExtSubTable", st)
            if getattr(st, "LookupType", None) not in (None, 2) or not hasattr(st, "Format") or not hasattr(st, "Coverage"):
                continue
            if lookup.LookupType not in (2, 9):
                continue
            cov = st.Coverage.glyphs
            if st.Format == 1:
                for i, g1 in enumerate(cov):
                    for pvr in st.PairSet[i].PairValueRecord:
                        x = val(pvr.Value1)
                        if x and g1 in glyphs and pvr.SecondGlyph in glyphs:
                            pairs.setdefault((g1, pvr.SecondGlyph), x)
            elif st.Format == 2:
                c1 = st.ClassDef1.classDefs; c2 = st.ClassDef2.classDefs
                for g1 in cov:
                    if g1 not in glyphs: continue
                    k1 = c1.get(g1, 0)
                    rec = st.Class1Record[k1]
                    for g2 in glyphs:
                        k2 = c2.get(g2, 0)
                        x = val(rec.Class2Record[k2].Value1)
                        if x:
                            pairs.setdefault((g1, g2), x)
# só pares entre caracteres latinos comuns, maiores ajustes primeiro (limite de 64 KB do kern)
pairs = dict(sorted(pairs.items(), key=lambda kv: -abs(kv[1]))[:10000])
kern = newTable("kern"); kern.version = 0
t = KernTable_format_0(); t.coverage = 1; t.format = 0; t.kernTable = pairs; t.version = 0
kern.kernTables = [t]
f["kern"] = kern
for tag in ("GPOS", "GSUB", "GDEF"):
    if tag in f: del f[tag]

# cmap: Windows Unicode BMP (3,1,4) + Mac Roman (1,0,0), como as fontes originais do jogo
win = [t for t in f["cmap"].tables if t.platformID == 3 and t.platEncID == 1][0]
mac = CmapSubtable.newSubtable(6); mac.platformID = 1; mac.platEncID = 0; mac.language = 0
mac_map = {}
for code in range(256):
    try:
        ch = bytes([code]).decode("mac_roman")
    except Exception:
        continue
    g = win.cmap.get(ord(ch))
    if g: mac_map[code] = g
mac.cmap = mac_map
f["cmap"].tables = [mac, win]

f["post"].formatType = 2.0; f["post"].mapping = {}; f["post"].extraNames = []
# scale_upem(f, 1000)  (mantém 2048: escalar quebrava o hinting)
f.save(OUT)
g = TTFont(OUT)
print(OUT, "glyphs", len(g.getGlyphOrder()), "kern pairs", len(g["kern"].kernTables[0].kernTable), "upm", g["head"].unitsPerEm, sorted(g.keys()))
