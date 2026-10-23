//! `mod.json` — o manifesto de cada mod da biblioteca e dos pacotes do hub.

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

pub const MANIFEST_FILE: &str = "mod.json";
pub const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    #[default]
    Gameplay,
    Balance,
    Maps,
    Textures,
    Ui,
    Models,
    Audio,
    Fixes,
    Library,
    Other,
}

/// Como o mod se comporta no multiplayer.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum MpPolicy {
    /// Todos na partida precisam ter o mod idêntico (padrão seguro: o SC2 roda em lockstep).
    #[default]
    Sync,
    /// Só visual/local (ex.: pacote de texturas que não altera simulação).
    /// Ainda assim o SC2 pode recusar partidas com arquivos diferentes — use com cuidado.
    Local,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModFile {
    /// Nome do arquivo .scd como vai para a pasta gamedata.
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Dependency {
    pub id: String,
    /// Requisito semver opcional, ex.: ">=7.0".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    /// "hub", "local", "adopted" (encontrado já instalado no gamedata) ou "studio".
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hub_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default = "schema_default")]
    pub schema: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: Category,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Requer o DLC Infinite War Battle Pack.
    #[serde(default)]
    pub requires_dlc: bool,
    pub files: Vec<ModFile>,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    #[serde(default)]
    pub multiplayer: MpPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    /// Imagem de capa relativa à pasta do mod (png/jpg).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default)]
    pub source: Source,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
}

fn schema_default() -> u32 {
    SCHEMA_VERSION
}

impl Manifest {
    pub fn validate(&self) -> Result<()> {
        let id_ok = !self.id.is_empty()
            && self.id.len() <= 64
            && self
                .id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_');
        if !id_ok {
            return Err(Error::Manifest(format!(
                "id \"{}\" inválido (use letras minúsculas, números e '-')",
                self.id
            )));
        }
        if self.name.trim().is_empty() {
            return Err(Error::Manifest("o nome não pode ficar vazio".into()));
        }
        if self.files.is_empty() {
            return Err(Error::Manifest("o mod precisa ter pelo menos um arquivo .scd".into()));
        }
        let mut seen = std::collections::HashSet::new();
        for f in &self.files {
            crate::fsutil::safe_file_name(&f.name).map_err(|e| Error::Manifest(e.to_string()))?;
            if !f.name.to_ascii_lowercase().ends_with(".scd") {
                return Err(Error::Manifest(format!("{} não é um arquivo .scd", f.name)));
            }
            if !seen.insert(f.name.to_ascii_lowercase()) {
                return Err(Error::Manifest(format!("arquivo repetido: {}", f.name)));
            }
            if f.sha256.len() != 64 || !f.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
                return Err(Error::Manifest(format!("sha256 inválido para {}", f.name)));
            }
        }
        if let Some(icon) = &self.icon {
            crate::fsutil::safe_file_name(icon).map_err(|e| Error::Manifest(e.to_string()))?;
        }
        Ok(())
    }

    pub fn total_size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }
}

/// Versão "tolerante": aceita "1", "1.2", "v1.2.3", "1.2.3-beta".
pub fn parse_version(v: &str) -> Option<semver::Version> {
    let v = v.trim().trim_start_matches(['v', 'V']);
    if let Ok(s) = semver::Version::parse(v) {
        return Some(s);
    }
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    let mut parts: Vec<&str> = core.split('.').collect();
    while parts.len() < 3 {
        parts.push("0");
    }
    let mut s = parts[..3].join(".");
    if let Some(p) = pre {
        s.push('-');
        s.push_str(p);
    }
    semver::Version::parse(&s).ok()
}

/// Compara versões; cai para comparação textual quando não são semver.
pub fn compare_versions(a: &str, b: &str) -> Ordering {
    match (parse_version(a), parse_version(b)) {
        (Some(x), Some(y)) => x.cmp(&y),
        _ => a.cmp(b),
    }
}

/// O requisito `req` (ex.: ">=7") aceita a versão `v`?
pub fn version_matches(req: Option<&str>, v: &str) -> bool {
    let Some(req) = req.map(str::trim).filter(|r| !r.is_empty()) else {
        return true;
    };
    let Some(version) = parse_version(v) else { return false };
    // normaliza requisitos curtos: ">=7" -> ">=7.0.0" (semver aceita ">=7", mas não "7.0" puro)
    semver::VersionReq::parse(req)
        .map(|r| r.matches(&version))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Manifest {
        Manifest {
            schema: 1,
            id: "storm".into(),
            name: "STORM".into(),
            version: "3.1.1".into(),
            authors: vec![],
            description: String::new(),
            category: Category::Gameplay,
            tags: vec![],
            requires_dlc: true,
            files: vec![ModFile {
                name: "zz_STORM.scd".into(),
                sha256: "a".repeat(64),
                size: 10,
            }],
            dependencies: vec![],
            conflicts: vec![],
            multiplayer: MpPolicy::Sync,
            homepage: None,
            license: None,
            icon: None,
            source: Source::default(),
            installed_at: None,
        }
    }

    #[test]
    fn validation() {
        assert!(sample().validate().is_ok());
        let mut m = sample();
        m.id = "Storm Mod".into();
        assert!(m.validate().is_err());
        let mut m = sample();
        m.files[0].name = "../lua.scd".into();
        assert!(m.validate().is_err());
        let mut m = sample();
        m.files[0].name = "readme.txt".into();
        assert!(m.validate().is_err());
    }

    #[test]
    fn versions() {
        assert_eq!(compare_versions("1.2", "1.10"), Ordering::Less);
        assert_eq!(compare_versions("v2.0.0", "2"), Ordering::Equal);
        assert_eq!(compare_versions("1.0.0-beta", "1.0.0"), Ordering::Less);
        assert!(version_matches(Some(">=7"), "7.1"));
        assert!(!version_matches(Some(">=7"), "6"));
        assert!(version_matches(None, "qualquer"));
    }

    #[test]
    fn json_defaults() {
        let m: Manifest = serde_json::from_str(
            r#"{"id":"x","name":"X","version":"1","files":[{"name":"x.scd","sha256":"00","size":1}]}"#,
        )
        .unwrap();
        assert_eq!(m.multiplayer, MpPolicy::Sync);
        assert_eq!(m.category, Category::Gameplay);
    }
}
