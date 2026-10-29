// Raio-X do mapa: as mesmas medidas que usamos para estudar mapas competitivos feitos à mão
// (pack BDFTM, 20 mapas de 8 jogadores) e a comparação com a faixa deles. Serve para o editor
// ("seu mapa está mais íngreme que um mapa competitivo") e para os testes do gerador.

import type { Pt } from "../studio/mapEdit.ts";

export interface MapStats {
  /** fração do chão plano (dá para construir), suave e íngreme */
  flat: number; gentle: number; steep: number;
  /** quantos níveis de platô (alturas com bastante chão plano) */
  levels: number;
  /** pontos de massa no total e por jogador */
  mass: number; perPlayer: number;
  /** massa colada em cada base (até 20 unidades) e a massa mais perto de cada base */
  near: number[]; own: number[];
  /** distância de cada base até a base mais perto */
  nn: number[];
  /** distância típica da massa solta até a base mais perto (mediana) */
  spread: number;
  /** altura mais baixa e mais alta */
  h: [number, number];
}

export function mapStats(H: Float32Array, n: number, grid: number, spawns: Pt[] | number[][], mass: Pt[] | number[][]): MapStats {
  const w = n + 1, cell = grid / n;
  let flat = 0, steep = 0, gentle = 0, tot = 0;
  const flats: number[] = [];
  for (let j = 1; j < n; j++) for (let i = 1; i < n; i++) {
    const k = j * w + i;
    const gx = (H[k + 1] - H[k - 1]) / (2 * cell), gz = (H[k + w] - H[k - w]) / (2 * cell);
    const s = Math.hypot(gx, gz);
    tot++;
    if (s < 0.08) { flat++; flats.push(H[k]); }
    if (s >= 0.6) steep++;
    if (s >= 0.08 && s < 0.35) gentle++;
  }
  let lo = Infinity;
  for (const y of flats) lo = Math.min(lo, y);
  const bins = new Map<number, number>();
  for (const y of flats) { const b = Math.floor((y - lo) / 4); bins.set(b, (bins.get(b) ?? 0) + 1); }
  const levels = [...bins.values()].filter((c) => c > flats.length * 0.03).length;
  const near = spawns.map((s) => mass.filter((m) => Math.hypot(m[0] - s[0], m[1] - s[1]) < 20).length);
  const own = spawns.map(() => 0);
  const loose: number[] = [];
  for (const m of mass) {
    let b = 0, bd = Infinity;
    spawns.forEach((s, i) => { const d = Math.hypot(m[0] - s[0], m[1] - s[1]); if (d < bd) { bd = d; b = i; } });
    if (spawns.length) own[b]++;
    if (bd >= 20 && Number.isFinite(bd)) loose.push(bd);
  }
  loose.sort((a, b) => a - b);
  const nn = spawns.map((s, i) => {
    const d = spawns.filter((_, j) => j !== i).map((t) => Math.hypot(s[0] - t[0], s[1] - t[1]));
    return d.length ? Math.round(Math.min(...d)) : 0;
  });
  let hmin = Infinity, hmax = -Infinity;
  for (const v of H) { hmin = Math.min(hmin, v); hmax = Math.max(hmax, v); }
  return {
    flat: +(flat / Math.max(1, tot)).toFixed(3), gentle: +(gentle / Math.max(1, tot)).toFixed(3), steep: +(steep / Math.max(1, tot)).toFixed(3), levels,
    mass: mass.length, perPlayer: spawns.length ? +(mass.length / spawns.length).toFixed(1) : 0, near, own, nn,
    spread: loose.length ? Math.round(loose[loose.length >> 1]) : 0, h: [Math.round(hmin), Math.round(hmax)],
  };
}

export type Verdict = "ok" | "low" | "high";
export interface StatCheck { id: string; label: string; value: string; ref: string; verdict: Verdict; tip: string }

/**
 * Faixa dos mapas competitivos estudados (do 1º ao 3º quartil, arredondado). A massa da base é a
 * do toolkit (4 por base) e entra só no mapa gerado; aqui conta só a massa que você colocou.
 */
export const COMPETITIVE = {
  flat: [0.55, 0.75], gentle: [0.08, 0.2], steep: [0.06, 0.18], levels: [3, 6], perPlayer: [7, 15], spread: [88, 219], fair: 1.15,
} as const;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const band = (v: number, [lo, hi]: readonly [number, number]): Verdict => (v < lo ? "low" : v > hi ? "high" : "ok");

/** Compara o mapa com os competitivos: o que está fora da faixa e o que fazer. */
export function compareCompetitive(s: MapStats, grid: number, extraBaseMass = 4): StatCheck[] {
  const k = grid / 1024; // as distâncias da referência são de mapas 1024
  const out: StatCheck[] = [];
  const add = (id: string, label: string, value: string, ref: string, verdict: Verdict, low: string, high: string) =>
    out.push({ id, label, value, ref, verdict, tip: verdict === "low" ? low : verdict === "high" ? high : "" });
  add("flat", "Chão plano", pct(s.flat), `${pct(COMPETITIVE.flat[0])}–${pct(COMPETITIVE.flat[1])}`, band(s.flat, COMPETITIVE.flat),
    "Pouco lugar para construir: use o estilo Platôs em degraus, Aplainar ou o pincel Aplainar nas áreas grandes.",
    "O mapa está quase todo liso: falta relevo para defender e esconder. Ponha serras, platôs ou crateras.");
  add("gentle", "Encostas suaves", pct(s.gentle), `${pct(COMPETITIVE.gentle[0])}–${pct(COMPETITIVE.gentle[1])}`, band(s.gentle, COMPETITIVE.gentle),
    "Quase não há rampas: os níveis ficam separados demais. Ponha rampas ou caminhos entre os platôs.",
    "Morros suaves demais (o mapa ondula todo): suba os Degraus no gerador ou aplaine as áreas de base.");
  add("steep", "Paredões e encostas íngremes", pct(s.steep), `${pct(COMPETITIVE.steep[0])}–${pct(COMPETITIVE.steep[1])}`, band(s.steep, COMPETITIVE.steep),
    "Quase sem obstáculos: os exércitos vão em linha reta de base a base. Ponha serras ou cânions para criar caminhos.",
    "Muitos paredões: o mapa fica fechado e lento. Abra passagens ou baixe a altura das montanhas.");
  add("levels", "Níveis de altura", String(s.levels), `${COMPETITIVE.levels[0]}–${COMPETITIVE.levels[1]}`, band(s.levels, COMPETITIVE.levels),
    "Poucos níveis: falta terreno alto para dominar. Ponha platôs ou ligue os Degraus no gerador.",
    "Níveis demais: o chão plano está picado em pedaços pequenos. Aplaine ou suavize.");
  if (s.near.length) {
    const user = s.mass / Math.max(1, s.near.length) + extraBaseMass;
    add("mass", "Massa por jogador", (Math.round(user * 10) / 10).toString(), `${COMPETITIVE.perPlayer[0]}–${COMPETITIVE.perPlayer[1]}`, band(user, COMPETITIVE.perPlayer),
      "Pouca massa: as partidas ficam lentas. Use Massa espalhada no gerador ou o Equilíbrio para completar.",
      "Massa demais: a economia cresce rápido e o mapa perde disputa. Tire pontos perto das bases.");
    if (s.mass > s.near.length) {
      const sp = Math.round(s.spread / k);
      add("spread", "Massa solta: distância até a base", String(Math.round(s.spread)), `${Math.round(COMPETITIVE.spread[0] * k)}–${Math.round(COMPETITIVE.spread[1] * k)}`, band(sp, COMPETITIVE.spread),
        "A massa solta está colada nas bases: ninguém precisa sair para disputar. Espalhe pelo caminho.",
        "A massa solta está longe demais das bases: fica difícil de proteger. Traga parte para o meio do caminho.");
    }
  }
  if (s.nn.length > 1) {
    const lo = Math.min(...s.nn), hi = Math.max(...s.nn), r = lo > 0 ? hi / lo : 9;
    out.push({ id: "fair", label: "Distância entre as bases", value: `${lo}–${hi}`, ref: `até ${Math.round((COMPETITIVE.fair - 1) * 100)}% de diferença`, verdict: r <= COMPETITIVE.fair ? "ok" : "high",
      tip: r <= COMPETITIVE.fair ? "" : "Tem base bem mais perto da vizinha que as outras: use Distribuir bases ou uma simetria." });
  }
  return out;
}
