//! Jogo em português (Brasil): tradução de fã dos textos do jogo, ligada ao idioma do launcher.
//!
//! O jogo procura cada texto `<LOC chave>Padrão` na tabela de strings do idioma (`/loc/<la>/strings_db.lua`)
//! pelo `/lua/system/Localization.lua`. O jogo só traz o inglês e não dá para acrescentar um idioma
//! novo (só arquivos que o jogo já lista podem ser trocados), então o mod leva o `Localization.lua`
//! do próprio jogo do usuário com a tabela em português no fim: depois de carregar o idioma, os
//! textos passam a vir dela. Chave sem tradução continua com o texto original.
//!
//! A tradução (`loc/pt_br.json`) guarda só "chave → texto em português": nada do texto original do
//! jogo vai junto. O launcher monta o `.scd` na hora com o arquivo do jogo instalado.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// Id do mod na biblioteca.
pub const MOD_ID: &str = "cp-jogo-ptbr";
/// Versão da tradução: o launcher remonta o mod quando ela muda.
pub const MOD_VERSION: &str = "1.0.0";
/// Nome do arquivo do mod.
pub const ARCHIVE: &str = "zz_cp_jogo_ptbr.scd";
/// Idiomas do launcher que deixam o jogo em português.
pub const PT_LANGS: &[&str] = &["pt-BR"];

const PT_BR: &str = include_str!("loc/pt_br.json");
const MARK: &str = "-- CommandProject: português (Brasil)";

/// A tradução: chave da tabela de strings → texto em português.
pub fn translations() -> Result<BTreeMap<String, String>> {
    serde_json::from_str(PT_BR).map_err(|e| Error::Other(format!("tradução do jogo inválida: {e}")))
}

/// Texto Lua entre aspas: barras, aspas, quebras e caracteres de controle escapados (o resto vai em UTF-8).
pub fn lua_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\{:03}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() < 200 && k.chars().all(|c| c.is_ascii_graphic())
}

/// Código acrescentado ao fim do `Localization.lua`: a tabela em português passa a ser a do jogo.
pub fn table_lua(tr: &BTreeMap<String, String>) -> String {
    let mut out = String::with_capacity(tr.values().map(|v| v.len() + 40).sum::<usize>() + 512);
    out.push_str(MARK);
    out.push_str(" (tradução de fã montada pelo launcher)\n");
    out.push_str("-- Os textos <LOC chave> passam a vir desta tabela; chave sem tradução mostra o texto original.\n");
    out.push_str("do\n    local pt = {\n");
    for (k, v) in tr {
        if !valid_key(k) {
            continue;
        }
        out.push_str("        [");
        out.push_str(&lua_string(k));
        out.push_str("] = ");
        out.push_str(&lua_string(v));
        out.push_str(",\n");
    }
    out.push_str("    }\n    loc_table = pt\nend\n");
    out
}

/// `Localization.lua` do jogo com a tabela em português no fim.
pub fn patch_localization(text: &str, tr: &BTreeMap<String, String>) -> Result<String> {
    if text.contains(MARK) {
        return Err(Error::Other("o Localization.lua do jogo já tem a tradução: use o original do jogo".into()));
    }
    if !text.contains("loc_table") || !text.contains("function LOC(") {
        return Err(Error::Other("o Localization.lua do jogo tem um formato inesperado: não deu para traduzir o jogo".into()));
    }
    let mut out = text.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push('\n');
    out.push_str(&table_lua(tr));
    Ok(out)
}

/// Monta o `.scd` do mod em `dest` com os arquivos do jogo do usuário (`sources`).
pub fn build(sources: &[PathBuf], dest: &Path) -> Result<PathBuf> {
    let text = crate::cheats::game_text_for(sources, "/lua/system/Localization.lua", "o jogo em português")?;
    let tr = translations()?;
    let lua = patch_localization(&text, &tr)?;
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    b.add_bytes("lua/system/Localization.lua", lua.as_bytes())?;
    b.finish()
}

/// Resumo para a biblioteca.
pub fn describe(count: usize) -> String {
    format!(
        "Tradução de fã dos textos do jogo para português (Brasil): menus, unidades, pesquisa, dicas e a campanha ({count} textos). Liga sozinha com o launcher em português e desliga em inglês. Textos dentro de imagens e dos vídeos continuam como no jogo."
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escapes_lua() {
        assert_eq!(lua_string("a\"b\\c\nd"), "\"a\\\"b\\\\c\\nd\"");
        assert_eq!(lua_string("ação ✓"), "\"ação ✓\"");
        assert_eq!(lua_string("x\u{1}y"), "\"x\\001y\"");
    }

    #[test]
    fn patches_localization() {
        let mut tr = BTreeMap::new();
        tr.insert("OPTIONS_0001".to_string(), "Opções \"gerais\"".to_string());
        tr.insert("bad key".to_string(), "x".to_string());
        let base = "local loc_table\nfunction LOC(s)\n return loc_table[s]\nend\nloadLanguage(__language)\n";
        let out = patch_localization(base, &tr).unwrap();
        assert!(out.starts_with(base));
        assert!(out.contains("[\"OPTIONS_0001\"] = \"Opções \\\"gerais\\\"\","));
        assert!(!out.contains("bad key"));
        assert!(out.trim_end().ends_with("loc_table = pt\nend"));
        assert!(patch_localization(&out, &tr).is_err());
        assert!(patch_localization("print(1)", &tr).is_err());
    }

    #[test]
    fn translation_file_is_valid() {
        let tr = translations().unwrap();
        for (k, v) in &tr {
            assert!(valid_key(k), "chave {k:?}");
            assert!(!v.is_empty(), "texto vazio em {k}");
        }
    }

    /// Com CP_GAMEDATA (pasta com uncompiled_lua.scd): monta e confere o Lua com o lupa (tools/test_gamelang.py).
    #[test]
    fn real_game_build() {
        let Some(dir) = std::env::var_os("CP_GAMEDATA") else { return };
        let src = PathBuf::from(dir).join("uncompiled_lua.scd");
        let out = std::env::var_os("CP_LANG_OUT").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let scd = out.join(ARCHIVE);
        build(&[src], &scd).unwrap();
        let mut z = zip::ZipArchive::new(std::fs::File::open(&scd).unwrap()).unwrap();
        let mut f = z.by_name("lua/system/Localization.lua").unwrap();
        let mut s = String::new();
        std::io::Read::read_to_string(&mut f, &mut s).unwrap();
        assert!(s.contains(MARK));
        if std::env::var_os("CP_LANG_OUT").is_some() {
            std::fs::write(out.join("Localization.lua"), s).unwrap();
        }
    }
}
