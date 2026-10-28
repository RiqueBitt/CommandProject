// Início: os minigames da Partida grande e os recordes que o jogo gravou no perfil dele.
import { useEffect, useState } from "react";
import { Icon } from "./ui";
import { api } from "../lib/api";
import { t } from "../lib/i18n";
import { useStore } from "../lib/store";
import { MINIGAMES, type MinigameMode, type MinigameRecord } from "../lib/minigames";

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

/** Abre a Partida grande com o minigame já escolhido. */
function openWith(mode: MinigameMode, go: (p: "bigmatch") => void) {
  try {
    const raw = localStorage.getItem("cp-bigmatch-options");
    const o = raw ? JSON.parse(raw) : {};
    localStorage.setItem("cp-bigmatch-options", JSON.stringify({ ...o, mode }));
  } catch { /* ok */ }
  go("bigmatch");
}

export default function MinigamesCard() {
  const { go } = useStore.getState();
  const running = useStore((s) => s.dashboard?.gameRunning);
  const [records, setRecords] = useState<MinigameRecord[]>([]);
  // relido quando o jogo fecha (o resultado acabou de ser gravado)
  useEffect(() => { if (!running) api.minigameRecords().then(setRecords).catch(() => setRecords([])); }, [running]);
  const games = MINIGAMES.filter((g) => g.key);
  return (
    <section className="card pad">
      <div className="card-title">
        <Icon name="emoji_events" style={{ color: "var(--primary)" }} /><h3>{t("Minigames")}</h3>
        <button className="btn sm text" onClick={() => go("bigmatch")}>{t("Partida grande")}</button>
      </div>
      <p className="muted small" style={{ marginBottom: 10 }}>{t("Modos com objetivos diferentes, contra a IA ou com amigos. No jogo, escolha em Batalha → Criar jogo → MODO.")}</p>
      <div className="col" style={{ gap: 6 }}>
        {games.map((g) => {
          const r = records.find((x) => x.mode === g.key);
          return (
            <div key={g.key} className="row" style={{ gap: 10 }}>
              <Icon name={g.icon} size={20} style={{ color: "var(--muted)" }} />
              <span className="grow" style={{ minWidth: 0 }}>
                <b>{t(g.name)}</b>
                <span className="muted small" style={{ display: "block" }}>
                  {!r ? t("Ainda não jogado") : [
                    t("{w} de {p} vencidas", { w: r.wins, p: r.played }),
                    g.key === "defense" && r.best > 0 ? t("recorde: {n} ondas", { n: r.best }) : null,
                    g.key !== "defense" && r.best > 0 ? t("melhor pontuação: {n}", { n: r.best }) : null,
                    r.fastest ? t("vitória mais rápida: {time}", { time: fmtTime(r.fastest) }) : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button className="btn sm tonal" title={t(g.hint)} onClick={() => openWith(g.key, go)}>{t("Montar")}</button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
