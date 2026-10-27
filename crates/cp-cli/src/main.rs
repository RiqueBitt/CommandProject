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
  4gb [on|off]                modo 4 GB: deixa o jogo (32 bits) usar até 4 GB de memória
  hd [grupos|gerar] [--rapido] lista os grupos de texturas ou gera o mod \"Remaster HD\"

FORJA (carregador de mods):
  forja new <ID> [NOME] [PASTA]  cria um mod de exemplo em PASTA/forja/<ID>/
  forja check <PASTA|.scd>       confere um mod (manifesto, arquivos, avisos do código)
  forja pack <PASTA> [SAÍDA.scd] empacota a pasta do mod num .scd (importe com \"cp import\")
  forja status                   mods da Forja ligados, ordem de carga e problemas
  forja option <MOD> <CHAVE> <VALOR>  muda uma opção (valor em JSON: true, 2, \"texto\")

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
    if cmd == "forja" && matches!(args.get(1).map(String::as_str), Some("new" | "check" | "pack")) {
        return forja_offline(args);
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
        "forja" => match args.get(1).map(String::as_str) {
            Some("option") => {
                let (id, key, raw) = (arg(2)?, arg(3)?, arg(4)?);
                let value: serde_json::Value = serde_json::from_str(raw).unwrap_or_else(|_| serde_json::Value::String(raw.into()));
                let mut s = cp_core::forja::Settings::load(&ws.data_dir);
                s.mods.entry(id.into()).or_default().insert(key.into(), value);
                s.save(&ws.data_dir)?;
                println!("{id}.{key} = {raw} (vale no próximo \"cp apply\")");
            }
            _ => {
                let plan = ws.forja_plan()?;
                let settings = cp_core::forja::Settings::load(&ws.data_dir);
                println!("Forja {} — painel na partida: {}", cp_core::forja::LOADER_VERSION, settings.panel_key());
                for (i, m) in cp_core::forja::describe(&plan, &settings).iter().enumerate() {
                    println!("  {}. {} {} ({}) [{}]", i + 1, m.id, m.version, m.name, m.sides.join(", "));
                    for (k, v) in &m.values {
                        println!("       {k} = {v}");
                    }
                }
                for p in &plan.problems {
                    println!("  {} {}: {}", if p.fatal { "✗" } else { "!" }, p.mod_id, p.message);
                }
            }
        },
        "hd" => {
            let sources = ws.stock_sources()?;
            if args.get(1).map(String::as_str) != Some("gerar") {
                for g in cp_core::enhance::groups(&sources)? {
                    println!(
                        "{:28} {:5} texturas {:8.1} MB  {:?}",
                        g.group,
                        g.textures,
                        g.bytes as f64 / 1_048_576.0,
                        g.suggested
                    );
                }
                return Ok(());
            }
            let opts = cp_core::enhance::EnhanceOptions {
                quality: if args.iter().any(|a| a == "--rapido") {
                    cp_core::dds::Quality::Fast
                } else {
                    cp_core::dds::Quality::Normal
                },
                ..Default::default()
            };
            let dest = ws.data_dir.join("cache").join("hd").join("zz_cp_texturas_hd.scd");
            let r = cp_core::enhance::build(&sources, &opts, &dest, &mut |i, n, name| {
                if i % 16 == 0 || i == n {
                    eprintln!("  [{i}/{n}] {name}");
                }
            })?;
            let m = ws.import_mod(
                &r.archive,
                &ImportOptions {
                    id: Some("texturas-hd".into()),
                    name: Some(opts.name.clone()),
                    category: Some(cp_core::manifest::Category::Textures),
                    multiplayer: Some(cp_core::manifest::MpPolicy::Local),
                    replace: true,
                    ..Default::default()
                },
                true,
            )?;
            let _ = std::fs::remove_file(&r.archive);
            println!(
                "{}: {} ampliadas, {} com nitidez, {} sem mudança, {} com erro",
                m.name,
                r.upscaled,
                r.sharpened,
                r.unchanged,
                r.failed.len()
            );
        }
        "4gb" => {
            let l = ws.laa()?;
            let st = match args.get(1).map(String::as_str) {
                Some("on") => {
                    let st = l.enable()?;
                    ws.settings.keep_large_address = true;
                    ws.save_settings()?;
                    st
                }
                Some("off") => {
                    let st = l.disable()?;
                    ws.settings.keep_large_address = false;
                    ws.save_settings()?;
                    st
                }
                _ => l.status()?,
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
            let r = cp_core::shaders::install_reshade(&exe, &cache, &mut |m, _| eprintln!("  {m}")).await?;
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

/// `cp forja new|check|pack`: não precisam do jogo nem da biblioteca.
fn forja_offline(args: &[String]) -> cp_core::Result<()> {
    use cp_core::forja;
    let need = |i: usize| {
        args.get(i)
            .map(String::as_str)
            .ok_or_else(|| cp_core::Error::Other(format!("faltou argumento para \"forja {}\"", args[1])))
    };
    match args[1].as_str() {
        "new" => {
            let id = need(2)?;
            let name = args.get(3).cloned().unwrap_or_else(|| id.to_string());
            let dir = args.get(4).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
            let root = forja::scaffold(&dir, id, &name)?;
            println!("criado: {}", root.display());
            println!("edite os .lua, depois: cp forja pack {} && cp import {}.scd", dir.display(), id);
        }
        "check" => {
            let p = PathBuf::from(need(2)?);
            let (mods, errors) = if p.is_dir() { (forja::read_folder(&p)?, Vec::new()) } else { forja::read_archive(&p, "")? };
            for m in &mods {
                let ok_loader = cp_core::manifest::version_matches(m.manifest.loader.as_deref(), forja::LOADER_VERSION);
                println!("{} {} {} [{}]", if ok_loader { "✓" } else { "✗" }, m.manifest.id, m.manifest.version, m.sides().join(", "));
                if !ok_loader {
                    println!("    precisa da Forja {} (esta é a {})", m.manifest.loader.as_deref().unwrap_or(""), forja::LOADER_VERSION);
                }
                for w in m.lint() {
                    println!("    aviso: {w}");
                }
            }
            for e in &errors {
                println!("✗ {e}");
            }
            if !errors.is_empty() {
                return Err(cp_core::Error::Other(format!("{} problema(s)", errors.len())));
            }
        }
        _ => {
            let dir = PathBuf::from(need(2)?);
            let mods = forja::read_folder(&dir)?;
            let out = args
                .get(3)
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from(format!("{}.scd", mods[0].manifest.id)));
            let (path, packed) = forja::pack(&dir, &out)?;
            println!(
                "{} ({} mod: {})",
                path.display(),
                packed.len(),
                packed.iter().map(|m| m.manifest.id.as_str()).collect::<Vec<_>>().join(", ")
            );
        }
    }
    Ok(())
}
