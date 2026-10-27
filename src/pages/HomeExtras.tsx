import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Icon, Modal } from "../components/ui";
import { api } from "../lib/api";
import { useStore } from "../lib/store";
import type { LaaStatus, ShaderStatus, Showcase } from "../lib/types";
import { hdOutdated } from "../lib/hd";
import { t } from "../lib/i18n";

const Showcase3D = lazy(() => import("../components/Showcase3D"));

const FACTION: Record<string, string> = { u: "UEF", c: "Cybran", i: "Illuminate" };
const KIND: Record<string, string> = { l: "terrestre", a: "aérea", s: "naval", b: "estrutura", x: "experimental" };

/** Nome legível a partir do id da unidade (ex.: uul0001 → "UEF · Comandante (ACU)"). */
export function unitLabel(id: string) {
  const faction = FACTION[id[1]] ?? t("Unidade");
  if (/0001$/.test(id)) return `${faction} · ${t("Comandante (ACU)")}`;
  const kind = KIND[id[2]];
  return `${faction} · ${kind ? `${t(kind)} ` : ""}${id.toUpperCase()}`;
}

/** Cor do time padrão de cada facção (como nas partidas). */
const FACTION_COLOR: Record<string, string> = { u: "#2f6fd6", c: "#c8352b", i: "#d9a227" };
const TEAM_COLORS = ["#2f6fd6", "#c8352b", "#3fa34d", "#d9a227", "#e67a22", "#8e4fd1", "#2bb5c9", "#d8dde3"];

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

  const model = useMemo(() => (data ? { mesh: data.mesh, albedo: data.albedo, team: data.team, mask: data.mask } : null), [data]);
  const [colors, setColors] = useState(false);
  const teamColor = settings?.showcaseTeamColor ?? (data ? FACTION_COLOR[data.unit[1]] : undefined) ?? FACTION_COLOR.u;
  if (!settings?.showcase || data === undefined) return null;

  const pickColor = async (c: string | null) => {
    setColors(false);
    await run("showcase-color", () => api.saveSettings({ ...settings, showcaseTeamColor: c }));
    await refresh();
  };

  const choose = async (unit: string | null) => {
    if (!settings) return;
    setPicker(false);
    cached = null;
    await run("showcase-unit", () => api.saveSettings({ ...settings, showcaseUnit: unit }), unit ? t("Carregando {name}…", { name: unitLabel(unit) }) : t("Voltando ao Comandante…"));
    await refresh();
  };

  return (
    <div className="home-stage">
      <div className="stage-glow" />
      <Suspense fallback={null}>
        <Showcase3D model={model} paused={paused} teamColor={teamColor} />
      </Suspense>
      <div className="showcase-label">
        <div className="col" style={{ gap: 0 }}>
          <span className="overline">{data ? t("Do seu jogo") : t("Modelo de demonstração")}</span>
          <b>{data ? unitLabel(data.unit) : t("Robô CommandProject")}</b>
        </div>
        <button className="btn icon-btn sm-icon" title={paused ? t("Girar", undefined, "vitrine") : t("Pausar")} aria-label={paused ? t("Girar", undefined, "vitrine") : t("Pausar")} onClick={() => setPaused((p) => !p)}><Icon name={paused ? "play_arrow" : "pause"} /></button>
        {data && <button className="btn icon-btn sm-icon" title={t("Trocar unidade")} aria-label={t("Trocar unidade")} onClick={() => setPicker(true)}><Icon name="swap_horiz" /></button>}
        {data?.team && (
          <button className="btn icon-btn sm-icon" title={t("Cor do time")} aria-label={t("Cor do time")} aria-expanded={colors} onClick={() => setColors((c) => !c)}>
            <span className="team-dot" style={{ background: teamColor }} />
          </button>
        )}
        <button className="btn icon-btn sm-icon" title={t("Esconder o modelo")} aria-label={t("Esconder o modelo")} onClick={async () => {
          await run("settings", () => api.saveSettings({ ...settings, showcase: false }), t("Modelo escondido. Dá para mostrar de novo em Configurações."));
          await refresh();
        }}><Icon name="visibility_off" /></button>
      </div>
      {colors && (
        <div className="team-colors" role="group" aria-label={t("Cor do time")}>
          {TEAM_COLORS.map((c) => <button key={c} className="accent-swatch" style={{ background: c }} aria-pressed={teamColor === c} aria-label={t("Cor {color}", { color: c })} onClick={() => void pickColor(c)} />)}
          <input type="color" value={teamColor} onChange={(e) => void pickColor(e.target.value)} aria-label={t("Outra cor")} title={t("Outra cor")} />
          <button className="btn text sm" onClick={() => void pickColor(null)}>{t("Cor da facção")}</button>
        </div>
      )}
      {picker && data && <UnitPicker units={data.units} current={data.unit} onPick={choose} onClose={() => setPicker(false)} />}
    </div>
  );
}

function UnitPicker({ units, current, onPick, onClose }: { units: string[]; current: string; onPick: (u: string | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [faction, setFaction] = useState<string>("all");
  const list = units.filter((u) => (faction === "all" || u[1] === faction) && (u.includes(q.toLowerCase()) || unitLabel(u).toLowerCase().includes(q.toLowerCase())));
  return (
    <Modal title={t("Unidade da tela inicial")} icon="smart_toy" onClose={onClose} wide>
      <div className="col" style={{ gap: 12 }}>
        <div className="row wrap">
          <div className="search-bar" style={{ flex: 1, minWidth: 220 }}>
            <Icon name="search" />
            <input className="input dense" autoFocus placeholder={t("Buscar: acu, uul0101, experimental…")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Buscar unidade")} />
          </div>
          <div className="seg" role="group" aria-label={t("Facção")}>
            {[["all", "Todas"], ["u", "UEF"], ["c", "Cybran"], ["i", "Illuminate"]].map(([k, v]) => <button key={k} className="btn" aria-pressed={faction === k} onClick={() => setFaction(k)}>{k === "all" ? t(v) : v}</button>)}
          </div>
        </div>
        <div className="unit-grid">
          {list.slice(0, 400).map((u) => (
            <button key={u} className="unit-tile" aria-pressed={u === current} onClick={() => onPick(u)}>
              <Icon name={/0001$/.test(u) ? "military_tech" : u[2] === "a" ? "flight" : u[2] === "s" ? "sailing" : u[2] === "b" ? "domain" : "smart_toy"} />
              <span>{unitLabel(u)}</span>
            </button>
          ))}
          {list.length === 0 && <p className="faint">{t("Nenhuma unidade com esse nome.")}</p>}
        </div>
        <footer>
          <button className="btn text" onClick={() => onPick(null)}><Icon name="restart_alt" /> {t("Voltar ao Comandante")}</button>
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
      value: shaderName ?? (shaders?.packInstalled ? t("Desligados") : t("Não instalados")),
      action: () => go("library"),
    },
    {
      icon: "hd", title: t("Remaster HD"), on: !!hd?.enabled,
      value: hd ? (hdOutdated(hd.manifest.version) ? t("Gerar de novo") : hd.enabled ? t("Ativas") : t("Desligadas")) : t("Gerar no Estúdio"),
      action: () => { if (hd && !hdOutdated(hd.manifest.version)) go("library"); else { setStudioTab("hd"); go("studio"); } },
    },
    {
      icon: "format_paint", title: t("Menu do jogo"), on: !!theme?.enabled,
      value: theme ? (theme.enabled ? t("Moderno") : t("Original")) : t("Repaginar"),
      action: () => go("library"),
    },
    {
      icon: "memory", title: t("Memória"), on: !!laa?.enabled,
      value: laa ? (laa.enabled ? t("Até 4 GB") : t("Até 2 GB")) : "—",
      action: () => useStore.getState().openSettings("jogo"),
    },
  ];
  return (
    <section className="card pad enh-card">
      <div className="card-title"><Icon name="rocket_launch" style={{ color: "var(--primary)" }} /><h3>{t("Aprimoramentos")}</h3></div>
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
