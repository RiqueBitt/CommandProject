//! Texturas DDS: leitura (DXT1/DXT3/DXT5/ATI1/ATI2 e RGB(A) sem compressão) e escrita
//! com cadeia completa de mipmaps. É o que o Estúdio usa para editar texturas e HUD.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use texpresso::{Algorithm, Format, Params};

const MAGIC: &[u8; 4] = b"DDS ";
const DDSD_CAPS: u32 = 0x1;
const DDSD_HEIGHT: u32 = 0x2;
const DDSD_WIDTH: u32 = 0x4;
const DDSD_PITCH: u32 = 0x8;
const DDSD_PIXELFORMAT: u32 = 0x1000;
const DDSD_MIPMAPCOUNT: u32 = 0x20000;
const DDSD_LINEARSIZE: u32 = 0x80000;
const DDPF_ALPHAPIXELS: u32 = 0x1;
const DDPF_FOURCC: u32 = 0x4;
const DDPF_RGB: u32 = 0x40;
const DDPF_LUMINANCE: u32 = 0x20000;
const DDSCAPS_COMPLEX: u32 = 0x8;
const DDSCAPS_TEXTURE: u32 = 0x1000;
const DDSCAPS_MIPMAP: u32 = 0x400000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DdsFormat {
    Dxt1,
    Dxt3,
    Dxt5,
    Ati1,
    Ati2,
    /// 32 bits B8G8R8A8 (A8R8G8B8 no D3D9)
    Bgra8,
    /// 32 bits sem alfa útil
    Bgrx8,
    /// 24 bits B8G8R8
    Bgr8,
    /// 16 bits R5G6B5
    Rgb565,
    /// 8 bits luminância
    L8,
}

impl DdsFormat {
    fn compressed(self) -> Option<Format> {
        match self {
            DdsFormat::Dxt1 => Some(Format::Bc1),
            DdsFormat::Dxt3 => Some(Format::Bc2),
            DdsFormat::Dxt5 => Some(Format::Bc3),
            DdsFormat::Ati1 => Some(Format::Bc4),
            DdsFormat::Ati2 => Some(Format::Bc5),
            _ => None,
        }
    }
    fn bytes_per_pixel(self) -> usize {
        match self {
            DdsFormat::Bgra8 | DdsFormat::Bgrx8 => 4,
            DdsFormat::Bgr8 => 3,
            DdsFormat::Rgb565 => 2,
            DdsFormat::L8 => 1,
            _ => 0,
        }
    }
    pub fn has_alpha(self) -> bool {
        matches!(self, DdsFormat::Dxt3 | DdsFormat::Dxt5 | DdsFormat::Bgra8)
    }
    /// Tamanho em bytes de um nível de mip.
    pub fn level_size(self, w: u32, h: u32) -> usize {
        match self.compressed() {
            Some(f) => f.compressed_size(w.max(1) as usize, h.max(1) as usize),
            None => w.max(1) as usize * h.max(1) as usize * self.bytes_per_pixel(),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DdsInfo {
    pub width: u32,
    pub height: u32,
    pub mip_count: u32,
    pub format: DdsFormat,
    pub is_cubemap: bool,
    pub is_volume: bool,
}

/// Imagem RGBA8 em memória.
#[derive(Debug, Clone, PartialEq)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

fn u32_at(d: &[u8], off: usize) -> u32 {
    u32::from_le_bytes(d[off..off + 4].try_into().unwrap())
}

pub fn info(data: &[u8]) -> Result<DdsInfo> {
    if data.len() < 128 || &data[0..4] != MAGIC {
        return Err(Error::Format("não é um arquivo DDS".into()));
    }
    let height = u32_at(data, 12);
    let width = u32_at(data, 16);
    let mip_count = u32_at(data, 28).max(1);
    let pf_flags = u32_at(data, 80);
    let fourcc = &data[84..88];
    let bits = u32_at(data, 88);
    let rmask = u32_at(data, 92);
    let amask = u32_at(data, 104);
    let caps2 = u32_at(data, 112);
    let format = if pf_flags & DDPF_FOURCC != 0 {
        match fourcc {
            b"DXT1" => DdsFormat::Dxt1,
            b"DXT2" | b"DXT3" => DdsFormat::Dxt3,
            b"DXT4" | b"DXT5" => DdsFormat::Dxt5,
            b"ATI1" | b"BC4U" => DdsFormat::Ati1,
            b"ATI2" | b"BC5U" => DdsFormat::Ati2,
            b"DX10" => return Err(Error::Format("DDS DX10 (BC6/BC7) ainda não é suportado".into())),
            other => {
                return Err(Error::Format(format!(
                    "formato DDS não suportado: {}",
                    String::from_utf8_lossy(other)
                )))
            }
        }
    } else if pf_flags & DDPF_RGB != 0 {
        match (bits, rmask, amask) {
            (32, 0x00ff_0000, a) if a != 0 && pf_flags & DDPF_ALPHAPIXELS != 0 => DdsFormat::Bgra8,
            (32, 0x00ff_0000, _) => DdsFormat::Bgrx8,
            (24, 0x00ff_0000, _) => DdsFormat::Bgr8,
            (16, 0xf800, _) => DdsFormat::Rgb565,
            _ => {
                return Err(Error::Format(format!(
                    "DDS RGB de {bits} bits com máscara {rmask:#x} não suportado"
                )))
            }
        }
    } else if pf_flags & DDPF_LUMINANCE != 0 && bits == 8 {
        DdsFormat::L8
    } else {
        return Err(Error::Format("formato de pixel DDS desconhecido".into()));
    };
    if width == 0 || height == 0 || width > 16384 || height > 16384 {
        return Err(Error::Format("dimensões DDS inválidas".into()));
    }
    Ok(DdsInfo {
        width,
        height,
        mip_count,
        format,
        is_cubemap: caps2 & 0x200 != 0,
        // textura 3D (tabelas de cor .ccc e nuvens de luz pcloud): só a 1ª fatia seria lida
        is_volume: caps2 & 0x20_0000 != 0 || (u32_at(data, 8) & 0x80_0000 != 0 && u32_at(data, 24) > 1),
    })
}

/// Decodifica o maior nível de mip para RGBA8.
pub fn decode(data: &[u8]) -> Result<(DdsInfo, Rgba)> {
    let info = info(data)?;
    let (w, h) = (info.width as usize, info.height as usize);
    let need = info.format.level_size(info.width, info.height);
    let body = data
        .get(128..128 + need)
        .ok_or_else(|| Error::Format("DDS truncado".into()))?;
    let mut px = vec![0u8; w * h * 4];
    match info.format.compressed() {
        Some(f) => f.decompress(body, w, h, &mut px),
        None => {
            let bpp = info.format.bytes_per_pixel();
            for i in 0..w * h {
                let s = &body[i * bpp..i * bpp + bpp];
                let o = &mut px[i * 4..i * 4 + 4];
                match info.format {
                    DdsFormat::Bgra8 => o.copy_from_slice(&[s[2], s[1], s[0], s[3]]),
                    DdsFormat::Bgrx8 => o.copy_from_slice(&[s[2], s[1], s[0], 255]),
                    DdsFormat::Bgr8 => o.copy_from_slice(&[s[2], s[1], s[0], 255]),
                    DdsFormat::Rgb565 => {
                        let v = u16::from_le_bytes([s[0], s[1]]);
                        let r = ((v >> 11) & 0x1f) as u8;
                        let g = ((v >> 5) & 0x3f) as u8;
                        let b = (v & 0x1f) as u8;
                        o.copy_from_slice(&[(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2), 255]);
                    }
                    DdsFormat::L8 => o.copy_from_slice(&[s[0], s[0], s[0], 255]),
                    _ => unreachable!(),
                }
            }
        }
    }
    // BC4/BC5 decodificam para R/RG; mostre-os em tons de cinza / normal map
    if info.format == DdsFormat::Ati1 {
        for p in px.chunks_exact_mut(4) {
            p[1] = p[0];
            p[2] = p[0];
            p[3] = 255;
        }
    }
    Ok((
        info.clone(),
        Rgba {
            width: info.width,
            height: info.height,
            pixels: px,
        },
    ))
}

/// Qualidade de compressão.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum Quality {
    Fast,
    #[default]
    Normal,
    Best,
}

/// Codifica RGBA8 em DDS no formato pedido, com `mips` níveis (0 = cadeia completa).
pub fn encode(img: &Rgba, format: DdsFormat, mips: u32, quality: Quality) -> Result<Vec<u8>> {
    if img.width == 0 || img.height == 0 || img.pixels.len() != (img.width * img.height * 4) as usize {
        return Err(Error::Format("imagem RGBA inválida".into()));
    }
    let full = 32 - img.width.max(img.height).leading_zeros();
    let levels = if mips == 0 { full } else { mips.min(full) };
    let mut out = Vec::new();
    write_header(&mut out, img.width, img.height, levels, format);
    let params = Params {
        algorithm: match quality {
            Quality::Fast => Algorithm::RangeFit,
            Quality::Normal => Algorithm::ClusterFit,
            Quality::Best => Algorithm::IterativeClusterFit,
        },
        weigh_colour_by_alpha: format.has_alpha(),
        ..Params::default()
    };
    let mut level = img.clone();
    for i in 0..levels {
        if i > 0 {
            level = downsample(&level);
        }
        let (w, h) = (level.width as usize, level.height as usize);
        match format.compressed() {
            Some(f) => {
                let mut buf = vec![0u8; f.compressed_size(w, h)];
                f.compress(&level.pixels, w, h, params, &mut buf);
                out.extend_from_slice(&buf);
            }
            None => {
                for p in level.pixels.chunks_exact(4) {
                    match format {
                        DdsFormat::Bgra8 => out.extend_from_slice(&[p[2], p[1], p[0], p[3]]),
                        DdsFormat::Bgrx8 => out.extend_from_slice(&[p[2], p[1], p[0], 255]),
                        DdsFormat::Bgr8 => out.extend_from_slice(&[p[2], p[1], p[0]]),
                        DdsFormat::Rgb565 => {
                            let v = ((p[0] as u16 >> 3) << 11) | ((p[1] as u16 >> 2) << 5) | (p[2] as u16 >> 3);
                            out.extend_from_slice(&v.to_le_bytes());
                        }
                        DdsFormat::L8 => {
                            let l = (p[0] as u32 * 54 + p[1] as u32 * 183 + p[2] as u32 * 19) >> 8;
                            out.push(l as u8);
                        }
                        _ => unreachable!(),
                    }
                }
            }
        }
    }
    Ok(out)
}

fn write_header(out: &mut Vec<u8>, w: u32, h: u32, mips: u32, format: DdsFormat) {
    let mut hdr = [0u32; 31];
    let mut flags = DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT;
    if mips > 1 {
        flags |= DDSD_MIPMAPCOUNT;
    }
    let (pitch_or_linear, pf_flags, fourcc, bits, masks): (u32, u32, &[u8; 4], u32, [u32; 4]) = match format {
        DdsFormat::Dxt1 => (format.level_size(w, h) as u32, DDPF_FOURCC, b"DXT1", 0, [0; 4]),
        DdsFormat::Dxt3 => (format.level_size(w, h) as u32, DDPF_FOURCC, b"DXT3", 0, [0; 4]),
        DdsFormat::Dxt5 => (format.level_size(w, h) as u32, DDPF_FOURCC, b"DXT5", 0, [0; 4]),
        DdsFormat::Ati1 => (format.level_size(w, h) as u32, DDPF_FOURCC, b"ATI1", 0, [0; 4]),
        DdsFormat::Ati2 => (format.level_size(w, h) as u32, DDPF_FOURCC, b"ATI2", 0, [0; 4]),
        DdsFormat::Bgra8 => (
            w * 4,
            DDPF_RGB | DDPF_ALPHAPIXELS,
            &[0; 4],
            32,
            [0xff0000, 0xff00, 0xff, 0xff00_0000],
        ),
        DdsFormat::Bgrx8 => (w * 4, DDPF_RGB, &[0; 4], 32, [0xff0000, 0xff00, 0xff, 0]),
        DdsFormat::Bgr8 => (w * 3, DDPF_RGB, &[0; 4], 24, [0xff0000, 0xff00, 0xff, 0]),
        DdsFormat::Rgb565 => (w * 2, DDPF_RGB, &[0; 4], 16, [0xf800, 0x07e0, 0x001f, 0]),
        DdsFormat::L8 => (w, DDPF_LUMINANCE, &[0; 4], 8, [0xff, 0, 0, 0]),
    };
    flags |= if format.compressed().is_some() {
        DDSD_LINEARSIZE
    } else {
        DDSD_PITCH
    };
    hdr[0] = 124;
    hdr[1] = flags;
    hdr[2] = h;
    hdr[3] = w;
    hdr[4] = pitch_or_linear;
    hdr[6] = mips;
    // pixel format em hdr[18..26]
    hdr[18] = 32;
    hdr[19] = pf_flags;
    hdr[20] = u32::from_le_bytes(*fourcc);
    hdr[21] = bits;
    hdr[22] = masks[0];
    hdr[23] = masks[1];
    hdr[24] = masks[2];
    hdr[25] = masks[3];
    hdr[26] = DDSCAPS_TEXTURE | if mips > 1 { DDSCAPS_COMPLEX | DDSCAPS_MIPMAP } else { 0 };
    out.extend_from_slice(MAGIC);
    for v in hdr {
        out.extend_from_slice(&v.to_le_bytes());
    }
}

/// Reduz pela metade com filtro de caixa 2x2 (alfa pré-multiplicado para não "sujar" bordas).
pub fn downsample(img: &Rgba) -> Rgba {
    let nw = (img.width / 2).max(1);
    let nh = (img.height / 2).max(1);
    let mut px = vec![0u8; (nw * nh * 4) as usize];
    for y in 0..nh {
        for x in 0..nw {
            let mut acc = [0u32; 4];
            for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                let sx = (x * 2 + dx).min(img.width - 1);
                let sy = (y * 2 + dy).min(img.height - 1);
                let i = ((sy * img.width + sx) * 4) as usize;
                let a = img.pixels[i + 3] as u32;
                acc[0] += img.pixels[i] as u32 * a;
                acc[1] += img.pixels[i + 1] as u32 * a;
                acc[2] += img.pixels[i + 2] as u32 * a;
                acc[3] += a;
            }
            let o = ((y * nw + x) * 4) as usize;
            if let (Some(r), Some(g), Some(b)) = (
                acc[0].checked_div(acc[3]),
                acc[1].checked_div(acc[3]),
                acc[2].checked_div(acc[3]),
            ) {
                px[o] = r as u8;
                px[o + 1] = g as u8;
                px[o + 2] = b as u8;
            }
            px[o + 3] = (acc[3] / 4) as u8;
        }
    }
    Rgba {
        width: nw,
        height: nh,
        pixels: px,
    }
}

pub fn to_png(img: &Rgba) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let enc = image::codecs::png::PngEncoder::new(&mut out);
    image::ImageEncoder::write_image(enc, &img.pixels, img.width, img.height, image::ExtendedColorType::Rgba8)
        .map_err(|e| Error::Format(e.to_string()))?;
    Ok(out)
}

pub fn from_png(data: &[u8]) -> Result<Rgba> {
    let img = image::load_from_memory_with_format(data, image::ImageFormat::Png)
        .map_err(|e| Error::Format(format!("PNG inválido: {e}")))?
        .to_rgba8();
    Ok(Rgba {
        width: img.width(),
        height: img.height(),
        pixels: img.into_raw(),
    })
}

/// Reamostra (bilinear) — usado quando a imagem importada tem tamanho diferente do original.
pub fn resize(img: &Rgba, w: u32, h: u32) -> Rgba {
    let src = image::RgbaImage::from_raw(img.width, img.height, img.pixels.clone()).expect("tamanho coerente");
    let out = image::imageops::resize(&src, w, h, image::imageops::FilterType::Triangle);
    Rgba {
        width: w,
        height: h,
        pixels: out.into_raw(),
    }
}

/// Ajustes de cor aplicados pelo editor de texturas e pela "skin de interface".
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ColorAdjust {
    /// Rotação de matiz em graus (-180..180).
    pub hue: f32,
    /// Multiplicador de saturação (1 = igual).
    pub saturation: f32,
    /// Multiplicador de brilho (1 = igual).
    pub brightness: f32,
    /// Contraste (1 = igual).
    pub contrast: f32,
    /// Cor de tingimento #RRGGBB e intensidade (0..1).
    pub tint: Option<[u8; 3]>,
    pub tint_strength: f32,
}

impl ColorAdjust {
    pub fn identity() -> Self {
        ColorAdjust {
            hue: 0.0,
            saturation: 1.0,
            brightness: 1.0,
            contrast: 1.0,
            tint: None,
            tint_strength: 0.0,
        }
    }
    pub fn is_identity(&self) -> bool {
        self.hue == 0.0
            && self.saturation == 1.0
            && self.brightness == 1.0
            && self.contrast == 1.0
            && (self.tint.is_none() || self.tint_strength == 0.0)
    }
}

pub fn adjust(img: &mut Rgba, a: &ColorAdjust) {
    let sat = if a.saturation == 0.0 && a.brightness == 0.0 {
        1.0
    } else {
        a.saturation
    };
    let bri = if a.brightness == 0.0 { 1.0 } else { a.brightness };
    let con = if a.contrast == 0.0 { 1.0 } else { a.contrast };
    let tint = a
        .tint
        .map(|t| [t[0] as f32 / 255.0, t[1] as f32 / 255.0, t[2] as f32 / 255.0]);
    for p in img.pixels.chunks_exact_mut(4) {
        let (mut h, mut s, mut l) = rgb_to_hsl(p[0], p[1], p[2]);
        h = (h + a.hue / 360.0).rem_euclid(1.0);
        s = (s * sat).clamp(0.0, 1.0);
        l = (l * bri).clamp(0.0, 1.0);
        l = ((l - 0.5) * con + 0.5).clamp(0.0, 1.0);
        let mut rgb = hsl_to_rgb(h, s, l);
        if let Some(t) = tint {
            let k = a.tint_strength.clamp(0.0, 1.0);
            let lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
            for c in 0..3 {
                rgb[c] = rgb[c] * (1.0 - k) + t[c] * lum * 1.6 * k;
            }
        }
        p[0] = (rgb[0].clamp(0.0, 1.0) * 255.0).round() as u8;
        p[1] = (rgb[1].clamp(0.0, 1.0) * 255.0).round() as u8;
        p[2] = (rgb[2].clamp(0.0, 1.0) * 255.0).round() as u8;
    }
}

fn rgb_to_hsl(r: u8, g: u8, b: u8) -> (f32, f32, f32) {
    let (r, g, b) = (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0);
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if max == min {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if max == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h / 6.0, s, l)
}

fn hsl_to_rgb(h: f32, s: f32, l: f32) -> [f32; 3] {
    if s == 0.0 {
        return [l, l, l];
    }
    let q = if l < 0.5 { l * (1.0 + s) } else { l + s - l * s };
    let p = 2.0 * l - q;
    let f = |mut t: f32| {
        t = t.rem_euclid(1.0);
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    [f(h + 1.0 / 3.0), f(h), f(h - 1.0 / 3.0)]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gradient(w: u32, h: u32) -> Rgba {
        let mut px = Vec::new();
        for y in 0..h {
            for x in 0..w {
                px.extend_from_slice(&[(x * 255 / w) as u8, (y * 255 / h) as u8, 128, 255 - (x as u8)]);
            }
        }
        Rgba {
            width: w,
            height: h,
            pixels: px,
        }
    }

    #[test]
    fn roundtrip_all_formats() {
        let img = gradient(64, 32);
        for f in [
            DdsFormat::Dxt1,
            DdsFormat::Dxt3,
            DdsFormat::Dxt5,
            DdsFormat::Bgra8,
            DdsFormat::Bgrx8,
            DdsFormat::Bgr8,
            DdsFormat::Rgb565,
            DdsFormat::L8,
        ] {
            let dds = encode(&img, f, 0, Quality::Fast).unwrap();
            let (i, back) = decode(&dds).unwrap();
            assert_eq!((i.width, i.height, i.format), (64, 32, f));
            assert_eq!(i.mip_count, 7, "{f:?}: 64x32 → 7 níveis");
            // tamanho total = cabeçalho + soma dos níveis
            let mut expect = 128;
            let (mut w, mut h) = (64u32, 32u32);
            for _ in 0..7 {
                expect += f.level_size(w, h);
                w = (w / 2).max(1);
                h = (h / 2).max(1);
            }
            assert_eq!(dds.len(), expect, "{f:?}");
            if f == DdsFormat::Bgra8 {
                assert_eq!(back.pixels, img.pixels, "sem perdas");
            } else if f != DdsFormat::L8 {
                // compressão com perdas: erro médio pequeno no canal vermelho
                let err: u32 = back
                    .pixels
                    .chunks(4)
                    .zip(img.pixels.chunks(4))
                    .map(|(a, b)| (a[0] as i32 - b[0] as i32).unsigned_abs())
                    .sum();
                assert!(err / (64 * 32) < 12, "{f:?} erro médio {}", err / 2048);
            }
        }
    }

    #[test]
    fn png_roundtrip_and_adjust() {
        let img = gradient(16, 16);
        let png = to_png(&img).unwrap();
        assert_eq!(from_png(&png).unwrap(), img);
        let mut a = img.clone();
        adjust(&mut a, &ColorAdjust::identity());
        let diff: u32 = a
            .pixels
            .iter()
            .zip(&img.pixels)
            .map(|(x, y)| (*x as i32 - *y as i32).unsigned_abs())
            .sum();
        assert!(diff < 16 * 16 * 2, "identidade quase sem mudança");
        let mut b = img.clone();
        adjust(
            &mut b,
            &ColorAdjust {
                hue: 120.0,
                ..ColorAdjust::identity()
            },
        );
        assert_ne!(b.pixels, img.pixels);
        assert_eq!(b.pixels[3], img.pixels[3], "alfa preservado");
    }

    #[test]
    fn rejects_garbage() {
        assert!(info(b"nope").is_err());
        let mut d = encode(&gradient(8, 8), DdsFormat::Dxt5, 1, Quality::Fast).unwrap();
        d.truncate(140);
        assert!(decode(&d).is_err());
    }
}
