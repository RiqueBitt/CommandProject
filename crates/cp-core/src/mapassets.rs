//! Recursos do jogo para o editor de mapas: decorações (props) que podem ser colocadas, camadas
//! de textura do chão de todos os mapas e leitura de arquivos/miniaturas sob demanda.

use std::collections::BTreeMap;
use std::io::Read;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;

use crate::error::{Error, Result};
use crate::scd::Scd;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PropInfo {
    /// Caminho como os mapas usam: `/props/Trees/spruce01/spruce01_prop.bp`.
    pub bp: String,
    /// Nome curto (`spruce01`).
    pub name: String,
    /// Primeira pasta (`Trees`, `Rocks`, `Wreckage`…).
    pub category: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayerSet {
    /// Mapa de onde vem a camada (`SC2_MP_002`).
    pub map: String,
    /// Nome da camada (`grass01`).
    pub name: String,
    /// Caminhos sem `.win`, como o `terrain.win.bdf` guarda.
    pub d: String,
    pub n: Option<String>,
    pub s: Option<String>,
    /// Espaço disponível para cada caminho no arquivo do mapa (troca só cabe se for menor).
    pub slot_d: usize,
    pub slot_n: usize,
    pub slot_s: usize,
}

/// Payload de um container MFDB (`.bdf`).
pub fn mfdb_payload(data: &[u8]) -> Result<Vec<u8>> {
    if data.len() < 32 || &data[..4] != b"MFDB" {
        return Err(Error::Format("não é um arquivo MFDB".into()));
    }
    let u32_at = |o: usize| u32::from_le_bytes(data[o..o + 4].try_into().expect("4 bytes"));
    let nfix = u32_at(24) as usize;
    let off = (32 + 4 * nfix).div_ceil(32) * 32;
    let try_from = |o: usize| -> Option<Vec<u8>> {
        let mut out = Vec::new();
        flate2::read::ZlibDecoder::new(data.get(o..)?).read_to_end(&mut out).ok()?;
        Some(out)
    };
    try_from(off)
        .or_else(|| {
            // alguns .bdf têm blocos extras antes do zlib (cabeçalho[7] > 1): tenta cada 78 9C,
            // como o toolkit faz, até um descomprimir
            data.windows(2)
                .enumerate()
                .skip(28)
                .filter(|(_, w)| *w == [0x78, 0x9c])
                .find_map(|(p, _)| try_from(p))
        })
        .ok_or_else(|| Error::Format("payload MFDB ilegível".into()))
}

/// Decorações disponíveis no jogo (blueprints de `/props/…_prop.bp`).
pub fn props_catalog(sources: &[PathBuf]) -> Result<Vec<PropInfo>> {
    let mut seen = BTreeMap::new();
    for src in sources {
        let mut scd = Scd::open(src)?;
        for e in scd.entries()? {
            if e.is_dir || !e.key.starts_with("/props/") || !e.key.ends_with("_prop.bp") {
                continue;
            }
            let bp = format!("/{}", e.name.replace('\\', "/").trim_start_matches('/'));
            let parts: Vec<&str> = bp.trim_start_matches('/').split('/').collect();
            let category = parts.get(1).copied().unwrap_or("Outros").to_string();
            let file = parts.last().copied().unwrap_or_default();
            let name = file.trim_end_matches("_prop.bp").to_string();
            seen.insert(e.key.clone(), PropInfo { bp, name, category });
        }
    }
    Ok(seen.into_values().collect())
}

static LAYERS: Mutex<Option<(Vec<PathBuf>, Vec<LayerSet>)>> = Mutex::new(None);

/// Camadas de textura do chão de todos os mapas do jogo (lidas dos `terrain.win.bdf`).
pub fn terrain_layers(sources: &[PathBuf]) -> Result<Vec<LayerSet>> {
    if let Some((src, cached)) = LAYERS.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
        if src == sources {
            return Ok(cached.clone());
        }
    }
    let mut out = Vec::new();
    let mut done = std::collections::HashSet::new();
    for src in sources.iter().rev() {
        let mut scd = Scd::open(src)?;
        let entries = scd.entries()?;
        for (i, e) in entries.iter().enumerate() {
            if e.is_dir || !e.key.starts_with("/maps/") || !e.key.ends_with(".terrain.win.bdf") {
                continue;
            }
            let map = e.name.replace('\\', "/").split('/').nth(1).unwrap_or_default().to_string();
            if map.is_empty() || !done.insert(map.to_ascii_lowercase()) {
                continue;
            }
            let Ok(payload) = scd.read_at(i).and_then(|d| mfdb_payload(&d)) else { continue };
            out.extend(layers_in(&map, &payload));
        }
    }
    out.sort_by(|a, b| a.map.cmp(&b.map).then(a.name.cmp(&b.name)));
    *LAYERS.lock().unwrap_or_else(|p| p.into_inner()) = Some((sources.to_vec(), out.clone()));
    Ok(out)
}

/// Camadas citadas num payload de `terrain.win.bdf`.
pub fn layers_in(map: &str, payload: &[u8]) -> Vec<LayerSet> {
    // (caminho, espaço até o próximo byte não nulo)
    let mut paths: Vec<(String, usize)> = Vec::new();
    let needle = b"/textures/terrain/";
    let lower: Vec<u8> = payload.iter().map(|b| b.to_ascii_lowercase()).collect();
    let mut i = 0;
    while let Some(p) = lower[i..].windows(needle.len()).position(|w| w == needle) {
        let start = i + p;
        let end = payload[start..].iter().position(|&b| !(0x21..=0x7e).contains(&b)).map_or(payload.len(), |e| start + e);
        let s = String::from_utf8_lossy(&payload[start..end]).to_string();
        if s.to_ascii_lowercase().ends_with(".dds") {
            let nulls = payload[end..].iter().take_while(|&&b| b == 0).count();
            paths.push((s, end - start + nulls));
        }
        i = end.max(start + 1);
    }
    let mut sets: BTreeMap<String, LayerSet> = BTreeMap::new();
    for (path, slot) in paths {
        let stem = path.trim_end_matches(".dds").trim_end_matches(".DDS");
        let Some((base, kind)) = stem.rsplit_once('_') else { continue };
        let kind = kind.to_ascii_lowercase();
        if !matches!(kind.as_str(), "d" | "n" | "s") {
            continue;
        }
        let name = base.rsplit('/').next().unwrap_or(base);
        // tira o prefixo do mapa: textures/Terrain/MP_002/sc2_mp_002_grass01 → grass01
        let dir = base.rsplit('/').nth(1).unwrap_or_default().to_ascii_lowercase();
        let lname = name.to_ascii_lowercase();
        let short = match lname.find(&format!("{dir}_")) {
            Some(p) if !dir.is_empty() => name[p + dir.len() + 1..].to_string(),
            _ => name.to_string(),
        };
        let e = sets.entry(base.to_ascii_lowercase()).or_insert_with(|| LayerSet {
            map: map.to_string(),
            name: short,
            d: String::new(),
            n: None,
            s: None,
            slot_d: 0,
            slot_n: 0,
            slot_s: 0,
        });
        match kind.as_str() {
            "d" => {
                e.d = path;
                e.slot_d = slot;
            }
            "n" => {
                e.n = Some(path);
                e.slot_n = slot;
            }
            _ => {
                e.s = Some(path);
                e.slot_s = slot;
            }
        }
    }
    sets.into_values().filter(|l| !l.d.is_empty()).collect()
}

/// Lê um arquivo do jogo pelo caminho que os blueprints e mapas usam (`/props/…/x.dds`):
/// tenta o nome exato e a variante `.win.` que o motor insere.
pub fn read_game_file(sources: &[PathBuf], path: &str) -> Result<Vec<u8>> {
    let key = crate::scd::normalize_key(path);
    let mut keys = vec![key.clone()];
    if let Some((stem, ext)) = key.rsplit_once('.') {
        if !stem.ends_with(".win") {
            keys.push(format!("{stem}.win.{ext}"));
        }
    }
    for src in sources.iter().rev() {
        let mut scd = Scd::open(src)?;
        let entries = scd.entries()?;
        if let Some(i) = entries.iter().position(|e| keys.contains(&e.key)) {
            return scd.read_at(i);
        }
    }
    Err(Error::Other(format!("{path} não encontrado nos arquivos do jogo")))
}

/// Miniatura PNG de uma textura do jogo (lado máximo `max`).
pub fn texture_png(sources: &[PathBuf], path: &str, max: u32) -> Result<Vec<u8>> {
    let data = read_game_file(sources, path)?;
    let (_, mut img) = crate::dds::decode(&data)?;
    while img.width > max.max(16) || img.height > max.max(16) {
        img = crate::dds::downsample(&img);
    }
    crate::dds::to_png(&img)
}

/// Modelo de uma decoração para pré-visualizar: malha (LOD0) e a primeira textura de cor.
pub fn prop_preview(sources: &[PathBuf], bp: &str) -> Result<(crate::scm::MeshView, Option<Vec<u8>>)> {
    let key = crate::scd::normalize_key(bp);
    let dir = key.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
    let stem = key.rsplit('/').next().unwrap_or_default().trim_end_matches("_prop.bp").to_string();
    let mut best: Option<(PathBuf, usize, String)> = None;
    for src in sources {
        let mut scd = Scd::open(src)?;
        for (i, e) in scd.entries()?.iter().enumerate() {
            if !e.key.starts_with(&dir) || !e.key.ends_with(".scm") || e.key[dir.len()..].contains('/') {
                continue;
            }
            let file = &e.key[dir.len()..];
            let rank = (!file.starts_with(&stem), !file.contains("lod0"), file.contains("fall"), file.len());
            let better = match &best {
                None => true,
                Some((_, _, f)) => {
                    let r2 = (!f.starts_with(&stem), !f.contains("lod0"), f.contains("fall"), f.len());
                    rank < r2
                }
            };
            if better {
                best = Some((src.clone(), i, file.to_string()));
            }
        }
    }
    let (src, idx, _) = best.ok_or_else(|| Error::Other("o modelo dessa decoração não foi encontrado".into()))?;
    let mesh = crate::scm::view(&crate::scm::read(&Scd::open(&src)?.read_at(idx)?)?);
    // a textura vem do blueprint em texto (uncompiled): DiffuseName = '/props/…_Diffuse.dds'
    let texture = read_game_file(sources, &format!("/uncompiled{key}"))
        .ok()
        .and_then(|text| {
            let t = String::from_utf8_lossy(&text).to_string();
            let i = t.find("DiffuseName")?;
            let q1 = t[i..].find('\'')? + i + 1;
            let q2 = t[q1..].find('\'')? + q1;
            Some(t[q1..q2].to_string())
        })
        .and_then(|p| texture_png(sources, &p, 512).ok());
    Ok((mesh, texture))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_layers_with_slots() {
        let mut p = vec![0u8; 8];
        for s in ["/textures/Terrain/MP_002/sc2_mp_002_grass01_d.dds", "/textures/Terrain/MP_002/sc2_mp_002_grass01_n.dds", "/textures/Terrain/MP_002/sc2_mp_002_hill01_d.dds"] {
            p.extend_from_slice(s.as_bytes());
            p.extend_from_slice(&[0, 0, 0, 0]);
        }
        let l = layers_in("SC2_MP_002", &p);
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].name, "grass01");
        assert_eq!(l[0].n.as_deref(), Some("/textures/Terrain/MP_002/sc2_mp_002_grass01_n.dds"));
        assert_eq!(l[0].slot_d, "/textures/Terrain/MP_002/sc2_mp_002_grass01_d.dds".len() + 4);
        assert_eq!(l[1].name, "hill01");
        assert!(l[1].n.is_none());
    }
}

#[cfg(test)]
mod real {
    #[test]
    fn real_terrain_if_available() {
        let Ok(p) = std::env::var("CP_TERRAIN_BDF") else { return };
        let payload = super::mfdb_payload(&std::fs::read(p).unwrap()).unwrap();
        for l in super::layers_in("SC2_MP_002", &payload) {
            eprintln!("{} d={} n={:?} s={:?} slots={},{},{}", l.name, l.d, l.n, l.s, l.slot_d, l.slot_n, l.slot_s);
        }
    }
}
