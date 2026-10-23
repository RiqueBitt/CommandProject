//! Modelos 3D `.scm` (formato da família Supreme Commander, versão 5).
//!
//! Layout (little-endian), cada seção alinhada a 32 bytes e precedida por um marcador
//! de 4 bytes dentro do preenchimento (`NAME`, `SKEL`, `VTXL`, `TRIS`, `INFO`):
//!
//! ```text
//! "MODL" u32 versão(5) u32 bone_off u32 bone_count u32 vert_off u32 extra_vert_off
//!        u32 vert_count u32 index_off u32 index_count u32 info_off u32 info_count u32 total_bones
//! osso   (108 B): f32[16] matriz inversa de repouso, f32[3] posição, f32[4] rotação (w,x,y,z),
//!                 u32 offset do nome, i32 pai, u32 x2 reservado
//! vértice (68 B): f32[3] pos, f32[3] tangente, f32[3] normal, f32[3] binormal,
//!                 f32[2] uv0, f32[2] uv1, u8[4] índices de osso
//! índices: u16
//! ```
//!
//! O leitor usa os offsets do cabeçalho (não os marcadores), então tolera variações.
//! A versão do SC2 é tratada como "5 ou compatível"; outras versões são lidas em modo
//! de melhor esforço e marcadas como não verificadas.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

const BONE_SIZE: usize = 108;
const VERTEX_SIZE: usize = 68;
const HEADER_SIZE: usize = 48;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bone {
    pub name: String,
    pub parent: i32,
    pub rest_inverse: [f32; 16],
    pub position: [f32; 3],
    /// (w, x, y, z)
    pub rotation: [f32; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Vertex {
    pub position: [f32; 3],
    pub tangent: [f32; 3],
    pub normal: [f32; 3],
    pub binormal: [f32; 3],
    pub uv0: [f32; 2],
    pub uv1: [f32; 2],
    pub bones: [u8; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub version: u32,
    pub bones: Vec<Bone>,
    /// Quantos ossos têm vértices associados (campo `bone_count` do cabeçalho).
    pub weighted_bones: u32,
    pub vertices: Vec<Vertex>,
    pub indices: Vec<u16>,
    pub info: String,
}

struct Reader<'a> {
    d: &'a [u8],
}

impl Reader<'_> {
    fn u32(&self, o: usize) -> Result<u32> {
        self.d
            .get(o..o + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
            .ok_or_else(|| Error::Format("SCM truncado".into()))
    }
    fn f32(&self, o: usize) -> Result<f32> {
        Ok(f32::from_bits(self.u32(o)?))
    }
    fn fs<const N: usize>(&self, o: usize) -> Result<[f32; N]> {
        let mut a = [0f32; N];
        for (i, v) in a.iter_mut().enumerate() {
            *v = self.f32(o + i * 4)?;
        }
        Ok(a)
    }
}

pub fn read(data: &[u8]) -> Result<Model> {
    if data.len() < HEADER_SIZE || &data[0..4] != b"MODL" {
        return Err(Error::Format("não é um modelo SCM (assinatura MODL ausente)".into()));
    }
    let r = Reader { d: data };
    let version = r.u32(4)?;
    let bone_off = r.u32(8)? as usize;
    let weighted_bones = r.u32(12)?;
    let vert_off = r.u32(16)? as usize;
    let vert_count = r.u32(24)? as usize;
    let index_off = r.u32(28)? as usize;
    let index_count = r.u32(32)? as usize;
    let info_off = r.u32(36)? as usize;
    let info_count = r.u32(40)? as usize;
    let total_bones = r.u32(44)? as usize;

    if total_bones > 4096 || vert_count > 4_000_000 || index_count > 12_000_000 {
        return Err(Error::Format("SCM com contagens absurdas — arquivo corrompido?".into()));
    }
    let mut bones = Vec::with_capacity(total_bones);
    for i in 0..total_bones {
        let o = bone_off + i * BONE_SIZE;
        let name_off = r.u32(o + 92)? as usize;
        let name_bytes = data
            .get(name_off..)
            .ok_or_else(|| Error::Format("nome de osso fora do arquivo".into()))?;
        let end = name_bytes
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(name_bytes.len())
            .min(256);
        bones.push(Bone {
            rest_inverse: r.fs::<16>(o)?,
            position: r.fs::<3>(o + 64)?,
            rotation: r.fs::<4>(o + 76)?,
            name: String::from_utf8_lossy(&name_bytes[..end]).into_owned(),
            parent: r.u32(o + 96)? as i32,
        });
    }
    let mut vertices = Vec::with_capacity(vert_count);
    for i in 0..vert_count {
        let o = vert_off + i * VERTEX_SIZE;
        let b = data
            .get(o + 64..o + 68)
            .ok_or_else(|| Error::Format("SCM truncado (vértices)".into()))?;
        vertices.push(Vertex {
            position: r.fs::<3>(o)?,
            tangent: r.fs::<3>(o + 12)?,
            normal: r.fs::<3>(o + 24)?,
            binormal: r.fs::<3>(o + 36)?,
            uv0: r.fs::<2>(o + 48)?,
            uv1: r.fs::<2>(o + 56)?,
            bones: [b[0], b[1], b[2], b[3]],
        });
    }
    let idx_bytes = data
        .get(index_off..index_off + index_count * 2)
        .ok_or_else(|| Error::Format("SCM truncado (índices)".into()))?;
    let indices: Vec<u16> = idx_bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    if let Some(bad) = indices.iter().find(|&&i| i as usize >= vert_count) {
        return Err(Error::Format(format!("índice {bad} fora do intervalo de vértices")));
    }
    let info = if info_count > 0 {
        data.get(info_off..info_off + info_count)
            .map(|b| {
                String::from_utf8_lossy(b)
                    .split('\0')
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default()
    } else {
        String::new()
    };
    Ok(Model {
        version,
        bones,
        weighted_bones,
        vertices,
        indices,
        info,
    })
}

fn pad_section(out: &mut Vec<u8>, marker: &[u8; 4]) {
    // preenche com 'X' de modo que o marcador termine num múltiplo de 32
    let n = (32 - (out.len() + 4) % 32) % 32;
    out.extend(std::iter::repeat_n(b'X', n));
    out.extend_from_slice(marker);
    debug_assert_eq!(out.len() % 32, 0);
}

pub fn write(m: &Model) -> Result<Vec<u8>> {
    if !m.indices.len().is_multiple_of(3) {
        return Err(Error::Format("o número de índices precisa ser múltiplo de 3".into()));
    }
    if m.vertices.len() > u16::MAX as usize + 1 {
        return Err(Error::Format("SCM suporta no máximo 65536 vértices por modelo".into()));
    }
    if m.indices.iter().any(|&i| i as usize >= m.vertices.len()) {
        return Err(Error::Format("índice fora do intervalo".into()));
    }
    let mut out = vec![0u8; HEADER_SIZE];
    out[0..4].copy_from_slice(b"MODL");

    pad_section(&mut out, b"NAME");
    let mut name_offsets = Vec::with_capacity(m.bones.len());
    for b in &m.bones {
        name_offsets.push(out.len() as u32);
        out.extend_from_slice(b.name.as_bytes());
        out.push(0);
    }

    pad_section(&mut out, b"SKEL");
    let bone_off = out.len();
    for (b, name_off) in m.bones.iter().zip(&name_offsets) {
        for v in b.rest_inverse.iter().chain(&b.position).chain(&b.rotation) {
            out.extend_from_slice(&v.to_le_bytes());
        }
        out.extend_from_slice(&name_off.to_le_bytes());
        out.extend_from_slice(&b.parent.to_le_bytes());
        out.extend_from_slice(&[0u8; 8]);
    }

    pad_section(&mut out, b"VTXL");
    let vert_off = out.len();
    for v in &m.vertices {
        for f in v
            .position
            .iter()
            .chain(&v.tangent)
            .chain(&v.normal)
            .chain(&v.binormal)
            .chain(&v.uv0)
            .chain(&v.uv1)
        {
            out.extend_from_slice(&f.to_le_bytes());
        }
        out.extend_from_slice(&v.bones);
    }

    pad_section(&mut out, b"TRIS");
    let index_off = out.len();
    for i in &m.indices {
        out.extend_from_slice(&i.to_le_bytes());
    }

    let (info_off, info_count) = if m.info.is_empty() {
        (0usize, 0usize)
    } else {
        pad_section(&mut out, b"INFO");
        let off = out.len();
        let mut text = m.info.replace('\n', "\0").into_bytes();
        text.push(0);
        let len = text.len();
        out.extend(text);
        (off, len)
    };

    let header = [
        5u32,
        bone_off as u32,
        m.weighted_bones,
        vert_off as u32,
        0,
        m.vertices.len() as u32,
        index_off as u32,
        m.indices.len() as u32,
        info_off as u32,
        info_count as u32,
        m.bones.len() as u32,
    ];
    for (i, v) in header.iter().enumerate() {
        out[4 + i * 4..8 + i * 4].copy_from_slice(&v.to_le_bytes());
    }
    Ok(out)
}

/// Malha pronta para o visualizador 3D (three.js monta um BufferGeometry direto disso).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MeshView {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub uvs: Vec<f32>,
    pub indices: Vec<u32>,
    pub bones: Vec<BoneView>,
    pub bbox_min: [f32; 3],
    pub bbox_max: [f32; 3],
    pub version: u32,
    pub triangles: usize,
    pub info: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoneView {
    pub name: String,
    pub parent: i32,
    pub position: [f32; 3],
}

pub fn view(m: &Model) -> MeshView {
    let mut min = [f32::MAX; 3];
    let mut max = [f32::MIN; 3];
    let mut positions = Vec::with_capacity(m.vertices.len() * 3);
    let mut normals = Vec::with_capacity(m.vertices.len() * 3);
    let mut uvs = Vec::with_capacity(m.vertices.len() * 2);
    for v in &m.vertices {
        for k in 0..3 {
            min[k] = min[k].min(v.position[k]);
            max[k] = max[k].max(v.position[k]);
        }
        positions.extend_from_slice(&v.position);
        normals.extend_from_slice(&v.normal);
        uvs.extend_from_slice(&v.uv0);
    }
    if m.vertices.is_empty() {
        min = [0.0; 3];
        max = [0.0; 3];
    }
    MeshView {
        positions,
        normals,
        uvs,
        indices: m.indices.iter().map(|&i| i as u32).collect(),
        bones: m
            .bones
            .iter()
            .map(|b| BoneView {
                name: b.name.clone(),
                parent: b.parent,
                position: b.position,
            })
            .collect(),
        bbox_min: min,
        bbox_max: max,
        version: m.version,
        triangles: m.indices.len() / 3,
        info: m.info.clone(),
    }
}

/// Exporta para Wavefront OBJ (abre no Blender e em qualquer editor 3D).
pub fn to_obj(m: &Model, name: &str) -> String {
    use std::fmt::Write;
    let mut s = format!("# Exportado pelo CommandProject\no {name}\n");
    for v in &m.vertices {
        let _ = writeln!(s, "v {} {} {}", v.position[0], v.position[1], v.position[2]);
    }
    for v in &m.vertices {
        let _ = writeln!(s, "vt {} {}", v.uv0[0], 1.0 - v.uv0[1]);
    }
    for v in &m.vertices {
        let _ = writeln!(s, "vn {} {} {}", v.normal[0], v.normal[1], v.normal[2]);
    }
    for t in m.indices.chunks_exact(3) {
        let (a, b, c) = (t[0] as usize + 1, t[1] as usize + 1, t[2] as usize + 1);
        let _ = writeln!(s, "f {a}/{a}/{a} {b}/{b}/{b} {c}/{c}/{c}");
    }
    s
}

/// Exporta para glTF binário (.glb) — malha estática com normais e UV.
pub fn to_glb(m: &Model) -> Vec<u8> {
    let v = view(m);
    let mut bin = Vec::new();
    let push_f32 = |bin: &mut Vec<u8>, data: &[f32]| {
        for f in data {
            bin.extend_from_slice(&f.to_le_bytes());
        }
    };
    let pos_off = 0;
    push_f32(&mut bin, &v.positions);
    let nrm_off = bin.len();
    push_f32(&mut bin, &v.normals);
    let uv_off = bin.len();
    let uvs: Vec<f32> = v.uvs.clone();
    push_f32(&mut bin, &uvs);
    let idx_off = bin.len();
    for i in &v.indices {
        bin.extend_from_slice(&i.to_le_bytes());
    }
    while bin.len() % 4 != 0 {
        bin.push(0);
    }
    let n = m.vertices.len();
    let json = serde_json::json!({
        "asset": {"version": "2.0", "generator": "CommandProject"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2},
            "indices": 3
        }]}],
        "buffers": [{"byteLength": bin.len()}],
        "bufferViews": [
            {"buffer": 0, "byteOffset": pos_off, "byteLength": n * 12, "target": 34962},
            {"buffer": 0, "byteOffset": nrm_off, "byteLength": n * 12, "target": 34962},
            {"buffer": 0, "byteOffset": uv_off, "byteLength": n * 8, "target": 34962},
            {"buffer": 0, "byteOffset": idx_off, "byteLength": v.indices.len() * 4, "target": 34963}
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n, "type": "VEC3", "min": v.bbox_min, "max": v.bbox_max},
            {"bufferView": 1, "componentType": 5126, "count": n, "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": n, "type": "VEC2"},
            {"bufferView": 3, "componentType": 5125, "count": v.indices.len(), "type": "SCALAR"}
        ]
    });
    let mut json_bytes = serde_json::to_vec(&json).expect("json");
    while !json_bytes.len().is_multiple_of(4) {
        json_bytes.push(b' ');
    }
    let total = 12 + 8 + json_bytes.len() + 8 + bin.len();
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(b"glTF");
    out.extend_from_slice(&2u32.to_le_bytes());
    out.extend_from_slice(&(total as u32).to_le_bytes());
    out.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(b"JSON");
    out.extend(json_bytes);
    out.extend_from_slice(&(bin.len() as u32).to_le_bytes());
    out.extend_from_slice(b"BIN\0");
    out.extend(bin);
    out
}

/// Importa a geometria de um OBJ para dentro de um modelo existente, mantendo o esqueleto.
/// Todos os vértices novos ficam presos ao osso `bone` (EXPERIMENTAL: sem pesos/animação por parte).
pub fn replace_geometry_from_obj(base: &Model, obj: &str, bone: u8) -> Result<Model> {
    let mut pos: Vec<[f32; 3]> = Vec::new();
    let mut uv: Vec<[f32; 2]> = Vec::new();
    let mut nrm: Vec<[f32; 3]> = Vec::new();
    let mut verts: Vec<Vertex> = Vec::new();
    let mut map = std::collections::HashMap::<(usize, usize, usize), u16>::new();
    let mut indices = Vec::new();
    let parse_f = |s: Option<&str>| -> Result<f32> {
        s.ok_or_else(|| Error::Format("OBJ: número faltando".into()))?
            .parse::<f32>()
            .map_err(|_| Error::Format("OBJ: número inválido".into()))
    };
    if bone as usize >= base.bones.len().max(1) {
        return Err(Error::Format("osso escolhido não existe no modelo".into()));
    }
    for line in obj.lines() {
        let mut it = line.split_whitespace();
        match it.next() {
            Some("v") => pos.push([parse_f(it.next())?, parse_f(it.next())?, parse_f(it.next())?]),
            Some("vt") => {
                let u = parse_f(it.next())?;
                let v = parse_f(it.next())?;
                uv.push([u, 1.0 - v]);
            }
            Some("vn") => nrm.push([parse_f(it.next())?, parse_f(it.next())?, parse_f(it.next())?]),
            Some("f") => {
                let corners: Vec<&str> = it.collect();
                if corners.len() < 3 {
                    continue;
                }
                let mut face = Vec::with_capacity(corners.len());
                for c in corners {
                    let mut parts = c.split('/');
                    let idx = |p: Option<&str>, len: usize| -> Result<usize> {
                        match p.filter(|s| !s.is_empty()) {
                            None => Ok(usize::MAX),
                            Some(s) => {
                                let i: i64 = s.parse().map_err(|_| Error::Format("OBJ: índice inválido".into()))?;
                                let r = if i < 0 { len as i64 + i } else { i - 1 };
                                if r < 0 || r as usize >= len {
                                    return Err(Error::Format("OBJ: índice fora do intervalo".into()));
                                }
                                Ok(r as usize)
                            }
                        }
                    };
                    let key = (
                        idx(parts.next(), pos.len())?,
                        idx(parts.next(), uv.len())?,
                        idx(parts.next(), nrm.len())?,
                    );
                    if key.0 == usize::MAX {
                        return Err(Error::Format("OBJ: face sem posição".into()));
                    }
                    let id = match map.get(&key) {
                        Some(&id) => id,
                        None => {
                            if verts.len() > u16::MAX as usize {
                                return Err(Error::Format("modelo grande demais para SCM (>65536 vértices)".into()));
                            }
                            let n = if key.2 != usize::MAX {
                                nrm[key.2]
                            } else {
                                [0.0, 1.0, 0.0]
                            };
                            verts.push(Vertex {
                                position: pos[key.0],
                                normal: n,
                                tangent: [0.0; 3],
                                binormal: [0.0; 3],
                                uv0: if key.1 != usize::MAX { uv[key.1] } else { [0.0, 0.0] },
                                uv1: if key.1 != usize::MAX { uv[key.1] } else { [0.0, 0.0] },
                                bones: [bone, 0, 0, 0],
                            });
                            let id = (verts.len() - 1) as u16;
                            map.insert(key, id);
                            id
                        }
                    };
                    face.push(id);
                }
                for i in 1..face.len() - 1 {
                    indices.extend_from_slice(&[face[0], face[i], face[i + 1]]);
                }
            }
            _ => {}
        }
    }
    if indices.is_empty() {
        return Err(Error::Format("o OBJ não tem faces".into()));
    }
    compute_tangents(&mut verts, &indices);
    let mut m = base.clone();
    m.vertices = verts;
    m.indices = indices;
    m.weighted_bones = m.weighted_bones.max(bone as u32 + 1);
    Ok(m)
}

/// Tangentes/binormais por triângulo (necessárias para normal maps).
fn compute_tangents(verts: &mut [Vertex], idx: &[u16]) {
    let mut tan = vec![[0f32; 3]; verts.len()];
    let mut bit = vec![[0f32; 3]; verts.len()];
    for t in idx.chunks_exact(3) {
        let (a, b, c) = (t[0] as usize, t[1] as usize, t[2] as usize);
        let (p0, p1, p2) = (verts[a].position, verts[b].position, verts[c].position);
        let (w0, w1, w2) = (verts[a].uv0, verts[b].uv0, verts[c].uv0);
        let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        let (du1, dv1, du2, dv2) = (w1[0] - w0[0], w1[1] - w0[1], w2[0] - w0[0], w2[1] - w0[1]);
        let det = du1 * dv2 - du2 * dv1;
        let r = if det.abs() < 1e-8 { 1.0 } else { 1.0 / det };
        let t3 = [
            (e1[0] * dv2 - e2[0] * dv1) * r,
            (e1[1] * dv2 - e2[1] * dv1) * r,
            (e1[2] * dv2 - e2[2] * dv1) * r,
        ];
        let b3 = [
            (e2[0] * du1 - e1[0] * du2) * r,
            (e2[1] * du1 - e1[1] * du2) * r,
            (e2[2] * du1 - e1[2] * du2) * r,
        ];
        for &i in &[a, b, c] {
            for k in 0..3 {
                tan[i][k] += t3[k];
                bit[i][k] += b3[k];
            }
        }
    }
    let norm = |v: [f32; 3]| {
        let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        if l > 1e-8 {
            [v[0] / l, v[1] / l, v[2] / l]
        } else {
            [1.0, 0.0, 0.0]
        }
    };
    for (i, v) in verts.iter_mut().enumerate() {
        v.tangent = norm(tan[i]);
        v.binormal = norm(bit[i]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn cube() -> Model {
        let bone = Bone {
            name: "Root".into(),
            parent: -1,
            rest_inverse: [
                1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
            ],
            position: [0.0; 3],
            rotation: [1.0, 0.0, 0.0, 0.0],
        };
        let turret = Bone {
            name: "Turret".into(),
            parent: 0,
            position: [0.0, 1.0, 0.0],
            ..bone.clone()
        };
        let p = [[-1.0, 0.0, -1.0], [1.0, 0.0, -1.0], [1.0, 0.0, 1.0], [-1.0, 0.0, 1.0]];
        let vertices = p
            .iter()
            .enumerate()
            .map(|(i, &position)| Vertex {
                position,
                tangent: [1.0, 0.0, 0.0],
                normal: [0.0, 1.0, 0.0],
                binormal: [0.0, 0.0, 1.0],
                uv0: [(i % 2) as f32, (i / 2) as f32],
                uv1: [0.0; 2],
                bones: [0, 0, 0, 0],
            })
            .collect();
        Model {
            version: 5,
            bones: vec![bone, turret],
            weighted_bones: 1,
            vertices,
            indices: vec![0, 1, 2, 0, 2, 3],
            info: "teste\nCommandProject".into(),
        }
    }

    #[test]
    fn roundtrip_byte_exact() {
        let m = cube();
        let bytes = write(&m).unwrap();
        let back = read(&bytes).unwrap();
        assert_eq!(back, m);
        assert_eq!(write(&back).unwrap(), bytes, "reescrita estável");
        // marcadores de seção nos lugares esperados
        let v_off = u32::from_le_bytes(bytes[16..20].try_into().unwrap()) as usize;
        assert_eq!(&bytes[v_off - 4..v_off], b"VTXL");
        assert_eq!(v_off % 32, 0);
    }

    #[test]
    fn obj_export_import() {
        let m = cube();
        let obj = to_obj(&m, "cubo");
        let re = replace_geometry_from_obj(&m, &obj, 1).unwrap();
        assert_eq!(re.vertices.len(), 4);
        assert_eq!(re.indices.len(), 6);
        assert_eq!(re.bones.len(), 2, "esqueleto mantido");
        assert!(re.vertices.iter().all(|v| v.bones[0] == 1));
        assert!((re.vertices[0].position[0] - m.vertices[0].position[0]).abs() < 1e-6);
        // quads são triangulados
        let quad = "v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n";
        assert_eq!(replace_geometry_from_obj(&m, quad, 0).unwrap().indices.len(), 6);
        assert!(replace_geometry_from_obj(&m, quad, 9).is_err());
    }

    #[test]
    fn glb_is_well_formed() {
        let g = to_glb(&cube());
        assert_eq!(&g[0..4], b"glTF");
        assert_eq!(u32::from_le_bytes(g[8..12].try_into().unwrap()) as usize, g.len());
        let jlen = u32::from_le_bytes(g[12..16].try_into().unwrap()) as usize;
        let json: serde_json::Value = serde_json::from_slice(&g[20..20 + jlen]).unwrap();
        assert_eq!(json["accessors"][3]["count"], 6);
    }

    #[test]
    fn rejects_bad_files() {
        assert!(read(b"MODLshort").is_err());
        let mut b = write(&cube()).unwrap();
        // corta no meio da lista de índices
        let index_off = u32::from_le_bytes(b[28..32].try_into().unwrap()) as usize;
        b.truncate(index_off + 4);
        assert!(read(&b).is_err());
    }
}
