import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Icon, Modal } from "../components/ui";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { LaaStatus, ShaderStatus, Showcase } from "../lib/types";
import { hdOutdated } from "../lib/hd";

const Showcase3D = lazy(() => import("../components/Showcase3D"));

const FACTION: Record<string, string> = { u: "UEF", c: "Cybran", i: "Illuminate" };
const KIND: Record<string, string> = { l: "terrestre", a: "aérea", s: "naval", b: "estrutura", x: "experimental" };

/** Nome legível a partir do id da unidade (ex.: uul0001 → "UEF · Comandante (ACU)"). */
export function unitLabel(id: string) {
  const faction = FACTION[id[1]] ?? "Unidade";
  if (/0001$/.test(id)) return `${faction} · Comandante (ACU)`;
  const kind = KIND[id[2]];
  return `${faction} · ${kind ? `${kind} ` : ""}${id.toUpperCase()}`;
}

// a vitrine fica em memória entre visitas à tela inicial
let cached: { key: string; data: Showcase | null } | null = null;

/** Modelo 3D girando no lado direito da tela inicial. */
export function HomeShowcase() {
  const settings = useStore((s) => s.settings);
  const { run, refresh } = useStore.getState();
  const [data, setData] = useState<Showcase | null | undefined>(cached?.data);
  const [paused, setPaused] = useState(false);
  const [picker, setPicker] = useState(false);
  const key = settings?.showcaseUnit ?? "";

  useEffect(() => {
    if (cached && cached.key === key) {
      setData(cached.data);
      return;
    }
    api.showcase(settings?.showcaseUnit).then((d) => {
      cached = { key, data: d };
      setData(d);
    }).catch(() => setData(null));
  }, [key, settings?.showcaseUnit]);

  const model = useMemo(() => (data ? { mesh: data.mesh, albedo: data.albedo } : null), [data]);
  if (!settings?.showcase || data === undefined) return null;

  const choose = async (unit: string | null) => {
    if (!settings) return;
    setPicker(false);
    cached = null;
    await run("showcase-unit", () => api.saveSettings({ ...settings, showcaseUnit: unit }), unit ? `Carregando ${unitLabel(unit)}…` : "Voltando ao Comandante…");
    await refresh();
  };

  return (
    <div className="home-stage">
      <div className="stage-glow" />
      <Suspense fallback={null}>
        <Showcase3D model={model} paused={paused} />
      </Suspense>
      <div className="showcase-label">
        <div className="col" style={{ gap: 0 }}>
          <span className="overline">{data ? "Do seu jogo" : "Modelo de demonstração"}</span>
          <b>{data ? unitLabel(data.unit) : "Robô CommandProject"}</b>
        </div>
        <button className="btn icon-btn sm-icon" title={paused ? "Girar" : "Pausar"} aria-label={paused ? "Girar" : "Pausar"} onClick={() => setPaused((p) => !p)}><Icon name={paused ? "play_arrow" : "pause"} /></button>
        {data && <button className="btn icon-btn sm-icon" title="Trocar unidade" aria-label="Trocar unidade" onClick={() => setPicker(true)}><Icon name="swap_horiz" /></button>}
        <button className="btn icon-btn sm-icon" title="Esconder o modelo" aria-label="Esconder o modelo" onClick={async () => {
          await run("settings", () => api.saveSettings({ ...settings, showcase: false }), "Modelo escondido. Dá para mostrar de novo em Configurações.");
          await refresh();
        }}><Icon name="visibility_off" /></button>
      </div>
      {picker && data && <UnitPicker units={data.units} current={data.unit} onPick={choose} onClose={() => setPicker(false)} />}
    </div>
  );
}

function UnitPicker({ units, current, onPick, onClose }: { units: string[]; current: string; onPick: (u: string | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [faction, setFaction] = useState<string>("all");
  const list = units.filter((u) => (faction === "all" || u[1] === faction) && (u.includes(q.toLowerCase()) || unitLabel(u).toLowerCase().includes(q.toLowerCase())));
  return (
    <Modal title="Unidade da tela inicial" icon="smart_toy" onClose={onClose} wide>
      <div className="col" style={{ gap: 12 }}>
        <div className="row wrap">
          <div className="search-bar" style={{ flex: 1, minWidth: 220 }}>
            <Icon name="search" />
            <input className="input dense" autoFocus placeholder="Buscar: acu, uul0101, experimental…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar unidade" />
          </div>
          <div className="seg" role="group" aria-label="Facção">
            {[["all", "Todas"], ["u", "UEF"], ["c", "Cybran"], ["i", "Illuminate"]].map(([k, v]) => <button key={k} className="btn" aria-pressed={faction === k} onClick={() => setFaction(k)}>{v}</button>)}
          </div>
        </div>
        <div className="unit-grid">
          {list.slice(0, 400).map((u) => (
            <button key={u} className="unit-tile" aria-pressed={u === current} onClick={() => onPick(u)}>
              <Icon name={/0001$/.test(u) ? "military_tech" : u[2] === "a" ? "flight" : u[2] === "s" ? "sailing" : u[2] === "b" ? "domain" : "smart_toy"} />
              <span>{unitLabel(u)}</span>
            </button>
          ))}
          {list.length === 0 && <p className="faint">Nenhuma unidade com esse nome.</p>}
        </div>
        <footer>
          <button className="btn text" onClick={() => onPick(null)}><Icon name="restart_alt" /> Voltar ao Comandante</button>
        </footer>
      </div>
    </Modal>
  );
}

/** Estado dos aprimoramentos visuais e de memória, com atalhos. */
export function EnhancementsCard() {
  const mods = useStore((s) => s.mods);
  const { go, setStudioTab } = useStore.getState();
  const [shaders, setShaders] = useState<ShaderStatus | null>(null);
  const [laa, setLaa] = useState<LaaStatus | null>(null);
  useEffect(() => {
    api.shadersStatus().then(setShaders).catch(() => setShaders(null));
    api.laaStatus().then(setLaa).catch(() => setLaa(null));
  }, []);
  const hd = mods.find((m) => m.manifest.id === "texturas-hd");
  const theme = mods.find((m) => m.manifest.id === "menu-moderno");
  const shaderName = shaders?.packInstalled && shaders.preset ? shaders.presets.find((p) => p.id === shaders.preset)?.name : null;
  const items = [
    {
      icon: "auto_awesome", title: "Shaders", on: !!shaderName,
      value: shaderName ?? (shaders?.packInstalled ? "Desligados" : "Não instalados"),
      action: () => go("library"),
    },
    {
      icon: "hd", title: "Texturas HD", on: !!hd?.enabled,
      value: hd ? (hdOutdated(hd.manifest.version) ? "Gerar de novo" : hd.enabled ? "Ativas" : "Desligadas") : "Gerar no Estúdio",
      action: () => { if (hd && !hdOutdated(hd.manifest.version)) go("library"); else { setStudioTab("hd"); go("studio"); } },
    },
    {
      icon: "format_paint", title: "Menu do jogo", on: !!theme?.enabled,
      value: theme ? (theme.enabled ? "Moderno" : "Original") : "Repaginar",
      action: () => go("library"),
    },
    {
      icon: "memory", title: "Memória", on: !!laa?.enabled,
      value: laa ? (laa.enabled ? "Até 4 GB" : "Até 2 GB") : "—",
      action: () => useStore.getState().openSettings("jogo"),
    },
  ];
  return (
    <section className="card pad enh-card">
      <div className="card-title"><Icon name="rocket_launch" style={{ color: "var(--primary)" }} /><h3>Aprimoramentos</h3></div>
      <div className="enh-grid">
        {items.map((i) => (
          <button key={i.title} className={`enh ${i.on ? "on" : ""}`} onClick={i.action}>
            <span className="enh-icon"><Icon name={i.icon} /></span>
            <span className="overline">{i.title}</span>
            <b>{i.value}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
