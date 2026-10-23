//! Lua do jogo: detecção de bytecode compilado e checagens simples para o editor.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LuaInfo {
    /// Bytecode compilado (não editável como texto).
    pub compiled: bool,
    /// Versão do Lua no cabeçalho do bytecode (ex.: 0x50 = 5.0).
    pub bytecode_version: Option<u8>,
    pub lines: usize,
    /// Problemas encontrados pela checagem leve (parênteses/blocos desbalanceados).
    pub warnings: Vec<String>,
}

pub fn inspect(data: &[u8]) -> LuaInfo {
    if data.len() >= 5 && &data[0..4] == b"\x1bLua" {
        return LuaInfo {
            compiled: true,
            bytecode_version: Some(data[4]),
            lines: 0,
            warnings: vec![],
        };
    }
    let text = String::from_utf8_lossy(data);
    LuaInfo {
        compiled: false,
        bytecode_version: None,
        lines: text.lines().count(),
        warnings: lint(&text),
    }
}

/// Checagem leve de balanceamento (não é um parser completo de Lua):
/// conta `(`/`)`, `{`/`}` e blocos `function/if/for/while/do … end`, ignorando
/// strings e comentários. Serve para pegar o erro mais comum antes de empacotar.
pub fn lint(src: &str) -> Vec<String> {
    let mut warnings = Vec::new();
    let mut paren = 0i32;
    let mut brace = 0i32;
    let mut blocks: Vec<(String, usize)> = Vec::new();
    let mut pending_do_from_loop = 0usize; // "for/while ... do" contam como 1 bloco
    for (lineno, line) in strip_comments_and_strings(src).lines().enumerate() {
        let ln = lineno + 1;
        for c in line.chars() {
            match c {
                '(' => paren += 1,
                ')' => paren -= 1,
                '{' => brace += 1,
                '}' => brace -= 1,
                _ => {}
            }
        }
        for word in line.split(|c: char| !(c.is_alphanumeric() || c == '_')) {
            match word {
                "function" | "if" | "repeat" => blocks.push((word.to_string(), ln)),
                "for" | "while" => {
                    blocks.push((word.to_string(), ln));
                    pending_do_from_loop += 1;
                }
                "do" => {
                    if pending_do_from_loop > 0 {
                        pending_do_from_loop -= 1;
                    } else {
                        blocks.push(("do".into(), ln));
                    }
                }
                "end" | "until" if blocks.pop().is_none() => {
                    warnings.push(format!("linha {ln}: \"{word}\" sem bloco aberto"));
                }
                _ => {}
            }
        }
        if paren < 0 {
            warnings.push(format!("linha {ln}: \")\" a mais"));
            paren = 0;
        }
        if brace < 0 {
            warnings.push(format!("linha {ln}: \"}}\" a mais"));
            brace = 0;
        }
    }
    if paren > 0 {
        warnings.push(format!("{paren} parêntese(s) sem fechar"));
    }
    if brace > 0 {
        warnings.push(format!("{brace} chave(s) sem fechar"));
    }
    for (kw, ln) in blocks.iter().rev().take(3) {
        warnings.push(format!("bloco \"{kw}\" aberto na linha {ln} sem \"end\""));
    }
    warnings
}

fn strip_comments_and_strings(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let b: Vec<char> = src.chars().collect();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        // comentário longo --[[ ... ]] ou --[==[ ... ]==]
        if c == '-' && b.get(i + 1) == Some(&'-') {
            if let Some(level) = long_bracket_level(&b, i + 2) {
                i = skip_long(&b, i + 2, level, &mut out);
                continue;
            }
            while i < b.len() && b[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '[' {
            if let Some(level) = long_bracket_level(&b, i) {
                i = skip_long(&b, i, level, &mut out);
                continue;
            }
        }
        if c == '"' || c == '\'' {
            let q = c;
            i += 1;
            while i < b.len() && b[i] != q && b[i] != '\n' {
                if b[i] == '\\' {
                    i += 1;
                }
                i += 1;
            }
            i += 1;
            out.push_str("\"\"");
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}

fn long_bracket_level(b: &[char], i: usize) -> Option<usize> {
    if b.get(i) != Some(&'[') {
        return None;
    }
    let mut j = i + 1;
    let mut level = 0;
    while b.get(j) == Some(&'=') {
        level += 1;
        j += 1;
    }
    (b.get(j) == Some(&'[')).then_some(level)
}

fn skip_long(b: &[char], start: usize, level: usize, out: &mut String) -> usize {
    let close: Vec<char> = std::iter::once(']')
        .chain(std::iter::repeat_n('=', level))
        .chain(std::iter::once(']'))
        .collect();
    let mut i = start + level + 2;
    while i < b.len() {
        if b[i] == '\n' {
            out.push('\n'); // preserva numeração de linhas
        }
        if b[i..].starts_with(&close) {
            return i + close.len();
        }
        i += 1;
    }
    b.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_bytecode() {
        let i = inspect(b"\x1bLuaP\x01\x04");
        assert!(i.compiled);
        assert_eq!(i.bytecode_version, Some(0x50));
    }

    #[test]
    fn lint_balanced() {
        let ok = r#"
local t = { a = 1, b = "end ( {" }
function Foo(x)
    for i = 1, 10 do
        if x then print('a)') end
    end
    while true do break end
    repeat x = x - 1 until x < 0
    --[[ comentário com end ( ]]
    local s = [==[ texto ] end ]==]
end
"#;
        assert!(lint(ok).is_empty(), "{:?}", lint(ok));
    }

    #[test]
    fn lint_catches_missing_end() {
        let bad = "function A()\n  if x then\n    y()\n  \nend\nlocal t = { (1 }\n";
        let w = lint(bad);
        assert!(w.iter().any(|m| m.contains("sem \"end\"")), "{w:?}");
        assert!(w.iter().any(|m| m.contains("parêntese")), "{w:?}");
    }
}
