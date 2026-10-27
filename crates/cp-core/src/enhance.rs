//! Texturas HD: aumenta a resolução e a nitidez das texturas originais do jogo e gera um mod.
//!
//! Cada textura passa por:
//! 1. **desbloqueio**: suaviza as bordas dos blocos 4x4 da compressão DXT (só onde não há borda real);
//! 2. **ampliação** (2x por padrão) com Lanczos-3 em alfa pré-multiplicado e **anti-ringing**:
//!    cada pixel novo fica dentro do intervalo dos 4 pixels originais mais próximos, sem halos;
//! 3. **nitidez adaptativa** (no estilo do AMD CAS): reforça onde está borrado, quase nada onde já há
//!    contraste, e nunca ultrapassa o mínimo/máximo da vizinhança;
//! 4. recompressão no **mesmo formato** do original, com cadeia de mipmaps completa.
//!
//! Tipos de textura são tratados de forma diferente: mapas de normal são renormalizados e não
//! recebem nitidez; máscaras (especular, cor do time) não recebem nitidez; tabelas de cor (rampas,
//! LUTs), fontes e cubemaps não são tocados, porque o tamanho delas carrega significado.
//!
//! A interface do SC2 desenha muitas imagens no tamanho da própria textura: por isso o modo de cada
//! grupo de pastas é escolhido (ampliar, só nitidez ou não mexer) e a interface vem em "só nitidez".

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::dds::{self, DdsFormat, DdsInfo, Quality, Rgba};
use crate::error::{Error, Result};
use crate::scd::{Scd, ScdBuilder};

/// Versão do gerador gravada no mod. 2.x: não mexe em tabelas de cor/iluminação (volumes 3D)
/// nem amplia ícones desenhados na tela. Mods 1.x deixavam mapas verdes e ícones gigantes.
/// 3.x: Remaster (cores mais ricas, contraste local e relevo por tipo de textura) em cima do HD.
pub const GENERATOR_VERSION: &str = "3.0.0";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Aumenta a resolução e aplica nitidez.
    Upscale,
    /// Mantém o tamanho e só aplica nitidez/desbloqueio.
    Sharpen,
    /// Não mexe.
    Skip,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TextureClass {
    Color,
    Normal,
    Data,
    Skip,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMode {
    pub group: String,
    pub mode: Mode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EnhanceOptions {
    pub name: String,
    /// Modo por grupo de pastas (veja [`group_of`]). Grupos ausentes usam o padrão sugerido.
    pub groups: Vec<GroupMode>,
    /// Fator de ampliação (2 ou 4).
    pub scale: u32,
    /// Lado máximo da textura gerada.
    pub max_size: u32,
    /// Força da nitidez (0..1.5).
    pub sharpness: f32,
    /// Força do desbloqueio DXT (0..1).
    pub deblock: f32,
    /// Força do Remaster (0 = só HD; 1 = padrão; até 1.5): cores, contraste local e relevo.
    pub remaster: f32,
    /// Estilo do Remaster.
    pub style: Style,
    /// Força por tipo de superfície (multiplica `remaster`).
    pub mix: Mix,
    pub quality: Quality,
}

impl Default for EnhanceOptions {
    fn default() -> Self {
        EnhanceOptions {
            name: "Remaster".into(),
            groups: vec![],
            scale: 2,
            max_size: 2048,
            sharpness: 0.6,
            deblock: 0.5,
            remaster: 1.0,
            style: Style::Faithful,
            mix: Mix::default(),
            quality: Quality::Normal,
        }
    }
}

/// Grupo de uma textura: a primeira pasta, ou as duas primeiras dentro de `/textures/`.
pub fn group_of(key: &str) -> String {
    let parts: Vec<&str> = key.trim_start_matches('/').split('/').collect();
    match parts.as_slice() {
        [first, second, _, ..] if *first == "textures" => format!("/{first}/{second}/"),
        [first, _, ..] => format!("/{first}/"),
        _ => "/".into(),
    }
}

/// Modo sugerido para um grupo: interface e ícones só ganham nitidez (o tamanho deles importa).
pub fn default_mode(group: &str) -> Mode {
    let g = group.to_ascii_lowercase();
    if g.contains("/ui/") || g.contains("icon") || g.contains("font") || g.contains("/lua/") {
        Mode::Sharpen
    } else {
        Mode::Upscale
    }
}

/// Pastas cujas texturas são dados do motor (tabelas de cor, iluminação pré-calculada,
/// texturas de teste e de editor): mexer nelas muda a cor ou a luz do jogo inteiro.
fn is_engine_data(k: &str) -> bool {
    let k = k.trim_start_matches('/');
    k.starts_with("textures/colorcorrection/")
        || k.starts_with("textures/engine/")
        || k.contains(".ccc.")
        || k.contains("pcloud")
        || (k.starts_with("maps/") && k.contains("/lighting/"))
}

/// Texturas desenhadas na tela no tamanho em pixels (ícones, marcadores estratégicos, splats,
/// molduras de seleção, imagens do lobby): ampliar faria o ícone ficar maior no jogo.
/// Elas podem ganhar nitidez, mas mantêm o tamanho.
pub fn keeps_size(key: &str, info: &DdsInfo) -> bool {
    let k = key.to_ascii_lowercase();
    let k = k.trim_start_matches('/');
    let file = k.rsplit('/').next().unwrap_or(k);
    let screen_dir = ["textures/ui/", "textures/splats/", "textures/decals/", "/icons/", "strategicicons"]
        .iter()
        .any(|d| k.starts_with(d) || k.contains(d));
    let screen_name = ["icon", "bracket", "marker", "strategic", "cursor", "mapshot", "mapimage", "minimap", "font"]
        .iter()
        .any(|t| file.contains(t));
    // texturas soltas na raiz de /textures/ são elementos de interface do motor
    let root = k.starts_with("textures/") && k.matches('/').count() == 1;
    // sem mipmaps = não é usada em superfície 3D (que precisa de mips): é desenhada na tela
    screen_dir || screen_name || root || info.mip_count <= 1
}

/// Classifica pelo nome e pelo formato.
pub fn classify(key: &str, info: &DdsInfo) -> TextureClass {
    let k = key.to_ascii_lowercase();
    let file = k.rsplit('/').next().unwrap_or(&k);
    if info.is_cubemap || info.is_volume || info.width.min(info.height) < 8 || is_engine_data(&k) {
        return TextureClass::Skip;
    }
    const TABLES: &[&str] = &[
        "ramp", "lut", "lookup", "gradient", "falloff", "palette", "font", "cubemap", "envmap",
    ];
    if TABLES.iter().any(|t| file.contains(t)) {
        return TextureClass::Skip;
    }
    const NORMALS: &[&str] = &["normal", "_nrm", "_nm.", "_n.dds", "bump"];
    if NORMALS.iter().any(|t| file.contains(t)) || info.format == DdsFormat::Ati2 {
        return TextureClass::Normal;
    }
    const DATA: &[&str] = &[
        "spec", "mask", "team", "gloss", "rough", "_ao", "height", "alpha", "lightmap", "shadow",
    ];
    if DATA.iter().any(|t| file.contains(t)) || matches!(info.format, DdsFormat::Ati1 | DdsFormat::L8) {
        return TextureClass::Data;
    }
    TextureClass::Color
}

// ------------------------------------------------------------------ plano

/// Texturas iguais em tamanho/formato dentro de um grupo (para a interface estimar o resultado).
#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct SizeBucket {
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub mipmaps: bool,
    /// Tipos que não mudam (tabelas, cubemaps, formatos não suportados) contam como "skip".
    pub skip: bool,
    /// Desenhada na tela no tamanho em pixels (ícones): nunca é ampliada.
    pub keep_size: bool,
    pub count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupSummary {
    pub group: String,
    pub textures: usize,
    pub bytes: u64,
    pub suggested: Mode,
    pub sample: Vec<String>,
    pub buckets: Vec<SizeBucket>,
}

/// (largura, altura, formato, tem mipmaps, não muda, mantém o tamanho)
type BucketKey = (u32, u32, String, bool, bool, bool);

/// Grupos de texturas dos arquivos originais, com tamanhos e formatos (lê só o cabeçalho de cada DDS).
pub fn groups(sources: &[PathBuf]) -> Result<Vec<GroupSummary>> {
    let mut map: BTreeMap<String, (GroupSummary, BTreeMap<BucketKey, usize>)> = BTreeMap::new();
    let mut open: Option<(PathBuf, Scd)> = None;
    for t in texture_entries(sources)? {
        if open.as_ref().map(|(p, _)| p != &t.src).unwrap_or(true) {
            open = Some((t.src.clone(), Scd::open(&t.src)?));
        }
        let head = open.as_mut().expect("aberto").1.read_prefix_at(t.index, 148)?;
        let bucket = match dds::info(&head) {
            Ok(info) => {
                let skip = classify(&t.key, &info) == TextureClass::Skip;
                (
                    info.width,
                    info.height,
                    format!("{:?}", info.format).to_ascii_lowercase(),
                    info.mip_count > 1,
                    skip,
                    keeps_size(&t.key, &info),
                )
            }
            Err(_) => (0, 0, "?".into(), false, true, true),
        };
        let g = group_of(&t.key);
        let (e, buckets) = map.entry(g.clone()).or_insert_with(|| {
            (
                GroupSummary {
                    suggested: default_mode(&g),
                    group: g,
                    textures: 0,
                    bytes: 0,
                    sample: vec![],
                    buckets: vec![],
                },
                BTreeMap::new(),
            )
        });
        e.textures += 1;
        e.bytes += t.size;
        if e.sample.len() < 6 && !bucket.4 {
            e.sample.push(t.name);
        }
        *buckets.entry(bucket).or_default() += 1;
    }
    let mut v: Vec<_> = map
        .into_values()
        .map(|(mut g, b)| {
            g.buckets = b
                .into_iter()
                .map(|((width, height, format, mipmaps, skip, keep_size), count)| SizeBucket {
                    width,
                    height,
                    format,
                    mipmaps,
                    skip,
                    keep_size,
                    count,
                })
                .collect();
            g
        })
        .collect();
    v.sort_by_key(|g| std::cmp::Reverse(g.bytes));
    Ok(v)
}

struct TexEntry {
    src: PathBuf,
    index: usize,
    name: String,
    key: String,
    size: u64,
}

/// Cada `.dds` dos arquivos, sem repetir (o último montado vence), agrupado por arquivo de origem.
fn texture_entries(sources: &[PathBuf]) -> Result<Vec<TexEntry>> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for src in sources.iter().rev() {
        let mut scd = Scd::open(src)?;
        for (index, e) in scd.entries()?.into_iter().enumerate() {
            if !e.is_dir && e.key.ends_with(".dds") && seen.insert(e.key.clone()) {
                out.push(TexEntry {
                    src: src.clone(),
                    index,
                    name: e.name,
                    key: e.key,
                    size: e.size,
                });
            }
        }
    }
    // por arquivo e posição: leitura sequencial, sem reabrir o .scd
    out.sort_by(|a, b| a.src.cmp(&b.src).then(a.index.cmp(&b.index)));
    Ok(out)
}

fn mode_for(opts: &EnhanceOptions, group: &str) -> Mode {
    opts.groups
        .iter()
        .find(|g| g.group == group)
        .map(|g| g.mode)
        .unwrap_or_else(|| default_mode(group))
}

/// Modo aplicado de fato: texturas desenhadas no tamanho em pixels nunca são ampliadas.
pub fn effective_mode(key: &str, info: &DdsInfo, mode: Mode) -> Mode {
    if mode == Mode::Upscale && keeps_size(key, info) {
        Mode::Sharpen
    } else {
        mode
    }
}

/// Tamanho final de uma textura.
pub fn target_size(w: u32, h: u32, mode: Mode, opts: &EnhanceOptions) -> (u32, u32) {
    if mode != Mode::Upscale {
        return (w, h);
    }
    let scale = opts.scale.clamp(1, 4);
    let max = opts.max_size.clamp(256, 8192);
    let (mut tw, mut th) = (w * scale, h * scale);
    while (tw > max || th > max) && tw > w && th > h {
        tw /= 2;
        th /= 2;
    }
    if tw <= w || th <= h {
        (w, h)
    } else {
        (tw, th)
    }
}

// ------------------------------------------------------------------ processamento

/// Melhora uma textura DDS. Devolve `None` se ela deve ficar como está.
pub fn enhance_dds(key: &str, data: &[u8], mode: Mode, opts: &EnhanceOptions) -> Result<Option<Vec<u8>>> {
    if mode == Mode::Skip {
        return Ok(None);
    }
    let (info, img) = dds::decode(data)?;
    let class = classify(key, &info);
    if class == TextureClass::Skip {
        return Ok(None);
    }
    let mode = effective_mode(key, &info, mode);
    let (tw, th) = target_size(info.width, info.height, mode, opts);
    let upscaled = (tw, th) != (info.width, info.height);
    let look = look_of(key, class, opts);
    if !upscaled && look.is_none() && (class != TextureClass::Color || opts.sharpness <= 0.0 && opts.deblock <= 0.0) {
        return Ok(None); // nada a ganhar
    }
    let mut out = enhance_image(&img, class, tw, th, info.format, opts);
    if let Some(look) = look {
        apply_look(&mut out, look);
    }
    let mips = if info.mip_count <= 1 { 1 } else { 0 };
    dds::encode(&out, info.format, mips, opts.quality).map(Some)
}

/// O processamento em si, sobre RGBA8 (exposto para testes e prévias).
pub fn enhance_image(
    img: &Rgba,
    class: TextureClass,
    tw: u32,
    th: u32,
    format: DdsFormat,
    opts: &EnhanceOptions,
) -> Rgba {
    let binary_alpha =
        img.pixels.chunks_exact(4).all(|p| p[3] == 0 || p[3] == 255) && img.pixels.chunks_exact(4).any(|p| p[3] == 0);
    let mut work = img.clone();
    let compressed = matches!(format, DdsFormat::Dxt1 | DdsFormat::Dxt3 | DdsFormat::Dxt5);
    if compressed && class == TextureClass::Color && opts.deblock > 0.0 {
        deblock(&mut work, opts.deblock.clamp(0.0, 1.0));
    }
    let upscaled = (tw, th) != (img.width, img.height);
    if upscaled {
        work = upscale(&work, tw, th);
    }
    match class {
        TextureClass::Color => {
            let amount = opts.sharpness.clamp(0.0, 1.5) * if upscaled { 1.0 } else { 0.7 };
            if amount > 0.0 {
                sharpen(&mut work, amount);
            }
        }
        TextureClass::Normal => renormalize(&mut work),
        TextureClass::Data | TextureClass::Skip => {}
    }
    if binary_alpha {
        for p in work.pixels.chunks_exact_mut(4) {
            p[3] = if p[3] >= 128 { 255 } else { 0 };
        }
    }
    work
}

/// Suaviza degraus nas bordas dos blocos 4x4 (artefato da compressão DXT) quando a diferença
/// é pequena — diferenças grandes são bordas de verdade e ficam intactas.
pub fn deblock(img: &mut Rgba, strength: f32) {
    let (w, h) = (img.width as usize, img.height as usize);
    if w < 8 || h < 8 {
        return;
    }
    let thr = 4.0 + 20.0 * strength; // em níveis de 0..255
    let px = &mut img.pixels;
    let mut fix = |a: usize, b: usize, a2: usize, b2: usize| {
        for c in 0..3 {
            let (p1, p0, q0, q1) = (px[a2 + c] as f32, px[a + c] as f32, px[b + c] as f32, px[b2 + c] as f32);
            let step = q0 - p0;
            // degrau na borda do bloco, mas cada lado é liso: é artefato
            if step.abs() < thr && (p1 - p0).abs() < thr * 0.5 && (q1 - q0).abs() < thr * 0.5 {
                let d = step * 0.25 * strength.max(0.3);
                px[a + c] = (p0 + d).round().clamp(0.0, 255.0) as u8;
                px[b + c] = (q0 - d).round().clamp(0.0, 255.0) as u8;
            }
        }
    };
    for y in 0..h {
        for x in (4..w - 1).step_by(4) {
            let i = |xx: usize| (y * w + xx) * 4;
            fix(i(x - 1), i(x), i(x - 2), i(x + 1));
        }
    }
    for y in (4..h - 1).step_by(4) {
        for x in 0..w {
            let i = |yy: usize| (yy * w + x) * 4;
            fix(i(y - 1), i(y), i(y - 2), i(y + 1));
        }
    }
}

/// Ampliação: Lanczos-3 com anti-ringing e depois retroprojeção iterativa — a imagem grande é
/// corrigida até que, reduzida de volta, reproduza a original. Recupera bordas nítidas sem halos.
pub fn upscale(img: &Rgba, tw: u32, th: u32) -> Rgba {
    let first = upscale_lanczos(img, tw, th);
    if !tw.is_multiple_of(img.width) || !th.is_multiple_of(img.height) {
        return first; // retroprojeção só para fatores inteiros
    }
    back_project(img, first, BACK_PROJECTION_STEPS)
}

/// Uma passada: recupera nitidez; mais passadas reforçam o serrilhado que já existe na textura.
const BACK_PROJECTION_STEPS: usize = 1;

pub fn back_project(low: &Rgba, mut high: Rgba, steps: usize) -> Rgba {
    let (lw, lh) = (low.width as usize, low.height as usize);
    let (hw, hh) = (high.width as usize, high.height as usize);
    let (fx, fy) = (hw / lw, hh / lh);
    let norm = 1.0 / (fx * fy) as f32;
    // trabalha em f32 com cor pré-multiplicada
    let pre = |px: &[u8]| -> Vec<f32> {
        px.chunks_exact(4)
            .flat_map(|p| {
                let a = p[3] as f32 / 255.0;
                [p[0] as f32 * a, p[1] as f32 * a, p[2] as f32 * a, p[3] as f32]
            })
            .collect()
    };
    let l = pre(&low.pixels);
    let mut x = pre(&high.pixels);
    // limites anti-halo: cada pixel grande fica no intervalo dos 2x2 pixels pequenos mais próximos
    let mut lo = vec![0f32; x.len()];
    let mut hi = vec![0f32; x.len()];
    for y in 0..hh {
        let sy = ((y as f32 + 0.5) / fy as f32 - 0.5).max(0.0);
        let (y0, y1) = ((sy as usize).min(lh - 1), (sy as usize + 1).min(lh - 1));
        for xx in 0..hw {
            let sx = ((xx as f32 + 0.5) / fx as f32 - 0.5).max(0.0);
            let (x0, x1) = ((sx as usize).min(lw - 1), (sx as usize + 1).min(lw - 1));
            for c in 0..4 {
                let v = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)].map(|(a, b)| l[(b * lw + a) * 4 + c]);
                let i = (y * hw + xx) * 4 + c;
                lo[i] = v.iter().cloned().fold(f32::MAX, f32::min);
                hi[i] = v.iter().cloned().fold(f32::MIN, f32::max);
            }
        }
    }
    let mut err = vec![0f32; l.len()];
    for _ in 0..steps {
        // erro na resolução original: original - reduzir(estimativa)
        err.par_chunks_mut(lw * 4).enumerate().for_each(|(ly, row)| {
            for lx in 0..lw {
                for c in 0..4 {
                    let mut sum = 0.0;
                    for dy in 0..fy {
                        for dx in 0..fx {
                            sum += x[((ly * fy + dy) * hw + lx * fx + dx) * 4 + c];
                        }
                    }
                    row[lx * 4 + c] = l[(ly * lw + lx) * 4 + c] - sum * norm;
                }
            }
        });
        // devolve o erro ampliado (bilinear) e respeita os limites
        x.par_chunks_mut(hw * 4).enumerate().for_each(|(y, row)| {
            let sy = ((y as f32 + 0.5) / fy as f32 - 0.5).clamp(0.0, (lh - 1) as f32);
            let (y0, ty) = (sy.floor() as usize, sy.fract());
            let y1 = (y0 + 1).min(lh - 1);
            for xx in 0..hw {
                let sx = ((xx as f32 + 0.5) / fx as f32 - 0.5).clamp(0.0, (lw - 1) as f32);
                let (x0, tx) = (sx.floor() as usize, sx.fract());
                let x1 = (x0 + 1).min(lw - 1);
                for c in 0..4 {
                    let e = |a: usize, b: usize| err[(b * lw + a) * 4 + c];
                    let up = (e(x0, y0) * (1.0 - tx) + e(x1, y0) * tx) * (1.0 - ty)
                        + (e(x0, y1) * (1.0 - tx) + e(x1, y1) * tx) * ty;
                    let i = (y * hw + xx) * 4 + c;
                    row[xx * 4 + c] = (row[xx * 4 + c] + up).clamp(lo[i], hi[i]);
                }
            }
        });
    }
    for (o, p) in high.pixels.chunks_exact_mut(4).zip(x.chunks_exact(4)) {
        let a = p[3].clamp(0.0, 255.0);
        o[3] = a.round() as u8;
        let inv = if a > 0.5 { 255.0 / a } else { 0.0 };
        for c in 0..3 {
            o[c] = (p[c] * inv).round().clamp(0.0, 255.0) as u8;
        }
    }
    high
}

/// Lanczos-3 em alfa pré-multiplicado, com anti-ringing (limitado aos 2x2 vizinhos originais).
pub fn upscale_lanczos(img: &Rgba, tw: u32, th: u32) -> Rgba {
    let (w, h) = (img.width, img.height);
    // pré-multiplica para que pixels transparentes não "sangrem" cor nas bordas
    let mut pre = img.pixels.clone();
    for p in pre.chunks_exact_mut(4) {
        let a = p[3] as u32;
        for c in &mut p[..3] {
            *c = ((*c as u32 * a + 127) / 255) as u8;
        }
    }
    let src = image::RgbaImage::from_raw(w, h, pre.clone()).expect("tamanho coerente");
    let big = image::imageops::resize(&src, tw, th, image::imageops::FilterType::Lanczos3).into_raw();
    let mut out = vec![0u8; (tw * th * 4) as usize];
    out.par_chunks_mut((tw * 4) as usize).enumerate().for_each(|(y, row)| {
        let sy = ((y as f32 + 0.5) * h as f32 / th as f32 - 0.5).max(0.0);
        let y0 = (sy.floor() as u32).min(h - 1);
        let y1 = (y0 + 1).min(h - 1);
        for x in 0..tw as usize {
            let sx = ((x as f32 + 0.5) * w as f32 / tw as f32 - 0.5).max(0.0);
            let x0 = (sx.floor() as u32).min(w - 1);
            let x1 = (x0 + 1).min(w - 1);
            let o = x * 4;
            let bi = (y * tw as usize + x) * 4;
            for c in 0..4 {
                let s = |xx: u32, yy: u32| pre[((yy * w + xx) * 4) as usize + c];
                let (a, b, cc, d) = (s(x0, y0), s(x1, y0), s(x0, y1), s(x1, y1));
                let lo = a.min(b).min(cc).min(d);
                let hi = a.max(b).max(cc).max(d);
                row[o + c] = big[bi + c].clamp(lo, hi);
            }
            // desfaz a pré-multiplicação
            let a = row[o + 3] as u32;
            if a > 0 && a < 255 {
                for c in 0..3 {
                    row[o + c] = ((row[o + c] as u32 * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
    });
    Rgba {
        width: tw,
        height: th,
        pixels: out,
    }
}

/// Nitidez adaptativa sem halos (limitada ao mínimo/máximo 3x3 de cada canal).
pub fn sharpen(img: &mut Rgba, amount: f32) {
    let (w, h) = (img.width as usize, img.height as usize);
    if w < 3 || h < 3 {
        return;
    }
    let src = img.pixels.clone();
    let luma = |i: usize| (src[i] as f32 * 0.2126 + src[i + 1] as f32 * 0.7152 + src[i + 2] as f32 * 0.0722) / 255.0;
    img.pixels.par_chunks_mut(w * 4).enumerate().for_each(|(y, row)| {
        let ym = y.saturating_sub(1);
        let yp = (y + 1).min(h - 1);
        for x in 0..w {
            let xm = x.saturating_sub(1);
            let xp = (x + 1).min(w - 1);
            let at = |xx: usize, yy: usize| (yy * w + xx) * 4;
            let i = at(x, y);
            let neigh = [
                at(xm, ym),
                at(x, ym),
                at(xp, ym),
                at(xm, y),
                at(xp, y),
                at(xm, yp),
                at(x, yp),
                at(xp, yp),
            ];
            let l = luma(i);
            let (mut lmin, mut lmax) = (l, l);
            let mut blur = l * 4.0;
            for (k, &n) in neigh.iter().enumerate() {
                let ln = luma(n);
                lmin = lmin.min(ln);
                lmax = lmax.max(ln);
                // gaussiana 3x3: cruz pesa 2, diagonais 1
                blur += ln * if k % 2 == 1 { 2.0 } else { 1.0 };
            }
            blur /= 16.0;
            let adapt = (lmin.min(1.0 - lmax) / lmax.max(1e-4)).clamp(0.0, 1.0).sqrt();
            let delta = (l - blur) * amount * 2.0 * adapt * 255.0;
            if delta.abs() < 0.25 {
                continue;
            }
            let o = x * 4;
            for c in 0..3 {
                let mut lo = src[i + c];
                let mut hi = src[i + c];
                for &n in &neigh {
                    lo = lo.min(src[n + c]);
                    hi = hi.max(src[n + c]);
                }
                let v = (src[i + c] as f32 + delta).round().clamp(lo as f32, hi as f32);
                row[o + c] = v as u8;
            }
        }
    });
}

/// Volta os vetores do mapa de normal ao comprimento 1 depois da ampliação.
/// Mapas no formato "DXT5nm" (X no alfa, vermelho constante) são deixados como estão.
pub fn renormalize(img: &mut Rgba) {
    let n = (img.width * img.height) as f32;
    let (mut sum, mut sum2) = (0.0f32, 0.0f32);
    for p in img.pixels.chunks_exact(4) {
        sum += p[0] as f32;
        sum2 += (p[0] as f32).powi(2);
    }
    let var_r = sum2 / n - (sum / n).powi(2);
    if var_r < 4.0 {
        return; // vermelho constante: provavelmente DXT5nm
    }
    for p in img.pixels.chunks_exact_mut(4) {
        let v = [
            p[0] as f32 / 127.5 - 1.0,
            p[1] as f32 / 127.5 - 1.0,
            p[2] as f32 / 127.5 - 1.0,
        ];
        let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        if len > 1e-3 {
            for c in 0..3 {
                p[c] = ((v[c] / len + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

// ------------------------------------------------------------------ Remaster

/// Estilo do Remaster.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Style {
    /// Fiel ao jogo: as mesmas cores, mais ricas e definidas.
    #[default]
    Faithful,
    /// Mais vivo: cores mais fortes e mais luz.
    Vivid,
    /// Cinematográfico: mais contraste, sombras frias e luzes quentes.
    Cinematic,
}

/// Força do Remaster por tipo de superfície (1 = padrão, 0 = não mexe, até 2).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Mix {
    pub ground: f32,
    pub nature: f32,
    pub units: f32,
    pub effects: f32,
    pub ui: f32,
}

impl Default for Mix {
    fn default() -> Self {
        Mix { ground: 1.0, nature: 1.0, units: 1.0, effects: 1.0, ui: 1.0 }
    }
}

/// Tipo de superfície de uma textura pelo caminho (para o Remaster).
pub fn surface_of(key: &str) -> &'static str {
    let p = key.to_ascii_lowercase();
    let has = |t: &[&str]| t.iter().any(|x| p.contains(x));
    if has(&["/textures/terrain/", "/maps/", "/env/terrain", "/textures/water"]) {
        "ground"
    } else if has(&["/env/", "/props/", "tree", "foliage", "grass", "bush", "rock"]) {
        "nature"
    } else if has(&["/units/", "/projectiles/", "/meshes/"]) {
        "units"
    } else if has(&["/effects/", "/particles/", "/textures/particles/"]) {
        "effects"
    } else if has(&["/textures/ui/", "/icons/", "/textures/splats/", "/textures/decals/"]) {
        "ui"
    } else {
        "other"
    }
}

/// O "acabamento" do Remaster para uma textura: fiel ao jogo, só mais rico. Cada tipo de superfície
/// recebe uma dose diferente (o chão ganha mais contraste local, a vegetação mais cor, as unidades
/// painéis mais definidos, a interface quase nada).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Look {
    /// Contraste local (realça relevo e detalhe pintado, sem mudar o brilho médio).
    pub clarity: f32,
    /// Raio do contraste local, em fração do lado da textura.
    pub radius: f32,
    /// Saturação que cresce mais nas cores apagadas (nunca estoura as fortes).
    pub vibrance: f32,
    /// Curva em S leve (mais profundidade nos escuros e claros).
    pub curve: f32,
    /// Profundidade extra dos mapas de normal (1 = igual).
    pub depth: f32,
    /// Tom dividido (estilo cinematográfico): sombras para o frio, luzes para o quente.
    pub split: f32,
    /// Luz geral extra (estilo vivo), em fração.
    pub lift: f32,
}

/// O acabamento de uma textura pelo caminho e pelo tipo (`None` = só a parte HD).
pub fn look_of(key: &str, class: TextureClass, opts: &EnhanceOptions) -> Option<Look> {
    let k = opts.remaster.clamp(0.0, 1.5);
    if k <= 0.0 || matches!(class, TextureClass::Skip | TextureClass::Data) {
        return None;
    }
    let surface = surface_of(key);
    let m = &opts.mix;
    let k = k * match surface {
        "ground" => m.ground,
        "nature" => m.nature,
        "units" => m.units,
        "effects" => m.effects,
        "ui" => m.ui,
        _ => (m.ground + m.units) / 2.0,
    }
    .clamp(0.0, 2.0);
    if k <= 0.0 {
        return None;
    }
    // (clareza, raio, vivacidade, curva, relevo)
    let (clarity, radius, vibrance, curve, depth) = match surface {
        "ground" => (0.7, 1.0 / 40.0, 0.24, 0.14, 1.45),
        "nature" => (0.7, 1.0 / 36.0, 0.3, 0.14, 1.4),
        "units" => (0.6, 1.0 / 56.0, 0.16, 0.14, 1.35),
        "effects" => (0.0, 0.0, 0.14, 0.06, 1.0),
        "ui" => (0.15, 1.0 / 32.0, 0.08, 0.05, 1.0),
        _ => (0.45, 1.0 / 44.0, 0.14, 0.1, 1.25),
    };
    // o estilo muda as doses (o relevo é o mesmo)
    let (cl, vi, cu, split, lift) = match opts.style {
        Style::Faithful => (1.0, 1.0, 1.0, 0.0, 0.0),
        Style::Vivid => (1.0, 1.7, 0.9, 0.0, 0.04),
        Style::Cinematic => (1.15, 0.75, 1.7, 0.06, 0.0),
    };
    let no_tone = matches!(surface, "ui" | "effects");
    match class {
        // mapa de normal: só o relevo
        TextureClass::Normal if depth > 1.001 => {
            Some(Look { clarity: 0.0, radius, vibrance: 0.0, curve: 0.0, depth: 1.0 + (depth - 1.0) * k, split: 0.0, lift: 0.0 })
        }
        // cor: contraste, cores e curva (o relevo é do mapa de normal)
        TextureClass::Color => Some(Look {
            clarity: clarity * k * cl,
            radius,
            vibrance: vibrance * k * vi,
            curve: curve * k * cu,
            depth: 1.0,
            split: if no_tone { 0.0 } else { split * k },
            lift: if no_tone { 0.0 } else { lift * k },
        }),
        _ => None,
    }
}

/// Média de cada pixel numa janela quadrada de raio `r`, emendando nas bordas (texturas do jogo se
/// repetem lado a lado): duas passadas de soma corrida, O(n) para qualquer raio.
fn box_blur_wrap(src: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let r = r.min(w / 2).min(h / 2).max(1);
    let win = (2 * r + 1) as f32;
    let mut tmp = vec![0f32; w * h];
    tmp.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        let line = &src[y * w..(y + 1) * w];
        let mut acc: f32 = (0..=2 * r).map(|i| line[(i + w - r) % w]).sum();
        for (x, out) in row.iter_mut().enumerate() {
            *out = acc / win;
            acc += line[(x + r + 1) % w] - line[(x + w - r) % w];
        }
    });
    let mut out = vec![0f32; w * h];
    // colunas: em blocos de linhas para usar todos os núcleos
    let cols: Vec<Vec<f32>> = (0..w)
        .into_par_iter()
        .map(|x| {
            let col: Vec<f32> = (0..h).map(|y| tmp[y * w + x]).collect();
            let mut acc: f32 = (0..=2 * r).map(|i| col[(i + h - r) % h]).sum();
            let mut res = vec![0f32; h];
            for (y, v) in res.iter_mut().enumerate() {
                *v = acc / win;
                acc += col[(y + r + 1) % h] - col[(y + h - r) % h];
            }
            res
        })
        .collect();
    for (x, col) in cols.into_iter().enumerate() {
        for (y, v) in col.into_iter().enumerate() {
            out[y * w + x] = v;
        }
    }
    out
}

/// Aplica o acabamento do Remaster numa textura já ampliada.
pub fn apply_look(img: &mut Rgba, look: Look) {
    let (w, h) = (img.width as usize, img.height as usize);
    if w < 8 || h < 8 {
        return;
    }
    if look.depth > 1.001 {
        // mapa de normal: inclinação maior, vetor de volta ao comprimento 1 (DXT5nm fica como está)
        let n = (w * h) as f32;
        let mean_r = img.pixels.chunks_exact(4).map(|p| p[0] as f32).sum::<f32>() / n;
        let var_r = img.pixels.chunks_exact(4).map(|p| (p[0] as f32 - mean_r).powi(2)).sum::<f32>() / n;
        if var_r < 4.0 {
            return;
        }
        img.pixels.par_chunks_exact_mut(4).for_each(|p| {
            let x = (p[0] as f32 / 127.5 - 1.0) * look.depth;
            let y = (p[1] as f32 / 127.5 - 1.0) * look.depth;
            let z = (p[2] as f32 / 127.5 - 1.0).max(0.05);
            let len = (x * x + y * y + z * z).sqrt();
            p[0] = ((x / len + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8;
            p[1] = ((y / len + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8;
            p[2] = ((z / len + 1.0) * 127.5).round().clamp(0.0, 255.0) as u8;
        });
        return;
    }
    let luma: Vec<f32> = img
        .pixels
        .chunks_exact(4)
        .map(|p| (p[0] as f32 * 0.2126 + p[1] as f32 * 0.7152 + p[2] as f32 * 0.0722) / 255.0)
        .collect();
    // contraste local em duas escalas: a larga dá volume às formas, a fina define o detalhe
    let blur = if look.clarity > 0.0 {
        let r = ((w.min(h) as f32) * look.radius).round().max(2.0) as usize;
        let fine = (r / 5).max(1);
        Some((box_blur_wrap(&luma, w, h, r), box_blur_wrap(&luma, w, h, fine)))
    } else {
        None
    };
    img.pixels.par_chunks_exact_mut(4).enumerate().for_each(|(i, p)| {
        let l = luma[i];
        let mut target = l;
        if let Some((coarse, fine)) = &blur {
            // contraste local limitado (sem halos) e mais fraco nos extremos (sem estourar)
            let d = ((l - coarse[i]) * look.clarity).clamp(-0.16, 0.16) + ((l - fine[i]) * look.clarity * 0.8).clamp(-0.08, 0.08);
            target += d * (1.0 - (2.0 * l - 1.0).powi(2));
        }
        if look.curve > 0.0 {
            let t = target.clamp(0.0, 1.0);
            let s = t * t * (3.0 - 2.0 * t);
            target = t + (s - t) * look.curve;
        }
        if look.lift > 0.0 {
            // mais luz nos tons médios (os extremos ficam)
            target += look.lift * 4.0 * target * (1.0 - target);
        }
        let ratio = if l > 1e-3 { target / l } else { 1.0 };
        let rgb = [p[0] as f32 / 255.0 * ratio, p[1] as f32 / 255.0 * ratio, p[2] as f32 / 255.0 * ratio];
        let lum = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        let (mx, mn) = (rgb[0].max(rgb[1]).max(rgb[2]), rgb[0].min(rgb[1]).min(rgb[2]));
        let sat = if mx > 1e-3 { (mx - mn) / mx } else { 0.0 };
        // vivacidade: mais nas cores apagadas, nada nos cinzas puros (metal e cor do time ficam)
        let vib = look.vibrance * (1.0 - sat) * (sat * 6.0).min(1.0);
        // tom dividido: sombras puxam para o azul-petróleo, luzes para o âmbar (só onde já há cor)
        let tint = if look.split > 0.0 {
            let w = look.split * (sat * 4.0).min(1.0);
            let shadow = (1.0 - lum * 2.0).max(0.0) * w;
            let light = (lum * 2.0 - 1.0).max(0.0) * w;
            [light * 0.5 - shadow * 0.5, light * 0.15 + shadow * 0.1, shadow * 0.6 - light * 0.4]
        } else {
            [0.0; 3]
        };
        for c in 0..3 {
            let v = lum + (rgb[c] - lum) * (1.0 + vib) + tint[c] * 0.25;
            p[c] = (v * 255.0).round().clamp(0.0, 255.0) as u8;
        }
    });
}

// ------------------------------------------------------------------ geração do mod

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhanceResult {
    pub archive: PathBuf,
    pub upscaled: usize,
    pub sharpened: usize,
    pub unchanged: usize,
    pub failed: Vec<String>,
    pub bytes_before: u64,
    pub bytes_after: u64,
}

/// Processa todas as texturas dos grupos escolhidos e grava um `.scd` só com as alteradas.
pub fn build(
    sources: &[PathBuf],
    opts: &EnhanceOptions,
    dest: &Path,
    progress: &mut dyn FnMut(usize, usize, &str),
) -> Result<EnhanceResult> {
    let todo: Vec<_> = texture_entries(sources)?
        .into_iter()
        .filter_map(|t| {
            let mode = mode_for(opts, &group_of(&t.key));
            (mode != Mode::Skip).then_some((t, mode))
        })
        .collect();
    if todo.is_empty() {
        return Err(Error::Other("nenhuma textura selecionada".into()));
    }
    let total = todo.len();
    let mut b = ScdBuilder::create(dest)?;
    let mut res = EnhanceResult {
        archive: PathBuf::new(),
        upscaled: 0,
        sharpened: 0,
        unchanged: 0,
        failed: vec![],
        bytes_before: 0,
        bytes_after: 0,
    };
    let mut open: Option<(PathBuf, Scd)> = None;
    let mut done = 0;
    // lotes: lê em sequência (o .scd não é compartilhável), processa em paralelo, grava em ordem
    for batch in todo.chunks(32) {
        let mut raw = Vec::with_capacity(batch.len());
        for (t, mode) in batch {
            if open.as_ref().map(|(p, _)| p != &t.src).unwrap_or(true) {
                open = Some((t.src.clone(), Scd::open(&t.src)?));
            }
            let data = open.as_mut().expect("aberto").1.read_at(t.index)?;
            raw.push((t.name.clone(), t.key.clone(), data, *mode));
        }
        let processed: Vec<_> = raw
            .par_iter()
            .map(|(name, key, data, mode)| (name, data.len(), *mode, enhance_dds(key, data, *mode, opts)))
            .collect();
        for (name, before, mode, r) in processed {
            done += 1;
            progress(done, total, name);
            match r {
                Ok(Some(bytes)) => {
                    res.bytes_before += before as u64;
                    res.bytes_after += bytes.len() as u64;
                    b.add_bytes(name, &bytes)?;
                    if mode == Mode::Upscale && bytes.len() > before {
                        res.upscaled += 1;
                    } else {
                        res.sharpened += 1;
                    }
                }
                Ok(None) => res.unchanged += 1,
                Err(e) => res.failed.push(format!("{name}: {e}")),
            }
        }
    }
    if res.upscaled + res.sharpened == 0 {
        return Err(Error::Other("nenhuma textura precisou de mudança".into()));
    }
    res.archive = b.finish()?;
    Ok(res)
}

/// (original em PNG, melhorada em PNG, cabeçalho do original, tamanho final)
pub type Preview = (Vec<u8>, Vec<u8>, DdsInfo, (u32, u32));

/// Prévia lado a lado de uma textura: (original, melhorada) em PNG, no tamanho final.
pub fn preview(key: &str, data: &[u8], mode: Mode, opts: &EnhanceOptions) -> Result<Preview> {
    let (info, img) = dds::decode(data)?;
    let class = classify(key, &info);
    let mode = effective_mode(key, &info, mode);
    let (tw, th) = if class == TextureClass::Skip {
        (info.width, info.height)
    } else {
        target_size(info.width, info.height, mode, opts)
    };
    let after = if class == TextureClass::Skip || mode == Mode::Skip {
        img.clone()
    } else {
        let mut out = enhance_image(&img, class, tw, th, info.format, opts);
        if let Some(look) = look_of(key, class, opts) {
            apply_look(&mut out, look);
        }
        out
    };
    // original ampliado só com "vizinho mais próximo", para comparar no mesmo tamanho
    let before = if (tw, th) != (img.width, img.height) {
        let src = image::RgbaImage::from_raw(img.width, img.height, img.pixels.clone()).expect("tamanho coerente");
        let up = image::imageops::resize(&src, tw, th, image::imageops::FilterType::Nearest);
        Rgba {
            width: tw,
            height: th,
            pixels: up.into_raw(),
        }
    } else {
        img
    };
    Ok((dds::to_png(&before)?, dds::to_png(&after)?, info, (tw, th)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Textura procedural com detalhe fino (chapas metálicas, rebites, ruído e texto).
    fn ground_truth(size: u32) -> Rgba {
        let mut px = Vec::with_capacity((size * size * 4) as usize);
        let mut seed = 12345u32;
        let mut rnd = || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            (seed % 1000) as f32 / 1000.0
        };
        for y in 0..size {
            for x in 0..size {
                let panel = ((x / 37 + y / 53) % 3) as f32 * 18.0;
                let seam = if x % 37 == 0 || y % 53 == 0 { -55.0 } else { 0.0 };
                let (rx, ry) = ((x % 37) as f32 - 5.0, (y % 53) as f32 - 5.0);
                let rivet = if rx * rx + ry * ry < 5.0 { 60.0 } else { 0.0 };
                let stripe = if (x + y) % 23 < 3 { 25.0 } else { 0.0 };
                let n = rnd() * 14.0;
                let v = 95.0 + panel + seam + rivet + stripe + n;
                px.extend_from_slice(&[(v * 0.92) as u8, (v * 0.95) as u8, v.min(255.0) as u8, 255]);
            }
        }
        Rgba {
            width: size,
            height: size,
            pixels: px,
        }
    }

    fn psnr(a: &Rgba, b: &Rgba) -> f64 {
        let mse: f64 = a
            .pixels
            .chunks_exact(4)
            .zip(b.pixels.chunks_exact(4))
            .map(|(p, q)| (0..3).map(|c| (p[c] as f64 - q[c] as f64).powi(2)).sum::<f64>())
            .sum::<f64>()
            / (a.pixels.len() as f64 / 4.0 * 3.0);
        10.0 * (255.0f64.powi(2) / mse.max(1e-9)).log10()
    }

    fn bilinear(img: &Rgba, w: u32, h: u32) -> Rgba {
        let src = image::RgbaImage::from_raw(img.width, img.height, img.pixels.clone()).unwrap();
        Rgba {
            width: w,
            height: h,
            pixels: image::imageops::resize(&src, w, h, image::imageops::FilterType::Triangle).into_raw(),
        }
    }

    #[test]
    fn beats_bilinear_on_compressed_texture() {
        // original em alta → reduz 2x → DXT1 (como as texturas do jogo) → melhora de volta
        let gt = ground_truth(256);
        let low = dds::downsample(&gt);
        let dxt = dds::encode(&low, DdsFormat::Dxt1, 1, Quality::Normal).unwrap();
        let (_, decoded) = dds::decode(&dxt).unwrap();
        let opts = EnhanceOptions::default();
        let ours = enhance_image(&decoded, TextureClass::Color, 256, 256, DdsFormat::Dxt1, &opts);
        let base = bilinear(&decoded, 256, 256);
        let (p_ours, p_base) = (psnr(&ours, &gt), psnr(&base, &gt));
        assert!(
            p_ours > p_base,
            "melhorado {p_ours:.2} dB deveria superar bilinear {p_base:.2} dB"
        );
    }

    #[test]
    fn upscale_has_no_ringing_and_keeps_alpha_edges() {
        // borda dura preto/branco: Lanczos puro geraria valores fora de [0,255] (halos)
        let mut px = Vec::new();
        for _y in 0..16 {
            for x in 0..16 {
                let v = if x < 8 { 0 } else { 255 };
                px.extend_from_slice(&[v, v, v, if x < 4 { 0 } else { 255 }]);
            }
        }
        let img = Rgba {
            width: 16,
            height: 16,
            pixels: px,
        };
        let out = enhance_image(
            &img,
            TextureClass::Color,
            32,
            32,
            DdsFormat::Dxt1,
            &EnhanceOptions::default(),
        );
        assert_eq!((out.width, out.height), (32, 32));
        // a linha da metade esquerda opaca continua preta e a direita branca (sem sobra/halo)
        let row = &out.pixels[(16 * 32 * 4) as usize..(17 * 32 * 4) as usize];
        assert!(row[10 * 4] < 10 && row[30 * 4] > 245);
        // alfa binário continua binário
        assert!(out.pixels.chunks_exact(4).all(|p| p[3] == 0 || p[3] == 255));
    }

    #[test]
    fn classifies_and_sizes() {
        let info = |w, f| DdsInfo {
            width: w,
            height: w,
            mip_count: 1,
            format: f,
            is_cubemap: false,
            is_volume: false,
        };
        assert_eq!(
            classify("/units/uel0101/uel0101_albedo.dds", &info(512, DdsFormat::Dxt1)),
            TextureClass::Color
        );
        assert_eq!(
            classify("/units/uel0101/uel0101_normalsts.dds", &info(512, DdsFormat::Dxt5)),
            TextureClass::Normal
        );
        assert_eq!(
            classify("/units/uel0101/uel0101_specteam.dds", &info(512, DdsFormat::Dxt5)),
            TextureClass::Data
        );
        assert_eq!(
            classify("/textures/environment/ramp_sky.dds", &info(256, DdsFormat::Bgra8)),
            TextureClass::Skip
        );
        assert_eq!(group_of("/textures/ui/common/game/bg.dds"), "/textures/ui/");
        assert_eq!(group_of("/units/uel0101/a.dds"), "/units/");
        assert_eq!(default_mode("/textures/ui/"), Mode::Sharpen);
        assert_eq!(default_mode("/units/"), Mode::Upscale);
        let o = EnhanceOptions::default();
        assert_eq!(target_size(512, 256, Mode::Upscale, &o), (1024, 512));
        assert_eq!(target_size(2048, 2048, Mode::Upscale, &o), (2048, 2048));
        assert_eq!(
            target_size(
                1024,
                512,
                Mode::Upscale,
                &EnhanceOptions {
                    max_size: 1024,
                    ..o.clone()
                }
            ),
            (1024, 512)
        );
        assert_eq!(target_size(512, 512, Mode::Sharpen, &o), (512, 512));
    }

    #[test]
    fn never_touches_engine_data_nor_grows_screen_icons() {
        let info = |w, mips, volume| DdsInfo {
            width: w,
            height: w,
            mip_count: mips,
            format: DdsFormat::Dxt5,
            is_cubemap: false,
            is_volume: volume,
        };
        // tabelas de cor 3D e iluminação dos mapas (deixavam o jogo todo verde)
        for k in [
            "/textures/ColorCorrection/SC2_U01_Fog_001.ccc.win.dds",
            "/maps/SC2_MP_002/lighting/pcloud_up.win.dds",
            "/maps/SC2_MP_204/lighting/RNM_MP_204_A_0.win.dds",
            "/textures/Engine/waves.win.dds",
        ] {
            assert_eq!(classify(k, &info(256, 9, false)), TextureClass::Skip, "{k}");
        }
        assert_eq!(classify("/units/x/x_albedo.dds", &info(32, 1, true)), TextureClass::Skip);
        // ícones e marcadores desenhados em pixels não crescem (o "Ma" gigante)
        for k in [
            "/textures/Splats/mass_strategic.dds",
            "/textures/selection_bracket_player_sm.dds",
            "/maps/SC2_MP_002/SC2_MP_002_ui_mapimage.dds",
            "/textures/ui/common/game/strategicicons/icon_structure_mass_rest.dds",
        ] {
            assert_eq!(effective_mode(k, &info(64, 7, false), Mode::Upscale), Mode::Sharpen, "{k}");
        }
        // sem mipmaps: desenhada na tela
        assert_eq!(effective_mode("/props/x/x_albedo.dds", &info(256, 1, false), Mode::Upscale), Mode::Sharpen);
        // textura 3D de unidade continua sendo ampliada
        assert_eq!(effective_mode("/units/uef/uul0001/uul0001_albedo.dds", &info(512, 10, false), Mode::Upscale), Mode::Upscale);
    }

    #[test]
    fn reads_volume_flag_from_header() {
        let mut d = vec![0u8; 128];
        d[0..4].copy_from_slice(b"DDS ");
        d[4..8].copy_from_slice(&124u32.to_le_bytes());
        d[8..12].copy_from_slice(&(0x1007u32 | 0x80_0000).to_le_bytes());
        d[12..16].copy_from_slice(&32u32.to_le_bytes());
        d[16..20].copy_from_slice(&32u32.to_le_bytes());
        d[24..28].copy_from_slice(&32u32.to_le_bytes());
        d[76..80].copy_from_slice(&32u32.to_le_bytes());
        d[80..84].copy_from_slice(&0x41u32.to_le_bytes());
        d[88..92].copy_from_slice(&32u32.to_le_bytes());
        d[92..96].copy_from_slice(&0xff0000u32.to_le_bytes());
        d[104..108].copy_from_slice(&0xff000000u32.to_le_bytes());
        d[112..116].copy_from_slice(&0x20_0000u32.to_le_bytes());
        let i = dds::info(&d).unwrap();
        assert!(i.is_volume);
    }

    #[test]
    fn builds_mod_with_only_changed_textures() {
        let tmp = tempfile::tempdir().unwrap();
        let gt = ground_truth(64);
        let dxt = dds::encode(&gt, DdsFormat::Dxt1, 0, Quality::Fast).unwrap();
        let src = tmp.path().join("textures.scd");
        crate::library::tests::make_scd(
            &src,
            &[
                ("units/a/a_albedo.dds", &dxt),
                ("textures/ui/common/b.dds", &dxt),
                ("textures/environment/ramp.dds", &dxt),
                ("lua/x.lua", b"print(1)"),
            ],
        );
        let dest = tmp.path().join("out/zz_hd.scd");
        let g = groups(std::slice::from_ref(&src)).unwrap();
        let units = g.iter().find(|x| x.group == "/units/").unwrap();
        assert_eq!(
            units.buckets,
            vec![SizeBucket {
                width: 64,
                height: 64,
                format: "dxt1".into(),
                mipmaps: true,
                skip: false,
                keep_size: false,
                count: 1
            }]
        );
        assert!(g.iter().find(|x| x.group == "/textures/environment/").unwrap().buckets[0].skip);
        let r = build(&[src], &EnhanceOptions::default(), &dest, &mut |_, _, _| {}).unwrap();
        assert_eq!((r.upscaled, r.sharpened, r.unchanged), (1, 1, 1));
        let mut scd = Scd::open(&dest).unwrap();
        let a = dds::info(&scd.read("units/a/a_albedo.dds").unwrap()).unwrap();
        assert_eq!((a.width, a.format, a.mip_count), (128, DdsFormat::Dxt1, 8));
        let b = dds::info(&scd.read("textures/ui/common/b.dds").unwrap()).unwrap();
        assert_eq!(b.width, 64, "interface mantém o tamanho");
        assert!(
            scd.read("textures/environment/ramp.dds").is_err(),
            "rampas não entram no mod"
        );
    }

    #[test]
    fn remaster_styles_and_mix() {
        let mut o = EnhanceOptions::default();
        let k = "/textures/terrain/a/grass_d.dds";
        let base = look_of(k, TextureClass::Color, &o).unwrap();
        assert!(base.clarity > 0.0 && base.split == 0.0);
        o.style = Style::Vivid;
        let vivid = look_of(k, TextureClass::Color, &o).unwrap();
        assert!(vivid.vibrance > base.vibrance && vivid.lift > 0.0);
        o.style = Style::Cinematic;
        let cine = look_of(k, TextureClass::Color, &o).unwrap();
        assert!(cine.curve > base.curve && cine.split > 0.0);
        // a interface nunca ganha tom
        assert_eq!(look_of("/textures/ui/common/x.dds", TextureClass::Color, &o).unwrap().split, 0.0);
        o.mix.ground = 0.0;
        assert!(look_of(k, TextureClass::Color, &o).is_none());
        assert!(look_of("/units/uef/a/a_diffuse.dds", TextureClass::Color, &o).is_some());
        assert_eq!(surface_of("/env/tropical/props/palm01_albedo.dds"), "nature");
        // o tom não muda pixels cinzas (metal e cor do time)
        let mut gray = Rgba { width: 16, height: 16, pixels: [100u8, 100, 100, 255].repeat(256) };
        apply_look(&mut gray, Look { split: 0.1, ..cine });
        assert!(gray.pixels.chunks_exact(4).all(|p| p[0] == p[1] && p[1] == p[2]));
    }

    /// Prévia do Remaster (`CP_REMASTER_SOURCES` = pasta com .scd; `CP_REMASTER_KEYS` = caminhos
    /// separados por vírgula; `CP_REMASTER_OUT` = pasta das PNG lado a lado).
    #[test]
    fn remaster_preview() {
        let (Some(dir), Some(keys), Some(out)) = (std::env::var_os("CP_REMASTER_SOURCES"), std::env::var("CP_REMASTER_KEYS").ok(), std::env::var_os("CP_REMASTER_OUT")) else { return };
        let mut sources: Vec<PathBuf> = std::fs::read_dir(dir).unwrap().filter_map(|e| e.ok().map(|e| e.path())).collect();
        sources.sort();
        let out = PathBuf::from(out);
        let opts = EnhanceOptions::default();
        for key in keys.split(',') {
            let data = crate::mapassets::read_game_file(&sources, key).unwrap();
            let (before, after, _, _) = preview(key, &data, Mode::Upscale, &opts).unwrap();
            let name = key.rsplit('/').next().unwrap().replace(".dds", "");
            std::fs::write(out.join(format!("{name}_antes.png")), before).unwrap();
            std::fs::write(out.join(format!("{name}_depois.png")), after).unwrap();
        }
    }
}