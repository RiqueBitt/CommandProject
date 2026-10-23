//! Análise de conflitos: quais caminhos internos (`/lua/...`, `/textures/...`) são
//! fornecidos por mais de um arquivo `.scd` e qual deles vence.
//!
//! Ordem de montagem assumida: os `.scd` da pasta `gamedata` são montados em ordem
//! alfabética e o último sobrescreve os anteriores — é por isso que mods usam prefixos
//! como `zz_` (carregar por último) e `_` (carregar primeiro). Trate o "vencedor" como
//! a previsão do launcher; o teste definitivo é sempre dentro do jogo.

use crate::error::Result;
use crate::scd::Scd;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Provider {
    /// Nome do arquivo na pasta gamedata (define a ordem de montagem).
    pub archive: String,
    pub path: PathBuf,
    /// `None` = arquivo original/não gerenciado.
    pub mod_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairConflict {
    /// Arquivo que perde (montado antes).
    pub loser: String,
    pub loser_mod: Option<String>,
    /// Arquivo que vence (montado depois).
    pub winner: String,
    pub winner_mod: Option<String>,
    pub count: usize,
    /// Até 25 caminhos de exemplo.
    pub samples: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConflictReport {
    /// Conflitos entre dois mods (os mais importantes de revisar).
    pub between_mods: Vec<PairConflict>,
    /// Mods sobrescrevendo arquivos do jogo (normal para mods de jogabilidade).
    pub overrides_stock: Vec<PairConflict>,
    /// Ordem de montagem considerada.
    pub mount_order: Vec<String>,
}

/// Ordem de montagem: alfabética sem diferenciar maiúsculas.
pub fn mount_order(names: &mut [String]) {
    names.sort_by_key(|n| n.to_ascii_lowercase());
}

/// Lista de entradas (só arquivos) por arquivo .scd, com cache por caminho.
pub fn analyze(providers: &[Provider], cache: &mut HashMap<PathBuf, Vec<String>>) -> Result<ConflictReport> {
    let mut sorted: Vec<&Provider> = providers.iter().collect();
    sorted.sort_by_key(|p| p.archive.to_ascii_lowercase());

    // chave interna -> lista de índices de provedores, em ordem de montagem
    let mut index: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, p) in sorted.iter().enumerate() {
        let keys = match cache.get(&p.path) {
            Some(k) => k.clone(),
            None => {
                let k: Vec<String> = Scd::open(&p.path)?
                    .entries()?
                    .into_iter()
                    .filter(|e| !e.is_dir)
                    .map(|e| e.key)
                    .collect();
                cache.insert(p.path.clone(), k.clone());
                k
            }
        };
        for k in keys {
            index.entry(k).or_default().push(i);
        }
    }

    // agrega por par (perdedor, vencedor)
    let mut pairs: BTreeMap<(usize, usize), (usize, Vec<String>)> = BTreeMap::new();
    for (key, provs) in &index {
        if provs.len() < 2 {
            continue;
        }
        let winner = *provs.last().unwrap();
        for &loser in &provs[..provs.len() - 1] {
            if sorted[loser].mod_id.is_none() && sorted[winner].mod_id.is_none() {
                continue; // original x original: não interessa
            }
            let e = pairs.entry((loser, winner)).or_default();
            e.0 += 1;
            if e.1.len() < 25 {
                e.1.push(key.clone());
            }
        }
    }
    let mut report = ConflictReport {
        mount_order: sorted.iter().map(|p| p.archive.clone()).collect(),
        ..Default::default()
    };
    for ((l, w), (count, mut samples)) in pairs {
        samples.sort();
        let pc = PairConflict {
            loser: sorted[l].archive.clone(),
            loser_mod: sorted[l].mod_id.clone(),
            winner: sorted[w].archive.clone(),
            winner_mod: sorted[w].mod_id.clone(),
            count,
            samples,
        };
        if pc.loser_mod.is_some() && pc.winner_mod.is_some() {
            report.between_mods.push(pc);
        } else {
            report.overrides_stock.push(pc);
        }
    }
    report.between_mods.sort_by_key(|c| std::cmp::Reverse(c.count));
    report.overrides_stock.sort_by_key(|c| std::cmp::Reverse(c.count));
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::library::tests::make_scd;

    #[test]
    fn detects_pairs_and_winner() {
        let t = tempfile::tempdir().unwrap();
        let p = |n: &str| t.path().join(n);
        make_scd(&p("lua.scd"), &[("lua/a.lua", b"1"), ("lua/b.lua", b"1")]);
        make_scd(&p("zz_storm.scd"), &[("lua/a.lua", b"2"), ("lua/c.lua", b"2")]);
        make_scd(&p("_balance.scd"), &[("LUA\\C.lua", b"3")]);
        let providers = vec![
            Provider {
                archive: "zz_storm.scd".into(),
                path: p("zz_storm.scd"),
                mod_id: Some("storm".into()),
            },
            Provider {
                archive: "lua.scd".into(),
                path: p("lua.scd"),
                mod_id: None,
            },
            Provider {
                archive: "_balance.scd".into(),
                path: p("_balance.scd"),
                mod_id: Some("bal".into()),
            },
        ];
        let r = analyze(&providers, &mut HashMap::new()).unwrap();
        assert_eq!(r.mount_order, ["_balance.scd", "lua.scd", "zz_storm.scd"]);
        assert_eq!(r.between_mods.len(), 1);
        let m = &r.between_mods[0];
        assert_eq!(
            (m.loser.as_str(), m.winner.as_str(), m.count),
            ("_balance.scd", "zz_storm.scd", 1)
        );
        assert_eq!(m.samples, ["/lua/c.lua"]);
        assert_eq!(r.overrides_stock.len(), 1);
        assert_eq!(r.overrides_stock[0].samples, ["/lua/a.lua"]);
    }
}
