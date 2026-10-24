import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { ThemeOptions, ThemePreview } from "../lib/types";
import { Icon, Notice, Switch, TaskProgress } from "./ui";

/** Versão do gerador do tema no núcleo (`menu_theme::THEME_VERSION`). */
export const THEME_VERSION = "2.0.0";

const DEFAULTS: ThemeOptions = { name: "Menu moderno", recolor: true, fonts: false, accent: "#a3e635", hover: "", bgDarkness: 0.55, bgTint: 0.12, panelOpacity: 1, glow: 0.3, sharpness: 0.5, deblock: 0.5 };

/** Estilos prontos: um clique e ajusta tudo; depois dá para mexer em cada controle. */
const PRESETS: { id: string; name: string; opts: Partial<ThemeOptions> }[] = [
  { id: "launcher", name: "Launcher", opts: { recolor: true, accent: "#a3e635", hover: "", bgDarkness: 0.55, bgTint: 0.12, panelOpacity: 1, glow: 0.3 } },
  { id: "neon", name: "Neon", opts: { recolor: true, accent: "#38bdf8", hover: "#e879f9", bgDarkness: 0.8, bgTint: 0.35, panelOpacity: 0.85, glow: 0.8 } },
  { id: "carmesim", name: "Carmesim", opts: { recolor: true, accent: "#e5534b", hover: "#f2b33d", bgDarkness: 0.7, bgTint: 0.2, panelOpacity: 1, glow: 0.5 } },
  { id: "grafite", name: "Grafite", opts: { recolor: true, accent: "#d8dde3", hover: "#a3e635", bgDarkness: 0.75, bgTint: 0, panelOpacity: 0.9, glow: 0.2 } },
  { id: "vidro", name: "Vidro", opts: { recolor: true, accent: "#7dd3fc", hover: "#ffffff", bgDarkness: 0.35, bgTint: 0.25, panelOpacity: 0.55, glow: 0.4 } },
  { id: "original", name: "Original + nitidez", opts: { recolor: false, fonts: false } },
];

const ACCENTS = [
  { id: "#a3e635", name: "Verde-limão (launcher)" },
  { id: "#38bdf8", name: "Ciano" },
  { id: "#f59e0b", name: "Âmbar" },
  { id: "#e5534b", name: "Vermelho" },
  { id: "#c084fc", name: "Lilás" },
];

const BUTTONS = ["CAMPAIGN", "SKIRMISH", "MULTIPLAYER", "OPTIONS", "EXTRAS", "QUIT"];

/** Menu principal do jogo remontado na interface com as texturas de verdade (antes ou depois). */
function MenuMock({ tex, side }: { tex: Record<string, ThemePreview>; side: "before" | "after" }) {
  const src = (k: string) => tex[k]?.[side];
  return (
    <div className={`menu-mock ${side === "after" ? "modern" : "original"}`} aria-label={side === "after" ? "Menu moderno" : "Menu original"} role="img">
      {src("blue_overlay.dds") && <img className="mm-bg" src={src("blue_overlay.dds")} alt="" />}
      {src("top_blue_grad.dds") && <img className="mm-top" src={src("top_blue_grad.dds")} alt="" />}
      {src("mainmenu/sc_logo.dds") && <img className="mm-logo" src={src("mainmenu/sc_logo.dds")} alt="" />}
      <div className="mm-tag">{src("mainmenu/gamertag_bg.dds") && <img src={src("mainmenu/gamertag_bg.dds")} alt="" />}riquebitt</div>
      {src("line03.dds") && <img className="mm-line" src={src("line03.dds")} alt="" />}
      <div className="mm-btns">
        {BUTTONS.map((b, i) => (
          <div key={b} className="mm-btn">
            {src(i === 1 ? "mainmenu/btn_o.dds" : "mainmenu/btn_u.dds") && <img src={src(i === 1 ? "mainmenu/btn_o.dds" : "mainmenu/btn_u.dds")} alt="" />}
            {b}
          </div>
        ))}
      </div>
      <span className="mm-label">{side === "after" ? "Moderno" : "Original"}</span>
    </div>
  );
}

export default function MenuThemeCard() {
  const { run, refresh } = useStore.getState();
  const busy = useStore((s) => s.busy.theme);
  const mod = useStore((s) => s.mods.find((m) => m.manifest.id === "menu-moderno"));
  const [opts, setOpts] = useState<ThemeOptions>(() => {
    try {
      const saved = localStorage.getItem("cp.menuTheme");
      return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : DEFAULTS;
    } catch {
      return DEFAULTS;
    }
  });
  useEffect(() => {
    try { localStorage.setItem("cp.menuTheme", JSON.stringify(opts)); } catch { /* só não lembra as escolhas */ }
  }, [opts]);
  const preset = PRESETS.find((p) => Object.entries(p.opts).every(([k, v]) => opts[k as keyof ThemeOptions] === v))?.id;
  const [preview, setPreview] = useState<ThemePreview[] | null | undefined>(undefined);
  const [side, setSide] = useState<"before" | "after">("after");

  useEffect(() => {
    const h = setTimeout(() => {
      api.menuThemePreview(opts).then(setPreview).catch(() => setPreview(null));
    }, 200);
    return () => clearTimeout(h);
  }, [opts]);

  const tex = useMemo(() => Object.fromEntries((preview ?? []).map((p) => [p.key, p])), [preview]);
  const set = <K extends keyof ThemeOptions>(k: K, v: ThemeOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const outdated = !!mod && mod.manifest.version !== THEME_VERSION;

  const build = async () => {
    const m = await run("theme", () => api.buildMenuTheme(opts, true), (x) => `"${x.name}" gerado e ligado. Aparece na próxima vez que abrir o jogo.`);
    if (m) await refresh();
  };

  return (
    <section className="card shaders-card" aria-labelledby="theme-title">
      <div className="shaders-media">
        {preview ? <MenuMock tex={tex} side={side} /> : (
          <div className="menu-mock" style={{ display: "grid", placeItems: "center" }}>
            {preview === undefined ? <div className="bar indeterminate" style={{ width: "60%" }}><i /></div> : <span className="faint small">Prévia indisponível: configure a pasta do jogo.</span>}
          </div>
        )}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="seg" role="group" aria-label="Comparar">
            <button className="btn" aria-pressed={side === "before"} onClick={() => setSide("before")}>Original</button>
            <button className="btn" aria-pressed={side === "after"} onClick={() => setSide("after")}>Moderno</button>
          </div>
          <span className="faint small">Montado com as texturas do seu jogo.</span>
        </div>
      </div>
      <div className="shaders-body">
        <div>
          <div className="overline">Mod do CommandProject</div>
          <h2 id="theme-title" className="shaders-title">Menu moderno</h2>
        </div>
        <p className="muted">
          Repagina os menus do jogo (menu principal, opções, escaramuça, salas e resumo da partida) no estilo do launcher:
          cores novas, fonte <b>Roboto</b> e imagens com mais nitidez. É gerado no seu computador a partir dos arquivos do jogo e
          <b> não afeta o multiplayer</b>.
        </p>
        <div className="chips">
          {mod ? (
            <>
              <span className={`chip ${mod.enabled ? "ok" : ""}`}><Icon name={mod.enabled ? "check" : "toggle_off"} /> {mod.enabled ? "Ligado" : "Desligado"}</span>
              {outdated && <span className="chip warn">Versão nova do tema</span>}
            </>
          ) : <span className="chip">Ainda não gerado</span>}
        </div>

        <div className="theme-presets" role="radiogroup" aria-label="Estilo pronto">
          {PRESETS.map((p) => (
            <button key={p.id} role="radio" aria-checked={preset === p.id} className="theme-preset" onClick={() => setOpts((o) => ({ ...o, ...p.opts }))}>
              <span className="sw" style={{ background: p.opts.recolor === false ? "linear-gradient(135deg,#2f6fd6,#e08a2a)" : `linear-gradient(135deg, ${p.opts.accent}, ${p.opts.hover || p.opts.accent})` }} />
              {p.name}
            </button>
          ))}
        </div>

        <div className="setting-row">
          <div className="txt"><b>Cores do tema</b><span className="muted small">Troca o azul e o laranja dos botões pelas cores escolhidas e ajusta os fundos. Cores de facção e de time ficam como estão.</span></div>
          <Switch checked={opts.recolor} onChange={(v) => set("recolor", v)} label="Cores do tema" />
        </div>
        {opts.recolor && (
          <div className="theme-grid">
            <div className="theme-color">
              <span className="small muted">Destaque</span>
              <div className="accent-swatches" role="group" aria-label="Cor de destaque">
                {ACCENTS.map((a) => <button key={a.id} className="accent-swatch" style={{ background: a.id }} aria-pressed={opts.accent === a.id} title={a.name} aria-label={a.name} onClick={() => set("accent", a.id)} />)}
                <input type="color" value={opts.accent} onChange={(e) => set("accent", e.target.value)} aria-label="Outra cor de destaque" title="Outra cor" />
              </div>
            </div>
            <div className="theme-color">
              <span className="small muted">Mouse em cima / selecionado</span>
              <div className="accent-swatches" role="group" aria-label="Cor ao passar o mouse">
                <button className={`btn sm ${opts.hover ? "text" : "tonal"}`} onClick={() => set("hover", "")}>Igual</button>
                {ACCENTS.map((a) => <button key={a.id} className="accent-swatch" style={{ background: a.id }} aria-pressed={opts.hover === a.id} title={a.name} aria-label={`${a.name} ao passar o mouse`} onClick={() => set("hover", a.id)} />)}
                <input type="color" value={opts.hover || opts.accent} onChange={(e) => set("hover", e.target.value)} aria-label="Outra cor ao passar o mouse" title="Outra cor" />
              </div>
            </div>
            <label className="range" style={{ gridTemplateColumns: "130px 1fr 44px" }}><span>Escurecer fundos</span><input type="range" min={0} max={1} step={0.05} value={opts.bgDarkness} onChange={(e) => set("bgDarkness", Number(e.target.value))} /><output>{Math.round(opts.bgDarkness * 100)}%</output></label>
            <label className="range" style={{ gridTemplateColumns: "130px 1fr 44px" }}><span>Cor nos fundos</span><input type="range" min={0} max={1} step={0.05} value={opts.bgTint} onChange={(e) => set("bgTint", Number(e.target.value))} /><output>{Math.round(opts.bgTint * 100)}%</output></label>
            <label className="range" style={{ gridTemplateColumns: "130px 1fr 44px" }}><span>Painéis opacos</span><input type="range" min={0.4} max={1} step={0.05} value={opts.panelOpacity} onChange={(e) => set("panelOpacity", Number(e.target.value))} /><output>{Math.round(opts.panelOpacity * 100)}%</output></label>
            <label className="range" style={{ gridTemplateColumns: "130px 1fr 44px" }}><span>Brilho dos botões</span><input type="range" min={0} max={1} step={0.05} value={opts.glow} onChange={(e) => set("glow", Number(e.target.value))} /><output>{Math.round(opts.glow * 100)}%</output></label>
          </div>
        )}
        <label className="range" style={{ gridTemplateColumns: "130px 1fr 44px" }}><span>Nitidez</span><input type="range" min={0} max={1.2} step={0.05} value={opts.sharpness} onChange={(e) => set("sharpness", Number(e.target.value))} /><output>{Math.round(opts.sharpness * 100)}%</output></label>
        <div className="setting-row">
          <div className="txt">
            <b>Fonte Roboto <span className="chip warn" style={{ marginLeft: 6 }}>experimental</span></b>
            <span className="muted small">Troca a fonte dos títulos e botões pela do launcher. A primeira versão fazia o jogo fechar ao abrir; esta foi refeita no formato das fontes originais. Se o jogo não abrir, gere de novo com isto desligado.</span>
          </div>
          <Switch checked={opts.fonts} onChange={(v) => set("fonts", v)} label="Fonte Roboto" />
        </div>

        {outdated && <Notice kind="info">Saiu uma versão nova do tema. Gere de novo para atualizar.</Notice>}
        {busy ? <TaskProgress task="theme" label="Preparando o tema…" /> : (
          <div className="row wrap">
            <button className="btn primary" onClick={build} disabled={!opts.recolor && !opts.fonts && opts.sharpness <= 0}>
              <Icon name="format_paint" /> {mod ? "Gerar de novo" : "Gerar e ligar"}
            </button>
            <span className="faint small">Leva alguns segundos. Para voltar ao visual original, desligue o mod na lista abaixo.</span>
          </div>
        )}
      </div>
    </section>
  );
}
