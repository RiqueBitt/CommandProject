//! Índice do sistema de arquivos do Supreme Commander 2 (`toc.win.bdf`, na raiz do jogo).
//!
//! O jogo não procura um arquivo em todos os `.scd` montados: ele consulta este índice, que diz,
//! para cada caminho, **qual `.scd`** e **qual entrada do zip** contém o arquivo. Por isso um mod
//! que só acrescenta um `.scd` com arquivos de mesmo nome é ignorado. Arquivos novos (que não estão
//! no índice) continuam funcionando, por isso mapas novos aparecem.
//!
//! Formato (descoberto e conferido contra os `.scd` reais):
//! * contêiner MFDB: cabeçalho de 8 `u32` (`MFDB`, 7, 2, 0, tamanho comprimido, tamanho original,
//!   nº de *fixups*, 1), a lista de *fixups* (posições de ponteiros no conteúdo) e o conteúdo zlib;
//! * conteúdo: `[versão, nº de pastas, tabela de pastas, nº de .scd, tabela de .scd, nº de arquivos,
//!   tabela de arquivos]`. As tabelas de pastas e de `.scd` são ponteiros para strings; cada arquivo é
//!   um registro de 24 bytes `[pasta, ponteiro do nome, tem ".win", nº do .scd, entrada no zip, tamanho]`.
//!   O nome não tem o `.win` que o arquivo tem dentro do `.scd` (`foo.dds` ↔ `foo.win.dds`).
//!   Nº do `.scd` `0xFFFFFFFF` = arquivo solto no disco.
//!
//! Para acrescentar um `.scd`, a tabela de `.scd` é copiada para o fim do conteúdo com a entrada nova
//! (e os *fixups* dela); o resto do conteúdo não muda de lugar.
//!
//! **Um `.scd` novo no máximo.** Com dois `.scd` de mods acrescentados ao índice o jogo fecha logo ao
//! abrir (falha ao listar `/sounds/mod/*.fev`, visto nos relatórios de travamento). Por isso só o mod
//! que mais substitui arquivos ganha uma entrada de `.scd`; os outros têm os arquivos extraídos
//! soltos na pasta do jogo (como os sons e o executável, que o índice já lista como "soltos").

use std::collections::HashMap;
use std::io::Write;

use crate::error::{Error, Result};

const MAGIC: &[u8; 4] = b"MFDB";
const LOOSE: u32 = u32::MAX;

pub struct Toc {
    head: [u32; 8],
    fixups: Vec<u32>,
    payload: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TocFile {
    /// Caminho como o jogo pede: minúsculo, com `/`, sem `.win` e sem `/` inicial.
    pub key: String,
    pub win: bool,
    /// Índice do `.scd` (`None` = arquivo solto no disco).
    pub archive: Option<u32>,
    pub entry: u32,
    pub size: u32,
}

fn bad(msg: &str) -> Error {
    Error::Format(format!("índice do jogo (toc.win.bdf) inválido: {msg}"))
}

/// Chave do índice para um nome de entrada de `.scd` e se ele tem o `.win` no nome.
pub fn toc_key(entry_name: &str) -> (String, bool) {
    let mut k = entry_name.replace('\\', "/").to_ascii_lowercase();
    while k.starts_with('/') {
        k.remove(0);
    }
    match k.rfind(".win.") {
        Some(i) if !k[i + 5..].contains('/') => {
            k.replace_range(i..i + 4, "");
            (k, true)
        }
        _ => (k, false),
    }
}

impl Toc {
    pub fn parse(data: &[u8]) -> Result<Toc> {
        if data.len() < 32 || &data[0..4] != MAGIC {
            return Err(bad("assinatura MFDB ausente"));
        }
        let mut head = [0u32; 8];
        for (i, h) in head.iter_mut().enumerate() {
            *h = u32::from_le_bytes(data[i * 4..i * 4 + 4].try_into().expect("4 bytes"));
        }
        let nfix = head[6] as usize;
        let fix_end = 32 + nfix * 4;
        if data.len() < fix_end {
            return Err(bad("lista de fixups cortada"));
        }
        let fixups = data[32..fix_end]
            .chunks_exact(4)
            .map(|c| u32::from_le_bytes(c.try_into().expect("4 bytes")))
            .collect();
        let start = (fix_end..data.len().saturating_sub(1))
            .find(|&i| data[i] == 0x78 && matches!(data[i + 1], 0x01 | 0x5e | 0x9c | 0xda))
            .ok_or_else(|| bad("conteúdo comprimido não encontrado"))?;
        let mut payload = Vec::with_capacity(head[5] as usize);
        flate2::read::ZlibDecoder::new(&data[start..])
            .read_to_end_limited(&mut payload, 64 << 20)
            .map_err(|_| bad("conteúdo comprimido corrompido"))?;
        if payload.len() != head[5] as usize {
            return Err(bad("tamanho do conteúdo não confere"));
        }
        let toc = Toc { head, fixups, payload };
        toc.check()?;
        Ok(toc)
    }

    fn u32_at(&self, o: usize) -> Result<u32> {
        self.payload
            .get(o..o + 4)
            .map(|b| u32::from_le_bytes(b.try_into().expect("4 bytes")))
            .ok_or_else(|| bad("ponteiro fora do conteúdo"))
    }

    fn put_u32(&mut self, o: usize, v: u32) {
        self.payload[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }

    fn cstr(&self, o: u32) -> Result<String> {
        let o = o as usize;
        let rest = self.payload.get(o..).ok_or_else(|| bad("string fora do conteúdo"))?;
        let end = rest.iter().position(|&b| b == 0).ok_or_else(|| bad("string sem fim"))?;
        Ok(String::from_utf8_lossy(&rest[..end]).into_owned())
    }

    /// (versão, pastas, tab. pastas, nº .scd, tab. .scd, nº arquivos, tab. arquivos)
    fn header(&self) -> Result<[u32; 7]> {
        let mut h = [0u32; 7];
        for (i, v) in h.iter_mut().enumerate() {
            *v = self.u32_at(i * 4)?;
        }
        Ok(h)
    }

    fn check(&self) -> Result<()> {
        let h = self.header()?;
        if h[0] != 1 {
            return Err(bad(&format!("versão {} desconhecida", h[0])));
        }
        let end = h[6] as usize + h[5] as usize * 24;
        if end > self.payload.len() || h[2] as usize + h[1] as usize * 4 > self.payload.len() {
            return Err(bad("tabelas fora do conteúdo"));
        }
        Ok(())
    }

    pub fn archives(&self) -> Result<Vec<String>> {
        let h = self.header()?;
        (0..h[3] as usize)
            .map(|i| self.cstr(self.u32_at(h[4] as usize + i * 4)?))
            .collect()
    }

    fn dirs(&self) -> Result<Vec<String>> {
        let h = self.header()?;
        (0..h[1] as usize)
            .map(|i| self.cstr(self.u32_at(h[2] as usize + i * 4)?))
            .collect()
    }

    pub fn files(&self) -> Result<Vec<TocFile>> {
        let h = self.header()?;
        let dirs = self.dirs()?;
        (0..h[5] as usize)
            .map(|i| {
                let o = h[6] as usize + i * 24;
                let dir = self.u32_at(o)? as usize;
                let name = self.cstr(self.u32_at(o + 4)?)?;
                let d = dirs.get(dir).ok_or_else(|| bad("pasta inexistente"))?;
                let key = if d.is_empty() { name } else { format!("{d}/{name}") };
                let archive = self.u32_at(o + 12)?;
                Ok(TocFile {
                    key: key.to_ascii_lowercase(),
                    win: self.u32_at(o + 8)? != 0,
                    archive: (archive != LOOSE).then_some(archive),
                    entry: self.u32_at(o + 16)?,
                    size: self.u32_at(o + 20)?,
                })
            })
            .collect()
    }

    /// Acrescenta um `.scd` (ex.: `gamedata\zz_mod.scd`) e devolve o índice dele.
    /// Se já existe, devolve o índice existente.
    pub fn add_archive(&mut self, name: &str) -> Result<u32> {
        let existing = self.archives()?;
        if let Some(i) = existing.iter().position(|a| a.eq_ignore_ascii_case(name)) {
            return Ok(i as u32);
        }
        let h = self.header()?;
        let (n, old_table) = (h[3] as usize, h[4] as usize);
        let align = |v: &mut Vec<u8>| {
            while !v.len().is_multiple_of(4) {
                v.push(0);
            }
        };
        align(&mut self.payload);
        let table = self.payload.len();
        // tabela nova: os ponteiros antigos (strings continuam onde estão) + o novo
        let mut ptrs: Vec<u32> = (0..n).map(|i| self.u32_at(old_table + i * 4)).collect::<Result<_>>()?;
        let str_at = table + (n + 1) * 4;
        ptrs.push(str_at as u32);
        for p in &ptrs {
            self.payload.extend_from_slice(&p.to_le_bytes());
        }
        self.payload.extend_from_slice(name.as_bytes());
        self.payload.push(0);
        align(&mut self.payload);
        for i in 0..=n {
            self.fixups.push((table + i * 4) as u32);
        }
        self.put_u32(12, (n + 1) as u32);
        self.put_u32(16, table as u32);
        Ok(n as u32)
    }

    /// Aponta o registro `record` do índice para outra entrada.
    fn redirect(&mut self, record: usize, archive: u32, entry: u32, size: u32, win: bool) -> Result<()> {
        let o = self.header()?[6] as usize + record * 24;
        self.put_u32(o + 8, win as u32);
        self.put_u32(o + 12, archive);
        self.put_u32(o + 16, entry);
        self.put_u32(o + 20, size);
        Ok(())
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(6));
        z.write_all(&self.payload).map_err(|e| Error::Other(e.to_string()))?;
        let comp = z.finish().map_err(|e| Error::Other(e.to_string()))?;
        let mut head = self.head;
        head[4] = comp.len() as u32;
        head[5] = self.payload.len() as u32;
        head[6] = self.fixups.len() as u32;
        let mut out = Vec::with_capacity(32 + self.fixups.len() * 4 + comp.len() + 64);
        for h in head {
            out.extend_from_slice(&h.to_le_bytes());
        }
        for f in &self.fixups {
            out.extend_from_slice(&f.to_le_bytes());
        }
        while !out.len().is_multiple_of(32) {
            out.push(0);
        }
        out.extend_from_slice(&comp);
        while !out.len().is_multiple_of(32) {
            out.push(0);
        }
        Ok(out)
    }
}

trait ReadLimited {
    fn read_to_end_limited(&mut self, buf: &mut Vec<u8>, limit: u64) -> std::io::Result<usize>;
}

impl<R: std::io::Read> ReadLimited for R {
    fn read_to_end_limited(&mut self, buf: &mut Vec<u8>, limit: u64) -> std::io::Result<usize> {
        std::io::Read::read_to_end(&mut std::io::Read::take(self, limit), buf)
    }
}

/// Arquivo de um `.scd` de mod, na posição em que está no zip.
#[derive(Debug, Clone)]
pub struct ModEntry {
    pub name: String,
    pub index: u32,
    pub size: u32,
}

/// Recalcula o índice a partir do original: cada `.scd` de mod (na ordem de montagem, o último
/// vence) passa a ser a origem dos arquivos que ele traz e que já existiam no jogo.
/// Devolve os bytes novos e quantos caminhos foram redirecionados.
pub fn apply_overrides(original: &[u8], mods: &[(String, Vec<ModEntry>)]) -> Result<(Vec<u8>, usize)> {
    let plan: Vec<_> = mods.iter().map(|(n, e)| (n.clone(), e.clone(), false)).collect();
    let (out, n, _) = apply_mixed(original, &plan)?;
    Ok((out, n))
}

/// Arquivo que deve ficar solto na pasta do jogo: `path` relativo à raiz (com `/`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LooseFile {
    pub mod_index: usize,
    pub entry: u32,
    pub path: String,
    pub size: u32,
}

/// Quantos arquivos do índice cada `.scd` substitui e se dá para servi-los soltos (nenhum com `.win`).
pub fn override_stats(original: &[u8], mods: &[(String, Vec<ModEntry>)]) -> Result<Vec<(usize, bool)>> {
    let toc = Toc::parse(original)?;
    let keys: std::collections::HashSet<String> = toc.files()?.into_iter().map(|f| f.key).collect();
    Ok(mods
        .iter()
        .map(|(_, entries)| {
            let hits: Vec<bool> = entries
                .iter()
                .filter_map(|e| {
                    let (k, win) = toc_key(&e.name);
                    keys.contains(&k).then_some(win)
                })
                .collect();
            (hits.len(), hits.iter().all(|w| !w))
        })
        .collect())
}

/// Como [`apply_overrides`], mas os mods marcados com `true` não ganham `.scd` no índice: os
/// arquivos deles passam a ser "soltos" e a lista do que extrair para a pasta do jogo é devolvida.
pub fn apply_mixed(original: &[u8], mods: &[(String, Vec<ModEntry>, bool)]) -> Result<(Vec<u8>, usize, Vec<LooseFile>)> {
    let mut toc = Toc::parse(original)?;
    let index: HashMap<String, usize> = toc.files()?.into_iter().enumerate().map(|(i, f)| (f.key, i)).collect();
    let mut changed = std::collections::HashSet::new();
    let mut loose: HashMap<usize, LooseFile> = HashMap::new();
    for (mi, (archive_name, entries, as_loose)) in mods.iter().enumerate() {
        let mut slot = None;
        for e in entries {
            let (key, win) = toc_key(&e.name);
            let Some(&rec) = index.get(&key) else { continue }; // arquivo novo: o jogo acha sozinho
            if *as_loose && !win {
                toc.redirect(rec, LOOSE, 0, e.size, false)?;
                loose.insert(rec, LooseFile { mod_index: mi, entry: e.index, path: key, size: e.size });
                changed.insert(rec);
                continue;
            }
            let a = match slot {
                Some(a) => a,
                None => {
                    let a = toc.add_archive(&format!("gamedata\\{archive_name}"))?;
                    slot = Some(a);
                    a
                }
            };
            toc.redirect(rec, a, e.index, e.size, win)?;
            loose.remove(&rec); // um mod montado depois venceu
            changed.insert(rec);
        }
    }
    let mut files: Vec<LooseFile> = loose.into_values().collect();
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok((toc.to_bytes()?, changed.len(), files))
}

/// O índice tem `.scd` colocados pelo launcher (`_cp_…`/`zz_cp_…`)? Então não é o original do jogo.
pub fn has_launcher_archives(data: &[u8]) -> bool {
    Toc::parse(data)
        .and_then(|t| t.archives())
        .map(|a| {
            a.iter().any(|n| {
                let f = n.rsplit(['\\', '/']).next().unwrap_or(n).to_ascii_lowercase();
                f.starts_with("zz_cp_") || f.starts_with("_cp_")
            })
        })
        .unwrap_or(false)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Índice mínimo no mesmo formato do jogo: 2 pastas, 2 .scd, 3 arquivos (um solto).
    pub fn sample() -> Vec<u8> {
        let mut p = Vec::new();
        let u = |p: &mut Vec<u8>, v: u32| p.extend_from_slice(&v.to_le_bytes());
        let mut fix = vec![8u32, 16, 24];
        // cabeçalho (preenchido depois)
        p.resize(28, 0);
        let dirs = ["", "textures/ui"];
        let dir_tab = p.len();
        p.resize(dir_tab + dirs.len() * 4, 0);
        let put_str = |p: &mut Vec<u8>, s: &str| {
            let at = p.len();
            p.extend_from_slice(s.as_bytes());
            p.push(0);
            while !p.len().is_multiple_of(4) {
                p.push(0);
            }
            at as u32
        };
        for (i, d) in dirs.iter().enumerate() {
            let at = put_str(&mut p, d);
            p[dir_tab + i * 4..dir_tab + i * 4 + 4].copy_from_slice(&at.to_le_bytes());
            fix.push((dir_tab + i * 4) as u32);
        }
        let archs = ["gamedata\\textures.scd", "gamedata\\z_diff1.scd"];
        let arch_tab = p.len();
        p.resize(arch_tab + archs.len() * 4, 0);
        for (i, a) in archs.iter().enumerate() {
            let at = put_str(&mut p, a);
            p[arch_tab + i * 4..arch_tab + i * 4 + 4].copy_from_slice(&at.to_le_bytes());
            fix.push((arch_tab + i * 4) as u32);
        }
        let files: [(u32, &str, u32, u32, u32, u32); 3] = [
            (1, "bg.dds", 1, 0, 0, 100),
            (1, "logo.dds", 1, 1, 0, 200),
            (0, "readme.txt", 0, LOOSE, 0, 50),
        ];
        let file_tab = p.len();
        p.resize(file_tab + files.len() * 24, 0);
        for (i, (dir, name, win, arch, entry, size)) in files.iter().enumerate() {
            let at = put_str(&mut p, name);
            let o = file_tab + i * 24;
            for (k, v) in [*dir, at, *win, *arch, *entry, *size].iter().enumerate() {
                p[o + k * 4..o + k * 4 + 4].copy_from_slice(&v.to_le_bytes());
            }
            fix.push((o + 4) as u32);
        }
        let mut head = Vec::new();
        for v in [
            1,
            dirs.len() as u32,
            dir_tab as u32,
            archs.len() as u32,
            arch_tab as u32,
            files.len() as u32,
            file_tab as u32,
        ] {
            u(&mut head, v);
        }
        p[..28].copy_from_slice(&head);
        let toc = Toc {
            head: [u32::from_le_bytes(*MAGIC), 7, 2, 0, 0, 0, 0, 1],
            fixups: fix,
            payload: p,
        };
        toc.to_bytes().unwrap()
    }

    #[test]
    fn keys_drop_win_infix() {
        assert_eq!(
            toc_key("textures\\UI\\Common\\BG.win.dds"),
            ("textures/ui/common/bg.dds".into(), true)
        );
        assert_eq!(
            toc_key("/units/uef/uux0115/UUX0115_unit.bp"),
            ("units/uef/uux0115/uux0115_unit.bp".into(), false)
        );
        assert_eq!(toc_key("a.win/b.dds"), ("a.win/b.dds".into(), false));
    }

    #[test]
    fn parses_and_redirects() {
        let bytes = sample();
        let toc = Toc::parse(&bytes).unwrap();
        assert_eq!(
            toc.archives().unwrap(),
            vec!["gamedata\\textures.scd", "gamedata\\z_diff1.scd"]
        );
        let f = toc.files().unwrap();
        assert_eq!(
            f[0],
            TocFile {
                key: "textures/ui/bg.dds".into(),
                win: true,
                archive: Some(0),
                entry: 0,
                size: 100
            }
        );
        assert_eq!(f[2].archive, None);

        let mods = vec![(
            "zz_cp_texturas_hd.scd".to_string(),
            vec![
                ModEntry {
                    name: "textures/ui/BG.win.dds".into(),
                    index: 3,
                    size: 400,
                },
                ModEntry {
                    name: "textures/ui/novo.dds".into(),
                    index: 4,
                    size: 10,
                },
            ],
        )];
        let (out, n) = apply_overrides(&bytes, &mods).unwrap();
        assert_eq!(n, 1, "só o arquivo que já existia é redirecionado");
        let t2 = Toc::parse(&out).unwrap();
        assert_eq!(
            t2.archives().unwrap().last().unwrap(),
            "gamedata\\zz_cp_texturas_hd.scd"
        );
        let f2 = t2.files().unwrap();
        assert_eq!(
            f2[0],
            TocFile {
                key: "textures/ui/bg.dds".into(),
                win: true,
                archive: Some(2),
                entry: 3,
                size: 400
            }
        );
        assert_eq!(f2[1], f[1], "o resto não muda");
        assert_eq!(
            t2.fixups.len(),
            toc.fixups.len() + 3,
            "tabela nova de .scd ganha fixups"
        );
        // fixups continuam apontando para ponteiros válidos (dentro do conteúdo)
        assert!(t2.fixups.iter().all(|&o| (o as usize) + 4 <= t2.payload.len()));
        // sem mods: volta igual ao original (conteúdo)
        let (same, n0) = apply_overrides(&bytes, &[]).unwrap();
        assert_eq!(n0, 0);
        assert_eq!(Toc::parse(&same).unwrap().payload, toc.payload);
    }

    #[test]
    fn second_mod_goes_loose() {
        let bytes = sample();
        let e = |n: &str, i: u32, s: u32| ModEntry { name: n.into(), index: i, size: s };
        let mods = vec![
            ("zz_cp_a.scd".to_string(), vec![e("textures/ui/bg.win.dds", 0, 10)], false),
            ("zz_cp_b.scd".to_string(), vec![e("textures/ui/logo.dds", 5, 77), e("textures/ui/novo.dds", 6, 1)], true),
        ];
        let (out, n, loose) = apply_mixed(&bytes, &mods).unwrap();
        assert_eq!(n, 2);
        let t = Toc::parse(&out).unwrap();
        assert_eq!(t.archives().unwrap().len(), 3, "só um .scd novo");
        let logo = t.files().unwrap().into_iter().find(|f| f.key == "textures/ui/logo.dds").unwrap();
        assert_eq!((logo.archive, logo.size, logo.win), (None, 77, false));
        assert_eq!(loose, vec![LooseFile { mod_index: 1, entry: 5, path: "textures/ui/logo.dds".into(), size: 77 }]);
        assert!(has_launcher_archives(&out));
        assert!(!has_launcher_archives(&bytes));
        let st = override_stats(&bytes, &mods.iter().map(|(a, b, _)| (a.clone(), b.clone())).collect::<Vec<_>>()).unwrap();
        assert_eq!(st, vec![(1, false), (1, true)]);
    }

    /// Com `CP_REAL_TOC` apontando para o toc.win.bdf do jogo, confere leitura e regravação.
    #[test]
    fn real_toc_if_available() {
        let Some(path) = std::env::var_os("CP_REAL_TOC") else {
            return;
        };
        let data = std::fs::read(path).unwrap();
        let toc = Toc::parse(&data).unwrap();
        let files = toc.files().unwrap();
        assert!(files.len() > 20000);
        let chrome = files
            .iter()
            .find(|f| f.key == "textures/units/shared/chrome.dds")
            .unwrap();
        assert_eq!((chrome.win, chrome.size), (true, 1398256));
        let again = Toc::parse(&toc.to_bytes().unwrap()).unwrap();
        assert_eq!(again.payload, toc.payload);
        assert_eq!(again.fixups, toc.fixups);
        let mods = vec![(
            "zz_x.scd".to_string(),
            vec![ModEntry {
                name: "textures\\Units\\Shared\\Chrome.win.dds".into(),
                index: 7,
                size: 5592560,
            }],
        )];
        let (out, n) = apply_overrides(&data, &mods).unwrap();
        assert_eq!(n, 1);
        let t2 = Toc::parse(&out).unwrap();
        let c2 = t2.files().unwrap().into_iter().find(|f| f.key == chrome.key).unwrap();
        assert_eq!(
            (c2.archive, c2.entry, c2.size),
            (Some(toc.archives().unwrap().len() as u32), 7, 5592560)
        );
        // todos os outros registros iguais
        let diffs = files.iter().zip(t2.files().unwrap()).filter(|(a, b)| *a != b).count();
        assert_eq!(diffs, 1);
    }
}
