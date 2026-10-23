use super::*;
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message as WsMsg;

async fn start(hub: Option<PathBuf>, data: PathBuf) -> (String, Arc<AppState>) {
    let state = AppState::new(Config {
        name: "Teste".into(),
        motd: "bem-vindo".into(),
        hub_dir: hub,
        data_dir: data,
        trust_proxy: false,
    });
    state.rebuild_hub().await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(state.clone()).into_make_service_with_connect_info::<SocketAddr>();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("127.0.0.1:{}", addr.port()), state)
}

fn sync_code() -> String {
    cp_core::sync::encode(&cp_core::sync::SyncPayload {
        v: 1,
        profile: "Liga".into(),
        mods: vec![cp_core::sync::SyncMod {
            id: "storm".into(),
            name: "STORM".into(),
            version: "3.1.1".into(),
            hub_id: None,
            url: None,
            files: vec![("zz_STORM.scd".into(), "a".repeat(64))],
        }],
        fingerprint: None,
    })
    .unwrap()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn rooms_lifecycle() {
    let t = tempfile_dir();
    let (addr, state) = start(None, t.clone()).await;
    let c = client();
    let base = format!("http://{addr}");

    let info: serde_json::Value = c
        .get(format!("{base}/api/info"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(info["name"], "Teste");
    assert_eq!(info["hub"], false);

    // validações
    let r = c
        .post(format!("{base}/api/rooms"))
        .json(&serde_json::json!({"name":"x","nick":"Rique","syncCode":sync_code()}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400, "nome curto");
    let r = c
        .post(format!("{base}/api/rooms"))
        .json(&serde_json::json!({"name":"Sala boa","nick":"Rique","syncCode":"CP1-lixo"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 400, "código inválido");

    // sala privada
    let created: serde_json::Value = c
        .post(format!("{base}/api/rooms"))
        .json(&serde_json::json!({"name":"2v2 sexta","nick":"Rique","syncCode":sync_code(),"fingerprint":"7f3a-91c2-0b5e","maxPlayers":2,"password":"abc"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let id = created["room"]["id"].as_str().unwrap().to_string();
    let tok = created["token"].as_str().unwrap().to_string();
    assert_eq!(created["room"]["mods"][0], "STORM 3.1.1");
    assert_eq!(created["room"]["fingerprint"], "7F3A-91C2-0B5E");

    let list: Vec<serde_json::Value> = c
        .get(format!("{base}/api/rooms"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].get("syncCode").is_none(), "sala privada esconde o código");
    assert!(list[0].get("token").is_none());

    let r = c
        .post(format!("{base}/api/rooms/{id}/join"))
        .json(&serde_json::json!({"nick":"Amigo","password":"errada"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    let joined: serde_json::Value = c
        .post(format!("{base}/api/rooms/{id}/join"))
        .json(&serde_json::json!({"nick":"Amigo","password":"abc"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(joined["syncCode"].as_str().unwrap(), sync_code());
    let r = c
        .post(format!("{base}/api/rooms/{id}/join"))
        .json(&serde_json::json!({"nick":"Terceiro","password":"abc"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 409, "sala cheia");

    // só o dono altera/apaga
    let r = c.delete(format!("{base}/api/rooms/{id}")).send().await.unwrap();
    assert_eq!(r.status(), 403);
    let upd: serde_json::Value = c
        .patch(format!("{base}/api/rooms/{id}"))
        .bearer_auth(&tok)
        .json(&serde_json::json!({"status":"em partida"}))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(upd["status"], "em partida");
    assert_eq!(
        c.post(format!("{base}/api/rooms/{id}/heartbeat"))
            .bearer_auth(&tok)
            .send()
            .await
            .unwrap()
            .status(),
        200
    );

    // expiração
    state.rooms.lock().await.get_mut(&id).unwrap().last_seen = Instant::now() - ROOM_TTL - Duration::from_secs(1);
    assert_eq!(state.sweep().await, 1);
    assert_eq!(
        c.post(format!("{base}/api/rooms/{id}/heartbeat"))
            .bearer_auth(&tok)
            .send()
            .await
            .unwrap()
            .status(),
        404
    );

    // limite de salas por IP
    for i in 0..MAX_ROOMS_PER_IP {
        let r = c
            .post(format!("{base}/api/rooms"))
            .json(&serde_json::json!({"name":format!("Sala {i}"),"nick":"Rique","syncCode":sync_code()}))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
    }
    let r = c
        .post(format!("{base}/api/rooms"))
        .json(&serde_json::json!({"name":"Mais uma","nick":"Rique","syncCode":sync_code()}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 429);
}

#[tokio::test]
async fn chat_broadcast_history_and_rate_limit() {
    let t = tempfile_dir();
    let (addr, _state) = start(None, t).await;
    let (mut a, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws?nick=Rique"))
        .await
        .unwrap();
    let first: serde_json::Value = next_json(&mut a).await;
    assert_eq!(first["type"], "history");
    let (mut b, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws?nick=Amigo&channel=global"))
        .await
        .unwrap();
    let _ = next_json(&mut b).await; // histórico

    a.send(WsMsg::Text(r#"{"text":"  bora 2v2?  "}"#.into())).await.unwrap();
    let msg = wait_for(&mut b, "msg").await;
    assert_eq!(msg["nick"], "Rique");
    assert_eq!(msg["text"], "bora 2v2?");

    // quem conecta depois recebe o histórico
    let (mut c, _) = tokio_tungstenite::connect_async(format!("ws://{addr}/ws?nick=Novato"))
        .await
        .unwrap();
    let h = next_json(&mut c).await;
    assert_eq!(h["messages"][0]["text"], "bora 2v2?");

    // limite de mensagens
    for i in 0..RATE_MSGS + 2 {
        a.send(WsMsg::Text(format!(r#"{{"text":"spam {i}"}}"#).into()))
            .await
            .unwrap();
    }
    let err = wait_for(&mut a, "error").await;
    assert!(err["message"].as_str().unwrap().contains("devagar"));

    // apelido inválido e sala inexistente são recusados
    assert!(tokio_tungstenite::connect_async(format!("ws://{addr}/ws?nick=x"))
        .await
        .is_err());
    assert!(
        tokio_tungstenite::connect_async(format!("ws://{addr}/ws?nick=Rique&channel=NAOEXISTE"))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn serves_hub_index_and_packages() {
    let t = tempfile_dir();
    let hub = t.join("hub");
    let v = hub.join("mods/hud-azul/1.0.0");
    std::fs::create_dir_all(&v).unwrap();
    std::fs::write(
        hub.join("mods/hud-azul/mod.json"),
        r#"{"name":"HUD Azul","category":"ui"}"#,
    )
    .unwrap();
    std::fs::write(v.join("pacote.zip"), b"PK\x03\x04conteudo").unwrap();
    let (addr, _s) = start(Some(hub), t.join("data")).await;
    let c = client();
    let idx: cp_core::hub::HubIndex = c
        .get(format!("http://{addr}/hub/index.json"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(idx.mods[0].id, "hud-azul");
    let pkg = &idx.mods[0].versions[0].package;
    let body = c
        .get(format!("http://{addr}/hub/{}", pkg.url))
        .send()
        .await
        .unwrap()
        .bytes()
        .await
        .unwrap();
    assert_eq!(cp_core::fsutil::sha256_bytes(&body), pkg.sha256);
    // e o cliente do launcher consegue baixar e verificar pelo caminho normal
    let path = cp_core::hub::download(
        &format!("http://localhost:{}/hub/index.json", addr.split(':').nth(1).unwrap()),
        pkg,
        &t.join("cache"),
        &mut |_| {},
    )
    .await
    .unwrap();
    assert!(path.exists());
}

async fn next_json<S>(ws: &mut S) -> serde_json::Value
where
    S: StreamExt<Item = Result<WsMsg, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        let m = tokio::time::timeout(Duration::from_secs(5), ws.next())
            .await
            .expect("timeout")
            .unwrap()
            .unwrap();
        if let WsMsg::Text(t) = m {
            return serde_json::from_str(&t).unwrap();
        }
    }
}

async fn wait_for<S>(ws: &mut S, kind: &str) -> serde_json::Value
where
    S: StreamExt<Item = Result<WsMsg, tokio_tungstenite::tungstenite::Error>> + Unpin,
{
    loop {
        let v = next_json(ws).await;
        if v["type"] == kind {
            return v;
        }
    }
}

fn tempfile_dir() -> PathBuf {
    let p = std::env::temp_dir().join(format!("cp-server-test-{}", rand::random::<u64>()));
    std::fs::create_dir_all(&p).unwrap();
    p
}
