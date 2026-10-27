-- Forja on the interface side: messages from the simulation, commands to it, keys, on-screen
-- notices, panels for mods and the Forja panel (@KEY@ or the "F" button on the left edge), which
-- lists the loaded mods, their errors and the menu items mods add.
local UI = {}
Forja.UI = UI
local UIUtil = import('/lua/ui/uiutil.lua')
local LayoutHelpers = import('/lua/maui/layouthelpers.lua')
local Bitmap = import('/lua/maui/bitmap.lua').Bitmap

local KEY = '@KEY@'
local C = {
    Panel = 'F00E161E', Head = 'FF15212C', Row = 'FF17232F', Hover = 'FF23384B',
    Text = 'FFE6EEF5', Faint = 'FF8A97A3', Ok = 'FF63E08E', Accent = 'FFF2B33D', Bad = 'FFFF6060',
}
UI.Colors = C

local simHandlers = {}
local keys = {}
local menu = {}
local ready = false

---------------------------------------------------------------------------- simulation

-- Forja.UI.OnSim('mymod:news', function(data) end): messages sent with Forja.Sim.SendToUI
function UI.OnSim(name, fn)
    if type(name) ~= 'string' or type(fn) ~= 'function' then
        error('Forja.UI.OnSim(name, function): wrong arguments', 2)
    end
    local list = simHandlers[name]
    if not list then
        list = {}
        simHandlers[name] = list
    end
    table.insert(list, { fn = fn, owner = Forja._current })
end

-- runs Forja.Sim.OnCommand(name) in the simulation of every player (as a game command, so it
-- stays in sync in multiplayer). withSelection = true also sends the selected units.
function UI.SendToSim(name, data, withSelection)
    local ok, err = pcall(SimCallback, { Func = 'Forja', Args = { name = name, data = data } }, withSelection == true)
    if not ok then Forja._Error(Forja._current, err) end
end

-- UserSync.lua hands over what the simulation sent this beat
function Forja._Deliver(list)
    if type(list) ~= 'table' then return end
    for _, msg in ipairs(list) do
        if msg.name == 'forja:error' and type(msg.data) == 'table' then
            table.insert(Forja._errors, msg.data)
        end
        local handlers = simHandlers[msg.name]
        if handlers then
            for _, h in ipairs(handlers) do Forja._Call(h.owner, h.fn, msg.data) end
        end
    end
end

---------------------------------------------------------------------------- notices and keys

function UI.Notify(text, seconds, color)
    pcall(function()
        import('/lua/ui/game/textdisplay.lua').PrintToScreen({
            text = tostring(text), size = 16, color = color or C.Accent, duration = seconds or 6, location = 'centertop',
        })
    end)
end

local function Action(name)
    return 'UI_Lua import("/lua/ui/game/gamemain_pc.lua").ForjaKey("' .. name .. '")'
end

local function BindKeys()
    local map = {}
    for key, k in pairs(keys) do
        map[key] = { action = Action(key), category = 'ui', order = 99 }
    end
    pcall(IN_AddKeyMapTable, map)
end

-- Forja.UI.AddKey('F7', 'Open my panel', function() end): a key during the match. The game may
-- already use the key: pick one that is free (F3, F4, F7, F8, F11, Insert, Home are, by default).
function UI.AddKey(key, label, fn)
    keys[key] = { fn = fn, label = label, owner = Forja._current }
    if ready then BindKeys() end
end

function Forja._Key(key)
    local k = keys[key]
    if k then Forja._Call(k.owner, k.fn) end
end

-- an item in the Forja panel (a row that runs fn when clicked; valueFn returns text, color)
function UI.AddMenuItem(label, fn, valueFn)
    table.insert(menu, { label = label, fn = fn, valueFn = valueFn, owner = Forja._current })
end

---------------------------------------------------------------------------- panels

local function Px(n)
    return n * LayoutHelpers.GetPixelScaleFactor()
end

local function Click()
    pcall(function() PlaySound(Sound({ Bank = 'Interface', Cue = 'UI_Menu_MouseDown' })) end)
end

local function MakeText(parent, text, size, color)
    local t = UIUtil.CreateText(parent, text, size, UIUtil.bodyFont)
    t:SetColor(color or C.Text)
    t:DisableHitTest()
    return t
end

local PanelMethods = {}

-- a row: label on the left, value on the right; clicking runs onClick (nil = just text)
function PanelMethods.Button(self, label, onClick, valueFn)
    table.insert(self.rows, { label = label, onClick = onClick, valueFn = valueFn, owner = Forja._current })
    if self.built then self:_Rebuild() end
    return self
end

function PanelMethods.Text(self, text)
    return PanelMethods.Button(self, text, nil, nil)
end

function PanelMethods.Clear(self)
    self.rows = {}
    if self.built then self:_Rebuild() end
    return self
end

function PanelMethods._Build(self)
    local frame = GetFrame(0)
    local p = Bitmap(frame)
    p:SetSolidColor(C.Panel)
    p.Depth:Set(frame:GetTopmostDepth() + 100)
    p.Width:Set(Px(self.width))
    LayoutHelpers.AtRightIn(p, frame, 24)
    LayoutHelpers.AtVerticalCenterIn(p, frame, -40)
    -- clicks on the panel never reach the map below it
    p.HandleEvent = function(_, event)
        return event.Type == 'ButtonPress' or event.Type == 'ButtonDClick' or event.Type == 'WheelRotation'
    end
    local head = Bitmap(p)
    head:SetSolidColor(C.Head)
    head.Width:Set(p.Width)
    head.Height:Set(Px(44))
    LayoutHelpers.AtLeftTopIn(head, p, 0, 0)
    head:DisableHitTest()
    local bar = Bitmap(p)
    bar:SetSolidColor(C.Accent)
    bar.Width:Set(Px(4))
    bar.Height:Set(head.Height)
    LayoutHelpers.AtLeftTopIn(bar, p, 0, 0)
    bar:DisableHitTest()
    local title = MakeText(head, self.title, 16, C.Accent)
    LayoutHelpers.AtLeftTopIn(title, head, 14, 6)
    if self.subtitle then
        local hint = MakeText(head, self.subtitle, 11, C.Faint)
        LayoutHelpers.AtLeftTopIn(hint, head, 14, 25)
    end
    self.control = p
    self.items = {}
    self.built = true
    self:_Rebuild()
    p:Hide()
end

function PanelMethods._Rebuild(self)
    local p = self.control
    for _, item in ipairs(self.items) do item:Destroy() end
    self.items = {}
    local above = nil
    for _, r in ipairs(self.rows) do
        local data = r
        local row = Bitmap(p)
        row:SetSolidColor(C.Row)
        row.Width:Set(function() return p.Width() - Px(16) end)
        row.Height:Set(Px(30))
        if above then
            LayoutHelpers.Below(row, above, 4)
        else
            LayoutHelpers.AtLeftTopIn(row, p, 8, 52)
        end
        row.label = MakeText(row, data.label, 14, data.onClick and C.Text or C.Faint)
        LayoutHelpers.AtLeftIn(row.label, row, 10)
        LayoutHelpers.AtVerticalCenterIn(row.label, row, 0)
        row.value = MakeText(row, '', 13)
        LayoutHelpers.AtRightIn(row.value, row, 10)
        LayoutHelpers.AtVerticalCenterIn(row.value, row, 0)
        row.Refresh = function(me)
            if data.valueFn then
                local ok, text, color = pcall(data.valueFn)
                if ok then
                    me.value:SetText(tostring(text or ''))
                    me.value:SetColor(color or C.Faint)
                end
            end
        end
        row.HandleEvent = function(me, event)
            if not data.onClick then return false end
            if event.Type == 'MouseEnter' then
                me:SetSolidColor(C.Hover)
                return true
            elseif event.Type == 'MouseExit' then
                me:SetSolidColor(C.Row)
                return true
            elseif event.Type == 'ButtonPress' or event.Type == 'ButtonDClick' then
                Click()
                Forja._Call(data.owner, data.onClick)
                self:Refresh()
                return true
            end
            return false
        end
        row:Refresh()
        table.insert(self.items, row)
        above = row
    end
    p.Height:Set(Px(52 + 34 * table.getn(self.rows) + 10))
end

function PanelMethods.Refresh(self)
    if not self.built then return end
    for _, row in ipairs(self.items) do row:Refresh() end
end

function PanelMethods.Show(self)
    if not self.built then
        local ok, err = pcall(PanelMethods._Build, self)
        if not ok then
            Forja._Error(self.owner, 'panel: ' .. tostring(err))
            return
        end
    end
    self:Refresh()
    self.control:Show()
end

function PanelMethods.Hide(self)
    if self.built then self.control:Hide() end
end

function PanelMethods.IsShown(self)
    return self.built and not self.control:IsHidden()
end

function PanelMethods.Toggle(self)
    if self:IsShown() then self:Hide() else self:Show() end
end

-- Forja.UI.Panel{ title = 'My mod', subtitle = 'F7 opens and closes', width = 300 }
function UI.Panel(opts)
    opts = opts or {}
    local panel = {
        title = opts.title or 'Mod', subtitle = opts.subtitle, width = opts.width or 300,
        rows = {}, built = false, owner = Forja._current,
    }
    for k, v in pairs(PanelMethods) do panel[k] = v end
    return panel
end

---------------------------------------------------------------------------- the Forja panel

local forjaPanel = false

local function FillForjaPanel()
    forjaPanel:Clear()
    for _, m in ipairs(Forja._order) do
        local mod = m
        forjaPanel:Button(mod.Name .. '  ' .. mod.Version, nil, function()
            if mod.Failed then return 'ERRO', C.Bad end
            return 'OK', C.Ok
        end)
    end
    for _, item in ipairs(menu) do
        forjaPanel:Button(item.label, item.fn, item.valueFn)
        forjaPanel.rows[table.getn(forjaPanel.rows)].owner = item.owner
    end
    forjaPanel:Button('Erros', function()
        local n = table.getn(Forja._errors)
        if n == 0 then
            UI.Notify('Forja: nenhum erro', 4, C.Ok)
        else
            local e = Forja._errors[n]
            UI.Notify('Forja: ' .. tostring(e.mod) .. ' (' .. tostring(e.side) .. '): ' .. tostring(e.text), 10, C.Bad)
        end
    end, function()
        local n = table.getn(Forja._errors)
        if n == 0 then return '0', C.Ok end
        return tostring(n), C.Bad
    end)
end

function UI.TogglePanel()
    if not forjaPanel then
        forjaPanel = UI.Panel({ title = 'Forja - mods', subtitle = KEY .. ' abre e fecha', width = 320 })
    end
    if not forjaPanel:IsShown() then FillForjaPanel() end
    forjaPanel:Toggle()
end

local function CreateTab()
    local frame = GetFrame(0)
    local tab = Bitmap(frame)
    tab:SetSolidColor(C.Head)
    tab.Depth:Set(frame:GetTopmostDepth() + 90)
    tab.Width:Set(Px(30))
    tab.Height:Set(Px(30))
    LayoutHelpers.AtLeftIn(tab, frame, 0)
    LayoutHelpers.AtVerticalCenterIn(tab, frame, 40)
    local label = MakeText(tab, 'F', 14, C.Accent)
    LayoutHelpers.AtCenterIn(label, tab)
    tab.HandleEvent = function(me, event)
        if event.Type == 'MouseEnter' then
            me:SetSolidColor(C.Hover)
            return true
        elseif event.Type == 'MouseExit' then
            me:SetSolidColor(C.Head)
            return true
        elseif event.Type == 'ButtonPress' then
            Click()
            UI.TogglePanel()
            return true
        end
        return false
    end
end

-- OnFirstUpdate (gamemain_pc.lua): the match is on the screen
function Forja._UIReady()
    if ready then return end
    ready = true
    keys[KEY] = { fn = UI.TogglePanel, label = 'Forja', owner = false }
    BindKeys()
    -- the game may reload the key map after the interface is built: bind again a little later
    ForkThread(function()
        WaitSeconds(3)
        BindKeys()
        WaitSeconds(10)
        BindKeys()
    end)
    local ok, err = pcall(CreateTab)
    if not ok then Forja._Error('forja', err) end
    Forja.Emit('UIReady')
    local failed = 0
    for _, m in ipairs(Forja._order) do
        if m.Failed then failed = failed + 1 end
    end
    if failed > 0 then
        UI.Notify('Forja: ' .. failed .. ' mod(s) com erro. ' .. KEY .. ' mostra quais.', 10, C.Bad)
    end
end
