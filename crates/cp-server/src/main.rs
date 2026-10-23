//! `cp-server` — servidor da comunidade (hub de mods, salas e chat).
//!
//! Variáveis de ambiente:
//!   PORT              porta HTTP (padrão 8787)
//!   CP_SERVER_NAME    nome exibido no launcher
//!   CP_MOTD           mensagem do dia
//!   CP_HUB_DIR        pasta do hub (hub.json + mods/<id>/<versão>/pacote); vazio = sem hub
//!   CP_DATA_DIR       pasta para caches (padrão ./data)
//!   CP_TRUST_PROXY=1  usar X-Forwarded-For (atrás de proxy/hospedagem)

use cp_server::{router, AppState, Config};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();
    let env = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
    let data_dir = PathBuf::from(env("CP_DATA_DIR").unwrap_or_else(|| "data".into()));
    std::fs::create_dir_all(&data_dir).expect("não foi possível criar CP_DATA_DIR");
    let cfg = Config {
        name: env("CP_SERVER_NAME").unwrap_or_else(|| "Servidor da comunidade".into()),
        motd: env("CP_MOTD").unwrap_or_default(),
        hub_dir: env("CP_HUB_DIR").map(PathBuf::from),
        data_dir,
        trust_proxy: env("CP_TRUST_PROXY").as_deref() == Some("1"),
    };
    let port: u16 = env("PORT").and_then(|p| p.parse().ok()).unwrap_or(8787);
    let state = AppState::new(cfg);

    if let Some(w) = state.rebuild_hub().await {
        for line in w {
            tracing::warn!("{line}");
        }
    }
    let s = state.clone();
    tokio::spawn(async move {
        let mut tick = 0u32;
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            let n = s.sweep().await;
            if n > 0 {
                tracing::info!("{n} sala(s) expirada(s)");
            }
            tick += 1;
            if tick.is_multiple_of(10) {
                s.rebuild_hub().await; // a cada ~5 min pega mods novos na pasta
            }
        }
    });

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await.expect("porta em uso");
    tracing::info!("cp-server ouvindo em http://{addr}");
    axum::serve(
        listener,
        router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(async {
        let _ = tokio::signal::ctrl_c().await;
    })
    .await
    .expect("servidor");
}
