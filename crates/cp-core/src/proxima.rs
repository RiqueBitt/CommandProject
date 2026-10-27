//! **Jogar por IP** com o [SC2-Proxima](https://github.com/Rackover/sc2-proxima) (Rackover, GPL-3.0).
//!
//! O Proxima é um `steam_api.dll` que liga o conector UDP antigo do motor: as partidas privadas
//! passam a funcionar por IP (LAN, VPN ou porta aberta no roteador), sem o P2P da Steam.
//!
//! O CommandProject **não inclui nem modifica** o código do Proxima (ele é GPL e o launcher é MIT):
//! baixa o lançamento oficial do GitHub quando o usuário pede, guarda na pasta de dados e só o
//! coloca no jogo enquanto uma partida por IP aberta pelo launcher está rodando. Quando o jogo
//! fecha (ou na próxima vez que o launcher abre) o `steam_api.dll` original volta — aberto pela
//! Steam, o jogo continua o de sempre.

use crate::error::{Error, Result};
use crate::fsutil;
use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::{Path, PathBuf};

pub const REPO: &str = "Rackover/sc2-proxima";
pub const LICENSE: &str = "GPL-3.0";
/// porta padrão do Proxima para hospedar e entrar
pub const DEFAULT_PORT: u16 = 16010;
const DLL: &str = "steam_api.dll";

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Installed {
    /// versão (tag do GitHub) baixada
    pub version: String,
    /// sha256 do dll do Proxima
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// versão baixada (None = ainda não baixou)
    pub version: Option<String>,
    /// o dll do Proxima está agora na pasta do jogo
    pub active: bool,
    pub name: String,
    pub port: u16,
}

pub struct Proxima {
    /// pasta `bin` do jogo (onde ficam SupremeCommander2.exe e steam_api.dll)
    bin: PathBuf,
    /// pasta de dados do launcher para o Proxima
    store: PathBuf,
}

impl Proxima {
    pub fn new(bin: impl Into<PathBuf>, data_dir: &Path) -> Self {
        Self { bin: bin.into(), store: data_dir.join("proxima") }
    }

    fn dll(&self) -> PathBuf {
        self.store.join(DLL)
    }
    fn info_path(&self) -> PathBuf {
        self.store.join("download.json")
    }
    fn backup(&self) -> PathBuf {
        self.store.join("steam_api.original.dll")
    }
    /// existe enquanto o dll do Proxima está no jogo (sobrevive a o launcher fechar no meio)
    fn marker(&self) -> PathBuf {
        self.store.join("active")
    }
    fn game_dll(&self) -> PathBuf {
        self.bin.join(DLL)
    }
    /// o Proxima lê `Proxima/PlayerData.txt` ao lado do executável
    pub fn player_data_path(&self) -> PathBuf {
        self.bin.join("Proxima").join("PlayerData.txt")
    }

    pub fn downloaded(&self) -> Option<Installed> {
        if !self.dll().is_file() {
            return None;
        }
        fsutil::read_json::<Installed>(&self.info_path()).ok()
    }

    pub fn is_active(&self) -> bool {
        self.marker().is_file()
    }

    pub fn status(&self) -> Status {
        let (name, port) = self.player_data();
        Status { version: self.downloaded().map(|d| d.version), active: self.is_active(), name, port }
    }

    /// Guarda o que veio do GitHub: o próprio `steam_api.dll` ou um .zip com ele dentro.
    pub fn store_download(&self, file_name: &str, bytes: &[u8], version: &str) -> Result<Installed> {
        let dll = if file_name.to_ascii_lowercase().ends_with(".zip") { dll_from_zip(bytes)? } else { bytes.to_vec() };
        check_dll(&dll)?;
        std::fs::create_dir_all(&self.store).map_err(|e| Error::io(&self.store, e))?;
        fsutil::write_atomic(&self.dll(), &dll)?;
        let info = Installed { version: version.to_string(), sha256: fsutil::sha256_bytes(&dll) };
        fsutil::write_json(&self.info_path(), &info)?;
        Ok(info)
    }

    /// Coloca o Proxima no jogo (guarda o `steam_api.dll` original antes). O jogo precisa estar fechado.
    pub fn install(&self) -> Result<()> {
        let info = self.downloaded().ok_or_else(|| Error::Other("baixe o Proxima antes de jogar por IP".into()))?;
        let game = self.game_dll();
        if !game.is_file() {
            return Err(Error::Other(format!("{DLL} não encontrado em {}: a pasta do jogo está certa?", self.bin.display())));
        }
        let current = fsutil::sha256_file(&game)?;
        if current != info.sha256 {
            // o que está no jogo é o original (ou um original novo, depois de uma atualização da Steam)
            std::fs::create_dir_all(&self.store).map_err(|e| Error::io(&self.store, e))?;
            fsutil::copy_atomic(&game, &self.backup())?;
            fsutil::copy_atomic(&self.dll(), &game)?;
        }
        std::fs::write(self.marker(), info.version.as_bytes()).map_err(|e| Error::io(self.marker(), e))?;
        Ok(())
    }

    /// Devolve o `steam_api.dll` original. Não faz nada se o Proxima não estiver no jogo.
    pub fn restore(&self) -> Result<bool> {
        if !self.is_active() {
            return Ok(false);
        }
        let backup = self.backup();
        let game = self.game_dll();
        let ours = self.downloaded().map(|d| d.sha256);
        let in_game = fsutil::sha256_file(&game).ok();
        // só troca se o que está lá é o Proxima (se a Steam já reparou o jogo, deixa como está)
        if backup.is_file() && (in_game.is_none() || in_game == ours) {
            fsutil::copy_atomic(&backup, &game)?;
        }
        std::fs::remove_file(self.marker()).map_err(|e| Error::io(self.marker(), e))?;
        Ok(true)
    }

    /// Nome e porta salvos no `PlayerData.txt` (ou os padrões).
    pub fn player_data(&self) -> (String, u16) {
        let text = std::fs::read_to_string(self.player_data_path()).unwrap_or_default();
        let mut name = String::new();
        let mut port = DEFAULT_PORT;
        for line in text.lines() {
            if let Some(v) = line.strip_prefix("PlayerName=") {
                name = v.trim().to_string();
            } else if let Some(v) = line.strip_prefix("PreferredHostingPort=") {
                port = v.trim().parse().unwrap_or(DEFAULT_PORT);
            }
        }
        (name, port)
    }

    /// Grava nome e porta no `PlayerData.txt`, mantendo as outras linhas (o SteamID gerado pelo Proxima).
    pub fn set_player_data(&self, name: &str, port: u16) -> Result<()> {
        let name = clean_name(name);
        let path = self.player_data_path();
        let old = std::fs::read_to_string(&path).unwrap_or_default();
        let mut out: Vec<String> = old
            .lines()
            .filter(|l| !l.starts_with("PlayerName=") && !l.starts_with("PreferredHostingPort="))
            .map(str::to_string)
            .collect();
        if !name.is_empty() {
            out.push(format!("PlayerName={name}"));
        }
        out.push(format!("PreferredHostingPort={}", port.max(1024)));
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| Error::io(dir, e))?;
        }
        fsutil::write_atomic(&path, (out.join("\n") + "\n").as_bytes())
    }
}

/// Nome para a sala: sem quebras de linha nem `=`, até 24 caracteres.
pub fn clean_name(name: &str) -> String {
    name.chars().filter(|c| !c.is_control() && *c != '=').take(24).collect::<String>().trim().to_string()
}

/// Endereço para entrar: `IP` ou `IP:porta` (IPv4) ou um nome de host simples.
pub fn parse_address(input: &str) -> Option<(String, u16)> {
    let s = input.trim();
    if s.is_empty() || s.len() > 253 || s.contains(char::is_whitespace) {
        return None;
    }
    let (host, port) = match s.rsplit_once(':') {
        Some((h, p)) => (h, p.parse::<u16>().ok().filter(|p| *p > 0)?),
        None => (s, DEFAULT_PORT),
    };
    let ok_host = !host.is_empty() && host.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-');
    ok_host.then(|| (host.to_string(), port))
}

/// Escolhe o arquivo do lançamento: o `steam_api.dll` ou um .zip.
pub fn pick_asset(names: &[String]) -> Option<&String> {
    let lower = |n: &String| n.to_ascii_lowercase();
    names
        .iter()
        .find(|n| lower(n) == DLL)
        .or_else(|| names.iter().find(|n| lower(n).ends_with(".dll")))
        .or_else(|| names.iter().find(|n| lower(n).ends_with(".zip")))
}

fn dll_from_zip(bytes: &[u8]) -> Result<Vec<u8>> {
    let bad = |r: String| Error::Other(format!("pacote do Proxima inválido: {r}"));
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes)).map_err(|e| bad(e.to_string()))?;
    let name = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().and_then(|f| f.name().ok().map(|n| n.into_owned())))
        .find(|n| n.rsplit('/').next().is_some_and(|f| f.eq_ignore_ascii_case(DLL)))
        .ok_or_else(|| bad(format!("{DLL} não está no .zip")))?;
    let mut f = zip.by_name(&name).map_err(|e| bad(e.to_string()))?;
    let mut out = Vec::new();
    f.read_to_end(&mut out).map_err(|e| bad(e.to_string()))?;
    Ok(out)
}

/// Confere que é um DLL do Windows que exporta a API da Steam (e não uma página de erro).
fn check_dll(b: &[u8]) -> Result<()> {
    let pe = b.len() > 4096 && b.starts_with(b"MZ");
    let steam = b.windows(13).any(|w| w == b"SteamAPI_Init");
    if pe && steam {
        Ok(())
    } else {
        Err(Error::Other("o arquivo baixado não é o steam_api.dll do Proxima".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_dll(tag: &[u8]) -> Vec<u8> {
        let mut b = b"MZ".to_vec();
        b.resize(5000, 0);
        b.extend_from_slice(b"SteamAPI_Init");
        b.extend_from_slice(tag);
        b
    }

    #[test]
    fn install_and_restore_keep_the_original() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let original = fake_dll(b"steam original");
        std::fs::write(bin.join(DLL), &original).unwrap();
        let p = Proxima::new(&bin, &tmp.path().join("data"));
        assert!(p.install().is_err(), "sem baixar não instala");
        p.store_download("steam_api.dll", &fake_dll(b"proxima"), "v1.0.1").unwrap();
        assert!(p.store_download("steam_api.dll", b"<html>404</html>", "v1").is_err());
        p.install().unwrap();
        assert!(p.is_active());
        assert_eq!(std::fs::read(bin.join(DLL)).unwrap(), fake_dll(b"proxima"));
        // instalar de novo não troca o backup pelo próprio Proxima
        p.install().unwrap();
        assert!(p.restore().unwrap());
        assert_eq!(std::fs::read(bin.join(DLL)).unwrap(), original);
        assert!(!p.is_active());
        assert!(!p.restore().unwrap(), "restaurar duas vezes não faz nada");
    }

    #[test]
    fn restore_leaves_a_steam_repaired_dll_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join(DLL), fake_dll(b"old")).unwrap();
        let p = Proxima::new(&bin, &tmp.path().join("data"));
        p.store_download("steam_api.dll", &fake_dll(b"proxima"), "v1").unwrap();
        p.install().unwrap();
        std::fs::write(bin.join(DLL), fake_dll(b"steam repaired")).unwrap();
        p.restore().unwrap();
        assert_eq!(std::fs::read(bin.join(DLL)).unwrap(), fake_dll(b"steam repaired"));
    }

    #[test]
    fn zip_asset_and_player_data() {
        let tmp = tempfile::tempdir().unwrap();
        let mut buf = std::io::Cursor::new(Vec::new());
        {
            let mut z = zip::ZipWriter::new(&mut buf);
            z.start_file("Proxima/steam_api.dll", zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut z, &fake_dll(b"zip")).unwrap();
            z.finish().unwrap();
        }
        let p = Proxima::new(tmp.path(), tmp.path());
        p.store_download("SC2-Proxima.zip", buf.get_ref(), "v1.0.1").unwrap();
        assert_eq!(p.downloaded().unwrap().version, "v1.0.1");
        std::fs::create_dir_all(tmp.path().join("Proxima")).unwrap();
        std::fs::write(p.player_data_path(), "SteamID=76561\nPlayerName=old\n").unwrap();
        p.set_player_data("Rique=\nBitt", 17000).unwrap();
        let text = std::fs::read_to_string(p.player_data_path()).unwrap();
        assert!(text.contains("SteamID=76561") && text.contains("PlayerName=RiqueBitt") && text.contains("PreferredHostingPort=17000"), "{text}");
        assert_eq!(p.player_data(), ("RiqueBitt".into(), 17000));
    }

    #[test]
    fn addresses_and_assets() {
        assert_eq!(parse_address(" 192.168.0.5 "), Some(("192.168.0.5".into(), DEFAULT_PORT)));
        assert_eq!(parse_address("10.0.0.2:17000"), Some(("10.0.0.2".into(), 17000)));
        assert_eq!(parse_address("meu-pc.local"), Some(("meu-pc.local".into(), DEFAULT_PORT)));
        assert_eq!(parse_address("1.2.3.4:0"), None);
        assert_eq!(parse_address("a b"), None);
        assert_eq!(parse_address("x;rm"), None);
        let names = vec!["Source.zip".to_string(), "steam_api.dll".to_string()];
        assert_eq!(pick_asset(&names).unwrap(), "steam_api.dll");
        assert_eq!(pick_asset(&["build.zip".to_string()]).unwrap(), "build.zip");
        assert!(pick_asset(&["notes.txt".to_string()]).is_none());
    }
}
