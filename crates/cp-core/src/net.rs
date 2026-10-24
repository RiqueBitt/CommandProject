//! Downloads robustos: arquivo `.part` com retomada (HTTP Range), novas tentativas com espera
//! crescente, tempo-limite por leitura (não pelo download inteiro), progresso com velocidade e
//! conferência de tamanho e SHA-256 antes de entregar o arquivo.

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use futures_util::StreamExt;
use tokio::io::AsyncWriteExt;

use crate::error::{Error, Result};

static OFFLINE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Modo local: nenhuma conexão de rede sai do launcher (hub, servidor, atualizações).
pub fn set_offline(v: bool) {
    OFFLINE.store(v, std::sync::atomic::Ordering::Relaxed);
}
pub fn is_offline() -> bool {
    OFFLINE.load(std::sync::atomic::Ordering::Relaxed)
}
fn guard() -> Result<()> {
    if is_offline() {
        return Err(Error::Network("o modo local está ligado (sem internet). Desligue em Configurações → Modo local para usar o hub, o multiplayer e as atualizações".into()));
    }
    Ok(())
}

/// Cliente HTTP padrão do launcher.
pub fn client() -> Result<reqwest::Client> {
    guard()?;
    builder().build().map_err(|e| Error::Network(e.to_string()))
}

/// Cliente para um endereço específico: servidores locais (localhost) não passam por proxy.
pub fn client_for(url: &str) -> Result<reqwest::Client> {
    guard()?;
    let local = reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| matches!(h, "localhost" | "127.0.0.1" | "[::1]")))
        .unwrap_or(false);
    let b = builder();
    if local { b.no_proxy() } else { b }.build().map_err(|e| Error::Network(e.to_string()))
}

fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .user_agent(concat!("CommandProject/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        // sem limite total: arquivos grandes em conexões lentas não podem morrer no meio;
        // o que derruba a conexão é ficar 30 s sem receber nada
        .read_timeout(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(30))
}

#[derive(Debug, Clone, Copy)]
pub struct Progress {
    pub downloaded: u64,
    /// 0 quando o servidor não informa o tamanho.
    pub total: u64,
    pub bytes_per_sec: f64,
}

impl Progress {
    /// "2,1 de 4,0 MB · 1,2 MB/s"
    pub fn describe(&self) -> String {
        let mb = |b: u64| format!("{:.1}", b as f64 / 1_048_576.0).replace('.', ",");
        let speed = if self.bytes_per_sec > 0.0 {
            format!(" · {} MB/s", format!("{:.1}", self.bytes_per_sec / 1_048_576.0).replace('.', ","))
        } else {
            String::new()
        };
        if self.total > 0 {
            format!("{} de {} MB{speed}", mb(self.downloaded), mb(self.total))
        } else {
            format!("{} MB{speed}", mb(self.downloaded))
        }
    }

    pub fn fraction(&self) -> Option<f64> {
        (self.total > 0).then(|| (self.downloaded as f64 / self.total as f64).min(1.0))
    }
}

#[derive(Debug, Clone, Default)]
pub struct Expect {
    /// Tamanho exato esperado (se conhecido).
    pub size: Option<u64>,
    /// SHA-256 esperado em hexadecimal (se conhecido).
    pub sha256: Option<String>,
    /// Limite de segurança para downloads sem tamanho conhecido.
    pub max_bytes: Option<u64>,
}

const ATTEMPTS: u32 = 4;

/// Baixa `url` para `dest` e devolve o SHA-256. Se `dest` já existe e confere com `expect`,
/// não baixa de novo. Retoma de onde parou se a conexão cair.
pub async fn download(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expect: &Expect,
    progress: &mut (dyn FnMut(Progress) + Send),
) -> Result<String> {
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| Error::io(parent, e))?;
    }
    if dest.is_file() {
        if let Some(want) = &expect.sha256 {
            if crate::fsutil::sha256_file(dest)?.eq_ignore_ascii_case(want) {
                return Ok(want.to_ascii_lowercase());
            }
        }
    }
    let part = part_path(dest);
    let mut last_err = None;
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(800 * 2u64.pow(attempt - 1))).await;
        }
        match fetch_once(client, url, &part, expect, progress).await {
            Ok(()) => {
                let sha = crate::fsutil::sha256_file(&part)?;
                if let Some(want) = &expect.sha256 {
                    if !sha.eq_ignore_ascii_case(want) {
                        let _ = tokio::fs::remove_file(&part).await;
                        return Err(Error::Integrity(
                            "o arquivo baixado não confere (SHA-256) — foi descartado".into(),
                        ));
                    }
                }
                tokio::fs::rename(&part, dest).await.map_err(|e| Error::io(dest, e))?;
                return Ok(sha);
            }
            Err(e @ Error::Integrity(_)) => {
                let _ = tokio::fs::remove_file(&part).await;
                return Err(e);
            }
            Err(e) if is_permanent(&e) => return Err(e),
            Err(e) => last_err = Some(e),
        }
    }
    Err(last_err.unwrap_or_else(|| Error::Network("falha no download".into())))
}

fn part_path(dest: &Path) -> PathBuf {
    let name = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    dest.with_file_name(format!("{name}.part"))
}

/// Erros que não melhoram tentando de novo (404, 403, link de página…).
fn is_permanent(e: &Error) -> bool {
    matches!(e, Error::Network(m) if m.starts_with("HTTP 4") || m.contains("página"))
}

async fn fetch_once(
    client: &reqwest::Client,
    url: &str,
    part: &Path,
    expect: &Expect,
    progress: &mut (dyn FnMut(Progress) + Send),
) -> Result<()> {
    let have = tokio::fs::metadata(part).await.map(|m| m.len()).unwrap_or(0);
    let mut req = client.get(url);
    if have > 0 {
        req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let resp = req.send().await.map_err(|e| Error::Network(format!("falha na conexão: {}", short(&e))))?;
    let status = resp.status();
    if !(status.is_success()) {
        if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE && have > 0 {
            // o .part já tem tudo (ou está estragado): recomeça do zero na próxima tentativa
            let _ = tokio::fs::remove_file(part).await;
        }
        return Err(Error::Network(format!("HTTP {}", status.as_u16())));
    }
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ctype.starts_with("text/html") {
        return Err(Error::Network("o link abre uma página, não um arquivo".into()));
    }
    let resumed = status == reqwest::StatusCode::PARTIAL_CONTENT && have > 0;
    let start = if resumed { have } else { 0 };
    let total = resp.content_length().map(|n| n + start).or(expect.size).unwrap_or(0);
    if let (Some(want), true) = (expect.size, total > 0) {
        if total != want {
            return Err(Error::Integrity(format!(
                "o servidor mandou {total} bytes, mas o esperado era {want}"
            )));
        }
    }
    let limit = expect.size.or(expect.max_bytes).unwrap_or(u64::MAX);
    if total > limit {
        return Err(Error::Integrity("arquivo grande demais".into()));
    }
    let mut file = if resumed {
        tokio::fs::OpenOptions::new().append(true).open(part).await
    } else {
        tokio::fs::File::create(part).await
    }
    .map_err(|e| Error::io(part, e))?;

    let mut got = start;
    let started = Instant::now();
    let mut last_emit = Instant::now() - Duration::from_secs(1);
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| Error::Network(format!("a conexão caiu: {}", short(&e))))?;
        got += chunk.len() as u64;
        if got > limit {
            drop(file);
            let _ = tokio::fs::remove_file(part).await;
            return Err(Error::Integrity("o download é maior do que o esperado — cancelado".into()));
        }
        file.write_all(&chunk).await.map_err(|e| Error::io(part, e))?;
        if last_emit.elapsed() >= Duration::from_millis(150) {
            last_emit = Instant::now();
            let secs = started.elapsed().as_secs_f64().max(0.001);
            progress(Progress { downloaded: got, total, bytes_per_sec: (got - start) as f64 / secs });
        }
    }
    file.flush().await.map_err(|e| Error::io(part, e))?;
    file.sync_all().await.map_err(|e| Error::io(part, e))?;
    drop(file);
    progress(Progress { downloaded: got, total: total.max(got), bytes_per_sec: 0.0 });
    if total > 0 && got != total {
        return Err(Error::Network(format!("download incompleto ({got} de {total} bytes)")));
    }
    Ok(())
}

fn short(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "tempo esgotado".into()
    } else if e.is_connect() {
        "sem conexão com o servidor".into()
    } else {
        e.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    /// Servidor HTTP mínimo: na 1ª conexão manda metade e derruba; nas outras respeita Range.
    fn flaky_server(body: Vec<u8>) -> (String, Arc<AtomicUsize>) {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/arquivo.bin", l.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let h = hits.clone();
        std::thread::spawn(move || {
            for stream in l.incoming() {
                let mut s = stream.unwrap();
                let mut buf = [0u8; 2048];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                let hit = h.fetch_add(1, Ordering::SeqCst);
                let from = req
                    .lines()
                    .find_map(|l| l.strip_prefix("range: bytes="))
                    .and_then(|r| r.trim_end_matches('-').trim().trim_end_matches('-').parse::<usize>().ok())
                    .unwrap_or(0);
                let rest = &body[from..];
                let head = if from > 0 {
                    format!(
                        "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes {}-{}/{}\r\nConnection: close\r\n\r\n",
                        rest.len(), from, body.len() - 1, body.len()
                    )
                } else {
                    format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len())
                };
                let _ = s.write_all(head.as_bytes());
                if hit == 0 {
                    let _ = s.write_all(&rest[..rest.len() / 2]);
                    let _ = s.flush();
                    drop(s); // cai no meio
                } else {
                    let _ = s.write_all(rest);
                }
            }
        });
        (url, hits)
    }

    #[tokio::test]
    async fn resumes_after_connection_drop_and_checks_hash() {
        let body: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        let sha = hex::encode(Sha256::digest(&body));
        let (url, hits) = flaky_server(body.clone());
        let t = tempfile::tempdir().unwrap();
        let dest = t.path().join("arquivo.bin");
        let mut last = None;
        let got = download(
            &client_for(&url).unwrap(),
            &url,
            &dest,
            &Expect { size: Some(body.len() as u64), sha256: Some(sha.clone()), max_bytes: None },
            &mut |p| last = Some(p),
        )
        .await
        .unwrap();
        assert_eq!(got, sha);
        assert_eq!(std::fs::read(&dest).unwrap(), body);
        assert!(hits.load(Ordering::SeqCst) >= 2, "precisou retomar");
        assert!(!part_path(&dest).exists());
        assert_eq!(last.unwrap().downloaded, body.len() as u64);
        // já baixado e conferido: não baixa de novo
        let before = hits.load(Ordering::SeqCst);
        download(&client_for(&url).unwrap(), &url, &dest, &Expect { sha256: Some(sha), ..Default::default() }, &mut |_| {})
            .await
            .unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), before);
    }

    #[tokio::test]
    async fn rejects_wrong_hash() {
        let body = vec![7u8; 5000];
        let (url, _) = flaky_server(body);
        let t = tempfile::tempdir().unwrap();
        let dest = t.path().join("x.bin");
        let e = download(
            &client_for(&url).unwrap(),
            &url,
            &dest,
            &Expect { sha256: Some("00".repeat(32)), ..Default::default() },
            &mut |_| {},
        )
        .await
        .unwrap_err();
        assert!(matches!(e, Error::Integrity(_)), "{e}");
        assert!(!dest.exists() && !part_path(&dest).exists());
    }

    #[test]
    fn describes_progress_in_ptbr() {
        let p = Progress { downloaded: 2_202_009, total: 4_194_304, bytes_per_sec: 1_258_291.0 };
        assert_eq!(p.describe(), "2,1 de 4,0 MB · 1,2 MB/s");
        assert!((p.fraction().unwrap() - 0.525).abs() < 0.01);
    }
}
