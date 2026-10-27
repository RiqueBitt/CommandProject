// Ferramentas novas do editor de mapas (src/pages/create/mapTools.ts).
// node --experimental-strip-types tools/test_maptools.ts
import { applyStamp, balanceMap, captureStamp, describeWorld, imageHeights, measure, sketchHeights, SKETCH_KINDS } from "../src/pages/create/mapTools.ts";

let fails = 0;
const check = (c: boolean, m: string) => { if (!c) { fails++; console.log("FALHOU:", m); } else console.log("ok  ", m); };
(globalThis as { btoa?: unknown }).btoa ??= (s: string) => Buffer.from(s, "binary").toString("base64");
(globalThis as { atob?: unknown }).atob ??= (s: string) => Buffer.from(s, "base64").toString("binary");

// descrição
const d1 = describeWorld("Arquipélago com 6 jogadores, muitos rios e poucas florestas, ligado por pontes");
check(d1.over.style === "ocean" && d1.over.islandMode === "scattered" && d1.over.players === 6 && d1.over.links === "bridges", `arquipélago: ${JSON.stringify(d1.over)}`);
check(d1.over.rivers === 5 && d1.over.forests === 0.25, "muitos rios e poucas florestas");
const d2 = describeWorld("3v3 no deserto com montanhas, sem lagos, economia rica");
check(d2.over.players === 6 && d2.over.biome === "desert" && d2.over.lakes === 0 && d2.over.economy === "rich" && (d2.over.mountains ?? 0) > 0, `3v3 deserto: ${JSON.stringify(d2.over)}`);
const d3 = describeWorld("snowy map for 8 players with many lakes and villages, each team on its own island");
check(d3.over.players === 8 && d3.over.biome === "snow" && d3.over.style === "ocean" && d3.over.islandMode === "teams", `inglês: ${JSON.stringify(d3.over)}`);
check(describeWorld("plataformas no abismo, quatro jogadores").over.style === "platforms", "plataformas");

// esboço: água à esquerda, montanha no meio, planície à direita
const g = { size: 128, grid: 1024 };
const N = 32, sk = new Uint8Array(N * N);
const idx = (id: string) => SKETCH_KINDS.findIndex((k) => k.id === id);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) sk[j * N + i] = i < 10 ? idx("water") : i < 20 ? idx("mountain") : idx("plain");
const H = sketchHeights(g, sk, N, 40, true, 5, 50);
const at = (x: number, z: number) => H[Math.round(z / 8) * 129 + Math.round(x / 8)];
check(at(120, 512) < 40 && at(480, 512) > at(900, 512) + 20 && at(900, 512) > 40, `esboço: mar ${at(120, 512).toFixed(1)}, montanha ${at(480, 512).toFixed(1)}, planície ${at(900, 512).toFixed(1)}`);

// imagem
const img = new Float32Array(16 * 16);
for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) img[j * 16 + i] = i / 15;
const IH = imageHeights(g, img, 16, 16, 10, 110);
check(Math.abs(IH[64 * 129 + 0] - 10) < 0.01 && Math.abs(IH[64 * 129 + 128] - 110) < 0.01, "imagem: preto embaixo, branco em cima");

// carimbo: copia uma colina e cola noutro lugar (girada)
const flat = new Float32Array(129 * 129).fill(50);
for (let j = 0; j <= 128; j++) for (let i = 0; i <= 128; i++) { const d = Math.hypot(i * 8 - 300, j * 8 - 300); if (d < 80) flat[j * 129 + i] += 30 * (1 - d / 80); }
const st = captureStamp(g, flat, 300, 300, 100, "colina");
const layer = new Float32Array(129 * 129), cur = flat.slice();
applyStamp(g, layer, cur, st, 700, 700, 100, 45, false);
const peak = cur[Math.round(700 / 8) * 129 + Math.round(700 / 8)];
check(peak > 72 && peak < 85, `carimbo colado com a mesma altura (${peak.toFixed(1)})`);
check(Math.abs(cur[10 * 129 + 10] - 50) < 0.01, "carimbo não mexe longe dele");

// régua
const m = measure(g, flat, 0, false, [100, 100], [900, 100]);
check(Math.abs(m.straight - 800) < 0.1 && m.walk !== null && m.walk >= 800 && m.times[0].seconds! > 0, `régua: reta ${m.straight}, a pé ${m.walk?.toFixed(0)}`);

// equilíbrio: uma base com massa e a outra sem
const spawns: [number, number][] = [[200, 512], [824, 512]];
const b0 = balanceMap(g, new Float32Array(129 * 129).fill(50), 0, false, spawns, [[260, 512], [200, 580], [150, 460]], (i) => i);
check(b0.score < 85 && b0.suggestions.length >= 2 && b0.suggestions.every((q) => Math.hypot(q[0] - 824, q[1] - 512) < 160), `equilíbrio: nota ${b0.score}, ${b0.suggestions.length} sugestões perto da base sem massa`);
const b1 = balanceMap(g, new Float32Array(129 * 129).fill(50), 0, false, spawns, [[260, 512], [764, 512]], (i) => i);
check(b1.score >= 90, `equilíbrio simétrico: nota ${b1.score}`);

console.log(fails ? `${fails} falha(s)` : "maptools: tudo certo");
process.exit(fails ? 1 : 0);
