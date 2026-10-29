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
math.mod = math.mod or math.fmod
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
function ForkThread(f) UI.threads = (UI.threads or 0) + 1 end
function WaitFrames() end
UI.time = 0
function GetGameTimeSeconds() return UI.time end
function PlaySound() end
function Sound(t) return t end
"""

DEFAULTS = {
    "LEVEL": "1", "RAIDS": "true", "PERSONALITY": "balanced", "AIR": "true", "MICRO": "true",
    "BUILD": "true", "COUNTER": "true", "TEAM": "true", "ADAPTIVE": "true", "STATUS": "true", "LEARN": "true",
    "AGGRESSION": "1", "DISTRICTS": "1", "AIRBIAS": "1", "NAVALBIAS": "1", "TIPS": "false", "CHAT": "false",
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
function VDist2(x1, z1, x2, z2)
    if World.boom then error('boom (teste)') end
    return math.sqrt((x1 - x2) ^ 2 + (z1 - z2) ^ 2)
end
World.hills = {}
function GetTerrainHeight(x, z)
    if World.terrain then return World.terrain(x, z) end
    for _, h in ipairs(World.hills) do
        if VDist2(x, z, h[1], h[2]) < h[3] then return h[4] end
    end
    return 0
end
function GetSurfaceHeight(x, z)
    if World.sea and World.sea(x, z) then return GetTerrainHeight(x, z) + 5 end
    return GetTerrainHeight(x, z)
end
World.markers = {}
function import(path)
    if string.find(string.lower(path), 'scenarioutilities') then
        return { GetMarkersByType = function(kind) return World.markers[kind] or {} end }
    end
    return {}
end
function WaitSeconds(s) coroutine.yield(s) end
function WaitTicks(n) coroutine.yield(n) end
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
    IsIdleState = function(self) return not self.busy end,
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
    function b:GetEconomyStored(kind)
        if kind == 'ENERGY' and World.energy then return World.energy end
        return World.mass or 1000
    end
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
    function b:AssignUnitsToPlatoon(p, units)
        if p and p.name == 'ArmyPool' then World.pooled = (World.pooled or 0) + #units end
    end
    function b:GetPlatoonUniquelyNamed(n) return { name = n } end
    function b:CanBuildStructureAt(id, pos) return true end
    b.SkirmishAISystem = { needs = {} }
    function b.SkirmishAISystem:ResearchNeed(n) table.insert(self.needs, n) end
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
function IssueTransportLoad(units, transport)
    World.loads = World.loads + 1
    for _, u in ipairs(units) do u.attached = transport end
end
function IssueTransportUnload(transports, pos)
    World.unload = pos
    for _, u in ipairs(World.units) do
        for _, tr in ipairs(transports) do
            if u.attached == tr then u.attached = false; u.x, u.z = pos[1], pos[3]; World.landed = (World.landed or 0) + 1 end
        end
    end
end
function IssueRepair(units, target) World.repaired = target end

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
            "function(a) local co = _G['CO' .. a] if coroutine.status(co) == 'dead' then return true, nil end "
            "local ok, err = coroutine.resume(co) return ok, err end")
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
    # (enemy units below 1 of power, like scouts, are not worth a focus)
    weak = new(2, "MOBILE LAND", tanks[0].x + 3, tanks[0].z, 1.5, {"hp": 40})
    new(2, "MOBILE LAND", tanks[0].x + 5, tanks[0].z, 1.5)
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
    # enemy: air force (seen by a scout of ours) and an undefended extractor field
    for i in range(12):
        new(2, "MOBILE AIR", 400 + i, 400, 3, {"air": 0})
    new(1, "STRUCTURE RADAR", 390, 390, 0)
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
    check(g.UI.callback is None, "memória espera a simulação começar (não vai durante a montagem da tela)")
    lua.execute("Sync = {} UI.time = 3")
    g.CPAIPanelPoll()
    cb = g.UI.callback
    check(cb is not None and cb.Func == "CPAIMemory" and cb.Args.games == 2 and cb.Args.route["2:2"] == 6,
          "memória de partidas anteriores volta para a IA no começo (com as rotas deste mapa)")
    check(g.UI.bound is not None and g.UI.bound["F4"] is not None, "painel: tecla F4 registrada")
    check(len(g.UI.beats) == 0 and g.UI.threads == 2, "painel: acompanha o jogo a cada quadro (sem as batidas do gamemain, que o PC não chama)")
    lua.execute("""Sync = { CPAIStatus = { [3] = { name = 'Mr. Cow', personality = 'Agressiva', plan = 'atacando', adaptive = 'normal',
        minUnits = 9, acu = 'na base', intel = { air = 4, land = 30, naval = 0 },
        main = { n = 14, power = 52, state = 'atacando' }, raid = { n = 0, power = 0, state = 'na emboscada' },
        fleet = { n = 0, power = 0, state = 'na emboscada' }, drop = { n = 0, power = 0, state = 'na emboscada' },
        fighters = { n = 4, power = 24, state = 'cobrindo o exercito' }, bombers = { n = 0, power = 0, state = 'na emboscada' },
        gunships = { n = 2, power = 8, state = 'atacando' }, time = 10 } } }""")
    g.CPAIPanelPoll()
    g.CPAIPanelToggle()
    texts = [t.text for t in g.UI.texts.values() if t.text and not t.hidden]
    joined = " | ".join(texts)
    check("Mr. Cow  -  Agressiva  -  normal" in joined, "painel mostra nome, personalidade e modo")
    check("Exercito 14 (forca 52, atacando)" in joined and "Cacas 4" in joined, f"painel mostra exército e aviação ({joined[:160]})")
    check(g.UI.printed is None, f"painel sem erro ({g.UI.printed})")
    # the model of this match arrives and is kept, blended with the earlier matches
    lua.execute("""Sync = { CPAIModel = { seq = 1, style = { rush = 0.2, air = 0.9 }, firstAttack = 600, route = { ['3:3'] = 10 }, hit = {}, expand = {} } }""")
    g.CPAIPanelPoll()
    g.CPAIPanelPoll()  # the same model again (sent on every tick): kept only once
    check(g.UI.prefs.CPAIMemory.games == 3, "o mesmo modelo repetido é guardado uma vez só")
    mem = g.UI.prefs.CPAIMemory
    check(mem.games == 3 and 0.3 < mem.style.air < 0.9 and mem.style.rush < 0.8, f"memória misturada com a partida atual (ar {mem.style.air}, rush {mem.style.rush})")
    m = mem.maps["/maps/test/test_scenario.lua"]
    check(m.route["3:3"] is not None and m.route["2:2"] is not None, "rotas do mapa guardadas (antigas e novas)")
    g.CPAIForget()
    check(g.UI.prefs.CPAIMemory is None, "botão esquecer apaga a memória")
    check(g.UI.callback is not None and g.UI.callback.Func == "CPAIForget", "botão esquecer também zera a IA da partida")
    # an AI that stops sending its plan (defeated) leaves the panel after about a minute
    lua.execute("""UI.time = 120 Sync = { CPAIStatus = { [4] = { name = 'Outra', personality = 'Naval', plan = 'atacando', adaptive = 'normal',
        minUnits = 9, acu = 'na base', intel = { air = 0, land = 0, naval = 0 }, time = 110 } } }""")
    g.CPAIPanelPoll()
    texts = [t.text for t in g.UI.texts.values() if t.text and not t.hidden]
    check(not any("Mr. Cow" in t for t in texts), "IA derrotada sai do painel")
    # partida grande: com muitas IAs, uma linha por IA
    lua.execute("""UI.time = 130 local st = {}
        for i = 2, 24 do st[i] = { name = 'IA ' .. i, personality = 'Naval', plan = 'atacando', adaptive = 'normal', minUnits = 9,
            acu = 'na base', intel = { air = 0, land = 0, naval = 0 }, main = { n = i, power = 1, state = 'atacando' }, time = 125 } end
        Sync = { CPAIStatus = st }""")
    g.CPAIPanelPoll()
    texts = [t.text for t in g.UI.texts.values() if t.text and not t.hidden and t.text.startswith("IA ")]
    check(len(texts) >= 23 and "IA 24  -  atacando   (exercito 24)" in texts, f"partida grande: uma linha por IA no painel ({len(texts)})")


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


def terrain_losses_research():
    # a hill next to the ambush point: the army waits on top of it
    s = Scenario(micro="false", air="false", counter="false", adaptive="false", build="false")
    new = s.new
    s.lua.execute("table.insert(World.hills, { 156, 181, 9, 15 })")
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    tanks = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(3)]
    s.step(times=3)
    o = s.last(tanks[0])
    check(o is not None and abs(o.pos[1] - 156) < 6 and abs(o.pos[3] - 181) < 6, f"emboscada no alto do morro ({[o.pos[1], o.pos[3]] if o else None})")

    # losses mark a dangerous place
    for t in tanks[:2]:
        t.dead = True
    s.step()
    kills = s.g.CPAI.commanders[1].kills
    check(len(list(kills.keys())) > 0, "lembra onde perdeu tropas (zona de perigo)")

    # an air player: anti-air research; a damaged building gets repaired
    s = Scenario(micro="false", counter="false", adaptive="false", build="false")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    hurt = new(1, "STRUCTURE MASSEXTRACTION", 70, 70, 0, {"hp": 100})
    new(1, "ENGINEER MOBILE LAND", 60, 60, 0)
    for i in range(10):
        new(2, "MOBILE AIR GROUNDATTACK", 400 + i, 400, 3, {"air": 0})
    s.step(times=16)
    needs = list(s.g.ArmyBrains[1].SkirmishAISystem.needs.values())
    check("NeedAAUpgrade" in needs, f"pesquisa antiaéreo contra jogador aéreo ({needs})")
    check(s.W.repaired is not None and s.W.repaired.id == hurt.id, "engenheiro conserta o prédio danificado")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def review_fixes():
    # drop: the group boards, flies, lands next to the island and attacks there
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 650, 120, 0)
    tr = new(1, "MOBILE AIR TRANSPORTATION", 55, 55, 0)
    tanks = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(10)]
    s.step(times=6)
    landed = [t for t in tanks if t.x > 550]
    check(s.W.landed and s.W.landed >= 1 and len(landed) >= 1, f"desembarque: tropa embarca, voa e desce na ilha ({len(landed)} no chão)")
    o = s.last(landed[0]) if landed else None
    check(o is not None and o.kind == "attack" and o.pos[1] > 600, "desembarque: quem desceu ataca o alvo da ilha")
    check(not tr.CPBusy, "transporte fica livre depois do desembarque")
    check(not s.W.warn, f"sem erros ({s.W.warn})")

    # a lone scout near the base does not pull the army home
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(1, "STRUCTURE MASSEXTRACTION", 150, 50, 0)
    for i in range(6):
        new(1, "MOBILE LAND", 100 + i, 100, 3)
    new(2, "MOBILE LAND", 155, 55, 1)
    s.step(times=3)
    st = s.g.CPCommanderState(1)
    check(st != "defend" and st != "home", f"um batedor sozinho não puxa o exército para casa ({st})")

    # a strong attack: the army goes home and stays there (no back and forth)
    for i in range(12):
        new(2, "MOBILE LAND", 150 + i, 60, 5)
    states = []
    for _ in range(4):
        s.step()
        states.append(s.g.CPCommanderState(1))
    check(all(x == "home" for x in states), f"ataque forte: exército volta e fica em casa ({states})")

    # bombers pick a new target when theirs is gone
    s = Scenario(micro="false", build="false", counter="false", adaptive="false")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    a = new(2, "STRUCTURE MASSEXTRACTION", 300, 120, 0)
    bombers = [new(1, "MOBILE AIR BOMBER", 50 + i, 52, 4) for i in range(3)]
    s.step(times=2)
    first = s.first(bombers[0])
    check(first is not None and abs(first.pos[1] - 300) < 20, "bombardeiros vão ao primeiro alvo")
    a.dead = True
    new(2, "STRUCTURE MASSEXTRACTION", 200, 330, 0)
    s.step(times=3)
    o = s.first(bombers[0])
    check(o is not None and abs(o.pos[1] - 200) < 20 and abs(o.pos[3] - 330) < 20,
          "bombardeiros trocam de alvo quando o antigo some")

    # forget: the in-game model is reset too
    s = Scenario()
    s.g.CPAIReceiveMemory(s.lua.table_from({"style": s.lua.table_from({"rush": 0.9, "air": 0.8}), "games": 3}))
    before = s.g.CPAIModelSummary().style
    s.g.CPAIForgetModel()
    after = s.g.CPAIModelSummary().style
    check(before != "ainda aprendendo" and after == "ainda aprendendo", f"esquecer zera o modelo na partida ({before} -> {after})")

    # repeated errors: the units go back to the game's own AI and the commander stops
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false")
    new = s.new
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    for i in range(6):
        new(1, "MOBILE LAND", 100 + i, 100, 3)
    s.step(times=2)
    s.W.boom = True
    s.step(times=8)
    s.W.boom = False
    check((s.W.pooled or 0) >= 6, f"erros repetidos: unidades voltam para a IA original ({s.W.pooled})")
    check("stopped" in (s.W.warn or ""), "erros repetidos: comandante para e avisa no log")
    s.g.RunThreads()
    st = s.g.Sync.CPAIStatus[1]
    check(st is not None and st.stopped and st.error and "boom" in st.error,
          f"erros repetidos: o painel mostra o erro e que a IA original assumiu ({st.error if st else None})")


def districts():
    """Bairros em volta da base principal: bastiões virados para o inimigo em chão bom, prédios
    espalhados em lotes, engenheiros próprios e nada onde o terreno é ruim ou há perigo."""
    s = Scenario(build="true", counter="false", adaptive="false", air="false", team="false")
    new = s.new
    s.lua.execute("ScenarioInfo = { size = { 1024, 1024 } }")
    s.lua.execute("ArmyBrains[1].start = { 300, 300 } ArmyBrains[2].start = { 800, 800 }")
    s.lua.execute("CPAI.commanders[1].home = { 300, 0, 300 }")
    # a rough, broken hill west of the base: no district there
    for i in range(12):
        s.lua.execute(f"table.insert(World.hills, {{ {130 + (i % 4) * 14}, {260 + (i // 4) * 30}, 9, {i * 9 % 40} }})")
    new(1, "STRUCTURE FACTORY", 300, 300, 0, {"canBuild": {"uul0002": True}})
    engs = [new(1, "ENGINEER MOBILE LAND", 305 + i, 300, 0) for i in range(4)]
    new(2, "STRUCTURE FACTORY", 800, 800, 0)
    s.W.time = 160
    s.step(times=1)
    c = s.g.CPAI.commanders[1]
    ds = [d for d in (c.districts.values() if c.districts else []) if d.role != "inner"]
    check(len(ds) >= 4, f"planeja vários bairros em volta da base ({len(ds)})")
    roles = [d.role for d in ds]
    check("bastion" in roles and "workshop" in roles, f"bastiões e oficinas ({roles})")
    far = all(((d.pos[1] - 300) ** 2 + (d.pos[3] - 300) ** 2) ** 0.5 > 90 for d in ds)
    check(far, "bairros fora da base principal (não amontoa)")
    gaps = min((((a.pos[1] - b.pos[1]) ** 2 + (a.pos[3] - b.pos[3]) ** 2) ** 0.5 for i, a in enumerate(ds) for b in ds[i + 1:]), default=999)
    check(gaps >= 80, f"bairros espaçados entre si ({gaps:.0f})")
    rough = [d for d in ds if 110 <= d.pos[1] <= 200 and 240 <= d.pos[3] <= 360]
    check(not rough, "nenhum bairro no morro irregular")
    first = ds[0]
    toward = (first.pos[1] - 300) + (first.pos[3] - 300) > 0
    check(first.role == "bastion" and toward, "o primeiro bairro é um bastião virado para o inimigo")
    check(sum(1 for e in engs if e.CPBuilder) >= 2, "engenheiros próprios para os bairros")
    s.step(times=8)
    built = list(s.W.built.values())
    out = [b for b in built if ((b.x - 300) ** 2 + (b.z - 300) ** 2) ** 0.5 > 70]
    check(len(out) >= 3, f"constrói nos bairros ({len(out)} prédios fora da base)")
    ids = {b.id for b in out}
    check("uub0101" in ids and ("uub0202" in ids or "uub0102" in ids), f"torres e escudo/antiaéreo no bastião ({sorted(ids)})")
    close = min((((a.x - b.x) ** 2 + (a.z - b.z) ** 2) ** 0.5 for i, a in enumerate(out) for b in out[i + 1:]), default=999)
    check(close >= 8, f"prédios do bairro em lotes separados ({close:.0f})")
    panel = c.lua_panel if False else s.lua.eval("CPAI.status[1] and CPAI.status[1].districts")
    check(panel is not None and panel.total >= 4, "o painel mostra os bairros")
    # perigo perto de um bairro: não manda engenheiro para lá
    d0 = ds[0]
    for i in range(6):
        new(2, "MOBILE LAND", d0.pos[1] + i, d0.pos[3], 5)
    before = len(list(s.W.built.values()))
    step0 = d0.step
    s.step(times=3)
    check(d0.step == step0, "não constrói no bairro com inimigos por perto")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def districts_plus():
    """Bairros com função (forja, porto, linha de torres na passagem), reconstrução, memória do
    mapa, escudos, rede antiaérea e economia."""
    s = Scenario(build="true", counter="false", adaptive="false", air="false", team="false")
    new = s.new
    s.lua.execute("ScenarioInfo = { size = { 1024, 1024 } }")
    s.lua.execute("ArmyBrains[1].start = { 300, 300 } ArmyBrains[2].start = { 800, 800 }")
    s.lua.execute("CPAI.commanders[1].home = { 300, 0, 300 }")
    # mar a oeste (x < 180) e um cânion estreito na direção do inimigo (paredes baixas)
    s.lua.execute("World.sea = function(x, z) return x < 180 or x > 640 end")
    s.lua.execute("""World.terrain = function(x, z)
        local dx, dz = x - 300, z - 300
        local along = (dx + dz) / 1.4142
        local across = math.abs(dx - dz) / 1.4142
        if along > 70 and along < 400 and across > 30 and across < 140 then return 5 end
        return 0
    end""")
    new(1, "STRUCTURE FACTORY", 300, 300, 0, {"canBuild": {"uul0002": True}})
    engs = [new(1, "ENGINEER MOBILE LAND", 305 + i, 300, 0) for i in range(4)]
    new(2, "STRUCTURE FACTORY", 800, 800, 0)
    s.W.time = 160
    s.step(times=1)
    c = s.g.CPAI.commanders[1]
    ds = list(c.districts.values())
    roles = [d.role for d in ds]
    check("harbor" in roles, f"porto na costa ({roles})")
    check("forge" in roles and "rear" in roles, f"forja para experimentais atrás da base ({roles})")
    choke = [d for d in ds if d.role == "bastion" and d.choke]
    check(len(choke) >= 1, "bastião na passagem estreita ganha a linha de torres")
    if choke:
        n = len(list(choke[0]['items'].values())) if choke[0]['items'] else 0
        check(n == 13, f"plano do bastião com a linha de torres ({n} prédios)")
    hb = [d for d in ds if d.role == "harbor"][0] if "harbor" in roles else None
    if hb:
        check(hb.fx < -0.5, f"o porto olha para a água ({hb.fx:.2f})")
    # forge waits for the experimental time
    s.step(times=6)
    forge = [d for d in ds if d.role == "forge"]
    check(forge and forge[0].step == 1, "forja só começa depois dos 10 minutos")
    # a finished district that was wiped out is rebuilt and remembered
    d0 = ds[0]
    d0.step = 99
    s.lua.execute("CPAI.commanders[1].cooldowns.districtcheck = 0")
    s.lua.execute("for _, u in ipairs(World.units) do if u.army == 1 and u.cats.STRUCTURE and u.x > 360 then u.dead = true end end CPAI.snap = nil")
    s.lua.execute("World.built = {}")
    s.step(times=1)
    check(c.tally.lost >= 1 or d0.step < 99, "bairro destruído volta a ser construído")
    mem = s.lua.eval("CPAIModelMemory()")
    check(mem.lost is not None and len(list(mem.lost.values())) >= 1, "o mapa lembra onde um bairro caiu (memória entre partidas)")
    check(not s.W.warn, f"sem erros ({s.W.warn})")

    # memória de partidas anteriores: um lugar que caiu não é escolhido de novo
    s2 = Scenario(build="true", counter="false", adaptive="false", air="false", team="false")
    s2.lua.execute("ScenarioInfo = { size = { 1024, 1024 } }")
    s2.lua.execute("ArmyBrains[1].start = { 300, 300 } ArmyBrains[2].start = { 800, 800 }")
    s2.lua.execute("CPAI.commanders[1].home = { 300, 0, 300 }")
    s2.new(1, "STRUCTURE FACTORY", 300, 300, 0)
    for i in range(3):
        s2.new(1, "ENGINEER MOBILE LAND", 305 + i, 300, 0)
    s2.new(2, "STRUCTURE FACTORY", 800, 800, 0)
    s2.W.time = 160
    s2.step(times=1)
    first = s2.g.CPAI.commanders[1].districts[1]
    key = s2.lua.eval(f"math.floor({first.pos[1]} / 50) .. ':' .. math.floor({first.pos[3]} / 50)")
    s3 = Scenario(build="true", counter="false", adaptive="false", air="false", team="false")
    s3.lua.execute("ScenarioInfo = { size = { 1024, 1024 } }")
    s3.lua.execute("ArmyBrains[1].start = { 300, 300 } ArmyBrains[2].start = { 800, 800 }")
    s3.lua.execute("CPAI.commanders[1].home = { 300, 0, 300 }")
    s3.lua.execute(f"CPAIReceiveMemory({{ games = 3, style = {{}}, lost = {{ ['{key}'] = 10 }} }})")
    s3.new(1, "STRUCTURE FACTORY", 300, 300, 0)
    for i in range(3):
        s3.new(1, "ENGINEER MOBILE LAND", 305 + i, 300, 0)
    s3.new(2, "STRUCTURE FACTORY", 800, 800, 0)
    s3.W.time = 160
    s3.step(times=1)
    keys = [s3.lua.eval(f"math.floor({d.pos[1]} / 50) .. ':' .. math.floor({d.pos[3]} / 50)") for d in s3.g.CPAI.commanders[1].districts.values()]
    check(key not in keys, f"evita o lugar onde o bairro caiu em outra partida ({key})")

    # escudos em camadas, rede antiaérea e economia
    s = Scenario(build="true", counter="false", adaptive="false", air="false", team="false")
    new = s.new
    s.lua.execute("ScenarioInfo = { size = { 1024, 1024 } }")
    s.W.time = 400
    for i in range(4):
        new(1, "STRUCTURE FACTORY", 50 + i * 10, 50, 0)
    for i in range(4):
        new(1, "ENGINEER MOBILE LAND", 60 + i, 60, 0)
    for i in range(8):
        new(2, "MOBILE AIR", 400 + i, 400, 3, {"air": 0})
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    s.step(times=3)
    built = [b.id for b in s.W.built.values()]
    check(built.count("uub0202") >= 1, f"escudo sobre o bloco de fábricas ({built})")
    s.lua.execute("World.mass = 2000")
    s.lua.execute("CPAI.commanders[1].cooldowns.economy = 0")
    s.step(times=2)
    built = [b.id for b in s.W.built.values()]
    check(built.count("uub0001") >= 1, f"massa sobrando: mais uma fábrica ({built})")
    s.lua.execute("World.energy = 50 World.mass = 300 CPAI.commanders[1].cooldowns.economy = 0")
    s.step(times=2)
    built = [b.id for b in s.W.built.values()]
    check("uub0702" in built, f"falta de energia: gerador ({built})")
    c = s.g.CPAI.commanders[1]
    s.lua.execute("World.energy = nil World.mass = 1000")
    s.lua.execute("CPAI.commanders[1].districts = { { pos = { 200, 0, 60 }, role = 'workshop', step = 4, tries = 0, fx = 1, fz = 0, name = 'teste' } } CPAI.commanders[1].cooldowns.airnet = 0 CPAI.commanders[1].cooldowns.plan = 9999")
    s.step(times=1)
    built = [b for b in s.W.built.values() if b.id == "uub0102"]
    check(any(80 < b.x < 180 for b in built), f"antiaéreo entre a base e o bairro contra a aviação inimiga ({[(round(b.x), round(b.z)) for b in built]})")
    check(len(list(c.journal.values())) > 0, "diário registra o que a IA fez")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def army_plus():
    """Formação, duas frentes, cerco, prever o ataque, aprender com as perdas, aliado humano,
    reunião no bastião, recuo para o bastião, varredura de expansões e o painel."""
    s = Scenario(micro="false", air="false", build="false", counter="true", adaptive="false", team="false")
    new = s.new
    s.W.time = 600
    new(1, "STRUCTURE FACTORY", 50, 50, 0, {"canBuild": {"uua0101": True, "uul0105": True, "uul0102": True, "uul0101": True}})
    # alvos: extratores longe da base inimiga (cerco) e a base dela, bem longe um do outro
    new(2, "STRUCTURE MASSEXTRACTION", 420, 60, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 425, 64, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 440, 440, 0)
    tanks = [new(1, "MOBILE LAND DIRECTFIRE", 60 + i % 10, 60 + i // 10, 3) for i in range(30)]
    arty = [new(1, "MOBILE LAND INDIRECTFIRE", 55, 55 + i, 2) for i in range(3)]
    aa = [new(1, "MOBILE LAND ANTIAIR", 52, 52 + i, 0.5, {"air": 4}) for i in range(2)]
    s.step(times=4)
    o = [s.last(u) for u in tanks]
    targets = {(round(x.pos[1] / 50), round(x.pos[3] / 50)) for x in o if x is not None and x.kind == "attack" and x.pos}
    check(len(targets) >= 2, f"exército grande ataca em duas frentes ({targets})")
    a = s.last(aa[0])
    check(a is not None and a.kind == "guard", f"antiaéreo escolta a linha de frente ({a.kind if a else None})")
    r = s.last(arty[0])
    check(r is not None and r.kind == "attack", "artilharia ataca de trás")
    c = s.g.CPAI.commanders[1]
    check(c.tally.attacks >= 1 and c.tally.fronts >= 1, "placar conta ataques e frentes")
    check(c.tally.siege >= 1, "cerco: ataca os extratores longe da base inimiga")
    check(not s.W.warn, f"sem erros ({s.W.warn})")

    # prever o ataque: um exército inimigo andando para a base
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false", team="false")
    new = s.new
    s.W.time = 300
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    new(1, "STRUCTURE MASSEXTRACTION", 150, 60, 0)
    mine = [new(1, "MOBILE LAND", 70 + i, 70, 3) for i in range(4)]
    foes = [new(2, "MOBILE LAND", 330 + i, 330, 3) for i in range(8)]
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    s.step(times=1)
    for k in range(4):
        for i, u in enumerate(foes):
            u.x, u.z = 330 - (k + 1) * 30 + i, 330 - (k + 1) * 30
        s.lua.execute("CPAI.snap = nil")
        s.step(seconds=7)
    c = s.g.CPAI.commanders[1]
    check(c.predicted is not None and c.predicted is not False, "vê o exército inimigo vindo")
    o = s.last(mine[0])
    check(o is not None and o.pos and ((o.pos[1] - 50) ** 2 + (o.pos[3] - 50) ** 2) ** 0.5 < 170, "o exército espera na frente de onde o inimigo vai atacar")
    check(not s.W.warn, f"sem erros ({s.W.warn})")

    # aprender com as perdas: unidades morrendo para a aviação → antiaéreo
    s = Scenario(micro="false", air="false", build="false", counter="true", adaptive="false", team="false")
    new = s.new
    s.W.time = 300
    new(1, "STRUCTURE FACTORY", 50, 50, 0, {"canBuild": {"uua0101": True, "uul0105": True}})
    victims = [new(1, "MOBILE LAND", 200 + i, 200, 3) for i in range(9)]
    for i in range(4):
        new(2, "MOBILE AIR", 200 + i, 205, 3, {"air": 0})
    s.step(times=1)
    # a aviação inimiga em cima de onde eles estão
    for i, u in enumerate(victims):
        u.dead = True
    s.lua.execute("for _, u in ipairs(World.units) do if u.army == 2 then u.x, u.z = World.units[2].x + 3, World.units[2].z end end")
    s.lua.execute("CPAI.snap = nil CPAI.commanders[1].cooldowns.counter = 0")
    s.step(times=1)
    c = s.g.CPAI.commanders[1]
    ids = [q.id for q in s.W.factoryQueue.values()]
    check(c.lossBy.air >= 6, f"sabe que perdeu para a aviação ({c.lossBy.air:.1f})")
    check("uua0101" in ids or "uul0105" in ids, f"responde com antiaéreo ({ids})")

    # aliado humano: atacando junto e pedindo ajuda
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false", team="false", ally=True)
    new = s.new
    s.lua.execute("ArmyBrains[3].BrainType = 'Human' CPAI.commanders[3] = nil")
    s.armies = [1]
    s.W.time = 400
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    army = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(8)]
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    for i in range(10):
        new(2, "STRUCTURE DEFENSE", 445 + i, 445, 20)
    for i in range(6):
        new(2, "STRUCTURE DEFENSE", 300 + i, 120, 4)
    new(2, "STRUCTURE MASSEXTRACTION", 300, 125, 0)
    for i in range(6):
        new(3, "MOBILE LAND", 290 + i, 120, 3)
    s.step(times=3)
    o = s.last(army[0])
    check(o is not None and o.kind == "attack" and abs(o.pos[1] - 300) < 25 and abs(o.pos[3] - 120) < 25, "ataca junto com o aliado humano (mesmo alvo)")
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false", team="false", ally=True)
    new = s.new
    s.lua.execute("ArmyBrains[3].BrainType = 'Human' CPAI.commanders[3] = nil")
    s.armies = [1]
    s.W.time = 400
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    army = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(8)]
    new(3, "STRUCTURE FACTORY", 50, 300, 0)
    for i in range(4):
        new(2, "MOBILE LAND", 60 + i, 300, 3)
    s.step(times=2)
    o = s.last(army[0])
    check(o is not None and o.kind == "attack" and abs(o.pos[3] - 300) < 30, "vai ajudar o aliado humano atacado")
    check(s.g.CPAI.commanders[1].tally.helped >= 1, "placar conta a ajuda")

    # reunião no bastião e varredura das expansões
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false", team="false")
    new = s.new
    s.lua.execute("World.markers['Expansion Area'] = { { position = { 100, 0, 400 } }, { position = { 400, 0, 100 } } }")
    s.W.time = 300
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    army = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(3)]
    scout = new(1, "MOBILE LAND SCOUT", 55, 55, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    for i in range(10):
        new(2, "STRUCTURE DEFENSE", 445 + i, 445, 20)
    s.lua.execute("CPAI.commanders[1].districts = { { pos = { 160, 0, 120 }, role = 'bastion', step = 5, tries = 0, fx = 0.7, fz = 0.7, name = 'teste' } }")
    s.step(times=2)
    o = s.last(army[0])
    check(o is not None and abs(o.pos[1] - 160) < 45 and abs(o.pos[3] - 120) < 45, "o exército se junta na frente do bastião")
    sp = s.lua.eval("Commander and false")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def islands_team_scout():
    """Engenheiro de avião para a ilha, território das IAs aliadas e varredura das expansões."""
    s = Scenario(build="true", counter="false", adaptive="false", air="false", team="false")
    new = s.new
    s.lua.execute("ScenarioInfo = { size = { 1024, 1024 } }")
    s.lua.execute("ArmyBrains[1].start = { 300, 300 } ArmyBrains[2].start = { 800, 800 }")
    s.lua.execute("CPAI.commanders[1].home = { 300, 0, 300 }")
    s.lua.execute("World.markers['Expansion Area'] = { { position = { 650, 0, 300 } } }")
    new(1, "STRUCTURE FACTORY", 300, 300, 0)
    engs = [new(1, "ENGINEER MOBILE LAND", 305 + i, 300, 0) for i in range(4)]
    tr = new(1, "MOBILE AIR TRANSPORTATION", 300, 310, 0)
    new(2, "STRUCTURE FACTORY", 800, 800, 0)
    s.W.time = 430
    s.step(times=6)
    c = s.g.CPAI.commanders[1]
    island = [d for d in c.districts.values() if d.island]
    check(len(island) == 1, "engenheiro levado de avião começa um bairro na ilha")
    flown = [e for e in engs if e.CPIsland]
    check(len(flown) == 1 and abs(flown[0].x - 650) < 60, "o engenheiro da ilha fica na ilha")
    if island:
        s.lua.execute("World.built = {}")
        s.step(times=3)
        on = [b for b in s.W.built.values() if b.x > 600]
        check(len(on) >= 1, f"constrói na ilha ({len(on)})")
    check(not s.W.warn, f"sem erros ({s.W.warn})")

    # IAs aliadas não disputam o mesmo lugar
    s = Scenario(build="true", counter="false", adaptive="false", air="false", team="true", ally=True)
    s.lua.execute("ScenarioInfo = { size = { 1024, 1024 } }")
    s.lua.execute("ArmyBrains[1].start = { 300, 300 } ArmyBrains[3].start = { 300, 650 } ArmyBrains[2].start = { 850, 500 }")
    s.lua.execute("CPAI.commanders[1].home = { 300, 0, 300 } CPAI.commanders[3].home = { 300, 0, 650 }")
    for a, z in ((1, 300), (3, 650)):
        s.new(a, "STRUCTURE FACTORY", 300, z, 0)
        for i in range(3):
            s.new(a, "ENGINEER MOBILE LAND", 305 + i, z, 0)
    s.new(2, "STRUCTURE FACTORY", 850, 500, 0)
    s.W.time = 160
    s.step(times=2)
    a1 = list(s.g.CPAI.commanders[1].districts.values())
    a3 = list(s.g.CPAI.commanders[3].districts.values())
    close = min((((p.pos[1] - q.pos[1]) ** 2 + (p.pos[3] - q.pos[3]) ** 2) ** 0.5 for p in a1 for q in a3), default=999)
    check(len(a1) >= 3 and len(a3) >= 3 and close >= 80, f"IAs aliadas dividem o território ({close:.0f})")

    # o batedor passa pelas expansões do mapa
    s = Scenario(micro="false", air="true", build="false", counter="false", adaptive="false", team="false")
    new = s.new
    s.lua.execute("World.markers['Expansion Area'] = { { position = { 100, 0, 400 } }, { position = { 400, 0, 100 } } }")
    s.W.time = 300
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    scout = new(1, "MOBILE AIR SCOUT", 55, 55, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    goals = set()
    for _ in range(6):
        s.lua.execute("CPAI.commanders[1].cooldowns.scout = 0")
        s.step()
        for o in (s.W.orders[scout.id] or {}).values() if s.W.orders[scout.id] else []:
            if o.pos:
                goals.add((round(o.pos[1]), round(o.pos[3])))
    check((100, 400) in goals or (400, 100) in goals, f"batedor varre as expansões ({sorted(goals)})")


def alsyper():
    """Alsyper Adaptador: genes que começam do que aprendeu, mudam com o que vê e voltam para a
    memória; reconhecimento no começo e o que a IA acredita; estratégias."""
    s = Scenario(build="true", counter="true", adaptive="false", air="true", team="false", tips="true", chat="true")
    new = s.new
    s.lua.execute("CPAIReceiveMemory({ games = 4, style = {}, genes = { aggression = 1.6, air = 1.5, naval = 0.4 }, results = { 1, 1, 1 } })")
    new(1, "STRUCTURE FACTORY", 50, 50, 0, {"canBuild": {"uua0101": True, "uul0101": True, "uul0002": True}})
    for i in range(3):
        new(1, "ENGINEER MOBILE LAND", 60 + i, 60, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    s.W.time = 60
    s.step(times=2)
    c = s.g.CPAI.commanders[1]
    check(c.genes is not None and c.genes.aggression > 1.2 and c.genes.air > 1.15, f"genes começam do que aprendeu ({c.genes.aggression:.2f}, {c.genes.air:.2f})")
    check(c.generation == 5, f"geração conta as partidas ({c.generation})")
    check(s.g.CPAI.strength > 1.1, "o jogador venceu as últimas: a IA fica mais forte")
    ids = [q.id for q in s.W.factoryQueue.values()]
    j = [str(x.text) for x in c.journal.values()]
    check(any("batedores" in x for x in j), "sem ver o mapa: avisa no diário e manda batedor")
    check("uua0101" in ids or "uul0101" in ids, f"pede um avião/unidade para reconhecer ({ids})")
    check(c.belief is None or len(list(c.belief.values())) == 0, "ainda não acredita em nada que não viu")
    # um batedor chega na base inimiga
    plane = new(1, "MOBILE AIR SCOUT", 445, 448, 0)
    for i in range(6):
        new(2, "MOBILE AIR", 440 + i, 452, 3, {"air": 0})
    s.lua.execute("CPAI.snap = nil")
    s.step()
    check(c.seenAt is not None and c.seenAt is not False, "viu a base inimiga com o batedor")
    b = list(c.belief.values())[0]
    check(b.factories >= 1 and b.air > 5, f"agora sabe das fábricas e da aviação ({b.factories}, {b.air:.0f})")
    j = [str(x.text) for x in c.journal.values()]
    check(any("viu a base inimiga" in x for x in j), "diário conta o que o batedor viu")
    # o que acontece na partida muda os genes
    before = c.genes.aggression
    c.tally.retreats = c.tally.retreats + 3
    s.lua.execute("CPAI.commanders[1].cooldowns.alsyper = 0")
    s.step()
    check(c.genes.aggression < before, "ataques falhando: menos agressão")
    j = [str(x.text) for x in c.journal.values()]
    check(any(x.startswith("Alsyper") for x in j), "diário explica cada mudança do Alsyper")
    check(c.strategy is not None and c.strategyLabel, f"escolhe uma estratégia ({c.strategyLabel})")
    mem = s.lua.eval("CPAIModelMemory()")
    check(mem.genes is None or mem.genes.aggression is not None, "os genes vão para a memória")
    summ = s.lua.eval("CPAI.status[1] and CPAI.status[1].alsyper")
    check(summ is not None and "agressao" in str(summ.genes), "painel recebe os genes")
    check(not s.W.warn, f"sem erros ({s.W.warn})")

    # fim de partida: o jogador perdeu → resultado vai para a memória (a próxima IA ajusta a força)
    s.lua.execute("ArmyBrains[2].IsDefeated = function() return true end CPAI.result = nil")
    s.W.time = 400
    s.step()
    res = s.lua.eval("Sync.CPAIResult")
    check(res is not None and res.result == -1, "fim de partida: a IA venceu e isso vai para a memória")


def tactics_more():
    """Pesquisa com plano, corrida de experimental, hora certa, emboscada, isca, extratores
    tomados, destroços, patrulha aérea, antinuclear, conversor, veteranos, engenheiros e ACU."""
    s = Scenario(build="true", counter="false", adaptive="false", air="true", team="false", personality="airborne")
    new = s.new
    s.lua.execute("ArmyBrains[1].SkirmishAISystem.ResearchNeeds = {}")
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    s.W.time = 100
    s.step(times=2)
    needs = list(s.lua.eval("ArmyBrains[1].SkirmishAISystem.ResearchNeeds").values())
    check(any(str(n).startswith("UA") for n in needs), f"pesquisa com plano (aérea: {needs[:4]})")

    # corrida de experimental: viu a fábrica, exército forte → ataca ela
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false", team="false")
    new = s.new
    s.W.time = 600
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    army = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(14)]
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    for i in range(3):
        new(2, "STRUCTURE DEFENSE", 448 + i, 452, 2)
    new(2, "STRUCTURE FACTORY EXPERIMENTALFACTORY", 300, 380, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 120, 420, 0)
    new(1, "MOBILE LAND", 300, 375, 1)
    s.step(times=3)
    c = s.g.CPAI.commanders[1]
    check(c.expStrike, "viu a fábrica de experimental e decidiu atacar")
    o = s.last(army[0])
    check(o is not None and o.pos and abs(o.pos[1] - 300) < 30 and abs(o.pos[3] - 380) < 30, "ataca a fábrica de experimental antes de ficar pronta")

    # hora certa: o exército inimigo acabou de perder muito
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false", team="false")
    new = s.new
    s.W.time = 300
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    foes = [new(2, "MOBILE LAND", 440 + i, 440, 3) for i in range(10)]
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    s.step()
    for u in foes[:7]:
        u.dead = True
    s.lua.execute("CPAI.snap = nil")
    s.step()
    c = s.g.CPAI.commanders[1]
    check(c.window and c.window > s.W.time, "percebe a hora certa de atacar")
    r1 = s.lua.eval("CPAI.commanders[1].ratio")
    check(s.lua.eval("CPAI.commanders[1].window") is not None, "janela de ataque aberta")

    # emboscada no caminho que o jogador usa
    s = Scenario(micro="false", air="false", build="false", counter="false", adaptive="false", team="false")
    new = s.new
    s.W.time = 300
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    army = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(20)]
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    for i in range(12):
        new(2, "STRUCTURE DEFENSE", 445 + i, 445, 20)
    s.lua.execute("local M = CPAI.model M.humans = 1 M.route['3:3'] = 20 ArmyBrains[2].BrainType = 'Human'")
    s.step(times=2)
    c = s.g.CPAI.commanders[1]
    amb = list(c.squads.ambush.units.values())
    check(len(amb) == 4, f"separa 4 unidades para a emboscada ({len(amb)})")
    for i in range(4):
        new(2, "MOBILE LAND", 172 + i, 172, 2)
    s.lua.execute("CPAI.snap = nil")
    s.step()
    o = s.last(amb[0]) if amb else None
    check(o is not None and o.kind == "attack" and abs(o.pos[1] - 175) < 30, "a emboscada ataca quem passa")

    # isca, extratores tomados e destroços
    s = Scenario(micro="false", air="false", build="true", counter="false", adaptive="false", team="false")
    new = s.new
    s.W.time = 500
    s.lua.execute("World.wrecks = { 'w1', 'w2' } function Rect(a, b, c, d) return { a, b, c, d } end function GetReclaimablesInRect(r) return World.wrecks end function IssueReclaim(u, w) World.reclaimed = (World.reclaimed or 0) + 1 end")
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    army = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(20)]
    raiders = [new(1, "MOBILE LAND", 62 + i, 62, 1, {"speed": 6}) for i in range(3)]
    for i in range(3):
        new(1, "ENGINEER MOBILE LAND", 52 + i, 52, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    for i in range(12):
        new(2, "STRUCTURE DEFENSE", 445 + i, 445, 20)
    for i in range(4):
        new(2, "STRUCTURE DEFENSE", 300 + i, 300, 3)
    mines = [new(2, "STRUCTURE MASSEXTRACTION", 302 + i * 4, 305, 0) for i in range(2)]
    new(2, "STRUCTURE", 80, 450, 0)
    new(2, "STRUCTURE DEFENSE", 82, 452, 3)
    s.step(times=2)
    c = s.g.CPAI.commanders[1]
    j = [str(x.text) for x in c.journal.values()]
    check(any("isca" in x for x in j), "isca: os rápidos atacam longe antes do ataque principal")
    s.step(times=3)
    main = c.squads.main
    if main.state == "attack":
        for u in s.W.units.values():
            if u.army == 2 and 290 < u.x < 320 and 290 < u.z < 320:
                u.dead = True
        for u in army:
            u.x, u.z = 305, 302
        s.lua.execute("CPAI.snap = nil")
        s.step(times=2)
    check(len(list((c.stealSpots or {}).values())) >= 1 or c.tally.won >= 1, "lembra os extratores do lugar tomado")
    check((s.W.reclaimed or 0) >= 1, f"recolhe os destroços depois da luta ({s.W.reclaimed})")
    s.lua.execute("CPAI.commanders[1].cooldowns.steal = 0 CPAI.snap = nil")
    s.step(times=2)
    built = [b.id for b in s.W.built.values()]
    check("uub0701" in built, f"constrói um extrator no lugar tomado ({built})")

    # veteranos voltam mais cedo; engenheiros fogem
    s = Scenario(micro="false", air="false", build="true", counter="false", adaptive="false", team="false")
    new = s.new
    s.W.time = 300
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    vet = new(1, "MOBILE LAND", 60, 60, 3, {"hp": 130})
    s.lua.execute("World.units[2].VeteranLevel = 3")
    eng = new(1, "ENGINEER MOBILE LAND", 200, 200, 0)
    for i in range(3):
        new(2, "MOBILE LAND", 205 + i, 205, 2)
    s.step(times=2)
    check(vet.CPWounded is not None and vet.CPWounded is not False, "veterano ferido volta para casa mais cedo")
    if eng.CPBuilder:
        check(eng.CPFleeing, "engenheiro foge dos inimigos")
    check(not s.W.warn, f"sem erros ({s.W.warn})")

    # antinuclear quando o jogador tem míssil; patrulha aérea
    s = Scenario(micro="false", air="true", build="true", counter="false", adaptive="false", team="false")
    new = s.new
    s.lua.execute("function IssuePatrol(u, p) World.patrols = (World.patrols or 0) + 1 end")
    s.W.time = 700
    new(1, "STRUCTURE FACTORY", 50, 50, 0)
    for i in range(3):
        new(1, "ENGINEER MOBILE LAND", 52 + i, 52, 0)
    fighters = [new(1, "MOBILE AIR FIGHTER ANTIAIR", 50 + i, 50, 0, {"air": 6}) for i in range(3)]
    s.lua.execute("CPAI.commanders[1].districts = { { pos = { 150, 0, 60 }, role = 'workshop', step = 5, tries = 0, fx = 1, fz = 0, name = 'teste' } } CPAI.commanders[1].cooldowns.plan = 9999")
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    new(2, "STRUCTURE NUKE", 440, 440, 0)
    s.lua.execute("local M = CPAI.model M.humans = 1 ArmyBrains[2].BrainType = 'Human'")
    s.step(times=8)
    built = [b.id for b in s.W.built.values()]
    check("uub0203" in built, f"defesa antinuclear contra o míssil do jogador ({built})")
    check((s.W.patrols or 0) >= 2, "caças patrulham entre a base e os bairros")
    check(not s.W.warn, f"sem erros ({s.W.warn})")


def acu_and_navy():
    """O comandante (ACU) não fica longe da base: volta e um engenheiro assume a obra; marinha só
    quando o mar importa."""
    s = Scenario(micro="false", air="false", build="true", counter="true", adaptive="false", team="false")
    new = s.new
    s.W.time = 400
    new(1, "STRUCTURE FACTORY", 50, 50, 0, {"canBuild": {"uul0002": True, "uus0102": True}})
    acu = new(1, "COMMAND MOBILE LAND ENGINEER", 300, 300, 8)
    eng = new(1, "ENGINEER MOBILE LAND", 60, 60, 0)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    s.step()
    o = s.last(acu)
    check(o is not None and o.kind == "move" and ((o.pos[1] - 50) ** 2 + (o.pos[3] - 50) ** 2) ** 0.5 < 40, "comandante longe da base volta para perto dela")
    e = s.last(eng)
    check(e is not None and e.kind == "move" and abs(e.pos[1] - 300) < 30, "um engenheiro vai fazer a obra no lugar dele")
    c = s.g.CPAI.commanders[1]
    for _ in range(3):
        acu.x, acu.z = 320, 320
        s.lua.execute("CPAI.commanders[1].cooldowns.aculeash = 0")
        s.step()
    check(c.acuKept, "depois de duas vezes o comandante sai das obras do jogo e fica em casa")
    j = [str(x.text) for x in c.journal.values()]
    check(any("comandante longe da base" in x for x in j), "diário explica")
    # sem navio inimigo visto: nada de frota
    ids = [q.id for q in s.W.factoryQueue.values()]
    check("uus0102" not in ids, f"não faz navios sem ver a marinha inimiga ({ids})")
    # o mapa seco: sem porto, mesmo com a personalidade naval
    s2 = Scenario(build="true", counter="false", adaptive="false", air="false", team="false", personality="naval")
    s2.lua.execute("ScenarioInfo = { size = { 1024, 1024 } }")
    s2.lua.execute("ArmyBrains[1].start = { 300, 300 } ArmyBrains[2].start = { 800, 800 }")
    s2.lua.execute("CPAI.commanders[1].home = { 300, 0, 300 }")
    s2.lua.execute("World.sea = function(x, z) return x < 140 end")
    s2.new(1, "STRUCTURE FACTORY", 300, 300, 0)
    for i in range(3):
        s2.new(1, "ENGINEER MOBILE LAND", 305 + i, 300, 0)
    s2.new(2, "STRUCTURE FACTORY", 800, 800, 0)
    s2.W.time = 160
    s2.step(times=2)
    c2 = s2.g.CPAI.commanders[1]
    roles = [d.role for d in c2.districts.values()]
    check("harbor" not in roles, f"pouca água: sem porto ({roles})")
    check(c2.personalityKey == "balanced", f"personalidade naval vira equilibrada com pouca água ({c2.personalityKey})")
    check(not s.W.warn and not s2.W.warn, f"sem erros ({s.W.warn} {s2.W.warn})")


def panel_plus():
    """O painel mostra o placar, o diário e o mapinha com bairros, ataque e previsão."""
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(UI_HARNESS)
    code = PANEL.replace("@KEY@", "F4").replace("@PANEL@", "true").replace("@LEARN@", "false")
    lua.execute(moho_to_lua(code))
    g = lua.globals()
    lua.execute("""Sync.CPAIStatus = { [2] = { name = 'IA', personality = 'Agressiva', adaptive = 'normal', plan = 'atacando', minUnits = 8, acu = 'na base',
        intel = { air = 1, land = 2, naval = 0 }, dangers = 0, time = 10,
        main = { n = 5, power = 9, state = 'atacando' },
        districts = { done = 2, total = 6, current = 'bastiao norte 3/9' },
        tally = { attacks = 3, won = 2, retreats = 1, defended = 1, districts = 2, lost = 0, fronts = 1, siege = 1, helped = 0 },
        journal = { '10:02  bairro bastiao norte pronto', '9:40  atacou com 12 unidades' },
        mini = { army = 2, home = { 0.2, 0.2 }, districts = { { 0.3, 0.3, 'bastion', true }, { 0.1, 0.3, 'rear', false } }, target = { 0.8, 0.8 }, predicted = { 0.4, 0.4 } },
        alsyper = { generation = 7, strategy = 'Supremacia aerea + Fogo concentrado', genes = 'agressao 120%  aviacao 150%', last = 'mais aviacao: voce usa muita aviacao', seen = 'viu a sua base ha 30 s', window = false },
        tip = { pos = { 300, 0, 300 }, at = { 0.3, 0.3 }, eta = 25, n = 12 },
        said = { n = 1, text = 'La vou eu.' } } }""")
    lua.execute("CPAIPanelInit() UI.time = 5 CPAIPanelPoll() CPAIPanelToggle() CPAIPanelPoll()")
    texts = " | ".join(str(t.text) for t in g.UI.texts.values() if t.text)
    check("Placar: ataques 3 (vencidos 2)" in texts, "painel: placar da partida")
    check("bairro bastiao norte pronto" in texts, "painel: diário")
    check("Bairros: 2/6" in texts, "painel: bairros")
    check((g.CPAIPanelMiniDots or 0) == 6, f"painel: mapinha com casa, bairros, ataque, previsão e a dica ({g.CPAIPanelMiniDots})")
    check("Alsyper Adaptador - geracao 7" in texts and "Supremacia aerea" in texts, "painel: Alsyper com a estratégia e os genes")
    check("Dica:" in str(g.UI_LastTip) and "25 s" in str(g.UI_LastTip), f"modo treino: dica na tela ({g.UI_LastTip})")
    check(str(g.UI_LastSaid) == "La vou eu.", "mensagem da IA na tela")

    # resultado da partida vai para a memória (com os genes)
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(UI_HARNESS)
    code = PANEL.replace("@KEY@", "F4").replace("@PANEL@", "true").replace("@LEARN@", "true")
    lua.execute(moho_to_lua(code))
    lua.execute("UI.prefs.CPAIMemory = { games = 2, style = {}, maps = {} } CPAIPanelInit() UI.time = 30")
    lua.execute("Sync.CPAIResult = { result = 1, genes = { aggression = 1.4 } } CPAIPanelPoll()")
    mem = lua.eval("UI.prefs.CPAIMemory")
    check(mem.results is not None and list(mem.results.values()) == [1] and mem.genes.aggression > 0.5, "painel guarda o resultado e os genes da partida")


def main() -> int:
    districts_plus()
    army_plus()
    islands_team_scout()
    alsyper()
    tactics_more()
    acu_and_navy()
    panel_plus()
    districts()
    panel()
    terrain_losses_research()
    player_model()
    basics()
    micro_pincer_escort()
    air_acu_counter_bases()
    drop_team_adaptive_status()
    review_fixes()
    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
