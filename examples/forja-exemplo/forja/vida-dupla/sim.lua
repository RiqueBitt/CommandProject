-- Roda na simulação (a mesma em todos os jogadores).
local util = mod.Require('lib/util')

Forja.On('SessionStart', function()
    mod.Log('partida começou com ' .. Forja.Sim.HumanCount() .. ' jogador(es)')
end)

Forja.On('UnitKilled', function(unit, instigator)
    if instigator and instigator.GetArmy then
        Forja.Sim.SendToUI('vida-dupla:kill', { army = instigator:GetArmy() })
    end
end)

-- a interface manda este comando com Forja.UI.SendToSim('vida-dupla:hello', dados)
Forja.Sim.OnCommand('vida-dupla:hello', function(data, units)
    mod.Log(util.Describe(data))
end)
