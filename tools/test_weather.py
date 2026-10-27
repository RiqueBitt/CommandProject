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
math.mod = math.fmod
function GetGameTimeSeconds() return 0 end
ScenarioInfo = { name = 'Mapa', Options = { CPWeather = KIND, CPWeatherDynamic = DYNAMIC }, MapData = { PlayableRect = { 0, 0, 1024, 1024 } } }
made, destroyed, warps, entities, stopped = 0, 0, 0, 0, 0
ambient = {}
SOURCE = 1
function GetCurrentCommandSource() return SOURCE end
CPWeatherSounds = { wind = 'SC2/SC2/Environments/X/snd_X_Skyhigh', water = 'SC2/SC2/Environments/X/snd_X_Generic_Ocean' }
bps = {}
live = {}
function CreateEmitterAtEntity(e, army, bp)
    made = made + 1
    bps[bp] = (bps[bp] or 0) + 1
    local fx = { bp = bp, rate = 'base' }
    fx.Destroy = function() destroyed = destroyed + 1 live[fx] = nil end
    fx.OffsetEmitter = function(self, x, y, z) fx.offset = { x, y, z } end
    fx.SetEmitterCurveParam = function(self, name, v, r)
        if name == 'EMITRATE_CURVE' then
            fx.rate = v
            if v == 0 then stopped = stopped + 1 end
        end
    end
    live[fx] = true
    return fx
end
-- rates of the live emitters (all different values, as text)
function rates()
    local seen, out = {}, {}
    for fx in pairs(live) do
        local k = string.format('%s=%s', fx.bp, tostring(fx.rate))
        if not seen[k] then seen[k] = true table.insert(out, k) end
    end
    table.sort(out)
    return table.concat(out, ';')
end
function CreateLightParticle() end
-- um penhasco em x > 900
function GetTerrainHeight(x, z) if x > 900 then return 10 + (x - 900) * 2 else return 10 end end
function GetSurfaceHeight(x, z) return GetTerrainHeight(x, z) end
function Warp() warps = warps + 1 end
function Vector(x, y, z) return { x, y, z } end
function Random() return 0.5 end
function LOG() end
WARN = LOG
callbacks = { DoCallback = function(name, data) game_callback = name end }
function import(p)
    if string.find(string.lower(p), 'simcallbacks') then return callbacks end
    return { Entity = function() entities = entities + 1 return { Destroy = function() end, SetAmbientSound = function(self, ev) ambient[ev or 'nil'] = (ambient[ev or 'nil'] or 0) + 1 end } end }
end
function CreateResources() end
threads = {}
function ForkThread(f) table.insert(threads, f) end
function WaitTicks() end
function WaitSeconds() local _, main = coroutine.running() if main then error('stop') end coroutine.yield() end
"""

fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


RATES = """local CPWeatherRates = {
    ['/effects/emitters/ambient/weather/rain/weather_rainfall_01_emit.bp'] = 10,
    ['/effects/emitters/ambient/weather/clouds/weather_stratus_16_emit.bp'] = 6,
    ['/effects/emitters/ambient/weather/dust/weather_sand_01_emit.bp'] = 20,
    ['/effects/emitters/ambient/weather/dust/weather_redrock_01_emit.bp'] = 8,
}
"""


def world(kind, dynamic=False):
    lua = LuaRuntime(unpack_returned_tuples=True)
    assert "local CPWeatherRates = {}\n" in SIM
    lua.execute(WORLD.replace("KIND", repr(kind)).replace("DYNAMIC", "'1'" if dynamic else "nil") + SIM.replace("local CPWeatherRates = {}\n", RATES))
    lua.execute("CreateResources()")
    # a thread do clima: liga o clima e engancha o despachante (a tempestade para no primeiro raio)
    lua.execute("for _, f in ipairs(threads) do pcall(f) end")
    return lua


def full(lua):
    """como depois do primeiro minuto: as duas camadas caindo inteiras"""
    lua.execute("""
        local function up(f, name)
            local i = 1
            while true do
                local k, v = debug.getupvalue(f, i)
                if not k then return nil end
                if k == name then return v end
                i = i + 1
            end
        end
        local layers = up(up(CPWeatherView, 'CPWeatherFill'), 'CPWeatherLayers')
        local share = up(up(layers, 'CPWeatherSetRate'), 'CPWeatherShare')
        share.main = 1
        share.extra = 1
        local set = up(layers, 'CPWeatherSetRate')
        for _, cell in pairs(up(CPWeatherView, 'CPWeatherPool').cells) do
            for _, entry in ipairs(cell.fx) do set(entry) end
        end
    """)


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
    check(pool.level >= 1 and cells(lua) > 0, "começa com células perto da base antes de a interface falar")
    r0 = lua.eval("rates()")
    check(lua.eval("made") > 0 and "rainfall_01_emit.bp=0;" in r0 + ";" and "=10" not in r0, f"no começo ainda não chove (a chuva começa fraca): {r0[:160]}")
    main, extra = lua.eval("CPWeatherIntensity(0)")
    m30, _ = lua.eval("CPWeatherIntensity(30)")
    m90, e90 = lua.eval("CPWeatherIntensity(90)")
    check(main == 0 and extra == 0 and 0 < m30 < 1 and m90 == 1 and 0 <= e90 <= 1, "a chuva engrossa no primeiro minuto")
    waves = [lua.eval(f"select(2, CPWeatherIntensity({t}))") for t in range(120, 1200, 37)]
    check(max(waves) - min(waves) > 0.3, "a camada extra vai e volta com o tempo")
    full(lua)
    # a interface manda a vista pelo despachante do jogo
    lua.execute("callbacks.DoCallback('CPWeather', { x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    check(lua.eval("game_callback") is None, "o 'CPWeather' é atendido pelo clima (não chega ao despachante do jogo)")
    check(pool.level == 1, f"vista de perto: nível 1 (deu {pool.level})")
    near = cells(lua)
    check(0 < near <= 60, f"vista de perto com poucas células ({near})")
    check(lua.eval("bps['/effects/emitters/ambient/weather/dust/weather_sand_01_emit.bp'] or 0") > 0, "respingos perto do chão")
    r1 = lua.eval("rates()")
    check(r1 == "/effects/emitters/ambient/weather/clouds/weather_stratus_16_emit.bp=6;/effects/emitters/ambient/weather/dust/weather_redrock_01_emit.bp=2.0;"
          "/effects/emitters/ambient/weather/dust/weather_sand_01_emit.bp=5.0;/effects/emitters/ambient/weather/rain/weather_rainfall_01_emit.bp=10",
          f"todas as células com a mesma quantidade de gotas e de respingos (sem quadrados): {r1}")
    lua.execute("callbacks.DoCallback('Outro', {})")
    check(lua.eval("game_callback") == "Outro", "os outros comandos seguem para o jogo")
    # um passo pequeno não refaz nada
    before = lua.eval("made")
    lua.execute("CPWeatherCallback({ x0 = 402, z0 = 401, x1 = 502, z1 = 471 })")
    check(lua.eval("made") == before, "um passo pequeno da câmera mantém tudo como está")
    # longe: a grade engrossa e continua dentro do limite
    d0, s0 = lua.eval("destroyed"), lua.eval("stopped")
    lua.execute("CPWeatherCallback({ x0 = -500, z0 = -500, x1 = 1500, z1 = 1100 })")
    far = cells(lua)
    check(pool.level >= 4 and far <= 180, f"vista do mapa inteiro: nível {pool.level}, {far} células")
    # trocando de nível a chuva de antes termina de cair enquanto a nova chega (a tela não fica vazia)
    check(lua.eval("destroyed") == d0 and lua.eval("stopped") > s0 and pool.retired and len(list(pool.retired.cells.values())) == near,
          "ao trocar de nível as células antigas param de soltar gotas e terminam de chover")
    # outra troca logo depois: só um nível termina de chover por vez
    lua.execute("CPWeatherCallback({ x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    check(lua.eval("destroyed") > d0 and len(list(pool.retired.cells.values())) == far, "trocas seguidas não acumulam células terminando de chover")
    # o ceifador tira o que já terminou de cair
    lua.execute("reap = coroutine.wrap(CPWeatherReaper) for i = 1, 8 do reap() end")
    check(not pool.retired and len(list(pool.spare.values())) >= far, "depois de cair, as células antigas voltam para a reserva")
    lua.execute("callbacks.DoCallback('CPWeather', { x0 = -500, z0 = -500, x1 = 1500, z1 = 1100 })")
    far = cells(lua)
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
    check(lua.eval("entities") <= 362, f"entidades reaproveitadas ({lua.eval('entities')})")
    # dados ruins do outro lado são ignorados
    ok = lua.eval("pcall(CPWeatherCallback, { x0 = 'a' })")
    check(ok, "dados estranhos no comando não quebram nada")
    # respingos: quatro por célula, cada um na altura do seu pedaço de chão; nenhum no penhasco
    sand = "'/effects/emitters/ambient/weather/dust/weather_sand_01_emit.bp'"
    lua.execute("CPWeatherCallback({ x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    quarters = lua.eval(f"(function() local n, off = 0, 0 for fx in pairs(live) do if fx.bp == {sand} then n = n + 1 if fx.offset and math.abs(fx.offset[1]) == 5 then off = off + 1 end end end return n .. ',' .. off end)()")
    n, off = map(int, quarters.split(","))
    check(n == 4 * cells(lua) and off == n, f"respingos em quatro pedaços por célula ({n} emissores, {off} deslocados, {cells(lua)} células)")
    lua.execute("CPWeatherCallback({ x0 = 905, z0 = 500, x1 = 1000, z1 = 560 })")
    onCliff = lua.eval(f"(function() local n = 0 for fx in pairs(live) do if fx.bp == {sand} then n = n + 1 end end return n end)()")
    check(onCliff < 4 * cells(lua), f"vista sobre o penhasco: sem respingos na encosta ({onCliff} de {4 * cells(lua)})")

    snow = world("blizzard")
    full(snow)
    snow.execute("CPWeatherCallback({ x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    check(snow.eval("bps['/effects/emitters/ambient/weather/snow/weather_snow_falling_01_emit.bp'] or 0") > 0, "nevasca: flocos")
    check(snow.eval("bps['/effects/emitters/ambient/weather/dust/weather_sand_01_emit.bp']") is None, "nevasca: sem respingos")
    fog = world("fog")
    full(fog)
    fog.execute("CPWeatherCallback({ x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    check(fog.eval("bps['/effects/emitters/ambient/weather/snow/weather_snow_falling_01_emit.bp'] or 0") > 0, "neblina: bancos de névoa")
    check(fog.eval("bps['/effects/emitters/ambient/weather/snow/weather_snow_drifting_01_emit.bp']") is None
          and fog.eval("bps['/effects/emitters/ambient/weather/dust/weather_sand_01_emit.bp']") is None, "neblina: sem neve levantada nem respingos")
    sand = world("sandstorm")
    full(sand)
    sand.execute("CPWeatherCallback({ x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    check(sand.eval("bps['/effects/emitters/ambient/weather/snow/weather_snow_drifting_01_emit.bp'] or 0") > 0, "areia: poeira rente ao chão")
    # clima que muda: vai e volta (igual em todos os jogadores: só depende do tempo e do mapa)
    still = world("rain")
    check(all(still.eval(f"CPWeatherFront({t})") == 1 for t in range(0, 3600, 60)), "clima fixo: sempre inteiro")
    dyn = world("rain", dynamic=True)
    fronts = [dyn.eval(f"CPWeatherFront({t})") for t in range(0, 3600, 20)]
    check(min(fronts) < 0.2 and max(fronts) > 0.9, f"clima que muda: passa e volta ({min(fronts):.2f} a {max(fronts):.2f})")
    again = world("rain", dynamic=True)
    check([again.eval(f"CPWeatherFront({t})") for t in range(0, 3600, 20)] == fronts, "clima que muda: o mesmo roteiro em todo computador")
    # som do próprio jogo: vento e mar seguindo a câmera
    st = world("storm")
    st.execute("CPWeatherCallback({ x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    check(st.eval("ambient['SC2/SC2/Environments/X/snd_X_Generic_Ocean']") == 1 and st.eval("ambient['SC2/SC2/Environments/X/snd_X_Skyhigh']") == 1,
          "tempestade: sons de mar e vento do jogo")
    st.execute("CPWeatherCallback({ x0 = 420, z0 = 400, x1 = 520, z1 = 470 })")
    check(st.eval("ambient['SC2/SC2/Environments/X/snd_X_Generic_Ocean']") == 1, "o som não recomeça a cada passo da câmera")
    # partida com amigos: cada jogador com o clima onde olha
    two = world("rain")
    two.execute("SOURCE = 1 CPWeatherCallback({ x0 = 100, z0 = 100, x1 = 200, z1 = 170 }) SOURCE = 2 CPWeatherCallback({ x0 = 700, z0 = 700, x1 = 800, z1 = 770 })")
    check(two.eval("CPWeatherCellsPerPool()") == 90 and two.eval("ambient['SC2/SC2/Environments/X/snd_X_Generic_Ocean']") == 2, "dois jogadores: dois conjuntos, cada um com metade das células")
    mute = LuaRuntime(unpack_returned_tuples=True)
    mute.execute(WORLD.replace("KIND", "'rain'").replace("DYNAMIC", "nil").replace("CPWeatherDynamic = nil", "CPWeatherDynamic = nil, CPWeatherSound = '0'") + SIM.replace("local CPWeatherRates = {}\n", RATES))
    mute.execute("CreateResources() for _, f in ipairs(threads) do pcall(f) end CPWeatherCallback({ x0 = 400, z0 = 400, x1 = 500, z1 = 470 })")
    check(mute.eval("next(ambient)") is None, "som do clima desligado: nenhum som")
    clear = LuaRuntime(unpack_returned_tuples=True)
    clear.execute(WORLD.replace("KIND", "nil").replace("DYNAMIC", "nil") + SIM)
    clear.execute("CreateResources(); CPWeatherCallback({ x0 = 0, z0 = 0, x1 = 100, z1 = 100 })")
    check(clear.eval("made") == 0 and clear.eval("#threads") == 0, "sem clima escolhido nada acontece")

    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
