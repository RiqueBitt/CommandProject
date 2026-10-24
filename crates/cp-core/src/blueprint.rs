//! Blueprints do jogo em texto (`UnitBlueprint { ... }`, tabelas Lua com comentários `#` e `--`).
//!
//! O editor de tropas não reescreve o arquivo inteiro: lê a árvore com a posição (bytes) de cada
//! valor e troca só o trecho do valor alterado, mantendo comentários, ordem e formatação do
//! original. Campos que não existem são acrescentados no fim da tabela certa.
//!
//! Caminhos: nomes de campo separados por ponto e posições de lista começando em 1, como em Lua
//! (`Defense.MaxHealth`, `Weapon.1.Damage`, `Categories` para a lista inteira).

use serde::Serialize;

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Number(f64),
    Str(String),
    Bool(bool),
    Nil,
    /// tabela; `call` = nome quando escrita como chamada (`Sound { ... }`)
    Table { entries: Vec<Entry>, call: Option<String> },
    /// expressão que não entendemos (ex.: chamada com parênteses): fica intocada
    Raw(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    /// `None` = item de lista (posição implícita)
    pub key: Option<Key>,
    pub value: Value,
    /// trecho do valor no texto original
    pub span: (usize, usize),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Key {
    Name(String),
    Index(i64),
}

#[derive(Debug, Clone)]
pub struct Blueprint {
    pub kind: String,
    pub root: Value,
    /// trecho da tabela raiz (inclui as chaves)
    pub span: (usize, usize),
}

/// Folha editável: número, texto ou verdadeiro/falso.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Leaf {
    pub path: String,
    pub kind: &'static str,
    pub number: Option<f64>,
    pub text: Option<String>,
    pub flag: Option<bool>,
}

struct P<'a> {
    s: &'a [u8],
    i: usize,
}

fn err(msg: &str, at: usize) -> Error {
    Error::Format(format!("blueprint: {msg} (posição {at})"))
}

impl<'a> P<'a> {
    fn skip(&mut self) {
        loop {
            while self.i < self.s.len() && self.s[self.i].is_ascii_whitespace() {
                self.i += 1;
            }
            if self.s[self.i..].starts_with(b"--[[") {
                match find(self.s, self.i + 4, b"]]") {
                    Some(e) => self.i = e + 2,
                    None => self.i = self.s.len(),
                }
            } else if self.s[self.i..].starts_with(b"--") || self.s.get(self.i) == Some(&b'#') {
                while self.i < self.s.len() && self.s[self.i] != b'\n' {
                    self.i += 1;
                }
            } else {
                break;
            }
        }
    }

    fn peek(&mut self) -> Option<u8> {
        self.skip();
        self.s.get(self.i).copied()
    }

    fn ident(&mut self) -> Option<String> {
        self.skip();
        let st = self.i;
        while self.i < self.s.len() && (self.s[self.i].is_ascii_alphanumeric() || self.s[self.i] == b'_') {
            self.i += 1;
        }
        if st == self.i || self.s[st].is_ascii_digit() {
            self.i = st;
            return None;
        }
        Some(String::from_utf8_lossy(&self.s[st..self.i]).into_owned())
    }

    fn string(&mut self) -> Result<String> {
        let q = self.s[self.i];
        let start = self.i;
        self.i += 1;
        let mut out = Vec::new();
        while self.i < self.s.len() && self.s[self.i] != q {
            if self.s[self.i] == b'\\' && self.i + 1 < self.s.len() {
                self.i += 1;
                out.push(match self.s[self.i] {
                    b'n' => b'\n',
                    b't' => b'\t',
                    c => c,
                });
            } else {
                out.push(self.s[self.i]);
            }
            self.i += 1;
        }
        if self.i >= self.s.len() {
            return Err(err("texto sem fim", start));
        }
        self.i += 1;
        Ok(String::from_utf8_lossy(&out).into_owned())
    }

    fn number(&mut self) -> Option<f64> {
        let st = self.i;
        if matches!(self.s.get(self.i), Some(b'-') | Some(b'+')) {
            self.i += 1;
        }
        if self.s[self.i..].starts_with(b"0x") || self.s[self.i..].starts_with(b"0X") {
            self.i += 2;
            let hs = self.i;
            while self.i < self.s.len() && self.s[self.i].is_ascii_hexdigit() {
                self.i += 1;
            }
            let v = i64::from_str_radix(std::str::from_utf8(&self.s[hs..self.i]).ok()?, 16).ok()? as f64;
            return Some(if self.s[st] == b'-' { -v } else { v });
        }
        while self.i < self.s.len() && (self.s[self.i].is_ascii_digit() || matches!(self.s[self.i], b'.' | b'e' | b'E') || ((self.s[self.i] == b'-' || self.s[self.i] == b'+') && matches!(self.s[self.i - 1], b'e' | b'E'))) {
            self.i += 1;
        }
        let v = std::str::from_utf8(&self.s[st..self.i]).ok()?.parse::<f64>().ok();
        if v.is_none() {
            self.i = st;
        }
        v
    }

    fn value(&mut self) -> Result<(Value, (usize, usize))> {
        self.skip();
        let st = self.i;
        let c = *self.s.get(self.i).ok_or_else(|| err("valor faltando", st))?;
        let v = match c {
            b'{' => self.table(None)?,
            b'\'' | b'"' => Value::Str(self.string()?),
            b'-' | b'+' | b'.' | b'0'..=b'9' => match self.number() {
                Some(n) => Value::Number(n),
                None => return Err(err("número inválido", st)),
            },
            _ => {
                let id = self.ident().ok_or_else(|| err("valor inesperado", st))?;
                match id.as_str() {
                    "true" => Value::Bool(true),
                    "false" => Value::Bool(false),
                    "nil" => Value::Nil,
                    _ => match self.peek() {
                        Some(b'{') => self.table(Some(id))?,
                        Some(b'(') => {
                            // chamada com parênteses: guarda o texto inteiro
                            let mut depth = 0i32;
                            while self.i < self.s.len() {
                                match self.s[self.i] {
                                    b'(' => depth += 1,
                                    b')' => {
                                        depth -= 1;
                                        if depth == 0 {
                                            self.i += 1;
                                            break;
                                        }
                                    }
                                    b'\'' | b'"' => {
                                        self.string()?;
                                        continue;
                                    }
                                    _ => {}
                                }
                                self.i += 1;
                            }
                            Value::Raw(String::from_utf8_lossy(&self.s[st..self.i]).into_owned())
                        }
                        _ => {
                            // nome com pontos (ex.: categories.UEF): guarda como texto bruto
                            while self.i < self.s.len() && (self.s[self.i].is_ascii_alphanumeric() || matches!(self.s[self.i], b'_' | b'.')) {
                                self.i += 1;
                            }
                            Value::Raw(String::from_utf8_lossy(&self.s[st..self.i]).into_owned())
                        }
                    },
                }
            }
        };
        Ok((v, (st, self.i)))
    }

    fn table(&mut self, call: Option<String>) -> Result<Value> {
        self.skip();
        let open = self.i;
        if self.s.get(self.i) != Some(&b'{') {
            return Err(err("esperava '{'", open));
        }
        self.i += 1;
        let mut entries = Vec::new();
        loop {
            match self.peek() {
                None => return Err(err("tabela sem fim", open)),
                Some(b'}') => {
                    self.i += 1;
                    break;
                }
                Some(b',') | Some(b';') => {
                    self.i += 1;
                    continue;
                }
                Some(b'[') => {
                    self.i += 1;
                    let (k, _) = self.value()?;
                    if self.peek() != Some(b']') {
                        return Err(err("esperava ']'", self.i));
                    }
                    self.i += 1;
                    if self.peek() != Some(b'=') {
                        return Err(err("esperava '='", self.i));
                    }
                    self.i += 1;
                    let (v, span) = self.value()?;
                    let key = match k {
                        Value::Str(s) => Key::Name(s),
                        Value::Number(n) => Key::Index(n as i64),
                        _ => return Err(err("chave inválida", self.i)),
                    };
                    entries.push(Entry { key: Some(key), value: v, span });
                }
                Some(_) => {
                    let save = self.i;
                    if let Some(id) = self.ident() {
                        if self.peek() == Some(b'=') && self.s.get(self.i + 1) != Some(&b'=') {
                            self.i += 1;
                            let (v, span) = self.value()?;
                            entries.push(Entry { key: Some(Key::Name(id)), value: v, span });
                            continue;
                        }
                    }
                    self.i = save;
                    let (v, span) = self.value()?;
                    entries.push(Entry { key: None, value: v, span });
                }
            }
        }
        Ok(Value::Table { entries, call })
    }
}

fn find(s: &[u8], from: usize, pat: &[u8]) -> Option<usize> {
    s.get(from..)?.windows(pat.len()).position(|w| w == pat).map(|p| p + from)
}

/// Lê um blueprint (`XBlueprint { ... }`). O texto pode ter comentários antes.
pub fn parse(text: &str) -> Result<Blueprint> {
    let mut p = P { s: text.as_bytes(), i: 0 };
    let kind = p.ident().ok_or_else(|| err("esperava o tipo do blueprint (ex.: UnitBlueprint)", p.i))?;
    p.skip();
    let st = p.i;
    let root = p.table(Some(kind.clone()))?;
    Ok(Blueprint { kind, root, span: (st, p.i) })
}

impl Value {
    pub fn entries(&self) -> &[Entry] {
        match self {
            Value::Table { entries, .. } => entries,
            _ => &[],
        }
    }

    /// Item por nome, ou pela posição (1, 2, …) entre os itens sem nome.
    pub fn child(&self, part: &str) -> Option<&Entry> {
        let entries = self.entries();
        if let Ok(n) = part.parse::<usize>() {
            if let Some(e) = entries.iter().find(|e| e.key == Some(Key::Index(n as i64))) {
                return Some(e);
            }
            return entries.iter().filter(|e| e.key.is_none()).nth(n.checked_sub(1)?);
        }
        entries.iter().rev().find(|e| matches!(&e.key, Some(Key::Name(k)) if k == part))
    }

    pub fn as_number(&self) -> Option<f64> {
        match self {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    /// Textos de uma lista (ex.: Categories).
    pub fn strings(&self) -> Vec<String> {
        self.entries().iter().filter_map(|e| e.value.as_str().map(str::to_owned)).collect()
    }
}

impl Blueprint {
    pub fn get(&self, path: &str) -> Option<&Value> {
        let mut cur = &self.root;
        for part in path.split('.').filter(|p| !p.is_empty()) {
            cur = &cur.child(part)?.value;
        }
        Some(cur)
    }

    fn entry(&self, path: &str) -> Option<&Entry> {
        let mut cur = &self.root;
        let mut last = None;
        for part in path.split('.').filter(|p| !p.is_empty()) {
            let e = cur.child(part)?;
            cur = &e.value;
            last = Some(e);
        }
        last
    }

    pub fn number(&self, path: &str) -> Option<f64> {
        self.get(path)?.as_number()
    }

    pub fn text(&self, path: &str) -> Option<String> {
        self.get(path)?.as_str().map(str::to_owned)
    }

    /// Todas as folhas editáveis (número/texto/booleano), com o caminho de cada uma.
    pub fn leaves(&self) -> Vec<Leaf> {
        let mut out = Vec::new();
        walk(&self.root, "", &mut out);
        out
    }
}

fn walk(v: &Value, prefix: &str, out: &mut Vec<Leaf>) {
    let mut pos = 0;
    for e in v.entries() {
        let name = match &e.key {
            Some(Key::Name(n)) => n.clone(),
            Some(Key::Index(i)) => i.to_string(),
            None => {
                pos += 1;
                pos.to_string()
            }
        };
        let path = if prefix.is_empty() { name } else { format!("{prefix}.{name}") };
        match &e.value {
            Value::Number(n) => out.push(Leaf { path, kind: "number", number: Some(*n), text: None, flag: None }),
            Value::Str(s) => out.push(Leaf { path, kind: "text", number: None, text: Some(s.clone()), flag: None }),
            Value::Bool(b) => out.push(Leaf { path, kind: "bool", number: None, text: None, flag: Some(*b) }),
            Value::Table { .. } => walk(&e.value, &path, out),
            _ => {}
        }
    }
}

/// Valor a gravar no texto.
#[derive(Debug, Clone, PartialEq)]
pub enum Set {
    Number(f64),
    Str(String),
    Bool(bool),
    /// lista de textos (ex.: Categories)
    Strings(Vec<String>),
}

pub fn lua_string(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('\'');
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\\\"),
            '\'' => o.push_str("\\'"),
            '\n' => o.push_str("\\n"),
            c => o.push(c),
        }
    }
    o.push('\'');
    o
}

fn fmt_number(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        let s = format!("{n:.6}");
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

impl Set {
    fn literal(&self) -> String {
        match self {
            Set::Number(n) => fmt_number(*n),
            Set::Str(s) => lua_string(s),
            Set::Bool(b) => b.to_string(),
            Set::Strings(v) => format!("{{ {} }}", v.iter().map(|s| lua_string(s)).collect::<Vec<_>>().join(", ")),
        }
    }
}

/// Aplica várias alterações (caminho → valor) no texto e devolve o texto novo.
/// Caminhos que não existem são criados (só por nome; posições de lista precisam existir).
pub fn apply(text: &str, changes: &[(String, Set)]) -> Result<String> {
    let mut text = text.to_string();
    // um de cada vez: cada troca muda as posições do resto (relê depois de cada uma)
    for (path, value) in changes {
        let bp = parse(&text)?;
        if let Some(e) = bp.entry(path) {
            let (a, b) = e.span;
            text.replace_range(a..b, &value.literal());
            continue;
        }
        // cria: acha o pai mais fundo que existe
        let parts: Vec<&str> = path.split('.').filter(|p| !p.is_empty()).collect();
        let mut depth = parts.len() - 1;
        let (table_end, indent) = loop {
            let parent = parts[..depth].join(".");
            let found = if parent.is_empty() { Some((&bp.root, bp.span)) } else { bp.entry(&parent).map(|e| (&e.value, e.span)) };
            if let Some((Value::Table { .. }, span)) = found {
                break (span.1 - 1, depth);
            }
            if depth == 0 {
                return Err(Error::Format(format!("blueprint: não dá para criar {path}")));
            }
            depth -= 1;
        };
        if parts[depth..].iter().any(|p| p.parse::<usize>().is_ok()) {
            return Err(Error::Format(format!("blueprint: posição de lista inexistente em {path}")));
        }
        // monta as tabelas que faltam: A = { B = valor }
        let mut lit = value.literal();
        for name in parts[depth + 1..].iter().rev() {
            lit = format!("{{ {name} = {lit} }}");
        }
        let pad = "    ".repeat(indent + 1);
        // vírgula depois do último item, se ele não tiver
        let before = text[..table_end].trim_end();
        let needs_comma = !before.ends_with('{') && !before.ends_with(',') && !before.ends_with(';');
        let insert = format!("{}\n{pad}{} = {lit},\n{}", if needs_comma { "," } else { "" }, parts[depth], "    ".repeat(indent));
        let cut = before.len();
        text.replace_range(cut..table_end, &insert);
    }
    parse(&text)?; // confere que continua válido
    Ok(text)
}

/// Texto de exibição sem a marca de tradução: `'<LOC uul0101_name>Rock Head'` → `Rock Head`.
pub fn strip_loc(s: &str) -> String {
    if let Some(rest) = s.strip_prefix("<LOC") {
        if let Some(i) = rest.find('>') {
            return rest[i + 1..].to_string();
        }
    }
    s.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"# Tanque leve UEF
UnitBlueprint {
    AI = { GuardScanRadius = 26, },
    Audio = {
        Destroyed = Sound { Bank = 'UEL', Cue = 'UEL0101_Destroy', LodCutoff = 'UnitMove_LodCutoff' },
    },
    Categories = { 'UEF', 'MOBILE', 'LAND', 'DIRECTFIRE' },
    Defense = {
        ArmorType = 'Normal',
        MaxHealth = 450, -- vida
        RegenRate = 0.5,
    },
    Display = {
        AnimationWalk = '/units/uul0101/uul0101_awalk.sca',
        UniformScale = 0.05,
    },
    General = { UnitName = '<LOC uul0101_name>Rock Head', FactionName = 'UEF', Icon = 'land', },
    Physics = { MaxSpeed = 3.2, MotionType = 'RULEUMT_Land' },
    Weapon = {
        {
            Label = 'MainGun',
            Damage = 30,
            MaxRadius = 26,
            RateOfFire = 0.8,
            RackBones = { { MuzzleBones = { 'Muzzle01' }, RackBone = 'Barrel' } },
            TurretBoneYaw = 'Turret',
        },
        { Label = 'DeathWeapon', Damage = 50, DummyWeapon = true },
    },
    Economy = { BuildCostMass = 54, BuildCostEnergy = 270, BuildTime = 3 },
}
"#;

    #[test]
    fn reads_paths_lists_and_loc() {
        let bp = parse(SAMPLE).unwrap();
        assert_eq!(bp.kind, "UnitBlueprint");
        assert_eq!(bp.number("Defense.MaxHealth"), Some(450.0));
        assert_eq!(bp.number("Weapon.1.Damage"), Some(30.0));
        assert_eq!(bp.text("Weapon.2.Label").as_deref(), Some("DeathWeapon"));
        assert_eq!(bp.text("Weapon.1.RackBones.1.MuzzleBones.1").as_deref(), Some("Muzzle01"));
        assert_eq!(bp.get("Categories").unwrap().strings(), vec!["UEF", "MOBILE", "LAND", "DIRECTFIRE"]);
        assert_eq!(strip_loc(&bp.text("General.UnitName").unwrap()), "Rock Head");
        assert_eq!(bp.text("Audio.Destroyed.Cue").as_deref(), Some("UEL0101_Destroy"));
        let leaves = bp.leaves();
        assert!(leaves.iter().any(|l| l.path == "Economy.BuildTime" && l.number == Some(3.0)));
        assert!(leaves.iter().any(|l| l.path == "Weapon.2.DummyWeapon" && l.flag == Some(true)));
    }

    #[test]
    fn edits_keep_comments_and_create_fields() {
        let out = apply(
            SAMPLE,
            &[
                ("Defense.MaxHealth".into(), Set::Number(900.0)),
                ("Weapon.1.RateOfFire".into(), Set::Number(1.25)),
                ("General.UnitName".into(), Set::Str("Martelo d'Aço".into())),
                ("Categories".into(), Set::Strings(vec!["UEF".into(), "LAND".into()])),
                ("Defense.Shield.ShieldMaxHealth".into(), Set::Number(300.0)),
                ("Intel.VisionRadius".into(), Set::Number(30.0)),
            ],
        )
        .unwrap();
        assert!(out.contains("MaxHealth = 900, -- vida"), "comentário preservado:\n{out}");
        assert!(out.starts_with("# Tanque leve UEF"));
        let bp = parse(&out).unwrap();
        assert_eq!(bp.number("Defense.MaxHealth"), Some(900.0));
        assert_eq!(bp.number("Weapon.1.RateOfFire"), Some(1.25));
        assert_eq!(bp.number("Weapon.1.Damage"), Some(30.0));
        assert_eq!(bp.text("General.UnitName").as_deref(), Some("Martelo d'Aço"));
        assert_eq!(bp.get("Categories").unwrap().strings(), vec!["UEF", "LAND"]);
        assert_eq!(bp.number("Defense.Shield.ShieldMaxHealth"), Some(300.0));
        assert_eq!(bp.number("Intel.VisionRadius"), Some(30.0));
        assert!(apply(SAMPLE, &[("Weapon.9.Damage".into(), Set::Number(1.0))]).is_err());
    }

    #[test]
    fn real_blueprint_if_available() {
        // CP_REAL_BP=<arquivo .bp em texto> confere um blueprint de verdade do jogo
        let Some(p) = std::env::var_os("CP_REAL_BP") else { return };
        let text = std::fs::read_to_string(p).unwrap();
        let bp = parse(&text).unwrap();
        assert!(!bp.leaves().is_empty());
        let again = apply(&text, &[]).unwrap();
        assert_eq!(again, text);
    }
}
