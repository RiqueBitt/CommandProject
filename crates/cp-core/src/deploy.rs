//! Motor de implantação: coloca os `.scd` do perfil ativo na pasta `gamedata`
//! e sabe desfazer tudo, byte a byte.
//!
//! Garantias:
//! * **Linha de base** — na primeira varredura, cada arquivo da pasta é registrado
//!   (nome, tamanho, SHA-256) e classificado como original do jogo ou "não gerenciado".
//! * **Backup antes de substituir** — se um mod troca um arquivo existente (ex.: `lua.scd`),
//!   o original vai para `backups/<sha256>.scd` (endereçado por conteúdo, sem duplicatas).
//! * **Diário com intenção** — cada operação grava a intenção antes de tocar no disco e
//!   o resultado depois. Se o PC desligar no meio, `recover()` termina ou desfaz a operação.
//! * **Nada é apagado às cegas** — se um arquivo implantado foi alterado por fora, ele vai
//!   para `quarantine/` em vez de ser apagado.

use crate::error::{Error, IoContext, Result};
use crate::fsutil::{copy_atomic, read_json_or_default, sha256_bytes, write_atomic, write_json};
use crate::game::{is_stock_archive, GameInstall};
use crate::hashcache::HashCache;
use crate::library::Library;
use crate::profile::Profile;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BaselineKind {
    /// Arquivo original do jogo.
    Stock,
    /// Estava na pasta antes do launcher (provavelmente um mod instalado à mão).
    Unmanaged,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BaselineFile {
    pub name: String,
    pub sha256: String,
    pub size: u64,
    pub kind: BaselineKind,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Baseline {
    pub created_at: String,
    pub gamedata: PathBuf,
    /// chave = nome em minúsculas
    pub files: BTreeMap<String, BaselineFile>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeployKind {
    /// Arquivo novo na pasta.
    Added,
    /// Substituiu um arquivo que existia (o original está em `backups/`).
    Replaced,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Deployed {
    pub name: String,
    pub sha256: String,
    pub mod_id: String,
    pub mod_version: String,
    pub kind: DeployKind,
    /// SHA-256 do original guardado em `backups/` (só para `Replaced`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase", tag = "action")]
pub enum Pending {
    Add { entry: Deployed },
    Remove { entry: Deployed },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Journal {
    pub profile: Option<String>,
    pub deployed_at: Option<String>,
    pub entries: Vec<Deployed>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending: Option<Pending>,
}

impl Journal {
    fn find(&self, name: &str) -> Option<usize> {
        self.entries.iter().position(|e| e.name.eq_ignore_ascii_case(name))
    }
}

/// O que um perfil quer na pasta.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub name: String,
    pub source: PathBuf,
    pub sha256: String,
    pub mod_id: String,
    pub mod_version: String,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub add: Vec<String>,
    pub replace: Vec<String>,
    pub remove: Vec<String>,
    pub restore: Vec<String>,
    pub unchanged: Vec<String>,
    /// Avisos não fatais (dois mods com o mesmo arquivo, dependência faltando…).
    pub warnings: Vec<String>,
}

impl Plan {
    pub fn is_noop(&self) -> bool {
        self.add.is_empty() && self.replace.is_empty() && self.remove.is_empty() && self.restore.is_empty()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub step: usize,
    pub total: usize,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileStatus {
    pub name: String,
    pub size: u64,
    /// "stock" | "unmanaged" | "managed" | "new"
    pub origin: String,
    pub mod_id: Option<String>,
    /// "ok" | "modified" | "missing"
    pub state: String,
}

/// Estado do índice do jogo mantido pelo launcher.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TocState {
    /// SHA-256 do índice original do jogo (cópia em `deploy/toc-original.bdf`).
    original: Option<String>,
    /// SHA-256 do índice que o launcher gravou por último (`None` = original no lugar).
    written: Option<String>,
    /// Quantos arquivos do jogo estão sendo lidos dos .scd de mods.
    redirected: usize,
    /// Arquivos que o launcher deixou soltos na pasta do jogo (relativos à raiz, com `/`).
    #[serde(default)]
    loose: Vec<String>,
}

pub struct Deployer<'a> {
    pub game: &'a GameInstall,
    pub data_dir: &'a Path,
    pub hashes: &'a mut HashCache,
}

impl<'a> Deployer<'a> {
    fn journal_path(&self) -> PathBuf {
        self.data_dir.join("deploy").join("journal.json")
    }
    fn baseline_path(&self) -> PathBuf {
        self.data_dir.join("deploy").join("baseline.json")
    }
    fn backups_dir(&self) -> PathBuf {
        self.data_dir.join("backups")
    }
    fn quarantine_dir(&self) -> PathBuf {
        self.data_dir.join("quarantine")
    }

    pub fn journal(&self) -> Result<Journal> {
        read_json_or_default(&self.journal_path())
    }
    fn save_journal(&self, j: &Journal) -> Result<()> {
        write_json(&self.journal_path(), j)
    }

    pub fn baseline(&self) -> Result<Option<Baseline>> {
        let p = self.baseline_path();
        if !p.exists() {
            return Ok(None);
        }
        let mut b: Baseline = crate::fsutil::read_json(&p)?;
        // versões antigas não conheciam todos os .scd do jogo e os marcavam como "instalados à mão"
        let mut fixed = false;
        for f in b.files.values_mut() {
            if f.kind == BaselineKind::Unmanaged && is_stock_archive(&f.name) {
                f.kind = BaselineKind::Stock;
                fixed = true;
            }
        }
        if fixed {
            write_json(&p, &b)?;
        }
        Ok(Some(b))
    }

    /// Cria a linha de base se ainda não existir (ou se a pasta do jogo mudou).
    pub fn ensure_baseline(&mut self, progress: &mut dyn FnMut(Progress)) -> Result<Baseline> {
        if let Some(b) = self.baseline()? {
            if b.gamedata == self.game.gamedata {
                return Ok(b);
            }
        }
        let journal = self.journal()?;
        let archives = self.game.archives()?;
        let total = archives.len();
        let mut files = BTreeMap::new();
        for (i, path) in archives.iter().enumerate() {
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            if journal.find(&name).is_some() {
                continue; // implantado por nós: não é linha de base
            }
            progress(Progress {
                step: i + 1,
                total,
                message: format!("Lendo {name}"),
            });
            let sha = self.hashes.sha256(path)?;
            let size = path.metadata().at(path)?.len();
            let kind = if is_stock_archive(&name) {
                BaselineKind::Stock
            } else {
                BaselineKind::Unmanaged
            };
            files.insert(
                name.to_ascii_lowercase(),
                BaselineFile {
                    name,
                    sha256: sha,
                    size,
                    kind,
                },
            );
        }
        let b = Baseline {
            created_at: chrono::Utc::now().to_rfc3339(),
            gamedata: self.game.gamedata.clone(),
            files,
        };
        write_json(&self.baseline_path(), &b)?;
        self.hashes.save()?;
        Ok(b)
    }

    /// O usuário corrige a classificação de um arquivo da linha de base.
    pub fn set_baseline_kind(&mut self, name: &str, kind: BaselineKind) -> Result<()> {
        let mut b = self
            .baseline()?
            .ok_or_else(|| Error::Other("linha de base ainda não criada".into()))?;
        let f = b
            .files
            .get_mut(&name.to_ascii_lowercase())
            .ok_or_else(|| Error::Other(format!("{name} não está na linha de base")))?;
        f.kind = kind;
        write_json(&self.baseline_path(), &b)
    }

    /// "Adota" um arquivo não gerenciado: ele passa a pertencer ao mod `mod_id`
    /// (que já deve ter sido importado na biblioteca com o mesmo arquivo).
    pub fn adopt(&mut self, name: &str, mod_id: &str, mod_version: &str) -> Result<()> {
        let mut b = self
            .baseline()?
            .ok_or_else(|| Error::Other("linha de base ainda não criada".into()))?;
        let f = b
            .files
            .remove(&name.to_ascii_lowercase())
            .ok_or_else(|| Error::Other(format!("{name} não está na linha de base")))?;
        let mut j = self.journal()?;
        j.entries.push(Deployed {
            name: f.name,
            sha256: f.sha256,
            mod_id: mod_id.into(),
            mod_version: mod_version.into(),
            kind: DeployKind::Added,
            backup: None,
        });
        self.save_journal(&j)?;
        write_json(&self.baseline_path(), &b)
    }

    /// Calcula os arquivos desejados para um perfil.
    pub fn targets(&self, library: &Library, profile: &Profile, warnings: &mut Vec<String>) -> Result<Vec<Target>> {
        let mut by_name: HashMap<String, usize> = HashMap::new();
        let mut out: Vec<Target> = Vec::new();
        let enabled = profile.enabled_ids();
        let mut versions = HashMap::new();
        for id in &enabled {
            let m = match library.get(id) {
                Ok(m) => m,
                Err(_) => {
                    warnings.push(format!(
                        "o mod \"{id}\" está no perfil mas não está instalado — ignorado"
                    ));
                    continue;
                }
            };
            versions.insert(m.manifest.id.clone(), m.manifest.version.clone());
            for f in &m.manifest.files {
                let t = Target {
                    name: f.name.clone(),
                    source: m.file_path(&f.name),
                    sha256: f.sha256.clone(),
                    mod_id: m.manifest.id.clone(),
                    mod_version: m.manifest.version.clone(),
                };
                let key = f.name.to_ascii_lowercase();
                if let Some(&idx) = by_name.get(&key) {
                    warnings.push(format!(
                        "\"{}\" e \"{}\" fornecem o mesmo arquivo {} — vale o que vem depois na ordem ({})",
                        out[idx].mod_id, t.mod_id, f.name, t.mod_id
                    ));
                    out[idx] = t;
                } else {
                    by_name.insert(key, out.len());
                    out.push(t);
                }
            }
        }
        // dependências e conflitos declarados
        for id in &enabled {
            let Ok(m) = library.get(id) else { continue };
            for dep in &m.manifest.dependencies {
                match versions.get(&dep.id) {
                    None => warnings.push(format!(
                        "\"{}\" precisa de \"{}\", que não está ativo",
                        m.manifest.name, dep.id
                    )),
                    Some(v) if !crate::manifest::version_matches(dep.version.as_deref(), v) => warnings.push(format!(
                        "\"{}\" precisa de \"{}\" {} (ativo: {v})",
                        m.manifest.name,
                        dep.id,
                        dep.version.clone().unwrap_or_default()
                    )),
                    _ => {}
                }
            }
            for c in &m.manifest.conflicts {
                if versions.contains_key(c) {
                    warnings.push(format!("\"{}\" declara conflito com \"{c}\"", m.manifest.name));
                }
            }
        }
        Ok(out)
    }

    /// O que `apply` faria, sem tocar em nada.
    pub fn plan(&self, targets: &[Target]) -> Result<Plan> {
        let j = self.journal()?;
        let mut plan = Plan::default();
        for e in &j.entries {
            let wanted = targets.iter().find(|t| t.name.eq_ignore_ascii_case(&e.name));
            match wanted {
                Some(t) if t.sha256 == e.sha256 => plan.unchanged.push(e.name.clone()),
                Some(_) => plan.replace.push(e.name.clone()),
                None if e.kind == DeployKind::Replaced => plan.restore.push(e.name.clone()),
                None => plan.remove.push(e.name.clone()),
            }
        }
        for t in targets {
            if j.find(&t.name).is_none() {
                if self.game.gamedata.join(&t.name).exists() {
                    plan.replace.push(t.name.clone());
                } else {
                    plan.add.push(t.name.clone());
                }
            }
        }
        Ok(plan)
    }

    /// Termina ou desfaz uma operação interrompida (queda de energia, crash).
    pub fn recover(&mut self) -> Result<Option<String>> {
        let mut j = self.journal()?;
        let Some(p) = j.pending.take() else { return Ok(None) };
        // remove temporários esquecidos
        if let Ok(rd) = fs::read_dir(&self.game.gamedata) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy().ends_with(".cp-tmp") {
                    let _ = fs::remove_file(e.path());
                }
            }
        }
        let msg = match p {
            Pending::Add { entry } => {
                let path = self.game.gamedata.join(&entry.name);
                let on_disk = if path.exists() {
                    Some(self.hashes.sha256(&path)?)
                } else {
                    None
                };
                if on_disk.as_deref() == Some(entry.sha256.as_str()) {
                    j.entries.push(entry.clone());
                    format!("implantação de {} concluída após interrupção", entry.name)
                } else {
                    // a cópia não terminou: garante o original no lugar
                    if let (DeployKind::Replaced, Some(b)) = (entry.kind, &entry.backup) {
                        if on_disk.as_deref() != Some(b.as_str()) {
                            self.restore_backup(b, &path)?;
                        }
                    }
                    format!("implantação de {} desfeita após interrupção", entry.name)
                }
            }
            Pending::Remove { entry } => {
                self.remove_one(&entry)?;
                format!("remoção de {} concluída após interrupção", entry.name)
            }
        };
        self.save_journal(&j)?;
        self.hashes.save()?;
        Ok(Some(msg))
    }

    /// Faz a pasta do jogo ficar exatamente como os `targets` pedem.
    pub fn apply(
        &mut self,
        targets: &[Target],
        profile_id: Option<&str>,
        progress: &mut dyn FnMut(Progress),
    ) -> Result<Plan> {
        self.recover()?;
        let baseline = self.ensure_baseline(progress)?;
        let mut plan = self.plan(targets)?;
        let total = plan.add.len() + plan.replace.len() + plan.remove.len() + plan.restore.len();
        let mut step = 0;
        let mut j = self.journal()?;

        // 1) remover/restaurar o que não é mais desejado ou mudou de versão
        let stale: Vec<Deployed> = j
            .entries
            .iter()
            .filter(|e| {
                !targets
                    .iter()
                    .any(|t| t.name.eq_ignore_ascii_case(&e.name) && t.sha256 == e.sha256)
            })
            .cloned()
            .collect();
        for entry in stale {
            step += 1;
            progress(Progress {
                step,
                total,
                message: format!("Removendo {}", entry.name),
            });
            j.pending = Some(Pending::Remove { entry: entry.clone() });
            self.save_journal(&j)?;
            self.remove_one(&entry)?;
            if let Some(i) = j.find(&entry.name) {
                j.entries.remove(i);
            }
            j.pending = None;
            self.save_journal(&j)?;
        }

        // 1b) cópias soltas com nome de arquivo gerado pelo launcher que ele não controla (sobras de
        // um teste ou de uma versão antiga): vão para a quarentena para não serem montadas pelo jogo
        self.quarantine_strays(&j, &baseline, targets)?;

        // 2) implantar o que falta
        fs::create_dir_all(self.backups_dir()).at(self.backups_dir())?;
        for t in targets {
            if j.find(&t.name).is_some() {
                continue; // já está lá, idêntico
            }
            step += 1;
            progress(Progress {
                step,
                total,
                message: format!("Instalando {}", t.name),
            });
            let dest = self.game.gamedata.join(&t.name);
            let (kind, backup) = if dest.exists() {
                let sha = self.hashes.sha256(&dest)?;
                let in_baseline = baseline.files.get(&t.name.to_ascii_lowercase());
                if let Some(b) = in_baseline {
                    if b.sha256 != sha {
                        plan.warnings.push(format!(
                            "{} foi alterado fora do launcher desde a primeira varredura; a versão atual foi guardada no backup",
                            t.name
                        ));
                    }
                }
                let bpath = self.backups_dir().join(format!("{sha}.scd"));
                if !bpath.exists() {
                    let copied = copy_atomic(&dest, &bpath)?;
                    if copied != sha {
                        return Err(Error::Integrity(format!("backup de {} não confere", t.name)));
                    }
                }
                (DeployKind::Replaced, Some(sha))
            } else {
                (DeployKind::Added, None)
            };
            let entry = Deployed {
                name: t.name.clone(),
                sha256: t.sha256.clone(),
                mod_id: t.mod_id.clone(),
                mod_version: t.mod_version.clone(),
                kind,
                backup,
            };
            j.pending = Some(Pending::Add { entry: entry.clone() });
            self.save_journal(&j)?;
            // arquivo novo (nome que o jogo não tem): no mesmo disco vira um hard link, instantâneo
            // e sem ocupar espaço de novo. Arquivos que substituem os do jogo sempre são copiados,
            // para que um "verificar arquivos" da Steam nunca escreva dentro da biblioteca.
            let linked = entry.kind == DeployKind::Added && link_file(&t.source, &dest);
            let copied = if linked {
                self.hashes.sha256(&t.source)?
            } else {
                copy_atomic(&t.source, &dest)?
            };
            if copied != t.sha256 {
                // arquivo da biblioteca corrompido: desfaz este item
                if let (DeployKind::Replaced, Some(b)) = (entry.kind, &entry.backup) {
                    self.restore_backup(b, &dest)?;
                } else {
                    let _ = fs::remove_file(&dest);
                }
                j.pending = None;
                self.save_journal(&j)?;
                return Err(Error::Integrity(format!(
                    "{} na biblioteca está corrompido (hash diferente do manifesto) — reinstale o mod {}",
                    t.name, t.mod_id
                )));
            }
            self.hashes.remember(&dest, &copied);
            j.entries.push(entry);
            j.pending = None;
            self.save_journal(&j)?;
        }

        // 3) índice do jogo: aponta para os .scd do launcher os arquivos que eles substituem
        progress(Progress {
            step: total,
            total,
            message: "Atualizando o índice de arquivos do jogo".into(),
        });
        self.sync_toc(&j)?;

        j.profile = profile_id.map(str::to_owned);
        j.deployed_at = Some(chrono::Utc::now().to_rfc3339());
        self.save_journal(&j)?;
        self.hashes.save()?;
        progress(Progress {
            step: total,
            total,
            message: "Pronto".into(),
        });
        Ok(plan)
    }

    /// O SC2 procura cada arquivo no índice `toc.win.bdf` (veja [`crate::toc`]); sem atualizá-lo,
    /// um `.scd` de mod que traz arquivos com o mesmo nome dos originais é ignorado. Recalcula o
    /// índice a partir do original (guardado na primeira vez) com os `.scd` colocados pelo launcher;
    /// sem nenhum, devolve o original. Se o índice mudou por fora (atualização ou "verificar
    /// integridade" da Steam), o novo passa a ser o original.
    fn sync_toc(&mut self, j: &Journal) -> Result<usize> {
        let path = self.game.root.join("toc.win.bdf");
        if !path.is_file() {
            return Ok(0);
        }
        let dir = self.data_dir.join("deploy");
        let orig_path = dir.join("toc-original.bdf");
        let state_path = dir.join("toc.json");
        let current = fs::read(&path).at(&path)?;
        let cur_sha = sha256_bytes(&current);
        let mut st: TocState = read_json_or_default(&state_path)?;
        let ours = st.written.as_deref() == Some(cur_sha.as_str())
            // índice com .scd do launcher que não é o último gravado (ex.: interrompido no meio):
            // nunca vira o "original"
            || crate::toc::has_launcher_archives(&current);
        let original = if ours && orig_path.is_file() {
            fs::read(&orig_path).at(&orig_path)?
        } else {
            fs::create_dir_all(&dir).at(&dir)?;
            write_atomic(&orig_path, &current)?;
            st.original = Some(cur_sha.clone());
            current.clone()
        };
        let mut names: Vec<String> = j.entries.iter().map(|e| e.name.clone()).collect();
        crate::conflicts::mount_order(&mut names);
        let mut mods = Vec::new();
        for n in names {
            let p = self.game.gamedata.join(&n);
            let entries = crate::scd::entries_cached(&p)?
                .iter()
                .enumerate()
                .filter(|(_, e)| !e.is_dir)
                .map(|(i, e)| crate::toc::ModEntry {
                    name: e.name.clone(),
                    index: i as u32,
                    size: e.size.min(u32::MAX as u64) as u32,
                })
                .collect();
            mods.push((n, entries));
        }
        // um .scd novo no índice no máximo (veja crate::toc): o que mais substitui fica como .scd
        // (menos arquivos para copiar), os outros viram arquivos soltos na pasta do jogo — inclusive
        // os ".win" (texturas, cenas da interface), que o jogo também lê soltos
        let stats = crate::toc::override_stats(&original, &mods)?;
        let keep = stats
            .iter()
            .enumerate()
            .filter(|(_, (hits, _))| *hits > 0)
            .max_by_key(|(i, (hits, win))| (*hits, *win, std::cmp::Reverse(*i)))
            .map(|(i, _)| i);
        let plan: Vec<(String, Vec<crate::toc::ModEntry>, bool)> = mods
            .into_iter()
            .enumerate()
            .map(|(i, (n, e))| {
                let (hits, _) = stats[i];
                (n, e, hits > 0 && Some(i) != keep)
            })
            .collect();
        let (new, redirected, loose) = if plan.is_empty() {
            (original, 0, Vec::new())
        } else {
            crate::toc::apply_mixed(&original, &plan)?
        };
        self.sync_loose(&mut st, &plan, &loose)?;
        if new != current {
            write_atomic(&path, &new)?;
        }
        st.written = (redirected > 0).then(|| sha256_bytes(&new));
        st.redirected = redirected;
        write_json(&state_path, &st)?;
        Ok(redirected)
    }

    fn quarantine_strays(&mut self, j: &Journal, baseline: &Baseline, targets: &[Target]) -> Result<()> {
        let Ok(rd) = fs::read_dir(&self.game.gamedata) else { return Ok(()) };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().into_owned();
            let low = name.to_ascii_lowercase();
            if !(low.starts_with("zz_cp_") || low.starts_with("_cp_")) || !low.ends_with(".scd") {
                continue;
            }
            let known = j.find(&name).is_some()
                || baseline.files.contains_key(&low)
                || targets.iter().any(|t| t.name.eq_ignore_ascii_case(&name));
            if known || !e.path().is_file() {
                continue;
            }
            let q = self.quarantine_dir();
            fs::create_dir_all(&q).at(&q)?;
            let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
            let dest = q.join(format!("{stamp}-{name}"));
            let src = e.path();
            fs::rename(&src, &dest)
                .or_else(|_| fs::copy(&src, &dest).map(|_| ()).and_then(|_| fs::remove_file(&src)))
                .at(&src)?;
        }
        Ok(())
    }

    /// Deixa na pasta do jogo exatamente os arquivos soltos de `loose` (tira os da vez anterior).
    /// Um arquivo solto do próprio jogo no mesmo caminho é guardado e volta quando o mod sai.
    fn sync_loose(
        &mut self,
        st: &mut TocState,
        plan: &[(String, Vec<crate::toc::ModEntry>, bool)],
        loose: &[crate::toc::LooseFile],
    ) -> Result<()> {
        let root = self.game.root.clone();
        // arquivos soltos do próprio jogo que um mod substitui (ex.: o vídeo da tela inicial) ficam
        // guardados aqui e voltam quando o mod sai
        let originals = self.data_dir.join("deploy").join("loose-originals");
        let wanted: std::collections::HashSet<&str> = loose.iter().map(|l| l.path.as_str()).collect();
        for old in std::mem::take(&mut st.loose) {
            if wanted.contains(old.as_str()) {
                continue;
            }
            let p = root.join(&old);
            let saved = originals.join(&old);
            if saved.is_file() {
                if p.is_file() {
                    fs::remove_file(&p).at(&p)?;
                }
                move_file(&saved, &p)?;
                prune_empty_dirs(&originals, saved.parent());
                continue;
            }
            if p.is_file() {
                fs::remove_file(&p).at(&p)?;
            }
            prune_empty_dirs(&root, p.parent());
        }
        let mut by_mod: BTreeMap<usize, Vec<&crate::toc::LooseFile>> = BTreeMap::new();
        for l in loose {
            by_mod.entry(l.mod_index).or_default().push(l);
        }
        let q = self.quarantine_dir();
        for (mi, files) in by_mod {
            let src = self.game.gamedata.join(&plan[mi].0);
            let mut scd = crate::scd::Scd::open(&src)?;
            for l in files {
                if l.path.split('/').any(|c| c.is_empty() || c == "." || c == "..") {
                    return Err(Error::Format(format!("caminho inválido no mod: {}", l.path)));
                }
                let data = scd.read_at(l.entry as usize)?;
                let dest = root.join(&l.path);
                // arquivo que não é do launcher no caminho: o original vai para o lado (volta quando o
                // mod sai); se já há um guardado, este vai para a quarentena — nunca some em silêncio
                if dest.is_file() && !st.loose.contains(&l.path) && fs::read(&dest).ok().as_deref() != Some(&data[..]) {
                    let saved = originals.join(&l.path);
                    if !saved.exists() {
                        move_file(&dest, &saved)?;
                    } else {
                        fs::create_dir_all(&q).at(&q)?;
                        let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
                        let name = l.path.replace('/', "_");
                        fs::copy(&dest, q.join(format!("{stamp}-{name}"))).at(&dest)?;
                    }
                }
                if let Some(parent) = dest.parent() {
                    fs::create_dir_all(parent).at(parent)?;
                }
                if fs::read(&dest).ok().as_deref() != Some(&data[..]) {
                    write_atomic(&dest, &data)?;
                }
                st.loose.push(l.path.clone());
            }
        }
        Ok(())
    }

    /// Volta a pasta ao estado original (remove tudo que o launcher colocou).
    pub fn purge(&mut self, progress: &mut dyn FnMut(Progress)) -> Result<Plan> {
        self.apply(&[], None, progress)
    }

    fn remove_one(&mut self, entry: &Deployed) -> Result<()> {
        let path = self.game.gamedata.join(&entry.name);
        if path.exists() {
            let sha = self.hashes.sha256(&path)?;
            let is_backup = entry.backup.as_deref() == Some(sha.as_str());
            if is_backup {
                return Ok(()); // o original já voltou
            }
            if sha != entry.sha256 {
                // alterado por fora: guarda em quarentena em vez de apagar
                let q = self.quarantine_dir();
                fs::create_dir_all(&q).at(&q)?;
                let stamp = chrono::Utc::now().format("%Y%m%d-%H%M%S");
                let qp = q.join(format!("{stamp}-{}", entry.name));
                fs::rename(&path, &qp)
                    .or_else(|_| fs::copy(&path, &qp).map(|_| ()).and_then(|_| fs::remove_file(&path)))
                    .at(&path)?;
            } else {
                fs::remove_file(&path).at(&path)?;
            }
        }
        if let (DeployKind::Replaced, Some(b)) = (entry.kind, &entry.backup) {
            self.restore_backup(b, &path)?;
        }
        Ok(())
    }

    fn restore_backup(&mut self, sha: &str, dest: &Path) -> Result<()> {
        let bpath = self.backups_dir().join(format!("{sha}.scd"));
        if !bpath.exists() {
            return Err(Error::Integrity(format!(
                "backup de {} não encontrado — use \"Verificar arquivos\" na Steam para recuperar o original",
                dest.file_name().unwrap().to_string_lossy()
            )));
        }
        let copied = copy_atomic(&bpath, dest)?;
        if copied != sha {
            return Err(Error::Integrity("o backup está corrompido".into()));
        }
        self.hashes.remember(dest, &copied);
        Ok(())
    }

    /// Estado de cada arquivo da pasta (rápido: usa o cache de hash).
    pub fn status(&mut self) -> Result<Vec<FileStatus>> {
        let baseline = self.baseline()?.unwrap_or_default();
        let j = self.journal()?;
        let mut out = Vec::new();
        for path in self.game.archives()? {
            let name = path.file_name().unwrap().to_string_lossy().to_string();
            let size = path.metadata().map(|m| m.len()).unwrap_or(0);
            let sha = self.hashes.sha256(&path)?;
            if let Some(e) = j.entries.iter().find(|e| e.name.eq_ignore_ascii_case(&name)) {
                out.push(FileStatus {
                    name,
                    size,
                    origin: "managed".into(),
                    mod_id: Some(e.mod_id.clone()),
                    state: if sha == e.sha256 { "ok" } else { "modified" }.into(),
                });
            } else if let Some(b) = baseline.files.get(&name.to_ascii_lowercase()) {
                out.push(FileStatus {
                    name,
                    size,
                    origin: match b.kind {
                        BaselineKind::Stock => "stock",
                        BaselineKind::Unmanaged => "unmanaged",
                    }
                    .into(),
                    mod_id: None,
                    state: if sha == b.sha256 { "ok" } else { "modified" }.into(),
                });
            } else {
                out.push(FileStatus {
                    name,
                    size,
                    origin: "new".into(),
                    mod_id: None,
                    state: "ok".into(),
                });
            }
        }
        for e in &j.entries {
            if !self.game.gamedata.join(&e.name).exists() {
                out.push(FileStatus {
                    name: e.name.clone(),
                    size: 0,
                    origin: "managed".into(),
                    mod_id: Some(e.mod_id.clone()),
                    state: "missing".into(),
                });
            }
        }
        for b in baseline.files.values() {
            if !self.game.gamedata.join(&b.name).exists() && j.find(&b.name).is_none() {
                out.push(FileStatus {
                    name: b.name.clone(),
                    size: b.size,
                    origin: match b.kind {
                        BaselineKind::Stock => "stock",
                        BaselineKind::Unmanaged => "unmanaged",
                    }
                    .into(),
                    mod_id: None,
                    state: "missing".into(),
                });
            }
        }
        self.hashes.save()?;
        Ok(out)
    }
}

/// Cria `dst` como hard link de `src` (troca atômica). `false` se o sistema não deixar
/// (discos diferentes, FAT32, permissão) — aí quem chamou copia.
/// Remove pastas vazias de `dir` para cima, sem passar da raiz do jogo.
/// Move um arquivo (cria a pasta; entre discos, copia e apaga).
fn move_file(from: &Path, to: &Path) -> Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent).at(parent)?;
    }
    fs::rename(from, to).or_else(|_| fs::copy(from, to).map(|_| ()).and_then(|_| fs::remove_file(from))).at(from)
}

fn prune_empty_dirs(root: &Path, mut dir: Option<&Path>) {
    while let Some(d) = dir {
        if d == root || !d.starts_with(root) || fs::remove_dir(d).is_err() {
            break;
        }
        dir = d.parent();
    }
}

fn link_file(src: &Path, dst: &Path) -> bool {
    let tmp = crate::fsutil::tmp_sibling(dst);
    let _ = fs::remove_file(&tmp);
    if fs::hard_link(src, &tmp).is_err() {
        return false;
    }
    if fs::rename(&tmp, dst).is_err() {
        let _ = fs::remove_file(&tmp);
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game::Store;
    use crate::library::{tests::make_scd, ImportOptions};
    use crate::profile::{Profile, ProfileMod};

    struct Env {
        _t: tempfile::TempDir,
        game: GameInstall,
        data: PathBuf,
        lib: Library,
        cache: HashCache,
    }

    fn env() -> Env {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("Supreme Commander 2");
        fs::create_dir_all(root.join("gamedata")).unwrap();
        make_scd(&root.join("gamedata/lua.scd"), &[("lua/sim/unit.lua", b"-- original")]);
        make_scd(&root.join("gamedata/maps.scd"), &[("maps/a/a.lua", b"a")]);
        make_scd(&root.join("gamedata/_manual_map.scd"), &[("maps/b/b.lua", b"b")]);
        let game = GameInstall::from_dir(&root, Store::Manual).unwrap();
        let data = t.path().join("data");
        let lib = Library::open(&data.join("library")).unwrap();
        let cache = HashCache::load(&data.join("hashcache.json"));
        Env {
            _t: t,
            game,
            data,
            lib,
            cache,
        }
    }

    fn profile(ids: &[&str]) -> Profile {
        Profile {
            id: "p".into(),
            name: "P".into(),
            mods: ids
                .iter()
                .map(|i| ProfileMod {
                    id: i.to_string(),
                    enabled: true,
                })
                .collect(),
            notes: String::new(),
        }
    }

    fn snapshot(dir: &Path) -> BTreeMap<String, String> {
        fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|e| {
                (
                    e.file_name().to_string_lossy().to_string(),
                    crate::fsutil::sha256_file(&e.path()).unwrap(),
                )
            })
            .collect()
    }

    #[test]
    fn keeps_game_index_in_sync() {
        let mut e = env();
        // índice do jogo com "textures/ui/bg.dds" vindo de textures.scd (como no SC2)
        let toc_path = e.game.root.join("toc.win.bdf");
        let original = crate::toc::tests::sample();
        fs::write(&toc_path, &original).unwrap();
        let src = e.data.join("in");
        fs::create_dir_all(&src).unwrap();
        make_scd(
            &src.join("zz_hd.scd"),
            &[
                ("textures/ui/novo.dds", b"x"),
                ("textures\\ui\\BG.win.dds", b"textura maior"),
            ],
        );
        let m = e.lib.import(&src.join("zz_hd.scd"), &ImportOptions::default()).unwrap();
        let mut w = vec![];
        let mut d = Deployer {
            game: &e.game,
            data_dir: &e.data,
            hashes: &mut e.cache,
        };
        let targets = d.targets(&e.lib, &profile(&[m.id.as_str()]), &mut w).unwrap();
        assert_eq!(targets.len(), 1, "{w:?}");
        d.apply(&targets, Some("p"), &mut |_| {}).unwrap();

        let toc = crate::toc::Toc::parse(&fs::read(&toc_path).unwrap()).unwrap();
        let archives = toc.archives().unwrap();
        let bg = toc
            .files()
            .unwrap()
            .into_iter()
            .find(|f| f.key == "textures/ui/bg.dds")
            .unwrap();
        assert_eq!(archives[bg.archive.unwrap() as usize], "gamedata\\zz_hd.scd");
        assert_eq!(
            (bg.entry, bg.size, bg.win),
            (1, 13, true),
            "entrada 1 do zip, tamanho novo"
        );

        // reaplicar sem mudanças mantém o índice
        let patched = fs::read(&toc_path).unwrap();
        d.apply(&targets, Some("p"), &mut |_| {}).unwrap();
        assert_eq!(fs::read(&toc_path).unwrap(), patched);

        // "verificar integridade" da Steam devolve o original: o launcher percebe e refaz
        fs::write(&toc_path, &original).unwrap();
        d.apply(&targets, Some("p"), &mut |_| {}).unwrap();
        assert_eq!(fs::read(&toc_path).unwrap(), patched);

        // voltar ao original restaura o índice byte a byte
        d.purge(&mut |_| {}).unwrap();
        assert_eq!(fs::read(&toc_path).unwrap(), original);
    }

    #[test]
    fn second_override_mod_is_served_loose() {
        let mut e = env();
        let toc_path = e.game.root.join("toc.win.bdf");
        let original = crate::toc::tests::sample();
        fs::write(&toc_path, &original).unwrap();
        let src = e.data.join("in");
        fs::create_dir_all(&src).unwrap();
        make_scd(&src.join("zz_cp_hd.scd"), &[("textures\\ui\\BG.win.dds", b"hd")]);
        make_scd(&src.join("zz_cp_zz_menu.scd"), &[("textures/ui/logo.dds", b"logo novo")]);
        // um terceiro com ".win" (como a cena da tela inicial da Forja): solto também, sem .scd novo
        make_scd(&src.join("zz_cp_zzz_cena.scd"), &[("textures/ui/bg.win.dds", b"cena")]);
        let a = e.lib.import(&src.join("zz_cp_hd.scd"), &ImportOptions::default()).unwrap();
        let b = e.lib.import(&src.join("zz_cp_zz_menu.scd"), &ImportOptions::default()).unwrap();
        let c = e.lib.import(&src.join("zz_cp_zzz_cena.scd"), &ImportOptions::default()).unwrap();
        let mut w = vec![];
        let mut d = Deployer { game: &e.game, data_dir: &e.data, hashes: &mut e.cache };
        d.apply(&[], None, &mut |_| {}).unwrap(); // primeira varredura
        // sobra de teste com nome do launcher, depois da varredura: vai para a quarentena
        fs::write(e.game.gamedata.join("zz_cp_sobra.scd"), b"x").unwrap();
        let targets = d.targets(&e.lib, &profile(&[a.id.as_str(), b.id.as_str(), c.id.as_str()]), &mut w).unwrap();
        d.apply(&targets, Some("p"), &mut |_| {}).unwrap();
        assert!(!e.game.gamedata.join("zz_cp_sobra.scd").exists());

        let toc = crate::toc::Toc::parse(&fs::read(&toc_path).unwrap()).unwrap();
        assert_eq!(toc.archives().unwrap().len(), 3, "um .scd novo só");
        let logo = toc.files().unwrap().into_iter().find(|f| f.key == "textures/ui/logo.dds").unwrap();
        assert_eq!((logo.archive, logo.size), (None, 9));
        let loose = e.game.root.join("textures/ui/logo.dds");
        assert_eq!(fs::read(&loose).unwrap(), b"logo novo");
        let bg = toc.files().unwrap().into_iter().find(|f| f.key == "textures/ui/bg.dds").unwrap();
        assert_eq!((bg.archive, bg.size, bg.win), (None, 4, true), "o último mod vence, solto e com .win");
        assert_eq!(fs::read(e.game.root.join("textures/ui/bg.win.dds")).unwrap(), b"cena");

        // índice deixado com .scd do launcher (ex.: teste manual) não vira o "original"
        let patched = fs::read(&toc_path).unwrap();
        let mut odd = crate::toc::Toc::parse(&patched).unwrap();
        odd.add_archive("gamedata\\zz_cp_outro.scd").unwrap();
        fs::write(&toc_path, odd.to_bytes().unwrap()).unwrap();
        d.apply(&targets, Some("p"), &mut |_| {}).unwrap();
        assert_eq!(fs::read(&toc_path).unwrap(), patched);

        d.purge(&mut |_| {}).unwrap();
        assert_eq!(fs::read(&toc_path).unwrap(), original);
        assert!(!loose.exists());
        assert!(!e.game.root.join("textures").exists(), "pastas vazias saem");
    }

    #[test]
    fn game_loose_file_comes_back() {
        // um arquivo solto do próprio jogo (como o vídeo da tela inicial) trocado por um mod volta
        // igual quando o mod sai
        let mut e = env();
        let toc_path = e.game.root.join("toc.win.bdf");
        let original = crate::toc::tests::sample();
        fs::write(&toc_path, &original).unwrap();
        fs::write(e.game.root.join("readme.txt"), b"original do jogo").unwrap();
        let src = e.data.join("in");
        fs::create_dir_all(&src).unwrap();
        make_scd(&src.join("zz_cp_a.scd"), &[("textures/ui/bg.win.dds", b"hd")]);
        make_scd(&src.join("zz_cp_b.scd"), &[("readme.txt", b"do mod")]);
        let a = e.lib.import(&src.join("zz_cp_a.scd"), &ImportOptions::default()).unwrap();
        let b = e.lib.import(&src.join("zz_cp_b.scd"), &ImportOptions::default()).unwrap();
        let mut w = vec![];
        let mut d = Deployer { game: &e.game, data_dir: &e.data, hashes: &mut e.cache };
        d.apply(&[], None, &mut |_| {}).unwrap();
        let targets = d.targets(&e.lib, &profile(&[a.id.as_str(), b.id.as_str()]), &mut w).unwrap();
        d.apply(&targets, Some("p"), &mut |_| {}).unwrap();
        assert_eq!(fs::read(e.game.root.join("readme.txt")).unwrap(), b"do mod");
        // reaplicar não guarda o do mod como se fosse o original
        d.apply(&targets, Some("p"), &mut |_| {}).unwrap();
        d.purge(&mut |_| {}).unwrap();
        assert_eq!(fs::read(e.game.root.join("readme.txt")).unwrap(), b"original do jogo");
        assert_eq!(fs::read(&toc_path).unwrap(), original);
    }

    #[test]
    fn deploy_replace_and_purge_restores_bytes() {
        let mut e = env();
        let before = snapshot(&e.game.gamedata);
        let src = e.data.join("in");
        fs::create_dir_all(&src).unwrap();
        // mod que adiciona um arquivo
        make_scd(&src.join("zz_STORM.scd"), &[("lua/sim/unit.lua", b"-- storm")]);
        e.lib
            .import(&src.join("zz_STORM.scd"), &ImportOptions::default())
            .unwrap();
        // mod que SUBSTITUI lua.scd
        let pkg = src.join("pack");
        fs::create_dir_all(&pkg).unwrap();
        make_scd(&pkg.join("lua.scd"), &[("lua/sim/unit.lua", b"-- 2013")]);
        e.lib
            .import(
                &pkg,
                &ImportOptions {
                    name: Some("SupCom 2013".into()),
                    ..Default::default()
                },
            )
            .unwrap();

        let mut d = Deployer {
            game: &e.game,
            data_dir: &e.data,
            hashes: &mut e.cache,
        };
        let mut w = vec![];
        let targets = d.targets(&e.lib, &profile(&["storm", "supcom-2013"]), &mut w).unwrap();
        assert!(w.is_empty(), "{w:?}");
        let plan = d.plan(&targets).unwrap();
        assert_eq!(plan.add, ["zz_STORM.scd"]);
        assert_eq!(plan.replace, ["lua.scd"]);
        d.apply(&targets, Some("p"), &mut |_| {}).unwrap();

        let now = snapshot(&e.game.gamedata);
        assert!(now.contains_key("zz_STORM.scd"));
        assert_ne!(now["lua.scd"], before["lua.scd"], "lua.scd foi substituído");
        let st = d.status().unwrap();
        let lua = st.iter().find(|s| s.name == "lua.scd").unwrap();
        assert_eq!((lua.origin.as_str(), lua.state.as_str()), ("managed", "ok"));
        let manual = st.iter().find(|s| s.name == "_manual_map.scd").unwrap();
        assert_eq!(manual.origin, "unmanaged");

        // reaplicar é idempotente
        assert!(d.plan(&targets).unwrap().is_noop());

        // purge: volta byte a byte ao original
        d.purge(&mut |_| {}).unwrap();
        assert_eq!(snapshot(&e.game.gamedata), before);
        assert!(d.journal().unwrap().entries.is_empty());
    }

    #[test]
    fn recovers_from_interrupted_add() {
        let mut e = env();
        let before = snapshot(&e.game.gamedata);
        let src = e.data.join("in");
        fs::create_dir_all(&src).unwrap();
        make_scd(&src.join("lua.scd"), &[("x", b"novo")]);
        e.lib
            .import(
                &src.join("lua.scd"),
                &ImportOptions {
                    id: Some("novo-lua".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let mut d = Deployer {
            game: &e.game,
            data_dir: &e.data,
            hashes: &mut e.cache,
        };
        d.ensure_baseline(&mut |_| {}).unwrap();
        let mut w = vec![];
        let targets = d.targets(&e.lib, &profile(&["novo-lua"]), &mut w).unwrap();

        // simula: intenção gravada + backup feito + arquivo copiado, mas o journal não foi atualizado
        let dest = e.game.gamedata.join("lua.scd");
        let orig_sha = crate::fsutil::sha256_file(&dest).unwrap();
        fs::create_dir_all(e.data.join("backups")).unwrap();
        fs::copy(&dest, e.data.join(format!("backups/{orig_sha}.scd"))).unwrap();
        let entry = Deployed {
            name: "lua.scd".into(),
            sha256: targets[0].sha256.clone(),
            mod_id: "novo-lua".into(),
            mod_version: "1.0.0".into(),
            kind: DeployKind::Replaced,
            backup: Some(orig_sha.clone()),
        };
        let j = Journal {
            pending: Some(Pending::Add { entry }),
            ..Default::default()
        };
        write_json(&e.data.join("deploy/journal.json"), &j).unwrap();
        fs::copy(&targets[0].source, &dest).unwrap();

        let msg = d.recover().unwrap().unwrap();
        assert!(msg.contains("concluída"), "{msg}");
        assert_eq!(d.journal().unwrap().entries.len(), 1);
        d.purge(&mut |_| {}).unwrap();
        assert_eq!(snapshot(&e.game.gamedata), before);
    }

    #[test]
    fn modified_deployed_file_goes_to_quarantine() {
        let mut e = env();
        let src = e.data.join("in");
        fs::create_dir_all(&src).unwrap();
        make_scd(&src.join("zz_x.scd"), &[("a", b"a")]);
        e.lib.import(&src.join("zz_x.scd"), &ImportOptions::default()).unwrap();
        let mut d = Deployer {
            game: &e.game,
            data_dir: &e.data,
            hashes: &mut e.cache,
        };
        let mut w = vec![];
        let t = d.targets(&e.lib, &profile(&["x"]), &mut w).unwrap();
        d.apply(&t, None, &mut |_| {}).unwrap();
        // usuário edita o arquivo implantado à mão
        std::thread::sleep(std::time::Duration::from_millis(20));
        fs::write(e.game.gamedata.join("zz_x.scd"), b"editado a mao").unwrap();
        d.purge(&mut |_| {}).unwrap();
        assert!(!e.game.gamedata.join("zz_x.scd").exists());
        let q: Vec<_> = fs::read_dir(e.data.join("quarantine")).unwrap().flatten().collect();
        assert_eq!(q.len(), 1);
    }

    #[test]
    fn duplicate_file_warns_and_last_wins() {
        let mut e = env();
        let src = e.data.join("in");
        for (dir, body) in [("a", b"A" as &[u8]), ("b", b"B")] {
            fs::create_dir_all(src.join(dir)).unwrap();
            make_scd(&src.join(dir).join("zz_same.scd"), &[("f", body)]);
            e.lib
                .import(
                    &src.join(dir),
                    &ImportOptions {
                        id: Some(format!("mod-{dir}")),
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        let d = Deployer {
            game: &e.game,
            data_dir: &e.data,
            hashes: &mut e.cache,
        };
        let mut w = vec![];
        let t = d.targets(&e.lib, &profile(&["mod-a", "mod-b"]), &mut w).unwrap();
        assert_eq!(t.len(), 1);
        assert_eq!(t[0].mod_id, "mod-b");
        assert_eq!(w.len(), 1);
    }

    #[test]
    fn adopt_unmanaged_file() {
        let mut e = env();
        let manual = e.game.gamedata.join("_manual_map.scd");
        let mut d = Deployer {
            game: &e.game,
            data_dir: &e.data,
            hashes: &mut e.cache,
        };
        d.ensure_baseline(&mut |_| {}).unwrap();
        let m = e.lib.import(&manual, &ImportOptions::default()).unwrap();
        d.adopt("_manual_map.scd", &m.id, &m.version).unwrap();
        // um perfil sem o mod remove o arquivo da pasta (agora gerenciado)
        d.purge(&mut |_| {}).unwrap();
        assert!(!manual.exists());
        let mut w = vec![];
        let t = d.targets(&e.lib, &profile(&[&m.id]), &mut w).unwrap();
        d.apply(&t, None, &mut |_| {}).unwrap();
        assert!(manual.exists());
    }

    #[test]
    fn links_new_files_instead_of_copying() {
        let t = tempfile::tempdir().unwrap();
        let src = t.path().join("lib.scd");
        let dst = t.path().join("game").join("zz_mod.scd");
        fs::create_dir_all(dst.parent().unwrap()).unwrap();
        fs::write(&src, b"PK conteudo").unwrap();
        fs::write(&dst, b"antigo").unwrap();
        assert!(link_file(&src, &dst));
        assert_eq!(fs::read(&dst).unwrap(), b"PK conteudo");
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            assert_eq!(fs::metadata(&src).unwrap().nlink(), 2);
        }
        // apagar o instalado não mexe na biblioteca
        fs::remove_file(&dst).unwrap();
        assert!(src.is_file());
        assert!(!link_file(&t.path().join("nao-existe"), &dst));
    }
}
