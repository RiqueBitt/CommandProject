//! Mod de trapaças para jogar sozinho: massa, energia e pesquisa infinitas, tudo pesquisado desde
//! o começo, unidades invencíveis e construção mais rápida.
//!
//! O mod é montado na hora com os arquivos do próprio jogo do usuário: o `simInit.lua` (texto, de
//! `uncompiled_lua.scd`) ganha uma linha que inicia `/lua/sim/cp_cheats.lua`, um arquivo novo nosso.
//! Nada do jogo é distribuído. As trapaças só valem para jogadores humanos e se desligam sozinhas
//! quando há mais de um humano na partida (multiplayer).

use crate::error::{Error, Result};
use crate::mapassets::read_game_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CheatOptions {
    /// massa sempre cheia
    pub mass: bool,
    /// energia sempre cheia
    pub energy: bool,
    /// pontos de pesquisa sem fim
    pub research: bool,
    /// toda a árvore de pesquisa liberada no começo
    pub unlock_all: bool,
    /// unidades e prédios invencíveis
    pub god: bool,
    /// multiplicador da velocidade de construção (1 = normal)
    pub build_speed: f32,
    /// a IA também ganha as trapaças (desafio: IA "trapaceira")
    pub ai_too: bool,
}

impl Default for CheatOptions {
    fn default() -> Self {
        CheatOptions {
            mass: true,
            energy: true,
            research: true,
            unlock_all: false,
            god: true,
            build_speed: 1.0,
            ai_too: false,
        }
    }
}

/// O script das trapaças (Lua do jogo: `for k, v in tabela do`, `table.getn`).
pub fn cheats_lua(o: &CheatOptions) -> String {
    let b = |v: bool| if v { "true" } else { "false" };
    let speed = o.build_speed.clamp(1.0, 50.0);
    format!(
        r#"-- CommandProject: trapacas para jogar sozinho (gerado pelo launcher).
-- Valem para os jogadores humanos (e para a IA, se escolhido). Com mais de um humano na partida
-- (multiplayer) nada e ativado.
local OPT = {{
    Mass = {mass},
    Energy = {energy},
    Research = {research},
    UnlockAll = {unlock},
    God = {god},
    BuildSpeed = {speed},
    AiToo = {ai},
}}

local function Targets()
    local humans, out = 0, {{}}
    for _, brain in ArmyBrains do
        local civ = false
        pcall(function() civ = ArmyIsCivilian(brain:GetArmyIndex()) end)
        if not civ then
            if brain.BrainType == 'Human' then
                humans = humans + 1
                table.insert(out, brain)
            elseif OPT.AiToo then
                table.insert(out, brain)
            end
        end
    end
    return out, humans
end

local function Fill(brain, kind, target)
    -- abre espaco no estoque antes de encher (o jogo limita massa e energia ao armazem)
    pcall(function() brain:SetMaxStorage(kind, target + 1000) end)
    local stored = 0
    pcall(function() stored = brain:GetEconomyStored(kind) end)
    if stored < target then
        pcall(function() brain:GiveResource(kind, target - stored) end)
    end
end

local function Units(brain)
    local list = {{}}
    pcall(function() list = brain:GetListOfUnits(categories.ALLUNITS, false) end)
    return list
end

function Run()
    WaitSeconds(1)
    local brains, humans = Targets()
    if humans > 1 then
        LOG('*CommandProject: trapacas desligadas (mais de um jogador humano)')
        return
    end
    LOG('*CommandProject: trapacas ligadas')
    if OPT.UnlockAll then
        for _, brain in brains do
            local idx = brain:GetArmyIndex()
            if not pcall(function() UnlockAllResearch(idx) end) then
                pcall(function() brain:AddAllResearch() end)
            end
        end
    end
    local tick = 0
    while true do
        tick = tick + 1
        for _, brain in brains do
            if not brain:IsDefeated() then
                if OPT.Mass then Fill(brain, 'MASS', 100000) end
                if OPT.Energy then Fill(brain, 'ENERGY', 100000) end
                if OPT.Research then
                    -- partidas com limite de pesquisa travam o estoque a cada tecnologia
                    brain.ResearchCapped = false
                    Fill(brain, 'RESEARCH', 99999)
                end
                if OPT.God or OPT.BuildSpeed > 1 then
                    for _, unit in Units(brain) do
                        if unit and not unit:IsDead() then
                            if OPT.God and not unit.CPGod then
                                pcall(function() unit:SetCanTakeDamage(false) end)
                                pcall(function() unit:SetCanBeKilled(false) end)
                                unit.CPGod = true
                            end
                            -- as pesquisas mudam a velocidade de construcao: reaplica de tempos em tempos
                            if OPT.BuildSpeed > 1 and (not unit.CPBuild or math.mod(tick, 10) == 0) then
                                local bp = unit:GetBlueprint()
                                local rate = bp and bp.Economy and bp.Economy.BuildRate
                                if rate and rate > 0 then
                                    pcall(function() unit:SetBuildRate(rate * OPT.BuildSpeed) end)
                                end
                                unit.CPBuild = true
                            end
                        end
                    end
                end
            end
        end
        WaitSeconds(1)
    end
end
"#,
        mass = b(o.mass),
        energy = b(o.energy),
        research = b(o.research),
        unlock = b(o.unlock_all),
        god = b(o.god),
        speed = speed,
        ai = b(o.ai_too),
    )
}

const HOOK: &str = "\tForkThread(import('/lua/sim/cp_cheats.lua').Run) -- CommandProject cheats\n";

/// `simInit.lua` do jogo com a linha que inicia as trapaças no começo da partida.
pub fn patch_sim_init(text: &str) -> Result<String> {
    if text.contains("cp_cheats.lua") {
        return Ok(text.to_string());
    }
    // depois de tudo montado: logo antes do placar começar a contar
    let anchors = [
        "ForkThread(import('/lua/sim/aibrain.lua').CollectCurrentScores)",
        "ForkThread(import('/lua/sim/victory.lua').CheckVictory",
    ];
    for a in anchors {
        if let Some(p) = text.find(a) {
            let line = text[..p].rfind('\n').map(|i| i + 1).unwrap_or(0);
            return Ok(format!("{}{HOOK}{}", &text[..line], &text[line..]));
        }
    }
    // plano B: primeira linha de BeginSession
    if let Some(p) = text.find("function BeginSession()") {
        let end = text[p..].find('\n').map(|i| p + i + 1).unwrap_or(text.len());
        return Ok(format!("{}{HOOK}{}", &text[..end], &text[end..]));
    }
    Err(Error::Other(
        "o simInit.lua do jogo não tem BeginSession: não deu para ligar as trapaças".into(),
    ))
}

/// Monta o `.scd` do mod em `dest` com os arquivos do jogo do usuário (`sources`).
pub fn build(sources: &[PathBuf], opts: &CheatOptions, dest: &Path) -> Result<PathBuf> {
    let raw = read_game_file(sources, "/uncompiled/lua/simInit.lua").map_err(|_| {
        Error::Other(
            "o jogo não tem o simInit.lua em texto (uncompiled_lua.scd): não dá para montar as trapaças".into(),
        )
    })?;
    if crate::lua::inspect(&raw).compiled {
        return Err(Error::Other(
            "o simInit.lua do jogo está compilado: não dá para montar as trapaças".into(),
        ));
    }
    let text = String::from_utf8_lossy(&raw).replace("\r\n", "\n");
    let patched = patch_sim_init(&text)?;
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    b.add_bytes("lua/simInit.lua", patched.as_bytes())?;
    b.add_bytes("lua/sim/cp_cheats.lua", cheats_lua(opts).as_bytes())?;
    b.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_goes_before_scores() {
        let src = "function BeginSession()\n\tlocal a = 1\n\t--start\n\tForkThread(import('/lua/sim/aibrain.lua').CollectCurrentScores)\nend\n";
        let out = patch_sim_init(src).unwrap();
        let hook = out.find("cp_cheats.lua").unwrap();
        assert!(hook < out.find("CollectCurrentScores").unwrap());
        assert!(out.starts_with(
            "function BeginSession()\n\tlocal a = 1\n\t--start\n\tForkThread(import('/lua/sim/cp_cheats.lua')"
        ));
        // de novo não duplica
        assert_eq!(patch_sim_init(&out).unwrap(), out);
        // sem âncora: entra no começo de BeginSession
        let o2 = patch_sim_init("x = 1\nfunction BeginSession()\nend\n").unwrap();
        assert!(o2.contains("function BeginSession()\n\tForkThread(import('/lua/sim/cp_cheats.lua')"));
        assert!(patch_sim_init("nada aqui").is_err());
    }

    #[test]
    fn options_in_script() {
        let s = cheats_lua(&CheatOptions {
            god: false,
            build_speed: 3.0,
            ..Default::default()
        });
        assert!(s.contains("God = false") && s.contains("BuildSpeed = 3") && s.contains("Mass = true"));
        assert!(!s.contains('#'), "Lua do jogo não usa #");
    }

    #[test]
    fn builds_scd_from_game_files() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("uncompiled_lua.scd");
        crate::library::tests::make_scd(&src, &[("uncompiled\\lua\\simInit.lua", b"function BeginSession()\r\n\tForkThread(import('/lua/sim/aibrain.lua').CollectCurrentScores)\r\nend\r\n")]);
        let dest = tmp.path().join("out.scd");
        build(&[src], &CheatOptions::default(), &dest).unwrap();
        let mut s = crate::scd::Scd::open(&dest).unwrap();
        let init = String::from_utf8(s.read("lua/simInit.lua").unwrap()).unwrap();
        assert!(init.contains("cp_cheats.lua"));
        assert!(String::from_utf8(s.read("lua/sim/cp_cheats.lua").unwrap())
            .unwrap()
            .contains("function Run()"));
    }
}
