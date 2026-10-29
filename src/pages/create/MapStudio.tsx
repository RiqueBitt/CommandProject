// Editor de mapas em aba própria, no estilo de um estúdio de jogo: faixa de ferramentas, recursos
// à esquerda, visão 3D no centro, objetos e propriedades à direita. O documento é salvo como
// projeto (salvamento automático, versões); "Gerar mapa" usa o SC2 Map Toolkit e sai um .scd.
//
// Camadas do relevo, na ordem: terreno do jogo → gerador de mundo (relevo base) → formas
// (montanhas, lagos, rios…) → pincel de escultura → relevo simples (morro, vale, rampa…).
import { ATMOSPHERES, atmosphereSpec, tintSky } from "./atmosphere";
import { decodeRing, emptyRing, encodeRing, isRingProp, ringDab, ringHeight, ringMargin, ringScatter, type RingFill, type RingLayer, type RingMode } from "./ring";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DecorPoint, GroundTextures as GroundTexSet, Marker } from "../../components/MapView3D";
import { registerCustomProp } from "../../components/propModels";
import {
  ContextMenu, Panel, ProjectBar, PropertyGrid, Ribbon, RibbonButton, RibbonGroup, StatusBar, StudioLayout, Tree,
  useActiveEditor, useHotkeys, type CtxItem, type Prop, type TreeNode,
} from "../../components/studio/kit";
import { Empty, Icon, Modal, Notice } from "../../components/ui";
import { api, confirmDialog, onProgress, pickFile, saveGenerated } from "../../lib/api";
import { errorText, load, useStore } from "../../lib/store";
import { useTabs } from "../../lib/tabs";
import type { CreationMeta, MapAssets, MapBuildResult, MaptkStatus, SkyInfo, Terrain, TerrainPreview } from "../../lib/types";
import { useProject } from "../../lib/useProject";
import { t, tr } from "../../lib/i18n";
import { GroundPaint, GroundTextures, PropPicker } from "../studio/MapDecor";
import { biomeChain, chainTile, combinePaint, deckLayer, decodePaint, encodePaint, groundBaseT, paintDab, paintT, paintTRegion, resamplePaint, trailPaint, type PaintLayer } from "../studio/biome";
import { customLayers, customStem, importTexture, isCustomPath, registerCustomTextures, texUrl } from "../studio/customTex";
import {
  applyRelief, BLANK_SIZES, BLANK_Y, blankLabel, blankTerrain, blankWater, cutTester, docMapSize, mapKm, nativeBlank, decodeHeights, decorKind, groundCandidates, groundSpec, heightAt, meanInDisc,
  RELIEF_LABEL, reliefShape, reskinPaths, round1, type BlankSize, type Edits, type GroundBiome, type GroundLayer, type PlacedProp, type Pt, type Relief, type Relief3D, type ReliefKind,
} from "../studio/mapEdit";
import { MAX_SPAWNS, migrateMap, newMapDoc, TEAM_OPTIONS, teamLists, teamOfSpawn, worldTeams, type MapDoc } from "./docs";
import { analyzeMap, type Analysis } from "./mapAnalysis";
import { applyStamp, balanceMap, captureStamp, fmtDist, fmtTime, imageHeights, loadStamps, measure, saveStamps, sketchHeights, type Balance, type Measure, type Stamp } from "./mapTools";
import { BalanceModal, ImportHeightModal, SketchModal, TimelineModal } from "./MapAssist";
import { autoFixMap, checkMap, type MapIssue } from "./mapCheck";
import {
  AI_STYLE, aiMarkers, allIds, BUILTIN_PIECES, buildPixels, buildShares, BUILD_KEY, contestedMass, copySel, type Piece, fillProps, heightPixels, insertVertex, nearestVertex, pasteClip, rowProps, simplifyLine, smoothLine,
  SNAP_STEPS, snapPt, similarTo, symmetrizeSel, symmetryGaps, type Clip,
} from "./mapEditOps";
import { compareCompetitive, mapStats } from "./mapStats";
import { KeysModal, SpawnLayoutModal, XRayModal, type LayoutResult } from "./MapDialogs";
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
type Tool = "select" | "orbit" | "spawn" | "mass" | ReliefKind | "bridge" | "decor" | "uncut" | "seed" | "erase" | "paint" | NavTool | BrushTool | FeatTool | "ruler" | "stamp-copy" | "stamp-paste" | "decor-row" | "decor-fill" | "piece";
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
  erode: { label: "Erosão", icon: "water_drop", color: "#5fd3c0", hint: "Pinte para a chuva cavar ravinas e levar terra encosta abaixo, como a natureza faz." },
};
const POINT_FEATS: FeatureKind[] = ["mountain", "hill", "plateau", "crater", "lake", "dunes", "island", "pad", "platform", "chasm"];
const isRelief = (t: Tool): t is ReliefKind => t in RELIEF_LABEL;
const isBrush = (t: Tool): t is BrushTool => t.startsWith("b-");
const isFeat = (t: Tool): t is FeatTool => t.startsWith("f-");
const featOf = (t: FeatTool) => t.slice(2) as FeatureKind;
const MAX_MASS = 200, MAX_PROPS = 5000, MAX_CUTS = 400;
const LIM = { spawns: MAX_SPAWNS, mass: MAX_MASS, props: MAX_PROPS, cuts: MAX_CUTS };
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
  ruler: "Arraste de um ponto a outro: distância em linha reta e a pé, e quanto tempo cada tropa leva.",
  "stamp-copy": "Clique no centro do relevo que quer guardar (o raio do pincel é o tamanho do carimbo).",
  "stamp-paste": "Clique para colar o carimbo escolhido (raio, giro e espelho na caixa de recursos).",
  erase: "Clique sobre qualquer item para apagá-lo.",
  "decor-row": "Arraste uma linha: a decoração escolhida vai em fileira, no espaço escolhido (cercas, muros, árvores na estrada).",
  "decor-fill": "Arraste um retângulo: a área enche com a decoração escolhida, sem encostar uma na outra.",
  piece: "Clique para colocar a peça escolhida (com a simetria e o encaixe ligados, se estiverem).",
};

/** peças guardadas pelo usuário (valem para todos os mapas) */
const PIECES_KEY = "cp.map.pieces";
const loadPieces = (): Piece[] => { try { const v = JSON.parse(localStorage.getItem(PIECES_KEY) ?? "[]"); return Array.isArray(v) ? (v as Piece[]) : []; } catch { return []; } };
const savePieces = (l: Piece[]) => { try { localStorage.setItem(PIECES_KEY, JSON.stringify(l)); } catch { /* sem espaço */ } };

/** área de transferência do editor (vale entre mapas e entre abas) */
const CLIP_KEY = "cp.map.clip";
const readClip = (): Clip | null => { try { const v = localStorage.getItem(CLIP_KEY); return v ? (JSON.parse(v) as Clip) : null; } catch { return null; } };
const writeClip = (c: Clip) => { try { localStorage.setItem(CLIP_KEY, JSON.stringify(c)); } catch { /* sem espaço: fica só nesta sessão */ } };
const pngOf = (data: Uint8ClampedArray, px: number) => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(px, px);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
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
  const [left, setLeft] = useState<"decor" | "mine" | "ground" | "stamps">("decor");
  const [stamps, setStamps] = useState<Stamp[]>(() => loadStamps());
  const [stampId, setStampId] = useState<string | null>(null);
  const [stampRot, setStampRot] = useState(0);
  const [stampMirror, setStampMirror] = useState(false);
  const [ruler, setRuler] = useState<{ a: Pt; b: Pt; m: Measure | null } | null>(null);
  const [assist, setAssist] = useState<"sketch" | "image" | "balance" | "timeline" | "layout" | "xray" | "keys" | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [camReq, setCamReq] = useState<{ mode: "game" | "tour" | "top" | "free"; n: number } | null>(null);
  const [touring, setTouring] = useState(false);
  const [view, setView] = useState<"3d" | "2d">("3d");
  const [skin, setSkin] = useState<"game" | "nav" | "relief" | "analysis" | "build">(() => (p.doc.world || p.doc.base === "blank" ? "relief" : "game"));
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
  /** encaixe na grade (0 = desligado) e o último passo usado (para o atalho N) */
  const [snap, setSnap] = useState(0);
  const lastSnap = useRef(16);
  if (snap) lastSnap.current = snap;
  /** espaço entre as decorações da fileira e da área */
  const [rowGap, setRowGap] = useState(14);
  /** "Tirar" só leva a decoração escolhida (e não as do terreno original) */
  const [onlyBp, setOnlyBp] = useState(false);
  const clipRef = useRef<Clip | null>(readClip());
  /** decorar "natural": árvores no chão plano, pedras nas encostas (ignora o modelo escolhido) */
  const [natural, setNatural] = useState(false);
  const [showAi, setShowAi] = useState(false);
  const [pieces, setPieces] = useState<Piece[]>(() => loadPieces());
  const [pieceId, setPieceId] = useState<string | null>(null);
  const pieceRef = useRef<Piece | null>(null);
  pieceRef.current = [...BUILTIN_PIECES, ...pieces].find((x) => x.id === pieceId) ?? null;
  /** árvores e pedras do bioma para o decorar natural (o catálogo fica pronto depois) */
  const naturalPools = useRef<{ trees: string[]; rocks: string[] }>({ trees: [], rocks: [] });
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
  // relevo "lento": durante a pincelada de relevo, o que é caro e não precisa acompanhar cada
  // pincelada (texturas automáticas por altura, imagens 2D, camada de construção) usa o relevo de
  // no máximo ~0,3 s atrás; sem pincelada é o relevo de agora
  const slow = useRef<{ h: Float32Array | null; at: number }>({ h: null, at: 0 });
  if (!liveSculpt || !slow.current.h) slow.current = { h: heights, at: performance.now() };
  else if (heights !== slow.current.h && performance.now() - slow.current.at > 300) slow.current = { h: heights, at: performance.now() };
  const hSlow = slow.current.h;
  /** linhas da grade que o pincel de relevo mudou desde a última tela (a prévia 3D refaz só elas) */
  const sculptRows = useRef<[number, number][]>([]);
  const sculptFrame = useRef(0);
  // as faixas vão junto com o relevo novo (outras telas no meio, como a do cursor, não as consomem)
  const dirtyRows = useMemo(() => (liveSculpt && sculptRows.current.length ? sculptRows.current.splice(0) : null), [heights]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderVersion = useCallback((d: MapDoc) => {
    if (!relief3d) return { image: null, stats: "" };
    const feats = d.features ?? [];
    const base = d.world ? baseHeights(relief3d, relief3d.heights, water, hasWater, d.world) : null;
    const H = composeWorld(relief3d, relief3d.heights, water, hasWater, d.world, feats, base);
    if (d.sculpt && d.sculptSize) {
      const lay = resampleGrid(decodeLayer(d.sculpt, (d.sculptSize + 1) ** 2), d.sculptSize, relief3d.size);
      for (let k = 0; k < H.length; k++) H[k] = Math.max(0, Math.min(511, H[k] + lay[k]));
    }
    const e = d.edits ?? { spawns: [], mass: [], props: [] };
    return {
      image: reliefImage(relief3d, H, water, hasWater, d.world?.biome ?? "temperate", 260),
      stats: t("{b} bases · {m} massa · {f} formas · {p} decorações", { b: e.spawns.length, m: e.mass.length, f: feats.length, p: e.props.length }),
    };
  }, [relief3d, water, hasWater]);

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

  const ctxRef = useRef({ tool, radius, strength, heights, composed, relief3d, edits, drag, propBp, density, sizeVar, sel, layer, avoidWater, avoidSteep, doc, stamp: null as Stamp | null, stampRot, stampMirror, snap, rowGap, onlyBp, natural });
  ctxRef.current = { tool, radius, strength, heights, composed, relief3d, edits, drag, propBp, density, sizeVar, sel, layer, avoidWater, avoidSteep, doc, stamp: stamps.find((x) => x.id === stampId) ?? null, stampRot, stampMirror, snap, rowGap, onlyBp, natural };
  const stroke = useRef<Pt | null>(null);
  const moving = useRef<{ from: Pt; ids: Sel[]; started: boolean; center?: Pt; a0?: number; d0?: number } | null>(null);
  /** modo de transformar a seleção ao arrastar */
  const [xform, setXform] = useState<"move" | "rotate" | "scale">("move");
  const xformRef = useRef(xform);
  xformRef.current = xform;
  /** seleção por caixa (arrastar no vazio) */
  const boxing = useRef(false);
  const shiftDown = useRef(false);
  const altDown = useRef(false);
  /** ponto de uma linha (rio, serra…) sendo arrastado */
  const vertexDrag = useRef<{ fid: string; idx: number; started: boolean } | null>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { shiftDown.current = e.shiftKey; altDown.current = e.altKey; };
    window.addEventListener("keydown", h); window.addEventListener("keyup", h);
    return () => { window.removeEventListener("keydown", h); window.removeEventListener("keyup", h); };
  }, []);
  /** decorações do mapa original que ainda estão no mapa (para adotar com um clique) */
  const keptRef = useRef<DecorPoint[]>([]);
  const brushState = useRef<{ layer: Float32Array; target: number } | null>(null);
  // pincel na paisagem em volta (fora do mapa): camada própria, editada durante o traço
  const ringStroke = useRef<{ layer: RingLayer; target: number } | null>(null);
  const [ringRev, setRingRev] = useState(0);
  const ringFillRef = useRef<(kind: RingFill, density: number) => void>(() => undefined);

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
  /** decorações podem ir para a paisagem em volta (com o visual limpo e a paisagem ligada) */
  const clampRing = (v: number) => {
    const m = ctxRef.current.doc.clean && ctxRef.current.doc.ring !== false ? ringMargin(grid) - 2 : 0;
    return Math.max(-m, Math.min(grid + m, Math.round(v * 10) / 10));
  };
  const moveSel = (e: Edits, ids: Sel[], dx: number, dz: number): Edits => {
    const clamp = (v: number) => Math.max(0, Math.min(grid, Math.round(v * 10) / 10));
    const mv = (q: Pt): Pt => [clamp(q[0] + dx), clamp(q[1] + dz)];
    const n = { ...e, spawns: [...e.spawns], mass: [...e.mass], props: [...e.props], bridges: [...e.bridges], relief: [...e.relief], cuts: [...e.cuts] };
    for (const s of ids) {
      const [k, iS] = s.split(":");
      const i = Number(iS);
      if (k === "spawn") n.spawns[i] = mv(n.spawns[i]);
      else if (k === "mass") n.mass[i] = mv(n.mass[i]);
      else if (k === "prop") { const q = n.props[i]; n.props[i] = { ...q, x: clampRing(q.x + dx), z: clampRing(q.z + dz) }; }
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

  /** decoração natural para o ponto: árvore no chão plano ou suave, pedra na encosta, nada na água e nos paredões */
  const naturalBp = (x: number, z: number): string | null => {
    const { trees, rocks } = naturalPools.current;
    if (hasWater && hAt([x, z]) < water + 2) return null;
    const sl = slopeAt([x, z]);
    const list = sl < 0.45 ? trees : sl < 1.6 ? rocks : [];
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  };
  const scatter = (q: Pt): PlacedProp[] => {
    const { propBp: bp0, density: n, radius: rad, sizeVar: v, avoidWater: aw, avoidSteep: as, natural: nat } = ctxRef.current;
    if (!bp0 && !nat) return [];
    const out: PlacedProp[] = [];
    for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
      const a = Math.random() * Math.PI * 2, d = n === 1 ? 0 : Math.sqrt(Math.random()) * rad;
      const outside = isRingProp(grid, { x: q[0], z: q[1] });
      const x = outside ? clampRing(q[0] + Math.cos(a) * d) : Math.round(Math.max(2, Math.min(grid - 2, q[0] + Math.cos(a) * d)) * 10) / 10;
      const z = outside ? clampRing(q[1] + Math.sin(a) * d) : Math.round(Math.max(2, Math.min(grid - 2, q[1] + Math.sin(a) * d)) * 10) / 10;
      const bp = nat && !outside ? naturalBp(x, z) : bp0;
      if (!bp) continue;
      if (!nat && !outside && n > 1 && aw && hasWater && hAt([x, z]) < water + 2) continue;
      if (!nat && !outside && n > 1 && as && slopeAt([x, z]) > 1.1) continue;
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

  /** cola objetos copiados (ou uma peça) com o centro em `at`, repetindo na simetria */
  const placeClip = (c: Clip, at: Pt) => {
    let ids: Sel[] = [];
    p.commit((d) => {
      const [n1, out] = pasteClip(d, c, at, grid, LIM, newFeatId);
      const [n2, out2] = symOps.length > 1 ? symmetrizeSel(n1, out, symOps, grid, LIM, newFeatId) : [n1, [] as string[]];
      ids = [...out, ...out2];
      return n2;
    });
    setTimeout(() => setSel(new Set(ids.length ? ids : ["map"])), 0);
  };
  /** onde as decorações em fileira/área podem ir (dentro do mapa, longe da água e das encostas) */
  const decorOk = (x: number, z: number) => {
    const { avoidWater: aw, avoidSteep: as } = ctxRef.current;
    if (x < 2 || z < 2 || x > grid - 2 || z > grid - 2) return false;
    if (aw && hasWater && hAt([x, z]) < water + 2) return false;
    return !(as && slopeAt([x, z]) > 1.1);
  };
  /** as mesmas decorações nas cópias da simetria */
  const withSym = (list: PlacedProp[]) => (symOps.length > 1
    ? list.concat(symOps.slice(1).flatMap((o) => list.map((q2) => { const [x, z] = o.pt([q2.x, q2.z]); return { ...q2, x: round1(x), z: round1(z), yaw: mapYaw(q2.yaw, o.m) }; })))
    : list);
  const placeArea = (kind: "decor-row" | "decor-fill", a: Pt, b: Pt) => {
    const { propBp: bp, rowGap: gap, sizeVar: v, natural: nat } = ctxRef.current;
    if (!bp && !nat) { toast("info", t("Escolha uma decoração na caixa de recursos primeiro.")); setLeft("decor"); return; }
    let list = kind === "decor-row" ? rowProps(a, b, gap, bp ?? "-", v, { ok: nat ? () => true : decorOk }) : fillProps(a, b, (10000 / (gap * gap)) * 0.7, [bp ?? "-"], v, { ok: nat ? () => true : decorOk });
    // natural: cada ponto ganha árvore ou pedra pelo chão (e some onde não cabe nada)
    if (nat) list = list.flatMap((q) => { const nb = naturalBp(q.x, q.z); return nb ? [{ ...q, bp: nb, yaw: Math.round(Math.random() * 360) }] : []; });
    if (!list.length) { toast("info", t("Não sobrou lugar livre para as decorações (água ou encosta no caminho?).")); return; }
    const all = withSym(list);
    setEdits((e) => {
      const room = Math.max(0, MAX_PROPS - e.props.length);
      if (room < all.length) toast("info", t("Limite de decorações: {n} entraram.", { n: room }));
      return room ? { ...e, props: [...e.props, ...all.slice(0, room)] } : e;
    });
  };

  const onPointer = useCallback((type: "down" | "move" | "up", q0: Pt | null) => {
    const { tool: tl, radius: rad, drag: d, doc: dc } = ctxRef.current;
    if (tl === "orbit") return;
    let q = q0;
    // fora do mapa (na paisagem em volta) só valem a seleção, as decorações e os pincéis de relevo
    const outside = !!q && (q[0] < 0 || q[1] < 0 || q[0] > grid || q[1] > grid);
    if (q && outside && !(tl === "select" || tl === "decor" || tl === "uncut" || tl === "erase" || isBrush(tl)))
      q = [Math.max(0, Math.min(grid, q[0])), Math.max(0, Math.min(grid, q[1]))];
    if (q) setCursor(q);
    // encaixe na grade: bases, massa, formas, rampas, fileiras e o arrasto da seleção
    const snapTool = tl === "spawn" || tl === "mass" || tl === "seed" || tl === "select" || isFeat(tl) || tl === "ramp" || tl === "bridge" || tl === "decor-row" || tl === "decor-fill" || isRelief(tl);
    const qs: Pt | null = q && ctxRef.current.snap && snapTool && !outside ? snapPt(q, ctxRef.current.snap) : q;
    // pincel de relevo começado fora do mapa: esculpe a paisagem em volta
    if (isBrush(tl) && (ringStroke.current || (type === "down" && outside && dc.clean && dc.ring !== false))) {
      const r = ctxRef.current.relief3d, H = ctxRef.current.heights;
      if (!r || !H) return;
      const inner = (x: number, z: number) => heightAt(r, H, x, z);
      if (type === "up" || !q) {
        const st = ringStroke.current;
        ringStroke.current = null;
        stroke.current = null;
        if (st) {
          const enc = encodeRing(st.layer);
          p.commit((d0) => ({ ...d0, ringSculpt: enc, ringSculptN: st.layer.n }));
        }
        return;
      }
      if (type === "down") {
        const L = decodeRing(dc.ringSculpt, dc.ringSculptN, grid) ?? emptyRing(grid);
        ringStroke.current = { layer: L, target: ringHeight(inner, grid, dc.ringRise ?? 95, L, q[0], q[1]) };
        stroke.current = null;
      }
      const st = ringStroke.current;
      if (!st) return;
      if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) < rad * 0.22) return;
      stroke.current = q;
      const mode0 = tl.slice(2);
      const mode: RingMode = mode0 === "erode" ? "smooth" : (mode0 as RingMode);
      const total = (x: number, z: number) => ringHeight(inner, grid, dc.ringRise ?? 95, st.layer, x, z);
      let ch = false;
      for (const mq of mirrors(q)) ch = ringDab(st.layer, grid, mode, mq.p[0], mq.p[1], rad, ctxRef.current.strength, total, st.target) || ch;
      if (ch) setRingRev((v) => v + 1);
      return;
    }
    if (tl === "select") {
      // pontos da linha selecionada: arrastar move um ponto; Alt+clique põe um ponto novo
      const vd = vertexDrag.current;
      if (vd) {
        if (type === "move" && qs) {
          const cl = (v: number) => Math.max(0, Math.min(grid, Math.round(v)));
          vertexDrag.current = { ...vd, started: true };
          (vd.started ? p.amend : p.commit)((d0) => ({ ...d0, features: d0.features.map((f) => (f.id === vd.fid ? { ...f, gen: false, pts: f.pts.map((pt, k) => (k === vd.idx ? [cl(qs[0]), cl(qs[1])] as Pt : pt)) } : f)) }));
        } else if (type === "up") vertexDrag.current = null;
        return;
      }
      if (type === "down" && q && qs) {
        const s0 = [...ctxRef.current.sel];
        const one = s0.length === 1 && s0[0].startsWith("feat:") ? s0[0] : null;
        const lf = one ? dc.features.find((f) => f.id === one.slice(5)) : null;
        const lockedNow = new Set(dc.layers.locked);
        if (lf && one && LINE_FEATURES.includes(lf.kind) && lf.pts.length > 1 && !lockedNow.has(one) && !lockedNow.has("grp:feat")) {
          if (altDown.current) {
            const [pts, idx] = insertVertex(lf.pts, qs);
            p.commit((d0) => ({ ...d0, features: d0.features.map((f) => (f.id === lf.id ? { ...f, pts, gen: false } : f)) }));
            vertexDrag.current = { fid: lf.id, idx, started: true };
            return;
          }
          const idx = nearestVertex(lf.pts, q, Math.max(10, lf.r * 0.5));
          if (idx >= 0) { vertexDrag.current = { fid: lf.id, idx, started: false }; return; }
        }
      }
      if (type === "down" && q) {
        const s = ctxRef.current.sel;
        let hit = pick(q, dc);
        if (!hit) {
          // decoração do mapa original: vira uma decoração editável (sai a original, entra a cópia)
          const at = q;
          const kd = keptRef.current.reduce<[number, DecorPoint | null]>((best, k) => { const dd = Math.hypot(k.x - at[0], k.z - at[1]); return dd < best[0] ? [dd, k] : best; }, [10, null])[1];
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
        moving.current = { from: qs ?? q, ids, started: false, center, a0: Math.atan2(q[1] - center[1], q[0] - center[0]), d0: Math.max(4, Math.hypot(q[0] - center[0], q[1] - center[1])) };
      } else if (type === "move" && q && boxing.current && d) {
        setDrag({ ...d, b: q });
      } else if (type === "move" && q && moving.current) {
        const m = moving.current;
        const mode = xformRef.current;
        if (mode === "move") {
          const to = qs ?? q;
          const dx = to[0] - m.from[0], dz = to[1] - m.from[1];
          if (Math.hypot(dx, dz) < 1) return;
          // o primeiro passo do arrasto entra no histórico; o resto continua o mesmo passo
          moving.current = { ...m, from: to, started: true };
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
    q = qs;
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
        liveT.current = null;
        paintRows.current = [];
        stroke.current = null;
        return;
      }
      if (type === "down") {
        const base = decodePaint(ctxRef.current.doc.paint, ctxRef.current.doc.paintSize || 256);
        livePaint.current = base;
        // cópia do t atual: cada pincelada refaz só a área dela (antes refazia o mapa inteiro)
        liveT.current = paintCtx.current.tField ? paintCtx.current.tField.slice() : null;
        paintRows.current = [];
        stroke.current = null;
      }
      const lp = livePaint.current;
      if (!lp) return;
      if (stroke.current && Math.hypot(q[0] - stroke.current[0], q[1] - stroke.current[1]) < rad * 0.2) return;
      stroke.current = q;
      let ch = false;
      const pc = paintCtx.current, lt = liveT.current, st = r.grid / r.size;
      for (const mq of mirrors(q)) {
        if (!paintDab(lp, r.grid, mq.p[0], mq.p[1], rad, paintRoleRef.current, Math.max(0.15, ctxRef.current.strength / 60))) continue;
        ch = true;
        if (lt && pc.baseT) {
          const i0 = Math.floor((mq.p[0] - rad) / st) - 1, i1 = Math.ceil((mq.p[0] + rad) / st) + 1;
          const j0 = Math.floor((mq.p[1] - rad) / st) - 1, j1 = Math.ceil((mq.p[1] + rad) / st) + 1;
          paintTRegion(lt, pc.baseT, r.size, r.grid, pc.worldPaint, lp, i0, j0, i1, j1, pc.deckMask);
          paintRows.current.push([Math.max(0, j0), Math.min(r.size, j1)]);
        }
      }
      if (ch) setPaintRev((v) => v + 1);
      return;
    }
    // régua: arrastar de A até B
    if (tl === "ruler") {
      const r = ctxRef.current.relief3d, H = ctxRef.current.heights;
      if (type === "down" && q) setRuler({ a: q, b: q, m: null });
      else if (type === "move" && q) setRuler((x) => (x ? { ...x, b: q } : x));
      else if (type === "up") setRuler((x) => {
        if (!x || !r || !H) return x;
        const b = q ?? x.b;
        return { a: x.a, b, m: measure(r, H, water, hasWater, x.a, b) };
      });
      return;
    }
    // carimbos: guardar o relevo de um círculo / colar o carimbo escolhido
    if (tl === "stamp-copy" && type === "down" && q) {
      const r = ctxRef.current.relief3d, H = ctxRef.current.heights;
      if (!r || !H) return;
      const name = prompt(t("Nome do carimbo:"), t("Carimbo {n}", { n: loadStamps().length + 1 }));
      if (!name) return;
      const st = captureStamp(r, H, q[0], q[1], rad, name.trim().slice(0, 40));
      const list = [st, ...loadStamps()];
      saveStamps(list);
      setStamps(list);
      setStampId(st.id);
      setLeft("stamps");
      setTool("stamp-paste");
      toast("ok", t("Carimbo guardado. Clique no mapa para colar (raio, giro e espelho na caixa de recursos)."));
      return;
    }
    if (tl === "stamp-paste" && type === "down" && q) {
      const { relief3d: r, composed: cur, stamp: st } = ctxRef.current;
      if (!r || !cur) return;
      if (!st) { toast("info", t("Escolha um carimbo na caixa de recursos (ou guarde um com Copiar).")); setLeft("stamps"); return; }
      const lay = ctxRef.current.layer ? ctxRef.current.layer.slice() : new Float32Array((r.size + 1) ** 2);
      const work = cur.slice();
      for (const mq of mirrors(q)) applyStamp(r, lay, work, st, mq.p[0], mq.p[1], rad, ctxRef.current.stampRot, ctxRef.current.stampMirror);
      commitSculpt(lay);
      return;
    }
    // pincel de escultura
    if (isBrush(tl)) {
      const mode = tl.slice(2) as BrushMode;
      const r = ctxRef.current.relief3d, cur = ctxRef.current.composed;
      if (!r || !cur) return;
      if (type === "up" || !q) {
        if (sculptFrame.current) { cancelAnimationFrame(sculptFrame.current); sculptFrame.current = 0; }
        if (brushState.current) { commitSculpt(brushState.current.layer); brushState.current = null; setLiveSculpt(null); }
        sculptRows.current = [];
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
      const st = r.grid / r.size;
      for (const mq of mirrors(q)) {
        brushDab(r, bs.layer, cur, mode, mq.p[0], mq.p[1], rad, ctxRef.current.strength, bs.target);
        // margem: o chão plano da massa acompanha a altura média em volta
        sculptRows.current.push([Math.max(0, Math.floor((mq.p[1] - rad - 16) / st)), Math.min(r.size, Math.ceil((mq.p[1] + rad + 16) / st))]);
      }
      // uma tela por quadro: o mouse manda bem mais eventos que isso
      if (!sculptFrame.current) sculptFrame.current = requestAnimationFrame(() => {
        sculptFrame.current = 0;
        if (brushState.current) setLiveSculpt(brushState.current.layer.slice());
      });
      return;
    }
    // formas em linha e retângulos (arrastar)
    if (tl === "ramp" || tl === "bridge" || tl === "decor-row" || tl === "decor-fill" || (isFeat(tl) && LINE_FEATURES.includes(featOf(tl)))) {
      if (type === "down" && q) setDrag({ a: q, b: q });
      else if (type === "move" && q && d) setDrag({ ...d, b: q });
      else if (type === "up" && d) {
        const b = q ?? d.b;
        setDrag(null);
        if (tl === "decor-row" || tl === "decor-fill") {
          if (tl === "decor-fill" && (Math.abs(b[0] - d.a[0]) < 6 || Math.abs(b[1] - d.a[1]) < 6)) return;
          placeArea(tl, d.a, b);
          return;
        }
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
    if (tl === "piece" && type === "down") {
      const pc = pieceRef.current;
      if (!pc) { toast("info", t("Escolha uma peça na caixa de recursos (Carimbos e peças).")); setLeft("stamps"); return; }
      placeClip(pc.clip, q);
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
        // "só a escolhida": leva só as decorações novas do modelo escolhido (as do terreno ficam)
        const only = ctxRef.current.onlyBp ? ctxRef.current.propBp : null;
        const near = (x: PlacedProp) => (!only || x.bp === only) && pts.some((c) => Math.hypot(x.x - c[0], x.z - c[1]) <= r);
        const cuts = only ? ed.cuts : ed.cuts.length + pts.length <= MAX_CUTS ? [...ed.cuts, ...pts.map((c) => [c[0], c[1], r] as [number, number, number])] : ed.cuts;
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
  }, [p, setEdits, grid, mirrors, symOps, water, hasWater]);

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
  const baseT = useMemo(() => (doc.clean && relief3d && hSlow ? groundBaseT(relief3d.size, relief3d.grid, hSlow, hasWater ? water : null, 1337, doc.peaks !== false) : null),
    [doc.clean, relief3d, hSlow, hasWater, water, doc.peaks]);
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
  // vértices do tabuleiro das pontes (t = 5)
  const deckMask = useMemo(() => {
    if (!relief3d || !deckUrl || !deckSegs.length) return null;
    const s0 = relief3d.size, w = s0 + 1, st = relief3d.grid / s0, out = new Uint8Array(w * w);
    for (const [x0, z0, x1, z1, r] of deckSegs) {
      const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(x0, x1) - r) / st)), i1 = Math.min(s0, Math.ceil((Math.max(x0, x1) + r) / st));
      const j0 = Math.max(0, Math.floor((Math.min(z0, z1) - r) / st)), j1 = Math.min(s0, Math.ceil((Math.max(z0, z1) + r) / st));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * st, z = j * st, q = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L2));
        if (Math.hypot(x - (x0 + dx * q), z - (z0 + dz * q)) <= r * 0.92) out[j * w + i] = 1;
      }
    }
    return out;
  }, [relief3d, deckUrl, deckSegs]);
  // t salvo (sem a pincelada em curso: durante o traço só a área pintada é refeita, em liveT)
  const tField = useMemo(() => {
    if (!baseT || !relief3d) return null;
    const t = paintT(baseT, relief3d.size, relief3d.grid, combinePaint(worldPaint, paintSaved));
    if (!deckMask) return t;
    const out = t === baseT ? t.slice() : t;
    for (let k = 0; k < out.length; k++) if (deckMask[k]) out[k] = 5;
    return out;
  }, [baseT, relief3d, worldPaint, paintSaved, deckMask]);
  /** t vivo durante a pincelada de textura e as faixas de linhas que mudaram desde a última tela */
  const liveT = useRef<Float32Array | null>(null);
  const paintRows = useRef<[number, number][]>([]);
  const paintCtx = useRef({ baseT, worldPaint, deckMask, tField });
  paintCtx.current = { baseT, worldPaint, deckMask, tField };
  const ringLayer = useMemo(() => decodeRing(doc.ringSculpt, doc.ringSculptN, grid), [doc.ringSculpt, doc.ringSculptN, grid]);
  // muda a cada camada nova (pincelada confirmada, desfazer, refazer): a prévia refaz a paisagem
  const ringSeq = useRef(0);
  const ringDocRev = useMemo(() => ++ringSeq.current, [ringLayer]); // eslint-disable-line react-hooks/exhaustive-deps
  const groundView: GroundTexSet | null = useMemo(() => {
    if (doc.clean) {
      if (!chainTex) return null;
      // faixas pintadas desde a última tela: a prévia refaz só a mistura delas
      const dirty = liveT.current && paintRows.current.length ? paintRows.current.splice(0) : null;
      return { sand: chainTex[0], grass: chainTex[1], dirt: chainTex[2], rock: chainTex[3], snow: chainTex[4], t: liveT.current ?? tField, dirty, deck: deckUrl, tile: uvTile,
        ring: doc.ring !== false ? { margin: ringMargin(grid), rise: doc.ringRise ?? 95, water: hasWater ? water : null, layer: ringStroke.current?.layer ?? ringLayer, rev: ringRev * 100000 + ringDocRev } : null };
    }
    return groundTex;
  }, [doc.clean, chainTex, tField, paintRev, doc.ring, doc.ringRise, grid, hasWater, water, groundTex, deckUrl, uvTile, ringLayer, ringRev, ringDocRev]);
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
        else if (f && sel.size === 1) {
          // linha sozinha na seleção: cada ponto aparece para arrastar
          for (const q of [f.pts[0], f.pts[f.pts.length - 1]]) out.push([q[0], q[1], f.r]);
          for (const q of f.pts) out.push([q[0], q[1], Math.max(5, Math.min(12, f.r * 0.3))]);
        } else if (f) for (const q of [f.pts[0], f.pts[f.pts.length - 1]]) out.push([q[0], q[1], f.r]);
      }
    }
    return out;
  }, [sel, edits, doc.features]);
  const lines = useMemo(() => {
    const selF = new Set([...sel].filter((s) => s.startsWith("feat:")).map((s) => s.slice(5)));
    const out = activeFeatures.filter((f) => LINE_FEATURES.includes(f.kind) && f.pts.length > 1 && (selF.has(f.id) || f.kind === "pass")).map((f) => ({ pts: f.pts, color: selF.has(f.id) ? "#ffd166" : FEATURE_COLOR[f.kind] }));
    if (ruler && tool === "ruler") out.push({ pts: [ruler.a, ruler.b], color: "#ffd166" });
    if (drag && tool === "decor-row") out.push({ pts: [drag.a, drag.b], color: "#7fae6b" });
    return out;
  }, [activeFeatures, sel, ruler, tool, drag]);

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
        ...(doc.ring !== false && doc.ringSculpt && doc.ringSculptN ? { ring_sculpt: { n: doc.ringSculptN, margin: ringMargin(grid), data: doc.ringSculpt } } : {}),
        ...(deck && deckSegs.length ? { deck: { d: deck.d, ...(deck.n ? { n: deck.n } : {}), ...(deck.s ? { s: deck.s } : {}), segs: deckSegs.map((v) => v.map((x) => Math.round(x * 10) / 10)) } } : {}),
        ...(enc ? { paint: { size: doc.paintSize || 256, data: enc } } : {}),
      };
    }
    if (blank && hasWater) s.water_level = water;
    if (skyNow) s.sky = { env: skyNow.env, sky: skyNow.sky, sight: skyNow.sight, fog: skyNow.fog };
    const atm = atmosphereSpec(doc.atmosphere);
    if (atm) s.atmosphere = atm;
    if (navNow) s.nav = { size: NAV_N, data: encodePaint(navNow) };
    if (doc.aiMarkers === false) s.ai_markers = false;
    if (usePatch) s.strip_props = doc.strip === "none" ? false : doc.strip;
    // decorações que ficaram debaixo d'água (relevo mudou depois de colocar) não vão para o jogo
    const WATER_PROP = /kelp|barge|buoy|water|coral/i;
    const ringOn = doc.clean && doc.ring !== false;
    // decorações fora do mapa só existem com a paisagem em volta
    const placed = ringOn ? props : props.filter((q) => !isRingProp(grid, q));
    const groundOf = (q: PlacedProp) => (relief3d && heights ? (isRingProp(grid, q)
      ? ringHeight((x, z) => heightAt(relief3d, heights, x, z), grid, doc.ringRise ?? 95, ringLayer, q.x, q.z)
      : heightAt(relief3d, heights, q.x, q.z)) : 0);
    const dry = hasWater && heights && relief3d ? placed.filter((q) => WATER_PROP.test(q.bp) || groundOf(q) >= water + 0.3) : placed;
    if (dry.length < placed.length) s._notes = [`${placed.length - dry.length} decoração(ões) debaixo d'água ficaram de fora do mapa (o chão delas está abaixo do nível da água).`];
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
  }, [doc, edits, ringLayer, usePatch, grid, blankSize, groundLayers, lobbyName, allCuts, scenarioId, waterNew, blank, cleanCands, chain, hasWater, water, id, heights, relief3d, skyNow, deck, deckSegs, worldPaint, navNow, uvTile]);
  const canBuild = !!doc.terrain;

  // ------------------------------------------------------------ ações
  const saveNow = useCallback(async () => {
    const thumb = snapshot.current?.() ?? null;
    const ok = await p.save({ thumb });
    if (ok && p.meta && doc.lobbyName && p.meta.name !== doc.lobbyName) renameTab(id, p.meta.name);
    return ok;
  }, [p, doc.lobbyName, id, renameTab]);

  const runCheck = () => {
    if (!relief3d || !heights) return null;
    const out = checkMap(relief3d, heights, water, hasWater, edits.spawns, edits.mass, edits.props, teamOf, doc.clean && doc.ring !== false ? ringMargin(grid) : 0);
    // simetria ligada: bases e massa sem par do outro lado deixam um lado em vantagem
    const gaps = symmetryGaps(doc, symOps);
    if (gaps.length) {
      const item: MapIssue = { level: "warn", text: t("{n} base(s)/ponto(s) de massa sem par do outro lado da simetria ({s}). Selecione e use Aplicar simetria (Ctrl+M).", { n: gaps.length, s: t(SYMMETRY_LABEL[doc.symmetry]).toLowerCase() }), sel: gaps[0] };
      const ok = out.findIndex((x) => x.level === "ok");
      if (ok >= 0) out.splice(ok, 1, item); else out.push(item);
    }
    return out;
  };
  const autoFix = () => {
    if (!relief3d || !heights) return;
    const f = autoFixMap(relief3d, heights, water, hasWater, edits.spawns, edits.mass, edits.props, doc.clean && doc.ring !== false ? ringMargin(grid) : 0);
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

  const doCopy = (cut = false) => {
    const ids = selIds.filter((x) => !isLocked(x));
    const c = copySel(doc, ids);
    if (!c) { toast("info", t("Selecione o que quer copiar.")); return; }
    clipRef.current = c;
    writeClip(c);
    if (cut) { p.commit((d) => removeAll(d, ids)); setSel(new Set(["map"])); }
    toast("ok", cut ? t("{n} objeto(s) recortados. Ctrl+V cola onde o mouse estiver.", { n: c.items.length }) : t("{n} objeto(s) copiados. Ctrl+V cola onde o mouse estiver (também em outro mapa).", { n: c.items.length }));
  };
  const doPaste = () => {
    const c = clipRef.current ?? readClip();
    if (!c) { toast("info", t("Nada copiado ainda: selecione e use Ctrl+C.")); return; }
    placeClip(c, snapPt(cursor ?? [grid / 2, grid / 2], snap));
  };
  const doSymmetrize = () => {
    if (symOps.length < 2) { toast("info", t("Escolha uma simetria primeiro (Terreno → Simetria): ela diz para onde as cópias vão.")); return; }
    const ids = selIds.filter((x) => !isLocked(x));
    if (!ids.length) { toast("info", t("Selecione o que quer repetir nos outros lados (Ctrl+A pega o mapa inteiro).")); return; }
    let made: Sel[] = [];
    p.commit((d) => { const [n, out] = symmetrizeSel(d, ids, symOps, grid, LIM, newFeatId); made = out; return n; });
    setTimeout(() => {
      if (!made.length) toast("info", t("Tudo já tem par do outro lado da simetria."));
      else { toast("ok", t("{n} cópia(s) criadas nos outros lados. Ctrl+Z desfaz.", { n: made.length })); setSel(new Set([...ids, ...made])); }
    }, 0);
  };
  const doSimilar = () => {
    if (!selIds.length) return;
    const all = new Set<Sel>();
    for (const x of selIds.slice(0, 20)) for (const y of similarTo(doc, x)) all.add(y);
    setSel(new Set(all.size ? [...all] : ["map"]));
  };
  const doInvert = () => {
    const cur = new Set(selIds);
    const rest = allIds(doc).filter((x) => !cur.has(x) && !isLocked(x) && !hidden.has(groupOf(x)) && !hidden.has(x));
    setSel(new Set(rest.length ? rest : ["map"]));
  };
  /** áreas planas embaixo das bases (a mesma que o gerador de mundo faz) */
  const basePads = (spawns: Pt[], feats: Feature[]): Feature[] => {
    const nn = spawns.map((q, i) => Math.min(...spawns.filter((_, j) => j !== i).map((o) => Math.hypot(o[0] - q[0], o[1] - q[1]))));
    const r = Math.round(Math.max(30, Math.min(70, (Number.isFinite(Math.min(...nn)) ? Math.min(...nn) : 200) * 0.4)));
    return spawns.filter((q) => !feats.some((f) => f.kind === "pad" && Math.hypot(f.pts[0][0] - q[0], f.pts[0][1] - q[1]) < 20))
      .map((q) => ({ id: newFeatId(), kind: "pad" as FeatureKind, pts: [[Math.round(q[0]), Math.round(q[1])] as Pt], r, h: 0, rough: 0, seed: 1, name: "Base" }));
  };
  const flattenBases = () => {
    if (!edits.spawns.length) { toast("info", t("Coloque as bases primeiro.")); return; }
    const pads = basePads(edits.spawns, doc.features);
    if (!pads.length) { toast("info", t("Todas as bases já têm o chão aplainado.")); return; }
    p.commit((d) => ({ ...d, features: [...d.features, ...pads] }));
    toast("ok", t("Chão aplainado embaixo de {n} base(s). Ctrl+Z desfaz.", { n: pads.length }));
  };
  const applyLayout = (r: LayoutResult) => {
    p.commit((d) => {
      // as áreas planas das bases antigas (feitas aqui ou pelo gerador) saem junto com elas
      const old = d.edits.spawns;
      const keep = d.features.filter((f) => !(f.kind === "pad" && f.name === "Base" && old.some((q) => Math.hypot(f.pts[0][0] - q[0], f.pts[0][1] - q[1]) < 20)));
      return {
        ...d, symmetry: r.symmetry !== "none" ? r.symmetry : d.symmetry, teams: r.teams === "keep" ? d.teams : r.teams,
        features: r.pads ? [...keep, ...basePads(r.spawns, keep)] : keep, edits: { ...d.edits, spawns: r.spawns },
      };
    });
    setAssist(null);
    setSel(new Set(r.spawns.map((_, i) => `spawn:${i}`)));
    toast("ok", t("{n} bases colocadas. Ctrl+Z desfaz.", { n: r.spawns.length }));
  };
  const fileBase = (slugId(doc.lobbyName).replace(/^SC2_/, "") || "MAPA").toLowerCase();
  const exportHeights = async () => {
    if (!relief3d || !heights) return;
    const px = Math.min(1024, relief3d.size * 2);
    const hp = heightPixels(relief3d.size, heights, px);
    const path = await saveGenerated(`${fileBase}_relevo.png`, pngOf(hp.data, px), [{ name: "PNG", extensions: ["png"] }]);
    if (path) toast("ok", t("Relevo salvo em {path}. Preto = altura {a}, branco = altura {b} (use esses números para importar de volta).", { path, a: round1(hp.lo), b: round1(hp.hi) }));
  };
  const exportMinimap = async () => {
    if (!relief3d || !heights) return;
    const url = skin === "build" && buildImage ? buildImage : reliefImage(relief3d, heights, water, hasWater, doc.world?.biome ?? "temperate", 1024);
    const path = await saveGenerated(`${fileBase}_${skin === "build" ? "construcao" : "mapa"}.png`, url, [{ name: "PNG", extensions: ["png"] }]);
    if (path) toast("ok", t("Imagem salva em {path}.", { path }));
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
    "ctrl+c": () => doCopy(),
    "ctrl+x": () => doCopy(true),
    "ctrl+v": doPaste,
    "ctrl+m": doSymmetrize,
    "ctrl+i": doInvert,
    "ctrl+shift+a": doSimilar,
    n: () => setSnap((v) => (v ? 0 : lastSnap.current)),
    "[": () => setRadius((v) => Math.max(8, Math.round(v / 1.15))),
    "]": () => setRadius((v) => Math.min(260, Math.round(v * 1.15) + 1)),
    "shift+{": () => setStrength((v) => Math.max(2, Math.round(v / 1.2))),
    "shift+}": () => setStrength((v) => Math.min(120, Math.round(v * 1.2) + 1)),
    "shift+?": () => setAssist("keys"),
    "?": () => setAssist("keys"),
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
        { kind: "select", label: t("Atmosfera"), value: doc.atmosphere?.preset ?? "",
          onChange: (v: string) => setDoc((d) => ({ ...d, atmosphere: v || d.atmosphere?.wind != null ? { preset: v, strength: d.atmosphere?.strength ?? 1, windDir: d.atmosphere?.windDir ?? 0, wind: d.atmosphere?.wind ?? null } : null })),
          options: [{ value: "", label: t("A do terreno base") }, ...Object.entries(ATMOSPHERES).map(([k, st]) => ({ value: k, label: t(st.label) }))],
          hint: doc.atmosphere?.preset && ATMOSPHERES[doc.atmosphere.preset] ? t(ATMOSPHERES[doc.atmosphere.preset].desc) : t("Cor do sol e das sombras, da água e da neblina, sobre a luz do mapa base.") } as Prop,
        ...(doc.atmosphere?.preset ? [
          { kind: "slider", label: t("Força da atmosfera"), value: Math.round((doc.atmosphere.strength ?? 1) * 100), min: 0, max: 150, step: 5, unit: "%",
            onChange: (v: number) => setDoc((d) => (d.atmosphere ? { ...d, atmosphere: { ...d.atmosphere, strength: v / 100 } } : d)) } as Prop,
        ] : []),
        { kind: "select", label: t("Vento"), value: doc.atmosphere?.wind == null ? "" : String(doc.atmosphere.wind),
          onChange: (v: string) => setDoc((d) => {
            const wind = v === "" ? null : Number(v);
            const next = { preset: d.atmosphere?.preset ?? "", strength: d.atmosphere?.strength ?? 1, windDir: d.atmosphere?.windDir ?? 0, wind };
            return { ...d, atmosphere: next.preset || wind !== null ? next : null };
          }),
          options: [{ value: "", label: t("O do terreno base") }, { value: "0", label: t("Sem vento") }, { value: "0.4", label: t("Brisa") }, { value: "1", label: t("Vento forte") }, { value: "2", label: t("Ventania") }],
          hint: t("Mexe com a água, as árvores e a fumaça no jogo.") } as Prop,
        ...(doc.atmosphere?.wind != null ? [
          { kind: "slider", label: t("Direção do vento"), value: doc.atmosphere.windDir ?? 0, min: 0, max: 345, step: 15, unit: "°",
            onChange: (v: number) => setDoc((d) => (d.atmosphere ? { ...d, atmosphere: { ...d.atmosphere, windDir: v } } : d)) } as Prop,
        ] : []),
        ...(doc.clean ? [
          { kind: "select", label: t("Bioma do chão"), value: doc.groundBiome, onChange: (v: string) => setDoc((d) => ({ ...d, groundBiome: v as GroundBiome, groundRoles: {}, groundTex: null })), options: (Object.keys(BIOME_LABEL) as GroundBiome[]).map((k) => ({ value: k, label: t(BIOME_LABEL[k]) })) } as Prop,
          { kind: "info", label: t("Texturas"), value: chain.filter(Boolean).length ? t("{n} (praia, chão, terra, rocha, topo)", { n: chain.filter(Boolean).length }) : t("carregando…") } as Prop,
          { kind: "toggle", label: t("Neve no alto"), value: doc.peaks !== false, onChange: (v: boolean) => setDoc((d) => ({ ...d, peaks: v })), hint: t("Pontos mais altos com a textura de topo do bioma (neve na grama). Desligue em mapas de plataformas.") } as Prop,
          { kind: "select", label: t("Paisagem em volta"), value: doc.ring === false ? "off" : String(doc.ringRise ?? 95), onChange: (v: string) => setDoc((d) => (v === "off" ? { ...d, ring: false } : { ...d, ring: true, ringRise: Number(v) })),
            options: [{ value: "95", label: t("Montanhas") }, { value: "40", label: t("Morros baixos") }, { value: "12", label: t("Planície") }, { value: "0", label: t("Abismo (o chão continua lá embaixo)") }, { value: "off", label: t("Nenhuma") }],
            hint: t("O que aparece além da borda do mapa, com as texturas do bioma.") } as Prop,
          ...(doc.ring !== false ? [{ kind: "custom", label: "", node: <RingTools
            sculpted={!!doc.ringSculpt} props={edits.props.filter((q) => isRingProp(grid, q)).length}
            onFill={(k, dens) => ringFillRef.current(k, dens)}
            onClearProps={() => setEdits((e) => ({ ...e, props: e.props.filter((q) => !isRingProp(grid, q)) }))}
            onClearSculpt={() => p.commit((d) => ({ ...d, ringSculpt: null, ringSculptN: 0 }))} /> } as Prop] : []),
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
        { kind: "toggle", label: t("Marcadores para a IA"), value: doc.aiMarkers !== false, onChange: (v) => setDoc((d) => ({ ...d, aiMarkers: v })), hint: t("Ao gerar, o mapa ganha os pontos que a IA usa para andar, expandir, defender e atacar (caminhos por terra e ar, expansões, áreas de combate).") },
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
          else fields.push(
            { kind: "info", label: t("Linha"), value: t("{n} pontos, {len} de comprimento", { n: f.pts.length, len: Math.round(f.pts.slice(1).reduce((a, q, k2) => a + Math.hypot(q[0] - f.pts[k2][0], q[1] - f.pts[k2][1]), 0)) }) },
            { kind: "custom", label: t("Pontos"), node: <span className="row wrap" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => setF({ pts: smoothLine(f.pts) })} title={t("Curva mais redonda (mais pontos)")}><Icon name="gesture" size={16} /> {t("Suavizar")}</button>
              <button className="btn sm" disabled={f.pts.length <= 2} onClick={() => setF({ pts: simplifyLine(f.pts) })} title={t("Metade dos pontos, mantendo o desenho")}><Icon name="timeline" size={16} /> {t("Simplificar")}</button>
              <button className="btn sm" onClick={() => setF({ pts: [...f.pts].reverse() })} title={t("Troca o começo pelo fim (o sentido do rio)")}><Icon name="swap_horiz" size={16} /> {t("Inverter")}</button>
            </span> },
            { kind: "info", label: "", value: t("Arraste os pontos amarelos no mapa para mudar a linha. Alt+clique põe um ponto novo.") },
          );
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
        { kind: "custom", label: t("Ações"), node: <span className="row wrap" style={{ gap: 6 }}>
          <button className="btn sm" onClick={doDuplicate}><Icon name="content_copy" size={16} /> {t("Duplicar")}</button>
          <button className="btn sm" onClick={() => doCopy()}><Icon name="file_copy" size={16} /> {t("Copiar")}</button>
          <button className="btn sm" onClick={doSimilar}><Icon name="select_all" size={16} /> {t("Selecionar iguais")}</button>
          {doc.symmetry !== "none" && <button className="btn sm" onClick={doSymmetrize}><Icon name="flip" size={16} /> {t("Aplicar simetria")}</button>}
          <button className="btn sm" onClick={doDelete}><Icon name="delete" size={16} /> {t("Apagar")}</button>
        </span> },
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
  naturalPools.current = useMemo(() => {
    const biome = doc.groundBiome;
    const ofBiome = (list: string[]) => { const here = list.filter((bp) => catalog.meta?.[bp.toLowerCase()]?.biomes.includes(biome)); return here.length >= 3 ? here : list; };
    return { trees: ofBiome(catalog.trees), rocks: ofBiome(catalog.rocks) };
  }, [catalog, doc.groundBiome]);
  // povoar a paisagem em volta (prédios, mata, rochas, ruínas) com decorações do bioma
  ringFillRef.current = (kind: RingFill, density: number) => {
    const H = heights, r = relief3d;
    if (!H || !r) return;
    const biome = doc.groundBiome;
    const ofBiome = (list: string[]) => {
      const here = list.filter((bp) => catalog.meta?.[bp.toLowerCase()]?.biomes.includes(biome));
      return here.length >= 3 ? here : list;
    };
    const pools = { trees: ofBiome(catalog.trees), rocks: ofBiome(catalog.rocks), buildings: catalog.buildings, wrecks: catalog.wrecks };
    const inner = (x: number, z: number) => heightAt(r, H, x, z);
    const total = (x: number, z: number) => ringHeight(inner, grid, doc.ringRise ?? 95, ringLayer, x, z);
    const list = ringScatter(grid, kind, pools, density, total, hasWater ? water : null, Math.floor(Math.random() * 1e9));
    if (!list.length) { toast("info", t("Não achei decorações desse tipo no jogo (ou a paisagem não tem lugar plano para elas).")); return; }
    setEdits((e) => {
      const room = Math.max(0, MAX_PROPS - e.props.length);
      if (room < list.length) toast("info", t("Limite de decorações: {n} entraram.", { n: room }));
      return { ...e, props: [...e.props, ...list.slice(0, room)] };
    });
  };
  const reliefTexture = useMemo(() => (view === "2d" && skin === "relief" && relief3d && hSlow ? reliefImage(relief3d, hSlow, water, hasWater, doc.world?.biome ?? "temperate", 512) : null),
    [view, skin, relief3d, hSlow, water, hasWater, doc.world?.biome]);
  // camada de construção: onde cabe prédio, onde só passa e onde é paredão (2D e 3D)
  const buildImage = useMemo(() => (skin === "build" && relief3d && hSlow ? pngOf(buildPixels(relief3d.size, relief3d.grid, hSlow, water, hasWater, doc.maxSlope, 512, 8), 512) : null),
    [skin, relief3d, hSlow, water, hasWater, doc.maxSlope]);
  const xray = useMemo(() => {
    if (assist !== "xray" || !relief3d || !heights) return null;
    const st = mapStats(heights, relief3d.size, grid, edits.spawns, edits.mass);
    return { st, checks: compareCompetitive(st, grid, doc.economy.baseMass), shares: buildShares(relief3d.size, grid, heights, water, hasWater, doc.maxSlope) };
  }, [assist, relief3d, heights, grid, edits.spawns, edits.mass, doc.economy.baseMass, water, hasWater, doc.maxSlope]);
  // prévia dos marcadores que a IA vai receber ao gerar
  const aiPreview = useMemo(() => {
    if (!showAi || !relief3d || !hSlow) return null;
    const h = (x: number, z: number) => heightAt(relief3d, hSlow, Math.max(0, Math.min(grid, x)), Math.max(0, Math.min(grid, z)));
    return aiMarkers(h, (x, z) => !hasWater || h(x, z) > water + 0.5, grid, edits.spawns, edits.mass);
  }, [showAi, relief3d, hSlow, grid, hasWater, water, edits.spawns, edits.mass]);
  const contested = useMemo(() => (assist === "xray" && relief3d && heights ? contestedMass(relief3d, heights, water, hasWater, edits.spawns, edits.mass, teamOf) : []),
    [assist, relief3d, heights, water, hasWater, edits.spawns, edits.mass, teamOf]);
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
  const image2d = skin === "build" ? buildImage : skin === "analysis" && analysis ? analysis.image : skin === "relief" ? reliefTexture : skin === "game" && relief3d?.texture ? relief3d.texture : preview?.dataUrl;
  const texture3d = skin === "build" ? buildImage : skin === "analysis" ? analysis?.image ?? null : skin === "relief" ? null : skin === "game" ? relief3d?.texture ?? null : preview?.dataUrl ?? null;
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
  const snapSelect = (
    <div className="ribbon-stack" style={{ width: 120 }}>
      <select className="pinput" value={String(snap)} onChange={(e) => setSnap(Number(e.target.value))} aria-label={t("Encaixe na grade")} title={t("Bases, massa, formas e o arrasto da seleção andam de tantas em tantas unidades (N liga e desliga)")}>
        {SNAP_STEPS.map((k) => <option key={k} value={k}>{k ? t("Grade de {n}", { n: k }) : t("Sem encaixe")}</option>)}
      </select>
      <span className="faint small">{snap ? t("N desliga") : t("N liga")}</span>
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
  // ------------------------------------------------------------ assistente
  /** troca o relevo inteiro por `H` (vai na camada do pincel: dá para desfazer e continuar editando) */
  const replaceRelief = (H: Float32Array) => {
    if (!featured || !relief3d) return;
    const lay = new Float32Array(H.length);
    for (let k = 0; k < H.length; k++) lay[k] = H[k] - featured[k];
    commitSculpt(lay);
  };
  const baseLevel = () => {
    if (hasWater) return water + 8;
    const h = relief3d ? Float32Array.from(relief3d.heights).sort() : null;
    return h ? h[h.length >> 1] : 60;
  };
  const applySketch = (sk: Uint8Array, N: number, bases: Pt[]) => {
    if (!relief3d) return;
    replaceRelief(sketchHeights(relief3d, sk, N, water, hasWater, Math.floor(Math.random() * 1e6), baseLevel()));
    if (bases.length >= 2) setEdits((e) => ({ ...e, spawns: bases.map((b) => [round1((b[0] / 1024) * grid), round1((b[1] / 1024) * grid)] as Pt) }));
    setAssist(null);
    setSkin("relief");
    toast("ok", t("Esboço transformado em relevo. Ctrl+Z desfaz; continue editando com os pincéis e as formas."));
  };
  const applyImage = (gray: Float32Array, w: number, h: number, low: number, high: number) => {
    if (!relief3d) return;
    replaceRelief(imageHeights(relief3d, gray, w, h, low, high));
    setAssist(null);
    setSkin("relief");
    toast("ok", t("Relevo importado da imagem. Ctrl+Z desfaz."));
  };
  const openBalance = () => {
    if (!relief3d || !heights) return;
    if (edits.spawns.length < 2) { toast("info", t("Ponha pelo menos 2 bases para avaliar o equilíbrio.")); return; }
    setBalance(balanceMap(relief3d, heights, water, hasWater, edits.spawns, edits.mass, teamOf));
    setAssist("balance");
  };
  const travelTable = () => {
    if (!relief3d || !heights || !balance) return [];
    const out: { a: number; b: number; walk: string; time: string }[] = [];
    for (let a = 0; a < edits.spawns.length && out.length < 12; a++) for (let b = a + 1; b < edits.spawns.length && out.length < 12; b++) {
      if (teamOf(a) === teamOf(b)) continue;
      const m = measure(relief3d, heights, water, hasWater, edits.spawns[a], edits.spawns[b]);
      out.push({ a: a + 1, b: b + 1, walk: m.walk === null ? t("sem caminho") : fmtDist(m.walk), time: fmtTime(m.times[1].seconds) });
    }
    return out;
  };

  const genBtn = <RibbonButton icon="auto_awesome" label={t("Gerar mundo")} onClick={() => setGenOpen(true)} disabled={!relief3d} color="#a3e635" hint={t("Relevo, montanhas, lagos, rios, florestas e estruturas a partir de uma semente (G)")} />;

  return (
    <div className="studio-root">
      <div className="studio-top">
        <Ribbon active={ribbon} onTab={setRibbon}
          tabs={[{ id: "home", label: t("Início") }, { id: "terrain", label: t("Terreno") }, { id: "shapes", label: t("Formas") }, { id: "objects", label: t("Objetos") }, { id: "assist", label: t("Assistente") }, { id: "view", label: t("Exibir") }, { id: "game", label: t("Jogo") }]}>
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
              <div className="ribbon-stack">
                <RibbonButton small icon="file_copy" label={t("Copiar")} onClick={() => doCopy()} disabled={!selIds.length} hint={t("Ctrl+C. Cola com Ctrl+V onde o mouse estiver, neste ou em outro mapa (Ctrl+X recorta).")} />
                <RibbonButton small icon="content_paste" label={t("Colar")} onClick={doPaste} hint="Ctrl+V" />
              </div>
              <div className="ribbon-stack">
                <RibbonButton small icon="select_all" label={t("Iguais")} onClick={doSimilar} disabled={!selIds.length} hint={t("Selecionar iguais (mesma decoração, mesmo tipo de forma)") + " · Ctrl+Shift+A"} />
                <RibbonButton small icon="deselect" label={t("Limpar seleção")} onClick={() => setSel(new Set(["map"]))} disabled={!selIds.length} hint="Esc" />
              </div>
              <RibbonButton icon="flip" label={t("Aplicar simetria")} onClick={doSymmetrize} disabled={!selIds.length || doc.symmetry === "none"} color="#c78bff" hint={t("Repete a seleção nos outros lados da simetria escolhida, só onde ainda não tem par (Ctrl+M). Com Ctrl+A simetriza o mapa inteiro.")} />
            </RibbonGroup>
            <RibbonGroup label={t("Encaixe")}>{snapSelect}</RibbonGroup>
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
              <RibbonButton icon="grid_view" label={t("Distribuir bases")} onClick={() => setAssist("layout")} disabled={!doc.terrain} color="#5aa9e6" hint={t("Bases em círculo, nos cantos ou frente a frente, já com a simetria certa")} />
              <RibbonButton icon="foundation" label={t("Aplainar bases")} onClick={flattenBases} disabled={!edits.spawns.length} hint={t("Chão plano embaixo de cada base (como no gerador de mundo)")} />
            </RibbonGroup>
            <RibbonGroup label={t("Decorações")}>
              {toolBtn("decor", "park", t("Decorar"), "#7fae6b")}
              {toolBtn("decor-row", "more_horiz", t("Fileira"), "#7fae6b")}
              {toolBtn("decor-fill", "select_all", t("Preencher"), "#7fae6b")}
              {toolBtn("uncut", "content_cut", t("Tirar"), "#e5534b")}
              <RibbonButton icon="inventory_2" label={t("Meus modelos")} onClick={() => setLeft("mine")} color="#5aa9e6" />
            </RibbonGroup>
            <RibbonGroup label={t("Espalhar")}>
              <div className="ribbon-stack" style={{ width: 230 }}>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>{t("Por clique")}</span><input type="range" min={1} max={40} value={density} onChange={(e) => setDensity(Number(e.target.value))} /><output>{density}</output></label>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>{t("Variação")}</span><input type="range" min={0} max={60} step={5} value={sizeVar} onChange={(e) => setSizeVar(Number(e.target.value))} /><output>{sizeVar}%</output></label>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }}><span>{t("Área")}</span><input type="range" min={8} max={260} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /><output>{radius}</output></label>
                <label className="range" style={{ gridTemplateColumns: "70px 1fr 30px" }} title={t("Espaço entre as decorações da Fileira e do Preencher")}><span>{t("Espaço")}</span><input type="range" min={3} max={80} value={rowGap} onChange={(e) => setRowGap(Number(e.target.value))} /><output>{rowGap}</output></label>
              </div>
              <div className="ribbon-stack">
                <label className="check small"><input type="checkbox" checked={avoidWater} onChange={(e) => setAvoidWater(e.target.checked)} /> {t("Evitar água")}</label>
                <label className="check small"><input type="checkbox" checked={avoidSteep} onChange={(e) => setAvoidSteep(e.target.checked)} /> {t("Evitar encostas")}</label>
                <label className="check small" title={t("Ignora o modelo escolhido: árvores do bioma no chão plano, pedras nas encostas, nada na água nem nos paredões")}><input type="checkbox" checked={natural} onChange={(e) => setNatural(e.target.checked)} /> {t("Natural")}</label>
                <label className="check small" title={t("Tirar leva só as decorações novas do modelo escolhido; as do terreno original ficam")}><input type="checkbox" checked={onlyBp} onChange={(e) => setOnlyBp(e.target.checked)} /> {t("Tirar só a escolhida")}</label>
              </div>
            </RibbonGroup>
            <RibbonGroup label={t("Simetria")}>{symSelect}</RibbonGroup>
            <RibbonGroup label={t("Limpar")}>
              <RibbonButton icon="delete_sweep" label={t("Tirar as novas")} onClick={() => setEdits((e) => ({ ...e, props: [] }))} disabled={!edits.props.length} />
              <RibbonButton icon="restore" label={t("Devolver as do terreno")} onClick={() => setEdits((e) => ({ ...e, cuts: [] }))} disabled={!edits.cuts.length} />
            </RibbonGroup>
          </>}
          {ribbon === "assist" && <>
            <RibbonGroup label={t("Criar")}>
              <RibbonButton icon="draw" label={t("Esboço → mapa")} onClick={() => setAssist("sketch")} disabled={!relief3d} color="#a3e635" hint={t("Desenhe com cores (água, montanha, deserto…) e vira relevo de verdade")} />
              <RibbonButton icon="chat" label={t("Descrever o mapa")} onClick={() => setGenOpen(true)} disabled={!relief3d} color="#a3e635" hint={t("Escreva como quer o mapa (\"arquipélago com 6 jogadores e muitos rios\") no gerador de mundo")} />
              <RibbonButton icon="image" label={t("Relevo de imagem")} onClick={() => setAssist("image")} disabled={!relief3d} hint={t("PNG em tons de cinza vira relevo")} />
            </RibbonGroup>
            <RibbonGroup label={t("Natureza")}>
              {toolBtn("b-erode", BRUSH.erode.icon, t(BRUSH.erode.label), BRUSH.erode.color)}
            </RibbonGroup>
            <RibbonGroup label={t("Carimbos")}>
              {toolBtn("stamp-copy", "approval", t("Copiar relevo"), "#ffd166")}
              {toolBtn("stamp-paste", "content_paste", t("Colar carimbo"), "#ffd166")}
              <RibbonButton icon="collections_bookmark" label={t("Biblioteca {n}", { n: stamps.length })} onClick={() => setLeft("stamps")} />
              {toolBtn("piece", "widgets", t("Colocar peça"), "#ffd166")}
            </RibbonGroup>
            <RibbonGroup label={t("Tamanho")}>{sizeSliders}</RibbonGroup>
            <RibbonGroup label={t("Medir e equilibrar")}>
              {toolBtn("ruler", "straighten", t("Régua"), "#ffd166")}
              <RibbonButton icon="balance" label={t("Equilíbrio")} onClick={openBalance} disabled={!heights} color="#ffd166" hint={t("Nota de 0 a 100: massa, distância ao inimigo e proteção de cada base")} />
              <RibbonButton icon="query_stats" label={t("Raio-X")} onClick={() => setAssist("xray")} disabled={!heights} color="#ffd166" hint={t("Compara o relevo e a massa com mapas competitivos feitos à mão: chão plano, níveis, paredões e onde fica a massa")} />
            </RibbonGroup>
            <RibbonGroup label={t("Câmera")}>
              <RibbonButton icon="videogame_asset" label={t("Câmera do jogo")} disabled={view !== "3d"} onClick={() => setCamReq({ mode: "game", n: Date.now() })} hint={t("A inclinação e o zoom da câmera do jogo")} />
              <RibbonButton icon="flight" label={touring ? t("Passeando…") : t("Passeio")} active={touring} disabled={view !== "3d"} onClick={() => { setCamReq({ mode: touring ? "free" : "tour", n: Date.now() }); setTouring((v) => !v); }} hint={t("A câmera dá a volta no mapa (clique para parar)")} />
              <RibbonButton icon="crop_free" label={t("De cima")} disabled={view !== "3d"} onClick={() => setCamReq({ mode: "top", n: Date.now() })} />
            </RibbonGroup>
            <RibbonGroup label={t("Histórico")}>
              <RibbonButton icon="history" label={t("Linha do tempo")} onClick={() => setAssist("timeline")} disabled={!p.meta || !relief3d} hint={t("Volte no tempo pelas versões salvas, comparando com o mapa de agora")} />
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
              <RibbonButton icon="foundation" label={t("Construção")} active={skin === "build"} onClick={() => setSkin("build")} disabled={!heights} hint={t("Verde: cabe prédio. Amarelo: só prédio pequeno. Laranja: só passa. Vermelho: paredão. Com curvas de nível.")} color="#3fb950" />
              <RibbonButton icon={showDecor ? "park" : "visibility_off"} label={t("Decorações")} active={showDecor} onClick={() => setShowDecor((v) => !v)} />
              <RibbonButton icon="smart_toy" label={t("Marcadores da IA")} active={showAi} disabled={!heights} onClick={() => setShowAi((v) => !v)} hint={t("Mostra onde o mapa vai ter os pontos da IA ao gerar: caminhos, expansões, defesa, encontro e combate")} color="#2ec4b6" />
            </RibbonGroup>
            <RibbonGroup label={t("Relevo")}>
              <div className="ribbon-stack" style={{ width: 200 }}>
                <label className="range" style={{ gridTemplateColumns: "60px 1fr 34px" }}><span>{t("Exagero")}</span><input type="range" min={1} max={4} step={0.25} value={exag} onChange={(e) => setExag(Number(e.target.value))} /><output>{exag}×</output></label>
              </div>
            </RibbonGroup>
            <RibbonGroup label={t("Lobby")}>
              <RibbonButton icon="preview" label={t("Prévia do lobby")} onClick={() => setLobbyOpen(true)} disabled={!relief3d} />
            </RibbonGroup>
            <RibbonGroup label={t("Ajuda")}>
              <RibbonButton icon="keyboard" label={t("Atalhos")} onClick={() => setAssist("keys")} hint="?" />
            </RibbonGroup>
          </>}
          {ribbon === "game" && <>
            <RibbonGroup label={t("Gerar")}>
              <RibbonButton icon="construction" label={busy ? t("Gerando…") : t("Gerar mapa")} onClick={() => void build(false)} disabled={!canBuild || edits.spawns.length < 2 || busy} color="#a3e635" />
              <RibbonButton icon="play_circle" label={t("Gerar e jogar")} onClick={() => void build(true)} disabled={!canBuild || edits.spawns.length < 2 || busy} color="#a3e635" />
              <RibbonButton icon="save_alt" label={t("Exportar .scd")} onClick={() => void exportScd()} disabled={!builtMod} hint={t("Salva o arquivo .scd do mapa gerado numa pasta (para compartilhar ou instalar à mão)")} />
            </RibbonGroup>
            <RibbonGroup label={t("Imagens")}>
              <RibbonButton icon="gradient" label={t("Relevo PNG")} onClick={() => void exportHeights()} disabled={!heights} hint={t("O relevo em tons de cinza (para editar num programa de imagem e importar de volta em Relevo de imagem)")} />
              <RibbonButton icon="image" label={t("Mapa PNG")} onClick={() => void exportMinimap()} disabled={!heights} hint={t("Imagem do mapa visto de cima (com a camada Construção ligada, sai ela)")} />
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
              <button className="chip" aria-pressed={left === "stamps"} onClick={() => setLeft("stamps")}><Icon name="approval" size={15} /> {t("Carimbos e peças")}</button>
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
              {left === "stamps" && (
                <div className="col" style={{ gap: 8 }}>
                  <p className="faint small">{t("Guarde montanhas, vales e ilhas que ficaram bons e cole em outros lugares (ou em outros mapas). Copiar relevo: clique no centro; o raio do pincel é o tamanho.")}</p>
                  <div className="row" style={{ gap: 6 }}>
                    <button className={`btn sm ${tool === "stamp-copy" ? "primary" : ""}`} onClick={() => setTool("stamp-copy")}><Icon name="approval" size={15} /> {t("Copiar relevo")}</button>
                    <button className={`btn sm ${tool === "stamp-paste" ? "primary" : ""}`} disabled={!stampId} onClick={() => setTool("stamp-paste")}><Icon name="content_paste" size={15} /> {t("Colar")}</button>
                  </div>
                  <label className="range"><span>{t("Giro")}</span><input type="range" min={0} max={345} step={15} value={stampRot} onChange={(e) => setStampRot(Number(e.target.value))} /><output>{stampRot}°</output></label>
                  <label className="check small"><input type="checkbox" checked={stampMirror} onChange={(e) => setStampMirror(e.target.checked)} /> {t("Espelhado")}</label>
                  <b className="small" style={{ marginTop: 4 }}>{t("Peças")}</b>
                  <p className="faint small">{t("Pedaços de mapa prontos (expansões, platôs, desfiladeiros) e os que você guardar: escolha e clique no mapa.")}</p>
                  <button className="btn sm" disabled={!selIds.length} onClick={() => {
                    const c = copySel(doc, selIds);
                    if (!c) return;
                    const name = prompt(t("Nome da peça:"), t("Peça {n}", { n: pieces.length + 1 }));
                    if (!name) return;
                    const pc: Piece = { id: `p${Date.now().toString(36)}`, name: name.trim().slice(0, 40), clip: c };
                    const l = [pc, ...pieces];
                    savePieces(l); setPieces(l); setPieceId(pc.id); setTool("piece");
                    toast("ok", t("Peça guardada: escolha e clique no mapa para colocar (vale em todos os mapas)."));
                  }}><Icon name="bookmark_add" size={15} /> {t("Guardar a seleção como peça")}</button>
                  {[...pieces, ...BUILTIN_PIECES].map((pc) => (
                    <div key={pc.id} className={`stamp-row ${pc.id === pieceId ? "on" : ""}`}>
                      <button className="grow" onClick={() => { setPieceId(pc.id); setTool("piece"); }}><Icon name={pc.builtin ? "widgets" : "bookmark"} size={16} /> {pc.builtin ? t(pc.name) : pc.name} <small className="faint">{t("{n} itens", { n: pc.clip.items.length })}</small></button>
                      {!pc.builtin && <button className="btn icon-btn sm" aria-label={t("Apagar")} onClick={() => { const l = pieces.filter((x) => x.id !== pc.id); savePieces(l); setPieces(l); if (pieceId === pc.id) setPieceId(null); }}><Icon name="delete" size={15} /></button>}
                    </div>
                  ))}
                  <b className="small" style={{ marginTop: 4 }}>{t("Carimbos de relevo")}</b>
                  {stamps.length === 0 ? <p className="faint small">{t("Nenhum carimbo ainda.")}</p> : stamps.map((st) => (
                    <div key={st.id} className={`stamp-row ${st.id === stampId ? "on" : ""}`}>
                      <button className="grow" onClick={() => { setStampId(st.id); setTool("stamp-paste"); }}><Icon name="terrain" size={16} /> {st.name} <small className="faint">r {st.r}</small></button>
                      <button className="btn icon-btn sm" aria-label={t("Apagar")} onClick={() => { const l = stamps.filter((x) => x.id !== st.id); saveStamps(l); setStamps(l); if (stampId === st.id) setStampId(null); }}><Icon name="delete" size={15} /></button>
                    </div>
                  ))}
                </div>
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
                <MapView3D dirtyRows={dirtyRows} sky={tintSky(skyNow?.color ?? null, doc.atmosphere)} pass={passCodes} size={relief3d.size} grid={relief3d.grid} heights={heights} waterLevel={water}
                  texture={texture3d} palette={skin === "relief" ? (doc.world?.biome ?? "temperate") : null} exaggeration={exag} ground={skin === "relief" ? groundView : null}
                  spawns={markers} mass={hidden.has("grp:mass") ? [] : edits.mass} bridges={edits.bridges} seed={edits.seed}
                  decor={decor} cuts={edits.cuts} highlights={aiPreview ? [...highlights, ...aiPreview.map((m) => [m.x, m.z, AI_STYLE[m.kind].r, AI_STYLE[m.kind].color] as [number, number, number, string])] : highlights} lines={lines} snapshotRef={snapshot}
                  brush={brush} drag={drag} orbit={tool === "orbit"} onPointer={onPointer}
                  cameraRequest={camReq} onCamera={() => setTouring(false)} />
              </Suspense>
            ) : view === "3d" ? <div className="bar indeterminate" style={{ margin: 20 }}><i /></div> : (
              <div className="map-stage studio-2d" ref={stage}
                onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); onPointer("down", toWorld(e)); }}
                onPointerMove={(e) => { const q = toWorld(e); setCursor(q); if (e.buttons & 1) onPointer("move", q); }}
                onPointerUp={(e) => onPointer("up", toWorld(e))}
                role="application" aria-label={t("Mapa em 2D")}>
                {image2d ? <img src={image2d} alt="" draggable={false} /> : <div className="bar indeterminate" style={{ margin: 20 }}><i /></div>}
                <svg viewBox={`0 0 ${grid} ${grid}`}>
                  {snap >= 8 && <><defs><pattern id="snapgrid" width={snap} height={snap} patternUnits="userSpaceOnUse"><path d={`M ${snap} 0 L 0 0 0 ${snap}`} fill="none" stroke="#ffffff" strokeOpacity={0.14} strokeWidth={1} /></pattern></defs><rect width={grid} height={grid} fill="url(#snapgrid)" pointerEvents="none" /></>}
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
                  {aiPreview?.map((m, i) => <circle key={`ai${i}`} cx={m.x} cy={m.z} r={AI_STYLE[m.kind].r} fill="none" stroke={AI_STYLE[m.kind].color} strokeWidth={2.5} strokeOpacity={0.9} />)}
                  {highlights.map(([x, z, r], i) => <circle key={`h${i}`} cx={x} cy={z} r={r} fill="none" stroke="#ffd166" strokeWidth={3} />)}
                  {cursor && brush && <circle cx={cursor[0]} cy={cursor[1]} r={brush.shape === "circle" ? brush.radius : 10} fill="none" stroke={brush.color} strokeWidth={3} />}
                  {drag && tool === "decor-row" && <line x1={drag.a[0]} y1={drag.a[1]} x2={drag.b[0]} y2={drag.b[1]} stroke="#7fae6b" strokeWidth={4} strokeDasharray="6 6" />}
                  {ruler && tool === "ruler" && <line x1={ruler.a[0]} y1={ruler.a[1]} x2={ruler.b[0]} y2={ruler.b[1]} stroke="#ffd166" strokeWidth={4} strokeDasharray="14 8" />}
                </svg>
              </div>
            )}
            <div className="viewport-overlay">
              <span className="vp-chip"><Icon name={tool === "select" ? "near_me" : "edit"} size={15} /> {hintOf(tool).split(".")[0]}.</span>
              {selIds.length > 0 && <span className="vp-chip"><Icon name="select_all" size={15} /> {selIds.length > 1 ? t("{n} selecionados", { n: selIds.length }) : t("1 selecionado")}</span>}
              {doc.symmetry !== "none" && <span className="vp-chip"><Icon name="flip" size={15} /> {t(SYMMETRY_LABEL[doc.symmetry])}</span>}
              {snap > 0 && <button className="vp-chip" onClick={() => setSnap(0)} title={t("Desligar o encaixe (N)")}><Icon name="grid_4x4" size={15} /> {t("Grade de {n}", { n: snap })}</button>}
              {touring && <button className="vp-chip" onClick={() => { setCamReq({ mode: "free", n: Date.now() }); setTouring(false); }}><Icon name="stop" size={15} /> {t("Parar o passeio")}</button>}
              {skin === "relief" && <span className="vp-chip faint" title={t("No jogo o chão usa as texturas do terreno base (troque em Chão)")}><Icon name="info" size={15} /> {t("Cores da prévia")}</span>}
            </div>
            {aiPreview && (
              <div className="build-key ai-key">
                <b><Icon name="smart_toy" size={15} /> {t("Marcadores da IA ({n})", { n: aiPreview.length })}</b>
                {(Object.keys(AI_STYLE) as (keyof typeof AI_STYLE)[]).map((k) => { const n = aiPreview.filter((m) => m.kind === k).length; return n ? <span key={k}><i style={{ background: AI_STYLE[k].color }} /> {t(AI_STYLE[k].label)} <b>{n}</b></span> : null; })}
                {doc.aiMarkers === false && <span style={{ color: "var(--warn)" }}>{t("Desligados nas propriedades: o mapa vai sem eles.")}</span>}
              </div>
            )}
            {skin === "build" && (
              <div className="build-key">
                <b><Icon name="foundation" size={15} /> {t("Construção")}</b>
                {BUILD_KEY.map((k) => <span key={k.color}><i style={{ background: k.color }} /> {t(k.label)}</span>)}
                <span className="faint">{t("Linhas escuras: curvas de nível a cada 8 de altura.")}</span>
              </div>
            )}
            {ruler?.m && tool === "ruler" && (
              <div className="ruler-card">
                <b><Icon name="straighten" size={15} /> {t("Régua")}</b>
                <span>{t("Em linha reta: {d}", { d: fmtDist(ruler.m.straight) })}</span>
                <span>{ruler.m.walk === null ? t("A pé: sem caminho (água, encosta ou bloqueio)") : t("A pé: {d}", { d: fmtDist(ruler.m.walk) })}</span>
                {ruler.m.times.map((x) => <span key={x.id} className="row" style={{ justifyContent: "space-between", gap: 10 }}><span className="muted">{t(x.label)}</span><b>{fmtTime(x.seconds)}</b></span>)}
              </div>
            )}
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
                    {typeof lastBuild.aiMarkers === "number" && lastBuild.aiMarkers > 0 ? <>{t("{n} marcadores para a IA.", { n: lastBuild.aiMarkers })} </> : null}
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
        { icon: "file_copy", label: t("Copiar"), shortcut: "Ctrl+C", onClick: () => doCopy() },
        { icon: "select_all", label: t("Selecionar iguais"), shortcut: "Ctrl+Shift+A", onClick: doSimilar },
        ...(doc.symmetry !== "none" ? [{ icon: "flip", label: t("Aplicar simetria"), shortcut: "Ctrl+M", onClick: doSymmetrize }] : []),
        { icon: locked.has(ctx.id) ? "lock_open" : "lock", label: locked.has(ctx.id) ? t("Destravar") : t("Travar"), onClick: () => toggleLayer("locked", ctx.id) },
        { icon: "delete", label: t("Excluir"), shortcut: "Del", danger: true, onClick: doDelete },
      ] as CtxItem[]} />}
      {assist === "sketch" && <SketchModal players={edits.spawns.length} onClose={() => setAssist(null)} onApply={applySketch} />}
      {assist === "image" && <ImportHeightModal water={hasWater ? water : 0} onClose={() => setAssist(null)} onApply={applyImage} />}
      {assist === "balance" && balance && <BalanceModal result={balance} travel={travelTable()} onClose={() => setAssist(null)} onAddMass={(pts) => { setEdits((e) => ({ ...e, mass: [...e.mass, ...pts] })); setAssist(null); toast("ok", t("{n} ponto(s) de massa colocados. Ctrl+Z desfaz.", { n: pts.length })); }} />}
      {assist === "layout" && <SpawnLayoutModal grid={grid} players={edits.spawns.length || (doc.world?.players ?? 4)} image={relief3d && heights ? reliefImage(relief3d, heights, water, hasWater, doc.world?.biome ?? "temperate", 256) : null} onClose={() => setAssist(null)} onApply={applyLayout} />}
      {assist === "xray" && xray && <XRayModal stats={xray.st} checks={xray.checks} shares={xray.shares} baseMass={doc.economy.baseMass} contested={contested.length}
        onContested={() => { setSel(new Set(contested.map((i) => `mass:${i}`))); setAssist(null); }} onClose={() => setAssist(null)} onBuildLayer={() => { setSkin("build"); setAssist(null); }} />}
      {assist === "keys" && <KeysModal onClose={() => setAssist(null)} />}
      {assist === "timeline" && p.meta && <TimelineModal<MapDoc> id={p.meta.id} current={doc} render={renderVersion} onClose={() => setAssist(null)} onRestore={(d) => p.replace(migrateMap(d))} />}
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

/** Ferramentas da paisagem em volta: povoar com decorações e limpar. */
function RingTools({ sculpted, props, onFill, onClearProps, onClearSculpt }: {
  sculpted: boolean; props: number; onFill: (k: RingFill, density: number) => void; onClearProps: () => void; onClearSculpt: () => void;
}) {
  const [kind, setKind] = useState<RingFill>("forest");
  const [dens, setDens] = useState(1);
  return (
    <div className="col" style={{ gap: 6, width: "100%" }}>
      <b className="small">{t("Editar a paisagem")}</b>
      <span className="faint small">{t("Os pincéis de relevo e as decorações também funcionam fora da borda do mapa: esculpa montanhas, abra vales e coloque prédios na paisagem.")}</span>
      <div className="row" style={{ gap: 6 }}>
        <select className="select dense" style={{ flex: 1 }} value={kind} onChange={(e) => setKind(e.target.value as RingFill)} aria-label={t("Povoar com")}>
          <option value="forest">{t("Mata")}</option>
          <option value="rocks">{t("Rochas")}</option>
          <option value="city">{t("Cidade (prédios)")}</option>
          <option value="ruins">{t("Ruínas e destroços")}</option>
        </select>
        <select className="select dense" value={String(dens)} onChange={(e) => setDens(Number(e.target.value))} aria-label={t("Densidade")}>
          <option value="0.5">{t("Pouco")}</option>
          <option value="1">{t("Normal")}</option>
          <option value="2">{t("Muito")}</option>
        </select>
      </div>
      <button className="btn sm" onClick={() => onFill(kind, dens)}><Icon name="forest" size={16} /> {t("Povoar a paisagem")}</button>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn sm text" disabled={!props} onClick={onClearProps}><Icon name="delete_sweep" size={16} /> {t("Tirar as decorações ({n})", { n: props })}</button>
        <button className="btn sm text" disabled={!sculpted} onClick={onClearSculpt}><Icon name="layers_clear" size={16} /> {t("Desfazer a escultura")}</button>
      </div>
    </div>
  );
}
