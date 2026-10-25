// Teste das cores da Partida grande: dois times nunca com a mesma cor.
// node --experimental-strip-types tools/test_teamcolors.ts
import { assignColors, type ColorSlot } from "../src/lib/teamColors.ts";

let fails = 0;
const check = (c: boolean, m: string) => { if (!c) { fails++; console.log("FALHOU:", m); } else console.log("ok  ", m); };
const slot = (team: number, color = -1, kind: ColorSlot["kind"] = "ai"): ColorSlot => ({ kind, team, color });
/** confere a regra: vagas de times diferentes (ou sozinhos) nunca com a mesma cor */
const distinctTeams = (slots: ColorSlot[], colors: number[]) => {
  for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) {
    if (slots[a].kind === "empty" || slots[b].kind === "empty") continue;
    const same = slots[a].team > 0 && slots[a].team === slots[b].team;
    if (!same && colors[a] === colors[b]) return false;
  }
  return true;
};

const distinctAll = (slots: ColorSlot[], colors: number[]) => {
  const on = colors.filter((_, i) => slots[i].kind !== "empty");
  return new Set(on).size === on.length;
};

// por jogador (padrão): 12 contra 12 com 24 cores diferentes, mesmo dentro do time
const twelve = [...Array(12)].map(() => slot(1)).concat([...Array(12)].map(() => slot(2)));
let r = assignColors(twelve, "player");
check(r.error === null && distinctAll(twelve, r.colors) && r.note === null, "12 contra 12 por jogador: 24 cores diferentes");
check(r.colors[0] === 0 && r.colors[1] === 2, "por jogador: as primeiras são as mais diferentes (azul, vermelho)");

// 32 jogadores: 32 cores diferentes
const t32 = [...Array(32)].map((_, i) => slot(1 + (i % 2)));
r = assignColors(t32, "player");
check(distinctAll(t32, r.colors) && r.note === null, "32 jogadores: 32 cores diferentes");

// 40 jogadores em 2 times: repete, avisa, e nunca repete a cor de um colega de time
const t40 = [...Array(40)].map((_, i) => slot(i < 20 ? 1 : 2));
r = assignColors(t40, "player");
let mateClash = false;
for (let a = 0; a < 40; a++) for (let b = a + 1; b < 40; b++) if (t40[a].team === t40[b].team && r.colors[a] === r.colors[b]) mateClash = true;
check(r.error === null && r.note !== null && !mateClash, "40 jogadores: avisa e não repete cor dentro do time");

// cor à mão igual à de outra vaga (mesmo time): a segunda vira automática
const manualP = [slot(1, 5), slot(1, 5), slot(2)];
r = assignColors(manualP, "player");
check(r.colors[0] === 5 && r.colors[1] !== 5 && distinctAll(manualP, r.colors), "por jogador: cor à mão não se repete nem no mesmo time");

// vagas vazias não gastam cor
const mixed = [slot(1), slot(1), slot(2), slot(0), slot(0), slot(2, -1, "empty")];
r = assignColors(mixed, "player");
check(new Set(r.colors.slice(0, 5)).size === 5, "por jogador: cada um com uma cor");

// por time (opção): 12 contra 12 com duas cores
r = assignColors(twelve, "team");
check(distinctTeams(twelve, r.colors) && r.colors[0] === 0 && r.colors[23] === 2, "por time: azul contra vermelho");
const solo32 = [...Array(32)].map((_, i) => slot(i + 1));
r = assignColors(solo32, "team");
check(r.error === null && new Set(r.colors).size === 32, "por time: 32 times, 32 cores");
r = assignColors([...Array(33)].map(() => slot(0)), "team");
check(r.error !== null, "por time: 33 sozinhos avisa que faltam cores");
const manual = [slot(1, 2), slot(1), slot(2, 2), slot(2), slot(3)];
r = assignColors(manual, "team");
check(distinctTeams(manual, r.colors) && r.colors[0] === 2 && r.colors[1] === 2, "por time: cor à mão vale para o time e não é copiada por outro time");

console.log(fails ? `\n${fails} falha(s)` : "\ntudo certo");
process.exit(fails ? 1 : 0);
