//! Configurações do launcher (`settings.json`).

use crate::error::Result;
use crate::fsutil::{read_json_or_default, write_json};
use crate::game::LaunchMode;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Pasta do jogo escolhida manualmente (vazio = detecção automática).
    pub game_path: Option<PathBuf>,
    pub launch_mode: LaunchMode,
    /// Argumentos extras (só no modo direto).
    pub launch_args: Vec<String>,
    /// Aplica o perfil ativo automaticamente antes de jogar.
    pub apply_before_launch: bool,
    /// Ao fechar o jogo, devolve a pasta ao estado original (útil para jogar sem mods
    /// pela Steam depois, ou para manter a verificação de arquivos da Steam limpa).
    pub restore_on_exit: bool,
    /// Índices de hub de mods (JSON). O primeiro é tratado como o hub principal.
    pub hub_urls: Vec<String>,
    /// Python para o Estúdio de Mapas (vazio = embutido ou o do sistema).
    pub python_path: Option<PathBuf>,
    /// Verificar atualizações de mods ao abrir.
    pub check_mod_updates: bool,
    /// Primeira execução concluída (assistente de boas-vindas).
    pub onboarded: bool,
    /// Servidor da comunidade (`cp-server`): salas, chat e hub. Ex.: `https://sc2.exemplo.com`.
    pub server_url: Option<String>,
    /// Apelido usado nas salas e no chat.
    pub nickname: String,
    /// Avisar quando sair uma versão nova do launcher (GitHub Releases).
    pub check_app_updates: bool,
    /// Manter o "modo 4 GB" (Large Address Aware): reaplica antes de jogar se a Steam restaurar o .exe.
    pub keep_large_address: bool,
    /// Unidade mostrada em 3D na tela inicial (`None` = Comandante).
    pub showcase_unit: Option<String>,
    /// Mostrar o modelo 3D na tela inicial.
    pub showcase: bool,
    /// Teto de memória do jogo em MB (2048 a 4096). `None` = segue `keep_large_address`.
    pub memory_limit_mb: Option<u32>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            game_path: None,
            launch_mode: LaunchMode::Steam,
            launch_args: vec![],
            apply_before_launch: true,
            restore_on_exit: false,
            hub_urls: vec![],
            python_path: None,
            check_mod_updates: true,
            onboarded: false,
            server_url: None,
            nickname: String::new(),
            check_app_updates: true,
            keep_large_address: false,
            showcase_unit: None,
            showcase: true,
            memory_limit_mb: None,
        }
    }
}

impl Settings {
    /// Teto de memória em vigor (MB).
    pub fn memory_mb(&self) -> u32 {
        match self.memory_limit_mb {
            Some(mb) => crate::memory::normalize_mb(mb),
            None if self.keep_large_address => crate::memory::MAX_MB,
            None => crate::memory::MIN_MB,
        }
    }

    pub fn load(path: &Path) -> Result<Self> {
        read_json_or_default(path)
    }
    pub fn save(&self, path: &Path) -> Result<()> {
        write_json(path, self)
    }
}
