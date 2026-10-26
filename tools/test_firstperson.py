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
function cam:GetMinZoom() return 5 end
function cam:UseAbsoluteCoords(on) W.cam.absolute = on; table.insert(W.calls, on and 'abs' or 'rel') end
function GetCamera(name) return cam end
function Vector(x, y, z) return { x, y, z } end
-- vista de cima, a tela gira com o rumo (rumo 0 = olhando para -z): na frente fica acima
viewLeft = {}
function viewLeft:Project(p)
    local h = W.cam.heading
    local dx, dz = -math.sin(h), -math.cos(h)
    local rx, rz = -dz, dx
    local ox, oz = p[1] - W.cam.focus[1], p[3] - W.cam.focus[3]
    return { x = 500 + ox * rx + oz * rz, y = 400 - (ox * dx + oz * dz) }
end
function GetCameraPositionAndZoom()
    -- câmera em órbita: olho atrás do foco (rumo 0 = olhando para -z) e acima dele pelo ângulo
    local h, p, z = W.cam.heading, W.cam.pitch, W.cam.zoom
    local dx, dz = -math.sin(h), -math.cos(h)
    return W.cam.focus[1] - dx * z * math.cos(p), W.cam.focus[2] + z * math.sin(p), W.cam.focus[3] - dz * z * math.cos(p), z
end
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
W.screen = { x = 500, y = 400 }
function GetMouseScreenPos() return W.screen end
function ConExecute(c) table.insert(W.calls, 'con:' .. c) end
function LOC(s) return s end
function LOG(s) end
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
    function u:GetBlueprint() return { General = { UnitName = 'Tanque ' .. self.id }, Description = 'tank', SizeX = 3, SizeY = 6, SizeZ = 2.5, Physics = { MeshExtentsX = 0, MeshExtentsY = self.meshY or 0, MeshExtentsZ = 0 } } end
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
    g.Step(3)
    eye = g.GetCameraPositionAndZoom()
    import math
    h = g.W.cam.heading
    fx, fz = -math.sin(h), -math.cos(h)
    # olho na frente da cabeça: altura 6 + 0,3, à frente 0,55 do maior lado + 0,25
    want = (300 + fx * 1.9, 5 + 6.3, 400 + fz * 1.9)
    err = max(abs(eye[i] - want[i]) for i in range(3))
    check(g.W.cam.nose is None and err < 0.05, f"1ª pessoa: olho na cabeça da unidade ({[round(v, 2) for v in eye[:3]]} ≈ {[round(v, 2) for v in want]})")
    calls = list(g.W.calls.values())
    check("nose" not in calls and "snap" in calls, "1ª pessoa usa SnapTo (o NoseCam do motor fecha o jogo)")
    check(g.W.cam.absolute is True and abs(g.W.cam.zoom - 0.6) < 1e-6, f"1ª pessoa em coordenadas absolutas, olho logo atrás do foco (zoom {g.W.cam.zoom})")
    check("CPFirstPersonKey" in g.W.map.W.action and "CPFirstPersonKey" in g.W.map.Esc.action, "W e Esc controlam a unidade enquanto a câmera está ligada")
    n0 = len(g.W.cmds)
    g.Step(5)
    check(len(g.W.cmds) == n0, "sem tecla, nenhuma ordem é enviada")
    # tecla que o motor ainda acha apertada, sem ter sido apertada agora: não anda sozinha
    g.W.held.W = True
    g.Step(5)
    check(len(g.W.cmds) == n0, "tecla presa de antes não move a unidade")
    g.W.held.W = None
    # W segurado: anda para onde a câmera olha, sem mandar ordem nova a cada quadro
    g.W.held.W = True
    g.CPFirstPersonKey("W")
    g.Step(6)
    a = last_cmd(g)
    check(a is not None and a.Cmd == "drive" and a.F == 1 and a.S == 0, f"W anda para a frente ({a and a.Cmd})")
    h = g.W.cam.heading
    check(a is not None and abs(a.DX - (-math.sin(h))) < 1e-6 and abs(a.DZ - (-math.cos(h))) < 1e-6, f"na direção em que a câmera olha ({a and (a.DX, a.DZ)}, rumo {h})")
    check(len(g.W.cmds) - n0 == 1, f"uma ordem só enquanto a direção não muda ({len(g.W.cmds) - n0})")
    # andando com W a câmera não balança: o rumo é do jogador, mesmo com a unidade desviando
    h0 = g.W.cam.heading
    for k in range(10):
        tank.pos = lua.table_from([300 + (k % 2) * 0.6, 5, 400 - k])
        g.Step(1)
    check(abs(g.W.cam.heading - h0) < 1e-6, "com W o rumo não segue os desvios da unidade (sem balanço)")
    # E vira a vista para a direita (olhando para -z, direita = +x)
    g.W.held.E = True
    g.CPFirstPersonKey("E")
    g.Step(5)
    g.W.held.E = None
    h1 = g.W.cam.heading
    dx1 = -math.sin(h1)
    check(dx1 > -math.sin(h0) + 0.3, f"E vira a vista para a direita ({-math.sin(h0):.2f} -> {dx1:.2f})")
    a = last_cmd(g)
    check(abs(a.DX - dx1) < 0.05, "virando com W, a unidade recebe a direção nova")
    g.W.held.W = None
    g.Step(2)
    check(last_cmd(g).Cmd == "halt", "soltar a tecla para a unidade")
    # andando por ordens (botão direito), a vista vira para onde a unidade vai (aqui: para +x)
    base = tank.pos[3]
    for k in range(40):
        tank.pos = lua.table_from([300 + k * 2, 5, base])
        g.Step(1)
    fx, fz = -math.sin(g.W.cam.heading), -math.cos(g.W.cam.heading)
    check(fx > 0.9, f"1ª pessoa vira com o movimento da unidade (direção {fx:.2f}, {fz:.2f})")
    # o jogo devolve um objeto novo a cada chamada: a mesma unidade não reinicia a câmera
    hb = g.W.cam.heading
    g.W.selected = lua.table_from([g.Unit(7, tank.pos[1], tank.pos[3])])
    g.Step(1)
    check(abs(g.W.cam.heading - hb) < 0.05, "mesma unidade (objeto novo) mantém a vista")
    g.W.selected = lua.table_from([tank])
    # sem IsKeyDown: a primeira batida vale até a repetição do Windows começar
    g.W.held = lua.table()
    real = g.IsKeyDown
    g.IsKeyDown = None
    # E com inimigo sob o mouse: atira nele; sem inimigo: atira no chão
    enemy = g.Unit(99, 320, 420)
    g.W.rollover = lua.table_from({"userUnit": enemy, "armyIndex": 2})
    g.CPFirstPersonKey("F")
    check(last_cmd(g).Cmd == "fire" and last_cmd(g).Target == 99, "F atira no inimigo sob o mouse")
    g.W.rollover = None
    g.CPFirstPersonKey("F")
    check(last_cmd(g).Cmd == "fire" and last_cmd(g).Pos[1] == 100, "F sem inimigo atira no chão do mouse")
    g.CPFirstPersonKey("X")
    check(last_cmd(g).Cmd == "stop", "X para a unidade")
    # A anda de lado (para a esquerda da vista), sem girar a câmera
    hs = g.W.cam.heading
    g.W.held.A = True
    g.CPFirstPersonKey("A")
    g.Step(3)
    a = last_cmd(g)
    check(a.Cmd == "drive" and a.F == 0 and a.S == -1, f"A anda para a esquerda ({a.Cmd} F={a.F} S={a.S})")
    check(abs(g.W.cam.heading - hs) < 1e-6, "A/D não giram a câmera")
    g.W.held.A = None
    g.Step(2)
    # botão do meio + mouse para a direita: a vista gira para a direita e olha para baixo/cima
    hm = g.W.cam.heading
    g.IsKeyDown = real
    g.W.held.MBUTTON = True
    g.Step(1)
    g.W.screen = lua.table_from({"x": 600, "y": 380})
    g.Step(1)
    g.W.held.MBUTTON = None
    dxm = -math.sin(g.W.cam.heading)
    # olhando para +x, a direita é +z: girar 0,6 rad para a direita
    ox, oz = -math.sin(hm), -math.cos(hm)
    nx, nz = dxm, -math.cos(g.W.cam.heading)
    want = (ox * math.cos(0.6) - oz * math.sin(0.6), oz * math.cos(0.6) + ox * math.sin(0.6))
    check(abs(nx - want[0]) < 0.02 and abs(nz - want[1]) < 0.02, f"botão do meio + mouse gira a vista para a direita (({ox:.2f},{oz:.2f}) -> ({nx:.2f},{nz:.2f}))")
    check(g.W.cam.pitch < 0.1 - 0.05, f"mouse para cima olha para cima (pitch {g.W.cam.pitch:.2f})")
    g.W.screen = lua.table_from({"x": 900, "y": 380})
    g.Step(1)
    check(abs(-math.sin(g.W.cam.heading) - dxm) < 1e-6, "sem o botão, mexer o mouse não gira")
    g.IsKeyDown = None
    hs = g.W.cam.heading
    # Espaço + mouse do jogo gira a câmera: a vista fica com o giro
    g.W.cam.heading = g.W.cam.heading + 0.5
    g.Step(1)
    check(abs(g.W.cam.heading - (hs + 0.5)) < 0.05, f"o giro do próprio jogo (Espaço + mouse) é mantido ({hs:.2f} -> {g.W.cam.heading:.2f})")
    g.CPFirstPersonKey("W")
    g.Step(5)
    check(last_cmd(g).Cmd == "drive", "sem IsKeyDown: W anda com a batida da tecla")
    g.Step(1)
    check(last_cmd(g).Cmd == "drive", "e não para antes da repetição da tecla (0,5 s)")
    g.Step(3)
    check(last_cmd(g).Cmd == "halt", "sem repetição, para")
    g.IsKeyDown = real
    # F5 de novo: terceira pessoa (atrás, seguindo a unidade)
    g.CPFirstPersonToggle()
    tank.pos = lua.table_from([310, 5, 380])
    g.Step(2)
    g.Step(20)
    check(g.W.cam.nose is None and abs(g.W.cam.focus[1] - 310) < 0.5 and abs(g.W.cam.focus[3] - 380) < 0.5, f"3ª pessoa: a câmera acompanha a unidade ({g.W.cam.focus[1]:.1f}, {g.W.cam.focus[3]:.1f})")
    # F5 de novo: volta à estratégica, com a câmera e as teclas de antes
    g.CPFirstPersonToggle()
    check(abs(g.W.cam.focus[1] - 500) < 1e-6 and abs(g.W.cam.zoom - 80) < 1e-6, "volta à câmera estratégica de antes")
    check(g.W.cam.absolute is False, "coordenadas normais de volta")
    check(g.W.map.W.action == "UI_Lua zoomout()" and g.W.map.A.action == "UI_Lua attack()", "teclas originais de volta (W, A)")
    check(g.W.map["Shift-W"] is None, "Shift-W também volta (sem ação própria aqui, sai)")
    check(g.W.map.D is None and g.W.map.F5 is not None, "teclas sem função original saem; F5 continua")
    # grupo: câmera de comando acima da formação, W anda com todos
    a1, a2 = g.Unit(1, 100, 100), g.Unit(2, 140, 100)
    g.W.selected = lua.table_from([a1, a2])
    g.CPFirstPersonToggle()
    g.Step(20)
    check(g.W.cam.nose is None and abs(g.W.cam.focus[1] - 120) < 0.5 and g.W.cam.zoom >= 60, f"grupo: câmera de comando no centro da formação (zoom {g.W.cam.zoom})")
    g.W.held.W = True
    g.CPFirstPersonKey("W")
    g.Step(4)
    a = last_cmd(g)
    check(a.Cmd == "drive" and a.F == 1 and g.W.cmds[len(g.W.cmds)].sel is not False, "W anda com o grupo selecionado")
    g.W.held.W = None
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
