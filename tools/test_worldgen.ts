// Teste do gerador de mundos: mesma semente = mesmo mapa, simetria exata e bases alcançáveis.
// node --experimental-strip-types tools/test_worldgen.ts
import { generateWorld, newWorld, symmetryOps, walkMask, walkDistances, distAt } from "../src/pages/create/worldgen.ts";
import { autoFixMap, checkMap } from "../src/pages/create/mapCheck.ts";
const g = { size: 128, grid: 1024 };
const donor = new Float32Array(129 * 129).fill(40);
const cat = { trees: ["/props/Trees/a/a_prop.bp"], rocks: ["/props/Rocks/r/r_prop.bp"], buildings: ["/props/Buildings/b/b_prop.bp"], wrecks: ["/props/Wreckage/w/w_prop.bp"], other: [] };
let fails = 0;
const check = (c: boolean, m: string) => { if (!c) { fails++; console.log("FALHOU:", m); } };
for (const [sym, players] of [["rot2", 2], ["mirror-x", 4], ["rot4", 4], ["diag", 2], ["none", 3]] as const) {
  for (const water of [0, 30]) {
    const wg = newWorld({ seed: 1234, symmetry: sym, players, lakes: 3, rivers: 1, islands: 1, obstacles: 2, expansions: 2 });
    const a = generateWorld(g, donor, water, water > 0, wg, cat);
    const b = generateWorld(g, donor, water, water > 0, wg, cat);
    check(a.heights.every((v, i) => v === b.heights[i]) && a.props.length === b.props.length, `determinístico ${sym}`);
    check(a.spawns.length === players, `${players} bases em ${sym}: ${a.spawns.length}`);
    // simetria exata do relevo
    const ops = symmetryOps(sym, 1024);
    let maxd = 0;
    for (const o of ops.slice(1)) for (let j = 0; j <= 128; j += 1) for (let i = 0; i <= 128; i += 1) {
      const [x, z] = o.pt([i * 8, j * 8]);
      const k2 = Math.round(z / 8) * 129 + Math.round(x / 8);
      maxd = Math.max(maxd, Math.abs(a.heights[j * 129 + i] - a.heights[k2]));
    }
    check(sym === "none" || maxd < 0.01, `relevo simétrico ${sym} (dif ${maxd.toFixed(3)})`);
    const m = walkMask(g, a.heights, water, water > 0);
    const d0 = walkDistances(g, m, a.spawns[0]);
    check(a.spawns.every((s) => distAt(g, d0, s) >= 0), `bases alcançáveis ${sym} água=${water}`);
    // sem agulhas: nenhuma célula muito acima de todas as vizinhas
    let spikes = 0;
    for (let j = 1; j < 128; j++) for (let i = 1; i < 128; i++) {
      const k = j * 129 + i, y = a.heights[k];
      const lo = Math.max(a.heights[k - 1], a.heights[k + 1], a.heights[k - 129], a.heights[k + 129]);
      if (y - lo > 8 * 2.2) spikes++;
    }
    check(spikes === 0, `agulhas no relevo ${sym}: ${spikes}`);
    // massa: simétrica, alcançável, sem decorações em cima
    check(a.mass.length >= players, `massa gerada em ${sym}: ${a.mass.length}`);
    if (sym !== "none") {
      let worst = 0;
      for (const o of ops.slice(1)) for (const q of a.mass) { const t = o.pt(q); worst = Math.max(worst, Math.min(...a.mass.map((u) => Math.hypot(u[0] - t[0], u[1] - t[1])))); }
      check(worst < 3, `massa simétrica ${sym} (dif ${worst.toFixed(1)})`);
    }
    check(a.mass.every((q) => a.spawns.some((sp) => distAt(g, walkDistances(g, m, sp), q) >= 0)), `massa alcançável ${sym} água=${water}`);
    check(!a.props.some((pp) => a.mass.some((q) => Math.hypot(q[0] - pp.x, q[1] - pp.z) < 10)), `nenhuma decoração em cima da massa ${sym}`);
    const teamOf = (i: number) => (sym === "none" ? i : i % Math.max(1, Math.round(players / ops.length)) === i ? 0 : 1);
    const issues = checkMap(g, a.heights, water, water > 0, a.spawns, a.mass, a.props, teamOf);
    const errs = issues.filter((x) => x.level === "err");
    check(errs.length === 0, `validação sem erros ${sym} água=${water}: ${errs.map((x) => x.text).join(" | ")}`);
    // correção automática: massa ruim volta para o chão bom
    const bad = [...a.mass, [3, 3] as [number, number]];
    const fx = autoFixMap(g, a.heights, water, water > 0, a.spawns, bad, [...a.props, { ...a.props[0], x: a.spawns[0][0], z: a.spawns[0][1] }]);
    check(checkMap(g, a.heights, water, water > 0, a.spawns, fx.mass, fx.props, teamOf).every((x) => x.level !== "err"), `correção automática ${sym}`);
    console.log(sym, "água", water, "massa", a.mass.length, "avisos", issues.filter((x) => x.level === "warn").length, "formas", a.features.length, "decorações", a.props.length, "dif simetria", maxd.toFixed(4));
  }
}
console.log(fails ? `${fails} falha(s)` : "worldgen: tudo certo");
process.exit(fails ? 1 : 0);
