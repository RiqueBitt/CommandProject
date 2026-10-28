-- CommandProject: minigames (simulation side). Started by /lua/sim/victory.lua when the match
-- options carry CPMode (the launcher's big match screen, the game's battle lobby panel and the
-- Battle submenu shortcuts put it there). The normal victory check keeps running: the modes end
-- a match by destroying the losing armies, so the game's own result screen and stats still work.
--
--   total       Guerra Total: extra starting resources, strategic points that pay mass, energy
--               and research to whoever holds them; destroy the enemy commanders
--   arena       Arena dos Experimentais: each player starts with experimentals instead of the
--               commander, the safe zone closes in after a while; last one standing wins
--   defense     Ultima Linha de Defesa: time to build, then waves of enemies (bigger each time,
--               experimentals every 5); survive every wave
--   domination  Dominacao Estrategica: control points give score every second; the first team
--               to reach the target wins
--   supreme     Projeto Supremo: research only comes from kills and control points, with levels
--               that pay bonuses; destroy the enemy commanders
--
-- Options (all optional): CPScore (domination target), CPWaves, CPPrep, CPEvery (defense),
-- CPArenaCount, CPRing (arena), CPPoints (number of control points), CPStartRes (percent of the
-- starting bonus). Everything that changes the match uses the sim's own Random, so it plays the
-- same for every player of a network match; only the texts depend on who is looking.

local Mode = ''
local Opts = {}
local Players = {}
local Teams = {}
local TeamOf = {}
local Points = {}
local Over = false
local Recorded = false
local Stats = { waves = 0, score = 0 }

local LETTERS = { 'A', 'B', 'C', 'D', 'E', 'F', 'G' }

-- units by faction (1 UEF, 2 Cybran, 3 Illuminate)
local LAND = {
    { 'uul0101', 'uul0102', 'uul0103', 'uul0104', 'uul0105' },
    { 'ucl0102', 'ucl0103', 'ucl0104' },
    { 'uil0101', 'uil0103', 'uil0104', 'uil0105' },
}
local AIR = {
    { 'uua0101', 'uua0102', 'uua0103' },
    { 'uca0103', 'uca0104' },
    { 'uia0103', 'uia0104' },
}
local EXPERIMENTALS = {
    { 'uux0101', 'uux0111' },
    { 'ucx0101', 'ucx0103', 'ucx0111' },
    { 'uix0101', 'uix0102', 'uix0103', 'uix0111' },
}

------------------------------------------------------------------------------------ helpers

local function N(key, default, lo, hi)
    local v = tonumber(Opts[key] or '') or default
    if lo and v < lo then v = lo end
    if hi and v > hi then v = hi end
    return v
end

local function Say(text, color, size, duration, where)
    PrintText(text, size or 20, color or 'fff2b33d', duration or 6, where or 'centertop')
end

local function Pick(list)
    return list[Random(1, table.getn(list))]
end

local function Alive(brain)
    return brain and not brain:IsDefeated()
end

local function MyTeam()
    local me = GetFocusArmy()
    if me and me > 0 then return TeamOf[me] end
    return nil
end

-- text color for a team: green = yours, red = enemy, white = watching
local function TeamColor(team)
    local mine = MyTeam()
    if not mine then return 'ffffffff' end
    if mine == team then return 'ff7cff7c' end
    return 'ffff6a5a'
end

local function TeamName(team)
    if table.getn(team.brains) == 1 then
        return team.brains[1].Nickname or team.brains[1].Name or LOCF('<LOC CP_MG_TEAM>Team %d', team.id)
    end
    if MyTeam() == team then return LOC('<LOC CP_MG_YOUR_TEAM>Your team') end
    return LOCF('<LOC CP_MG_TEAM>Team %d', team.id)
end

local function StartPos(brain)
    local x, z = brain:GetArmyStartPos()
    return x, z
end

local function MapSize()
    local s = ScenarioInfo.size or { 512, 512 }
    return s[1] or 512, s[2] or 512
end

local function IsWater(x, z)
    return GetSurfaceHeight(x, z) > GetTerrainHeight(x, z) + 0.5
end

local function Spawn(brain, bp, x, z)
    local ok, unit = pcall(CreateUnitHPR, bp, brain.Name, x, GetSurfaceHeight(x, z), z, 0, Random(0, 628) / 100, 0)
    if ok and unit then return unit end
    return nil
end

local function GiveAll(team, mass, energy, research)
    for _, brain in team.brains do
        if Alive(brain) then
            if mass and mass > 0 then brain:GiveResource('MASS', mass) end
            if energy and energy > 0 then brain:GiveResource('ENERGY', energy) end
            if research and research > 0 then brain:GiveResource('RESEARCH', research) end
        end
    end
end

local function KillBrain(brain)
    for _, unit in brain:GetListOfUnits(categories.ALLUNITS, false) do
        if not unit:IsDead() then unit:Kill() end
    end
end

-- the end: every army out of the winning team is destroyed, the normal victory check does the rest
local function Win(team, text)
    if Over then return end
    Over = true
    Say(text or LOCF('<LOC CP_MG_WINS>%s wins!', TeamName(team)), TeamColor(team), 30, 10, 'center')
    ForkThread(function()
        WaitSeconds(3)
        for i = 1, 60 do
            local left = false
            for _, brain in Players do
                if TeamOf[brain:GetArmyIndex()] ~= team and Alive(brain) then
                    left = true
                    KillBrain(brain)
                end
            end
            if not left then return end
            WaitSeconds(1)
        end
    end)
end

-- result for the records of whoever is looking (the user side keeps them in the game profile)
local function Record(won)
    if Recorded then return end
    Recorded = true
    Sync.CPRecord = { mode = Mode, won = won, seconds = math.floor(GetGameTimeSeconds()), waves = Stats.waves, score = Stats.score }
    LOG('*CommandProject minigame result: ' .. Mode .. ' won=' .. tostring(won) .. ' time=' .. math.floor(GetGameTimeSeconds()) .. ' waves=' .. Stats.waves .. ' score=' .. Stats.score)
end

local function WatchResult()
    local out = {}
    while not Recorded do
        WaitSeconds(1)
        -- eliminations, for everyone
        for _, brain in Players do
            local i = brain:GetArmyIndex()
            if brain:IsDefeated() and not out[i] then
                out[i] = true
                Say(LOCF('<LOC CP_MG_OUT>%s is out', brain.Nickname or brain.Name), 'ffffd27a', 16, 5, 'centertop')
            end
        end
        local me = GetFocusArmy()
        if me and me > 0 and ArmyBrains[me] and TeamOf[me] then
            if ArmyBrains[me]:IsDefeated() then
                Record(false)
            else
                local enemies = false
                for _, brain in Players do
                    if TeamOf[brain:GetArmyIndex()] ~= TeamOf[me] and Alive(brain) then enemies = true end
                end
                if not enemies then Record(true) end
            end
        end
    end
end

local function BuildTeams()
    for _, brain in ArmyBrains do
        local i = brain:GetArmyIndex()
        if not ArmyIsCivilian(i) then
            table.insert(Players, brain)
            local team = nil
            for _, t in Teams do
                if IsAlly(t.brains[1]:GetArmyIndex(), i) then
                    team = t
                    break
                end
            end
            if not team then
                team = { id = table.getn(Teams) + 1, brains = {}, score = 0 }
                table.insert(Teams, team)
            end
            table.insert(team.brains, brain)
            TeamOf[i] = team
        end
    end
end

------------------------------------------------------------------------------------ control points

-- spots as fair as possible: about the same distance from the nearest base of every team, away
-- from the bases, on land and apart from each other
local function PickPoints(count)
    local w, h = MapSize()
    local m = math.min(w, h)
    local cx, cz = w / 2, h / 2
    local spots = { { cx, cz } }
    for ring = 1, 3 do
        local r = m * 0.12 * ring
        for k = 0, 7 do
            local a = k * math.pi / 4 + math.mod(ring, 2) * math.pi / 8
            table.insert(spots, { cx + math.cos(a) * r, cz + math.sin(a) * r })
        end
    end
    local scored = {}
    for _, c in spots do
        if c[1] > 20 and c[2] > 20 and c[1] < w - 20 and c[2] < h - 20 and not IsWater(c[1], c[2]) then
            local lo, hi = nil, nil
            for _, t in Teams do
                local best = nil
                for _, b in t.brains do
                    local x, z = StartPos(b)
                    local d = VDist2(x, z, c[1], c[2])
                    if not best or d < best then best = d end
                end
                if best then
                    if not lo or best < lo then lo = best end
                    if not hi or best > hi then hi = best end
                end
            end
            if lo and lo > m * 0.1 then
                table.insert(scored, { pos = c, unfair = hi - lo + VDist2(c[1], c[2], cx, cz) * 0.05 })
            end
        end
    end
    table.sort(scored, function(a, b) return a.unfair < b.unfair end)
    local out = {}
    local gap = m * 0.16
    for _, s in scored do
        local ok = true
        for _, p in out do
            if VDist2(p[1], p[2], s.pos[1], s.pos[2]) < gap then
                ok = false
                break
            end
        end
        if ok then table.insert(out, s.pos) end
        if table.getn(out) >= count then break end
    end
    if table.getn(out) == 0 then table.insert(out, { cx, cz }) end
    return out
end

local function MakePoints(count)
    local w, h = MapSize()
    local radius = math.max(12, math.min(w, h) / 40)
    for i, pos in PickPoints(count) do
        local x, z = pos[1], pos[2]
        local point = { x = x, z = z, r = radius, name = LETTERS[i] or tostring(i), owner = nil, taking = nil, progress = 0 }
        -- the objective arrow of the campaign, visible to everyone
        pcall(function()
            local spec = {
                position = { x, GetSurfaceHeight(x, z) + 8, z },
                orientation = { 0, 6.28, 0 },
                Size = 5,
                IgnoreVizRules = true,
            }
            point.arrow = import('/lua/sim/objectiveArrow.lua').ObjectiveArrow(spec)
        end)
        -- everybody sees who is standing on it
        for _, brain in Players do
            pcall(function()
                import('/lua/sim/VizMarker.lua').VizMarker({ X = x, Z = z, Radius = radius + 6, LifeTime = 0, Army = brain:GetArmyIndex(), Omni = false, Radar = false, WaterVision = false })
            end)
        end
        table.insert(Points, point)
    end
end

local function TeamsOn(point)
    local found = {}
    local list = {}
    local units = GetUnitsInRect(Rect(point.x - point.r, point.z - point.r, point.x + point.r, point.z + point.r)) or {}
    for _, unit in units do
        if not unit:IsDead() and not EntityCategoryContains(categories.AIR, unit) and unit:GetFractionComplete() >= 1 then
            local team = TeamOf[unit:GetArmy()]
            if team and not found[team.id] then
                found[team.id] = true
                table.insert(list, team)
            end
        end
    end
    return list
end

-- one second of the points: a team alone on a point for 5 seconds takes it
local function UpdatePoints()
    for _, p in Points do
        local on = TeamsOn(p)
        if table.getn(on) == 1 then
            local t = on[1]
            if p.owner == t then
                p.progress = 0
                p.taking = nil
            else
                if p.taking ~= t then
                    p.taking = t
                    p.progress = 0
                end
                p.progress = p.progress + 1
                if p.progress >= 5 then
                    p.owner = t
                    p.taking = nil
                    p.progress = 0
                    Say(LOCF('<LOC CP_MG_TAKEN>Point %s taken by %s', p.name, TeamName(t)), TeamColor(t), 18, 5, 'centertop')
                end
            end
        elseif table.getn(on) == 0 then
            p.taking = nil
            p.progress = 0
        end
    end
end

local function PointsHeld(team)
    local n = 0
    for _, p in Points do
        if p.owner == team then n = n + 1 end
    end
    return n
end

local function Board(title, showScore)
    -- the 5 best teams still in the match (and yours, if it is not among them)
    local list = {}
    for _, t in Teams do
        for _, b in t.brains do
            if Alive(b) then
                table.insert(list, t)
                break
            end
        end
    end
    table.sort(list, function(a, b)
        if a.score ~= b.score then return a.score > b.score end
        return a.id < b.id
    end)
    local mine = MyTeam()
    local line = title
    for i, t in list do
        if i <= 5 or t == mine then
            line = line .. '   ' .. TeamName(t) .. ': '
            if showScore ~= false then line = line .. math.floor(t.score) .. ' ' end
            line = line .. '[' .. PointsHeld(t) .. ']'
        end
    end
    Say(line, 'ffe6eef5', 14, 14, 'righttop')
end

-- the AI does not know about the points: now and then a few idle land units go to the nearest
-- point its team does not hold
local function AIToPoints()
    for _, brain in Players do
        if brain.BrainType == 'AI' and Alive(brain) then
            local team = TeamOf[brain:GetArmyIndex()]
            local x, z = StartPos(brain)
            local target, best = nil, nil
            for _, p in Points do
                if p.owner ~= team then
                    local d = VDist2(x, z, p.x, p.z)
                    if not best or d < best then
                        best = d
                        target = p
                    end
                end
            end
            if target then
                local group = {}
                local units = brain:GetListOfUnits(categories.LAND * categories.MOBILE - categories.ENGINEER - categories.COMMAND - categories.EXPERIMENTAL, false)
                for _, unit in units do
                    if not unit:IsDead() and unit:IsIdleState() then
                        table.insert(group, unit)
                        if table.getn(group) >= 6 then break end
                    end
                end
                if table.getn(group) > 0 then
                    IssueAggressiveMove(group, { target.x, GetSurfaceHeight(target.x, target.z), target.z })
                end
            end
        end
    end
end

------------------------------------------------------------------------------------ modes

local function Intro(title, goal, win)
    Say(title, 'fff2b33d', 30, 10, 'center')
    Say(goal, 'ffe6eef5', 18, 12, 'center')
    Say(win, 'ffb8c7d6', 16, 12, 'center')
end

local function StartBonus(mass, energy, research)
    local pct = N('CPStartRes', 100, 0, 1000) / 100
    for _, t in Teams do
        GiveAll(t, math.floor(mass * pct), math.floor(energy * pct), math.floor(research * pct))
    end
end

-- Dominacao Estrategica
local function Domination()
    local target = N('CPScore', 500, 50, 100000)
    MakePoints(N('CPPoints', 3, 1, 7))
    Intro(LOC('<LOC CP_MG_DOM_TITLE>STRATEGIC DOMINATION'),
        LOCF('<LOC CP_MG_DOM_GOAL>Hold the %d control points (the arrows): each one gives your team 1 point per second.', table.getn(Points)),
        LOCF('<LOC CP_MG_DOM_WIN>First team to %d points wins. Stand alone on a point for 5 seconds to take it.', target))
    local tick = 0
    local warned = {}
    while not Over do
        WaitSeconds(1)
        tick = tick + 1
        UpdatePoints()
        for _, t in Teams do
            t.score = t.score + PointsHeld(t)
            local pct = t.score / target
            for _, mark in { 0.5, 0.8, 0.9 } do
                local key = t.id .. ':' .. mark
                if pct >= mark and not warned[key] then
                    warned[key] = true
                    Say(LOCF('<LOC CP_MG_DOM_NEAR>%s has %d of %d points', TeamName(t), math.floor(t.score), target), TeamColor(t), 18, 6, 'centertop')
                end
            end
            if t.score >= target then
                local mine = MyTeam()
                if mine then Stats.score = math.floor(mine.score) end
                Win(t)
                break
            end
        end
        -- holding a point also pays a little
        if math.mod(tick, 10) == 0 then
            for _, t in Teams do
                local n = PointsHeld(t)
                if n > 0 then GiveAll(t, 5 * n, 25 * n, 0) end
            end
        end
        if math.mod(tick, 15) == 0 then Board(LOCF('<LOC CP_MG_DOM_BOARD>Domination (%d)', target)) end
        if math.mod(tick, 40) == 0 then AIToPoints() end
        local mine = MyTeam()
        if mine then Stats.score = math.floor(mine.score) end
    end
end

-- Guerra Total
local function TotalWar()
    StartBonus(1000, 5000, 5)
    MakePoints(N('CPPoints', 5, 1, 7))
    Intro(LOC('<LOC CP_MG_TOTAL_TITLE>TOTAL WAR'),
        LOC('<LOC CP_MG_TOTAL_GOAL>Extra resources to start. The strategic points (the arrows) pay mass, energy and research to whoever holds them.'),
        LOC('<LOC CP_MG_TOTAL_WIN>Destroy the enemy commanders. Fight on several fronts!'))
    local tick = 0
    while not Over do
        WaitSeconds(1)
        tick = tick + 1
        UpdatePoints()
        if math.mod(tick, 10) == 0 then
            for _, t in Teams do
                local n = PointsHeld(t)
                if n > 0 then GiveAll(t, 15 * n, 75 * n, 0) end
            end
        end
        if math.mod(tick, 60) == 0 then
            for _, t in Teams do
                local n = PointsHeld(t)
                if n > 0 then GiveAll(t, 0, 0, n) end
                t.score = PointsHeld(t)
            end
            Board(LOC('<LOC CP_MG_TOTAL_BOARD>Points held'), false)
        end
        if math.mod(tick, 45) == 0 then AIToPoints() end
    end
end

-- Projeto Supremo
local function Supreme()
    MakePoints(N('CPPoints', 3, 1, 7))
    Intro(LOC('<LOC CP_MG_SUP_TITLE>SUPREME PROJECT'),
        LOC('<LOC CP_MG_SUP_GOAL>Research comes from kills and from the control points (the arrows). Each level pays a bonus: choose your path in the research tree.'),
        LOC('<LOC CP_MG_SUP_WIN>Destroy the enemy commanders.'))
    local levels = { 10, 25, 45, 70, 100, 140, 200 }
    local kills, carry, total, level = {}, {}, {}, {}
    for _, brain in Players do
        local i = brain:GetArmyIndex()
        kills[i], carry[i], total[i], level[i] = 0, 0, 0, 0
    end
    local tick = 0
    while not Over do
        WaitSeconds(1)
        tick = tick + 1
        UpdatePoints()
        if math.mod(tick, 5) == 0 then
            for _, brain in Players do
                if Alive(brain) then
                    local i = brain:GetArmyIndex()
                    local now = brain:GetArmyStat('Enemies_Killed', 0).Value or 0
                    local gained = (now - kills[i]) * 0.5 + carry[i]
                    kills[i] = now
                    -- the points: 1 research each 20 s per point
                    if math.mod(tick, 20) == 0 then gained = gained + PointsHeld(TeamOf[i]) end
                    local whole = math.floor(gained)
                    carry[i] = gained - whole
                    if whole > 0 then
                        brain:GiveResource('RESEARCH', whole)
                        total[i] = total[i] + whole
                    end
                    while levels[level[i] + 1] and total[i] >= levels[level[i] + 1] do
                        level[i] = level[i] + 1
                        brain:GiveResource('MASS', 150 * level[i])
                        brain:GiveResource('ENERGY', 750 * level[i])
                        if i == GetFocusArmy() then
                            Say(LOCF('<LOC CP_MG_SUP_LEVEL>Level %d! Bonus of mass and energy', level[i]), 'ff7cff7c', 22, 6, 'centertop')
                        end
                    end
                end
            end
            for _, t in Teams do t.score = 0 end
            for _, brain in Players do
                local i = brain:GetArmyIndex()
                local t = TeamOf[i]
                t.score = t.score + total[i]
            end
            local me = GetFocusArmy()
            if me and total[me] then Stats.score = total[me] end
        end
        if math.mod(tick, 30) == 0 then Board(LOC('<LOC CP_MG_SUP_BOARD>Research earned')) end
        if math.mod(tick, 45) == 0 then AIToPoints() end
    end
end

-- Ultima Linha de Defesa
local function Defense()
    local prep = N('CPPrep', 180, 20, 1200)
    local waves = N('CPWaves', 15, 3, 60)
    local every = N('CPEvery', 75, 30, 600)
    -- the defenders: the team with the most humans (the first one on a tie)
    local defenders, best = nil, -1
    for _, t in Teams do
        local humans = 0
        for _, b in t.brains do
            if b.BrainType == 'Human' then humans = humans + 1 end
        end
        if humans > best then
            best = humans
            defenders = t
        end
    end
    local attackers = {}
    for _, brain in Players do
        if TeamOf[brain:GetArmyIndex()] ~= defenders then
            table.insert(attackers, brain)
            -- the waves do not count against the attackers' unit cap
            pcall(SetIgnoreArmyUnitCap, brain:GetArmyIndex(), true)
        end
    end
    if not defenders or table.getn(attackers) == 0 then
        Say(LOC('<LOC CP_MG_DEF_NOENEMY>Last Line of Defense needs an enemy team'), 'ffff6a5a', 18, 10, 'center')
        return
    end
    Intro(LOC('<LOC CP_MG_DEF_TITLE>LAST LINE OF DEFENSE'),
        LOCF('<LOC CP_MG_DEF_GOAL>You have %d seconds to build your defenses. Then come %d waves, bigger each time (experimentals every 5).', prep, waves),
        LOC('<LOC CP_MG_DEF_WIN>Survive every wave with your commander alive.'))
    GiveAll(defenders, math.floor(500 * N('CPStartRes', 100, 0, 1000) / 100), math.floor(2500 * N('CPStartRes', 100, 0, 1000) / 100), 0)
    local left = prep
    while left > 0 and not Over do
        local step = 1
        if left > 60 then step = left - 60 elseif left > 10 then step = left - 10 end
        WaitSeconds(step)
        left = left - step
        if left == 60 or left == 10 then
            Say(LOCF('<LOC CP_MG_DEF_SOON>First wave in %d seconds', left), 'ffffd27a', 20, 5, 'centertop')
        end
    end
    local defenderCount = 0
    for _, b in defenders.brains do
        if Alive(b) then defenderCount = defenderCount + 1 end
    end
    local last = {}
    for k = 1, waves do
        if Over then return end
        local spawners = {}
        for _, a in attackers do
            if Alive(a) then table.insert(spawners, a) end
        end
        local targets = {}
        for _, d in defenders.brains do
            if Alive(d) then table.insert(targets, d) end
        end
        if table.getn(spawners) == 0 or table.getn(targets) == 0 then break end
        local big = math.mod(k, 5) == 0 or k == waves
        Say(LOCF('<LOC CP_MG_DEF_WAVE>Wave %d of %d is coming!', k, waves), 'ffff6a5a', big and 26 or 22, 6, 'centertop')
        local total = math.min(160, math.floor((4 + 3 * k) * (0.6 + 0.4 * math.max(1, defenderCount))))
        local each = math.ceil(total / table.getn(spawners))
        last = {}
        for si, spawner in spawners do
            local f = spawner:GetFactionIndex()
            if f < 1 or f > 3 then f = 1 end
            local x, z = StartPos(spawner)
            local group = {}
            for n = 1, each do
                local list = LAND[f]
                if k >= 4 and math.mod(n, 4) == 0 then list = AIR[f] end
                local unit = Spawn(spawner, Pick(list), x + Random(-14, 14), z + Random(-14, 14))
                if unit then table.insert(group, unit) end
            end
            if big and (si == 1 or k == waves) then
                local unit = Spawn(spawner, Pick(EXPERIMENTALS[f]), x + Random(-8, 8), z + Random(-8, 8))
                if unit then table.insert(group, unit) end
            end
            local target = targets[Random(1, table.getn(targets))]
            local tx, tz = StartPos(target)
            if table.getn(group) > 0 then
                IssueAggressiveMove(group, { tx, GetSurfaceHeight(tx, tz), tz })
            end
            for _, u in group do table.insert(last, u) end
        end
        if k < waves then
            WaitSeconds(every)
            Stats.waves = k
            -- repairs and reinforcements between the waves
            GiveAll(defenders, 40 * k, 200 * k, 0)
            Say(LOCF('<LOC CP_MG_DEF_HELD>Wave %d held! Supplies arrived', k), 'ff7cff7c', 18, 5, 'centertop')
        end
    end
    -- the last wave: it has to be destroyed (or 4 minutes go by)
    for i = 1, 240 do
        if Over then return end
        WaitSeconds(1)
        local alive = 0
        for _, u in last do
            if not u:IsDead() then alive = alive + 1 end
        end
        if alive == 0 then break end
    end
    Stats.waves = waves
    Win(defenders, LOC('<LOC CP_MG_DEF_DONE>Every wave held: the base is safe!'))
end

-- Arena dos Experimentais
local function Arena()
    local count = N('CPArenaCount', 1, 1, 5)
    Intro(LOC('<LOC CP_MG_ARENA_TITLE>EXPERIMENTAL ARENA'),
        LOCF('<LOC CP_MG_ARENA_GOAL>Each player gets %d experimental(s) instead of the commander.', count),
        LOC('<LOC CP_MG_ARENA_WIN>Last one standing wins. After a while the safe zone closes in on the center.'))
    for _, brain in Players do
        local f = brain:GetFactionIndex()
        if f < 1 or f > 3 then f = 1 end
        local x, z = StartPos(brain)
        local made = 0
        for i = 1, count do
            local a = (i - 1) * 6.28 / count
            local unit = Spawn(brain, Pick(EXPERIMENTALS[f]), x + math.cos(a) * 10 * (i - 1), z + math.sin(a) * 10 * (i - 1))
            if unit then made = made + 1 end
        end
        if made > 0 then
            for _, c in brain:GetListOfUnits(categories.COMMAND + categories.ENGINEER, false) do
                if not c:IsDead() then c:Destroy() end
            end
        end
    end
    -- the AI has no commander here: its experimentals go after the nearest enemy every few seconds
    ForkThread(function()
        while not Over do
            WaitSeconds(8)
            for _, brain in Players do
                if brain.BrainType == 'AI' and Alive(brain) then
                    local team = TeamOf[brain:GetArmyIndex()]
                    for _, unit in brain:GetListOfUnits(categories.ALLUNITS, false) do
                        if not unit:IsDead() and unit:IsIdleState() then
                            local p = unit:GetPosition()
                            local target, best = nil, nil
                            for _, other in Players do
                                if TeamOf[other:GetArmyIndex()] ~= team and Alive(other) then
                                    for _, e in other:GetListOfUnits(categories.ALLUNITS, false) do
                                        if not e:IsDead() then
                                            local q = e:GetPosition()
                                            local d = VDist2(p[1], p[3], q[1], q[3])
                                            if not best or d < best then
                                                best = d
                                                target = q
                                            end
                                        end
                                    end
                                end
                            end
                            if target then IssueAggressiveMove({ unit }, { target[1], target[2], target[3] }) end
                        end
                    end
                end
            end
        end
    end)
    local ring = N('CPRing', 180, 0, 3600)
    if ring <= 0 then return end
    WaitSeconds(ring)
    if Over then return end
    local w, h = MapSize()
    local cx, cz = w / 2, h / 2
    local far = VDist2(0, 0, cx, cz)
    local close = math.min(w, h) * 0.1
    pcall(function()
        import('/lua/sim/objectiveArrow.lua').ObjectiveArrow({ position = { cx, GetSurfaceHeight(cx, cz) + 8, cz }, orientation = { 0, 6.28, 0 }, Size = 6, IgnoreVizRules = true })
    end)
    Say(LOC('<LOC CP_MG_ARENA_RING>The safe zone is closing: head to the center (the arrow)!'), 'ffff6a5a', 22, 8, 'centertop')
    local steps = 120
    for s = 0, 100000 do
        if Over then return end
        local radius = math.max(close, far - (far - close) * math.min(1, s / steps))
        for _, brain in Players do
            if Alive(brain) then
                for _, unit in brain:GetListOfUnits(categories.ALLUNITS, false) do
                    if not unit:IsDead() then
                        local p = unit:GetPosition()
                        if VDist2(p[1], p[3], cx, cz) > radius then
                            local hurt = unit:GetMaxHealth() * 0.03
                            if unit:GetHealth() <= hurt then unit:Kill() else unit:AdjustHealth(unit, -hurt) end
                        end
                    end
                end
            end
        end
        WaitSeconds(2)
    end
end

------------------------------------------------------------------------------------ start

local MODES = { domination = Domination, total = TotalWar, supreme = Supreme, defense = Defense, arena = Arena }

function Start(scenarioInfo)
    Opts = scenarioInfo.Options or {}
    Mode = tostring(Opts.CPMode or '')
    local run = MODES[Mode]
    if not run then
        WARN('*CommandProject minigame: unknown mode ' .. Mode)
        return
    end
    BuildTeams()
    LOG('*CommandProject minigame: ' .. Mode .. ' with ' .. table.getn(Players) .. ' players in ' .. table.getn(Teams) .. ' teams')
    ForkThread(WatchResult)
    -- (no pcall around it: a thread cannot wait inside a pcall in this Lua)
    ForkThread(function()
        WaitSeconds(1)
        run()
    end)
end
