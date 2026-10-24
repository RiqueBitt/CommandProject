// Análise de equilíbrio do mapa: território de cada base (pelo caminho a pé), distância até o
// inimigo, caminhos mais curtos entre as bases e gargalos. Calculado na resolução da prévia.

import type { Pt } from "../studio/mapEdit";
import { naturalColor, walkDistances, walkMask, type Grid, type WorldGen } from "./worldgen";

export interface BaseStat {
  index: number;
  team: number;
  /** % da área caminhável mais perto desta base do que das outras */
  territory: number;
  /** distância a pé até a base inimiga mais próxima (-1 = sem caminho) */
  enemy: number;
  /** massa manual no território */
  mass: number;
  height: number;
  reachable: boolean;
}

export interface Analysis {
  image: string;
  bases: BaseStat[];
  walkable: number;
  chokes: number;
  /** diferença entre o maior e o menor território dos times, em pontos percentuais */
  spread: number;
  verdict: "ok" | "warn" | "bad";
  text: string;
}

const TEAM_RGB: [number, number, number][] = [[90, 169, 230], [229, 83, 75], [123, 216, 143], [199, 139, 255], [242, 179, 61], [255, 143, 171], [155, 231, 255], [238, 238, 238]];

export function analyzeMap(g: Grid, H: Float32Array, water: number, hasWater: boolean, spawns: Pt[], teamOf: (i: number) => number, mass: Pt[], biome: WorldGen["biome"]): Analysis {
  const s = g.size, w = s + 1, step = g.grid / s;
  const mask = walkMask(g, H, water, hasWater);
  const dists = spawns.map((p) => walkDistances(g, mask, p));
  const owner = new Int16Array(w * w).fill(-1);
  const contested = new Uint8Array(w * w);
  let walk = 0;
  const area = new Array(spawns.length).fill(0);
  for (let k = 0; k < w * w; k++) {
    if (!mask[k]) continue;
    walk++;
    let best = -1, bd = Infinity, second = Infinity;
    dists.forEach((d, i) => {
      const v = d[k];
      if (v < 0) return;
      if (v < bd) { second = bd; bd = v; best = i; } else if (v < second) second = v;
    });
    if (best < 0) continue;
    owner[k] = best;
    area[best]++;
    // perto da fronteira entre bases de times diferentes
    if (second - bd < 6 && dists.some((d, i) => i !== best && teamOf(i) !== teamOf(best) && d[k] >= 0 && d[k] - bd < 6)) contested[k] = 1;
  }
  // caminhos mais curtos entre bases inimigas (descendo o campo de distância)
  const path = new Uint8Array(w * w);
  for (let a = 0; a < spawns.length; a++) for (let b = a + 1; b < spawns.length; b++) {
    if (teamOf(a) === teamOf(b)) continue;
    const da = dists[a];
    let k = nearestCell(g, mask, spawns[b]);
    if (k < 0 || da[k] < 0) continue;
    for (let guard = 0; guard < w * w && da[k] > 0; guard++) {
      path[k] = 1;
      const i = k % w, j = (k - i) / w;
      let nk = k;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii > s || jj > s) continue;
        const q = jj * w + ii;
        if (da[q] >= 0 && da[q] < da[nk]) nk = q;
      }
      if (nk === k) break;
      k = nk;
    }
  }
  // gargalos: pontos dos caminhos com pouco espaço caminhável em volta
  const choke = new Uint8Array(w * w);
  let chokes = 0;
  for (let k = 0; k < w * w; k++) {
    if (!path[k]) continue;
    const i = k % w, j = (k - i) / w;
    let free = 0, tot = 0;
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii > s || jj > s) continue;
      tot++;
      free += mask[jj * w + ii];
    }
    if (free / tot < 0.45) { choke[k] = 1; chokes++; }
  }
  // imagem
  let lo = Infinity, hi = -Infinity;
  for (const v of H) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const px = 512;
  const cv = document.createElement("canvas");
  cv.width = cv.height = px;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(px, px);
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    const i = Math.min(s, Math.round((x / (px - 1)) * s)), j = Math.min(s, Math.round((y / (px - 1)) * s));
    const k = j * w + i;
    const dx = (H[Math.min(k + 1, j * w + s)] - H[k]) / step, dz = (H[Math.min(k + w, w * w - 1)] - H[k]) / step;
    let [r, gg, b] = naturalColor(H[k], Math.hypot(dx, dz), water, hasWater, lo, hi, biome, Math.max(0.6, Math.min(1.25, 1 - dx * 0.3 - dz * 0.2)));
    if (!mask[k] && !(hasWater && H[k] < water)) { r *= 0.55; gg *= 0.55; b *= 0.55; }
    if (owner[k] >= 0) {
      const t = TEAM_RGB[teamOf(owner[k]) % 8];
      r = r * 0.6 + t[0] * 0.4; gg = gg * 0.6 + t[1] * 0.4; b = b * 0.6 + t[2] * 0.4;
    }
    if (contested[k]) { r = 255; gg = 214; b = 102; }
    if (path[k]) { r = 255; gg = 160; b = 60; }
    if (choke[k]) { r = 255; gg = 40; b = 60; }
    const o = (y * px + x) * 4;
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const bases: BaseStat[] = spawns.map((p, i) => {
    let enemy = -1;
    spawns.forEach((q, k2) => {
      if (k2 === i || teamOf(k2) === teamOf(i)) return;
      const kk = nearestCell(g, mask, q);
      const d = kk >= 0 ? dists[i][kk] : -1;
      if (d >= 0 && (enemy < 0 || d * step < enemy)) enemy = Math.round(d * step);
    });
    const m = mass.filter((q) => { const kk = nearestCell(g, mask, q); return kk >= 0 && owner[kk] === i; }).length;
    const kk = nearestCell(g, mask, p);
    return { index: i, team: teamOf(i), territory: walk ? Math.round((area[i] / walk) * 1000) / 10 : 0, enemy, mass: m, height: kk >= 0 ? Math.round(H[kk]) : 0, reachable: kk >= 0 && dists[0][kk] >= 0 };
  });
  const teams = [...new Set(bases.map((b) => b.team))];
  const per = teams.map((t) => bases.filter((b) => b.team === t).reduce((a, b) => a + b.territory, 0) / Math.max(1, bases.filter((b) => b.team === t).length));
  const spread = per.length > 1 ? Math.round((Math.max(...per) - Math.min(...per)) * 10) / 10 : 0;
  const unreachable = bases.filter((b) => !b.reachable).length;
  const verdict: Analysis["verdict"] = unreachable ? "bad" : spread > 8 ? "warn" : "ok";
  const text = unreachable ? `${unreachable} base(s) sem caminho até as outras.` : spread > 8 ? `Território desigual: diferença de ${spread} pontos entre os times.` : spread > 3 ? `Quase equilibrado (diferença de ${spread} pontos).` : "Equilibrado: os times têm áreas parecidas.";
  return { image: cv.toDataURL("image/png"), bases, walkable: Math.round((walk / (w * w)) * 100), chokes, spread, verdict, text };
}

function nearestCell(g: Grid, mask: Uint8Array, p: Pt) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const i0 = Math.round(p[0] / step), j0 = Math.round(p[1] / step);
  for (let r = 0; r <= 8; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const i = i0 + di, j = j0 + dj;
    if (i < 0 || j < 0 || i > s || j > s) continue;
    if (mask[j * w + i]) return j * w + i;
  }
  return -1;
}
