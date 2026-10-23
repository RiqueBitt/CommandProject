//! Detecção da instalação do Supreme Commander 2 (Steam, GOG ou manual),
//! inventário da pasta `gamedata` e inicialização do jogo.

use crate::error::{Error, IoContext, Result};
use crate::vdf;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

pub const STEAM_APP_ID: u32 = 40100;
pub const GOG_PRODUCT_ID: &str = "1702120068";
pub const EXE_NAME: &str = "SupremeCommander2.exe";
pub const DEFAULT_INSTALL_DIR: &str = "Supreme Commander 2";

/// Arquivos que vêm com o jogo (Steam/GOG, com o DLC Infinite War).
/// Lista de referência — a fonte de verdade é a linha de base gravada na
/// primeira varredura, que o usuário confirma na interface.
pub const KNOWN_STOCK_ARCHIVES: &[&str] = &[
    "bp.scd",
    "lua.scd",
    "maps.scd",
    "textures.scd",
    "units.scd",
    "uncompiled_lua.scd",
    "z_dlc1.scd",
    "z_lua_dlc1.scd",
];

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Store {
    Steam,
    Gog,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GameInstall {
    pub root: PathBuf,
    pub gamedata: PathBuf,
    pub exe: Option<PathBuf>,
    pub store: Store,
}

impl GameInstall {
    /// Valida uma pasta escolhida pelo usuário (aceita a raiz do jogo,
    /// a pasta `gamedata` ou a pasta `bin`).
    pub fn from_dir(dir: &Path, store: Store) -> Result<Self> {
        let mut root = dir.to_path_buf();
        let name = dir.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase());
        if matches!(name.as_deref(), Some("gamedata") | Some("bin")) {
            if let Some(p) = dir.parent() {
                root = p.to_path_buf();
            }
        }
        let gamedata = find_child_ci(&root, "gamedata").ok_or(Error::GameNotFound)?;
        let exe = [root.join("bin"), root.clone()]
            .iter()
            .find_map(|d| find_child_ci(d, EXE_NAME))
            .filter(|p| p.is_file());
        Ok(GameInstall {
            root,
            gamedata,
            exe,
            store,
        })
    }

    pub fn bin_dir(&self) -> PathBuf {
        self.exe
            .as_ref()
            .and_then(|e| e.parent().map(Path::to_path_buf))
            .unwrap_or_else(|| self.root.join("bin"))
    }

    /// Lista os arquivos `.scd` da pasta gamedata (sem recursão; o jogo só monta o nível raiz).
    pub fn archives(&self) -> Result<Vec<PathBuf>> {
        let mut out = Vec::new();
        for entry in fs::read_dir(&self.gamedata).at(&self.gamedata)? {
            let entry = entry.at(&self.gamedata)?;
            let path = entry.path();
            let is_scd = path.extension().map(|e| e.eq_ignore_ascii_case("scd")).unwrap_or(false);
            if is_scd && path.is_file() {
                out.push(path);
            }
        }
        out.sort_by_key(|p| p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()));
        Ok(out)
    }
}

/// Procura a instalação automaticamente (Steam primeiro, depois GOG e caminhos comuns).
pub fn detect() -> Option<GameInstall> {
    detect_steam().or_else(detect_gog).or_else(detect_common_paths)
}

pub fn detect_steam() -> Option<GameInstall> {
    steam_roots().into_iter().find_map(|root| find_in_steam_root(&root))
}

/// Dado um diretório do Steam, segue `libraryfolders.vdf` e o `appmanifest`.
pub fn find_in_steam_root(steam_root: &Path) -> Option<GameInstall> {
    let mut libraries = vec![steam_root.to_path_buf()];
    let lf = steam_root.join("steamapps").join("libraryfolders.vdf");
    if let Ok(text) = fs::read_to_string(&lf) {
        let doc = vdf::parse(&text);
        if let Some(folders) = doc.get("libraryfolders") {
            for (_, entry) in folders.entries() {
                // formato novo: { "path" "..." } ; formato antigo: "1" "D:\\SteamLibrary"
                let p = entry.get("path").and_then(vdf::Vdf::str).or_else(|| entry.str());
                if let Some(p) = p {
                    let pb = PathBuf::from(p);
                    if !libraries.contains(&pb) {
                        libraries.push(pb);
                    }
                }
            }
        }
    }
    for lib in libraries {
        let steamapps = lib.join("steamapps");
        let manifest = steamapps.join(format!("appmanifest_{STEAM_APP_ID}.acf"));
        let install_dir = fs::read_to_string(&manifest)
            .ok()
            .and_then(|t| {
                vdf::parse(&t)
                    .path(&["AppState", "installdir"])
                    .and_then(vdf::Vdf::str)
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| DEFAULT_INSTALL_DIR.to_string());
        let dir = steamapps.join("common").join(install_dir);
        if let Ok(g) = GameInstall::from_dir(&dir, Store::Steam) {
            return Some(g);
        }
    }
    None
}

fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
        if let Ok(k) = RegKey::predef(HKEY_CURRENT_USER).open_subkey("Software\\Valve\\Steam") {
            if let Ok(p) = k.get_value::<String, _>("SteamPath") {
                roots.push(PathBuf::from(p.replace('/', "\\")));
            }
        }
        for key in ["SOFTWARE\\WOW6432Node\\Valve\\Steam", "SOFTWARE\\Valve\\Steam"] {
            if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(key) {
                if let Ok(p) = k.get_value::<String, _>("InstallPath") {
                    roots.push(PathBuf::from(p));
                }
            }
        }
        roots.push(PathBuf::from(r"C:\Program Files (x86)\Steam"));
        roots.push(PathBuf::from(r"C:\Program Files\Steam"));
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            roots.push(home.join(".steam/steam"));
            roots.push(home.join(".local/share/Steam"));
            roots.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"));
            roots.push(home.join("Library/Application Support/Steam"));
        }
    }
    roots.dedup();
    roots
}

pub fn detect_gog() -> Option<GameInstall> {
    #[cfg(windows)]
    {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        for base in ["SOFTWARE\\WOW6432Node\\GOG.com\\Games", "SOFTWARE\\GOG.com\\Games"] {
            let key = format!("{base}\\{GOG_PRODUCT_ID}");
            if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(key) {
                if let Ok(p) = k.get_value::<String, _>("path") {
                    if let Ok(g) = GameInstall::from_dir(Path::new(&p), Store::Gog) {
                        return Some(g);
                    }
                }
            }
        }
    }
    None
}

fn detect_common_paths() -> Option<GameInstall> {
    let candidates: &[&str] = &[
        r"C:\GOG Games\Supreme Commander 2",
        r"C:\Program Files (x86)\GOG Galaxy\Games\Supreme Commander 2",
        r"D:\SteamLibrary\steamapps\common\Supreme Commander 2",
        r"E:\SteamLibrary\steamapps\common\Supreme Commander 2",
        r"C:\SteamLibrary\steamapps\common\Supreme Commander 2",
    ];
    candidates
        .iter()
        .find_map(|c| GameInstall::from_dir(Path::new(c), Store::Manual).ok())
}

/// Procura um filho de `dir` ignorando maiúsculas/minúsculas (importante no Linux/Proton).
pub fn find_child_ci(dir: &Path, name: &str) -> Option<PathBuf> {
    let direct = dir.join(name);
    if direct.exists() {
        return Some(direct);
    }
    fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| {
        p.file_name()
            .map(|n| n.to_string_lossy().eq_ignore_ascii_case(name))
            .unwrap_or(false)
    })
}

/// Como o jogo deve ser iniciado.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum LaunchMode {
    /// Via `steam://rungameid/40100` (recomendado: overlay, conquistas e multiplayer).
    #[default]
    Steam,
    /// Executa o .exe direto (GOG, ou para passar argumentos de linha de comando).
    Direct,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LaunchPlan {
    Url {
        url: String,
    },
    Exe {
        exe: PathBuf,
        args: Vec<String>,
        cwd: PathBuf,
    },
}

pub fn launch_plan(game: &GameInstall, mode: LaunchMode, args: &[String]) -> Result<LaunchPlan> {
    match (mode, game.store) {
        (LaunchMode::Steam, _) if game.store != Store::Gog => Ok(LaunchPlan::Url {
            url: format!("steam://rungameid/{STEAM_APP_ID}"),
        }),
        _ => {
            let exe = game
                .exe
                .clone()
                .ok_or_else(|| Error::Other(format!("{EXE_NAME} não encontrado em {}", game.root.display())))?;
            Ok(LaunchPlan::Exe {
                cwd: game.bin_dir(),
                exe,
                args: args.to_vec(),
            })
        }
    }
}

/// Inicia um executável direto (o modo URL é aberto pela camada de interface).
pub fn spawn_exe(plan: &LaunchPlan) -> Result<Option<u32>> {
    match plan {
        LaunchPlan::Exe { exe, args, cwd } => {
            let child = std::process::Command::new(exe)
                .args(args)
                .current_dir(cwd)
                .spawn()
                .at(exe)?;
            Ok(Some(child.id()))
        }
        LaunchPlan::Url { .. } => Ok(None),
    }
}

/// O jogo está rodando? (Alterar arquivos com o jogo aberto não tem efeito e pode corromper.)
pub fn is_running() -> bool {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};
    let sys = System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()));
    sys.processes()
        .values()
        .any(|p| p.name().to_string_lossy().eq_ignore_ascii_case(EXE_NAME))
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn fake_game(dir: &Path) -> PathBuf {
        let root = dir.join("steamapps/common/Supreme Commander 2");
        fs::create_dir_all(root.join("gamedata")).unwrap();
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("bin").join(EXE_NAME), b"MZ").unwrap();
        root
    }

    #[test]
    fn from_dir_accepts_root_gamedata_and_bin() {
        let t = tempfile::tempdir().unwrap();
        let root = fake_game(t.path());
        for d in [root.clone(), root.join("gamedata"), root.join("bin")] {
            let g = GameInstall::from_dir(&d, Store::Manual).unwrap();
            assert_eq!(g.root, root);
            assert!(g.exe.is_some());
        }
        assert!(GameInstall::from_dir(t.path(), Store::Manual).is_err());
    }

    #[test]
    fn steam_library_lookup() {
        let t = tempfile::tempdir().unwrap();
        let steam = t.path().join("Steam");
        let lib = t.path().join("Lib2");
        fs::create_dir_all(steam.join("steamapps")).unwrap();
        fake_game(&lib);
        fs::write(
            steam.join("steamapps/libraryfolders.vdf"),
            format!(
                "\"libraryfolders\" {{ \"0\" {{ \"path\" \"{}\" }} \"1\" {{ \"path\" \"{}\" }} }}",
                steam.display(),
                lib.display()
            ),
        )
        .unwrap();
        fs::write(
            lib.join(format!("steamapps/appmanifest_{STEAM_APP_ID}.acf")),
            "\"AppState\" { \"installdir\" \"Supreme Commander 2\" }",
        )
        .unwrap();
        let g = find_in_steam_root(&steam).expect("deveria achar na segunda biblioteca");
        assert_eq!(g.store, Store::Steam);
        assert!(g.gamedata.ends_with("gamedata"));
        let plan = launch_plan(&g, LaunchMode::Steam, &[]).unwrap();
        assert_eq!(
            plan,
            LaunchPlan::Url {
                url: "steam://rungameid/40100".into()
            }
        );
        assert!(matches!(
            launch_plan(&g, LaunchMode::Direct, &[]).unwrap(),
            LaunchPlan::Exe { .. }
        ));
    }
}
