//! Ponte para o **SC2 Map Toolkit** (plutonics72/supcom2-map-toolkit, licença MIT).
//!
//! O toolkit é Python puro (só biblioteca padrão) e sua lógica de navmesh foi validada
//! dentro do jogo — por isso ele é executado como está, em vez de reescrito. O launcher
//! conversa com ele pelo `maptk_bridge.py`: entrada JSON pelo stdin, eventos JSON pelo stdout
//! (uma linha por evento, prefixadas com `@@`).

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Python {
    pub program: PathBuf,
    pub prefix_args: Vec<String>,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum BridgeEvent {
    Progress {
        message: String,
        #[serde(default)]
        pct: Option<f32>,
    },
    Log {
        message: String,
    },
    Result {
        data: serde_json::Value,
    },
    Error {
        message: String,
        #[serde(default)]
        detail: Option<String>,
    },
}

fn no_window(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

fn probe(program: &Path, prefix: &[&str]) -> Option<Python> {
    let mut cmd = Command::new(program);
    cmd.args(prefix)
        .args(["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3])"]);
    cmd.stdout(Stdio::piped()).stderr(Stdio::null()).stdin(Stdio::null());
    no_window(&mut cmd);
    let out = cmd.output().ok()?;
    if !out.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let mut parts = version.split('.').filter_map(|p| p.parse::<u32>().ok());
    let (maj, min) = (parts.next()?, parts.next()?);
    if maj < 3 || (maj == 3 && min < 9) {
        return None; // o toolkit precisa de 3.9+
    }
    Some(Python {
        program: program.to_path_buf(),
        prefix_args: prefix.iter().map(|s| s.to_string()).collect(),
        version,
    })
}

/// Procura um Python 3.9+: configuração do usuário → Python embutido no app → sistema.
pub fn find_python(configured: Option<&Path>, bundled_dir: Option<&Path>) -> Option<Python> {
    if let Some(p) = configured {
        if let Some(py) = probe(p, &[]) {
            return Some(py);
        }
    }
    if let Some(dir) = bundled_dir {
        for exe in ["python.exe", "bin/python3", "python3", "python"] {
            let p = dir.join(exe);
            if p.is_file() {
                if let Some(py) = probe(&p, &[]) {
                    return Some(py);
                }
            }
        }
    }
    #[cfg(windows)]
    if let Some(py) = probe(Path::new("py"), &["-3"]) {
        return Some(py);
    }
    for name in ["python3", "python"] {
        if let Some(py) = probe(Path::new(name), &[]) {
            return Some(py);
        }
    }
    None
}

pub struct Bridge {
    pub python: Python,
    /// Pasta com `maptk_bridge.py`, `sc2maps.py` e `make_map.py`.
    pub script_dir: PathBuf,
}

impl Bridge {
    /// Executa um comando do bridge. `on_event` recebe progresso/log; o retorno é o `result`.
    pub fn run(
        &self,
        command: &str,
        input: &serde_json::Value,
        gamedata: &Path,
        out_dir: &Path,
        on_event: &mut dyn FnMut(&BridgeEvent),
    ) -> Result<serde_json::Value> {
        let script = self.script_dir.join("maptk_bridge.py");
        if !script.is_file() {
            return Err(Error::Other(format!(
                "toolkit de mapas não encontrado em {}",
                self.script_dir.display()
            )));
        }
        std::fs::create_dir_all(out_dir).map_err(|e| Error::io(out_dir, e))?;
        let mut cmd = Command::new(&self.python.program);
        cmd.args(&self.python.prefix_args)
            .arg("-X")
            .arg("utf8")
            .arg(&script)
            .arg(command)
            .current_dir(&self.script_dir)
            .env("SC2_GAMEDATA", gamedata)
            .env("SC2_MAP_OUT", out_dir)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        no_window(&mut cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| Error::Other(format!("não foi possível iniciar o Python: {e}")))?;
        {
            let mut stdin = child.stdin.take().expect("stdin");
            let body = serde_json::to_vec(input).map_err(|e| Error::Other(e.to_string()))?;
            stdin.write_all(&body).map_err(|e| Error::Other(e.to_string()))?;
        }
        let stderr = child.stderr.take().expect("stderr");
        let err_thread = std::thread::spawn(move || {
            let mut s = String::new();
            for line in BufReader::new(stderr).lines().map_while(|l| l.ok()) {
                if s.len() < 64 * 1024 {
                    s.push_str(&line);
                    s.push('\n');
                }
            }
            s
        });
        let mut result = None;
        let mut error = None;
        let stdout = child.stdout.take().expect("stdout");
        for line in BufReader::new(stdout).lines().map_while(|l| l.ok()) {
            let ev = match line.strip_prefix("@@") {
                Some(json) => {
                    serde_json::from_str::<BridgeEvent>(json).unwrap_or(BridgeEvent::Log { message: line.clone() })
                }
                None => BridgeEvent::Log { message: line.clone() },
            };
            match &ev {
                BridgeEvent::Result { data } => result = Some(data.clone()),
                BridgeEvent::Error { message, detail } => {
                    error = Some(match detail {
                        Some(d) if !d.is_empty() => format!("{message}\n{d}"),
                        _ => message.clone(),
                    })
                }
                _ => {}
            }
            on_event(&ev);
        }
        let status = child.wait().map_err(|e| Error::Other(e.to_string()))?;
        let stderr_text = err_thread.join().unwrap_or_default();
        if let Some(e) = error {
            return Err(Error::Other(e));
        }
        match result {
            Some(r) if status.success() => Ok(r),
            _ => Err(Error::Other(format!(
                "o toolkit de mapas falhou ({status}){}",
                if stderr_text.trim().is_empty() {
                    String::new()
                } else {
                    format!(":\n{}", tail(&stderr_text, 2000))
                }
            ))),
        }
    }
}

fn tail(s: &str, n: usize) -> &str {
    if s.len() <= n {
        return s;
    }
    let mut start = s.len() - n;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    &s[start..]
}
