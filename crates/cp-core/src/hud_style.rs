//! HUD das partidas no estilo da tela inicial: cada textura da HUD é redesenhada no mesmo tamanho
//! e formato (o jogo continua montando tudo no mesmo lugar): vidro grafite com listras leves (sem o
//! azul do jogo), faixa na cor escolhida em cima dos painéis, colchetes acesos nos cantos, borda
//! apagada nos lados e botões que se enchem da cor ao passar o mouse e quando ativos.
//!
//! O formato de cada peça vem do canal alfa da textura original (cantos chanfrados, abas, encaixes
//! ficam iguais). Painéis montados em pedaços (`_l`/`_c`/`_r`, `_tl`/`_t`/... ) só ganham borda nos
//! lados de fora, para não aparecer linha no meio da barra. Ícones e setas só trocam de cor.

use std::collections::HashSet;

use crate::dds::Rgba;

/// Estado do botão pelo nome (`_u` normal, `_o` mouse em cima, `_w`/`_at` ativo, `_d` desligado).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    Normal,
    Hover,
    Active,
    Disabled,
}

/// Pedaço de um painel montado em partes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Piece {
    Whole,
    L,
    C,
    R,
    T,
    B,
    TL,
    TR,
    BL,
    BR,
}

fn stem(key: &str) -> String {
    let k = key.to_ascii_lowercase().replace('\\', "/");
    let file = k.rsplit('/').next().unwrap_or(&k).to_string();
    file.trim_end_matches(".dds").to_string()
}

pub fn state_of(key: &str) -> State {
    let s = stem(key);
    for (suf, st) in [("_d", State::Disabled), ("_o", State::Hover), ("_over", State::Hover), ("_w", State::Active), ("_at", State::Active), ("_u", State::Normal)] {
        if s.ends_with(suf) {
            return st;
        }
    }
    State::Normal
}

/// Nome sem o estado (`btn_o` → `btn`).
fn base_of(key: &str) -> String {
    let s = stem(key);
    for suf in ["_over", "_at", "_u", "_o", "_w", "_d"] {
        if let Some(b) = s.strip_suffix(suf) {
            return b.to_string();
        }
    }
    s
}

/// O pedaço (pelo sufixo) e se o painel é de 9 partes (existe o canto `_tl` irmão).
pub fn piece_of(key: &str, siblings: &HashSet<String>) -> (Piece, bool) {
    let b = base_of(key);
    let dir = {
        let k = key.to_ascii_lowercase().replace('\\', "/");
        k.trim_start_matches('/').rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default()
    };
    let (root, piece) = match b.rsplit_once('_') {
        Some((r, p)) => (
            r.to_string(),
            match p {
                "l" => Piece::L,
                "c" => Piece::C,
                "r" => Piece::R,
                "t" => Piece::T,
                "b" => Piece::B,
                "tl" => Piece::TL,
                "tr" => Piece::TR,
                "bl" => Piece::BL,
                "br" => Piece::BR,
                _ => Piece::Whole,
            },
        ),
        None => (b.clone(), Piece::Whole),
    };
    if piece == Piece::Whole {
        return (Piece::Whole, false);
    }
    let nine = siblings.contains(&format!("{dir}/{root}_tl")) || siblings.contains(&format!("{dir}/{root}_t")) || siblings.contains(&format!("{dir}/{root}_b"));
    (piece, nine)
}

/// Chave sem extensão e com barras normais, para [`piece_of`].
pub fn sibling_key(key: &str) -> String {
    let k = key.to_ascii_lowercase().replace('\\', "/");
    k.trim_start_matches('/').trim_end_matches(".dds").to_string()
}

/// Texturas que só trocam de cor (ícones, setas, relógio, grade de fundo da pesquisa).
pub fn glyph_only(key: &str) -> bool {
    let s = stem(key);
    s.starts_with("arr_") || s.starts_with("pause_") || s.starts_with("repeat_") || s.contains("clock") || s == "grid" || s.contains("checkmark") || s.contains("send_btn") || s.starts_with("zoomto")
}

/// Barras de progresso (a parte que enche).
pub fn progress_fill(key: &str) -> bool {
    let s = stem(key);
    s == "research_bar" || s == "resbar" || s == "battery_bar"
}

/// Lados com borda: (esquerda, direita, cima, baixo).
fn sides(piece: Piece, nine: bool) -> (bool, bool, bool, bool) {
    match (piece, nine) {
        (Piece::Whole, _) => (true, true, true, true),
        // barra em 3 partes (horizontal)
        (Piece::L, false) => (true, false, true, true),
        (Piece::C, false) => (false, false, true, true),
        (Piece::R, false) => (false, true, true, true),
        (Piece::T, false) => (true, true, true, false),
        (Piece::B, false) => (true, true, false, true),
        // painel em 9 partes
        (Piece::L, true) => (true, false, false, false),
        (Piece::R, true) => (false, true, false, false),
        (Piece::C, true) => (false, false, false, false),
        (Piece::T, true) => (false, false, true, false),
        (Piece::B, true) => (false, false, false, true),
        (Piece::TL, _) => (true, false, true, false),
        (Piece::TR, _) => (false, true, true, false),
        (Piece::BL, _) => (true, false, false, true),
        (Piece::BR, _) => (false, true, false, true),
    }
}

fn mix(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

/// Redesenha uma textura da HUD (mesmo tamanho). `background` = painel (vidro escuro);
/// senão botão/aba/barra (acende na cor).
// os laços por coluna leem várias tabelas pela mesma posição (x, y)
#[allow(clippy::needless_range_loop)]
pub fn restyle(img: &Rgba, key: &str, siblings: &HashSet<String>, accent: [u8; 3], background: bool) -> Rgba {
    let (w, h) = (img.width as usize, img.height as usize);
    let mut out = img.clone();
    if w < 4 || h < 4 {
        return out;
    }
    let acc = [accent[0] as f32, accent[1] as f32, accent[2] as f32];
    let state = state_of(key);
    if glyph_only(key) {
        // só a cor: o desenho (relevo) fica, os tons de azul viram a cor escolhida
        for p in out.pixels.chunks_exact_mut(4) {
            let l = (p[0] as f32 * 0.3 + p[1] as f32 * 0.59 + p[2] as f32 * 0.11) / 255.0;
            let sat = (p[0].max(p[1]).max(p[2]) as f32 - p[0].min(p[1]).min(p[2]) as f32) / 255.0;
            if sat > 0.12 {
                for c in 0..3 {
                    p[c] = (acc[c] * (0.35 + 0.9 * l)).min(255.0) as u8;
                }
            }
        }
        return out;
    }
    if progress_fill(key) {
        // barra de progresso: cheia, degradê na cor (o formato fica)
        for y in 0..h {
            let g = 1.0 - y as f32 / (h.max(2) - 1) as f32;
            for x in 0..w {
                let i = (y * w + x) * 4;
                for (c, a) in acc.iter().enumerate() {
                    out.pixels[i + c] = (a * (0.65 + 0.45 * g) + 40.0 * g).min(255.0) as u8;
                }
            }
        }
        return out;
    }
    // textura de borda suave (sombra, degradê atrás de textos e filas): só vira grafite, sem
    // linhas nem cantos (a borda viraria um halo)
    // (um vidro translúcido por igual não é suave: a transparência dele não varia)
    let soft = {
        let mut alphas: Vec<u8> = img.pixels.chunks_exact(4).map(|p| p[3]).filter(|a| *a > 20).collect();
        if alphas.len() < 16 {
            false
        } else {
            alphas.sort_unstable();
            let median = alphas[alphas.len() / 2] as i32;
            let near = alphas.iter().filter(|a| (**a as i32 - median).abs() <= 16).count();
            near * 100 < alphas.len() * 45
        }
    };
    if soft {
        for y in 0..h {
            let g = y as f32 / (h.max(2) - 1) as f32;
            for x in 0..w {
                let i = (y * w + x) * 4;
                let lum = (img.pixels[i] as f32 * 0.3 + img.pixels[i + 1] as f32 * 0.59 + img.pixels[i + 2] as f32 * 0.11) / 255.0;
                let base = [mix(30.0, 12.0, g), mix(33.0, 13.0, g), mix(39.0, 17.0, g)];
                let lift = if state == State::Hover || state == State::Active { 0.25 } else { 0.0 };
                for k in 0..3 {
                    out.pixels[i + k] = (mix(base[k], acc[k], lift) + lum * 20.0).clamp(0.0, 255.0) as u8;
                }
            }
        }
        return out;
    }
    let (piece, nine) = piece_of(key, siblings);
    let (bl, br, bt, bb) = sides(piece, nine);
    let alpha = |x: usize, y: usize| img.pixels[(y * w + x) * 4 + 3] as f32 / 255.0;
    // distância (em pixels, até 3) até a borda do formato
    let edge_dist = |x: usize, y: usize| -> f32 {
        let mut d = 9.0f32;
        if bl {
            d = d.min(x as f32);
        }
        if br {
            d = d.min((w - 1 - x) as f32);
        }
        if bt {
            d = d.min(y as f32);
        }
        if bb {
            d = d.min((h - 1 - y) as f32);
        }
        for r in 1..=3i32 {
            if d <= (r - 1) as f32 {
                break;
            }
            let mut hit = false;
            for (dx, dy) in [(r, 0), (-r, 0), (0, r), (0, -r), (r, r), (-r, -r), (r, -r), (-r, r)] {
                let (nx, ny) = (x as i32 + dx, y as i32 + dy);
                if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                    continue;
                }
                if alpha(nx as usize, ny as usize) < 0.35 {
                    hit = true;
                }
            }
            if hit {
                d = d.min((r - 1) as f32);
                break;
            }
        }
        d
    };
    // topo visível de cada coluna (a faixa de cima segue os chanfros do formato)
    let top_y: Vec<usize> = (0..w).map(|x| (0..h).find(|&y| alpha(x, y) >= 0.35).unwrap_or(h)).collect();
    // cantos com colchete (onde dois lados com borda se encontram)
    let arm = if background { (w.min(h) as f32 * 0.5).clamp(8.0, 26.0) } else { (w.min(h) as f32 * 0.32).clamp(4.0, 12.0) };
    let bracket = |x: usize, y: usize| -> bool {
        let (fx, fy) = (x as f32, y as f32);
        let (rx, ry) = ((w - 1 - x) as f32, (h - 1 - y) as f32);
        (bl && bt && fx < arm && fy < arm) || (br && bt && rx < arm && fy < arm) || (bl && bb && fx < arm && ry < arm) || (br && bb && rx < arm && ry < arm)
    };
    let white = [235.0f32, 242.0, 250.0];
    let dim = [acc[0] * 0.38 + 18.0, acc[1] * 0.38 + 20.0, acc[2] * 0.38 + 24.0];
    for y in 0..h {
        let g = if h >= 8 && !(nine && background) { y as f32 / (h - 1) as f32 } else { 0.5 };
        // vidro grafite (sem o azul do jogo): mais claro em cima
        let glass = [mix(31.0, 13.0, g), mix(34.0, 14.0, g), mix(40.0, 18.0, g)];
        for x in 0..w {
            let i = (y * w + x) * 4;
            let a = img.pixels[i + 3] as f32 / 255.0;
            if a <= 0.02 {
                continue;
            }
            let d = edge_dist(x, y);
            let from_top = y as f32 - top_y[x] as f32;
            let top_bar = bt && from_top < 3.5;
            let corner = d < 2.0 && bracket(x, y);
            // listras diagonais bem leves nos painéis
            let stripe = if background && (x + y) % 8 == 0 { 5.0 } else { 0.0 };
            let mut c = [0f32; 3];
            for k in 0..3 {
                let fill = match (background, state) {
                    (true, _) => glass[k] + stripe + if bt && from_top < 10.0 { acc[k] * 0.10 * (1.0 - from_top / 10.0) } else { 0.0 },
                    (false, State::Normal) => glass[k] + 6.0,
                    (false, State::Hover) => mix(glass[k], acc[k], 0.22 + 0.25 * g),
                    (false, State::Active) => mix(acc[k] * 0.55, acc[k] * 0.95, 1.0 - g) + 10.0,
                    (false, State::Disabled) => mix(glass[k], 40.0, 0.4),
                };
                let border = match (background, state) {
                    (false, State::Disabled) => 70.0,
                    (false, State::Hover) => mix(acc[k], white[k], 0.25),
                    (false, State::Active) => mix(acc[k], white[k], 0.55),
                    _ => dim[k],
                };
                c[k] = if corner && state != State::Disabled {
                    // colchete aceso nos cantos
                    mix(acc[k], white[k], 0.2)
                } else if background && top_bar {
                    // faixa na cor em cima dos painéis
                    mix(acc[k], white[k], if from_top < 1.0 { 0.25 } else { 0.0 })
                } else if d < 1.5 {
                    border
                } else if d < 3.0 && !background && state != State::Normal && state != State::Disabled {
                    mix(fill, acc[k], 0.3)
                } else {
                    fill
                };
            }
            out.pixels[i] = c[0].clamp(0.0, 255.0) as u8;
            out.pixels[i + 1] = c[1].clamp(0.0, 255.0) as u8;
            out.pixels[i + 2] = c[2].clamp(0.0, 255.0) as u8;
            // vidro um pouco translúcido nos painéis (linhas e cantos cheios)
            let na = if background && d >= 1.5 && !top_bar && !corner { a * 0.92 } else { a };
            out.pixels[i + 3] = (na * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(w: u32, h: u32, rgba: [u8; 4]) -> Rgba {
        Rgba { width: w, height: h, pixels: rgba.iter().copied().cycle().take((w * h * 4) as usize).collect() }
    }

    #[test]
    fn pieces_and_states() {
        let sib: HashSet<String> = ["textures/ui/common/pc/ingame/research/bg_tl", "textures/ui/common/pc/ingame/research/bg_c"].iter().map(|s| s.to_string()).collect();
        assert_eq!(piece_of("/textures/ui/common/pc/ingame/research/bg_l.dds", &sib), (Piece::L, true));
        assert_eq!(piece_of("/textures/ui/common/pc/ingame/hud/chat/chatbg_l.dds", &sib), (Piece::L, false));
        assert_eq!(piece_of("/textures/ui/common/pc/ingame/hud/top_bg.dds", &sib), (Piece::Whole, false));
        assert_eq!(state_of("/x/top_btn_o.dds"), State::Hover);
        assert_eq!(state_of("/x/tab_at.dds"), State::Active);
        assert_eq!(state_of("/x/btn_d.dds"), State::Disabled);
        assert!(glyph_only("/x/arr_dn_u.dds") && glyph_only("/x/orders_clock.dds") && !glyph_only("/x/top_bg.dds"));
    }

    #[test]
    fn panel_gets_neon_outline_and_dark_glass() {
        let img = solid(32, 16, [40, 90, 160, 255]);
        let out = restyle(&img, "/textures/ui/common/pc/ingame/hud/top_bg.dds", &HashSet::new(), [255, 40, 40], true);
        let px = |x: usize, y: usize| &out.pixels[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4];
        // borda vermelha, meio escuro e translúcido
        assert!(px(0, 8)[0] > 200 && px(0, 8)[2] < 120, "{:?}", px(0, 8));
        assert!(px(16, 8)[0] < 80 && px(16, 8)[3] < 255, "{:?}", px(16, 8));
    }

    #[test]
    fn middle_piece_has_no_side_lines() {
        let img = solid(16, 16, [40, 90, 160, 255]);
        let out = restyle(&img, "/textures/ui/common/pc/ingame/hud/bar_bg_c.dds", &HashSet::new(), [255, 40, 40], true);
        let p = &out.pixels[(8 * 16) * 4..(8 * 16) * 4 + 4];
        // lado esquerdo do meio da barra: sem linha
        assert!(p[0] < 120, "{p:?}");
        let top = &out.pixels[8 * 4..8 * 4 + 4];
        assert!(top[0] > 200, "{top:?}");
    }

    #[test]
    fn hover_button_lights_up() {
        let img = solid(24, 24, [40, 90, 160, 255]);
        let n = restyle(&img, "/x/top_btn_u.dds", &HashSet::new(), [0, 200, 255], false);
        let o = restyle(&img, "/x/top_btn_o.dds", &HashSet::new(), [0, 200, 255], false);
        let mid = (12 * 24 + 12) * 4;
        assert!(o.pixels[mid + 2] > n.pixels[mid + 2]);
    }

    #[test]
    fn glass_is_graphite_not_blue() {
        let img = solid(64, 32, [40, 90, 160, 255]);
        let out = restyle(&img, "/textures/ui/common/pc/ingame/hud/top_bg.dds", &HashSet::new(), [43, 140, 255], true);
        let p = &out.pixels[(16 * 64 + 32) * 4..(16 * 64 + 32) * 4 + 3];
        // o meio do painel é cinza escuro: azul quase igual ao vermelho
        assert!((p[2] as i32 - p[0] as i32) < 12 && p[2] < 60, "{p:?}");
    }

    #[test]
    fn active_button_is_filled_with_the_color() {
        let img = solid(40, 20, [40, 90, 160, 255]);
        let out = restyle(&img, "/x/top_btn_w.dds", &HashSet::new(), [255, 40, 40], false);
        let p = &out.pixels[(10 * 40 + 20) * 4..(10 * 40 + 20) * 4 + 3];
        assert!(p[0] > 150 && p[1] < 80, "{p:?}");
    }

    #[test]
    fn soft_shadow_gets_no_outline() {
        // degradê de transparência (sombra atrás de texto): só vira grafite
        let mut img = solid(32, 32, [0, 0, 0, 255]);
        for y in 0..32 {
            for x in 0..32 {
                img.pixels[(y * 32 + x) * 4 + 3] = (x * 8) as u8;
            }
        }
        let out = restyle(&img, "/x/info_bg.dds", &HashSet::new(), [255, 0, 0], true);
        for y in 0..32 {
            for x in 0..32 {
                let i = (y * 32 + x) * 4;
                assert_eq!(out.pixels[i + 3], img.pixels[i + 3]);
                assert!(out.pixels[i] < 90, "linha vermelha em {x},{y}");
            }
        }
    }

    #[test]
    fn transparent_shape_is_kept() {
        let mut img = solid(16, 16, [40, 90, 160, 255]);
        for y in 0..16 {
            for x in 0..4 {
                img.pixels[(y * 16 + x) * 4 + 3] = 0;
            }
        }
        let out = restyle(&img, "/x/tab_u.dds", &HashSet::new(), [255, 0, 0], false);
        assert_eq!(out.pixels[3], 0);
        // a borda segue o formato: a primeira coluna visível é linha (mais vermelha que o meio)
        assert!(out.pixels[(8 * 16 + 4) * 4] > out.pixels[(8 * 16 + 10) * 4] + 40);
        // e o canto de cima dela é colchete aceso
        assert!(out.pixels[4 * 4] > 200);
    }
}

#[cfg(test)]
mod preview {
    /// Com `CP_HUD_SRC` (um .scd/.zip com as texturas da HUD do jogo) e `CP_HUD_OUT`: grava cada
    /// textura antes e depois (PNG), para conferir o visual.
    #[test]
    fn hud_preview() {
        let (Ok(src), Ok(out)) = (std::env::var("CP_HUD_SRC"), std::env::var("CP_HUD_OUT")) else { return };
        let accent = std::env::var("CP_HUD_ACCENT").unwrap_or("#2b8cff".into());
        let opts = crate::startscreen::theme_options(&accent, true);
        let src = std::path::PathBuf::from(src);
        let themed = crate::menu_theme::themed_textures(std::slice::from_ref(&src), &opts).unwrap();
        let mut scd = crate::scd::Scd::open(&src).unwrap();
        let entries = scd.entries().unwrap();
        std::fs::create_dir_all(&out).unwrap();
        for (name, data) in themed {
            let Some(i) = entries.iter().position(|e| e.name == name) else { continue };
            let orig = scd.read_at(i).unwrap();
            let flat = name.replace(['\\', '/'], "_");
            let (_, a) = crate::dds::decode(&orig).unwrap();
            let (_, b) = crate::dds::decode(&data).unwrap();
            std::fs::write(format!("{out}/{flat}.a.png"), crate::dds::to_png(&a).unwrap()).unwrap();
            std::fs::write(format!("{out}/{flat}.b.png"), crate::dds::to_png(&b).unwrap()).unwrap();
        }
    }
}

#[cfg(test)]
mod hotmenu {
    /// Com `CP_MENU_BASE` (tela inicial montada, .scd), `CP_MENU_SCENE` (a cena do menu sem o painel),
    /// `CP_MENU_SRC` (arquivos do jogo com os cenários e minimapas, separados por vírgula) e
    /// `CP_MENU_OUT`: a tela inicial com o painel novo da Partida grande (todos os mapas, com
    /// miniatura), para testar no jogo antes do instalador.
    #[test]
    fn hot_menu_panel() {
        let (Ok(base), Ok(scene), Ok(src), Ok(out)) = (std::env::var("CP_MENU_BASE"), std::env::var("CP_MENU_SCENE"), std::env::var("CP_MENU_SRC"), std::env::var("CP_MENU_OUT")) else { return };
        let sources: Vec<std::path::PathBuf> = src.split(',').map(std::path::PathBuf::from).collect();
        let mut all = Vec::new();
        crate::bigmatch::maps_in(&sources, "Jogo", &mut all);
        all.sort_by(|a, b| b.armies.len().cmp(&a.armies.len()).then_with(|| a.name.cmp(&b.name)));
        let maps = crate::bigmatch_menu::pick_maps(&all);
        eprintln!("mapas: {} de {}", maps.len(), all.len());
        let tiles: Vec<Option<crate::startscreen::MapTiles>> = maps
            .iter()
            .map(|m| crate::bigmatch::minimap_png(&[], &sources, &m.path, 128).ok().and_then(|p| crate::startscreen::map_tiles(&p, [0x2b, 0x8c, 0xff]).ok()))
            .collect();
        let thumbs: Vec<bool> = tiles.iter().map(|t| t.is_some()).collect();
        eprintln!("miniaturas: {}", thumbs.iter().filter(|t| **t).count());
        let menu = crate::bigmatch_menu::add_menu_panel_with(&std::fs::read(scene).unwrap(), &maps, &crate::bigmatch_menu::PT, &thumbs).unwrap();
        let mut src = crate::scd::Scd::open(std::path::Path::new(&base)).unwrap();
        let entries = src.entries().unwrap();
        let mut b = crate::scd::ScdBuilder::create(std::path::Path::new(&out)).unwrap();
        for (i, e) in entries.iter().enumerate() {
            if e.is_dir {
                continue;
            }
            let k = crate::scd::normalize_key(&e.name);
            if k.contains("/frontend/cp/map") {
                continue;
            }
            let data = if k.ends_with("pc_main_menu.win.bdf") { menu.clone() } else { src.read_at(i).unwrap() };
            b.add_bytes(&e.name, &data).unwrap();
        }
        for (i, t) in tiles.iter().enumerate() {
            for (state, dds) in t.iter().flatten() {
                b.add_bytes(crate::bigmatch_menu::tile_texture(i, state).trim_start_matches('/'), dds).unwrap();
            }
        }
        b.finish().unwrap();
    }
}

#[cfg(test)]
mod hotfix {
    /// Com `CP_HOT_SCD` (a tela inicial montada), `CP_HUD_SRC` (texturas da HUD do jogo),
    /// `CP_HOT_LOBBY` (sala corrigida) e `CP_HOT_OUT`: monta a tela inicial com a HUD nova e a sala
    /// corrigida, para testar no jogo antes do instalador.
    #[test]
    fn hot_start_screen() {
        let (Ok(old), Ok(hud), Ok(out)) = (std::env::var("CP_HOT_SCD"), std::env::var("CP_HUD_SRC"), std::env::var("CP_HOT_OUT")) else { return };
        let accent = std::env::var("CP_HUD_ACCENT").unwrap_or("#2b8cff".into());
        let opts = crate::startscreen::theme_options(&accent, true);
        let themed = crate::menu_theme::themed_textures(&[std::path::PathBuf::from(hud)], &opts).unwrap();
        let mut repl: std::collections::HashMap<String, Vec<u8>> = themed.into_iter().map(|(n, d)| (crate::scd::normalize_key(&n), d)).collect();
        if let Ok(l) = std::env::var("CP_HOT_LOBBY") {
            repl.insert(crate::scd::normalize_key("ui/scenes/frontend_skirmish/pc_frontend_skirmish.win.bdf"), std::fs::read(l).unwrap());
        }
        let mut src = crate::scd::Scd::open(std::path::Path::new(&old)).unwrap();
        let entries = src.entries().unwrap();
        let mut b = crate::scd::ScdBuilder::create(std::path::Path::new(&out)).unwrap();
        let mut done = std::collections::HashSet::new();
        for (i, e) in entries.iter().enumerate() {
            if e.is_dir {
                continue;
            }
            let k = crate::scd::normalize_key(&e.name);
            let mut data = match repl.get(&k) {
                Some(d) => d.clone(),
                None => src.read_at(i).unwrap(),
            };
            // tela inicial: o painel da Partida grande (mapas tirados da sala antiga)
            if k.ends_with("pc_main_menu.win.bdf") {
                if let Ok(l) = std::env::var("CP_HOT_LOBBY_OLD") {
                    let old = crate::scene::Scene::parse(&std::fs::read(l).unwrap()).unwrap();
                    let mut maps = Vec::new();
                    for e in old.elements().unwrap() {
                        for ev in old.events(e.id).unwrap() {
                            if let Some(i) = ev.param.find("CPBMSet('map', '") {
                                let rest = &ev.param[i + 16..];
                                let path = rest[..rest.find('\'').unwrap()].to_string();
                                let label = old.children(e.id).unwrap().first().and_then(|c| old.text(*c).ok()).unwrap_or_default();
                                let (bases, name) = label.split_once(" · ").unwrap_or(("8", &label));
                                maps.push(crate::bigmatch_menu::MenuMap { path, name: name.to_string(), bases: bases.trim().parse().unwrap_or(8), size: 1024 });
                            }
                        }
                    }
                    eprintln!("mapas: {}", maps.len());
                    data = crate::bigmatch_menu::add_menu_panel(&data, &maps, &crate::bigmatch_menu::PT).unwrap();
                }
            }
            b.add_bytes(&e.name, &data).unwrap();
            done.insert(k);
        }
        let mut added = 0;
        for (k, d) in &repl {
            if !done.contains(k) {
                b.add_bytes(k.trim_start_matches('/'), d).unwrap();
                added += 1;
            }
        }
        b.finish().unwrap();
        eprintln!("trocados {} novos {added}", repl.len() - added);
    }
}
