//! Núcleo do CommandProject — launcher e hub de mods para Supreme Commander 2.
//!
//! Este crate não depende de interface gráfica: é usado pelo app Tauri e pela CLI `cp`.

pub mod aimod;
pub mod bigmatch;
pub mod anim;
pub mod blueprint;
pub mod cheats;
pub mod conflicts;
pub mod creator;
pub mod dds;
pub mod deploy;
pub mod enhance;
pub mod firstperson;
pub mod error;
pub mod fsutil;
pub mod game;
pub mod hashcache;
pub mod hub;
pub mod hubbuild;
pub mod laa;
pub mod library;
pub mod lua;
pub mod manifest;
pub mod mapassets;
pub mod maptk;
pub mod memory;
pub mod perf;
pub mod menu_theme;
pub mod optimize;
pub mod modelgen;
pub mod net;
pub mod profile;
pub mod scd;
pub mod scm;
pub mod settings;
pub mod shaders;
pub mod studio;
pub mod sync;
pub mod toc;
pub mod backup;
pub mod unitcheck;
pub mod unitmix;
pub mod units;
pub mod update;
pub mod ttf;
pub mod vdf;
pub mod workspace;

pub use error::{Error, Result};
