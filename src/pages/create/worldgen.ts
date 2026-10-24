// Gerador de mundos por semente: relevo, montanhas, lagos, rios, cânions, florestas e estruturas.
// Tudo é determinístico (mesma semente = mesmo mapa) e vira objetos editáveis no editor: as formas
// do terreno ficam na lista "Formas do terreno", as bases e decorações nas listas de sempre.
// O relevo final é calculado aqui e enviado ao toolkit como uma camada (height_delta), então a
// prévia e o mapa gerado são iguais.

import type { PlacedProp, Pt } from "../studio/mapEdit";

// ------------------------------------------------------------------ aleatório e ruído

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const noiseCache = new Map<number, (x: number, y: number) => number>();

/** Ruído simplex 2D em [-1, 1] para uma semente. */
export function simplex(seed: number): (x: number, y: number) => number {
  const hit = noiseCache.get(seed);
  if (hit) return hit;
  const r = rng(seed);
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const fn = (xin: number, yin: number) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const g = GRAD[p[ii + p[jj]] & 7]; t0 *= t0; n += t0 * t0 * (g[0] * x0 + g[1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const g = GRAD[p[ii + i1 + p[jj + j1]] & 7]; t1 *= t1; n += t1 * t1 * (g[0] * x1 + g[1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const g = GRAD[p[ii + 1 + p[jj + 1]] & 7]; t2 *= t2; n += t2 * t2 * (g[0] * x2 + g[1] * y2); }
    return 70 * n;
  };
  noiseCache.set(seed, fn);
  return fn;
}

export function fbm(n: (x: number, y: number) => number, x: number, y: number, oct = 5) {
  let a = 0.5, f = 1, s = 0, norm = 0;
  for (let o = 0; o < oct; o++) { s += a * n(x * f, y * f); norm += a; a *= 0.5; f *= 2.03; }
  return s / norm;
}

/** Ruído "de cristas" em [0, 1]: picos afiados, bom para montanhas. */
export function ridged(n: (x: number, y: number) => number, x: number, y: number, oct = 4) {
  let a = 0.5, f = 1, s = 0, norm = 0;
  for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(n(x * f, y * f)); s += a * v * v; norm += a; a *= 0.5; f *= 2.1; }
  return s / norm;
}

const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ------------------------------------------------------------------ simetria

export type Symmetry = "none" | "mirror-x" | "mirror-z" | "diag" | "rot2" | "rot4";
export const SYMMETRY_LABEL: Record<Symmetry, string> = {
  none: "Sem simetria", "mirror-x": "Espelho (esquerda ↔ direita)", "mirror-z": "Espelho (cima ↔ baixo)",
  diag: "Espelho na diagonal", rot2: "Giro de 180°", rot4: "Giro de 90° (4 lados)",
};

/** Transformações do grupo de simetria: ponto → ponto e a matriz 2×2 linear [a, b, c, d]. */
export function symmetryOps(sym: Symmetry, grid: number): { pt: (p: Pt) => Pt; m: [number, number, number, number] }[] {
  const G = grid;
  const id = { pt: (p: Pt): Pt => p, m: [1, 0, 0, 1] as [number, number, number, number] };
  switch (sym) {
    case "mirror-x": return [id, { pt: ([x, z]) => [G - x, z], m: [-1, 0, 0, 1] }];
    case "mirror-z": return [id, { pt: ([x, z]) => [x, G - z], m: [1, 0, 0, -1] }];
    case "diag": return [id, { pt: ([x, z]) => [z, x], m: [0, 1, 1, 0] }];
    case "rot2": return [id, { pt: ([x, z]) => [G - x, G - z], m: [-1, 0, 0, -1] }];
    case "rot4": return [
      id,
      { pt: ([x, z]) => [G - z, x], m: [0, -1, 1, 0] },
      { pt: ([x, z]) => [G - x, G - z], m: [-1, 0, 0, -1] },
      { pt: ([x, z]) => [z, G - x], m: [0, 1, -1, 0] },
    ];
    default: return [id];
  }
}

/** Ângulo (graus) transformado pela matriz linear (para o giro das decorações). */
export function mapYaw(yaw: number, m: [number, number, number, number]) {
  const a = (yaw * Math.PI) / 180;
  const dx = Math.cos(a), dz = Math.sin(a);
  const nx = m[0] * dx + m[1] * dz, nz = m[2] * dx + m[3] * dz;
  return Math.round(((Math.atan2(nz, nx) * 180) / Math.PI + 360) % 360);
}

// ------------------------------------------------------------------ formas do terreno

export type FeatureKind = "mountain" | "hill" | "ridge" | "plateau" | "crater" | "lake" | "river" | "canyon" | "dunes" | "island" | "pad" | "pass";

export interface Feature {
  id: string;
  kind: FeatureKind;
  /** centro (1 ponto) ou linha (rio, cordilheira, cânion, passagem) */
  pts: Pt[];
  /** raio ou meia largura */
  r: number;
  /** altura (montanha, morro, planalto, ilha, dunas) ou profundidade (lago, rio, cânion, cratera) */
  h: number;
  /** 0 a 1: quanto detalhe/irregularidade */
  rough: number;
  seed: number;
  /** matriz que leva o deslocamento do mundo para o espaço da forma (simetria exata) */
  m?: [number, number, number, number];
  name?: string;
  /** criada pelo gerador (some ao gerar de novo) */
  gen?: boolean;
}

export const FEATURE_LABEL: Record<FeatureKind, string> = {
  mountain: "Montanha", hill: "Colina", ridge: "Cordilheira", plateau: "Planalto", crater: "Cratera", lake: "Lago", river: "Rio",
  canyon: "Cânion", dunes: "Dunas", island: "Ilha", pad: "Área plana", pass: "Passagem",
};
export const FEATURE_ICON: Record<FeatureKind, string> = {
  mountain: "landscape", hill: "filter_hdr", ridge: "terrain", plateau: "view_agenda", crater: "radio_button_unchecked", lake: "water",
  river: "waves", canyon: "vertical_align_bottom", dunes: "texture", island: "beach_access", pad: "crop_square", pass: "add_road",
};
export const FEATURE_COLOR: Record<FeatureKind, string> = {
  mountain: "#b08a62", hill: "#e3a857", ridge: "#9c7a5b", plateau: "#d97757", crater: "#a07e6b", lake: "#4fa3e0", river: "#5ab8f0",
  canyon: "#c26b4a", dunes: "#e8c27a", island: "#7bd88f", pad: "#c9d1d9", pass: "#f2b33d",
};
export const LINE_FEATURES: FeatureKind[] = ["ridge", "river", "canyon", "pass"];

/** Caixa que a forma afeta (para não percorrer o mapa inteiro). */
function featureBox(f: Feature): [number, number, number, number] {
  const ext = f.r * (f.kind === "lake" || f.kind === "river" ? 1.7 : f.kind === "pad" ? 1.6 : f.kind === "crater" ? 1.4 : 1.25) + 4;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of f.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return [x0 - ext, x1 + ext, z0 - ext, z1 + ext];
}

/** Distância até a linha e posição ao longo dela (0..comprimento). */
function lineDist(pts: Pt[], x: number, z: number): [number, number] {
  let best = Infinity, along = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
    const px = ax + vx * t, pz = az + vz * t;
    const d = Math.hypot(x - px, z - pz);
    const len = Math.sqrt(len2);
    // empate (ponto à mesma distância de dois trechos): fica o primeiro, sem depender do arredondamento
    if (d < best - 1e-9) { best = d; along = acc + t * len; }
    acc += len;
  }
  return [best, along];
}

export interface Grid { size: number; grid: number }

/** média da altura num disco (para planaltos, áreas planas e lagos secos) */
function meanAround(g: Grid, H: Float32Array, cx: number, cz: number, rad: number) {
  const s = g.size, w = s + 1, step = g.grid / s;
  let sum = 0, n = 0;
  const i0 = Math.max(0, Math.ceil((cx - rad) / step)), i1 = Math.min(s, Math.floor((cx + rad) / step));
  const j0 = Math.max(0, Math.ceil((cz - rad) / step)), j1 = Math.min(s, Math.floor((cz + rad) / step));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(i * step - cx, j * step - cz) <= rad) { sum += H[j * w + i]; n++; }
  return n ? sum / n : 0;
}

const KIND_ORDER: Record<FeatureKind, number> = {
  dunes: 0, hill: 1, mountain: 2, ridge: 2, island: 2, plateau: 3, crater: 4, canyon: 5, lake: 6, river: 6, pass: 8, pad: 9,
};

/** Aplica as formas (em ordem: elevações, cavidades, água, passagens e áreas planas). */
export function applyFeatures(g: Grid, H: Float32Array, features: Feature[], water: number, hasWater: boolean) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const list = [...features].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  for (const f of list) {
    if (!f.pts.length || f.r <= 0) continue;
    const n = simplex(f.seed);
    const [bx0, bx1, bz0, bz1] = featureBox(f);
    const i0 = Math.max(0, Math.ceil(bx0 / step)), i1 = Math.min(s, Math.floor(bx1 / step));
    const j0 = Math.max(0, Math.ceil(bz0 / step)), j1 = Math.min(s, Math.floor(bz1 / step));
    const [cx, cz] = f.pts[0];
    const m = f.m ?? [1, 0, 0, 1];
    const line = LINE_FEATURES.includes(f.kind) && f.pts.length > 1;
    // alturas de referência medidas antes desta forma
    const local = f.kind === "plateau" || f.kind === "pad" || f.kind === "crater" || (f.kind === "lake" && !hasWater)
      ? meanAround(g, H, cx, cz, f.r * (f.kind === "pad" ? 1 : 0.6)) : 0;
    let passA = 0, passB = 0;
    if (f.kind === "pass") {
      const a = f.pts[0], b = f.pts[f.pts.length - 1];
      passA = meanAround(g, H, a[0], a[1], 24); passB = meanAround(g, H, b[0], b[1], 24);
      if (hasWater) { passA = Math.max(passA, water + 3); passB = Math.max(passB, water + 3); }
    }
    let total = 0;
    if (line) for (let k = 0; k < f.pts.length - 1; k++) total += Math.hypot(f.pts[k + 1][0] - f.pts[k][0], f.pts[k + 1][1] - f.pts[k][1]);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = i * step, z = j * step, idx = j * w + i;
      const cur = H[idx];
      if (line) {
        const [d0, along] = lineDist(f.pts, x, z);
        const wv = 1 + f.rough * 0.35 * n(along / (f.r * 3), 3.7);
        const rr = f.r * wv, t = d0 / rr;
        if (f.kind === "ridge") {
          if (t >= 1) continue;
          const crest = 0.6 + 0.8 * ridged(n, along / (f.r * 1.6), d0 / f.r * 0.3 + 1.3);
          const prof = (1 - t * t) ** 2;
          H[idx] = cur + f.h * prof * lerp(1, crest, 0.4 + 0.6 * f.rough);
        } else if (f.kind === "river") {
          if (t >= 1.6) continue;
          const bed = hasWater ? water - f.h * (1 - Math.min(1, t) ** 2) - 0.6 : cur - f.h * (1 - Math.min(1, t) ** 2);
          if (t < 1) H[idx] = Math.min(cur, bed);
          else { const bank = hasWater ? water + 1.2 : cur; H[idx] = Math.min(cur, lerp(bank, cur, smooth(1, 1.6, t))); }
        } else if (f.kind === "canyon") {
          if (t >= 1) continue;
          const prof = 1 - smooth(0.55, 1, t);
          H[idx] = cur - f.h * prof * (1 + f.rough * 0.25 * n(along / 40, d0 / 40));
        } else if (f.kind === "pass") {
          if (t >= 1.3) continue;
          const y = lerp(passA, passB, total ? along / total : 0) + 0.5;
          H[idx] = lerp(y, cur, smooth(0.75, 1.3, t));
        }
        continue;
      }
      const dx = x - cx, dz = z - cz;
      const u = m[0] * dx + m[1] * dz, v = m[2] * dx + m[3] * dz;
      const d = Math.hypot(u, v);
      // contorno irregular: o raio varia com o ângulo
      const ang = Math.atan2(v, u);
      const warp = 1 + f.rough * 0.32 * n(Math.cos(ang) * 1.6 + 7.1, Math.sin(ang) * 1.6 - 3.3);
      const t = d / (f.r * warp);
      switch (f.kind) {
        case "mountain": {
          if (t >= 1) break;
          const prof = (1 - t * t) ** 2;
          const crag = ridged(n, u / (f.r * 0.45), v / (f.r * 0.45));
          H[idx] = cur + f.h * prof * (1 + f.rough * 0.9 * (crag - 0.45));
          break;
        }
        case "hill": {
          if (t >= 1) break;
          H[idx] = cur + f.h * (0.5 + 0.5 * Math.cos(Math.PI * t)) * (1 + f.rough * 0.3 * n(u / 50, v / 50));
          break;
        }
        case "island": {
          if (t >= 1) break;
          const top = (hasWater ? water + 2 : cur) + f.h * (1 - t * t) ** 1.5 * (1 + f.rough * 0.3 * n(u / 60, v / 60));
          H[idx] = Math.max(cur, lerp(cur, top, smooth(1, 0.7, t)));
          break;
        }
        case "plateau": {
          if (t >= 1) break;
          const top = local + f.h + f.rough * 2.5 * n(u / 30, v / 30);
          H[idx] = Math.max(cur, lerp(cur, top, smooth(1, 0.62, t)));
          break;
        }
        case "crater": {
          if (t >= 1.4) break;
          if (t < 0.85) H[idx] = lerp(cur, local - f.h * (1 - (t / 0.85) ** 2), smooth(0.85, 0.6, t));
          H[idx] += f.h * 0.45 * Math.exp(-(((t - 0.92) / 0.14) ** 2)) * (1 + f.rough * 0.4 * n(u / 25, v / 25));
          break;
        }
        case "lake": {
          if (t >= 1.5) break;
          const ref = hasWater ? water : local;
          const bed = ref - f.h * (1 - Math.min(1, t) ** 2) - (hasWater ? 0.8 : 0);
          if (t < 1) H[idx] = Math.min(cur, bed);
          else { const shore = hasWater ? water + 1.3 : ref; H[idx] = Math.min(cur, lerp(shore, cur, smooth(1, 1.5, t))); }
          break;
        }
        case "dunes": {
          if (t >= 1) break;
          const fade = (1 - t * t) ** 2;
          const a0 = f.seed % 360 * Math.PI / 180;
          const wave = Math.sin((u * Math.cos(a0) + v * Math.sin(a0)) / (f.r * 0.09) + n(u / 80, v / 80) * 2.5);
          H[idx] = cur + f.h * fade * (0.5 + 0.5 * wave);
          break;
        }
        case "pad": {
          if (t >= 1.6) break;
          const y = hasWater ? Math.max(local, water + 3) : local;
          H[idx] = lerp(cur, y, smooth(1.6, 1.0, t));
          break;
        }
      }
    }
  }
  return H;
}

// ------------------------------------------------------------------ parâmetros do mundo

export interface WorldGen {
  seed: number;
  preset: string;
  players: number;
  symmetry: Symmetry;
  /** 0 = mantém o relevo do terreno base; 1 = relevo totalmente novo */
  blend: number;
  /** altura média da terra acima da água */
  elevation: number;
  /** ondulação do chão */
  hilliness: number;
  /** tamanho das ondulações (maior = morros mais largos) */
  scale: number;
  mountains: number;
  mountainHeight: number;
  ridges: number;
  hills: number;
  plateaus: number;
  craters: number;
  canyons: number;
  lakes: number;
  rivers: number;
  dunes: number;
  islands: number;
  /** bordas do mapa */
  edge: "none" | "mountains" | "water" | "rugged";
  forests: number;
  rocks: number;
  structures: number;
  wrecks: number;
  clearDonor: boolean;
  economy: "poor" | "normal" | "rich";
  /** paleta de cores da prévia e do minimapa */
  biome: "temperate" | "desert" | "snow" | "volcanic";
  /** massa: "generated" = pontos simétricos visíveis e editáveis; "auto" = o toolkit escolhe */
  resources?: "generated" | "auto";
  /** expansões de massa por jogador (fora da base) */
  expansions?: number;
  /** centro disputado: área plana com massa no meio do mapa */
  center?: boolean;
  /** obstáculos: paredões rochosos que criam gargalos entre as bases */
  obstacles?: number;
}

/** Áreas estratégicas marcadas pelo gerador (aparecem na prévia e na análise). */
export interface Strategic { kind: "center" | "safe" | "contested" | "choke"; pos: Pt; label: string }

export const WORLD_PRESETS: { id: string; label: string; icon: string; desc: string; over: Partial<WorldGen> }[] = [
  { id: "valleys", label: "Vales verdes", icon: "forest", desc: "Morros suaves, rios e muita floresta.", over: { blend: 1, hilliness: 9, scale: 260, mountains: 2, mountainHeight: 55, ridges: 1, hills: 6, plateaus: 1, craters: 0, canyons: 0, lakes: 2, rivers: 1, dunes: 0, islands: 0, edge: "mountains", forests: 0.75, rocks: 0.35, structures: 2, wrecks: 0.2, biome: "temperate" } },
  { id: "highlands", label: "Montanhas", icon: "landscape", desc: "Cordilheiras altas, passagens e planaltos.", over: { blend: 1, hilliness: 14, scale: 220, mountains: 5, mountainHeight: 85, ridges: 3, hills: 4, plateaus: 3, craters: 0, canyons: 1, lakes: 1, rivers: 0, dunes: 0, islands: 0, edge: "mountains", forests: 0.45, rocks: 0.75, structures: 2, wrecks: 0.25, biome: "temperate" } },
  { id: "lakes", label: "Terra dos lagos", icon: "water", desc: "Muitos lagos e rios entre as bases.", over: { blend: 1, hilliness: 7, scale: 240, mountains: 1, mountainHeight: 45, ridges: 0, hills: 5, plateaus: 0, craters: 0, canyons: 0, lakes: 6, rivers: 2, dunes: 0, islands: 1, edge: "none", forests: 0.6, rocks: 0.3, structures: 2, wrecks: 0.15, biome: "temperate" } },
  { id: "archipelago", label: "Arquipélago", icon: "beach_access", desc: "Ilhas ligadas por passagens rasas.", over: { blend: 1, hilliness: 6, scale: 200, mountains: 2, mountainHeight: 40, ridges: 0, hills: 3, plateaus: 0, craters: 0, canyons: 0, lakes: 3, rivers: 2, dunes: 0, islands: 4, edge: "water", forests: 0.5, rocks: 0.3, structures: 1, wrecks: 0.2, biome: "temperate" } },
  { id: "desert", label: "Deserto", icon: "wb_sunny", desc: "Dunas, cânions e ruínas.", over: { blend: 1, hilliness: 5, scale: 300, mountains: 1, mountainHeight: 45, ridges: 1, hills: 2, plateaus: 3, craters: 1, canyons: 2, lakes: 0, rivers: 0, dunes: 4, islands: 0, edge: "rugged", forests: 0.05, rocks: 0.55, structures: 4, wrecks: 0.6, biome: "desert" } },
  { id: "wasteland", label: "Terra arrasada", icon: "local_fire_department", desc: "Crateras, destroços e bases em ruínas.", over: { blend: 1, hilliness: 8, scale: 180, mountains: 1, mountainHeight: 40, ridges: 1, hills: 3, plateaus: 1, craters: 6, canyons: 1, lakes: 0, rivers: 0, dunes: 0, islands: 0, edge: "rugged", forests: 0.1, rocks: 0.6, structures: 5, wrecks: 1, biome: "volcanic" } },
  { id: "frozen", label: "Gelo", icon: "ac_unit", desc: "Planaltos gelados e lagos.", over: { blend: 1, hilliness: 10, scale: 240, mountains: 3, mountainHeight: 70, ridges: 2, hills: 3, plateaus: 2, craters: 1, canyons: 1, lakes: 3, rivers: 0, dunes: 0, islands: 0, edge: "mountains", forests: 0.3, rocks: 0.6, structures: 2, wrecks: 0.3, biome: "snow" } },
  { id: "open", label: "Campo aberto", icon: "grass", desc: "Plano e rápido, poucos obstáculos.", over: { blend: 1, hilliness: 4, scale: 320, mountains: 0, mountainHeight: 40, ridges: 0, hills: 4, plateaus: 1, craters: 0, canyons: 0, lakes: 1, rivers: 0, dunes: 0, islands: 0, edge: "none", forests: 0.35, rocks: 0.2, structures: 2, wrecks: 0.2, biome: "temperate" } },
];

export const newWorld = (over: Partial<WorldGen> = {}): WorldGen => ({
  seed: Math.floor(Math.random() * 999999), preset: "valleys", players: 2, symmetry: "rot2",
  blend: 1, elevation: 22, hilliness: 9, scale: 260, mountains: 2, mountainHeight: 55, ridges: 1, hills: 6, plateaus: 1, craters: 0,
  canyons: 0, lakes: 2, rivers: 1, dunes: 0, islands: 0, edge: "mountains", forests: 0.75, rocks: 0.35, structures: 2, wrecks: 0.2,
  clearDonor: true, economy: "normal", biome: "temperate", resources: "generated", expansions: 2, center: true, obstacles: 0, ...over,
});

/** simetrias possíveis para um número de jogadores */
export function symmetriesFor(players: number): Symmetry[] {
  const out: Symmetry[] = ["none"];
  if (players % 2 === 0) out.push("mirror-x", "mirror-z", "diag", "rot2");
  if (players % 4 === 0) out.push("rot4");
  return out;
}

// ------------------------------------------------------------------ relevo base

/** Relevo base do mundo (antes das formas): mistura o terreno do jogo com o relevo novo. */
export function baseHeights(g: Grid, donor: Float32Array, water: number, hasWater: boolean, wg: WorldGen): Float32Array {
  const s = g.size, w = s + 1, step = g.grid / s, G = g.grid;
  const ops = symmetryOps(wg.symmetry, G);
  const n = simplex(wg.seed), n2 = simplex(wg.seed + 101);
  let ref = water;
  if (!hasWater) { const sorted = Float32Array.from(donor).sort(); ref = sorted[sorted.length >> 1] - wg.elevation * 0.5; }
  const out = new Float32Array(w * w);
  const amp = Math.sqrt(ops.length);
  for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
    const x = i * step, z = j * step;
    const e = Math.min(x, z, G - x, G - z);
    const edgy = (wg.edge === "mountains" && e < 160) || (wg.edge === "water" && hasWater && e < 220);
    let v = 0, rv = 0, er = 0, en = 0;
    for (const o of ops) {
      const [px, pz] = o.pt([x, z]);
      v += fbm(n, px / wg.scale, pz / wg.scale, 5);
      rv += ridged(n2, px / (wg.scale * 1.7), pz / (wg.scale * 1.7), 3);
      if (edgy) { er += ridged(n2, px / 90, pz / 90); en += n(px / 150 + 9, pz / 150); }
    }
    v = (v / ops.length) * Math.min(1.6, amp);
    rv /= ops.length; er /= ops.length; en /= ops.length;
    let y = ref + wg.elevation + wg.hilliness * v + wg.hilliness * 0.6 * (rv - 0.35);
    if (wg.edge === "mountains" && edgy) {
      y += smooth(150, 10, e) * (45 + 35 * er) * (0.7 + 0.3 * en);
    } else if (wg.edge === "water" && edgy) {
      y = lerp(y, water - 10, smooth(170, 30, e + 30 * en));
    }
    const idx = j * w + i;
    out[idx] = Math.max(0, lerp(donor[idx], y, wg.blend));
  }
  return out;
}

// ------------------------------------------------------------------ geração

export interface PropCatalog { trees: string[]; rocks: string[]; buildings: string[]; wrecks: string[]; other: string[]; meta?: Record<string, PropMeta> }

export interface WorldResult {
  features: Feature[];
  spawns: Pt[];
  props: PlacedProp[];
  heights: Float32Array;
  notes: string[];
  /** pontos de massa gerados (simétricos) */
  mass: Pt[];
  strategic: Strategic[];
}

let idSeq = 0;
const fid = () => `f${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/** O relevo final do mundo: base + formas. */
export function composeWorld(g: Grid, donor: Float32Array, water: number, hasWater: boolean, wg: WorldGen | null, features: Feature[], base?: Float32Array | null) {
  const H = base ? base.slice() : wg ? baseHeights(g, donor, water, hasWater, wg) : donor.slice();
  if (features.length) applyFeatures(g, H, features, water, hasWater);
  // mundo gerado: erosão leve tira as agulhas e paredões de um ponto só (encostas naturais)
  if (wg) erode(g, H, 10, 1.6);
  for (let k = 0; k < H.length; k++) H[k] = Math.max(0, Math.min(511, H[k]));
  return H;
}

/**
 * Erosão térmica: onde a diferença para um vizinho passa da inclinação `talus` (altura por unidade
 * do mundo), parte do material desce. Atualização simultânea e vizinhança simétrica: o resultado
 * continua simétrico e a massa total se conserva.
 */
export function erode(g: Grid, H: Float32Array, iters: number, talus: number) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const T = talus * step;
  const d = new Float32Array(H.length);
  for (let it = 0; it < iters; it++) {
    d.fill(0);
    let moved = 0;
    for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
      const k = j * w + i, y = H[k];
      // só os vizinhos da direita e de baixo: cada par é tratado uma vez, nos dois sentidos
      if (i < s) { const e = y - H[k + 1], a = Math.abs(e) - T; if (a > 0) { const m = 0.2 * a * Math.sign(e); d[k] -= m; d[k + 1] += m; moved++; } }
      if (j < s) { const e = y - H[k + w], a = Math.abs(e) - T; if (a > 0) { const m = 0.2 * a * Math.sign(e); d[k] -= m; d[k + w] += m; moved++; } }
    }
    if (!moved) break;
    for (let k = 0; k < H.length; k++) H[k] += d[k];
  }
  return H;
}

/** Caminhável: acima da água e sem paredão (mesma regra do toolkit, na resolução da prévia). */
export function walkMask(g: Grid, H: Float32Array, water: number, hasWater: boolean, maxSlope = 6, margin = 2) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const m = new Uint8Array(w * w);
  for (let j = 1; j < s; j++) for (let i = 1; i < s; i++) {
    const k = j * w + i, y = H[k];
    if (hasWater && y <= water + margin) continue;
    const sl = Math.max(Math.abs(H[k + 1] - y), Math.abs(H[k - 1] - y), Math.abs(H[k + w] - y), Math.abs(H[k - w] - y)) / step;
    if (sl < maxSlope * 0.5) m[k] = 1;
  }
  return m;
}

/** Distância a pé (em células da prévia) de um ponto para o mapa todo; -1 = não alcança. */
export function walkDistances(g: Grid, mask: Uint8Array, from: Pt) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const dist = new Int32Array(w * w).fill(-1);
  let si = Math.round(from[0] / step), sj = Math.round(from[1] / step);
  // começa na célula caminhável mais próxima
  let best = -1, bd = Infinity;
  for (let dj = -6; dj <= 6; dj++) for (let di = -6; di <= 6; di++) {
    const i = si + di, j = sj + dj;
    if (i < 0 || j < 0 || i > s || j > s || !mask[j * w + i]) continue;
    const d = di * di + dj * dj;
    if (d < bd) { bd = d; best = j * w + i; }
  }
  if (best < 0) return dist;
  si = best % w; sj = Math.floor(best / w);
  const q = new Int32Array(w * w);
  let qh = 0, qt = 0;
  q[qt++] = best;
  dist[best] = 0;
  while (qh < qt) {
    const k = q[qh++], i = k % w, j = (k - i) / w, d = dist[k] + 1;
    if (i > 0 && mask[k - 1] && dist[k - 1] < 0) { dist[k - 1] = d; q[qt++] = k - 1; }
    if (i < s && mask[k + 1] && dist[k + 1] < 0) { dist[k + 1] = d; q[qt++] = k + 1; }
    if (j > 0 && mask[k - w] && dist[k - w] < 0) { dist[k - w] = d; q[qt++] = k - w; }
    if (j < s && mask[k + w] && dist[k + w] < 0) { dist[k + w] = d; q[qt++] = k + w; }
  }
  return dist;
}

export function distAt(g: Grid, dist: Int32Array, p: Pt) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const i0 = Math.round(p[0] / step), j0 = Math.round(p[1] / step);
  let best = -1;
  for (let r = 0; r <= 4 && best < 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    const i = i0 + di, j = j0 + dj;
    if (i < 0 || j < 0 || i > s || j > s) continue;
    const d = dist[j * w + i];
    if (d >= 0 && (best < 0 || d < best)) best = d;
  }
  return best < 0 ? -1 : best * step;
}

/** Onde ficam as bases: k pontos na região fundamental, repetidos pela simetria. */
function placeSpawns(players: number, sym: Symmetry, grid: number, r: () => number): Pt[] {
  const G = grid;
  const ops = symmetryOps(sym, G);
  const k = Math.max(1, Math.round(players / ops.length));
  const canon: Pt[] = [];
  const inRegion = (p: Pt) => {
    const [x, z] = p, m = 110;
    if (x < m || z < m || x > G - m || z > G - m) return false;
    switch (sym) {
      case "mirror-x": return x < G / 2 - 90;
      case "mirror-z": return z < G / 2 - 90;
      case "diag": return z > x + 130;
      case "rot2": return z > G / 2 + 60 || (Math.abs(z - G / 2) <= 60 && x < G / 2 - 140);
      case "rot4": return x < G / 2 - 80 && z < G / 2 - 80;
      default: return true;
    }
  };
  if (sym === "none") {
    // em volta do centro, distribuídas
    const a0 = r() * Math.PI * 2, rad = G * 0.36;
    for (let i = 0; i < players; i++) {
      const a = a0 + (i / players) * Math.PI * 2;
      canon.push([Math.round(G / 2 + Math.cos(a) * rad), Math.round(G / 2 + Math.sin(a) * rad)]);
    }
    return canon;
  }
  for (let tries = 0; canon.length < k && tries < 4000; tries++) {
    const p: Pt = [Math.round(80 + r() * (G - 160)), Math.round(80 + r() * (G - 160))];
    if (!inRegion(p)) continue;
    // longe das outras bases (e das cópias delas)
    const all = canon.flatMap((c) => ops.map((o) => o.pt(c)));
    const self = ops.map((o) => o.pt(p)).slice(1);
    const minD = Math.min(...all.map((c) => Math.hypot(c[0] - p[0], c[1] - p[1])), ...self.map((c) => Math.hypot(c[0] - p[0], c[1] - p[1])));
    if (minD < (tries < 2500 ? 300 : 200)) continue;
    canon.push(p);
  }
  // ordem: a cópia i de todas as bases forma o "time" i
  const out: Pt[] = [];
  for (const o of ops) for (const c of canon) out.push(o.pt(c));
  return out.slice(0, players);
}

/** Gera o mundo inteiro a partir dos parâmetros. */
export function generateWorld(g: Grid, donor: Float32Array, water: number, hasWater: boolean, wg: WorldGen, cat: PropCatalog): WorldResult {
  const G = g.grid;
  const r = rng(wg.seed * 7919 + 13);
  const ops = symmetryOps(wg.symmetry, G);
  const notes: string[] = [];
  const spawns = placeSpawns(wg.players, wg.symmetry, G, r);
  const canonSpawns = spawns.slice(0, Math.max(1, Math.round(wg.players / ops.length)));
  const features: Feature[] = [];
  const centerOn = wg.center !== false && wg.symmetry !== "none";
  const keep: Pt[] = centerOn ? [...spawns, [G / 2, G / 2]] : spawns;
  const nearSpawn = (p: Pt, d: number) => keep.some((s) => Math.hypot(s[0] - p[0], s[1] - p[1]) < d);
  const nearFeature = (p: Pt, d: number) => features.some((f) => f.pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < d));

  /** coloca uma forma (e as cópias da simetria) num ponto livre */
  const put = (kind: FeatureKind, rad: [number, number], h: [number, number], rough: number, clearSpawn: number, clearOther: number, tries = 80): boolean => {
    for (let t = 0; t < tries; t++) {
      const rr = lerp(rad[0], rad[1], r());
      const p: Pt = [Math.round(rr * 0.6 + r() * (G - rr * 1.2)), Math.round(rr * 0.6 + r() * (G - rr * 1.2))];
      const copies = ops.map((o) => o.pt(p));
      if (copies.some((c) => nearSpawn(c, clearSpawn + rr))) continue;
      if (copies.some((c) => nearFeature(c, clearOther + rr * 0.6))) continue;
      // as cópias da simetria não podem se encostar (senão a forma deixaria de ser simétrica)
      if (copies.some((c, k) => copies.some((c2, k2) => k2 > k && Math.hypot(c[0] - c2[0], c[1] - c2[1]) < rr * 2.2))) continue;
      const uniq = ops.map((o, k) => ({ p: copies[k], m: invert(o.m) }));
      const seed = Math.floor(r() * 1e6), hh = Math.round(lerp(h[0], h[1], r()));
      for (const u of uniq) features.push({ id: fid(), kind, pts: [u.p], r: Math.round(rr), h: hh, rough, seed, m: u.m, gen: true });
      return true;
    }
    return false;
  };
  /** forma em linha (rio, cordilheira, cânion) com curvas */
  const putLine = (kind: FeatureKind, width: [number, number], h: [number, number], rough: number, len: [number, number], fromEdge: boolean): boolean => {
    for (let t = 0; t < 60; t++) {
      let a: Pt, b: Pt;
      if (fromEdge) {
        const side = Math.floor(r() * 4), pos = 120 + r() * (G - 240);
        a = side === 0 ? [pos, 0] : side === 1 ? [G, pos] : side === 2 ? [pos, G] : [0, pos];
        const ang = Math.atan2(G / 2 - a[1], G / 2 - a[0]) + (r() - 0.5) * 1.1;
        const L = lerp(len[0], len[1], r());
        b = [a[0] + Math.cos(ang) * L, a[1] + Math.sin(ang) * L];
      } else {
        a = [100 + r() * (G - 200), 100 + r() * (G - 200)];
        const ang = r() * Math.PI * 2, L = lerp(len[0], len[1], r());
        b = [a[0] + Math.cos(ang) * L, a[1] + Math.sin(ang) * L];
      }
      b = [Math.max(20, Math.min(G - 20, b[0])), Math.max(20, Math.min(G - 20, b[1]))];
      const wdt = lerp(width[0], width[1], r());
      const pts = meander(a, b, 9, wdt * (kind === "river" ? 2.4 : 1.2), r);
      const tooClose = ops.some((o) => pts.some((q) => nearSpawn(o.pt(q), 130 + wdt)));
      if (tooClose) continue;
      const seed = Math.floor(r() * 1e6), hh = Math.round(lerp(h[0], h[1], r()));
      const done: Pt[][] = [];
      for (const o of ops) {
        const tp = pts.map((q) => o.pt(q).map((v) => Math.round(v)) as Pt);
        if (done.some((d) => d.every((q, k) => Math.hypot(q[0] - tp[k][0], q[1] - tp[k][1]) < 4))) continue;
        done.push(tp);
        features.push({ id: fid(), kind, pts: tp, r: Math.round(wdt), h: hh, rough, seed, gen: true });
      }
      return true;
    }
    return false;
  };

  const big = Math.max(0.6, Math.min(1.4, G / 1024));
  const per = (n: number) => Math.max(0, Math.round(n / ops.length));
  // montanhas e elevações
  for (let i = 0; i < per(wg.mountains); i++) put("mountain", [70 * big, 130 * big], [wg.mountainHeight * 0.7, wg.mountainHeight * 1.15], 0.8, 150, 40);
  for (let i = 0; i < per(wg.ridges); i++) putLine("ridge", [34, 55], [wg.mountainHeight * 0.45, wg.mountainHeight * 0.75], 0.8, [220, 420], false);
  for (let i = 0; i < per(wg.hills); i++) put("hill", [45, 95], [8, 22], 0.6, 110, 10);
  for (let i = 0; i < per(wg.plateaus); i++) put("plateau", [60, 100], [12, 24], 0.5, 140, 30);
  for (let i = 0; i < per(wg.dunes); i++) put("dunes", [110, 190], [4, 9], 0.6, 90, 0);
  // cavidades
  for (let i = 0; i < per(wg.craters); i++) put("crater", [35, 80], [10, 22], 0.6, 140, 20);
  for (let i = 0; i < per(wg.canyons); i++) putLine("canyon", [26, 40], [18, 32], 0.6, [260, 480], true);
  // água
  for (let i = 0; i < per(wg.lakes); i++) put("lake", [45, 95], [6, 12], 0.75, 140, 30);
  for (let i = 0; i < per(wg.rivers); i++) putLine("river", [16, 28], [5, 9], 0.6, [380, 700], true);
  if (hasWater) for (let i = 0; i < per(wg.islands); i++) put("island", [70, 120], [14, 26], 0.7, 130, 40);
  // obstáculos: paredões curtos e íngremes entre as bases (criam gargalos; o passe de conexão garante caminho)
  for (let i = 0; i < per(wg.obstacles ?? 0); i++) putLine("ridge", [16, 24], [26, 40], 0.9, [110, 200], false);
  if (centerOn) features.push({ id: fid(), kind: "pad", pts: [[G / 2, G / 2]], r: 46, h: 0, rough: 0, seed: 2, gen: true, name: "Centro" });
  if (!hasWater && (wg.lakes || wg.rivers)) notes.push("Este terreno não tem água: lagos e rios viram vales e leitos secos. Para água de verdade escolha um terreno com água (ex.: Open Palms ou Treallach Island).");

  // áreas planas das bases (sempre por último)
  for (const s of spawns) features.push({ id: fid(), kind: "pad", pts: [s], r: 70, h: 0, rough: 0, seed: 1, gen: true, name: "Base" });

  // relevo, depois garante que todas as bases se alcançam (passagens automáticas)
  const base = baseHeights(g, donor, water, hasWater, wg);
  let H = composeWorld(g, donor, water, hasWater, wg, features, base);
  for (let round = 0; round < 6; round++) {
    const mask = walkMask(g, H, water, hasWater);
    const d0 = walkDistances(g, mask, spawns[0]);
    const lost = spawns.findIndex((s) => distAt(g, d0, s) < 0);
    if (lost < 0) break;
    // liga a base perdida à base alcançável mais próxima
    const reach = spawns.filter((s) => distAt(g, d0, s) >= 0);
    const from = reach.reduce((a, b) => (Math.hypot(b[0] - spawns[lost][0], b[1] - spawns[lost][1]) < Math.hypot(a[0] - spawns[lost][0], a[1] - spawns[lost][1]) ? b : a), reach[0] ?? spawns[0]);
    for (const o of ops) {
      const a = o.pt(from), b = o.pt(spawns[lost]);
      const same = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 5;
      // a mesma passagem (em qualquer sentido) só uma vez
      if (features.some((f) => f.kind === "pass" && ((same(f.pts[0], a) && same(f.pts[1], b)) || (same(f.pts[0], b) && same(f.pts[1], a))))) continue;
      features.push({ id: fid(), kind: "pass", pts: [a, b], r: 34, h: 0, rough: 0.2, seed: 7, gen: true });
    }
    H = composeWorld(g, donor, water, hasWater, wg, features, base);
    if (round === 0) notes.push("Algumas bases ficaram isoladas: o gerador abriu passagens entre elas.");
  }

  const strategic: Strategic[] = [];
  const mass = (wg.resources ?? "generated") === "generated" ? placeMass(g, H, water, hasWater, wg, spawns, canonSpawns, ops, r, centerOn, strategic, notes) : [];
  const props = placeProps(g, H, water, hasWater, wg, cat, spawns, features, r, ops, mass);
  return { features, spawns, props, heights: H, notes, mass, strategic };
}

/** Massa simétrica: expansões seguras e disputadas por jogador e o centro, em chão plano, seco e alcançável. */
function placeMass(g: Grid, H: Float32Array, water: number, hasWater: boolean, wg: WorldGen, spawns: Pt[], canon: Pt[], ops: ReturnType<typeof symmetryOps>,
  r: () => number, centerOn: boolean, strategic: Strategic[], notes: string[]): Pt[] {
  const G = g.grid, s = g.size, w = s + 1, step = G / s;
  const hAt = (x: number, z: number) => H[Math.max(0, Math.min(s, Math.round(z / step))) * w + Math.max(0, Math.min(s, Math.round(x / step)))];
  const mask = walkMask(g, H, water, hasWater);
  const d0 = walkDistances(g, mask, spawns[0]);
  const flat = (p: Pt, rad = 12) => {
    if (p[0] < 30 || p[1] < 30 || p[0] > G - 30 || p[1] > G - 30) return false;
    const y = hAt(p[0], p[1]);
    if (hasWater && y < water + 3) return false;
    for (const [dx, dz] of [[rad, 0], [-rad, 0], [0, rad], [0, -rad]]) if (Math.abs(hAt(p[0] + dx, p[1] + dz) - y) > rad * 0.35) return false;
    return distAt(g, d0, p) >= 0;
  };
  const per = wg.economy === "poor" ? 2 : wg.economy === "rich" ? 4 : 3;
  const out: Pt[] = [];
  const sites: Pt[] = [];
  const cluster = (c: Pt, n: number, rot: number): Pt[] => (n <= 1 ? [c] : Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [Math.round(c[0] + Math.cos(a) * 11), Math.round(c[1] + Math.sin(a) * 11)] as Pt;
  }));
  const big = Math.max(0.6, Math.min(1.4, G / 1024));
  const exp = Math.max(0, Math.min(4, wg.expansions ?? 2));
  for (const sp of canon) {
    for (let e = 0; e < exp; e++) {
      const contested = exp >= 2 && e === exp - 1;
      let done = false;
      for (let t = 0; t < 260 && !done; t++) {
        const a = r() * Math.PI * 2, d = (contested ? lerp(260, 460, r()) : lerp(150, 300, r())) * big;
        const c: Pt = [Math.round(sp[0] + Math.cos(a) * d), Math.round(sp[1] + Math.sin(a) * d)];
        const own = Math.hypot(c[0] - sp[0], c[1] - sp[1]);
        const enemy = Math.min(...spawns.filter((x) => x !== sp).map((x) => Math.hypot(c[0] - x[0], c[1] - x[1])));
        if (!contested && enemy < own * 1.35) continue; // segura: bem mais perto da própria base
        if (contested && Math.abs(enemy - own) > own * 0.35) continue; // disputada: no meio do caminho
        if (spawns.some((x) => Math.hypot(c[0] - x[0], c[1] - x[1]) < 110)) continue;
        const copies = ops.map((o) => o.pt(c));
        if (copies.some((q, k) => copies.some((q2, k2) => k2 > k && Math.hypot(q[0] - q2[0], q[1] - q2[1]) < 60))) continue;
        if (copies.some((q) => sites.some((x) => Math.hypot(q[0] - x[0], q[1] - x[1]) < 90))) continue;
        const pts = cluster(c, per, r() * Math.PI);
        if (!copies.every((q) => flat(q, 16)) || !pts.every((q) => ops.every((o) => flat(o.pt(q), 8)))) continue;
        for (const o of ops) {
          sites.push(o.pt(c));
          for (const q of pts) out.push(o.pt(q).map((v) => Math.round(v)) as Pt);
          strategic.push({ kind: contested ? "contested" : "safe", pos: o.pt(c), label: contested ? "Expansão disputada" : "Expansão segura" });
        }
        done = true;
      }
      if (!done) notes.push(`Não achei chão plano para ${contested ? "a expansão disputada" : `a expansão ${e + 1}`} de uma das bases: coloque à mão com a ferramenta Massa.`);
    }
  }
  if (centerOn) {
    const c: Pt = [G / 2, G / 2];
    if (flat(c, 10)) {
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) out.push([Math.round(c[0] + dx * 10), Math.round(c[1] + dz * 10)]);
      strategic.push({ kind: "center", pos: c, label: "Centro disputado" });
    } else notes.push("O centro ficou na água ou num declive: a massa do centro não foi colocada.");
  }
  // sem duplicados (simetrias que levam um ponto nele mesmo)
  const uniq: Pt[] = [];
  for (const q of out) if (!uniq.some((u) => Math.hypot(u[0] - q[0], u[1] - q[1]) < 4)) uniq.push(q);
  return uniq.slice(0, 200);
}

export function invert(m: [number, number, number, number]): [number, number, number, number] {
  const det = m[0] * m[3] - m[1] * m[2] || 1;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}

/** Linha com curvas suaves entre a e b (rios e cordilheiras naturais). */
function meander(a: Pt, b: Pt, n: number, amp: number, r: () => number): Pt[] {
  const out: Pt[] = [];
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
  const nx = -dz / L, nz = dx / L;
  const ph = r() * 6.28, f = 1 + r() * 1.5;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = Math.sin(t * Math.PI * f + ph) * amp * Math.sin(t * Math.PI) + (r() - 0.5) * amp * 0.5 * Math.sin(t * Math.PI);
    out.push([Math.round(a[0] + dx * t + nx * off), Math.round(a[1] + dz * t + nz * off)]);
  }
  return out;
}

// ------------------------------------------------------------------ decorações

type Biome = WorldGen["biome"];
/** Tamanho e ambiente de cada decoração (do catálogo do jogo). */
export interface PropMeta { bp: string; r: number; h: number; group: boolean; biomes: Biome[]; local: boolean }

/** Ambientes onde uma decoração combina, pelo nome (gelo, lava, deserto…). */
function biomesOf(bp: string): Biome[] {
  const n = bp.toLowerCase();
  if (/winter|_ice|ice_|iceberg|snow|frozen/.test(n)) return ["snow"];
  if (/lava|burnt|dead|volcan|charred|scorch/.test(n)) return ["volcanic"];
  if (/desert|palm|acacia|cactus|dune|rock_red|sand/.test(n)) return ["desert"];
  return ["temperate"];
}

/** Florestas, pedras, estruturas e destroços (na região fundamental, repetidos pela simetria). */
function placeProps(g: Grid, H: Float32Array, water: number, hasWater: boolean, wg: WorldGen, cat: PropCatalog, spawns: Pt[], features: Feature[], r: () => number,
  ops: ReturnType<typeof symmetryOps>, mass: Pt[] = []): PlacedProp[] {
  const G = g.grid, s = g.size, w = s + 1, step = G / s;
  const out: PlacedProp[] = [];
  const MAX = 4800;
  // ocupação do chão (células de 2 unidades): nada fica em cima de nada
  const occ = new Set<number>();
  const cell = (x: number, z: number) => Math.round(z / 2) * 4096 + Math.round(x / 2);
  const free = (x: number, z: number, rad: number) => {
    const k = Math.max(0, Math.ceil(rad / 2));
    for (let dz = -k; dz <= k; dz++) for (let dx = -k; dx <= k; dx++) if (occ.has(cell(x + dx * 2, z + dz * 2))) return false;
    return true;
  };
  const mark = (x: number, z: number, rad: number) => {
    const k = Math.max(0, Math.round(rad / 2));
    for (let dz = -k; dz <= k; dz++) for (let dx = -k; dx <= k; dx++) if (dx * dx + dz * dz <= k * k + 1) occ.add(cell(x + dx * 2, z + dz * 2));
  };
  const hAt = (x: number, z: number) => {
    const i = Math.max(0, Math.min(s, Math.round(x / step))), j = Math.max(0, Math.min(s, Math.round(z / step)));
    return H[j * w + i];
  };
  const slope = (x: number, z: number) => Math.max(Math.abs(hAt(x + step, z) - hAt(x - step, z)), Math.abs(hAt(x, z + step) - hAt(x, z - step))) / (2 * step);
  const wet = (x: number, z: number) => hasWater && hAt(x, z) < water + 2.5;
  const nearSpawn = (x: number, z: number, d: number) => spawns.some((p) => Math.hypot(p[0] - x, p[1] - z) < d);
  const onLine = (x: number, z: number) => features.some((f) => (f.kind === "pass" || f.kind === "river") && f.pts.length > 1 && lineDist(f.pts, x, z)[0] < f.r * 1.2);
  const inRegion = (x: number, z: number) => {
    switch (wg.symmetry) {
      case "mirror-x": return x <= G / 2;
      case "mirror-z": return z <= G / 2;
      case "diag": return z >= x;
      case "rot2": return z >= G / 2;
      case "rot4": return x <= G / 2 && z <= G / 2;
      default: return true;
    }
  };
  const meta = (bp: string): PropMeta => cat.meta?.[bp.toLowerCase()] ?? { bp, r: 1.5, h: 2, group: false, biomes: biomesOf(bp), local: false };
  /** coloca a decoração e as cópias da simetria; devolve false se não coube */
  const emit = (bp: string, x: number, z: number, yaw: number, scale: number, check = true): boolean => {
    const rad = meta(bp).r * scale;
    const spots = ops.map((o) => o.pt([x, z]));
    if (out.length + spots.length > MAX) return false;
    for (const [px, pz] of spots) {
      if (px < 4 || pz < 4 || px > G - 4 || pz > G - 4) return false;
      if (mass.some((m) => Math.hypot(m[0] - px, m[1] - pz) < 12 + rad)) return false;
      if (check && !free(px, pz, rad * 0.75)) return false;
    }
    ops.forEach((o, k) => {
      const [px, pz] = spots[k];
      mark(px, pz, rad * 0.75);
      out.push({ bp, x: Math.round(px * 10) / 10, z: Math.round(pz * 10) / 10, yaw: mapYaw(yaw, o.m), scale: Math.round(scale * 100) / 100, gen: true });
    });
    return true;
  };
  // só o que combina com o ambiente; o que já existe no terreno base tem preferência
  const choose = (list: string[]) => {
    const fit = list.filter((bp) => meta(bp).biomes.includes(wg.biome));
    const base = fit.length ? fit : list.filter((bp) => meta(bp).biomes.includes("temperate"));
    const pool = base.length ? base : list;
    const local = pool.filter((bp) => meta(bp).local);
    return { pool, local };
  };
  const pick = (c: { pool: string[]; local: string[] }) => { const src = c.local.length && r() < 0.7 ? c.local : c.pool; return src[Math.floor(r() * src.length)]; };
  const forest = simplex(wg.seed + 977), rockN = simplex(wg.seed + 1931);
  const budget = (share: number) => Math.floor((MAX * share) / ops.length);

  // estruturas primeiro (precisam de espaço plano)
  const nSites = Math.max(0, Math.round(wg.structures / ops.length));
  const buildings = choose(cat.buildings), wrecks = choose(cat.wrecks), others = choose(cat.other.length ? cat.other : cat.rocks);
  for (let k = 0, tries = 0; k < nSites && tries < 400; tries++) {
    const x = 90 + r() * (G - 180), z = 90 + r() * (G - 180);
    if (!inRegion(x, z) || wet(x, z) || slope(x, z) > 0.45 || nearSpawn(x, z, 160) || onLine(x, z)) continue;
    const center = buildings.pool.length ? pick(buildings) : wrecks.pool.length ? pick(wrecks) : null;
    if (!center) break;
    const cr = meta(center).r;
    if (!emit(center, x, z, Math.round(r() * 4) * 90, lerp(0.9, 1.1, r()))) continue;
    k++;
    const ring = 5 + Math.floor(r() * 6);
    for (let q = 0; q < ring; q++) {
      const list = r() < 0.45 && buildings.pool.length ? buildings : wrecks.pool.length && r() < 0.7 ? wrecks : others;
      if (!list.pool.length) continue;
      const bp = pick(list);
      const a = (q / ring) * Math.PI * 2 + r() * 0.4, d = cr + meta(bp).r + lerp(3, 12, r());
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (wet(px, pz) || slope(px, pz) > 0.7) continue;
      emit(bp, px, pz, Math.round(r() * 4) * 90 + (r() - 0.5) * 20, lerp(0.85, 1.15, r()));
    }
  }

  // florestas: manchas de ruído; o miolo usa bosques inteiros (modelos de grupo) e a borda árvores soltas
  const trees = choose(cat.trees.filter((bp) => { const m = meta(bp); return m.h > 0.4 && m.r < 30 && !/kelp/i.test(bp); }));
  const groups = { pool: trees.pool.filter((bp) => meta(bp).group), local: trees.local.filter((bp) => meta(bp).group) };
  const singles = { pool: trees.pool.filter((bp) => !meta(bp).group), local: trees.local.filter((bp) => !meta(bp).group) };
  if (trees.pool.length && wg.forests > 0) {
    const thr = lerp(0.45, -0.15, wg.forests);
    const inForest = (x: number, z: number) => {
      if (!inRegion(x, z) || x < 8 || z < 8 || x > G - 8 || z > G - 8) return -1;
      const f = fbm(forest, x / 160, z / 160, 4);
      if (f < thr || wet(x, z) || slope(x, z) > 1.0 || nearSpawn(x, z, 95) || onLine(x, z)) return -1;
      return f - thr;
    };
    // área de floresta (amostrada) para caber no orçamento de decorações
    let area = 0;
    for (let z = 4; z < G; z += 8) for (let x = 4; x < G; x += 8) if (inForest(x, z) >= 0) area += 64;
    const maxN = budget(0.62);
    const single = singles.pool.length ? singles.pool.reduce((a, bp) => a + meta(bp).r, 0) / singles.pool.length : 2;
    let spacing = Math.max(single * 2.6, lerp(10, 4.5, wg.forests));
    const groupChance = groups.pool.length ? Math.min(0.85, Math.max(0.15, area / (spacing * spacing) / maxN - 0.6)) : 0;
    if (area / (spacing * spacing) * (1 - groupChance * 0.8) > maxN) spacing = Math.sqrt(area / maxN);
    let placed = 0;
    for (let z = spacing / 2; z < G && placed < maxN; z += spacing) for (let x = spacing / 2; x < G && placed < maxN; x += spacing) {
      const jx = x + (r() - 0.5) * spacing * 0.9, jz = z + (r() - 0.5) * spacing * 0.9;
      const depth = inForest(jx, jz);
      if (depth < 0) continue;
      const deep = depth > 0.12;
      const useGroup = deep && groups.pool.length > 0 && r() < groupChance;
      const bp = useGroup ? pick(groups) : singles.pool.length ? pick(singles) : pick(groups);
      if (emit(bp, jx, jz, r() * 360, lerp(0.8, 1.25, r()))) placed++;
    }
  }

  // pedras: grupos de 2 a 5 bem juntos, mais nas encostas e nas montanhas
  const rocks = choose(cat.rocks);
  if (rocks.pool.length && wg.rocks > 0) {
    const spacing = lerp(70, 26, wg.rocks);
    const maxN = budget(0.22);
    let placed = 0;
    for (let z = spacing / 2; z < G && placed < maxN; z += spacing) for (let x = spacing / 2; x < G && placed < maxN; x += spacing) {
      const jx = x + (r() - 0.5) * spacing, jz = z + (r() - 0.5) * spacing;
      if (!inRegion(jx, jz) || jx < 8 || jz < 8 || jx > G - 8 || jz > G - 8) continue;
      const sl = slope(jx, jz);
      const chance = 0.18 + Math.min(0.6, sl * 0.5) + 0.2 * rockN(jx / 90, jz / 90);
      if (r() > chance * wg.rocks * 1.4 || wet(jx, jz) || nearSpawn(jx, jz, 85) || onLine(jx, jz)) continue;
      const kind = pick(rocks), rr = meta(kind).r;
      const cluster = 2 + Math.floor(r() * 4);
      for (let c = 0; c < cluster; c++) {
        const a = r() * Math.PI * 2, d = c === 0 ? 0 : rr * lerp(1.2, 2.6, r());
        if (emit(kind, jx + Math.cos(a) * d, jz + Math.sin(a) * d, r() * 360, lerp(0.7, 1.5, r()))) placed++;
      }
    }
  }

  // destroços espalhados (restos de batalha)
  if (wrecks.pool.length && wg.wrecks > 0) {
    const n = Math.min(budget(0.1), Math.round((wg.wrecks * 30) / ops.length));
    for (let k = 0, tries = 0; k < n && tries < 600; tries++) {
      const x = 40 + r() * (G - 80), z = 40 + r() * (G - 80);
      if (!inRegion(x, z) || wet(x, z) || nearSpawn(x, z, 120) || slope(x, z) > 0.8) continue;
      if (emit(pick(wrecks), x, z, r() * 360, lerp(0.85, 1.15, r()))) k++;
    }
  }
  return out;
}

/**
 * Separa as decorações do jogo por tipo para o gerador. `size` vem do catálogo (modelo × escala do
 * jogo); `local` = decorações que o terreno base já usa (combinam com o chão dele).
 */
export function propCatalog(props: { bp: string; category?: string; size?: [number, number, number] | null }[], local: string[] = []): PropCatalog {
  const c: PropCatalog = { trees: [], rocks: [], buildings: [], wrecks: [], other: [], meta: {} };
  const here = new Set(local.map((x) => x.toLowerCase()));
  for (const p of props) {
    const k = p.bp.toLowerCase().split("/")[2] ?? "";
    const n = p.bp.toLowerCase();
    // modelos sem tamanho conhecido ou minúsculos/enormes demais ficam de fora do gerador
    const sz = p.size ?? null;
    const r = sz ? Math.max(sz[0], sz[2]) / 2 : 1.5;
    const h = sz ? sz[1] : 2;
    if (sz && (r < 0.15 || r > 60)) continue;
    c.meta![n] = { bp: p.bp, r, h, group: /group|canopy/.test(n) || r > 6, biomes: biomesOf(n), local: here.has(n) };
    if (k.startsWith("tree") && !n.includes("dead") && !n.includes("burnt") && !n.includes("fall")) c.trees.push(p.bp);
    else if (k.startsWith("rock")) c.rocks.push(p.bp);
    else if (k.startsWith("wreck") || k.startsWith("debris") || k.startsWith("defaultwreck")) c.wrecks.push(p.bp);
    else if (["buildings", "structures", "warehouses", "cranes", "lights"].includes(k)) c.buildings.push(p.bp);
    else if (["crates", "barrels", "containers"].includes(k)) c.other.push(p.bp);
  }
  return c;
}

/** Áreas que retiram todas as decorações do terreno original (raio máximo do toolkit: 300). */
export function fullCuts(grid: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = 3, step = grid / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push([Math.round(step * (i + 0.5)), Math.round(step * (j + 0.5)), 300]);
  return out;
}

// ------------------------------------------------------------------ camada para o toolkit

/** Diferença (relevo final − terreno do jogo) em int16 base64, escala 1/32. */
export function encodeDelta(final: Float32Array, donor: Float32Array) {
  const n = final.length;
  const buf = new Int16Array(n);
  let any = false;
  for (let k = 0; k < n; k++) {
    const d = Math.round((final[k] - donor[k]) * 32);
    buf[k] = Math.max(-32768, Math.min(32767, d));
    if (buf[k]) any = true;
  }
  if (!any) return null;
  const bytes = new Uint8Array(buf.buffer);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ------------------------------------------------------------------ pincel de escultura

export type BrushMode = "raise" | "lower" | "smooth" | "flatten" | "noise";

/** Uma pincelada na camada do pincel (delta em unidades do mundo). */
export function brushDab(g: Grid, layer: Float32Array, cur: Float32Array, mode: BrushMode, cx: number, cz: number, rad: number, strength: number, target?: number) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const i0 = Math.max(0, Math.ceil((cx - rad) / step)), i1 = Math.min(s, Math.floor((cx + rad) / step));
  const j0 = Math.max(0, Math.ceil((cz - rad) / step)), j1 = Math.min(s, Math.floor((cz + rad) / step));
  const n = simplex(4242);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i * step - cx, j * step - cz) / rad;
    if (d >= 1) continue;
    const fall = (1 - d * d) ** 2;
    const k = j * w + i;
    let delta = 0;
    if (mode === "raise") delta = strength * 0.25 * fall;
    else if (mode === "lower") delta = -strength * 0.25 * fall;
    else if (mode === "flatten" && target !== undefined) delta = (target - cur[k]) * 0.35 * fall;
    else if (mode === "smooth") {
      let sum = 0, c = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii > s || jj > s) continue;
        sum += cur[jj * w + ii]; c++;
      }
      delta = (sum / c - cur[k]) * 0.5 * fall;
    } else if (mode === "noise") delta = n(i * step / 18, j * step / 18) * strength * 0.12 * fall;
    layer[k] += delta;
  }
}

export function encodeLayer(layer: Float32Array): string | null {
  return encodeDelta(layer, new Float32Array(layer.length));
}

export function decodeLayer(b64: string | null | undefined, n: number): Float32Array {
  const out = new Float32Array(n);
  if (!b64) return out;
  const bin = atob(b64);
  const m = Math.min(n, bin.length >> 1);
  for (let k = 0; k < m; k++) {
    let v = bin.charCodeAt(k * 2) | (bin.charCodeAt(k * 2 + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[k] = v / 32;
  }
  return out;
}

// ------------------------------------------------------------------ cores (prévia e minimapa)

export const BIOME_LABEL: Record<WorldGen["biome"], string> = { temperate: "Temperado", desert: "Deserto", snow: "Neve", volcanic: "Vulcânico" };

/** Cor natural de um ponto (prévia do gerador e minimapa): água, areia, grama, rocha, neve. */
export function naturalColor(y: number, slope: number, water: number, hasWater: boolean, lo: number, hi: number, biome: WorldGen["biome"], shade: number): [number, number, number] {
  let c: [number, number, number];
  if (hasWater && y < water) {
    const d = Math.min(1, (water - y) / 18);
    c = [lerp(78, 26, d), lerp(140, 70, d), lerp(170, 120, d)];
    return c;
  }
  const t = Math.max(0, Math.min(1, (y - Math.max(lo, hasWater ? water : lo)) / Math.max(1, hi - Math.max(lo, hasWater ? water : lo))));
  const P: Record<WorldGen["biome"], [number, number, number][]> = {
    temperate: [[196, 184, 132], [86, 132, 62], [104, 124, 70], [126, 116, 100], [232, 236, 240]],
    desert: [[214, 190, 140], [205, 172, 116], [186, 148, 98], [150, 116, 82], [196, 168, 128]],
    snow: [[190, 196, 204], [214, 222, 232], [196, 206, 220], [140, 150, 164], [246, 248, 252]],
    volcanic: [[92, 84, 78], [70, 66, 62], [84, 70, 62], [58, 52, 50], [120, 60, 40]],
  };
  const p = P[biome];
  if (hasWater && y < water + 2.5) c = p[0];
  else if (t < 0.45) c = lerp3(p[1], p[2], t / 0.45);
  else if (t < 0.75) c = lerp3(p[2], p[3], (t - 0.45) / 0.3);
  else c = lerp3(p[3], p[4], Math.min(1, (t - 0.75) / 0.18));
  if (slope > 1.2) c = lerp3(c, p[3], Math.min(1, (slope - 1.2) / 1.5));
  return [c[0] * shade, c[1] * shade, c[2] * shade];
}
const lerp3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Imagem de cima (canvas) do relevo com cores naturais e sombra. */
export function reliefImage(g: Grid, H: Float32Array, water: number, hasWater: boolean, biome: WorldGen["biome"], px = 512): string {
  const s = g.size, w = s + 1, step = g.grid / s;
  let lo = Infinity, hi = -Infinity;
  for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(px, px);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const fi = (x / (px - 1)) * s, fj = (y / (px - 1)) * s;
    const i = Math.min(s - 1, Math.floor(fi)), j = Math.min(s - 1, Math.floor(fj));
    const u = fi - i, v = fj - j;
    const k = j * w + i;
    const h = (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + w] * (1 - u) + H[k + w + 1] * u) * v;
    const dx = (H[k + 1] - H[k]) / step, dz = (H[k + w] - H[k]) / step;
    const shade = Math.max(0.55, Math.min(1.3, 1 - dx * 0.35 - dz * 0.25));
    const [r, gg, b] = naturalColor(h, Math.hypot(dx, dz), water, hasWater, lo, hi, biome, shade);
    const o = (y * px + x) * 4;
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL("image/png");
}
