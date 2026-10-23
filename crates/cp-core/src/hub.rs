//! Hub de mods: índice JSON publicado pelo Project Club (ou qualquer servidor),
//! download com verificação SHA-256 e checagem de atualizações.
//!
//! Formato do índice: veja `docs/HUB_API.md`.

use crate::error::{Error, Result};
use crate::library::{ImportOptions, Library};
use crate::manifest::{compare_versions, Category, Dependency, Manifest, MpPolicy, Source};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::AsyncWriteExt;

const MAX_INDEX_BYTES: usize = 8 * 1024 * 1024;
const MAX_PACKAGE_BYTES: u64 = 4 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubIndex {
    pub schema: u32,
    pub name: String,
    #[serde(default)]
    pub updated_at: Option<String>,
    #[serde(default)]
    pub mods: Vec<HubMod>,
    /// URL de onde o índice veio (preenchido pelo cliente).
    #[serde(default, skip_deserializing)]
    pub source_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubMod {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub category: Category,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub screenshots: Vec<String>,
    #[serde(default)]
    pub downloads: u64,
    #[serde(default)]
    pub rating: Option<f32>,
    #[serde(default)]
    pub license: Option<String>,
    pub versions: Vec<HubVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubVersion {
    pub version: String,
    #[serde(default)]
    pub released_at: Option<String>,
    #[serde(default)]
    pub changelog: String,
    #[serde(default)]
    pub requires_dlc: bool,
    #[serde(default)]
    pub multiplayer: MpPolicy,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    pub package: HubPackage,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HubPackage {
    /// URL absoluta ou relativa ao índice.
    pub url: String,
    pub sha256: String,
    pub size: u64,
    /// "scd" (um único .scd) ou "zip" (pacote com .scd + mod.json opcional).
    #[serde(default = "default_kind")]
    pub kind: String,
    /// Nome do arquivo quando `kind = "scd"` (ex.: `zz_STORM.scd`).
    #[serde(default)]
    pub file_name: Option<String>,
}

fn default_kind() -> String {
    "zip".into()
}

impl HubMod {
    pub fn latest(&self) -> Option<&HubVersion> {
        self.versions
            .iter()
            .max_by(|a, b| compare_versions(&a.version, &b.version))
    }
}

fn client(url: &reqwest::Url) -> Result<reqwest::Client> {
    let mut b = reqwest::Client::builder()
        .user_agent(concat!("CommandProject/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60));
    if is_loopback(url) {
        b = b.no_proxy();
    }
    b.build().map_err(|e| Error::Network(e.to_string()))
}

fn is_loopback(u: &reqwest::Url) -> bool {
    matches!(u.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]"))
}

/// Só HTTPS (HTTP é aceito apenas para localhost, para testes e servidores locais).
pub fn check_url(raw: &str) -> Result<reqwest::Url> {
    let u = reqwest::Url::parse(raw.trim()).map_err(|_| Error::Network(format!("URL inválida: {raw}")))?;
    match u.scheme() {
        "https" => Ok(u),
        "http" if is_loopback(&u) => Ok(u),
        _ => Err(Error::Network(
            "por segurança, só endereços https:// são aceitos".into(),
        )),
    }
}

pub async fn fetch_index(url: &str) -> Result<HubIndex> {
    let u = check_url(url)?;
    let resp = client(&u)?
        .get(u.clone())
        .send()
        .await
        .map_err(|e| Error::Network(format!("não foi possível acessar o hub: {e}")))?;
    if !resp.status().is_success() {
        return Err(Error::Network(format!("o hub respondeu {}", resp.status())));
    }
    let mut body = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| Error::Network(e.to_string()))?;
        body.extend_from_slice(&chunk);
        if body.len() > MAX_INDEX_BYTES {
            return Err(Error::Network("índice do hub grande demais".into()));
        }
    }
    let mut idx: HubIndex =
        serde_json::from_slice(&body).map_err(|e| Error::Network(format!("índice inválido: {e}")))?;
    validate_index(&idx)?;
    idx.source_url = u.to_string();
    Ok(idx)
}

pub fn validate_index(idx: &HubIndex) -> Result<()> {
    if idx.schema != 1 {
        return Err(Error::Network(format!("versão de índice {} não suportada", idx.schema)));
    }
    let mut ids = std::collections::HashSet::new();
    for m in &idx.mods {
        if !ids.insert(&m.id) {
            return Err(Error::Network(format!("mod repetido no índice: {}", m.id)));
        }
        if m.versions.is_empty() {
            return Err(Error::Network(format!("{} não tem versões", m.id)));
        }
        for v in &m.versions {
            let p = &v.package;
            if p.sha256.len() != 64 || !p.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(Error::Network(format!("{} {}: sha256 inválido", m.id, v.version)));
            }
            if p.size == 0 || p.size > MAX_PACKAGE_BYTES {
                return Err(Error::Network(format!("{} {}: tamanho inválido", m.id, v.version)));
            }
            if p.kind != "zip" && p.kind != "scd" {
                return Err(Error::Network(format!(
                    "{} {}: tipo de pacote \"{}\" desconhecido",
                    m.id, v.version, p.kind
                )));
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
}

/// Baixa o pacote para `cache_dir`, verificando tamanho e SHA-256 em streaming.
pub async fn download(
    index_url: &str,
    pkg: &HubPackage,
    cache_dir: &Path,
    progress: &mut (dyn FnMut(DownloadProgress) + Send),
) -> Result<PathBuf> {
    let base = check_url(index_url)?;
    let url = base
        .join(&pkg.url)
        .map_err(|_| Error::Network(format!("URL de pacote inválida: {}", pkg.url)))?;
    let url = check_url(url.as_str())?;
    tokio::fs::create_dir_all(cache_dir)
        .await
        .map_err(|e| Error::io(cache_dir, e))?;
    let ext = if pkg.kind == "scd" { "scd" } else { "zip" };
    let final_path = match (&pkg.file_name, pkg.kind.as_str()) {
        (Some(n), "scd") => cache_dir.join(&pkg.sha256).join(crate::fsutil::safe_file_name(n)?),
        _ => cache_dir.join(format!("{}.{ext}", pkg.sha256)),
    };
    if final_path.exists() && crate::fsutil::sha256_file(&final_path)? == pkg.sha256.to_ascii_lowercase() {
        return Ok(final_path); // já baixado
    }
    if let Some(p) = final_path.parent() {
        tokio::fs::create_dir_all(p).await.map_err(|e| Error::io(p, e))?;
    }
    let part = final_path.with_extension("part");
    let resp = client(&url)?
        .get(url.clone())
        .send()
        .await
        .map_err(|e| Error::Network(format!("falha no download: {e}")))?;
    if !resp.status().is_success() {
        return Err(Error::Network(format!("download respondeu {}", resp.status())));
    }
    let mut file = tokio::fs::File::create(&part).await.map_err(|e| Error::io(&part, e))?;
    let mut hasher = Sha256::new();
    let mut got: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| Error::Network(e.to_string()))?;
        got += chunk.len() as u64;
        if got > pkg.size {
            drop(file);
            let _ = tokio::fs::remove_file(&part).await;
            return Err(Error::Integrity(
                "o download é maior do que o anunciado — cancelado".into(),
            ));
        }
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(|e| Error::io(&part, e))?;
        progress(DownloadProgress {
            downloaded: got,
            total: pkg.size,
        });
    }
    file.flush().await.map_err(|e| Error::io(&part, e))?;
    file.sync_all().await.map_err(|e| Error::io(&part, e))?;
    drop(file);
    let sha = hex::encode(hasher.finalize());
    if got != pkg.size || !sha.eq_ignore_ascii_case(&pkg.sha256) {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(Error::Integrity(
            "o arquivo baixado não confere com o hub (SHA-256) — não foi instalado".into(),
        ));
    }
    tokio::fs::rename(&part, &final_path)
        .await
        .map_err(|e| Error::io(&final_path, e))?;
    Ok(final_path)
}

/// Instala na biblioteca um pacote já baixado e verificado.
pub fn install_downloaded(
    library: &Library,
    index_url: &str,
    m: &HubMod,
    v: &HubVersion,
    path: &Path,
) -> Result<Manifest> {
    let opts = ImportOptions {
        id: Some(m.id.clone()),
        name: Some(m.name.clone()),
        version: Some(v.version.clone()),
        category: Some(m.category),
        description: Some(if m.description.is_empty() {
            m.summary.clone()
        } else {
            m.description.clone()
        }),
        multiplayer: Some(v.multiplayer),
        replace: true,
        source: Some(Source {
            kind: "hub".into(),
            url: Some(index_url.to_string()),
            hub_id: Some(m.id.clone()),
        }),
    };
    let mut manifest = library.import(path, &opts)?;
    // completa o manifesto com dados do hub
    manifest.authors = m.authors.clone();
    manifest.tags = m.tags.clone();
    manifest.homepage = m.homepage.clone();
    manifest.license = m.license.clone();
    manifest.requires_dlc = v.requires_dlc;
    manifest.dependencies = v.dependencies.clone();
    manifest.conflicts = v.conflicts.clone();
    manifest.validate()?;
    crate::fsutil::write_json(
        &library.root().join(&manifest.id).join(crate::manifest::MANIFEST_FILE),
        &manifest,
    )?;
    Ok(manifest)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub id: String,
    pub name: String,
    pub installed: String,
    pub latest: String,
    pub changelog: String,
    pub index_url: String,
}

/// Mods instalados que têm versão mais nova em algum hub.
pub fn find_updates(library: &Library, indexes: &[HubIndex]) -> Result<Vec<UpdateInfo>> {
    let mut out = Vec::new();
    for im in library.list()? {
        let hub_id = im
            .manifest
            .source
            .hub_id
            .clone()
            .unwrap_or_else(|| im.manifest.id.clone());
        for idx in indexes {
            let Some(hm) = idx.mods.iter().find(|m| m.id == hub_id) else {
                continue;
            };
            let Some(latest) = hm.latest() else { continue };
            if compare_versions(&latest.version, &im.manifest.version).is_gt() {
                out.push(UpdateInfo {
                    id: im.manifest.id.clone(),
                    name: im.manifest.name.clone(),
                    installed: im.manifest.version.clone(),
                    latest: latest.version.clone(),
                    changelog: latest.changelog.clone(),
                    index_url: idx.source_url.clone(),
                });
                break;
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::make_scd;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Servidor HTTP mínimo: responde cada caminho com o corpo configurado.
    async fn serve(routes: Vec<(&'static str, Vec<u8>)>) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let routes = routes.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                    let (status, body) = routes
                        .iter()
                        .find(|(p, _)| *p == path)
                        .map(|(_, b)| ("200 OK", b.clone()))
                        .unwrap_or(("404 Not Found", b"nope".to_vec()));
                    let head = format!(
                        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = sock.write_all(head.as_bytes()).await;
                    let _ = sock.write_all(&body).await;
                });
            }
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    #[tokio::test]
    async fn index_download_install_and_updates() {
        let t = tempfile::tempdir().unwrap();
        let scd_path = t.path().join("zz_STORM.scd");
        make_scd(&scd_path, &[("lua/sim/unit.lua", b"-- storm 3.1.1")]);
        let scd_bytes = std::fs::read(&scd_path).unwrap();
        let sha = crate::fsutil::sha256_bytes(&scd_bytes);
        let index = serde_json::json!({
            "schema": 1, "name": "Teste",
            "mods": [{
                "id": "storm", "name": "STORM", "summary": "Rework", "category": "gameplay",
                "authors": ["Comunidade"],
                "versions": [
                    {"version": "3.0.0", "package": {"url": "pkg/old.scd", "sha256": "0".repeat(64), "size": 10, "kind": "scd", "fileName": "zz_STORM.scd"}},
                    {"version": "3.1.1", "changelog": "Correções", "package": {"url": "pkg/storm.scd", "sha256": sha, "size": scd_bytes.len(), "kind": "scd", "fileName": "zz_STORM.scd"}}
                ]
            }]
        });
        let base = serve(vec![
            ("/index.json", serde_json::to_vec(&index).unwrap()),
            ("/pkg/storm.scd", scd_bytes.clone()),
            ("/pkg/old.scd", b"0123456789".to_vec()),
        ])
        .await;
        let idx_url = format!("{base}/index.json");
        let idx = fetch_index(&idx_url).await.unwrap();
        let m = &idx.mods[0];
        let latest = m.latest().unwrap();
        assert_eq!(latest.version, "3.1.1");

        let cache = t.path().join("cache");
        let mut calls = 0;
        let path = download(&idx.source_url, &latest.package, &cache, &mut |_| calls += 1)
            .await
            .unwrap();
        assert!(calls > 0);
        assert_eq!(path.file_name().unwrap(), "zz_STORM.scd");

        let lib = Library::open(&t.path().join("lib")).unwrap();
        let man = install_downloaded(&lib, &idx.source_url, m, latest, &path).unwrap();
        assert_eq!((man.id.as_str(), man.version.as_str()), ("storm", "3.1.1"));
        assert_eq!(man.source.kind, "hub");
        assert_eq!(man.authors, ["Comunidade"]);
        assert!(find_updates(&lib, std::slice::from_ref(&idx)).unwrap().is_empty());

        // hash errado no hub é recusado e nada fica em cache
        let bad = &m.versions[0].package;
        let err = download(&idx.source_url, bad, &cache, &mut |_| {}).await.unwrap_err();
        assert!(matches!(err, Error::Integrity(_)), "{err}");

        // versão instalada mais antiga → aparece como atualização
        lib.update_meta(
            "storm",
            &ImportOptions {
                version: Some("3.0.0".into()),
                ..Default::default()
            },
            None,
        )
        .unwrap();
        let ups = find_updates(&lib, &[idx]).unwrap();
        assert_eq!(ups.len(), 1);
        assert_eq!(ups[0].latest, "3.1.1");
    }

    #[test]
    fn url_policy() {
        assert!(check_url("https://projectclub.example/mods.json").is_ok());
        assert!(check_url("http://localhost:8080/x").is_ok());
        assert!(check_url("http://exemplo.com/x").is_err());
        assert!(check_url("file:///etc/passwd").is_err());
    }
}
