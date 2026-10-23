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
    /// Índices de hub de mods (JSON). O primeiro é o hub oficial do Project Club.
    pub hub_urls: Vec<String>,
    /// Python para o Estúdio de Mapas (vazio = embutido ou o do sistema).
    pub python_path: Option<PathBuf>,
    /// Verificar atualizações de mods ao abrir.
    pub check_mod_updates: bool,
    /// Primeira execução concluída (assistente de boas-vindas).
    pub onboarded: bool,
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
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Result<Self> {
        read_json_or_default(path)
    }
    pub fn save(&self, path: &Path) -> Result<()> {
        write_json(path, self)
    }
}
