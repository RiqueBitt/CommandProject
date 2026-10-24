//! Verificação de combate, movimento, colisão, ossos e animações de uma tropa antes de gerar o mod.
//!
//! Não simula o jogo: confere se o blueprint, o modelo e as animações combinam entre si do jeito
//! que a engine espera (os sistemas de combate continuam sendo os do jogo). Erros impedem a
//! exportação; avisos aparecem no relatório.

use crate::anim::Animation;
use crate::blueprint::{self, Blueprint};
use crate::scm::Model;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Finding {
    /// "err", "warn" ou "ok"
    pub level: &'static str,
    /// área: Movimento, Colisão, Seleção, Armas, Mira, Ossos, Animações, Modelo
    pub area: &'static str,
    pub text: String,
}

type V = [f32; 3];
type Q = [f32; 4]; // w, x, y, z

fn q_mul(a: Q, b: Q) -> Q {
    [
        a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
        a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
        a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
        a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ]
}
fn q_norm(q: Q) -> Q {
    let l = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if l < 1e-8 { [1.0, 0.0, 0.0, 0.0] } else { [q[0] / l, q[1] / l, q[2] / l, q[3] / l] }
}
fn q_rot(q: Q, v: V) -> V {
    let p = q_mul(q_mul(q, [0.0, v[0], v[1], v[2]]), [q[0], -q[1], -q[2], -q[3]]);
    [p[1], p[2], p[3]]
}
fn dist(a: V, b: V) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}
fn q_angle(a: Q, b: Q) -> f32 {
    let d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]).abs().min(1.0);
    2.0 * d.acos().to_degrees()
}

fn world(m: &Model) -> Vec<(V, Q)> {
    let mut out: Vec<(V, Q)> = Vec::with_capacity(m.bones.len());
    for (i, b) in m.bones.iter().enumerate() {
        let q = q_norm(b.rotation);
        let w = if b.parent >= 0 && (b.parent as usize) < i {
            let (pp, pq) = out[b.parent as usize];
            let r = q_rot(pq, b.position);
            ([pp[0] + r[0], pp[1] + r[1], pp[2] + r[2]], q_norm(q_mul(pq, q)))
        } else {
            (b.position, q)
        };
        out.push(w);
    }
    out
}

fn is_ancestor(m: &Model, anc: usize, mut b: usize) -> bool {
    let mut guard = 0;
    while guard < 512 {
        if b == anc {
            return true;
        }
        let p = m.bones[b].parent;
        if p < 0 || p as usize >= m.bones.len() {
            return false;
        }
        b = p as usize;
        guard += 1;
    }
    false
}

/// Confere tudo. `anims` = (campo do blueprint, animação já lida).
pub fn check(bp_text: &str, model: &Model, anims: &[(String, Animation)]) -> Vec<Finding> {
    let mut out = Vec::new();
    let mut push = |level: &'static str, area: &'static str, text: String| out.push(Finding { level, area, text });
    let bp = match blueprint::parse(bp_text) {
        Ok(b) => b,
        Err(e) => {
            push("err", "Blueprint", format!("o blueprint não abre: {e}"));
            return out;
        }
    };
    let cats: HashSet<String> = bp.get("Categories").map(|c| c.strings()).unwrap_or_default().iter().map(|c| c.to_ascii_uppercase()).collect();
    let num = |p: &str| bp.number(p);
    let scale = num("Display.UniformScale").unwrap_or(1.0) as f32;
    let mobile = cats.contains("MOBILE");

    // ---------------- modelo e ossos
    let nb = model.bones.len();
    if nb == 0 {
        push("err", "Ossos", "o modelo não tem nenhum osso".into());
    }
    if nb > 255 {
        push("err", "Ossos", format!("{nb} ossos: o jogo aceita até 255"));
    }
    if model.vertices.len() > 65535 {
        push("err", "Modelo", format!("{} vértices: o limite é 65535", model.vertices.len()));
    }
    for (i, b) in model.bones.iter().enumerate() {
        if b.parent >= nb as i32 || b.parent == i as i32 {
            push("err", "Ossos", format!("osso {} aponta para um pai que não existe", b.name));
        }
        if b.position.iter().chain(b.rotation.iter()).any(|v| !v.is_finite()) {
            push("err", "Ossos", format!("osso {} tem posição/rotação inválida (NaN)", b.name));
        }
        let l = (b.rotation.iter().map(|v| v * v).sum::<f32>()).sqrt();
        if (l - 1.0).abs() > 0.05 {
            push("warn", "Ossos", format!("osso {}: rotação não normalizada ({l:.2}); pode girar torto", b.name));
        }
    }
    let mut names = HashMap::new();
    for b in &model.bones {
        if names.insert(b.name.to_ascii_lowercase(), ()).is_some() {
            push("warn", "Ossos", format!("dois ossos com o nome {}: armas e animações pegam só o primeiro", b.name));
        }
    }
    if model.vertices.iter().any(|v| v.bones[0] as usize >= nb.max(1)) {
        push("err", "Modelo", "há vértices presos a ossos que não existem (a peça some ou estica)".into());
    }
    if model.vertices.iter().any(|v| v.position.iter().any(|x| !x.is_finite())) {
        push("err", "Modelo", "há vértices com posição inválida (NaN)".into());
    }
    // caixa do modelo e de cada peça
    let mut bmin = [f32::MAX; 3];
    let mut bmax = [f32::MIN; 3];
    let mut per: Vec<Option<(V, V)>> = vec![None; nb];
    for v in &model.vertices {
        for k in 0..3 {
            bmin[k] = bmin[k].min(v.position[k]);
            bmax[k] = bmax[k].max(v.position[k]);
        }
        let b = v.bones[0] as usize;
        if b < nb {
            let e = per[b].get_or_insert((v.position, v.position));
            for k in 0..3 {
                e.0[k] = e.0[k].min(v.position[k]);
                e.1[k] = e.1[k].max(v.position[k]);
            }
        }
    }
    let size = if model.vertices.is_empty() { [0.0; 3] } else { [bmax[0] - bmin[0], bmax[1] - bmin[1], bmax[2] - bmin[2]] };
    let big = size[0].max(size[1]).max(size[2]).max(1e-4);
    // peças soltas: a caixa de uma peça longe da caixa da peça "pai" mais próxima com malha
    let gap = |a: (V, V), b: (V, V)| -> f32 {
        let mut d2 = 0.0;
        for k in 0..3 {
            let g = (a.0[k] - b.1[k]).max(b.0[k] - a.1[k]).max(0.0);
            d2 += g * g;
        }
        d2.sqrt()
    };
    for i in 0..nb {
        let Some(bi) = per[i] else { continue };
        let mut p = model.bones[i].parent;
        let mut guard = 0;
        while p >= 0 && (p as usize) < nb && per[p as usize].is_none() && guard < 256 {
            p = model.bones[p as usize].parent;
            guard += 1;
        }
        if p < 0 || p as usize >= nb {
            continue;
        }
        let g = gap(bi, per[p as usize].unwrap());
        if g > big * 0.12 {
            push("warn", "Ossos", format!("a peça {} está solta: fica {:.0}% do tamanho da tropa longe da peça a que está presa", model.bones[i].name, g / big * 100.0));
        }
    }
    let wp = world(model);
    if !model.vertices.is_empty() && size[1] > 0.0 {
        for (i, (p, _)) in wp.iter().enumerate() {
            if p[1] < bmin[1] - size[1] * 0.25 {
                push("warn", "Ossos", format!("o osso {} está abaixo do chão do modelo", model.bones[i].name));
            }
        }
    }
    let bone_idx = |n: &str| model.bones.iter().position(|b| b.name.eq_ignore_ascii_case(n));

    // ---------------- movimento
    let motion = bp.text("Physics.MotionType").unwrap_or_default();
    let air = cats.contains("AIR");
    if mobile {
        match motion.as_str() {
            "" => push("warn", "Movimento", "sem Physics.MotionType: o jogo usa o padrão e a tropa pode não andar".into()),
            "RULEUMT_None" => push("err", "Movimento", "tropa móvel com MotionType = parada: não vai sair do lugar".into()),
            "RULEUMT_Air" if !air => push("warn", "Movimento", "MotionType aérea, mas sem a categoria AIR: armas antiaéreas não vão mirar nela".into()),
            m if m != "RULEUMT_Air" && air => push("warn", "Movimento", format!("categoria AIR com MotionType {m}: a tropa não voa")),
            "RULEUMT_Water" | "RULEUMT_SurfacingSub" if cats.contains("LAND") => push("warn", "Movimento", "tropa naval com categoria LAND: a navegação e os alvos ficam confusos".into()),
            _ => {}
        }
        let speed = if air { num("Air.MaxAirspeed").or(num("Physics.MaxSpeed")) } else { num("Physics.MaxSpeed") };
        match speed {
            Some(s) if s <= 0.0 => push("err", "Movimento", "velocidade máxima zero ou negativa".into()),
            Some(s) if s > 60.0 => push("warn", "Movimento", format!("velocidade {s} muito alta: a tropa atravessa o mapa e erra o caminho")),
            None => push("warn", "Movimento", "sem velocidade máxima no blueprint".into()),
            _ => {}
        }
        for (f, l) in [("Physics.MaxAcceleration", "aceleração"), ("Physics.MaxBrake", "frenagem"), ("Physics.TurnRate", "giro")] {
            if num(f).is_some_and(|v| v <= 0.0) && !air {
                push("err", "Movimento", format!("{l} ({f}) precisa ser maior que zero"));
            }
        }
        if motion == "RULEUMT_Hover" && num("Physics.Elevation").is_some_and(|e| e <= 0.0) {
            push("warn", "Movimento", "hover com Elevation 0: vai encostar no chão e na água".into());
        }
    }

    // ---------------- colisão e seleção (em unidades do jogo = modelo × escala)
    let (sx, sy, sz) = (num("SizeX"), num("SizeY"), num("SizeZ"));
    let wx = size[0] * scale;
    let wy = size[1] * scale;
    let wz = size[2] * scale;
    match (sx, sy, sz) {
        (Some(x), Some(y), Some(z)) => {
            if x <= 0.0 || y <= 0.0 || z <= 0.0 {
                push("err", "Colisão", "SizeX/SizeY/SizeZ precisam ser maiores que zero".into());
            } else if wx > 0.0 {
                let ratio = ((x as f32) / wx).max((z as f32) / wz.max(1e-4));
                let low = ((x as f32) / wx).min((z as f32) / wz.max(1e-4));
                if ratio > 3.0 {
                    push("warn", "Colisão", format!("caixa de colisão ({x:.1}×{z:.1}) bem maior que o modelo ({wx:.1}×{wz:.1}): tiros acertam o ar e as tropas não se aproximam"));
                } else if low < 0.33 {
                    push("warn", "Colisão", format!("caixa de colisão ({x:.1}×{z:.1}) bem menor que o modelo ({wx:.1}×{wz:.1}): tiros atravessam e as tropas se sobrepõem"));
                } else {
                    push("ok", "Colisão", format!("colisão {x:.1}×{y:.1}×{z:.1} combina com o modelo ({wx:.1}×{wy:.1}×{wz:.1})"));
                }
            }
        }
        _ => push("warn", "Colisão", "sem SizeX/SizeY/SizeZ: o jogo usa um tamanho padrão para colisão".into()),
    }
    if let (Some(sel), true) = (num("SelectionSizeX"), wx > 0.0) {
        if (sel as f32) < wx * 0.25 {
            push("warn", "Seleção", "área de seleção muito pequena: difícil clicar na tropa".into());
        }
    }

    // ---------------- armas e mira
    let vision = num("Intel.VisionRadius").unwrap_or(0.0);
    let radar = num("Intel.RadarRadius").unwrap_or(0.0);
    let mut weapons = 0;
    let mut wi = 1;
    while bp.get(&format!("Weapon.{wi}")).is_some() {
        let cur = wi;
        let w = |f: &str| format!("Weapon.{cur}.{f}");
        let label = bp.text(&w("Label")).unwrap_or_else(|| format!("arma {cur}"));
        let dummy = matches!(bp.get(&w("DummyWeapon")), Some(blueprint::Value::Bool(true)));
        wi += 1;
        if dummy {
            continue;
        }
        weapons += 1;
        let max_r = bp.number(&w("MaxRadius")).unwrap_or(0.0);
        let min_r = bp.number(&w("MinRadius")).unwrap_or(0.0);
        if max_r <= 0.0 {
            push("err", "Armas", format!("{label}: alcance máximo precisa ser maior que zero"));
        } else if min_r >= max_r {
            push("err", "Armas", format!("{label}: alcance mínimo ({min_r}) maior ou igual ao máximo ({max_r}): nunca atira"));
        }
        if bp.number(&w("RateOfFire")).is_some_and(|r| r <= 0.0) {
            push("err", "Armas", format!("{label}: cadência zero: nunca atira"));
        }
        if max_r > vision.max(radar) * 1.5 && vision > 0.0 && radar == 0.0 {
            push("warn", "Mira", format!("{label}: alcance {max_r} muito maior que a visão {vision}: só acerta alvos que outra tropa estiver vendo"));
        }
        // ossos da arma
        let mut need: Vec<(String, &'static str)> = Vec::new();
        for f in ["TurretBoneYaw", "TurretBonePitch", "TurretBoneMuzzle"] {
            if let Some(b) = bp.text(&w(f)).filter(|b| !b.is_empty()) {
                need.push((b, f));
            }
        }
        let mut r = 1;
        while bp.get(&w(&format!("RackBones.{r}"))).is_some() {
            if let Some(b) = bp.text(&w(&format!("RackBones.{r}.RackBone"))).filter(|b| !b.is_empty()) {
                need.push((b, "RackBone"));
            }
            let mut m = 1;
            while let Some(b) = bp.text(&w(&format!("RackBones.{r}.MuzzleBones.{m}"))) {
                need.push((b, "MuzzleBones"));
                m += 1;
            }
            r += 1;
        }
        let missing: Vec<String> = need.iter().filter(|(b, _)| bone_idx(b).is_none()).map(|(b, f)| format!("{b} ({f})")).collect();
        if !missing.is_empty() {
            push("err", "Armas", format!("{label}: o modelo não tem os ossos {}; a arma não teria de onde atirar", missing.join(", ")));
        }
        let muzzles: Vec<usize> = need.iter().filter(|(_, f)| *f == "MuzzleBones").filter_map(|(b, _)| bone_idx(b)).collect();
        if need.iter().all(|(_, f)| *f != "MuzzleBones") && bp.get(&w("RackBones")).is_some() {
            push("warn", "Armas", format!("{label}: sem MuzzleBones: o tiro sai do centro da tropa"));
        }
        // a torre precisa carregar o cano: yaw → pitch → boca
        let yaw = bp.text(&w("TurretBoneYaw")).and_then(|b| bone_idx(&b));
        let pitch = bp.text(&w("TurretBonePitch")).and_then(|b| bone_idx(&b));
        if let (Some(y), Some(p)) = (yaw, pitch) {
            if !is_ancestor(model, y, p) {
                push("err", "Mira", format!("{label}: o osso de elevação não está preso ao de giro: o cano não acompanha a torre"));
            }
        }
        if let Some(top) = pitch.or(yaw) {
            for &m in &muzzles {
                if !is_ancestor(model, top, m) {
                    push("err", "Mira", format!("{label}: a boca {} não está presa à torre: o tiro sai para o lado errado quando a torre gira", model.bones[m].name));
                }
            }
        }
        if let Some(y) = bp.number(&w("TurretYawRange")) {
            if !(0.0..=180.0).contains(&y) {
                push("warn", "Mira", format!("{label}: TurretYawRange {y} fora de 0–180"));
            }
        }
        if yaw.is_some() && bp.number(&w("TurretYawSpeed")).is_some_and(|s| s <= 0.0) {
            push("err", "Mira", format!("{label}: a torre não gira (TurretYawSpeed 0)"));
        }
        if !model.vertices.is_empty() {
            for &m in &muzzles {
                if wp[m].0[1] < bmin[1] - size[1] * 0.05 {
                    push("warn", "Mira", format!("{label}: a boca {} está abaixo do chão: tiros batem no terreno", model.bones[m].name));
                }
            }
        }
        let caps = bp.text(&w("FireTargetLayerCapsTable.Land")).unwrap_or_default().to_ascii_lowercase();
        if air && !caps.is_empty() && !caps.contains("land") && !caps.contains("water") && !caps.contains("air") {
            push("warn", "Mira", format!("{label}: as camadas de alvo não incluem terra, água nem ar"));
        }
    }
    if weapons == 0 && (cats.contains("DIRECTFIRE") || cats.contains("INDIRECTFIRE") || cats.contains("ANTIAIR")) {
        push("warn", "Armas", "categorias de ataque (DIRECTFIRE/INDIRECTFIRE/ANTIAIR), mas nenhuma arma: a IA vai mandá-la atacar à toa".into());
    }

    // ---------------- animações
    let has = |f: &str| anims.iter().any(|(x, _)| x == f);
    if mobile && !air && motion != "RULEUMT_Hover" && !has("Display.AnimationWalk") && bp.text("Display.AnimationWalk").is_some() {
        push("warn", "Animações", "a animação de andar não pôde ser lida: a tropa vai deslizar".into());
    }
    let rest_len: Vec<f32> = model.bones.iter().map(|b| (b.position.iter().map(|v| v * v).sum::<f32>()).sqrt()).collect();
    for (field, a) in anims {
        let short = field.trim_start_matches("Display.");
        if a.frames.is_empty() {
            push("err", "Animações", format!("{short}: sem quadros"));
            continue;
        }
        let map: Vec<Option<usize>> = a.bones.iter().map(|n| bone_idx(n)).collect();
        let found = map.iter().filter(|x| x.is_some()).count();
        if found == 0 {
            push("err", "Animações", format!("{short}: nenhum osso da animação existe no modelo (é de outra tropa)"));
            continue;
        }
        let lost = a.bones.len() - found;
        if lost > 0 {
            push("warn", "Animações", format!("{short}: {lost} osso(s) da animação não existem no modelo e serão ignorados"));
        }
        if a.frames.iter().any(|f| f.positions.iter().flatten().chain(f.rotations.iter().flatten()).any(|v| !v.is_finite())) {
            push("err", "Animações", format!("{short}: há valores inválidos (NaN)"));
            continue;
        }
        if a.frames.windows(2).any(|w| w[1].time < w[0].time) {
            push("err", "Animações", format!("{short}: quadros fora de ordem no tempo"));
        }
        // local ou absoluta? compara o 1º quadro com o repouso
        let (mut er, mut ea) = (0.0, 0.0);
        for (j, m) in map.iter().enumerate() {
            if let (Some(i), Some(p)) = (m, a.frames[0].positions.get(j)) {
                er += dist(*p, model.bones[*i].position);
                ea += dist(*p, wp[*i].0);
            }
        }
        let absolute = ea < er * 0.5;
        let mut stretch = HashSet::new();
        let mut snap = HashSet::new();
        for (fi, f) in a.frames.iter().enumerate() {
            for (j, m) in map.iter().enumerate() {
                let (Some(i), Some(p), Some(q)) = (m, f.positions.get(j), f.rotations.get(j)) else { continue };
                // articulação esticando: em relação ao pai, o osso se afasta além do comprimento de repouso
                if !absolute && model.bones[*i].parent >= 0 && per[*i].is_some() {
                    let l = (p.iter().map(|v| v * v).sum::<f32>()).sqrt();
                    if (l - rest_len[*i]).abs() > (rest_len[*i] * 0.35).max(big * 0.04) {
                        stretch.insert(*i);
                    }
                }
                if absolute && dist(*p, wp[*i].0) > big * 2.0 {
                    stretch.insert(*i);
                }
                if fi > 0 {
                    if let Some(q0) = a.frames[fi - 1].rotations.get(j) {
                        let dt = (f.time - a.frames[fi - 1].time).max(1e-3);
                        if q_angle(q_norm(*q0), q_norm(*q)) > 100.0 && dt < 0.2 {
                            snap.insert(*i);
                        }
                    }
                }
            }
        }
        if !stretch.is_empty() {
            let n: Vec<&str> = stretch.iter().take(4).map(|&i| model.bones[i].name.as_str()).collect();
            push("warn", "Animações", format!("{short}: peças se soltam ou esticam durante a animação ({})", n.join(", ")));
        }
        if !snap.is_empty() {
            let n: Vec<&str> = snap.iter().take(4).map(|&i| model.bones[i].name.as_str()).collect();
            push("warn", "Animações", format!("{short}: rotação brusca (mais de 100° entre quadros) em {}", n.join(", ")));
        }
        // laço: andar/parado devem terminar como começam
        if (field.ends_with("Walk") || field.ends_with("Idle")) && a.frames.len() > 2 {
            let (f0, fl) = (&a.frames[0], &a.frames[a.frames.len() - 1]);
            let worst = map.iter().enumerate().filter_map(|(j, m)| m.and(Some(j))).map(|j| q_angle(q_norm(f0.rotations[j]), q_norm(fl.rotations[j]))).fold(0.0f32, f32::max);
            if worst > 25.0 {
                push("warn", "Animações", format!("{short}: o fim não volta à pose do começo ({worst:.0}°): vai dar um pulo a cada repetição"));
            }
        }
    }
    if !anims.is_empty() && out.iter().all(|f| f.area != "Animações") {
        out.push(Finding { level: "ok", area: "Animações", text: format!("{} animação(ões) conferidas: ossos, laços e articulações em ordem", anims.len()) });
    }
    if weapons > 0 && out.iter().all(|f| f.level != "err" || (f.area != "Armas" && f.area != "Mira")) {
        out.push(Finding { level: "ok", area: "Armas", text: format!("{weapons} arma(s): ossos de giro, elevação e boca ligados") });
    }
    if !out.iter().any(|f| f.area == "Ossos") {
        out.push(Finding { level: "ok", area: "Ossos", text: format!("{nb} ossos sem peças soltas") });
    }
    out
}

/// Lê as animações citadas no blueprint (do mod ou do jogo) para a verificação.
pub fn load_anims(bp: &Blueprint, read: &mut dyn FnMut(&str) -> Option<Vec<u8>>) -> Vec<(String, Animation)> {
    let mut out = Vec::new();
    for l in bp.leaves() {
        if !l.path.starts_with("Display.Animation") {
            continue;
        }
        let Some(path) = l.text.filter(|t| t.to_ascii_lowercase().ends_with(".sca")) else { continue };
        if let Some(a) = read(&path).and_then(|d| crate::anim::read(&d).ok()) {
            out.push((l.path.clone(), a));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::anim::Frame;
    use crate::scm::{Bone, Vertex};

    fn bone(name: &str, parent: i32, pos: V) -> Bone {
        Bone { name: name.into(), parent, rest_inverse: [0.0; 16], position: pos, rotation: [1.0, 0.0, 0.0, 0.0] }
    }
    fn vert(p: V, b: u8) -> Vertex {
        Vertex { position: p, tangent: [1.0, 0.0, 0.0], normal: [0.0, 1.0, 0.0], binormal: [0.0, 0.0, 1.0], uv0: [0.0, 0.0], uv1: [0.0, 0.0], bones: [b, 0, 0, 0] }
    }
    fn tank() -> Model {
        let bones = vec![bone("Root", -1, [0.0, 0.0, 0.0]), bone("Turret", 0, [0.0, 0.5, 0.0]), bone("Barrel", 1, [0.0, 0.1, 0.3]), bone("Muzzle", 2, [0.0, 0.0, 0.6])];
        let mut vertices = Vec::new();
        for (b, c, h) in [(0u8, [0.0, 0.25, 0.0], [0.5, 0.25, 0.8]), (1, [0.0, 0.6, 0.0], [0.3, 0.1, 0.3]), (2, [0.0, 0.6, 0.6], [0.05, 0.05, 0.3])] {
            for sx in [-1.0, 1.0] {
                for sy in [-1.0, 1.0] {
                    for sz in [-1.0, 1.0] {
                        vertices.push(vert([c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]], b));
                    }
                }
            }
        }
        Model { version: 5, bones, weighted_bones: 4, vertices, indices: vec![0, 1, 2], info: String::new() }
    }
    const BP: &str = r#"UnitBlueprint {
        Categories = { 'MOBILE', 'LAND', 'DIRECTFIRE' },
        Display = { UniformScale = 1 },
        Intel = { VisionRadius = 20 },
        Physics = { MotionType = 'RULEUMT_Land', MaxSpeed = 3, MaxAcceleration = 2, MaxBrake = 2, TurnRate = 90 },
        SizeX = 1, SizeY = 0.7, SizeZ = 1.6,
        Weapon = { { Label = 'Gun', MaxRadius = 22, RateOfFire = 1, TurretBoneYaw = 'Turret', TurretBonePitch = 'Barrel', TurretYawSpeed = 90,
            RackBones = { { RackBone = 'Barrel', MuzzleBones = { 'Muzzle' } } } } },
    }"#;

    #[test]
    fn good_unit_has_no_errors() {
        let f = check(BP, &tank(), &[]);
        assert!(f.iter().all(|x| x.level != "err"), "{f:#?}");
        assert!(f.iter().any(|x| x.area == "Colisão" && x.level == "ok"), "{f:#?}");
    }

    #[test]
    fn finds_broken_weapon_motion_and_collision() {
        let bp = BP.replace("MuzzleBones = { 'Muzzle' }", "MuzzleBones = { 'Nope' }").replace("MaxSpeed = 3", "MaxSpeed = 0").replace("SizeX = 1,", "SizeX = 9,");
        let f = check(&bp, &tank(), &[]);
        assert!(f.iter().any(|x| x.level == "err" && x.text.contains("Nope")), "{f:#?}");
        assert!(f.iter().any(|x| x.level == "err" && x.area == "Movimento"), "{f:#?}");
        assert!(f.iter().any(|x| x.area == "Colisão" && x.level == "warn"), "{f:#?}");
        // boca fora da torre
        let mut m = tank();
        m.bones[3].parent = 0;
        let f = check(BP, &m, &[]);
        assert!(f.iter().any(|x| x.level == "err" && x.area == "Mira"), "{f:#?}");
    }

    #[test]
    fn finds_stretching_and_snapping_animation() {
        let m = tank();
        let rest: Vec<[f32; 3]> = m.bones.iter().map(|b| b.position).collect();
        let rot0: Vec<[f32; 4]> = vec![[1.0, 0.0, 0.0, 0.0]; 4];
        let mut far = rest.clone();
        far[2] = [0.0, 3.0, 0.3];
        let flip = vec![[1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [1.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]];
        let a = Animation {
            version: 5,
            duration: 1.0,
            bones: m.bones.iter().map(|b| b.name.clone()).collect(),
            parents: m.bones.iter().map(|b| b.parent).collect(),
            delta_position: [0.0; 3],
            delta_rotation: [1.0, 0.0, 0.0, 0.0],
            frames: vec![
                Frame { time: 0.0, flags: 0, positions: rest.clone(), rotations: rot0.clone() },
                Frame { time: 0.1, flags: 0, positions: far, rotations: flip },
                Frame { time: 1.0, flags: 0, positions: rest, rotations: rot0 },
            ],
        };
        let f = check(BP, &m, &[("Display.AnimationWalk".into(), a)]);
        assert!(f.iter().any(|x| x.area == "Animações" && x.text.contains("esticam")), "{f:#?}");
        assert!(f.iter().any(|x| x.area == "Animações" && x.text.contains("brusca")), "{f:#?}");
    }
}
