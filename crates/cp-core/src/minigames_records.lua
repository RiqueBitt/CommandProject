
-- CommandProject minigames: the result of each minigame (sent by /lua/sim/CPMinigames.lua) goes
-- to the game profile, as CPRecords = { <mode>_played, <mode>_wins, <mode>_fast (seconds of the
-- fastest win), <mode>_best (most waves held / highest score) }. The launcher shows them.
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
        local best = tonumber(r.waves) or 0
        if m ~= 'defense' then best = tonumber(r.score) or 0 end
        if best > (tonumber(all[m .. '_best']) or 0) then all[m .. '_best'] = best end
        Prefs.SetToCurrentProfile('CPRecords', all)
        if SavePreferences then SavePreferences() end
    end)
    if not ok then WARN('*CommandProject minigame record: ' .. tostring(err)) end
end
