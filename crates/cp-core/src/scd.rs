//! Arquivos `.scd` — são ZIPs renomeados. Leitura, listagem, extração e criação.

use crate::error::{Error, IoContext, Result};
use serde::Serialize;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Limite de segurança para um único arquivo extraído (proteção contra zip bomb).
const MAX_ENTRY_BYTES: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScdEntry {
    /// Caminho como está no arquivo.
    pub name: String,
    /// Caminho normalizado (`/lua/foo.lua`, minúsculo, barras normais) — chave de conflito.
    pub key: String,
    pub size: u64,
    pub compressed: u64,
    pub is_dir: bool,
}

/// Normaliza um caminho interno: barras normais, minúsculas, com `/` inicial.
pub fn normalize_key(name: &str) -> String {
    let s = name.replace('\\', "/").to_ascii_lowercase();
    let s = s.trim_start_matches("./");
    if s.starts_with('/') {
        s.to_string()
    } else {
        format!("/{s}")
    }
}

pub struct Scd {
    path: PathBuf,
    zip: ZipArchive<BufReader<File>>,
}

impl Scd {
    pub fn open(path: &Path) -> Result<Self> {
        let f = File::open(path).at(path)?;
        let zip = ZipArchive::new(BufReader::new(f)).map_err(|e| Error::archive(path, e))?;
        Ok(Scd {
            path: path.to_path_buf(),
            zip,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn len(&self) -> usize {
        self.zip.len()
    }

    pub fn is_empty(&self) -> bool {
        self.zip.len() == 0
    }

    pub fn entries(&mut self) -> Result<Vec<ScdEntry>> {
        let mut out = Vec::with_capacity(self.zip.len());
        for i in 0..self.zip.len() {
            let f = self.zip.by_index_raw(i).map_err(|e| Error::archive(&self.path, e))?;
            let name = f.name().map(|n| n.into_owned()).unwrap_or_default();
            out.push(ScdEntry {
                key: normalize_key(&name),
                size: f.size(),
                compressed: f.compressed_size(),
                is_dir: f.is_dir(),
                name,
            });
        }
        Ok(out)
    }

    /// Lê uma entrada pelo caminho (aceita qualquer forma: barras/maiúsculas).
    pub fn read(&mut self, name: &str) -> Result<Vec<u8>> {
        let key = normalize_key(name);
        let idx = (0..self.zip.len())
            .find(|&i| {
                self.zip
                    .name_for_index(i)
                    .map(|n| n.map(|n| normalize_key(&n) == key).unwrap_or(false))
                    .unwrap_or(false)
            })
            .ok_or_else(|| Error::archive(&self.path, format!("entrada não encontrada: {name}")))?;
        let mut f = self.zip.by_index(idx).map_err(|e| Error::archive(&self.path, e))?;
        if f.size() > MAX_ENTRY_BYTES {
            return Err(Error::archive(&self.path, "entrada grande demais"));
        }
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf).map_err(|e| Error::archive(&self.path, e))?;
        Ok(buf)
    }

    /// Lê a entrada de índice `idx` (a ordem é a de [`Scd::entries`]).
    pub fn read_at(&mut self, idx: usize) -> Result<Vec<u8>> {
        let mut f = self.zip.by_index(idx).map_err(|e| Error::archive(&self.path, e))?;
        if f.size() > MAX_ENTRY_BYTES {
            return Err(Error::archive(&self.path, "entrada grande demais"));
        }
        let mut buf = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut buf).map_err(|e| Error::archive(&self.path, e))?;
        Ok(buf)
    }

    /// Lê só os primeiros `n` bytes de uma entrada (ex.: cabeçalho de DDS), sem descompactar o resto.
    pub fn read_prefix_at(&mut self, idx: usize, n: usize) -> Result<Vec<u8>> {
        let f = self.zip.by_index(idx).map_err(|e| Error::archive(&self.path, e))?;
        let mut buf = Vec::with_capacity(n);
        f.take(n as u64)
            .read_to_end(&mut buf)
            .map_err(|e| Error::archive(&self.path, e))?;
        Ok(buf)
    }

    /// Extrai entradas cujo caminho normalizado começa com `prefix` (vazio = tudo)
    /// para `dest`, recusando caminhos que tentem escapar da pasta.
    pub fn extract(&mut self, prefix: &str, dest: &Path) -> Result<usize> {
        let prefix = if prefix.is_empty() {
            String::from("/")
        } else {
            normalize_key(prefix)
        };
        let mut count = 0;
        for i in 0..self.zip.len() {
            let mut f = self.zip.by_index(i).map_err(|e| Error::archive(&self.path, e))?;
            let Some(rel) = f.enclosed_name() else { continue }; // bloqueia "../"
            let key = normalize_key(&f.name().map(|n| n.into_owned()).unwrap_or_default());
            if !key.starts_with(&prefix) {
                continue;
            }
            let out = dest.join(rel);
            if f.is_dir() {
                fs::create_dir_all(&out).at(&out)?;
                continue;
            }
            if f.size() > MAX_ENTRY_BYTES {
                return Err(Error::archive(&self.path, "entrada grande demais"));
            }
            if let Some(p) = out.parent() {
                fs::create_dir_all(p).at(p)?;
            }
            let mut w = BufWriter::new(File::create(&out).at(&out)?);
            std::io::copy(&mut f, &mut w).at(&out)?;
            w.flush().at(&out)?;
            count += 1;
        }
        Ok(count)
    }
}

/// Construtor de `.scd`. Escreve num temporário e só move para o destino no `finish`.
pub struct ScdBuilder {
    dest: PathBuf,
    tmp: PathBuf,
    zip: ZipWriter<BufWriter<File>>,
    names: std::collections::HashSet<String>,
}

impl ScdBuilder {
    pub fn create(dest: &Path) -> Result<Self> {
        if let Some(p) = dest.parent() {
            fs::create_dir_all(p).at(p)?;
        }
        let tmp = crate::fsutil::tmp_sibling(dest);
        let f = File::create(&tmp).at(&tmp)?;
        Ok(ScdBuilder {
            dest: dest.to_path_buf(),
            tmp,
            zip: ZipWriter::new(BufWriter::new(f)),
            names: Default::default(),
        })
    }

    fn options(name: &str) -> SimpleFileOptions {
        // texturas DDS comprimidas e arquivos já comprimidos ganham pouco com deflate
        let lower = name.to_ascii_lowercase();
        let method = if lower.ends_with(".bdf") || lower.ends_with(".ogg") || lower.ends_with(".bik") {
            CompressionMethod::Stored
        } else {
            CompressionMethod::Deflated
        };
        SimpleFileOptions::default()
            .compression_method(method)
            .large_file(false)
            .unix_permissions(0o644)
    }

    /// Adiciona bytes no caminho interno `name` (sempre gravado com `/`).
    pub fn add_bytes(&mut self, name: &str, data: &[u8]) -> Result<()> {
        let name = clean_internal_name(name)?;
        if !self.names.insert(normalize_key(&name)) {
            return Err(Error::archive(&self.dest, format!("entrada duplicada: {name}")));
        }
        self.zip
            .start_file(name.as_str(), Self::options(&name))
            .map_err(|e| Error::archive(&self.dest, e))?;
        self.zip.write_all(data).at(&self.tmp)
    }

    pub fn add_file(&mut self, name: &str, src: &Path) -> Result<()> {
        let data = fs::read(src).at(src)?;
        self.add_bytes(name, &data)
    }

    /// Adiciona uma pasta inteira, preservando a estrutura relativa.
    pub fn add_dir(&mut self, dir: &Path) -> Result<usize> {
        let mut n = 0;
        let mut files: Vec<_> = walkdir::WalkDir::new(dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .map(|e| e.into_path())
            .collect();
        files.sort();
        for path in files {
            let rel = path.strip_prefix(dir).expect("dentro da pasta");
            let name = rel.to_string_lossy().replace('\\', "/");
            self.add_file(&name, &path)?;
            n += 1;
        }
        Ok(n)
    }

    pub fn finish(self) -> Result<PathBuf> {
        let mut w = self.zip.finish().map_err(|e| Error::archive(&self.dest, e))?;
        w.flush().at(&self.tmp)?;
        w.get_ref().sync_all().at(&self.tmp)?;
        drop(w);
        fs::rename(&self.tmp, &self.dest).at(&self.dest)?;
        Ok(self.dest)
    }
}

fn clean_internal_name(name: &str) -> Result<String> {
    let n = name.replace('\\', "/");
    let n = n.trim_start_matches('/').to_string();
    if n.is_empty() || n.split('/').any(|seg| seg == ".." || seg.is_empty()) {
        return Err(Error::Other(format!("caminho interno inválido: {name:?}")));
    }
    Ok(n)
}

/// Acrescenta arquivos a um `.scd` que já existe (ex.: decorações próprias dentro de um mapa
/// gerado pelo toolkit). Nomes que já existem no arquivo são ignorados.
pub fn append_files(path: &Path, files: &[(String, Vec<u8>)]) -> Result<usize> {
    let existing: std::collections::HashSet<String> = Scd::open(path)?.entries()?.into_iter().map(|e| e.key).collect();
    let f = fs::OpenOptions::new().read(true).write(true).open(path).at(path)?;
    let mut z = ZipWriter::new_append(f).map_err(|e| Error::archive(path, e))?;
    let mut n = 0;
    for (name, data) in files {
        let clean = clean_internal_name(name)?;
        if existing.contains(&normalize_key(&clean)) {
            continue;
        }
        z.start_file(clean.as_str(), ScdBuilder::options(&clean)).map_err(|e| Error::archive(path, e))?;
        z.write_all(data).at(path)?;
        n += 1;
    }
    z.finish().map_err(|e| Error::archive(path, e))?;
    Ok(n)
}

/// Verdadeiro se o arquivo parece um ZIP/SCD válido (assinatura `PK`).
pub fn looks_like_zip(path: &Path) -> bool {
    let mut sig = [0u8; 4];
    File::open(path).and_then(|mut f| f.read_exact(&mut sig)).is_ok() && &sig[..2] == b"PK"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_and_lookup() {
        let t = tempfile::tempdir().unwrap();
        let p = t.path().join("teste.scd");
        let mut b = ScdBuilder::create(&p).unwrap();
        b.add_bytes("lua/ui/game/hud.lua", b"-- hud").unwrap();
        b.add_bytes("textures/ui/icon.dds", b"DDS ").unwrap();
        assert!(
            b.add_bytes("LUA/ui/game/HUD.lua", b"x").is_err(),
            "duplicada por normalização"
        );
        assert!(b.add_bytes("../escape.lua", b"x").is_err());
        b.finish().unwrap();

        assert!(looks_like_zip(&p));
        assert_eq!(append_files(&p, &[("props/cp/a/a_prop.bp".into(), b"x".to_vec()), ("lua/ui/game/hud.lua".into(), b"y".to_vec())]).unwrap(), 1);
        let mut s = Scd::open(&p).unwrap();
        let e = s.entries().unwrap();
        assert_eq!(e.len(), 3);
        assert_eq!(e[0].key, "/lua/ui/game/hud.lua");
        assert_eq!(s.read("\\LUA\\UI\\game\\hud.lua").unwrap(), b"-- hud");
        let out = t.path().join("x");
        assert_eq!(s.extract("/textures", &out).unwrap(), 1);
        assert!(out.join("textures/ui/icon.dds").exists());
    }

    #[test]
    fn normalize() {
        assert_eq!(normalize_key("Units\\UEB0101\\a.BP"), "/units/ueb0101/a.bp");
        assert_eq!(normalize_key("/lua/x.lua"), "/lua/x.lua");
    }
}
