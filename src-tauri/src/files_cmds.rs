//! Gerenciamento local de arquivos: espaço em disco, cópias de segurança, lixeira de projetos.
//! Tudo fica na pasta de dados do launcher, no próprio computador.

use crate::commands::{err, off_lock, with_ws, R};
use crate::AppState;
use cp_core::backup::{self, BackupEntry, RestoreReport, StorageItem};
use cp_core::creator::{Creations, Meta, TrashItem};
use std::path::PathBuf;
use tauri::State;

async fn data_dir(state: &State<'_, AppState>) -> R<PathBuf> {
    with_ws(&state.ws, |ws| Ok(ws.data_dir.clone())).await
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageReport {
    data_dir: PathBuf,
    items: Vec<StorageItem>,
    total: u64,
}

#[tauri::command]
pub async fn storage_report(state: State<'_, AppState>) -> R<StorageReport> {
    let dir = data_dir(&state).await?;
    off_lock(move || {
        let items = backup::storage(&dir);
        let total = items.iter().map(|i| i.bytes).sum();
        Ok(StorageReport { data_dir: dir, items, total })
    })
    .await
}

#[tauri::command]
pub async fn backups_list(state: State<'_, AppState>) -> R<Vec<BackupEntry>> {
    let dir = data_dir(&state).await?;
    off_lock(move || Ok(backup::list(&dir))).await
}

/// Cria uma cópia de segurança. Sem `dest`, vai para a pasta de cópias do launcher.
/// Com `dest`, não sobrescreve um arquivo que já existe (a tela pergunta antes e manda `overwrite`).
#[tauri::command]
pub async fn backup_create(state: State<'_, AppState>, dest: Option<String>, overwrite: bool) -> R<BackupEntry> {
    let dir = data_dir(&state).await?;
    let path = match dest.map(|d| PathBuf::from(d.trim())) {
        Some(p) => {
            if p.exists() && !overwrite {
                return Err("EXISTE".into());
            }
            p
        }
        None => backup::manual_path(&dir),
    };
    off_lock(move || backup::create(&dir, &path)).await
}

#[tauri::command]
pub async fn backup_inspect(path: String) -> R<BackupEntry> {
    off_lock(move || backup::inspect(&PathBuf::from(path))).await
}

/// Restaura projetos de uma cópia como projetos novos (nunca sobrescreve).
#[tauri::command]
pub async fn backup_restore(state: State<'_, AppState>, path: String, only: Vec<String>) -> R<RestoreReport> {
    let dir = data_dir(&state).await?;
    off_lock(move || backup::restore(&dir, &PathBuf::from(path), &only)).await
}

/// Cópia automática ao abrir o launcher (de tempos em tempos, conforme as configurações).
#[tauri::command]
pub async fn backup_auto(state: State<'_, AppState>) -> R<Option<BackupEntry>> {
    let (dir, days) = with_ws(&state.ws, |ws| Ok((ws.data_dir.clone(), ws.settings.auto_backup_days))).await?;
    off_lock(move || backup::auto(&dir, days, 5)).await
}

#[tauri::command]
pub async fn trash_list(state: State<'_, AppState>) -> R<Vec<TrashItem>> {
    let dir = data_dir(&state).await?;
    let c = Creations::open(&dir).map_err(err)?;
    Ok(c.trash_list())
}

#[tauri::command]
pub async fn trash_restore(state: State<'_, AppState>, entry: String) -> R<Meta> {
    let dir = data_dir(&state).await?;
    off_lock(move || Creations::open(&dir)?.trash_restore(&entry)).await
}
