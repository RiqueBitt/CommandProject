//! Tela "Tela inicial nova": opções, logo e vídeo de fundo do jogador (o vídeo é convertido para o
//! formato do jogo com o ffmpeg, que o launcher baixa se não houver um no computador).

use crate::commands::{data_url, emit_progress, err, off_lock, with_ws, R};
use crate::AppState;
use cp_core::startscreen::{self as ss, Settings};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartScreenView {
    pub settings: Settings,
    /// o logo escolhido, já sem o fundo (PNG em data URL)
    pub logo: Option<String>,
    pub video: Option<VideoInfo>,
    /// ffmpeg encontrado (para converter vídeos)
    pub ffmpeg: Option<String>,
    /// o mod montado está no perfil ativo
    pub active: bool,
}

fn ffmpeg_path(data_dir: &Path) -> Option<PathBuf> {
    let local = data_dir.join("tools").join(if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" });
    if local.is_file() {
        return Some(local);
    }
    let mut cmd = std::process::Command::new("ffmpeg");
    cmd.arg("-version").stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }
    cmd.status().ok().filter(|s| s.success()).map(|_| PathBuf::from("ffmpeg"))
}

fn view(ws: &mut cp_core::workspace::Workspace) -> cp_core::Result<StartScreenView> {
    let settings = Settings::load(&ws.data_dir);
    let logo_path = Settings::logo_path(&ws.data_dir);
    let logo = std::fs::read(&logo_path)
        .ok()
        .and_then(|b| ss::prepare_logo(&b).ok())
        .and_then(|img| cp_core::dds::to_png(&img).ok())
        .map(|png| data_url("image/png", &png));
    let vp = Settings::video_path(&ws.data_dir);
    let video = std::fs::metadata(&vp).ok().map(|m| VideoInfo { name: settings.video_name.clone(), size: m.len() });
    let active = ws.profiles.active().mods.iter().any(|m| m.id == ss::MOD_ID && m.enabled);
    Ok(StartScreenView { ffmpeg: ffmpeg_path(&ws.data_dir).map(|p| p.to_string_lossy().into_owned()), settings, logo, video, active })
}

#[tauri::command]
pub async fn start_screen_get(state: State<'_, AppState>) -> R<StartScreenView> {
    with_ws(&state.ws, view).await
}

/// Guarda as opções (valem no próximo "aplicar" ou jogar).
#[tauri::command]
pub async fn start_screen_save(state: State<'_, AppState>, settings: Settings) -> R<StartScreenView> {
    with_ws(&state.ws, move |ws| {
        if cp_core::menu_theme::parse_hex(&settings.accent).is_none() {
            return Err(cp_core::Error::Other(format!("cor inválida: {}", settings.accent)));
        }
        let mut s = settings;
        s.news_title = s.news_title.chars().take(60).collect();
        s.news_text = s.news_text.chars().take(90).collect();
        s.custom_logo &= Settings::logo_path(&ws.data_dir).is_file();
        s.custom_video &= Settings::video_path(&ws.data_dir).is_file();
        s.save(&ws.data_dir)?;
        view(ws)
    })
    .await
}

/// Salva uma partida grande como botão no submenu da Escaramuça do jogo.
#[tauri::command]
pub async fn start_screen_add_shortcut(state: State<'_, AppState>, label: String, spec: cp_core::bigmatch::BigMatch) -> R<StartScreenView> {
    with_ws(&state.ws, move |ws| {
        let mut s = Settings::load(&ws.data_dir);
        if s.shortcuts.len() >= ss::MAX_SHORTCUTS {
            return Err(cp_core::Error::Other(format!("no máximo {} atalhos: tire um na tela Recursos (Tela inicial nova)", ss::MAX_SHORTCUTS)));
        }
        let mut spec = spec;
        spec.net = None;
        let sc = ss::Shortcut { label: label.trim().to_uppercase().chars().take(40).collect(), map: spec.map.trim().to_string(), spec: cp_core::bigmatch::encode(&spec)? };
        sc.lua()?;
        s.shortcuts.push(sc);
        s.save(&ws.data_dir)?;
        view(ws)
    })
    .await
}

/// Tira um atalho.
#[tauri::command]
pub async fn start_screen_remove_shortcut(state: State<'_, AppState>, index: usize) -> R<StartScreenView> {
    with_ws(&state.ws, move |ws| {
        let mut s = Settings::load(&ws.data_dir);
        if index < s.shortcuts.len() {
            s.shortcuts.remove(index);
        }
        s.save(&ws.data_dir)?;
        view(ws)
    })
    .await
}

/// Escolhe (ou tira, com `path` nulo) o logo do jogador.
#[tauri::command]
pub async fn start_screen_logo(state: State<'_, AppState>, path: Option<String>) -> R<StartScreenView> {
    with_ws(&state.ws, move |ws| {
        let dest = Settings::logo_path(&ws.data_dir);
        let mut s = Settings::load(&ws.data_dir);
        match path {
            Some(p) => {
                let data = std::fs::read(&p).map_err(|e| cp_core::Error::io(&p, e))?;
                ss::prepare_logo(&data)?; // confere antes de guardar
                if let Some(dir) = dest.parent() {
                    std::fs::create_dir_all(dir).map_err(|e| cp_core::Error::io(dir, e))?;
                }
                std::fs::write(&dest, &data).map_err(|e| cp_core::Error::io(&dest, e))?;
                s.custom_logo = true;
            }
            None => {
                let _ = std::fs::remove_file(&dest);
                s.custom_logo = false;
            }
        }
        s.save(&ws.data_dir)?;
        view(ws)
    })
    .await
}

/// Escolhe (ou tira) o vídeo de fundo: um `.usm` pronto ou qualquer vídeo, convertido com o ffmpeg.
#[tauri::command]
pub async fn start_screen_video(app: AppHandle, state: State<'_, AppState>, path: Option<String>, fps: Option<u32>) -> R<StartScreenView> {
    let data_dir = with_ws(&state.ws, |ws| Ok(ws.data_dir.clone())).await?;
    let dest = Settings::video_path(&data_dir);
    if let Some(p) = &path {
        let src = PathBuf::from(p);
        let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let is_usm = src.extension().is_some_and(|e| e.eq_ignore_ascii_case("usm"));
        let ffmpeg = if is_usm { None } else { Some(ffmpeg_path(&data_dir).ok_or("ffmpeg_missing")?) };
        let app2 = app.clone();
        off_lock(move || {
            if let Some(dir) = dest.parent() {
                std::fs::create_dir_all(dir).map_err(|e| cp_core::Error::io(dir, e))?;
            }
            if let Some(ffmpeg) = ffmpeg {
                emit_progress(&app2, "startvideo", 1, 3, "Convertendo o vídeo (MPEG-1 1080p)…");
                let tmp = dest.with_extension("m1v");
                cp_core::usm::encode(&ffmpeg, &src, &tmp, fps.unwrap_or(60))?;
                emit_progress(&app2, "startvideo", 2, 3, "Montando o vídeo no formato do jogo…");
                let es = std::fs::read(&tmp).map_err(|e| cp_core::Error::io(&tmp, e))?;
                let fps = if fps.unwrap_or(60) >= 50 { 60 } else { 30 };
                let usm = cp_core::usm::mux(&es, fps, "FMV_FRONTEND.win.usm")?;
                let _ = std::fs::remove_file(&tmp);
                cp_core::fsutil::write_atomic(&dest, &usm)?;
            } else {
                let data = std::fs::read(&src).map_err(|e| cp_core::Error::io(&src, e))?;
                if !data.starts_with(b"CRID") {
                    return Err(cp_core::Error::Format("isso não é um vídeo .usm do jogo".into()));
                }
                cp_core::fsutil::write_atomic(&dest, &data)?;
            }
            emit_progress(&app2, "startvideo", 3, 3, "Pronto");
            Ok(())
        })
        .await?;
        with_ws(&state.ws, move |ws| {
            let mut s = Settings::load(&ws.data_dir);
            s.custom_video = true;
            s.video_name = name;
            s.save(&ws.data_dir)?;
            view(ws)
        })
        .await
    } else {
        with_ws(&state.ws, move |ws| {
            let _ = std::fs::remove_file(Settings::video_path(&ws.data_dir));
            let mut s = Settings::load(&ws.data_dir);
            s.custom_video = false;
            s.video_name.clear();
            s.save(&ws.data_dir)?;
            view(ws)
        })
        .await
    }
}

/// Baixa o ffmpeg (compilação para Windows do BtbN, no GitHub) para a pasta do launcher.
#[tauri::command]
pub async fn start_screen_get_ffmpeg(app: AppHandle, state: State<'_, AppState>) -> R<StartScreenView> {
    #[derive(serde::Deserialize)]
    struct Asset {
        name: String,
        browser_download_url: String,
    }
    #[derive(serde::Deserialize)]
    struct Release {
        assets: Vec<Asset>,
    }
    let data_dir = with_ws(&state.ws, |ws| Ok(ws.data_dir.clone())).await?;
    let client = reqwest::Client::builder()
        .user_agent(concat!("CommandProject/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(err)?;
    let rel: Release = client
        .get("https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("não consegui falar com o GitHub: {e}"))?
        .json()
        .await
        .map_err(err)?;
    let asset = rel
        .assets
        .iter()
        .find(|a| a.name.contains("win64-gpl") && a.name.ends_with(".zip") && !a.name.contains("shared"))
        .ok_or("não achei o ffmpeg para Windows no lançamento")?;
    let mut resp = client.get(&asset.browser_download_url).send().await.and_then(|r| r.error_for_status()).map_err(|e| format!("download do ffmpeg falhou: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    let tools = data_dir.join("tools");
    std::fs::create_dir_all(&tools).map_err(err)?;
    let zip_path = tools.join("ffmpeg-download.zip");
    let mut file = std::fs::File::create(&zip_path).map_err(err)?;
    let mut got: u64 = 0;
    let mut last = 0u64;
    use std::io::Write;
    while let Some(chunk) = resp.chunk().await.map_err(err)? {
        file.write_all(&chunk).map_err(err)?;
        got += chunk.len() as u64;
        if got - last > 2_000_000 {
            last = got;
            emit_progress(&app, "ffmpeg", (got / 1_000_000) as usize, (total / 1_000_000).max(1) as usize, format!("Baixando o ffmpeg… {} MB", got / 1_000_000));
        }
    }
    drop(file);
    off_lock(move || {
        let f = std::fs::File::open(&zip_path).map_err(|e| cp_core::Error::io(&zip_path, e))?;
        let mut z = zip::ZipArchive::new(f).map_err(|e| cp_core::Error::archive(&zip_path, e))?;
        let idx = (0..z.len())
            .find(|&i| z.by_index(i).ok().and_then(|e| e.name().ok().map(|n| n.ends_with("bin/ffmpeg.exe"))).unwrap_or(false))
            .ok_or_else(|| cp_core::Error::Other("o pacote do ffmpeg não tem o ffmpeg.exe".into()))?;
        let mut e = z.by_index(idx).map_err(|e| cp_core::Error::archive(&zip_path, e))?;
        let out = tools.join("ffmpeg.exe");
        let mut w = std::fs::File::create(&out).map_err(|e| cp_core::Error::io(&out, e))?;
        std::io::copy(&mut e, &mut w).map_err(|e| cp_core::Error::io(&out, e))?;
        drop(w);
        let _ = std::fs::remove_file(&zip_path);
        Ok(())
    })
    .await?;
    with_ws(&state.ws, view).await
}
