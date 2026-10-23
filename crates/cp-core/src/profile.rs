//! Perfis: conjuntos nomeados de mods ativos, com ordem de carga.

use crate::error::{Error, Result};
use crate::fsutil::{read_json_or_default, slugify, write_json};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMod {
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// Ordem de carga: em caso de dois mods fornecerem o mesmo arquivo, o último vence.
    pub mods: Vec<ProfileMod>,
    #[serde(default)]
    pub notes: String,
}

impl Profile {
    pub fn enabled_ids(&self) -> Vec<String> {
        self.mods.iter().filter(|m| m.enabled).map(|m| m.id.clone()).collect()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSet {
    pub active: String,
    pub profiles: Vec<Profile>,
}

impl Default for ProfileSet {
    fn default() -> Self {
        ProfileSet {
            active: "padrao".into(),
            profiles: vec![Profile {
                id: "padrao".into(),
                name: "Padrão".into(),
                mods: vec![],
                notes: String::new(),
            }],
        }
    }
}

pub struct Profiles {
    path: PathBuf,
    pub set: ProfileSet,
}

impl Profiles {
    pub fn load(path: &Path) -> Result<Self> {
        let mut set: ProfileSet = read_json_or_default(path)?;
        if set.profiles.is_empty() {
            set = ProfileSet::default();
        }
        if !set.profiles.iter().any(|p| p.id == set.active) {
            set.active = set.profiles[0].id.clone();
        }
        Ok(Profiles {
            path: path.to_path_buf(),
            set,
        })
    }

    pub fn save(&self) -> Result<()> {
        write_json(&self.path, &self.set)
    }

    pub fn active(&self) -> &Profile {
        self.set
            .profiles
            .iter()
            .find(|p| p.id == self.set.active)
            .expect("perfil ativo existe")
    }

    pub fn get(&self, id: &str) -> Result<&Profile> {
        self.set
            .profiles
            .iter()
            .find(|p| p.id == id)
            .ok_or_else(|| Error::ProfileNotFound(id.into()))
    }

    fn get_mut(&mut self, id: &str) -> Result<&mut Profile> {
        self.set
            .profiles
            .iter_mut()
            .find(|p| p.id == id)
            .ok_or_else(|| Error::ProfileNotFound(id.into()))
    }

    pub fn set_active(&mut self, id: &str) -> Result<()> {
        self.get(id)?;
        self.set.active = id.to_string();
        self.save()
    }

    /// Cria um perfil (opcionalmente copiando outro).
    pub fn create(&mut self, name: &str, copy_from: Option<&str>) -> Result<Profile> {
        let base = slugify(name);
        let mut id = base.clone();
        let mut n = 2;
        while self.set.profiles.iter().any(|p| p.id == id) {
            id = format!("{base}-{n}");
            n += 1;
        }
        let mods = match copy_from {
            Some(src) => self.get(src)?.mods.clone(),
            None => vec![],
        };
        let p = Profile {
            id,
            name: name.trim().to_string(),
            mods,
            notes: String::new(),
        };
        self.set.profiles.push(p.clone());
        self.save()?;
        Ok(p)
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<()> {
        self.get_mut(id)?.name = name.trim().to_string();
        self.save()
    }

    pub fn delete(&mut self, id: &str) -> Result<()> {
        if self.set.profiles.len() <= 1 {
            return Err(Error::Other("não dá para apagar o único perfil".into()));
        }
        self.get(id)?;
        self.set.profiles.retain(|p| p.id != id);
        if self.set.active == id {
            self.set.active = self.set.profiles[0].id.clone();
        }
        self.save()
    }

    /// Liga/desliga um mod no perfil (adiciona ao fim da ordem se ainda não estiver).
    pub fn set_enabled(&mut self, profile: &str, mod_id: &str, enabled: bool) -> Result<()> {
        let p = self.get_mut(profile)?;
        match p.mods.iter_mut().find(|m| m.id == mod_id) {
            Some(m) => m.enabled = enabled,
            None => p.mods.push(ProfileMod {
                id: mod_id.into(),
                enabled,
            }),
        }
        self.save()
    }

    /// Define a ordem de carga completa (ids desconhecidos são ignorados, faltantes vão ao fim).
    pub fn reorder(&mut self, profile: &str, order: &[String]) -> Result<()> {
        let p = self.get_mut(profile)?;
        let mut new = Vec::with_capacity(p.mods.len());
        for id in order {
            if let Some(pos) = p.mods.iter().position(|m| &m.id == id) {
                new.push(p.mods.remove(pos));
            }
        }
        new.append(&mut p.mods);
        p.mods = new;
        self.save()
    }

    /// Remove referências a um mod apagado em todos os perfis.
    pub fn forget_mod(&mut self, mod_id: &str) -> Result<()> {
        for p in &mut self.set.profiles {
            p.mods.retain(|m| m.id != mod_id);
        }
        self.save()
    }

    /// Substitui a lista de mods de um perfil (usado ao aplicar um código de sincronização).
    pub fn replace_mods(&mut self, profile: &str, mods: Vec<ProfileMod>) -> Result<()> {
        self.get_mut(profile)?.mods = mods;
        self.save()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crud_and_order() {
        let t = tempfile::tempdir().unwrap();
        let path = t.path().join("profiles.json");
        let mut p = Profiles::load(&path).unwrap();
        assert_eq!(p.active().id, "padrao");
        p.set_enabled("padrao", "a", true).unwrap();
        p.set_enabled("padrao", "b", true).unwrap();
        p.set_enabled("padrao", "c", false).unwrap();
        p.reorder("padrao", &["c".into(), "a".into()]).unwrap();
        let ids: Vec<_> = p.active().mods.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["c", "a", "b"]);
        assert_eq!(p.active().enabled_ids(), ["a", "b"]);

        let comp = p.create("Competitivo", Some("padrao")).unwrap();
        assert_eq!(comp.id, "competitivo");
        assert_eq!(p.create("Competitivo", None).unwrap().id, "competitivo-2");
        p.set_active("competitivo").unwrap();
        let again = Profiles::load(&path).unwrap();
        assert_eq!(again.active().mods.len(), 3);
        p.forget_mod("a").unwrap();
        assert!(p.get("padrao").unwrap().mods.iter().all(|m| m.id != "a"));
        p.delete("competitivo").unwrap();
        assert_eq!(p.set.active, "padrao");
    }
}
