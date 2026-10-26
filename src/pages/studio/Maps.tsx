import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Empty, Field, Notice, Switch, Icon } from "../../components/ui";
import type { DecorPoint, Marker } from "../../components/MapView3D";
import { api, onProgress } from "../../lib/api";
import { load, useStore } from "../../lib/store";
import { locale, t, tr } from "../../lib/i18n";
import type { MapAssets, MapBuildResult, MaptkStatus, Terrain, TerrainPreview } from "../../lib/types";
import {
  applyRelief, cutTester, decodeHeights, decorKind, EMPTY_EDITS, heightAt, meanInDisc, RELIEF_LABEL, reliefShape, reskinPaths, round1,
  type Edits, type GroundLayer, type PlacedProp, type Pt, type Relief, type Relief3D, type ReliefKind,
} from "./mapEdit";
import { GroundTextures, PropPicker } from "./MapDecor";
import { MAX_SPAWNS, TEAM_OPTIONS, teamLists, teamOfSpawn, type MapTeams } from "../create/docs";

const MapView3D = lazy(() => import("../../components/MapView3D"));

type Tool = "orbit" | "spawn" | "mass" | ReliefKind | "bridge" | "decor" | "uncut" | "seed" | "erase";
const TEAM_COLORS = ["#5aa9e6", "#e5534b", "#7bd88f", "#c78bff", "#f2b33d", "#ff8fab", "#9be7ff", "#eeeeee"];
const RELIEF_COLOR: Record<ReliefKind, string> = { hill: "#e3a857", valley: "#4fa3e0", plateau: "#d97757", flatten: "#c9d1d9", ramp: "#f2b33d" };
const RELIEF_ICON: Record<ReliefKind, string> = { hill: "filter_hdr", valley: "water", plateau: "landscape", flatten: "straighten", ramp: "stairs" };
const isRelief = (k: Tool): k is ReliefKind => k in RELIEF_LABEL;
/** número com a vírgula decimal do português (o inglês usa ponto) */
const dec = (n: number) => (locale() === "pt-BR" ? n.toString().replace(".", ",") : n.toString());
const MAX_MASS = 200;
const MAX_PROPS = 5000;
const MAX_CUTS = 400;
type DonorProp = [number, number, number, number, number, number];

const TOOLS: { id: Tool; icon: string; label: string; hint: string }[] = [
  { id: "orbit", icon: "3d_rotation", label: "Câmera", hint: "Arraste para girar. Botão do meio move, roda dá zoom. Nas outras ferramentas o botão direito também gira." },
  { id: "spawn", icon: "flag", label: "Bases", hint: "Clique para colocar a base inicial de cada jogador (quantas quiser; mais de 8 joga pela Partida grande)." },
  { id: "mass", icon: "diamond", label: "Massa", hint: "Clique para colocar pontos de extração de massa. Pontos em chão inclinado ou na água vão para o chão plano mais próximo." },
  { id: "hill", icon: RELIEF_ICON.hill, label: "Morro", hint: "Clique ou arraste para subir o terreno em rampa suave: dá para andar até o topo." },
  { id: "valley", icon: RELIEF_ICON.valley, label: "Vale", hint: "Clique ou arraste para cavar. Abaixo do nível da água vira lago ou rio." },
  { id: "plateau", icon: RELIEF_ICON.plateau, label: "Planalto", hint: "Levanta um platô de topo plano com paredes íngremes (obstáculo). Use uma Rampa para dar acesso." },
  { id: "flatten", icon: RELIEF_ICON.flatten, label: "Aplainar", hint: "Nivela a área na altura média: bom para abrir espaço de construção." },
  { id: "ramp", icon: RELIEF_ICON.ramp, label: "Rampa", hint: "Arraste do ponto baixo ao alto: liga um platô ao chão com uma subida que dá para andar." },
  { id: "bridge", icon: "route", label: "Passagem", hint: "Arraste um retângulo sobre a água para criar um vau que as unidades atravessam." },
  { id: "decor", icon: "park", label: "Decorar", hint: "Escolha uma decoração abaixo e clique para colocar. Arraste para espalhar várias (bosque, pedregal…)." },
  { id: "uncut", icon: "content_cut", label: "Tirar decoração", hint: "Clique ou arraste para retirar árvores, pedras e prédios do terreno original dentro do círculo." },
  { id: "seed", icon: "my_location", label: "Partida", hint: "Ponto de onde a navegação é recalculada; todo chão alcançável a partir dele vira jogável." },
  { id: "erase", icon: "layers_clear", label: "Apagar", hint: "Clique sobre um item ou edição de relevo para removê-lo." },
];

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
  const [relief3d, setRelief3d] = useState<Relief3D | null>(null);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [skin, setSkin] = useState<"game" | "nav">("game");
  const [exag, setExag] = useState(1.5);
  const [tool, setTool] = useState<Tool>("spawn");
  const [radius, setRadius] = useState(60);
  const [strength, setStrength] = useState(20);
  const [hist, setHist] = useState<{ cur: Edits; past: Edits[]; future: Edits[] }>({ cur: EMPTY_EDITS, past: [], future: [] });
  const edits = hist.cur;
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const [cursor2d, setCursor2d] = useState<Pt | null>(null);
  const [name, setName] = useState(() => t("Meu mapa"));
  const [teams, setTeams] = useState<MapTeams>("2");
  const [baseMass, setBaseMass] = useState(4);
  const [sites, setSites] = useState(8);
  const [perSite, setPerSite] = useState(3);
  const [norush, setNorush] = useState(70);
  const [patch, setPatch] = useState(false);
  const [maxSlope, setMaxSlope] = useState(6);
  const [waterMargin, setWaterMargin] = useState(4);
  const [smooth, setSmooth] = useState(false);
  const [rugged, setRugged] = useState(false);
  const [minimap, setMinimap] = useState<"donor" | "desert" | "snow" | "dark">("donor");
  const [strip, setStrip] = useState<"moving" | "all" | "none">("moving");
  const [log, setLog] = useState<string[]>([]);
  const [lastBuild, setLastBuild] = useState<MapBuildResult | null>(null);
  const [donor, setDonor] = useState<{ props: DonorProp[]; kinds: string[] } | null>(null);
  const [assets, setAssets] = useState<MapAssets | null>(null);
  const [propBp, setPropBp] = useState<string | null>(null);
  const [density, setDensity] = useState(1);
  const [sizeVar, setSizeVar] = useState(25);
  const [showDecor, setShowDecor] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const pickSeq = useRef(0);

  useEffect(() => {
    api.maptkStatus().then(async (s) => {
      setStatus(s);
      if (s.ready) setTerrains((await load(() => api.maptkCatalog()))?.terrains ?? []);
    });
  }, []);

  useEffect(() => {
    const off = onProgress((e) => e.task === "map" && setLog((l) => [...l.slice(-200), e.message]));
    return () => { off.then((f) => f()); };
  }, []);

  const pickTerrain = async (t: Terrain) => {
    setTerrain(t);
    setPreview(null);
    setRelief3d(null);
    setHist({ cur: EMPTY_EDITS, past: [], future: [] });
    setLastBuild(null);
    setPatch(t.kind === "campaign" || t.navmesh === "pocket");
    setDonor(null);
    if (!assets) void api.mapAssets().then(setAssets).catch(() => setAssets({ props: [], layers: [] }));
    const ticket = ++pickSeq.current; // clicou em outro terreno antes deste carregar: vale o último
    const [p, r] = await Promise.all([
      load(() => api.maptkPreview(t.id, 512)),
      load(() => api.maptkTerrain3d(t.id, 256)),
    ]);
    if (ticket !== pickSeq.current) return;
    setPreview(p ?? null);
    if (r) {
      setRelief3d({ size: r.size, grid: r.grid, heights: decodeHeights(r.heights, r.heightScale), waterLevel: r.waterLevel, yMin: r.yMin, yMax: r.yMax, texture: r.texture });
      setDonor({ props: r.props ?? [], kinds: r.propKinds ?? [] });
    } else setView("2d");
  };

  const grid = relief3d?.grid ?? preview?.grid ?? 1024;
  const water = relief3d?.waterLevel ?? preview?.waterLevel ?? 0;
  const heights = useMemo(
    () => (relief3d ? applyRelief(relief3d, relief3d.heights, edits.relief, rugged, water) : null),
    [relief3d, edits.relief, rugged, water],
  );

  // histórico: cada clique/traço é um passo desfazível
  const commit = useCallback((fn: (e: Edits) => Edits) => {
    setHist((h) => {
      const n = fn(h.cur);
      return n === h.cur ? h : { cur: n, past: [...h.past.slice(-80), h.cur], future: [] };
    });
  }, []);
  /** muda o passo atual sem criar outro (continuação de um traço) */
  const amend = useCallback((fn: (e: Edits) => Edits) => setHist((h) => ({ ...h, cur: fn(h.cur) })), []);
  const undo = useCallback(() => setHist((h) => (h.past.length ? { cur: h.past[h.past.length - 1], past: h.past.slice(0, -1), future: [h.cur, ...h.future] } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.future.length ? { cur: h.future[0], past: [...h.past, h.cur], future: h.future.slice(1) } : h)), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.matches?.("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // estado atual acessível nos eventos do ponteiro (que vêm do canvas 3D)
  const ctx = useRef({ tool, radius, strength, heights, relief3d, edits, drag, propBp, density, sizeVar });
  ctx.current = { tool, radius, strength, heights, relief3d, edits, drag, propBp, density, sizeVar };
  const stroke = useRef<Pt | null>(null);

  const hAt = (p: Pt) => {
    const { heights: h, relief3d: r } = ctx.current;
    return h && r ? heightAt(r, h, p[0], p[1]) : water;
  };

  const reliefOp = (k: ReliefKind, p: Pt): Relief | null => {
    const { radius: rad, strength: s, heights: h, relief3d: r } = ctx.current;
    const [x, z] = p;
    const y = hAt(p);
    if (k === "hill") return { kind: k, op: ["cone", x, z, rad, round1(y + s), "raise"] };
    if (k === "valley") return { kind: k, op: ["cone", x, z, rad, round1(Math.max(0, y - s)), "lower"] };
    if (k === "plateau") return { kind: k, op: ["disc", x, z, rad, round1(y + s), "raise"] };
    if (k === "flatten") return { kind: k, op: ["disc", x, z, rad, round1(h && r ? meanInDisc(r, h, x, z, rad) : y), "set"] };
    return null;
  };

  const eraseAt = (p: Pt, e: Edits): Edits => {
    const near = (q: Pt, d = 26) => Math.hypot(q[0] - p[0], q[1] - p[1]) < d;
    const spawns = e.spawns.filter((q) => !near(q));
    const mass = e.mass.filter((q) => !near(q, 18));
    const bridges = e.bridges.filter(([x0, x1, z0, z1]) => !(p[0] >= x0 && p[0] <= x1 && p[1] >= z0 && p[1] <= z1));
    const seed = e.seed && near(e.seed) ? null : e.seed;
    const props = e.props.filter((q) => !near([q.x, q.z], 10));
    const cuts = props.length === e.props.length ? e.cuts.filter(([x, z, r]) => Math.hypot(x - p[0], z - p[1]) > r) : e.cuts;
    let relief = e.relief;
    if (spawns.length === e.spawns.length && mass.length === e.mass.length && bridges.length === e.bridges.length && seed === e.seed
      && props.length === e.props.length && cuts.length === e.cuts.length) {
      // nenhum marcador: remove a edição de relevo mais recente sob o cursor
      for (let i = relief.length - 1; i >= 0; i--) {
        const sh = reliefShape(relief[i].op);
        const inside = sh.rect ? p[0] >= sh.rect[0] && p[0] <= sh.rect[1] && p[1] >= sh.rect[2] && p[1] <= sh.rect[3] : near(sh.c, sh.r);
        if (inside) { relief = relief.filter((_, j) => j !== i); break; }
      }
    }
    return { ...e, spawns, mass, bridges, seed, relief, props, cuts };
  };

  /** decorações novas em volta de p (1 = só no ponto; mais = espalhadas no raio) */
  const scatter = (p: Pt): PlacedProp[] => {
    const { propBp: bp, density: n, radius: rad, sizeVar: v } = ctx.current;
    if (!bp) return [];
    const out: PlacedProp[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = n === 1 ? 0 : Math.sqrt(Math.random()) * rad;
      const x = Math.round(Math.max(2, Math.min(grid - 2, p[0] + Math.cos(a) * d)) * 10) / 10;
      const z = Math.round(Math.max(2, Math.min(grid - 2, p[1] + Math.sin(a) * d)) * 10) / 10;
      out.push({ bp, x, z, yaw: Math.round(Math.random() * 360), scale: round1(Math.max(0.3, 1 + (Math.random() * 2 - 1) * (v / 100)) * 100) / 100 });
    }
    return out;
  };
  const addProps = (e: Edits, list: PlacedProp[]): Edits =>
    list.length && e.props.length < MAX_PROPS ? { ...e, props: [...e.props, ...list.slice(0, MAX_PROPS - e.props.length)] } : e;
  const addCut = (e: Edits, p: Pt): Edits => {
    const rad = ctx.current.radius;
    const props = e.props.filter((q) => Math.hypot(q.x - p[0], q.z - p[1]) > rad);
    const cuts = e.cuts.length < MAX_CUTS ? [...e.cuts, [p[0], p[1], rad] as [number, number, number]] : e.cuts;
    return { ...e, props, cuts };
  };

  const onPointer = useCallback((type: "down" | "move" | "up", p: Pt | null) => {
    const { tool: t, radius: rad, drag: d } = ctx.current;
    if (t === "orbit") return;
    if (t === "ramp" || t === "bridge") {
      if (type === "down" && p) setDrag({ a: p, b: p });
      else if (type === "move" && p && d) setDrag({ ...d, b: p });
      else if (type === "up" && d) {
        const b = p ?? d.b;
        setDrag(null);
        let [x0, x1] = [d.a[0], b[0]].sort((u, v) => u - v);
        let [z0, z1] = [d.a[1], b[1]].sort((u, v) => u - v);
        if (t === "bridge") {
          if (x1 - x0 > 6 && z1 - z0 > 6) commit((e) => ({ ...e, bridges: [...e.bridges, [x0, x1, z0, z1]] }));
          return;
        }
        if (Math.hypot(b[0] - d.a[0], b[1] - d.a[1]) < 16) return;
        // rampa traçada como linha: garante uma largura transitável
        const alongX = x1 - x0 >= z1 - z0;
        const minW = Math.max(24, Math.round(rad / 2));
        if (alongX && z1 - z0 < minW) { const c = (z0 + z1) / 2; z0 = Math.round(c - minW / 2); z1 = Math.round(c + minW / 2); }
        if (!alongX && x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = Math.round(c - minW / 2); x1 = Math.round(c + minW / 2); }
        const ya = hAt(d.a), yb = hAt(b);
        const aLow = alongX ? d.a[0] <= b[0] : d.a[1] <= b[1];
        const [lo, hi] = aLow ? [ya, yb] : [yb, ya];
        commit((e) => ({ ...e, relief: [...e.relief, { kind: "ramp", op: ["ramp", x0, z0, x1, z1, round1(lo), round1(hi), "set"] }] }));
      }
      return;
    }
    if (!p) { if (type === "up") stroke.current = null; return; }
    if (type === "up") { stroke.current = null; return; }
    if (t === "spawn" && type === "down") commit((e) => (e.spawns.length >= MAX_SPAWNS ? e : { ...e, spawns: [...e.spawns, p] }));
    else if (t === "mass" && type === "down") commit((e) => (e.mass.length >= MAX_MASS ? e : { ...e, mass: [...e.mass, p] }));
    else if (t === "seed" && type === "down") commit((e) => ({ ...e, seed: p }));
    else if (t === "erase" && type === "down") commit((e) => eraseAt(p, e));
    else if (t === "decor" || t === "uncut") {
      const apply = (e: Edits) => (t === "decor" ? addProps(e, scatter(p)) : addCut(e, p));
      const gap = t === "decor" ? (ctx.current.density === 1 ? 8 : rad * 0.8) : rad * 0.6;
      if (type === "down") { stroke.current = p; commit(apply); }
      else if (stroke.current && Math.hypot(p[0] - stroke.current[0], p[1] - stroke.current[1]) > gap) { stroke.current = p; amend(apply); }
    }
    else if (isRelief(t)) {
      if (type === "down") {
        stroke.current = p;
        const r = reliefOp(t, p);
        if (r) commit((e) => ({ ...e, relief: [...e.relief, r] }));
      } else if (stroke.current && Math.hypot(p[0] - stroke.current[0], p[1] - stroke.current[1]) > rad * 0.45 && ctx.current.edits.relief.length < 400) {
        // arrastar pinta uma cordilheira/rio: faz parte do mesmo passo do histórico
        stroke.current = p;
        const r = reliefOp(t, p);
        if (r) amend((e) => ({ ...e, relief: [...e.relief, r] }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, amend]);

  // 2D: mesmas ações, com coordenadas vindas do mouse sobre a imagem
  const toWorld = (e: React.PointerEvent): Pt => {
    const r = stage.current!.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * grid);
    const z = Math.round(((e.clientY - r.top) / r.height) * grid);
    return [Math.max(0, Math.min(grid, x)), Math.max(0, Math.min(grid, z))];
  };
  const down2d = useRef(false);

  const team = (i: number) => teamOfSpawn(teams, i, edits.spawns.length);
  const lobbyName = `[${edits.spawns.length}] ${name.trim()}`;
  const editsTerrain = edits.relief.length > 0 || rugged || edits.bridges.length > 0;
  const usePatch = patch || editsTerrain;

  const groundLayers: GroundLayer[] = useMemo(
    () => (terrain && assets ? assets.layers.filter((l) => l.map.toLowerCase() === terrain.id.toLowerCase()) : []),
    [terrain, assets],
  );
  const usedProps = useMemo(() => donor?.kinds ?? [], [donor]);
  useEffect(() => {
    if (tool !== "decor" || propBp || !assets?.props.length) return;
    const used = new Set(usedProps.map((u) => u.toLowerCase()));
    setPropBp((assets.props.find((p) => used.has(p.bp.toLowerCase())) ?? assets.props.find((p) => p.category === "Trees") ?? assets.props[0]).bp);
  }, [tool, propBp, assets, usedProps]);

  // decorações do terreno que sobram depois dos cortes (e quantas saíram)
  const [kept, removedCount] = useMemo(() => {
    const bps = donor?.kinds ?? [];
    const kinds = bps.map(decorKind);
    const inCut = cutTester(edits.cuts);
    const out: DecorPoint[] = [];
    let removed = 0;
    for (const [x, z, , yaw, scale, k] of donor?.props ?? []) {
      if (inCut(x, z)) { removed++; continue; }
      out.push({ x, z, yaw, scale, kind: kinds[k] ?? "other", bp: bps[k] });
    }
    return [out, removed] as const;
  }, [donor, edits.cuts]);
  const decor: DecorPoint[] = useMemo(() => {
    if (!showDecor) return [];
    return kept.concat(edits.props.map((q) => ({ x: q.x, z: q.z, yaw: q.yaw, scale: q.scale, kind: decorKind(q.bp), bp: q.bp, added: true })));
  }, [kept, edits.props, showDecor]);

  const spec = useMemo(() => {
    if (!terrain) return null;
    const { spawns, mass, bridges, seed, relief, props, cuts, reskin } = edits;
    const anchors = Object.fromEntries(spawns.map((p, i) => [String(i + 1), p]));
    const ids = spawns.map((_, i) => i + 1);
    const teamList = teamLists(teams, ids.length);
    const s: Record<string, unknown> = {
      terrain: terrain.id, scenario_id: slugId(name), name: lobbyName, anchors, teams: teamList,
      economy: { base_mass: baseMass, sites, per_site: perSite }, norush,
      patch: usePatch ? { max_slope: maxSlope, water_margin: waterMargin, seed: seed ?? spawns[0] ?? [grid / 2, grid / 2], causeways: bridges } : null,
    };
    if (relief.length) s.sculpt = relief.map((r) => r.op);
    if (mass.length) s.extra_mass = mass;
    if (rugged) s.rugged_edges = {};
    if (smooth) s.smooth = { keep_slope: maxSlope, water_margin: waterMargin, mode: "level" };
    if (minimap !== "donor") s.minimap = minimap;
    if (usePatch) s.strip_props = strip === "none" ? false : strip;
    if (props.length) s.props_add = props.map((q) => [q.bp, q.x, q.z, q.yaw, q.scale]);
    if (cuts.length) s.props_remove = cuts;
    const swaps = Object.entries(reskin).reduce<Record<string, string>>((acc, [oldD, neo]) => {
      const old = groundLayers.find((l) => l.d === oldD);
      return old ? { ...acc, ...reskinPaths(old, neo) } : acc;
    }, {});
    if (Object.keys(swaps).length) s.reskin = swaps;
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrain, edits, teams, name, baseMass, sites, perSite, norush, usePatch, maxSlope, waterMargin, rugged, smooth, minimap, strip, grid, groundLayers]);

  const build = async () => {
    if (!spec) return;
    setLog([]);
    setLastBuild(null);
    const r = await run("map", () => api.maptkBuild(spec), (x) => t("\"{name}\" gerado, verificado e ativado na biblioteca.", { name: x.manifest.name }));
    if (r) {
      setLastBuild(r.result);
      await refreshMods();
    }
  };

  const markers: Marker[] = useMemo(
    () => edits.spawns.map((p, i) => ({ p, color: TEAM_COLORS[team(i) % TEAM_COLORS.length], label: String(i + 1) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edits.spawns, teams],
  );
  const brushColor = isRelief(tool) ? RELIEF_COLOR[tool] : tool === "erase" || tool === "uncut" ? "#e5534b" : "#a3e635";
  const circleBrush = (isRelief(tool) && tool !== "ramp") || tool === "uncut" || (tool === "decor" && density > 1);
  const brush = useMemo(
    () => (tool === "orbit" ? null : circleBrush ? { shape: "circle" as const, radius, color: brushColor } : { shape: "point" as const, color: brushColor }),
    [tool, radius, brushColor, circleBrush],
  );

  if (!status) return <div className="card pad"><div className="bar indeterminate"><i /></div></div>;
  if (!status.ready) {
    return (
      <div className="card">
        <Empty icon="map" title={t("O Estúdio de Mapas precisa do Python")}>{tr(status.message)}</Empty>
      </div>
    );
  }

  const list = (terrains ?? []).filter((t) => kind === "all" || t.kind === kind);
  const active = TOOLS.find((t) => t.id === tool)!;
  const image2d = skin === "game" && relief3d?.texture ? relief3d.texture : preview?.dataUrl;
  const hasDepth = isRelief(tool) && tool !== "flatten" && tool !== "ramp";

  return (
    <div className="col" style={{ gap: 16 }}>
      <Notice kind="info">
        {t("Feito com o")} <b>SC2 Map Toolkit</b> {t("(plutonics72, MIT): ele monta o mapa sobre um terreno do jogo, posiciona massa só em chão construível e")}
        {" "}<b>{t("recusa gerar")}</b> {t("se algum ponto ficar inalcançável. Esculpir o relevo refaz a navegação automaticamente.")}
      </Notice>
      <div className="studio" style={{ gridTemplateColumns: "260px 1fr" }}>
        <div className="card">
          <div className="chips" style={{ padding: 12 }}>
            {(["skirmish", "campaign", "all"] as const).map((k) => (
              <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === "skirmish" ? t("Escaramuça") : k === "campaign" ? t("Campanha") : t("Todos")}</button>
            ))}
          </div>
          <div className="tree" role="listbox" aria-label={t("Terrenos")}>
            {terrains === null ? <p className="muted small" style={{ padding: 12 }}>{t("Lendo terrenos do jogo…")}</p> : list.map((ter) => (
              <button key={ter.id} role="option" className="tree-item wrap" aria-selected={terrain?.id === ter.id} onClick={() => pickTerrain(ter)} style={{ flexDirection: "column", alignItems: "flex-start", gap: 0, padding: "8px 14px" }}>
                <span><b>{ter.name ?? ter.id}</b></span>
                <span className="faint small">{ter.id}{ter.players ? t(", até {n} jogadores", { n: ter.players }) : ""}{ter.navmesh === "pocket" ? t(", precisa abrir terreno") : ""}</span>
              </button>
            ))}
          </div>
        </div>

        {!terrain ? (
          <div className="card"><Empty icon="terrain" title={t("Escolha um terreno")}>{t("Ele vira a base do seu mapa: relevo, água e texturas vêm do jogo. Depois é só esculpir, colocar bases e massa.")}</Empty></div>
        ) : (
          <div className="map-editor">
            <div className="col" style={{ gap: 10, minWidth: 0 }}>
              <div className="map-tools" role="toolbar" aria-label={t("Ferramentas")}>
                {TOOLS.filter((tl) => tl.id !== "orbit" || view === "3d").map((tl) => (
                  <button key={tl.id} className="map-tool" aria-pressed={tool === tl.id} title={t(tl.hint)} onClick={() => setTool(tl.id)}
                    style={isRelief(tl.id) ? { ["--tc" as string]: RELIEF_COLOR[tl.id] } : undefined}>
                    <Icon name={tl.icon} size={19} />
                    <span>{t(tl.label)}{tl.id === "spawn" ? ` ${edits.spawns.length}` : tl.id === "mass" && edits.mass.length ? ` ${edits.mass.length}` : ""}</span>
                  </button>
                ))}
                <span className="map-tools-sep" />
                <button className="btn icon-btn sm-icon" title={t("Desfazer (Ctrl+Z)")} aria-label={t("Desfazer")} disabled={!hist.past.length} onClick={undo}><Icon name="undo" /></button>
                <button className="btn icon-btn sm-icon" title={t("Refazer (Ctrl+Y)")} aria-label={t("Refazer")} disabled={!hist.future.length} onClick={redo}><Icon name="redo" /></button>
              </div>

              <div className="map-brush">
                <Icon name={active.icon} style={{ color: isRelief(tool) ? RELIEF_COLOR[tool] : "var(--primary)" }} />
                <span className="muted small" style={{ flex: 1, minWidth: 200 }}>{t(active.hint)}</span>
                {isRelief(tool) && tool !== "ramp" && (
                  <label className="range" style={{ gridTemplateColumns: "44px 120px 36px" }}><span>{t("Raio")}</span>
                    <input type="range" min={12} max={200} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><output>{radius}</output></label>
                )}
                {(tool === "uncut" || (tool === "decor" && density > 1)) && (
                  <label className="range" style={{ gridTemplateColumns: "44px 120px 36px" }}><span>{t("Raio")}</span>
                    <input type="range" min={8} max={200} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><output>{radius}</output></label>
                )}
                {tool === "decor" && (
                  <>
                    <label className="range" style={{ gridTemplateColumns: "60px 110px 30px" }}><span>{t("Por clique")}</span>
                      <input type="range" min={1} max={30} value={density} onChange={(e) => setDensity(Number(e.target.value))} /><output>{density}</output></label>
                    <label className="range" style={{ gridTemplateColumns: "62px 100px 40px" }}><span>{t("Variação")}</span>
                      <input type="range" min={0} max={60} step={5} value={sizeVar} onChange={(e) => setSizeVar(Number(e.target.value))} /><output>±{sizeVar}%</output></label>
                  </>
                )}
                {tool === "ramp" && (
                  <label className="range" style={{ gridTemplateColumns: "56px 120px 36px" }}><span>{t("Largura")}</span>
                    <input type="range" min={24} max={200} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><output>{Math.max(24, Math.round(radius / 2))}</output></label>
                )}
                {hasDepth && (
                  <label className="range" style={{ gridTemplateColumns: "48px 120px 36px" }}><span>{tool === "valley" ? t("Fundo") : t("Altura")}</span>
                    <input type="range" min={2} max={80} value={strength} onChange={(e) => setStrength(Number(e.target.value))} /><output>{strength}</output></label>
                )}
              </div>

              <div className="map-view">
                <div className="map-view-bar">
                  <div className="seg" role="group" aria-label={t("Visualização")}>
                    <button className="btn" aria-pressed={view === "3d"} disabled={!relief3d} onClick={() => setView("3d")}><Icon name="view_in_ar" size={17} /> 3D</button>
                    <button className="btn" aria-pressed={view === "2d"} onClick={() => { setView("2d"); if (tool === "orbit") setTool("spawn"); }}><Icon name="map" size={17} /> 2D</button>
                  </div>
                  <div className="seg" role="group" aria-label={t("Textura")}>
                    <button className="btn" aria-pressed={skin === "game"} disabled={!relief3d?.texture} onClick={() => setSkin("game")}><Icon name="texture" size={17} /> {t("Textura do jogo")}</button>
                    <button className="btn" aria-pressed={skin === "nav"} onClick={() => setSkin("nav")}><Icon name="grid_on" size={17} /> {t("Navegação")}</button>
                  </div>
                  <button className="btn sm" aria-pressed={showDecor} onClick={() => setShowDecor((v) => !v)} title={t("Mostrar ou esconder árvores, pedras e prédios na prévia")}>
                    <Icon name={showDecor ? "park" : "visibility_off"} size={17} /> {t("Decorações")}
                  </button>
                  {view === "3d" && (
                    <label className="range" style={{ gridTemplateColumns: "54px 90px 34px", marginLeft: "auto" }}><span>{t("Relevo")}</span>
                      <input type="range" min={1} max={4} step={0.25} value={exag} onChange={(e) => setExag(Number(e.target.value))} /><output>{exag}×</output></label>
                  )}
                </div>

                {view === "3d" && relief3d && heights ? (
                  <Suspense fallback={<div className="map-3d"><div className="bar indeterminate" style={{ margin: 20 }}><i /></div></div>}>
                    <MapView3D
                      size={relief3d.size} grid={relief3d.grid} heights={heights} waterLevel={water}
                      texture={skin === "game" ? relief3d.texture : preview?.dataUrl ?? null} exaggeration={exag}
                      spawns={markers} mass={edits.mass} bridges={edits.bridges} seed={edits.seed}
                      decor={decor} cuts={edits.cuts}
                      brush={brush} drag={drag} orbit={tool === "orbit"} onPointer={onPointer}
                    />
                  </Suspense>
                ) : view === "3d" ? (
                  <div className="map-3d"><div className="bar indeterminate" style={{ margin: 20 }}><i /></div></div>
                ) : (
                  <div className="map-stage" ref={stage}
                    onPointerDown={(e) => { if (e.button !== 0) return; down2d.current = true; e.currentTarget.setPointerCapture(e.pointerId); onPointer("down", toWorld(e)); }}
                    onPointerMove={(e) => { const p = toWorld(e); setCursor2d(p); if (down2d.current) onPointer("move", p); }}
                    onPointerUp={(e) => { if (!down2d.current) return; down2d.current = false; onPointer("up", toWorld(e)); }}
                    onPointerLeave={() => setCursor2d(null)}
                    role="application" aria-label={t("Mapa: clique para editar")}>
                    {image2d ? <img src={image2d} alt={t("Terreno {id}", { id: terrain.id })} draggable={false} /> : <div className="bar indeterminate" style={{ margin: 20 }}><i /></div>}
                    <svg viewBox={`0 0 ${grid} ${grid}`}>
                      {edits.relief.map((r, i) => {
                        const sh = reliefShape(r.op), c = RELIEF_COLOR[r.kind];
                        return sh.rect
                          ? <rect key={i} x={sh.rect[0]} y={sh.rect[2]} width={sh.rect[1] - sh.rect[0]} height={sh.rect[3] - sh.rect[2]} fill={`${c}33`} stroke={c} strokeWidth={3} />
                          : <circle key={i} cx={sh.c[0]} cy={sh.c[1]} r={sh.r} fill={`${c}26`} stroke={c} strokeWidth={2.5} />;
                      })}
                      {edits.cuts.map(([x, z, r], i) => <circle key={`c${i}`} cx={x} cy={z} r={r} fill="rgba(229,83,75,.12)" stroke="#e5534b" strokeWidth={2} strokeDasharray="8 5" />)}
                      {showDecor && edits.props.map((q, i) => <circle key={`p${i}`} cx={q.x} cy={q.z} r={4} fill={decorKind(q.bp) === "tree" ? "#4f9a46" : decorKind(q.bp) === "rock" ? "#9a9388" : "#c2a77f"} stroke="#0d1b26" strokeWidth={1.5} />)}
                      {edits.bridges.map(([x0, x1, z0, z1], i) => <rect key={i} x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="rgba(242,179,61,.25)" stroke="#f2b33d" strokeWidth={3} strokeDasharray="10 6" />)}
                      {drag && <rect x={Math.min(drag.a[0], drag.b[0])} y={Math.min(drag.a[1], drag.b[1])} width={Math.abs(drag.b[0] - drag.a[0])} height={Math.abs(drag.b[1] - drag.a[1])} fill="rgba(242,179,61,.2)" stroke="#f2b33d" strokeWidth={3} />}
                      {edits.seed && <g stroke="#fff" strokeWidth={4}><line x1={edits.seed[0] - 18} y1={edits.seed[1]} x2={edits.seed[0] + 18} y2={edits.seed[1]} /><line x1={edits.seed[0]} y1={edits.seed[1] - 18} x2={edits.seed[0]} y2={edits.seed[1] + 18} /></g>}
                      {edits.mass.map((p, i) => <path key={i} d={`M${p[0]} ${p[1] - 13}L${p[0] + 9} ${p[1]}L${p[0]} ${p[1] + 13}L${p[0] - 9} ${p[1]}Z`} fill="#7bd88f" stroke="#0d1b26" strokeWidth={3} />)}
                      {edits.spawns.map((p, i) => (
                        <g key={i}>
                          <circle cx={p[0]} cy={p[1]} r={26} fill={TEAM_COLORS[team(i) % TEAM_COLORS.length]} stroke="#0d1b26" strokeWidth={5} />
                          <text x={p[0]} y={p[1] + 10} textAnchor="middle" fontSize={30} fontWeight={700} fill="#0d1b26" fontFamily="Chakra Petch">{i + 1}</text>
                        </g>
                      ))}
                      {cursor2d && brush && <circle cx={cursor2d[0]} cy={cursor2d[1]} r={brush.shape === "circle" ? brush.radius : 10} fill="none" stroke={brush.color} strokeWidth={3} />}
                    </svg>
                  </div>
                )}
                <div className="legend">
                  {skin === "nav" ? (
                    <>
                      <span><i style={{ background: "#7f9a6f" }} />{t("chão onde unidades andam")}</span>
                      <span><i style={{ background: "#9c5450" }} />{t("bloqueado")}</span>
                      <span><i style={{ background: "#2f5f8c" }} />{t("água")}</span>
                      {preview && <span>{t("{pct}% navegável no original", { pct: dec(preview.navigablePct) })}</span>}
                    </>
                  ) : (
                    <>
                      <span><i style={{ background: "#7bd88f", transform: "rotate(45deg) scale(.8)" }} />{t("massa manual")}</span>
                      <span><i style={{ background: TEAM_COLORS[0], borderRadius: 99 }} />{t("bases")}</span>
                      <span>{t("água no nível {n}", { n: dec(round1(water)) })}</span>
                      {edits.relief.length > 0 && <span>{t("a prévia do relevo é aproximada; o jogo usa a malha completa")}</span>}
                    </>
                  )}
                </div>
              </div>

              {edits.relief.length > 0 && (
                <section className="card pad col" style={{ gap: 8 }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <b>{t("Relevo esculpido ({n})", { n: edits.relief.length })}</b>
                    <button className="btn text sm" onClick={() => commit((e) => ({ ...e, relief: [] }))}><Icon name="clear_all" size={17} /> {t("Limpar relevo")}</button>
                  </div>
                  <div className="relief-list">
                    {edits.relief.map((r, i) => {
                      const sh = reliefShape(r.op);
                      return (
                        <span key={i} className="relief-chip" style={{ ["--tc" as string]: RELIEF_COLOR[r.kind] }}>
                          <Icon name={RELIEF_ICON[r.kind]} size={15} />
                          {t(RELIEF_LABEL[r.kind])} <span className="faint">{Math.round(sh.c[0])}, {Math.round(sh.c[1])}</span>
                          <button aria-label={t("Remover {name}", { name: t(RELIEF_LABEL[r.kind]) })} onClick={() => commit((e) => ({ ...e, relief: e.relief.filter((_, j) => j !== i) }))}><Icon name="close" size={14} /></button>
                        </span>
                      );
                    })}
                  </div>
                </section>
              )}
              {(tool === "decor" || edits.props.length > 0 || edits.cuts.length > 0) && (
                <section className="card pad col" style={{ gap: 10 }}>
                  <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                    <b><Icon name="park" size={18} /> {t("Decorações")}</b>
                    <span className="faint small">
                      {edits.props.length === 1 ? t("1 nova") : t("{n} novas", { n: edits.props.length })}{removedCount ? (removedCount === 1 ? t(", 1 do terreno retirada") : t(", {n} do terreno retiradas", { n: removedCount })) : ""}
                      {donor ? t(", {n} no terreno original", { n: donor.props.length }) : ""}
                    </span>
                    <div className="row" style={{ gap: 6 }}>
                      {edits.props.length > 0 && <button className="btn text sm" onClick={() => commit((e) => ({ ...e, props: [] }))}><Icon name="delete_sweep" size={17} /> {t("Tirar as novas")}</button>}
                      {edits.cuts.length > 0 && <button className="btn text sm" onClick={() => commit((e) => ({ ...e, cuts: [] }))}><Icon name="restore" size={17} /> {t("Devolver as do terreno")}</button>}
                    </div>
                  </div>
                  {tool !== "decor" && <p className="faint small">{t("Use a ferramenta")} <b>{t("Decorar")}</b> {t("para escolher árvores, pedras, prédios e restos de unidades de qualquer mapa do jogo.")}</p>}
                  {tool === "decor" && <PropPicker props={assets?.props ?? null} used={usedProps} selected={propBp} onSelect={setPropBp} />}
                  <p className="faint small">{t("Decorações são visuais: não bloqueiam a passagem das unidades no jogo.")}</p>
                </section>
              )}

              <section className="card pad col" style={{ gap: 10 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b><Icon name="format_paint" size={18} /> {t("Texturas do chão")}</b>
                  {Object.keys(edits.reskin).length > 0 && <button className="btn text sm" onClick={() => commit((e) => ({ ...e, reskin: {} }))}><Icon name="restore" size={17} /> {t("Voltar todas")}</button>}
                </div>
                <p className="faint small">{t("Pinte o mapa trocando cada camada do chão (grama, terra, rocha…) por uma de outro mapa do jogo, como neve ou deserto. A troca vale em todo lugar onde a camada aparece.")}</p>
                {assets === null ? <div className="bar indeterminate"><i /></div> : (
                  <GroundTextures layers={groundLayers} all={assets.layers} reskin={edits.reskin}
                    onChange={(oldD, neo) => commit((e) => {
                      const reskin = { ...e.reskin };
                      if (neo) reskin[oldD] = neo; else delete reskin[oldD];
                      return { ...e, reskin };
                    })} />
                )}
                {Object.keys(edits.reskin).length > 0 && <p className="faint small">{t("A prévia mostra a textura original; a troca aparece no jogo.")}</p>}
              </section>
            </div>

            <section className="card pad col map-side">
              <Field label={t("Nome no lobby")} hint={t("Aparece como “{name}”. Id: {id}", { name: lobbyName, id: slugId(name) })}>
                <input className="input" value={name} maxLength={48} onChange={(e) => setName(e.target.value)} />
              </Field>
              <Field label={t("Times")}>
                <select className="select" value={teams} onChange={(e) => setTeams(e.target.value as MapTeams)}>
                  {TEAM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
                </select>
              </Field>

              <div className="side-group">
                <span className="overline"><Icon name="diamond" size={15} /> {t("Economia")}</span>
                <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <Field label={t("Na base")}><input className="input" type="number" min={0} max={8} value={baseMass} onChange={(e) => setBaseMass(Number(e.target.value))} /></Field>
                  <Field label={t("Expansões")}><input className="input" type="number" min={0} max={20} value={sites} onChange={(e) => setSites(Number(e.target.value))} /></Field>
                  <Field label={t("Por expansão")}><input className="input" type="number" min={1} max={6} value={perSite} onChange={(e) => setPerSite(Number(e.target.value))} /></Field>
                </div>
                <p className="faint small">
                  {t("Massa automática: {base} por base e {sites}×{per} nas expansões.", { base: baseMass, sites, per: perSite })}{" "}
                  {edits.mass.length === 1 ? t("Manual: 1 ponto (ferramenta Massa).") : t("Manual: {n} pontos (ferramenta Massa).", { n: edits.mass.length })}
                </p>
              </div>
              <Field label={t("Raio sem ataque inicial")}><input className="input" type="number" min={0} max={200} value={norush} onChange={(e) => setNorush(Number(e.target.value))} /></Field>

              <div className="side-group">
                <span className="overline"><Icon name="terrain" size={15} /> {t("Terreno")}</span>
                <div className="setting-row">
                  <div className="txt"><b>{t("Borda rochosa")}</b><span className="muted small">{t("Fecha o mapa com uma faixa de rochas intransponível (visível em mapas de escaramuça).")}</span></div>
                  <Switch checked={rugged} onChange={setRugged} label={t("Borda rochosa")} />
                </div>
                <div className="setting-row">
                  <div className="txt"><b>{t("Aplainar para construir")}</b><span className="muted small">{t("Nivela o chão suave do mapa inteiro; mantém penhascos e água.")}</span></div>
                  <Switch checked={smooth} onChange={setSmooth} label={t("Aplainar terreno")} />
                </div>
                <div className="setting-row">
                  <div className="txt">
                    <b>{t("Abrir terreno")}</b>
                    <span className="muted small">{editsTerrain ? t("Ligado automaticamente: o relevo mudou, então a navegação é refeita.") : t("Reescreve a navegação para todo o chão firme virar área jogável. Obrigatório em mapas de campanha.")}</span>
                  </div>
                  <Switch checked={usePatch} onChange={setPatch} disabled={editsTerrain} label={t("Abrir terreno")} />
                </div>
                {usePatch && (
                  <>
                    <div className="grid-2" style={{ gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <Field label={t("Inclinação máxima")}><input className="input" type="number" step={0.5} min={1} max={20} value={maxSlope} onChange={(e) => setMaxSlope(Number(e.target.value))} /></Field>
                      <Field label={t("Margem da água")}><input className="input" type="number" step={0.5} min={0} max={20} value={waterMargin} onChange={(e) => setWaterMargin(Number(e.target.value))} /></Field>
                    </div>
                    <Field label={t("Objetos animados do cenário")}>
                      <select className="select" value={strip} onChange={(e) => setStrip(e.target.value as typeof strip)}>
                        <option value="moving">{t("Parar os que se movem")}</option>
                        <option value="all">{t("Remover todos")}</option>
                        <option value="none">{t("Manter como estão")}</option>
                      </select>
                    </Field>
                  </>
                )}
              </div>
              <Field label={t("Minimapa do lobby")}>
                <select className="select" value={minimap} onChange={(e) => setMinimap(e.target.value as typeof minimap)}>
                  <option value="donor">{t("Original do terreno")}</option>
                  <option value="desert">{t("Gerar: deserto")}</option>
                  <option value="snow">{t("Gerar: neve")}</option>
                  <option value="dark">{t("Gerar: rocha escura")}</option>
                </select>
              </Field>
              {edits.spawns.length < 2 && <Notice kind="info">{t("Coloque pelo menos duas bases com a ferramenta Bases.")}</Notice>}
              <button className="btn primary" disabled={edits.spawns.length < 2 || !name.trim() || busy.map} onClick={build}>
                <Icon name="construction" size={19} /> {busy.map ? t("Gerando e verificando…") : t("Gerar mapa")}
              </button>
              {lastBuild && (
                <Notice kind={lastBuild.warnings?.length ? "warn" : "ok"}>
                  {typeof lastBuild.mass === "number" ? <><b>{lastBuild.mass + (lastBuild.extraMass ?? 0)}</b> {t("pontos de massa no total")}{lastBuild.extraMass ? t(", {n} colocados por você", { n: lastBuild.extraMass }) : ""}. </> : null}
                  {lastBuild.propsAdded || lastBuild.propsRemoved ? <>{t("{added} decorações novas, {removed} retiradas.", { added: lastBuild.propsAdded ?? 0, removed: lastBuild.propsRemoved ?? 0 })} </> : null}
                  {lastBuild.reskinned ? <>{lastBuild.reskinned === 1 ? t("1 textura do chão trocada.") : t("{n} texturas do chão trocadas.", { n: lastBuild.reskinned })} </> : null}
                  {lastBuild.warnings?.length ? <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{lastBuild.warnings.slice(0, 8).map((w, i) => <li key={i}>{tr(w)}</li>)}</ul> : t("Tudo verificado e alcançável.")}
                </Notice>
              )}
              {log.length > 0 && <div className="log mono small">{log.map((l, i) => <div key={i}>{l}</div>)}</div>}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
