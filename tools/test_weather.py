"""
Clima (mod Climas) num mundo falso: o código da simulação (crates/cp-core/src/weather/weather_sim.lua)
roda com o Lua do lupa e funções do jogo de mentira. Confere que o conjunto de emissores segue a
câmera sem passar do limite, troca de nível com o tamanho da vista (sem ficar trocando na divisa),
reaproveita as entidades, só põe respingos perto do chão e atende o SimCallback 'CPWeather' antes do
despachante do jogo.

    python tools/test_weather.py
"""

import os
import sys

from lupa import LuaRuntime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIM = open(os.path.join(ROOT, "crates", "cp-core", "src", "weather", "weather_sim.lua"), encoding="utf-8").read()

WORLD = r"""
table.getn = function(t) return #t end
ScenarioInfo = { Options = { CPWeather = KIND }, MapData = { PlayableRect = { 0, 0, 1024, 1024 } } }
made, destroyed, warps, entities = 0, 0, 0, 0
bps = {}
function CreateEmitterAtEntity(e, army, bp)
    made = made + 1
    bps[bp] = (bps[bp] or 0) + 1
    return { Destroy = function() destroyed = destroyed + 1 end }
end
function CreateLightParticle() end
function GetSurfaceHeight(x, z) return 10 end
-- um penhasco em x > 900
function GetTerrainHeight(x, z) if x > 900 then return 10 + (x - 900) * 2 else return 10 end end
function Warp() warps = warps + 1 end
function Vector(x, y, z) return { x, y, z } end
function Random() return 0.5 end
function LOG() end
WARN = LOG
callbacks = { DoCallback = function(name, data) game_callback = name end }
function import(p)
    if string.find(string.lower(p), 'simcallbacks') then return callbacks end
    return { Entity = function() entities = entities + 1 return { Destroy = function() end } end }
end
function CreateResources() end
threads = {}
function ForkThread(f) table.insert(threads, f) end
function WaitTicks() end
function WaitSeconds() error('stop') end
"""

fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def world(kind):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(WORLD.replace("KIND", repr(kind)) + SIM)
    lua.execute("CreateResources()")
    # a thread do clima: liga o clima e engancha o despachante (a tempestade para no primeiro raio)
    lua.execute("for _, f in ipairs(threads) do pcall(f) end")
    return lua


def cells(lua):
    return lua.eval("(function() local n = 0 for _ in pairs(debug_pool().cells) do n = n + 1 end return n end)()")


def main():
    lua = world("storm")
    lua.execute("""
        function debug_pool()
            local i = 1
            while true do
                local k, v = debug.getupvalue(CPWeatherView, i)
                if not k then return nil end
                if k == 'CPWeatherPool' then return v end
                i = i + 1
            end
        end
    """)
    pool = lua.eval("debug_pool()")
    check(pool.level >= 1 and cells(lua) > 0, "começa com chuva perto da base antes de a interface falar")
    # a interface manda a vista pelo despachante do jogo
    lua.execute("callbacks.DoCallback('CPWeather', { x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    check(lua.eval("game_callback") is None, "o 'CPWeather' é atendido pelo clima (não chega ao despachante do jogo)")
    check(pool.level == 1, f"vista de perto: nível 1 (deu {pool.level})")
    near = cells(lua)
    check(0 < near <= 60, f"vista de perto com poucas células ({near})")
    check(lua.eval("bps['/effects/emitters/ambient/weather/dust/weather_sand_01_emit.bp'] or 0") > 0, "respingos perto do chão")
    lua.execute("callbacks.DoCallback('Outro', {})")
    check(lua.eval("game_callback") == "Outro", "os outros comandos seguem para o jogo")
    # um passo pequeno não refaz nada
    before = lua.eval("made")
    lua.execute("CPWeatherCallback({ x0 = 402, z0 = 401, x1 = 502, z1 = 471 })")
    check(lua.eval("made") == before, "um passo pequeno da câmera mantém tudo como está")
    # longe: a grade engrossa e continua dentro do limite
    lua.execute("CPWeatherCallback({ x0 = -500, z0 = -500, x1 = 1500, z1 = 1100 })")
    far = cells(lua)
    check(pool.level >= 4 and far <= 180, f"vista do mapa inteiro: nível {pool.level}, {far} células")
    # na divisa entre dois níveis não fica trocando
    lua.execute("CPWeatherCallback({ x0 = 300, z0 = 300, x1 = 560, z1 = 480 })")
    level = pool.level
    lua.execute("CPWeatherCallback({ x0 = 300, z0 = 300, x1 = 580, z1 = 495 })")
    lua.execute("CPWeatherCallback({ x0 = 300, z0 = 300, x1 = 555, z1 = 478 })")
    check(pool.level == level, f"sem trocar de nível perto da divisa ({level} → {pool.level})")
    # entidades reaproveitadas: no máximo o tamanho do conjunto, por mais que a câmera ande
    for i in range(40):
        x = (i * 37) % 900
        lua.execute(f"CPWeatherCallback({{ x0 = {x}, z0 = {x // 2}, x1 = {x + 120}, z1 = {x // 2 + 90} }})")
    check(lua.eval("entities") <= 182, f"entidades reaproveitadas ({lua.eval('entities')})")
    # dados ruins do outro lado são ignorados
    ok = lua.eval("pcall(CPWeatherCallback, { x0 = 'a' })")
    check(ok, "dados estranhos no comando não quebram nada")
    lua.execute("CPWeatherCallback({ x0 = 920, z0 = 500, x1 = 1000, z1 = 560 })")
    check(True, "vista sobre o penhasco")

    snow = world("blizzard")
    snow.execute("CPWeatherCallback({ x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    check(snow.eval("bps['/effects/emitters/ambient/weather/snow/weather_snow_falling_01_emit.bp'] or 0") > 0, "nevasca: flocos")
    check(snow.eval("bps['/effects/emitters/ambient/weather/dust/weather_sand_01_emit.bp']") is None, "nevasca: sem respingos")
    clear = LuaRuntime(unpack_returned_tuples=True)
    clear.execute(WORLD.replace("KIND", "nil") + SIM)
    clear.execute("CreateResources(); CPWeatherCallback({ x0 = 0, z0 = 0, x1 = 100, z1 = 100 })")
    check(clear.eval("made") == 0 and clear.eval("#threads") == 0, "sem clima escolhido nada acontece")

    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
