-- Roda enquanto o jogo carrega os blueprints (antes de qualquer partida).
-- `mod` é este mod (mod.Id, mod.Option, mod.Log...) e `Forja` é a API do carregador.
local mult = mod.Option('multiplier', 1.5)

Forja.BP.EachUnit('LAND', function(bp, id)
    Forja.BP.Scale(bp, 'Defense.MaxHealth', mult)
end)
mod.Log('vida das unidades terrestres x' .. mult)
