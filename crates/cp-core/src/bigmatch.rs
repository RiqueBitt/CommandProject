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
pub const MOD_VERSION: &str = "1.13.0";
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
/// Limite de vagas que o launcher aceita num mapa (o editor faz até 64 bases).
pub const MAX_SLOTS: usize = 64;
/// Exércitos que o motor do jogo aguenta numa partida, contando os civis do mapa: 24 jogadores e os
/// civis (25) jogaram normalmente; 32 jogadores e os civis (33) fecharam o jogo ao carregar, como
/// esperado de um motor que guarda os exércitos em máscaras de 32 bits. O mod deixa os civis de fora
/// quando eles passariam do limite, e o launcher não começa partidas com mais jogadores que isso.
pub const MAX_ARMIES: usize = 32;
/// jogadores × (lado do mapa / 1024)² que cabem na memória do jogo (32 bits, até 4 GB): testado num
/// PC de verdade, 32 jogadores em 2048 e 16 em 4096 abrem a partida; 24 e 32 em 4096 fecham o jogo
/// logo depois de criar os exércitos, sem relatório de erro. Igual a `src/lib/matchLimits.ts`.
pub const MEMORY_BUDGET: f64 = 256.0;

/// Máximo de jogadores numa partida num mapa com esse lado.
pub fn max_players_for(size: u32) -> usize {
    let area = (size.max(1024) as f64 / 1024.0).powi(2);
    ((MEMORY_BUDGET / area + 1e-9).floor() as usize).clamp(2, MAX_ARMIES)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SlotKind {
    You,
    #[default]
    Ai,
    Empty,
    /// base de um amigo convidado (partida com convite): vira IA se ninguém entrar
    Guest,
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
    /// restrições de unidades do lobby do jogo (chaves de [`RESTRICTIONS`])
    pub restrictions: Vec<String>,
    /// trapaças do console do jogo liberadas (`CheatsEnabled`)
    pub cheats: bool,
    /// quando um jogador morre, o limite de unidades dele passa para os aliados
    pub share_unit_cap: bool,
    /// clima: vazio (limpo), `rain`, `storm`, `blizzard`, `fog` ou `sandstorm` (mod Climas, montado para a partida)
    pub weather: String,
    /// quantidade de chuva ou neve (1 = normal; de 0,4 a 2)
    pub weather_amount: f32,
    /// o clima vai e volta durante a partida (o mesmo roteiro para todos os jogadores)
    pub weather_dynamic: bool,
    /// som do clima dentro do jogo (vento e mar do próprio jogo)
    pub weather_sound: bool,
}

/// Restrições de unidades do lobby do jogo (`/lua/ui/lobby/restrictedUnitsData.lua`), na ordem da tela.
pub const RESTRICTIONS: &[&str] = &[
    "EXPERIMENTALS", "AIR", "LAND", "NAVAL", "NUKE", "ARTILLERY", "SHIELDS", "INTEL", "ADDONS", "MASSCONVERT",
    "NO_DLC", "SLOW_RESEARCH", "ALL_RESEARCH_UNITS", "ALL_RESEARCH",
];

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
            restrictions: Vec::new(),
            cheats: false,
            share_unit_cap: false,
            weather: String::new(),
            weather_amount: 1.0,
            weather_dynamic: false,
            weather_sound: true,
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
    /// lado do mapa (0 = não informado): confere o limite de jogadores pela memória do jogo
    pub size: u32,
    /// partida com amigos pela rede (convite): `None` = partida sozinho, como sempre
    #[serde(skip_serializing_if = "Option::is_none")]
    pub net: Option<Net>,
}

/// Papel nesta partida com amigos: quem convida abre a porta, quem entra conecta direto nela.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Net {
    /// true = anfitrião (abre a porta); false = entra no endereço do convite
    pub host: bool,
    /// porta UDP do anfitrião
    pub port: u16,
    /// endereço do anfitrião (`ip:porta`), só para quem entra
    pub address: String,
    /// nome mostrado aos outros
    pub name: String,
}

/// Porta padrão das partidas com amigos (a mesma do jogo para partidas pela rede).
pub const DEFAULT_PORT: u16 = 15000;

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

/// Clima escolhido (`None` = limpo).
pub fn weather_of(o: &MatchOptions) -> Result<Option<crate::weather::Kind>> {
    let w = o.weather.trim();
    if w.is_empty() || w.eq_ignore_ascii_case("none") || w.eq_ignore_ascii_case("clear") {
        return Ok(None);
    }
    crate::weather::Kind::parse(w).map(Some).ok_or_else(|| Error::Other(format!("clima inválido: {w}")))
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
    if players > MAX_ARMIES {
        return Err(Error::Other(format!(
            "o jogo aguenta no máximo {MAX_ARMIES} jogadores numa partida ({players} escolhidos): deixe {} base(s) vazia(s)",
            players - MAX_ARMIES
        )));
    }
    if m.size > 0 && players > max_players_for(m.size) {
        let max = max_players_for(m.size);
        return Err(Error::Other(format!(
            "num mapa de {} o jogo aguenta até {max} jogadores (com mais, fica sem memória e fecha): deixe {} base(s) vazia(s)",
            m.size,
            players - max
        )));
    }
    if players < 2 {
        return Err(Error::Other("a partida precisa de pelo menos 2 jogadores".into()));
    }
    // alguém precisa ser inimigo: todos no mesmo time não tem graça (nem fim)
    let teams: std::collections::BTreeSet<u32> =
        m.slots.iter().filter(|s| s.kind != SlotKind::Empty).map(|s| s.team).collect();
    if teams.len() == 1 && !teams.contains(&0) {
        return Err(Error::Other("todos estão no mesmo time: separe em pelo menos dois".into()));
    }
    let mut restrictions: Vec<&str> = Vec::new();
    for r in &o.restrictions {
        let key = pick(r, RESTRICTIONS, "restrição")?;
        if !restrictions.contains(&key) {
            restrictions.push(key);
        }
    }
    // "sem pesquisa" tem duas versões: fica a mais ampla (tudo liberado)
    if restrictions.contains(&"ALL_RESEARCH") {
        restrictions.retain(|r| *r != "ALL_RESEARCH_UNITS");
    }
    let prebuilt = if o.prebuilt { "On" } else { "Off" };
    let mut out = format!(
        "Victory={};UnitCap={};FogOfWar={};GameSpeed={};NoRushOption={};PreBuiltUnits={prebuilt};PrebuiltUnits={prebuilt};CivilianAlliance={};CheatsEnabled={};DoNotShareUnitCap={}",
        pick(&o.victory, &["demoralization", "domination", "sandbox"], "tipo de vitória")?,
        o.unit_cap.clamp(50, 5000),
        pick(&o.fog, &["explored", "unexplored", "none"], "névoa")?,
        pick(&o.speed, &["normal", "fast", "adjustable"], "velocidade")?,
        if o.no_rush == 0 { "Off".to_string() } else { o.no_rush.min(60).to_string() },
        pick(&o.civilians, &["enemy", "neutral", "removed"], "civis")?,
        o.cheats,
        !o.share_unit_cap,
    );
    if !restrictions.is_empty() {
        out.push_str(&format!(";RestrictedCategories={}", restrictions.join(",")));
    }
    if let Some(kind) = weather_of(o)? {
        out.push_str(&format!(";CPWeather={}", kind.key()));
        if o.weather_dynamic {
            out.push_str(";CPWeatherDynamic=1");
        }
        if !o.weather_sound {
            out.push_str(";CPWeatherSound=0");
        }
    }
    for s in &m.slots {
        // no jogo o time 1 é "sozinho" e os times de verdade começam no 2
        let team = if s.team == 0 { 1 } else { s.team.min(MAX_SLOTS as u32) + 1 };
        let faction = if s.faction > 3 { 0 } else { s.faction };
        match s.kind {
            SlotKind::Empty => out.push_str("|X"),
            SlotKind::You => out.push_str(&format!("|H,{team},{faction},,{}", color(s.color))),
            SlotKind::Guest => out.push_str(&format!("|G,{team},{faction},,{}", color(s.color))),
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
        if l == "/map" || l == "/cpmatch" || l == "/cphost" || l == "/cpjoin" || l == "/cpname" {
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
    let mut args = vec!["/map".into(), map.to_string(), "/cpmatch".into(), encode(m)?];
    if let Some(n) = &m.net {
        if n.host {
            if !m.slots.iter().any(|s| s.kind == SlotKind::Guest) {
                return Err(Error::Other("marque pelo menos uma vaga como Amigo para convidar alguém".into()));
            }
            args.extend(["/cphost".into(), n.port.max(1).to_string()]);
        } else {
            let a = n.address.trim();
            if a.is_empty() || a.contains(char::is_whitespace) || !a.contains(':') {
                return Err(Error::Other(format!("endereço do anfitrião inválido: {a}")));
            }
            args.extend(["/cpjoin".into(), a.to_string()]);
        }
        // o nome vai como um argumento só: sem espaços
        let name: String = n.name.trim().chars().map(|c| if c.is_whitespace() { '_' } else { c }).take(24).collect();
        if !name.is_empty() {
            args.extend(["/cpname".into(), name]);
        }
    }
    Ok(args)
}

// ---------------------------------------------------------------- log do jogo

/// Nome do log que o jogo grava nas partidas grandes (`/log`), na pasta de dados do launcher.
pub const LOG_FILE: &str = "partida-grande.log";

/// O que o log do jogo diz sobre uma partida grande que fechou.
#[derive(Debug, Clone, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct LogReport {
    /// o jogo terminou normalmente (grava "Run time:" ao sair)
    pub finished: bool,
    /// a partida grande montou a partida (antes disso o jogo ainda estava abrindo)
    pub started: bool,
    /// jogadores e tamanho do mapa que a partida grande registrou
    pub players: Option<u32>,
    pub size: Option<u32>,
    /// avisos e erros do jogo (sem os que ele sempre escreve)
    pub problems: Vec<String>,
    /// últimas linhas antes de fechar
    pub tail: Vec<String>,
    /// o que tentar (textos do launcher, traduzidos na tela)
    pub hints: Vec<String>,
}

/// O arquivo de `/log` que o usuário já pôs nos argumentos extras, se houver.
pub fn user_log(args: &[String]) -> Option<String> {
    let i = args.iter().position(|a| a.eq_ignore_ascii_case("/log"))?;
    args.get(i + 1).cloned()
}

/// Lê o log do jogo (texto) e diz se ele fechou no meio e o que dá para tentar.
pub fn read_log(text: &str) -> LogReport {
    let mut r = LogReport::default();
    // linhas que o jogo sempre escreve e não ajudam a achar o problema
    let noise = |l: &str| l.contains("DISK: AddSearchPath") || l.contains("GRN:") || l.contains("checking ") || l.trim().is_empty();
    let lines: Vec<&str> = text.lines().map(|l| l.trim_end()).collect();
    for l in &lines {
        if l.contains("Run time:") {
            r.finished = true;
        }
        if let Some(i) = l.find("*CommandProject big match: ") {
            let rest = &l[i + 27..];
            if let Some(n) = rest.split(' ').next().and_then(|n| n.parse::<u32>().ok()) {
                r.started = true;
                r.players = Some(n);
                // "... on /maps/x_scenario.lua (4096x4096)"
                r.size = rest.rsplit_once('(').and_then(|(_, b)| b.split('x').next()).and_then(|n| n.trim().parse().ok());
            }
        }
        let low = l.to_ascii_lowercase();
        if (low.starts_with("warning:") || low.starts_with("error:")) && !noise(l) && r.problems.len() < 12 && !r.problems.iter().any(|p| p == l) {
            r.problems.push(l.to_string());
        }
    }
    r.tail = lines.iter().rev().filter(|l| !noise(l)).take(12).map(|l| l.to_string()).collect();
    r.tail.reverse();
    let all = text.to_ascii_lowercase();
    if all.contains("out of memory") || all.contains("bad_alloc") || all.contains("not enough memory") {
        r.hints.push("Faltou memória para o jogo: use um mapa menor, menos jogadores ou um limite de unidades menor.".into());
    }
    if !r.started {
        r.hints.push("O jogo fechou antes de montar a partida grande (ainda abrindo ou carregando os mods).".into());
    }
    if let (Some(n), Some(size)) = (r.players, r.size) {
        let max = max_players_for(size);
        if n as usize > max {
            r.hints.push(format!("Num mapa de {size} o jogo aguenta até {max} jogadores; com {n}, ele fica sem memória. Deixe algumas bases vazias ou use um mapa menor."));
        } else if size > 2048 && !r.finished {
            r.hints.push(format!("Mapa de {size}: acima de 2048 é experimental. Com unidades demais a memória do jogo pode acabar no meio da partida: tente um limite de unidades menor."));
        }
    }
    r
}

/// Quanto a partida pesa perto do que já foi testado (24 jogadores num mapa de 1024 = 1): cresce
/// com os jogadores e com a área do mapa.
pub fn weight(players: usize, size: u32) -> f64 {
    let area = (size.max(256) as f64 / 1024.0).powi(2);
    players as f64 / 24.0 * area
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
/// Cenários já lidos de cada `.scd` (enquanto o arquivo não muda): a lista de mapas é pedida a
/// cada "Jogar" e abrir os arquivos grandes do jogo de novo deixava o jogo demorando para abrir.
type ScenarioCache = std::collections::HashMap<(PathBuf, String), (u64, Option<std::time::SystemTime>, Option<ScenarioSummary>)>;
static SCENARIOS: std::sync::Mutex<Option<ScenarioCache>> = std::sync::Mutex::new(None);

pub fn maps_in(archives: &[PathBuf], source: &str, out: &mut Vec<MatchMap>) {
    for a in archives {
        let Ok(idx) = crate::scd::index(a) else { continue };
        let meta = std::fs::metadata(a).ok();
        let (len, modified) = (meta.as_ref().map(|m| m.len()).unwrap_or(0), meta.and_then(|m| m.modified().ok()));
        let mut keys: Vec<&String> = idx.keys().filter(|k| {
            let k = k.strip_prefix("/uncompiled").unwrap_or(k);
            k.starts_with("/maps/") && k.ends_with("_scenario.lua")
        }).collect();
        keys.sort();
        for full in keys {
            let key = full.strip_prefix("/uncompiled").unwrap_or(full).to_string();
            let ck = (a.clone(), full.clone());
            let cached = SCENARIOS.lock().unwrap_or_else(|p| p.into_inner()).as_ref().and_then(|c| c.get(&ck).cloned());
            let parsed = match cached {
                Some((l, m, p)) if l == len && m == modified => p,
                _ => {
                    let Ok(raw) = crate::scd::read_raw(a, &idx[full]) else { continue };
                    let text: String = raw.iter().map(|&b| b as char).collect();
                    let p = parse_scenario(&text);
                    SCENARIOS.lock().unwrap_or_else(|p| p.into_inner()).get_or_insert_with(Default::default).insert(ck, (len, modified, p.clone()));
                    p
                }
            };
            let Some((name, kind, size, armies, starts)) = parsed else { continue };
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

/// Minimapa do cenário (a imagem de cima do mapa que o jogo usa no canto da tela) em PNG, com o
/// lado até `max`. Procura primeiro nos `.scd` dos mods de mapa e depois nos arquivos do jogo.
pub fn minimap_png(mods: &[PathBuf], stock: &[PathBuf], scenario: &str, max: u32) -> Result<Vec<u8>> {
    let key = crate::scd::normalize_key(scenario);
    let (dir, file) = key.rsplit_once('/').ok_or_else(|| Error::Other(format!("cenário inválido: {scenario}")))?;
    let id = file.strip_suffix("_scenario.lua").ok_or_else(|| Error::Other(format!("cenário inválido: {scenario}")))?;
    let names = [format!("{dir}/{id}.minimap.win.dds"), format!("{dir}/{id}.minimap.dds")];
    let from_mods = mods.iter().find_map(|a| names.iter().find_map(|n| crate::scd::read_indexed(a, n)));
    let data = match from_mods {
        Some(d) => d,
        None => read_game_file(stock, &names[1])?,
    };
    let mut img = crate::dds::decode_max(&data, max.max(64))?;
    while img.width > max.max(64) || img.height > max.max(64) {
        img = crate::dds::downsample(&img);
    }
    // o canal alfa do minimapa guarda outra coisa (não é transparência)
    for px in img.pixels.chunks_exact_mut(4) {
        px[3] = 255;
    }
    crate::dds::to_png(&img)
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
    fn friends_slots_and_net_args() {
        let game = BigMatch {
            map: "/maps/X/X_scenario.lua".into(),
            slots: vec![slot(SlotKind::You, 1), slot(SlotKind::Guest, 1), slot(SlotKind::Guest, 2), slot(SlotKind::Ai, 2)],
            ..Default::default()
        };
        assert!(encode(&game).unwrap().contains("|H,2,0,,|G,2,0,,|G,3,0,,|A,3,0,Normal,"));
        // anfitrião e quem entra
        let mut host = game.clone();
        host.net = Some(Net { host: true, port: 15000, address: String::new(), name: "Ana Paula".into() });
        let a = launch_args(&host).unwrap();
        assert!(a.ends_with(&["/cphost".into(), "15000".into(), "/cpname".into(), "Ana_Paula".into()]), "{a:?}");
        let mut join = game.clone();
        join.net = Some(Net { host: false, port: 0, address: "10.0.0.5:15000".into(), name: "Bia".into() });
        assert!(launch_args(&join).unwrap().contains(&"/cpjoin".to_string()));
        join.net.as_mut().unwrap().address = "semporta".into();
        assert!(launch_args(&join).is_err());
        // sem vaga de amigo não há quem convidar
        let mut solo = host.clone();
        solo.slots[1].kind = SlotKind::Ai;
        solo.slots[2].kind = SlotKind::Ai;
        assert!(launch_args(&solo).is_err());
    }

    #[test]
    fn encodes_teams() {
        let m = BigMatch {
            map: "/maps/X/X_scenario.lua".into(),
            slots: vec![slot(SlotKind::You, 1), slot(SlotKind::Ai, 1), slot(SlotKind::Ai, 2), slot(SlotKind::Empty, 0), slot(SlotKind::Ai, 2)],
            options: MatchOptions { no_rush: 5, ..Default::default() },
            size: 0,
            net: None,
        };
        let s = encode(&m).unwrap();
        assert!(s.starts_with("Victory=demoralization;UnitCap=500;FogOfWar=explored;GameSpeed=normal;NoRushOption=5;"));
        // a base montada vai nas duas grafias (o jogo lê uma na tela e outra na simulação)
        assert!(s.contains(";PreBuiltUnits=Off;PrebuiltUnits=Off;") && s.contains(";CheatsEnabled=false;DoNotShareUnitCap=true|"), "{s}");
        assert!(!s.contains("RestrictedCategories"));
        let mut r = m.clone();
        r.options.restrictions = vec!["air".into(), "NUKE".into(), "AIR".into(), "ALL_RESEARCH_UNITS".into(), "ALL_RESEARCH".into()];
        r.options.cheats = true;
        r.options.share_unit_cap = true;
        let rs = encode(&r).unwrap();
        assert!(rs.contains(";CheatsEnabled=true;DoNotShareUnitCap=false;RestrictedCategories=AIR,NUKE,ALL_RESEARCH|"), "{rs}");
        r.options.restrictions = vec!["NO_SUCH".into()];
        assert!(encode(&r).is_err());
        // clima: vai como opção da partida; vazio = limpo
        let mut w = m.clone();
        w.options.weather = "Storm".into();
        assert!(encode(&w).unwrap().contains(";CPWeather=storm|"));
        w.options.weather = "none".into();
        assert!(!encode(&w).unwrap().contains("CPWeather"));
        w.options.weather = "sol".into();
        assert!(encode(&w).is_err());
        assert!(s.ends_with("|H,2,0,,|A,2,0,Normal,|A,3,0,Normal,|X|A,3,0,Normal,"), "{s}");
        assert!(!s.contains(' '));
        // limite pela memória do jogo: 5 jogadores cabem em 4096 (até 16); 17 não
        let mut big = m.clone();
        big.size = 4096;
        assert!(encode(&big).is_ok());
        big.slots = (0..17).map(|i| slot(if i == 0 { SlotKind::You } else { SlotKind::Ai }, 1 + i % 2)).collect();
        assert!(encode(&big).unwrap_err().to_string().contains("até 16 jogadores"));
        big.size = 2048;
        assert!(encode(&big).is_ok());
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
    fn reads_game_log() {
        let crashed = "info: DISK: AddSearchPath: 'x.scd'\nwarning: GRN: 1\ninfo: *CommandProject big match: 32 players on /maps/a/a_scenario.lua (4096x4096)\nwarning: something odd\ninfo: loading\n";
        let r = read_log(crashed);
        assert!(!r.finished && r.started);
        assert_eq!((r.players, r.size), (Some(32), Some(4096)));
        assert_eq!(r.problems, vec!["warning: something odd"]);
        assert_eq!(r.tail.last().map(|s| s.as_str()), Some("info: loading"));
        assert_eq!(r.hints.len(), 1, "{:?}", r.hints);
        assert!(r.hints[0].contains("até 16 jogadores"), "{:?}", r.hints);
        let ok = read_log("info: *CommandProject big match: 8 players on /maps/a/a_scenario.lua (1024x1024)\ninfo: Run time: 0h19m50s\n");
        assert!(ok.finished && ok.hints.is_empty());
        let early = read_log("info: checking C:\\mods\nerror: Out of memory\n");
        assert!(!early.started && early.hints.len() == 2);
        assert_eq!(user_log(&["/windowed".into(), "/LOG".into(), "a.log".into()]), Some("a.log".into()));
        assert!(weight(24, 1024) == 1.0 && weight(32, 4096) > 20.0);
        assert_eq!([max_players_for(1024), max_players_for(2048), max_players_for(3072), max_players_for(3584), max_players_for(4096)], [32, 32, 28, 20, 16]);
    }

    /// Com `CP_TEST_MAP_SCD` (um mapa feito pelo editor): o minimapa sai em PNG.
    #[test]
    fn minimap_from_map_mod() {
        let Some(scd) = std::env::var_os("CP_TEST_MAP_SCD") else { return };
        let scd = PathBuf::from(scd);
        let mut maps = Vec::new();
        maps_in(std::slice::from_ref(&scd), "Mod", &mut maps);
        let png = minimap_png(std::slice::from_ref(&scd), &[], &maps[0].path, 512).unwrap();
        let img = crate::dds::from_png(&png).unwrap();
        assert_eq!((img.width, img.height), (512, 512));
        assert!(img.pixels.chunks_exact(4).all(|p| p[3] == 255));
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
