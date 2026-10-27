-- Forja core: the part of the loader that is the same on every side (simulation, interface and
-- blueprints). It keeps the list of mods, runs their code, delivers events and lets mods talk to
-- each other. Written for the game's Lua (5.0): no '#', no '%', no 'string:method()', no varargs.
-- @SIDE@ and @VERSION@ are filled in by the launcher.
local Forja = {
    Version = '@VERSION@',
    Side = '@SIDE@',
    -- returned by an event handler, stops the event from reaching the handlers after it
    Stop = {},
    _mods = {},
    _order = {},
    _handlers = {},
    _exports = {},
    _errors = {},
    _current = false,
}
_G.Forja = Forja

local function Text(v)
    if type(v) == 'string' then return v end
    return tostring(v)
end

function Forja.Log(text)
    LOG('[Forja] ' .. Text(text))
end

function Forja.Warn(text)
    WARN('[Forja] ' .. Text(text))
end

-- an error of a mod: written to the log and kept (the interface lists them in the Forja panel)
function Forja._Error(owner, text)
    local who = owner or '?'
    WARN('[Forja:' .. Text(who) .. '] ' .. Text(text))
    if table.getn(Forja._errors) < 50 then
        table.insert(Forja._errors, { mod = who, side = Forja.Side, text = Text(text) })
    end
    if Forja._OnError then
        pcall(Forja._OnError, { mod = who, side = Forja.Side, text = Text(text) })
    end
end

-- calls fn as if it were code of the mod `owner` (errors go to that mod)
function Forja._Call(owner, fn, a, b, c, d, e, f)
    local prev = Forja._current
    Forja._current = owner
    local ok, r = pcall(fn, a, b, c, d, e, f)
    Forja._current = prev
    if not ok then
        Forja._Error(owner, r)
        return false, nil
    end
    return true, r
end

---------------------------------------------------------------------------- events

-- Forja.On(event, function(a, b, ...) end, priority): handlers with a higher priority run first;
-- returns a handle for Forja.Off
function Forja.On(name, fn, priority)
    if type(name) ~= 'string' or type(fn) ~= 'function' then
        error('Forja.On(event, function): wrong arguments', 2)
    end
    local list = Forja._handlers[name]
    if not list then
        list = {}
        Forja._handlers[name] = list
    end
    local h = { name = name, fn = fn, priority = priority or 0, owner = Forja._current, errors = 0 }
    local pos = table.getn(list) + 1
    for i = 1, table.getn(list) do
        if list[i].priority < h.priority then
            pos = i
            break
        end
    end
    table.insert(list, pos, h)
    return h
end

function Forja.Off(h)
    if type(h) ~= 'table' or not h.name then return end
    h.removed = true
    local list = Forja._handlers[h.name]
    if not list then return end
    for i = table.getn(list), 1, -1 do
        if list[i] == h then table.remove(list, i) end
    end
end

-- only the first time
function Forja.Once(name, fn, priority)
    local h
    h = Forja.On(name, function(a, b, c, d, e, f)
        Forja.Off(h)
        return fn(a, b, c, d, e, f)
    end, priority)
    return h
end

function Forja.HasListeners(name)
    local list = Forja._handlers[name]
    return list ~= nil and table.getn(list) > 0
end

-- delivers an event to every handler (up to six values). Returns true when a handler stopped it
-- (returned Forja.Stop). A handler that fails five times is removed.
function Forja.Emit(name, a, b, c, d, e, f)
    local list = Forja._handlers[name]
    if not list then return false end
    local copy = {}
    for i = 1, table.getn(list) do copy[i] = list[i] end
    for i = 1, table.getn(copy) do
        local h = copy[i]
        if not h.removed then
            local ok, r = Forja._Call(h.owner, h.fn, a, b, c, d, e, f)
            if not ok then
                h.errors = h.errors + 1
                if h.errors >= 5 then
                    Forja._Error(h.owner, 'handler of "' .. name .. '" removed after 5 errors')
                    Forja.Off(h)
                end
            elseif r == Forja.Stop then
                return true
            end
        end
    end
    return false
end

---------------------------------------------------------------------------- timers

-- runs fn after `seconds` (where the game has threads: simulation and interface)
function Forja.After(seconds, fn)
    local h = { stopped = false }
    local owner = Forja._current
    ForkThread(function()
        WaitSeconds(seconds)
        if not h.stopped then Forja._Call(owner, fn) end
    end)
    return h
end

-- runs fn every `seconds` until Forja.Cancel(handle) or fn returns false
function Forja.Every(seconds, fn)
    local h = { stopped = false }
    local owner = Forja._current
    ForkThread(function()
        while not h.stopped do
            WaitSeconds(seconds)
            if h.stopped then break end
            local ok, r = Forja._Call(owner, fn)
            if r == false then h.stopped = true end
        end
    end)
    return h
end

function Forja.Cancel(h)
    if type(h) == 'table' then h.stopped = true end
end

---------------------------------------------------------------------------- mods

function Forja.Get(id)
    return Forja._mods[id]
end

function Forja.IsLoaded(id)
    local m = Forja._mods[id]
    return m ~= nil and not m.Failed
end

-- the mods in load order
function Forja.Mods()
    local out = {}
    for i = 1, table.getn(Forja._order) do out[i] = Forja._order[i] end
    return out
end

-- the API another mod shared with mod.Export (nil when that mod is not loaded)
function Forja.Use(id)
    return Forja._exports[id]
end

function Forja.Errors()
    return Forja._errors
end

-- deep copy of a table (values that are tables are copied too)
function Forja.Copy(t)
    if type(t) ~= 'table' then return t end
    local out = {}
    for k, v in pairs(t) do out[k] = Forja.Copy(v) end
    return out
end

-- compiles and runs a piece of code of a mod; the code sees `mod` and `Forja`
local function Run(mod, src, name)
    local load = loadstring or load
    local f, err = load(src, '=' .. name)
    if not f then return false, err end
    local prevMod = _G.ForjaMod
    _G.ForjaMod = mod
    local ok, r = Forja._Call(mod.Id, f)
    _G.ForjaMod = prevMod
    return ok, r
end

function Forja._Register(info)
    local id = info.id
    local mod = {
        Id = id,
        Name = info.name or id,
        Version = info.version or '0.0.0',
        Options = info.options or {},
        Side = Forja.Side,
        Data = {},
        Failed = false,
        _modules = info.modules or {},
        _loaded = {},
    }
    mod.Log = function(text) LOG('[Forja:' .. id .. '] ' .. Text(text)) end
    mod.Warn = function(text) WARN('[Forja:' .. id .. '] ' .. Text(text)) end
    mod.Option = function(key, default)
        local v = mod.Options[key]
        if v == nil then return default end
        return v
    end
    mod.Export = function(api) Forja._exports[id] = api end
    -- another file of the same mod (forja/<id>/lib/x.lua -> mod.Require('lib/x')), run once
    mod.Require = function(path)
        local key = string.gsub(Text(path), '%.lua$', '')
        if mod._loaded[key] ~= nil then return mod._loaded[key] end
        local src = mod._modules[key]
        if not src then error('mod ' .. id .. ' has no file ' .. key .. '.lua', 2) end
        local ok, r = Run(mod, src, 'forja/' .. id .. '/' .. key .. '.lua')
        if not ok then error('could not load ' .. key .. '.lua of ' .. id, 2) end
        if r == nil then r = true end
        mod._loaded[key] = r
        return r
    end
    Forja._mods[id] = mod
    table.insert(Forja._order, mod)
    mod._entry = info.entry
    mod._entryName = info.entryName or ('forja/' .. id)
    if not info.defer then Forja._RunEntry(mod) end
    return mod
end

-- runs the main file of a mod for this side (once)
function Forja._RunEntry(mod)
    local src = mod._entry
    mod._entry = nil
    if not src then return end
    local ok, err = Run(mod, src, mod._entryName)
    if not ok then
        mod.Failed = true
        if err then Forja._Error(mod.Id, err) end
    end
end
