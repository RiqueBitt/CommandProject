// Mede os mapas do gerador do jeito que medimos os mapas feitos à mão (pack BDFTM): relevo plano
// e íngreme, níveis de platô, massa por base e perto da base, distância entre as bases.
// node --experimental-strip-types tools/measure_worldgen.ts
import { generateWorld, newWorld, WORLD_PRESETS } from "../src/pages/create/worldgen.ts";
import { mapStats } from "../src/pages/create/mapStats.ts";
const N = Number(process.env.CP_GRID ?? 256);
const g = { size: N, grid: 1024 };
const donor = new Float32Array((N + 1) * (N + 1)).fill(40);
const cat = { trees: ["/props/Trees/a/a_prop.bp"], rocks: ["/props/Rocks/r/r_prop.bp"], buildings: ["/props/Buildings/b/b_prop.bp"], wrecks: ["/props/Wreckage/w/w_prop.bp"], other: [] };
// as medidas moram no editor (Raio-X do mapa); aqui só o atalho com a assinatura antiga
export const stats = (H: Float32Array, n: number, grid: number, _water: number, spawns: number[][], mass: number[][]) => mapStats(H, n, grid, spawns, mass);
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const p of WORLD_PRESETS) {
    const wg = newWorld({ ...p.over, seed: 4242, players: 8, symmetry: "rot2", preset: p.id });
    const water = p.over.lakes || p.over.rivers || p.over.style === "ocean" || p.over.islands ? 30 : 0;
    const r = generateWorld(g, donor, water, water > 0, wg, cat);
    const s = stats(r.heights, N, 1024, water, r.spawns, r.mass);
    console.log(p.id.padEnd(12), JSON.stringify(s));
  }
}
