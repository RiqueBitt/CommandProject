//! "Tela inicial nova": a tela inicial do jogo no estilo "Comandante" (logo em cima, botões grandes
//! com ícone e borda neon, submenus ao lado, caixa do jogador, notícias), na cor que o jogador
//! escolher, com o logo e o vídeo de fundo dele se quiser. Os botões dos mods da Forja entram no
//! mesmo visual.
//!
//! Montado no computador do jogador como o mod `cp-tela-inicial`:
//! * a cena da tela inicial ([`crate::mainmenu`]);
//! * as texturas desenhadas para o launcher (`menu_style/*.png`, por `tools/make_menu_style.py`)
//!   pintadas na cor escolhida, e a imagem das notícias (uma tela de carregamento do próprio jogo
//!   tingida);
//! * o logo e o vídeo de fundo do jogador, quando escolhidos (o vídeo vira `.usm`: [`crate::usm`]).
//!   Eles ficam só no computador dele.

use crate::dds::{self, DdsFormat, Quality, Rgba};
use crate::error::{Error, Result};
use crate::mainmenu::{self, Commander, Look, MenuEdit};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const MOD_ID: &str = "cp-tela-inicial";
/// Depois das Texturas HD (`zz_cp_texturas_hd.scd`), que trazem as texturas da interface em HD: as
/// pintadas aqui (menus e HUD das partidas) valem por cima delas. Antes da Forja e do Climas.
pub const ARCHIVE: &str = "zz_cp_zzy_tela_inicial.scd";
/// O nome de antes (até a 0.50): as Texturas HD ficavam por cima da HUD nova.
pub const OLD_ARCHIVE: &str = "zz_cp_tela_inicial.scd";
/// Muda quando o visual muda (o launcher remonta).
pub const STYLE_VERSION: &str = "1.8.0";
pub const SETTINGS_FILE: &str = "start-screen.json";
/// Pasta (nos dados do launcher) com o logo e o vídeo do jogador.
pub const USER_DIR: &str = "start-screen";
/// O vídeo da tela inicial do jogo.
pub const MOVIE: &str = "movies/FMV_FRONTEND.win.usm";
pub const DEFAULT_ACCENT: &str = "#2b8cff";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled: bool,
    /// Cor de destaque (#rrggbb).
    pub accent: String,
    pub news_title: String,
    pub news_text: String,
    /// Usar o logo do jogador (`start-screen/logo.png`).
    pub custom_logo: bool,
    /// Usar o vídeo do jogador (`start-screen/FMV_FRONTEND.win.usm`).
    pub custom_video: bool,
    /// Nome do vídeo escolhido (para a tela).
    pub video_name: String,
    /// Partidas grandes prontas no submenu da Escaramuça do jogo.
    pub shortcuts: Vec<Shortcut>,
    /// HUD das partidas no mesmo estilo e cor da tela inicial.
    pub hud: bool,
}

/// Uma partida grande salva como botão no jogo (Escaramuça): o cenário e as vagas/opções no formato
/// de `/cpmatch` ([`crate::bigmatch::encode`]).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shortcut {
    pub label: String,
    pub map: String,
    pub spec: String,
}

/// Atalhos no jogo, no máximo.
pub const MAX_SHORTCUTS: usize = 5;

impl Shortcut {
    /// O código do botão: monta a partida com o código da Partida grande e começa.
    pub fn lua(&self) -> Result<String> {
        let ok = |t: &str| !t.is_empty() && t.len() < 4000 && t.chars().all(|c| c.is_ascii_graphic() && !matches!(c, '\'' | '"' | '\\'));
        if !ok(&self.map) || !self.map.starts_with("/maps/") || !ok(&self.spec) {
            return Err(Error::Other(format!("atalho \"{}\" inválido", self.label)));
        }
        Ok(format!(
            "local m = import('/lua/SinglePlayerLaunch.lua') if m.CPBigMatchSession then LaunchSinglePlayerSession(m.CPBigMatchSession('{}', '{}')) end",
            self.map, self.spec
        ))
    }
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            enabled: false,
            accent: DEFAULT_ACCENT.into(),
            news_title: "Bem-vindo ao CommandProject".into(),
            news_text: "Mods, partidas grandes e mais pelo launcher.".into(),
            custom_logo: false,
            custom_video: false,
            video_name: String::new(),
            shortcuts: Vec::new(),
            hud: true,
        }
    }
}

impl Settings {
    pub fn load(data_dir: &Path) -> Settings {
        std::fs::read(data_dir.join(SETTINGS_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }
    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let json = serde_json::to_vec_pretty(self).map_err(|e| Error::Other(e.to_string()))?;
        crate::fsutil::write_atomic(&data_dir.join(SETTINGS_FILE), &json)
    }
    pub fn logo_path(data_dir: &Path) -> PathBuf {
        data_dir.join(USER_DIR).join("logo.png")
    }
    pub fn video_path(data_dir: &Path) -> PathBuf {
        data_dir.join(USER_DIR).join("FMV_FRONTEND.win.usm")
    }
}

// ------------------------------------------------------------------ cores

fn rgb_to_hsv(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let h = if d <= f32::EPSILON {
        0.0
    } else if max == r {
        60.0 * (((g - b) / d).rem_euclid(6.0))
    } else if max == g {
        60.0 * ((b - r) / d + 2.0)
    } else {
        60.0 * ((r - g) / d + 4.0)
    };
    (h, if max <= 0.0 { 0.0 } else { d / max }, max)
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (f32, f32, f32) {
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0).rem_euclid(2.0) - 1.0).abs());
    let m = v - c;
    let (r, g, b) = match (h.rem_euclid(360.0) / 60.0) as u32 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    (r + m, g + m, b + m)
}

/// As texturas são desenhadas em vermelho; aqui o vermelho vira a cor escolhida (o resto, cinza e
/// preto, fica igual). Brilho e saturação seguem a cor: um azul claro fica claro, um branco fica cinza.
pub fn recolor(img: &mut Rgba, accent: [u8; 3]) {
    let (th, ts, tv) = rgb_to_hsv(accent[0] as f32 / 255.0, accent[1] as f32 / 255.0, accent[2] as f32 / 255.0);
    // a cor de referência dos desenhos (226, 30, 36)
    let (_, rs, rv) = rgb_to_hsv(226.0 / 255.0, 30.0 / 255.0, 36.0 / 255.0);
    for px in img.pixels.chunks_exact_mut(4) {
        let (r, g, b) = (px[0] as f32 / 255.0, px[1] as f32 / 255.0, px[2] as f32 / 255.0);
        let (h, s, v) = rgb_to_hsv(r, g, b);
        let dist = h.min(360.0 - h);
        if s < 0.12 || dist > 40.0 {
            continue;
        }
        // quanto deste pixel é "vermelho do desenho"
        let w = ((s - 0.12) / 0.25).clamp(0.0, 1.0) * (1.0 - (dist / 40.0).powi(2));
        let ns = (s * ts / rs).clamp(0.0, 1.0);
        let nv = (v * tv / rv).clamp(0.0, 1.0);
        let (nr, ng, nb) = hsv_to_rgb(th, ns, nv);
        let mix = |a: f32, b: f32| ((a + (b - a) * w) * 255.0).round().clamp(0.0, 255.0) as u8;
        px[0] = mix(r, nr);
        px[1] = mix(g, ng);
        px[2] = mix(b, nb);
    }
}

macro_rules! art {
    ($($n:literal),* $(,)?) => { &[$(($n, include_bytes!(concat!("menu_style/", $n, ".png")) as &[u8])),*] };
}

/// Os desenhos do launcher (nome → PNG).
const ART: &[(&str, &[u8])] = art![
    "btn_u", "btn_o", "btn_at", "btn_w", "sub_u", "sub_o", "sub_at", "sub_w", "icon_campaign", "icon_skirmish", "icon_multiplayer",
    "icon_options", "icon_extras", "icon_quit", "icon_mod", "shade", "tint", "panel", "gamertag", "avatar_frame", "topbar", "opt_u",
    "opt_o", "opt_at", "opt_w", "p9_tl", "p9_t", "p9_tr", "p9_l", "p9_c", "p9_r", "p9_bl", "p9_b", "p9_br", "p3_l", "p3_c", "p3_r", "line", "f8_tl", "f8_t", "f8_tr", "f8_l", "f8_r", "f8_bl", "f8_b", "f8_br", "big_u", "big_o", "big_at", "big_w",
];

fn to_dds(img: &Rgba) -> Result<Vec<u8>> {
    dds::encode(img, DdsFormat::Bgra8, 1, Quality::Normal)
}

/// As texturas da tela na cor escolhida: (caminho dentro do jogo, DDS).
pub fn textures(accent: [u8; 3]) -> Result<Vec<(String, Vec<u8>)>> {
    let mut out = Vec::new();
    for (name, png) in ART {
        let mut img = dds::from_png(png)?;
        recolor(&mut img, accent);
        out.push((format!("{}{name}.dds", mainmenu::TEX.trim_start_matches('/')), to_dds(&img)?));
    }
    Ok(out)
}

/// Imagem das notícias: uma tela de carregamento do jogo, recortada e tingida na cor de destaque.
pub fn news_image(stock: &[PathBuf], accent: [u8; 3]) -> Option<Vec<u8>> {
    // arte do menu antigo do jogo (a nave), sem logo
    let raw = ["/textures/ui/common/menus/background-colossus.dds", "/textures/ui/common/menus/background-colossus02.dds"]
        .iter()
        .find_map(|p| crate::mapassets::read_game_file(stock, p).ok())?;
    let (_, img) = dds::decode(&raw).ok()?;
    let src = image::RgbaImage::from_raw(img.width, img.height, img.pixels)?;
    // recorte central na proporção do quadro (361 × 124)
    // recorte na proporção do quadro (361 × 124), pegando a nave (meio para a direita, um pouco acima)
    let cw = (src.width() as f32 * 0.8) as u32;
    let ch = ((cw as f32 * 124.0 / 361.0) as u32).min(src.height());
    let x0 = src.width() - cw - src.width() / 40;
    let y0 = (src.height().saturating_sub(ch) as f32 * 0.32) as u32;
    let crop = image::imageops::crop_imm(&src, x0, y0, cw, ch).to_image();
    let small = image::imageops::resize(&crop, 722, 248, image::imageops::FilterType::Triangle);
    let mut px = small.into_raw();
    for p in px.chunks_exact_mut(4) {
        let l = (0.3 * p[0] as f32 + 0.59 * p[1] as f32 + 0.11 * p[2] as f32) / 255.0;
        let l = l.powf(0.9);
        for (i, c) in accent.iter().enumerate() {
            p[i] = ((*c as f32 * l * 1.25 + 255.0 * (l * l * 0.25)).min(255.0)) as u8;
        }
        p[3] = 255;
    }
    to_dds(&Rgba { width: 722, height: 248, pixels: px }).ok()
}

/// Logo do jogador: tira o fundo preto (o brilho vira transparência), corta as bordas vazias e
/// limita o tamanho.
pub fn prepare_logo(data: &[u8]) -> Result<Rgba> {
    let img = image::load_from_memory(data).map_err(|e| Error::Format(format!("imagem do logo inválida: {e}")))?.to_rgba8();
    let (w, h) = img.dimensions();
    let mut px = img.into_raw();
    let opaque_bg = px.chunks_exact(4).all(|p| p[3] == 255);
    if opaque_bg {
        for p in px.chunks_exact_mut(4) {
            let a = p[0].max(p[1]).max(p[2]) as f32 / 255.0;
            let a = ((a - 0.04) / 0.96).clamp(0.0, 1.0);
            if a <= 0.0 {
                p.copy_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            for c in p.iter_mut().take(3) {
                *c = ((*c as f32 / 255.0 / a).min(1.0) * 255.0) as u8;
            }
            p[3] = (a * 255.0) as u8;
        }
    }
    // bordas vazias
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0, 0);
    for y in 0..h {
        for x in 0..w {
            if px[((y * w + x) * 4 + 3) as usize] > 8 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
            }
        }
    }
    if x1 < x0 || y1 < y0 {
        return Err(Error::Format("o logo está vazio (só fundo)".into()));
    }
    let pad = 6;
    let (x0, y0) = (x0.saturating_sub(pad), y0.saturating_sub(pad));
    let (x1, y1) = ((x1 + pad).min(w - 1), (y1 + pad).min(h - 1));
    let full = image::RgbaImage::from_raw(w, h, px).expect("tamanho");
    let mut cut = image::imageops::crop_imm(&full, x0, y0, x1 - x0 + 1, y1 - y0 + 1).to_image();
    if cut.width() > 1400 {
        let nh = (cut.height() as f32 * 1400.0 / cut.width() as f32).round().max(1.0) as u32;
        cut = image::imageops::resize(&cut, 1400, nh, image::imageops::FilterType::Lanczos3);
    }
    let (w, h) = cut.dimensions();
    Ok(Rgba { width: w, height: h, pixels: cut.into_raw() })
}

/// Monta o `.scd` da tela inicial em `dest`. `scene` é a cena de origem (a do jogo ou a de outro
/// mod), `edit` o que os mods da Forja pedem. Devolve os avisos da montagem.
pub fn build(scene: &[u8], edit: &MenuEdit, settings: &Settings, stock: &[PathBuf], data_dir: &Path, dest: &Path) -> Result<(PathBuf, Vec<String>)> {
    build_all(scene, &[], edit, settings, stock, data_dir, dest, &GameExtras::default())
}

/// Logo padrão da tela inicial nova (o do CommandProject, já sem o fundo preto).
const DEFAULT_LOGO: &[u8] = include_bytes!("menu_style/logo_default.png");

/// A sala de escaramuça do jogo ("Criar jogo"), onde entra o painel da Partida grande.
/// A tela de resultado das partidas, onde entra o "Jogar de novo".
const SUMMARY_SCENE: &str = "/ui/scenes/frontend_summary_mp/pc_frontend_summary_mp.win.bdf";

/// O painel da Partida grande na sala de escaramuça: os mapas da lista e os textos.
pub type Panel<'a> = (&'a [crate::bigmatch_menu::MenuMap], &'a crate::bigmatch_menu::Texts);

/// O que mais do launcher entra no jogo: a Partida grande na sala de batalha e o painel do
/// launcher no submenu Extras.
#[derive(Default)]
pub struct GameExtras<'a> {
    pub lobby: Option<Panel<'a>>,
    /// a imagem de cima (PNG) de cada mapa do painel da Partida grande, na mesma ordem
    pub lobby_thumbs: Vec<Option<Vec<u8>>>,
    pub launcher: Option<&'a crate::gamepanel::LauncherPanel>,
    pub pt: bool,
    /// mods ligados com texturas da interface (as Texturas HD), na ordem em que o jogo monta: o
    /// tema pinta as versões deles (a HUD nova sai das texturas em HD)
    pub theme_sources: Vec<PathBuf>,
}

/// Opções do tema dos outros menus (as texturas do jogo pintadas na cor da tela inicial).
pub fn theme_options(accent: &str, hud: bool) -> crate::menu_theme::ThemeOptions {
    crate::menu_theme::ThemeOptions {
        name: "Tela inicial nova".into(),
        recolor: true,
        fonts: false,
        accent: accent.into(),
        hover: String::new(),
        bg_darkness: 0.8,
        bg_tint: 0.12,
        panel_opacity: 0.92,
        glow: 0.5,
        sharpness: 0.5,
        deblock: 0.5,
        hud,
    }
}

#[allow(clippy::too_many_arguments)]
/// Como [`build`], com os outros menus do jogo (caminho, cena de origem) no mesmo visual e as
/// texturas deles pintadas na cor escolhida.
pub fn build_all(
    scene: &[u8],
    others: &[(String, Vec<u8>)],
    edit: &MenuEdit,
    settings: &Settings,
    stock: &[PathBuf],
    data_dir: &Path,
    dest: &Path,
    extras: &GameExtras,
) -> Result<(PathBuf, Vec<String>)> {
    let panel = extras.lobby;
    let accent = crate::menu_theme::parse_hex(&settings.accent).unwrap_or([43, 140, 255]);
    let look = Look::Commander(Commander { news_title: settings.news_title.clone(), news_text: settings.news_text.clone(), panel: extras.launcher.is_some() });
    let logo = if settings.custom_logo {
        let p = Settings::logo_path(data_dir);
        let data = std::fs::read(&p).map_err(|e| Error::io(&p, e))?;
        prepare_logo(&data)?
    } else {
        dds::from_png(DEFAULT_LOGO)?
    };
    let logo = Some(logo);
    let mut built = mainmenu::build_with(scene, edit, &look)?;
    if let Some(l) = &logo {
        built.scene = mainmenu::set_logo(&built.scene, &format!("{}logo_custom.dds", mainmenu::TEX), l.width, l.height)?;
    }

    if let Some(lp) = extras.launcher {
        built.scene = crate::gamepanel::add_launcher_panel(&built.scene, lp, extras.pt)?;
    }
    // miniaturas dos mapas do painel (o botão de cada mapa é a imagem dele)
    let tiles: Vec<Option<MapTiles>> = {
        use rayon::prelude::*;
        extras
            .lobby_thumbs
            .par_iter()
            .take(crate::bigmatch_menu::MENU_MAPS)
            .map(|png| png.as_ref().and_then(|p| map_tiles(p, accent).ok()))
            .collect()
    };
    let thumbs: Vec<bool> = tiles.iter().map(|t| t.is_some()).collect();
    // a Partida grande: painel ao lado do submenu Batalha da tela inicial
    if let Some((maps, texts)) = panel {
        built.scene = crate::bigmatch_menu::add_menu_panel_with(&built.scene, maps, texts, &thumbs)?;
    }
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    b.add_bytes(mainmenu::SCENE_PATH.trim_start_matches('/'), &built.scene)?;
    let mut files = textures(accent)?;
    if let Some(news) = news_image(stock, accent) {
        files.push((format!("{}news.dds", mainmenu::TEX.trim_start_matches('/')), news));
    }
    if let Some(l) = &logo {
        files.push((format!("{}logo_custom.dds", mainmenu::TEX.trim_start_matches('/')), to_dds(l)?));
    }
    for (path, data) in &files {
        b.add_bytes(path, data)?;
    }
    for (i, made) in tiles.iter().enumerate() {
        for (state, dds) in made.iter().flatten() {
            b.add_bytes(crate::bigmatch_menu::tile_texture(i, state).trim_start_matches('/'), dds)?;
        }
    }
    // os outros menus: cenas no visual novo e as texturas do jogo na cor escolhida
    for (path, data) in others {
        if path == mainmenu::SPLASH_LUA {
            // abre direto na tela inicial, sem os vídeos de abertura
            if let Some(text) = std::str::from_utf8(data).ok().and_then(mainmenu::patch_splash_lua) {
                b.add_bytes(path.trim_start_matches('/'), &text.chars().map(|c| c as u32 as u8).collect::<Vec<u8>>())?;
            }
            continue;
        }
        if path == mainmenu::OPTIONS_LUA {
            match std::str::from_utf8(data).ok().and_then(mainmenu::patch_options_lua) {
                Some(text) => b.add_bytes(path.trim_start_matches('/'), &text.chars().map(|c| c as u32 as u8).collect::<Vec<u8>>())?,
                None => built.warnings.push("opções do jogo: o options.lua é diferente do esperado (ficaram as do jogo)".into()),
            }
            continue;
        }
        // a sala de escaramuça do jogo ganha o painel da Partida grande
        let restyled = mainmenu::restyle_frontend(data).and_then(|new| match panel {
            Some(_) if path == SUMMARY_SCENE => crate::bigmatch_menu::add_again_button(&new, if extras.pt { "JOGAR DE NOVO" } else { "PLAY AGAIN" }),
            _ => Ok(new),
        });
        match restyled {
            Ok(new) => b.add_bytes(path.trim_start_matches('/'), &new)?,
            Err(e) => built.warnings.push(format!("{}: {e}", path.rsplit('/').next().unwrap_or(path))),
        }
    }
    if !others.is_empty() {
        let own: std::collections::HashSet<String> = files.iter().map(|(p, _)| p.to_ascii_lowercase()).collect();
        let sources: Vec<PathBuf> = stock.iter().chain(extras.theme_sources.iter()).cloned().collect();
        for (name, data) in themed_cached(&sources, &settings.accent, settings.hud, data_dir)? {
            if !own.contains(&name.to_ascii_lowercase().replace('\\', "/")) {
                b.add_bytes(&name, &data)?;
            }
        }
    }
    if settings.custom_video {
        let v = Settings::video_path(data_dir);
        if v.is_file() {
            b.add_file(MOVIE, &v)?;
        } else {
            built.warnings.push("o vídeo de fundo escolhido não foi encontrado: ficou o do jogo".into());
        }
    }
    Ok((b.finish()?, built.warnings))
}

/// Os três estados do botão de um mapa da sala a partir da imagem de cima dele: escuro (parado),
/// claro (mouse em cima) e claro com a borda na cor de destaque (escolhido); embaixo, uma faixa
/// escura para o nome.
/// Os estados (`u`, `o`, `at`) da miniatura de um mapa, cada um em DDS.
pub(crate) type MapTiles = Vec<(&'static str, Vec<u8>)>;

pub(crate) fn map_tiles(png: &[u8], accent: [u8; 3]) -> Result<MapTiles> {
    let img = image::load_from_memory(png).map_err(|e| Error::Format(format!("miniatura do mapa: {e}")))?.to_rgba8();
    let side = 96u32;
    let small = image::imageops::resize(&img, side, side, image::imageops::FilterType::Triangle);
    let mut out = Vec::new();
    for (state, light, border) in [("u", 0.62f32, 1u32), ("o", 0.95, 2), ("at", 1.0, 4)] {
        let mut px = small.clone().into_raw();
        for y in 0..side {
            // faixa escura embaixo (o nome) e no canto de cima (as bases)
            let band = side * 30 / 100;
            let shade_y = if y >= side - band { 0.35 + 0.65 * ((side - 1 - y) as f32 / band as f32) } else { 1.0 };
            for x in 0..side {
                let i = ((y * side + x) * 4) as usize;
                let corner = if x < side * 45 / 100 && y < side / 4 { 0.55 + 0.45 * (x as f32 / (side as f32 * 0.45)).max(y as f32 / (side as f32 / 4.0)) } else { 1.0 };
                let edge = x < border || y < border || x >= side - border || y >= side - border;
                for c in 0..3 {
                    // borda: fina e apagada parada, na cor de destaque com o mouse e acesa quando escolhido
                    px[i + c] = if edge {
                        if state == "u" { (accent[c] as f32 * 0.45) as u8 } else { accent[c] }
                    } else {
                        (px[i + c] as f32 * light * shade_y * corner).min(255.0) as u8
                    };
                }
                px[i + 3] = 255;
            }
        }
        out.push((state, to_dds(&Rgba { width: side, height: side, pixels: px })?));
    }
    Ok(out)
}

/// As texturas do jogo pintadas na cor da tela inicial, guardadas em `cache/start-screen` (a
/// pintura de centenas de texturas é a parte mais demorada de montar a tela inicial; só é refeita
/// quando a cor, o estilo ou os arquivos do jogo mudam).
fn themed_cached(stock: &[PathBuf], accent: &str, hud: bool, data_dir: &Path) -> Result<Vec<(String, Vec<u8>)>> {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(STYLE_VERSION);
    h.update(accent.to_ascii_lowercase());
    h.update(if hud { "hud" } else { "menus" });
    for p in stock {
        let m = std::fs::metadata(p).ok();
        h.update(format!("{}:{}:{:?}", p.display(), m.as_ref().map(|m| m.len()).unwrap_or(0), m.and_then(|m| m.modified().ok())));
    }
    let key = hex::encode(h.finalize())[..16].to_string();
    let dir = data_dir.join("cache").join("start-screen");
    let path = dir.join(format!("tema-{key}.scd"));
    if let Ok(mut scd) = crate::scd::Scd::open(&path) {
        if let Ok(entries) = scd.entries() {
            let mut out = Vec::with_capacity(entries.len());
            let mut ok = true;
            for (i, e) in entries.iter().enumerate() {
                match scd.read_at(i) {
                    Ok(d) => out.push((e.name.clone(), d)),
                    Err(_) => {
                        ok = false;
                        break;
                    }
                }
            }
            if ok {
                return Ok(out);
            }
        }
    }
    let files = crate::menu_theme::themed_textures(stock, &theme_options(accent, hud))?;
    // os temas antigos saem (uma cor por vez basta)
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().to_string();
            if n.starts_with("tema-") && n.ends_with(".scd") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    if std::fs::create_dir_all(&dir).is_ok() {
        if let Ok(mut b) = crate::scd::ScdBuilder::create(&path) {
            let ok = files.iter().all(|(n, d)| b.add_bytes(n, d).is_ok());
            if !ok || b.finish().is_err() {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    Ok(files)
}

/// Versão do mod montado: muda com o visual, as opções, os mods da Forja e os arquivos escolhidos.
pub fn build_version(settings: &Settings, edit: &MenuEdit, data_dir: &Path) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(STYLE_VERSION);
    h.update(serde_json::to_vec(settings).unwrap_or_default());
    h.update(format!("{edit:?}"));
    for (on, p) in [(settings.custom_logo, Settings::logo_path(data_dir)), (settings.custom_video, Settings::video_path(data_dir))] {
        if on {
            let meta = std::fs::metadata(&p).ok();
            h.update(format!("{}:{:?}", meta.as_ref().map(|m| m.len()).unwrap_or(0), meta.and_then(|m| m.modified().ok())));
        }
    }
    format!("{STYLE_VERSION}+{}", &hex::encode(h.finalize())[..12])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recolor_keeps_grays_and_moves_red() {
        let mut img = Rgba { width: 3, height: 1, pixels: vec![226, 30, 36, 255, 40, 40, 44, 255, 120, 14, 16, 200] };
        recolor(&mut img, [43, 140, 255]);
        let p = &img.pixels;
        // o vermelho do desenho vira a cor (azul) com o mesmo brilho dela
        assert!(p[2] > 200 && p[0] < 80, "{:?}", &p[0..4]);
        // cinza fica igual
        assert_eq!(&p[4..8], &[40, 40, 44, 255]);
        // vermelho escuro vira azul escuro, alfa igual
        assert!(p[10] > p[8] && p[11] == 200);
        assert!(textures([43, 140, 255]).unwrap().len() == ART.len());
    }

    #[test]
    fn logo_loses_black_background() {
        let mut img = image::RgbaImage::from_pixel(40, 20, image::Rgba([0, 0, 0, 255]));
        for x in 10..30 {
            for y in 5..15 {
                img.put_pixel(x, y, image::Rgba([200, 200, 210, 255]));
            }
        }
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(img).write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).unwrap();
        let l = prepare_logo(&png).unwrap();
        assert_eq!((l.width, l.height), (32, 20));
        assert_eq!(l.pixels[3], 0, "canto transparente");
        let mid = ((11 * l.width + 16) * 4) as usize;
        assert!(l.pixels[mid + 3] > 190 && l.pixels[mid] > 230);
    }
}

/// Com `CP_SS_SCENE` (a cena do jogo), `CP_SS_LOAD` (cybran_load.dds), `CP_SS_LOGO` (um PNG) e
/// `CP_SS_OUT` (pasta): monta o `.scd` de verdade para testar no jogo.
#[cfg(test)]
#[test]
fn real_build_when_available() {
    let (Ok(scene), Ok(out)) = (std::env::var("CP_SS_SCENE"), std::env::var("CP_SS_OUT")) else { return };
    let out = PathBuf::from(out);
    std::fs::create_dir_all(out.join("data").join(USER_DIR)).unwrap();
    let mut stock = vec![];
    if let Ok(load) = std::env::var("CP_SS_LOAD") {
        let p = out.join("stock.scd");
        let mut b = crate::scd::ScdBuilder::create(&p).unwrap();
        b.add_bytes("textures/ui/common/menus/background-colossus.dds", &std::fs::read(load).unwrap()).unwrap();
        stock.push(b.finish().unwrap());
    }
    let mut settings = Settings { enabled: true, ..Default::default() };
    if let Ok(logo) = std::env::var("CP_SS_LOGO") {
        std::fs::copy(logo, Settings::logo_path(&out.join("data"))).unwrap();
        settings.custom_logo = true;
    }
    // CP_SS_SCENES: pasta com ui/scenes/... extraídos do jogo (os outros menus)
    let mut others = vec![];
    if let Ok(dir) = std::env::var("CP_SS_SCENES") {
        for p in mainmenu::FRONTEND_SCENES {
            if let Ok(d) = std::fs::read(PathBuf::from(&dir).join(p.trim_start_matches('/'))) {
                others.push((p.to_string(), d));
            }
        }
    }
    if let Ok(o) = std::env::var("CP_SS_OPTIONS") {
        let text: String = std::fs::read(o).unwrap().iter().map(|&b| b as char).collect();
        others.push((mainmenu::OPTIONS_LUA.to_string(), text.into_bytes()));
    }
    let mut edit = MenuEdit::default();
    edit.buttons.push(mainmenu::NewButton { key: "cp:atalho0".into(), label: "MEGA: 4 CONTRA 4".into(), place: mainmenu::Place::Skirmish, native: None, lua: false, code: Some("LOG('atalho')".into()) });
    let code = |c: &str| Some(format!("local m = import('/lua/SinglePlayerLaunch.lua') {c}"));
    edit.buttons.push(mainmenu::NewButton { key: "cp:modo16".into(), label: "GUERRA 8 CONTRA 8".into(), place: mainmenu::Place::Skirmish, native: None, lua: false, code: code("if m.CPBigMatchMode then m.CPBigMatchMode('/maps/SC2_MEUMAP/SC2_MEUMAP_scenario.lua', 16, 2) end") });
    edit.buttons.push(mainmenu::NewButton { key: "cp:trapacas_on".into(), label: "TRAPAÇAS: LIGAR".into(), place: mainmenu::Place::Extras, native: None, lua: false, code: code("if m.CPBMSet then m.CPBMSet('cheats', true) end") });
    let maps = vec![
        crate::bigmatch_menu::MenuMap { path: "/maps/SC2_MEUMAP/SC2_MEUMAP_scenario.lua".into(), name: "Meu mapa".into(), bases: 32, size: 1024 },
        crate::bigmatch_menu::MenuMap { path: "/maps/SC2_32PLAY/SC2_32PLAY_scenario.lua".into(), name: "32 players".into(), bases: 32, size: 4096 },
        crate::bigmatch_menu::MenuMap { path: "/maps/SC2_PROF20/SC2_PROF20_scenario.lua".into(), name: "Perfil".into(), bases: 32, size: 2048 },
        crate::bigmatch_menu::MenuMap { path: "/maps/sc2_mp_203/sc2_mp_203_scenario.lua".into(), name: "Teste 4".into(), bases: 4, size: 1024 },
    ];
    let lp = crate::gamepanel::LauncherPanel {
        profiles: vec![("mods".into(), "Mods".into(), true), ("teste".into(), "Teste".into(), false)],
        mods: vec![("cp-ia-esperta".into(), "IA esperta".into(), true), ("texturas-hd".into(), "Texturas HD".into(), true), ("cp-trapacas-menu".into(), "Trapaças".into(), false)],
        accent: "#2b8cff".into(),
        memory_mb: Some(4096),
        priority: "normal".into(),
    };
    let extras = GameExtras { lobby: Some((maps.as_slice(), &crate::bigmatch_menu::PT)), lobby_thumbs: vec![], launcher: Some(&lp), pt: true, theme_sources: vec![] };
    let (scd, warnings) = build_all(&std::fs::read(scene).unwrap(), &others, &edit, &settings, &stock, &out.join("data"), &out.join(ARCHIVE), &extras).unwrap();
    assert!(warnings.is_empty(), "{warnings:?}");
    eprintln!("{}", scd.display());
}
