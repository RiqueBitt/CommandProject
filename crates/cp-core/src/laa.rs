//! "Modo 4 GB": liga a flag *Large Address Aware* no executável do jogo.
//!
//! O Supreme Commander 2 é um programa de 32 bits. Sem essa flag, o Windows só deixa ele usar
//! 2 GB de memória; com ela, num Windows de 64 bits, o mesmo executável pode usar até 4 GB.
//! Não transforma o jogo em 64 bits (isso exigiria recompilar o motor), mas resolve o limite que
//! derruba o jogo com texturas grandes, mapas enormes e muitas unidades.
//!
//! A mudança é de um único bit no cabeçalho PE (mais o checksum). O executável original fica
//! guardado e pode ser restaurado; se a Steam restaurar o arquivo numa atualização, o launcher
//! percebe e pode aplicar de novo.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, IoContext, Result};
use crate::fsutil;

const IMAGE_FILE_LARGE_ADDRESS_AWARE: u16 = 0x0020;
const PE32_MAGIC: u16 = 0x10b;
const PE32_PLUS_MAGIC: u16 = 0x20b;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct PeInfo {
    /// Posição do campo `Characteristics` (cabeçalho COFF).
    characteristics_at: usize,
    /// Posição do campo `CheckSum` (cabeçalho opcional).
    checksum_at: usize,
    is_64bit: bool,
    large_address_aware: bool,
    /// Executável protegido pelo SteamStub (seção `.bind`).
    steam_stub: bool,
}

fn u16_at(d: &[u8], o: usize) -> Option<u16> {
    d.get(o..o + 2).map(|b| u16::from_le_bytes([b[0], b[1]]))
}

fn u32_at(d: &[u8], o: usize) -> Option<u32> {
    d.get(o..o + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

fn parse(d: &[u8]) -> Result<PeInfo> {
    let bad = || Error::Format("não é um executável do Windows válido".into());
    if d.get(0..2) != Some(b"MZ") {
        return Err(bad());
    }
    let pe = u32_at(d, 0x3c).ok_or_else(bad)? as usize;
    if d.get(pe..pe + 4) != Some(b"PE\0\0") {
        return Err(bad());
    }
    let coff = pe + 4;
    let sections = u16_at(d, coff + 2).ok_or_else(bad)? as usize;
    let opt_size = u16_at(d, coff + 16).ok_or_else(bad)? as usize;
    let characteristics_at = coff + 18;
    let characteristics = u16_at(d, characteristics_at).ok_or_else(bad)?;
    let opt = coff + 20;
    let magic = u16_at(d, opt).ok_or_else(bad)?;
    let is_64bit = match magic {
        PE32_MAGIC => false,
        PE32_PLUS_MAGIC => true,
        _ => return Err(bad()),
    };
    let checksum_at = opt + 64;
    u32_at(d, checksum_at).ok_or_else(bad)?;
    let table = opt + opt_size;
    let steam_stub = (0..sections).any(|i| {
        d.get(table + i * 40..table + i * 40 + 8)
            .is_some_and(|n| n.starts_with(b".bind"))
    });
    Ok(PeInfo {
        characteristics_at,
        checksum_at,
        is_64bit,
        large_address_aware: characteristics & IMAGE_FILE_LARGE_ADDRESS_AWARE != 0,
        steam_stub,
    })
}

/// Checksum do cabeçalho PE (o mesmo algoritmo do `CheckSumMappedFile` do Windows).
fn pe_checksum(d: &[u8], checksum_at: usize) -> u32 {
    let mut sum: u64 = 0;
    let mut i = 0;
    while i < d.len() {
        if i == checksum_at {
            i += 4;
            continue;
        }
        let word = if i + 1 < d.len() {
            u16::from_le_bytes([d[i], d[i + 1]])
        } else {
            d[i] as u16
        };
        sum += word as u64;
        sum = (sum & 0xffff) + (sum >> 16);
        i += 2;
    }
    sum = (sum & 0xffff) + (sum >> 16);
    (sum as u32).wrapping_add(d.len() as u32)
}

/// (checksum gravado, checksum calculado) — para diagnóstico.
pub fn checksums(d: &[u8]) -> Result<(u32, u32)> {
    let info = parse(d)?;
    Ok((
        u32_at(d, info.checksum_at).expect("validado"),
        pe_checksum(d, info.checksum_at),
    ))
}

/// Liga ou desliga a flag e atualiza o checksum. Devolve os bytes novos.
pub fn set_flag(d: &[u8], on: bool) -> Result<Vec<u8>> {
    let info = parse(d)?;
    if info.is_64bit {
        return Err(Error::Other("o executável já é de 64 bits".into()));
    }
    let mut out = d.to_vec();
    let mut c = u16_at(&out, info.characteristics_at).expect("validado");
    if on {
        c |= IMAGE_FILE_LARGE_ADDRESS_AWARE;
    } else {
        c &= !IMAGE_FILE_LARGE_ADDRESS_AWARE;
    }
    out[info.characteristics_at..info.characteristics_at + 2].copy_from_slice(&c.to_le_bytes());
    // só atualiza o checksum se o original tinha um (muitos jogos deixam 0)
    if u32_at(&out, info.checksum_at).expect("validado") != 0 {
        let sum = pe_checksum(&out, info.checksum_at);
        out[info.checksum_at..info.checksum_at + 4].copy_from_slice(&sum.to_le_bytes());
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaaStatus {
    pub exe: String,
    pub is_64bit: bool,
    /// A flag está ligada (o jogo pode usar até 4 GB).
    pub enabled: bool,
    /// Foi o CommandProject que ligou (há backup do original).
    pub patched_by_us: bool,
    /// O executável mudou depois do patch (ex.: atualização da Steam) e a flag sumiu.
    pub reverted_by_update: bool,
    pub steam_stub: bool,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    original_sha: Option<String>,
    patched_sha: Option<String>,
}

pub struct Laa {
    exe: PathBuf,
    dir: PathBuf,
}

impl Laa {
    /// `exe`: executável do jogo; `data`: pasta de dados do app (backup em `laa/`).
    pub fn new(exe: PathBuf, data: &Path) -> Self {
        Laa {
            exe,
            dir: data.join("laa"),
        }
    }

    fn state(&self) -> Result<State> {
        fsutil::read_json_or_default(&self.dir.join("state.json"))
    }

    fn save(&self, s: &State) -> Result<()> {
        fsutil::write_json(&self.dir.join("state.json"), s)
    }

    pub fn status(&self) -> Result<LaaStatus> {
        let d = std::fs::read(&self.exe).at(&self.exe)?;
        let info = parse(&d)?;
        let st = self.state()?;
        let sha = fsutil::sha256_bytes(&d);
        let backup = st
            .original_sha
            .as_ref()
            .is_some_and(|s| self.dir.join(format!("{s}.exe")).is_file());
        Ok(LaaStatus {
            exe: self.exe.display().to_string(),
            is_64bit: info.is_64bit,
            enabled: info.large_address_aware,
            patched_by_us: backup && st.patched_sha.as_deref() == Some(sha.as_str()),
            reverted_by_update: st.patched_sha.is_some() && !info.large_address_aware,
            steam_stub: info.steam_stub,
        })
    }

    fn ensure_closed() -> Result<()> {
        if crate::game::is_running() {
            return Err(Error::Other("feche o jogo antes de mudar o executável".into()));
        }
        Ok(())
    }

    /// Liga o modo 4 GB (guarda o executável original antes).
    pub fn enable(&self) -> Result<LaaStatus> {
        Self::ensure_closed()?;
        let d = std::fs::read(&self.exe).at(&self.exe)?;
        let info = parse(&d)?;
        if info.is_64bit || info.large_address_aware {
            return self.status();
        }
        let original = fsutil::sha256_bytes(&d);
        std::fs::create_dir_all(&self.dir).at(&self.dir)?;
        let backup = self.dir.join(format!("{original}.exe"));
        if !backup.is_file() {
            fsutil::write_atomic(&backup, &d)?;
        }
        let patched = set_flag(&d, true)?;
        // confere antes de gravar: só o bit e o checksum podem mudar
        let check = parse(&patched)?;
        if !check.large_address_aware || patched.len() != d.len() {
            return Err(Error::Integrity("o patch não produziu o resultado esperado".into()));
        }
        fsutil::write_atomic(&self.exe, &patched)?;
        self.save(&State {
            original_sha: Some(original),
            patched_sha: Some(fsutil::sha256_bytes(&patched)),
        })?;
        self.status()
    }

    /// Desliga: devolve o executável original guardado (ou só limpa o bit, se ele mudou).
    pub fn disable(&self) -> Result<LaaStatus> {
        Self::ensure_closed()?;
        let d = std::fs::read(&self.exe).at(&self.exe)?;
        let st = self.state()?;
        let sha = fsutil::sha256_bytes(&d);
        let backup = st.original_sha.as_ref().map(|s| self.dir.join(format!("{s}.exe")));
        match backup {
            Some(b) if b.is_file() && st.patched_sha.as_deref() == Some(sha.as_str()) => {
                let original = std::fs::read(&b).at(&b)?;
                fsutil::write_atomic(&self.exe, &original)?;
            }
            _ => {
                if parse(&d)?.large_address_aware {
                    fsutil::write_atomic(&self.exe, &set_flag(&d, false)?)?;
                }
            }
        }
        self.save(&State::default())?;
        self.status()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Executável PE32 mínimo: cabeçalho DOS, PE, COFF, opcional (224 bytes) e uma seção.
    pub fn fake_exe(checksum: bool, section: &[u8; 8]) -> Vec<u8> {
        let mut d = vec![0u8; 1024];
        d[0..2].copy_from_slice(b"MZ");
        d[0x3c..0x40].copy_from_slice(&0x80u32.to_le_bytes());
        d[0x80..0x84].copy_from_slice(b"PE\0\0");
        let coff = 0x84;
        d[coff..coff + 2].copy_from_slice(&0x14cu16.to_le_bytes()); // i386
        d[coff + 2..coff + 4].copy_from_slice(&1u16.to_le_bytes());
        d[coff + 16..coff + 18].copy_from_slice(&224u16.to_le_bytes());
        d[coff + 18..coff + 20].copy_from_slice(&0x0102u16.to_le_bytes()); // EXECUTABLE | 32BIT
        let opt = coff + 20;
        d[opt..opt + 2].copy_from_slice(&PE32_MAGIC.to_le_bytes());
        let table = opt + 224;
        d[table..table + 8].copy_from_slice(section);
        for (i, b) in d.iter_mut().enumerate().skip(0x200) {
            *b = (i * 7 % 251) as u8;
        }
        if checksum {
            let s = pe_checksum(&d, opt + 64);
            d[opt + 64..opt + 68].copy_from_slice(&s.to_le_bytes());
        }
        d
    }

    #[test]
    fn sets_flag_and_checksum() {
        let d = fake_exe(true, b".text\0\0\0");
        let info = parse(&d).unwrap();
        assert!(!info.large_address_aware && !info.is_64bit && !info.steam_stub);
        let p = set_flag(&d, true).unwrap();
        let pi = parse(&p).unwrap();
        assert!(pi.large_address_aware);
        assert_eq!(
            u32_at(&p, pi.checksum_at).unwrap(),
            pe_checksum(&p, pi.checksum_at),
            "checksum coerente"
        );
        // só os 2 bytes da flag e os 4 do checksum mudam
        let diff: Vec<usize> = (0..d.len()).filter(|&i| d[i] != p[i]).collect();
        assert!(
            diff.iter()
                .all(|&i| (info.characteristics_at..info.characteristics_at + 2).contains(&i)
                    || (info.checksum_at..info.checksum_at + 4).contains(&i)),
            "{diff:?}"
        );
        assert_eq!(set_flag(&p, false).unwrap(), d, "desligar volta exatamente ao original");
        assert!(parse(&fake_exe(false, b".bind\0\0\0")).unwrap().steam_stub);
        assert!(parse(b"MZ nada").is_err());
    }

    #[test]
    fn enable_disable_with_backup() {
        let tmp = tempfile::tempdir().unwrap();
        let exe = tmp.path().join("SupremeCommander2.exe");
        let original = fake_exe(false, b".text\0\0\0");
        std::fs::write(&exe, &original).unwrap();
        let laa = Laa::new(exe.clone(), &tmp.path().join("data"));
        assert!(!laa.status().unwrap().enabled);
        let st = laa.enable().unwrap();
        assert!(st.enabled && st.patched_by_us);
        assert!(laa.enable().unwrap().enabled, "idempotente");
        // a Steam "verifica a integridade" e devolve o original
        std::fs::write(&exe, &original).unwrap();
        let st = laa.status().unwrap();
        assert!(!st.enabled && st.reverted_by_update);
        laa.enable().unwrap();
        let st = laa.disable().unwrap();
        assert!(!st.enabled && !st.reverted_by_update);
        assert_eq!(std::fs::read(&exe).unwrap(), original);
    }
}
