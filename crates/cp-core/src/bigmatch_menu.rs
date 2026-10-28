//! Partida grande dentro do jogo: um painel que aparece ao lado do submenu da Escaramuça na tela
//! inicial nova, com jogadores (até 32), times, dificuldade da IA e o mapa (os maiores que o
//! jogador tem, os do launcher também). Cada escolha é um botão de opção do próprio jogo (fica
//! aceso) que guarda o valor em Lua; "Começar" monta a partida com o código da Partida grande
//! (`CPBigMatchQuick` no `SinglePlayerLaunch.lua`, do mod `cp-partida-grande`).
//!
//! O painel mora dentro do grupo `g_skirmish_options` da própria tela inicial: o jogo só sabe
//! mostrar e esconder os quatro submenus dele (`ShowMainMenuGroup`) e não abre cenas novas
//! (`UILoadScene` carrega a cena, mas ela não aparece). Todos os elementos do painel começam
//! escondidos (o campo "visível" do registro em 0), como os itens dos submenus.

use crate::error::{Error, Result};
use crate::mainmenu::TEX;
use crate::scene::{event, kind, Anchors, Event, Rect, Scene};

/// Mapas na lista, no máximo.
pub const MAX_MAPS: usize = 6;
/// Campo "visível" de um registro (1 = aparece sozinho; 0 = só quando o grupo dele é mostrado).
const VISIBLE: usize = 32;

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
    pub map: &'static str,
    pub team_labels: [&'static str; 4],
    pub ai_labels: [&'static str; 4],
    pub bases: &'static str,
    pub start: &'static str,
    pub note: &'static str,
}

pub const PT: Texts = Texts {
    title: "PARTIDA GRANDE · ATÉ 32 JOGADORES",
    players: "JOGADORES",
    teams: "TIMES",
    ai: "INTELIGÊNCIA ARTIFICIAL",
    map: "MAPA",
    team_labels: ["2 TIMES", "3 TIMES", "4 TIMES", "CADA UM POR SI"],
    ai_labels: ["FÁCIL", "NORMAL", "DIFÍCIL", "TRAPAÇA"],
    bases: "bases",
    start: "COMEÇAR",
    note: "Sem escolher: 8 jogadores, 2 times, IA normal e o primeiro mapa.",
};

pub const EN: Texts = Texts {
    title: "BIG MATCH · UP TO 32 PLAYERS",
    players: "PLAYERS",
    teams: "TEAMS",
    ai: "ARTIFICIAL INTELLIGENCE",
    map: "MAP",
    team_labels: ["2 TEAMS", "3 TEAMS", "4 TEAMS", "FREE FOR ALL"],
    ai_labels: ["EASY", "NORMAL", "HARD", "CHEATING"],
    bases: "bases",
    start: "START",
    note: "Without choosing: 8 players, 2 teams, normal AI and the first map.",
};

const PLAYERS: [u32; 9] = [4, 6, 8, 10, 12, 16, 20, 24, 32];
const AI_KEYS: [&str; 4] = ["Easy", "Normal", "Hard", "Cheat"];

// medidas do painel (unidades da cena, no quadro 16:9 da "Comandante": o submenu vai de 173 a 593)
const X0: i32 = 611;
const X1: i32 = 1440;
const Y0: i32 = 404;
const Y1: i32 = 920;
const IN0: i32 = X0 + 20;
const IN1: i32 = X1 - 20;

fn find(s: &Scene, name: &str) -> Result<u32> {
    s.by_name(name).map(|e| e.id).map_err(|_| Error::Other(format!("a tela inicial do jogo é diferente do esperado (sem {name})")))
}

fn safe(t: &str) -> bool {
    !t.is_empty() && t.chars().all(|c| c.is_ascii_graphic() && !matches!(c, '\'' | '"' | '\\'))
}

/// Código do botão "Começar".
pub fn start_code(first_map: &str) -> String {
    format!(
        "local m = import('/lua/SinglePlayerLaunch.lua') if m.CPBigMatchQuick then m.CPBigMatchQuick(CPBM_map or '{first_map}', CPBM_players or 8, CPBM_teams or 2, CPBM_ai or 'Normal') else LOG('CommandProject: mod da Partida grande ausente') end"
    )
}

/// Põe o painel da Partida grande no submenu da Escaramuça da tela inicial `scene` (já no visual
/// "Comandante"). Sem mapas de 4 bases ou mais, devolve a cena como está.
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
    let mut panel: Vec<u32> = Vec::new();
    let hide = |s: &mut Scene, id: u32| s.set_u32(id, VISIBLE, 0);

    // fundo
    let bg = s.clone_element(bitmap_t, "cp_bm_bg")?;
    s.set_str_field(bg, 112, &tex("p9_c"))?;
    s.set_rect(bg, Rect::new(X0, X1, Y0, Y1))?;
    hide(&mut s, bg)?;
    panel.push(bg);
    // moldura (os cantos e as bordas do painel dos outros menus)
    let edge = 32;
    for (n, r) in [
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
    text(&mut s, &mut panel, t.title, "pc_title_font_4", Rect::new(IN0, IN1, Y0 + 8, Y0 + 50))?;

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
            s.set_rect(l, Rect::new(r.x0 + 6, r.x1 - if big { 40 } else { 6 }, r.y0 + 4, r.y1 - 4))?;
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
    let row = |count: i32, i: i32, gap: i32| -> (i32, i32) {
        let w = (IN1 - IN0 - gap * (count - 1)) / count;
        let x = IN0 + (w + gap) * i;
        (x, x + w)
    };

    // jogadores: uma linha de 9
    text(&mut s, &mut panel, t.players, "pc_title_font_2", Rect::new(IN0, IN1, Y0 + 52, Y0 + 82))?;
    let items = PLAYERS
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let (x0, x1) = row(9, i as i32, 6);
            (p.to_string(), format!("CPBM_players = {p}"), Rect::new(x0, x1, Y0 + 84, Y0 + 122), false)
        })
        .collect();
    group(&mut s, &mut panel, items)?;
    // times
    text(&mut s, &mut panel, t.teams, "pc_title_font_2", Rect::new(IN0, IN1, Y0 + 126, Y0 + 156))?;
    let items = t
        .team_labels
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let (x0, x1) = row(4, i as i32, 6);
            (l.to_string(), format!("CPBM_teams = {}", [2, 3, 4, 0][i]), Rect::new(x0, x1, Y0 + 158, Y0 + 196), false)
        })
        .collect();
    group(&mut s, &mut panel, items)?;
    // inteligência artificial
    text(&mut s, &mut panel, t.ai, "pc_title_font_2", Rect::new(IN0, IN1, Y0 + 200, Y0 + 230))?;
    let items = t
        .ai_labels
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let (x0, x1) = row(4, i as i32, 6);
            (l.to_string(), format!("CPBM_ai = '{}'", AI_KEYS[i]), Rect::new(x0, x1, Y0 + 232, Y0 + 270), false)
        })
        .collect();
    group(&mut s, &mut panel, items)?;
    // mapas: 2 colunas
    text(&mut s, &mut panel, t.map, "pc_title_font_2", Rect::new(IN0, IN1, Y0 + 274, Y0 + 304))?;
    let items = maps
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let (x0, x1) = row(2, i as i32 % 2, 8);
            let y = Y0 + 306 + 42 * (i as i32 / 2);
            let name: String = m.name.chars().filter(|c| !c.is_control()).take(24).collect();
            (format!("{} · {} {}", name.to_uppercase(), m.bases, t.bases), format!("CPBM_map = '{}'", m.path), Rect::new(x0, x1, y, y + 36), false)
        })
        .collect();
    group(&mut s, &mut panel, items)?;
    // começar
    text(&mut s, &mut panel, t.note, "pc_body_font_narrow_2", Rect::new(IN0, IN1 - 290, Y1 - 62, Y1 - 24))?;
    let items = vec![(t.start.to_string(), start_code(&first.path), Rect::new(IN1 - 280, IN1, Y1 - 82, Y1 - 14), true)];
    group(&mut s, &mut panel, items)?;

    let mut kids = s.children(host)?;
    kids.extend(panel);
    s.set_children(host, &kids)?;
    Ok(s.to_bytes())
}

/// Os mapas para a lista: os de mais bases primeiro (só os que dão uma partida de verdade).
pub fn pick_maps(all: &[crate::bigmatch::MatchMap]) -> Vec<MenuMap> {
    let mut v: Vec<MenuMap> = all
        .iter()
        .filter(|m| m.armies.len() >= 4)
        .map(|m| MenuMap { path: m.path.clone(), name: m.name.clone(), bases: m.armies.len(), size: m.size[0] })
        .collect();
    v.sort_by(|a, b| b.bases.cmp(&a.bases).then(a.name.cmp(&b.name)));
    v.dedup_by(|a, b| a.path.eq_ignore_ascii_case(&b.path));
    v.truncate(MAX_MAPS);
    v
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
        let start = s.by_name("cp_bm_g5_b0").unwrap().id;
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
        assert_eq!(picked.iter().map(|m| m.bases).collect::<Vec<_>>(), [16, 8]);
        assert!(!safe("/maps/x'y"));
        assert!(start_code("/maps/a").contains("CPBM_players or 8"));
    }
}
