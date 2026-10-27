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
pub async fn forja_new_mod(dir: String, id: String, name: String) -> R<String> {
    tauri::async_runtime::spawn_blocking(move || forja::scaffold(&PathBuf::from(dir), &id, &name).map(|p| p.to_string_lossy().into_owned()))
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
