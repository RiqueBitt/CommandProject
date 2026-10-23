//! Shaders de pós-processamento (ReShade) para o Supreme Commander 2.
//!
//! O jogo é DirectX 9, então o ReShade entra como `bin/d3d9.dll`. O CommandProject:
//! * instala o ReShade pelo instalador oficial (baixado de reshade.me, assinatura conferida),
//!   em modo silencioso (`--api d3d9 --headless`);
//! * copia os shaders (`resources/shaders/CommandProject.fx`) para
//!   `bin/reshade-shaders/Shaders/CommandProject/` e os presets para `bin/CommandProject-presets/`;
//! * troca o preset ativo no `ReShade.ini` (guardando o anterior para restaurar depois).
//!
//! Pós-processamento roda só na sua máquina: não muda nada da simulação e não dessincroniza
//! partidas multiplayer. Tudo que é instalado fica registrado em `shaders/state.json` para ser
//! removido sem deixar sobras. Presets que o usuário ajustou no menu do ReShade não são
//! sobrescritos em atualizações.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, IoContext, Result};
use crate::fsutil;

/// Versão do pacote de shaders (muda quando os .fx ou os presets padrão mudam).
pub const PACK_VERSION: &str = "1.0.0";
/// Presets incluídos, na ordem de exibição: (arquivo, nome para o usuário, descrição).
pub const PRESETS: &[(&str, &str, &str)] = &[
    (
        "Natural",
        "Natural",
        "Mais nítido e com cores mais vivas, sem mudar o clima do jogo.",
    ),
    (
        "Vivido",
        "Vívido",
        "Cores fortes, relevo marcado e brilho nas explosões.",
    ),
    (
        "Cinematico",
        "Cinemático",
        "Tons quentes, contraste alto, vinheta e bloom generoso.",
    ),
];
const OFF_PRESET: &str = "Desligado";
const SHADER_DIR: &str = "reshade-shaders/Shaders/CommandProject";
const PRESET_DIR: &str = "CommandProject-presets";
const DLL: &str = "d3d9.dll";
const INI: &str = "ReShade.ini";
/// Scroll Lock liga/desliga os efeitos dentro do jogo.
const TOGGLE_KEY: &str = "145,0,0,0";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetInfo {
    pub id: String,
    pub name: String,
    pub description: String,
    /// O usuário mudou valores deste preset pelo menu do ReShade.
    pub customized: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShaderStatus {
    pub bin_dir: String,
    /// `bin/d3d9.dll` é o ReShade.
    pub reshade: bool,
    pub reshade_version: Option<String>,
    /// Existe um `d3d9.dll` que não é do ReShade (outro programa): não mexemos nele.
    pub foreign_dll: bool,
    pub pack_installed: bool,
    pub pack_version: Option<String>,
    pub update_available: bool,
    /// Preset ativo (`None` = efeitos desligados ou pacote não instalado).
    pub preset: Option<String>,
    pub presets: Vec<PresetInfo>,
    pub toggle_key: String,
    pub menu_key: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    pack_version: String,
    /// Arquivos instalados (relativos a `bin`) → SHA-256 do que foi escrito.
    files: BTreeMap<String, String>,
    /// `PresetPath` que existia antes de o CommandProject assumir.
    previous_preset_path: Option<String>,
    took_over_preset: bool,
}

pub struct Shaders {
    bin: PathBuf,
    pack: PathBuf,
    state_path: PathBuf,
}

impl Shaders {
    /// `bin`: pasta do executável do jogo; `pack`: `resources/shaders`; `data`: pasta de dados do app.
    pub fn new(bin: PathBuf, pack: PathBuf, data: &Path) -> Self {
        Shaders {
            bin,
            pack,
            state_path: data.join("shaders").join("state.json"),
        }
    }

    fn state(&self) -> Result<State> {
        fsutil::read_json_or_default(&self.state_path)
    }

    fn save_state(&self, s: &State) -> Result<()> {
        fsutil::write_json(&self.state_path, s)
    }

    /// O ReShade regrava o `ReShade.ini` ao fechar o jogo: mexer com o jogo aberto seria desfeito.
    fn ensure_game_closed() -> Result<()> {
        if crate::game::is_running() {
            return Err(Error::Other("feche o jogo antes de mudar os shaders".into()));
        }
        Ok(())
    }

    fn ini_path(&self) -> PathBuf {
        self.bin.join(INI)
    }

    fn read_ini(&self) -> Result<String> {
        let p = self.ini_path();
        if !p.exists() {
            return Ok(String::new());
        }
        std::fs::read(&p)
            .at(&p)
            .map(|b| String::from_utf8_lossy(&b).into_owned())
    }

    fn write_ini(&self, text: &str) -> Result<()> {
        fsutil::write_atomic(&self.ini_path(), text.as_bytes())
    }

    pub fn status(&self) -> Result<ShaderStatus> {
        let dll = self.bin.join(DLL);
        let (reshade, foreign) = match std::fs::read(&dll) {
            Ok(bytes) => {
                let is = is_reshade_dll(&bytes);
                (is, !is)
            }
            Err(_) => (false, false),
        };
        let state = self.state()?;
        let pack_installed = self.bin.join(SHADER_DIR).join("CommandProject.fx").is_file();
        let ini = self.read_ini()?;
        let preset = ini_get(&ini, "GENERAL", "PresetPath").and_then(|p| preset_from_path(&p));
        let presets = PRESETS
            .iter()
            .map(|(id, name, desc)| {
                let rel = format!("{PRESET_DIR}/{id}.ini");
                let customized = match (state.files.get(&rel), fsutil::sha256_file(&self.bin.join(&rel)).ok()) {
                    (Some(installed), Some(now)) => installed != &now,
                    _ => false,
                };
                PresetInfo {
                    id: id.to_string(),
                    name: name.to_string(),
                    description: desc.to_string(),
                    customized,
                }
            })
            .collect();
        Ok(ShaderStatus {
            bin_dir: self.bin.display().to_string(),
            reshade,
            reshade_version: reshade.then(|| self.reshade_version()).flatten(),
            foreign_dll: foreign,
            pack_installed,
            pack_version: pack_installed
                .then(|| state.pack_version.clone())
                .filter(|v| !v.is_empty()),
            update_available: pack_installed && state.pack_version != PACK_VERSION,
            preset: if pack_installed { preset } else { None },
            presets,
            toggle_key: "Scroll Lock".into(),
            menu_key: "Home".into(),
        })
    }

    fn reshade_version(&self) -> Option<String> {
        let log = std::fs::read_to_string(self.bin.join("ReShade.log")).ok()?;
        let i = log.find("ReShade version '")? + "ReShade version '".len();
        let v: String = log[i..].chars().take_while(|c| *c != '\'').collect();
        (!v.is_empty() && v.len() < 32).then_some(v)
    }

    /// Instala (ou atualiza) os shaders e presets e ativa `preset` (`None` = desligado).
    pub fn apply(&self, preset: Option<&str>) -> Result<ShaderStatus> {
        Self::ensure_game_closed()?;
        if let Some(p) = preset {
            if !PRESETS.iter().any(|(id, ..)| *id == p) {
                return Err(Error::Other(format!("preset desconhecido: {p}")));
            }
        }
        if self.bin.join(DLL).is_file() && !is_reshade_dll(&std::fs::read(self.bin.join(DLL)).at(self.bin.join(DLL))?) {
            return Err(Error::Conflict(
                "já existe um d3d9.dll de outro programa na pasta do jogo; remova-o antes de usar os shaders".into(),
            ));
        }
        let mut state = self.state()?;
        self.install_files(&mut state, false)?;

        let mut ini = self.read_ini()?;
        if !state.took_over_preset {
            state.previous_preset_path = ini_get(&ini, "GENERAL", "PresetPath");
            state.took_over_preset = true;
        }
        let file = preset.unwrap_or(OFF_PRESET);
        ini = ini_set(&ini, "GENERAL", "PresetPath", &format!(".\\{PRESET_DIR}\\{file}.ini"));
        ini = ensure_search_path(&ini);
        if ini_get(&ini, "INPUT", "KeyEffects").is_none_or(|v| v.trim().is_empty() || v.starts_with("0,")) {
            ini = ini_set(&ini, "INPUT", "KeyEffects", TOGGLE_KEY);
        }
        self.write_ini(&ini)?;
        state.pack_version = PACK_VERSION.into();
        self.save_state(&state)?;
        self.status()
    }

    /// Volta os presets aos valores originais (descarta ajustes feitos no menu do ReShade).
    pub fn reset_presets(&self) -> Result<ShaderStatus> {
        Self::ensure_game_closed()?;
        let mut state = self.state()?;
        self.install_files(&mut state, true)?;
        self.save_state(&state)?;
        self.status()
    }

    fn install_files(&self, state: &mut State, force_presets: bool) -> Result<()> {
        let mut files: Vec<(PathBuf, String)> = vec![(
            self.pack.join("CommandProject.fx"),
            format!("{SHADER_DIR}/CommandProject.fx"),
        )];
        for (id, ..) in PRESETS.iter().chain(std::iter::once(&(OFF_PRESET, "", ""))) {
            files.push((
                self.pack.join("presets").join(format!("{id}.ini")),
                format!("{PRESET_DIR}/{id}.ini"),
            ));
        }
        for (mut src, rel) in files {
            if !src.is_file() {
                // instaladores até a 0.7.0 achatavam `presets/` dentro da pasta do pacote
                if let Some(flat) = src.file_name().map(|n| self.pack.join(n)) {
                    if flat.is_file() {
                        src = flat;
                    }
                }
            }
            if !src.is_file() {
                return Err(Error::Other(format!(
                    "arquivo do pacote de shaders não encontrado: {}",
                    src.display()
                )));
            }
            let dst = self.bin.join(&rel);
            let is_preset = rel.starts_with(PRESET_DIR);
            if is_preset && !force_presets && dst.is_file() {
                // só sobrescreve se o usuário não mexeu (hash igual ao que instalamos)
                let now = fsutil::sha256_file(&dst)?;
                if state.files.get(&rel) != Some(&now) {
                    continue;
                }
            }
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).at(parent)?;
            }
            let sha = fsutil::copy_atomic(&src, &dst)?;
            state.files.insert(rel, sha);
        }
        Ok(())
    }

    /// Remove os shaders e presets do CommandProject e devolve o preset que existia antes.
    /// Com `reshade = true`, também tira o `d3d9.dll` do ReShade (guardado em `shaders/removido`).
    pub fn remove(&self, reshade: bool) -> Result<ShaderStatus> {
        Self::ensure_game_closed()?;
        let mut state = self.state()?;
        for rel in state.files.keys() {
            let p = self.bin.join(rel);
            if p.is_file() {
                std::fs::remove_file(&p).at(&p)?;
            }
        }
        // só remove pastas que ficaram vazias
        for dir in [SHADER_DIR, "reshade-shaders/Shaders", "reshade-shaders", PRESET_DIR] {
            let _ = std::fs::remove_dir(self.bin.join(dir));
        }
        let mut ini = self.read_ini()?;
        if state.took_over_preset && !ini.is_empty() {
            ini = match &state.previous_preset_path {
                Some(prev) => ini_set(&ini, "GENERAL", "PresetPath", prev),
                None => ini_remove(&ini, "GENERAL", "PresetPath"),
            };
            self.write_ini(&ini)?;
        }
        state = State::default();
        self.save_state(&state)?;

        if reshade {
            let dll = self.bin.join(DLL);
            if dll.is_file() && is_reshade_dll(&std::fs::read(&dll).at(&dll)?) {
                let keep = self.state_path.with_file_name("removido");
                std::fs::create_dir_all(&keep).at(&keep)?;
                let dst = keep.join(DLL);
                fsutil::copy_atomic(&dll, &dst)?;
                std::fs::remove_file(&dll).at(&dll)?;
            }
        }
        self.status()
    }
}

/// O DLL contém a marca do ReShade (ASCII ou UTF-16, nos recursos de versão).
pub fn is_reshade_dll(bytes: &[u8]) -> bool {
    let ascii = b"ReShade";
    let utf16: Vec<u8> = ascii.iter().flat_map(|b| [*b, 0]).collect();
    bytes.windows(ascii.len()).any(|w| w == ascii) || bytes.windows(utf16.len()).any(|w| w == utf16.as_slice())
}

fn preset_from_path(p: &str) -> Option<String> {
    let norm = p.replace('/', "\\").to_ascii_lowercase();
    PRESETS
        .iter()
        .find(|(id, ..)| {
            norm.ends_with(&format!(
                "{}\\{}.ini",
                PRESET_DIR.to_ascii_lowercase(),
                id.to_ascii_lowercase()
            ))
        })
        .map(|(id, ..)| id.to_string())
}

fn ensure_search_path(ini: &str) -> String {
    let ours = ".\\reshade-shaders\\Shaders\\CommandProject";
    let Some(current) = ini_get(ini, "GENERAL", "EffectSearchPaths") else {
        return ini_set(ini, "GENERAL", "EffectSearchPaths", ".\\reshade-shaders\\Shaders\\**");
    };
    let covered = current.split(',').any(|p| {
        let p = p.trim().replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase();
        p == ".\\reshade-shaders\\shaders\\**" || p == "reshade-shaders\\shaders\\**" || p == ours.to_ascii_lowercase()
    });
    if covered {
        return ini.to_string();
    }
    let joined = if current.trim().is_empty() {
        ours.to_string()
    } else {
        format!("{},{ours}", current.trim())
    };
    ini_set(ini, "GENERAL", "EffectSearchPaths", &joined)
}

// ---------- INI simples (preserva comentários, ordem e quebras de linha) ----------

fn newline(text: &str) -> &'static str {
    if text.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    }
}

fn section_of(line: &str) -> Option<&str> {
    let t = line.trim();
    (t.starts_with('[') && t.ends_with(']')).then(|| t[1..t.len() - 1].trim())
}

fn key_of(line: &str) -> Option<&str> {
    let t = line.trim_start();
    if t.starts_with(';') || t.starts_with('#') {
        return None;
    }
    t.split_once('=').map(|(k, _)| k.trim())
}

pub fn ini_get(text: &str, section: &str, key: &str) -> Option<String> {
    let mut cur = "";
    for line in text.lines() {
        if let Some(s) = section_of(line) {
            cur = s;
            continue;
        }
        if cur.eq_ignore_ascii_case(section) && key_of(line).is_some_and(|k| k.eq_ignore_ascii_case(key)) {
            return line.split_once('=').map(|(_, v)| v.trim().to_string());
        }
    }
    None
}

pub fn ini_set(text: &str, section: &str, key: &str, value: &str) -> String {
    let nl = newline(text);
    let mut lines: Vec<String> = text.lines().map(str::to_string).collect();
    let mut cur = String::new();
    let mut section_end: Option<usize> = None;
    for i in 0..lines.len() {
        if let Some(s) = section_of(&lines[i]) {
            if cur.eq_ignore_ascii_case(section) && section_end.is_none() {
                section_end = Some(i);
            }
            cur = s.to_string();
            continue;
        }
        if cur.eq_ignore_ascii_case(section) && key_of(&lines[i]).is_some_and(|k| k.eq_ignore_ascii_case(key)) {
            lines[i] = format!("{key}={value}");
            return lines.join(nl) + nl;
        }
    }
    let entry = format!("{key}={value}");
    if cur.eq_ignore_ascii_case(section) && section_end.is_none() {
        // a seção é a última do arquivo: acrescenta no fim, antes de linhas vazias finais
        let mut at = lines.len();
        while at > 0 && lines[at - 1].trim().is_empty() {
            at -= 1;
        }
        lines.insert(at, entry);
    } else if let Some(end) = section_end {
        let mut at = end;
        while at > 0 && lines[at - 1].trim().is_empty() {
            at -= 1;
        }
        lines.insert(at, entry);
    } else {
        if lines.last().is_some_and(|l| !l.trim().is_empty()) {
            lines.push(String::new());
        }
        lines.push(format!("[{section}]"));
        lines.push(entry);
    }
    lines.join(nl) + nl
}

fn ini_remove(text: &str, section: &str, key: &str) -> String {
    let nl = newline(text);
    let mut cur = String::new();
    let mut out = Vec::new();
    for line in text.lines() {
        if let Some(s) = section_of(line) {
            cur = s.to_string();
        } else if cur.eq_ignore_ascii_case(section) && key_of(line).is_some_and(|k| k.eq_ignore_ascii_case(key)) {
            continue;
        }
        out.push(line);
    }
    out.join(nl) + nl
}

// ---------- instalação do ReShade pelo instalador oficial ----------

const RESHADE_SITE: &str = "https://reshade.me/";

/// Encontra o link do instalador oficial (sem a variante "Addon") na página inicial.
pub fn find_setup_link(html: &str) -> Option<(String, String)> {
    let mut rest = html;
    while let Some(i) = rest.find("ReShade_Setup_") {
        let tail = &rest[i + "ReShade_Setup_".len()..];
        let end = tail.find(".exe")?;
        let version = &tail[..end];
        if !version.is_empty() && version.len() < 16 && version.chars().all(|c| c.is_ascii_digit() || c == '.') {
            return Some((
                version.to_string(),
                format!("{RESHADE_SITE}downloads/ReShade_Setup_{version}.exe"),
            ));
        }
        rest = &tail[end..];
    }
    None
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReshadeInstall {
    pub version: String,
    pub signer: String,
}

/// Baixa o instalador oficial, confere a assinatura digital e instala o ReShade (DirectX 9)
/// no executável do jogo. Só no Windows.
pub async fn install_reshade(
    game_exe: &Path,
    cache_dir: &Path,
    progress: &mut (dyn FnMut(&str) + Send),
) -> Result<ReshadeInstall> {
    if !cfg!(windows) {
        return Err(Error::Other("a instalação do ReShade só funciona no Windows".into()));
    }
    progress("Procurando a versão mais nova do ReShade");
    let client = reqwest::Client::builder()
        .user_agent(concat!("CommandProject/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| Error::Network(e.to_string()))?;
    let html = client
        .get(RESHADE_SITE)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| Error::Network(format!("não consegui abrir reshade.me: {e}")))?
        .text()
        .await
        .map_err(|e| Error::Network(e.to_string()))?;
    let (version, url) =
        find_setup_link(&html).ok_or_else(|| Error::Network("não achei o link do instalador em reshade.me".into()))?;

    std::fs::create_dir_all(cache_dir).at(cache_dir)?;
    let setup = cache_dir.join(format!("ReShade_Setup_{version}.exe"));
    if !setup.is_file() {
        progress(&format!("Baixando o ReShade {version}"));
        let bytes = client
            .get(&url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| Error::Network(format!("falha ao baixar o ReShade: {e}")))?
            .bytes()
            .await
            .map_err(|e| Error::Network(e.to_string()))?;
        if bytes.len() < 1024 || &bytes[..2] != b"MZ" {
            return Err(Error::Integrity(
                "o download do ReShade não é um executável válido".into(),
            ));
        }
        fsutil::write_atomic(&setup, &bytes)?;
    }

    progress("Conferindo a assinatura digital");
    let signer = match platform::verify_signature(&setup) {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_file(&setup);
            return Err(e);
        }
    };

    progress("Instalando (se o Windows pedir permissão, aceite)");
    platform::run_setup(&setup, game_exe)?;

    let dll = game_exe.parent().unwrap_or(Path::new(".")).join(DLL);
    // se o instalador precisou de administrador, ele reabre com janela: esperamos o usuário concluir
    for _ in 0..360 {
        if std::fs::read(&dll).map(|b| is_reshade_dll(&b)).unwrap_or(false) {
            return Ok(ReshadeInstall { version, signer });
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err(Error::Other(
        "o ReShade não foi instalado (instalação cancelada ou sem permissão)".into(),
    ))
}

/// Decide se a assinatura do instalador é aceitável.
///
/// O ReShade assina com um certificado próprio ("CN=ReShade, E=info@reshade.me") que não vem de uma
/// autoridade instalada no Windows: o resultado é `UnknownError`/`NotTrusted` mesmo com o arquivo
/// íntegro. Aceitamos esse caso só para esse certificado. Arquivo alterado depois de assinado dá
/// `HashMismatch`, e arquivo sem assinatura dá `NotSigned`: os dois são recusados.
pub fn accept_signature(status: &str, subject: &str) -> Result<String> {
    let reshade_cert = subject.split(',').map(str::trim).any(|p| p == "CN=ReShade")
        && subject
            .split(',')
            .map(str::trim)
            .any(|p| p.eq_ignore_ascii_case("E=info@reshade.me"));
    match status {
        "Valid" => Ok(subject.to_string()),
        "UnknownError" | "NotTrusted" if reshade_cert => Ok(subject.to_string()),
        "HashMismatch" => Err(Error::Integrity(
            "o instalador do ReShade foi alterado depois de assinado; o download foi descartado".into(),
        )),
        "NotSigned" => Err(Error::Integrity("o instalador baixado não tem assinatura digital; o download foi descartado".into())),
        _ => Err(Error::Integrity(format!(
            "assinatura do instalador do ReShade não reconhecida ({status}, {subject}); instale pelo site reshade.me e clique em \"Já instalei\""
        ))),
    }
}

#[cfg(windows)]
mod platform {
    use std::os::windows::process::CommandExt;
    use std::path::Path;
    use std::process::Command;

    use crate::error::{Error, Result};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    /// Usa o próprio Windows (Authenticode) para validar a assinatura do instalador.
    pub fn verify_signature(file: &Path) -> Result<String> {
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "$s = Get-AuthenticodeSignature -LiteralPath $env:CP_FILE; \
                 Write-Output ($s.Status.ToString() + '|' + $s.SignerCertificate.Subject)",
            ])
            .env("CP_FILE", file)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| Error::Other(format!("não consegui verificar a assinatura: {e}")))?;
        let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let (status, subject) = text.split_once('|').unwrap_or((text.as_str(), ""));
        super::accept_signature(status, subject)
    }

    pub fn run_setup(setup: &Path, game_exe: &Path) -> Result<()> {
        Command::new(setup)
            .arg(game_exe)
            .args(["--api", "d3d9", "--headless"])
            .status()
            .map_err(|e| Error::Other(format!("não consegui abrir o instalador do ReShade: {e}")))?;
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use std::path::Path;

    use crate::error::{Error, Result};

    pub fn verify_signature(_file: &Path) -> Result<String> {
        Err(Error::Other("verificação de assinatura só no Windows".into()))
    }

    pub fn run_setup(_setup: &Path, _game_exe: &Path) -> Result<()> {
        Err(Error::Other("instalação do ReShade só no Windows".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pack() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../resources/shaders")
    }

    #[test]
    fn ini_roundtrip_preserves_other_content() {
        let src = "[GENERAL]\r\nEffectSearchPaths=.\\reshade-shaders\\Shaders\\**\r\nPresetPath=.\\ReShadePreset.ini\r\n\r\n[INPUT]\r\nKeyOverlay=36,0,0,0\r\n";
        let a = ini_set(src, "GENERAL", "PresetPath", ".\\X.ini");
        assert!(a.contains("PresetPath=.\\X.ini\r\n"));
        assert!(a.contains("KeyOverlay=36,0,0,0"));
        let b = ini_set(&a, "INPUT", "KeyEffects", "145,0,0,0");
        assert_eq!(ini_get(&b, "input", "keyeffects").as_deref(), Some("145,0,0,0"));
        let c = ini_set(&b, "OVERLAY", "Foo", "1");
        assert!(c.ends_with("[OVERLAY]\r\nFoo=1\r\n"));
        assert_eq!(ensure_search_path(&c), c, "caminho padrão já cobre a pasta");
        let d = ensure_search_path("[GENERAL]\nEffectSearchPaths=.\\outra\n");
        assert!(d.contains("EffectSearchPaths=.\\outra,.\\reshade-shaders\\Shaders\\CommandProject"));
        assert!(!ini_remove(&a, "GENERAL", "PresetPath").contains("PresetPath"));
    }

    #[test]
    fn signature_rules() {
        let rs = "CN=ReShade, E=info@reshade.me";
        assert!(accept_signature("Valid", "CN=Qualquer").is_ok());
        assert!(
            accept_signature("UnknownError", rs).is_ok(),
            "certificado próprio do ReShade"
        );
        assert!(accept_signature("NotTrusted", rs).is_ok());
        assert!(accept_signature("UnknownError", "CN=ReShade Falso, E=info@reshade.me").is_err());
        assert!(accept_signature("UnknownError", "CN=Outro, E=x@y.z").is_err());
        assert!(
            accept_signature("HashMismatch", rs).is_err(),
            "arquivo alterado nunca passa"
        );
        assert!(accept_signature("NotSigned", "").is_err());
    }

    #[test]
    fn finds_official_setup_link() {
        let html = r#"<a href="/downloads/ReShade_Setup_6.6.2_Addon.exe">x</a> <a href="/downloads/ReShade_Setup_6.6.2.exe">y</a>"#;
        let (v, url) = find_setup_link(html).unwrap();
        assert_eq!(v, "6.6.2");
        assert_eq!(url, "https://reshade.me/downloads/ReShade_Setup_6.6.2.exe");
        assert!(find_setup_link("nada aqui").is_none());
    }

    #[test]
    fn install_switch_customize_and_remove() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("d3d9.dll"), b"MZ....R\0e\0S\0h\0a\0d\0e\0....").unwrap();
        std::fs::write(bin.join("ReShade.ini"), "[GENERAL]\nPresetPath=.\\Meu.ini\n").unwrap();
        let sh = Shaders::new(bin.clone(), pack(), &tmp.path().join("data"));

        let st = sh.status().unwrap();
        assert!(st.reshade && !st.pack_installed && st.preset.is_none());

        let st = sh.apply(Some("Vivido")).unwrap();
        assert!(st.pack_installed);
        assert_eq!(st.preset.as_deref(), Some("Vivido"));
        assert!(bin
            .join("reshade-shaders/Shaders/CommandProject/CommandProject.fx")
            .is_file());
        let ini = std::fs::read_to_string(bin.join("ReShade.ini")).unwrap();
        assert!(ini.contains("PresetPath=.\\CommandProject-presets\\Vivido.ini"));
        assert!(ini.contains("KeyEffects=145,0,0,0"));

        // ajuste feito pelo usuário no menu do ReShade sobrevive a reaplicar
        let p = bin.join("CommandProject-presets/Vivido.ini");
        std::fs::write(&p, "Techniques=\n[CommandProject.fx]\nContrast=0.9\n").unwrap();
        let st = sh.apply(Some("Natural")).unwrap();
        assert!(st.presets.iter().find(|x| x.id == "Vivido").unwrap().customized);
        assert!(std::fs::read_to_string(&p).unwrap().contains("Contrast=0.9"));
        sh.reset_presets().unwrap();
        assert!(!std::fs::read_to_string(&p).unwrap().contains("Contrast=0.9"));

        let st = sh.apply(None).unwrap();
        assert!(st.preset.is_none());

        let st = sh.remove(true).unwrap();
        assert!(!st.pack_installed && !st.reshade);
        assert!(!bin.join("CommandProject-presets").exists());
        let ini = std::fs::read_to_string(bin.join("ReShade.ini")).unwrap();
        assert!(
            ini.contains("PresetPath=.\\Meu.ini"),
            "preset anterior restaurado: {ini}"
        );
        assert!(tmp.path().join("data/shaders/removido/d3d9.dll").is_file());
    }

    #[test]
    fn accepts_flattened_pack() {
        // instaladores antigos gravavam os presets direto na pasta do pacote
        let tmp = tempfile::tempdir().unwrap();
        let flat = tmp.path().join("pack");
        std::fs::create_dir_all(&flat).unwrap();
        std::fs::copy(pack().join("CommandProject.fx"), flat.join("CommandProject.fx")).unwrap();
        for e in std::fs::read_dir(pack().join("presets")).unwrap() {
            let e = e.unwrap();
            std::fs::copy(e.path(), flat.join(e.file_name())).unwrap();
        }
        let bin = tmp.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("d3d9.dll"), b"MZ....R\0e\0S\0h\0a\0d\0e\0....").unwrap();
        let sh = Shaders::new(bin.clone(), flat, &tmp.path().join("data"));
        let st = sh.apply(Some("Natural")).unwrap();
        assert_eq!(st.preset.as_deref(), Some("Natural"));
        assert!(bin.join("CommandProject-presets/Natural.ini").is_file());
    }

    #[test]
    fn refuses_foreign_d3d9() {
        let tmp = tempfile::tempdir().unwrap();
        let bin = tmp.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("d3d9.dll"), b"MZ outro wrapper").unwrap();
        let sh = Shaders::new(bin, pack(), &tmp.path().join("data"));
        assert!(sh.status().unwrap().foreign_dll);
        assert!(sh.apply(Some("Natural")).is_err());
    }
}
