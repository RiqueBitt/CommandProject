//! Tela "Partida grande" dentro do jogo (cena nova `cp_bigmatch`, aberta pelo submenu Escaramuça da
//! tela inicial): jogadores (até 32), times, dificuldade da IA e o mapa (os maiores que o jogador
//! tem, os do launcher também). Cada escolha é um botão de opção do próprio jogo (fica aceso) que
//! guarda o valor em Lua; "Começar" monta a partida com o código da Partida grande
//! (`CPBigMatchQuick` no `SinglePlayerLaunch.lua`, do mod `cp-partida-grande`).
//!
//! A cena é montada a partir da tela inicial do jogo: só os elementos copiados ficam
//! ([`Scene::retain`]), com o visual da "Comandante".

use crate::error::{Error, Result};
use crate::mainmenu::TEX;
use crate::scene::{event, kind, Anchors, Event, Rect, Scene};
use std::collections::BTreeSet;

/// Nome da cena (`UILoadScene('cp_bigmatch')`) e o arquivo dela no jogo.
pub const SCENE: &str = "cp_bigmatch";
pub const SCENE_PATH: &str = "/ui/scenes/cp_bigmatch/pc_cp_bigmatch.win.bdf";
/// Mapas na lista, no máximo.
pub const MAX_MAPS: usize = 9;

/// Um mapa da lista: cenário, nome e bases.
#[derive(Debug, Clone, PartialEq)]
pub struct MenuMap {
    pub path: String,
    pub name: String,
    pub bases: usize,
    pub size: u32,
}

/// Textos da tela (no idioma do jogo).
pub struct Texts {
    pub title: &'static str,
    pub hint: &'static str,
    pub players: &'static str,
    pub teams: &'static str,
    pub ai: &'static str,
    pub map: &'static str,
    pub team_labels: [&'static str; 4],
    pub ai_labels: [&'static str; 4],
    pub bases: &'static str,
    pub start: &'static str,
    pub back: &'static str,
    pub note: &'static str,
}

pub const PT: Texts = Texts {
    title: "PARTIDA GRANDE",
    hint: "Escolha e clique em Começar. Sem escolher: 8 jogadores, 2 times, IA normal, o primeiro mapa.",
    players: "JOGADORES",
    teams: "TIMES",
    ai: "INTELIGÊNCIA ARTIFICIAL",
    map: "MAPA",
    team_labels: ["2 TIMES", "3 TIMES", "4 TIMES", "TODOS CONTRA TODOS"],
    ai_labels: ["FÁCIL", "NORMAL", "DIFÍCIL", "TRAPAÇA"],
    bases: "bases",
    start: "COMEÇAR",
    back: "VOLTAR",
    note: "Até 32 jogadores; nos mapas grandes, menos (memória do jogo). Mais opções na Partida grande do launcher.",
};

pub const EN: Texts = Texts {
    title: "BIG MATCH",
    hint: "Choose and click Start. Without choosing: 8 players, 2 teams, normal AI, the first map.",
    players: "PLAYERS",
    teams: "TEAMS",
    ai: "ARTIFICIAL INTELLIGENCE",
    map: "MAP",
    team_labels: ["2 TEAMS", "3 TEAMS", "4 TEAMS", "FREE FOR ALL"],
    ai_labels: ["EASY", "NORMAL", "HARD", "CHEATING"],
    bases: "bases",
    start: "START",
    back: "BACK",
    note: "Up to 32 players; fewer on big maps (game memory). More options in the launcher's Big match.",
};

const PLAYERS: [u32; 9] = [4, 6, 8, 10, 12, 16, 20, 24, 32];
const AI_KEYS: [&str; 4] = ["Easy", "Normal", "Hard", "Cheat"];

fn find(s: &Scene, name: &str) -> Result<u32> {
    s.by_name(name).map(|e| e.id).map_err(|_| Error::Other(format!("a tela inicial do jogo é diferente do esperado (sem {name})")))
}

fn safe(t: &str) -> bool {
    !t.is_empty() && t.chars().all(|c| c.is_ascii_graphic() && !matches!(c, '\'' | '"' | '\\'))
}

/// Código do botão "Começar".
pub fn start_code(first_map: &str) -> String {
    format!(
        "local m = import('/lua/SinglePlayerLaunch.lua') if m.CPBigMatchQuick then m.CPBigMatchQuick(CPBM_map or '{first_map}', CPBM_players or 8, CPBM_teams or 2, CPBM_ai or 'Normal') else UIShowDialog('Partida grande: ligue a Tela inicial nova no launcher e jogue por ele.', 'OK', '', '', '', '', '', false) end"
    )
}

/// Monta a cena a partir da tela inicial do jogo (`main_menu`).
pub fn build(main_menu: &[u8], maps: &[MenuMap], t: &Texts) -> Result<Vec<u8>> {
    let maps: Vec<&MenuMap> = maps.iter().filter(|m| safe(&m.path) && m.path.starts_with("/maps/")).take(MAX_MAPS).collect();
    let first = maps.first().ok_or_else(|| Error::Other("nenhum mapa de escaramuça para a partida grande".into()))?;
    let mut s = Scene::parse(main_menu)?;
    let tex = |n: &str| format!("{TEX}{n}.dds");
    let tint = find(&s, "black_overlay")?;
    let group_t = find(&s, "rg_menu_group")?;
    let button_t = find(&s, "rb_options")?;
    let label_t = s.children(button_t)?.into_iter().find(|c| s.by_id(*c).map(|e| e.kind == kind::TEXT).unwrap_or(false)).ok_or_else(|| Error::Other("botão modelo sem texto".into()))?;
    let text_t = find(&s, "label_chat")?;
    let sounds: Vec<Event> = s.events(button_t)?.into_iter().filter(|e| e.name == "PlaySound").collect();
    let mut keep: BTreeSet<u32> = BTreeSet::new();

    // fundo: o tom escuro por cima do vídeo
    s.set_str_field(tint, 112, &tex("tint"))?;
    s.set_rect(tint, Rect::new(-448, 1472, -156, 924))?;
    s.set_anchors(tint, Anchors { left: Some(0), right: Some(0), top: Some(0), bottom: Some(0), ..Default::default() })?;
    keep.insert(tint);

    let mut n = 0;
    let mut text = |s: &mut Scene, keep: &mut BTreeSet<u32>, txt: &str, font: &str, r: Rect| -> Result<u32> {
        n += 1;
        let id = s.clone_element(text_t, &format!("cp_bm_text{n}"))?;
        s.set_text(id, txt)?;
        s.set_str_field(id, 108, font)?;
        s.set_u32(id, 128, 0)?;
        s.set_rect(id, r)?;
        s.set_anchors(id, Anchors { x: Some(r.x0), y: Some(r.y0), ..Default::default() })?;
        keep.insert(id);
        Ok(id)
    };
    text(&mut s, &mut keep, t.title, "pc_title_font_5", Rect::new(-373, 527, -120, -64))?;
    text(&mut s, &mut keep, t.hint, "pc_body_font_narrow_3", Rect::new(-373, 1050, -58, -30))?;
    text(&mut s, &mut keep, t.note, "pc_body_font_narrow_3", Rect::new(-373, 1050, 620, 650))?;

    // um grupo de botões de opção (cada um com o código dele)
    let mut g = 0;
    let mut group = |s: &mut Scene, keep: &mut BTreeSet<u32>, items: Vec<(String, String, Rect, bool)>| -> Result<()> {
        g += 1;
        let gid = s.clone_element(group_t, &format!("cp_bm_group{g}"))?;
        s.set_events(gid, &[])?;
        let mut kids = Vec::new();
        let mut bound = Rect::new(i32::MAX, i32::MIN, i32::MAX, i32::MIN);
        for (i, (label, code, r, big)) in items.into_iter().enumerate() {
            let b = s.clone_element(button_t, &format!("cp_bm_g{g}_b{i}"))?;
            let prefix = if big { "btn" } else { "sub" };
            for (off, state) in [(112, "u"), (116, "o"), (120, "w"), (124, "at"), (128, "at"), (132, "at")] {
                s.set_str_field(b, off, &tex(&format!("{prefix}_{state}")))?;
            }
            s.set_rect(b, r)?;
            let mut evs = sounds.clone();
            evs.push(Event::new(event::SELECT, "ConsoleExecute", &format!("UI_Lua {code}")));
            s.set_events(b, &evs)?;
            let l = s.clone_element(label_t, &format!("cp_bm_g{g}_b{i}_label"))?;
            s.set_text(l, &label)?;
            s.set_str_field(l, 108, if big { "pc_title_font_4" } else { "pc_title_font_3" })?;
            s.set_rect(l, Rect::new(r.x0 + if big { 36 } else { 22 }, r.x1 - 40, r.y0 + 8, r.y1 - 8))?;
            s.set_children(b, &[l])?;
            keep.extend([b, l]);
            kids.push(b);
            bound = Rect::new(bound.x0.min(r.x0), bound.x1.max(r.x1), bound.y0.min(r.y0), bound.y1.max(r.y1));
        }
        s.set_children(gid, &kids)?;
        s.set_rect(gid, bound)?;
        s.set_anchors(gid, Anchors { x: Some(bound.x0), y: Some(bound.y0), ..Default::default() })?;
        keep.insert(gid);
        Ok(())
    };

    // jogadores: 3 × 3
    text(&mut s, &mut keep, t.players, "pc_title_font_3", Rect::new(-373, 100, 0, 30))?;
    let items = PLAYERS
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let (x, y) = (-373 + 182 * (i as i32 % 3), 36 + 62 * (i as i32 / 3));
            (p.to_string(), format!("CPBM_players = {p}"), Rect::new(x, x + 170, y, y + 52), false)
        })
        .collect();
    group(&mut s, &mut keep, items)?;
    // times: 2 × 2
    text(&mut s, &mut keep, t.teams, "pc_title_font_3", Rect::new(-373, 100, 236, 266))?;
    let items = t
        .team_labels
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let teams = [2, 3, 4, 0][i];
            let (x, y) = (-373 + 274 * (i as i32 % 2), 272 + 62 * (i as i32 / 2));
            (l.to_string(), format!("CPBM_teams = {teams}"), Rect::new(x, x + 262, y, y + 52), false)
        })
        .collect();
    group(&mut s, &mut keep, items)?;
    // inteligência artificial: 2 × 2
    text(&mut s, &mut keep, t.ai, "pc_title_font_3", Rect::new(-373, 200, 410, 440))?;
    let items = t
        .ai_labels
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let (x, y) = (-373 + 274 * (i as i32 % 2), 446 + 62 * (i as i32 / 2));
            (l.to_string(), format!("CPBM_ai = '{}'", AI_KEYS[i]), Rect::new(x, x + 262, y, y + 52), false)
        })
        .collect();
    group(&mut s, &mut keep, items)?;
    // mapas
    text(&mut s, &mut keep, t.map, "pc_title_font_3", Rect::new(330, 800, 0, 30))?;
    let items = maps
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let y = 36 + 62 * i as i32;
            let name: String = m.name.chars().filter(|c| !c.is_control()).take(34).collect();
            let km = m.size as f32 / 51.2;
            (format!("{} · {} {} · {:.0} km", name.to_uppercase(), m.bases, t.bases, km), format!("CPBM_map = '{}'", m.path), Rect::new(330, 1050, y, y + 52), false)
        })
        .collect();
    group(&mut s, &mut keep, items)?;
    // voltar e começar
    let items = vec![
        (t.back.to_string(), format!("UICloseScene('{SCENE}')"), Rect::new(-373, -40, 700, 774), true),
        (t.start.to_string(), start_code(&first.path), Rect::new(717, 1050, 700, 774), true),
    ];
    group(&mut s, &mut keep, items)?;

    s.retain(&keep)?;
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

    /// Com `CP_TEST_SCENE` (a tela inicial do jogo) monta a cena de verdade (e grava em
    /// `CP_TEST_BM_OUT`).
    #[test]
    fn real_scene_when_available() {
        let Ok(path) = std::env::var("CP_TEST_SCENE") else { return };
        let maps = vec![
            MenuMap { path: "/maps/CP_32/CP_32_scenario.lua".into(), name: "Meu mapa 32".into(), bases: 32, size: 2048 },
            MenuMap { path: "/maps/SC2_MP_308/SC2_MP_308_scenario.lua".into(), name: "Seton's Clutch".into(), bases: 8, size: 1024 },
        ];
        let out = build(&std::fs::read(path).unwrap(), &maps, &PT).unwrap();
        let s = Scene::parse(&out).unwrap();
        let els = s.elements().unwrap();
        assert!(els.iter().all(|e| e.name.starts_with("cp_bm") || e.name == "black_overlay"), "só o que a tela usa");
        let start = els.iter().find(|e| e.name == "cp_bm_g5_b1").unwrap();
        assert!(s.events(start.id).unwrap().iter().any(|e| e.param.contains("CPBigMatchQuick(CPBM_map or '/maps/CP_32/CP_32_scenario.lua'")));
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
