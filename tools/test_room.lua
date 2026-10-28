-- Roda a sala com amigos (crates/cp-core/src/bigmatch.lua) num jogo de mentira (Lua 5.1): duas
-- "cópias" do jogo no mesmo processo (anfitrião e convidado), rede e interface falsas.
-- Uso: lua5.1 tools/test_room.lua
local src = io.open('crates/cp-core/src/bigmatch.lua'):read('*a')
src = src:gsub('!=', '~=')
src = src:gsub('for ([%w_]+), ([%w_]+) in ([^\n]-) do', function(a, b, e)
    if e:match('^ipairs') or e:match('^pairs') then return nil end
    return 'for ' .. a .. ', ' .. b .. ' in __iter(' .. e .. ') do'
end)
function __iter(t)
    if t[1] ~= nil or next(t) == nil then return ipairs(t) end
    return pairs(t)
end
math.mod = math.mod or math.fmod
function table.copy(t) local o = {} for k, v in pairs(t) do o[k] = v end return o end

local log = {}
function LOG(s) table.insert(log, s) end
function WARN(s) table.insert(log, 'WARN ' .. s) print('WARN', s) end
function LOC(s) return (s:gsub('^<LOC [^>]*>', '')) end
function LOCF(f, ...) return string.format(LOC(f), ...) end
function PlaySound() end
function Sound(t) return t end
function GetRandomFaction() return 2 end
function GetRandomName(f, ai) return 'IA' .. tostring(ai) end
function VerifyScenarioConfiguration() end
function HasCommandLineArg() return false end
function GetCommandLineArg() return nil end
function SavePreferences() end
function ExitApplication() table.insert(log, 'EXIT') end
defaultOptions = {}
local prefs = {}
Prefs = { GetFromCurrentProfile = function(k) return prefs[k] end, SetToCurrentProfile = function(k, v) prefs[k] = v end }
MapUtils = { GetExtraArmies = function() return nil end }

-- interface falsa: guarda o que foi desenhado
local drawn = {}
local function lazy(v) local o = { v = v } setmetatable(o, { __call = function(self) return self.v end }) function o:Set(x) self.v = x end return o end
local function control()
    local c = { Width = lazy(0), Height = lazy(0), Depth = lazy(1) }
    function c:SetSolidColor(x) self.color = x end
    function c:Destroy() self.dead = true end
    function c:DisableHitTest() end
    function c:SetColor(x) self.color = x end
    function c:SetDropShadow() end
    function c:AcquireKeyboardFocus() end
    function c:SetText(t) self.text = t end
    function c:GetText() return self.text end
    function c:SetFont() end
    function c:SetForegroundColor() end
    function c:ShowBackground() end
    function c:SetMaxChars() end
    function c:AcquireFocus() end
    return c
end
function GetFrame() local f = control() function f:GetTopmostDepth() return 10 end return f end
local modules = {
    ['/lua/ui/uiutil.lua'] = { bodyFont = 'x', CreateText = function(p, text) local t = control() t.text = text table.insert(drawn, t) return t end },
    ['/lua/maui/layouthelpers.lua'] = setmetatable({}, { __index = function() return function() end end }),
    ['/lua/maui/bitmap.lua'] = { Bitmap = function() local b = control() table.insert(drawn, b) return b end },
    ['/lua/maui/edit.lua'] = { Edit = function() return control() end },
    ['/lua/user/prefs.lua'] = Prefs,
    ['/lua/common/factions.lua'] = { Factions = { {}, {}, {} } },
    ['/lua/common/gameColors.lua'] = { GameColors = { PlayerColors = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }, FactionColors = { { { icon = 'A' }, { icon = 'B' } }, { { icon = 'C' } }, { { icon = 'D' } } } } },
    ['/lua/system/mods.lua'] = { GetOfficialDLCModForSession = function() return {} end, GetCampaignMods = function() return {} end },
    ['/lua/ui/maputil.lua'] = { LoadScenario = function(m) return { name = 'Mapa 6', file = m, size = { 512, 512 }, Configurations = { standard = { teams = { { armies = { 'A1', 'A2', 'A3', 'A4', 'A5', 'A6' } } } } } } end, GetExtraArmies = function() return nil end },
}
-- rede falsa: a do anfitrião e a do convidado se falam direto
local comms = {}
modules['/lua/ui/lobby/lobbyComm.lua'] = {
    GetDefaultPlayerOptions = function(name) return { PlayerName = name } end,
    CreateLobbyComm = function(proto, port, name)
        local c = { name = name, id = 'id' .. (table.getn(comms) + 1), sent = {} }
        function c:GetLocalPlayerID() return self.id end
        function c:HostGame() self.host = true comms.host = self self:Hosting() end
        function c:JoinGame(addr) comms.guest = self self:ConnectionToHostEstablished(self.id, comms.host.id) end
        function c:SendData(to, data) data.SenderID = self.id data.SenderName = self.name comms.host:DataReceived(data) end
        function c:BroadcastData(data) data.SenderID = self.id if comms.guest then comms.guest:DataReceived(data) end end
        function c:LaunchGame(info) self.launched = info end
        function c:EjectPeer(id, why) table.insert(log, 'eject ' .. why) end
        function c:Destroy() end
        table.insert(comms, c)
        return c
    end,
}
function import(p) return modules[p] or error('import ' .. p) end

assert(loadstring(src, 'bigmatch.lua'))()
-- prefs da Partida grande
prefs.CPBigMatch = { players = 4, teams = 2, ai = 'Hard', faction = 1, victory = 'demoralization', units = 500, mode = 'koth' }

-- 1) anfitrião abre pelo menu (as outras bases ficam para amigos)
local host = {}
CPNetHostFromMenu('/maps/m6/m6_scenario.lua')
assert(CPNet.host and CPNet.comm and CPNet.view, 'anfitrião abriu')
assert(table.getn(CPNet.view.slots) == 4, 'vagas: ' .. table.getn(CPNet.view.slots))
assert(CPNet.view.slots[1].kind == 'H' and CPNet.view.slots[2].kind == 'G', 'você e vagas livres')
local hostState = CPNet
-- 2) o anfitrião troca a própria cor e o time
CPNetChange('color', 1)
CPNetChange('team', 1)
-- a cor 1 é da vaga 2: vai para a próxima livre (cores únicas na sala)
local used = {}
for _, sl in ipairs(CPNet.view.slots) do assert(not used[sl.color], 'cor repetida') used[sl.color] = true end
assert(CPNet.view.slots[1].color == 4 and CPNet.view.slots[1].team == 3, 'cor/time do anfitrião ' .. CPNet.view.slots[1].color .. '/' .. CPNet.view.slots[1].team)
-- 3) um amigo entra (mesma tabela CPNet neste teste: simula a mensagem direto)
comms.host:DataReceived({ Type = 'CPHello', Name = 'Bruno', SenderID = 'amigo1' })
assert(CPNet.view.slots[2].kind == 'F' and CPNet.view.slots[2].name == 'Bruno', 'amigo na vaga 2')
-- 4) o amigo pede a mesma cor do anfitrião: vai para a próxima livre
CPNetApply('amigo1', { Color = 4, Faction = 3, Team = 4 })
local b = CPNet.view.slots[2]
assert(b.color ~= 4, 'cor repetida foi trocada: ' .. b.color)
assert(b.faction == 3 and b.team == 4, 'facção e time do amigo')
-- 5) começar: vagas livres viram IA com a dificuldade escolhida; facção aleatória resolvida
CPNetLaunch()
local info = comms.host.launched
assert(info, 'partida começou')
local ai, friend = 0, nil
for _, p in ipairs(info.PlayerOptions) do
    if not p.Human then ai = ai + 1 assert(p.AIPersonality == 'Hard') end
    if p.PlayerName == 'Bruno' then friend = p end
    assert(p.CPGuest == nil and p.CPFaction == nil, 'campos internos limpos')
    assert(p.Faction and p.Faction >= 1, 'facção definida')
end
assert(ai == 2, 'duas IAs: ' .. ai)
assert(friend.OwnerID == 'amigo1' and friend.Faction == 3 and friend.Team == 4)
assert(info.GameOptions.CPMode == 'koth', 'minigame vai junto: ' .. tostring(info.GameOptions.CPMode))
-- 6) a tela desenhou os botões e as linhas
local texts = 0
for _, c in ipairs(drawn) do if c.text then texts = texts + 1 end end
assert(texts > 10, 'tela desenhada: ' .. texts)
-- 7) entrar pelo menu (convidado): pede o endereço e conecta
CPNet = { comm = false, host = false, info = false, panel = false, lines = {}, started = false, view = false, myId = false, hostId = false, ai = 'Normal', fromMenu = false }
CPNetJoinDirect('10.0.0.5:15000')
assert(prefs.CPNetLast == '10.0.0.5:15000', 'endereço guardado')
assert(CPNet.hostId and CPNet.myId, 'conectado')
for _, l in ipairs(log) do if l:match('^WARN') then error(l) end end
print('sala com amigos: tudo certo (' .. table.getn(log) .. ' linhas de log)')
