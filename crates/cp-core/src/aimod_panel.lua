-- CommandProject: "what the AI is thinking" panel and the AI's memory of the player (generated
-- by the launcher). Appended to the game's own consoleecho.lua; CreateConsoleEcho (called when the
-- game screen is built) runs CPAIPanelInit. Only with a single human in the match:
--   * the AI commanders send their plans through Sync.CPAIStatus (read every frame); @KEY@ (or the IA tab on the
--     left edge) shows and hides the panel;
--   * the player model arrives through Sync.CPAIModel and is kept in Game.prefs (CPAIMemory),
--     per map; at the start of the next match it goes back to the AI (SimCallback CPAIMemory).
do
local UIUtil = import('/lua/ui/uiutil.lua')
local LayoutHelpers = import('/lua/maui/layouthelpers.lua')
local Bitmap = import('/lua/maui/bitmap.lua').Bitmap

local KEY = '@KEY@'
local SHOW_PANEL = @PANEL@
local LEARN = @LEARN@
local MAX_LINES = 34
local Prefs = import('/lua/user/prefs.lua')
local memory = false      -- what earlier matches taught (loaded at the start)
local mapKey = 'default'
local learnedSaves = 0
local resultSaved = false
local memorySent = 0      -- how many times the memory went to the simulation (twice, to be sure)
local savedSeq = false    -- the last model of this match already kept in Game.prefs
local STALE = 60          -- seconds of game time without news before an AI leaves the panel

local C_PANEL = 'E80E161E'
local C_HEAD = 'FF15212C'
local C_TEXT = 'FFE6EEF5'
local C_FAINT = 'FF8A97A3'
local C_ACCENT = 'FF4FC3F7'
local C_WARN = 'FFF2B33D'

local panel = false
local mini = false
local dots = {}
local MINI = 180
local MAX_DOTS = 80
local AI_COLORS = { 'FFE5534B', 'FF7BD88F', 'FFC78BFF', 'FFF2B33D', 'FF5AA9E6', 'FFFF8FAB', 'FF9BE7FF', 'FFEEEEEE' }
local tab = false
local lines = {}
local status = false
local enabled = false
local dirty = false

local function Px(n)
    return n * LayoutHelpers.GetPixelScaleFactor()
end

local function MakeText(parent, text, size, color)
    local t = UIUtil.CreateText(parent, text, size, UIUtil.bodyFont)
    t:SetColor(color or C_TEXT)
    t:DisableHitTest()
    return t
end

local function SquadText(label, sq)
    if not sq or sq.n == 0 then return false end
    return label .. ' ' .. sq.n .. ' (forca ' .. sq.power .. ', ' .. sq.state .. ')'
end

local function Rows()
    local rows = {}
    if not status then
        table.insert(rows, { 'Esperando o plano das IAs...', C_FAINT })
        return rows
    end
    local learned = false
    for _, ai in status do learned = ai.learned break end
    if learned then
        table.insert(rows, { 'O que a IA aprendeu sobre voce', C_WARN })
        table.insert(rows, { '  Estilo: ' .. learned.style, C_TEXT })
        table.insert(rows, { '  Primeiro ataque: ' .. learned.firstAttack .. '   Ataques: ' .. learned.attacks .. '   Saques: ' .. learned.raids
            .. '   Partidas lembradas: ' .. learned.games, C_FAINT })
    end
    -- many AIs (big match): one line each
    local count = 0
    for _, _ in status do count = count + 1 end
    if count > 4 then
        local armies = {}
        for army, _ in status do table.insert(armies, army) end
        table.sort(armies)
        for _, army in ipairs(armies) do
            local ai = status[army]
            local n = ai.main and ai.main.n or 0
            local color = C_TEXT
            if ai.error then color = C_WARN end
            table.insert(rows, { ai.name .. '  -  ' .. ai.plan .. '   (exercito ' .. n .. ')' .. (ai.error and ('   erro: ' .. ai.error) or ''), color })
        end
        return rows
    end
    for army, ai in status do
        table.insert(rows, { ai.name .. '  -  ' .. ai.personality .. '  -  ' .. ai.adaptive, C_ACCENT })
        table.insert(rows, { '  Plano: ' .. ai.plan .. '   (ataca com ' .. ai.minUnits .. '+ unidades)', C_TEXT })
        local X = ai.alsyper
        if X then
            table.insert(rows, { '  Alsyper Adaptador - geracao ' .. X.generation .. '   estrategia: ' .. (X.strategy ~= '' and X.strategy or 'escolhendo'), C_WARN })
            table.insert(rows, { '    ' .. X.genes, C_FAINT })
            table.insert(rows, { '    ultima mudanca: ' .. (X.last ~= '' and X.last or 'nenhuma') .. '   (' .. X.seen .. ')', C_FAINT })
            if X.window then table.insert(rows, { '    hora certa de atacar: ' .. X.window, C_WARN }) end
        end
        if ai.error then table.insert(rows, { '  Erro: ' .. ai.error, C_WARN }) end
        local parts = {}
        for _, p in { SquadText('Exercito', ai.main), SquadText('Guarda', ai.guard), SquadText('Rapidos', ai.raid), SquadText('Frota', ai.fleet), SquadText('Desembarque', ai.drop) } do
            if p then table.insert(parts, p) end
        end
        if table.getn(parts) > 0 then table.insert(rows, { '  ' .. table.concat(parts, '   '), C_TEXT }) end
        local air = {}
        for _, p in { SquadText('Cacas', ai.fighters), SquadText('Bombardeiros', ai.bombers), SquadText('Gunships', ai.gunships) } do
            if p then table.insert(air, p) end
        end
        if table.getn(air) > 0 then table.insert(rows, { '  ' .. table.concat(air, '   '), C_TEXT }) end
        table.insert(rows, { '  Comandante: ' .. ai.acu .. '   Ve no inimigo: aviacao ' .. ai.intel.air .. ', terra ' .. ai.intel.land .. ', mar ' .. ai.intel.naval
            .. '   Zonas de perigo: ' .. (ai.dangers or 0), C_FAINT })
        if ai.districts and ai.districts.total > 0 then
            table.insert(rows, { '  Bairros: ' .. ai.districts.done .. '/' .. ai.districts.total .. ' prontos'
                .. (ai.districts.current ~= '' and ('   construindo ' .. ai.districts.current) or ''), C_FAINT })
        end
        local T = ai.tally
        if T then
            table.insert(rows, { '  Placar: ataques ' .. T.attacks .. ' (vencidos ' .. T.won .. ')   recuos ' .. T.retreats .. '   defesas ' .. T.defended
                .. '   cercos ' .. T.siege .. '   duas frentes ' .. T.fronts .. '   ajudas ' .. T.helped
                .. '   bairros ' .. T.districts .. ' (perdidos ' .. T.lost .. ')', C_FAINT })
        end
        if ai.journal and table.getn(ai.journal) > 0 then
            table.insert(rows, { '  Diario:', C_FAINT })
            for i = 1, math.min(4, table.getn(ai.journal)) do
                table.insert(rows, { '    ' .. ai.journal[i], C_FAINT })
            end
        end
    end
    return rows
end

-- the dots of the small map (positions arrive as 0..1 of the map)
local function DrawMini()
    if not mini then return end
    local used = 0
    local function dot(p, size, color)
        if not p or used >= MAX_DOTS then return end
        used = used + 1
        local d = dots[used]
        d:SetSolidColor(color)
        d.Width:Set(Px(size))
        d.Height:Set(Px(size))
        LayoutHelpers.AtLeftTopIn(d, mini, p[1] * (MINI - 8) + 4 - size / 2, p[2] * (MINI - 8) + 4 - size / 2)
        d:Show()
    end
    local armies = {}
    for army, _ in (status or {}) do table.insert(armies, army) end
    table.sort(armies)
    for k, army in ipairs(armies) do
        local m = status[army].mini
        if m then
            local color = AI_COLORS[math.mod(k - 1, 8) + 1]
            for _, d in (m.districts or {}) do
                dot({ d[1], d[2] }, d[4] and 7 or 5, d[4] and color or '88' .. string.sub(color, 3))
            end
            dot(m.home, 10, color)
            dot(m.target, 8, 'FFFF2840')
            dot(m.second, 8, 'FFFF2840')
            dot(m.predicted, 11, 'FFFFD166')
            dot(m.join, 8, 'FF4FC3F7')
            local tip = status[army].tip
            if tip and tip.at then dot(tip.at, 9, 'FFFF9F1C') end
        end
    end
    for i = used + 1, MAX_DOTS do dots[i]:Hide() end
    CPAIPanelMiniDots = used -- for the tests
end

local function Refresh()
    if not panel or panel:IsHidden() then return end
    local rows = Rows()
    local n = math.min(table.getn(rows), MAX_LINES)
    for i = 1, MAX_LINES do
        local t = lines[i]
        if i <= n then
            t:SetText(rows[i][1])
            t:SetColor(rows[i][2])
            t:Show()
        else
            t:Hide()
        end
    end
    panel.Height:Set(Px(math.max(48 + n * 17 + 12, 48 + MINI + 26)))
    pcall(DrawMini)
    dirty = false
end

local function CreatePanel()
    local frame = GetFrame(0)
    panel = Bitmap(frame)
    panel:SetSolidColor(C_PANEL)
    panel.Depth:Set(frame:GetTopmostDepth() + 95)
    panel.Width:Set(Px(760))
    panel.Height:Set(Px(120))
    LayoutHelpers.AtLeftTopIn(panel, frame, 44, 90)
    panel:DisableHitTest()

    local head = Bitmap(panel)
    head:SetSolidColor(C_HEAD)
    head.Width:Set(panel.Width)
    head.Height:Set(Px(40))
    LayoutHelpers.AtLeftTopIn(head, panel, 0, 0)
    head:DisableHitTest()
    local bar = Bitmap(panel)
    bar:SetSolidColor(C_ACCENT)
    bar.Width:Set(Px(4))
    bar.Height:Set(head.Height)
    LayoutHelpers.AtLeftTopIn(bar, panel, 0, 0)
    bar:DisableHitTest()
    local title = MakeText(head, 'CommandProject - O que a IA esta pensando', 15, C_ACCENT)
    LayoutHelpers.AtLeftTopIn(title, head, 14, 5)
    local hint = MakeText(head, KEY .. ' mostra e esconde', 11, C_FAINT)
    LayoutHelpers.AtLeftTopIn(hint, head, 14, 23)
    if LEARN then
        local forget = Bitmap(panel)
        forget:SetSolidColor('FF23384B')
        forget.Width:Set(Px(150))
        forget.Height:Set(Px(24))
        LayoutHelpers.AtRightTopIn(forget, panel, 10, 8)
        forget.Depth:Set(function() return head.Depth() + 2 end)
        local label = MakeText(forget, 'Esquecer o que aprendeu', 11, C_TEXT)
        LayoutHelpers.AtCenterIn(label, forget)
        forget.HandleEvent = function(self, event)
            if event.Type == 'ButtonPress' then
                CPAIForget()
                return true
            end
            return false
        end
    end

    -- the small map: each AI's home and districts, where its army attacks and where it expects you
    mini = Bitmap(panel)
    mini:SetSolidColor('FF0A1118')
    mini.Width:Set(Px(MINI))
    mini.Height:Set(Px(MINI))
    LayoutHelpers.AtRightTopIn(mini, panel, 10, 48)
    mini:DisableHitTest()
    for i = 1, MAX_DOTS do
        local d = Bitmap(mini)
        d:DisableHitTest()
        d:Hide()
        dots[i] = d
    end
    local legend = MakeText(panel, 'casa  bairros  ataque  espera voce', 10, C_FAINT)
    LayoutHelpers.AtRightTopIn(legend, panel, 14, 52 + MINI)

    for i = 1, MAX_LINES do
        local t = MakeText(panel, '', 12, C_TEXT)
        LayoutHelpers.AtLeftTopIn(t, panel, 14, 48 + (i - 1) * 17)
        t:Hide()
        lines[i] = t
    end
    panel:Hide()
end

function CPAIPanelToggle()
    if not enabled then return end
    if not panel then
        local ok, err = pcall(CreatePanel)
        if not ok then
            panel = false
            pcall(function()
                import('/lua/ui/game/textdisplay.lua').PrintToScreen({ text = 'CommandProject: erro no painel da IA: ' .. tostring(err),
                    size = 14, color = 'ffff6060', duration = 8, location = 'centertop' })
            end)
            return
        end
    end
    if panel:IsHidden() then
        panel:Show()
        Refresh()
    else
        panel:Hide()
    end
end

local function CreateTab()
    local frame = GetFrame(0)
    tab = Bitmap(frame)
    tab:SetSolidColor(C_HEAD)
    tab.Depth:Set(frame:GetTopmostDepth() + 90)
    tab.Width:Set(Px(30))
    tab.Height:Set(Px(30))
    LayoutHelpers.AtLeftIn(tab, frame, 0)
    LayoutHelpers.AtVerticalCenterIn(tab, frame, 40)
    local label = MakeText(tab, 'IA', 13, C_ACCENT)
    LayoutHelpers.AtCenterIn(label, tab)
    tab.HandleEvent = function(self, event)
        if event.Type == 'MouseEnter' then
            self:SetSolidColor('FF23384B')
            return true
        elseif event.Type == 'MouseExit' then
            self:SetSolidColor(C_HEAD)
            return true
        elseif event.Type == 'ButtonPress' then
            pcall(function() PlaySound(Sound({ Bank = 'Interface', Cue = 'UI_Menu_MouseDown' })) end)
            CPAIPanelToggle()
            return true
        end
        return false
    end
end

-- ---------------------------------------------------------------- memory between matches
local function Blend(old, new, keep)
    local out = {}
    if type(old) == 'table' then
        for k, v in old do if type(v) == 'number' then out[k] = v * keep end end
    end
    if type(new) == 'table' then
        for k, v in new do if type(v) == 'number' then out[k] = (out[k] or 0) + v * (1 - keep) end end
    end
    return out
end

local function TopCells(map, n)
    local list = {}
    for k, w in map do table.insert(list, { k = k, w = w }) end
    table.sort(list, function(a, b) return a.w > b.w end)
    local out = {}
    for i = 1, math.min(n, table.getn(list)) do out[list[i].k] = math.floor(list[i].w * 100 + 0.5) / 100 end
    return out
end

local function LoadMemory()
    local m = false
    pcall(function() m = Prefs.GetFromCurrentProfile('CPAIMemory') end)
    if type(m) ~= 'table' then m = { games = 0, style = {}, maps = {} } end
    m.maps = type(m.maps) == 'table' and m.maps or {}
    m.games = type(m.games) == 'number' and m.games or 0
    return m
end

local function MapKey()
    local key = 'default'
    pcall(function()
        local info = SessionGetScenarioInfo()
        key = info.file or info.name or key
    end)
    return string.lower(tostring(key))
end

-- sends what earlier matches taught to the AI commanders
local function SendMemory()
    if not memory or memory.games <= 0 then return end
    local map = memory.maps[mapKey] or {}
    pcall(function()
        SimCallback({ Func = 'CPAIMemory', Args = {
            games = memory.games, style = memory.style, firstAttack = memory.firstAttack,
            route = map.route, hit = map.hit, expand = map.expand, held = map.held, lost = map.lost,
            genes = map.genes or memory.genes, results = memory.results,
        } })
    end)
end

-- the model of this match, blended with the memory of the earlier ones, goes to Game.prefs
local function SaveMemory(current)
    if not memory or type(current) ~= 'table' then return end
    local games = memory.games + 1
    local keep = 1 - math.max(0.25, 1 / games)
    local saved = {
        games = games,
        style = Blend(memory.style, current.style, keep),
        maps = memory.maps,
        -- the Alsyper genes evolve across matches (this match counts a little more each time)
        genes = Blend(memory.genes, current.genes, 0.6),
        results = memory.results,
    }
    if type(current.firstAttack) == 'number' then
        if type(memory.firstAttack) == 'number' then
            saved.firstAttack = math.floor(memory.firstAttack * keep + current.firstAttack * (1 - keep))
        else
            saved.firstAttack = current.firstAttack
        end
    else
        saved.firstAttack = memory.firstAttack
    end
    local old = memory.maps[mapKey] or {}
    local mapGames = (type(old.games) == 'number' and old.games or 0) + 1
    local maps = {}
    for k, v in memory.maps do maps[k] = v end
    maps[mapKey] = {
        games = mapGames,
        route = TopCells(Blend(old.route, current.route, 0.5), 16),
        hit = TopCells(Blend(old.hit, current.hit, 0.5), 16),
        expand = TopCells(Blend(old.expand, current.expand, 0.5), 16),
        -- the districts of the AI that held and the ones that fell on this map
        held = TopCells(Blend(old.held, current.held, 0.6), 16),
        lost = TopCells(Blend(old.lost, current.lost, 0.6), 16),
        genes = Blend(old.genes, current.genes, 0.5),
    }
    saved.maps = maps
    pcall(function() Prefs.SetToCurrentProfile('CPAIMemory', saved) end)
    learnedSaves = learnedSaves + 1
    if math.mod(learnedSaves, 4) == 1 then pcall(SavePreferences) end
end

function CPAIForget()
    pcall(function() Prefs.SetToCurrentProfile('CPAIMemory', nil) end)
    pcall(SavePreferences)
    memory = { games = 0, style = {}, maps = {} }
    -- the AIs of this match forget too, otherwise the next save would bring everything back
    pcall(function() SimCallback({ Func = 'CPAIForget', Args = {} }) end)
    pcall(function()
        import('/lua/ui/game/textdisplay.lua').PrintToScreen({ text = 'CommandProject: a IA esqueceu o que tinha aprendido sobre voce',
            size = 14, color = 'ff4fc3f7', duration = 6, location = 'centertop' })
    end)
end

local function BindKey()
    pcall(function()
        IN_AddKeyMapTable({
            [KEY] = { action = 'UI_Lua import("/lua/ui/game/consoleecho.lua").CPAIPanelToggle()', category = 'ui', order = 98 },
        })
    end)
end

local function GameTime()
    local ok, t = pcall(GetGameTimeSeconds)
    if ok and type(t) == 'number' then return t end
    return 0
end

-- what the AIs say (chat) and the training tips go to the top of the screen, once each
local spoken, tipped = {}, {}
function CPAIAnnounce()
    for army, ai in status do
        local said = ai.said
        if said and said.n ~= spoken[army] then
            spoken[army] = said.n
            pcall(function()
                import('/lua/ui/game/textdisplay.lua').PrintToScreen({ text = ai.name .. ': ' .. said.text, size = 15, color = 'ffffd166', duration = 4, location = 'centertop' })
            end)
            UI_LastSaid = said.text
        end
        local tip = ai.tip
        local key = tip and (math.floor(tip.pos[1] / 60) .. ':' .. math.floor(tip.pos[3] / 60)) or false
        if key and key ~= tipped[army] then
            tipped[army] = key
            local text = 'Dica: ' .. ai.name .. ' vai atacar perto do ponto laranja do mapinha (F4) em uns ' .. tip.eta .. ' s com ' .. tip.n .. ' unidades'
            pcall(function()
                import('/lua/ui/game/textdisplay.lua').PrintToScreen({ text = text, size = 14, color = 'ffff9f1c', duration = 6, location = 'centertop' })
            end)
            UI_LastTip = text
        elseif not key then
            tipped[army] = false
        end
    end
end

-- every frame: read what the simulation sent on the last beat. (On PC the game never calls the
-- beat functions of gamemain.lua, so this runs in its own thread; the simulation repeats its data
-- on every tick, so no beat is missed.)
local lastSweep = 0
local function Poll()
    local now = GameTime()
    -- the memory goes to the simulation once it is running, not while the screen is built
    if LEARN and ((memorySent == 0 and now > 2) or (memorySent == 1 and now > 20)) then
        memorySent = memorySent + 1
        SendMemory()
    end
    local s = false
    pcall(function() s = Sync.CPAIStatus end)
    if s and SHOW_PANEL then
        status = status or {}
        for army, entry in s do
            local old = status[army]
            if not old or old.time ~= entry.time or old.plan ~= entry.plan then dirty = true end
            status[army] = entry
        end
        if not tab then pcall(CreateTab) end
    end
    if status and now - lastSweep > 10 then
        lastSweep = now
        local newest = 0
        for _, entry in status do newest = math.max(newest, entry.time or 0) end
        for army, entry in status do
            if not entry.stopped and newest - (entry.time or 0) > STALE then
                status[army] = nil
                dirty = true
            end
        end
    end
    if LEARN and memory and not resultSaved then
        local r = false
        pcall(function() r = Sync.CPAIResult end)
        if r and type(r.result) == 'number' then
            resultSaved = true
            local list = type(memory.results) == 'table' and memory.results or {}
            table.insert(list, r.result)
            while table.getn(list) > 5 do table.remove(list, 1) end
            memory.results = list
            -- on top of what was last saved this match (not the memory loaded at the start)
            local cur = false
            pcall(function() cur = Prefs.GetFromCurrentProfile('CPAIMemory') end)
            if type(cur) ~= 'table' then cur = memory end
            cur.results = list
            if type(r.genes) == 'table' then cur.genes = Blend(cur.genes, r.genes, 0.6) end
            pcall(function() Prefs.SetToCurrentProfile('CPAIMemory', cur) end)
            pcall(SavePreferences)
        end
    end
    if LEARN then
        local m = false
        pcall(function() m = Sync.CPAIModel end)
        if m and m.seq ~= savedSeq then
            savedSeq = m.seq
            pcall(SaveMemory, m)
        end
    end
    if status then pcall(CPAIAnnounce) end
    if dirty then pcall(Refresh) end
end
CPAIPanelPoll = Poll -- for the tests

local function HumanCount()
    local n = 0
    local ok, info = pcall(GetArmiesTable)
    if ok and info and info.armiesTable then
        for _, army in info.armiesTable do
            if army.human then n = n + 1 end
        end
    end
    return n
end

function CPAIPanelInit()
    if enabled then return end
    local replay = false
    pcall(function() replay = SessionIsReplay() end)
    if replay or HumanCount() > 1 then return end
    enabled = true
    if LEARN then
        memory = LoadMemory()
        mapKey = MapKey()
    end
    if SHOW_PANEL then
        BindKey()
        -- other screens (the key map editor, mods) can replace the key table: bind it again now
        -- and then
        ForkThread(function()
            WaitSeconds(3)
            BindKey()
            while true do
                WaitSeconds(30)
                BindKey()
            end
        end)
    end
    ForkThread(function()
        while true do
            pcall(Poll)
            WaitFrames(1)
        end
    end)
end
end
