//! Cache de SHA-256 indexado por (tamanho, data de modificação). Os arquivos do jogo
//! somam ~4 GB; recalcular o hash a cada abertura do launcher seria lento demais.

use crate::error::Result;
use crate::fsutil::{read_json_or_default, sha256_file, write_json};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct Entry {
    size: u64,
    mtime: u128,
    sha256: String,
}

#[derive(Default, Serialize, Deserialize)]
struct Store {
    entries: BTreeMap<String, Entry>,
}

pub struct HashCache {
    path: PathBuf,
    store: Store,
    dirty: bool,
}

impl HashCache {
    pub fn load(path: &Path) -> Self {
        let store = read_json_or_default(path).unwrap_or_default();
        HashCache {
            path: path.to_path_buf(),
            store,
            dirty: false,
        }
    }

    /// Hash do arquivo, usando o cache quando tamanho e mtime não mudaram.
    pub fn sha256(&mut self, file: &Path) -> Result<String> {
        let meta = std::fs::metadata(file).map_err(|e| crate::Error::io(file, e))?;
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let key = file.to_string_lossy().to_string();
        if let Some(e) = self.store.entries.get(&key) {
            if e.size == meta.len() && e.mtime == mtime && mtime != 0 {
                return Ok(e.sha256.clone());
            }
        }
        let sha = sha256_file(file)?;
        self.store.entries.insert(
            key,
            Entry {
                size: meta.len(),
                mtime,
                sha256: sha.clone(),
            },
        );
        self.dirty = true;
        Ok(sha)
    }

    /// Informa um hash já conhecido (ex.: acabamos de copiar o arquivo).
    pub fn remember(&mut self, file: &Path, sha: &str) {
        if let Ok(meta) = std::fs::metadata(file) {
            let mtime = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            self.store.entries.insert(
                file.to_string_lossy().to_string(),
                Entry {
                    size: meta.len(),
                    mtime,
                    sha256: sha.to_string(),
                },
            );
            self.dirty = true;
        }
    }

    pub fn save(&mut self) -> Result<()> {
        if self.dirty {
            // descarta entradas de arquivos que não existem mais
            self.store.entries.retain(|k, _| Path::new(k).exists());
            write_json(&self.path, &self.store)?;
            self.dirty = false;
        }
        Ok(())
    }
}
