use std::path::PathBuf;

/// Erros do núcleo. As mensagens são em pt-BR porque chegam direto na interface.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("erro de E/S em {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("arquivo .scd inválido ({path}): {reason}")]
    Archive { path: PathBuf, reason: String },
    #[error("JSON inválido em {path}: {source}")]
    Json {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },
    #[error("instalação do jogo não encontrada")]
    GameNotFound,
    #[error("o jogo está aberto — feche o Supreme Commander 2 antes de alterar os arquivos")]
    GameRunning,
    #[error("mod não encontrado: {0}")]
    ModNotFound(String),
    #[error("perfil não encontrado: {0}")]
    ProfileNotFound(String),
    #[error("manifesto de mod inválido: {0}")]
    Manifest(String),
    #[error("conflito: {0}")]
    Conflict(String),
    #[error("integridade: {0}")]
    Integrity(String),
    #[error("formato não suportado: {0}")]
    Format(String),
    #[error("rede: {0}")]
    Network(String),
    #[error("{0}")]
    Other(String),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        Error::Io {
            path: path.into(),
            source,
        }
    }
    pub fn archive(path: impl Into<PathBuf>, reason: impl ToString) -> Self {
        Error::Archive {
            path: path.into(),
            reason: reason.to_string(),
        }
    }
}

/// Extensão para anexar o caminho a erros de E/S.
pub trait IoContext<T> {
    fn at(self, path: impl Into<PathBuf>) -> Result<T>;
}

impl<T> IoContext<T> for std::io::Result<T> {
    fn at(self, path: impl Into<PathBuf>) -> Result<T> {
        self.map_err(|e| Error::io(path, e))
    }
}

impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
