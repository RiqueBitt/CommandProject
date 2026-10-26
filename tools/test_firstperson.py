"""Testa o mod Primeira Pessoa num Lua de mentira com as funções do jogo.

Interface (crates/cp-core/src/firstperson_ui.lua): a tecla alterna estratégica → 1ª pessoa →
3ª pessoa → estratégica (uma unidade) e estratégica → comando → estratégica (grupo); W A S D andam,
E atira, Q para, Esc volta e restaura a câmera e as teclas originais; sem nada selecionado a tecla
faz o que fazia. Simulação (firstperson_sim.lua): andar na direção da câmera, parar, atirar e só
com unidades do próprio exército. Com CP_FP_OUT (pasta com worldview.lua, SimSync.lua e
SimCallbacks.lua montados pelo teste `real_game_build` do cp-core) confere também os arquivos reais.
"""
import os
import re
import sys
from pathlib import Path

from lupa.lua55 import LuaRuntime

ROOT = Path(__file__).resolve().parent.parent
UI = (ROOT / "crates/cp-core/src/firstperson_ui.lua").read_text(encoding="utf-8")
SIM = (ROOT / "crates/cp-core/src/firstperson_sim.lua").read_text(encoding="utf-8")

fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def moho_to_lua(code: str) -> str:
    code = code.replace("!=", "~=")
    code = re.sub(r"\bcontinue\b", "local _c = 0", code)

    def fix(m):
        names, expr = m.group(1), m.group(2).strip()
        if expr.startswith(("ipairs(", "pairs(")):
            return m.group(0)
        return f"for {names} in pairs({expr}) do"

    return re.sub(r"for ([\w, ]+) in (.+?) do\b", fix, code)


UI_WORLD = r"""
table.getn = table.getn or function(t) return #t end
W = { time = 0, held = {}, map = {}, removed = {}, calls = {}, cmds = {}, notes = {}, selected = {}, threads = {}, rollover = nil, mouse = {100, 5, 200} }
W.cam = { focus = {500, 10, 500}, eye = {500, 60, 560}, heading = 0.3, pitch = 0.9, zoom = 80, nose = nil }
local cam = {}
function cam:SaveSettings() return { Focus = { W.cam.focus[1], W.cam.focus[2], W.cam.focus[3] }, Heading = W.cam.heading, Pitch = W.cam.pitch, Zoom = W.cam.zoom } end
function cam:RestoreSettings(s) W.cam.focus = s.Focus; W.cam.heading = s.Heading; W.cam.pitch = s.Pitch; W.cam.zoom = s.Zoom; W.cam.nose = nil; table.insert(W.calls, 'restore') end
function cam:MoveTo(p, hpr, zoom, t) W.cam.focus = p; W.cam.heading = hpr[1]; W.cam.pitch = hpr[2]; W.cam.zoom = zoom; W.cam.nose = nil; table.insert(W.calls, 'moveto') end
function cam:SnapTo(p, hpr, zoom) W.cam.focus = p; W.cam.heading = hpr[1]; W.cam.pitch = hpr[2]; W.cam.zoom = zoom; W.cam.nose = nil; table.insert(W.calls, 'snap') end
function cam:NoseCam(u, pitch, zoom, s, t) if type(u) ~= 'table' then error('quer a unidade') end W.cam.nose = u; table.insert(W.calls, 'nose') end
function cam:Reset() table.insert(W.calls, 'reset') end
function GetCamera(name) return cam end
function GetCameraPositionAndZoom() return W.cam.eye[1], W.cam.eye[2], W.cam.eye[3], W.cam.zoom end
function CurrentTime() return W.time end
function IsKeyDown(k) return W.held[k] == true end
function IN_AddKeyMapTable(t) for k, v in pairs(t) do W.map[k] = v end end
function IN_RemoveKeyMapTable(t) for k, v in pairs(t) do W.map[k] = nil; W.removed[k] = true end end
function SimCallback(cb, sel) table.insert(W.cmds, { cb = cb, sel = sel }) end
function GetSelectedUnits() return W.selected end
function SelectUnits(u) W.selected = u end
function GetFocusArmy() return 1 end
function SessionIsReplay() return false end
function GetRolloverInfo() return W.rollover end
function GetMouseWorldPos() return W.mouse end
function ConExecute(c) table.insert(W.calls, 'con:' .. c) end
function LOC(s) return s end
function ForkThread(f) local co = coroutine.create(f); table.insert(W.threads, co); return co end
function WaitFrames(n) coroutine.yield() end
function WaitSeconds(n) coroutine.yield() end
function Step(n)
    for k = 1, n or 1 do
        W.time = W.time + 0.1
        for i = #W.threads, 1, -1 do
            local co = W.threads[i]
            if coroutine.status(co) ~= 'dead' then
                local ok, err = coroutine.resume(co)
                if not ok then error(err) end
            end
            if coroutine.status(co) == 'dead' then table.remove(W.threads, i) end
        end
    end
end
function Unit(id, x, z, army)
    local u = { id = id, pos = { x, 5, z }, dead = false, army = army or 1 }
    function u:IsDead() return self.dead end
    function u:GetPosition() return self.pos end
    function u:GetEntityId() return self.id end
    function u:GetHealth() return 50 end
    function u:GetMaxHealth() return 100 end
    function u:GetBlueprint() return { General = { UnitName = 'Tanque ' .. self.id }, Description = 'tank' } end
    return u
end
local keyActions = { ping_alert = { action = 'UI_Lua ping()' }, zoom_out = { action = 'UI_Lua zoomout()' }, attack = { action = 'UI_Lua attack()' }, stop = { action = 'UI_Lua stop()' }, escape = { action = 'UI_Lua esc()' } }
local currentMap = { F5 = 'ping_alert', W = 'zoom_out', A = 'attack', S = 'stop', Esc = 'escape' }
local modules = {
    ['/lua/ui/uiutil.lua'] = { CreateText = function() local t = {} function t:SetColor() end function t:DisableHitTest() end function t:SetText(s) t.text = s end return t end, bodyFont = 'x' },
    ['/lua/maui/layouthelpers.lua'] = setmetatable({ GetPixelScaleFactor = function() return 1 end }, { __index = function() return function() end end }),
    ['/lua/maui/bitmap.lua'] = { Bitmap = function() local b = { hidden = false }
        b.Width = { Set = function() end }; b.Height = { Set = function() end }
        function b:SetSolidColor() end function b:DisableHitTest() end function b:Hide() self.hidden = true end function b:Show() self.hidden = false end
        return b end },
    ['/lua/keymap/keymapper.lua'] = { GetCurrentKeyMap = function() return currentMap end, GetKeyActions = function() return keyActions end },
    ['/lua/ui/game/textdisplay.lua'] = { PrintToScreen = function(t) table.insert(W.notes, t.text) end },
}
function import(p) return modules[p] or error('sem módulo ' .. p) end
function GetFrame() return {} end
"""

SIM_WORLD = r"""
table.getn = table.getn or function(t) return #t end
S = { orders = {} }
function OkayToMessWithArmy(a) return a == 1 end
function GetMapSize() return 1024, 1024 end
function GetSurfaceHeight(x, z) return 7 end
function IssueClearCommands(l) table.insert(S.orders, { 'clear', #l }) end
function IssueStop(l) table.insert(S.orders, { 'stop', #l }) end
function IssueMove(l, p) table.insert(S.orders, { 'move', l[1].id, p[1], p[2], p[3] }) end
function IssueAttack(l, t) table.insert(S.orders, { 'attack', #l, t }) end
function IsEnemy(a, b) return a ~= b end
S.ents = {}
function GetEntityById(id) return S.ents[id] end
function Unit(id, x, z, army, speed)
    local u = { id = id, pos = { x, 5, z }, army = army }
    function u:IsDead() return false end
    function u:GetArmy() return self.army end
    function u:GetPosition() return self.pos end
    function u:GetBlueprint() return { Physics = { MaxSpeed = speed or 4 } } end
    S.ents[id] = u
    return u
end
"""


def last_cmd(g):
    cmds = list(g.W.cmds.values())
    return cmds[-1].cb.Args if cmds else None


def test_ui(code):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(UI_WORLD)
    lua.execute(moho_to_lua(code.replace("@KEY@", "F5").replace("@HUD@", "true").replace("@DRIVE@", "true")
                            .replace("@FIRST_ZOOM@", "0.0").replace("@THIRD_ZOOM@", "38.0")))
    g = lua.globals()
    g.CPFirstPersonInit()
    check(g.W.map.F5 is not None and "CPFirstPersonToggle" in g.W.map.F5.action, "tecla F5 ligada à câmera")
    # nada selecionado: F5 faz o que fazia (alerta de ping)
    g.CPFirstPersonToggle()
    calls = list(g.W.calls.values())
    check("con:UI_Lua ping()" in calls, f"sem seleção, F5 continua com a função original ({calls})")
    # uma unidade: primeira pessoa com a câmera do motor presa nela
    tank = g.Unit(7, 300, 400)
    g.W.selected = lua.table_from([tank])
    g.CPFirstPersonToggle()
    check(g.W.cam.nose is not None and g.W.cam.nose.id == 7, "1ª pessoa: câmera presa na unidade (NoseCam)")
    check("CPFirstPersonKey" in g.W.map.W.action and "CPFirstPersonKey" in g.W.map.Esc.action, "W e Esc controlam a unidade enquanto a câmera está ligada")
    # W segurado: anda para onde a câmera olha (foco − olho, no chão)
    g.W.held.W = True
    g.Step(4)
    a = last_cmd(g)
    check(a is not None and a.Cmd == "drive" and a.F == 1 and a.S == 0, f"W anda para a frente ({a and a.Cmd})")
    check(a is not None and abs(a.DX - 0) < 1e-6 and abs(a.DZ - (-1)) < 1e-6, f"na direção em que a câmera olha ({a and (a.DX, a.DZ)})")
    g.W.held.W = None
    g.Step(4)
    check(last_cmd(g).Cmd == "halt", "soltar a tecla para a unidade")
    # E com inimigo sob o mouse: atira nele; sem inimigo: atira no chão
    enemy = g.Unit(99, 320, 420)
    g.W.rollover = lua.table_from({"userUnit": enemy, "armyIndex": 2})
    g.CPFirstPersonKey("E")
    check(last_cmd(g).Cmd == "fire" and last_cmd(g).Target == 99, "E atira no inimigo sob o mouse")
    g.W.rollover = None
    g.CPFirstPersonKey("E")
    check(last_cmd(g).Cmd == "fire" and last_cmd(g).Pos[1] == 100, "E sem inimigo atira no chão do mouse")
    # F5 de novo: terceira pessoa (atrás, seguindo a unidade)
    g.CPFirstPersonToggle()
    tank.pos = lua.table_from([310, 5, 380])
    g.Step(2)
    check(g.W.cam.nose is None and abs(g.W.cam.focus[1] - 310) < 1e-6 and abs(g.W.cam.focus[3] - 380) < 1e-6, "3ª pessoa: a câmera acompanha a unidade")
    # F5 de novo: volta à estratégica, com a câmera e as teclas de antes
    g.CPFirstPersonToggle()
    check(abs(g.W.cam.focus[1] - 500) < 1e-6 and abs(g.W.cam.zoom - 80) < 1e-6, "volta à câmera estratégica de antes")
    check(g.W.map.W.action == "UI_Lua zoomout()" and g.W.map.A.action == "UI_Lua attack()", "teclas originais de volta (W, A)")
    check(g.W.map.D is None and g.W.map.F5 is not None, "teclas sem função original saem; F5 continua")
    # grupo: câmera de comando acima da formação, W anda com todos
    a1, a2 = g.Unit(1, 100, 100), g.Unit(2, 140, 100)
    g.W.selected = lua.table_from([a1, a2])
    g.CPFirstPersonToggle()
    g.Step(2)
    check(g.W.cam.nose is None and abs(g.W.cam.focus[1] - 120) < 1e-6 and g.W.cam.zoom >= 60, f"grupo: câmera de comando no centro da formação (zoom {g.W.cam.zoom})")
    g.W.held.D = True
    g.Step(4)
    a = last_cmd(g)
    check(a.Cmd == "drive" and a.S == 1 and g.W.cmds[len(g.W.cmds)].sel is not False, "D anda para o lado com o grupo selecionado")
    g.W.held.D = None
    # unidade destruída: volta sozinho
    a1.dead = True
    a2.dead = True
    g.Step(3)
    check(g.W.map.W.action == "UI_Lua zoomout()", "grupo destruído: volta à estratégica")
    check(any("destruida" in str(n) for n in g.W.notes.values()), "avisa que a unidade foi destruída")


def test_sim(code):
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(SIM_WORLD)
    lua.execute(moho_to_lua(code))
    g = lua.globals()
    mine, other = g.Unit(1, 500, 500, 1, 4), g.Unit(2, 520, 500, 2)
    # anda para onde a câmera olha (DZ = -1: para cima no mapa), alvo um pouco à frente
    g.CPFirstPersonSim(lua.table_from({"Cmd": "drive", "F": 1, "S": 0, "DX": 0, "DZ": -1}), lua.table_from([mine, other]))
    orders = [list(o.values()) for o in g.S.orders.values()]
    moves = [o for o in orders if o[0] == "move"]
    check(len(moves) == 1 and moves[0][1] == 1, f"só a unidade do próprio exército anda ({moves})")
    check(abs(moves[0][2] - 500) < 1e-6 and moves[0][4] < 500 - 9 and moves[0][3] == 7, f"alvo à frente na direção da câmera, no chão ({moves[0]})")
    # D: para a direita da câmera (olhando para cima no mapa, direita = +x)
    g.S.orders = lua.table()
    g.CPFirstPersonSim(lua.table_from({"Cmd": "drive", "F": 0, "S": 1, "DX": 0, "DZ": -1}), lua.table_from([mine]))
    mv = [list(o.values()) for o in g.S.orders.values() if list(o.values())[0] == "move"][0]
    check(mv[2] > 509 and abs(mv[4] - 500) < 1e-6, f"D vai para a direita ({mv})")
    # perto da borda: alvo fica dentro do mapa
    edge = g.Unit(3, 3, 3, 1, 4)
    g.S.orders = lua.table()
    g.CPFirstPersonSim(lua.table_from({"Cmd": "drive", "F": 1, "S": 0, "DX": -1, "DZ": 0}), lua.table_from([edge]))
    mv = [list(o.values()) for o in g.S.orders.values() if list(o.values())[0] == "move"][0]
    check(mv[2] >= 2, "alvo não sai do mapa")
    # atirar: inimigo sim, aliado não; chão
    g.S.orders = lua.table()
    g.CPFirstPersonSim(lua.table_from({"Cmd": "fire", "Target": 2}), lua.table_from([mine]))
    check(any(list(o.values())[0] == "attack" for o in g.S.orders.values()), "atira no inimigo")
    g.S.orders = lua.table()
    g.CPFirstPersonSim(lua.table_from({"Cmd": "fire", "Target": 1}), lua.table_from([mine]))
    check(not any(list(o.values())[0] == "attack" for o in g.S.orders.values()), "não atira em unidade própria")
    g.S.orders = lua.table()
    g.CPFirstPersonSim(lua.table_from({"Cmd": "fire", "Pos": lua.table_from([10, 0, 20])}), lua.table_from([mine]))
    check(any(list(o.values())[0] == "attack" for o in g.S.orders.values()), "atira no chão")
    g.S.orders = lua.table()
    g.CPFirstPersonSim(lua.table_from({"Cmd": "stop"}), lua.table_from([other]))
    check(len(list(g.S.orders.values())) == 0, "unidades de outro exército não recebem ordens")
    g.CPFirstPersonSim("lixo", None)
    check(True, "dados inválidos são ignorados")


def main() -> int:
    test_ui(UI)
    test_sim(SIM)
    out = os.environ.get("CP_FP_OUT")
    if out:
        lua = LuaRuntime()
        compile_ok = lua.eval("function(c) local f, e = load(c) return f ~= nil, e end")
        for name in ("worldview.lua", "SimSync.lua", "SimCallbacks.lua"):
            text = (Path(out) / name).read_bytes().decode("latin1").replace("\r\n", "\n")
            ok = compile_ok(moho_to_lua(text))
            check(ok[0], f"{name} real: Lua válido ({ok[1]})")
        view = (Path(out) / "worldview.lua").read_text(encoding="latin1")
        check("RefreshMapDialog()\n    pcall(CPFirstPersonInit) -- CommandProject first person\nend" in view, "worldview.lua real: chamada no fim de CreateMainWorldView")
        cb = (Path(out) / "SimCallbacks.lua").read_text(encoding="latin1")
        check("Callbacks.CPFirstPerson" in cb and "Callbacks.CPCheats" in cb and "Callbacks.CPAIMemory" in cb, "SimCallbacks.lua real: comandos de todos os mods")
    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
