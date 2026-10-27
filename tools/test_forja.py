"""
Forja (carregador de mods) num mundo falso: o Lua que o launcher gera para a simulação, a interface
e os blueprints roda com o Lua do lupa e funções do jogo de mentira. Confere que os mods registram,
que um mod quebrado não derruba os outros, eventos e prioridades, comandos interface → simulação,
mensagens simulação → interface, opções, módulos (mod.Require), APIs entre mods (Export/Use),
ajudas de blueprint e os eventos das unidades (Unit.lua).

    cargo test -p cp-core forja::tests::dump_generated  (com CP_FORJA_DUMP=<pasta>)
    python tools/test_forja.py <pasta>

Sem pasta, monta uma pasta temporária chamando o cargo.
"""

import os
import subprocess
import sys
import tempfile

from lupa import LuaRuntime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# o Lua do jogo é 5.0: estas funções existem lá e não no Lua do lupa
COMPAT = r"""
table.getn = function(t) return #t end
loadstring = load
logs, warns = {}, {}
function LOG(s) table.insert(logs, s) end
function WARN(s) table.insert(warns, s) end
threads = {}
function ForkThread(f, ...) table.insert(threads, f) return {} end
function WaitSeconds() end
"""

SIM_WORLD = r"""
Sync = {}
ArmyBrains = { { BrainType = 'Human' }, { BrainType = 'AI' } }
function GetCurrentCommandSource() return 1 end
"""

UI_WORLD = r"""
keymaps = {}
sent = {}
screen = {}
function import(p)
    if string.find(p, 'textdisplay') then
        return { PrintToScreen = function(t) table.insert(screen, t.text) end }
    end
    return {}
end
function IN_AddKeyMapTable(t) for k, v in pairs(t) do keymaps[k] = v end end
function SimCallback(msg, sel) table.insert(sent, msg) end
function GetFocusArmy() return 1 end
function GetFrame() error('sem tela no teste') end
"""

UNIT_WORLD = r"""
created, killed = 0, 0
Unit = {}
function Unit.OnCreate(self, a) created = created + 1 end
function Unit.OnKilled(self, instigator, kind, overkill) killed = killed + 1 end
function Unit.OnDamage(self, instigator, amount, vector, kind) end
"""

fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def load(path):
    with open(path, encoding="latin-1") as f:
        return f.read()


def world(*parts):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(COMPAT)
    for p in parts:
        lua.execute(p)
    return lua


def run_threads(lua):
    lua.execute("local t = threads threads = {} for _, f in ipairs(t) do pcall(f) end")


def main(dump):
    sim, ui, bp, unit = (load(os.path.join(dump, n + ".lua")) for n in ("sim", "ui", "blueprints", "unit"))

    # ------------------------------------------------------------- simulação
    lua = world(SIM_WORLD, sim)
    check(lua.eval("Forja.Side") == "sim" and lua.eval("Forja.Version") == "1.0.0", "motor da simulação no ar")
    order = lua.eval("(function() local t = {} for _, m in ipairs(Forja.Mods()) do table.insert(t, m.Id) end return table.concat(t, ',') end)()")
    check(order == "broken,demo,user", f"mods na ordem de carga ({order})")
    check(lua.eval("Forja.Get('broken').Failed") and not lua.eval("Forja.Get('demo').Failed"), "erro de sintaxe num mod não derruba os outros")
    check(lua.eval("table.getn(Forja.Errors())") >= 1, "o erro fica registrado")
    check(lua.eval("Forja.Get('demo').Option('multiplier')") == 2, "opção escolhida no launcher chega ao mod")
    check(lua.eval("Forja.IsLoaded('demo') and not Forja.IsLoaded('broken')"), "IsLoaded")
    # o arquivo extra (lib/util) roda uma vez só
    check(lua.eval("Forja.Get('demo').Require('lib/util') == Forja.Get('demo').Require('lib/util.lua')"), "mod.Require carrega uma vez")
    # API entre mods
    check(lua.eval("Forja.Use('user').hello()") == "oi", "mod.Export / Forja.Use")
    # início da partida (handler com prioridade 10 roda antes)
    lua.execute("Forja._SessionStart()")
    check(any("partida come" in str(l) and "1 jogador" in str(l) for l in lua.eval("logs").values()), "SessionStart chega ao mod")
    # comando da interface
    lua.execute("Forja._Command({ name = 'demo:hello', data = { text = 'oi' } }, {})")
    check(any("text=oi" in str(l) for l in lua.eval("logs").values()), "comando da interface chega a Forja.Sim.OnCommand")
    lua.execute("Forja._Command({ name = 'nada' }) Forja._Command('lixo') Forja._Command(nil)")
    check(True, "comandos estranhos são ignorados")
    # mensagem para a interface (UnitKilled do demo)
    lua.execute(unit.replace("do\n", UNIT_WORLD + "\ndo\n", 1))
    lua.execute("""
        local victim = {}
        local killer = { GetArmy = function() return 1 end }
        Unit.OnCreate(victim, {})
        Unit.OnKilled(victim, killer, 'Normal', 0)
    """)
    check(lua.eval("created") == 1 and lua.eval("killed") == 1, "os métodos originais das unidades continuam rodando")
    check(lua.eval("Sync.Forja and Sync.Forja[table.getn(Sync.Forja)].name") == "demo:kill", "UnitKilled → Forja.Sim.SendToUI")
    # eventos: prioridade, Stop, Off, Once e handler que falha
    lua.execute("""
        seq = {}
        local h = Forja.On('T', function() table.insert(seq, 'b') end, 1)
        Forja.On('T', function() table.insert(seq, 'a') end, 5)
        Forja.Once('T', function() table.insert(seq, 'o') end)
        Forja.On('T', function() error('x') end, -1)
        Forja.Emit('T')
        Forja.Off(h)
        Forja.Emit('T')
        Forja.On('S', function() return Forja.Stop end, 2)
        Forja.On('S', function() table.insert(seq, 'never') end, 1)
        stopped = Forja.Emit('S')
    """)
    check(lua.eval("table.concat(seq, '')") == "aboa", "prioridade, Once e Off (" + str(lua.eval("table.concat(seq, ',')")) + ")")
    check(lua.eval("stopped") is True, "Forja.Stop interrompe o evento")
    lua.execute("for i = 1, 6 do Forja.Emit('T') end")
    check(not lua.eval("Forja.HasListeners('T') and (function() for _, h in ipairs(Forja._handlers.T) do if h.errors > 0 then return true end end end)()"),
          "handler que falha 5 vezes sai")
    # timers
    lua.execute("ticks = 0 Forja.Every(1, function() ticks = ticks + 1 return false end) Forja.After(2, function() ticks = ticks + 10 end)")
    run_threads(lua)
    check(lua.eval("ticks") == 11, "Forja.Every e Forja.After")

    # ------------------------------------------------------------- interface
    lua = world(UI_WORLD, ui)
    check(lua.eval("Forja.Side") == "ui" and lua.eval("Forja.UI ~= nil"), "motor da interface no ar")
    check(lua.eval("Forja.Get('broken').Failed"), "erro de execução na interface também isola o mod")
    lua.execute("Forja._UIReady()")
    run_threads(lua)
    check(lua.eval("keymaps.F8 ~= nil and keymaps.F7 ~= nil"), "tecla do painel da Forja (F8) e do mod (F7)")
    check(any("com erro" in str(s) for s in lua.eval("screen").values()), "aviso de mod com erro na tela")
    check(any("Demo carregado" in str(s) for s in lua.eval("screen").values()), "UIReady chega ao mod")
    lua.execute("Forja.UI.SendToSim('demo:hello', { text = 'x' })")
    check(lua.eval("sent[1].Func") == "Forja" and lua.eval("sent[1].Args.name") == "demo:hello", "SendToSim vira SimCallback 'Forja'")
    lua.execute("got = 0 Forja.UI.OnSim('t:x', function(d) got = got + d.n end) Forja._Deliver({ { name = 't:x', data = { n = 2 } }, { name = 'outro' } })")
    check(lua.eval("got") == 2, "mensagem da simulação chega a Forja.UI.OnSim")
    lua.execute("Forja._Deliver({ { name = 'forja:error', data = { mod = 'm', side = 'sim', text = 'e' } } })")
    check(lua.eval("Forja.Errors()[table.getn(Forja.Errors())].side") == "sim", "erros da simulação aparecem na interface")
    lua.execute("pressed = 0 Forja.UI.AddKey('Home', 'x', function() pressed = pressed + 1 end) Forja._Key('Home')")
    check(lua.eval("pressed") == 1, "tecla de mod")

    # ------------------------------------------------------------- blueprints
    lua = world(bp)
    lua.execute("""
        all = { Unit = {
            UUL0101 = { BlueprintId = 'UUL0101', Categories = { 'UUL0101', 'LAND' }, Defense = { MaxHealth = 100 } },
            UUA0101 = { BlueprintId = 'UUA0101', Categories = { 'AIR' }, Defense = { MaxHealth = 50 } },
        } }
    """)
    check(lua.eval("Forja.Get('demo') ~= nil and Forja.Get('demo').Failed == false"), "blueprints: o código espera o carregamento")
    lua.execute("Forja._Blueprints(all)")
    check(lua.eval("all.Unit.UUL0101.Defense.MaxHealth") == 200 and lua.eval("all.Unit.UUA0101.Defense.MaxHealth") == 50,
          "Forja.BP.EachUnit + Scale com a opção do mod (x2 só nas terrestres)")
    check(lua.eval("Forja.Get('broken').Failed"), "erro no blueprints.lua isola o mod")
    lua.execute("""
        Forja.BP.Modify(function(B)
            local c = B.Clone('uul0101', 'CPX0001', { Defense = { MaxHealth = 999 } })
            B.Set(c, 'Economy.BuildTime', 7)
            B.AddCategory(c, 'experimental')
        end)
        Forja._Blueprints(all)
    """)
    check(lua.eval("all.Unit.CPX0001.Defense.MaxHealth") == 999 and lua.eval("all.Unit.CPX0001.Economy.BuildTime") == 7, "Clone + Set")
    check(lua.eval("all.Unit.UUL0101.Defense.MaxHealth") == 200, "o clone não mexe no original")
    check(lua.eval("Forja.BP.HasCategory(all.Unit.CPX0001, 'EXPERIMENTAL') and Forja.BP.HasCategory(all.Unit.CPX0001, 'CPX0001') and not Forja.BP.HasCategory(all.Unit.CPX0001, 'UUL0101')"),
          "categorias do clone")
    ok = lua.eval("(pcall(Forja.BP.Unit, 'x'))")
    check(ok is False, "Forja.BP fora do carregamento avisa")

    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    if len(sys.argv) > 1:
        sys.exit(main(sys.argv[1]))
    with tempfile.TemporaryDirectory() as d:
        env = dict(os.environ, CP_FORJA_DUMP=d)
        subprocess.run(["cargo", "test", "-q", "-p", "cp-core", "forja::tests::dump_generated"], cwd=ROOT, env=env, check=True,
                       stdout=subprocess.DEVNULL)
        sys.exit(main(d))
