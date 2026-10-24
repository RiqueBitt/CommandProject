//! Modelos feitos no editor 3D do launcher → arquivos do jogo.
//!
//! O editor manda a malha já "assada" (todas as peças juntas, com UVs num atlas) e as imagens do
//! atlas: cor (albedo), onde vai a cor do time e o que brilha. Aqui viram um `.scm` (com ossos:
//! cada grupo do editor é um osso, para animar e para as armas das tropas) e texturas `.dds`.

use serde::{Deserialize, Serialize};

use crate::dds::{self, DdsFormat, Quality, Rgba};
use crate::error::{Error, Result};
use crate::scm::{Bone, Model, Vertex};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BakedBone {
    pub name: String,
    pub parent: i32,
    /// posição em relação ao pai
    pub pos: [f32; 3],
    /// rotação em relação ao pai (w, x, y, z)
    pub rot: [f32; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BakedModel {
    /// posições em coordenadas do modelo (x, y, z)
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
    /// osso de cada vértice
    pub bone_index: Vec<u8>,
    pub bones: Vec<BakedBone>,
    /// imagens do atlas em PNG (base64 sem prefixo ou data URL)
    pub albedo_png: String,
    pub team_png: Option<String>,
    pub glow_png: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ModelFiles {
    pub scm: Vec<u8>,
    pub albedo: Vec<u8>,
    pub team: Vec<u8>,
    pub mask: Vec<u8>,
    pub normal: Vec<u8>,
    pub triangles: usize,
    pub warnings: Vec<String>,
}

fn png(data: &str) -> Result<Rgba> {
    use base64::Engine;
    let b64 = data.split(',').next_back().unwrap_or_default();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|_| Error::Format("imagem do atlas inválida".into()))?;
    dds::from_png(&bytes)
}

fn mat_mul(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    // matrizes coluna-maior (como o three.js / D3D com vetores linha transpostos)
    let mut o = [0f32; 16];
    for c in 0..4 {
        for r in 0..4 {
            o[c * 4 + r] = (0..4).map(|k| a[k * 4 + r] * b[c * 4 + k]).sum();
        }
    }
    o
}

fn compose(pos: [f32; 3], q: [f32; 4]) -> [f32; 16] {
    let [w, x, y, z] = q;
    [
        1.0 - 2.0 * (y * y + z * z), 2.0 * (x * y + z * w), 2.0 * (x * z - y * w), 0.0,
        2.0 * (x * y - z * w), 1.0 - 2.0 * (x * x + z * z), 2.0 * (y * z + x * w), 0.0,
        2.0 * (x * z + y * w), 2.0 * (y * z - x * w), 1.0 - 2.0 * (x * x + y * y), 0.0,
        pos[0], pos[1], pos[2], 1.0,
    ]
}

/// inversa de uma transformação rígida (rotação + translação)
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

/// Malha + ossos → `.scm` e as texturas `.dds`.
pub fn build(m: &BakedModel) -> Result<ModelFiles> {
    let n = m.positions.len() / 3;
    if n == 0 || m.indices.is_empty() {
        return Err(Error::Format("o modelo está vazio: adicione pelo menos uma peça".into()));
    }
    if n > 65_536 {
        return Err(Error::Format(format!("o modelo tem {n} vértices; o jogo aceita até 65536 por modelo. Simplifique (menos segmentos) ou divida.")));
    }
    if m.normals.len() != n * 3 || m.uvs.len() != n * 2 || m.bone_index.len() != n || !m.indices.len().is_multiple_of(3) {
        return Err(Error::Format("dados da malha inconsistentes".into()));
    }
    if m.indices.iter().any(|&i| i as usize >= n) {
        return Err(Error::Format("índice fora da malha".into()));
    }
    let bones_in = if m.bones.is_empty() {
        vec![BakedBone { name: "Root".into(), parent: -1, pos: [0.0; 3], rot: [1.0, 0.0, 0.0, 0.0] }]
    } else {
        m.bones.clone()
    };
    if bones_in.len() > 255 {
        return Err(Error::Format("no máximo 255 ossos (grupos)".into()));
    }
    // matrizes de repouso absolutas (pai antes do filho)
    let mut world: Vec<[f32; 16]> = Vec::with_capacity(bones_in.len());
    for (i, b) in bones_in.iter().enumerate() {
        if b.parent >= i as i32 {
            return Err(Error::Format(format!("o osso {} vem antes do pai", b.name)));
        }
        let local = compose(b.pos, b.rot);
        world.push(if b.parent < 0 { local } else { mat_mul(&world[b.parent as usize], &local) });
    }
    let bones: Vec<Bone> = bones_in
        .iter()
        .zip(&world)
        .map(|(b, w)| Bone { name: b.name.clone(), parent: b.parent, rest_inverse: rigid_inverse(w), position: b.pos, rotation: b.rot })
        .collect();

    // tangentes por triângulo (o shader do jogo usa para o normal map)
    let mut tan = vec![[0f32; 3]; n];
    for t in m.indices.chunks_exact(3) {
        let [a, b, c] = [t[0] as usize, t[1] as usize, t[2] as usize];
        let p = |i: usize| [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]];
        let uv = |i: usize| [m.uvs[i * 2], m.uvs[i * 2 + 1]];
        let (pa, pb, pc) = (p(a), p(b), p(c));
        let (ua, ub, uc) = (uv(a), uv(b), uv(c));
        let e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        let e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
        let (du1, dv1, du2, dv2) = (ub[0] - ua[0], ub[1] - ua[1], uc[0] - ua[0], uc[1] - ua[1]);
        let r = du1 * dv2 - du2 * dv1;
        let r = if r.abs() < 1e-12 { 1.0 } else { 1.0 / r };
        let tv = [(e1[0] * dv2 - e2[0] * dv1) * r, (e1[1] * dv2 - e2[1] * dv1) * r, (e1[2] * dv2 - e2[2] * dv1) * r];
        for i in [a, b, c] {
            for k in 0..3 {
                tan[i][k] += tv[k];
            }
        }
    }
    let norm = |v: [f32; 3]| {
        let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt().max(1e-9);
        [v[0] / l, v[1] / l, v[2] / l]
    };
    let mut warnings = Vec::new();
    let mut bad_bone = false;
    let vertices: Vec<Vertex> = (0..n)
        .map(|i| {
            let nrm = norm([m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]]);
            let t = norm(tan[i]);
            let bin = norm([nrm[1] * t[2] - nrm[2] * t[1], nrm[2] * t[0] - nrm[0] * t[2], nrm[0] * t[1] - nrm[1] * t[0]]);
            let mut bi = m.bone_index[i];
            if bi as usize >= bones.len() {
                bad_bone = true;
                bi = 0;
            }
            let uv = [m.uvs[i * 2], m.uvs[i * 2 + 1]];
            Vertex { position: [m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2]], tangent: t, normal: nrm, binormal: bin, uv0: uv, uv1: uv, bones: [bi, 0, 0, 0] }
        })
        .collect();
    if bad_bone {
        warnings.push("alguns vértices apontavam para um osso inexistente e foram presos à raiz".into());
    }
    let model = Model {
        version: 7,
        weighted_bones: bones.len() as u32,
        bones,
        vertices,
        indices: m.indices.iter().map(|&i| i as u16).collect(),
        info: "Criado no CommandProject".into(),
    };
    let scm = crate::scm::write(&model)?;

    let albedo = png(&m.albedo_png)?;
    let (w, h) = (albedo.width, albedo.height);
    if !w.is_power_of_two() || !h.is_power_of_two() || w > 4096 || h > 4096 {
        return Err(Error::Format("o atlas de textura precisa ter lados em potência de 2 (até 4096)".into()));
    }
    let gray = |v: u8| Rgba { width: w, height: h, pixels: [v, v, v, 255].repeat((w * h) as usize) };
    let team = match &m.team_png {
        Some(t) => png(t)?,
        None => Rgba { width: w, height: h, pixels: [0, 0, 0, 0].repeat((w * h) as usize) },
    };
    let glow = match &m.glow_png {
        Some(g) => png(g)?,
        None => gray(0),
    };
    if (team.width, team.height) != (w, h) || (glow.width, glow.height) != (w, h) {
        return Err(Error::Format("as imagens do atlas precisam ter o mesmo tamanho".into()));
    }
    // máscara: R = brilho especular, G = o que brilha no escuro (como as unidades do jogo)
    let mut mask = gray(0);
    for (o, g) in mask.pixels.chunks_exact_mut(4).zip(glow.pixels.chunks_exact(4)) {
        o[0] = 40;
        o[1] = g[0].max(g[1]).max(g[2]);
        o[2] = 0;
        o[3] = 255;
    }
    let normal = Rgba { width: w.min(256), height: h.min(256), pixels: [128, 128, 255, 255].repeat((w.min(256) * h.min(256)) as usize) };
    Ok(ModelFiles {
        triangles: model.indices.len() / 3,
        scm,
        albedo: dds::encode(&albedo, DdsFormat::Dxt5, 0, Quality::Normal)?,
        team: dds::encode(&team, DdsFormat::Dxt5, 0, Quality::Normal)?,
        mask: dds::encode(&mask, DdsFormat::Dxt5, 0, Quality::Fast)?,
        normal: dds::encode(&normal, DdsFormat::Dxt5, 0, Quality::Fast)?,
        warnings,
    })
}

/// Nomes de arquivo a gravar no `.scd`: o nome pedido e a variante com `.win`
/// (os arquivos do jogo usam `nome.win.ext`; o pacote leva os dois para o jogo achar).
pub fn both_names(path: &str) -> Vec<String> {
    let p = path.trim_start_matches('/').to_string();
    match p.rsplit_once('.') {
        Some((stem, ext)) if !stem.ends_with(".win") && matches!(ext.to_ascii_lowercase().as_str(), "scm" | "dds" | "sca") => {
            vec![p.clone(), format!("{stem}.win.{ext}")]
        }
        Some((stem, ext)) if stem.ends_with(".win") => vec![format!("{}.{ext}", stem.trim_end_matches(".win")), p.clone()],
        _ => vec![p],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    fn png_b64(w: u32, h: u32, c: [u8; 4]) -> String {
        let img = Rgba { width: w, height: h, pixels: c.repeat((w * h) as usize) };
        base64::engine::general_purpose::STANDARD.encode(dds::to_png(&img).unwrap())
    }

    #[test]
    fn bakes_triangle_with_two_bones() {
        let m = BakedModel {
            positions: vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            normals: vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            uvs: vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
            indices: vec![0, 1, 2],
            bone_index: vec![0, 1, 1],
            bones: vec![
                BakedBone { name: "Root".into(), parent: -1, pos: [0.0; 3], rot: [1.0, 0.0, 0.0, 0.0] },
                BakedBone { name: "Turret".into(), parent: 0, pos: [0.0, 1.0, 0.0], rot: [1.0, 0.0, 0.0, 0.0] },
            ],
            albedo_png: png_b64(64, 64, [200, 50, 50, 255]),
            team_png: None,
            glow_png: None,
        };
        let f = build(&m).unwrap();
        let back = crate::scm::read(&f.scm).unwrap();
        assert_eq!(back.version, 7);
        assert_eq!(back.bones[1].name, "Turret");
        // inversa do repouso do osso 1: desloca -1 em y
        assert!((back.bones[1].rest_inverse[13] + 1.0).abs() < 1e-6);
        assert_eq!(back.vertices[2].bones[0], 1);
        let (info, img) = dds::decode(&f.albedo).unwrap();
        assert_eq!((info.width, img.pixels[0] > 150), (64, true));
        assert!(build(&BakedModel { indices: vec![], ..m }).is_err());
    }

    #[test]
    fn both_names_variants() {
        assert_eq!(both_names("/props/cp/x/x_lod0.scm"), vec!["props/cp/x/x_lod0.scm", "props/cp/x/x_lod0.win.scm"]);
        assert_eq!(both_names("units/a/a_unit.bp"), vec!["units/a/a_unit.bp"]);
        assert_eq!(both_names("units/a/a_Diffuse.win.dds"), vec!["units/a/a_Diffuse.dds", "units/a/a_Diffuse.win.dds"]);
    }
}
