//! Biblioteca de mods: cada mod vive em `library/<id>/` com `mod.json` + `files/*.scd`.
//! Os arquivos do jogo nunca são a "fonte" de um mod — eles só recebem cópias no deploy.

use crate::error::{Error, IoContext, Result};
use crate::fsutil::{self, copy_atomic, read_json, safe_file_name, slugify, write_json};
use crate::manifest::{Category, Manifest, ModFile, MpPolicy, Source, MANIFEST_FILE, SCHEMA_VERSION};
use crate::scd::{self, Scd, ScdBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledMod {
    pub manifest: Manifest,
    pub dir: PathBuf,
    pub icon_path: Option<PathBuf>,
}

impl InstalledMod {
    pub fn file_path(&self, name: &str) -> PathBuf {
        self.dir.join("files").join(name)
    }
}

/// Opções de importação vindas da interface.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportOptions {
    pub id: Option<String>,
    pub name: Option<String>,
    pub version: Option<String>,
    pub category: Option<Category>,
    pub description: Option<String>,
    pub multiplayer: Option<MpPolicy>,
    /// Se já existir um mod com o mesmo id, substitui (atualização).
    #[serde(default)]
    pub replace: bool,
    #[serde(skip)]
    pub source: Option<Source>,
    /// O `.scd` de origem é descartável (gerado pelo launcher): pode ser movido em vez de copiado.
    #[serde(skip)]
    pub move_source: bool,
}

pub struct Library {
    root: PathBuf,
}

impl Library {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root).at(root)?;
        Ok(Library {
            root: root.to_path_buf(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn list(&self) -> Result<Vec<InstalledMod>> {
        let mut out = Vec::new();
        for entry in fs::read_dir(&self.root).at(&self.root)? {
            let dir = entry.at(&self.root)?.path();
            if !dir.is_dir() || dir.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.')) {
                continue;
            }
            match self.load(&dir) {
                Ok(m) => out.push(m),
                Err(e) => eprintln!("[biblioteca] ignorando {}: {e}", dir.display()),
            }
        }
        out.sort_by_key(|a| a.manifest.name.to_lowercase());
        Ok(out)
    }

    fn load(&self, dir: &Path) -> Result<InstalledMod> {
        let manifest: Manifest = read_json(&dir.join(MANIFEST_FILE))?;
        manifest.validate()?;
        let icon_path = manifest.icon.as_ref().map(|i| dir.join(i)).filter(|p| p.is_file());
        Ok(InstalledMod {
            manifest,
            dir: dir.to_path_buf(),
            icon_path,
        })
    }

    pub fn get(&self, id: &str) -> Result<InstalledMod> {
        let dir = self.root.join(id);
        if !dir.join(MANIFEST_FILE).exists() {
            return Err(Error::ModNotFound(id.to_string()));
        }
        self.load(&dir)
    }

    pub fn contains(&self, id: &str) -> bool {
        self.root.join(id).join(MANIFEST_FILE).exists()
    }

    /// Verifica se os arquivos da biblioteca batem com o manifesto.
    pub fn verify(&self, id: &str) -> Result<Vec<String>> {
        let m = self.get(id)?;
        let mut problems = Vec::new();
        for f in &m.manifest.files {
            let p = m.file_path(&f.name);
            match fsutil::sha256_file(&p) {
                Ok(h) if h == f.sha256 => {}
                Ok(_) => problems.push(format!("{} foi alterado", f.name)),
                Err(_) => problems.push(format!("{} está faltando", f.name)),
            }
        }
        Ok(problems)
    }

    pub fn remove(&self, id: &str) -> Result<()> {
        let dir = self.root.join(fsutil::safe_file_name(id)?);
        if !dir.exists() {
            return Err(Error::ModNotFound(id.to_string()));
        }
        fs::remove_dir_all(&dir).at(&dir)
    }

    /// Atualiza metadados editáveis (nome, descrição, categoria, tags, política MP).
    pub fn update_meta(&self, id: &str, patch: &ImportOptions, tags: Option<Vec<String>>) -> Result<Manifest> {
        let m = self.get(id)?;
        let mut man = m.manifest;
        if let Some(n) = &patch.name {
            man.name = n.trim().to_string();
        }
        if let Some(d) = &patch.description {
            man.description = d.clone();
        }
        if let Some(c) = patch.category {
            man.category = c;
        }
        if let Some(v) = &patch.version {
            man.version = v.trim().to_string();
        }
        if let Some(mp) = patch.multiplayer {
            man.multiplayer = mp;
        }
        if let Some(t) = tags {
            man.tags = t;
        }
        man.validate()?;
        write_json(&m.dir.join(MANIFEST_FILE), &man)?;
        Ok(man)
    }

    /// Importa um mod de um `.scd`, `.zip` (pacote) ou pasta.
    ///
    /// * `.scd` → mod com esse arquivo;
    /// * `.zip`/pasta com `.scd` dentro → mod com todos eles (+ `mod.json` se existir);
    /// * `.zip`/pasta sem `.scd` mas com conteúdo de jogo (`lua/`, `textures/`…) → gera um `.scd`.
    pub fn import(&self, src: &Path, opts: &ImportOptions) -> Result<Manifest> {
        let staging = tempfile::Builder::new()
            .prefix(".import-")
            .tempdir_in(&self.root)
            .at(&self.root)?;
        let stage = staging.path();
        let ext = src.extension().map(|e| e.to_string_lossy().to_ascii_lowercase());
        // hashes já calculados durante a cópia (evita ler arquivos grandes duas vezes)
        let mut known_sha: std::collections::HashMap<PathBuf, String> = std::collections::HashMap::new();

        let (mut scds, packaged): (Vec<PathBuf>, Option<Manifest>) = if src.is_dir() {
            collect_from_dir(src, stage)?
        } else {
            match ext.as_deref() {
                Some("scd") => {
                    if !scd::looks_like_zip(src) {
                        return Err(Error::Format("o .scd não é um arquivo ZIP válido".into()));
                    }
                    Scd::open(src)?; // valida estrutura
                    let name = safe_file_name(&src.file_name().unwrap().to_string_lossy())?;
                    let dst = stage.join("files").join(&name);
                    // arquivo gerado pelo launcher no mesmo disco: mover é instantâneo (Texturas HD têm >1 GB)
                    let moved = opts.move_source
                        && fs::create_dir_all(stage.join("files")).is_ok()
                        && fs::rename(src, &dst).is_ok();
                    if !moved {
                        let sha = copy_atomic(src, &dst)?;
                        known_sha.insert(dst.clone(), sha);
                    }
                    (vec![dst], None)
                }
                Some("zip") => {
                    let unpacked = stage.join("unpacked");
                    Scd::open(src)?.extract("", &unpacked)?;
                    collect_from_dir(&unpacked, stage)?
                }
                Some("rar") | Some("7z") => {
                    return Err(Error::Format(
                        "arquivos .rar/.7z não são suportados — extraia e importe a pasta ou os .scd".into(),
                    ))
                }
                _ => return Err(Error::Format("use um arquivo .scd, .zip ou uma pasta".into())),
            }
        };
        if scds.is_empty() {
            return Err(Error::Format(
                "nenhum arquivo .scd ou conteúdo de jogo encontrado".into(),
            ));
        }
        scds.sort();

        let base_name = opts
            .name
            .clone()
            .or_else(|| packaged.as_ref().map(|m| m.name.clone()))
            .unwrap_or_else(|| guess_name(src));
        let id = opts
            .id
            .clone()
            .or_else(|| packaged.as_ref().map(|m| m.id.clone()))
            .unwrap_or_else(|| slugify(&base_name));
        let id = slugify(&id);

        let mut files = Vec::new();
        for p in &scds {
            let size = p.metadata().at(p)?.len();
            files.push(ModFile {
                name: p.file_name().unwrap().to_string_lossy().into_owned(),
                sha256: match known_sha.remove(p) {
                    Some(h) => h,
                    None => fsutil::sha256_file(p)?,
                },
                size,
            });
        }

        let mut manifest = match packaged {
            Some(mut m) => {
                // o pacote declara hashes: eles precisam bater com o que veio
                for f in &files {
                    if let Some(decl) = m.files.iter().find(|d| d.name.eq_ignore_ascii_case(&f.name)) {
                        if !decl.sha256.eq_ignore_ascii_case(&f.sha256) {
                            return Err(Error::Integrity(format!(
                                "{}: hash diferente do declarado no mod.json",
                                f.name
                            )));
                        }
                    }
                }
                m.files = files;
                m
            }
            None => Manifest {
                schema: SCHEMA_VERSION,
                id: id.clone(),
                name: base_name.clone(),
                version: "1.0.0".into(),
                authors: vec![],
                description: String::new(),
                category: guess_category(&scds),
                tags: vec![],
                requires_dlc: false,
                files,
                dependencies: vec![],
                conflicts: vec![],
                multiplayer: MpPolicy::Sync,
                homepage: None,
                license: None,
                icon: None,
                source: Source {
                    kind: "local".into(),
                    url: None,
                    hub_id: None,
                },
                installed_at: None,
            },
        };
        manifest.schema = SCHEMA_VERSION;
        manifest.id = id;
        if let Some(n) = &opts.name {
            manifest.name = n.clone();
        }
        if let Some(v) = &opts.version {
            manifest.version = v.clone();
        }
        if let Some(c) = opts.category {
            manifest.category = c;
        }
        if let Some(d) = &opts.description {
            manifest.description = d.clone();
        }
        if let Some(mp) = opts.multiplayer {
            manifest.multiplayer = mp;
        }
        if let Some(s) = &opts.source {
            manifest.source = s.clone();
        }
        if manifest.icon.as_ref().is_some_and(|i| !stage.join(i).is_file()) {
            manifest.icon = None;
        }
        manifest.installed_at = Some(chrono::Utc::now().to_rfc3339());
        manifest.validate()?;

        // limpa o que não faz parte do mod e move a pasta preparada para o lugar
        let _ = fs::remove_dir_all(stage.join("unpacked"));
        write_json(&stage.join(MANIFEST_FILE), &manifest)?;
        let final_dir = self.root.join(&manifest.id);
        if final_dir.exists() {
            if !opts.replace {
                return Err(Error::Conflict(format!(
                    "já existe um mod com id \"{}\" — use atualizar/substituir",
                    manifest.id
                )));
            }
            let old = self.root.join(format!(".old-{}", manifest.id));
            let _ = fs::remove_dir_all(&old);
            fs::rename(&final_dir, &old).at(&final_dir)?;
            let staged = staging.keep();
            if let Err(e) = fs::rename(&staged, &final_dir) {
                let _ = fs::rename(&old, &final_dir); // desfaz
                let _ = fs::remove_dir_all(&staged);
                return Err(Error::io(&final_dir, e));
            }
            let _ = fs::remove_dir_all(&old);
        } else {
            let staged = staging.keep();
            fs::rename(&staged, &final_dir).at(&final_dir)?;
        }
        Ok(manifest)
    }
}

/// Junta os `.scd` de uma pasta (recursivo) em `stage/files`. Se não houver `.scd`
/// mas houver conteúdo de jogo, empacota tudo num `.scd` novo.
fn collect_from_dir(dir: &Path, stage: &Path) -> Result<(Vec<PathBuf>, Option<Manifest>)> {
    let files_dir = stage.join("files");
    fs::create_dir_all(&files_dir).at(&files_dir)?;
    let mut scds = Vec::new();
    let mut manifest = None;
    for entry in walkdir::WalkDir::new(dir)
        .max_depth(4)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let p = entry.path();
        if !entry.file_type().is_file() {
            continue;
        }
        let name = p.file_name().unwrap().to_string_lossy().to_string();
        let lower = name.to_ascii_lowercase();
        if lower.ends_with(".scd") {
            let dst = files_dir.join(safe_file_name(&name)?);
            if dst.exists() {
                return Err(Error::Conflict(format!("dois arquivos chamados {name} no pacote")));
            }
            copy_atomic(p, &dst)?;
            scds.push(dst);
        } else if lower == MANIFEST_FILE && manifest.is_none() {
            manifest = Some(read_json::<Manifest>(p)?);
        } else if matches!(lower.as_str(), "icon.png" | "icon.jpg" | "cover.png" | "cover.jpg") {
            let _ = fs::copy(p, stage.join(&lower));
        }
    }
    if let Some(m) = manifest.as_mut() {
        if let Some(icon) = m.icon.clone() {
            let src = dir.join(&icon);
            if src.is_file() {
                let _ = fs::copy(&src, stage.join(safe_file_name(&icon)?));
            }
        }
    }
    if scds.is_empty() && looks_like_game_content(dir) {
        let name = format!("zz_{}.scd", slugify(&guess_name(dir)).replace('-', "_"));
        let dst = files_dir.join(&name);
        let mut b = ScdBuilder::create(&dst)?;
        for top in content_roots(dir) {
            let rel = top.file_name().unwrap().to_string_lossy().to_string();
            for e in walkdir::WalkDir::new(&top).into_iter().filter_map(|e| e.ok()) {
                if e.file_type().is_file() {
                    let r = e
                        .path()
                        .strip_prefix(&top)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/");
                    b.add_file(&format!("{rel}/{r}"), e.path())?;
                }
            }
        }
        b.finish()?;
        scds.push(dst);
    }
    Ok((scds, manifest))
}

const CONTENT_DIRS: &[&str] = &[
    "lua",
    "textures",
    "units",
    "maps",
    "env",
    "effects",
    "meshes",
    "projectiles",
    "props",
    "sounds",
    "loc",
    "ui",
];

fn content_roots(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.is_dir()
                        && p.file_name()
                            .map(|n| CONTENT_DIRS.contains(&n.to_string_lossy().to_ascii_lowercase().as_str()))
                            .unwrap_or(false)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn looks_like_game_content(dir: &Path) -> bool {
    !content_roots(dir).is_empty()
}

fn guess_name(src: &Path) -> String {
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Mod".into());
    let cleaned: String = stem
        .trim_start_matches(['_', ' '])
        .trim_start_matches("zz_")
        .replace('_', " ");
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        "Mod".into()
    } else {
        cleaned.to_string()
    }
}

/// Palpite de categoria olhando os caminhos internos do primeiro .scd.
fn guess_category(scds: &[PathBuf]) -> Category {
    let mut maps = 0;
    let mut tex = 0;
    let mut lua = 0;
    let mut ui = 0;
    let mut total = 0;
    for p in scds.iter().take(3) {
        if let Ok(mut s) = Scd::open(p) {
            if let Ok(entries) = s.entries() {
                for e in entries.iter().filter(|e| !e.is_dir) {
                    total += 1;
                    if e.key.starts_with("/maps/") {
                        maps += 1;
                    } else if e.key.starts_with("/textures/ui") || e.key.starts_with("/lua/ui") {
                        ui += 1;
                    } else if e.key.ends_with(".dds") {
                        tex += 1;
                    } else if e.key.ends_with(".lua") || e.key.ends_with(".bp") {
                        lua += 1;
                    }
                }
            }
        }
    }
    if total == 0 {
        return Category::Other;
    }
    let max = maps.max(tex).max(lua).max(ui);
    if max == maps && maps > 0 {
        Category::Maps
    } else if max == ui && ui > 0 {
        Category::Ui
    } else if max == tex && tex > 0 {
        Category::Textures
    } else {
        Category::Gameplay
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn make_scd(path: &Path, entries: &[(&str, &[u8])]) {
        let mut b = ScdBuilder::create(path).unwrap();
        for (n, d) in entries {
            b.add_bytes(n, d).unwrap();
        }
        b.finish().unwrap();
    }

    #[test]
    fn import_scd_zip_and_folder() {
        let t = tempfile::tempdir().unwrap();
        let lib = Library::open(&t.path().join("lib")).unwrap();

        // 1) .scd solto
        let scd_path = t.path().join("zz_STORM.scd");
        make_scd(&scd_path, &[("lua/sim/unit.lua", b"-- storm")]);
        let m = lib.import(&scd_path, &ImportOptions::default()).unwrap();
        assert_eq!(m.id, "storm");
        assert_eq!(m.files[0].name, "zz_STORM.scd");
        assert!(lib.verify("storm").unwrap().is_empty());
        // reimportar sem replace falha; com replace funciona
        assert!(lib.import(&scd_path, &ImportOptions::default()).is_err());
        lib.import(
            &scd_path,
            &ImportOptions {
                replace: true,
                ..Default::default()
            },
        )
        .unwrap();

        // 2) pasta com conteúdo solto (sem .scd) vira um .scd gerado
        let folder = t.path().join("Meu Pacote UI");
        fs::create_dir_all(folder.join("textures/ui/common")).unwrap();
        fs::write(folder.join("textures/ui/common/btn.dds"), b"DDS ").unwrap();
        let m = lib.import(&folder, &ImportOptions::default()).unwrap();
        assert_eq!(m.id, "meu-pacote-ui");
        assert_eq!(m.category, Category::Ui);
        assert!(m.files[0].name.starts_with("zz_"));

        // 3) .zip de pacote com dois .scd e mod.json com hash errado → recusa
        let inner = t.path().join("a.scd");
        make_scd(&inner, &[("maps/x/x_scenario.lua", b"x")]);
        let zip_path = t.path().join("pacote.zip");
        let mut b = ScdBuilder::create(&zip_path).unwrap();
        b.add_file("pacote/_mapa.scd", &inner).unwrap();
        b.add_bytes(
            "pacote/mod.json",
            br#"{"id":"mapa","name":"Mapa","version":"2.0","files":[{"name":"_mapa.scd","sha256":"0000000000000000000000000000000000000000000000000000000000000000","size":1}]}"#,
        )
        .unwrap();
        b.finish().unwrap();
        let err = lib.import(&zip_path, &ImportOptions::default()).unwrap_err();
        assert!(matches!(err, Error::Integrity(_)), "{err}");

        assert_eq!(lib.list().unwrap().len(), 2);
        lib.remove("storm").unwrap();
        assert_eq!(lib.list().unwrap().len(), 1);
        // nenhum resto de staging
        assert!(fs::read_dir(lib.root())
            .unwrap()
            .flatten()
            .all(|e| !e.file_name().to_string_lossy().starts_with(".import")));
    }
}
