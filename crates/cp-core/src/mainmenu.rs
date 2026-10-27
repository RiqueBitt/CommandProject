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
use crate::scene::{event, kind, Event, Rect, Scene};
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
}

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

/// Monta a tela inicial com as mudanças de `edit` a partir da cena `data` (a do jogo ou a de outro
/// mod que já mexe nela).
pub fn build(data: &[u8], edit: &MenuEdit) -> Result<Built> {
    let mut s = Scene::parse(data)?;
    let mut warnings = Vec::new();
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
    for b in &edit.buttons {
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
        if b.lua {
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
    let mut column: Vec<u32> = stock_main.iter().filter(|k| **k != "quit").map(|k| main_ids[k]).collect();
    for b in &to_main {
        column.push(make(&mut s, main_ids["options"], b, true)?);
        placed.push((b.key.clone(), Place::Main));
    }
    column.push(main_ids["quit"]);
    let n = column.len() as i32;
    let (top, step) = if n <= 6 { (TOP, STEP) } else {
        let step = ((LAST_Y - HIGHEST) / (n - 1)).min(46);
        (LAST_Y - step * (n - 1), step)
    };
    let mut moved: Vec<u32> = Vec::new();
    for (i, &id) in column.iter().enumerate() {
        let old = s.rect(id)?.ok_or_else(|| Error::Other("botão sem posição".into()))?;
        let y = top + step * i as i32;
        let dy = y - old.y0;
        s.set_rect(id, Rect { y0: y, y1: y + BUTTON_H, ..old })?;
        moved.push(id);
        // o submenu do botão vai junto
        let mut seen = BTreeSet::new();
        for c in s.children(id)? {
            if kinds.get(&c) != Some(&kind::TEXT) {
                shift_tree(&mut s, c, dy, &kinds, &mut seen, &mut moved)?;
            }
        }
    }
    if let Some(r) = s.rect(group)? {
        s.set_rect(group, Rect { y0: top, y1: top + step * (n - 1) + BUTTON_H, ..r })?;
    }
    s.set_children(group, &column)?;
    // submenus que passaram da borda de baixo sobem
    for &id in &column {
        for c in s.children(id)? {
            if kinds.get(&c) == Some(&kind::GROUP) {
                if let Some(r) = s.rect(c)? {
                    if r.y1 > BOTTOM {
                        let mut seen = BTreeSet::new();
                        shift_tree(&mut s, c, BOTTOM - r.y1, &kinds, &mut seen, &mut moved)?;
                    }
                }
            }
        }
    }

    // submenu Extras: Replays, Créditos e os dos mods, em coluna terminando acima da borda
    if extras_open && (!to_extras.is_empty() || stock_extras.len() < EXTRAS.len()) {
        let mut items: Vec<u32> = stock_extras.iter().map(|k| extra_ids[k]).collect();
        for b in &to_extras {
            items.push(make(&mut s, extra_ids["credits"], b, false)?);
            placed.push((b.key.clone(), Place::Extras));
        }
        let ext_y = s.rect(main_ids["extras"])?.map(|r| r.y0).unwrap_or(TOP);
        let count = items.len().max(1) as i32;
        let base = ext_y.min(BOTTOM - STEP * (count - 1) - BUTTON_H).max(HIGHEST);
        for (i, &id) in items.iter().enumerate() {
            let old = s.rect(id)?.ok_or_else(|| Error::Other("botão sem posição".into()))?;
            let y = base + STEP * i as i32;
            s.set_rect(id, Rect { y0: y, y1: y + BUTTON_H, ..old })?;
            moved.push(id);
        }
        if let Some(r) = s.rect(extras_group)? {
            s.set_rect(extras_group, Rect { y0: base, y1: base + STEP * count + 2, ..r })?;
        }
        s.set_children(extras_group, &items)?;
    }

    // o texto de cada botão que mudou de lugar fica na mesma posição dentro dele
    let moved: BTreeSet<u32> = moved.into_iter().collect();
    for id in moved {
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
            let o = offset.get(&c).copied().unwrap_or([31, -31, 6, -6]);
            s.set_rect(c, Rect { x0: b.x0 + o[0], x1: b.x1 + o[1], y0: b.y0 + o[2], y1: b.y1 + o[3] })?;
        }
    }
    Ok(Built { scene: s.to_bytes(), placed, warnings })
}

/// Desloca um elemento e tudo dentro dele (menos os textos, que são postos no fim).
fn shift_tree(s: &mut Scene, id: u32, dy: i32, kinds: &HashMap<u32, u32>, seen: &mut BTreeSet<u32>, moved: &mut Vec<u32>) -> Result<()> {
    if dy == 0 || !seen.insert(id) || kinds.get(&id) == Some(&kind::TEXT) {
        return Ok(());
    }
    if let Some(r) = s.rect(id)? {
        s.set_rect(id, r.moved(dy))?;
        moved.push(id);
    }
    for c in s.children(id)? {
        shift_tree(s, c, dy, kinds, seen, moved)?;
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
        NewButton { key: key.into(), label: label.into(), place, native: None, lua: true }
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
    edit.buttons.push(NewButton { key: "t:a".into(), label: "MODS (DIRETO)".into(), place: Place::Main, native: None, lua: true });
    for i in 0..3 {
        edit.buttons.push(NewButton { key: format!("t:x{i}"), label: format!("FORJA: ITEM {}", i + 1), place: Place::Extras, native: None, lua: true });
    }
    edit.buttons.push(NewButton { key: "t:lan".into(), label: "REDE LOCAL (LAN)".into(), place: Place::Extras, native: Some("RequestLanGame".into()), lua: false });
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
}
