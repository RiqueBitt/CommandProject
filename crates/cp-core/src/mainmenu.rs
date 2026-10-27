//! Tela inicial do jogo editada por mods: botões novos, nomes trocados e botões escondidos.
//!
//! A tela inicial é a cena `ui/scenes/main_menu/pc_main_menu.win.bdf` (veja [`crate::scene`]). O
//! launcher monta uma cópia dela com o que os mods da Forja pedem:
//! * botões novos na **coluna principal** (cópias do botão Opções) ou no submenu **Extras** (cópias
//!   de Créditos). Um botão roda o código do mod (evento `ConsoleExecute` com `UI_Lua`, que chama o
//!   motor da Forja na interface) e/ou uma ação do próprio jogo (abrir uma tela);
//! * nomes trocados e botões escondidos.
//!
//! A coluna é refeita do zero: com mais botões, eles ficam mais juntos e começam mais acima (o
//! botão Sair fica sempre por último). Os submenus acompanham o botão deles e o texto de cada botão
//! fica sempre na mesma posição dentro dele.

use crate::error::{Error, Result};
use crate::scene::{event, kind, Anchors, Event, Rect, Scene};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};

/// A cena da tela inicial dentro dos arquivos do jogo.
pub const SCENE_PATH: &str = "/ui/scenes/main_menu/pc_main_menu.win.bdf";
/// Onde fica o código que os botões chamam.
pub const DISPATCH: &str = "/lua/ui/uimain.lua";

/// Botões da coluna principal: (chave usada nos mods, elemento na cena).
pub const MAIN: &[(&str, &str)] = &[
    ("campaign", "rb_campaign"),
    ("skirmish", "rb_skirmish"),
    ("multiplayer", "rb_multiplayer"),
    ("options", "rb_options"),
    ("extras", "rb_extras"),
    ("quit", "rb_quit"),
];
/// Botões do submenu Extras.
pub const EXTRAS: &[(&str, &str)] = &[("replays", "rb_replays"), ("credits", "rb_credits")];

/// Ações do próprio jogo que um botão de mod pode chamar: (chave, tratador do executável, o que faz).
pub const NATIVE: &[(&str, &str, &str)] = &[
    ("campaign", "RequestCampaignMenu", "Menu da campanha"),
    ("continue", "RequestContinueGame", "Continuar o último jogo salvo"),
    ("tutorial", "RequestTutorialGame", "Tutorial"),
    ("loadCampaign", "RequestLoadCampaign", "Carregar campanha salva"),
    ("skirmish", "RequestSkirmishMenu", "Escaramuça"),
    ("loadSkirmish", "RequestLoadSkirmish", "Carregar escaramuça salva"),
    ("lan", "RequestLanGame", "Partida em rede local (LAN)"),
    ("hostGame", "RequestHostMenu", "Hospedar partida"),
    ("publicGame", "RequestPublicGame", "Entrar em partida"),
    ("privateGame", "RequestPrivateGame", "Partida privada"),
    ("quickMatch", "MainMenuRequestQuickMatch", "Partida rápida"),
    ("leaderboards", "MainMenuClickLeaderboards", "Classificação"),
    ("chat", "MainMenuClickChat", "Chat da Steam"),
    ("options", "RequestOptionsMenu", "Opções"),
    ("replays", "RequestReplays", "Replays"),
    ("credits", "RequestCredits", "Créditos"),
    ("exit", "RequestExitDialog", "Sair do jogo"),
];

/// Onde o botão aparece.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Place {
    /// coluna principal (antes de Sair)
    Main,
    /// submenu Extras
    #[default]
    Extras,
    /// submenu da Campanha
    Campaign,
    /// submenu da Escaramuça
    Skirmish,
    /// submenu do Multijogador
    Multiplayer,
}

impl Place {
    /// o grupo do submenu e o botão da coluna que o abre
    fn submenu(self) -> Option<(&'static str, &'static str)> {
        match self {
            Place::Campaign => Some(("g_campaign_options", "campaign")),
            Place::Skirmish => Some(("g_skirmish_options", "skirmish")),
            Place::Multiplayer => Some(("g_multiplayer_options", "multiplayer")),
            _ => None,
        }
    }
}

/// Um botão novo, como a montagem recebe (já com a chave única e o Lua do clique).
#[derive(Debug, Clone, PartialEq)]
pub struct NewButton {
    /// `<mod>:<botão>`
    pub key: String,
    pub label: String,
    pub place: Place,
    /// Tratador do jogo chamado no clique (de [`NATIVE`]).
    pub native: Option<String>,
    /// Chama o motor da Forja no clique.
    pub lua: bool,
    /// Código Lua próprio do clique (atalhos do launcher), no lugar do motor da Forja.
    pub code: Option<String>,
}

/// Máximo de botões num submenu (Campanha, Escaramuça, Multijogador).
pub const MAX_SUBMENU: usize = 7;

/// O que montar.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MenuEdit {
    pub buttons: Vec<NewButton>,
    /// Botão do jogo (chave de [`MAIN`] ou [`EXTRAS`]) → nome novo.
    pub rename: BTreeMap<String, String>,
    pub hide: BTreeSet<String>,
}

impl MenuEdit {
    pub fn is_empty(&self) -> bool {
        self.buttons.is_empty() && self.rename.is_empty() && self.hide.is_empty()
    }
}

/// Resultado: a cena nova, onde cada botão ficou e o que não deu.
#[derive(Debug, Clone, PartialEq)]
pub struct Built {
    pub scene: Vec<u8>,
    pub placed: Vec<(String, Place)>,
    pub warnings: Vec<String>,
}

/// Código Lua que um botão roda no clique.
pub fn click_lua(key: &str) -> String {
    format!("UI_Lua import(\"{DISPATCH}\").ForjaMenuClick(\"{key}\")")
}

/// Quantos botões cabem: coluna principal (com Sair) e submenu Extras.
pub const MAX_MAIN: usize = 8;
pub const MAX_EXTRAS: usize = 7;
/// Altura de um botão e o espaço entre eles na tela original.
const BUTTON_H: i32 = 52;
const STEP: i32 = 50;
/// Topo da coluna original e o mais alto que ela pode subir (abaixo do logotipo).
const TOP: i32 = 439;
const HIGHEST: i32 = 405;
/// Último botão quando a coluna tem mais botões que a original.
const LAST_Y: i32 = 707;
/// Limite de baixo (a tela tem 768).
const BOTTOM: i32 = 764;

fn find(s: &Scene, name: &str) -> Result<u32> {
    s.by_name(name).map(|e| e.id).map_err(|_| Error::Other(format!("a tela inicial do jogo é diferente do esperado (sem {name})")))
}

/// Visual da tela inicial.
#[derive(Debug, Clone, Default, PartialEq)]
pub enum Look {
    /// a do jogo (só os botões dos mods entram)
    #[default]
    Original,
    /// "Comandante": logo em cima, botões grandes com ícone e borda neon, notícias, rodapé
    Commander(Commander),
}

/// Textos da tela "Comandante".
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Commander {
    pub news_title: String,
    pub news_text: String,
}

/// Pasta das texturas da tela "Comandante" (arquivos novos: o jogo acha sem mexer no índice).
pub const TEX: &str = "/textures/ui/common/pc/frontend/cp/";
const BLANK: &str = "/textures/ui/common/pc/frontend/blank.dds";

/// Medidas da coluna em cada visual.
struct Geo {
    x: Option<(i32, i32)>,
    h: i32,
    sub_step: i32,
    sub_h: i32,
    highest: i32,
    bottom: i32,
    commander: bool,
}

impl Geo {
    fn of(look: &Look) -> Geo {
        match look {
            Look::Original => Geo { x: None, h: BUTTON_H, sub_step: STEP, sub_h: BUTTON_H, highest: HIGHEST, bottom: BOTTOM, commander: false },
            Look::Commander(_) => Geo { x: Some((C_X0, C_X1)), h: C_H, sub_step: SUB_STEP, sub_h: SUB_H, highest: C_TOP, bottom: C_BOTTOM, commander: true },
        }
    }
    /// (topo, passo) da coluna com `n` botões
    fn column(&self, n: i32) -> (i32, i32) {
        if self.commander {
            let step = if n <= 6 { C_STEP } else { ((C_BOTTOM - C_H - C_TOP) / (n - 1)).min(C_STEP) };
            (C_TOP, step)
        } else if n <= 6 {
            (TOP, STEP)
        } else {
            let step = ((LAST_Y - HIGHEST) / (n - 1)).min(46);
            (LAST_Y - step * (n - 1), step)
        }
    }
}

// medidas da "Comandante" (em unidades da cena; a tela 16:9 vai de x −448 a 1472, y −156 a 924)
const C_X0: i32 = -373;
const C_X1: i32 = 155;
const C_TOP: i32 = 163;
const C_STEP: i32 = 84;
const C_H: i32 = 74;
const C_BOTTOM: i32 = 860;
/// botões dos submenus na "Comandante"
const SUB_W: i32 = 420;
const SUB_H: i32 = 58;
const SUB_STEP: i32 = 64;
/// os filhos de `g_main` ficam presos à borda direita: em 16:9 a borda está 448 além da do 1024
const RIGHT: i32 = -448;

/// Ícone de cada botão da coluna na "Comandante".
fn icon_for(key: Option<&str>) -> &'static str {
    match key {
        Some("campaign") => "icon_campaign",
        Some("skirmish") => "icon_skirmish",
        Some("multiplayer") => "icon_multiplayer",
        Some("options") => "icon_options",
        Some("extras") => "icon_extras",
        Some("quit") => "icon_quit",
        _ => "icon_mod",
    }
}

/// Monta a tela inicial com as mudanças de `edit` a partir da cena `data` (a do jogo ou a de outro
/// mod que já mexe nela).
pub fn build(data: &[u8], edit: &MenuEdit) -> Result<Built> {
    build_with(data, edit, &Look::Original)
}

/// Como [`build`], com o visual escolhido.
pub fn build_with(data: &[u8], edit: &MenuEdit, look: &Look) -> Result<Built> {
    let mut s = Scene::parse(data)?;
    let mut warnings = Vec::new();
    let geo = Geo::of(look);
    let group = find(&s, "rg_menu_group")?;
    let main_ids: HashMap<&str, u32> = MAIN.iter().map(|(k, n)| find(&s, n).map(|id| (*k, id))).collect::<Result<_>>()?;
    let extra_ids: HashMap<&str, u32> = EXTRAS.iter().map(|(k, n)| find(&s, n).map(|id| (*k, id))).collect::<Result<_>>()?;
    let extras_group = find(&s, "g_extras_options")?;

    // onde fica o texto dentro de cada botão (medido na cena original, pelo primeiro dono)
    let elements = s.elements()?;
    let kinds: HashMap<u32, u32> = elements.iter().map(|e| (e.id, e.kind)).collect();
    let mut offset: HashMap<u32, [i32; 4]> = HashMap::new();
    for e in elements.iter().filter(|e| e.kind == kind::RADIO_BUTTON || e.kind == kind::BUTTON) {
        let Some(b) = s.rect(e.id)? else { continue };
        for c in s.children(e.id)? {
            if kinds.get(&c) == Some(&kind::TEXT) && !offset.contains_key(&c) {
                if let Some(l) = s.rect(c)? {
                    offset.insert(c, [l.x0 - b.x0, l.x1 - b.x1, l.y0 - b.y0, l.y1 - b.y1]);
                }
            }
        }
    }
    let label_of = |s: &Scene, id: u32| -> Result<Option<u32>> { Ok(s.children(id)?.into_iter().find(|c| kinds.get(c) == Some(&kind::TEXT))) };

    // nomes
    for (key, text) in &edit.rename {
        let id = main_ids.get(key.as_str()).or_else(|| extra_ids.get(key.as_str()));
        match id {
            Some(&id) => match label_of(&s, id)? {
                Some(l) => s.set_text(l, text)?,
                None => warnings.push(format!("o botão \"{key}\" não tem texto para trocar")),
            },
            None => warnings.push(format!("não existe botão \"{key}\" na tela inicial")),
        }
    }
    for h in &edit.hide {
        if h == "quit" {
            warnings.push("o botão Sair não pode ser escondido".into());
        } else if !main_ids.contains_key(h.as_str()) && !extra_ids.contains_key(h.as_str()) {
            warnings.push(format!("não existe botão \"{h}\" na tela inicial"));
        }
    }
    let hidden = |k: &str| k != "quit" && edit.hide.contains(k);

    // quem vai para onde (o que não cabe vai para o outro lugar, ou fica de fora)
    let stock_main: Vec<&str> = MAIN.iter().map(|(k, _)| *k).filter(|k| !hidden(k)).collect();
    let stock_extras: Vec<&str> = EXTRAS.iter().map(|(k, _)| *k).filter(|k| !hidden(k)).collect();
    let extras_open = !hidden("extras");
    let (mut to_main, mut to_extras): (Vec<&NewButton>, Vec<&NewButton>) = (Vec::new(), Vec::new());
    // submenus da Campanha, da Escaramuça e do Multijogador
    let mut to_sub: Vec<(Place, Vec<&NewButton>)> = Vec::new();
    for b in &edit.buttons {
        if let Some((group, owner)) = b.place.submenu() {
            if !hidden(owner) {
                let count = s.children(find(&s, group)?)?.len();
                let slot = match to_sub.iter().position(|(p, _)| *p == b.place) {
                    Some(i) => i,
                    None => {
                        to_sub.push((b.place, Vec::new()));
                        to_sub.len() - 1
                    }
                };
                if count + to_sub[slot].1.len() < MAX_SUBMENU {
                    to_sub[slot].1.push(b);
                } else {
                    warnings.push(format!("\"{}\" ficou de fora: o submenu está cheio", b.label));
                }
                continue;
            }
            warnings.push(format!("\"{}\" foi para o submenu Extras (o botão do submenu dele está escondido)", b.label));
        }
        let want_main = b.place == Place::Main || !extras_open;
        let main_free = stock_main.len() + to_main.len() < MAX_MAIN;
        let extras_free = extras_open && stock_extras.len() + to_extras.len() < MAX_EXTRAS;
        if want_main && main_free {
            to_main.push(b);
        } else if !want_main && extras_free {
            to_extras.push(b);
        } else if main_free {
            warnings.push(format!("\"{}\" foi para a coluna principal (o submenu Extras está cheio ou escondido)", b.label));
            to_main.push(b);
        } else if extras_free {
            warnings.push(format!("\"{}\" foi para o submenu Extras (a coluna principal está cheia)", b.label));
            to_extras.push(b);
        } else {
            warnings.push(format!("\"{}\" ficou de fora: não cabe mais nenhum botão na tela inicial", b.label));
        }
    }

    let events_for = |s: &Scene, template: u32, b: &NewButton, main: bool| -> Result<Vec<Event>> {
        // sons do botão modelo; as ações dele não vêm junto
        let mut evs: Vec<Event> = s.events(template)?.into_iter().filter(|e| e.name == "PlaySound").collect();
        if let Some(code) = &b.code {
            evs.push(Event::new(event::SELECT, "ConsoleExecute", &format!("UI_Lua {code}")));
        } else if b.lua {
            evs.push(Event::new(event::SELECT, "ConsoleExecute", &click_lua(&b.key)));
        }
        if let Some(n) = &b.native {
            evs.push(Event::new(event::SELECT, n, ""));
        }
        if main {
            // fecha o submenu que estiver aberto
            evs.push(Event::new(event::SELECT, "ShowMainMenuGroup", ""));
        }
        Ok(evs)
    };
    let make = |s: &mut Scene, template: u32, b: &NewButton, main: bool| -> Result<u32> {
        let label_t = label_of(s, template)?.ok_or_else(|| Error::Other("botão modelo sem texto".into()))?;
        let slug: String = b.key.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
        let id = s.clone_element(template, &format!("rb_forja_{slug}"))?;
        let label = s.clone_element(label_t, &format!("rb_forja_{slug}_label"))?;
        s.set_text(label, &b.label)?;
        s.set_children(id, &[label])?;
        let evs = events_for(s, template, b, main)?;
        s.set_events(id, &evs)?;
        Ok(id)
    };
    let mut placed = Vec::new();

    // coluna principal: botões do jogo na ordem, os dos mods antes de Sair
    let mut column: Vec<(u32, Option<&str>)> = stock_main.iter().filter(|k| **k != "quit").map(|k| (main_ids[k], Some(*k))).collect();
    for b in &to_main {
        column.push((make(&mut s, main_ids["options"], b, true)?, None));
        placed.push((b.key.clone(), Place::Main));
    }
    column.push((main_ids["quit"], Some("quit")));
    let n = column.len() as i32;
    let (top, step) = geo.column(n);
    let mut moved: Vec<u32> = Vec::new();
    for (i, &(id, _)) in column.iter().enumerate() {
        let old = s.rect(id)?.ok_or_else(|| Error::Other("botão sem posição".into()))?;
        let y = top + step * i as i32;
        let (x0, x1) = geo.x.unwrap_or((old.x0, old.x1));
        let (dx, dy) = (x0 - old.x0, y - old.y0);
        s.set_rect(id, Rect::new(x0, x1, y, y + geo.h))?;
        moved.push(id);
        // o submenu do botão vai junto (na "Comandante", ao lado, alinhado com o botão)
        let mut seen = BTreeSet::new();
        for c in s.children(id)? {
            if kinds.get(&c) == Some(&kind::TEXT) {
                continue;
            }
            let (sdx, sdy) = match (geo.commander, s.rect(c)?) {
                (true, Some(r)) => (x1 + 18 - r.x0, y - r.y0),
                _ => (dx, dy),
            };
            shift_tree(&mut s, c, sdx, sdy, &kinds, &mut seen, &mut moved)?;
        }
    }
    let first_x = geo.x.map(|x| x.0);
    if let Some(r) = s.rect(group)? {
        let (x0, x1) = geo.x.unwrap_or((r.x0, r.x1));
        s.set_rect(group, Rect::new(x0, x1, top, top + step * (n - 1) + geo.h))?;
    }
    if geo.commander {
        s.set_anchors(group, Anchors { x: first_x, y: Some(top), ..Default::default() })?;
    }
    let ids: Vec<u32> = column.iter().map(|c| c.0).collect();
    s.set_children(group, &ids)?;
    // submenus que passaram da borda de baixo sobem
    for &id in &ids {
        for c in s.children(id)? {
            if kinds.get(&c) == Some(&kind::GROUP) {
                if let Some(r) = s.rect(c)? {
                    if r.y1 > geo.bottom {
                        let mut seen = BTreeSet::new();
                        shift_tree(&mut s, c, 0, geo.bottom - r.y1, &kinds, &mut seen, &mut moved)?;
                    }
                }
            }
        }
    }

    // submenu Extras: Replays, Créditos e os dos mods, em coluna terminando acima da borda
    if extras_open && (!to_extras.is_empty() || stock_extras.len() < EXTRAS.len() || geo.commander) {
        let mut items: Vec<u32> = stock_extras.iter().map(|k| extra_ids[k]).collect();
        for b in &to_extras {
            items.push(make(&mut s, extra_ids["credits"], b, false)?);
            placed.push((b.key.clone(), Place::Extras));
        }
        let ext = s.rect(main_ids["extras"])?.unwrap_or(Rect::new(0, 0, TOP, TOP));
        let count = items.len().max(1) as i32;
        let base = ext.y0.min(geo.bottom - geo.sub_step * (count - 1) - geo.sub_h).max(geo.highest);
        let sub_x = geo.x.map(|(_, x1)| (x1 + 18, x1 + 18 + SUB_W));
        for (i, &id) in items.iter().enumerate() {
            let old = s.rect(id)?.ok_or_else(|| Error::Other("botão sem posição".into()))?;
            let y = base + geo.sub_step * i as i32;
            let (x0, x1) = sub_x.unwrap_or((old.x0, old.x1));
            s.set_rect(id, Rect::new(x0, x1, y, y + geo.sub_h))?;
            moved.push(id);
        }
        if let Some(r) = s.rect(extras_group)? {
            let (x0, x1) = sub_x.unwrap_or((r.x0, r.x1));
            s.set_rect(extras_group, Rect::new(x0, x1, base, base + geo.sub_step * count + 2))?;
        }
        s.set_children(extras_group, &items)?;
    }

    // itens novos nos submenus da Campanha, da Escaramuça e do Multijogador (depois dos do jogo)
    for (place, list) in &to_sub {
        let Some((gname, _)) = place.submenu() else { continue };
        let g = find(&s, gname)?;
        let mut kids = s.children(g)?;
        let mut items: Vec<(i32, u32)> = Vec::new();
        for &c in &kids {
            if kinds.get(&c) == Some(&kind::RADIO_BUTTON) {
                items.push((s.rect(c)?.map(|r| r.y0).unwrap_or(0), c));
            }
        }
        let Some(&(_, template)) = items.iter().min() else { continue };
        let tr = s.rect(template)?.ok_or_else(|| Error::Other("botão sem posição".into()))?;
        let mut y = items.iter().map(|i| i.0).max().unwrap_or(tr.y0);
        for b in list {
            let id = make(&mut s, template, b, false)?;
            y += STEP;
            s.set_rect(id, Rect { y0: y, y1: y + tr.height(), ..tr })?;
            moved.push(id);
            kids.push(id);
            placed.push((b.key.clone(), *place));
        }
        s.set_children(g, &kids)?;
        if let Some(r) = s.rect(g)? {
            let r = Rect { y1: r.y1.max(y + tr.height()), ..r };
            s.set_rect(g, r)?;
            if r.y1 > geo.bottom {
                let mut seen = BTreeSet::new();
                shift_tree(&mut s, g, 0, geo.bottom - r.y1, &kinds, &mut seen, &mut moved)?;
            }
        }
    }

    // o texto de cada botão que mudou de lugar fica na mesma posição dentro dele
    let column_ids: BTreeSet<u32> = ids.iter().copied().collect();
    let moved: BTreeSet<u32> = moved.into_iter().collect();
    for &id in &moved {
        let Some(k) = kinds.get(&id).copied().or_else(|| s.by_id(id).ok().map(|e| e.kind)) else { continue };
        if k != kind::RADIO_BUTTON && k != kind::BUTTON {
            continue;
        }
        let Some(b) = s.rect(id)? else { continue };
        for c in s.children(id)? {
            let Ok(e) = s.by_id(c) else { continue };
            if e.kind != kind::TEXT {
                continue;
            }
            if geo.commander && column_ids.contains(&id) {
                s.set_rect(c, Rect::new(b.x0 + 92, b.x1 - 60, b.y0 + 10, b.y1 - 10))?;
                s.set_str_field(c, 108, "pc_title_font_4")?;
            } else {
                let o = offset.get(&c).copied().unwrap_or([31, -31, 6, -6]);
                s.set_rect(c, Rect::new(b.x0 + o[0], b.x1 + o[1], b.y0 + o[2], b.y1 + o[3]))?;
            }
        }
    }
    if let Look::Commander(c) = look {
        commander(&mut s, c, &column)?;
    }
    Ok(Built { scene: s.to_bytes(), placed, warnings })
}

/// O resto da "Comandante": fundo, logo, texturas dos botões, ícones, lado direito e rodapé.
fn commander(s: &mut Scene, c: &Commander, column: &[(u32, Option<&str>)]) -> Result<()> {
    let tex = |n: &str| format!("{TEX}{n}.dds");
    // fundo: tom e vinheta por cima do vídeo, sombra atrás dos botões, sem as faixas azuis
    let tint = find(s, "black_overlay")?;
    s.set_rect(tint, Rect::new(-448, 1472, -156, 924))?;
    s.set_str_field(tint, 112, &tex("tint"))?;
    s.set_anchors(tint, Anchors { left: Some(0), right: Some(0), top: Some(0), bottom: Some(0), ..Default::default() })?;
    let shade = find(s, "blue_overlay")?;
    s.set_rect(shade, Rect::new(-448, 700, -156, 924))?;
    s.set_str_field(shade, 112, &tex("shade"))?;
    s.set_anchors(shade, Anchors { left: Some(0), top: Some(0), bottom: Some(0), x: Some(-448), ..Default::default() })?;
    for n in ["temp_lines", "topline"] {
        if let Ok(e) = s.by_name(n) {
            s.set_str_field(e.id, 112, BLANK)?;
        }
    }
    let logo = find(s, "sc2_logo")?;
    s.set_rect(logo, Rect::new(-373, 267, -60, 87))?;
    s.set_anchors(logo, Anchors { x: Some(-373), y: Some(-60), ..Default::default() })?;

    // botões: os da coluna com a textura grande, os dos submenus com a fina, maiores e em coluna
    // ao lado do botão de cada um
    let column_ids: BTreeSet<u32> = column.iter().map(|c| c.0).collect();
    for e in s.elements()? {
        if e.kind != kind::RADIO_BUTTON {
            continue;
        }
        let prefix = if column_ids.contains(&e.id) { "btn" } else { "sub" };
        for off in [112, 116, 120, 124, 128, 132] {
            let old = s.str_field(e.id, off)?;
            if let Some(rest) = old.to_ascii_lowercase().split("mainmenu/btn_").nth(1) {
                let state = rest.trim_end_matches(".dds");
                let state = if ["u", "o", "w", "at"].contains(&state) { state } else { "u" };
                s.set_str_field(e.id, off, &tex(&format!("{prefix}_{state}")))?;
            }
        }
    }
    for &(id, _) in column {
        let Some(b) = s.rect(id)? else { continue };
        for g in s.children(id)? {
            if s.by_id(g)?.kind != kind::GROUP {
                continue;
            }
            let mut items: Vec<(i32, u32)> = Vec::new();
            for c in s.children(g)? {
                if s.by_id(c)?.kind == kind::RADIO_BUTTON {
                    items.push((s.rect(c)?.map(|r| r.y0).unwrap_or(0), c));
                }
            }
            items.sort();
            let n = items.len().max(1) as i32;
            let base = b.y0.min(C_BOTTOM - SUB_STEP * (n - 1) - SUB_H);
            let x0 = C_X1 + 18;
            for (k, &(_, c)) in items.iter().enumerate() {
                let y = base + SUB_STEP * k as i32;
                s.set_rect(c, Rect::new(x0, x0 + SUB_W, y, y + SUB_H))?;
                for l in s.children(c)? {
                    if s.by_id(l)?.kind == kind::TEXT {
                        s.set_rect(l, Rect::new(x0 + 26, x0 + SUB_W - 52, y + 9, y + SUB_H - 9))?;
                        s.set_str_field(l, 108, "pc_title_font_3")?;
                    }
                }
            }
            s.set_rect(g, Rect::new(x0, x0 + SUB_W, base, base + SUB_STEP * (n - 1) + SUB_H))?;
        }
    }
    // ícones dentro dos botões da coluna
    let avatar = find(s, "avatar")?;
    for &(id, key) in column {
        let r = s.rect(id)?.ok_or_else(|| Error::Other("botão sem posição".into()))?;
        let icon = s.clone_element(avatar, &format!("cp_icon_{id}"))?;
        s.set_str_field(icon, 112, &tex(icon_for(key)))?;
        s.set_rect(icon, Rect::new(r.x0 + 26, r.x0 + 78, r.y0 + 11, r.y0 + 63))?;
        let mut kids = vec![icon];
        kids.extend(s.children(id)?);
        s.set_children(id, &kids)?;
    }

    // lado direito (filhos de g_main, presos à borda direita)
    let main = find(s, "g_main")?;
    let place = |s: &mut Scene, name: &str, right: i32, top: i32| -> Result<()> {
        let Ok(e) = s.by_name(name) else { return Ok(()) };
        let Some(r) = s.rect(e.id)? else { return Ok(()) };
        let mut seen = BTreeSet::new();
        let kinds: HashMap<u32, u32> = HashMap::new();
        let mut moved = Vec::new();
        shift_tree(s, e.id, right + RIGHT - r.x1, top - r.y0, &kinds, &mut seen, &mut moved)
    };
    // caixa do jogador: foto à esquerda (moldura reta), nome ao lado
    place(s, "g_steam_username", 1448, -131)?;
    let set = |s: &mut Scene, name: &str, r: Rect| -> Result<()> {
        if let Ok(e) = s.by_name(name) {
            s.set_rect(e.id, Rect::new(r.x0 + RIGHT, r.x1 + RIGHT, r.y0, r.y1))?;
        }
        Ok(())
    };
    set(s, "g_steam_username", Rect::new(1178, 1448, -131, -77))?;
    set(s, "gamertag_bg", Rect::new(1178, 1448, -131, -77))?;
    set(s, "avatar", Rect::new(1190, 1230, -124, -84))?;
    set(s, "avatar_overlay", Rect::new(1186, 1234, -128, -80))?;
    set(s, "label_gamertag", Rect::new(1244, 1436, -124, -84))?;
    if let Ok(e) = s.by_name("gamertag_bg") {
        s.set_str_field(e.id, 112, &tex("gamertag"))?;
    }
    if let Ok(e) = s.by_name("avatar_overlay") {
        s.set_str_field(e.id, 112, &tex("avatar_frame"))?;
    }
    if let Ok(e) = s.by_name("label_gamertag") {
        s.set_u32(e.id, 128, 0)?; // nome à esquerda, colado na foto
    }
    let has_news = !c.news_title.trim().is_empty() || !c.news_text.trim().is_empty();
    let mut y = if has_news { 268 } else { -60 };
    for n in ["g_steam_leaderboards", "g_steam_chat", "g_DLC"] {
        place(s, n, 1436, y)?;
        y += 34;
    }
    let mut extra = Vec::new();
    if has_news {
        let panel = s.clone_element(avatar, "cp_news_panel")?;
        s.set_str_field(panel, 112, &tex("panel"))?;
        s.set_rect(panel, Rect::new(1059 + RIGHT, 1436 + RIGHT, 14, 252))?;
        let img = s.clone_element(avatar, "cp_news_image")?;
        s.set_str_field(img, 112, &tex("news"))?;
        s.set_rect(img, Rect::new(1067 + RIGHT, 1428 + RIGHT, 52, 176))?;
        extra.extend([panel, img]);
        let label = find(s, "label_chat")?;
        for (i, (text, font)) in [(&c.news_title, "pc_title_font_3"), (&c.news_text, "pc_body_font_narrow_3")].into_iter().enumerate() {
            if text.trim().is_empty() {
                continue;
            }
            let t = s.clone_element(label, &format!("cp_news_text{i}"))?;
            s.set_text(t, text.trim())?;
            s.set_str_field(t, 108, font)?;
            s.set_u32(t, 128, 0)?; // à esquerda
            let y0 = 182 + 28 * i as i32;
            s.set_rect(t, Rect::new(1069 + RIGHT, 1426 + RIGHT, y0, y0 + 28))?;
            extra.push(t);
        }
    }
    if let Ok(e) = s.by_name("label_version") {
        s.set_rect(e.id, Rect::new(1150 + RIGHT, 1440 + RIGHT, 862, 892))?;
    }
    let mut kids = extra;
    kids.extend(s.children(main)?);
    s.set_children(main, &kids)?;

    Ok(())
}

/// Troca o logo da tela "Comandante" por outra textura (`w`×`h` em pixels), na mesma largura e
/// com a altura da proporção dela (centrado na faixa do logo).
pub fn set_logo(scene: &[u8], texture: &str, w: u32, h: u32) -> Result<Vec<u8>> {
    let mut s = Scene::parse(scene)?;
    let logo = find(&s, "sc2_logo")?;
    let width = 640;
    let height = ((width as f32 * h as f32 / w.max(1) as f32).round() as i32).clamp(40, 220);
    let y0 = 13 - height / 2;
    s.set_str_field(logo, 112, texture)?;
    s.set_rect(logo, Rect::new(C_X0, C_X0 + width, y0, y0 + height))?;
    s.set_anchors(logo, Anchors { x: Some(C_X0), y: Some(y0), ..Default::default() })?;
    Ok(s.to_bytes())
}

/// Desloca um elemento e tudo dentro dele (menos os textos, que são postos no fim).
fn shift_tree(s: &mut Scene, id: u32, dx: i32, dy: i32, kinds: &HashMap<u32, u32>, seen: &mut BTreeSet<u32>, moved: &mut Vec<u32>) -> Result<()> {
    if (dx == 0 && dy == 0) || !seen.insert(id) || kinds.get(&id) == Some(&kind::TEXT) {
        return Ok(());
    }
    if let Some(r) = s.rect(id)? {
        s.set_rect(id, r.shifted(dx, dy))?;
        moved.push(id);
    }
    for c in s.children(id)? {
        shift_tree(s, c, dx, dy, kinds, seen, moved)?;
    }
    Ok(())
}

/// Um botão como aparece: (nome do elemento, texto, retângulo).
pub type Shown = (String, String, Rect);

/// Lê de volta os botões da tela inicial (para conferir e para os testes): (nome do elemento, texto,
/// retângulo) na ordem da coluna principal e do submenu Extras.
pub fn describe(data: &[u8]) -> Result<(Vec<Shown>, Vec<Shown>)> {
    let s = Scene::parse(data)?;
    let read = |group: u32| -> Result<Vec<Shown>> {
        let mut out = Vec::new();
        for id in s.children(group)? {
            let e = s.by_id(id)?;
            let text = s.children(id)?.into_iter().find_map(|c| s.text(c).ok()).unwrap_or_default();
            out.push((e.name, text, s.rect(id)?.unwrap_or(Rect { x0: 0, x1: 0, y0: 0, y1: 0 })));
        }
        Ok(out)
    };
    Ok((read(find(&s, "rg_menu_group")?)?, read(find(&s, "g_extras_options")?)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::NONE;

    /// Tela inicial pequena com os nomes do jogo (6 botões, Extras com Replays e Créditos).
    fn menu() -> Vec<u8> {
        crate::scene::tests::menu_sample()
    }

    fn button(key: &str, label: &str, place: Place) -> NewButton {
        NewButton { key: key.into(), label: label.into(), place, native: None, lua: true, code: None }
    }

    #[test]
    fn adds_renames_and_hides() {
        let data = menu();
        let mut edit = MenuEdit::default();
        edit.buttons.push(button("demo:main", "MEU MOD", Place::Main));
        edit.buttons.push(button("demo:a", "ITEM A", Place::Extras));
        edit.buttons.push(NewButton { native: Some("RequestLanGame".into()), lua: false, ..button("demo:lan", "LAN", Place::Extras) });
        edit.rename.insert("extras".into(), "EXTRAS E MODS".into());
        edit.hide.insert("credits".into());
        let out = build(&data, &edit).unwrap();
        assert!(out.warnings.is_empty(), "{:?}", out.warnings);
        let (main, extras) = describe(&out.scene).unwrap();
        let names: Vec<&str> = main.iter().map(|m| m.0.as_str()).collect();
        assert_eq!(names, ["rb_campaign", "rb_skirmish", "rb_multiplayer", "rb_options", "rb_extras", "rb_forja_demo_main", "rb_quit"]);
        assert_eq!(main[4].1, "EXTRAS E MODS");
        assert_eq!(main[5].1, "MEU MOD");
        // 7 botões: mais juntos, Sair no fim e nada passa da borda
        assert_eq!(main[6].2.y0, LAST_Y);
        assert!(main.windows(2).all(|w| w[1].2.y0 - w[0].2.y0 == 46));
        let ex: Vec<&str> = extras.iter().map(|e| e.1.as_str()).collect();
        assert_eq!(ex, ["<LOC b_replays>REPLAYS", "ITEM A", "LAN"]);
        assert!(extras.last().unwrap().2.y1 <= BOTTOM);
        // o texto acompanha o botão
        let s = Scene::parse(&out.scene).unwrap();
        let b = s.by_name("rb_forja_demo_main").unwrap().id;
        let br = s.rect(b).unwrap().unwrap();
        let l = s.children(b).unwrap()[0];
        assert_eq!(s.rect(l).unwrap().unwrap().y0, br.y0 + 6);
        let q = s.by_name("rb_quit").unwrap().id;
        let ql = s.children(q).unwrap()[0];
        assert_eq!(s.rect(ql).unwrap().unwrap().y0, LAST_Y + 6);
        // eventos: som do modelo + Lua + fecha submenu; o da LAN chama o jogo
        let ev = s.events(b).unwrap();
        assert!(ev.iter().any(|e| e.name == "PlaySound"));
        assert!(ev.iter().any(|e| e.name == "ConsoleExecute" && e.param == click_lua("demo:main")));
        assert!(!ev.iter().any(|e| e.name == "RequestOptionsMenu"));
        let lan = s.by_name("rb_forja_demo_lan").unwrap().id;
        let ev = s.events(lan).unwrap();
        assert!(ev.iter().any(|e| e.name == "RequestLanGame"));
        assert!(!ev.iter().any(|e| e.name == "ConsoleExecute"));
        assert_eq!(out.placed.len(), 3);
        // item novo no submenu da Campanha, embaixo do tutorial, com código próprio
        let mut edit = MenuEdit::default();
        edit.buttons.push(NewButton { code: Some("LOG('oi')".into()), lua: false, ..button("cp:x", "ATALHO", Place::Campaign) });
        let out = build(&data, &edit).unwrap();
        let s = Scene::parse(&out.scene).unwrap();
        let g = s.by_name("g_campaign_options").unwrap().id;
        let kids = s.children(g).unwrap();
        assert_eq!(kids.len(), 2);
        let new = s.by_name("rb_forja_cp_x").unwrap().id;
        assert_eq!(*kids.last().unwrap(), new);
        let tut = s.rect(s.by_name("rb_tutorial").unwrap().id).unwrap().unwrap();
        assert_eq!(s.rect(new).unwrap().unwrap().y0, tut.y0 + STEP);
        assert!(s.events(new).unwrap().iter().any(|e| e.name == "ConsoleExecute" && e.param == "UI_Lua LOG('oi')"));
        let _ = NONE;
    }

    #[test]
    fn overflow_and_warnings() {
        let data = menu();
        let mut edit = MenuEdit::default();
        for i in 0..12 {
            edit.buttons.push(button(&format!("m:b{i}"), &format!("B{i}"), Place::Main));
        }
        edit.hide.insert("quit".into());
        edit.rename.insert("nada".into(), "X".into());
        let out = build(&data, &edit).unwrap();
        let (main, extras) = describe(&out.scene).unwrap();
        assert_eq!(main.len(), MAX_MAIN);
        assert_eq!(main.last().unwrap().0, "rb_quit");
        assert!(main[0].2.y0 >= HIGHEST);
        assert_eq!(extras.len(), MAX_EXTRAS);
        assert!(extras[0].2.y0 >= HIGHEST && extras.last().unwrap().2.y1 <= BOTTOM);
        assert!(out.warnings.iter().any(|w| w.contains("Sair")));
        assert!(out.warnings.iter().any(|w| w.contains("nada")));
        assert!(out.warnings.iter().any(|w| w.contains("ficou de fora")));
        // escondendo: a coluna encolhe e continua do mesmo jeito em cima
        let mut edit = MenuEdit::default();
        edit.hide.insert("multiplayer".into());
        let out = build(&data, &edit).unwrap();
        let (main, _) = describe(&out.scene).unwrap();
        assert_eq!(main.len(), 5);
        assert_eq!(main[0].2.y0, TOP);
        assert_eq!(main[2].0, "rb_options");
    }
}

/// Confere com a cena de verdade do jogo quando `CP_TEST_SCENE` aponta para ela.
#[cfg(test)]
#[test]
fn real_scene_when_available() {
    let Ok(path) = std::env::var("CP_TEST_SCENE") else { return };
    let data = std::fs::read(path).unwrap();
    let (main, extras) = describe(&data).unwrap();
    assert_eq!(main.len(), 6);
    assert_eq!(extras.len(), 2);
    let mut edit = MenuEdit::default();
    edit.buttons.push(NewButton { key: "t:a".into(), label: "MODS (DIRETO)".into(), place: Place::Main, native: None, lua: true, code: None });
    for i in 0..3 {
        edit.buttons.push(NewButton { key: format!("t:x{i}"), label: format!("FORJA: ITEM {}", i + 1), place: Place::Extras, native: None, lua: true, code: None });
    }
    edit.buttons.push(NewButton { key: "t:lan".into(), label: "REDE LOCAL (LAN)".into(), place: Place::Extras, native: Some("RequestLanGame".into()), lua: false, code: None });
    edit.buttons.push(NewButton { key: "cp:mega0".into(), label: "MEGA: 6 CONTRA 6".into(), place: Place::Skirmish, native: None, lua: false, code: Some("LOG('mega')".into()) });
    edit.rename.insert("extras".into(), "EXTRAS E MODS".into());
    let out = build(&data, &edit).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    let (main, extras) = describe(&out.scene).unwrap();
    for m in main.iter().chain(&extras) {
        eprintln!("{:<28} {:<40} {:?}", m.0, m.1, m.2);
    }
    if let Ok(dest) = std::env::var("CP_TEST_SCENE_OUT") {
        std::fs::write(dest, &out.scene).unwrap();
    }
    let look = Look::Commander(Commander { news_title: "Bem-vindo ao CommandProject".into(), news_text: "Tela inicial nova, feita pelo launcher.".into() });
    let out = build_with(&data, &edit, &look).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    let (main, extras) = describe(&out.scene).unwrap();
    assert_eq!(main[0].2, Rect::new(C_X0, C_X1, C_TOP, C_TOP + C_H));
    assert!(extras.iter().all(|e| e.2.x0 == C_X1 + 18 && e.2.x1 == C_X1 + 18 + SUB_W && e.2.y1 <= C_BOTTOM));
    if let Ok(dest) = std::env::var("CP_TEST_SCENE_OUT2") {
        std::fs::write(dest, &out.scene).unwrap();
    }
}
