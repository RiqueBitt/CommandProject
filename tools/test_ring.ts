// Paisagem em volta do mapa: a camada do pincel só vale fora do mapa, a emenda na borda não tem
// degrau, o pincel não mexe dentro, e "povoar" só põe decorações lá fora, longe da borda.
// node --experimental-strip-types tools/test_ring.ts
import { decodeRing, emptyRing, encodeRing, inRing, isRingProp, ringDab, ringDelta, ringHeight, ringMargin, ringScatter } from "../src/pages/create/ring.ts";

function ok(cond: unknown, msg: string) { if (!cond) { console.error("FALHOU:", msg); process.exit(1); } }

const grid = 1024, m = ringMargin(grid);
ok(m === 256 && ringMargin(2048) === 384, "margem igual à do construtor");
const L = emptyRing(grid);
const flat = (x: number, z: number) => ringHeight(() => 30, grid, 0, L, x, z);
// subir longe da borda
ok(ringDab(L, grid, "raise", -150, 500, 80, 40, flat), "pincel fora do mapa muda a camada");
ok(ringDelta(L, grid, -150, 500) > 5, "subiu fora");
ok(ringDelta(L, grid, 0, 500) === 0 && ringDelta(L, grid, 300, 500) === 0, "na borda e dentro não muda");
// pincel dentro do mapa não faz nada
const before = L.data.slice();
ok(!ringDab(L, grid, "raise", 512, 512, 100, 40, flat), "pincel dentro do mapa não mexe na paisagem");
ok(L.data.every((v, i) => v === before[i]), "camada igual");
// emenda: perto da borda a mudança é pequena
ok(Math.abs(flat(-2, 500) - 30) < 1, "sem degrau na emenda");
// nivelar até um alvo
for (let k = 0; k < 40; k++) ringDab(L, grid, "flatten", -150, 500, 60, 20, flat, 10);
ok(Math.abs(flat(-150, 500) - 10) < 3, `nivelado perto de 10 (${flat(-150, 500).toFixed(1)})`);
// limites e ida e volta
for (let k = 0; k < 400; k++) ringDab(L, grid, "raise", 1200, 1200, 60, 60, flat);
ok(Math.max(...L.data) <= 420, "teto da camada");
const back = decodeRing(encodeRing(L), L.n, grid)!;
ok(back.data.every((v, i) => Math.abs(v - L.data[i]) <= 1 / 32 + 1e-6), "codificar e decodificar");
ok(inRing(grid, -10, 10) && !inRing(grid, 10, 10) && !inRing(grid, -300, 10), "dentro da paisagem");
// povoar
const pools = { trees: ["/props/trees/a_prop.bp", "/props/trees/b_prop.bp"], rocks: ["/props/rocks/r_prop.bp"], buildings: ["/props/buildings/h_prop.bp"], wrecks: [] };
for (const kind of ["forest", "rocks", "city", "ruins"] as const) {
  const list = ringScatter(grid, kind, pools, 1, () => 30, null, 7);
  ok(list.length > 20, `${kind}: decorações (${list.length})`);
  ok(list.every((p) => isRingProp(grid, p) && inRing(grid, p.x, p.z)), `${kind}: todas na paisagem`);
  ok(list.every((p) => Math.hypot(p.x - Math.max(0, Math.min(grid, p.x)), p.z - Math.max(0, Math.min(grid, p.z))) >= 24), `${kind}: longe da borda`);
}
ok(ringScatter(grid, "city", { trees: [], rocks: [], buildings: [], wrecks: [] }, 1, () => 30, null).length === 0, "sem modelos, nada");
ok(ringScatter(grid, "forest", pools, 1, () => 5, 10).length === 0, "debaixo d'água, nada");
console.log("paisagem em volta: ok");
