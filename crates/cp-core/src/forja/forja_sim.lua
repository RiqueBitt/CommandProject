-- Forja on the simulation side: commands from the interface, messages to it, game start and the
-- unit events (the hooks live in the game's Unit.lua and call Forja.Emit).
local Sim = {}
Forja.Sim = Sim
local commands = {}

-- Forja.Sim.OnCommand('mymod:do', function(data, units) end): what the interface sends with
-- Forja.UI.SendToSim('mymod:do', data). The name is the whole contract, so put the mod id in it.
function Sim.OnCommand(name, fn)
    if type(name) ~= 'string' or type(fn) ~= 'function' then
        error('Forja.Sim.OnCommand(name, function): wrong arguments', 2)
    end
    commands[name] = { fn = fn, owner = Forja._current }
end

-- SimCallback 'Forja' (SimCallbacks.lua) lands here
function Forja._Command(data, units)
    if type(data) ~= 'table' or type(data.name) ~= 'string' then return end
    local c = commands[data.name]
    if not c then return end
    Forja._Call(c.owner, c.fn, data.data, units)
end

-- a message to the interface of every player (Forja.UI.OnSim(name, fn) receives it). Data travels
-- as a plain table: numbers, strings, booleans and tables of them.
function Sim.SendToUI(name, data)
    if not Sync.Forja then Sync.Forja = {} end
    table.insert(Sync.Forja, { name = name, data = data })
end

-- the army that sent the command being handled (nil when the game does not tell)
function Sim.CommandSource()
    local ok, v = pcall(GetCurrentCommandSource)
    if ok then return v end
    return nil
end

function Sim.Brains()
    return ArmyBrains or {}
end

function Sim.HumanCount()
    local n = 0
    for _, brain in pairs(ArmyBrains or {}) do
        if brain.BrainType == 'Human' then n = n + 1 end
    end
    return n
end

function Sim.IsSinglePlayer()
    return Sim.HumanCount() <= 1
end

-- errors of the simulation also show up in the interface (Forja panel)
Forja._OnError = function(e)
    Sim.SendToUI('forja:error', e)
end

-- BeginSession (simInit.lua) calls this in a thread: handlers may wait
function Forja._SessionStart()
    Forja.Emit('SessionStart')
end
