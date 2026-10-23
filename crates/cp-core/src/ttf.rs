//! Fontes TrueType: leitura das tabelas e troca de "identidade".
//!
//! O SC2 escolhe as fontes pelo nome da família gravado dentro do `.ttf` (`ui/fonts/fonts.lua` pede
//! "MagistralTT Bold", por exemplo). Para trocar a fonte do jogo sem mexer no Lua compilado, a fonte
//! nova recebe a tabela `name` e o estilo (peso, negrito) da original e entra no lugar do mesmo
//! arquivo. Assim o jogo continua achando "MagistralTT", mas desenha a outra fonte.

use crate::error::{Error, Result};

const SFNT_TRUE: u32 = 0x0001_0000;
const SFNT_OTTO: u32 = 0x4F54_544F; // 'OTTO' (CFF)
const SFNT_TRUE_MAC: u32 = 0x7472_7565; // 'true'

#[derive(Debug, Clone)]
pub struct Font {
    pub version: u32,
    /// (tag, dados) em ordem de tag
    pub tables: Vec<([u8; 4], Vec<u8>)>,
}

fn be16(d: &[u8], o: usize) -> Result<u16> {
    d.get(o..o + 2)
        .map(|b| u16::from_be_bytes([b[0], b[1]]))
        .ok_or_else(|| Error::Format("fonte truncada".into()))
}
fn be32(d: &[u8], o: usize) -> Result<u32> {
    d.get(o..o + 4)
        .map(|b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
        .ok_or_else(|| Error::Format("fonte truncada".into()))
}

fn checksum(data: &[u8]) -> u32 {
    let mut sum = 0u32;
    for chunk in data.chunks(4) {
        let mut w = [0u8; 4];
        w[..chunk.len()].copy_from_slice(chunk);
        sum = sum.wrapping_add(u32::from_be_bytes(w));
    }
    sum
}

impl Font {
    pub fn parse(data: &[u8]) -> Result<Font> {
        let version = be32(data, 0)?;
        if !matches!(version, SFNT_TRUE | SFNT_OTTO | SFNT_TRUE_MAC) {
            return Err(Error::Format("não é uma fonte TrueType/OpenType".into()));
        }
        let n = be16(data, 4)? as usize;
        if n == 0 || n > 200 {
            return Err(Error::Format("fonte com número de tabelas inválido".into()));
        }
        let mut tables = Vec::with_capacity(n);
        for i in 0..n {
            let rec = 12 + i * 16;
            let tag: [u8; 4] = data
                .get(rec..rec + 4)
                .and_then(|t| t.try_into().ok())
                .ok_or_else(|| Error::Format("fonte truncada".into()))?;
            let off = be32(data, rec + 8)? as usize;
            let len = be32(data, rec + 12)? as usize;
            let body = data
                .get(off..off.saturating_add(len))
                .ok_or_else(|| Error::Format(format!("tabela {} fora do arquivo", String::from_utf8_lossy(&tag))))?;
            tables.push((tag, body.to_vec()));
        }
        tables.sort_by_key(|a| a.0);
        Ok(Font { version, tables })
    }

    pub fn table(&self, tag: &[u8; 4]) -> Option<&[u8]> {
        self.tables.iter().find(|t| &t.0 == tag).map(|t| t.1.as_slice())
    }

    fn table_mut(&mut self, tag: &[u8; 4]) -> Option<&mut Vec<u8>> {
        self.tables.iter_mut().find(|t| &t.0 == tag).map(|t| &mut t.1)
    }

    pub fn set_table(&mut self, tag: [u8; 4], data: Vec<u8>) {
        match self.table_mut(&tag) {
            Some(t) => *t = data,
            None => {
                self.tables.push((tag, data));
                self.tables.sort_by_key(|a| a.0);
            }
        }
    }

    pub fn remove_table(&mut self, tag: &[u8; 4]) {
        self.tables.retain(|t| &t.0 != tag);
    }

    /// Monta o arquivo de novo, com checksums e `checkSumAdjustment` recalculados.
    pub fn to_bytes(&self) -> Vec<u8> {
        let n = self.tables.len();
        let mut entry_selector = 0u16;
        while (2u32 << entry_selector) <= n as u32 {
            entry_selector += 1;
        }
        let search_range = 16u16 << entry_selector;
        let range_shift = (n as u16) * 16 - search_range;
        let mut out = Vec::new();
        out.extend_from_slice(&self.version.to_be_bytes());
        out.extend_from_slice(&(n as u16).to_be_bytes());
        out.extend_from_slice(&search_range.to_be_bytes());
        out.extend_from_slice(&entry_selector.to_be_bytes());
        out.extend_from_slice(&range_shift.to_be_bytes());
        let dir = out.len();
        out.resize(dir + n * 16, 0);
        let mut head_at = None;
        for (i, (tag, data)) in self.tables.iter().enumerate() {
            let mut data = data.clone();
            if tag == b"head" && data.len() >= 12 {
                data[8..12].copy_from_slice(&[0; 4]);
            }
            let off = out.len();
            if tag == b"head" {
                head_at = Some(off);
            }
            let rec = dir + i * 16;
            out[rec..rec + 4].copy_from_slice(tag);
            out[rec + 4..rec + 8].copy_from_slice(&checksum(&data).to_be_bytes());
            out[rec + 8..rec + 12].copy_from_slice(&(off as u32).to_be_bytes());
            out[rec + 12..rec + 16].copy_from_slice(&(data.len() as u32).to_be_bytes());
            out.extend_from_slice(&data);
            while out.len() % 4 != 0 {
                out.push(0);
            }
        }
        if let Some(h) = head_at {
            let adj = 0xB1B0_AFBAu32.wrapping_sub(checksum(&out));
            out[h + 8..h + 12].copy_from_slice(&adj.to_be_bytes());
        }
        out
    }

    /// Texto de um registro da tabela `name` (prefere Windows/Unicode).
    pub fn name(&self, id: u16) -> Option<String> {
        let t = self.table(b"name")?;
        let count = be16(t, 2).ok()? as usize;
        let storage = be16(t, 4).ok()? as usize;
        let mut fallback = None;
        for i in 0..count {
            let r = 6 + i * 12;
            let (platform, nid) = (be16(t, r).ok()?, be16(t, r + 6).ok()?);
            if nid != id {
                continue;
            }
            let len = be16(t, r + 8).ok()? as usize;
            let off = storage + be16(t, r + 10).ok()? as usize;
            let raw = t.get(off..off + len)?;
            match platform {
                0 | 3 => {
                    let u: Vec<u16> = raw.chunks_exact(2).map(|c| u16::from_be_bytes([c[0], c[1]])).collect();
                    return String::from_utf16(&u).ok();
                }
                1 => fallback = Some(raw.iter().map(|&b| b as char).collect()),
                _ => {}
            }
        }
        fallback
    }

    pub fn family(&self) -> String {
        self.name(16).or_else(|| self.name(1)).unwrap_or_default()
    }

    pub fn subfamily(&self) -> String {
        self.name(17).or_else(|| self.name(2)).unwrap_or_default()
    }

    /// Peso (OS/2 usWeightClass), 400 se não houver.
    pub fn weight(&self) -> u16 {
        self.table(b"OS/2").and_then(|t| be16(t, 4).ok()).unwrap_or(400)
    }
}

/// Fonte `new` com o nome e o estilo de `original`: o jogo pede a original e recebe a nova.
pub fn adopt_identity(new: &[u8], original: &[u8]) -> Result<Vec<u8>> {
    let orig = Font::parse(original)?;
    let mut font = Font::parse(new)?;
    let name = orig
        .table(b"name")
        .ok_or_else(|| Error::Format("a fonte original não tem tabela de nomes".into()))?
        .to_vec();
    font.set_table(*b"name", name);
    // estilo: negrito/itálico e peso iguais aos da original (o jogo pode escolher por eles)
    if let (Some(o), Some(n)) = (orig.table(b"head").map(|t| t.to_vec()), font.table_mut(b"head")) {
        if o.len() >= 46 && n.len() >= 46 {
            n[44..46].copy_from_slice(&o[44..46]); // macStyle
        }
    }
    if let (Some(o), Some(n)) = (orig.table(b"OS/2").map(|t| t.to_vec()), font.table_mut(b"OS/2")) {
        if o.len() >= 64 && n.len() >= 64 {
            n[4..6].copy_from_slice(&o[4..6]); // usWeightClass
            let keep = u16::from_be_bytes([n[62], n[63]]) & !0b0110_0001;
            let style = u16::from_be_bytes([o[62], o[63]]) & 0b0110_0001; // itálico, negrito, regular
            n[62..64].copy_from_slice(&(keep | style).to_be_bytes());
        }
    }
    // a assinatura digital deixa de valer com qualquer mudança
    font.remove_table(b"DSIG");
    Ok(font.to_bytes())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Fonte mínima (só as tabelas que importam aqui) com nome e estilo.
    pub(crate) fn tiny_font(family: &str, sub: &str, weight: u16, bold: bool) -> Vec<u8> {
        let utf16 = |s: &str| s.encode_utf16().flat_map(|c| c.to_be_bytes()).collect::<Vec<u8>>();
        let names = [(1u16, utf16(family)), (2, utf16(sub)), (4, utf16(&format!("{family} {sub}")))];
        let mut name = vec![0, 0];
        name.extend_from_slice(&(names.len() as u16).to_be_bytes());
        name.extend_from_slice(&((6 + 12 * names.len()) as u16).to_be_bytes());
        let mut storage = Vec::new();
        for (id, s) in &names {
            for v in [3u16, 1, 0x409, *id, s.len() as u16, storage.len() as u16] {
                name.extend_from_slice(&v.to_be_bytes());
            }
            storage.extend_from_slice(s);
        }
        name.extend_from_slice(&storage);
        let mut head = vec![0u8; 54];
        head[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        head[12..16].copy_from_slice(&0x5F0F_3CF5u32.to_be_bytes());
        head[18..20].copy_from_slice(&1000u16.to_be_bytes());
        head[44..46].copy_from_slice(&(bold as u16).to_be_bytes());
        let mut os2 = vec![0u8; 96];
        os2[4..6].copy_from_slice(&weight.to_be_bytes());
        os2[62..64].copy_from_slice(&(if bold { 0x20u16 } else { 0x40 }).to_be_bytes());
        Font {
            version: SFNT_TRUE,
            tables: vec![
                (*b"DSIG", vec![0, 0, 0, 1, 0, 0, 0, 0]),
                (*b"OS/2", os2),
                (*b"glyf", vec![7; 10]),
                (*b"head", head),
                (*b"name", name),
            ],
        }
        .to_bytes()
    }

    #[test]
    fn adopts_name_and_style_and_keeps_glyphs() {
        let orig = tiny_font("MagistralTT", "Bold", 700, true);
        let new = tiny_font("Roboto", "Regular", 400, false);
        let out = adopt_identity(&new, &orig).unwrap();
        let f = Font::parse(&out).unwrap();
        assert_eq!(f.family(), "MagistralTT");
        assert_eq!(f.subfamily(), "Bold");
        assert_eq!(f.weight(), 700);
        assert_eq!(f.table(b"glyf").unwrap(), &[7; 10]);
        assert!(f.table(b"DSIG").is_none());
        let head = f.table(b"head").unwrap();
        assert_eq!(u16::from_be_bytes([head[44], head[45]]), 1);
        // soma do arquivo inteiro fecha em 0xB1B0AFBA, como a especificação pede
        assert_eq!(checksum(&out), 0xB1B0_AFBA);
        // diretório consistente com o número de tabelas (4 → searchRange 64, entrySelector 2)
        assert_eq!(be16(&out, 4).unwrap(), 4);
        assert_eq!(be16(&out, 6).unwrap(), 64);
        assert_eq!(be16(&out, 8).unwrap(), 2);
    }

    #[test]
    fn real_fonts_if_available() {
        // CP_FONT_DIR com Roboto-Bold.ttf (repositório) — confere uma fonte de verdade
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../resources/fonts");
        let Ok(roboto) = std::fs::read(dir.join("Roboto-Bold.ttf")) else { return };
        // CP_REAL_FONT: fonte original do jogo (ex.: MGS65__U.TTF); CP_FONT_OUT: grava o resultado
        let orig = std::env::var("CP_REAL_FONT")
            .ok()
            .and_then(|p| std::fs::read(p).ok())
            .unwrap_or_else(|| tiny_font("MagistralTT", "Bold", 700, true));
        let out = adopt_identity(&roboto, &orig).unwrap();
        if let Ok(p) = std::env::var("CP_FONT_OUT") {
            std::fs::write(p, &out).unwrap();
        }
        let f = Font::parse(&out).unwrap();
        assert_eq!(f.name(1), Font::parse(&orig).unwrap().name(1));
        assert_eq!(f.name(4), Font::parse(&orig).unwrap().name(4));
        assert!(f.table(b"glyf").is_some() && f.table(b"cmap").is_some());
        assert_eq!(checksum(&out), 0xB1B0_AFBA);
    }
}
