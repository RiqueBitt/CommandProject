-- Um arquivo extra do mod: mod.Require('lib/util') roda uma vez e devolve o que ele retornar.
local M = {}

function M.Describe(t)
    if type(t) ~= 'table' then return tostring(t) end
    local parts = {}
    for k, v in pairs(t) do table.insert(parts, tostring(k) .. '=' .. tostring(v)) end
    return '{' .. table.concat(parts, ', ') .. '}'
end

return M
