
-- CommandProject big match: 14 more army colors (24 in all), only in matches started by the
-- launcher with /cpmatch (the game's own lobby has 10 color slots and stays as it is). Same layout
-- as the game's colors; the flags reuse the game's team color pictures.
do
    local ok, big = pcall(function() return HasCommandLineArg('/cpmatch') and not HasCommandLineArg('/cpnocolors') end)
    if ok and big and GameColors and GameColors.FactionColors and not GameColors.CPExtra then
        GameColors.CPExtra = true
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
        for _, list in GameColors.FactionColors do
            for _, c in extra do
                table.insert(list, { primary = c[1], icon = c[2], secondary = c[3], ui_flag = flag .. c[4] .. '.dds' })
            end
        end
        for _, c in extra do
            if GameColors.PlayerColors then table.insert(GameColors.PlayerColors, c[1]) end
            if GameColors.SecondaryPlayerColors then table.insert(GameColors.SecondaryPlayerColors, c[3]) end
            if GameColors.ArmyColors then table.insert(GameColors.ArmyColors, c[1]) end
        end
    end
end
