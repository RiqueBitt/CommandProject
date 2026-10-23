//! Parser mínimo do formato KeyValues (VDF) da Valve, usado por
//! `libraryfolders.vdf` e `appmanifest_*.acf`.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Vdf {
    Str(String),
    Obj(BTreeMap<String, Vdf>),
}

impl Vdf {
    pub fn get(&self, key: &str) -> Option<&Vdf> {
        match self {
            Vdf::Obj(m) => m.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v),
            Vdf::Str(_) => None,
        }
    }
    pub fn str(&self) -> Option<&str> {
        match self {
            Vdf::Str(s) => Some(s),
            Vdf::Obj(_) => None,
        }
    }
    pub fn path(&self, keys: &[&str]) -> Option<&Vdf> {
        keys.iter().try_fold(self, |node, k| node.get(k))
    }
    pub fn entries(&self) -> impl Iterator<Item = (&String, &Vdf)> {
        let map = match self {
            Vdf::Obj(m) => Some(m),
            Vdf::Str(_) => None,
        };
        map.into_iter().flat_map(|m| m.iter())
    }
}

/// Faz o parse de um documento VDF. É tolerante: tokens inválidos são ignorados.
pub fn parse(text: &str) -> Vdf {
    let tokens = tokenize(text);
    let mut pos = 0;
    Vdf::Obj(parse_obj(&tokens, &mut pos))
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    S(String),
    Open,
    Close,
}

fn tokenize(text: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '{' => out.push(Tok::Open),
            '}' => out.push(Tok::Close),
            '"' => {
                let mut s = String::new();
                while let Some(c) = chars.next() {
                    match c {
                        '\\' => match chars.next() {
                            Some('n') => s.push('\n'),
                            Some('t') => s.push('\t'),
                            Some(other) => s.push(other),
                            None => break,
                        },
                        '"' => break,
                        other => s.push(other),
                    }
                }
                out.push(Tok::S(s));
            }
            '/' if chars.peek() == Some(&'/') => {
                for c in chars.by_ref() {
                    if c == '\n' {
                        break;
                    }
                }
            }
            c if c.is_whitespace() => {}
            c => {
                // token sem aspas
                let mut s = String::from(c);
                while let Some(&n) = chars.peek() {
                    if n.is_whitespace() || n == '{' || n == '}' || n == '"' {
                        break;
                    }
                    s.push(n);
                    chars.next();
                }
                out.push(Tok::S(s));
            }
        }
    }
    out
}

fn parse_obj(tokens: &[Tok], pos: &mut usize) -> BTreeMap<String, Vdf> {
    let mut map = BTreeMap::new();
    while *pos < tokens.len() {
        match &tokens[*pos] {
            Tok::Close => {
                *pos += 1;
                break;
            }
            Tok::Open => {
                *pos += 1; // bloco anônimo: ignora
            }
            Tok::S(key) => {
                *pos += 1;
                match tokens.get(*pos) {
                    Some(Tok::S(v)) => {
                        map.insert(key.clone(), Vdf::Str(v.clone()));
                        *pos += 1;
                    }
                    Some(Tok::Open) => {
                        *pos += 1;
                        map.insert(key.clone(), Vdf::Obj(parse_obj(tokens, pos)));
                    }
                    _ => {}
                }
            }
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn library_folders() {
        let txt = r#"
"libraryfolders"
{
    "0"
    {
        "path"      "C:\\Program Files (x86)\\Steam"
        "apps" { "228980" "1" }
    }
    "1"
    {
        "path"      "D:\\SteamLibrary"
        "apps"
        {
            "40100"     "4400000000"
        }
    }
}"#;
        let v = parse(txt);
        let lib = v.get("libraryfolders").unwrap();
        let paths: Vec<_> = lib.entries().filter_map(|(_, e)| e.get("path")?.str()).collect();
        assert_eq!(paths, vec!["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]);
        assert!(lib.path(&["1", "apps", "40100"]).is_some());
    }

    #[test]
    fn acf() {
        let v = parse("\"AppState\" { \"appid\" \"40100\" \"installdir\" \"Supreme Commander 2\" // c\n }");
        assert_eq!(
            v.path(&["AppState", "installdir"]).and_then(Vdf::str),
            Some("Supreme Commander 2")
        );
    }
}
