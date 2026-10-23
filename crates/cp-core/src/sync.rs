//! Multiplayer: o SC2 roda em lockstep — todos na partida precisam dos mesmos arquivos,
//! byte a byte. Este módulo gera:
//!
//! * **Assinatura** da pasta `gamedata` (ex.: `7F3A-91C2-0B5E`) — se duas pessoas têm a
//!   mesma assinatura, os arquivos são idênticos e a partida não vai dessincronizar.
//! * **Código de sincronização** (`CP1-...`) — descreve o perfil (mods, versões e hashes)
//!   para um amigo colar no launcher dele e ficar igual.

use crate::error::{Error, Result};
use crate::library::Library;
use crate::profile::Profile;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Fingerprint {
    /// Código curto para comparar de boca/no chat.
    pub code: String,
    pub full: String,
    pub files: Vec<(String, String)>,
}

/// Assinatura a partir de pares (nome, sha256) — ordem e maiúsculas não importam.
pub fn fingerprint(files: &[(String, String)]) -> Fingerprint {
    let mut sorted: Vec<(String, String)> = files
        .iter()
        .map(|(n, h)| (n.to_ascii_lowercase(), h.to_ascii_lowercase()))
        .collect();
    sorted.sort();
    let mut text = String::new();
    for (n, h) in &sorted {
        text.push_str(n);
        text.push('\t');
        text.push_str(h);
        text.push('\n');
    }
    let full = crate::fsutil::sha256_bytes(text.as_bytes());
    let up = full[..12].to_ascii_uppercase();
    let code = format!("{}-{}-{}", &up[0..4], &up[4..8], &up[8..12]);
    Fingerprint {
        code,
        full,
        files: sorted,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncMod {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hub_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// (nome do arquivo, sha256)
    pub files: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncPayload {
    pub v: u32,
    pub profile: String,
    pub mods: Vec<SyncMod>,
    /// Assinatura completa da pasta de quem gerou (para conferir depois de aplicar).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
}

const PREFIX: &str = "CP1-";
const MAX_CODE_LEN: usize = 64 * 1024;

pub fn encode(payload: &SyncPayload) -> Result<String> {
    let json = serde_json::to_vec(payload).map_err(|e| Error::Other(e.to_string()))?;
    let mut z = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::best());
    z.write_all(&json).map_err(|e| Error::Other(e.to_string()))?;
    let packed = z.finish().map_err(|e| Error::Other(e.to_string()))?;
    Ok(format!(
        "{PREFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(packed)
    ))
}

pub fn decode(code: &str) -> Result<SyncPayload> {
    let code = code.trim();
    if code.len() > MAX_CODE_LEN {
        return Err(Error::Other("código de sincronização grande demais".into()));
    }
    let body = code
        .strip_prefix(PREFIX)
        .ok_or_else(|| Error::Other("isso não é um código do CommandProject (deve começar com CP1-)".into()))?;
    let packed = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body.trim())
        .map_err(|_| Error::Other("código corrompido (base64 inválido)".into()))?;
    let mut json = Vec::new();
    flate2::read::DeflateDecoder::new(&packed[..])
        .take(4 * 1024 * 1024)
        .read_to_end(&mut json)
        .map_err(|_| Error::Other("código corrompido".into()))?;
    let p: SyncPayload =
        serde_json::from_slice(&json).map_err(|_| Error::Other("código corrompido (conteúdo)".into()))?;
    if p.v != 1 {
        return Err(Error::Other(format!(
            "versão de código {} não suportada — atualize o launcher",
            p.v
        )));
    }
    Ok(p)
}

pub fn payload_for(library: &Library, profile: &Profile, fingerprint: Option<String>) -> Result<SyncPayload> {
    let mut mods = Vec::new();
    for id in profile.enabled_ids() {
        let m = library.get(&id)?;
        mods.push(SyncMod {
            id: m.manifest.id.clone(),
            name: m.manifest.name.clone(),
            version: m.manifest.version.clone(),
            hub_id: m.manifest.source.hub_id.clone(),
            url: m.manifest.source.url.clone().or(m.manifest.homepage.clone()),
            files: m
                .manifest
                .files
                .iter()
                .map(|f| (f.name.clone(), f.sha256.clone()))
                .collect(),
        });
    }
    Ok(SyncPayload {
        v: 1,
        profile: profile.name.clone(),
        mods,
        fingerprint,
    })
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncItem {
    pub id: String,
    pub name: String,
    pub version: String,
    /// "ok" (igual), "different" (instalado com outros arquivos), "missing" (não instalado)
    pub state: String,
    pub installed_version: Option<String>,
    pub hub_id: Option<String>,
    pub url: Option<String>,
}

/// Compara o código recebido com a biblioteca local.
pub fn compare(library: &Library, p: &SyncPayload) -> Vec<SyncItem> {
    p.mods
        .iter()
        .map(|sm| {
            let (state, installed_version) = match library.get(&sm.id) {
                Err(_) => ("missing", None),
                Ok(m) => {
                    let mut ours: Vec<(String, String)> = m
                        .manifest
                        .files
                        .iter()
                        .map(|f| (f.name.to_ascii_lowercase(), f.sha256.to_ascii_lowercase()))
                        .collect();
                    let mut theirs: Vec<(String, String)> = sm
                        .files
                        .iter()
                        .map(|(n, h)| (n.to_ascii_lowercase(), h.to_ascii_lowercase()))
                        .collect();
                    ours.sort();
                    theirs.sort();
                    (
                        if ours == theirs { "ok" } else { "different" },
                        Some(m.manifest.version),
                    )
                }
            };
            SyncItem {
                id: sm.id.clone(),
                name: sm.name.clone(),
                version: sm.version.clone(),
                state: state.into(),
                installed_version,
                hub_id: sm.hub_id.clone(),
                url: sm.url.clone(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fingerprint_is_order_and_case_insensitive() {
        let a = fingerprint(&[("Lua.scd".into(), "AB".into()), ("maps.scd".into(), "cd".into())]);
        let b = fingerprint(&[("maps.scd".into(), "CD".into()), ("lua.scd".into(), "ab".into())]);
        assert_eq!(a, b);
        assert_eq!(a.code.len(), 14);
        let c = fingerprint(&[("maps.scd".into(), "ce".into()), ("lua.scd".into(), "ab".into())]);
        assert_ne!(a.code, c.code);
    }

    #[test]
    fn code_roundtrip() {
        let p = SyncPayload {
            v: 1,
            profile: "Competitivo 3v3".into(),
            mods: vec![SyncMod {
                id: "storm".into(),
                name: "STORM".into(),
                version: "3.1.1".into(),
                hub_id: Some("storm".into()),
                url: None,
                files: vec![("zz_STORM.scd".into(), "a".repeat(64))],
            }],
            fingerprint: Some("f".repeat(64)),
        };
        let code = encode(&p).unwrap();
        assert!(code.starts_with("CP1-"));
        assert_eq!(decode(&code).unwrap(), p);
        assert!(decode("CP1-@@@").is_err());
        assert!(decode("XYZ").is_err());
    }
}
