//! Comandos do Otimizador (aba Desempenho): opções do jogo com backup, perfis, travamentos,
//! versão do jogo, prioridade e medição do processo. Nada aqui altera arquivos do jogo sem cópia.

use crate::commands::{err, off_lock, with_ws, R};
use crate::AppState;
use cp_core::perf::{self, Backup, CrashDump, PrefProfile, PrefValue, PrefsInfo, ProcessStats, WriteReport};
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

struct Dirs {
    data: PathBuf,
    bin: Option<PathBuf>,
    exe: Option<PathBuf>,
    priority: String,
    mods_enabled: usize,
}

async fn dirs(state: &State<'_, AppState>) -> R<Dirs> {
    with_ws(&state.ws, |ws| {
        let active = ws.profiles.active().clone();
        Ok(Dirs {
            data: ws.data_dir.clone(),
            bin: ws.game_bin_dir().ok(),
            exe: ws.game().ok().and_then(|g| g.exe.clone()),
            priority: ws.settings.game_priority.clone(),
            mods_enabled: active.mods.iter().filter(|m| m.enabled).count(),
        })
    })
    .await
}

fn backups_dir(d: &Dirs) -> PathBuf {
    d.data.join("perf").join("backups")
}
fn profiles_dir(d: &Dirs) -> PathBuf {
    d.data.join("perf").join("profiles")
}
fn prefs() -> R<PathBuf> {
    perf::prefs_path().ok_or_else(|| "não achei a pasta de opções do jogo (só existe no Windows)".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfReport {
    prefs: Option<PrefsInfo>,
    backups: Vec<Backup>,
    profiles: Vec<PrefProfile>,
    dumps: Vec<CrashDump>,
    version: Option<String>,
    latest: Option<bool>,
    known_latest: &'static str,
    exe: Option<PathBuf>,
    priority: String,
    priorities: Vec<&'static str>,
    mods_enabled: usize,
}

#[tauri::command]
pub async fn perf_report(state: State<'_, AppState>) -> R<PerfReport> {
    let d = dirs(&state).await?;
    off_lock(move || {
        let version = d.exe.as_ref().and_then(|e| std::fs::read(e).ok()).and_then(|b| perf::file_version(&b));
        Ok(PerfReport {
            prefs: perf::prefs_path().map(|p| perf::read_prefs(&p)),
            backups: perf::list_backups(&backups_dir(&d)),
            profiles: perf::list_profiles(&profiles_dir(&d)),
            dumps: d.bin.as_deref().map(perf::list_dumps).unwrap_or_default(),
            latest: version.as_deref().and_then(perf::is_latest),
            version,
            known_latest: perf::KNOWN_LATEST,
            exe: d.exe.clone(),
            priority: d.priority.clone(),
            priorities: perf::PRIORITIES.to_vec(),
            mods_enabled: d.mods_enabled,
        })
    })
    .await
}

#[tauri::command]
pub async fn perf_process() -> R<Option<ProcessStats>> {
    off_lock(|| Ok(perf::game_process())).await
}

#[tauri::command]
pub async fn perf_prefs_set(state: State<'_, AppState>, changes: Vec<(String, PrefValue)>) -> R<WriteReport> {
    let d = dirs(&state).await?;
    let p = prefs()?;
    off_lock(move || perf::write_prefs(&p, &backups_dir(&d), &changes)).await
}

#[tauri::command]
pub async fn perf_backup_restore(state: State<'_, AppState>, name: String) -> R<()> {
    let d = dirs(&state).await?;
    let p = prefs()?;
    off_lock(move || perf::restore_backup(&p, &backups_dir(&d), &name)).await
}

#[tauri::command]
pub async fn perf_backup_now(state: State<'_, AppState>) -> R<String> {
    let d = dirs(&state).await?;
    let p = prefs()?;
    off_lock(move || perf::backup_prefs(&p, &backups_dir(&d))).await
}

#[tauri::command]
pub async fn perf_profile_save(state: State<'_, AppState>, name: String, description: String) -> R<PrefProfile> {
    let d = dirs(&state).await?;
    let p = prefs()?;
    off_lock(move || perf::save_profile(&profiles_dir(&d), &p, &name, &description)).await
}

#[tauri::command]
pub async fn perf_profile_apply(state: State<'_, AppState>, id: String) -> R<WriteReport> {
    let d = dirs(&state).await?;
    let p = prefs()?;
    off_lock(move || perf::apply_profile(&profiles_dir(&d), &p, &backups_dir(&d), &id)).await
}

#[tauri::command]
pub async fn perf_profile_delete(state: State<'_, AppState>, id: String) -> R<()> {
    let d = dirs(&state).await?;
    off_lock(move || perf::delete_profile(&profiles_dir(&d), &id)).await
}

#[tauri::command]
pub async fn perf_dumps_delete(state: State<'_, AppState>, names: Vec<String>) -> R<usize> {
    let d = dirs(&state).await?;
    let bin = d.bin.clone().ok_or_else(|| "jogo não encontrado".to_string())?;
    off_lock(move || perf::delete_dumps(&bin, &names)).await
}

#[tauri::command]
pub async fn perf_set_priority(state: State<'_, AppState>, level: String) -> R<String> {
    if !perf::PRIORITIES.contains(&level.as_str()) {
        return Err(err("prioridade inválida"));
    }
    with_ws(&state.ws, move |ws| {
        ws.settings.game_priority = level.clone();
        ws.save_settings()?;
        Ok(level)
    })
    .await
}
