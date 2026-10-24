//! Cópias de segurança locais: todos os projetos (mapas, tropas, modelos, texturas, ícones) mais as
//! configurações, num `.zip` comum. Restaurar sempre cria projetos novos: nada existente é
//! sobrescrito. Também há a cópia automática (de tempos em tempos, guardando as mais recentes)
//! e o resumo do espaço usado em disco.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::creator::{dir_size, Creations};
use crate::error::{Error, IoContext, Result};

const MANIFEST: &str = "cp-backup.json";
const AUTO_PREFIX: &str = "auto-";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub version: u32,
    pub created_at: String,
    pub app: String,
    pub projects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    pub path: PathBuf,
    pub name: String,
    pub created_at: String,
    pub size: u64,
    pub auto: bool,
    pub projects: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StorageItem {
    pub key: String,
    pub label: String,
    pub path: PathBuf,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RestoreReport {
    pub restored: Vec<String>,
    pub skipped: Vec<String>,
}

pub fn backups_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("project-backups")
}

/// Caminho de uma cópia feita pelo botão (na pasta de cópias do launcher).
pub fn manual_path(data_dir: &Path) -> PathBuf {
    backups_dir(data_dir).join(format!("copia-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M%S")))
}

fn opts() -> zip::write::SimpleFileOptions {
    zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated)
}

/// Grava a cópia de segurança em `dest` (arquivo temporário + troca, para nunca deixar um zip pela metade).
pub fn create(data_dir: &Path, dest: &Path) -> Result<BackupEntry> {
    let c = Creations::open(data_dir)?;
    let metas = c.list()?;
    let tmp = dest.with_extension("zip.part");
    if let Some(d) = dest.parent() {
        fs::create_dir_all(d).at(d)?;
    }
    {
        let f = fs::File::create(&tmp).at(&tmp)?;
        let mut z = zip::ZipWriter::new(f);
        let add = |z: &mut zip::ZipWriter<fs::File>, name: &str, data: &[u8]| -> Result<()> {
            z.start_file(name, opts()).map_err(|e| Error::Other(e.to_string()))?;
            z.write_all(data).at(&tmp)
        };
        for m in &metas {
            let d = c.root().join(&m.id);
            for name in ["meta.json", "doc.json", "thumb.png"] {
                if let Ok(data) = fs::read(d.join(name)) {
                    add(&mut z, &format!("projects/{}/{name}", m.id), &data)?;
                }
            }
            if let Ok(rd) = fs::read_dir(d.join("assets")) {
                for e in rd.flatten() {
                    if e.path().is_file() {
                        let data = fs::read(e.path()).at(e.path())?;
                        add(&mut z, &format!("projects/{}/assets/{}", m.id, e.file_name().to_string_lossy()), &data)?;
                    }
                }
            }
        }
        for name in ["settings.json", "profiles.json"] {
            if let Ok(data) = fs::read(data_dir.join(name)) {
                add(&mut z, &format!("config/{name}"), &data)?;
            }
        }
        let man = BackupManifest {
            version: 1,
            created_at: chrono::Utc::now().to_rfc3339(),
            app: env!("CARGO_PKG_VERSION").into(),
            projects: metas.iter().map(|m| m.id.clone()).collect(),
        };
        add(&mut z, MANIFEST, &serde_json::to_vec_pretty(&man).map_err(|e| Error::Other(e.to_string()))?)?;
        z.finish().map_err(|e| Error::Other(e.to_string()))?;
    }
    fs::rename(&tmp, dest).at(dest)?;
    entry(dest).ok_or_else(|| Error::Other("cópia gravada, mas não deu para ler de volta".into()))
}

fn read_manifest(path: &Path) -> Option<BackupManifest> {
    let f = fs::File::open(path).ok()?;
    let mut z = zip::ZipArchive::new(f).ok()?;
    let mut e = z.by_name(MANIFEST).ok()?;
    let mut v = Vec::new();
    e.read_to_end(&mut v).ok()?;
    serde_json::from_slice(&v).ok()
}

fn entry(path: &Path) -> Option<BackupEntry> {
    let man = read_manifest(path)?;
    let name = path.file_name()?.to_string_lossy().into_owned();
    Some(BackupEntry {
        size: fs::metadata(path).map(|m| m.len()).unwrap_or(0),
        auto: name.starts_with(AUTO_PREFIX),
        projects: man.projects.len(),
        created_at: man.created_at,
        path: path.to_path_buf(),
        name,
    })
}

/// Confere se o arquivo é uma cópia de segurança válida (e quantos projetos tem).
pub fn inspect(path: &Path) -> Result<BackupEntry> {
    entry(path).ok_or_else(|| Error::Other("o arquivo não é uma cópia de segurança do CommandProject".into()))
}

/// Cópias guardadas na pasta de dados (as automáticas e as feitas pelo botão).
pub fn list(data_dir: &Path) -> Vec<BackupEntry> {
    let mut out: Vec<BackupEntry> = fs::read_dir(backups_dir(data_dir))
        .map(|rd| rd.flatten().filter_map(|e| entry(&e.path())).collect())
        .unwrap_or_default();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

/// Restaura os projetos da cópia como projetos novos (os atuais ficam intactos).
/// `only` = ids escolhidos (vazio = todos).
pub fn restore(data_dir: &Path, src: &Path, only: &[String]) -> Result<RestoreReport> {
    let man = read_manifest(src).ok_or_else(|| Error::Other("o arquivo não é uma cópia de segurança do CommandProject".into()))?;
    let c = Creations::open(data_dir)?;
    let f = fs::File::open(src).at(src)?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| Error::archive(src, e))?;
    let mut rep = RestoreReport { restored: vec![], skipped: vec![] };
    for id in &man.projects {
        if !only.is_empty() && !only.contains(id) {
            continue;
        }
        if id.contains(['/', '\\']) || id.starts_with('.') {
            rep.skipped.push(id.clone());
            continue;
        }
        match c.import_from(&mut z, &format!("projects/{id}/"), src) {
            Ok(m) => rep.restored.push(m.name),
            Err(e) => rep.skipped.push(format!("{id}: {e}")),
        }
    }
    Ok(rep)
}

/// Cópia automática: grava uma nova se a última tem mais de `every_days` dias e guarda só as
/// `keep` automáticas mais recentes (as feitas pelo botão nunca são apagadas).
pub fn auto(data_dir: &Path, every_days: i64, keep: usize) -> Result<Option<BackupEntry>> {
    if every_days <= 0 {
        return Ok(None);
    }
    let c = Creations::open(data_dir)?;
    if c.list()?.is_empty() {
        return Ok(None);
    }
    let all = list(data_dir);
    let last_auto = all.iter().filter(|b| b.auto).map(|b| b.created_at.clone()).max();
    if let Some(last) = last_auto.and_then(|t| chrono::DateTime::parse_from_rfc3339(&t).ok()) {
        if chrono::Utc::now().signed_duration_since(last) < chrono::Duration::days(every_days) {
            return Ok(None);
        }
    }
    let dest = backups_dir(data_dir).join(format!("{AUTO_PREFIX}{}.zip", chrono::Utc::now().format("%Y%m%d-%H%M%S")));
    let made = create(data_dir, &dest)?;
    let mut autos: Vec<BackupEntry> = list(data_dir).into_iter().filter(|b| b.auto).collect();
    autos.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    for old in autos.into_iter().skip(keep.max(1)) {
        let _ = fs::remove_file(&old.path);
    }
    Ok(Some(made))
}

/// Espaço usado por tipo de conteúdo na pasta de dados.
pub fn storage(data_dir: &Path) -> Vec<StorageItem> {
    let known: [(&str, &str); 9] = [
        ("creations", "Projetos (mapas, tropas, modelos, texturas, ícones)"),
        ("creations-trash", "Lixeira de projetos"),
        ("project-backups", "Cópias de segurança dos projetos"),
        ("library", "Biblioteca de mods"),
        ("unit-packs", "Pacotes de tropas"),
        ("projects", "Estúdio (arquivos do jogo editados)"),
        ("backups", "Arquivos originais do jogo (para restaurar)"),
        ("quarantine", "Arquivos em quarentena"),
        ("cache", "Cache e temporários"),
    ];
    let mut out: Vec<StorageItem> = known
        .iter()
        .map(|(k, l)| StorageItem { key: (*k).into(), label: (*l).into(), path: data_dir.join(k), bytes: dir_size(&data_dir.join(k)) })
        .filter(|s| s.path.exists())
        .collect();
    // o resto (outras pastas e arquivos de configuração)
    let total = dir_size(data_dir);
    let listed: u64 = out.iter().map(|s| s.bytes).sum();
    out.push(StorageItem { key: "other".into(), label: "Configurações e outros".into(), path: data_dir.to_path_buf(), bytes: total.saturating_sub(listed) });
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_and_restore_never_overwrite() {
        let t = tempfile::tempdir().unwrap();
        let c = Creations::open(t.path()).unwrap();
        let m = c.create(crate::creator::Kind::Map, "Vale", &serde_json::json!({ "schema": 1, "x": 1 })).unwrap();
        c.asset_put(&m.id, "tex.png", b"\x89PNGfake").unwrap();
        fs::write(t.path().join("settings.json"), b"{}").unwrap();
        let dest = t.path().join("out").join("copia.zip");
        let b = create(t.path(), &dest).unwrap();
        assert_eq!(b.projects, 1);
        assert!(!dest.with_extension("zip.part").exists());
        // muda o projeto original: restaurar não pode mexer nele
        c.save(&m.id, &serde_json::json!({ "schema": 1, "x": 2 }), false).unwrap();
        let r = restore(t.path(), &dest, &[]).unwrap();
        assert_eq!(r.restored.len(), 1, "{r:?}");
        let all = c.list().unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(c.load(&m.id).unwrap().doc["x"], 2);
        let other = all.iter().find(|x| x.id != m.id).unwrap();
        assert_eq!(c.load(&other.id).unwrap().doc["x"], 1);
        assert_eq!(c.assets(&other.id).unwrap().len(), 1);
        // cópia automática: uma só por período, e a lista mostra
        assert!(auto(t.path(), 7, 3).unwrap().is_some());
        assert!(auto(t.path(), 7, 3).unwrap().is_none());
        assert!(list(t.path()).iter().any(|b| b.auto));
        assert!(storage(t.path()).iter().any(|s| s.key == "creations" && s.bytes > 0));
    }

    #[test]
    fn corrupt_doc_is_recovered_and_trash_restores() {
        let t = tempfile::tempdir().unwrap();
        let c = Creations::open(t.path()).unwrap();
        let m = c.create(crate::creator::Kind::Unit, "Tanque", &serde_json::json!({ "schema": 1, "v": 1 })).unwrap();
        c.save(&m.id, &serde_json::json!({ "schema": 1, "v": 2 }), true).unwrap();
        fs::write(c.root().join(&m.id).join("doc.json"), b"{ quebrado").unwrap();
        let l = c.load(&m.id).unwrap();
        assert!(l.repaired.is_some());
        assert_eq!(l.doc["v"], 1);
        assert!(fs::read_dir(c.root().join(&m.id)).unwrap().flatten().any(|e| e.file_name().to_string_lossy().starts_with("doc.corrompido")));
        c.delete(&m.id).unwrap();
        let tr = c.trash_list();
        assert_eq!(tr.len(), 1);
        let back = c.trash_restore(&tr[0].entry).unwrap();
        assert_eq!(back.name, "Tanque");
        assert!(c.load(&back.id).is_ok());
    }
}
