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
pub const MAX_MAPS: usize = 36;
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
    /// seção MODO: as 3 vitórias da partida normal e os 5 minigames
    pub mode: &'static str,
    pub mode_labels: [&'static str; 13],
    /// seção EXTRAS: combinações de mutadores e eventos
    pub extras: &'static str,
    pub extras_labels: [&'static str; 5],
    /// botão da sala com amigos
    pub friends: &'static str,
    /// seção CLIMA (na ordem de [`WEATHER_KEYS`])
    pub weather: &'static str,
    pub weather_labels: [&'static str; 6],
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
    lobby_sub: "Mais de 8 jogadores, minigames, clima e todos os mapas. Suas escolhas ficam guardadas.",
    lobby_start: "INICIAR PARTIDA GRANDE",
    mode: "MODO (VITÓRIA OU MINIGAME)",
    mode_labels: ["NORMAL", "TUDO", "SEM FIM", "GUERRA", "ARENA", "DEFESA", "DOMÍNIO", "SUPREMO", "INFINITO", "COLINA", "ESCOLTA", "CORRIDA", "TESOURO"],
    extras: "EXTRAS (MUTADORES E EVENTOS)",
    extras_labels: ["NENHUM", "EVENTOS", "CAOS", "SÓ AÉREO", "TANQUES"],
    friends: "SALA COM AMIGOS",
    weather: "CLIMA",
    weather_labels: ["LIMPO", "CHUVA", "TEMPESTADE", "NEVE", "NEBLINA", "AREIA"],
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
    lobby_sub: "More than 8 players, minigames, weather and every map. Your choices are kept.",
    lobby_start: "START BIG MATCH",
    mode: "MODE (VICTORY OR MINIGAME)",
    mode_labels: ["NORMAL", "ALL", "ENDLESS", "WAR", "ARENA", "DEFENSE", "CONTROL", "SUPREME", "SURVIVE", "HILL", "ESCORT", "RACE", "TREASURE"],
    extras: "EXTRAS (MUTATORS AND EVENTS)",
    extras_labels: ["NONE", "EVENTS", "CHAOS", "AIR ONLY", "TANKS"],
    friends: "ROOM WITH FRIENDS",
    weather: "WEATHER",
    weather_labels: ["CLEAR", "RAIN", "STORM", "SNOW", "FOG", "SANDSTORM"],
};

const AI_KEYS: [&str; 4] = ["Easy", "Normal", "Hard", "Cheat"];
/// Botões da seção MODO: (minigame, vitória). Os 3 primeiros são a partida normal.
const MODE_KEYS: [(&str, &str); 13] = [
    ("", "demoralization"),
    ("", "domination"),
    ("", "sandbox"),
    ("total", ""),
    ("arena", ""),
    ("defense", ""),
    ("domination", ""),
    ("supreme", ""),
    ("survival", ""),
    ("koth", ""),
    ("vip", ""),
    ("race", ""),
    ("treasure", ""),
];
/// Botões da seção EXTRAS: (mutadores, eventos).
const EXTRAS_KEYS: [(&str, bool); 5] = [("", false), ("", true), ("hp,res,cdr", true), ("air", false), ("hp,cdr", false)];
const UNIT_CAPS: [u32; 3] = [250, 500, 1000];

// medidas do painel (unidades da cena da sala, 640 × 480: a área 16:9 vai de x −640 a 1280; a
// janela da sala começa em −209)
const LX0: i32 = -620;
const LX1: i32 = -224;
const LY0: i32 = -72;
const LY1: i32 = 752;
const LIN0: i32 = LX0 + 16;
const LIN1: i32 = LX1 - 16;
/// Mapas na lista da sala.
pub const LOBBY_MAPS: usize = 10;
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
    // a ordem de desenho é um número único por elemento: os do painel vêm depois de todos os da
    // cena, cada um com o seu (fundo, títulos, e cada botão antes do texto dele)
    let top = s.elements()?.iter().filter_map(|e| s.u32_field(e.id, ORDER).ok()).filter(|o| *o < 100_000).max().unwrap_or(0);
    let next = std::cell::Cell::new(top + 1);
    let mut panel: Vec<u32> = Vec::new();
    let show = |s: &mut Scene, id: u32| -> Result<()> {
        s.set_u32(id, VISIBLE, 1)?;
        s.set_u32(id, ORDER, next.get())?;
        next.set(next.get() + 1);
        Ok(())
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
    let mut group = |s: &mut Scene, panel: &mut Vec<u32>, items: Vec<(String, String, Rect)>, tiles: Option<&[bool]>, font: &str| -> Result<()> {
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
                s.set_str_field(l, 108, font)?;
                s.set_rect(l, Rect::new(r.x0 + 4, r.x1 - 4, r.y0 + 3, r.y1 - 3))?;
            }
            show(s, l)?;
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
    let bh = 28;
    let mut y = LY0 + 74;
    let mut section = |s: &mut Scene, panel: &mut Vec<u32>, title: &str, items: Vec<(String, String)>, cols: i32, y: &mut i32| -> Result<()> {
        text(s, panel, title, "pc_title_font_2", Rect::new(LIN0, LIN1, *y, *y + 24))?;
        let rects = grid(items.len(), cols, *y + 24, bh);
        let rows = (items.len() as i32 + cols - 1) / cols;
        let list = items.into_iter().zip(rects).map(|((l, c), r)| (l, c, r)).collect();
        // botões estreitos (5 por linha): letra mais fina
        // a fonte de título é mais alta que o botão (o jogo não desenha texto que não cabe)
        group(s, panel, list, None, "pc_body_font_narrow_2")?;
        *y += 24 + rows * (bh + 4) + 6;
        Ok(())
    };
    let set = |k: &str, v: String| format!("import('/lua/SinglePlayerLaunch.lua').CPBMSet('{k}', {v})");
    section(&mut s, &mut panel, t.players, LOBBY_PLAYERS.iter().map(|p| (p.to_string(), set("players", p.to_string()))).collect(), 6, &mut y)?;
    section(&mut s, &mut panel, t.teams, t.short_team_labels.iter().enumerate().map(|(i, l)| (l.to_string(), set("teams", [2, 3, 4, 0][i].to_string()))).collect(), 4, &mut y)?;
    section(&mut s, &mut panel, t.ai, t.short_ai_labels.iter().enumerate().map(|(i, l)| (l.to_string(), set("ai", format!("'{}'", AI_KEYS[i])))).collect(), 4, &mut y)?;
    section(&mut s, &mut panel, t.faction, t.faction_labels.iter().enumerate().map(|(i, l)| (l.to_string(), set("faction", i.to_string()))).collect(), 4, &mut y)?;
    let mode = |m: &str, v: &str| format!("import('/lua/SinglePlayerLaunch.lua').CPBMSetMode('{m}', '{v}')");
    section(&mut s, &mut panel, t.mode, t.mode_labels.iter().zip(MODE_KEYS).map(|(l, (m, v))| (l.to_string(), mode(m, v))).collect(), 5, &mut y)?;
    let extras = |m: &str, e: bool| format!("import('/lua/SinglePlayerLaunch.lua').CPBMSetExtras('{m}', {e})");
    section(&mut s, &mut panel, t.extras, t.extras_labels.iter().zip(EXTRAS_KEYS).map(|(l, (m, e))| (l.to_string(), extras(m, e))).collect(), 5, &mut y)?;
    section(&mut s, &mut panel, t.units, UNIT_CAPS.iter().map(|u| (u.to_string(), set("units", u.to_string()))).collect(), 3, &mut y)?;
    // mapas: miniaturas em 2 linhas de 4 (o nome embaixo de cada uma)
    text(&mut s, &mut panel, t.map, "pc_title_font_2", Rect::new(LIN0, LIN1, y, y + 24))?;
    let tile = (LIN1 - LIN0 - 6 * 4) / 5;
    let items = maps
        .iter()
        .enumerate()
        .map(|(i, m)| {
            // sem o "[32]" do começo do nome (as bases já aparecem antes)
            let clean = m.name.trim();
            let clean = if clean.starts_with('[') { clean.split_once(']').map(|(_, r)| r.trim()).unwrap_or(clean) } else { clean };
            let name: String = clean.chars().filter(|c| !c.is_control()).take(8).collect();
            let (c, r) = (i as i32 % 5, i as i32 / 5);
            let x = LIN0 + (tile + 6) * c;
            let yy = y + 24 + (tile + 4) * r;
            (format!("{} · {}", m.bases, name.to_uppercase()), set("map", format!("'{}'", m.path)), Rect::new(x, x + tile, yy, yy + tile))
        })
        .collect();
    let has: Vec<bool> = (0..maps.len()).map(|i| thumbs.get(i).copied().unwrap_or(false)).collect();
    group(&mut s, &mut panel, items, Some(&has), "pc_body_font_narrow_1")?;

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
    s.set_children(start, &[label])?;
    panel.push(start);

    // o painel num grupo próprio no primeiro nível da cena (como as barras de cima e de baixo):
    // dentro do grupo da sala ele ficaria fora da área dela e o jogo não entregaria os cliques
    let root = s.clone_element(group_t, "cp_lb_root")?;
    s.set_events(root, &[])?;
    s.set_anchors(root, Anchors::default())?;
    s.set_rect(root, Rect::new(LX0, LX1, LY0, LY1))?;
    s.set_children(root, &panel)?;
    s.set_u32(root, VISIBLE, 1)?;
    let _ = host;
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
    fn short_map_names() {
        assert_eq!(short_name("[32] Meu Mapa"), "MEU MAPA");
        assert_eq!(short_name("Seton's Clutch"), "SETONS");
        assert_eq!(short_name("Supercalifragilistic"), "SUPERCA.");
        assert_eq!(short_name("Open Palms"), "OPEN");
        assert_eq!(short_name("Powderhorn"), "POWDERH.");
    }

    #[test]
    fn panel_goes_into_the_game_lobby() {
        // a sala de escaramuça do jogo (CP_TEST_LOBBY)
        let Ok(path) = std::env::var("CP_TEST_LOBBY") else { return };
        let lobby = std::fs::read(path).unwrap();
        let maps = vec![
            MenuMap { path: "/maps/CP_32/CP_32_scenario.lua".into(), name: "Meu mapa 32".into(), bases: 32, size: 2048 },
            MenuMap { path: "/maps/SC2_MP_308/SC2_MP_308_scenario.lua".into(), name: "Seton's Clutch".into(), bases: 8, size: 1024 },
        ];
        // com 10 mapas (2 linhas de miniaturas) tudo ainda cabe acima do botão
        let mut many = maps.clone();
        for i in 0..8 {
            many.push(MenuMap { path: format!("/maps/M{i}/M{i}_scenario.lua"), name: format!("Mapa {i}"), bases: 10, size: 1024 });
        }
        let full = Scene::parse(&add_lobby_panel(&lobby, &many, &PT).unwrap()).unwrap();
        let top = full.rect(full.by_name("cp_lb_start").unwrap().id).unwrap().unwrap().y0;
        for e in full.elements().unwrap().iter().filter(|e| e.name.starts_with("cp_lb_g")) {
            if let Ok(Some(r)) = full.rect(e.id) {
                assert!(r.y1 <= top, "{} passa do botão: {} > {top}", e.name, r.y1);
            }
        }
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
        // MODO: 8 botões, o da Arena chama o minigame
        let arena = s.by_name("cp_lb_g5_b4").unwrap().id;
        let chaos = s.by_name("cp_lb_g6_b2").unwrap().id;
        assert!(s.events(chaos).unwrap().iter().any(|e| e.param.contains("CPBMSetExtras('hp,res,cdr', true)")));
        assert!(s.events(arena).unwrap().iter().any(|e| e.param.contains("CPBMSetMode('arena', '')")), "{:?}", s.events(arena).unwrap());
        // tudo cabe acima do botão de iniciar
        let start_top = s.rect(start).unwrap().unwrap().y0;
        for e in s.elements().unwrap().iter().filter(|e| e.name.starts_with("cp_lb_g") && !e.name.ends_with("label")) {
            if let Ok(Some(r)) = s.rect(e.id) {
                assert!(r.y1 <= start_top, "{} passa do botão: {} > {start_top}", e.name, r.y1);
            }
        }
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

#[cfg(test)]
mod refix {
    use super::*;

    /// Com `CP_FIX_IN`/`CP_FIX_OUT`: corrige uma sala montada pelas versões antigas (ordem de
    /// desenho única para o painel e o grupo da sala cobrindo o painel), para testar no jogo.
    #[test]
    fn refix_old_lobby() {
        let (Ok(i), Ok(o)) = (std::env::var("CP_FIX_IN"), std::env::var("CP_FIX_OUT")) else { return };
        let mut s = Scene::parse(&std::fs::read(i).unwrap()).unwrap();
        let ours: Vec<u32> = s.elements().unwrap().iter().filter(|e| e.name.starts_with("cp_lb_")).map(|e| e.id).collect();
        let top = s.elements().unwrap().iter().filter(|e| !e.name.starts_with("cp_lb_")).filter_map(|e| s.u32_field(e.id, ORDER).ok()).filter(|o| *o < 100_000).max().unwrap();
        // na ordem em que foram criados: fundo, filete, títulos, grupo, botão, texto do botão...
        let mut ids = ours.clone();
        ids.sort();
        for (k, id) in ids.iter().enumerate() {
            s.set_u32(*id, ORDER, top + 1 + k as u32).unwrap();
        }
        // tira o painel do grupo da sala e põe num grupo próprio no primeiro nível
        let host = s.by_name("g_main").unwrap().id;
        let kids = s.children(host).unwrap();
        let (mine, theirs): (Vec<u32>, Vec<u32>) = kids.into_iter().partition(|k| ours.contains(k));
        s.set_children(host, &theirs).unwrap();
        // CP_FIX_STRIP: sem painel (a sala como a do jogo, com o fundo do tamanho original)
        if let Ok(stock) = std::env::var("CP_FIX_STRIP") {
            let st = Scene::parse(&std::fs::read(stock).unwrap()).unwrap();
            let r = st.rect(st.by_name("main_bg").unwrap().id).unwrap().unwrap();
            let bg = s.by_name("main_bg").unwrap().id;
            s.set_rect(bg, r).unwrap();
            for id in &ours {
                s.set_u32(*id, VISIBLE, 0).unwrap();
            }
            std::fs::write(o, s.to_bytes()).unwrap();
            return;
        }
        let root = s.clone_element(s.by_name("g_options").unwrap().id, "cp_lb_root").unwrap();
        s.set_events(root, &[]).unwrap();
        s.set_anchors(root, Anchors::default()).unwrap();
        s.set_rect(root, Rect::new(LX0, LX1, LY0, LY1)).unwrap();
        s.set_children(root, &mine).unwrap();
        s.set_u32(root, VISIBLE, 1).unwrap();
        // a fonte dos botões: a estreita (a de título não cabe e some)
        for e in s.elements().unwrap() {
            if e.name.starts_with("cp_lb_g") && e.name.ends_with("_label") && s.str_field(e.id, 108).map(|f| f == "pc_title_font_2").unwrap_or(false) {
                s.set_str_field(e.id, 108, "pc_body_font_narrow_2").unwrap();
            }
        }
        std::fs::write(o, s.to_bytes()).unwrap();
    }
}

// ---------------------------------------------------------------- painel na tela inicial
//
// A sala de Batalha do jogo só roda os comandos dela (`Skirmish…`) e a interface feita em Lua fica
// por baixo das telas do jogo: o painel da Partida grande mora na tela inicial, dentro do grupo do
// submenu Batalha (como na 0.42, que funcionou), à direita dele e embaixo das notícias. Os elementos
// ficam escondidos e aparecem junto com o submenu.

// medidas na tela inicial (as do submenu: x 173–593; a área visível vai de x −448 a 1472 e de
// y −156 a 924; as notícias ficam em cima, até y 252)
const MX0: i32 = 600;
const MX1: i32 = 1460;
const MY0: i32 = 262;
const MY1: i32 = 912;
/// Mapas na grade do painel da tela inicial (6 × 6 miniaturas).
pub const MENU_MAPS: usize = 36;
const TILE: i32 = 64;
const TILE_GAP: i32 = 6;
const TILE_COLS: i32 = 6;
/// Botões da seção CLIMA (chaves do mod Climas; vazio = limpo).
pub const WEATHER_KEYS: [&str; 6] = ["", "rain", "storm", "blizzard", "fog", "sandstorm"];

/// Nome curto do mapa para caber embaixo da miniatura (sem o "[32]" do começo, em maiúsculas).
fn short_name(name: &str) -> String {
    let clean = name.trim();
    let clean = if clean.starts_with('[') { clean.split_once(']').map(|(_, r)| r.trim()).unwrap_or(clean) } else { clean };
    let up: String = clean.chars().filter(|c| !c.is_control() && *c != '\'' && *c != '"').collect::<String>().to_uppercase();
    // a fonte estreita do jogo: cabem 8 letras na largura da miniatura
    let max = 8;
    if up.chars().count() <= max {
        return up;
    }
    // corta numa palavra inteira quando dá
    let words: Vec<&str> = up.split_whitespace().collect();
    let mut out = String::new();
    for w in words {
        let next = if out.is_empty() { w.to_string() } else { format!("{out} {w}") };
        if next.chars().count() > max {
            break;
        }
        out = next;
    }
    if out.chars().count() < 4 {
        out = up.chars().take(max - 1).collect::<String>() + ".";
    }
    out
}

/// Como os botões do painel são desenhados.
#[derive(Clone, Copy, PartialEq)]
enum Style {
    /// botão de opção pequeno
    Opt,
    /// o botão grande de começar
    Big,
    /// miniatura do mapa `i` (com imagem quando `thumb`), com as bases em cima
    Tile { i: usize, bases: usize, thumb: bool },
}

/// Põe o painel da Partida grande na tela inicial (`scene`, já no visual novo).
pub fn add_menu_panel(scene: &[u8], maps: &[MenuMap], t: &Texts) -> Result<Vec<u8>> {
    add_menu_panel_with(scene, maps, t, &[])
}

/// Como [`add_menu_panel`]; `thumbs[i]` diz se o mapa `i` tem miniatura ([`tile_texture`]).
///
/// O painel fica dentro do grupo do submenu Batalha (o jogo só mostra os submenus dele: um grupo
/// ou um botão principal novos não aparecem), à direita do submenu e embaixo das notícias:
/// as escolhas à esquerda (cada seção é um grupo de botões de opção, o escolhido fica aceso), os
/// mapas em miniatura à direita e, embaixo deles, a sala com amigos e o botão de começar (num grupo
/// comum: nada ali é escolhido sozinho).
pub fn add_menu_panel_with(scene: &[u8], maps: &[MenuMap], t: &Texts, thumbs: &[bool]) -> Result<Vec<u8>> {
    let maps: Vec<&MenuMap> = maps.iter().filter(|m| safe(&m.path) && m.path.starts_with("/maps/")).take(MENU_MAPS).collect();
    let Some(first) = maps.first() else { return Ok(scene.to_vec()) };
    let mut s = Scene::parse(scene)?;
    let tex = |n: &str| format!("{TEX}{n}.dds");
    let host = find(&s, "g_skirmish_options")?;
    let group_t = find(&s, "rg_menu_group")?;
    let button_t = find(&s, "rb_creategame")?;
    let label_t = s
        .children(button_t)?
        .into_iter()
        .find(|c| s.by_id(*c).map(|e| e.kind == kind::TEXT).unwrap_or(false))
        .ok_or_else(|| Error::Other("botão modelo sem texto".into()))?;
    let bitmap_t = find(&s, "avatar")?;
    let sounds: Vec<Event> = s.events(button_t)?.into_iter().filter(|e| e.name == "PlaySound").collect();
    // ordem de desenho: depois de tudo da cena, um número para cada elemento
    let top = s.elements()?.iter().filter_map(|e| s.u32_field(e.id, ORDER).ok()).filter(|o| *o < 100_000).max().unwrap_or(0);
    let next = std::cell::Cell::new(top + 1);
    let hide = |s: &mut Scene, id: u32| -> Result<()> {
        s.set_u32(id, VISIBLE, 0)?;
        s.set_u32(id, ORDER, next.get())?;
        next.set(next.get() + 1);
        Ok(())
    };
    let mut panel: Vec<u32> = Vec::new();

    // fundo e moldura (as peças do painel dos outros menus)
    let bg = s.clone_element(bitmap_t, "cp_bm_bg")?;
    s.set_str_field(bg, 112, &tex("p9_c"))?;
    s.set_rect(bg, Rect::new(MX0, MX1, MY0, MY1))?;
    hide(&mut s, bg)?;
    panel.push(bg);
    let edge = 32;
    for (n, r) in [
        ("tl", Rect::new(MX0, MX0 + edge, MY0, MY0 + edge)),
        ("t", Rect::new(MX0 + edge, MX1 - edge, MY0, MY0 + edge)),
        ("tr", Rect::new(MX1 - edge, MX1, MY0, MY0 + edge)),
        ("l", Rect::new(MX0, MX0 + edge, MY0 + edge, MY1 - edge)),
        ("r", Rect::new(MX1 - edge, MX1, MY0 + edge, MY1 - edge)),
        ("bl", Rect::new(MX0, MX0 + edge, MY1 - edge, MY1)),
        ("b", Rect::new(MX0 + edge, MX1 - edge, MY1 - edge, MY1)),
        ("br", Rect::new(MX1 - edge, MX1, MY1 - edge, MY1)),
    ] {
        let id = s.clone_element(bitmap_t, &format!("cp_bm_frame_{n}"))?;
        s.set_str_field(id, 112, &tex(&format!("p9_{n}")))?;
        s.set_rect(id, r)?;
        hide(&mut s, id)?;
        panel.push(id);
    }
    let line = s.clone_element(bitmap_t, "cp_bm_line")?;
    s.set_str_field(line, 112, &tex("line"))?;
    s.set_rect(line, Rect::new(MX0 + 20, MX1 - 20, MY0 + 80, MY0 + 83))?;
    hide(&mut s, line)?;
    panel.push(line);

    let mut n = 0;
    let mut text = |s: &mut Scene, panel: &mut Vec<u32>, txt: &str, font: &str, r: Rect| -> Result<u32> {
        n += 1;
        let id = s.clone_element(label_t, &format!("cp_bm_text{n}"))?;
        s.set_events(id, &[])?;
        s.set_text(id, txt)?;
        s.set_str_field(id, 108, font)?;
        s.set_u32(id, 128, 0)?;
        s.set_rect(id, r)?;
        hide(s, id)?;
        panel.push(id);
        Ok(id)
    };
    // a fonte de título só aparece em retângulos altos (40 ou mais)
    text(&mut s, &mut panel, t.lobby_title, "pc_title_font_4", Rect::new(MX0 + 22, MX1 - 22, MY0 + 8, MY0 + 54))?;
    text(&mut s, &mut panel, t.lobby_sub, "pc_body_font_narrow_2", Rect::new(MX0 + 24, MX1 - 22, MY0 + 52, MY0 + 78))?;

    // um grupo de botões (cada um com o código dele); `plain` = grupo comum (nada fica aceso)
    let mut g = 0;
    let mut group = |s: &mut Scene, panel: &mut Vec<u32>, items: Vec<(String, String, Rect, Style)>, plain: bool| -> Result<()> {
        g += 1;
        let gid = s.clone_element(if plain { host } else { group_t }, &format!("cp_bm_group{g}"))?;
        s.set_events(gid, &[])?;
        s.set_children(gid, &[])?;
        s.set_anchors(gid, Anchors::default())?;
        hide(s, gid)?;
        let mut kids = Vec::new();
        let mut bound = Rect::new(i32::MAX, i32::MIN, i32::MAX, i32::MIN);
        for (i, (label, code, r, style)) in items.into_iter().enumerate() {
            let b = s.clone_element(button_t, &format!("cp_bm_g{g}_b{i}"))?;
            for (off, state) in [(112, "u"), (116, "o"), (120, "w"), (124, "at"), (128, "at"), (132, "at")] {
                if s.str_field(b, off).is_ok() {
                    let name = match style {
                        Style::Tile { i, thumb: true, .. } => tile_texture(i, if state == "w" { "o" } else { state }),
                        Style::Big => tex(&format!("btn_{state}")),
                        _ => tex(&format!("opt_{state}")),
                    };
                    s.set_str_field(b, off, &name)?;
                }
            }
            s.set_rect(b, r)?;
            hide(s, b)?;
            let mut evs = sounds.clone();
            evs.push(Event::new(event::SELECT, "ConsoleExecute", &format!("UI_Lua {code}")));
            s.set_events(b, &evs)?;
            let mut labels = Vec::new();
            let mut add_label = |s: &mut Scene, name: String, txt: &str, font: &str, align: u32, lr: Rect| -> Result<()> {
                let l = s.clone_element(label_t, &name)?;
                s.set_events(l, &[])?;
                s.set_text(l, txt)?;
                s.set_str_field(l, 108, font)?;
                s.set_u32(l, 128, align)?;
                s.set_rect(l, lr)?;
                hide(s, l)?;
                labels.push(l);
                Ok(())
            };
            match style {
                Style::Opt => add_label(s, format!("cp_bm_g{g}_b{i}_label"), &label, "pc_body_font_narrow_2", 1, Rect::new(r.x0 + 3, r.x1 - 3, r.y0 + 2, r.y1 - 2))?,
                Style::Big => add_label(s, format!("cp_bm_g{g}_b{i}_label"), &label, "pc_title_font_2", 1, Rect::new(r.x0 + 8, r.x1 - 34, r.y0 + 4, r.y1 - 4))?,
                Style::Tile { bases, .. } => {
                    // o nome embaixo (na faixa escura da miniatura) e as bases no canto
                    add_label(s, format!("cp_bm_g{g}_b{i}_label"), &label, "pc_body_font_narrow_2", 1, Rect::new(r.x0 + 1, r.x1 - 1, r.y1 - 25, r.y1 - 1))?;
                    add_label(s, format!("cp_bm_g{g}_b{i}_bases"), &bases.to_string(), "pc_body_font_narrow_2", 0, Rect::new(r.x0 + 4, r.x0 + 40, r.y0 + 1, r.y0 + 25))?;
                }
            }
            s.set_children(b, &labels)?;
            kids.push(b);
            bound = Rect::new(bound.x0.min(r.x0), bound.x1.max(r.x1), bound.y0.min(r.y0), bound.y1.max(r.y1));
        }
        s.set_children(gid, &kids)?;
        s.set_rect(gid, bound)?;
        panel.push(gid);
        Ok(())
    };
    let set = |k: &str, v: String| format!("import('/lua/SinglePlayerLaunch.lua').CPBMSet('{k}', {v})");
    let (bh, step, head) = (28, 32, 22);
    // coluna da esquerda: as escolhas
    let (lx0, lx1) = (MX0 + 18, MX0 + 410);
    let mut y = MY0 + 90;
    let mut section = |s: &mut Scene, panel: &mut Vec<u32>, title: &str, items: Vec<(String, String)>, cols: i32, y: &mut i32| -> Result<()> {
        text(s, panel, title, "pc_body_font_narrow_2", Rect::new(lx0, lx1, *y - 2, *y + head))?;
        let gap = 6;
        let w = (lx1 - lx0 - gap * (cols - 1)) / cols;
        let rows = (items.len() as i32 + cols - 1) / cols;
        let list = items
            .into_iter()
            .enumerate()
            .map(|(i, (l, c))| {
                let (cx, ry) = (i as i32 % cols, i as i32 / cols);
                let x = lx0 + (w + gap) * cx;
                let yy = *y + head + step * ry;
                (l, c, Rect::new(x, x + w, yy, yy + bh), Style::Opt)
            })
            .collect();
        group(s, panel, list, false)?;
        *y += head + step * (rows - 1) + bh + 6;
        Ok(())
    };
    section(&mut s, &mut panel, t.players, LOBBY_PLAYERS.iter().map(|p| (p.to_string(), set("players", p.to_string()))).collect(), 6, &mut y)?;
    let team_label = |i: usize| if i == 3 { t.short_team_labels[3] } else { t.team_labels[i] };
    section(&mut s, &mut panel, t.teams, (0..4).map(|i| (team_label(i).to_string(), set("teams", [2, 3, 4, 0][i].to_string()))).collect(), 4, &mut y)?;
    section(&mut s, &mut panel, t.ai, t.ai_labels.iter().enumerate().map(|(i, l)| (l.to_string(), set("ai", format!("'{}'", AI_KEYS[i])))).collect(), 4, &mut y)?;
    section(&mut s, &mut panel, t.faction, t.faction_labels.iter().enumerate().map(|(i, l)| (l.to_string(), set("faction", i.to_string()))).collect(), 4, &mut y)?;
    let mode = |m: &str, v: &str| format!("import('/lua/SinglePlayerLaunch.lua').CPBMSetMode('{m}', '{v}')");
    section(&mut s, &mut panel, t.mode, t.mode_labels.iter().zip(MODE_KEYS).map(|(l, (m, v))| (l.to_string(), mode(m, v))).collect(), 5, &mut y)?;
    section(&mut s, &mut panel, t.units, UNIT_CAPS.iter().map(|u| (u.to_string(), set("units", u.to_string()))).collect(), 3, &mut y)?;
    section(&mut s, &mut panel, t.weather, t.weather_labels.iter().zip(WEATHER_KEYS).map(|(l, k)| (l.to_string(), set("weather", format!("'{k}'")))).collect(), 3, &mut y)?;
    let extras = |m: &str, e: bool| format!("import('/lua/SinglePlayerLaunch.lua').CPBMSetExtras('{m}', {e})");
    section(&mut s, &mut panel, t.extras, t.extras_labels.iter().zip(EXTRAS_KEYS).map(|(l, (m, e))| (l.to_string(), extras(m, e))).collect(), 5, &mut y)?;
    // coluna da direita: os mapas em miniatura
    let (rx0, rx1) = (MX0 + 426, MX1 - 18);
    let ry = MY0 + 90;
    text(&mut s, &mut panel, t.map, "pc_body_font_narrow_2", Rect::new(rx0, rx1, ry - 2, ry + head))?;
    let items = maps
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let (cx, r) = (i as i32 % TILE_COLS, i as i32 / TILE_COLS);
            let x = rx0 + (TILE + TILE_GAP) * cx;
            let yy = ry + head + 4 + (TILE + TILE_GAP) * r;
            let thumb = thumbs.get(i).copied().unwrap_or(false);
            (short_name(&m.name), set("map", format!("'{}'", m.path)), Rect::new(x, x + TILE, yy, yy + TILE), Style::Tile { i, bases: m.bases, thumb })
        })
        .collect();
    group(&mut s, &mut panel, items, false)?;
    // sala com amigos e começar, embaixo dos mapas (grupo comum)
    let friends = format!("local m = import('/lua/SinglePlayerLaunch.lua') if m.CPRoomFromMenu then m.CPRoomFromMenu('{}') end", first.path);
    let items = vec![
        (t.friends.to_string(), friends, Rect::new(rx0, rx1, MY1 - 112, MY1 - 76), Style::Opt),
        (t.lobby_start.to_string(), start_code(&first.path), Rect::new(rx0, rx1, MY1 - 68, MY1 - 16), Style::Big),
    ];
    group(&mut s, &mut panel, items, true)?;

    let mut kids = s.children(host)?;
    kids.extend(panel);
    s.set_children(host, &kids)?;
    Ok(s.to_bytes())
}

#[cfg(test)]
mod menu_panel_tests {
    use super::*;

    /// Com `CP_TEST_SCENE` (a tela inicial do jogo): o painel entra escondido no grupo do submenu
    /// Batalha, cabe na área dele e cada botão roda o código da Partida grande.
    #[test]
    fn panel_goes_beside_the_battle_submenu() {
        let Ok(path) = std::env::var("CP_TEST_SCENE") else { return };
        let look = crate::mainmenu::Look::Commander(crate::mainmenu::Commander { panel: true, ..Default::default() });
        let menu = crate::mainmenu::build_with(&std::fs::read(path).unwrap(), &Default::default(), &look).unwrap().scene;
        let maps: Vec<MenuMap> = (0..40).map(|i| MenuMap { path: format!("/maps/M{i}/M{i}_scenario.lua"), name: format!("[32] Mapa {i}"), bases: 32, size: 2048 }).collect();
        let thumbs: Vec<bool> = (0..40).map(|i| i % 2 == 0).collect();
        let out = add_menu_panel_with(&menu, &maps, &PT, &thumbs).unwrap();
        let s = Scene::parse(&out).unwrap();
        let host = s.by_name("g_skirmish_options").unwrap().id;
        let kids = s.children(host).unwrap();
        assert!(kids.contains(&s.by_name("cp_bm_bg").unwrap().id));
        let mut orders = std::collections::HashSet::new();
        for e in s.elements().unwrap().iter().filter(|e| e.name.starts_with("cp_bm_")) {
            assert_eq!(s.u32_field(e.id, VISIBLE).unwrap(), 0, "{}", e.name);
            assert!(orders.insert(s.u32_field(e.id, ORDER).unwrap()), "ordem repetida em {}", e.name);
            if let Ok(Some(r)) = s.rect(e.id) {
                assert!(r.x0 >= MX0 && r.x1 <= MX1 && r.y0 >= MY0 && r.y1 <= MY1, "{} fora do painel: {r:?}", e.name);
            }
        }
        // os botões rodam o código (e o de começar, a partida)
        let all: Vec<String> = s.elements().unwrap().iter().filter(|e| e.name.starts_with("cp_bm_g")).flat_map(|e| s.events(e.id).unwrap()).map(|e| e.param).collect();
        assert!(all.iter().any(|p| p.contains("CPBMSet('players', 16)")));
        assert!(all.iter().any(|p| p.contains("CPBMSetMode('koth', '')")));
        assert!(all.iter().any(|p| p.contains("CPBMSetExtras('hp,res,cdr', true)")));
        assert!(all.iter().any(|p| p.contains("CPBigMatchFromMenu('/maps/M0/M0_scenario.lua')")));
        assert!(all.iter().any(|p| p.contains("CPRoomFromMenu(")));
        assert!(all.iter().any(|p| p.contains("CPBMSet('weather', 'blizzard')")));
        // 36 mapas em miniatura; o "[32]" sai do nome e as bases vão para o canto
        assert!(s.by_name("cp_bm_g9_b35").is_ok());
        assert!(s.by_name("cp_bm_g9_b36").is_err());
        let label = s.by_name("cp_bm_g9_b0_label").unwrap().id;
        assert_eq!(s.text(label).unwrap(), "MAPA 0");
        assert_eq!(s.text(s.by_name("cp_bm_g9_b0_bases").unwrap().id).unwrap(), "32");
        // com miniatura, o botão é a imagem do mapa; sem, o botão comum
        let tile = s.by_name("cp_bm_g9_b0").unwrap().id;
        assert_eq!(s.str_field(tile, 112).unwrap(), tile_texture(0, "u"));
        let plain = s.by_name("cp_bm_g9_b1").unwrap().id;
        assert!(s.str_field(plain, 112).unwrap().ends_with("opt_u.dds"));
        // começar e a sala ficam num grupo comum (nada ali é escolhido sozinho)
        let g10 = s.by_name("cp_bm_group10").unwrap();
        assert_eq!(g10.kind, kind::GROUP);
        assert_eq!(s.by_name("cp_bm_group1").unwrap().kind, kind::RADIO_GROUP);
    }
}

