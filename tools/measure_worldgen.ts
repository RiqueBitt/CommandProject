// Mede os mapas do gerador do jeito que medimos os mapas feitos à mão (pack BDFTM): relevo plano
// e íngreme, níveis de platô, massa por base e perto da base, distância entre as bases.
// node --experimental-strip-types tools/measure_worldgen.ts
import { generateWorld, newWorld, WORLD_PRESETS } from "../src/pages/create/worldgen.ts";
const N = Number(process.env.CP_GRID ?? 256);
const g = { size: N, grid: 1024 };
const donor = new Float32Array((N + 1) * (N + 1)).fill(40);
const cat = { trees: ["/props/Trees/a/a_prop.bp"], rocks: ["/props/Rocks/r/r_prop.bp"], buildings: ["/props/Buildings/b/b_prop.bp"], wrecks: ["/props/Wreckage/w/w_prop.bp"], other: [] };
export function stats(H: Float32Array, n: number, grid: number, water: number, spawns: number[][], mass: number[][]) {
  const w = n + 1, cell = grid / n;
  let flat = 0, steep = 0, gentle = 0, tot = 0;
  const flats: number[] = [];
  for (let j = 1; j < n; j++) for (let i = 1; i < n; i++) {
    const k = j * w + i;
    const gx = (H[k + 1] - H[k - 1]) / (2 * cell), gz = (H[k + w] - H[k - w]) / (2 * cell);
    const s = Math.hypot(gx, gz);
    tot++;
    if (s < 0.08) { flat++; flats.push(H[k]); }
    if (s >= 0.6) steep++;
    if (s >= 0.08 && s < 0.35) gentle++;
  }
  const lo = Math.min(...flats), bins = new Map<number, number>();
  for (const y of flats) { const b = Math.floor((y - lo) / 4); bins.set(b, (bins.get(b) ?? 0) + 1); }
  const levels = [...bins.values()].filter((c) => c > flats.length * 0.03).length;
  const near = spawns.map((s) => mass.filter((m) => Math.hypot(m[0] - s[0], m[1] - s[1]) < 20).length);
  const own = spawns.map(() => 0);
  for (const m of mass) { let b = 0, bd = 1e9; spawns.forEach((s, i) => { const d = Math.hypot(m[0] - s[0], m[1] - s[1]); if (d < bd) { bd = d; b = i; } }); own[b]++; }
  const nn = spawns.map((s, i) => Math.round(Math.min(...spawns.filter((_, j) => j !== i).map((t) => Math.hypot(s[0] - t[0], s[1] - t[1])))));
  let hmin = 1e9, hmax = -1e9; for (const v of H) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
  return { flat: +(flat / tot).toFixed(3), gentle: +(gentle / tot).toFixed(3), steep: +(steep / tot).toFixed(3), levels, mass: mass.length, near, own, nn, h: [Math.round(hmin), Math.round(hmax)] };
}
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const p of WORLD_PRESETS) {
    const wg = newWorld({ ...p.over, seed: 4242, players: 8, symmetry: "rot2", preset: p.id });
    const water = p.over.lakes || p.over.rivers || p.over.style === "ocean" || p.over.islands ? 30 : 0;
    const r = generateWorld(g, donor, water, water > 0, wg, cat);
    const s = stats(r.heights, N, 1024, water, r.spawns, r.mass);
    console.log(p.id.padEnd(12), JSON.stringify(s));
  }
}
