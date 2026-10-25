//! Mod de trapaças para jogar sozinho: massa, energia e pesquisa infinitas, tudo pesquisado,
//! unidades invencíveis e construção mais rápida, com um **menu dentro do jogo** (uma tecla abre e
//! fecha) para ligar e desligar cada uma a qualquer momento da partida.
//!
//! O mod é montado na hora com os arquivos do próprio jogo do usuário (texto, de
//! `uncompiled_lua.scd`); nada do jogo é distribuído:
//! - `simInit.lua` leva o código das trapaças no fim e `BeginSession` inicia `CPCheatsRun`;
//! - `SimCallbacks.lua` ganha o comando `CPCheats`, que o menu usa para avisar a simulação;
//! - `gamemain_pc.lua` (a tela da partida no PC) leva o código do menu no fim e `OnFirstUpdate`
//!   chama `CPMenuInit` (o `gamemain.lua` não serve: o jogo monta a tela direto pelo `_pc`);
//! - `UserSync.lua` também chama `CPMenuInit` quando a simulação avisa que as trapaças ligaram.
//!
//! O código vai **dentro** desses arquivos (e não em arquivos novos) porque o jogo só entrega os
//! caminhos que estão no índice dele (`toc.win.bdf`): um `import` de um arquivo novo não é achado.
//!
//! As trapaças só valem com um único jogador humano: em multiplayer a simulação ignora tudo e o
//! menu nem aparece.

use crate::error::{Error, Result};
use crate::mapassets::read_game_file;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Teclas livres no mapa padrão do jogo que o menu pode usar.
pub const MENU_KEYS: &[&str] = &["F3", "F4", "F8", "F11", "Insert", "Home"];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct CheatOptions {
    /// massa sempre cheia
    pub mass: bool,
    /// energia sempre cheia
    pub energy: bool,
    /// pontos de pesquisa sem fim
    pub research: bool,
    /// toda a árvore de pesquisa liberada no começo
    pub unlock_all: bool,
    /// unidades e prédios invencíveis
    pub god: bool,
    /// multiplicador da velocidade de construção (1 = normal)
    pub build_speed: f32,
    /// a IA também ganha as trapaças (desafio: IA "trapaceira")
    pub ai_too: bool,
    /// menu dentro do jogo para ligar e desligar durante a partida
    pub menu: bool,
    /// tecla que abre o menu (uma de [`MENU_KEYS`])
    pub key: String,
    /// botão "CP" na borda esquerda da tela que também abre o menu
    pub tab: bool,
}

impl Default for CheatOptions {
    fn default() -> Self {
        CheatOptions {
            mass: true,
            energy: true,
            research: true,
            unlock_all: false,
            god: true,
            build_speed: 1.0,
            ai_too: false,
            menu: true,
            key: "F3".into(),
            tab: true,
        }
    }
}

impl CheatOptions {
    fn menu_key(&self) -> &str {
        MENU_KEYS.iter().copied().find(|k| k.eq_ignore_ascii_case(&self.key)).unwrap_or("F3")
    }
}

const SIM_LUA: &str = include_str!("cheats_sim.lua");
const UI_LUA: &str = include_str!("cheats_ui.lua");

fn fill(template: &str, o: &CheatOptions) -> String {
    let b = |v: bool| if v { "true" } else { "false" };
    let speed = o.build_speed.clamp(1.0, 50.0);
    template
        .replace("@MASS@", b(o.mass))
        .replace("@ENERGY@", b(o.energy))
        .replace("@RESEARCH@", b(o.research))
        .replace("@GOD@", b(o.god))
        .replace("@SPEED@", &format!("{speed}"))
        .replace("@AI@", b(o.ai_too))
        .replace("@UNLOCK@", b(o.unlock_all))
        .replace("@KEY@", o.menu_key())
        .replace("@TAB@", b(o.tab))
}

/// O script da simulação (Lua do jogo: `for k, v in tabela do`, `table.getn`).
pub fn cheats_lua(o: &CheatOptions) -> String {
    fill(SIM_LUA, o)
}

/// O script do menu dentro do jogo.
pub fn menu_lua(o: &CheatOptions) -> String {
    fill(UI_LUA, o)
}

const MARK: &str = "CommandProject cheats";
const SIM_HOOK: &str = "\tForkThread(CPCheatsRun) -- CommandProject cheats\n";
/// Comandos da interface para a simulação, iguais em todos os mods do CommandProject: o jogo usa o
/// `SimCallbacks.lua` de um só mod (o último a carregar), então cada um leva os comandos de todos.
pub const SHARED_CALLBACKS: &str = "
-- CommandProject callbacks (the same in every CommandProject mod: any of them may provide this file)
Callbacks.CPCheats = function(data) if CPCheatsSet then CPCheatsSet(data) end end
Callbacks.CPAIMemory = function(data)
    local ok, m = pcall(import, '/lua/ai/skirmish/system/skirmishaisystem.lua')
    if ok and m and m.CPAIReceiveMemory then m.CPAIReceiveMemory(data) end
end
Callbacks.CPAIForget = function(data)
    local ok, m = pcall(import, '/lua/ai/skirmish/system/skirmishaisystem.lua')
    if ok and m and m.CPAIForgetModel then m.CPAIForgetModel() end
end
";
const UI_HOOK: &str = "\tpcall(CPMenuInit, false) -- CommandProject cheats\n";
const SYNC_HOOK: &str = "\tif Sync.CPCheats then pcall(import('/lua/ui/game/gamemain_pc.lua').CPMenuInit, false) end -- CommandProject cheats\n";

fn append(text: &str, code: &str) -> String {
    let mut out = text.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push('\n');
    out.push_str(code);
    out
}

/// `simInit.lua` do jogo com o código das trapaças (`sim`) no fim e a linha que o inicia.
pub fn patch_sim_init(text: &str, sim: &str) -> Result<String> {
    if text.contains(MARK) {
        return Err(Error::Other("o simInit.lua do jogo já tem as trapaças: use o original do jogo".into()));
    }
    // depois de tudo montado: logo antes do placar começar a contar
    let anchors = [
        "ForkThread(import('/lua/sim/aibrain.lua').CollectCurrentScores)",
        "ForkThread(import('/lua/sim/victory.lua').CheckVictory",
    ];
    for a in anchors {
        if let Some(p) = text.find(a) {
            let line = text[..p].rfind('\n').map(|i| i + 1).unwrap_or(0);
            return Ok(append(&format!("{}{SIM_HOOK}{}", &text[..line], &text[line..]), sim));
        }
    }
    // plano B: primeira linha de BeginSession
    if let Some(p) = text.find("function BeginSession()") {
        let end = text[p..].find('\n').map(|i| p + i + 1).unwrap_or(text.len());
        return Ok(append(&format!("{}{SIM_HOOK}{}", &text[..end], &text[end..]), sim));
    }
    Err(Error::Other("o simInit.lua do jogo não tem BeginSession: não deu para ligar as trapaças".into()))
}

/// `SimCallbacks.lua` com o comando que o menu usa.
pub fn patch_sim_callbacks(text: &str) -> Result<String> {
    if text.contains("CommandProject callbacks") {
        return Ok(text.to_string());
    }
    if !text.contains("local Callbacks = {}") {
        return Err(Error::Other("o SimCallbacks.lua do jogo é diferente do esperado: não deu para ligar o menu".into()));
    }
    let mut out = text.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(SHARED_CALLBACKS);
    Ok(out)
}

/// `gamemain_pc.lua` (a tela da partida no PC) com o código do menu (`ui`) no fim, aberto quando
/// a partida aparece na tela (`OnFirstUpdate`).
pub fn patch_game_main(text: &str, ui: &str) -> Result<String> {
    if text.contains(MARK) {
        return Err(Error::Other("o gamemain_pc.lua do jogo já tem o menu: use o original do jogo".into()));
    }
    let missing = || Error::Other("o gamemain_pc.lua do jogo é diferente do esperado: não deu para ligar o menu".into());
    let p = text.find("function OnFirstUpdate()").ok_or_else(missing)?;
    // o `end` que fecha a função fica sozinho no começo da linha
    let close = text[p..].find("\nend").map(|i| p + i + 1).ok_or_else(missing)?;
    Ok(append(&format!("{}{UI_HOOK}{}", &text[..close], &text[close..]), ui))
}

/// `UserSync.lua` abrindo o menu quando a simulação avisa que as trapaças ligaram (garante o menu
/// mesmo se a montagem da tela não passar pelo gancho de `gamemain_pc.lua`).
pub fn patch_user_sync(text: &str) -> Result<String> {
    if text.contains(MARK) {
        return Err(Error::Other("o UserSync.lua do jogo já tem o menu: use o original do jogo".into()));
    }
    let missing = || Error::Other("o UserSync.lua do jogo é diferente do esperado: não deu para ligar o menu".into());
    let p = text.find("function OnSync()").ok_or_else(missing)?;
    let close = text[p..].find("\nend").map(|i| p + i + 1).ok_or_else(missing)?;
    Ok(format!("{}{SYNC_HOOK}{}", &text[..close], &text[close..]))
}

fn game_text(sources: &[PathBuf], path: &str) -> Result<String> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let raw = read_game_file(sources, &format!("/uncompiled{path}")).map_err(|_| {
        Error::Other(format!("o jogo não tem o {name} em texto (uncompiled_lua.scd): não dá para montar as trapaças"))
    })?;
    if crate::lua::inspect(&raw).compiled {
        return Err(Error::Other(format!("o {name} do jogo está compilado: não dá para montar as trapaças")));
    }
    Ok(String::from_utf8_lossy(&raw).replace("\r\n", "\n"))
}

/// Monta o `.scd` do mod em `dest` com os arquivos do jogo do usuário (`sources`).
pub fn build(sources: &[PathBuf], opts: &CheatOptions, dest: &Path) -> Result<PathBuf> {
    let mut files: Vec<(&str, String)> = vec![
        ("lua/simInit.lua", patch_sim_init(&game_text(sources, "/lua/simInit.lua")?, &cheats_lua(opts))?),
        ("lua/sim/SimCallbacks.lua", patch_sim_callbacks(&game_text(sources, "/lua/sim/SimCallbacks.lua")?)?),
    ];
    if opts.menu {
        let main = game_text(sources, "/lua/ui/game/gamemain_pc.lua")?;
        files.push(("lua/ui/game/gamemain_pc.lua", patch_game_main(&main, &menu_lua(opts))?));
        files.push(("lua/UserSync.lua", patch_user_sync(&game_text(sources, "/lua/UserSync.lua")?)?));
    }
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    for (path, text) in &files {
        b.add_bytes(path, text.as_bytes())?;
    }
    b.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hook_goes_before_scores() {
        let src = "function BeginSession()\n\tlocal a = 1\n\t--start\n\tForkThread(import('/lua/sim/aibrain.lua').CollectCurrentScores)\nend\n";
        let out = patch_sim_init(src, "do\nfunction CPCheatsRun() end\nend\n").unwrap();
        assert!(out.find("ForkThread(CPCheatsRun)").unwrap() < out.find("CollectCurrentScores").unwrap());
        assert!(out.starts_with("function BeginSession()\n\tlocal a = 1\n\t--start\n\tForkThread(CPCheatsRun)"));
        assert!(out.ends_with("\n\ndo\nfunction CPCheatsRun() end\nend\n"));
        // já montado: recusa (precisa do original)
        assert!(patch_sim_init(&out, "x").is_err());
        // sem âncora: entra no começo de BeginSession
        let o2 = patch_sim_init("x = 1\nfunction BeginSession()\nend\n", "").unwrap();
        assert!(o2.contains("function BeginSession()\n\tForkThread(CPCheatsRun)"));
        assert!(patch_sim_init("nada aqui", "").is_err());
    }

    #[test]
    fn menu_hooks() {
        let cb = patch_sim_callbacks("local Callbacks = {}\nfunction DoCallback() end").unwrap();
        assert!(cb.contains("Callbacks.CPCheats = function(data) if CPCheatsSet then CPCheatsSet(data) end end\n"));
        assert!(cb.contains("Callbacks.CPAIMemory = function(data)"));
        assert_eq!(patch_sim_callbacks(&cb).unwrap(), cb);
        assert!(patch_sim_callbacks("x = 1").is_err());

        let gm = "function OnFirstUpdate()\n    if a then\n\t\tb()\n\tend\nend\n\nfunction X()\nend\n";
        let out = patch_game_main(gm, "do\nfunction CPMenuInit() end\nend\n").unwrap();
        assert!(out.contains("\tend\n\tpcall(CPMenuInit, false) -- CommandProject cheats\nend\n"));
        assert!(out.find("CPMenuInit, false").unwrap() < out.find("function X").unwrap());
        assert!(out.ends_with("function CPMenuInit() end\nend\n"));
        assert!(patch_game_main(&out, "").is_err());
    }

    #[test]
    fn options_in_scripts() {
        let o = CheatOptions { god: false, build_speed: 3.0, key: "insert".into(), ..Default::default() };
        let s = cheats_lua(&o);
        assert!(s.contains("God = false") && s.contains("BuildSpeed = 3,") && s.contains("Mass = true"));
        let m = menu_lua(&o);
        assert!(m.contains("local KEY = 'Insert'") && m.contains("local SHOW_TAB = true"));
        for t in [&s, &m] {
            assert!(!t.contains('@'), "marcador sem trocar");
            assert!(!t.contains('#'), "Lua do jogo não usa #");
            assert!(t.is_ascii(), "o jogo lê os scripts como bytes");
        }
        // tecla fora da lista volta para F3
        assert!(menu_lua(&CheatOptions { key: "Ctrl-A".into(), ..Default::default() }).contains("local KEY = 'F3'"));
    }

    #[test]
    fn builds_scd_from_game_files() {
        let tmp = tempfile::tempdir().unwrap();
        let src = tmp.path().join("uncompiled_lua.scd");
        crate::library::tests::make_scd(
            &src,
            &[
                (
                    "uncompiled\\lua\\simInit.lua",
                    b"function BeginSession()\r\n\tForkThread(import('/lua/sim/aibrain.lua').CollectCurrentScores)\r\nend\r\n",
                ),
                ("uncompiled\\lua\\sim\\SimCallbacks.lua", b"local Callbacks = {}\r\n"),
                ("uncompiled\\lua\\ui\\game\\gamemain_pc.lua", b"function OnFirstUpdate()\r\n\tx()\r\nend\r\n"),
                ("uncompiled\\lua\\UserSync.lua", b"Sync = {}\r\nfunction OnSync()\r\n    if a then\r\n    end\r\nend\r\n"),
            ],
        );
        let dest = tmp.path().join("out.scd");
        build(std::slice::from_ref(&src), &CheatOptions::default(), &dest).unwrap();
        let mut s = crate::scd::Scd::open(&dest).unwrap();
        let read = |s: &mut crate::scd::Scd, p: &str| String::from_utf8(s.read(p).unwrap()).unwrap();
        let init = read(&mut s, "lua/simInit.lua");
        assert!(init.contains("ForkThread(CPCheatsRun)") && init.contains("function CPCheatsSet(data)"));
        assert!(read(&mut s, "lua/sim/SimCallbacks.lua").contains("Callbacks.CPCheats"));
        let main = read(&mut s, "lua/ui/game/gamemain_pc.lua");
        assert!(main.contains("pcall(CPMenuInit, false)") && main.contains("function CPMenuToggle()"));
        // só arquivos que o jogo já tem no índice
        assert!(read(&mut s, "lua/UserSync.lua").contains("    end\n\tif Sync.CPCheats then pcall("));
        assert_eq!(s.entries().unwrap().len(), 4);

        // sem o menu, só a simulação
        let dest2 = tmp.path().join("out2.scd");
        build(&[src], &CheatOptions { menu: false, ..Default::default() }, &dest2).unwrap();
        let mut s2 = crate::scd::Scd::open(&dest2).unwrap();
        assert!(s2.read("lua/ui/game/gamemain_pc.lua").is_err());
    }
}
