//! Mod "Primeira Pessoa": câmera e controle direto de unidades, robôs, construtores e grupos.
//!
//! Montado na hora com os arquivos do próprio jogo do usuário (texto, de `uncompiled_lua.scd`):
//! - `/lua/ui/game/worldview.lua` (a vista do mundo da partida) leva o código da interface no fim e
//!   `CreateMainWorldView` chama `CPFirstPersonInit`: a tecla escolhida (F5) alterna a câmera
//!   estratégica, a primeira pessoa (a câmera do jogo colada na unidade, na altura dos olhos, virando
//!   com ela), a terceira pessoa (atrás da unidade, girando com os controles do próprio jogo) e a
//!   câmera de comando de um grupo (acima e atrás da formação). Tudo com `Camera:SnapTo` a cada
//!   quadro; o `Camera:NoseCam` do motor não é usado (está inacabado e fecha o jogo);
//! - `/lua/SimSync.lua` (simulação) leva `CPFirstPersonSim`: andar na direção da câmera, parar e
//!   atirar, só com unidades do exército que mandou o comando (vale em multiplayer);
//! - `/lua/sim/SimCallbacks.lua` com os comandos de todos os mods do CommandProject
//!   ([`crate::cheats::SHARED_CALLBACKS`]): o jogo usa o arquivo de um só mod (o último na ordem), e
//!   o deste mod se chama `zz_cp_zz_…` para vir por último e levar o comando novo.
//!
//! O resto continua do jogo: ordens com o botão direito, habilidades, o menu de construção e o
//! posicionamento dos prédios funcionam de qualquer câmera, com os modelos, animações e armas de
//! cada unidade. Sem nada selecionado, a tecla continua com a função original dela.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

/// Teclas que o mod pode usar para alternar a câmera.
pub const FP_KEYS: &[&str] = &["F5", "F6", "F7", "F8", "F11", "Home", "Insert"];
/// Versão do mod: o launcher remonta sozinho uma cópia instalada de outra versão (a 1.0 fechava o
/// jogo no F5). Suba junto com `FP_VERSION` em `src/components/dialogs.tsx`.
pub const MOD_VERSION: &str = "1.2.0";
/// Nome do arquivo do mod (o último na ordem de montagem: o `SimCallbacks.lua` dele vale).
pub const ARCHIVE: &str = "zz_cp_zz_primeira_pessoa.scd";

const UI_CODE: &str = include_str!("firstperson_ui.lua");
const SIM_CODE: &str = include_str!("firstperson_sim.lua");
const MARK: &str = "CommandProject: first person";
const UI_HOOK: &str = "    pcall(CPFirstPersonInit) -- CommandProject first person\n";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FirstPersonOptions {
    /// tecla que alterna as câmeras (uma de [`FP_KEYS`])
    pub key: String,
    /// mira, nome, vida e teclas na tela
    pub hud: bool,
    /// W A S D, Q/E, F, X e R controlam a unidade enquanto a câmera está ligada
    pub drive: bool,
    /// distância da câmera em primeira pessoa quando o motor não informa a mínima
    pub first_zoom: f32,
    /// distância da câmera em terceira pessoa
    pub third_zoom: f32,
}

impl Default for FirstPersonOptions {
    fn default() -> Self {
        FirstPersonOptions { key: "F5".into(), hud: true, drive: true, first_zoom: 14.0, third_zoom: 38.0 }
    }
}

fn lua_num(v: f32) -> String {
    let v = if v.is_finite() { v } else { 0.0 };
    format!("{:.1}", v)
}

/// Código da interface com as opções.
pub fn ui_lua(o: &FirstPersonOptions) -> Result<String> {
    if !FP_KEYS.contains(&o.key.as_str()) {
        return Err(Error::Other(format!("tecla inválida: {} (use {})", o.key, FP_KEYS.join(", "))));
    }
    Ok(UI_CODE
        .replace("@KEY@", &o.key)
        .replace("@HUD@", if o.hud { "true" } else { "false" })
        .replace("@DRIVE@", if o.drive { "true" } else { "false" })
        .replace("@FIRST_ZOOM@", &lua_num(o.first_zoom.clamp(4.0, 60.0)))
        .replace("@THIRD_ZOOM@", &lua_num(o.third_zoom.clamp(10.0, 200.0))))
}

fn append(text: &str, code: &str) -> String {
    let mut out = text.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push('\n');
    out.push_str(code);
    out
}

/// `worldview.lua` com a chamada no fim de `CreateMainWorldView` e o código no fim do arquivo.
pub fn patch_world_view(text: &str, code: &str) -> Result<String> {
    if text.contains(MARK) || text.contains("CommandProject first person") {
        return Err(Error::Other("o worldview.lua do jogo já tem a primeira pessoa: use o original do jogo".into()));
    }
    let start = text
        .find("function CreateMainWorldView(")
        .ok_or_else(|| Error::Other("o worldview.lua do jogo não tem CreateMainWorldView: não deu para ligar a primeira pessoa".into()))?;
    // o "end" da função: a primeira linha "end" sem recuo depois do começo dela
    let rel = text[start..]
        .match_indices("\nend")
        .find(|(i, _)| {
            let after = &text[start + i + 4..];
            after.is_empty() || after.starts_with('\n') || after.starts_with('\r') || after.starts_with(' ') || after.starts_with('\t')
        })
        .map(|(i, _)| i)
        .ok_or_else(|| Error::Other("o worldview.lua do jogo tem um formato inesperado".into()))?;
    let at = start + rel + 1;
    Ok(append(&format!("{}{UI_HOOK}{}", &text[..at], &text[at..]), code))
}

/// `SimSync.lua` com o código da simulação no fim.
pub fn patch_sim_sync(text: &str) -> Result<String> {
    if text.contains("CPFirstPersonSim") {
        return Err(Error::Other("o SimSync.lua do jogo já tem a primeira pessoa: use o original do jogo".into()));
    }
    Ok(append(text, SIM_CODE))
}

/// Monta o `.scd` do mod em `dest` com os arquivos do jogo do usuário (`sources`).
pub fn build(sources: &[PathBuf], opts: &FirstPersonOptions, dest: &Path) -> Result<PathBuf> {
    let what = "a primeira pessoa";
    let view = crate::cheats::game_text_for(sources, "/lua/ui/game/worldview.lua", what)?;
    let sync = crate::cheats::game_text_for(sources, "/lua/SimSync.lua", what)?;
    let callbacks = crate::cheats::game_text_for(sources, "/lua/sim/SimCallbacks.lua", what)?;
    let files = [
        ("lua/ui/game/worldview.lua", patch_world_view(&view, &ui_lua(opts)?)?),
        ("lua/SimSync.lua", patch_sim_sync(&sync)?),
        ("lua/sim/SimCallbacks.lua", crate::cheats::patch_sim_callbacks(&callbacks)?),
    ];
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    for (path, text) in &files {
        b.add_bytes(path, text.as_bytes())?;
    }
    b.finish()
}

/// Resumo para a biblioteca.
pub fn describe(o: &FirstPersonOptions) -> String {
    format!(
        "Selecione uma unidade e aperte {k}: câmera em primeira pessoa, depois atrás da unidade; com várias selecionadas, câmera de comando do grupo.{d} Construtores constroem pelo menu normal em qualquer câmera. Sem nada selecionado, {k} continua com a função original.",
        k = o.key,
        d = if o.drive { " W A S D andam como num jogo de ação (para onde a câmera olha), botão do meio + mouse (ou Q/E) olham em volta, F atira no alvo do mouse, X para, R troca 1ª/3ª pessoa, Esc volta." } else { "" }
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIEW: &str = "local UIUtil = 1\n\nfunction CreateMainWorldView(parent, mapGroup, mapGroupRight)    \n    if viewLeft then\n        viewLeft = false\n    end\n    import('/lua/ui/game/multifunction.lua').RefreshMapDialog()\nend\n\nfunction Expand()\nend\n";

    #[test]
    fn hooks_world_view() {
        let out = patch_world_view(VIEW, "-- code\n").unwrap();
        assert!(out.contains("RefreshMapDialog()\n    pcall(CPFirstPersonInit) -- CommandProject first person\nend\n\nfunction Expand()"), "{out}");
        assert!(out.ends_with("end\n\n-- code\n"));
        assert!(patch_world_view(&out, "").is_err());
        assert!(patch_world_view("nada", "").is_err());
    }

    #[test]
    fn options_go_into_the_code() {
        let lua = ui_lua(&FirstPersonOptions { key: "F6".into(), hud: false, ..Default::default() }).unwrap();
        assert!(lua.contains("local KEY = 'F6'") && lua.contains("local SHOW_HUD = false") && lua.contains("local DRIVE_KEYS = true"));
        assert!(lua.contains("local FIRST_ZOOM = 14.0") && lua.contains("local THIRD_ZOOM = 38.0"));
        assert!(!lua.contains('@'), "marcador sobrando");
        assert!(ui_lua(&FirstPersonOptions { key: "F10".into(), ..Default::default() }).is_err());
        let sim = patch_sim_sync("function ResetSyncTable()\nend\n").unwrap();
        assert!(sim.contains("function CPFirstPersonSim(data, units)"));
        assert!(patch_sim_sync(&sim).is_err());
        assert!(describe(&FirstPersonOptions::default()).contains("F5"));
    }

    /// Monta com os arquivos reais do jogo (`CP_GAMEDATA` = pasta com `uncompiled_lua.scd`;
    /// `CP_FP_OUT` = pasta onde gravar o .scd e os .lua montados).
    #[test]
    fn real_game_build() {
        let Some(dir) = std::env::var_os("CP_GAMEDATA") else { return };
        let src = PathBuf::from(dir).join("uncompiled_lua.scd");
        let out = std::env::var_os("CP_FP_OUT").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let scd = out.join(ARCHIVE);
        build(&[src], &FirstPersonOptions::default(), &scd).unwrap();
        let mut z = zip::ZipArchive::new(std::fs::File::open(&scd).unwrap()).unwrap();
        for name in ["lua/ui/game/worldview.lua", "lua/SimSync.lua", "lua/sim/SimCallbacks.lua"] {
            let mut f = z.by_name(name).unwrap();
            let mut s = String::new();
            std::io::Read::read_to_string(&mut f, &mut s).unwrap();
            assert!(s.contains("CPFirstPerson"), "{name}");
            if std::env::var_os("CP_FP_OUT").is_some() {
                std::fs::write(out.join(name.rsplit('/').next().unwrap()), s).unwrap();
            }
        }
    }
}
