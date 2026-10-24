//! Projetos de criação do launcher: mapas, tropas e modelos 3D.
//!
//! Cada projeto é uma pasta em `<dados>/creations/<id>/`:
//!
//! * `meta.json`   — nome, tipo, datas, favorito, etiquetas;
//! * `doc.json`    — o documento salvo (formato definido pelo editor de cada tipo, com `schema`);
//! * `autosave.json` — gravado pelo salvamento automático; se for mais novo que o `doc.json` ao abrir,
//!   o editor oferece recuperar (o launcher ou o PC caiu antes de salvar);
//! * `versions/`   — cópias anteriores do documento (as 40 mais recentes);
//! * `assets/`     — arquivos do projeto (texturas PNG, modelos OBJ/GLB…), sem duplicar (nome pelo hash);
//! * `thumb.png`   — miniatura para a biblioteca.
//!
//! Apagar move a pasta para `<dados>/creations-trash/` (dá para recuperar à mão).
//! Exportar/importar usa um `.cpproj` (zip com a pasta inteira).

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::{Error, IoContext, Result};
use crate::fsutil::{read_json, sha256_bytes, write_atomic, write_json};

/// Maior documento aceito (um mapa com milhares de decorações fica bem abaixo disso).
const MAX_DOC: usize = 48 << 20;
/// Maior arquivo de recurso (textura/modelo) aceito.
const MAX_ASSET: usize = 64 << 20;
/// Quantas versões anteriores ficam guardadas.
const KEEP_VERSIONS: usize = 40;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Map,
    Unit,
    Model,
}

impl Kind {
    fn slug(self) -> &'static str {
        match self {
            Kind::Map => "mapa",
            Kind::Unit => "tropa",
            Kind::Model => "modelo",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    pub id: String,
    pub kind: Kind,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Mod da biblioteca gerado a partir deste projeto (para atualizar em vez de duplicar).
    #[serde(default)]
    pub built_mod: Option<String>,
    #[serde(default)]
    pub has_thumb: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    pub meta: Meta,
    pub doc: Value,
    /// Há um salvamento automático mais novo que o documento (quando o launcher fechou sem salvar).
    pub recovery_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Version {
    pub file: String,
    pub saved_at: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AssetInfo {
    pub name: String,
    pub size: u64,
}

pub struct Creations {
    root: PathBuf,
    trash: PathBuf,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn bad_id(id: &str) -> bool {
    id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Nome de arquivo seguro para recursos: só letras, números, `-`, `_` e `.`; sem caminho.
pub fn safe_asset_name(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).trim();
    let clean: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .collect();
    let clean = clean.trim_start_matches('.').to_string();
    (!clean.is_empty() && clean.len() <= 120).then_some(clean)
}

impl Creations {
    pub fn open(data_dir: &Path) -> Result<Self> {
        let root = data_dir.join("creations");
        fs::create_dir_all(&root).at(&root)?;
        Ok(Creations {
            root,
            trash: data_dir.join("creations-trash"),
        })
    }

    fn dir(&self, id: &str) -> Result<PathBuf> {
        if bad_id(id) {
            return Err(Error::Other(format!("projeto inválido: {id}")));
        }
        let d = self.root.join(id);
        if !d.join("meta.json").is_file() {
            return Err(Error::Other(format!("projeto não encontrado: {id}")));
        }
        Ok(d)
    }

    pub fn list(&self) -> Result<Vec<Meta>> {
        let mut out = Vec::new();
        for e in fs::read_dir(&self.root).at(&self.root)?.flatten() {
            let p = e.path().join("meta.json");
            if let Ok(m) = read_json::<Meta>(&p) {
                out.push(m);
            }
        }
        out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(out)
    }

    fn new_id(&self, kind: Kind, name: &str) -> String {
        let slug: String = name
            .chars()
            .filter_map(|c| {
                let c = c.to_ascii_lowercase();
                if c.is_ascii_alphanumeric() {
                    Some(c)
                } else if c == ' ' || c == '-' || c == '_' {
                    Some('-')
                } else {
                    None
                }
            })
            .collect::<String>()
            .split('-')
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        let slug: String = slug.chars().take(32).collect();
        let base = if slug.is_empty() { kind.slug().to_string() } else { format!("{}-{slug}", kind.slug()) };
        let stamp = chrono::Utc::now().format("%y%m%d%H%M%S");
        let mut id = format!("{base}-{stamp}");
        let mut n = 2;
        while self.root.join(&id).exists() {
            id = format!("{base}-{stamp}-{n}");
            n += 1;
        }
        id
    }

    fn check_doc(doc: &Value) -> Result<Vec<u8>> {
        let bytes = serde_json::to_vec(doc).map_err(|e| Error::Other(e.to_string()))?;
        if bytes.len() > MAX_DOC {
            return Err(Error::Other("projeto grande demais para salvar".into()));
        }
        Ok(bytes)
    }

    pub fn create(&self, kind: Kind, name: &str, doc: &Value) -> Result<Meta> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::Other("dê um nome ao projeto".into()));
        }
        let bytes = Self::check_doc(doc)?;
        let id = self.new_id(kind, name);
        let d = self.root.join(&id);
        fs::create_dir_all(d.join("assets")).at(&d)?;
        let t = now();
        let meta = Meta {
            id,
            kind,
            name: name.chars().take(80).collect(),
            description: String::new(),
            created_at: t.clone(),
            updated_at: t,
            favorite: false,
            tags: vec![],
            built_mod: None,
            has_thumb: false,
        };
        write_atomic(&d.join("doc.json"), &bytes)?;
        write_json(&d.join("meta.json"), &meta)?;
        Ok(meta)
    }

    pub fn meta(&self, id: &str) -> Result<Meta> {
        read_json(&self.dir(id)?.join("meta.json"))
    }

    pub fn load(&self, id: &str) -> Result<Loaded> {
        let d = self.dir(id)?;
        let meta: Meta = read_json(&d.join("meta.json"))?;
        let doc: Value = read_json(&d.join("doc.json"))?;
        let recovery_at = modified(&d.join("autosave.json")).and_then(|auto| {
            let saved = modified(&d.join("doc.json"))?;
            (auto > saved).then(|| chrono::DateTime::<chrono::Utc>::from(auto).to_rfc3339())
        });
        Ok(Loaded { meta, doc, recovery_at })
    }

    /// Salva o documento. `snapshot` guarda o anterior em `versions/` (antes de sobrescrever).
    pub fn save(&self, id: &str, doc: &Value, snapshot: bool) -> Result<Meta> {
        let d = self.dir(id)?;
        let bytes = Self::check_doc(doc)?;
        let doc_path = d.join("doc.json");
        if snapshot {
            if let Ok(prev) = fs::read(&doc_path) {
                if prev != bytes {
                    self.push_version(&d, &prev)?;
                }
            }
        }
        write_atomic(&doc_path, &bytes)?;
        let _ = fs::remove_file(d.join("autosave.json"));
        let mut meta: Meta = read_json(&d.join("meta.json"))?;
        meta.updated_at = now();
        write_json(&d.join("meta.json"), &meta)?;
        Ok(meta)
    }

    fn push_version(&self, d: &Path, data: &[u8]) -> Result<()> {
        let vd = d.join("versions");
        fs::create_dir_all(&vd).at(&vd)?;
        let name = format!("{}.json", chrono::Utc::now().format("%Y%m%d-%H%M%S%3f"));
        write_atomic(&vd.join(name), data)?;
        let mut all: Vec<PathBuf> = fs::read_dir(&vd).at(&vd)?.flatten().map(|e| e.path()).collect();
        all.sort();
        while all.len() > KEEP_VERSIONS {
            let old = all.remove(0);
            let _ = fs::remove_file(old);
        }
        Ok(())
    }

    /// Salvamento automático: não mexe no documento salvo (fica para recuperar se cair).
    pub fn autosave(&self, id: &str, doc: &Value) -> Result<()> {
        let d = self.dir(id)?;
        let bytes = Self::check_doc(doc)?;
        write_atomic(&d.join("autosave.json"), &bytes)
    }

    pub fn recovery(&self, id: &str) -> Result<Value> {
        read_json(&self.dir(id)?.join("autosave.json"))
    }

    pub fn discard_recovery(&self, id: &str) -> Result<()> {
        let _ = fs::remove_file(self.dir(id)?.join("autosave.json"));
        Ok(())
    }

    pub fn versions(&self, id: &str) -> Result<Vec<Version>> {
        let vd = self.dir(id)?.join("versions");
        let mut out = Vec::new();
        if let Ok(rd) = fs::read_dir(&vd) {
            for e in rd.flatten() {
                let file = e.file_name().to_string_lossy().into_owned();
                let md = e.metadata().ok();
                let saved_at = md
                    .as_ref()
                    .and_then(|m| m.modified().ok())
                    .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                    .unwrap_or_default();
                out.push(Version { file, saved_at, size: md.map(|m| m.len()).unwrap_or(0) });
            }
        }
        out.sort_by(|a, b| b.file.cmp(&a.file));
        Ok(out)
    }

    /// Volta para uma versão anterior (a atual vira uma versão também, para poder desfazer).
    pub fn restore(&self, id: &str, file: &str) -> Result<Value> {
        let d = self.dir(id)?;
        if file.contains(['/', '\\']) || !file.ends_with(".json") {
            return Err(Error::Other("versão inválida".into()));
        }
        let doc: Value = read_json(&d.join("versions").join(file))?;
        self.save(id, &doc, true)?;
        Ok(doc)
    }

    pub fn update_meta(&self, id: &str, name: Option<&str>, description: Option<&str>, favorite: Option<bool>, tags: Option<Vec<String>>) -> Result<Meta> {
        let d = self.dir(id)?;
        let mut meta: Meta = read_json(&d.join("meta.json"))?;
        if let Some(n) = name.map(str::trim).filter(|n| !n.is_empty()) {
            meta.name = n.chars().take(80).collect();
        }
        if let Some(desc) = description {
            meta.description = desc.chars().take(2000).collect();
        }
        if let Some(f) = favorite {
            meta.favorite = f;
        }
        if let Some(t) = tags {
            meta.tags = t.into_iter().map(|s| s.trim().chars().take(30).collect::<String>()).filter(|s| !s.is_empty()).take(12).collect();
        }
        meta.updated_at = now();
        write_json(&d.join("meta.json"), &meta)?;
        Ok(meta)
    }

    pub fn set_built_mod(&self, id: &str, mod_id: &str) -> Result<()> {
        let d = self.dir(id)?;
        let mut meta: Meta = read_json(&d.join("meta.json"))?;
        meta.built_mod = Some(mod_id.to_string());
        write_json(&d.join("meta.json"), &meta)
    }

    pub fn set_thumb(&self, id: &str, png: &[u8]) -> Result<()> {
        let d = self.dir(id)?;
        if png.len() > 4 << 20 || !png.starts_with(b"\x89PNG") {
            return Err(Error::Other("miniatura inválida".into()));
        }
        write_atomic(&d.join("thumb.png"), png)?;
        let mut meta: Meta = read_json(&d.join("meta.json"))?;
        meta.has_thumb = true;
        write_json(&d.join("meta.json"), &meta)
    }

    pub fn thumb(&self, id: &str) -> Result<Option<Vec<u8>>> {
        Ok(fs::read(self.dir(id)?.join("thumb.png")).ok())
    }

    pub fn duplicate(&self, id: &str) -> Result<Meta> {
        let src = self.dir(id)?;
        let meta: Meta = read_json(&src.join("meta.json"))?;
        let doc: Value = read_json(&src.join("doc.json"))?;
        let mut copy = self.create(meta.kind, &format!("{} (cópia)", meta.name), &doc)?;
        let dst = self.root.join(&copy.id);
        copy_dir(&src.join("assets"), &dst.join("assets"))?;
        if let Ok(t) = fs::read(src.join("thumb.png")) {
            write_atomic(&dst.join("thumb.png"), &t)?;
            copy.has_thumb = true;
        }
        copy.description = meta.description;
        copy.tags = meta.tags;
        write_json(&dst.join("meta.json"), &copy)?;
        Ok(copy)
    }

    /// Manda para a lixeira (não apaga de vez).
    pub fn delete(&self, id: &str) -> Result<()> {
        let src = self.dir(id)?;
        fs::create_dir_all(&self.trash).at(&self.trash)?;
        let dst = self.trash.join(format!("{id}-{}", chrono::Utc::now().format("%Y%m%d%H%M%S")));
        fs::rename(&src, &dst).at(&src)
    }

    pub fn asset_put(&self, id: &str, name: &str, data: &[u8]) -> Result<String> {
        let d = self.dir(id)?;
        if data.len() > MAX_ASSET {
            return Err(Error::Other("arquivo grande demais (máximo 64 MB)".into()));
        }
        let clean = safe_asset_name(name).ok_or_else(|| Error::Other("nome de arquivo inválido".into()))?;
        let (stem, ext) = clean.rsplit_once('.').map(|(s, e)| (s.to_string(), format!(".{e}"))).unwrap_or((clean.clone(), String::new()));
        let short = &sha256_bytes(data)[..10];
        let final_name = format!("{}-{short}{ext}", stem.chars().take(60).collect::<String>());
        let ad = d.join("assets");
        fs::create_dir_all(&ad).at(&ad)?;
        let p = ad.join(&final_name);
        if !p.is_file() {
            write_atomic(&p, data)?;
        }
        Ok(final_name)
    }

    pub fn asset_get(&self, id: &str, name: &str) -> Result<Vec<u8>> {
        let clean = safe_asset_name(name).ok_or_else(|| Error::Other("nome de arquivo inválido".into()))?;
        let p = self.dir(id)?.join("assets").join(clean);
        fs::read(&p).at(&p)
    }

    pub fn asset_path(&self, id: &str, name: &str) -> Result<PathBuf> {
        let clean = safe_asset_name(name).ok_or_else(|| Error::Other("nome de arquivo inválido".into()))?;
        Ok(self.dir(id)?.join("assets").join(clean))
    }

    pub fn assets(&self, id: &str) -> Result<Vec<AssetInfo>> {
        let ad = self.dir(id)?.join("assets");
        let mut out = Vec::new();
        if let Ok(rd) = fs::read_dir(&ad) {
            for e in rd.flatten() {
                out.push(AssetInfo {
                    name: e.file_name().to_string_lossy().into_owned(),
                    size: e.metadata().map(|m| m.len()).unwrap_or(0),
                });
            }
        }
        out.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(out)
    }

    /// Dados derivados guardados com o projeto (ex.: `baked.json` de um modelo pronto para o jogo).
    pub fn derived_put(&self, id: &str, name: &str, data: &[u8]) -> Result<()> {
        let clean = safe_asset_name(name).ok_or_else(|| Error::Other("nome inválido".into()))?;
        let d = self.dir(id)?.join("export");
        fs::create_dir_all(&d).at(&d)?;
        write_atomic(&d.join(clean), data)
    }

    pub fn derived_get(&self, id: &str, name: &str) -> Result<Vec<u8>> {
        let clean = safe_asset_name(name).ok_or_else(|| Error::Other("nome inválido".into()))?;
        let p = self.dir(id)?.join("export").join(clean);
        fs::read(&p).at(&p)
    }

    /// Exporta o projeto inteiro para um `.cpproj` (zip).
    pub fn export(&self, id: &str, dest: &Path) -> Result<()> {
        let d = self.dir(id)?;
        let f = fs::File::create(dest).at(dest)?;
        let mut z = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for name in ["meta.json", "doc.json", "thumb.png"] {
            if let Ok(data) = fs::read(d.join(name)) {
                z.start_file(name, opts).map_err(|e| Error::Other(e.to_string()))?;
                z.write_all(&data).at(dest)?;
            }
        }
        for a in self.assets(id)? {
            let data = fs::read(d.join("assets").join(&a.name)).at(&d)?;
            z.start_file(format!("assets/{}", a.name), opts).map_err(|e| Error::Other(e.to_string()))?;
            z.write_all(&data).at(dest)?;
        }
        z.finish().map_err(|e| Error::Other(e.to_string()))?;
        Ok(())
    }

    /// Importa um `.cpproj`. Sempre cria um projeto novo (nunca sobrescreve um existente).
    pub fn import(&self, src: &Path) -> Result<Meta> {
        let f = fs::File::open(src).at(src)?;
        let mut z = zip::ZipArchive::new(f).map_err(|e| Error::archive(src, e))?;
        let mut read = |name: &str| -> Option<Vec<u8>> {
            let mut e = z.by_name(name).ok()?;
            if e.size() as usize > MAX_DOC {
                return None;
            }
            let mut v = Vec::new();
            e.read_to_end(&mut v).ok()?;
            Some(v)
        };
        let meta: Meta = serde_json::from_slice(&read("meta.json").ok_or_else(|| Error::Other("o arquivo não é um projeto do CommandProject".into()))?)
            .map_err(|e| Error::Other(format!("projeto inválido: {e}")))?;
        let doc: Value = serde_json::from_slice(&read("doc.json").ok_or_else(|| Error::Other("projeto sem documento".into()))?)
            .map_err(|e| Error::Other(format!("projeto inválido: {e}")))?;
        let thumb = read("thumb.png");
        let mut created = self.create(meta.kind, &meta.name, &doc)?;
        let dst = self.root.join(&created.id);
        let names: Vec<String> = (0..z.len()).filter_map(|i| z.by_index(i).ok().and_then(|e| e.name().ok().map(|n| n.into_owned()))).collect();
        for n in names {
            let Some(rest) = n.strip_prefix("assets/") else { continue };
            let Some(clean) = safe_asset_name(rest) else { continue };
            let mut e = z.by_name(&n).map_err(|e| Error::archive(src, e))?;
            if e.size() as usize > MAX_ASSET {
                continue;
            }
            let mut v = Vec::new();
            e.read_to_end(&mut v).at(src)?;
            write_atomic(&dst.join("assets").join(clean), &v)?;
        }
        if let Some(t) = thumb.filter(|t| t.starts_with(b"\x89PNG")) {
            write_atomic(&dst.join("thumb.png"), &t)?;
            created.has_thumb = true;
        }
        created.description = meta.description;
        created.tags = meta.tags;
        write_json(&dst.join("meta.json"), &created)?;
        Ok(created)
    }
}

fn modified(p: &Path) -> Option<std::time::SystemTime> {
    fs::metadata(p).and_then(|m| m.modified()).ok()
}

fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst).at(dst)?;
    if let Ok(rd) = fs::read_dir(src) {
        for e in rd.flatten() {
            if e.path().is_file() {
                fs::copy(e.path(), dst.join(e.file_name())).at(e.path())?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn create_save_versions_recovery_and_trash() {
        let t = tempfile::tempdir().unwrap();
        let c = Creations::open(t.path()).unwrap();
        let m = c.create(Kind::Map, "Ilha do Norte!", &json!({"schema": 1, "a": 1})).unwrap();
        assert!(m.id.starts_with("mapa-ilha-do-norte-"));
        assert_eq!(c.list().unwrap().len(), 1);

        c.save(&m.id, &json!({"schema": 1, "a": 2}), true).unwrap();
        c.save(&m.id, &json!({"schema": 1, "a": 3}), true).unwrap();
        let v = c.versions(&m.id).unwrap();
        assert_eq!(v.len(), 2);
        assert_eq!(c.load(&m.id).unwrap().doc["a"], 3);

        // salvamento automático mais novo: aparece como recuperação
        std::thread::sleep(std::time::Duration::from_millis(20));
        c.autosave(&m.id, &json!({"schema": 1, "a": 9})).unwrap();
        let l = c.load(&m.id).unwrap();
        assert!(l.recovery_at.is_some());
        assert_eq!(c.recovery(&m.id).unwrap()["a"], 9);
        c.discard_recovery(&m.id).unwrap();
        assert!(c.load(&m.id).unwrap().recovery_at.is_none());

        // voltar para a versão mais antiga (a=1) e a atual vira versão
        let oldest = v.last().unwrap().file.clone();
        assert_eq!(c.restore(&m.id, &oldest).unwrap()["a"], 1);
        assert_eq!(c.versions(&m.id).unwrap().len(), 3);
        assert!(c.restore(&m.id, "../meta.json").is_err());

        let dup = c.duplicate(&m.id).unwrap();
        assert_ne!(dup.id, m.id);
        assert!(dup.name.ends_with("(cópia)"));
        c.delete(&m.id).unwrap();
        assert_eq!(c.list().unwrap().len(), 1);
        assert!(c.load(&m.id).is_err());
        assert!(c.load("../x").is_err());
    }

    #[test]
    fn assets_dedupe_and_export_import_roundtrip() {
        let t = tempfile::tempdir().unwrap();
        let c = Creations::open(t.path()).unwrap();
        let m = c.create(Kind::Model, "Torre", &json!({"schema": 1, "parts": []})).unwrap();
        let a = c.asset_put(&m.id, "../../Minha Textura.png", b"\x89PNGdados").unwrap();
        assert!(a.starts_with("Minha_Textura-") && a.ends_with(".png"), "{a}");
        assert_eq!(c.asset_put(&m.id, "Minha Textura.png", b"\x89PNGdados").unwrap(), a);
        assert_eq!(c.asset_get(&m.id, &a).unwrap(), b"\x89PNGdados");
        c.set_thumb(&m.id, b"\x89PNGthumb").unwrap();
        c.update_meta(&m.id, Some("Torre de vigia"), Some("alta"), Some(true), Some(vec!["defesa".into()])).unwrap();

        let zip = t.path().join("torre.cpproj");
        c.export(&m.id, &zip).unwrap();
        let imported = c.import(&zip).unwrap();
        assert_ne!(imported.id, m.id);
        assert_eq!(imported.name, "Torre de vigia");
        assert!(!imported.favorite && imported.has_thumb);
        assert_eq!(c.assets(&imported.id).unwrap().len(), 1);
        assert_eq!(c.load(&imported.id).unwrap().doc["schema"], 1);
    }
}
