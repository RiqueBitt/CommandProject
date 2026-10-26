"""Testa a partida grande (crates/cp-core/src/bigmatch.lua) num Lua de mentira com as funções do jogo.

Monta a partida como o jogo faria com  /map <cenário> /cpmatch <vagas>  e confere times, facções,
IA, opções e a ordem dos jogadores. Com CP_BIG_OUT (pasta com os SinglePlayerLaunch.lua e
GameSessionManager.lua montados pelo teste `real_game_files` do cp-core) roda também nos arquivos
de verdade do jogo.
"""
import os
import re
import sys
from pathlib import Path

from lupa.lua55 import LuaRuntime

ROOT = Path(__file__).resolve().parent.parent
CODE = (ROOT / "crates/cp-core/src/bigmatch.lua").read_text(encoding="utf-8")
HOOK = "\tif CPBigMatchStart and CPBigMatchStart(mapName) then return end -- CommandProject big match\n"
ENTRY = "function StartCommandLineSession(mapName, isPerfTest)\n"

FAKE_GAME_FILE = r"""
local Prefs = import('/lua/user/prefs.lua')
local MapUtils = import('/lua/ui/maputil.lua')
function GetRandomName(faction, aiKey) return 'IA' .. faction .. ' (' .. tostring(aiKey) .. ')' end
function GetRandomFaction() return 2 end
function VerifyScenarioConfiguration(s) if not s.Configurations then error('sem configuração') end end
function FixupMapName(m) return m end
local defaultOptions = { FogOfWar = 'explored', UnitCap = '500', Victory = 'sandbox', CheatsEnabled = 'true', GameSpeed = 'normal', DoNotShareUnitCap = true }
function StartCommandLineSession(mapName, isPerfTest)
    World.normal = true
    LaunchSinglePlayerSession({ normal = true })
end
"""

HARNESS = r"""
table.getn = table.getn or function(t) return #t end
math.mod = math.mod or math.fmod
function table.copy(t) local o = {} for k, v in pairs(t) do o[k] = v end return o end
World = { args = {}, launched = false, warn = false, prefs = { Name = 'Rique' } }
function HasCommandLineArg(a) return World.args[a] ~= nil end
function GetCommandLineArg(a, n) return World.args[a] end
function LaunchSinglePlayerSession(info) World.launched = info end
function WARN(s) World.warn = (World.warn or '') .. tostring(s) end
function LOG() end
function UseGamepad() return false end
function LOC(s) return s end
local armies = {}
for i = 1, 24 do armies[i] = 'ARMY_' .. i end
World.scenario = { type = 'cp_bigmatch', Configurations = { standard = { teams = { { name = 'FFA', armies = armies } } } } }
local modules = {
    ['/lua/user/prefs.lua'] = { GetFromCurrentProfile = function(k) return World.prefs[k] end, SetToCurrentProfile = function(k, v) World.prefs[k] = v end },
    ['/lua/ui/maputil.lua'] = { LoadScenario = function(m) if m == '/maps/nada/nada_scenario.lua' then return nil end World.loaded = m return World.scenario end,
                               GetExtraArmies = function() return { 'ARMY_EXTRA' } end },
    ['/lua/system/mods.lua'] = { GetCampaignMods = function() return {} end, GetOfficialDLCModForSession = function() return { { uid = 'dlc' } } end },
    ['/lua/common/factions.lua'] = { Factions = { { Key = 'uef' }, { Key = 'cybran' }, { Key = 'illuminate' } } },
    ['/lua/ui/lobby/ainames.lua'] = { ainames = { uef = { 'Hall' }, cybran = { 'Gauge' }, illuminate = { 'Thalia' } } },
    ['/lua/ui/lobby/aitypes.lua'] = { aitypes = { { key = 'Easy', name = 'AI: Easy' }, { key = 'Normal', name = 'AI: Normal' }, { key = 'Hard', name = 'AI: Hard' }, { key = 'Cheat', name = 'AI: Cheating' } } },
    ['/lua/common/gameColors.lua'] = { GameColors = { PlayerColors = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24 } } },
    ['/lua/ui/lobby/lobbyComm.lua'] = { GetDefaultPlayerOptions = function(name)
        return { Team = 1, PlayerColor = 1, ArmyColor = 1, StartSpot = 1, Faction = 4, PlayerName = name, AIPersonality = '', Human = true, Civilian = false } end },
}
function import(p) return modules[p] or {} end
"""


def moho_to_lua(code: str) -> str:
    code = code.replace("!=", "~=")
    code = re.sub(r"\bcontinue\b", "local _c = 0", code)

    def fix(m):
        names, expr = m.group(1), m.group(2).strip()
        if expr.startswith(("ipairs(", "pairs(")):
            return m.group(0)
        return f"for {names} in pairs({expr}) do"

    return re.sub(r"for ([\w, ]+) in (.+?) do\b", fix, code)


def patch(text: str) -> str:
    at = text.index(ENTRY) + len(ENTRY)
    return text[:at] + HOOK + text[at:] + "\n" + CODE


fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def run(source: str, label: str, real: bool):
    def session(spec, map_name="/maps/big/big_scenario.lua", bases=24):
        lua = LuaRuntime(unpack_returned_tuples=True)
        lua.execute(HARNESS)
        lua.execute(moho_to_lua(source))
        g = lua.globals()
        if bases != 24:
            lua.execute(f"for i = 25, {bases} do World.scenario.Configurations.standard.teams[1].armies[i] = 'ARMY_' .. i end")
        if spec is not None:
            g.World.args = lua.table_from({"/cpmatch": lua.table_from([spec])})
        g.StartCommandLineSession(map_name, False)
        return g, g.World.launched

    # 12 contra 12: você no time 1 (vaga 1), IAs nos times 1 e 2
    # cores por time: time 1 = cor 0, time 2 = cor 1 (o jogo conta a cor a partir de 0)
    slots = ["H,2,1,,0"] + ["A,2,0,Hard,0"] * 11 + ["A,3,3,Cheat,1"] * 12
    spec = "Victory=domination;UnitCap=1000;FogOfWar=none;GameSpeed=normal;NoRushOption=5;PreBuiltUnits=Off;CivilianAlliance=enemy|" + "|".join(slots)
    g, info = session(spec)
    check(info and not info["normal"], f"{label}: a partida grande assume o começo da partida ({g.World.warn})")
    if not info:
        return
    teams = list(info.teamInfo.values())
    players = [p for p in teams if not p.Civilian]
    check(len(players) == 24, f"{label}: 24 jogadores ({len(players)})")
    check(teams[0].Human and teams[0].PlayerName == "Rique" and teams[0].ArmyName == "ARMY_1" and teams[0].Faction == 1,
          f"{label}: você primeiro, com o seu nome, base e facção")
    t2 = [p for p in players if p.Team == 2]
    t3 = [p for p in players if p.Team == 3]
    check(len(t2) == 12 and len(t3) == 12, f"{label}: dois times de 12 ({len(t2)} x {len(t3)})")
    check(all(p.AIPersonality == "Cheat" and p.Faction == 3 for p in t3), f"{label}: IA e facção de cada vaga")
    check(all(p.PlayerColor == (0 if p.Team == 2 else 1) for p in players), f"{label}: cor de cada time (a partir de 0, como o jogo lê)")
    check(info.scenarioInfo.type == "skirmish", f"{label}: mapa grande vira escaramuça normal na partida")
    check(len({p.ArmyName for p in players}) == 24, f"{label}: cada jogador numa base diferente")
    check(teams[-1].Civilian and teams[-1].ArmyName == "ARMY_EXTRA", f"{label}: civis do mapa continuam")
    o = info.scenarioInfo.Options
    check(o.Victory == "domination" and o.UnitCap == "1000" and o.FogOfWar == "none" and o.NoRushOption == "5"
          and o.CheatsEnabled == "false" and o.TeamLock == "locked", f"{label}: opções da partida")
    check(g.World.prefs.LoadingFaction == 1, f"{label}: tela de carregamento com a sua facção")
    check(len(list(info.scenarioMods.values())) == 1 and list(info.scenarioMods.values())[0].uid == "dlc", f"{label}: partida com o mod oficial da expansão, como o lobby do jogo")
    check(o.PreBuiltUnits == "Off" and o.TeamSpawn == "fixed" and o.AllowObservers is False, f"{label}: opções iguais às do lobby do jogo")
    check(len(list(o.RestrictedCategories.values())) == 0 and o.DoNotShareUnitCap is True, f"{label}: sem restrições e limite que não passa para o time")

    # restrições, trapaças do jogo, limite dividido e base montada (as duas grafias)
    g, info = session("Victory=sandbox;CheatsEnabled=true;DoNotShareUnitCap=false;PreBuiltUnits=On;PrebuiltUnits=On;"
                      "RestrictedCategories=AIR,NUKE,ALL_RESEARCH|H,1,1,,|A,1,0,Normal," + "|X" * 22)
    o = info.scenarioInfo.Options
    check(list(o.RestrictedCategories.values()) == ["AIR", "NUKE", "ALL_RESEARCH"], f"{label}: restrições viram uma lista ({list(o.RestrictedCategories.values())})")
    check(o.DoNotShareUnitCap is False and o.CheatsEnabled == "true", f"{label}: limite dividido e trapaças do jogo")
    check(o.PreBuiltUnits == "On" and o.PrebuiltUnits == "On", f"{label}: base montada nas duas grafias")

    # 32 jogadores: o motor guarda os exércitos em máscaras de 32 bits, os civis ficam de fora
    full = "Victory=demoralization|H,2,0,," + "|A,3,0,Normal," * 31
    g, info = session(full, bases=32)
    teams = list(info.teamInfo.values()) if info else []
    check(info and not info["normal"] and len(teams) == 32 and not any(p.Civilian for p in teams),
          f"{label}: 32 jogadores sem os civis ({len(teams)} exércitos)")
    check(g.World.warn and "civilian" in g.World.warn, f"{label}: aviso no log quando os civis ficam de fora")
    g, info = session("Victory=demoralization|H,2,0,," + "|A,3,0,Normal," * 30 + "|X", bases=32)
    teams = list(info.teamInfo.values())
    check(len(teams) == 32 and teams[-1].Civilian, f"{label}: 31 jogadores e os civis cabem nos 32 exércitos")

    # vagas vazias e você no meio
    g, info = session("Victory=demoralization|A,1,0,Easy|X|H,1,2,|X|A,1,0,Normal" + "|X" * 19)
    players = [p for p in info.teamInfo.values() if not p.Civilian]
    check(len(players) == 3 and players[0].Human and players[0].ArmyName == "ARMY_3",
          f"{label}: vagas vazias ficam de fora e você pode estar em qualquer base")
    check(players[1].ArmyName == "ARMY_1" and players[1].Team == 1 and players[1].AIPersonality == "Easy", f"{label}: todos contra todos")

    # sem /cpmatch: o jogo segue como sempre
    if real:
        lua = LuaRuntime(unpack_returned_tuples=True)
        lua.execute(HARNESS)
        lua.execute(moho_to_lua(source))
        check(lua.globals().CPBigMatchStart("/maps/big/big_scenario.lua") is False, f"{label}: sem /cpmatch o jogo começa como sempre")
    else:
        g, info = session(None)
        check(info is not None and info["normal"], f"{label}: sem /cpmatch o jogo começa como sempre")
    # erro (mapa que não existe): volta para o caminho normal do jogo
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(HARNESS)
    lua.execute(moho_to_lua(source))
    g = lua.globals()
    g.World.args = lua.table_from({"/cpmatch": lua.table_from(["Victory=demoralization|H,1,0,|A,1,0,Normal"])})
    back = g.CPBigMatchStart("/maps/nada/nada_scenario.lua")
    check(back is False and g.World.warn and "big match" in g.World.warn, f"{label}: erro vira aviso no log e o jogo segue")


COLORS_CODE = (ROOT / "crates/cp-core/src/bigmatch_colors.lua").read_text(encoding="utf-8")
FAKE_COLORS = """
GameColors = {
    PlayerColors = { 'a', 'b' }, SecondaryPlayerColors = { 'c', 'd' }, ArmyColors = { 'a', 'b' },
    FactionColors = { { { primary = 'a' }, { primary = 'b' } }, { { primary = 'a' }, { primary = 'b' } }, { { primary = 'a' }, { primary = 'b' } } },
}
"""


def colors(source: str, label: str):
    # o motor lê o GameColors.lua num Lua "pelado" (sem pcall, sem table, sem funções do jogo):
    # o arquivo precisa carregar ali sem chamar nenhuma função
    lua = LuaRuntime(unpack_returned_tuples=True)
    bare = lua.eval("function(code) local env = {} local f, e = load(code, 'GameColors', 't', env) "
                    "if not f then return false, e end local ok, err = pcall(f) return ok, err, env end")
    ok, err, env = bare(moho_to_lua(source))
    check(ok, f"{label}: carrega num Lua sem funções, como o motor lê ({err})")
    if not ok:
        return
    gc = env.GameColors
    n = len(list(gc.PlayerColors.values()))
    per = [len(list(f.values())) for f in gc.FactionColors.values()]
    base = 10 if "FF152142" in source else 2
    check(n == base + 22 and all(p == base + 22 for p in per) and len(list(gc.ArmyColors.values())) == base + 22
          and len(list(gc.SecondaryPlayerColors.values())) == base + 22, f"{label}: 22 cores a mais ({n})")
    last = list(gc.FactionColors.values())[0][base + 22]
    check(last.ui_flag.endswith(".dds") and last.icon.startswith("FF"), f"{label}: cores novas com bandeira e ícone")
    if "CivilianArmyColor" in source:
        check(gc.CivilianArmyColor == "BurlyWood", f"{label}: cor dos civis continua")


def main() -> int:
    run(patch(FAKE_GAME_FILE), "modelo", real=False)
    colors(FAKE_COLORS + COLORS_CODE, "cores (modelo)")
    out = os.environ.get("CP_BIG_OUT")
    if out:
        for name in ("SinglePlayerLaunch.lua", "GameSessionManager.lua"):
            text = (Path(out) / "lua" / name).read_bytes().decode("latin1")
            run(text, name, real=True)
        colors((Path(out) / "lua/common/GameColors.lua").read_bytes().decode("latin1"), "GameColors.lua")
    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
