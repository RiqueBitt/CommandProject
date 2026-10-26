// Gerador de ícones: enquadra a tropa, ajusta câmera, luz, fundo, contorno e símbolo, mostra como
// fica em vários tamanhos e exporta (um PNG ou o conjunto inteiro) para uma pasta do computador.
import { useEffect, useMemo, useState } from "react";
import { Icon, Modal, Notice } from "../../components/ui";
import { pickFile, saveGenerated, writeGenerated } from "../../lib/api";
import { t } from "../../lib/i18n";
import { errorText, getUiPref, setUiPref, useStore } from "../../lib/store";
import { BG_LABEL, defaultIconSpec, ICON_PRESETS, ICON_SIZES, renderIcon, SYMBOL_LABEL, type IconBg, type IconResult, type IconSpec, type IconSymbol } from "./iconRender";
import type { ViewModel } from "./UnitViewport";

export const joinPath = (dir: string, name: string) => `${dir.replace(/[\\/]+$/, "")}${dir.includes("\\") ? "\\" : "/"}${name}`;
const SMALL = [24, 32, 48, 64];

/** Estilo salvo (vale para todas as tropas, para os ícones ficarem iguais entre si). */
export function savedIconSpec(): IconSpec {
  return { ...defaultIconSpec(), ...(getUiPref<Partial<IconSpec>>("iconStyle") ?? {}) };
}

/** Sugere o símbolo pela categoria da tropa. */
export function symbolFor(categories: string[]): IconSymbol {
  const c = new Set(categories.map((x) => x.toUpperCase()));
  if (c.has("EXPERIMENTAL")) return "experimental";
  if (c.has("ENGINEER")) return "engineer";
  if (c.has("ANTIAIR")) return "antiair";
  if (c.has("ARTILLERY") || c.has("INDIRECTFIRE")) return "artillery";
  if (c.has("AIR")) return "air";
  if (c.has("NAVAL")) return "naval";
  if (c.has("STRUCTURE")) return "structure";
  if (c.has("SHIELD")) return "shield";
  return "land";
}

export default function IconStudio({ title, unitId, model, albedo = null, tint, categories = [], onUse, onClose }: {
  title: string; unitId: string; model: ViewModel | null; albedo?: string | null; tint?: { hue: number; sat: number; bright: number };
  categories?: string[]; onUse?: (png: string) => Promise<void> | void; onClose: () => void;
}) {
  const toast = useStore.getState().toast;
  const [spec, setSpec] = useState<IconSpec>(() => savedIconSpec());
  const [main, setMain] = useState<IconResult | null>(null);
  const [small, setSmall] = useState<Record<number, string>>({});
  const [outSize, setOutSize] = useState(256);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<IconSpec>) => setSpec((s) => { const n = { ...s, ...p }; setUiPref("iconStyle", n); return n; });
  const key = useMemo(() => JSON.stringify(spec), [spec]);

  useEffect(() => {
    if (!model) return;
    let alive = true;
    const timer = window.setTimeout(async () => {
      try {
        const m = await renderIcon(model, spec, 256, albedo, tint);
        if (!alive) return;
        setMain(m);
        const out: Record<number, string> = {};
        for (const s of SMALL) out[s] = (await renderIcon(model, spec, s, albedo, tint)).url;
        if (alive) setSmall(out);
      } catch (e) { if (alive) toast("error", t("Ícone: {error}", { error: errorText(e) })); }
    }, 180);
    return () => { alive = false; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, model, albedo]);

  const exportOne = async () => {
    if (!model) return;
    setBusy(true);
    try {
      const r = await renderIcon(model, spec, outSize, albedo, tint);
      const p = await saveGenerated(`${unitId}_icone_${outSize}.png`, r.url, [{ name: t("Imagem PNG"), extensions: ["png"] }]);
      if (p) toast("ok", t("Ícone salvo em {path}", { path: p }));
    } catch (e) { toast("error", errorText(e)); } finally { setBusy(false); }
  };
  const exportSet = async () => {
    if (!model) return;
    const dir = await pickFile([], true);
    if (!dir) return;
    setBusy(true);
    try {
      let n = 0;
      for (const s of ICON_SIZES) {
        const r = await renderIcon(model, spec, s, albedo, tint);
        if (await writeGenerated(joinPath(dir, `${unitId}_icone_${s}.png`), r.url)) n++;
      }
      toast("ok", t("{n} ícone(s) salvos em {dir}", { n, dir }));
    } catch (e) { toast("error", errorText(e)); } finally { setBusy(false); }
  };
  const use = async () => {
    if (!model || !onUse) return;
    setBusy(true);
    try { await onUse((await renderIcon(model, spec, 256, albedo, tint)).url); } catch (e) { toast("error", errorText(e)); } finally { setBusy(false); }
  };

  return (
    <Modal title={t("Gerador de ícones · {name}", { name: title })} icon="photo_camera" onClose={onClose} wide>
      {!model ? <Notice kind="info">{t("Carregando o modelo 3D…")}</Notice> : (
        <div className="iconlab">
          <div className="iconlab-preview">
            <div className="iconlab-main">{main ? <img src={main.url} alt={t("Ícone")} /> : <div className="bar indeterminate"><i /></div>}</div>
            <div className="iconlab-small">
              {SMALL.map((s) => <figure key={s}>{small[s] ? <img src={small[s]} alt={`${s} px`} style={{ width: s, height: s }} /> : <span style={{ width: s, height: s }} />}<figcaption>{s} px</figcaption></figure>)}
            </div>
            <div className="iconlab-small dark">
              {SMALL.slice(0, 3).map((s) => <figure key={s}>{small[s] && <img src={small[s]} alt="" style={{ width: s, height: s }} />}<figcaption>{t("fundo escuro")}</figcaption></figure>)}
            </div>
            {main?.checks.map((c, k) => <span key={k} className={`check-item ${c.level}`}>{c.text}</span>)}
          </div>
          <div className="iconlab-controls">
            <div className="texlab-group"><h4>{t("Estilo")}</h4>
              <div className="tex-presets">{ICON_PRESETS.map((p) => <button key={p.id} className="chip" onClick={() => set(p.spec)}>{t(p.label)}</button>)}
                <button className="chip" onClick={() => set(defaultIconSpec())}><Icon name="restart_alt" size={14} /> {t("Padrão")}</button></div>
              <p className="faint small" style={{ margin: 0 }}>{t("O estilo fica salvo e vale para os ícones de todas as tropas.")}</p>
            </div>
            <div className="texlab-group"><h4><Icon name="videocam" size={16} /> {t("Câmera e enquadramento")}</h4>
              <R label={t("Giro")} v={spec.yaw} min={-180} max={180} step={1} unit="°" on={(v) => set({ yaw: v })} />
              <R label={t("Altura")} v={spec.pitch} min={-10} max={85} step={1} unit="°" on={(v) => set({ pitch: v })} />
              <R label={t("Preenchimento")} v={spec.fill} min={0.5} max={1} on={(v) => set({ fill: v })} pct />
              <R label={t("Perspectiva")} v={spec.fov} min={10} max={60} step={1} unit="°" on={(v) => set({ fov: v })} />
            </div>
            <div className="texlab-group"><h4><Icon name="light_mode" size={16} /> {t("Luz")}</h4>
              <R label={t("Luz principal")} v={spec.light} min={0.2} max={2} on={(v) => set({ light: v })} pct />
              <R label={t("Ambiente")} v={spec.ambient} min={0} max={2} on={(v) => set({ ambient: v })} pct />
              <R label={t("Luz de contorno")} v={spec.rimPower} min={0} max={2} on={(v) => set({ rimPower: v })} pct />
              <div className="row tex-colors"><input type="color" value={spec.rim} onChange={(e) => set({ rim: e.target.value })} aria-label={t("Cor da luz de contorno")} /><span className="faint small">{t("cor da luz de contorno")}</span>
                <input type="color" value={spec.teamColor} onChange={(e) => set({ teamColor: e.target.value })} aria-label={t("Cor do time")} /><span className="faint small">{t("cor do time")}</span></div>
            </div>
            <div className="texlab-group"><h4><Icon name="wallpaper" size={16} /> {t("Fundo e contorno")}</h4>
              <label className="range sel"><span>{t("Fundo")}</span><select className="pinput" value={spec.bg} onChange={(e) => set({ bg: e.target.value as IconBg })}>{Object.entries(BG_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
              {spec.bg !== "transparent" && <div className="row tex-colors"><input type="color" value={spec.bgColor} onChange={(e) => set({ bgColor: e.target.value })} aria-label={t("Cor de baixo")} /><input type="color" value={spec.bgColor2} onChange={(e) => set({ bgColor2: e.target.value })} aria-label={t("Cor de cima")} />
                <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={spec.frame} onChange={(e) => set({ frame: e.target.checked })} /> {t("Moldura")}</label></div>}
              <R label={t("Contorno")} v={spec.outline} min={0} max={5} step={0.5} on={(v) => set({ outline: v })} />
              <div className="row tex-colors"><input type="color" value={spec.outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} aria-label={t("Cor do contorno")} /><span className="faint small">{t("cor do contorno")}</span></div>
              <R label={t("Nitidez (pequenos)")} v={spec.sharpen} min={0} max={1.5} on={(v) => set({ sharpen: v })} pct />
            </div>
            <div className="texlab-group"><h4><Icon name="label" size={16} /> {t("Símbolo de função")}</h4>
              <label className="range sel"><span>{t("Símbolo")}</span><select className="pinput" value={spec.symbol} onChange={(e) => set({ symbol: e.target.value as IconSymbol })}>{Object.entries(SYMBOL_LABEL).map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</select></label>
              {categories.length > 0 && <button className="btn sm text" onClick={() => set({ symbol: symbolFor(categories) })}><Icon name="auto_awesome" size={15} /> {t("Pela função da tropa ({name})", { name: t(SYMBOL_LABEL[symbolFor(categories)]) })}</button>}
              {spec.symbol !== "none" && <div className="row tex-colors"><input type="color" value={spec.symbolColor} onChange={(e) => set({ symbolColor: e.target.value })} aria-label={t("Cor do símbolo")} />
                <select className="pinput" value={spec.corner} onChange={(e) => set({ corner: e.target.value as IconSpec["corner"] })}><option value="tl">{t("canto sup. esquerdo")}</option><option value="tr">{t("canto sup. direito")}</option><option value="bl">{t("canto inf. esquerdo")}</option><option value="br">{t("canto inf. direito")}</option></select></div>}
            </div>
            <div className="texlab-bar">
              {onUse && <button className="btn primary sm" disabled={busy} onClick={() => void use()}><Icon name="check" size={15} /> {t("Usar como ícone da tropa")}</button>}
              <select className="pinput" style={{ width: 90 }} value={outSize} onChange={(e) => setOutSize(Number(e.target.value))} aria-label={t("Tamanho")}>{ICON_SIZES.map((s) => <option key={s} value={s}>{s} px</option>)}</select>
              <button className="btn sm" disabled={busy} onClick={() => void exportOne()}><Icon name="download" size={15} /> {t("Exportar PNG")}</button>
              <button className="btn sm" disabled={busy} onClick={() => void exportSet()} title={t("Salva {sizes} px numa pasta", { sizes: ICON_SIZES.join(", ") })}><Icon name="folder" size={15} /> {t("Exportar todos os tamanhos")}</button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

function R({ label, v, min, max, step = 0.01, on, pct, unit }: { label: string; v: number; min: number; max: number; step?: number; on: (v: number) => void; pct?: boolean; unit?: string }) {
  return (
    <label className="range"><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => on(Number(e.target.value))} />
      <output>{pct ? `${Math.round(v * 100)}%` : `${Math.round(v * 10) / 10}${unit ?? ""}`}</output>
    </label>
  );
}
