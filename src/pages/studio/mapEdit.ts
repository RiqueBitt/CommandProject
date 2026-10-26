// Edição do mapa no cliente: as mesmas operações que o toolkit aplica ao heightfield
// (sc2maps.reshape_hfield), refeitas sobre o relevo amostrado para a prévia 2D/3D.
import type { LayerSet } from "../../lib/types";
import { t } from "../../lib/i18n";

export type Pt = [number, number];
export type Rect = [number, number, number, number]; // x0, x1, z0, z1 (formato das passagens)
export type Mode = "set" | "raise" | "lower";
export type SculptOp =
  | ["disc", number, number, number, number, Mode]
  | ["cone", number, number, number, number, Mode]
  | ["rect", number, number, number, number, number, Mode]
  | ["ramp", number, number, number, number, number, number, Mode];

export type ReliefKind = "hill" | "valley" | "plateau" | "flatten" | "ramp";
export interface Relief { kind: ReliefKind; op: SculptOp }

/** Decoração colocada pelo jogador. */
export interface PlacedProp { bp: string; x: number; z: number; yaw: number; scale: number; gen?: boolean }

/** Camada de textura do chão (de qualquer mapa do jogo). */
export interface GroundLayer { map: string; name: string; d: string; n?: string | null; s?: string | null; slotD: number; slotN: number; slotS: number }

export interface Edits {
  spawns: Pt[];
  mass: Pt[];
  bridges: Rect[];
  seed: Pt | null;
  relief: Relief[];
  /** decorações novas */
  props: PlacedProp[];
  /** áreas onde as decorações do terreno são retiradas: [x, z, raio] */
  cuts: [number, number, number][];
  /** camada original (caminho _d) → camada que entra no lugar */
  reskin: Record<string, GroundLayer>;
}
export const EMPTY_EDITS: Edits = { spawns: [], mass: [], bridges: [], seed: null, relief: [], props: [], cuts: [], reskin: {} };

/** Tipo visual da decoração no editor (a partir da pasta do blueprint). */
export type DecorKind = "tree" | "rock" | "building" | "wreck" | "other";
export function decorKind(bp: string): DecorKind {
  const c = bp.toLowerCase().split("/")[2] ?? "";
  if (c.startsWith("tree")) return "tree";
  if (c.startsWith("rock")) return "rock";
  if (c.startsWith("wreck") || c.startsWith("defaultwreck") || c.startsWith("debris")) return "wreck";
  if (["buildings", "structures", "warehouses", "cranes", "barges", "lights", "crates"].includes(c)) return "building";
  return "other";
}

/** Teste rápido "o ponto está dentro de algum corte?" (grade de 64 unidades: milhares de
 *  decorações × centenas de cortes sem travar a edição). */
export function cutTester(cuts: [number, number, number][]): (x: number, z: number) => boolean {
  if (!cuts.length) return () => false;
  const S = 64, cells = new Map<number, [number, number, number][]>();
  for (const c of cuts) {
    const [x, z, r] = c;
    for (let i = Math.floor((x - r) / S); i <= Math.floor((x + r) / S); i++)
      for (let j = Math.floor((z - r) / S); j <= Math.floor((z + r) / S); j++) {
        const k = i * 4096 + j;
        (cells.get(k) ?? cells.set(k, []).get(k)!).push(c);
      }
  }
  return (x, z) => {
    const list = cells.get(Math.floor(x / S) * 4096 + Math.floor(z / S));
    return !!list && list.some(([cx, cz, r]) => (x - cx) ** 2 + (z - cz) ** 2 <= r * r);
  };
}

/** Uma troca de camada vira o mapeamento de caminhos que o toolkit aplica (d, n e s quando cabem). */
export function reskinPaths(old: GroundLayer, neo: GroundLayer): Record<string, string> {
  const out: Record<string, string> = {};
  if (neo.d.length < old.slotD) out[old.d] = neo.d;
  if (old.n && neo.n && neo.n.length < old.slotN) out[old.n] = neo.n;
  if (old.s && neo.s && neo.s.length < old.slotS) out[old.s] = neo.s;
  return out;
}

/** A camada nova cabe no lugar da antiga (o caminho precisa ser mais curto que o espaço)? */
export const layerFits = (old: GroundLayer, neo: GroundLayer) => neo.d.length < old.slotD && neo.d !== old.d;

export const RELIEF_LABEL: Record<ReliefKind, string> = {
  hill: "Morro", valley: "Vale", plateau: "Planalto", flatten: "Área plana", ramp: "Rampa",
};

/** Relevo amostrado vindo do toolkit (`terrain3d`). */
export interface Relief3D {
  size: number;      // amostras por lado - 1
  grid: number;      // tamanho do mapa em células do jogo (1024)
  heights: Float32Array; // (size+1)² alturas em unidades do mundo
  waterLevel: number;
  yMin: number;
  yMax: number;
  texture: string | null;
}

export function decodeHeights(b64: string, scale: number): Float32Array {
  const bin = atob(b64);
  const n = bin.length >> 1;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (bin.charCodeAt(i * 2) | (bin.charCodeAt(i * 2 + 1) << 8)) * scale;
  return out;
}

/** Altura (bilinear) no ponto do mundo x, z. */
export function heightAt(r: Pick<Relief3D, "size" | "grid">, h: Float32Array, x: number, z: number) {
  const s = r.size, k = s / r.grid;
  const fx = Math.max(0, Math.min(s, x * k)), fz = Math.max(0, Math.min(s, z * k));
  const i = Math.min(s - 1, Math.floor(fx)), j = Math.min(s - 1, Math.floor(fz));
  const u = fx - i, v = fz - j, w = s + 1;
  const a = h[j * w + i], b = h[j * w + i + 1], c = h[(j + 1) * w + i], d = h[(j + 1) * w + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

const clampY = (y: number) => Math.max(0, Math.min(65535 / 128, y));

/** Aplica as operações de relevo (mesma semântica do toolkit) sobre uma cópia das alturas. */
export function applyRelief(r: Pick<Relief3D, "size" | "grid">, base: Float32Array, relief: Relief[], rugged: boolean, water: number) {
  const h = base.slice();
  const s = r.size, w = s + 1, step = r.grid / s;
  const put = (idx: number, y: number, mode: Mode) => {
    y = clampY(y);
    if (mode === "raise" && y <= h[idx]) return;
    if (mode === "lower" && y >= h[idx]) return;
    h[idx] = y;
  };
  const span = (a: number, b: number) => [Math.max(0, Math.ceil(a / step)), Math.min(s, Math.floor(b / step))];
  for (const { op } of relief) {
    if (op[0] === "disc" || op[0] === "cone") {
      const [, cx, cz, rad, y, mode] = op;
      const [i0, i1] = span(cx - rad, cx + rad), [j0, j1] = span(cz - rad, cz + rad);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i * step - cx, j * step - cz);
        if (d > rad) continue;
        const idx = j * w + i;
        put(idx, op[0] === "disc" ? y : h[idx] + (y - h[idx]) * (1 - d / rad), mode);
      }
    } else {
      const [, x0, z0, x1, z1] = op;
      const ax0 = Math.min(x0, x1), ax1 = Math.max(x0, x1), az0 = Math.min(z0, z1), az1 = Math.max(z0, z1);
      const [i0, i1] = span(ax0, ax1 - 1), [j0, j1] = span(az0, az1 - 1);
      const alongX = ax1 - ax0 >= az1 - az0;
      const len = Math.max(1, (alongX ? ax1 - ax0 : az1 - az0) - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const idx = j * w + i;
        if (op[0] === "rect") put(idx, op[5], op[6]);
        else {
          const t = Math.max(0, Math.min(1, ((alongX ? i * step : j * step) - (alongX ? ax0 : az0)) / len));
          put(idx, op[5] + (op[6] - op[5]) * t, op[7]);
        }
      }
    }
  }
  if (rugged) {
    // prévia aproximada de ruggedize_edges (borda rochosa de 40 células, só em terra seca)
    const margin = 40, rise = 24, amp = 14, taper = 5;
    for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
      const x = i * step, z = j * step;
      const d = Math.min(x, z, r.grid - x, r.grid - z);
      const idx = j * w + i;
      if (d >= margin || h[idx] <= water + 4) continue;
      const rough = Math.min(1, (margin - d) / taper);
      const n = Math.sin(x * 0.071 + Math.sin(z * 0.043) * 2) * Math.cos(z * 0.063 + Math.sin(x * 0.037) * 2);
      h[idx] = clampY(h[idx] + rise + amp * rough * (0.5 + 0.5 * n));
    }
  }
  return h;
}

/** Média das alturas dentro do disco (para "Área plana": nivela na média, como flatten_regions). */
export function meanInDisc(r: Pick<Relief3D, "size" | "grid">, h: Float32Array, cx: number, cz: number, rad: number) {
  const s = r.size, w = s + 1, step = r.grid / s;
  let sum = 0, n = 0;
  for (let j = Math.max(0, Math.ceil((cz - rad) / step)); j <= Math.min(s, Math.floor((cz + rad) / step)); j++)
    for (let i = Math.max(0, Math.ceil((cx - rad) / step)); i <= Math.min(s, Math.floor((cx + rad) / step)); i++)
      if (Math.hypot(i * step - cx, j * step - cz) <= rad) { sum += h[j * w + i]; n++; }
  return n ? sum / n : heightAt(r, h, cx, cz);
}

/** Centro e raio aproximados de uma edição (para apagar e desenhar no 2D). */
export function reliefShape(op: SculptOp): { c: Pt; r: number; rect?: Rect } {
  if (op[0] === "disc" || op[0] === "cone") return { c: [op[1], op[2]], r: op[3] };
  const x0 = Math.min(op[1], op[3]), x1 = Math.max(op[1], op[3]), z0 = Math.min(op[2], op[4]), z1 = Math.max(op[2], op[4]);
  return { c: [(x0 + x1) / 2, (z0 + z1) / 2], r: Math.hypot(x1 - x0, z1 - z0) / 2, rect: [x0, x1, z0, z1] };
}

export const round1 = (v: number) => Math.round(v * 10) / 10;

// ------------------------------------------------------------------ base em branco e chão limpo

export type GroundBiome = "temperate" | "desert" | "snow" | "volcanic";
/** Lado do mapa em branco, em unidades do mundo (1024 = 20 km no jogo). */
export type BlankSize = number;
/** Terrenos do jogo usados por baixo de um mapa em branco, no tamanho deles: tudo vira um plano
 *  liso. Os outros tamanhos usam o de 2048 redimensionado na hora de gerar (mapa gigante). */
export const BLANK_BASES: Record<number, string> = { 512: "SC2_MP_004", 1024: "SC2_MP_007", 2048: "SC2_MP_304" };
/** Terreno usado (redimensionado) nos tamanhos que o jogo não tem. */
export const GIANT_BASE = "SC2_MP_304";
/** Maior lado aceito (80 km); o jogo original vai até 2048 (40 km). */
export const MAX_MAP_SIZE = 4096;
/** Tamanhos oferecidos: de 512 em 512 (a máscara de água do jogo tem 512 texels de lado). */
export const BLANK_SIZES: number[] = Array.from({ length: MAX_MAP_SIZE / 512 }, (_, i) => (i + 1) * 512);
/** Terreno do jogo por baixo de um mapa em branco deste tamanho. */
export const blankTerrain = (size: number) => BLANK_BASES[size] ?? GIANT_BASE;
/** O tamanho existe no jogo (sem redimensionar)? */
export const nativeBlank = (size: number) => !!BLANK_BASES[size];
/** Altura do plano do mapa em branco (dá espaço para cavar vales e subir montanhas). */
export const BLANK_Y = 60;
/** Nível da água do mapa em branco (a lâmina d'água do terreno base sobe até ele); 0 = sem água. */
export const blankWater = (size: number) => (size <= 512 ? 0 : 40);
/** Quilômetros de lado no jogo (1024 unidades = 20 km). */
export const mapKm = (size: number) => Math.round((size * 20) / 1024);
export function blankLabel(size: number) {
  const v = { size, km: mapKm(size) };
  return size <= 512 ? t("Pequeno ({size} × {size} · {km} km)", v)
    : size <= 1024 ? t("Padrão ({size} × {size} · {km} km)", v)
    : size <= 2048 ? t("Grande ({size} × {size} · {km} km)", v)
    : t("Gigante ({size} × {size} · {km} km)", v);
}
/** Tamanho de um mapa em branco pelo terreno base (projetos sem `mapSize`). */
export function blankSizeOf(terrain: string | null): BlankSize | null {
  const hit = Object.keys(BLANK_BASES).find((k) => BLANK_BASES[Number(k)] === terrain);
  return hit ? Number(hit) : null;
}
/** Lado do mapa em branco de um projeto. */
export const docMapSize = (d: { mapSize?: number | null; terrain: string | null }) => d.mapSize ?? blankSizeOf(d.terrain) ?? 1024;

/** Preferência de textura por bioma (o primeiro nome que existir e couber ganha). */
const GROUND_PREF: Record<GroundBiome, RegExp[]> = {
  temperate: [/mp_007_grass01/, /mp_002_grass01/, /mp_003_grass01/, /u105_grass01/, /u06_grass/, /grass/, /moss|lawn|field/],
  desert: [/i01_sand_001a/, /u05_sand01/, /u105_sand0/, /mp_203_sand01/, /sand/, /dune|desert/],
  snow: [/mp_002_snow01/, /mp_004_snow01/, /mp_006_snow0/, /mp_103_snow/, /snow|ice|frost/],
  volcanic: [/mp_303_ground/, /lavarock/, /dirt_00/, /u05_dirt01/, /ash|lava|burnt|scorch|dirt|mud/],
};

/** Conjuntos de textura para o chão inteiro do bioma, do preferido ao último (a ponte usa o
 *  primeiro que cabe em todos os lugares do terreno base). `chosen` (difusa) vem na frente. */
export function groundCandidates(layers: LayerSet[], biome: GroundBiome, chosen: string | null = null) {
  const seen = new Set<string>();
  const uniq = layers.filter((l) => { const k = l.d.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const out: LayerSet[] = [];
  const push = (l: LayerSet | undefined) => { if (l && !out.includes(l)) out.push(l); };
  if (chosen) push(uniq.find((l) => l.d.toLowerCase() === chosen.toLowerCase()));
  for (const re of GROUND_PREF[biome]) {
    // dentro do mesmo padrão, os caminhos mais curtos cabem em mais lugares
    for (const l of uniq.filter((x) => re.test(x.d.toLowerCase())).sort((a, b) => a.d.length - b.d.length)) push(l);
  }
  return out.slice(0, 10);
}
export const groundSpec = (c: LayerSet[]) => c.map((l) => ({ d: l.d, ...(l.n ? { n: l.n } : {}), ...(l.s ? { s: l.s } : {}) }));
