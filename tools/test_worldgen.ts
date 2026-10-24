// Teste do gerador de mundos: mesma semente = mesmo mapa, simetria exata e bases alcançáveis.
// node --experimental-strip-types tools/test_worldgen.ts
import { generateWorld, newWorld, symmetryOps, walkMask, walkDistances, distAt } from "../src/pages/create/worldgen.ts";
const g = { size: 128, grid: 1024 };
const donor = new Float32Array(129 * 129).fill(40);
const cat = { trees: ["/props/Trees/a/a_prop.bp"], rocks: ["/props/Rocks/r/r_prop.bp"], buildings: ["/props/Buildings/b/b_prop.bp"], wrecks: ["/props/Wreckage/w/w_prop.bp"], other: [] };
let fails = 0;
const check = (c: boolean, m: string) => { if (!c) { fails++; console.log("FALHOU:", m); } };
for (const [sym, players] of [["rot2", 2], ["mirror-x", 4], ["rot4", 4], ["diag", 2], ["none", 3]] as const) {
  for (const water of [0, 30]) {
    const wg = newWorld({ seed: 1234, symmetry: sym, players, lakes: 3, rivers: 1, islands: 1 });
    const a = generateWorld(g, donor, water, water > 0, wg, cat);
    const b = generateWorld(g, donor, water, water > 0, wg, cat);
    check(a.heights.every((v, i) => v === b.heights[i]) && a.props.length === b.props.length, `determinístico ${sym}`);
    check(a.spawns.length === players, `${players} bases em ${sym}: ${a.spawns.length}`);
    // simetria exata do relevo
    const ops = symmetryOps(sym, 1024);
    let maxd = 0;
    for (const o of ops.slice(1)) for (let j = 0; j <= 128; j += 4) for (let i = 0; i <= 128; i += 4) {
      const [x, z] = o.pt([i * 8, j * 8]);
      const k2 = Math.round(z / 8) * 129 + Math.round(x / 8);
      maxd = Math.max(maxd, Math.abs(a.heights[j * 129 + i] - a.heights[k2]));
    }
    check(sym === "none" || maxd < 0.01, `relevo simétrico ${sym} (dif ${maxd.toFixed(3)})`);
    const m = walkMask(g, a.heights, water, water > 0);
    const d0 = walkDistances(g, m, a.spawns[0]);
    check(a.spawns.every((s) => distAt(g, d0, s) >= 0), `bases alcançáveis ${sym} água=${water}`);
    console.log(sym, "água", water, "formas", a.features.length, "decorações", a.props.length, "dif simetria", maxd.toFixed(4));
  }
}
console.log(fails ? `${fails} falha(s)` : "worldgen: tudo certo");
process.exit(fails ? 1 : 0);
