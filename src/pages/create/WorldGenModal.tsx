// Janela do gerador de mundos: escolha um estilo, ajuste montanhas, água, florestas e estruturas,
// veja a prévia ao vivo e gere. Tudo o que sai daqui continua editável no editor.
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, Modal, Notice } from "../../components/ui";
import { BLANK_BASES, BLANK_LABEL, blankSizeOf, type BlankSize } from "../studio/mapEdit";
import type { Terrain } from "../../lib/types";
import type { Pt } from "../studio/mapEdit";
import { teamOfSpawn, worldTeams } from "./docs";
import {
  baseWallsOn, BIOME_LABEL, FEATURE_COLOR, generateWorld, LINE_FEATURES, newWorld, reliefImage, SYMMETRY_LABEL, symmetriesFor, walkMask, teamWallsOn, WORLD_PRESETS,
  type Grid, type PropCatalog, type WorldGen, type WorldResult,
} from "./worldgen";

interface Props {
  grid: Grid;
  donor: Float32Array;
  water: number;
  hasWater: boolean;
  terrains: Terrain[] | null;
  terrain: string | null;
  /** base em branco (chão liso; o terreno do jogo é só o suporte) */
  blank: boolean;
  initial: WorldGen | null;
  catalog: PropCatalog;
  /** céus dos mapas do jogo (id do mapa, nome) */
  skies: { value: string; label: string }[];
  onTerrain: (id: string) => void;
  onClose: () => void;
  onApply: (wg: WorldGen, res: WorldResult) => void;
}

/** Reduz a grade de alturas (prévia rápida). */
function downsample(g: Grid, H: Float32Array, to: number): [Grid, Float32Array] {
  if (g.size <= to) return [g, H];
  const w = g.size + 1, n = to + 1, out = new Float32Array(n * n), k = g.size / to;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[j * n + i] = H[Math.round(j * k) * w + Math.round(i * k)];
  return [{ size: to, grid: g.grid }, out];
}

const SLIDERS: { group: string; icon: string; items: { key: keyof WorldGen; label: string; min: number; max: number; step?: number; fmt?: (v: number) => string; water?: boolean }[] }[] = [
  { group: "Relevo", icon: "terrain", items: [
    { key: "blend", label: "Relevo novo", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: "elevation", label: "Altura da terra", min: 4, max: 60 },
    { key: "hilliness", label: "Ondulação", min: 0, max: 30 },
    { key: "scale", label: "Largura das ondas", min: 100, max: 500, step: 10 },
    { key: "detail", label: "Detalhe fino do chão", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: "smooth", label: "Suavidade (montanhas e margens)", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  ] },
  { group: "Montanhas", icon: "landscape", items: [
    { key: "mountains", label: "Montanhas", min: 0, max: 10 },
    { key: "mountainHeight", label: "Altura das montanhas", min: 20, max: 140, step: 5 },
    { key: "ridges", label: "Cordilheiras", min: 0, max: 6 },
    { key: "hills", label: "Colinas", min: 0, max: 14 },
    { key: "plateaus", label: "Planaltos", min: 0, max: 6 },
  ] },
  { group: "Água", icon: "water", items: [
    { key: "lakes", label: "Lagos", min: 0, max: 10 },
    { key: "rivers", label: "Rios", min: 0, max: 4 },
    { key: "islands", label: "Ilhas", min: 0, max: 8, water: true },
  ] },
  { group: "Cavidades", icon: "vertical_align_bottom", items: [
    { key: "craters", label: "Crateras", min: 0, max: 10 },
    { key: "canyons", label: "Cânions", min: 0, max: 4 },
    { key: "dunes", label: "Campos de dunas", min: 0, max: 8 },
  ] },
  { group: "Vida e estruturas", icon: "forest", items: [
    { key: "forests", label: "Florestas", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: "rocks", label: "Pedras", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: "structures", label: "Estruturas e ruínas", min: 0, max: 12 },
    { key: "wrecks", label: "Destroços", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  ] },
  { group: "Vida humana", icon: "holiday_village", items: [
    { key: "settlements", label: "Vilas", min: 0, max: 8 },
    { key: "farms", label: "Plantações (no bioma temperado)", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
  ] },
  { group: "Estratégia", icon: "flag", items: [
    { key: "expansions", label: "Expansões por jogador", min: 0, max: 4 },
    { key: "obstacles", label: "Paredões (gargalos)", min: 0, max: 8 },
  ] },
];

export default function WorldGenModal(props: Props) {
  const { grid, donor, water, hasWater, catalog } = props;
  // mundos de versões antigas não têm as opções novas (vilas, estradas, detalhe): entram os padrões
  const [wg, setWg] = useState<WorldGen>(() => (props.initial ? { ...newWorld(), ...props.initial } : newWorld()));
  const [img, setImg] = useState<string | null>(null);
  const [res, setRes] = useState<WorldResult | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const [small, smallDonor] = useMemo(() => downsample(grid, donor, 128), [grid, donor]);
  const set = <K extends keyof WorldGen>(k: K, v: WorldGen[K]) => setWg((w) => ({ ...w, [k]: v }));
  const plat = wg.style === "platforms";

  // prévia: gera numa grade menor alguns instantes depois da última mudança
  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = generateWorld(small, smallDonor, water, hasWater, wg, catalog);
      setRes(r);
      setImg(reliefImage(small, r.heights, water, hasWater, wg.biome, 384));
    }, 120);
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, [wg, small, smallDonor, water, hasWater, catalog]);

  const walkPct = useMemo(() => {
    if (!res) return 0;
    const m = walkMask(small, res.heights, water, hasWater);
    let n = 0;
    for (const v of m) n += v;
    return Math.round((n / m.length) * 100);
  }, [res, small, water, hasWater]);

  // galeria: a mesma configuração com 6 sementes vizinhas (clique para escolher)
  const [gallery, setGallery] = useState<{ seed: number; img: string }[]>([]);
  const [tiny, tinyDonor] = useMemo(() => downsample(grid, donor, 64), [grid, donor]);
  const showGallery = () => {
    const base = wg.seed;
    const out: { seed: number; img: string }[] = [];
    for (let k = 1; k <= 6; k++) {
      const sd = (base + k * 7919) % 999999;
      const r = generateWorld(tiny, tinyDonor, water, hasWater, { ...wg, seed: sd }, catalog);
      out.push({ seed: sd, img: reliefImage(tiny, r.heights, water, hasWater, wg.biome, 128) });
    }
    setGallery(out);
  };
  const syms = symmetriesFor(wg.players);
  const terrainName = props.terrains?.find((t) => t.id === props.terrain)?.name ?? props.terrain ?? "—";
  const G = grid.grid;
  const svgPt = (p: Pt) => [(p[0] / G) * 100, (p[1] / G) * 100];

  const apply = () => {
    setBusy(true);
    // a geração final usa a resolução do editor (a mesma semente dá o mesmo mapa)
    window.setTimeout(() => {
      const r = generateWorld(grid, donor, water, hasWater, wg, catalog);
      props.onApply(wg, r);
      setBusy(false);
    }, 20);
  };

  return (
    <Modal title="Gerar mundo" icon="auto_awesome" onClose={props.onClose} wide>
      <div className="wg">
        <div className="wg-left">
          <div className="wg-presets">
            {WORLD_PRESETS.map((p) => (
              <button key={p.id} className={`wg-preset ${wg.preset === p.id ? "on" : ""}`} onClick={() => setWg((w) => ({ ...w, ...p.over, preset: p.id }))} title={p.desc}>
                <Icon name={p.icon} size={22} />
                <b>{p.label}</b>
                <small>{p.desc}</small>
              </button>
            ))}
          </div>

          <div className="wg-row">
            <label className="field"><span className="label">Terreno base</span>
              <select className="select" value={props.blank ? `blank:${blankSizeOf(props.terrain) ?? 1024}` : props.terrain ?? ""} onChange={(e) => props.onTerrain(e.target.value)}>
                <optgroup label="Em branco (grama lisa)">
                  {(Object.keys(BLANK_BASES) as unknown as BlankSize[]).map((k) => <option key={k} value={`blank:${k}`}>{BLANK_LABEL[k]}</option>)}
                </optgroup>
                <optgroup label="Mapas do jogo">
                  {(props.terrains ?? []).filter((t) => t.kind === "skirmish").map((t) => <option key={t.id} value={t.id}>{t.name ?? t.id}{t.waterY ? " · com água" : ""}</option>)}
                </optgroup>
              </select>
            </label>
            <label className="field"><span className="label">Semente</span>
              <span className="row" style={{ gap: 6 }}>
                <input className="input" type="number" value={wg.seed} onChange={(e) => set("seed", Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
                <button className="btn icon-btn" title="Semente aleatória" aria-label="Semente aleatória" onClick={() => set("seed", Math.floor(Math.random() * 999999))}><Icon name="casino" /></button>
              </span>
            </label>
          </div>
          <div className="wg-row">
            <label className="field"><span className="label">Jogadores</span>
              <select className="select" value={wg.players} onChange={(e) => {
                const n = Number(e.target.value);
                setWg((w) => ({ ...w, players: n, symmetry: symmetriesFor(n).includes(w.symmetry) ? w.symmetry : symmetriesFor(n)[symmetriesFor(n).length > 1 ? 1 : 0] }));
              }}>
                {[2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32].map((n) => <option key={n} value={n}>{n} jogadores{n > 8 ? " (Partida grande)" : ""}</option>)}
              </select>
            </label>
            <label className="field"><span className="label">Simetria</span>
              <select className="select" value={wg.symmetry} onChange={(e) => set("symmetry", e.target.value as WorldGen["symmetry"])}>
                {syms.map((s) => <option key={s} value={s}>{SYMMETRY_LABEL[s]}</option>)}
              </select>
            </label>
          </div>

          <div className="wg-row">
            <label className="field"><span className="label">Estilo do terreno</span>
              <select className="select" value={wg.style ?? "natural"} onChange={(e) => set("style", e.target.value as WorldGen["style"])}>
                <option value="natural">Natural (morros, montanhas, água)</option>
                <option value="platforms">Plataformas sobre um abismo, com pontes</option>
              </select>
            </label>
          </div>
          {plat && (
            <section className="wg-group">
              <h4><Icon name="layers" size={17} /> Plataformas e abismo</h4>
              {([
                { key: "platformHeight", label: "Altura da queda", min: 60, max: 260, step: 5 },
                { key: "plateaus", label: "Plataformas de expansão", min: 0, max: 12 },
                { key: "mountains", label: "Torres de pedra (sem ponte)", min: 0, max: 12 },
              ] as { key: keyof WorldGen; label: string; min: number; max: number; step?: number }[]).map((it) => {
                const v = (wg[it.key] as number | undefined) ?? (it.key === "platformHeight" ? 150 : 0);
                return (
                  <label key={it.key} className="range">
                    <span>{it.label}</span>
                    <input type="range" min={it.min} max={it.max} step={it.step ?? 1} value={v} onChange={(e) => set(it.key, Number(e.target.value) as never)} />
                    <output>{v}</output>
                  </label>
                );
              })}
              <label className="field"><span className="label">Fundo do abismo</span>
                <select className="select" value={wg.abyss ?? "deep"} onChange={(e) => set("abyss", e.target.value as WorldGen["abyss"])}>
                  <option value="deep">Seco (rocha lá embaixo)</option>
                  <option value="water" disabled={!hasWater}>Mar lá embaixo{hasWater ? "" : " (precisa de água)"}</option>
                </select>
              </label>
              <p className="faint small">As bases, o centro e as expansões ficam em plataformas altas ligadas por pontes; o resto é abismo. Depois de gerar, mova as plataformas e desenhe pontes novas em Formas → Plataformas e abismo.</p>
            </section>
          )}
          {SLIDERS.filter((g) => !plat || !["Montanhas", "Água", "Cavidades"].includes(g.group)).map((g) => (
            <section key={g.group} className="wg-group">
              <h4><Icon name={g.icon} size={17} /> {g.group}</h4>
              {g.items.map((it) => {
                const v = (wg[it.key] as number | undefined) ?? 0;
                const off = it.water && !hasWater;
                return (
                  <label key={it.key} className={`range ${off ? "off" : ""}`} title={off ? "Precisa de um terreno com água" : undefined}>
                    <span>{it.label}</span>
                    <input type="range" min={it.min} max={it.max} step={it.step ?? 1} value={v} disabled={off} onChange={(e) => set(it.key, Number(e.target.value) as never)} />
                    <output>{it.fmt ? it.fmt(v) : v}</output>
                  </label>
                );
              })}
              {g.group === "Água" && !hasWater && <p className="faint small">{terrainName} não tem água: lagos e rios viram vales e leitos secos.</p>}
            </section>
          ))}
          <section className="wg-group">
            <h4><Icon name="tune" size={17} /> Acabamento</h4>
            <div className="wg-row">
              <label className="field"><span className="label">Bordas do mapa</span>
                <select className="select" value={wg.edge} onChange={(e) => set("edge", e.target.value as WorldGen["edge"])}>
                  <option value="none">Abertas</option>
                  <option value="mountains">Cercadas por montanhas</option>
                  <option value="rugged">Borda rochosa (intransponível)</option>
                  <option value="water" disabled={!hasWater}>Mar em volta{hasWater ? "" : " (precisa de água)"}</option>
                </select>
              </label>
              <label className="field"><span className="label">Massa</span>
                <select className="select" value={wg.resources ?? "generated"} onChange={(e) => set("resources", e.target.value as WorldGen["resources"])}>
                  <option value="generated">Gerada aqui (simétrica, editável)</option>
                  <option value="auto">Automática do toolkit</option>
                </select>
              </label>
              <label className="field"><span className="label">Economia</span>
                <select className="select" value={wg.economy} onChange={(e) => set("economy", e.target.value as WorldGen["economy"])}>
                  <option value="poor">Pouca massa</option>
                  <option value="normal">Normal</option>
                  <option value="rich">Muita massa</option>
                </select>
              </label>
              <label className="field"><span className="label">Céu</span>
                <select className="select" value={wg.sky ?? ""} onChange={(e) => set("sky", e.target.value || null)}>
                  <option value="">O do terreno base</option>
                  {props.skies.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              </label>
              <label className="field"><span className="label">Bioma (chão, prévia e minimapa)</span>
                <select className="select" value={wg.biome} onChange={(e) => set("biome", e.target.value as WorldGen["biome"])}>
                  {Object.entries(BIOME_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            </div>
            <label className="check"><input type="checkbox" checked={wg.roads !== false} disabled={!(wg.settlements ?? 0)} onChange={(e) => set("roads", e.target.checked)} /> Estradas de terra ligando as vilas às bases</label>
            <label className="check"><input type="checkbox" checked={wg.paths !== false} disabled={plat} onChange={(e) => set("paths", e.target.checked)} /> Caminhos das bases até o centro e as expansões</label>
            <label className="check" title="Partes íngremes das montanhas e paredões ficam fechadas para as tropas por terra (dá para mudar depois com o pincel de passagem)."><input type="checkbox" checked={wg.blockSteep !== false} onChange={(e) => set("blockSteep", e.target.checked)} /> Montanhas íngremes bloqueiam as tropas</label>
            <label className="check"><input type="checkbox" checked={wg.center !== false} disabled={wg.symmetry === "none"} onChange={(e) => set("center", e.target.checked)} /> Centro disputado (área plana com massa no meio)</label>
            <label className="check" title="Uma serra alta no meio do mapa (no eixo da simetria) separa os times; as tropas passam pelos vãos (um no centro e outros dos lados). Liga sozinha com mais de 8 jogadores."><input type="checkbox" checked={teamWallsOn(wg)} disabled={plat || wg.symmetry === "none"} onChange={(e) => set("teamWalls", e.target.checked)} /> Cordilheira separando os times (com passagens)</label>
            <label className="check" title="Serras curtas entre as bases vizinhas, com um vão no meio: as bases não ficam coladas num campo aberto. Liga sozinha com mais de 8 jogadores."><input type="checkbox" checked={baseWallsOn(wg)} disabled={plat} onChange={(e) => set("baseWalls", e.target.checked)} /> Serras entre as bases vizinhas</label>
            <label className="check" title="O chão inteiro ganha as texturas do bioma, a luz e as sombras são refeitas para o relevo novo e as decorações do mapa original saem. Sem isso, o desenho do mapa original aparece por baixo do mundo novo."><input type="checkbox" checked={wg.clearDonor} onChange={(e) => set("clearDonor", e.target.checked)} /> Visual limpo: nada do mapa original por cima (texturas, sombras e decorações) — recomendado</label>
          </section>
        </div>

        <div className="wg-right">
          <div className="wg-preview">
            {img ? <img src={img} alt="Prévia do mundo" draggable={false} /> : <div className="bar indeterminate"><i /></div>}
            {res && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                {res.features.filter((f) => LINE_FEATURES.includes(f.kind) && f.kind !== "pass").map((f) => (
                  <polyline key={f.id} points={f.pts.map((p) => svgPt(p).join(",")).join(" ")} fill="none" stroke={FEATURE_COLOR[f.kind]} strokeOpacity={0.35} strokeWidth={0.5} />
                ))}
                {res.features.filter((f) => f.kind === "pass").map((f) => (
                  <polyline key={f.id} points={f.pts.map((p) => svgPt(p).join(",")).join(" ")} fill="none" stroke="#f2b33d" strokeWidth={0.6} strokeDasharray="1.4 1" />
                ))}
                {res.life?.fields.map((f, i) => {
                  const [x, y] = svgPt(f.c), a = (f.ang * 180) / Math.PI;
                  return <rect key={`f${i}`} x={x - (f.a / G) * 50} y={y - (f.b / G) * 50} width={(f.a / G) * 100} height={(f.b / G) * 100} transform={`rotate(${a} ${x} ${y})`} fill="#d9c27a" fillOpacity={0.55} stroke="#8a6d3b" strokeWidth={0.15} />;
                })}
                {res.life?.roads.map((rd, i) => <polyline key={`r${i}`} points={rd.map((p) => svgPt(p).join(",")).join(" ")} fill="none" stroke="#b08850" strokeOpacity={0.9} strokeWidth={0.55} strokeLinecap="round" />)}
                {res.life?.villages.map((v, i) => { const [x, y] = svgPt(v.p); return <g key={`v${i}`}><circle cx={x} cy={y} r={(v.r / G) * 100} fill="#c9a26b" fillOpacity={0.35} stroke="#f2d39a" strokeWidth={0.3} /><rect x={x - 0.9} y={y - 0.9} width={1.8} height={1.8} fill="#f2d39a" /></g>; })}
                {res.mass.map((p, i) => { const [x, y] = svgPt(p); return <path key={`m${i}`} d={`M${x} ${y - 1.1}L${x + 0.8} ${y}L${x} ${y + 1.1}L${x - 0.8} ${y}Z`} fill="#7bd88f" stroke="#0d1b26" strokeWidth={0.25} />; })}
                {res.strategic.filter((q) => q.kind !== "safe").map((q, i) => { const [x, y] = svgPt(q.pos); return <circle key={`s${i}`} cx={x} cy={y} r={3.6} fill="none" stroke={q.kind === "center" ? "#ffd166" : "#ff9f43"} strokeWidth={0.4} strokeDasharray="1 0.8" />; })}
                {res.spawns.map((p, i) => {
                  const [x, y] = svgPt(p);
                  const team = teamOfSpawn(worldTeams(wg.players, wg.symmetry), i, res.spawns.length);
                  return <g key={i}><circle cx={x} cy={y} r={2.6} fill={["#5aa9e6", "#e5534b", "#7bd88f", "#c78bff", "#f2b33d", "#ff8fab", "#9be7ff", "#eee"][team % 8]} stroke="#0d1b26" strokeWidth={0.6} /><text x={x} y={y + 1.1} fontSize={3} textAnchor="middle" fontWeight={700} fill="#0d1b26">{i + 1}</text></g>;
                })}
              </svg>
            )}
          </div>
          {res && (
            <div className="wg-stats">
              <span><b>{res.features.filter((f) => f.kind !== "pad").length}</b> formas</span>
              <span><b>{res.props.length}</b> decorações</span>
              <span><b>{walkPct}%</b> caminhável</span>
              <span><b>{wg.players}</b> bases</span>
              <span><b>{res.mass.length}</b> massa</span>
              {!!res.life?.villages.length && <span><b>{res.life.villages.length}</b> vilas</span>}
              {!!res.life?.roads.length && <span><b>{res.life.roads.length}</b> estradas</span>}
            </div>
          )}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={showGallery}><Icon name="grid_view" size={16} /> Ver 6 variações</button>
            {gallery.length > 0 && <button className="btn sm text" onClick={() => setGallery([])}><Icon name="close" size={16} /></button>}
          </div>
          {gallery.length > 0 && <div className="wg-gallery">{gallery.map((g) => (
            <button key={g.seed} className={wg.seed === g.seed ? "on" : ""} onClick={() => set("seed", g.seed)} title={`Semente ${g.seed}`}><img src={g.img} alt={`Semente ${g.seed}`} /><small>{g.seed}</small></button>
          ))}</div>}
          {!hasWater && (wg.lakes > 0 || wg.rivers > 0 || wg.islands > 0 || wg.edge === "water") && <Notice kind="info">Este terreno não tem água: lagos e rios viram vales secos. Para água de verdade, use um mapa do jogo com água como base.</Notice>}
          {res?.notes.map((n, i) => <Notice key={i} kind="info">{n}</Notice>)}
          <p className="faint small">Depois de gerar, tudo vira objetos editáveis: mova montanhas e lagos, mude raio e altura, apague, pinte o relevo com o pincel e espalhe mais decorações. A mesma semente sempre gera o mesmo mundo.</p>
          <p className="faint small">No jogo o chão usa as texturas do terreno base ({terrainName}); troque as camadas em <b>Chão</b>. As cores acima são da prévia e do minimapa.</p>
          <footer>
            <button className="btn text" onClick={props.onClose}>Cancelar</button>
            <button className="btn primary" disabled={busy || !res} onClick={apply}><Icon name="auto_awesome" size={18} /> {busy ? "Gerando…" : "Gerar mundo"}</button>
          </footer>
        </div>
      </div>
    </Modal>
  );
}
