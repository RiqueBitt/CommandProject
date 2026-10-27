//! **Forja**: o carregador de mods do CommandProject (como o Forge do Minecraft, para o SC2).
//!
//! Um mod da Forja é um `.scd` (ou pasta) com o código em `forja/<id>/`:
//! - `mod.json`: id, nome, versão, autores, dependências, ordem de carga, conflitos e opções;
//! - `sim.lua` (simulação), `ui.lua` (interface) e `blueprints.lua` (unidades e armas ao carregar),
//!   todos opcionais, e outros `.lua` que o mod carrega com `mod.Require('pasta/arquivo')`.
//!
//! O jogo só entrega os arquivos Lua que estão no índice dele (`toc.win.bdf`): um `import` de um
//! arquivo novo não é achado. Por isso, a cada "aplicar", o launcher monta o mod `cp-forja`: pega
//! os arquivos do jogo **como eles ficam com os outros mods ligados** (o último vence, como no jogo)
//! e põe no fim de cada um o motor da Forja (eventos, comandos entre interface e simulação,
//! painéis, ajudas para blueprints) e o código dos mods, cada um isolado: um erro de sintaxe ou de
//! execução num mod não derruba os outros nem o jogo. Os mods continuam no jogo como `.scd` comuns
//! (podem trazer texturas, modelos, sons e blueprints).
//!
//! Arquivos do jogo que recebem a Forja: `simInit.lua` (motor da simulação e início da partida),
//! `sim/Unit.lua` (eventos das unidades, também a cópia da expansão), `sim/SimCallbacks.lua`
//! (comando `Forja`), `UserSync.lua` (mensagens da simulação), `ui/game/gamemain_pc.lua` (motor da
//! interface) e `system/Blueprints.lua` (`ModBlueprints`).

use crate::error::{Error, Result};
use crate::manifest::{parse_version, version_matches, Dependency};
use crate::scd::{normalize_key, Scd};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

/// Id do mod montado pelo launcher na biblioteca.
pub const LOADER_ID: &str = "cp-forja";
/// Versão da Forja (da API que os mods usam).
pub const LOADER_VERSION: &str = "1.0.0";
/// Nome do `.scd`: carrega depois de todos os outros mods do CommandProject.
pub const ARCHIVE: &str = "zz_cp_zzzz_forja.scd";
/// Tecla padrão do painel da Forja na partida.
pub const DEFAULT_KEY: &str = "F8";
/// Teclas livres no mapa padrão do jogo.
pub const KEYS: &[&str] = &["F3", "F4", "F7", "F8", "F11", "Insert", "Home"];
/// Arquivo das opções (na pasta de dados do launcher).
pub const OPTIONS_FILE: &str = "forja-options.json";
/// Arquivo com o resultado da última montagem (para a tela do launcher).
pub const STATUS_FILE: &str = "forja-status.json";

const MARK: &str = "CommandProject Forja";
const CORE: &str = include_str!("forja/forja_core.lua");
const SIM: &str = include_str!("forja/forja_sim.lua");
const UNIT: &str = include_str!("forja/forja_unit.lua");
const UI: &str = include_str!("forja/forja_ui.lua");
const BP: &str = include_str!("forja/forja_bp.lua");

/// Tamanho máximo de um arquivo Lua de mod (proteção contra arquivos errados).
const MAX_LUA: usize = 2 * 1024 * 1024;

// ------------------------------------------------------------------ manifesto

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum OptionKind {
    Bool,
    Number,
    Choice,
    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Choice {
    pub value: String,
    pub label: String,
}

/// Uma opção que o jogador ajusta no launcher; o mod lê com `mod.Option('chave')`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForjaOption {
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "type")]
    pub kind: OptionKind,
    pub default: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step: Option<f64>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub choices: Vec<Choice>,
}

/// `forja/<id>/mod.json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ForjaManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub authors: Vec<String>,
    #[serde(default)]
    pub description: String,
    /// Versão da Forja exigida (ex.: ">=1.0").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loader: Option<String>,
    #[serde(default)]
    pub dependencies: Vec<Dependency>,
    /// Carregam antes quando estão ligados; sem eles o mod carrega do mesmo jeito.
    #[serde(default)]
    pub optional_dependencies: Vec<Dependency>,
    #[serde(default)]
    pub load_after: Vec<String>,
    #[serde(default)]
    pub load_before: Vec<String>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    #[serde(default)]
    pub options: Vec<ForjaOption>,
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
        && id.chars().next().map(|c| c.is_ascii_alphanumeric()).unwrap_or(false)
}

fn valid_key(k: &str) -> bool {
    !k.is_empty()
        && k.len() <= 48
        && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !k.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(true)
}

impl ForjaManifest {
    pub fn validate(&self) -> Result<()> {
        let bad = |m: String| Err(Error::Manifest(format!("{}: {m}", self.id)));
        if !valid_id(&self.id) {
            return Err(Error::Manifest(format!("id \"{}\" inválido (letras minúsculas, números, '-' e '_')", self.id)));
        }
        if self.name.trim().is_empty() {
            return bad("o nome não pode ficar vazio".into());
        }
        if parse_version(&self.version).is_none() {
            return bad(format!("versão \"{}\" inválida (use 1.0.0)", self.version));
        }
        if let Some(req) = &self.loader {
            if semver::VersionReq::parse(req.trim()).is_err() {
                return bad(format!("\"loader\" inválido: {req} (ex.: \">=1.0\")"));
            }
        }
        for d in self.dependencies.iter().chain(&self.optional_dependencies) {
            if !valid_id(&d.id) {
                return bad(format!("dependência com id inválido: {}", d.id));
            }
            if d.id == self.id {
                return bad("o mod não pode depender dele mesmo".into());
            }
            if let Some(v) = &d.version {
                if semver::VersionReq::parse(v.trim()).is_err() {
                    return bad(format!("versão exigida de {} inválida: {v}", d.id));
                }
            }
        }
        let mut keys = BTreeSet::new();
        for o in &self.options {
            if !valid_key(&o.key) {
                return bad(format!("opção com chave inválida: \"{}\" (letras, números e _)", o.key));
            }
            if !keys.insert(o.key.clone()) {
                return bad(format!("opção repetida: {}", o.key));
            }
            let ok = match o.kind {
                OptionKind::Bool => o.default.is_boolean(),
                OptionKind::Number => o.default.is_number(),
                OptionKind::Text => o.default.is_string(),
                OptionKind::Choice => {
                    !o.choices.is_empty() && o.default.as_str().map(|d| o.choices.iter().any(|c| c.value == d)).unwrap_or(false)
                }
            };
            if !ok {
                return bad(format!("o padrão da opção \"{}\" não combina com o tipo dela", o.key));
            }
        }
        Ok(())
    }
}

// ------------------------------------------------------------------ mods

/// Um mod da Forja lido de um `.scd` ou de uma pasta.
#[derive(Debug, Clone, PartialEq)]
pub struct ForjaMod {
    pub manifest: ForjaManifest,
    /// Mod da biblioteca que o trouxe (vazio para pastas).
    pub library_id: String,
    /// Arquivos `.lua` do mod, pelo caminho dentro de `forja/<id>/` (`sim.lua`, `lib/util.lua`).
    pub files: BTreeMap<String, Vec<u8>>,
}

impl ForjaMod {
    pub fn has(&self, file: &str) -> bool {
        self.files.contains_key(file)
    }

    /// As partes do jogo onde o mod tem código.
    pub fn sides(&self) -> Vec<&'static str> {
        [("sim.lua", "sim"), ("ui.lua", "ui"), ("blueprints.lua", "blueprints")]
            .into_iter()
            .filter(|(f, _)| self.has(f))
            .map(|(_, s)| s)
            .collect()
    }

    /// Problemas que dá para ver sem rodar (blocos sem `end`, parênteses...).
    pub fn lint(&self) -> Vec<String> {
        let mut out = Vec::new();
        for (path, data) in &self.files {
            for w in crate::lua::lint(&latin1(data)) {
                out.push(format!("{path}: {w}"));
            }
            if data.windows(3).any(|w| w == b"\xef\xbb\xbf") && data.starts_with(b"\xef\xbb\xbf") {
                out.push(format!("{path}: começa com BOM (salve como UTF-8 sem BOM)"));
            }
        }
        out
    }
}

fn parse_mod(id_dir: &str, manifest: &[u8], files: BTreeMap<String, Vec<u8>>, library_id: &str) -> Result<ForjaMod> {
    let text = String::from_utf8_lossy(manifest);
    let m: ForjaManifest = serde_json::from_str(text.trim_start_matches('\u{feff}'))
        .map_err(|e| Error::Manifest(format!("forja/{id_dir}/mod.json: {e}")))?;
    m.validate()?;
    if m.id != id_dir {
        return Err(Error::Manifest(format!("forja/{id_dir}/mod.json: o id \"{}\" precisa ser igual ao nome da pasta", m.id)));
    }
    if files.is_empty() {
        return Err(Error::Manifest(format!("forja/{id_dir}: nenhum arquivo .lua (sim.lua, ui.lua ou blueprints.lua)")));
    }
    Ok(ForjaMod { manifest: m, library_id: library_id.into(), files })
}

/// Os mods da Forja dentro de um `.scd` (entradas `forja/<id>/…`). Mods com problema voltam como
/// erro na segunda lista, sem impedir os outros.
pub fn read_archive(path: &Path, library_id: &str) -> Result<(Vec<ForjaMod>, Vec<String>)> {
    let mut scd = Scd::open(path)?;
    let entries = scd.entries()?;
    // id -> (índice do mod.json, arquivos .lua com o índice)
    type Found = (Option<usize>, Vec<(String, usize)>);
    let mut by_id: BTreeMap<String, Found> = BTreeMap::new();
    for (i, e) in entries.iter().enumerate() {
        if e.is_dir {
            continue;
        }
        let Some(rest) = e.key.strip_prefix("/forja/") else { continue };
        let Some((id, file)) = rest.split_once('/') else { continue };
        let slot = by_id.entry(id.to_string()).or_default();
        if file == "mod.json" {
            slot.0 = Some(i);
        } else if file.ends_with(".lua") {
            slot.1.push((file.to_string(), i));
        }
    }
    let (mut mods, mut problems) = (Vec::new(), Vec::new());
    for (id, (manifest, lua)) in by_id {
        let Some(mi) = manifest else {
            problems.push(format!("forja/{id}: falta o mod.json"));
            continue;
        };
        let result = (|| {
            let m = scd.read_at(mi)?;
            let mut files = BTreeMap::new();
            for (name, idx) in lua {
                let data = scd.read_at(idx)?;
                if data.len() > MAX_LUA {
                    return Err(Error::Manifest(format!("forja/{id}/{name}: arquivo grande demais")));
                }
                if crate::lua::inspect(&data).compiled {
                    return Err(Error::Manifest(format!("forja/{id}/{name}: Lua compilado não é aceito (mande o texto)")));
                }
                files.insert(name, data);
            }
            parse_mod(&id, &m, files, library_id)
        })();
        match result {
            Ok(m) => mods.push(m),
            Err(e) => problems.push(e.to_string()),
        }
    }
    Ok((mods, problems))
}

/// Um mod da Forja numa pasta: a pasta do mod (com `mod.json`) ou uma pasta com `forja/<id>/`.
pub fn read_folder(dir: &Path) -> Result<Vec<ForjaMod>> {
    let mut roots = Vec::new();
    if dir.join("mod.json").is_file() && !dir.join("forja").is_dir() {
        roots.push(dir.to_path_buf());
    } else {
        let forja = dir.join("forja");
        let rd = std::fs::read_dir(&forja).map_err(|e| Error::io(&forja, e))?;
        for e in rd.flatten() {
            if e.path().join("mod.json").is_file() {
                roots.push(e.path());
            }
        }
        roots.sort();
    }
    if roots.is_empty() {
        return Err(Error::Other(format!("{}: nenhum mod da Forja (falta forja/<id>/mod.json)", dir.display())));
    }
    let mut out = Vec::new();
    for root in roots {
        let id = root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let manifest = std::fs::read(root.join("mod.json")).map_err(|e| Error::io(root.join("mod.json"), e))?;
        let mut files = BTreeMap::new();
        collect_lua(&root, &root, &mut files)?;
        out.push(parse_mod(&id, &manifest, files, "")?);
    }
    Ok(out)
}

fn collect_lua(root: &Path, dir: &Path, out: &mut BTreeMap<String, Vec<u8>>) -> Result<()> {
    let rd = std::fs::read_dir(dir).map_err(|e| Error::io(dir, e))?;
    let mut entries: Vec<_> = rd.flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            collect_lua(root, &p, out)?;
        } else if p.extension().map(|e| e.eq_ignore_ascii_case("lua")).unwrap_or(false) {
            let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/").to_ascii_lowercase();
            let data = std::fs::read(&p).map_err(|e| Error::io(&p, e))?;
            if data.len() > MAX_LUA {
                return Err(Error::Other(format!("{}: arquivo grande demais", p.display())));
            }
            out.insert(rel, data);
        }
    }
    Ok(())
}

// ------------------------------------------------------------------ dependências e ordem

/// Um mod que ficou de fora (ou um aviso) e por quê.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub mod_id: String,
    pub message: String,
    /// `true`: o mod não carrega; `false`: só um aviso.
    pub fatal: bool,
}

#[derive(Debug, Clone, Default)]
pub struct Plan {
    /// Na ordem de carga.
    pub mods: Vec<ForjaMod>,
    pub problems: Vec<Problem>,
}

/// Confere a versão da Forja, as dependências e os conflitos e põe os mods na ordem de carga
/// (dependências antes, `loadAfter`/`loadBefore`, e o resto pelo id). Um mod que não pode carregar
/// sai com o motivo, e quem depende dele sai também.
pub fn resolve(mods: Vec<ForjaMod>) -> Plan {
    let mut problems = Vec::new();
    let fatal = |id: &str, msg: String, problems: &mut Vec<Problem>| problems.push(Problem { mod_id: id.into(), message: msg, fatal: true });
    // o último com o mesmo id vence (como os arquivos no jogo)
    let mut by_id: BTreeMap<String, ForjaMod> = BTreeMap::new();
    for m in mods {
        if let Some(old) = by_id.insert(m.manifest.id.clone(), m) {
            problems.push(Problem {
                mod_id: old.manifest.id.clone(),
                message: format!("aparece em mais de um mod ligado ({} e outro): vale o que carrega por último", old.library_id),
                fatal: false,
            });
        }
    }
    for (id, m) in by_id.clone() {
        if !version_matches(m.manifest.loader.as_deref(), LOADER_VERSION) {
            fatal(&id, format!("precisa da Forja {} (esta é a {LOADER_VERSION})", m.manifest.loader.as_deref().unwrap_or("")), &mut problems);
            by_id.remove(&id);
        }
    }
    // conflitos: quem declara o conflito fica de fora
    for (id, m) in by_id.clone() {
        if let Some(other) = m.manifest.conflicts.iter().find(|c| by_id.contains_key(c.as_str()) && c.as_str() != id) {
            fatal(&id, format!("não funciona junto com \"{other}\" (desligue um dos dois)"), &mut problems);
            by_id.remove(&id);
        }
    }
    // dependências (repete: sair um pode derrubar outro)
    loop {
        let mut removed = false;
        for (id, m) in by_id.clone() {
            for d in &m.manifest.dependencies {
                let reason = match by_id.get(&d.id) {
                    None => Some(format!("precisa do mod \"{}\" ligado", d.id)),
                    Some(dep) if !version_matches(d.version.as_deref(), &dep.manifest.version) => Some(format!(
                        "precisa de \"{}\" {} (está a {})",
                        d.id,
                        d.version.as_deref().unwrap_or(""),
                        dep.manifest.version
                    )),
                    _ => None,
                };
                if let Some(r) = reason {
                    fatal(&id, r, &mut problems);
                    by_id.remove(&id);
                    removed = true;
                    break;
                }
            }
        }
        if !removed {
            break;
        }
    }
    for (id, m) in &by_id {
        for d in &m.manifest.optional_dependencies {
            if let (Some(req), Some(dep)) = (&d.version, by_id.get(&d.id)) {
                if !version_matches(Some(req), &dep.manifest.version) {
                    problems.push(Problem {
                        mod_id: id.clone(),
                        message: format!("funciona melhor com \"{}\" {req} (está a {})", d.id, dep.manifest.version),
                        fatal: false,
                    });
                }
            }
        }
    }
    // ordem: arestas "a antes de b"
    let ids: Vec<String> = by_id.keys().cloned().collect();
    let mut after: HashMap<String, BTreeSet<String>> = ids.iter().map(|i| (i.clone(), BTreeSet::new())).collect();
    for (id, m) in &by_id {
        let deps = m.manifest.dependencies.iter().chain(&m.manifest.optional_dependencies).map(|d| d.id.clone());
        for before in deps.chain(m.manifest.load_after.iter().cloned()) {
            if by_id.contains_key(&before) && &before != id {
                after.get_mut(id).expect("id").insert(before);
            }
        }
        for later in &m.manifest.load_before {
            if by_id.contains_key(later) && later != id {
                after.get_mut(later).expect("id").insert(id.clone());
            }
        }
    }
    let mut order: Vec<String> = Vec::new();
    let mut done = BTreeSet::new();
    while done.len() < ids.len() {
        // o menor id cujas exigências já carregaram (ordem estável)
        let next = ids.iter().find(|i| !done.contains(*i) && after[*i].iter().all(|b| done.contains(b)));
        match next {
            Some(n) => {
                done.insert(n.clone());
                order.push(n.clone());
            }
            None => {
                // ciclo: os que sobraram ficam de fora
                let left: Vec<String> = ids.iter().filter(|i| !done.contains(*i)).cloned().collect();
                for i in left {
                    fatal(&i, "ordem de carga impossível: dependências em círculo".into(), &mut problems);
                    done.insert(i);
                }
            }
        }
    }
    let mods = order.into_iter().filter_map(|id| by_id.remove(&id)).collect();
    Plan { mods, problems }
}

// ------------------------------------------------------------------ opções

/// O que o jogador escolheu: `{ "key": "F8", "mods": { "<id>": { "<opção>": valor } } }`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Tecla do painel da Forja na partida.
    pub key: String,
    pub mods: BTreeMap<String, BTreeMap<String, Value>>,
}

impl Settings {
    pub fn load(data_dir: &Path) -> Settings {
        std::fs::read(data_dir.join(OPTIONS_FILE))
            .ok()
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, data_dir: &Path) -> Result<()> {
        let p = data_dir.join(OPTIONS_FILE);
        let json = serde_json::to_vec_pretty(self).map_err(|e| Error::Other(e.to_string()))?;
        crate::fsutil::write_atomic(&p, &json)
    }

    pub fn panel_key(&self) -> &str {
        KEYS.iter().copied().find(|k| k.eq_ignore_ascii_case(&self.key)).unwrap_or(DEFAULT_KEY)
    }
}

/// O valor de cada opção de um mod: o escolhido, se for válido, ou o padrão.
pub fn option_values(m: &ForjaManifest, saved: Option<&BTreeMap<String, Value>>) -> BTreeMap<String, Value> {
    let mut out = BTreeMap::new();
    for o in &m.options {
        let v = saved.and_then(|s| s.get(&o.key)).cloned();
        let value = match (o.kind, v) {
            (OptionKind::Bool, Some(Value::Bool(b))) => Value::Bool(b),
            (OptionKind::Number, Some(Value::Number(n))) => {
                let mut x = n.as_f64().unwrap_or(0.0);
                if let Some(min) = o.min {
                    x = x.max(min);
                }
                if let Some(max) = o.max {
                    x = x.min(max);
                }
                serde_json::Number::from_f64(x).map(Value::Number).unwrap_or_else(|| o.default.clone())
            }
            (OptionKind::Choice, Some(Value::String(s))) if o.choices.iter().any(|c| c.value == s) => Value::String(s),
            (OptionKind::Text, Some(Value::String(s))) => Value::String(s.chars().take(500).collect()),
            _ => o.default.clone(),
        };
        out.insert(o.key.clone(), value);
    }
    out
}

// ------------------------------------------------------------------ Lua gerado

/// Bytes como texto, um caractere por byte (latin1): o Lua do jogo trabalha com bytes, então nada
/// muda de byte no caminho (acentos em UTF-8 dos mods e em latin1 do jogo continuam iguais).
fn latin1(raw: &[u8]) -> String {
    raw.iter().map(|&b| b as char).collect::<String>().replace("\r\n", "\n")
}

fn to_bytes(text: &str) -> Vec<u8> {
    text.chars().map(|c| if (c as u32) < 256 { c as u8 } else { b'?' }).collect()
}

/// Uma string Lua entre aspas (escapes que o Lua 5.0 entende).
fn lua_str(s: &str) -> String {
    let mut out = String::from("'");
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\0' => out.push_str("\\0"),
            c => out.push(c),
        }
    }
    out.push('\'');
    out
}

/// Um texto UTF-8 (nome, descrição, opção) como string Lua com os mesmos bytes.
fn lua_utf8(s: &str) -> String {
    lua_str(&latin1(s.as_bytes()))
}

fn lua_value(v: &Value) -> String {
    match v {
        Value::Null => "nil".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.as_f64().map(|f| if f.fract() == 0.0 && f.abs() < 1e15 { format!("{}", f as i64) } else { format!("{f}") }).unwrap_or_else(|| "0".into()),
        Value::String(s) => lua_utf8(s),
        Value::Array(a) => format!("{{ {} }}", a.iter().map(lua_value).collect::<Vec<_>>().join(", ")),
        Value::Object(o) => format!(
            "{{ {} }}",
            o.iter().map(|(k, v)| format!("[{}] = {}", lua_utf8(k), lua_value(v))).collect::<Vec<_>>().join(", ")
        ),
    }
}

/// Texto Lua entre colchetes longos (`[==[ … ]==]`) com um nível que não aparece no texto.
fn long_string(text: &str) -> String {
    let mut level = 1;
    loop {
        let eq = "=".repeat(level);
        let close = format!("]{eq}]");
        if !text.contains(&close) && !text.ends_with(&format!("]{eq}")) {
            // começa com uma quebra de linha: o Lua a descarta, e o texto fica igual
            return format!("[{eq}[\n{text}{close}");
        }
        level += 1;
    }
}

/// O código de um arquivo do mod pronto para o `loadstring` do motor: `mod` e `Forja` já são
/// variáveis locais dele, na mesma linha 1 (os números de linha dos erros batem com o arquivo).
fn chunk(data: &[u8]) -> String {
    let text = latin1(data);
    let text = text.trim_start_matches('\u{feff}').trim_start_matches("\u{ef}\u{bb}\u{bf}");
    long_string(&format!("local mod, Forja = ForjaMod, Forja; {text}"))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Sim,
    Ui,
    Blueprints,
}

impl Side {
    fn key(self) -> &'static str {
        match self {
            Side::Sim => "sim",
            Side::Ui => "ui",
            Side::Blueprints => "blueprints",
        }
    }
    fn entry(self) -> &'static str {
        match self {
            Side::Sim => "sim.lua",
            Side::Ui => "ui.lua",
            Side::Blueprints => "blueprints.lua",
        }
    }
}

/// O motor da Forja para uma parte do jogo, com os mods registrados (na ordem de carga).
pub fn side_code(plan: &Plan, side: Side, settings: &Settings) -> String {
    let mut out = format!("\n-- {MARK} {LOADER_VERSION} ({}): mod loader, generated by the launcher.\n", side.key());
    out.push_str("if not (_G.Forja and _G.Forja.Side == ");
    out.push_str(&lua_str(side.key()));
    out.push_str(") then\n");
    let fill = |t: &str| t.replace("@SIDE@", side.key()).replace("@VERSION@", LOADER_VERSION).replace("@KEY@", settings.panel_key());
    out.push_str(&fill(CORE));
    out.push('\n');
    out.push_str(&fill(match side {
        Side::Sim => SIM,
        Side::Ui => UI,
        Side::Blueprints => BP,
    }));
    out.push('\n');
    for m in &plan.mods {
        let man = &m.manifest;
        let options = option_values(man, settings.mods.get(&man.id));
        out.push_str("Forja._Register({\n");
        out.push_str(&format!("    id = {},\n    name = {},\n    version = {},\n", lua_str(&man.id), lua_utf8(&man.name), lua_str(&man.version)));
        out.push_str(&format!(
            "    options = {{ {} }},\n",
            options.iter().map(|(k, v)| format!("{k} = {}", lua_value(v))).collect::<Vec<_>>().join(", ")
        ));
        out.push_str("    modules = {\n");
        for (path, data) in &m.files {
            if ["sim.lua", "ui.lua", "blueprints.lua"].contains(&path.as_str()) {
                continue;
            }
            let key = path.trim_end_matches(".lua");
            out.push_str(&format!("        [{}] = {},\n", lua_str(key), chunk(data)));
        }
        out.push_str("    },\n");
        if let Some(data) = m.files.get(side.entry()) {
            out.push_str(&format!("    entryName = {},\n", lua_str(&format!("forja/{}/{}", man.id, side.entry()))));
            out.push_str(&format!("    entry = {},\n", chunk(data)));
        }
        if side == Side::Blueprints {
            out.push_str("    defer = true,\n");
        }
        out.push_str("})\n");
    }
    out.push_str(&format!("Forja.Log('Forja {LOADER_VERSION} ({}): ' .. table.getn(Forja._order) .. ' mod(s)')\n", side.key()));
    out.push_str("end\n");
    out
}

// ------------------------------------------------------------------ arquivos do jogo

/// Os arquivos do jogo que recebem a Forja.
pub const GAME_FILES: &[&str] = &[
    "/lua/simInit.lua",
    "/lua/sim/Unit.lua",
    "/lua/sim/SimCallbacks.lua",
    "/lua/UserSync.lua",
    "/lua/ui/game/gamemain_pc.lua",
    "/lua/system/Blueprints.lua",
];
/// Cópias que o jogo usa no lugar das originais (expansão e campanha).
const SHADOWS: &[&str] = &["/mods/DLC1/shadow", "/mods/CampaignBranch/shadow"];

const SIM_HOOK: &str = "\tif _G.Forja and _G.Forja._SessionStart then ForkThread(_G.Forja._SessionStart) end -- CommandProject Forja\n";
const UI_HOOK: &str = "\tif _G.Forja and _G.Forja._UIReady then pcall(_G.Forja._UIReady) end -- CommandProject Forja\n";
const SYNC_HOOK: &str = "\tif Sync.Forja and _G.Forja and _G.Forja._Deliver then pcall(_G.Forja._Deliver, Sync.Forja) end -- CommandProject Forja\n";
/// O comando da interface para a simulação (o mesmo em todos os mods do CommandProject).
pub const CALLBACK: &str = "Callbacks.Forja = function(data, units) if _G.Forja and _G.Forja._Command then _G.Forja._Command(data, units) end end\n";
const UI_KEY_FN: &str = "\n-- CommandProject Forja: keys of the Forja panel and of mods (IN_AddKeyMapTable calls this)\nfunction ForjaKey(name) if _G.Forja and _G.Forja._Key then _G.Forja._Key(name) end end\n";
const BP_HOOK: &str = "\n-- CommandProject Forja: mods change the blueprints after the game's own ModBlueprints\nlocal ForjaBaseModBlueprints = ModBlueprints\nfunction ModBlueprints(all_blueprints)\n    ForjaBaseModBlueprints(all_blueprints)\n    if _G.Forja and _G.Forja._Blueprints then _G.Forja._Blueprints(all_blueprints) end\nend\n";

fn append(text: &str, code: &str) -> String {
    let mut out = text.to_string();
    if !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(code);
    out
}

/// Põe `hook` antes do `end` que fecha `function <name>` (o `end` sozinho no começo da linha).
fn before_end(text: &str, name: &str, hook: &str) -> Option<String> {
    let p = text.find(&format!("function {name}"))?;
    let close = text[p..].find("\nend").map(|i| p + i + 1)?;
    Some(format!("{}{hook}{}", &text[..close], &text[close..]))
}

/// Um arquivo do jogo com a Forja. `path` sem a pasta das cópias (`/lua/sim/Unit.lua`).
pub fn patch(path: &str, text: &str, plan: &Plan, settings: &Settings) -> Result<String> {
    if text.contains(MARK) {
        return Err(Error::Other(format!("{path} já tem a Forja: monte a partir do arquivo do jogo")));
    }
    let name = path.rsplit('/').next().unwrap_or(path);
    let changed = |m: &str| Error::Other(format!("o {name} do jogo é diferente do esperado ({m}): a Forja não pôde ser ligada"));
    let lower = path.to_ascii_lowercase();
    Ok(match lower.as_str() {
        "/lua/siminit.lua" => {
            // logo antes do placar começar a contar (tudo da partida já montado), ou no começo
            let anchors = [
                "ForkThread(import('/lua/sim/aibrain.lua').CollectCurrentScores)",
                "ForkThread(import('/lua/sim/victory.lua').CheckVictory",
            ];
            let hooked = anchors
                .iter()
                .find_map(|a| text.find(a).map(|p| text[..p].rfind('\n').map(|i| i + 1).unwrap_or(0)))
                .map(|line| format!("{}{SIM_HOOK}{}", &text[..line], &text[line..]))
                .or_else(|| {
                    let p = text.find("function BeginSession()")?;
                    let end = text[p..].find('\n').map(|i| p + i + 1)?;
                    Some(format!("{}{SIM_HOOK}{}", &text[..end], &text[end..]))
                })
                .ok_or_else(|| changed("sem BeginSession"))?;
            append(&hooked, &side_code(plan, Side::Sim, settings))
        }
        "/lua/sim/unit.lua" => {
            if !text.contains("Unit = Class(") {
                return Err(changed("sem a classe Unit"));
            }
            append(text, &format!("\n-- {MARK}\n{UNIT}"))
        }
        "/lua/sim/simcallbacks.lua" => {
            if text.contains("Callbacks.Forja =") {
                text.to_string()
            } else if text.contains("local Callbacks = {}") {
                append(text, &format!("\n-- {MARK}\n{CALLBACK}"))
            } else {
                return Err(changed("sem Callbacks"));
            }
        }
        "/lua/usersync.lua" => before_end(text, "OnSync()", SYNC_HOOK).ok_or_else(|| changed("sem OnSync"))?,
        "/lua/ui/game/gamemain_pc.lua" => {
            let hooked = before_end(text, "OnFirstUpdate()", UI_HOOK).ok_or_else(|| changed("sem OnFirstUpdate"))?;
            append(&hooked, &format!("{}{UI_KEY_FN}", side_code(plan, Side::Ui, settings)))
        }
        "/lua/system/blueprints.lua" => {
            if !text.contains("function ModBlueprints(") {
                return Err(changed("sem ModBlueprints"));
            }
            append(text, &format!("{}{BP_HOOK}", side_code(plan, Side::Blueprints, settings)))
        }
        _ => return Err(Error::Other(format!("a Forja não mexe em {path}"))),
    })
}

/// O texto de um arquivo do jogo como ele fica com os mods ligados: o do último mod que o traz
/// (em texto), ou o original do jogo (`uncompiled_lua.scd`).
pub fn effective_text(stock: &[PathBuf], mods: &[PathBuf], path: &str) -> Option<String> {
    let key = normalize_key(path);
    for archive in mods.iter().rev() {
        let Ok(mut scd) = Scd::open(archive) else { continue };
        let Ok(entries) = scd.entries() else { continue };
        if let Some(i) = entries.iter().position(|e| !e.is_dir && e.key == key) {
            if let Ok(data) = scd.read_at(i) {
                if !crate::lua::inspect(&data).compiled {
                    return Some(latin1(&data));
                }
            }
        }
    }
    let raw = crate::mapassets::read_game_file(stock, &format!("/uncompiled{path}")).ok()?;
    (!crate::lua::inspect(&raw).compiled).then(|| latin1(&raw))
}

/// O resultado de uma montagem, para a tela do launcher.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub loader_version: String,
    pub built_at: String,
    /// Os mods carregados, na ordem.
    pub loaded: Vec<LoadedMod>,
    pub problems: Vec<Problem>,
    /// Arquivos do jogo que receberam a Forja.
    pub patched: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LoadedMod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub library_id: String,
    pub sides: Vec<String>,
    pub description: String,
    pub authors: Vec<String>,
    pub options: Vec<ForjaOption>,
    pub values: BTreeMap<String, Value>,
    pub warnings: Vec<String>,
}

/// Os mods ligados que trazem mods da Forja, lidos e resolvidos. `archives` = (id na biblioteca,
/// arquivo), na ordem de montagem.
pub fn plan_for(archives: &[(String, PathBuf)]) -> Plan {
    let mut mods = Vec::new();
    let mut problems = Vec::new();
    for (lib, path) in archives {
        match read_archive(path, lib) {
            Ok((found, errs)) => {
                mods.extend(found);
                problems.extend(errs.into_iter().map(|e| Problem { mod_id: lib.clone(), message: e, fatal: true }));
            }
            Err(e) => problems.push(Problem { mod_id: lib.clone(), message: e.to_string(), fatal: true }),
        }
    }
    let mut plan = resolve(mods);
    problems.extend(plan.problems);
    plan.problems = problems;
    plan
}

/// Monta o `.scd` da Forja em `dest`: os arquivos do jogo (como ficam com os outros mods ligados,
/// `mods`) com o motor e o código dos mods do plano. Devolve o arquivo e o que foi montado.
pub fn build(stock: &[PathBuf], mods: &[PathBuf], plan: &Plan, settings: &Settings, dest: &Path) -> Result<(PathBuf, Status)> {
    let mut files: Vec<(String, Vec<u8>)> = Vec::new();
    for path in GAME_FILES {
        let mut variants = vec![path.to_string()];
        variants.extend(SHADOWS.iter().map(|s| format!("{s}{path}")));
        for (i, full) in variants.iter().enumerate() {
            let Some(text) = effective_text(stock, mods, full) else {
                if i == 0 {
                    return Err(Error::Other(format!(
                        "o jogo não tem o {} em texto (uncompiled_lua.scd): não dá para montar a Forja",
                        path.rsplit('/').next().unwrap_or(path)
                    )));
                }
                continue;
            };
            let patched = patch(path, &text, plan, settings)?;
            files.push((full.trim_start_matches('/').to_string(), to_bytes(&patched)));
        }
    }
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    for (path, data) in &files {
        b.add_bytes(path, data)?;
    }
    let archive = b.finish()?;
    let status = Status {
        loader_version: LOADER_VERSION.into(),
        built_at: chrono::Utc::now().to_rfc3339(),
        loaded: describe(plan, settings),
        problems: plan.problems.clone(),
        patched: files.iter().map(|(p, _)| p.clone()).collect(),
    };
    Ok((archive, status))
}

/// Os mods do plano como a tela do launcher mostra (com as opções e os valores escolhidos).
pub fn describe(plan: &Plan, settings: &Settings) -> Vec<LoadedMod> {
    plan.mods
        .iter()
        .map(|m| LoadedMod {
            id: m.manifest.id.clone(),
            name: m.manifest.name.clone(),
            version: m.manifest.version.clone(),
            library_id: m.library_id.clone(),
            sides: m.sides().into_iter().map(String::from).collect(),
            description: m.manifest.description.clone(),
            authors: m.manifest.authors.clone(),
            options: m.manifest.options.clone(),
            values: option_values(&m.manifest, settings.mods.get(&m.manifest.id)),
            warnings: m.lint(),
        })
        .collect()
}

/// Versão do mod montado: muda com a Forja, os mods, as opções e os arquivos do jogo de origem.
pub fn build_version(stock: &[PathBuf], mods: &[PathBuf], plan: &Plan, settings: &Settings) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    h.update(format!("{LOADER_VERSION}|{}", settings.panel_key()));
    for m in &plan.mods {
        h.update(format!("|{}@{}", m.manifest.id, m.manifest.version));
        for (p, d) in &m.files {
            h.update(p.as_bytes());
            h.update(d);
        }
        h.update(serde_json::to_vec(&option_values(&m.manifest, settings.mods.get(&m.manifest.id))).unwrap_or_default());
    }
    for p in stock.iter().chain(mods) {
        let meta = std::fs::metadata(p).ok();
        h.update(format!(
            "|{}:{}:{:?}",
            p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default(),
            meta.as_ref().map(|m| m.len()).unwrap_or(0),
            meta.and_then(|m| m.modified().ok())
        ));
    }
    format!("{LOADER_VERSION}+{}", &hex::encode(h.finalize())[..12])
}

/// Empacota uma pasta de mod da Forja num `.scd` pronto para importar ou publicar: a pasta do
/// projeto (com `forja/<id>/` e, se quiser, texturas, modelos e blueprints ao lado) ou só a pasta do
/// mod (com `mod.json`), que vai para `forja/<id>/`. Confere os mods antes.
pub fn pack(dir: &Path, dest: &Path) -> Result<(PathBuf, Vec<ForjaMod>)> {
    let mods = read_folder(dir)?;
    let single = dir.join("mod.json").is_file() && !dir.join("forja").is_dir();
    let prefix = if single { format!("forja/{}/", mods[0].manifest.id) } else { String::new() };
    let mut files = Vec::new();
    collect_all(dir, dir, &mut files)?;
    let mut b = crate::scd::ScdBuilder::create(dest)?;
    for (rel, path) in files {
        let low = rel.to_ascii_lowercase();
        // nada de arquivos de sistema ou do controle de versão
        if low.starts_with(".git") || low.contains("/.git") || low.ends_with(".ds_store") || low.ends_with("thumbs.db") || low.ends_with(".scd") {
            continue;
        }
        let data = std::fs::read(&path).map_err(|e| Error::io(&path, e))?;
        b.add_bytes(&format!("{prefix}{rel}"), &data)?;
    }
    Ok((b.finish()?, mods))
}

fn collect_all(root: &Path, dir: &Path, out: &mut Vec<(String, PathBuf)>) -> Result<()> {
    let rd = std::fs::read_dir(dir).map_err(|e| Error::io(dir, e))?;
    let mut entries: Vec<_> = rd.flatten().map(|e| e.path()).collect();
    entries.sort();
    for p in entries {
        if p.is_dir() {
            collect_all(root, &p, out)?;
        } else {
            let rel = p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/");
            out.push((rel, p));
        }
    }
    Ok(())
}

/// Esqueleto de um mod novo (para `cp forja new` e para o launcher): `forja/<id>/` com mod.json e
/// os três arquivos comentados.
pub fn scaffold(dir: &Path, id: &str, name: &str) -> Result<PathBuf> {
    scaffold_with(dir, id, name, "completo")
}

/// Modelos de mod novo: (chave, nome, o que faz).
pub const TEMPLATES: &[(&str, &str, &str)] = &[
    ("completo", "Completo", "Blueprints, simulação, interface e biblioteca: um pouco de tudo, comentado."),
    ("balanceamento", "Balanceamento", "Só blueprints: muda vida, custo, velocidade e alcance das unidades, com opções no launcher."),
    ("painel", "Painel", "Só interface: um painel com tecla própria que mostra informações da partida."),
    ("regra", "Regra de jogo", "Só simulação: uma regra nova para a partida (unidades que destroem outras se recuperam)."),
    ("biblioteca", "Biblioteca", "Funções para outros mods usarem com Forja.Use (dependência)."),
];

/// Cria um mod novo a partir de um dos [`TEMPLATES`].
pub fn scaffold_with(dir: &Path, id: &str, name: &str, template: &str) -> Result<PathBuf> {
    if !TEMPLATES.iter().any(|t| t.0 == template) {
        return Err(Error::Other(format!("modelo \"{template}\" não existe")));
    }
    if !valid_id(id) {
        return Err(Error::Other(format!("id \"{id}\" inválido (letras minúsculas, números, '-' e '_')")));
    }
    let root = dir.join("forja").join(id);
    if root.exists() {
        return Err(Error::Other(format!("{} já existe", root.display())));
    }
    std::fs::create_dir_all(root.join("lib")).map_err(|e| Error::io(&root, e))?;
    let manifest = ForjaManifest {
        id: id.into(),
        name: name.into(),
        version: "1.0.0".into(),
        authors: vec![],
        description: "O que o mod faz.".into(),
        loader: Some(format!(">={LOADER_VERSION}")),
        dependencies: vec![],
        optional_dependencies: vec![],
        load_after: vec![],
        load_before: vec![],
        conflicts: vec![],
        options: vec![],
    };
    let number = |key: &str, label: &str, description: &str, default: f64, min: f64, max: f64, step: f64| ForjaOption {
        key: key.into(),
        label: label.into(),
        description: description.into(),
        kind: OptionKind::Number,
        default: Value::from(default),
        min: Some(min),
        max: Some(max),
        step: Some(step),
        choices: vec![],
    };
    let mut manifest = manifest;
    manifest.options = match template {
        "balanceamento" => vec![
            number("health", "Vida", "Multiplica a vida das unidades.", 1.0, 0.25, 5.0, 0.25),
            number("cost", "Custo", "Multiplica o custo de massa e energia.", 1.0, 0.25, 5.0, 0.25),
            number("speed", "Velocidade", "Multiplica a velocidade das unidades terrestres e navais.", 1.0, 0.5, 3.0, 0.1),
            number("range", "Alcance", "Multiplica o alcance das armas.", 1.0, 0.5, 2.0, 0.1),
        ],
        "regra" => vec![number("heal", "Recuperação", "Fração da vida que a unidade recupera ao destruir outra.", 0.1, 0.0, 1.0, 0.05)],
        "painel" | "biblioteca" => vec![],
        _ => vec![number("multiplier", "Multiplicador de vida", "Quanto a vida das unidades terrestres é multiplicada.", 1.5, 1.0, 5.0, 0.5)],
    };
    if template == "biblioteca" {
        manifest.description = "Funções para outros mods: Forja.Use('@ID@').".replace("@ID@", id);
    }
    let write = |name: &str, text: String| -> Result<()> {
        let p = root.join(name);
        std::fs::write(&p, text).map_err(|e| Error::io(&p, e))
    };
    write("mod.json", serde_json::to_string_pretty(&manifest).map_err(|e| Error::Other(e.to_string()))? + "\n")?;
    let files: &[(&str, &str)] = match template {
        "balanceamento" => &[("blueprints.lua", TEMPLATE_BALANCE)],
        "painel" => &[("ui.lua", TEMPLATE_PANEL)],
        "regra" => &[("sim.lua", TEMPLATE_RULE)],
        "biblioteca" => &[("sim.lua", TEMPLATE_LIBRARY), ("ui.lua", TEMPLATE_LIBRARY)],
        _ => &[("blueprints.lua", TEMPLATE_BP), ("sim.lua", TEMPLATE_SIM), ("ui.lua", TEMPLATE_UI), ("lib/util.lua", TEMPLATE_LIB)],
    };
    for (file, text) in files {
        write(file, text.replace("@ID@", id))?;
    }
    if !files.iter().any(|f| f.0.starts_with("lib/")) {
        let _ = std::fs::remove_dir(root.join("lib"));
    }
    Ok(root)
}

const TEMPLATE_BALANCE: &str = "-- Balanceamento: roda enquanto o jogo carrega os blueprints (antes de qualquer partida).
-- Cada opção aparece no launcher (Forja > este mod) e vale na próxima partida.
local health = mod.Option('health', 1)
local cost = mod.Option('cost', 1)
local speed = mod.Option('speed', 1)
local range = mod.Option('range', 1)

-- filtro: uma categoria ('LAND', 'AIR', 'NAVAL', 'STRUCTURE', 'EXPERIMENTAL'...) ou nil para todas
Forja.BP.EachUnit(nil, function(bp, id)
    if health ~= 1 then Forja.BP.Scale(bp, 'Defense.MaxHealth', health) end
    if cost ~= 1 then
        Forja.BP.Scale(bp, 'Economy.MassValue', cost)
        Forja.BP.Scale(bp, 'Economy.EnergyValue', cost)
    end
    if speed ~= 1 and not Forja.BP.HasCategory(bp, 'AIR') then
        Forja.BP.Scale(bp, 'Physics.MaxSpeed', speed)
    end
    if range ~= 1 and bp.Weapons then
        for _, w in bp.Weapons do
            if w.MaxRadius then w.MaxRadius = w.MaxRadius * range end
        end
    end
end)

-- uma unidade só: Forja.BP.Patch('uul0101', { Defense = { MaxHealth = 500 } })
mod.Log('balanceamento: vida x' .. health .. ', custo x' .. cost .. ', velocidade x' .. speed .. ', alcance x' .. range)
";

const TEMPLATE_PANEL: &str = "-- Painel: roda na interface do jogador (só no computador dele).
local panel = Forja.UI.Panel({ title = mod.Name, subtitle = 'F7 abre e fecha' })

-- botões com valor: a função devolve o texto (e a cor) mostrado à direita
panel:Button('Tempo de jogo', nil, function()
    local s = math.floor(GetGameTimeSeconds())
    return string.format('%d:%02d', math.floor(s / 60), math.mod(s, 60))
end)
panel:Button('Exército', nil, function() return tostring(GetFocusArmy()) end)
panel:Button('Avisar na tela', function()
    Forja.UI.Notify('Olá do ' .. mod.Name .. '!', 4)
end)

-- atualiza o painel a cada segundo enquanto ele está aberto
Forja.Every(1, function()
    if panel:IsShown() then panel:Refresh() end
end)

Forja.UI.AddKey('F7', mod.Name, function() panel:Toggle() end)
Forja.UI.AddMenuItem(mod.Name, function() panel:Toggle() end)
";

const TEMPLATE_RULE: &str = "-- Regra de jogo: roda na simulação (a mesma em todos os jogadores, então vale no multijogador).
local heal = mod.Option('heal', 0.1)

-- quem destrói uma unidade recupera parte da vida
Forja.On('UnitKilled', function(unit, instigator)
    if heal <= 0 or not instigator or not instigator.GetMaxHealth or instigator:IsDead() then return end
    local max = instigator:GetMaxHealth()
    instigator:SetHealth(instigator, math.min(max, instigator:GetHealth() + max * heal))
end)

Forja.On('SessionStart', function()
    mod.Log('regra ligada: recuperação de ' .. math.floor(heal * 100) .. '% por abate')
end)
";

const TEMPLATE_LIBRARY: &str = "-- Biblioteca: funções que outros mods usam com  local lib = Forja.Use('@ID@')
-- (ponha \"@ID@\" em \"dependencies\" no mod.json deles para carregar antes).
local M = {}

-- texto de uma tabela (para mod.Log)
function M.Describe(t)
    if type(t) ~= 'table' then return tostring(t) end
    local parts = {}
    for k, v in pairs(t) do table.insert(parts, tostring(k) .. '=' .. tostring(v)) end
    return '{' .. table.concat(parts, ', ') .. '}'
end

-- arredonda com casas decimais
function M.Round(x, places)
    local m = 10 ^ (places or 0)
    return math.floor(x * m + 0.5) / m
end

-- quantos itens tem uma tabela (o Lua do jogo não tem o operador #)
function M.Count(t)
    local n = 0
    for _ in pairs(t) do n = n + 1 end
    return n
end

mod.Export(M)
";

const TEMPLATE_BP: &str = "-- Roda enquanto o jogo carrega os blueprints (antes de qualquer partida).
-- `mod` é este mod (mod.Id, mod.Option, mod.Log...) e `Forja` é a API do carregador.
local mult = mod.Option('multiplier', 1.5)

Forja.BP.EachUnit('LAND', function(bp, id)
    Forja.BP.Scale(bp, 'Defense.MaxHealth', mult)
end)
mod.Log('vida das unidades terrestres x' .. mult)
";

const TEMPLATE_SIM: &str = "-- Roda na simulação (a mesma em todos os jogadores).
local util = mod.Require('lib/util')

Forja.On('SessionStart', function()
    mod.Log('partida começou com ' .. Forja.Sim.HumanCount() .. ' jogador(es)')
end)

Forja.On('UnitKilled', function(unit, instigator)
    if instigator and instigator.GetArmy then
        Forja.Sim.SendToUI('@ID@:kill', { army = instigator:GetArmy() })
    end
end)

-- a interface manda este comando com Forja.UI.SendToSim('@ID@:hello', dados)
Forja.Sim.OnCommand('@ID@:hello', function(data, units)
    mod.Log(util.Describe(data))
end)
";

const TEMPLATE_UI: &str = "-- Roda na interface do jogador (só no computador dele).
local kills = 0
local panel = Forja.UI.Panel({ title = mod.Name, subtitle = 'F7 abre e fecha' })
panel:Button('Abates', nil, function() return tostring(kills), Forja.UI.Colors.Ok end)
panel:Button('Dizer oi para a simulação', function()
    Forja.UI.SendToSim('@ID@:hello', { text = 'oi' })
end)

Forja.UI.OnSim('@ID@:kill', function(data)
    if data.army == GetFocusArmy() then
        kills = kills + 1
        panel:Refresh()
    end
end)

Forja.UI.AddKey('F7', mod.Name, function() panel:Toggle() end)
Forja.UI.AddMenuItem(mod.Name, function() panel:Toggle() end)
Forja.On('UIReady', function()
    Forja.UI.Notify(mod.Name .. ' carregado (F7)')
end)
";

const TEMPLATE_LIB: &str = "-- Um arquivo extra do mod: mod.Require('lib/util') roda uma vez e devolve o que ele retornar.
local M = {}

function M.Describe(t)
    if type(t) ~= 'table' then return tostring(t) end
    local parts = {}
    for k, v in pairs(t) do table.insert(parts, tostring(k) .. '=' .. tostring(v)) end
    return '{' .. table.concat(parts, ', ') .. '}'
end

return M
";

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(id: &str) -> ForjaManifest {
        serde_json::from_value(serde_json::json!({ "id": id, "name": id.to_uppercase(), "version": "1.0.0" })).unwrap()
    }

    fn fmod(m: ForjaManifest) -> ForjaMod {
        let mut files = BTreeMap::new();
        files.insert("sim.lua".to_string(), b"mod.Log('oi')".to_vec());
        ForjaMod { manifest: m, library_id: "lib".into(), files }
    }

    fn ids(p: &Plan) -> Vec<&str> {
        p.mods.iter().map(|m| m.manifest.id.as_str()).collect()
    }

    #[test]
    fn manifest_checks() {
        let mut m = manifest("ok-mod");
        assert!(m.validate().is_ok());
        m.id = "Bad Id".into();
        assert!(m.validate().is_err());
        let mut m = manifest("x1");
        m.version = "abc".into();
        assert!(m.validate().is_err());
        let mut m = manifest("x2");
        m.options.push(ForjaOption {
            key: "speed".into(),
            label: "Velocidade".into(),
            description: String::new(),
            kind: OptionKind::Choice,
            default: Value::from("fast"),
            min: None,
            max: None,
            step: None,
            choices: vec![Choice { value: "slow".into(), label: "Devagar".into() }],
        });
        assert!(m.validate().is_err(), "padrão fora das escolhas");
        m.options[0].choices.push(Choice { value: "fast".into(), label: "Rápido".into() });
        assert!(m.validate().is_ok());
        m.dependencies.push(Dependency { id: "x2".into(), version: None });
        assert!(m.validate().is_err(), "depende de si mesmo");
    }

    #[test]
    fn order_and_dependencies() {
        let mut a = manifest("a");
        a.dependencies.push(Dependency { id: "lib".into(), version: Some(">=1.0".into()) });
        let lib = manifest("lib");
        let mut c = manifest("c");
        c.load_before.push("a".into());
        let mut d = manifest("d");
        d.dependencies.push(Dependency { id: "missing".into(), version: None });
        let mut e = manifest("e");
        e.dependencies.push(Dependency { id: "d".into(), version: None });
        let mut f = manifest("f");
        f.loader = Some(">=9".into());
        let mut g = manifest("g");
        g.conflicts.push("a".into());
        let mut old = manifest("old");
        old.dependencies.push(Dependency { id: "lib".into(), version: Some(">=2".into()) });
        let plan = resolve([a, lib, c, d, e, f, g, old].into_iter().map(fmod).collect());
        assert_eq!(ids(&plan), ["c", "lib", "a"]);
        let fatal: Vec<&str> = plan.problems.iter().filter(|p| p.fatal).map(|p| p.mod_id.as_str()).collect();
        for id in ["d", "e", "f", "g", "old"] {
            assert!(fatal.contains(&id), "{id} deveria sair: {:?}", plan.problems);
        }
        // ciclo
        let mut x = manifest("x");
        x.load_after.push("y".into());
        let mut y = manifest("y");
        y.load_after.push("x".into());
        let plan = resolve(vec![fmod(x), fmod(y), fmod(manifest("z"))]);
        assert_eq!(ids(&plan), ["z"]);
        assert_eq!(plan.problems.len(), 2);
    }

    #[test]
    fn option_values_are_checked() {
        let m: ForjaManifest = serde_json::from_value(serde_json::json!({
            "id": "o", "name": "O", "version": "1.0.0",
            "options": [
                { "key": "on", "label": "On", "type": "bool", "default": true },
                { "key": "n", "label": "N", "type": "number", "default": 2, "min": 1, "max": 5 },
                { "key": "c", "label": "C", "type": "choice", "default": "a", "choices": [{ "value": "a", "label": "A" }, { "value": "b", "label": "B" }] }
            ]
        }))
        .unwrap();
        m.validate().unwrap();
        let mut saved = BTreeMap::new();
        saved.insert("on".to_string(), Value::from(false));
        saved.insert("n".to_string(), Value::from(99));
        saved.insert("c".to_string(), Value::from("zzz"));
        let v = option_values(&m, Some(&saved));
        assert_eq!(v["on"], Value::from(false));
        assert_eq!(v["n"].as_f64(), Some(5.0));
        assert_eq!(v["c"], Value::from("a"));
        assert_eq!(option_values(&m, None)["n"].as_f64(), Some(2.0));
    }

    #[test]
    fn lua_text_is_safe() {
        assert_eq!(lua_str("a'b\\c\nd"), "'a\\'b\\\\c\\nd'");
        let s = long_string("x ]] y ]=] z");
        assert!(s.starts_with("[==[\n") && s.ends_with("]==]"), "{s}");
        assert_eq!(lua_value(&serde_json::json!({ "a": [1, 2.5, true] })), "{ ['a'] = { 1, 2.5, true } }");
        // acentos em UTF-8 passam byte a byte
        assert_eq!(to_bytes(&lua_utf8("ção")), [b"'".as_slice(), "ção".as_bytes(), b"'"].concat());
        let c = chunk(b"\xef\xbb\xbfprint(1)\nprint(2)");
        assert!(c.contains("local mod, Forja = ForjaMod, Forja; print(1)\nprint(2)"), "{c}");
    }

    #[test]
    fn game_files_get_the_loader() {
        let plan = resolve(vec![fmod(manifest("demo"))]);
        let s = Settings::default();
        let sim = patch("/lua/simInit.lua", "function BeginSession()\n\tlocal a = 1\n\tForkThread(import('/lua/sim/aibrain.lua').CollectCurrentScores)\nend\n", &plan, &s).unwrap();
        assert!(sim.find(SIM_HOOK).unwrap() < sim.find("CollectCurrentScores").unwrap());
        assert!(sim.contains("Forja._Register({\n    id = 'demo',") && sim.contains("Side = 'sim'"));
        assert!(patch("/lua/simInit.lua", &sim, &plan, &s).is_err(), "não monta duas vezes");
        let unit = patch("/lua/sim/Unit.lua", "Unit = Class(moho.unit_methods) {\n}\n", &plan, &s).unwrap();
        assert!(unit.contains("Wrap('OnCreate', 'UnitCreated', false)"));
        let cb = patch("/lua/sim/SimCallbacks.lua", "local Callbacks = {}\n", &plan, &s).unwrap();
        assert!(cb.contains(CALLBACK));
        let sync = patch("/lua/UserSync.lua", "function OnSync()\n\tx()\nend\n", &plan, &s).unwrap();
        assert!(sync.contains(&format!("\tx()\n{SYNC_HOOK}end\n")));
        let ui = patch("/lua/ui/game/gamemain_pc.lua", "function OnFirstUpdate()\n\ty()\nend\n", &plan, &s).unwrap();
        assert!(ui.contains(UI_HOOK) && ui.contains("function ForjaKey(name)") && ui.contains("local KEY = 'F8'"));
        let bp = patch("/lua/system/Blueprints.lua", "function ModBlueprints(all_blueprints)\nend\n", &plan, &s).unwrap();
        assert!(bp.contains("defer = true") && bp.ends_with(BP_HOOK));
        assert!(patch("/lua/UserSync.lua", "nada", &plan, &s).is_err());
    }

    /// Com `CP_FORJA_DUMP` (pasta), grava o Lua gerado de cada parte para o mod de exemplo (usado
    /// por `tools/test_forja.py`, que roda o motor num mundo falso).
    #[test]
    fn dump_generated() {
        let Some(dir) = std::env::var_os("CP_FORJA_DUMP") else { return };
        let dir = PathBuf::from(dir);
        let _ = std::fs::remove_dir_all(dir.join("src"));
        scaffold(&dir.join("src"), "demo", "Demo").unwrap();
        let mut mods = read_folder(&dir.join("src")).unwrap();
        // um mod quebrado (erro de sintaxe) e um que depende do demo
        let mut broken = mods[0].clone();
        broken.manifest.id = "broken".into();
        broken.manifest.name = "Quebrado".into();
        broken.files.insert("sim.lua".into(), b"local x = = 1".to_vec());
        broken.files.insert("ui.lua".into(), b"error('falhou de proposito')".to_vec());
        broken.files.insert("blueprints.lua".into(), b"Forja.BP.Unit(nil).x = 1".to_vec());
        broken.manifest.options.clear();
        let mut user = mods[0].clone();
        user.manifest.id = "user".into();
        user.manifest.dependencies.push(Dependency { id: "demo".into(), version: Some(">=1.0".into()) });
        user.files.clear();
        user.files.insert("sim.lua".into(), b"local api = Forja.Use('demo')\nForja.On('SessionStart', function() mod.Data.api = api end, 10)\nmod.Export({ hello = function() return 'oi' end })".to_vec());
        mods.push(broken);
        mods.push(user);
        let plan = resolve(mods);
        let mut settings = Settings::default();
        settings.mods.entry("demo".into()).or_default().insert("multiplier".into(), Value::from(2));
        for side in [Side::Sim, Side::Ui, Side::Blueprints] {
            std::fs::write(dir.join(format!("{}.lua", side.key())), to_bytes(&side_code(&plan, side, &settings))).unwrap();
        }
        std::fs::write(dir.join("unit.lua"), UNIT).unwrap();
    }

    #[test]
    fn archives_and_folders() {
        let t = std::env::temp_dir().join(format!("cp-forja-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&t);
        std::fs::create_dir_all(&t).unwrap();
        let root = scaffold(&t, "meu-mod", "Meu mod").unwrap();
        assert!(scaffold(&t, "meu-mod", "x").is_err());
        // todos os modelos saem limpos (sem armadilhas do Lua 5.0) e carregam
        for (key, _, _) in TEMPLATES.iter().filter(|t| t.0 != "completo") {
            let d = t.join("modelos").join(key);
            let r = scaffold_with(&d, &format!("m-{key}"), key, key).unwrap();
            let m = &read_folder(&r).unwrap()[0];
            assert!(m.lint().is_empty(), "{key}: {:?}", m.lint());
            assert!(!m.sides().is_empty(), "{key}");
        }
        assert!(scaffold_with(&t.join("x"), "x", "x", "nada").is_err());
        let found = read_folder(&t).unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].sides(), ["sim", "ui", "blueprints"]);
        assert!(found[0].has("lib/util.lua"));
        assert!(found[0].lint().is_empty(), "{:?}", found[0].lint());
        assert_eq!(read_folder(&root).unwrap()[0].manifest.id, "meu-mod");
        // num .scd, com um mod quebrado do lado
        let scd = t.join("m.scd");
        let mut b = crate::scd::ScdBuilder::create(&scd).unwrap();
        b.add_bytes("forja/meu-mod/mod.json", &std::fs::read(root.join("mod.json")).unwrap()).unwrap();
        b.add_bytes("forja/meu-mod/sim.lua", b"mod.Log(1)").unwrap();
        b.add_bytes("forja/quebrado/sim.lua", b"x").unwrap();
        b.add_bytes("textures/a.dds", b"x").unwrap();
        b.finish().unwrap();
        let (mods, problems) = read_archive(&scd, "lib-x").unwrap();
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].library_id, "lib-x");
        assert_eq!(problems.len(), 1, "{problems:?}");
        let plan = plan_for(&[("lib-x".into(), scd.clone())]);
        assert_eq!(ids(&plan), ["meu-mod"]);
        // empacotar a pasta do projeto e a do mod dá o mesmo mod
        for (src, out) in [(t.clone(), t.join("a.scd")), (root.clone(), t.join("b.scd"))] {
            let (archive, packed) = pack(&src, &out).unwrap();
            assert_eq!(packed.len(), 1);
            let (again, problems) = read_archive(&archive, "x").unwrap();
            assert!(problems.is_empty(), "{problems:?}");
            assert_eq!(again[0].files.len(), 4);
        }
        let _ = std::fs::remove_dir_all(&t);
    }
}
