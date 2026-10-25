"""Testa o comandante estratégico da IA (crates/cp-core/src/aimod_commander.lua) num mundo falso.

Roda o Lua de verdade (lupa), com uma imitação das funções do jogo: unidades, consultas de área,
ordens de movimento e o tempo de jogo. Confere as decisões: segurar o exército quando é pequeno,
juntar e atacar o alvo mais valioso que dá para vencer, defender a base, recuar quando perde e
mandar feridos para casa.

    python3 tools/test_ai_commander.py
"""
import math
import re
import sys
from pathlib import Path

from lupa import LuaRuntime

ROOT = Path(__file__).resolve().parent.parent
SRC = (ROOT / "crates/cp-core/src/aimod_commander.lua").read_text()


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
World = { time = 0, units = {}, orders = {}, nextId = 1, platoons = {} }

function GetGameTimeSeconds() return World.time end
function VDist2(x1, z1, x2, z2) return math.sqrt((x1 - x2) ^ 2 + (z1 - z2) ^ 2) end
function GetSurfaceHeight(x, z) return 0 end
function WaitSeconds(s) coroutine.yield(s) end
function LOG(s) end
function WARN(s) World.warn = (World.warn or '') .. s .. '\n' end
function ParseEntityCategory(expr) return expr end

local function hasCat(u, expr)
    for tok in string.gmatch(expr, '%S+') do
        local neg = string.sub(tok, 1, 1) == '-'
        local name = neg and string.sub(tok, 2) or tok
        local has = u.cats[name] == true
        if neg == has then return false end
    end
    return true
end
function EntityCategoryContains(cat, u) return hasCat(u, cat) end

function IsEnemy(a, b) return a ~= b end
function ArmyIsCivilian(a) return false end

local UnitMT = { __index = {
    IsDead = function(self) return self.dead end,
    IsBeingBuilt = function(self) return self.building end,
    IsUnitState = function(self, s) return false end,
    GetHealth = function(self) return self.hp end,
    GetMaxHealth = function(self) return self.maxhp end,
    GetBlueprint = function(self) return self.bp end,
    GetPosition = function(self) return { self.x, 0, self.z } end,
    GetNavigator = function(self)
        local u = self
        return { CanPathToGoal = function(_, pos)
            if u.cats.NAVAL then return pos[1] < 100 end -- water only on the west side
            return true
        end }
    end,
} }

function NewUnit(army, cats, x, z, threat, opts)
    opts = opts or {}
    local u = setmetatable({
        id = World.nextId, army = army, x = x, z = z, dead = false, building = false,
        hp = opts.hp or 300, maxhp = 300, cats = {},
        bp = { Defense = { SurfaceThreatLevel = threat }, Physics = { MaxSpeed = opts.speed or 3 } },
    }, UnitMT)
    for tok in string.gmatch(cats, '%S+') do u.cats[tok] = true end
    World.nextId = World.nextId + 1
    table.insert(World.units, u)
    return u
end

local function brainOf(index)
    local b = {
        index = index, BrainType = index == 1 and 'AI' or 'Human', DifficultyLevel = 2,
        start = index == 1 and { 50, 50 } or { 450, 450 },
    }
    function b:GetArmyIndex() return self.index end
    function b:IsDefeated() return false end
    function b:GetArmyStartPos() return self.start[1], self.start[2] end
    function b:GetListOfUnits(cat, _)
        local out = {}
        for _, u in ipairs(World.units) do
            if u.army == self.index and not u.dead and hasCat(u, cat) then table.insert(out, u) end
        end
        return out
    end
    function b:GetUnitsAroundPoint(cat, pos, r, who)
        local out = {}
        for _, u in ipairs(World.units) do
            local mine = u.army == self.index
            if not u.dead and ((who == 'Enemy' and not mine) or (who ~= 'Enemy' and mine))
                and hasCat(u, cat) and VDist2(u.x, u.z, pos[1], pos[3]) <= r then
                table.insert(out, u)
            end
        end
        return out
    end
    function b:MakePlatoon() local p = { units = {} } table.insert(World.platoons, p) return p end
    function b:PlatoonExists(p) return p ~= nil end
    function b:AssignUnitsToPlatoon(p, units) for _, u in ipairs(units) do u.platoon = p end end
    return b
end
ArmyBrains = { brainOf(1), brainOf(2) }

local function record(kind, units, pos)
    for _, u in ipairs(units) do
        World.orders[u.id] = { kind = kind, pos = pos }
        -- units arrive instantly (good enough to test decisions)
        u.x, u.z = pos[1] + (u.id % 5), pos[3] + (u.id % 3)
    end
end
function IssueClearCommands(units) end
function IssueMove(units, pos) record('move', units, pos) end
function IssueAggressiveMove(units, pos) record('attack', units, pos) end
"""


def main() -> int:
    lua = LuaRuntime(unpack_returned_tuples=True)
    lua.execute(HARNESS)
    code = moho_to_lua(SRC.replace("@LEVEL@", "1").replace("@RAIDS@", "true"))
    lua.execute(code)
    g = lua.globals()
    W = g.World
    new = g.NewUnit

    fails = []

    def check(cond, msg):
        print(("ok   " if cond else "FAIL ") + msg)
        if not cond:
            fails.append(msg)

    # enemy (army 2): a big defended main base far away and a lonely extractor field
    for i in range(6):
        new(2, "STRUCTURE DEFENSE", 440 + i, 440, 30)
    new(2, "STRUCTURE FACTORY", 450, 450, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 300, 120, 0)
    new(2, "STRUCTURE MASSEXTRACTION", 305, 125, 0)
    # AI base
    new(1, "STRUCTURE FACTORY", 50, 50, 0)

    lua.execute("CO = coroutine.create(function() CPCommanderRun(ArmyBrains[1], {50, 0, 50}) end)")
    resume = lua.eval("function() local ok, err = coroutine.resume(CO) return ok, err end")

    def step(seconds=4):
        W.time = W.time + seconds
        ok, err = resume()
        if not ok:
            raise SystemExit(f"Lua error: {err}")

    step(0)  # initial wait
    tanks = [new(1, "MOBILE LAND", 60 + i, 60, 3) for i in range(3)]
    step()
    o = W.orders[tanks[0].id]
    check(o is not None and o.kind == "attack" and abs(o.pos[1] - 50) < 200, "3 tanques ficam no ponto de emboscada")
    check(all(W.orders[t.id].pos[1] < 300 for t in tanks), "3 tanques não atacam a base inimiga")

    # army grows: 12 tanks -> attack the extractor field (valuable, undefended), not the fortress
    tanks += [new(1, "MOBILE LAND", 70 + i, 70, 3) for i in range(9)]
    for _ in range(4):
        step()
    o = W.orders[tanks[0].id]
    check(o.kind == "attack" and abs(o.pos[1] - 300) < 20 and abs(o.pos[3] - 120) < 20,
          f"12 tanques atacam os extratores sem defesa (alvo {list(o.pos.values()) if o else None})")

    # extractors destroyed -> fortress is too strong (6 towers x 30) -> hold, no suicide
    for u in list(W.units.values()):
        if u.army == 2 and u.cats["MASSEXTRACTION"]:
            u.dead = True
    for _ in range(3):
        step()
    o = W.orders[tanks[0].id]
    check(not (o.kind == "attack" and o.pos[1] > 400), "não ataca a fortaleza bem defendida")

    # raid on our base: enemy units near our factory -> army defends
    raiders = [new(2, "MOBILE LAND", 55 + i, 52, 2) for i in range(3)]
    step()
    o = W.orders[tanks[0].id]
    check(o.kind == "attack" and abs(o.pos[1] - 50) < 20, "defende a base de um ataque")
    for r in raiders:
        r.dead = True

    # a wounded tank goes home
    tanks[1].hp = 50
    step()
    o = W.orders[tanks[1].id]
    check(o.kind == "move" and abs(o.pos[1] - 50) < 1 and abs(o.pos[3] - 50) < 1, "tanque ferido volta para casa")

    # fight turns bad: big enemy army appears around our army -> retreat
    tanks[1].hp = 300
    new(2, "STRUCTURE MASSEXTRACTION", 250, 250, 0)
    for _ in range(3):
        step()
    o = W.orders[tanks[0].id]
    if o.kind == "attack" and o.pos[1] > 200:
        for i in range(10):
            new(2, "MOBILE LAND", o.pos[1] + i, o.pos[3], 10)
        step()
        o2 = W.orders[tanks[0].id]
        check(o2.kind == "move", "recua quando a luta fica ruim")
    else:
        check(False, f"esperava um ataque ao novo extrator (ordem {o.kind} {list(o.pos.values())})")

    check(not W.warn, f"sem erros no comandante ({W.warn})")
    print("\n" + ("tudo certo" if not fails else f"{len(fails)} falha(s)"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
