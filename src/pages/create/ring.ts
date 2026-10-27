// Paisagem em volta do mapa: o que aparece além da borda jogável (montanhas, morros, abismo…).
// A base é calculada como no jogo (cp_world.ring_height); por cima vem a camada do pincel da
// paisagem, editável à mão, que só vale FORA do mapa e some suavemente na borda (sem degrau na
// emenda com o chão jogável). Decorações (prédios, árvores, rochas) também podem ficar lá fora.
import { fbm } from "../studio/biome.ts";
import type { PlacedProp } from "../studio/mapEdit";
import { decodeLayer, encodeLayer } from "./worldgen.ts";

/** pontos por lado da camada do pincel da paisagem (cobre o mapa e a margem) */
export const RING_N = 192;
/** quanto a camada pode subir ou descer (unidades do mundo) */
export const RING_MIN = -220;
export const RING_MAX = 420;
/** distância da borda em que a camada entra inteira (antes disso, mistura até zero na borda) */
const FADE = 40;

/** Largura da paisagem em volta (a mesma do construtor de mapas). */
export const ringMargin = (grid: number) => (grid <= 1024 ? 256 : 384);

export interface RingLayer { n: number; margin: number; data: Float32Array }

export type RingMode = "raise" | "lower" | "smooth" | "flatten" | "noise";

const smooth = (t: number) => t * t * (3 - 2 * t);

export function decodeRing(b64: string | null | undefined, n: number | undefined, grid: number): RingLayer | null {
  if (!b64 || !n) return null;
  return { n, margin: ringMargin(grid), data: decodeLayer(b64, (n + 1) ** 2) };
}
export const encodeRing = (l: RingLayer) => encodeLayer(l.data);
export const emptyRing = (grid: number): RingLayer => ({ n: RING_N, margin: ringMargin(grid), data: new Float32Array((RING_N + 1) ** 2) });

/** O ponto está fora da área jogável (mas dentro da paisagem)? */
export function inRing(grid: number, x: number, z: number): boolean {
  const m = ringMargin(grid);
  const out = x < 0 || z < 0 || x > grid || z > grid;
  return out && x >= -m && z >= -m && x <= grid + m && z <= grid + m;
}

/** Valor da camada no ponto (bilinear), já com a mistura na borda. */
export function ringDelta(L: RingLayer | null | undefined, grid: number, x: number, z: number): number {
  if (!L) return 0;
  const cx = Math.max(0, Math.min(grid, x)), cz = Math.max(0, Math.min(grid, z));
  const d = Math.hypot(x - cx, z - cz);
  if (d <= 0) return 0;
  const ext = grid + 2 * L.margin, n = L.n, w = n + 1;
  const fx = Math.max(0, Math.min(n, ((x + L.margin) / ext) * n)), fz = Math.max(0, Math.min(n, ((z + L.margin) / ext) * n));
  const i0 = Math.min(n - 1, Math.floor(fx)), j0 = Math.min(n - 1, Math.floor(fz)), u = fx - i0, v = fz - j0, k = j0 * w + i0;
  const D = L.data;
  const val = (D[k] * (1 - u) + D[k + 1] * u) * (1 - v) + (D[k + w] * (1 - u) + D[k + w + 1] * u) * v;
  return val * smooth(Math.min(1, d / FADE));
}

/** Altura da paisagem (sem a camada) — a mesma conta do jogo. `inner` = altura dentro do mapa. */
export function ringBase(inner: (x: number, z: number) => number, grid: number, rise: number, x: number, z: number): number {
  const cx = Math.max(0, Math.min(grid, x)), cz = Math.max(0, Math.min(grid, z));
  const base = inner(cx, cz), d = Math.hypot(x - cx, z - cz);
  if (d <= 0) return base;
  const t = Math.min(1, d / 220), k = t * t * (3 - 2 * t);
  const big = 0.55 + 0.45 * fbm(x / 260, z / 260, 4242);
  const crag = 1 - Math.abs(fbm(x / 70, z / 70, 4249));
  return base + rise * k * big + 22 * k * crag * crag;
}

/** Altura final em qualquer ponto (dentro do mapa, a do mapa; fora, paisagem + camada). */
export function ringHeight(inner: (x: number, z: number) => number, grid: number, rise: number, L: RingLayer | null | undefined, x: number, z: number): number {
  return ringBase(inner, grid, rise, x, z) + ringDelta(L, grid, x, z);
}

/** Uma pincelada na paisagem. `height` = altura final de agora (para nivelar e suavizar). */
export function ringDab(L: RingLayer, grid: number, mode: RingMode, cx: number, cz: number, rad: number, strength: number,
  height: (x: number, z: number) => number, target?: number): boolean {
  const n = L.n, w = n + 1, ext = grid + 2 * L.margin, step = ext / n;
  const toI = (v: number) => (v + L.margin) / step;
  const i0 = Math.max(0, Math.ceil(toI(cx - rad))), i1 = Math.min(n, Math.floor(toI(cx + rad)));
  const j0 = Math.max(0, Math.ceil(toI(cz - rad))), j1 = Math.min(n, Math.floor(toI(cz + rad)));
  let changed = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = -L.margin + i * step, z = -L.margin + j * step;
    // dentro do mapa a camada não vale: não gasta pincelada lá
    if (x > 0 && z > 0 && x < grid && z < grid) continue;
    const d = Math.hypot(x - cx, z - cz) / rad;
    if (d >= 1) continue;
    const fall = (1 - d * d) ** 2;
    const k = j * w + i;
    let delta = 0;
    if (mode === "raise") delta = strength * 0.5 * fall;
    else if (mode === "lower") delta = -strength * 0.5 * fall;
    else if (mode === "flatten" && target !== undefined) delta = (target - height(x, z)) * 0.35 * fall;
    else if (mode === "smooth") {
      let sum = 0;
      for (const [dx, dz] of [[step, 0], [-step, 0], [0, step], [0, -step]]) sum += height(x + dx, z + dz);
      delta = (sum / 4 - height(x, z)) * 0.5 * fall;
    } else if (mode === "noise") delta = fbm(x / 40, z / 40, 977) * strength * 0.4 * fall;
    if (!delta) continue;
    L.data[k] = Math.max(RING_MIN, Math.min(RING_MAX, L.data[k] + delta));
    changed = true;
  }
  return changed;
}

// ------------------------------------------------------------------ povoar a paisagem

export type RingFill = "forest" | "rocks" | "city" | "ruins";

/** Escolhe decorações do catálogo para encher a paisagem em volta. */
export function ringScatter(grid: number, kind: RingFill, pools: { trees: string[]; rocks: string[]; buildings: string[]; wrecks: string[] }, density: number,
  height: (x: number, z: number) => number, water: number | null, seed = 1): PlacedProp[] {
  const pool = kind === "forest" ? pools.trees : kind === "rocks" ? pools.rocks : kind === "city" ? pools.buildings : [...pools.wrecks, ...pools.buildings.slice(0, 12), ...pools.rocks.slice(0, 6)];
  if (!pool.length) return [];
  const m = ringMargin(grid);
  // cidades e ruínas: quarteirões em grade; mata e rochas: espalhadas com manchas
  const spacing = (kind === "city" ? 34 : kind === "ruins" ? 30 : kind === "forest" ? 18 : 28) / Math.max(0.25, Math.min(3, density));
  let s = seed >>> 0 || 1;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out: PlacedProp[] = [];
  for (let z = -m + spacing / 2; z < grid + m; z += spacing) for (let x = -m + spacing / 2; x < grid + m; x += spacing) {
    const jx = x + (rnd() - 0.5) * spacing * (kind === "city" ? 0.25 : 0.9);
    const jz = z + (rnd() - 0.5) * spacing * (kind === "city" ? 0.25 : 0.9);
    if (!inRing(grid, jx, jz)) continue;
    // longe da borda jogável (não tampa a visão de quem joga perto dela)
    const cx = Math.max(0, Math.min(grid, jx)), cz = Math.max(0, Math.min(grid, jz));
    if (Math.hypot(jx - cx, jz - cz) < 24) continue;
    const patch = fbm(jx / 120, jz / 120, kind === "forest" ? 31 : 57);
    if (kind !== "city" && patch < -0.05) continue;
    const y = height(jx, jz);
    if (water !== null && y < water + 1) continue;
    const slope = Math.abs(height(jx + 4, jz) - height(jx - 4, jz)) + Math.abs(height(jx, jz + 4) - height(jx, jz - 4));
    if (slope > (kind === "city" ? 6 : 14)) continue;
    const bp = pool[Math.floor(rnd() * pool.length)];
    const yaw = kind === "city" ? [0, 90, 180, 270][Math.floor(rnd() * 4)] : Math.round(rnd() * 360);
    out.push({ bp, x: Math.round(jx * 10) / 10, z: Math.round(jz * 10) / 10, yaw, scale: Math.round((0.85 + rnd() * 0.4) * 100) / 100 });
  }
  return out;
}

/** A decoração está na paisagem em volta (fora da área jogável)? */
export const isRingProp = (grid: number, p: { x: number; z: number }) => p.x < 0 || p.z < 0 || p.x > grid || p.z > grid;
