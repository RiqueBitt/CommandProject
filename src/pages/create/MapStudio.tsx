// Editor de mapas em aba própria, no estilo de um estúdio de jogo: faixa de ferramentas, recursos
// à esquerda, visão 3D no centro, objetos e propriedades à direita. O documento é salvo como
// projeto (salvamento automático, versões); "Gerar mapa" usa o SC2 Map Toolkit e sai um .scd.
//
// Camadas do relevo, na ordem: terreno do jogo → gerador de mundo (relevo base) → formas
// (montanhas, lagos, rios…) → pincel de escultura → relevo simples (morro, vale, rampa…).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DecorPoint, Marker } from "../../components/MapView3D";
import { registerCustomProp } from "../../components/propModels";
import {
  ContextMenu, Panel, ProjectBar, PropertyGrid, Ribbon, RibbonButton, RibbonGroup, StatusBar, StudioLayout, Tree,
  useActiveEditor, useHotkeys, type CtxItem, type Prop, type TreeNode,
} from "../../components/studio/kit";
import { Empty, Icon, Modal, Notice } from "../../components/ui";
import { api, confirmDialog, onProgress, pickFile } from "../../lib/api";
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
import { analyzeMap, type Analysis } from "./mapAnalysis";
import { autoFixMap, checkMap, type MapIssue } from "./mapCheck";
import {
  baseHeights, BIOME_LABEL, brushDab, composeWorld, decodeLayer, encodeDelta, encodeLayer, FEATURE_COLOR, FEATURE_ICON, FEATURE_LABEL, fullCuts, invert,
  LINE_FEATURES, mapYaw, propCatalog, WORLD_PRESETS, reliefImage, simplex, SYMMETRY_LABEL, symmetryOps,
  type BrushMode, type Feature, type FeatureKind, type Symmetry, type WorldGen, type WorldResult,
} from "./worldgen";

const MapView3D = lazy(() => import("../../components/MapView3D"));
const WorldGenModal = lazy(() => import("./WorldGenModal"));

type BrushTool = `b-${BrushMode}`;
type FeatTool = `f-${FeatureKind}`;
type Tool = "select" | "orbit" | "spawn" | "mass" | ReliefKind | "bridge" | "decor" | "uncut" | "seed" | "erase" | BrushTool | FeatTool;
type M = [number, number, number, number];
const TEAM_COLORS = ["#5aa9e6", "#e5534b", "#7bd88f", "#c78bff", "#f2b33d", "#ff8fab", "#9be7ff", "#eeeeee"];
const RELIEF_COLOR: Record<ReliefKind, string> = { hill: "#e3a857", valley: "#4fa3e0", plateau: "#d97757", flatten: "#c9d1d9", ramp: "#f2b33d" };
const RELIEF_ICON: Record<ReliefKind, string> = { hill: "filter_hdr", valley: "water", plateau: "landscape", flatten: "straighten", ramp: "stairs" };
const BRUSH: Record<BrushMode, { label: string; icon: string; color: string; hint: string }> = {
  raise: { label: "Subir", icon: "arrow_upward", color: "#e3a857", hint: "Pinte para subir o terreno aos poucos." },
  lower: { label: "Descer", icon: "arrow_downward", color: "#4fa3e0", hint: "Pinte para descer o terreno. Abaixo da água vira água (em terrenos com água)." },
  smooth: { label: "Suavizar", icon: "blur_on", color: "#9be7ff", hint: "Pinte para suavizar degraus e pontas." },
  flatten: { label: "Nivelar", icon: "horizontal_rule", color: "#c9d1d9", hint: "Nivela na altura do ponto onde você começou a pintar." },
  noise: { label: "Irregular", icon: "grain", color: "#c78bff", hint: "Deixa o chão irregular e natural." },
};
const POINT_FEATS: FeatureKind[] = ["mountain", "hill", "plateau", "crater", "lake", "dunes", "island", "pad"];
const isRelief = (t: Tool): t is ReliefKind => t in RELIEF_LABEL;
const isBrush = (t: Tool): t is BrushTool => t.startsWith("b-");
const isFeat = (t: Tool): t is FeatTool => t.startsWith("f-");
const featOf = (t: FeatTool) => t.slice(2) as FeatureKind;
const MAX_MASS = 200, MAX_PROPS = 5000, MAX_CUTS = 400;
type DonorProp = [number, number, number, number, number, number];

const HINT: Record<string, string> = {
  select: "Clique para selecionar (Shift soma à seleção). Arraste um objeto selecionado para movê-lo. Del apaga, Ctrl+D duplica.",
  orbit: "Arraste para girar a câmera. Botão do meio move, roda dá zoom.",
  spawn: "Clique para colocar a base inicial de cada jogador (até 8).",
  mass: "Clique para colocar pontos de extração de massa.",
  hill: "Clique ou arraste para subir o terreno em rampa suave.",
  valley: "Clique ou arraste para cavar.",
  plateau: "Levanta um platô de topo plano com paredes íngremes.",
  flatten: "Nivela a área na altura média: bom para construir.",
  ramp: "Arraste do ponto baixo ao alto para ligar um platô ao chão.",
  bridge: "Arraste um retângulo sobre a água: vau que as unidades atravessam.",
  decor: "Escolha uma decoração na caixa de recursos e clique; arraste para espalhar.",
  uncut: "Clique ou arraste para tirar decorações do terreno original.",
  seed: "Ponto de onde a navegação é recalculada.",
  erase: "Clique sobre qualquer item para apagá-lo.",
};
const hintOf = (t: Tool) => isBrush(t) ? BRUSH[t.slice(2) as BrushMode].hint
  : isFeat(t) ? (LINE_FEATURES.includes(featOf(t)) ? `Arraste para desenhar: ${FEATURE_LABEL[featOf(t)].toLowerCase()}.` : `Clique para colocar: ${FEATURE_LABEL[featOf(t)].toLowerCase()}. Raio e altura nos controles do pincel.`)
  : HINT[t] ?? "";

function slugId(name: string) {
  const s = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12);
  return "SC2_" + (s.length >= 2 ? s : "MAPA");
}
/** id com o mesmo tamanho do id do terreno (exigência para trocar a máscara de água) */
function fitId(id: string, len: number) {
  if (id.length >= len) return id.slice(0, len);
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let out = id;
  while (out.length < len) { out += String(h % 10); h = Math.floor(h / 10) || 7; }
  return out;
}

/** slug estável de decoração própria a partir do id do projeto de modelo */
export function customSlug(creation: string) {
  let h = 2166136261;
  for (const c of creation) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return "cpm" + (h >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

type Sel = string; // "spawn:0", "mass:3", "relief:2", "bridge:0", "prop:5", "cut:1", "feat:<id>", "seed", "map"
const groupOf = (s: Sel) => `grp:${s.split(":")[0]}`;
let featSeq = 0;
const newFeatId = () => `u${Date.now().toString(36)}${(featSeq++).toString(36)}`;

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
  const [skin, setSkin] = useState<"game" | "nav" | "relief" | "analysis">(() => (p.doc.world ? "relief" : "game"));
  const [exag, setExag] = useState(1.5);
  const [tool, setTool] = useState<Tool>("select");
  const [radius, setRadius] = useState(60);
  const [strength, setStrength] = useState(20);
  const [propBp, setPropBp] = useState<string | null>(null);
  const [density, setDensity] = useState(1);
  const [sizeVar, setSizeVar] = useState(25);
  const [avoidWater, setAvoidWater] = useState(true);
  const [avoidSteep, setAvoidSteep] = useState(true);
  const [showDecor, setShowDecor] = useState(true);
  const [sel, setSel] = useState<Set<Sel>>(new Set(["map"]));
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const [filter, setFilter] = useState("");
  const [ctx, setCtx] = useState<{ x: number; y: number; id: Sel } | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [lastBuild, setLastBuild] = useState<MapBuildResult | null>(null);
  const [builtMod, setBuiltMod] = useState<string | null>(null);
  const [genOpen, setGenOpen] = useState(false);
  const [lobbyOpen, setLobbyOpen] = useState(false);
  const [issues, setIssues] = useState<MapIssue[] | null>(null);
  const [liveSculpt, setLiveSculpt] = useState<Float32Array | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const snapshot = useRef<(() => string | null) | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const loadedTerrain = useRef<string | null>(null);

  useEffect(() => { if (p.meta?.builtMod && !builtMod) setBuiltMod(p.meta.builtMod); }, [p.meta, builtMod]);

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
    const off = onProgress((e) => (e.task === "map" || e.task === `map:${id}`) && setLog((l) => [...l.slice(-200), e.message]));
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
  const hasWater = water > 0.5;
  const hidden = useMemo(() => new Set(doc.layers.hidden), [doc.layers.hidden]);
  const locked = useMemo(() => new Set(doc.layers.locked), [doc.layers.locked]);
  const isLocked = (s: Sel) => locked.has(s) || locked.has(groupOf(s));
  const activeFeatures = useMemo(() => (hidden.has("grp:feat") ? [] : doc.features.filter((f) => !hidden.has(`feat:${f.id}`))), [doc.features, hidden]);

  // ------------------------------------------------------------ relevo em camadas
  const worldBase = useMemo(() => (relief3d && doc.world ? baseHeights(relief3d, relief3d.heights, water, hasWater, doc.world) : null), [relief3d, doc.world, water, hasWater]);
  const featured = useMemo(() => (relief3d ? composeWorld(relief3d, relief3d.heights, water, hasWater, doc.world, activeFeatures, worldBase) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relief3d, worldBase, activeFeatures, water, hasWater]);
  const sculptLayer = useMemo(() => (relief3d && doc.sculpt && doc.sculptSize === relief3d.size ? decodeLayer(doc.sculpt, (relief3d.size + 1) ** 2) : null), [relief3d, doc.sculpt, doc.sculptSize]);
  const layer = liveSculpt ?? sculptLayer;
  const composed = useMemo(() => {
    if (!featured) return null;
    if (!layer || hidden.has("grp:sculpt")) return featured;
    const out = featured.slice();
    for (let k = 0; k < out.length; k++) out[k] = Math.max(0, Math.min(511, out[k] + layer[k]));
    return out;
  }, [featured, layer, hidden]);
  const heights = useMemo(() => (relief3d && composed ? applyRelief(relief3d, composed, edits.relief, doc.rugged, water) : null), [relief3d, composed, edits.relief, doc.rugged, water]);

  // ------------------------------------------------------------ edição
  const setDoc = useCallback((fn: (d: MapDoc) => MapDoc) => p.commit(fn), [p]);
  const setEdits = useCallback((fn: (e: Edits) => Edits, amend = false) => (amend ? p.amend : p.commit)((d) => {
    const e = fn(d.edits);
    return e === d.edits ? d : { ...d, edits: e };
  }), [p]);

  const symOps = useMemo(() => symmetryOps(doc.symmetry, grid), [doc.symmetry, grid]);
  /** o ponto e as cópias da simetria (sem repetir pontos que caem no mesmo lugar) */
  const mirrors = useCallback((q: Pt): { p: Pt; m: M }[] => {
    const out: { p: Pt; m: M }[] = [];
    for (const o of symOps) {
      const c = o.pt(q);
      const r: Pt = [round1(c[0]), round1(c[1])];
      if (!out.some((u) => Math.hypot(u.p[0] - r[0], u.p[1] - r[1]) < 3)) out.push({ p: r, m: invert(o.m) });
    }
    return out;
  }, [symOps]);

  const ctxRef = useRef({ tool, radius, strength, heights, composed, relief3d, edits, drag, propBp, density, sizeVar, sel, layer, avoidWater, avoidSteep, doc });
  ctxRef.current = { tool, radius, strength, heights, composed, relief3d, edits, drag, propBp, density, sizeVar, sel, layer, avoidWater, avoidSteep, doc };
  const stroke = useRef<Pt | null>(null);
  const moving = useRef<{ from: Pt; ids: Sel[]; started: boolean } | null>(null);
  const brushState = useRef<{ layer: Float32Array; target: number } | null>(null);

  const hAt = (q: Pt) => {
    const { heights: h, relief3d: r } = ctxRef.current;
    return h && r ? heightAt(r, h, q[0], q[1]) : water;
  };
  const slopeAt = (q: Pt) => {
    const d = 4;
    return Math.max(Math.abs(hAt([q[0] + d, q[1]]) - hAt([q[0] - d, q[1]])), Math.abs(hAt([q[0], q[1] + d]) - hAt([q[0], q[1] - d]))) / (2 * d);
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
  const rampOp = (a: Pt, b: Pt): Relief | null => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 16) return null;
    let [x0, x1] = [a[0], b[0]].sort((u, v) => u - v);
    let [z0, z1] = [a[1], b[1]].sort((u, v) => u - v);
    const alongX = x1 - x0 >= z1 - z0;
    const minW = Math.max(24, Math.round(ctxRef.current.radius / 2));
    if (alongX && z1 - z0 < minW) { const c = (z0 + z1) / 2; z0 = Math.round(c - minW / 2); z1 = Math.round(c + minW / 2); }
    if (!alongX && x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = Math.round(c - minW / 2); x1 = Math.round(c + minW / 2); }
    const ya = hAt(a), yb = hAt(b);
    const aLow = alongX ? a[0] <= b[0] : a[1] <= b[1];
    const [lo, hi] = aLow ? [ya, yb] : [yb, ya];
    return { kind: "ramp", op: ["ramp", x0, z0, x1, z1, round1(lo), round1(hi), "set"] };
  };

  // ------------------------------------------------------------ seleção, mover, apagar, duplicar
  const lineHit = (f: Feature, q: Pt) => {
    let best = Infinity;
    for (let i = 0; i < f.pts.length - 1; i++) {
      const [ax, az] = f.pts[i], [bx, bz] = f.pts[i + 1];
      const vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((q[0] - ax) * vx + (q[1] - az) * vz) / l2));
      best = Math.min(best, Math.hypot(q[0] - ax - vx * t, q[1] - az - vz * t));
    }
    return best;
  };

  /** objeto mais perto do ponto (para selecionar com um clique) */
  const pick = (q: Pt, d0: MapDoc): Sel | null => {
    const e = d0.edits;
    const hid = new Set(d0.layers.hidden), lk = new Set(d0.layers.locked);
    const ok = (s: Sel) => !lk.has(s) && !lk.has(groupOf(s)) && !hid.has(groupOf(s));
    const d = (a: Pt) => Math.hypot(a[0] - q[0], a[1] - q[1]);
    let best: [number, Sel] | null = null;
    const take = (dist: number, max: number, s: Sel) => { if (dist <= max && ok(s) && (!best || dist < best[0])) best = [dist, s]; };
    e.spawns.forEach((s, i) => take(d(s), 30, `spawn:${i}`));
    e.mass.forEach((s, i) => take(d(s), 20, `mass:${i}`));
    e.props.forEach((s, i) => take(d([s.x, s.z]), 12, `prop:${i}`));
    if (e.seed) take(d(e.seed), 22, "seed");
    if (best) return (best as [number, Sel])[1];
    e.bridges.forEach(([x0, x1, z0, z1], i) => { if (q[0] >= x0 && q[0] <= x1 && q[1] >= z0 && q[1] <= z1 && ok(`bridge:${i}`)) best = [0, `bridge:${i}`]; });
    for (let i = e.relief.length - 1; i >= 0 && !best; i--) {
      const sh = reliefShape(e.relief[i].op);
      const inside = sh.rect ? q[0] >= sh.rect[0] && q[0] <= sh.rect[1] && q[1] >= sh.rect[2] && q[1] <= sh.rect[3] : d(sh.c) <= sh.r;
      if (inside && ok(`relief:${i}`)) best = [0, `relief:${i}`];
    }
    // formas do terreno: a menor que contém o ponto (a mais específica)
    let fb: [number, Sel] | null = null;
    for (const f of d0.features) {
      const s = `feat:${f.id}`;
      if (!ok(s) || hid.has(s)) continue;
      const dist = LINE_FEATURES.includes(f.kind) && f.pts.length > 1 ? lineHit(f, q) : d(f.pts[0]);
      if (dist <= f.r && (!fb || f.r < fb[0])) fb = [f.r, s];
    }
    if (!best && fb) best = [0, (fb as [number, Sel])[1]];
    e.cuts.forEach(([x, z, r], i) => { if (!best && Math.hypot(x - q[0], z - q[1]) <= r && ok(`cut:${i}`)) best = [0, `cut:${i}`]; });
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
  const moveAll = (d: MapDoc, ids: Sel[], dx: number, dz: number): MapDoc => {
    const fids = new Set(ids.filter((s) => s.startsWith("feat:")).map((s) => s.slice(5)));
    const clamp = (v: number) => Math.max(0, Math.min(grid, Math.round(v)));
    return {
      ...d, edits: moveSel(d.edits, ids, dx, dz),
      features: fids.size ? d.features.map((f) => (fids.has(f.id) ? { ...f, pts: f.pts.map(([x, z]) => [clamp(x + dx), clamp(z + dz)] as Pt) } : f)) : d.features,
    };
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
  const removeAll = (d: MapDoc, ids: Sel[]): MapDoc => {
    const fids = new Set(ids.filter((s) => s.startsWith("feat:")).map((s) => s.slice(5)));
    return { ...d, edits: removeSel(d.edits, ids), features: fids.size ? d.features.filter((f) => !fids.has(f.id)) : d.features };
  };

  const duplicateAll = (d: MapDoc, ids: Sel[]): [MapDoc, Sel[]] => {
    const e = d.edits;
    const n = { ...e, spawns: [...e.spawns], mass: [...e.mass], props: [...e.props], cuts: [...e.cuts], bridges: [...e.bridges], relief: [...e.relief] };
    const feats = [...d.features];
    const out: Sel[] = [];
    const off = 16;
    for (const s of ids) {
      const [k, iS] = s.split(":");
      const i = Number(iS);
      if (k === "spawn" && n.spawns.length < 8) { n.spawns.push([e.spawns[i][0] + off, e.spawns[i][1] + off]); out.push(`spawn:${n.spawns.length - 1}`); }
      else if (k === "mass" && n.mass.length < MAX_MASS) { n.mass.push([e.mass[i][0] + off, e.mass[i][1] + off]); out.push(`mass:${n.mass.length - 1}`); }
      else if (k === "prop" && n.props.length < MAX_PROPS) { const q = e.props[i]; n.props.push({ ...q, x: q.x + off, z: q.z + off, gen: false }); out.push(`prop:${n.props.length - 1}`); }
      else if (k === "cut") { const [x, z, r] = e.cuts[i]; n.cuts.push([x + off, z + off, r]); out.push(`cut:${n.cuts.length - 1}`); }
      else if (k === "bridge") { const [x0, x1, z0, z1] = e.bridges[i]; n.bridges.push([x0 + off, x1 + off, z0 + off, z1 + off]); out.push(`bridge:${n.bridges.length - 1}`); }
      else if (k === "relief") { n.relief.push(e.relief[i]); out.push(`relief:${n.relief.length - 1}`); }
      else if (k === "feat") {
        const f = d.features.find((x) => x.id === s.slice(5));
        if (f) { const c: Feature = { ...f, id: newFeatId(), gen: false, pts: f.pts.map(([x, z]) => [x + off * 2, z + off * 2] as Pt) }; feats.push(c); out.push(`feat:${c.id}`); }
      }
    }
    return [{ ...d, edits: n, features: feats }, out];
  };

  const scatter = (q: Pt): PlacedProp[] => {
    const { propBp: bp, density: n, radius: rad, sizeVar: v, avoidWater: aw, avoidSteep: as } = ctxRef.current;
    if (!bp) return [];
    const out: PlacedProp[] = [];
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const a = Math.random() * Math.PI * 2, d = n === 1 ? 0 : Math.sqrt(Math.random()) * rad;
      const x = Math.round(Math.max(2, Math.min(grid - 2, q[0] + Math.cos(a) * d)) * 10) / 10;
      const z = Math.round(Math.max(2, Math.min(grid - 2, q[1] + Math.sin(a) * d)) * 10) / 10;
      if (n > 1 && aw && hasWater && hAt([x, z]) < water + 2) continue;
      if (n > 1 && as && slopeAt([x, z]) > 1.1) continue;
      i++;
      out.push({ bp, x, z, yaw: Math.round(Math.random() * 360), scale: round1(Math.max(0.3, 1 + (Math.random() * 2 - 1) * (v / 100)) * 100) / 100 });
    }
    // simetria: as mesmas decorações nas cópias
    if (symOps.length > 1) {
      const extra: PlacedProp[] = [];
      for (const o of symOps.slice(1)) for (const q2 of out) { const [x, z] = o.pt([q2.x, q2.z]); extra.push({ ...q2, x: round1(x), z: round1(z), yaw: mapYaw(q2.yaw, o.m) }); }
      return out.concat(extra);
    }
    return out;
  };

  /** forma do terreno nova no ponto (e cópias da simetria) */
  const newFeatures = (kind: FeatureKind, pts: Pt[]): Feature[] => {
    const { radius: rad, strength: s } = ctxRef.current;
    const seed = Math.floor(Math.random() * 1e6);
    const h = kind === "lake" || kind === "river" ? Math.max(3, Math.round(s / 3)) : kind === "pass" || kind === "pad" ? 0 : kind === "dunes" ? Math.max(2, Math.round(s / 3)) : s;
    const r = kind === "river" ? Math.max(10, Math.round(rad / 3)) : kind === "pass" ? Math.max(20, Math.round(rad / 2)) : kind === "ridge" || kind === "canyon" ? Math.max(18, Math.round(rad / 2)) : rad;
    const out: Feature[] = [];
    for (const o of symOps) {
      const tp = pts.map((q) => o.pt(q).map((v) => Math.round(v)) as Pt);
      if (out.some((f) => f.pts.every((q, k) => Math.hypot(q[0] - tp[k][0], q[1] - tp[k][1]) < 4))) continue;
      out.push({ id: newFeatId(), kind, pts: tp, r, h, rough: kind === "pad" || kind === "pass" ? 0.1 : 0.6, seed, m: invert(o.m) });
    }
    return out;
  };

  /** pontos de uma linha desenhada (com curvas naturais em rios e cordilheiras) */
  const linePts = (kind: FeatureKind, a: Pt, b: Pt): Pt[] => {
    const n = 8, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / (L || 1), nz = (b[0] - a[0]) / (L || 1);
    const wav = kind === "river" ? L * 0.06 : kind === "ridge" ? L * 0.04 : 0;
    const noise = simplex(Math.round(a[0] * 7 + b[1]));
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, off = wav * noise(t * 2.3, 0.5) * Math.sin(Math.PI * t) * 2;
      out.push([Math.round(a[0] + (b[0] - a[0]) * t + nx * off), Math.round(a[1] + (b[1] - a[1]) * t + nz * off)]);
    }
    return out;
  };

  const commitSculpt = (l: Float32Array) => {
    const r = ctxRef.current.relief3d;
    const enc = encodeLayer(l);
    p.commit((d) => ({ ...d, sculpt: enc, sculptSize: r?.size ?? 0 }));
  };

  const onPointer = useCallback((type: "down" | "move" | "up", q: Pt | null) => {
    const { tool: t, radius: rad, drag: d, doc: dc } = ctxRef.current;
    if (t === "orbit") return;
    if (q) setCursor(q);
    if (t === "select") {
      if (type === "down" && q) {
        const s = ctxRef.current.sel;
        const hit = pick(q, dc);
        if (!hit) { setSel(new Set(["map"])); moving.current = null; return; }
        const lk = new Set(dc.layers.locked);
        const ids = s.has(hit) ? [...s].filter((x) => x !== "map" && !lk.has(x) && !lk.has(groupOf(x))) : [hit];
        if (!s.has(hit)) setSel(new Set([hit]));
        moving.current = { from: q, ids, started: false };
      } else if (type === "move" && q && moving.current) {
        const m = moving.current;
        const dx = q[0] - m.from[0], dz = q[1] - m.from[1];
        if (Math.hypot(dx, dz) < 1) return;
        // o primeiro passo do arrasto entra no histórico; o resto continua o mesmo passo
        moving.current = { ...m, from: q, started: true };
        (m.started ? p.amend : p.commit)((doc0) => moveAll(doc0, m.ids, dx, dz));
      } else if (type === "up") moving.current = null;
      return;
    }
    // pincel de escultura
    if (isBrush(t)) {
      const mode = t.slice(2) as BrushMode;
      const r = ctxRef.current.relief3d, cur = ctxRef.current.composed;
      if (!r || !cur) return;
      if (type === "up" || !q) {
        if (brushState.current) { commitSculpt(brushState.current.layer); brushState.current = null; setLiveSculpt(null); }
        stroke.current = null;
        return;
      }
      if (type === "down") {
        brushState.current = { layer: ctxRef.current.layer ? ctxRef.current.layer.slice() : new Float32Array((r.size + 1) ** 2), target: heightAt(r, cur, q[0], q[1]) };
        stroke.current = null;
      }
      const bs = brushState.current;
      if (!bs) return;
      if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) < rad * 0.22) return;
      stroke.current = q;
      for (const mq of mirrors(q)) brushDab(r, bs.layer, cur, mode, mq.p[0], mq.p[1], rad, ctxRef.current.strength, bs.target);
      setLiveSculpt(bs.layer.slice());
      return;
    }
    // formas em linha e retângulos (arrastar)
    if (t === "ramp" || t === "bridge" || (isFeat(t) && LINE_FEATURES.includes(featOf(t)))) {
      if (type === "down" && q) setDrag({ a: q, b: q });
      else if (type === "move" && q && d) setDrag({ ...d, b: q });
      else if (type === "up" && d) {
        const b = q ?? d.b;
        setDrag(null);
        if (isFeat(t)) {
          if (Math.hypot(b[0] - d.a[0], b[1] - d.a[1]) < 24) return;
          const fs = newFeatures(featOf(t), linePts(featOf(t), d.a, b));
          p.commit((doc0) => ({ ...doc0, features: [...doc0.features, ...fs] }));
          setSel(new Set(fs.map((f) => `feat:${f.id}`)));
          return;
        }
        if (t === "bridge") {
          const rects = mirrors(d.a).map((ma, k) => {
            const mb = mirrors(b)[k] ?? mirrors(b)[0];
            const [x0, x1] = [ma.p[0], mb.p[0]].sort((u, v) => u - v), [z0, z1] = [ma.p[1], mb.p[1]].sort((u, v) => u - v);
            return [x0, x1, z0, z1] as [number, number, number, number];
          }).filter(([x0, x1, z0, z1]) => x1 - x0 > 6 && z1 - z0 > 6);
          if (rects.length) setEdits((ed) => ({ ...ed, bridges: [...ed.bridges, ...rects] }));
          return;
        }
        const ma = mirrors(d.a), mb = mirrors(b);
        const ops = ma.map((m0, k) => rampOp(m0.p, (mb[k] ?? mb[0]).p)).filter((x): x is Relief => !!x);
        if (ops.length) setEdits((ed) => ({ ...ed, relief: [...ed.relief, ...ops] }));
      }
      return;
    }
    if (!q || type === "up") { stroke.current = null; return; }
    if (isFeat(t) && type === "down") {
      const fs = newFeatures(featOf(t), [q]);
      p.commit((doc0) => ({ ...doc0, features: [...doc0.features, ...fs] }));
      setSel(new Set(fs.map((f) => `feat:${f.id}`)));
      return;
    }
    const pts = mirrors(q).map((m) => m.p);
    if (t === "spawn" && type === "down") setEdits((ed) => (ed.spawns.length >= 8 ? ed : { ...ed, spawns: [...ed.spawns, ...pts].slice(0, 8) }));
    else if (t === "mass" && type === "down") setEdits((ed) => (ed.mass.length >= MAX_MASS ? ed : { ...ed, mass: [...ed.mass, ...pts].slice(0, MAX_MASS) }));
    else if (t === "seed" && type === "down") setEdits((ed) => ({ ...ed, seed: q }));
    else if (t === "erase" && type === "down") { const hit = pick(q, dc); if (hit) p.commit((doc0) => removeAll(doc0, [hit])); }
    else if (t === "decor" || t === "uncut") {
      const apply = (ed: Edits): Edits => {
        if (t === "decor") {
          const list = scatter(q);
          return list.length && ed.props.length < MAX_PROPS ? { ...ed, props: [...ed.props, ...list.slice(0, MAX_PROPS - ed.props.length)] } : ed;
        }
        const r = ctxRef.current.radius;
        const near = (x: PlacedProp) => pts.some((c) => Math.hypot(x.x - c[0], x.z - c[1]) <= r);
        const cuts = ed.cuts.length + pts.length <= MAX_CUTS ? [...ed.cuts, ...pts.map((c) => [c[0], c[1], r] as [number, number, number])] : ed.cuts;
        return { ...ed, props: ed.props.filter((x) => !near(x)), cuts };
      };
      const gap = t === "decor" ? (ctxRef.current.density === 1 ? 8 : rad * 0.8) : rad * 0.6;
      if (type === "down") { stroke.current = q; setEdits(apply); }
      else if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) > gap) { stroke.current = q; setEdits(apply, true); }
    } else if (isRelief(t)) {
      const add = (ed: Edits) => {
        const ops = pts.map((c) => reliefOp(t, c)).filter((x): x is Relief => !!x);
        return ed.relief.length + ops.length > 400 ? ed : { ...ed, relief: [...ed.relief, ...ops] };
      };
      if (type === "down") { stroke.current = q; setEdits(add); }
      else if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) > rad * 0.45) { stroke.current = q; setEdits(add, true); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, setEdits, grid, mirrors, symOps]);

  // ------------------------------------------------------------ derivados
  const groundLayers: GroundLayer[] = useMemo(() => (doc.terrain && assets ? assets.layers.filter((l) => l.map.toLowerCase() === doc.terrain!.toLowerCase()) : []), [doc.terrain, assets]);
  const allCuts = useMemo(() => (doc.world?.clearDonor ? [...edits.cuts, ...fullCuts(grid)] : edits.cuts), [edits.cuts, doc.world?.clearDonor, grid]);
  const [kept, removedCount] = useMemo(() => {
    const bps = donor?.kinds ?? [];
    const kinds = bps.map(decorKind);
    const inCut = cutTester(allCuts);
    const out: DecorPoint[] = [];
    let removed = 0;
    for (const [x, z, , yaw, scale, k] of donor?.props ?? []) {
      if (inCut(x, z)) { removed++; continue; }
      out.push({ x, z, yaw, scale, kind: kinds[k] ?? "other", bp: bps[k] });
    }
    return [out, removed] as const;
  }, [donor, allCuts]);
  const decor = useMemo(() => (showDecor && !hidden.has("grp:prop") ? kept.concat(edits.props.map((q) => ({ x: q.x, z: q.z, yaw: q.yaw, scale: q.scale, kind: decorKind(q.bp), bp: q.bp, added: true }))) : []), [kept, edits.props, showDecor, hidden]);

  const teamOf = useCallback((i: number) => (doc.teams === "ffa" ? i : i < Math.ceil(edits.spawns.length / 2) ? 0 : 1), [doc.teams, edits.spawns.length]);
  const markers: Marker[] = useMemo(() => (hidden.has("grp:spawn") ? [] : edits.spawns.map((q, i) => ({ p: q, color: TEAM_COLORS[teamOf(i) % 8], label: String(i + 1) }))), [edits.spawns, teamOf, hidden]);
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
      else if (k === "feat") {
        const f = doc.features.find((x) => x.id === s.slice(5));
        if (f && !LINE_FEATURES.includes(f.kind)) out.push([f.pts[0][0], f.pts[0][1], f.r]);
        else if (f) for (const q of [f.pts[0], f.pts[f.pts.length - 1]]) out.push([q[0], q[1], f.r]);
      }
    }
    return out;
  }, [sel, edits, doc.features]);
  const lines = useMemo(() => {
    const selF = new Set([...sel].filter((s) => s.startsWith("feat:")).map((s) => s.slice(5)));
    return activeFeatures.filter((f) => LINE_FEATURES.includes(f.kind) && f.pts.length > 1 && (selF.has(f.id) || f.kind === "pass")).map((f) => ({ pts: f.pts, color: selF.has(f.id) ? "#ffd166" : FEATURE_COLOR[f.kind] }));
  }, [activeFeatures, sel]);

  const usesWorld = !!doc.world || activeFeatures.length > 0 || !!doc.sculpt;
  const editsTerrain = edits.relief.length > 0 || doc.rugged || edits.bridges.length > 0 || usesWorld;
  const usePatch = doc.patch || editsTerrain;
  const lobbyName = `[${edits.spawns.length}] ${doc.lobbyName.trim()}`;
  const waterNew = hasWater && editsTerrain && !!doc.terrain;
  const scenarioId = waterNew ? fitId(slugId(doc.lobbyName), doc.terrain!.length) : slugId(doc.lobbyName);

  const spec = useMemo(() => {
    if (!doc.terrain) return null;
    const { spawns, mass, bridges, seed, relief, props, reskin } = edits;
    const ids = spawns.map((_, i) => i + 1);
    const teamList = doc.teams === "ffa" ? ids.map((i) => [i]) : [ids.filter((_, i) => teamOf(i) === 0), ids.filter((_, i) => teamOf(i) === 1)];
    const s: Record<string, unknown> = {
      terrain: doc.terrain, scenario_id: scenarioId, name: lobbyName, anchors: Object.fromEntries(spawns.map((q, i) => [String(i + 1), q])), teams: teamList,
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
    if (allCuts.length) s.props_remove = allCuts;
    if (waterNew) s.water_rewrite = true;
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
  }, [doc, edits, usePatch, grid, groundLayers, lobbyName, allCuts, scenarioId, waterNew]);

  // ------------------------------------------------------------ ações
  const saveNow = useCallback(async () => {
    const thumb = snapshot.current?.() ?? null;
    const ok = await p.save({ thumb });
    if (ok && p.meta && doc.lobbyName && p.meta.name !== doc.lobbyName) renameTab(id, p.meta.name);
    return ok;
  }, [p, doc.lobbyName, id, renameTab]);

  const runCheck = () => (relief3d && heights ? checkMap(relief3d, heights, water, hasWater, edits.spawns, edits.mass, edits.props, teamOf) : null);
  const autoFix = () => {
    if (!relief3d || !heights) return;
    const f = autoFixMap(relief3d, heights, water, hasWater, edits.spawns, edits.mass, edits.props);
    if (!f.changes.length) { toast("info", "Nada para corrigir automaticamente."); return; }
    p.commit((d) => ({ ...d, edits: { ...d.edits, mass: f.mass, props: f.props } }));
    toast("ok", `Corrigido: ${f.changes.slice(0, 4).join("; ")}${f.changes.length > 4 ? ` e mais ${f.changes.length - 4}` : ""}. Dá para desfazer com Ctrl+Z.`);
    window.setTimeout(() => setIssues(runCheck()), 50);
  };
  const build = async (play: boolean) => {
    if (!spec) return;
    if (usesWorld && (!relief3d || !composed)) { toast("info", "Espere o relevo do terreno carregar para gerar."); return; }
    const found = runCheck();
    const errs = found?.filter((x) => x.level === "err") ?? [];
    if (errs.length) {
      setIssues(found);
      if (!(await confirmDialog(`O mapa tem ${errs.length} problema(s) grave(s):\n\n- ${errs.slice(0, 5).map((x) => x.text).join("\n- ")}\n\nGerar mesmo assim?`, "Gerar mesmo assim", "Revisar"))) return;
    }
    setLog([]);
    setLastBuild(null);
    await saveNow();
    const full: Record<string, unknown> = { ...spec };
    if (usesWorld && relief3d && composed) {
      const data = encodeDelta(composed, relief3d.heights);
      if (data) full.height_delta = { size: relief3d.size, scale: 1 / 32, data };
    }
    const r = await run(`map:${id}`, () => api.maptkBuild(full, id), (x) => `"${x.manifest.name}" gerado, verificado e ligado na biblioteca.`);
    if (!r) return;
    setLastBuild(r.result);
    setBuiltMod(r.manifest.id);
    await refreshMods();
    if (play) await run("launch", () => api.launchGame(), "Abrindo o jogo com o mapa novo…");
  };

  const exportScd = async () => {
    if (!builtMod) { toast("info", "Gere o mapa primeiro: o .scd sai do botão Gerar mapa."); return; }
    const dir = await pickFile([], true);
    if (!dir) return;
    await run("export", async () => {
      try { return await api.modExportFiles(builtMod, dir); } catch (e) {
        const m = /EXISTE: (.*)/.exec(String(e));
        if (!m) throw e;
        if (!(await confirmDialog(`Já existe nessa pasta: ${m[1]}\n\nSubstituir?`, "Substituir"))) throw new Error("Exportação cancelada: o arquivo existente foi mantido.");
        return api.modExportFiles(builtMod, dir, true);
      }
    }, (files) => `Mapa salvo em ${files[0] ?? dir}.`);
  };

  const selIds = [...sel].filter((s) => s !== "map");
  const doDelete = () => { const ids = selIds.filter((s) => !isLocked(s)); if (!ids.length) return; p.commit((d) => removeAll(d, ids)); setSel(new Set(["map"])); };
  const doDuplicate = () => {
    if (!selIds.length) return;
    let created: Sel[] = [];
    p.commit((d) => { const [n, out] = duplicateAll(d, selIds); created = out; return n; });
    setTimeout(() => setSel(new Set(created.length ? created : ["map"])), 0);
  };

  const applyWorld = async (wg: WorldGen, res: WorldResult) => {
    const genMass = (wg.resources ?? "generated") === "generated";
    let replaceMass = true;
    if (genMass && edits.mass.length) {
      replaceMass = await confirmDialog(`O mapa já tem ${edits.mass.length} ponto(s) de massa. Trocar pelos ${res.mass.length} pontos simétricos do gerador?\n\n(Cancelar mantém os seus e soma os novos.)`, "Trocar", "Manter os meus");
    }
    p.commit((d) => {
      const props = [...d.edits.props.filter((q) => !q.gen), ...res.props].slice(0, MAX_PROPS);
      const eco = wg.economy === "poor" ? { baseMass: 3, sites: 5, perSite: 2 } : wg.economy === "rich" ? { baseMass: 6, sites: 12, perSite: 4 } : { baseMass: 4, sites: 8, perSite: 3 };
      // massa gerada aqui (visível e editável): o toolkit não sorteia expansões por cima
      const economy = genMass ? { ...eco, sites: 0 } : eco;
      const mass = genMass ? (replaceMass ? res.mass : [...d.edits.mass, ...res.mass]).slice(0, MAX_MASS) : d.edits.mass;
      const minimap: MapDoc["minimap"] = wg.biome === "desert" ? "desert" : wg.biome === "snow" ? "snow" : wg.biome === "volcanic" ? "dark" : "natural";
      return {
        ...d, world: wg, features: [...d.features.filter((f) => !f.gen), ...res.features], economy, minimap, patch: true,
        teams: wg.players % 2 === 0 && wg.symmetry !== "none" ? "2" : "ffa", rugged: wg.edge === "rugged",
        edits: { ...d.edits, spawns: res.spawns, props, mass },
      };
    });
    setGenOpen(false);
    setSkin("relief");
    setSel(new Set(["map"]));
    toast("ok", `Mundo gerado: ${res.features.filter((f) => f.kind !== "pad").length} formas, ${res.props.length} decorações, ${res.mass.length} pontos de massa e ${res.spawns.length} bases. Tudo pode ser editado.`);
  };
  const removeWorld = async () => {
    if (!(await confirmDialog("Tirar o mundo gerado? Formas e decorações criadas pelo gerador saem; as que você colocou ficam.", "Tirar"))) return;
    p.commit((d) => ({ ...d, world: null, features: d.features.filter((f) => !f.gen), edits: { ...d.edits, props: d.edits.props.filter((q) => !q.gen) } }));
    setSkin("game");
  };

  const toggleLayer = (key: "hidden" | "locked", nid: string) => p.commit((d) => {
    const cur = new Set(d.layers[key]);
    if (cur.has(nid)) cur.delete(nid); else cur.add(nid);
    return { ...d, layers: { ...d.layers, [key]: [...cur] } };
  });

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
    g: () => setGenOpen(true),
    r: () => setTool("b-raise"),
    f: () => setTool("b-lower"),
    s: () => setTool("b-smooth"),
  });

  // ------------------------------------------------------------ análise (sob demanda)
  useEffect(() => {
    if (skin !== "analysis" || !relief3d || !heights) { setAnalysis(null); return; }
    const t = window.setTimeout(() => setAnalysis(analyzeMap(relief3d, heights, water, hasWater, edits.spawns, teamOf, edits.mass, doc.world?.biome ?? "temperate")), 150);
    return () => window.clearTimeout(t);
  }, [skin, relief3d, heights, water, hasWater, edits.spawns, edits.mass, teamOf, doc.world?.biome]);

  // ------------------------------------------------------------ explorer
  const nodes: TreeNode[] = useMemo(() => {
    const grp = (k: string, label: string, icon: string, color: string, list: TreeNode[], lockable = true): TreeNode => ({
      id: `grp:${k}`, label, icon, color, detail: String(list.length), children: list, hidden: hidden.has(`grp:${k}`), locked: lockable ? locked.has(`grp:${k}`) : undefined,
    });
    const nice = (bp: string) => bp.split("/").pop()?.replace(/_prop\.bp$/i, "").replace(/_/g, " ") ?? bp;
    const count: Partial<Record<FeatureKind, number>> = {};
    const featNodes = doc.features.map((f) => {
      count[f.kind] = (count[f.kind] ?? 0) + 1;
      return { id: `feat:${f.id}`, label: f.name || `${FEATURE_LABEL[f.kind]} ${count[f.kind]}`, icon: FEATURE_ICON[f.kind], color: FEATURE_COLOR[f.kind], detail: f.gen ? "gerada" : undefined, hidden: hidden.has(`feat:${f.id}`), locked: locked.has(`feat:${f.id}`) };
    });
    return [{
      id: "map", label: doc.lobbyName || "Mapa", icon: "public", color: "#7bd88f", detail: terrain?.name ?? doc.terrain ?? "sem terreno",
      children: [
        ...(doc.world ? [{ id: "world", label: `Mundo gerado (semente ${doc.world.seed})`, icon: "auto_awesome", color: "#a3e635" }] : []),
        grp("spawn", "Bases", "flag", "#5aa9e6", edits.spawns.map((q, i) => ({ id: `spawn:${i}`, label: `Base ${i + 1}`, icon: "flag", color: TEAM_COLORS[teamOf(i) % 8], detail: `${Math.round(q[0])}, ${Math.round(q[1])}` }))),
        grp("mass", "Massa", "diamond", "#7bd88f", edits.mass.map((q, i) => ({ id: `mass:${i}`, label: `Massa ${i + 1}`, icon: "diamond", color: "#7bd88f", detail: `${Math.round(q[0])}, ${Math.round(q[1])}` }))),
        grp("feat", "Formas do terreno", "landscape", "#b08a62", featNodes),
        ...(doc.sculpt ? [{ id: "grp:sculpt", label: "Pincel de escultura", icon: "brush", color: "#e3a857", hidden: hidden.has("grp:sculpt") }] : []),
        grp("relief", "Relevo simples", "terrain", "#e3a857", edits.relief.map((r, i) => ({ id: `relief:${i}`, label: RELIEF_LABEL[r.kind], icon: RELIEF_ICON[r.kind], color: RELIEF_COLOR[r.kind] }))),
        grp("bridge", "Passagens na água", "route", "#f2b33d", edits.bridges.map((_, i) => ({ id: `bridge:${i}`, label: `Passagem ${i + 1}`, icon: "route", color: "#f2b33d" }))),
        grp("prop", "Decorações novas", "park", "#4f9a46", edits.props.slice(0, 2000).map((q, i) => ({ id: `prop:${i}`, label: nice(q.bp), icon: decorKind(q.bp) === "tree" ? "park" : decorKind(q.bp) === "rock" ? "landslide" : "domain", color: q.bp.includes("/cp/") ? "#5aa9e6" : "#7fae6b", detail: q.gen ? "gerada" : `${Math.round(q.x)}, ${Math.round(q.z)}` }))),
        grp("cut", "Decorações retiradas", "content_cut", "#e5534b", edits.cuts.map((c, i) => ({ id: `cut:${i}`, label: `Área ${i + 1}`, icon: "content_cut", color: "#e5534b", detail: `r ${Math.round(c[2])}` }))),
        ...(edits.seed ? [{ id: "seed", label: "Ponto de partida", icon: "my_location", color: "#fff" }] : []),
        { id: "grp:reskin", label: "Texturas trocadas", icon: "format_paint", color: "#c78bff", detail: String(Object.keys(edits.reskin).length), children: Object.entries(edits.reskin).map(([k, v]) => ({ id: `reskin:${k}`, label: `${k.split("_").slice(-2, -1)[0] ?? "camada"} → ${v.name}`, icon: "format_paint", color: "#c78bff" })) },
      ],
    }];
  }, [edits, doc.lobbyName, doc.terrain, doc.world, doc.features, doc.sculpt, terrain, hidden, locked, teamOf]);

  const onTreeSelect = (nid: string, mode: "set" | "toggle" | "range") => {
    if (nid === "world") { setSel(new Set(["map"])); return; }
    if (nid.startsWith("grp:")) {
      const all = nodes[0].children!.find((c) => c.id === nid)?.children?.map((c) => c.id) ?? [];
      if (all.length) setSel(new Set(all));
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
        { kind: "text", label: "Nome no lobby", value: doc.lobbyName, onChange: (v) => setDoc((d) => ({ ...d, lobbyName: v.slice(0, 48) })), hint: `Aparece como "${lobbyName}". Id: ${scenarioId}` },
        { kind: "select", label: "Terreno base", value: doc.terrain ?? "", onChange: (v) => setDoc((d) => ({ ...d, terrain: v || null })), options: [{ value: "", label: "— escolha —" }, ...(terrains ?? []).map((t) => ({ value: t.id, label: `${t.name ?? t.id}${t.kind === "campaign" ? " (campanha)" : ""}${t.waterY ? " · água" : ""}` }))] },
        { kind: "select", label: "Times", value: doc.teams, onChange: (v) => setDoc((d) => ({ ...d, teams: v as MapDoc["teams"] })), options: [{ value: "2", label: "Dois times" }, { value: "ffa", label: "Todos contra todos" }] },
        { kind: "select", label: "Simetria ao colocar", value: doc.symmetry, onChange: (v) => setDoc((d) => ({ ...d, symmetry: v as Symmetry })), options: (Object.keys(SYMMETRY_LABEL) as Symmetry[]).map((k) => ({ value: k, label: SYMMETRY_LABEL[k] })), hint: "Bases, massa, decorações, formas e pinceladas são repetidas nos outros lados." },
        { kind: "number", label: "Raio sem ataque inicial", value: doc.norush, min: 0, max: 200, onChange: (v) => setDoc((d) => ({ ...d, norush: v })) },
        { kind: "select", label: "Minimapa do lobby", value: doc.minimap, onChange: (v) => setDoc((d) => ({ ...d, minimap: v as MapDoc["minimap"] })), options: [{ value: "donor", label: "Original do terreno" }, { value: "natural", label: "Gerar: cores do relevo" }, { value: "desert", label: "Gerar: deserto" }, { value: "snow", label: "Gerar: neve" }, { value: "dark", label: "Gerar: rocha escura" }] },
        { kind: "custom", label: "", node: <button className="btn sm" onClick={() => setLobbyOpen(true)}><Icon name="preview" size={16} /> Prévia do lobby</button> },
      ] });
      sections.push({ title: "Gerador de mundo", props: doc.world ? [
        { kind: "info", label: "Estilo", value: `${WORLD_PRESETS.find((x) => x.id === doc.world!.preset)?.label ?? doc.world.preset} · ${BIOME_LABEL[doc.world.biome]}` },
        { kind: "info", label: "Semente", value: String(doc.world.seed) },
        { kind: "custom", label: "", node: <span className="row" style={{ gap: 6, flexWrap: "wrap" }}><button className="btn sm" onClick={() => setGenOpen(true)}><Icon name="auto_awesome" size={16} /> Gerar de novo</button><button className="btn sm text" onClick={() => void removeWorld()}><Icon name="layers_clear" size={16} /> Tirar</button></span> },
      ] : [
        { kind: "custom", label: "", node: <button className="btn sm primary" disabled={!relief3d} onClick={() => setGenOpen(true)}><Icon name="auto_awesome" size={16} /> Gerar mundo</button> },
        { kind: "info", label: "", value: "Relevo, montanhas, lagos, rios, florestas e estruturas, editáveis depois." },
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
        { kind: "info", label: "Água", value: hasWater ? `nível ${round1(water)}${waterNew ? " · lagos e rios novos (experimental)" : ""}` : "este terreno não tem água" },
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
      if (k === "feat") {
        const f = doc.features.find((x) => x.id === one.slice(5));
        if (f) {
          const setF = (patch: Partial<Feature>) => p.commit((d) => ({ ...d, features: d.features.map((x) => (x.id === f.id ? { ...x, ...patch, gen: false } : x)) }));
          const isLine = LINE_FEATURES.includes(f.kind);
          const depth = f.kind === "lake" || f.kind === "river" || f.kind === "canyon" || f.kind === "crater";
          const fields: Prop[] = [
            { kind: "text", label: "Nome", value: f.name ?? "", placeholder: FEATURE_LABEL[f.kind], onChange: (v) => setF({ name: v.slice(0, 40) || undefined }) },
            { kind: "select", label: "Tipo", value: f.kind, onChange: (v) => setF({ kind: v as FeatureKind }), options: (Object.keys(FEATURE_LABEL) as FeatureKind[]).filter((x) => LINE_FEATURES.includes(x) === isLine).map((x) => ({ value: x, label: FEATURE_LABEL[x] })) },
          ];
          if (!isLine) fields.push(
            { kind: "number", label: "Centro X", value: f.pts[0][0], min: 0, max: grid, onChange: (v) => setF({ pts: [[v, f.pts[0][1]]] }) },
            { kind: "number", label: "Centro Z", value: f.pts[0][1], min: 0, max: grid, onChange: (v) => setF({ pts: [[f.pts[0][0], v]] }) },
          );
          else fields.push({ kind: "info", label: "Linha", value: `${f.pts.length} pontos, ${Math.round(f.pts.slice(1).reduce((a, q, k2) => a + Math.hypot(q[0] - f.pts[k2][0], q[1] - f.pts[k2][1]), 0))} de comprimento` });
          fields.push({ kind: "slider", label: isLine ? "Largura" : "Raio", value: f.r, min: isLine ? 6 : 15, max: isLine ? 120 : 320, onChange: (v) => setF({ r: v }) });
          if (f.kind !== "pad" && f.kind !== "pass") fields.push({ kind: "slider", label: depth ? "Profundidade" : "Altura", value: f.h, min: 1, max: depth ? 60 : 160, onChange: (v) => setF({ h: v }) });
          fields.push(
            { kind: "slider", label: "Irregularidade", value: Math.round(f.rough * 100), min: 0, max: 100, unit: "%", onChange: (v) => setF({ rough: v / 100 }) },
            { kind: "custom", label: "Forma", node: <button className="btn sm" onClick={() => setF({ seed: Math.floor(Math.random() * 1e6) })}><Icon name="casino" size={16} /> Variar</button> },
          );
          if ((f.kind === "lake" || f.kind === "river") && !hasWater) fields.push({ kind: "info", label: "Água", value: "Este terreno não tem água: vira um vale seco." });
          if (f.gen) fields.push({ kind: "info", label: "", value: "Criada pelo gerador. Ao mudar algo ela passa a ser sua (fica ao gerar de novo)." });
          sections.push({ title: FEATURE_LABEL[f.kind], props: fields });
        }
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
      if (one === "grp:sculpt") sections.push({ title: "Pincel de escultura", props: [
        { kind: "custom", label: "", node: <button className="btn sm" onClick={() => p.commit((d) => ({ ...d, sculpt: null, sculptSize: 0 }))}><Icon name="layers_clear" size={16} /> Apagar tudo que foi pintado</button> },
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
  }, [sel, edits, doc, terrains, grid, usePatch, editsTerrain, lobbyName, water, hasWater, scenarioId, waterNew, relief3d]);

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

  const catalog = useMemo(() => propCatalog(assets?.props ?? []), [assets]);
  const reliefTexture = useMemo(() => (view === "2d" && skin === "relief" && relief3d && heights ? reliefImage(relief3d, heights, water, hasWater, doc.world?.biome ?? "temperate", 512) : null),
    [view, skin, relief3d, heights, water, hasWater, doc.world?.biome]);
  const lobbyImage = useMemo(() => {
    if (!lobbyOpen || !relief3d || !heights) return null;
    if (doc.minimap === "donor") return relief3d.texture ?? preview?.dataUrl ?? null;
    const biome = doc.minimap === "desert" ? "desert" : doc.minimap === "snow" ? "snow" : doc.minimap === "dark" ? "volcanic" : (doc.world?.biome ?? "temperate");
    return reliefImage(relief3d, heights, water, hasWater, biome, 384);
  }, [lobbyOpen, relief3d, heights, doc.minimap, doc.world?.biome, water, hasWater, preview]);

  // ------------------------------------------------------------ interface
  if (p.status === "loading") return <div className="studio-root"><div className="bar indeterminate" style={{ margin: 30 }}><i /></div></div>;
  if (p.status === "error") return <div className="studio-root"><Empty icon="error" title="Não deu para abrir o projeto">{p.error}</Empty></div>;

  const brushTool = isBrush(tool);
  const circleBrush = (isRelief(tool) && tool !== "ramp") || tool === "uncut" || (tool === "decor" && density > 1) || brushTool || (isFeat(tool) && POINT_FEATS.includes(featOf(tool)));
  const brushColor = isRelief(tool) ? RELIEF_COLOR[tool] : brushTool ? BRUSH[tool.slice(2) as BrushMode].color : isFeat(tool) ? FEATURE_COLOR[featOf(tool)] : tool === "erase" || tool === "uncut" ? "#e5534b" : tool === "select" ? "#ffd166" : "#a3e635";
  const brush = tool === "orbit" ? null : circleBrush ? { shape: "circle" as const, radius, color: brushColor } : { shape: "point" as const, color: brushColor };
  const toolBtn = (t: Tool, icon: string, label: string, color?: string) => (
    <RibbonButton key={t} icon={icon} label={label} active={tool === t} onClick={() => setTool(t)} hint={hintOf(t)} color={color} />
  );
  const image2d = skin === "analysis" && analysis ? analysis.image : skin === "relief" ? reliefTexture : skin === "game" && relief3d?.texture ? relief3d.texture : preview?.dataUrl;
  const texture3d = skin === "analysis" ? analysis?.image ?? null : skin === "relief" ? null : skin === "game" ? relief3d?.texture ?? null : preview?.dataUrl ?? null;
  const toWorld = (e: React.PointerEvent): Pt => {
    const r = stage.current!.getBoundingClientRect();
    return [Math.max(0, Math.min(grid, Math.round(((e.clientX - r.left) / r.width) * grid))), Math.max(0, Math.min(grid, Math.round(((e.clientY - r.top) / r.height) * grid)))];
  };
  const sizeSliders = (
    <div className="ribbon-stack" style={{ width: 210 }}>
      <label className="range" style={{ gridTemplateColumns: "48px 1fr 34px" }}><span>Raio</span><input type="range" min={8} max={260} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><output>{radius}</output></label>
      <label className="range" style={{ gridTemplateColumns: "48px 1fr 34px" }}><span>{brushTool ? "Força" : "Altura"}</span><input type="range" min={2} max={120} value={strength} onChange={(e) => setStrength(Number(e.target.value))} /><output>{strength}</output></label>
    </div>
  );
  const symSelect = (
    <div className="ribbon-stack" style={{ width: 190 }}>
      <select className="pinput" value={doc.symmetry} onChange={(e) => setDoc((d) => ({ ...d, symmetry: e.target.value as Symmetry }))} aria-label="Simetria">
        {(Object.keys(SYMMETRY_LABEL) as Symmetry[]).map((k) => <option key={k} value={k}>{SYMMETRY_LABEL[k]}</option>)}
      </select>
      <span className="faint small">{doc.symmetry === "none" ? "Coloca só onde clicar" : "Repete nos outros lados"}</span>
    </div>
  );
  const genBtn = <RibbonButton icon="auto_awesome" label="Gerar mundo" onClick={() => setGenOpen(true)} disabled={!relief3d} color="#a3e635" hint="Relevo, montanhas, lagos, rios, florestas e estruturas a partir de uma semente (G)" />;

  return (
    <div className="studio-root">
      <div className="studio-top">
        <Ribbon active={ribbon} onTab={setRibbon}
          tabs={[{ id: "home", label: "Início" }, { id: "terrain", label: "Terreno" }, { id: "shapes", label: "Formas" }, { id: "objects", label: "Objetos" }, { id: "view", label: "Exibir" }, { id: "game", label: "Jogo" }]}>
          {ribbon === "home" && <>
            <RibbonGroup label="Ferramentas">
              {toolBtn("select", "near_me", "Selecionar")}
              {toolBtn("orbit", "3d_rotation", "Câmera")}
              {toolBtn("erase", "layers_clear", "Apagar", "#e5534b")}
            </RibbonGroup>
            <RibbonGroup label="Mundo">{genBtn}</RibbonGroup>
            <RibbonGroup label="Editar">
              <RibbonButton icon="content_copy" label="Duplicar" onClick={doDuplicate} disabled={!selIds.length} hint="Ctrl+D" />
              <RibbonButton icon="delete" label="Excluir" onClick={doDelete} disabled={!selIds.length} hint="Del" />
              <RibbonButton icon="deselect" label="Limpar seleção" onClick={() => setSel(new Set(["map"]))} disabled={!selIds.length} />
            </RibbonGroup>
            <RibbonGroup label="Inserir">
              {toolBtn("spawn", "flag", `Bases ${edits.spawns.length}/8`, "#5aa9e6")}
              {toolBtn("mass", "diamond", "Massa", "#7bd88f")}
              {toolBtn("f-mountain", FEATURE_ICON.mountain, "Montanha", FEATURE_COLOR.mountain)}
              {toolBtn("f-lake", FEATURE_ICON.lake, "Lago", FEATURE_COLOR.lake)}
              {toolBtn("decor", "park", "Decorar", "#7fae6b")}
            </RibbonGroup>
            <RibbonGroup label="Testar">
              <RibbonButton icon="construction" label={busy ? "Gerando…" : "Gerar mapa"} onClick={() => void build(false)} disabled={!spec || edits.spawns.length < 2 || busy} color="#a3e635" hint="Gera o .scd, verifica e liga o mapa na biblioteca" />
              <RibbonButton icon="play_circle" label="Gerar e jogar" onClick={() => void build(true)} disabled={!spec || edits.spawns.length < 2 || busy} color="#a3e635" />
            </RibbonGroup>
          </>}
          {ribbon === "terrain" && <>
            <RibbonGroup label="Mundo">{genBtn}</RibbonGroup>
            <RibbonGroup label="Pincel">
              {(Object.keys(BRUSH) as BrushMode[]).map((m) => toolBtn(`b-${m}`, BRUSH[m].icon, BRUSH[m].label, BRUSH[m].color))}
            </RibbonGroup>
            <RibbonGroup label="Tamanho">{sizeSliders}</RibbonGroup>
            <RibbonGroup label="Simetria">{symSelect}</RibbonGroup>
            <RibbonGroup label="Mapa inteiro">
              <RibbonButton icon="fence" label="Borda rochosa" active={doc.rugged} onClick={() => setDoc((d) => ({ ...d, rugged: !d.rugged }))} />
              <RibbonButton icon="horizontal_rule" label="Aplainar tudo" active={doc.smooth} onClick={() => setDoc((d) => ({ ...d, smooth: !d.smooth }))} />
              <RibbonButton icon="format_paint" label="Texturas do chão" onClick={() => setLeft("ground")} />
              <RibbonButton icon="clear_all" label="Limpar relevo" onClick={async () => {
                if (!(await confirmDialog("Apagar o relevo simples, as formas, o que foi pintado e as passagens? (Ctrl+Z desfaz.)", "Limpar"))) return;
                p.commit((d) => ({ ...d, features: d.features.filter((f) => f.kind === "pad"), sculpt: null, edits: { ...d.edits, relief: [], bridges: [] } }));
              }} disabled={!edits.relief.length && !edits.bridges.length && !doc.features.length && !doc.sculpt} />
            </RibbonGroup>
          </>}
          {ribbon === "shapes" && <>
            <RibbonGroup label="Elevações">
              {(["mountain", "hill", "ridge", "plateau", "dunes", "island"] as FeatureKind[]).filter((k) => k !== "island" || hasWater)
                .map((k) => toolBtn(`f-${k}`, FEATURE_ICON[k], FEATURE_LABEL[k], FEATURE_COLOR[k]))}
            </RibbonGroup>
            <RibbonGroup label="Água e cavidades">
              {(["lake", "river", "canyon", "crater", "pass"] as FeatureKind[]).map((k) => toolBtn(`f-${k}`, FEATURE_ICON[k], FEATURE_LABEL[k], FEATURE_COLOR[k]))}
            </RibbonGroup>
            <RibbonGroup label="Tamanho">{sizeSliders}</RibbonGroup>
            <RibbonGroup label="Relevo simples">
              {(["hill", "valley", "plateau", "flatten", "ramp"] as ReliefKind[]).map((k) => toolBtn(k, RELIEF_ICON[k], RELIEF_LABEL[k], RELIEF_COLOR[k]))}
              {toolBtn("bridge", "route", "Vau", "#f2b33d")}
            </RibbonGroup>
          </>}
          {ribbon === "objects" && <>
            <RibbonGroup label="Jogo">
              {toolBtn("spawn", "flag", "Bases", "#5aa9e6")}
              {toolBtn("mass", "diamond", "Massa", "#7bd88f")}
              {toolBtn("f-pad", FEATURE_ICON.pad, "Área plana", FEATURE_COLOR.pad)}
              {toolBtn("seed", "my_location", "Partida")}
            </RibbonGroup>
            <RibbonGroup label="Decorações">
              {toolBtn("decor", "park", "Decorar", "#7fae6b")}
              {toolBtn("uncut", "content_cut", "Tirar", "#e5534b")}
              <RibbonButton icon="inventory_2" label="Meus modelos" onClick={() => setLeft("mine")} color="#5aa9e6" />
            </RibbonGroup>
            <RibbonGroup label="Espalhar">
              <div className="ribbon-stack" style={{ width: 230 }}>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>Por clique</span><input type="range" min={1} max={40} value={density} onChange={(e) => setDensity(Number(e.target.value))} /><output>{density}</output></label>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>Variação</span><input type="range" min={0} max={60} step={5} value={sizeVar} onChange={(e) => setSizeVar(Number(e.target.value))} /><output>{sizeVar}%</output></label>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>Área</span><input type="range" min={8} max={260} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><output>{radius}</output></label>
              </div>
              <div className="ribbon-stack">
                <label className="check small"><input type="checkbox" checked={avoidWater} onChange={(e) => setAvoidWater(e.target.checked)} /> Evitar água</label>
                <label className="check small"><input type="checkbox" checked={avoidSteep} onChange={(e) => setAvoidSteep(e.target.checked)} /> Evitar encostas</label>
              </div>
            </RibbonGroup>
            <RibbonGroup label="Simetria">{symSelect}</RibbonGroup>
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
              <RibbonButton icon="texture" label="Textura do jogo" active={skin === "game"} disabled={!relief3d?.texture} onClick={() => setSkin("game")} hint="Minimapa do terreno base (o que o jogo mostra hoje)" />
              <RibbonButton icon="landscape" label="Cores do relevo" active={skin === "relief"} onClick={() => setSkin("relief")} hint="Água, areia, grama, rocha e neve pela altura e inclinação" />
              <RibbonButton icon="grid_on" label="Navegação" active={skin === "nav"} onClick={() => setSkin("nav")} />
              <RibbonButton icon="insights" label="Análise" active={skin === "analysis"} onClick={() => setSkin("analysis")} hint="Território de cada base, caminhos e gargalos" color="#ffd166" />
              <RibbonButton icon={showDecor ? "park" : "visibility_off"} label="Decorações" active={showDecor} onClick={() => setShowDecor((v) => !v)} />
            </RibbonGroup>
            <RibbonGroup label="Relevo">
              <div className="ribbon-stack" style={{ width: 200 }}>
                <label className="range" style={{ gridTemplateColumns: "60px 1fr 34px" }}><span>Exagero</span><input type="range" min={1} max={4} step={0.25} value={exag} onChange={(e) => setExag(Number(e.target.value))} /><output>{exag}×</output></label>
              </div>
            </RibbonGroup>
            <RibbonGroup label="Lobby">
              <RibbonButton icon="preview" label="Prévia do lobby" onClick={() => setLobbyOpen(true)} disabled={!relief3d} />
            </RibbonGroup>
          </>}
          {ribbon === "game" && <>
            <RibbonGroup label="Gerar">
              <RibbonButton icon="construction" label={busy ? "Gerando…" : "Gerar mapa"} onClick={() => void build(false)} disabled={!spec || edits.spawns.length < 2 || busy} color="#a3e635" />
              <RibbonButton icon="play_circle" label="Gerar e jogar" onClick={() => void build(true)} disabled={!spec || edits.spawns.length < 2 || busy} color="#a3e635" />
              <RibbonButton icon="save_alt" label="Exportar .scd" onClick={() => void exportScd()} disabled={!builtMod} hint="Salva o arquivo .scd do mapa gerado numa pasta (para compartilhar ou instalar à mão)" />
            </RibbonGroup>
            <RibbonGroup label="Configurar">
              <RibbonButton icon="tune" label="Propriedades do mapa" onClick={() => setSel(new Set(["map"]))} />
              <RibbonButton icon="insights" label="Análise" onClick={() => setSkin("analysis")} />
              <RibbonButton icon="fact_check" label="Validar" onClick={() => setIssues(runCheck())} disabled={!relief3d || !heights} hint="Bases, massa, decorações e equilíbrio" />
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
                  texture={texture3d} palette={skin === "relief" ? (doc.world?.biome ?? "temperate") : null} exaggeration={exag}
                  spawns={markers} mass={hidden.has("grp:mass") ? [] : edits.mass} bridges={edits.bridges} seed={edits.seed}
                  decor={decor} cuts={edits.cuts} highlights={highlights} lines={lines} snapshotRef={snapshot}
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
                  {activeFeatures.map((f) => LINE_FEATURES.includes(f.kind) && f.pts.length > 1
                    ? <polyline key={f.id} points={f.pts.map((q) => q.join(",")).join(" ")} fill="none" stroke={FEATURE_COLOR[f.kind]} strokeWidth={Math.max(3, f.r * 0.25)} strokeOpacity={0.55} strokeLinecap="round" />
                    : <circle key={f.id} cx={f.pts[0][0]} cy={f.pts[0][1]} r={f.r} fill="none" stroke={FEATURE_COLOR[f.kind]} strokeWidth={2} strokeDasharray="10 6" strokeOpacity={0.7} />)}
                  {edits.relief.map((r, i) => { const sh = reliefShape(r.op), c = RELIEF_COLOR[r.kind]; return sh.rect ? <rect key={i} x={sh.rect[0]} y={sh.rect[2]} width={sh.rect[1] - sh.rect[0]} height={sh.rect[3] - sh.rect[2]} fill={`${c}33`} stroke={c} strokeWidth={3} /> : <circle key={i} cx={sh.c[0]} cy={sh.c[1]} r={sh.r} fill={`${c}26`} stroke={c} strokeWidth={2.5} />; })}
                  {edits.cuts.map(([x, z, r], i) => <circle key={`c${i}`} cx={x} cy={z} r={r} fill="rgba(229,83,75,.12)" stroke="#e5534b" strokeWidth={2} strokeDasharray="8 5" />)}
                  {showDecor && !hidden.has("grp:prop") && edits.props.map((q, i) => <circle key={`p${i}`} cx={q.x} cy={q.z} r={4} fill="#4f9a46" stroke="#0d1b26" strokeWidth={1.5} />)}
                  {edits.bridges.map(([x0, x1, z0, z1], i) => <rect key={`b${i}`} x={x0} y={z0} width={x1 - x0} height={z1 - z0} fill="rgba(242,179,61,.25)" stroke="#f2b33d" strokeWidth={3} strokeDasharray="10 6" />)}
                  {drag && <rect x={Math.min(drag.a[0], drag.b[0])} y={Math.min(drag.a[1], drag.b[1])} width={Math.abs(drag.b[0] - drag.a[0])} height={Math.abs(drag.b[1] - drag.a[1])} fill="rgba(242,179,61,.2)" stroke="#f2b33d" strokeWidth={3} />}
                  {!hidden.has("grp:mass") && edits.mass.map((q, i) => <path key={`m${i}`} d={`M${q[0]} ${q[1] - 13}L${q[0] + 9} ${q[1]}L${q[0]} ${q[1] + 13}L${q[0] - 9} ${q[1]}Z`} fill="#7bd88f" stroke="#0d1b26" strokeWidth={3} />)}
                  {!hidden.has("grp:spawn") && edits.spawns.map((q, i) => <g key={`s${i}`}><circle cx={q[0]} cy={q[1]} r={26} fill={TEAM_COLORS[teamOf(i) % 8]} stroke="#0d1b26" strokeWidth={5} /><text x={q[0]} y={q[1] + 10} textAnchor="middle" fontSize={30} fontWeight={700} fill="#0d1b26">{i + 1}</text></g>)}
                  {highlights.map(([x, z, r], i) => <circle key={`h${i}`} cx={x} cy={z} r={r} fill="none" stroke="#ffd166" strokeWidth={3} />)}
                  {cursor && brush && <circle cx={cursor[0]} cy={cursor[1]} r={brush.shape === "circle" ? brush.radius : 10} fill="none" stroke={brush.color} strokeWidth={3} />}
                </svg>
              </div>
            )}
            <div className="viewport-overlay">
              <span className="vp-chip"><Icon name={tool === "select" ? "near_me" : "edit"} size={15} /> {hintOf(tool).split(".")[0]}.</span>
              {selIds.length > 0 && <span className="vp-chip"><Icon name="select_all" size={15} /> {selIds.length} selecionado{selIds.length > 1 ? "s" : ""}</span>}
              {doc.symmetry !== "none" && <span className="vp-chip"><Icon name="flip" size={15} /> {SYMMETRY_LABEL[doc.symmetry]}</span>}
              {skin === "relief" && <span className="vp-chip faint" title="No jogo o chão usa as texturas do terreno base (troque em Chão)"><Icon name="info" size={15} /> Cores da prévia</span>}
            </div>
            {skin === "analysis" && (
              <div className="analysis-panel">
                {!analysis ? <div className="bar indeterminate"><i /></div> : <>
                  <Notice kind={analysis.verdict === "ok" ? "ok" : analysis.verdict === "warn" ? "warn" : "err"}>{analysis.text}</Notice>
                  <table className="an-table">
                    <thead><tr><th>Base</th><th>Território</th><th>Até o inimigo</th><th>Massa</th></tr></thead>
                    <tbody>{analysis.bases.map((b) => (
                      <tr key={b.index}><td><span className="an-dot" style={{ background: TEAM_COLORS[b.team % 8] }} />{b.index + 1}</td><td>{b.territory}%</td><td>{b.enemy < 0 ? "sem caminho" : b.enemy}</td><td>{b.mass}</td></tr>
                    ))}</tbody>
                  </table>
                  <p className="faint small">{analysis.walkable}% caminhável · {analysis.chokes} pontos de gargalo. <span style={{ color: "#ffa03c" }}>■</span> caminhos <span style={{ color: "#ffd666" }}>■</span> fronteira <span style={{ color: "#ff2840" }}>■</span> gargalos. A massa automática do toolkit entra só no mapa gerado.</p>
                </>}
              </div>
            )}
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
                <span className="row" style={{ gap: 6 }}>
                  {lastBuild && builtMod && <button className="btn sm" onClick={() => void exportScd()}><Icon name="save_alt" size={16} /> Exportar .scd</button>}
                  <button className="btn text sm" onClick={() => { setLog([]); setLastBuild(null); }}>Fechar</button>
                </span>
              </div>
            )}
          </div>
        }
        right={<>
          <Panel title="Explorador" icon="account_tree" grow id="map-explorer">
            <div className="tree-filter"><input placeholder="Filtrar objetos…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filtrar objetos" /></div>
            <Tree nodes={nodes} selected={sel} filter={filter} onSelect={onTreeSelect}
              onToggleHidden={(nid) => toggleLayer("hidden", nid)} onToggleLocked={(nid) => toggleLayer("locked", nid)}
              onContext={(nid, x, y) => { if (!nid.startsWith("grp:") && nid !== "map" && nid !== "world") { setSel(new Set([nid])); setCtx({ x, y, id: nid }); } }} />
          </Panel>
          <Panel title="Propriedades" icon="tune" grow id="map-props">
            <PropertyGrid sections={props} />
          </Panel>
        </>}
      />
      <StatusBar>
        <span><Icon name="terrain" size={13} /> <b>{terrain?.name ?? doc.terrain ?? "sem terreno"}</b></span>
        <span>{edits.spawns.length} bases · {edits.mass.length} massa · {doc.features.length} formas · {edits.props.length} decorações novas{removedCount ? ` · ${removedCount} retiradas` : ""}</span>
        <span className="grow" />
        {cursor && <span>x {Math.round(cursor[0])} · z {Math.round(cursor[1])} · altura {round1(hAt(cursor))}</span>}
        {status && !status.ready && <span style={{ color: "var(--warn)" }}>{status.message}</span>}
        {edits.spawns.length < 2 && <span style={{ color: "var(--warn)" }}>coloque pelo menos 2 bases para gerar</span>}
      </StatusBar>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} items={[
        { icon: "content_copy", label: "Duplicar", shortcut: "Ctrl+D", onClick: doDuplicate },
        { icon: locked.has(ctx.id) ? "lock_open" : "lock", label: locked.has(ctx.id) ? "Destravar" : "Travar", onClick: () => toggleLayer("locked", ctx.id) },
        { icon: "delete", label: "Excluir", shortcut: "Del", danger: true, onClick: doDelete },
      ] as CtxItem[]} />}
      {genOpen && relief3d && (
        <Suspense fallback={null}>
          <WorldGenModal grid={relief3d} donor={relief3d.heights} water={water} hasWater={hasWater} terrains={terrains} terrain={doc.terrain}
            initial={doc.world} catalog={catalog} onTerrain={(t) => setDoc((d) => ({ ...d, terrain: t }))} onClose={() => setGenOpen(false)} onApply={applyWorld} />
        </Suspense>
      )}
      {issues && (
        <Modal title="Validação do mapa" icon="fact_check" onClose={() => setIssues(null)}>
          <div className="col" style={{ gap: 6 }}>
            {issues.map((x, i) => (
              <button key={i} className={`check-item ${x.level}`} disabled={!x.sel} onClick={() => { if (x.sel) { setSel(new Set([x.sel])); setIssues(null); } }}>{x.text}</button>
            ))}
            <p className="faint small">Clique num item para selecionar o objeto. A correção automática move a massa para o chão plano mais perto e tira decorações sobrepostas, em cima das bases ou da massa. Bases e relevo não são alterados.</p>
            <footer>
              <button className="btn text" onClick={() => setIssues(runCheck())}><Icon name="refresh" size={16} /> Conferir de novo</button>
              <button className="btn primary" disabled={!issues.some((x) => x.fixable)} onClick={autoFix}><Icon name="auto_fix_high" size={16} /> Corrigir automaticamente</button>
            </footer>
          </div>
        </Modal>
      )}
      {lobbyOpen && (
        <Modal title="Prévia do lobby" icon="preview" onClose={() => setLobbyOpen(false)}>
          <div className="lobby-prev">
            <div className="lobby-map">
              {lobbyImage ? <img src={lobbyImage} alt="Minimapa" /> : <div className="bar indeterminate"><i /></div>}
              <svg viewBox={`0 0 ${grid} ${grid}`}>
                {edits.spawns.map((q, i) => <g key={i}><circle cx={q[0]} cy={q[1]} r={34} fill={TEAM_COLORS[teamOf(i) % 8]} stroke="#000" strokeWidth={6} /><text x={q[0]} y={q[1] + 13} textAnchor="middle" fontSize={40} fontWeight={700} fill="#000">{i + 1}</text></g>)}
              </svg>
            </div>
            <div className="col" style={{ gap: 4 }}>
              <b>{lobbyName}</b>
              <span className="faint small">{edits.spawns.length} jogadores · {doc.teams === "ffa" ? "todos contra todos" : "dois times"} · minimapa: {doc.minimap === "donor" ? "original do terreno" : doc.minimap === "natural" ? "cores do relevo" : doc.minimap}</span>
              {doc.minimap === "donor" && usesWorld && <Notice kind="warn">O minimapa original mostra o relevo antigo do terreno. Para um mundo gerado use "Gerar: cores do relevo".</Notice>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// para os erros de geração aparecerem com o texto certo
export const mapBuildError = (e: unknown) => errorText(e);
