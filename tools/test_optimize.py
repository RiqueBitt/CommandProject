"""Testa o código do mod de otimização (crates/cp-core/src/optimize_ui.lua) num Lua de mentira.

Confere o limite de FPS no começo da partida e o limite menor nas partidas com mais de 8
exércitos (a lista de exércitos aparece um pouco depois da tela da partida). Com CP_OPT_OUT
(pasta com o uimain.lua montado pelo teste `real_game_build` do cp-core) roda no arquivo real.
"""
import os
import re
import sys
from pathlib import Path

from lupa.lua55 import LuaRuntime

ROOT = Path(__file__).resolve().parent.parent
CODE = (ROOT / "crates/cp-core/src/optimize_ui.lua").read_text(encoding="utf-8")

HARNESS = r"""
World = { cmds = {}, armies = nil, threads = {} }
function ConExecute(c) table.insert(World.cmds, c) end
function GetArmiesTable() if World.armies == nil then error('ainda não') end return { armiesTable = World.armies } end
function ForkThread(f) table.insert(World.threads, coroutine.create(f)) end
function WaitSeconds(s) coroutine.yield() end
function Step()
    for i = #World.threads, 1, -1 do
        local co = World.threads[i]
        if coroutine.status(co) ~= 'dead' then
            local ok, err = coroutine.resume(co)
            if not ok then error(err) end
        end
        if coroutine.status(co) == 'dead' then table.remove(World.threads, i) end
    end
end
"""

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

    return re.sub(r"for ([\w, ]+) in (.+?) do\b", fix, code)


def run(code: str, armies: int, label: str, normal: str, big: str):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(HARNESS)
    lua.execute(moho_to_lua(code))
    g = lua.globals()
    g.CPOptimizeStart()
    cmds = lambda: list(g.World.cmds.values())
    check(cmds() == [f"sc_FrameTimeClamp {normal}"], f"{label}: limite das partidas no começo ({cmds()})")
    # a lista de exércitos só aparece depois de alguns quadros
    for _ in range(5):
        g.Step()
    g.World.armies = lua.table_from([lua.table_from({"civilian": False}) for _ in range(armies)] + [lua.table_from({"civilian": True})])
    for _ in range(3):
        g.Step()
    want = [f"sc_FrameTimeClamp {normal}"] + ([f"sc_FrameTimeClamp {big}"] if armies > 8 and big != normal else [])
    check(cmds() == want, f"{label}: {armies} exércitos -> {want[-1]} ({cmds()})")
    check(len(list(g.World.threads.values())) == 0, f"{label}: a espera termina")


def main() -> int:
    code = CODE.replace("{FRAME_MS}", "7").replace("{BIG_FRAME_MS}", "17")
    run(code, 24, "partida grande", "7", "17")
    run(code, 4, "partida normal", "7", "17")
    run(CODE.replace("{FRAME_MS}", "10").replace("{BIG_FRAME_MS}", "10"), 24, "mesmo limite", "10", "10")
    out = os.environ.get("CP_OPT_OUT")
    if out:
        text = (Path(out) / "uimain.lua").read_bytes().decode("latin1")
        check("function StartGameUI()\n    pcall(CPOptimizeStart) -- CommandProject optimize\n" in text, "uimain.lua real: chamada no começo de StartGameUI")
        lua = LuaRuntime()
        ok = lua.eval("function(c) local f, e = load(c) return f ~= nil, e end")(moho_to_lua(text.replace("\r\n", "\n")))
        check(ok[0], f"uimain.lua real: o arquivo montado é Lua válido ({ok[1]})")
    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
