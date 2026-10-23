//! Comandos chamados pela interface (`invoke("nome", {...})`).
//!
//! Operações demoradas (aplicar perfil, baixar mods, gerar skins/mapas) rodam numa thread
//! de bloqueio e emitem `cp://progress` com `{ task, step, total, message }`.

use crate::AppState;
use base64::Engine;
use cp_core::dds::{self, ColorAdjust};
use cp_core::deploy::{BaselineKind, Progress};
use cp_core::game::LaunchPlan;
use cp_core::hub::{self, HubIndex};
use cp_core::library::ImportOptions;
use cp_core::manifest::{Category, Manifest};
use cp_core::maptk::BridgeEvent;
use cp_core::profile::ProfileSet;
use cp_core::settings::Settings;
use cp_core::studio::{self, Project, UiSkinOptions};
use cp_core::workspace::Workspace;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_opener::OpenerExt;

type R<T> = Result<T, String>;

fn err<E: ToString>(e: E) -> String {
    e.to_string()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    task: String,
    step: usize,
    total: usize,
    message: String,
}

fn emit_progress(app: &AppHandle, task: &str, step: usize, total: usize, message: impl Into<String>) {
    let _ = app.emit(
        "cp://progress",
        ProgressEvent {
            task: task.into(),
            step,
            total,
            message: message.into(),
        },
    );
}

/// Roda `f` com o workspace travado, fora da thread principal.
async fn with_ws<T, F>(ws: &Arc<Mutex<Workspace>>, f: F) -> R<T>
where
    T: Send + 'static,
    F: FnOnce(&mut Workspace) -> cp_core::Result<T> + Send + 'static,
{
    let ws = ws.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut guard = ws.lock().unwrap_or_else(|p| p.into_inner());
        f(&mut guard).map_err(err)
    })
    .await
    .map_err(err)?
}

fn data_url(mime: &str, bytes: &[u8]) -> String {
    format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

// ===================================================================== app / jogo

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    data_dir: PathBuf,
    resources_dir: Option<PathBuf>,
    os: String,
}

#[tauri::command]
pub async fn app_info(state: State<'_, AppState>) -> R<AppInfo> {
    with_ws(&state.ws, |ws| {
        Ok(AppInfo {
            version: env!("CARGO_PKG_VERSION").into(),
            data_dir: ws.data_dir.clone(),
            resources_dir: ws.resources_dir.clone(),
            os: std::env::consts::OS.into(),
        })
    })
    .await
}

#[tauri::command]
pub async fn recover(state: State<'_, AppState>) -> R<Option<String>> {
    with_ws(&state.ws, |ws| ws.recover()).await
}

#[tauri::command]
pub async fn dashboard(state: State<'_, AppState>) -> R<cp_core::workspace::Dashboard> {
    with_ws(&state.ws, |ws| ws.dashboard()).await
}

#[tauri::command]
pub async fn set_game_path(state: State<'_, AppState>, path: Option<String>) -> R<Option<cp_core::game::GameInstall>> {
    with_ws(&state.ws, move |ws| ws.set_game_path(path.map(PathBuf::from))).await
}

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> R<Settings> {
    with_ws(&state.ws, |ws| Ok(ws.settings.clone())).await
}

#[tauri::command]
pub async fn save_settings(state: State<'_, AppState>, settings: Settings) -> R<Settings> {
    with_ws(&state.ws, move |ws| {
        if let Some(p) = &settings.game_path {
            cp_core::game::GameInstall::from_dir(p, cp_core::game::Store::Manual)?;
        }
        for u in &settings.hub_urls {
            hub::check_url(u)?;
        }
        let mut settings = settings;
        settings.server_url = settings
            .server_url
            .map(|u| u.trim().trim_end_matches('/').to_string())
            .filter(|u| !u.is_empty());
        if let Some(u) = &settings.server_url {
            hub::check_url(u)?;
        }
        settings.nickname = settings.nickname.trim().chars().take(20).collect();
        ws.settings = settings;
        ws.save_settings()?;
        ws.refresh_game();
        Ok(ws.settings.clone())
    })
    .await
}

// ===================================================================== biblioteca

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModView {
    manifest: Manifest,
    dir: PathBuf,
    icon: Option<String>,
    enabled: bool,
    order: Option<usize>,
}

#[tauri::command]
pub async fn list_mods(state: State<'_, AppState>) -> R<Vec<ModView>> {
    with_ws(&state.ws, |ws| {
        let active = ws.profiles.active().clone();
        let mut out: Vec<ModView> = ws
            .mods()?
            .into_iter()
            .map(|m| {
                let pos = active.mods.iter().position(|x| x.id == m.manifest.id);
                let icon = m.icon_path.as_ref().and_then(|p| {
                    let bytes = std::fs::read(p).ok()?;
                    let mime = if p.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
                        "image/png"
                    } else {
                        "image/jpeg"
                    };
                    (bytes.len() < 2 * 1024 * 1024).then(|| data_url(mime, &bytes))
                });
                ModView {
                    enabled: pos.map(|i| active.mods[i].enabled).unwrap_or(false),
                    order: pos,
                    icon,
                    dir: m.dir,
                    manifest: m.manifest,
                }
            })
            .collect();
        out.sort_by_key(|m| (m.order.unwrap_or(usize::MAX), m.manifest.name.to_lowercase()));
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn import_mod(
    state: State<'_, AppState>,
    path: String,
    opts: Option<ImportOptions>,
    enable: bool,
) -> R<Manifest> {
    with_ws(&state.ws, move |ws| {
        ws.import_mod(Path::new(&path), &opts.unwrap_or_default(), enable)
    })
    .await
}

#[tauri::command]
pub async fn remove_mod(state: State<'_, AppState>, id: String) -> R<()> {
    with_ws(&state.ws, move |ws| ws.remove_mod(&id)).await
}

#[tauri::command]
pub async fn update_mod_meta(
    state: State<'_, AppState>,
    id: String,
    patch: ImportOptions,
    tags: Option<Vec<String>>,
) -> R<Manifest> {
    with_ws(&state.ws, move |ws| ws.library.update_meta(&id, &patch, tags)).await
}

#[tauri::command]
pub async fn verify_mod(state: State<'_, AppState>, id: String) -> R<Vec<String>> {
    with_ws(&state.ws, move |ws| ws.library.verify(&id)).await
}

// ===================================================================== perfis

#[tauri::command]
pub async fn get_profiles(state: State<'_, AppState>) -> R<ProfileSet> {
    with_ws(&state.ws, |ws| Ok(ws.profiles.set.clone())).await
}

#[tauri::command]
pub async fn create_profile(state: State<'_, AppState>, name: String, copy_from: Option<String>) -> R<ProfileSet> {
    with_ws(&state.ws, move |ws| {
        ws.profiles.create(&name, copy_from.as_deref())?;
        Ok(ws.profiles.set.clone())
    })
    .await
}

#[tauri::command]
pub async fn rename_profile(state: State<'_, AppState>, id: String, name: String) -> R<ProfileSet> {
    with_ws(&state.ws, move |ws| {
        ws.profiles.rename(&id, &name)?;
        Ok(ws.profiles.set.clone())
    })
    .await
}

#[tauri::command]
pub async fn delete_profile(state: State<'_, AppState>, id: String) -> R<ProfileSet> {
    with_ws(&state.ws, move |ws| {
        ws.profiles.delete(&id)?;
        Ok(ws.profiles.set.clone())
    })
    .await
}

#[tauri::command]
pub async fn set_active_profile(state: State<'_, AppState>, id: String) -> R<ProfileSet> {
    with_ws(&state.ws, move |ws| {
        ws.profiles.set_active(&id)?;
        Ok(ws.profiles.set.clone())
    })
    .await
}

#[tauri::command]
pub async fn set_mod_enabled(
    state: State<'_, AppState>,
    mod_id: String,
    enabled: bool,
    profile: Option<String>,
) -> R<()> {
    with_ws(&state.ws, move |ws| {
        let p = profile.unwrap_or_else(|| ws.profiles.active().id.clone());
        ws.profiles.set_enabled(&p, &mod_id, enabled)
    })
    .await
}

#[tauri::command]
pub async fn reorder_mods(state: State<'_, AppState>, order: Vec<String>, profile: Option<String>) -> R<()> {
    with_ws(&state.ws, move |ws| {
        let p = profile.unwrap_or_else(|| ws.profiles.active().id.clone());
        ws.profiles.reorder(&p, &order)
    })
    .await
}

// ===================================================================== implantação

#[tauri::command]
pub async fn plan_active(state: State<'_, AppState>) -> R<cp_core::deploy::Plan> {
    with_ws(&state.ws, |ws| ws.plan_active()).await
}

#[tauri::command]
pub async fn apply_active(app: AppHandle, state: State<'_, AppState>) -> R<cp_core::deploy::Plan> {
    with_ws(&state.ws, move |ws| {
        ws.apply_active(&mut |p: Progress| emit_progress(&app, "apply", p.step, p.total, p.message))
    })
    .await
}

#[tauri::command]
pub async fn purge(app: AppHandle, state: State<'_, AppState>) -> R<cp_core::deploy::Plan> {
    with_ws(&state.ws, move |ws| {
        ws.purge(&mut |p: Progress| emit_progress(&app, "purge", p.step, p.total, p.message))
    })
    .await
}

#[tauri::command]
pub async fn file_status(state: State<'_, AppState>) -> R<Vec<cp_core::deploy::FileStatus>> {
    with_ws(&state.ws, |ws| ws.file_status()).await
}

#[tauri::command]
pub async fn set_baseline_kind(state: State<'_, AppState>, name: String, kind: BaselineKind) -> R<()> {
    with_ws(&state.ws, move |ws| ws.set_baseline_kind(&name, kind)).await
}

#[tauri::command]
pub async fn adopt_unmanaged(state: State<'_, AppState>, name: String) -> R<Manifest> {
    with_ws(&state.ws, move |ws| ws.adopt_unmanaged(&name)).await
}

#[tauri::command]
pub async fn conflicts(state: State<'_, AppState>) -> R<cp_core::conflicts::ConflictReport> {
    with_ws(&state.ws, |ws| ws.conflicts_active()).await
}

// ===================================================================== jogar

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchResult {
    plan: LaunchPlan,
    applied: Option<cp_core::deploy::Plan>,
    watching: bool,
}

#[tauri::command]
pub async fn launch_game(app: AppHandle, state: State<'_, AppState>) -> R<LaunchResult> {
    let app2 = app.clone();
    let (plan, applied, restore) = with_ws(&state.ws, move |ws| {
        let applied = if ws.settings.apply_before_launch {
            Some(ws.apply_active(&mut |p: Progress| emit_progress(&app2, "apply", p.step, p.total, p.message))?)
        } else {
            None
        };
        Ok((ws.launch_plan()?, applied, ws.settings.restore_on_exit))
    })
    .await?;
    match &plan {
        LaunchPlan::Url { url } => app.opener().open_url(url, None::<&str>).map_err(err)?,
        LaunchPlan::Exe { .. } => {
            cp_core::game::spawn_exe(&plan).map_err(err)?;
        }
    }
    if restore {
        let ws = state.ws.clone();
        let app3 = app.clone();
        tauri::async_runtime::spawn(async move {
            // espera o jogo abrir (até 3 min) e depois fechar
            let mut started = false;
            for _ in 0..90 {
                if tauri::async_runtime::spawn_blocking(cp_core::game::is_running)
                    .await
                    .unwrap_or(false)
                {
                    started = true;
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            }
            if !started {
                return;
            }
            let _ = app3.emit("cp://game-started", ());
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                if !tauri::async_runtime::spawn_blocking(cp_core::game::is_running)
                    .await
                    .unwrap_or(true)
                {
                    break;
                }
            }
            let app4 = app3.clone();
            let res = with_ws(&ws, move |ws| {
                ws.purge(&mut |p: Progress| emit_progress(&app4, "purge", p.step, p.total, p.message))
            })
            .await;
            let _ = app3.emit("cp://game-exited", res.err());
        });
    }
    Ok(LaunchResult {
        plan,
        applied,
        watching: restore,
    })
}

// ===================================================================== multiplayer

#[tauri::command]
pub async fn fingerprint(state: State<'_, AppState>) -> R<cp_core::sync::Fingerprint> {
    with_ws(&state.ws, |ws| ws.fingerprint()).await
}

#[tauri::command]
pub async fn export_sync_code(state: State<'_, AppState>, profile: Option<String>) -> R<String> {
    with_ws(&state.ws, move |ws| ws.export_sync_code(profile.as_deref())).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncInspect {
    payload: cp_core::sync::SyncPayload,
    items: Vec<cp_core::sync::SyncItem>,
}

#[tauri::command]
pub async fn inspect_sync_code(state: State<'_, AppState>, code: String) -> R<SyncInspect> {
    with_ws(&state.ws, move |ws| {
        ws.inspect_sync_code(&code)
            .map(|(payload, items)| SyncInspect { payload, items })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncApplied {
    profile_id: String,
    items: Vec<cp_core::sync::SyncItem>,
}

#[tauri::command]
pub async fn apply_sync_code(state: State<'_, AppState>, code: String) -> R<SyncApplied> {
    with_ws(&state.ws, move |ws| {
        ws.apply_sync_code(&code)
            .map(|(profile_id, items)| SyncApplied { profile_id, items })
    })
    .await
}

// ===================================================================== hub

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubFetch {
    indexes: Vec<HubIndex>,
    errors: Vec<HubError>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HubError {
    url: String,
    message: String,
}

#[tauri::command]
pub async fn hub_fetch(state: State<'_, AppState>, urls: Option<Vec<String>>) -> R<HubFetch> {
    let (urls, server_hub) = match urls {
        Some(u) => (u, None),
        None => {
            with_ws(&state.ws, |ws| {
                let server = ws.settings.server_url.as_ref().map(|s| format!("{s}/hub/index.json"));
                Ok((ws.settings.hub_urls.clone(), server))
            })
            .await?
        }
    };
    let mut indexes = Vec::new();
    let mut errors = Vec::new();
    for url in urls {
        match hub::fetch_index(&url).await {
            Ok(i) => indexes.push(i),
            Err(e) => errors.push(HubError {
                url,
                message: e.to_string(),
            }),
        }
    }
    // o servidor da comunidade pode ou não publicar um hub: se não publicar, não é erro
    if let Some(url) = server_hub {
        if !indexes.iter().any(|i| i.source_url == url) {
            match hub::fetch_index(&url).await {
                Ok(i) => indexes.push(i),
                Err(e) if e.to_string().contains("404") => {}
                Err(e) => errors.push(HubError {
                    url,
                    message: e.to_string(),
                }),
            }
        }
    }
    *state.hubs.lock().unwrap_or_else(|p| p.into_inner()) = indexes.clone();
    Ok(HubFetch { indexes, errors })
}

#[tauri::command]
pub async fn hub_install(
    app: AppHandle,
    state: State<'_, AppState>,
    index_url: String,
    mod_id: String,
    version: Option<String>,
    enable: bool,
) -> R<Manifest> {
    let (m, v) = {
        let hubs = state.hubs.lock().unwrap_or_else(|p| p.into_inner());
        let idx = hubs
            .iter()
            .find(|i| i.source_url == index_url)
            .ok_or("hub não carregado — atualize a lista")?;
        let m = idx
            .mods
            .iter()
            .find(|m| m.id == mod_id)
            .ok_or("mod não encontrado no hub")?
            .clone();
        let v = match &version {
            Some(ver) => m.versions.iter().find(|v| &v.version == ver).cloned(),
            None => m.latest().cloned(),
        }
        .ok_or("versão não encontrada")?;
        (m, v)
    };
    let cache = with_ws(&state.ws, |ws| Ok(ws.data_dir.join("cache").join("downloads"))).await?;
    let task = format!("hub:{mod_id}");
    let mut last = 0u64;
    let app2 = app.clone();
    let task2 = task.clone();
    let path = hub::download(&index_url, &v.package, &cache, &mut move |p| {
        // limita a ~1 evento por 1% para não inundar a interface
        let pct = p.downloaded * 100 / p.total.max(1);
        if pct != last {
            last = pct;
            emit_progress(&app2, &task2, pct as usize, 100, "Baixando");
        }
    })
    .await
    .map_err(err)?;
    emit_progress(&app, &task, 100, 100, "Instalando");
    with_ws(&state.ws, move |ws| {
        let man = hub::install_downloaded(&ws.library, &index_url, &m, &v, &path)?;
        if enable {
            let p = ws.profiles.active().id.clone();
            ws.profiles.set_enabled(&p, &man.id, true)?;
        }
        Ok(man)
    })
    .await
}

#[tauri::command]
pub async fn hub_updates(state: State<'_, AppState>) -> R<Vec<hub::UpdateInfo>> {
    let hubs = state.hubs.lock().unwrap_or_else(|p| p.into_inner()).clone();
    with_ws(&state.ws, move |ws| hub::find_updates(&ws.library, &hubs)).await
}

// ===================================================================== explorador de arquivos do jogo

#[tauri::command]
pub async fn archives(state: State<'_, AppState>) -> R<Vec<cp_core::workspace::ArchiveInfo>> {
    with_ws(&state.ws, |ws| ws.archives()).await
}

#[tauri::command]
pub async fn archive_entries(
    state: State<'_, AppState>,
    name: String,
    original: Option<bool>,
) -> R<Vec<cp_core::scd::ScdEntry>> {
    with_ws(&state.ws, move |ws| {
        ws.archive_entries(&name, original.unwrap_or(false))
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryView {
    kind: String,
    size: usize,
    text: Option<String>,
    compiled: bool,
    warnings: Vec<String>,
    /// Quando o arquivo é bytecode, a versão em texto veio deste .scd.
    text_from: Option<String>,
}

fn entry_view(path: &str, data: &[u8]) -> EntryView {
    let kind = studio::file_kind(path).to_string();
    let is_text = kind == "lua" || kind == "blueprint" || {
        let p = path.to_ascii_lowercase();
        [".txt", ".json", ".xml", ".ini", ".cfg", ".md", ".csv"]
            .iter()
            .any(|e| p.ends_with(e))
    };
    let lua = cp_core::lua::inspect(data);
    let text =
        (is_text && !lua.compiled && data.len() < 4 * 1024 * 1024).then(|| String::from_utf8_lossy(data).into_owned());
    EntryView {
        kind,
        size: data.len(),
        compiled: lua.compiled,
        warnings: if text.is_some() && path.to_ascii_lowercase().ends_with(".lua") {
            lua.warnings
        } else {
            vec![]
        },
        text,
        text_from: None,
    }
}

#[tauri::command]
pub async fn read_entry(
    state: State<'_, AppState>,
    archive: String,
    entry: String,
    original: Option<bool>,
) -> R<EntryView> {
    with_ws(&state.ws, move |ws| {
        let d = ws.read_entry(&archive, &entry, original.unwrap_or(false))?;
        let mut v = entry_view(&entry, &d);
        if v.compiled {
            if let Some((from, text)) = ws.uncompiled_version(&entry)? {
                v.text = Some(String::from_utf8_lossy(&text).into_owned());
                v.text_from = Some(from);
            }
        }
        Ok(v)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextureView {
    info: dds::DdsInfo,
    png: String,
}

fn texture_view(data: &[u8], adjust: Option<&ColorAdjust>) -> cp_core::Result<TextureView> {
    let (info, mut img) = dds::decode(data)?;
    // prévia limitada a 1024 px para a interface continuar leve
    while img.width > 1024 || img.height > 1024 {
        img = dds::downsample(&img);
    }
    if let Some(a) = adjust {
        dds::adjust(&mut img, a);
    }
    Ok(TextureView {
        info,
        png: data_url("image/png", &dds::to_png(&img)?),
    })
}

#[tauri::command]
pub async fn preview_texture(
    state: State<'_, AppState>,
    archive: String,
    entry: String,
    original: Option<bool>,
    adjust: Option<ColorAdjust>,
) -> R<TextureView> {
    with_ws(&state.ws, move |ws| {
        let d = ws.read_entry(&archive, &entry, original.unwrap_or(false))?;
        texture_view(&d, adjust.as_ref())
    })
    .await
}

#[tauri::command]
pub async fn preview_model(
    state: State<'_, AppState>,
    archive: String,
    entry: String,
    original: Option<bool>,
) -> R<cp_core::scm::MeshView> {
    with_ws(&state.ws, move |ws| {
        let d = ws.read_entry(&archive, &entry, original.unwrap_or(false))?;
        Ok(cp_core::scm::view(&cp_core::scm::read(&d)?))
    })
    .await
}

#[tauri::command]
pub async fn export_entry(
    state: State<'_, AppState>,
    archive: String,
    entry: String,
    original: Option<bool>,
    dest: String,
    format: String,
) -> R<()> {
    with_ws(&state.ws, move |ws| {
        let d = ws.read_entry(&archive, &entry, original.unwrap_or(false))?;
        let out: Vec<u8> = match format.as_str() {
            "png" => dds::to_png(&dds::decode(&d)?.1)?,
            "obj" => {
                let stem = Path::new(&entry)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                cp_core::scm::to_obj(&cp_core::scm::read(&d)?, &stem).into_bytes()
            }
            "glb" => cp_core::scm::to_glb(&cp_core::scm::read(&d)?),
            _ => d,
        };
        std::fs::write(&dest, out).map_err(|e| cp_core::Error::io(&dest, e))
    })
    .await
}

// ===================================================================== estúdio: projetos

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> R<Vec<Project>> {
    with_ws(&state.ws, |ws| ws.studio.list()).await
}

#[tauri::command]
pub async fn create_project(state: State<'_, AppState>, name: String, category: Option<Category>) -> R<Project> {
    with_ws(&state.ws, move |ws| {
        ws.studio.create(&name, category.unwrap_or_default())
    })
    .await
}

#[tauri::command]
pub async fn save_project(state: State<'_, AppState>, project: Project) -> R<()> {
    with_ws(&state.ws, move |ws| ws.studio.save_meta(&project)).await
}

#[tauri::command]
pub async fn delete_project(state: State<'_, AppState>, id: String) -> R<()> {
    with_ws(&state.ws, move |ws| ws.studio.delete(&id)).await
}

#[tauri::command]
pub async fn project_files(state: State<'_, AppState>, id: String) -> R<Vec<studio::ProjectFile>> {
    with_ws(&state.ws, move |ws| ws.studio.files(&id)).await
}

#[tauri::command]
pub async fn project_read_text(state: State<'_, AppState>, id: String, path: String) -> R<EntryView> {
    with_ws(&state.ws, move |ws| {
        Ok(entry_view(&path, &ws.studio.read_file(&id, &path)?))
    })
    .await
}

#[tauri::command]
pub async fn project_write_text(state: State<'_, AppState>, id: String, path: String, text: String) -> R<Vec<String>> {
    with_ws(&state.ws, move |ws| {
        ws.studio.write_file(&id, &path, text.as_bytes())?;
        Ok(if path.to_ascii_lowercase().ends_with(".lua") {
            cp_core::lua::lint(&text)
        } else {
            vec![]
        })
    })
    .await
}

#[tauri::command]
pub async fn project_override(state: State<'_, AppState>, id: String, archive: String, entry: String) -> R<String> {
    with_ws(&state.ws, move |ws| {
        let src = ws.original_archive(&archive)?;
        let key = ws.studio.override_from_archive(&id, &src, &entry)?;
        // Lua compilado não dá para editar: usa a versão em texto do próprio jogo
        let data = ws.studio.read_file(&id, &key)?;
        if cp_core::lua::inspect(&data).compiled {
            if let Some((_, text)) = ws.uncompiled_version(&entry)? {
                ws.studio.write_file(&id, &key, &text)?;
            }
        }
        Ok(key)
    })
    .await
}

#[tauri::command]
pub async fn project_texture(
    state: State<'_, AppState>,
    id: String,
    path: String,
    adjust: Option<ColorAdjust>,
) -> R<TextureView> {
    with_ws(&state.ws, move |ws| {
        texture_view(&ws.studio.read_file(&id, &path)?, adjust.as_ref())
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PngImport {
    id: String,
    path: String,
    png_path: String,
    resize: bool,
}

#[tauri::command]
pub async fn project_import_png(state: State<'_, AppState>, req: PngImport) -> R<dds::DdsInfo> {
    with_ws(&state.ws, move |ws| {
        let png = std::fs::read(&req.png_path).map_err(|e| cp_core::Error::io(&req.png_path, e))?;
        let reference = ws.studio.read_file(&req.id, &req.path).ok();
        ws.studio
            .import_png_as_dds(&req.id, &req.path, &png, reference.as_deref(), req.resize)
    })
    .await
}

/// Salva uma textura pintada no editor do app (PNG em base64), mantendo formato DDS e mipmaps.
#[tauri::command]
pub async fn project_save_painted(
    state: State<'_, AppState>,
    id: String,
    path: String,
    png_base64: String,
) -> R<dds::DdsInfo> {
    with_ws(&state.ws, move |ws| {
        let b64 = png_base64.split(',').next_back().unwrap_or_default();
        let png = base64::engine::general_purpose::STANDARD
            .decode(b64)
            .map_err(|_| cp_core::Error::Format("imagem inválida".into()))?;
        let reference = ws.studio.read_file(&id, &path).ok();
        ws.studio
            .import_png_as_dds(&id, &path, &png, reference.as_deref(), true)
    })
    .await
}

/// Instala um mod a partir de um link direto (.scd/.zip).
#[tauri::command]
pub async fn install_from_url(app: AppHandle, state: State<'_, AppState>, url: String, enable: bool) -> R<Manifest> {
    let cache = with_ws(&state.ws, |ws| Ok(ws.data_dir.join("cache").join("links"))).await?;
    let mut last = 0u64;
    let app2 = app.clone();
    let path = hub::download_url(&url, &cache, &mut move |p| {
        let pct = (p.downloaded * 100).checked_div(p.total).unwrap_or(0);
        if pct != last {
            last = pct;
            emit_progress(&app2, "link", pct as usize, 100, "Baixando");
        }
    })
    .await
    .map_err(err)?;
    emit_progress(&app, "link", 100, 100, "Instalando");
    with_ws(&state.ws, move |ws| {
        let opts = ImportOptions {
            source: Some(cp_core::manifest::Source {
                kind: "link".into(),
                url: Some(url.clone()),
                hub_id: None,
            }),
            replace: true,
            ..Default::default()
        };
        let m = ws.import_mod(&path, &opts, enable);
        if let Some(dir) = path.parent() {
            let _ = std::fs::remove_dir_all(dir);
        }
        m
    })
    .await
}

#[tauri::command]
pub async fn project_model(state: State<'_, AppState>, id: String, path: String) -> R<cp_core::scm::MeshView> {
    with_ws(&state.ws, move |ws| {
        Ok(cp_core::scm::view(&cp_core::scm::read(
            &ws.studio.read_file(&id, &path)?,
        )?))
    })
    .await
}

#[tauri::command]
pub async fn project_import_obj(
    state: State<'_, AppState>,
    id: String,
    path: String,
    obj_path: String,
    bone: Option<u8>,
) -> R<cp_core::scm::MeshView> {
    with_ws(&state.ws, move |ws| {
        let base = cp_core::scm::read(&ws.studio.read_file(&id, &path)?)?;
        let obj = std::fs::read_to_string(&obj_path).map_err(|e| cp_core::Error::io(&obj_path, e))?;
        let rig = match bone {
            Some(b) => cp_core::scm::Rigging::Bone(b),
            None => cp_core::scm::Rigging::Auto,
        };
        let model = cp_core::scm::replace_geometry_from_obj(&base, &obj, rig)?;
        ws.studio.write_file(&id, &path, &cp_core::scm::write(&model)?)?;
        Ok(cp_core::scm::view(&model))
    })
    .await
}

#[tauri::command]
pub async fn project_export(
    state: State<'_, AppState>,
    id: String,
    path: String,
    dest: String,
    format: String,
) -> R<()> {
    with_ws(&state.ws, move |ws| {
        let d = ws.studio.read_file(&id, &path)?;
        let out: Vec<u8> = match format.as_str() {
            "png" => dds::to_png(&dds::decode(&d)?.1)?,
            "obj" => {
                let stem = Path::new(&path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                cp_core::scm::to_obj(&cp_core::scm::read(&d)?, &stem).into_bytes()
            }
            "glb" => cp_core::scm::to_glb(&cp_core::scm::read(&d)?),
            _ => d,
        };
        std::fs::write(&dest, out).map_err(|e| cp_core::Error::io(&dest, e))
    })
    .await
}

/// Aplica um ajuste de cor de forma permanente numa textura do projeto (mesmo formato DDS).
#[tauri::command]
pub async fn project_adjust_texture(
    state: State<'_, AppState>,
    id: String,
    path: String,
    adjust: ColorAdjust,
) -> R<TextureView> {
    with_ws(&state.ws, move |ws| {
        let d = ws.studio.read_file(&id, &path)?;
        let (info, mut img) = dds::decode(&d)?;
        dds::adjust(&mut img, &adjust);
        let enc = dds::encode(
            &img,
            info.format,
            if info.mip_count <= 1 { 1 } else { 0 },
            dds::Quality::Normal,
        )?;
        ws.studio.write_file(&id, &path, &enc)?;
        texture_view(&enc, None)
    })
    .await
}

#[tauri::command]
pub async fn project_delete_file(state: State<'_, AppState>, id: String, path: String) -> R<()> {
    with_ws(&state.ws, move |ws| ws.studio.delete_file(&id, &path)).await
}

#[tauri::command]
pub async fn build_project(state: State<'_, AppState>, id: String, enable: bool) -> R<Manifest> {
    with_ws(&state.ws, move |ws| {
        let m = ws.studio.build(&id, &ws.library)?;
        if enable {
            let p = ws.profiles.active().id.clone();
            ws.profiles.set_enabled(&p, &m.id, true)?;
        }
        Ok(m)
    })
    .await
}

#[tauri::command]
pub async fn export_project_package(state: State<'_, AppState>, id: String, dest: String) -> R<PathBuf> {
    with_ws(&state.ws, move |ws| {
        ws.studio.export_package(&id, &ws.library, Path::new(&dest))
    })
    .await
}

// ===================================================================== estúdio: skin de interface

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinTargets {
    count: usize,
    sample: Vec<String>,
}

#[tauri::command]
pub async fn ui_skin_targets(state: State<'_, AppState>, opts: UiSkinOptions) -> R<SkinTargets> {
    with_ws(&state.ws, move |ws| {
        let t = studio::ui_skin_targets(&ws.stock_sources()?, &opts)?;
        Ok(SkinTargets {
            count: t.len(),
            sample: t.iter().take(400).map(|(_, n)| n.clone()).collect(),
        })
    })
    .await
}

#[tauri::command]
pub async fn ui_skin_preview(state: State<'_, AppState>, entry: String, adjust: ColorAdjust) -> R<TextureView> {
    with_ws(&state.ws, move |ws| {
        for src in ws.stock_sources()?.iter().rev() {
            if let Ok(d) = cp_core::scd::Scd::open(src)?.read(&entry) {
                return texture_view(&d, Some(&adjust));
            }
        }
        Err(cp_core::Error::Other(format!(
            "{entry} não encontrado nos arquivos do jogo"
        )))
    })
    .await
}

#[tauri::command]
pub async fn build_ui_skin(
    app: AppHandle,
    state: State<'_, AppState>,
    opts: UiSkinOptions,
    enable: bool,
) -> R<Manifest> {
    with_ws(&state.ws, move |ws| {
        let slug = cp_core::fsutil::slugify(&opts.name);
        let dest = ws
            .data_dir
            .join("cache")
            .join("skins")
            .join(format!("zz_cp_skin_{}.scd", slug.replace('-', "_")));
        let res = studio::build_ui_skin(&ws.stock_sources()?, &opts, &dest, &mut |i, n, name| {
            if i % 8 == 0 || i == n {
                emit_progress(&app, "skin", i, n, name.to_string());
            }
        })?;
        let import = ImportOptions {
            id: Some(format!("skin-{slug}")),
            name: Some(format!("Skin de interface: {}", opts.name)),
            category: Some(Category::Ui),
            description: Some(format!(
                "{} texturas recoloridas no Estúdio.{}",
                res.textures,
                if res.skipped.is_empty() {
                    String::new()
                } else {
                    format!(" {} ignoradas (formato não suportado).", res.skipped.len())
                }
            )),
            multiplayer: Some(cp_core::manifest::MpPolicy::Local),
            replace: true,
            ..Default::default()
        };
        let m = ws.import_mod(&res.archive, &import, enable)?;
        let _ = std::fs::remove_file(&res.archive);
        Ok(m)
    })
    .await
}

// ===================================================================== estúdio: mapas

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaptkStatus {
    python: Option<cp_core::maptk::Python>,
    ready: bool,
    message: Option<String>,
}

#[tauri::command]
pub async fn maptk_status(state: State<'_, AppState>) -> R<MaptkStatus> {
    with_ws(&state.ws, |ws| {
        Ok(match ws.map_bridge() {
            Ok(b) => MaptkStatus {
                python: Some(b.python),
                ready: true,
                message: None,
            },
            Err(e) => MaptkStatus {
                python: None,
                ready: false,
                message: Some(e.to_string()),
            },
        })
    })
    .await
}

/// Comandos rápidos do toolkit: `ping`, `catalog`, `preview`, `examples`.
#[tauri::command]
pub async fn maptk_run(
    app: AppHandle,
    state: State<'_, AppState>,
    command: String,
    input: serde_json::Value,
) -> R<serde_json::Value> {
    if !matches!(command.as_str(), "ping" | "catalog" | "preview" | "examples") {
        return Err("comando de mapa desconhecido".into());
    }
    with_ws(&state.ws, move |ws| {
        let mut out = ws.run_map_tool(&command, &input, &mut |ev| {
            if let BridgeEvent::Progress { message, .. } = ev {
                emit_progress(&app, "maptk", 0, 0, message.clone());
            }
        })?;
        if command == "preview" {
            if let Some(p) = out.get("path").and_then(|p| p.as_str()).map(PathBuf::from) {
                let bytes = std::fs::read(&p).map_err(|e| cp_core::Error::io(&p, e))?;
                out["dataUrl"] = serde_json::Value::String(data_url("image/png", &bytes));
            }
        }
        Ok(out)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapBuild {
    result: serde_json::Value,
    manifest: Manifest,
}

#[tauri::command]
pub async fn maptk_build(app: AppHandle, state: State<'_, AppState>, spec: serde_json::Value) -> R<MapBuild> {
    with_ws(&state.ws, move |ws| {
        let mut n = 0;
        let result = ws.run_map_tool("build", &serde_json::json!({ "spec": spec }), &mut |ev| match ev {
            BridgeEvent::Progress { message, .. } | BridgeEvent::Log { message } => {
                n += 1;
                emit_progress(&app, "map", n, 0, message.clone());
            }
            _ => {}
        })?;
        let scd = result
            .get("scd")
            .and_then(|s| s.as_str())
            .ok_or_else(|| cp_core::Error::Other("o toolkit não informou o arquivo gerado".into()))?;
        let name = result.get("name").and_then(|s| s.as_str()).unwrap_or("Mapa");
        let sid = result.get("scenarioId").and_then(|s| s.as_str()).unwrap_or("SC2_MAPA");
        let manifest = ws.install_built_map(Path::new(scd), name, sid)?;
        Ok(MapBuild { result, manifest })
    })
    .await
}

// ===================================================================== sistema

#[tauri::command]
pub async fn open_path(app: AppHandle, path: String, reveal: Option<bool>) -> R<()> {
    if reveal.unwrap_or(false) {
        app.opener().reveal_item_in_dir(&path).map_err(err)
    } else {
        app.opener().open_path(&path, None::<&str>).map_err(err)
    }
}
