-- Roda na interface do jogador (só no computador dele).
local kills = 0
local panel = Forja.UI.Panel({ title = mod.Name, subtitle = 'F7 abre e fecha' })
panel:Button('Abates', nil, function() return tostring(kills), Forja.UI.Colors.Ok end)
panel:Button('Dizer oi para a simulação', function()
    Forja.UI.SendToSim('vida-dupla:hello', { text = 'oi' })
end)

Forja.UI.OnSim('vida-dupla:kill', function(data)
    if data.army == GetFocusArmy() then
        kills = kills + 1
        panel:Refresh()
    end
end)

Forja.UI.AddKey('F7', mod.Name, function() panel:Toggle() end)
Forja.UI.AddMenuItem(mod.Name, function() panel:Toggle() end)
Forja.On('UIReady', function()
    Forja.UI.Notify(mod.Name .. ' carregado (F7)')
end)
