//! Tropas: catálogo das unidades do jogo e geração de unidades novas (mod).
//!
//! Uma tropa nova é uma cópia de uma unidade do jogo com outro id: o blueprint em texto
//! (de `uncompiled/units/...`) recebe as alterações do editor sem perder o resto; os arquivos da
//! pasta da unidade (malhas, texturas, animações, ícones) são copiados com o nome novo; o script
//! novo só reaproveita o comportamento da unidade base. Opcionalmente a malha e as texturas vêm de
//! um modelo feito no editor 3D.
//!
//! **Experimental**: o jogo só acha a unidade se carregar blueprints novos de mods; isso precisa
//! ser confirmado no jogo de cada um (ver docs/criacao.md).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;

use crate::blueprint::{self, Leaf, Set};
use crate::error::{Error, Result};
use crate::scd::{Scd, ScdBuilder};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UnitInfo {
    pub id: String,
    pub name: String,
    pub faction: String,
    /// terrestre, aérea, naval, estrutura…
    pub role: String,
    pub description: String,
    pub categories: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeaponInfo {
    pub index: usize,
    pub label: String,
    pub dummy: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitDetails {
    pub id: String,
    pub name: String,
    pub description: String,
    pub faction: String,
    pub role: String,
    /// texto do blueprint (para mostrar e para conferir)
    pub text: String,
    pub leaves: Vec<Leaf>,
    pub categories: Vec<String>,
    pub weapons: Vec<WeaponInfo>,
    /// campos de animação do blueprint (`Display.AnimationWalk` → caminho)
    pub animations: Vec<(String, String)>,
    /// ossos que o blueprint usa (armas, fumaças…): um modelo próprio precisa tê-los
    pub bones: Vec<String>,
    /// arquivos da pasta da unidade (caminho interno, tamanho)
    pub files: Vec<(String, u64)>,
    /// malha principal (para pré-visualizar)
    pub mesh: Option<String>,
    pub albedo: Option<String>,
}

const FACTIONS: [&str; 3] = ["UEF", "CYBRAN", "ILLUMINATE"];

fn role_of(cats: &[String]) -> String {
    let has = |c: &str| cats.iter().any(|x| x.eq_ignore_ascii_case(c));
    if has("COMMAND") {
        "Comandante"
    } else if has("EXPERIMENTAL") {
        "Experimental"
    } else if has("STRUCTURE") {
        "Estrutura"
    } else if has("AIR") {
        "Aérea"
    } else if has("NAVAL") {
        "Naval"
    } else if has("LAND") {
        "Terrestre"
    } else {
        "Outra"
    }
    .into()
}

fn faction_of(bp: &blueprint::Blueprint, cats: &[String]) -> String {
    if let Some(f) = bp.text("General.FactionName") {
        return f.to_ascii_uppercase();
    }
    FACTIONS
        .iter()
        .find(|f| cats.iter().any(|c| c.eq_ignore_ascii_case(f)))
        .map(|f| f.to_string())
        .unwrap_or_else(|| "?".into())
}

/// Id da unidade a partir do caminho do blueprint. No jogo eles ficam em
/// `/units/<facção>/<ID>/<ID>_unit.bp`; tropas de mods podem estar em `/units/<ID>/`.
fn unit_id_of(key: &str) -> Option<String> {
    let k = key.strip_prefix("/uncompiled").unwrap_or(key);
    let rest = k.strip_prefix("/units/")?;
    let (dirs, file) = rest.rsplit_once('/')?;
    let dir = dirs.rsplit('/').next()?;
    let f = file.strip_suffix("_unit.bp")?;
    (f == dir && !dir.is_empty() && dirs.split('/').count() <= 2).then(|| dir.to_string())
}

/// Pasta da unidade no jogo (`/units/uef/uul0101/`), com barra no fim.
fn dir_of(key: &str) -> String {
    let k = key.strip_prefix("/uncompiled").unwrap_or(key);
    k.rsplit_once('/').map(|(d, _)| format!("{d}/")).unwrap_or_default()
}

/// Pasta da unidade do jogo (ex.: `/units/uef/uul0101/`).
pub fn unit_dir(sources: &[PathBuf], id: &str) -> Result<String> {
    let id = id.to_ascii_lowercase();
    let (idx, _) = index(sources)?;
    idx.get(&id).map(|e| e.3.clone()).ok_or_else(|| Error::Other(format!("unidade {id} não encontrada nos arquivos do jogo")))
}

/// Troca a pasta da base pela pasta da tropa nova (e o id no nome do arquivo):
/// `/units/uef/uul0101/uul0101_lod0.scm` → `/units/cpmart01/cpmart01_lod0.scm`.
pub fn relocate(path: &str, base_dir: &str, base: &str, new: &str) -> String {
    let lower = path.to_ascii_lowercase();
    let bd = base_dir.trim_start_matches('/');
    let (lead, rest) = match lower.find(bd) {
        Some(p) if !bd.is_empty() => (&path[..p], &path[p + bd.len()..]),
        _ => return rename(path, base, new),
    };
    // o caminho continua relativo ou absoluto como era
    let lead = if lead.ends_with('/') || lead.is_empty() { lead } else { "" };
    format!("{lead}units/{new}/{}", rename(rest, base, new))
}

/// (fonte, entrada, é texto, pasta) do blueprint de cada unidade.
type Index = BTreeMap<String, (usize, usize, bool, String)>;
type Cached = (Vec<PathBuf>, Index, Vec<UnitInfo>);
static INDEX: Mutex<Option<Cached>> = Mutex::new(None);

fn index(sources: &[PathBuf]) -> Result<(Index, Vec<UnitInfo>)> {
    if let Some((s, i, c)) = INDEX.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
        if s == sources {
            return Ok((i.clone(), c.clone()));
        }
    }
    let mut idx: Index = BTreeMap::new();
    for (si, src) in sources.iter().enumerate() {
        let Ok(mut scd) = Scd::open(src) else { continue };
        for (i, e) in scd.entries()?.into_iter().enumerate() {
            if let Some(id) = unit_id_of(&e.key) {
                let uncompiled = e.key.starts_with("/uncompiled");
                // prefere o texto (uncompiled); entre iguais, o montado por último vence
                let keep = match idx.get(&id) {
                    Some(&(_, _, u, _)) => uncompiled || !u,
                    None => true,
                };
                if keep {
                    idx.insert(id, (si, i, uncompiled, dir_of(&e.key)));
                }
            }
        }
    }
    let mut cat = Vec::new();
    for (id, (si, i, _, dir)) in &idx {
        let (si, i) = (*si, *i);
        let Ok(data) = Scd::open(&sources[si]).and_then(|mut s| s.read_at(i)) else { continue };
        if data.starts_with(b"\x1bLua") {
            continue; // só bytecode: não dá para editar
        }
        let text = String::from_utf8_lossy(&data);
        let Ok(bp) = blueprint::parse(&text) else { continue };
        let cats = bp.get("Categories").map(|c| c.strings()).unwrap_or_default();
        let name = bp
            .text("General.UnitName")
            .or_else(|| bp.text("Description"))
            .map(|s| blueprint::strip_loc(&s))
            .filter(|s| !s.trim().is_empty())
            .unwrap_or_else(|| id.to_uppercase());
        cat.push(UnitInfo {
            id: id.clone(),
            name,
            faction: Some(faction_of(&bp, &cats)).filter(|f| f != "?").unwrap_or_else(|| {
                // sem facção no blueprint: a pasta do jogo diz (/units/uef/…)
                let seg = dir.trim_start_matches("/units/").split('/').next().unwrap_or_default().to_ascii_uppercase();
                if FACTIONS.iter().any(|f| f.eq_ignore_ascii_case(&seg)) { seg } else { "?".into() }
            }),
            role: role_of(&cats),
            description: bp.text("Description").map(|s| blueprint::strip_loc(&s)).unwrap_or_default(),
            categories: cats,
        });
    }
    cat.sort_by(|a, b| a.faction.cmp(&b.faction).then(a.role.cmp(&b.role)).then(a.name.cmp(&b.name)));
    *INDEX.lock().unwrap_or_else(|p| p.into_inner()) = Some((sources.to_vec(), idx.clone(), cat.clone()));
    Ok((idx, cat))
}

pub fn catalog(sources: &[PathBuf]) -> Result<Vec<UnitInfo>> {
    Ok(index(sources)?.1)
}

/// Caminhos (`/projectiles/...bp`, `.sca`, `.dds`…) que não existem nos arquivos do jogo.
pub fn missing_files(sources: &[PathBuf], paths: &[String]) -> Result<Vec<String>> {
    static KEYS: Mutex<Option<(Vec<PathBuf>, std::collections::HashSet<String>)>> = Mutex::new(None);
    let mut guard = KEYS.lock().unwrap_or_else(|p| p.into_inner());
    if guard.as_ref().map(|(s, _)| s.as_slice() != sources).unwrap_or(true) {
        let mut set = std::collections::HashSet::new();
        for src in sources {
            let Ok(mut scd) = Scd::open(src) else { continue };
            for e in scd.entries()? {
                let k = e.key.to_ascii_lowercase();
                set.insert(k.replace(".win.", "."));
                set.insert(k.strip_prefix("/uncompiled").unwrap_or(&k).to_string());
                set.insert(k);
            }
        }
        *guard = Some((sources.to_vec(), set));
    }
    let set = &guard.as_ref().expect("preenchido").1;
    Ok(paths
        .iter()
        .filter(|p| {
            let k = p.trim().to_ascii_lowercase().replace('\\', "/");
            let k = if k.starts_with('/') { k } else { format!("/{k}") };
            !set.contains(&k) && !set.contains(&k.replace(".win.", "."))
        })
        .cloned()
        .collect())
}

/// Texto do blueprint de uma unidade do jogo.
pub fn blueprint_text(sources: &[PathBuf], id: &str) -> Result<String> {
    let id = id.to_ascii_lowercase();
    let (idx, _) = index(sources)?;
    let &(si, i, _, _) = idx.get(&id).ok_or_else(|| Error::Other(format!("unidade {id} não encontrada nos arquivos do jogo")))?;
    let data = Scd::open(&sources[si])?.read_at(i)?;
    if data.starts_with(b"\x1bLua") {
        return Err(Error::Format(format!("o blueprint de {id} só existe compilado; não dá para usar como base")));
    }
    Ok(String::from_utf8_lossy(&data).into_owned())
}

/// Arquivos do jogo de uma unidade: a pasta `/units/<id>/` e arquivos com o nome começando
/// pelo id em outras pastas de texturas (ícones). (fonte, entrada, caminho, tamanho)
fn unit_files(sources: &[PathBuf], id: &str) -> Result<Vec<(usize, usize, String, u64)>> {
    let id = id.to_ascii_lowercase();
    let dir = unit_dir(sources, &id).unwrap_or_else(|_| format!("/units/{id}/"));
    let mut found: HashMap<String, (usize, usize, String, u64)> = HashMap::new();
    for (si, src) in sources.iter().enumerate() {
        let Ok(mut scd) = Scd::open(src) else { continue };
        for (i, e) in scd.entries()?.into_iter().enumerate() {
            if e.is_dir {
                continue;
            }
            let file = e.key.rsplit('/').next().unwrap_or_default();
            let in_dir = e.key.starts_with(&dir) && !e.key[dir.len()..].contains('/');
            let icon = e.key.starts_with("/textures/") && file.starts_with(&id);
            if in_dir || icon {
                found.insert(e.key.clone(), (si, i, e.name.replace('\\', "/"), e.size));
            }
        }
    }
    let mut v: Vec<_> = found.into_values().collect();
    v.sort_by_key(|a| a.2.to_ascii_lowercase());
    Ok(v)
}

pub fn details(sources: &[PathBuf], id: &str) -> Result<UnitDetails> {
    let id = id.to_ascii_lowercase();
    let text = blueprint_text(sources, &id)?;
    let bp = blueprint::parse(&text)?;
    let cats = bp.get("Categories").map(|c| c.strings()).unwrap_or_default();
    let leaves = bp.leaves();
    let weapons = bp
        .get("Weapon")
        .map(|w| {
            w.entries()
                .iter()
                .filter(|e| e.key.is_none())
                .enumerate()
                .map(|(i, e)| WeaponInfo {
                    index: i + 1,
                    label: e.value.child("Label").and_then(|l| l.value.as_str().map(str::to_owned)).unwrap_or_else(|| format!("Arma {}", i + 1)),
                    dummy: e.value.child("DummyWeapon").map(|d| d.value == blueprint::Value::Bool(true)).unwrap_or(false),
                })
                .collect()
        })
        .unwrap_or_default();
    let animations = leaves
        .iter()
        .filter(|l| l.path.starts_with("Display.Animation") && l.text.as_deref().is_some_and(|t| t.to_ascii_lowercase().ends_with(".sca")))
        .map(|l| (l.path.clone(), l.text.clone().unwrap_or_default()))
        .collect();
    let mut bones: Vec<String> = leaves
        .iter()
        .filter(|l| {
            let p = l.path.to_ascii_lowercase();
            l.text.is_some() && (p.contains("bone") || p.contains("muzzle")) && !p.contains("blueprint")
        })
        .filter_map(|l| l.text.clone())
        .filter(|t| !t.is_empty() && !t.contains('/') && !t.contains(' '))
        .collect();
    bones.sort();
    bones.dedup();
    let files: Vec<(String, u64)> = unit_files(sources, &id)?.into_iter().map(|(_, _, n, s)| (n, s)).collect();
    let lower = |s: &str| s.to_ascii_lowercase();
    let mesh = files.iter().map(|f| &f.0).find(|n| lower(n).contains("_lod0") && lower(n).ends_with(".scm")).or_else(|| files.iter().map(|f| &f.0).find(|n| lower(n).ends_with(".scm"))).cloned();
    let albedo = files.iter().map(|f| &f.0).find(|n| { let l = lower(n); l.ends_with(".dds") && (l.contains("diffuse") || l.contains("albedo")) && l.starts_with("units/") }).cloned();
    Ok(UnitDetails {
        name: bp.text("General.UnitName").map(|s| blueprint::strip_loc(&s)).unwrap_or_else(|| id.to_uppercase()),
        description: bp.text("Description").map(|s| blueprint::strip_loc(&s)).unwrap_or_default(),
        faction: faction_of(&bp, &cats),
        role: role_of(&cats),
        id,
        text,
        leaves,
        categories: cats,
        weapons,
        animations,
        bones,
        files,
        mesh,
        albedo,
    })
}

/// Todas as animações do jogo (`.sca`), para trocar as de uma tropa.
pub fn all_animations(sources: &[PathBuf]) -> Result<Vec<String>> {
    let mut out = std::collections::BTreeSet::new();
    for src in sources {
        let Ok(mut scd) = Scd::open(src) else { continue };
        for e in scd.entries()? {
            if e.key.ends_with(".sca") {
                out.insert(e.key.replace(".win.sca", ".sca"));
            }
        }
    }
    Ok(out.into_iter().collect())
}

/// Pedido de geração de uma tropa.
#[derive(Debug, Clone, Default)]
pub struct UnitBuild {
    pub base: String,
    pub new_id: String,
    pub name: String,
    pub description: String,
    pub changes: Vec<(String, Set)>,
    /// lista completa de categorias (`None` = as da base)
    pub categories: Option<Vec<String>>,
    pub scale: Option<f64>,
    /// campo de animação → caminho .sca e velocidade opcional
    pub animations: Vec<(String, String, Option<f64>)>,
    /// malha e texturas de um modelo do editor 3D (substituem as da base)
    pub model: Option<crate::modelgen::ModelFiles>,
    /// textura de cor pintada/importada (PNG) que substitui a da base
    pub albedo_png: Option<Vec<u8>>,
    /// ajuste de cor da textura (matiz em graus; saturação e brilho em %)
    pub tint: (f32, f32, f32),
    /// arquivos a mais (ex.: animações criadas no editor), com o caminho interno
    pub extra_files: Vec<(String, Vec<u8>)>,
    /// armas copiadas de outras unidades: (posição na tropa, 0 = arma nova; unidade; posição lá)
    pub weapon_copies: Vec<(usize, String, usize)>,
    /// ícone (PNG) que substitui os ícones da base
    pub icon_png: Option<Vec<u8>>,
    /// ossos renomeados (unidade de origem → tropa) aplicados nas armas copiadas
    pub bone_renames: Vec<(String, String)>,
    /// esqueleto final: referências a ossos que não existem são trocadas pelo osso de mesmo papel
    pub skeleton: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildReport {
    pub files: usize,
    pub warnings: Vec<String>,
    pub blueprint: String,
    /// verificação de combate, movimento, colisão, ossos e animações
    pub checks: Vec<crate::unitcheck::Finding>,
}

/// Modelo final (o próprio ou o da base) e as animações citadas, para a verificação.
fn checks_for(sources: &[PathBuf], b: &UnitBuild, text: &str) -> Result<Vec<crate::unitcheck::Finding>> {
    let model = match &b.model {
        Some(m) => crate::scm::read(&m.scm)?,
        None => {
            let files = unit_files(sources, &b.base)?;
            let pick = files
                .iter()
                .filter(|f| f.2.to_ascii_lowercase().ends_with(".scm"))
                .min_by_key(|f| (!f.2.to_ascii_lowercase().contains("lod0"), f.2.len()));
            match pick {
                Some((si, i, _, _)) => match Scd::open(&sources[*si]).and_then(|mut s| s.read_at(*i)).and_then(|d| crate::scm::read(&d)) {
                    Ok(m) => m,
                    Err(e) => return Ok(vec![crate::unitcheck::Finding { level: "warn", area: "Modelo", text: format!("não deu para ler o modelo da base para conferir: {e}") }]),
                },
                None => return Ok(vec![crate::unitcheck::Finding { level: "warn", area: "Modelo", text: "não achei o modelo da unidade base para conferir".into() }]),
            }
        }
    };
    let bp = blueprint::parse(text)?;
    let new = b.new_id.to_ascii_lowercase();
    let anims = crate::unitcheck::load_anims(&bp, &mut |path: &str| {
        let key = path.trim_start_matches('/').to_ascii_lowercase();
        if let Some((_, d)) = b.extra_files.iter().find(|(p, _)| p.to_ascii_lowercase() == key) {
            return Some(d.clone());
        }
        // arquivos da base copiados com o nome novo
        let orig = key.replace(&format!("units/{new}/{new}"), &format!("units/{0}/{0}", b.base.to_ascii_lowercase()));
        crate::mapassets::read_game_file(sources, &format!("/{orig}")).ok()
    });
    Ok(crate::unitcheck::check(text, &model, &anims))
}

/// Só verifica (sem gerar nada): blueprint final, modelo e animações.
pub fn validate(sources: &[PathBuf], b: &UnitBuild) -> Result<Vec<crate::unitcheck::Finding>> {
    let (text, _) = make_blueprint(sources, b)?;
    checks_for(sources, b, &text)
}

pub fn valid_id(id: &str) -> bool {
    (4..=16).contains(&id.len()) && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') && id.chars().next().is_some_and(|c| c.is_ascii_lowercase())
}

/// troca `base` por `new` nos nomes (sem diferenciar maiúsculas), mantendo o resto
pub fn rename(s: &str, base: &str, new: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while let Some(p) = lower[i..].find(base) {
        out.push_str(&s[i..i + p]);
        out.push_str(new);
        i += p + base.len();
    }
    out.push_str(&s[i..]);
    out
}

/// Blueprint da tropa nova (texto), sem gerar o pacote: base + caminhos novos + alterações.
pub fn make_blueprint(sources: &[PathBuf], b: &UnitBuild) -> Result<(String, Vec<String>)> {
    let base = b.base.to_ascii_lowercase();
    let new = b.new_id.to_ascii_lowercase();
    let mut warnings = Vec::new();
    let mut text = blueprint_text(sources, &base)?;

    // 1) caminhos da pasta da unidade base passam a apontar para a pasta nova
    let bp = blueprint::parse(&text)?;
    let base_dir = unit_dir(sources, &base)?;
    // só os caminhos de arquivos que vão junto no pacote (sons e outros nomes ficam como eram)
    let norm = |p: &str| p.trim_start_matches('/').to_ascii_lowercase().replace('\\', "/").replace(".win.", ".");
    let shipped: std::collections::HashSet<String> = unit_files(sources, &base)?.iter().map(|f| norm(&f.2)).collect();
    let mut changes: Vec<(String, Set)> = bp
        .leaves()
        .into_iter()
        .filter_map(|l| {
            let t = l.text?;
            (t.to_ascii_lowercase().contains(&base_dir) && shipped.contains(&norm(&t))).then(|| (l.path, Set::Str(relocate(&t, &base_dir, &base, &new))))
        })
        .collect();
    // 2) alterações do editor
    changes.push(("General.UnitName".into(), Set::Str(b.name.clone())));
    if !b.description.trim().is_empty() {
        changes.push(("Description".into(), Set::Str(b.description.clone())));
    }
    if let Some(c) = &b.categories {
        changes.push(("Categories".into(), Set::Strings(c.clone())));
    }
    if let Some(s) = b.scale.filter(|s| *s > 0.0) {
        changes.push(("Display.UniformScale".into(), Set::Number(s)));
    }
    for (field, path, rate) in &b.animations {
        if !field.starts_with("Display.Animation") || field.contains("..") {
            warnings.push(format!("campo de animação ignorado: {field}"));
            continue;
        }
        changes.push((field.clone(), Set::Str(path.clone())));
        if let Some(r) = rate {
            changes.push((format!("{field}Rate"), Set::Number(*r)));
        }
    }
    text = blueprint::apply(&text, &changes)?;
    // 3) armas copiadas de outras unidades (antes das alterações, que podem mexer nelas)
    for (target, unit, src) in &b.weapon_copies {
        let unit = unit.to_ascii_lowercase();
        let other = blueprint_text(sources, &unit)?;
        let Some(w) = blueprint::value_text(&other, &format!("Weapon.{src}"))? else {
            warnings.push(format!("a arma {src} de {unit} não existe"));
            continue;
        };
        let w = crate::unitmix::rename_bones_in(&w, &b.bone_renames);
        if *target == 0 {
            text = match blueprint::append_item(&text, "Weapon", &w) {
                Ok((t, _)) => t,
                Err(_) => blueprint::apply(&text, &[("Weapon".into(), Set::Raw(format!("{{\n        {w},\n    }}")))])?,
            };
        } else {
            text = blueprint::apply(&text, &[(format!("Weapon.{target}"), Set::Raw(w))])?;
        }
        warnings.push(format!("arma copiada de {unit}: confira no jogo se os pontos de disparo (ossos) dela existem nesta tropa"));
    }
    // 4) alterações do editor
    if !b.changes.is_empty() {
        text = blueprint::apply(&text, &b.changes)?;
    }
    // 5) ossos citados pelas armas/efeitos precisam existir no esqueleto final
    if let Some(bones) = &b.skeleton {
        let (t, fixes) = crate::unitmix::repair_bone_refs(&text, bones)?;
        text = t;
        warnings.extend(fixes.into_iter().map(|c| c.text));
    }
    Ok((text, warnings))
}

/// Ícone novo no tamanho e formato do ícone original (imagem centralizada, sem distorcer).
fn icon_texture(orig: &[u8], png: &[u8]) -> Result<Vec<u8>> {
    let (info, _) = crate::dds::decode(orig)?;
    let mut img = crate::dds::from_png(png)?;
    let (tw, th) = (info.width.max(1), info.height.max(1));
    while img.width >= tw * 2 && img.height >= th * 2 {
        img = crate::dds::downsample(&img);
    }
    let k = (tw as f32 / img.width as f32).min(th as f32 / img.height as f32);
    let (w, h) = (((img.width as f32 * k).round() as u32).max(1), ((img.height as f32 * k).round() as u32).max(1));
    let fit = crate::enhance::upscale_lanczos(&img, w, h);
    let mut out = crate::dds::Rgba { width: tw, height: th, pixels: vec![0; (tw * th * 4) as usize] };
    let (ox, oy) = ((tw - w.min(tw)) / 2, (th - h.min(th)) / 2);
    for y in 0..h.min(th) {
        for x in 0..w.min(tw) {
            let s = ((y * w + x) * 4) as usize;
            let d = (((y + oy) * tw + x + ox) * 4) as usize;
            out.pixels[d..d + 4].copy_from_slice(&fit.pixels[s..s + 4]);
        }
    }
    crate::dds::encode(&out, info.format, if info.mip_count <= 1 { 1 } else { 0 }, crate::dds::Quality::Normal)
}

/// Gera o `.scd` da tropa em `dest` e devolve o relatório.
pub fn build(sources: &[PathBuf], b: &UnitBuild, dest: &Path) -> Result<BuildReport> {
    let base = b.base.to_ascii_lowercase();
    let new = b.new_id.to_ascii_lowercase();
    if !valid_id(&new) {
        return Err(Error::Other("id da tropa inválido: use 4 a 16 letras minúsculas, números ou _, começando por letra".into()));
    }
    let (idx, _) = index(sources)?;
    if idx.contains_key(&new) {
        return Err(Error::Other(format!("já existe uma unidade {new} no jogo: escolha outro id")));
    }
    let (text, mut warnings) = make_blueprint(sources, b)?;
    let checks = checks_for(sources, b, &text)?;
    let errs: Vec<String> = checks.iter().filter(|c| c.level == "err").map(|c| format!("{}: {}", c.area, c.text)).collect();
    if !errs.is_empty() {
        return Err(Error::Other(format!("a tropa não passou na verificação:\n- {}", errs.join("\n- "))));
    }
    warnings.extend(checks.iter().filter(|c| c.level == "warn").map(|c| format!("{}: {}", c.area, c.text)));
    let header = format!("# Gerado pelo CommandProject a partir de {base}. Editar este arquivo à mão é seguro.\n");

    // 3) arquivos copiados com o nome novo
    let mut out = ScdBuilder::create(dest)?;
    let mut added = std::collections::HashSet::new();
    let mut add = |out: &mut ScdBuilder, name: &str, data: &[u8]| -> Result<()> {
        for n in crate::modelgen::both_names(name) {
            if added.insert(n.to_ascii_lowercase()) {
                out.add_bytes(&n, data)?;
            }
        }
        Ok(())
    };
    let bp_path = format!("units/{new}/{new}_unit.bp");
    add(&mut out, &bp_path, format!("{header}{text}").as_bytes())?;
    let base_dir = unit_dir(sources, &base)?;
    let script = format!(
        "-- Gerado pelo CommandProject: {new} usa o comportamento de {base}.\nlocal base = import('{base_dir}{base}_script.lua')\nTypeClass = base.TypeClass\n"
    );
    add(&mut out, &format!("units/{new}/{new}_script.lua"), script.as_bytes())?;

    // arquivos próprios primeiro: substituem os de mesmo nome copiados da base
    for (path, data) in &b.extra_files {
        add(&mut out, path, data)?;
    }
    let files = unit_files(sources, &base)?;
    let mut have_albedo = false;
    let lower_name = |n: &str| n.rsplit('/').next().unwrap_or(n).to_ascii_lowercase();
    for (si, i, name, _) in &files {
        let ln = lower_name(name);
        if ln.ends_with("_unit.bp") || ln.ends_with("_script.lua") {
            continue;
        }
        let new_name = relocate(name, &base_dir, &base, &new);
        let mut data = Scd::open(&sources[*si])?.read_at(*i)?;
        let is_dds = ln.ends_with(".dds") && name.to_ascii_lowercase().starts_with("units/");
        if let Some(png) = b.icon_png.as_ref().filter(|_| ln.ends_with(".dds") && !name.to_ascii_lowercase().starts_with("units/")) {
            match icon_texture(&data, png) {
                Ok(d) => data = d,
                Err(e) => warnings.push(format!("ícone {new_name} não trocado: {e}")),
            }
        }
        if let Some(m) = &b.model {
            if ln.ends_with(".scm") {
                data = m.scm.clone();
            } else if is_dds {
                data = if ln.contains("diffuse") || ln.contains("albedo") {
                    have_albedo = true;
                    let mut d = match &b.albedo_png {
                        Some(png) => replace_texture(&m.albedo, png)?,
                        None => m.albedo.clone(),
                    };
                    let (h, s2, v) = b.tint;
                    if h != 0.0 || s2 != 0.0 || v != 0.0 {
                        d = tint_texture(&d, h, s2, v)?;
                    }
                    d
                } else if ln.contains("team") {
                    m.team.clone()
                } else if ln.contains("normal") {
                    m.normal.clone()
                } else if ln.contains("mask") || ln.contains("spec") {
                    m.mask.clone()
                } else {
                    data
                };
            }
        } else if is_dds && (ln.contains("diffuse") || ln.contains("albedo")) {
            have_albedo = true;
            if let Some(png) = &b.albedo_png {
                data = replace_texture(&data, png)?;
            }
            let (h, s, v) = b.tint;
            if h != 0.0 || s != 0.0 || v != 0.0 {
                data = tint_texture(&data, h, s, v)?;
            }
        }
        add(&mut out, &new_name, &data)?;
    }
    if !have_albedo && (b.albedo_png.is_some() || b.tint != (0.0, 0.0, 0.0)) {
        warnings.push("não achei a textura de cor da unidade base; a cor não foi alterada".into());
    }
    if let Some(m) = &b.model {
        warnings.extend(m.warnings.iter().cloned());
        // ossos que o blueprint usa precisam existir no modelo próprio
        let model = crate::scm::read(&m.scm)?;
        let have: std::collections::HashSet<String> = model.bones.iter().map(|b| b.name.to_ascii_lowercase()).collect();
        let d = blueprint::parse(&text)?;
        let missing: Vec<String> = d
            .leaves()
            .into_iter()
            .filter(|l| l.path.to_ascii_lowercase().contains("bone") && l.text.as_deref().is_some_and(|t| !t.is_empty() && !t.contains('/')))
            .filter_map(|l| l.text)
            .filter(|t| !have.contains(&t.to_ascii_lowercase()))
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect();
        if !missing.is_empty() {
            warnings.push(format!("o modelo não tem os ossos {} que as armas/efeitos usam; nomeie grupos do modelo com esses nomes", missing.join(", ")));
        }
    }
    let count = added.len();
    out.finish()?;
    Ok(BuildReport { files: count, warnings, blueprint: text, checks })
}

fn replace_texture(orig: &[u8], png: &[u8]) -> Result<Vec<u8>> {
    let (info, _) = crate::dds::decode(orig)?;
    let mut img = crate::dds::from_png(png)?;
    while img.width > info.width * 2 || img.height > info.height * 2 {
        img = crate::dds::downsample(&img);
    }
    crate::dds::encode(&img, info.format, if info.mip_count <= 1 { 1 } else { 0 }, crate::dds::Quality::Normal)
}

fn tint_texture(orig: &[u8], hue: f32, sat: f32, bright: f32) -> Result<Vec<u8>> {
    let (info, mut img) = crate::dds::decode(orig)?;
    crate::dds::adjust(
        &mut img,
        &crate::dds::ColorAdjust {
            hue,
            saturation: 1.0 + sat / 100.0,
            brightness: 1.0 + bright / 100.0,
            contrast: 1.0,
            tint: None,
            tint_strength: 0.0,
        },
    );
    crate::dds::encode(&img, info.format, if info.mip_count <= 1 { 1 } else { 0 }, crate::dds::Quality::Normal)
}

// ------------------------------------------------------------------ decorações próprias (mapas)

/// Arquivos de uma decoração feita no editor 3D, para ir dentro do mapa:
/// `/props/cp/<slug>/<slug>_prop.bp` + malha + texturas. Usa um blueprint de decoração do jogo
/// como molde (mesmos campos que o jogo espera) e troca os caminhos.
pub fn prop_files(sources: &[PathBuf], slug: &str, name: &str, m: &crate::modelgen::ModelFiles) -> Result<Vec<(String, Vec<u8>)>> {
    let slug = slug.to_ascii_lowercase();
    if !valid_id(&slug.replace('-', "_")) {
        return Err(Error::Other(format!("nome de decoração inválido: {slug}")));
    }
    let dir = format!("props/cp/{slug}");
    // molde: o primeiro blueprint de pedra em texto do jogo (decoração simples, sem animação)
    let mut template: Option<(String, String)> = None;
    'outer: for src in sources.iter().rev() {
        let Ok(mut scd) = Scd::open(src) else { continue };
        for (i, e) in scd.entries()?.into_iter().enumerate() {
            if e.key.starts_with("/uncompiled/props/rocks/") && e.key.ends_with("_prop.bp") {
                let data = scd.read_at(i)?;
                if !data.starts_with(b"\x1bLua") {
                    let folder = e.key.trim_start_matches("/uncompiled").rsplit_once('/').map(|(d, _)| d.to_string()).unwrap_or_default();
                    template = Some((String::from_utf8_lossy(&data).into_owned(), folder));
                    break 'outer;
                }
            }
        }
    }
    let mesh = format!("/{dir}/{slug}_lod0.scm");
    let albedo = format!("/{dir}/{slug}_Diffuse.dds");
    let bp_text = match template {
        Some((text, folder)) => {
            let bp = blueprint::parse(&text)?;
            let stem = folder.rsplit('/').next().unwrap_or_default().to_ascii_lowercase();
            let mut ch: Vec<(String, Set)> = bp
                .leaves()
                .into_iter()
                .filter_map(|l| {
                    let t = l.text?;
                    let low = t.to_ascii_lowercase();
                    if !low.starts_with(&folder) {
                        return None;
                    }
                    let file = low.rsplit('/').next().unwrap_or_default().to_string();
                    let v = if file.ends_with(".scm") {
                        mesh.clone()
                    } else if file.contains("diffuse") || file.contains("albedo") {
                        albedo.clone()
                    } else {
                        format!("/{dir}/{}", rename(&file, &stem, &slug))
                    };
                    Some((l.path, Set::Str(v)))
                })
                .collect();
            ch.push(("Interface.HelpText".into(), Set::Str(name.to_string())));
            format!("# Decoração criada no CommandProject (molde: {folder})\n{}", blueprint::apply(&text, &ch)?)
        }
        None => format!(
            "# Decoração criada no CommandProject\nPropBlueprint {{\n    Categories = {{ 'PROP', 'RECLAIMABLE' }},\n    Defense = {{ Health = 100, MaxHealth = 100 }},\n    Display = {{\n        Mesh = {{ LODs = {{ {{ LODCutoff = 1000, MeshName = '{mesh}', DiffuseName = '{albedo}' }} }} }},\n        UniformScale = 1,\n    }},\n    Economy = {{ ReclaimMassMax = 0, ReclaimEnergyMax = 0, ReclaimTime = 1 }},\n    Interface = {{ HelpText = {} }},\n    ScriptClass = 'Prop',\n    ScriptModule = '/lua/sim/prop.lua',\n}}\n",
            blueprint::lua_string(name)
        ),
    };
    let mut files = vec![(format!("{dir}/{slug}_prop.bp"), bp_text.into_bytes())];
    for (path, data) in [
        (mesh.clone(), m.scm.clone()),
        (albedo.clone(), m.albedo.clone()),
        (format!("/{dir}/{slug}_NormalsTS.dds"), m.normal.clone()),
        (format!("/{dir}/{slug}_SpecTeam.dds"), m.mask.clone()),
    ] {
        for n in crate::modelgen::both_names(&path) {
            files.push((n, data.clone()));
        }
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    #[test]
    fn unit_ids_in_faction_folders() {
        assert_eq!(unit_id_of("/units/uef/uul0101/uul0101_unit.bp").as_deref(), Some("uul0101"));
        assert_eq!(unit_id_of("/uncompiled/units/cybran/url0101/url0101_unit.bp").as_deref(), Some("url0101"));
        assert_eq!(unit_id_of("/units/cpmart01/cpmart01_unit.bp").as_deref(), Some("cpmart01"));
        assert_eq!(unit_id_of("/units/uef/uux0114/uux0114-shell_unit.bp"), None);
        assert_eq!(dir_of("/uncompiled/units/uef/uul0101/uul0101_unit.bp"), "/units/uef/uul0101/");
        assert_eq!(relocate("/units/uef/uul0101/UUL0101_awalk.sca", "/units/uef/uul0101/", "uul0101", "cpmart01"), "/units/cpmart01/cpmart01_awalk.sca");
        assert_eq!(relocate("Units/UEF/UUL0101/UUL0101_lod0.scm", "/units/uef/uul0101/", "uul0101", "cpmart01"), "units/cpmart01/cpmart01_lod0.scm");
        assert_eq!(relocate("textures/ui/icons/uul0101_icon.dds", "/units/uef/uul0101/", "uul0101", "cpmart01"), "textures/ui/icons/cpmart01_icon.dds");
    }

    use super::*;

    fn game(dir: &Path) -> Vec<PathBuf> {
        let bp = r#"UnitBlueprint {
    Categories = { 'UEF', 'MOBILE', 'LAND' },
    Defense = { MaxHealth = 450 },
    Display = { AnimationWalk = '/units/uul0101/uul0101_awalk.sca', Mesh = { LODs = { { MeshName = '/units/uul0101/uul0101_lod0.scm' } } }, UniformScale = 0.05 },
    General = { UnitName = '<LOC uul0101_name>Rock Head', FactionName = 'UEF' },
    Weapon = { { Label = 'MainGun', Damage = 30, TurretBoneYaw = 'Turret', RackBones = { { MuzzleBones = { 'Muzzle01' } } } } },
}"#;
        let p = dir.join("units.scd");
        let mut b = ScdBuilder::create(&p).unwrap();
        b.add_bytes("units/UUL0101/UUL0101_lod0.win.scm", b"MODLx").unwrap();
        b.add_bytes("units/UUL0101/UUL0101_awalk.win.sca", b"ANIMx").unwrap();
        b.add_bytes("units/UUL0101/UUL0101_Diffuse.win.dds", b"DDS x").unwrap();
        b.add_bytes("units/UUL0101/UUL0101_unit.bp", b"\x1bLuaQ").unwrap();
        b.add_bytes("textures/ui/icons/uul0101_icon.dds", b"DDS i").unwrap();
        b.finish().unwrap();
        let u = dir.join("uncompiled_lua.scd");
        let mut b = ScdBuilder::create(&u).unwrap();
        b.add_bytes("uncompiled/units/uul0101/uul0101_unit.bp", bp.as_bytes()).unwrap();
        b.finish().unwrap();
        vec![p, u]
    }

    #[test]
    fn catalog_details_and_build() {
        let t = tempfile::tempdir().unwrap();
        let src = game(t.path());
        let c = catalog(&src).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!((c[0].id.as_str(), c[0].name.as_str(), c[0].faction.as_str(), c[0].role.as_str()), ("uul0101", "Rock Head", "UEF", "Terrestre"));
        let d = details(&src, "UUL0101").unwrap();
        assert_eq!(d.weapons.len(), 1);
        assert!(d.bones.contains(&"Turret".to_string()) && d.bones.contains(&"Muzzle01".to_string()));
        assert_eq!(d.animations, vec![("Display.AnimationWalk".to_string(), "/units/uul0101/uul0101_awalk.sca".to_string())]);
        assert_eq!(d.mesh.as_deref(), Some("units/UUL0101/UUL0101_lod0.win.scm"));

        let dest = t.path().join("out.scd");
        let r = build(&src, &UnitBuild {
            base: "uul0101".into(),
            new_id: "cpmart01".into(),
            name: "Martelo".into(),
            changes: vec![("Defense.MaxHealth".into(), Set::Number(900.0)), ("Weapon.1.Damage".into(), Set::Number(45.0))],
            scale: Some(0.06),
            ..Default::default()
        }, &dest).unwrap();
        let bp = blueprint::parse(&r.blueprint).unwrap();
        assert_eq!(bp.number("Defense.MaxHealth"), Some(900.0));
        assert_eq!(bp.number("Weapon.1.Damage"), Some(45.0));
        assert_eq!(bp.text("General.UnitName").as_deref(), Some("Martelo"));
        assert_eq!(bp.text("Display.AnimationWalk").as_deref(), Some("/units/cpmart01/cpmart01_awalk.sca"));
        assert_eq!(bp.number("Display.UniformScale"), Some(0.06));
        let mut scd = Scd::open(&dest).unwrap();
        let keys: Vec<String> = scd.entries().unwrap().into_iter().map(|e| e.key).collect();
        for k in ["/units/cpmart01/cpmart01_unit.bp", "/units/cpmart01/cpmart01_script.lua", "/units/cpmart01/cpmart01_lod0.scm", "/units/cpmart01/cpmart01_lod0.win.scm", "/units/cpmart01/cpmart01_awalk.sca", "/textures/ui/icons/cpmart01_icon.dds"] {
            assert!(keys.contains(&k.to_string()), "faltou {k}: {keys:?}");
        }
        let script = String::from_utf8(scd.read("units/cpmart01/cpmart01_script.lua").unwrap()).unwrap();
        assert!(script.contains("import('/units/uul0101/uul0101_script.lua')"));
        // arma copiada (de outra unidade ou da mesma) entra como arma nova
        let r2 = build(&src, &UnitBuild {
            base: "uul0101".into(), new_id: "cpmart02".into(), name: "Martelo 2".into(),
            weapon_copies: vec![(0, "uul0101".into(), 1)], icon_png: Some(vec![1, 2, 3]),
            changes: vec![("Weapon.2.Damage".into(), Set::Number(7.0))],
            ..Default::default()
        }, &t.path().join("out2.scd")).unwrap();
        let bp2 = blueprint::parse(&r2.blueprint).unwrap();
        assert_eq!(bp2.number("Weapon.2.Damage"), Some(7.0));
        assert!(r2.warnings.iter().any(|w| w.contains("arma copiada")), "{:?}", r2.warnings);
        assert!(r2.warnings.iter().any(|w| w.contains("ícone")), "ícone inválido vira aviso: {:?}", r2.warnings);
        assert_eq!(missing_files(&src, &["/units/uul0101/uul0101_awalk.sca".into(), "/projectiles/nada/nada_proj.bp".into()]).unwrap(), vec!["/projectiles/nada/nada_proj.bp".to_string()]);
        assert!(c[0].categories.iter().any(|x| x == "UEF"));
        assert!(build(&src, &UnitBuild { base: "uul0101".into(), new_id: "uul0101".into(), ..Default::default() }, &dest).is_err());
        assert!(build(&src, &UnitBuild { base: "uul0101".into(), new_id: "X".into(), ..Default::default() }, &dest).is_err());
    }
}
