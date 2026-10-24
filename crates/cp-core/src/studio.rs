//! Estúdio de criação: projetos de mod (estilo "workspace" do Forge), edição de texturas,
//! "skins" de interface em lote e empacotamento para a biblioteca.

use crate::dds::{self, ColorAdjust, Quality};
use crate::error::{Error, IoContext, Result};
use crate::fsutil::{read_json, safe_file_name, slugify, write_json};
use crate::library::{ImportOptions, Library};
use crate::manifest::{Category, Manifest, MpPolicy, Source};
use crate::scd::{normalize_key, Scd, ScdBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub category: Category,
    #[serde(default)]
    pub multiplayer: MpPolicy,
    /// Nome do .scd gerado (prefixo `zz_` para carregar depois dos arquivos do jogo).
    pub archive_name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    /// Caminho interno no jogo (`/lua/ui/game/hud.lua`).
    pub path: String,
    pub size: u64,
    /// "lua" | "texture" | "model" | "blueprint" | "audio" | "other"
    pub kind: String,
}

pub fn file_kind(path: &str) -> &'static str {
    let p = path.to_ascii_lowercase();
    if p.ends_with(".lua") {
        "lua"
    } else if p.ends_with(".dds") || p.ends_with(".png") || p.ends_with(".tga") {
        "texture"
    } else if p.ends_with(".scm") || p.ends_with(".sca") {
        "model"
    } else if p.ends_with(".bp") {
        "blueprint"
    } else if p.ends_with(".ogg") || p.ends_with(".wav") || p.ends_with(".xwb") || p.ends_with(".xsb") {
        "audio"
    } else {
        "other"
    }
}

pub struct Studio {
    root: PathBuf,
}

impl Studio {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root).at(root)?;
        Ok(Studio {
            root: root.to_path_buf(),
        })
    }

    fn dir(&self, id: &str) -> Result<PathBuf> {
        Ok(self.root.join(safe_file_name(id)?))
    }

    fn content(&self, id: &str) -> Result<PathBuf> {
        Ok(self.dir(id)?.join("content"))
    }

    pub fn list(&self) -> Result<Vec<Project>> {
        let mut out = Vec::new();
        for e in fs::read_dir(&self.root).at(&self.root)?.flatten() {
            let p = e.path().join("project.json");
            if let Ok(pr) = read_json::<Project>(&p) {
                out.push(pr);
            }
        }
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Project> {
        read_json(&self.dir(id)?.join("project.json"))
    }

    pub fn create(&self, name: &str, category: Category) -> Result<Project> {
        let base = slugify(name);
        let mut id = base.clone();
        let mut n = 2;
        while self.root.join(&id).exists() {
            id = format!("{base}-{n}");
            n += 1;
        }
        let p = Project {
            archive_name: format!("zz_{}.scd", id.replace('-', "_")),
            id: id.clone(),
            name: name.trim().to_string(),
            version: "0.1.0".into(),
            description: String::new(),
            category,
            multiplayer: MpPolicy::Sync,
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        fs::create_dir_all(self.content(&id)?).at(&self.root)?;
        write_json(&self.dir(&id)?.join("project.json"), &p)?;
        Ok(p)
    }

    pub fn save_meta(&self, p: &Project) -> Result<()> {
        if p.name.trim().is_empty() {
            return Err(Error::Other("o nome do projeto não pode ficar vazio".into()));
        }
        let name = safe_file_name(&p.archive_name)?;
        if !name.to_ascii_lowercase().ends_with(".scd") {
            return Err(Error::Other("o arquivo gerado precisa terminar em .scd".into()));
        }
        write_json(&self.dir(&p.id)?.join("project.json"), p)
    }

    pub fn delete(&self, id: &str) -> Result<()> {
        let d = self.dir(id)?;
        fs::remove_dir_all(&d).at(&d)
    }

    /// Converte um caminho interno em caminho dentro da pasta `content`, recusando fugas.
    fn resolve(&self, id: &str, internal: &str) -> Result<PathBuf> {
        let key = normalize_key(internal);
        let rel = Path::new(key.trim_start_matches('/'));
        if rel.components().any(|c| !matches!(c, Component::Normal(_))) || rel.as_os_str().is_empty() {
            return Err(Error::Other(format!("caminho inválido: {internal}")));
        }
        Ok(self.content(id)?.join(rel))
    }

    pub fn files(&self, id: &str) -> Result<Vec<ProjectFile>> {
        let content = self.content(id)?;
        let mut out = Vec::new();
        for e in walkdir::WalkDir::new(&content).into_iter().filter_map(|e| e.ok()) {
            if e.file_type().is_file() {
                let rel = e
                    .path()
                    .strip_prefix(&content)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                let path = format!("/{rel}");
                out.push(ProjectFile {
                    kind: file_kind(&path).into(),
                    size: e.metadata().map(|m| m.len()).unwrap_or(0),
                    path,
                });
            }
        }
        out.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(out)
    }

    pub fn read_file(&self, id: &str, internal: &str) -> Result<Vec<u8>> {
        let p = self.resolve(id, internal)?;
        fs::read(&p).at(&p)
    }

    pub fn write_file(&self, id: &str, internal: &str, data: &[u8]) -> Result<()> {
        let p = self.resolve(id, internal)?;
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).at(parent)?;
        }
        crate::fsutil::write_atomic(&p, data)
    }

    pub fn delete_file(&self, id: &str, internal: &str) -> Result<()> {
        let p = self.resolve(id, internal)?;
        fs::remove_file(&p).at(&p)?;
        // limpa pastas vazias
        let content = self.content(id)?;
        let mut dir = p.parent().map(Path::to_path_buf);
        while let Some(d) = dir {
            if d == content || fs::remove_dir(&d).is_err() {
                break;
            }
            dir = d.parent().map(Path::to_path_buf);
        }
        Ok(())
    }

    /// Copia um arquivo do jogo para o projeto ("sobrescrever no meu mod").
    pub fn override_from_archive(&self, id: &str, archive: &Path, internal: &str) -> Result<String> {
        let data = Scd::open(archive)?.read(internal)?;
        let key = normalize_key(internal);
        self.write_file(id, &key, &data)?;
        Ok(key)
    }

    /// Substitui (ou cria) uma textura do projeto a partir de um PNG, mantendo o formato
    /// DDS e a quantidade de mipmaps do original. `reference` é o DDS original (do jogo
    /// ou do próprio projeto); sem referência, usa DXT5 com cadeia completa.
    pub fn import_png_as_dds(
        &self,
        id: &str,
        internal: &str,
        png: &[u8],
        reference: Option<&[u8]>,
        resize_to_reference: bool,
    ) -> Result<dds::DdsInfo> {
        let mut img = dds::from_png(png)?;
        let (format, mips, size) = match reference.map(dds::info).transpose()? {
            Some(i) => (i.format, i.mip_count, Some((i.width, i.height))),
            None => (dds::DdsFormat::Dxt5, 0, None),
        };
        if let Some((w, h)) = size {
            if (img.width, img.height) != (w, h) {
                if resize_to_reference {
                    img = dds::resize(&img, w, h);
                } else if !(img.width.is_power_of_two() && img.height.is_power_of_two()) {
                    return Err(Error::Format(format!(
                        "a imagem tem {}x{} — use potências de 2 ou ative \"redimensionar para o original\" ({w}x{h})",
                        img.width, img.height
                    )));
                }
            }
        }
        let out = dds::encode(&img, format, if mips <= 1 { 1 } else { 0 }, Quality::Normal)?;
        self.write_file(id, internal, &out)?;
        dds::info(&out)
    }

    /// Gera o `.scd` do projeto e instala/atualiza na biblioteca como mod.
    pub fn build(&self, id: &str, library: &Library) -> Result<Manifest> {
        let p = self.get(id)?;
        let files = self.files(id)?;
        if files.is_empty() {
            return Err(Error::Other("o projeto ainda não tem arquivos".into()));
        }
        // avisa sobre Lua com problemas óbvios antes de empacotar
        for f in files.iter().filter(|f| f.kind == "lua") {
            let data = self.read_file(id, &f.path)?;
            let info = crate::lua::inspect(&data);
            if let Some(w) = info.warnings.first() {
                return Err(Error::Other(format!("{}: {w} — corrija antes de gerar o mod", f.path)));
            }
        }
        let build_dir = self.dir(id)?.join("build");
        let _ = fs::remove_dir_all(&build_dir);
        let out = build_dir.join(safe_file_name(&p.archive_name)?);
        let mut b = ScdBuilder::create(&out)?;
        b.add_dir(&self.content(id)?)?;
        b.finish()?;
        let opts = ImportOptions {
            id: Some(p.id.clone()),
            name: Some(p.name.clone()),
            version: Some(p.version.clone()),
            category: Some(p.category),
            description: Some(p.description.clone()),
            multiplayer: Some(p.multiplayer),
            replace: true,
            source: Some(Source {
                kind: "studio".into(),
                url: None,
                hub_id: None,
            }),
            move_source: false,
        };
        library.import(&out, &opts)
    }

    /// Exporta o projeto como pacote `.zip` pronto para publicar no hub (scd + mod.json).
    pub fn export_package(&self, id: &str, library: &Library, dest: &Path) -> Result<PathBuf> {
        let m = library.get(id)?;
        let mut b = ScdBuilder::create(dest)?;
        for f in &m.manifest.files {
            b.add_file(&f.name, &m.file_path(&f.name))?;
        }
        let mut man = m.manifest.clone();
        man.installed_at = None;
        man.source = Source::default();
        let json = serde_json::to_vec_pretty(&man).map_err(|e| Error::Other(e.to_string()))?;
        b.add_bytes(crate::manifest::MANIFEST_FILE, &json)?;
        b.finish()
    }
}

/// Opções da "skin de interface": recolore em lote todas as texturas sob os prefixos.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSkinOptions {
    pub name: String,
    pub adjust: ColorAdjust,
    /// Ex.: `["/textures/ui/"]`.
    pub prefixes: Vec<String>,
    /// Caminhos a ignorar (ex.: ícones de unidade que devem manter cores de facção).
    #[serde(default)]
    pub exclude: Vec<String>,
    #[serde(default)]
    pub quality: Quality,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSkinResult {
    pub archive: PathBuf,
    pub textures: usize,
    pub skipped: Vec<String>,
}

/// Lista as texturas que uma skin afetaria (para a interface mostrar antes de gerar).
pub fn ui_skin_targets(sources: &[PathBuf], opts: &UiSkinOptions) -> Result<Vec<(PathBuf, String)>> {
    let prefixes: Vec<String> = opts.prefixes.iter().map(|p| normalize_key(p)).collect();
    let excludes: Vec<String> = opts.exclude.iter().map(|p| normalize_key(p)).collect();
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    // arquivos montados depois vencem: percorre do último para o primeiro
    for src in sources.iter().rev() {
        let mut scd = Scd::open(src)?;
        for e in scd.entries()? {
            if e.is_dir || !e.key.ends_with(".dds") {
                continue;
            }
            if !prefixes.iter().any(|p| e.key.starts_with(p.as_str())) {
                continue;
            }
            if excludes.iter().any(|x| e.key.starts_with(x.as_str())) {
                continue;
            }
            if seen.insert(e.key.clone()) {
                out.push((src.clone(), e.name));
            }
        }
    }
    out.sort_by(|a, b| a.1.cmp(&b.1));
    Ok(out)
}

/// Gera um `.scd` com as texturas recoloridas (só as afetadas — o mod fica pequeno).
pub fn build_ui_skin(
    sources: &[PathBuf],
    opts: &UiSkinOptions,
    dest: &Path,
    progress: &mut dyn FnMut(usize, usize, &str),
) -> Result<UiSkinResult> {
    let targets = ui_skin_targets(sources, opts)?;
    if targets.is_empty() {
        return Err(Error::Other("nenhuma textura encontrada com esses prefixos".into()));
    }
    let mut b = ScdBuilder::create(dest)?;
    let mut skipped = Vec::new();
    let mut count = 0;
    let mut open: Option<(PathBuf, Scd)> = None;
    let total = targets.len();
    for (i, (src, name)) in targets.iter().enumerate() {
        progress(i + 1, total, name);
        if open.as_ref().map(|(p, _)| p != src).unwrap_or(true) {
            open = Some((src.clone(), Scd::open(src)?));
        }
        let scd = &mut open.as_mut().unwrap().1;
        let data = scd.read(name)?;
        match dds::decode(&data) {
            Ok((info, mut img)) => {
                dds::adjust(&mut img, &opts.adjust);
                let mips = if info.mip_count <= 1 { 1 } else { 0 };
                let enc = dds::encode(&img, info.format, mips, opts.quality)?;
                b.add_bytes(name, &enc)?;
                count += 1;
            }
            Err(e) => skipped.push(format!("{name}: {e}")),
        }
    }
    let archive = b.finish()?;
    Ok(UiSkinResult {
        archive,
        textures: count,
        skipped,
    })
}

/// Pré-visualização de um ajuste numa textura (devolve PNG).
pub fn preview_adjust(dds_bytes: &[u8], adjust: &ColorAdjust) -> Result<Vec<u8>> {
    let (_, mut img) = dds::decode(dds_bytes)?;
    dds::adjust(&mut img, adjust);
    dds::to_png(&img)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dds::{DdsFormat, Rgba};
    use crate::library::tests::make_scd;

    fn red_dds() -> Vec<u8> {
        let img = Rgba {
            width: 8,
            height: 8,
            pixels: [200u8, 30, 30, 255].repeat(64),
        };
        dds::encode(&img, DdsFormat::Dxt5, 0, Quality::Fast).unwrap()
    }

    #[test]
    fn project_lifecycle() {
        let t = tempfile::tempdir().unwrap();
        let studio = Studio::open(&t.path().join("projects")).unwrap();
        let lib = Library::open(&t.path().join("lib")).unwrap();
        let game_scd = t.path().join("textures.scd");
        make_scd(
            &game_scd,
            &[
                ("textures/ui/common/btn.dds", &red_dds()),
                ("lua/ui/game/hud.lua", b"local x = 1\n"),
            ],
        );

        let p = studio.create("Meu HUD Azul", Category::Ui).unwrap();
        assert_eq!(p.archive_name, "zz_meu_hud_azul.scd");
        assert!(studio.build(&p.id, &lib).is_err(), "projeto vazio não gera");

        let key = studio
            .override_from_archive(&p.id, &game_scd, "LUA\\ui\\game\\hud.lua")
            .unwrap();
        assert_eq!(key, "/lua/ui/game/hud.lua");
        studio.write_file(&p.id, &key, b"local x = 2\nfunction F()\n").unwrap();
        let err = studio.build(&p.id, &lib).unwrap_err().to_string();
        assert!(err.contains("sem \"end\""), "{err}");
        studio
            .write_file(&p.id, &key, b"local x = 2\nfunction F() end\n")
            .unwrap();

        // textura: exporta PNG, "edita" e importa mantendo o formato
        let orig = Scd::open(&game_scd)
            .unwrap()
            .read("/textures/ui/common/btn.dds")
            .unwrap();
        let (_, img) = dds::decode(&orig).unwrap();
        let png = dds::to_png(&img).unwrap();
        let info = studio
            .import_png_as_dds(&p.id, "/textures/ui/common/btn.dds", &png, Some(&orig), true)
            .unwrap();
        assert_eq!(info.format, DdsFormat::Dxt5);
        assert_eq!(info.mip_count, 4);
        assert!(studio.write_file(&p.id, "/../../fuga.lua", b"x").is_err());

        let files = studio.files(&p.id).unwrap();
        assert_eq!(files.len(), 2);
        let m = studio.build(&p.id, &lib).unwrap();
        assert_eq!(m.source.kind, "studio");
        assert_eq!(m.files[0].name, "zz_meu_hud_azul.scd");
        let built = lib.get(&p.id).unwrap();
        let mut scd = Scd::open(&built.file_path("zz_meu_hud_azul.scd")).unwrap();
        assert_eq!(
            scd.read("/lua/ui/game/hud.lua").unwrap(),
            b"local x = 2\nfunction F() end\n"
        );

        let pkg = studio.export_package(&p.id, &lib, &t.path().join("pub.zip")).unwrap();
        let lib2 = Library::open(&t.path().join("lib2")).unwrap();
        let again = lib2.import(&pkg, &ImportOptions::default()).unwrap();
        assert_eq!(again.id, p.id, "pacote exportado reimporta com o mesmo id");

        studio.delete_file(&p.id, &key).unwrap();
        assert_eq!(studio.files(&p.id).unwrap().len(), 1);
    }

    #[test]
    fn ui_skin_recolors_only_matching() {
        let t = tempfile::tempdir().unwrap();
        let a = t.path().join("textures.scd");
        let b = t.path().join("zz_mod.scd");
        make_scd(
            &a,
            &[
                ("textures/ui/a.dds", &red_dds()),
                ("textures/ui/icons/u.dds", &red_dds()),
                ("textures/units/x.dds", &red_dds()),
            ],
        );
        make_scd(
            &b,
            &[
                ("textures/ui/a.dds", &red_dds()),
                ("textures/ui/broken.dds", b"DDS lixo"),
            ],
        );
        let opts = UiSkinOptions {
            name: "Azul".into(),
            adjust: ColorAdjust {
                hue: 220.0,
                ..ColorAdjust::identity()
            },
            prefixes: vec!["/textures/ui".into()],
            exclude: vec!["/textures/ui/icons".into()],
            quality: Quality::Fast,
        };
        let sources = vec![a.clone(), b.clone()];
        let targets = ui_skin_targets(&sources, &opts).unwrap();
        assert_eq!(targets.len(), 2, "{targets:?}");
        assert_eq!(
            targets.iter().find(|(_, n)| n.ends_with("a.dds")).unwrap().0,
            b,
            "versão do mod vence"
        );
        let res = build_ui_skin(&sources, &opts, &t.path().join("out.scd"), &mut |_, _, _| {}).unwrap();
        assert_eq!(res.textures, 1);
        assert_eq!(res.skipped.len(), 1);
        let out = Scd::open(&res.archive).unwrap().read("textures/ui/a.dds").unwrap();
        let (_, img) = dds::decode(&out).unwrap();
        assert!(img.pixels[2] > img.pixels[0], "ficou azulado: {:?}", &img.pixels[..4]);
    }
}
