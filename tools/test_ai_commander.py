"""Testa o comandante estratégico da IA (crates/cp-core/src/aimod_commander.lua) num mundo falso.

Roda o Lua de verdade (lupa), com uma imitação das funções do jogo: unidades, consultas de área,
ordens, fábricas, engenheiros, transportes e o tempo de jogo. Cada cenário começa num mundo novo e
confere uma decisão: segurar o exército pequeno, atacar o alvo que dá para vencer, não se jogar
contra fortalezas, defender, recuar, feridos para casa, foco de fogo, pinça, escolta de
experimental, aviação, comandante (ACU) que foge, contra-produção, torres e posto avançado,
desembarque, ajuda a aliado, dificuldade adaptativa e o painel.

    python3 tools/test_ai_commander.py
"""
import re
import sys
from pathlib import Path

from lupa import LuaRuntime

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "crates/cp-core/src/aimod_commander.lua").read_text()
PANEL = (ROOT / "crates/cp-core/src/aimod_panel.lua").read_text()

UI_HARNESS = r"""
table.getn = table.getn or function(t) return #t end
Sync = {}
UI = { beats = {}, texts = {} }
local function lazy() local v = {} function v:Set(x) self.value = x end setmetatable(v, { __call = function(self) return type(self.value) == 'function' and self.value() or (self.value or 100) end }) return v end
local function control()
    local c = { hidden = false, Depth = lazy(), Width = lazy(), Height = lazy(), Left = lazy(), Top = lazy(), Right = lazy(), Bottom = lazy() }
    function c:SetSolidColor(col) self.color = col end
    function c:DisableHitTest() end
    function c:Hide() self.hidden = true end
    function c:Show() self.hidden = false end
    function c:IsHidden() return self.hidden end
    function c:SetText(t) self.text = t end
    function c:SetColor(col) self.color = col end
    function c:GetTopmostDepth() return 10 end
    return c
end
local modules = {
    ['/lua/ui/uiutil.lua'] = { bodyFont = 'Arial', CreateText = function(parent, text, size, font) local t = control() t.text = text table.insert(UI.texts, t) return t end },
    ['/lua/maui/layouthelpers.lua'] = setmetatable({ GetPixelScaleFactor = function() return 1 end }, { __index = function() return function() end end }),
    ['/lua/maui/bitmap.lua'] = { Bitmap = function(parent) return control() end },
    ['/lua/ui/game/gamemain.lua'] = { AddBeatFunction = function(f) table.insert(UI.beats, f) end },
    ['/lua/ui/game/textdisplay.lua'] = { PrintToScreen = function(d) UI.printed = d.text end },
}
UI.prefs = {}
modules['/lua/user/prefs.lua'] = { GetFromCurrentProfile = function(k) return UI.prefs[k] end, SetToCurrentProfile = function(k, v) UI.prefs[k] = v end }
function SavePreferences() UI.saved = (UI.saved or 0) + 1 end
function SessionGetScenarioInfo() return { file = '/maps/Test/Test_scenario.lua' } end
function SimCallback(t) UI.callback = t end
function import(path) return modules[path] or {} end
function GetFrame(i) return control() end
function GetArmiesTable() return { armiesTable = { { human = true }, { human = false } } } end
function SessionIsReplay() return false end
function IN_AddKeyMapTable(t) UI.bound = t end
function ForkThread(f) end
function PlaySound() end
function Sound(t) return t end
"""

DEFAULTS = {
    "LEVEL": "1", "RAIDS": "true", "PERSONALITY": "balanced", "AIR": "true", "MICRO": "true",
    "BUILD": "true", "COUNTER": "true", "TEAM": "true", "ADAPTIVE": "true", "STATUS": "true", "LEARN": "true",
}


def moho_to_lua(code: str) -> str:
    """O dialeto do jogo aceita `for k, v in tabela do` e `!=`; o Lua normal precisa de pairs()."""
    code = code.replace("!=", "~=")

    def fix(m):
        names, expr = m.group(1), m.group(2).strip()
        if expr.startswith(("ipairs(", "pairs(")):
            return m.group(0)
        return f"for {names} in pairs({expr}) do"

    return re.sub(r"for ([\w, ]+) in (.+?) do\b", fix, code)


HARNESS = r"""
table.getn = table.getn or function(t) return #t end
math.mod = math.mod or math.fmod
World = { time = 0, units = {}, orders = {}, nextId = 1, factoryQueue = {}, built = {}, given = {}, loads = 0 }
Sync = {}

function GetGameTimeSeconds() return World.time end
function VDist2(x1, z1, x2, z2) return math.sqrt((x1 - x2) ^ 2 + (z1 - z2) ^ 2) end
function GetSurfaceHeight(x, z) return 0 end
function WaitSeconds(s) coroutine.yield(s) end
World.threads = {}
function ForkThread(f, ...)
    local args = { ... }
    local unpack = table.unpack or unpack
    table.insert(World.threads, coroutine.create(function() f(unpack(args)) end))
end
function RunThreads()
    for _, co in ipairs(World.threads) do
        if coroutine.status(co) ~= 'dead' then
            local ok, err = coroutine.resume(co)
            if not ok then World.warn = (World.warn or '') .. 'thread: ' .. tostring(err) .. '\n' end
        end
    end
end
function Random(a, b) return a end
function LOG(s) end
function WARN(s) World.warn = (World.warn or '') .. s .. '\n' end
function ParseEntityCategory(expr) return expr end

function HasCat(u, expr)
    for tok in string.gmatch(expr, '%S+') do
        local neg = string.sub(tok, 1, 1) == '-'
        local name = neg and string.sub(tok, 2) or tok
        local has = u.cats[name] == true
        if neg == has then return false end
    end
    return true
end
function EntityCategoryContains(cat, u) return HasCat(u, cat) end

Teams = { [1] = 1, [2] = 2, [3] = 1 }
function IsEnemy(a, b) return Teams[a] ~= Teams[b] end
function IsAlly(a, b) return a ~= b and Teams[a] == Teams[b] end
function ArmyIsCivilian(a) return false end

local UnitMT = { __index = {
    IsDead = function(self) return self.dead end,
    IsBeingBuilt = function(self) return self.building end,
    IsUnitState = function(self, s) return s == 'Attached' and self.attached or false end,
    GetHealth = function(self) return self.hp end,
    GetMaxHealth = function(self) return self.maxhp end,
    GetBlueprint = function(self) return self.bp end,
    GetPosition = function(self) return { self.x, 0, self.z } end,
    CanBuild = function(self, id) return self.canBuild and self.canBuild[id] or false end,
    GetNavigator = function(self)
        local u = self
        return { CanPathToGoal = function(_, pos)
            if u.cats.NAVAL then return pos[1] < 100 end -- water only on the west side
            return pos[1] < 600                       -- an island beyond x = 600
        end }
    end,
} }

function NewUnit(army, cats, x, z, threat, opts)
    opts = opts or {}
    local u = setmetatable({
        id = World.nextId, army = army, x = x, z = z, dead = false, building = false,
        hp = opts.hp or 300, maxhp = 300, cats = {}, canBuild = opts.canBuild,
        bp = { Defense = { SurfaceThreatLevel = threat, AirThreatLevel = opts.air or 0 }, Physics = { MaxSpeed = opts.speed or 3 } },
    }, UnitMT)
    for tok in string.gmatch(cats, '%S+') do u.cats[tok] = true end
    World.nextId = World.nextId + 1
    table.insert(World.units, u)
    return u
end

local function brainOf(index, kind, start)
    local b = { index = index, BrainType = kind, DifficultyLevel = 2, start = start, Nickname = 'Army' .. index }
    function b:GetArmyIndex() return self.index end
    function b:GetFactionIndex() return 1 end
    function b:IsDefeated() return false end
    function b:GetArmyStartPos() return self.start[1], self.start[2] end
    function b:GetEconomyStored(kind) return World.mass or 1000 end
    function b:GiveResource(kind, n) World.given[kind] = (World.given[kind] or 0) + n end
    function b:GetListOfUnits(cat, _)
        local out = {}
        for _, u in ipairs(World.units) do
            if u.army == self.index and not u.dead and HasCat(u, cat) then table.insert(out, u) end
        end
        return out
    end
    function b:GetUnitsAroundPoint(cat, pos, r, who)
        local out = {}
        for _, u in ipairs(World.units) do
            local wanted = (who == 'Enemy' and IsEnemy(self.index, u.army)) or (who ~= 'Enemy' and u.army == self.index)
            if not u.dead and wanted and HasCat(u, cat) and VDist2(u.x, u.z, pos[1], pos[3]) <= r then
                table.insert(out, u)
            end
        end
        return out
    end
    function b:MakePlatoon() return {} end
    function b:PlatoonExists(p) return p ~= nil end
    function b:AssignUnitsToPlatoon(p, units) end
    function b:CanBuildStructureAt(id, pos) return true end
    function b:BuildStructure(eng, id, loc, _) table.insert(World.built, { id = id, x = loc[1], z = loc[2] }) end
    return b
end
ArmyBrains = { brainOf(1, 'AI', { 50, 50 }), brainOf(2, 'Human', { 450, 450 }) }
function AddAllyAI() ArmyBrains[3] = brainOf(3, 'AI', { 50, 300 }) end

local function record(kind, units, pos, target)
    for _, u in ipairs(units) do
        World.orders[u.id] = World.orders[u.id] or {}
        table.insert(World.orders[u.id], { kind = kind, pos = pos, target = target })
        if pos then u.x, u.z = pos[1] + (u.id % 5), pos[3] + (u.id % 3) end
    end
end
function IssueClearCommands(units) for _, u in ipairs(units) do World.orders[u.id] = {} end end
function IssueMove(units, pos) record('move', units, pos) end
function IssueAggressiveMove(units, pos) record('attack', units, pos) end
function IssueAttack(units, target) record('focus', units, nil, target) end
function IssueGuard(units, target) record('guard', units, nil, target) end
function IssueBuildFactory(f, id, n) table.insert(World.factoryQueue, { id = id, n = n }) end
function IssueTransportLoad(units, transport) World.loads = World.loads + 1 end
function IssueTransportUnload(transports, pos) World.unload = pos end

function Last(u)
    local l = World.orders[u.id]
    if not l then return nil end
    return l[#l]
end
function First(u)
    local l = World.orders[u.id]
    if not l then return nil end
    return l[1]
end
"""


class Scenario:
    def __init__(self, **cfg):
        self.lua = LuaRuntime(unpack_returned_tuples=True)
        self.lua.execute(HARNESS)
        if cfg.pop("ally", False):
            self.lua.execute("AddAllyAI()")
        code = SRC
        for k, v in {**DEFAULTS, **{k.upper(): v for k, v in cfg.items()}}.items():
            code = code.replace(f"@{k}@", v)
        self.lua.execute(moho_to_lua(code))
        self.g = self.lua.globals()
        self.W = self.g.World
        raw_new = self.g.NewUnit
        lua = self.lua

        def new(army, cats, x, z, threat, opts=None):
            if opts is None:
                return raw_new(army, cats, x, z, threat)
            conv = {k: (lua.table_from(v) if isinstance(v, dict) else v) for k, v in opts.items()}
            return raw_new(army, cats, x, z, threat, lua.table_from(conv))

        self.new = new
        armies = [1, 3] if self.g.ArmyBrains[3] else [1]
        for a in armies:
            self.lua.execute(f"CO{a} = coroutine.create(function() CPCommanderRun(ArmyBrains[{a}], {{ArmyBrains[{a}].start[1], 0, ArmyBrains[{a}].start[2]}}) end)")
        self.resume = self.lua.eval(
            "function(a) local co = _G['CO' .. a] local ok, err = coroutine.resume(co) return ok, err end")
        self.armies = armies
        self.step(0)

    def step(self, seconds=4, times=1):
        for _ in range(times):
            self.W.time = self.W.time + seconds
            for a in self.armies:
                ok, err = self.resume(a)
                if not ok:
                    raise SystemExit(f"Lua error: {err}")
            self.g.RunThreads()

    def last(self, u):
        return self.g.Last(u)

    def first(self, u):
        return self.g.First(u)


fails = []


def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond:
        fails.append(msg)


def basics():
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false", team="false")
    new = s.new
    for i in range(6):
        new(2, "STRUCTURE DEFENSE", 440 + i, 440, 30)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 300, 120, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 305, 125, 0)
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    tanks = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(3)]
    s.step()
    o = s.last(tanks[0])
    check(o is not None and o.kind == "attack" and o.pos[1] < 200, "3 tanques ficam no ponto de emboscada")
    tanks += [new(1, "MOBILE LAND", 70 + i, 70, 3) for i in range(9)]
    s.step(times=4)
    o = s.last(tanks[0])
    check(o.kind == "attack" and abs(o.pos[1] - 300) < 20 and abs(o.pos[3] - 120) < 20, "12 tanques atacam os extratores sem defesa")
    for u in list(s.W.units.values()):
        if u.army == 2 and u.cats["MASSEXTRACTION"]:
            u.dead = True
    s.step(times=3)
    o = s.last(tanks[0])
    check(not (o.kind == "attack" and o.pos[1] > 400), "não ataca a fortaleza bem defendida")
    raiders = [new(2, "MOBILE LAND", 55 + i, 52, 2) for i in range(3)]
    s.step()
    o = s.last(tanks[0])
    check(o.kind == "attack" and abs(o.pos[1] - 50) < 20, "defende a base de um ataque")
    for r in raiders:
        r.dead = True
    tanks[1].hp = 50
    s.step()
    o = s.last(tanks[1])
    check(o.kind == "move" and abs(o.pos[1] - 50) < 1, "tanque ferido volta para casa")
    tanks[1].hp = 300
    new(2, "STRUCTURE MASSEXTRACTION", 250, 250, 0)
    s.step(times=3)
    o = s.last(tanks[0])
    if o.kind == "attack" and o.pos[1] > 200:
        for i in range(10):
            new(2, "MOBILE LAND", o.pos[1] + i, o.pos[3], 10)
        s.step()
        check(s.last(tanks[0]).kind == "move", "recua quando a luta fica ruim")
    else:
        check(False, "esperava um ataque ao novo extrator")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def micro_pincer_escort():
    # focus fire: two enemy units near the army in a fight; the weakest is focused
    s = Scenario(air="false", build="false", counter="false", adaptive="false", personality="defensive")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 300, 120, 0)
    new(2, "STRUCTURE DEFENSE", 302, 121, 4)
    tanks = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(12)]
    arty = new(1, "MOBILE LAND INDIRECTFIRE", 58, 58, 3)
    s.step(times=4)
    o = s.last(tanks[0])
    check(o.kind == "attack" and abs(o.pos[1] - 300) < 20, "exército ataca (cenário de micro)")
    weak = new(2, "MOBILE LAND", tanks[0].x + 3, tanks[0].z, 0.5, {"hp": 40})
    new(2, "MOBILE LAND", tanks[0].x + 5, tanks[0].z, 0.5)
    s.step()
    focused = [t for t in tanks if s.first(t) and s.first(t).kind == "focus" and s.first(t).target.id == weak.id]
    check(len(focused) >= 6, f"foco de fogo na unidade mais fraca ({len(focused)} tanques)")
    a = s.last(arty)
    check(a is not None and a.kind == "attack" and a.pos[1] < tanks[0].x, "artilharia fica atrás da linha de frente")

    # pincer: a big army against a far target splits in two
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false", personality="aggressive")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 420, 420, 0)
    tanks = [new(1, "MOBILE LAND", 60 + i % 6, 60 + i // 6, 3) for i in range(16)]
    s.step()
    kinds = [s.first(t).kind if s.first(t) else None for t in tanks]
    flank = sum(1 for t in tanks if s.first(t) and s.first(t).kind == "move" and s.last(t).kind == "attack")
    check(flank >= 6, f"ataque em pinça: metade vem pelo flanco ({flank} tanques; {kinds[:4]})")

    # experimental: the army guards it
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 300, 120, 0)
    new(2, "STRUCTURE DEFENSE", 302, 121, 4)
    exp = new(1, "MOBILE LAND EXPERIMENTAL", 60, 60, 60)
    tanks = [new(1, "MOBILE LAND", 62 + i, 62, 3) for i in range(8)]
    s.step(times=4)
    check(s.last(exp) and s.last(exp).kind == "attack", "experimental lidera o ataque")
    guards = sum(1 for t in tanks if s.last(t) and s.last(t).kind == "guard" and s.last(t).target.id == exp.id)
    check(guards >= 6, f"exército escolta o experimental ({guards})")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def air_acu_counter_bases():
    s = Scenario(build="true", counter="true", adaptive="false")
    new = s.new
    s.W.time = 400
    new(1, "STRUCTURE FACTORY", 50, 50, 0, {"canBuild": {"uua0101": True, "uul0101": True, "uul0102": True}})
    # an expansion of ours far from home, and engineers
    new(1, "STRUCTURE MASSEXTRACTION", 200, 200, 0)
    new(1, "STRUCTURE MASSEXTRACTION", 205, 205, 0)
    eng = new(1, "ENGINEER MOBILE LAND", 60, 60, 0)
    new(1, "ENGINEER MOBILE LAND", 62, 60, 0)
    # enemy: air force and an undefended extractor field
    for i in range(12):
        new(2, "MOBILE AIR", 400 + i, 400, 3, {"air": 0})
    new(2, "STRUCTURE MASSEXTRACTION", 300, 120, 0)
    # our air force
    fighters = [new(1, "MOBILE AIR FIGHTER ANTIAIR", 50 + i, 50, 0, {"air": 6}) for i in range(4)]
    bombers = [new(1, "MOBILE AIR BOMBER", 50 + i, 52, 4) for i in range(3)]
    acu = new(1, "COMMAND MOBILE LAND", 120, 120, 8, {"hp": 90})
    for i in range(4):
        new(2, "MOBILE LAND", 122 + i, 122, 5)
    s.step(times=2)
    f = s.last(fighters[2])
    check(f is not None and f.kind == "attack" and f.pos[1] >= 390, "caças caçam a aviação inimiga quando são mais fortes")
    b = s.first(bombers[0])
    check(b is not None and b.kind == "attack" and abs(b.pos[1] - 300) < 20, "bombardeiros atacam o extrator sem antiaéreo")
    a = s.last(acu)
    check(a is not None and a.kind == "move" and abs(a.pos[1] - 50) < 1, "comandante (ACU) ferido foge para a base")
    ids = [q.id for q in s.W.factoryQueue.values()]
    check("uua0101" in ids, f"contra-produção: caças contra a aviação inimiga ({ids})")
    # an attack on the expansion: a tower goes up there
    for i in range(5):
        new(2, "MOBILE LAND", 210 + i, 210, 3)
    s.step(times=2)
    towers = [b.id for b in s.W.built.values()]
    check("uub0101" in towers, f"torre construída na expansão atacada ({towers})")
    check(not s.W.warn, f"sem erros ({s.W.warn})")

    # forward outpost: after 5 minutes, a factory at the expansion nearest the enemy
    s = Scenario(build="true", counter="false", adaptive="false", air="false")
    new = s.new
    s.W.time = 400
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(1, "STRUCTURE MASSEXTRACTION", 250, 250, 0)
    new(1, "STRUCTURE MASSEXTRACTION", 255, 252, 0)
    new(1, "ENGINEER MOBILE LAND", 60, 60, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    s.step(times=2)
    built = [b.id for b in s.W.built.values()]
    check("uub0001" in built, f"posto avançado com fábrica perto da frente ({built})")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def drop_team_adaptive_status():
    # island target: transports carry the army
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 650, 120, 0)
    new(1, "MOBILE AIR TRANSPORTATION", 55, 55, 0)
    for i in range(10):
        new(1, "MOBILE LAND", 60 + i, 60, 3)
    s.step(times=4)
    check(s.W.loads >= 1 and s.W.unload is not None and s.W.unload[1] > 550, "desembarque na ilha que não dá para alcançar por terra")

    # team: the allied AI is attacked near us; our army goes to help
    s = Scenario(ally=True, micro="false", air="false", build="false", counter="false", adaptive="false")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(3, "STRUCTURE FACTORY", 50, 300, 0)
    tanks = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(8)]
    s.step()
    for i in range(3):
        new(2, "MOBILE LAND", 52 + i, 300, 2)
    s.step(times=2)
    o = s.last(tanks[0])
    check(o is not None and o.kind == "attack" and abs(o.pos[3] - 300) < 30, "ajuda o aliado atacado")

    # adaptive: the human is far stronger -> pressure and a small boost
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="true")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(1, "MOBILE LAND", 60, 60, 3)
    for i in range(20):
        new(2, "MOBILE LAND", 440 + i, 440, 5)
    s.step(times=2)
    check((s.W.given["MASS"] or 0) > 0, "dificuldade adaptativa dá um reforço quando o humano está muito à frente")
    st = s.g.Sync.CPAIStatus
    entry = st and st[1]
    check(entry is not None and entry.adaptive == "pressionando" and entry.personality == "Equilibrada",
          "painel recebe o plano da IA (personalidade e modo adaptativo)")
    check(entry is not None and entry.main.n == 1 and isinstance(entry.plan, str), "painel recebe exército e plano")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def panel():
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(UI_HARNESS)
    lua.execute(moho_to_lua(PANEL.replace("@KEY@", "F4").replace("@PANEL@", "true").replace("@LEARN@", "true")))
    # memory from an earlier match on this map
    lua.execute("""UI.prefs.CPAIMemory = { games = 2, style = { rush = 0.8, air = 0.1 }, firstAttack = 250,
        maps = { ['/maps/test/test_scenario.lua'] = { games = 2, route = { ['2:2'] = 6 }, hit = { ['1:1'] = 4 }, expand = {} } } }""")
    g = lua.globals()
    g.CPAIPanelInit()
    cb = g.UI.callback
    check(cb is not None and cb.Func == "CPAIMemory" and cb.Args.games == 2 and cb.Args.route["2:2"] == 6,
          "memória de partidas anteriores volta para a IA no começo (com as rotas deste mapa)")
    check(g.UI.bound is not None and g.UI.bound["F4"] is not None, "painel: tecla F4 registrada")
    check(len(g.UI.beats) == 1, "painel: acompanha o jogo a cada batida")
    lua.execute("""Sync = { CPAIStatus = { [3] = { name = 'Mr. Cow', personality = 'Agressiva', plan = 'atacando', adaptive = 'normal',
        minUnits = 9, acu = 'na base', intel = { air = 4, land = 30, naval = 0 },
        main = { n = 14, power = 52, state = 'atacando' }, raid = { n = 0, power = 0, state = 'na emboscada' },
        fleet = { n = 0, power = 0, state = 'na emboscada' }, drop = { n = 0, power = 0, state = 'na emboscada' },
        fighters = { n = 4, power = 24, state = 'cobrindo o exercito' }, bombers = { n = 0, power = 0, state = 'na emboscada' },
        gunships = { n = 2, power = 8, state = 'atacando' } } } }""")
    g.UI.beats[1]()
    g.CPAIPanelToggle()
    texts = [t.text for t in g.UI.texts.values() if t.text and not t.hidden]
    joined = " | ".join(texts)
    check("Mr. Cow  -  Agressiva  -  normal" in joined, "painel mostra nome, personalidade e modo")
    check("Exercito 14 (forca 52, atacando)" in joined and "Cacas 4" in joined, f"painel mostra exército e aviação ({joined[:160]})")
    check(g.UI.printed is None, f"painel sem erro ({g.UI.printed})")
    # the model of this match arrives and is kept, blended with the earlier matches
    lua.execute("""Sync = { CPAIModel = { style = { rush = 0.2, air = 0.9 }, firstAttack = 600, route = { ['3:3'] = 10 }, hit = {}, expand = {} } }""")
    g.UI.beats[1]()
    mem = g.UI.prefs.CPAIMemory
    check(mem.games == 3 and 0.3 < mem.style.air < 0.9 and mem.style.rush < 0.8, f"memória misturada com a partida atual (ar {mem.style.air}, rush {mem.style.rush})")
    m = mem.maps["/maps/test/test_scenario.lua"]
    check(m.route["3:3"] is not None and m.route["2:2"] is not None, "rotas do mapa guardadas (antigas e novas)")
    g.CPAIForget()
    check(g.UI.prefs.CPAIMemory is None, "botão esquecer apaga a memória")


def player_model():
    # an air player who attacks early: the AI notices and answers
    s = Scenario(micro="false", build="true", counter="true", adaptive="false")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0, {"canBuild": {"uua0101": True, "uul0105": True, "uul0101": True, "uua0102": True}})
    new(1, "STRUCTURE MASSEXTRACTION", 200, 60, 0)
    new(1, "ENGINEER MOBILE LAND", 60, 60, 0)
    for i in range(6):
        new(2, "MOBILE AIR GROUNDATTACK", 400 + i, 400, 3, {"air": 0})
    s.step(times=4)  # model starts after 15 s
    raid = [new(2, "MOBILE LAND", 195 + i, 62, 3) for i in range(6)]
    s.step(times=3)
    M = s.g.CPAI.model
    check(bool(M.firstAttack) and M.firstAttack < 300, f"modelo nota o ataque cedo ({M.firstAttack})")
    check(M.style.rush > 0.5, f"modelo classifica rush ({M.style.rush:.2f})")
    check(M.style.air > 0.3, f"modelo nota a aviação do jogador ({M.style.air:.2f})")
    check(len(list(M.hit.keys())) > 0, "modelo guarda onde o jogador ataca")
    for r in raid:
        r.dead = True
    s.W.factoryQueue = s.lua.table()
    s.step(times=8)
    ids = [q.id for q in s.W.factoryQueue.values()]
    check("uua0101" in ids, f"contra a aviação do jogador: caças ({ids})")
    st = s.g.Sync.CPAIStatus[1]
    check(st.learned is not None and "rush" in st.learned.style, f"painel mostra o estilo aprendido ({st.learned.style if st.learned else None})")
    mem = s.g.CPAIModelMemory()
    check(mem.firstAttack is not None and mem.style.rush > 0.5, "memória para a próxima partida")

    # rush expected (from memory): the army waits close to home and towers go up early
    s = Scenario(micro="false", air="false", counter="false", adaptive="false", build="true")
    new = s.new
    s.g.CPAIReceiveMemory(s.lua.eval("{ games = 3, style = { rush = 0.9 }, firstAttack = 240, route = { ['3:3'] = 8 } }"))
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(1, "ENGINEER MOBILE LAND", 60, 60, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    new(2, "MOBILE LAND", 455, 455, 3)
    tanks = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(3)]
    s.step(times=5)
    o = s.last(tanks[0])
    check(o is not None and o.pos[1] < 110, f"rush esperado: exército espera perto de casa ({o.pos[1] if o else None})")
    built = [b.id for b in s.W.built.values()]
    check("uub0101" in built, f"rush esperado: torre em casa antes do ataque ({built})")

    # ambush on the route the player uses
    s = Scenario(micro="false", air="false", counter="false", adaptive="false", build="false")
    new = s.new
    s.g.CPAIReceiveMemory(s.lua.eval("{ games = 3, style = { air = 0.2 }, route = { ['1:3'] = 20 } }"))
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    new(2, "MOBILE LAND", 455, 455, 3)
    tanks = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(3)]
    s.step(times=5)
    o = s.last(tanks[0])
    check(o is not None and abs(o.pos[1] - 75) < 10 and abs(o.pos[3] - 175) < 10,
          f"emboscada na rota que o jogador usa ({[o.pos[1], o.pos[3]] if o else None})")

    # raider: a guard stays where the player strikes
    s = Scenario(micro="false", air="false", counter="false", adaptive="false", build="false")
    new = s.new
    s.g.CPAIReceiveMemory(s.lua.eval("{ games = 3, style = { raider = 0.9 }, hit = { ['4:1'] = 10 } }"))
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(1, "STRUCTURE MASSEXTRACTION", 225, 75, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    new(2, "MOBILE LAND", 455, 455, 3)
    for i in range(10):
        new(1, "MOBILE LAND", 60 + i, 60, 3)
    s.step(times=6)
    g = s.g.CPAI.commanders[1].squads.guard
    n = len(list(g.members.values())) if g.members else 0
    check(n >= 3 and g.post is not None and abs(g.post[1] - 225) < 5, f"guarda fica onde o saqueador ataca ({n} unidades)")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def main() -> int:
    panel()
    player_model()
    basics()
    micro_pincer_escort()
    air_acu_counter_bases()
    drop_team_adaptive_status()
    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
