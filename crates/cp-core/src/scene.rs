//! Cenas da interface do Supreme Commander 2 (`ui/scenes/<nome>/pc_<nome>.win.bdf`).
//!
//! O menu do jogo (tela inicial, opções, salas) não é feito em Lua: cada tela é uma "cena" binária
//! que o executável desenha. Formato (descoberto lendo o executável e conferido no jogo):
//! * contêiner MFDB igual ao do índice ([`crate::toc`]): cabeçalho de 8 `u32`, a lista de
//!   *fixups* (posições de ponteiros no conteúdo), as seções e o conteúdo em zlib;
//! * conteúdo: largura e altura virtuais (1024×768) e 16 pares (quantidade, ponteiro) de tabelas,
//!   uma por tipo de elemento (0 imagem, 1 grupo, 3 grupo de opções, 4 botão de opção, 5 texto,
//!   6 botão, 15 caixa de marcar...);
//! * cada elemento começa igual: filhos (quantidade, ponteiro para ids), eventos (quantidade,
//!   ponteiro para grupos `[tipo, quantidade, ponteiro → (nome, parâmetro)]`), ponteiro do
//!   retângulo (`x0, x1, y0, y1` + 3 zeros, em coordenadas 1024×768), ponteiro do nome e o id.
//!   No texto, o ponteiro da string fica em +112.
//!
//! Os eventos são tratadores do executável; os que valem em qualquer cena incluem `PlaySound` e
//! `ConsoleExecute` — com `UI_Lua <código>` como parâmetro, o botão roda Lua na interface. Assim um
//! botão novo no menu chama código de mod.
//!
//! Nenhum ponteiro aponta para dentro das tabelas (só o cabeçalho), então uma tabela inteira pode ir
//! para o fim do conteúdo com um registro a mais: é assim que elementos novos são criados.

use crate::error::{Error, Result};
use std::collections::BTreeSet;
use std::io::{Read, Write};

/// Ponteiro nulo.
pub const NONE: u32 = u32::MAX;
/// Tamanho do registro de cada tipo de elemento (os tipos sem tamanho conhecido não aparecem nas
/// cenas do menu; uma cena que os use não pode ser editada).
const SIZES: [Option<usize>; 16] = [
    Some(128),
    Some(108),
    None,
    Some(120),
    Some(156),
    Some(148),
    Some(136),
    Some(144),
    Some(164),
    None,
    None,
    None,
    Some(128),
    Some(152),
    Some(136),
    Some(156),
];
/// Tipos de elemento.
pub mod kind {
    pub const BITMAP: u32 = 0;
    pub const GROUP: u32 = 1;
    pub const RADIO_GROUP: u32 = 3;
    pub const RADIO_BUTTON: u32 = 4;
    pub const TEXT: u32 = 5;
    pub const BUTTON: u32 = 6;
}
/// Tipos de evento.
pub mod event {
    /// mouse em cima
    pub const ROLLOVER: u32 = 2;
    /// apertou (som)
    pub const PRESS: u32 = 5;
    /// clique (botões comuns)
    pub const CLICK: u32 = 7;
    /// escolhido (botões de opção, como os do menu principal)
    pub const SELECT: u32 = 22;
}

const MAX_PAYLOAD: usize = 64 * 1024 * 1024;

fn bad(msg: impl Into<String>) -> Error {
    Error::Format(format!("cena da interface inválida: {}", msg.into()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Element {
    pub kind: u32,
    /// Posição do registro no conteúdo (muda quando a tabela vai para o fim).
    pub rec: usize,
    pub name: String,
    pub id: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Event {
    pub kind: u32,
    pub name: String,
    pub param: String,
}

impl Event {
    pub fn new(kind: u32, name: &str, param: &str) -> Event {
        Event { kind, name: name.into(), param: param.into() }
    }
}

/// Retângulo em coordenadas virtuais (1024×768).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x0: i32,
    pub x1: i32,
    pub y0: i32,
    pub y1: i32,
}

impl Rect {
    pub fn moved(self, dy: i32) -> Rect {
        Rect { y0: self.y0 + dy, y1: self.y1 + dy, ..self }
    }
    pub fn shifted(self, dx: i32, dy: i32) -> Rect {
        Rect { x0: self.x0 + dx, x1: self.x1 + dx, y0: self.y0 + dy, y1: self.y1 + dy }
    }
    pub fn new(x0: i32, x1: i32, y0: i32, y1: i32) -> Rect {
        Rect { x0, x1, y0, y1 }
    }
    pub fn height(self) -> i32 {
        self.y1 - self.y0
    }
}

/// Âncoras de um elemento (veja [`Scene::set_anchors`]).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Anchors {
    pub left: Option<i32>,
    pub right: Option<i32>,
    pub top: Option<i32>,
    pub bottom: Option<i32>,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

pub struct Scene {
    head: [u32; 8],
    sections: Vec<u32>,
    fixups: BTreeSet<u32>,
    pl: Vec<u8>,
}

impl Scene {
    pub fn parse(data: &[u8]) -> Result<Scene> {
        if data.len() < 32 || &data[0..4] != b"MFDB" {
            return Err(bad("assinatura MFDB ausente"));
        }
        let at = |o: usize| -> Result<u32> {
            data.get(o..o + 4).map(|b| u32::from_le_bytes(b.try_into().expect("4"))).ok_or_else(|| bad("arquivo cortado"))
        };
        let mut head = [0u32; 8];
        for (i, h) in head.iter_mut().enumerate() {
            *h = at(i * 4)?;
        }
        let (nfix, nsec) = (head[6] as usize, head[7] as usize);
        if nfix > 1 << 20 || nsec > 64 {
            return Err(bad("cabeçalho"));
        }
        let fixups = (0..nfix).map(|i| at(32 + 4 * i)).collect::<Result<BTreeSet<u32>>>()?;
        let sections = (0..nsec).map(|i| at(32 + 4 * (nfix + i))).collect::<Result<Vec<u32>>>()?;
        let start = 32 + 4 * (nfix + nsec);
        let inflate = |o: usize| -> Option<Vec<u8>> {
            let mut out = Vec::new();
            flate2::read::ZlibDecoder::new(data.get(o..)?).take(MAX_PAYLOAD as u64 + 1).read_to_end(&mut out).ok()?;
            (out.len() == head[5] as usize && out.len() <= MAX_PAYLOAD).then_some(out)
        };
        let pl = inflate(start.div_ceil(32) * 32)
            .or_else(|| (start..data.len().saturating_sub(1)).filter(|&o| data[o] == 0x78 && data[o + 1] == 0x9c).find_map(inflate))
            .ok_or_else(|| bad("conteúdo ilegível"))?;
        let s = Scene { head, sections, fixups, pl };
        if s.pl.len() < 136 {
            return Err(bad("conteúdo curto"));
        }
        s.elements()?;
        Ok(s)
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        let mut pl = self.pl.clone();
        while !pl.len().is_multiple_of(4) {
            pl.push(0);
        }
        let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::new(6));
        z.write_all(&pl).expect("memória");
        let comp = z.finish().expect("memória");
        let mut head = self.head;
        head[4] = comp.len() as u32;
        head[5] = pl.len() as u32;
        head[6] = self.fixups.len() as u32;
        head[7] = self.sections.len() as u32;
        let mut out = Vec::with_capacity(64 + 4 * self.fixups.len() + comp.len());
        for h in head {
            out.extend_from_slice(&h.to_le_bytes());
        }
        for f in &self.fixups {
            out.extend_from_slice(&f.to_le_bytes());
        }
        for s in &self.sections {
            out.extend_from_slice(&s.to_le_bytes());
        }
        while !out.len().is_multiple_of(32) {
            out.push(0);
        }
        out.extend_from_slice(&comp);
        while !out.len().is_multiple_of(32) {
            out.push(0);
        }
        out
    }

    // ---------------------------------------------------------------- leitura

    fn u32_at(&self, o: usize) -> Result<u32> {
        self.pl.get(o..o + 4).map(|b| u32::from_le_bytes(b.try_into().expect("4"))).ok_or_else(|| bad("ponteiro fora do conteúdo"))
    }

    fn i32_at(&self, o: usize) -> Result<i32> {
        self.u32_at(o).map(|v| v as i32)
    }

    fn cstr(&self, o: u32) -> Result<String> {
        if o == NONE {
            return Ok(String::new());
        }
        let rest = self.pl.get(o as usize..).ok_or_else(|| bad("texto fora do conteúdo"))?;
        let end = rest.iter().position(|&b| b == 0).ok_or_else(|| bad("texto sem fim"))?;
        Ok(String::from_utf8_lossy(&rest[..end]).into_owned())
    }

    /// Largura e altura virtuais.
    pub fn size(&self) -> (u32, u32) {
        (self.u32_at(0).unwrap_or(1024), self.u32_at(4).unwrap_or(768))
    }

    fn table(&self, k: usize) -> Result<(usize, u32)> {
        Ok((self.u32_at(8 + 8 * k)? as usize, self.u32_at(12 + 8 * k)?))
    }

    pub fn elements(&self) -> Result<Vec<Element>> {
        let mut out = Vec::new();
        for (k, size) in SIZES.iter().enumerate() {
            let (n, p) = self.table(k)?;
            if n == 0 || p == NONE {
                continue;
            }
            let size = size.ok_or_else(|| bad(format!("tipo de elemento {k} desconhecido")))?;
            if n > 100_000 || p as usize + n * size > self.pl.len() {
                return Err(bad("tabela fora do conteúdo"));
            }
            for i in 0..n {
                let rec = p as usize + i * size;
                out.push(Element { kind: k as u32, rec, name: self.cstr(self.u32_at(rec + 20)?)?, id: self.u32_at(rec + 28)? });
            }
        }
        Ok(out)
    }

    pub fn by_id(&self, id: u32) -> Result<Element> {
        self.elements()?.into_iter().find(|e| e.id == id).ok_or_else(|| bad(format!("elemento {id} não existe")))
    }

    /// O primeiro elemento com esse nome (nomes podem repetir: prefira o id).
    pub fn by_name(&self, name: &str) -> Result<Element> {
        self.elements()?.into_iter().find(|e| e.name == name).ok_or_else(|| bad(format!("elemento \"{name}\" não existe")))
    }

    pub fn children(&self, id: u32) -> Result<Vec<u32>> {
        let rec = self.by_id(id)?.rec;
        let (n, p) = (self.u32_at(rec)? as usize, self.u32_at(rec + 4)?);
        if n == 0 || p == NONE {
            return Ok(Vec::new());
        }
        (0..n).map(|i| self.u32_at(p as usize + 4 * i)).collect()
    }

    pub fn rect(&self, id: u32) -> Result<Option<Rect>> {
        let rec = self.by_id(id)?.rec;
        let p = self.u32_at(rec + 16)?;
        if p == NONE {
            return Ok(None);
        }
        let p = p as usize;
        Ok(Some(Rect { x0: self.i32_at(p)?, x1: self.i32_at(p + 4)?, y0: self.i32_at(p + 8)?, y1: self.i32_at(p + 12)? }))
    }

    pub fn events(&self, id: u32) -> Result<Vec<Event>> {
        let rec = self.by_id(id)?.rec;
        let (n, p) = (self.u32_at(rec + 8)? as usize, self.u32_at(rec + 12)?);
        let mut out = Vec::new();
        if n == 0 || p == NONE {
            return Ok(out);
        }
        for j in 0..n.min(256) {
            let g = p as usize + 12 * j;
            let (t, c, pp) = (self.u32_at(g)?, self.u32_at(g + 4)? as usize, self.u32_at(g + 8)?);
            for q in 0..c.min(256) {
                let e = pp as usize + 8 * q;
                out.push(Event { kind: t, name: self.cstr(self.u32_at(e)?)?, param: self.cstr(self.u32_at(e + 4)?)? });
            }
        }
        Ok(out)
    }

    /// Texto de um elemento de texto.
    pub fn text(&self, id: u32) -> Result<String> {
        let e = self.by_id(id)?;
        if e.kind != kind::TEXT {
            return Err(bad(format!("\"{}\" não é um texto", e.name)));
        }
        self.cstr(self.u32_at(e.rec + 112)?)
    }

    pub fn max_id(&self) -> Result<u32> {
        Ok(self.elements()?.iter().map(|e| e.id).filter(|&i| i != NONE).max().unwrap_or(0))
    }

    // ---------------------------------------------------------------- escrita

    fn align(&mut self) {
        while !self.pl.len().is_multiple_of(4) {
            self.pl.push(0);
        }
    }

    fn put(&mut self, o: usize, v: u32) {
        self.pl[o..o + 4].copy_from_slice(&v.to_le_bytes());
    }

    fn set_ptr(&mut self, o: usize, v: u32) {
        self.put(o, v);
        self.fixups.insert(o as u32);
    }

    fn add_str(&mut self, s: &str) -> u32 {
        self.align();
        let o = self.pl.len();
        self.pl.extend_from_slice(s.replace('\0', "").as_bytes());
        self.pl.push(0);
        o as u32
    }

    /// Acrescenta `u32`s no fim; as posições em `ptrs` são ponteiros.
    fn add_u32s(&mut self, vals: &[u32], ptrs: &[usize]) -> u32 {
        self.align();
        let o = self.pl.len();
        for v in vals {
            self.pl.extend_from_slice(&v.to_le_bytes());
        }
        for &i in ptrs {
            self.fixups.insert((o + 4 * i) as u32);
        }
        o as u32
    }

    pub fn set_children(&mut self, id: u32, ids: &[u32]) -> Result<()> {
        let rec = self.by_id(id)?.rec;
        let p = if ids.is_empty() { NONE } else { self.add_u32s(ids, &[]) };
        self.put(rec, ids.len() as u32);
        self.set_ptr(rec + 4, p);
        Ok(())
    }

    pub fn set_rect(&mut self, id: u32, r: Rect) -> Result<()> {
        let rec = self.by_id(id)?.rec;
        let p = self.add_u32s(&[r.x0 as u32, r.x1 as u32, r.y0 as u32, r.y1 as u32, 0, 0, 0], &[]);
        self.set_ptr(rec + 16, p);
        Ok(())
    }

    pub fn set_events(&mut self, id: u32, evs: &[Event]) -> Result<()> {
        let rec = self.by_id(id)?.rec;
        // eventos seguidos do mesmo tipo ficam no mesmo grupo, na ordem
        let mut groups: Vec<(u32, Vec<&Event>)> = Vec::new();
        for e in evs {
            match groups.last_mut() {
                Some((t, list)) if *t == e.kind => list.push(e),
                _ => groups.push((e.kind, vec![e])),
            }
        }
        let mut table = Vec::new();
        for (t, list) in &groups {
            let mut vals = Vec::new();
            for e in list {
                vals.push(self.add_str(&e.name));
                vals.push(self.add_str(&e.param));
            }
            let ptrs: Vec<usize> = (0..vals.len()).collect();
            let p = self.add_u32s(&vals, &ptrs);
            table.extend_from_slice(&[*t, list.len() as u32, p]);
        }
        let p = if groups.is_empty() {
            NONE
        } else {
            let ptrs: Vec<usize> = (0..groups.len()).map(|i| 3 * i + 2).collect();
            self.add_u32s(&table, &ptrs)
        };
        self.put(rec + 8, groups.len() as u32);
        self.set_ptr(rec + 12, p);
        Ok(())
    }

    pub fn set_text(&mut self, id: u32, text: &str) -> Result<()> {
        let e = self.by_id(id)?;
        if e.kind != kind::TEXT {
            return Err(bad(format!("\"{}\" não é um texto", e.name)));
        }
        let p = self.add_str(text);
        self.set_ptr(e.rec + 112, p);
        Ok(())
    }

    /// Texto apontado por um campo do registro (ex.: textura de uma imagem em +112).
    pub fn str_field(&self, id: u32, off: usize) -> Result<String> {
        let rec = self.by_id(id)?.rec;
        self.cstr(self.u32_at(rec + off)?)
    }

    /// Troca o texto apontado por um campo (textura, fonte...).
    pub fn set_str_field(&mut self, id: u32, off: usize, text: &str) -> Result<()> {
        let rec = self.by_id(id)?.rec;
        let p = self.add_str(text);
        self.set_ptr(rec + off, p);
        Ok(())
    }

    /// Um campo numérico do registro.
    pub fn set_u32(&mut self, id: u32, off: usize, v: u32) -> Result<()> {
        let rec = self.by_id(id)?.rec;
        self.put(rec + off, v);
        Ok(())
    }

    /// Âncoras de um elemento da raiz da cena (os de dentro de grupos seguem o grupo). O jogo
    /// mostra uma área de 1920×1080 unidades com o centro no centro da tela 1024×768 (x de −448 a
    /// 1472 e y de −156 a 924 em 16:9): `left`/`right`/`top`/`bottom` prendem a borda à borda da
    /// tela (distância), `x`/`y` põem a esquerda/o topo numa posição em relação ao centro.
    pub fn set_anchors(&mut self, id: u32, a: Anchors) -> Result<()> {
        let rec = self.by_id(id)?.rec;
        for k in 1..13 {
            self.put(rec + 32 + 4 * k, 0);
        }
        let mut put = |k: usize, v: Option<i32>, center: i32, edge: bool| {
            if let Some(v) = v {
                let val = if edge { v } else { center - v };
                self.put(rec + 32 + 4 * k, val as u32);
                self.put(rec + 32 + 4 * (k + 1), 1);
            }
        };
        put(1, a.left, 0, true);
        put(3, a.right, 0, true);
        put(5, a.top, 0, true);
        put(7, a.bottom, 0, true);
        put(9, a.x, 512, false);
        put(11, a.y, 384, false);
        Ok(())
    }

    /// Copia o elemento `src` (mesmo tipo e aparência) com outro nome e um id novo, no fim da
    /// tabela dele. Filhos, eventos e retângulo da cópia são listas próprias (mudar um não muda o
    /// outro). Devolve o id novo.
    pub fn clone_element(&mut self, src: u32, new_name: &str) -> Result<u32> {
        let e = self.by_id(src)?;
        let k = e.kind as usize;
        let size = SIZES[k].ok_or_else(|| bad("tipo desconhecido"))?;
        let (n, p) = self.table(k)?;
        let p = p as usize;
        let new_id = self.max_id()? + 1;
        self.align();
        let newp = self.pl.len();
        let old = self.pl[p..p + n * size].to_vec();
        let rec_bytes = self.pl[e.rec..e.rec + size].to_vec();
        self.pl.extend_from_slice(&old);
        self.pl.extend_from_slice(&rec_bytes);
        let moved: Vec<u32> = self.fixups.iter().copied().filter(|&f| (p..p + n * size).contains(&(f as usize))).collect();
        for f in moved {
            self.fixups.insert((f as usize - p + newp) as u32);
        }
        let own: Vec<u32> = self.fixups.iter().copied().filter(|&f| (e.rec..e.rec + size).contains(&(f as usize))).collect();
        for f in own {
            self.fixups.insert((f as usize - e.rec + newp + n * size) as u32);
        }
        self.put(8 + 8 * k, (n + 1) as u32);
        self.set_ptr(12 + 8 * k, newp as u32);
        let rec = newp + n * size;
        let name = self.add_str(new_name);
        self.set_ptr(rec + 20, name);
        self.put(rec + 28, new_id);
        // listas próprias
        let kids = self.children(new_id)?;
        self.set_children(new_id, &kids)?;
        let evs = self.events(new_id)?;
        self.set_events(new_id, &evs)?;
        if let Some(r) = self.rect(new_id)? {
            self.set_rect(new_id, r)?;
        }
        Ok(new_id)
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// (id, nome, retângulo, filhos, texto, eventos)
    type Rec<'a> = (u32, &'a str, [i32; 4], &'a [u32], &'a str, &'a [(u32, &'a str, &'a str)]);

    /// Monta uma cena no formato do jogo com as tabelas dadas (tipo → registros).
    fn build_sample(tables: &[(usize, &[Rec])]) -> Vec<u8> {
        let mut pl = vec![0u8; 136];
        pl[0..4].copy_from_slice(&1024u32.to_le_bytes());
        pl[4..8].copy_from_slice(&768u32.to_le_bytes());
        for k in 0..16 {
            pl[12 + 8 * k..16 + 8 * k].copy_from_slice(&NONE.to_le_bytes());
        }
        let mut s = Scene { head: [u32::from_le_bytes(*b"MFDB"), 7, 2, 0, 0, 0, 0, 1], sections: vec![0], fixups: BTreeSet::new(), pl };
        for (k, recs) in tables {
            let k = *k;
            let size = SIZES[k].unwrap();
            s.align();
            let p = s.pl.len();
            s.pl.resize(p + size * recs.len(), 0);
            s.put(8 + 8 * k, recs.len() as u32);
            s.set_ptr(12 + 8 * k, p as u32);
            for (i, (id, name, r, kids, text, _)) in recs.iter().enumerate() {
                let rec = p + i * size;
                let nm = s.add_str(name);
                s.set_ptr(rec + 20, nm);
                s.put(rec + 28, *id);
                s.set_ptr(rec + 24, NONE);
                let rp = s.add_u32s(&[r[0] as u32, r[1] as u32, r[2] as u32, r[3] as u32, 0, 0, 0], &[]);
                s.set_ptr(rec + 16, rp);
                let kp = if kids.is_empty() { NONE } else { s.add_u32s(kids, &[]) };
                s.put(rec, kids.len() as u32);
                s.set_ptr(rec + 4, kp);
                s.set_ptr(rec + 12, NONE);
                if k == kind::TEXT as usize {
                    let t = s.add_str(text);
                    s.set_ptr(rec + 112, t);
                }
            }
        }
        for (_, recs) in tables {
            for (id, _, _, _, _, evs) in recs.iter() {
                if !evs.is_empty() {
                    let evs: Vec<Event> = evs.iter().map(|(k, n, p)| Event::new(*k, n, p)).collect();
                    s.set_events(*id, &evs).unwrap();
                }
            }
        }
        s.to_bytes()
    }

    const SND: &str = "SC2/SC2/Interface/Frontend/snd_UI_PC_Frontend_Select";

    /// A tela inicial do jogo em miniatura: mesmos nomes, posições e eventos dos botões.
    pub fn menu_sample() -> Vec<u8> {
        let ev_main = |group: &'static str| -> Vec<(u32, &'static str, &'static str)> {
            vec![(event::ROLLOVER, "PlaySound", SND), (event::PRESS, "PlaySound", SND), (event::SELECT, "ShowMainMenuGroup", group)]
        };
        let opt: &[(u32, &str, &str)] = &[(event::PRESS, "PlaySound", SND), (event::SELECT, "RequestOptionsMenu", ""), (event::SELECT, "ShowMainMenuGroup", "")];
        let quit: &[(u32, &str, &str)] = &[(event::PRESS, "PlaySound", SND), (event::SELECT, "RequestExitDialog", ""), (event::SELECT, "ShowMainMenuGroup", "")];
        let cred: &[(u32, &str, &str)] = &[(event::PRESS, "PlaySound", SND), (event::SELECT, "RequestCredits", "")];
        let rep: &[(u32, &str, &str)] = &[(event::PRESS, "PlaySound", SND), (event::SELECT, "RequestReplays", "")];
        let (camp, skir, mp, ext) = (ev_main("g_campaign_options"), ev_main(""), ev_main(""), ev_main("g_extras_options"));
        let b = |y: i32| [78, 455, y, y + 52];
        let l = |y: i32| [109, 424, y + 6, y + 46];
        let sb = |y: i32| [460, 837, y, y + 52];
        let sl = |y: i32| [491, 806, y + 6, y + 46];
        build_sample(&[
            (1, &[
                (278, "g_campaign_options", [459, 837, 439, 640], &[240], "", &[]),
                (281, "g_extras_options", [460, 837, 589, 690], &[276, 272], "", &[]),
            ]),
            (3, &[(236, "rg_menu_group", [78, 455, 439, 741], &[214, 218, 222, 226, 230, 234], "", &[])]),
            (4, &[
                (214, "rb_campaign", b(439), &[215, 278], "", &camp),
                (218, "rb_skirmish", b(489), &[219], "", &skir),
                (222, "rb_multiplayer", b(539), &[223], "", &mp),
                (226, "rb_options", b(589), &[227], "", opt),
                (230, "rb_extras", b(639), &[231, 281], "", &ext),
                (234, "rb_quit", b(689), &[235], "", quit),
                (240, "rb_tutorial", sb(439), &[241], "", &[]),
                (272, "rb_replays", sb(589), &[273], "", rep),
                (276, "rb_credits", sb(638), &[277], "", cred),
            ]),
            (5, &[
                (215, "rb_campaign_label", l(439), &[], "<LOC b_campaign>CAMPAIGN", &[]),
                (219, "rb_skirmish_label", l(489), &[], "<LOC b_skirmish>SKIRMISH", &[]),
                (223, "rb_multiplayer_label", l(539), &[], "<LOC b_mp>MULTIPLAYER", &[]),
                (227, "rb_options_label", l(589), &[], "<LOC b_options>OPTIONS", &[]),
                (231, "rb_extras_label", l(639), &[], "<LOC b_extras>EXTRAS", &[]),
                (235, "rb_quit_label", l(689), &[], "<LOC b_quit>QUIT", &[]),
                (241, "rb_tutorial_label", sl(439), &[], "<LOC b_tut>TUTORIAL", &[]),
                // dois textos com o mesmo nome, como no jogo
                (265, "rb_joingame_label", sl(539), &[], "<LOC b_join>JOIN GAME", &[]),
                (273, "rb_joingame_label", sl(589), &[], "<LOC b_replays>REPLAYS", &[]),
                (277, "rb_credits_label", sl(638), &[], "<LOC b_credits>CREDITS", &[]),
            ]),
        ])
    }

    #[test]
    fn roundtrip_edit_and_clone() {
        let data = menu_sample();
        let mut s = Scene::parse(&data).unwrap();
        assert_eq!(s.size(), (1024, 768));
        assert_eq!(s.elements().unwrap().len(), 22);
        assert_eq!(s.text(231).unwrap(), "<LOC b_extras>EXTRAS");
        assert_eq!(s.text(273).unwrap(), "<LOC b_replays>REPLAYS");
        assert_eq!(s.children(230).unwrap(), vec![231, 281]);
        let id = s.clone_element(226, "rb_new").unwrap();
        assert_eq!(id, 282);
        s.set_events(id, &[Event::new(event::SELECT, "ConsoleExecute", "UI_Lua print('a')")]).unwrap();
        s.set_rect(id, Rect { x0: 1, x1: 2, y0: 3, y1: 4 }).unwrap();
        let back = Scene::parse(&s.to_bytes()).unwrap();
        assert_eq!(back.by_name("rb_new").unwrap().id, id);
        assert_eq!(back.rect(id).unwrap(), Some(Rect { x0: 1, x1: 2, y0: 3, y1: 4 }));
        // o original não mudou junto
        assert_eq!(back.rect(226).unwrap().unwrap().y0, 589);
        assert_eq!(back.events(226).unwrap().len(), 3);
        assert_eq!(back.events(id).unwrap(), vec![Event::new(event::SELECT, "ConsoleExecute", "UI_Lua print('a')")]);
        assert_eq!(back.children(id).unwrap(), vec![227]);
        // ponteiros da tabela que mudou de lugar continuam válidos
        assert_eq!(back.text(227).unwrap(), "<LOC b_options>OPTIONS");
        assert_eq!(back.by_name("rb_quit").unwrap().id, 234);
        assert!(Scene::parse(b"MFDB").is_err());
    }
}
