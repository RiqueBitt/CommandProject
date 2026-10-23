//! Gera o `index.json` de um hub a partir de uma pasta organizada — usado pelo servidor
//! da comunidade (`cp-server`) e pelo comando `cp hub-build`.
//!
//! ```text
//! hub/
//!   hub.json                         { "name": "Hub da comunidade" }       (opcional)
//!   mods/<id>/mod.json               nome, resumo, autores, categoria…
//!   mods/<id>/icon.png               (opcional)
//!   mods/<id>/<versão>/pacote.zip    ou um único .scd
//!   mods/<id>/<versão>/version.json  changelog, DLC, multiplayer, dependências (opcional)
//!   mods/<id>/<versão>/changelog.md  (opcional, substitui o changelog do version.json)
//! ```
//!
//! Hash e tamanho são calculados aqui — quem publica não precisa fazer nada à mão.

use crate::error::Result;
use crate::fsutil::read_json;
use crate::hashcache::HashCache;
use crate::hub::{validate_index, HubIndex, HubMod, HubPackage, HubVersion};
use crate::manifest::{compare_versions, parse_version, Category, Dependency, MpPolicy};
use serde::Deserialize;
use std::fs;
use std::path::Path;

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct HubMeta {
    name: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ModMeta {
    name: Option<String>,
    summary: String,
    description: String,
    authors: Vec<String>,
    category: Category,
    tags: Vec<String>,
    homepage: Option<String>,
    icon: Option<String>,
    screenshots: Vec<String>,
    license: Option<String>,
    downloads: u64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct VersionMeta {
    released_at: Option<String>,
    changelog: String,
    requires_dlc: bool,
    multiplayer: MpPolicy,
    dependencies: Vec<Dependency>,
    conflicts: Vec<String>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
}

/// Monta o índice. Devolve também avisos de pastas ignoradas (para o log do servidor).
pub fn build_index(dir: &Path, hashes: Option<&mut HashCache>) -> Result<(HubIndex, Vec<String>)> {
    let mut local_cache;
    let hashes = match hashes {
        Some(h) => h,
        None => {
            local_cache = HashCache::load(&dir.join(".hashcache.json"));
            &mut local_cache
        }
    };
    let mut warnings = Vec::new();
    let meta: HubMeta = read_json(&dir.join("hub.json")).unwrap_or_default();
    let mut mods = Vec::new();
    let mods_dir = dir.join("mods");
    let mut entries: Vec<_> = fs::read_dir(&mods_dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
        .unwrap_or_default();
    entries.sort();
    for mdir in entries {
        let id = mdir.file_name().unwrap().to_string_lossy().to_string();
        if !valid_id(&id) {
            warnings.push(format!(
                "mods/{id}: nome de pasta inválido (use minúsculas, números e '-')"
            ));
            continue;
        }
        let m: ModMeta = match read_json(&mdir.join("mod.json")) {
            Ok(m) => m,
            Err(e) => {
                warnings.push(format!("mods/{id}/mod.json: {e}"));
                continue;
            }
        };
        let mut versions = Vec::new();
        let mut vdirs: Vec<_> = fs::read_dir(&mdir)
            .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect())
            .unwrap_or_default();
        vdirs.sort();
        for vdir in vdirs {
            let version = vdir.file_name().unwrap().to_string_lossy().to_string();
            if parse_version(&version).is_none() {
                warnings.push(format!("mods/{id}/{version}: não é um número de versão"));
                continue;
            }
            let pkgs: Vec<_> = fs::read_dir(&vdir)
                .map(|rd| {
                    rd.flatten()
                        .map(|e| e.path())
                        .filter(|p| {
                            p.is_file()
                                && p.extension()
                                    .map(|e| e.eq_ignore_ascii_case("zip") || e.eq_ignore_ascii_case("scd"))
                                    .unwrap_or(false)
                        })
                        .collect()
                })
                .unwrap_or_default();
            if pkgs.len() != 1 {
                warnings.push(format!(
                    "mods/{id}/{version}: precisa ter exatamente um .zip ou .scd (tem {})",
                    pkgs.len()
                ));
                continue;
            }
            let pkg = &pkgs[0];
            let file = pkg.file_name().unwrap().to_string_lossy().to_string();
            if crate::fsutil::safe_file_name(&file).is_err() || file.contains(' ') {
                warnings.push(format!("mods/{id}/{version}/{file}: renomeie sem espaços"));
                continue;
            }
            let vm: VersionMeta = read_json(&vdir.join("version.json")).unwrap_or_default();
            let changelog = fs::read_to_string(vdir.join("changelog.md")).unwrap_or(vm.changelog);
            let kind = if file.to_ascii_lowercase().ends_with(".scd") {
                "scd"
            } else {
                "zip"
            };
            versions.push(HubVersion {
                released_at: vm.released_at.or_else(|| {
                    pkg.metadata()
                        .and_then(|m| m.modified())
                        .ok()
                        .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                }),
                changelog,
                requires_dlc: vm.requires_dlc,
                multiplayer: vm.multiplayer,
                dependencies: vm.dependencies,
                conflicts: vm.conflicts,
                package: HubPackage {
                    url: format!("mods/{id}/{version}/{file}"),
                    sha256: hashes.sha256(pkg)?,
                    size: pkg.metadata().map_err(|e| crate::Error::io(pkg, e))?.len(),
                    kind: kind.into(),
                    file_name: (kind == "scd").then(|| file.clone()),
                },
                version,
            });
        }
        if versions.is_empty() {
            warnings.push(format!("mods/{id}: nenhuma versão válida"));
            continue;
        }
        versions.sort_by(|a, b| compare_versions(&b.version, &a.version));
        let icon = m
            .icon
            .or_else(|| mdir.join("icon.png").is_file().then(|| format!("mods/{id}/icon.png")));
        mods.push(HubMod {
            name: m.name.unwrap_or_else(|| id.clone()),
            id,
            summary: m.summary,
            description: m.description,
            authors: m.authors,
            category: m.category,
            tags: m.tags,
            homepage: m.homepage,
            icon,
            screenshots: m.screenshots,
            downloads: m.downloads,
            rating: None,
            license: m.license,
            versions,
        });
    }
    let _ = hashes.save();
    let idx = HubIndex {
        schema: 1,
        name: meta.name.unwrap_or_else(|| "Hub da comunidade".into()),
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
        mods,
        source_url: String::new(),
    };
    validate_index(&idx)?;
    Ok((idx, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::make_scd;

    #[test]
    fn builds_from_folder() {
        let t = tempfile::tempdir().unwrap();
        let hub = t.path();
        fs::write(hub.join("hub.json"), r#"{"name":"Hub BR"}"#).unwrap();
        let v = hub.join("mods/storm/3.1.1");
        fs::create_dir_all(&v).unwrap();
        fs::write(
            hub.join("mods/storm/mod.json"),
            r#"{"name":"STORM","summary":"Rework","category":"gameplay","authors":["X"]}"#,
        )
        .unwrap();
        make_scd(&v.join("zz_STORM.scd"), &[("lua/a.lua", b"a")]);
        fs::write(v.join("changelog.md"), "Correções").unwrap();
        let v2 = hub.join("mods/storm/3.2.0");
        fs::create_dir_all(&v2).unwrap();
        make_scd(&v2.join("zz_STORM.scd"), &[("lua/a.lua", b"b")]);
        fs::write(v2.join("version.json"), r#"{"requiresDlc":true}"#).unwrap();
        // pastas problemáticas viram avisos, não erros
        fs::create_dir_all(hub.join("mods/Bad Name")).unwrap();
        fs::create_dir_all(hub.join("mods/vazio")).unwrap();
        fs::write(hub.join("mods/vazio/mod.json"), "{}").unwrap();

        let (idx, warnings) = build_index(hub, None).unwrap();
        assert_eq!(idx.name, "Hub BR");
        assert_eq!(idx.mods.len(), 1);
        let m = &idx.mods[0];
        assert_eq!(m.versions[0].version, "3.2.0", "mais nova primeiro");
        assert!(m.versions[0].requires_dlc);
        assert_eq!(m.versions[1].changelog, "Correções");
        assert_eq!(m.versions[0].package.kind, "scd");
        assert_eq!(m.versions[0].package.url, "mods/storm/3.2.0/zz_STORM.scd");
        assert_eq!(
            m.versions[0].package.sha256,
            crate::fsutil::sha256_file(&v2.join("zz_STORM.scd")).unwrap()
        );
        assert_eq!(warnings.len(), 2, "{warnings:?}");
    }
}
