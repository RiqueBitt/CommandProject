// Validação do mapa antes de gerar: bases em lugar ruim, massa inacessível ou em declive, objetos
// sobrepostos e equilíbrio entre as bases. Também corrige automaticamente o que dá para corrigir
// sem mexer no seu desenho (move massa para o chão plano mais perto e tira decorações em cima de
// bases e de massa).

import type { PlacedProp, Pt } from "../studio/mapEdit";
import { distAt, walkDistances, walkMask, type Grid } from "./worldgen.ts";

export interface MapIssue { level: "err" | "warn" | "ok"; text: string; sel?: string; fixable?: boolean }
export interface MapFix { mass: Pt[]; props: PlacedProp[]; changes: string[] }

function sampler(g: Grid, H: Float32Array) {
  const s = g.size, w = s + 1, step = g.grid / s;
  const hAt = (x: number, z: number) => H[Math.max(0, Math.min(s, Math.round(z / step))) * w + Math.max(0, Math.min(s, Math.round(x / step)))];
  const slope = (x: number, z: number, rad: number) => {
    const y = hAt(x, z);
    let m = 0;
    for (const [dx, dz] of [[rad, 0], [-rad, 0], [0, rad], [0, -rad]]) m = Math.max(m, Math.abs(hAt(x + dx, z + dz) - y) / rad);
    return m;
  };
  return { hAt, slope, step };
}

export function checkMap(g: Grid, H: Float32Array, water: number, hasWater: boolean, spawns: Pt[], mass: Pt[], props: PlacedProp[], teamOf: (i: number) => number): MapIssue[] {
  const out: MapIssue[] = [];
  const G = g.grid;
  const { hAt, slope } = sampler(g, H);
  const wet = (p: Pt) => hasWater && hAt(p[0], p[1]) < water + 1.5;
  const mask = walkMask(g, H, water, hasWater);
  const dists = spawns.map((p) => walkDistances(g, mask, p));

  // ---- bases
  if (spawns.length < 2) out.push({ level: "err", text: "O mapa precisa de pelo menos 2 bases." });
  spawns.forEach((p, i) => {
    const sel = `spawn:${i}`;
    if (p[0] < 0 || p[1] < 0 || p[0] > G || p[1] > G) out.push({ level: "err", text: `Base ${i + 1} está fora do mapa.`, sel });
    else if (wet(p)) out.push({ level: "err", text: `Base ${i + 1} está na água.`, sel });
    else if (slope(p[0], p[1], 24) > 0.45) out.push({ level: "warn", text: `Base ${i + 1} fica num declive: os prédios não vão caber direito.`, sel });
    if (p[0] < 40 || p[1] < 40 || p[0] > G - 40 || p[1] > G - 40) out.push({ level: "warn", text: `Base ${i + 1} colada na borda do mapa.`, sel });
    spawns.forEach((q, j) => {
      if (j > i && Math.hypot(p[0] - q[0], p[1] - q[1]) < G * 0.15) out.push({ level: "warn", text: `Bases ${i + 1} e ${j + 1} muito perto uma da outra.`, sel });
    });
  });
  for (let i = 1; i < spawns.length; i++) {
    if (dists[0] && distAt(g, dists[0], spawns[i]) < 0) out.push({ level: "err", text: `Base ${i + 1} não tem caminho por terra até a base 1 (água ou paredões no caminho).`, sel: `spawn:${i}` });
  }
  // equilíbrio: distância a pé até o inimigo mais perto
  const enemyD = spawns.map((_, i) => {
    let best = Infinity;
    spawns.forEach((q, j) => { if (j !== i && teamOf(j) !== teamOf(i)) { const d = distAt(g, dists[i], q); if (d >= 0) best = Math.min(best, d); } });
    return best;
  }).filter((d) => Number.isFinite(d));
  if (enemyD.length > 1) {
    const lo = Math.min(...enemyD), hi = Math.max(...enemyD);
    if (lo > 0 && hi / lo > 1.3) out.push({ level: "warn", text: `Distâncias desiguais até o inimigo (${Math.round(lo)} a ${Math.round(hi)}): uma base fica mais exposta que as outras.` });
  }

  // ---- massa
  const massOwner = new Array(spawns.length).fill(0);
  mass.forEach((m, i) => {
    const sel = `mass:${i}`;
    if (m[0] < 8 || m[1] < 8 || m[0] > G - 8 || m[1] > G - 8) out.push({ level: "err", text: `Massa ${i + 1} fora do mapa ou na borda.`, sel, fixable: true });
    else if (wet(m)) out.push({ level: "warn", text: `Massa ${i + 1} na água: só tropas navais/anfíbias alcançam (o toolkit move para o seco).`, sel, fixable: true });
    else if (slope(m[0], m[1], 6) > 0.6) out.push({ level: "warn", text: `Massa ${i + 1} em declive: o extrator pode não caber.`, sel, fixable: true });
    else if (!dists.some((d) => distAt(g, d, m) >= 0)) out.push({ level: "err", text: `Massa ${i + 1} inacessível a pé de qualquer base.`, sel, fixable: true });
    mass.forEach((q, j) => { if (j > i && Math.hypot(m[0] - q[0], m[1] - q[1]) < 6) out.push({ level: "warn", text: `Massas ${i + 1} e ${j + 1} sobrepostas.`, sel, fixable: true }); });
    if (spawns.some((p) => Math.hypot(p[0] - m[0], p[1] - m[1]) < 18)) out.push({ level: "warn", text: `Massa ${i + 1} no centro de uma base: atrapalha o comandante e os primeiros prédios.`, sel, fixable: true });
    // dona = base mais perto a pé
    // empate (massa no meio do caminho) conta dividido entre as bases
    const ds = dists.map((d) => distAt(g, d, m));
    const bd = Math.min(...ds.filter((v) => v >= 0));
    if (Number.isFinite(bd)) {
      const tie = ds.map((v, k) => (v >= 0 && v <= bd * 1.08 + 1 ? k : -1)).filter((k) => k >= 0);
      for (const k of tie) massOwner[k] += 1 / tie.length;
    }
  });
  if (mass.length && spawns.length > 1) {
    // compara por time (em times, o que importa é o total de cada lado)
    const teams = new Map<number, number>();
    massOwner.forEach((n, k) => teams.set(teamOf(k), (teams.get(teamOf(k)) ?? 0) + n));
    const vals = [...teams.values()];
    const lo = Math.round(Math.min(...vals)), hi = Math.round(Math.max(...vals));
    if (vals.length > 1 && hi - lo >= 3) out.push({ level: "warn", text: `Massa desigual: há ${teams.size === spawns.length ? "base" : "time"} com ${lo} e ${teams.size === spawns.length ? "base" : "time"} com ${hi} pontos de massa mais perto.` });
  }

  // ---- decorações
  const near = new Map<string, number>();
  let overlap = 0, onBase = 0, onMass = 0, outside = 0, underwater = 0;
  for (const p of props) {
    if (p.x < 0 || p.z < 0 || p.x > G || p.z > G) { outside++; continue; }
    const k = `${Math.round(p.x / 1.5)},${Math.round(p.z / 1.5)}`;
    if (near.has(k)) overlap++; else near.set(k, 1);
    if (spawns.some((s) => Math.hypot(s[0] - p.x, s[1] - p.z) < 40)) onBase++;
    if (mass.some((m) => Math.hypot(m[0] - p.x, m[1] - p.z) < 8)) onMass++;
    if (hasWater && hAt(p.x, p.z) < water - 2) underwater++;
  }
  if (overlap) out.push({ level: "warn", text: `${overlap} decoração(ões) uma em cima da outra.`, fixable: true });
  if (onBase) out.push({ level: "warn", text: `${onBase} decoração(ões) dentro da área das bases: atrapalham a construção.`, fixable: true });
  if (onMass) out.push({ level: "warn", text: `${onMass} decoração(ões) em cima de pontos de massa: impedem o extrator.`, fixable: true });
  if (outside) out.push({ level: "warn", text: `${outside} decoração(ões) fora do mapa.`, fixable: true });
  if (underwater) out.push({ level: "warn", text: `${underwater} decoração(ões) debaixo d'água.`, fixable: true });

  if (!out.some((x) => x.level !== "ok")) out.push({ level: "ok", text: `${spawns.length} bases alcançáveis, ${mass.length} pontos de massa e ${props.length} decorações em ordem.` });
  return out;
}

/** Corrige massa e decorações (não mexe nas bases nem no relevo). */
export function autoFixMap(g: Grid, H: Float32Array, water: number, hasWater: boolean, spawns: Pt[], mass: Pt[], props: PlacedProp[]): MapFix {
  const G = g.grid;
  const { hAt, slope } = sampler(g, H);
  const mask = walkMask(g, H, water, hasWater);
  const dists = spawns.map((p) => walkDistances(g, mask, p));
  const changes: string[] = [];
  const good = (m: Pt, taken: Pt[]) =>
    m[0] >= 12 && m[1] >= 12 && m[0] <= G - 12 && m[1] <= G - 12 &&
    !(hasWater && hAt(m[0], m[1]) < water + 1.5) && slope(m[0], m[1], 6) <= 0.6 &&
    dists.some((d) => distAt(g, d, m) >= 0) && !spawns.some((p) => Math.hypot(p[0] - m[0], p[1] - m[1]) < 18) &&
    !taken.some((q) => Math.hypot(q[0] - m[0], q[1] - m[1]) < 7);
  const fixed: Pt[] = [];
  mass.forEach((m, i) => {
    if (good(m, fixed)) { fixed.push(m); return; }
    // procura em espiral o ponto válido mais perto
    for (let r = 4; r <= 120; r += 4) {
      for (let a = 0; a < 16; a++) {
        const q: Pt = [Math.round(m[0] + Math.cos((a / 16) * Math.PI * 2) * r), Math.round(m[1] + Math.sin((a / 16) * Math.PI * 2) * r)];
        if (good(q, fixed)) { fixed.push(q); changes.push(`massa ${i + 1} movida ${r} unidades`); return; }
      }
    }
    changes.push(`massa ${i + 1} removida (sem chão válido por perto)`);
  });
  const keep: PlacedProp[] = [];
  const seen = new Set<string>();
  let removed = 0;
  for (const p of props) {
    const k = `${Math.round(p.x / 1.5)},${Math.round(p.z / 1.5)}`;
    const bad = p.x < 0 || p.z < 0 || p.x > G || p.z > G || seen.has(k) || spawns.some((s) => Math.hypot(s[0] - p.x, s[1] - p.z) < 40) ||
      fixed.some((m) => Math.hypot(m[0] - p.x, m[1] - p.z) < 8) || (hasWater && hAt(p.x, p.z) < water - 2);
    if (bad) { removed++; continue; }
    seen.add(k);
    keep.push(p);
  }
  if (removed) changes.push(`${removed} decoração(ões) retiradas (sobrepostas, nas bases, na massa, fora do mapa ou debaixo d'água)`);
  return { mass: fixed, props: keep, changes };
}
