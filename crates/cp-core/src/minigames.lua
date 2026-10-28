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
-- one more line under the scoreboard (time left, waves, events)
local Extra = nil

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

-- interface sounds of the game (played on the user side, see minigames_records.lua)
local function Sound(cue)
    if not Sync.CPSound then Sync.CPSound = {} end
    table.insert(Sync.CPSound, cue)
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
    Sync.CPRecord = {
        mode = Mode, won = won, seconds = math.floor(GetGameTimeSeconds()), waves = Stats.waves, score = Stats.score,
        map = tostring(ScenarioInfo.name or ''), mut = tostring(Opts.CPMut or ''), week = tonumber(Opts.CPWeek or '') or 0,
        events = Opts.CPEvents == '1', players = table.getn(Players),
    }
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

local function Arrow(x, z, size)
    local arrow = nil
    pcall(function()
        arrow = import('/lua/sim/objectiveArrow.lua').ObjectiveArrow({
            position = { x, GetSurfaceHeight(x, z) + 8, z },
            orientation = { 0, 6.28, 0 },
            Size = size or 5,
            IgnoreVizRules = true,
        })
    end)
    return arrow
end

local function Vision(brain, x, z, radius)
    pcall(function()
        import('/lua/sim/VizMarker.lua').VizMarker({ X = x, Z = z, Radius = radius, LifeTime = 0, Army = brain:GetArmyIndex(), Omni = false, Radar = false, WaterVision = false })
    end)
end

local function MakePointsAt(spots)
    local w, h = MapSize()
    local radius = math.max(12, math.min(w, h) / 40)
    for i, pos in spots do
        local x, z = pos[1], pos[2]
        local point = { x = x, z = z, r = radius, name = LETTERS[i] or tostring(i), owner = nil, taking = nil, progress = 0 }
        -- the objective arrow of the campaign, visible to everyone
        point.arrow = Arrow(x, z, 5)
        -- everybody sees who is standing on it
        for _, brain in Players do Vision(brain, x, z, radius + 6) end
        table.insert(Points, point)
    end
end

local function MakePoints(count)
    MakePointsAt(PickPoints(count))
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
                    Sound('UI_MFD_checklist')
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
    -- the fixed scoreboard at the top right (drawn by the user side)
    local lines = {}
    for i, t in list do
        if i <= 6 or t == mine then
            local line = TeamName(t) .. ':'
            if showScore ~= false then line = line .. ' ' .. math.floor(t.score) end
            if table.getn(Points) > 0 then line = line .. '  [' .. PointsHeld(t) .. '/' .. table.getn(Points) .. ']' end
            table.insert(lines, { line, TeamColor(t) })
        end
    end
    if Extra then table.insert(lines, { Extra, 'ffb8c7d6' }) end
    Sync.CPBoard = { title = title, lines = lines }
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
        if math.mod(tick, 2) == 0 then Board(LOCF('<LOC CP_MG_DOM_BOARD>Domination (%d)', target)) end
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
            end
        end
        if math.mod(tick, 3) == 0 then
            for _, t in Teams do t.score = PointsHeld(t) end
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
        if math.mod(tick, 5) == 0 then Board(LOC('<LOC CP_MG_SUP_BOARD>Research earned')) end
        if math.mod(tick, 45) == 0 then AIToPoints() end
    end
end

-- the boss of a wave: an experimental with three times the health and a name
local function Boss(unit)
    pcall(function()
        unit:SetMaxHealth(unit:GetMaxHealth() * 3)
        unit:SetHealth(unit, unit:GetMaxHealth())
        unit:SetCustomName(LOC('<LOC CP_MG_BOSS>BOSS'))
    end)
    pcall(function()
        import('/lua/sim/objectiveArrow.lua').ObjectiveArrow({ AttachTo = unit, Size = 2 })
    end)
end

-- Ultima Linha de Defesa (endless = Sobrevivencia Infinita: waves until the base falls)
local function Defense(endless)
    local prep = N('CPPrep', 180, 20, 1200)
    local waves = N('CPWaves', 15, 3, 60)
    if endless then waves = 100000 end
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
    if endless then
        Intro(LOC('<LOC CP_MG_SURV_TITLE>ENDLESS SURVIVAL'),
            LOCF('<LOC CP_MG_SURV_GOAL>You have %d seconds to build. Then the waves never stop: every 5 a boss.', prep),
            LOC('<LOC CP_MG_SURV_WIN>How many waves can you hold? Your record is kept.'))
    else
        Intro(LOC('<LOC CP_MG_DEF_TITLE>LAST LINE OF DEFENSE'),
            LOCF('<LOC CP_MG_DEF_GOAL>You have %d seconds to build your defenses. Then come %d waves, bigger each time (experimentals every 5).', prep, waves),
            LOC('<LOC CP_MG_DEF_WIN>Survive every wave with your commander alive.'))
    end
    local res = N('CPStartRes', 100, 0, 1000) / 100
    GiveAll(defenders, math.floor(500 * res), math.floor(2500 * res), 0)
    local function Show(k)
        if endless then
            Extra = LOCF('<LOC CP_MG_SURV_EXTRA>Waves held: %d', Stats.waves)
        else
            Extra = LOCF('<LOC CP_MG_DEF_EXTRA>Wave %d of %d', k, waves)
        end
        for _, t in Teams do t.score = 0 end
        defenders.score = Stats.waves
        Board(endless and LOC('<LOC CP_MG_SURV_TITLE>ENDLESS SURVIVAL') or LOC('<LOC CP_MG_DEF_TITLE>LAST LINE OF DEFENSE'), false)
    end
    local left = prep
    while left > 0 and not Over do
        local step = 1
        if left > 60 then step = left - 60 elseif left > 10 then step = left - 10 end
        WaitSeconds(step)
        left = left - step
        if left == 60 or left == 10 then
            Say(LOCF('<LOC CP_MG_DEF_SOON>First wave in %d seconds', left), 'ffffd27a', 20, 5, 'centertop')
            Sound('UI_Announcement_Open')
        end
    end
    local defenderCount = 0
    for _, b in defenders.brains do
        if Alive(b) then defenderCount = defenderCount + 1 end
    end
    -- the difficulty follows how the defense is going: cleared fast = bigger waves; struggling =
    -- smaller ones and more supplies
    local pressure = 1
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
        Show(k)
        if endless then
            Say(LOCF('<LOC CP_MG_SURV_WAVE>Wave %d!', k), 'ffff6a5a', 26, 6, 'centertop')
        else
            Say(LOCF('<LOC CP_MG_DEF_WAVE>Wave %d of %d is coming!', k, waves), 'ffff6a5a', big and 26 or 22, 6, 'centertop')
        end
        if big then Say(LOC('<LOC CP_MG_DEF_BOSS>A boss is coming with this wave!'), 'ffff6a5a', 20, 6, 'centertop') end
        Sound('UI_Announcement_Open')
        local total = math.min(200, math.floor((4 + 3 * k) * (0.6 + 0.4 * math.max(1, defenderCount)) * pressure))
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
                if unit then
                    Boss(unit)
                    table.insert(group, unit)
                end
            end
            local target = targets[Random(1, table.getn(targets))]
            local tx, tz = StartPos(target)
            if table.getn(group) > 0 then
                IssueAggressiveMove(group, { tx, GetSurfaceHeight(tx, tz), tz })
            end
            for _, u in group do table.insert(last, u) end
        end
        if k < waves then
            -- the wave time, with the scoreboard updated
            local cleared = nil
            for t = 1, every do
                WaitSeconds(1)
                if Over then return end
                if not cleared then
                    local alive = 0
                    for _, u in last do
                        if not u:IsDead() then alive = alive + 1 end
                    end
                    if alive == 0 then cleared = t end
                end
                if math.mod(t, 5) == 0 then Show(k) end
            end
            local alive = 0
            for _, u in last do
                if not u:IsDead() then alive = alive + 1 end
            end
            Stats.waves = k
            local supplies = 1
            if cleared and cleared < every / 2 then
                pressure = math.min(3, pressure * 1.15)
            elseif alive > table.getn(last) / 2 then
                pressure = math.max(0.5, pressure * 0.85)
                supplies = 1.5
                Say(LOC('<LOC CP_MG_DEF_HELP>Tough fight: extra supplies sent'), 'ffffd27a', 16, 5, 'centertop')
            end
            -- repairs and reinforcements between the waves
            GiveAll(defenders, math.floor(40 * k * supplies), math.floor(200 * k * supplies), 0)
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

local function Survival()
    Defense(true)
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

-- Rei da Colina: one hill, held without a break for CPHold seconds; it moves every CPMove seconds
local function KingOfTheHill()
    local hold = N('CPHold', 180, 30, 1800)
    local move = N('CPMove', 240, 0, 3600)
    local spots = PickPoints(5)
    MakePointsAt({ spots[1] })
    local hill = Points[1]
    Intro(LOC('<LOC CP_MG_KOTH_TITLE>KING OF THE HILL'),
        LOC('<LOC CP_MG_KOTH_GOAL>One hill (the arrow). Stand alone on it for 5 seconds to take it.'),
        LOCF('<LOC CP_MG_KOTH_WIN>Hold it for %d seconds in a row to win. The hill moves from time to time.', hold))
    local held, tick, spot = 0, 0, 1
    local owner = nil
    while not Over do
        WaitSeconds(1)
        tick = tick + 1
        UpdatePoints()
        if hill.owner ~= owner then
            owner = hill.owner
            held = 0
        end
        -- contested: the clock stops
        local on = TeamsOn(hill)
        if owner and table.getn(on) == 1 and on[1] == owner then held = held + 1 end
        if owner and table.getn(on) == 0 then held = held + 1 end
        for _, t in Teams do
            if t == owner and held > t.score then t.score = held end
        end
        if owner then
            Extra = LOCF('<LOC CP_MG_KOTH_EXTRA>%s holds the hill: %d s left', TeamName(owner), math.max(0, hold - held))
            if held == hold - 30 then Say(LOCF('<LOC CP_MG_KOTH_NEAR>%s: 30 seconds to win!', TeamName(owner)), TeamColor(owner), 20, 5, 'centertop') Sound('UI_Announcement_Open') end
            if held >= hold then
                local mine = MyTeam()
                if mine then Stats.score = math.floor(mine.score) end
                Win(owner)
                break
            end
        else
            Extra = LOC('<LOC CP_MG_KOTH_FREE>The hill is free')
        end
        if move > 0 and math.mod(tick, move) == 0 and table.getn(spots) > 1 then
            spot = math.mod(spot, table.getn(spots)) + 1
            hill.x, hill.z = spots[spot][1], spots[spot][2]
            hill.owner, hill.taking, hill.progress = nil, nil, 0
            if hill.arrow then pcall(function() hill.arrow:Destroy() end) end
            hill.arrow = Arrow(hill.x, hill.z, 5)
            for _, brain in Players do Vision(brain, hill.x, hill.z, hill.r + 6) end
            Say(LOC('<LOC CP_MG_KOTH_MOVED>The hill moved! Follow the arrow'), 'ffffd27a', 22, 6, 'centertop')
            Sound('UI_Announcement_Open')
        end
        if math.mod(tick, 2) == 0 then Board(LOC('<LOC CP_MG_KOTH_BOARD>Longest hold (s)')) end
        if math.mod(tick, 30) == 0 then AIToPoints() end
        local mine = MyTeam()
        if mine then Stats.score = math.floor(mine.score) end
    end
end

-- Escolta (VIP): each team protects a tough engineer; losing it loses the match
local ENGINEERS = { 'uul0002', 'ucl0002', 'uil0002' }
local function Escort()
    Intro(LOC('<LOC CP_MG_VIP_TITLE>ESCORT'),
        LOC('<LOC CP_MG_VIP_GOAL>Each team has a VIP (an engineer with an arrow, 5 times tougher). Keep yours alive.'),
        LOC('<LOC CP_MG_VIP_WIN>A team whose VIP dies is out. Hunt the enemy VIPs!'))
    local vips = {}
    for _, t in Teams do
        local brain = t.brains[1]
        local f = brain:GetFactionIndex()
        if f < 1 or f > 3 then f = 1 end
        local x, z = StartPos(brain)
        local unit = Spawn(brain, ENGINEERS[f], x + 6, z + 6)
        if unit then
            pcall(function()
                unit:SetMaxHealth(unit:GetMaxHealth() * 5)
                unit:SetHealth(unit, unit:GetMaxHealth())
                unit:SetCustomName('VIP')
            end)
            pcall(function() import('/lua/sim/objectiveArrow.lua').ObjectiveArrow({ AttachTo = unit, Size = 2 }) end)
            vips[t.id] = unit
        end
    end
    local tick = 0
    local lost = {}
    while not Over do
        WaitSeconds(1)
        tick = tick + 1
        local alive = {}
        for _, t in Teams do
            local u = vips[t.id]
            if u and not lost[t.id] then
                if u:IsDead() then
                    lost[t.id] = true
                    Say(LOCF('<LOC CP_MG_VIP_LOST>The VIP of %s fell!', TeamName(t)), TeamColor(t), 22, 6, 'centertop')
                    Sound('UI_Announcement_Open')
                    for _, b in t.brains do
                        if Alive(b) then KillBrain(b) end
                    end
                else
                    table.insert(alive, t)
                    t.score = math.floor(100 * u:GetHealth() / u:GetMaxHealth())
                end
            end
        end
        if table.getn(alive) == 1 then
            Win(alive[1])
            break
        end
        if math.mod(tick, 2) == 0 then Board(LOC('<LOC CP_MG_VIP_BOARD>VIP health (%)')) end
        -- the AI goes after the nearest enemy VIP
        if math.mod(tick, 30) == 0 then
            for _, brain in Players do
                if brain.BrainType == 'AI' and Alive(brain) then
                    local team = TeamOf[brain:GetArmyIndex()]
                    local x, z = StartPos(brain)
                    local target, bestd = nil, nil
                    for id, u in vips do
                        if id ~= team.id and not u:IsDead() then
                            local p = u:GetPosition()
                            local d = VDist2(x, z, p[1], p[3])
                            if not bestd or d < bestd then
                                bestd = d
                                target = p
                            end
                        end
                    end
                    if target then
                        local group = {}
                        for _, unit in brain:GetListOfUnits(categories.MOBILE - categories.ENGINEER - categories.COMMAND, false) do
                            if not unit:IsDead() and unit:IsIdleState() then
                                table.insert(group, unit)
                                if table.getn(group) >= 8 then break end
                            end
                        end
                        if table.getn(group) > 0 then IssueAggressiveMove(group, { target[1], target[2], target[3] }) end
                    end
                end
            end
        end
    end
end

-- Corrida de Recursos: the first team to produce CPScore mass wins
local function Race()
    local target = N('CPScore', 20000, 1000, 1000000)
    Intro(LOC('<LOC CP_MG_RACE_TITLE>RESOURCE RACE'),
        LOCF('<LOC CP_MG_RACE_GOAL>Build up your economy: the first team to produce %d mass wins.', target),
        LOC('<LOC CP_MG_RACE_WIN>Attacking slows the others down... and destroying a commander still counts.'))
    local warned = {}
    local tick = 0
    while not Over do
        WaitSeconds(1)
        tick = tick + 1
        for _, t in Teams do
            local sum = 0
            for _, b in t.brains do
                sum = sum + (b:GetArmyStat('Economy_TotalProduced_Mass', 0).Value or 0)
            end
            t.score = sum
            for _, mark in { 0.5, 0.8, 0.9 } do
                local key = t.id .. ':' .. mark
                if sum / target >= mark and not warned[key] then
                    warned[key] = true
                    Say(LOCF('<LOC CP_MG_RACE_NEAR>%s has %d%% of the mass', TeamName(t), math.floor(mark * 100)), TeamColor(t), 18, 6, 'centertop')
                end
            end
            if sum >= target then
                local mine = MyTeam()
                if mine then Stats.score = math.floor(mine.score) end
                Win(t)
                break
            end
        end
        local mine = MyTeam()
        if mine then Stats.score = math.floor(mine.score) end
        if math.mod(tick, 2) == 0 then Board(LOCF('<LOC CP_MG_RACE_BOARD>Mass produced (goal %d)', target)) end
    end
end

-- Caca ao Tesouro: crates appear around the map; the first team to collect CPScore of them wins
local function Treasure()
    local target = N('CPScore', 7, 1, 100)
    local every = N('CPEvery', 60, 15, 600)
    Intro(LOC('<LOC CP_MG_TREASURE_TITLE>TREASURE HUNT'),
        LOCF('<LOC CP_MG_TREASURE_GOAL>Crates (the arrows) appear around the map every %d seconds, with a prize inside.', every),
        LOCF('<LOC CP_MG_TREASURE_WIN>Reach a crate first. The first team to collect %d wins.', target))
    local w, h = MapSize()
    local crates = {}
    local tick = 0
    while not Over do
        WaitSeconds(1)
        tick = tick + 1
        if math.mod(tick, every) == 5 and table.getn(crates) < 4 then
            for tries = 1, 20 do
                local x, z = Random(40, math.floor(w) - 40), Random(40, math.floor(h) - 40)
                if not IsWater(x, z) then
                    table.insert(crates, { x = x, z = z, r = 10, arrow = Arrow(x, z, 4) })
                    for _, brain in Players do Vision(brain, x, z, 16) end
                    Say(LOC('<LOC CP_MG_TREASURE_NEW>A new crate appeared! Follow the arrow'), 'ffffd27a', 20, 5, 'centertop')
                    Sound('UI_Announcement_Open')
                    break
                end
            end
        end
        for i = table.getn(crates), 1, -1 do
            local c = crates[i]
            local on = TeamsOn(c)
            if table.getn(on) == 1 then
                local t = on[1]
                t.score = t.score + 1
                table.remove(crates, i)
                if c.arrow then pcall(function() c.arrow:Destroy() end) end
                -- the prize
                local prize = Random(1, 4)
                if prize == 1 then
                    GiveAll(t, 800, 4000, 0)
                    Say(LOCF('<LOC CP_MG_TREASURE_RES>%s found mass and energy!', TeamName(t)), TeamColor(t), 18, 5, 'centertop')
                elseif prize == 2 then
                    GiveAll(t, 0, 0, 10)
                    Say(LOCF('<LOC CP_MG_TREASURE_RP>%s found research!', TeamName(t)), TeamColor(t), 18, 5, 'centertop')
                elseif prize == 3 then
                    local b = t.brains[1]
                    local f = b:GetFactionIndex()
                    if f < 1 or f > 3 then f = 1 end
                    Spawn(b, Pick(EXPERIMENTALS[f]), c.x, c.z)
                    Say(LOCF('<LOC CP_MG_TREASURE_EXP>%s found an experimental!', TeamName(t)), TeamColor(t), 20, 6, 'centertop')
                else
                    GiveAll(t, 300, 1500, 4)
                    Say(LOCF('<LOC CP_MG_TREASURE_MIX>%s found supplies!', TeamName(t)), TeamColor(t), 18, 5, 'centertop')
                end
                Sound('UI_MFD_checklist')
                if t.score >= target then
                    local mine = MyTeam()
                    if mine then Stats.score = math.floor(mine.score) end
                    Win(t)
                end
            end
        end
        local mine = MyTeam()
        if mine then Stats.score = math.floor(mine.score) end
        Extra = LOCF('<LOC CP_MG_TREASURE_EXTRA>Crates on the map: %d', table.getn(crates))
        if math.mod(tick, 2) == 0 then Board(LOCF('<LOC CP_MG_TREASURE_BOARD>Crates (goal %d)', target)) end
        -- the AI goes for the crates too
        if math.mod(tick, 20) == 0 and table.getn(crates) > 0 then
            for _, brain in Players do
                if brain.BrainType == 'AI' and Alive(brain) then
                    local x, z = StartPos(brain)
                    local c, bestd = nil, nil
                    for _, cc in crates do
                        local d = VDist2(x, z, cc.x, cc.z)
                        if not bestd or d < bestd then bestd = d c = cc end
                    end
                    local group = {}
                    for _, unit in brain:GetListOfUnits(categories.MOBILE - categories.ENGINEER - categories.COMMAND - categories.EXPERIMENTAL, false) do
                        if not unit:IsDead() and unit:IsIdleState() then
                            table.insert(group, unit)
                            if table.getn(group) >= 4 then break end
                        end
                    end
                    if c and table.getn(group) > 0 then IssueAggressiveMove(group, { c.x, GetSurfaceHeight(c.x, c.z), c.z }) end
                end
            end
        end
    end
end

------------------------------------------------------------------------------------ mutators and events

-- CPMut = list of: air (only air units and engineers are built), hp (units with double health),
-- res (double income), cdr (commanders 3 times tougher)
local function HasMut(key)
    local m = ',' .. tostring(Opts.CPMut or '') .. ','
    return string.find(m, ',' .. key .. ',', 1, true) ~= nil
end

local function Mutators()
    local names = {}
    if HasMut('air') then
        table.insert(names, LOC('<LOC CP_MG_MUT_AIR>Air only'))
        local cats = (categories.LAND + categories.NAVAL) * categories.MOBILE - categories.ENGINEER - categories.COMMAND
        for _, brain in Players do
            pcall(AddBuildRestriction, brain:GetArmyIndex(), cats)
            pcall(SetUIBuildRestrictions, brain:GetArmyIndex(), cats)
        end
    end
    if HasMut('hp') then table.insert(names, LOC('<LOC CP_MG_MUT_HP>Double health')) end
    if HasMut('res') then table.insert(names, LOC('<LOC CP_MG_MUT_RES>Double income')) end
    if HasMut('cdr') then table.insert(names, LOC('<LOC CP_MG_MUT_CDR>Tough commanders')) end
    if table.getn(names) == 0 then return end
    Say(LOC('<LOC CP_MG_MUT_ON>Mutators:') .. ' ' .. table.concat(names, ' · '), 'ffd7b8ff', 18, 10, 'center')
    -- double income: what the economy makes, given again. The income reading is calibrated in the
    -- first 20 s against the total produced (so what we give is never counted twice)
    local scale = {}
    if HasMut('res') then
        ForkThread(function()
            local m0, e0, mi, ei = {}, {}, {}, {}
            for _, brain in Players do
                local i = brain:GetArmyIndex()
                m0[i] = brain:GetArmyStat('Economy_TotalProduced_Mass', 0).Value or 0
                e0[i] = brain:GetArmyStat('Economy_TotalProduced_Energy', 0).Value or 0
                mi[i], ei[i] = 0, 0
            end
            for t = 1, 20 do
                WaitSeconds(1)
                for _, brain in Players do
                    local i = brain:GetArmyIndex()
                    mi[i] = mi[i] + (brain:GetEconomyIncome('MASS') or 0)
                    ei[i] = ei[i] + (brain:GetEconomyIncome('ENERGY') or 0)
                end
            end
            for _, brain in Players do
                local i = brain:GetArmyIndex()
                local dm = (brain:GetArmyStat('Economy_TotalProduced_Mass', 0).Value or 0) - m0[i]
                local de = (brain:GetArmyStat('Economy_TotalProduced_Energy', 0).Value or 0) - e0[i]
                -- seconds of income per reading (10 when the reading is per tick); 10 when unknown
                local k = 10
                if mi[i] > 0 and dm > 0 then k = dm / mi[i] elseif ei[i] > 0 and de > 0 then k = de / ei[i] end
                scale[i] = math.max(0.5, math.min(20, k))
            end
        end)
    end
    -- units get their boost once, when they show up
    local done = {}
    while not Over do
        for _, brain in Players do
            if Alive(brain) then
                if HasMut('hp') or HasMut('cdr') then
                    for _, unit in brain:GetListOfUnits(categories.ALLUNITS, false) do
                        local id = unit:GetEntityId()
                        if not done[id] and not unit:IsDead() and unit:GetFractionComplete() >= 1 then
                            done[id] = true
                            local k = 1
                            if HasMut('hp') then k = k * 2 end
                            if HasMut('cdr') and EntityCategoryContains(categories.COMMAND, unit) then k = k * 3 end
                            if k > 1 then
                                pcall(function()
                                    local frac = unit:GetHealth() / unit:GetMaxHealth()
                                    unit:SetMaxHealth(unit:GetMaxHealth() * k)
                                    unit:SetHealth(unit, unit:GetMaxHealth() * frac)
                                end)
                            end
                        end
                    end
                end
                local k = scale[brain:GetArmyIndex()]
                if k then
                    -- 2 seconds of income
                    brain:GiveResource('MASS', (brain:GetEconomyIncome('MASS') or 0) * k * 2)
                    brain:GiveResource('ENERGY', (brain:GetEconomyIncome('ENERGY') or 0) * k * 2)
                end
            end
        end
        WaitSeconds(2)
    end
end

-- random events every few minutes (CPEvents=1)
local function Events()
    local w, h = MapSize()
    WaitSeconds(N('CPEventFirst', 240, 30, 3600))
    while not Over do
        local kind = Random(1, 4)
        if kind == 1 then
            -- meteor shower on a marked area
            local x, z = Random(60, math.floor(w) - 60), Random(60, math.floor(h) - 60)
            local r = math.max(25, math.min(w, h) / 16)
            local arrow = Arrow(x, z, 6)
            for _, brain in Players do Vision(brain, x, z, r + 10) end
            Say(LOC('<LOC CP_MG_EV_METEOR>Meteor shower in 15 seconds at the arrow: get out of there!'), 'ffff6a5a', 22, 8, 'centertop')
            Sound('UI_Announcement_Open')
            WaitSeconds(15)
            for hit = 1, 8 do
                local units = GetUnitsInRect(Rect(x - r, z - r, x + r, z + r)) or {}
                for _, unit in units do
                    if not unit:IsDead() then
                        local p = unit:GetPosition()
                        if VDist2(p[1], p[3], x, z) <= r then
                            local hurt = unit:GetMaxHealth() * 0.06
                            if unit:GetHealth() <= hurt then unit:Kill() else unit:AdjustHealth(unit, -hurt) end
                        end
                    end
                end
                WaitSeconds(1)
            end
            if arrow then pcall(function() arrow:Destroy() end) end
        elseif kind == 2 then
            -- reinforcement for the team that is behind
            local weakest, low = nil, nil
            for _, t in Teams do
                local n = 0
                for _, b in t.brains do
                    if Alive(b) then n = n + table.getn(b:GetListOfUnits(categories.MOBILE, false)) end
                end
                if n > 0 and (not low or n < low) then
                    low = n
                    weakest = t
                end
            end
            if weakest then
                local b = nil
                for _, bb in weakest.brains do
                    if Alive(bb) then b = bb break end
                end
                if b then
                    local f = b:GetFactionIndex()
                    if f < 1 or f > 3 then f = 1 end
                    local x, z = StartPos(b)
                    Spawn(b, Pick(EXPERIMENTALS[f]), x + Random(-10, 10), z + Random(-10, 10))
                    Say(LOCF('<LOC CP_MG_EV_HELP>Reinforcement: an experimental joins %s!', TeamName(weakest)), TeamColor(weakest), 20, 6, 'centertop')
                    Sound('UI_Announcement_Open')
                end
            end
        elseif kind == 3 then
            Say(LOC('<LOC CP_MG_EV_RESEARCH>Research breakthrough: research points for everyone!'), 'ff8fd3ff', 20, 6, 'centertop')
            for _, t in Teams do GiveAll(t, 0, 0, 6) end
            Sound('UI_MFD_checklist')
        else
            Say(LOC('<LOC CP_MG_EV_SUPPLY>Supply drop: mass and energy for everyone!'), 'ff7cff7c', 20, 6, 'centertop')
            for _, t in Teams do GiveAll(t, 400, 2000, 0) end
            Sound('UI_MFD_checklist')
        end
        WaitSeconds(N('CPEventEvery', 300, 60, 3600) + Random(-60, 60))
    end
end

------------------------------------------------------------------------------------ start

local MODES = {
    domination = Domination, total = TotalWar, supreme = Supreme, defense = function() Defense(false) end, arena = Arena,
    survival = Survival, koth = KingOfTheHill, vip = Escort, race = Race, treasure = Treasure,
}

function Start(scenarioInfo)
    Opts = scenarioInfo.Options or {}
    Mode = tostring(Opts.CPMode or '')
    local run = MODES[Mode]
    if not run and Mode ~= '' then
        WARN('*CommandProject minigame: unknown mode ' .. Mode)
        return
    end
    BuildTeams()
    LOG('*CommandProject minigame: ' .. Mode .. ' with ' .. table.getn(Players) .. ' players in ' .. table.getn(Teams) .. ' teams, mutators ' .. tostring(Opts.CPMut or '') .. ', events ' .. tostring(Opts.CPEvents or ''))
    -- mutators and events also work in a normal match
    if Opts.CPMut and Opts.CPMut ~= '' then ForkThread(Mutators) end
    if Opts.CPEvents == '1' then ForkThread(Events) end
    if not run then return end
    ForkThread(WatchResult)
    -- (no pcall around it: a thread cannot wait inside a pcall in this Lua)
    ForkThread(function()
        WaitSeconds(1)
        run()
    end)
end
