//! "Menu moderno": tema para os menus do jogo, gerado no computador do jogador a partir das
//! texturas e fontes originais (nada do jogo é distribuído).
//!
//! * Texturas de `textures/ui/common/pc/frontend/` (menu principal, opções, escaramuça, salas,
//!   resumo): ganham nitidez e trocam o azul/laranja pelo verde-limão do launcher; fundos viram
//!   cinza-escuro neutro. Imagens com cor de facção/time, logos, medalhas e avatares só ganham nitidez.
//! * Fontes: a MagistralTT (títulos e botões) vira Roboto, a mesma do launcher. O arquivo
//!   novo leva o nome interno da original, então o jogo a encontra sem mudar nenhum Lua.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::dds::{self, Quality, Rgba};
use crate::enhance::{self, EnhanceOptions, TextureClass};
use crate::error::{Error, Result};
use crate::scd::{Scd, ScdBuilder};
use crate::ttf;

/// Versão do tema gravada no mod (a interface oferece regerar quando muda).
pub const THEME_VERSION: &str = "2.1.0";
/// Nome do `.scd` gerado: começa com `zz_cp_zz_` para montar DEPOIS das Texturas HD
/// (`zz_cp_texturas_hd.scd`), senão as texturas do menu ficam com a versão das Texturas HD.
pub const ARCHIVE_NAME: &str = "zz_cp_zz_menu_moderno.scd";
pub const FRONTEND: &str = "textures/ui/common/pc/frontend/";
/// Texturas da HUD das partidas (barra de cima, recursos, construção, fila, seleção, pesquisa,
/// placar, construtores ociosos, bate-papo, menu da partida).
pub const HUD: &[&str] = &["textures/ui/common/pc/ingame/", "textures/ui/common/pc/10_7/ingame/"];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeOptions {
    pub name: String,
    /// Troca as cores (azul/laranja → cor de destaque; fundos → cinza-escuro).
    pub recolor: bool,
    /// Troca a fonte dos títulos e botões pela Roboto (experimental).
    pub fonts: bool,
    /// Cor de destaque (#rrggbb): botões, barras, linhas e ícones.
    pub accent: String,
    /// Cor dos botões com o mouse em cima / ativos (#rrggbb). Vazio = a mesma do destaque.
    pub hover: String,
    /// Quanto os fundos escurecem (0 = como no jogo, 1 = quase preto).
    pub bg_darkness: f32,
    /// Quanto da cor de destaque tinge os fundos (0 = cinza neutro, 1 = bem colorido).
    pub bg_tint: f32,
    /// Opacidade dos painéis de fundo (0,4 = translúcidos, 1 = como no jogo).
    pub panel_opacity: f32,
    /// Brilho extra dos botões e destaques (0..1).
    pub glow: f32,
    /// Nitidez (0..1.5) e remoção de blocos DXT (0..1).
    pub sharpness: f32,
    pub deblock: f32,
    /// Também a HUD das partidas (mesma cor e estilo dos menus).
    pub hud: bool,
}

impl Default for ThemeOptions {
    fn default() -> Self {
        ThemeOptions {
            name: "Menu moderno".into(),
            recolor: true,
            fonts: false,
            accent: "#a3e635".into(),
            hover: String::new(),
            bg_darkness: 0.55,
            bg_tint: 0.12,
            panel_opacity: 1.0,
            glow: 0.3,
            sharpness: 0.5,
            deblock: 0.5,
            hud: false,
        }
    }
}

/// Cores e ajustes já interpretados.
#[derive(Debug, Clone, Copy)]
pub struct Palette {
    pub accent: [u8; 3],
    pub hover: [u8; 3],
    pub bg_darkness: f32,
    pub bg_tint: f32,
    pub panel_opacity: f32,
    pub glow: f32,
}

impl ThemeOptions {
    pub fn palette(&self) -> Palette {
        let accent = parse_hex(&self.accent).unwrap_or([163, 230, 53]);
        Palette {
            accent,
            hover: parse_hex(&self.hover).unwrap_or(accent),
            bg_darkness: self.bg_darkness.clamp(0.0, 1.0),
            bg_tint: self.bg_tint.clamp(0.0, 1.0),
            panel_opacity: self.panel_opacity.clamp(0.3, 1.0),
            glow: self.glow.clamp(0.0, 1.0),
        }
    }
}

/// Estado do botão pelo sufixo do arquivo (`_o` = mouse em cima, `_w`/`_at` = ativo/selecionado).
pub fn is_hover_state(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    let stem = k.rsplit('/').next().unwrap_or(&k).trim_end_matches(".dds");
    stem.ends_with("_o") || stem.ends_with("_w") || stem.ends_with("_at") || stem.ends_with("_over")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// Botões, barras, linhas, setas, ícones: a cor vira a de destaque.
    Accent,
    /// Painéis e degradês de fundo: cinza-escuro com um toque da cor de destaque.
    Background,
    /// Cores com significado (facções, times, medalhas, logos): só nitidez.
    Keep,
}

/// Papel de uma textura da HUD das partidas (`None` = fora da HUD).
pub fn hud_kind_of(key: &str) -> Option<Kind> {
    let k = key.to_ascii_lowercase().replace('\\', "/");
    let k = k.trim_start_matches('/');
    let rel = HUD.iter().find_map(|p| k.strip_prefix(p))?;
    if !rel.ends_with(".dds") {
        return None;
    }
    let file = rel.rsplit('/').next().unwrap_or(rel);
    // cores com significado: energia e massa, vida/escudo/veterania, terra/ar/mar, estado das
    // pesquisas, ícones de ordens, a cara e o minimapa do comunicador, bateria do notebook
    const KEEP: &[&str] = &[
        "icons/", "orders_icons/", "resource_icons/", "tooltip/bar_", "tooltip/rank_", "research/grid", "research/icons",
        "detailed_view/bar_", "slot_bgs/air", "slot_bgs/land", "slot_bgs/sea", "pip/head_overlay", "pip/minimap_overlay",
        "laptop", "icon_research", "status_score_player", "vignette", "720p_grid",
    ];
    if KEEP.iter().any(|p| rel.contains(p)) {
        return Some(Kind::Keep);
    }
    if file.contains("bg") || file.contains("overlay") || file.starts_with("bar_") || file.contains("_bg_") {
        return Some(Kind::Background);
    }
    Some(Kind::Accent)
}

/// Papel de uma textura no tema, com ou sem a HUD das partidas.
pub fn kind_with(key: &str, hud: bool) -> Option<Kind> {
    kind_of(key).or_else(|| if hud { hud_kind_of(key) } else { None })
}

/// Papel de uma textura no tema (`None` = fora do menu).
pub fn kind_of(key: &str) -> Option<Kind> {
    let k = key.to_ascii_lowercase().replace('\\', "/");
    let k = k.trim_start_matches('/');
    let rel = k.strip_prefix(FRONTEND)?;
    if !rel.ends_with(".dds") {
        return None;
    }
    let file = rel.rsplit('/').next().unwrap_or(rel);
    const KEEP: &[&str] = &[
        "teamcolors/", "campaign/cybran", "campaign/illuminate", "campaign/uef", "campaign/ops/",
        "faction_", "avatar", "sc_logo", "logo_", "medal_", "star_", "victory", "defeat", "op_completed",
        "op_failed", "op_incomplete", "line_red", "mic_", "maps/", "whitebg", "blank",
    ];
    if KEEP.iter().any(|p| rel.contains(p)) {
        return Some(Kind::Keep);
    }
    if file.contains("bg") || file.contains("overlay") || file.contains("grad") || file.starts_with("scrollwindow") {
        return Some(Kind::Background);
    }
    Some(Kind::Accent)
}

pub fn parse_hex(c: &str) -> Option<[u8; 3]> {
    let c = c.trim().trim_start_matches('#');
    if c.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(c, 16).ok()?;
    Some([(v >> 16) as u8, (v >> 8) as u8, v as u8])
}

fn rgb_to_hsv(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let h = if d <= 1e-6 {
        0.0
    } else if max == r {
        60.0 * ((g - b) / d).rem_euclid(6.0)
    } else if max == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    (h, if max <= 1e-6 { 0.0 } else { d / max }, max)
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (f32, f32, f32) {
    let c = v * s;
    let hp = (h.rem_euclid(360.0)) / 60.0;
    let x = c * (1.0 - (hp.rem_euclid(2.0) - 1.0).abs());
    let (r, g, b) = match hp as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    let m = v - c;
    (r + m, g + m, b + m)
}

/// Faixas de matiz trocadas nos elementos de destaque: azuis/cianos e laranjas/âmbar do jogo.
fn is_theme_hue(h: f32) -> bool {
    (165.0..=268.0).contains(&h) || (14.0..=56.0).contains(&h)
}

/// Aplica o tema de cores a uma imagem. `hover` usa a cor de "mouse em cima".
pub fn recolor(img: &mut Rgba, kind: Kind, pal: &Palette, hover: bool) {
    if kind == Kind::Keep {
        return;
    }
    let target = if hover { pal.hover } else { pal.accent };
    let (ah, as_, _) = rgb_to_hsv(target[0] as f32 / 255.0, target[1] as f32 / 255.0, target[2] as f32 / 255.0);
    let dark = 1.0 - 0.85 * pal.bg_darkness;
    for p in img.pixels.chunks_exact_mut(4) {
        let (h, s, v) = rgb_to_hsv(p[0] as f32 / 255.0, p[1] as f32 / 255.0, p[2] as f32 / 255.0);
        let (nh, ns, nv) = match kind {
            Kind::Accent if s >= 0.08 && is_theme_hue(h) => {
                // mantém o brilho (relevo do botão) e aproxima a saturação da cor escolhida
                let sat = (s * 0.6 + as_ * 0.4).min(1.0) * s.min(0.35) / 0.35;
                (ah, sat, (v * (1.0 + 0.35 * pal.glow)).min(1.0))
            }
            Kind::Background if s >= 0.04 => (ah, (s * 0.35 * pal.bg_tint + 0.25 * pal.bg_tint * s.min(0.4)).min(1.0), v * dark),
            Kind::Background => (h, s, v * (0.4 + 0.6 * dark)),
            _ => (h, s, v),
        };
        let (r, g, b) = hsv_to_rgb(nh, ns, nv);
        p[0] = (r * 255.0).round().clamp(0.0, 255.0) as u8;
        p[1] = (g * 255.0).round().clamp(0.0, 255.0) as u8;
        p[2] = (b * 255.0).round().clamp(0.0, 255.0) as u8;
        if kind == Kind::Background && pal.panel_opacity < 1.0 {
            p[3] = (p[3] as f32 * pal.panel_opacity).round() as u8;
        }
    }
}

fn enhance_opts(opts: &ThemeOptions) -> EnhanceOptions {
    EnhanceOptions {
        sharpness: opts.sharpness.clamp(0.0, 1.5),
        deblock: opts.deblock.clamp(0.0, 1.0),
        ..EnhanceOptions::default()
    }
}

/// Imagem do tema (mesmo tamanho): nitidez e, se pedido, cores novas.
pub fn theme_image(img: &Rgba, kind: Kind, hover: bool, format: dds::DdsFormat, opts: &ThemeOptions) -> Rgba {
    let mut out = if opts.sharpness > 0.0 || opts.deblock > 0.0 {
        enhance::enhance_image(img, TextureClass::Color, img.width, img.height, format, &enhance_opts(opts))
    } else {
        img.clone()
    };
    if opts.recolor {
        recolor(&mut out, kind, &opts.palette(), hover);
    }
    out
}

/// Versão do tema de uma textura DDS do menu (`None` se ela não muda).
pub fn theme_dds(key: &str, data: &[u8], opts: &ThemeOptions) -> Result<Option<Vec<u8>>> {
    let Some(kind) = kind_with(key, opts.hud) else { return Ok(None) };
    let (info, img) = dds::decode(data)?;
    if info.is_cubemap || info.is_volume || info.width.min(info.height) < 4 {
        return Ok(None);
    }
    let recolors = opts.recolor && kind != Kind::Keep;
    let sharpens = (opts.sharpness > 0.0 || opts.deblock > 0.0) && info.width.min(info.height) >= 8;
    if !recolors && !sharpens {
        return Ok(None);
    }
    let out = theme_image(&img, kind, is_hover_state(key), info.format, opts);
    if out.pixels == img.pixels {
        return Ok(None);
    }
    let mips = if info.mip_count <= 1 { 1 } else { 0 };
    let mut enc = dds::encode(&out, info.format, mips, Quality::Normal)?;
    keep_original_header(data, &mut enc);
    Ok(Some(enc))
}

/// Textura da HUD redesenhada no estilo da tela inicial ([`crate::hud_style`]).
fn hud_dds(key: &str, data: &[u8], kind: Kind, siblings: &HashSet<String>, opts: &ThemeOptions) -> Result<Option<Vec<u8>>> {
    let (info, img) = dds::decode(data)?;
    if info.is_cubemap || info.is_volume || info.width.min(info.height) < 4 {
        return Ok(None);
    }
    let pal = opts.palette();
    let accent = if is_hover_state(key) { pal.hover } else { pal.accent };
    let out = crate::hud_style::restyle(&img, key, siblings, accent, kind == Kind::Background);
    let mips = if info.mip_count <= 1 { 1 } else { 0 };
    let mut enc = dds::encode(&out, info.format, mips, Quality::Normal)?;
    keep_original_header(data, &mut enc);
    Ok(Some(enc))
}

/// Mesmo formato, tamanho e nº de mips: o arquivo novo leva o cabeçalho original byte a byte
/// (o jogo grava `pitchOrLinearSize` e as flags de um jeito próprio; nada muda além dos pixels).
fn keep_original_header(original: &[u8], new: &mut [u8]) {
    const HEAD: usize = 128;
    let dx10 = |d: &[u8]| d.len() > 88 && &d[84..88] == b"DX10";
    if original.len() == new.len() && new.len() > HEAD && &original[..4] == b"DDS " && !dx10(original) && !dx10(new) {
        new[..HEAD].copy_from_slice(&original[..HEAD]);
    }
}

/// Qual Roboto substitui uma fonte do jogo (`None` = a fonte fica).
pub fn font_replacement(original: &[u8]) -> Option<&'static str> {
    let f = ttf::Font::parse(original).ok()?;
    let family = f.family().to_ascii_lowercase();
    if !family.contains("magistral") {
        return None;
    }
    let bold = family.contains("black") || f.weight() >= 600 || f.subfamily().to_ascii_lowercase().contains("bold");
    Some(if bold { "Roboto-Bold.ttf" } else { "Roboto-Medium.ttf" })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeResult {
    pub archive: PathBuf,
    pub textures: usize,
    pub recolored: usize,
    pub fonts: usize,
    pub failed: Vec<String>,
}

struct Entry {
    src: PathBuf,
    index: usize,
    name: String,
    key: String,
}

/// Entradas do menu e das fontes nos arquivos do jogo (o último montado vence).
fn entries(sources: &[PathBuf], fonts: bool, hud: bool) -> Result<Vec<Entry>> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for src in sources.iter().rev() {
        let mut scd = Scd::open(src)?;
        for (index, e) in scd.entries()?.into_iter().enumerate() {
            if e.is_dir || !seen.insert(e.key.clone()) {
                continue;
            }
            let font = fonts && e.key.starts_with("/fonts/") && e.key.ends_with(".ttf");
            if font || kind_with(&e.key, hud).is_some() {
                out.push(Entry { src: src.clone(), index, name: e.name, key: e.key });
            }
        }
    }
    out.sort_by(|a, b| a.src.cmp(&b.src).then(a.index.cmp(&b.index)));
    Ok(out)
}

/// Gera o `.scd` do tema. `fonts_dir` tem as Roboto que acompanham o launcher.
pub fn build(
    sources: &[PathBuf],
    fonts_dir: &Path,
    opts: &ThemeOptions,
    dest: &Path,
    progress: &mut dyn FnMut(usize, usize, &str),
) -> Result<ThemeResult> {
    let todo = entries(sources, opts.fonts, opts.hud)?;
    if todo.iter().all(|e| !e.key.ends_with(".dds")) {
        return Err(Error::Other("as texturas do menu não foram encontradas nos arquivos do jogo".into()));
    }
    let total = todo.len();
    let mut b = ScdBuilder::create(dest)?;
    let mut res = ThemeResult { archive: PathBuf::new(), textures: 0, recolored: 0, fonts: 0, failed: vec![] };
    let mut open: Option<(PathBuf, Scd)> = None;
    let mut done = 0;
    for batch in todo.chunks(32) {
        let mut raw = Vec::with_capacity(batch.len());
        for e in batch {
            if open.as_ref().map(|(p, _)| p != &e.src).unwrap_or(true) {
                open = Some((e.src.clone(), Scd::open(&e.src)?));
            }
            raw.push((e, open.as_mut().expect("aberto").1.read_at(e.index)?));
        }
        let processed: Vec<_> = raw
            .par_iter()
            .map(|(e, data)| {
                let r = if e.key.ends_with(".ttf") {
                    match font_replacement(data) {
                        Some(file) => std::fs::read(fonts_dir.join(file))
                            .map_err(|err| Error::Other(format!("fonte {file} não encontrada: {err}")))
                            .and_then(|new| ttf::adopt_identity(&new, data))
                            .map(Some),
                        None => Ok(None),
                    }
                } else {
                    theme_dds(&e.key, data, opts)
                };
                (*e, r)
            })
            .collect();
        for (e, r) in processed {
            done += 1;
            progress(done, total, &e.name);
            match r {
                Ok(Some(bytes)) => {
                    b.add_bytes(&e.name, &bytes)?;
                    if e.key.ends_with(".ttf") {
                        res.fonts += 1;
                    } else {
                        res.textures += 1;
                        if opts.recolor && kind_of(&e.key) != Some(Kind::Keep) {
                            res.recolored += 1;
                        }
                    }
                }
                Ok(None) => {}
                Err(err) => res.failed.push(format!("{}: {err}", e.name)),
            }
        }
    }
    if res.textures + res.fonts == 0 {
        return Err(Error::Other("nada mudou com essas opções".into()));
    }
    res.archive = b.finish()?;
    Ok(res)
}

/// As texturas dos menus com o tema (sem as fontes), para quem monta junto com outras coisas (a
/// tela inicial nova): (nome dentro do jogo, DDS).
pub fn themed_textures(sources: &[PathBuf], opts: &ThemeOptions) -> Result<Vec<(String, Vec<u8>)>> {
    let todo: Vec<Entry> = entries(sources, false, opts.hud)?.into_iter().filter(|e| e.key.ends_with(".dds")).collect();
    // painéis em 9 partes: a HUD olha os irmãos (`_tl`, `_t`...) de cada pedaço
    let siblings: HashSet<String> = todo.iter().map(|e| crate::hud_style::sibling_key(&e.key)).collect();
    let mut out = Vec::new();
    let mut open: Option<(PathBuf, Scd)> = None;
    for batch in todo.chunks(48) {
        let mut raw = Vec::with_capacity(batch.len());
        for e in batch {
            if open.as_ref().map(|(p, _)| p != &e.src).unwrap_or(true) {
                open = Some((e.src.clone(), Scd::open(&e.src)?));
            }
            raw.push((e, open.as_mut().expect("aberto").1.read_at(e.index)?));
        }
        let done: Vec<_> = raw
            .par_iter()
            .filter_map(|(e, data)| {
                let hud = if opts.hud { hud_kind_of(&e.key).filter(|k| *k != Kind::Keep) } else { None };
                match hud {
                    Some(kind) => hud_dds(&e.key, data, kind, &siblings, opts).ok().flatten(),
                    None => theme_dds(&e.key, data, opts).ok().flatten(),
                }
                .map(|b| (e.name.clone(), b))
            })
            .collect();
        out.extend(done);
    }
    Ok(out)
}

/// Texturas usadas na prévia do menu principal na interface.
pub const PREVIEW_KEYS: &[&str] = &[
    "blue_overlay.dds",
    "top_blue_grad.dds",
    "line03.dds",
    "mainmenu/btn_u.dds",
    "mainmenu/btn_o.dds",
    "mainmenu/gamertag_bg.dds",
    "mainmenu/sc_logo.dds",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn px(r: u8, g: u8, b: u8) -> Rgba {
        Rgba { width: 1, height: 1, pixels: vec![r, g, b, 255] }
    }

    #[test]
    fn sorts_menu_textures_by_role() {
        let k = |p: &str| kind_of(&format!("/textures/ui/common/pc/frontend/{p}"));
        assert_eq!(k("mainmenu/btn_o.dds"), Some(Kind::Accent));
        assert_eq!(k("options/bg_tl.dds"), Some(Kind::Background));
        assert_eq!(k("blue_overlay02.dds"), Some(Kind::Background));
        assert_eq!(k("skirmish/teamcolors/tc05.dds"), Some(Kind::Keep));
        assert_eq!(k("campaign/cybran_u.dds"), Some(Kind::Keep));
        assert_eq!(k("mainmenu/sc_logo.dds"), Some(Kind::Keep));
        assert_eq!(kind_of("/textures/ui/common/game/bg.dds"), None);
        assert_eq!(kind_of("/units/uef/a.dds"), None);
    }

    #[test]
    fn blue_and_orange_become_accent_but_greys_and_reds_stay() {
        let pal = ThemeOptions::default().palette();
        let hue = |img: &Rgba| rgb_to_hsv(img.pixels[0] as f32 / 255.0, img.pixels[1] as f32 / 255.0, img.pixels[2] as f32 / 255.0);
        for (r, g, b) in [(60, 120, 220), (230, 140, 30)] {
            let mut i = px(r, g, b);
            recolor(&mut i, Kind::Accent, &pal, false);
            let (h, s, _) = hue(&i);
            assert!((h - 82.0).abs() < 4.0 && s > 0.4, "{r},{g},{b} → {:?}", i.pixels);
        }
        for (r, g, b) in [(128, 128, 128), (200, 40, 40)] {
            let mut i = px(r, g, b);
            recolor(&mut i, Kind::Accent, &pal, false);
            assert_eq!(i.pixels, vec![r, g, b, 255]);
        }
        // fundo azul vira cinza-escuro quase neutro
        let mut bg = px(70, 140, 240);
        recolor(&mut bg, Kind::Background, &pal, false);
        let (_, s, v) = hue(&bg);
        assert!(s < 0.25 && v < 0.65, "{:?}", bg.pixels);
        // facções ficam como estão
        let mut keep = px(70, 140, 240);
        recolor(&mut keep, Kind::Keep, &pal, false);
        assert_eq!(keep.pixels, vec![70, 140, 240, 255]);
    }

    #[test]
    fn hover_buttons_use_hover_color_and_panels_fade() {
        assert!(is_hover_state("/textures/ui/common/pc/frontend/mainmenu/btn_o.dds"));
        assert!(is_hover_state("/x/btn_at.dds") && !is_hover_state("/x/btn_u.dds"));
        let opts = ThemeOptions { accent: "#a3e635".into(), hover: "#38bdf8".into(), panel_opacity: 0.5, ..Default::default() };
        let pal = opts.palette();
        let hue = |img: &Rgba| rgb_to_hsv(img.pixels[0] as f32 / 255.0, img.pixels[1] as f32 / 255.0, img.pixels[2] as f32 / 255.0).0;
        let mut a = px(230, 140, 30);
        recolor(&mut a, Kind::Accent, &pal, true);
        assert!((hue(&a) - 199.0).abs() < 6.0, "{:?}", a.pixels);
        let mut b = px(60, 120, 220);
        recolor(&mut b, Kind::Background, &pal, false);
        assert_eq!(b.pixels[3], 128);
        // mais escuro com bg_darkness maior
        let dark = ThemeOptions { bg_darkness: 1.0, ..Default::default() }.palette();
        let light = ThemeOptions { bg_darkness: 0.0, ..Default::default() }.palette();
        let (mut d, mut l) = (px(90, 90, 90), px(90, 90, 90));
        recolor(&mut d, Kind::Background, &dark, false);
        recolor(&mut l, Kind::Background, &light, false);
        assert!(d.pixels[0] < l.pixels[0]);
    }

    #[test]
    fn hud_textures_join_only_when_asked() {
        let top = "/textures/ui/common/pc/ingame/hud/top_btn_u.dds";
        assert_eq!(kind_with(top, false), None);
        assert_eq!(kind_with(top, true), Some(Kind::Accent));
        assert_eq!(hud_kind_of("/textures/ui/common/pc/ingame/hud/top_bg.dds"), Some(Kind::Background));
        assert_eq!(hud_kind_of("/textures/ui/common/pc/10_7/ingame/build_queue/buildqueue_bg_u.dds"), Some(Kind::Background));
        assert_eq!(hud_kind_of("/textures/ui/common/pc/ingame/research/btn_o.dds"), Some(Kind::Accent));
        // cores com significado ficam
        assert_eq!(hud_kind_of("/textures/ui/common/pc/ingame/hud/icons/energy.dds"), Some(Kind::Keep));
        assert_eq!(hud_kind_of("/textures/ui/common/pc/10_7/ingame/tooltip/bar_health.dds"), Some(Kind::Keep));
        assert_eq!(hud_kind_of("/textures/ui/common/pc/ingame/research/grid/locked_u.dds"), Some(Kind::Keep));
        assert_eq!(hud_kind_of("/textures/ui/common/pc/frontend/line.dds"), None);
        // os menus continuam como antes
        assert_eq!(kind_with("/textures/ui/common/pc/frontend/line.dds", true), kind_of("/textures/ui/common/pc/frontend/line.dds"));
    }

    #[test]
    fn hsv_roundtrip() {
        for (r, g, b) in [(0.1, 0.5, 0.9), (0.9, 0.2, 0.3), (0.5, 0.5, 0.5), (0.64, 0.9, 0.21)] {
            let (h, s, v) = rgb_to_hsv(r, g, b);
            let (r2, g2, b2) = hsv_to_rgb(h, s, v);
            assert!((r - r2).abs() < 1e-4 && (g - g2).abs() < 1e-4 && (b - b2).abs() < 1e-4);
        }
        assert_eq!(parse_hex("#a3e635"), Some([163, 230, 53]));
        assert_eq!(parse_hex("xyz"), None);
    }

    #[test]
    fn themed_dds_keeps_original_header() {
        let blue = Rgba { width: 16, height: 16, pixels: [40u8, 110, 220, 255].repeat(256) };
        let mut orig = dds::encode(&blue, dds::DdsFormat::Bgra8, 1, Quality::Fast).unwrap();
        // cabeçalho como o do jogo: LINEARSIZE, pitch = tamanho total, mips = 0
        orig[8..12].copy_from_slice(&0x81007u32.to_le_bytes());
        orig[20..24].copy_from_slice(&1024u32.to_le_bytes());
        orig[28..32].copy_from_slice(&0u32.to_le_bytes());
        let opts = ThemeOptions::default();
        let out = theme_dds("textures/ui/common/pc/frontend/mainmenu/btn_u.dds", &orig, &opts).unwrap().unwrap();
        assert_eq!(out.len(), orig.len());
        assert_eq!(&out[..128], &orig[..128]);
        assert_ne!(&out[128..], &orig[128..]);
    }

    #[test]
    fn builds_theme_mod_with_textures_and_fonts() {
        let tmp = tempfile::tempdir().unwrap();
        let blue = Rgba { width: 16, height: 16, pixels: [60u8, 120, 220, 255].repeat(256) };
        let dxt = dds::encode(&blue, dds::DdsFormat::Dxt1, 0, Quality::Fast).unwrap();
        let magistral = crate::ttf::tests::tiny_font("MagistralTT", "Bold", 700, true);
        let arial = crate::ttf::tests::tiny_font("Arial", "Regular", 400, false);
        let src = tmp.path().join("textures.scd");
        let mut w = ScdBuilder::create(&src).unwrap();
        w.add_bytes("textures\\ui\\common\\pc\\frontend\\mainmenu\\btn_u.dds", &dxt).unwrap();
        w.add_bytes("textures\\ui\\common\\pc\\frontend\\skirmish\\teamcolors\\tc01.dds", &dxt).unwrap();
        w.add_bytes("textures\\ui\\common\\game\\hud.dds", &dxt).unwrap();
        w.add_bytes("fonts\\MGS65__U.TTF", &magistral).unwrap();
        w.add_bytes("fonts\\ARIAL.TTF", &arial).unwrap();
        w.finish().unwrap();
        let fonts = tmp.path().join("fonts");
        std::fs::create_dir_all(&fonts).unwrap();
        let roboto = crate::ttf::tests::tiny_font("Roboto", "Bold", 700, true);
        std::fs::write(fonts.join("Roboto-Bold.ttf"), &roboto).unwrap();
        std::fs::write(fonts.join("Roboto-Medium.ttf"), &roboto).unwrap();

        let dest = tmp.path().join("out/zz_menu.scd");
        let r = build(&[src], &fonts, &ThemeOptions { fonts: true, ..Default::default() }, &dest, &mut |_, _, _| {}).unwrap();
        // a cor de time é lisa: nitidez não muda nada, então não entra no mod
        assert_eq!((r.textures, r.recolored, r.fonts), (1, 1, 1), "{:?}", r.failed);
        let mut out = Scd::open(&r.archive).unwrap();
        let names: Vec<String> = out.entries().unwrap().into_iter().map(|e| e.key).collect();
        assert!(names.contains(&"/fonts/mgs65__u.ttf".to_string()), "{names:?}");
        assert!(!names.iter().any(|n| n.contains("arial") || n.contains("/game/")));
        let font = ttf::Font::parse(&out.read("fonts\\MGS65__U.TTF").unwrap()).unwrap();
        assert_eq!(font.family(), "MagistralTT");
        let (_, img) = dds::decode(&out.read("textures\\ui\\common\\pc\\frontend\\mainmenu\\btn_u.dds").unwrap()).unwrap();
        let (h, _, _) = rgb_to_hsv(img.pixels[0] as f32 / 255.0, img.pixels[1] as f32 / 255.0, img.pixels[2] as f32 / 255.0);
        assert!((h - 82.0).abs() < 12.0, "botão ficou verde-limão: {:?}", &img.pixels[..4]);
    }

    /// CP_THEME_SAMPLES=pasta com .dds do menu (nome com "__" no lugar de "/"), CP_THEME_OUT=saída:
    /// grava antes/depois em PNG para conferir o tema com texturas de verdade.
    #[test]
    fn real_samples_if_available() {
        let (Ok(dir), Ok(out)) = (std::env::var("CP_THEME_SAMPLES"), std::env::var("CP_THEME_OUT")) else { return };
        std::fs::create_dir_all(&out).unwrap();
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            let name = p.file_name().unwrap().to_string_lossy().replace("__", "/");
            let key = format!("/{FRONTEND}{name}");
            let data = std::fs::read(&p).unwrap();
            let (info, before) = dds::decode(&data).unwrap();
            let kind = kind_of(&key).unwrap();
            let after = theme_image(&before, kind, is_hover_state(&key), info.format, &ThemeOptions::default());
            let stem = p.file_stem().unwrap().to_string_lossy().to_string();
            std::fs::write(format!("{out}/{stem}.a.png"), dds::to_png(&before).unwrap()).unwrap();
            std::fs::write(format!("{out}/{stem}.b.png"), dds::to_png(&after).unwrap()).unwrap();
        }
    }
}
