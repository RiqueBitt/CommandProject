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

// 12 contra 12: dois times, duas cores (azul e vermelho)
const twelve = [...Array(12)].map(() => slot(1)).concat([...Array(12)].map(() => slot(2)));
let r = assignColors(twelve, "team");
check(distinctTeams(twelve, r.colors) && r.colors[0] === 0 && r.colors[23] === 2, "12 contra 12: azul contra vermelho");

// 24 times de 1 (todos contra todos em times): 24 cores diferentes
const solo24 = [...Array(24)].map((_, i) => slot(i + 1));
r = assignColors(solo24, "team");
check(r.error === null && new Set(r.colors).size === 24, "24 times: 24 cores diferentes");

// 25 times: não há cores para todos
const solo25 = [...Array(25)].map((_, i) => slot(0));
r = assignColors(solo25, "team");
check(r.error !== null, "25 sozinhos: avisa que faltam cores");

// cor escolhida à mão igual à de outro time: não repete
const manual = [slot(1, 2), slot(1), slot(2, 2), slot(2), slot(3)];
r = assignColors(manual, "team");
check(distinctTeams(manual, r.colors) && r.colors[0] === 2 && r.colors[1] === 2, "cor à mão vale para o time e não é copiada por outro time");

// por jogador: todos diferentes; com mais de 24 jogadores, volta a ser por time
const mixed = [slot(1), slot(1), slot(2), slot(0), slot(0), slot(2, -1, "empty")];
r = assignColors(mixed, "player");
check(new Set(r.colors.slice(0, 5)).size === 5, "por jogador: cada um com uma cor");
const many = [...Array(30)].map((_, i) => slot(1 + (i % 3)));
r = assignColors(many, "player");
check(r.error === null && distinctTeams(many, r.colors) && new Set(r.colors).size === 3, "30 jogadores por jogador: cai para cor por time");

// sozinhos e times juntos
const fx = [slot(0), slot(0), slot(1), slot(1), slot(0)];
r = assignColors(fx, "team");
check(distinctTeams(fx, r.colors), "sozinhos e times: ninguém de times diferentes com a mesma cor");

console.log(fails ? `\n${fails} falha(s)` : "\ntudo certo");
process.exit(fails ? 1 : 0);
