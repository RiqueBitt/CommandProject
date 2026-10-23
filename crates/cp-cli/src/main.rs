//! `cp` — o CommandProject pela linha de comando (mesma pasta de dados do app).

use cp_core::deploy::Progress;
use cp_core::library::ImportOptions;
use cp_core::workspace::{default_data_dir, Workspace};
use std::path::PathBuf;
use std::process::ExitCode;

const HELP: &str = "CommandProject — launcher e hub de mods do Supreme Commander 2

USO: cp <comando> [args]

  status                      jogo, perfil ativo e o que falta aplicar
  game [PASTA|auto]           mostra ou define a pasta do jogo
  mods                        lista os mods da biblioteca
  import <ARQUIVO|PASTA>      importa .scd, .zip ou pasta para a biblioteca (e ativa)
  enable <ID> / disable <ID>  liga/desliga um mod no perfil ativo
  order <ID> <ID> ...         define a ordem de carga do perfil ativo
  remove <ID>                 apaga um mod da biblioteca
  profiles                    lista perfis
  profile <ID>                troca o perfil ativo
  plan                        o que \"apply\" vai fazer
  apply                       aplica o perfil ativo na pasta do jogo
  purge                       devolve a pasta do jogo ao original
  files                       estado de cada .scd da pasta do jogo
  adopt <ARQUIVO.scd>         transforma um .scd instalado à mão em mod gerenciado
  conflicts                   arquivos internos disputados entre mods
  fingerprint                 assinatura da pasta (compare com amigos antes da partida)
  sync-export                 gera o código de sincronização do perfil ativo
  sync-import <CÓDIGO>        cria um perfil igual ao do código
  hub <URL>                   lista os mods de um índice de hub
  hub-install <URL> <ID>      baixa, verifica e instala um mod do hub
  launch                      mostra como o jogo seria iniciado
  hub-build <PASTA> [SAÍDA]   gera o index.json de uma pasta de hub (hash e tamanho automáticos)
  link <URL>                  instala um mod de um link direto (.scd/.zip)
  shaders [PRESET|off|reset|remove]
                              shaders (ReShade): estado, ativa natural/vivido/cinematico,
                              desliga, restaura os presets ou remove tudo
  reshade                     baixa e instala o ReShade oficial no jogo (Windows)

Pasta de dados: $CP_DATA ou o padrão do sistema.";

fn progress(p: Progress) {
    eprintln!("  [{}/{}] {}", p.step, p.total, p.message);
}

fn print_json<T: serde::Serialize>(v: &T) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}

#[tokio::main]
async fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("erro: {e}");
            ExitCode::FAILURE
        }
    }
}

async fn run(args: &[String]) -> cp_core::Result<()> {
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    let arg = |i: usize| -> cp_core::Result<&str> {
        args.get(i)
            .map(String::as_str)
            .ok_or_else(|| cp_core::Error::Other(format!("faltou argumento para \"{cmd}\"")))
    };
    if matches!(cmd, "help" | "-h" | "--help") {
        println!("{HELP}");
        return Ok(());
    }
    let resources = std::env::var_os("CP_RESOURCES").map(PathBuf::from);
    let mut ws = Workspace::open(&default_data_dir(), resources)?;
    if let Some(msg) = ws.recover()? {
        eprintln!("recuperação: {msg}");
    }
    match cmd {
        "status" => print_json(&ws.dashboard()?),
        "game" => match args.get(1).map(String::as_str) {
            None => print_json(&ws.game().ok()),
            Some("auto") => print_json(&ws.set_game_path(None)?),
            Some(p) => print_json(&ws.set_game_path(Some(PathBuf::from(p)))?),
        },
        "mods" => {
            let active = ws.profiles.active().clone();
            for m in ws.mods()? {
                let on = active.mods.iter().any(|x| x.id == m.manifest.id && x.enabled);
                println!(
                    "{} {:<28} {:<10} {:?}  {}",
                    if on { "[x]" } else { "[ ]" },
                    m.manifest.id,
                    m.manifest.version,
                    m.manifest.category,
                    m.manifest
                        .files
                        .iter()
                        .map(|f| f.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                );
            }
        }
        "import" => {
            let m = ws.import_mod(&PathBuf::from(arg(1)?), &ImportOptions::default(), true)?;
            println!(
                "importado: {} ({}) — ativado no perfil \"{}\"",
                m.name,
                m.id,
                ws.profiles.active().name
            );
        }
        "enable" | "disable" => {
            let id = arg(1)?;
            ws.library.get(id)?;
            let p = ws.profiles.active().id.clone();
            ws.profiles.set_enabled(&p, id, cmd == "enable")?;
            println!("{id}: {}", if cmd == "enable" { "ativado" } else { "desativado" });
        }
        "order" => {
            let p = ws.profiles.active().id.clone();
            ws.profiles.reorder(&p, &args[1..])?;
            print_json(&ws.profiles.active().mods);
        }
        "remove" => {
            ws.remove_mod(arg(1)?)?;
            println!("removido (rode \"cp apply\" para tirar do jogo)");
        }
        "profiles" => {
            for p in &ws.profiles.set.profiles {
                let mark = if p.id == ws.profiles.set.active { "*" } else { " " };
                println!("{mark} {:<20} {} ({} mods ativos)", p.id, p.name, p.enabled_ids().len());
            }
        }
        "profile" => {
            ws.profiles.set_active(arg(1)?)?;
            println!("perfil ativo: {}", ws.profiles.active().name);
        }
        "plan" => print_json(&ws.plan_active()?),
        "apply" => {
            let plan = ws.apply_active(&mut progress)?;
            for w in &plan.warnings {
                eprintln!("aviso: {w}");
            }
            println!(
                "aplicado: +{} ~{} -{} ↺{}",
                plan.add.len(),
                plan.replace.len(),
                plan.remove.len(),
                plan.restore.len()
            );
        }
        "purge" => {
            ws.purge(&mut progress)?;
            println!("pasta do jogo restaurada ao original");
        }
        "files" => {
            for f in ws.file_status()? {
                println!(
                    "{:<34} {:>12}  {:<10} {:<9} {}",
                    f.name,
                    f.size,
                    f.origin,
                    f.state,
                    f.mod_id.unwrap_or_default()
                );
            }
        }
        "adopt" => {
            let m = ws.adopt_unmanaged(arg(1)?)?;
            println!("adotado como mod \"{}\" ({})", m.name, m.id);
        }
        "conflicts" => print_json(&ws.conflicts_active()?),
        "fingerprint" => println!("{}", ws.fingerprint()?.code),
        "sync-export" => println!("{}", ws.export_sync_code(None)?),
        "sync-import" => {
            let (id, items) = ws.apply_sync_code(arg(1)?)?;
            println!("perfil ativo: {id}");
            for i in items {
                println!("  {:<10} {} {}", i.state, i.id, i.version);
            }
        }
        "hub" => {
            let idx = cp_core::hub::fetch_index(arg(1)?).await?;
            println!("{} — {} mods", idx.name, idx.mods.len());
            for m in &idx.mods {
                println!(
                    "  {:<24} {:<10} {}",
                    m.id,
                    m.latest().map(|v| v.version.as_str()).unwrap_or("-"),
                    m.summary
                );
            }
        }
        "hub-install" => {
            let idx = cp_core::hub::fetch_index(arg(1)?).await?;
            let id = arg(2)?;
            let m = idx
                .mods
                .iter()
                .find(|m| m.id == id)
                .ok_or_else(|| cp_core::Error::ModNotFound(id.into()))?;
            let v = m.latest().expect("validado");
            let cache = ws.data_dir.join("cache").join("downloads");
            let path = cp_core::hub::download(&idx.source_url, &v.package, &cache, &mut |p| {
                eprint!(
                    "\r  baixando {:>5.1}%",
                    p.downloaded as f64 * 100.0 / p.total.max(1) as f64
                )
            })
            .await?;
            eprintln!();
            let man = cp_core::hub::install_downloaded(&ws.library, &idx.source_url, m, v, &path)?;
            let p = ws.profiles.active().id.clone();
            ws.profiles.set_enabled(&p, &man.id, true)?;
            println!("instalado: {} {}", man.name, man.version);
        }
        "hub-build" => {
            let dir = PathBuf::from(arg(1)?);
            let (idx, warnings) = cp_core::hubbuild::build_index(&dir, None)?;
            for w in &warnings {
                eprintln!("aviso: {w}");
            }
            let out = args.get(2).map(PathBuf::from).unwrap_or_else(|| dir.join("index.json"));
            cp_core::fsutil::write_json(&out, &idx)?;
            println!("{} mod(s) em {}", idx.mods.len(), out.display());
        }
        "link" => {
            let cache = ws.data_dir.join("cache").join("links");
            let path = cp_core::hub::download_url(arg(1)?, &cache, &mut |p| {
                eprint!("\r  baixando {} KB", p.downloaded / 1024)
            })
            .await?;
            eprintln!();
            let m = ws.import_mod(
                &path,
                &ImportOptions {
                    replace: true,
                    ..Default::default()
                },
                true,
            )?;
            println!("instalado: {} ({}) sha256 {}", m.name, m.id, m.files[0].sha256);
        }
        "shaders" => {
            let sh = ws.shaders()?;
            let st = match args.get(1).map(String::as_str) {
                None | Some("status") => sh.status()?,
                Some("off") => sh.apply(None)?,
                Some("reset") => sh.reset_presets()?,
                Some("remove") => sh.remove(false)?,
                Some(p) => {
                    let id = cp_core::shaders::PRESETS
                        .iter()
                        .find(|(id, name, _)| id.eq_ignore_ascii_case(p) || name.eq_ignore_ascii_case(p))
                        .map(|(id, ..)| *id)
                        .ok_or_else(|| {
                            cp_core::Error::Other(format!("preset desconhecido: {p} (natural, vivido, cinematico)"))
                        })?;
                    sh.apply(Some(id))?
                }
            };
            print_json(&st);
        }
        "reshade" => {
            let exe = ws
                .game()?
                .exe
                .clone()
                .ok_or_else(|| cp_core::Error::Other("executável do jogo não encontrado".into()))?;
            let cache = ws.data_dir.join("cache").join("reshade");
            let r = cp_core::shaders::install_reshade(&exe, &cache, &mut |m| eprintln!("  {m}")).await?;
            println!("ReShade {} instalado (assinado por {})", r.version, r.signer);
        }
        "launch" => print_json(&ws.launch_plan()?),
        other => {
            return Err(cp_core::Error::Other(format!(
                "comando desconhecido: {other} (veja \"cp help\")"
            )))
        }
    }
    Ok(())
}
