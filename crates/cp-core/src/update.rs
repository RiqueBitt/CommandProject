//! Atualização do próprio launcher: consulta o último release no GitHub, escolhe o instalador
//! do Windows e baixa com retomada e conferência do SHA-256 publicado pelo GitHub.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};
use crate::manifest::compare_versions;

pub const REPO: &str = "RiqueBitt/CommandProject";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdate {
    pub version: String,
    pub notes: String,
    /// Página do release (para quem preferir baixar pelo navegador).
    pub url: String,
    pub asset_name: Option<String>,
    pub asset_url: Option<String>,
    pub size: u64,
    /// SHA-256 informado pelo GitHub (`digest`), quando houver.
    pub sha256: Option<String>,
}

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    digest: Option<String>,
}

/// Interpreta a resposta da API de releases; `None` se não há versão mais nova.
pub fn parse_release(json: &str, current: &str) -> Result<Option<AppUpdate>> {
    let r: Release = serde_json::from_str(json).map_err(|e| Error::Network(format!("resposta inesperada do GitHub: {e}")))?;
    let version = r.tag_name.trim_start_matches(['v', 'V']).to_string();
    if r.draft || r.prerelease || compare_versions(&version, current) != std::cmp::Ordering::Greater {
        return Ok(None);
    }
    let asset = r
        .assets
        .iter()
        .find(|a| a.name.ends_with("_x64-setup.exe"))
        .or_else(|| r.assets.iter().find(|a| a.name.to_ascii_lowercase().ends_with("-setup.exe")));
    Ok(Some(AppUpdate {
        version,
        notes: r.body.unwrap_or_default().chars().take(1500).collect(),
        url: r.html_url,
        asset_name: asset.map(|a| a.name.clone()),
        asset_url: asset.map(|a| a.browser_download_url.clone()),
        size: asset.map(|a| a.size).unwrap_or(0),
        sha256: asset
            .and_then(|a| a.digest.as_deref())
            .and_then(|d| d.strip_prefix("sha256:"))
            .map(|h| h.to_ascii_lowercase()),
    }))
}

/// Consulta o último release publicado.
pub async fn check(current: &str) -> Result<Option<AppUpdate>> {
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let resp = crate::net::client()?
        .get(&url)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(12))
        .send()
        .await
        .map_err(|e| Error::Network(format!("não consegui consultar o GitHub: {e}")))?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !resp.status().is_success() {
        return Err(Error::Network(format!("o GitHub respondeu {}", resp.status())));
    }
    let text = resp.text().await.map_err(|e| Error::Network(e.to_string()))?;
    parse_release(&text, current)
}

/// Baixa o instalador da atualização para `dir` e devolve o caminho.
pub async fn download(
    up: &AppUpdate,
    dir: &Path,
    progress: &mut (dyn FnMut(crate::net::Progress) + Send),
) -> Result<PathBuf> {
    let (Some(url), Some(name)) = (&up.asset_url, &up.asset_name) else {
        return Err(Error::Other("este release não tem instalador para Windows".into()));
    };
    if !url.starts_with("https://github.com/") && !url.starts_with("https://objects.githubusercontent.com/") {
        return Err(Error::Integrity("endereço de download inesperado".into()));
    }
    let dest = dir.join(crate::fsutil::safe_file_name(name)?);
    crate::net::download(
        &crate::net::client()?,
        url,
        &dest,
        &crate::net::Expect {
            size: (up.size > 0).then_some(up.size),
            sha256: up.sha256.clone(),
            max_bytes: Some(256 * 1024 * 1024),
        },
        progress,
    )
    .await?;
    let head = std::fs::read(&dest).map(|b| b.get(..2) == Some(b"MZ")).unwrap_or(false);
    if !head {
        let _ = std::fs::remove_file(&dest);
        return Err(Error::Integrity("o instalador baixado não é um executável válido".into()));
    }
    Ok(dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "tag_name": "v0.9.0", "html_url": "https://github.com/RiqueBitt/CommandProject/releases/tag/v0.9.0",
        "body": "Novidades", "draft": false, "prerelease": false,
        "assets": [
            {"name": "CommandProject_0.9.0_x64_en-US.msi", "browser_download_url": "https://github.com/a/b.msi", "size": 10},
            {"name": "CommandProject_0.9.0_x64-setup.exe", "browser_download_url": "https://github.com/RiqueBitt/CommandProject/releases/download/v0.9.0/CommandProject_0.9.0_x64-setup.exe",
             "size": 13697204, "digest": "sha256:ABCDEF0123"}
        ]}"#;

    #[test]
    fn picks_windows_installer_and_digest() {
        let up = parse_release(SAMPLE, "0.8.0").unwrap().unwrap();
        assert_eq!(up.version, "0.9.0");
        assert_eq!(up.asset_name.as_deref(), Some("CommandProject_0.9.0_x64-setup.exe"));
        assert_eq!(up.size, 13_697_204);
        assert_eq!(up.sha256.as_deref(), Some("abcdef0123"));
        assert!(parse_release(SAMPLE, "0.9.0").unwrap().is_none());
        assert!(parse_release(SAMPLE, "0.10.0").unwrap().is_none());
    }
}
