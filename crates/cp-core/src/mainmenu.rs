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
    /// o painel "Criar jogo" vai ao lado do submenu da Escaramuça: os atalhos do lado direito
    /// (classificação, chat) sobem para baixo da caixa do jogador e o do DLC vai para baixo da coluna
    pub panel: bool,
}

/// Campo com a ordem de desenho do elemento (quem tem o número maior fica por cima).
pub const ORDER: usize = 104;

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
        // ordem de desenho: depois do botão (com a do avatar, o fundo do botão ficava por cima e o
        // ícone parecia cinza)
        let order = s.u32_field(id, ORDER)?;
        s.set_u32(icon, ORDER, order + 1)?;
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
    if c.panel {
        place(s, "g_steam_leaderboards", 1436, -72)?;
        place(s, "g_steam_chat", 1300, -72)?;
        place(s, "g_DLC", C_X1, C_BOTTOM - 140)?;
    } else {
        let mut y = if has_news { 268 } else { -60 };
        for n in ["g_steam_leaderboards", "g_steam_chat", "g_DLC"] {
            place(s, n, 1436, y)?;
            y += 34;
        }
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

/// Os outros menus do jogo (cenas) que ganham o visual da tela "Comandante".
pub const FRONTEND_SCENES: &[&str] = &[
    "/ui/scenes/frontend_skirmish/pc_frontend_skirmish.win.bdf",
    "/ui/scenes/frontend_options/pc_frontend_options.win.bdf",
    "/ui/scenes/frontend_options/pc_frontend_options_videoadv.win.bdf",
    "/ui/scenes/frontend_options/pc_frontend_options_conlayout.win.bdf",
    "/ui/scenes/frontend_mp_browser/pc_frontend_mp_browser.win.bdf",
    "/ui/scenes/frontend_mp_host/pc_frontend_mp_host.win.bdf",
    "/ui/scenes/frontend_mp_quickmatch/pc_frontend_mp_quickmatch.win.bdf",
    "/ui/scenes/frontend_ranked/pc_frontend_ranked.win.bdf",
    "/ui/scenes/frontend_campaign/pc_frontend_campaign.win.bdf",
    "/ui/scenes/frontend_summary_sp/pc_frontend_summary_sp.win.bdf",
    "/ui/scenes/frontend_summary_mp/pc_frontend_summary_mp.win.bdf",
    "/ui/scenes/frontend_manager/pc_frontend_manager.win.bdf",
];

/// Textura nova (da "Comandante") para uma textura dos outros menus do jogo, pelo tipo do
/// elemento: botões e abas viram as caixas de escolha com borda neon, as faixas de 3 pedaços e os
/// painéis de 9 pedaços viram os painéis escuros com borda neon. O resto fica (e é pintado na cor
/// escolhida pelo tema).
pub fn restyle_texture(kind: u32, path: &str) -> Option<String> {
    let p = path.to_ascii_lowercase().replace('\\', "/");
    let file = p.rsplit('/').next()?.strip_suffix(".dds")?;
    let dir = p.trim_end_matches(&format!("{file}.dds"));
    let tex = |n: &str| Some(format!("{TEX}{n}.dds"));
    let state = |f: &str| -> &'static str {
        match f.rsplit('_').next() {
            Some("o") => "o",
            Some("w") => "w",
            Some("at") => "at",
            _ => "u",
        }
    };
    let common = dir.ends_with("/frontend/common/");
    match kind {
        // botões comuns (Voltar, Começar, Enviar, ...) e as barras das opções ao passar o mouse
        // os grandes (Voltar, Iniciar) ficam como os da tela inicial; os outros, caixas de escolha
        kind::BUTTON if common && file.starts_with("button07") => tex(&format!("big_{}", state(file))),
        kind::BUTTON if common && file.starts_with("button") => tex(&format!("opt_{}", state(file))),
        kind::BUTTON if dir.ends_with("/frontend/options/") && (file == "bar_o" || file == "bar_w") => tex(&format!("opt_{}", state(file))),
        // abas e botões de escolha
        kind::RADIO_BUTTON if dir.ends_with("/frontend/options/") && file.starts_with("btn_") => tex(&format!("opt_{}", state(file))),
        kind::RADIO_BUTTON if dir.ends_with("/frontend/browser/") && file.starts_with("tab_") => tex(if file == "tab_d" { "opt_at" } else { "opt_u" }),
        // faixas de 3 pedaços
        kind::THREE_SLICE => {
            let part = file.rsplit('_').next()?;
            let known = ["left_bg", "newbg", "newbg_lrg", "dialog_bg01", "64h_bluebar", "bluebg", "32h_bar"];
            if ["l", "c", "r"].contains(&part) && known.iter().any(|k| file == format!("{k}_{part}")) {
                tex(&format!("p3_{part}"))
            } else {
                None
            }
        }
        // painéis de 9 pedaços (listas, janelas, fundo das opções)
        kind::NINE_SLICE => {
            let f = file.trim_end_matches("_short");
            let part = if f == "blackbg" { "c" } else { f.rsplit('_').next()? };
            let base = f.trim_end_matches(&format!("_{part}"));
            let known = ["blackbg", "dropdown_01", "scrollwindow", "bg"];
            if ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"].contains(&part) && known.contains(&base) {
                tex(&format!("p9_{part}"))
            } else {
                None
            }
        }
        _ => None,
    }
}

/// Um menu do jogo no visual "Comandante": a faixa azul vira o tom escuro por cima do vídeo (preso
/// às bordas da tela, qualquer que seja o tamanho da cena), as linhas soltas somem, a faixa de
/// cima fica escura e botões, abas, faixas e painéis ganham as texturas da tela inicial
/// ([`restyle_texture`]).
pub fn restyle_frontend(scene: &[u8]) -> Result<Vec<u8>> {
    let mut s = Scene::parse(scene)?;
    let tex = |n: &str| format!("{TEX}{n}.dds");
    let full = Anchors { left: Some(0), right: Some(0), top: Some(0), bottom: Some(0), ..Default::default() };
    let has = |s: &Scene, n: &str| s.by_name(n).ok().map(|e| e.id);
    let black = has(&s, "black_overlay");
    let blue = has(&s, "blue_overlay");
    let all = s.elements()?;
    // um elemento da raiz cobrindo a tela (os de dentro de grupos ficam como estão)
    let root_ids: BTreeSet<u32> = {
        let mut kids = BTreeSet::new();
        for e in &all {
            kids.extend(s.children(e.id)?);
        }
        all.iter().map(|e| e.id).filter(|i| !kids.contains(i)).collect()
    };
    // um "blue_overlay" dentro de um grupo é o fundo de uma janela (as opções): escuro, sem o tom
    let blue = match blue {
        Some(b) if !root_ids.contains(&b) => {
            s.set_str_field(b, 112, &tex("p9_c"))?;
            None
        }
        other => other,
    };
    let tint_target = black.or(blue);
    if let Some(id) = tint_target {
        s.set_str_field(id, 112, &tex("tint"))?;
        if root_ids.contains(&id) {
            s.set_anchors(id, full)?;
        }
    }
    if let (Some(_), Some(b)) = (black, blue) {
        s.set_str_field(b, 112, BLANK)?;
    }
    if let Some(id) = has(&s, "temp_lines") {
        s.set_str_field(id, 112, BLANK)?;
    }
    if let Some(id) = has(&s, "top_blue_grad") {
        s.set_str_field(id, 112, &tex("topbar"))?;
    }
    // a faixa de cima e as linhas vão de uma borda à outra da tela (no 4:3 delas, viravam a borda de
    // uma caixa no meio da tela)
    let (w, _) = s.size();
    let (left, right) = (w as i32 / 2 - 960, w as i32 / 2 + 960);
    for n in ["top_blue_grad", "topline", "btmline"] {
        if let Some(id) = has(&s, n) {
            if let Some(r) = s.rect(id)? {
                s.set_rect(id, Rect::new(left, right, r.y0, r.y1))?;
            }
        }
    }
    // texturas dos botões, abas, faixas e painéis
    for e in &all {
        let Some(slots) = crate::scene::texture_slots(e.kind) else { continue };
        for off in slots {
            let Ok(old) = s.str_field(e.id, off) else { continue };
            if let Some(new) = restyle_texture(e.kind, &old) {
                s.set_str_field(e.id, off, &new)?;
            }
        }
    }
    // filetes de destaque embaixo do título e em cima dos botões de baixo
    for n in ["topline", "btmline"] {
        if let Some(id) = has(&s, n) {
            s.set_str_field(id, 112, &tex("line"))?;
            if let Some(r) = s.rect(id)? {
                s.set_rect(id, Rect::new(r.x0, r.x1, r.y0 - 1, r.y0 + 3))?;
            }
        }
    }
    // a imagem da operação da campanha numa moldura
    if let (Some(img), Some(info)) = (has(&s, "op_image"), has(&s, "g_opinfo")) {
        if let Some(r) = s.rect(img)? {
            let over = has(&s, "op_movie").map(|m| s.u32_field(m, ORDER)).transpose()?.unwrap_or(0).max(s.u32_field(img, ORDER)?);
            let pieces = frame(&mut s, img, r, over + 1, "cp_op")?;
            let mut kids = s.children(info)?;
            kids.extend(pieces);
            s.set_children(info, &kids)?;
        }
    }
    // opções: as que o jogo tem mas não mostra no PC
    if has(&s, "interface_11_btn").is_some() {
        more_options(&mut s)?;
    }
    Ok(s.to_bytes())
}

/// Moldura neon (os 8 pedaços de borda do painel) em volta de `r`, copiada da figura `src`;
/// devolve os elementos novos (para pôr no grupo certo).
fn frame(s: &mut Scene, src: u32, r: Rect, order: u32, name: &str) -> Result<Vec<u32>> {
    let e = 16;
    let mut out = Vec::new();
    for (n, rr) in [
        ("tl", Rect::new(r.x0 - 4, r.x0 + e, r.y0 - 4, r.y0 + e)),
        ("t", Rect::new(r.x0 + e, r.x1 - e, r.y0 - 4, r.y0 + e)),
        ("tr", Rect::new(r.x1 - e, r.x1 + 4, r.y0 - 4, r.y0 + e)),
        ("l", Rect::new(r.x0 - 4, r.x0 + e, r.y0 + e, r.y1 - e)),
        ("r", Rect::new(r.x1 - e, r.x1 + 4, r.y0 + e, r.y1 - e)),
        ("bl", Rect::new(r.x0 - 4, r.x0 + e, r.y1 - e, r.y1 + 4)),
        ("b", Rect::new(r.x0 + e, r.x1 - e, r.y1 - e, r.y1 + 4)),
        ("br", Rect::new(r.x1 - e, r.x1 + 4, r.y1 - e, r.y1 + 4)),
    ] {
        let id = s.clone_element(src, &format!("{name}_frame_{n}"))?;
        s.set_str_field(id, 112, &format!("{TEX}f8_{n}.dds"))?;
        s.set_rect(id, rr)?;
        s.set_u32(id, ORDER, order)?;
        out.push(id);
    }
    Ok(out)
}

/// Linhas novas na tela de opções (as do `options.lua` que o jogo esconde no PC, ligadas em
/// [`OPTIONS_LUA_CONTROLS`]) e a janela mais alta para caber tudo.
fn more_options(s: &mut Scene) -> Result<()> {
    let row_h = 26;
    let top = 222;
    let find = |s: &Scene, n: &str| s.by_name(n).map(|e| e.id);
    // copia uma linha (botão com texto, valor e seta) com outro número
    let clone_row = |s: &mut Scene, tab: &str, n: u32, title: &str| -> Result<u32> {
        let src = find(s, &format!("{tab}_11_btn")).or_else(|_| find(s, "interface_11_btn"))?;
        let btn = s.clone_element(src, &format!("{tab}_{n}_btn"))?;
        let mut kids = Vec::new();
        for c in s.children(src)? {
            let old = s.by_id(c)?.name;
            let part = old.rsplit('_').next().unwrap_or("x").to_string();
            let id = s.clone_element(c, &format!("{tab}_{n}_{part}"))?;
            if part == "label" {
                s.set_text(id, title)?;
            }
            kids.push(id);
        }
        s.set_children(btn, &kids)?;
        Ok(btn)
    };
    // põe a linha (e o que está dentro) na altura `y`
    let put = |s: &mut Scene, id: u32, y: i32| -> Result<()> {
        let Some(r) = s.rect(id)? else { return Ok(()) };
        let dy = y - r.y0;
        let mut seen = BTreeSet::new();
        let mut moved = Vec::new();
        shift_tree(s, id, 0, dy, &HashMap::new(), &mut seen, &mut moved)
    };
    // interface: 12 linhas
    let g = find(s, "g_interface")?;
    let mut kids = s.children(g)?;
    for (n, _, title) in OPTIONS_LUA_CONTROLS.iter().filter(|c| c.1.starts_with("interface")) {
        if find(s, &format!("interface_{n}_btn")).is_err() {
            let id = clone_row(s, "interface", *n, title)?;
            kids.push(id);
        }
    }
    s.set_children(g, &kids)?;
    for (i, n) in [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13].iter().enumerate() {
        if let Ok(id) = find(s, &format!("interface_{n}_btn")) {
            put(s, id, top + row_h * i as i32)?;
        }
    }
    let rows_end = top + row_h * 12;
    if let Ok(id) = find(s, "interface_8_btn") {
        put(s, id, rows_end + 14)?;
    }
    // vídeo: o céu depois das três linhas; os botões descem
    let gv = find(s, "g_video")?;
    for (n, fallback) in [(6, "Sky"), (7, "Lite graphics"), (8, "Interface color"), (9, "HUD style")] {
        let name = format!("video_{n}_btn");
        if find(s, &name).is_ok() {
            continue;
        }
        let control = format!("video_{n}_value");
        let title = OPTIONS_LUA_CONTROLS.iter().find(|c| c.1 == control).map(|c| c.2).unwrap_or(fallback);
        // linha de valor do vídeo: copia a da interface e troca o prefixo
        let src = find(s, "interface_11_btn")?;
        let btn = s.clone_element(src, &name)?;
        let mut kids = Vec::new();
        for c in s.children(src)? {
            let part = s.by_id(c)?.name.rsplit('_').next().unwrap_or("x").to_string();
            let id = s.clone_element(c, &format!("video_{n}_{part}"))?;
            if part == "label" {
                s.set_text(id, title)?;
            }
            kids.push(id);
        }
        s.set_children(btn, &kids)?;
        let mut vk = s.children(gv)?;
        vk.push(btn);
        s.set_children(gv, &vk)?;
    }
    for (n, y) in [("video_1_btn", top), ("video_2_btn", top + row_h), ("video_3_btn", top + 2 * row_h), ("video_6_btn", top + 3 * row_h), ("video_7_btn", top + 4 * row_h), ("video_8_btn", top + 5 * row_h), ("video_9_btn", top + 6 * row_h), ("video_5_btn", top + 7 * row_h + 18), ("video_4_btn", top + 7 * row_h + 70)] {
        if let Ok(id) = find(s, n) {
            put(s, id, y)?;
        }
    }
    // nomes mais compridos (em português): a coluna dos valores vai para a direita
    let shift = 60;
    for e in s.elements()? {
        let n = e.name.as_str();
        let is_row = ["interface_", "video_", "controls_", "sound_"].iter().any(|p| n.starts_with(p));
        if !is_row {
            continue;
        }
        let Some(r) = s.rect(e.id)? else { continue };
        if n.ends_with("_value") {
            s.set_rect(e.id, Rect::new(r.x0 + shift, r.x1, r.y0, r.y1))?;
        } else if n.ends_with("_downarr") {
            s.set_rect(e.id, r.shifted(shift, 0))?;
        } else if let Some(prefix) = n.strip_suffix("_label") {
            // só nas linhas de valor (nas de barra, a seta da barra vem logo depois do nome)
            if r.x1 < 700 && s.by_name(&format!("{prefix}_value")).is_ok() {
                s.set_rect(e.id, Rect::new(r.x0, r.x1 + shift, r.y0, r.y1))?;
            }
        }
    }
    // janela, fundo de dentro e OK/Cancelar mais para baixo
    let bottom = rows_end + 14 + 42;
    if let Ok(id) = find(s, "g_btm_buttons") {
        put(s, id, bottom + 16)?;
    }
    if let Ok(id) = find(s, "g_options") {
        if let Some(r) = s.rect(id)? {
            s.set_rect(id, Rect::new(r.x0, r.x1, r.y0, bottom + 16 + 54 + 14))?;
        }
    }
    if let Ok(id) = find(s, "blue_overlay") {
        if let Some(r) = s.rect(id)? {
            s.set_rect(id, Rect::new(r.x0, r.x1, r.y0, bottom + 6))?;
        }
    }
    for n in ["g_interface", "g_video"] {
        if let Ok(id) = find(s, n) {
            if let Some(r) = s.rect(id)? {
                s.set_rect(id, Rect::new(r.x0, r.x1, r.y0, bottom))?;
            }
        }
    }
    Ok(())
}

/// Os vídeos de abertura do jogo (texto Lua).
pub const SPLASH_LUA: &str = "/lua/ui/splash/splash.lua";

/// Pula os vídeos de abertura (logos e aviso legal): o jogo vai direto para a tela inicial, como
/// com a preferência `movie.nologo`. `None` se o arquivo é diferente do esperado.
pub fn patch_splash_lua(text: &str) -> Option<String> {
    let pat = "if GetPreference(\"movie.nologo\") then";
    if text.contains("if true or GetPreference(\"movie.nologo\") then") {
        return Some(text.to_string());
    }
    text.contains(pat).then(|| text.replacen(pat, "if true or GetPreference(\"movie.nologo\") then", 1))
}

/// As opções do jogo (texto Lua).
pub const OPTIONS_LUA: &str = "/lua/ui/options/options.lua";

/// Opções do `options.lua` do jogo que existem mas não aparecem no PC: (número da linha, controle,
/// título). As três primeiras já apontam para a linha; as outras ganham o `ui_control` em
/// [`patch_options_lua`].
pub const OPTIONS_LUA_CONTROLS: &[(u32, &str, &str)] = &[
    (1, "interface_1_value", "<LOC OPTIONS_0107>Construction Tooltip Information"),
    (2, "interface_2_value", "<LOC OPTIONS_0078>Tooltip Delay"),
    (4, "interface_4_value", "<LOC OPTIONS_0228>Unit Health Bars"),
    (12, "interface_12_value", "<LOC OPTIONS_0076>Economy Warnings"),
    (13, "interface_13_value", "<LOC OPTIONS_0210>Show Lifebars of Attached Units"),
    (6, "video_6_value", "<LOC OPTIONS_0168>Render Sky"),
    (7, "video_7_value", "<LOC CP_LITE>Lite graphics (big matches)"),
    (8, "video_8_value", "<LOC CP_UI_COLOR>Interface color (next start)"),
    (9, "video_9_value", "<LOC CP_UI_HUD>Match HUD style (next start)"),
];

/// Liga as opções escondidas às linhas novas da tela de opções (`ui_control`). `None` se o
/// arquivo não tem o que esperamos.
pub fn patch_options_lua(text: &str) -> Option<String> {
    let mut out = text.to_string();
    for (key, control) in [("econ_warnings", "interface_12_value"), ("show_attached_unit_lifebars", "interface_13_value"), ("render_skydome", "video_6_value")] {
        let pat = format!("key = '{key}',");
        let at = out.find(&pat)?;
        if out[at + pat.len()..].trim_start().starts_with("ui_control =") {
            continue;
        }
        let nl = if out.contains("\r\n") { "\r\n" } else { "\n" };
        let line_start = out[..at].rfind('\n').map(|i| i + 1).unwrap_or(0);
        let indent: String = out[line_start..at].chars().take_while(|c| c.is_whitespace()).collect();
        let insert = format!("{nl}{indent}ui_control = '{control}',");
        out.insert_str(at + pat.len(), &insert);
    }
    // opção nova: gráficos mais leves (menos detalhe nas unidades longe e sem marcas de explosão no
    // chão), para as partidas grandes rodarem melhor; vale desde a abertura do jogo
    if !out.contains(LITE_MARK) {
        out.push_str(LITE_OPTION);
    }
    if !out.contains(UI_MARK) {
        out.push_str(&ui_option());
    }
    Some(out)
}

const LITE_MARK: &str = "-- CommandProject: gráficos leves";
const LITE_OPTION: &str = r#"

-- CommandProject: gráficos leves (opção de vídeo; vale desde a abertura do jogo)
local function CPApplyLite(v)
    v = tonumber(v) or 0
    local lod = 0
    if v >= 2 then lod = 2 elseif v >= 1 then lod = 1 end
    pcall(ConExecute, 'ren_LODReduction ' .. lod)
    pcall(ConExecute, 'ren_TerrainDynamicDecals ' .. ((v >= 2) and 'false' or 'true'))
end
if options and options.video and options.video.items then
    table.insert(options.video.items, {
        title = "<LOC CP_LITE>Lite graphics (big matches)",
        key = 'cp_lite',
        type = 'toggle',
        default = 0,
        ui_control = 'video_7_value',
        set = function(key, value, startup) CPApplyLite(value) end,
        custom = {
            states = {
                { text = "<LOC _Off>Off", key = 0 },
                { text = "<LOC CP_LITE_1>Light", key = 1 },
                { text = "<LOC CP_LITE_2>Strong", key = 2 },
            },
        },
    })
end
"#;

const UI_MARK: &str = "-- CommandProject: cor da interface";

/// Cor da interface e estilo da HUD nas Opções do jogo: viram pedidos para o launcher (como o
/// painel do Extras), que pinta as texturas na próxima vez que o jogo abrir por ele.
fn ui_option() -> String {
    let mut states = String::from("                { text = \"<LOC CP_UI_LAUNCHER>As in the launcher\", key = 0 },\n");
    let mut hexes = String::new();
    for (i, (hex, _, en)) in crate::gamepanel::COLORS.iter().enumerate() {
        let name: String = en.chars().take(1).chain(en.chars().skip(1).flat_map(|c| c.to_lowercase())).collect();
        states.push_str(&format!("                {{ text = \"<LOC CP_COLOR_{en}>{name}\", key = {} }},\n", i + 1));
        hexes.push_str(&format!("'{hex}', "));
    }
    format!(
        r#"

{UI_MARK} e estilo da HUD (pedidos para o launcher)
local CPUIColors = {{ {hexes}}}
local function CPLauncherAsk(key, value)
    pcall(function()
        local m = import('/lua/SinglePlayerLaunch.lua')
        if m.CPLauncherSet then m.CPLauncherSet(key, value) end
    end)
end
if options and options.video and options.video.items then
    table.insert(options.video.items, {{
        title = "<LOC CP_UI_COLOR>Interface color (next start)",
        key = 'cp_ui_color',
        type = 'toggle',
        default = 0,
        ui_control = 'video_8_value',
        set = function(key, value, startup)
            value = tonumber(value) or 0
            if not startup and CPUIColors[value] then CPLauncherAsk('accent', CPUIColors[value]) end
        end,
        custom = {{
            states = {{
{states}            }},
        }},
    }})
    table.insert(options.video.items, {{
        title = "<LOC CP_UI_HUD>Match HUD style (next start)",
        key = 'cp_ui_hud',
        type = 'toggle',
        default = 0,
        ui_control = 'video_9_value',
        set = function(key, value, startup)
            value = tonumber(value) or 0
            if not startup and value == 1 then CPLauncherAsk('hud', true) end
            if not startup and value == 2 then CPLauncherAsk('hud', false) end
        end,
        custom = {{
            states = {{
                {{ text = "<LOC CP_UI_LAUNCHER>As in the launcher", key = 0 }},
                {{ text = "<LOC CP_UI_HUD_NEW>New (interface color)", key = 1 }},
                {{ text = "<LOC CP_UI_HUD_OLD>Original", key = 2 }},
            }},
        }},
    }})
end
"#
    )
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
    fn other_menus_get_the_new_textures() {
        let f = "/textures/ui/common/pc/frontend/";
        assert_eq!(restyle_texture(kind::BUTTON, &format!("{f}common/button07_o.dds")), Some(format!("{TEX}big_o.dds")));
        assert_eq!(restyle_texture(kind::BUTTON, &format!("{f}common/button09_d.dds")), Some(format!("{TEX}opt_u.dds")));
        assert_eq!(restyle_texture(kind::RADIO_BUTTON, &format!("{f}options/btn_at.dds")), Some(format!("{TEX}opt_at.dds")));
        assert_eq!(restyle_texture(kind::THREE_SLICE, &format!("{f}skirmish/left_bg_c.dds")), Some(format!("{TEX}p3_c.dds")));
        assert_eq!(restyle_texture(kind::NINE_SLICE, &format!("{f}options/bg_tl_short.dds")), Some(format!("{TEX}p9_tl.dds")));
        assert_eq!(restyle_texture(kind::NINE_SLICE, &format!("{f}common/scrollwindow_br.dds")), Some(format!("{TEX}p9_br.dds")));
        assert_eq!(restyle_texture(kind::NINE_SLICE, &format!("{f}blackbg.dds")), Some(format!("{TEX}p9_c.dds")));
        // setas, ícones e o resto ficam
        assert_eq!(restyle_texture(kind::BUTTON, &format!("{f}common/arr_01_dn_u.dds")), None);
        assert_eq!(restyle_texture(kind::BITMAP, &format!("{f}blackbg.dds")), None);
    }

    #[test]
    fn intro_movies_are_skipped() {
        let t = "function CreateUI()\r\n    if GetPreference(\"movie.nologo\") then\r\n        EngineStartFrontEndUI()";
        let out = patch_splash_lua(t).unwrap();
        assert!(out.contains("if true or GetPreference"));
        assert_eq!(patch_splash_lua(&out).unwrap(), out);
        assert!(patch_splash_lua("x").is_none());
    }

    #[test]
    fn hidden_options_get_their_rows() {
        let text = "    {\r\n        key = 'econ_warnings',\r\n    },\r\n    {\r\n        key = 'show_attached_unit_lifebars',\r\n    },\r\n    { key = 'render_skydome',\r\n }";
        let out = patch_options_lua(text).unwrap();
        assert!(out.contains("key = 'econ_warnings',\r\n        ui_control = 'interface_12_value',"), "{out}");
        assert!(out.contains("ui_control = 'video_6_value',"));
        // de novo não duplica
        assert_eq!(patch_options_lua(&out).unwrap(), out);
        assert!(patch_options_lua("nada").is_none());
        // cor da interface e HUD: pedidos para o launcher, com as 7 cores
        assert!(out.contains("ui_control = 'video_8_value'") && out.contains("ui_control = 'video_9_value'"));
        assert!(out.contains("'#2b8cff', '#e21e24'") && out.contains("<LOC CP_COLOR_SILVER>Silver"));
        if let Ok(p) = std::env::var("CP_OPT_LUA_OUT") {
            std::fs::write(p, &out).unwrap();
        }
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
    let look = Look::Commander(Commander { news_title: "Bem-vindo ao CommandProject".into(), news_text: "Tela inicial nova, feita pelo launcher.".into(), panel: false });
    let out = build_with(&data, &edit, &look).unwrap();
    assert!(out.warnings.is_empty(), "{:?}", out.warnings);
    let (main, extras) = describe(&out.scene).unwrap();
    assert_eq!(main[0].2, Rect::new(C_X0, C_X1, C_TOP, C_TOP + C_H));
    assert!(extras.iter().all(|e| e.2.x0 == C_X1 + 18 && e.2.x1 == C_X1 + 18 + SUB_W && e.2.y1 <= C_BOTTOM));
    if let Ok(dest) = std::env::var("CP_TEST_SCENE_OUT2") {
        std::fs::write(dest, &out.scene).unwrap();
    }
}
