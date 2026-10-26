"""Confere as traduções da interface.

- toda chamada t("texto") / t('texto') / t(`texto`) precisa ter o texto em src/i18n/en/*.json;
- avisa textos em português que parecem visíveis e ficaram sem t() (heurística: JSX e títulos).

Uso: python3 tools/i18n_check.py [arquivos...]   (sem argumentos: todo o src)
Sai com erro se faltar tradução.
"""
import glob
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN = {}
for f in sorted(glob.glob(str(ROOT / "src/i18n/en/*.json"))):
    EN.update(json.loads(Path(f).read_text(encoding="utf-8")))

CALL = re.compile(r"""\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\$]|\\.)*)`)""")
PT = re.compile(r"[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]|\b(?:não|para|com|uma|você|seu|sua|dos|das|está|são)\b", re.I)
JSX_TEXT = re.compile(r">\s*([^<>{}\n]*[A-Za-zÀ-ú]{2,}[^<>{}\n]*?)\s*<")
ATTR = re.compile(r"""\b(?:title|placeholder|aria-label|label|alt)=\s*"([^"]*[A-Za-zÀ-ú]{2,}[^"]*)\"""")


def unescape(s: str) -> str:
    return json.loads('"' + s.replace('"', '\\"').replace("\\'", "'").replace("\\`", "`") + '"') if "\\" in s else s


files = sys.argv[1:] or [f for f in glob.glob(str(ROOT / "src/**/*.ts*"), recursive=True) if not f.endswith(("mock.ts", ".d.ts", "i18n.ts"))]
missing = 0
loose = 0
for f in files:
    text = Path(f).read_text(encoding="utf-8")
    for m in CALL.finditer(text):
        s = unescape(next(g for g in m.groups() if g is not None))
        if s not in EN:
            missing += 1
            print(f"FALTA  {Path(f).relative_to(ROOT)}: {s!r}")
    for rx in (JSX_TEXT, ATTR):
        for m in rx.finditer(text):
            s = m.group(1).strip()
            if PT.search(s):
                loose += 1
                print(f"SOLTO  {Path(f).relative_to(ROOT)}: {s[:90]!r}")
print(f"\nfaltando no inglês: {missing} · textos em português sem t(): {loose}")
sys.exit(1 if missing else 0)
