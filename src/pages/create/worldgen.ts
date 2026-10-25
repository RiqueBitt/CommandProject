// Gerador de mundos por semente: relevo, montanhas, lagos, rios, cânions, florestas e estruturas.
// Tudo é determinístico (mesma semente = mesmo mapa) e vira objetos editáveis no editor: as formas
// do terreno ficam na lista "Formas do terreno", as bases e decorações nas listas de sempre.
// O relevo final é calculado aqui e enviado ao toolkit como uma camada (height_delta), então a
// prévia e o mapa gerado são iguais.

import type { PlacedProp, Pt } from "../studio/mapEdit";
import { newPaint, type PaintLayer } from "../studio/biome.ts";

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

export type FeatureKind = "mountain" | "hill" | "ridge" | "plateau" | "crater" | "lake" | "river" | "canyon" | "dunes" | "island" | "pad" | "pass"
  | "platform" | "span" | "chasm" | "rift" | "trail";

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
  platform: "Plataforma", span: "Ponte", chasm: "Abismo", rift: "Fenda", trail: "Caminho",
};
export const FEATURE_ICON: Record<FeatureKind, string> = {
  mountain: "landscape", hill: "filter_hdr", ridge: "terrain", plateau: "view_agenda", crater: "radio_button_unchecked", lake: "water",
  river: "waves", canyon: "vertical_align_bottom", dunes: "texture", island: "beach_access", pad: "crop_square", pass: "add_road",
  platform: "layers", span: "straighten", chasm: "blur_circular", rift: "bolt", trail: "hiking",
};
export const FEATURE_COLOR: Record<FeatureKind, string> = {
  mountain: "#b08a62", hill: "#e3a857", ridge: "#9c7a5b", plateau: "#d97757", crater: "#a07e6b", lake: "#4fa3e0", river: "#5ab8f0",
  canyon: "#c26b4a", dunes: "#e8c27a", island: "#7bd88f", pad: "#c9d1d9", pass: "#f2b33d",
  platform: "#8fa3b8", span: "#d9a441", chasm: "#5b4a6b", rift: "#7a5c8f", trail: "#c8a46a",
};
export const LINE_FEATURES: FeatureKind[] = ["ridge", "river", "canyon", "pass", "span", "rift", "trail"];

/** Largura (horizontal) do paredão de uma plataforma: mais alta = parede mais larga e com mais degraus. */
export const wallWidth = (f: Pick<Feature, "h">) => 9 + Math.max(0, f.h) * 0.065;

/** Raio da borda de uma plataforma na direção `a` (radianos, no mundo) — o mesmo contorno do relevo. */
export function platformRim(f: Feature, a: number) {
  const n = simplex(f.seed), m = f.m ?? [1, 0, 0, 1];
  const dx = Math.cos(a), dz = Math.sin(a);
  const u = m[0] * dx + m[1] * dz, v = m[2] * dx + m[3] * dz;
  const ang = Math.atan2(v, u);
  return f.r * (1 + f.rough * 0.32 * n(Math.cos(ang) * 1.6 + 7.1, Math.sin(ang) * 1.6 - 3.3));
}

/** Caixa que a forma afeta (para não percorrer o mapa inteiro). */
function featureBox(f: Feature): [number, number, number, number] {
  const ext = f.kind === "platform" ? f.r * 1.36 + wallWidth(f) * 2 + 6
    : f.r * (f.kind === "lake" || f.kind === "river" ? 2.3 : f.kind === "pass" ? 2.1 : f.kind === "pad" ? 1.6 : f.kind === "crater" ? 1.4 : f.kind === "span" ? 1.4 : 1.25) + 4;
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

/** a altura mais baixa em volta (plataformas: medidas a partir do fundo, sem empilhar) */
function minAround(g: Grid, H: Float32Array, cx: number, cz: number, rad: number) {
  const s = g.size, w = s + 1, step = g.grid / s;
  let lo = Infinity;
  const i0 = Math.max(0, Math.ceil((cx - rad) / step)), i1 = Math.min(s, Math.floor((cx + rad) / step));
  const j0 = Math.max(0, Math.ceil((cz - rad) / step)), j1 = Math.min(s, Math.floor((cz + rad) / step));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(i * step - cx, j * step - cz) <= rad) lo = Math.min(lo, H[j * w + i]);
  return Number.isFinite(lo) ? lo : 0;
}

const KIND_ORDER: Record<FeatureKind, number> = {
  dunes: 0, hill: 1, mountain: 2, ridge: 2, island: 2, plateau: 3, platform: 3, crater: 4, canyon: 5, chasm: 5, rift: 5, lake: 6, river: 6, trail: 7, pass: 8, span: 8, pad: 9,
};

/** Aplica as formas (em ordem: elevações, cavidades, água, passagens e áreas planas). */
export function applyFeatures(g: Grid, H: Float32Array, features: Feature[], water: number, hasWater: boolean) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const list = [...features].sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  let trailsDone = false;
  for (const f of list) {
    if (!f.pts.length || f.r <= 0) continue;
    if (f.kind === "trail") {
      // todos os caminhos juntos (o resultado não depende da ordem: simetria exata)
      if (!trailsDone) { applyTrails(g, H, list.filter((x) => x.kind === "trail"), water, hasWater); trailsDone = true; }
      continue;
    }
    const n = simplex(f.seed);
    const [bx0, bx1, bz0, bz1] = featureBox(f);
    const i0 = Math.max(0, Math.ceil(bx0 / step)), i1 = Math.min(s, Math.floor(bx1 / step));
    const j0 = Math.max(0, Math.ceil(bz0 / step)), j1 = Math.min(s, Math.floor(bz1 / step));
    const [cx, cz] = f.pts[0];
    const m = f.m ?? [1, 0, 0, 1];
    const line = LINE_FEATURES.includes(f.kind) && f.pts.length > 1;
    // alturas de referência medidas antes desta forma
    const local = f.kind === "platform" ? minAround(g, H, cx, cz, f.r * 1.1)
      : f.kind === "plateau" || f.kind === "pad" || f.kind === "crater" || f.kind === "chasm" || (f.kind === "lake" && !hasWater)
        ? meanAround(g, H, cx, cz, f.r * (f.kind === "pad" ? 1 : 0.6)) : 0;
    let passA = 0, passB = 0;
    if (f.kind === "pass" || f.kind === "span") {
      const a = f.pts[0], b = f.pts[f.pts.length - 1];
      const mr = f.kind === "span" ? 10 : 24;
      passA = meanAround(g, H, a[0], a[1], mr); passB = meanAround(g, H, b[0], b[1], mr);
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
          if (t >= 2.2) continue;
          const bed = hasWater ? water - f.h * (1 - Math.min(1, t) ** 2) - 0.6 : cur - f.h * (1 - Math.min(1, t) ** 2);
          if (t < 1) H[idx] = Math.min(cur, bed);
          else { const bank = hasWater ? water + 0.9 : cur; H[idx] = Math.min(cur, bank + (cur - bank) * smooth(1.25, 2.2, t) ** 2); }
        } else if (f.kind === "canyon") {
          if (t >= 1) continue;
          const prof = 1 - smooth(0.55, 1, t);
          H[idx] = cur - f.h * prof * (1 + f.rough * 0.25 * n(along / 40, d0 / 40));
        } else if (f.kind === "pass") {
          if (t >= 2) continue;
          const y = lerp(passA, passB, total ? along / total : 0) + 0.5;
          H[idx] = lerp(y, cur, smooth(0.6, 2, t) ** 0.8);
        } else if (f.kind === "span") {
          // ponte: tabuleiro plano entre as duas pontas, laterais a pique (sobre o abismo)
          const tt = d0 / f.r;
          if (tt >= 1.18) continue;
          const y = lerp(passA, passB, total ? along / total : 0);
          const deck = y + (1 - Math.min(1, tt)) * 0.4;
          H[idx] = tt < 1 ? deck : lerp(deck, cur, smooth(1, 1.18, tt));
        } else if (f.kind === "rift") {
          // fenda: paredes verticais e fundo irregular
          if (t >= 1.12) continue;
          const bottom = cur - f.h * (0.9 + 0.1 * n(along / 30, d0 / 30));
          H[idx] = t < 1 ? Math.min(cur, bottom) : lerp(Math.min(cur, bottom), cur, smooth(1, 1.12, t));
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
          // dobra de domínio: cristas e vales tortos (não um cone); base larga e pico agudo
          const k = f.r * 0.5;
          const wu = u + f.r * 0.24 * n(u / k + 3.1, v / k - 1.7), wv = v + f.r * 0.24 * n(u / k - 4.2, v / k + 2.9);
          const tw = Math.min(1, Math.hypot(wu, wv) / (f.r * warp));
          if (tw >= 1) break;
          const prof = (1 - tw) ** 1.8 * (1 + 0.9 * tw) * smooth(1, 0.85, t);
          // multifractal com cristas: as dobras grandes carregam os detalhes
          let rm = 0, amp = 1, fr = 1 / (f.r * 0.42), ws = 0;
          for (let o = 0; o < 4; o++) {
            const q = 1 - Math.abs(n(wu * fr + o * 13.1, wv * fr - o * 7.7));
            rm += q * q * amp * (o ? 0.6 + 0.4 * rm / Math.max(0.001, ws) : 1);
            ws += amp; amp *= 0.5; fr *= 2.1;
          }
          rm /= ws;
          H[idx] = cur + f.h * prof * (0.62 + f.rough * 0.85 * (rm - 0.35));
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
          const te = 1 + Math.min(0.8, 42 / f.r);
          if (t >= te) break;
          const ref = hasWater ? water : local;
          const bed = ref - f.h * (1 - Math.min(1, t) ** 2) - (hasWater ? 0.8 : 0);
          if (t < 1) H[idx] = Math.min(cur, bed);
          else {
            // margem suave: faixa de praia rente à água e subida devagar até o chão em volta
            const shore = hasWater ? water + 0.9 : ref;
            H[idx] = Math.min(cur, shore + (cur - shore) * smooth(1 + (te - 1) * 0.3, te, t) ** 2);
          }
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
        case "platform": {
          // plataforma: topo plano, borda a pique em degraus (camadas de rocha), contrafortes
          // (a parede avança e recua conforme o ângulo) e um monte de cascalho no pé
          const rim = f.r * warp, e = d - rim;
          const W = wallWidth(f) * (0.75 + 0.5 * Math.abs(Math.sin(ang * (5 + (f.seed % 5)) + 2.2 * n(Math.cos(ang) * 3.1 + 1.7, Math.sin(ang) * 3.1 - 5.3))));
          if (e >= W * 1.7) break;
          const top = local + f.h + f.rough * 1.6 * n(u / 34, v / 34);
          if (e <= 0) { H[idx] = Math.max(cur, top); break; }
          const drop = Math.max(0, top - cur);
          const steps = Math.max(2, Math.min(6, Math.round(f.h / 45)));
          const q = Math.min(1, e / W) * steps;
          // cada degrau: um beiral quase plano e depois a queda
          const frac = (Math.floor(q) + smooth(0.28, 1, q - Math.floor(q))) / steps;
          let y = top - drop * Math.min(1, frac + 0.02 * n(u / 7, v / 7));
          if (e > W) {
            // pé do paredão: cascalho que escorre e some no fundo
            const k = (e - W) / (W * 0.7);
            y = cur + drop * 0.07 * (1 - smooth(0, 1, k)) ** 2;
          }
          H[idx] = Math.max(cur, y);
          break;
        }
        case "chasm": {
          // abismo: buraco fundo de paredes verticais
          if (t >= 1.08) break;
          const bottom = Math.max(1, local - f.h) + f.rough * 3 * n(u / 26, v / 26);
          const y = Math.min(cur, bottom);
          H[idx] = t < 1 ? y : lerp(y, cur, smooth(1, 1.08, t));
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

/**
 * Caminhos: o chão acompanha uma linha suave ao longo do trajeto (aplaina de lado a lado e tira os
 * solavancos), sem cortar morros inteiros. Feito por trecho (rápido mesmo com trajetos longos).
 */
function applyTrails(g: Grid, H: Float32Array, trails: Feature[], water: number, hasWater: boolean) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const sumW = new Map<number, [number, number, number]>(); // célula → [Σw, Σw·y, max w]
  for (const f of trails) {
    if (f.pts.length < 2 || f.r <= 0) continue;
    const R = f.r * 1.8;
    // altura alvo em cada ponto do trajeto: média em volta, suavizada ao longo do caminho
    let ys = f.pts.map((p) => meanAround(g, H, p[0], p[1], Math.max(step * 1.5, f.r * 1.5)));
    for (let it = 0; it < 3; it++) ys = ys.map((y, k) => (ys[Math.max(0, k - 1)] + 2 * y + ys[Math.min(ys.length - 1, k + 1)]) / 4);
    if (hasWater) ys = ys.map((y) => Math.max(y, water + 1.2));
    // menor distância ao trajeto por célula (só nas células perto de cada trecho)
    const best = new Map<number, [number, number]>(); // célula → [distância, y alvo]
    for (let k = 0; k < f.pts.length - 1; k++) {
      const [ax, az] = f.pts[k], [bx, bz] = f.pts[k + 1];
      const vx = bx - ax, vz = bz - az, len2 = vx * vx + vz * vz || 1;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - R) / step)), i1 = Math.min(s, Math.ceil((Math.max(ax, bx) + R) / step));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - R) / step)), j1 = Math.min(s, Math.ceil((Math.max(az, bz) + R) / step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = i * step, z = j * step, idx = j * w + i;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / len2));
        const d = Math.hypot(x - ax - vx * t, z - az - vz * t);
        if (d >= R) continue;
        const cur = best.get(idx);
        if (!cur || d < cur[0] - 1e-9) best.set(idx, [d, lerp(ys[k], ys[k + 1], t)]);
      }
    }
    for (const [idx, [d, y]] of best) {
      const wgt = 0.85 * (1 - smooth(f.r, R, d));
      if (wgt <= 0) continue;
      const acc = sumW.get(idx) ?? [0, 0, 0];
      acc[0] += wgt; acc[1] += wgt * y; acc[2] = Math.max(acc[2], wgt);
      sumW.set(idx, acc);
    }
  }
  for (const [idx, [sw, swy, mw]] of sumW) H[idx] = lerp(H[idx], swy / sw, mw);
}

/** Limpa a beira da água: poças e ilhotas de poucos metros somem e a margem fica suave. */
export function cleanShores(g: Grid, H: Float32Array, water: number) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const minCells = Math.max(6, Math.round(180 / (step * step)));
  const seen = new Uint8Array(w * w), stack: number[] = [], comp: number[] = [];
  for (const wet of [true, false]) {
    seen.fill(0);
    for (let k0 = 0; k0 < H.length; k0++) {
      if (seen[k0] || (H[k0] < water) !== wet) continue;
      comp.length = 0; stack.push(k0); seen[k0] = 1;
      let edge = false;
      while (stack.length) {
        const k = stack.pop()!, i = k % w, j = (k - i) / w;
        comp.push(k);
        if (i === 0 || j === 0 || i === s || j === s) edge = true;
        for (const q of [i > 0 ? k - 1 : -1, i < s ? k + 1 : -1, j > 0 ? k - w : -1, j < s ? k + w : -1]) {
          if (q >= 0 && !seen[q] && (H[q] < water) === wet) { seen[q] = 1; stack.push(q); }
        }
        if (comp.length > minCells) break;
      }
      // continua marcando o resto do componente grande sem mexer nele
      while (stack.length) { const k = stack.pop()!, i = k % w, j = (k - i) / w; for (const q of [i > 0 ? k - 1 : -1, i < s ? k + 1 : -1, j > 0 ? k - w : -1, j < s ? k + w : -1]) if (q >= 0 && !seen[q] && (H[q] < water) === wet) { seen[q] = 1; stack.push(q); } }
      if (comp.length <= minCells && !edge) for (const k of comp) H[k] = wet ? water + 0.7 : water - 0.7;
    }
  }
  // margem: média com os vizinhos só na faixa rente à água (tira os dentes da linha d'água)
  for (let it = 0; it < 2; it++) {
    const out = H.slice();
    for (let j = 1; j < s; j++) for (let i = 1; i < s; i++) {
      const k = j * w + i;
      if (Math.abs(H[k] - water) > 2.5) continue;
      out[k] = (H[k] * 4 + H[k - 1] + H[k + 1] + H[k - w] + H[k + w]) / 8;
    }
    H.set(out);
  }
  return H;
}

/** Suaviza o relevo (montanhas e morros sem pontas), mais nas partes íngremes. */
export function softenRelief(g: Grid, H: Float32Array, amount: number) {
  const s = g.size, w = s + 1;
  const passes = Math.round(amount * 4);
  for (let it = 0; it < passes; it++) {
    const out = H.slice();
    for (let j = 1; j < s; j++) for (let i = 1; i < s; i++) {
      const k = j * w + i;
      const avg = (H[k - 1] + H[k + 1] + H[k - w] + H[k + w]) / 4;
      out[k] = lerp(H[k], avg, 0.5 * amount + 0.15);
    }
    H.set(out);
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
  /** vilas (casas em ruas, armazéns, postes, praça) por mapa */
  settlements?: number;
  /** estradas de terra ligando vilas e bases */
  roads?: boolean;
  /** plantações em volta das vilas (0 a 1) */
  farms?: number;
  /** detalhe fino do relevo (0 a 1) */
  detail?: number;
  /** "platforms": plataformas altas ligadas por pontes sobre um abismo (estilo Shiva Prime) */
  style?: "natural" | "platforms";
  /** altura das plataformas acima do fundo do abismo */
  platformHeight?: number;
  /** fundo do abismo: seco (rocha) ou mar (precisa de água no terreno) */
  abyss?: "deep" | "water";
  /** céu de outro mapa do jogo (id do mapa); null = o do terreno base; ausente = não mexe */
  sky?: string | null;
  /** suavidade do relevo (0 a 1): montanhas e margens sem pontas */
  smooth?: number;
  /** caminhos de terra ligando as bases às expansões e ao centro */
  paths?: boolean;
  /** montanhas íngremes bloqueadas para as tropas (mapa de passagem) */
  blockSteep?: boolean;
}

/** Altura do fundo do abismo (estilo plataformas). */
export function abyssFloor(wg: WorldGen, water: number, hasWater: boolean, donorMedian: number) {
  if (hasWater) return wg.abyss === "water" ? water - 18 : water + 9;
  return Math.max(4, donorMedian - 40);
}
const medianOf = (a: Float32Array) => { const sorted = Float32Array.from(a).sort(); return sorted[sorted.length >> 1]; };

/** Áreas estratégicas marcadas pelo gerador (aparecem na prévia e na análise). */
export interface Strategic { kind: "center" | "safe" | "contested" | "choke"; pos: Pt; label: string }

export const WORLD_PRESETS: { id: string; label: string; icon: string; desc: string; over: Partial<WorldGen> }[] = [
  { id: "valleys", label: "Vales verdes", icon: "forest", desc: "Morros suaves, rios e muita floresta.", over: { blend: 1, style: "natural", hilliness: 9, scale: 260, mountains: 2, mountainHeight: 55, ridges: 1, hills: 6, plateaus: 1, craters: 0, canyons: 0, lakes: 2, rivers: 1, dunes: 0, islands: 0, edge: "mountains", forests: 0.75, rocks: 0.35, structures: 2, wrecks: 0.2, biome: "temperate", settlements: 3, farms: 0.75, roads: true, detail: 0.6 } },
  { id: "highlands", label: "Montanhas", icon: "landscape", desc: "Cordilheiras altas, passagens e planaltos.", over: { blend: 1, style: "natural", hilliness: 14, scale: 220, mountains: 5, mountainHeight: 85, ridges: 3, hills: 4, plateaus: 3, craters: 0, canyons: 1, lakes: 1, rivers: 0, dunes: 0, islands: 0, edge: "mountains", forests: 0.45, rocks: 0.75, structures: 2, wrecks: 0.25, biome: "temperate", settlements: 2, farms: 0.3, roads: true, detail: 0.8 } },
  { id: "lakes", label: "Terra dos lagos", icon: "water", desc: "Muitos lagos e rios entre as bases.", over: { blend: 1, style: "natural", hilliness: 7, scale: 240, mountains: 1, mountainHeight: 45, ridges: 0, hills: 5, plateaus: 0, craters: 0, canyons: 0, lakes: 6, rivers: 2, dunes: 0, islands: 1, edge: "none", forests: 0.6, rocks: 0.3, structures: 2, wrecks: 0.15, biome: "temperate", settlements: 3, farms: 0.6, roads: true, detail: 0.55 } },
  { id: "archipelago", label: "Arquipélago", icon: "beach_access", desc: "Ilhas ligadas por passagens rasas.", over: { blend: 1, style: "natural", hilliness: 6, scale: 200, mountains: 2, mountainHeight: 40, ridges: 0, hills: 3, plateaus: 0, craters: 0, canyons: 0, lakes: 3, rivers: 2, dunes: 0, islands: 4, edge: "water", forests: 0.5, rocks: 0.3, structures: 1, wrecks: 0.2, biome: "temperate", settlements: 2, farms: 0.3, roads: true, detail: 0.5 } },
  { id: "desert", label: "Deserto", icon: "wb_sunny", desc: "Dunas, cânions e ruínas.", over: { blend: 1, style: "natural", hilliness: 5, scale: 300, mountains: 1, mountainHeight: 45, ridges: 1, hills: 2, plateaus: 3, craters: 1, canyons: 2, lakes: 0, rivers: 0, dunes: 4, islands: 0, edge: "rugged", forests: 0.05, rocks: 0.55, structures: 4, wrecks: 0.6, biome: "desert", settlements: 2, farms: 0, roads: true, detail: 0.7 } },
  { id: "wasteland", label: "Terra arrasada", icon: "local_fire_department", desc: "Crateras, destroços e bases em ruínas.", over: { blend: 1, style: "natural", hilliness: 8, scale: 180, mountains: 1, mountainHeight: 40, ridges: 1, hills: 3, plateaus: 1, craters: 6, canyons: 1, lakes: 0, rivers: 0, dunes: 0, islands: 0, edge: "rugged", forests: 0.1, rocks: 0.6, structures: 5, wrecks: 1, biome: "volcanic", settlements: 2, farms: 0, roads: true, detail: 0.8 } },
  { id: "frozen", label: "Gelo", icon: "ac_unit", desc: "Planaltos gelados e lagos.", over: { blend: 1, style: "natural", hilliness: 10, scale: 240, mountains: 3, mountainHeight: 70, ridges: 2, hills: 3, plateaus: 2, craters: 1, canyons: 1, lakes: 3, rivers: 0, dunes: 0, islands: 0, edge: "mountains", forests: 0.3, rocks: 0.6, structures: 2, wrecks: 0.3, biome: "snow", settlements: 1, farms: 0, roads: true, detail: 0.6 } },
  { id: "abyss", label: "Plataformas no abismo", icon: "layers", desc: "Plataformas altas e pontes sobre um abismo (como Shiva Prime).", over: { blend: 1, style: "platforms", platformHeight: 170, abyss: "deep", hilliness: 4, scale: 220, mountains: 6, mountainHeight: 60, ridges: 0, hills: 0, plateaus: 6, craters: 0, canyons: 0, lakes: 0, rivers: 0, dunes: 0, islands: 0, edge: "none", forests: 0.25, rocks: 0.5, structures: 4, wrecks: 0.5, biome: "volcanic", settlements: 0, farms: 0, roads: false, detail: 0.5 } },
  { id: "skyforts", label: "Fortalezas suspensas", icon: "fort", desc: "Plataformas verdes com vilas, ligadas por pontes (como Sinorok Rift).", over: { blend: 1, style: "platforms", platformHeight: 140, abyss: "deep", hilliness: 4, scale: 220, mountains: 8, mountainHeight: 60, ridges: 0, hills: 0, plateaus: 8, craters: 0, canyons: 0, lakes: 0, rivers: 0, dunes: 0, islands: 0, edge: "none", forests: 0.45, rocks: 0.35, structures: 2, wrecks: 0.2, biome: "temperate", settlements: 2, farms: 0.3, roads: true, detail: 0.5 } },
  { id: "open", label: "Campo aberto", icon: "grass", desc: "Plano e rápido, poucos obstáculos.", over: { blend: 1, style: "natural", hilliness: 4, scale: 320, mountains: 0, mountainHeight: 40, ridges: 0, hills: 4, plateaus: 1, craters: 0, canyons: 0, lakes: 1, rivers: 0, dunes: 0, islands: 0, edge: "none", forests: 0.35, rocks: 0.2, structures: 2, wrecks: 0.2, biome: "temperate", settlements: 4, farms: 0.85, roads: true, detail: 0.45 } },
];

export const newWorld = (over: Partial<WorldGen> = {}): WorldGen => ({
  seed: Math.floor(Math.random() * 999999), preset: "valleys", players: 2, symmetry: "rot2",
  blend: 1, elevation: 22, hilliness: 9, scale: 260, mountains: 2, mountainHeight: 55, ridges: 1, hills: 6, plateaus: 1, craters: 0,
  canyons: 0, lakes: 2, rivers: 1, dunes: 0, islands: 0, edge: "mountains", forests: 0.75, rocks: 0.35, structures: 2, wrecks: 0.2,
  clearDonor: true, economy: "normal", biome: "temperate", resources: "generated", expansions: 2, center: true, obstacles: 0,
  settlements: 3, roads: true, farms: 0.75, detail: 0.6, smooth: 0.5, paths: true, blockSteep: true, ...over,
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
  const n = simplex(wg.seed), n2 = simplex(wg.seed + 101), n3 = simplex(wg.seed + 211);
  // detalhe fino (ondulações de poucos metros, sulcos e lombadas): o chão deixa de ser liso
  // mundos de versões antigas (sem `detail`) continuam iguais
  const det = wg.detail ?? 0, detAmp = det * (1.4 + wg.hilliness * 0.08);
  let ref = water;
  if (!hasWater) { const sorted = Float32Array.from(donor).sort(); ref = sorted[sorted.length >> 1] - wg.elevation * 0.5; }
  const out = new Float32Array(w * w);
  const amp = Math.sqrt(ops.length);
  const plat = wg.style === "platforms", floorY = plat ? abyssFloor(wg, water, hasWater, medianOf(donor)) : 0;
  for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
    const x = i * step, z = j * step;
    if (plat) {
      // plataformas: o chão base é o fundo do abismo (pedras e sulcos); as plataformas sobem dele
      let v = 0, dv = 0;
      for (const o of ops) {
        const [px, pz] = o.pt([x, z]);
        v += ridged(n2, px / 160, pz / 160, 3);
        dv += fbm(n3, px / 30, pz / 30, 2);
      }
      v /= ops.length; dv /= ops.length;
      // fundo: cristas de pedra e valas (de cima parece um chão distante e irregular)
      out[j * w + i] = Math.max(0, lerp(donor[j * w + i], floorY + 16 * (v - 0.35) + 3 * dv, wg.blend));
      continue;
    }
    const e = Math.min(x, z, G - x, G - z);
    const edgy = (wg.edge === "mountains" && e < 160) || (wg.edge === "water" && hasWater && e < 220);
    let v = 0, rv = 0, er = 0, en = 0, dv = 0;
    for (const o of ops) {
      const [px, pz] = o.pt([x, z]);
      v += fbm(n, px / wg.scale, pz / wg.scale, 5);
      rv += ridged(n2, px / (wg.scale * 1.7), pz / (wg.scale * 1.7), 3);
      if (det > 0) dv += fbm(n3, px / 46, pz / 46, 2) + 0.35 * n3(px / 14 + 5.3, pz / 14 - 2.1);
      if (edgy) { er += ridged(n2, px / 90, pz / 90); en += n(px / 150 + 9, pz / 150); }
    }
    v = (v / ops.length) * Math.min(1.6, amp);
    rv /= ops.length; er /= ops.length; en /= ops.length; dv /= ops.length;
    let y = ref + wg.elevation + wg.hilliness * v + wg.hilliness * 0.6 * (rv - 0.35) + detAmp * dv;
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
  /** pintura do chão feita pelo gerador (estradas, vilas, plantações, chão das matas) */
  paint?: PaintLayer | null;
  /** vilas, estradas e plantações (para a prévia) */
  life?: Life;
  /** mapa de passagem do gerador (encostas íngremes bloqueadas) */
  nav?: PaintLayer | null;
}

/** resolução do mapa de passagem (pontos por lado) */
export const NAV_N = 256;

/** Bloqueia as encostas mais íngremes que `slope` (altura por unidade), longe do que precisa de caminho. */
function steepNav(g: Grid, H: Float32Array, features: Feature[], spawns: Pt[], mass: Pt[], slope: number): PaintLayer {
  const P = newPaint(NAV_N), n = P.n, cs = g.grid / n, hAt = heightReader(g, H);
  const keep = (x: number, z: number) =>
    spawns.some((p) => Math.hypot(p[0] - x, p[1] - z) < 90) || mass.some((p) => Math.hypot(p[0] - x, p[1] - z) < 24)
    || features.some((f) => (f.kind === "pass" || f.kind === "span" || f.kind === "trail") && f.pts.length > 1 && lineDist(f.pts, x, z)[0] < f.r * 2 + 6)
    || features.some((f) => f.kind === "pad" && Math.hypot(f.pts[0][0] - x, f.pts[0][1] - z) < f.r * 1.3);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const x = i * cs, z = j * cs, e = cs;
    const sl = Math.max(Math.abs(hAt(x + e, z) - hAt(x - e, z)), Math.abs(hAt(x, z + e) - hAt(x, z - e))) / (2 * e);
    if (sl < slope || keep(x, z)) continue;
    const k = j * (n + 1) + i;
    P.role[k] = 1; P.power[k] = 255;
  }
  return P;
}

let idSeq = 0;
const fid = () => `f${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/** O relevo final do mundo: base + formas. */
export function composeWorld(g: Grid, donor: Float32Array, water: number, hasWater: boolean, wg: WorldGen | null, features: Feature[], base?: Float32Array | null) {
  const H = base ? base.slice() : wg ? baseHeights(g, donor, water, hasWater, wg) : donor.slice();
  if (features.length) applyFeatures(g, H, features, water, hasWater);
  if (wg) {
    // mundo gerado: a chuva cava ravinas e leva terra para os vales; depois a erosão térmica tira
    // agulhas e paredões de um ponto só. A simetria é refeita no fim (média das cópias).
    // Plataformas: sem erosão (as bordas a pique e as pontes são o desenho do mapa).
    if (wg.style !== "platforms") {
      rainErode(g, H, wg.seed, water, hasWater);
      symmetrize(g, H, wg.symmetry);
      erode(g, H, 10, 1.6);
      // versões novas: suavidade e beira da água limpa (mundos antigos continuam iguais)
      if (wg.smooth !== undefined) {
        softenRelief(g, H, wg.smooth);
        if (hasWater) cleanShores(g, H, water);
        symmetrize(g, H, wg.symmetry);
      }
    } else symmetrize(g, H, wg.symmetry);
    // bases, passagens, pontes e áreas planas continuam planas depois da erosão
    const flat = features.filter((f) => f.kind === "pad" || f.kind === "pass" || f.kind === "span" || f.kind === "trail");
    if (flat.length) applyFeatures(g, H, flat, water, hasWater);
  }
  for (let k = 0; k < H.length; k++) H[k] = Math.max(0, Math.min(511, H[k]));
  return H;
}

/** Erosão por chuva (gotas que descem a encosta levando e deixando terra). Determinística pela semente. */
export function rainErode(g: Grid, H: Float32Array, seed: number, water: number, hasWater: boolean, drops = 0) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const n = drops || Math.round(s * s * 0.45);
  const r = rng(seed * 31 + 7);
  const inertia = 0.06, capK = 4, dep = 0.3, ero = 0.3, evap = 0.02, grav = 4, minSlope = 0.01, maxLife = 40;
  const lim = s - 1;
  // altura bilinear sem criar objetos (o laço roda milhões de vezes)
  const hAt = (x: number, z: number) => {
    const i = x < 0 ? 0 : x >= lim ? lim - 1 : x | 0, j = z < 0 ? 0 : z >= lim ? lim - 1 : z | 0;
    const u = x - i, v = z - j, k = j * w + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + w] * (1 - u) + H[k + w + 1] * u) * v;
  };
  for (let d = 0; d < n; d++) {
    let x = 1 + r() * (s - 2), z = 1 + r() * (s - 2), dx = 0, dz = 0, vel = 1, wat = 1, sed = 0;
    for (let life = 0; life < maxLife; life++) {
      const i = x >= lim ? lim - 1 : x | 0, j = z >= lim ? lim - 1 : z | 0;
      const u = x - i, v = z - j, k = j * w + i;
      const a = H[k], b = H[k + 1], c = H[k + w], e = H[k + w + 1];
      const h = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
      if (hasWater && h <= water) break;
      const gx = (b - a) * (1 - v) + (e - c) * v, gz = (c - a) * (1 - u) + (e - b) * u;
      dx = dx * inertia - gx * (1 - inertia);
      dz = dz * inertia - gz * (1 - inertia);
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len < 1e-6) break;
      dx /= len; dz /= len;
      const nx = x + dx, nz = z + dz;
      if (nx < 1 || nz < 1 || nx > s - 1 || nz > s - 1) break;
      const dh = hAt(nx, nz) - h;
      const cap = Math.max(-dh / step, minSlope) * vel * wat * capK;
      const w0 = (1 - u) * (1 - v), w1 = u * (1 - v), w2 = (1 - u) * v, w3 = u * v;
      if (sed > cap || dh > 0) {
        const amt = dh > 0 ? Math.min(dh, sed) : (sed - cap) * dep;
        sed -= amt;
        H[k] += amt * w0; H[k + 1] += amt * w1; H[k + w] += amt * w2; H[k + w + 1] += amt * w3;
      } else {
        const amt = Math.min((cap - sed) * ero, -dh);
        H[k] -= amt * w0; H[k + 1] -= amt * w1; H[k + w] -= amt * w2; H[k + w + 1] -= amt * w3;
        sed += amt;
      }
      vel = Math.sqrt(Math.max(0, vel * vel + (-dh / step) * grav));
      wat *= 1 - evap;
      x = nx; z = nz;
    }
  }
  return H;
}

/** Refaz a simetria: cada ponto vira a média dele com as cópias. */
export function symmetrize(g: Grid, H: Float32Array, sym: Symmetry) {
  const ops = symmetryOps(sym, g.grid);
  if (ops.length < 2) return H;
  const s = g.size, w = s + 1, step = g.grid / s;
  const out = new Float32Array(H.length);
  for (let j = 0; j <= s; j++) for (let i = 0; i <= s; i++) {
    let acc = 0;
    for (const o of ops) {
      const [x, z] = o.pt([i * step, j * step]);
      const ii = Math.max(0, Math.min(s, Math.round(x / step))), jj = Math.max(0, Math.min(s, Math.round(z / step)));
      acc += H[jj * w + ii];
    }
    out[j * w + i] = acc / ops.length;
  }
  H.set(out);
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

/** Mapa de passagem pintado (papel 1 = bloqueado, 2 = liberado) usado por padrão em `walkMask`. */
let WALK_NAV: PaintLayer | null = null;
export function setWalkNav(nav: PaintLayer | null) { WALK_NAV = nav; }

/** papel de passagem pintado no ponto: 0 automático, 1 bloqueado, 2 liberado */
export function navAt(nav: PaintLayer | null, grid: number, x: number, z: number) {
  if (!nav) return 0;
  const i = Math.min(nav.n, Math.max(0, Math.round((x / grid) * nav.n))), j = Math.min(nav.n, Math.max(0, Math.round((z / grid) * nav.n)));
  const k = j * (nav.n + 1) + i;
  return nav.power[k] >= 128 ? nav.role[k] : 0;
}

/** Caminhável: acima da água e sem paredão (mesma regra do toolkit, na resolução da prévia), com o
 * mapa de passagem pintado por cima (bloqueado/liberado). */
export function walkMask(g: Grid, H: Float32Array, water: number, hasWater: boolean, maxSlope = 6, margin = 2, nav: PaintLayer | null = WALK_NAV) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const m = new Uint8Array(w * w);
  for (let j = 1; j < s; j++) for (let i = 1; i < s; i++) {
    const k = j * w + i, y = H[k];
    if (hasWater && y <= water + margin) continue;
    const role = navAt(nav, g.grid, i * step, j * step);
    if (role === 1) continue;
    const sl = Math.max(Math.abs(H[k + 1] - y), Math.abs(H[k - 1] - y), Math.abs(H[k + w] - y), Math.abs(H[k - w] - y)) / step;
    if (sl < maxSlope * 0.5 || role === 2) m[k] = 1;
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
  const plat = wg.style === "platforms";
  const PH = wg.platformHeight ?? 150;
  const floorY = plat ? abyssFloor(wg, water, hasWater, medianOf(donor)) : -Infinity;
  /** abaixo disso é abismo (sem árvores, vilas nem massa) */
  const minLand = plat ? floorY + PH * 0.5 : -Infinity;
  if (plat) {
    // plataformas das bases, do centro e de expansão; torres sem ponte; pontes ligando tudo
    const canonPlat: { p: Pt; r: number }[] = [];
    const pr = Math.round(125 * big);
    for (const sp of spawns) features.push({ id: fid(), kind: "platform", pts: [sp], r: pr, h: PH, rough: 0.6, seed: Math.floor(r() * 1e6), gen: true, name: "Plataforma da base" });
    for (const c of canonSpawns) canonPlat.push({ p: c, r: pr });
    if (centerOn) {
      const cr = Math.round(105 * big);
      features.push({ id: fid(), kind: "platform", pts: [[G / 2, G / 2]], r: cr, h: PH, rough: 0.6, seed: Math.floor(r() * 1e6), gen: true, name: "Plataforma central" });
      canonPlat.push({ p: [G / 2, G / 2], r: cr });
    }
    for (let i = 0; i < per(wg.plateaus || 4); i++) {
      const before = features.length;
      if (put("platform", [58 * big, 95 * big], [PH * 0.9, PH * 1.08], 0.6, 175, 95)) canonPlat.push({ p: features[before].pts[0], r: features[before].r });
    }
    // beirais: degraus mais baixos encostados nas plataformas (dão profundidade à queda)
    for (const c of [...canonPlat]) {
      const nb = 1 + Math.floor(r() * 2);
      for (let b = 0; b < nb; b++) {
        const a = r() * Math.PI * 2, rr = lerp(22, 42, r()) * big, d = c.r + rr * 0.45;
        const p: Pt = [Math.round(c.p[0] + Math.cos(a) * d), Math.round(c.p[1] + Math.sin(a) * d)];
        if (p[0] < rr || p[1] < rr || p[0] > G - rr || p[1] > G - rr) continue;
        const copies = ops.map((o) => o.pt(p));
        if (copies.some((q) => spawns.some((s0) => Math.hypot(s0[0] - q[0], s0[1] - q[1]) < 60))) continue;
        if (copies.some((q, k) => copies.some((q2, k2) => k2 > k && Math.hypot(q[0] - q2[0], q[1] - q2[1]) < rr * 2.2))) continue;
        const seed = Math.floor(r() * 1e6), hh = Math.round(PH * lerp(0.35, 0.65, r()));
        ops.forEach((o, k) => features.push({ id: fid(), kind: "platform", pts: [copies[k]], r: Math.round(rr), h: hh, rough: 0.7, seed, m: invert(o.m), gen: true, name: "Beiral" }));
      }
    }
    // torres de pedra no abismo: altas e finas, às vezes em grupo
    for (let i = 0; i < per(wg.mountains); i++) {
      const before = features.length;
      if (!put("platform", [10, 24], [PH * 0.6, PH * 1.45], 0.5, 175, 120)) continue;
      const c = features[before];
      // vizinhas menores ao lado da torre
      const extra = Math.floor(r() * 3);
      for (let q = 0; q < extra; q++) {
        const a = r() * Math.PI * 2, d = c.r * lerp(1.6, 2.6, r()), rr = Math.round(c.r * lerp(0.4, 0.75, r()));
        const p: Pt = [Math.round(c.pts[0][0] + Math.cos(a) * d), Math.round(c.pts[0][1] + Math.sin(a) * d)];
        const copies = ops.map((o) => o.pt(p));
        if (copies.some((q2) => features.some((f) => f.kind === "platform" && f.name !== "Torre" && f.r > 40 && Math.hypot(f.pts[0][0] - q2[0], f.pts[0][1] - q2[1]) < f.r + 40))) continue;
        const seed = Math.floor(r() * 1e6), hh = Math.round(c.h * lerp(0.45, 0.85, r()));
        ops.forEach((o, k) => features.push({ id: fid(), kind: "platform", pts: [copies[k]], r: rr, h: hh, rough: 0.5, seed, m: invert(o.m), gen: true, name: "Torre" }));
      }
      for (let k = before; k < before + ops.length && k < features.length; k++) features[k].name = "Torre";
    }
    // pontes: cada plataforma liga nas duas mais perto (borda a borda)
    const allPlat = canonPlat.flatMap((q) => ops.map((o) => ({ p: o.pt(q.p), r: q.r })));
    const done: Pt[][] = [];
    for (const a of canonPlat) {
      const near = allPlat.filter((b) => Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) > 5)
        .map((b) => ({ b, gap: Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]) - a.r - b.r }))
        .filter((x) => x.gap < 430).sort((x, y) => x.gap - y.gap).slice(0, 2);
      for (const { b } of near) {
        const L = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]), dx = (b.p[0] - a.p[0]) / L, dz = (b.p[1] - a.p[1]) / L;
        const p0: Pt = [a.p[0] + dx * (a.r - 16), a.p[1] + dz * (a.r - 16)], p1: Pt = [b.p[0] - dx * (b.r - 16), b.p[1] - dz * (b.r - 16)];
        if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 12) continue;
        for (const o of ops) {
          const tp = [o.pt(p0), o.pt(p1)].map((q) => q.map((v) => Math.round(v)) as Pt);
          const same = (q: Pt[]) => (Math.hypot(q[0][0] - tp[0][0], q[0][1] - tp[0][1]) < 6 && Math.hypot(q[1][0] - tp[1][0], q[1][1] - tp[1][1]) < 6)
            || (Math.hypot(q[0][0] - tp[1][0], q[0][1] - tp[1][1]) < 6 && Math.hypot(q[1][0] - tp[0][0], q[1][1] - tp[0][1]) < 6);
          if (done.some(same)) continue;
          done.push(tp);
          features.push({ id: fid(), kind: "span", pts: tp, r: 15, h: 0, rough: 0, seed: 9, gen: true });
        }
      }
    }
    notes.push(`${canonPlat.length * ops.length - (centerOn ? ops.length - 1 : 0)} plataformas e ${done.length} pontes sobre o abismo. Mova as plataformas e redesenhe as pontes (Formas → Ponte) à vontade.`);
  }
  // montanhas e elevações
  if (!plat) for (let i = 0; i < per(wg.mountains); i++) put("mountain", [70 * big, 130 * big], [wg.mountainHeight * 0.7, wg.mountainHeight * 1.15], 0.8, 150, 40);
  if (!plat) for (let i = 0; i < per(wg.ridges); i++) putLine("ridge", [34, 55], [wg.mountainHeight * 0.45, wg.mountainHeight * 0.75], 0.8, [220, 420], false);
  if (!plat) for (let i = 0; i < per(wg.hills); i++) put("hill", [45, 95], [8, 22], 0.6, 110, 10);
  if (!plat) for (let i = 0; i < per(wg.plateaus); i++) put("plateau", [60, 100], [12, 24], 0.5, 140, 30);
  if (!plat) for (let i = 0; i < per(wg.dunes); i++) put("dunes", [110, 190], [4, 9], 0.6, 90, 0);
  // cavidades
  if (!plat) for (let i = 0; i < per(wg.craters); i++) put("crater", [35, 80], [10, 22], 0.6, 140, 20);
  if (!plat) for (let i = 0; i < per(wg.canyons); i++) putLine("canyon", [26, 40], [18, 32], 0.6, [260, 480], true);
  // água
  if (!plat) for (let i = 0; i < per(wg.lakes); i++) put("lake", [45, 95], [6, 12], 0.75, 140, 30);
  if (!plat) for (let i = 0; i < per(wg.rivers); i++) putLine("river", [16, 28], [5, 9], 0.6, [380, 700], true);
  if (hasWater && !plat) for (let i = 0; i < per(wg.islands); i++) put("island", [70, 120], [14, 26], 0.7, 130, 40);
  // obstáculos: paredões curtos e íngremes entre as bases (criam gargalos; o passe de conexão garante caminho)
  if (!plat) for (let i = 0; i < per(wg.obstacles ?? 0); i++) putLine("ridge", [16, 24], [26, 40], 0.9, [110, 200], false);
  if (centerOn) features.push({ id: fid(), kind: "pad", pts: [[G / 2, G / 2]], r: 46, h: 0, rough: 0, seed: 2, gen: true, name: "Centro" });
  if (!plat && !hasWater && (wg.lakes || wg.rivers)) notes.push("Este terreno não tem água: lagos e rios viram vales e leitos secos. Para água de verdade escolha um terreno com água (ex.: Open Palms ou Treallach Island).");

  // áreas planas das bases (sempre por último)
  for (const s of spawns) features.push({ id: fid(), kind: "pad", pts: [s], r: 70, h: 0, rough: 0, seed: 1, gen: true, name: "Base" });

  // relevo, depois garante que todas as bases se alcançam (passagens automáticas)
  const base = baseHeights(g, donor, water, hasWater, wg);
  let H = composeWorld(g, donor, water, hasWater, wg, features, base);
  for (let round = 0; round < 6; round++) {
    const mask = walkMask(g, H, water, hasWater, 6, 2, null);
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
      if (features.some((f) => (f.kind === "pass" || f.kind === "span") && ((same(f.pts[0], a) && same(f.pts[1], b)) || (same(f.pts[0], b) && same(f.pts[1], a))))) continue;
      features.push(plat ? { id: fid(), kind: "span", pts: [a, b], r: 15, h: 0, rough: 0, seed: 9, gen: true } : { id: fid(), kind: "pass", pts: [a, b], r: 34, h: 0, rough: 0.2, seed: 7, gen: true });
    }
    H = composeWorld(g, donor, water, hasWater, wg, features, base);
    if (round === 0) notes.push(plat ? "Algumas bases ficaram isoladas: o gerador pôs pontes entre elas." : "Algumas bases ficaram isoladas: o gerador abriu passagens entre elas.");
  }

  const strategic: Strategic[] = [];
  const mass = (wg.resources ?? "generated") === "generated" ? placeMass(g, H, water, hasWater, wg, spawns, canonSpawns, ops, r, centerOn, strategic, notes) : [];
  // vida humana: vilas (chão plano), estradas ligando vilas e bases, plantações em volta
  const villages = planVillages(g, H, water, hasWater, wg, spawns, ops, r, mass, features, centerOn, minLand);
  if (villages.length) {
    for (const v of villages) for (const o of ops) {
      const q = o.pt(v.p);
      features.push({ id: fid(), kind: "pad", pts: [[Math.round(q[0]), Math.round(q[1])]], r: v.r, h: 0, rough: 0, seed: 4, gen: true, name: "Vila" });
    }
    H = composeWorld(g, donor, water, hasWater, wg, features, base);
  }
  const vAll = villages.flatMap((v) => ops.map((o) => ({ ...v, p: o.pt(v.p) })));
  const roads = wg.roads !== false && villages.length ? planRoads(g, H, water, hasWater, villages, vAll, spawns, r) : [];
  // caminhos: cada base liga no centro e nas expansões dela (trilhas de terra que seguem o terreno)
  if (wg.paths !== false && !plat) {
    const targets: Pt[] = [];
    if (centerOn) targets.push([G / 2, G / 2]);
    for (const q of strategic) if (q.kind !== "center") targets.push(q.pos);
    for (const sp of canonSpawns) {
      const mine = targets.filter((t) => {
        const near = spawns.reduce((a, b) => (Math.hypot(b[0] - t[0], b[1] - t[1]) < Math.hypot(a[0] - t[0], a[1] - t[1]) ? b : a), spawns[0]);
        return (near[0] === sp[0] && near[1] === sp[1]) || (t[0] === G / 2 && t[1] === G / 2);
      });
      for (const t of mine.slice(0, 4)) {
        if (Math.hypot(t[0] - sp[0], t[1] - sp[1]) < 60) continue;
        const path = roadPath(g, H, water, hasWater, sp, t);
        if (path) roads.push(path);
      }
    }
  }
  // estradas e caminhos viram formas "Caminho" (editáveis; o chão delas é pintado de terra)
  if (roads.length) {
    const seen: Pt[][] = [];
    for (const path of roads) for (const o of ops) {
      // arredonda antes de espelhar/girar (as cópias caem exatamente nos mesmos inteiros)
      const canon: Pt[] = [];
      for (const q of path) { const l = canon[canon.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) >= 10) canon.push([Math.round(q[0]), Math.round(q[1])]); }
      const end = path[path.length - 1];
      canon.push([Math.round(end[0]), Math.round(end[1])]);
      const tp: Pt[] = canon.map((q) => o.pt(q));
      if (tp.length < 2) continue;
      // a mesma estrada (nos dois sentidos), conferida ponto a ponto: duas estradas espelhadas
      // entre os mesmos lugares ficam as duas (senão a simetria quebra)
      const mid = (a: Pt[]) => a[Math.floor(a.length / 2)];
      const same = (a: Pt[]) => a.length === tp.length && Math.hypot(mid(a)[0] - mid(tp)[0], mid(a)[1] - mid(tp)[1]) < 3
        && ((Math.hypot(a[0][0] - tp[0][0], a[0][1] - tp[0][1]) < 3 && Math.hypot(a[a.length - 1][0] - tp[tp.length - 1][0], a[a.length - 1][1] - tp[tp.length - 1][1]) < 3)
          || (Math.hypot(a[0][0] - tp[tp.length - 1][0], a[0][1] - tp[tp.length - 1][1]) < 3 && Math.hypot(a[a.length - 1][0] - tp[0][0], a[a.length - 1][1] - tp[0][1]) < 3));
      if (seen.some(same)) continue;
      seen.push(tp);
      features.push({ id: fid(), kind: "trail", pts: tp, r: 5, h: 0, rough: 0, seed: 11, gen: true });
    }
    H = composeWorld(g, donor, water, hasWater, wg, features, base);
  }
  const fields = planFields(g, H, water, hasWater, wg, villages, vAll, spawns, mass, features, ops, r);
  const life = expandLife(G, villages, fields, roads, ops);
  const paint = paintLife(G, life, wg.seed);
  if (plat) paintAbyss(g, H, paint, features, minLand);
  const sites: { p: Pt; r: number }[] = [];
  const props = placeProps(g, H, water, hasWater, wg, cat, spawns, features, r, ops, mass, sites, life, { villages, roads }, paint, minLand);
  if (villages.length) notes.push(`${life.villages.length} vila(s), ${life.roads.length} estrada(s) e ${life.fields.length} plantação(ões): o chão delas vem pintado (pincel de textura) e dá para repintar.`);
  if (sites.length) {
    // áreas planas sob as ruínas e postos: as estruturas assentam no chão
    for (const st of sites) features.push({ id: fid(), kind: "pad", pts: [[Math.round(st.p[0]), Math.round(st.p[1])]], r: Math.round(Math.min(90, st.r)), h: 0, rough: 0, seed: 3, gen: true, name: "Estrutura" });
    H = composeWorld(g, donor, water, hasWater, wg, features, base);
  }
  // passagem: partes íngremes fechadas para as tropas (menos perto de bases, massa, passagens,
  // pontes e caminhos); se isso separar alguma base, fica tudo liberado
  let nav: PaintLayer | null = null;
  if (wg.blockSteep !== false && wg.smooth !== undefined) {
    nav = steepNav(g, H, features, spawns, mass, plat ? 0.9 : 1.15);
    const m = walkMask(g, H, water, hasWater, 6, 2, nav);
    const d0 = walkDistances(g, m, spawns[0]);
    if (spawns.some((sp) => distAt(g, d0, sp) < 0)) { nav = null; notes.push("Algumas montanhas ficariam separando bases: o mapa de passagem ficou todo liberado."); }
    else if (nav.power.some((v) => v)) notes.push("As encostas íngremes ficam fechadas para as tropas por terra (em vermelho no modo Passagem). Ajuste com o pincel de passagem.");
    else nav = null;
  }
  return { features, spawns, props, heights: H, notes, mass, strategic, paint: paint.power.some((v) => v) ? paint : null, life, nav };
}

/** Massa simétrica: expansões seguras e disputadas por jogador e o centro, em chão plano, seco e alcançável. */
function placeMass(g: Grid, H: Float32Array, water: number, hasWater: boolean, wg: WorldGen, spawns: Pt[], canon: Pt[], ops: ReturnType<typeof symmetryOps>,
  r: () => number, centerOn: boolean, strategic: Strategic[], notes: string[]): Pt[] {
  const G = g.grid, s = g.size, w = s + 1, step = G / s;
  const hAt = (x: number, z: number) => H[Math.max(0, Math.min(s, Math.round(z / step))) * w + Math.max(0, Math.min(s, Math.round(x / step)))];
  const mask = walkMask(g, H, water, hasWater, 6, 2, null);
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

/** Vilas, florestas, pedras, estruturas e destroços (na região fundamental, repetidos pela simetria). */
function placeProps(g: Grid, H: Float32Array, water: number, hasWater: boolean, wg: WorldGen, cat: PropCatalog, spawns: Pt[], features: Feature[], r: () => number,
  ops: ReturnType<typeof symmetryOps>, mass: Pt[] = [], sites: { p: Pt; r: number }[] = [],
  life: Life | null = null, canon: { villages: Village[]; roads: Pt[][] } = { villages: [], roads: [] }, paint: PaintLayer | null = null,
  minLand = -Infinity): PlacedProp[] {
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
  const onLine = (x: number, z: number) => features.some((f) => (f.kind === "pass" || f.kind === "river" || f.kind === "span") && f.pts.length > 1 && lineDist(f.pts, x, z)[0] < f.r * 1.2);
  const human = (x: number, z: number) => lifeAt(life, x, z);
  /** fundo do abismo (estilo plataformas): sem árvores, vilas e ruínas */
  const deep = (x: number, z: number) => hAt(x, z) < minLand;
  const inRegion = (x: number, z: number) => inFundamental(wg.symmetry, G, x, z);
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
  /** pinta um disco do chão em todas as cópias (chão das matas) */
  const dab = (x: number, z: number, rad: number, role: number, pw: number) => {
    if (!paint) return;
    const n = paint.n, pw1 = n + 1, cs = G / n;
    for (const o of ops) {
      const [px, pz] = o.pt([x, z]);
      for (let j = Math.max(0, Math.floor((pz - rad) / cs)); j <= Math.min(n, Math.ceil((pz + rad) / cs)); j++) for (let i = Math.max(0, Math.floor((px - rad) / cs)); i <= Math.min(n, Math.ceil((px + rad) / cs)); i++) {
        const d = Math.hypot(i * cs - px, j * cs - pz) / rad;
        if (d >= 1) continue;
        const k = j * pw1 + i, v = Math.round(pw * (1 - d * d));
        if (v > paint.power[k]) { paint.power[k] = v; paint.role[k] = role; }
      }
    }
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
  const forest = simplex(wg.seed + 977), rockN = simplex(wg.seed + 1931), species = simplex(wg.seed + 4111);
  const budget = (share: number) => Math.floor((MAX * share) / ops.length);
  const catOf = (bp: string) => bp.toLowerCase().split("/")[2] ?? "";
  const sub = (c: { pool: string[]; local: string[] }, f: (bp: string) => boolean) => ({ pool: c.pool.filter(f), local: c.local.filter(f) });

  const buildings = choose(cat.buildings), wrecks = choose(cat.wrecks), others = choose(cat.other.length ? cat.other : cat.rocks);
  const trees = choose(cat.trees.filter((bp) => { const m = meta(bp); return m.h > 0.4 && m.r < 30 && !/kelp/i.test(bp); }));
  const groups = sub(trees, (bp) => meta(bp).group), singles = sub(trees, (bp) => !meta(bp).group);
  const rocks = choose(cat.rocks);
  // peças das vilas
  const houses = sub(buildings, (bp) => ["buildings", "structures"].includes(catOf(bp)) && meta(bp).r >= 2.5 && meta(bp).r <= 16);
  const sheds = sub(buildings, (bp) => catOf(bp) === "warehouses" && meta(bp).r <= 26);
  const lamps = sub(buildings, (bp) => catOf(bp) === "lights");
  const crates = sub(others, (bp) => meta(bp).r <= 4);
  const smallRocks = sub(rocks, (bp) => meta(bp).r <= 3.5);
  const ruins = wg.biome === "volcanic";

  // ---------------------------------------------------------------- vilas
  for (const v of canon.villages) {
    const ca = Math.cos(v.ang), sa = Math.sin(v.ang), deg = (v.ang * 180) / Math.PI;
    const streets: { dir: Pt; L: number; yaw: number }[] = [{ dir: [ca, sa], L: v.r * 0.95, yaw: deg }];
    if (v.cross) streets.push({ dir: [-sa, ca], L: v.r * 0.7, yaw: deg + 90 });
    // ruas e praça livres de decoração
    for (const st of streets) for (let t = -st.L; t <= st.L; t += 3) for (const o of ops) { const q = o.pt([v.p[0] + st.dir[0] * t, v.p[1] + st.dir[1] * t]); mark(q[0], q[1], 4.5); }
    for (const o of ops) { const q = o.pt(v.p); mark(q[0], q[1], 12); }
    const housePool = ruins && wrecks.pool.length ? wrecks : houses.pool.length ? houses : buildings;
    if (!housePool.pool.length) continue;
    for (const st of streets) {
      const px = -st.dir[1], pz = st.dir[0];
      for (const side of [-1, 1]) {
        for (let t = -st.L + 6; t < st.L - 4;) {
          if (Math.abs(t) < 14) { t += 8; continue; } // praça
          const bp = pick(housePool), br = meta(bp).r;
          const sc = lerp(0.9, 1.05, r());
          const off = 4.2 + br * sc + 1.5;
          const x = v.p[0] + st.dir[0] * (t + br) + px * side * off, z = v.p[1] + st.dir[1] * (t + br) + pz * side * off;
          if (r() < 0.12 && singles.pool.length && !ruins) emit(pick(singles), x, z, r() * 360, lerp(0.7, 0.95, r())); // quintal com árvore
          else if (!wet(x, z) && slope(x, z) < 0.6) emit(bp, x, z, st.yaw + (side > 0 ? 90 : 270), sc);
          t += br * 2 * sc + lerp(2.5, 7, r());
        }
      }
      // postes ao longo da rua
      if (lamps.pool.length && !ruins) for (let t = -st.L + 8, k = 0; t <= st.L - 4; t += 22, k++) {
        const side = k % 2 ? 1 : -1;
        emit(pick(lamps), v.p[0] + st.dir[0] * t + px * side * 5.2, v.p[1] + st.dir[1] * t + pz * side * 5.2, st.yaw, 1);
      }
    }
    // armazéns nas pontas da rua principal, com caixas em volta
    for (const end of [-1, 1]) {
      if (!sheds.pool.length || r() < 0.3) continue;
      const bp = pick(sheds), br = meta(bp).r;
      const d = v.r * 0.95 + br + 6;
      const x = v.p[0] + ca * d * end + (-sa) * (br + 8), z = v.p[1] + sa * d * end + ca * (br + 8);
      if (wet(x, z) || slope(x, z) > 0.5) continue;
      if (emit(bp, x, z, deg + (end > 0 ? 0 : 180), lerp(0.9, 1.05, r())) && crates.pool.length) {
        for (let q = 0; q < 2 + Math.floor(r() * 4); q++) {
          const a = r() * Math.PI * 2, dd = br + lerp(3, 9, r());
          emit(pick(crates), x + Math.cos(a) * dd, z + Math.sin(a) * dd, Math.round(r() * 4) * 90 + (r() - 0.5) * 16, lerp(0.85, 1.15, r()));
        }
      }
    }
    // caixas e pedrinhas soltas pelas ruas e árvores na volta da vila
    for (let q = 0; q < 6; q++) {
      const a = r() * Math.PI * 2, d = lerp(16, v.r * 0.9, r());
      const list = crates.pool.length && r() < 0.6 ? crates : smallRocks;
      if (list.pool.length) emit(pick(list), v.p[0] + Math.cos(a) * d, v.p[1] + Math.sin(a) * d, r() * 360, lerp(0.8, 1.1, r()));
    }
    if (singles.pool.length && !ruins) for (let q = 0; q < 10; q++) {
      const a = r() * Math.PI * 2, d = v.r * lerp(0.95, 1.35, r());
      const x = v.p[0] + Math.cos(a) * d, z = v.p[1] + Math.sin(a) * d;
      if (!wet(x, z) && human(x, z) !== 3 && human(x, z) !== 2) emit(pick(singles), x, z, r() * 360, lerp(0.75, 1.1, r()));
    }
  }

  // ---------------------------------------------------------------- plataformas: pontes e bordas
  if (Number.isFinite(minLand)) {
    const gate = sub(buildings, (bp) => /gate/i.test(bp) && meta(bp).r <= 24);
    const debris = sub(wrecks, (bp) => catOf(bp) === "debris");
    // pontes: portal nas cabeceiras, postes dos dois lados e caixas de vez em quando
    for (const f of features) {
      if (f.kind !== "span" || f.pts.length < 2) continue;
      const [a, b] = [f.pts[0], f.pts[f.pts.length - 1]];
      if (!inRegion((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      const yaw = (Math.atan2(dz, dx) * 180) / Math.PI;
      if (gate.pool.length) for (const [p, s0] of [[a, 1], [b, -1]] as const) emit(pick(gate), p[0] + dx * s0 * 4, p[1] + dz * s0 * 4, yaw + 90, 1, false);
      if (lamps.pool.length) for (let t = 14, k = 0; t < L - 10; t += 26, k++) {
        for (const side of [-1, 1]) emit(pick(lamps), a[0] + dx * t - dz * side * f.r * 0.78, a[1] + dz * t + dx * side * f.r * 0.78, yaw, 1, false);
      }
      if (crates.pool.length && L > 60 && r() < 0.5) emit(pick(crates), a[0] + dx * L * 0.5 + dz * f.r * 0.5, a[1] + dz * L * 0.5 - dx * f.r * 0.5, yaw, lerp(0.8, 1.1, r()));
    }
    // bordas: pedrinhas e entulho na beira; pedras grandes no pé dos paredões; destroços no fundo
    for (const f of features) {
      if (f.kind !== "platform" || !inRegion(f.pts[0][0], f.pts[0][1])) continue;
      const per = Math.max(8, Math.round((2 * Math.PI * f.r) / 10));
      for (let k = 0; k < per; k++) {
        const ang = (k / per) * Math.PI * 2 + r() * 0.2, rim = platformRim(f, ang), W = wallWidth(f);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        if (r() < 0.32) {
          const list = r() < 0.5 && debris.pool.length ? debris : smallRocks.pool.length ? smallRocks : rocks;
          if (list.pool.length) emit(pick(list), f.pts[0][0] + ca * (rim - 3), f.pts[0][1] + sa * (rim - 3), r() * 360, lerp(0.6, 1.1, r()));
        }
        if (r() < 0.22 && rocks.pool.length) emit(pick(rocks), f.pts[0][0] + ca * (rim + W * lerp(1.05, 1.5, r())), f.pts[0][1] + sa * (rim + W * lerp(1.05, 1.5, r())), r() * 360, lerp(1.2, 2.4, r()));
      }
    }
    if (wrecks.pool.length) for (let k = 0, tries = 0; k < budget(0.05) && tries < 500; tries++) {
      const x = 20 + r() * (G - 40), z = 20 + r() * (G - 40);
      if (!inRegion(x, z) || !deep(x, z) || slope(x, z) > 0.6) continue;
      if (emit(pick(r() < 0.5 && debris.pool.length ? debris : wrecks), x, z, r() * 360, lerp(0.8, 1.3, r()))) k++;
    }
  }

  // ---------------------------------------------------------------- beira das estradas
  for (const path of canon.roads) {
    let acc = 0, k = 0;
    for (let q = 0; q < path.length - 1; q++) {
      const [a, b] = [path[q], path[q + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!L) continue;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (let t = 0; t < L; t++) {
        acc++;
        if (acc < 30) continue;
        acc = 0; k++;
        const x = a[0] + dx * t, z = a[1] + dz * t;
        if (nearSpawn(x, z, 85) || canon.villages.some((v) => Math.hypot(v.p[0] - x, v.p[1] - z) < v.r + 4)) continue;
        const side = k % 2 ? 1 : -1, off = 8 + r() * 4;
        const px = x - dz * side * off, pz = z + dx * side * off;
        if (wet(px, pz) || human(px, pz) === 3) continue;
        const nearVillage = canon.villages.some((v) => Math.hypot(v.p[0] - x, v.p[1] - z) < v.r * 1.8);
        if (nearVillage && lamps.pool.length && !ruins && r() < 0.6) emit(pick(lamps), x - dz * side * 5.5, z + dx * side * 5.5, (Math.atan2(dz, dx) * 180) / Math.PI, 1);
        else if (wg.biome === "temperate" && singles.pool.length && r() < 0.55) emit(pick(singles), px, pz, r() * 360, lerp(0.8, 1.1, r()));
        else if (smallRocks.pool.length && r() < 0.35) emit(pick(smallRocks), px, pz, r() * 360, lerp(0.7, 1.2, r()));
        else if (wrecks.pool.length && r() < wg.wrecks * 0.12) emit(pick(wrecks), px, pz, r() * 360, lerp(0.85, 1.1, r()));
      }
    }
  }

  // ---------------------------------------------------------------- estruturas soltas (ruínas e postos)
  const nSites = Math.max(0, Math.round(wg.structures / ops.length));
  for (let k = 0, tries = 0; k < nSites && tries < 400; tries++) {
    const x = 90 + r() * (G - 180), z = 90 + r() * (G - 180);
    if (!inRegion(x, z) || wet(x, z) || slope(x, z) > 0.45 || nearSpawn(x, z, 160) || onLine(x, z) || human(x, z) || deep(x, z)) continue;
    if (life?.villages.some((v) => Math.hypot(v.p[0] - x, v.p[1] - z) < v.r + 70)) continue;
    const center = buildings.pool.length ? pick(buildings) : wrecks.pool.length ? pick(wrecks) : null;
    if (!center) break;
    const cr = meta(center).r;
    if (!emit(center, x, z, Math.round(r() * 4) * 90, lerp(0.9, 1.1, r()))) continue;
    k++;
    const ring = 5 + Math.floor(r() * 6);
    let reach = cr;
    for (let q = 0; q < ring; q++) {
      const list = r() < 0.45 && buildings.pool.length ? buildings : wrecks.pool.length && r() < 0.7 ? wrecks : others;
      if (!list.pool.length) continue;
      const bp = pick(list);
      const a = (q / ring) * Math.PI * 2 + r() * 0.4, d = cr + meta(bp).r + lerp(3, 12, r());
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (wet(px, pz) || slope(px, pz) > 0.7) continue;
      if (emit(bp, px, pz, Math.round(r() * 4) * 90 + (r() - 0.5) * 20, lerp(0.85, 1.15, r()))) reach = Math.max(reach, d + meta(bp).r);
    }
    // o chão do conjunto fica plano (nada meio enterrado, meio flutuando)
    for (const o of ops) sites.push({ p: o.pt([x, z]), r: reach + 6 });
    dab(x, z, reach + 4, 2, 120);
  }

  // ---------------------------------------------------------------- florestas
  // manchas de ruído; o miolo usa bosques inteiros (modelos de grupo), a borda árvores soltas e
  // menores; cada mancha tende a uma espécie (bosques de uma árvore só, como na natureza)
  const speciesOf = (x: number, z: number) => {
    const list = singles.local.length && r() < 0.6 ? singles.local : singles.pool;
    if (!list.length) return pick(groups);
    if (r() < 0.25) return list[Math.floor(r() * list.length)];
    const f = (species(x / 240, z / 240) + 1) / 2;
    return list[Math.min(list.length - 1, Math.floor(f * list.length))];
  };
  const thr = lerp(0.45, -0.15, wg.forests);
  const forestDepth = (x: number, z: number) => fbm(forest, x / 160, z / 160, 4) - thr;
  if (trees.pool.length && wg.forests > 0) {
    const inForest = (x: number, z: number) => {
      if (!inRegion(x, z) || x < 8 || z < 8 || x > G - 8 || z > G - 8) return -1;
      const f = forestDepth(x, z);
      if (f < 0 || wet(x, z) || slope(x, z) > 1.0 || nearSpawn(x, z, 95) || onLine(x, z) || human(x, z) || deep(x, z)) return -1;
      return f;
    };
    // área de floresta (amostrada) para caber no orçamento de decorações
    let area = 0;
    for (let z = 4; z < G; z += 8) for (let x = 4; x < G; x += 8) if (inForest(x, z) >= 0) area += 64;
    const maxN = budget(0.5);
    const single = singles.pool.length ? singles.pool.reduce((a, bp) => a + meta(bp).r, 0) / singles.pool.length : 2;
    let spacing = Math.max(single * 2.6, lerp(10, 4.5, wg.forests));
    const groupChance = groups.pool.length ? Math.min(0.85, Math.max(0.15, area / (spacing * spacing) / maxN - 0.6)) : 0;
    if (area / (spacing * spacing) * (1 - groupChance * 0.8) > maxN) spacing = Math.sqrt(area / maxN);
    let placed = 0;
    for (let z = spacing / 2; z < G && placed < maxN; z += spacing) for (let x = spacing / 2; x < G && placed < maxN; x += spacing) {
      const jx = x + (r() - 0.5) * spacing * 0.9, jz = z + (r() - 0.5) * spacing * 0.9;
      const depth = inForest(jx, jz);
      if (depth < 0) continue;
      const deep = depth > 0.12, edge = depth < 0.05;
      const useGroup = deep && groups.pool.length > 0 && r() < groupChance;
      const bp = useGroup ? pick(groups) : speciesOf(jx, jz);
      // borda: árvores mais baixas (mata nova); miolo: as maiores
      const sc = edge ? lerp(0.55, 0.85, r()) : deep ? lerp(0.95, 1.35, r()) : lerp(0.8, 1.2, r());
      if (emit(bp, jx, jz, r() * 360, sc)) {
        placed++;
        // chão da mata: terra e folhas embaixo das árvores
        if (!edge) dab(jx, jz, spacing * 0.9, 2, 55 + Math.min(70, depth * 260));
      }
    }
  }

  // árvores na beira de rios e lagos, e árvores sozinhas nos campos
  if (singles.pool.length && wg.forests > 0 && wg.biome !== "desert") {
    const maxN = budget(0.06);
    let placed = 0;
    for (let z = 10; z < G && placed < maxN; z += 12) for (let x = 10; x < G && placed < maxN; x += 12) {
      const jx = x + (r() - 0.5) * 10, jz = z + (r() - 0.5) * 10;
      if (!inRegion(jx, jz) || jx < 10 || jz < 10 || jx > G - 10 || jz > G - 10 || human(jx, jz) || nearSpawn(jx, jz, 100) || onLine(jx, jz) || deep(jx, jz)) continue;
      const h = hAt(jx, jz), sl = slope(jx, jz);
      if (sl > 0.6) continue;
      const shore = hasWater ? h > water + 1.2 && h < water + 5.5
        : features.some((f) => (f.kind === "river" && f.pts.length > 1 && Math.abs(lineDist(f.pts, jx, jz)[0] - f.r * 1.6) < f.r * 0.5)
          || (f.kind === "lake" && Math.abs(Math.hypot(f.pts[0][0] - jx, f.pts[0][1] - jz) - f.r * 1.15) < 10));
      const meadow = !shore && forestDepth(jx, jz) < -0.08 && r() < 0.012 * (0.4 + wg.forests);
      if (!(shore && r() < 0.32) && !meadow) continue;
      if (emit(speciesOf(jx, jz), jx, jz, r() * 360, meadow ? lerp(1, 1.4, r()) : lerp(0.75, 1.15, r()))) placed++;
    }
  }

  // ---------------------------------------------------------------- pedras
  // grupos de 2 a 5 bem juntos, mais nas encostas, nas montanhas e no pé dos paredões
  if (rocks.pool.length && wg.rocks > 0) {
    const spacing = lerp(70, 24, wg.rocks);
    const maxN = budget(0.2);
    let placed = 0;
    for (let z = spacing / 2; z < G && placed < maxN; z += spacing) for (let x = spacing / 2; x < G && placed < maxN; x += spacing) {
      const jx = x + (r() - 0.5) * spacing, jz = z + (r() - 0.5) * spacing;
      if (!inRegion(jx, jz) || jx < 8 || jz < 8 || jx > G - 8 || jz > G - 8 || human(jx, jz)) continue;
      const sl = slope(jx, jz);
      let up = 0;
      for (let a = 0; a < 6; a++) up = Math.max(up, slope(jx + Math.cos(a) * 14, jz + Math.sin(a) * 14));
      const foot = up > 0.85 && sl < 0.5 ? 0.45 : 0;
      const chance = 0.18 + Math.min(0.6, sl * 0.5) + foot + 0.2 * rockN(jx / 90, jz / 90);
      if (r() > chance * wg.rocks * 1.4 || wet(jx, jz) || nearSpawn(jx, jz, 85) || onLine(jx, jz)) continue;
      const kind = pick(rocks), rr = meta(kind).r;
      const cluster = 2 + Math.floor(r() * (foot ? 6 : 4));
      for (let c = 0; c < cluster; c++) {
        const a = r() * Math.PI * 2, d = c === 0 ? 0 : rr * lerp(1.2, 2.6, r());
        // pedras grandes no meio, pequenas em volta
        const sc = c === 0 ? lerp(1, 1.6, r()) : lerp(0.5, 1.1, r());
        if (emit(c && smallRocks.pool.length && r() < 0.5 ? pick(smallRocks) : kind, jx + Math.cos(a) * d, jz + Math.sin(a) * d, r() * 360, sc)) placed++;
      }
    }
  }

  // destroços espalhados (restos de batalha)
  if (wrecks.pool.length && wg.wrecks > 0) {
    const n = Math.min(budget(0.08), Math.round((wg.wrecks * 30) / ops.length));
    for (let k = 0, tries = 0; k < n && tries < 600; tries++) {
      const x = 40 + r() * (G - 80), z = 40 + r() * (G - 80);
      if (!inRegion(x, z) || wet(x, z) || nearSpawn(x, z, 120) || slope(x, z) > 0.8 || human(x, z) === 1 || human(x, z) === 2) continue;
      if (emit(pick(wrecks), x, z, r() * 360, lerp(0.85, 1.15, r()))) {
        k++;
        dab(x, z, 7, 2, 110); // chão revirado em volta
      }
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

/**
 * Chão plano embaixo de cada ponto de massa (o extrator do jogo fica torto e meio enterrado em
 * chão irregular): disco plano de raio `r` na altura média, com borda suave até `r + fade`.
 */
export function massPads(g: Grid, H: Float32Array, mass: Pt[], water: number, hasWater: boolean, r = 6, fade = 6) {
  if (!mass.length) return H;
  const s = g.size, w = s + 1, step = g.grid / s;
  for (const [mx, mz] of mass) {
    const R = r + fade;
    const i0 = Math.max(0, Math.floor((mx - R) / step)), i1 = Math.min(s, Math.ceil((mx + R) / step));
    const j0 = Math.max(0, Math.floor((mz - R) / step)), j1 = Math.min(s, Math.ceil((mz + R) / step));
    let acc = 0, n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (Math.hypot(i * step - mx, j * step - mz) <= r) { acc += H[j * w + i]; n++; }
    }
    if (!n) continue;
    let y = acc / n;
    if (hasWater) y = Math.max(y, water + 2);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i * step - mx, j * step - mz);
      if (d >= R) continue;
      const k = j * w + i;
      H[k] = lerp(H[k], y, smooth(R, r, d));
    }
  }
  return H;
}

/** Reamostra uma grade (n+1)² para (m+1)² (bilinear): camadas salvas em outra resolução. */
export function resampleGrid(src: Float32Array, n: number, m: number): Float32Array {
  if (n === m) return src;
  const out = new Float32Array((m + 1) ** 2), w = n + 1;
  for (let j = 0; j <= m; j++) for (let i = 0; i <= m; i++) {
    const fx = (i / m) * n, fz = (j / m) * n;
    const i0 = Math.min(n - 1, Math.floor(fx)), j0 = Math.min(n - 1, Math.floor(fz));
    const u = fx - i0, v = fz - j0, k = j0 * w + i0;
    out[j * (m + 1) + i] = (src[k] * (1 - u) + src[k + 1] * u) * (1 - v) + (src[k + w] * (1 - u) + src[k + w + 1] * u) * v;
  }
  return out;
}

// ------------------------------------------------------------------ vida humana: vilas, estradas, plantações

/** Vila: centro, raio, direção da rua principal (radianos) e se tem rua cruzada. */
export interface Village { p: Pt; r: number; ang: number; cross: boolean }
/** Plantação: retângulo (centro, direção, comprimento a, largura b) e o tipo de faixa. */
export interface FieldPlot { c: Pt; ang: number; a: number; b: number; kind: 0 | 1 | 2 }
/** O que o gerador pôs de "humano" no mapa (todas as cópias da simetria). */
export interface Life { villages: Village[]; fields: FieldPlot[]; roads: Pt[][]; mask: Uint8Array; cell: number }

/** resolução da pintura do gerador (pontos por lado) — igual à do pincel nos mapas novos */
export const WORLD_PAINT_N = 512;

/** região fundamental da simetria (o resto é cópia) */
export function inFundamental(sym: Symmetry, G: number, x: number, z: number) {
  switch (sym) {
    case "mirror-x": return x <= G / 2;
    case "mirror-z": return z <= G / 2;
    case "diag": return z >= x;
    case "rot2": return z >= G / 2;
    case "rot4": return x <= G / 2 && z <= G / 2;
    default: return true;
  }
}
const mapAng = (a: number, m: [number, number, number, number]) => {
  const dx = Math.cos(a), dz = Math.sin(a);
  return Math.atan2(m[2] * dx + m[3] * dz, m[0] * dx + m[1] * dz);
};

function heightReader(g: Grid, H: Float32Array) {
  const s = g.size, w = s + 1, step = g.grid / s;
  return (x: number, z: number) => {
    const fx = Math.max(0, Math.min(s - 1e-6, x / step)), fz = Math.max(0, Math.min(s - 1e-6, z / step));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * w + i;
    return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + w] * (1 - u) + H[k + w + 1] * u) * v;
  };
}

/** Lugares para as vilas (só na região fundamental; as cópias vêm da simetria). */
function planVillages(g: Grid, H: Float32Array, water: number, hasWater: boolean, wg: WorldGen, spawns: Pt[], ops: ReturnType<typeof symmetryOps>,
  r: () => number, mass: Pt[], features: Feature[], centerOn: boolean, minLand = -Infinity): Village[] {
  const want = wg.settlements ?? 0;
  if (want <= 0) return [];
  const G = g.grid, hAt = heightReader(g, H), big = Math.max(0.7, Math.min(1.3, G / 1024));
  const n = Math.max(1, Math.round(want / ops.length));
  const out: Village[] = [];
  const all = () => out.flatMap((v) => ops.map((o) => ({ p: o.pt(v.p), r: v.r })));
  for (let tries = 0; out.length < n && tries < 900; tries++) {
    const R = lerp(46, 70, r()) * big;
    const x = R + 50 + r() * (G - 2 * R - 100), z = R + 50 + r() * (G - 2 * R - 100);
    if (!inFundamental(wg.symmetry, G, x, z)) continue;
    const copies = ops.map((o) => o.pt([x, z]));
    if (copies.some((c) => spawns.some((s0) => Math.hypot(s0[0] - c[0], s0[1] - c[1]) < 175 + R))) continue;
    if (centerOn && copies.some((c) => Math.hypot(c[0] - G / 2, c[1] - G / 2) < 95 + R)) continue;
    if (copies.some((c, k) => copies.some((c2, k2) => k2 > k && Math.hypot(c[0] - c2[0], c[1] - c2[1]) < 2 * R + 40))) continue;
    if (copies.some((c) => all().some((v) => Math.hypot(v.p[0] - c[0], v.p[1] - c[1]) < (R + v.r) * 1.6 + 60))) continue;
    if (copies.some((c) => mass.some((m) => Math.hypot(m[0] - c[0], m[1] - c[1]) < R + 14))) continue;
    // longe de rios, lagos e montanhas
    const blocked = features.some((f) => {
      if (f.kind === "river" || f.kind === "canyon" || f.kind === "ridge") return f.pts.length > 1 && lineDist(f.pts, x, z)[0] < f.r * 2 + R;
      if (f.kind === "lake" || f.kind === "mountain" || f.kind === "crater") return Math.hypot(f.pts[0][0] - x, f.pts[0][1] - z) < f.r * 1.25 + R;
      return false;
    });
    if (blocked) continue;
    // chão quase plano e seco
    const h0 = hAt(x, z);
    let ok = !(hasWater && h0 < water + 4) && h0 > minLand;
    for (let a = 0; ok && a < 12; a++) for (const d of [R * 0.5, R]) {
      const px = x + Math.cos((a / 12) * Math.PI * 2) * d, pz = z + Math.sin((a / 12) * Math.PI * 2) * d;
      const h = hAt(px, pz);
      if (Math.abs(h - h0) > R * 0.2 || (hasWater && h < water + 3)) { ok = false; break; }
    }
    if (!ok) continue;
    out.push({ p: [Math.round(x), Math.round(z)], r: Math.round(R), ang: Math.round(r() * 180) * Math.PI / 180, cross: r() < 0.6 });
  }
  return out;
}

/** Caminho de menor esforço (A* numa grade grossa): evita subidas, água e paredões. */
function roadPath(g: Grid, H: Float32Array, water: number, hasWater: boolean, a: Pt, b: Pt): Pt[] | null {
  const G = g.grid, C = Math.max(6, G / 160), N = Math.ceil(G / C), W = N + 1;
  const hAt = heightReader(g, H);
  const hs = new Float32Array(W * W);
  for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) hs[j * W + i] = hAt(Math.min(G, i * C), Math.min(G, j * C));
  const idx = (p: Pt) => Math.min(N, Math.max(0, Math.round(p[1] / C))) * W + Math.min(N, Math.max(0, Math.round(p[0] / C)));
  const start = idx(a), goal = idx(b), gi = goal % W, gj = (goal - gi) / W;
  const cost = new Float32Array(W * W).fill(Infinity), from = new Int32Array(W * W).fill(-1);
  // fila de prioridade (heap binário)
  const heap: number[] = [], pri: number[] = [];
  const push = (k: number, p: number) => {
    heap.push(k); pri.push(p);
    let c = heap.length - 1;
    while (c > 0) { const q = (c - 1) >> 1; if (pri[q] <= pri[c]) break; [heap[q], heap[c]] = [heap[c], heap[q]]; [pri[q], pri[c]] = [pri[c], pri[q]]; c = q; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop()!, lp = pri.pop()!;
    if (heap.length) {
      heap[0] = last; pri[0] = lp;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, rr = l + 1;
        let m = c;
        if (l < heap.length && pri[l] < pri[m]) m = l;
        if (rr < heap.length && pri[rr] < pri[m]) m = rr;
        if (m === c) break;
        [heap[m], heap[c]] = [heap[c], heap[m]]; [pri[m], pri[c]] = [pri[c], pri[m]]; c = m;
      }
    }
    return top;
  };
  cost[start] = 0;
  push(start, 0);
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  let found = false;
  for (let it = 0; heap.length && it < W * W * 4; it++) {
    const k = pop();
    if (k === goal) { found = true; break; }
    const i = k % W, j = (k - i) / W, ck = cost[k];
    for (const [di, dj] of D) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni > N || nj > N) continue;
      const nk = nj * W + ni, len = (di && dj ? Math.SQRT2 : 1) * C;
      const sl = Math.abs(hs[nk] - hs[k]) / len;
      let c = len * (1 + 34 * sl * sl + (sl > 0.45 ? 60 : 0));
      if (hasWater && hs[nk] < water + 1.5) c += 2500; // vau: só se não houver volta
      // bordas do mapa: estrada não corre colada na borda
      const e = Math.min(ni, nj, N - ni, N - nj) * C;
      if (e < 30) c += (30 - e) * 3;
      const nc = ck + c;
      if (nc < cost[nk]) { cost[nk] = nc; from[nk] = k; push(nk, nc + Math.hypot(ni - gi, nj - gj) * C); }
    }
  }
  if (!found) return null;
  const cells: Pt[] = [];
  for (let k = goal; k >= 0; k = from[k]) { const i = k % W; cells.push([i * C, ((k - i) / W) * C]); if (k === start) break; }
  cells.reverse();
  cells[0] = a; cells[cells.length - 1] = b;
  // curvas suaves (Chaikin)
  let pts = cells;
  for (let it = 0; it < 3; it++) {
    const nx: Pt[] = [pts[0]];
    for (let k = 0; k < pts.length - 1; k++) {
      const p0 = pts[k], p1 = pts[k + 1];
      nx.push([p0[0] * 0.75 + p1[0] * 0.25, p0[1] * 0.75 + p1[1] * 0.25], [p0[0] * 0.25 + p1[0] * 0.75, p0[1] * 0.25 + p1[1] * 0.75]);
    }
    nx.push(pts[pts.length - 1]);
    pts = nx;
  }
  // menos pontos (um a cada ~6 unidades)
  const out: Pt[] = [pts[0]];
  for (const q of pts) { const l = out[out.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) >= 6) out.push(q); }
  out.push(pts[pts.length - 1]);
  return out.map((q) => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10] as Pt);
}

/** Estradas: cada vila liga na base mais perto e na vila vizinha (cópias pela simetria). */
function planRoads(g: Grid, H: Float32Array, water: number, hasWater: boolean, villages: Village[], allVillages: Village[], spawns: Pt[], r: () => number): Pt[][] {
  const out: Pt[][] = [];
  const near = (p: Pt, list: Pt[]) => list.reduce((a, b) => (Math.hypot(b[0] - p[0], b[1] - p[1]) < Math.hypot(a[0] - p[0], a[1] - p[1]) ? b : a), list[0]);
  for (const v of villages) {
    const sp = near(v.p, spawns);
    const path = roadPath(g, H, water, hasWater, v.p, sp);
    if (path) out.push(path);
    const others = allVillages.filter((o) => Math.hypot(o.p[0] - v.p[0], o.p[1] - v.p[1]) > 5).map((o) => o.p);
    if (others.length && r() < 0.85) {
      const o = near(v.p, others);
      if (Math.hypot(o[0] - v.p[0], o[1] - v.p[1]) < g.grid * 0.62) {
        const p2 = roadPath(g, H, water, hasWater, v.p, o);
        if (p2) out.push(p2);
      }
    }
  }
  return out;
}

/** Plantações em volta das vilas (retângulos na direção das ruas). */
function planFields(g: Grid, H: Float32Array, water: number, hasWater: boolean, wg: WorldGen, villages: Village[], allVillages: Village[], spawns: Pt[], mass: Pt[],
  features: Feature[], ops: ReturnType<typeof symmetryOps>, r: () => number): FieldPlot[] {
  const farms = wg.farms ?? 0;
  if (farms <= 0 || wg.biome !== "temperate") return [];
  const G = g.grid, hAt = heightReader(g, H);
  const out: FieldPlot[] = [];
  const all = () => out.flatMap((f) => ops.map((o) => ({ ...f, c: o.pt(f.c) })));
  for (const v of villages) {
    const want = Math.round(farms * lerp(3, 7, r()));
    for (let k = 0, tries = 0; k < want && tries < 60; tries++) {
      const a = lerp(34, 72, r()), b = lerp(22, 42, r());
      const ang = v.ang + (r() < 0.5 ? 0 : Math.PI / 2) + (r() - 0.5) * 0.12;
      const dirA = r() * Math.PI * 2, d = v.r + 14 + Math.max(a, b) * 0.5 + r() * 90;
      const c: Pt = [v.p[0] + Math.cos(dirA) * d, v.p[1] + Math.sin(dirA) * d];
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const corners: Pt[] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]].map(([u, w2]) => [c[0] + ca * u * a / 2 - sa * w2 * b / 2, c[1] + sa * u * a / 2 + ca * w2 * b / 2]);
      const h0 = hAt(c[0], c[1]);
      const okGround = corners.every((q) => q[0] > 30 && q[1] > 30 && q[0] < G - 30 && q[1] < G - 30 && Math.abs(hAt(q[0], q[1]) - h0) < 7 && !(hasWater && hAt(q[0], q[1]) < water + 2.5));
      if (!okGround) continue;
      const copies = ops.map((o) => o.pt(c));
      const rad = Math.hypot(a, b) / 2;
      if (copies.some((q) => spawns.some((s0) => Math.hypot(s0[0] - q[0], s0[1] - q[1]) < 110 + rad))) continue;
      if (copies.some((q) => mass.some((m) => Math.hypot(m[0] - q[0], m[1] - q[1]) < 18 + rad))) continue;
      if (copies.some((q) => allVillages.some((o) => Math.hypot(o.p[0] - q[0], o.p[1] - q[1]) < o.r + rad + 4))) continue;
      if (copies.some((q) => all().some((f) => Math.hypot(f.c[0] - q[0], f.c[1] - q[1]) < (Math.hypot(f.a, f.b) / 2 + rad) * 0.85))) continue;
      if (copies.some((q, i) => copies.some((q2, i2) => i2 > i && Math.hypot(q[0] - q2[0], q[1] - q2[1]) < rad * 2 + 6))) continue;
      if (features.some((f) => (f.kind === "lake" || f.kind === "mountain" || f.kind === "plateau" || f.kind === "crater") && Math.hypot(f.pts[0][0] - c[0], f.pts[0][1] - c[1]) < f.r * 1.2 + rad)) continue;
      if (features.some((f) => (f.kind === "river" || f.kind === "ridge" || f.kind === "canyon") && f.pts.length > 1 && lineDist(f.pts, c[0], c[1])[0] < f.r * 2 + rad)) continue;
      out.push({ c: [Math.round(c[0]), Math.round(c[1])], ang, a: Math.round(a), b: Math.round(b), kind: (Math.floor(r() * 3) as 0 | 1 | 2) });
      k++;
    }
  }
  return out;
}

/** Todas as cópias (simetria) das vilas, plantações e estradas, e a máscara de ocupação delas. */
function expandLife(G: number, villages: Village[], fields: FieldPlot[], roads: Pt[][], ops: ReturnType<typeof symmetryOps>): Life {
  const vs = villages.flatMap((v) => ops.map((o) => ({ ...v, p: o.pt(v.p), ang: mapAng(v.ang, o.m) })));
  const fs = fields.flatMap((f) => ops.map((o) => ({ ...f, c: o.pt(f.c), ang: mapAng(f.ang, o.m) })));
  const rs: Pt[][] = [];
  for (const path of roads) for (const o of ops) {
    const tp = path.map((q) => o.pt(q));
    // a mesma estrada (nos dois sentidos) uma vez só
    const same = (a: Pt[], b: Pt[]) => Math.hypot(a[0][0] - b[0][0], a[0][1] - b[0][1]) < 4 && Math.hypot(a[a.length - 1][0] - b[b.length - 1][0], a[a.length - 1][1] - b[b.length - 1][1]) < 4;
    if (rs.some((q) => same(q, tp) || same(q, [...tp].reverse()))) continue;
    rs.push(tp);
  }
  const cell = 4, n = Math.ceil(G / cell) + 1, mask = new Uint8Array(n * n);
  const mark = (x: number, z: number, rad: number, v: number) => {
    const i0 = Math.max(0, Math.floor((x - rad) / cell)), i1 = Math.min(n - 1, Math.ceil((x + rad) / cell));
    const j0 = Math.max(0, Math.floor((z - rad) / cell)), j1 = Math.min(n - 1, Math.ceil((z + rad) / cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (Math.hypot(i * cell - x, j * cell - z) <= rad) mask[j * n + i] = Math.max(mask[j * n + i], v);
  };
  for (const v of vs) mark(v.p[0], v.p[1], v.r + 6, 1);
  for (const f of fs) {
    const ca = Math.cos(f.ang), sa = Math.sin(f.ang);
    for (let u = -f.a / 2; u <= f.a / 2; u += 3) for (let w = -f.b / 2; w <= f.b / 2; w += 3) mark(f.c[0] + ca * u - sa * w, f.c[1] + sa * u + ca * w, 3, 2);
  }
  for (const path of rs) for (let k = 0; k < path.length - 1; k++) {
    const [a, b] = [path[k], path[k + 1]], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let t = 0; t <= L; t += 3) mark(a[0] + (b[0] - a[0]) * (t / L || 0), a[1] + (b[1] - a[1]) * (t / L || 0), 7, 3);
  }
  return { villages: vs, fields: fs, roads: rs, mask, cell };
}

/** 0 = livre, 1 = vila, 2 = plantação, 3 = estrada */
export function lifeAt(life: Life | null | undefined, x: number, z: number) {
  if (!life) return 0;
  const n = Math.round(Math.sqrt(life.mask.length));
  const i = Math.round(x / life.cell), j = Math.round(z / life.cell);
  if (i < 0 || j < 0 || i >= n || j >= n) return 0;
  return life.mask[j * n + i];
}

/** Plataformas: paredes e fundo do abismo em rocha; tabuleiro das pontes em terra batida. */
function paintAbyss(g: Grid, H: Float32Array, P: PaintLayer, features: Feature[], minLand: number) {
  const G = g.grid, n = P.n, w = n + 1, cs = G / n, hAt = heightReader(g, H);
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const y = hAt(i * cs, j * cs);
    if (y >= minLand) continue;
    const k = j * w + i, v = Math.round(150 + 90 * Math.min(1, (minLand - y) / 30));
    if (v > P.power[k]) { P.power[k] = v; P.role[k] = 3; }
  }
  for (const f of features) {
    if (f.kind !== "span" || f.pts.length < 2) continue;
    const [a, b] = [f.pts[0], f.pts[f.pts.length - 1]];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
    for (let t = 0; t <= L; t += cs) for (let q = -f.r * 0.7; q <= f.r * 0.7; q += cs) {
      const x = a[0] + dx * t - dz * q, z = a[1] + dz * t + dx * q;
      const i = Math.round(x / cs), j = Math.round(z / cs);
      if (i < 0 || j < 0 || i > n || j > n) continue;
      const k = j * w + i;
      P.power[k] = 200; P.role[k] = 2;
    }
  }
}

/** Pintura do chão do que é humano: estradas e ruas de terra, praça, chão batido e faixas das plantações. */
function paintLife(G: number, life: Life, seed: number): PaintLayer {
  const P = newPaint(WORLD_PAINT_N), n = P.n, w = n + 1, cs = G / n;
  const noise = simplex(seed + 5501);
  const put = (i: number, j: number, role: number, pw: number) => {
    if (i < 0 || j < 0 || i > n || j > n || pw <= 0) return;
    const k = j * w + i, v = Math.min(255, Math.round(pw));
    if (v > P.power[k]) { P.power[k] = v; P.role[k] = role; }
  };
  /** traço (segmento) com miolo forte e borda suave */
  const stroke = (a: Pt, b: Pt, core: number, edge: number, role: number, pw: number) => {
    const x0 = Math.min(a[0], b[0]) - core - edge, x1 = Math.max(a[0], b[0]) + core + edge;
    const z0 = Math.min(a[1], b[1]) - core - edge, z1 = Math.max(a[1], b[1]) + core + edge;
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1;
    for (let j = Math.max(0, Math.floor(z0 / cs)); j <= Math.min(n, Math.ceil(z1 / cs)); j++) for (let i = Math.max(0, Math.floor(x0 / cs)); i <= Math.min(n, Math.ceil(x1 / cs)); i++) {
      const x = i * cs, z = j * cs;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
      const d = Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
      const wob = 0.8 * noise(x / 9, z / 9);
      if (d > core + edge + wob) continue;
      put(i, j, role, pw * (d <= core + wob ? 1 : 1 - (d - core - wob) / edge));
    }
  };
  // (estradas e caminhos: formas "Caminho", pintadas no editor a partir da própria forma)
  for (const v of life.villages) {
    // chão batido da vila (manchas) e praça no centro
    const R = v.r;
    for (let j = Math.floor((v.p[1] - R) / cs); j <= Math.ceil((v.p[1] + R) / cs); j++) for (let i = Math.floor((v.p[0] - R) / cs); i <= Math.ceil((v.p[0] + R) / cs); i++) {
      const d = Math.hypot(i * cs - v.p[0], j * cs - v.p[1]) / R;
      if (d >= 1) continue;
      put(i, j, 2, (70 + 70 * noise(i * cs / 22, j * cs / 22)) * (1 - d * d));
      if (d * R < 13) put(i, j, 2, 215 * (1 - Math.max(0, d * R - 10) / 3));
    }
    const ca = Math.cos(v.ang), sa = Math.sin(v.ang), L = R * 0.95;
    stroke([v.p[0] - ca * L, v.p[1] - sa * L], [v.p[0] + ca * L, v.p[1] + sa * L], 3.6, 2.5, 2, 235);
    if (v.cross) stroke([v.p[0] + sa * L * 0.7, v.p[1] - ca * L * 0.7], [v.p[0] - sa * L * 0.7, v.p[1] + ca * L * 0.7], 3, 2.5, 2, 230);
  }
  for (const f of life.fields) {
    const ca = Math.cos(f.ang), sa = Math.sin(f.ang), rad = Math.hypot(f.a, f.b) / 2;
    const roles: [number, number] = f.kind === 0 ? [0, 2] : f.kind === 1 ? [0, 0] : [1, 2];
    for (let j = Math.floor((f.c[1] - rad) / cs); j <= Math.ceil((f.c[1] + rad) / cs); j++) for (let i = Math.floor((f.c[0] - rad) / cs); i <= Math.ceil((f.c[0] + rad) / cs); i++) {
      const dx = i * cs - f.c[0], dz = j * cs - f.c[1];
      const u = dx * ca + dz * sa, vv = -dx * sa + dz * ca;
      const eu = f.a / 2 - Math.abs(u), ev = f.b / 2 - Math.abs(vv);
      if (eu < 0 || ev < 0) continue;
      const fade = Math.min(1, eu / 2.5, ev / 2.5);
      const stripe = Math.floor((vv + f.b / 2) / 4.5) % 2;
      put(i, j, roles[stripe], (f.kind === 1 ? 165 : 190) * fade * (0.9 + 0.1 * noise(u / 6, vv / 6)));
    }
  }
  return P;
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
