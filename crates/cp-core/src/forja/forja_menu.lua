-- Forja on the start screen (the game's main menu, before a match). The buttons that mods declare
-- in mod.json are part of the menu scene the launcher builds; a click runs
-- import('/lua/ui/uimain.lua').ForjaMenuClick('<mod>:<button>'), which ends here. Mods react to
-- their buttons with Forja.Menu.OnClick, show messages with Forja.Menu.Dialog, open sites and keep
-- small values between sessions. Written for the game's Lua (5.0).
local Menu = {}
Forja.Menu = Menu

local defs = {}
local order = {}
local handlers = {}
-- taken now: inside threads of the start screen some globals are not visible
local showDialog = UIShowDialog
local openUrl = OpenURL
local getPref = GetPreference
local setPref = SetPreference
local savePrefs = SavePreferences

local function Text(v)
    if type(v) == 'string' then return v end
    return tostring(v)
end

-- the launcher declares every button of every mod here
function Menu._Define(info)
    defs[info.key] = info
    table.insert(order, info)
end

-- 'button' (of the mod whose code is running) or 'mod:button'
local function Key(id)
    if string.find(id, ':', 1, true) then return id end
    local owner = Forja._current
    if not owner then error('Forja.Menu: use "mod:button" outside the code of a mod', 3) end
    return owner .. ':' .. id
end

-- Forja.Menu.OnClick('my_button', function(button) end): runs when the player clicks the button
-- (button = { key, mod, id, label, message, url })
function Menu.OnClick(id, fn)
    if type(id) ~= 'string' or type(fn) ~= 'function' then
        error('Forja.Menu.OnClick(button, function): wrong arguments', 2)
    end
    handlers[Key(id)] = { fn = fn, owner = Forja._current }
end

-- a message in the game's own dialog, with one button that closes it
function Menu.Dialog(text, button)
    if not showDialog then return false end
    local ok, err = pcall(showDialog, Text(text), button or 'OK', '', '', '', '', '', false)
    if not ok then Forja._Error(Forja._current, err) end
    return ok
end

-- opens a site in the player's browser (Steam overlay or the default browser)
function Menu.OpenURL(url)
    if not openUrl or type(url) ~= 'string' then return false end
    local ok, err = pcall(openUrl, url)
    if not ok then Forja._Error(Forja._current, err) end
    return ok
end

-- small values kept in the game's preferences, separate for each mod
local function PrefKey(key)
    return 'forja_' .. Text(Forja._current or 'menu') .. '_' .. Text(key)
end

function Menu.Get(key, default)
    if not getPref then return default end
    local ok, v = pcall(getPref, PrefKey(key))
    if ok and v ~= nil then return v end
    return default
end

function Menu.Set(key, value)
    if not setPref then return false end
    local ok = pcall(setPref, PrefKey(key), value)
    if ok and savePrefs then pcall(savePrefs) end
    return ok
end

-- the buttons mods added (copies), in order
function Menu.Buttons()
    local out = {}
    for i = 1, table.getn(order) do out[i] = Forja.Copy(order[i]) end
    return out
end

function Menu.Button(key)
    return Forja.Copy(defs[key])
end

-- a click on a button: the mod's handler or, without one, the message and the site of mod.json
function Forja._MenuClick(key)
    local def = defs[key]
    if Forja.Emit('MenuClick', key, Forja.Copy(def)) then return end
    local h = handlers[key]
    if h then
        Forja._Call(h.owner, h.fn, Forja.Copy(def))
        return
    end
    if def then
        if def.url then Menu.OpenURL(def.url) end
        if def.message then Menu.Dialog(def.message) end
    else
        Forja.Warn('menu button without definition: ' .. Text(key))
    end
end
