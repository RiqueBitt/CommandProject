-- CommandProject Forja: unit events (appended to the game's Unit.lua by the launcher). Every unit
-- type of the game inherits from Unit, so wrapping its methods here reaches all of them. Nothing
-- runs when no mod listens to an event.
do
    local function Wrap(method, event, before)
        local base = Unit[method]
        if type(base) ~= 'function' then return end
        Unit[method] = function(self, a, b, c, d)
            local F = _G.Forja
            if before and F and F.HasListeners(event) then F.Emit(event, self, a, b, c, d) end
            local r = base(self, a, b, c, d)
            if not before and F and F.HasListeners(event) then F.Emit(event, self, a, b, c, d) end
            return r
        end
    end
    -- unit, createArgs
    Wrap('OnCreate', 'UnitCreated', false)
    -- unit, builder, layer
    Wrap('OnStopBeingBuilt', 'UnitBuilt', false)
    -- unit, instigator, type, overkillRatio (before the game removes the unit)
    Wrap('OnKilled', 'UnitKilled', true)
    -- unit
    Wrap('OnDestroy', 'UnitDestroyed', true)
    -- unit, instigator, amount, vector, damageType
    Wrap('OnDamage', 'UnitDamaged', false)
    -- unit, captor
    Wrap('OnCaptured', 'UnitCaptured', true)
    -- unit, unitBeingBuilt, order
    Wrap('OnStartBuild', 'UnitStartBuild', false)
end
