-- Roda o crates/cp-core/src/minigames.lua num jogo de mentira (Lua 5.1): exércitos, unidades,
-- tempo, mensagens. Uso: lua5.1 tools/test_minigames.lua <modo> [jogadores] [times]
-- O código do jogo usa "for k, v in t do" (Lua do SC2); aqui vira pairs/ipairs.

local mode = arg[1] or 'domination'
local nplayers = tonumber(arg[2] or '4')
local nteams = tonumber(arg[3] or '2')

local src = io.open('crates/cp-core/src/minigames.lua'):read('*a')
src = src:gsub('for ([%w_]+), ([%w_]+) in ([^\n]-) do', function(a, b, e)
    if e:match('^ipairs') or e:match('^pairs') then return nil end
    return 'for ' .. a .. ', ' .. b .. ' in __iter(' .. e .. ') do'
end)
function __iter(t)
    -- arrays em ordem (como o SC2 faz com listas)
    if t[1] ~= nil or next(t) == nil then return ipairs(t) end
    return pairs(t)
end
math.mod = math.mod or math.fmod

-- tempo e threads
local now = 0
local threads = {}
function ForkThread(fn, ...)
    local args = { ... }
    local co = coroutine.create(function() fn(unpack(args)) end)
    table.insert(threads, { co = co, wake = now })
end
function WaitSeconds(s) coroutine.yield(s) end
function GetGameTimeSeconds() return now end

-- mensagens
local printed = {}
function PrintText(text, size, color, duration, where)
    table.insert(printed, string.format('[%5.0fs %-9s] %s', now, where, text))
end
function LOG(s) table.insert(printed, string.format('[%5.0fs LOG      ] %s', now, s)) end
function WARN(s) table.insert(printed, string.format('[%5.0fs WARN     ] %s', now, s)) end
function LOC(s) return (s:gsub('^<LOC [^>]*>', '')) end
function LOCF(fmt, ...) return string.format(LOC(fmt), ...) end
Sync = {}

-- aleatório determinístico
local seed = 12345
function Random(a, b)
    seed = (seed * 1103515245 + 12345) % 2147483648
    if not a then return seed / 2147483648 end
    return a + seed % (b - a + 1)
end

-- categorias: conjuntos de palavras
local function cat(set) return setmetatable({ set = set }, {
    __add = function(a, b) return cat({ op = 'or', a, b }) end,
    __sub = function(a, b) return cat({ op = 'not', a, b }) end,
    __mul = function(a, b) return cat({ op = 'and', a, b }) end,
}) end
local function has(c, tags)
    local s = c.set
    if s.op == 'or' then return has(s[1], tags) or has(s[2], tags) end
    if s.op == 'and' then return has(s[1], tags) and has(s[2], tags) end
    if s.op == 'not' then return has(s[1], tags) and not has(s[2], tags) end
    return tags[s.tag] == true
end
categories = setmetatable({}, { __index = function(_, k) return cat({ tag = k }) end })
function EntityCategoryContains(c, u) return has(c, u.tags) end

-- mapa
ScenarioInfo = { name = 'Mapa Teste', size = { 512, 512 }, Options = { CPMode = mode, CPScore = os.getenv('CPSCORE') or '120', CPWaves = '4', CPPrep = '30', CPEvery = '40', CPRing = '60', CPHold = '60', CPMove = '100', CPMut = os.getenv('CPMUT'), CPEvents = os.getenv('CPEVENTS'), CPEventFirst = '30', CPEventEvery = '60' } }
if mode == 'none' then ScenarioInfo.Options.CPMode = nil end
function GetTerrainHeight() return 10 end
function GetSurfaceHeight(x, z) if x < 40 and z < 40 then return 12 end return 10 end
function VDist2(a, b, c, d) return math.sqrt((a - c) ^ 2 + (b - d) ^ 2) end
function Rect(a, b, c, d) return { a, b, c, d } end

-- unidades
local units = {}
local function tagsFor(bp)
    local t = { ALLUNITS = true }
    if bp:match('l0001') then t.COMMAND = true; t.LAND = true end
    if bp:match('l0002') then t.ENGINEER = true; t.LAND = true end
    if bp:match('^u.l01') then t.LAND = true; t.MOBILE = true end
    if bp:match('^u.a') then t.AIR = true; t.MOBILE = true end
    if bp:match('^u.x') then t.EXPERIMENTAL = true; t.LAND = true; t.MOBILE = true end
    return t
end
local function newUnit(bp, army, x, z)
    nextId = (nextId or 0) + 1
    local u = { id = nextId, bp = bp, army = army, x = x, z = z, hp = 100, max = 100, dead = false, tags = tagsFor(bp), idle = true }
    function u:IsDead() return self.dead end
    function u:Kill() self.dead = true end
    function u:Destroy() self.dead = true end
    function u:GetArmy() return self.army end
    function u:GetFractionComplete() return 1 end
    function u:IsIdleState() return self.idle end
    function u:GetPosition() return { self.x, 10, self.z } end
    function u:GetHealth() return self.hp end
    function u:GetMaxHealth() return self.max end
    function u:AdjustHealth(_, d) self.hp = self.hp + d end
    function u:SetMaxHealth(v) self.max = v end
    function u:SetHealth(_, v) self.hp = v end
    function u:SetCustomName(n) self.name = n end
    function u:GetEntityId() return self.id end
    table.insert(units, u)
    return u
end
local created = 0
function CreateUnitHPR(bp, armyName, x, y, z)
    created = created + 1
    for i, b in ipairs(ArmyBrains) do if b.Name == armyName then return newUnit(bp, i, x, z) end end
    error('army ' .. tostring(armyName))
end
function GetUnitsInRect(r)
    local out = {}
    for _, u in ipairs(units) do
        if not u.dead and u.x >= r[1] and u.x <= r[3] and u.z >= r[2] and u.z <= r[4] then table.insert(out, u) end
    end
    return out
end
local moves = 0
function IssueAggressiveMove(list, pos) moves = moves + 1; for _, u in ipairs(list) do u.idle = false; u.goal = pos end end
function SetIgnoreArmyUnitCap() end
restricted = 0
function AddBuildRestriction() restricted = restricted + 1 end
function SetUIBuildRestrictions() end

-- exércitos
ArmyBrains = {}
local per = math.max(1, math.floor(nplayers / math.max(1, nteams)))
for i = 1, nplayers do
    local a = (i - 1) * 2 * math.pi / nplayers
    local b = {
        index = i, Name = 'ARMY_' .. i, Nickname = 'Jogador' .. i, BrainType = (i == 1) and 'Human' or 'AI',
        team = nteams == 0 and i or (math.floor((i - 1) / per) + 1), res = { MASS = 0, ENERGY = 0, RESEARCH = 0 },
        sx = 256 + math.cos(a) * 200, sz = 256 + math.sin(a) * 200, kills = 0,
    }
    function b:GetArmyIndex() return self.index end
    function b:GetArmyStartPos() return self.sx, self.sz end
    function b:IsDefeated()
        for _, u in ipairs(units) do if u.army == self.index and not u.dead then return false end end
        return true
    end
    function b:GiveResource(k, v) self.res[k] = self.res[k] + v end
    function b:GetFactionIndex() return 1 + (self.index % 3) end
    function b:GetArmyStat(k)
        if k:match('Produced_Mass') then return { Value = now * 3 * self.index } end
        if k:match('Produced_Energy') then return { Value = now * 30 } end
        return { Value = self.kills }
    end
    function b:GetEconomyIncome(k) return k == 'MASS' and 0.3 * self.index or 3 end
    function b:GetListOfUnits(c)
        local out = {}
        for _, u in ipairs(units) do if u.army == self.index and not u.dead and has(c, u.tags) then table.insert(out, u) end end
        return out
    end
    ArmyBrains[i] = b
    newUnit('uul0001', i, b.sx, b.sz)
end
function ArmyIsCivilian() return false end
function IsAlly(a, b) return ArmyBrains[a].team == ArmyBrains[b].team end
function GetFocusArmy() return 1 end

local arrows, viz = 0, 0
function import(path)
    if path:lower():match('objectivearrow') then return { ObjectiveArrow = function() arrows = arrows + 1 return { Destroy = function() arrows = arrows - 1 end } end } end
    if path:lower():match('vizmarker') then return { VizMarker = function() viz = viz + 1 return {} end } end
    error('import ' .. path)
end

local env = setmetatable({}, { __index = _G, __newindex = _G })
local chunk = assert(loadstring(src, 'minigames.lua'))
chunk()
Start(ScenarioInfo)

-- o "jogo": a cada segundo, unidades andam até o objetivo; times brigam nos pontos
local function step()
    for _, u in ipairs(units) do
        if not u.dead and u.goal then
            local dx, dz = u.goal[1] - u.x, u.goal[3] - u.z
            local d = math.sqrt(dx * dx + dz * dz)
            if d > 4 then u.x = u.x + dx / d * 4; u.z = u.z + dz / d * 4 else u.idle = true; u.goal = nil end
        end
    end
end
-- modo domination/total/supreme: o jogador 1 manda unidades para o primeiro ponto
local maxTime = tonumber(arg[4] or '900')
while now < maxTime do
    for _, th in ipairs(threads) do
        if coroutine.status(th.co) ~= 'dead' and th.wake <= now then
            local ok, w = coroutine.resume(th.co)
            if not ok then error('thread: ' .. tostring(w)) end
            th.wake = now + (tonumber(w) or 0.1)
        end
    end
    now = now + 1
    step()
    -- o jogador 1 destrói 20 unidades de uma vez (primeiro sangue e massacre)
    if now == 25 then ArmyBrains[1].kills = 20 end
    if now == 5 then
        -- tropas do jogador 1 (e do time dele) num ponto
        for i = 1, 5 do local u = newUnit('uul0101', 1, 256, 256) end
    end
    if mode == 'defense' and now % 30 == 0 then
        -- os defensores matam metade das ondas
        local k = 0
        for _, u in ipairs(units) do if u.army ~= 1 and not u.dead and not u.tags.COMMAND then k = k + 1; if k % 2 == 0 then u.dead = true end end end
        if now > 200 then for _, u in ipairs(units) do if u.army ~= 1 and not u.tags.COMMAND then u.dead = true end end end
    end
    -- o que vai para a interface (pelas mensagens de texto do jogo)
    for _, m in ipairs(Sync.PrintText or {}) do
        if m.cp == 'board' then Sync.CPBoard = m.data elseif m.cp == 'record' then Sync.CPRecord = m.data elseif m.cp == 'sound' then Sync.CPSound = Sync.CPSound or {} table.insert(Sync.CPSound, m.data) end
    end
    Sync.PrintText = nil
    if Sync.CPBoard and now % 50 == 0 then
        local l = {}
        for _, x in ipairs(Sync.CPBoard.lines) do table.insert(l, x[1]) end
        table.insert(printed, string.format('[%5.0fs PLACAR   ] %s | %s', now, Sync.CPBoard.title, table.concat(l, ' | ')))
    end
    if Sync.CPSound then sounds = (sounds or 0) + #Sync.CPSound end
    if Sync.CPRecord then break end
    Sync.CPBoard = nil
    Sync.CPSound = nil
end
for _, l in ipairs(printed) do print(l) end
print(string.format('fim: t=%d criados=%d ordens=%d setas=%d visao=%d sons=%d restricoes=%d', now, created, moves, arrows, viz, sounds or 0, restricted))
for _, b in ipairs(ArmyBrains) do print(b.Name, 'time', b.team, 'derrotado', tostring(b:IsDefeated()), 'massa', b.res.MASS, 'energia', b.res.ENERGY, 'pesquisa', b.res.RESEARCH) end
if Sync.CPRecord then local r = Sync.CPRecord print('recorde', r.mode, tostring(r.won), r.seconds, r.waves, r.score, r.map, r.players) end
for _, u in ipairs(units) do if u.max ~= 100 then print('vida', u.bp, u.max, u.name or '') break end end
