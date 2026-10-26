"""Testa o jogo em português: roda o Localization.lua montado (CP_LANG_OUT, do teste real_game_build
do cp-core) num Lua com as funções do jogo e confere que os textos <LOC chave> vêm em português,
que chave sem tradução mostra o texto original e que {g ...}/{i ...} continuam funcionando.

Também confere a tradução (crates/cp-core/src/loc/pt_br.json): marcadores <...>, {...} e %s/%d
iguais aos do texto original quando ele estiver disponível (CP_LOC_US = us_utf8.json com o original).
"""
import json
import os
import re
import sys
from pathlib import Path

from lupa.lua55 import LuaRuntime

ROOT = Path(__file__).resolve().parent.parent
fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def moho_to_lua(code: str) -> str:
    code = code.replace("!=", "~=")

    def fix(m):
        names, expr = m.group(1), m.group(2).strip()
        if expr.startswith(("ipairs(", "pairs(")):
            return m.group(0)
        return f"for {names} in pairs({expr}) do"

    code = re.sub(r"for ([\w, ]+) in (.+?) do\b", fix, code)
    # o Lua 5.1 do jogo deixa arg/table.getn; aqui no 5.5 fazemos o mínimo
    return code


WORLD = r"""
table.getn = table.getn or function(t) return #t end
function HasCommandLineArg() return false end
function GetCommandLineArg() return {} end
function DiskFindFiles() return { '/loc/us/strings_db.lua' } end
function IsXbox() return false end
function exists(p) return p == '/loc/us/strings_db.lua' end
function UISetMovieSubtitleChannel() end
function UISetLanguageId() end
function UISetEnableWhitespaceWordWrap() end
function UISetMovieAudioTrack() end
function SetLocalizedFEV() end
function HasLocalizedVO() return false end
function AudioSetLanguage() end
function SetPreference() end
function WARN() end
function _TRACEBACK(a, b) return tostring(a) .. tostring(b) end
function iscallable(f) return type(f) == 'function' end
function doscript() error('não deveria ler outro idioma') end
__language = 'us'
"""


def main() -> int:
    pt = json.loads((ROOT / "crates/cp-core/src/loc/pt_br.json").read_text(encoding="utf-8"))
    check(len(pt) > 0, f"tradução com {len(pt)} textos")
    us_path = os.environ.get("CP_LOC_US")
    if us_path:
        us = json.loads(Path(us_path).read_text(encoding="utf-8"))
        pat = re.compile(r"<[^<>]*>|\{[^{}]*\}|%[-+ #0]*\d*(?:\.\d+)?[sdif%]|%\d")
        bad = [k for k, v in pt.items() if k in us and sorted(pat.findall(us[k])) != sorted(pat.findall(v))]
        check(not bad, f"marcadores iguais ao original ({len(bad)} diferentes: {bad[:5]})")
        check(all(k in us for k in pt), "toda chave traduzida existe no jogo")
        # fora da conta: textos de teste dos desenvolvedores e nomes próprios iguais nas duas línguas
        real = [k for k in us if not k.startswith("DEVTEST_") and re.search(r"[a-z]{3}", us[k])]
        cover = sum(1 for k in real if k in pt) / max(1, len(real))
        check(cover > 0.85, f"cobertura da tabela do jogo: {cover:.1%} ({len(real)} textos de verdade)")

    out = os.environ.get("CP_LANG_OUT")
    if out:
        text = (Path(out) / "Localization.lua").read_text(encoding="utf-8")
        lua = LuaRuntime(unpack_returned_tuples=True)
        lua.execute(WORLD)
        lua.execute(moho_to_lua(text))
        g = lua.globals()
        key, value = next(iter(sorted(pt.items())))
        check(g.LOC(f"<LOC {key}>Original") == value.replace("{g PlayerName}", "Player") or "{" in value, f"LOC({key}) vem em português")
        check(g.LOC("<LOC CHAVE_QUE_NAO_EXISTE>Texto original") == "Texto original", "chave sem tradução mostra o texto original")
        check(g.LOC("sem tag {g PlayerName}") == "sem tag Player", "{g ...} continua funcionando")
        some = [k for k, v in pt.items() if "{" not in v][:200]
        okc = sum(1 for k in some if g.LOC(f"<LOC {k}>x") == pt[k])
        check(okc == len(some), f"{okc}/{len(some)} textos conferidos pelo LOC do jogo")
        g.language("us")
        check(g.LOC(f"<LOC {some[0]}>x") == pt[some[0]], "trocar o idioma no jogo mantém o português")
    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
