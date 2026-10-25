//! Mod "IA mais esperta": deixa a IA de escaramuça (todas as dificuldades) mais forte e estratégica.
//!
//! Montado na hora com os arquivos de texto do próprio jogo do usuário (`uncompiled_lua.scd`), em
//! pequenos ajustes de texto; nada do jogo é distribuído. A expansão oficial (DLC1) substitui vários
//! arquivos de IA por cópias em `mods/DLC1/shadow/...`: quando a cópia existe, é ela que o jogo usa,
//! então o ajuste parte dela e vai para o mesmo caminho.
//!
//! O que muda:
//! - **Navios**: os construtores de navios usavam uma chave de prioridade que o jogo não lê
//!   (`Priority` em vez de `BasePriority`), dois tinham condições mal formadas, só o arquétipo
//!   naval construía estaleiro e a água só contava a menos de 150 da base. Agora todo arquétipo
//!   constrói estaleiro quando há mar perto, a IA naval ganha quando a água separa os jogadores e
//!   os navios recebem orçamento.
//! - **Economia e bases**: mais engenheiros por base, expansões (mini-bases) mais cedo e em
//!   paralelo, mais extratores ao mesmo tempo, pesquisa sem esperar um ponto a mais.
//! - **Comandante estratégico** (Lua, por cima da IA do motor): junta o exército em vez de mandar
//!   ataques pequenos, só ataca com vantagem clara, escolhe pontos estratégicos (extratores,
//!   fábricas), defende as expansões, recua quando perde, manda feridos para casa, embosca no
//!   caminho da base e faz ataques-relâmpago em extratores sem defesa; a frota caça o que alcança.

use crate::error::{Error, Result};
use crate::mapassets::read_game_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AiOptions {
    /// 1 = esperta, 2 = brutal (mais engenheiros, exército maior e mais paciente)
    pub level: u8,
    /// navios em mapas com água
    pub naval: bool,
    /// economia, engenheiros, expansões e pesquisa
    pub economy: bool,
    /// comandante estratégico do exército
    pub commander: bool,
    /// ataques-relâmpago com unidades rápidas
    pub raids: bool,
}

impl Default for AiOptions {
    fn default() -> Self {
        AiOptions { level: 1, naval: true, economy: true, commander: true, raids: true }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiBuild {
    pub archive: PathBuf,
    /// ajustes aplicados
    pub applied: usize,
    /// ajustes que não encontraram o texto esperado (versão diferente do jogo)
    pub skipped: Vec<String>,
}

const COMMANDER_LUA: &str = include_str!("aimod_commander.lua");
const SHADOW: &str = "mods/DLC1/shadow/";

enum Op {
    /// troca `find` por `with`; `all` troca todas as ocorrências (senão exige exatamente uma)
    Replace { find: String, with: String, all: bool },
    /// acrescenta no fim do arquivo
    Append(String),
}

struct FileEdit {
    path: &'static str,
    ops: Vec<(String, Op)>,
}

fn rep(what: &str, find: &str, with: &str) -> (String, Op) {
    (what.into(), Op::Replace { find: find.into(), with: with.into(), all: false })
}

fn rep_all(what: &str, find: &str, with: &str) -> (String, Op) {
    (what.into(), Op::Replace { find: find.into(), with: with.into(), all: true })
}

const NAVAL_UNITS_OFF: &str = "ResourceType = 'NavalUnits',
            MassCap = -1,
            MassPercent = 0,
            EnergyCap = -1,
            EnergyPercent = 0,";
const NAVAL_UNITS_ON: &str = "ResourceType = 'NavalUnits',
            MassCap = 200,
            MassPercent = 0.08,
            EnergyCap = 500,
            EnergyPercent = 0.08,";

fn naval_factory_builder(id: &str, max: u32, extractors: u32, priority: u32) -> String {
    let cond = |faction: u32| {
        format!(
            "        {{
            {{ ConditionType = 'BaseIsNaval', }},
            {{ ConditionType = 'UnitFactionCheck', ConditionIntegerOne = {faction}, }},
            {{ ConditionType = 'EngineerBlueprintCanAfford', }},
            {{ ConditionType = 'CategoryGreaterThanOrEqual', ConditionCategoryStringOne = 'MASSEXTRACTION', ConditionIntegerOne = {extractors}, }},
            {{ ConditionType = 'BaseFactoriesLessThan', ConditionCategoryStringOne = 'uub0003, ucb0003', ConditionIntegerOne = {max}, }},
            {{ ConditionType = 'EngineerBlueprintPositionQuery', }},
        }},
"
        )
    };
    format!(
        "SkirmishEngineerBlueprint {{
    AnnounceItem = false,
    AnnounceFail = false,
    BlueprintId = '{id}',
    BuilderIds = {{
        'uul0001',
        'uul0002',
        'ucl0001',
        'ucl0002',
    }},
    Conditions = {{
{}{}    }},
    InstanceCount = 1,
    ItemGroups = {{
        'CP Naval Group',
    }},
    BufferSize = 5,
    UnitToBuild = 'SeaFactory',
    BuildLocation = 'NavalMarker',
    BuildRelative = 'CenterPoint',
    PlatoonBehavior = 'EngineerBuild',
    BasePriority = {priority},
    SkirmishResourceType = 'All',
    SharedInstanceCount = 'FactoryConstruction',
}}

",
        cond(1),
        cond(2)
    )
}

fn edits(o: &AiOptions) -> Vec<FileEdit> {
    let brutal = o.level >= 2;
    let mut files: Vec<FileEdit> = Vec::new();
    let mut add = |path: &'static str, ops: Vec<(String, Op)>| {
        if let Some(f) = files.iter_mut().find(|f| f.path == path) {
            f.ops.extend(ops);
        } else if !ops.is_empty() {
            files.push(FileEdit { path, ops });
        }
    };

    if o.naval {
        add(
            "lua/AI/skirmish/FactoryBuilders/SAIFactoryBuilders_Naval.bp",
            vec![
                rep_all("navios: prioridade lida pelo jogo", "\n    Priority = ", "\n    BasePriority = "),
                rep(
                    "encouraçados: condições válidas",
                    "    Conditions = {
\t\t{ ConditionType = 'BasePoolUnitRatioLessThan', ConditionFloat = 0.40, ConditionCategoryStringOne = 'MOBILE NAVAL BATTLESHIP', ConditionCategoryStringTwo = 'MOBILE NAVAL -BATTLESHIP', },
\t\t{ ConditionType = 'NoRushTimeLessThan', ConditionIntegerOne = 300, },
    },",
                    "    Conditions = {
        {
\t\t{ ConditionType = 'BasePoolUnitRatioLessThan', ConditionFloat = 0.40, ConditionCategoryStringOne = 'MOBILE NAVAL BATTLESHIP', ConditionCategoryStringTwo = 'MOBILE NAVAL -BATTLESHIP', },
\t\t{ ConditionType = 'NoRushTimeLessThan', ConditionIntegerOne = 300, },
        },
    },",
                ),
                rep(
                    "porta-aviões: condições válidas",
                    "    Conditions = {
\t\t{ ConditionType = 'CategoryLessThan', ConditionCategoryStringOne = 'NAVALCARRIER', ConditionIntegerOne = 2, },
\t\t{ ConditionType = 'NoRushTimeLessThan', ConditionIntegerOne = 300, },
    },",
                    "    Conditions = {
        {
\t\t{ ConditionType = 'CategoryLessThan', ConditionCategoryStringOne = 'NAVALCARRIER', ConditionIntegerOne = 2, },
\t\t{ ConditionType = 'NoRushTimeLessThan', ConditionIntegerOne = 300, },
        },
    },",
                ),
            ],
        );
        add(
            "lua/AI/ArchetypeEvaluator.lua",
            vec![rep("mar conta até 230 da base", "navalDistance < 150 then", "navalDistance < 230 then")],
        );
        add(
            "lua/AI/skirmish/Archetypes/SAIArchetype_NavalArchetypes.lua",
            vec![rep(
                "IA naval quando a água separa os jogadores",
                "    return returnScore, 'DefaultNavalArchetype'",
                "    -- CommandProject AI: with water between the players, the navy decides the map
    if AIInfo.HasNavalNearby and not AIInfo.LandMap and not AIInfo.NoNaval and AIInfo.Faction != 3 and returnScore > 0 and returnScore < 65 then
        returnScore = 65
    end
    return returnScore, 'DefaultNavalArchetype'",
            )],
        );
        add(
            "lua/AI/skirmish/system/SkirmishAISystem.lua",
            vec![rep(
                "base alcança o mar mais distante",
                "AddSkirmishBase(BaseName, baseLocation, 150)",
                "AddSkirmishBase(BaseName, baseLocation, 230)",
            )],
        );
        add(
            "lua/AI/skirmish/BaseBlueprints/SAIBaseBlueprint_Default.bp",
            vec![rep_all(
                "estaleiro em todos os tipos de base",
                "    BaseItemGroups = {\n",
                "    BaseItemGroups = {\n        'CP Naval Group',\n",
            )],
        );
        add(
            "lua/AI/skirmish/EngineerBuilders/SAIEngineerBuilders_Factories_NavalFocus.bp",
            vec![
                rep(
                    "IA naval Cybran constrói a fábrica aérea",
                    "        'Naval',\n    },\n    UnitToBuild = 'AirGantry',",
                    "        'Naval Factories',\n    },\n    UnitToBuild = 'AirGantry',",
                ),
                (
                    "estaleiros para todos os tipos de IA".into(),
                    Op::Append(format!(
                        "-- CommandProject AI: every archetype builds shipyards when its base is next to water\n{}{}",
                        naval_factory_builder("CP - Need Naval Factory", 1, 4, 1010),
                        naval_factory_builder("CP - Need Naval Factory - 2", 2, 8, 960),
                    )),
                ),
            ],
        );
        for arch in ["Air", "Balanced", "Land", "LandNoTrans", "Rush", "Turtle"] {
            let path: &'static str = match arch {
                "Air" => "lua/AI/skirmish/Archetypes/SAIArchetype_AirArchetypes.bp",
                "Balanced" => "lua/AI/skirmish/Archetypes/SAIArchetype_BalancedArchetypes.bp",
                "Land" => "lua/AI/skirmish/Archetypes/SAIArchetype_LandArchetypes.bp",
                "LandNoTrans" => "lua/AI/skirmish/Archetypes/SAIArchetype_LandArchetypesNoTrans.bp",
                "Rush" => "lua/AI/skirmish/Archetypes/SAIArchetype_RushArchetypes.bp",
                _ => "lua/AI/skirmish/Archetypes/SAIArchetype_TurtleArchetypes.bp",
            };
            add(path, vec![rep("orçamento para navios", NAVAL_UNITS_OFF, NAVAL_UNITS_ON)]);
        }
        add(
            "lua/AI/skirmish/PlatoonTemplates/NavalAttackTemplates.bp",
            vec![rep(
                "frota não sai de navio em navio",
                "BlueprintId = 'NavalAttackTiny',\n    GlobalSquads = {\n        { Category = 'MOBILE NAVAL -EXPERIMENTAL', UnitMin = 1,",
                "BlueprintId = 'NavalAttackTiny',\n    GlobalSquads = {\n        { Category = 'MOBILE NAVAL -EXPERIMENTAL', UnitMin = 3,",
            )],
        );
    }

    if o.economy {
        let engineers = if brutal { "6" } else { "4" };
        add(
            "lua/AI/skirmish/BaseBlueprints/SAIBaseBlueprint_Default.bp",
            vec![
                rep_all("mais engenheiros por base", "MaxEngineers = 2,", &format!("MaxEngineers = {engineers},")),
                rep_all("expande mais cedo (bases)", "MinMassPercentFull = 0.5,", "MinMassPercentFull = 0.4,"),
                rep_all("expande mais cedo (expansões)", "MinMassPercentFull = 0.65,", "MinMassPercentFull = 0.5,"),
                rep_all("expande mais cedo (defensiva)", "MinMassPercentFull = 0.75,", "MinMassPercentFull = 0.6,"),
            ],
        );
        add(
            "lua/AI/skirmish/FactoryBuilders/SAIFactoryBuilders_Engineers.bp",
            vec![rep("fábricas repõem engenheiros em paralelo", "    InstanceCount = 1,", "    InstanceCount = 2,")],
        );
        add(
            "lua/AI/skirmish/EngineerBuilders/SAIEngineerBuilders_Economy.bp",
            vec![
                rep(
                    "várias expansões ao mesmo tempo (mini-bases)",
                    "    PlatoonBehavior = 'EngineerExpansionBase',\n    InstanceCount = 1,",
                    if brutal {
                        "    PlatoonBehavior = 'EngineerExpansionBase',\n    InstanceCount = 3,"
                    } else {
                        "    PlatoonBehavior = 'EngineerExpansionBase',\n    InstanceCount = 2,"
                    },
                ),
                rep(
                    "mais extratores ao mesmo tempo",
                    "    InstanceCount = 2,\n    ItemGroups = {\n        'Default Expansion Item Group',\n        'Default Item Group',\n        'Rush Item Group',\n        'Rush Expansion Item Group',\n    },\n    PlatoonBehavior = 'EngineerBuild',\n    UnitToBuild = 'Resource',\n    BasePriority = 1000,",
                    if brutal {
                        "    InstanceCount = 4,\n    ItemGroups = {\n        'Default Expansion Item Group',\n        'Default Item Group',\n        'Rush Item Group',\n        'Rush Expansion Item Group',\n    },\n    PlatoonBehavior = 'EngineerBuild',\n    UnitToBuild = 'Resource',\n    BasePriority = 1000,"
                    } else {
                        "    InstanceCount = 3,\n    ItemGroups = {\n        'Default Expansion Item Group',\n        'Default Item Group',\n        'Rush Item Group',\n        'Rush Expansion Item Group',\n    },\n    PlatoonBehavior = 'EngineerBuild',\n    UnitToBuild = 'Resource',\n    BasePriority = 1000,"
                    },
                ),
            ],
        );
        add(
            "lua/AI/skirmish/system/SAIResearch.lua",
            vec![rep(
                "pesquisa assim que tem os pontos",
                "GetEconomyStored('RESEARCH') > researchBp.COST",
                "GetEconomyStored('RESEARCH') >= researchBp.COST",
            )],
        );
    }

    if o.commander {
        add(
            "lua/AI/skirmish/PlatoonTemplates/LandAttackTemplates.bp",
            vec![rep(
                "sem ataques de 3 unidades",
                "BlueprintId = 'LandAttackTiny',\n    GlobalSquads = {\n        { Category = 'MOBILE LAND -EXPERIMENTAL -ROGUENANITE -ENGINEER', UnitMin = 3,",
                "BlueprintId = 'LandAttackTiny',\n    GlobalSquads = {\n        { Category = 'MOBILE LAND -EXPERIMENTAL -ROGUENANITE -ENGINEER', UnitMin = 8,",
            )],
        );
        let code = COMMANDER_LUA
            .replace("@LEVEL@", if brutal { "2" } else { "1" })
            .replace("@RAIDS@", if o.raids { "true" } else { "false" });
        add(
            "lua/AI/skirmish/system/SkirmishAISystem.lua",
            vec![
                rep(
                    "comandante estratégico de cada IA",
                    "        ArmyBase:UseSkirmishBaseBlueprint(baseType, true)\n",
                    "        ArmyBase:UseSkirmishBaseBlueprint(baseType, true)\n        ForkThread(CPCommanderRun, self.Brain, baseLocation) -- CommandProject AI\n",
                ),
                ("código do comandante".into(), Op::Append(code)),
            ],
        );
    }
    files
}

// os arquivos do jogo são Latin-1 (©): um byte vira um caractere e volta igual
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().map(|&b| b as char).collect::<String>().replace("\r\n", "\n")
}

fn to_latin1(text: &str) -> Vec<u8> {
    text.chars().map(|c| if (c as u32) < 256 { c as u8 } else { b'?' }).collect()
}

/// Lê o arquivo de IA que o jogo realmente usa: a cópia do DLC1 se existir, senão a do jogo base.
fn resolve(sources: &[PathBuf], path: &str) -> Result<(String, String)> {
    let shadow = format!("{SHADOW}{path}");
    if let Ok(raw) = read_game_file(sources, &format!("/uncompiled/{shadow}")) {
        return Ok((shadow, latin1(&raw)));
    }
    let raw = read_game_file(sources, &format!("/uncompiled/{path}")).map_err(|_| {
        Error::Other(format!(
            "o jogo não tem o {} em texto (uncompiled_lua.scd): não dá para montar a IA",
            path.rsplit('/').next().unwrap_or(path)
        ))
    })?;
    Ok((path.to_string(), latin1(&raw)))
}

fn apply(text: &str, ops: &[(String, Op)], skipped: &mut Vec<String>) -> (String, usize) {
    let mut out = text.to_string();
    let mut applied = 0;
    for (what, op) in ops {
        match op {
            Op::Replace { find, with, all } => {
                let n = out.matches(find.as_str()).count();
                if n == 0 || (!all && n > 1) {
                    skipped.push(what.clone());
                } else {
                    out = out.replace(find.as_str(), with);
                    applied += 1;
                }
            }
            Op::Append(code) => {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
                out.push('\n');
                out.push_str(code);
                applied += 1;
            }
        }
    }
    (out, applied)
}

/// Monta o `.scd` do mod em `dest` com os arquivos do jogo do usuário (`sources`).
pub fn build(sources: &[PathBuf], opts: &AiOptions, dest: &Path) -> Result<AiBuild> {
    let mut skipped = Vec::new();
    let mut applied = 0;
    let mut out: Vec<(String, Vec<u8>)> = Vec::new();
    for f in edits(opts) {
        let (path, text) = resolve(sources, f.path)?;
        if text.contains("CommandProject AI") {
            return Err(Error::Other(format!("o {} do jogo já tem a IA do CommandProject: use o original", f.path)));
        }
        let (patched, n) = apply(&text, &f.ops, &mut skipped);
        // o comandante só entra se o gancho que o inicia entrou
        if f.path.ends_with("SkirmishAISystem.lua") && patched.contains("CPCommanderRun") && !patched.contains("ForkThread(CPCommanderRun") {
            return Err(Error::Other("o SkirmishAISystem.lua do jogo é diferente do esperado: não deu para ligar o comandante".into()));
        }
        if n > 0 {
            applied += n;
            out.push((path, to_latin1(&patched)));
        }
    }
    if out.is_empty() {
        return Err(Error::Other("nenhum ajuste de IA serviu nesta versão do jogo".into()));
    }
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    for (path, data) in &out {
        b.add_bytes(path, data)?;
    }
    Ok(AiBuild { archive: b.finish()?, applied, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_rules() {
        let mut skipped = Vec::new();
        let ops = vec![rep("um", "a = 1", "a = 2"), rep_all("todos", "x", "y"), rep("falta", "nada", "z")];
        let (out, n) = apply("a = 1\nx x\n", &ops, &mut skipped);
        assert_eq!(out, "a = 2\ny y\n");
        assert_eq!(n, 2);
        assert_eq!(skipped, vec!["falta".to_string()]);
        // ambíguo (duas ocorrências) sem `all`: pula
        let mut s2 = Vec::new();
        let (_, n2) = apply("a = 1 a = 1", &[rep("dois", "a = 1", "b")], &mut s2);
        assert_eq!(n2, 0);
        assert_eq!(s2.len(), 1);
    }

    #[test]
    fn latin1_round_trip() {
        let bytes = b"-- Copyright \xa9 2009\r\nx = 1\r\n";
        let t = latin1(bytes);
        assert_eq!(t, "-- Copyright \u{a9} 2009\nx = 1\n");
        assert_eq!(to_latin1(&t), b"-- Copyright \xa9 2009\nx = 1\n");
    }

    #[test]
    fn commander_script_is_filled() {
        let files = edits(&AiOptions { level: 2, raids: false, ..Default::default() });
        let sys = files.iter().find(|f| f.path.ends_with("SkirmishAISystem.lua")).unwrap();
        let code = sys
            .ops
            .iter()
            .find_map(|(_, op)| if let Op::Append(c) = op { Some(c.clone()) } else { None })
            .unwrap();
        assert!(code.contains("local CP_LEVEL = 2") && code.contains("local CP_RAIDS = false"));
        assert!(!code.contains('@') && !code.contains('#') && code.is_ascii());
        // sem comandante e sem navios, o arquivo não é tocado
        let none = edits(&AiOptions { naval: false, commander: false, ..Default::default() });
        assert!(none.iter().all(|f| !f.path.ends_with("SkirmishAISystem.lua")));
    }

    #[test]
    fn prefers_dlc_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("uncompiled_lua.scd");
        crate::library::tests::make_scd(
            &src,
            &[
                ("uncompiled\\lua\\AI\\ArchetypeEvaluator.lua", b"if navalDistance < 150 then end\r\n"),
                ("uncompiled\\lua\\AI\\skirmish\\system\\SkirmishAISystem.lua", b"base"),
                (
                    "uncompiled\\mods\\DLC1\\shadow\\lua\\ai\\skirmish\\system\\SkirmishAISystem.lua",
                    b"local x = AddSkirmishBase(BaseName, baseLocation, 150)\r\n        ArmyBase:UseSkirmishBaseBlueprint(baseType, true)\r\n    end,\r\n",
                ),
            ],
        );
        let (path, text) = resolve(std::slice::from_ref(&src), "lua/AI/skirmish/system/SkirmishAISystem.lua").unwrap();
        assert!(path.starts_with("mods/DLC1/shadow/") && text.contains("AddSkirmishBase"));
        let (path2, _) = resolve(std::slice::from_ref(&src), "lua/AI/ArchetypeEvaluator.lua").unwrap();
        assert_eq!(path2, "lua/AI/ArchetypeEvaluator.lua");
    }
}
