// Chão por biomas: as mesmas contas de resources/maptk/cp_world.py (o jogo) para a prévia do editor
// mostrar o chão como ele vai ficar. Mudou lá, muda aqui.
//
// Cada ponto ganha uma posição t na cadeia de texturas do bioma: 0 praia, 1 chão, 2 terra, 3 rocha,
// 4 topo. Praia junto da água, terra em manchas e encostas leves, rocha nas encostas íngremes e neve
// (ou o "topo" do bioma) nos pontos mais altos. O pincel de textura puxa t para o papel pintado.
import type { LayerSet } from "../../lib/types";
import type { GroundBiome } from "./mapEdit";

export type GroundRole = "beach" | "low" | "mid" | "steep" | "peak";
export const ROLES: GroundRole[] = ["beach", "low", "mid", "steep", "peak"];
export const ROLE_LABEL: Record<GroundRole, string> = { beach: "Praia", low: "Chão", mid: "Terra", steep: "Rocha", peak: "Topo" };
export const ROLE_ICON: Record<GroundRole, string> = { beach: "beach_access", low: "grass", mid: "landscape", steep: "terrain", peak: "ac_unit" };

function hash(ix: number, iz: number, seed: number) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2246822519 | 0)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
export function valueNoise(x: number, z: number, seed: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = smooth(x - ix), fz = smooth(z - iz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}
export function fbm(x: number, z: number, seed: number, octaves = 3) {
  let s = 0, amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    s += (valueNoise(x, z, seed + o * 31) * 2 - 1) * amp;
    tot += amp;
    x *= 2.03; z *= 2.03; amp *= 0.5;
  }
  return s / tot;
}
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** posição na cadeia (0..4) — cp_world.zone_t */
export function zoneT(h: number, slope: number, rel: number, water: number | null, nz: number) {
  let t = 1, beach = false;
  if (water !== null) {
    const b = clamp01((h - (water + 0.6)) / 2.8);
    if (b < 1) { t = b; beach = true; }
  }
  if (!beach) {
    const dirt = Math.max(0, nz * 1.25 - 0.3) + clamp01((slope - 0.3) / 0.3);
    t = Math.max(t, 1 + Math.min(1, dirt));
  }
  const rock = clamp01((slope - 0.55) / 0.3);
  if (rock > 0) t = Math.max(t, 2 + rock);
  const snow = clamp01((rel - 0.74) / 0.14) * (1 - clamp01((slope - 1.1) / 0.6));
  if (snow > 0) t = Math.max(t, 3 + snow);
  return Math.min(t, 3.999);
}

/** Camada do pincel: papel (0..4) e força (0..255) em (n+1)² pontos sobre o mapa. */
export interface PaintLayer { n: number; role: Uint8Array; power: Uint8Array }

export function newPaint(n: number): PaintLayer { return { n, role: new Uint8Array((n + 1) ** 2), power: new Uint8Array((n + 1) ** 2) }; }
export function encodePaint(p: PaintLayer): string | null {
  if (!p.power.some((v) => v > 0)) return null;
  const all = new Uint8Array(p.role.length * 2);
  all.set(p.role, 0); all.set(p.power, p.role.length);
  let s = "";
  for (let i = 0; i < all.length; i += 0x8000) s += String.fromCharCode(...all.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decodePaint(b64: string | null | undefined, n: number): PaintLayer {
  const p = newPaint(n);
  if (!b64) return p;
  try {
    const bin = atob(b64), m = (n + 1) ** 2;
    if (bin.length !== m * 2) return p;
    for (let i = 0; i < m; i++) { p.role[i] = bin.charCodeAt(i); p.power[i] = bin.charCodeAt(m + i); }
  } catch { /* camada inválida: começa vazia */ }
  return p;
}

/** pincela o papel `role` (ou apaga, com role = -1) num círculo de raio `r` (unidades do mapa) */
export function paintDab(p: PaintLayer, grid: number, cx: number, cz: number, r: number, role: number, strength: number) {
  const n = p.n, w = n + 1, step = grid / n;
  const i0 = Math.max(0, Math.floor((cx - r) / step)), i1 = Math.min(n, Math.ceil((cx + r) / step));
  const j0 = Math.max(0, Math.floor((cz - r) / step)), j1 = Math.min(n, Math.ceil((cz + r) / step));
  let changed = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const d = Math.hypot(i * step - cx, j * step - cz) / r;
    if (d >= 1) continue;
    const k = j * w + i, f = smooth(1 - d) * strength;
    if (role < 0) {
      const v = Math.max(0, Math.round(p.power[k] * (1 - f)));
      if (v !== p.power[k]) { p.power[k] = v; changed = true; }
    } else {
      if (p.role[k] !== role) {
        // troca de papel: começa do que já estava pintado como força
        if (f > p.power[k] / 255) { p.role[k] = role; p.power[k] = Math.round(f * 255); changed = true; }
      } else {
        const v = Math.min(255, Math.round(255 * (1 - (1 - p.power[k] / 255) * (1 - f))));
        if (v !== p.power[k]) { p.power[k] = v; changed = true; }
      }
    }
  }
  return changed;
}

/** t de cada ponto da grade de alturas (s+1)² — cp_world.Biome.t (com o pincel) */
export function groundT(size: number, grid: number, H: Float32Array, water: number | null, paint?: PaintLayer | null, seed = 1337) {
  return paintT(groundBaseT(size, grid, H, water, seed), size, grid, paint);
}

/** t automático (sem o pincel): só muda quando o relevo muda */
export function groundBaseT(size: number, grid: number, H: Float32Array, water: number | null, seed = 1337) {
  const w = size + 1, step = grid / size;
  let lo = Infinity, hi = -Infinity;
  for (let k = 0; k < H.length; k++) { lo = Math.min(lo, H[k]); hi = Math.max(hi, H[k]); }
  if (water !== null) lo = Math.max(lo, water);
  // o "alto" é relativo a pelo menos 120 de desnível (mapa quase plano não vira neve)
  hi = Math.max(hi, lo + 120);
  const out = new Float32Array(w * w);
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) {
    const k = j * w + i, x = i * step, z = j * step;
    const dx = (H[j * w + Math.min(size, i + 1)] - H[j * w + Math.max(0, i - 1)]) / (2 * step);
    const dz = (H[Math.min(size, j + 1) * w + i] - H[Math.max(0, j - 1) * w + i]) / (2 * step);
    out[k] = zoneT(H[k], Math.hypot(dx, dz), (H[k] - lo) / (hi - lo), water, fbm(x / 90, z / 90, seed));
  }
  return out;
}

/** aplica o pincel sobre o t automático (rápido: dá para refazer a cada pincelada) */
export function paintT(base: Float32Array, size: number, grid: number, paint?: PaintLayer | null) {
  if (!paint || !paint.power.some((v) => v)) return base;
  const w = size + 1, step = grid / size, out = base.slice(), pw = paint.n + 1;
  for (let j = 0; j <= size; j++) for (let i = 0; i <= size; i++) {
    const fx = ((i * step) / grid) * paint.n, fz = ((j * step) / grid) * paint.n;
    const pk = Math.min(paint.n, Math.round(fz)) * pw + Math.min(paint.n, Math.round(fx)), s = paint.power[pk] / 255;
    if (s > 0) { const k = j * w + i; out[k] = Math.min(3.999, out[k] + (paint.role[pk] - out[k]) * s); }
  }
  return out;
}

/** muda a resolução de uma camada do pincel (vizinho mais perto) */
export function resamplePaint(p: PaintLayer, n: number): PaintLayer {
  if (p.n === n) return p;
  const out = newPaint(n), w = n + 1, pw = p.n + 1;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
    const k = Math.min(p.n, Math.round((j / n) * p.n)) * pw + Math.min(p.n, Math.round((i / n) * p.n));
    out.role[j * w + i] = p.role[k]; out.power[j * w + i] = p.power[k];
  }
  return out;
}

/** junta a pintura do gerador (embaixo) com a sua (por cima), na resolução da sua */
export function combinePaint(world: PaintLayer | null, user: PaintLayer): PaintLayer {
  if (!world || !world.power.some((v) => v)) return user;
  const out = newPaint(user.n), w = user.n + 1, ww = world.n + 1;
  for (let j = 0; j <= user.n; j++) for (let i = 0; i <= user.n; i++) {
    const k = j * w + i;
    if (user.power[k] > 0) { out.role[k] = user.role[k]; out.power[k] = user.power[k]; continue; }
    const wk = Math.min(world.n, Math.round((j / user.n) * world.n)) * ww + Math.min(world.n, Math.round((i / user.n) * world.n));
    out.role[k] = world.role[wk]; out.power[k] = world.power[wk];
  }
  return out;
}

// ------------------------------------------------------------------ texturas de cada bioma

/** Preferência de textura por papel e bioma (a primeira que existir no jogo ganha). */
const PREF: Record<GroundBiome, Record<GroundRole, RegExp[]>> = {
  temperate: {
    beach: [/mp_007_sand01/, /mp_203_sand01/, /u105_sand0/, /sand/],
    low: [/mp_007_grass01/, /mp_002_grass01/, /mp_003_grass01/, /u105_grass01/, /u06_grass/, /grass/],
    mid: [/mp_007_ground01/, /mp_002_earth01/, /dirt_00/, /u05_dirt01/, /ground|earth|dirt|soil/],
    steep: [/mp_007_rock01/, /mp_002_cliff01/, /mp_002_hill01/, /u04_rock/, /rock|cliff/],
    peak: [/mp_002_snow01/, /mp_004_snow01/, /mp_006_snow0/, /snow/],
  },
  desert: {
    beach: [/mp_203_sand01/, /u05_sand01/, /sand/],
    low: [/i01_sand_001a/, /i01_sand_004a/, /u105_sand0/, /sand|dune/],
    mid: [/sandstone/, /mp_303_ground/, /u05_dirt01/, /dirt|ground/],
    steep: [/mountainrock01/, /copperrock/, /u04_rock/, /rock|cliff/],
    peak: [/u04_toprock/, /u05_rock01/, /rock/],
  },
  snow: {
    beach: [/mp_006_snow03/, /gravel/, /sand/],
    low: [/mp_004_snow01/, /mp_006_snow02/, /mp_002_snow01/, /snow/],
    mid: [/mp_006_snow04/, /mp_004_faultage01/, /mp_006_hill02/, /snow|hill/],
    steep: [/mp_004_hill01/, /mp_006_hill01/, /rock|cliff|hill/],
    peak: [/mp_103_snow/, /snow_001a/, /snow/],
  },
  volcanic: {
    beach: [/mp_303_ground/, /dirt_002/, /ash|dirt/],
    low: [/dirt_001/, /u05_dirt01/, /mp_303_ground/, /dirt|ground|mud/],
    mid: [/mud_001/, /mp_303_hill/, /earth|hill/],
    steep: [/lavarock_001a/, /lavarock/, /rock/],
    peak: [/lavarock_001b/, /u04_rim/, /rock/],
  },
};
const NOT_GROUND = /metal|floor|wall|trim|window|teleporter|greeble|road|plate|tile|concrete|pipe|panel|decal|clouds|water|foam|wave|black|white|engine|destruction|debris|crater|city|building/;

/** As 5 texturas do bioma (com o que o usuário trocou em `over`), do papel 0 ao 4. */
export function biomeChain(layers: LayerSet[], biome: GroundBiome, over: Partial<Record<GroundRole, string>> = {}): (LayerSet | null)[] {
  const seen = new Set<string>();
  const uniq = layers.filter((l) => { const k = l.d.toLowerCase(); if (seen.has(k) || NOT_GROUND.test(k)) return false; seen.add(k); return true; });
  return ROLES.map((role) => {
    const o = over[role];
    if (o) { const hit = uniq.find((l) => l.d.toLowerCase() === o.toLowerCase()) ?? layers.find((l) => l.d.toLowerCase() === o.toLowerCase()); if (hit) return hit; }
    for (const re of PREF[biome][role]) {
      const hit = uniq.filter((l) => re.test(l.d.toLowerCase())).sort((a, b) => a.d.length - b.d.length)[0];
      if (hit) return hit;
    }
    return null;
  });
}
export const isGroundLayer = (l: LayerSet) => !NOT_GROUND.test(l.d.toLowerCase());
