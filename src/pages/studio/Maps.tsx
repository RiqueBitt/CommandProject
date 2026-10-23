import { Crosshair, Eraser, Flag, Hammer, Map as MapIcon, Route } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Field, Notice, Switch } from "../../components/ui";
import { api, onProgress } from "../../lib/api";
import { useStore } from "../../lib/store";
import type { MaptkStatus, Terrain, TerrainPreview } from "../../lib/types";

type Tool = "spawn" | "seed" | "bridge" | "erase";
type Pt = [number, number];
const TEAM_COLORS = ["#5aa9e6", "#e5534b", "#7bd88f", "#c78bff"];

function slugId(name: string) {
  const s = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12);
  return "SC2_" + (s.length >= 2 ? s : "MAPA");
}

export default function Maps() {
  const { run, refreshMods } = useStore.getState();
  const busy = useStore((s) => s.busy);
  const [status, setStatus] = useState<MaptkStatus | null>(null);
  const [terrains, setTerrains] = useState<Terrain[] | null>(null);
  const [kind, setKind] = useState<"skirmish" | "campaign" | "all">("skirmish");
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [preview, setPreview] = useState<TerrainPreview | null>(null);
  const [tool, setTool] = useState<Tool>("spawn");
  const [spawns, setSpawns] = useState<Pt[]>([]);
  const [seed, setSeed] = useState<Pt | null>(null);
  const [bridges, setBridges] = useState<[number, number, number, number][]>([]);
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const [name, setName] = useState("Meu mapa");
  const [teams, setTeams] = useState<"2" | "ffa">("2");
  const [sites, setSites] = useState(8);
  const [perSite, setPerSite] = useState(3);
  const [norush, setNorush] = useState(70);
  const [patch, setPatch] = useState(false);
  const [maxSlope, setMaxSlope] = useState(6);
  const [waterMargin, setWaterMargin] = useState(4);
  const [smooth, setSmooth] = useState(false);
  const [minimap, setMinimap] = useState<"donor" | "desert" | "snow" | "dark">("donor");
  const [strip, setStrip] = useState<"moving" | "all" | "none">("moving");
  const [log, setLog] = useState<string[]>([]);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.maptkStatus().then(async (s) => {
      setStatus(s);
      if (s.ready) setTerrains((await run("catalog", () => api.maptkCatalog()))?.terrains ?? []);
    });
  }, [run]);

  useEffect(() => {
    const off = onProgress((e) => e.task === "map" && setLog((l) => [...l.slice(-200), e.message]));
    return () => { off.then((f) => f()); };
  }, []);

  const pickTerrain = async (t: Terrain) => {
    setTerrain(t);
    setPreview(null);
    setSpawns([]);
    setSeed(null);
    setBridges([]);
    setPatch(t.kind === "campaign" || t.navmesh === "pocket");
    setPreview((await run("preview", () => api.maptkPreview(t.id, 512))) ?? null);
  };

  const grid = preview?.grid ?? 1024;
  const toWorld = (e: React.MouseEvent): Pt => {
    const r = stage.current!.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * grid);
    const z = Math.round(((e.clientY - r.top) / r.height) * grid);
    return [Math.max(8, Math.min(grid - 8, x)), Math.max(8, Math.min(grid - 8, z))];
  };

  const onDown = (e: React.MouseEvent) => {
    const p = toWorld(e);
    if (tool === "bridge") setDrag({ a: p, b: p });
    else if (tool === "spawn") setSpawns((s) => (s.length >= 8 ? s : [...s, p]));
    else if (tool === "seed") setSeed(p);
    else if (tool === "erase") {
      const near = (q: Pt) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 28;
      setSpawns((s) => s.filter((q) => !near(q)));
      setBridges((b) => b.filter(([x0, x1, z0, z1]) => !(p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1)));
      if (seed && near(seed)) setSeed(null);
    }
  };
  const onMove = (e: React.MouseEvent) => drag && setDrag({ ...drag, b: toWorld(e) });
  const onUp = () => {
    if (!drag) return;
    const [x0, x1] = [drag.a[0], drag.b[0]].sort((a, b) => a - b);
    const [z0, z1] = [drag.a[1], drag.b[1]].sort((a, b) => a - b);
    if (x1 - x0 > 6 && z1 - z0 > 6) setBridges((b) => [...b, [x0, x1, z0, z1]]);
    setDrag(null);
  };

  const team = (i: number) => (teams === "ffa" ? i : i < Math.ceil(spawns.length / 2) ? 0 : 1);
  const lobbyName = `[${spawns.length}] ${name.trim()}`;
  const spec = useMemo(() => {
    if (!terrain) return null;
    const anchors = Object.fromEntries(spawns.map((p, i) => [String(i + 1), p]));
    const ids = spawns.map((_, i) => i + 1);
    const teamList = teams === "ffa" ? ids.map((i) => [i]) : [ids.filter((_, i) => team(i) === 0), ids.filter((_, i) => team(i) === 1)];
    const s: Record<string, unknown> = {
      terrain: terrain.id, scenario_id: slugId(name), name: lobbyName, anchors, teams: teamList,
      economy: { base_mass: 4, sites, per_site: perSite }, norush,
      patch: patch ? { max_slope: maxSlope, water_margin: waterMargin, seed: seed ?? spawns[0] ?? [512, 512], causeways: bridges } : null,
    };
    if (smooth) s.smooth = { keep_slope: maxSlope, water_margin: waterMargin, mode: "level" };
    if (minimap !== "donor") s.minimap = minimap;
    if (patch) s.strip_props = strip === "none" ? false : strip;
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, spawns, teams, name, sites, perSite, norush, patch, maxSlope, waterMargin, seed, bridges, smooth, minimap, strip]);

  const build = async () => {
    if (!spec) return;
    setLog([]);
    const r = await run("map", () => api.maptkBuild(spec), (x) => `"${x.manifest.name}" gerado, verificado e ativado na biblioteca.`);
    if (r) await refreshMods();
  };

  if (!status) return <div className="panel pad"><div className="bar indeterminate"><i /></div></div>;
  if (!status.ready) {
    return (
      <div className="panel">
        <Empty icon={<MapIcon size={36} color="var(--faint)" />} title="O Estúdio de Mapas precisa do Python">{status.message}</Empty>
      </div>
    );
  }

  const list = (terrains ?? []).filter((t) => kind === "all" || t.kind === kind);
  return (
    <div className="col" style={{ gap: 16 }}>
      <Notice kind="info">
        Feito com o <b>SC2 Map Toolkit</b> (plutonics72, MIT): ele monta o mapa sobre um terreno do jogo, posiciona massa só em chão construível e
        <b> recusa gerar</b> se algum ponto ficar inalcançável. Mapas de campanha precisam do modo “abrir terreno”, que reescreve a malha de navegação.
      </Notice>
      <div className="studio" style={{ gridTemplateColumns: "280px 1fr" }}>
        <div className="panel">
          <div className="chips" style={{ padding: 12 }}>
            {(["skirmish", "campaign", "all"] as const).map((k) => (
              <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "skirmish" ? "Escaramuça" : k === "campaign" ? "Campanha" : "Todos"}</button>
            ))}
          </div>
          <div className="tree" role="listbox" aria-label="Terrenos">
            {terrains === null ? <p className="muted small" style={{ padding: 12 }}>Lendo terrenos do jogo…</p> : list.map((t) => (
              <button key={t.id} role="option" className="tree-item wrap" aria-selected={terrain?.id === t.id} onClick={() => pickTerrain(t)} style={{ flexDirection: "column", alignItems: "flex-start", gap: 0, padding: "8px 14px" }}>
                <span><b>{t.name ?? t.id}</b></span>
                <span className="faint small">{t.id}{t.players ? `, até ${t.players} jogadores` : ""}{t.navmesh === "pocket" ? ", precisa abrir terreno" : ""}</span>
              </button>
            ))}
          </div>
        </div>

        {!terrain ? (
          <div className="panel"><Empty title="Escolha um terreno">Ele vira a base do seu mapa: relevo, água e texturas vêm do jogo.</Empty></div>
        ) : (
          <div className="grid-2" style={{ gridTemplateColumns: "minmax(360px, 1fr) 340px", alignItems: "start" }}>
            <div className="col">
              <div className="row wrap" role="toolbar" aria-label="Ferramentas">
                <button className={`btn sm ${tool === "spawn" ? "primary" : ""}`} onClick={() => setTool("spawn")}><Flag size={14} /> Bases ({spawns.length}/8)</button>
                {patch && <button className={`btn sm ${tool === "seed" ? "primary" : ""}`} onClick={() => setTool("seed")}><Crosshair size={14} /> Ponto de partida</button>}
                {patch && <button className={`btn sm ${tool === "bridge" ? "primary" : ""}`} onClick={() => setTool("bridge")}><Route size={14} /> Passagem</button>}
                <button className={`btn sm ${tool === "erase" ? "primary" : ""}`} onClick={() => setTool("erase")}><Eraser size={14} /> Apagar</button>
              </div>
              <div className="map-stage" ref={stage} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                role="application" aria-label="Mapa: clique para posicionar">
                {preview ? <img src={preview.dataUrl} alt={`Terreno ${terrain.id}`} draggable={false} /> : <div className="bar indeterminate" style={{ margin: 20 }}><i /></div>}
                <svg viewBox={`0 0 ${grid} ${grid}`}>
                  {bridges.map(([x0, x1, z0, z1], i) => <rect key={i} x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="rgba(242,179,61,.25)" stroke="#f2b33d" strokeWidth={3} strokeDasharray="10 6" />)}
                  {drag && <rect x={Math.min(drag.a[0], drag.b[0])} y={Math.min(drag.a[1], drag.b[1])} width={Math.abs(drag.b[0] - drag.a[0])} height={Math.abs(drag.b[1] - drag.a[1])} fill="rgba(242,179,61,.2)" stroke="#f2b33d" strokeWidth={3} />}
                  {seed && <g stroke="#fff" strokeWidth={4}><line x1={seed[0] - 18} y1={seed[1]} x2={seed[0] + 18} y2={seed[1]} /><line x1={seed[0]} y1={seed[1] - 18} x2={seed[0]} y2={seed[1] + 18} /></g>}
                  {spawns.map((p, i) => (
                    <g key={i}>
                      <circle cx={p[0]} cy={p[1]} r={26} fill={TEAM_COLORS[team(i) % 4]} stroke="#0d1b26" strokeWidth={5} />
                      <text x={p[0]} y={p[1] + 10} textAnchor="middle" fontSize={30} fontWeight={700} fill="#0d1b26" fontFamily="Chakra Petch">{i + 1}</text>
                    </g>
                  ))}
                </svg>
              </div>
              <div className="legend">
                <span><i style={{ background: "#7f9a6f" }} />chão onde unidades andam</span>
                <span><i style={{ background: "#9c5450" }} />bloqueado</span>
                <span><i style={{ background: "#2f5f8c" }} />água</span>
                {preview && <span>{preview.navigablePct.toString().replace(".", ",")}% navegável hoje</span>}
              </div>
            </div>

            <section className="panel pad col">
              <Field label="Nome no lobby" hint={`Aparece como “${lobbyName}”. Id: ${slugId(name)}`}>
                <input className="input" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label="Times">
                <select className="select" value={teams} onChange={(e) => setTeams(e.target.value as "2" | "ffa")}>
                  <option value="2">Dois times (metade das bases cada)</option>
                  <option value="ffa">Todos contra todos</option>
                </select>
              </Field>
              <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Field label="Expansões"><input className="input" type="number" min={0} max={20} value={sites} onChange={(e) => setSites(Number(e.target.value))} /></Field>
                <Field label="Massa por expansão"><input className="input" type="number" min={1} max={6} value={perSite} onChange={(e) => setPerSite(Number(e.target.value))} /></Field>
              </div>
              <Field label="Raio sem ataque inicial"><input className="input" type="number" min={0} max={200} value={norush} onChange={(e) => setNorush(Number(e.target.value))} /></Field>
              <div className="check-row">
                <div className="txt"><b>Abrir terreno</b><span className="muted small">Reescreve a navegação para todo o chão firme virar área jogável. Obrigatório em mapas de campanha.</span></div>
                <Switch checked={patch} onChange={setPatch} label="Abrir terreno" />
              </div>
              {patch && (
                <>
                  <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <Field label="Inclinação máxima"><input className="input" type="number" step={0.5} min={1} max={20} value={maxSlope} onChange={(e) => setMaxSlope(Number(e.target.value))} /></Field>
                    <Field label="Margem da água"><input className="input" type="number" step={0.5} min={0} max={20} value={waterMargin} onChange={(e) => setWaterMargin(Number(e.target.value))} /></Field>
                  </div>
                  <Field label="Objetos animados do cenário">
                    <select className="select" value={strip} onChange={(e) => setStrip(e.target.value as typeof strip)}>
                      <option value="moving">Parar os que se movem</option>
                      <option value="all">Remover todos</option>
                      <option value="none">Manter como estão</option>
                    </select>
                  </Field>
                  <p className="faint small">Use “Passagem” para desenhar um vau atravessando água entre duas margens.</p>
                </>
              )}
              <div className="check-row">
                <div className="txt"><b>Aplainar para construir</b><span className="muted small">Nivela o chão suave para dar para construir; mantém penhascos e água.</span></div>
                <Switch checked={smooth} onChange={setSmooth} label="Aplainar terreno" />
              </div>
              <Field label="Minimapa do lobby">
                <select className="select" value={minimap} onChange={(e) => setMinimap(e.target.value as typeof minimap)}>
                  <option value="donor">Original do terreno</option>
                  <option value="desert">Gerar: deserto</option>
                  <option value="snow">Gerar: neve</option>
                  <option value="dark">Gerar: rocha escura</option>
                </select>
              </Field>
              {spawns.length < 2 && <Notice kind="info">Clique no mapa para colocar pelo menos duas bases.</Notice>}
              <button className="btn primary" disabled={spawns.length < 2 || !name.trim() || busy.map} onClick={build}>
                <Hammer size={16} /> {busy.map ? "Gerando e verificando…" : "Gerar mapa"}
              </button>
              {log.length > 0 && <div className="log mono small">{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
