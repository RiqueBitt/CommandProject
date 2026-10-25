//! Recursos do jogo para o editor de mapas: decorações (props) que podem ser colocadas, camadas
//! de textura do chão de todos os mapas e leitura de arquivos/miniaturas sob demanda.

use std::collections::{BTreeMap, HashMap};
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
    /// Tamanho no jogo (largura, altura, comprimento) = modelo × UniformScale; `None` se não deu para ler.
    pub size: Option<[f32; 3]>,
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
            seen.insert(e.key.clone(), PropInfo { bp, name, category, size: None });
        }
    }
    let mut out: Vec<PropInfo> = seen.into_values().collect();
    let sizes = prop_sizes(sources, &out.iter().map(|p| p.bp.clone()).collect::<Vec<_>>());
    for p in out.iter_mut() {
        p.size = sizes.get(&crate::scd::normalize_key(&p.bp)).copied();
    }
    Ok(out)
}

type SizeCache = (Vec<PathBuf>, std::collections::HashMap<String, [f32; 3]>);
static SIZES: Mutex<Option<SizeCache>> = Mutex::new(None);

/// Tamanho real (modelo × UniformScale) de cada decoração; lido uma vez e guardado.
pub fn prop_sizes(sources: &[PathBuf], bps: &[String]) -> std::collections::HashMap<String, [f32; 3]> {
    let mut g = SIZES.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((src, map)) = g.as_ref() {
        if src == sources {
            return map.clone();
        }
    }
    let mut map = std::collections::HashMap::new();
    let Ok(index) = scm_index(sources) else { return map };
    let mut scds: Vec<Option<Scd>> = sources.iter().map(|_| None).collect();
    // textos dos blueprints (uncompiled) de uma vez
    let mut texts: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for src in sources {
        let Ok(mut scd) = Scd::open(src) else { continue };
        let Ok(entries) = scd.entries() else { continue };
        for (i, e) in entries.iter().enumerate() {
            if let Some(k) = e.key.strip_prefix("/uncompiled") {
                if k.starts_with("/props/") && k.ends_with("_prop.bp") {
                    if let Ok(d) = scd.read_at(i) {
                        texts.insert(k.to_string(), String::from_utf8_lossy(&d).to_string());
                    }
                }
            }
        }
    }
    for bp in bps {
        let key = crate::scd::normalize_key(bp);
        let dir = key.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
        let stem = key.rsplit('/').next().unwrap_or_default().trim_end_matches("_prop.bp").to_string();
        let lod_of = |f: &str| f.find("_lod").and_then(|i| f[i + 4..].chars().next()).and_then(|c| c.to_digit(10)).unwrap_or(0) as i32;
        let best = index
            .iter()
            .filter(|(_, _, k)| k.starts_with(&dir) && !k[dir.len()..].contains('/'))
            .min_by_key(|(_, _, k)| (!k[dir.len()..].starts_with(&stem), k.contains("fall"), -lod_of(&k[dir.len()..]), k.len()));
        let info = texts.get(&key).map(|t| prop_info(t)).unwrap_or_default();
        let m = if let Some(m) = info.meshes.last().and_then(|p| read_game_file(sources, p).ok()).and_then(|d| crate::scm::read(&d).ok()) {
            m
        } else {
            let Some((si, idx, _)) = best else { continue };
            if scds[*si].is_none() {
                scds[*si] = Scd::open(&sources[*si]).ok();
            }
            let Some(scd) = scds[*si].as_mut() else { continue };
            let Ok(m) = scd.read_at(*idx).and_then(|d| crate::scm::read(&d)) else { continue };
            m
        };
        let v = crate::scm::view(&m);
        let k = info.scale;
        let size = [0, 1, 2].map(|i| ((v.bbox_max[i] - v.bbox_min[i]) * k * 100.0).round() / 100.0);
        if size.iter().all(|x| x.is_finite()) {
            map.insert(key, size);
        }
    }
    *g = Some((sources.to_vec(), map.clone()));
    map
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
/// Índice de todos os arquivos dos `.scd` (o último montado vence), refeito quando a lista de
/// arquivos ou o tamanho/data de algum muda. Sem ele, cada leitura abria e listava todos os `.scd`.
type FileIndex = (Vec<(PathBuf, u64, Option<std::time::SystemTime>)>, HashMap<String, (usize, crate::scd::RawLoc)>);
static FILES: Mutex<Option<FileIndex>> = Mutex::new(None);

fn stamp(sources: &[PathBuf]) -> Vec<(PathBuf, u64, Option<std::time::SystemTime>)> {
    sources
        .iter()
        .map(|p| {
            let m = std::fs::metadata(p).ok();
            (p.clone(), m.as_ref().map(|m| m.len()).unwrap_or(0), m.and_then(|m| m.modified().ok()))
        })
        .collect()
}

fn locate(sources: &[PathBuf], keys: &[String]) -> Result<Option<(usize, crate::scd::RawLoc)>> {
    let st = stamp(sources);
    let mut guard = FILES.lock().unwrap_or_else(|p| p.into_inner());
    if guard.as_ref().map(|(s, _)| *s != st).unwrap_or(true) {
        let mut map = HashMap::new();
        for (si, src) in sources.iter().enumerate() {
            let Ok(mut scd) = Scd::open(src) else { continue };
            for (key, loc) in scd.locations()? {
                map.insert(key, (si, loc));
            }
        }
        *guard = Some((st, map));
    }
    let map = &guard.as_ref().expect("preenchido").1;
    Ok(keys.iter().find_map(|k| map.get(k).copied()))
}

pub fn read_game_file(sources: &[PathBuf], path: &str) -> Result<Vec<u8>> {
    let key = crate::scd::normalize_key(path);
    let mut keys = vec![key.clone()];
    if let Some((stem, ext)) = key.rsplit_once('.') {
        if !stem.ends_with(".win") {
            keys.push(format!("{stem}.win.{ext}"));
        }
    }
    match locate(sources, &keys)? {
        Some((si, loc)) => crate::scd::read_raw(&sources[si], &loc).or_else(|_| Scd::open(&sources[si])?.read(&keys[0]).or_else(|_| Scd::open(&sources[si])?.read(keys.last().expect("1+")))),
        None => Err(Error::Other(format!("{path} não encontrado nos arquivos do jogo"))),
    }
}

/// Miniaturas prontas (as mesmas texturas são pedidas várias vezes pelo editor).
type PngCache = (std::collections::VecDeque<(String, u32)>, HashMap<(String, u32), Vec<u8>>);
static PNGS: Mutex<Option<PngCache>> = Mutex::new(None);

/// Miniatura PNG de uma textura do jogo (lado máximo `max`).
pub fn texture_png(sources: &[PathBuf], path: &str, max: u32) -> Result<Vec<u8>> {
    let k = (crate::scd::normalize_key(path), max);
    if let Some(hit) = PNGS.lock().unwrap_or_else(|p| p.into_inner()).as_ref().and_then(|c| c.1.get(&k)) {
        return Ok(hit.clone());
    }
    let data = read_game_file(sources, path)?;
    // só o nível de mip do tamanho pedido (as texturas do jogo trazem todos)
    let mut img = crate::dds::decode_max(&data, max.max(16))?;
    while img.width > max.max(16) || img.height > max.max(16) {
        img = crate::dds::downsample(&img);
    }
    let png = crate::dds::to_png(&img)?;
    let mut g = PNGS.lock().unwrap_or_else(|p| p.into_inner());
    let c = g.get_or_insert_with(Default::default);
    if !c.1.contains_key(&k) {
        c.0.push_back(k.clone());
        c.1.insert(k, png.clone());
        while c.0.len() > 400 {
            if let Some(old) = c.0.pop_front() {
                c.1.remove(&old);
            }
        }
    }
    Ok(png)
}

/// Modelo de uma decoração para pré-visualizar: malha (LOD0) e a primeira textura de cor.
/// Modelo de uma decoração. `lod` escolhe o nível de detalhe (0 = o mais detalhado; o editor de
/// mapas usa 1, que é leve para milhares de cópias); sem esse nível, usa o mais próximo.
pub fn prop_preview(sources: &[PathBuf], bp: &str, lod: u8) -> Result<(crate::scm::MeshView, Option<Vec<u8>>)> {
    let key = crate::scd::normalize_key(bp);
    let cache_key = format!("{key}#{lod}");
    if let Some(hit) = PREVIEWS.lock().unwrap_or_else(|p| p.into_inner()).as_ref().and_then(|m| m.get(&cache_key)) {
        return Ok(hit.clone());
    }
    let dir = key.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default();
    let stem = key.rsplit('/').next().unwrap_or_default().trim_end_matches("_prop.bp").to_string();
    let index = scm_index(sources)?;
    let lod_of = |f: &str| f.find("_lod").and_then(|i| f[i + 4..].chars().next()).and_then(|c| c.to_digit(10)).unwrap_or(0) as i32;
    let rank = |f: &str| (!f.starts_with(&stem), f.contains("fall"), (lod_of(f) - lod as i32).abs(), lod_of(f) > lod as i32, f.len());
    let best = index
        .iter()
        .filter(|(_, _, k)| k.starts_with(&dir) && !k[dir.len()..].contains('/'))
        .min_by_key(|(_, _, k)| rank(&k[dir.len()..]))
        .cloned();
    // o blueprint (texto em uncompiled_lua.scd) diz a escala, a textura de cor e às vezes o modelo
    // (MeshName), que pode estar em outra pasta (pedras de gelo usam o modelo das pedras comuns)
    let bp_text = read_game_file(sources, &format!("/uncompiled{key}")).ok().map(|t| String::from_utf8_lossy(&t).to_string());
    let info = bp_text.as_deref().map(prop_info).unwrap_or_default();
    let named = (!info.meshes.is_empty())
        .then(|| {
            let i = (lod as usize).min(info.meshes.len() - 1);
            info.meshes[i..].iter().chain(info.meshes[..i].iter()).find_map(|m| read_game_file(sources, m).ok().map(|d| (d, crate::scd::normalize_key(m))))
        })
        .flatten();
    let (data, scm_key) = match named {
        Some(x) => x,
        None => {
            let (src, idx, k) = best.ok_or_else(|| Error::Other("o modelo dessa decoração não foi encontrado".into()))?;
            let _ = (src, idx);
            (read_game_file(sources, &k)?, k)
        }
    };
    let mut mesh = crate::scm::view(&crate::scm::read(&data)?);
    // o modelo vem em unidades do artista: o jogo multiplica por Display.UniformScale
    scale_mesh(&mut mesh, info.scale);
    let texture = info
        .diffuse
        .iter()
        .cloned()
        .chain(diffuse_candidates(sources, &dir, &scm_key))
        // prévia de perto (nível 0) com mais resolução; no mapa, 256 basta e pesa menos
        .find_map(|p| texture_png(sources, &p, if lod == 0 { 512 } else { 256 }).ok());
    let out = (mesh, texture);
    let mut g = PREVIEWS.lock().unwrap_or_else(|p| p.into_inner());
    let cache = g.get_or_insert_with(Default::default);
    if cache.len() > 400 {
        cache.clear();
    }
    cache.insert(cache_key, out.clone());
    Ok(out)
}

#[derive(Debug, Clone, PartialEq)]
pub struct PropLook {
    /// Display.UniformScale (1 quando o blueprint não diz)
    pub scale: f32,
    /// DiffuseName da primeira malha, se houver
    pub diffuse: Option<String>,
    /// MeshName de cada nível de detalhe (quando o blueprint aponta o modelo)
    pub meshes: Vec<String>,
}

impl Default for PropLook {
    fn default() -> Self {
        PropLook { scale: 1.0, diffuse: None, meshes: vec![] }
    }
}

/// Lê a escala e a textura de cor do texto de um blueprint de decoração.
pub fn prop_info(text: &str) -> PropLook {
    let num_after = |key: &str| -> Option<f32> {
        let i = text.find(key)? + key.len();
        let rest = text[i..].trim_start().strip_prefix('=')?.trim_start();
        let end = rest.find(|c: char| !(c.is_ascii_digit() || c == '.' || c == '-' || c == 'e' || c == 'E')).unwrap_or(rest.len());
        rest[..end].parse::<f32>().ok()
    };
    let scale = num_after("UniformScale").filter(|v| v.is_finite() && *v > 0.0 && *v < 100.0).unwrap_or(1.0);
    let diffuse = text.find("DiffuseName").and_then(|i| {
        let q1 = text[i..].find('\'')? + i + 1;
        let q2 = text[q1..].find('\'')? + q1;
        Some(text[q1..q2].to_string()).filter(|p| !p.is_empty())
    });
    let mut meshes = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("MeshName") {
        let after = &rest[i..];
        if let (Some(q1), Some(_)) = (after.find('\''), after.find('=')) {
            let q2 = after[q1 + 1..].find('\'').map(|e| q1 + 1 + e);
            if let Some(q2) = q2 {
                let m = &after[q1 + 1..q2];
                if m.to_ascii_lowercase().ends_with(".scm") {
                    meshes.push(m.to_string());
                }
                rest = &after[q2..];
                continue;
            }
        }
        break;
    }
    PropLook { scale, diffuse, meshes }
}

fn scale_mesh(mesh: &mut crate::scm::MeshView, k: f32) {
    if (k - 1.0).abs() < 1e-6 {
        return;
    }
    for v in mesh.positions.iter_mut() {
        *v *= k;
    }
    for v in mesh.bbox_min.iter_mut().chain(mesh.bbox_max.iter_mut()) {
        *v *= k;
    }
    for b in mesh.bones.iter_mut() {
        for v in b.position.iter_mut().chain(b.world.iter_mut()) {
            *v *= k;
        }
    }
}

/// Texturas de cor prováveis ao lado do modelo (blueprints sem DiffuseName: árvores, pedras…).
fn diffuse_candidates(sources: &[PathBuf], dir: &str, scm_key: &str) -> Vec<String> {
    let file = scm_key.rsplit('/').next().unwrap_or_default();
    let stem = file.split("_lod").next().unwrap_or(file).trim_end_matches(".win.scm").trim_end_matches(".scm");
    let mut out: Vec<String> = ["diffuse", "albedo", "d"].iter().map(|s| format!("{dir}{stem}_{s}.dds")).collect();
    // qualquer textura de cor na mesma pasta
    if let Ok(list) = dds_index(sources) {
        let mut found: Vec<&String> = list
            .iter()
            .filter(|k| k.starts_with(dir) && !k[dir.len()..].contains('/') && (k.contains("diffuse") || k.contains("albedo")))
            .collect();
        found.sort_by_key(|k| (!k[dir.len()..].starts_with(stem), k.len()));
        out.extend(found.into_iter().map(|k| k.replace(".win.dds", ".dds")));
    }
    out
}

static DDS_INDEX: Mutex<Option<(Vec<PathBuf>, Vec<String>)>> = Mutex::new(None);

fn dds_index(sources: &[PathBuf]) -> Result<Vec<String>> {
    let mut g = DDS_INDEX.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((src, list)) = g.as_ref() {
        if src == sources {
            return Ok(list.clone());
        }
    }
    let mut list = Vec::new();
    for src in sources {
        for e in Scd::open(src)?.entries()? {
            if e.key.starts_with("/props/") && e.key.ends_with(".dds") {
                list.push(e.key);
            }
        }
    }
    *g = Some((sources.to_vec(), list.clone()));
    Ok(list)
}

/// Modelos já lidos (o editor pede o mesmo modelo para milhares de decorações).
type Preview = (crate::scm::MeshView, Option<Vec<u8>>);
static PREVIEWS: Mutex<Option<std::collections::HashMap<String, Preview>>> = Mutex::new(None);

/// Todos os `.scm` dos arquivos do jogo: (nº da fonte, entrada, caminho normalizado). Lido uma vez.
type ScmIndex = (Vec<PathBuf>, Vec<(usize, usize, String)>);
static SCM_INDEX: Mutex<Option<ScmIndex>> = Mutex::new(None);

fn scm_index(sources: &[PathBuf]) -> Result<Vec<(usize, usize, String)>> {
    let mut g = SCM_INDEX.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((src, list)) = g.as_ref() {
        if src == sources {
            return Ok(list.clone());
        }
    }
    let mut list = Vec::new();
    for (si, src) in sources.iter().enumerate() {
        for (i, e) in Scd::open(src)?.entries()?.into_iter().enumerate() {
            if e.key.ends_with(".scm") {
                list.push((si, i, e.key));
            }
        }
    }
    *g = Some((sources.to_vec(), list.clone()));
    Ok(list)
}

/// Textura de chão do usuário (PNG quadrado) → as três texturas que o jogo usa numa camada:
/// cor (`_d`, DXT1 com mips), relevo (`_n`, normal tirada do brilho da imagem) e brilho (`_s`).
/// Lados que não são potência de 2 são reduzidos para a potência de 2 abaixo (máx. 2048).
pub fn custom_ground_dds(png: &[u8]) -> Result<[Vec<u8>; 3]> {
    use crate::dds::{encode, DdsFormat, Quality, Rgba};
    let src = crate::dds::from_png(png)?;
    let side = src.width.min(src.height).clamp(16, 2048);
    let side = 1u32 << (31 - side.leading_zeros());
    // recorte quadrado no centro e reamostragem simples (vizinho mais próximo ponderado 2×2)
    let (ox, oy) = ((src.width - src.width.min(src.height)) / 2, (src.height - src.width.min(src.height)) / 2);
    let span = src.width.min(src.height) as f32;
    let mut img = Rgba { width: side, height: side, pixels: vec![0; (side * side * 4) as usize] };
    for y in 0..side {
        for x in 0..side {
            let mut acc = [0u32; 4];
            for (dx, dy) in [(0.25f32, 0.25f32), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)] {
                let sx = ox + (((x as f32 + dx) / side as f32 * span) as u32).min(span as u32 - 1);
                let sy = oy + (((y as f32 + dy) / side as f32 * span) as u32).min(span as u32 - 1);
                let i = ((sy * src.width + sx) * 4) as usize;
                for (a, p) in acc.iter_mut().zip(&src.pixels[i..i + 4]) {
                    *a += *p as u32;
                }
            }
            let o = ((y * side + x) * 4) as usize;
            for (px, a) in img.pixels[o..o + 3].iter_mut().zip(acc) {
                *px = (a / 4) as u8;
            }
            img.pixels[o + 3] = 255;
        }
    }
    let lum: Vec<f32> = img.pixels.chunks(4).map(|p| (0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32) / 255.0).collect();
    let n = side as i64;
    let at = |x: i64, y: i64| lum[(y.rem_euclid(n) * n + x.rem_euclid(n)) as usize];
    let mut nrm = Rgba { width: side, height: side, pixels: vec![255; (side * side * 4) as usize] };
    let mut spec = nrm.clone();
    // força do relevo proporcional ao tamanho (a mesma aparência em 512 ou 2048)
    let k = 2.2 * side as f32 / 1024.0;
    for y in 0..n {
        for x in 0..n {
            let dx = (at(x + 1, y - 1) + 2.0 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2.0 * at(x - 1, y) + at(x - 1, y + 1));
            let dy = (at(x - 1, y + 1) + 2.0 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2.0 * at(x, y - 1) + at(x + 1, y - 1));
            let (vx, vy, vz) = (-dx * k, -dy * k, 1.0f32);
            let l = (vx * vx + vy * vy + vz * vz).sqrt();
            let o = ((y * n + x) * 4) as usize;
            nrm.pixels[o] = ((vx / l * 0.5 + 0.5) * 255.0).round() as u8;
            nrm.pixels[o + 1] = ((vy / l * 0.5 + 0.5) * 255.0).round() as u8;
            nrm.pixels[o + 2] = ((vz / l * 0.5 + 0.5) * 255.0).round() as u8;
            let g = (35.0 + 70.0 * at(x, y)).round() as u8;
            spec.pixels[o..o + 3].copy_from_slice(&[g, g, g]);
        }
    }
    let d = encode(&img, DdsFormat::Dxt1, 0, Quality::Normal)?;
    let nn = encode(&nrm, DdsFormat::Dxt1, 0, Quality::Fast)?;
    let half = crate::dds::downsample(&spec);
    let sp = encode(&half, DdsFormat::Dxt1, 0, Quality::Fast)?;
    Ok([d, nn, sp])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn custom_ground_texture_makes_three_dds() {
        let img = crate::dds::Rgba { width: 300, height: 200, pixels: (0..300 * 200).flat_map(|i| [(i % 251) as u8, 90, 40, 255]).collect() };
        let png = crate::dds::to_png(&img).unwrap();
        let [d, n, s] = custom_ground_dds(&png).unwrap();
        let (di, _) = crate::dds::decode(&d).unwrap();
        assert_eq!((di.width, di.height), (128, 128));
        assert!(di.mip_count > 5);
        let (_, nimg) = crate::dds::decode(&n).unwrap();
        // normal aponta para cima na média (azul alto)
        let blue: u32 = nimg.pixels.chunks(4).map(|p| p[2] as u32).sum::<u32>() / (nimg.width * nimg.height);
        assert!(blue > 180, "{blue}");
        assert_eq!(crate::dds::info(&s).unwrap().width, 64);
    }

    #[test]
    fn reads_prop_scale_and_texture() {
        let i = prop_info("PropBlueprint {\n Display = { Mesh = { LODs = { { DiffuseName = '/props/a/a_Diffuse.dds' } } }, UniformScale = 0.2, },\n}");
        assert!((i.scale - 0.2).abs() < 1e-6);
        assert_eq!(i.diffuse.as_deref(), Some("/props/a/a_Diffuse.dds"));
        assert_eq!(prop_info("PropBlueprint { }").scale, 1.0);
        let m = prop_info("LODs = { { MeshName = '/props/Rocks/Rock_Cluster01/Rock_Cluster01_lod0.scm', }, { MeshName = '/x/y_lod1.scm' } }, UniformScale = 0.3");
        assert_eq!(m.meshes, vec!["/props/Rocks/Rock_Cluster01/Rock_Cluster01_lod0.scm".to_string(), "/x/y_lod1.scm".to_string()]);
    }

    /// Com os arquivos do jogo em CP_GAMEDATA: a árvore fica do tamanho do jogo e com textura.
    #[test]
    fn real_prop_if_available() {
        let Some(dir) = std::env::var_os("CP_GAMEDATA") else { return };
        let dir = PathBuf::from(dir);
        let srcs: Vec<PathBuf> = ["props.scd", "uncompiled_lua.scd"].iter().map(|f| dir.join(f)).filter(|p| p.exists()).collect();
        if srcs.len() < 2 {
            return;
        }
        let (m, tex) = prop_preview(&srcs, "/props/Trees/Tree06/Tree06_prop.bp", 1).unwrap();
        let h = m.bbox_max[1] - m.bbox_min[1];
        assert!(h > 0.8 && h < 3.0, "altura {h}");
        assert!(tex.is_some(), "árvore sem textura");
        let sz = prop_sizes(&srcs, &["/props/Trees/Tree06/Tree06_prop.bp".to_string()]);
        let t = sz.get("/props/trees/tree06/tree06_prop.bp").expect("tamanho da árvore");
        assert!(t[1] > 0.8 && t[1] < 3.0, "{t:?}");
        let (m, _) = prop_preview(&srcs, "/props/Warehouses/UEF/UWarehouse03/UWarehouse03_prop.bp", 0).unwrap();
        let w = m.bbox_max[0] - m.bbox_min[0];
        assert!(w > 4.0 && w < 20.0, "largura {w}");
    }

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
