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
// plataformas sobre o abismo: bases no alto, ligadas por pontes, simetria exata
import { WORLD_PRESETS } from "../src/pages/create/worldgen.ts";
for (const [sym, players] of [["rot2", 2], ["rot4", 4], ["none", 3]] as const) {
  const wg = newWorld({ ...WORLD_PRESETS.find((p) => p.id === "abyss")!.over, seed: 99, symmetry: sym, players });
  const a = generateWorld(g, donor, 0, false, wg, cat);
  const m = walkMask(g, a.heights, 0, false);
  const d0 = walkDistances(g, m, a.spawns[0]);
  check(a.spawns.every((s) => distAt(g, d0, s) >= 0), `plataformas: bases ligadas por pontes ${sym}`);
  check(a.features.some((f) => f.kind === "span") && a.features.filter((f) => f.kind === "platform").length >= players, `plataformas e pontes ${sym}`);
  const yAt = (p: [number, number]) => a.heights[Math.round(p[1] / 8) * 129 + Math.round(p[0] / 8)];
  let lo = Infinity; for (const v of a.heights) lo = Math.min(lo, v);
  check(a.spawns.every((s) => yAt(s) > lo + 60), `bases no alto ${sym}`);
  let low = 0; for (const v of a.heights) if (v < lo + 30) low++;
  check(low > a.heights.length * 0.2, `abismo em volta ${sym}`);
  console.log("plataformas", sym, "formas", a.features.length, "massa", a.mass.length, "abismo", Math.round((low / a.heights.length) * 100) + "%");
}
// partidas grandes: bases espalhadas, cordilheira entre os times com passagens, simetria exata
import { axisDist } from "../src/pages/create/worldgen.ts";
for (const [sym, players, G] of [["mirror-x", 24, 1024], ["rot2", 24, 2048], ["rot4", 24, 1024], ["diag", 16, 1024], ["none", 12, 1024]] as const) {
  const gg = { size: 128, grid: G };
  const wg = newWorld({ seed: 4321, symmetry: sym, players });
  const a = generateWorld(gg, donor, 0, false, wg, cat);
  check(a.spawns.length === players, `partida grande ${sym}: ${a.spawns.length} de ${players} bases`);
  let gap = Infinity;
  for (let i = 0; i < a.spawns.length; i++) for (let j = i + 1; j < a.spawns.length; j++) gap = Math.min(gap, Math.hypot(a.spawns[i][0] - a.spawns[j][0], a.spawns[i][1] - a.spawns[j][1]));
  // espalhadas: perto do máximo que cabe (área por base)
  const ideal = Math.sqrt((G * G) / players);
  check(gap > ideal * 0.45, `bases espalhadas ${sym}: ${Math.round(gap)} (ideal ~${Math.round(ideal)})`);
  const m = walkMask(gg, a.heights, 0, false);
  const d0 = walkDistances(gg, m, a.spawns[0]);
  check(a.spawns.every((s) => distAt(gg, d0, s) >= 0), `partida grande: bases alcançáveis ${sym}`);
  const ops = symmetryOps(sym, G), step = G / 128;
  let maxd = 0;
  for (const o of ops.slice(1)) for (let j = 0; j <= 128; j++) for (let i = 0; i <= 128; i++) {
    const [x, z] = o.pt([i * step, j * step]);
    maxd = Math.max(maxd, Math.abs(a.heights[j * 129 + i] - a.heights[Math.round(z / step) * 129 + Math.round(x / step)]));
  }
  check(maxd < 0.01, `partida grande: relevo simétrico ${sym} (dif ${maxd.toFixed(3)})`);
  if (sym !== "none") {
    // a cordilheira fica no eixo, longe das bases, e é alta (a média do eixo fora dos vãos)
    check(a.features.some((f) => f.name === "Cordilheira entre os times"), `cordilheira entre os times ${sym}`);
    check(a.features.some((f) => f.name === "Passagem na cordilheira") || wg.center !== false, `passagens na cordilheira ${sym}`);
    check(a.spawns.every((s) => axisDist(sym, G, s) > 100), `nenhuma base em cima da cordilheira ${sym}`);
    let onAxis = 0, n = 0, off = 0, no = 0;
    for (let j = 0; j <= 128; j++) for (let i = 0; i <= 128; i++) {
      const p: [number, number] = [i * step, j * step], d = axisDist(sym, G, p), y = a.heights[j * 129 + i];
      if (d < 12) { onAxis += y; n++; } else if (d > 140) { off += y; no++; }
    }
    check(onAxis / n > off / no + 15, `cordilheira mais alta que o resto ${sym}: ${(onAxis / n).toFixed(0)} contra ${(off / no).toFixed(0)}`);
  }
  // com a opção desligada, nada de cordilheira nem serras
  const plain = generateWorld(gg, donor, 0, false, { ...wg, teamWalls: false, baseWalls: false }, cat);
  check(!plain.features.some((f) => f.name === "Cordilheira entre os times" || f.name === "Serra entre bases"), `opções desligadas ${sym}`);
  console.log("grande", sym, players, "distância mínima", Math.round(gap), "formas", a.features.length, "dif simetria", maxd.toFixed(4));
}
// mapas gigantes (até 4096): mais formas na proporção da área, bases alcançáveis, simetria exata
for (const [sym, players, G] of [["rot2", 4, 4096], ["mirror-x", 8, 3072]] as const) {
  const gg = { size: 128, grid: G };
  const t0 = Date.now();
  const wg = newWorld({ seed: 77, symmetry: sym, players });
  const a = generateWorld(gg, donor, 0, false, wg, cat);
  const small = generateWorld({ size: 128, grid: 1024 }, donor, 0, false, wg, cat);
  const count = (r: typeof a) => r.features.filter((f) => f.gen && ["mountain", "hill", "ridge", "plateau", "lake", "river"].includes(f.kind)).length;
  check(count(a) > count(small) * 3, `gigante ${G}: mais formas que no 1024 (${count(a)} contra ${count(small)})`);
  const m = walkMask(gg, a.heights, 0, false);
  const d0 = walkDistances(gg, m, a.spawns[0]);
  check(a.spawns.length === players && a.spawns.every((s) => distAt(gg, d0, s) >= 0), `gigante ${G}: bases alcançáveis`);
  const ops = symmetryOps(sym, G), step = G / 128;
  let maxd = 0;
  for (const o of ops.slice(1)) for (let j = 0; j <= 128; j++) for (let i = 0; i <= 128; i++) {
    const [x, z] = o.pt([i * step, j * step]);
    maxd = Math.max(maxd, Math.abs(a.heights[j * 129 + i] - a.heights[Math.round(z / step) * 129 + Math.round(x / step)]));
  }
  check(maxd < 0.01, `gigante ${G}: relevo simétrico (dif ${maxd.toFixed(3)})`);
  console.log("gigante", G, sym, "formas", count(a), "ms", Date.now() - t0);
}
console.log(fails ? `${fails} falha(s)` : "worldgen: tudo certo");
process.exit(fails ? 1 : 0);
