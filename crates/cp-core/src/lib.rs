//! Núcleo do CommandProject — launcher e hub de mods para Supreme Commander 2.
//!
//! Este crate não depende de interface gráfica: é usado pelo app Tauri e pela CLI `cp`.

pub mod conflicts;
pub mod dds;
pub mod deploy;
pub mod error;
pub mod fsutil;
pub mod game;
pub mod hashcache;
pub mod hub;
pub mod library;
pub mod lua;
pub mod manifest;
pub mod maptk;
pub mod profile;
pub mod scd;
pub mod scm;
pub mod settings;
pub mod studio;
pub mod sync;
pub mod vdf;
pub mod workspace;

pub use error::{Error, Result};
