//! Mod "Otimização": ajustes de desempenho que valem dentro do jogo e no Windows.
//!
//! Dentro do jogo (o `.scd` do mod, montado com o `uimain.lua` do próprio jogo do usuário):
//! - **limite de FPS** pelo `sc_FrameTimeClamp` do motor ("tempo mínimo entre quadros, em ms").
//!   O padrão do jogo é 10 ms (100 FPS), lido do executável; o mod põe o limite escolhido no
//!   começo de cada partida (ou volta ao padrão), e nas partidas grandes (mais de 8 exércitos)
//!   pode usar um limite menor, que sobra processador para a simulação.
//!
//! No Windows (pelo launcher, reversível, só para o executável do jogo):
//! - **placa de vídeo dedicada**: `HKCU\Software\Microsoft\DirectX\UserGpuPreferences`
//!   (`GpuPreference=2;`), a mesma opção de "Configurações de gráficos" do Windows;
//! - **sem as "otimizações de tela cheia"**: `DISABLEDXMAXIMIZEDWINDOWEDMODE` em
//!   `HKCU\...\AppCompatFlags\Layers`, a mesma caixa de "Propriedades → Compatibilidade";
//! - prioridade do processo, sem economia de energia do Windows e o modo 4 GB ficam nas
//!   configurações do launcher e valem ao abrir o jogo (`perf`, `laa`).
//!
//! Nada é removido do jogo: o mod não mexe em unidades, efeitos nem texturas.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Padrão do jogo para `sc_FrameTimeClamp` (ms), lido do executável (valor inicial da variável).
pub const GAME_FRAME_MS: u32 = 10;
/// Limites de FPS oferecidos (0 = o do jogo, 100).
pub const FPS_CHOICES: &[u32] = &[0, 30, 45, 60, 75, 90, 120, 144, 165, 240];

const MARK: &str = "CommandProject optimize";
const UI_FILE: &str = "/lua/ui/uimain.lua";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct OptimizeOptions {
    /// limite de FPS nas partidas (0 = o do jogo)
    pub fps: u32,
    /// limite nas partidas com mais de 8 exércitos (0 = o mesmo das outras)
    pub big_fps: u32,
    /// usar a placa de vídeo dedicada (Windows)
    pub gpu: bool,
    /// desligar as "otimizações de tela cheia" do Windows para o jogo
    pub fullscreen_fix: bool,
    /// prioridade do processo: `normal`, `above_normal` ou `high`
    pub priority: String,
    /// o Windows não põe o jogo em modo de economia de energia
    pub no_throttle: bool,
    /// manter o modo 4 GB
    pub large_address: bool,
}

impl Default for OptimizeOptions {
    fn default() -> Self {
        OptimizeOptions {
            fps: 0,
            big_fps: 60,
            gpu: true,
            fullscreen_fix: true,
            priority: "above_normal".into(),
            no_throttle: true,
            large_address: true,
        }
    }
}

/// Milissegundos entre quadros para um limite de FPS (arredondado: o motor guarda inteiro ou real).
pub fn frame_ms(fps: u32) -> u32 {
    if fps == 0 {
        GAME_FRAME_MS
    } else {
        ((1000.0 / fps.clamp(10, 1000) as f64).round() as u32).max(1)
    }
}

const UI_CODE: &str = include_str!("optimize_ui.lua");

/// Código que vai no fim do `uimain.lua`: aplica o limite no começo da partida.
pub fn ui_lua(o: &OptimizeOptions) -> String {
    let normal = frame_ms(o.fps);
    let big = if o.big_fps == 0 { normal } else { frame_ms(o.big_fps) };
    format!("\n{}", UI_CODE.replace("{FRAME_MS}", &normal.to_string()).replace("{BIG_FRAME_MS}", &big.to_string()))
}

/// `uimain.lua` com a chamada no começo de `StartGameUI` e o código no fim.
pub fn patch_ui_main(text: &str, code: &str) -> Result<String> {
    if text.contains(MARK) {
        return Err(Error::Other("o uimain.lua do jogo já tem a otimização: use o original do jogo".into()));
    }
    let anchor = "function StartGameUI()";
    let Some(p) = text.find(anchor) else {
        return Err(Error::Other("o uimain.lua do jogo não tem StartGameUI: não deu para ligar a otimização".into()));
    };
    let end = text[p..].find('\n').map(|i| p + i + 1).unwrap_or(text.len());
    let mut out = String::with_capacity(text.len() + code.len() + 64);
    out.push_str(&text[..end]);
    out.push_str("    pcall(CPOptimizeStart) -- CommandProject optimize\n");
    out.push_str(&text[end..]);
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(code);
    Ok(out)
}

/// Monta o `.scd` do mod em `dest` com os arquivos do jogo do usuário (`sources`).
pub fn build(sources: &[PathBuf], opts: &OptimizeOptions, dest: &Path) -> Result<PathBuf> {
    let text = crate::cheats::game_text_for(sources, UI_FILE, "a otimização")?;
    let ui = patch_ui_main(&text, &ui_lua(opts))?;
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    b.add_bytes("lua/ui/uimain.lua", ui.as_bytes())?;
    b.finish()
}

/// Resumo do que o mod faz (descrição na biblioteca).
pub fn describe(o: &OptimizeOptions) -> String {
    let fps = |f: u32| if f == 0 { "100 FPS (o do jogo)".to_string() } else { format!("{f} FPS") };
    let mut list = vec![format!("limite de {} nas partidas", fps(o.fps))];
    if o.big_fps != 0 && o.big_fps != o.fps {
        list.push(format!("{} nas partidas com mais de 8 jogadores", fps(o.big_fps)));
    }
    if o.gpu {
        list.push("placa de vídeo dedicada".into());
    }
    if o.fullscreen_fix {
        list.push("sem as otimizações de tela cheia do Windows".into());
    }
    match o.priority.as_str() {
        "above_normal" => list.push("prioridade acima do normal".into()),
        "high" => list.push("prioridade alta".into()),
        _ => {}
    }
    if o.no_throttle {
        list.push("sem economia de energia do Windows no jogo".into());
    }
    if o.large_address {
        list.push("modo 4 GB".into());
    }
    let mut s = list.join(", ");
    if let Some(c) = s.get(..1) {
        s = c.to_uppercase() + &s[1..];
    }
    s + ". Não remove nada do jogo."
}

// ===================================================================== Windows

/// Flag de compatibilidade que desliga as "otimizações de tela cheia".
pub const FULLSCREEN_FLAG: &str = "DISABLEDXMAXIMIZEDWINDOWEDMODE";
#[cfg_attr(not(windows), allow(dead_code))]
const GPU_KEY: &str = r"Software\Microsoft\DirectX\UserGpuPreferences";
#[cfg_attr(not(windows), allow(dead_code))]
const LAYERS_KEY: &str = r"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers";
#[cfg_attr(not(windows), allow(dead_code))]
const GPU_HIGH: &str = "GpuPreference=2;";

/// Liga/desliga uma flag numa linha de compatibilidade (`~ FLAG1 FLAG2`), mantendo as outras.
/// `None` = a linha fica vazia (o valor deve ser apagado).
pub fn layers_with(current: Option<&str>, flag: &str, on: bool) -> Option<String> {
    let mut tokens: Vec<String> = current
        .unwrap_or("")
        .split_whitespace()
        .filter(|t| *t != "~" && !t.eq_ignore_ascii_case(flag))
        .map(str::to_string)
        .collect();
    if on {
        tokens.push(flag.to_string());
    }
    if tokens.is_empty() {
        None
    } else {
        Some(format!("~ {}", tokens.join(" ")))
    }
}

/// A preferência de GPU do Windows pede a placa dedicada?
pub fn gpu_is_high(value: &str) -> bool {
    value.split(';').any(|p| p.trim().eq_ignore_ascii_case("GpuPreference=2"))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct WindowsTweaks {
    /// os ajustes do Windows existem aqui (só no Windows)
    pub supported: bool,
    pub gpu: bool,
    pub fullscreen_fix: bool,
}

#[cfg(windows)]
pub fn windows_status(exe: &Path) -> WindowsTweaks {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    let name = exe.as_os_str();
    let gpu = hk.open_subkey(GPU_KEY).and_then(|k| k.get_value::<String, _>(name)).map(|v| gpu_is_high(&v)).unwrap_or(false);
    let fs = hk
        .open_subkey(LAYERS_KEY)
        .and_then(|k| k.get_value::<String, _>(name))
        .map(|v| v.split_whitespace().any(|t| t.eq_ignore_ascii_case(FULLSCREEN_FLAG)))
        .unwrap_or(false);
    WindowsTweaks { supported: true, gpu, fullscreen_fix: fs }
}

#[cfg(windows)]
pub fn apply_windows(exe: &Path, gpu: bool, fullscreen_fix: bool) -> Result<WindowsTweaks> {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hk = RegKey::predef(HKEY_CURRENT_USER);
    let name = exe.as_os_str();
    let reg = |e: std::io::Error| Error::Other(format!("o Windows recusou a alteração: {e}"));
    let (k, _) = hk.create_subkey(GPU_KEY).map_err(reg)?;
    let cur: Option<String> = k.get_value(name).ok();
    if gpu {
        k.set_value(name, &GPU_HIGH.to_string()).map_err(reg)?;
    } else if cur.as_deref().is_some_and(gpu_is_high) {
        // só apaga o que é nosso (a placa dedicada); outra escolha do usuário fica
        k.delete_value(name).map_err(reg)?;
    }
    let (k, _) = hk.create_subkey(LAYERS_KEY).map_err(reg)?;
    let cur: Option<String> = k.get_value(name).ok();
    match layers_with(cur.as_deref(), FULLSCREEN_FLAG, fullscreen_fix) {
        Some(v) => {
            if cur.as_deref() != Some(v.as_str()) {
                k.set_value(name, &v).map_err(reg)?;
            }
        }
        None => {
            if cur.is_some() {
                k.delete_value(name).map_err(reg)?;
            }
        }
    }
    Ok(windows_status(exe))
}

#[cfg(not(windows))]
pub fn windows_status(_exe: &Path) -> WindowsTweaks {
    WindowsTweaks::default()
}

#[cfg(not(windows))]
pub fn apply_windows(exe: &Path, _gpu: bool, _fullscreen_fix: bool) -> Result<WindowsTweaks> {
    Ok(windows_status(exe))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_limits() {
        assert_eq!(frame_ms(0), 10);
        assert_eq!(frame_ms(60), 17);
        assert_eq!(frame_ms(144), 7);
        assert_eq!(frame_ms(30), 33);
        assert_eq!(frame_ms(100), 10);
        let lua = ui_lua(&OptimizeOptions { fps: 144, big_fps: 60, ..Default::default() });
        assert!(lua.contains("CPOptFrameMs = 7\n") && lua.contains("CPOptBigFrameMs = 17\n"));
        let same = ui_lua(&OptimizeOptions { fps: 0, big_fps: 0, ..Default::default() });
        assert!(same.contains("CPOptFrameMs = 10\n") && same.contains("CPOptBigFrameMs = 10\n"));
    }

    #[test]
    fn hooks_start_game_ui() {
        let src = "function SetupUI()\nend\n\nfunction StartGameUI()\n    console = false\nend\n";
        let out = patch_ui_main(src, "-- code\n").unwrap();
        assert!(out.contains("function StartGameUI()\n    pcall(CPOptimizeStart) -- CommandProject optimize\n    console = false"));
        assert!(out.ends_with("end\n-- code\n"));
        let twice = patch_ui_main(&format!("{out}\n-- {MARK}"), "");
        assert!(twice.is_err());
        assert!(patch_ui_main("nada", "").is_err());
    }

    #[test]
    fn compat_layers() {
        assert_eq!(layers_with(None, FULLSCREEN_FLAG, true).as_deref(), Some("~ DISABLEDXMAXIMIZEDWINDOWEDMODE"));
        assert_eq!(layers_with(Some("~ RUNASADMIN"), FULLSCREEN_FLAG, true).as_deref(), Some("~ RUNASADMIN DISABLEDXMAXIMIZEDWINDOWEDMODE"));
        assert_eq!(layers_with(Some("~ RUNASADMIN DISABLEDXMAXIMIZEDWINDOWEDMODE"), FULLSCREEN_FLAG, false).as_deref(), Some("~ RUNASADMIN"));
        assert_eq!(layers_with(Some("~ DISABLEDXMAXIMIZEDWINDOWEDMODE"), FULLSCREEN_FLAG, false), None);
        // não repete a flag
        assert_eq!(layers_with(Some("~ disabledxmaximizedwindowedmode"), FULLSCREEN_FLAG, true).as_deref(), Some("~ DISABLEDXMAXIMIZEDWINDOWEDMODE"));
        assert!(gpu_is_high("GpuPreference=2;") && gpu_is_high("SwapEffectUpgradeEnable=1;GpuPreference=2;"));
        assert!(!gpu_is_high("GpuPreference=1;"));
    }

    #[test]
    fn description() {
        let d = describe(&OptimizeOptions::default());
        assert!(d.starts_with("Limite de 100 FPS (o do jogo) nas partidas, 60 FPS nas partidas com mais de 8 jogadores"), "{d}");
        assert!(d.ends_with("Não remove nada do jogo."));
    }

    /// Monta com os arquivos reais do jogo (`CP_GAMEDATA` = pasta com `uncompiled_lua.scd`).
    #[test]
    fn real_game_build() {
        let Some(dir) = std::env::var_os("CP_GAMEDATA") else { return };
        let src = PathBuf::from(dir).join("uncompiled_lua.scd");
        let out = std::env::temp_dir().join("cp_opt_test.scd");
        build(&[src], &OptimizeOptions::default(), &out).unwrap();
        if let Some(dest) = std::env::var_os("CP_OPT_OUT") {
            let mut z = zip::ZipArchive::new(std::fs::File::open(&out).unwrap()).unwrap();
            let mut f = z.by_name("lua/ui/uimain.lua").unwrap();
            let mut s = String::new();
            std::io::Read::read_to_string(&mut f, &mut s).unwrap();
            std::fs::write(PathBuf::from(dest).join("uimain.lua"), s).unwrap();
        }
        let _ = std::fs::remove_file(out);
    }
}
