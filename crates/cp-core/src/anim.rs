//! Animações `.sca` (família Supreme Commander).
//!
//! ```text
//! "ANIM" u32 versão u32 nº de quadros f32 duração(s) u32 nº de ossos
//!        u32 offset dos nomes u32 offset das ligações u32 offset dos dados u32 tamanho do quadro
//! nomes:     textos terminados em 0, um por osso
//! ligações:  i32 por osso (pai; -1 = raiz)
//! dados:     f32[3] deslocamento + f32[4] rotação (w,x,y,z) do conjunto, depois os quadros:
//!            f32 tempo, u32 flags, e por osso f32[3] posição + f32[4] rotação (w,x,y,z)
//! ```
//!
//! Seções alinhadas a 32 bytes com marcadores (`NAME`, `LINK`, `DATA`) no preenchimento, como no
//! `.scm`. O leitor usa os offsets do cabeçalho, então tolera variações de alinhamento.

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub time: f32,
    pub flags: u32,
    /// por osso: posição (x, y, z)
    pub positions: Vec<[f32; 3]>,
    /// por osso: rotação (w, x, y, z)
    pub rotations: Vec<[f32; 4]>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Animation {
    pub version: u32,
    pub duration: f32,
    pub bones: Vec<String>,
    pub parents: Vec<i32>,
    pub delta_position: [f32; 3],
    pub delta_rotation: [f32; 4],
    pub frames: Vec<Frame>,
}

fn u32_at(d: &[u8], o: usize) -> Result<u32> {
    d.get(o..o + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap())).ok_or_else(|| Error::Format("SCA truncado".into()))
}

fn f32_at(d: &[u8], o: usize) -> Result<f32> {
    Ok(f32::from_bits(u32_at(d, o)?))
}

pub fn read(d: &[u8]) -> Result<Animation> {
    if d.len() < 36 || &d[0..4] != b"ANIM" {
        return Err(Error::Format("não é uma animação SCA (assinatura ANIM ausente)".into()));
    }
    let version = u32_at(d, 4)?;
    let nframes = u32_at(d, 8)? as usize;
    let duration = f32_at(d, 12)?;
    let nbones = u32_at(d, 16)? as usize;
    let names_off = u32_at(d, 20)? as usize;
    let links_off = u32_at(d, 24)? as usize;
    let data_off = u32_at(d, 28)? as usize;
    let frame_size = u32_at(d, 32)? as usize;
    if nbones > 4096 || nframes > 100_000 || frame_size != 8 + nbones * 28 {
        return Err(Error::Format("SCA com contagens inválidas".into()));
    }
    let mut bones = Vec::with_capacity(nbones);
    let mut o = names_off;
    for _ in 0..nbones {
        let rest = d.get(o..).ok_or_else(|| Error::Format("nomes fora do arquivo".into()))?;
        let end = rest.iter().position(|&b| b == 0).ok_or_else(|| Error::Format("nome de osso sem fim".into()))?;
        bones.push(String::from_utf8_lossy(&rest[..end]).into_owned());
        o += end + 1;
    }
    let parents = (0..nbones).map(|i| u32_at(d, links_off + i * 4).map(|v| v as i32)).collect::<Result<Vec<_>>>()?;
    let delta_position = [f32_at(d, data_off)?, f32_at(d, data_off + 4)?, f32_at(d, data_off + 8)?];
    let delta_rotation = [f32_at(d, data_off + 12)?, f32_at(d, data_off + 16)?, f32_at(d, data_off + 20)?, f32_at(d, data_off + 24)?];
    let mut frames = Vec::with_capacity(nframes);
    for f in 0..nframes {
        let b = data_off + 28 + f * frame_size;
        let mut positions = Vec::with_capacity(nbones);
        let mut rotations = Vec::with_capacity(nbones);
        for k in 0..nbones {
            let o = b + 8 + k * 28;
            positions.push([f32_at(d, o)?, f32_at(d, o + 4)?, f32_at(d, o + 8)?]);
            rotations.push([f32_at(d, o + 12)?, f32_at(d, o + 16)?, f32_at(d, o + 20)?, f32_at(d, o + 24)?]);
        }
        frames.push(Frame { time: f32_at(d, b)?, flags: u32_at(d, b + 4)?, positions, rotations });
    }
    Ok(Animation { version, duration, bones, parents, delta_position, delta_rotation, frames })
}

fn pad(out: &mut Vec<u8>, marker: &[u8; 4]) {
    let n = (32 - (out.len() + 4) % 32) % 32;
    out.extend(std::iter::repeat_n(0xC5u8, n));
    out.extend_from_slice(marker);
}

pub fn write(a: &Animation) -> Result<Vec<u8>> {
    let nb = a.bones.len();
    if nb == 0 || a.parents.len() != nb {
        return Err(Error::Format("animação sem ossos (ou ligações erradas)".into()));
    }
    if a.frames.iter().any(|f| f.positions.len() != nb || f.rotations.len() != nb) {
        return Err(Error::Format("quadro com número de ossos diferente".into()));
    }
    let mut out = vec![0u8; 36];
    out[0..4].copy_from_slice(b"ANIM");
    pad(&mut out, b"NAME");
    let names_off = out.len();
    for n in &a.bones {
        out.extend_from_slice(n.as_bytes());
        out.push(0);
    }
    pad(&mut out, b"LINK");
    let links_off = out.len();
    for p in &a.parents {
        out.extend_from_slice(&p.to_le_bytes());
    }
    pad(&mut out, b"DATA");
    let data_off = out.len();
    for v in a.delta_position.iter().chain(&a.delta_rotation) {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for f in &a.frames {
        out.extend_from_slice(&f.time.to_le_bytes());
        out.extend_from_slice(&f.flags.to_le_bytes());
        for (p, r) in f.positions.iter().zip(&f.rotations) {
            for v in p.iter().chain(r) {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    let version = if a.version == 0 { 5 } else { a.version };
    let head = [version, a.frames.len() as u32, a.duration.to_bits(), nb as u32, names_off as u32, links_off as u32, data_off as u32, (8 + nb * 28) as u32];
    for (i, v) in head.iter().enumerate() {
        out[4 + i * 4..8 + i * 4].copy_from_slice(&v.to_le_bytes());
    }
    Ok(out)
}

/// Quadro-chave simples do editor: posição e rotação (graus, XYZ) de um osso num instante.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Key {
    pub bone: String,
    pub time: f32,
    pub pos: [f32; 3],
    /// graus (x, y, z), aplicados em ordem XYZ
    pub rot: [f32; 3],
}

/// Monta uma animação a partir de quadros-chave por osso (interpolação linear / slerp),
/// amostrada em `fps` quadros por segundo. Ossos sem chave ficam na pose de repouso.
pub fn from_keys(bones: &[(String, i32, [f32; 3], [f32; 4])], keys: &[Key], duration: f32, fps: f32) -> Result<Animation> {
    if bones.is_empty() {
        return Err(Error::Format("o modelo não tem ossos para animar".into()));
    }
    let duration = duration.clamp(0.05, 600.0);
    let n = ((duration * fps.clamp(5.0, 60.0)).round() as usize).max(2);
    let mut frames = Vec::with_capacity(n);
    for f in 0..n {
        let t = duration * f as f32 / (n - 1) as f32;
        let mut positions = Vec::with_capacity(bones.len());
        let mut rotations = Vec::with_capacity(bones.len());
        for (name, _, rest_pos, rest_rot) in bones {
            let mut ks: Vec<&Key> = keys.iter().filter(|k| &k.bone == name).collect();
            ks.sort_by(|a, b| a.time.total_cmp(&b.time));
            let (p, r) = if ks.is_empty() {
                (*rest_pos, *rest_rot)
            } else {
                let i = ks.iter().position(|k| k.time >= t).unwrap_or(ks.len());
                let (a, b) = match i {
                    0 => (ks[0], ks[0]),
                    i if i >= ks.len() => (ks[ks.len() - 1], ks[ks.len() - 1]),
                    i => (ks[i - 1], ks[i]),
                };
                let u = if b.time > a.time { (t - a.time) / (b.time - a.time) } else { 0.0 };
                let pos = [0, 1, 2].map(|k| rest_pos[k] + a.pos[k] + (b.pos[k] - a.pos[k]) * u);
                let qa = euler_quat(a.rot);
                let qb = euler_quat(b.rot);
                (pos, mul(*rest_rot, slerp(qa, qb, u)))
            };
            positions.push(p);
            rotations.push(r);
        }
        frames.push(Frame { time: t, flags: 0, positions, rotations });
    }
    Ok(Animation {
        version: 5,
        duration,
        bones: bones.iter().map(|b| b.0.clone()).collect(),
        parents: bones.iter().map(|b| b.1).collect(),
        delta_position: [0.0; 3],
        delta_rotation: [1.0, 0.0, 0.0, 0.0],
        frames,
    })
}

/// graus XYZ → quaternion (w, x, y, z)
pub fn euler_quat(deg: [f32; 3]) -> [f32; 4] {
    let [x, y, z] = deg.map(|d| d.to_radians() / 2.0);
    let (sx, cx, sy, cy, sz, cz) = (x.sin(), x.cos(), y.sin(), y.cos(), z.sin(), z.cos());
    // ordem XYZ (como o three.js)
    [
        cx * cy * cz - sx * sy * sz,
        sx * cy * cz + cx * sy * sz,
        cx * sy * cz - sx * cy * sz,
        cx * cy * sz + sx * sy * cz,
    ]
}

fn mul(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    [
        a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
        a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
        a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
        a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ]
}

fn slerp(a: [f32; 4], mut b: [f32; 4], t: f32) -> [f32; 4] {
    let mut dot: f32 = (0..4).map(|i| a[i] * b[i]).sum();
    if dot < 0.0 {
        b = b.map(|v| -v);
        dot = -dot;
    }
    let r = if dot > 0.9995 {
        [0, 1, 2, 3].map(|i| a[i] + (b[i] - a[i]) * t)
    } else {
        let th = dot.acos();
        let s = th.sin();
        let (wa, wb) = (((1.0 - t) * th).sin() / s, (t * th).sin() / s);
        [0, 1, 2, 3].map(|i| a[i] * wa + b[i] * wb)
    };
    let len = r.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-9);
    r.map(|v| v / len)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_to_sca_roundtrip() {
        let bones = vec![
            ("Root".to_string(), -1, [0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
            ("Turret".to_string(), 0, [0.0, 1.0, 0.0], [1.0, 0.0, 0.0, 0.0]),
        ];
        let keys = vec![
            Key { bone: "Turret".into(), time: 0.0, pos: [0.0; 3], rot: [0.0, 0.0, 0.0] },
            Key { bone: "Turret".into(), time: 1.0, pos: [0.0; 3], rot: [0.0, 90.0, 0.0] },
        ];
        let a = from_keys(&bones, &keys, 1.0, 30.0).unwrap();
        assert_eq!(a.frames.len(), 30);
        let last = &a.frames.last().unwrap().rotations[1];
        assert!((last[0] - (45f32.to_radians()).cos()).abs() < 1e-4, "{last:?}");
        assert!((a.frames[0].positions[1][1] - 1.0).abs() < 1e-6);
        let bytes = write(&a).unwrap();
        let b = read(&bytes).unwrap();
        assert_eq!(b.bones, vec!["Root", "Turret"]);
        assert_eq!(b.parents, vec![-1, 0]);
        assert_eq!(b.frames.len(), 30);
        assert_eq!(b.frames[29].rotations[1], a.frames[29].rotations[1]);
        assert!(read(b"ANIMxx").is_err());
    }

    #[test]
    fn real_sca_if_available() {
        let Some(p) = std::env::var_os("CP_REAL_SCA") else { return };
        let data = std::fs::read(p).unwrap();
        let a = read(&data).unwrap();
        assert!(!a.bones.is_empty() && !a.frames.is_empty());
        assert!(write(&a).unwrap().len() + 64 >= data.len());
    }
}
