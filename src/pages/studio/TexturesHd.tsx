import { useEffect, useMemo, useState } from "react";
import { Compare, Empty, Field, Icon, Notice, TaskProgress } from "../../components/ui";
import { api } from "../../lib/api";
import { fmtBytes, load, useStore } from "../../lib/store";
import { hdOutdated } from "../../lib/hd";
import { locale, t } from "../../lib/i18n";
import type { EnhanceGroup, EnhanceMode, EnhanceOptions, EnhancePreview } from "../../lib/types";

const MODE_LABEL: Record<EnhanceMode, string> = { upscale: "Ampliar + nitidez", sharpen: "Só nitidez", skip: "Não mexer" };
const CLASS_LABEL: Record<EnhancePreview["class"], string> = {
  color: "Cor: ampliada e com nitidez",
  normal: "Mapa de normal: ampliado e renormalizado, sem nitidez",
  data: "Máscara: ampliada sem nitidez",
  skip: "Tabela de cor/fonte/cubemap: fica como está",
};
/** Bytes de um DDS (mesma conta do núcleo): blocos 4x4 de 8/16 bytes ou bytes por pixel. */
export function ddsBytes(w: number, h: number, format: string, mipmaps: boolean) {
  const block = format === "dxt1" || format === "ati1" ? 8 : format === "dxt3" || format === "dxt5" || format === "ati2" ? 16 : 0;
  const bpp = { bgra8: 4, bgrx8: 4, bgr8: 3, rgb565: 2, l8: 1 }[format] ?? 4;
  let total = 0;
  for (;;) {
    total += block ? Math.ceil(w / 4) * Math.ceil(h / 4) * block : w * h * bpp;
    if (!mipmaps || (w === 1 && h === 1)) return total;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
}

/** Mesma regra de `enhance::target_size`. */
export function targetSize(w: number, h: number, mode: EnhanceMode, scale: number, maxSize: number): [number, number] {
  if (mode !== "upscale") return [w, h];
  let tw = w * scale, th = h * scale;
  while ((tw > maxSize || th > maxSize) && tw > w && th > h) { tw = Math.floor(tw / 2); th = Math.floor(th / 2); }
  return tw <= w || th <= h ? [w, h] : [tw, th];
}

/** Quanto de textura a mais cabe, conforme a memória escolhida para o jogo (32 bits: 2 a 4 GB). */
export function textureBudget(limitMb: number) {
  const f = Math.max(0, Math.min(1, (limitMb - 2048) / 2048));
  return (0.25 + 0.95 * f) * 1024 ** 3;
}

function estimate(groups: EnhanceGroup[], modes: Record<string, EnhanceMode>, scale: number, maxSize: number) {
  let count = 0, upscaled = 0, before = 0, after = 0;
  for (const g of groups) {
    const m = modes[g.group] ?? g.suggested;
    if (m === "skip") continue;
    for (const b of g.buckets) {
      if (b.skip) continue;
      const [tw, th] = targetSize(b.width, b.height, b.keepSize && m === "upscale" ? "sharpen" : m, scale, maxSize);
      count += b.count;
      if (tw !== b.width) upscaled += b.count;
      before += b.count * ddsBytes(b.width, b.height, b.format, b.mipmaps);
      after += b.count * ddsBytes(tw, th, b.format, b.mipmaps);
    }
  }
  return { count, upscaled, before, after };
}

export default function TexturesHd() {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy.hd);
  const hdMod = useStore((s) => s.mods.find((m) => m.manifest.id === "texturas-hd"));
  const [groups, setGroups] = useState<EnhanceGroup[] | null>(null);
  const [modes, setModes] = useState<Record<string, EnhanceMode>>({});
  const [opts, setOpts] = useState<Omit<EnhanceOptions, "groups">>(() => ({ name: t("Texturas HD"), scale: 2, maxSize: 2048, sharpness: 0.6, deblock: 0.5, quality: "normal" }));
  const [sample, setSample] = useState<string | null>(null);
  const [preview, setPreview] = useState<EnhancePreview | null>(null);
  const [limitMb, setLimitMb] = useState(4096);
  useEffect(() => { api.memoryStatus().then((m) => setLimitMb(m.limitMb)).catch(() => {}); }, []);
  const budget = textureBudget(limitMb);

  useEffect(() => {
    let alive = true;
    void load(() => api.enhanceGroups()).then((g) => {
      if (!alive) return;
      setGroups(g ?? []);
      setModes(Object.fromEntries((g ?? []).map((x) => [x.group, x.suggested])));
      setSample(g?.find((x) => x.suggested === "upscale")?.sample[0] ?? g?.[0]?.sample[0] ?? null);
    });
    return () => { alive = false; };
  }, []);

  const full: EnhanceOptions = useMemo(() => ({ ...opts, groups: Object.entries(modes).map(([group, mode]) => ({ group, mode })) }), [opts, modes]);
  const sampleGroup = groups?.find((g) => g.sample.includes(sample ?? ""));
  const sampleMode = sampleGroup ? modes[sampleGroup.group] ?? sampleGroup.suggested : "upscale";

  useEffect(() => {
    if (!sample) return;
    const h = setTimeout(() => {
      api.enhancePreview(sample, sampleMode, full).then(setPreview).catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(h);
  }, [sample, sampleMode, full]);

  // conta exata a partir dos cabeçalhos: só texturas que entram no mod
  const totals = useMemo(() => estimate(groups ?? [], modes, opts.scale, opts.maxSize), [groups, modes, opts.scale, opts.maxSize]);

  /** Reduz o tamanho máximo (e, se preciso, a ampliação) até o acréscimo de memória ficar seguro. */
  const autoFit = () => {
    for (const scale of [opts.scale, 2]) {
      for (const max of [4096, 2048, 1024, 512]) {
        if (max > opts.maxSize || scale > opts.scale) continue;
        const t = estimate(groups ?? [], modes, scale, max);
        if (t.after - t.before <= budget) {
          setOpts((o) => ({ ...o, scale, maxSize: max }));
          return;
        }
      }
    }
    setOpts((o) => ({ ...o, scale: 2, maxSize: 512 }));
  };

  if (groups === null) return <div className="card pad"><div className="bar indeterminate"><i /></div></div>;
  if (!groups.length) return <div className="card"><Empty icon="image_not_supported" title={t("Nenhuma textura encontrada")}>{t("Configure a pasta do jogo em Configurações.")}</Empty></div>;

  const extra = totals.after - totals.before;
  const set = <K extends keyof typeof opts>(k: K, v: (typeof opts)[K]) => setOpts((o) => ({ ...o, [k]: v }));

  return (
    <div className="col" style={{ gap: 16 }}>
      {hdOutdated(hdMod?.manifest.version) && (
        <Notice kind="warn">
          {t("Suas Texturas HD foram geradas por uma versão antiga, que deixava alguns mapas verdes e os ícones de massa gigantes.")}
          {" "}{t("Clique em")} <b>{t("Gerar Texturas HD")}</b> {t("de novo para substituir.")}
        </Notice>
      )}
      <Notice kind="info">
        {t("Lê as texturas")} <b>{t("originais")}</b> {t("do seu jogo, aumenta a resolução e recupera nitidez, sem inventar detalhes falsos, e gera um mod que você liga e desliga na biblioteca.")}
        {" "}{t("É só visual:")} <b>{t("não dessincroniza o multiplayer")}</b>. {t("Ícones, marcadores e a interface nunca são ampliados (o jogo desenha no tamanho da própria textura), e tabelas de cor e iluminação dos mapas ficam intactas.")}
      </Notice>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(340px, 440px) 1fr", alignItems: "start" }}>
        <section className="card pad col">
          <Field label={t("Nome do mod")}><input className="input" value={opts.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label={t("Ampliação")}>
              <div className="seg" role="group" aria-label={t("Ampliação")}>
                {[2, 4].map((s) => <button key={s} className="btn" aria-pressed={opts.scale === s} onClick={() => set("scale", s)}>{s}x</button>)}
              </div>
            </Field>
            <Field label={t("Tamanho máximo")}>
              <select className="select" value={opts.maxSize} onChange={(e) => set("maxSize", Number(e.target.value))}>
                {[512, 1024, 2048, 4096].map((s) => <option key={s} value={s}>{s} px</option>)}
              </select>
            </Field>
          </div>
          <label className="range" style={{ gridTemplateColumns: "110px 1fr 44px" }}><span>{t("Nitidez")}</span><input type="range" min={0} max={1.5} step={0.05} value={opts.sharpness} onChange={(e) => set("sharpness", Number(e.target.value))} /><output>{Math.round(opts.sharpness * 100)}%</output></label>
          <label className="range" style={{ gridTemplateColumns: "110px 1fr 44px" }}><span>{t("Tirar blocos DXT")}</span><input type="range" min={0} max={1} step={0.05} value={opts.deblock} onChange={(e) => set("deblock", Number(e.target.value))} /><output>{Math.round(opts.deblock * 100)}%</output></label>
          <Field label={t("Qualidade da compressão")} hint={t("Normal: melhor resultado. Rápida: cerca de 10x mais rápida, com um pouco mais de artefatos.")}>
            <div className="seg" role="group" aria-label={t("Qualidade")}>
              {(["fast", "normal", "best"] as const).map((q) => <button key={q} className="btn" aria-pressed={opts.quality === q} onClick={() => set("quality", q)}>{q === "fast" ? t("Rápida") : q === "normal" ? t("Normal") : t("Máxima")}</button>)}
            </div>
          </Field>

          <div className="overline" style={{ marginTop: 6 }}>{t("Pastas do jogo")}</div>
          <div className="hd-groups">
            {groups.map((g) => {
              const m = modes[g.group] ?? g.suggested;
              return (
                <div key={g.group} className="hd-group">
                  <button className="txt" onClick={() => setSample(g.sample[0] ?? null)} title={t("Ver prévia desta pasta")}>
                    <b className="mono">{g.group}</b>
                    <span className="faint small">{t("{n} texturas, {size}", { n: g.textures.toLocaleString(locale()), size: fmtBytes(g.bytes) })}</span>
                  </button>
                  <select className="select dense" value={m} onChange={(e) => setModes((x) => ({ ...x, [g.group]: e.target.value as EnhanceMode }))} aria-label={t("Modo para {name}", { name: g.group })}>
                    {(Object.keys(MODE_LABEL) as EnhanceMode[]).map((k) => <option key={k} value={k}>{t(MODE_LABEL[k])}</option>)}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="hd-total">
            <span><b>{totals.count.toLocaleString(locale())}</b> {t("texturas, {n} ampliadas", { n: totals.upscaled.toLocaleString(locale()) })}</span>
            <span title={t("Memória de vídeo das texturas alteradas")}>{fmtBytes(totals.before)} → <b>{fmtBytes(totals.after)}</b></span>
          </div>
          <p className="faint small">
            {t("Memória do jogo: até {gb} GB, então cabem uns {size} a mais de texturas", { gb: (limitMb / 1024).toLocaleString(locale()), size: fmtBytes(budget) })}
            {" "}({extra > 0 ? t("{pct}% usado", { pct: Math.round((extra / budget) * 100) }) : t("nada usado")}).
          </p>
          {extra > budget && (
            <Notice kind="warn">
              {t("Isso soma uns {size} de texturas, mais do que cabe com o jogo em até {gb} GB: ele pode fechar por falta de memória. Aumente a memória do jogo em Configurações ou ajuste para caber.", { size: fmtBytes(extra), gb: (limitMb / 1024).toLocaleString(locale()) })}
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn sm" onClick={autoFit}><Icon name="tune" /> {t("Ajustar para caber")}</button>
                <button className="btn sm text" onClick={() => useStore.getState().openSettings("jogo")}><Icon name="memory" /> {t("Memória do jogo")}</button>
              </div>
            </Notice>
          )}
          {busy ? <TaskProgress task="hd" label={t("Preparando…")} /> : (
            <button className="btn primary" disabled={!totals.count || !opts.name.trim()} onClick={async () => {
              const m = await run("hd", () => api.buildEnhance(full, true), (mm) => t('"{name}" gerado e ativado na biblioteca.', { name: mm.name }));
              if (m) await refreshMods();
            }}><Icon name="hd" /> {t("Gerar Texturas HD")}</button>
          )}
          <p className="faint small">{t("Pode levar de alguns minutos a meia hora, conforme o PC e as pastas escolhidas. Os arquivos originais do jogo não são alterados.")}</p>
        </section>

        <section className="card pad col">
          <div className="section-title">
            <h2>{t("Prévia")}</h2>
            <select className="select" style={{ maxWidth: 380 }} value={sample ?? ""} onChange={(e) => setSample(e.target.value)} aria-label={t("Textura de exemplo")}>
              {groups.flatMap((g) => g.sample).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          {preview ? (
            <>
              <Compare before={preview.before} after={preview.after} beforeLabel={t("Original")} afterLabel={t("Texturas HD")} pixelated ratio={`${preview.width} / ${preview.height}`} />
              <div className="chips">
                <span className="chip">{preview.info.width}×{preview.info.height} {preview.info.format.toUpperCase()}</span>
                <Icon name="arrow_forward" size={16} />
                <span className="chip ok">{preview.width}×{preview.height}</span>
                <span className="chip info">{t(CLASS_LABEL[preview.class])}</span>
              </div>
              <p className="faint small">{t("Arraste a divisória. O lado original foi ampliado sem filtro, para comparar no mesmo tamanho.")}</p>
            </>
          ) : <div className="bar indeterminate"><i /></div>}
        </section>
      </div>
    </div>
  );
}
