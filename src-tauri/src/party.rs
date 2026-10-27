//! **Sala de convite** da partida grande com amigos, sem servidor dedicado: o launcher do anfitrião
//! abre um servidor pequeno (TCP, a mesma porta da partida) que só responde a quem tem o código do
//! convite. Por ele, quem entra:
//!
//! * lê a partida (mapa, vagas, regras) e a lista de mods do anfitrião (`/info`);
//! * baixa os mods que faltam ou estão diferentes, inclusive o do mapa personalizado (`/mod/...`);
//! * fica na sala (`/room`, WebSocket): quem está, quem já está pronto, chat, voz e o "começar".
//!
//! O código do convite (`CPM2.…`) é cifrado: o IP do anfitrião não aparece nele nem na tela.

use crate::commands::{emit_progress, err, with_ws, R};
use crate::AppState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path as UrlPath, Query, State as AxState};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use bytes::Bytes;
use cp_core::bigmatch::BigMatch;
use cp_core::library::ImportOptions;
use cp_core::manifest::{Manifest, MpPolicy};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};
use tokio::sync::{broadcast, oneshot};

/// Mods que cada launcher monta sozinho com os arquivos do próprio jogo: não vão pela sala.
const LOCAL_BUILT: &[&str] = &["cp-partida-grande", "cp-forja", cp_core::weather::MOD_ID, cp_core::weather::MODELS_ID];
const PREFIX: &str = "CPM2.";
const KEY: &[u8] = b"CommandProject sala de convite v2";
/// Perfil usado por quem entra na sala (os mods do anfitrião, sem mexer nos perfis da pessoa).
const GUEST_PROFILE: &str = "Partida com amigos";

// ---------------------------------------------------------------- código do convite

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Code {
    /// ip:porta do anfitrião
    a: String,
    /// senha da sala
    t: String,
    /// nome do anfitrião
    h: String,
}

/// Cifra simples (XOR com SHA-256 em contador) com um sal sorteado: o código não mostra o IP nem a
/// senha em texto. Quem tem o código entra na sala; é para isso que ele serve.
fn keystream(salt: &[u8], len: usize) -> Vec<u8> {
    let mut out = Vec::with_capacity(len + 32);
    let mut n = 0u32;
    while out.len() < len {
        let mut h = Sha256::new();
        h.update(KEY);
        h.update(salt);
        h.update(n.to_le_bytes());
        out.extend_from_slice(&h.finalize());
        n += 1;
    }
    out.truncate(len);
    out
}

fn encode_code(c: &Code) -> String {
    let body = serde_json::to_vec(c).unwrap_or_default();
    let salt: [u8; 8] = rand::random();
    let ks = keystream(&salt, body.len());
    let mut bytes = salt.to_vec();
    bytes.extend(body.iter().zip(ks).map(|(b, k)| b ^ k));
    format!("{PREFIX}{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

fn decode_code(code: &str) -> Result<Code, String> {
    let code: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    if code.contains("CPM1.") && !code.contains(PREFIX) {
        return Err("este convite é de uma versão antiga do launcher: peça um novo para quem convidou".into());
    }
    let at = code.find(PREFIX).ok_or("isso não é um convite do CommandProject (começa com CPM2.)")?;
    let body = code[at + PREFIX.len()..].trim_end_matches('=');
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(body).map_err(|_| "convite incompleto: copie o código inteiro")?;
    if bytes.len() < 9 {
        return Err("convite incompleto: copie o código inteiro".into());
    }
    let (salt, data) = bytes.split_at(8);
    let plain: Vec<u8> = data.iter().zip(keystream(salt, data.len())).map(|(b, k)| b ^ k).collect();
    serde_json::from_slice(&plain).map_err(|_| "convite inválido".into())
}

fn random_token() -> String {
    let b: [u8; 18] = rand::random();
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

// ---------------------------------------------------------------- servidor do anfitrião

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Member {
    id: u8,
    name: String,
    host: bool,
    ready: bool,
    /// 0 a 1: quanto dos mods já baixou
    progress: f32,
    /// microfone ligado (falando agora)
    talking: bool,
    muted: bool,
}

#[derive(Clone)]
enum Out {
    Text(String),
    Voice(u8, Bytes),
    Kick(u8),
}

struct Party {
    token: String,
    host_key: String,
    info: Value,
    /// id do mod → pasta do mod na biblioteca do anfitrião
    mods: HashMap<String, PathBuf>,
    capacity: usize,
    members: Mutex<Vec<Member>>,
    next_id: AtomicU8,
    started: AtomicBool,
    tx: broadcast::Sender<Out>,
}

impl Party {
    fn state(&self) -> String {
        let members = self.members.lock().unwrap_or_else(|p| p.into_inner()).clone();
        json!({ "type": "state", "members": members, "capacity": self.capacity, "started": self.started.load(Ordering::SeqCst) }).to_string()
    }
    fn broadcast_state(&self) {
        let _ = self.tx.send(Out::Text(self.state()));
    }
}

struct Running {
    party: Arc<Party>,
    stop: Option<oneshot::Sender<()>>,
    port: u16,
}

static RUNNING: Mutex<Option<Running>> = Mutex::new(None);
/// perfil ativo antes de entrar numa sala (volta ao sair)
static PREVIOUS_PROFILE: Mutex<Option<String>> = Mutex::new(None);

#[derive(Deserialize)]
struct Auth {
    t: Option<String>,
    k: Option<String>,
    name: Option<String>,
}

fn allowed(p: &Party, q: &Auth) -> bool {
    q.t.as_deref() == Some(p.token.as_str())
}

async fn info(AxState(p): AxState<Arc<Party>>, Query(q): Query<Auth>) -> Response {
    if !allowed(&p, &q) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let mut v = p.info.clone();
    v["members"] = json!(p.members.lock().unwrap_or_else(|e| e.into_inner()).len());
    v["started"] = json!(p.started.load(Ordering::SeqCst));
    Json(v).into_response()
}

async fn mod_manifest(AxState(p): AxState<Arc<Party>>, UrlPath(id): UrlPath<String>, Query(q): Query<Auth>) -> Response {
    if !allowed(&p, &q) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(dir) = p.mods.get(&id) else { return StatusCode::NOT_FOUND.into_response() };
    match tokio::fs::read(dir.join("mod.json")).await {
        Ok(b) => ([("content-type", "application/json")], b).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn mod_file(AxState(p): AxState<Arc<Party>>, UrlPath((id, name)): UrlPath<(String, String)>, Query(q): Query<Auth>) -> Response {
    if !allowed(&p, &q) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let Some(dir) = p.mods.get(&id) else { return StatusCode::NOT_FOUND.into_response() };
    if name.contains(['/', '\\']) || name.contains("..") {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let path = dir.join("files").join(&name);
    let Ok(file) = tokio::fs::File::open(&path).await else { return StatusCode::NOT_FOUND.into_response() };
    let len = file.metadata().await.map(|m| m.len()).unwrap_or(0);
    let body = axum::body::Body::from_stream(tokio_util::io::ReaderStream::with_capacity(file, 256 * 1024));
    ([("content-type", "application/octet-stream".to_string()), ("content-length", len.to_string())], body).into_response()
}

async fn room(AxState(p): AxState<Arc<Party>>, Query(q): Query<Auth>, ws: WebSocketUpgrade) -> Response {
    if !allowed(&p, &q) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let host = q.k.as_deref() == Some(p.host_key.as_str());
    let guests = p.members.lock().unwrap_or_else(|e| e.into_inner()).iter().filter(|m| !m.host).count();
    if !host && (guests >= p.capacity || p.started.load(Ordering::SeqCst)) {
        return (StatusCode::CONFLICT, if p.started.load(Ordering::SeqCst) { "a partida já começou" } else { "a sala está cheia" }).into_response();
    }
    let name: String = q.name.unwrap_or_default().trim().chars().take(24).collect();
    let name = if name.is_empty() { if host { "Anfitrião".into() } else { "Amigo".into() } } else { name };
    ws.max_message_size(256 * 1024).on_upgrade(move |socket| member(p, socket, name, host))
}

async fn member(p: Arc<Party>, socket: WebSocket, name: String, host: bool) {
    let id = p.next_id.fetch_add(1, Ordering::SeqCst);
    p.members.lock().unwrap_or_else(|e| e.into_inner()).push(Member { id, name: name.clone(), host, ready: host, progress: if host { 1.0 } else { 0.0 }, talking: false, muted: false });
    let mut rx = p.tx.subscribe();
    let (mut tx, mut inbox) = socket.split();
    let _ = tx.send(Message::Text(json!({ "type": "hello", "id": id, "host": host }).to_string().into())).await;
    p.broadcast_state();
    loop {
        tokio::select! {
            msg = inbox.next() => {
                let Some(Ok(msg)) = msg else { break };
                match msg {
                    Message::Text(t) => {
                        let Ok(v) = serde_json::from_str::<Value>(t.as_str()) else { continue };
                        match v["type"].as_str().unwrap_or("") {
                            "status" => {
                                {
                                    let mut ms = p.members.lock().unwrap_or_else(|e| e.into_inner());
                                    if let Some(m) = ms.iter_mut().find(|m| m.id == id) {
                                        if let Some(r) = v["ready"].as_bool() { m.ready = r; }
                                        if let Some(x) = v["progress"].as_f64() { m.progress = x.clamp(0.0, 1.0) as f32; }
                                        if let Some(x) = v["talking"].as_bool() { m.talking = x; }
                                        if let Some(x) = v["muted"].as_bool() { m.muted = x; }
                                    }
                                }
                                p.broadcast_state();
                            }
                            "chat" => {
                                let text: String = v["text"].as_str().unwrap_or("").trim().chars().take(300).collect();
                                if !text.is_empty() {
                                    let _ = p.tx.send(Out::Text(json!({ "type": "chat", "from": name, "id": id, "text": text }).to_string()));
                                }
                            }
                            "start" if host => {
                                p.started.store(true, Ordering::SeqCst);
                                let _ = p.tx.send(Out::Text(json!({ "type": "start" }).to_string()));
                                p.broadcast_state();
                            }
                            "kick" if host => {
                                if let Some(k) = v["id"].as_u64() { let _ = p.tx.send(Out::Kick(k as u8)); }
                            }
                            _ => {}
                        }
                    }
                    // voz: repassada aos outros com o número de quem fala na frente
                    Message::Binary(b) => {
                        if b.len() <= 8192 { let _ = p.tx.send(Out::Voice(id, b)); }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
            out = rx.recv() => {
                match out {
                    Ok(Out::Text(t)) => { if tx.send(Message::Text(t.into())).await.is_err() { break } }
                    Ok(Out::Voice(from, b)) if from != id => {
                        let mut frame = Vec::with_capacity(b.len() + 1);
                        frame.push(from);
                        frame.extend_from_slice(&b);
                        if tx.send(Message::Binary(frame.into())).await.is_err() { break }
                    }
                    Ok(Out::Kick(k)) if k == id && !host => {
                        let _ = tx.send(Message::Text(json!({ "type": "kicked" }).to_string().into())).await;
                        break;
                    }
                    Ok(_) => {}
                    // atrasado (voz demais na fila): pula o que passou
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(_) => break,
                }
            }
        }
    }
    p.members.lock().unwrap_or_else(|e| e.into_inner()).retain(|m| m.id != id);
    p.broadcast_state();
}

// ---------------------------------------------------------------- endereços deste PC

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Route {
    /// lan, radmin, zerotier, hamachi, vpn ou internet
    kind: String,
    label: String,
    ip: String,
}

fn routes() -> Vec<Route> {
    let mut out: Vec<Route> = Vec::new();
    for i in if_addrs::get_if_addrs().unwrap_or_default() {
        let std::net::IpAddr::V4(ip) = i.ip() else { continue };
        if ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() {
            continue;
        }
        let name = i.name.to_ascii_lowercase();
        let o = ip.octets();
        let (kind, label) = if name.contains("radmin") || o[0] == 26 {
            ("radmin", "Radmin VPN")
        } else if name.contains("zerotier") || name.starts_with("zt") {
            ("zerotier", "ZeroTier")
        } else if name.contains("hamachi") || o[0] == 25 {
            ("hamachi", "Hamachi")
        } else if name.contains("tailscale") || (o[0] == 100 && (64..128).contains(&o[1])) {
            ("tailscale", "Tailscale")
        } else if ip.is_private() {
            ("lan", "Mesma rede (casa ou LAN)")
        } else {
            ("vpn", "Outra rede")
        };
        if !out.iter().any(|r| r.ip == ip.to_string()) {
            out.push(Route { kind: kind.into(), label: label.into(), ip: ip.to_string() });
        }
    }
    // VPN primeiro (é o jeito mais comum de jogar com amigos), depois a rede de casa
    out.sort_by_key(|r| match r.kind.as_str() { "radmin" | "zerotier" | "hamachi" | "tailscale" => 0, "lan" => 1, _ => 2 });
    out
}

/// Caminhos de rede deste PC para os amigos (o IP só aparece no "avançado" de quem convida).
#[tauri::command]
pub fn party_routes() -> Vec<Route> {
    routes()
}

/// IP público (pela internet, com a porta aberta no roteador).
#[tauri::command]
pub async fn party_public_ip() -> R<String> {
    let ip = reqwest::get("https://api.ipify.org").await.map_err(err)?.text().await.map_err(err)?;
    let ip = ip.trim().to_string();
    if ip.parse::<std::net::Ipv4Addr>().is_err() {
        return Err("não deu para descobrir o IP público".into());
    }
    Ok(ip)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hosted {
    code: String,
    /// endereço da sala para o próprio launcher do anfitrião (127.0.0.1)
    room: String,
    port: u16,
    /// mods que vão pela sala
    mods: Vec<(String, String)>,
}

/// Abre (ou reabre) a sala: o servidor do anfitrião na porta escolhida.
#[tauri::command]
pub async fn party_host(state: State<'_, AppState>, spec: BigMatch, name: String, ip: String, port: u16) -> R<Hosted> {
    let mut game = spec.clone();
    game.net = None;
    cp_core::bigmatch::launch_args(&game).map_err(err)?;
    let capacity = spec.slots.iter().filter(|s| s.kind == cp_core::bigmatch::SlotKind::Guest).count();
    if capacity == 0 {
        return Err(err("marque pelo menos uma vaga como Amigo para convidar alguém"));
    }
    let (mods, list) = with_ws(&state.ws, |ws| {
        let active = ws.profiles.active().clone();
        let mut mods = HashMap::new();
        let mut list = Vec::new();
        let installed = ws.mods()?;
        // na ordem de carga do perfil
        for pm in active.mods.iter().filter(|m| m.enabled) {
            let Some(m) = installed.iter().find(|m| m.manifest.id == pm.id) else { continue };
            if LOCAL_BUILT.contains(&m.manifest.id.as_str()) || m.manifest.multiplayer == MpPolicy::Local {
                continue;
            }
            mods.insert(m.manifest.id.clone(), m.dir.clone());
            list.push(json!({ "id": m.manifest.id, "name": m.manifest.name, "version": m.manifest.version, "files": m.manifest.files }));
        }
        Ok((mods, list))
    })
    .await?;
    let names: Vec<(String, String)> = list.iter().map(|m| (m["id"].as_str().unwrap_or("").to_string(), m["name"].as_str().unwrap_or("").to_string())).collect();
    let host = if name.trim().is_empty() { "Anfitrião".to_string() } else { name.trim().chars().take(24).collect() };
    let (tx, _) = broadcast::channel(1024);
    let party = Arc::new(Party {
        token: random_token(),
        host_key: random_token(),
        info: json!({ "host": host, "game": game, "mods": list, "capacity": capacity, "port": port, "launcher": env!("CARGO_PKG_VERSION") }),
        mods,
        capacity,
        members: Mutex::new(Vec::new()),
        next_id: AtomicU8::new(1),
        started: AtomicBool::new(false),
        tx,
    });
    party_stop_inner();
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port))
        .await
        .map_err(|e| format!("não deu para abrir a sala na porta {port}: {e}. Feche outro programa que use a porta ou escolha outra"))?;
    let app = Router::new()
        .route("/info", get(info))
        .route("/mod/{id}/manifest", get(mod_manifest))
        .route("/mod/{id}/file/{name}", get(mod_file))
        .route("/room", get(room))
        .with_state(party.clone());
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, app).with_graceful_shutdown(async { let _ = stop_rx.await; }).await;
    });
    let code = encode_code(&Code { a: format!("{}:{port}", ip.trim()), t: party.token.clone(), h: host.clone() });
    let room = format!("ws://127.0.0.1:{port}/room?t={}&k={}&name={}", party.token, party.host_key, urlenc(&host));
    *RUNNING.lock().unwrap_or_else(|e| e.into_inner()) = Some(Running { party, stop: Some(stop_tx), port });
    Ok(Hosted { code, room, port, mods: names })
}

fn party_stop_inner() {
    if let Some(mut r) = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).take() {
        if let Some(s) = r.stop.take() {
            let _ = s.send(());
        }
        let _ = r.port;
        let _ = r.party.tx.send(Out::Text(json!({ "type": "closed" }).to_string()));
    }
}

/// Fecha a sala do anfitrião.
#[tauri::command]
pub fn party_stop() {
    party_stop_inner();
}

fn urlenc(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

// ---------------------------------------------------------------- quem entra

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PartyMod {
    id: String,
    name: String,
    version: String,
    /// ok (igual), download (não tem), update (tem diferente)
    status: String,
    size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Joined {
    host: String,
    game: BigMatch,
    mods: Vec<PartyMod>,
    /// bytes a baixar
    download: u64,
    capacity: usize,
    members: usize,
    started: bool,
    /// endereço da sala (usado pelo launcher, nunca mostrado)
    room: String,
    /// endereço da partida para o jogo (idem)
    address: String,
}

fn base_url(c: &Code) -> String {
    format!("http://{}", c.a)
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(6)).build().unwrap_or_default()
}

/// Lê um convite: entra em contato com a sala do anfitrião e confere os mods com os daqui.
#[tauri::command]
pub async fn party_read(state: State<'_, AppState>, code: String, name: String) -> R<Joined> {
    let c = decode_code(&code)?;
    let res = client()
        .get(format!("{}/info?t={}", base_url(&c), urlenc(&c.t)))
        .send()
        .await
        .map_err(|_| format!("não deu para falar com a sala de {}: ela pode ter fechado, ou vocês não estão na mesma rede/VPN (ou a porta não está aberta no roteador dele)", c.h))?;
    if res.status() == reqwest::StatusCode::FORBIDDEN {
        return Err("este convite não vale mais: peça um novo para quem convidou".into());
    }
    let info: Value = res.error_for_status().map_err(err)?.json().await.map_err(err)?;
    let game: BigMatch = serde_json::from_value(info["game"].clone()).map_err(err)?;
    let host_mods: Vec<Value> = info["mods"].as_array().cloned().unwrap_or_default();
    let mine = with_ws(&state.ws, |ws| ws.mods()).await?;
    let mut mods = Vec::new();
    let mut download = 0;
    for m in host_mods {
        let id = m["id"].as_str().unwrap_or("").to_string();
        let files: Vec<cp_core::manifest::ModFile> = serde_json::from_value(m["files"].clone()).unwrap_or_default();
        let size: u64 = files.iter().map(|f| f.size).sum();
        let have = mine.iter().find(|x| x.manifest.id == id);
        let same = have.is_some_and(|x| {
            x.manifest.files.len() == files.len()
                && files.iter().all(|f| x.manifest.files.iter().any(|y| y.name.eq_ignore_ascii_case(&f.name) && y.sha256.eq_ignore_ascii_case(&f.sha256)))
        });
        let status = if same { "ok" } else if have.is_some() { "update" } else { "download" };
        if !same {
            download += size;
        }
        mods.push(PartyMod { id, name: m["name"].as_str().unwrap_or("").into(), version: m["version"].as_str().unwrap_or("").into(), status: status.into(), size });
    }
    let port: u16 = info["port"].as_u64().unwrap_or(15000) as u16;
    let ip = c.a.rsplit_once(':').map(|(ip, _)| ip.to_string()).unwrap_or_default();
    Ok(Joined {
        host: info["host"].as_str().unwrap_or(&c.h).to_string(),
        game,
        mods,
        download,
        capacity: info["capacity"].as_u64().unwrap_or(0) as usize,
        members: info["members"].as_u64().unwrap_or(0) as usize,
        started: info["started"].as_bool().unwrap_or(false),
        room: format!("ws://{}/room?t={}&name={}", c.a, c.t, urlenc(name.trim())),
        address: format!("{ip}:{port}"),
    })
}

/// Baixa da sala os mods que faltam (com progresso "party"), instala e monta o perfil "Partida com
/// amigos" com exatamente os mods do anfitrião (mais os visuais daqui), que fica ativo até sair.
#[tauri::command]
pub async fn party_prepare(app: AppHandle, state: State<'_, AppState>, code: String, mods: Vec<PartyMod>) -> R<()> {
    let c = decode_code(&code)?;
    let base = base_url(&c);
    let http = client();
    let stage_root = with_ws(&state.ws, |ws| Ok(ws.data_dir.join("cache").join("party"))).await?;
    let _ = tokio::fs::remove_dir_all(&stage_root).await;
    let total: u64 = mods.iter().filter(|m| m.status != "ok").map(|m| m.size).sum::<u64>().max(1);
    let mut done: u64 = 0;
    for m in mods.iter().filter(|m| m.status != "ok") {
        let stage = stage_root.join(&m.id);
        tokio::fs::create_dir_all(&stage).await.map_err(err)?;
        let manifest: Manifest = http
            .get(format!("{base}/mod/{}/manifest?t={}", urlenc(&m.id), urlenc(&c.t)))
            .send()
            .await
            .map_err(err)?
            .error_for_status()
            .map_err(err)?
            .json()
            .await
            .map_err(err)?;
        for f in &manifest.files {
            if f.name.contains(['/', '\\']) || f.name.contains("..") {
                return Err(format!("{}: nome de arquivo inválido", m.name));
            }
            let res = http
                .get(format!("{base}/mod/{}/file/{}?t={}", urlenc(&m.id), urlenc(&f.name), urlenc(&c.t)))
                .send()
                .await
                .map_err(err)?
                .error_for_status()
                .map_err(err)?;
            let path = stage.join(&f.name);
            let mut out = tokio::fs::File::create(&path).await.map_err(err)?;
            let mut last = std::time::Instant::now();
            use tokio::io::AsyncWriteExt;
            let mut stream = res.bytes_stream();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(err)?;
                out.write_all(&chunk).await.map_err(err)?;
                done += chunk.len() as u64;
                if last.elapsed().as_millis() > 200 {
                    last = std::time::Instant::now();
                    emit_progress(&app, "party", (done * 1000 / total) as usize, 1000, format!("Baixando {} do PC de {}…", m.name, c.h));
                }
            }
            out.flush().await.map_err(err)?;
        }
        tokio::fs::write(stage.join("mod.json"), serde_json::to_vec_pretty(&manifest).map_err(err)?).await.map_err(err)?;
        let id = m.id.clone();
        let name = m.name.clone();
        let dir = stage.clone();
        emit_progress(&app, "party", (done * 1000 / total) as usize, 1000, format!("Instalando {name}…"));
        with_ws(&state.ws, move |ws| {
            // o hash de cada arquivo é conferido com o mod.json do anfitrião na importação
            ws.import_mod(&dir, &ImportOptions { id: Some(id), replace: true, ..Default::default() }, false).map(|_| ())
        })
        .await?;
    }
    let order: Vec<String> = mods.iter().map(|m| m.id.clone()).collect();
    with_ws(&state.ws, move |ws| {
        let current = ws.profiles.active().clone();
        // os visuais daqui continuam (texturas, interface): não mudam a partida
        let installed = ws.mods()?;
        let mut list: Vec<cp_core::profile::ProfileMod> = order.iter().map(|id| cp_core::profile::ProfileMod { id: id.clone(), enabled: true }).collect();
        for pm in current.mods.iter().filter(|m| m.enabled) {
            let local = installed.iter().any(|x| x.manifest.id == pm.id && x.manifest.multiplayer == MpPolicy::Local);
            if local && !order.contains(&pm.id) {
                list.push(pm.clone());
            }
        }
        let id = match ws.profiles.set.profiles.iter().find(|p| p.name == GUEST_PROFILE) {
            Some(p) => p.id.clone(),
            None => ws.profiles.create(GUEST_PROFILE, None)?.id,
        };
        if current.id != id {
            *PREVIOUS_PROFILE.lock().unwrap_or_else(|e| e.into_inner()) = Some(current.id.clone());
        }
        ws.profiles.replace_mods(&id, list)?;
        ws.profiles.set_active(&id)
    })
    .await?;
    let _ = tokio::fs::remove_dir_all(&stage_root).await;
    emit_progress(&app, "party", 1000, 1000, "Pronto");
    Ok(())
}

/// Sai da sala: volta ao perfil de antes.
#[tauri::command]
pub async fn party_leave(state: State<'_, AppState>) -> R<()> {
    let prev = PREVIOUS_PROFILE.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(prev) = prev {
        with_ws(&state.ws, move |ws| ws.profiles.set_active(&prev)).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invite_code_hides_the_address() {
        let c = Code { a: "26.11.22.33:15000".into(), t: "segredo".into(), h: "Ana".into() };
        let code = encode_code(&c);
        assert!(code.starts_with(PREFIX));
        assert!(!code.contains("26.11") && !code.contains("segredo"));
        // o texto em base64 também não mostra nada
        let raw = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&code[PREFIX.len()..]).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("26.11"));
        // dois convites da mesma sala saem diferentes (sal sorteado)
        assert_ne!(code, encode_code(&c));
        let back = decode_code(&format!("entra aí: {}\n", code)).unwrap();
        assert_eq!((back.a, back.t, back.h), (c.a, c.t, c.h));
        assert!(decode_code("CPM1.abc").unwrap_err().contains("versão antiga"));
        assert!(decode_code("CPM2.abc").is_err() && decode_code("oi").is_err());
    }

    /// Sala de demonstração para ver a tela (CP_PARTY_DEMO=porta): senha "tk", chave do anfitrião "hk".
    #[tokio::test(flavor = "multi_thread")]
    async fn demo_room() {
        let Ok(port) = std::env::var("CP_PARTY_DEMO") else { return };
        let (tx, _) = broadcast::channel(256);
        let p = Arc::new(Party { token: "tk".into(), host_key: "hk".into(), info: json!({}), mods: HashMap::new(), capacity: 3, members: Mutex::new(Vec::new()), next_id: AtomicU8::new(1), started: AtomicBool::new(false), tx });
        let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.unwrap();
        let app = Router::new().route("/room", get(room)).with_state(p);
        let _ = tokio::time::timeout(std::time::Duration::from_secs(120), axum::serve(listener, app)).await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn room_relays_state_chat_voice_and_start() {
        use tokio_tungstenite::tungstenite::Message as M;
        let (tx, _) = broadcast::channel(64);
        let p = Arc::new(Party {
            token: "tk".into(),
            host_key: "hk".into(),
            info: json!({ "host": "Ana", "mods": [] }),
            mods: HashMap::new(),
            capacity: 1,
            members: Mutex::new(Vec::new()),
            next_id: AtomicU8::new(1),
            started: AtomicBool::new(false),
            tx,
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let app = Router::new().route("/info", get(info)).route("/room", get(room)).with_state(p.clone());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        // sem a senha, nada
        let r = reqwest::get(format!("http://127.0.0.1:{port}/info")).await.unwrap();
        assert_eq!(r.status(), 403);
        let r: Value = reqwest::get(format!("http://127.0.0.1:{port}/info?t=tk")).await.unwrap().json().await.unwrap();
        assert_eq!(r["host"], "Ana");
        let (mut host, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/room?t=tk&k=hk&name=Ana")).await.unwrap();
        let (mut guest, _) = tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/room?t=tk&name=Bia")).await.unwrap();
        // sala cheia (1 vaga)
        assert!(tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{port}/room?t=tk&name=Caio")).await.is_err());
        async fn until(ws: &mut (impl StreamExt<Item = Result<M, tokio_tungstenite::tungstenite::Error>> + Unpin), f: impl Fn(&M) -> bool) -> M {
            loop {
                let m = tokio::time::timeout(std::time::Duration::from_secs(5), ws.next()).await.unwrap().unwrap().unwrap();
                if f(&m) {
                    return m;
                }
            }
        }
        let txt = |m: &M| if let M::Text(t) = m { t.to_string() } else { String::new() };
        until(&mut host, |m| txt(m).contains("Bia")).await;
        guest.send(M::Text(r#"{"type":"status","ready":true,"progress":1}"#.into())).await.unwrap();
        until(&mut host, |m| txt(m).contains(r#""ready":true,"progress":1.0,"talking":false,"muted":false},{"#) || txt(m).matches(r#""ready":true"#).count() == 2).await;
        guest.send(M::Text(r#"{"type":"chat","text":"oi"}"#.into())).await.unwrap();
        until(&mut host, |m| txt(m).contains(r#""type":"chat""#) && txt(m).contains("oi")).await;
        // voz: chega aos outros com o número de quem fala
        guest.send(M::Binary(vec![9, 9, 9].into())).await.unwrap();
        let v = until(&mut host, |m| matches!(m, M::Binary(_))).await;
        if let M::Binary(b) = v {
            assert_eq!(&b[1..], &[9, 9, 9]);
        }
        // só o anfitrião começa
        guest.send(M::Text(r#"{"type":"start"}"#.into())).await.unwrap();
        host.send(M::Text(r#"{"type":"start"}"#.into())).await.unwrap();
        until(&mut guest, |m| txt(m).contains(r#""type":"start""#)).await;
        assert!(p.started.load(Ordering::SeqCst));
    }
}
