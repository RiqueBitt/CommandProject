//! **Partida grande**: escaramuça com quantos jogadores o mapa tiver (12 contra 12, 3 times de 5,
//! todos contra todos...), cada vaga sendo você, uma IA ou vazia, no time que quiser.
//!
//! O lobby do jogo tem 8 vagas e é desenhado em Flash (não dá para mudar). O jogo, porém, sabe
//! começar uma escaramuça direto pela linha de comando (`/map <cenário>`, `StartCommandLineSession`
//! em `SinglePlayerLaunch.lua` e `GameSessionManager.lua`), usando todas as bases do mapa. O mod
//! leva, dentro desses dois arquivos do próprio jogo do usuário, o código que lê `/cpmatch <vagas>`
//! e monta a partida do jeito escolhido no launcher; sem `/cpmatch` o jogo segue como sempre.

use crate::error::{Error, Result};
use crate::mapassets::read_game_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MARK: &str = "CommandProject big match";
const CODE: &str = include_str!("bigmatch.lua");
/// Arquivos que o jogo usa para começar uma partida pela linha de comando.
const FILES: &[&str] = &["lua/SinglePlayerLaunch.lua", "lua/GameSessionManager.lua"];
const ENTRY: &str = "function StartCommandLineSession(mapName, isPerfTest)\n";
const HOOK: &str = "\tif CPBigMatchStart and CPBigMatchStart(mapName) then return end -- CommandProject big match\n";

/// Versão do código do mod: quando muda, o launcher monta o mod de novo.
pub const MOD_VERSION: &str = "1.6.0";
/// Cores de exército na partida grande: as 10 do jogo e mais 14 (o mod acrescenta só com `/cpmatch`).
pub const COLORS: i32 = 32;
/// Mapas com mais de 8 bases são gravados com este tipo: o lobby do jogo (8 posições, que trava com
/// mais) não os mostra; a partida grande os trata como escaramuça.
pub const BIG_MAP_TYPE: &str = "cp_bigmatch";
const COLORS_CODE: &str = include_str!("bigmatch_colors.lua");
const COLORS_FILE: &str = "lua/common/GameColors.lua";
const COLORS_MARK: &str = "CommandProject big match: 22 more army colors";
/// Dificuldades da IA do jogo (chaves de `aitypes.lua`).
pub const AI_LEVELS: &[&str] = &["Easy", "Normal", "Hard", "Cheat"];
/// Limite de vagas que o launcher aceita (o motor do jogo pode ter um limite menor: veja o README).
pub const MAX_SLOTS: usize = 64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SlotKind {
    You,
    #[default]
    Ai,
    Empty,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Slot {
    pub kind: SlotKind,
    /// 0 = sozinho (todos contra todos); 1, 2, 3... = times
    pub team: u32,
    /// 0 = aleatória, 1 = UEF, 2 = Cybran, 3 = Illuminate
    pub faction: u32,
    /// dificuldade da IA (uma de [`AI_LEVELS`])
    pub ai: String,
    /// cor do exército (0 a [`COLORS`]-1, na ordem do jogo); -1 = a da base
    pub color: i32,
}

impl Default for Slot {
    fn default() -> Self {
        Slot { kind: SlotKind::Ai, team: 0, faction: 0, ai: "Normal".into(), color: -1 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct MatchOptions {
    /// `demoralization` (destruir o comandante), `domination` (destruir tudo) ou `sandbox`
    pub victory: String,
    /// limite de unidades por jogador
    pub unit_cap: u32,
    /// `explored`, `unexplored` ou `none`
    pub fog: String,
    /// `normal`, `fast` ou `adjustable`
    pub speed: String,
    /// minutos sem ataque no começo (0 = desligado)
    pub no_rush: u32,
    /// começar com a base montada
    pub prebuilt: bool,
    /// civis do mapa: `enemy`, `neutral` ou `removed`
    pub civilians: String,
}

impl Default for MatchOptions {
    fn default() -> Self {
        MatchOptions {
            victory: "demoralization".into(),
            unit_cap: 500,
            fog: "explored".into(),
            speed: "normal".into(),
            no_rush: 0,
            prebuilt: false,
            civilians: "enemy".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct BigMatch {
    /// cenário (`/maps/X/X_scenario.lua`)
    pub map: String,
    /// uma vaga por base do mapa, na ordem das bases
    pub slots: Vec<Slot>,
    pub options: MatchOptions,
}

fn pick<'a>(value: &'a str, allowed: &[&'a str], what: &str) -> Result<&'a str> {
    allowed
        .iter()
        .find(|a| a.eq_ignore_ascii_case(value))
        .copied()
        .ok_or_else(|| Error::Other(format!("{what} inválido: {value}")))
}

fn color(c: i32) -> String {
    if c < 0 { String::new() } else { c.min(COLORS - 1).to_string() }
}

/// Confere a partida e escreve o texto de `/cpmatch` (sem espaços: vai como um argumento só).
pub fn encode(m: &BigMatch) -> Result<String> {
    let o = &m.options;
    if m.slots.len() > MAX_SLOTS {
        return Err(Error::Other(format!("no máximo {MAX_SLOTS} vagas")));
    }
    let you = m.slots.iter().filter(|s| s.kind == SlotKind::You).count();
    if you != 1 {
        return Err(Error::Other("escolha exatamente uma vaga para você".into()));
    }
    let players = m.slots.iter().filter(|s| s.kind != SlotKind::Empty).count();
    if players < 2 {
        return Err(Error::Other("a partida precisa de pelo menos 2 jogadores".into()));
    }
    // alguém precisa ser inimigo: todos no mesmo time não tem graça (nem fim)
    let teams: std::collections::BTreeSet<u32> =
        m.slots.iter().filter(|s| s.kind != SlotKind::Empty).map(|s| s.team).collect();
    if teams.len() == 1 && !teams.contains(&0) {
        return Err(Error::Other("todos estão no mesmo time: separe em pelo menos dois".into()));
    }
    let mut out = format!(
        "Victory={};UnitCap={};FogOfWar={};GameSpeed={};NoRushOption={};PreBuiltUnits={};CivilianAlliance={}",
        pick(&o.victory, &["demoralization", "domination", "sandbox"], "tipo de vitória")?,
        o.unit_cap.clamp(50, 5000),
        pick(&o.fog, &["explored", "unexplored", "none"], "névoa")?,
        pick(&o.speed, &["normal", "fast", "adjustable"], "velocidade")?,
        if o.no_rush == 0 { "Off".to_string() } else { o.no_rush.min(60).to_string() },
        if o.prebuilt { "On" } else { "Off" },
        pick(&o.civilians, &["enemy", "neutral", "removed"], "civis")?,
    );
    for s in &m.slots {
        // no jogo o time 1 é "sozinho" e os times de verdade começam no 2
        let team = if s.team == 0 { 1 } else { s.team.min(MAX_SLOTS as u32) + 1 };
        let faction = if s.faction > 3 { 0 } else { s.faction };
        match s.kind {
            SlotKind::Empty => out.push_str("|X"),
            SlotKind::You => out.push_str(&format!("|H,{team},{faction},,{}", color(s.color))),
            SlotKind::Ai => out.push_str(&format!("|A,{team},{faction},{},{}", pick(&s.ai, AI_LEVELS, "dificuldade da IA")?, color(s.color))),
        }
    }
    Ok(out)
}

/// Argumentos extras do usuário sem `/map`, `/cpmatch` e `/cpno…` (com os valores): a partida grande
/// põe os dela, e um `/map` esquecido antes do dela venceria (o jogo usa o primeiro).
pub fn clean_user_args(args: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    let mut skip = false;
    for a in args {
        if skip {
            skip = false;
            continue;
        }
        let l = a.to_ascii_lowercase();
        if l == "/map" || l == "/cpmatch" {
            skip = true;
            continue;
        }
        if l.starts_with("/cpno") {
            continue;
        }
        out.push(a.clone());
    }
    out
}

/// Argumentos de linha de comando que começam a partida.
pub fn launch_args(m: &BigMatch) -> Result<Vec<String>> {
    let map = m.map.trim();
    if !map.starts_with("/maps/") || !map.to_ascii_lowercase().ends_with("_scenario.lua") || map.contains(char::is_whitespace) {
        return Err(Error::Other(format!("cenário inválido: {map}")));
    }
    Ok(vec!["/map".into(), map.to_string(), "/cpmatch".into(), encode(m)?])
}

// ---------------------------------------------------------------- o mod

fn game_text(sources: &[PathBuf], path: &str) -> Result<String> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let raw = read_game_file(sources, &format!("/uncompiled/{path}"))
        .map_err(|_| Error::Other(format!("o jogo não tem o {name} em texto (uncompiled_lua.scd): não dá para montar a partida grande")))?;
    if crate::lua::inspect(&raw).compiled {
        return Err(Error::Other(format!("o {name} do jogo está compilado: não dá para montar a partida grande")));
    }
    // Latin-1: um byte vira um caractere e volta igual
    Ok(raw.iter().map(|&b| b as char).collect::<String>().replace("\r\n", "\n"))
}

/// Põe o gancho no começo de `StartCommandLineSession` e o código no fim do arquivo.
pub fn patch(text: &str) -> Result<String> {
    if text.contains(MARK) {
        return Err(Error::Other("o arquivo do jogo já tem a partida grande: use o original".into()));
    }
    let at = text
        .find(ENTRY)
        .ok_or_else(|| Error::Other("o jogo não tem StartCommandLineSession onde esperado: não dá para montar a partida grande".into()))?
        + ENTRY.len();
    let mut out = String::with_capacity(text.len() + CODE.len() + 200);
    out.push_str(&text[..at]);
    out.push_str(HOOK);
    out.push_str(&text[at..]);
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(CODE);
    Ok(out)
}

/// `GameColors.lua` com as cores a mais no fim (só valem com `/cpmatch`).
pub fn patch_colors(text: &str) -> Result<String> {
    if text.contains(COLORS_MARK) {
        return Err(Error::Other("o GameColors.lua do jogo já tem as cores da partida grande: use o original".into()));
    }
    if !text.contains("FactionColors") {
        return Err(Error::Other("o GameColors.lua do jogo é diferente do esperado".into()));
    }
    let mut out = text.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(COLORS_CODE);
    Ok(out)
}

/// Monta o `.scd` do mod com os arquivos do jogo do usuário.
pub fn build(sources: &[PathBuf], dest: &Path) -> Result<PathBuf> {
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    let colors = patch_colors(&game_text(sources, COLORS_FILE)?)?;
    b.add_bytes(COLORS_FILE, &colors.chars().map(|c| if (c as u32) < 256 { c as u8 } else { b'?' }).collect::<Vec<u8>>())?;
    for f in FILES {
        let text = patch(&game_text(sources, f)?)?;
        let bytes: Vec<u8> = text.chars().map(|c| if (c as u32) < 256 { c as u8 } else { b'?' }).collect();
        b.add_bytes(f, &bytes)?;
    }
    b.finish()
}

// ---------------------------------------------------------------- mapas

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MatchMap {
    /// cenário (`/maps/X/X_scenario.lua`)
    pub path: String,
    pub id: String,
    pub name: String,
    /// bases (exércitos) do mapa, em ordem
    pub armies: Vec<String>,
    /// posição de cada base (x, z), quando o cenário diz
    pub starts: Vec<[f64; 2]>,
    pub size: [u32; 2],
    /// de onde veio: "Jogo" ou o nome do mod
    pub source: String,
    /// mais de 8 bases e ainda visível no lobby do jogo (que trava com ele): refazer no editor
    pub lobby_risk: bool,
}

fn quoted_after<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    let mut from = 0;
    while let Some(i) = text[from..].find(key) {
        let at = from + i;
        from = at + key.len();
        // a chave inteira (não `devname` quando se procura `name`)
        let before = text[..at].chars().next_back();
        if before.is_some_and(|c| c.is_alphanumeric() || c == '_') {
            continue;
        }
        let rest = text[from..].trim_start();
        let Some(rest) = rest.strip_prefix('=') else { continue };
        let rest = rest.trim_start();
        let q = rest.chars().next()?;
        if q != '\'' && q != '"' {
            continue;
        }
        let end = rest[1..].find(q)?;
        return Some(&rest[1..1 + end]);
    }
    None
}

fn numbers(s: &str) -> Vec<f64> {
    s.split(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-'))
        .filter_map(|t| t.parse().ok())
        .collect()
}

/// Nome, tipo, tamanho, bases e onde ficam.
pub type ScenarioSummary = (String, String, [u32; 2], Vec<String>, Vec<[f64; 2]>);

/// Lê o essencial de um `_scenario.lua` (nome, tipo, tamanho, bases e onde ficam).
pub fn parse_scenario(text: &str) -> Option<ScenarioSummary> {
    let name = quoted_after(text, "name").unwrap_or("").to_string();
    // tira a marca de tradução: '<LOC SC2_MAPNAME_0050>[3] Shiva Prime (FFA)'
    let name = match (name.starts_with("<LOC"), name.find('>')) {
        (true, Some(i)) => name[i + 1..].trim().to_string(),
        _ => name,
    };
    let kind = quoted_after(text, "type").unwrap_or("skirmish").to_string();
    let size = text
        .find("size")
        .and_then(|i| text[i..].find('{').map(|j| i + j))
        .and_then(|i| text[i..].find('}').map(|j| numbers(&text[i..i + j])))
        .filter(|n| n.len() >= 2)
        .map(|n| [n[0] as u32, n[1] as u32])
        .unwrap_or([0, 0]);
    let a = text.find("armies")?;
    let open = a + text[a..].find('{')?;
    let close = open + text[open..].find('}')?;
    let armies: Vec<String> = text[open + 1..close]
        .split(',')
        .map(|t| t.trim().trim_matches(|c| c == '\'' || c == '"').to_string())
        .filter(|t| !t.is_empty())
        .collect();
    if armies.is_empty() {
        return None;
    }
    let starts = armies
        .iter()
        .map(|army| {
            let key = format!("['{army}']");
            text.find(&key)
                .and_then(|i| {
                    let s = i + key.len();
                    let open = s + text[s..].find('{')?;
                    let close = open + text[open..].find('}')?;
                    let n = numbers(&text[open..close]);
                    (n.len() >= 3).then(|| [n[0], n[2]])
                })
                .unwrap_or([f64::NAN, f64::NAN])
        })
        .collect::<Vec<_>>();
    let starts = if starts.iter().all(|p| p[0].is_finite()) { starts } else { Vec::new() };
    Some((name, kind, size, armies, starts))
}

/// Mapas de escaramuça de um conjunto de `.scd` (`source` = de onde vieram).
pub fn maps_in(archives: &[PathBuf], source: &str, out: &mut Vec<MatchMap>) {
    for a in archives {
        let Ok(mut scd) = crate::scd::Scd::open(a) else { continue };
        let Ok(entries) = scd.entries() else { continue };
        for e in entries {
            let key = e.key.strip_prefix("/uncompiled").unwrap_or(&e.key).to_string();
            if e.is_dir || !key.starts_with("/maps/") || !key.ends_with("_scenario.lua") {
                continue;
            }
            let Ok(raw) = scd.read(&e.name) else { continue };
            let text: String = raw.iter().map(|&b| b as char).collect();
            let Some((name, kind, size, armies, starts)) = parse_scenario(&text) else { continue };
            if kind != "skirmish" && kind != BIG_MAP_TYPE {
                continue;
            }
            // o jogo não diferencia maiúsculas nos caminhos
            let path = key;
            if out.iter().any(|m| m.path.eq_ignore_ascii_case(&path)) {
                // um mod que troca o mapa do jogo: vale o do mod
                out.retain(|m| !m.path.eq_ignore_ascii_case(&path));
            }
            let id = path.rsplit('/').next().unwrap_or("").trim_end_matches("_scenario.lua").to_string();
            let armies_len = armies.len();
            out.push(MatchMap {
                name: if name.is_empty() { id.clone() } else { name },
                id,
                path,
                armies,
                starts,
                size,
                source: source.to_string(),
                lobby_risk: kind == "skirmish" && armies_len > 8,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCEN: &str = "version = 3\nScenarioInfo = {\n    devname = 'MP_306: 3 Player FFA LAND',\n    name = '<LOC SC2_MAPNAME_0050>[3] Shiva Prime (FFA)',\n    type = 'skirmish',\n    size = {1024, 1024},\n    StartPositions = {\n    \t\t\t['ARMY_1'] = { 379.5, 267.18, 642.5 },\n                ['ARMY_2'] = { 440.5, 274.522, 341.5 },\n                ['ARMY_3'] = { 680.5, 274.514, 578.5 },\n    },\n    Configurations = {\n        ['standard'] = {\n            teams = {\n                { name = 'FFA', armies = {'ARMY_1','ARMY_2','ARMY_3',} },\n            },\n            customprops = {\n                ['ExtraArmies'] = STRING( 'ARMY_EXTRA' ),\n            },\n        },\n    }}\n";

    #[test]
    fn reads_scenario() {
        let (name, kind, size, armies, starts) = parse_scenario(SCEN).unwrap();
        assert_eq!(name, "[3] Shiva Prime (FFA)");
        assert_eq!(kind, "skirmish");
        assert_eq!(size, [1024, 1024]);
        assert_eq!(armies, vec!["ARMY_1", "ARMY_2", "ARMY_3"]);
        assert_eq!(starts[2], [680.5, 578.5]);
    }

    fn slot(kind: SlotKind, team: u32) -> Slot {
        Slot { kind, team, ..Default::default() }
    }

    #[test]
    fn encodes_teams() {
        let m = BigMatch {
            map: "/maps/X/X_scenario.lua".into(),
            slots: vec![slot(SlotKind::You, 1), slot(SlotKind::Ai, 1), slot(SlotKind::Ai, 2), slot(SlotKind::Empty, 0), slot(SlotKind::Ai, 2)],
            options: MatchOptions { no_rush: 5, ..Default::default() },
        };
        let s = encode(&m).unwrap();
        assert!(s.starts_with("Victory=demoralization;UnitCap=500;FogOfWar=explored;GameSpeed=normal;NoRushOption=5;"));
        assert!(s.ends_with("|H,2,0,,|A,2,0,Normal,|A,3,0,Normal,|X|A,3,0,Normal,"), "{s}");
        assert!(!s.contains(' '));
        let args = launch_args(&m).unwrap();
        assert_eq!(args[..3], ["/map", "/maps/X/X_scenario.lua", "/cpmatch"]);

        // erros: sem você, dois você, um time só, opção estranha
        let mut bad = m.clone();
        bad.slots[0].kind = SlotKind::Ai;
        assert!(encode(&bad).is_err());
        bad.slots[1].kind = SlotKind::You;
        bad.slots[2].kind = SlotKind::You;
        assert!(encode(&bad).is_err());
        let mut same = m.clone();
        for s in &mut same.slots {
            s.team = 1;
        }
        assert!(encode(&same).is_err());
        let mut odd = m.clone();
        odd.options.victory = "x;Cheats=true".into();
        assert!(encode(&odd).is_err());
        let mut path = m.clone();
        path.map = "/maps/a b/x_scenario.lua".into();
        assert!(launch_args(&path).is_err());
        // todos contra todos: vale
        let mut ffa = m;
        for s in &mut ffa.slots {
            s.team = 0;
        }
        assert!(encode(&ffa).unwrap().contains("|H,1,0,,|A,1,0,Normal,"));
        // cor escolhida (0-based, até 31)
        let mut colored = ffa.clone();
        colored.slots[1].color = 40;
        colored.slots[0].color = 3;
        let e = encode(&colored).unwrap();
        assert!(e.contains("|H,1,0,,3|A,1,0,Normal,31"), "{e}");
    }

    #[test]
    fn user_args_cleaned() {
        let a: Vec<String> = ["/log", "x.log", "/map", "/maps/a/a_scenario.lua", "/cpnocolors", "/CPMATCH", "v", "/windowed"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(clean_user_args(&a), vec!["/log", "x.log", "/windowed"]);
    }

    #[test]
    fn patch_hooks_start() {
        let src = "local defaultOptions = {}\nfunction StartCommandLineSession(mapName, isPerfTest)\n\tif not mapName then\n\tend\nend\n";
        let out = patch(src).unwrap();
        assert!(out.contains("function StartCommandLineSession(mapName, isPerfTest)\n\tif CPBigMatchStart and CPBigMatchStart(mapName) then return end"));
        assert!(out.contains("function CPBigMatchSession(mapName, spec)"));
        assert!(patch(&out).is_err());
        assert!(patch("x = 1").is_err());
    }

    /// Com `CP_GAMEDATA` (pasta com o uncompiled_lua.scd do jogo): os dois arquivos aceitam o gancho.
    #[test]
    fn real_game_files() {
        let Some(dir) = std::env::var_os("CP_GAMEDATA") else { return };
        let sources = vec![PathBuf::from(dir).join("uncompiled_lua.scd")];
        for f in FILES {
            let out = patch(&game_text(&sources, f).unwrap()).unwrap();
            if let Some(o) = std::env::var_os("CP_BIG_OUT") {
                let p = PathBuf::from(o).join(f);
                std::fs::create_dir_all(p.parent().unwrap()).unwrap();
                std::fs::write(p, out.chars().map(|c| c as u8).collect::<Vec<u8>>()).unwrap();
            }
        }
        let colors = patch_colors(&game_text(&sources, COLORS_FILE).unwrap()).unwrap();
        if let Some(o) = std::env::var_os("CP_BIG_OUT") {
            let p = PathBuf::from(o).join(COLORS_FILE);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, colors.chars().map(|c| c as u8).collect::<Vec<u8>>()).unwrap();
        }
        let mut maps = Vec::new();
        maps_in(&sources, "Jogo", &mut maps);
        assert!(maps.len() >= 10, "{}", maps.len());
        assert!(maps.iter().all(|m| m.path.starts_with("/maps/") && !m.armies.is_empty()));
    }
}
