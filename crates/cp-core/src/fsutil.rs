//! Utilidades de sistema de arquivos: hash em streaming, escrita atômica, JSON.

use crate::error::{Error, IoContext, Result};
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

/// SHA-256 de um arquivo, lido em blocos de 1 MiB (arquivos .scd passam de 1 GB).
pub fn sha256_file(path: &Path) -> Result<String> {
    let mut f = File::open(path).at(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).at(path)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

pub fn sha256_bytes(data: &[u8]) -> String {
    hex::encode(Sha256::digest(data))
}

/// Escreve `data` em `path` de forma atômica: grava num temporário ao lado,
/// faz fsync e renomeia por cima. Um crash nunca deixa um arquivo pela metade.
pub fn write_atomic(path: &Path, data: &[u8]) -> Result<()> {
    let tmp = tmp_sibling(path);
    {
        let mut f = File::create(&tmp).at(&tmp)?;
        f.write_all(data).at(&tmp)?;
        f.sync_all().at(&tmp)?;
    }
    fs::rename(&tmp, path).at(path)
}

/// Copia `src` para `dst` atomicamente e devolve o SHA-256 do que foi copiado.
pub fn copy_atomic(src: &Path, dst: &Path) -> Result<String> {
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).at(parent)?;
    }
    let tmp = tmp_sibling(dst);
    let mut input = File::open(src).at(src)?;
    let mut out = File::create(&tmp).at(&tmp)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = input.read(&mut buf).at(src)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
        out.write_all(&buf[..n]).at(&tmp)?;
    }
    out.sync_all().at(&tmp)?;
    drop(out);
    fs::rename(&tmp, dst).at(dst)?;
    Ok(hex::encode(h.finalize()))
}

pub fn tmp_sibling(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.cp-tmp"))
}

pub fn read_json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    let data = fs::read(path).at(path)?;
    serde_json::from_slice(&data).map_err(|source| Error::Json {
        path: path.into(),
        source,
    })
}

/// Lê JSON se existir; caso contrário devolve o padrão.
pub fn read_json_or_default<T: DeserializeOwned + Default>(path: &Path) -> Result<T> {
    if path.exists() {
        read_json(path)
    } else {
        Ok(T::default())
    }
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).at(parent)?;
    }
    let data = serde_json::to_vec_pretty(value).map_err(|e| Error::Other(e.to_string()))?;
    write_atomic(path, &data)
}

/// Nome de arquivo seguro: impede `..`, separadores e nomes reservados.
pub fn safe_file_name(name: &str) -> Result<String> {
    let trimmed = name.trim();
    let bad = trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains(['/', '\\', ':', '\0'])
        || trimmed.chars().any(|c| c.is_control());
    if bad {
        return Err(Error::Other(format!("nome de arquivo inválido: {name:?}")));
    }
    Ok(trimmed.to_string())
}

/// Gera um identificador (slug) a partir de um nome livre.
pub fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in input.chars() {
        let c = fold_accent(c);
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "mod".into()
    } else {
        out
    }
}

fn fold_accent(c: char) -> char {
    match c {
        'á' | 'à' | 'â' | 'ã' | 'ä' | 'Á' | 'À' | 'Â' | 'Ã' | 'Ä' => 'a',
        'é' | 'è' | 'ê' | 'ë' | 'É' | 'È' | 'Ê' | 'Ë' => 'e',
        'í' | 'ì' | 'î' | 'ï' | 'Í' | 'Ì' | 'Î' | 'Ï' => 'i',
        'ó' | 'ò' | 'ô' | 'õ' | 'ö' | 'Ó' | 'Ò' | 'Ô' | 'Õ' | 'Ö' => 'o',
        'ú' | 'ù' | 'û' | 'ü' | 'Ú' | 'Ù' | 'Û' | 'Ü' => 'u',
        'ç' | 'Ç' => 'c',
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug() {
        assert_eq!(
            slugify("Revamp Expansion Mod (RVE) v2.0"),
            "revamp-expansion-mod-rve-v2-0"
        );
        assert_eq!(slugify("Ação Ãrmada!!"), "acao-armada");
        assert_eq!(slugify("***"), "mod");
    }

    #[test]
    fn safe_names() {
        assert!(safe_file_name("zz_storm.scd").is_ok());
        assert!(safe_file_name("../lua.scd").is_err());
        assert!(safe_file_name("a\\b.scd").is_err());
        assert!(safe_file_name("..").is_err());
    }

    #[test]
    fn atomic_copy_hash() {
        let dir = tempfile::tempdir().unwrap();
        let a = dir.path().join("a.bin");
        fs::write(&a, b"hello").unwrap();
        let b = dir.path().join("sub/b.bin");
        let h = copy_atomic(&a, &b).unwrap();
        assert_eq!(h, sha256_bytes(b"hello"));
        assert_eq!(sha256_file(&b).unwrap(), h);
        assert!(!tmp_sibling(&b).exists());
    }
}
