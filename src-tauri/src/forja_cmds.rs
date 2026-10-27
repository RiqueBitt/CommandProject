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

// ---------------------------------------------------------------- empacotar e erros do jogo

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Packed {
    path: String,
    size: u64,
    sha256: String,
    /// entrada pronta para o índice do Hub (tag "forja")
    hub: Value,
}

/// Empacota o mod (pasta forja/<id>/) num .scd em `dest` e devolve a entrada do Hub.
#[tauri::command]
pub async fn forja_pack(root: String, dest: String) -> R<Packed> {
    tauri::async_runtime::spawn_blocking(move || {
        let (path, mods) = forja::pack(&PathBuf::from(&root), &PathBuf::from(&dest))?;
        let bytes = std::fs::read(&path).map_err(|e| cp_core::Error::io(&path, e))?;
        use sha2::Digest;
        let sha = hex_string(&sha2::Sha256::digest(&bytes));
        let m = &mods[0].manifest;
        let file = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let hub = serde_json::json!({
            "id": m.id, "name": m.name, "summary": m.description, "description": m.description,
            "authors": m.authors, "category": "gameplay", "tags": ["forja"],
            "versions": [{ "version": m.version, "changelog": "", "multiplayer": "sync",
                "dependencies": m.dependencies,
                "package": { "url": file, "sha256": sha, "size": bytes.len(), "kind": "scd", "fileName": file } }],
        });
        Ok(Packed { path: path.to_string_lossy().into_owned(), size: bytes.len() as u64, sha256: sha, hub })
    })
    .await
    .map_err(err)?
    .map_err(|e: cp_core::Error| err(e))
}

fn hex_string(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameError {
    #[serde(rename = "mod")]
    mod_id: String,
    file: String,
    line: u32,
    text: String,
}

/// Erros dos mods da Forja no log da última partida aberta pelo launcher (com arquivo e linha).
#[tauri::command]
pub async fn forja_game_errors(state: State<'_, AppState>) -> R<Vec<GameError>> {
    let log = with_ws(&state.ws, |ws| Ok(ws.data_dir.join("logs").join(cp_core::bigmatch::LOG_FILE))).await?;
    let text = match std::fs::read(&log) {
        Ok(b) => String::from_utf8_lossy(&b).into_owned(),
        Err(_) => return Ok(Vec::new()),
    };
    Ok(parse_errors(&text))
}

fn parse_errors(text: &str) -> Vec<GameError> {
    let mut out: Vec<GameError> = Vec::new();
    for line in text.lines() {
        // "forja/<id>/<arquivo>.lua:<linha>: <mensagem>" (o nome dos pedaços de código dos mods)
        let Some(at) = line.find("forja/") else { continue };
        let rest = &line[at + 6..];
        let Some((id, after)) = rest.split_once('/') else { continue };
        let Some(lua) = after.find(".lua:") else { continue };
        let file = &after[..lua + 4];
        let tail = &after[lua + 5..];
        let digits: String = tail.chars().take_while(|c| c.is_ascii_digit()).collect();
        let Ok(n) = digits.parse::<u32>() else { continue };
        let msg = tail[digits.len()..].trim_start_matches(':').trim().to_string();
        if id.is_empty() || id.contains(' ') {
            continue;
        }
        let e = GameError { mod_id: id.into(), file: file.into(), line: n, text: msg };
        if !out.iter().any(|x| x.mod_id == e.mod_id && x.file == e.file && x.line == e.line && x.text == e.text) {
            out.push(e);
        }
    }
    out.truncate(50);
    out
}

#[cfg(test)]
mod tests {
    #[test]
    fn finds_mod_errors_in_the_log() {
        let log = "INFO: x\nWARNING: [Forja] vida-dupla (sim): forja/vida-dupla/sim.lua:12: attempt to call a nil value\n  stack traceback: forja/vida-dupla/lib/util.lua:3: in function x\nnada";
        let e = super::parse_errors(log);
        assert_eq!(e.len(), 2);
        assert_eq!((e[0].mod_id.as_str(), e[0].file.as_str(), e[0].line), ("vida-dupla", "sim.lua", 12));
        assert_eq!(e[0].text, "attempt to call a nil value");
        assert_eq!(e[1].file, "lib/util.lua");
    }
}
