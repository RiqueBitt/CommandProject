//! Misturador de tropas: monta uma unidade nova com o **chassi** de uma unidade do jogo, a
//! **torre** de outra e a **arma** de uma terceira.
//!
//! - Malha: os vértices da torre (e do cano) são transplantados com rotação, escala e
//!   translação rígidas (sem escala nos ossos), encaixados no osso de torre do chassi.
//! - Ossos: os papéis (torre, cano, bocas de disparo) recebem os nomes que o chassi já usa, então
//!   as armas e as animações do chassi continuam achando os ossos.
//! - Texturas: cada parte usa um recorte da textura da sua unidade; os recortes vão para um atlas
//!   (cor, specteam e normal) e as UVs são remapeadas.
//! - Animações: as do chassi são adaptadas: ossos trocados mantêm o movimento (o "quanto girou e
//!   andou" em relação ao repouso), mas a partir da pose de repouso da peça nova.
//! - Verificações: limites do formato, ossos, peças afundadas ou flutuando, referências das armas.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::anim::{self, Animation};
use crate::dds::{self, DdsFormat, Rgba};
use crate::error::{Error, Result};
use crate::scm::{self, Bone, Model, Vertex};

type Q = [f32; 4]; // (w, x, y, z)
type V = [f32; 3];

fn q_mul(a: Q, b: Q) -> Q {
    [
        a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
        a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
        a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
        a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ]
}
fn q_conj(q: Q) -> Q {
    [q[0], -q[1], -q[2], -q[3]]
}
fn q_norm(q: Q) -> Q {
    let n = (q.iter().map(|v| v * v).sum::<f32>()).sqrt();
    if n < 1e-8 { [1.0, 0.0, 0.0, 0.0] } else { q.map(|v| v / n) }
}
fn q_rot(q: Q, v: V) -> V {
    let p = q_mul(q_mul(q, [0.0, v[0], v[1], v[2]]), q_conj(q));
    [p[1], p[2], p[3]]
}
fn add(a: V, b: V) -> V {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn sub(a: V, b: V) -> V {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn scale(a: V, s: f32) -> V {
    [a[0] * s, a[1] * s, a[2] * s]
}

/// matriz coluna-maior de uma transformação rígida
fn compose(pos: V, q: Q) -> [f32; 16] {
    let [w, x, y, z] = q;
    [
        1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w), 0.0,
        2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w), 0.0,
        2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y), 0.0,
        pos[0], pos[1], pos[2], 1.0,
    ]
}
fn rigid_inverse(m: &[f32; 16]) -> [f32; 16] {
    let mut o = [0f32; 16];
    for r in 0..3 {
        for c in 0..3 {
            o[c * 4 + r] = m[r * 4 + c];
        }
    }
    for r in 0..3 {
        o[12 + r] = -(0..3).map(|k| o[k * 4 + r] * m[12 + k]).sum::<f32>();
    }
    o[15] = 1.0;
    o
}

/// Pose de repouso de cada osso no espaço do modelo (posição, rotação), encadeando os locais.
fn world_pose(m: &Model) -> Vec<(V, Q)> {
    let mut out: Vec<(V, Q)> = Vec::with_capacity(m.bones.len());
    for (i, b) in m.bones.iter().enumerate() {
        let q = q_norm(b.rotation);
        let w = if b.parent >= 0 && (b.parent as usize) < i {
            let (pp, pq) = out[b.parent as usize];
            (add(pp, q_rot(pq, b.position)), q_norm(q_mul(pq, q)))
        } else {
            (b.position, q)
        };
        out.push(w);
    }
    out
}

fn lname(s: &str) -> String {
    s.to_ascii_lowercase()
}
fn is_turret(n: &str) -> bool {
    lname(n).contains("turret")
}
fn is_barrel(n: &str) -> bool {
    let l = lname(n);
    ["barrel", "gun", "cannon", "arm", "muzzle", "rack"].iter().any(|k| l.contains(k))
}
fn is_muzzle(n: &str) -> bool {
    lname(n).contains("muzzle")
}

fn children(m: &Model) -> Vec<Vec<usize>> {
    let mut c = vec![vec![]; m.bones.len()];
    for (i, b) in m.bones.iter().enumerate() {
        if b.parent >= 0 && (b.parent as usize) < m.bones.len() && b.parent as usize != i {
            c[b.parent as usize].push(i);
        }
    }
    c
}
fn subtree(m: &Model, root: usize) -> Vec<usize> {
    let ch = children(m);
    let mut out = vec![root];
    let mut k = 0;
    while k < out.len() {
        out.extend(ch[out[k]].iter().copied());
        k += 1;
    }
    out.sort_unstable();
    out
}

/// Osso de torre: o primeiro com "turret" no nome cujo pai não é torre.
pub fn turret_root(m: &Model) -> Option<usize> {
    m.bones.iter().enumerate().find(|(_, b)| {
        is_turret(&b.name) && (b.parent < 0 || !is_turret(&m.bones[b.parent as usize].name))
    }).map(|(i, _)| i)
}
/// Osso do cano/arma dentro da torre: o mais perto da raiz com nome de arma.
pub fn barrel_root(m: &Model, turret: usize) -> Option<usize> {
    let sub = subtree(m, turret);
    sub.into_iter().filter(|&i| i != turret && is_barrel(&m.bones[i].name)).find(|&i| {
        let p = m.bones[i].parent;
        p < 0 || !is_barrel(&m.bones[p as usize].name) || p as usize == turret
    })
}

fn bbox(m: &Model, bones: &[usize]) -> Option<(V, V)> {
    let set: std::collections::HashSet<u8> = bones.iter().map(|&b| b as u8).collect();
    let mut lo = [f32::MAX; 3];
    let mut hi = [f32::MIN; 3];
    let mut any = false;
    for v in &m.vertices {
        if !set.contains(&v.bones[0]) {
            continue;
        }
        any = true;
        for k in 0..3 {
            lo[k] = lo[k].min(v.position[k]);
            hi[k] = hi[k].max(v.position[k]);
        }
    }
    any.then_some((lo, hi))
}

// ------------------------------------------------------------------ entrada / saída

/// Uma unidade do jogo já lida: malha, texturas e animações (campo do blueprint → arquivo).
#[derive(Clone)]
pub struct Source {
    pub id: String,
    pub model: Model,
    pub albedo: Option<Vec<u8>>,
    pub specteam: Option<Vec<u8>>,
    pub normal: Option<Vec<u8>>,
    pub anims: Vec<(String, String, Animation)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct MixSpec {
    pub chassis: String,
    /// unidade que dá a torre (None = a do chassi)
    pub turret: Option<String>,
    /// unidade que dá a arma/cano (None = a da torre)
    pub weapon: Option<String>,
    /// escala da torre e da arma (0 = automática, do tamanho da peça original)
    pub turret_scale: f32,
    pub weapon_scale: f32,
    /// deslocamento da torre (unidades do modelo)
    pub turret_offset: [f32; 3],
    /// giro da torre em graus (em volta do eixo vertical)
    pub turret_yaw: f32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    /// "ok" | "warn" | "err" | "fix" (corrigido automaticamente)
    pub level: &'static str,
    pub text: String,
}

pub struct MixOut {
    pub model: Model,
    pub albedo: Vec<u8>,
    pub specteam: Vec<u8>,
    pub normal: Vec<u8>,
    /// atlas em PNG para a prévia
    pub albedo_png: Vec<u8>,
    pub team_png: Option<Vec<u8>>,
    /// animações do chassi adaptadas: (campo, caminho original, arquivo .sca novo)
    pub anims: Vec<(String, String, Vec<u8>)>,
    /// nomes dos ossos da unidade da arma → nomes na tropa nova
    pub weapon_bones: Vec<(String, String)>,
    /// ossos da tropa nova
    pub bones: Vec<String>,
    pub checks: Vec<Check>,
}

struct Part<'a> {
    src: &'a Source,
    bones: Vec<usize>,
    /// transformação rígida + escala: v' = q * (s * (v - from)) + to
    from: V,
    to: V,
    q: Q,
    s: f32,
    tex: usize,
}

/// Monta a malha, as texturas e as animações da tropa misturada.
pub fn mix(chassis: &Source, turret: Option<&Source>, weapon: Option<&Source>, spec: &MixSpec) -> Result<MixOut> {
    let mut checks: Vec<Check> = Vec::new();
    let a = &chassis.model;
    let aw = world_pose(a);
    let b_src = turret.unwrap_or(chassis);
    let c_src = weapon.unwrap_or(b_src);
    let a_turret = turret_root(a);
    let a_barrel = a_turret.and_then(|t| barrel_root(a, t));

    // ---------------- peças
    let mut parts: Vec<Part> = Vec::new();
    let replace_turret = turret.is_some() && b_src.id != chassis.id;
    let a_turret_sub = a_turret.map(|t| subtree(a, t)).unwrap_or_default();
    let keep_a: Vec<usize> = (0..a.bones.len()).filter(|i| !(replace_turret && a_turret_sub.contains(i))).collect();
    parts.push(Part { src: chassis, bones: keep_a.clone(), from: [0.0; 3], to: [0.0; 3], q: [1.0, 0.0, 0.0, 0.0], s: 1.0, tex: 0 });

    // torre
    let b = &b_src.model;
    let bw = world_pose(b);
    let b_turret = turret_root(b);
    let mut turret_part: Option<(usize, Vec<usize>)> = None; // (raiz na unidade B, ossos de B)
    if replace_turret {
        let Some(bt) = b_turret else {
            return Err(Error::Other(format!("{} não tem torre (osso com \"turret\" no nome) para usar", b_src.id)));
        };
        let mut tsub = subtree(b, bt);
        // a arma vem de outra unidade: o cano da torre B sai
        let replace_weapon = weapon.is_some() && c_src.id != b_src.id;
        if replace_weapon {
            if let Some(bb) = barrel_root(b, bt) {
                let rm = subtree(b, bb);
                tsub.retain(|i| !rm.contains(i));
            }
        }
        // onde encaixar: no osso de torre do chassi, ou em cima do corpo
        let (to, q_to) = match a_turret {
            Some(t) => aw[t],
            None => {
                let (lo, hi) = bbox(a, &(0..a.bones.len()).collect::<Vec<_>>()).unwrap_or(([0.0; 3], [0.0; 3]));
                checks.push(Check { level: "warn", text: format!("{} não tem torre: a torre nova vai em cima do corpo", chassis.id) });
                ([(lo[0] + hi[0]) / 2.0, hi[1], (lo[2] + hi[2]) / 2.0], [1.0, 0.0, 0.0, 0.0])
            }
        };
        // escala automática: largura da torre original do chassi / largura da torre nova
        let mut s = spec.turret_scale;
        if s <= 0.0 {
            s = 1.0;
            if let (Some(t), Some((lo2, hi2))) = (a_turret, bbox(b, &tsub)) {
                if let Some((lo1, hi1)) = bbox(a, &subtree(a, t)) {
                    let w1 = (hi1[0] - lo1[0]).max(hi1[2] - lo1[2]);
                    let w2 = (hi2[0] - lo2[0]).max(hi2[2] - lo2[2]);
                    if w1 > 1e-4 && w2 > 1e-4 {
                        s = (w1 / w2).clamp(0.35, 2.8);
                    }
                }
            }
        }
        let (from, q_from) = bw[bt];
        let yaw = spec.turret_yaw.to_radians() / 2.0;
        let q = q_mul(q_mul(q_to, [yaw.cos(), 0.0, yaw.sin(), 0.0]), q_conj(q_from));
        parts.push(Part { src: b_src, bones: tsub.clone(), from, to: add(to, spec.turret_offset), q, s, tex: 1 });
        turret_part = Some((bt, tsub));
    }

    // arma (cano) de outra unidade, encaixada no lugar do cano da torre
    let mut weapon_part_root: Option<usize> = None;
    if weapon.is_some() && c_src.id != b_src.id {
        let c = &c_src.model;
        let cw = world_pose(c);
        let ct = turret_root(c).ok_or_else(|| Error::Other(format!("{} não tem torre com arma para tirar", c_src.id)))?;
        let cb = barrel_root(c, ct).ok_or_else(|| Error::Other(format!("não achei o cano (osso barrel/gun/cannon/muzzle) de {}", c_src.id)))?;
        let wsub = subtree(c, cb);
        // ponto de encaixe: onde ficava o cano da torre (na unidade B), já transformado
        let host_part = parts.last().expect("chassi");
        let (anchor, anchor_q) = match (replace_turret, b_turret.and_then(|t| barrel_root(b, t))) {
            (true, Some(bb)) => (add(q_rot(host_part.q, scale(sub(bw[bb].0, host_part.from), host_part.s)), host_part.to), q_mul(host_part.q, bw[bb].1)),
            (false, _) => match a_barrel.or(a_turret) {
                Some(x) => aw[x],
                None => return Err(Error::Other(format!("{} não tem torre nem cano para receber a arma", chassis.id))),
            },
            (true, None) => {
                let r = b_turret.expect("torre");
                (add(q_rot(host_part.q, scale(sub(bw[r].0, host_part.from), host_part.s)), host_part.to), q_mul(host_part.q, bw[r].1))
            }
        };
        let mut s = spec.weapon_scale;
        if s <= 0.0 {
            s = 1.0;
            // comprimento do cano original (o que sai) / do cano novo
            let old = if replace_turret {
                b_turret.and_then(|t| barrel_root(b, t)).and_then(|bb| bbox(b, &subtree(b, bb))).map(|(lo, hi)| (hi[2] - lo[2]).abs().max((hi[0] - lo[0]).abs()) * parts.last().map(|p| p.s).unwrap_or(1.0))
            } else {
                a_barrel.and_then(|bb| bbox(a, &subtree(a, bb))).map(|(lo, hi)| (hi[2] - lo[2]).abs().max((hi[0] - lo[0]).abs()))
            };
            if let (Some(o), Some((lo, hi))) = (old, bbox(c, &wsub)) {
                let n = (hi[2] - lo[2]).abs().max((hi[0] - lo[0]).abs());
                if o > 1e-4 && n > 1e-4 {
                    s = (o / n).clamp(0.3, 3.0);
                }
            }
        }
        let (from, q_from) = cw[cb];
        if !replace_turret {
            // o cano original do chassi sai
            if let Some(ab) = a_barrel {
                let rm = subtree(a, ab);
                parts[0].bones.retain(|i| !rm.contains(i));
            }
        }
        parts.push(Part { src: c_src, bones: wsub, from, to: anchor, q: q_mul(anchor_q, q_conj(q_from)), s, tex: 2 });
        weapon_part_root = Some(cb);
    }

    // ---------------- nomes dos ossos: papéis recebem os nomes do chassi
    let a_muzzles: Vec<String> = a_turret_sub.iter().filter(|&&i| is_muzzle(&a.bones[i].name)).map(|&i| a.bones[i].name.clone()).collect();
    let mut taken: std::collections::HashSet<String> = parts[0].bones.iter().map(|&i| lname(&a.bones[i].name)).collect();
    let mut rename = |src_name: &str, wanted: Option<&str>, prefix: &str| -> String {
        if let Some(w) = wanted {
            if taken.insert(lname(w)) {
                return w.to_string();
            }
        }
        let mut n = src_name.to_string();
        if !taken.insert(lname(&n)) {
            let mut k = 1;
            loop {
                n = format!("{prefix}{src_name}{}", if k > 1 { k.to_string() } else { String::new() });
                if taken.insert(lname(&n)) {
                    break;
                }
                k += 1;
            }
        }
        n
    };
    let mut part_names: Vec<HashMap<usize, String>> = vec![HashMap::new(); parts.len()];
    let mut muzzle_slot = 0usize;
    for (pi, p) in parts.iter().enumerate() {
        let m = &p.src.model;
        for &i in &p.bones {
            let nm = &m.bones[i].name;
            let name = if pi == 0 {
                nm.clone()
            } else {
                let wanted = if Some(i) == turret_part.as_ref().map(|t| t.0).filter(|_| p.tex == 1) {
                    a_turret.map(|t| a.bones[t].name.as_str())
                } else if Some(i) == weapon_part_root.filter(|_| p.tex == 2) || (p.tex == 1 && weapon_part_root.is_none() && Some(i) == b_turret.and_then(|t| barrel_root(m, t))) {
                    a_barrel.map(|x| a.bones[x].name.as_str())
                } else if is_muzzle(nm) {
                    let w = a_muzzles.get(muzzle_slot).map(String::as_str);
                    muzzle_slot += 1;
                    w
                } else {
                    None
                };
                rename(nm, wanted, if p.tex == 1 { "T_" } else { "W_" })
            };
            part_names[pi].insert(i, name);
        }
    }

    // ---------------- ossos novos (pai antes do filho)
    let mut bones: Vec<Bone> = Vec::new();
    let mut world: Vec<(V, Q)> = Vec::new();
    let mut map: Vec<HashMap<usize, usize>> = vec![HashMap::new(); parts.len()];
    let attach_parent = |pi: usize, p: &Part, map: &Vec<HashMap<usize, usize>>| -> i32 {
        // raiz da peça: pendurada no pai do osso que ela substitui
        if pi == 1 {
            a_turret.and_then(|t| (a.bones[t].parent >= 0).then(|| map[0].get(&(a.bones[t].parent as usize)).copied()).flatten()).map(|v| v as i32).unwrap_or(0)
        } else {
            let host = if replace_turret { 1 } else { 0 };
            let src_host = if replace_turret { b_turret.and_then(|t| barrel_root(b, t)).map(|bb| b.bones[bb].parent).unwrap_or(-1) } else { a_barrel.map(|bb| a.bones[bb].parent).unwrap_or(-1) };
            let _ = p;
            if src_host >= 0 {
                if let Some(&v) = map[host].get(&(src_host as usize)) {
                    return v as i32;
                }
            }
            map[host].values().copied().min().map(|v| v as i32).unwrap_or(0)
        }
    };
    for (pi, p) in parts.iter().enumerate() {
        let m = &p.src.model;
        let wp = world_pose(m);
        for &i in &p.bones {
            let (pos, q) = wp[i];
            let (npos, nq) = if pi == 0 { (pos, q) } else { (add(q_rot(p.q, scale(sub(pos, p.from), p.s)), p.to), q_norm(q_mul(p.q, q))) };
            let par_src = m.bones[i].parent;
            let parent = if par_src >= 0 && p.bones.contains(&(par_src as usize)) {
                map[pi][&(par_src as usize)] as i32
            } else if pi == 0 {
                -1
            } else {
                attach_parent(pi, p, &map)
            };
            let (lpos, lq) = if parent >= 0 {
                let (pp, pq) = world[parent as usize];
                (q_rot(q_conj(pq), sub(npos, pp)), q_norm(q_mul(q_conj(pq), nq)))
            } else {
                (npos, nq)
            };
            map[pi].insert(i, bones.len());
            bones.push(Bone { name: part_names[pi][&i].clone(), parent, rest_inverse: rigid_inverse(&compose(npos, nq)), position: lpos, rotation: lq });
            world.push((npos, nq));
        }
    }
    if bones.len() > 255 {
        return Err(Error::Format(format!("a tropa ficou com {} ossos; o limite é 255", bones.len())));
    }

    // ---------------- texturas: recorte de cada peça → atlas
    let mut uv_box: Vec<[f32; 4]> = vec![[1.0, 1.0, 0.0, 0.0]; 3];
    for p in &parts {
        let set: std::collections::HashSet<u8> = p.bones.iter().map(|&i| i as u8).collect();
        for v in &p.src.model.vertices {
            if set.contains(&v.bones[0]) {
                let [u, w] = v.uv0;
                let bx = &mut uv_box[p.tex];
                bx[0] = bx[0].min(u);
                bx[1] = bx[1].min(w);
                bx[2] = bx[2].max(u);
                bx[3] = bx[3].max(w);
            }
        }
    }
    let srcs = [chassis, b_src, c_src];
    let used: Vec<usize> = parts.iter().map(|p| p.tex).collect();
    let decode = |d: &Option<Vec<u8>>| d.as_ref().and_then(|x| dds::decode(x).ok());
    let base_info = chassis.albedo.as_ref().and_then(|x| dds::decode(x).ok()).map(|x| x.0);
    let mut maps: [Vec<Option<Rgba>>; 3] = [vec![], vec![], vec![]];
    for s in srcs {
        maps[0].push(decode(&s.albedo).map(|x| x.1));
        maps[1].push(decode(&s.specteam).map(|x| x.1));
        maps[2].push(decode(&s.normal).map(|x| x.1));
    }
    // recortes em pixels (na resolução da textura de cor de cada fonte)
    let mut rects: Vec<(usize, [u32; 4])> = Vec::new(); // (fonte, x, y, w, h)
    for &t in &used {
        if rects.iter().any(|r| r.0 == t) {
            continue;
        }
        let img = maps[0][t].as_ref();
        let (w, h) = img.map(|i| (i.width, i.height)).unwrap_or((256, 256));
        let bx = uv_box[t];
        let wraps = bx[0] < -0.01 || bx[1] < -0.01 || bx[2] > 1.01 || bx[3] > 1.01 || bx[0] > bx[2];
        let r = if wraps {
            [0, 0, w, h]
        } else {
            let pad = 6.0;
            let x0 = ((bx[0] * w as f32) - pad).floor().max(0.0) as u32;
            let y0 = ((bx[1] * h as f32) - pad).floor().max(0.0) as u32;
            let x1 = ((bx[2] * w as f32) + pad).ceil().min(w as f32) as u32;
            let y1 = ((bx[3] * h as f32) + pad).ceil().min(h as f32) as u32;
            [x0, y0, (x1 - x0).max(4), (y1 - y0).max(4)]
        };
        rects.push((t, r));
    }
    let (atlas_w, atlas_h, places) = pack(&rects.iter().map(|r| (r.1[2], r.1[3])).collect::<Vec<_>>());
    // limite de 2048: reduz tudo junto
    let k = (2048.0 / atlas_w.max(atlas_h) as f32).min(1.0);
    let (aw2, ah2) = (((atlas_w as f32 * k) as u32).next_power_of_two().max(64), ((atlas_h as f32 * k) as u32).next_power_of_two().max(64));
    let kx = aw2 as f32 / atlas_w as f32;
    let ky = ah2 as f32 / atlas_h as f32;
    let place_of = |t: usize| -> ([u32; 4], [f32; 4]) {
        let j = rects.iter().position(|r| r.0 == t).expect("recorte");
        let (x, y) = places[j];
        (rects[j].1, [x as f32 * kx, y as f32 * ky, rects[j].1[2] as f32 * kx, rects[j].1[3] as f32 * ky])
    };
    let neutral = |map: usize| -> [u8; 4] {
        match map {
            0 => [150, 150, 150, 255],
            1 => [0, 0, 0, 0],
            _ => maps[2][0].as_ref().map(average).unwrap_or([128, 128, 255, 255]),
        }
    };
    let mut atlases: Vec<Rgba> = Vec::new();
    for (mi, list) in maps.iter().enumerate() {
        let mut out = Rgba { width: aw2, height: ah2, pixels: vec![0; (aw2 * ah2 * 4) as usize] };
        let nv = neutral(mi);
        for px in out.pixels.chunks_exact_mut(4) {
            px.copy_from_slice(&nv);
        }
        for &(t, _) in &rects {
            let (crop, dst) = place_of(t);
            // o recorte foi medido na textura de cor; nos outros mapas usa a mesma fração
            let base = maps[0][t].as_ref().map(|i| (i.width, i.height)).unwrap_or((256, 256));
            if let Some(img) = &list[t] {
                blit(img, &mut out, crop, base, dst);
            }
        }
        atlases.push(out);
    }

    // ---------------- vértices
    let mut vertices: Vec<Vertex> = Vec::new();
    let mut indices: Vec<u16> = Vec::new();
    for (pi, p) in parts.iter().enumerate() {
        let m = &p.src.model;
        let (crop, dst) = place_of(p.tex);
        let base = maps[0][p.tex].as_ref().map(|i| (i.width, i.height)).unwrap_or((256, 256));
        let mut vmap: HashMap<usize, u16> = HashMap::new();
        for (vi, v) in m.vertices.iter().enumerate() {
            let Some(&nb) = map[pi].get(&(v.bones[0] as usize)) else { continue };
            if vertices.len() >= 65_536 {
                return Err(Error::Format("a tropa passou de 65536 vértices".into()));
            }
            let tr = |x: V| if pi == 0 { x } else { add(q_rot(p.q, scale(sub(x, p.from), p.s)), p.to) };
            let rt = |x: V| if pi == 0 { x } else { q_rot(p.q, x) };
            let uv = |uv: [f32; 2]| -> [f32; 2] {
                let px = uv[0] * base.0 as f32 - crop[0] as f32;
                let py = uv[1] * base.1 as f32 - crop[1] as f32;
                [(dst[0] + px * dst[2] / crop[2] as f32) / aw2 as f32, (dst[1] + py * dst[3] / crop[3] as f32) / ah2 as f32]
            };
            vmap.insert(vi, vertices.len() as u16);
            vertices.push(Vertex {
                position: tr(v.position), tangent: rt(v.tangent), normal: rt(v.normal), binormal: rt(v.binormal),
                uv0: uv(v.uv0), uv1: uv(v.uv1), bones: [nb as u8, 0, 0, 0],
            });
        }
        for t in m.indices.chunks_exact(3) {
            if let (Some(&x), Some(&y), Some(&z)) = (vmap.get(&(t[0] as usize)), vmap.get(&(t[1] as usize)), vmap.get(&(t[2] as usize))) {
                indices.extend_from_slice(&[x, y, z]);
            }
        }
    }
    let model = Model { version: a.version.clamp(5, 7), weighted_bones: bones.len() as u32, bones, vertices, indices, info: format!("CommandProject: chassi {}, torre {}, arma {}", chassis.id, b_src.id, c_src.id) };

    // ---------------- verificações da malha
    check_model(&model, &mut checks);
    if replace_turret {
        // torre afundada ou flutuando: compara a base da torre nova com o topo do corpo
        let body: Vec<usize> = map[0].values().copied().collect();
        let top: Vec<usize> = map[1].values().copied().collect();
        if let (Some((blo, bhi)), Some((tlo, thi))) = (bbox(&model, &body), bbox(&model, &top)) {
            let h = (bhi[1] - blo[1]).max(1e-3);
            if tlo[1] > bhi[1] + h * 0.15 {
                checks.push(Check { level: "warn", text: format!("a torre está flutuando ({:.2} acima do corpo): ajuste o deslocamento", tlo[1] - bhi[1]) });
            } else if thi[1] < bhi[1] - h * 0.05 {
                checks.push(Check { level: "warn", text: "a torre ficou escondida dentro do corpo: suba o deslocamento ou aumente a escala".into() });
            }
            let wb = (bhi[0] - blo[0]).max(bhi[2] - blo[2]);
            let wt = (thi[0] - tlo[0]).max(thi[2] - tlo[2]);
            if wt > wb * 1.6 {
                checks.push(Check { level: "warn", text: format!("a torre ficou {:.0}% mais larga que o corpo", (wt / wb - 1.0) * 100.0) });
            }
        }
    }
    if let Some(i) = base_info.as_ref().filter(|i| !matches!(i.format, DdsFormat::Dxt1 | DdsFormat::Dxt5)) {
        checks.push(Check { level: "warn", text: format!("a textura de cor do chassi usa o formato {:?}; o atlas será gravado nele mesmo", i.format) });
    }

    // ---------------- animações do chassi, adaptadas aos ossos novos
    let names: Vec<String> = model.bones.iter().map(|b| b.name.clone()).collect();
    let mut anims_out = Vec::new();
    for (field, path, an) in &chassis.anims {
        match adapt_animation(an, a, &model) {
            Ok((data, dropped)) => {
                if dropped > 0 {
                    checks.push(Check { level: "fix", text: format!("{field}: {dropped} osso(s) que não existem mais foram tirados da animação") });
                }
                anims_out.push((field.clone(), path.clone(), data));
            }
            Err(e) => checks.push(Check { level: "warn", text: format!("{field}: animação não adaptada ({e}); fica a original") }),
        }
    }

    // ---------------- ossos da arma: nomes antigos → novos (para o blueprint)
    let mut weapon_bones = Vec::new();
    let wpi = parts.iter().position(|p| p.src.id == c_src.id && p.tex == if weapon.is_some() && c_src.id != b_src.id { 2 } else if replace_turret { 1 } else { 0 });
    if let Some(pi) = wpi {
        for (&i, n) in &part_names[pi] {
            let old = &parts[pi].src.model.bones[i].name;
            if old != n {
                weapon_bones.push((old.clone(), n.clone()));
            }
        }
        // a arma também usa a torre da unidade dela: aponta para a torre nova
        if pi == 2 {
            if let (Some(ct), Some(nt)) = (turret_root(&c_src.model), a_turret.map(|t| a.bones[t].name.clone()).or_else(|| part_names.get(1).and_then(|m| turret_part.as_ref().and_then(|tp| m.get(&tp.0).cloned())))) {
                weapon_bones.push((c_src.model.bones[ct].name.clone(), nt));
            }
        }
    }

    let fmt = base_info.map(|i| i.format).unwrap_or(DdsFormat::Dxt5);
    let enc = |img: &Rgba, f: DdsFormat| dds::encode(img, f, 0, dds::Quality::Normal);
    let spec_fmt = chassis.specteam.as_ref().and_then(|x| dds::decode(x).ok()).map(|x| x.0.format).unwrap_or(DdsFormat::Dxt5);
    let nrm_fmt = chassis.normal.as_ref().and_then(|x| dds::decode(x).ok()).map(|x| x.0.format).unwrap_or(DdsFormat::Dxt5);
    checks.push(Check { level: "ok", text: format!("{} ossos, {} vértices, {} triângulos, atlas {}×{}", model.bones.len(), model.vertices.len(), model.indices.len() / 3, aw2, ah2) });
    Ok(MixOut {
        albedo: enc(&atlases[0], fmt)?,
        specteam: enc(&atlases[1], spec_fmt)?,
        normal: enc(&atlases[2], nrm_fmt)?,
        albedo_png: dds::to_png(&shrink(&atlases[0], 1024))?,
        team_png: chassis.specteam.as_ref().or(b_src.specteam.as_ref()).and_then(|_| dds::to_png(&shrink(&atlases[1], 1024)).ok()),
        anims: anims_out,
        weapon_bones,
        bones: names,
        model,
        checks,
    })
}

fn shrink(img: &Rgba, max: u32) -> Rgba {
    let mut i = img.clone();
    while i.width > max || i.height > max {
        i = dds::downsample(&i);
    }
    i
}

fn average(img: &Rgba) -> [u8; 4] {
    let mut s = [0u64; 4];
    let n = (img.pixels.len() / 4).max(1) as u64;
    for p in img.pixels.chunks_exact(4) {
        for k in 0..4 {
            s[k] += p[k] as u64;
        }
    }
    s.map(|v| (v / n) as u8)
}

/// Copia o recorte `crop` (medido numa imagem `base`) para `dst` no atlas, com reamostragem bilinear.
fn blit(img: &Rgba, out: &mut Rgba, crop: [u32; 4], base: (u32, u32), dst: [f32; 4]) {
    let fx = img.width as f32 / base.0 as f32;
    let fy = img.height as f32 / base.1 as f32;
    let (x0, y0) = (dst[0].round() as i64, dst[1].round() as i64);
    let (w, h) = (dst[2].round().max(1.0) as i64, dst[3].round().max(1.0) as i64);
    let sample = |x: f32, y: f32| -> [f32; 4] {
        let x = x.clamp(0.0, img.width as f32 - 1.001);
        let y = y.clamp(0.0, img.height as f32 - 1.001);
        let (ix, iy) = (x as usize, y as usize);
        let (u, v) = (x - ix as f32, y - iy as f32);
        let w = img.width as usize;
        let p = |xx: usize, yy: usize| &img.pixels[(yy * w + xx) * 4..(yy * w + xx) * 4 + 4];
        let (a, b, c, d) = (p(ix, iy), p(ix + 1, iy), p(ix, iy + 1), p(ix + 1, iy + 1));
        [0, 1, 2, 3].map(|k| (a[k] as f32 * (1.0 - u) + b[k] as f32 * u) * (1.0 - v) + (c[k] as f32 * (1.0 - u) + d[k] as f32 * u) * v)
    };
    for yy in 0..h {
        for xx in 0..w {
            let (ox, oy) = (x0 + xx, y0 + yy);
            if ox < 0 || oy < 0 || ox >= out.width as i64 || oy >= out.height as i64 {
                continue;
            }
            let sx = (crop[0] as f32 + (xx as f32 + 0.5) * crop[2] as f32 / w as f32) * fx - 0.5;
            let sy = (crop[1] as f32 + (yy as f32 + 0.5) * crop[3] as f32 / h as f32) * fy - 0.5;
            let c = sample(sx, sy);
            let o = ((oy as u32 * out.width + ox as u32) * 4) as usize;
            for (k, v) in c.iter().enumerate() {
                out.pixels[o + k] = v.round().clamp(0.0, 255.0) as u8;
            }
        }
    }
}

/// Empacota retângulos em prateleiras; devolve (largura, altura) potências de 2 e as posições.
fn pack(sizes: &[(u32, u32)]) -> (u32, u32, Vec<(u32, u32)>) {
    let total: u64 = sizes.iter().map(|&(w, h)| w as u64 * h as u64).sum();
    let maxw = sizes.iter().map(|s| s.0).max().unwrap_or(64);
    let mut width = ((total as f64).sqrt() as u32).max(maxw).next_power_of_two().max(64);
    loop {
        let mut order: Vec<usize> = (0..sizes.len()).collect();
        order.sort_by_key(|&i| std::cmp::Reverse(sizes[i].1));
        let mut pos = vec![(0u32, 0u32); sizes.len()];
        let (mut x, mut y, mut shelf) = (0u32, 0u32, 0u32);
        for i in order {
            let (w, h) = sizes[i];
            if x + w > width {
                x = 0;
                y += shelf;
                shelf = 0;
            }
            pos[i] = (x, y);
            x += w;
            shelf = shelf.max(h);
        }
        let height = (y + shelf).next_power_of_two().max(64);
        if height <= width * 2 {
            return (width, height, pos);
        }
        width *= 2;
    }
}

fn check_model(m: &Model, checks: &mut Vec<Check>) {
    let n = m.bones.len();
    for (i, b) in m.bones.iter().enumerate() {
        if b.parent >= i as i32 {
            checks.push(Check { level: "err", text: format!("o osso {} vem antes do pai", b.name) });
        }
        if b.position.iter().chain(b.rotation.iter()).any(|v| !v.is_finite()) {
            checks.push(Check { level: "err", text: format!("o osso {} tem valores inválidos", b.name) });
        }
    }
    let mut seen = std::collections::HashSet::new();
    for b in &m.bones {
        if !seen.insert(lname(&b.name)) {
            checks.push(Check { level: "err", text: format!("dois ossos com o nome {}", b.name) });
        }
    }
    if m.vertices.iter().any(|v| v.bones[0] as usize >= n || v.position.iter().any(|x| !x.is_finite())) {
        checks.push(Check { level: "err", text: "vértices presos a ossos que não existem".into() });
    }
    if m.indices.iter().any(|&i| i as usize >= m.vertices.len()) {
        checks.push(Check { level: "err", text: "triângulos apontando para vértices que não existem".into() });
    }
    if m.indices.is_empty() {
        checks.push(Check { level: "err", text: "a malha ficou vazia".into() });
    }
}

/// Adapta uma animação do chassi ao esqueleto novo. Mantém o movimento de cada osso em relação
/// ao repouso (posição e giro), aplicado sobre o repouso do osso novo.
pub fn adapt_animation(an: &Animation, old: &Model, new: &Model) -> Result<(Vec<u8>, usize)> {
    let old_idx: HashMap<String, usize> = old.bones.iter().enumerate().map(|(i, b)| (lname(&b.name), i)).collect();
    let new_idx: HashMap<String, usize> = new.bones.iter().enumerate().map(|(i, b)| (lname(&b.name), i)).collect();
    let old_w = world_pose(old);
    let new_w = world_pose(new);
    // a animação guarda posições em relação ao pai (local) ou do modelo? escolhe o que bate com o repouso
    let (mut el, mut ew, mut cnt) = (0f32, 0f32, 0);
    if let Some(f0) = an.frames.first() {
        for (j, name) in an.bones.iter().enumerate() {
            if let (Some(&i), Some(p)) = (old_idx.get(&lname(name)), f0.positions.get(j)) {
                let d = |a: V, b: V| ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt();
                el += d(*p, old.bones[i].position);
                ew += d(*p, old_w[i].0);
                cnt += 1;
            }
        }
    }
    let absolute = cnt > 0 && ew < el * 0.5;
    let mut keep: Vec<usize> = Vec::new();
    for (j, name) in an.bones.iter().enumerate() {
        if new_idx.contains_key(&lname(name)) {
            keep.push(j);
        }
    }
    let dropped = an.bones.len() - keep.len();
    let mut out = an.clone();
    out.bones = keep.iter().map(|&j| an.bones[j].clone()).collect();
    out.parents = keep
        .iter()
        .map(|&j| {
            let p = an.parents.get(j).copied().unwrap_or(-1);
            if p < 0 { -1 } else { keep.iter().position(|&k| k as i32 == p).map(|x| x as i32).unwrap_or(-1) }
        })
        .collect();
    for (fi, f) in out.frames.iter_mut().enumerate() {
        let src = &an.frames[fi];
        let mut pos = Vec::with_capacity(keep.len());
        let mut rot = Vec::with_capacity(keep.len());
        for &j in &keep {
            let name = lname(&an.bones[j]);
            let ni = new_idx[&name];
            let (p, r) = (src.positions[j], q_norm(src.rotations[j]));
            match old_idx.get(&name) {
                Some(&oi) => {
                    let (orp, orq, nrp, nrq) = if absolute { (old_w[oi].0, old_w[oi].1, new_w[ni].0, new_w[ni].1) } else { (old.bones[oi].position, q_norm(old.bones[oi].rotation), new.bones[ni].position, q_norm(new.bones[ni].rotation)) };
                    // movimento relativo ao repouso, aplicado ao repouso novo
                    let dq = q_mul(q_conj(orq), r);
                    pos.push(add(nrp, sub(p, orp)));
                    rot.push(q_norm(q_mul(nrq, dq)));
                }
                None => {
                    pos.push(p);
                    rot.push(r);
                }
            }
        }
        f.positions = pos;
        f.rotations = rot;
    }
    if out.frames.iter().any(|f| f.positions.iter().flatten().chain(f.rotations.iter().flatten()).any(|v| !v.is_finite())) {
        return Err(Error::Format("valores inválidos".into()));
    }
    Ok((anim::write(&out)?, dropped))
}

/// Lê uma unidade do jogo para o misturador.
pub fn load_source(sources: &[PathBuf], id: &str) -> Result<Source> {
    let d = crate::units::details(sources, id)?;
    let read = |name: &str| crate::mapassets::read_game_file(sources, &format!("/{name}"));
    let mesh = d.mesh.clone().ok_or_else(|| Error::Other(format!("{id} não tem malha .scm")))?;
    let model = scm::read(&read(&mesh)?)?;
    let find = |keys: &[&str]| {
        d.files.iter().map(|f| &f.0).find(|n| {
            let l = n.to_ascii_lowercase();
            l.starts_with("units/") && l.ends_with(".dds") && keys.iter().any(|k| l.contains(k))
        }).cloned()
    };
    let albedo = find(&["albedo", "diffuse"]).and_then(|n| read(&n).ok());
    let specteam = find(&["specteam", "_spec"]).and_then(|n| read(&n).ok());
    let normal = find(&["normal"]).and_then(|n| read(&n).ok());
    let mut anims = Vec::new();
    for (field, path) in &d.animations {
        if let Ok(data) = crate::mapassets::read_game_file(sources, path) {
            if let Ok(a) = anim::read(&data) {
                anims.push((field.clone(), path.clone(), a));
            }
        }
    }
    Ok(Source { id: d.id, model, albedo, specteam, normal, anims })
}

/// Troca os nomes de ossos (entre aspas) num trecho de blueprint.
pub fn rename_bones_in(text: &str, renames: &[(String, String)]) -> String {
    let mut out = text.to_string();
    for (old, new) in renames {
        for q in ['\'', '"'] {
            out = out.replace(&format!("{q}{old}{q}"), &format!("{q}{new}{q}"));
        }
    }
    out
}

/// Referências a ossos no blueprint (campos com Bone/Muzzle) que não existem no esqueleto:
/// troca pelo osso de mesmo papel (boca → primeira boca, cano → cano, torre → torre).
pub fn repair_bone_refs(text: &str, bones: &[String]) -> Result<(String, Vec<Check>)> {
    let bp = crate::blueprint::parse(text)?;
    let have: std::collections::HashSet<String> = bones.iter().map(|b| lname(b)).collect();
    let pick = |pred: &dyn Fn(&str) -> bool| bones.iter().find(|b| pred(b)).cloned();
    let muzzle = pick(&|b| is_muzzle(b));
    let barrel = pick(&|b| is_barrel(b) && !is_muzzle(b));
    let turret = pick(&|b| is_turret(b) && !is_barrel(b));
    let root = bones.first().cloned();
    let mut changes = Vec::new();
    let mut checks = Vec::new();
    for l in bp.leaves() {
        let p = l.path.to_ascii_lowercase();
        let Some(t) = l.text.as_deref() else { continue };
        if !(p.contains("bone") || p.contains("muzzle")) || t.is_empty() || t.contains('/') || t.contains(' ') || have.contains(&lname(t)) {
            continue;
        }
        let rep = if is_muzzle(t) || p.contains("muzzle") { muzzle.clone().or(barrel.clone()) } else if is_barrel(t) || p.contains("pitch") { barrel.clone().or(turret.clone()) } else if is_turret(t) || p.contains("yaw") { turret.clone() } else { None }.or(root.clone());
        if let Some(r) = rep {
            checks.push(Check { level: "fix", text: format!("{}: o osso {t} não existe na tropa; usando {r}", l.path) });
            changes.push((l.path.clone(), crate::blueprint::Set::Str(r)));
        }
    }
    let text = if changes.is_empty() { text.to_string() } else { crate::blueprint::apply(text, &changes)? };
    Ok((text, checks))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// unidade de teste: corpo (Root) + torre (Turret) + cano (Turret_Barrel) + boca (Turret_Muzzle)
    fn unit(id: &str, turret_w: f32, barrel_len: f32, color: [u8; 4]) -> Source {
        let bones = vec![
            ("Root", -1, [0.0, 0.0, 0.0]),
            ("Turret", 0, [0.0, 1.0, 0.0]),
            ("Turret_Barrel", 1, [0.0, 0.2, 0.3]),
            ("Turret_Muzzle", 2, [0.0, 0.0, barrel_len]),
        ];
        let mut m = Model { version: 5, bones: vec![], weighted_bones: 4, vertices: vec![], indices: vec![], info: String::new() };
        let mut wpos: Vec<V> = vec![];
        for (n, p, pos) in &bones {
            let w = if *p >= 0 { add(wpos[*p as usize], *pos) } else { *pos };
            wpos.push(w);
            m.bones.push(Bone { name: n.to_string(), parent: *p, rest_inverse: rigid_inverse(&compose(w, [1.0, 0.0, 0.0, 0.0])), position: *pos, rotation: [1.0, 0.0, 0.0, 0.0] });
        }
        // um quadrado por osso, com UV num canto diferente
        let quads: [(u8, V, f32, [f32; 2]); 3] = [(0, [0.0, 0.5, 0.0], 1.0, [0.0, 0.0]), (1, [0.0, 1.1, 0.0], turret_w, [0.5, 0.0]), (2, [0.0, 1.2, 0.3 + barrel_len / 2.0], 0.1, [0.0, 0.5])];
        for (b, c, s, uv) in quads {
            let base = m.vertices.len() as u16;
            for (dx, dz, du, dv) in [(-1.0, -1.0, 0.0, 0.0), (1.0, -1.0, 0.4, 0.0), (1.0, 1.0, 0.4, 0.4), (-1.0, 1.0, 0.0, 0.4)] {
                m.vertices.push(Vertex { position: [c[0] + dx * s / 2.0, c[1], c[2] + dz * s / 2.0], tangent: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], binormal: [0.0, 0.0, 1.0], uv0: [uv[0] + du, uv[1] + dv], uv1: [0.0; 2], bones: [b, 0, 0, 0] });
            }
            m.indices.extend_from_slice(&[base, base + 1, base + 2, base, base + 2, base + 3]);
        }
        let img = Rgba { width: 64, height: 64, pixels: color.repeat(64 * 64) };
        let dds_img = dds::encode(&img, DdsFormat::Dxt5, 0, dds::Quality::Normal).unwrap();
        // animação: a torre gira 90° em volta de Y
        let a = Animation {
            version: 5, duration: 1.0, bones: vec!["Root".into(), "Turret".into(), "Turret_Muzzle".into()], parents: vec![-1, 0, 1],
            delta_position: [0.0; 3], delta_rotation: [1.0, 0.0, 0.0, 0.0],
            frames: (0..2).map(|f| anim::Frame { time: f as f32, flags: 0, positions: vec![[0.0; 3], [0.0, 1.0, 0.0], [0.0, 0.0, barrel_len]], rotations: vec![[1.0, 0.0, 0.0, 0.0], if f == 0 { [1.0, 0.0, 0.0, 0.0] } else { [std::f32::consts::FRAC_1_SQRT_2, 0.0, std::f32::consts::FRAC_1_SQRT_2, 0.0] }, [1.0, 0.0, 0.0, 0.0]] }).collect(),
        };
        Source { id: id.into(), model: m, albedo: Some(dds_img.clone()), specteam: Some(dds_img.clone()), normal: Some(dds_img), anims: vec![("Display.AnimationIdle".into(), format!("/units/{id}/{id}_aidle.sca"), a)] }
    }

    #[test]
    fn mixes_turret_and_weapon_with_atlas_and_animation() {
        let a = unit("aaa", 1.0, 0.5, [200, 0, 0, 255]);
        let b = unit("bbb", 2.0, 0.8, [0, 200, 0, 255]);
        let c = unit("ccc", 1.0, 2.0, [0, 0, 200, 255]);
        let out = mix(&a, Some(&b), Some(&c), &MixSpec { chassis: "aaa".into(), ..Default::default() }).unwrap();
        let names: Vec<&str> = out.model.bones.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, ["Root", "Turret", "Turret_Barrel", "Turret_Muzzle"], "papéis recebem os nomes do chassi");
        assert!(out.checks.iter().all(|c| c.level != "err"), "{:?}", out.checks);
        // torre de B escalada para o tamanho da torre de A (torre + cano: 1.1 de largura)
        let top: Vec<&Vertex> = out.model.vertices.iter().filter(|v| v.bones[0] == 1).collect();
        let w = top.iter().map(|v| v.position[0]).fold(f32::MIN, f32::max) - top.iter().map(|v| v.position[0]).fold(f32::MAX, f32::min);
        assert!((w - 1.1).abs() < 1e-3, "largura da torre {w}");
        // UVs dentro do atlas
        assert!(out.model.vertices.iter().all(|v| (0.0..=1.0).contains(&v.uv0[0]) && (0.0..=1.0).contains(&v.uv0[1])));
        // cada peça pega a cor da sua unidade no atlas
        let (_, atlas) = dds::decode(&out.albedo).unwrap();
        let color_at = |v: &Vertex| {
            let x = ((v.uv0[0] * atlas.width as f32) as u32).min(atlas.width - 1);
            let y = ((v.uv0[1] * atlas.height as f32) as u32).min(atlas.height - 1);
            let o = ((y * atlas.width + x) * 4) as usize;
            [atlas.pixels[o], atlas.pixels[o + 1], atlas.pixels[o + 2]]
        };
        let center = |b: u8| { let vs: Vec<&Vertex> = out.model.vertices.iter().filter(|v| v.bones[0] == b).collect(); let mut v = vs[0].clone(); v.uv0 = [vs.iter().map(|x| x.uv0[0]).sum::<f32>() / 4.0, vs.iter().map(|x| x.uv0[1]).sum::<f32>() / 4.0]; v };
        assert!(color_at(&center(0))[0] > 150, "corpo vermelho (chassi)");
        assert!(color_at(&center(1))[1] > 150, "torre verde (unidade B)");
        assert!(color_at(&center(2))[2] > 150, "cano azul (unidade C)");
        // a animação do chassi foi adaptada: a boca nova (cano de C, mais longo) mantém a posição do repouso novo
        let (_, data) = (&out.anims[0].0, &out.anims[0].2);
        let an = anim::read(data).unwrap();
        let mi = an.bones.iter().position(|b| b == "Turret_Muzzle").unwrap();
        let ni = out.model.bones.iter().position(|b| b.name == "Turret_Muzzle").unwrap();
        let rest = out.model.bones[ni].position;
        assert!((an.frames[1].positions[mi][2] - rest[2]).abs() < 1e-4, "boca no repouso novo");
        // ossos da arma (de C) mapeados para os nomes da tropa
        assert!(out.weapon_bones.iter().all(|(o, n)| out.bones.contains(n) && !o.is_empty()));
        // escrita e leitura do .scm
        let bytes = scm::write(&out.model).unwrap();
        assert_eq!(scm::read(&bytes).unwrap().bones.len(), 4);
    }

    #[test]
    fn repairs_missing_weapon_bones() {
        let text = "UnitBlueprint {\n    Weapon = {\n        { RackBones = { { MuzzleBones = { 'Turret_Muzzle02' }, RackBone = 'Turret_Barrel', }, }, TurretBoneYaw = 'Turret', TurretBonePitch = 'Gun01', },\n    },\n}\n";
        let bones: Vec<String> = ["Root", "Turret", "Turret_Barrel", "Turret_Muzzle"].iter().map(|s| s.to_string()).collect();
        let (t, checks) = repair_bone_refs(text, &bones).unwrap();
        assert!(t.contains("'Turret_Muzzle'") && !t.contains("Muzzle02") && !t.contains("Gun01"), "{t}");
        assert_eq!(checks.len(), 2);
        assert_eq!(rename_bones_in("{ 'Gun' , \"Gun\" }", &[("Gun".into(), "Turret_Barrel".into())]), "{ 'Turret_Barrel' , \"Turret_Barrel\" }");
    }
}
