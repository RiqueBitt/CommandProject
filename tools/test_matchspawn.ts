// Teste do sorteio de posições da Partida grande.
// node --experimental-strip-types tools/test_matchspawn.ts
import { shuffleSpawns } from "../src/lib/matchSpawn.ts";

let fails = 0;
const check = (c: boolean, m: string) => { if (!c) { fails++; console.log("FALHOU:", m); } else console.log("ok  ", m); };
let seed = 7;
const r = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const slots = [...Array(24)].map((_, i) => ({ id: i, kind: i === 5 ? "empty" : i === 0 ? "you" : "ai", team: i < 12 ? 1 : 2 }));

check(shuffleSpawns(slots, "fixed").every((s, i) => s.id === i), "fixas: nada muda");
const t = shuffleSpawns(slots, "team", r);
check(t.every((s, i) => s.team === slots[i].team), "por time: cada base continua com o mesmo time");
check(t.some((s, i) => s.id !== i), "por time: alguém trocou de base");
check(new Set(t.map((s) => s.id)).size === 24, "por time: ninguém sumiu nem repetiu");
const a = shuffleSpawns(slots, "all", r);
check(new Set(a.map((s) => s.id)).size === 24 && a.some((s, i) => s.team !== slots[i].team), "tudo: todos sorteados entre todas as bases");
check(a.filter((s) => s.kind === "you").length === 1, "tudo: você continua na partida");
console.log(fails ? `\n${fails} falha(s)` : "\ntudo certo");
process.exit(fails ? 1 : 0);
