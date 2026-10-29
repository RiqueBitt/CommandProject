// Janelas do editor de mapas: distribuir bases em modelos prontos, Raio-X do mapa (comparação
// com mapas competitivos) e a lista de atalhos.
import { useMemo, useState } from "react";
import { Icon, Modal, Notice } from "../../components/ui";
import { t } from "../../lib/i18n";
import type { Pt } from "../studio/mapEdit";
import { BUILD_KEY, SPAWN_LAYOUTS, spawnLayout, type SpawnLayout } from "./mapEditOps";
import type { MapStats, StatCheck } from "./mapStats";
import { SYMMETRY_LABEL, type Symmetry } from "./worldgen";

const COLORS = ["#5aa9e6", "#e5534b", "#7bd88f", "#c78bff", "#f2b33d", "#ff8fab", "#9be7ff", "#eeeeee"];

// ---------------------------------------------------------------- distribuir bases

export interface LayoutResult { spawns: Pt[]; symmetry: Symmetry; teams: "2" | "ffa" | "keep"; pads: boolean }

export function SpawnLayoutModal({ grid, players, image, onClose, onApply }: {
  grid: number; players: number; image: string | null; onClose: () => void; onApply: (r: LayoutResult) => void;
}) {
  const [kind, setKind] = useState<SpawnLayout>("circle");
  const [n, setN] = useState(Math.max(2, Math.min(16, players || 4)));
  const [margin, setMargin] = useState(14);
  const [pads, setPads] = useState(true);
  const [useSym, setUseSym] = useState(true);
  const res = useMemo(() => spawnLayout(kind, n, grid, margin / 100), [kind, n, grid, margin]);
  const teamsOf = (i: number) => (kind === "lines" || kind === "sides" ? (i < Math.ceil(n / 2) ? 0 : 1) : i);
  return (
    <Modal title={t("Distribuir bases")} icon="flag" onClose={onClose} wide>
      <div className="layout-modal">
        <div className="lobby-map layout-prev">
          {image ? <img src={image} alt="" /> : <div className="layout-blank" />}
          <svg viewBox={`0 0 ${grid} ${grid}`}>
            <rect x={(grid * margin) / 100} y={(grid * margin) / 100} width={grid * (1 - (2 * margin) / 100)} height={grid * (1 - (2 * margin) / 100)} fill="none" stroke="#ffffff55" strokeWidth={grid / 300} strokeDasharray={`${grid / 60} ${grid / 90}`} />
            {res.spawns.map((q, i) => <g key={i}><circle cx={q[0]} cy={q[1]} r={grid / 30} fill={COLORS[teamsOf(i) % 8]} stroke="#000" strokeWidth={grid / 170} /><text x={q[0]} y={q[1] + grid / 80} textAnchor="middle" fontSize={grid / 28} fontWeight={700} fill="#000">{i + 1}</text></g>)}
          </svg>
        </div>
        <div className="col" style={{ gap: 10 }}>
          <div className="layout-kinds">
            {SPAWN_LAYOUTS.map((l) => (
              <button key={l.id} className="pick" aria-pressed={kind === l.id} onClick={() => setKind(l.id)} title={t(l.hint)}>
                <Icon name={l.icon} size={20} /><span>{t(l.label)}</span>
              </button>
            ))}
          </div>
          <span className="faint small">{t(SPAWN_LAYOUTS.find((l) => l.id === kind)!.hint)}</span>
          <label className="range"><span>{t("Bases")}</span><input type="range" min={2} max={16} value={n} onChange={(e) => setN(Number(e.target.value))} /><output>{n}</output></label>
          <label className="range"><span>{t("Da borda")}</span><input type="range" min={6} max={30} value={margin} onChange={(e) => setMargin(Number(e.target.value))} /><output>{margin}%</output></label>
          <label className="check small"><input type="checkbox" checked={pads} onChange={(e) => setPads(e.target.checked)} /> {t("Aplainar o chão embaixo das bases")}</label>
          <label className="check small"><input type="checkbox" checked={useSym} disabled={res.symmetry === "none"} onChange={(e) => setUseSym(e.target.checked)} />
            {res.symmetry === "none" ? t("Sem simetria que combine com esse número de bases") : t("Usar a simetria {s} ao colocar o resto", { s: t(SYMMETRY_LABEL[res.symmetry]).toLowerCase() })}</label>
          <Notice kind="info">{t("As bases atuais são trocadas pelas novas. Massa, formas e decorações ficam onde estão (Ctrl+Z desfaz).")}</Notice>
          <footer>
            <button className="btn text" onClick={onClose}>{t("Cancelar")}</button>
            <button className="btn primary" onClick={() => onApply({ spawns: res.spawns, symmetry: useSym ? res.symmetry : "none", teams: kind === "lines" || kind === "sides" ? "2" : n % 2 ? "ffa" : "keep", pads })}>
              <Icon name="flag" size={16} /> {t("Colocar {n} bases", { n })}
            </button>
          </footer>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Raio-X

export function XRayModal({ stats, checks, shares, baseMass, contested, onContested, onClose, onBuildLayer }: {
  stats: MapStats; checks: StatCheck[]; shares: number[]; baseMass: number; contested: number; onContested: () => void; onClose: () => void; onBuildLayer: () => void;
}) {
  const bad = checks.filter((c) => c.verdict !== "ok").length;
  const score = Math.round(((checks.length - bad) / Math.max(1, checks.length)) * 100);
  return (
    <Modal title={t("Raio-X do mapa")} icon="query_stats" onClose={onClose} wide>
      <div className="col" style={{ gap: 12 }}>
        <div className="balance-head">
          <div className={`balance-score ${score >= 85 ? "ok" : score >= 60 ? "warn" : "err"}`}><b>{checks.length - bad}</b><span>/{checks.length}</span></div>
          <div className="col" style={{ gap: 4 }}>
            <b>{bad === 0 ? t("Dentro da faixa dos mapas competitivos") : t("{n} medida(s) fora da faixa dos mapas competitivos", { n: bad })}</b>
            <span className="muted small">{t("Comparado com 20 mapas competitivos feitos à mão (8 jogadores): quanto chão plano, quantos níveis, quanta massa e onde ela fica.")}</span>
          </div>
        </div>
        <table className="balance-table xray-table">
          <thead><tr><th>{t("Medida")}</th><th>{t("Seu mapa")}</th><th>{t("Competitivos")}</th><th /></tr></thead>
          <tbody>
            {checks.map((c) => (
              <tr key={c.id} className={c.verdict}>
                <td>{t(c.label)}</td><td><b>{c.value}</b></td><td className="muted">{c.ref}</td>
                <td><Icon name={c.verdict === "ok" ? "check_circle" : c.verdict === "low" ? "arrow_downward" : "arrow_upward"} size={17} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {checks.some((c) => c.tip) && (
          <div className="col" style={{ gap: 4 }}>
            <b className="small">{t("O que fazer")}</b>
            {checks.filter((c) => c.tip).map((c) => <span key={c.id} className="small">• <b>{t(c.label)}:</b> {t(c.tip)}</span>)}
          </div>
        )}
        <div className="col" style={{ gap: 6 }}>
          <b className="small">{t("Onde dá para construir")}</b>
          <div className="build-bar">{BUILD_KEY.map((k, i) => shares[i] > 0.004 && <span key={k.color} style={{ flex: shares[i], background: k.color }} title={`${t(k.label)}: ${Math.round(shares[i] * 100)}%`} />)}</div>
          <div className="build-legend">{BUILD_KEY.map((k, i) => <span key={k.color}><i style={{ background: k.color }} /> {t(k.label)} <b>{Math.round(shares[i] * 100)}%</b></span>)}</div>
        </div>
        <div className="col" style={{ gap: 4 }}>
          <b className="small">{t("Massa disputada")}</b>
          <span className="small">{contested
            ? t("{n} ponto(s) de massa a uma distância parecida (a pé) de bases rivais: é onde as partidas esquentam. Mapas competitivos põem boa parte da massa solta assim.", { n: contested })
            : t("Nenhum ponto de massa fica no meio do caminho entre bases rivais: cada base só cuida da sua. Ponha massa entre elas para criar disputa.")}
            {contested > 0 && <button type="button" className="btn sm" style={{ marginLeft: 8 }} onClick={onContested}><Icon name="select_all" size={15} /> {t("Selecionar")}</button>}</span>
        </div>
        <p className="faint small">{t("Altura de {a} a {b} · {m} ponto(s) de massa colocados · massa solta a {d} unidades das bases (mediana). A massa da base que o toolkit põe ao gerar ({k} por base) entra na conta da massa por jogador.", { a: stats.h[0], b: stats.h[1], m: stats.mass, d: stats.spread, k: baseMass })}</p>
        <footer>
          <button className="btn" onClick={onBuildLayer}><Icon name="foundation" size={16} /> {t("Ver a camada de construção")}</button>
          <button className="btn primary" onClick={onClose}>{t("Fechar")}</button>
        </footer>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- atalhos

const KEYS: [string, string][][] = [
  [["V", "Selecionar"], ["W / Q / T", "Mover, girar e mudar a escala da seleção"], ["C", "Câmera"], ["E", "Apagar"], ["Esc", "Limpar a seleção e voltar a selecionar"]],
  [["B", "Bases"], ["M", "Massa"], ["D", "Decorar"], ["G", "Gerar mundo"], ["R / F / S", "Pincel: subir, descer e suavizar"]],
  [["[ e ]", "Raio do pincel menor e maior"], ["Shift + [ e ]", "Força do pincel menor e maior"], ["N", "Encaixe na grade liga e desliga"], ["Alt + clique", "Ponto novo na linha selecionada (rio, serra, caminho)"]],
  [["Ctrl+C / Ctrl+X", "Copiar e recortar a seleção"], ["Ctrl+V", "Colar onde o mouse está (também entre mapas)"], ["Ctrl+D", "Duplicar"], ["Ctrl+M", "Aplicar a simetria na seleção"]],
  [["Ctrl+A", "Selecionar tudo"], ["Ctrl+I", "Inverter a seleção"], ["Ctrl+Shift+A", "Selecionar iguais (mesma decoração, mesmo tipo de forma)"], ["Del", "Excluir"]],
  [["Setas (Shift)", "Mover 2 (10) unidades"], [", e .", "Girar 15°"], ["- e +", "Escala 10%"], ["Ctrl+Z / Ctrl+Y", "Desfazer e refazer"], ["Ctrl+S", "Salvar"], ["?", "Esta lista"]],
];

export function KeysModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t("Atalhos do editor de mapas")} icon="keyboard" onClose={onClose} wide>
      <div className="keys-grid">
        {KEYS.map((col, i) => (
          <div key={i} className="col" style={{ gap: 4 }}>
            {col.map(([k, label]) => <span key={k} className="keys-row"><kbd>{t(k)}</kbd><span>{t(label)}</span></span>)}
          </div>
        ))}
      </div>
    </Modal>
  );
}
