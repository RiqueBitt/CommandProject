// Limite de jogadores da Partida grande pelo tamanho do mapa (mesma conta do cp-core).
import { largestSizeFor, maxPlayersFor, spreadBases } from "../src/lib/matchLimits.ts";

let fails = 0;
const check = (c: boolean, m: string) => { if (!c) { fails++; console.log("FALHOU:", m); } else console.log("ok  ", m); };

check([512, 1024, 2048, 2560, 3072, 3584, 4096].map(maxPlayersFor).join() === "32,32,32,32,28,20,16", "jogadores por tamanho: " + [512, 1024, 2048, 2560, 3072, 3584, 4096].map(maxPlayersFor).join());
const sizes = Array.from({ length: 8 }, (_, i) => (i + 1) * 512);
check(largestSizeFor(32, sizes) === 2560 && largestSizeFor(16, sizes) === 4096 && largestSizeFor(24, sizes) === 3072, "maior mapa para 32, 16 e 24 jogadores");
// 32 bases numa grade 8×4: 16 espalhadas cobrem os quatro cantos
const starts: [number, number][] = [];
for (let z = 0; z < 4; z++) for (let x = 0; x < 8; x++) starts.push([x * 500, z * 1000]);
const pick = spreadBases(starts, 16);
check(pick.size === 16 && pick.has(0), "16 bases escolhidas, a sua (primeira) entre elas");
const perRow = [0, 1, 2, 3].map((z) => [...pick].filter((i) => Math.floor(i / 8) === z).length);
check(perRow.every((n) => n === 4), "bases espalhadas pelo mapa todo (4 por fileira): " + perRow.join());
console.log(fails ? `\n${fails} falha(s)` : "\ntudo certo");
if (fails) process.exit(1);
