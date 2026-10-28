
-- CommandProject minigames (user side): the result of each minigame (sent by
-- /lua/sim/CPMinigames.lua) goes to the game profile, as
--   CPRecords = { <mode>_played, <mode>_wins, <mode>_fast (seconds of the fastest win),
--                 <mode>_best (most waves held / highest score), seq }
--   CPHistory = { the last 40 matches: seq, mode, won, seconds, waves, score, map, mut, week, ... }
-- The launcher shows them (records, history, achievements, weekly challenge).
function CPMinigameRecord(r)
    local ok, err = pcall(function()
        if type(r) ~= 'table' or not r.mode or r.mode == '' then return end
        local Prefs = import('/lua/user/prefs.lua')
        local all = Prefs.GetFromCurrentProfile('CPRecords')
        if type(all) ~= 'table' then all = {} end
        local m = tostring(r.mode)
        all[m .. '_played'] = (tonumber(all[m .. '_played']) or 0) + 1
        if r.won then
            all[m .. '_wins'] = (tonumber(all[m .. '_wins']) or 0) + 1
            local secs = tonumber(r.seconds) or 0
            local fast = tonumber(all[m .. '_fast'])
            if secs > 0 and (not fast or secs < fast) then all[m .. '_fast'] = secs end
        end
        local best = tonumber(r.score) or 0
        if m == 'defense' or m == 'survival' then best = tonumber(r.waves) or 0 end
        if best > (tonumber(all[m .. '_best']) or 0) then all[m .. '_best'] = best end
        all.seq = (tonumber(all.seq) or 0) + 1
        Prefs.SetToCurrentProfile('CPRecords', all)

        local history = Prefs.GetFromCurrentProfile('CPHistory')
        if type(history) ~= 'table' then history = {} end
        table.insert(history, {
            seq = all.seq, mode = m, won = r.won and true or false, seconds = tonumber(r.seconds) or 0,
            waves = tonumber(r.waves) or 0, score = tonumber(r.score) or 0, map = tostring(r.map or ''),
            mut = tostring(r.mut or ''), week = tonumber(r.week) or 0, events = r.events and true or false,
            players = tonumber(r.players) or 0,
        })
        while table.getn(history) > 40 do table.remove(history, 1) end
        Prefs.SetToCurrentProfile('CPHistory', history)
        if SavePreferences then SavePreferences() end
    end)
    if not ok then WARN('*CommandProject minigame record: ' .. tostring(err)) end
end

-- the fixed scoreboard of the minigames, at the top right of the map
local CPBoardUI = false

local function CPBoardDraw(data)
    local UIUtil = import('/lua/ui/uiutil.lua')
    local LayoutHelpers = import('/lua/maui/layouthelpers.lua')
    local Bitmap = import('/lua/maui/bitmap.lua').Bitmap
    local parent = import('/lua/ui/game/borders.lua').GetMapGroup()
    if not CPBoardUI then
        local bg = Bitmap(parent)
        bg:SetSolidColor('B40E161E')
        bg:DisableHitTest()
        bg.Depth:Set(GetFrame(0):GetTopmostDepth() + 1)
        LayoutHelpers.AtRightTopIn(bg, parent, 12, 90)
        bg.Width:Set(330)
        bg.Height:Set(30)
        bg.texts = {}
        CPBoardUI = bg
    end
    local bg = CPBoardUI
    local lines = { { tostring(data.title or ''), 'fff2b33d' } }
    for _, l in data.lines or {} do
        table.insert(lines, l)
    end
    for i, l in lines do
        local text = bg.texts[i]
        if not text then
            text = UIUtil.CreateText(bg, '', i == 1 and 16 or 14, UIUtil.bodyFont)
            text:DisableHitTest()
            text:SetDropShadow(true)
            LayoutHelpers.AtLeftTopIn(text, bg, 10, 6 + (i - 1) * 19)
            text.Depth:Set(bg.Depth() + 1)
            bg.texts[i] = text
        end
        text:SetText(tostring(l[1] or ''))
        text:SetColor(l[2] or 'ffe6eef5')
        text:Show()
    end
    for i = table.getn(lines) + 1, table.getn(bg.texts) do
        bg.texts[i]:Hide()
    end
    bg.Height:Set(12 + table.getn(lines) * 19)
    bg:Show()
end

function CPMinigameBoard(data)
    if type(data) ~= 'table' then return end
    local ok = pcall(CPBoardDraw, data)
    if not ok then
        -- the map group of an earlier match: start over once
        CPBoardUI = false
        local ok2, err = pcall(CPBoardDraw, data)
        if not ok2 then WARN('*CommandProject minigame board: ' .. tostring(err)) end
    end
end

function CPMinigameSounds(list)
    for _, cue in list or {} do
        pcall(function() PlaySound(Sound({ Bank = 'Interface', Cue = cue })) end)
    end
end
