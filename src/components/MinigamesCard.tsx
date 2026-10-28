// Início: os minigames da Partida grande — modos com recordes, desafio da semana, conquistas,
// histórico de partidas (o jogo grava no perfil dele) e uma chave de torneio entre amigos.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "./ui";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";
import {
  MINIGAMES, MUTATORS, achievements, currentWeek, fmtTime, minigame, weeklyChallenge,
  type MinigameMatch, type MinigameMode, type MinigameRecord,
} from "../lib/minigames";

type Tab = "modes" | "challenge" | "achievements" | "history" | "tournament";

/** Abre a Partida grande com o minigame já escolhido. */
function openWith(mode: MinigameMode, go: (p: "bigmatch") => void, extra?: Record<string, unknown>) {
  try {
    const raw = localStorage.getItem("cp-bigmatch-options");
    const o = raw ? JSON.parse(raw) : {};
    localStorage.setItem("cp-bigmatch-options", JSON.stringify({ ...o, mode, modeScore: 0, week: 0, ...extra }));
  } catch { /* ok */ }
  go("bigmatch");
}

function resultText(m: { mode: string; waves: number; score: number }): string {
  if (m.mode === "defense" || m.mode === "survival") return t("{n} ondas", { n: m.waves });
  if (m.score > 0) return t("{n} pontos", { n: m.score });
  return "";
}

export default function MinigamesCard() {
  const { go } = useStore.getState();
  const running = useStore((s) => s.dashboard?.gameRunning);
  const [records, setRecords] = useState<MinigameRecord[]>([]);
  const [history, setHistory] = useState<MinigameMatch[]>([]);
  const [tab, setTab] = useState<Tab>(() => { try { return (localStorage.getItem("cp.mgTab") as Tab) || "modes"; } catch { return "modes"; } });
  useEffect(() => { try { localStorage.setItem("cp.mgTab", tab); } catch { /* ok */ } }, [tab]);
  // relido quando o jogo fecha (o resultado acabou de ser gravado)
  useEffect(() => {
    if (running) return;
    api.minigameRecords().then(setRecords).catch(() => setRecords([]));
    api.minigameHistory().then(setHistory).catch(() => setHistory([]));
  }, [running]);
  const ach = useMemo(() => achievements(records, history), [records, history]);
  const tabs: [Tab, string, string][] = [
    ["modes", "Modos", "sports_esports"],
    ["challenge", "Desafio", "event_available"],
    ["achievements", "Conquistas", "workspace_premium"],
    ["history", "Histórico", "history"],
    ["tournament", "Torneio", "account_tree"],
  ];
  return (
    <section className="card pad" style={{ gridColumn: "1 / -1" }}>
      <div className="card-title">
        <Icon name="emoji_events" style={{ color: "var(--primary)" }} /><h3>{t("Minigames")}</h3>
        <span className="chip">{t("{n} de {total} conquistas", { n: ach.filter((a) => a.done).length, total: ach.length })}</span>
        <button className="btn sm text" onClick={() => go("bigmatch")}>{t("Partida grande")}</button>
      </div>
      <div className="seg wrap mg-tabs" role="tablist" aria-label={t("Minigames")}>
        {tabs.map(([k, label, icon]) => (
          <button key={k} className="btn" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}><Icon name={icon} size={16} /> {t(label)}</button>
        ))}
      </div>
      {tab === "modes" && <Modes records={records} go={go} />}
      {tab === "challenge" && <Challenge history={history} go={go} />}
      {tab === "achievements" && (
        <div className="mg-ach">
          {ach.map((a) => (
            <div key={a.id} className={`mg-ach-item ${a.done ? "done" : ""}`} title={t(a.hint)}>
              <Icon name={a.done ? a.icon : "lock"} size={22} />
              <span className="grow" style={{ minWidth: 0 }}>
                <b className="small">{t(a.name)}</b>
                <span className="muted small" style={{ display: "block" }}>{t(a.hint)}</span>
                {a.progress && !a.done && <div className="bar"><i style={{ width: `${(100 * a.progress[0]) / a.progress[1]}%` }} /></div>}
              </span>
            </div>
          ))}
        </div>
      )}
      {tab === "history" && <History history={history} />}
      {tab === "tournament" && <Tournament go={go} />}
    </section>
  );
}

function Modes({ records, go }: { records: MinigameRecord[]; go: (p: "bigmatch") => void }) {
  return (
    <>
      <p className="muted small" style={{ marginBottom: 10 }}>{t("Modos com objetivos diferentes, contra a IA ou com amigos. No jogo, escolha em Batalha → Criar jogo → MODO.")}</p>
      <div className="col" style={{ gap: 6 }}>
        {MINIGAMES.filter((g) => g.key).map((g) => {
          const r = records.find((x) => x.mode === g.key);
          return (
            <div key={g.key} className="row" style={{ gap: 10 }}>
              <Icon name={g.icon} size={20} style={{ color: "var(--muted)" }} />
              <span className="grow" style={{ minWidth: 0 }}>
                <b>{t(g.name)}</b>
                <span className="muted small" style={{ display: "block" }}>
                  {!r ? t("Ainda não jogado") : [
                    t("{w} de {p} vencidas", { w: r.wins, p: r.played }),
                    (g.key === "defense" || g.key === "survival") && r.best > 0 ? t("recorde: {n} ondas", { n: r.best }) : null,
                    g.key !== "defense" && g.key !== "survival" && r.best > 0 ? t("melhor pontuação: {n}", { n: r.best }) : null,
                    r.fastest ? t("vitória mais rápida: {time}", { time: fmtTime(r.fastest) }) : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button className="btn sm tonal" title={t(g.hint)} onClick={() => openWith(g.key, go)}>{t("Montar")}</button>
            </div>
          );
        })}
      </div>
    </>
  );
}

function Challenge({ history, go }: { history: MinigameMatch[]; go: (p: "bigmatch") => void }) {
  const week = currentWeek();
  const c = weeklyChallenge(week);
  const g = minigame(c.mode);
  const mine = history.filter((m) => m.week === week);
  const best = mine.reduce<MinigameMatch | null>((b, m) => {
    if (!b) return m;
    if (m.won !== b.won) return m.won ? m : b;
    const v = (x: MinigameMatch) => (x.mode === "defense" || x.mode === "survival" ? x.waves : x.score);
    if (v(m) !== v(b)) return v(m) > v(b) ? m : b;
    return m.seconds < b.seconds ? m : b;
  }, null);
  const days = Math.max(0, Math.ceil((c.ends.getTime() - Date.now()) / 86400000));
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="mg-challenge">
        <Icon name={g.icon} size={36} />
        <span className="grow">
          <span className="overline">{t("Desafio da semana {n} · termina em {d} dias", { n: week, d: days })}</span>
          <h3 style={{ margin: "2px 0" }}>{t(g.name)}</h3>
          <span className="muted small">
            {[
              ...c.mutators.map((m) => t(MUTATORS.find((x) => x.key === m)!.name)),
              c.events ? t("Eventos aleatórios") : null,
            ].filter(Boolean).join(" · ") || t("Sem mutadores")}
          </span>
        </span>
        <button className="btn primary" onClick={() => {
          try { localStorage.setItem("cp-challenge", JSON.stringify({ week })); } catch { /* ok */ }
          go("bigmatch");
        }}><Icon name="play_arrow" /> {t("Jogar desafio")}</button>
      </div>
      <p className="muted small">{t("Todo mundo recebe o mesmo modo, mutadores e mapa nesta semana. Jogue quantas vezes quiser: fica valendo o seu melhor resultado.")}</p>
      {best ? (
        <p className="small"><b>{t("Seu melhor:")}</b> {best.won ? t("vitória") : t("derrota")}{resultText(best) ? " · " + resultText(best) : ""} · {fmtTime(best.seconds)} · {t("{n} tentativas", { n: mine.length })}</p>
      ) : <p className="faint small">{t("Você ainda não jogou o desafio desta semana.")}</p>}
    </div>
  );
}

function History({ history }: { history: MinigameMatch[] }) {
  if (!history.length) return <p className="faint small">{t("As partidas de minigame aparecem aqui depois que você jogar (o jogo guarda as últimas 40).")}</p>;
  const last = history.slice(0, 20).reverse();
  const max = Math.max(1, ...last.map((m) => m.seconds));
  const wins = history.filter((m) => m.won).length;
  return (
    <>
      <p className="small">{t("{w} vitórias em {n} partidas ({p}%)", { w: wins, n: history.length, p: Math.round((100 * wins) / history.length) })}</p>
      <div className="mg-spark" aria-label={t("Duração das últimas partidas")}>
        {last.map((m) => <i key={m.seq} className={m.won ? "won" : ""} style={{ height: `${Math.max(8, (100 * m.seconds) / max)}%` }} title={`${t(minigame(m.mode).name)} · ${m.won ? t("vitória") : t("derrota")} · ${fmtTime(m.seconds)}`} />)}
      </div>
      <table className="mg-hist">
        <thead><tr><th>{t("Quando")}</th><th>{t("Modo")}</th><th>{t("Mapa")}</th><th>{t("Resultado")}</th><th>{t("Tempo")}</th></tr></thead>
        <tbody>
          {history.slice(0, 15).map((m) => (
            <tr key={m.seq}>
              <td className="muted">{m.date ? new Date(m.date * 1000).toLocaleDateString() : "—"}</td>
              <td>{t(minigame(m.mode).name)}{m.week ? " ★" : ""}{m.mutators ? <span className="faint"> · {m.mutators.split(",").map((k) => t(MUTATORS.find((x) => x.key === k)?.name ?? k)).join(", ")}</span> : null}</td>
              <td className="muted">{m.map || "—"}</td>
              <td className={m.won ? "won" : "lost"}>{m.won ? t("vitória") : t("derrota")}{resultText(m) ? " · " + resultText(m) : ""}</td>
              <td>{fmtTime(m.seconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------- torneio

interface Bracket { names: string[]; mode: MinigameMode; rounds: (string | null)[][]; winners: (string | null)[][] }

function newBracket(names: string[], mode: MinigameMode): Bracket {
  const list = names.map((n) => n.trim()).filter(Boolean);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  let size = 2;
  while (size < list.length) size *= 2;
  const first: (string | null)[] = [];
  for (let i = 0; i < size; i++) first.push(list[i] ?? null);
  const rounds: (string | null)[][] = [first];
  for (let s = size / 2; s >= 1; s /= 2) rounds.push(new Array(s).fill(null));
  const b: Bracket = { names: list, mode, rounds, winners: rounds.slice(0, -1).map((r) => new Array(r.length / 2).fill(null)) };
  return advanceByes(b);
}

/** Quem não tem adversário passa direto. */
function advanceByes(b: Bracket): Bracket {
  b.rounds[0].forEach((_, i) => {
    if (i % 2) return;
    const [x, y] = [b.rounds[0][i], b.rounds[0][i + 1]];
    if (x && !y) setWinner(b, 0, i / 2, x);
    if (y && !x) setWinner(b, 0, i / 2, y);
  });
  return b;
}

function setWinner(b: Bracket, round: number, match: number, name: string) {
  const prev = b.winners[round][match];
  b.winners[round][match] = name;
  b.rounds[round + 1][match] = name;
  // quem tinha passado por este jogo e já tinha vencido os seguintes sai deles
  for (let r = round + 1, m = match; prev && prev !== name && r < b.winners.length; r++) {
    const next = Math.floor(m / 2);
    if (b.winners[r][next] !== prev) break;
    b.winners[r][next] = null;
    b.rounds[r + 1][next] = null;
    m = next;
  }
}

function Tournament({ go }: { go: (p: "bigmatch") => void }) {
  const [bracket, setBracket] = useState<Bracket | null>(() => { try { return JSON.parse(localStorage.getItem("cp-tournament") ?? "null"); } catch { return null; } });
  const [names, setNames] = useState("");
  const [mode, setMode] = useState<MinigameMode>("arena");
  useEffect(() => { try { localStorage.setItem("cp-tournament", JSON.stringify(bracket)); } catch { /* ok */ } }, [bracket]);
  if (!bracket) {
    const count = names.split("\n").map((n) => n.trim()).filter(Boolean).length;
    return (
      <div className="col" style={{ gap: 10 }}>
        <p className="muted small">{t("Uma chave eliminatória entre amigos: escreva os nomes (um por linha), escolha o modo e o launcher sorteia os confrontos. Depois de cada partida, clique no vencedor.")}</p>
        <textarea className="input" rows={5} placeholder={t("Ana\nBruno\nCarla\nDiego")} value={names} onChange={(e) => setNames(e.target.value)} aria-label={t("Jogadores do torneio")} />
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as MinigameMode)} aria-label={t("Modo do torneio")}>
            {MINIGAMES.filter((g) => g.key && g.key !== "defense" && g.key !== "survival").map((g) => <option key={g.key} value={g.key}>{t(g.name)}</option>)}
          </select>
          <button className="btn primary" disabled={count < 2 || count > 16} onClick={() => setBracket(newBracket(names.split("\n"), mode))}><Icon name="shuffle" /> {t("Sortear chave ({n} jogadores)", { n: count })}</button>
          {count > 16 && <span className="small" style={{ color: "var(--danger)" }}>{t("No máximo 16 jogadores.")}</span>}
        </div>
      </div>
    );
  }
  const champion = bracket.rounds[bracket.rounds.length - 1][0];
  const pick = (r: number, m: number, name: string | null) => {
    if (!name) return;
    const b: Bracket = JSON.parse(JSON.stringify(bracket));
    setWinner(b, r, m, name);
    setBracket(b);
  };
  const roundName = (r: number) => {
    const left = bracket.rounds[r].length;
    if (left === 2) return t("Final");
    if (left === 4) return t("Semifinal");
    if (left === 8) return t("Quartas");
    return t("Rodada {n}", { n: r + 1 });
  };
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <span className="grow small"><b>{t(minigame(bracket.mode).name)}</b> · {t("{n} jogadores", { n: bracket.names.length })}</span>
        <button className="btn sm tonal" onClick={() => openWith(bracket.mode, go)}><Icon name="sports_esports" size={16} /> {t("Montar partida")}</button>
        <button className="btn sm text" onClick={() => { if (confirm(t("Começar um torneio novo? A chave atual será apagada."))) setBracket(null); }}>{t("Novo torneio")}</button>
      </div>
      {champion && <div className="mg-challenge"><Icon name="emoji_events" size={32} /><span className="grow"><span className="overline">{t("Campeão")}</span><h3 style={{ margin: 0 }}>{champion}</h3></span></div>}
      <div className="mg-bracket">
        {bracket.winners.map((wins, r) => (
          <div key={r} className="mg-round">
            <span className="overline">{roundName(r)}</span>
            {wins.map((w, m) => {
              const a = bracket.rounds[r][m * 2], b = bracket.rounds[r][m * 2 + 1];
              return (
                <div key={m} className="mg-match">
                  {[a, b].map((p, k) => (
                    <button key={k} className={w && p === w ? "win" : ""} disabled={!p || !a || !b} onClick={() => pick(r, m, p)} title={p && a && b ? t("Clique para marcar {name} como vencedor", { name: p }) : undefined}>
                      {p ?? (r === 0 ? t("(passa direto)") : "—")}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
