//! O launcher dentro do jogo: um painel ao lado do submenu Extras da tela inicial nova com o que
//! antes só dava para mudar no launcher — perfil de mods, ligar e desligar cada mod, a cor da tela
//! inicial, a memória e a prioridade do jogo.
//!
//! O jogo não grava arquivos do launcher, então cada clique vira um pedido guardado no perfil do
//! jogo (`CPLauncher` no `Game.prefs`, com um número que sobe a cada mudança: `CPLauncherSet` e
//! `CPLauncherMod` no `SinglePlayerLaunch.lua` do mod da Partida grande). Na próxima vez que você
//! clica em Jogar, o launcher lê os pedidos novos ([`parse_requests`]) e aplica antes de abrir o
//! jogo.
//!
//! O painel mora dentro do grupo `g_extras_options` (o jogo só sabe mostrar e esconder os quatro
//! submenus dele): todos os elementos começam escondidos, como os itens dos submenus.

use crate::bigmatch_menu::VISIBLE;
use crate::error::{Error, Result};
use crate::mainmenu::{ORDER, TEX};
use crate::scene::{event, kind, Anchors, Event, Rect, Scene};

/// O que o painel mostra (o estado no momento em que a tela inicial foi montada).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LauncherPanel {
    /// (id, nome, é o ativo)
    pub profiles: Vec<(String, String, bool)>,
    /// (id, nome, ligado)
    pub mods: Vec<(String, String, bool)>,
    pub accent: String,
    pub memory_mb: Option<u32>,
    pub priority: String,
}

/// Cores da tela inicial (as mesmas do launcher).
pub const COLORS: [(&str, &str, &str); 7] = [
    ("#2b8cff", "AZUL", "BLUE"),
    ("#e21e24", "VERMELHO", "RED"),
    ("#22c55e", "VERDE", "GREEN"),
    ("#a855f7", "ROXO", "PURPLE"),
    ("#f59e0b", "ÂMBAR", "AMBER"),
    ("#06b6d4", "CIANO", "CYAN"),
    ("#e5e7eb", "PRATA", "SILVER"),
];
const MEMORY: [u32; 3] = [2048, 3072, 4096];
const PRIORITY: [(&str, &str, &str); 3] = [("normal", "NORMAL", "NORMAL"), ("above_normal", "ACIMA", "ABOVE"), ("high", "ALTA", "HIGH")];
/// Perfis e mods no painel, no máximo.
pub const MAX_PROFILES: usize = 4;
pub const MAX_MODS: usize = 6;

// medidas (quadro 16:9 da "Comandante": o submenu vai de 173 a 593)
const X0: i32 = 611;
const X1: i32 = 1440;
const Y0: i32 = 262;
const Y1: i32 = 904;
const IN0: i32 = X0 + 20;
const IN1: i32 = X1 - 20;

fn find(s: &Scene, name: &str) -> Result<u32> {
    s.by_name(name).map(|e| e.id).map_err(|_| Error::Other(format!("a tela inicial do jogo é diferente do esperado (sem {name})")))
}

fn lua_str(t: &str) -> bool {
    !t.is_empty() && t.chars().all(|c| c.is_ascii_graphic() && !matches!(c, '\'' | '"' | '\\'))
}

fn call(code: &str) -> String {
    format!("local m = import('/lua/SinglePlayerLaunch.lua') if m.CPLauncherSet then m.{code} end")
}

/// Põe o painel do launcher no submenu Extras da tela inicial `scene` (já no visual novo).
pub fn add_launcher_panel(scene: &[u8], p: &LauncherPanel, pt: bool) -> Result<Vec<u8>> {
    let mut s = Scene::parse(scene)?;
    let tex = |n: &str| format!("{TEX}{n}.dds");
    let host = find(&s, "g_extras_options")?;
    let group_t = find(&s, "rg_menu_group")?;
    let button_t = find(&s, "rb_credits")?;
    let label_t = s.children(button_t)?.into_iter().find(|c| s.by_id(*c).map(|e| e.kind == kind::TEXT).unwrap_or(false)).ok_or_else(|| Error::Other("botão modelo sem texto".into()))?;
    let bitmap_t = find(&s, "avatar")?;
    let sounds: Vec<Event> = s.events(button_t)?.into_iter().filter(|e| e.name == "PlaySound").collect();
    let order = s.u32_field(button_t, ORDER)?;
    let mut panel: Vec<u32> = Vec::new();
    let tr = |a: &'static str, b: &'static str| if pt { a } else { b };

    // fundo e moldura
    let edge = 32;
    for (n, r) in [
        ("c", Rect::new(X0, X1, Y0, Y1)),
        ("tl", Rect::new(X0, X0 + edge, Y0, Y0 + edge)),
        ("t", Rect::new(X0 + edge, X1 - edge, Y0, Y0 + edge)),
        ("tr", Rect::new(X1 - edge, X1, Y0, Y0 + edge)),
        ("l", Rect::new(X0, X0 + edge, Y0 + edge, Y1 - edge)),
        ("r", Rect::new(X1 - edge, X1, Y0 + edge, Y1 - edge)),
        ("bl", Rect::new(X0, X0 + edge, Y1 - edge, Y1)),
        ("b", Rect::new(X0 + edge, X1 - edge, Y1 - edge, Y1)),
        ("br", Rect::new(X1 - edge, X1, Y1 - edge, Y1)),
    ] {
        let id = s.clone_element(bitmap_t, &format!("cp_lp_frame_{n}"))?;
        s.set_str_field(id, 112, &tex(&format!("p9_{n}")))?;
        s.set_rect(id, r)?;
        s.set_u32(id, VISIBLE, 0)?;
        panel.push(id);
    }
    let line = s.clone_element(bitmap_t, "cp_lp_line")?;
    s.set_str_field(line, 112, &tex("line"))?;
    s.set_rect(line, Rect::new(IN0, IN1, Y0 + 52, Y0 + 55))?;
    s.set_u32(line, ORDER, order + 1)?;
    s.set_u32(line, VISIBLE, 0)?;
    panel.push(line);

    let mut n = 0;
    let mut text = |s: &mut Scene, panel: &mut Vec<u32>, txt: &str, font: &str, r: Rect| -> Result<()> {
        n += 1;
        let id = s.clone_element(label_t, &format!("cp_lp_text{n}"))?;
        s.set_text(id, txt)?;
        s.set_str_field(id, 108, font)?;
        s.set_u32(id, 128, 0)?;
        s.set_rect(id, r)?;
        s.set_u32(id, VISIBLE, 0)?;
        panel.push(id);
        Ok(())
    };
    text(&mut s, &mut panel, tr("LAUNCHER", "LAUNCHER"), "pc_title_font_5", Rect::new(IN0, IN1, Y0 + 6, Y0 + 52))?;

    let mut g = 0;
    let mut group = |s: &mut Scene, panel: &mut Vec<u32>, items: Vec<(String, String, Rect)>| -> Result<()> {
        g += 1;
        let gid = s.clone_element(group_t, &format!("cp_lp_group{g}"))?;
        s.set_events(gid, &[])?;
        s.set_anchors(gid, Anchors::default())?;
        s.set_u32(gid, VISIBLE, 0)?;
        let mut kids = Vec::new();
        let mut bound = Rect::new(i32::MAX, i32::MIN, i32::MAX, i32::MIN);
        for (i, (label, code, r)) in items.into_iter().enumerate() {
            let b = s.clone_element(button_t, &format!("cp_lp_g{g}_b{i}"))?;
            for (off, state) in [(112, "u"), (116, "o"), (120, "w"), (124, "at"), (128, "at"), (132, "at")] {
                s.set_str_field(b, off, &tex(&format!("opt_{state}")))?;
            }
            s.set_rect(b, r)?;
            s.set_u32(b, VISIBLE, 0)?;
            let mut evs = sounds.clone();
            evs.push(Event::new(event::SELECT, "ConsoleExecute", &format!("UI_Lua {code}")));
            s.set_events(b, &evs)?;
            let l = s.clone_element(label_t, &format!("cp_lp_g{g}_b{i}_label"))?;
            s.set_text(l, &label)?;
            s.set_str_field(l, 108, "pc_title_font_2")?;
            s.set_u32(l, 128, 1)?;
            s.set_rect(l, Rect::new(r.x0 + 4, r.x1 - 4, r.y0 + 3, r.y1 - 3))?;
            s.set_u32(l, VISIBLE, 0)?;
            s.set_children(b, &[l])?;
            kids.push(b);
            bound = Rect::new(bound.x0.min(r.x0), bound.x1.max(r.x1), bound.y0.min(r.y0), bound.y1.max(r.y1));
        }
        s.set_children(gid, &kids)?;
        s.set_rect(gid, bound)?;
        panel.push(gid);
        Ok(())
    };
    let cells = |count: i32, i: i32, x0: i32, x1: i32| -> (i32, i32) {
        let gap = 6;
        let w = (x1 - x0 - gap * (count - 1)) / count;
        let x = x0 + (w + gap) * i;
        (x, x + w)
    };
    let (lh, bh) = (26, 32);
    let mut y = Y0 + 62;

    // perfil
    let profiles: Vec<&(String, String, bool)> = p.profiles.iter().filter(|x| lua_str(&x.0)).take(MAX_PROFILES).collect();
    if !profiles.is_empty() {
        text(&mut s, &mut panel, tr("PERFIL DE MODS", "MODS PROFILE"), "pc_title_font_2", Rect::new(IN0, IN1, y, y + lh))?;
        let count = profiles.len() as i32;
        let items = profiles
            .iter()
            .enumerate()
            .map(|(i, (id, name, active))| {
                let (a, b) = cells(count, i as i32, IN0, IN1);
                let name: String = name.chars().filter(|c| !c.is_control()).take(16).collect::<String>().to_uppercase();
                let label = if *active { format!("» {name}") } else { name };
                (label, call(&format!("CPLauncherSet('profile', '{id}')")), Rect::new(a, b, y + lh, y + lh + bh))
            })
            .collect();
        group(&mut s, &mut panel, items)?;
        y += lh + bh + 10;
    }
    // mods: nome à esquerda, ligar/desligar à direita
    let mods: Vec<&(String, String, bool)> = p.mods.iter().filter(|x| lua_str(&x.0)).take(MAX_MODS).collect();
    if !mods.is_empty() {
        text(&mut s, &mut panel, tr("MODS (» É COMO ESTÁ AGORA)", "MODS (» IS HOW IT IS NOW)"), "pc_title_font_2", Rect::new(IN0, IN1, y, y + lh))?;
        y += lh;
        let split = IN0 + (IN1 - IN0) * 55 / 100;
        for (id, name, on) in mods {
            let name: String = name.chars().filter(|c| !c.is_control()).take(34).collect::<String>().to_uppercase();
            text(&mut s, &mut panel, &name, "pc_body_font_narrow_3", Rect::new(IN0, split - 10, y + 4, y + bh))?;
            let (a0, a1) = cells(2, 0, split, IN1);
            let (b0, b1) = cells(2, 1, split, IN1);
            let on_label = format!("{}{}", if *on { "» " } else { "" }, tr("LIGADO", "ON"));
            let off_label = format!("{}{}", if *on { "" } else { "» " }, tr("DESLIGADO", "OFF"));
            group(
                &mut s,
                &mut panel,
                vec![
                    (on_label, call(&format!("CPLauncherMod('{id}', true)")), Rect::new(a0, a1, y, y + bh)),
                    (off_label, call(&format!("CPLauncherMod('{id}', false)")), Rect::new(b0, b1, y, y + bh)),
                ],
            )?;
            y += bh + 4;
        }
        y += 6;
    }
    // cor da tela inicial
    text(&mut s, &mut panel, tr("COR DA TELA INICIAL", "START SCREEN COLOR"), "pc_title_font_2", Rect::new(IN0, IN1, y, y + lh))?;
    let items = COLORS
        .iter()
        .enumerate()
        .map(|(i, (hex, pt_name, en_name))| {
            let (a, b) = cells(COLORS.len() as i32, i as i32, IN0, IN1);
            let mark = if p.accent.eq_ignore_ascii_case(hex) { "» " } else { "" };
            (format!("{mark}{}", if pt { pt_name } else { en_name }), call(&format!("CPLauncherSet('accent', '{hex}')")), Rect::new(a, b, y + lh, y + lh + bh))
        })
        .collect();
    group(&mut s, &mut panel, items)?;
    y += lh + bh + 10;
    // memória e prioridade, lado a lado
    let mid = (IN0 + IN1) / 2;
    text(&mut s, &mut panel, tr("MEMÓRIA DO JOGO", "GAME MEMORY"), "pc_title_font_2", Rect::new(IN0, mid - 10, y, y + lh))?;
    text(&mut s, &mut panel, tr("PRIORIDADE", "PRIORITY"), "pc_title_font_2", Rect::new(mid + 10, IN1, y, y + lh))?;
    let items = MEMORY
        .iter()
        .enumerate()
        .map(|(i, mb)| {
            let (a, b) = cells(3, i as i32, IN0, mid - 10);
            let mark = if p.memory_mb == Some(*mb) { "» " } else { "" };
            (format!("{mark}{} GB", mb / 1024), call(&format!("CPLauncherSet('memory', {mb})")), Rect::new(a, b, y + lh, y + lh + bh))
        })
        .collect();
    group(&mut s, &mut panel, items)?;
    let items = PRIORITY
        .iter()
        .enumerate()
        .map(|(i, (key, pt_name, en_name))| {
            let (a, b) = cells(3, i as i32, mid + 10, IN1);
            let mark = if p.priority == *key { "» " } else { "" };
            (format!("{mark}{}", if pt { pt_name } else { en_name }), call(&format!("CPLauncherSet('priority', '{key}')")), Rect::new(a, b, y + lh, y + lh + bh))
        })
        .collect();
    group(&mut s, &mut panel, items)?;
    y += lh + bh + 14;
    text(
        &mut s,
        &mut panel,
        tr("Vale na próxima vez que você clicar em Jogar no launcher.", "Applies the next time you click Play in the launcher."),
        "pc_body_font_narrow_2",
        Rect::new(IN0, IN1, y.min(Y1 - 50), y.min(Y1 - 50) + 30),
    )?;

    let mut kids = s.children(host)?;
    kids.extend(panel);
    s.set_children(host, &kids)?;
    Ok(s.to_bytes())
}

/// Os pedidos feitos no painel (o que está guardado no `Game.prefs`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GameRequests {
    pub seq: u64,
    pub profile: Option<String>,
    pub accent: Option<String>,
    pub memory_mb: Option<u32>,
    pub priority: Option<String>,
    pub mods: Vec<(String, bool)>,
}

/// O bloco `{ ... }` depois de `name =` (com as chaves de dentro).
fn block<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let mut from = 0;
    while let Some(i) = text[from..].find(name) {
        let at = from + i;
        let rest = text[at + name.len()..].trim_start();
        if let Some(rest) = rest.strip_prefix('=') {
            let rest = rest.trim_start();
            if rest.starts_with('{') {
                let start = text.len() - rest.len();
                let mut depth = 0;
                for (j, c) in rest.char_indices() {
                    match c {
                        '{' => depth += 1,
                        '}' => {
                            depth -= 1;
                            if depth == 0 {
                                return Some(&text[start + 1..start + j]);
                            }
                        }
                        _ => {}
                    }
                }
                return None;
            }
        }
        from = at + name.len();
    }
    None
}

/// `chave = valor` (no primeiro nível do bloco): o valor sem aspas.
fn field(block: &str, key: &str) -> Option<String> {
    let mut depth = 0;
    let bytes: Vec<char> = block.chars().collect();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            '{' => depth += 1,
            '}' => depth -= 1,
            _ => {}
        }
        if depth == 0 && block[block.char_indices().nth(i).map(|x| x.0).unwrap_or(0)..].starts_with(key) {
            let before = if i == 0 { ' ' } else { bytes[i - 1] };
            if !(before.is_alphanumeric() || before == '_') {
                let off = block.char_indices().nth(i).map(|x| x.0).unwrap_or(0) + key.len();
                let rest = block[off..].trim_start();
                if let Some(rest) = rest.strip_prefix('=') {
                    let rest = rest.trim_start();
                    // texto entre aspas: até a aspa que fecha (vírgulas dentro valem)
                    if let Some(q) = rest.chars().next().filter(|c| *c == '\'' || *c == '"') {
                        let mut out = String::new();
                        let mut esc = false;
                        for c in rest[1..].chars() {
                            if esc {
                                out.push(c);
                                esc = false;
                            } else if c == '\\' {
                                esc = true;
                            } else if c == q {
                                return Some(out);
                            } else {
                                out.push(c);
                            }
                        }
                        return Some(out);
                    }
                    let end = rest.find([',', '\n', '}']).unwrap_or(rest.len());
                    return Some(rest[..end].trim().to_string());
                }
            }
        }
        i += 1;
    }
    None
}

/// Lê os pedidos do `Game.prefs` (`CPLauncher = { ... }`).
pub fn parse_requests(prefs: &str) -> Option<GameRequests> {
    let b = block(prefs, "CPLauncher")?;
    let mut r = GameRequests { seq: field(b, "seq")?.parse().ok()?, ..Default::default() };
    r.profile = field(b, "profile").filter(|v| lua_str(v));
    r.accent = field(b, "accent").filter(|v| v.len() == 7 && v.starts_with('#') && v[1..].chars().all(|c| c.is_ascii_hexdigit()));
    r.memory_mb = field(b, "memory").and_then(|v| v.parse::<f64>().ok()).map(|v| v as u32).filter(|v| (1024..=4096).contains(v));
    r.priority = field(b, "priority").filter(|v| PRIORITY.iter().any(|p| p.0 == v));
    if let Some(m) = block(b, "mods") {
        for part in m.split(',') {
            let Some((k, v)) = part.split_once('=') else { continue };
            let k = k.trim().trim_start_matches('[').trim_end_matches(']').trim_matches(|c| c == '\'' || c == '"').to_string();
            let v = v.trim();
            if lua_str(&k) && (v == "true" || v == "false") {
                r.mods.push((k, v == "true"));
            }
        }
    }
    Some(r)
}

/// Recorde de um minigame (gravado pelo jogo em `CPRecords` no `Game.prefs`).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MinigameRecord {
    /// `total`, `arena`, `defense`, `domination` ou `supreme`
    pub mode: String,
    pub played: u32,
    pub wins: u32,
    /// segundos da vitória mais rápida
    pub fastest: Option<u32>,
    /// mais ondas seguradas (defesa) ou maior pontuação (os outros)
    pub best: u32,
}

/// Nome de um modo dos minigames.
pub fn mode_name(mode: &str, pt: bool) -> &'static str {
    match (mode, pt) {
        ("total", true) => "Guerra Total",
        ("total", false) => "Total War",
        ("arena", true) => "Arena dos Experimentais",
        ("arena", false) => "Experimental Arena",
        ("defense", true) => "Última Linha de Defesa",
        ("defense", false) => "Last Line of Defense",
        ("domination", true) => "Dominação Estratégica",
        ("domination", false) => "Strategic Domination",
        ("supreme", true) => "Projeto Supremo",
        ("supreme", false) => "Supreme Project",
        ("survival", true) => "Sobrevivência Infinita",
        ("survival", false) => "Endless Survival",
        ("koth", true) => "Rei da Colina",
        ("koth", false) => "King of the Hill",
        ("vip", true) => "Escolta",
        ("vip", false) => "Escort",
        ("race", true) => "Corrida de Recursos",
        ("race", false) => "Resource Race",
        ("treasure", true) => "Caça ao Tesouro",
        ("treasure", false) => "Treasure Hunt",
        _ => "",
    }
}

/// Os recordes dos minigames no `Game.prefs`, na ordem de [`crate::bigmatch::MODES`] (só os jogados).
pub fn parse_records(prefs: &str) -> Vec<MinigameRecord> {
    let Some(b) = block(prefs, "CPRecords") else { return vec![] };
    let num = |key: &str| field(b, key).and_then(|v| v.trim().parse::<f64>().ok()).filter(|v| v.is_finite() && *v >= 0.0).map(|v| v as u32);
    crate::bigmatch::MODES
        .iter()
        .filter_map(|m| {
            let played = num(&format!("{m}_played"))?;
            Some(MinigameRecord {
                mode: m.to_string(),
                played,
                wins: num(&format!("{m}_wins")).unwrap_or(0),
                fastest: num(&format!("{m}_fast")),
                best: num(&format!("{m}_best")).unwrap_or(0),
            })
        })
        .collect()
}

/// Uma partida de minigame do histórico (`CPHistory` no `Game.prefs`, as últimas 40).
#[derive(Debug, Clone, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MinigameMatch {
    pub seq: u32,
    pub mode: String,
    pub won: bool,
    pub seconds: u32,
    pub waves: u32,
    pub score: u32,
    pub map: String,
    /// mutadores, separados por vírgula
    pub mutators: String,
    /// desafio da semana (0 = não)
    pub week: u32,
    pub events: bool,
    pub players: u32,
    /// quando o launcher viu a partida pela primeira vez (segundos desde 1970)
    pub date: Option<i64>,
}

/// Os blocos `{ ... }` do primeiro nível de uma lista Lua.
fn items(list: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0;
    let mut start = 0;
    for (i, c) in list.char_indices() {
        match c {
            '{' => {
                if depth == 0 {
                    start = i + 1;
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    out.push(&list[start..i]);
                }
            }
            _ => {}
        }
    }
    out
}

/// O histórico dos minigames no `Game.prefs`, do mais antigo ao mais novo.
pub fn parse_history(prefs: &str) -> Vec<MinigameMatch> {
    let Some(b) = block(prefs, "CPHistory") else { return vec![] };
    let num = |b: &str, k: &str| field(b, k).and_then(|v| v.trim().parse::<f64>().ok()).filter(|v| v.is_finite() && *v >= 0.0).map(|v| v as u32).unwrap_or(0);
    let text = |b: &str, k: &str| field(b, k).map(|v| v.chars().filter(|c| !c.is_control()).take(80).collect::<String>()).unwrap_or_default();
    items(b)
        .into_iter()
        .filter_map(|e| {
            let mode = text(e, "mode");
            if !crate::bigmatch::MODES.contains(&mode.as_str()) {
                return None;
            }
            Some(MinigameMatch {
                seq: num(e, "seq"),
                mode,
                won: field(e, "won").as_deref() == Some("true"),
                seconds: num(e, "seconds"),
                waves: num(e, "waves"),
                score: num(e, "score"),
                map: text(e, "map"),
                mutators: text(e, "mut"),
                week: num(e, "week"),
                events: field(e, "events").as_deref() == Some("true"),
                players: num(e, "players"),
                date: None,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_minigame_history() {
        let prefs = "CPHistory = {\n    {\n        events = true,\n        map = 'Seton\\'s',\n        mode = 'survival',\n        mut = 'hp,res',\n        players = 4,\n        score = 0,\n        seconds = 900,\n        seq = 3,\n        waves = 12,\n        week = 0,\n        won = false,\n    },\n    {\n        mode = 'xadrez',\n        seq = 4,\n    },\n    {\n        mode = 'koth',\n        seq = 5,\n        won = true,\n        score = 180,\n    },\n},\n";
        let h = parse_history(prefs);
        assert_eq!(h.len(), 2);
        assert_eq!((h[0].mode.as_str(), h[0].waves, h[0].seq, h[0].events, h[0].mutators.as_str()), ("survival", 12, 3, true, "hp,res"));
        assert!(h[1].won && h[1].score == 180);
    }

    #[test]
    fn reads_the_minigame_records() {
        let prefs = "profile = { profiles = { { CPRecords = {\n    arena_played = 3,\n    arena_wins = 2,\n    arena_fast = 412,\n    defense_best = 9,\n    defense_played = 4,\n}, CPLauncher = { seq = 1 } } } }";
        let r = parse_records(prefs);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0], MinigameRecord { mode: "arena".into(), played: 3, wins: 2, fastest: Some(412), best: 0 });
        assert_eq!((r[1].mode.as_str(), r[1].played, r[1].wins, r[1].best), ("defense", 4, 0, 9));
        assert!(parse_records("x = 1").is_empty());
    }

    #[test]
    fn reads_the_requests_from_the_game_prefs() {
        let prefs = "profile = {\n    profiles = {\n        {\n            Name = 'Rique',\n            CPBigMatch = { players = 12 },\n            CPLauncher = {\n                accent = '#22c55e',\n                memory = 3072,\n                mods = {\n                    ['cp-ia-esperta'] = false,\n                    ['texturas-hd'] = true,\n                },\n                priority = 'high',\n                profile = 'teste-2',\n                seq = 7,\n            },\n        },\n    },\n}\n";
        let r = parse_requests(prefs).unwrap();
        assert_eq!(r.seq, 7);
        assert_eq!(r.profile.as_deref(), Some("teste-2"));
        assert_eq!(r.accent.as_deref(), Some("#22c55e"));
        assert_eq!(r.memory_mb, Some(3072));
        assert_eq!(r.priority.as_deref(), Some("high"));
        assert_eq!(r.mods, vec![("cp-ia-esperta".to_string(), false), ("texturas-hd".to_string(), true)]);
        assert!(parse_requests("options = {}").is_none());
        // valores estranhos ficam de fora
        let r = parse_requests("CPLauncher = { seq = 1, accent = 'azul', priority = 'turbo', memory = 99999 }").unwrap();
        assert_eq!((r.accent, r.priority, r.memory_mb), (None, None, None));
    }

    #[test]
    fn panel_goes_hidden_into_the_extras_submenu() {
        let Ok(path) = std::env::var("CP_TEST_SCENE") else { return };
        let look = crate::mainmenu::Look::Commander(crate::mainmenu::Commander { panel: true, ..Default::default() });
        let menu = crate::mainmenu::build_with(&std::fs::read(path).unwrap(), &Default::default(), &look).unwrap().scene;
        let p = LauncherPanel {
            profiles: vec![("mods".into(), "Mods".into(), true), ("teste".into(), "Teste".into(), false)],
            mods: vec![("cp-ia-esperta".into(), "IA esperta".into(), true), ("texturas-hd".into(), "Texturas HD".into(), false)],
            accent: "#2b8cff".into(),
            memory_mb: Some(4096),
            priority: "normal".into(),
        };
        let out = add_launcher_panel(&menu, &p, true).unwrap();
        let s = Scene::parse(&out).unwrap();
        let host = s.by_name("g_extras_options").unwrap().id;
        assert!(s.children(host).unwrap().contains(&s.by_name("cp_lp_frame_c").unwrap().id));
        for e in s.elements().unwrap().iter().filter(|e| e.name.starts_with("cp_lp")) {
            assert_eq!(s.u32_field(e.id, VISIBLE).unwrap(), 0, "{}", e.name);
        }
        let on = s.by_name("cp_lp_g2_b0").unwrap().id;
        assert!(s.events(on).unwrap().iter().any(|e| e.param.contains("CPLauncherMod('cp-ia-esperta', true)")));
        if let Ok(dest) = std::env::var("CP_TEST_LP_OUT") {
            std::fs::write(dest, &out).unwrap();
        }
    }
}
