"""
Confere o mapeamento de `bundle.resources` do tauri.conf.json.

No Tauri 2, uma chave com glob copia cada arquivo encontrado direto para a pasta de destino
(achatando subpastas). Isso já quebrou os presets de shaders (presets/Natural.ini virou
Natural.ini). Este teste falha se algum glob pegar arquivos em subpastas.

    python tools/check_resources.py
"""

import glob
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAURI = os.path.join(ROOT, "src-tauri")


def main():
    conf = json.load(open(os.path.join(TAURI, "tauri.conf.json"), encoding="utf-8"))
    resources = conf["bundle"]["resources"]
    bad = []
    targets = {}
    for pattern, dest in resources.items():
        if "*" not in pattern:
            continue
        base = pattern.split("*", 1)[0]
        for path in glob.glob(os.path.join(TAURI, pattern), recursive=False):
            if os.path.isdir(path):
                continue
            rel = os.path.relpath(path, os.path.join(TAURI, base))
            if os.sep in rel or "/" in rel:
                bad.append(f"{pattern}: {rel} seria achatado em {dest}")
            target = dest.rstrip("/") + "/" + os.path.basename(path)
            if target in targets:
                bad.append(f"{target} vem de dois lugares: {targets[target]} e {path}")
            targets[target] = path
    # o pacote de shaders precisa dos presets em shaders/presets/
    for name in ("Natural", "Vivido", "Cinematico", "Desligado"):
        if f"shaders/presets/{name}.ini" not in targets:
            bad.append(f"shaders/presets/{name}.ini não entra no instalador")
    for name in ("Roboto-Bold.ttf", "Roboto-Medium.ttf", "OFL.txt"):
        if f"fonts/{name}" not in targets:
            bad.append(f"fonts/{name} não entra no instalador")
    if bad:
        print("\n".join(bad))
        return 1
    print(f"recursos ok: {len(targets)} arquivos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
