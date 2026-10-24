// Gerador procedural de texturas para tropas. Trabalha no espaço UV do próprio modelo: cada texel
// sabe a sua posição 3D, a normal e a distância até as quinas do modelo. Assim a camuflagem não
// "quebra" nas emendas da UV, o desgaste aparece onde a tinta realmente gasta (quinas vivas) e a
// sujeira junta nas partes baixas, nas frestas e escorre pelas paredes.
//
// Cada camada tem a própria semente: trocar a semente do desgaste não muda a camuflagem.
// Funciona sem DOM (roda num Worker e nos testes em Node).

export interface TexModel { positions: ArrayLike<number>; normals: ArrayLike<number>; uvs: ArrayLike<number>; indices: ArrayLike<number> }

export interface Surface {
  size: number;
  /** 1 = texel coberto por algum triângulo */
  mask: Uint8Array;
  pos: Float32Array;
  nor: Float32Array;
  /** distância (em texels) até a quina convexa / côncava mais próxima */
  convex: Float32Array;
  concave: Float32Array;
  min: [number, number, number];
  dims: [number, number, number];
  ext: number;
  coverage: number;
  hardEdges: number;
}

export type CamoKind = "solid" | "woodland" | "digital" | "splinter" | "tiger" | "urban";
export type TexView = "final" | "camo" | "panels" | "wear" | "dirt" | "edges";

export interface TexSpec {
  view: TexView;
  base: { pattern: CamoKind; colors: [string, string, string]; scale: number; seed: number; keepColor: number; detail: number; shading: number; variation: number };
  panels: { on: boolean; seed: number; size: number; lines: number; vents: number; hatches: number; rivets: number; tone: number };
  markings: { on: boolean; seed: number; color: string; stripe: boolean; hazard: number };
  wear: { on: boolean; seed: number; amount: number; width: number; scratches: number; metal: string };
  dirt: { on: boolean; seed: number; amount: number; color: string; height: number; streaks: number; dust: number };
}

export interface TexVersion { id: string; name: string; asset: string; at: number; spec: TexSpec; modelKey: string }
export interface TexGenDoc { spec: TexSpec; versions: TexVersion[] }

export const CAMO_LABEL: Record<CamoKind, string> = { solid: "Lisa", woodland: "Floresta (manchas)", digital: "Digital (pixels)", splinter: "Estilhaços (angular)", tiger: "Listras", urban: "Urbana" };

export function defaultTexSpec(seed = 1): TexSpec {
  return {
    view: "final",
    base: { pattern: "solid", colors: ["#6b7178", "#3d4247", "#9aa0a6"], scale: 1, seed, keepColor: 1, detail: 1, shading: 1, variation: 0.35 },
    panels: { on: true, seed: seed + 1, size: 0.16, lines: 0.6, vents: 0.25, hatches: 0.25, rivets: 0.35, tone: 0.4 },
    markings: { on: false, seed: seed + 2, color: "#d9a227", stripe: true, hazard: 0 },
    wear: { on: true, seed: seed + 3, amount: 0.45, width: 0.35, scratches: 0.35, metal: "#9a9c9c" },
    dirt: { on: true, seed: seed + 4, amount: 0.4, color: "#4a3f33", height: 0.35, streaks: 0.4, dust: 0.2 },
  };
}

export interface TexPreset { id: string; label: string; apply: (s: TexSpec) => TexSpec }
const preset = (id: string, label: string, pattern: CamoKind, colors: [string, string, string], extra: (s: TexSpec) => void = () => {}): TexPreset => ({
  id, label, apply: (s0) => {
    const s: TexSpec = JSON.parse(JSON.stringify(s0));
    s.base.pattern = pattern; s.base.colors = colors; s.base.keepColor = 0.12; s.base.detail = 1; s.base.shading = 0.9;
    extra(s);
    return s;
  },
});
export const TEX_PRESETS: TexPreset[] = [
  { id: "renew", label: "Original com desgaste", apply: (s0) => { const s: TexSpec = JSON.parse(JSON.stringify(s0)); s.base.pattern = "solid"; s.base.keepColor = 1; s.panels.lines = 0.35; s.wear.amount = 0.4; s.dirt.amount = 0.35; return s; } },
  preset("forest", "Floresta", "woodland", ["#4b5a3a", "#2b3324", "#6e664a"]),
  preset("desert", "Deserto", "splinter", ["#b59d72", "#8a7350", "#d4c29c"], (s) => { s.dirt.color = "#8a6f4c"; s.dirt.dust = 0.5; }),
  preset("urban", "Urbana", "urban", ["#7d8287", "#4a4e53", "#b0b4b7"]),
  preset("winter", "Inverno digital", "digital", ["#d9dde0", "#98a1a9", "#5d6870"], (s) => { s.dirt.color = "#5b5e60"; s.dirt.amount = 0.3; }),
  preset("navy", "Naval", "solid", ["#56687a", "#3c4a58", "#7d8ea0"], (s) => { s.dirt.color = "#5a4b3b"; s.dirt.streaks = 0.7; s.markings.on = true; s.markings.color = "#e8e8e0"; }),
  preset("tiger", "Listras de tigre", "tiger", ["#b98a45", "#26231f", "#7a5a2e"]),
  preset("rust", "Veterano enferrujado", "solid", ["#6d6252", "#4a4237", "#8d8170"], (s) => { s.wear.amount = 0.8; s.wear.scratches = 0.7; s.dirt.amount = 0.75; s.dirt.color = "#6a3b1f"; s.dirt.streaks = 0.8; }),
  preset("parade", "Parada (limpa)", "solid", ["#2f4f7a", "#1d2f48", "#c9a24a"], (s) => { s.wear.amount = 0.1; s.wear.scratches = 0.05; s.dirt.amount = 0.08; s.dirt.dust = 0; s.markings.on = true; s.markings.color = "#c9a24a"; }),
];

// ------------------------------------------------------------------ ruído (Perlin 3D com semente)

function rngOf(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type N3 = (x: number, y: number, z: number) => number;
function perlin3(seed: number): N3 {
  const r = rngOf(seed * 7919 + 13);
  const p = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [base[i], base[j]] = [base[j], base[i]]; }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h: number, x: number, y: number, z: number) => {
    const k = h & 15, u = k < 8 ? x : y, v = k < 4 ? y : k === 12 || k === 14 ? x : z;
    return ((k & 1) ? -u : u) + ((k & 2) ? -v : v);
  };
  return (x, y, z) => {
    const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
    const X = fx & 255, Y = fy & 255, Z = fz & 255;
    x -= fx; y -= fy; z -= fz;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = p[X] + Y, AA = p[A] + Z, AB = p[A + 1] + Z, B = p[X + 1] + Y, BA = p[B] + Z, BB = p[B + 1] + Z;
    const l = (a: number, b: number, t: number) => a + t * (b - a);
    return l(
      l(l(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u), l(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      l(l(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u), l(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v),
      w,
    );
  };
}
/** fbm em [0, 1] (aprox.) */
function fbm3(n: N3, x: number, y: number, z: number, oct: number) {
  let a = 0.5, f = 1, s = 0, norm = 0;
  for (let o = 0; o < oct; o++) { s += a * n(x * f + o * 17.3, y * f, z * f); norm += a; a *= 0.5; f *= 2.07; }
  return 0.5 + 0.75 * (s / norm);
}
function hash(a: number, b: number, c: number, seed: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function hexRgb(h: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  const v = m ? parseInt(m[1], 16) : 0x808080;
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// ------------------------------------------------------------------ superfície (rasterização na UV)

/** Rasteriza o modelo no espaço UV e mede as quinas (ângulo entre faces vizinhas). */
export function bakeSurface(m: TexModel, size: number): Surface {
  const S = size, N = S * S;
  const mask = new Uint8Array(N), pos = new Float32Array(N * 3), nor = new Float32Array(N * 3);
  const P = m.positions, NR = m.normals, UV = m.uvs, I = m.indices;
  const nv = P.length / 3, nt = Math.floor(I.length / 3);
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) { const v = P[i * 3 + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  if (!nv) { min.fill(0); max.fill(1); }
  const dims: [number, number, number] = [max[0] - min[0] || 1e-3, max[1] - min[1] || 1e-3, max[2] - min[2] || 1e-3];
  const ext = Math.max(...dims);

  // triângulos na UV
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    let u0 = UV[a * 2], v0 = UV[a * 2 + 1], u1 = UV[b * 2], v1 = UV[b * 2 + 1], u2 = UV[c * 2], v2 = UV[c * 2 + 1];
    const ou = Math.floor(Math.min(u0, u1, u2)), ov = Math.floor(Math.min(v0, v1, v2));
    u0 = (u0 - ou) * S; u1 = (u1 - ou) * S; u2 = (u2 - ou) * S; v0 = (v0 - ov) * S; v1 = (v1 - ov) * S; v2 = (v2 - ov) * S;
    const area = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(u0, u1, u2))), x1 = Math.min(S * 2 - 1, Math.ceil(Math.max(u0, u1, u2)));
    const y0 = Math.max(0, Math.floor(Math.min(v0, v1, v2))), y1 = Math.min(S * 2 - 1, Math.ceil(Math.max(v0, v1, v2)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = ((u1 - px) * (v2 - py) - (u2 - px) * (v1 - py)) / area;
      let w1 = ((u2 - px) * (v0 - py) - (u0 - px) * (v2 - py)) / area;
      let w2 = 1 - w0 - w1;
      if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
      w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2);
      const k = (y % S) * S + (x % S);
      mask[k] = 1;
      let nx = 0, ny = 0, nz = 0;
      for (let d = 0; d < 3; d++) {
        pos[k * 3 + d] = P[a * 3 + d] * w0 + P[b * 3 + d] * w1 + P[c * 3 + d] * w2;
      }
      nx = NR[a * 3] * w0 + NR[b * 3] * w1 + NR[c * 3] * w2;
      ny = NR[a * 3 + 1] * w0 + NR[b * 3 + 1] * w1 + NR[c * 3 + 1] * w2;
      nz = NR[a * 3 + 2] * w0 + NR[b * 3 + 2] * w1 + NR[c * 3 + 2] * w2;
      const l = Math.hypot(nx, ny, nz) || 1;
      nor[k * 3] = nx / l; nor[k * 3 + 1] = ny / l; nor[k * 3 + 2] = nz / l;
    }
  }
  let coverage = 0;
  for (let i = 0; i < N; i++) coverage += mask[i];

  // quinas: arestas com faces vizinhas em ângulo (soldando vértices na mesma posição)
  const q = ext * 1e-4 || 1e-6;
  const groups = new Int32Array(nv);
  const key = new Map<string, number>();
  for (let i = 0; i < nv; i++) {
    const k = `${Math.round(P[i * 3] / q)},${Math.round(P[i * 3 + 1] / q)},${Math.round(P[i * 3 + 2] / q)}`;
    let g = key.get(k);
    if (g === undefined) { g = key.size; key.set(k, g); }
    groups[i] = g;
  }
  const fn = new Float32Array(nt * 3), fc = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    const ex = P[b * 3] - P[a * 3], ey = P[b * 3 + 1] - P[a * 3 + 1], ez = P[b * 3 + 2] - P[a * 3 + 2];
    const fx = P[c * 3] - P[a * 3], fy = P[c * 3 + 1] - P[a * 3 + 1], fz = P[c * 3 + 2] - P[a * 3 + 2];
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    // orienta pela normal dos vértices (alguns modelos têm a ordem invertida)
    const vn = NR[a * 3] * nx + NR[a * 3 + 1] * ny + NR[a * 3 + 2] * nz;
    if (vn < 0) { nx = -nx; ny = -ny; nz = -nz; }
    fn[t * 3] = nx; fn[t * 3 + 1] = ny; fn[t * 3 + 2] = nz;
    for (let d = 0; d < 3; d++) fc[t * 3 + d] = (P[a * 3 + d] + P[b * 3 + d] + P[c * 3 + d]) / 3;
  }
  const edges = new Map<number, number[]>(); // chave da aresta -> [triângulo*3 + aresta]
  const G = key.size + 1;
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
    const ga = groups[I[t * 3 + e]], gb = groups[I[t * 3 + ((e + 1) % 3)]];
    if (ga === gb) continue;
    const k = ga < gb ? ga * G + gb : gb * G + ga;
    const l = edges.get(k);
    if (l) l.push(t * 3 + e); else edges.set(k, [t * 3 + e]);
  }
  const convexSeed = new Uint8Array(N), concaveSeed = new Uint8Array(N);
  const line = (t: number, e: number, into: Uint8Array) => {
    const a = I[t * 3 + e], b = I[t * 3 + ((e + 1) % 3)];
    const ou = Math.floor(Math.min(UV[I[t * 3] * 2], UV[I[t * 3 + 1] * 2], UV[I[t * 3 + 2] * 2]));
    const ov = Math.floor(Math.min(UV[I[t * 3] * 2 + 1], UV[I[t * 3 + 1] * 2 + 1], UV[I[t * 3 + 2] * 2 + 1]));
    const x0 = (UV[a * 2] - ou) * S, y0 = (UV[a * 2 + 1] - ov) * S, x1 = (UV[b * 2] - ou) * S, y1 = (UV[b * 2 + 1] - ov) * S;
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 1.5) + 1;
    for (let i = 0; i <= n; i++) {
      const x = Math.floor(x0 + ((x1 - x0) * i) / n), y = Math.floor(y0 + ((y1 - y0) * i) / n);
      if (x < 0 || y < 0) continue;
      into[(y % S) * S + (x % S)] = 1;
    }
  };
  let hardEdges = 0;
  for (const list of edges.values()) {
    if (list.length === 1) { line(Math.floor(list[0] / 3), list[0] % 3, convexSeed); hardEdges++; continue; }
    const t1 = Math.floor(list[0] / 3), t2 = Math.floor(list[1] / 3);
    const d = fn[t1 * 3] * fn[t2 * 3] + fn[t1 * 3 + 1] * fn[t2 * 3 + 1] + fn[t1 * 3 + 2] * fn[t2 * 3 + 2];
    if (d > 0.9) continue; // superfície lisa (< ~25°)
    hardEdges++;
    // convexa se o centro da outra face fica "atrás" do plano desta
    const s = (fc[t2 * 3] - fc[t1 * 3]) * fn[t1 * 3] + (fc[t2 * 3 + 1] - fc[t1 * 3 + 1]) * fn[t1 * 3 + 1] + (fc[t2 * 3 + 2] - fc[t1 * 3 + 2]) * fn[t1 * 3 + 2];
    const into = s <= 0 ? convexSeed : concaveSeed;
    for (const te of list) line(Math.floor(te / 3), te % 3, into);
  }
  const convex = distance(convexSeed, S), concave = distance(concaveSeed, S);

  // borda: estende os atributos para fora das ilhas (evita costuras nas mipmaps)
  dilate(mask, S, 4, (to, from) => {
    for (let d = 0; d < 3; d++) { pos[to * 3 + d] = pos[from * 3 + d]; nor[to * 3 + d] = nor[from * 3 + d]; }
    convex[to] = convex[from]; concave[to] = concave[from];
  });
  return { size: S, mask, pos, nor, convex, concave, min, dims, ext, coverage: coverage / N, hardEdges };
}

/** Distância (chanfro 3-4) até o texel marcado mais próximo, em texels, limitada a 96. */
function distance(seed: Uint8Array, S: number): Float32Array {
  const d = new Float32Array(S * S);
  const INF = 96;
  for (let i = 0; i < d.length; i++) d[i] = seed[i] ? 0 : INF;
  const a = 1, b = 1.4142;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    let v = d[i];
    if (x > 0) v = Math.min(v, d[i - 1] + a);
    if (y > 0) { v = Math.min(v, d[i - S] + a); if (x > 0) v = Math.min(v, d[i - S - 1] + b); if (x < S - 1) v = Math.min(v, d[i - S + 1] + b); }
    d[i] = v;
  }
  for (let y = S - 1; y >= 0; y--) for (let x = S - 1; x >= 0; x--) {
    const i = y * S + x;
    let v = d[i];
    if (x < S - 1) v = Math.min(v, d[i + 1] + a);
    if (y < S - 1) { v = Math.min(v, d[i + S] + a); if (x < S - 1) v = Math.min(v, d[i + S + 1] + b); if (x > 0) v = Math.min(v, d[i + S - 1] + b); }
    d[i] = v;
  }
  return d;
}

/** Cresce a máscara `steps` texels copiando o vizinho coberto (marca os novos como 2). */
function dilate(mask: Uint8Array, S: number, steps: number, copy: (to: number, from: number) => void) {
  let frontier: number[] = [];
  for (let s = 0; s < steps; s++) {
    frontier = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (mask[i]) continue;
      const from = x > 0 && mask[i - 1] ? i - 1 : x < S - 1 && mask[i + 1] ? i + 1 : y > 0 && mask[i - S] ? i - S : y < S - 1 && mask[i + S] ? i + S : -1;
      if (from >= 0) { copy(i, from); frontier.push(i); }
    }
    for (const i of frontier) mask[i] = 2;
    if (!frontier.length) break;
  }
}

// ------------------------------------------------------------------ geração

export interface TexResult { rgba: Uint8ClampedArray; stats: { mean: [number, number, number]; contrast: number; worn: number; dirty: number } }

/**
 * Gera a textura (RGBA, size×size). `orig` é a textura original do modelo no mesmo tamanho
 * (o alfa original é mantido, porque o jogo pode usá-lo).
 */
export function generateTexture(sf: Surface, spec: TexSpec, orig: Uint8ClampedArray | null): TexResult {
  const S = sf.size, N = S * S;
  const out = new Uint8ClampedArray(N * 4);
  const cols = spec.base.colors.map(hexRgb);
  const metal = hexRgb(spec.wear.metal), dirtC = hexRgb(spec.dirt.color), markC = hexRgb(spec.markings.color);
  const dustC: [number, number, number] = [Math.min(1, dirtC[0] * 0.5 + 0.45), Math.min(1, dirtC[1] * 0.5 + 0.42), Math.min(1, dirtC[2] * 0.5 + 0.38)];
  const nBase = perlin3(spec.base.seed), nBase2 = perlin3(spec.base.seed + 101), nVar = perlin3(spec.base.seed + 202);
  const nWear = perlin3(spec.wear.seed), nWear2 = perlin3(spec.wear.seed + 77);
  const nDirt = perlin3(spec.dirt.seed), nDirt2 = perlin3(spec.dirt.seed + 55);
  const freq = 2.6 * Math.max(0.2, spec.base.scale);
  const scaleTex = S / 1024;
  const wearW = (2 + spec.wear.width * 12) * scaleTex;
  const cavW = (3 + spec.dirt.amount * 10) * scaleTex;

  // original: luminância e versão borrada (detalhes finos e sombras pintadas à mão)
  let lum: Float32Array | null = null, blur: Float32Array | null = null, meanL = 0.5;
  if (orig) {
    lum = new Float32Array(N);
    let sum = 0, cnt = 0;
    for (let i = 0; i < N; i++) {
      const l = (0.2126 * orig[i * 4] + 0.7152 * orig[i * 4 + 1] + 0.0722 * orig[i * 4 + 2]) / 255;
      lum[i] = l;
      if (sf.mask[i] === 1) { sum += l; cnt++; }
    }
    meanL = cnt ? sum / cnt : 0.5;
    blur = boxBlur(lum, S, Math.max(2, Math.round(S / 96)));
  }

  // planos do padrão de estilhaços
  const planes: [number, number, number, number][] = [];
  { const r = rngOf(spec.base.seed + 9); for (let k = 0; k < 9; k++) { const th = r() * Math.PI * 2, ph = Math.acos(r() * 2 - 1); planes.push([Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th), r()]); } }
  const tigerDir = (() => { const r = rngOf(spec.base.seed + 5); const a = r() * Math.PI; return [Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35]; })();
  const stripePos = rngOf(spec.markings.seed)() * 0.5 + 0.25;
  const longAxis = sf.dims[2] >= sf.dims[0] ? 2 : 0;

  let sR = 0, sG = 0, sB = 0, sL2 = 0, cnt = 0, worn = 0, dirty = 0;
  const camoIdx = (x: number, y: number, z: number): [number, number] => {
    // devolve [índice da cor, peso da mistura com a próxima] (borda suave de 1 texel)
    switch (spec.base.pattern) {
      case "solid": return [0, 0];
      case "woodland": case "digital": {
        let X = x, Y = y, Z = z;
        if (spec.base.pattern === "digital") { const g = 1 / (freq * 9); X = Math.floor(x / g) * g; Y = Math.floor(y / g) * g; Z = Math.floor(z / g) * g; }
        const wx = fbm3(nBase2, X * freq * 0.7, Y * freq * 0.7, Z * freq * 0.7, 2) - 0.5;
        const n1 = fbm3(nBase, X * freq + wx, Y * freq + wx, Z * freq, 4);
        const n2 = fbm3(nBase2, X * freq * 1.4 + 31, Y * freq * 1.4, Z * freq * 1.4 - wx, 4);
        if (n2 > 0.62) return [2, 0];
        return n1 > 0.52 ? [1, 0] : [0, 0];
      }
      case "splinter": case "urban": {
        const f = spec.base.pattern === "urban" ? freq * 0.6 : freq * 0.9;
        const w = (fbm3(nBase2, x * 8, y * 8, z * 8, 2) - 0.5) * 0.02;
        let bits = 0;
        for (let k = 0; k < planes.length; k++) { const p = planes[k]; if (((x + w) * p[0] + y * p[1] + z * p[2]) * f + p[3] * 3 > Math.floor(p[3] * 3) + 0.5) bits |= 1 << k; }
        let idx = Math.floor(hash(bits, 3, 7, spec.base.seed) * 3);
        if (spec.base.pattern === "urban" && fbm3(nBase, x * freq * 1.2, y * freq * 1.2, z * freq * 1.2, 3) > 0.64) idx = 2;
        return [idx, 0];
      }
      case "tiger": {
        const v = Math.sin(((x * tigerDir[0] + y * tigerDir[1] + z * tigerDir[2]) * freq * 3.2 + (fbm3(nBase, x * freq, y * freq, z * freq, 3) - 0.5) * 3) * Math.PI);
        if (fbm3(nBase2, x * freq * 2, y * freq * 2, z * freq * 2, 3) > 0.68) return [2, 0];
        return v > 0.45 ? [1, 0] : [0, 0];
      }
    }
  };

  for (let i = 0; i < N; i++) {
    if (!sf.mask[i]) {
      if (orig) { out[i * 4] = orig[i * 4]; out[i * 4 + 1] = orig[i * 4 + 1]; out[i * 4 + 2] = orig[i * 4 + 2]; out[i * 4 + 3] = orig[i * 4 + 3]; }
      else out[i * 4 + 3] = 255;
      continue;
    }
    const px = sf.pos[i * 3], py = sf.pos[i * 3 + 1], pz = sf.pos[i * 3 + 2];
    const nx = sf.nor[i * 3], ny = sf.nor[i * 3 + 1], nz = sf.nor[i * 3 + 2];
    const x = (px - sf.min[0]) / sf.ext, y = (py - sf.min[1]) / sf.ext, z = (pz - sf.min[2]) / sf.ext;
    const hn = (py - sf.min[1]) / sf.dims[1];
    // projeção pelo eixo dominante
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    const pa = axis === 0 ? z : x, pb = axis === 1 ? z : y;

    // 1) pintura base
    const [ci] = camoIdx(x, y, z);
    let r = cols[ci][0], g = cols[ci][1], b = cols[ci][2];
    if (lum && blur && orig) {
      const L = lum[i], Lb = blur[i];
      const shade = 1 + (Math.min(1.6, Math.max(0.35, Lb / (meanL || 0.5))) - 1) * spec.base.shading;
      const det = 1 + (L - Lb) * spec.base.detail * 2.4;
      const k = shade * det;
      const kc = spec.base.keepColor;
      r = r * k * (1 - kc) + (orig[i * 4] / 255) * kc;
      g = g * k * (1 - kc) + (orig[i * 4 + 1] / 255) * kc;
      b = b * k * (1 - kc) + (orig[i * 4 + 2] / 255) * kc;
    }
    // variação de acabamento (tinta desbotada em áreas grandes)
    const vv = 1 + (fbm3(nVar, x * 2.2, y * 2.2, z * 2.2, 3) - 0.5) * spec.base.variation * 0.45;
    r *= vv; g *= vv; b *= vv;
    const camoView = ci / 2;

    // 2) marcações
    if (spec.markings.on) {
      const lp = longAxis === 2 ? z / (sf.dims[2] / sf.ext) : x / (sf.dims[0] / sf.ext);
      if (spec.markings.stripe && Math.abs(lp - stripePos) < 0.035 && ny > -0.3) { r = markC[0]; g = markC[1]; b = markC[2]; }
    }

    // 3) painéis, frestas, grades, escotilhas e rebites
    let seam = 0, panelView = 0;
    if (spec.panels.on) {
      const G = Math.max(0.03, spec.panels.size);
      const ga = pa / G + axis * 7.31, gb = pb / G + axis * 3.17;
      const ix = Math.floor(ga), iy = Math.floor(gb);
      const fx = ga - ix, fy = gb - iy;
      let x0 = 0, x1 = 1, y0 = 0, y1 = 1, pid = Math.floor(hash(ix, iy, axis, spec.panels.seed) * 1e6);
      for (let lv = 0; lv < 3; lv++) {
        const h = hash(pid, lv, 1, spec.panels.seed);
        if (lv > 0 && hash(pid, 9, lv, spec.panels.seed) < 0.3) break;
        const wide = x1 - x0 > y1 - y0;
        const s = 0.3 + 0.4 * hash(pid, lv, 2, spec.panels.seed);
        if (wide ? h < 0.75 : h < 0.25) { const c = x0 + (x1 - x0) * s; if (fx < c) { x1 = c; pid = pid * 2 + 1; } else { x0 = c; pid = pid * 2 + 2; } }
        else { const c = y0 + (y1 - y0) * s; if (fy < c) { y1 = c; pid = pid * 2 + 1; } else { y0 = c; pid = pid * 2 + 2; } }
        pid %= 1e9;
      }
      const dl = fx - x0, dr = x1 - fx, db = fy - y0, dt = y1 - fy;
      const d = Math.min(dl, dr, db, dt) * G;
      const lw = 0.0016 + spec.panels.lines * 0.0028;
      const ln = 1 - sstep(lw * 0.45, lw, d);
      // chanfro: um lado claro, o outro escuro
      const lit = dl === Math.min(dl, dr, db, dt) || dt === Math.min(dl, dr, db, dt);
      const bevel = sstep(lw, lw * 1.4, d) * (1 - sstep(lw * 1.4, lw * 2.6, d));
      const tone = 1 + (hash(pid, 5, 3, spec.panels.seed) - 0.5) * spec.panels.tone * 0.22;
      let k = tone * (1 - ln * 0.62) * (1 + bevel * (lit ? 0.12 : -0.08));
      const w = (x1 - x0) * G, h = (y1 - y0) * G;
      const ux = (fx - x0) * G, uy = (fy - y0) * G; // coordenadas dentro do painel
      const hv = hash(pid, 7, 4, spec.panels.seed);
      if (hv < spec.panels.vents * 0.35 && Math.min(w, h) > 0.035) {
        // grade de ventilação
        const m = Math.min(w, h) * 0.22;
        if (ux > m && ux < w - m && uy > m && uy < h - m) {
          const along = w > h ? ux : uy, pitch = Math.min(w, h) * 0.11;
          const f = (along / pitch) % 1;
          k *= f < 0.42 ? 0.32 : f < 0.55 ? 1.12 : 0.95;
        }
      } else if (hash(pid, 8, 4, spec.panels.seed) < spec.panels.hatches * 0.3 && Math.min(w, h) > 0.03) {
        // escotilha: contorno interno e 4 parafusos
        const m = Math.min(w, h) * 0.18;
        const dd = Math.min(Math.abs(ux - m), Math.abs(w - m - ux), Math.abs(uy - m), Math.abs(h - m - uy));
        const inside = ux > m - lw && ux < w - m + lw && uy > m - lw && uy < h - m + lw;
        if (inside && dd < lw * 0.8) k *= 0.55;
        const bx = Math.min(Math.abs(ux - m * 0.5), Math.abs(w - m * 0.5 - ux)), by = Math.min(Math.abs(uy - m * 0.5), Math.abs(h - m * 0.5 - uy));
        const br = Math.hypot(bx, by), rr = lw * 1.5;
        if (br < rr) k *= 0.7 + (1 - br / rr) * 0.55;
      }
      if (hash(pid, 6, 4, spec.panels.seed) < spec.panels.rivets) {
        // rebites ao longo da borda do painel
        const off = lw * 3.2, sp = 0.011;
        const alongB = dl === Math.min(dl, dr, db, dt) || dr === Math.min(dl, dr, db, dt) ? pb : pa;
        const fr = ((alongB / sp) % 1 + 1) % 1 - 0.5;
        const dist = Math.hypot(fr * sp, d - off), rr = lw * 1.1;
        if (dist < rr) { const t = 1 - dist / rr; k *= 0.78 + t * 0.5; }
      }
      r *= k; g *= k; b *= k;
      seam = 1 - sstep(lw, lw * 5, d);
      panelView = ln;
      if (spec.markings.on && spec.markings.hazard > 0 && hash(pid, 11, 2, spec.markings.seed) < spec.markings.hazard * 0.12 && d > lw * 2) {
        const sv = (((pa + pb) / 0.022) % 1 + 1) % 1;
        if (sv < 0.5) { r = markC[0] * k; g = markC[1] * k; b = markC[2] * k; } else { r = 0.08 * k; g = 0.08 * k; b = 0.08 * k; }
      }
    }

    // 4) desgaste: lascas nas quinas vivas e arranhões
    let wearView = 0;
    if (spec.wear.on && spec.wear.amount > 0) {
      const e = Math.max(1 - sstep(0, wearW, sf.convex[i]), seam * 0.45);
      const n = fbm3(nWear, x * 34, y * 34, z * 34, 4), big = fbm3(nWear2, x * 3, y * 3, z * 3, 2);
      const v = e * spec.wear.amount * 1.7 + (n - 0.5) * 1.1 + (big - 0.5) * 0.5;
      const chip = sstep(0.62, 0.68, v), rim = sstep(0.5, 0.62, v) * (1 - chip);
      const mk = 0.82 + (fbm3(nWear2, x * 220, y * 40, z * 220, 2) - 0.5) * 0.35;
      r = (r * (1 - rim * 0.28)) * (1 - chip) + metal[0] * mk * chip;
      g = (g * (1 - rim * 0.28)) * (1 - chip) + metal[1] * mk * chip;
      b = (b * (1 - rim * 0.28)) * (1 - chip) + metal[2] * mk * chip;
      wearView = Math.max(chip, rim * 0.5);
      // arranhões: segmentos curtos em células
      if (spec.wear.scratches > 0) {
        const cs = 0.03, ca = pa / cs, cb = pb / cs, ia = Math.floor(ca), ib = Math.floor(cb);
        let sc = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const ha = hash(ia + ox, ib + oy, axis, spec.wear.seed);
          if (ha > spec.wear.scratches * 0.5) continue;
          const cx = ia + ox + hash(ia + ox, ib + oy, 1, spec.wear.seed), cy = ib + oy + hash(ia + ox, ib + oy, 2, spec.wear.seed);
          const an = hash(ia + ox, ib + oy, 3, spec.wear.seed) * Math.PI, len = 0.4 + hash(ia + ox, ib + oy, 4, spec.wear.seed) * 1.1;
          const dx = Math.cos(an), dy = Math.sin(an);
          const rx = ca - cx, ry = cb - cy;
          const t = Math.max(-len, Math.min(len, rx * dx + ry * dy));
          const dd = Math.hypot(rx - dx * t, ry - dy * t) * cs;
          const s = (1 - sstep(0.00035 * (S >= 1024 ? 1 : 1.6), 0.0011, dd)) * (1 - Math.abs(t) / len);
          if (s > sc) sc = s;
        }
        sc *= 0.55;
        r = r * (1 - sc) + metal[0] * sc; g = g * (1 - sc) + metal[1] * sc; b = b * (1 - sc) + metal[2] * sc;
        wearView = Math.max(wearView, sc);
      }
      if (wearView > 0.3) worn++;
    }

    // 5) sujeira: partes baixas, frestas, escorridos nas paredes e poeira em cima
    let dirtView = 0;
    if (spec.dirt.on && spec.dirt.amount > 0) {
      const low = 1 - sstep(0, 0.12 + spec.dirt.height * 0.7, hn);
      const cav = 1 - sstep(0, cavW, sf.concave[i]);
      const br = fbm3(nDirt, x * 9, y * 9, z * 9, 4);
      const vert = 1 - ay;
      const st = sstep(0.5, 0.8, fbm3(nDirt2, x * 70, y * 4.5, z * 70, 3)) * vert * spec.dirt.streaks;
      const f = clamp01((low * 0.95 + cav * 0.8 + seam * 0.45 + st * 0.75) * spec.dirt.amount * (0.45 + br * 0.9));
      const dk = 0.8 + fbm3(nDirt2, x * 60, y * 60, z * 60, 2) * 0.4;
      const m2 = f * 0.88;
      r = r * (1 - m2) + dirtC[0] * dk * m2; g = g * (1 - m2) + dirtC[1] * dk * m2; b = b * (1 - m2) + dirtC[2] * dk * m2;
      const dust = sstep(0.55, 0.95, ny) * spec.dirt.dust * sstep(0.35, 0.75, br) * 0.6;
      r = r * (1 - dust) + dustC[0] * dust; g = g * (1 - dust) + dustC[1] * dust; b = b * (1 - dust) + dustC[2] * dust;
      dirtView = Math.max(f, dust);
      if (dirtView > 0.3) dirty++;
    }

    let o0 = r, o1 = g, o2 = b;
    if (spec.view !== "final") {
      const v = spec.view === "camo" ? camoView : spec.view === "panels" ? panelView : spec.view === "wear" ? wearView : spec.view === "dirt" ? dirtView
        : Math.max(1 - sstep(0, wearW, sf.convex[i]), (1 - sstep(0, cavW, sf.concave[i])) * 0.5);
      if (spec.view === "camo") { o0 = cols[ci][0]; o1 = cols[ci][1]; o2 = cols[ci][2]; } else { o0 = o1 = o2 = v; }
    }
    o0 = clamp01(o0); o1 = clamp01(o1); o2 = clamp01(o2);
    out[i * 4] = o0 * 255; out[i * 4 + 1] = o1 * 255; out[i * 4 + 2] = o2 * 255;
    out[i * 4 + 3] = orig ? orig[i * 4 + 3] : 255;
    if (sf.mask[i] === 1) { sR += o0; sG += o1; sB += o2; const l = 0.2126 * o0 + 0.7152 * o1 + 0.0722 * o2; sL2 += l * l; cnt++; }
  }
  const mean: [number, number, number] = cnt ? [sR / cnt, sG / cnt, sB / cnt] : [0, 0, 0];
  const ml = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
  const contrast = cnt ? Math.sqrt(Math.max(0, sL2 / cnt - ml * ml)) : 0;
  return { rgba: out, stats: { mean, contrast, worn: cnt ? worn / cnt : 0, dirty: cnt ? dirty / cnt : 0 } };
}

function boxBlur(src: Float32Array, S: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const w = 2 * r + 1;
  for (let y = 0; y < S; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * S + Math.min(S - 1, Math.max(0, x))];
    for (let x = 0; x < S; x++) {
      tmp[y * S + x] = acc / w;
      acc += src[y * S + Math.min(S - 1, x + r + 1)] - src[y * S + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < S; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(S - 1, Math.max(0, y)) * S + x];
    for (let y = 0; y < S; y++) {
      out[y * S + x] = acc / w;
      acc += tmp[Math.min(S - 1, y + r + 1) * S + x] - tmp[Math.max(0, y - r) * S + x];
    }
  }
  return out;
}

/** Resumo legível das verificações da textura gerada. */
export function texChecks(sf: Surface, r: TexResult): { level: "ok" | "warn"; text: string }[] {
  const out: { level: "ok" | "warn"; text: string }[] = [];
  if (sf.coverage < 0.05) out.push({ level: "warn", text: `O modelo usa só ${Math.round(sf.coverage * 100)}% da textura: confira se as UVs vieram certas.` });
  if (sf.hardEdges === 0) out.push({ level: "warn", text: "Não achei quinas no modelo: o desgaste nas bordas fica fraco." });
  if (r.stats.contrast < 0.025) out.push({ level: "warn", text: "A textura ficou muito uniforme: ligue painéis, desgaste ou uma camuflagem." });
  if (r.stats.worn > 0.35) out.push({ level: "warn", text: `${Math.round(r.stats.worn * 100)}% da pintura está gasta: talvez exagerado.` });
  if (r.stats.dirty > 0.5) out.push({ level: "warn", text: `${Math.round(r.stats.dirty * 100)}% coberto de sujeira: talvez exagerado.` });
  out.push({ level: "ok", text: `${Math.round(sf.coverage * 100)}% da textura em uso, ${sf.hardEdges} quinas, contraste ${(r.stats.contrast * 100).toFixed(1)}, ${Math.round(r.stats.worn * 100)}% gasto, ${Math.round(r.stats.dirty * 100)}% sujo.` });
  return out;
}
