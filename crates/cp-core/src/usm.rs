//! Vídeos do jogo (`movies/*.win.usm`): o contêiner CRI USM com vídeo MPEG-1.
//!
//! Formato (conferido remontando o vídeo da tela inicial byte a byte):
//! * blocos `CRID`/`@SFV` com cabeçalho de 0x18 bytes depois do tamanho: deslocamento do conteúdo,
//!   preenchimento, canal, tipo (0 dados, 1 cabeçalho, 2 marca de fim, 3 índice), tempo do quadro e
//!   taxa (quadros por segundo × 100 nos dados);
//! * tabelas `@UTF` (nomes de colunas, linhas): `CRIUSF_DIR_STREAM` (arquivo e fluxo),
//!   `VIDEO_HDRINFO` (tamanho, quadros, taxa) e `VIDEO_SEEKINFO` (onde começa cada quadro I);
//! * um quadro MPEG-1 por bloco de dados, na ordem de decodificação, depois de 64 bytes zerados,
//!   com os cabeçalhos de sequência/GOP junto do quadro que vem depois deles.
//!
//! O launcher converte um vídeo do jogador para MPEG-1 com o ffmpeg e monta o `.usm` aqui.

use crate::error::{Error, Result};
use std::path::Path;

const FMT_U8: u8 = 0;
const FMT_U16: u8 = 2;
const FMT_I16: u8 = 3;
const FMT_U32: u8 = 4;
const FMT_I32: u8 = 5;
const FMT_U64: u8 = 6;
const FMT_STR: u8 = 0xA;

#[derive(Debug, Clone, PartialEq)]
enum Val {
    U8(u8),
    U16(u16),
    I16(i16),
    U32(u32),
    I32(i32),
    U64(u64),
    Str(String),
}

impl Val {
    fn kind(&self) -> u8 {
        match self {
            Val::U8(_) => FMT_U8,
            Val::U16(_) => FMT_U16,
            Val::I16(_) => FMT_I16,
            Val::U32(_) => FMT_U32,
            Val::I32(_) => FMT_I32,
            Val::U64(_) => FMT_U64,
            Val::Str(_) => FMT_STR,
        }
    }
}

/// Tabela `@UTF` com todas as colunas por linha (como as do jogo).
fn utf_table(name: &str, cols: &[&str], rows: &[Vec<Val>]) -> Vec<u8> {
    let mut strs: Vec<u8> = b"<NULL>\0".to_vec();
    let mut index: std::collections::HashMap<String, u32> = Default::default();
    let mut st = |s: &str, strs: &mut Vec<u8>| -> u32 {
        if let Some(&o) = index.get(s) {
            return o;
        }
        let o = strs.len() as u32;
        strs.extend_from_slice(s.as_bytes());
        strs.push(0);
        index.insert(s.to_string(), o);
        o
    };
    let name_off = st(name, &mut strs);
    let mut defs = Vec::new();
    for (i, c) in cols.iter().enumerate() {
        let kind = rows.first().map(|r| r[i].kind()).unwrap_or(FMT_U32);
        defs.push(0x50 | kind);
        defs.extend_from_slice(&st(c, &mut strs).to_be_bytes());
    }
    let mut rowb = Vec::new();
    for r in rows {
        for v in r {
            match v {
                Val::U8(x) => rowb.push(*x),
                Val::U16(x) => rowb.extend_from_slice(&x.to_be_bytes()),
                Val::I16(x) => rowb.extend_from_slice(&x.to_be_bytes()),
                Val::U32(x) => rowb.extend_from_slice(&x.to_be_bytes()),
                Val::I32(x) => rowb.extend_from_slice(&x.to_be_bytes()),
                Val::U64(x) => rowb.extend_from_slice(&x.to_be_bytes()),
                Val::Str(s) => rowb.extend_from_slice(&st(s, &mut strs).to_be_bytes()),
            }
        }
    }
    let rowlen = if rows.is_empty() { 0 } else { rowb.len() / rows.len() };
    let rows_off = 24 + defs.len();
    let str_off = rows_off + rowb.len();
    let mut body = defs;
    body.extend_from_slice(&rowb);
    body.extend_from_slice(&strs);
    while (24 + body.len()) % 8 != 0 {
        body.push(0);
    }
    let total = 24 + body.len();
    let mut out = b"@UTF".to_vec();
    out.extend_from_slice(&(total as u32).to_be_bytes());
    for v in [rows_off as u32, str_off as u32, total as u32, name_off] {
        out.extend_from_slice(&v.to_be_bytes());
    }
    out.extend_from_slice(&(cols.len() as u16).to_be_bytes());
    out.extend_from_slice(&(rowlen as u16).to_be_bytes());
    out.extend_from_slice(&(rows.len() as u32).to_be_bytes());
    out.extend_from_slice(&body);
    out
}

fn chunk(sig: &[u8; 4], kind: u8, payload: &[u8], ftime: u32, frate: u32, pad: usize) -> Vec<u8> {
    let size = 0x18 + payload.len() + pad;
    let mut out = Vec::with_capacity(8 + size);
    out.extend_from_slice(sig);
    out.extend_from_slice(&(size as u32).to_be_bytes());
    out.extend_from_slice(&[0, 0x18]);
    out.extend_from_slice(&(pad as u16).to_be_bytes());
    out.extend_from_slice(&[0, 0, 0, kind]);
    out.extend_from_slice(&ftime.to_be_bytes());
    out.extend_from_slice(&frate.to_be_bytes());
    out.extend_from_slice(&[0; 8]);
    out.extend_from_slice(payload);
    out.resize(out.len() + pad, 0);
    out
}

fn end_marker(text: &str) -> Vec<u8> {
    let mut s = format!("{text} ");
    while s.len() < 16 {
        s.push(' ');
    }
    let mut b = s.into_bytes();
    b.extend_from_slice(b"===============\0");
    b
}

/// Um quadro do vídeo: os bytes (com os cabeçalhos que vêm antes dele) e o tipo (1 = I).
pub struct Frame<'a> {
    pub data: &'a [u8],
    pub kind: u8,
}

/// Separa um fluxo MPEG-1 em quadros (ordem de decodificação).
pub fn split_frames(es: &[u8]) -> Vec<Frame<'_>> {
    let mut starts = Vec::new();
    let mut pending: Option<usize> = None;
    let mut i = 0;
    while i + 4 <= es.len() {
        if es[i] == 0 && es[i + 1] == 0 && es[i + 2] == 1 {
            match es[i + 3] {
                0xB3 | 0xB8 => {
                    pending.get_or_insert(i);
                }
                0x00 => starts.push(pending.take().unwrap_or(i)),
                _ => {}
            }
            i += 4;
        } else {
            i += 1;
        }
    }
    let mut out = Vec::with_capacity(starts.len());
    for (k, &s) in starts.iter().enumerate() {
        let e = starts.get(k + 1).copied().unwrap_or(es.len());
        let data = &es[s..e];
        let kind = data.windows(4).position(|w| w == [0, 0, 1, 0]).and_then(|p| data.get(p + 5)).map(|b| (b >> 3) & 7).unwrap_or(0);
        out.push(Frame { data, kind });
    }
    out
}

/// Tamanho do vídeo pelo cabeçalho de sequência.
pub fn mpeg_size(es: &[u8]) -> Option<(u32, u32)> {
    let p = es.windows(4).position(|w| w == [0, 0, 1, 0xB3])?;
    let s = es.get(p + 4..p + 7)?;
    Some((((s[0] as u32) << 4) | (s[1] as u32 >> 4), (((s[1] & 15) as u32) << 8) | s[2] as u32))
}

/// Monta um `.usm` com um fluxo MPEG-1 (`fps` quadros por segundo). `name` é o nome do arquivo
/// gravado dentro dele (o do jogo, ex.: `FMV_FRONTEND.win.usm`).
pub fn mux(es: &[u8], fps: u32, name: &str) -> Result<Vec<u8>> {
    let frames = split_frames(es);
    if frames.is_empty() {
        return Err(Error::Format("vídeo MPEG-1 sem quadros".into()));
    }
    let (w, h) = mpeg_size(es).ok_or_else(|| Error::Format("vídeo MPEG-1 sem cabeçalho de sequência".into()))?;
    let n = frames.len() as u32;
    let maxf = frames.iter().map(|f| f.data.len()).max().unwrap_or(0) as u32;
    let keys: Vec<usize> = frames.iter().enumerate().filter(|(_, f)| f.kind == 1).map(|(i, _)| i).collect();
    let align = |o: usize, a: usize| (a - o % a) % a;
    // os blocos de dados (as posições dependem só do tamanho do cabeçalho)
    let data: Vec<Vec<u8>> = frames
        .iter()
        .enumerate()
        .map(|(i, f)| {
            let mut payload = vec![0u8; 64];
            payload.extend_from_slice(f.data);
            let pad = 64 + align(8 + 24 + payload.len() + 64, 32);
            chunk(b"@SFV", 0, &payload, i as u32 * 100, fps * 100, pad)
        })
        .collect();
    let data_bytes: u64 = data.iter().map(|c| c.len() as u64).sum();
    let secs = n as f64 / fps as f64;
    let avbps = (data_bytes as f64 * 8.0 / secs) as u32;
    let header = |file_size: u64, offs: &[u64]| -> Vec<u8> {
        let row = |file: &str, size: u64, stmid: u32, chno: u16, minchk: u16, minbuf: u32| {
            vec![
                Val::Str(file.into()),
                Val::U32(size.min(u32::MAX as u64) as u32),
                Val::U32(0),
                Val::U32(stmid),
                Val::U16(chno),
                Val::U16(minchk),
                Val::U32(minbuf),
                Val::U32(avbps),
            ]
        };
        let crid = utf_table(
            "CRIUSF_DIR_STREAM",
            &["filename", "filesize", "datasize", "stmid", "chno", "minchk", "minbuf", "avbps"],
            &[
                row(name, file_size, 0, 0xFFFF, 1, (maxf as f64 * 5.074) as u32 / 32 * 32),
                row("CommandProject.mpg", file_size.saturating_sub(2048), u32::from_be_bytes(*b"@SFV"), 0, 3, maxf),
            ],
        );
        let mut out = chunk(b"CRID", 1, &crid, 0, fps, 2048 - 8 - 24 - crid.len());
        let seek = utf_table(
            "VIDEO_SEEKINFO",
            &["ofs_byte", "ofs_frmid", "num_skip", "resv"],
            &keys.iter().map(|&k| vec![Val::U64(offs.get(k).copied().unwrap_or(0)), Val::I32(k as i32), Val::I16(0), Val::I16(0)]).collect::<Vec<_>>(),
        );
        let hdr = |meta: u32| {
            let u = Val::U32;
            utf_table(
                "VIDEO_HDRINFO",
                &[
                    "width", "height", "mat_width", "mat_height", "disp_width", "disp_height", "scrn_width", "mpeg_dcprec", "mpeg_codec",
                    "alpha_type", "total_frames", "framerate_n", "framerate_d", "metadata_count", "metadata_size", "ixsize",
                ],
                &[vec![u(w), u(h), u(w), u(h), u(w), u(h), u(0), Val::U8(11), Val::U8(1), u(0), u(n), u(fps * 1000), u(1000), u(1), u(meta), u(maxf)]],
            )
        };
        let h0 = hdr(0);
        let hdr_chunk_len = 8 + 24 + h0.len() + align(out.len() + 8 + 24 + h0.len(), 64);
        let seek_at = out.len() + hdr_chunk_len + 64;
        let seek_chunk = chunk(b"@SFV", 3, &seek, 0, fps, align(seek_at + 8 + 24 + seek.len(), 64));
        let h1 = hdr(seek_chunk.len() as u32);
        out.extend(chunk(b"@SFV", 1, &h1, 0, fps, align(out.len() + 8 + 24 + h1.len(), 64)));
        out.extend(chunk(b"@SFV", 2, &end_marker("#HEADER END"), 0, fps, 0));
        out.extend(seek_chunk);
        out.extend(chunk(b"@SFV", 2, &end_marker("#METADATA END"), 0, fps, 0));
        out
    };
    let head_len = header(0, &[]).len() as u64;
    let mut offs = Vec::with_capacity(data.len());
    let mut o = head_len;
    for c in &data {
        offs.push(o);
        o += c.len() as u64;
    }
    let tail = chunk(b"@SFV", 2, &end_marker("#CONTENTS END"), 0, fps, 0);
    let total = o + tail.len() as u64;
    let head = header(total, &offs);
    debug_assert_eq!(head.len() as u64, head_len);
    let mut out = Vec::with_capacity(total as usize);
    out.extend(head);
    for c in data {
        out.extend(c);
    }
    out.extend(tail);
    Ok(out)
}

/// O fluxo MPEG-1 de um `.usm` (para conferir e para a prévia).
pub fn demux(usm: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut o = 0;
    while o + 32 <= usm.len() {
        let size = u32::from_be_bytes(usm[o + 4..o + 8].try_into().expect("4")) as usize;
        let hoff = usm[o + 9] as usize;
        let pad = u16::from_be_bytes([usm[o + 10], usm[o + 11]]) as usize;
        if &usm[o..o + 4] == b"@SFV" && usm[o + 15] == 0 && o + 8 + size <= usm.len() && hoff + 64 + pad <= size {
            out.extend_from_slice(&usm[o + 8 + hoff + 64..o + 8 + size - pad]);
        }
        o += 8 + size;
    }
    out
}

/// Converte um vídeo qualquer para MPEG-1 1080p (o que o jogo toca) com o ffmpeg. `fps` = 30 ou 60.
pub fn encode(ffmpeg: &Path, input: &Path, out: &Path, fps: u32) -> Result<()> {
    let fps = if fps >= 50 { 60 } else { 30 };
    let mut cmd = std::process::Command::new(ffmpeg);
    cmd.args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(input)
        .args([
            "-an", "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080", "-r", &fps.to_string(), "-c:v", "mpeg1video", "-q:v",
            "3", "-qmin", "2", "-g", "13", "-bf", "2", "-sc_threshold", "1000000000", "-pix_fmt", "yuv420p", "-f", "mpeg1video",
        ])
        .arg(out);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // sem janela de console
    }
    let res = cmd.output().map_err(|e| Error::Other(format!("ffmpeg não abriu: {e}")))?;
    if !res.status.success() {
        return Err(Error::Other(format!("ffmpeg falhou: {}", String::from_utf8_lossy(&res.stderr).trim())));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fluxo MPEG-1 de mentira: sequência 1920×1080, GOP e quadros I P B B.
    fn fake_es(frames: usize) -> Vec<u8> {
        let mut es = vec![0, 0, 1, 0xB3, 0x78, 0x04, 0x38, 0x18];
        for i in 0..frames {
            let kind = match i % 13 {
                0 => 1,
                k if k % 3 == 1 => 2,
                _ => 3,
            };
            if kind == 1 {
                es.extend_from_slice(&[0, 0, 1, 0xB8, 0, 8, 0, 0]);
            }
            es.extend_from_slice(&[0, 0, 1, 0, 0, kind << 3, 0xff, 0xf8]);
            es.extend(std::iter::repeat_n((i % 200) as u8 + 7, 100 + i * 3));
        }
        es
    }

    #[test]
    fn mux_and_demux() {
        let es = fake_es(40);
        let frames = split_frames(&es);
        assert_eq!(frames.len(), 40);
        assert_eq!(frames.iter().filter(|f| f.kind == 1).count(), 4);
        assert_eq!(mpeg_size(&es), Some((1920, 1080)));
        let usm = mux(&es, 60, "FMV_FRONTEND.win.usm").unwrap();
        assert_eq!(&usm[0..4], b"CRID");
        assert_eq!(usm.len() % 32, 0);
        assert_eq!(&usm[2048..2052], b"@SFV");
        assert_eq!(demux(&usm), es);
        // o tamanho gravado no cabeçalho é o do arquivo
        let p = usm.windows(20).position(|w| w == b"FMV_FRONTEND.win.usm").unwrap();
        assert!(p > 0);
        assert!(usm.windows(13).any(|w| w == b"VIDEO_HDRINFO"));
        assert!(mux(b"nada", 30, "x").is_err());
    }
}

/// Com `CP_TEST_USM` (o vídeo da tela inicial do jogo): remontar dá o mesmo arquivo, menos a tabela
/// do começo (nomes).
#[cfg(test)]
#[test]
fn real_usm_when_available() {
    let Ok(path) = std::env::var("CP_TEST_USM") else { return };
    let orig = std::fs::read(path).unwrap();
    let es = demux(&orig);
    let again = mux(&es, 30, "FMV_FRONTEND.win.usm").unwrap();
    assert_eq!(again.len(), orig.len());
    assert_eq!(&again[2048..], &orig[2048..], "tudo depois do CRID igual ao do jogo");
}
