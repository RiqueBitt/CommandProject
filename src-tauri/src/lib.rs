//! App desktop (Tauri 2). Toda a lógica está no `cp-core`; aqui ficam só os comandos
//! que a interface chama, os eventos de progresso e a integração com o sistema.

mod commands;
mod creator_cmds;
mod files_cmds;
mod forja_cmds;
mod startscreen_cmds;
mod party;
mod perf_cmds;

use cp_core::hub::HubIndex;
use cp_core::workspace::{default_data_dir, Workspace};
use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub ws: Arc<Mutex<Workspace>>,
    pub hubs: Arc<Mutex<Vec<HubIndex>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let resources = app.path().resource_dir().ok();
            // em desenvolvimento os recursos ficam na raiz do repositório
            let resources = resources
                .filter(|r| r.join("maptk").join("maptk_bridge.py").is_file())
                .or_else(|| {
                    let dev = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../resources");
                    dev.join("maptk").is_dir().then_some(dev)
                });
            let ws = Workspace::open(&default_data_dir(), resources).map_err(|e| e.to_string())?;
            app.manage(AppState {
                ws: Arc::new(Mutex::new(ws)),
                hubs: Arc::new(Mutex::new(vec![])),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // mods só pelo launcher: ao fechar, a pasta do jogo volta ao original (com o jogo aberto,
            // o launcher espera ele fechar escondido)
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if !commands::on_close(window.app_handle()) {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::minigame_records,
            commands::ensure_vanilla,
            commands::proxima_status,
            commands::proxima_download,
            commands::launch_ip,
            commands::proxima_address,
            commands::mod_export_files,
            perf_cmds::perf_report,
            perf_cmds::perf_process,
            perf_cmds::perf_prefs_set,
            perf_cmds::perf_backup_restore,
            perf_cmds::perf_backup_now,
            perf_cmds::perf_profile_save,
            perf_cmds::perf_profile_apply,
            perf_cmds::perf_profile_delete,
            perf_cmds::perf_dumps_delete,
            perf_cmds::perf_set_priority,
            creator_cmds::creations_list,
            creator_cmds::unit_packs,
            creator_cmds::unit_mix_preview,
            creator_cmds::export_data,
            files_cmds::storage_report,
            files_cmds::backups_list,
            files_cmds::backup_create,
            files_cmds::backup_inspect,
            files_cmds::backup_restore,
            files_cmds::backup_auto,
            files_cmds::trash_list,
            files_cmds::trash_restore,
            creator_cmds::unit_validate,
            creator_cmds::unit_refs_check,
            creator_cmds::unit_catalog,
            creator_cmds::unit_details,
            creator_cmds::unit_animations,
            creator_cmds::unit_preview,
            creator_cmds::anim_read,
            creator_cmds::unit_build,
            creator_cmds::unit_blueprint_preview,
            creator_cmds::anim_create,
            creator_cmds::model_prepare,
            creator_cmds::model_baked,
            creator_cmds::model_export_game,
            creator_cmds::creation_create,
            creator_cmds::creation_load,
            creator_cmds::creation_save,
            creator_cmds::creation_autosave,
            creator_cmds::creation_recovery,
            creator_cmds::creation_discard_recovery,
            creator_cmds::creation_versions,
            creator_cmds::creation_restore,
            creator_cmds::creation_version,
            creator_cmds::creation_update,
            creator_cmds::creation_set_thumb,
            creator_cmds::creation_thumb,
            creator_cmds::creation_duplicate,
            creator_cmds::creation_delete,
            creator_cmds::creation_asset_put,
            creator_cmds::creation_asset,
            creator_cmds::creation_asset_copy,
            creator_cmds::creation_assets,
            creator_cmds::creation_export,
            creator_cmds::creation_import,
            commands::app_info,
            commands::recover,
            commands::dashboard,
            commands::set_game_path,
            commands::get_settings,
            commands::save_settings,
            commands::list_mods,
            commands::import_mod,
            commands::remove_mod,
            commands::update_mod_meta,
            commands::verify_mod,
            commands::get_profiles,
            commands::create_profile,
            commands::rename_profile,
            commands::delete_profile,
            commands::set_active_profile,
            commands::set_mod_enabled,
            commands::reorder_mods,
            commands::plan_active,
            commands::apply_active,
            commands::purge,
            commands::file_status,
            commands::set_baseline_kind,
            commands::adopt_unmanaged,
            commands::conflicts,
            commands::launch_game,
            commands::big_match_maps,
            commands::big_match_preview,
            commands::kill_game,
            commands::launch_big_match,
            party::party_routes,
            party::party_public_ip,
            party::party_host,
            party::party_stop,
            party::party_read,
            party::party_prepare,
            party::party_leave,
            commands::fingerprint,
            commands::export_sync_code,
            commands::inspect_sync_code,
            commands::apply_sync_code,
            commands::hub_fetch,
            commands::hub_install,
            commands::hub_updates,
            commands::archives,
            commands::archive_entries,
            commands::read_entry,
            commands::preview_texture,
            commands::preview_model,
            commands::export_entry,
            commands::list_projects,
            commands::create_project,
            commands::save_project,
            commands::delete_project,
            commands::project_files,
            commands::project_read_text,
            commands::project_write_text,
            commands::project_override,
            commands::project_texture,
            commands::project_import_png,
            commands::project_model,
            commands::project_save_painted,
            commands::install_from_url,
            commands::project_import_obj,
            commands::project_delete_file,
            commands::project_export,
            commands::project_adjust_texture,
            commands::build_project,
            commands::export_project_package,
            commands::ui_skin_targets,
            commands::ui_skin_preview,
            commands::build_ui_skin,
            commands::build_cheats,
            forja_cmds::forja_overview,
            startscreen_cmds::start_screen_get,
            startscreen_cmds::start_screen_save,
            startscreen_cmds::start_screen_logo,
            startscreen_cmds::start_screen_video,
            startscreen_cmds::start_screen_get_ffmpeg,
            startscreen_cmds::start_screen_add_shortcut,
            startscreen_cmds::start_screen_remove_shortcut,
            forja_cmds::forja_set_option,
            forja_cmds::forja_reset_options,
            forja_cmds::forja_set_key,
            forja_cmds::forja_new_mod,
            forja_cmds::forja_check,
            forja_cmds::forja_dev_mods,
            forja_cmds::forja_read_file,
            forja_cmds::forja_write_file,
            forja_cmds::forja_templates,
            forja_cmds::forja_pack,
            forja_cmds::forja_game_errors,
            commands::build_optimize,
            commands::build_first_person,
            commands::optimize_status,
            commands::optimize_undo_windows,
            commands::build_ai,
            commands::ai_memory,
            commands::enhance_groups,
            commands::enhance_preview,
            commands::build_enhance,
            commands::showcase,
            commands::laa_status,
            commands::laa_set,
            commands::shaders_status,
            commands::shaders_apply,
            commands::shaders_reset,
            commands::shaders_remove,
            commands::shaders_install_reshade,
            commands::maptk_status,
            commands::maptk_run,
            commands::maptk_build,
            commands::maptk_terrain3d,
            commands::menu_theme_preview,
            commands::build_menu_theme,
            commands::memory_status,
            commands::map_assets,
            commands::game_texture,
            commands::prop_preview,
            commands::memory_set,
            commands::app_update_check,
            commands::app_update_install,
            commands::open_path,
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o CommandProject");
}
