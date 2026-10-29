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
    /// 1 = esperta, 2 = brutal (mais engenheiros, exército maior e mais paciente), 3 = mestre
    /// (tudo do brutal e o comandante pensa a cada 2 s)
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
    /// agressividade (0,5 a 1,5; 1 = a da personalidade): o ponto de partida do Alsyper
    pub aggression: f32,
    /// quantos bairros e quão rápido (0,5 a 1,5)
    pub districts: f32,
    /// quanto usa aviação (0 a 2)
    pub air_bias: f32,
    /// quanto usa o mar (0 a 2)
    pub naval_bias: f32,
    /// modo treino: dicas na tela do que a IA vai fazer
    pub tips: bool,
    /// a IA fala na tela durante a partida
    pub chat: bool,
}

/// Personalidades aceitas (a primeira é o padrão).
pub const PERSONALITIES: &[&str] = &["mixed", "balanced", "aggressive", "defensive", "raider", "naval", "airborne", "engineer", "blitz", "titan"];

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
            aggression: 1.0,
            districts: 1.0,
            air_bias: 1.0,
            naval_bias: 1.0,
            tips: false,
            chat: true,
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

/// Versão do mod da IA: muda quando o comandante ou os ajustes mudam (o launcher monta de novo
/// sozinho, com as opções salvas, quando a cópia instalada é de outra versão).
pub const MOD_VERSION: &str = "2.4.0";

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
        .replace("@LEVEL@", match o.level { 0 | 1 => "1", 2 => "2", _ => "3" })
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
        .replace("@AGGRESSION@", &num(o.aggression, 0.5, 1.5))
        .replace("@DISTRICTS@", &num(o.districts, 0.5, 1.5))
        .replace("@AIRBIAS@", &num(o.air_bias, 0.0, 2.0))
        .replace("@NAVALBIAS@", &num(o.naval_bias, 0.0, 2.0))
        .replace("@TIPS@", b(o.tips))
        .replace("@CHAT@", b(o.chat))
}

/// número do controle deslizante, dentro da faixa e com duas casas (texto Lua)
fn num(v: f32, lo: f32, hi: f32) -> String {
    let v = if v.is_finite() { v.clamp(lo, hi) } else { 1.0 };
    format!("{:.2}", v)
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
    /// tira `ids` da lista de quem constrói (BuilderIds) nas obras do jogo que têm algum dos
    /// textos de `only_if` (todas, se vazio); obra que ficaria sem ninguém fica como está
    StripBuilders { ids: Vec<String>, only_if: Vec<String> },
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
// uma parte pequena do orçamento: navios quando há mar, sem tirar a economia do exército
const NAVAL_UNITS_ON: &str = "ResourceType = 'NavalUnits',
            MassCap = 120,
            MassPercent = 0.04,
            EnergyCap = 300,
            EnergyPercent = 0.04,";

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
        'uul0002',
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

/// Gabarito de base mais espaçoso: o do jogo põe todos os prédios num quadrado de 60 × 60 (um
/// lugar a cada 2 unidades, sem espaço entre as fábricas). Este espalha os lugares num disco,
/// do centro para fora, a cada `pitch` unidades: entre dois prédios sobra uma rua. No fim, uma
/// faixa mais apertada para a base nunca ficar sem lugar.
pub fn roomy_base_lua(brutal: bool) -> String {
    let (radius, pitch) = if brutal { (92, 10) } else { (80, 10) };
    format!(
        "
-- CommandProject AI: a roomier base (streets between the buildings, growing from the centre)
do
    pcall(function()
        local R, P, R2 = {radius}, {pitch}, {outer}
        local function d2(a) return a[1] * a[1] + a[2] * a[2] end
        local function sorted(spots)
            table.sort(spots, function(a, b)
                local da, db = d2(a), d2(b)
                if da ~= db then return da < db end
                if a[1] ~= b[1] then return a[1] < b[1] end
                return a[2] < b[2]
            end)
            return spots
        end
        local wide, tight = {{}}, {{}}
        for x = -R, R, P do
            for z = -R, R, P do
                if x * x + z * z <= R * R then table.insert(wide, {{ x, z, 0 }}) end
            end
        end
        for x = -R2, R2, 4 do
            for z = -R2, R2, 4 do
                local r = x * x + z * z
                if r > R * R and r <= R2 * R2 then table.insert(tight, {{ x, z, 0 }}) end
            end
        end
        for t = 1, table.getn(BaseTemplates) do
            local old = BaseTemplates[t]
            if type(old) == 'table' and type(old[1]) == 'table' and type(old[1][1]) == 'string' then
                local new = {{ old[1] }}
                for _, s in ipairs(sorted(wide)) do table.insert(new, s) end
                for _, s in ipairs(sorted(tight)) do table.insert(new, s) end
                BaseTemplates[t] = new
            end
        end
    end)
end
",
        radius = radius,
        pitch = pitch,
        outer = radius + 24
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
                        "-- CommandProject AI: every archetype builds a shipyard when its base is next to water\n{}",
                        naval_factory_builder("CP - Need Naval Factory", 1, 6, 900),
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
        // os bairros (com o comandante construindo) usam engenheiros próprios: a base ganha mais
        let engineers = match (brutal, o.build && o.commander) {
            (true, true) if o.level >= 3 => "10",
            (true, true) => "8",
            (true, false) | (false, true) => "6",
            (false, false) => "4",
        };
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

    if o.commander || o.economy {
        // o comandante (ACU) não vai mais construir extratores, estaleiros e defesas longe da
        // base (onde morria): os engenheiros fazem essas obras; ele continua no começo da partida
        let acus: Vec<String> = ["uul0001", "ucl0001", "uil0001"].iter().map(|s| s.to_string()).collect();
        let far: Vec<String> = ["BuildLocation = 'MassPoint'", "BuildLocation = 'NavalMarker'", "BuildLocation = 'DefensivePoint'"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        for path in [
            "lua/AI/skirmish/EngineerBuilders/SAIEngineerBuilders_Economy.bp",
            "lua/AI/skirmish/EngineerBuilders/SAIEngineerBuilders_Defense.bp",
            "lua/AI/skirmish/EngineerBuilders/SAIEngineerBuilders_ExperimentalStructures.bp",
        ] {
            add(path, vec![("comandante não constrói longe da base".into(), Op::StripBuilders { ids: acus.clone(), only_if: far.clone() })]);
        }
    }

    if o.build {
        add(
            "lua/AI/skirmish/BaseTemplates.lua",
            vec![("base com ruas: prédios espalhados".into(), Op::Append(roomy_base_lua(brutal)))],
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

/// Tira construtores das obras (blocos `SkirmishEngineerBlueprint`). Devolve o texto e quantas
/// obras mudaram.
fn strip_builders(text: &str, ids: &[String], only_if: &[String]) -> (String, usize) {
    const HEAD: &str = "SkirmishEngineerBlueprint {";
    let mut out = String::with_capacity(text.len());
    let mut changed = 0;
    let mut rest = text;
    while let Some(start) = rest.find(HEAD) {
        out.push_str(&rest[..start]);
        let after = &rest[start + HEAD.len()..];
        let end = after.find(HEAD).map(|i| start + HEAD.len() + i).unwrap_or(rest.len());
        let block = &rest[start..end];
        let wanted = only_if.is_empty() || only_if.iter().any(|w| block.contains(w.as_str()));
        let is_id = |line: &str| ids.iter().any(|id| line.trim() == format!("'{id}',"));
        if wanted && block.lines().any(is_id) {
            // as linhas de BuilderIds que sobram: só muda se ainda fica alguém para construir
            let ids_start = block.find("BuilderIds = {");
            let ids_end = ids_start.and_then(|i| block[i..].find('}').map(|j| i + j));
            if let (Some(a), Some(b)) = (ids_start, ids_end) {
                let list = &block[a..b];
                let keep = list.lines().skip(1).filter(|l| !l.trim().is_empty() && !is_id(l)).count();
                if keep > 0 {
                    let mut new_block = String::with_capacity(block.len());
                    new_block.push_str(&block[..a]);
                    for piece in list.split_inclusive('\n') {
                        if !is_id(piece) {
                            new_block.push_str(piece);
                        }
                    }
                    new_block.push_str(&block[b..]);
                    out.push_str(&new_block);
                    changed += 1;
                    rest = &rest[end..];
                    continue;
                }
            }
        }
        out.push_str(block);
        rest = &rest[end..];
    }
    out.push_str(rest);
    (out, changed)
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
            Op::StripBuilders { ids, only_if } => {
                let (text, changed) = strip_builders(&out, ids, only_if);
                if changed == 0 {
                    skipped.push(what.clone());
                } else {
                    out = text;
                    applied += 1;
                }
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
    fn commander_placeholders_filled() {
        for o in [AiOptions::default(), AiOptions { level: 3, aggression: 9.0, air_bias: -1.0, tips: true, chat: false, ..Default::default() }] {
            let code = commander_lua(&o);
            assert!(!code.contains('@'), "sobrou marcador no comandante");
            assert!(code.contains("aggression = 1.50") || o.aggression == 1.0);
        }
        assert!(commander_lua(&AiOptions { level: 3, ..Default::default() }).contains("level = 3,"));
        assert!(!panel_lua(&AiOptions::default()).contains("@KEY@"));
    }

    #[test]
    fn acu_off_far_jobs() {
        let text = "SkirmishEngineerBlueprint {\r\n    BlueprintId = 'a',\r\n    BuilderIds = {\r\n        'uul0001',\r\n        'uul0002',\r\n    },\r\n    BuildLocation = 'MassPoint',\r\n}\r\n\r\nSkirmishEngineerBlueprint {\r\n    BlueprintId = 'b',\r\n    BuilderIds = {\r\n        'uul0001',\r\n        'uul0002',\r\n    },\r\n    BuildLocation = 'Base',\r\n}\r\nSkirmishEngineerBlueprint {\r\n    BlueprintId = 'c',\r\n    BuilderIds = {\r\n        'uul0001',\r\n    },\r\n    BuildLocation = 'MassPoint',\r\n}\r\n";
        let ids = vec!["uul0001".to_string()];
        let (out, n) = strip_builders(text, &ids, &["BuildLocation = 'MassPoint'".to_string()]);
        assert_eq!(n, 1);
        let a = &out[..out.find("'b'").unwrap()];
        assert!(!a.contains("'uul0001'") && a.contains("'uul0002',\r\n    },"));
        // a obra na base continua com o comandante; a que ficaria sem ninguém também
        let b = &out[out.find("'b'").unwrap()..out.find("'c'").unwrap()];
        assert!(b.contains("'uul0001'"));
        assert!(out[out.find("'c'").unwrap()..].contains("'uul0001'"));
        // todo o resto igual
        assert_eq!(out.len(), text.len() - "        'uul0001',\r\n".len());
        // o naval só manda engenheiros
        let files = edits(&AiOptions::default());
        let naval = files.iter().find(|f| f.path.ends_with("Factories_NavalFocus.bp")).unwrap();
        assert!(naval.ops.iter().any(|(_, op)| matches!(op, Op::Append(c) if c.contains("'uul0002'") && !c.contains("'uul0001'"))));
    }

    #[test]
    fn roomy_base_template() {
        let files = edits(&AiOptions::default());
        let f = files.iter().find(|f| f.path.ends_with("BaseTemplates.lua")).expect("gabarito da base");
        assert!(matches!(&f.ops[0].1, Op::Append(code) if code.contains("BaseTemplates[t] = new") && code.contains("R, P, R2 = 80, 10, 104")));
        assert!(roomy_base_lua(true).contains("R, P, R2 = 92, 10, 116"));
        let off = edits(&AiOptions { build: false, ..Default::default() });
        assert!(off.iter().all(|f| !f.path.ends_with("BaseTemplates.lua")));
    }

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

    /// Com `CP_GAMEDATA` apontando para a pasta gamedata do jogo (com o uncompiled_lua.scd), monta a IA com os arquivos de verdade:
    /// todos os ajustes entram. Com `CP_AI_OUT`, grava os arquivos montados (para conferir a sintaxe).
    #[test]
    fn real_game_build() {
        let Some(dir) = std::env::var_os("CP_GAMEDATA") else { return };
        let sources = vec![PathBuf::from(dir).join("uncompiled_lua.scd")];
        let opts = AiOptions { level: 2, naval: true, learn: true, panel: true, ..Default::default() };
        let dest = std::env::temp_dir().join("cp_ai_real_test.scd");
        let built = build(&sources, &opts, &dest).unwrap();
        assert!(built.skipped.is_empty(), "ajustes que não entraram: {:?}", built.skipped);
        if let Some(out) = std::env::var_os("CP_AI_OUT") {
            for f in edits(&opts) {
                let (path, text) = resolve(&sources, f.path).unwrap();
                let (patched, _) = apply(&text, &f.ops, &mut Vec::new());
                let target = PathBuf::from(&out).join(path.trim_start_matches('/'));
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                std::fs::write(target, to_latin1(&patched)).unwrap();
            }
        }
        eprintln!("IA montada com {} ajustes", built.applied);
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
    /// genes do Alsyper Adaptador aprendidos até agora (agressão, paciência, expansão…)
    pub genes: Vec<(String, f64)>,
    /// últimas partidas: 1 = o jogador venceu, -1 = a IA venceu
    pub results: Vec<i32>,
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
            const GENES: [&str; 9] = ["aggression", "patience", "expansion", "defense", "scouting", "harass", "tech", "air", "naval"];
            let genes: Vec<(String, f64)> = GENES
                .iter()
                .filter_map(|k| mem["genes"][*k].as_f64().map(|v| (k.to_string(), v.clamp(0.0, 2.0))))
                .collect();
            // a lista do Lua vira objeto {"1": .., "2": ..} ou array
            let mut results: Vec<(usize, i32)> = match &mem["results"] {
                serde_json::Value::Array(a) => a.iter().enumerate().filter_map(|(i, v)| v.as_f64().map(|n| (i, n as i32))).collect(),
                serde_json::Value::Object(o) => o.iter().filter_map(|(k, v)| Some((k.parse::<usize>().ok()?, v.as_f64()? as i32))).collect(),
                _ => Vec::new(),
            };
            results.sort_by_key(|r| r.0);
            let results: Vec<i32> = results.into_iter().map(|r| r.1.signum()).collect();
            out.push(AiMemoryProfile {
                name: p["Name"].as_str().unwrap_or("perfil").to_string(),
                current: current.map(|c| c.to_string() == *key).unwrap_or(false),
                games: mem["games"].as_f64().unwrap_or(0.0) as u32,
                style,
                first_attack: mem["firstAttack"].as_f64().filter(|v| *v > 0.0),
                maps,
                genes,
                results,
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
        let text = "profile = {\n    current = 2,\n    profiles = {\n        { Name = 'Outro' },\n        {\n            Name = 'RiqueBitt',\n            CPAIMemory = {\n                games = 3,\n                firstAttack = 250,\n                style = { rush = 0.8, air = 0.35, turtle = 0 },\n                genes = { aggression = 1.3, air = 0.8 },\n                results = { 1, -1, 1 },\n                maps = {\n                    ['/maps/sc2_mp_203/sc2_mp_203_scenario.lua'] = {\n                        games = 2,\n                        route = { ['3:4'] = 6.5, ['4:4'] = 2 },\n                        hit = { ['1:1'] = 4 },\n                        expand = {},\n                    },\n                },\n            },\n        },\n    },\n}\noptions = { fidelity = 2 }\n";
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
        assert_eq!(m.genes, vec![("aggression".to_string(), 1.3), ("air".to_string(), 0.8)]);
        assert_eq!(m.results, vec![1, -1, 1]);
        // sem memória: lista vazia, sem erro
        assert!(memory_from_prefs("profile = { current = 1, profiles = { { Name = 'x' } } }").unwrap().is_empty());
    }
}
