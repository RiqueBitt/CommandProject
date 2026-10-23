//! Fachada de alto nível usada pelo app e pela CLI: junta jogo, biblioteca, perfis,
//! implantação, estúdio e multiplayer num único objeto.

use crate::conflicts::{self, ConflictReport, Provider};
use crate::deploy::{BaselineKind, DeployKind, Deployer, FileStatus, Plan, Progress};
use crate::error::{Error, IoContext, Result};
use crate::game::{self, GameInstall, LaunchPlan, Store};
use crate::hashcache::HashCache;
use crate::library::{ImportOptions, InstalledMod, Library};
use crate::manifest::{Category, Manifest, Source};
use crate::maptk::{self, Bridge, BridgeEvent};
use crate::profile::{ProfileMod, Profiles};
use crate::scd::{Scd, ScdEntry};
use crate::settings::Settings;
use crate::studio::Studio;
use crate::sync::{self, Fingerprint, SyncItem, SyncPayload};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// (arquivo .scd, entrada .scm, textura albedo) de uma unidade.
pub type UnitModel = (PathBuf, String, Option<String>);

pub struct Workspace {
    pub data_dir: PathBuf,
    pub resources_dir: Option<PathBuf>,
    pub settings: Settings,
    pub library: Library,
    pub profiles: Profiles,
    pub studio: Studio,
    hashes: HashCache,
    game: Option<GameInstall>,
    entry_cache: HashMap<PathBuf, Vec<String>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub game: Option<GameInstall>,
    pub game_running: bool,
    pub active_profile: String,
    pub active_profile_name: String,
    pub enabled_mods: usize,
    pub installed_mods: usize,
    pub deployed_profile: Option<String>,
    pub deployed_at: Option<String>,
    pub in_sync: bool,
    pub pending: Plan,
    pub has_baseline: bool,
    pub unmanaged_files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveInfo {
    pub name: String,
    pub size: u64,
    /// "stock" | "unmanaged" | "managed" | "new"
    pub origin: String,
    pub mod_id: Option<String>,
}

impl Workspace {
    pub fn open(data_dir: &Path, resources_dir: Option<PathBuf>) -> Result<Self> {
        std::fs::create_dir_all(data_dir).at(data_dir)?;
        let settings = Settings::load(&data_dir.join("settings.json"))?;
        let mut ws = Workspace {
            library: Library::open(&data_dir.join("library"))?,
            profiles: Profiles::load(&data_dir.join("profiles.json"))?,
            studio: Studio::open(&data_dir.join("projects"))?,
            hashes: HashCache::load(&data_dir.join("hashcache.json")),
            data_dir: data_dir.to_path_buf(),
            resources_dir,
            settings,
            game: None,
            entry_cache: HashMap::new(),
        };
        ws.refresh_game();
        Ok(ws)
    }

    // ---------------------------------------------------------------- jogo

    pub fn refresh_game(&mut self) -> Option<&GameInstall> {
        self.game = match &self.settings.game_path {
            Some(p) => GameInstall::from_dir(p, Store::Manual).ok().map(|mut g| {
                // se a pasta manual for a da Steam, mantém o modo Steam
                if p.to_string_lossy().to_ascii_lowercase().contains("steamapps") {
                    g.store = Store::Steam;
                }
                g
            }),
            None => game::detect(),
        };
        self.game.as_ref()
    }

    pub fn game(&self) -> Result<&GameInstall> {
        self.game.as_ref().ok_or(Error::GameNotFound)
    }

    pub fn set_game_path(&mut self, path: Option<PathBuf>) -> Result<Option<GameInstall>> {
        if let Some(p) = &path {
            GameInstall::from_dir(p, Store::Manual)?; // valida antes de salvar
        }
        self.settings.game_path = path;
        self.save_settings()?;
        Ok(self.refresh_game().cloned())
    }

    pub fn save_settings(&self) -> Result<()> {
        self.settings.save(&self.data_dir.join("settings.json"))
    }

    fn deployer(&mut self) -> Result<Deployer<'_>> {
        let game = self.game.as_ref().ok_or(Error::GameNotFound)?;
        Ok(Deployer {
            game,
            data_dir: &self.data_dir,
            hashes: &mut self.hashes,
        })
    }

    fn guard_not_running(&self) -> Result<()> {
        if game::is_running() {
            Err(Error::GameRunning)
        } else {
            Ok(())
        }
    }

    pub fn dashboard(&mut self) -> Result<Dashboard> {
        let active = self.profiles.active().clone();
        let installed = self.library.list()?.len();
        let mut d = Dashboard {
            game: self.game.clone(),
            game_running: game::is_running(),
            active_profile: active.id.clone(),
            active_profile_name: active.name.clone(),
            enabled_mods: active.enabled_ids().len(),
            installed_mods: installed,
            deployed_profile: None,
            deployed_at: None,
            in_sync: false,
            pending: Plan::default(),
            has_baseline: false,
            unmanaged_files: vec![],
        };
        if self.game.is_none() {
            return Ok(d);
        }
        let lib = &self.library;
        let dep = Deployer {
            game: self.game.as_ref().unwrap(),
            data_dir: &self.data_dir,
            hashes: &mut self.hashes,
        };
        let j = dep.journal()?;
        d.deployed_profile = j.profile.clone();
        d.deployed_at = j.deployed_at.clone();
        let mut warnings = vec![];
        let targets = dep.targets(lib, &active, &mut warnings)?;
        let mut plan = dep.plan(&targets)?;
        plan.warnings = warnings;
        d.in_sync = plan.is_noop();
        d.pending = plan;
        if let Some(b) = dep.baseline()? {
            d.has_baseline = true;
            d.unmanaged_files = b
                .files
                .values()
                .filter(|f| f.kind == BaselineKind::Unmanaged)
                .filter(|f| self.game.as_ref().unwrap().gamedata.join(&f.name).exists())
                .map(|f| f.name.clone())
                .collect();
        }
        Ok(d)
    }

    // ---------------------------------------------------------------- implantação

    pub fn plan_active(&mut self) -> Result<Plan> {
        let active = self.profiles.active().clone();
        let lib = &self.library;
        let game = self.game.as_ref().ok_or(Error::GameNotFound)?;
        let dep = Deployer {
            game,
            data_dir: &self.data_dir,
            hashes: &mut self.hashes,
        };
        let mut w = vec![];
        let t = dep.targets(lib, &active, &mut w)?;
        let mut p = dep.plan(&t)?;
        p.warnings.extend(w);
        Ok(p)
    }

    pub fn apply_active(&mut self, progress: &mut dyn FnMut(Progress)) -> Result<Plan> {
        self.guard_not_running()?;
        let active = self.profiles.active().clone();
        let lib = &self.library;
        let game = self.game.as_ref().ok_or(Error::GameNotFound)?;
        let mut dep = Deployer {
            game,
            data_dir: &self.data_dir,
            hashes: &mut self.hashes,
        };
        let mut w = vec![];
        let t = dep.targets(lib, &active, &mut w)?;
        let mut p = dep.apply(&t, Some(&active.id), progress)?;
        p.warnings.extend(w);
        Ok(p)
    }

    pub fn purge(&mut self, progress: &mut dyn FnMut(Progress)) -> Result<Plan> {
        self.guard_not_running()?;
        self.deployer()?.purge(progress)
    }

    pub fn recover(&mut self) -> Result<Option<String>> {
        if self.game.is_none() {
            return Ok(None);
        }
        self.deployer()?.recover()
    }

    pub fn scan_baseline(&mut self, progress: &mut dyn FnMut(Progress)) -> Result<()> {
        self.deployer()?.ensure_baseline(progress).map(|_| ())
    }

    pub fn file_status(&mut self) -> Result<Vec<FileStatus>> {
        self.deployer()?.status()
    }

    pub fn set_baseline_kind(&mut self, name: &str, kind: BaselineKind) -> Result<()> {
        self.deployer()?.set_baseline_kind(name, kind)
    }

    /// Transforma um `.scd` instalado à mão num mod da biblioteca (sem mexer no jogo).
    pub fn adopt_unmanaged(&mut self, name: &str) -> Result<Manifest> {
        let path = self.game()?.gamedata.join(crate::fsutil::safe_file_name(name)?);
        let opts = ImportOptions {
            source: Some(Source {
                kind: "adopted".into(),
                url: None,
                hub_id: None,
            }),
            ..Default::default()
        };
        let mut opts = opts;
        // evita colisão de id com um mod já existente
        let base = crate::fsutil::slugify(
            path.file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .trim_start_matches(['_', ' '])
                .trim_start_matches("zz_"),
        );
        let mut id = base.clone();
        let mut n = 2;
        while self.library.contains(&id) {
            id = format!("{base}-{n}");
            n += 1;
        }
        opts.id = Some(id);
        let m = self.library.import(&path, &opts)?;
        self.deployer()?.adopt(name, &m.id, &m.version)?;
        let active = self.profiles.active().id.clone();
        self.profiles.set_enabled(&active, &m.id, true)?;
        Ok(m)
    }

    // ---------------------------------------------------------------- biblioteca

    pub fn mods(&self) -> Result<Vec<InstalledMod>> {
        self.library.list()
    }

    pub fn import_mod(&mut self, path: &Path, opts: &ImportOptions, enable: bool) -> Result<Manifest> {
        let m = self.library.import(path, opts)?;
        if enable {
            let active = self.profiles.active().id.clone();
            self.profiles.set_enabled(&active, &m.id, true)?;
        }
        Ok(m)
    }

    pub fn remove_mod(&mut self, id: &str) -> Result<()> {
        // se está implantado, o próximo "aplicar" o remove do jogo
        self.library.remove(id)?;
        self.profiles.forget_mod(id)
    }

    // ---------------------------------------------------------------- conflitos

    pub fn conflicts_active(&mut self) -> Result<ConflictReport> {
        let active = self.profiles.active().clone();
        let game = self.game.as_ref().ok_or(Error::GameNotFound)?.clone();
        let lib = &self.library;
        let dep = Deployer {
            game: &game,
            data_dir: &self.data_dir,
            hashes: &mut self.hashes,
        };
        let mut w = vec![];
        let targets = dep.targets(lib, &active, &mut w)?;
        let journal = dep.journal()?;
        let mut providers = Vec::new();
        for path in game.archives()? {
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if targets.iter().any(|t| t.name.eq_ignore_ascii_case(&name)) {
                continue; // será substituído pelo mod
            }
            if journal.entries.iter().any(|e| e.name.eq_ignore_ascii_case(&name)) {
                continue; // implantado por um mod que não está mais ativo
            }
            providers.push(Provider {
                archive: name,
                path,
                mod_id: None,
            });
        }
        for t in targets {
            providers.push(Provider {
                archive: t.name,
                path: t.source,
                mod_id: Some(t.mod_id),
            });
        }
        conflicts::analyze(&providers, &mut self.entry_cache)
    }

    // ---------------------------------------------------------------- navegador de arquivos

    pub fn archives(&mut self) -> Result<Vec<ArchiveInfo>> {
        Ok(self
            .file_status()?
            .into_iter()
            .filter(|s| s.state != "missing")
            .map(|s| ArchiveInfo {
                name: s.name,
                size: s.size,
                origin: s.origin,
                mod_id: s.mod_id,
            })
            .collect())
    }

    /// Caminho do arquivo original (se um mod o substituiu, usa o backup).
    pub fn original_archive(&mut self, name: &str) -> Result<PathBuf> {
        let name = crate::fsutil::safe_file_name(name)?;
        let game = self.game()?.clone();
        let dep = Deployer {
            game: &game,
            data_dir: &self.data_dir,
            hashes: &mut self.hashes,
        };
        let j = dep.journal()?;
        if let Some(e) = j.entries.iter().find(|e| e.name.eq_ignore_ascii_case(&name)) {
            if let (DeployKind::Replaced, Some(b)) = (e.kind, &e.backup) {
                return Ok(self.data_dir.join("backups").join(format!("{b}.scd")));
            }
        }
        let p = game.gamedata.join(&name);
        if p.is_file() {
            Ok(p)
        } else {
            Err(Error::Other(format!("{name} não existe na pasta do jogo")))
        }
    }

    pub fn archive_entries(&mut self, name: &str, original: bool) -> Result<Vec<ScdEntry>> {
        let p = if original {
            self.original_archive(name)?
        } else {
            self.game()?.gamedata.join(crate::fsutil::safe_file_name(name)?)
        };
        Scd::open(&p)?.entries()
    }

    pub fn read_entry(&mut self, archive: &str, entry: &str, original: bool) -> Result<Vec<u8>> {
        let p = if original {
            self.original_archive(archive)?
        } else {
            self.game()?.gamedata.join(crate::fsutil::safe_file_name(archive)?)
        };
        Scd::open(&p)?.read(entry)
    }

    /// Arquivos originais (não-mods) em ordem de montagem — base para skins e prévias.
    pub fn stock_sources(&mut self) -> Result<Vec<PathBuf>> {
        let mut names: Vec<String> = self
            .file_status()?
            .into_iter()
            .filter(|s| s.state != "missing" && (s.origin == "stock" || s.origin == "managed"))
            .map(|s| s.name)
            .collect();
        conflicts::mount_order(&mut names);
        let mut out = Vec::new();
        let game = self.game()?.clone();
        let dep = Deployer {
            game: &game,
            data_dir: &self.data_dir,
            hashes: &mut self.hashes,
        };
        let j = dep.journal()?;
        for n in names {
            match j.entries.iter().find(|e| e.name.eq_ignore_ascii_case(&n)) {
                Some(e) if e.kind == DeployKind::Replaced => {
                    if let Some(b) = &e.backup {
                        out.push(self.data_dir.join("backups").join(format!("{b}.scd")));
                    }
                }
                Some(_) => {} // arquivo de mod: não é base
                None => out.push(game.gamedata.join(n)),
            }
        }
        Ok(out)
    }

    /// Para um Lua compilado (bytecode), procura a versão em texto que o jogo traz em
    /// `uncompiled_lua.scd` (caminho `/uncompiled/...`). Devolve (arquivo, bytes).
    pub fn uncompiled_version(&mut self, entry: &str) -> Result<Option<(String, Vec<u8>)>> {
        let key = crate::scd::normalize_key(entry);
        let candidates = [format!("/uncompiled{key}"), key.clone()];
        for src in self.stock_sources()?.iter().rev() {
            let Ok(mut scd) = Scd::open(src) else { continue };
            for c in &candidates {
                if let Ok(data) = scd.read(c) {
                    if !crate::lua::inspect(&data).compiled {
                        let name = src.file_name().unwrap_or_default().to_string_lossy().to_string();
                        return Ok(Some((name, data)));
                    }
                }
            }
        }
        Ok(None)
    }

    // ---------------------------------------------------------------- multiplayer

    pub fn fingerprint(&mut self) -> Result<Fingerprint> {
        let game = self.game()?.clone();
        let mut files = Vec::new();
        for p in game.archives()? {
            let sha = self.hashes.sha256(&p)?;
            files.push((p.file_name().unwrap().to_string_lossy().to_string(), sha));
        }
        self.hashes.save()?;
        Ok(sync::fingerprint(&files))
    }

    pub fn export_sync_code(&mut self, profile_id: Option<&str>) -> Result<String> {
        let profile = match profile_id {
            Some(id) => self.profiles.get(id)?.clone(),
            None => self.profiles.active().clone(),
        };
        // a assinatura só vale se a pasta já estiver aplicada com esse perfil
        let fp = match self.dashboard() {
            Ok(d) if d.in_sync && d.active_profile == profile.id => self.fingerprint().ok().map(|f| f.full),
            _ => None,
        };
        let payload = sync::payload_for(&self.library, &profile, fp)?;
        sync::encode(&payload)
    }

    pub fn inspect_sync_code(&self, code: &str) -> Result<(SyncPayload, Vec<SyncItem>)> {
        let p = sync::decode(code)?;
        let items = sync::compare(&self.library, &p);
        Ok((p, items))
    }

    /// Cria (ou atualiza) um perfil igual ao do código e o torna ativo.
    /// Mods faltando ou diferentes são listados para o usuário baixar antes.
    pub fn apply_sync_code(&mut self, code: &str) -> Result<(String, Vec<SyncItem>)> {
        let (p, items) = self.inspect_sync_code(code)?;
        let name = format!("Sincronizado: {}", p.profile);
        let existing = self
            .profiles
            .set
            .profiles
            .iter()
            .find(|x| x.name == name)
            .map(|x| x.id.clone());
        let id = match existing {
            Some(id) => id,
            None => self.profiles.create(&name, None)?.id,
        };
        let mods = p
            .mods
            .iter()
            .map(|m| ProfileMod {
                id: m.id.clone(),
                enabled: true,
            })
            .collect();
        self.profiles.replace_mods(&id, mods)?;
        self.profiles.set_active(&id)?;
        Ok((id, items))
    }

    // ---------------------------------------------------------------- jogar

    pub fn launch_plan(&self) -> Result<LaunchPlan> {
        game::launch_plan(self.game()?, self.settings.launch_mode, &self.settings.launch_args)
    }

    // ---------------------------------------------------------------- vitrine da tela inicial

    /// Modelos de unidade disponíveis (id → (arquivo .scd, entrada .scm, textura albedo)).
    pub fn unit_models(&mut self) -> Result<std::collections::BTreeMap<String, UnitModel>> {
        let mut out = std::collections::BTreeMap::new();
        let mut files: HashMap<String, Vec<(PathBuf, String)>> = HashMap::new();
        // os .scd montados por último vencem: percorre do primeiro para o último e sobrescreve
        for src in self.stock_sources()? {
            let mut scd = crate::scd::Scd::open(&src)?;
            for e in scd.entries()? {
                if e.is_dir || !e.key.starts_with("/units/") {
                    continue;
                }
                let mut parts = e.key.trim_start_matches('/').split('/');
                let (Some(_), Some(id)) = (parts.next(), parts.next()) else {
                    continue;
                };
                files
                    .entry(id.to_string())
                    .or_default()
                    .push((src.clone(), e.name.clone()));
            }
        }
        for (id, list) in files {
            let lower = |n: &str| n.to_ascii_lowercase();
            let scm = list
                .iter()
                .filter(|(_, n)| lower(n).ends_with(".scm"))
                .min_by_key(|(_, n)| (!lower(n).contains("lod0"), n.len()));
            let Some((src, scm)) = scm else { continue };
            let albedo = list
                .iter()
                .filter(|(s, n)| s == src && lower(n).ends_with(".dds"))
                .filter(|(_, n)| {
                    let l = lower(n);
                    !l.contains("normal") && !l.contains("spec") && !l.contains("mask") && !l.contains("lod1")
                })
                .min_by_key(|(_, n)| {
                    let l = lower(n);
                    (!(l.contains("albedo") || l.contains("diffuse")), n.len())
                })
                .map(|(_, n)| n.clone());
            out.insert(id.to_ascii_lowercase(), (src.clone(), scm.clone(), albedo));
        }
        Ok(out)
    }

    // ---------------------------------------------------------------- shaders (ReShade)

    /// Pasta do executável do jogo (onde o ReShade e os shaders ficam).
    pub fn game_bin_dir(&self) -> Result<PathBuf> {
        let g = self.game()?;
        Ok(match &g.exe {
            Some(exe) => exe
                .parent()
                .map(Path::to_path_buf)
                .unwrap_or_else(|| g.root.join("bin")),
            None => g.root.join("bin"),
        })
    }

    /// "Modo 4 GB" do executável do jogo.
    pub fn laa(&self) -> Result<crate::laa::Laa> {
        let exe = self
            .game()?
            .exe
            .clone()
            .ok_or_else(|| Error::Other("executável do jogo não encontrado".into()))?;
        Ok(crate::laa::Laa::new(exe, &self.data_dir))
    }

    /// Antes de jogar: se o usuário quer o modo 4 GB e ele sumiu (atualização da Steam), reaplica.
    pub fn ensure_large_address(&self) -> Result<bool> {
        if !self.settings.keep_large_address {
            return Ok(false);
        }
        let laa = self.laa()?;
        let st = laa.status()?;
        if st.enabled || st.is_64bit {
            return Ok(false);
        }
        laa.enable()?;
        Ok(true)
    }

    pub fn shaders(&self) -> Result<crate::shaders::Shaders> {
        let pack = self
            .resources_dir
            .as_ref()
            .map(|r| r.join("shaders"))
            .filter(|p| p.join("CommandProject.fx").is_file())
            .ok_or_else(|| Error::Other("o pacote de shaders não está instalado junto com o app".into()))?;
        Ok(crate::shaders::Shaders::new(self.game_bin_dir()?, pack, &self.data_dir))
    }

    // ---------------------------------------------------------------- estúdio de mapas

    pub fn map_bridge(&self) -> Result<Bridge> {
        let res = self.resources_dir.clone();
        let script_dir = res
            .as_ref()
            .map(|r| r.join("maptk"))
            .filter(|p| p.join("maptk_bridge.py").is_file())
            .ok_or_else(|| Error::Other("toolkit de mapas não está instalado junto com o app".into()))?;
        let bundled_py = res.as_ref().map(|r| r.join("python"));
        let python = maptk::find_python(self.settings.python_path.as_deref(), bundled_py.as_deref()).ok_or_else(|| {
            Error::Other(
                "Python 3.9+ não encontrado. Instale pelo site python.org (marque \"Add to PATH\") ou indique o caminho em Configurações.".into(),
            )
        })?;
        Ok(Bridge { python, script_dir })
    }

    pub fn maps_out_dir(&self) -> PathBuf {
        self.data_dir.join("maps")
    }

    pub fn run_map_tool(
        &self,
        command: &str,
        input: &serde_json::Value,
        on_event: &mut dyn FnMut(&BridgeEvent),
    ) -> Result<serde_json::Value> {
        let gamedata = self.game()?.gamedata.clone();
        // o toolkit lê os arquivos ORIGINAIS de mapas: se um mod substituiu maps.scd,
        // o resultado poderia sair diferente — avisamos na interface via dashboard
        self.map_bridge()?
            .run(command, input, &gamedata, &self.maps_out_dir(), on_event)
    }

    /// Importa um mapa gerado pelo toolkit como mod e o ativa no perfil atual.
    pub fn install_built_map(&mut self, scd: &Path, name: &str, scenario_id: &str) -> Result<Manifest> {
        let id = format!(
            "mapa-{}",
            crate::fsutil::slugify(&scenario_id.to_ascii_lowercase().replace("sc2_", ""))
        );
        let opts = ImportOptions {
            id: Some(id),
            name: Some(name.to_string()),
            category: Some(Category::Maps),
            description: Some(format!(
                "Mapa {scenario_id} criado no Estúdio de Mapas (SC2 Map Toolkit)."
            )),
            replace: true,
            source: Some(Source {
                kind: "studio".into(),
                url: None,
                hub_id: None,
            }),
            ..Default::default()
        };
        self.import_mod(scd, &opts, true)
    }
}

/// Identificador do app (o mesmo do `tauri.conf.json`).
pub const APP_IDENTIFIER: &str = "io.github.riquebitt.commandproject";

/// Pasta de dados compartilhada entre o app e a CLI.
/// `CP_DATA` sobrescreve (útil para testes e instalações portáteis).
pub fn default_data_dir() -> PathBuf {
    if let Some(p) = std::env::var_os("CP_DATA") {
        return PathBuf::from(p);
    }
    #[cfg(windows)]
    if let Some(p) = std::env::var_os("APPDATA") {
        return PathBuf::from(p).join(APP_IDENTIFIER);
    }
    if let Some(p) = std::env::var_os("XDG_DATA_HOME") {
        return PathBuf::from(p).join(APP_IDENTIFIER);
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "macos") {
        home.join("Library/Application Support").join(APP_IDENTIFIER)
    } else {
        home.join(".local/share").join(APP_IDENTIFIER)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::make_scd;

    #[test]
    fn finds_unit_models_and_albedo() {
        let tmp = tempfile::tempdir().unwrap();
        let game = tmp.path().join("SC2");
        let gd = game.join("gamedata");
        std::fs::create_dir_all(game.join("bin")).unwrap();
        std::fs::write(game.join("bin/SupremeCommander2.exe"), b"MZ").unwrap();
        let scm = crate::scm::write(&crate::scm::tests::cube()).unwrap();
        let dds = crate::dds::encode(
            &crate::dds::Rgba {
                width: 8,
                height: 8,
                pixels: [90u8, 120, 200, 255].repeat(64),
            },
            crate::dds::DdsFormat::Dxt1,
            1,
            crate::dds::Quality::Fast,
        )
        .unwrap();
        make_scd(
            &gd.join("units.scd"),
            &[
                ("units/uul0001/uul0001_lod0.scm", &scm),
                ("units/uul0001/uul0001_lod1.scm", &scm),
                ("units/uul0001/uul0001_normalsts.dds", &dds),
                ("units/uul0001/uul0001_albedo.dds", &dds),
                ("units/ucl0103/ucl0103_lod0.scm", &scm),
                ("units/ucl0103/ucl0103_albedo.dds", &dds),
                ("units/ucl0103/ucl0103_unit.bp", b"UnitBlueprint {}"),
            ],
        );
        make_scd(&gd.join("lua.scd"), &[("lua/x.lua", b"--")]);
        let mut ws = Workspace::open(&tmp.path().join("data"), None).unwrap();
        ws.set_game_path(Some(game)).unwrap();
        ws.scan_baseline(&mut |_| {}).unwrap();
        let m = ws.unit_models().unwrap();
        assert_eq!(m.keys().cloned().collect::<Vec<_>>(), vec!["ucl0103", "uul0001"]);
        let (_, scm_name, albedo) = &m["uul0001"];
        assert_eq!(scm_name, "units/uul0001/uul0001_lod0.scm");
        assert_eq!(albedo.as_deref(), Some("units/uul0001/uul0001_albedo.dds"));
    }
}
