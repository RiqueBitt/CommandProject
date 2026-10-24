// Editor de mapas em aba própria, no estilo de um estúdio de jogo: faixa de ferramentas, recursos
// à esquerda, visão 3D no centro, objetos e propriedades à direita. O documento é salvo como
// projeto (salvamento automático, versões); "Gerar mapa" usa o SC2 Map Toolkit.
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DecorPoint, Marker } from "../../components/MapView3D";
import { registerCustomProp } from "../../components/propModels";
import {
  ContextMenu, Panel, ProjectBar, PropertyGrid, Ribbon, RibbonButton, RibbonGroup, StatusBar, StudioLayout, Tree,
  useActiveEditor, useHotkeys, type CtxItem, type Prop, type TreeNode,
} from "../../components/studio/kit";
import { Empty, Icon, Notice } from "../../components/ui";
import { api, onProgress } from "../../lib/api";
import { errorText, load, useStore } from "../../lib/store";
import { useTabs } from "../../lib/tabs";
import type { CreationMeta, MapAssets, MapBuildResult, MaptkStatus, Terrain, TerrainPreview } from "../../lib/types";
import { useProject } from "../../lib/useProject";
import { GroundTextures, PropPicker } from "../studio/MapDecor";
import {
  applyRelief, cutTester, decodeHeights, decorKind, heightAt, meanInDisc, RELIEF_LABEL, reliefShape, reskinPaths, round1,
  type Edits, type GroundLayer, type PlacedProp, type Pt, type Relief, type Relief3D, type ReliefKind,
} from "../studio/mapEdit";
import { migrateMap, newMapDoc, type MapDoc } from "./docs";

const MapView3D = lazy(() => import("../../components/MapView3D"));

type Tool = "select" | "orbit" | "spawn" | "mass" | ReliefKind | "bridge" | "decor" | "uncut" | "seed" | "erase";
const TEAM_COLORS = ["#5aa9e6", "#e5534b", "#7bd88f", "#c78bff"];
const RELIEF_COLOR: Record<ReliefKind, string> = { hill: "#e3a857", valley: "#4fa3e0", plateau: "#d97757", flatten: "#c9d1d9", ramp: "#f2b33d" };
const RELIEF_ICON: Record<ReliefKind, string> = { hill: "filter_hdr", valley: "water", plateau: "landscape", flatten: "straighten", ramp: "stairs" };
const isRelief = (t: Tool): t is ReliefKind => t in RELIEF_LABEL;
const MAX_MASS = 200, MAX_PROPS = 5000, MAX_CUTS = 400;
type DonorProp = [number, number, number, number, number, number];

const HINT: Record<Tool, string> = {
  select: "Clique para selecionar (Shift soma à seleção). Arraste um objeto selecionado para movê-lo. Del apaga, Ctrl+D duplica.",
  orbit: "Arraste para girar a câmera. Botão do meio move, roda dá zoom.",
  spawn: "Clique para colocar a base inicial de cada jogador (até 8).",
  mass: "Clique para colocar pontos de extração de massa.",
  hill: "Clique ou arraste para subir o terreno em rampa suave.",
  valley: "Clique ou arraste para cavar. Abaixo da água vira lago ou rio.",
  plateau: "Levanta um platô de topo plano com paredes íngremes.",
  flatten: "Nivela a área na altura média: bom para construir.",
  ramp: "Arraste do ponto baixo ao alto para ligar um platô ao chão.",
  bridge: "Arraste um retângulo sobre a água: vau que as unidades atravessam.",
  decor: "Escolha uma decoração na caixa de recursos e clique; arraste para espalhar.",
  uncut: "Clique ou arraste para tirar decorações do terreno original.",
  seed: "Ponto de onde a navegação é recalculada.",
  erase: "Clique sobre qualquer item para apagá-lo.",
};

function slugId(name: string) {
  const s = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12);
  return "SC2_" + (s.length >= 2 ? s : "MAPA");
}

/** slug estável de decoração própria a partir do id do projeto de modelo */
export function customSlug(creation: string) {
  let h = 2166136261;
  for (const c of creation) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return "cpm" + (h >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

type Sel = string; // "spawn:0", "mass:3", "relief:2", "bridge:0", "prop:5", "cut:1", "seed", "map"

export default function MapStudio({ id }: { id: string }) {
  const p = useProject<MapDoc>(id, migrateMap, newMapDoc());
  const active = useActiveEditor();
  const doc = p.doc;
  const edits = doc.edits;
  const { run, refreshMods, toast } = useStore.getState();
  const busy = useStore((s) => s.busy[`map:${id}`]);
  const renameTab = useTabs((s) => s.rename);

  const [status, setStatus] = useState<MaptkStatus | null>(null);
  const [terrains, setTerrains] = useState<Terrain[] | null>(null);
  const [preview, setPreview] = useState<TerrainPreview | null>(null);
  const [relief3d, setRelief3d] = useState<Relief3D | null>(null);
  const [donor, setDonor] = useState<{ props: DonorProp[]; kinds: string[] } | null>(null);
  const [assets, setAssets] = useState<MapAssets | null>(null);
  const [models, setModels] = useState<CreationMeta[] | null>(null);
  const [ribbon, setRibbon] = useState("home");
  const [left, setLeft] = useState<"decor" | "mine" | "ground">("decor");
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [skin, setSkin] = useState<"game" | "nav">("game");
  const [exag, setExag] = useState(1.5);
  const [tool, setTool] = useState<Tool>("select");
  const [radius, setRadius] = useState(60);
  const [strength, setStrength] = useState(20);
  const [propBp, setPropBp] = useState<string | null>(null);
  const [density, setDensity] = useState(1);
  const [sizeVar, setSizeVar] = useState(25);
  const [showDecor, setShowDecor] = useState(true);
  const [sel, setSel] = useState<Set<Sel>>(new Set(["map"]));
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [filter, setFilter] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number; id: Sel } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [lastBuild, setLastBuild] = useState<MapBuildResult | null>(null);
  const snapshot = useRef<(() => string | null) | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const loadedTerrain = useRef<string | null>(null);

  // ------------------------------------------------------------ dados do jogo
  useEffect(() => {
    void api.maptkStatus().then(async (s) => {
      setStatus(s);
      if (s.ready) setTerrains((await load(() => api.maptkCatalog()))?.terrains ?? []);
    });
    void api.mapAssets().then(setAssets).catch(() => setAssets({ props: [], layers: [] }));
    void api.creations().then((l) => setModels(l.filter((m) => m.kind === "model"))).catch(() => setModels([]));
  }, []);
  useEffect(() => {
    const off = onProgress((e) => e.task === `map:${id}` && setLog((l) => [...l.slice(-200), e.message]));
    return () => { void off.then((f) => f()); };
  }, [id]);
  useEffect(() => {
    for (const m of doc.models) registerCustomProp(m.bp, m.creation);
  }, [doc.models]);

  useEffect(() => {
    const t = doc.terrain;
    if (p.status !== "ready" || !t || loadedTerrain.current === t) return;
    loadedTerrain.current = t;
    setPreview(null);
    setRelief3d(null);
    setDonor(null);
    void Promise.all([load(() => api.maptkPreview(t, 512)), load(() => api.maptkTerrain3d(t, 256))]).then(([pv, r]) => {
      if (loadedTerrain.current !== t) return;
      setPreview(pv ?? null);
      if (r) {
        setRelief3d({ size: r.size, grid: r.grid, heights: decodeHeights(r.heights, r.heightScale), waterLevel: r.waterLevel, yMin: r.yMin, yMax: r.yMax, texture: r.texture });
        setDonor({ props: r.props ?? [], kinds: r.propKinds ?? [] });
      } else setView("2d");
    });
  }, [doc.terrain, p.status]);

  const terrain = terrains?.find((t) => t.id === doc.terrain) ?? null;
  const grid = relief3d?.grid ?? preview?.grid ?? 1024;
  const water = relief3d?.waterLevel ?? preview?.waterLevel ?? 0;
  const heights = useMemo(() => (relief3d ? applyRelief(relief3d, relief3d.heights, edits.relief, doc.rugged, water) : null), [relief3d, edits.relief, doc.rugged, water]);

  // ------------------------------------------------------------ edição
  const setDoc = useCallback((fn: (d: MapDoc) => MapDoc) => p.commit(fn), [p]);
  const setEdits = useCallback((fn: (e: Edits) => Edits, amend = false) => (amend ? p.amend : p.commit)((d) => {
    const e = fn(d.edits);
    return e === d.edits ? d : { ...d, edits: e };
  }), [p]);

  const ctxRef = useRef({ tool, radius, strength, heights, relief3d, edits, drag, propBp, density, sizeVar, sel });
  ctxRef.current = { tool, radius, strength, heights, relief3d, edits, drag, propBp, density, sizeVar, sel };
  const stroke = useRef<Pt | null>(null);
  const moving = useRef<{ from: Pt; ids: Sel[]; started: boolean } | null>(null);

  const hAt = (q: Pt) => {
    const { heights: h, relief3d: r } = ctxRef.current;
    return h && r ? heightAt(r, h, q[0], q[1]) : water;
  };
  const reliefOp = (k: ReliefKind, q: Pt): Relief | null => {
    const { radius: rad, strength: s, heights: h, relief3d: r } = ctxRef.current;
    const [x, z] = q;
    const y = hAt(q);
    if (k === "hill") return { kind: k, op: ["cone", x, z, rad, round1(y + s), "raise"] };
    if (k === "valley") return { kind: k, op: ["cone", x, z, rad, round1(Math.max(0, y - s)), "lower"] };
    if (k === "plateau") return { kind: k, op: ["disc", x, z, rad, round1(y + s), "raise"] };
    if (k === "flatten") return { kind: k, op: ["disc", x, z, rad, round1(h && r ? meanInDisc(r, h, x, z, rad) : y), "set"] };
    return null;
  };

  /** objeto mais perto do ponto (para selecionar com um clique) */
  const pick = (q: Pt, e: Edits): Sel | null => {
    const d = (a: Pt) => Math.hypot(a[0] - q[0], a[1] - q[1]);
    let best: [number, Sel] | null = null;
    const take = (dist: number, max: number, s: Sel) => { if (dist <= max && (!best || dist < best[0])) best = [dist, s]; };
    e.spawns.forEach((s, i) => take(d(s), 30, `spawn:${i}`));
    e.mass.forEach((s, i) => take(d(s), 20, `mass:${i}`));
    e.props.forEach((s, i) => take(d([s.x, s.z]), 12, `prop:${i}`));
    if (e.seed) take(d(e.seed), 22, "seed");
    if (best) return (best as [number, Sel])[1];
    e.bridges.forEach(([x0, x1, z0, z1], i) => { if (q[0] >= x0 && q[0] <= x1 && q[1] >= z0 && q[1] <= z1) best = [0, `bridge:${i}`]; });
    for (let i = e.relief.length - 1; i >= 0 && !best; i--) {
      const sh = reliefShape(e.relief[i].op);
      const inside = sh.rect ? q[0] >= sh.rect[0] && q[0] <= sh.rect[1] && q[1] >= sh.rect[2] && q[1] <= sh.rect[3] : d(sh.c) <= sh.r;
      if (inside) best = [0, `relief:${i}`];
    }
    e.cuts.forEach(([x, z, r], i) => { if (!best && Math.hypot(x - q[0], z - q[1]) <= r) best = [0, `cut:${i}`]; });
    return best ? (best as [number, Sel])[1] : null;
  };

  /** move os objetos selecionados por (dx, dz) */
  const moveSel = (e: Edits, ids: Sel[], dx: number, dz: number): Edits => {
    const clamp = (v: number) => Math.max(0, Math.min(grid, Math.round(v * 10) / 10));
    const mv = (q: Pt): Pt => [clamp(q[0] + dx), clamp(q[1] + dz)];
    const n = { ...e, spawns: [...e.spawns], mass: [...e.mass], props: [...e.props], bridges: [...e.bridges], relief: [...e.relief], cuts: [...e.cuts] };
    for (const s of ids) {
      const [k, iS] = s.split(":");
      const i = Number(iS);
      if (k === "spawn") n.spawns[i] = mv(n.spawns[i]);
      else if (k === "mass") n.mass[i] = mv(n.mass[i]);
      else if (k === "prop") { const q = n.props[i]; const [x, z] = mv([q.x, q.z]); n.props[i] = { ...q, x, z }; }
      else if (k === "seed" && n.seed) n.seed = mv(n.seed);
      else if (k === "cut") { const [x, z, r] = n.cuts[i]; n.cuts[i] = [clamp(x + dx), clamp(z + dz), r]; }
      else if (k === "bridge") { const [x0, x1, z0, z1] = n.bridges[i]; n.bridges[i] = [clamp(x0 + dx), clamp(x1 + dx), clamp(z0 + dz), clamp(z1 + dz)]; }
      else if (k === "relief") {
        const r = n.relief[i];
        const op = [...r.op] as typeof r.op;
        if (op[0] === "disc" || op[0] === "cone") { op[1] = clamp(op[1] + dx); op[2] = clamp(op[2] + dz); }
        else { op[1] = clamp(op[1] + dx); op[2] = clamp(op[2] + dz); op[3] = clamp(op[3] + dx); op[4] = clamp(op[4] + dz); }
        n.relief[i] = { ...r, op };
      }
    }
    return n;
  };

  const removeSel = (e: Edits, ids: Sel[]): Edits => {
    const drop = (k: string) => new Set(ids.filter((s) => s.startsWith(k + ":")).map((s) => Number(s.split(":")[1])));
    const ds = drop("spawn"), dm = drop("mass"), dp = drop("prop"), db = drop("bridge"), dr = drop("relief"), dc = drop("cut");
    return {
      ...e,
      spawns: e.spawns.filter((_, i) => !ds.has(i)), mass: e.mass.filter((_, i) => !dm.has(i)), props: e.props.filter((_, i) => !dp.has(i)),
      bridges: e.bridges.filter((_, i) => !db.has(i)), relief: e.relief.filter((_, i) => !dr.has(i)), cuts: e.cuts.filter((_, i) => !dc.has(i)),
      seed: ids.includes("seed") ? null : e.seed,
    };
  };

  const duplicateSel = (e: Edits, ids: Sel[]): [Edits, Sel[]] => {
    const n = { ...e, spawns: [...e.spawns], mass: [...e.mass], props: [...e.props], cuts: [...e.cuts], bridges: [...e.bridges], relief: [...e.relief] };
    const out: Sel[] = [];
    const off = 16;
    for (const s of ids) {
      const [k, iS] = s.split(":");
      const i = Number(iS);
      if (k === "spawn" && n.spawns.length < 8) { n.spawns.push([e.spawns[i][0] + off, e.spawns[i][1] + off]); out.push(`spawn:${n.spawns.length - 1}`); }
      else if (k === "mass" && n.mass.length < MAX_MASS) { n.mass.push([e.mass[i][0] + off, e.mass[i][1] + off]); out.push(`mass:${n.mass.length - 1}`); }
      else if (k === "prop" && n.props.length < MAX_PROPS) { const q = e.props[i]; n.props.push({ ...q, x: q.x + off, z: q.z + off }); out.push(`prop:${n.props.length - 1}`); }
      else if (k === "cut") { const [x, z, r] = e.cuts[i]; n.cuts.push([x + off, z + off, r]); out.push(`cut:${n.cuts.length - 1}`); }
      else if (k === "bridge") { const [x0, x1, z0, z1] = e.bridges[i]; n.bridges.push([x0 + off, x1 + off, z0 + off, z1 + off]); out.push(`bridge:${n.bridges.length - 1}`); }
      else if (k === "relief") { n.relief.push(e.relief[i]); out.push(`relief:${n.relief.length - 1}`); }
    }
    return [n, out];
  };

  const scatter = (q: Pt): PlacedProp[] => {
    const { propBp: bp, density: n, radius: rad, sizeVar: v } = ctxRef.current;
    if (!bp) return [];
    const out: PlacedProp[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, d = n === 1 ? 0 : Math.sqrt(Math.random()) * rad;
      const x = Math.round(Math.max(2, Math.min(grid - 2, q[0] + Math.cos(a) * d)) * 10) / 10;
      const z = Math.round(Math.max(2, Math.min(grid - 2, q[1] + Math.sin(a) * d)) * 10) / 10;
      out.push({ bp, x, z, yaw: Math.round(Math.random() * 360), scale: round1(Math.max(0.3, 1 + (Math.random() * 2 - 1) * (v / 100)) * 100) / 100 });
    }
    return out;
  };

  const onPointer = useCallback((type: "down" | "move" | "up", q: Pt | null) => {
    const { tool: t, radius: rad, drag: d, edits: e, sel: s } = ctxRef.current;
    if (t === "orbit") return;
    if (q) setCursor(q);
    if (t === "select") {
      if (type === "down" && q) {
        const hit = pick(q, e);
        if (!hit) { setSel(new Set(["map"])); moving.current = null; return; }
        const ids = s.has(hit) ? [...s].filter((x) => x !== "map") : [hit];
        if (!s.has(hit)) setSel(new Set([hit]));
        moving.current = { from: q, ids, started: false };
      } else if (type === "move" && q && moving.current) {
        const m = moving.current;
        const dx = q[0] - m.from[0], dz = q[1] - m.from[1];
        if (Math.hypot(dx, dz) < 1) return;
        // o primeiro passo do arrasto entra no histórico; o resto continua o mesmo passo
        moving.current = { ...m, from: q, started: true };
        setEdits((ed) => moveSel(ed, m.ids, dx, dz), m.started);
      } else if (type === "up") moving.current = null;
      return;
    }
    if (t === "ramp" || t === "bridge") {
      if (type === "down" && q) setDrag({ a: q, b: q });
      else if (type === "move" && q && d) setDrag({ ...d, b: q });
      else if (type === "up" && d) {
        const b = q ?? d.b;
        setDrag(null);
        let [x0, x1] = [d.a[0], b[0]].sort((u, v) => u - v);
        let [z0, z1] = [d.a[1], b[1]].sort((u, v) => u - v);
        if (t === "bridge") {
          if (x1 - x0 > 6 && z1 - z0 > 6) setEdits((ed) => ({ ...ed, bridges: [...ed.bridges, [x0, x1, z0, z1]] }));
          return;
        }
        if (Math.hypot(b[0] - d.a[0], b[1] - d.a[1]) < 16) return;
        const alongX = x1 - x0 >= z1 - z0;
        const minW = Math.max(24, Math.round(rad / 2));
        if (alongX && z1 - z0 < minW) { const c = (z0 + z1) / 2; z0 = Math.round(c - minW / 2); z1 = Math.round(c + minW / 2); }
        if (!alongX && x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = Math.round(c - minW / 2); x1 = Math.round(c + minW / 2); }
        const ya = hAt(d.a), yb = hAt(b);
        const aLow = alongX ? d.a[0] <= b[0] : d.a[1] <= b[1];
        const [lo, hi] = aLow ? [ya, yb] : [yb, ya];
        setEdits((ed) => ({ ...ed, relief: [...ed.relief, { kind: "ramp", op: ["ramp", x0, z0, x1, z1, round1(lo), round1(hi), "set"] }] }));
      }
      return;
    }
    if (!q || type === "up") { stroke.current = null; return; }
    if (t === "spawn" && type === "down") setEdits((ed) => (ed.spawns.length >= 8 ? ed : { ...ed, spawns: [...ed.spawns, q] }));
    else if (t === "mass" && type === "down") setEdits((ed) => (ed.mass.length >= MAX_MASS ? ed : { ...ed, mass: [...ed.mass, q] }));
    else if (t === "seed" && type === "down") setEdits((ed) => ({ ...ed, seed: q }));
    else if (t === "erase" && type === "down") { const hit = pick(q, e); if (hit) setEdits((ed) => removeSel(ed, [hit])); }
    else if (t === "decor" || t === "uncut") {
      const apply = (ed: Edits): Edits => {
        if (t === "decor") {
          const list = scatter(q);
          return list.length && ed.props.length < MAX_PROPS ? { ...ed, props: [...ed.props, ...list.slice(0, MAX_PROPS - ed.props.length)] } : ed;
        }
        const r = ctxRef.current.radius;
        return { ...ed, props: ed.props.filter((x) => Math.hypot(x.x - q[0], x.z - q[1]) > r), cuts: ed.cuts.length < MAX_CUTS ? [...ed.cuts, [q[0], q[1], r]] : ed.cuts };
      };
      const gap = t === "decor" ? (ctxRef.current.density === 1 ? 8 : rad * 0.8) : rad * 0.6;
      if (type === "down") { stroke.current = q; setEdits(apply); }
      else if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) > gap) { stroke.current = q; setEdits(apply, true); }
    } else if (isRelief(t)) {
      if (type === "down") {
        stroke.current = q;
        const r = reliefOp(t, q);
        if (r) setEdits((ed) => ({ ...ed, relief: [...ed.relief, r] }));
      } else if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) > rad * 0.45 && ctxRef.current.edits.relief.length < 400) {
        stroke.current = q;
        const r = reliefOp(t, q);
        if (r) setEdits((ed) => ({ ...ed, relief: [...ed.relief, r] }), true);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, setEdits, grid]);

  // ------------------------------------------------------------ derivados
  const groundLayers: GroundLayer[] = useMemo(() => (doc.terrain && assets ? assets.layers.filter((l) => l.map.toLowerCase() === doc.terrain!.toLowerCase()) : []), [doc.terrain, assets]);
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
  const decor = useMemo(() => (showDecor ? kept.concat(edits.props.map((q) => ({ x: q.x, z: q.z, yaw: q.yaw, scale: q.scale, kind: decorKind(q.bp), bp: q.bp, added: true }))) : []), [kept, edits.props, showDecor]);

  const teamOf = (i: number) => (doc.teams === "ffa" ? i : i < Math.ceil(edits.spawns.length / 2) ? 0 : 1);
  const markers: Marker[] = useMemo(() => edits.spawns.map((q, i) => ({ p: q, color: TEAM_COLORS[teamOf(i) % 4], label: String(i + 1) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edits.spawns, doc.teams]);
  const highlights = useMemo(() => {
    const out: [number, number, number][] = [];
    for (const s of sel) {
      const [k, iS] = s.split(":");
      const i = Number(iS);
      if (k === "spawn" && edits.spawns[i]) out.push([...edits.spawns[i], 34]);
      else if (k === "mass" && edits.mass[i]) out.push([...edits.mass[i], 16]);
      else if (k === "prop" && edits.props[i]) out.push([edits.props[i].x, edits.props[i].z, 8 * edits.props[i].scale]);
      else if (k === "seed" && edits.seed) out.push([...edits.seed, 18]);
      else if (k === "cut" && edits.cuts[i]) out.push(edits.cuts[i]);
      else if (k === "relief" && edits.relief[i]) { const sh = reliefShape(edits.relief[i].op); out.push([sh.c[0], sh.c[1], sh.r]); }
      else if (k === "bridge" && edits.bridges[i]) { const [x0, x1, z0, z1] = edits.bridges[i]; out.push([(x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2]); }
    }
    return out;
  }, [sel, edits]);

  const editsTerrain = edits.relief.length > 0 || doc.rugged || edits.bridges.length > 0;
  const usePatch = doc.patch || editsTerrain;
  const lobbyName = `[${edits.spawns.length}] ${doc.lobbyName.trim()}`;

  const spec = useMemo(() => {
    if (!doc.terrain) return null;
    const { spawns, mass, bridges, seed, relief, props, cuts, reskin } = edits;
    const ids = spawns.map((_, i) => i + 1);
    const teamList = doc.teams === "ffa" ? ids.map((i) => [i]) : [ids.filter((_, i) => teamOf(i) === 0), ids.filter((_, i) => teamOf(i) === 1)];
    const s: Record<string, unknown> = {
      terrain: doc.terrain, scenario_id: slugId(doc.lobbyName), name: lobbyName, anchors: Object.fromEntries(spawns.map((q, i) => [String(i + 1), q])), teams: teamList,
      economy: { base_mass: doc.economy.baseMass, sites: doc.economy.sites, per_site: doc.economy.perSite }, norush: doc.norush,
      patch: usePatch ? { max_slope: doc.maxSlope, water_margin: doc.waterMargin, seed: seed ?? spawns[0] ?? [grid / 2, grid / 2], causeways: bridges } : null,
    };
    if (relief.length) s.sculpt = relief.map((r) => r.op);
    if (mass.length) s.extra_mass = mass;
    if (doc.rugged) s.rugged_edges = {};
    if (doc.smooth) s.smooth = { keep_slope: doc.maxSlope, water_margin: doc.waterMargin, mode: "level" };
    if (doc.minimap !== "donor") s.minimap = doc.minimap;
    if (usePatch) s.strip_props = doc.strip === "none" ? false : doc.strip;
    if (props.length) s.props_add = props.map((q) => [q.bp, q.x, q.z, q.yaw, q.scale]);
    if (cuts.length) s.props_remove = cuts;
    const swaps = Object.entries(reskin).reduce<Record<string, string>>((acc, [oldD, neo]) => {
      const old = groundLayers.find((l) => l.d === oldD);
      return old ? { ...acc, ...reskinPaths(old, neo) } : acc;
    }, {});
    if (Object.keys(swaps).length) s.reskin = swaps;
    const used = new Set(props.map((q) => q.bp.toLowerCase()));
    const custom = doc.models.filter((m) => used.has(m.bp.toLowerCase()));
    if (custom.length) s.custom_models = custom.map((m) => ({ creation: m.creation, slug: customSlug(m.creation), name: m.name }));
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, edits, usePatch, grid, groundLayers, lobbyName]);

  // ------------------------------------------------------------ ações
  const saveNow = useCallback(async () => {
    const thumb = snapshot.current?.() ?? null;
    const ok = await p.save({ thumb });
    if (ok && p.meta && doc.lobbyName && p.meta.name !== doc.lobbyName) renameTab(id, p.meta.name);
    return ok;
  }, [p, doc.lobbyName, id, renameTab]);

  const build = async (play: boolean) => {
    if (!spec) return;
    setLog([]);
    setLastBuild(null);
    await saveNow();
    const r = await run(`map:${id}`, () => api.maptkBuild(spec), (x) => `"${x.manifest.name}" gerado, verificado e ligado na biblioteca.`);
    if (!r) return;
    setLastBuild(r.result);
    await refreshMods();
    if (play) await run("launch", () => api.launchGame(), "Abrindo o jogo com o mapa novo…");
  };

  const selIds = [...sel].filter((s) => s !== "map");
  const doDelete = () => { if (!selIds.length) return; setEdits((e) => removeSel(e, selIds)); setSel(new Set(["map"])); };
  const doDuplicate = () => {
    if (!selIds.length) return;
    let created: Sel[] = [];
    setEdits((e) => { const [n, out] = duplicateSel(e, selIds); created = out; return n; });
    setTimeout(() => setSel(new Set(created.length ? created : ["map"])), 0);
  };

  useHotkeys(active, {
    "ctrl+s": () => void saveNow(),
    "ctrl+z": p.undo,
    "ctrl+y": p.redo,
    "ctrl+shift+z": p.redo,
    delete: doDelete,
    backspace: doDelete,
    "ctrl+d": doDuplicate,
    escape: () => { setSel(new Set(["map"])); setTool("select"); },
    v: () => setTool("select"),
    c: () => setTool("orbit"),
    b: () => setTool("spawn"),
    m: () => setTool("mass"),
    d: () => setTool("decor"),
    e: () => setTool("erase"),
  });

  // ------------------------------------------------------------ explorer
  const nodes: TreeNode[] = useMemo(() => {
    const kids = (k: string, label: string, icon: string, color: string, list: TreeNode[]): TreeNode => ({ id: `grp:${k}`, label, icon, color, detail: String(list.length), children: list });
    const nice = (bp: string) => bp.split("/").pop()?.replace(/_prop\.bp$/i, "").replace(/_/g, " ") ?? bp;
    return [{
      id: "map", label: doc.lobbyName || "Mapa", icon: "public", color: "#7bd88f", detail: terrain?.name ?? doc.terrain ?? "sem terreno",
      children: [
        kids("spawn", "Bases", "flag", "#5aa9e6", edits.spawns.map((q, i) => ({ id: `spawn:${i}`, label: `Base ${i + 1}`, icon: "flag", color: TEAM_COLORS[teamOf(i) % 4], detail: `${Math.round(q[0])}, ${Math.round(q[1])}` }))),
        kids("mass", "Massa", "diamond", "#7bd88f", edits.mass.map((q, i) => ({ id: `mass:${i}`, label: `Massa ${i + 1}`, icon: "diamond", color: "#7bd88f", detail: `${Math.round(q[0])}, ${Math.round(q[1])}` }))),
        kids("relief", "Relevo", "terrain", "#e3a857", edits.relief.map((r, i) => ({ id: `relief:${i}`, label: RELIEF_LABEL[r.kind], icon: RELIEF_ICON[r.kind], color: RELIEF_COLOR[r.kind] }))),
        kids("bridge", "Passagens", "route", "#f2b33d", edits.bridges.map((_, i) => ({ id: `bridge:${i}`, label: `Passagem ${i + 1}`, icon: "route", color: "#f2b33d" }))),
        kids("prop", "Decorações novas", "park", "#4f9a46", edits.props.slice(0, 2000).map((q, i) => ({ id: `prop:${i}`, label: nice(q.bp), icon: decorKind(q.bp) === "tree" ? "park" : decorKind(q.bp) === "rock" ? "landslide" : "domain", color: q.bp.includes("/cp/") ? "#5aa9e6" : "#7fae6b", detail: `${Math.round(q.x)}, ${Math.round(q.z)}` }))),
        kids("cut", "Decorações retiradas", "content_cut", "#e5534b", edits.cuts.map((c, i) => ({ id: `cut:${i}`, label: `Área ${i + 1}`, icon: "content_cut", color: "#e5534b", detail: `r ${Math.round(c[2])}` }))),
        ...(edits.seed ? [{ id: "seed", label: "Ponto de partida", icon: "my_location", color: "#fff" }] : []),
        kids("reskin", "Texturas trocadas", "format_paint", "#c78bff", Object.entries(edits.reskin).map(([k, v]) => ({ id: `reskin:${k}`, label: `${k.split("_").slice(-2, -1)[0] ?? "camada"} → ${v.name}`, icon: "format_paint", color: "#c78bff" }))),
      ],
    }];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, doc.lobbyName, doc.terrain, doc.teams, terrain]);

  const onTreeSelect = (nid: string, mode: "set" | "toggle" | "range") => {
    if (nid.startsWith("grp:")) {
      const k = nid.slice(4);
      const all = nodes[0].children!.find((c) => c.id === nid)?.children?.map((c) => c.id) ?? [];
      if (k && all.length) setSel(new Set(all));
      return;
    }
    if (mode === "toggle") setSel((s) => { const n = new Set(s); n.delete("map"); if (n.has(nid)) n.delete(nid); else n.add(nid); return n.size ? n : new Set(["map"]); });
    else setSel(new Set([nid]));
  };

  // ------------------------------------------------------------ propriedades
  const props = useMemo(() => {
    const sections: { title: string; props: Prop[] }[] = [];
    const one = selIds.length === 1 ? selIds[0] : null;
    const setPt = (k: "spawns" | "mass", i: number, q: Pt) => setEdits((e) => ({ ...e, [k]: e[k].map((v, j) => (j === i ? q : v)) }));
    if (sel.has("map") || !selIds.length) {
      sections.push({ title: "Mapa", props: [
        { kind: "text", label: "Nome no lobby", value: doc.lobbyName, onChange: (v) => setDoc((d) => ({ ...d, lobbyName: v.slice(0, 48) })), hint: `Aparece como "${lobbyName}". Id: ${slugId(doc.lobbyName)}` },
        { kind: "select", label: "Terreno base", value: doc.terrain ?? "", onChange: (v) => setDoc((d) => ({ ...d, terrain: v || null })), options: [{ value: "", label: "— escolha —" }, ...(terrains ?? []).map((t) => ({ value: t.id, label: `${t.name ?? t.id}${t.kind === "campaign" ? " (campanha)" : ""}` }))] },
        { kind: "select", label: "Times", value: doc.teams, onChange: (v) => setDoc((d) => ({ ...d, teams: v as MapDoc["teams"] })), options: [{ value: "2", label: "Dois times" }, { value: "ffa", label: "Todos contra todos" }] },
        { kind: "number", label: "Raio sem ataque inicial", value: doc.norush, min: 0, max: 200, onChange: (v) => setDoc((d) => ({ ...d, norush: v })) },
        { kind: "select", label: "Minimapa do lobby", value: doc.minimap, onChange: (v) => setDoc((d) => ({ ...d, minimap: v as MapDoc["minimap"] })), options: [{ value: "donor", label: "Original do terreno" }, { value: "desert", label: "Gerar: deserto" }, { value: "snow", label: "Gerar: neve" }, { value: "dark", label: "Gerar: rocha escura" }] },
      ] });
      sections.push({ title: "Economia", props: [
        { kind: "number", label: "Massa na base", value: doc.economy.baseMass, min: 0, max: 8, onChange: (v) => setDoc((d) => ({ ...d, economy: { ...d.economy, baseMass: v } })) },
        { kind: "number", label: "Expansões", value: doc.economy.sites, min: 0, max: 20, onChange: (v) => setDoc((d) => ({ ...d, economy: { ...d.economy, sites: v } })) },
        { kind: "number", label: "Massa por expansão", value: doc.economy.perSite, min: 1, max: 6, onChange: (v) => setDoc((d) => ({ ...d, economy: { ...d.economy, perSite: v } })) },
        { kind: "info", label: "Massa manual", value: `${edits.mass.length} ponto(s)` },
      ] });
      sections.push({ title: "Terreno e navegação", props: [
        { kind: "toggle", label: "Borda rochosa", value: doc.rugged, onChange: (v) => setDoc((d) => ({ ...d, rugged: v })), hint: "Fecha o mapa com uma faixa de rochas intransponível." },
        { kind: "toggle", label: "Aplainar para construir", value: doc.smooth, onChange: (v) => setDoc((d) => ({ ...d, smooth: v })) },
        { kind: "toggle", label: "Abrir terreno (refazer navegação)", value: usePatch, onChange: (v) => setDoc((d) => ({ ...d, patch: v })), hint: editsTerrain ? "Ligado sozinho: o relevo mudou." : "Obrigatório em mapas de campanha." },
        ...(usePatch ? [
          { kind: "number", label: "Inclinação máxima", value: doc.maxSlope, step: 0.5, min: 1, max: 20, onChange: (v: number) => setDoc((d) => ({ ...d, maxSlope: v })) } as Prop,
          { kind: "number", label: "Margem da água", value: doc.waterMargin, step: 0.5, min: 0, max: 20, onChange: (v: number) => setDoc((d) => ({ ...d, waterMargin: v })) } as Prop,
          { kind: "select", label: "Objetos animados", value: doc.strip, onChange: (v: string) => setDoc((d) => ({ ...d, strip: v as MapDoc["strip"] })), options: [{ value: "moving", label: "Parar os que se movem" }, { value: "all", label: "Remover todos" }, { value: "none", label: "Manter" }] } as Prop,
        ] : []),
        { kind: "info", label: "Água", value: `nível ${round1(water)}` },
      ] });
      sections.push({ title: "Anotações", props: [{ kind: "text", label: "Notas do projeto", value: doc.notes, multiline: true, onChange: (v) => setDoc((d) => ({ ...d, notes: v })) }] });
      return sections;
    }
    if (one) {
      const [k, iS] = one.split(":");
      const i = Number(iS);
      if (k === "spawn" && edits.spawns[i]) sections.push({ title: `Base ${i + 1}`, props: [
        { kind: "number", label: "X", value: edits.spawns[i][0], min: 0, max: grid, onChange: (v) => setPt("spawns", i, [v, edits.spawns[i][1]]) },
        { kind: "number", label: "Z", value: edits.spawns[i][1], min: 0, max: grid, onChange: (v) => setPt("spawns", i, [edits.spawns[i][0], v]) },
        { kind: "info", label: "Time", value: doc.teams === "ffa" ? "sozinho" : `time ${teamOf(i) + 1}` },
        { kind: "info", label: "Altura do chão", value: round1(hAt(edits.spawns[i])) },
      ] });
      if (k === "mass" && edits.mass[i]) sections.push({ title: `Massa ${i + 1}`, props: [
        { kind: "number", label: "X", value: edits.mass[i][0], min: 0, max: grid, onChange: (v) => setPt("mass", i, [v, edits.mass[i][1]]) },
        { kind: "number", label: "Z", value: edits.mass[i][1], min: 0, max: grid, onChange: (v) => setPt("mass", i, [edits.mass[i][0], v]) },
      ] });
      if (k === "prop" && edits.props[i]) {
        const q = edits.props[i];
        const setQ = (patch: Partial<PlacedProp>) => setEdits((e) => ({ ...e, props: e.props.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
        sections.push({ title: "Decoração", props: [
          { kind: "info", label: "Modelo", value: q.bp.split("/").pop() },
          { kind: "number", label: "X", value: q.x, min: 0, max: grid, onChange: (v) => setQ({ x: v }) },
          { kind: "number", label: "Z", value: q.z, min: 0, max: grid, onChange: (v) => setQ({ z: v }) },
          { kind: "slider", label: "Giro", value: q.yaw, min: 0, max: 359, unit: "°", onChange: (v) => setQ({ yaw: v }) },
          { kind: "number", label: "Escala", value: q.scale, step: 0.05, min: 0.2, max: 5, onChange: (v) => setQ({ scale: v }) },
        ] });
      }
      if (k === "relief" && edits.relief[i]) {
        const r = edits.relief[i];
        const op = r.op;
        const setOp = (fn: (o: typeof op) => typeof op) => setEdits((e) => ({ ...e, relief: e.relief.map((v, j) => (j === i ? { ...v, op: fn([...v.op] as typeof op) } : v)) }));
        const fields: Prop[] = [{ kind: "info", label: "Tipo", value: RELIEF_LABEL[r.kind] }];
        if (op[0] === "disc" || op[0] === "cone") {
          fields.push(
            { kind: "number", label: "Centro X", value: op[1], min: 0, max: grid, onChange: (v) => setOp((o) => { o[1] = v; return o; }) },
            { kind: "number", label: "Centro Z", value: op[2], min: 0, max: grid, onChange: (v) => setOp((o) => { o[2] = v; return o; }) },
            { kind: "number", label: "Raio", value: op[3], min: 4, max: 400, onChange: (v) => setOp((o) => { o[3] = v; return o; }) },
            { kind: "number", label: "Altura alvo", value: op[4], step: 0.5, min: 0, max: 512, onChange: (v) => setOp((o) => { o[4] = v; return o; }) },
          );
        } else {
          fields.push(
            { kind: "number", label: "X inicial", value: op[1], min: 0, max: grid, onChange: (v) => setOp((o) => { o[1] = v; return o; }) },
            { kind: "number", label: "Z inicial", value: op[2], min: 0, max: grid, onChange: (v) => setOp((o) => { o[2] = v; return o; }) },
            { kind: "number", label: "X final", value: op[3], min: 0, max: grid, onChange: (v) => setOp((o) => { o[3] = v; return o; }) },
            { kind: "number", label: "Z final", value: op[4], min: 0, max: grid, onChange: (v) => setOp((o) => { o[4] = v; return o; }) },
          );
        }
        sections.push({ title: "Relevo", props: fields });
      }
      if (k === "cut" && edits.cuts[i]) {
        const c = edits.cuts[i];
        const setC = (n: [number, number, number]) => setEdits((e) => ({ ...e, cuts: e.cuts.map((v, j) => (j === i ? n : v)) }));
        sections.push({ title: "Área sem decorações", props: [
          { kind: "number", label: "X", value: c[0], min: 0, max: grid, onChange: (v) => setC([v, c[1], c[2]]) },
          { kind: "number", label: "Z", value: c[1], min: 0, max: grid, onChange: (v) => setC([c[0], v, c[2]]) },
          { kind: "number", label: "Raio", value: c[2], min: 1, max: 300, onChange: (v) => setC([c[0], c[1], v]) },
        ] });
      }
      if (k === "bridge" && edits.bridges[i]) {
        const b = edits.bridges[i];
        const setB = (n: [number, number, number, number]) => setEdits((e) => ({ ...e, bridges: e.bridges.map((v, j) => (j === i ? n : v)) }));
        sections.push({ title: "Passagem sobre a água", props: [
          { kind: "number", label: "X de", value: b[0], min: 0, max: grid, onChange: (v) => setB([v, b[1], b[2], b[3]]) },
          { kind: "number", label: "X até", value: b[1], min: 0, max: grid, onChange: (v) => setB([b[0], v, b[2], b[3]]) },
          { kind: "number", label: "Z de", value: b[2], min: 0, max: grid, onChange: (v) => setB([b[0], b[1], v, b[3]]) },
          { kind: "number", label: "Z até", value: b[3], min: 0, max: grid, onChange: (v) => setB([b[0], b[1], b[2], v]) },
        ] });
      }
      if (one === "seed" && edits.seed) sections.push({ title: "Ponto de partida", props: [
        { kind: "number", label: "X", value: edits.seed[0], min: 0, max: grid, onChange: (v) => setEdits((e) => ({ ...e, seed: [v, e.seed![1]] })) },
        { kind: "number", label: "Z", value: edits.seed[1], min: 0, max: grid, onChange: (v) => setEdits((e) => ({ ...e, seed: [e.seed![0], v] })) },
      ] });
      if (k === "reskin") {
        const oldD = one.slice(7);
        sections.push({ title: "Textura do chão trocada", props: [
          { kind: "info", label: "Camada", value: oldD.split("/").pop() },
          { kind: "info", label: "Nova", value: edits.reskin[oldD]?.d.split("/").pop() },
          { kind: "custom", label: "", node: <button className="btn sm" onClick={() => setEdits((e) => { const r = { ...e.reskin }; delete r[oldD]; return { ...e, reskin: r }; })}><Icon name="undo" size={16} /> Voltar ao original</button> },
        ] });
      }
    } else {
      sections.push({ title: `${selIds.length} objetos selecionados`, props: [
        { kind: "custom", label: "Ações", node: <span className="row" style={{ gap: 6 }}><button className="btn sm" onClick={doDuplicate}><Icon name="content_copy" size={16} /> Duplicar</button><button className="btn sm" onClick={doDelete}><Icon name="delete" size={16} /> Apagar</button></span> },
        { kind: "info", label: "Dica", value: "Arraste qualquer um deles para mover todos juntos." },
      ] });
    }
    return sections;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, edits, doc, terrains, grid, usePatch, editsTerrain, lobbyName, water]);

  // ------------------------------------------------------------ toolbox: meus modelos
  const useModel = async (m: CreationMeta) => {
    const baked = await api.modelBaked(m.id).catch(() => null);
    if (!baked) {
      toast("info", `Abra o modelo "${m.name}" e clique em "Preparar para o jogo" antes de usar no mapa.`);
      useTabs.getState().open(m);
      return;
    }
    const slug = customSlug(m.id);
    const bp = `/props/cp/${slug}/${slug}_prop.bp`;
    registerCustomProp(bp, m.id);
    if (!doc.models.some((x) => x.creation === m.id)) setDoc((d) => ({ ...d, models: [...d.models, { creation: m.id, name: m.name, bp }] }));
    setPropBp(bp);
    setTool("decor");
  };

  // ------------------------------------------------------------ interface
  if (p.status === "loading") return <div className="studio-root"><div className="bar indeterminate" style={{ margin: 30 }}><i /></div></div>;
  if (p.status === "error") return <div className="studio-root"><Empty icon="error" title="Não deu para abrir o projeto">{p.error}</Empty></div>;

  const circleBrush = (isRelief(tool) && tool !== "ramp") || tool === "uncut" || (tool === "decor" && density > 1);
  const brushColor = isRelief(tool) ? RELIEF_COLOR[tool] : tool === "erase" || tool === "uncut" ? "#e5534b" : tool === "select" ? "#ffd166" : "#a3e635";
  const brush = tool === "orbit" ? null : circleBrush ? { shape: "circle" as const, radius, color: brushColor } : { shape: "point" as const, color: brushColor };
  const toolBtn = (t: Tool, icon: string, label: string, color?: string) => (
    <RibbonButton key={t} icon={icon} label={label} active={tool === t} onClick={() => setTool(t)} hint={HINT[t]} color={color} />
  );
  const image2d = skin === "game" && relief3d?.texture ? relief3d.texture : preview?.dataUrl;
  const toWorld = (e: React.PointerEvent): Pt => {
    const r = stage.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(grid, Math.round(((e.clientX - r.left) / r.width) * grid))), Math.max(0, Math.min(grid, Math.round(((e.clientY - r.top) / r.height) * grid)))];
  };

  return (
    <div className="studio-root">
      <div className="studio-top">
        <Ribbon active={ribbon} onTab={setRibbon}
          tabs={[{ id: "home", label: "Início" }, { id: "terrain", label: "Terreno" }, { id: "objects", label: "Objetos" }, { id: "view", label: "Exibir" }, { id: "game", label: "Jogo" }]}>
          {ribbon === "home" && <>
            <RibbonGroup label="Ferramentas">
              {toolBtn("select", "near_me", "Selecionar")}
              {toolBtn("orbit", "3d_rotation", "Câmera")}
              {toolBtn("erase", "layers_clear", "Apagar", "#e5534b")}
            </RibbonGroup>
            <RibbonGroup label="Editar">
              <RibbonButton icon="content_copy" label="Duplicar" onClick={doDuplicate} disabled={!selIds.length} hint="Ctrl+D" />
              <RibbonButton icon="delete" label="Excluir" onClick={doDelete} disabled={!selIds.length} hint="Del" />
              <RibbonButton icon="deselect" label="Limpar seleção" onClick={() => setSel(new Set(["map"]))} disabled={!selIds.length} />
            </RibbonGroup>
            <RibbonGroup label="Inserir">
              {toolBtn("spawn", "flag", `Bases ${edits.spawns.length}/8`, "#5aa9e6")}
              {toolBtn("mass", "diamond", "Massa", "#7bd88f")}
              {toolBtn("decor", "park", "Decorar", "#7fae6b")}
            </RibbonGroup>
            <RibbonGroup label="Testar">
              <RibbonButton icon="construction" label={busy ? "Gerando…" : "Gerar mapa"} onClick={() => void build(false)} disabled={!spec || edits.spawns.length < 2 || busy} color="#a3e635" hint="Gera, verifica e liga o mapa na biblioteca" />
              <RibbonButton icon="play_circle" label="Gerar e jogar" onClick={() => void build(true)} disabled={!spec || edits.spawns.length < 2 || busy} color="#a3e635" />
            </RibbonGroup>
          </>}
          {ribbon === "terrain" && <>
            <RibbonGroup label="Esculpir">
              {(["hill", "valley", "plateau", "flatten", "ramp"] as ReliefKind[]).map((k) => toolBtn(k, RELIEF_ICON[k], RELIEF_LABEL[k], RELIEF_COLOR[k]))}
              {toolBtn("bridge", "route", "Passagem", "#f2b33d")}
            </RibbonGroup>
            <RibbonGroup label="Pincel">
              <div className="ribbon-stack" style={{ width: 210 }}>
                <label className="range" style={{ gridTemplateColumns: "48px 1fr 34px" }}><span>Raio</span><input type="range" min={8} max={200} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><output>{radius}</output></label>
                <label className="range" style={{ gridTemplateColumns: "48px 1fr 34px" }}><span>Altura</span><input type="range" min={2} max={80} value={strength} onChange={(e) => setStrength(Number(e.target.value))} /><output>{strength}</output></label>
              </div>
            </RibbonGroup>
            <RibbonGroup label="Mapa inteiro">
              <RibbonButton icon="fence" label="Borda rochosa" active={doc.rugged} onClick={() => setDoc((d) => ({ ...d, rugged: !d.rugged }))} />
              <RibbonButton icon="horizontal_rule" label="Aplainar tudo" active={doc.smooth} onClick={() => setDoc((d) => ({ ...d, smooth: !d.smooth }))} />
              <RibbonButton icon="format_paint" label="Texturas do chão" onClick={() => setLeft("ground")} />
              <RibbonButton icon="clear_all" label="Limpar relevo" onClick={() => setEdits((e) => ({ ...e, relief: [], bridges: [] }))} disabled={!edits.relief.length && !edits.bridges.length} />
            </RibbonGroup>
          </>}
          {ribbon === "objects" && <>
            <RibbonGroup label="Jogo">
              {toolBtn("spawn", "flag", "Bases", "#5aa9e6")}
              {toolBtn("mass", "diamond", "Massa", "#7bd88f")}
              {toolBtn("seed", "my_location", "Partida")}
            </RibbonGroup>
            <RibbonGroup label="Decorações">
              {toolBtn("decor", "park", "Decorar", "#7fae6b")}
              {toolBtn("uncut", "content_cut", "Tirar", "#e5534b")}
              <RibbonButton icon="inventory_2" label="Meus modelos" onClick={() => setLeft("mine")} color="#5aa9e6" />
            </RibbonGroup>
            <RibbonGroup label="Espalhar">
              <div className="ribbon-stack" style={{ width: 230 }}>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>Por clique</span><input type="range" min={1} max={30} value={density} onChange={(e) => setDensity(Number(e.target.value))} /><output>{density}</output></label>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>Variação</span><input type="range" min={0} max={60} step={5} value={sizeVar} onChange={(e) => setSizeVar(Number(e.target.value))} /><output>{sizeVar}%</output></label>
              </div>
            </RibbonGroup>
            <RibbonGroup label="Limpar">
              <RibbonButton icon="delete_sweep" label="Tirar as novas" onClick={() => setEdits((e) => ({ ...e, props: [] }))} disabled={!edits.props.length} />
              <RibbonButton icon="restore" label="Devolver as do terreno" onClick={() => setEdits((e) => ({ ...e, cuts: [] }))} disabled={!edits.cuts.length} />
            </RibbonGroup>
          </>}
          {ribbon === "view" && <>
            <RibbonGroup label="Vista">
              <RibbonButton icon="view_in_ar" label="3D" active={view === "3d"} disabled={!relief3d} onClick={() => setView("3d")} />
              <RibbonButton icon="map" label="2D" active={view === "2d"} onClick={() => { setView("2d"); if (tool === "orbit") setTool("select"); }} />
            </RibbonGroup>
            <RibbonGroup label="Camadas">
              <RibbonButton icon="texture" label="Textura do jogo" active={skin === "game"} disabled={!relief3d?.texture} onClick={() => setSkin("game")} />
              <RibbonButton icon="grid_on" label="Navegação" active={skin === "nav"} onClick={() => setSkin("nav")} />
              <RibbonButton icon={showDecor ? "park" : "visibility_off"} label="Decorações" active={showDecor} onClick={() => setShowDecor((v) => !v)} />
            </RibbonGroup>
            <RibbonGroup label="Relevo">
              <div className="ribbon-stack" style={{ width: 200 }}>
                <label className="range" style={{ gridTemplateColumns: "60px 1fr 34px" }}><span>Exagero</span><input type="range" min={1} max={4} step={0.25} value={exag} onChange={(e) => setExag(Number(e.target.value))} /><output>{exag}×</output></label>
              </div>
            </RibbonGroup>
          </>}
          {ribbon === "game" && <>
            <RibbonGroup label="Gerar">
              <RibbonButton icon="construction" label={busy ? "Gerando…" : "Gerar mapa"} onClick={() => void build(false)} disabled={!spec || edits.spawns.length < 2 || busy} color="#a3e635" />
              <RibbonButton icon="play_circle" label="Gerar e jogar" onClick={() => void build(true)} disabled={!spec || edits.spawns.length < 2 || busy} color="#a3e635" />
            </RibbonGroup>
            <RibbonGroup label="Configurar">
              <RibbonButton icon="tune" label="Propriedades do mapa" onClick={() => setSel(new Set(["map"]))} />
            </RibbonGroup>
          </>}
        </Ribbon>
        <ProjectBar p={p} onSave={() => void saveNow()} />
      </div>

      <StudioLayout id="map"
        left={<>
          <Panel title="Caixa de recursos" icon="widgets" grow id="map-toolbox" collapsible={false}>
            <div className="chips" style={{ padding: "8px 8px 0" }}>
              <button className="chip" aria-pressed={left === "decor"} onClick={() => setLeft("decor")}><Icon name="park" size={15} /> Do jogo</button>
              <button className="chip" aria-pressed={left === "mine"} onClick={() => setLeft("mine")}><Icon name="inventory_2" size={15} /> Meus modelos</button>
              <button className="chip" aria-pressed={left === "ground"} onClick={() => setLeft("ground")}><Icon name="format_paint" size={15} /> Chão</button>
            </div>
            <div className="spanel-pad">
              {left === "decor" && (
                <div className="decor-picker compact">
                  <PropPicker props={assets?.props ?? null} used={donor?.kinds ?? []} selected={propBp} onSelect={(bp) => { setPropBp(bp); setTool("decor"); }} />
                </div>
              )}
              {left === "mine" && (
                models === null ? <div className="bar indeterminate"><i /></div> : models.length === 0 ? (
                  <p className="faint small">Você ainda não tem modelos 3D. Crie um em <b>Criar → Criar modelo 3D</b> e use aqui como decoração.</p>
                ) : (
                  <div className="col" style={{ gap: 6 }}>
                    <p className="faint small">Modelos feitos no editor 3D. Eles vão dentro do mapa como decorações (experimental).</p>
                    {models.map((m) => {
                      const slug = customSlug(m.id);
                      const bp = `/props/cp/${slug}/${slug}_prop.bp`;
                      return (
                        <button key={m.id} className="pick row-pick" aria-pressed={propBp === bp} onClick={() => void useModel(m)}>
                          <Icon name="view_in_ar" size={20} />
                          <span className="grow"><b>{m.name}</b></span>
                          <Icon name="add_location_alt" size={18} />
                        </button>
                      );
                    })}
                  </div>
                )
              )}
              {left === "ground" && (assets === null ? <div className="bar indeterminate"><i /></div> : (
                <GroundTextures layers={groundLayers} all={assets.layers} reskin={edits.reskin}
                  onChange={(oldD, neo) => setEdits((e) => { const reskin = { ...e.reskin }; if (neo) reskin[oldD] = neo; else delete reskin[oldD]; return { ...e, reskin }; })} />
              ))}
            </div>
          </Panel>
        </>}
        center={
          <div className="viewport">
            {!doc.terrain ? (
              <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
                <Empty icon="terrain" title="Escolha um terreno base">Selecione "Mapa" no Explorador e escolha o terreno nas Propriedades. Relevo, água e texturas vêm dele.</Empty>
              </div>
            ) : view === "3d" && relief3d && heights ? (
              <Suspense fallback={<div className="bar indeterminate" style={{ margin: 20 }}><i /></div>}>
                <MapView3D size={relief3d.size} grid={relief3d.grid} heights={heights} waterLevel={water}
                  texture={skin === "game" ? relief3d.texture : preview?.dataUrl ?? null} exaggeration={exag}
                  spawns={markers} mass={edits.mass} bridges={edits.bridges} seed={edits.seed}
                  decor={decor} cuts={edits.cuts} highlights={highlights} snapshotRef={snapshot}
                  brush={brush} drag={drag} orbit={tool === "orbit"} onPointer={onPointer} />
              </Suspense>
            ) : view === "3d" ? <div className="bar indeterminate" style={{ margin: 20 }}><i /></div> : (
              <div className="map-stage studio-2d" ref={stage}
                onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); onPointer("down", toWorld(e)); }}
                onPointerMove={(e) => { const q = toWorld(e); setCursor(q); if (e.buttons & 1) onPointer("move", q); }}
                onPointerUp={(e) => onPointer("up", toWorld(e))}
                role="application" aria-label="Mapa em 2D">
                {image2d ? <img src={image2d} alt="" draggable={false} /> : <div className="bar indeterminate" style={{ margin: 20 }}><i /></div>}
                <svg viewBox={`0 0 ${grid} ${grid}`}>
                  {edits.relief.map((r, i) => { const sh = reliefShape(r.op), c = RELIEF_COLOR[r.kind]; return sh.rect ? <rect key={i} x={sh.rect[0]} y={sh.rect[2]} width={sh.rect[1] - sh.rect[0]} height={sh.rect[3] - sh.rect[2]} fill={`${c}33`} stroke={c} strokeWidth={3} /> : <circle key={i} cx={sh.c[0]} cy={sh.c[1]} r={sh.r} fill={`${c}26`} stroke={c} strokeWidth={2.5} />; })}
                  {edits.cuts.map(([x, z, r], i) => <circle key={`c${i}`} cx={x} cy={z} r={r} fill="rgba(229,83,75,.12)" stroke="#e5534b" strokeWidth={2} strokeDasharray="8 5" />)}
                  {showDecor && edits.props.map((q, i) => <circle key={`p${i}`} cx={q.x} cy={q.z} r={4} fill="#4f9a46" stroke="#0d1b26" strokeWidth={1.5} />)}
                  {edits.bridges.map(([x0, x1, z0, z1], i) => <rect key={`b${i}`} x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="rgba(242,179,61,.25)" stroke="#f2b33d" strokeWidth={3} strokeDasharray="10 6" />)}
                  {drag && <rect x={Math.min(drag.a[0], drag.b[0])} y={Math.min(drag.a[1], drag.b[1])} width={Math.abs(drag.b[0] - drag.a[0])} height={Math.abs(drag.b[1] - drag.a[1])} fill="rgba(242,179,61,.2)" stroke="#f2b33d" strokeWidth={3} />}
                  {edits.mass.map((q, i) => <path key={`m${i}`} d={`M${q[0]} ${q[1] - 13}L${q[0] + 9} ${q[1]}L${q[0]} ${q[1] + 13}L${q[0] - 9} ${q[1]}Z`} fill="#7bd88f" stroke="#0d1b26" strokeWidth={3} />)}
                  {edits.spawns.map((q, i) => <g key={`s${i}`}><circle cx={q[0]} cy={q[1]} r={26} fill={TEAM_COLORS[teamOf(i) % 4]} stroke="#0d1b26" strokeWidth={5} /><text x={q[0]} y={q[1] + 10} textAnchor="middle" fontSize={30} fontWeight={700} fill="#0d1b26">{i + 1}</text></g>)}
                  {highlights.map(([x, z, r], i) => <circle key={`h${i}`} cx={x} cy={z} r={r} fill="none" stroke="#ffd166" strokeWidth={3} />)}
                  {cursor && brush && <circle cx={cursor[0]} cy={cursor[1]} r={brush.shape === "circle" ? brush.radius : 10} fill="none" stroke={brush.color} strokeWidth={3} />}
                </svg>
              </div>
            )}
            <div className="viewport-overlay">
              <span className="vp-chip"><Icon name={tool === "select" ? "near_me" : "edit"} size={15} /> {HINT[tool].split(".")[0]}.</span>
              {selIds.length > 0 && <span className="vp-chip"><Icon name="select_all" size={15} /> {selIds.length} selecionado{selIds.length > 1 ? "s" : ""}</span>}
            </div>
            {(lastBuild || log.length > 0) && (
              <div className="build-log">
                {lastBuild && (
                  <Notice kind={lastBuild.warnings?.length ? "warn" : "ok"}>
                    {typeof lastBuild.mass === "number" ? <><b>{lastBuild.mass + (lastBuild.extraMass ?? 0)}</b> pontos de massa. </> : null}
                    {lastBuild.propsAdded || lastBuild.propsRemoved ? <>{lastBuild.propsAdded ?? 0} decorações novas, {lastBuild.propsRemoved ?? 0} retiradas. </> : null}
                    {lastBuild.warnings?.length ? <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{lastBuild.warnings.slice(0, 6).map((w, i) => <li key={i}>{w}</li>)}</ul> : "Tudo verificado e alcançável."}
                  </Notice>
                )}
                {log.length > 0 && <div className="log mono small">{log.slice(-8).map((l, i) => <div key={i}>{l}</div>)}</div>}
                <button className="btn text sm" onClick={() => { setLog([]); setLastBuild(null); }}>Fechar</button>
              </div>
            )}
          </div>
        }
        right={<>
          <Panel title="Explorador" icon="account_tree" grow id="map-explorer">
            <div className="tree-filter"><input placeholder="Filtrar objetos…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar objetos" /></div>
            <Tree nodes={nodes} selected={sel} filter={filter} onSelect={onTreeSelect}
              onContext={(nid, x, y) => { if (!nid.startsWith("grp:") && nid !== "map") { setSel(new Set([nid])); setCtx({ x, y, id: nid }); } }} />
          </Panel>
          <Panel title="Propriedades" icon="tune" grow id="map-props">
            <PropertyGrid sections={props} />
          </Panel>
        </>}
      />
      <StatusBar>
        <span><Icon name="terrain" size={13} /> <b>{terrain?.name ?? doc.terrain ?? "sem terreno"}</b></span>
        <span>{edits.spawns.length} bases · {edits.mass.length} massa · {edits.relief.length} relevo · {edits.props.length} decorações novas{removedCount ? ` · ${removedCount} retiradas` : ""}</span>
        <span className="grow" />
        {cursor && <span>x {Math.round(cursor[0])} · z {Math.round(cursor[1])} · altura {round1(hAt(cursor))}</span>}
        {status && !status.ready && <span style={{ color: "var(--warn)" }}>{status.message}</span>}
        {edits.spawns.length < 2 && <span style={{ color: "var(--warn)" }}>coloque pelo menos 2 bases para gerar</span>}
      </StatusBar>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} items={[
        { icon: "content_copy", label: "Duplicar", shortcut: "Ctrl+D", onClick: doDuplicate },
        { icon: "delete", label: "Excluir", shortcut: "Del", danger: true, onClick: doDelete },
      ] as CtxItem[]} />}
    </div>
  );
}

// para os erros de geração aparecerem com o texto certo
export const mapBuildError = (e: unknown) => errorText(e);
