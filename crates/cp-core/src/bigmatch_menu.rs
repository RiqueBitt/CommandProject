//! "Criar jogo" dentro da tela inicial nova: um painel ao lado do submenu da Escaramuça que cria
//! a partida do jeito do launcher — de 2 a 32 jogadores, times, dificuldade da IA, a sua facção,
//! o tipo de vitória, o limite de unidades e o mapa (os do jogo e os do jogador, os grandes
//! também). Cada escolha é um botão de opção do próprio jogo (fica aceso) que guarda o valor em
//! Lua; "Começar" monta a partida com `CPBigMatchQuick` (no `SinglePlayerLaunch.lua`, do mod
//! `cp-partida-grande`). A sala do jogo (até 8, com facção e cor de cada um) continua no submenu
//! como "Sala clássica".
//!
//! O painel mora dentro do grupo `g_skirmish_options` da própria tela inicial: o jogo só sabe
//! mostrar e esconder os quatro submenus dele (`ShowMainMenuGroup`) e não abre cenas novas
//! (`UILoadScene` carrega a cena, mas ela não aparece). Todos os elementos do painel começam
//! escondidos (o campo "visível" do registro em 0), como os itens dos submenus.

use crate::error::{Error, Result};
use crate::mainmenu::{ORDER, TEX};
use crate::scene::{event, kind, Anchors, Event, Rect, Scene};

/// Mapas na lista, no máximo.
pub const MAX_MAPS: usize = 8;
/// Campo "visível" de um registro (1 = aparece sozinho; 0 = só quando o grupo dele é mostrado).
pub const VISIBLE: usize = 32;

/// Um mapa da lista: cenário, nome e bases.
#[derive(Debug, Clone, PartialEq)]
pub struct MenuMap {
    pub path: String,
    pub name: String,
    pub bases: usize,
    pub size: u32,
}

/// Textos do painel (no idioma do jogo).
pub struct Texts {
    pub title: &'static str,
    pub players: &'static str,
    pub teams: &'static str,
    pub ai: &'static str,
    pub faction: &'static str,
    pub victory: &'static str,
    pub units: &'static str,
    pub map: &'static str,
    pub team_labels: [&'static str; 4],
    pub ai_labels: [&'static str; 4],
    pub faction_labels: [&'static str; 4],
    pub victory_labels: [&'static str; 3],
    pub start: &'static str,
    pub note: &'static str,
    /// item do submenu que abre a sala do jogo
    pub classic: &'static str,
}

pub const PT: Texts = Texts {
    title: "CRIAR JOGO",
    players: "JOGADORES",
    teams: "TIMES",
    ai: "DIFICULDADE DA IA",
    faction: "SUA FACÇÃO",
    victory: "VITÓRIA",
    units: "LIMITE DE UNIDADES",
    map: "MAPA",
    team_labels: ["2 TIMES", "3 TIMES", "4 TIMES", "TODOS CONTRA TODOS"],
    ai_labels: ["FÁCIL", "NORMAL", "DIFÍCIL", "MUITO DIFÍCIL"],
    faction_labels: ["ALEATÓRIA", "UEF", "CYBRAN", "ILLUMINATE"],
    victory_labels: ["COMANDANTE", "DESTRUIR TUDO", "SEM FIM"],
    start: "COMEÇAR",
    note: "Sem escolher: 8 jogadores, 2 times, IA normal e o primeiro mapa.",
    classic: "SALA CLÁSSICA (FACÇÃO E COR)",
};

pub const EN: Texts = Texts {
    title: "CREATE GAME",
    players: "PLAYERS",
    teams: "TEAMS",
    ai: "AI DIFFICULTY",
    faction: "YOUR FACTION",
    victory: "VICTORY",
    units: "UNIT CAP",
    map: "MAP",
    team_labels: ["2 TEAMS", "3 TEAMS", "4 TEAMS", "FREE FOR ALL"],
    ai_labels: ["EASY", "NORMAL", "HARD", "VERY HARD"],
    faction_labels: ["RANDOM", "UEF", "CYBRAN", "ILLUMINATE"],
    victory_labels: ["COMMANDER", "DESTROY ALL", "ENDLESS"],
    start: "START",
    note: "Without choosing: 8 players, 2 teams, normal AI and the first map.",
    classic: "CLASSIC LOBBY (FACTION AND COLOR)",
};

const PLAYERS: [u32; 11] = [2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32];
const AI_KEYS: [&str; 4] = ["Easy", "Normal", "Hard", "Cheat"];
const VICTORY_KEYS: [&str; 3] = ["demoralization", "domination", "sandbox"];
const UNIT_CAPS: [u32; 3] = [250, 500, 1000];

// medidas do painel (unidades da cena, no quadro 16:9 da "Comandante": o submenu vai de 173 a 593)
const X0: i32 = 611;
const X1: i32 = 1440;
/// topo: logo abaixo das notícias (com o painel, os atalhos do lado direito sobem; veja
/// `mainmenu::commander`)
pub const Y0: i32 = 262;
const Y1: i32 = 904;
const IN0: i32 = X0 + 20;
const IN1: i32 = X1 - 20;
/// altura de uma linha de escolhas (título + botões)
const ROW: i32 = 66;

fn find(s: &Scene, name: &str) -> Result<u32> {
    s.by_name(name).map(|e| e.id).map_err(|_| Error::Other(format!("a tela inicial do jogo é diferente do esperado (sem {name})")))
}

fn safe(t: &str) -> bool {
    !t.is_empty() && t.chars().all(|c| c.is_ascii_graphic() && !matches!(c, '\'' | '"' | '\\'))
}

/// Código do botão "Começar".
pub fn start_code(first_map: &str) -> String {
    format!(
        "local m = import('/lua/SinglePlayerLaunch.lua') if m.CPBigMatchQuick then m.CPBigMatchQuick(CPBM_map or '{first_map}', CPBM_players or 8, CPBM_teams or 2, CPBM_ai or 'Normal', CPBM_faction or 0, CPBM_victory or 'demoralization', CPBM_units or 1000) else LOG('CommandProject: mod da Partida grande ausente') end"
    )
}

/// Põe o painel "Criar jogo" no submenu da Escaramuça da tela inicial `scene` (já no visual
/// "Comandante"); o item "Criar jogo" do submenu deixa de abrir a sala do jogo (o painel já está
/// ao lado). Sem mapas, devolve a cena como está.
pub fn add_panel(scene: &[u8], maps: &[MenuMap], t: &Texts) -> Result<Vec<u8>> {
    let maps: Vec<&MenuMap> = maps.iter().filter(|m| safe(&m.path) && m.path.starts_with("/maps/")).take(MAX_MAPS).collect();
    let Some(first) = maps.first() else { return Ok(scene.to_vec()) };
    let mut s = Scene::parse(scene)?;
    let tex = |n: &str| format!("{TEX}{n}.dds");
    let host = find(&s, "g_skirmish_options")?;
    let group_t = find(&s, "rg_menu_group")?;
    let button_t = find(&s, "rb_creategame")?;
    let label_t = s.children(button_t)?.into_iter().find(|c| s.by_id(*c).map(|e| e.kind == kind::TEXT).unwrap_or(false)).ok_or_else(|| Error::Other("botão modelo sem texto".into()))?;
    let bitmap_t = find(&s, "avatar")?;
    let sounds: Vec<Event> = s.events(button_t)?.into_iter().filter(|e| e.name == "PlaySound").collect();
    // "Criar jogo" é o painel: o item só acende
    s.set_events(button_t, &sounds)?;
    let mut panel: Vec<u32> = Vec::new();
    let hide = |s: &mut Scene, id: u32| s.set_u32(id, VISIBLE, 0);
    let top_order = s.u32_field(button_t, ORDER)?;

    // fundo e moldura (os 9 pedaços do painel dos outros menus)
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
        let id = s.clone_element(bitmap_t, &format!("cp_bm_frame_{n}"))?;
        s.set_str_field(id, 112, &tex(&format!("p9_{n}")))?;
        s.set_rect(id, r)?;
        hide(&mut s, id)?;
        panel.push(id);
    }
    // filete de destaque embaixo do título
    let line = s.clone_element(bitmap_t, "cp_bm_line")?;
    s.set_str_field(line, 112, &tex("line"))?;
    s.set_rect(line, Rect::new(IN0, IN1, Y0 + 52, Y0 + 55))?;
    s.set_u32(line, ORDER, top_order + 1)?;
    hide(&mut s, line)?;
    panel.push(line);

    let mut n = 0;
    let mut text = |s: &mut Scene, panel: &mut Vec<u32>, txt: &str, font: &str, r: Rect| -> Result<u32> {
        n += 1;
        // do texto de um item do submenu (os de outros grupos não aparecem dentro do painel)
        let id = s.clone_element(label_t, &format!("cp_bm_text{n}"))?;
        s.set_text(id, txt)?;
        s.set_str_field(id, 108, font)?;
        s.set_u32(id, 128, 0)?;
        s.set_rect(id, r)?;
        s.set_u32(id, VISIBLE, 0)?;
        panel.push(id);
        Ok(id)
    };
    text(&mut s, &mut panel, t.title, "pc_title_font_5", Rect::new(IN0, IN1, Y0 + 6, Y0 + 52))?;

    // um grupo de botões de opção (cada um com o código dele)
    let mut g = 0;
    let mut group = |s: &mut Scene, panel: &mut Vec<u32>, items: Vec<(String, String, Rect, bool)>| -> Result<()> {
        g += 1;
        let gid = s.clone_element(group_t, &format!("cp_bm_group{g}"))?;
        s.set_events(gid, &[])?;
        s.set_anchors(gid, Anchors::default())?;
        s.set_u32(gid, VISIBLE, 0)?;
        let mut kids = Vec::new();
        let mut bound = Rect::new(i32::MAX, i32::MIN, i32::MAX, i32::MIN);
        for (i, (label, code, r, big)) in items.into_iter().enumerate() {
            let b = s.clone_element(button_t, &format!("cp_bm_g{g}_b{i}"))?;
            let prefix = if big { "btn" } else { "opt" };
            for (off, state) in [(112, "u"), (116, "o"), (120, "w"), (124, "at"), (128, "at"), (132, "at")] {
                s.set_str_field(b, off, &tex(&format!("{prefix}_{state}")))?;
            }
            s.set_rect(b, r)?;
            s.set_u32(b, VISIBLE, 0)?;
            let mut evs = sounds.clone();
            evs.push(Event::new(event::SELECT, "ConsoleExecute", &format!("UI_Lua {code}")));
            s.set_events(b, &evs)?;
            let l = s.clone_element(label_t, &format!("cp_bm_g{g}_b{i}_label"))?;
            s.set_text(l, &label)?;
            s.set_str_field(l, 108, if big { "pc_title_font_4" } else { "pc_title_font_2" })?;
            s.set_u32(l, 128, 1)?; // no meio
            s.set_rect(l, Rect::new(r.x0 + 4, r.x1 - if big { 40 } else { 4 }, r.y0 + 3, r.y1 - 3))?;
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
    // `count` botões entre `x0` e `x1`
    let cells = |count: i32, i: i32, x0: i32, x1: i32| -> (i32, i32) {
        let gap = 6;
        let w = (x1 - x0 - gap * (count - 1)) / count;
        let x = x0 + (w + gap) * i;
        (x, x + w)
    };
    // uma linha: título em cima, botões embaixo
    let mut y = Y0 + 62;
    let label_h = 28;
    let button_h = 34;
    let mut row = |s: &mut Scene, panel: &mut Vec<u32>, title: &str, x0: i32, x1: i32, y: i32, items: Vec<(String, String)>| -> Result<()> {
        text(s, panel, title, "pc_title_font_2", Rect::new(x0, x1, y, y + label_h))?;
        let count = items.len() as i32;
        let list = items
            .into_iter()
            .enumerate()
            .map(|(i, (l, c))| {
                let (a, b) = cells(count, i as i32, x0, x1);
                (l, c, Rect::new(a, b, y + label_h, y + label_h + button_h), false)
            })
            .collect();
        group(s, panel, list)
    };
    let mid = (IN0 + IN1) / 2;

    row(&mut s, &mut panel, t.players, IN0, IN1, y, PLAYERS.iter().map(|p| (p.to_string(), format!("CPBM_players = {p}"))).collect())?;
    y += ROW;
    row(&mut s, &mut panel, t.teams, IN0, IN1, y, t.team_labels.iter().enumerate().map(|(i, l)| (l.to_string(), format!("CPBM_teams = {}", [2, 3, 4, 0][i]))).collect())?;
    y += ROW;
    row(&mut s, &mut panel, t.ai, IN0, IN1, y, t.ai_labels.iter().enumerate().map(|(i, l)| (l.to_string(), format!("CPBM_ai = '{}'", AI_KEYS[i]))).collect())?;
    y += ROW;
    row(&mut s, &mut panel, t.faction, IN0, IN1, y, t.faction_labels.iter().enumerate().map(|(i, l)| (l.to_string(), format!("CPBM_faction = {i}"))).collect())?;
    y += ROW;
    row(&mut s, &mut panel, t.victory, IN0, mid + 70, y, t.victory_labels.iter().enumerate().map(|(i, l)| (l.to_string(), format!("CPBM_victory = '{}'", VICTORY_KEYS[i]))).collect())?;
    row(&mut s, &mut panel, t.units, mid + 82, IN1, y, UNIT_CAPS.iter().map(|u| (u.to_string(), format!("CPBM_units = {u}"))).collect())?;
    y += ROW;
    // mapas: 2 colunas
    text(&mut s, &mut panel, t.map, "pc_title_font_2", Rect::new(IN0, IN1, y, y + label_h))?;
    let items = maps
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let (x0, x1) = cells(2, i as i32 % 2, IN0, IN1);
            let my = y + label_h + 38 * (i as i32 / 2);
            let name: String = m.name.chars().filter(|c| !c.is_control()).take(26).collect();
            (format!("[{}] {}", m.bases, name.to_uppercase()), format!("CPBM_map = '{}'", m.path), Rect::new(x0, x1, my, my + button_h), false)
        })
        .collect();
    group(&mut s, &mut panel, items)?;
    // começar
    text(&mut s, &mut panel, t.note, "pc_body_font_narrow_2", Rect::new(IN0, IN1 - 300, Y1 - 60, Y1 - 24))?;
    let items = vec![(t.start.to_string(), start_code(&first.path), Rect::new(IN1 - 290, IN1, Y1 - 84, Y1 - 14), true)];
    group(&mut s, &mut panel, items)?;

    let mut kids = s.children(host)?;
    kids.extend(panel);
    s.set_children(host, &kids)?;
    Ok(s.to_bytes())
}

/// Os mapas para a lista: os de mais bases primeiro (os grandes do jogador), mas sempre com alguns
/// do jogo para as partidas de sempre.
pub fn pick_maps(all: &[crate::bigmatch::MatchMap]) -> Vec<MenuMap> {
    let mut v: Vec<(bool, MenuMap)> = all
        .iter()
        .filter(|m| m.armies.len() >= 2)
        .map(|m| (m.source == "Jogo", MenuMap { path: m.path.clone(), name: m.name.clone(), bases: m.armies.len(), size: m.size[0] }))
        .collect();
    v.sort_by(|a, b| b.1.bases.cmp(&a.1.bases).then(a.1.name.cmp(&b.1.name)));
    v.dedup_by(|a, b| a.1.path.eq_ignore_ascii_case(&b.1.path));
    let stock_slots = 3.min(v.iter().filter(|m| m.0).count());
    let mut out: Vec<MenuMap> = Vec::new();
    let mut stock_taken = 0;
    for (stock, m) in &v {
        let room = MAX_MAPS - out.len();
        if room == 0 {
            break;
        }
        // guarda lugar para os do jogo
        if !stock && room <= stock_slots - stock_taken {
            continue;
        }
        if *stock {
            stock_taken += 1;
        }
        out.push(m.clone());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_goes_hidden_into_the_skirmish_submenu() {
        // a tela inicial do jogo (CP_TEST_SCENE), no visual novo
        let Ok(path) = std::env::var("CP_TEST_SCENE") else { return };
        let look = crate::mainmenu::Look::Commander(crate::mainmenu::Commander::default());
        let menu = crate::mainmenu::build_with(&std::fs::read(path).unwrap(), &Default::default(), &look).unwrap().scene;
        let maps = vec![
            MenuMap { path: "/maps/CP_32/CP_32_scenario.lua".into(), name: "Meu mapa 32".into(), bases: 32, size: 2048 },
            MenuMap { path: "/maps/SC2_MP_308/SC2_MP_308_scenario.lua".into(), name: "Seton's Clutch".into(), bases: 8, size: 1024 },
        ];
        let out = add_panel(&menu, &maps, &PT).unwrap();
        let s = Scene::parse(&out).unwrap();
        let host = s.by_name("g_skirmish_options").unwrap().id;
        let kids = s.children(host).unwrap();
        let bg = s.by_name("cp_bm_bg").unwrap().id;
        assert!(kids.contains(&bg));
        // tudo do painel começa escondido
        for e in s.elements().unwrap().iter().filter(|e| e.name.starts_with("cp_bm")) {
            assert_eq!(s.u32_field(e.id, VISIBLE).unwrap(), 0, "{}", e.name);
        }
        let start = s.by_name("cp_bm_g8_b0").unwrap().id;
        assert!(s.events(s.by_name("rb_creategame").unwrap().id).unwrap().iter().all(|e| e.name == "PlaySound"));
        assert!(s.events(start).unwrap().iter().any(|e| e.param.contains("CPBigMatchQuick(CPBM_map or '/maps/CP_32/CP_32_scenario.lua'")));
        // sem mapas, nada muda
        assert_eq!(add_panel(&menu, &[], &PT).unwrap(), menu);
        if let Ok(dest) = std::env::var("CP_TEST_BM_OUT") {
            std::fs::write(dest, &out).unwrap();
        }
    }

    #[test]
    fn maps_are_picked_and_codes_are_safe() {
        let mk = |p: &str, n: usize| crate::bigmatch::MatchMap {
            path: p.into(),
            id: "x".into(),
            name: p.into(),
            armies: vec![String::new(); n],
            starts: vec![],
            size: [1024, 1024],
            source: "Jogo".into(),
            lobby_risk: false,
        };
        let picked = pick_maps(&[mk("/maps/a", 2), mk("/maps/b", 16), mk("/maps/c", 8)]);
        assert_eq!(picked.iter().map(|m| m.bases).collect::<Vec<_>>(), [16, 8, 2]);
        assert!(!safe("/maps/x'y"));
        assert!(start_code("/maps/a").contains("CPBM_players or 8"));
    }
}
