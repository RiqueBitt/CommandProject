// Editor de mapas em aba própria, no estilo de um estúdio de jogo: faixa de ferramentas, recursos
// à esquerda, visão 3D no centro, objetos e propriedades à direita. O documento é salvo como
// projeto (salvamento automático, versões); "Gerar mapa" usa o SC2 Map Toolkit e sai um .scd.
//
// Camadas do relevo, na ordem: terreno do jogo → gerador de mundo (relevo base) → formas
// (montanhas, lagos, rios…) → pincel de escultura → relevo simples (morro, vale, rampa…).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DecorPoint, GroundTextures as GroundTexSet, Marker } from "../../components/MapView3D";
import { registerCustomProp } from "../../components/propModels";
import {
  ContextMenu, Panel, ProjectBar, PropertyGrid, Ribbon, RibbonButton, RibbonGroup, StatusBar, StudioLayout, Tree,
  useActiveEditor, useHotkeys, type CtxItem, type Prop, type TreeNode,
} from "../../components/studio/kit";
import { Empty, Icon, Modal, Notice } from "../../components/ui";
import { api, confirmDialog, onProgress, pickFile } from "../../lib/api";
import { errorText, load, useStore } from "../../lib/store";
import { useTabs } from "../../lib/tabs";
import type { CreationMeta, MapAssets, MapBuildResult, MaptkStatus, SkyInfo, Terrain, TerrainPreview } from "../../lib/types";
import { useProject } from "../../lib/useProject";
import { t, tr } from "../../lib/i18n";
import { GroundPaint, GroundTextures, PropPicker } from "../studio/MapDecor";
import { biomeChain, chainTile, combinePaint, deckLayer, decodePaint, encodePaint, groundBaseT, paintDab, paintT, resamplePaint, trailPaint, type PaintLayer } from "../studio/biome";
import { customLayers, customStem, importTexture, isCustomPath, registerCustomTextures, texUrl } from "../studio/customTex";
import {
  applyRelief, BLANK_SIZES, BLANK_Y, blankLabel, blankTerrain, blankWater, cutTester, docMapSize, mapKm, nativeBlank, decodeHeights, decorKind, groundCandidates, groundSpec, heightAt, meanInDisc,
  RELIEF_LABEL, reliefShape, reskinPaths, round1, type BlankSize, type Edits, type GroundBiome, type GroundLayer, type PlacedProp, type Pt, type Relief, type Relief3D, type ReliefKind,
} from "../studio/mapEdit";
import { MAX_SPAWNS, migrateMap, newMapDoc, TEAM_OPTIONS, teamLists, teamOfSpawn, worldTeams, type MapDoc } from "./docs";
import { analyzeMap, type Analysis } from "./mapAnalysis";
import { autoFixMap, checkMap, type MapIssue } from "./mapCheck";
import {
  baseHeights, BIOME_LABEL, brushDab, massPads, NAV_N, navAt, resampleGrid, setWalkNav, composeWorld, decodeLayer, encodeDelta, encodeLayer, FEATURE_COLOR, FEATURE_ICON, FEATURE_LABEL, fullCuts, invert,
  LINE_FEATURES, mapYaw, propCatalog, WORLD_PRESETS, reliefImage, simplex, SYMMETRY_LABEL, symmetryOps,
  type BrushMode, type Feature, type FeatureKind, type Symmetry, type WorldGen, type WorldResult,
} from "./worldgen";

const MapView3D = lazy(() => import("../../components/MapView3D"));
const WorldGenModal = lazy(() => import("./WorldGenModal"));

type BrushTool = `b-${BrushMode}`;
type FeatTool = `f-${FeatureKind}`;
type NavTool = "nav-block" | "nav-allow" | "nav-erase";
type Tool = "select" | "orbit" | "spawn" | "mass" | ReliefKind | "bridge" | "decor" | "uncut" | "seed" | "erase" | "paint" | NavTool | BrushTool | FeatTool;
const isNav = (t: Tool): t is NavTool => t.startsWith("nav-");
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
const POINT_FEATS: FeatureKind[] = ["mountain", "hill", "plateau", "crater", "lake", "dunes", "island", "pad", "platform", "chasm"];
const isRelief = (t: Tool): t is ReliefKind => t in RELIEF_LABEL;
const isBrush = (t: Tool): t is BrushTool => t.startsWith("b-");
const isFeat = (t: Tool): t is FeatTool => t.startsWith("f-");
const featOf = (t: FeatTool) => t.slice(2) as FeatureKind;
const MAX_MASS = 200, MAX_PROPS = 5000, MAX_CUTS = 400;
/** resolução do relevo no editor (pontos por lado): 512 = um ponto a cada 2 unidades num mapa 1024 */
const RELIEF_RES = 512;
type DonorProp = [number, number, number, number, number, number];

const HINT: Record<string, string> = {
  paint: "Pinte o chão com a textura escolhida na aba Chão (praia, grama, terra, rocha, topo). A borracha volta ao automático.",
  "nav-block": "Pinte onde as tropas por terra NÃO passam (vermelho): encostas, montanhas, bordas. Aéreas e navais não mudam.",
  "nav-allow": "Pinte onde as tropas PASSAM mesmo sendo íngreme (verde): rampas, atalhos.",
  "nav-erase": "Volta a passagem ao automático (pela inclinação e pela água).",
  select: "Clique para selecionar (Shift soma; arraste no vazio para selecionar por caixa). Arraste para mover, girar ou mudar o tamanho (W, Q, T). Clique numa decoração do mapa original para editá-la. Del apaga, Ctrl+D duplica.",
  orbit: "Arraste para girar a câmera. Botão do meio move, roda dá zoom.",
  spawn: "Clique para colocar a base inicial de cada jogador (quantas quiser; mais de 8 joga pela Partida grande).",
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
const hintOf = (tl: Tool) => isBrush(tl) ? t(BRUSH[tl.slice(2) as BrushMode].hint)
  : isFeat(tl) ? (LINE_FEATURES.includes(featOf(tl)) ? t("Arraste para desenhar: {name}.", { name: t(FEATURE_LABEL[featOf(tl)]).toLowerCase() }) : t("Clique para colocar: {name}. Raio e altura nos controles do pincel.", { name: t(FEATURE_LABEL[featOf(tl)]).toLowerCase() }))
  : HINT[tl] ? t(HINT[tl]) : "";

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

/** muda a escala de tudo o que foi colocado (troca de tamanho do mapa em branco) */
function scaleDoc(d: MapDoc, k: number): MapDoc {
  if (k === 1) return d;
  const c = (v: number) => Math.round(v * k * 10) / 10;
  const pt = (q: Pt): Pt => [c(q[0]), c(q[1])];
  const e = d.edits;
  const relief = e.relief.map((r) => {
    const op = [...r.op] as typeof r.op;
    if (op[0] === "disc" || op[0] === "cone") { op[1] = c(op[1]); op[2] = c(op[2]); op[3] = Math.max(4, c(op[3])); }
    else { op[1] = c(op[1]); op[2] = c(op[2]); op[3] = c(op[3]); op[4] = c(op[4]); }
    return { ...r, op };
  });
  return {
    ...d,
    features: d.features.map((f) => ({ ...f, r: Math.max(4, c(f.r)), pts: f.pts.map(pt) })),
    edits: {
      ...e, spawns: e.spawns.map(pt), mass: e.mass.map(pt), seed: e.seed ? pt(e.seed) : null, relief,
      props: e.props.map((q) => ({ ...q, x: c(q.x), z: c(q.z) })),
      cuts: e.cuts.map(([x, z, r]) => [c(x), c(z), Math.max(2, c(r))] as [number, number, number]),
      bridges: e.bridges.map(([x0, x1, z0, z1]) => [c(x0), c(x1), c(z0), c(z1)] as [number, number, number, number]),
    },
  };
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
  const [skin, setSkin] = useState<"game" | "nav" | "relief" | "analysis">(() => (p.doc.world || p.doc.base === "blank" ? "relief" : "game"));
  const [exag, setExag] = useState(1.5);
  // mundo gerado: relevo em escala real (o exagero deixava as montanhas parecendo agulhas)
  const exagSet = useRef(false);
  useEffect(() => {
    if (p.status !== "ready" || exagSet.current) return;
    exagSet.current = true;
    if (p.doc.world || p.doc.base === "blank") { setExag(1); setSkin("relief"); }
  }, [p.status, p.doc.world, p.doc.base]);
  const [tool, setTool] = useState<Tool>("select");
  /** papel pintado pelo pincel de textura (0 praia … 4 topo; -1 borracha) */
  const [paintRole, setPaintRole] = useState(1);
  const paintRoleRef = useRef(1);
  paintRoleRef.current = paintRole;
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

  const blank = doc.base === "blank";
  useEffect(() => { if ((doc.clean || blank) && (skin === "game" || (blank && skin === "nav"))) setSkin("relief"); }, [doc.clean, blank, skin]);
  const blankSize = blank ? docMapSize(doc) : null;
  useEffect(() => {
    const t = doc.terrain;
    const key = `${t}|${blank ? `blank${blankSize}` : "game"}`;
    if (p.status !== "ready" || !t || loadedTerrain.current === key) return;
    loadedTerrain.current = key;
    setPreview(null);
    setRelief3d(null);
    setDonor(null);
    void Promise.all([blank ? Promise.resolve(null) : load(() => api.maptkPreview(t, 512)), load(() => api.maptkTerrain3d(t, RELIEF_RES))]).then(([pv, r]) => {
      if (loadedTerrain.current !== key) return;
      setPreview(pv ?? null);
      if (r) {
        // mapa em branco: o terreno do jogo é só o suporte — o chão começa liso, sem água nem decorações
        const h = decodeHeights(r.heights, r.heightScale);
        if (blank) h.fill(BLANK_Y);
        const bw = blank ? blankWater(blankSize ?? 1024) : 0;
        // mapa gigante: o terreno base é redimensionado ao gerar; no editor o chão já tem o tamanho novo
        setRelief3d({ size: r.size, grid: blank ? blankSize ?? r.grid : r.grid, heights: h, waterLevel: blank ? bw : r.waterLevel, yMin: blank ? BLANK_Y : r.yMin, yMax: blank ? BLANK_Y : r.yMax, texture: blank ? null : r.texture });
        setDonor({ props: blank ? [] : r.props ?? [], kinds: blank ? [] : r.propKinds ?? [] });
      } else setView("2d");
    });
  }, [doc.terrain, p.status, blank, blankSize]);

  const terrain = terrains?.find((t) => t.id === doc.terrain) ?? null;
  const baseName = doc.base === "blank" ? t("Em branco {size} ({km} km)", { size: blankSize, km: mapKm(blankSize ?? 1024) }) : terrain?.name ?? doc.terrain ?? t("sem terreno");
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
  // escultura salva noutra resolução (versões antigas usavam 256): reamostra para a atual
  const sculptLayer = useMemo(() => {
    if (!relief3d || !doc.sculpt || !doc.sculptSize) return null;
    const n = doc.sculptSize;
    return resampleGrid(decodeLayer(doc.sculpt, (n + 1) ** 2), n, relief3d.size);
  }, [relief3d, doc.sculpt, doc.sculptSize]);
  const layer = liveSculpt ?? sculptLayer;
  const composed = useMemo(() => {
    if (!featured || !relief3d) return null;
    const sculpted = !!layer && !hidden.has("grp:sculpt");
    if (!sculpted && !edits.mass.length) return featured;
    const out = featured.slice();
    if (sculpted) for (let k = 0; k < out.length; k++) out[k] = Math.max(0, Math.min(511, out[k] + layer![k]));
    // chão plano embaixo da massa (no editor e no jogo: vai junto na camada de relevo)
    return massPads(relief3d, out, edits.mass, water, hasWater);
  }, [featured, layer, hidden, edits.mass, relief3d, water, hasWater]);
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
  const moving = useRef<{ from: Pt; ids: Sel[]; started: boolean; center?: Pt; a0?: number; d0?: number } | null>(null);
  /** modo de transformar a seleção ao arrastar */
  const [xform, setXform] = useState<"move" | "rotate" | "scale">("move");
  const xformRef = useRef(xform);
  xformRef.current = xform;
  /** seleção por caixa (arrastar no vazio) */
  const boxing = useRef(false);
  const shiftDown = useRef(false);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { shiftDown.current = e.shiftKey; };
    window.addEventListener("keydown", h); window.addEventListener("keyup", h);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener("keyup", h); };
  }, []);
  /** decorações do mapa original que ainda estão no mapa (para adotar com um clique) */
  const keptRef = useRef<DecorPoint[]>([]);
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

  /** posição de um item selecionado (para o centro do giro/escala) */
  const posOf = (d: MapDoc, sId: Sel): Pt | null => {
    const [k, iS] = sId.split(":");
    const i = Number(iS), e = d.edits;
    if (k === "spawn") return e.spawns[i] ?? null;
    if (k === "mass") return e.mass[i] ?? null;
    if (k === "prop") return e.props[i] ? [e.props[i].x, e.props[i].z] : null;
    if (k === "cut") return e.cuts[i] ? [e.cuts[i][0], e.cuts[i][1]] : null;
    if (k === "feat") {
      const f = d.features.find((x) => x.id === sId.slice(5));
      if (!f) return null;
      const n = f.pts.length;
      return [f.pts.reduce((a, q) => a + q[0], 0) / n, f.pts.reduce((a, q) => a + q[1], 0) / n];
    }
    return null;
  };
  const centerOf = (d: MapDoc, ids: Sel[]): Pt => {
    const pts = ids.map((x) => posOf(d, x)).filter((q): q is Pt => !!q);
    if (!pts.length) return [grid / 2, grid / 2];
    return [pts.reduce((a, q) => a + q[0], 0) / pts.length, pts.reduce((a, q) => a + q[1], 0) / pts.length];
  };
  /** gira a seleção `deg` graus em volta de `c` (decorações também giram no lugar) */
  const rotateAll = (d: MapDoc, ids: Sel[], c: Pt, deg: number): MapDoc => {
    const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const clamp = (v: number) => Math.max(0, Math.min(grid, Math.round(v * 10) / 10));
    const rot = (q: Pt): Pt => [clamp(c[0] + (q[0] - c[0]) * ca - (q[1] - c[1]) * sa), clamp(c[1] + (q[0] - c[0]) * sa + (q[1] - c[1]) * ca)];
    const e = d.edits, n = { ...e, spawns: [...e.spawns], mass: [...e.mass], props: [...e.props], cuts: [...e.cuts] };
    const fids = new Set<string>();
    for (const sId of ids) {
      const [k, iS] = sId.split(":");
      const i = Number(iS);
      if (k === "spawn" && n.spawns[i]) n.spawns[i] = rot(n.spawns[i]);
      else if (k === "mass" && n.mass[i]) n.mass[i] = rot(n.mass[i]);
      else if (k === "prop" && n.props[i]) { const q = n.props[i]; const [x, z] = rot([q.x, q.z]); n.props[i] = { ...q, x, z, yaw: Math.round((((q.yaw + deg) % 360) + 360) % 360), gen: false }; }
      else if (k === "cut" && n.cuts[i]) { const [x, z, r] = n.cuts[i]; const [nx, nz] = rot([x, z]); n.cuts[i] = [nx, nz, r]; }
      else if (k === "feat") fids.add(sId.slice(5));
    }
    const features = fids.size ? d.features.map((f) => {
      if (!fids.has(f.id)) return f;
      const m = f.m ?? [1, 0, 0, 1];
      // a forma gira junto: matriz do mundo para a forma ganha o giro inverso
      const m2: [number, number, number, number] = [m[0] * ca - m[1] * sa, m[0] * sa + m[1] * ca, m[2] * ca - m[3] * sa, m[2] * sa + m[3] * ca];
      return { ...f, pts: f.pts.map((q) => rot(q).map((v) => Math.round(v)) as Pt), m: m2, gen: false };
    }) : d.features;
    return { ...d, edits: n, features };
  };
  /** muda o tamanho da seleção (decorações: escala; formas: raio); grupos também se espalham */
  const scaleAll = (d: MapDoc, ids: Sel[], c: Pt, k: number): MapDoc => {
    const clamp = (v: number) => Math.max(0, Math.min(grid, Math.round(v * 10) / 10));
    const spread = ids.length > 1;
    const sp = (q: Pt): Pt => (spread ? [clamp(c[0] + (q[0] - c[0]) * k), clamp(c[1] + (q[1] - c[1]) * k)] : q);
    const e = d.edits, n = { ...e, spawns: [...e.spawns], mass: [...e.mass], props: [...e.props], cuts: [...e.cuts] };
    const fids = new Set<string>();
    for (const sId of ids) {
      const [kk, iS] = sId.split(":");
      const i = Number(iS);
      if (kk === "spawn" && n.spawns[i]) n.spawns[i] = sp(n.spawns[i]);
      else if (kk === "mass" && n.mass[i]) n.mass[i] = sp(n.mass[i]);
      else if (kk === "prop" && n.props[i]) { const q = n.props[i]; const [x, z] = sp([q.x, q.z]); n.props[i] = { ...q, x, z, scale: Math.round(Math.max(0.2, Math.min(5, q.scale * k)) * 100) / 100, gen: false }; }
      else if (kk === "cut" && n.cuts[i]) { const [x, z, r] = n.cuts[i]; const [nx, nz] = sp([x, z]); n.cuts[i] = [nx, nz, Math.max(2, Math.min(300, Math.round(r * k)))]; }
      else if (kk === "feat") fids.add(sId.slice(5));
    }
    const features = fids.size ? d.features.map((f) => (fids.has(f.id)
      ? { ...f, pts: f.pts.map((q) => sp(q).map((v) => Math.round(v)) as Pt), r: Math.max(4, Math.min(600, Math.round(f.r * k))), gen: false } : f)) : d.features;
    return { ...d, edits: n, features };
  };
  /** itens dentro do retângulo (seleção por caixa) */
  const inRect = (d: MapDoc, a: Pt, b: Pt): Sel[] => {
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
    const inside = (q: Pt) => q[0] >= x0 && q[0] <= x1 && q[1] >= z0 && q[1] <= z1;
    const hid = new Set(d.layers.hidden), lk = new Set(d.layers.locked);
    const ok = (sId: Sel) => !lk.has(sId) && !lk.has(groupOf(sId)) && !hid.has(groupOf(sId)) && !hid.has(sId);
    const out: Sel[] = [];
    d.edits.spawns.forEach((q, i) => inside(q) && ok(`spawn:${i}`) && out.push(`spawn:${i}`));
    d.edits.mass.forEach((q, i) => inside(q) && ok(`mass:${i}`) && out.push(`mass:${i}`));
    d.edits.props.forEach((q, i) => inside([q.x, q.z]) && ok(`prop:${i}`) && out.push(`prop:${i}`));
    d.edits.cuts.forEach((q, i) => inside([q[0], q[1]]) && ok(`cut:${i}`) && out.push(`cut:${i}`));
    for (const f of d.features) { const c = posOf(d, `feat:${f.id}`); if (c && inside(c) && ok(`feat:${f.id}`)) out.push(`feat:${f.id}`); }
    return out;
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
      if (k === "spawn" && n.spawns.length < MAX_SPAWNS) { n.spawns.push([e.spawns[i][0] + off, e.spawns[i][1] + off]); out.push(`spawn:${n.spawns.length - 1}`); }
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
    const h = kind === "lake" || kind === "river" ? Math.max(3, Math.round(s / 3)) : kind === "pass" || kind === "pad" || kind === "span" || kind === "trail" ? 0 : kind === "dunes" ? Math.max(2, Math.round(s / 3))
      : kind === "platform" || kind === "chasm" ? Math.max(40, s * 2) : kind === "rift" ? Math.max(30, Math.round(s * 1.5)) : s;
    const r = kind === "river" ? Math.max(10, Math.round(rad / 3)) : kind === "pass" ? Math.max(20, Math.round(rad / 2)) : kind === "span" ? Math.max(10, Math.round(rad / 4)) : kind === "trail" ? Math.max(4, Math.round(rad / 6))
      : kind === "ridge" || kind === "canyon" || kind === "rift" ? Math.max(18, Math.round(rad / 2)) : rad;
    const out: Feature[] = [];
    for (const o of symOps) {
      const tp = pts.map((q) => o.pt(q).map((v) => Math.round(v)) as Pt);
      if (out.some((f) => f.pts.every((q, k) => Math.hypot(q[0] - tp[k][0], q[1] - tp[k][1]) < 4))) continue;
      out.push({ id: newFeatId(), kind, pts: tp, r, h, rough: kind === "pad" || kind === "pass" || kind === "span" ? 0.1 : 0.6, seed, m: invert(o.m) });
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
    const { tool: tl, radius: rad, drag: d, doc: dc } = ctxRef.current;
    if (tl === "orbit") return;
    if (q) setCursor(q);
    if (tl === "select") {
      if (type === "down" && q) {
        const s = ctxRef.current.sel;
        let hit = pick(q, dc);
        if (!hit) {
          // decoração do mapa original: vira uma decoração editável (sai a original, entra a cópia)
          const kd = keptRef.current.reduce<[number, DecorPoint | null]>((best, k) => { const dd = Math.hypot(k.x - q[0], k.z - q[1]); return dd < best[0] ? [dd, k] : best; }, [10, null])[1];
          if (kd?.bp && !dc.clean) {
            const idx = dc.edits.props.length;
            if (idx < MAX_PROPS) {
              p.commit((d0) => ({ ...d0, edits: { ...d0.edits, cuts: [...d0.edits.cuts, [round1(kd.x), round1(kd.z), 1.2] as [number, number, number]],
                props: [...d0.edits.props, { bp: kd.bp!, x: round1(kd.x), z: round1(kd.z), yaw: Math.round(kd.yaw), scale: Math.round(kd.scale * 100) / 100 }] } }));
              hit = `prop:${idx}`;
              setSel(new Set([hit]));
              toast("info", t("Decoração do mapa original agora é editável (mover, girar, escala). Ctrl+Z desfaz."));
              moving.current = { from: q, ids: [hit], started: true };
              return;
            }
          }
          // vazio: seleção por caixa
          if (!shiftDown.current) setSel(new Set(["map"]));
          moving.current = null;
          boxing.current = true;
          setDrag({ a: q, b: q });
          return;
        }
        const lk = new Set(dc.layers.locked);
        let ids = s.has(hit) ? [...s].filter((x) => x !== "map" && !lk.has(x) && !lk.has(groupOf(x))) : [hit];
        if (shiftDown.current && !s.has(hit)) { ids = [...[...s].filter((x) => x !== "map"), hit]; setSel(new Set(ids)); }
        else if (!s.has(hit)) setSel(new Set([hit]));
        const center = centerOf(dc, ids);
        moving.current = { from: q, ids, started: false, center, a0: Math.atan2(q[1] - center[1], q[0] - center[0]), d0: Math.max(4, Math.hypot(q[0] - center[0], q[1] - center[1])) };
      } else if (type === "move" && q && boxing.current && d) {
        setDrag({ ...d, b: q });
      } else if (type === "move" && q && moving.current) {
        const m = moving.current;
        const mode = xformRef.current;
        if (mode === "move") {
          const dx = q[0] - m.from[0], dz = q[1] - m.from[1];
          if (Math.hypot(dx, dz) < 1) return;
          // o primeiro passo do arrasto entra no histórico; o resto continua o mesmo passo
          moving.current = { ...m, from: q, started: true };
          (m.started ? p.amend : p.commit)((doc0) => moveAll(doc0, m.ids, dx, dz));
        } else if (mode === "rotate" && m.center && m.a0 !== undefined) {
          const a = Math.atan2(q[1] - m.center[1], q[0] - m.center[0]);
          let deg = ((a - m.a0) * 180) / Math.PI;
          if (Math.abs(deg) < 2) return;
          if (shiftDown.current) deg = Math.round(deg / 15) * 15;
          if (!deg) return;
          moving.current = { ...m, a0: m.a0 + (deg * Math.PI) / 180, started: true };
          (m.started ? p.amend : p.commit)((doc0) => rotateAll(doc0, m.ids, m.center!, deg));
        } else if (mode === "scale" && m.center && m.d0) {
          const dd = Math.max(2, Math.hypot(q[0] - m.center[0], q[1] - m.center[1]));
          const k = dd / m.d0;
          if (Math.abs(k - 1) < 0.03) return;
          moving.current = { ...m, d0: dd, started: true };
          (m.started ? p.amend : p.commit)((doc0) => scaleAll(doc0, m.ids, m.center!, k));
        }
      } else if (type === "up") {
        if (boxing.current && d) {
          const found = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) > 4 ? inRect(dc, d.a, d.b) : [];
          const prev = shiftDown.current ? [...ctxRef.current.sel].filter((x) => x !== "map") : [];
          const all = [...new Set([...prev, ...found])];
          setSel(new Set(all.length ? all : ["map"]));
          setDrag(null);
        }
        boxing.current = false;
        moving.current = null;
      }
      return;
    }
    // pincel de passagem das tropas
    if (isNav(tl)) {
      const r = ctxRef.current.relief3d;
      if (!r) return;
      if (type === "up" || !q) {
        if (liveNav.current) {
          const enc = encodePaint(liveNav.current);
          liveNav.current = null;
          p.commit((d0) => ({ ...d0, nav: enc }));
        }
        stroke.current = null;
        return;
      }
      if (type === "down") { liveNav.current = decodePaint(ctxRef.current.doc.nav, NAV_N); stroke.current = null; }
      const ln = liveNav.current;
      if (!ln) return;
      if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) < rad * 0.25) return;
      stroke.current = q;
      let ch = false;
      const role = tl === "nav-block" ? 1 : tl === "nav-allow" ? 2 : -1;
      for (const mq of mirrors(q)) ch = paintDab(ln, r.grid, mq.p[0], mq.p[1], rad, role, 1) || ch;
      if (ch) setNavRev((v) => v + 1);
      return;
    }
    // pincel de textura
    if (tl === "paint") {
      const r = ctxRef.current.relief3d;
      if (!r) return;
      if (type === "up" || !q) {
        if (livePaint.current) {
          const enc = encodePaint(livePaint.current);
          const size = livePaint.current.n;
          livePaint.current = null;
          p.commit((d0) => ({ ...d0, paint: enc, paintSize: size }));
        }
        stroke.current = null;
        return;
      }
      if (type === "down") {
        const base = decodePaint(ctxRef.current.doc.paint, ctxRef.current.doc.paintSize || 256);
        livePaint.current = base;
        stroke.current = null;
      }
      const lp = livePaint.current;
      if (!lp) return;
      if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) < rad * 0.2) return;
      stroke.current = q;
      let ch = false;
      for (const mq of mirrors(q)) ch = paintDab(lp, r.grid, mq.p[0], mq.p[1], rad, paintRoleRef.current, Math.max(0.15, ctxRef.current.strength / 60)) || ch;
      if (ch) setPaintRev((v) => v + 1);
      return;
    }
    // pincel de escultura
    if (isBrush(tl)) {
      const mode = tl.slice(2) as BrushMode;
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
    if (tl === "ramp" || tl === "bridge" || (isFeat(tl) && LINE_FEATURES.includes(featOf(tl)))) {
      if (type === "down" && q) setDrag({ a: q, b: q });
      else if (type === "move" && q && d) setDrag({ ...d, b: q });
      else if (type === "up" && d) {
        const b = q ?? d.b;
        setDrag(null);
        if (isFeat(tl)) {
          if (Math.hypot(b[0] - d.a[0], b[1] - d.a[1]) < 24) return;
          const fs = newFeatures(featOf(tl), linePts(featOf(tl), d.a, b));
          p.commit((doc0) => ({ ...doc0, features: [...doc0.features, ...fs] }));
          setSel(new Set(fs.map((f) => `feat:${f.id}`)));
          return;
        }
        if (tl === "bridge") {
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
    if (isFeat(tl) && type === "down") {
      const fs = newFeatures(featOf(tl), [q]);
      p.commit((doc0) => ({ ...doc0, features: [...doc0.features, ...fs] }));
      setSel(new Set(fs.map((f) => `feat:${f.id}`)));
      return;
    }
    const pts = mirrors(q).map((m) => m.p);
    if (tl === "spawn" && type === "down") setEdits((ed) => (ed.spawns.length >= MAX_SPAWNS ? ed : { ...ed, spawns: [...ed.spawns, ...pts].slice(0, MAX_SPAWNS) }));
    else if (tl === "mass" && type === "down") setEdits((ed) => (ed.mass.length >= MAX_MASS ? ed : { ...ed, mass: [...ed.mass, ...pts].slice(0, MAX_MASS) }));
    else if (tl === "seed" && type === "down") setEdits((ed) => ({ ...ed, seed: q }));
    else if (tl === "erase" && type === "down") { const hit = pick(q, dc); if (hit) p.commit((doc0) => removeAll(doc0, [hit])); }
    else if (tl === "decor" || tl === "uncut") {
      const apply = (ed: Edits): Edits => {
        if (tl === "decor") {
          const list = scatter(q);
          return list.length && ed.props.length < MAX_PROPS ? { ...ed, props: [...ed.props, ...list.slice(0, MAX_PROPS - ed.props.length)] } : ed;
        }
        const r = ctxRef.current.radius;
        const near = (x: PlacedProp) => pts.some((c) => Math.hypot(x.x - c[0], x.z - c[1]) <= r);
        const cuts = ed.cuts.length + pts.length <= MAX_CUTS ? [...ed.cuts, ...pts.map((c) => [c[0], c[1], r] as [number, number, number])] : ed.cuts;
        return { ...ed, props: ed.props.filter((x) => !near(x)), cuts };
      };
      const gap = tl === "decor" ? (ctxRef.current.density === 1 ? 8 : rad * 0.8) : rad * 0.6;
      if (type === "down") { stroke.current = q; setEdits(apply); }
      else if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) > gap) { stroke.current = q; setEdits(apply, true); }
    } else if (isRelief(tl)) {
      const add = (ed: Edits) => {
        const ops = pts.map((c) => reliefOp(tl, c)).filter((x): x is Relief => !!x);
        return ed.relief.length + ops.length > 400 ? ed : { ...ed, relief: [...ed.relief, ...ops] };
      };
      if (type === "down") { stroke.current = q; setEdits(add); }
      else if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) > rad * 0.45) { stroke.current = q; setEdits(add, true); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, setEdits, grid, mirrors, symOps]);

  // ------------------------------------------------------------ derivados
  const groundLayers: GroundLayer[] = useMemo(() => (doc.terrain && assets ? assets.layers.filter((l) => l.map.toLowerCase() === doc.terrain!.toLowerCase()) : []), [doc.terrain, assets]);
  // texturas reais do chão (as do terreno base, ou as trocadas em Chão) para as cores do relevo:
  // cada camada ganha um papel (chão, encosta, praia, topo) pelo nome e pela cor da própria textura
  const [groundTex, setGroundTex] = useState<GroundTexSet | null>(null);
  // visual limpo: uma textura só no chão inteiro (a primeira do bioma que cabe no terreno base)
  const minSlot = useMemo(() => (groundLayers.length ? Math.min(...groundLayers.map((l) => l.slotD)) : 0), [groundLayers]);
  const cleanCands = useMemo(() => (doc.clean && assets ? groundCandidates(assets.layers, doc.groundBiome, doc.groundTex).filter((l) => !minSlot || l.d.length < minSlot) : []),
    [doc.clean, assets, doc.groundBiome, doc.groundTex, minSlot]);
  // chão por biomas (visual limpo): 5 texturas em cadeia, como no jogo
  // texturas importadas pelo usuário entram como camadas a mais
  useEffect(() => { registerCustomTextures(id, doc.customTex); }, [id, doc.customTex]);
  const skies = useMemo(() => assets?.skies ?? [], [assets]);
  const skyLabel = useCallback((x: SkyInfo) => terrains?.find((t) => t.id.toLowerCase() === x.map.toLowerCase())?.name ?? x.map.replace(/^SC2_/, ""), [terrains]);
  const skyNow = useMemo(() => (doc.sky ? skies.find((x) => x.map.toLowerCase() === doc.sky!.toLowerCase()) ?? null : null), [doc.sky, skies]);
  const allLayers = useMemo(() => (assets ? [...customLayers(doc.customTex), ...assets.layers] : null), [assets, doc.customTex]);
  const chain = useMemo(() => (doc.clean && allLayers ? biomeChain(allLayers, doc.groundBiome, doc.groundRoles) : []), [doc.clean, allLayers, doc.groundBiome, doc.groundRoles]);
  const [chainTex, setChainTex] = useState<string[] | null>(null);
  // repetição das texturas igual à do jogo (pelo tamanho com que cada textura foi feita)
  const uvTile = useMemo(() => chainTile(chain), [chain]);
  const chainKey = chain.map((l) => l?.d ?? "").join("|");
  const groundKey = doc.clean ? `chain:${chainKey}` : groundLayers.map((l) => edits.reskin[l.d]?.d ?? l.d).join("|") + `#${doc.world?.biome ?? ""}`;
  useEffect(() => {
    if (doc.clean) {
      const ds = chain.map((l) => l?.d);
      if (!ds.some(Boolean)) { setChainTex(null); setGroundTex(null); return; }
      let alive = true;
      void Promise.all(ds.map((d) => (d ? texUrl(d, 1024) : Promise.resolve(null)).catch(() => null).then((u) => u ?? null))).then((urls) => {
        if (!alive) return;
        // papel sem textura: usa o vizinho mais perto na cadeia
        const fill = urls.map((u, k) => u ?? urls.slice(k).find(Boolean) ?? urls.slice(0, k).reverse().find(Boolean) ?? null);
        setChainTex(fill.every(Boolean) ? (fill as string[]) : null);
      });
      setGroundTex(null);
      return () => { alive = false; };
    }
    setChainTex(null);
    if (!groundLayers.length) { setGroundTex(null); return; }
    let alive = true;
    void (async () => {
      const path = (l: GroundLayer) => edits.reskin[l.d]?.d ?? l.d;
      const skip = /debris|decal|floor|road|metal|plate|tile|concrete|path|seabed|crater|city|building|wall/;
      const cands = groundLayers.filter((l) => !skip.test(l.name.toLowerCase()));
      const list = cands.length ? cands : groundLayers;
      const stats = await Promise.all(list.map(async (l) => {
        try { return { l, ...(await textureStats(await api.gameTexture(path(l), 64))) }; } catch { return null; }
      }));
      const ok = stats.filter((x): x is NonNullable<typeof x> => !!x);
      if (!ok.length || !alive) { if (alive) setGroundTex(null); return; }
      const named = (re: RegExp) => ok.find((x) => re.test(x.l.name.toLowerCase()));
      const best = (score: (x: (typeof ok)[number]) => number, not: GroundLayer[] = []) => [...ok].filter((x) => !not.includes(x.l)).sort((a, b) => score(b) - score(a))[0] ?? ok[0];
      const grass = named(/grass|moss|lawn|field|jungle|leaf/) ?? best((x) => x.green - x.contrast * 0.5);
      const rock = named(/cliff|rock|stone|crag|mountain/) ?? best((x) => x.contrast * 2 - x.green - Math.abs(x.sat) * 0.5, [grass.l]);
      const sand = named(/sand|beach|shore|dune/) ?? best((x) => x.light + x.yellow - x.contrast, [grass.l, rock.l]);
      const snow = named(/snow|ice|frost/) ?? (doc.world?.biome === "snow" ? best((x) => x.light * 2 - x.sat) : rock);
      const urls = await Promise.all([sand, grass, rock, snow].map((x) => api.gameTexture(path(x.l), 512)));
      if (alive) setGroundTex({ sand: urls[0], grass: urls[1], rock: urls[2], snow: urls[3] });
    })().catch(() => { if (alive) setGroundTex(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groundKey]);
  // pincel de textura: camada salva + cópia viva enquanto pinta
  const paintSaved = useMemo(() => decodePaint(doc.paint, doc.paintSize || 256), [doc.paint, doc.paintSize]);
  const livePaint = useRef<PaintLayer | null>(null);
  const [paintRev, setPaintRev] = useState(0);
  const paintNow = livePaint.current ?? paintSaved;
  // passagem das tropas: a do gerador por baixo, a pintada à mão por cima
  const [showPass, setShowPass] = useState(false);
  const liveNav = useRef<PaintLayer | null>(null);
  const [navRev, setNavRev] = useState(0);
  const navUser = useMemo(() => decodePaint(doc.nav, NAV_N), [doc.nav]);
  const navWorld = useMemo(() => (doc.worldNav ? decodePaint(doc.worldNav, NAV_N) : null), [doc.worldNav]);
  const navNow = useMemo(() => {
    const c = combinePaint(navWorld, liveNav.current ?? navUser);
    return c.power.some((v) => v) ? c : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navWorld, navUser, navRev]);
  // validação, análise e prévia do gerador passam a respeitar o que foi pintado
  setWalkNav(navNow);
  const passCodes = useMemo(() => {
    if (!(showPass || isNav(tool)) || !relief3d || !heights) return null;
    const s = relief3d.size, w = s + 1, st = relief3d.grid / s, out = new Uint8Array(w * w);
    for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
      const k = j * w + i, y = heights[k];
      const role = navAt(navNow, relief3d.grid, i * st, j * st);
      if (role === 1) { out[k] = 2; continue; }
      if (role === 2) { out[k] = 3; continue; }
      const sl = Math.max(Math.abs(heights[j * w + Math.min(s, i + 1)] - y), Math.abs(heights[j * w + Math.max(0, i - 1)] - y), Math.abs(heights[Math.min(s, j + 1) * w + i] - y), Math.abs(heights[Math.max(0, j - 1) * w + i] - y)) / st;
      if ((hasWater && y <= water + doc.waterMargin) || sl >= doc.maxSlope * 0.5) out[k] = 1;
    }
    return out;
  }, [showPass, tool, relief3d, heights, navNow, hasWater, water, doc.waterMargin, doc.maxSlope]);
  // pintura de baixo: a do gerador + a terra batida dos caminhos (segue as formas "Caminho")
  const trails = useMemo(() => activeFeatures.filter((f) => f.kind === "trail" && f.pts.length > 1), [activeFeatures]);
  const worldPaint = useMemo(() => {
    const n = doc.paintSize || 256;
    const wp = doc.worldPaint ? decodePaint(doc.worldPaint, n) : null;
    const tp = trailPaint(n, grid, trails.map((f) => ({ pts: f.pts, r: f.r })));
    return tp ? combinePaint(wp, tp) : wp;
  }, [doc.worldPaint, doc.paintSize, trails, grid]);
  // t automático (caro: ruído em cada ponto) só muda com o relevo; o pincel vai por cima a cada pincelada
  const baseT = useMemo(() => (doc.clean && relief3d && heights ? groundBaseT(relief3d.size, relief3d.grid, heights, hasWater ? water : null, 1337, doc.peaks !== false) : null),
    [doc.clean, relief3d, heights, hasWater, water, doc.peaks]);
  // pontes: tabuleiro com textura própria (metal/piso), no editor (t = 5) e no jogo
  const spans = useMemo(() => activeFeatures.filter((f) => f.kind === "span" && f.pts.length > 1), [activeFeatures]);
  const deck = useMemo(() => (doc.clean && allLayers && spans.length ? deckLayer(allLayers, doc.deckTex) : null), [doc.clean, allLayers, spans.length, doc.deckTex]);
  const [deckUrl, setDeckUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!deck) { setDeckUrl(null); return; }
    let alive = true;
    void texUrl(deck.d, 512).catch(() => null).then((u) => { if (alive) setDeckUrl(u ?? null); });
    return () => { alive = false; };
  }, [deck]);
  const deckSegs = useMemo(() => spans.flatMap((f) => f.pts.slice(1).map((q, k) => [f.pts[k][0], f.pts[k][1], q[0], q[1], f.r] as [number, number, number, number, number])), [spans]);
  const tField = useMemo(() => {
    if (!baseT || !relief3d) return null;
    const t = paintT(baseT, relief3d.size, relief3d.grid, combinePaint(worldPaint, paintNow));
    if (!deckUrl || !deckSegs.length) return t;
    const out = t === baseT ? t.slice() : t, s = relief3d.size, w = s + 1, st = relief3d.grid / s;
    for (const [x0, z0, x1, z1, r] of deckSegs) {
      const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - r) / st)), i1 = Math.min(s, Math.ceil((Math.max(x0, x1) + r) / st));
      const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - r) / st)), j1 = Math.min(s, Math.ceil((Math.max(z0, z1) + r) / st));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * st, z = j * st, q = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L2));
        if (Math.hypot(x - (x0 + dx * q), z - (z0 + dz * q)) <= r * 0.92) out[j * w + i] = 5;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseT, relief3d, worldPaint, paintNow, paintRev, deckUrl, deckSegs]);
  const groundView: GroundTexSet | null = useMemo(() => {
    if (doc.clean) {
      if (!chainTex) return null;
      return { sand: chainTex[0], grass: chainTex[1], dirt: chainTex[2], rock: chainTex[3], snow: chainTex[4], t: tField, deck: deckUrl, tile: uvTile,
        ring: doc.ring !== false ? { margin: grid <= 1024 ? 256 : 384, rise: doc.ringRise ?? 95, water: hasWater ? water : null } : null };
    }
    return groundTex;
  }, [doc.clean, chainTex, tField, doc.ring, doc.ringRise, grid, hasWater, water, groundTex, deckUrl, uvTile]);
  const allCuts = useMemo(() => (doc.clean || doc.world?.clearDonor ? [...edits.cuts, ...fullCuts(grid)] : edits.cuts), [edits.cuts, doc.clean, doc.world?.clearDonor, grid]);
  const [kept, removedCount] = useMemo(() => {
    const bps = donor?.kinds ?? [];
    const kinds = bps.map(decorKind);
    const inCut = cutTester(allCuts);
    const out: DecorPoint[] = [];
    let removed = 0;
    for (const [x, z, , yaw, scale, k] of donor?.props ?? []) {
      if (doc.clean || inCut(x, z)) { removed++; continue; }
      out.push({ x, z, yaw, scale, kind: kinds[k] ?? "other", bp: bps[k] });
    }
    return [out, removed] as const;
  }, [donor, allCuts, doc.clean]);
  keptRef.current = showDecor && !hidden.has("grp:prop") ? kept : [];
  const decor = useMemo(() => (showDecor && !hidden.has("grp:prop") ? kept.concat(edits.props.map((q) => ({ x: q.x, z: q.z, yaw: q.yaw, scale: q.scale, kind: decorKind(q.bp), bp: q.bp, added: true }))) : []), [kept, edits.props, showDecor, hidden]);

  const teamOf = useCallback((i: number) => teamOfSpawn(doc.teams, i, edits.spawns.length), [doc.teams, edits.spawns.length]);
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

  const usesWorld = !!doc.world || activeFeatures.length > 0 || !!doc.sculpt || edits.mass.length > 0;
  const editsTerrain = edits.relief.length > 0 || doc.rugged || edits.bridges.length > 0 || usesWorld;
  const usePatch = doc.patch || editsTerrain || blank || doc.clean;
  const lobbyName = `[${edits.spawns.length}] ${doc.lobbyName.trim()}`;
  const waterNew = hasWater && editsTerrain && !!doc.terrain;
  const scenarioId = waterNew ? fitId(slugId(doc.lobbyName), doc.terrain!.length) : slugId(doc.lobbyName);

  // a especificação do mapa só é montada ao gerar (montar a cada pincelada travava o editor:
  // codifica a pintura, a passagem e confere todas as decorações)
  const makeSpec = useCallback(() => {
    if (!doc.terrain) return null;
    const { spawns, mass, bridges, seed, relief, props, reskin } = edits;
    const ids = spawns.map((_, i) => i + 1);
    const teamList = teamLists(doc.teams, ids.length);
    const s: Record<string, unknown> = {
      terrain: doc.terrain, scenario_id: scenarioId, name: lobbyName, anchors: Object.fromEntries(spawns.map((q, i) => [String(i + 1), q])), teams: teamList,
      economy: { base_mass: doc.economy.baseMass, sites: doc.economy.sites, per_site: doc.economy.perSite }, norush: doc.norush,
      patch: usePatch ? { max_slope: doc.maxSlope, water_margin: doc.waterMargin, seed: seed ?? spawns[0] ?? [grid / 2, grid / 2], causeways: bridges } : null,
    };
    if (relief.length) s.sculpt = relief.map((r) => r.op);
    if (mass.length) s.extra_mass = mass;
    if (doc.rugged) s.rugged_edges = {};
    if (doc.smooth) s.smooth = { keep_slope: doc.maxSlope, water_margin: doc.waterMargin, mode: "level" };
    // minimapa original mostraria o mapa antigo: base em branco e visual limpo geram o do relevo
    const mm = doc.minimap === "donor" && (blank || doc.clean) ? "natural" : doc.minimap;
    if (mm !== "donor") s.minimap = mm;
    if (blank) s.flat_base = BLANK_Y;
    // tamanho que o jogo não tem: o terreno base é redimensionado ao gerar
    if (blank && blankSize && !nativeBlank(blankSize)) s.grid = blankSize;
    if (doc.clean) {
      const ch = chain.map((l) => (l ? { d: l.d, ...(l.n ? { n: l.n } : {}), ...(l.s ? { s: l.s } : {}) } : null));
      const full = ch.every(Boolean) ? (ch as { d: string }[]) : null;
      const n = doc.paintSize || 256;
      const enc = encodePaint(combinePaint(worldPaint, decodePaint(doc.paint, n)));
      s.clean = {
        ground: full ? [full[1], ...groundSpec(cleanCands)] : groundSpec(cleanCands), relight: true, clear_props: true,
        ...(full ? { chain: full } : {}), uv_tile: uvTile, ring: doc.ring !== false, ring_rise: doc.ringRise ?? 95, peaks: doc.peaks !== false,
        ...(deck && deckSegs.length ? { deck: { d: deck.d, ...(deck.n ? { n: deck.n } : {}), ...(deck.s ? { s: deck.s } : {}), segs: deckSegs.map((v) => v.map((x) => Math.round(x * 10) / 10)) } } : {}),
        ...(enc ? { paint: { size: doc.paintSize || 256, data: enc } } : {}),
      };
    }
    if (blank && hasWater) s.water_level = water;
    if (skyNow) s.sky = { env: skyNow.env, sky: skyNow.sky, sight: skyNow.sight, fog: skyNow.fog };
    if (navNow) s.nav = { size: NAV_N, data: encodePaint(navNow) };
    if (usePatch) s.strip_props = doc.strip === "none" ? false : doc.strip;
    // decorações que ficaram debaixo d'água (relevo mudou depois de colocar) não vão para o jogo
    const WATER_PROP = /kelp|barge|buoy|water|coral/i;
    const dry = hasWater && heights && relief3d ? props.filter((q) => WATER_PROP.test(q.bp) || heightAt(relief3d, heights, q.x, q.z) >= water + 0.3) : props;
    if (dry.length < props.length) s._notes = [`${props.length - dry.length} decoração(ões) debaixo d'água ficaram de fora do mapa (o chão delas está abaixo do nível da água).`];
    if (dry.length) s.props_add = dry.map((q) => [q.bp, q.x, q.z, q.yaw, q.scale]);
    if (allCuts.length && !doc.clean) s.props_remove = allCuts;
    if (waterNew) s.water_rewrite = true;
    const swaps = Object.entries(reskin).reduce<Record<string, string>>((acc, [oldD, neo]) => {
      const old = groundLayers.find((l) => l.d === oldD);
      return old ? { ...acc, ...reskinPaths(old, neo) } : acc;
    }, {});
    if (Object.keys(swaps).length && !doc.clean) s.reskin = swaps;
    const used = new Set(props.map((q) => q.bp.toLowerCase()));
    const custom = doc.models.filter((m) => used.has(m.bp.toLowerCase()));
    if (custom.length) s.custom_models = custom.map((m) => ({ creation: m.creation, slug: customSlug(m.creation), name: m.name }));
    // texturas importadas em uso no chão: o app converte o PNG do projeto nas texturas do jogo
    if (doc.clean) {
      const inUse = doc.customTex.filter((t) => chain.some((l) => l && isCustomPath(l.d) && l.d.toLowerCase() === `${customStem(t)}_d.dds`.toLowerCase()));
      if (inUse.length) s.custom_textures = inUse.map((t) => ({ creation: id, asset: t.asset, path: customStem(t) }));
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, edits, usePatch, grid, blankSize, groundLayers, lobbyName, allCuts, scenarioId, waterNew, blank, cleanCands, chain, hasWater, water, id, heights, relief3d, skyNow, deck, deckSegs, worldPaint, navNow, uvTile]);
  const canBuild = !!doc.terrain;

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
    if (!f.changes.length) { toast("info", t("Nada para corrigir automaticamente.")); return; }
    p.commit((d) => ({ ...d, edits: { ...d.edits, mass: f.mass, props: f.props } }));
    toast("ok", t("Corrigido: {list}{more}. Dá para desfazer com Ctrl+Z.", { list: f.changes.slice(0, 4).map((c) => tr(c)).join("; "), more: f.changes.length > 4 ? t(" e mais {n}", { n: f.changes.length - 4 }) : "" }));
    window.setTimeout(() => setIssues(runCheck()), 50);
  };
  const build = async (play: boolean) => {
    const spec = makeSpec();
    if (!spec) return;
    if (usesWorld && (!relief3d || !composed)) { toast("info", t("Espere o relevo do terreno carregar para gerar.")); return; }
    const found = runCheck();
    const errs = found?.filter((x) => x.level === "err") ?? [];
    if (errs.length) {
      setIssues(found);
      if (!(await confirmDialog(t("O mapa tem {n} problema(s) grave(s):\n\n- {list}\n\nGerar mesmo assim?", { n: errs.length, list: errs.slice(0, 5).map((x) => tr(x.text)).join("\n- ") }), t("Gerar mesmo assim"), t("Revisar")))) return;
    }
    setLog([]);
    setLastBuild(null);
    await saveNow();
    const full: Record<string, unknown> = { ...spec };
    if (usesWorld && relief3d && composed) {
      const data = encodeDelta(composed, relief3d.heights);
      if (data) full.height_delta = { size: relief3d.size, scale: 1 / 32, data };
    }
    const r = await run(`map:${id}`, () => api.maptkBuild(full, id), (x) => t(`"{name}" gerado, verificado e ligado na biblioteca.`, { name: x.manifest.name }));
    if (!r) return;
    setLastBuild(r.result);
    setBuiltMod(r.manifest.id);
    await refreshMods();
    if (play) await run("launch", () => api.launchGame(), t("Abrindo o jogo com o mapa novo…"));
  };

  const exportScd = async () => {
    if (!builtMod) { toast("info", t("Gere o mapa primeiro: o .scd sai do botão Gerar mapa.")); return; }
    const dir = await pickFile([], true);
    if (!dir) return;
    await run("export", async () => {
      try { return await api.modExportFiles(builtMod, dir); } catch (e) {
        const m = /EXISTE: (.*)/.exec(String(e));
        if (!m) throw e;
        if (!(await confirmDialog(t("Já existe nessa pasta: {file}\n\nSubstituir?", { file: m[1] }), t("Substituir")))) throw new Error(t("Exportação cancelada: o arquivo existente foi mantido."));
        return api.modExportFiles(builtMod, dir, true);
      }
    }, (files) => t("Mapa salvo em {path}.", { path: files[0] ?? dir }));
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
      replaceMass = await confirmDialog(t("O mapa já tem {n} ponto(s) de massa. Trocar pelos {m} pontos simétricos do gerador?\n\n(Cancelar mantém os seus e soma os novos.)", { n: edits.mass.length, m: res.mass.length }), t("Trocar"), t("Manter os meus"));
    }
    // escultura feita no mundo anterior: num mundo novo ela cai em lugares aleatórios (afunda
    // decorações e entorta o chão da massa)
    const dropSculpt = !!doc.sculpt && await confirmDialog(t("O relevo do mundo anterior foi esculpido com o pincel. Num mundo novo essas mudanças caem em lugares aleatórios e podem deixar árvores dentro d'água e massa em chão torto.\n\nApagar a escultura antiga?"), t("Apagar escultura"), t("Manter"));
    p.commit((d) => {
      const props = [...d.edits.props.filter((q) => !q.gen), ...res.props].slice(0, MAX_PROPS);
      const eco = wg.economy === "poor" ? { baseMass: 3, sites: 5, perSite: 2 } : wg.economy === "rich" ? { baseMass: 6, sites: 12, perSite: 4 } : { baseMass: 4, sites: 8, perSite: 3 };
      // massa gerada aqui (visível e editável): o toolkit não sorteia expansões por cima
      const economy = genMass ? { ...eco, sites: 0 } : eco;
      const mass = genMass ? (replaceMass ? res.mass : [...d.edits.mass, ...res.mass]).slice(0, MAX_MASS) : d.edits.mass;
      const minimap: MapDoc["minimap"] = wg.biome === "desert" ? "desert" : wg.biome === "snow" ? "snow" : wg.biome === "volcanic" ? "dark" : "natural";
      // pintura do gerador (estradas, vilas, plantações): na resolução do pincel do mapa
      const paintSize = d.paint ? d.paintSize || 256 : res.paint?.n ?? d.paintSize;
      const worldPaint = res.paint ? encodePaint(resamplePaint(res.paint, paintSize)) : null;
      return {
        ...d, world: wg, features: [...d.features.filter((f) => !f.gen), ...res.features], economy, minimap, patch: true, paintSize, worldPaint,
        ...(dropSculpt ? { sculpt: null, sculptSize: 0 } : {}),
        clean: d.base === "blank" || wg.clearDonor !== false, groundBiome: wg.biome, peaks: wg.style !== "platforms",
        ringRise: wg.style === "platforms" ? 0 : 95, worldNav: res.nav ? encodePaint(res.nav) : null,
        sky: wg.sky !== undefined ? wg.sky : d.sky, groundTex: wg.biome === d.groundBiome ? d.groundTex : null,
        teams: worldTeams(wg.players, wg.symmetry), rugged: wg.edge === "rugged",
        edits: { ...d.edits, spawns: res.spawns, props, mass },
      };
    });
    setGenOpen(false);
    setSkin("relief");
    setSel(new Set(["map"]));
    toast("ok", t("Mundo gerado: {f} formas, {p} decorações, {m} pontos de massa e {b} bases. Tudo pode ser editado.", { f: res.features.filter((f) => f.kind !== "pad").length, p: res.props.length, m: res.mass.length, b: res.spawns.length }));
  };
  /** muda de onde vem o chão (em branco ⇄ mapa do jogo) */
  const changeBase = async (b: MapDoc["base"]) => {
    if (b === doc.base) return;
    if (b === "blank") {
      const size: BlankSize = BLANK_SIZES.reduce((a, b) => (Math.abs(b - grid) < Math.abs(a - grid) ? b : a), 1024);
      if (!(await confirmDialog(t("O chão vira um plano liso de {size} × {size}: o relevo, a água, as texturas e as decorações do mapa do jogo deixam de aparecer. O que você colocou (bases, massa, formas, decorações) fica.", { size }), t("Usar mapa em branco")))) return;
      const k = size / grid;
      p.commit((d) => ({ ...scaleDoc(d, k), base: "blank", terrain: blankTerrain(size), mapSize: size, clean: true, minimap: d.minimap === "donor" ? "natural" : d.minimap }));
      setSkin("relief");
      setExag(1);
    } else {
      p.commit((d) => ({ ...d, base: "game" }));
      toast("info", t("Escolha o mapa do jogo em Propriedades → Terreno base. O visual limpo continua ligado; desligue para ver o mapa original."));
    }
  };
  const changeBlankSize = async (size: BlankSize) => {
    const cur = docMapSize(doc);
    if (size === cur) return;
    const k = size / cur;
    const any = edits.spawns.length + edits.mass.length + edits.props.length + doc.features.length + edits.relief.length > 0;
    const giant = size > 2048 ? " " + t("Mapas acima de 2048 são experimentais (o jogo original vai até 2048) e demoram alguns minutos para gerar.") : "";
    if ((any || giant) && !(await confirmDialog(`${t("Mudar para {size} × {size} ({km} km)?", { size, km: mapKm(size) })}${any ? " " + t("Bases, massa, formas e decorações acompanham na mesma proporção.") : ""}${giant}`, t("Mudar tamanho")))) return;
    p.commit((d) => ({ ...scaleDoc(d, k), terrain: blankTerrain(size), mapSize: size }));
  };

  const removeWorld = async () => {
    if (!(await confirmDialog(t("Tirar o mundo gerado? Formas e decorações criadas pelo gerador saem; as que você colocou ficam."), t("Tirar")))) return;
    p.commit((d) => ({ ...d, world: null, features: d.features.filter((f) => !f.gen), edits: { ...d.edits, props: d.edits.props.filter((q) => !q.gen) } }));
    if (!blank) setSkin("game");
  };

  const toggleLayer = (key: "hidden" | "locked", nid: string) => p.commit((d) => {
    const cur = new Set(d.layers[key]);
    if (cur.has(nid)) cur.delete(nid); else cur.add(nid);
    return { ...d, layers: { ...d.layers, [key]: [...cur] } };
  });

  /** transforma a seleção pelo teclado */
  const xformKey = (mode: "move" | "rotate" | "scale", a: number, b = 0) => {
    const ids = selIds.filter((x) => !isLocked(x));
    if (!ids.length) return;
    p.commit((d) => (mode === "move" ? moveAll(d, ids, a, b) : mode === "rotate" ? rotateAll(d, ids, centerOf(d, ids), a) : scaleAll(d, ids, centerOf(d, ids), a)));
  };
  useHotkeys(active, {
    "ctrl+s": () => void saveNow(),
    "ctrl+z": p.undo,
    "ctrl+y": p.redo,
    "ctrl+shift+z": p.redo,
    delete: doDelete,
    backspace: doDelete,
    "ctrl+d": doDuplicate,
    "ctrl+a": () => setSel(new Set(inRect(doc, [0, 0], [grid, grid]))),
    ",": () => xformKey("rotate", -15),
    ".": () => xformKey("rotate", 15),
    "-": () => xformKey("scale", 1 / 1.1),
    "=": () => xformKey("scale", 1.1),
    "+": () => xformKey("scale", 1.1),
    "shift++": () => xformKey("scale", 1.1),
    arrowleft: () => xformKey("move", -2, 0),
    arrowright: () => xformKey("move", 2, 0),
    arrowup: () => xformKey("move", 0, -2),
    arrowdown: () => xformKey("move", 0, 2),
    "shift+arrowleft": () => xformKey("move", -10, 0),
    "shift+arrowright": () => xformKey("move", 10, 0),
    "shift+arrowup": () => xformKey("move", 0, -10),
    "shift+arrowdown": () => xformKey("move", 0, 10),
    w: () => { setTool("select"); setXform("move"); },
    q: () => { setTool("select"); setXform("rotate"); },
    t: () => { setTool("select"); setXform("scale"); },
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
      return { id: `feat:${f.id}`, label: f.name ? t(f.name) : `${t(FEATURE_LABEL[f.kind])} ${count[f.kind]}`, icon: FEATURE_ICON[f.kind], color: FEATURE_COLOR[f.kind], detail: f.gen ? t("gerada") : undefined, hidden: hidden.has(`feat:${f.id}`), locked: locked.has(`feat:${f.id}`) };
    });
    return [{
      id: "map", label: doc.lobbyName || t("Mapa"), icon: "public", color: "#7bd88f", detail: baseName,
      children: [
        ...(doc.world ? [{ id: "world", label: t("Mundo gerado (semente {seed})", { seed: doc.world.seed }), icon: "auto_awesome", color: "#a3e635" }] : []),
        grp("spawn", t("Bases"), "flag", "#5aa9e6", edits.spawns.map((q, i) => ({ id: `spawn:${i}`, label: t("Base {n}", { n: i + 1 }), icon: "flag", color: TEAM_COLORS[teamOf(i) % 8], detail: `${Math.round(q[0])}, ${Math.round(q[1])}` }))),
        grp("mass", t("Massa"), "diamond", "#7bd88f", edits.mass.map((q, i) => ({ id: `mass:${i}`, label: t("Massa {n}", { n: i + 1 }), icon: "diamond", color: "#7bd88f", detail: `${Math.round(q[0])}, ${Math.round(q[1])}` }))),
        grp("feat", t("Formas do terreno"), "landscape", "#b08a62", featNodes),
        ...(doc.sculpt ? [{ id: "grp:sculpt", label: t("Pincel de escultura"), icon: "brush", color: "#e3a857", hidden: hidden.has("grp:sculpt") }] : []),
        grp("relief", t("Relevo simples"), "terrain", "#e3a857", edits.relief.map((r, i) => ({ id: `relief:${i}`, label: t(RELIEF_LABEL[r.kind]), icon: RELIEF_ICON[r.kind], color: RELIEF_COLOR[r.kind] }))),
        grp("bridge", t("Passagens na água"), "route", "#f2b33d", edits.bridges.map((_, i) => ({ id: `bridge:${i}`, label: t("Passagem {n}", { n: i + 1 }), icon: "route", color: "#f2b33d" }))),
        grp("prop", t("Decorações novas"), "park", "#4f9a46", edits.props.slice(0, 2000).map((q, i) => ({ id: `prop:${i}`, label: nice(q.bp), icon: decorKind(q.bp) === "tree" ? "park" : decorKind(q.bp) === "rock" ? "landslide" : "domain", color: q.bp.includes("/cp/") ? "#5aa9e6" : "#7fae6b", detail: q.gen ? t("gerada") : `${Math.round(q.x)}, ${Math.round(q.z)}` }))),
        grp("cut", t("Decorações retiradas"), "content_cut", "#e5534b", edits.cuts.map((c, i) => ({ id: `cut:${i}`, label: t("Área {n}", { n: i + 1 }), icon: "content_cut", color: "#e5534b", detail: `r ${Math.round(c[2])}` }))),
        ...(edits.seed ? [{ id: "seed", label: t("Ponto de partida"), icon: "my_location", color: "#fff" }] : []),
        { id: "grp:reskin", label: t("Texturas trocadas"), icon: "format_paint", color: "#c78bff", detail: String(Object.keys(edits.reskin).length), children: Object.entries(edits.reskin).map(([k, v]) => ({ id: `reskin:${k}`, label: `${k.split("_").slice(-2, -1)[0] ?? t("camada")} → ${v.name}`, icon: "format_paint", color: "#c78bff" })) },
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
      sections.push({ title: t("Mapa"), props: [
        { kind: "text", label: t("Nome no lobby"), value: doc.lobbyName, onChange: (v) => setDoc((d) => ({ ...d, lobbyName: v.slice(0, 48) })), hint: t(`Aparece como "{name}". Id: {id}`, { name: lobbyName, id: scenarioId }) },
        { kind: "select", label: t("Começar de"), value: doc.base, onChange: (v) => void changeBase(v as MapDoc["base"]), options: [{ value: "blank", label: t("Mapa em branco (grama lisa)") }, { value: "game", label: t("Um mapa do jogo") }] },
        blank
          ? { kind: "select", label: t("Tamanho"), value: String(blankSize ?? 1024), onChange: (v) => void changeBlankSize(Number(v) as BlankSize), options: BLANK_SIZES.map((k) => ({ value: String(k), label: `${tr(blankLabel(k))}${k > 2048 ? t(" · experimental") : ""}` })), hint: t("De 512 a 4096 (80 km). O jogo original vai até 2048; maiores são experimentais, pesam mais e demoram alguns minutos para gerar.") }
          : { kind: "select", label: t("Terreno base"), value: doc.terrain ?? "", onChange: (v) => setDoc((d) => ({ ...d, terrain: v || null })), options: [{ value: "", label: t("— escolha —") }, ...(terrains ?? []).map((tn) => ({ value: tn.id, label: `${tn.name ?? tn.id}${tn.kind === "campaign" ? t(" (campanha)") : ""}${tn.waterY ? t(" · água") : ""}` }))] },
        { kind: "select", label: t("Times"), value: doc.teams, onChange: (v) => setDoc((d) => ({ ...d, teams: v as MapDoc["teams"] })), options: TEAM_OPTIONS.map((o) => ({ ...o, label: t(o.label) })), hint: t("Só para conferir o equilíbrio do mapa: na hora de jogar você escolhe os times.") },
        { kind: "select", label: t("Simetria ao colocar"), value: doc.symmetry, onChange: (v) => setDoc((d) => ({ ...d, symmetry: v as Symmetry })), options: (Object.keys(SYMMETRY_LABEL) as Symmetry[]).map((k) => ({ value: k, label: t(SYMMETRY_LABEL[k]) })), hint: t("Bases, massa, decorações, formas e pinceladas são repetidas nos outros lados.") },
        { kind: "number", label: t("Raio sem ataque inicial"), value: doc.norush, min: 0, max: 200, onChange: (v) => setDoc((d) => ({ ...d, norush: v })) },
        { kind: "select", label: t("Minimapa do lobby"), value: doc.minimap, onChange: (v) => setDoc((d) => ({ ...d, minimap: v as MapDoc["minimap"] })), options: [{ value: "donor", label: t("Original do terreno") }, { value: "natural", label: t("Gerar: cores do relevo") }, { value: "desert", label: t("Gerar: deserto") }, { value: "snow", label: t("Gerar: neve") }, { value: "dark", label: t("Gerar: rocha escura") }] },
        { kind: "custom", label: "", node: <button className="btn sm" onClick={() => setLobbyOpen(true)}><Icon name="preview" size={16} /> {t("Prévia do lobby")}</button> },
      ] });
      sections.push({ title: t("Chão e visual"), props: [
        blank
          ? { kind: "info", label: t("Visual"), value: t("limpo: chão do bioma e luz refeita") }
          : { kind: "toggle", label: t("Visual limpo"), value: doc.clean, onChange: (v) => setDoc((d) => ({ ...d, clean: v })), hint: t("O chão inteiro ganha as texturas do bioma, a luz e as sombras são refeitas para o relevo novo e as decorações originais saem. Sem isso, o desenho do mapa original aparece por baixo.") },
        { kind: "select", label: t("Céu"), value: doc.sky ?? "", onChange: (v: string) => setDoc((d) => ({ ...d, sky: v || null })),
          options: [{ value: "", label: t("O do terreno base") }, ...skies.map((x) => ({ value: x.map, label: skyLabel(x) }))],
          hint: skies.length ? t("Caixa do céu, reflexo e cores de outro mapa do jogo.") : t("Os céus aparecem depois que o catálogo do jogo carregar.") } as Prop,
        ...(doc.clean ? [
          { kind: "select", label: t("Bioma do chão"), value: doc.groundBiome, onChange: (v: string) => setDoc((d) => ({ ...d, groundBiome: v as GroundBiome, groundRoles: {}, groundTex: null })), options: (Object.keys(BIOME_LABEL) as GroundBiome[]).map((k) => ({ value: k, label: t(BIOME_LABEL[k]) })) } as Prop,
          { kind: "info", label: t("Texturas"), value: chain.filter(Boolean).length ? t("{n} (praia, chão, terra, rocha, topo)", { n: chain.filter(Boolean).length }) : t("carregando…") } as Prop,
          { kind: "toggle", label: t("Neve no alto"), value: doc.peaks !== false, onChange: (v: boolean) => setDoc((d) => ({ ...d, peaks: v })), hint: t("Pontos mais altos com a textura de topo do bioma (neve na grama). Desligue em mapas de plataformas.") } as Prop,
          { kind: "select", label: t("Paisagem em volta"), value: doc.ring === false ? "off" : String(doc.ringRise ?? 95), onChange: (v: string) => setDoc((d) => (v === "off" ? { ...d, ring: false } : { ...d, ring: true, ringRise: Number(v) })),
            options: [{ value: "95", label: t("Montanhas") }, { value: "40", label: t("Morros baixos") }, { value: "0", label: t("Abismo (o chão continua lá embaixo)") }, { value: "off", label: t("Nenhuma") }],
            hint: t("O que aparece além da borda do mapa, com as texturas do bioma.") } as Prop,
          { kind: "custom", label: "", node: <button className="btn sm" onClick={() => { setTool("paint"); setLeft("ground"); }}><Icon name="brush" size={16} /> Pincel de textura</button> } as Prop,
        ] : []),
      ] });
      sections.push({ title: t("Gerador de mundo"), props: doc.world ? [
        { kind: "info", label: t("Estilo"), value: `${t(WORLD_PRESETS.find((x) => x.id === doc.world!.preset)?.label ?? doc.world.preset)} · ${t(BIOME_LABEL[doc.world.biome])}` },
        { kind: "info", label: t("Semente"), value: String(doc.world.seed) },
        { kind: "custom", label: "", node: <span className="row" style={{ gap: 6, flexWrap: "wrap" }}><button className="btn sm" onClick={() => setGenOpen(true)}><Icon name="auto_awesome" size={16} /> {t("Gerar de novo")}</button><button className="btn sm text" onClick={() => void removeWorld()}><Icon name="layers_clear" size={16} /> {t("Tirar")}</button></span> },
      ] : [
        { kind: "custom", label: "", node: <button className="btn sm primary" disabled={!relief3d} onClick={() => setGenOpen(true)}><Icon name="auto_awesome" size={16} /> {t("Gerar mundo")}</button> },
        { kind: "info", label: "", value: t("Relevo, montanhas, lagos, rios, florestas e estruturas, editáveis depois.") },
      ] });
      sections.push({ title: t("Economia"), props: [
        { kind: "number", label: t("Massa na base"), value: doc.economy.baseMass, min: 0, max: 8, onChange: (v) => setDoc((d) => ({ ...d, economy: { ...d.economy, baseMass: v } })) },
        { kind: "number", label: t("Expansões"), value: doc.economy.sites, min: 0, max: 20, onChange: (v) => setDoc((d) => ({ ...d, economy: { ...d.economy, sites: v } })) },
        { kind: "number", label: t("Massa por expansão"), value: doc.economy.perSite, min: 1, max: 6, onChange: (v) => setDoc((d) => ({ ...d, economy: { ...d.economy, perSite: v } })) },
        { kind: "info", label: t("Massa manual"), value: t("{n} ponto(s)", { n: edits.mass.length }) },
      ] });
      sections.push({ title: t("Terreno e navegação"), props: [
        { kind: "toggle", label: t("Borda rochosa"), value: doc.rugged, onChange: (v) => setDoc((d) => ({ ...d, rugged: v })), hint: t("Fecha o mapa com uma faixa de rochas intransponível.") },
        { kind: "toggle", label: t("Aplainar para construir"), value: doc.smooth, onChange: (v) => setDoc((d) => ({ ...d, smooth: v })) },
        { kind: "toggle", label: t("Abrir terreno (refazer navegação)"), value: usePatch, onChange: (v) => setDoc((d) => ({ ...d, patch: v })), hint: editsTerrain ? t("Ligado sozinho: o relevo mudou.") : t("Obrigatório em mapas de campanha.") },
        ...(usePatch ? [
          { kind: "number", label: t("Inclinação máxima"), value: doc.maxSlope, step: 0.5, min: 1, max: 20, onChange: (v: number) => setDoc((d) => ({ ...d, maxSlope: v })) } as Prop,
          { kind: "number", label: t("Margem da água"), value: doc.waterMargin, step: 0.5, min: 0, max: 20, onChange: (v: number) => setDoc((d) => ({ ...d, waterMargin: v })) } as Prop,
          { kind: "select", label: t("Objetos animados"), value: doc.strip, onChange: (v: string) => setDoc((d) => ({ ...d, strip: v as MapDoc["strip"] })), options: [{ value: "moving", label: t("Parar os que se movem") }, { value: "all", label: t("Remover todos") }, { value: "none", label: t("Manter") }] } as Prop,
        ] : []),
        { kind: "info", label: t("Água"), value: hasWater ? `${t("nível {n}", { n: round1(water) })}${waterNew ? t(" · lagos e rios novos (experimental)") : ""}` : t("este terreno não tem água") },
      ] });
      sections.push({ title: t("Anotações"), props: [{ kind: "text", label: t("Notas do projeto"), value: doc.notes, multiline: true, onChange: (v) => setDoc((d) => ({ ...d, notes: v })) }] });
      return sections;
    }
    if (one) {
      const [k, iS] = one.split(":");
      const i = Number(iS);
      if (k === "spawn" && edits.spawns[i]) sections.push({ title: t("Base {n}", { n: i + 1 }), props: [
        { kind: "number", label: "X", value: edits.spawns[i][0], min: 0, max: grid, onChange: (v) => setPt("spawns", i, [v, edits.spawns[i][1]]) },
        { kind: "number", label: "Z", value: edits.spawns[i][1], min: 0, max: grid, onChange: (v) => setPt("spawns", i, [edits.spawns[i][0], v]) },
        { kind: "info", label: t("Time"), value: doc.teams === "ffa" ? t("sozinho") : t("time {n} (na conferência)", { n: teamOf(i) + 1 }) },
        { kind: "info", label: t("Altura do chão"), value: round1(hAt(edits.spawns[i])) },
      ] });
      if (k === "mass" && edits.mass[i]) sections.push({ title: t("Massa {n}", { n: i + 1 }), props: [
        { kind: "number", label: "X", value: edits.mass[i][0], min: 0, max: grid, onChange: (v) => setPt("mass", i, [v, edits.mass[i][1]]) },
        { kind: "number", label: "Z", value: edits.mass[i][1], min: 0, max: grid, onChange: (v) => setPt("mass", i, [edits.mass[i][0], v]) },
      ] });
      if (k === "prop" && edits.props[i]) {
        const q = edits.props[i];
        const setQ = (patch: Partial<PlacedProp>) => setEdits((e) => ({ ...e, props: e.props.map((v, j) => (j === i ? { ...v, ...patch } : v)) }));
        sections.push({ title: t("Decoração"), props: [
          { kind: "info", label: t("Modelo"), value: q.bp.split("/").pop() },
          { kind: "number", label: "X", value: q.x, min: 0, max: grid, onChange: (v) => setQ({ x: v }) },
          { kind: "number", label: "Z", value: q.z, min: 0, max: grid, onChange: (v) => setQ({ z: v }) },
          { kind: "slider", label: t("Giro"), value: q.yaw, min: 0, max: 359, unit: "°", onChange: (v) => setQ({ yaw: v }) },
          { kind: "number", label: t("Escala"), value: q.scale, step: 0.05, min: 0.2, max: 5, onChange: (v) => setQ({ scale: v }) },
        ] });
      }
      if (k === "feat") {
        const f = doc.features.find((x) => x.id === one.slice(5));
        if (f) {
          const setF = (patch: Partial<Feature>) => p.commit((d) => ({ ...d, features: d.features.map((x) => (x.id === f.id ? { ...x, ...patch, gen: false } : x)) }));
          const isLine = LINE_FEATURES.includes(f.kind);
          const depth = f.kind === "lake" || f.kind === "river" || f.kind === "canyon" || f.kind === "crater";
          const fields: Prop[] = [
            { kind: "text", label: t("Nome"), value: f.name ?? "", placeholder: t(FEATURE_LABEL[f.kind]), onChange: (v) => setF({ name: v.slice(0, 40) || undefined }) },
            { kind: "select", label: t("Tipo"), value: f.kind, onChange: (v) => setF({ kind: v as FeatureKind }), options: (Object.keys(FEATURE_LABEL) as FeatureKind[]).filter((x) => LINE_FEATURES.includes(x) === isLine).map((x) => ({ value: x, label: t(FEATURE_LABEL[x]) })) },
          ];
          if (!isLine) fields.push(
            { kind: "number", label: t("Centro X"), value: f.pts[0][0], min: 0, max: grid, onChange: (v) => setF({ pts: [[v, f.pts[0][1]]] }) },
            { kind: "number", label: t("Centro Z"), value: f.pts[0][1], min: 0, max: grid, onChange: (v) => setF({ pts: [[f.pts[0][0], v]] }) },
          );
          else fields.push({ kind: "info", label: t("Linha"), value: t("{n} pontos, {len} de comprimento", { n: f.pts.length, len: Math.round(f.pts.slice(1).reduce((a, q, k2) => a + Math.hypot(q[0] - f.pts[k2][0], q[1] - f.pts[k2][1]), 0)) }) });
          fields.push({ kind: "slider", label: isLine ? t("Largura") : t("Raio"), value: f.r, min: isLine ? 6 : 15, max: isLine ? 120 : 320, onChange: (v) => setF({ r: v }) });
          if (f.kind !== "pad" && f.kind !== "pass") fields.push({ kind: "slider", label: depth ? t("Profundidade") : t("Altura"), value: f.h, min: 1, max: depth ? 60 : 160, onChange: (v) => setF({ h: v }) });
          fields.push(
            { kind: "slider", label: t("Irregularidade"), value: Math.round(f.rough * 100), min: 0, max: 100, unit: "%", onChange: (v) => setF({ rough: v / 100 }) },
            { kind: "custom", label: t("Forma"), node: <button className="btn sm" onClick={() => setF({ seed: Math.floor(Math.random() * 1e6) })}><Icon name="casino" size={16} /> {t("Variar")}</button> },
          );
          if ((f.kind === "lake" || f.kind === "river") && !hasWater) fields.push({ kind: "info", label: t("Água"), value: t("Este terreno não tem água: vira um vale seco.") });
          if (f.gen) fields.push({ kind: "info", label: "", value: t("Criada pelo gerador. Ao mudar algo ela passa a ser sua (fica ao gerar de novo).") });
          sections.push({ title: t(FEATURE_LABEL[f.kind]), props: fields });
        }
      }
      if (k === "relief" && edits.relief[i]) {
        const r = edits.relief[i];
        const op = r.op;
        const setOp = (fn: (o: typeof op) => typeof op) => setEdits((e) => ({ ...e, relief: e.relief.map((v, j) => (j === i ? { ...v, op: fn([...v.op] as typeof op) } : v)) }));
        const fields: Prop[] = [{ kind: "info", label: t("Tipo"), value: t(RELIEF_LABEL[r.kind]) }];
        if (op[0] === "disc" || op[0] === "cone") {
          fields.push(
            { kind: "number", label: t("Centro X"), value: op[1], min: 0, max: grid, onChange: (v) => setOp((o) => { o[1] = v; return o; }) },
            { kind: "number", label: t("Centro Z"), value: op[2], min: 0, max: grid, onChange: (v) => setOp((o) => { o[2] = v; return o; }) },
            { kind: "number", label: t("Raio"), value: op[3], min: 4, max: 400, onChange: (v) => setOp((o) => { o[3] = v; return o; }) },
            { kind: "number", label: t("Altura alvo"), value: op[4], step: 0.5, min: 0, max: 512, onChange: (v) => setOp((o) => { o[4] = v; return o; }) },
          );
        } else {
          fields.push(
            { kind: "number", label: t("X inicial"), value: op[1], min: 0, max: grid, onChange: (v) => setOp((o) => { o[1] = v; return o; }) },
            { kind: "number", label: t("Z inicial"), value: op[2], min: 0, max: grid, onChange: (v) => setOp((o) => { o[2] = v; return o; }) },
            { kind: "number", label: t("X final"), value: op[3], min: 0, max: grid, onChange: (v) => setOp((o) => { o[3] = v; return o; }) },
            { kind: "number", label: t("Z final"), value: op[4], min: 0, max: grid, onChange: (v) => setOp((o) => { o[4] = v; return o; }) },
          );
        }
        sections.push({ title: t("Relevo"), props: fields });
      }
      if (k === "cut" && edits.cuts[i]) {
        const c = edits.cuts[i];
        const setC = (n: [number, number, number]) => setEdits((e) => ({ ...e, cuts: e.cuts.map((v, j) => (j === i ? n : v)) }));
        sections.push({ title: t("Área sem decorações"), props: [
          { kind: "number", label: "X", value: c[0], min: 0, max: grid, onChange: (v) => setC([v, c[1], c[2]]) },
          { kind: "number", label: "Z", value: c[1], min: 0, max: grid, onChange: (v) => setC([c[0], v, c[2]]) },
          { kind: "number", label: t("Raio"), value: c[2], min: 1, max: 300, onChange: (v) => setC([c[0], c[1], v]) },
        ] });
      }
      if (k === "bridge" && edits.bridges[i]) {
        const b = edits.bridges[i];
        const setB = (n: [number, number, number, number]) => setEdits((e) => ({ ...e, bridges: e.bridges.map((v, j) => (j === i ? n : v)) }));
        sections.push({ title: t("Passagem sobre a água"), props: [
          { kind: "number", label: t("X de"), value: b[0], min: 0, max: grid, onChange: (v) => setB([v, b[1], b[2], b[3]]) },
          { kind: "number", label: t("X até"), value: b[1], min: 0, max: grid, onChange: (v) => setB([b[0], v, b[2], b[3]]) },
          { kind: "number", label: t("Z de"), value: b[2], min: 0, max: grid, onChange: (v) => setB([b[0], b[1], v, b[3]]) },
          { kind: "number", label: t("Z até"), value: b[3], min: 0, max: grid, onChange: (v) => setB([b[0], b[1], b[2], v]) },
        ] });
      }
      if (one === "seed" && edits.seed) sections.push({ title: t("Ponto de partida"), props: [
        { kind: "number", label: "X", value: edits.seed[0], min: 0, max: grid, onChange: (v) => setEdits((e) => ({ ...e, seed: [v, e.seed![1]] })) },
        { kind: "number", label: "Z", value: edits.seed[1], min: 0, max: grid, onChange: (v) => setEdits((e) => ({ ...e, seed: [e.seed![0], v] })) },
      ] });
      if (one === "grp:sculpt") sections.push({ title: t("Pincel de escultura"), props: [
        { kind: "custom", label: "", node: <button className="btn sm" onClick={() => p.commit((d) => ({ ...d, sculpt: null, sculptSize: 0 }))}><Icon name="layers_clear" size={16} /> {t("Apagar tudo que foi pintado")}</button> },
      ] });
      if (k === "reskin") {
        const oldD = one.slice(7);
        sections.push({ title: t("Textura do chão trocada"), props: [
          { kind: "info", label: t("Camada"), value: oldD.split("/").pop() },
          { kind: "info", label: t("Nova"), value: edits.reskin[oldD]?.d.split("/").pop() },
          { kind: "custom", label: "", node: <button className="btn sm" onClick={() => setEdits((e) => { const r = { ...e.reskin }; delete r[oldD]; return { ...e, reskin: r }; })}><Icon name="undo" size={16} /> {t("Voltar ao original")}</button> },
        ] });
      }
    } else {
      sections.push({ title: t("{n} objetos selecionados", { n: selIds.length }), props: [
        { kind: "custom", label: t("Ações"), node: <span className="row" style={{ gap: 6 }}><button className="btn sm" onClick={doDuplicate}><Icon name="content_copy" size={16} /> {t("Duplicar")}</button><button className="btn sm" onClick={doDelete}><Icon name="delete" size={16} /> {t("Apagar")}</button></span> },
        { kind: "info", label: t("Dica"), value: t("Arraste qualquer um deles para mover todos juntos.") },
      ] });
    }
    return sections;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, edits, doc, terrains, grid, usePatch, editsTerrain, lobbyName, water, hasWater, scenarioId, waterNew, relief3d, chain, skies, skyLabel]);

  // ------------------------------------------------------------ toolbox: meus modelos
  const useModel = async (m: CreationMeta) => {
    const baked = await api.modelBaked(m.id).catch(() => null);
    if (!baked) {
      toast("info", t(`Abra o modelo "{name}" e clique em "Preparar para o jogo" antes de usar no mapa.`, { name: m.name }));
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

  const catalog = useMemo(() => propCatalog(assets?.props ?? [], donor?.kinds ?? []), [assets, donor]);
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
  if (p.status === "error") return <div className="studio-root"><Empty icon="error" title={t("Não deu para abrir o projeto")}>{p.error}</Empty></div>;

  const brushTool = isBrush(tool);
  const circleBrush = (isRelief(tool) && tool !== "ramp") || tool === "uncut" || tool === "paint" || isNav(tool) || (tool === "decor" && density > 1) || brushTool || (isFeat(tool) && POINT_FEATS.includes(featOf(tool)));
  const brushColor = isNav(tool) ? (tool === "nav-block" ? "#e5534b" : tool === "nav-allow" ? "#7bd88f" : "#c9d1d9") : tool === "paint" ? (paintRole < 0 ? "#e5534b" : ["#e8d39a", "#7bd88f", "#c08a52", "#9aa7b4", "#f2f6fa"][paintRole]) : isRelief(tool) ? RELIEF_COLOR[tool] : brushTool ? BRUSH[tool.slice(2) as BrushMode].color : isFeat(tool) ? FEATURE_COLOR[featOf(tool)] : tool === "erase" || tool === "uncut" ? "#e5534b" : tool === "select" ? "#ffd166" : "#a3e635";
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
      <label className="range" style={{ gridTemplateColumns: "48px 1fr 34px" }}><span>{t("Raio")}</span><input type="range" min={8} max={260} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><output>{radius}</output></label>
      <label className="range" style={{ gridTemplateColumns: "48px 1fr 34px" }}><span>{brushTool ? t("Força") : t("Altura")}</span><input type="range" min={2} max={120} value={strength} onChange={(e) => setStrength(Number(e.target.value))} /><output>{strength}</output></label>
    </div>
  );
  const symSelect = (
    <div className="ribbon-stack" style={{ width: 190 }}>
      <select className="pinput" value={doc.symmetry} onChange={(e) => setDoc((d) => ({ ...d, symmetry: e.target.value as Symmetry }))} aria-label={t("Simetria")}>
        {(Object.keys(SYMMETRY_LABEL) as Symmetry[]).map((k) => <option key={k} value={k}>{t(SYMMETRY_LABEL[k])}</option>)}
      </select>
      <span className="faint small">{doc.symmetry === "none" ? t("Coloca só onde clicar") : t("Repete nos outros lados")}</span>
    </div>
  );
  const genBtn = <RibbonButton icon="auto_awesome" label={t("Gerar mundo")} onClick={() => setGenOpen(true)} disabled={!relief3d} color="#a3e635" hint={t("Relevo, montanhas, lagos, rios, florestas e estruturas a partir de uma semente (G)")} />;

  return (
    <div className="studio-root">
      <div className="studio-top">
        <Ribbon active={ribbon} onTab={setRibbon}
          tabs={[{ id: "home", label: t("Início") }, { id: "terrain", label: t("Terreno") }, { id: "shapes", label: t("Formas") }, { id: "objects", label: t("Objetos") }, { id: "view", label: t("Exibir") }, { id: "game", label: t("Jogo") }]}>
          {ribbon === "home" && <>
            <RibbonGroup label={t("Ferramentas")}>
              {toolBtn("select", "near_me", t("Selecionar"))}
              {toolBtn("orbit", "3d_rotation", t("Câmera"))}
              {toolBtn("erase", "layers_clear", t("Apagar"), "#e5534b")}
            </RibbonGroup>
            <RibbonGroup label={t("Mundo")}>{genBtn}</RibbonGroup>
            <RibbonGroup label={t("Transformar")}>
              <RibbonButton icon="open_with" label={t("Mover")} active={tool === "select" && xform === "move"} onClick={() => { setTool("select"); setXform("move"); }} hint={t("Arraste a seleção para mover. Setas: 2 unidades (Shift: 10).")} />
              <RibbonButton icon="rotate_right" label={t("Girar")} active={tool === "select" && xform === "rotate"} onClick={() => { setTool("select"); setXform("rotate"); }} hint={t("Arraste em volta da seleção para girar (Shift: de 15 em 15°). Teclas , e . giram 15°.")} />
              <RibbonButton icon="open_in_full" label={t("Escala")} active={tool === "select" && xform === "scale"} onClick={() => { setTool("select"); setXform("scale"); }} hint={t("Arraste para longe/perto do centro para aumentar/diminuir. Teclas - e + mudam 10%.")} />
            </RibbonGroup>
            <RibbonGroup label={t("Editar")}>
              <RibbonButton icon="content_copy" label={t("Duplicar")} onClick={doDuplicate} disabled={!selIds.length} hint="Ctrl+D" />
              <RibbonButton icon="delete" label={t("Excluir")} onClick={doDelete} disabled={!selIds.length} hint="Del" />
              <RibbonButton icon="deselect" label={t("Limpar seleção")} onClick={() => setSel(new Set(["map"]))} disabled={!selIds.length} />
            </RibbonGroup>
            <RibbonGroup label={t("Inserir")}>
              {toolBtn("spawn", "flag", t("Bases {n}", { n: edits.spawns.length }), "#5aa9e6")}
              {toolBtn("mass", "diamond", t("Massa"), "#7bd88f")}
              {toolBtn("f-mountain", FEATURE_ICON.mountain, t("Montanha"), FEATURE_COLOR.mountain)}
              {toolBtn("f-lake", FEATURE_ICON.lake, t("Lago"), FEATURE_COLOR.lake)}
              {toolBtn("decor", "park", t("Decorar"), "#7fae6b")}
            </RibbonGroup>
            <RibbonGroup label={t("Testar")}>
              <RibbonButton icon="construction" label={busy ? t("Gerando…") : t("Gerar mapa")} onClick={() => void build(false)} disabled={!canBuild || edits.spawns.length < 2 || busy} color="#a3e635" hint={t("Gera o .scd, verifica e liga o mapa na biblioteca")} />
              <RibbonButton icon="play_circle" label={t("Gerar e jogar")} onClick={() => void build(true)} disabled={!canBuild || edits.spawns.length < 2 || busy} color="#a3e635" />
            </RibbonGroup>
          </>}
          {ribbon === "terrain" && <>
            <RibbonGroup label={t("Mundo")}>{genBtn}</RibbonGroup>
            <RibbonGroup label={t("Pincel")}>
              {(Object.keys(BRUSH) as BrushMode[]).map((m) => toolBtn(`b-${m}`, BRUSH[m].icon, t(BRUSH[m].label), BRUSH[m].color))}
            </RibbonGroup>
            <RibbonGroup label={t("Textura")}>
              <RibbonButton icon="brush" label={t("Pintar chão")} active={tool === "paint"} disabled={!doc.clean} color="#a3e635"
                hint={doc.clean ? hintOf("paint") : t("Ligue o visual limpo (Propriedades → Chão e visual) para pintar o chão")}
                onClick={() => { setTool("paint"); setLeft("ground"); }} />
            </RibbonGroup>
            <RibbonGroup label={t("Passagem das tropas")}>
              {toolBtn("nav-block", "block", t("Bloquear"), "#e5534b")}
              {toolBtn("nav-allow", "directions_walk", t("Liberar"), "#7bd88f")}
              {toolBtn("nav-erase", "auto_fix_high", t("Automático"), "#c9d1d9")}
              <RibbonButton icon="layers" label={t("Mostrar")} active={showPass || isNav(tool)} onClick={() => setShowPass((v) => !v)} hint={t("Vermelho: as tropas por terra não passam (íngreme, água ou bloqueado à mão). Verde: liberado à mão.")} />
            </RibbonGroup>
            <RibbonGroup label={t("Tamanho")}>{sizeSliders}</RibbonGroup>
            <RibbonGroup label={t("Simetria")}>{symSelect}</RibbonGroup>
            <RibbonGroup label={t("Mapa inteiro")}>
              <RibbonButton icon="fence" label={t("Borda rochosa")} active={doc.rugged} onClick={() => setDoc((d) => ({ ...d, rugged: !d.rugged }))} />
              <RibbonButton icon="horizontal_rule" label={t("Aplainar tudo")} active={doc.smooth} onClick={() => setDoc((d) => ({ ...d, smooth: !d.smooth }))} />
              <RibbonButton icon="format_paint" label={doc.clean ? t("Chão e biomas") : t("Texturas do chão")} onClick={() => setLeft("ground")} />
              <RibbonButton icon="clear_all" label={t("Limpar relevo")} onClick={async () => {
                if (!(await confirmDialog(t("Apagar o relevo simples, as formas, o que foi pintado e as passagens? (Ctrl+Z desfaz.)"), t("Limpar")))) return;
                p.commit((d) => ({ ...d, features: d.features.filter((f) => f.kind === "pad"), sculpt: null, edits: { ...d.edits, relief: [], bridges: [] } }));
              }} disabled={!edits.relief.length && !edits.bridges.length && !doc.features.length && !doc.sculpt} />
            </RibbonGroup>
          </>}
          {ribbon === "shapes" && <>
            <RibbonGroup label={t("Elevações")}>
              {(["mountain", "hill", "ridge", "plateau", "dunes", "island"] as FeatureKind[]).filter((k) => k !== "island" || hasWater)
                .map((k) => toolBtn(`f-${k}`, FEATURE_ICON[k], t(FEATURE_LABEL[k]), FEATURE_COLOR[k]))}
            </RibbonGroup>
            <RibbonGroup label={t("Água, cavidades e caminhos")}>
              {(["lake", "river", "canyon", "crater", "pass", "trail"] as FeatureKind[]).map((k) => toolBtn(`f-${k}`, FEATURE_ICON[k], t(FEATURE_LABEL[k]), FEATURE_COLOR[k]))}
            </RibbonGroup>
            <RibbonGroup label={t("Plataformas e abismo")}>
              {(["platform", "span", "chasm", "rift"] as FeatureKind[]).map((k) => toolBtn(`f-${k}`, FEATURE_ICON[k], t(FEATURE_LABEL[k]), FEATURE_COLOR[k]))}
            </RibbonGroup>
            <RibbonGroup label={t("Tamanho")}>{sizeSliders}</RibbonGroup>
            <RibbonGroup label={t("Relevo simples")}>
              {(["hill", "valley", "plateau", "flatten", "ramp"] as ReliefKind[]).map((k) => toolBtn(k, RELIEF_ICON[k], t(RELIEF_LABEL[k]), RELIEF_COLOR[k]))}
              {toolBtn("bridge", "route", t("Vau"), "#f2b33d")}
            </RibbonGroup>
          </>}
          {ribbon === "objects" && <>
            <RibbonGroup label={t("Jogo")}>
              {toolBtn("spawn", "flag", t("Bases"), "#5aa9e6")}
              {toolBtn("mass", "diamond", t("Massa"), "#7bd88f")}
              {toolBtn("f-pad", FEATURE_ICON.pad, t("Área plana"), FEATURE_COLOR.pad)}
              {toolBtn("seed", "my_location", t("Partida"))}
            </RibbonGroup>
            <RibbonGroup label={t("Decorações")}>
              {toolBtn("decor", "park", t("Decorar"), "#7fae6b")}
              {toolBtn("uncut", "content_cut", t("Tirar"), "#e5534b")}
              <RibbonButton icon="inventory_2" label={t("Meus modelos")} onClick={() => setLeft("mine")} color="#5aa9e6" />
            </RibbonGroup>
            <RibbonGroup label={t("Espalhar")}>
              <div className="ribbon-stack" style={{ width: 230 }}>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>{t("Por clique")}</span><input type="range" min={1} max={40} value={density} onChange={(e) => setDensity(Number(e.target.value))} /><output>{density}</output></label>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>{t("Variação")}</span><input type="range" min={0} max={60} step={5} value={sizeVar} onChange={(e) => setSizeVar(Number(e.target.value))} /><output>{sizeVar}%</output></label>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>{t("Área")}</span><input type="range" min={8} max={260} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><output>{radius}</output></label>
              </div>
              <div className="ribbon-stack">
                <label className="check small"><input type="checkbox" checked={avoidWater} onChange={(e) => setAvoidWater(e.target.checked)} /> {t("Evitar água")}</label>
                <label className="check small"><input type="checkbox" checked={avoidSteep} onChange={(e) => setAvoidSteep(e.target.checked)} /> {t("Evitar encostas")}</label>
              </div>
            </RibbonGroup>
            <RibbonGroup label={t("Simetria")}>{symSelect}</RibbonGroup>
            <RibbonGroup label={t("Limpar")}>
              <RibbonButton icon="delete_sweep" label={t("Tirar as novas")} onClick={() => setEdits((e) => ({ ...e, props: [] }))} disabled={!edits.props.length} />
              <RibbonButton icon="restore" label={t("Devolver as do terreno")} onClick={() => setEdits((e) => ({ ...e, cuts: [] }))} disabled={!edits.cuts.length} />
            </RibbonGroup>
          </>}
          {ribbon === "view" && <>
            <RibbonGroup label={t("Vista")}>
              <RibbonButton icon="view_in_ar" label="3D" active={view === "3d"} disabled={!relief3d} onClick={() => setView("3d")} />
              <RibbonButton icon="map" label="2D" active={view === "2d"} onClick={() => { setView("2d"); if (tool === "orbit") setTool("select"); }} />
            </RibbonGroup>
            <RibbonGroup label={t("Camadas")}>
              <RibbonButton icon="texture" label={t("Mapa original")} active={skin === "game"} disabled={!relief3d?.texture || doc.clean} onClick={() => setSkin("game")} hint={doc.clean ? t("Com o visual limpo, nada do mapa original aparece") : t("Minimapa do terreno base (o relevo antigo, antes das suas mudanças)")} />
              <RibbonButton icon="landscape" label={doc.clean ? t("Chão do jogo") : t("Cores do relevo")} active={skin === "relief"} onClick={() => setSkin("relief")} hint={doc.clean ? t("O chão como vai ficar no jogo: a textura escolhida com luz e sombra do relevo") : t("Água, areia, grama, rocha e neve pela altura e inclinação")} />
              <RibbonButton icon="grid_on" label={t("Navegação")} active={skin === "nav"} disabled={blank} onClick={() => setSkin("nav")} hint={blank ? t("A navegação é calculada ao gerar o mapa") : undefined} />
              <RibbonButton icon="insights" label={t("Análise")} active={skin === "analysis"} onClick={() => setSkin("analysis")} hint={t("Território de cada base, caminhos e gargalos")} color="#ffd166" />
              <RibbonButton icon={showDecor ? "park" : "visibility_off"} label={t("Decorações")} active={showDecor} onClick={() => setShowDecor((v) => !v)} />
            </RibbonGroup>
            <RibbonGroup label={t("Relevo")}>
              <div className="ribbon-stack" style={{ width: 200 }}>
                <label className="range" style={{ gridTemplateColumns: "60px 1fr 34px" }}><span>{t("Exagero")}</span><input type="range" min={1} max={4} step={0.25} value={exag} onChange={(e) => setExag(Number(e.target.value))} /><output>{exag}×</output></label>
              </div>
            </RibbonGroup>
            <RibbonGroup label={t("Lobby")}>
              <RibbonButton icon="preview" label={t("Prévia do lobby")} onClick={() => setLobbyOpen(true)} disabled={!relief3d} />
            </RibbonGroup>
          </>}
          {ribbon === "game" && <>
            <RibbonGroup label={t("Gerar")}>
              <RibbonButton icon="construction" label={busy ? t("Gerando…") : t("Gerar mapa")} onClick={() => void build(false)} disabled={!canBuild || edits.spawns.length < 2 || busy} color="#a3e635" />
              <RibbonButton icon="play_circle" label={t("Gerar e jogar")} onClick={() => void build(true)} disabled={!canBuild || edits.spawns.length < 2 || busy} color="#a3e635" />
              <RibbonButton icon="save_alt" label={t("Exportar .scd")} onClick={() => void exportScd()} disabled={!builtMod} hint={t("Salva o arquivo .scd do mapa gerado numa pasta (para compartilhar ou instalar à mão)")} />
            </RibbonGroup>
            <RibbonGroup label={t("Configurar")}>
              <RibbonButton icon="tune" label={t("Propriedades do mapa")} onClick={() => setSel(new Set(["map"]))} />
              <RibbonButton icon="insights" label={t("Análise")} onClick={() => setSkin("analysis")} />
              <RibbonButton icon="fact_check" label={t("Validar")} onClick={() => setIssues(runCheck())} disabled={!relief3d || !heights} hint={t("Bases, massa, decorações e equilíbrio")} />
            </RibbonGroup>
          </>}
        </Ribbon>
        <ProjectBar p={p} onSave={() => void saveNow()} />
      </div>

      <StudioLayout id="map"
        left={<>
          <Panel title={t("Caixa de recursos")} icon="widgets" grow id="map-toolbox" collapsible={false}>
            <div className="chips" style={{ padding: "8px 8px 0" }}>
              <button className="chip" aria-pressed={left === "decor"} onClick={() => setLeft("decor")}><Icon name="park" size={15} /> {t("Do jogo")}</button>
              <button className="chip" aria-pressed={left === "mine"} onClick={() => setLeft("mine")}><Icon name="inventory_2" size={15} /> {t("Meus modelos")}</button>
              <button className="chip" aria-pressed={left === "ground"} onClick={() => setLeft("ground")}><Icon name="format_paint" size={15} /> {t("Chão")}</button>
            </div>
            <div className="spanel-pad">
              {left === "decor" && (
                <div className="decor-picker compact">
                  <PropPicker props={assets?.props ?? null} used={donor?.kinds ?? []} selected={propBp} onSelect={(bp) => { setPropBp(bp); setTool("decor"); }} />
                </div>
              )}
              {left === "mine" && (
                models === null ? <div className="bar indeterminate"><i /></div> : models.length === 0 ? (
                  <p className="faint small">{t("Você ainda não tem modelos 3D. Crie um em")} <b>{t("Criar → Criar modelo 3D")}</b> {t("e use aqui como decoração.")}</p>
                ) : (
                  <div className="col" style={{ gap: 6 }}>
                    <p className="faint small">{t("Modelos feitos no editor 3D. Eles vão dentro do mapa como decorações (experimental).")}</p>
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
              {left === "ground" && (assets === null ? <div className="bar indeterminate"><i /></div> : doc.clean ? (
                <GroundPaint all={allLayers} chain={chain} deck={spans.length ? deck : undefined} onDeck={(dPath: string | null) => setDoc((d) => ({ ...d, deckTex: dPath }))} biome={doc.groundBiome} role={paintRole} painting={tool === "paint"}
                  hasPaint={!!doc.paint || !!doc.worldPaint} ring={doc.ring !== false} radius={radius} strength={strength}
                  onRole={(r) => { setPaintRole(r); setTool("paint"); }}
                  onBiome={(b) => setDoc((d) => ({ ...d, groundBiome: b, groundRoles: {}, groundTex: null }))}
                  onPick={(role, t) => setDoc((d) => { const g = { ...d.groundRoles }; if (t) g[role] = t; else delete g[role]; return { ...d, groundRoles: g }; })}
                  onClearPaint={() => setDoc((d) => ({ ...d, paint: null, worldPaint: null }))}
                  onRing={(v) => setDoc((d) => ({ ...d, ring: v }))} onRadius={setRadius} onStrength={setStrength}
                  onImport={async (file, seamless) => {
                    const tx = await importTexture(id, file, seamless);
                    setDoc((d) => ({ ...d, customTex: [...d.customTex.filter((x) => x.slug !== tx.slug), tx] }));
                    toast("ok", t(`Textura "{name}" importada.`, { name: tx.name }));
                    return `${customStem(tx)}_d.dds`;
                  }}
                  onForget={(dPath) => setDoc((d) => {
                    const keep = d.customTex.filter((t) => `${customStem(t)}_d.dds`.toLowerCase() !== dPath.toLowerCase());
                    const g = Object.fromEntries(Object.entries(d.groundRoles).filter(([, v]) => v?.toLowerCase() !== dPath.toLowerCase()));
                    return { ...d, customTex: keep, groundRoles: g };
                  })} />
              ) : (
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
                <Empty icon="terrain" title={t("Comece o mapa")}>
                  <span className="col" style={{ gap: 10, alignItems: "center" }}>
                    <span>{t("Um chão liso de grama, pronto para esculpir, ou um mapa do jogo como base.")}</span>
                    <span className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                      {[512, 1024, 2048, 4096].map((k) => (
                        <button key={k} className={`btn ${k <= 2048 ? "primary" : ""}`} onClick={() => p.commit((d) => ({ ...d, base: "blank", terrain: blankTerrain(k), mapSize: k, clean: true, minimap: d.minimap === "donor" ? "natural" : d.minimap }))}>
                          <Icon name="grass" size={18} /> {t("Em branco")} · {tr(blankLabel(k))}
                        </button>
                      ))}
                    </span>
                    <span className="faint small">{t("Para usar um mapa do jogo, escolha o terreno em Propriedades → Terreno base.")}</span>
                  </span>
                </Empty>
              </div>
            ) : view === "3d" && relief3d && heights ? (
              <Suspense fallback={<div className="bar indeterminate" style={{ margin: 20 }}><i /></div>}>
                <MapView3D sky={skyNow?.color ?? null} pass={passCodes} size={relief3d.size} grid={relief3d.grid} heights={heights} waterLevel={water}
                  texture={texture3d} palette={skin === "relief" ? (doc.world?.biome ?? "temperate") : null} exaggeration={exag} ground={skin === "relief" ? groundView : null}
                  spawns={markers} mass={hidden.has("grp:mass") ? [] : edits.mass} bridges={edits.bridges} seed={edits.seed}
                  decor={decor} cuts={edits.cuts} highlights={highlights} lines={lines} snapshotRef={snapshot}
                  brush={brush} drag={drag} orbit={tool === "orbit"} onPointer={onPointer} />
              </Suspense>
            ) : view === "3d" ? <div className="bar indeterminate" style={{ margin: 20 }}><i /></div> : (
              <div className="map-stage studio-2d" ref={stage}
                onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); onPointer("down", toWorld(e)); }}
                onPointerMove={(e) => { const q = toWorld(e); setCursor(q); if (e.buttons & 1) onPointer("move", q); }}
                onPointerUp={(e) => onPointer("up", toWorld(e))}
                role="application" aria-label={t("Mapa em 2D")}>
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
              {selIds.length > 0 && <span className="vp-chip"><Icon name="select_all" size={15} /> {selIds.length > 1 ? t("{n} selecionados", { n: selIds.length }) : t("1 selecionado")}</span>}
              {doc.symmetry !== "none" && <span className="vp-chip"><Icon name="flip" size={15} /> {t(SYMMETRY_LABEL[doc.symmetry])}</span>}
              {skin === "relief" && <span className="vp-chip faint" title={t("No jogo o chão usa as texturas do terreno base (troque em Chão)")}><Icon name="info" size={15} /> {t("Cores da prévia")}</span>}
            </div>
            {skin === "analysis" && (
              <div className="analysis-panel">
                {!analysis ? <div className="bar indeterminate"><i /></div> : <>
                  <Notice kind={analysis.verdict === "ok" ? "ok" : analysis.verdict === "warn" ? "warn" : "err"}>{tr(analysis.text)}</Notice>
                  <table className="an-table">
                    <thead><tr><th>{t("Base")}</th><th>{t("Território")}</th><th>{t("Até o inimigo")}</th><th>{t("Massa")}</th></tr></thead>
                    <tbody>{analysis.bases.map((b) => (
                      <tr key={b.index}><td><span className="an-dot" style={{ background: TEAM_COLORS[b.team % 8] }} />{b.index + 1}</td><td>{b.territory}%</td><td>{b.enemy < 0 ? t("sem caminho") : b.enemy}</td><td>{b.mass}</td></tr>
                    ))}</tbody>
                  </table>
                  <p className="faint small">{t("{w}% caminhável · {c} pontos de gargalo.", { w: analysis.walkable, c: analysis.chokes })} <span style={{ color: "#ffa03c" }}>■</span> {t("caminhos")} <span style={{ color: "#ffd666" }}>■</span> {t("fronteira")} <span style={{ color: "#ff2840" }}>■</span> {t("gargalos.")} {t("A massa automática do toolkit entra só no mapa gerado.")}</p>
                </>}
              </div>
            )}
            {(lastBuild || log.length > 0) && (
              <div className="build-log">
                {lastBuild && (
                  <Notice kind={lastBuild.warnings?.length ? "warn" : "ok"}>
                    {typeof lastBuild.mass === "number" ? <><b>{lastBuild.mass + (lastBuild.extraMass ?? 0)}</b> {t("pontos de massa.")} </> : null}
                    {lastBuild.propsAdded || lastBuild.propsRemoved ? <>{t("{a} decorações novas, {b} retiradas.", { a: lastBuild.propsAdded ?? 0, b: lastBuild.propsRemoved ?? 0 })} </> : null}
                    {lastBuild.warnings?.length ? <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{lastBuild.warnings.slice(0, 6).map((w, i) => <li key={i}>{tr(w)}</li>)}</ul> : t("Tudo verificado e alcançável.")}
                  </Notice>
                )}
                {log.length > 0 && <div className="log mono small">{log.slice(-8).map((l, i) => <div key={i}>{l}</div>)}</div>}
                <span className="row" style={{ gap: 6 }}>
                  {lastBuild && builtMod && <button className="btn sm" onClick={() => void exportScd()}><Icon name="save_alt" size={16} /> {t("Exportar .scd")}</button>}
                  <button className="btn text sm" onClick={() => { setLog([]); setLastBuild(null); }}>{t("Fechar")}</button>
                </span>
              </div>
            )}
          </div>
        }
        right={<>
          <Panel title={t("Explorador")} icon="account_tree" grow id="map-explorer">
            <div className="tree-filter"><input placeholder={t("Filtrar objetos…")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t("Filtrar objetos")} /></div>
            <Tree nodes={nodes} selected={sel} filter={filter} onSelect={onTreeSelect}
              onToggleHidden={(nid) => toggleLayer("hidden", nid)} onToggleLocked={(nid) => toggleLayer("locked", nid)}
              onContext={(nid, x, y) => { if (!nid.startsWith("grp:") && nid !== "map" && nid !== "world") { setSel(new Set([nid])); setCtx({ x, y, id: nid }); } }} />
          </Panel>
          <Panel title={t("Propriedades")} icon="tune" grow id="map-props">
            <PropertyGrid sections={props} />
          </Panel>
        </>}
      />
      <StatusBar>
        <span><Icon name="terrain" size={13} /> <b>{baseName}</b></span>
        <span>{t("{b} bases · {m} massa · {f} formas · {p} decorações novas", { b: edits.spawns.length, m: edits.mass.length, f: doc.features.length, p: edits.props.length })}{removedCount ? ` · ${t("{n} retiradas", { n: removedCount })}` : ""}</span>
        <span className="grow" />
        {cursor && <span>x {Math.round(cursor[0])} · z {Math.round(cursor[1])} · {t("altura")} {round1(hAt(cursor))}</span>}
        {status && !status.ready && <span style={{ color: "var(--warn)" }}>{tr(status.message ?? "")}</span>}
        {edits.spawns.length < 2 && <span style={{ color: "var(--warn)" }}>{t("coloque pelo menos 2 bases para gerar")}</span>}
      </StatusBar>
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} onClose={() => setCtx(null)} items={[
        { icon: "content_copy", label: t("Duplicar"), shortcut: "Ctrl+D", onClick: doDuplicate },
        { icon: locked.has(ctx.id) ? "lock_open" : "lock", label: locked.has(ctx.id) ? t("Destravar") : t("Travar"), onClick: () => toggleLayer("locked", ctx.id) },
        { icon: "delete", label: t("Excluir"), shortcut: "Del", danger: true, onClick: doDelete },
      ] as CtxItem[]} />}
      {genOpen && relief3d && (
        <Suspense fallback={null}>
          <WorldGenModal grid={relief3d} donor={relief3d.heights} water={water} hasWater={hasWater} terrains={terrains} terrain={doc.terrain} blank={blank} blankSize={blankSize}
            initial={doc.world ? { ...doc.world, sky: doc.sky } : null} catalog={catalog} skies={skies.map((x) => ({ value: x.map, label: skyLabel(x) }))} onTerrain={(t) => setDoc((d) => {
              const m = /^blank:(\d+)$/.exec(t);
              if (m) { const size = Number(m[1]) as BlankSize; return { ...scaleDoc(d, size / grid), base: "blank", terrain: blankTerrain(size), mapSize: size, clean: true, minimap: d.minimap === "donor" ? "natural" : d.minimap }; }
              return { ...d, base: "game", terrain: t };
            })} onClose={() => setGenOpen(false)} onApply={applyWorld} />
        </Suspense>
      )}
      {issues && (
        <Modal title={t("Validação do mapa")} icon="fact_check" onClose={() => setIssues(null)}>
          <div className="col" style={{ gap: 6 }}>
            {issues.map((x, i) => (
              <button key={i} className={`check-item ${x.level}`} disabled={!x.sel} onClick={() => { if (x.sel) { setSel(new Set([x.sel])); setIssues(null); } }}>{tr(x.text)}</button>
            ))}
            <p className="faint small">{t("Clique num item para selecionar o objeto. A correção automática move a massa para o chão plano mais perto e tira decorações sobrepostas, em cima das bases ou da massa. Bases e relevo não são alterados.")}</p>
            <footer>
              <button className="btn text" onClick={() => setIssues(runCheck())}><Icon name="refresh" size={16} /> {t("Conferir de novo")}</button>
              <button className="btn primary" disabled={!issues.some((x) => x.fixable)} onClick={autoFix}><Icon name="auto_fix_high" size={16} /> {t("Corrigir automaticamente")}</button>
            </footer>
          </div>
        </Modal>
      )}
      {lobbyOpen && (
        <Modal title={t("Prévia do lobby")} icon="preview" onClose={() => setLobbyOpen(false)}>
          <div className="lobby-prev">
            <div className="lobby-map">
              {lobbyImage ? <img src={lobbyImage} alt={t("Minimapa")} /> : <div className="bar indeterminate"><i /></div>}
              <svg viewBox={`0 0 ${grid} ${grid}`}>
                {edits.spawns.map((q, i) => <g key={i}><circle cx={q[0]} cy={q[1]} r={34} fill={TEAM_COLORS[teamOf(i) % 8]} stroke="#000" strokeWidth={6} /><text x={q[0]} y={q[1] + 13} textAnchor="middle" fontSize={40} fontWeight={700} fill="#000">{i + 1}</text></g>)}
              </svg>
            </div>
            <div className="col" style={{ gap: 4 }}>
              <b>{lobbyName}</b>
              <span className="faint small">{t("{n} jogadores", { n: edits.spawns.length })} · {t(TEAM_OPTIONS.find((o) => o.value === doc.teams)?.label ?? "times").toLowerCase()} · {t("minimapa:")} {doc.minimap === "donor" ? t("original do terreno") : doc.minimap === "natural" ? t("cores do relevo") : doc.minimap}</span>
              {doc.minimap === "donor" && usesWorld && <Notice kind="warn">{t(`O minimapa original mostra o relevo antigo do terreno. Para um mundo gerado use "Gerar: cores do relevo".`)}</Notice>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// para os erros de geração aparecerem com o texto certo
export const mapBuildError = (e: unknown) => errorText(e);

/** Cor média, contraste e tons de uma textura (para escolher o papel de cada camada do chão). */
async function textureStats(url: string) {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, 32, 32);
  const d = g.getImageData(0, 0, 32, 32).data;
  let r = 0, gg = 0, b = 0, l2 = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; const l = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255; l2 += l * l; }
  r /= n * 255; gg /= n * 255; b /= n * 255;
  const light = r * 0.3 + gg * 0.59 + b * 0.11;
  const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
  return { light, contrast: Math.sqrt(Math.max(0, l2 / n - light * light)) * 4, green: gg - (r + b) / 2, yellow: (r + gg) / 2 - b, sat: mx - mn };
}
