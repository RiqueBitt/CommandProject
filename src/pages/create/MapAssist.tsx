// Janelas do Assistente do editor de mapas: esboço → mapa, relevo de imagem, equilíbrio e linha do
// tempo das versões.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Modal, Notice } from "../../components/ui";
import { api } from "../../lib/api";
import { t } from "../../lib/i18n";
import { useStore } from "../../lib/store";
import type { CreationVersion } from "../../lib/types";
import type { Pt } from "../studio/mapEdit";
import { SKETCH_KINDS, type Balance } from "./mapTools";

// ---------------------------------------------------------------- esboço

const SK_N = 64;

export function SketchModal({ onClose, onApply, players }: { onClose: () => void; onApply: (sketch: Uint8Array, N: number, spawns: Pt[]) => void; players: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [grid] = useState(() => new Uint8Array(SK_N * SK_N));
  const [kind, setKind] = useState(1);
  const [size, setSize] = useState(4);
  const [mirror, setMirror] = useState<"none" | "x" | "rot2" | "rot4">("rot2");
  const [bases, setBases] = useState<Pt[]>([]);
  const [baseTool, setBaseTool] = useState(false);
  const [rev, setRev] = useState(0);
  const down = useRef(false);

  useEffect(() => {
    const c = cv.current;
    if (!c) return;
    const g = c.getContext("2d")!;
    const cell = c.width / SK_N;
    for (let j = 0; j < SK_N; j++) for (let i = 0; i < SK_N; i++) {
      g.fillStyle = SKETCH_KINDS[grid[j * SK_N + i]].color;
      g.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
    }
    for (const b of bases) {
      g.fillStyle = "#e5534b"; g.strokeStyle = "#fff"; g.lineWidth = 2;
      g.beginPath(); g.arc((b[0] / 1024) * c.width, (b[1] / 1024) * c.height, 8, 0, Math.PI * 2); g.fill(); g.stroke();
    }
  }, [grid, rev, bases]);

  const copies = (i: number, j: number): [number, number][] => {
    const L = SK_N - 1;
    const out: [number, number][] = [[i, j]];
    if (mirror === "x") out.push([L - i, j]);
    if (mirror === "rot2" || mirror === "rot4") out.push([L - i, L - j]);
    if (mirror === "rot4") out.push([L - j, i], [j, L - i]);
    return out;
  };
  const paint = (e: React.PointerEvent) => {
    const c = cv.current!;
    const r = c.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fz = (e.clientY - r.top) / r.height;
    if (baseTool) {
      if (e.type !== "pointerdown") return;
      const p: Pt = [Math.round(fx * 1024), Math.round(fz * 1024)];
      const near = bases.findIndex((b) => Math.hypot(b[0] - p[0], b[1] - p[1]) < 30);
      if (near >= 0) { setBases((l) => l.filter((_, k) => k !== near)); return; }
      const all = copies(Math.round(fx * (SK_N - 1)), Math.round(fz * (SK_N - 1))).map(([i, j]) => [Math.round((i / (SK_N - 1)) * 1024), Math.round((j / (SK_N - 1)) * 1024)] as Pt);
      setBases((l) => [...l, ...all.filter((q, k) => all.findIndex((x) => Math.hypot(x[0] - q[0], x[1] - q[1]) < 10) === k)].slice(0, 32));
      return;
    }
    const ci = Math.floor(fx * SK_N), cj = Math.floor(fz * SK_N);
    for (let dj = -size; dj <= size; dj++) for (let di = -size; di <= size; di++) {
      if (di * di + dj * dj > size * size) continue;
      for (const [i, j] of copies(ci + di, cj + dj)) if (i >= 0 && j >= 0 && i < SK_N && j < SK_N) grid[j * SK_N + i] = kind;
    }
    setRev((v) => v + 1);
  };

  return (
    <Modal title={t("Esboço → mapa")} icon="draw" onClose={onClose} wide>
      <div className="sketch">
        <div className="col" style={{ gap: 10 }}>
          <p className="muted small">{t("Desenhe o mapa com cores: o gerador transforma o desenho em relevo de verdade, com encostas, detalhe e erosão. Depois dá para continuar editando normalmente.")}</p>
          <div className="sketch-palette">
            {SKETCH_KINDS.map((k, i) => (
              <button key={k.id} type="button" className={`sketch-color ${!baseTool && kind === i ? "on" : ""}`} onClick={() => { setKind(i); setBaseTool(false); }}>
                <i style={{ background: k.color }} /> {t(k.label)}
              </button>
            ))}
            <button type="button" className={`sketch-color ${baseTool ? "on" : ""}`} onClick={() => setBaseTool(true)}><i style={{ background: "#e5534b", borderRadius: "50%" }} /> {t("Bases")} ({bases.length})</button>
          </div>
          <label className="range"><span>{t("Pincel")}</span><input type="range" min={1} max={10} value={size} onChange={(e) => setSize(Number(e.target.value))} /><output>{size}</output></label>
          <label className="field"><span className="label">{t("Espelhar enquanto desenha")}</span>
            <select className="select" value={mirror} onChange={(e) => setMirror(e.target.value as typeof mirror)}>
              <option value="none">{t("Não")}</option><option value="x">{t("Esquerda ↔ direita")}</option><option value="rot2">{t("Girado (2 lados)")}</option><option value="rot4">{t("Girado (4 lados)")}</option>
            </select>
          </label>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="btn sm" onClick={() => { grid.fill(kind); setRev((v) => v + 1); }}><Icon name="format_color_fill" size={16} /> {t("Preencher tudo")}</button>
            <button type="button" className="btn sm" onClick={() => { grid.fill(0); setBases([]); setRev((v) => v + 1); }}><Icon name="restart_alt" size={16} /> {t("Limpar")}</button>
          </div>
          {bases.length > 0 && bases.length < 2 && <span className="small warn-text">{t("Ponha pelo menos 2 bases (ou nenhuma, para manter as do mapa).")}</span>}
          {bases.length === 0 && <span className="faint small">{t("Sem bases desenhadas, ficam as {n} bases do mapa.", { n: players })}</span>}
        </div>
        <canvas ref={cv} width={512} height={512} className="sketch-canvas"
          onPointerDown={(e) => { down.current = true; (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId); paint(e); }}
          onPointerMove={(e) => down.current && paint(e)} onPointerUp={() => { down.current = false; }} />
      </div>
      <footer className="row" style={{ justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button className="btn text" onClick={onClose}>{t("Cancelar")}</button>
        <button className="btn primary" disabled={bases.length === 1} onClick={() => onApply(grid, SK_N, bases)}><Icon name="auto_awesome" /> {t("Transformar em mapa")}</button>
      </footer>
    </Modal>
  );
}

// ---------------------------------------------------------------- relevo de imagem

export function ImportHeightModal({ onClose, onApply, water }: { onClose: () => void; onApply: (gray: Float32Array, w: number, h: number, low: number, high: number) => void; water: number }) {
  const [img, setImg] = useState<{ url: string; gray: Float32Array; w: number; h: number } | null>(null);
  const [low, setLow] = useState(Math.max(0, Math.round(water - 20)));
  const [high, setHigh] = useState(Math.round(Math.max(water, 40) + 120));
  const read = (file: File) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const S = 256;
      const c = document.createElement("canvas");
      c.width = S; c.height = S;
      const g = c.getContext("2d")!;
      g.drawImage(im, 0, 0, S, S);
      const d = g.getImageData(0, 0, S, S).data;
      const gray = new Float32Array(S * S);
      for (let k = 0; k < S * S; k++) gray[k] = (d[k * 4] * 0.3 + d[k * 4 + 1] * 0.59 + d[k * 4 + 2] * 0.11) / 255;
      setImg({ url: c.toDataURL(), gray, w: S, h: S });
      URL.revokeObjectURL(url);
    };
    im.src = url;
  };
  return (
    <Modal title={t("Importar relevo de imagem")} icon="image" onClose={onClose}>
      <div className="col" style={{ gap: 10 }}>
        <p className="muted small">{t("Use um mapa de altura em tons de cinza (PNG ou JPG): preto é o ponto mais baixo e branco o mais alto. Serve imagem de outro editor, de um gerador ou desenhada à mão.")}</p>
        <label className="btn" style={{ alignSelf: "flex-start" }}>
          <Icon name="upload" /> {t("Escolher imagem")}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/bmp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); }} />
        </label>
        {img && <img src={img.url} alt="" className="heightmap-preview" />}
        <label className="range"><span>{t("Altura do preto")}</span><input type="range" min={0} max={300} value={low} onChange={(e) => setLow(Number(e.target.value))} /><output>{low}</output></label>
        <label className="range"><span>{t("Altura do branco")}</span><input type="range" min={10} max={480} value={high} onChange={(e) => setHigh(Number(e.target.value))} /><output>{high}</output></label>
        {water > 0.5 && <span className="faint small">{t("A água do mapa fica na altura {w}: o que estiver abaixo vira mar ou lago.", { w: Math.round(water) })}</span>}
        <footer className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn text" onClick={onClose}>{t("Cancelar")}</button>
          <button className="btn primary" disabled={!img || high <= low} onClick={() => img && onApply(img.gray, img.w, img.h, low, high)}><Icon name="terrain" /> {t("Usar como relevo")}</button>
        </footer>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- equilíbrio

export function BalanceModal({ result, onClose, onAddMass, travel }: { result: Balance; onClose: () => void; onAddMass: (pts: Pt[]) => void; travel: { a: number; b: number; walk: string; time: string }[] }) {
  const tone = result.score >= 85 ? "ok" : result.score >= 65 ? "warn" : "err";
  return (
    <Modal title={t("Equilíbrio das bases")} icon="balance" onClose={onClose} wide>
      <div className="col" style={{ gap: 12 }}>
        <div className="balance-head">
          <div className={`balance-score ${tone}`}><b>{result.score}</b><span>/100</span></div>
          <div className="col" style={{ gap: 4 }}>
            <b>{result.score >= 85 ? t("Bases justas") : result.score >= 65 ? t("Quase justo") : t("Desequilibrado")}</b>
            {result.problems.length === 0 ? <span className="muted small">{t("Massa, distância até o inimigo e proteção parecidas em todas as bases.")}</span>
              : result.problems.map((p) => <span key={p} className="small">• {t(p)}</span>)}
          </div>
        </div>
        <table className="balance-table">
          <thead><tr><th>{t("Base")}</th><th>{t("Time")}</th><th>{t("Massa perto")}</th><th>{t("Até a massa")}</th><th>{t("Até o inimigo")}</th><th>{t("Entradas")}</th></tr></thead>
          <tbody>
            {result.bases.map((b) => (
              <tr key={b.index}>
                <td>{b.index + 1}</td><td>{b.team + 1}</td><td>{b.massNear}</td>
                <td>{b.massReach >= 9999 ? "—" : Math.round(b.massReach)}</td>
                <td>{b.enemy < 0 ? t("sem caminho") : Math.round(b.enemy)}</td>
                <td>{b.openness}/12</td>
              </tr>
            ))}
          </tbody>
        </table>
        {travel.length > 0 && (
          <div className="col" style={{ gap: 4 }}>
            <b className="small">{t("Ataque de base a base (tanque)")}</b>
            <div className="balance-travel">
              {travel.map((x) => <span key={`${x.a}-${x.b}`} className="chip">{x.a} → {x.b}: {x.walk} · {x.time}</span>)}
            </div>
          </div>
        )}
        {result.suggestions.length > 0 ? (
          <Notice kind="info">
            {t("Sugestão: {n} ponto(s) de massa nas bases com menos massa perto, em chão plano.", { n: result.suggestions.length })}
            <button type="button" className="btn sm primary" style={{ marginLeft: 10 }} onClick={() => onAddMass(result.suggestions)}><Icon name="diamond" size={15} /> {t("Pôr a massa sugerida")}</button>
          </Notice>
        ) : result.problems.length > 0 && <p className="faint small">{t("Para o resto, ajuste à mão: mova bases, abra passagens ou ponha obstáculos (a nota atualiza ao abrir de novo).")}</p>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- linha do tempo

export function TimelineModal<D>({ id, render, current, onClose, onRestore }: {
  id: string;
  /** imagem e números de um documento do mapa */
  render: (doc: D) => { image: string | null; stats: string };
  current: D;
  onClose: () => void;
  onRestore: (doc: D) => void;
}) {
  const [list, setList] = useState<CreationVersion[] | null>(null);
  const [pos, setPos] = useState(0);
  const [docs, setDocs] = useState<Record<string, D>>({});
  useEffect(() => { void api.creationVersions(id).then((l) => { const ord = [...l].reverse(); setList(ord); setPos(ord.length); }).catch(() => setList([])); }, [id]);
  const v = list && pos < list.length ? list[pos] : null;
  useEffect(() => {
    if (!v || docs[v.file]) return;
    void api.creationVersion<D>(id, v.file).then((d) => setDocs((m) => ({ ...m, [v.file]: d }))).catch(() => undefined);
  }, [v, id, docs]);
  const now = useMemo(() => render(current), [current, render]);
  const then = useMemo(() => (v && docs[v.file] ? render(docs[v.file]) : null), [v, docs, render]);
  const locale = useStore.getState().settings?.uiPrefs?.lang === "en" ? "en" : "pt-BR";
  return (
    <Modal title={t("Linha do tempo do mapa")} icon="history" onClose={onClose} wide>
      {list === null ? <div className="bar indeterminate"><i /></div> : list.length === 0 ? <p className="faint small">{t("Ainda não há versões anteriores: elas são guardadas quando você salva.")}</p> : (
        <div className="col" style={{ gap: 12 }}>
          <input type="range" min={0} max={list.length} value={pos} onChange={(e) => setPos(Number(e.target.value))} className="timeline-slider" />
          <div className="row small" style={{ justifyContent: "space-between" }}>
            <span className="faint">{new Date(list[0].savedAt).toLocaleString(locale)}</span>
            <b>{v ? new Date(v.savedAt).toLocaleString(locale) : t("Agora")}</b>
            <span className="faint">{t("Agora")}</span>
          </div>
          <div className="timeline-compare">
            <figure>
              {v ? (then?.image ? <img src={then.image} alt="" /> : <div className="bar indeterminate"><i /></div>) : now.image ? <img src={now.image} alt="" /> : null}
              <figcaption>{v ? `${t("Versão")} ${pos + 1} · ${then?.stats ?? ""}` : `${t("Agora")} · ${now.stats}`}</figcaption>
            </figure>
            <figure>
              {now.image && <img src={now.image} alt="" />}
              <figcaption>{t("Agora")} · {now.stats}</figcaption>
            </figure>
          </div>
          <p className="faint small">{t("A prévia usa o terreno de agora: se a versão era sobre outro terreno, ela aparece sobre este.")}</p>
          <footer className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button className="btn text" onClick={onClose}>{t("Fechar")}</button>
            <button className="btn primary" disabled={!v || !docs[v.file]} onClick={async () => { if (!v) return; const d = await api.creationRestore<D>(id, v.file); onRestore(d); onClose(); }}><Icon name="restore" /> {t("Voltar para esta versão")}</button>
          </footer>
        </div>
      )}
    </Modal>
  );
}
