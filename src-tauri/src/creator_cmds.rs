//! Comandos dos projetos de criação (mapas, tropas e modelos 3D em abas próprias).

use crate::commands::{data_url, err, off_lock, with_ws, R};
use crate::AppState;
use base64::Engine;
use cp_core::creator::{AssetInfo, Creations, Kind, Loaded, Meta, Version};
use serde_json::Value;
use std::path::PathBuf;
use tauri::State;

async fn store(state: &State<'_, AppState>) -> R<Creations> {
    let dir: PathBuf = with_ws(&state.ws, |ws| Ok(ws.data_dir.clone())).await?;
    Creations::open(&dir).map_err(err)
}

fn mime_of(name: &str) -> &'static str {
    match name.rsplit('.').next().unwrap_or_default().to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "obj" | "mtl" | "txt" => "text/plain",
        "json" => "application/json",
        "dds" => "image/vnd-ms.dds",
        _ => "application/octet-stream",
    }
}

fn decode_b64(data: &str) -> R<Vec<u8>> {
    let b64 = data.split(',').next_back().unwrap_or_default();
    base64::engine::general_purpose::STANDARD.decode(b64).map_err(|_| "arquivo inválido (base64)".to_string())
}

#[tauri::command]
pub async fn creations_list(state: State<'_, AppState>) -> R<Vec<Meta>> {
    let c = store(&state).await?;
    off_lock(move || c.list()).await
}

#[tauri::command]
pub async fn creation_create(state: State<'_, AppState>, kind: Kind, name: String, doc: Value) -> R<Meta> {
    let c = store(&state).await?;
    off_lock(move || c.create(kind, &name, &doc)).await
}

#[tauri::command]
pub async fn creation_load(state: State<'_, AppState>, id: String) -> R<Loaded> {
    let c = store(&state).await?;
    off_lock(move || c.load(&id)).await
}

#[tauri::command]
pub async fn creation_save(state: State<'_, AppState>, id: String, doc: Value, snapshot: bool) -> R<Meta> {
    let c = store(&state).await?;
    off_lock(move || c.save(&id, &doc, snapshot)).await
}

#[tauri::command]
pub async fn creation_autosave(state: State<'_, AppState>, id: String, doc: Value) -> R<()> {
    let c = store(&state).await?;
    off_lock(move || c.autosave(&id, &doc)).await
}

#[tauri::command]
pub async fn creation_recovery(state: State<'_, AppState>, id: String) -> R<Value> {
    let c = store(&state).await?;
    off_lock(move || c.recovery(&id)).await
}

#[tauri::command]
pub async fn creation_discard_recovery(state: State<'_, AppState>, id: String) -> R<()> {
    let c = store(&state).await?;
    off_lock(move || c.discard_recovery(&id)).await
}

#[tauri::command]
pub async fn creation_versions(state: State<'_, AppState>, id: String) -> R<Vec<Version>> {
    let c = store(&state).await?;
    off_lock(move || c.versions(&id)).await
}

#[tauri::command]
pub async fn creation_restore(state: State<'_, AppState>, id: String, file: String) -> R<Value> {
    let c = store(&state).await?;
    off_lock(move || c.restore(&id, &file)).await
}

#[tauri::command]
pub async fn creation_update(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    description: Option<String>,
    favorite: Option<bool>,
    tags: Option<Vec<String>>,
) -> R<Meta> {
    let c = store(&state).await?;
    off_lock(move || c.update_meta(&id, name.as_deref(), description.as_deref(), favorite, tags)).await
}

#[tauri::command]
pub async fn creation_set_thumb(state: State<'_, AppState>, id: String, png: String) -> R<()> {
    let c = store(&state).await?;
    let bytes = decode_b64(&png)?;
    off_lock(move || c.set_thumb(&id, &bytes)).await
}

#[tauri::command]
pub async fn creation_thumb(state: State<'_, AppState>, id: String) -> R<Option<String>> {
    let c = store(&state).await?;
    off_lock(move || Ok(c.thumb(&id)?.map(|b| data_url("image/png", &b)))).await
}

#[tauri::command]
pub async fn creation_duplicate(state: State<'_, AppState>, id: String) -> R<Meta> {
    let c = store(&state).await?;
    off_lock(move || c.duplicate(&id)).await
}

#[tauri::command]
pub async fn creation_delete(state: State<'_, AppState>, id: String) -> R<()> {
    let c = store(&state).await?;
    off_lock(move || c.delete(&id)).await
}

#[tauri::command]
pub async fn creation_asset_put(state: State<'_, AppState>, id: String, name: String, data: String) -> R<String> {
    let c = store(&state).await?;
    let bytes = decode_b64(&data)?;
    off_lock(move || c.asset_put(&id, &name, &bytes)).await
}

#[tauri::command]
pub async fn creation_asset(state: State<'_, AppState>, id: String, name: String) -> R<String> {
    let c = store(&state).await?;
    off_lock(move || {
        let bytes = c.asset_get(&id, &name)?;
        Ok(data_url(mime_of(&name), &bytes))
    })
    .await
}

#[tauri::command]
pub async fn creation_assets(state: State<'_, AppState>, id: String) -> R<Vec<AssetInfo>> {
    let c = store(&state).await?;
    off_lock(move || c.assets(&id)).await
}

#[tauri::command]
pub async fn creation_export(state: State<'_, AppState>, id: String, dest: String) -> R<()> {
    let c = store(&state).await?;
    off_lock(move || c.export(&id, std::path::Path::new(&dest))).await
}

#[tauri::command]
pub async fn creation_import(state: State<'_, AppState>, path: String) -> R<Meta> {
    let c = store(&state).await?;
    off_lock(move || c.import(std::path::Path::new(&path))).await
}

// ---------------------------------------------------------------- tropas

use crate::commands::sources;
use cp_core::modelgen::{BakedModel, ModelFiles};
use cp_core::units::{BuildReport, UnitDetails, UnitInfo};

#[tauri::command]
pub async fn unit_catalog(state: State<'_, AppState>) -> R<Vec<UnitInfo>> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || cp_core::units::catalog(&srcs)).await
}

#[tauri::command]
pub async fn unit_details(state: State<'_, AppState>, id: String) -> R<UnitDetails> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || cp_core::units::details(&srcs, &id)).await
}

#[tauri::command]
pub async fn unit_animations(state: State<'_, AppState>) -> R<Vec<String>> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || cp_core::units::all_animations(&srcs)).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitPreview {
    mesh: cp_core::scm::MeshView,
    /// osso de cada vértice (para animar)
    bone_index: Vec<u8>,
    albedo: Option<String>,
    team: Option<String>,
}

/// Malha e textura de uma unidade do jogo (para ver em 3D e animar).
#[tauri::command]
pub async fn unit_preview(state: State<'_, AppState>, id: String) -> R<UnitPreview> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || {
        let d = cp_core::units::details(&srcs, &id)?;
        let mesh_path = d.mesh.ok_or_else(|| cp_core::Error::Other("a unidade não tem malha".into()))?;
        let model = cp_core::scm::read(&cp_core::mapassets::read_game_file(&srcs, &format!("/{mesh_path}"))?)?;
        let tex = |pat: &str| {
            d.files
                .iter()
                .find(|(n, _)| {
                    let l = n.to_ascii_lowercase();
                    l.starts_with("units/") && l.ends_with(".dds") && l.contains(pat)
                })
                .and_then(|(n, _)| cp_core::mapassets::texture_png(&srcs, &format!("/{n}"), 512).ok())
                .map(|p| data_url("image/png", &p))
        };
        Ok(UnitPreview {
            bone_index: model.vertices.iter().map(|v| v.bones[0]).collect(),
            mesh: cp_core::scm::view(&model),
            albedo: tex("diffuse").or_else(|| tex("albedo")),
            team: tex("team"),
        })
    })
    .await
}

/// Animação `.sca` do jogo (para pré-visualizar).
#[tauri::command]
pub async fn anim_read(state: State<'_, AppState>, path: String) -> R<cp_core::anim::Animation> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || cp_core::anim::read(&cp_core::mapassets::read_game_file(&srcs, &path)?)).await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitBuildReq {
    base: String,
    new_id: String,
    name: String,
    #[serde(default)]
    description: String,
    /// caminho → número, texto ou booleano
    #[serde(default)]
    overrides: std::collections::BTreeMap<String, Value>,
    categories: Option<Vec<String>>,
    scale: Option<f64>,
    #[serde(default)]
    animations: Vec<(String, String, Option<f64>)>,
    /// projeto de modelo 3D cuja malha substitui a da base
    model_creation: Option<String>,
    /// textura de cor do projeto da tropa (arquivo de recurso PNG)
    albedo_asset: Option<String>,
    #[serde(default)]
    tint: (f32, f32, f32),
    /// armas copiadas: (posição na tropa, 0 = nova; unidade; posição lá)
    #[serde(default)]
    weapon_copies: Vec<(usize, String, usize)>,
    /// ícone (PNG) do projeto
    #[serde(default)]
    icon_asset: Option<String>,
    /// osso da base → grupo/osso do modelo próprio
    #[serde(default)]
    bone_map: std::collections::BTreeMap<String, String>,
    /// pacote: várias tropas no mesmo mod
    #[serde(default)]
    pack: Option<String>,
    /// misturador: chassi (a base), torre e arma de outras unidades
    #[serde(default)]
    mix: Option<cp_core::unitmix::MixSpec>,
}

/// Peças do misturador já prontas para o gerador de tropas.
struct MixParts {
    model: ModelFiles,
    extra: Vec<(String, Vec<u8>)>,
    copies: Vec<(usize, String, usize)>,
    renames: Vec<(String, String)>,
    bones: Vec<String>,
}

fn mix_sources(srcs: &[PathBuf], base: &str, ms: &cp_core::unitmix::MixSpec) -> cp_core::Result<cp_core::unitmix::MixOut> {
    use cp_core::unitmix::{load_source, mix};
    let chassis = load_source(srcs, base)?;
    let other = |x: &Option<String>| -> cp_core::Result<Option<cp_core::unitmix::Source>> {
        match x.as_deref().map(str::trim).filter(|v| !v.is_empty() && !v.eq_ignore_ascii_case(base)) {
            Some(id) => Ok(Some(load_source(srcs, id)?)),
            None => Ok(None),
        }
    };
    let t = other(&ms.turret)?;
    let w = other(&ms.weapon)?;
    mix(&chassis, t.as_ref(), w.as_ref(), ms)
}

fn mix_parts(srcs: &[PathBuf], base: &str, new_id: &str, ms: &cp_core::unitmix::MixSpec, copies: &[(usize, String, usize)]) -> cp_core::Result<MixParts> {
    let out = mix_sources(srcs, base, ms)?;
    if let Some(e) = out.checks.iter().find(|c| c.level == "err") {
        return Err(cp_core::Error::Other(format!("a mistura tem um erro: {}", e.text)));
    }
    let model = ModelFiles {
        scm: cp_core::scm::write(&out.model)?,
        albedo: out.albedo.clone(),
        team: out.specteam.clone(),
        mask: out.specteam.clone(),
        normal: out.normal.clone(),
        triangles: out.model.indices.len() / 3,
        warnings: out.checks.iter().filter(|c| c.level == "warn" || c.level == "fix").map(|c| c.text.clone()).collect(),
    };
    let base_l = base.to_ascii_lowercase();
    let extra = out
        .anims
        .iter()
        .map(|(_, path, data)| (cp_core::units::rename(path.trim_start_matches('/'), &base_l, &new_id.to_ascii_lowercase()), data.clone()))
        .collect();
    // a arma vem da unidade da arma (ou da torre): copia a tabela inteira dela para a arma 1
    let mut copies = copies.to_vec();
    let wsrc = ms.weapon.clone().filter(|x| !x.trim().is_empty()).or(ms.turret.clone().filter(|x| !x.trim().is_empty())).filter(|x| !x.eq_ignore_ascii_case(base));
    if let Some(u) = wsrc {
        if !copies.iter().any(|c| c.0 == 1) {
            let d = cp_core::units::details(srcs, &u)?;
            if let Some(w) = d.weapons.iter().find(|w| !w.dummy).or(d.weapons.first()) {
                copies.insert(0, (1, u.to_ascii_lowercase(), w.index));
            }
        }
    }
    Ok(MixParts { model, extra, copies, renames: out.weapon_bones.clone(), bones: out.bones.clone() })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MixPreview {
    mesh: cp_core::scm::MeshView,
    bone_index: Vec<u8>,
    albedo: Option<String>,
    team: Option<String>,
    checks: Vec<cp_core::unitmix::Check>,
    bones: Vec<String>,
}

/// Prévia do misturador (malha, atlas e verificações), sem gerar nada.
#[tauri::command]
pub async fn unit_mix_preview(state: State<'_, AppState>, base: String, spec: cp_core::unitmix::MixSpec) -> R<MixPreview> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || {
        let out = mix_sources(&srcs, &base, &spec)?;
        Ok(MixPreview {
            bone_index: out.model.vertices.iter().map(|v| v.bones[0]).collect(),
            mesh: cp_core::scm::view(&out.model),
            albedo: Some(data_url("image/png", &out.albedo_png)),
            team: out.team_png.as_ref().map(|p| data_url("image/png", p)),
            checks: out.checks,
            bones: out.bones,
        })
    })
    .await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitBuildResult {
    report: BuildReport,
    manifest: cp_core::manifest::Manifest,
}

fn baked_files(c: &Creations, creation: &str, bone_map: &std::collections::BTreeMap<String, String>) -> cp_core::Result<ModelFiles> {
    let raw = c.derived_get(creation, "baked.json").map_err(|_| cp_core::Error::Other("o modelo ainda não foi preparado: abra o projeto do modelo e use \"Preparar para o jogo\"".into()))?;
    let mut baked: BakedModel = serde_json::from_slice(&raw).map_err(|e| cp_core::Error::Other(format!("modelo preparado inválido: {e}")))?;
    // assistente de ossos: o grupo do modelo recebe o nome do osso que a base usa
    for b in &mut baked.bones {
        if let Some((base, _)) = bone_map.iter().find(|(_, m)| m.eq_ignore_ascii_case(&b.name)) {
            b.name = base.clone();
        }
    }
    cp_core::modelgen::build(&baked)
}

fn slug(s: &str) -> String {
    let t: String = s.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect();
    let t = t.trim_matches('_').to_string();
    if t.is_empty() { "pacote".into() } else { t.chars().take(32).collect() }
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnitPack {
    slug: String,
    name: String,
    #[serde(default)]
    units: Vec<String>,
}

fn packs_dir(data: &std::path::Path) -> PathBuf {
    data.join("unit-packs")
}

fn list_packs(data: &std::path::Path) -> Vec<UnitPack> {
    let mut out: Vec<UnitPack> = std::fs::read_dir(packs_dir(data))
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter_map(|e| {
                    let meta: UnitPack = serde_json::from_slice(&std::fs::read(e.path().join("pack.json")).ok()?).ok()?;
                    let mut units: Vec<String> = std::fs::read_dir(e.path()).ok()?.filter_map(|f| f.ok()).filter_map(|f| {
                        let n = f.file_name().to_string_lossy().into_owned();
                        n.strip_suffix(".scd").map(str::to_owned)
                    }).collect();
                    units.sort();
                    Some(UnitPack { units, ..meta })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Pacotes de tropas (várias tropas num mod só).
#[tauri::command]
pub async fn unit_packs(state: State<'_, AppState>) -> R<Vec<UnitPack>> {
    let data: PathBuf = with_ws(&state.ws, |ws| Ok(ws.data_dir.clone())).await?;
    Ok(list_packs(&data))
}

/// Caminhos de arquivos citados pela tropa que não existem no jogo.
#[tauri::command]
pub async fn unit_refs_check(state: State<'_, AppState>, paths: Vec<String>) -> R<Vec<String>> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || cp_core::units::missing_files(&srcs, &paths)).await
}

/// Junta tudo que a tropa precisa (alterações, mistura, modelo próprio, texturas, animações).
fn prepare_build(srcs: &[PathBuf], c: &Creations, creation_id: &str, req: &UnitBuildReq) -> cp_core::Result<cp_core::units::UnitBuild> {
    use cp_core::blueprint::Set;
    let changes = req
        .overrides
        .iter()
        .filter_map(|(k, v)| {
            let s = match v {
                Value::Number(n) => Set::Number(n.as_f64()?),
                Value::String(s) => Set::Str(s.clone()),
                Value::Bool(b) => Set::Bool(*b),
                _ => return None,
            };
            Some((k.clone(), s))
        })
        .collect();
    let mixed = match &req.mix {
        Some(ms) => Some(mix_parts(srcs, &req.base, &req.new_id, ms, &req.weapon_copies)?),
        None => None,
    };
    let model = match (&req.model_creation, &mixed) {
        (Some(m), _) => Some(baked_files(c, m, &req.bone_map)?),
        (None, Some(mp)) => Some(mp.model.clone()),
        (None, None) => None,
    };
    let icon_png = match &req.icon_asset {
        Some(a) => Some(c.asset_get(creation_id, a)?),
        None => None,
    };
    let albedo_png = match &req.albedo_asset {
        Some(a) => Some(c.asset_get(creation_id, a)?),
        None => None,
    };
    let new_id = req.new_id.to_ascii_lowercase();
    // animações criadas no editor (arquivos do projeto) vão para a pasta da tropa
    let mut extra_files: Vec<(String, Vec<u8>)> = mixed.as_ref().map(|m| m.extra.clone()).unwrap_or_default();
    let mut animations = Vec::new();
    for (field, path, rate) in &req.animations {
        if let Some(asset) = path.strip_prefix("asset:") {
            let data = c.asset_get(creation_id, asset)?;
            let stem: String = asset.trim_end_matches(".sca").chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c.to_ascii_lowercase() } else { '_' }).collect();
            let internal = format!("units/{new_id}/{new_id}_{stem}.sca");
            extra_files.push((internal.clone(), data));
            animations.push((field.clone(), format!("/{internal}"), *rate));
        } else {
            animations.push((field.clone(), path.clone(), *rate));
        }
    }
    Ok(cp_core::units::UnitBuild {
        base: req.base.clone(),
        new_id,
        name: req.name.clone(),
        description: req.description.clone(),
        changes,
        categories: req.categories.clone(),
        scale: req.scale,
        animations,
        model,
        albedo_png,
        tint: req.tint,
        extra_files,
        weapon_copies: mixed.as_ref().map(|m| m.copies.clone()).unwrap_or_else(|| req.weapon_copies.clone()),
        icon_png,
        bone_renames: mixed.as_ref().map(|m| m.renames.clone()).unwrap_or_default(),
        skeleton: mixed.as_ref().map(|m| m.bones.clone()),
    })
}

/// Verificação de combate, movimento, colisão, ossos e animações, sem gerar nada.
#[tauri::command]
pub async fn unit_validate(state: State<'_, AppState>, creation: String, req: UnitBuildReq) -> R<Vec<cp_core::unitcheck::Finding>> {
    let srcs = sources(&state.ws).await?;
    let c = store(&state).await?;
    off_lock(move || {
        let ub = prepare_build(&srcs, &c, &creation, &req)?;
        cp_core::units::validate(&srcs, &ub)
    })
    .await
}

/// Gera a tropa (mod) e coloca na biblioteca, ligada no perfil ativo.
#[tauri::command]
pub async fn unit_build(state: State<'_, AppState>, creation: String, req: UnitBuildReq) -> R<UnitBuildResult> {
    let srcs = sources(&state.ws).await?;
    let c = store(&state).await?;
    let (dir, data): (PathBuf, PathBuf) = with_ws(&state.ws, |ws| Ok((ws.data_dir.join("cache").join("tmp"), ws.data_dir.clone()))).await?;
    let creation_id = creation.clone();
    let (scd, report, new_id, name, pack) = off_lock(move || {
        let ub = prepare_build(&srcs, &c, &creation_id, &req)?;
        std::fs::create_dir_all(&dir).map_err(|e| cp_core::Error::Other(e.to_string()))?;
        let new_id = ub.new_id.clone();
        let dest = dir.join(format!("_cp_tropa_{new_id}.scd"));
        let report = cp_core::units::build(&srcs, &ub, &dest)?;
        // pacote: guarda esta tropa na pasta do pacote e junta todas num .scd só
        let pack = match req.pack.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
            Some(p) => {
                let sl = slug(p);
                let pdir = packs_dir(&data).join(&sl);
                std::fs::create_dir_all(&pdir).map_err(|e| cp_core::Error::io(&pdir, e))?;
                cp_core::fsutil::write_json(&pdir.join("pack.json"), &UnitPack { slug: sl.clone(), name: p.to_string(), units: vec![] })?;
                std::fs::copy(&dest, pdir.join(format!("{new_id}.scd"))).map_err(|e| cp_core::Error::io(&dest, e))?;
                let merged = dir.join(format!("_cp_pacote_{sl}.scd"));
                let mut out = cp_core::scd::ScdBuilder::create(&merged)?;
                let mut seen = std::collections::HashSet::new();
                let mut files: Vec<PathBuf> = std::fs::read_dir(&pdir).map_err(|e| cp_core::Error::io(&pdir, e))?
                    .filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "scd")).collect();
                files.sort();
                for f in files {
                    let mut scd = cp_core::scd::Scd::open(&f)?;
                    for (i, e) in scd.entries()?.into_iter().enumerate() {
                        if e.is_dir || !seen.insert(e.key.clone()) {
                            continue;
                        }
                        let bytes = scd.read_at(i)?;
                        out.add_bytes(&e.name.replace('\\', "/"), &bytes)?;
                    }
                }
                out.finish()?;
                let _ = std::fs::remove_file(&dest);
                Some((sl, p.to_string(), merged))
            }
            None => None,
        };
        Ok((dest, report, new_id, req.name, pack))
    })
    .await?;
    let c2 = store(&state).await?;
    let manifest = with_ws(&state.ws, move |ws| {
        if let Some((sl, pname, merged)) = pack {
            // a tropa sai do mod próprio (se tinha) e passa a viver no pacote
            if ws.mods()?.iter().any(|m| m.manifest.id == format!("tropa-{new_id}")) {
                ws.remove_mod(&format!("tropa-{new_id}"))?;
            }
            let opts = cp_core::library::ImportOptions {
                id: Some(format!("pacote-{sl}")),
                name: Some(format!("Pacote: {pname}")),
                category: Some(cp_core::manifest::Category::Gameplay),
                description: Some(format!("Pacote de tropas \"{pname}\" criado no editor de tropas do CommandProject. Experimental.")),
                replace: true,
                move_source: true,
                ..Default::default()
            };
            return ws.import_mod(&merged, &opts, true);
        }
        let opts = cp_core::library::ImportOptions {
            id: Some(format!("tropa-{new_id}")),
            name: Some(name.clone()),
            category: Some(cp_core::manifest::Category::Gameplay),
            description: Some(format!("Tropa {name} ({new_id}) criada no editor de tropas do CommandProject. Experimental.")),
            replace: true,
            move_source: true,
            ..Default::default()
        };
        ws.import_mod(&scd, &opts, true)
    })
    .await?;
    let _ = c2.set_built_mod(&creation, &manifest.id);
    Ok(UnitBuildResult { report, manifest })
}

// ---------------------------------------------------------------- modelos 3D

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BakeResult {
    triangles: usize,
    warnings: Vec<String>,
}

/// Guarda o modelo pronto para o jogo (usado por mapas e tropas) e confere se ele converte.
#[tauri::command]
pub async fn model_prepare(state: State<'_, AppState>, id: String, baked: BakedModel) -> R<BakeResult> {
    let c = store(&state).await?;
    off_lock(move || {
        let files = cp_core::modelgen::build(&baked)?;
        let json = serde_json::to_vec(&baked).map_err(|e| cp_core::Error::Other(e.to_string()))?;
        c.derived_put(&id, "baked.json", &json)?;
        Ok(BakeResult { triangles: files.triangles, warnings: files.warnings })
    })
    .await
}

/// Exporta os arquivos do jogo (.scm + .dds) para uma pasta escolhida.
#[tauri::command]
pub async fn model_export_game(baked: BakedModel, dir: String, name: String) -> R<Vec<String>> {
    off_lock(move || {
        let f = cp_core::modelgen::build(&baked)?;
        let stem: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' }).collect();
        let d = std::path::Path::new(&dir);
        let mut out = vec![];
        for (suffix, data) in [("_lod0.scm", &f.scm), ("_Diffuse.dds", &f.albedo), ("_Team.dds", &f.team), ("_Mask.dds", &f.mask), ("_NormalsTS.dds", &f.normal)] {
            let p = d.join(format!("{stem}{suffix}"));
            cp_core::fsutil::write_atomic(&p, data)?;
            out.push(p.to_string_lossy().into_owned());
        }
        Ok(out)
    })
    .await
}

/// Arquivos das decorações próprias de um mapa (`spec.custom_models`), para o pacote do mapa.
pub(crate) fn map_custom_files(c: &Creations, srcs: &[PathBuf], spec: &Value) -> cp_core::Result<Vec<(String, Vec<u8>)>> {
    let mut out = Vec::new();
    for m in spec.get("custom_models").and_then(|v| v.as_array()).cloned().unwrap_or_default() {
        let creation = m.get("creation").and_then(|v| v.as_str()).unwrap_or_default();
        let slug = m.get("slug").and_then(|v| v.as_str()).unwrap_or_default();
        let name = m.get("name").and_then(|v| v.as_str()).unwrap_or(slug);
        let files = baked_files(c, creation, &Default::default())?;
        out.extend(cp_core::units::prop_files(srcs, slug, name, &files)?);
    }
    Ok(out)
}

/// Prepara (antes de gerar o mapa) os arquivos das decorações próprias.
pub(crate) async fn custom_files_for(state: &State<'_, AppState>, spec: &Value) -> R<Vec<(String, Vec<u8>)>> {
    if !spec.get("custom_models").and_then(|v| v.as_array()).is_some_and(|a| !a.is_empty()) {
        return Ok(vec![]);
    }
    let srcs = sources(&state.ws).await?;
    let c = store(state).await?;
    let spec = spec.clone();
    off_lock(move || map_custom_files(&c, &srcs, &spec)).await
}

/// Modelo preparado de um projeto (para mostrar no editor de mapas e de tropas).
#[tauri::command]
pub async fn model_baked(state: State<'_, AppState>, id: String) -> R<Option<BakedModel>> {
    let c = store(&state).await?;
    off_lock(move || {
        let Ok(raw) = c.derived_get(&id, "baked.json") else { return Ok(None) };
        Ok(serde_json::from_slice(&raw).ok())
    })
    .await
}

/// Copia um arquivo do projeto para um caminho escolhido pelo usuário (exportar OBJ/GLB…).
#[tauri::command]
pub async fn creation_asset_copy(state: State<'_, AppState>, id: String, name: String, dest: String) -> R<()> {
    let c = store(&state).await?;
    off_lock(move || {
        let data = c.asset_get(&id, &name)?;
        cp_core::fsutil::write_atomic(std::path::Path::new(&dest), &data)
    })
    .await
}

/// Blueprint que a tropa vai ter (para conferir antes de gerar).
#[tauri::command]
pub async fn unit_blueprint_preview(state: State<'_, AppState>, req: UnitBuildReq) -> R<String> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || {
        use cp_core::blueprint::Set;
        let changes = req
            .overrides
            .iter()
            .filter_map(|(k, v)| {
                let s = match v {
                    Value::Number(n) => Set::Number(n.as_f64()?),
                    Value::String(s) => Set::Str(s.clone()),
                    Value::Bool(b) => Set::Bool(*b),
                    _ => return None,
                };
                Some((k.clone(), s))
            })
            .collect();
        let new_id = req.new_id.to_ascii_lowercase();
        let animations = req
            .animations
            .into_iter()
            .map(|(f, p, r)| match p.strip_prefix("asset:") {
                Some(a) => (f, format!("/units/{new_id}/{new_id}_{}.sca", a.trim_end_matches(".sca").to_ascii_lowercase()), r),
                None => (f, p, r),
            })
            .collect();
        let mixed = match &req.mix {
            Some(ms) => Some(mix_parts(&srcs, &req.base, &req.new_id, ms, &req.weapon_copies)?),
            None => None,
        };
        let (text, _) = cp_core::units::make_blueprint(
            &srcs,
            &cp_core::units::UnitBuild {
                base: req.base,
                new_id,
                name: req.name,
                description: req.description,
                changes,
                categories: req.categories,
                scale: req.scale,
                animations,
                weapon_copies: mixed.as_ref().map(|m| m.copies.clone()).unwrap_or(req.weapon_copies),
                bone_renames: mixed.as_ref().map(|m| m.renames.clone()).unwrap_or_default(),
                skeleton: mixed.as_ref().map(|m| m.bones.clone()),
                ..Default::default()
            },
        )?;
        Ok(text)
    })
    .await
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimSource {
    unit: Option<String>,
    model: Option<String>,
}

/// Cria uma animação .sca a partir de quadros-chave e guarda no projeto. Devolve o nome do arquivo.
#[tauri::command]
pub async fn anim_create(
    state: State<'_, AppState>,
    creation: String,
    name: String,
    source: AnimSource,
    keys: Vec<cp_core::anim::Key>,
    duration: f32,
    fps: Option<f32>,
) -> R<String> {
    let srcs = sources(&state.ws).await?;
    let c = store(&state).await?;
    off_lock(move || {
        let bones: Vec<(String, i32, [f32; 3], [f32; 4])> = if let Some(m) = &source.model {
            let raw = c.derived_get(m, "baked.json").map_err(|_| cp_core::Error::Other("prepare o modelo para o jogo antes de animar".into()))?;
            let baked: BakedModel = serde_json::from_slice(&raw).map_err(|e| cp_core::Error::Other(e.to_string()))?;
            baked.bones.iter().map(|b| (b.name.clone(), b.parent, b.pos, b.rot)).collect()
        } else if let Some(u) = &source.unit {
            let d = cp_core::units::details(&srcs, u)?;
            let mesh = d.mesh.ok_or_else(|| cp_core::Error::Other("a unidade não tem malha".into()))?;
            let model = cp_core::scm::read(&cp_core::mapassets::read_game_file(&srcs, &format!("/{mesh}"))?)?;
            model.bones.iter().map(|b| (b.name.clone(), b.parent, b.position, b.rotation)).collect()
        } else {
            return Err(cp_core::Error::Other("escolha o modelo da animação".into()));
        };
        let anim = cp_core::anim::from_keys(&bones, &keys, duration, fps.unwrap_or(30.0))?;
        let bytes = cp_core::anim::write(&anim)?;
        let file = format!("{}.sca", name.trim().trim_end_matches(".sca"));
        c.asset_put(&creation, &file, &bytes)
    })
    .await
}

/// Grava um arquivo gerado (textura, ícone…) num caminho escolhido pelo usuário, de forma atômica.
/// Se o arquivo já existe e `overwrite` não veio, devolve "EXISTE" para a tela pedir confirmação.
#[tauri::command]
pub async fn export_data(path: String, data: String, overwrite: bool) -> R<()> {
    let p = PathBuf::from(path.trim());
    if !p.is_absolute() || p.file_name().is_none() {
        return Err(format!("caminho inválido: {path}"));
    }
    if p.exists() && !overwrite {
        return Err("EXISTE".into());
    }
    let bytes = decode_b64(&data)?;
    off_lock(move || {
        if let Some(d) = p.parent() {
            std::fs::create_dir_all(d).map_err(|e| cp_core::Error::Other(format!("{}: {e}", d.display())))?;
        }
        cp_core::fsutil::write_atomic(&p, &bytes)
    })
    .await
}
