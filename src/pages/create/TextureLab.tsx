// Laboratório de texturas: gera a textura da tropa por camadas (pintura/camuflagem, painéis,
// marcações, desgaste e sujeira), mostra ao vivo no modelo 3D, compara com o original e com
// versões salvas, regenera só uma camada e exporta o PNG para o computador.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Modal, Notice } from "../../components/ui";
import { api, confirmDialog, saveGenerated } from "../../lib/api";
import { errorText, useStore } from "../../lib/store";
import { locale, t, tr } from "../../lib/i18n";
import { CAMO_LABEL, defaultTexSpec, TEX_PRESETS, type CamoKind, type TexGenDoc, type TexSpec, type TexVersion, type TexView } from "./texgen";
export type { TexGenDoc, TexVersion };
import { imageSize, runTexgen } from "./texgenRun";
import type { ViewModel } from "./UnitViewport";


const VIEWS: [TexView, string][] = [["final", "Resultado"], ["camo", "Só a pintura"], ["panels", "Painéis"], ["wear", "Desgaste"], ["dirt", "Sujeira"], ["edges", "Quinas detectadas"]];
const newSeed = () => Math.floor(Math.random() * 1e9);

export default function TextureLab({ projectId, name, model, modelKey, value, onChange, onPreview, applied, onApply }: {
  projectId: string; name: string; model: ViewModel | null; modelKey: string;
  value: TexGenDoc | null; onChange: (v: TexGenDoc) => void;
  onPreview: (url: string | null) => void; applied: string | null; onApply: (asset: string | null) => void;
}) {
  const toast = useStore.getState().toast;
  const doc: TexGenDoc = useMemo(() => value ?? { spec: defaultTexSpec(newSeed()), versions: [] }, [value]);
  const spec = doc.spec;
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [checks, setChecks] = useState<{ level: "ok" | "warn"; text: string }[]>([]);
  const [compare, setCompare] = useState<{ a: string | null; b: string | null; aName: string; bName: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const holding = useRef(false);
  const set = (fn: (s: TexSpec) => TexSpec) => onChange({ ...doc, spec: fn(JSON.parse(JSON.stringify(spec))) });

  // prévia ao vivo (512 px), fora da tela principal
  const specKey = JSON.stringify(spec);
  useEffect(() => {
    if (!live || !model) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setBusy(true);
      runTexgen(modelKey, model, model.albedo, 512, spec)
        .then((r) => { if (!alive) return; setUrl(r.url); setChecks(r.checks); if (!holding.current) onPreview(r.url); })
        .catch((e) => alive && toast("error", t("Gerador de texturas: {error}", { error: errorText(e) })))
        .finally(() => alive && setBusy(false));
    }, 280);
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, modelKey, model, live]);
  useEffect(() => () => onPreview(null), [onPreview]);
  useEffect(() => { if (!live) onPreview(null); }, [live, onPreview]);

  const full = async () => {
    if (!model) throw new Error(t("o modelo ainda não carregou"));
    const size = await imageSize(model.albedo);
    return runTexgen(modelKey, model, model.albedo, size, { ...spec, view: "final" });
  };
  const apply = async () => {
    setSaving(true);
    try {
      const r = await full();
      const n = doc.versions.length + 1;
      const asset = await api.creationAssetPut(projectId, `textura-v${n}.png`, r.url);
      const v: TexVersion = { id: `${Date.now().toString(36)}${n}`, name: t("Versão {n}", { n }), asset, at: Date.now(), spec: { ...spec, view: "final" }, modelKey };
      onChange({ ...doc, versions: [v, ...doc.versions].slice(0, 30) });
      onApply(asset);
      toast("ok", t("Textura aplicada ({size}×{size}) e guardada como \"{name}\".", { size: r.size, name: v.name }));
    } catch (e) { toast("error", errorText(e)); } finally { setSaving(false); }
  };
  const exportPng = async () => {
    setSaving(true);
    try {
      const r = await full();
      const path = await saveGenerated(`${slug(name)}-textura.png`, r.url, [{ name: t("Imagem PNG"), extensions: ["png"] }]);
      if (path) toast("ok", t("Textura exportada para {path}", { path }));
    } catch (e) { toast("error", errorText(e)); } finally { setSaving(false); }
  };
  const openCompare = async (a: TexVersion | null, b: TexVersion | null) => {
    try {
      const au = a ? await api.creationAsset(projectId, a.asset) : model?.albedo ?? null;
      const bu = b ? await api.creationAsset(projectId, b.asset) : url;
      setCompare({ a: au, b: bu, aName: a?.name ?? t("Original"), bName: b?.name ?? t("Atual (prévia)") });
    } catch (e) { toast("error", errorText(e)); }
  };
  const hold = (on: boolean) => {
    holding.current = on;
    onPreview(on ? model?.albedo ?? null : url);
  };

  if (!model) return <Notice kind="info">{t("Espere o modelo 3D carregar para gerar a textura.")}</Notice>;
  const wrongModel = doc.versions.filter((v) => v.asset === applied && v.modelKey !== modelKey);

  return (
    <div className="texlab">
      {wrongModel.length > 0 && <Notice kind="warn">{t("A textura aplicada foi gerada para outro modelo (a mistura ou o modelo mudou). Gere e aplique de novo para as peças ficarem no lugar.")}</Notice>}
      <div className="texlab-bar">
        <button className={`btn sm ${live ? "primary" : ""}`} onClick={() => setLive((v) => !v)} title={t("Mostra a textura no modelo enquanto você ajusta")}><Icon name={live ? "visibility" : "visibility_off"} size={15} /> {t("Prévia ao vivo")}</button>
        <button className="btn sm" onPointerDown={() => hold(true)} onPointerUp={() => hold(false)} onPointerLeave={() => holding.current && hold(false)} title={t("Segure para ver a textura original")}><Icon name="compare" size={15} /> {t("Segure: original")}</button>
        <button className="btn sm" onClick={() => void openCompare(null, null)} disabled={!url}><Icon name="vertical_split" size={15} /> {t("Lado a lado")}</button>
        {busy && <span className="faint small"><Icon name="hourglass_top" size={14} /> {t("gerando…")}</span>}
      </div>

      <div className="texlab-group">
        <h4>{t("Estilo pronto")}</h4>
        <div className="tex-presets">
          {TEX_PRESETS.map((p) => (
            <button key={p.id} className="chip" onClick={() => onChange({ ...doc, spec: p.apply(spec) })}>{t(p.label)}</button>
          ))}
          <button className="chip" title={t("Novas sementes para todas as camadas")} onClick={() => set((s) => { s.base.seed = newSeed(); s.panels.seed = newSeed(); s.markings.seed = newSeed(); s.wear.seed = newSeed(); s.dirt.seed = newSeed(); return s; })}><Icon name="casino" size={14} /> {t("Variação nova")}</button>
        </div>
        <label className="range sel"><span>{t("Ver")}</span>
          <select className="pinput" value={spec.view} onChange={(e) => set((s) => ({ ...s, view: e.target.value as TexView }))}>{VIEWS.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</select>
        </label>
      </div>

      <Layer title={t("Pintura e camuflagem")} icon="format_paint" onDice={() => set((s) => { s.base.seed = newSeed(); return s; })}>
        <label className="range sel"><span>{t("Padrão")}</span>
          <select className="pinput" value={spec.base.pattern} onChange={(e) => set((s) => { s.base.pattern = e.target.value as CamoKind; if (s.base.keepColor > 0.5) s.base.keepColor = 0.15; return s; })}>
            {Object.entries(CAMO_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
          </select>
        </label>
        <div className="row tex-colors">
          {spec.base.colors.map((c, k) => <input key={k} type="color" value={c} aria-label={t("Cor {n}", { n: k + 1 })} onChange={(e) => set((s) => { s.base.colors[k] = e.target.value; return s; })} />)}
          <span className="faint small">{t("cores da pintura")}</span>
        </div>
        <Slider label={t("Tamanho das manchas")} v={spec.base.scale} min={0.3} max={3} step={0.05} on={(v) => set((s) => { s.base.scale = v; return s; })} />
        <Slider label={t("Cor original")} v={spec.base.keepColor} min={0} max={1} on={(v) => set((s) => { s.base.keepColor = v; return s; })} pct hint={t("100% = mantém a pintura do jogo e só adiciona desgaste e sujeira")} />
        <Slider label={t("Detalhes do original")} v={spec.base.detail} min={0} max={1.5} on={(v) => set((s) => { s.base.detail = v; return s; })} pct />
        <Slider label={t("Sombras do original")} v={spec.base.shading} min={0} max={1} on={(v) => set((s) => { s.base.shading = v; return s; })} pct />
        <Slider label={t("Variação do acabamento")} v={spec.base.variation} min={0} max={1} on={(v) => set((s) => { s.base.variation = v; return s; })} pct />
      </Layer>

      <Layer title={t("Painéis e detalhes mecânicos")} icon="grid_view" on={spec.panels.on} onToggle={(v) => set((s) => { s.panels.on = v; return s; })} onDice={() => set((s) => { s.panels.seed = newSeed(); return s; })}>
        <Slider label={t("Tamanho dos painéis")} v={spec.panels.size} min={0.05} max={0.45} step={0.01} on={(v) => set((s) => { s.panels.size = v; return s; })} />
        <Slider label={t("Frestas")} v={spec.panels.lines} min={0} max={1} on={(v) => set((s) => { s.panels.lines = v; return s; })} pct />
        <Slider label={t("Grades de ventilação")} v={spec.panels.vents} min={0} max={1} on={(v) => set((s) => { s.panels.vents = v; return s; })} pct />
        <Slider label={t("Escotilhas")} v={spec.panels.hatches} min={0} max={1} on={(v) => set((s) => { s.panels.hatches = v; return s; })} pct />
        <Slider label={t("Rebites")} v={spec.panels.rivets} min={0} max={1} on={(v) => set((s) => { s.panels.rivets = v; return s; })} pct />
        <Slider label={t("Tom de cada placa")} v={spec.panels.tone} min={0} max={1} on={(v) => set((s) => { s.panels.tone = v; return s; })} pct />
      </Layer>

      <Layer title={t("Marcações")} icon="flag" on={spec.markings.on} onToggle={(v) => set((s) => { s.markings.on = v; return s; })} onDice={() => set((s) => { s.markings.seed = newSeed(); return s; })}>
        <div className="row tex-colors"><input type="color" value={spec.markings.color} onChange={(e) => set((s) => { s.markings.color = e.target.value; return s; })} aria-label={t("Cor das marcações")} />
          <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={spec.markings.stripe} onChange={(e) => set((s) => { s.markings.stripe = e.target.checked; return s; })} /> {t("Faixa no casco")}</label></div>
        <Slider label={t("Placas zebradas")} v={spec.markings.hazard} min={0} max={1} on={(v) => set((s) => { s.markings.hazard = v; return s; })} pct />
      </Layer>

      <Layer title={t("Desgaste do metal")} icon="auto_fix_normal" on={spec.wear.on} onToggle={(v) => set((s) => { s.wear.on = v; return s; })} onDice={() => set((s) => { s.wear.seed = newSeed(); return s; })}>
        <Slider label={t("Quantidade")} v={spec.wear.amount} min={0} max={1} on={(v) => set((s) => { s.wear.amount = v; return s; })} pct />
        <Slider label={t("Largura nas quinas")} v={spec.wear.width} min={0} max={1} on={(v) => set((s) => { s.wear.width = v; return s; })} pct />
        <Slider label={t("Arranhões")} v={spec.wear.scratches} min={0} max={1} on={(v) => set((s) => { s.wear.scratches = v; return s; })} pct />
        <div className="row tex-colors"><input type="color" value={spec.wear.metal} onChange={(e) => set((s) => { s.wear.metal = e.target.value; return s; })} aria-label={t("Cor do metal")} /><span className="faint small">{t("metal exposto")}</span></div>
      </Layer>

      <Layer title={t("Sujeira e poeira")} icon="water_drop" on={spec.dirt.on} onToggle={(v) => set((s) => { s.dirt.on = v; return s; })} onDice={() => set((s) => { s.dirt.seed = newSeed(); return s; })}>
        <Slider label={t("Quantidade")} v={spec.dirt.amount} min={0} max={1} on={(v) => set((s) => { s.dirt.amount = v; return s; })} pct />
        <Slider label={t("Altura da lama")} v={spec.dirt.height} min={0} max={1} on={(v) => set((s) => { s.dirt.height = v; return s; })} pct />
        <Slider label={t("Escorridos")} v={spec.dirt.streaks} min={0} max={1} on={(v) => set((s) => { s.dirt.streaks = v; return s; })} pct />
        <Slider label={t("Poeira em cima")} v={spec.dirt.dust} min={0} max={1} on={(v) => set((s) => { s.dirt.dust = v; return s; })} pct />
        <div className="row tex-colors"><input type="color" value={spec.dirt.color} onChange={(e) => set((s) => { s.dirt.color = e.target.value; return s; })} aria-label={t("Cor da sujeira")} /><span className="faint small">{t("cor da sujeira")}</span></div>
      </Layer>

      {checks.length > 0 && <div className="texlab-group">{checks.map((c, k) => <span key={k} className={`check-item ${c.level}`}>{tr(c.text)}</span>)}</div>}

      <div className="texlab-bar">
        <button className="btn primary sm" disabled={saving} onClick={() => void apply()}><Icon name="check" size={15} /> {saving ? t("Gerando…") : t("Aplicar na tropa")}</button>
        <button className="btn sm" disabled={saving} onClick={() => void exportPng()}><Icon name="download" size={15} /> {t("Exportar PNG")}</button>
        {applied && <button className="btn sm text" onClick={() => onApply(null)} title={t("Voltar à textura do jogo")}><Icon name="undo" size={15} /> {t("Original")}</button>}
      </div>

      {doc.versions.length > 0 && <div className="texlab-group">
        <h4>{t("Versões")}</h4>
        {doc.versions.map((v, k) => (
          <div key={v.id} className={`tex-version ${v.asset === applied ? "on" : ""}`}>
            <Icon name={v.asset === applied ? "radio_button_checked" : "radio_button_unchecked"} size={16} />
            <span className="grow"><b>{v.name}</b> <small className="faint">{new Date(v.at).toLocaleString(locale())}{v.modelKey !== modelKey ? t(" · outro modelo") : ""}</small></span>
            <button className="btn sm text" title={t("Usar esta versão (e os ajustes dela)")} onClick={() => { onApply(v.asset); onChange({ ...doc, spec: v.spec }); }}><Icon name="check" size={15} /></button>
            <button className="btn sm text" title={t("Comparar com a anterior (ou com o original)")} onClick={() => void openCompare(doc.versions[k + 1] ?? null, v)}><Icon name="compare" size={15} /></button>
            <button className="btn sm text" title={t("Exportar PNG")} onClick={async () => { try { const u = await api.creationAsset(projectId, v.asset); const p = await saveGenerated(`${slug(name)}-${slug(v.name)}.png`, u, [{ name: t("Imagem PNG"), extensions: ["png"] }]); if (p) toast("ok", t("Exportada para {path}", { path: p })); } catch (e) { toast("error", errorText(e)); } }}><Icon name="download" size={15} /></button>
            <button className="btn sm text" title={t("Tirar da lista")} onClick={async () => { if (await confirmDialog(t("Tirar \"{name}\" da lista de versões? O arquivo continua no projeto.", { name: v.name }), t("Tirar"))) onChange({ ...doc, versions: doc.versions.filter((x) => x.id !== v.id) }); }}><Icon name="close" size={15} /></button>
          </div>
        ))}
      </div>}

      {compare && <CompareModal {...compare} onClose={() => setCompare(null)} />}
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tropa";

function Layer({ title, icon, on, onToggle, onDice, children }: { title: string; icon: string; on?: boolean; onToggle?: (v: boolean) => void; onDice: () => void; children: React.ReactNode }) {
  return (
    <div className={`texlab-group ${on === false ? "off" : ""}`}>
      <h4>
        {onToggle && <input type="checkbox" checked={!!on} onChange={(e) => onToggle(e.target.checked)} aria-label={t("Ligar {name}", { name: title })} />}
        <Icon name={icon} size={16} /> <span className="grow">{title}</span>
        <button className="btn sm text" onClick={onDice} title={t("Gerar de novo só esta camada (nova semente)")}><Icon name="casino" size={15} /></button>
      </h4>
      {on !== false && children}
    </div>
  );
}

function Slider({ label, v, min, max, step = 0.01, on, pct, hint }: { label: string; v: number; min: number; max: number; step?: number; on: (v: number) => void; pct?: boolean; hint?: string }) {
  return (
    <label className="range" title={hint}><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} />
      <output>{pct ? `${Math.round(v * 100)}%` : v.toFixed(2)}</output>
    </label>
  );
}

function CompareModal({ a, b, aName, bName, onClose }: { a: string | null; b: string | null; aName: string; bName: string; onClose: () => void }) {
  const [split, setSplit] = useState(50);
  const [zoom, setZoom] = useState(1);
  return (
    <Modal title={t("Comparar texturas")} icon="vertical_split" onClose={onClose} wide>
      <div className="col" style={{ gap: 10 }}>
        <div className="row" style={{ gap: 12 }}>
          <span className="vp-chip">◀ {aName}</span><span className="grow" /><span className="vp-chip">{bName} ▶</span>
        </div>
        <div className="tex-compare" style={{ ["--split" as string]: `${split}%` }}>
          <div className="tex-compare-inner" style={{ transform: `scale(${zoom})` }}>
            {a ? <img src={a} alt={aName} /> : <div className="tex-none">{t("sem imagem")}</div>}
            {b ? <img src={b} alt={bName} className="top" /> : null}
          </div>
          <i className="tex-compare-line" />
        </div>
        <label className="range"><span>{t("Divisória")}</span><input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} /><output>{split}%</output></label>
        <label className="range"><span>{t("Zoom")}</span><input type="range" min={1} max={4} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /><output>{zoom}×</output></label>
      </div>
    </Modal>
  );
}
