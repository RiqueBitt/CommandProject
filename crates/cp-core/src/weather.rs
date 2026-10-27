//! Mod "Climas": chuva, tempestade ou nevasca numa partida grande, escolhidos ao criar a partida.
//!
//! Montado para cada partida (o clima e o mapa entram nos arquivos), com os arquivos do próprio jogo
//! do usuário:
//! - `/lua/sim/ScenarioUtilities.lua` (e a cópia da expansão em `mods/DLC1/shadow`) leva o código da
//!   simulação ([`SIM_CODE`]): um conjunto fixo de emissores segue a parte do mapa que a câmera mostra,
//!   numa grade que engrossa (gotas maiores) quando a câmera sobe; raios na tempestade;
//! - `/lua/ui/game/timer.lua` leva o código da interface ([`UI_CODE`]): a cada ¼ s ele mede o pedaço
//!   do chão que aparece na tela e manda para a simulação (`SimCallback 'CPWeather'`, atendido pelo
//!   próprio código do clima, sem depender do `SimCallbacks.lua` de outro mod);
//! - os emissores de clima do jogo (só o clima das campanhas usa) reescritos para a partida e as
//!   texturas das partículas (gota, respingo, floco, raio), desenhadas aqui;
//! - as texturas do chão do mapa escolhido (do jogo ou de um mod, inclusive das Texturas HD): na
//!   chuva mais escuras e com reflexo (chão encharcado, com poças), na nevasca cobertas de neve,
//!   mantendo o relevo e os detalhes de cada uma.
//!
//! As partículas caem no mundo: o terreno, os prédios e as unidades escondem cada gota onde ela chega.
//! O custo não muda com o tamanho do mapa nem com o zoom (são sempre até 180 pontos de emissão).

use std::path::{Path, PathBuf};

use rayon::prelude::*;
use serde::{Deserialize, Serialize};

use crate::dds::{self, DdsFormat, Rgba};
use crate::error::{Error, Result};
use crate::mapassets::{self, LayerSet};

pub const MOD_ID: &str = "cp-clima";
/// Muda quando o código ou as texturas mudam (o launcher monta de novo).
pub const MOD_VERSION: &str = "1.0.0";
/// Depois de todos os outros mods (inclusive as Texturas HD e o `zz_cp_zz_…`): as texturas do chão
/// daqui valem.
pub const ARCHIVE: &str = "zz_cp_zzz_clima.scd";

pub const SIM_CODE: &str = include_str!("weather/weather_sim.lua");
pub const UI_CODE: &str = include_str!("weather/weather_ui.lua");
const SIM_FILES: &[&str] = &["/lua/sim/ScenarioUtilities.lua", "/mods/DLC1/shadow/lua/sim/ScenarioUtilities.lua"];
const UI_FILE: &str = "/lua/ui/game/timer.lua";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Rain,
    Storm,
    Blizzard,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        match s.to_ascii_lowercase().as_str() {
            "rain" => Some(Kind::Rain),
            "storm" => Some(Kind::Storm),
            "blizzard" | "snow" => Some(Kind::Blizzard),
            _ => None,
        }
    }
    /// Valor de `ScenarioInfo.Options.CPWeather`.
    pub fn key(self) -> &'static str {
        match self {
            Kind::Rain => "rain",
            Kind::Storm => "storm",
            Kind::Blizzard => "blizzard",
        }
    }
    fn wet(self) -> bool {
        self != Kind::Blizzard
    }
}

/// Quantidade de chuva ou neve aceita (1 = normal).
pub fn clamp_amount(a: f32) -> f32 {
    if a.is_finite() { a.clamp(0.4, 2.0) } else { 1.0 }
}

// ------------------------------------------------------------------ números sorteados

/// xorshift32: as mesmas texturas em toda montagem.
struct Rng(u32);

impl Rng {
    fn new(seed: u32) -> Rng {
        let s = seed.wrapping_mul(2654435761).wrapping_add(1);
        Rng(if s == 0 { 1 } else { s })
    }
    fn next(&mut self) -> f32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        (x as f64 / 4294967296.0) as f32
    }
    fn range(&mut self, a: f32, b: f32) -> f32 {
        a + (b - a) * self.next()
    }
}

fn smooth(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn byte(v: f32) -> u8 {
    (v * 255.0 + 0.5).clamp(0.0, 255.0) as u8
}

// ------------------------------------------------------------------ texturas das partículas

/// Imagem n × n com cor fixa e o alfa de `alpha(x, y)` (x e y de -1 a 1).
fn sprite(n: u32, rgb: [u8; 3], alpha: impl Fn(f32, f32) -> f32) -> Rgba {
    let mut pixels = Vec::with_capacity((n * n * 4) as usize);
    for j in 0..n {
        for i in 0..n {
            let x = (i as f32 + 0.5) / n as f32 * 2.0 - 1.0;
            let y = (j as f32 + 0.5) / n as f32 * 2.0 - 1.0;
            pixels.extend_from_slice(&[rgb[0], rgb[1], rgb[2], byte(alpha(x, y))]);
        }
    }
    Rgba { width: n, height: n, pixels }
}

/// Risco vertical fino: a cabeça (embaixo) mais forte e a cauda some para cima.
fn rain_drop() -> Rgba {
    let n = 128;
    let width = 2.0 / n as f32;
    sprite(n, [222, 232, 245], |x, y| (-(x / width).powi(2)).exp() * smooth(-1.0, 0.55, y) * (1.0 - smooth(0.82, 1.0, y)))
}

/// Outro risco (camada extra): mais longo e fino, com a cabeça mais marcada.
fn rain_drop2() -> Rgba {
    let n = 128;
    let width = 1.6 / n as f32;
    sprite(n, [215, 228, 245], |x, y| (-(x / width).powi(2)).exp() * (0.35 * smooth(-1.0, 0.7, y) + 0.65 * smooth(0.55, 0.85, y)) * (1.0 - smooth(0.9, 1.0, y)))
}

/// O mesmo risco mais grosso e curto, para a câmera de longe (senão some, mais fino que um pixel).
fn rain_drop_far() -> Rgba {
    let n = 128;
    let width = 5.0 / n as f32;
    sprite(n, [222, 232, 245], |x, y| (-(x / width).powi(2)).exp() * smooth(-0.6, 0.55, y) * (1.0 - smooth(0.82, 1.0, y)))
}

/// Anel que a gota faz no chão ou na água (com um anel menor dentro).
fn ripple() -> Rgba {
    sprite(128, [230, 238, 248], |x, y| {
        let r = (x * x + y * y).sqrt();
        let ring = (-((r - 0.80) / 0.055).powi(2)).exp() + 0.45 * (-((r - 0.52) / 0.05).powi(2)).exp();
        if r < 0.98 { ring.min(1.0) } else { 0.0 }
    })
}

/// Coroa de gotículas que sobe onde a gota bate.
fn splash() -> Rgba {
    let mut rng = Rng::new(7);
    let drops: Vec<(f32, f32, f32)> = (0..10)
        .map(|i| {
            let sign = if i % 2 == 1 { 1.0 } else { -1.0 };
            let ang = sign * rng.range(0.15, 1.2);
            let dist = rng.range(0.35, 0.8);
            let s = rng.range(0.045, 0.08);
            (ang.sin() * dist, 0.85 - ang.cos() * dist, s)
        })
        .collect();
    sprite(128, [235, 242, 250], |x, y| {
        let mut a = 0.6 * (-((x / 0.5).powi(2) + ((y - 0.85) / 0.1).powi(2))).exp();
        for (cx, cy, s) in &drops {
            a += (-(((x - cx).powi(2) + (y - cy).powi(2)) / (s * s))).exp();
        }
        a.min(1.0)
    })
}

/// Floco: um disco macio com o centro mais claro.
fn snowflake() -> Rgba {
    sprite(64, [252, 253, 255], |x, y| {
        let r = (x * x + y * y).sqrt();
        ((-(r / 0.42).powi(2)).exp() * 0.85 + (-(r / 0.16).powi(2)).exp() * 0.35).min(1.0)
    })
}

/// Floco pequeno e nítido (camada extra), com um brilho de seis pontas bem leve.
fn snowflake2() -> Rgba {
    sprite(32, [255, 255, 255], |x, y| {
        let r = (x * x + y * y).sqrt();
        let a = y.atan2(x);
        let star = (3.0 * a).cos().abs().powf(8.0) * (-(r / 0.6).powi(2)).exp() * 0.35;
        ((-(r / 0.3).powi(2)).exp() * 0.95 + star).min(1.0)
    })
}

/// Rajada de neve levantada: uma nuvem baixa e comprida, com fiapos (o vento a leva de lado).
fn snow_gust() -> Rgba {
    let mut rng = Rng::new(11);
    let puffs: Vec<(f32, f32, f32, f32)> = (0..14).map(|_| (rng.range(-0.6, 0.6), rng.range(-0.15, 0.15), rng.range(0.12, 0.3), rng.range(0.4, 1.0))).collect();
    sprite(128, [246, 249, 255], |x, y| {
        let mut a = 0.0;
        for (cx, cy, r, w) in &puffs {
            a += w * (-(((x - cx) / (r * 1.8)).powi(2) + ((y - cy) / r).powi(2))).exp();
        }
        // borda macia: some antes da beira do quadro
        (a * 0.45).min(1.0) * (1.0 - smooth(0.7, 1.0, (x * x + y * y * 4.0).sqrt()))
    })
}

/// Linha quebrada de `a` a `b`: o meio de cada trecho desviado de lado, cada vez menos.
fn bolt_path(rng: &mut Rng, a: (f32, f32), b: (f32, f32), rough: f32, depth: u32) -> Vec<(f32, f32)> {
    let mut pts = vec![a, b];
    for _ in 0..depth {
        let mut out = vec![pts[0]];
        for w in pts.windows(2) {
            let ((ax, ay), (bx, by)) = (w[0], w[1]);
            let len = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
            let off = rng.range(-1.0, 1.0) * rough * len;
            let (nx, ny) = if len > 0.0 { (-(by - ay) / len, (bx - ax) / len) } else { (0.0, 0.0) };
            out.push(((ax + bx) / 2.0 + nx * off, (ay + by) / 2.0 + ny * off));
            out.push((bx, by));
        }
        pts = out;
    }
    pts
}

/// Três passadas de média em caixa (quase uma gaussiana), com borda zero.
fn blur(src: &[f32], n: usize, r: usize) -> Vec<f32> {
    let mut a = src.to_vec();
    let mut tmp = vec![0f32; n * n];
    let k = (2 * r + 1) as f32;
    for _ in 0..3 {
        for (step, stride) in [(1usize, n), (n, 1usize)] {
            // `step` anda dentro da linha, `stride` passa de uma linha para a outra
            for line in 0..n {
                let base = line * stride;
                let mut sum = 0f32;
                for i in 0..=r.min(n - 1) {
                    sum += a[base + i * step];
                }
                for i in 0..n {
                    tmp[base + i * step] = sum / k;
                    if i + r + 1 < n {
                        sum += a[base + (i + r + 1) * step];
                    }
                    if i >= r {
                        sum -= a[base + (i - r) * step];
                    }
                }
            }
            std::mem::swap(&mut a, &mut tmp);
        }
    }
    a
}

/// Raio do céu ao chão: um canal principal em zigue-zague e galhos que saem dele para baixo, com
/// brilho azulado em volta. `seed` muda o formato.
fn bolt(seed: u32) -> Rgba {
    let n = 256usize;
    let nf = n as f32;
    let mut rng = Rng::new(seed);
    let mut core = vec![0f32; n * n];
    let mut draw = |pts: &[(f32, f32)], width: f32, power: f32| {
        for w in pts.windows(2) {
            let ((ax, ay), (bx, by)) = (w[0], w[1]);
            let steps = ((bx - ax).abs().max((by - ay).abs()) * nf * 2.0) as usize + 1;
            for k in 0..=steps {
                let t = k as f32 / steps as f32;
                let (px, py) = ((ax + (bx - ax) * t) * nf, (ay + (by - ay) * t) * nf);
                let (x0, x1) = ((px - width - 1.0).max(0.0) as usize, ((px + width + 2.0).max(0.0) as usize).min(n));
                let (y0, y1) = ((py - width - 1.0).max(0.0) as usize, ((py + width + 2.0).max(0.0) as usize).min(n));
                for yy in y0..y1 {
                    for xx in x0..x1 {
                        let d = ((xx as f32 + 0.5 - px).powi(2) + (yy as f32 + 0.5 - py).powi(2)).sqrt();
                        let v = power * (1.0 - d / width).max(0.0);
                        let c = &mut core[yy * n + xx];
                        if v > *c {
                            *c = v;
                        }
                    }
                }
            }
        }
    };
    let start = (0.5 + rng.range(-0.05, 0.05), 0.0);
    let end = (0.5 + rng.range(-0.12, 0.12), 0.97);
    let main = bolt_path(&mut rng, start, end, 0.32, 7);
    draw(&main, 1.2, 1.0);
    for _ in 0..5 {
        let i = (rng.range(0.08, 0.7) * (main.len() - 1) as f32) as usize;
        let (sx, sy) = main[i];
        let side = if rng.next() < 0.5 { 1.0 } else { -1.0 };
        let len = rng.range(0.12, 0.32);
        let ex = (sx + side * len * rng.range(0.5, 0.9)).clamp(0.03, 0.97);
        let ey = (sy + len * rng.range(0.6, 1.0)).min(0.97);
        let twig = bolt_path(&mut rng, (sx, sy), (ex, ey), 0.38, 5);
        draw(&twig, 0.8, 0.6);
    }
    let wide = blur(&core, n, 5);
    let near = blur(&core, n, 2);
    let mut pixels = Vec::with_capacity(n * n * 4);
    for i in 0..n * n {
        let a = (core[i] + wide[i] * 0.7 + near[i] * 0.9).min(1.0);
        let white = (core[i] * 1.5).min(1.0);
        let mix = |glow: f32| (glow * (1.0 - white) + 255.0 * white) as u8;
        pixels.extend_from_slice(&[mix(150.0), mix(175.0), 255, byte(a)]);
    }
    Rgba { width: n as u32, height: n as u32, pixels }
}

/// Rampa de cor ao longo da vida da partícula (256 × 4): cor fixa e o alfa de `alpha(t)`, t de 0 a 1.
fn ramp(rgb: [u8; 3], alpha: impl Fn(f32) -> f32) -> Rgba {
    let row: Vec<u8> = (0..256).flat_map(|i| {
        let t = (i as f32 + 0.5) / 256.0;
        [rgb[0], rgb[1], rgb[2], byte(alpha(t))]
    }).collect();
    Rgba { width: 256, height: 4, pixels: row.repeat(4) }
}

/// Texturas das partículas: (nome sem extensão, imagem).
pub fn particle_images() -> Vec<(&'static str, Rgba)> {
    vec![
        ("cp_rain_drop", rain_drop()),
        ("cp_rain_drop2", rain_drop2()),
        ("cp_rain_far", rain_drop_far()),
        ("cp_rain_ripple", ripple()),
        ("cp_rain_splash", splash()),
        ("cp_snowflake", snowflake()),
        ("cp_snowflake2", snowflake2()),
        ("cp_snow_gust", snow_gust()),
        ("cp_bolt_1", bolt(1)),
        ("cp_bolt_2", bolt(2)),
        ("cp_bolt_3", bolt(3)),
        ("cp_ramp_rain", ramp([205, 218, 238], |t| 0.3 * smooth(0.0, 0.12, t) * (1.0 - smooth(0.8, 1.0, t)))),
        ("cp_ramp_rain_far", ramp([205, 218, 238], |t| 0.42 * smooth(0.0, 0.12, t) * (1.0 - smooth(0.8, 1.0, t)))),
        ("cp_ramp_ripple", ramp([220, 230, 242], |t| 0.6 * smooth(0.0, 0.05, t) * (1.0 - t).powf(1.4))),
        ("cp_ramp_splash", ramp([228, 236, 246], |t| 0.5 * (1.0 - smooth(0.35, 1.0, t)))),
        ("cp_ramp_snow", ramp([255, 255, 255], |t| 0.85 * smooth(0.0, 0.12, t) * (1.0 - smooth(0.82, 1.0, t)))),
        // o raio pisca: forte, quase apaga, volta e some
        ("cp_ramp_bolt", ramp([255, 255, 255], |t| {
            if t < 0.18 { 1.0 } else if t < 0.32 { 0.2 } else if t < 0.5 { 0.9 } else { 0.9 * (1.0 - smooth(0.5, 1.0, t)) }
        })),
        // luz do raio: azulada e fraca (a luz soma ao chão: branca e forte deixava o mapa todo branco)
        ("cp_ramp_flash", ramp([105, 115, 140], |t| 0.8 * (1.0 - smooth(0.2, 1.0, t)))),
        // fraca: são véus de neve, não neblina
        ("cp_ramp_drift", ramp([244, 247, 252], |t| 0.16 * (std::f32::consts::PI * t).sin().max(0.0).powf(1.3))),
    ]
}

// ------------------------------------------------------------------ emissores

const EMIT_DIR: &str = "effects/Emitters/ambient/weather/";
/// Lado da célula do nível 1 e os níveis da grade (iguais a `CPWeatherBase` e `CPWeatherLevels`).
const CELL: f32 = 20.0;
const LEVELS: [f32; 6] = [1.0, 2.0, 4.0, 8.0, 16.0, 32.0];

const CURVES: &[&str] = &[
    "XDirectionCurve", "YDirectionCurve", "ZDirectionCurve", "EmitRateCurve", "LifetimeCurve", "VelocityCurve",
    "XAccelCurve", "YAccelCurve", "ZAccelCurve", "ResistanceCurve", "SizeCurve", "XPosCurve", "YPosCurve", "ZPosCurve",
    "StartSizeCurve", "EndSizeCurve", "InitialRotationCurve", "RotationRateCurve", "FrameRateCurve",
    "TextureSelectionCurve", "RampSelectionCurve",
];

/// Um emissor: textura, rampa, opções diferentes do padrão e curvas (valor, faixa sorteada).
struct Emitter {
    path: String,
    texture: String,
    ramp: String,
    flags: Vec<(&'static str, f32)>,
    curves: Vec<(&'static str, f32, f32)>,
}

fn level_path(group: &str, i: usize) -> String {
    if i == 1 {
        let first = match group {
            "fall" => Some("rain/weather_rainfall_01"),
            "snow" => Some("snow/weather_snow_falling_01"),
            "drift" => Some("snow/weather_snow_drifting_01"),
            _ => None,
        };
        if let Some(first) = first {
            return format!("{EMIT_DIR}{first}_emit.bp");
        }
    }
    // os mesmos nomes que o Lua monta (CPWeatherBP)
    match group {
        "fall" => format!("{EMIT_DIR}clouds/weather_stratus_{:02}_emit.bp", i - 1),
        "snow" => format!("{EMIT_DIR}clouds/weather_stratus_{:02}_emit.bp", i + 4),
        "drift" => format!("{EMIT_DIR}clouds/weather_stratus_{:02}_emit.bp", i + 9),
        "fall2" => format!("{EMIT_DIR}clouds/weather_stratus_{:02}_emit.bp", i + 15),
        _ => match i {
            1 => format!("{EMIT_DIR}clouds/weather_stratus_22_emit.bp"),
            2 => format!("{EMIT_DIR}clouds/weather_stratus_23_emit.bp"),
            n => format!("{EMIT_DIR}clouds/weather_cumulus_snow_{:02}_emit.bp", n - 2),
        },
    }
}

fn tex(name: &str) -> String {
    format!("/textures/particles/{name}.dds")
}

/// O motor sorteia a posição de cada partícula em [valor - faixa, valor + faixa] (medido no jogo com
/// um emissor de teste: uma linha de pontos com a mesma largura para os dois lados do centro).
fn span(center: f32, half: f32) -> (f32, f32) {
    (center, half)
}

fn emitters(kind: Kind, amount: f32) -> Vec<Emitter> {
    let storm = kind == Kind::Storm;
    let pick = |a: f32, b: f32| if storm { a } else { b };
    let mut out = Vec::new();
    for (idx, f) in LEVELS.iter().copied().enumerate() {
        let i = idx + 1;
        // um pouco além da célula (0,7 do lado para cada lado do centro): as vizinhas se misturam,
        // sem bordas retas nem buracos
        let half = 0.7 * CELL * f;
        if kind.wet() {
            // o vento leva a gota de lado: ela nasce um pouco contra o vento
            let (xp, xr) = span(pick(-8.0, -1.0) * f, half);
            let (zp, zr) = span(0.0, half);
            // camada principal e a extra (outro risco, outro tamanho, outra velocidade), que vai e
            // volta com o tempo
            for (layer, rate, tex_near, size, speed) in [
                ("fall", pick(14.0, 9.0), "cp_rain_drop", pick(1.6, 1.3), pick(3.2, 2.6)),
                ("fall2", pick(10.0, 6.0), "cp_rain_drop2", pick(2.0, 1.6), pick(3.6, 3.0)),
            ] {
                out.push(Emitter {
                    path: level_path(layer, i),
                    // de longe (níveis 3 em diante) o risco grosso
                    texture: tex(if i >= 3 { "cp_rain_far" } else { tex_near }),
                    ramp: tex(if i >= 3 { "cp_ramp_rain_far" } else { "cp_ramp_rain" }),
                    flags: vec![("AlignRotation", 1.0), ("LODCutoff", -1.0), ("EmitIfVisible", 0.0), ("Blendmode", 3.0)],
                    curves: vec![
                        ("EmitRateCurve", rate * amount, 0.0),
                        ("LifetimeCurve", 13.0, 2.0),
                        ("VelocityCurve", speed * f, 0.3 * f),
                        ("XDirectionCurve", pick(0.42, 0.06), 0.05),
                        ("YDirectionCurve", -1.0, 0.0),
                        ("ZDirectionCurve", pick(0.08, 0.0), 0.04),
                        ("XPosCurve", xp, xr),
                        ("YPosCurve", 17.0 * f, 13.0 * f),
                        ("ZPosCurve", zp, zr),
                        ("StartSizeCurve", size * f, 0.3 * f),
                        ("EndSizeCurve", size * f, 0.3 * f),
                    ],
                });
            }
        } else {
            let (xp, xr) = span(-10.0 * f, half);
            let (zp, zr) = span(0.0, half);
            // flocos grandes e macios e, na camada extra, pequenos e mais rápidos
            for (layer, rate, texture, size, speed) in [
                ("snow", 3.2, "cp_snowflake", 0.22, 0.42),
                ("snow2", 2.6, "cp_snowflake2", 0.13, 0.55),
            ] {
                out.push(Emitter {
                    path: level_path(layer, i),
                    texture: tex(texture),
                    ramp: tex("cp_ramp_snow"),
                    flags: vec![("LODCutoff", -1.0), ("EmitIfVisible", 0.0), ("Blendmode", 0.0)],
                    curves: vec![
                        ("EmitRateCurve", rate * amount, 0.0),
                        ("LifetimeCurve", 75.0, 15.0),
                        ("VelocityCurve", speed * f, 0.08 * f),
                        ("XDirectionCurve", 0.8, 0.25),
                        ("YDirectionCurve", -1.0, 0.12),
                        ("ZDirectionCurve", 0.12, 0.25),
                        ("XPosCurve", xp, xr),
                        ("YPosCurve", 17.0 * f, 13.0 * f),
                        ("ZPosCurve", zp, zr),
                        ("StartSizeCurve", size * f, size * 0.3 * f),
                        ("EndSizeCurve", size * f, size * 0.3 * f),
                        ("InitialRotationCurve", 0.0, 360.0),
                        ("RotationRateCurve", -30.0, 60.0),
                    ],
                });
            }
            // neve levantada pelo vento rente ao chão
            out.push(Emitter {
                path: level_path("drift", i),
                texture: tex("cp_snow_gust"),
                ramp: tex("cp_ramp_drift"),
                flags: vec![("LODCutoff", -1.0), ("EmitIfVisible", 0.0), ("Blendmode", 0.0)],
                curves: vec![
                    ("EmitRateCurve", 0.25 * amount, 0.0),
                    ("LifetimeCurve", 45.0, 10.0),
                    ("VelocityCurve", 0.75 * f, 0.25 * f),
                    ("XDirectionCurve", 1.0, 0.15),
                    ("YDirectionCurve", 0.0, 0.02),
                    ("ZDirectionCurve", 0.25, 0.2),
                    ("XPosCurve", xp, xr),
                    // alto o bastante para o quadro não entrar no chão (o terreno cortaria a borda reta)
                    ("YPosCurve", 3.2 * f, 0.8 * f),
                    ("ZPosCurve", zp, zr),
                    ("StartSizeCurve", 2.2 * f, 0.6 * f),
                    ("EndSizeCurve", 5.0 * f, 1.2 * f),
                    ("InitialRotationCurve", 0.0, 360.0),
                    ("RotationRateCurve", -4.0, 8.0),
                ],
            });
        }
    }
    if kind.wet() {
        // respingos só perto do chão (nível 1): quatro emissores por célula, um em cada quarto, na
        // altura do chão daquele quarto (o Lua desloca cada um). Sempre ligados, como a chuva: com o
        // teste de visibilidade e o corte por distância do motor, células inteiras ficavam sem
        // respingo. Um pouco além do quarto (6,5 para cada lado, o quarto tem 10): os vizinhos se
        // misturam e a borda não aparece. A quantidade é a da célula inteira (o Lua divide por 4)
        // No nível 2 (a câmera um pouco mais alta) também há anéis, um pouco maiores e mais espaçados
        // (a célula tem 40, o quarto 20): sem eles, os pingos no chão sumiam de uma vez ao afastar
        let (p, r) = span(0.0, 6.5);
        for (path, half, grow, rate) in [("dust/weather_sand_01", 6.5, 1.0, 1.0), ("dust/weather_sand_02", 13.0, 1.5, 2.4)] {
            let (p, r) = if half == 6.5 { (p, r) } else { span(0.0, half) };
            out.push(Emitter {
                path: format!("{EMIT_DIR}{path}_emit.bp"),
                texture: tex("cp_rain_ripple"),
                ramp: tex("cp_ramp_ripple"),
                flags: vec![("Flat", 1.0), ("LODCutoff", -1.0), ("EmitIfVisible", 0.0), ("Blendmode", 3.0)],
                curves: vec![
                    ("EmitRateCurve", pick(22.0, 14.0) * rate * amount, 0.0),
                    ("LifetimeCurve", 7.0, 2.0),
                    ("VelocityCurve", 0.0, 0.0),
                    ("XPosCurve", p, r),
                    ("YPosCurve", 0.12 * grow, 0.0),
                    ("ZPosCurve", p, r),
                    ("StartSizeCurve", 0.06 * grow, 0.02 * grow),
                    ("EndSizeCurve", 0.55 * grow, 0.15 * grow),
                    ("InitialRotationCurve", 0.0, 360.0),
                ],
            });
        }
        out.push(Emitter {
            path: format!("{EMIT_DIR}dust/weather_redrock_01_emit.bp"),
            texture: tex("cp_rain_splash"),
            ramp: tex("cp_ramp_splash"),
            flags: vec![("LODCutoff", -1.0), ("EmitIfVisible", 0.0), ("Blendmode", 3.0)],
            curves: vec![
                ("EmitRateCurve", pick(10.0, 6.0) * amount, 0.0),
                ("LifetimeCurve", 3.0, 1.0),
                ("VelocityCurve", 0.02, 0.0),
                ("YDirectionCurve", 1.0, 0.0),
                ("XPosCurve", p, r),
                ("YPosCurve", 0.05, 0.0),
                ("ZPosCurve", p, r),
                ("StartSizeCurve", 0.15, 0.04),
                ("EndSizeCurve", 0.22, 0.05),
            ],
        });
        // raio: um quadro do céu ao chão (o pé no ponto atingido), um só, que pisca e some; três
        // formas, cada uma de um tamanho
        for (k, size) in [(1, 28.0), (2, 36.0), (3, 46.0)] {
            out.push(Emitter {
                path: format!("{EMIT_DIR}clouds/weather_cirrus_256_{k:02}_emit.bp"),
                texture: tex(&format!("cp_bolt_{k}")),
                ramp: tex("cp_ramp_bolt"),
                // o emissor vive dois tiques: uma partícula só. Ela "cai" quase parada e fica alinhada com
                // a queda: em pé no mundo, na perspectiva da câmera (como as árvores), de qualquer ângulo
                flags: vec![("Lifetime", 2.0), ("Repeattime", 2.0), ("AlignRotation", 1.0), ("LODCutoff", -1.0), ("EmitIfVisible", 0.0), ("Blendmode", 3.0)],
                curves: vec![
                    ("EmitRateCurve", 6.0, 0.0),
                    ("LifetimeCurve", 6.0, 0.0),
                    ("VelocityCurve", 0.001, 0.0),
                    ("YDirectionCurve", -1.0, 0.0),
                    ("YPosCurve", size / 2.0, 0.0),
                    ("StartSizeCurve", size, 0.0),
                    ("EndSizeCurve", size, 0.0),
                ],
            });
        }
    }
    out
}

const BOOL_FLAGS: &[&str] = &[
    "LocalVelocity", "LocalAcceleration", "Gravity", "AlignRotation", "AlignToBone", "Flat", "EmitIfVisible", "CatchupEmit",
    "CreateIfVisible", "SnapToWaterline", "OnlyEmitOnWater", "ParticleResistance", "InterpolateEmission", "LowFidelity",
    "MedFidelity", "HighFidelity",
];

/// O `EmitterBlueprint` em texto, como os do jogo.
fn blueprint(e: &Emitter) -> String {
    let defaults: &[(&str, f32)] = &[
        ("Lifetime", -1.0), ("Repeattime", 10.0), ("TextureFramecount", 1.0), ("Blendmode", 0.0), ("LocalVelocity", 0.0),
        ("LocalAcceleration", 0.0), ("Gravity", 0.0), ("AlignRotation", 0.0), ("AlignToBone", 0.0), ("Flat", 0.0),
        ("LODCutoff", 200.0), ("EmitIfVisible", 1.0), ("CatchupEmit", 0.0), ("CreateIfVisible", 0.0), ("SnapToWaterline", 0.0),
        ("OnlyEmitOnWater", 0.0), ("ParticleResistance", 0.0), ("InterpolateEmission", 1.0), ("TextureStripcount", 1.0),
        ("SortOrder", 0.0), ("LowFidelity", 1.0), ("MedFidelity", 1.0), ("HighFidelity", 1.0),
    ];
    let id = e.path.rsplit('/').next().unwrap_or("").trim_end_matches("_emit.bp");
    let flag = |k: &str| e.flags.iter().find(|(n, _)| *n == k).map(|(_, v)| *v);
    let mut out = format!("EmitterBlueprint {{\r\n\tBlueprintId = '{id}',\r\n");
    for (k, d) in defaults {
        let v = flag(k).unwrap_or(*d);
        if BOOL_FLAGS.contains(k) {
            out.push_str(&format!("\t{k} = {},\r\n", if v != 0.0 { "true" } else { "false" }));
        } else {
            out.push_str(&format!("\t{k} = {v:.3},\r\n"));
        }
    }
    out.push_str(&format!("\tTexture = [[{}]],\r\n\tRampTexture = [[{}]],\r\n", e.texture, e.ramp));
    // o eixo das curvas vai de 0 a Repeattime (como nos emissores do jogo): uma chave no começo e
    // outra no fim, o valor fica constante o tempo todo
    let xr = flag("Repeattime").unwrap_or(10.0).abs().max(1.0);
    for c in CURVES {
        let (y, z) = e.curves.iter().find(|(n, _, _)| n == c).map(|(_, y, z)| (*y, *z)).unwrap_or(
            if matches!(*c, "SizeCurve" | "VelocityCurve" | "FrameRateCurve") { (1.0, 0.0) } else { (0.0, 0.0) },
        );
        out.push_str(&format!(
            "\t{c} = {{\r\n\t\tXRange = {xr:.2},\r\n\t\tKeys = {{\r\n\t\t\t{{ x=0.000,y={y:.3},z={z:.3} }},\r\n\t\t\t{{ x={xr:.3},y={y:.3},z={z:.3} }},\r\n\t\t}},\r\n\t}},\r\n"
        ));
    }
    out.push_str("}\r\n");
    out
}

// ------------------------------------------------------------------ chão

#[derive(Debug, Clone, Copy, PartialEq)]
enum Ground {
    Snow,
    Rock,
    Grass,
    Soil,
}

fn ground_of(name: &str) -> Ground {
    let n = name.to_ascii_lowercase();
    let has = |ks: &[&str]| ks.iter().any(|k| n.contains(k));
    if has(&["snow", "ice", "frost"]) {
        Ground::Snow
    } else if has(&["cliff", "rock", "stone", "hill", "mountain", "boulder", "crag"]) {
        Ground::Rock
    } else if has(&["grass", "moss", "leaf", "forest", "plant", "jungle", "field"]) {
        Ground::Grass
    } else {
        Ground::Soil
    }
}

/// Ruído que emenda nas bordas (soma de ondas com frequências inteiras): a textura do chão se repete
/// lado a lado no mapa, então a variação também precisa continuar de um ladrilho para o outro.
fn tile_noise(w: u32, h: u32, seed: u32, freqs: &[(i32, f32)]) -> Vec<f32> {
    let mut rng = Rng::new(seed);
    let mut waves = Vec::new();
    for &(f, amp) in freqs {
        for _ in 0..3 {
            let mut fx = rng.range(-(f as f32), f as f32 + 1.0).floor() as i32;
            let fy = rng.range(-(f as f32), f as f32 + 1.0).floor() as i32;
            if fx == 0 && fy == 0 {
                fx = f;
            }
            waves.push((fx as f32, fy as f32, amp, rng.range(0.0, std::f32::consts::TAU)));
        }
    }
    let tau = std::f32::consts::TAU;
    let mut out: Vec<f32> = (0..h)
        .into_par_iter()
        .flat_map_iter(|j| {
            let waves = &waves;
            (0..w).map(move |i| {
                let (x, y) = (i as f32 / w as f32 * tau, j as f32 / h as f32 * tau);
                waves.iter().map(|(fx, fy, a, p)| a * (fx * x + fy * y + p).sin()).sum::<f32>()
            })
        })
        .collect();
    let (lo, hi) = out.iter().fold((f32::MAX, f32::MIN), |(lo, hi), v| (lo.min(*v), hi.max(*v)));
    let span = (hi - lo).max(1e-6);
    out.iter_mut().for_each(|v| *v = (*v - lo) / span);
    out
}

/// Média e desvio da luminosidade de uma imagem (o claro e o escuro da própria textura).
fn lum_stats(img: &Rgba) -> (Vec<f32>, f32, f32) {
    let count = (img.pixels.len() / 4).max(1) as f32;
    let lums: Vec<f32> = img.pixels.chunks_exact(4).map(|p| (p[0] as f32 + p[1] as f32 + p[2] as f32) / 3.0).collect();
    let mean = lums.iter().sum::<f32>() / count;
    let std = (lums.iter().map(|l| (l - mean).powi(2)).sum::<f32>() / count).sqrt().max(1e-3);
    (lums, mean, std)
}

// Tudo o que muda no chão sai do claro e escuro da própria textura (a água junta nas fendas, a neve
// fica nas partes altas): nada de manchas novas, que se repetiriam a cada ladrilho e formariam um
// padrão visível de longe.

/// Cor do chão molhado: mais escura e um pouco mais saturada, e mais ainda nas fendas e partes
/// baixas (as escuras), onde a água fica. Cada tipo de chão escurece de um jeito.
fn wet_color(img: &mut Rgba, g: Ground) {
    let (dark, pool) = match g {
        Ground::Snow => (0.86, 0.05),
        Ground::Rock => (0.66, 0.12),
        Ground::Grass => (0.70, 0.08),
        Ground::Soil => (0.60, 0.18),
    };
    let (lums, mean, std) = lum_stats(img);
    img.pixels.par_chunks_exact_mut(4).zip(lums.par_iter()).for_each(|(p, l)| {
        let low = smooth(0.0, -1.6, (l - mean) / std);
        let lum = (p[0] as f32 + p[1] as f32 + p[2] as f32) / 3.0;
        for c in p.iter_mut().take(3) {
            let sat = lum + (*c as f32 - lum) * 1.15;
            *c = (sat * dark * (1.0 - pool * low)).clamp(0.0, 255.0) as u8;
        }
    });
}

/// Brilho do chão molhado: o reflexo de uma película de água. Terra e rocha brilham muito (a água
/// fica lisa nelas), a grama menos (as folhas quebram o reflexo).
fn wet_shine(img: &mut Rgba, g: Ground) {
    let (gain, add) = match g {
        Ground::Snow => (1.6, 30.0),
        Ground::Rock => (2.4, 55.0),
        Ground::Grass => (1.9, 38.0),
        Ground::Soil => (2.7, 65.0),
    };
    img.pixels.par_chunks_exact_mut(4).for_each(|p| {
        for c in p.iter_mut().take(3) {
            *c = (*c as f32 * gain + add).min(255.0) as u8;
        }
    });
}

/// Cor coberta de neve: o claro e o escuro da textura viram o relevo da neve; nas rochas a neve fica
/// nas partes altas (claras) e as fendas continuam aparecendo.
fn snow_color(img: &mut Rgba, g: Ground) {
    if g == Ground::Snow {
        return;
    }
    let (lums, mean, std) = lum_stats(img);
    // um pouco azulada: a luz dos mapas costuma ser quente e deixaria a neve esverdeada
    const SNOW: [f32; 3] = [236.0, 241.0, 250.0];
    img.pixels.par_chunks_exact_mut(4).zip(lums.par_iter()).for_each(|(p, l)| {
        let detail = (l - mean) / std;
        let cover = if g == Ground::Rock { smooth(-0.9, 0.4, detail) * 0.85 } else { 0.94 };
        for (k, c) in p.iter_mut().take(3).enumerate() {
            let snow = SNOW[k] * (1.0 + 0.12 * detail);
            *c = (*c as f32 * 0.85 * (1.0 - cover) + snow * cover).clamp(0.0, 255.0) as u8;
        }
    });
}

/// Brilho da neve: fosco, com um leve cintilar.
fn snow_shine(img: &mut Rgba, g: Ground) {
    if g == Ground::Snow {
        return;
    }
    img.pixels.par_chunks_exact_mut(4).for_each(|p| {
        for c in p.iter_mut().take(3) {
            *c = (*c as f32 * 0.4 + 42.0).min(255.0) as u8;
        }
    });
}

/// Relevo sob a neve: mais suave (a neve arredonda as formas), menos nas rochas.
fn snow_relief(img: &mut Rgba, g: Ground) {
    let keep = match g {
        Ground::Snow => return,
        Ground::Rock => 0.8,
        _ => 0.55,
    };
    img.pixels.par_chunks_exact_mut(4).for_each(|p| {
        p[0] = (128.0 + (p[0] as f32 - 128.0) * keep) as u8;
        p[1] = (128.0 + (p[1] as f32 - 128.0) * keep) as u8;
    });
}

// ------------------------------------------------------------------ água

/// Texturas das ondas da água (mapas de normais do motor, iguais em todos os mapas).
const WATER_NORMALS: &[&str] = &[
    "/textures/Engine/waves.dds",
    "/textures/Engine/waves000.dds",
    "/textures/Engine/waves001.dds",
    "/textures/Engine/waves7.dds",
    "/textures/Engine/wavesbump.dds",
];
/// Ondinhas finas que a chuva faz na superfície (frequências altas: somem de longe, como na água real).
const RIPPLE_FREQS: &[(i32, f32)] = &[(14, 1.0), (21, 0.7), (29, 0.45)];

/// Água agitada: as ondas mais fundas (o desvio das normais cresce `strength` vezes) e, por cima,
/// as ondinhas da chuva. Emenda nas bordas como a original (ela se repete na água inteira).
fn stir_water(img: &mut Rgba, strength: f32, ripples: f32) {
    let (w, h) = (img.width, img.height);
    let noise = tile_noise(w, h, 13, RIPPLE_FREQS);
    let at = |x: i64, y: i64| noise[(y.rem_euclid(h as i64) * w as i64 + x.rem_euclid(w as i64)) as usize];
    img.pixels.par_chunks_exact_mut(4).enumerate().for_each(|(i, p)| {
        let (x, y) = ((i as u32 % w) as i64, (i as u32 / w) as i64);
        // inclinação das ondinhas (derivada do ruído)
        let dx = at(x + 1, y) - at(x - 1, y);
        let dy = at(x, y + 1) - at(x, y - 1);
        let nx = ((p[0] as f32 - 127.5) / 127.5) * strength + dx * ripples;
        let ny = ((p[1] as f32 - 127.5) / 127.5) * strength + dy * ripples;
        let len = (nx * nx + ny * ny).sqrt();
        let (nx, ny) = if len > 0.95 { (nx / len * 0.95, ny / len * 0.95) } else { (nx, ny) };
        let nz = (1.0 - nx * nx - ny * ny).max(0.0).sqrt();
        p[0] = (nx * 127.5 + 127.5).clamp(0.0, 255.0) as u8;
        p[1] = (ny * 127.5 + 127.5).clamp(0.0, 255.0) as u8;
        p[2] = (nz * 127.5 + 127.5).clamp(0.0, 255.0) as u8;
    });
}

/// Texturas da água com a chuva (mais agitada na tempestade). Na nevasca a água fica como está.
pub fn water_textures(sources: &[PathBuf], kind: Kind) -> Vec<(String, Vec<u8>)> {
    let (strength, ripples) = match kind {
        Kind::Rain => (1.25, 2.2),
        Kind::Storm => (1.9, 3.4),
        Kind::Blizzard => return Vec::new(),
    };
    WATER_NORMALS
        .par_iter()
        .filter_map(|path| transform(sources, path, |img| stir_water(img, strength, ripples)).ok())
        .collect()
}

/// Caminho do `terrain.win.bdf` de um cenário (`/maps/X/X_scenario.lua` → `/maps/X/X.terrain.bdf`).
fn terrain_path(scenario: &str) -> Result<String> {
    let key = scenario.replace('\\', "/");
    let (dir, file) = key.rsplit_once('/').ok_or_else(|| Error::Other(format!("cenário inválido: {scenario}")))?;
    let lower = file.to_ascii_lowercase();
    let id = lower
        .strip_suffix("_scenario.lua")
        .map(|_| &file[..file.len() - "_scenario.lua".len()])
        .ok_or_else(|| Error::Other(format!("cenário inválido: {scenario}")))?;
    Ok(format!("{dir}/{id}.terrain.bdf"))
}

/// Camadas de textura do chão do mapa do cenário.
pub fn map_layers(sources: &[PathBuf], scenario: &str) -> Result<Vec<LayerSet>> {
    let path = terrain_path(scenario)?;
    let data = mapassets::read_game_file(sources, &path)
        .map_err(|_| Error::Other(format!("o terreno do mapa ({path}) não foi encontrado: o chão fica como está")))?;
    let payload = mapassets::mfdb_payload(&data)?;
    let map = path.rsplit('/').nth(1).unwrap_or_default().to_string();
    Ok(mapassets::layers_in(&map, &payload))
}

/// Caminho no `.scd` da textura trocada: o do jogo **sem** o `.win`. Assim o launcher pode servir o
/// arquivo solto na pasta do jogo: um segundo `.scd` de mod no índice do jogo (`toc.win.bdf`) fecha o
/// jogo ao abrir, e as Texturas HD já ocupam essa vaga com as delas (veja `crate::toc`).
fn scd_path(path: &str) -> String {
    let p = path.trim_start_matches('/');
    match p.to_ascii_lowercase().rfind(".win.") {
        Some(i) => format!("{}{}", &p[..i], &p[i + 4..]),
        None => p.to_string(),
    }
}

/// Uma textura do chão transformada, no mesmo formato e com os mesmos níveis de mip da original.
fn transform(sources: &[PathBuf], path: &str, f: impl Fn(&mut Rgba)) -> Result<(String, Vec<u8>)> {
    let data = mapassets::read_game_file(sources, path)?;
    let (info, mut img) = dds::decode(&data)?;
    f(&mut img);
    let format = match info.format {
        DdsFormat::Dxt1 | DdsFormat::Dxt3 | DdsFormat::Dxt5 | DdsFormat::Bgra8 | DdsFormat::Bgrx8 => info.format,
        // formatos que o codificador não escreve de volta viram DXT5 (o jogo lê igual)
        _ => DdsFormat::Dxt5,
    };
    Ok((scd_path(path), dds::encode(&img, format, info.mip_count.max(1), dds::Quality::Normal)?))
}

/// Texturas do chão do mapa com o clima: (caminho no `.scd`, DDS). Camadas que não deu para ler
/// ficam como estão.
pub fn ground_textures(sources: &[PathBuf], scenario: &str, kind: Kind) -> Result<Vec<(String, Vec<u8>)>> {
    let layers = map_layers(sources, scenario)?;
    let mut jobs: Vec<(String, Ground, u8)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for l in &layers {
        let g = ground_of(&format!("{} {}", l.name, l.d));
        let mut add = |p: &Option<String>, what: u8| {
            if let Some(p) = p {
                if seen.insert(p.to_ascii_lowercase()) {
                    jobs.push((p.clone(), g, what));
                }
            }
        };
        add(&Some(l.d.clone()), b'd');
        add(&l.s, b's');
        if !kind.wet() {
            add(&l.n, b'n');
        }
    }
    let out: Vec<(String, Vec<u8>)> = jobs
        .par_iter()
        .filter_map(|(path, g, what)| {
            let g = *g;
            let r = match (kind.wet(), what) {
                (true, b'd') => transform(sources, path, |i| wet_color(i, g)),
                (true, _) => transform(sources, path, |i| wet_shine(i, g)),
                (false, b'd') => transform(sources, path, |i| snow_color(i, g)),
                (false, b's') => transform(sources, path, |i| snow_shine(i, g)),
                (false, _) => transform(sources, path, |i| snow_relief(i, g)),
            };
            r.ok()
        })
        .collect();
    Ok(out)
}

// ------------------------------------------------------------------ unidades e prédios

/// Mod com as texturas das unidades e prédios no clima (separado do mod da partida: não depende do
/// mapa, então é montado uma vez por clima e reaproveitado).
pub const MODELS_ID: &str = "cp-clima-modelos";
pub const MODELS_ARCHIVE: &str = "zz_cp_zzz_clima_modelos.scd";

/// Texturas de um modelo do jogo: cor, máscara (brilho e luzes), cor do time e a malha.
#[derive(Debug, Clone, PartialEq)]
pub struct ModelSet {
    pub diffuse: String,
    pub mask: Option<String>,
    pub team: Option<String>,
    pub mesh: String,
}

/// Modelos de unidades e prédios dos arquivos (`/units/…/X_Diffuse.dds` com `X_LOD0.scm` ao lado),
/// do jogo e dos mods; o último arquivo vence, como no jogo.
pub fn model_sets(sources: &[PathBuf]) -> Vec<ModelSet> {
    let mut keys = std::collections::BTreeSet::new();
    for src in sources {
        let Ok(mut scd) = crate::scd::Scd::open(src) else { continue };
        let Ok(entries) = scd.entries() else { continue };
        for e in entries {
            if !e.is_dir && e.key.starts_with("/units/") {
                keys.insert(e.key.replace(".win.", "."));
            }
        }
    }
    let has = |k: &str| keys.contains(k);
    keys.iter()
        .filter_map(|k| {
            let stem = k.strip_suffix("_diffuse.dds")?;
            let mesh = format!("{stem}_lod0.scm");
            if !has(&mesh) {
                return None;
            }
            let opt = |suffix: &str| Some(format!("{stem}_{suffix}.dds")).filter(|p| has(p));
            Some(ModelSet { diffuse: k.clone(), mask: opt("mask"), team: opt("team"), mesh })
        })
        .collect()
}

/// Para cada texel da textura (w × h), quanto a superfície que ele pinta está virada para cima, de -1
/// (para baixo) a 1 (para cima), pelas normais da malha; -2 onde nenhum triângulo usa o texel. Os
/// texels de borda recebem o valor dos vizinhos (o mipmap mistura a borda com o lado de fora).
fn up_map(model: &crate::scm::Model, w: u32, h: u32) -> Vec<f32> {
    let (wf, hf) = (w as f32, h as f32);
    let mut sum = vec![0f32; (w * h) as usize];
    let mut count = vec![0u16; (w * h) as usize];
    for tri in model.indices.chunks_exact(3) {
        let v: Vec<&crate::scm::Vertex> = tri.iter().filter_map(|&i| model.vertices.get(i as usize)).collect();
        if v.len() != 3 {
            continue;
        }
        let p: Vec<(f32, f32)> = v.iter().map(|v| (v.uv0[0] * wf, v.uv0[1] * hf)).collect();
        let area = (p[1].0 - p[0].0) * (p[2].1 - p[0].1) - (p[2].0 - p[0].0) * (p[1].1 - p[0].1);
        if area.abs() < 1e-6 || !area.is_finite() {
            continue;
        }
        let (x0, x1) = (p.iter().map(|q| q.0).fold(f32::MAX, f32::min).floor().max(0.0) as u32, p.iter().map(|q| q.0).fold(f32::MIN, f32::max).ceil().min(wf) as u32);
        let (y0, y1) = (p.iter().map(|q| q.1).fold(f32::MAX, f32::min).floor().max(0.0) as u32, p.iter().map(|q| q.1).fold(f32::MIN, f32::max).ceil().min(hf) as u32);
        if x1 <= x0 || y1 <= y0 || (x1 - x0) as u64 * (y1 - y0) as u64 > (w as u64 * h as u64) {
            continue;
        }
        for y in y0..y1 {
            for x in x0..x1 {
                let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
                let w0 = ((p[1].0 - px) * (p[2].1 - py) - (p[2].0 - px) * (p[1].1 - py)) / area;
                let w1 = ((p[2].0 - px) * (p[0].1 - py) - (p[0].0 - px) * (p[2].1 - py)) / area;
                let w2 = 1.0 - w0 - w1;
                if w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4 {
                    continue;
                }
                let n = [0, 1, 2].map(|k| v[0].normal[k] * w0 + v[1].normal[k] * w1 + v[2].normal[k] * w2);
                let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
                if len < 1e-6 {
                    continue;
                }
                let i = (y * w + x) as usize;
                sum[i] += n[1] / len;
                count[i] = count[i].saturating_add(1);
            }
        }
    }
    let mut up: Vec<f32> = sum.iter().zip(&count).map(|(s, &c)| if c > 0 { s / c as f32 } else { -2.0 }).collect();
    // borda: 4 passadas de vizinhos
    for _ in 0..4 {
        let prev = up.clone();
        for y in 0..h as i64 {
            for x in 0..w as i64 {
                let i = (y * w as i64 + x) as usize;
                if prev[i] > -1.5 {
                    continue;
                }
                let (mut acc, mut n) = (0.0, 0);
                for (dx, dy) in [(-1, 0), (1, 0), (0, -1), (0, 1)] {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx >= 0 && ny >= 0 && nx < w as i64 && ny < h as i64 {
                        let q = prev[(ny * w as i64 + nx) as usize];
                        if q > -1.5 {
                            acc += q;
                            n += 1;
                        }
                    }
                }
                if n > 0 {
                    up[i] = acc / n as f32;
                }
            }
        }
    }
    up
}

/// Ruído suave e fixo por posição (para a borda da neve não sair reta).
fn value_noise(x: f32, y: f32, seed: u32) -> f32 {
    let h = |i: i32, j: i32| {
        let mut r = Rng::new((i as u32).wrapping_mul(73856093) ^ (j as u32).wrapping_mul(19349663) ^ seed);
        r.next()
    };
    let (xi, yi) = (x.floor() as i32, y.floor() as i32);
    let (fx, fy) = (x - xi as f32, y - yi as f32);
    let (sx, sy) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    let a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * sx;
    let b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * sx;
    a + (b - a) * sy
}

/// Uma imagem no tamanho de outra (as texturas de um modelo podem ter tamanhos diferentes).
fn fit(img: Rgba, w: u32, h: u32) -> Rgba {
    if img.width == w && img.height == h { img } else { dds::resize(&img, w, h) }
}

/// Neve no modelo: só nas superfícies viradas para cima (telhados, topos, ombros), com a borda
/// irregular; nunca na cor do time nem nas luzes. O relevo da textura continua aparecendo.
fn snow_on_model(diffuse: &mut Rgba, up: &[f32], team: Option<&Rgba>, mask: Option<&Rgba>) {
    let w = diffuse.width;
    let (lums, mean, std) = lum_stats(diffuse);
    const SNOW: [f32; 3] = [232.0, 237.0, 246.0];
    diffuse.pixels.par_chunks_exact_mut(4).enumerate().for_each(|(i, p)| {
        let u = up[i];
        if u < 0.0 {
            return;
        }
        let (x, y) = ((i as u32 % w) as f32, (i as u32 / w) as f32);
        let n = value_noise(x / 11.0, y / 11.0, 5) * 0.65 + value_noise(x / 3.5, y / 3.5, 9) * 0.35;
        let mut amount = smooth(0.42 + 0.28 * (n - 0.5), 0.82, u);
        if let Some(t) = team {
            amount *= 1.0 - t.pixels[i * 4 + 1] as f32 / 255.0;
        }
        if let Some(m) = mask {
            amount *= 1.0 - m.pixels[i * 4 + 1] as f32 / 255.0;
        }
        if amount <= 0.0 {
            return;
        }
        // a neve segue o relevo pintado (painéis, frestas e rebites continuam aparecendo)
        let detail = ((lums[i] - mean) / std).clamp(-2.5, 2.5);
        let amount = amount * 0.86;
        for (k, c) in p.iter_mut().take(3).enumerate() {
            let snow = SNOW[k] * (0.86 + 0.07 * detail);
            *c = (*c as f32 * (1.0 - amount) + snow * amount).clamp(0.0, 255.0) as u8;
        }
    });
}

/// Molhado no modelo: mais brilho (canais de brilho da máscara), muito mais nas superfícies expostas
/// à chuva (as de cima) do que nas de lado e quase nada embaixo. Metal que já brilha muda pouco,
/// superfícies foscas mudam mais. As luzes (canal verde) ficam como estão.
fn wet_model_mask(mask: &mut Rgba, up: &[f32]) {
    mask.pixels.par_chunks_exact_mut(4).enumerate().for_each(|(i, p)| {
        let u = up[i];
        if u < -1.5 {
            return;
        }
        let wet = 0.25 + 0.75 * smooth(-0.2, 0.75, u);
        for k in [0usize, 2] {
            let v = p[k] as f32;
            p[k] = (v + (255.0 - v) * 0.4 * wet).min(255.0) as u8;
        }
    });
}

fn read_dds(sources: &[PathBuf], path: &str) -> Result<(crate::dds::DdsInfo, Rgba)> {
    dds::decode(&mapassets::read_game_file(sources, path)?)
}

fn encode_like(img: &Rgba, info: &crate::dds::DdsInfo) -> Result<Vec<u8>> {
    let format = match info.format {
        DdsFormat::Dxt1 | DdsFormat::Dxt3 | DdsFormat::Dxt5 | DdsFormat::Bgra8 | DdsFormat::Bgrx8 => info.format,
        _ => DdsFormat::Dxt5,
    };
    dds::encode(img, format, info.mip_count.max(1), dds::Quality::Normal)
}

/// As texturas de um modelo no clima: (caminho no `.scd`, DDS).
fn model_textures(sources: &[PathBuf], set: &ModelSet, kind: Kind) -> Result<Vec<(String, Vec<u8>)>> {
    let mesh = crate::scm::read(&mapassets::read_game_file(sources, &set.mesh)?)?;
    if kind.wet() {
        let Some(mask_path) = &set.mask else { return Ok(Vec::new()) };
        let (info, mut mask) = read_dds(sources, mask_path)?;
        let up = up_map(&mesh, mask.width, mask.height);
        wet_model_mask(&mut mask, &up);
        Ok(vec![(scd_path(mask_path), encode_like(&mask, &info)?)])
    } else {
        let (info, mut diffuse) = read_dds(sources, &set.diffuse)?;
        let (w, h) = (diffuse.width, diffuse.height);
        let up = up_map(&mesh, w, h);
        let team = set.team.as_ref().and_then(|p| read_dds(sources, p).ok()).map(|(_, t)| fit(t, w, h));
        let mask = set.mask.as_ref().and_then(|p| read_dds(sources, p).ok()).map(|(_, m)| fit(m, w, h));
        snow_on_model(&mut diffuse, &up, team.as_ref(), mask.as_ref());
        Ok(vec![(scd_path(&set.diffuse), encode_like(&diffuse, &info)?)])
    }
}

/// Versão do mod dos modelos: muda com o clima (molhado ou neve) e com os arquivos de origem.
pub fn models_version(sources: &[PathBuf], kind: Kind) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(format!("{MOD_VERSION}|models|{}", if kind.wet() { "wet" } else { "snow" }));
    for p in sources {
        let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        h.update(format!("|{}:{size}", p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()));
    }
    format!("{MOD_VERSION}+{}", &hex::encode(h.finalize())[..12])
}

/// Monta o mod dos modelos (unidades e prédios no clima). Modelos que não deu para ler ficam como
/// estão. Devolve o arquivo e quantos modelos mudaram.
pub fn build_models(sources: &[PathBuf], kind: Kind, dest: &Path) -> Result<(PathBuf, usize)> {
    let sets = model_sets(sources);
    let done: Vec<Vec<(String, Vec<u8>)>> = sets.par_iter().filter_map(|s| model_textures(sources, s, kind).ok()).filter(|v| !v.is_empty()).collect();
    if done.is_empty() {
        return Err(Error::Other("nenhum modelo de unidade foi encontrado nos arquivos do jogo".into()));
    }
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    for (path, data) in done.iter().flatten() {
        b.add_bytes(path, data)?;
    }
    Ok((b.finish()?, done.len()))
}

// ------------------------------------------------------------------ montagem

fn latin1(raw: &[u8]) -> String {
    raw.iter().map(|&b| b as char).collect::<String>().replace("\r\n", "\n")
}

fn to_latin1(text: &str) -> Vec<u8> {
    text.chars().map(|c| if (c as u32) < 256 { c as u8 } else { b'?' }).collect()
}

fn game_lua(sources: &[PathBuf], path: &str) -> Result<String> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let raw = mapassets::read_game_file(sources, &format!("/uncompiled{path}"))
        .map_err(|_| Error::Other(format!("o jogo não tem o {name} em texto (uncompiled_lua.scd): não dá para montar o clima")))?;
    if crate::lua::inspect(&raw).compiled {
        return Err(Error::Other(format!("o {name} do jogo está compilado: não dá para montar o clima")));
    }
    Ok(latin1(&raw))
}

fn append(text: &str, code: &str) -> Result<String> {
    if text.contains("CommandProject: weather") {
        return Err(Error::Other("o arquivo do jogo já tem o clima: use o original do jogo".into()));
    }
    let mut out = text.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(code);
    Ok(out)
}

/// `ScenarioUtilities.lua` com o código da simulação (precisa de `CreateResources`, que ele envolve).
pub fn patch_sim(text: &str) -> Result<String> {
    patch_sim_with(text, SIM_CODE)
}

fn patch_sim_with(text: &str, code: &str) -> Result<String> {
    if !text.contains("function CreateResources(") {
        return Err(Error::Other("o ScenarioUtilities.lua do jogo é diferente do esperado: não deu para ligar o clima".into()));
    }
    append(text, code)
}

/// O código da simulação com a quantidade de partículas por segundo de cada emissor desta partida
/// (o Lua muda todas juntas com a intensidade do momento, sem trocar emissores de célula em célula).
fn sim_code(emitters: &[Emitter]) -> String {
    let mut table = String::from("local CPWeatherRates = {\n");
    for e in emitters {
        if let Some((_, rate, _)) = e.curves.iter().find(|(n, _, _)| *n == "EmitRateCurve") {
            table.push_str(&format!("    ['/{}'] = {rate:.4},\n", e.path.to_ascii_lowercase()));
        }
    }
    table.push_str("}\n");
    SIM_CODE.replacen("local CPWeatherRates = {}\n", &table, 1)
}

/// `timer.lua` com o código da interface (precisa de `CreateTimerDialog`, que ele envolve).
pub fn patch_ui(text: &str) -> Result<String> {
    if !text.contains("function CreateTimerDialog(") {
        return Err(Error::Other("o timer.lua do jogo é diferente do esperado: não deu para ligar o clima".into()));
    }
    append(text, UI_CODE)
}

/// Monta o `.scd` do clima em `dest`: código, emissores, partículas e o chão do mapa do cenário.
/// Sem o terreno do mapa (mapa que não dá para ler) o clima vale do mesmo jeito, com o chão original.
pub fn build(sources: &[PathBuf], scenario: &str, kind: Kind, amount: f32, dest: &Path) -> Result<PathBuf> {
    let amount = clamp_amount(amount);
    let emitters = emitters(kind, amount);
    let code = sim_code(&emitters);
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for f in SIM_FILES {
        match game_lua(sources, f) {
            Ok(text) => files.push((f.trim_start_matches('/').to_string(), to_latin1(&patch_sim_with(&text, &code)?))),
            // a cópia da expansão só existe com a expansão
            Err(e) if f.contains("/DLC1/") => eprintln!("clima: {e}"),
            Err(e) => return Err(e),
        }
    }
    files.push((UI_FILE.trim_start_matches('/').to_string(), to_latin1(&patch_ui(&game_lua(sources, UI_FILE)?)?)));
    for e in &emitters {
        files.push((e.path.clone(), blueprint(e).into_bytes()));
    }
    let particles: Vec<(String, Vec<u8>)> = particle_images()
        .into_par_iter()
        .map(|(name, img)| dds::encode(&img, DdsFormat::Bgra8, 0, dds::Quality::Fast).map(|d| (name.to_string(), d)))
        .collect::<Result<_>>()?;
    for (name, data) in particles {
        // o motor procura o `.win.dds`; o `.dds` fica junto por garantia (são pequenas)
        files.push((format!("textures/particles/{name}.win.dds"), data.clone()));
        files.push((format!("textures/particles/{name}.dds"), data));
    }
    match ground_textures(sources, scenario, kind) {
        Ok(ground) => files.extend(ground),
        Err(e) => eprintln!("clima: {e}"),
    }
    files.extend(water_textures(sources, kind));
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    for (path, data) in &files {
        b.add_bytes(path, data)?;
    }
    b.finish()
}

/// Versão do mod montado para uma partida: muda com o clima, a quantidade, o mapa e os arquivos de
/// onde vêm as texturas (outro mod de texturas ligado, jogo atualizado). Igual à instalada = é só ligar.
pub fn build_version(sources: &[PathBuf], scenario: &str, kind: Kind, amount: f32) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(format!("{MOD_VERSION}|{}|{:.2}|{}", kind.key(), clamp_amount(amount), scenario.to_ascii_lowercase()));
    for p in sources {
        let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
        h.update(format!("|{}:{size}", p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()));
    }
    format!("{MOD_VERSION}+{}", &hex::encode(h.finalize())[..12])
}

/// Resumo para a biblioteca.
pub fn describe(kind: Kind) -> String {
    match kind {
        Kind::Rain => "Chuva na partida: gotas que caem no mapa, respingos no chão e na água e o chão molhado.".into(),
        Kind::Storm => "Tempestade na partida: chuva forte com vento, raios e o chão encharcado.".into(),
        Kind::Blizzard => "Nevasca na partida: neve caindo com vento, neve levantada do chão e o mapa coberto de neve.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kinds_and_amounts() {
        assert_eq!(Kind::parse("STORM"), Some(Kind::Storm));
        assert_eq!(Kind::parse("snow"), Some(Kind::Blizzard));
        assert_eq!(Kind::parse("sun"), None);
        assert_eq!(clamp_amount(9.0), 2.0);
        assert_eq!(clamp_amount(f32::NAN), 1.0);
    }

    #[test]
    fn emitters_match_the_lua() {
        // os caminhos que o Lua usa precisam existir nos emissores montados
        let rain: Vec<String> = emitters(Kind::Storm, 1.0).into_iter().map(|e| e.path.to_ascii_lowercase()).collect();
        let snow: Vec<String> = emitters(Kind::Blizzard, 1.0).into_iter().map(|e| e.path.to_ascii_lowercase()).collect();
        let lua = SIM_CODE.to_ascii_lowercase();
        assert!(lua.contains("local cpweatherbase = 20") && lua.contains("{ 1, 2, 4, 8, 16, 32 }"));
        for p in rain.iter().chain(snow.iter()) {
            let file = p.rsplit('/').next().unwrap();
            let base = file.trim_end_matches("_emit.bp");
            // os nomes da grade são montados no Lua (stratus_NN); os fixos aparecem inteiros
            assert!(lua.contains(file) || base.starts_with("weather_stratus_"), "{p} não aparece no Lua");
        }
        assert_eq!(rain.len(), 6 * 2 + 3 + 3);
        assert_eq!(snow.len(), 6 * 3);
        // o Lua recebe a quantidade de cada emissor (para mudar todas juntas)
        let code = sim_code(&emitters(Kind::Storm, 1.0));
        assert!(!code.contains("local CPWeatherRates = {}\n"));
        assert!(code.contains("    ['/effects/emitters/ambient/weather/dust/weather_sand_01_emit.bp'] = 22.0000,\n"), "{}", &code[..2000.min(code.len())]);
        assert!(code.contains("    ['/effects/emitters/ambient/weather/rain/weather_rainfall_01_emit.bp'] = 14.0000,\n"));
        // nenhum arquivo usado duas vezes
        let mut all: Vec<&String> = rain.iter().collect();
        all.sort();
        all.dedup();
        assert_eq!(all.len(), rain.len());
        let mut all: Vec<&String> = snow.iter().collect();
        all.sort();
        all.dedup();
        assert_eq!(all.len(), snow.len());
        let bp = blueprint(&emitters(Kind::Rain, 1.0)[0]);
        assert!(bp.starts_with("EmitterBlueprint {\r\n\tBlueprintId = 'weather_rainfall_01',"));
        assert!(bp.contains("\tEmitIfVisible = false,") && bp.contains("\tAlignRotation = true,"));
        assert!(bp.contains("[[/textures/particles/cp_rain_drop.dds]]"));
        assert!(bp.contains("{ x=10.000,y=9.000,z=0.000 }"), "{bp}");
        // posição sorteada para os dois lados do centro da célula, um pouco além dela
        assert!(bp.contains("ZPosCurve = {\r\n\t\tXRange = 10.00,\r\n\t\tKeys = {\r\n\t\t\t{ x=0.000,y=0.000,z=14.000 }"), "{bp}");
    }

    #[test]
    fn particle_textures_are_valid() {
        for (name, img) in particle_images() {
            assert_eq!(img.pixels.len(), (img.width * img.height * 4) as usize, "{name}");
            let alpha: u32 = img.pixels.chunks_exact(4).map(|p| p[3] as u32).sum();
            assert!(alpha > 0, "{name} vazia");
            let dds = dds::encode(&img, DdsFormat::Bgra8, 0, dds::Quality::Fast).unwrap();
            assert_eq!(dds::info(&dds).unwrap().width, img.width);
        }
        // o raio tem o pé embaixo e a cabeça em cima
        let b = bolt(1);
        let row_alpha = |y: u32| (0..b.width).map(|x| b.pixels[((y * b.width + x) * 4 + 3) as usize] as u32).sum::<u32>();
        assert!(row_alpha(5) > 0 && row_alpha(240) > 0);
        assert_ne!(bolt(1), bolt(2));
    }

    #[test]
    fn noise_wraps_around() {
        let n = tile_noise(64, 64, 3, RIPPLE_FREQS);
        // a coluna 0 continua a coluna 63 (sem degrau na emenda do ladrilho)
        let jump: f32 = (0..64).map(|j| (n[j * 64] - n[j * 64 + 63]).abs()).fold(0.0, f32::max);
        let inside: f32 = (0..64).map(|j| (n[j * 64 + 31] - n[j * 64 + 32]).abs()).fold(0.0, f32::max);
        assert!(jump < inside * 3.0 + 0.05, "{jump} {inside}");
    }

    #[test]
    fn water_gets_rougher() {
        // normal quase plana: depois de agitar, desvia mais e continua normalizada
        let mut img = Rgba { width: 16, height: 16, pixels: [140u8, 120, 250, 255].repeat(256) };
        stir_water(&mut img, 1.9, 0.0);
        assert!(img.pixels[0] > 140 && img.pixels[1] < 120 && img.pixels[3] == 255);
        let (x, y, z) = [0, 1, 2].map(|k| (img.pixels[k] as f32 - 127.5) / 127.5).into();
        assert!((x * x + y * y + z * z - 1.0).abs() < 0.05);
    }

    #[test]
    fn ground_looks() {
        let grass = Rgba { width: 8, height: 8, pixels: [80u8, 83, 46, 255].repeat(64) };
        let mut wet = grass.clone();
        wet_color(&mut wet, Ground::Grass);
        assert!(wet.pixels[0] < 80 && wet.pixels[3] == 255);
        let mut snow = grass.clone();
        snow_color(&mut snow, Ground::Grass);
        assert!(snow.pixels[0] > 180 && snow.pixels[2] > 190);
        let mut shine = Rgba { width: 8, height: 8, pixels: [40u8, 40, 40, 255].repeat(64) };
        wet_shine(&mut shine, Ground::Rock);
        assert!(shine.pixels[0] > 150);
        assert_eq!(ground_of("sc2_mp_002_cliff01"), Ground::Rock);
        assert_eq!(ground_of("snow01"), Ground::Snow);
        assert_eq!(ground_of("earth01"), Ground::Soil);
        assert_eq!(terrain_path("/maps/SC2_MP_002/SC2_MP_002_scenario.lua").unwrap(), "/maps/SC2_MP_002/SC2_MP_002.terrain.bdf");
        assert_eq!(scd_path("/textures/Terrain/a_d.dds"), "textures/Terrain/a_d.dds");
        assert_eq!(scd_path("/textures/Terrain/a_d.win.dds"), "textures/Terrain/a_d.dds");
    }

    #[test]
    fn versions_follow_the_match() {
        let a = build_version(&[], "/maps/A/A_scenario.lua", Kind::Rain, 1.0);
        assert!(a.starts_with(&format!("{MOD_VERSION}+")));
        assert_eq!(a, build_version(&[], "/MAPS/a/a_scenario.lua", Kind::Rain, 1.0));
        assert_ne!(a, build_version(&[], "/maps/A/A_scenario.lua", Kind::Storm, 1.0));
        assert_ne!(a, build_version(&[], "/maps/A/A_scenario.lua", Kind::Rain, 1.5));
        assert_ne!(a, build_version(&[PathBuf::from("x.scd")], "/maps/A/A_scenario.lua", Kind::Rain, 1.0));
    }

    #[test]
    fn patches() {
        let sim = patch_sim("function CreateResources()\nend\n").unwrap();
        assert!(sim.contains("local CPWeatherCreateResources = CreateResources"));
        assert!(patch_sim(&sim).is_err());
        assert!(patch_sim("nada").is_err());
        let ui = patch_ui("function CreateTimerDialog(parent)\nend\n").unwrap();
        assert!(ui.contains("local CPWeatherCreateTimerDialog = CreateTimerDialog"));
        assert!(patch_ui("x").is_err());
    }

    /// Modelos reais (`CP_UNITS` = um .scd com unidades; `CP_WEATHER_OUT` = pasta das prévias PNG).
    #[test]
    fn real_models_preview() {
        let Some(src) = std::env::var_os("CP_UNITS") else { return };
        let out = std::env::var_os("CP_WEATHER_OUT").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let sources = vec![PathBuf::from(src)];
        let sets = model_sets(&sources);
        assert!(!sets.is_empty());
        for set in &sets {
            for kind in [Kind::Blizzard, Kind::Rain] {
                let t = std::time::Instant::now();
                let files = model_textures(&sources, set, kind).unwrap();
                for (path, data) in files {
                    let (_, img) = dds::decode(&data).unwrap();
                    let name = format!("{}_{}.png", path.rsplit('/').next().unwrap(), kind.key());
                    std::fs::write(out.join(name), dds::to_png(&img).unwrap()).unwrap();
                }
                eprintln!("{} {:?} {:?}", set.diffuse, kind, t.elapsed());
            }
        }
    }

    /// Monta com os arquivos reais do jogo (`CP_GAMEDATA` = pasta `gamedata`; `CP_WEATHER_OUT` = pasta
    /// do `.scd`; `CP_WEATHER_KIND` e `CP_WEATHER_MAP` opcionais).
    #[test]
    fn real_game_build() {
        let Some(dir) = std::env::var_os("CP_GAMEDATA") else { return };
        let dir = PathBuf::from(dir);
        let mut sources: Vec<PathBuf> = std::fs::read_dir(&dir).unwrap().filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().map(|x| x == "scd").unwrap_or(false)).collect();
        sources.sort();
        let kind = Kind::parse(&std::env::var("CP_WEATHER_KIND").unwrap_or_else(|_| "rain".into())).unwrap();
        let map = std::env::var("CP_WEATHER_MAP").unwrap_or_else(|_| "/maps/SC2_MP_002/SC2_MP_002_scenario.lua".into());
        let out = std::env::var_os("CP_WEATHER_OUT").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let t = std::time::Instant::now();
        let scd = build(&sources, &map, kind, 1.0, &out.join(ARCHIVE)).unwrap();
        eprintln!("{} em {:?}", scd.display(), t.elapsed());
    }
}
