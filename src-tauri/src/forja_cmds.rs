//! Telas da Forja (carregador de mods): o que está ligado, opções de cada mod, tecla do painel,
//! criar e conferir mods.

use crate::commands::{err, with_ws, R};
use crate::AppState;
use cp_core::forja;
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForjaOverview {
    pub loader_version: String,
    pub key: String,
    pub keys: Vec<String>,
    /// Mods da Forja ligados que vão carregar, na ordem.
    pub mods: Vec<forja::LoadedMod>,
    /// Mods que não vão carregar (ou avisos), com o motivo.
    pub problems: Vec<forja::Problem>,
    /// A última montagem (com os arquivos do jogo que receberam a Forja).
    pub built: Option<forja::Status>,
    /// Pasta sugerida para criar mods novos.
    pub dev_dir: String,
}

fn overview(ws: &mut cp_core::workspace::Workspace) -> cp_core::Result<ForjaOverview> {
    let settings = forja::Settings::load(&ws.data_dir);
    let plan = ws.forja_plan()?;
    let built = std::fs::read(ws.data_dir.join(forja::STATUS_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok());
    Ok(ForjaOverview {
        loader_version: forja::LOADER_VERSION.into(),
        key: settings.panel_key().into(),
        keys: forja::KEYS.iter().map(|k| k.to_string()).collect(),
        mods: forja::describe(&plan, &settings),
        problems: plan.problems.clone(),
        built,
        dev_dir: ws.data_dir.join("forja-dev").to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn forja_overview(state: State<'_, AppState>) -> R<ForjaOverview> {
    with_ws(&state.ws, overview).await
}

/// Muda uma opção de um mod (vale no próximo "aplicar"/jogar). `value` nulo volta ao padrão.
#[tauri::command]
pub async fn forja_set_option(state: State<'_, AppState>, mod_id: String, key: String, value: Value) -> R<ForjaOverview> {
    with_ws(&state.ws, move |ws| {
        let mut s = forja::Settings::load(&ws.data_dir);
        let entry = s.mods.entry(mod_id.clone()).or_default();
        if value.is_null() {
            entry.remove(&key);
        } else {
            entry.insert(key, value);
        }
        if entry.is_empty() {
            s.mods.remove(&mod_id);
        }
        s.save(&ws.data_dir)?;
        overview(ws)
    })
    .await
}

#[tauri::command]
pub async fn forja_reset_options(state: State<'_, AppState>, mod_id: String) -> R<ForjaOverview> {
    with_ws(&state.ws, move |ws| {
        let mut s = forja::Settings::load(&ws.data_dir);
        s.mods.remove(&mod_id);
        s.save(&ws.data_dir)?;
        overview(ws)
    })
    .await
}

#[tauri::command]
pub async fn forja_set_key(state: State<'_, AppState>, key: String) -> R<ForjaOverview> {
    with_ws(&state.ws, move |ws| {
        if !forja::KEYS.iter().any(|k| k.eq_ignore_ascii_case(&key)) {
            return Err(cp_core::Error::Other(format!("tecla {key} não está entre as livres do jogo")));
        }
        let mut s = forja::Settings::load(&ws.data_dir);
        s.key = key;
        s.save(&ws.data_dir)?;
        overview(ws)
    })
    .await
}

/// Cria um mod novo de exemplo (forja/<id>/ com mod.json, sim.lua, ui.lua, blueprints.lua) em `dir`.
#[tauri::command]
pub async fn forja_new_mod(dir: String, id: String, name: String, template: Option<String>) -> R<String> {
    let template = template.unwrap_or_else(|| "completo".into());
    tauri::async_runtime::spawn_blocking(move || forja::scaffold_with(&PathBuf::from(dir), &id, &name, &template).map(|p| p.to_string_lossy().into_owned()))
        .await
        .map_err(err)?
        .map_err(err)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckReport {
    pub mods: Vec<forja::LoadedMod>,
    pub problems: Vec<forja::Problem>,
}

/// Confere um mod da Forja (pasta ou .scd) sem instalar: manifesto, arquivos e avisos do código.
#[tauri::command]
pub async fn forja_check(path: String) -> R<CheckReport> {
    tauri::async_runtime::spawn_blocking(move || {
        let p = PathBuf::from(&path);
        let (mods, errors) = if p.is_dir() {
            match forja::read_folder(&p) {
                Ok(m) => (m, Vec::new()),
                Err(e) => (Vec::new(), vec![e.to_string()]),
            }
        } else {
            forja::read_archive(&p, "").map_err(err)?
        };
        let plan = forja::Plan { mods, problems: Vec::new() };
        let mut problems: Vec<forja::Problem> =
            errors.into_iter().map(|message| forja::Problem { mod_id: String::new(), message, fatal: true }).collect();
        for m in &plan.mods {
            if !cp_core::manifest::version_matches(m.manifest.loader.as_deref(), forja::LOADER_VERSION) {
                problems.push(forja::Problem {
                    mod_id: m.manifest.id.clone(),
                    message: format!("precisa da Forja {}", m.manifest.loader.as_deref().unwrap_or("")),
                    fatal: true,
                });
            }
        }
        Ok(CheckReport { mods: forja::describe(&plan, &forja::Settings::default()), problems })
    })
    .await
    .map_err(err)?
}

// ---------------------------------------------------------------- editor e recarga

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevMod {
    pub id: String,
    pub name: String,
    /// pasta do mod (forja/<id>/)
    pub path: String,
    /// arquivos editáveis (relativos à pasta do mod): mod.json e os .lua
    pub files: Vec<String>,
}

/// Mods em desenvolvimento numa pasta (a pasta "forja-dev" ou outra com forja/<id>/).
#[tauri::command]
pub async fn forja_dev_mods(dir: String) -> R<Vec<DevMod>> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = PathBuf::from(dir);
        if !dir.join("forja").is_dir() && !dir.join("mod.json").is_file() {
            return Ok(Vec::new());
        }
        let single = dir.join("mod.json").is_file() && !dir.join("forja").is_dir();
        let mods = forja::read_folder(&dir)?;
        Ok(mods
            .into_iter()
            .map(|m| {
                let root = if single { dir.clone() } else { dir.join("forja").join(&m.manifest.id) };
                let mut files = vec!["mod.json".to_string()];
                files.extend(m.files.keys().cloned());
                DevMod { id: m.manifest.id.clone(), name: m.manifest.name.clone(), path: root.to_string_lossy().into_owned(), files }
            })
            .collect())
    })
    .await
    .map_err(err)?
    .map_err(|e: cp_core::Error| err(e))
}

/// Só arquivos de mod da Forja (.lua e mod.json dentro da pasta de um mod).
fn editable(root: &str, file: &str) -> Result<PathBuf, String> {
    let rel = file.replace('\\', "/");
    if rel.split('/').any(|p| p == ".." || p.is_empty()) || !(rel.ends_with(".lua") || rel == "mod.json") {
        return Err(format!("arquivo {file} não pode ser editado aqui"));
    }
    let root = PathBuf::from(root);
    if !root.join("mod.json").is_file() {
        return Err(format!("{} não é a pasta de um mod da Forja", root.display()));
    }
    Ok(root.join(rel))
}

#[tauri::command]
pub async fn forja_read_file(root: String, file: String) -> R<String> {
    let p = editable(&root, &file)?;
    match std::fs::read(&p) {
        Ok(b) => Ok(String::from_utf8_lossy(&b).into_owned()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(err(e)),
    }
}

/// Grava um arquivo do mod; com `reload`, monta o mod de novo e substitui o instalado (ligado).
#[tauri::command]
pub async fn forja_write_file(state: State<'_, AppState>, root: String, file: String, text: String, reload: bool) -> R<Option<ForjaOverview>> {
    let p = editable(&root, &file)?;
    if file == "mod.json" {
        // um mod.json quebrado não é salvo: o mod sumiria da lista
        let m: forja::ForjaManifest = serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|e| format!("mod.json: {e}"))?;
        m.validate().map_err(err)?;
    }
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).map_err(err)?;
    }
    std::fs::write(&p, text).map_err(err)?;
    if !reload {
        return Ok(None);
    }
    with_ws(&state.ws, move |ws| {
        let root = PathBuf::from(&root);
        let cache = ws.data_dir.join("cache").join("forja-dev");
        std::fs::create_dir_all(&cache).map_err(|e| cp_core::Error::io(&cache, e))?;
        let id = forja::read_folder(&root)?.remove(0).manifest;
        let (archive, _) = forja::pack(&root, &cache.join(format!("{}.scd", id.id)))?;
        let import = cp_core::library::ImportOptions {
            id: Some(id.id.clone()),
            name: Some(id.name.clone()),
            version: Some(id.version.clone()),
            description: Some(id.description.clone()),
            replace: true,
            move_source: true,
            ..Default::default()
        };
        ws.import_mod(&archive, &import, true)?;
        let _ = std::fs::remove_file(&archive);
        overview(ws).map(Some)
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
pub struct Template {
    key: &'static str,
    name: &'static str,
    description: &'static str,
}

#[tauri::command]
pub fn forja_templates() -> Vec<Template> {
    forja::TEMPLATES.iter().map(|t| Template { key: t.0, name: t.1, description: t.2 }).collect()
}
