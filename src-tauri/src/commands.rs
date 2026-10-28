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

pub(crate) type R<T> = Result<T, String>;

pub(crate) fn err<E: ToString>(e: E) -> String {
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

pub(crate) fn emit_progress(app: &AppHandle, task: &str, step: usize, total: usize, message: impl Into<String>) {
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
pub(crate) async fn with_ws<T, F>(ws: &Arc<Mutex<Workspace>>, f: F) -> R<T>
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

/// Roda `f` fora da thread principal e SEM travar o workspace: para trabalho pesado que só lê
/// arquivos do jogo (gerar texturas, prévias, mapas). Os outros botões continuam respondendo.
pub(crate) async fn off_lock<T, F>(f: F) -> R<T>
where
    T: Send + 'static,
    F: FnOnce() -> cp_core::Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(err)?.map_err(err)
}

/// Arquivos originais do jogo (na ordem de montagem), lidos com o workspace travado só por um instante.
pub(crate) async fn sources(ws: &Arc<Mutex<Workspace>>) -> R<Vec<PathBuf>> {
    with_ws(ws, |ws| ws.stock_sources()).await
}

/// Relatórios de travamento do jogo (`*.mdmp` na pasta bin).
fn crash_dumps(bin: &Path) -> Vec<String> {
    std::fs::read_dir(bin)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| n.to_ascii_lowercase().ends_with(".mdmp"))
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn data_url(mime: &str, bytes: &[u8]) -> String {
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
        // memória é controlada por memory_set/laa_set (mexem no executável): a tela de
        // configurações nunca sobrescreve com um valor antigo
        settings.keep_large_address = ws.settings.keep_large_address;
        settings.memory_limit_mb = ws.settings.memory_limit_mb;
        settings.game_priority = ws.settings.game_priority.clone();
        settings.game_no_throttle = ws.settings.game_no_throttle;
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
    launch_inner(app, state, None, None).await
}

/// Fecha o jogo travado (o processo fica aberto sem janela).
#[tauri::command]
pub async fn kill_game() -> R<usize> {
    // fechado pelo usuário: o vigia não confunde com o jogo fechando sozinho no meio da partida
    KILLED_BY_USER.store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(tauri::async_runtime::spawn_blocking(cp_core::game::kill_game).await.unwrap_or(0))
}

/// O jogo aberto pelo launcher foi fechado no botão "Fechar o jogo travado".
static KILLED_BY_USER: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Mapas de escaramuça para a partida grande: os do jogo e os dos mods de mapa ligados no perfil.
#[tauri::command]
pub async fn big_match_maps(state: State<'_, AppState>) -> R<Vec<cp_core::bigmatch::MatchMap>> {
    // um mapa gerado de novo com o mesmo nome troca o minimapa: a prévia é lida outra vez
    *BIG_MATCH_PREVIEWS.lock().unwrap_or_else(|p| p.into_inner()) = None;
    with_ws(&state.ws, |ws| ws.match_maps()).await
}

/// Minimapas já convertidos para a prévia da partida grande (cenário → PNG em data URL).
static BIG_MATCH_PREVIEWS: std::sync::Mutex<Option<std::collections::HashMap<String, Option<String>>>> = std::sync::Mutex::new(None);

/// Imagem do mapa (o minimapa do jogo, visto de cima) para a prévia das bases na partida grande e
/// as miniaturas da lista (`size` = lado máximo, 64 a 1024). `None` quando o mapa não tem minimapa.
#[tauri::command]
pub async fn big_match_preview(state: State<'_, AppState>, path: String, size: Option<u32>) -> R<Option<String>> {
    let size = size.unwrap_or(512).clamp(64, 1024);
    let key = format!("{}#{size}", path.to_ascii_lowercase());
    if let Some(hit) = BIG_MATCH_PREVIEWS.lock().unwrap_or_else(|p| p.into_inner()).as_ref().and_then(|m| m.get(&key)) {
        return Ok(hit.clone());
    }
    // só a lista de arquivos com o workspace travado; ler e converter a imagem fica fora da trava
    let (mods, stock) = with_ws(&state.ws, |ws| {
        let stock = ws.stock_sources()?;
        let active = ws.profiles.active().clone();
        let mut mods: Vec<std::path::PathBuf> = Vec::new();
        for m in ws.mods()? {
            if active.mods.iter().any(|x| x.id == m.manifest.id && x.enabled) {
                mods.extend(m.manifest.files.iter().map(|f| m.file_path(&f.name)));
            }
        }
        Ok((mods, stock))
    })
    .await?;
    let url = off_lock(move || Ok(cp_core::bigmatch::minimap_png(&mods, &stock, &path, size).ok().map(|png| data_url("image/png", &png)))).await?;
    let mut g = BIG_MATCH_PREVIEWS.lock().unwrap_or_else(|p| p.into_inner());
    let cache = g.get_or_insert_with(Default::default);
    if cache.len() > 256 {
        cache.clear();
    }
    cache.insert(key, url.clone());
    Ok(url)
}

/// Liga o mod do jogo em português quando o idioma do launcher (`ui_prefs.lang`) é português e o
/// desliga nos outros idiomas. Monta o mod de novo quando a tradução muda de versão.
fn apply_game_language(ws: &mut Workspace) -> cp_core::Result<()> {
    use cp_core::gamelang;
    let lang = ws.settings.ui_prefs.get("lang").and_then(|v| v.as_str()).unwrap_or("en").to_string();
    let want = gamelang::PT_LANGS.contains(&lang.as_str());
    let installed = ws.mods()?.into_iter().find(|m| m.manifest.id == gamelang::MOD_ID);
    let active = ws.profiles.active().clone();
    let enabled = active.mods.iter().any(|m| m.id == gamelang::MOD_ID && m.enabled);
    if !want {
        if enabled {
            ws.profiles.set_enabled(&active.id, gamelang::MOD_ID, false)?;
        }
        return Ok(());
    }
    if installed.as_ref().map(|m| m.manifest.version.as_str()) != Some(gamelang::MOD_VERSION) {
        let dir = ws.data_dir.join("cache").join("gamelang");
        std::fs::create_dir_all(&dir).map_err(|e| cp_core::Error::io(&dir, e))?;
        let archive = gamelang::build(&ws.stock_sources()?, &dir.join(gamelang::ARCHIVE))?;
        let count = gamelang::translations()?.len();
        let import = ImportOptions {
            id: Some(gamelang::MOD_ID.into()),
            name: Some("Jogo em português (Brasil)".into()),
            version: Some(gamelang::MOD_VERSION.into()),
            category: Some(Category::Ui),
            description: Some(gamelang::describe(count)),
            replace: true,
            move_source: true,
            ..Default::default()
        };
        ws.import_mod(&archive, &import, true)?;
        let _ = std::fs::remove_file(&archive);
    } else if !enabled {
        ws.profiles.set_enabled(&active.id, gamelang::MOD_ID, true)?;
    }
    Ok(())
}

/// Clima da partida grande: monta o mod Climas para o mapa e o clima escolhidos (ou só liga a cópia
/// já montada igual) e o desliga quando a partida é sem clima.
fn apply_weather(ws: &mut Workspace, b: &cp_core::bigmatch::BigMatch, app: &AppHandle) -> cp_core::Result<()> {
    use cp_core::weather;
    let active = ws.profiles.active().clone();
    let Some(kind) = cp_core::bigmatch::weather_of(&b.options)? else {
        for id in [weather::MOD_ID, weather::MODELS_ID] {
            if active.mods.iter().any(|m| m.id == id && m.enabled) {
                ws.profiles.set_enabled(&active.id, id, false)?;
            }
        }
        return Ok(());
    };
    // de onde vêm o código e as texturas: o jogo e os mods ligados (o mapa pode ser de um mod, e as
    // Texturas HD trocam o chão), na ordem em que o jogo monta; nunca o próprio clima
    let mut mod_files: Vec<PathBuf> = Vec::new();
    for m in ws.mods()? {
        if m.manifest.id == weather::MOD_ID || m.manifest.id == weather::MODELS_ID || !active.mods.iter().any(|x| x.id == m.manifest.id && x.enabled) {
            continue;
        }
        mod_files.extend(m.manifest.files.iter().map(|f| m.file_path(&f.name)));
    }
    mod_files.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()));
    let mut sources = ws.stock_sources()?;
    sources.extend(mod_files);
    // unidades e prédios no clima: não dependem do mapa, montados uma vez por clima (molhado ou neve);
    // neblina e areia não mudam as unidades
    let models_version = weather::models_version(&sources, kind);
    if !kind.dresses_ground() {
        if active.mods.iter().any(|m| m.id == weather::MODELS_ID && m.enabled) {
            ws.profiles.set_enabled(&active.id, weather::MODELS_ID, false)?;
        }
    } else if ws.mods()?.iter().any(|m| m.manifest.id == weather::MODELS_ID && m.manifest.version == models_version) {
        ws.profiles.set_enabled(&active.id, weather::MODELS_ID, true)?;
    } else {
        emit_progress(app, "apply", 0, 1, "Preparando o clima nas unidades e prédios (só na primeira vez)…");
        let dir = ws.data_dir.join("cache").join("weather");
        std::fs::create_dir_all(&dir).map_err(|e| cp_core::Error::io(&dir, e))?;
        match weather::build_models(&sources, kind, &dir.join(weather::MODELS_ARCHIVE)) {
            Ok((archive, count)) => {
                let import = ImportOptions {
                    id: Some(weather::MODELS_ID.into()),
                    name: Some("Climas: unidades e prédios".into()),
                    version: Some(models_version),
                    category: Some(Category::Textures),
                    description: Some(format!(
                        "{} em {count} unidades e prédios: {}. Liga só nas partidas grandes com clima.",
                        if kind == weather::Kind::Blizzard { "Neve" } else { "Molhado" },
                        if kind == weather::Kind::Blizzard { "neve acumulada só nas partes de cima (telhados e topos), sem cobrir a cor do time" } else { "mais brilho nas partes expostas à chuva, conforme o material" }
                    )),
                    replace: true,
                    move_source: true,
                    ..Default::default()
                };
                ws.import_mod(&archive, &import, true)?;
                let _ = std::fs::remove_file(&archive);
            }
            Err(e) => {
                // a partida segue com o clima; só os modelos ficam como estão
                eprintln!("clima nos modelos não montado: {e}");
                if active.mods.iter().any(|m| m.id == weather::MODELS_ID && m.enabled) {
                    ws.profiles.set_enabled(&active.id, weather::MODELS_ID, false)?;
                }
            }
        }
    }
    let amount = weather::clamp_amount(b.options.weather_amount);
    let version = weather::build_version(&sources, &b.map, kind, amount);
    if ws.mods()?.iter().any(|m| m.manifest.id == weather::MOD_ID && m.manifest.version == version) {
        return ws.profiles.set_enabled(&active.id, weather::MOD_ID, true);
    }
    emit_progress(app, "apply", 0, 1, "Preparando o clima (chão e partículas)…");
    let dir = ws.data_dir.join("cache").join("weather");
    std::fs::create_dir_all(&dir).map_err(|e| cp_core::Error::io(&dir, e))?;
    let archive = weather::build(&sources, &b.map, kind, amount, &dir.join(weather::ARCHIVE))?;
    let import = ImportOptions {
        id: Some(weather::MOD_ID.into()),
        name: Some("Climas (chuva, tempestade, nevasca)".into()),
        version: Some(version),
        category: Some(Category::Textures),
        description: Some(weather::describe(kind)),
        replace: true,
        move_source: true,
        ..Default::default()
    };
    ws.import_mod(&archive, &import, true)?;
    let _ = std::fs::remove_file(&archive);
    Ok(())
}

/// Começa uma partida grande: monta o mod (uma vez), aplica o perfil e abre o jogo direto com as vagas.
#[tauri::command]
pub async fn launch_big_match(app: AppHandle, state: State<'_, AppState>, spec: cp_core::bigmatch::BigMatch) -> R<LaunchResult> {
    launch_inner(app, state, Some(spec), None).await
}

async fn launch_inner(app: AppHandle, state: State<'_, AppState>, big: Option<cp_core::bigmatch::BigMatch>, ip: Option<IpPlay>) -> R<LaunchResult> {
    let ip_on = ip.is_some();
    if let Some(b) = &big {
        // confere antes de mexer em qualquer coisa
        cp_core::bigmatch::launch_args(b).map_err(err)?;
    }
    let app2 = app.clone();
    // relatórios de travamento que já existiam antes de abrir (para notar um novo)
    let crash_watch = with_ws(&state.ws, |ws| {
        let bin = ws.game_bin_dir()?;
        let before = crash_dumps(&bin);
        let active = ws.profiles.active().clone();
        let mods: Vec<(String, String)> = ws
            .mods()?
            .into_iter()
            .filter(|m| active.mods.iter().any(|x| x.id == m.manifest.id && x.enabled))
            .map(|m| (m.manifest.id, m.manifest.name))
            .collect();
        Ok((bin, before, mods))
    })
    .await
    .ok();
    let (plan, applied, restore, memory_mb, priority, no_throttle, log_path) = with_ws(&state.ws, move |ws| {
        let mut log_path: Option<std::path::PathBuf> = None;
        // o que foi pedido no painel do launcher dentro do jogo (Extras): perfil, mods, cor, memória
        match ws.take_game_requests() {
            Ok(done) if !done.is_empty() => eprintln!("pedidos do jogo aplicados: {}", done.join(", ")),
            Ok(_) => {}
            Err(e) => eprintln!("pedidos do jogo não lidos: {e}"),
        }
        if let Err(e) = ws.ensure_large_address() {
            eprintln!("modo 4 GB não reaplicado: {e}");
        }
        // faixa do tutorial do ReShade fixa em cima do jogo
        if let Ok(sh) = ws.shaders() {
            let _ = sh.quiet_overlay();
        }
        let mut plan = None;
        if let Some(b) = &big {
            // o mod da partida grande, montado com os arquivos do jogo do usuário
            ws.ensure_bigmatch_mod()?;
            // clima: o mod é montado para a partida (o mapa e o clima entram nos arquivos)
            apply_weather(ws, b, &app2)?;
            let game = ws.game()?.clone();
            // sem o steam_appid.txt o jogo aberto direto reabre pela Steam e perde os argumentos
            let appid = game.bin_dir().join("steam_appid.txt");
            if !appid.exists() {
                let _ = std::fs::write(&appid, cp_core::game::STEAM_APP_ID.to_string());
            }
            // um /map ou /cpmatch esquecido nos argumentos extras trocaria o mapa e as vagas da partida
            let mut args = cp_core::bigmatch::clean_user_args(&ws.settings.launch_args);
            // log do jogo: se ele fechar no meio, o launcher mostra onde parou
            if cp_core::bigmatch::user_log(&args).is_none() {
                let log = ws.data_dir.join("logs").join(cp_core::bigmatch::LOG_FILE);
                if let Some(dir) = log.parent() {
                    let _ = std::fs::create_dir_all(dir);
                }
                let _ = std::fs::remove_file(&log);
                args.push("/log".into());
                args.push(log.to_string_lossy().into_owned());
            }
            log_path = cp_core::bigmatch::user_log(&args).map(std::path::PathBuf::from);
            args.extend(cp_core::bigmatch::launch_args(b)?);
            plan = Some(cp_core::game::launch_plan(&game, cp_core::game::LaunchMode::Direct, &args)?);
        }
        // jogar por IP: o steam_api.dll do Proxima só fica no jogo nesta sessão; nas outras, o original
        let px = ws.proxima()?;
        match &ip {
            Some(ip) => {
                px.set_player_data(&ip.name, ip.port)?;
                px.install()?;
            }
            None => {
                px.restore()?;
            }
        }
        // jogo em português quando o launcher está em português (Brasil); em inglês, o jogo original
        if let Err(e) = apply_game_language(ws) {
            eprintln!("tradução do jogo não aplicada: {e}");
        }
        if big.is_none() {
            // os mods da partida grande e do clima só servem para ela: nas partidas comuns (pelo lobby
            // do jogo) ficam de fora
            let active = ws.profiles.active().clone();
            // (a Partida grande fica quando há atalhos dela na tela inicial do jogo)
            let ss = cp_core::startscreen::Settings::load(&ws.data_dir);
            let shortcuts = !ss.shortcuts.is_empty() || ss.enabled;
            for id in ["cp-partida-grande", cp_core::weather::MOD_ID, cp_core::weather::MODELS_ID] {
                if shortcuts && id == "cp-partida-grande" {
                    continue;
                }
                if active.mods.iter().any(|m| m.id == id && m.enabled) {
                    ws.profiles.set_enabled(&active.id, id, false)?;
                }
            }
        }
        // com "mods só pelo launcher" (ou "voltar ao original ao fechar") a pasta volta ao original
        // quando o jogo fecha: sem aplicar de novo, o jogo abriria sem os mods do perfil
        let restored_on_exit = ws.settings.restore_on_exit || ws.settings.mods_only_launcher;
        let applied = if ws.settings.apply_before_launch || big.is_some() || restored_on_exit {
            Some(ws.apply_active(&mut |p: Progress| emit_progress(&app2, "apply", p.step, p.total, p.message))?)
        } else {
            None
        };
        let plan = match plan {
            Some(p) => p,
            None => ws.launch_plan()?,
        };
        Ok((plan, applied, ws.settings.restore_on_exit || ws.settings.mods_only_launcher || ip_on, ws.settings.memory_mb(), ws.settings.game_priority.clone(), ws.settings.game_no_throttle, log_path))
    })
    .await?;
    match &plan {
        LaunchPlan::Url { url } => app.opener().open_url(url, None::<&str>).map_err(err)?,
        LaunchPlan::Exe { .. } => {
            cp_core::game::spawn_exe(&plan).map_err(err)?;
        }
    }
    KILLED_BY_USER.store(false, std::sync::atomic::Ordering::SeqCst);
    if let Some((bin, before, mods)) = crash_watch {
        // o jogo grava um .mdmp na pasta bin quando trava: avisa e sugere o que desligar
        let app6 = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut seen_running = false;
            // o log da partida grande: lido quando o jogo fecha (sem "Run time:" = fechou no meio)
            let report = |log: &Option<std::path::PathBuf>| {
                log.as_ref()
                    .and_then(|p| std::fs::read(p).ok())
                    .map(|b| cp_core::bigmatch::read_log(&String::from_utf8_lossy(&b)))
            };
            let crashed = |dump: Option<&String>, log: Option<cp_core::bigmatch::LogReport>| {
                serde_json::json!({ "dump": dump, "mods": mods, "log": log, "logPath": log_path })
            };
            for tick in 0..2400u32 {
                tokio::time::sleep(std::time::Duration::from_secs(3)).await;
                let now = crash_dumps(&bin);
                if let Some(new) = now.iter().find(|d| !before.contains(*d)) {
                    let _ = app6.emit("cp://game-closed", ());
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    let _ = app6.emit("cp://game-crashed", crashed(Some(new), report(&log_path)));
                    return;
                }
                let running = tauri::async_runtime::spawn_blocking(cp_core::game::is_running).await.unwrap_or(false);
                seen_running |= running;
                // fechou (com ou sem relatório) ou nem chegou a abrir em 2 min
                if (seen_running && !running) || (!seen_running && tick > 40) {
                    // a interface para o som do clima (e o que mais depender do jogo aberto)
                    let _ = app6.emit("cp://game-closed", ());
                    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                    if KILLED_BY_USER.load(std::sync::atomic::Ordering::SeqCst) {
                        return;
                    }
                    let log = report(&log_path);
                    if let Some(new) = crash_dumps(&bin).iter().find(|d| !before.contains(*d)) {
                        let _ = app6.emit("cp://game-crashed", crashed(Some(new), log));
                    } else if let Some(log) = log.filter(|l| !l.finished) {
                        // sem relatório de travamento, mas o jogo não terminou a partida normalmente
                        let _ = app6.emit("cp://game-crashed", crashed(None, Some(log)));
                    }
                    return;
                }
            }
        });
    }
    if priority != "normal" {
        // prioridade escolhida no Otimizador: aplicada quando o processo aparecer
        let app7 = app.clone();
        tauri::async_runtime::spawn(async move {
            for _ in 0..120 {
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                let level = priority.clone();
                match tauri::async_runtime::spawn_blocking(move || cp_core::perf::set_game_priority(&level)).await {
                    Ok(Ok(_)) => {
                        let _ = app7.emit("cp://priority-set", &priority);
                        return;
                    }
                    Ok(Err(cp_core::Error::Other(m))) if m.contains("não está aberto") => continue,
                    Ok(Err(e)) => {
                        let _ = app7.emit("cp://priority-failed", e.to_string());
                        return;
                    }
                    Err(_) => return,
                }
            }
        });
    }
    if no_throttle {
        // mod de otimização: o Windows não economiza energia no processo do jogo
        tauri::async_runtime::spawn(async move {
            for _ in 0..120 {
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                match tauri::async_runtime::spawn_blocking(cp_core::perf::set_game_no_throttle).await {
                    Ok(Err(cp_core::Error::Other(m))) if m.contains("não está aberto") => continue,
                    _ => return,
                }
            }
        });
    }
    let lock_cursor = with_ws(&state.ws, |ws| Ok(ws.settings.lock_cursor)).await.unwrap_or(false);
    if lock_cursor {
        // mouse preso na janela do jogo (modo janela) enquanto ela está em primeiro plano
        tauri::async_runtime::spawn(async move {
            let mut pid = None;
            for _ in 0..120 {
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                pid = tauri::async_runtime::spawn_blocking(cp_core::perf::game_pid).await.ok().flatten();
                if pid.is_some() {
                    break;
                }
            }
            let Some(pid) = pid else { return };
            let mut clipped = false;
            let mut tick = 0u32;
            loop {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                match cp_core::perf::game_window_rect(pid) {
                    Some(r) => {
                        cp_core::perf::clip_cursor(Some(r));
                        clipped = true;
                    }
                    None if clipped => {
                        // outra janela na frente (Alt+Tab): solta o mouse
                        cp_core::perf::clip_cursor(None);
                        clipped = false;
                    }
                    None => {}
                }
                tick += 1;
                if tick % 16 == 0 && !tauri::async_runtime::spawn_blocking(cp_core::game::is_running).await.unwrap_or(false) {
                    if clipped {
                        cp_core::perf::clip_cursor(None);
                    }
                    return;
                }
            }
        });
    }
    if cp_core::memory::needs_job_limit(memory_mb) {
        // teto entre 2 e 4 GB: aplicado assim que o processo do jogo aparecer
        let app5 = app.clone();
        tauri::async_runtime::spawn(async move {
            for _ in 0..120 {
                tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
                let r = tauri::async_runtime::spawn_blocking(move || cp_core::memory::limit_running_game(memory_mb)).await;
                match r {
                    Ok(Ok(_)) => {
                        let _ = app5.emit("cp://memory-limited", memory_mb);
                        return;
                    }
                    Ok(Err(cp_core::Error::Other(m))) if m.contains("não está aberto") => continue,
                    Ok(Err(e)) => {
                        let _ = app5.emit("cp://memory-limit-failed", e.to_string());
                        return;
                    }
                    Err(_) => return,
                }
            }
        });
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
    let srcs = sources(&state.ws).await?;
    off_lock(move || {
        for src in srcs.iter().rev() {
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
            move_source: true,
            ..Default::default()
        };
        let m = ws.import_mod(&res.archive, &import, enable)?;
        let _ = std::fs::remove_file(&res.archive);
        Ok(m)
    })
    .await
}

/// Mod de trapaças para jogar sozinho, montado com os arquivos do jogo do próprio usuário.
#[tauri::command]
pub async fn build_cheats(state: State<'_, AppState>, opts: cp_core::cheats::CheatOptions, enable: bool) -> R<Manifest> {
    with_ws(&state.ws, move |ws| {
        let dir = ws.data_dir.join("cache").join("cheats");
        std::fs::create_dir_all(&dir).map_err(|e| cp_core::Error::io(&dir, e))?;
        let archive = cp_core::cheats::build(&ws.stock_sources()?, &opts, &dir.join("zz_cp_trapacas.scd"))?;
        let mut list: Vec<String> = Vec::new();
        for (on, what) in [
            (opts.mass, "massa infinita"),
            (opts.energy, "energia infinita"),
            (opts.research, "pesquisa infinita"),
            (opts.unlock_all, "toda a pesquisa liberada"),
            (opts.god, "unidades invencíveis"),
            (opts.ai_too, "a IA também trapaceia"),
        ] {
            if on {
                list.push(what.to_string());
            }
        }
        if opts.build_speed > 1.0 {
            list.push(format!("construção {}× mais rápida", opts.build_speed));
        }
        if opts.menu {
            list.push(format!("menu na partida pela tecla {}", opts.key));
        }
        let import = ImportOptions {
            id: Some("cp-trapacas".into()),
            name: Some("Trapaças (jogar sozinho)".into()),
            category: Some(Category::Gameplay),
            description: Some(format!(
                "{}. Só vale em partidas com um único jogador humano (escaramuça contra a IA); em multiplayer se desliga sozinho.",
                if list.is_empty() { "Nenhuma trapaça marcada".to_string() } else { list.join(", ") }
            )),
            replace: true,
            move_source: true,
            ..Default::default()
        };
        let m = ws.import_mod(&archive, &import, enable)?;
        let _ = std::fs::remove_file(&archive);
        Ok(m)
    })
    .await
}

/// Mod "Primeira Pessoa", montado com os arquivos do jogo do próprio usuário.
#[tauri::command]
pub async fn build_first_person(state: State<'_, AppState>, opts: cp_core::firstperson::FirstPersonOptions, enable: bool) -> R<Manifest> {
    with_ws(&state.ws, move |ws| {
        let dir = ws.data_dir.join("cache").join("firstperson");
        std::fs::create_dir_all(&dir).map_err(|e| cp_core::Error::io(&dir, e))?;
        let archive = cp_core::firstperson::build(&ws.stock_sources()?, &opts, &dir.join(cp_core::firstperson::ARCHIVE))?;
        let import = ImportOptions {
            id: Some("cp-primeira-pessoa".into()),
            name: Some("Primeira Pessoa".into()),
            version: Some(cp_core::firstperson::MOD_VERSION.into()),
            category: Some(Category::Gameplay),
            description: Some(cp_core::firstperson::describe(&opts)),
            replace: true,
            move_source: true,
            ..Default::default()
        };
        let m = ws.import_mod(&archive, &import, enable)?;
        let _ = std::fs::remove_file(&archive);
        Ok(m)
    })
    .await
}

/// Estado do mod de otimização: opções salvas, se está instalado e os ajustes do Windows.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizeState {
    pub options: cp_core::optimize::OptimizeOptions,
    pub installed: bool,
    pub enabled: bool,
    pub windows: cp_core::optimize::WindowsTweaks,
    pub large_address: bool,
    pub priority: String,
    pub no_throttle: bool,
    pub fps_choices: Vec<u32>,
}

const OPT_ID: &str = "cp-otimizacao";

fn game_exe(ws: &cp_core::workspace::Workspace) -> Option<std::path::PathBuf> {
    ws.game().ok().and_then(|g| g.exe.clone())
}

fn optimize_options_path(ws: &cp_core::workspace::Workspace) -> std::path::PathBuf {
    ws.data_dir.join("optimize.json")
}

fn optimize_state(ws: &cp_core::workspace::Workspace) -> OptimizeState {
    let options: cp_core::optimize::OptimizeOptions = std::fs::read(optimize_options_path(ws))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let installed = ws.mods().map(|l| l.iter().any(|m| m.manifest.id == OPT_ID)).unwrap_or(false);
    let enabled = ws.profiles.active().mods.iter().any(|e| e.id == OPT_ID && e.enabled);
    let windows = game_exe(ws).map(|e| cp_core::optimize::windows_status(&e)).unwrap_or_default();
    OptimizeState {
        options,
        installed,
        enabled,
        windows,
        large_address: ws.settings.keep_large_address,
        priority: ws.settings.game_priority.clone(),
        no_throttle: ws.settings.game_no_throttle,
        fps_choices: cp_core::optimize::FPS_CHOICES.to_vec(),
    }
}

#[tauri::command]
pub async fn optimize_status(state: State<'_, AppState>) -> R<OptimizeState> {
    with_ws(&state.ws, |ws| Ok(optimize_state(ws))).await
}

/// Mod de otimização: monta o .scd (limite de FPS), aplica os ajustes do Windows e guarda
/// prioridade, energia e modo 4 GB nas configurações (valem ao abrir o jogo).
#[tauri::command]
pub async fn build_optimize(state: State<'_, AppState>, opts: cp_core::optimize::OptimizeOptions, enable: bool) -> R<OptimizeState> {
    with_ws(&state.ws, move |ws| {
        let mut o = opts;
        if !["normal", "above_normal", "high"].contains(&o.priority.as_str()) {
            o.priority = "normal".into();
        }
        let dir = ws.data_dir.join("cache").join("optimize");
        std::fs::create_dir_all(&dir).map_err(|e| cp_core::Error::io(&dir, e))?;
        let archive = cp_core::optimize::build(&ws.stock_sources()?, &o, &dir.join("zz_cp_otimizacao.scd"))?;
        let import = ImportOptions {
            id: Some(OPT_ID.into()),
            name: Some("Otimização".into()),
            category: Some(Category::Fixes),
            description: Some(cp_core::optimize::describe(&o)),
            replace: true,
            move_source: true,
            ..Default::default()
        };
        ws.import_mod(&archive, &import, enable)?;
        let _ = std::fs::remove_file(&archive);
        if let Some(exe) = game_exe(ws) {
            cp_core::optimize::apply_windows(&exe, o.gpu, o.fullscreen_fix)?;
        }
        ws.settings.game_priority = o.priority.clone();
        ws.settings.game_no_throttle = o.no_throttle;
        if o.large_address && !ws.settings.keep_large_address {
            // o mesmo que ligar o modo 4 GB no Otimizador (com cópia do executável)
            match ws.laa().and_then(|l| l.enable()) {
                Ok(_) => {
                    ws.settings.keep_large_address = true;
                    ws.settings.memory_limit_mb = Some(cp_core::memory::MAX_MB);
                }
                Err(e) => eprintln!("modo 4 GB não aplicado agora: {e}"),
            }
        }
        ws.save_settings()?;
        let bytes = serde_json::to_vec_pretty(&o).map_err(|e| cp_core::Error::Other(e.to_string()))?;
        cp_core::fsutil::write_atomic(&optimize_options_path(ws), &bytes)?;
        Ok(optimize_state(ws))
    })
    .await
}

/// Desfaz os ajustes do Windows do mod de otimização (o mod continua na biblioteca).
#[tauri::command]
pub async fn optimize_undo_windows(state: State<'_, AppState>) -> R<OptimizeState> {
    with_ws(&state.ws, move |ws| {
        if let Some(exe) = game_exe(ws) {
            cp_core::optimize::apply_windows(&exe, false, false)?;
        }
        ws.settings.game_no_throttle = false;
        ws.save_settings()?;
        Ok(optimize_state(ws))
    })
    .await
}

/// Mod "IA mais esperta", montado com os arquivos do jogo do próprio usuário.
#[tauri::command]
pub async fn build_ai(state: State<'_, AppState>, opts: cp_core::aimod::AiOptions, enable: bool) -> R<AiInstall> {
    with_ws(&state.ws, move |ws| {
        let dir = ws.data_dir.join("cache").join("ai");
        std::fs::create_dir_all(&dir).map_err(|e| cp_core::Error::io(&dir, e))?;
        let res = cp_core::aimod::build(&ws.stock_sources()?, &opts, &dir.join("zz_cp_ia_esperta.scd"))?;
        let mut list: Vec<&str> = Vec::new();
        if opts.naval {
            list.push("navios em mapas com água");
        }
        if opts.economy {
            list.push("economia, engenheiros e mini-bases");
        }
        if opts.commander {
            list.push("comandante estratégico (ataca junto, defende, recua, embosca)");
        }
        if opts.commander && opts.raids {
            list.push("ataques-relâmpago em extratores");
        }
        if opts.commander {
            for (on, what) in [
                (opts.air, "aviação estratégica"),
                (opts.micro, "microgestão e pinça"),
                (opts.counter, "reconhecimento e contra-ataque"),
                (opts.build, "defesa reativa e postos avançados"),
                (opts.team, "IAs aliadas em equipe"),
                (opts.adaptive, "dificuldade adaptativa"),
                (opts.learn, "aprende o seu jeito de jogar"),
            ] {
                if on {
                    list.push(what);
                }
            }
        }
        let personality = match opts.personality.as_str() {
            "balanced" => "equilibrada",
            "aggressive" => "agressiva",
            "defensive" => "defensiva",
            "raider" => "saqueadora",
            "naval" => "naval",
            "airborne" => "aérea",
            _ => "personalidades misturadas",
        };
        let panel = if opts.commander && opts.panel { format!(" Painel no jogo: tecla {}.", opts.panel_key) } else { String::new() };
        let import = ImportOptions {
            id: Some("cp-ia-esperta".into()),
            name: Some(if opts.level >= 2 { "IA mais esperta (brutal)".into() } else { "IA mais esperta".into() }),
            category: Some(Category::Gameplay),
            description: Some(format!(
                "{}; {personality}. Vale para todas as dificuldades da IA em escaramuça.{panel} {} ajustes aplicados.",
                list.join(", "),
                res.applied
            )),
            replace: true,
            move_source: true,
            ..Default::default()
        };
        let manifest = ws.import_mod(&res.archive, &import, enable)?;
        let _ = std::fs::remove_file(&res.archive);
        Ok(AiInstall { manifest, applied: res.applied, skipped: res.skipped })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiInstall {
    manifest: Manifest,
    applied: usize,
    skipped: Vec<String>,
}

/// O que a IA aprendeu sobre o jogador (lido do `Game.prefs`).
#[tauri::command]
pub async fn ai_memory() -> R<cp_core::aimod::AiMemoryReport> {
    tauri::async_runtime::spawn_blocking(|| cp_core::aimod::read_memory(cp_core::perf::prefs_path().as_deref()))
        .await
        .map_err(|e| e.to_string())
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

/// Python do toolkit, gamedata e pasta de saída: pega com o workspace travado e devolve,
/// para o toolkit rodar sem bloquear o resto do launcher.
async fn map_ctx(ws: &Arc<Mutex<Workspace>>) -> R<(cp_core::maptk::Bridge, PathBuf, PathBuf)> {
    with_ws(ws, |ws| Ok((ws.map_bridge()?, ws.game()?.gamedata.clone(), ws.maps_out_dir()))).await
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
    let (bridge, gamedata, out_dir) = map_ctx(&state.ws).await?;
    off_lock(move || {
        let mut out = bridge.run(&command, &input, &gamedata, &out_dir, &mut |ev| {
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

/// Relevo do terreno para o editor 3D, com o minimapa original convertido em PNG (textura).
#[tauri::command]
pub async fn maptk_terrain3d(
    app: AppHandle,
    state: State<'_, AppState>,
    terrain: String,
    size: Option<u32>,
) -> R<serde_json::Value> {
    let (bridge, gamedata, out_dir) = map_ctx(&state.ws).await?;
    off_lock(move || {
        let input = serde_json::json!({ "terrain": terrain, "size": size.unwrap_or(256).clamp(32, 512) });
        let mut out = bridge.run("terrain3d", &input, &gamedata, &out_dir, &mut |ev| {
            if let BridgeEvent::Progress { message, .. } = ev {
                emit_progress(&app, "maptk", 0, 0, message.clone());
            }
        })?;
        let texture = out
            .get("minimapDds")
            .and_then(|v| v.as_str())
            .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok())
            .and_then(|dds_bytes| dds::decode(&dds_bytes).ok())
            .and_then(|(_, img)| dds::to_png(&img).ok())
            .map(|png| data_url("image/png", &png));
        if let Some(obj) = out.as_object_mut() {
            obj.remove("minimapDds");
            obj.insert("texture".into(), texture.map_or(serde_json::Value::Null, serde_json::Value::String));
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
pub async fn maptk_build(app: AppHandle, state: State<'_, AppState>, spec: serde_json::Value, creation: Option<String>) -> R<MapBuild> {
    // decorações feitas no editor 3D: os arquivos entram no pacote do mapa depois do toolkit
    let custom = crate::creator_cmds::custom_files_for(&state, &spec).await?;
    let (bridge, gamedata, out_dir) = map_ctx(&state.ws).await?;
    let result = off_lock(move || {
        let mut n = 0;
        bridge.run("build", &serde_json::json!({ "spec": spec }), &gamedata, &out_dir, &mut |ev| match ev {
            BridgeEvent::Progress { message, .. } | BridgeEvent::Log { message } => {
                n += 1;
                emit_progress(&app, "map", n, 0, message.clone());
            }
            _ => {}
        })
    })
    .await?;
    with_ws(&state.ws, move |ws| {
        let scd = result
            .get("scd")
            .and_then(|s| s.as_str())
            .ok_or_else(|| cp_core::Error::Other("o toolkit não informou o arquivo gerado".into()))?;
        let name = result.get("name").and_then(|s| s.as_str()).unwrap_or("Mapa");
        let sid = result.get("scenarioId").and_then(|s| s.as_str()).unwrap_or("SC2_MAPA");
        if !custom.is_empty() {
            cp_core::scd::append_files(Path::new(scd), &custom)?;
        }
        let manifest = ws.install_built_map(Path::new(scd), name, sid)?;
        if let Some(c) = &creation {
            // o projeto do editor lembra qual mod ele gerou (para exportar o .scd depois)
            if let Ok(store) = cp_core::creator::Creations::open(&ws.data_dir) {
                let _ = store.set_built_mod(c, &manifest.id);
            }
        }
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

// ---------------------------------------------------------------- shaders (ReShade)

/// `None` quando a pasta do jogo ainda não foi configurada.
#[tauri::command]
pub async fn shaders_status(state: State<'_, AppState>) -> R<Option<cp_core::shaders::ShaderStatus>> {
    with_ws(&state.ws, |ws| match ws.shaders() {
        Ok(sh) => sh.status().map(Some),
        Err(_) if ws.game().is_err() => Ok(None),
        Err(e) => Err(e),
    })
    .await
}

#[tauri::command]
pub async fn shaders_apply(state: State<'_, AppState>, preset: Option<String>) -> R<cp_core::shaders::ShaderStatus> {
    with_ws(&state.ws, move |ws| ws.shaders()?.apply(preset.as_deref())).await
}

#[tauri::command]
pub async fn shaders_reset(state: State<'_, AppState>) -> R<cp_core::shaders::ShaderStatus> {
    with_ws(&state.ws, |ws| ws.shaders()?.reset_presets()).await
}

#[tauri::command]
pub async fn shaders_remove(state: State<'_, AppState>, reshade: bool) -> R<cp_core::shaders::ShaderStatus> {
    with_ws(&state.ws, move |ws| ws.shaders()?.remove(reshade)).await
}

/// Baixa o instalador oficial do ReShade, confere a assinatura, instala e ativa `preset`.
#[tauri::command]
pub async fn shaders_install_reshade(
    app: AppHandle,
    state: State<'_, AppState>,
    preset: Option<String>,
) -> R<cp_core::shaders::ShaderStatus> {
    let (exe, cache) = with_ws(&state.ws, |ws| {
        if cp_core::game::is_running() {
            return Err(cp_core::Error::Other("feche o jogo antes de instalar o ReShade".into()));
        }
        let exe = ws
            .game()?
            .exe
            .clone()
            .ok_or_else(|| cp_core::Error::Other("executável do jogo não encontrado".into()))?;
        Ok((exe, ws.data_dir.join("cache").join("reshade")))
    })
    .await?;
    let app2 = app.clone();
    cp_core::shaders::install_reshade(&exe, &cache, &mut move |m, f| {
        let step = f.map(|f| (f * 1000.0) as usize).unwrap_or(0);
        emit_progress(&app2, "reshade", step, if f.is_some() { 1000 } else { 0 }, m);
    })
    .await
    .map_err(err)?;
    emit_progress(&app, "reshade", 980, 1000, "Ativando os shaders");
    with_ws(&state.ws, move |ws| {
        ws.shaders()?.apply(Some(preset.as_deref().unwrap_or("Vivido")))
    })
    .await
}

// ---------------------------------------------------------------- estúdio: texturas HD

#[tauri::command]
pub async fn enhance_groups(state: State<'_, AppState>) -> R<Vec<cp_core::enhance::GroupSummary>> {
    let src = sources(&state.ws).await?;
    off_lock(move || cp_core::enhance::groups(&src)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnhancePreview {
    before: String,
    after: String,
    info: dds::DdsInfo,
    width: u32,
    height: u32,
    class: cp_core::enhance::TextureClass,
}

/// Original (ampliado sem filtro) e melhorado, no tamanho final, para comparar.
#[tauri::command]
pub async fn enhance_preview(
    state: State<'_, AppState>,
    entry: String,
    mode: cp_core::enhance::Mode,
    opts: cp_core::enhance::EnhanceOptions,
) -> R<EnhancePreview> {
    with_ws(&state.ws, move |ws| {
        for src in ws.stock_sources()?.iter().rev() {
            if let Ok(d) = cp_core::scd::Scd::open(src)?.read(&entry) {
                let key = cp_core::scd::normalize_key(&entry);
                let (before, after, info, (width, height)) = cp_core::enhance::preview(&key, &d, mode, &opts)?;
                return Ok(EnhancePreview {
                    before: data_url("image/png", &before),
                    after: data_url("image/png", &after),
                    class: cp_core::enhance::classify(&key, &info),
                    info,
                    width,
                    height,
                });
            }
        }
        Err(cp_core::Error::Other(format!(
            "{entry} não encontrado nos arquivos do jogo"
        )))
    })
    .await
}

#[tauri::command]
pub async fn build_enhance(
    app: AppHandle,
    state: State<'_, AppState>,
    opts: cp_core::enhance::EnhanceOptions,
    enable: bool,
) -> R<Manifest> {
    let (srcs, data_dir) = with_ws(&state.ws, |ws| Ok((ws.stock_sources()?, ws.data_dir.clone()))).await?;
    let opts2 = opts.clone();
    let res = off_lock(move || {
        let dest = data_dir.join("cache").join("hd").join("zz_cp_texturas_hd.scd");
        let started = std::time::Instant::now();
        cp_core::enhance::build(&srcs, &opts2, &dest, &mut |i, n, name| {
            if i % 4 == 0 || i == n {
                let secs = started.elapsed().as_secs_f64();
                let left = if i > 8 { (secs / i as f64 * (n - i) as f64) as u64 } else { 0 };
                let eta = if left > 0 { format!(" (faltam ~{}:{:02})", left / 60, left % 60) } else { String::new() };
                emit_progress(&app, "hd", i, n, format!("{name}{eta}"));
            }
        })
    })
    .await?;
    with_ws(&state.ws, move |ws| {
        let mb = |b: u64| b as f64 / 1_048_576.0;
        let import = ImportOptions {
            id: Some("texturas-hd".into()),
            name: Some(opts.name.clone()),
            version: Some(cp_core::enhance::GENERATOR_VERSION.into()),
            category: Some(Category::Textures),
            description: Some(format!(
                "Remaster {:.0}% (cores, contraste e relevo): {} texturas ampliadas ({}x, até {} px) e {} refeitas no mesmo tamanho, geradas no Estúdio a partir das originais. {:.0} MB → {:.0} MB.{}",
                opts.remaster.clamp(0.0, 1.5) * 100.0,
                res.upscaled,
                opts.scale,
                opts.max_size,
                res.sharpened,
                mb(res.bytes_before),
                mb(res.bytes_after),
                if res.failed.is_empty() { String::new() } else { format!(" {} não puderam ser lidas.", res.failed.len()) }
            )),
            multiplayer: Some(cp_core::manifest::MpPolicy::Local),
            replace: true,
            move_source: true,
            ..Default::default()
        };
        let m = ws.import_mod(&res.archive, &import, enable)?;
        let _ = std::fs::remove_file(&res.archive);
        Ok(m)
    })
    .await
}

// ---------------------------------------------------------------- editor de mapas: decorações e texturas

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MapAssets {
    props: Vec<cp_core::mapassets::PropInfo>,
    layers: Vec<cp_core::mapassets::LayerSet>,
    skies: Vec<cp_core::mapassets::SkyInfo>,
}

/// Decorações e camadas de textura do chão disponíveis no jogo (de todos os mapas).
#[tauri::command]
pub async fn map_assets(state: State<'_, AppState>) -> R<MapAssets> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || {
        Ok(MapAssets {
            props: cp_core::mapassets::props_catalog(&srcs)?,
            layers: cp_core::mapassets::terrain_layers(&srcs)?,
            // céus são opcionais: um mapa com info.win.bdf estranho não impede o editor
            skies: cp_core::mapassets::map_skies(&srcs).unwrap_or_default(),
        })
    })
    .await
}

/// Miniatura de uma textura do jogo pelo caminho que os mapas usam.
#[tauri::command]
pub async fn game_texture(state: State<'_, AppState>, path: String, max: Option<u32>) -> R<String> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || {
        let png = cp_core::mapassets::texture_png(&srcs, &path, max.unwrap_or(128).clamp(16, 1024))?;
        Ok(data_url("image/png", &png))
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropPreview {
    mesh: cp_core::scm::MeshView,
    texture: Option<String>,
    /// posições, normais, uvs (f32) e índices (u32) em base64, little-endian: bem mais leve que
    /// milhares de números em JSON (os vetores de `mesh` vão vazios)
    bin: [String; 4],
}

fn b64_le<T: Copy, const N: usize>(v: &[T], to: fn(T) -> [u8; N]) -> String {
    let mut b = Vec::with_capacity(v.len() * N);
    for x in v {
        b.extend_from_slice(&to(*x));
    }
    base64::engine::general_purpose::STANDARD.encode(b)
}

/// Modelo 3D de uma decoração (para ver antes de colocar no mapa).
#[tauri::command]
pub async fn prop_preview(state: State<'_, AppState>, bp: String, lod: Option<u8>) -> R<PropPreview> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || {
        let (mut mesh, tex) = cp_core::mapassets::prop_preview(&srcs, &bp, lod.unwrap_or(0).min(3))?;
        let bin = [
            b64_le(&std::mem::take(&mut mesh.positions), f32::to_le_bytes),
            b64_le(&std::mem::take(&mut mesh.normals), f32::to_le_bytes),
            b64_le(&std::mem::take(&mut mesh.uvs), f32::to_le_bytes),
            b64_le(&std::mem::take(&mut mesh.indices), u32::to_le_bytes),
        ];
        Ok(PropPreview { mesh, texture: tex.map(|p| data_url("image/png", &p)), bin })
    })
    .await
}

// ---------------------------------------------------------------- menu moderno

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemePreview {
    key: String,
    before: String,
    after: String,
    width: u32,
    height: u32,
}

/// Texturas do menu principal antes e depois do tema, para montar a prévia na interface.
#[tauri::command]
pub async fn menu_theme_preview(
    state: State<'_, AppState>,
    opts: cp_core::menu_theme::ThemeOptions,
) -> R<Vec<ThemePreview>> {
    let srcs = sources(&state.ws).await?;
    off_lock(move || {
        let mut sources: Vec<_> = srcs
            .into_iter()
            .rev()
            .filter_map(|p| cp_core::scd::Scd::open(&p).ok())
            .collect();
        let mut out = Vec::new();
        for rel in cp_core::menu_theme::PREVIEW_KEYS {
            let entry = format!("{}{rel}", cp_core::menu_theme::FRONTEND);
            let Some(data) = sources.iter_mut().find_map(|s| s.read(&entry).ok()) else { continue };
            let key = cp_core::scd::normalize_key(&entry);
            let Some(kind) = cp_core::menu_theme::kind_of(&key) else { continue };
            let (info, img) = dds::decode(&data)?;
            let after = cp_core::menu_theme::theme_image(&img, kind, cp_core::menu_theme::is_hover_state(&key), info.format, &opts);
            out.push(ThemePreview {
                key: rel.to_string(),
                before: data_url("image/png", &dds::to_png(&img)?),
                after: data_url("image/png", &dds::to_png(&after)?),
                width: info.width,
                height: info.height,
            });
        }
        if out.is_empty() {
            return Err(cp_core::Error::Other("as texturas do menu não foram encontradas nos arquivos do jogo".into()));
        }
        Ok(out)
    })
    .await
}

/// Gera o mod "Menu moderno" a partir das texturas e fontes do jogo e coloca na biblioteca.
#[tauri::command]
pub async fn build_menu_theme(
    app: AppHandle,
    state: State<'_, AppState>,
    opts: cp_core::menu_theme::ThemeOptions,
    enable: bool,
) -> R<Manifest> {
    let (srcs, data_dir, fonts) = with_ws(&state.ws, {
        let want_fonts = opts.fonts;
        move |ws| {
            let fonts = if want_fonts { ws.fonts_dir()? } else { PathBuf::new() };
            Ok((ws.stock_sources()?, ws.data_dir.clone(), fonts))
        }
    })
    .await?;
    let opts2 = opts.clone();
    let res = off_lock(move || {
        let dest = data_dir.join("cache").join("theme").join(cp_core::menu_theme::ARCHIVE_NAME);
        cp_core::menu_theme::build(&srcs, &fonts, &opts2, &dest, &mut |i, n, name| {
            if i % 8 == 0 || i == n {
                emit_progress(&app, "theme", i, n, name.to_string());
            }
        })
    })
    .await?;
    with_ws(&state.ws, move |ws| {
        let import = ImportOptions {
            id: Some("menu-moderno".into()),
            name: Some(opts.name.clone()),
            version: Some(cp_core::menu_theme::THEME_VERSION.into()),
            category: Some(Category::Ui),
            description: Some(format!(
                "Menus do jogo no estilo do CommandProject: {} texturas com mais nitidez ({} com as cores novas){}. Gerado no seu computador a partir dos arquivos do jogo.{}",
                res.textures,
                res.recolored,
                if res.fonts > 0 { format!(" e a fonte Roboto em {} arquivo(s)", res.fonts) } else { String::new() },
                if res.failed.is_empty() { String::new() } else { format!(" {} não puderam ser lidos.", res.failed.len()) }
            )),
            multiplayer: Some(cp_core::manifest::MpPolicy::Local),
            replace: true,
            move_source: true,
            ..Default::default()
        };
        let m = ws.import_mod(&res.archive, &import, enable)?;
        let _ = std::fs::remove_file(&res.archive);
        Ok(m)
    })
    .await
}

// ---------------------------------------------------------------- modo 4 GB

#[tauri::command]
pub async fn laa_status(state: State<'_, AppState>) -> R<Option<cp_core::laa::LaaStatus>> {
    with_ws(&state.ws, |ws| match ws.laa() {
        Ok(l) => l.status().map(Some),
        Err(_) => Ok(None),
    })
    .await
}

/// Liga/desliga o modo 4 GB e guarda a preferência (para reaplicar depois de atualizações).
#[tauri::command]
pub async fn laa_set(state: State<'_, AppState>, enabled: bool) -> R<cp_core::laa::LaaStatus> {
    with_ws(&state.ws, move |ws| {
        let l = ws.laa()?;
        let st = if enabled { l.enable()? } else { l.disable()? };
        ws.settings.keep_large_address = enabled;
        ws.settings.memory_limit_mb = Some(if enabled { cp_core::memory::MAX_MB } else { cp_core::memory::MIN_MB });
        ws.save_settings()?;
        Ok(st)
    })
    .await
}

// ---------------------------------------------------------------- atualização do launcher

#[tauri::command]
pub async fn app_update_check() -> R<Option<cp_core::update::AppUpdate>> {
    cp_core::update::check(env!("CARGO_PKG_VERSION")).await.map_err(err)
}

/// Baixa o instalador da versão nova (com progresso e retomada), abre em modo passivo
/// (só a barra de progresso, reabre o launcher no fim) e fecha o launcher para ele trabalhar.
#[tauri::command]
pub async fn app_update_install(
    app: AppHandle,
    state: State<'_, AppState>,
    update: cp_core::update::AppUpdate,
) -> R<()> {
    let dir = with_ws(&state.ws, |ws| Ok(ws.data_dir.join("cache").join("update"))).await?;
    let app2 = app.clone();
    let version = update.version.clone();
    let setup = cp_core::update::download(&update, &dir, &mut move |p| {
        let (step, total) = match p.fraction() {
            Some(f) => ((f * 1000.0) as usize, 1000),
            None => (0, 0),
        };
        emit_progress(&app2, "update", step, total, format!("Baixando a versão {version}: {}", p.describe()));
    })
    .await
    .map_err(err)?;
    emit_progress(&app, "update", 1000, 1000, "Abrindo o instalador");
    #[cfg(windows)]
    {
        std::process::Command::new(&setup)
            .args(["/P", "/R", "/UPDATE"])
            .spawn()
            .map_err(|e| format!("não consegui abrir o instalador: {e}"))?;
        // o instalador espera o launcher fechar
        let app3 = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(600)).await;
            app3.exit(0);
        });
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err(format!("instalador baixado em {}, mas a instalação automática é só no Windows", setup.display()))
    }
}

// ---------------------------------------------------------------- memória do jogo

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStatus {
    system: cp_core::memory::SystemMemory,
    limit_mb: u32,
    recommended_mb: u32,
    choices: Vec<u32>,
    laa: Option<cp_core::laa::LaaStatus>,
}

#[tauri::command]
pub async fn memory_status(state: State<'_, AppState>) -> R<MemoryStatus> {
    with_ws(&state.ws, |ws| {
        let system = cp_core::memory::system_memory();
        Ok(MemoryStatus {
            recommended_mb: cp_core::memory::recommended_mb(system.total_mb),
            system,
            limit_mb: ws.settings.memory_mb(),
            choices: cp_core::memory::CHOICES_MB.to_vec(),
            laa: ws.laa().ok().and_then(|l| l.status().ok()),
        })
    })
    .await
}

/// Define quanta memória o jogo pode usar: 2 GB (original) até 4 GB (máximo de um jogo de 32 bits).
#[tauri::command]
pub async fn memory_set(state: State<'_, AppState>, limit_mb: u32) -> R<MemoryStatus> {
    let ws_arc = state.ws.clone();
    with_ws(&ws_arc, move |ws| {
        if cp_core::game::is_running() {
            return Err(cp_core::Error::Other("feche o jogo para mudar a memória".into()));
        }
        let mb = cp_core::memory::normalize_mb(limit_mb);
        let large = cp_core::memory::needs_large_address(mb);
        let l = ws.laa()?;
        if large { l.enable()? } else { l.disable()? };
        ws.settings.keep_large_address = large;
        ws.settings.memory_limit_mb = Some(mb);
        ws.save_settings()
    })
    .await?;
    memory_status(state).await
}

// ---------------------------------------------------------------- vitrine 3D da tela inicial

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Showcase {
    unit: String,
    mesh: cp_core::scm::MeshView,
    albedo: Option<String>,
    team: Option<String>,
    mask: Option<String>,
    units: Vec<String>,
}

/// Lê da instalação do usuário o modelo 3D de uma unidade e a textura dela (nada é copiado).
/// Sem `unit`, usa a escolha salva ou o Comandante (ACU). `None` se o jogo não tem modelos.
#[tauri::command]
pub async fn showcase(state: State<'_, AppState>, unit: Option<String>) -> R<Option<Showcase>> {
    let found = with_ws(&state.ws, |ws| {
        if ws.game().is_err() {
            return Ok(None);
        }
        Ok(Some((ws.unit_models()?, ws.settings.showcase_unit.clone())))
    })
    .await?;
    let Some((models, saved)) = found else { return Ok(None) };
    off_lock(move || {
        if models.is_empty() {
            return Ok(None);
        }
        let wanted = unit.or(saved).map(|u| u.to_ascii_lowercase());
        let pick = wanted
            .filter(|u| models.contains_key(u))
            .or_else(|| {
                ["uul0001", "ucl0001", "uil0001"]
                    .iter()
                    .map(|s| s.to_string())
                    .find(|u| models.contains_key(u))
            })
            .or_else(|| models.keys().find(|k| k.ends_with("0001")).cloned())
            .or_else(|| models.keys().next().cloned())
            .expect("há modelos");
        let u = &models[&pick];
        let mut scd = cp_core::scd::Scd::open(&u.src)?;
        let mesh = cp_core::scm::view(&cp_core::scm::read(&scd.read(&u.scm)?)?);
        // texturas em PNG, reduzidas: a vitrine não precisa de 1024 px
        let mut png = |name: &Option<String>| -> Option<String> {
            let d = scd.read(name.as_ref()?).ok()?;
            let (_, mut img) = dds::decode(&d).ok()?;
            while img.width > 512 {
                img = dds::downsample(&img);
            }
            dds::to_png(&img).ok().map(|p| data_url("image/png", &p))
        };
        let albedo = png(&u.albedo);
        let team = png(&u.team);
        let mask = png(&u.mask);
        Ok(Some(Showcase {
            unit: pick,
            mesh,
            albedo,
            team,
            mask,
            units: models.keys().cloned().collect(),
        }))
    })
    .await
}

// ---------------------------------------------------------------- exportar arquivos de um mod

/// Copia os arquivos (`.scd`) de um mod da biblioteca para uma pasta escolhida.
#[tauri::command]
pub async fn mod_export_files(state: State<'_, AppState>, id: String, dir: String, overwrite: Option<bool>) -> R<Vec<String>> {
    with_ws(&state.ws, move |ws| {
        let m = ws
            .mods()?
            .into_iter()
            .find(|m| m.manifest.id == id)
            .ok_or_else(|| cp_core::Error::ModNotFound(id.clone()))?;
        let dest = PathBuf::from(&dir);
        std::fs::create_dir_all(&dest).map_err(|e| cp_core::Error::io(&dest, e))?;
        // não sobrescreve sem confirmação: a tela pergunta e chama de novo com overwrite
        let existing: Vec<&str> = m.manifest.files.iter().filter(|f| dest.join(&f.name).exists()).map(|f| f.name.as_str()).collect();
        if !existing.is_empty() && !overwrite.unwrap_or(false) {
            return Err(cp_core::Error::Other(format!("EXISTE: {}", existing.join(", "))));
        }
        let mut out = Vec::new();
        for f in &m.manifest.files {
            let src = m.file_path(&f.name);
            let to = dest.join(&f.name);
            std::fs::copy(&src, &to).map_err(|e| cp_core::Error::io(&src, e))?;
            out.push(to.display().to_string());
        }
        Ok(out)
    })
    .await
}


// ---------------------------------------------------------------- mods só pelo launcher

/// Há mods do launcher (ou o Proxima) na pasta do jogo agora?
fn deployed(ws: &Workspace) -> bool {
    ws.proxima().is_ok_and(|p| p.is_active())
        || std::fs::read(ws.data_dir.join("deploy").join("journal.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<cp_core::deploy::Journal>(&b).ok())
        .is_some_and(|j| !j.entries.is_empty())
}

/// Com "mods só pelo launcher": se o jogo não está aberto e ficaram mods na pasta (o launcher fechou
/// no meio, ou o perfil foi aplicado sem jogar), devolve a pasta ao original. `true` = limpou.
#[tauri::command]
pub async fn ensure_vanilla(app: AppHandle, state: State<'_, AppState>) -> R<bool> {
    let running = tauri::async_runtime::spawn_blocking(cp_core::game::is_running).await.unwrap_or(true);
    if running {
        return Ok(false);
    }
    with_ws(&state.ws, move |ws| {
        if !ws.settings.mods_only_launcher || !deployed(ws) {
            return Ok(false);
        }
        ws.purge(&mut |p: Progress| emit_progress(&app, "purge", p.step, p.total, p.message))?;
        Ok(true)
    })
    .await
}

/// Ao fechar o launcher: com o jogo aberto, o launcher some da tela e espera o jogo fechar para
/// tirar os mods; sem o jogo aberto, tira na hora. `true` = pode fechar já.
pub(crate) fn on_close(app: &AppHandle) -> bool {
    use tauri::Manager;
    let Some(state) = app.try_state::<AppState>() else { return true };
    let ws = state.ws.clone();
    let wants = {
        let g = ws.lock().unwrap_or_else(|p| p.into_inner());
        g.settings.mods_only_launcher && deployed(&g)
    };
    if !wants {
        return true;
    }
    if !cp_core::game::is_running() {
        let mut g = ws.lock().unwrap_or_else(|p| p.into_inner());
        let _ = g.purge(&mut |_| {});
        return true;
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.hide();
    }
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(4)).await;
            if !tauri::async_runtime::spawn_blocking(cp_core::game::is_running).await.unwrap_or(true) {
                break;
            }
        }
        {
            let mut g = ws.lock().unwrap_or_else(|p| p.into_inner());
            let _ = g.purge(&mut |_| {});
        }
        app2.exit(0);
    });
    false
}

// ===================================================================== jogar por IP (SC2-Proxima)

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpPlay {
    name: String,
    port: u16,
}

#[tauri::command]
pub async fn proxima_status(state: State<'_, AppState>) -> R<cp_core::proxima::Status> {
    with_ws(&state.ws, |ws| Ok(ws.proxima()?.status())).await
}

/// Baixa o lançamento oficial mais recente do SC2-Proxima (GitHub) para a pasta de dados.
#[tauri::command]
pub async fn proxima_download(state: State<'_, AppState>) -> R<cp_core::proxima::Status> {
    #[derive(Deserialize)]
    struct Asset {
        name: String,
        browser_download_url: String,
    }
    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
        assets: Vec<Asset>,
    }
    let client = reqwest::Client::builder()
        .user_agent(concat!("CommandProject/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(err)?;
    let url = format!("https://api.github.com/repos/{}/releases/latest", cp_core::proxima::REPO);
    let rel: Release = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("não consegui falar com o GitHub: {e}"))?
        .json()
        .await
        .map_err(err)?;
    let names: Vec<String> = rel.assets.iter().map(|a| a.name.clone()).collect();
    let name = cp_core::proxima::pick_asset(&names)
        .ok_or_else(|| format!("o lançamento {} do Proxima não tem o steam_api.dll", rel.tag_name))?
        .clone();
    let asset = rel.assets.iter().find(|a| a.name == name).ok_or("arquivo do lançamento sumiu")?;
    let bytes = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("download do Proxima falhou: {e}"))?
        .bytes()
        .await
        .map_err(err)?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("arquivo do Proxima grande demais".into());
    }
    with_ws(&state.ws, move |ws| {
        let p = ws.proxima()?;
        p.store_download(&name, &bytes, &rel.tag_name)?;
        Ok(p.status())
    })
    .await
}

/// Abre o jogo com o Proxima (hospedar ou entrar por IP). O original volta quando o jogo fecha.
#[tauri::command]
pub async fn launch_ip(app: AppHandle, state: State<'_, AppState>, name: String, port: u16) -> R<LaunchResult> {
    let name = cp_core::proxima::clean_name(&name);
    if port < 1024 {
        return Err("porta inválida (use de 1024 a 65535)".into());
    }
    launch_inner(app, state, None, Some(IpPlay { name, port })).await
}

/// Confere um endereço digitado ("IP" ou "IP:porta") e devolve como o jogo entende.
#[tauri::command]
pub fn proxima_address(input: String) -> R<String> {
    let (host, port) = cp_core::proxima::parse_address(&input).ok_or("endereço inválido: use IP ou IP:porta")?;
    Ok(if port == cp_core::proxima::DEFAULT_PORT { host } else { format!("{host}:{port}") })
}
