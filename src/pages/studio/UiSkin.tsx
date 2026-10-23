import { Paintbrush } from "lucide-react";
import { useEffect, useState } from "react";
import { Field, Notice, TaskProgress } from "../../components/ui";
import { api } from "../../lib/api";
import { useStore } from "../../lib/store";
import type { ColorAdjust, TextureView, UiSkinOptions } from "../../lib/types";
import { ColorSliders, IDENTITY } from "./adjust";

const PRESETS: { name: string; adjust: ColorAdjust }[] = [
  { name: "Safira", adjust: { ...IDENTITY, hue: 18, saturation: 1.15, brightness: 1.02 } },
  { name: "Cybran", adjust: { ...IDENTITY, tint: [229, 83, 75], tintStrength: 0.6, contrast: 1.1 } },
  { name: "Illuminate", adjust: { ...IDENTITY, hue: 95, saturation: 1.1 } },
  { name: "Grafite", adjust: { ...IDENTITY, saturation: 0.15, contrast: 1.15, brightness: 0.95 } },
];

export default function UiSkin() {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy.skin);
  const [opts, setOpts] = useState<UiSkinOptions>({ name: "Minha skin", adjust: PRESETS[0].adjust, prefixes: ["/textures/ui/"], exclude: [], quality: "normal" });
  const [targets, setTargets] = useState<{ count: number; sample: string[] } | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [before, setBefore] = useState<TextureView | null>(null);
  const [after, setAfter] = useState<TextureView | null>(null);

  // texturas afetadas (recalcula quando os caminhos mudam)
  const prefixKey = opts.prefixes.join("|") + "#" + opts.exclude.join("|");
  useEffect(() => {
    const h = setTimeout(async () => {
      const t = await run("skintargets", () => api.uiSkinTargets(opts));
      setTargets(t ?? null);
      setSample((s) => (s && t?.sample.includes(s) ? s : t?.sample.find((x) => /button|panel|bg/i.test(x)) ?? t?.sample[0] ?? null));
    }, 300);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefixKey]);

  useEffect(() => {
    if (!sample) return;
    api.uiSkinPreview(sample, IDENTITY).then(setBefore).catch(() => setBefore(null));
  }, [sample]);
  useEffect(() => {
    if (!sample) return;
    const h = setTimeout(() => api.uiSkinPreview(sample, opts.adjust).then(setAfter).catch(() => setAfter(null)), 150);
    return () => clearTimeout(h);
  }, [sample, opts.adjust]);

  const list = (v: string) => v.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);

  return (
    <div className="grid-2" style={{ gridTemplateColumns: "minmax(320px, 420px) 1fr", alignItems: "start" }}>
      <section className="panel pad col">
        <h2>Recolorir a interface inteira</h2>
        <p className="muted small">
          Gera um mod só com as texturas alteradas, a partir dos arquivos originais do jogo. É visual: não interfere em partidas multiplayer.
        </p>
        <div className="chips">
          {PRESETS.map((p) => (
            <button key={p.name} className="chip" aria-pressed={JSON.stringify(opts.adjust) === JSON.stringify(p.adjust)} onClick={() => setOpts({ ...opts, adjust: p.adjust, name: p.name })}>{p.name}</button>
          ))}
        </div>
        <ColorSliders value={opts.adjust} onChange={(adjust) => setOpts({ ...opts, adjust })} />
        <Field label="Nome da skin"><input className="input" value={opts.name} onChange={(e) => setOpts({ ...opts, name: e.target.value })} /></Field>
        <Field label="Pastas incluídas" hint="Uma por linha. O padrão cobre toda a interface.">
          <textarea className="textarea mono" rows={2} value={opts.prefixes.join("\n")} onChange={(e) => setOpts({ ...opts, prefixes: list(e.target.value) })} />
        </Field>
        <Field label="Pastas ignoradas" hint="Ex.: ícones de unidade, para manter as cores das facções.">
          <textarea className="textarea mono" rows={2} value={opts.exclude.join("\n")} placeholder="/textures/ui/common/icons/" onChange={(e) => setOpts({ ...opts, exclude: list(e.target.value) })} />
        </Field>
        <Field label="Qualidade da compressão">
          <select className="select" value={opts.quality} onChange={(e) => setOpts({ ...opts, quality: e.target.value as UiSkinOptions["quality"] })}>
            <option value="fast">Rápida</option>
            <option value="normal">Normal</option>
            <option value="best">Máxima (demora mais)</option>
          </select>
        </Field>
        {busy ? <TaskProgress task="skin" label="Recolorindo texturas…" /> : (
          <button className="btn primary" disabled={!targets?.count || !opts.name.trim()} onClick={async () => {
            await run("skin", () => api.buildUiSkin(opts, true), (m) => `"${m.name}" criada e ativada na biblioteca.`);
            await refreshMods();
          }}><Paintbrush size={16} /> Gerar skin ({targets?.count.toLocaleString("pt-BR") ?? "…"} texturas)</button>
        )}
      </section>

      <section className="panel pad col">
        <div className="section-title">
          <h2>Prévia</h2>
          {targets && targets.sample.length > 0 && (
            <select className="select" style={{ maxWidth: 380 }} value={sample ?? ""} onChange={(e) => setSample(e.target.value)} aria-label="Textura de exemplo">
              {targets.sample.map((s) => <option key={s} value={s}>{s.replace(/^textures\/ui\//i, "")}</option>)}
            </select>
          )}
        </div>
        {targets && targets.count === 0 && <Notice kind="warn">Nenhuma textura encontrada nessas pastas.</Notice>}
        <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <figure style={{ margin: 0 }}>
            <div className="tex-stage checker" style={{ minHeight: 280 }}>{before && <img src={before.png} alt="Original" />}</div>
            <figcaption className="muted small" style={{ marginTop: 6 }}>Original</figcaption>
          </figure>
          <figure style={{ margin: 0 }}>
            <div className="tex-stage checker" style={{ minHeight: 280 }}>{after && <img src={after.png} alt="Com a skin" />}</div>
            <figcaption className="muted small" style={{ marginTop: 6 }}>Com a skin</figcaption>
          </figure>
        </div>
      </section>
    </div>
  );
}
