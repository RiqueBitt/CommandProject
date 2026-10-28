//! Partida grande dentro da sala de escaramuça do próprio jogo ("Criar jogo"): um painel do lado
//! esquerdo da sala, dentro da mesma janela, para as partidas com mais de 8 jogadores contra a IA —
//! jogadores (10 a 32), times, dificuldade da IA e o mapa (os grandes do jogador primeiro). A sala
//! do jogo continua igual para as partidas de até 8 (facção, cor, opções). Cada escolha é um botão
//! de opção (fica aceso) que guarda o valor em Lua; "Iniciar partida grande" monta a partida com
//! `CPBigMatchQuick` (no `SinglePlayerLaunch.lua`, do mod `cp-partida-grande`).
//!
//! A sala é nativa (só 8 vagas, e o jogo não abre cenas novas: `UILoadScene` carrega mas não
//! mostra), então o painel são elementos novos na própria cena da sala; a cena não tem grupos de
//! botões de opção, e o primeiro é feito de um grupo comum ([`Scene::clone_as`]).

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
    /// rótulos curtos (botões estreitos do painel da sala)
    pub short_team_labels: [&'static str; 4],
    pub short_ai_labels: [&'static str; 4],
    pub start: &'static str,
    pub note: &'static str,
    /// título, explicação e botão do painel na sala do jogo
    pub lobby_title: &'static str,
    pub lobby_sub: &'static str,
    pub lobby_start: &'static str,
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
    ai_labels: ["FÁCIL", "NORMAL", "DIFÍCIL", "EXTREMA"],
    faction_labels: ["ALEATÓRIA", "UEF", "CYBRAN", "ILLUMINATE"],
    victory_labels: ["COMANDANTE", "DESTRUIR TUDO", "SEM FIM"],
    short_team_labels: ["2", "3", "4", "TODOS"],
    short_ai_labels: ["FÁCIL", "NORMAL", "DIFÍCIL", "EXTREMA"],
    start: "COMEÇAR",
    note: "Sem escolher: 8 jogadores, 2 times, IA normal e o primeiro mapa.",
    lobby_title: "PARTIDA GRANDE",
    lobby_sub: "Mais de 8 jogadores contra a IA. Suas escolhas ficam guardadas.",
    lobby_start: "INICIAR PARTIDA GRANDE",
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
    short_team_labels: ["2", "3", "4", "FFA"],
    short_ai_labels: ["EASY", "NORMAL", "HARD", "EXTREME"],
    start: "START",
    note: "Without choosing: 8 players, 2 teams, normal AI and the first map.",
    lobby_title: "BIG MATCH",
    lobby_sub: "More than 8 players against the AI. Your choices are kept.",
    lobby_start: "START BIG MATCH",
};

const AI_KEYS: [&str; 4] = ["Easy", "Normal", "Hard", "Cheat"];
const VICTORY_KEYS: [&str; 3] = ["demoralization", "domination", "sandbox"];
const UNIT_CAPS: [u32; 3] = [250, 500, 1000];

// medidas do painel (unidades da cena da sala, 640 × 480: a área 16:9 vai de x −640 a 1280; a
// janela da sala começa em −209)
const LX0: i32 = -620;
const LX1: i32 = -224;
const LY0: i32 = -72;
const LY1: i32 = 688;
const LIN0: i32 = LX0 + 16;
const LIN1: i32 = LX1 - 16;
/// Mapas na lista da sala.
pub const LOBBY_MAPS: usize = 8;
/// Jogadores (as partidas de até 8 são as da própria sala).
const LOBBY_PLAYERS: [u32; 6] = [10, 12, 16, 20, 24, 32];

fn find(s: &Scene, name: &str) -> Result<u32> {
    s.by_name(name).map(|e| e.id).map_err(|_| Error::Other(format!("a tela inicial do jogo é diferente do esperado (sem {name})")))
}

pub(crate) fn safe(t: &str) -> bool {
    !t.is_empty() && t.chars().all(|c| c.is_ascii_graphic() && !matches!(c, '\'' | '"' | '\\'))
}

/// Código do botão "Começar".
pub fn start_code(first_map: &str) -> String {
    format!(
        "local m = import('/lua/SinglePlayerLaunch.lua') if m.CPBigMatchFromMenu then m.CPBigMatchFromMenu('{first_map}') else LOG('CommandProject: mod da Partida grande ausente') end"
    )
}

/// Põe o painel da Partida grande na sala de escaramuça do jogo (`scene`, a cena
/// `frontend_skirmish` já no visual novo): à esquerda da sala, dentro da janela dela (que fica mais
/// larga). Sem mapas, devolve a cena como está.
pub fn add_lobby_panel(scene: &[u8], maps: &[MenuMap], t: &Texts) -> Result<Vec<u8>> {
    add_lobby_panel_with(scene, maps, t, &[])
}

/// Textura da miniatura do mapa `i` da lista da sala (estado `u`, `o` ou `at`).
pub fn tile_texture(i: usize, state: &str) -> String {
    format!("{TEX}map{i}_{state}.dds")
}

/// Como [`add_lobby_panel`]; `thumbs[i]` diz se o mapa `i` tem miniatura ([`tile_texture`]): com
/// ela, o botão do mapa é a própria imagem do mapa.
pub fn add_lobby_panel_with(scene: &[u8], maps: &[MenuMap], t: &Texts, thumbs: &[bool]) -> Result<Vec<u8>> {
    let maps: Vec<&MenuMap> = maps.iter().filter(|m| safe(&m.path) && m.path.starts_with("/maps/")).take(LOBBY_MAPS).collect();
    let Some(first) = maps.first() else { return Ok(scene.to_vec()) };
    let mut s = Scene::parse(scene)?;
    let tex = |n: &str| format!("{TEX}{n}.dds");
    let host = find(&s, "g_main")?;
    let group_t = find(&s, "g_options")?;
    let button_t = find(&s, "p1_ready")?;
    let text_t = find(&s, "label_map")?;
    let bitmap_t = find(&s, "playerlist_bg")?;
    let launch_t = find(&s, "btn_launch")?;
    let launch_label_t = find(&s, "label_launch")?;
    let sounds: Vec<Event> = s.events(launch_t)?.into_iter().filter(|e| e.name == "PlaySound").collect();
    let order = s.u32_field(text_t, ORDER)?;
    let mut panel: Vec<u32> = Vec::new();
    // sem o grupo de opções da cena por baixo: sem eventos, sem âncoras, visível
    let show = |s: &mut Scene, id: u32| -> Result<()> {
        s.set_u32(id, VISIBLE, 1)?;
        s.set_u32(id, ORDER, order)
    };

    // a janela da sala fica mais larga e o painel entra nela
    if let Ok(bg) = find(&s, "main_bg") {
        if let Some(r) = s.rect(bg)? {
            s.set_rect(bg, Rect::new(LX0 - 16, r.x1, r.y0, r.y1.max(LY1 + 14)))?;
        }
    }
    // fundo do painel e o filete embaixo do título
    let bg = s.clone_element(bitmap_t, "cp_lb_bg")?;
    s.set_str_field(bg, 112, &tex("p9_c"))?;
    s.set_rect(bg, Rect::new(LX0, LX1, LY0, LY1))?;
    show(&mut s, bg)?;
    panel.push(bg);
    let line = s.clone_element(bitmap_t, "cp_lb_line")?;
    s.set_str_field(line, 112, &tex("line"))?;
    s.set_rect(line, Rect::new(LIN0, LIN1, LY0 + 62, LY0 + 65))?;
    show(&mut s, line)?;
    panel.push(line);

    let mut n = 0;
    let mut text = |s: &mut Scene, panel: &mut Vec<u32>, txt: &str, font: &str, r: Rect| -> Result<u32> {
        n += 1;
        let id = s.clone_element(text_t, &format!("cp_lb_text{n}"))?;
        s.set_events(id, &[])?;
        s.set_text(id, txt)?;
        s.set_str_field(id, 108, font)?;
        s.set_u32(id, 128, 0)?;
        s.set_rect(id, r)?;
        show(s, id)?;
        panel.push(id);
        Ok(id)
    };
    text(&mut s, &mut panel, t.lobby_title, "pc_title_font_4", Rect::new(LIN0, LIN1, LY0 + 8, LY0 + 40))?;
    text(&mut s, &mut panel, t.lobby_sub, "pc_body_font_narrow_2", Rect::new(LIN0, LIN1, LY0 + 38, LY0 + 60))?;

    // o primeiro grupo de botões de opção sai de um grupo comum; os outros, dele
    let mut radio_t: Option<u32> = None;
    let mut g = 0;
    let mut group = |s: &mut Scene, panel: &mut Vec<u32>, items: Vec<(String, String, Rect)>, tiles: Option<&[bool]>| -> Result<()> {
        g += 1;
        let gid = match radio_t {
            Some(r) => s.clone_element(r, &format!("cp_lb_group{g}"))?,
            None => {
                let r = s.clone_as(group_t, kind::RADIO_GROUP, &format!("cp_lb_group{g}"))?;
                radio_t = Some(r);
                r
            }
        };
        s.set_events(gid, &[])?;
        s.set_anchors(gid, Anchors::default())?;
        show(s, gid)?;
        let mut kids = Vec::new();
        let mut bound = Rect::new(i32::MAX, i32::MIN, i32::MAX, i32::MIN);
        for (i, (label, code, r)) in items.into_iter().enumerate() {
            let b = s.clone_element(button_t, &format!("cp_lb_g{g}_b{i}"))?;
            let tile = tiles.map(|t| t.get(i).copied().unwrap_or(false)).unwrap_or(false);
            for (off, state) in [(112, "u"), (116, "o"), (120, "w"), (124, "at"), (128, "at"), (132, "at"), (136, "at"), (140, "at")] {
                if s.str_field(b, off).is_ok() {
                    let name = if tile { tile_texture(i, if state == "w" { "o" } else { state }) } else { tex(&format!("opt_{state}")) };
                    s.set_str_field(b, off, &name)?;
                }
            }
            s.set_rect(b, r)?;
            show(s, b)?;
            let mut evs = sounds.clone();
            evs.push(Event::new(event::SELECT, "ConsoleExecute", &format!("UI_Lua {code}")));
            s.set_events(b, &evs)?;
            let l = s.clone_element(text_t, &format!("cp_lb_g{g}_b{i}_label"))?;
            s.set_events(l, &[])?;
            s.set_text(l, &label)?;
            s.set_u32(l, 128, 1)?; // no meio
            if tiles.is_some() {
                // nome embaixo da miniatura
                s.set_str_field(l, 108, "pc_body_font_narrow_1")?;
                s.set_rect(l, Rect::new(r.x0 + 2, r.x1 - 2, r.y1 - 22, r.y1 - 2))?;
            } else {
                s.set_str_field(l, 108, "pc_title_font_2")?;
                s.set_rect(l, Rect::new(r.x0 + 4, r.x1 - 4, r.y0 + 3, r.y1 - 3))?;
            }
            show(s, l)?;
            s.set_u32(l, ORDER, order + 1)?;
            s.set_children(b, &[l])?;
            kids.push(b);
            bound = Rect::new(bound.x0.min(r.x0), bound.x1.max(r.x1), bound.y0.min(r.y0), bound.y1.max(r.y1));
        }
        s.set_children(gid, &kids)?;
        s.set_rect(gid, bound)?;
        panel.push(gid);
        Ok(())
    };
    // `cols` botões por linha, de `y` para baixo
    let grid = |count: usize, cols: i32, y: i32, h: i32| -> Vec<Rect> {
        let gap = 6;
        let w = (LIN1 - LIN0 - gap * (cols - 1)) / cols;
        (0..count as i32)
            .map(|i| {
                let (c, r) = (i % cols, i / cols);
                let x = LIN0 + (w + gap) * c;
                let yy = y + (h + 4) * r;
                Rect::new(x, x + w, yy, yy + h)
            })
            .collect()
    };
    let bh = 32;
    let mut y = LY0 + 74;
    let mut section = |s: &mut Scene, panel: &mut Vec<u32>, title: &str, items: Vec<(String, String)>, cols: i32, y: &mut i32| -> Result<()> {
        text(s, panel, title, "pc_title_font_2", Rect::new(LIN0, LIN1, *y, *y + 24))?;
        let rects = grid(items.len(), cols, *y + 24, bh);
        let rows = (items.len() as i32 + cols - 1) / cols;
        let list = items.into_iter().zip(rects).map(|((l, c), r)| (l, c, r)).collect();
        group(s, panel, list, None)?;
        *y += 24 + rows * (bh + 4) + 6;
        Ok(())
    };
    let set = |k: &str, v: String| format!("import('/lua/SinglePlayerLaunch.lua').CPBMSet('{k}', {v})");
    section(&mut s, &mut panel, t.players, LOBBY_PLAYERS.iter().map(|p| (p.to_string(), set("players", p.to_string()))).collect(), 6, &mut y)?;
    section(&mut s, &mut panel, t.teams, t.short_team_labels.iter().enumerate().map(|(i, l)| (l.to_string(), set("teams", [2, 3, 4, 0][i].to_string()))).collect(), 4, &mut y)?;
    section(&mut s, &mut panel, t.ai, t.short_ai_labels.iter().enumerate().map(|(i, l)| (l.to_string(), set("ai", format!("'{}'", AI_KEYS[i])))).collect(), 4, &mut y)?;
    section(&mut s, &mut panel, t.faction, t.faction_labels.iter().enumerate().map(|(i, l)| (l.to_string(), set("faction", i.to_string()))).collect(), 4, &mut y)?;
    section(&mut s, &mut panel, t.victory, t.victory_labels.iter().enumerate().map(|(i, l)| (l.to_string(), set("victory", format!("'{}'", VICTORY_KEYS[i])))).collect(), 3, &mut y)?;
    section(&mut s, &mut panel, t.units, UNIT_CAPS.iter().map(|u| (u.to_string(), set("units", u.to_string()))).collect(), 3, &mut y)?;
    // mapas: miniaturas em 2 linhas de 4 (o nome embaixo de cada uma)
    text(&mut s, &mut panel, t.map, "pc_title_font_2", Rect::new(LIN0, LIN1, y, y + 24))?;
    let tile = (LIN1 - LIN0 - 6 * 3) / 4;
    let items = maps
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let name: String = m.name.chars().filter(|c| !c.is_control()).take(12).collect();
            let (c, r) = (i as i32 % 4, i as i32 / 4);
            let x = LIN0 + (tile + 6) * c;
            let yy = y + 24 + (tile + 4) * r;
            (format!("{} · {}", m.bases, name.to_uppercase()), set("map", format!("'{}'", m.path)), Rect::new(x, x + tile, yy, yy + tile))
        })
        .collect();
    let has: Vec<bool> = (0..maps.len()).map(|i| thumbs.get(i).copied().unwrap_or(false)).collect();
    group(&mut s, &mut panel, items, Some(&has))?;

    // iniciar: o botão grande da sala (com o texto e a seta dele)
    let start = s.clone_element(launch_t, "cp_lb_start")?;
    let mut evs = sounds.clone();
    evs.push(Event::new(event::SELECT, "ConsoleExecute", &format!("UI_Lua {}", start_code(&first.path))));
    s.set_events(start, &evs)?;
    let r = Rect::new(LIN0, LIN1, LY1 - 66, LY1 - 12);
    s.set_rect(start, r)?;
    show(&mut s, start)?;
    let label = s.clone_element(launch_label_t, "cp_lb_start_label")?;
    s.set_text(label, t.lobby_start)?;
    s.set_u32(label, 128, 1)?;
    s.set_rect(label, Rect::new(r.x0 + 10, r.x1 - 30, r.y0 + 6, r.y1 - 6))?;
    show(&mut s, label)?;
    s.set_u32(label, ORDER, order + 1)?;
    s.set_children(start, &[label])?;
    panel.push(start);

    let mut kids = s.children(host)?;
    kids.extend(panel);
    s.set_children(host, &kids)?;
    Ok(s.to_bytes())
}

/// A tela de resultado das partidas (`frontend_summary_mp`) ganha "Jogar de novo": repete a última
/// partida grande com as mesmas escolhas (`CPBigMatchAgain`). Sem o botão "Sair" na cena, fica como
/// está.
pub fn add_again_button(scene: &[u8], label: &str) -> Result<Vec<u8>> {
    let mut s = Scene::parse(scene)?;
    let (Ok(quit), Ok(top)) = (s.by_name("btn_quit").map(|e| e.id), s.by_name("g_btm").map(|e| e.id)) else { return Ok(scene.to_vec()) };
    let Some(r) = s.rect(quit)? else { return Ok(scene.to_vec()) };
    let sounds: Vec<Event> = s.events(quit)?.into_iter().filter(|e| e.name == "PlaySound").collect();
    let b = s.clone_element(quit, "cp_btn_again")?;
    let mut evs = sounds;
    evs.push(Event::new(event::SELECT, "ConsoleExecute", "UI_Lua local m = import('/lua/SinglePlayerLaunch.lua') if m.CPBigMatchAgain then m.CPBigMatchAgain() end"));
    s.set_events(b, &evs)?;
    // em cima do Sair
    let h = r.y1 - r.y0;
    let rr = Rect::new(r.x0, r.x1, r.y0 - h - 8, r.y0 - 8);
    s.set_rect(b, rr)?;
    let mut kids = Vec::new();
    for c in s.children(quit)? {
        let e = s.by_id(c)?;
        let id = s.clone_element(c, &format!("cp_again_{}", e.name))?;
        if e.kind == kind::TEXT {
            s.set_text(id, label)?;
        }
        if let Some(cr) = s.rect(id)? {
            s.set_rect(id, cr.shifted(0, rr.y0 - r.y0))?;
        }
        kids.push(id);
    }
    s.set_children(b, &kids)?;
    let mut t = s.children(top)?;
    t.push(b);
    s.set_children(top, &t)?;
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
    fn panel_goes_into_the_game_lobby() {
        // a sala de escaramuça do jogo (CP_TEST_LOBBY)
        let Ok(path) = std::env::var("CP_TEST_LOBBY") else { return };
        let lobby = std::fs::read(path).unwrap();
        let maps = vec![
            MenuMap { path: "/maps/CP_32/CP_32_scenario.lua".into(), name: "Meu mapa 32".into(), bases: 32, size: 2048 },
            MenuMap { path: "/maps/SC2_MP_308/SC2_MP_308_scenario.lua".into(), name: "Seton's Clutch".into(), bases: 8, size: 1024 },
        ];
        let out = add_lobby_panel(&lobby, &maps, &PT).unwrap();
        let s = Scene::parse(&out).unwrap();
        let g = s.by_name("cp_lb_group1").unwrap();
        assert_eq!(g.kind, kind::RADIO_GROUP);
        assert_eq!(s.by_name("cp_lb_group2").unwrap().kind, kind::RADIO_GROUP);
        assert_eq!(s.children(g.id).unwrap().len(), 6);
        let start = s.by_name("cp_lb_start").unwrap().id;
        assert!(s.events(start).unwrap().iter().any(|e| e.param.contains("CPBigMatchFromMenu('/maps/CP_32/CP_32_scenario.lua')")));
        let b = s.by_name("cp_lb_g1_b0").unwrap().id;
        assert!(s.events(b).unwrap().iter().any(|e| e.param.contains("CPBMSet('players', 10)")));
        assert!(s.events(start).unwrap().iter().all(|e| e.name != "SkirmishLaunch"));
        assert_eq!(add_lobby_panel(&lobby, &[], &PT).unwrap(), lobby);
        if let Ok(dest) = std::env::var("CP_TEST_LOBBY_OUT") {
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
        assert!(start_code("/maps/a").contains("CPBigMatchFromMenu('/maps/a')"));
    }
}
