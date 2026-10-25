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
    /// personalidade: `mixed` (cada IA sorteia), `balanced`, `aggressive`, `defensive`, `raider`, `naval`, `airborne`
    pub personality: String,
    /// aviação estratégica (caças, bombardeiros, gunships)
    pub air: bool,
    /// microgestão: foco de fogo e artilharia atrás da linha
    pub micro: bool,
    /// defesa reativa e mini-bases com função (posto avançado, base econômica protegida)
    pub build: bool,
    /// reconhecimento e contra-produção
    pub counter: bool,
    /// coordenação entre IAs aliadas
    pub team: bool,
    /// dificuldade adaptativa
    pub adaptive: bool,
    /// painel "o que a IA está pensando" dentro do jogo
    pub panel: bool,
    /// tecla do painel (uma de [`crate::cheats::MENU_KEYS`])
    pub panel_key: String,
    /// lembra o jeito do jogador entre partidas (em `Game.prefs`, jogando sozinho)
    pub learn: bool,
}

/// Personalidades aceitas (a primeira é o padrão).
pub const PERSONALITIES: &[&str] = &["mixed", "balanced", "aggressive", "defensive", "raider", "naval", "airborne"];

impl Default for AiOptions {
    fn default() -> Self {
        AiOptions {
            level: 1,
            naval: true,
            economy: true,
            commander: true,
            raids: true,
            personality: "mixed".into(),
            air: true,
            micro: true,
            build: true,
            counter: true,
            team: true,
            adaptive: true,
            panel: true,
            panel_key: "F4".into(),
            learn: true,
        }
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
const PANEL_LUA: &str = include_str!("aimod_panel.lua");

impl AiOptions {
    fn personality_key(&self) -> &str {
        PERSONALITIES.iter().copied().find(|p| *p == self.personality).unwrap_or("mixed")
    }
    fn panel_key(&self) -> &str {
        crate::cheats::MENU_KEYS.iter().copied().find(|k| k.eq_ignore_ascii_case(&self.panel_key)).unwrap_or("F4")
    }
}

/// O script do comandante com as opções escolhidas.
pub fn commander_lua(o: &AiOptions) -> String {
    let b = |v: bool| if v { "true" } else { "false" };
    COMMANDER_LUA
        .replace("@LEVEL@", if o.level >= 2 { "2" } else { "1" })
        .replace("@RAIDS@", b(o.raids))
        .replace("@PERSONALITY@", o.personality_key())
        .replace("@AIR@", b(o.air))
        .replace("@MICRO@", b(o.micro))
        .replace("@BUILD@", b(o.build))
        .replace("@COUNTER@", b(o.counter))
        .replace("@TEAM@", b(o.team))
        .replace("@ADAPTIVE@", b(o.adaptive))
        .replace("@STATUS@", b(o.panel))
        .replace("@LEARN@", b(o.learn))
}

/// O script do painel da IA.
pub fn panel_lua(o: &AiOptions) -> String {
    let b = |v: bool| if v { "true" } else { "false" };
    PANEL_LUA.replace("@KEY@", o.panel_key()).replace("@PANEL@", b(o.panel)).replace("@LEARN@", b(o.learn))
}
const SHADOW: &str = "mods/DLC1/shadow/";

enum Op {
    /// troca `find` por `with`; `all` troca todas as ocorrências (senão exige exatamente uma)
    Replace { find: String, with: String, all: bool },
    /// acrescenta no fim do arquivo
    Append(String),
    /// insere `line` antes do `end` (no começo da linha) que fecha a função que começa em `function`
    InsertBeforeEnd { function: String, line: String },
    /// acrescenta no fim se o arquivo ainda não tiver `marker`
    AppendOnce { marker: String, code: String },
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
        let code = commander_lua(o);
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
        if o.learn {
            add(
                "lua/sim/SimCallbacks.lua",
                vec![(
                    "comando que devolve a memória à IA".into(),
                    Op::AppendOnce { marker: "CommandProject callbacks".into(), code: crate::cheats::SHARED_CALLBACKS.into() },
                )],
            );
        }
        if o.panel || o.learn {
            add(
                "lua/ui/game/consoleecho.lua",
                vec![
                    (
                        "painel da IA na tela da partida".into(),
                        Op::InsertBeforeEnd {
                            function: "function CreateConsoleEcho(parent)".into(),
                            line: "\tpcall(CPAIPanelInit) -- CommandProject AI\n".into(),
                        },
                    ),
                    ("código do painel".into(), Op::Append(panel_lua(o))),
                ],
            );
        }
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
            Op::InsertBeforeEnd { function, line } => {
                let close = out.find(function.as_str()).and_then(|p| out[p..].find("\nend").map(|i| p + i + 1));
                match close {
                    Some(at) => {
                        out.insert_str(at, line);
                        applied += 1;
                    }
                    None => skipped.push(what.clone()),
                }
            }
            Op::AppendOnce { marker, code } => {
                if !out.contains(marker.as_str()) {
                    if !out.ends_with('\n') {
                        out.push('\n');
                    }
                    out.push_str(code);
                }
                applied += 1;
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
        if f.path.ends_with("consoleecho.lua") && patched.contains("function CPAIPanelInit") && !patched.contains("pcall(CPAIPanelInit)") {
            continue;
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
        assert!(code.contains("level = 2,") && code.contains("raids = false,") && code.contains("personality = 'mixed',"));
        assert!(!code.contains('@') && !code.contains('#') && code.is_ascii());
        // sem comandante e sem navios, o arquivo não é tocado
        let none = edits(&AiOptions { naval: false, commander: false, ..Default::default() });
        assert!(none.iter().all(|f| !f.path.ends_with("SkirmishAISystem.lua")));
    }

    #[test]
    fn panel_hook_and_script() {
        let mut skipped = Vec::new();
        let ops = vec![(
            "gancho".to_string(),
            Op::InsertBeforeEnd { function: "function CreateConsoleEcho(parent)".into(), line: "\tpcall(CPAIPanelInit)\n".into() },
        )];
        let (out, n) = apply("function CreateConsoleEcho(parent)\n    if a then\n    end\nend\nfunction X()\nend\n", &ops, &mut skipped);
        assert_eq!(n, 1);
        assert!(out.starts_with("function CreateConsoleEcho(parent)\n    if a then\n    end\n\tpcall(CPAIPanelInit)\nend\n"));
        let p = panel_lua(&AiOptions { panel_key: "home".into(), ..Default::default() });
        assert!(p.contains("local KEY = 'Home'") && p.contains("local LEARN = true") && !p.contains('@') && !p.contains('#') && p.is_ascii());
        let c2 = commander_lua(&AiOptions { learn: false, ..Default::default() });
        assert!(c2.contains("learn = false,"));
        // memória ligada: o SimCallbacks.lua leva os comandos compartilhados com as trapaças
        let with = edits(&AiOptions::default());
        assert!(with.iter().any(|f| f.path.ends_with("SimCallbacks.lua")));
        let without = edits(&AiOptions { learn: false, panel: false, ..Default::default() });
        assert!(without.iter().all(|f| !f.path.ends_with("SimCallbacks.lua") && !f.path.ends_with("consoleecho.lua")));
        let c = commander_lua(&AiOptions { personality: "inventada".into(), ..Default::default() });
        assert!(c.contains("personality = 'mixed',") && !c.contains('@'));
        // sem painel e sem memória, o consoleecho.lua não é tocado
        let none = edits(&AiOptions { panel: false, learn: false, ..Default::default() });
        assert!(none.iter().all(|f| !f.path.ends_with("consoleecho.lua")));
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

// ===================================================================== o que a IA aprendeu
/// O que a IA guardou sobre o jogador (no `Game.prefs`, por perfil do jogo).
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiMemoryReport {
    pub path: Option<PathBuf>,
    pub exists: bool,
    pub error: Option<String>,
    pub profiles: Vec<AiMemoryProfile>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiMemoryProfile {
    /// nome do perfil no jogo
    pub name: String,
    /// perfil em uso no jogo
    pub current: bool,
    /// partidas lembradas
    pub games: u32,
    /// estilo (0..1) por chave: rush, turtle, air, naval, raider, eco, tech
    pub style: Vec<(String, f64)>,
    /// primeiro ataque típico, em segundos de partida
    pub first_attack: Option<f64>,
    pub maps: Vec<AiMapMemory>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AiMapMemory {
    /// nome legível do mapa (do caminho do cenário)
    pub map: String,
    pub games: u32,
    /// lugares lembrados: rotas das suas tropas, pontos que você ataca, onde você expande
    pub routes: usize,
    pub hits: usize,
    pub expansions: usize,
}

fn to_json(v: &crate::blueprint::Value) -> serde_json::Value {
    use crate::blueprint::{Key, Value};
    match v {
        Value::Number(n) => serde_json::json!(n),
        Value::Str(s) => serde_json::json!(s),
        Value::Bool(b) => serde_json::json!(b),
        Value::Table { entries, .. } => {
            let mut map = serde_json::Map::new();
            let mut pos = 0;
            for e in entries {
                let key = match &e.key {
                    Some(Key::Name(n)) => n.clone(),
                    Some(Key::Index(i)) => i.to_string(),
                    None => {
                        pos += 1;
                        pos.to_string()
                    }
                };
                map.insert(key, to_json(&e.value));
            }
            serde_json::Value::Object(map)
        }
        _ => serde_json::Value::Null,
    }
}

fn map_label(path: &str) -> String {
    let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
    let stem = file.trim_end_matches(".lua").trim_end_matches("_scenario");
    let label = stem.replace('_', " ");
    if label.is_empty() { "mapa".into() } else { label }
}

/// Lê a memória da IA do texto do `Game.prefs`.
pub fn memory_from_prefs(text: &str) -> Result<Vec<AiMemoryProfile>> {
    let bp = crate::blueprint::parse(&crate::perf::wrap(text))?;
    let root = to_json(&bp.root);
    let profile = &root["profile"];
    let current = profile["current"].as_f64().map(|c| c as i64);
    let mut out = Vec::new();
    if let Some(list) = profile["profiles"].as_object() {
        for (key, p) in list {
            let mem = &p["CPAIMemory"];
            if !mem.is_object() {
                continue;
            }
            let mut style: Vec<(String, f64)> = mem["style"]
                .as_object()
                .map(|m| m.iter().filter_map(|(k, v)| v.as_f64().map(|n| (k.clone(), n.clamp(0.0, 1.0)))).collect())
                .unwrap_or_default();
            style.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
            let count = |v: &serde_json::Value| v.as_object().map(|m| m.len()).unwrap_or(0);
            let mut maps: Vec<AiMapMemory> = mem["maps"]
                .as_object()
                .map(|m| {
                    m.iter()
                        .map(|(path, data)| AiMapMemory {
                            map: map_label(path),
                            games: data["games"].as_f64().unwrap_or(0.0) as u32,
                            routes: count(&data["route"]),
                            hits: count(&data["hit"]),
                            expansions: count(&data["expand"]),
                        })
                        .collect()
                })
                .unwrap_or_default();
            maps.sort_by_key(|m| std::cmp::Reverse(m.games));
            out.push(AiMemoryProfile {
                name: p["Name"].as_str().unwrap_or("perfil").to_string(),
                current: current.map(|c| c.to_string() == *key).unwrap_or(false),
                games: mem["games"].as_f64().unwrap_or(0.0) as u32,
                style,
                first_attack: mem["firstAttack"].as_f64().filter(|v| *v > 0.0),
                maps,
            });
        }
    }
    Ok(out)
}

/// Lê a memória da IA do `Game.prefs` do usuário.
pub fn read_memory(path: Option<&Path>) -> AiMemoryReport {
    let Some(path) = path else {
        return AiMemoryReport { error: Some("não achei a pasta de opções do jogo".into()), ..Default::default() };
    };
    let mut report = AiMemoryReport { path: Some(path.to_path_buf()), exists: path.exists(), ..Default::default() };
    if !report.exists {
        return report;
    }
    match std::fs::read(path) {
        Ok(bytes) => match memory_from_prefs(&String::from_utf8_lossy(&bytes)) {
            Ok(p) => report.profiles = p,
            Err(e) => report.error = Some(format!("não deu para ler o Game.prefs: {e}")),
        },
        Err(e) => report.error = Some(format!("não deu para abrir o Game.prefs: {e}")),
    }
    report
}

#[cfg(test)]
mod memory_tests {
    use super::*;

    #[test]
    fn reads_memory_from_prefs() {
        let text = "profile = {\n    current = 2,\n    profiles = {\n        { Name = 'Outro' },\n        {\n            Name = 'RiqueBitt',\n            CPAIMemory = {\n                games = 3,\n                firstAttack = 250,\n                style = { rush = 0.8, air = 0.35, turtle = 0 },\n                maps = {\n                    ['/maps/sc2_mp_203/sc2_mp_203_scenario.lua'] = {\n                        games = 2,\n                        route = { ['3:4'] = 6.5, ['4:4'] = 2 },\n                        hit = { ['1:1'] = 4 },\n                        expand = {},\n                    },\n                },\n            },\n        },\n    },\n}\noptions = { fidelity = 2 }\n";
        let p = memory_from_prefs(text).unwrap();
        assert_eq!(p.len(), 1);
        let m = &p[0];
        assert_eq!(m.name, "RiqueBitt");
        assert!(m.current);
        assert_eq!(m.games, 3);
        assert_eq!(m.first_attack, Some(250.0));
        assert_eq!(m.style[0], ("rush".to_string(), 0.8));
        assert_eq!(m.maps[0].map, "sc2 mp 203");
        assert_eq!((m.maps[0].games, m.maps[0].routes, m.maps[0].hits), (2, 2, 1));
        // sem memória: lista vazia, sem erro
        assert!(memory_from_prefs("profile = { current = 1, profiles = { { Name = 'x' } } }").unwrap().is_empty());
    }
}
