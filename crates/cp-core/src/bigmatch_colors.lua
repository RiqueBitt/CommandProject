
-- CommandProject big match: 14 more army colors (24 in all). The engine reads this file in a bare
-- Lua state of its own (no pcall, no table library, no game functions), so this block only uses
-- plain statements: a function call here would stop the file from loading and the game from
-- creating the armies. The game's own lobby still offers its 10 colors; the launcher's big match
-- uses the rest.
do
    local flag = '/textures/ui/common/360/hd/skirmish/teamcolors/tc'
    local extra = {
        -- primary, icon, secondary, flag
        { 'FF7a1f4d', 'FFff5fb0', 'FFd9d9d9', '04' }, -- pink
        { 'FF3d5a0f', 'FF9dff1f', 'FF2b3b76', '07' }, -- lime
        { 'FF0f4a4a', 'FF1fe0d0', 'FFce9d07', '08' }, -- teal
        { 'FF0a1640', 'FF4060ff', 'FFa0a0a0', '01' }, -- navy
        { 'FF4a0f1a', 'FFc0304a', 'FFa3a299', '03' }, -- crimson
        { 'FFb0b0b0', 'FFffffff', 'FF2b3b76', '06' }, -- white
        { 'FF6a5410', 'FFffc840', 'FF2b3b76', '09' }, -- gold
        { 'FF1f4a6a', 'FF6fd0ff', 'FF8d0101', '08' }, -- sky
        { 'FF5a0f5a', 'FFff40ff', 'FFc1b278', '04' }, -- magenta
        { 'FF1f5a3d', 'FF60ffb0', 'FF5a10a0', '02' }, -- mint
        { 'FF3a2410', 'FFb07040', 'FFa0a0a0', '10' }, -- brown
        { 'FF6a2a1f', 'FFff7f60', 'FF2b3b76', '03' }, -- coral
        { 'FF3d3060', 'FFb8a0ff', 'FFce9d07', '04' }, -- lavender
        { 'FF0a0a0a', 'FF505050', 'FFff8000', '06' }, -- black
    }
    if GameColors and GameColors.FactionColors and not GameColors.CPExtra then
        GameColors.CPExtra = true
        local i = 1
        while extra[i] do
            local c = extra[i]
            local f = 1
            while GameColors.FactionColors[f] do
                local list = GameColors.FactionColors[f]
                local n = 0
                while list[n + 1] do n = n + 1 end
                list[n + 1] = { primary = c[1], icon = c[2], secondary = c[3], ui_flag = flag .. c[4] .. '.dds' }
                f = f + 1
            end
            local lists = { GameColors.PlayerColors, GameColors.ArmyColors }
            local k = 1
            while k <= 2 do
                local list = lists[k]
                if list then
                    local n = 0
                    while list[n + 1] do n = n + 1 end
                    list[n + 1] = c[1]
                end
                k = k + 1
            end
            if GameColors.SecondaryPlayerColors then
                local list = GameColors.SecondaryPlayerColors
                local n = 0
                while list[n + 1] do n = n + 1 end
                list[n + 1] = c[3]
            end
            i = i + 1
        end
    end
end
