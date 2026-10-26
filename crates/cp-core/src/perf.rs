//! Otimizador (opcional): ferramentas de desempenho e diagnóstico que acompanham o launcher.
//!
//! Regras desta parte do código:
//! - nada é prometido: o launcher mostra medições (memória do processo, travamentos, versão)
//!   e deixa o jogador comparar; não há "ganho de FPS" calculado.
//! - nenhum parâmetro de inicialização é inventado e o executável só é tocado pela flag de 4 GB
//!   (módulo `laa`, com cópia de segurança).
//! - o `Game.prefs` (opções do jogo) só é alterado depois de copiado para `perf/backups`.
//! - perfis de desempenho/qualidade são fotografias das opções que o próprio jogo grava: o jogador
//!   ajusta no jogo, salva como perfil e troca com um clique. Ao aplicar, só valem as opções que
//!   ainda existem no arquivo.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::blueprint::{self, Set};
use crate::error::{Error, IoContext, Result};

// ===================================================================== Game.prefs

/// Onde o jogo guarda as opções (Windows: `%LOCALAPPDATA%\Gas Powered Games\Supreme Commander 2`).
/// `CP_GAME_PREFS` troca o caminho (testes e instalações fora do padrão).
pub fn prefs_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("CP_GAME_PREFS") {
        return Some(PathBuf::from(p));
    }
    let base = std::env::var_os("LOCALAPPDATA")?;
    Some(PathBuf::from(base).join("Gas Powered Games").join("Supreme Commander 2").join("Game.prefs"))
}

const WRAP_HEAD: &str = "Prefs {\n";
const WRAP_TAIL: &str = "\n}";

/// O arquivo é uma sequência de `nome = valor` em Lua: vira uma tabela para usar o mesmo leitor
/// dos blueprints (que mantém comentários e formatação ao alterar).
pub(crate) fn wrap(text: &str) -> String {
    format!("{WRAP_HEAD}{}{WRAP_TAIL}", text.trim_start_matches('\u{feff}'))
}

fn unwrap(text: &str) -> Result<String> {
    text.strip_prefix(WRAP_HEAD)
        .and_then(|t| t.strip_suffix(WRAP_TAIL))
        .map(str::to_string)
        .ok_or_else(|| Error::Format("Game.prefs: alteração saiu do formato".into()))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum PrefValue {
    Bool(bool),
    Number(f64),
    Text(String),
}

impl PrefValue {
    fn to_set(&self) -> Set {
        match self {
            PrefValue::Bool(b) => Set::Bool(*b),
            PrefValue::Number(n) => Set::Number(*n),
            PrefValue::Text(s) => Set::Str(s.clone()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefOption {
    pub path: String,
    pub value: PrefValue,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefsInfo {
    pub path: PathBuf,
    pub exists: bool,
    /// opções de jogo (`options.*`) ou, se o arquivo não tiver essa seção, tudo que é valor simples
    pub options: Vec<PrefOption>,
    /// erro de leitura (o launcher não mexe num arquivo que não entende)
    pub error: Option<String>,
}

fn leaves_of(text: &str) -> Result<Vec<PrefOption>> {
    let bp = blueprint::parse(&wrap(text))?;
    let all: Vec<PrefOption> = bp
        .leaves()
        .into_iter()
        .filter_map(|l| {
            let value = match l.kind {
                "number" => PrefValue::Number(l.number?),
                "bool" => PrefValue::Bool(l.flag?),
                _ => PrefValue::Text(l.text?),
            };
            Some(PrefOption { path: l.path, value })
        })
        .collect();
    let opts: Vec<PrefOption> = all.iter().filter(|o| o.path.starts_with("options.")).cloned().collect();
    Ok(if opts.is_empty() { all } else { opts })
}

pub fn read_prefs(path: &Path) -> PrefsInfo {
    let Ok(text) = std::fs::read_to_string(path) else {
        return PrefsInfo { path: path.into(), exists: path.exists(), options: vec![], error: path.exists().then(|| "não deu para ler o arquivo".into()) };
    };
    match leaves_of(&text) {
        Ok(options) => PrefsInfo { path: path.into(), exists: true, options, error: None },
        Err(e) => PrefsInfo { path: path.into(), exists: true, options: vec![], error: Some(e.to_string()) },
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub name: String,
    pub size: u64,
    pub modified: Option<String>,
}

/// Copia o `Game.prefs` atual para `backups` (`Game-AAAAMMDD-HHMMSS.prefs`) e devolve o nome.
pub fn backup_prefs(path: &Path, backups: &Path) -> Result<String> {
    std::fs::create_dir_all(backups).at(backups)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%.3f").to_string().replace('.', "-");
    let name = format!("Game-{stamp}.prefs");
    std::fs::copy(path, backups.join(&name)).at(path)?;
    // guarda os 30 mais novos
    let mut list = list_backups(backups);
    if list.len() > 30 {
        for b in list.drain(30..) {
            let _ = std::fs::remove_file(backups.join(b.name));
        }
    }
    Ok(name)
}

pub fn list_backups(backups: &Path) -> Vec<Backup> {
    let mut out: Vec<Backup> = std::fs::read_dir(backups)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().ends_with(".prefs"))
                .map(|e| {
                    let md = e.metadata().ok();
                    Backup {
                        name: e.file_name().to_string_lossy().into_owned(),
                        size: md.as_ref().map(|m| m.len()).unwrap_or(0),
                        modified: md.and_then(|m| m.modified().ok()).map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339()),
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| b.name.cmp(&a.name));
    out
}

/// Altera opções do `Game.prefs` (com cópia de segurança antes). Caminhos que o arquivo não tem
/// são ignorados e devolvidos em `skipped`: o launcher não inventa opções que o jogo não gravou.
pub fn write_prefs(path: &Path, backups: &Path, changes: &[(String, PrefValue)]) -> Result<WriteReport> {
    if crate::game::is_running() {
        return Err(Error::Other("feche o jogo antes: ele regrava as opções ao sair".into()));
    }
    let text = std::fs::read_to_string(path).at(path)?;
    let known: std::collections::HashMap<String, PrefValue> = leaves_of(&text)?.into_iter().map(|o| (o.path, o.value)).collect();
    let mut apply = Vec::new();
    let mut skipped = Vec::new();
    for (p, v) in changes {
        match known.get(p) {
            Some(cur) if cur == v => {}
            Some(_) => apply.push((p.clone(), v.to_set())),
            None => skipped.push(p.clone()),
        }
    }
    if apply.is_empty() {
        return Ok(WriteReport { backup: None, changed: 0, skipped });
    }
    let backup = backup_prefs(path, backups)?;
    let new = unwrap(&blueprint::apply(&wrap(&text), &apply)?)?;
    crate::fsutil::write_atomic(path, new.as_bytes())?;
    Ok(WriteReport { backup: Some(backup), changed: apply.len(), skipped })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteReport {
    pub backup: Option<String>,
    pub changed: usize,
    pub skipped: Vec<String>,
}

/// Volta um backup (o arquivo atual também vira backup antes, então nada se perde).
pub fn restore_backup(path: &Path, backups: &Path, name: &str) -> Result<()> {
    if name.contains(['/', '\\']) || !name.ends_with(".prefs") {
        return Err(Error::Other("backup inválido".into()));
    }
    if crate::game::is_running() {
        return Err(Error::Other("feche o jogo antes".into()));
    }
    let src = backups.join(name);
    let data = std::fs::read(&src).at(&src)?;
    if path.exists() {
        backup_prefs(path, backups)?;
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).at(dir)?;
    }
    crate::fsutil::write_atomic(path, &data)
}

// ------------------------------------------------------------------ perfis

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrefProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub values: Vec<(String, PrefValue)>,
}

pub fn list_profiles(dir: &Path) -> Vec<PrefProfile> {
    let mut out: Vec<PrefProfile> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
                .filter_map(|e| serde_json::from_slice(&std::fs::read(e.path()).ok()?).ok())
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    out
}

/// Salva as opções atuais do jogo como um perfil.
pub fn save_profile(dir: &Path, prefs: &Path, name: &str, description: &str) -> Result<PrefProfile> {
    let text = std::fs::read_to_string(prefs).at(prefs)?;
    let values: Vec<(String, PrefValue)> = leaves_of(&text)?.into_iter().map(|o| (o.path, o.value)).collect();
    if values.is_empty() {
        return Err(Error::Other("o Game.prefs não tem opções para guardar".into()));
    }
    let name = name.trim();
    if name.is_empty() {
        return Err(Error::Other("dê um nome ao perfil".into()));
    }
    let slug: String = name.to_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect();
    let id = format!("{}-{}", slug.trim_matches('-'), chrono::Utc::now().timestamp_millis());
    let p = PrefProfile { id: id.clone(), name: name.chars().take(40).collect(), description: description.chars().take(200).collect(), created_at: chrono::Utc::now().to_rfc3339(), values };
    std::fs::create_dir_all(dir).at(dir)?;
    crate::fsutil::write_json(&dir.join(format!("{id}.json")), &p)?;
    Ok(p)
}

pub fn delete_profile(dir: &Path, id: &str) -> Result<()> {
    if id.contains(['/', '\\', '.']) {
        return Err(Error::Other("perfil inválido".into()));
    }
    let f = dir.join(format!("{id}.json"));
    std::fs::remove_file(&f).at(&f)?;
    Ok(())
}

pub fn apply_profile(dir: &Path, prefs: &Path, backups: &Path, id: &str) -> Result<WriteReport> {
    let p = list_profiles(dir).into_iter().find(|p| p.id == id).ok_or_else(|| Error::Other("perfil não encontrado".into()))?;
    write_prefs(prefs, backups, &p.values)
}

// ===================================================================== travamentos (.mdmp)

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpInfo {
    pub code: u32,
    pub code_name: String,
    pub address: u64,
    /// módulo (dll/exe) onde estava a instrução que falhou
    pub module: Option<String>,
    pub module_offset: Option<u64>,
    pub modules: usize,
    pub hint: String,
}

fn u32_at(d: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes(d.get(o..o + 4)?.try_into().ok()?))
}
fn u64_at(d: &[u8], o: usize) -> Option<u64> {
    Some(u64::from_le_bytes(d.get(o..o + 8)?.try_into().ok()?))
}

fn code_name(code: u32) -> &'static str {
    match code {
        0xC000_0005 => "acesso inválido à memória",
        0xC000_0017 | 0xC000_012D => "sem memória",
        0xC000_00FD => "estouro de pilha",
        0xC000_0094 => "divisão por zero",
        0xC000_001D => "instrução inválida",
        0xC000_0409 => "proteção de pilha (buffer)",
        0xE06D_7363 => "exceção C++ não tratada",
        0x8000_0003 => "ponto de parada",
        _ => "erro desconhecido",
    }
}

/// Lê o essencial de um minidump do Windows: código do erro, endereço e o módulo culpado.
pub fn analyze_dump(d: &[u8]) -> Result<DumpInfo> {
    let bad = || Error::Format("relatório de travamento inválido".into());
    if d.get(0..4) != Some(b"MDMP") {
        return Err(bad());
    }
    let n = u32_at(d, 8).ok_or_else(bad)? as usize;
    let dir = u32_at(d, 12).ok_or_else(bad)? as usize;
    let mut exception = None;
    let mut modules: Vec<(u64, u32, String)> = vec![];
    for i in 0..n.min(512) {
        let e = dir + i * 12;
        let (Some(kind), Some(rva)) = (u32_at(d, e), u32_at(d, e + 8)) else { break };
        let rva = rva as usize;
        match kind {
            // ExceptionStream: ThreadId, alinhamento, MINIDUMP_EXCEPTION
            6 => exception = Some((u32_at(d, rva + 8).ok_or_else(bad)?, u64_at(d, rva + 8 + 16).ok_or_else(bad)?)),
            // ModuleListStream
            4 => {
                let count = u32_at(d, rva).unwrap_or(0) as usize;
                for m in 0..count.min(2048) {
                    let o = rva + 4 + m * 108;
                    let (Some(base), Some(size), Some(name_rva)) = (u64_at(d, o), u32_at(d, o + 8), u32_at(d, o + 20)) else { break };
                    let name_rva = name_rva as usize;
                    let len = u32_at(d, name_rva).unwrap_or(0) as usize;
                    let name = d
                        .get(name_rva + 4..name_rva + 4 + len.min(1024))
                        .map(|b| {
                            let w: Vec<u16> = b.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                            String::from_utf16_lossy(&w)
                        })
                        .unwrap_or_default();
                    let short = name.rsplit(['\\', '/']).next().unwrap_or(&name).to_string();
                    modules.push((base, size, short));
                }
            }
            _ => {}
        }
    }
    let (code, address) = exception.ok_or_else(|| Error::Format("o relatório não tem a exceção".into()))?;
    let culprit = modules.iter().find(|(b, s, _)| address >= *b && address < b + *s as u64);
    let module = culprit.map(|m| m.2.clone());
    let lower = module.as_deref().unwrap_or("").to_ascii_lowercase();
    let hint = if lower.contains("fmod") {
        "Falhou no sistema de som (FMOD). Já aconteceu com muitos pacotes de mods montados ao mesmo tempo ou mods com sons: desligue os mods mais recentes e teste de novo."
    } else if ["d3d9", "nvd3dum", "nvldumd", "atiumdag", "aticfx", "igdumd", "igd9", "dxgi"].iter().any(|k| lower.contains(k)) {
        "Falhou no driver de vídeo ou no Direct3D. Atualize o driver, desligue os shaders (ReShade) e teste sem mods de texturas HD."
    } else if lower.contains("reshade") || lower == "d3d9.dll" {
        "Falhou dentro do ReShade: desligue os shaders na aba Visual e teste."
    } else if code == 0xC000_0017 || code == 0xC000_012D || code == 0xE06D_7363 {
        "Pode ser falta de memória: ligue o modo 4 GB em Desempenho e evite texturas HD em 4x."
    } else if lower.contains("supremecommander2") {
        "Falhou no próprio jogo. Se começou depois de ligar um mod, desligue-o; mapas ou tropas experimentais também podem causar isso."
    } else if module.is_none() {
        "O endereço não pertence a nenhum módulo: costuma ser memória corrompida. Teste sem mods para confirmar."
    } else {
        "Falhou num componente externo ao jogo (overlay, antivírus ou programa de gravação podem causar isso)."
    };
    Ok(DumpInfo {
        code,
        code_name: code_name(code).into(),
        address,
        module_offset: culprit.map(|m| address - m.0),
        module,
        modules: modules.len(),
        hint: hint.into(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashDump {
    pub name: String,
    pub size: u64,
    pub modified: Option<String>,
    pub info: Option<DumpInfo>,
    pub error: Option<String>,
}

/// Relatórios de travamento (`*.mdmp`) da pasta do jogo, do mais novo para o mais velho.
pub fn list_dumps(bin: &Path) -> Vec<CrashDump> {
    let mut out: Vec<(std::time::SystemTime, CrashDump)> = std::fs::read_dir(bin)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.file_name().to_string_lossy().to_ascii_lowercase().ends_with(".mdmp"))
                .map(|e| {
                    let md = e.metadata().ok();
                    let t = md.as_ref().and_then(|m| m.modified().ok()).unwrap_or(std::time::UNIX_EPOCH);
                    // minidumps do jogo têm poucos MB; o limite só protege contra arquivos gigantes
                    let (info, error) = match read_head(&e.path(), 256 << 20).and_then(|d| analyze_dump(&d)) {
                        Ok(i) => (Some(i), None),
                        Err(err) => (None, Some(err.to_string())),
                    };
                    (
                        t,
                        CrashDump {
                            name: e.file_name().to_string_lossy().into_owned(),
                            size: md.map(|m| m.len()).unwrap_or(0),
                            modified: Some(chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339()),
                            info,
                            error,
                        },
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by_key(|b| std::cmp::Reverse(b.0));
    out.into_iter().map(|x| x.1).collect()
}

fn read_head(p: &Path, max: u64) -> Result<Vec<u8>> {
    use std::io::Read;
    let mut v = Vec::new();
    std::fs::File::open(p).at(p)?.take(max).read_to_end(&mut v).at(p)?;
    Ok(v)
}

/// Apaga relatórios de travamento (só `.mdmp`, só na pasta indicada).
pub fn delete_dumps(bin: &Path, names: &[String]) -> Result<usize> {
    let mut n = 0;
    for name in names {
        if name.contains(['/', '\\']) || !name.to_ascii_lowercase().ends_with(".mdmp") {
            continue;
        }
        if std::fs::remove_file(bin.join(name)).is_ok() {
            n += 1;
        }
    }
    Ok(n)
}

// ===================================================================== versão do jogo

/// Versão do arquivo (VS_FIXEDFILEINFO) de um executável do Windows: `"1.2.6.0"`.
pub fn file_version(exe: &[u8]) -> Option<String> {
    const SIG: [u8; 4] = 0xFEEF_04BDu32.to_le_bytes();
    let pos = exe.windows(4).rposition(|w| w == SIG)?;
    let ms = u32_at(exe, pos + 8)?;
    let ls = u32_at(exe, pos + 12)?;
    Some(format!("{}.{}.{}.{}", ms >> 16, ms & 0xffff, ls >> 16, ls & 0xffff))
}

/// Versão final publicada do SC2 (atualização 1.26 da Steam).
pub const KNOWN_LATEST: &str = "1.26";

/// Compara com a versão final: `Some(true)` = atualizada.
pub fn is_latest(version: &str) -> Option<bool> {
    let mut it = version.split('.').filter_map(|p| p.parse::<u32>().ok());
    let (a, b) = (it.next()?, it.next()?);
    let c = it.next().unwrap_or(0);
    // o executável costuma gravar 1.260 ou 1.2.6
    let minor = if b < 10 && c > 0 { b * 10 + c } else if b >= 100 { b / 10 } else { b };
    Some(a > 1 || (a == 1 && minor >= 26))
}

// ===================================================================== processo do jogo

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStats {
    pub pid: u32,
    /// memória em uso (working set)
    pub memory_mb: u64,
    pub virtual_mb: u64,
    pub cpu_percent: f32,
    pub run_seconds: u64,
}

/// Medição do jogo aberto (ou `None`).
pub fn game_process() -> Option<ProcessStats> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    let kind = ProcessRefreshKind::nothing().with_memory().with_cpu();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, kind);
    let pid = sys
        .processes()
        .iter()
        .find(|(_, p)| p.name().to_string_lossy().eq_ignore_ascii_case(crate::game::EXE_NAME))
        .map(|(pid, _)| *pid)?;
    // a CPU precisa de duas leituras
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, kind);
    let p = sys.process(pid)?;
    Some(ProcessStats {
        pid: pid.as_u32(),
        memory_mb: p.memory() / 1_048_576,
        virtual_mb: p.virtual_memory() / 1_048_576,
        cpu_percent: p.cpu_usage(),
        run_seconds: p.run_time(),
    })
}

pub const PRIORITIES: &[&str] = &["normal", "above_normal", "high"];

/// Muda a prioridade do processo do jogo (Windows). `normal` não faz nada.
#[cfg(windows)]
pub fn set_game_priority(level: &str) -> Result<Option<u32>> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, SetPriorityClass, ABOVE_NORMAL_PRIORITY_CLASS, HIGH_PRIORITY_CLASS, PROCESS_SET_INFORMATION,
    };
    let class = match level {
        "above_normal" => ABOVE_NORMAL_PRIORITY_CLASS,
        "high" => HIGH_PRIORITY_CLASS,
        _ => return Ok(None),
    };
    let Some(pid) = game_pid() else { return Err(Error::Other("o jogo não está aberto".into())) };
    // SAFETY: handle verificado e fechado logo depois.
    unsafe {
        let h = OpenProcess(PROCESS_SET_INFORMATION, 0, pid);
        if h.is_null() {
            return Err(Error::Other("sem permissão para mudar a prioridade do jogo".into()));
        }
        let ok = SetPriorityClass(h, class) != 0;
        CloseHandle(h);
        if !ok {
            return Err(Error::Other("o Windows recusou a prioridade".into()));
        }
    }
    Ok(Some(pid))
}

/// Tira o jogo do modo de economia de energia do Windows (EcoQoS / "power throttling"): o Windows
/// não reduz a velocidade do processo quando ele parece estar em segundo plano.
#[cfg(windows)]
pub fn set_game_no_throttle() -> Result<Option<u32>> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, ProcessPowerThrottling, SetProcessInformation, PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        PROCESS_POWER_THROTTLING_EXECUTION_SPEED, PROCESS_POWER_THROTTLING_STATE, PROCESS_SET_INFORMATION,
    };
    let Some(pid) = game_pid() else { return Err(Error::Other("o jogo não está aberto".into())) };
    // controle ligado e estado desligado = "nunca economizar" para este processo
    let state = PROCESS_POWER_THROTTLING_STATE {
        Version: PROCESS_POWER_THROTTLING_CURRENT_VERSION,
        ControlMask: PROCESS_POWER_THROTTLING_EXECUTION_SPEED,
        StateMask: 0,
    };
    // SAFETY: handle verificado e fechado logo depois; a estrutura vive até o fim da chamada.
    unsafe {
        let h = OpenProcess(PROCESS_SET_INFORMATION, 0, pid);
        if h.is_null() {
            return Err(Error::Other("sem permissão para mudar o modo de energia do jogo".into()));
        }
        let ok = SetProcessInformation(
            h,
            ProcessPowerThrottling,
            &state as *const PROCESS_POWER_THROTTLING_STATE as *const core::ffi::c_void,
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        ) != 0;
        CloseHandle(h);
        if !ok {
            return Err(Error::Other("o Windows recusou o modo de energia".into()));
        }
    }
    Ok(Some(pid))
}

#[cfg(not(windows))]
pub fn set_game_no_throttle() -> Result<Option<u32>> {
    Err(Error::Other("o modo de energia só é aplicado no Windows".into()))
}

#[cfg(not(windows))]
pub fn set_game_priority(level: &str) -> Result<Option<u32>> {
    if level == "normal" {
        return Ok(None);
    }
    Err(Error::Other("a prioridade do processo só é aplicada no Windows".into()))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn game_pid() -> Option<u32> {
    use sysinfo::{ProcessRefreshKind, RefreshKind, System};
    let sys = System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()));
    sys.processes()
        .iter()
        .find(|(_, p)| p.name().to_string_lossy().eq_ignore_ascii_case(crate::game::EXE_NAME))
        .map(|(pid, _)| pid.as_u32())
}

#[cfg(test)]
mod tests {
    use super::*;

    const PREFS: &str = "-- gravado pelo jogo\nprofile = {\n    current = 1,\n}\noptions = {\n    shadow_quality = 2,\n    vsync = true,\n    ['primary_adapter'] = '1920,1080,60',\n}\n";

    #[test]
    fn prefs_read_write_backup_and_profiles() {
        let dir = tempfile::tempdir().unwrap();
        let prefs = dir.path().join("Game.prefs");
        std::fs::write(&prefs, PREFS).unwrap();
        let backups = dir.path().join("bk");
        let info = read_prefs(&prefs);
        assert!(info.error.is_none(), "{:?}", info.error);
        let names: Vec<_> = info.options.iter().map(|o| o.path.as_str()).collect();
        assert_eq!(names, ["options.shadow_quality", "options.vsync", "options.primary_adapter"]);

        let r = write_prefs(&prefs, &backups, &[("options.shadow_quality".into(), PrefValue::Number(0.0)), ("options.inventada".into(), PrefValue::Bool(true))]).unwrap();
        assert_eq!(r.changed, 1);
        assert_eq!(r.skipped, ["options.inventada"]);
        let text = std::fs::read_to_string(&prefs).unwrap();
        assert!(text.starts_with("-- gravado pelo jogo"), "comentário mantido");
        assert!(text.contains("shadow_quality = 0"));
        assert!(!text.contains("inventada"));
        assert_eq!(list_backups(&backups).len(), 1);
        // sem mudança real: não cria backup
        let r = write_prefs(&prefs, &backups, &[("options.vsync".into(), PrefValue::Bool(true))]).unwrap();
        assert_eq!((r.changed, r.backup.is_none()), (0, true));

        let pdir = dir.path().join("profiles");
        let low = save_profile(&pdir, &prefs, "Desempenho", "sombras desligadas").unwrap();
        write_prefs(&prefs, &backups, &[("options.shadow_quality".into(), PrefValue::Number(3.0))]).unwrap();
        apply_profile(&pdir, &prefs, &backups, &low.id).unwrap();
        assert!(std::fs::read_to_string(&prefs).unwrap().contains("shadow_quality = 0"));

        let first = list_backups(&backups).last().unwrap().name.clone();
        restore_backup(&prefs, &backups, &first).unwrap();
        assert_eq!(std::fs::read_to_string(&prefs).unwrap(), PREFS);
        assert!(restore_backup(&prefs, &backups, "../x.prefs").is_err());
    }

    fn fake_dump(code: u32, addr: u64) -> Vec<u8> {
        let mut d = vec![0u8; 32];
        d[0..4].copy_from_slice(b"MDMP");
        d[8..12].copy_from_slice(&2u32.to_le_bytes());
        d[12..16].copy_from_slice(&32u32.to_le_bytes());
        // diretório (2 entradas) em 32
        let exc = 32 + 24;
        let mods = exc + 168;
        let mut dir = vec![];
        for (k, rva) in [(6u32, exc as u32), (4u32, mods as u32)] {
            dir.extend_from_slice(&k.to_le_bytes());
            dir.extend_from_slice(&0u32.to_le_bytes());
            dir.extend_from_slice(&rva.to_le_bytes());
        }
        d.extend(dir);
        let mut e = vec![0u8; 168];
        e[8..12].copy_from_slice(&code.to_le_bytes());
        e[24..32].copy_from_slice(&addr.to_le_bytes());
        d.extend(e);
        let name_rva = mods + 4 + 2 * 108;
        let names = ["C:\\Game\\bin\\SupremeCommander2.exe", "C:\\Game\\bin\\fmod_event.dll"];
        let mut m = 2u32.to_le_bytes().to_vec();
        let mut strings = vec![];
        for (i, (base, size)) in [(0x400000u64, 0x800000u32), (0x1000_0000u64, 0x10_0000u32)].iter().enumerate() {
            let mut rec = vec![0u8; 108];
            rec[0..8].copy_from_slice(&base.to_le_bytes());
            rec[8..12].copy_from_slice(&size.to_le_bytes());
            rec[20..24].copy_from_slice(&((name_rva + strings.len()) as u32).to_le_bytes());
            m.extend(rec);
            let w: Vec<u8> = names[i].encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
            strings.extend((w.len() as u32).to_le_bytes());
            strings.extend(w);
        }
        d.extend(m);
        d.extend(strings);
        d
    }

    #[test]
    fn dump_analysis_finds_module() {
        let i = analyze_dump(&fake_dump(0xC000_0005, 0x1000_1234)).unwrap();
        assert_eq!(i.module.as_deref(), Some("fmod_event.dll"));
        assert_eq!(i.module_offset, Some(0x1234));
        assert_eq!(i.modules, 2);
        assert!(i.hint.contains("FMOD"));
        let j = analyze_dump(&fake_dump(0xC000_0005, 0x401000)).unwrap();
        assert_eq!(j.module.as_deref(), Some("SupremeCommander2.exe"));
        assert!(analyze_dump(b"nada").is_err());

        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("SC2_1.mdmp"), fake_dump(0xC000_0005, 0x1000_0010)).unwrap();
        std::fs::write(dir.path().join("outro.txt"), b"x").unwrap();
        let l = list_dumps(dir.path());
        assert_eq!(l.len(), 1);
        assert!(l[0].info.is_some());
        assert_eq!(delete_dumps(dir.path(), &["SC2_1.mdmp".into(), "outro.txt".into(), "../x.mdmp".into()]).unwrap(), 1);
        assert!(dir.path().join("outro.txt").exists());
    }

    #[test]
    fn version_from_fixed_file_info() {
        let mut exe = vec![0u8; 64];
        exe.extend(0xFEEF_04BDu32.to_le_bytes());
        exe.extend(0x0001_0000u32.to_le_bytes());
        exe.extend(((1u32 << 16) | 260).to_le_bytes()); // MS = 1.260
        exe.extend(0u32.to_le_bytes());
        exe.extend([0u8; 40]);
        let v = file_version(&exe).unwrap();
        assert_eq!(v, "1.260.0.0");
        assert_eq!(is_latest(&v), Some(true));
        assert_eq!(is_latest("1.2.6.0"), Some(true));
        assert_eq!(is_latest("1.2.5.0"), Some(false));
        assert_eq!(is_latest("1.250.0.0"), Some(false));
        assert_eq!(is_latest("x"), None);
    }
}
