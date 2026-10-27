-- Forja on the blueprint side: runs while the game loads its blueprints (Blueprints.lua,
-- ModBlueprints), before any match. Mods change units, weapons and projectiles here with the
-- helpers of Forja.BP; what they change is what every match uses.
local BP = {}
Forja.BP = BP
local gfind = string.gfind or string.gmatch
local all = false
local tasks = {}

local function Need()
    if not all then error('Forja.BP only works inside Forja.BP.Modify (while the game loads blueprints)', 3) end
end

-- Forja.BP.Modify(function(bp) ... end): runs when the blueprints are loaded (in load order of the
-- mods). Code in a mod's blueprints.lua may also use Forja.BP directly: it already runs then.
function BP.Modify(fn)
    table.insert(tasks, { fn = fn, owner = Forja._current })
end

-- every group of blueprints (Unit, Weapon, Projectile, Prop, Mesh, Emitter...)
function BP.All()
    Need()
    return all
end

local function Find(group, id)
    local g = all[group]
    if not g or not id then return nil end
    if g[id] then return g[id] end
    local low = string.lower(id)
    for k, v in pairs(g) do
        if string.lower(k) == low then return v end
    end
    return nil
end

function BP.Unit(id)
    Need()
    return Find('Unit', id)
end

function BP.Weapon(id)
    Need()
    return Find('Weapon', id)
end

function BP.Projectile(id)
    Need()
    return Find('Projectile', id)
end

function BP.Units()
    Need()
    return all.Unit or {}
end

function BP.HasCategory(bp, cat)
    if type(bp) ~= 'table' or type(bp.Categories) ~= 'table' then return false end
    local want = string.upper(cat)
    for _, c in ipairs(bp.Categories) do
        if string.upper(c) == want then return true end
    end
    return false
end

function BP.AddCategory(bp, cat)
    if BP.HasCategory(bp, cat) then return end
    if type(bp.Categories) ~= 'table' then bp.Categories = {} end
    table.insert(bp.Categories, string.upper(cat))
end

function BP.RemoveCategory(bp, cat)
    if type(bp.Categories) ~= 'table' then return end
    local want = string.upper(cat)
    for i = table.getn(bp.Categories), 1, -1 do
        if string.upper(bp.Categories[i]) == want then table.remove(bp.Categories, i) end
    end
end

-- every unit that passes the filter: nil (all), a category ('LAND'), a list of categories (all
-- of them) or a function(bp) -> true
function BP.EachUnit(filter, fn)
    Need()
    for id, bp in pairs(all.Unit or {}) do
        local ok = true
        if type(filter) == 'string' then
            ok = BP.HasCategory(bp, filter)
        elseif type(filter) == 'table' then
            for _, c in ipairs(filter) do
                if not BP.HasCategory(bp, c) then ok = false end
            end
        elseif type(filter) == 'function' then
            ok = filter(bp)
        end
        if ok then fn(bp, id) end
    end
end

-- a value by path: BP.Get(bp, 'Defense.MaxHealth')
function BP.Get(bp, path)
    local t = bp
    for part in gfind(path, '[^%.]+') do
        if type(t) ~= 'table' then return nil end
        local n = tonumber(part)
        t = t[n or part]
    end
    return t
end

-- sets a value by path, creating the tables on the way: BP.Set(bp, 'Economy.BuildTime', 10)
function BP.Set(bp, path, value)
    local t = bp
    local parts = {}
    for part in gfind(path, '[^%.]+') do table.insert(parts, tonumber(part) or part) end
    for i = 1, table.getn(parts) - 1 do
        local k = parts[i]
        if type(t[k]) ~= 'table' then t[k] = {} end
        t = t[k]
    end
    t[parts[table.getn(parts)]] = value
end

-- multiplies a number by path (does nothing when it is not a number)
function BP.Scale(bp, path, factor)
    local v = BP.Get(bp, path)
    if type(v) == 'number' then BP.Set(bp, path, v * factor) end
end

-- copies the fields of patch into target, table by table (lists inside patch replace)
function BP.Merge(target, patch)
    for k, v in pairs(patch) do
        if type(v) == 'table' and type(target[k]) == 'table' and v[1] == nil then
            BP.Merge(target[k], v)
        else
            target[k] = Forja.Copy(v)
        end
    end
    return target
end

-- changes a unit by id with a patch table; returns the unit (nil when there is none)
function BP.Patch(id, patch)
    local bp = BP.Unit(id)
    if bp then BP.Merge(bp, patch) end
    return bp
end

-- a new unit made from a copy of another one (same model and weapons), with patch on top
function BP.Clone(id, newId, patch)
    local src = BP.Unit(id)
    if not src then error('Forja.BP.Clone: there is no unit ' .. tostring(id), 2) end
    local bp = Forja.Copy(src)
    bp.BlueprintId = newId
    if type(bp.Categories) == 'table' then
        BP.RemoveCategory(bp, id)
        BP.AddCategory(bp, newId)
    end
    if patch then BP.Merge(bp, patch) end
    all.Unit[newId] = bp
    return bp
end

-- ModBlueprints (Blueprints.lua) calls this with every blueprint of the game
function Forja._Blueprints(blueprints)
    all = blueprints
    -- the blueprints.lua of each mod runs now, in load order (it may use Forja.BP right away)
    for _, mod in ipairs(Forja._order) do Forja._RunEntry(mod) end
    Forja.Emit('Blueprints', blueprints)
    for _, t in ipairs(tasks) do Forja._Call(t.owner, t.fn, BP) end
    all = false
    tasks = {}
end
