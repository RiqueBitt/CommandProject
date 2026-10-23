//! Servidor da comunidade do CommandProject.
//!
//! Um único binário que entrega:
//! * **Hub de mods** — `GET /hub/index.json` gerado de uma pasta (`hubbuild`) e os pacotes em `/hub/...`;
//! * **Salas** — quem vai hospedar uma partida anuncia a sala com o código do perfil (`CP1-…`) e a
//!   assinatura da pasta; quem entra copia o perfil e confere a assinatura antes do lobby da Steam;
//! * **Chat** — WebSocket com canal geral e um canal por sala.
//!
//! Tudo fica em memória (salas expiram sem heartbeat). Não há contas: só apelidos.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use cp_core::hub::HubIndex;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{broadcast, Mutex, RwLock};

pub const ROOM_TTL: Duration = Duration::from_secs(120);
const MAX_ROOMS: usize = 300;
const MAX_ROOMS_PER_IP: usize = 3;
const MAX_WS_PER_IP: usize = 6;
const HISTORY: usize = 60;
const MAX_TEXT: usize = 500;
const RATE_MSGS: usize = 6;
const RATE_WINDOW: Duration = Duration::from_secs(10);

#[derive(Clone, Debug)]
pub struct Config {
    pub name: String,
    pub motd: String,
    /// Pasta do hub (`hub.json`, `mods/<id>/<versão>/…`). `None` = servidor sem hub.
    pub hub_dir: Option<PathBuf>,
    /// Pasta para arquivos internos (cache de hash).
    pub data_dir: PathBuf,
    /// Confiar no cabeçalho `X-Forwarded-For` (quando atrás de um proxy/hospedagem).
    pub trust_proxy: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub id: String,
    pub name: String,
    pub host: String,
    pub players: Vec<String>,
    pub max_players: u8,
    pub private: bool,
    pub status: String,
    /// Nomes dos mods do perfil (lidos do código, para a lista).
    pub mods: Vec<String>,
    pub fingerprint: Option<String>,
    pub created_at: String,
    /// Só aparece para quem entrou (ou se a sala for pública).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_code: Option<String>,
    #[serde(skip)]
    code: String,
    #[serde(skip)]
    password: Option<String>,
    #[serde(skip)]
    token: String,
    #[serde(skip)]
    owner_ip: IpAddr,
    #[serde(skip)]
    last_seen: Instant,
}

impl Room {
    fn public_view(&self) -> Room {
        let mut r = self.clone();
        r.sync_code = if self.private { None } else { Some(self.code.clone()) };
        r
    }
    fn full_view(&self) -> Room {
        let mut r = self.clone();
        r.sync_code = Some(self.code.clone());
        r
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMsg {
    pub nick: String,
    pub text: String,
    pub at: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ServerEvent {
    History {
        channel: String,
        messages: Vec<ChatMsg>,
    },
    Msg {
        channel: String,
        #[serde(flatten)]
        msg: ChatMsg,
    },
    Presence {
        channel: String,
        users: Vec<String>,
    },
    Error {
        message: String,
    },
}

struct Channel {
    tx: broadcast::Sender<ServerEvent>,
    history: VecDeque<ChatMsg>,
    members: HashMap<u64, String>,
}

impl Channel {
    fn new() -> Self {
        Channel {
            tx: broadcast::channel(128).0,
            history: VecDeque::new(),
            members: HashMap::new(),
        }
    }
    fn users(&self) -> Vec<String> {
        let mut u: Vec<String> = self.members.values().cloned().collect();
        u.sort_by_key(|s| s.to_lowercase());
        u.dedup();
        u
    }
}

pub struct AppState {
    pub cfg: Config,
    rooms: Mutex<HashMap<String, Room>>,
    channels: Mutex<HashMap<String, Channel>>,
    ws_per_ip: Mutex<HashMap<IpAddr, usize>>,
    hub: RwLock<Option<HubIndex>>,
    next_conn: std::sync::atomic::AtomicU64,
}

impl AppState {
    pub fn new(cfg: Config) -> Arc<Self> {
        Arc::new(AppState {
            cfg,
            rooms: Mutex::new(HashMap::new()),
            channels: Mutex::new(HashMap::new()),
            ws_per_ip: Mutex::new(HashMap::new()),
            hub: RwLock::new(None),
            next_conn: 0.into(),
        })
    }

    /// Regera o índice do hub a partir da pasta (chamado na partida e periodicamente).
    pub async fn rebuild_hub(&self) -> Option<Vec<String>> {
        let dir = self.cfg.hub_dir.clone()?;
        let cache_path = self.cfg.data_dir.join("hub-hashcache.json");
        let res = tokio::task::spawn_blocking(move || {
            let mut cache = cp_core::hashcache::HashCache::load(&cache_path);
            cp_core::hubbuild::build_index(&dir, Some(&mut cache))
        })
        .await
        .ok()?;
        match res {
            Ok((idx, warnings)) => {
                *self.hub.write().await = Some(idx);
                Some(warnings)
            }
            Err(e) => Some(vec![format!("hub: {e}")]),
        }
    }

    /// Remove salas sem heartbeat.
    pub async fn sweep(&self) -> usize {
        let mut rooms = self.rooms.lock().await;
        let before = rooms.len();
        rooms.retain(|_, r| r.last_seen.elapsed() < ROOM_TTL);
        let removed = before - rooms.len();
        if removed > 0 {
            let alive: Vec<String> = rooms.keys().cloned().collect();
            drop(rooms);
            let mut ch = self.channels.lock().await;
            ch.retain(|k, c| k == "global" || alive.contains(k) || !c.members.is_empty());
        }
        removed
    }
}

// --------------------------------------------------------------------------- validação

fn valid_nick(n: &str) -> Option<String> {
    let n = n.trim();
    let ok = (2..=20).contains(&n.chars().count())
        && n.chars()
            .all(|c| c.is_alphanumeric() || matches!(c, ' ' | '_' | '-' | '.' | '[' | ']'));
    ok.then(|| n.to_string())
}

fn clean_text(t: &str, max: usize) -> String {
    t.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(max)
        .collect::<String>()
        .trim()
        .to_string()
}

fn random_id(len: usize) -> String {
    // sem caracteres ambíguos (0/O, 1/I)
    const ABC: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    (0..len)
        .map(|_| ABC[(rand::random::<u32>() as usize) % ABC.len()] as char)
        .collect()
}

fn token() -> String {
    format!("{:016x}{:016x}", rand::random::<u64>(), rand::random::<u64>())
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub struct ApiError(StatusCode, String);

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.0, Json(serde_json::json!({ "error": self.1 }))).into_response()
    }
}

fn bad(msg: impl Into<String>) -> ApiError {
    ApiError(StatusCode::BAD_REQUEST, msg.into())
}

fn client_ip(state: &AppState, headers: &HeaderMap, addr: SocketAddr) -> IpAddr {
    if state.cfg.trust_proxy {
        if let Some(ip) = headers
            .get("x-forwarded-for")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(',').next())
            .and_then(|v| v.trim().parse().ok())
        {
            return ip;
        }
    }
    addr.ip()
}

// --------------------------------------------------------------------------- rotas

pub fn router(state: Arc<AppState>) -> Router {
    let mut r = Router::new()
        .route("/api/info", get(info))
        .route("/api/rooms", get(list_rooms).post(create_room))
        .route("/api/rooms/{id}", axum::routing::delete(delete_room).patch(update_room))
        .route("/api/rooms/{id}/join", post(join_room))
        .route("/api/rooms/{id}/leave", post(leave_room))
        .route("/api/rooms/{id}/heartbeat", post(heartbeat))
        .route("/ws", get(ws_upgrade))
        .route("/hub/index.json", get(hub_index));
    if let Some(dir) = &state.cfg.hub_dir {
        r = r.nest_service("/hub", tower_http::services::ServeDir::new(dir));
    }
    r.layer(tower_http::limit::RequestBodyLimitLayer::new(64 * 1024))
        .layer(tower_http::cors::CorsLayer::permissive())
        .with_state(state)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    name: String,
    motd: String,
    version: String,
    rooms: usize,
    online: usize,
    hub: bool,
}

async fn info(State(s): State<Arc<AppState>>) -> Json<Info> {
    let rooms = s.rooms.lock().await.len();
    let online = s
        .channels
        .lock()
        .await
        .get("global")
        .map(|c| c.users().len())
        .unwrap_or(0);
    Json(Info {
        name: s.cfg.name.clone(),
        motd: s.cfg.motd.clone(),
        version: env!("CARGO_PKG_VERSION").into(),
        rooms,
        online,
        hub: s.hub.read().await.is_some(),
    })
}

async fn hub_index(State(s): State<Arc<AppState>>) -> Result<Json<HubIndex>, ApiError> {
    s.hub
        .read()
        .await
        .clone()
        .map(Json)
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "este servidor não publica um hub de mods".into()))
}

async fn list_rooms(State(s): State<Arc<AppState>>) -> Json<Vec<Room>> {
    let rooms = s.rooms.lock().await;
    let mut v: Vec<Room> = rooms.values().map(Room::public_view).collect();
    v.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Json(v)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateRoom {
    name: String,
    nick: String,
    sync_code: String,
    fingerprint: Option<String>,
    max_players: Option<u8>,
    password: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Created {
    room: Room,
    token: String,
}

async fn create_room(
    State(s): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(req): Json<CreateRoom>,
) -> Result<Json<Created>, ApiError> {
    let ip = client_ip(&s, &headers, addr);
    let nick = valid_nick(&req.nick).ok_or_else(|| bad("apelido inválido (2 a 20 letras/números)"))?;
    let name = clean_text(&req.name, 40);
    if name.chars().count() < 3 {
        return Err(bad("dê um nome à sala (mínimo 3 letras)"));
    }
    let payload = cp_core::sync::decode(&req.sync_code).map_err(|e| bad(e.to_string()))?;
    let fingerprint = match req
        .fingerprint
        .map(|f| f.trim().to_uppercase())
        .filter(|f| !f.is_empty())
    {
        Some(f) if f.len() == 14 && f.chars().all(|c| c.is_ascii_hexdigit() || c == '-') => Some(f),
        Some(_) => return Err(bad("assinatura inválida")),
        None => None,
    };
    let max_players = req.max_players.unwrap_or(4).clamp(2, 8);
    let password = req.password.map(|p| p.trim().to_string()).filter(|p| !p.is_empty());
    if password.as_ref().is_some_and(|p| p.len() > 64) {
        return Err(bad("senha longa demais"));
    }
    let mut rooms = s.rooms.lock().await;
    if rooms.len() >= MAX_ROOMS {
        return Err(ApiError(
            StatusCode::SERVICE_UNAVAILABLE,
            "servidor cheio, tente mais tarde".into(),
        ));
    }
    if rooms.values().filter(|r| r.owner_ip == ip).count() >= MAX_ROOMS_PER_IP {
        return Err(ApiError(
            StatusCode::TOO_MANY_REQUESTS,
            "você já tem salas abertas demais".into(),
        ));
    }
    let mut id = random_id(6);
    while rooms.contains_key(&id) {
        id = random_id(6);
    }
    let tok = token();
    let room = Room {
        id: id.clone(),
        name,
        host: nick.clone(),
        players: vec![nick],
        max_players,
        private: password.is_some(),
        status: "aguardando".into(),
        mods: payload
            .mods
            .iter()
            .map(|m| format!("{} {}", m.name, m.version))
            .collect(),
        fingerprint,
        created_at: now(),
        sync_code: None,
        code: req.sync_code.trim().to_string(),
        password,
        token: tok.clone(),
        owner_ip: ip,
        last_seen: Instant::now(),
    };
    rooms.insert(id, room.clone());
    Ok(Json(Created {
        room: room.full_view(),
        token: tok,
    }))
}

fn bearer(headers: &HeaderMap) -> Option<&str> {
    headers.get("authorization")?.to_str().ok()?.strip_prefix("Bearer ")
}

async fn with_owned_room<T>(
    s: &AppState,
    id: &str,
    headers: &HeaderMap,
    f: impl FnOnce(&mut HashMap<String, Room>, &str) -> T,
) -> Result<T, ApiError> {
    let mut rooms = s.rooms.lock().await;
    let r = rooms
        .get(id)
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "a sala não existe mais".into()))?;
    if bearer(headers) != Some(r.token.as_str()) {
        return Err(ApiError(
            StatusCode::FORBIDDEN,
            "só quem criou a sala pode fazer isso".into(),
        ));
    }
    Ok(f(&mut rooms, id))
}

async fn heartbeat(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Room>, ApiError> {
    with_owned_room(&s, &id, &headers, |rooms, id| {
        let r = rooms.get_mut(id).unwrap();
        r.last_seen = Instant::now();
        r.full_view()
    })
    .await
    .map(Json)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRoom {
    status: Option<String>,
    sync_code: Option<String>,
    fingerprint: Option<String>,
}

async fn update_room(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
    Json(req): Json<UpdateRoom>,
) -> Result<Json<Room>, ApiError> {
    if let Some(code) = &req.sync_code {
        cp_core::sync::decode(code).map_err(|e| bad(e.to_string()))?;
    }
    with_owned_room(&s, &id, &headers, |rooms, id| {
        let r = rooms.get_mut(id).unwrap();
        if let Some(st) = req.status.filter(|s| s == "aguardando" || s == "em partida") {
            r.status = st;
        }
        if let Some(code) = req.sync_code {
            if let Ok(p) = cp_core::sync::decode(&code) {
                r.mods = p.mods.iter().map(|m| format!("{} {}", m.name, m.version)).collect();
            }
            r.code = code;
        }
        if let Some(f) = req.fingerprint {
            r.fingerprint = Some(f.trim().to_uppercase()).filter(|f| f.len() == 14);
        }
        r.last_seen = Instant::now();
        r.full_view()
    })
    .await
    .map(Json)
}

async fn delete_room(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    with_owned_room(&s, &id, &headers, |rooms, id| {
        rooms.remove(id);
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct JoinReq {
    nick: String,
    password: Option<String>,
}

async fn join_room(
    State(s): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<JoinReq>,
) -> Result<Json<Room>, ApiError> {
    let nick = valid_nick(&req.nick).ok_or_else(|| bad("apelido inválido"))?;
    let mut rooms = s.rooms.lock().await;
    let r = rooms
        .get_mut(&id)
        .ok_or_else(|| ApiError(StatusCode::NOT_FOUND, "a sala não existe mais".into()))?;
    if let Some(pw) = &r.password {
        if req.password.as_deref().map(str::trim) != Some(pw.as_str()) {
            return Err(ApiError(StatusCode::FORBIDDEN, "senha incorreta".into()));
        }
    }
    let already = r.players.iter().any(|p| p.eq_ignore_ascii_case(&nick));
    if !already {
        if r.players.len() >= r.max_players as usize {
            return Err(ApiError(StatusCode::CONFLICT, "a sala está cheia".into()));
        }
        r.players.push(nick);
    }
    Ok(Json(r.full_view()))
}

async fn leave_room(State(s): State<Arc<AppState>>, Path(id): Path<String>, Json(req): Json<JoinReq>) -> StatusCode {
    let mut rooms = s.rooms.lock().await;
    if let Some(r) = rooms.get_mut(&id) {
        if !r.host.eq_ignore_ascii_case(req.nick.trim()) {
            r.players.retain(|p| !p.eq_ignore_ascii_case(req.nick.trim()));
        }
    }
    StatusCode::NO_CONTENT
}

// --------------------------------------------------------------------------- chat

#[derive(Deserialize)]
struct WsQuery {
    nick: String,
    channel: Option<String>,
}

#[derive(Deserialize)]
struct ClientMsg {
    text: String,
}

async fn ws_upgrade(
    State(s): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(q): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let nick = valid_nick(&q.nick).ok_or_else(|| bad("apelido inválido"))?;
    let channel = q.channel.unwrap_or_else(|| "global".into());
    if channel != "global" && !s.rooms.lock().await.contains_key(&channel) {
        return Err(ApiError(StatusCode::NOT_FOUND, "sala não encontrada".into()));
    }
    let ip = client_ip(&s, &headers, addr);
    {
        let mut per = s.ws_per_ip.lock().await;
        let n = per.entry(ip).or_default();
        if *n >= MAX_WS_PER_IP {
            return Err(ApiError(
                StatusCode::TOO_MANY_REQUESTS,
                "conexões demais deste endereço".into(),
            ));
        }
        *n += 1;
    }
    Ok(ws.max_message_size(4 * 1024).on_upgrade(move |socket| async move {
        chat_session(s.clone(), socket, nick, channel).await;
        let mut per = s.ws_per_ip.lock().await;
        if let Some(n) = per.get_mut(&ip) {
            *n = n.saturating_sub(1);
            if *n == 0 {
                per.remove(&ip);
            }
        }
    }))
}

async fn send_event(sink: &mut futures_util::stream::SplitSink<WebSocket, Message>, ev: &ServerEvent) -> bool {
    match serde_json::to_string(ev) {
        Ok(t) => sink.send(Message::Text(t.into())).await.is_ok(),
        Err(_) => true,
    }
}

async fn chat_session(s: Arc<AppState>, socket: WebSocket, nick: String, channel: String) {
    let conn = s.next_conn.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (mut sink, mut stream) = socket.split();
    let (mut rx, history, presence_tx) = {
        let mut chans = s.channels.lock().await;
        let ch = chans.entry(channel.clone()).or_insert_with(Channel::new);
        ch.members.insert(conn, nick.clone());
        let users = ch.users();
        let _ = ch.tx.send(ServerEvent::Presence {
            channel: channel.clone(),
            users,
        });
        (
            ch.tx.subscribe(),
            ch.history.iter().cloned().collect::<Vec<_>>(),
            ch.tx.clone(),
        )
    };
    if !send_event(
        &mut sink,
        &ServerEvent::History {
            channel: channel.clone(),
            messages: history,
        },
    )
    .await
    {
        return;
    }
    let mut sent: VecDeque<Instant> = VecDeque::new();
    loop {
        tokio::select! {
            ev = rx.recv() => match ev {
                Ok(ev) => if !send_event(&mut sink, &ev).await { break },
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => break,
            },
            incoming = stream.next() => {
                let Some(Ok(msg)) = incoming else { break };
                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                let Ok(cm) = serde_json::from_str::<ClientMsg>(&text) else { continue };
                let body = clean_text(&cm.text, MAX_TEXT);
                if body.is_empty() { continue }
                while sent.front().is_some_and(|t| t.elapsed() > RATE_WINDOW) { sent.pop_front(); }
                if sent.len() >= RATE_MSGS {
                    let warn = ServerEvent::Error { message: "devagar: muitas mensagens seguidas".into() };
                    if !send_event(&mut sink, &warn).await { break }
                    continue;
                }
                sent.push_back(Instant::now());
                let m = ChatMsg { nick: nick.clone(), text: body, at: now() };
                let mut chans = s.channels.lock().await;
                if let Some(ch) = chans.get_mut(&channel) {
                    ch.history.push_back(m.clone());
                    while ch.history.len() > HISTORY { ch.history.pop_front(); }
                    let _ = ch.tx.send(ServerEvent::Msg { channel: channel.clone(), msg: m });
                }
            }
        }
    }
    let mut chans = s.channels.lock().await;
    if let Some(ch) = chans.get_mut(&channel) {
        ch.members.remove(&conn);
        let _ = presence_tx.send(ServerEvent::Presence {
            channel: channel.clone(),
            users: ch.users(),
        });
    }
}

#[cfg(test)]
mod tests;
