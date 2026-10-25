
-- CommandProject big match: 22 more army colors (32 in all). The engine reads this file in a bare
-- Lua state of its own (no pcall, no table library, no game functions), so this block only uses
-- plain statements: a function call here would stop the file from loading and the game from
-- creating the armies. The game's own lobby still offers its 10 colors; the launcher's big match
-- uses the rest.
do
    local flag = '/textures/ui/common/360/hd/skirmish/teamcolors/tc'
    local extra = {
        -- primary (paint), icon (minimap and strategic icons), secondary, flag; primaries far
        -- apart from the game's 10 so two teams never look alike
        { 'FF9a2a6a', 'FFff5fb0', 'FFd9d9d9', '04' }, -- pink
        { 'FF5a8a10', 'FFb0ff30', 'FF2b3b76', '07' }, -- lime
        { 'FF0a6a66', 'FF20f0e0', 'FFce9d07', '08' }, -- turquoise
        { 'FF2a1a7a', 'FF7060ff', 'FFa0a0a0', '01' }, -- indigo
        { 'FF6a0a3a', 'FFd0306a', 'FFa3a299', '03' }, -- wine
        { 'FFd8d8d8', 'FFffffff', 'FF2b3b76', '06' }, -- white
        { 'FF8a6a00', 'FFffd030', 'FF2b3b76', '09' }, -- gold
        { 'FF2a6a9a', 'FF70d0ff', 'FF8d0101', '08' }, -- sky
        { 'FF7a1a7a', 'FFff40ff', 'FFc1b278', '04' }, -- magenta
        { 'FF2a8a5a', 'FF60ffb0', 'FF5a10a0', '02' }, -- mint
        { 'FF5a3a1a', 'FFc08040', 'FFa0a0a0', '10' }, -- brown
        { 'FF9a3a2a', 'FFff8060', 'FF2b3b76', '03' }, -- coral
        { 'FF6a5a9a', 'FFc0b0ff', 'FFce9d07', '04' }, -- lavender
        { 'FF0c0c0c', 'FF404040', 'FFff8000', '06' }, -- black
        { 'FF0c1e5a', 'FF3a5ad8', 'FFd9d9d9', '01' }, -- navy
        { 'FF0e3a14', 'FF2e9e46', 'FFce9d07', '02' }, -- forest
        { 'FF9a6a4a', 'FFffc8a0', 'FF2b3b76', '05' }, -- peach
        { 'FF5a2408', 'FFc0581c', 'FFa0a0a0', '10' }, -- rust
        { 'FF3a1440', 'FF9a4ab0', 'FFc1b278', '04' }, -- plum
        { 'FF6a5a10', 'FFc8b040', 'FF2b3b76', '09' }, -- mustard
        { 'FF0a3038', 'FF2a8a9a', 'FFce9d07', '08' }, -- petrol
        { 'FF9a5a72', 'FFffb0d0', 'FF2b3b76', '04' }, -- light pink
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
